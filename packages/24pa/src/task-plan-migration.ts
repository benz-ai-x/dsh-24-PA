import type { Repos } from './repo.js';
import type { TaskPlanRow } from './repo/task-plan.js';
import { taskPlanTimeZone, type TaskPlanConfiguration } from './task-plan.js';
import type { SkillManagement } from './skill-management.js';
import type { SkillRuns } from './skill-runs.js';
import type { PlanLifecycle } from './plan-lifecycle.js';
import { TaskPlanAccess, planAuthorizationScope, taskPlanFingerprint } from './task-plan-access.js';

export interface PlanMigrationContext {
  binding: string; timeZone: string; sessionId: string; repos: Repos;
  deliveryChannel?: TaskPlanConfiguration['delivery']['channel'];
}

/** Legacy definitions lack immutable authorization. Adoption presents the
 * current verified binding, and preserves every original identity and row. */
export class TaskPlanMigration {
  constructor(private readonly deps: { management: SkillManagement; skills: SkillRuns; lifecycle: PlanLifecycle; access: TaskPlanAccess }) {}

  async preview(context: PlanMigrationContext, row: TaskPlanRow, input: Record<string, unknown>) {
    await context.repos.taskPlans.assertMigratable(row);
    if (row.session_id !== context.sessionId) throw new Error('原计划所属接入会话与当前工作区不符，请先核对，不能自动换绑。');
    if (row.status === 'active') {
      const timing = (await this.deps.lifecycle.nextTimes([row])).get(row.id);
      if (!timing || timing.timingError) throw new Error(timing?.timingError ?? '无法核验原生计划关联。');
    }
    const catalog = await this.deps.management.list(context.binding);
    const candidates = catalog.entries.filter(entry => ('internalName' in entry ? entry.internalName : entry.name) === row.skill);
    const selected = input.skillId ? candidates.find(entry => entry.id === input.skillId) : candidates.length === 1 ? candidates[0] : undefined;
    if (!selected) throw new Error('原 Skill 来源缺失或有同名项，请在目录核对并明确选择原来源，不自动替换。');
    if (!input.skillId && selected.source !== 'managed' && catalog.discovery !== 'complete') throw new Error('Skill 文件目录尚未完整核验，请明确选择原来源后重试。');
    const timeZone = taskPlanTimeZone(row, context.timeZone);
    try { new Intl.DateTimeFormat('en', { timeZone }).format(0); } catch { throw new Error('原计划时区无效，请先核对。'); }
    const parameters = input.parameters ?? ('type' in selected && selected.type === 'template' ? { title: row.title } : {});
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new Error('迁移参数须为对象。');
    const channel = context.deliveryChannel ?? 'none';
    const configuration: TaskPlanConfiguration = {
      version: 1, skillId: selected.id, parameters: structuredClone(parameters as Record<string, unknown>), timeZone,
      executionLimitMs: 900000, missedTtlMs: 3600000, deliveryTtlMs: 3600000, selectors: {},
      delivery: { channel, mode: 'always', voice: row.voice && channel === 'feishu', overrideQuiet: false },
    };
    const prepared = await this.deps.skills.preparePlan(configuration, row.session_id);
    if (prepared.skill.name !== row.skill) throw new Error('迁移不得替换原 Skill。');
    const authorization = await this.deps.access.authorize(configuration, prepared.skill, null);
    return { planId: row.id, revision: row.revision, configuration, authorization,
      original: { title: row.title, kind: row.kind, skill: row.skill, scheduleSpec: row.schedule_spec, status: row.status, voice: row.voice,
        scheduleId: row.schedule_id, generation: row.schedule_generation, sessionId: row.session_id },
      fingerprint: taskPlanFingerprint([row.id, row.revision, configuration, row.schedule_spec, planAuthorizationScope(authorization)]),
      workspaceBinding: context.binding,
      notices: ['沿用原计划、时间、启停、原生调度与历史，不重新创建计划。',
        '旧计划未保存固定投递授权；此处核验当前配置，确认后为后续运行固定目标。',
        ...(row.voice && channel !== 'feishu' ? ['原语音选择保留在迁移历史；当前渠道沿用文本投递，飞书配置后才可发送语音。'] : [])] };
  }
}
