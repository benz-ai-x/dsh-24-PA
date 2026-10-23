import { initialRunControl } from './run-control.js';
import { previewPlanTimes } from './plan-time.js';
import type { SkillContract } from './skill-package.js';
import type { SourceTarget, SourceCapability } from './source-registry.js';
import type { SourceSelector } from './source-config.js';
import { Temporal } from '@js-temporal/polyfill';

export interface TaskPlanConfiguration {
  version: 1;
  skillId: string;
  parameters: Record<string, unknown>;
  executionLimitMs: number;
  timeZone: string;
  delivery: { channel: 'none' | 'feishu' | 'wecom'; mode: 'always' | 'changed' | 'errors'; voice: boolean; overrideQuiet: boolean };
  selectors: { calendar?: SourceSelector; todo?: SourceSelector };
  missedTtlMs: number;
  deliveryTtlMs: number;
}
export interface TaskPlanAuthorization {
  checkedAt: string;
  selectors?: TaskPlanConfiguration['selectors'];
  skill: { id: string; name: string; versionId: string; packageHash: string; tools: string[]; contract: SkillContract | null; resources: string[] };
  targets: Array<{ target: SourceTarget; capability: SourceCapability }>;
  delivery: { channel: 'feishu' | 'wecom'; target: string; identityKey: string; connectionHash: string } | null;
}
export type TaskPlanBlockKind = 'skill' | 'dependency' | 'authorization' | 'failures' | 'manual';
export interface TaskPlanBlock { plan_id: string; key: string; kind: TaskPlanBlockKind; reason: string; created_at: Date }

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} 须为对象。`);
  return value as Record<string, unknown>;
}
function selection(value: unknown): SourceSelector | undefined {
  if (value === undefined) return;
  const row = object(value, '业务目标');
  if (Object.keys(row).some(key => !['sourceId', 'company', 'project'].includes(key)) || Object.values(row).some(value => typeof value !== 'string' || !value.trim() || value.length > 200)) throw new Error('业务目标须为来源、公司或项目名称。');
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value).trim()]));
}

/** Draft validation has no platform effects. Enabling separately captures
 * exact identities/resources; saving a paused draft never implies approval. */
export function taskPlanDraft(input: Record<string, unknown>, defaultTimeZone: string, now = Date.now()) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 120 || /[\r\n\u0000]/.test(title)) throw new Error('请填写 1–120 字的任务名称。');
  const skillId = String(input.skillId ?? '');
  if (!/^(managed|builtin|project-dsh):[a-zA-Z0-9:-]+$/.test(skillId)) throw new Error('请选择目录中的 Skill。');
  const timeZone = String(input.timeZone ?? defaultTimeZone);
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0); } catch { throw new Error('时区无效。'); }
  const rawTiming = object(input.timing, '时间规则'), timing = structuredClone(rawTiming);
  const kind = String(timing.type ?? '');
  const time = String(timing.time ?? '09:00:00');
  let spec: Record<string, unknown>;
  if (kind === 'once') {
    let at = timing.at;
    if (typeof at === 'string' && !/(?:Z|[+-]\d\d:\d\d)$/.test(at)) {
      try { at = Temporal.PlainDateTime.from(at).toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant().toString(); }
      catch { throw new Error('一次性时间无效或在该时区存在歧义，请明确时间或填写带偏移的 ISO 时间。'); }
    }
    spec = { at, time_zone: timeZone };
  }
  else if (kind === 'daily') spec = { daily: { time, time_zone: timeZone } };
  else if (kind === 'weekdays') spec = { weekly: { time, time_zone: timeZone, weekdays: [1, 2, 3, 4, 5] } };
  else if (kind === 'weekly') spec = { weekly: { time, time_zone: timeZone, weekdays: timing.weekdays } };
  else if (kind === 'monthly') {
    const day = Number(timing.day);
    if (!Number.isInteger(day) || day < 1 || day > 31 || !/^\d{2}:\d{2}:00$/.test(time)) throw new Error('每月须选择 1–31 日及精确到分钟的时间。');
    const [hour, minute] = time.split(':').map(Number);
    spec = { cron: { expression: `${minute} ${hour} ${day} * *`, time_zone: timeZone } };
  } else if (kind === 'interval') spec = { every_seconds: Number(timing.seconds), time_zone: timeZone };
  else if (kind === 'advanced') spec = { cron: { expression: String(timing.expression ?? ''), time_zone: timeZone } };
  else throw new Error('请选择一次、每天、周一至周五、每周、每月、间隔或高级规则。');
  const preview = previewPlanTimes(spec, now);
  const delivery = object(input.delivery ?? { channel: 'none' }, '结果投递');
  const channel = String(delivery.channel ?? 'none'), mode = String(delivery.mode ?? 'always');
  if (!['none', 'feishu', 'wecom'].includes(channel) || !['always', 'changed', 'errors'].includes(mode)) throw new Error('结果投递方式无效。');
  if (delivery.voice === true && channel !== 'feishu') throw new Error('语音版仅适用于飞书，并同时保留完整文本。');
  const selectors = object(input.selectors ?? {}, '业务目标');
  if (Object.keys(selectors).some(key => !['calendar', 'todo'].includes(key))) throw new Error('不支持该业务目标类型。');
  const configuration: TaskPlanConfiguration = {
    version: 1, skillId, parameters: structuredClone(object(input.parameters ?? {}, 'Skill 参数')),
    timeZone, executionLimitMs: initialRunControl(input.executionLimitMs === undefined ? 900000 : Number(input.executionLimitMs)).limitMs,
    delivery: { channel: channel as TaskPlanConfiguration['delivery']['channel'], mode: mode as TaskPlanConfiguration['delivery']['mode'], voice: delivery.voice === true, overrideQuiet: delivery.overrideQuiet === true },
    selectors: { ...(selectors.calendar === undefined ? {} : { calendar: selection(selectors.calendar) }), ...(selectors.todo === undefined ? {} : { todo: selection(selectors.todo) }) },
    missedTtlMs: 3600000, deliveryTtlMs: 3600000,
  };
  return { title, kind, configuration, scheduleSpec: preview.spec, nextTimes: preview.times,
    notices: [
      ...(kind === 'weekdays' ? ['周一至周五不等于法定工作日。'] : []),
      ...(kind === 'monthly' && Number(timing.day) > 28 ? ['不存在的月日期跳过。'] : []),
      ...(mode === 'changed' ? ['仅变化比较完整结果正文；时间戳等正文变化也会计入。'] : []),
      '保存为暂停不触发运行；启用前须核验本计划的权限、业务目标和投递对象。',
    ] };
}
