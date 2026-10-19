import { describe, expect, it, vi, afterEach } from 'vitest';
import { DigestService } from '../../lib/digest-service.js';
const fixture = (zone = 'Asia/Shanghai') => {
  const windows = [], writes = [], events = [], tasks = [{ summary: '任务', status: 'open' }];
  let failFirst = false, fresh = true;
  const service = new DigestService({ config: () => ({ timeZone: zone, calendarId: 'cal' }), memory: () => null,
    repos: () => ({ operations: { calendarCreatesForWork: async () => [], unresolvedCalendarCreates: async () => [], get: async () => null }, calendar: { eventsIn: async () => events }, tasks: { list: async () => tasks } }),
    syncCalendarWindow: async (_, from, to) => { windows.push([from.toISOString(), to.toISOString()]); return { ok: fresh }; },
    calendarWrite: async (_, __, data) => { writes.push(data); if (failFirst && writes.length === 1) throw new Error('rejected'); return { eventId: `e${writes.length}` }; },
  });
  return { service, windows, writes, events, tasks, fail: () => { failFirst = true; }, stale: () => { fresh = false; } };
};
afterEach(() => vi.useRealTimers());
it('上海默认明日使用本地日界，候选09点使用主人时区', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T17:00:00Z'));
  const f = fixture(); const preview = await f.service.planPreview({});
  expect(preview.date).toBe('2026-10-21');
  expect(f.windows[0]).toEqual(['2026-10-20T16:00:00.000Z', '2026-10-21T16:00:00.000Z']);
  expect(preview.candidateBlocks[0].suggestedStart).toBe('2026-10-21T01:00:00.000Z');
});
it.each([['2026-03-08', 23], ['2026-11-01', 25]])('纽约 %s 按完整本地日查询（%s小时）', async (date, hours) => {
  const f = fixture('America/New_York'); await f.service.planPreview({ date });
  expect((Date.parse(f.windows[0][1]) - Date.parse(f.windows[0][0])) / 3600000).toBe(hours);
});
it('同批冲突只采纳首块；跨日选块均覆盖，部分写失败不占用后续块', async () => {
  const f = fixture();
  const blocks = [{ summary: 'A', start: '2026-10-20T01:00:00Z', end: '2026-10-20T02:00:00Z' },
    { summary: 'B', start: '2026-10-20T01:30:00Z', end: '2026-10-20T02:30:00Z' },
    { summary: 'C', start: '2026-10-22T23:30:00Z', end: '2026-10-23T00:30:00Z' }];
  const result = await f.service.planAdopt({ id: 'work' }, { blocks });
  expect(result.adopted).toBe(2); expect(result.results[1].skipped).toBe('conflict');
  expect(f.windows.some(([from, to]) => Date.parse(from) <= Date.parse(blocks[2].start) && Date.parse(to) >= Date.parse(blocks[2].end))).toBe(true);
  const retry = fixture(); retry.fail();
  const partial = await retry.service.planAdopt({ id: 'work' }, { blocks: blocks.slice(0, 2) });
  expect(partial.adopted).toBe(1); expect(partial.results[1].ok).toBe(true);
});
it('无效日期与时间块在写入前拒绝；未知忙闲不冒充复核成功', async () => {
  const f = fixture(); await expect(f.service.planPreview({ date: '2026-02-30' })).rejects.toThrow();
  await expect(f.service.planAdopt({ id: 'work' }, { blocks: [{ summary: 'bad', start: 'bad', end: 'bad' }] })).rejects.toThrow();
  f.stale();
  const result = await f.service.planAdopt({ id: 'work' }, { blocks: [{ summary: 'A', start: '2026-10-20T01:00:00Z', end: '2026-10-20T02:00:00Z' }] });
  expect(result.adopted).toBe(0); expect(f.writes).toHaveLength(0);
});

it('夏令时缺失时刻拒绝，重复时刻取较早时间；全天与跨日忙碌裁剪到本地日', async () => {
  const { localInstant } = await import('../../lib/calendar-time.js');
  expect(() => localInstant('2026-03-08', '02:30:00', 'America/New_York')).toThrow(/不存在/);
  expect(localInstant('2026-11-01', '01:30:00', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  const f = fixture(); f.events.push({ summary: '全天', start_time: new Date('2026-10-19T00:00:00Z'), end_time: new Date('2026-10-21T00:00:00Z'), is_all_day: true });
  const result = await f.service.planPreview({ date: '2026-10-20' });
  expect(result.busy).toEqual([{ summary: '全天', start: '2026-10-19T16:00:00.000Z', end: '2026-10-20T16:00:00.000Z' }]);
  const adoption = await f.service.planAdopt({ id: 'work' }, { blocks: [{ summary: '冲突', start: '2026-10-20T01:00:00Z', end: '2026-10-20T02:00:00Z' }] });
  expect(adoption.adopted).toBe(0); expect(f.writes).toHaveLength(0);
  await expect(f.service.planAdopt({ id: 'work' }, { blocks: [{ summary: '无效日期', start: '2026-02-30T01:00:00Z', end: '2026-03-03T02:00:00Z' }] })).rejects.toThrow();
});

it('已取消和已完成任务不成为下一日时间块建议', async () => {
  const f = fixture(); f.tasks.push({ summary: '取消', status: 'canceled' }, { summary: '完成', status: 'completed' });
  const result = await f.service.planPreview({ date: '2026-10-20' });
  expect(result.candidateBlocks.map(b => b.task)).toEqual(['任务']);
});
