import type { DshSession } from './host.js';
import type { Repos } from './repo.js';
import type { TaskPlanRow } from './repo/task-plan.js';
import { planTriggerId, type PlanTriggerInput } from './repo/plan-trigger.js';
import type { SkillRuns } from './skill-runs.js';
import type { RunInput } from './skill-run-host.js';
import type { TaskPlanAuthorization } from './task-plan.js';
import { TaskPlanAccess, taskPlanFingerprint, planAuthorizationScope } from './task-plan-access.js';
import { scheduleGeneration } from './digest-trigger.js';
import { scheduleReminders, remainingScheduleMessage, type NativeReminder } from './schedule-message.js';
import { canceledInputIds } from './host-turn.js';

interface PlanEngineContext { binding: string; cwd: string; sessionId: string; repos: Repos }
interface PlanEngineDeps {
  context(): PlanEngineContext | null;
  skills: SkillRuns;
  access: TaskPlanAccess;
  permissionHash(authorization: TaskPlanAuthorization): string;
}
const planId = (prompt: string) => prompt.match(/^\[24PA计划 ([^\]\r\n]+)\]/)?.[1];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Converts immutable native occurrences into the same Run admission used by
 * manual Skills. No model interprets the scheduler's control envelope. */
export class TaskPlanEngine {
  private recovered: { binding: string; session: string; length: number } | null = null;
  constructor(private readonly deps: PlanEngineDeps) {}
  invalidateRecovery(): void { this.recovered = null; }
  private context(binding?: unknown): PlanEngineContext {
    const context = this.deps.context();
    if (!context || (binding !== undefined && binding !== context.binding)) throw new Error('工作区已切换或尚未就绪。');
    return context;
  }
  private async prepared(plan: TaskPlanRow) {
    if (!plan.task_config || !plan.task_authorization) throw new Error('计划尚未核验授权，请先预览启用。');
    const prepared = await this.deps.skills.preparePlan(plan.task_config, plan.session_id);
    const authorization = await this.deps.access.authorize(plan.task_config, prepared.skill, plan.task_authorization);
    return { prepared: { ...prepared, snapshot: { ...prepared.snapshot, permissionHash: this.deps.permissionHash(authorization) } }, authorization };
  }
  private async admit(input: PlanTriggerInput, checked?: Awaited<ReturnType<TaskPlanEngine['prepared']>>) {
    const context = this.context(), repo = context.repos.planTriggers;
    const id = planTriggerId(input.plan.id, input.generation, input.occurrence), prior = await repo.get(id);
    if (prior) {
      if (prior.snapshot.requestHash !== input.requestHash) throw new Error('触发操作标识已用于其他内容。');
      return { trigger: prior, run: prior.run_id ? await context.repos.skillRuns.get(prior.run_id) : null, repeated: true };
    }
    let preflightFailure: string | undefined;
    const plan = input.plan;
    const eligible = plan.task_authorization && !plan.recycled_at && !plan.delete_when_idle && !input.rejection && !input.skipReason
      && (input.source === 'manual' || (plan.status === 'active' && plan.owner_enabled && input.scheduleId === plan.schedule_id
        && input.generation === plan.schedule_generation && Date.now() - input.triggeredAt.getTime() <= plan.task_config!.missedTtlMs));
    if (eligible) {
      try {
        const { prepared, authorization } = checked ?? await this.prepared(plan);
        input.admission = { ...prepared, request_id: id, request_hash: id, trial: false,
          snapshot: { ...prepared.snapshot, permissionHash: this.deps.permissionHash(authorization), plan: {
            id: plan.id, title: plan.title, generation: input.generation, source: input.source, triggeredAt: input.triggeredAt.toISOString(),
            configuration: structuredClone(plan.task_config!), authorization,
          } } };
      } catch (error) { input.rejection = preflightFailure = errorText(error); }
    }
    let result;
    try { result = await repo.admit(input); }
    catch (error) {
      if (!input.admission) throw error;
      // The transaction rolls back both the event and Run if the version or
      // another unresolved operation changes during the final admission lock.
      result = await repo.admit({ ...input, admission: undefined, rejection: errorText(error) });
    }
    if (preflightFailure && result.trigger.status === 'rejected') await context.repos.taskPlans.block(plan.id,
      { key: 'preflight', kind: 'authorization', reason: preflightFailure }, plan.revision);
    return result;
  }
  async previewRun(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), plan = await context.repos.taskPlans.get(String(input.id));
    if (!plan || plan.recycled_at || plan.delete_when_idle || (await context.repos.taskPlans.blocks(plan.id)).length) throw new Error('计划不存在、已删除或仍有阻断。');
    const check = await this.prepared(plan);
    return { planId: plan.id, revision: plan.revision, authorization: check.authorization,
      fingerprint: taskPlanFingerprint([plan.id, plan.revision, check.prepared.snapshot, planAuthorizationScope(check.authorization)]),
      workspaceBinding: context.binding, message: '立即运行只执行一次，保留原计划启停选择，实际动作与投递均按计划配置。' };
  }
  async runNow(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), requestId = String(input.requestId ?? '');
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestId)) throw new Error('缺少有效的运行操作标识。');
    const plan = await context.repos.taskPlans.get(String(input.id));
    if (!plan?.task_config) throw new Error('定时任务不存在或尚未完成迁移。');
    const generation = `manual:${requestId}`, requestHash = taskPlanFingerprint(input);
    const prior = await context.repos.planTriggers.get(planTriggerId(plan.id, generation, requestId));
    if (prior) {
      if (prior.snapshot.requestHash !== requestHash) throw new Error('触发操作标识已用于其他内容。');
      return { trigger: prior, run: prior.run_id ? await context.repos.skillRuns.get(prior.run_id) : null, repeated: true };
    }
    const check = await this.prepared(plan);
    const fingerprint = taskPlanFingerprint([plan.id, plan.revision, check.prepared.snapshot, planAuthorizationScope(check.authorization)]);
    if (input.confirm !== true || input.fingerprint !== fingerprint) throw new Error('配置、版本或权限已变化，请重新预览并确认。');
    return this.admit({ plan, source: 'manual', generation, occurrence: requestId, triggeredAt: new Date(), sessionId: context.sessionId, requestHash }, check);
  }
  /** Return replacements for only owned plan envelopes and native completion
   * notices. Other input in the same step retains its original identity. */
  async consume(messages: RunInput[], sessionId: string, canceled = new Set<string>()): Promise<Map<string, RunInput | null>> {
    const context = this.context(), replacements = new Map<string, RunInput | null>();
    if (sessionId !== context.sessionId) return replacements;
    const selected: Array<{ message: RunInput; reminders: NativeReminder[]; owned: Array<{ reminder: NativeReminder; plan: TaskPlanRow }> }> = [];
    for (const message of messages) {
      if (message.source?.kind === 'subagent-settled' && message.source.senderSessionId) {
        const run = await context.repos.skillRuns.bySession(message.source.senderSessionId);
        if (run?.plan_id && run.source_session_id === sessionId) {
          await context.repos.skillRuns.input(run.id, message, false, sessionId); replacements.set(message.id, null);
        }
        continue;
      }
      const reminders = scheduleReminders(message);
      if (!reminders) continue;
      const owned = [];
      for (const reminder of reminders) {
        const id = planId(reminder.reminder_prompt), plan = id ? await context.repos.taskPlans.get(id) : null;
        if (plan?.task_config) owned.push({ reminder, plan });
      }
      if (owned.length) selected.push({ message, reminders, owned });
    }
    const latest = new Map<string, string>();
    const group = (plan: TaskPlanRow, reminder: NativeReminder) => JSON.stringify([plan.id, reminder.schedule_id, scheduleGeneration(reminder.reminder_prompt)]);
    for (const batch of selected) for (const { reminder, plan } of batch.owned) {
      const key = group(plan, reminder);
      if ((latest.get(key) ?? '') < reminder.occurrence_at) latest.set(key, reminder.occurrence_at);
    }
    // Only the latest window may occupy a slot. Older queued envelopes are
    // retained as skipped events even when they precede it in the batch.
    for (const batch of selected) {
      for (const { reminder, plan } of batch.owned) {
        const future = Date.parse(reminder.occurrence_at) > Date.now() + 1000;
        await this.admit({ plan, source: 'schedule', generation: scheduleGeneration(reminder.reminder_prompt) ?? 'unverified',
          occurrence: reminder.occurrence_at, triggeredAt: new Date(reminder.occurrence_at), sessionId,
          scheduleId: reminder.schedule_id, messageId: batch.message.id, nativeMessage: batch.message,
          rejection: canceled.has(batch.message.id) ? '原生计划输入已被取消。' : future ? '发生时间尚未到达，拒绝提前执行。' : undefined,
          skipReason: reminder.occurrence_at !== latest.get(group(plan, reminder)) ? '已有更新的触发窗口，旧窗口不补执行。' : undefined });
      }
      const owned = new Set(batch.owned.map(row => row.reminder));
      replacements.set(batch.message.id, remainingScheduleMessage(batch.message, batch.reminders.filter(row => !owned.has(row))));
    }
    return replacements;
  }
  async recover(session: DshSession): Promise<void> {
    const context = this.context(), events = session.ownEvents();
    if (session.id !== context.sessionId || (this.recovered?.binding === context.binding && this.recovered.session === session.id && this.recovered.length === events.length)) return;
    const messages = new Map<string, RunInput>();
    for (const event of events) {
      const inputs: RunInput[] = event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : event.type === 'user/message' ? [event.data as RunInput] : [];
      for (const message of inputs) if (['schedule', 'subagent-settled'].includes(String(message.source?.kind)) && !messages.has(message.id)) messages.set(message.id, message);
    }
    await this.consume([...messages.values()], session.id, canceledInputIds(session));
    this.recovered = { binding: context.binding, session: session.id, length: events.length };
  }
}
