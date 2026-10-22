import { describe, it, expect } from 'vitest';
import { createCronScheduleRecord, createEveryScheduleRecord, resolveRecurringOccurrence, ScheduleId } from '@deepseek-ai/dsh-schedule';
import { freezePlanTiming, previewPlanTimes, samePlanTiming } from '../../lib/plan-time.js';

describe('通用计划的原生时间规则', () => {
  it('每月 31 日跳过缺少该日期的月份，预览与宿主发生时间相同', () => {
    const now = Date.parse('2026-04-01T00:00:00Z');
    const spec = { cron: { expression: '0 9 31 * *', time_zone: 'Asia/Shanghai' } };
    expect(previewPlanTimes(spec, now, 3).times).toEqual(['2026-05-31T01:00:00.000Z', '2026-07-31T01:00:00.000Z', '2026-08-31T01:00:00.000Z']);
    const record = createCronScheduleRecord(ScheduleId('monthly'), 'plan', spec.cron, now, 'plan');
    expect(resolveRecurringOccurrence(record, Date.parse('2026-08-01T00:00:00Z')).occurrenceAt).toBe('2026-07-31T01:00:00.000Z');
  });
  it('周一至周五越过周末；已保存时区不随调用环境改变', () => {
    const spec = { weekly: { time: '09:00:00', time_zone: 'Asia/Shanghai', weekdays: [1, 2, 3, 4, 5] } };
    expect(previewPlanTimes(spec, Date.parse('2026-10-23T02:00:00Z'), 2).times).toEqual(['2026-10-26T01:00:00.000Z', '2026-10-27T01:00:00.000Z']);
  });
  it('夏令时不存在的日内时间跳过当天', () => {
    const spec = { daily: { time: '02:30:00', time_zone: 'America/New_York' } };
    expect(previewPlanTimes(spec, Date.parse('2026-03-07T08:00:00Z'), 2).times).toEqual(['2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z']);
  });
  it('相对一次时间固定为绝对时间，保留其他计划参数', () => {
    const now = Date.parse('2026-10-23T01:00:00Z');
    const frozen = freezePlanTiming({ after_seconds: 300, eventId: 'original-event' }, now);
    expect(frozen).toEqual({ at: '2026-10-23T01:05:00.000Z', eventId: 'original-event' });
    expect(previewPlanTimes(frozen, now + 60_000).times).toEqual(['2026-10-23T01:05:00.000Z']);
  });
  it('拒绝多个时间规则、过短间隔、无时区和过期一次时间', () => {
    expect(() => freezePlanTiming({ every_seconds: 60, daily: { time: '09:00:00', time_zone: 'UTC' } })).toThrow(/一种/);
    expect(() => freezePlanTiming({ after_seconds: 60, every_seconds: 60 })).toThrow(/同时/);
    expect(() => freezePlanTiming({ every_seconds: 59 })).toThrow(/at least/);
    expect(() => freezePlanTiming({ daily: { time: '09:00:00' } })).toThrow();
    expect(() => freezePlanTiming({ at: '2020-01-01T00:00:00Z' })).toThrow();
  });
  it('间隔和高级规则的恢复匹配不依赖推进后的下次时刻', () => {
    const now = Date.now(), interval = createEveryScheduleRecord(ScheduleId('interval'), 'plan', 120, now, 'plan');
    expect(samePlanTiming({ ...interval, scheduledAt: new Date(now + 720_000).toISOString() }, { every_seconds: 120 })).toBe(true);
    expect(samePlanTiming(interval, { every_seconds: 180 })).toBe(false);
    const cron = createCronScheduleRecord(ScheduleId('cron'), 'plan', { expression: '0 9 1 * *', time_zone: 'Asia/Shanghai' }, now, 'plan');
    expect(samePlanTiming(cron, { cron: { expression: '0 9 1 * *', time_zone: 'Asia/Shanghai' } })).toBe(true);
    expect(samePlanTiming(cron, { cron: { expression: '0 9 2 * *', time_zone: 'Asia/Shanghai' } })).toBe(false);
  });
});
