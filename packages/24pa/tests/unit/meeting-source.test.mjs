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
