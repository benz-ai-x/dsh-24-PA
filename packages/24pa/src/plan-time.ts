import {
  createAtScheduleRecord, createEveryScheduleRecord, createDailyScheduleRecord,
  createWeeklyScheduleRecord, createCronScheduleRecord, isRecurringScheduleRecord,
  resolveRecurringOccurrence, ScheduleId,
  type AtInput, type DailyInput, type WeeklyInput, type CronInput,
  type ScheduleRecord, type ScheduleTiming,
} from '@deepseek-ai/dsh-schedule';

/** 内部时间规则仍是按键选择（计划草稿、冻结与存储共用）；与宿主请求的
 * 转换集中在 runtime 的原生 Schedule 适配层（0.2.1 键控 / 0.2.2 timing 联合）。 */
const selectors = ['at', 'every_seconds', 'daily', 'weekly', 'cron'] as const;
type KeyedTiming = Partial<Record<typeof selectors[number], unknown>>;

/** The native rule is shared by preview, creation, edits and receipt recovery. */
export function planTimingRequest(spec: Record<string, unknown>): KeyedTiming {
  const keys = selectors.filter(key => spec[key] != null);
  if (keys.length !== 1) throw new Error('计划须且只能选择一种时间规则。');
  return { [keys[0]!]: spec[keys[0]!] };
}

/** 0.2.2 宿主请求的 timing 判别联合；0.2.1 的 timing 编辑（change）同为该形状。
 * 计划草稿的键控值在此收口为宿主输入类型，校验由宿主的 create* 构造器承担。 */
export function nativeTiming(spec: Record<string, unknown>): ScheduleTiming {
  const timing = planTimingRequest(spec);
  if (timing.at != null) return { kind: 'at', at: timing.at as AtInput };
  if (timing.every_seconds != null) return { kind: 'every', every_seconds: timing.every_seconds as number };
  if (timing.daily != null) return { kind: 'daily', daily: timing.daily as DailyInput };
  if (timing.weekly != null) return { kind: 'weekly', weekly: timing.weekly as WeeklyInput };
  return { kind: 'cron', cron: timing.cron as CronInput };
}

/** 兼容旧调用名：计划调整传递的 timing 编辑载荷与 nativeTiming 同形。 */
export const planTimingChange = nativeTiming;

function build(spec: Record<string, unknown>, now: number): ScheduleRecord {
  const timing = nativeTiming(spec), id = ScheduleId('pa24-time-validation');
  if (timing.kind === 'at') return createAtScheduleRecord(id, 'plan', timing.at, now, 'plan');
  if (timing.kind === 'every') return createEveryScheduleRecord(id, 'plan', timing.every_seconds, now, 'plan');
  if (timing.kind === 'daily') return createDailyScheduleRecord(id, 'plan', timing.daily, now, 'plan');
  if (timing.kind === 'weekly') return createWeeklyScheduleRecord(id, 'plan', timing.weekly, now, 'plan');
  if (timing.kind === 'cron') return createCronScheduleRecord(id, 'plan', timing.cron, now, 'plan');
  throw new Error('不支持的原生时间规则：rrule。');
}

/** Relative one-shot input becomes one immutable instant before any mutation. */
export function freezePlanTiming(spec: Record<string, unknown>, now = Date.now()): Record<string, unknown> {
  const normalized = structuredClone(spec);
  if (normalized.after_seconds != null) {
    if (selectors.some(key => normalized[key] != null)) throw new Error('相对时间不能与其他时间规则同时指定。');
    const delay = normalized.after_seconds;
    if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) throw new Error('相对时间须为正数秒。');
    const at = now + delay * 1000;
    if (!Number.isFinite(at) || Math.abs(at) > 8.64e15) throw new Error('相对时间超出有效范围。');
    normalized.at = new Date(at).toISOString(); delete normalized.after_seconds;
  }
  const record = build(normalized, now);
  if (record.kind === 'at') normalized.at = record.scheduledAt;
  if (record.kind === 'cron') normalized.cron = { expression: record.expression, time_zone: record.timeZone };
  return normalized;
}

/** Match the rule rather than its advancing next occurrence. */
export function samePlanTiming(record: Record<string, any>, spec: Record<string, unknown>): boolean {
  const timing = planTimingRequest(spec);
  if (timing.at != null) return record.kind === 'at' && typeof timing.at === 'string' && Date.parse(record.scheduledAt) === Date.parse(timing.at);
  const target = build(spec, Date.now());
  if (record.kind !== target.kind) return false;
  if (target.kind === 'every') return record.everySeconds === target.everySeconds;
  if (target.kind === 'at' || target.kind === 'after' || target.kind === 'rrule') return false;
  const zone = (value: string) => new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  if (!record.timeZone || zone(record.timeZone) !== zone(target.timeZone)) return false;
  if (target.kind === 'cron') return record.expression === target.expression;
  return record.time === target.time && (target.kind !== 'weekly' || JSON.stringify(record.weekdays) === JSON.stringify(target.weekdays));
}

export function previewPlanTimes(spec: Record<string, unknown>, now = Date.now(), count = 5): { spec: Record<string, unknown>; times: string[] } {
  const frozen = freezePlanTiming(spec, now);
  return { spec: frozen, times: nativePlanTimes(build(frozen, now), count) };
}

/** Preserve the native anchor, particularly for interval schedules. */
export function nativePlanTimes(initial: ScheduleRecord, count = 5): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('预览次数须为 1–20。');
  let record = initial;
  if (!Number.isFinite(Date.parse(record.scheduledAt))) throw new Error('原生计划缺少有效的下次运行时间。');
  const times = [record.scheduledAt];
  while (times.length < count && isRecurringScheduleRecord(record)) {
    const next = resolveRecurringOccurrence(record, Date.parse(record.scheduledAt)).nextScheduledAt;
    if (!next) break;
    times.push(next); record = { ...record, scheduledAt: next };
  }
  return times;
}
