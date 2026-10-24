import type { Repos } from './repo.js';
import type { TaskPlanRow } from './repo/task-plan.js';
import type { SkillManagement } from './skill-management.js';
import type { SkillRuns } from './skill-runs.js';
import type { PlanLifecycle } from './plan-lifecycle.js';
import { taskPlanDraft } from './task-plan.js';
import { TaskPlanAccess, taskPlanFingerprint, planAuthorizationScope } from './task-plan-access.js';
import { previewPlanTimes } from './plan-time.js';
import { TaskPlanMigration, type PlanMigrationContext } from './task-plan-migration.js';

interface PlanContext extends PlanMigrationContext { sessionId: string; repos: Repos }
interface TaskPlanServiceDeps {
  context(): PlanContext | null;
  skills: SkillRuns;
  management: SkillManagement;
  lifecycle: PlanLifecycle;
  access: TaskPlanAccess;
  gate<T>(key: string, work: () => Promise<T>): Promise<T>;
}
export function taskPlanForm(row: TaskPlanRow): Record<string, unknown> {
  const spec = row.schedule_spec, config = row.task_config;
  if (!config) throw new Error('此计划仍使用旧配置，须先核对迁移，原关联保留。');
  let timing: Record<string, unknown>;
  if (spec.at) timing = { type: 'once', at: spec.at };
  else if (spec.daily) timing = { type: 'daily', time: spec.daily.time };
  else if (spec.weekly) timing = { type: row.kind === 'weekdays' ? 'weekdays' : 'weekly', time: spec.weekly.time, weekdays: spec.weekly.weekdays };
  else if (spec.every_seconds) timing = { type: 'interval', seconds: spec.every_seconds };
  else if (row.kind === 'monthly') {
    const [minute, hour, day] = String(spec.cron.expression).split(' ');
    timing = { type: 'monthly', day: Number(day), time: `${hour!.padStart(2, '0')}:${minute!.padStart(2, '0')}:00` };
  } else timing = { type: 'advanced', expression: spec.cron?.expression };
  return { title: row.title, skillId: config.skillId, timing, timeZone: config.timeZone, parameters: config.parameters,
    executionLimitMs: config.executionLimitMs, delivery: config.delivery, selectors: config.selectors };
}

/** Owner choices use durable receipts, while native mutation/recovery stays in
 * PlanLifecycle. Browsing does not authorize, run, or repair a plan. */
