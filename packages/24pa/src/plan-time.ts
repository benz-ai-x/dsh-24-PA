import {
  createAtScheduleRecord, createEveryScheduleRecord, createDailyScheduleRecord,
  createWeeklyScheduleRecord, createCronScheduleRecord, isRecurringScheduleRecord,
  resolveRecurringOccurrence, ScheduleId,
  type ScheduleRecord, type ScheduleCreateRequest, type ScheduleTimingChange,
} from '@deepseek-ai/dsh-schedule';

const selectors = ['at', 'every_seconds', 'daily', 'weekly', 'cron'] as const;
type Timing = Pick<ScheduleCreateRequest, typeof selectors[number]>;

/** The native rule is shared by preview, creation, edits and receipt recovery. */
export function planTimingRequest(spec: Record<string, unknown>): Timing {
  const keys = selectors.filter(key => spec[key] != null);
  if (keys.length !== 1) throw new Error('计划须且只能选择一种时间规则。');
  const key = keys[0]!;
  return { [key]: spec[key] } as Timing;
}

export function planTimingChange(spec: Record<string, unknown>): ScheduleTimingChange {
  const timing = planTimingRequest(spec), key = Object.keys(timing)[0]!;
  return { kind: key === 'every_seconds' ? 'every' : key, ...timing } as ScheduleTimingChange;
}

function build(spec: Record<string, unknown>, now: number): ScheduleRecord {
  const timing = planTimingRequest(spec), id = ScheduleId('pa24-time-validation');
  if (timing.at != null) return createAtScheduleRecord(id, 'plan', timing.at, now, 'plan');
  if (timing.every_seconds != null) return createEveryScheduleRecord(id, 'plan', timing.every_seconds, now, 'plan');
  if (timing.daily != null) return createDailyScheduleRecord(id, 'plan', timing.daily, now, 'plan');
  if (timing.weekly != null) return createWeeklyScheduleRecord(id, 'plan', timing.weekly, now, 'plan');
  return createCronScheduleRecord(id, 'plan', timing.cron!, now, 'plan');
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
  if (target.kind === 'at' || target.kind === 'after') return false;
  const zone = (value: string) => new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  if (!record.timeZone || zone(record.timeZone) !== zone(target.timeZone)) return false;
  if (target.kind === 'cron') return record.expression === target.expression;
  return record.time === target.time && (target.kind !== 'weekly' || JSON.stringify(record.weekdays) === JSON.stringify(target.weekdays));
}

export function previewPlanTimes(spec: Record<string, unknown>, now = Date.now(), count = 5): { spec: Record<string, unknown>; times: string[] } {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('预览次数须为 1–20。');
  const frozen = freezePlanTiming(spec, now);
  let record = build(frozen, now);
  const times = [record.scheduledAt];
  while (times.length < count && isRecurringScheduleRecord(record)) {
    const next = resolveRecurringOccurrence(record, Date.parse(record.scheduledAt)).nextScheduledAt;
    if (!next) break;
    times.push(next); record = { ...record, scheduledAt: next };
  }
  return { spec: frozen, times };
}
