import type { SourceRegistry, SourceCapability } from './source-registry.js';
import type { SourceDomain } from './source-config.js';
import type { TaskPlanAuthorization, TaskPlanConfiguration } from './task-plan.js';
import { skillHash } from './skill-package.js';

const writes: Record<string, { domain: SourceDomain; capability: SourceCapability }> = {
  calendar_create: { domain: 'calendar', capability: 'create' }, calendar_update: { domain: 'calendar', capability: 'update' },
  calendar_cancel: { domain: 'calendar', capability: 'cancel' }, calendar_reminders: { domain: 'calendar', capability: 'reminders' },
  task_create: { domain: 'todo', capability: 'create' }, task_update: { domain: 'todo', capability: 'update' },
  task_complete: { domain: 'todo', capability: 'update' }, task_cancel: { domain: 'todo', capability: 'cancel' },
};
const reads = new Set(['calendar_sources', 'calendar_query', 'calendar_busy', 'task_get', 'task_list', 'memo_find']);
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const taskPlanFingerprint = (value: unknown): string => skillHash(JSON.stringify(canonical(value)));
export function planAuthorizationScope(authorization: TaskPlanAuthorization) {
  return { ...authorization, checkedAt: undefined, targets: authorization.targets.map(row => ({ ...row, target: { ...row.target, checkedAt: undefined } })) };
}

/** A selected scope remains fixed when workspace defaults move. Every action
 * still checks current registration and the adapter's real identity/rights. */
export class TaskPlanAccess {
  constructor(private readonly deps: {
    sources: SourceRegistry;
    owner(channel: 'feishu' | 'wecom'): Promise<NonNullable<TaskPlanAuthorization['delivery']>>;
    checkAction?(action: string): void;
  }) {}
  async authorize(config: TaskPlanConfiguration, skill: TaskPlanAuthorization['skill'], previous: TaskPlanAuthorization | null): Promise<TaskPlanAuthorization> {
    for (const action of skill.contract?.actions ?? []) this.checkAction(action);
    if (previous) {
      const old = previous.skill;
      if (old.id !== skill.id || skill.contract?.mode !== old.contract?.mode
        || skill.tools.some(tool => !old.tools.includes(tool))
        || (skill.contract?.actions ?? []).some(action => !old.contract?.actions?.includes(action))
        || skill.resources.some(resource => !old.resources.includes(resource))) throw new Error('Skill 新版本增加了工具、业务动作或资源范围，请显式重新配置并确认。');
      if (config.delivery.channel !== (previous.delivery?.channel ?? 'none')) throw new Error('投递方式已改变，请显式重新配置授权。');
      if (taskPlanFingerprint(config.selectors) !== taskPlanFingerprint(previous.selectors ?? {})) throw new Error('业务目标选择已改变，请显式重新配置授权。');
      await this.verify(previous);
      return { ...previous, skill, checkedAt: new Date().toISOString() };
    }
    const targets: TaskPlanAuthorization['targets'] = [];
    for (const action of skill.contract?.actions ?? []) {
      const write = writes[action]; if (!write || targets.some(row => row.target.domain === write.domain && row.capability === write.capability)) continue;
      const target = await this.deps.sources.bind(write.domain, config.selectors[write.domain], write.capability);
      const sameDomain = targets.find(row => row.target.domain === write.domain)?.target;
      if (sameDomain && (sameDomain.identityKey !== target.identityKey || sameDomain.resource.id !== target.resource.id || sameDomain.registrationRevision !== target.registrationRevision)) throw new Error('目标核验过程中身份或资源改变，请重新预览。');
      targets.push({ target, capability: write.capability });
    }
    return { checkedAt: new Date().toISOString(), selectors: structuredClone(config.selectors), skill, targets,
      delivery: config.delivery.channel === 'none' ? null : await this.deps.owner(config.delivery.channel) };
  }
  async verify(authorization: TaskPlanAuthorization): Promise<void> {
    for (const action of authorization.skill.contract?.actions ?? []) this.checkAction(action);
    for (const row of authorization.targets) await this.deps.sources.verify(row.target, row.capability);
    if (authorization.delivery) {
      const current = await this.deps.owner(authorization.delivery.channel);
      if (taskPlanFingerprint(current) !== taskPlanFingerprint(authorization.delivery)) throw new Error('原投递身份、主人或接入已改变；请核对原目标，不能改投新默认。');
    }
  }
  async action(authorization: TaskPlanAuthorization, action: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.checkAction(action);
    if (!authorization.skill.contract?.actions?.includes(action)) throw new Error('此操作不在本计划授权范围内。');
    const write = writes[action];
    if (!write) {
      if (!reads.has(action)) throw new Error('此后台动作尚未获准。');
      return args;
    }
    const binding = authorization.targets.find(row => row.target.domain === write.domain && row.capability === write.capability);
    if (!binding) throw new Error('本计划缺少已确认的业务目标。');
    await this.deps.sources.verify(binding.target, binding.capability);
    const selected = authorization.selectors?.[write.domain] ?? {};
    const basis = binding.target.selectedBy === 'explicit' ? { sourceId: selected.sourceId }
      : binding.target.selectedBy === 'mapping' ? { company: selected.company, project: selected.project } : {};
    this.deps.sources.assertSelection(binding.target, args, basis);
    const { sourceId: _source, company: _company, project: _project, channel: _channel, calendarId: _calendar, _sourceTarget: _target, ...values } = args;
    if ((args.channel && args.channel !== binding.target.platform)
      || (args.calendarId && args.calendarId !== binding.target.resource.id)) throw new Error('本次动作要求的目标超出计划固定授权，请先明确重配计划。');
    return { ...values, sourceId: binding.target.sourceId, channel: binding.target.platform, _sourceTarget: binding.target };
  }
  private checkAction(action: string): void {
    if (!writes[action] && !reads.has(action)) throw new Error(`后台动作 ${action} 尚无可核验的固定授权目标；请改为已支持的业务动作后启用。`);
    this.deps.checkAction?.(action);
  }
}