export class TaskPlanService {
  private readonly migration: TaskPlanMigration;
  constructor(private readonly deps: TaskPlanServiceDeps) { this.migration = new TaskPlanMigration(deps); }
  private context(binding: unknown): PlanContext {
    const context = this.deps.context();
    if (!context || context.binding !== binding) throw new Error('工作区已切换或尚未就绪，请刷新定时任务。');
    return context;
  }
  private async required(context: PlanContext, id: unknown): Promise<TaskPlanRow> {
    const row = await context.repos.taskPlans.get(String(id));
    if (!row) throw new Error('定时任务不存在。');
    return row;
  }
  async list(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding);
    const states = ['enabled', 'paused', 'blocked', 'recycled'];
    if (input.state && !states.includes(String(input.state))) throw new Error('计划状态筛选无效。');
    if (!Number.isSafeInteger(Number(input.offset ?? 0)) || Number(input.offset ?? 0) < 0) throw new Error('计划页码无效。');
    const result = await context.repos.taskPlans.list({ query: String(input.query ?? ''), skillId: input.skillId ? String(input.skillId) : undefined,
      state: input.state as 'enabled' | 'paused' | 'blocked' | 'recycled' | undefined, offset: Number(input.offset) || 0, limit: 20 });
    const skillBlocks = await context.repos.skills.planBlocks();
    const summaries = await Promise.all(result.rows.map(async row => {
      return { ...row, blocks: await context.repos.taskPlans.blocks(row.id),
        recentRun: await context.repos.taskPlans.recentRun(row.id),
        skillBlock: skillBlocks.find(block => block.plan_id === row.id) ?? null };
    }));
    const timings = await this.deps.lifecycle.nextTimes(summaries.filter(row => !row.blocks.length && !row.skillBlock && !row.delete_when_idle && (!row.task_config || row.owner_enabled)));
    const rows = summaries.map(row => ({ ...row, ...(timings.get(row.id) ?? { nextTimes: [], timingError: null }) }));
    return { ...result, rows, workspaceBinding: context.binding };
  }
  async summary(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), plans = await context.repos.taskPlans.scheduled();
    const times = await this.deps.lifecycle.nextTimes(plans), next = plans.flatMap(plan => {
      const at = times.get(plan.id)?.nextTimes[0]; return at ? [{ id: plan.id, title: plan.title, at, timeZone: plan.task_config?.timeZone ?? context.timeZone }] : [];
    }).sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;
    return { ...await context.repos.taskPlans.summary(), next, recentRun: await context.repos.taskPlans.recentRun(),
      timingError: [...times.values()].find(value => value.timingError)?.timingError ?? null, workspaceBinding: context.binding };
  }
  async inspect(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), row = await this.required(context, input.id);
    return { plan: row, form: row.task_config ? taskPlanForm(row) : null, blocks: await context.repos.taskPlans.blocks(row.id),
      migration: await context.repos.taskPlans.migration(row.id),
      legacyHistory: await context.repos.digests.occurrencesOf(row.id),
      triggers: await context.repos.planTriggers.list(row.id, Math.max(0, Math.floor(Number(input.offset) || 0))),
      activeRuns: await context.repos.taskPlans.activeRuns(row.id), workspaceBinding: context.binding };
  }
  async reconcile(): Promise<void> {
    const context = this.deps.context(); if (!context) return;
    const skillBlocks = await context.repos.skills.planBlocks();
    for (const base of await context.repos.digests.listPlans()) {
      const row = base as TaskPlanRow;
      if (!row.task_config) continue;
      const blocked = skillBlocks.some(block => block.plan_id === row.id) || (await context.repos.taskPlans.blocks(row.id)).length > 0;
      if ((!row.owner_enabled || row.delete_when_idle || blocked) && (row.schedule_id || row.lifecycle)) {
        await this.deps.lifecycle.stop(row.id, 'paused', row.revision);
      }
      if (row.delete_when_idle) await context.repos.taskPlans.finishDelete(row.id);
    }
  }
  private async preflight(context: PlanContext, row: TaskPlanRow, rebind: boolean) {
    if (!row.task_config || row.recycled_at || row.delete_when_idle) throw new Error('计划未完成配置或已进入删除流程。');
    const prepared = await this.deps.skills.preparePlan(row.task_config, row.session_id);
    const authorization = await this.deps.access.authorize(row.task_config, prepared.skill, rebind ? null : row.task_authorization);
    const nextTimes = previewPlanTimes(row.schedule_spec).times;
    const fingerprint = taskPlanFingerprint([row.id, row.revision, row.task_config, row.schedule_spec, planAuthorizationScope(authorization)]);
    return { prepared, authorization, nextTimes, fingerprint };
  }
  async preview(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), row = await this.required(context, input.id);
    const prepared = await this.preflight(context, row, input.rebind === true);
    return { planId: row.id, revision: row.revision, timeZone: row.task_config!.timeZone, authorization: prepared.authorization, nextTimes: prepared.nextTimes,
      fingerprint: prepared.fingerprint, workspaceBinding: context.binding,
      message: input.rebind === true ? '确认后更新固定目标，保留原启停选择。在途运行继续使用原快照。' : '核验只读取当前能力与目标；启用或解除阻断按所选操作办理。在途运行继续使用原快照。' };
  }
  async draft(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding);
    return { ...taskPlanDraft(input, context.timeZone), workspaceBinding: context.binding };
  }
  async migrationPreview(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), row = await this.required(context, input.id);
    return this.migration.preview(context, row, input);
  }
  async change(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding);
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestId)) throw new Error('缺少有效的计划操作标识。');
    const requestId = input.requestId, requestHash = taskPlanFingerprint(input), repo = context.repos.taskPlans;
    const identity = (step = 'done') => ({ requestId: `${requestId}:${step}`, requestHash });
    return this.deps.gate(`task-plan:${input.id ?? requestId}`, async () => {
      const repeated = await repo.repeated(identity());
      if (repeated) return { plan: repeated, repeated: true, workspaceBinding: context.binding };
      const op = String(input.op), row = input.id ? await this.required(context, input.id) : null;
      const selected = (row: TaskPlanRow, step: string) => ({ ...identity(step), id: row.id, expectedRevision: row.revision });
      if (row && Number(input.expectedRevision) !== row.revision
        && !await repo.repeated(identity('authorization')) && !await repo.repeated(identity('choice')) && !await repo.repeated(identity('delete'))) throw new Error('计划已有其他修改，请刷新后重试。');
      let result: TaskPlanRow;
      if (op === 'save' || op === 'copy') {
        const draft = taskPlanDraft(op === 'copy' && row ? { ...taskPlanForm(row), title: `${row.title} 副本`.slice(0, 120), ...(input.form as Record<string, unknown> ?? {}) } : input, context.timeZone);
        const skill = await this.deps.management.inspect(draft.configuration.skillId, context.binding);
        result = await repo.save({ ...identity(), ...(op === 'save' && row ? { id: row.id, expectedRevision: row.revision } : {}),
          title: draft.title, kind: draft.kind, skill: 'internalName' in skill ? skill.internalName : skill.name,
          sessionId: context.sessionId, scheduleSpec: draft.scheduleSpec, configuration: draft.configuration });
      } else if (op === 'migrate' && row) {
        const check = await this.migration.preview(context, row, input);
        if (input.confirm !== true || input.fingerprint !== check.fingerprint) throw new Error('原配置、来源或授权已改变，请重新预览迁移。');
        result = await repo.migrate({ ...selected(row, 'done'), configuration: check.configuration, authorization: check.authorization });
      } else if (op === 'rebind' && row) {
        const check = await this.preflight(context, row, true);
        if (input.confirm !== true || input.fingerprint !== check.fingerprint) throw new Error('配置、权限或目标已改变，请重新预览并确认重配。');
        result = await repo.authorize({ ...selected(row, 'done'), authorization: check.authorization });
      } else if (op === 'enable' && row) {
        let authorized = await repo.repeated(identity('authorization'));
        if (!authorized) {
          const check = await this.preflight(context, row, input.rebind === true);
          if (input.confirm !== true || input.fingerprint !== check.fingerprint) throw new Error('配置、权限或目标已改变，请重新预览并确认启用。');
          authorized = await repo.authorize({ ...selected(row, 'authorization'), authorization: check.authorization });
        }
        const current = await this.required(context, row.id);
        if (taskPlanFingerprint(current.task_config) !== taskPlanFingerprint(authorized.task_config)
          || taskPlanFingerprint(current.task_authorization) !== taskPlanFingerprint(authorized.task_authorization)) throw new Error('原启用操作之后配置或授权已改变，请刷新。');
        await this.deps.access.verify(current.task_authorization!);
        await repo.chooseEnabled({ ...selected(authorized, 'choice'), enabled: true });
        const beforeNative = await this.required(context, row.id);
        if (!beforeNative.owner_enabled) throw new Error('主人已再次暂停，不恢复旧启用请求。');
        if (beforeNative.status !== 'active') await this.deps.lifecycle.resume(row.id);
        result = await repo.remember(identity(), await this.required(context, row.id));
      } else if (op === 'pause' && row) {
        await repo.chooseEnabled({ ...selected(row, 'choice'), enabled: false });
        const current = await this.required(context, row.id);
        if (current.owner_enabled) throw new Error('原暂停操作之后已有新的启用选择，请刷新。');
        const stopped = await this.deps.lifecycle.stop(row.id, 'paused', current.revision);
        if (stopped.warning) throw new Error(stopped.warning);
        result = await repo.remember(identity(), await this.required(context, row.id));
      } else if (op === 'delete' && row) {
        const active = await repo.activeRuns(row.id);
        if (active.length && !['wait', 'stop'].includes(String(input.running))) throw new Error('计划还有未结束或待核对运行，请选择等待结束或停止后删除。');
        await repo.requestDelete(selected(row, 'delete'));
        const current = await this.required(context, row.id);
        if (!current.delete_when_idle && !current.recycled_at) throw new Error('原删除操作已被还原，请刷新。');
        if (!current.recycled_at) {
          const stopped = await this.deps.lifecycle.stop(row.id, 'paused', current.revision);
          if (stopped.warning) throw new Error(stopped.warning);
          if (input.running === 'stop') for (const run of active) await this.deps.skills.stop({ runId: run.id });
          await repo.finishDelete(row.id);
        }
        result = await repo.remember(identity(), await this.required(context, row.id));
      } else if (op === 'repair' && row) {
        const check = await this.preflight(context, row, false);
        if (input.confirm !== true || input.fingerprint !== check.fingerprint) throw new Error('请重新核验配置与权限，再确认解除此项阻断。');
        result = await repo.repairBlock({ ...selected(row, 'done'), key: String(input.key) });
      } else if (op === 'restore' && row) result = await repo.restore(selected(row, 'done'));
      else throw new Error('未知计划操作或缺少计划。');
      return { plan: result, repeated: false, workspaceBinding: context.binding };
    });
  }
}
