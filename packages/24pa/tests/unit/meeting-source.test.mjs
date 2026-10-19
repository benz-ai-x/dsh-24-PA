import { beforeEach, afterEach, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaRuntime } from '../../lib/runtime.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { observeCalendar } from '../../lib/calendar-observation.js';
import { eventFingerprint } from '../../lib/util.js';

let root, rt, event, deletes;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-meeting-source-')); const path = join(root, 'ws'); await mkdir(path);
  await writeFile(join(path, 'AGENTS.md'), '```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, ownerOpenId: 'owner' }) + '\n```');
  deletes = []; const schedule = { create: async () => ({}), delete: async ({ id }) => { deletes.push(id); throw new Error('native offline'); } };
  const ctx = { get: name => name === 'schedule' ? schedule : null, skills: null,
    workspaceRegistry: { create: async p => ({ id: p, path: p, title: '24私助' }) },
    sessionController: { create: async () => {}, rename: async () => {}, resolveAgent: async () => null } };
  rt = new PaRuntime(ctx, { stateDirectory: root, workspacePath: '', reminderTickMs: 60000, larkCliBin: 'missing', wecomCliBin: 'missing', cliTimeoutMs: 1000, env: {} });
  await rt.bind(path);
  rt.syncCalendarWindow = async (calendarId, from, to, channel) => {
    expect(calendarId).toBe('original-cal'); expect(channel).toBe('feishu');
    const state = await rt.repos.calendar.getSync(calendarId);
    return { ok: state?.complete === true, error: state?.last_error };
  };
  event = { event_id: 'meeting', calendar_id: 'original-cal', channel: 'feishu', summary: '会', start_time: new Date('2026-10-20T01:00:00Z'), end_time: new Date('2026-10-20T02:00:00Z'), is_all_day: false, timezone: 'Asia/Shanghai', status: 'active', recurring: false, attendees: null, url: null, raw: {} };
  await rt.repos.calendar.upsertEvent(event);
  await rt.repos.calendar.saveSync({ calendar_id: 'original-cal', channel: 'feishu', window_start: event.start_time, window_end: event.end_time, complete: true });
  await rt.repos.digests.insertPlan({ id: 'prep', kind: 'meeting_prep', title: '准备', schedule_id: 'native-prep', session_id: 'access', schedule_spec: { eventId: 'meeting', eventStart: event.start_time.toISOString(), eventFingerprint: eventFingerprint(event), scope: { memo: false, memory: false, tasks: false, minutes: false } }, status: 'active', last_window: null, voice: false, skill: 'meeting-prep' });
  await rt.repos.workItems.insert({ id: 'work', role: 'calendar', title: '准备', instruction: '准备', origin: 'feishu', parent_session_id: 'access', child_session_id: 'work', delivery: 'feishu:owner', status: 'running' });
});
afterEach(async () => { await rt?.stop(); await rm(root, { recursive: true, force: true }); });
const build = () => rt.work({ action: 'meeting_prep_build', planId: 'prep' }, { id: 'work' });
it('来源观察不完整时准备包不发布；完整同步后可重试同一计划', async () => {
  await rt.repos.calendar.saveSync({ calendar_id: 'original-cal', channel: 'feishu', window_start: event.start_time, window_end: event.end_time, complete: false, lastError: 'partial remote response' });
  expect(await build()).toMatchObject({ skipped: 'source_unknown' }); expect(await rt.repos.outbox.recent()).toHaveLength(0);
  expect((await rt.repos.digests.getPlan('prep')).schedule_id).toBe('native-prep'); expect(deletes).toHaveLength(0);
  await observeCalendar(rt.repos.calendar, async () => {}, { calendarId: 'original-cal', channel: 'feishu', from: event.start_time, to: event.end_time }, async () => [event]);
  expect(await build()).toMatchObject({ eventId: 'meeting' }); expect(await rt.repos.outbox.recent()).toHaveLength(1);
});
for (const change of ['canceled', 'moved']) it(`来源 ${change} 停止计划时保留删除失败的原生编号`, async () => {
  await rt.repos.calendar.upsertEvent({ ...event, ...(change === 'canceled' ? { status: 'canceled' } : { start_time: new Date('2026-10-20T01:30:00Z') }) });
  expect(await build()).toMatchObject({ skipped: change === 'canceled' ? 'meeting_gone' : 'meeting_moved', nativeWarning: expect.stringContaining('native offline') });
  const plan = await rt.repos.digests.getPlan('prep'); expect(plan.status).toBe('stopped'); expect(plan.schedule_id).toBe('native-prep'); expect(plan.lifecycle.operation).toBe('delete');
  expect(deletes).toEqual(['native-prep']); expect(await rt.repos.outbox.recent()).toHaveLength(0);
});
it('跨日事件由今日完整观察确认后可生成准备包', async () => {
  event.end_time = new Date('2026-10-21T02:00:00Z');
  await rt.repos.digests.updatePlan('prep', { schedule_spec: { eventId: 'meeting', eventStart: event.start_time.toISOString(), eventFingerprint: eventFingerprint(event), scope: { memo: false, memory: false, tasks: false, minutes: false } } });
  await observeCalendar(rt.repos.calendar, async () => {}, { calendarId: 'original-cal', channel: 'feishu', from: new Date('2026-10-20T00:00:00Z'), to: new Date('2026-10-21T00:00:00Z') }, async () => [event]);
  expect(await rt.sourceVerdict('calendar', 'meeting', eventFingerprint(event))).toEqual({ valid: true });
  expect(await build()).toMatchObject({ eventId: 'meeting' }); expect(await rt.repos.outbox.recent()).toHaveLength(1);
});

it('新建会议无同步记录时主动复查原渠道；当前偏好变更不改来源归属', async () => {
  await rt.db.query('delete from pa24.calendar_sync_state'); rt.config.calendarChannel = 'wecom';
  const calls = [];
  rt.syncCalendarWindow = async (calendarId, from, to, channel) => {
    calls.push({ calendarId, from, to, channel });
    return observeCalendar(rt.repos.calendar, async () => {}, { calendarId, channel, from, to }, async () => [event]);
  };
  expect(await build()).toMatchObject({ eventId: 'meeting' });
  expect(calls).toEqual([{ calendarId: 'original-cal', channel: 'feishu', from: event.start_time, to: event.end_time }]);
  expect(await rt.repos.outbox.recent()).toHaveLength(1);
});
it('旧版标题投影有创建回执佐证时保持原计划与指纹，真实改名仍停止计划', async () => {
  event.raw = { event_id: 'meeting', summary: '[24PA] 会' };
  await rt.repos.calendar.upsertEvent(event);
  await rt.repos.digests.updatePlan('prep', { schedule_spec: { eventId: 'meeting', eventStart: event.start_time.toISOString(), scope: { memo: false, memory: false, tasks: false, minutes: false } } });
  let remoteTitle = '[24PA] 会';
  rt.syncCalendarWindow = async (calendarId, from, to, channel) => observeCalendar(rt.repos.calendar,
    (...args) => rt.notifySourceChanged(...args), { calendarId, channel, from, to },
    async () => [{ ...event, summary: remoteTitle, raw: { event_id: 'meeting', summary: remoteTitle } }]);
  expect(await build()).toMatchObject({ eventId: 'meeting' });
  expect((await rt.repos.digests.getPlan('prep')).status).toBe('active'); expect(deletes).toHaveLength(0);
  expect(await rt.sourceVerdict('calendar', 'meeting', eventFingerprint(event))).toEqual({ valid: true });
  remoteTitle = '[24PA] 新会议主题'; await build();
  expect((await rt.repos.digests.getPlan('prep')).status).toBe('stopped'); expect(deletes).toEqual(['native-prep']);
  expect(await rt.repos.outbox.recent()).toHaveLength(1);
});


it('资料读取失败、成功空结果与未授权独立呈现，失败不冒充无资料', async () => {
  const plan = await rt.repos.digests.getPlan('prep');
  await rt.repos.digests.updatePlan('prep', { schedule_spec: { ...plan.schedule_spec, scope: { memo: true, minutes: true, tasks: true, memory: false } } });
  rt.repos.memos.search = async () => { throw new Error('memo offline'); };
  rt.repos.minutes.recent = async () => { throw new Error('minutes offline'); };
  const result = await build();
  expect(result.sources).toEqual({ 备忘: { status: 'failed', error: 'memo offline' }, 纪要: { status: 'failed', error: 'minutes offline' }, 记忆: { status: 'disabled' }, 任务: { status: 'ok' } });
  const report = (await rt.repos.outbox.recent())[0].content.text;
  expect(report).toContain('不能据此认定没有相关资料'); expect(report).toContain('未授权查询'); expect(report).not.toContain('未找到相关材料');
});

it.each([false, true])('只有关联纪要进入准备包，不兜底最近无关会议（有相关=%s）', async related => {
  event.summary = '季度评审会第二轮'; await rt.repos.calendar.upsertEvent(event);
  const plan = await rt.repos.digests.getPlan('prep');
  await rt.repos.digests.updatePlan('prep', { schedule_spec: { ...plan.schedule_spec, eventFingerprint: eventFingerprint(event), scope: { memo: false, minutes: true, tasks: false, memory: false } } });
  await rt.repos.minutes.insert({ id: 'unrelated', work_item_id: 'work', event_id: null, topic: '客户交接', memo_id: null, doc_url: null, candidates: [{ summary: '无关行动' }], status: 'draft' });
  if (related) await rt.repos.minutes.insert({ id: 'related', work_item_id: 'work', event_id: null, topic: '季度评审', memo_id: null, doc_url: 'https://example.test/minutes', candidates: [{ summary: '评审预算' }], status: 'draft' });
  expect(await build()).toMatchObject({ eventId: 'meeting', sources: { 纪要: { status: 'ok' } } });
  const report = (await rt.repos.outbox.recent())[0].content.text;
  expect(report).not.toContain('客户交接'); expect(report).not.toContain('无关行动');
  if (related) { expect(report).toContain('上次纪要「季度评审」'); expect(report).toContain('评审预算'); }
  else expect(report).toContain('未找到相关材料');
});
