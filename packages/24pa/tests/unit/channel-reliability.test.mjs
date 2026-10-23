import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, chmod, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { createRepos } from '../../lib/repo.js';
import { ExternalOperations } from '../../lib/external-operations.js';
import { ReminderRouter } from '../../lib/reminder-router.js';
import { OutboxDelivery } from '../../lib/outbox-delivery.js';
import { TaskLifecycle } from '../../lib/task-lifecycle.js';
import { FeishuChannels, mapRemoteEvent } from '../../lib/feishu-channels.js';
import { WecomChannels } from '../../lib/wecom-channels.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';

describe('渠道可靠性：真实账本与模块 interface', () => {
  let root, db, repos, operations, config, item, lark, wecom, deps, larkBin, wecomBin;
  const journal = async name => (await readFile(join(root, name), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const reopen = async () => {
    await db?.close();
    db = new SqliteDb(join(root, 'ledger.db'));
    await db.migrate();
    repos = createRepos(db);
    operations = new ExternalOperations(() => repos.operations);
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-channel-reliability-'));
    db = null;
    await reopen();
    config = { ...DEFAULT_CONFIG, mode: 'feishu', tasklistId: 'list-1', calendarId: 'cal-1', ownerOpenId: 'ou_owner', larkProfile: 'test' };
    item = { id: 'work-1', title: '测试事项', role: 'tasks', instruction: '测试', origin: 'local', parent_session_id: 'parent-1', delivery: 'local:parent-1', status: 'running' };
    await repos.workItems.insert(item);
    const cli = async (name, variable) => {
      const wrapper = join(root, name);
      // An isolated child environment; no test mutates process.env.
      await writeFile(wrapper, `#!/usr/bin/env node\nprocess.env.${variable}=${JSON.stringify(join(root, name + '.json'))};\nawait import(${JSON.stringify(resolve('tests/helpers/stub-' + name + '.mjs'))});\n`);
      await chmod(wrapper, 0o755);
      await writeFile(join(root, name + '.json'), JSON.stringify({ ownerOpenId: 'ou_owner' }));
      return wrapper;
    };
    larkBin = await cli('lark-cli', 'PA24_LARK_STUB_STATE');
    wecomBin = await cli('wecom-cli', 'PA24_WECOM_STUB_STATE');
    deps = bin => ({
      repos: () => repos, config: () => config, cli: () => ({ bin, timeoutMs: 5000 }),
      notifyOwner: async () => {}, notifySourceChanged: async () => {}, linkedEventIdsInWindow: async () => [],
      gate: (_key, work) => work(), memory: () => null, isClosed: () => false,
      stagedOperation: (...args) => operations.stage(...args),
      stagedOperationWithId: (...args) => operations.stageWithId(...args),
      performExternal: (...args) => operations.perform(...args), failStaged: (...args) => operations.fail(...args),
    });
    lark = new FeishuChannels(deps(larkBin));
    wecom = new WecomChannels(deps(wecomBin));
  });
  afterEach(async () => { await db?.close(); await rm(root, { recursive: true, force: true }); });

  const setState = (cli, state) => writeFile(join(root, cli + '.json'), JSON.stringify(state));
  const callsFor = async (cli, command) => (await journal(cli + '.json.calls.jsonl')).filter(c => command.every((part, i) => c.args[i] === part));

  it('飞书 GUID 读取改名与截止，保留计划字段；自身标记不误报，坏观察不标新鲜', async () => {
    const changes = [];
    lark = new FeishuChannels({ ...deps(larkBin), notifySourceChanged: async (...args) => changes.push(args) });
    const created = await lark.taskCreate(item, { summary: '原名', due: '2026-11-01', plannedAt: '2026-11-01T02:00:00Z', estimateMinutes: 30 });
    let task = await lark.refreshTask(await repos.tasks.byGuid(created.guid));
    expect(task).toBeTruthy(); expect(changes).toHaveLength(0);
    const remote = { guid: task.task_guid, summary: '[24PA] 完全不同的标题', completed_at: '0', due: { timestamp: String(Date.parse('2026-11-03T06:30:00Z')), is_all_day: false } };
    await setState('lark-cli', { taskGetOverride: remote }); task = await lark.refreshTask(task);
    expect(task).toMatchObject({ summary: '完全不同的标题', due_has_time: true, planned_at: new Date('2026-11-01T02:00:00Z'), estimate_minutes: 30 });
    expect(task.due_at.toISOString()).toBe('2026-11-03T06:30:00.000Z'); expect(changes).toHaveLength(1);
    await setState('lark-cli', { taskGetOverride: { ...remote, completed_at: '1790000000000', due: null } });
    task = await lark.refreshTask(task); expect(task.status).toBe('completed'); expect(task.due_at).toBeNull(); expect(changes.at(-1)).toEqual(['task', task.task_guid, null]);
    await setState('lark-cli', { taskGetOverride: { ...remote, due: { timestamp: 'invalid', is_all_day: true } } });
    expect(await lark.refreshTask(task)).toBeNull(); expect((await repos.tasks.get(task.id)).last_synced_at).toEqual(task.last_synced_at);
    const calls = await journal('lark-cli.json.calls.jsonl'); expect(calls.some(c => c.args.includes('+search'))).toBe(false);
    expect(calls.filter(c => c.args.includes('--task-guid')).every(c => c.args[c.args.indexOf('--task-guid') + 1] === task.task_guid)).toBe(true);
  });

  it('企微按 ID 读取标题/日期/终态；未知状态或缺少目标不伪造已完成', async () => {
    const changes = [];
    wecom = new WecomChannels({ ...deps(wecomBin), notifySourceChanged: async (...args) => changes.push(args) });
    const created = await wecom.wecomTaskCreate(item, { summary: '原名', due: '2026-11-01' });
    let task = await wecom.refreshWecomTaskFromRemote(await repos.tasks.byGuid(created.guid)); expect(task).toBeTruthy(); expect(changes).toHaveLength(0);
    const remote = { todo_id: task.task_guid, success: true, title: '[24PA] 新标题', status: 'proceed', deadline: { type: 'date', value: '2026-11-03' } };
    await setState('wecom-cli', { todoGetOverride: [remote] }); task = await wecom.refreshWecomTaskFromRemote(task);
    expect(task).toMatchObject({ summary: '新标题', due_at: new Date('2026-11-03'), due_has_time: false }); expect(changes).toHaveLength(1);
    await setState('wecom-cli', { todoGetOverride: [{ ...remote, status: 'deleted' }] });
    task = await wecom.refreshWecomTaskFromRemote(task); expect(task.status).toBe('canceled'); expect(changes.at(-1)).toEqual(['task', task.task_guid, null]);
    for (const patch of [{ status: 'other' }, { todo_id: 'wrong' }, { success: false }, { deadline: { type: 'date', value: '2026-02-30' } }]) {
      await setState('wecom-cli', { todoGetOverride: [{ ...remote, ...patch }] });
      expect(await wecom.refreshWecomTaskFromRemote(task)).toBeNull(); expect((await repos.tasks.get(task.id)).status).toBe('canceled');
    }
  });

  it.each(['America/Los_Angeles', 'Asia/Shanghai', 'UTC'])('日期型截止在 %s 原日期往返；datetime 保留实际时刻', async timeZone => {
    config.timeZone = timeZone;
    for (const due of ['2026-03-08', '2026-11-01', '2026-11-01T18:30:00Z', undefined]) {
      const created = await wecom.wecomTaskCreate(item, { summary: '截止 ' + due, due });
      const task = await wecom.refreshWecomTaskFromRemote(await repos.tasks.byGuid(created.guid));
      expect(task).toBeTruthy(); expect(task.due_at).toEqual(due ? new Date(due) : null); expect(task.due_has_time).toBe(!!due?.includes('T'));
    }
    const calls = await callsFor('wecom-cli', ['todo', 'create']);
    const deadlines = calls.map(c => JSON.parse(c.args[c.args.indexOf('--items') + 1])[0].deadline);
    expect(deadlines.slice(0, 2)).toEqual([{ type: 'date', value: '2026-03-08' }, { type: 'date', value: '2026-11-01' }]); expect(deadlines[3]).toBeUndefined();
  });

  it('DST 重复小时保留已知 instant；远端新歧义/不存在时刻保持 stale', async () => {
    config.timeZone = 'America/Los_Angeles';
    const created = await wecom.wecomTaskCreate(item, { summary: 'DST 截止', due: '2026-11-01T09:30:00Z' });
    let task = await repos.tasks.byGuid(created.guid);
    task = await wecom.refreshWecomTaskFromRemote(task);
    expect(task.due_at.toISOString()).toBe('2026-11-01T09:30:00.000Z');
    const remote = { todo_id: task.task_guid, title: task.summary, success: true, status: 'proceed', deadline: { type: 'datetime', value: '2026-11-01 01:45:00' } };
    await setState('wecom-cli', { todoGetOverride: [remote] });
    expect(await wecom.refreshWecomTaskFromRemote(task)).toBeNull();
    await setState('wecom-cli', { todoGetOverride: [{ ...remote, deadline: { type: 'datetime', value: '2026-03-08 02:30:00' } }] });
    expect(await wecom.refreshWecomTaskFromRemote(task)).toBeNull();
    expect((await repos.tasks.get(task.id)).due_at).toEqual(task.due_at);
    config.timeZone = 'Australia/Lord_Howe';
    await setState('wecom-cli', { todoGetOverride: [{ ...remote, deadline: { type: 'datetime', value: '2026-04-05 01:45:00' } }] });
    expect(await wecom.refreshWecomTaskFromRemote(task)).toBeNull();
  });

  it('个人完成保持整项 open，重启重试不扩大授权；整项完成必须读回', async () => {
    const created = await wecom.wecomTaskCreate(item, { summary: '多人待办' }); const task = await repos.tasks.byGuid(created.guid);
    await setState('wecom-cli', { todoFinishPartial: true });
    expect(await wecom.wecomTaskFinish(item, task)).toMatchObject({ status: 'open', partial: true });
    await reopen(); expect(await wecom.wecomTaskFinish(item, await repos.tasks.byGuid(created.guid))).toMatchObject({ status: 'open', partial: true, reused: true });
    const calls = await callsFor('wecom-cli', ['todo', 'finish']); expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].args[calls[0].args.indexOf('--items') + 1])).toEqual([{ todo_id: task.task_guid }]);
    const remote = (await journal('wecom-cli.json.todos.jsonl')).at(-1);
    await appendFile(join(root, 'wecom-cli.json.todos.jsonl'), JSON.stringify({ ...remote, status: 'finished' }) + '\n');
    expect(await wecom.wecomTaskFinish(item, task)).toMatchObject({ status: 'completed', reused: true });
  });

  it.each([{ receipt: [] }, { receipt: [{ todo_id: 'other', success: true }] }, { receipt: [{ todo_id: 'tdstub-1' }] }])('无有效目标回执 %j 为 unknown，重复不能重发', async ({ receipt }) => {
    const created = await wecom.wecomTaskCreate(item, { summary: '待办' }); const task = await repos.tasks.byGuid(created.guid);
    await setState('wecom-cli', { todoFinishOverride: receipt });
    await expect(wecom.wecomTaskFinish(item, task)).rejects.toMatchObject({ outcome: 'unknown' });
    await expect(wecom.wecomTaskFinish(item, task)).rejects.toMatchObject({ outcome: 'unknown' });
    expect(await callsFor('wecom-cli', ['todo', 'finish'])).toHaveLength(1); expect((await repos.tasks.get(task.id)).status).toBe('open');
  });

  it('明确拒绝可安全重试；单参与人整项完成后再次调用不写入', async () => {
    const created = await wecom.wecomTaskCreate(item, { summary: '单人待办' }); const task = await repos.tasks.byGuid(created.guid);
    await setState('wecom-cli', { todoFinishOverride: [{ todo_id: task.task_guid, success: false, errmsg: '拒绝' }] });
    await expect(wecom.wecomTaskFinish(item, task)).rejects.toMatchObject({ outcome: 'failed' });
    await setState('wecom-cli', {});
    expect(await wecom.wecomTaskFinish(item, task)).toMatchObject({ status: 'completed', partial: false });
    expect(await wecom.wecomTaskFinish(item, task)).toMatchObject({ status: 'completed', reused: true });
    expect(await callsFor('wecom-cli', ['todo', 'finish'])).toHaveLength(2);
  });

  it('完成写入成功后读回失败，重启只补读回，不再发 finish', async () => {
    const created = await wecom.wecomTaskCreate(item, { summary: '核对失败' }); const task = await repos.tasks.byGuid(created.guid);
    const run = wecom.wecomRun.bind(wecom); let finished = false;
    wecom.wecomRun = async args => { const result = await run(args); if (args[1] === 'finish') finished = true; else if (finished && args[1] === 'get') throw new Error('read failed'); return result; };
    await expect(wecom.wecomTaskFinish(item, task)).rejects.toMatchObject({ outcome: 'unknown' });
    await reopen(); wecom = new WecomChannels(deps(wecomBin));
    expect(await wecom.wecomTaskFinish(item, await repos.tasks.byGuid(created.guid))).toMatchObject({ status: 'completed' });
    expect(await callsFor('wecom-cli', ['todo', 'finish'])).toHaveLength(1);
  });

  it('同进程显式检查刷新授权身份；并发检查共用一次，失败不沿用旧目标', async () => {
    await setState('wecom-cli', { ownerUserid: 'owner_A' }); expect((await wecom.wecomOwnerUserid()).userid).toBe('owner_A');
    await setState('wecom-cli', { ownerUserid: 'owner_B' });
    const results = await Promise.all(Array.from({ length: 12 }, () => wecom.wecomCheck()));
    expect(results.every(r => r.identity.userid === 'owner_B')).toBe(true); expect((await wecom.wecomOwnerUserid()).userid).toBe('owner_B');
    expect(await callsFor('wecom-cli', ['identity', 'whoami'])).toHaveLength(2);
    await setState('wecom-cli', { failNext: { command: 'whoami' } });
    expect((await wecom.wecomCheck()).identity.state).toBe('error'); await expect(wecom.wecomOwnerUserid()).rejects.toThrow(/解析失败/);
    await setState('wecom-cli', { ownerUserid: 'owner_C' }); expect((await wecom.wecomCheck()).identity.userid).toBe('owner_C');
  });

  it('检查失败后旧在途 whoami 不能重新填充缓存，下一次成功检查可恢复', async () => {
    const run = wecom.wecomRun.bind(wecom);
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    wecom.wecomRun = async args => {
      if (args[0] === 'identity') { await blocked; return { raw: { extra_identity_context: '授权真人用户身份：名字：旧主人 ID：owner_A' } }; }
      return run(args);
    };
    const old = wecom.wecomOwnerUserid();
    const oldFailure = expect(old).rejects.toThrow(/新的企微检查取代/);
    const original = await readFile(wecomBin, 'utf8');
    await writeFile(wecomBin, '#!/usr/bin/env node\nprocess.exit(1);\n');
    expect((await wecom.wecomCheck()).identity.state).toBe('missing');
    release(); await oldFailure;
    await expect(wecom.wecomOwnerUserid()).rejects.toThrow(/解析失败/);
    await writeFile(wecomBin, original); wecom.wecomRun = run;
    await setState('wecom-cli', { ownerUserid: 'owner_B' });
    expect((await wecom.wecomCheck()).identity.userid).toBe('owner_B');
  });

  it('远端回执跨重启保留：投影失败后只补本地，不再次执行', async () => {
    let writes = 0;
    const first = await operations.stage(item, 'test.create', 'one', {});
    const invoke = async () => ({ guid: `remote-${++writes}` });
    expect(await operations.perform(first.row.id, invoke)).toEqual({ guid: 'remote-1' });
    await operations.fail(first.row.id, new Error('local projection failed'));
    await reopen();
    const repair = await operations.stage(item, 'test.create', 'one', {});
    expect(await operations.perform(repair.row.id, invoke)).toEqual({ guid: 'remote-1' });
    expect(writes).toBe(1);
    await repos.operations.update(repair.row.id, { status: 'succeeded', receipt: { guid: 'remote-1' } });
    await operations.fail(repair.row.id, new Error('later local error'));
    expect((await operations.stage(item, 'test.create', 'one', {})).created).toBe(false);
  });

  it('同键并发只认领一次；无回执 running 跨重启也拒绝重发', async () => {
    const results = await Promise.allSettled([operations.stage(item, 'test.create', 'same', {}), operations.stage(item, 'test.create', 'same', {})]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    await reopen();
    await expect(operations.stage(item, 'test.create', 'same', {})).rejects.toThrow(/未知|执行/);
  });

  it('远端成功但回执写盘失败只能待核对，重启不会再次调用远端', async () => {
    const staged = await operations.stage(item, 'test.create', 'lost-ack', {});
    const update = repos.operations.update.bind(repos.operations);
    repos.operations.update = async (_id, patch) => {
      if (patch.receipt) throw new Error('receipt disk unavailable');
      return update(_id, patch);
    };
    let writes = 0;
    try { await operations.perform(staged.row.id, async () => ({ id: `remote-${++writes}` })); }
    catch (error) { await operations.fail(staged.row.id, error); }
    await reopen();
    await expect(operations.stage(item, 'test.create', 'lost-ack', {})).rejects.toThrow(/未知/);
    expect(writes).toBe(1);
  });

  it('无效信封与超时停在 unknown，明确拒绝允许下一次安全尝试', async () => {
    for (const outcome of ['unknown', 'invalid-envelope', 'failed']) {
      const staged = await operations.stage(item, outcome, 'key', {});
      try { await operations.perform(staged.row.id, async () => { throw Object.assign(new Error(outcome), { outcome }); }); }
      catch (error) { await operations.fail(staged.row.id, error); }
      if (outcome === 'failed') expect((await operations.stage(item, outcome, 'key', {})).created).toBe(true);
      else await expect(operations.stage(item, outcome, 'key', {})).rejects.toThrow(/未知/);
    }
  });

  it('企微无幂等键：创建成功后任务投影失败，重试仍只有一个远端对象', async () => {
    const save = repos.tasks.save.bind(repos.tasks);
    let fail = true;
    repos.tasks.save = async row => { if (fail) { fail = false; throw new Error('disk failure'); } return save(row); };
    await expect(wecom.wecomTaskCreate(item, { summary: '真实待办' })).rejects.toThrow('disk failure');
    await reopen();
    const result = await wecom.wecomTaskCreate(item, { summary: '真实待办' });
    expect(result.guid).toBeTruthy();
    expect(await journal('wecom-cli.json.todos.jsonl')).toHaveLength(1);
    expect((await repos.tasks.list())[0].channel).toBe('wecom');
  });

  it('飞书日程创建成功后投影失败，凭回执补账而不重复创建', async () => {
    const upsert = repos.calendar.upsertEvent.bind(repos.calendar);
    let fail = true;
    repos.calendar.upsertEvent = async row => { if (fail) { fail = false; throw new Error('projection failed'); } return upsert(row); };
    const args = { summary: '会议', start: '2026-10-21T01:00:00Z', end: '2026-10-21T02:00:00Z' };
    await expect(lark.calendarWrite(item, 'create', args)).rejects.toThrow('projection failed');
    await reopen();
    const result = await lark.calendarWrite(item, 'create', args);
    expect(result.eventId).toBeTruthy();
    expect(await journal('lark-cli.json.events.jsonl')).toHaveLength(1);
  });

  it('飞书创建回执与后续观察使用同一真实标题，不把自身前缀误判为来源变更', async () => {
    const args = { summary: '会议', start: '2026-10-21T01:00:00Z', end: '2026-10-21T02:00:00Z' };
    const created = await lark.calendarWrite(item, 'create', args);
    const before = await repos.calendar.findEvent(created.eventId); expect(before.summary).toBe('[24PA] 会议');
    const changes = []; const channel = new FeishuChannels({ ...deps(larkBin), notifySourceChanged: async (...args) => { changes.push(args); } });
    expect((await channel.syncCalendarWindow('cal-1', new Date(args.start), new Date(args.end))).ok).toBe(true);
    expect(changes).toHaveLength(0); expect((await repos.calendar.findEvent(created.eventId)).summary).toBe(before.summary);
  });

  it('原生日历结构化回执时间优先于请求精度，后续同步不误判改期', async () => {
    const args = { summary: '会议', start: '2026-10-21T01:00:00.987Z', end: '2026-10-21T02:00:00.987Z', timeZone: 'Asia/Shanghai' };
    const channel = new FeishuChannels({ ...deps(larkBin), performExternal: async () => ({ data: { event: { event_id: 'native-time', summary: '[24PA] 会议', start_time: { timestamp: String(Math.floor(Date.parse(args.start) / 1000)), timezone: 'Asia/Shanghai' }, end_time: { timestamp: String(Math.floor(Date.parse(args.end) / 1000)), timezone: 'Asia/Shanghai' } } } }) });
    await channel.calendarWrite(item, 'create', args);
    expect((await repos.calendar.findEvent('native-time')).start_time.toISOString()).toBe('2026-10-21T01:00:00.000Z');
  });

  it('原生回执全天结束日保持半开边界，改标题不把一天扩大成两天', async () => {
    await repos.calendar.upsertEvent({ event_id: 'native-all-day', calendar_id: 'cal-1', channel: 'feishu', summary: '全天会', start_time: new Date('2026-10-20T16:00:00Z'), end_time: new Date('2026-10-21T16:00:00Z'), is_all_day: true, timezone: 'Asia/Shanghai', status: 'active', recurring: false, attendees: null, url: null, raw: {} });
    const channel = new FeishuChannels({ ...deps(larkBin), performExternal: async () => ({ data: { event: { event_id: 'native-all-day', summary: '[24PA] 新主题', start_time: { date: '2026-10-21' }, end_time: { date: '2026-10-22' } } } }) });
    await channel.calendarWrite(item, 'update', { eventId: 'native-all-day', summary: '新主题' });
    const event = await repos.calendar.findEvent('native-all-day');
    expect(event.end_time - event.start_time).toBe(86400000); expect(event.is_all_day).toBe(true);
    expect(event.end_time.toISOString()).toBe('2026-10-21T16:00:00.000Z');
  });

  it('计划投入与估时修改有独立操作身份，并且不调用空的远端 update', async () => {
    const created = await lark.taskCreate(item, { summary: '写报告' });
    await lark.taskUpdate(item, { guid: created.guid, estimateMinutes: 20 });
    await lark.taskUpdate(item, { guid: created.guid, estimateMinutes: 35 });
    const plannedAt = '2026-10-22T03:00:00Z';
    await lark.taskUpdate(item, { guid: created.guid, plannedAt });
    await lark.taskUpdate(item, { guid: created.guid, plannedAt: null });
    const row = await repos.tasks.byGuid(created.guid);
    expect(row.estimate_minutes).toBe(35);
    expect(row.planned_at).toBeNull();
    const calls = await journal('lark-cli.json.calls.jsonl');
    expect(calls.filter(call => JSON.stringify(call).includes('+update'))).toHaveLength(0);
  });

  it('任务远端修改成功后来源通知失败，只补本地通知、不重复远端修改', async () => {
    const created = await lark.taskCreate(item, { summary: '修改前' });
    let notifications = 0;
    const channel = new FeishuChannels({ ...deps(larkBin), notifySourceChanged: async () => { if (++notifications === 1) throw new Error('notification failed'); } });
    const args = { guid: created.guid, summary: '修改后' };
    await expect(channel.taskUpdate(item, args)).rejects.toThrow('notification failed');
    await channel.taskUpdate(item, args);
    const calls = await journal('lark-cli.json.calls.jsonl');
    expect(calls.filter(call => JSON.stringify(call).includes('+update'))).toHaveLength(1);
    expect(notifications).toBe(2);
    expect((await repos.tasks.byGuid(created.guid)).summary).toBe('修改后');
  });

  it('当前渠道切换只改变新建，已有对象的查看/修改/完成/删除仍走自身 channel', async () => {
    const calls = [];
    const adapter = channel => ({
      create: async () => { calls.push(`${channel}:create`); },
      update: async () => { calls.push(`${channel}:update`); },
      complete: async () => { calls.push(`${channel}:complete`); },
      refresh: async task => { calls.push(`${channel}:refresh`); return task; },
      cancel: async () => { calls.push(`${channel}:cancel`); },
    });
    const created = await lark.taskCreate(item, { summary: '原飞书任务' });
    config.todoChannel = 'wecom';
    const lifecycle = new TaskLifecycle({ repo: () => repos.tasks, createChannel: () => config.todoChannel, adapters: { feishu: adapter('feishu'), wecom: adapter('wecom') } });
    await lifecycle.create(item, { summary: '新任务' });
    expect((await lifecycle.get({ guid: created.guid })).stale).toBe(false);
    await lifecycle.update(item, { guid: created.guid, summary: '修改' });
    await lifecycle.complete(item, { guid: created.guid });
    await lifecycle.cancel(item, { guid: created.guid, reason: '本人取消' });
    expect(calls).toEqual(['wecom:create', 'feishu:refresh', 'feishu:update', 'feishu:complete', 'feishu:cancel']);
  });

  it('相对提醒备份失败跨重启仍沿用原时间、渠道与操作身份', async () => {
    const dispatches = [];
    const router = () => new ReminderRouter({ config: () => config, repos: () => repos, channelsLive: () => true,
      calendarWrite: async (work, kind, args, id) => { dispatches.push({ kind, args, id }); return lark.calendarWrite(work, kind, args, id); },
      ledger: () => ({ setStatus: (id, status) => repos.reminders.updateRule(id, { status }) }),
    });
    repos.reminders.insertRule = async () => { throw new Error('backup unavailable'); };
    const args = { kind: 'once', afterSeconds: 60, text: '喝水' };
    await expect(router().route(item, args)).rejects.toThrow('backup unavailable');
    await new Promise(resolve => setTimeout(resolve, 20));
    await reopen(); config.calendarChannel = 'wecom'; config.calendarId = 'new-cal';
    const result = await router().route(item, args);
    expect(await journal('lark-cli.json.events.jsonl')).toHaveLength(1);
    expect(dispatches[1].args.start).toBe(dispatches[0].args.start);
    expect(dispatches[1].args).toMatchObject({ channel: 'feishu', calendarId: 'cal-1' });
    expect(dispatches[1].id).toBeTruthy(); expect(dispatches[1].id).toBe(dispatches[0].id);
    const repeated = await router().route(item, args); expect(repeated.ruleId).toBe(result.ruleId);
    await router().cancel(item, result.ruleId, '取消');
    expect(dispatches.at(-1).args).toMatchObject({ channel: 'feishu', calendarId: 'cal-1', eventId: result.eventId });
    expect(await repos.reminders.listRules()).toHaveLength(1);
  });

  it('飞书提醒原生创建携带 IANA 时区、重复规则、五分钟偏移与稳定幂等键', async () => {
    const args = { summary: '喝水', start: '2026-10-21T13:00:00Z', end: '2026-10-21T13:15:00Z', timeZone: 'America/New_York', rrule: 'FREQ=DAILY' };
    await lark.calendarWrite(item, 'create', args);
    const calls = await journal('lark-cli.json.calls.jsonl');
    const call = calls.find(call => call.args.includes('--data'))?.args; expect(call).toBeTruthy();
    const data = JSON.parse(call[call.indexOf('--data') + 1]);
    expect(data).toMatchObject({ start_time: { timezone: 'America/New_York', timestamp: String(Date.parse(args.start) / 1000) }, end_time: { timezone: 'America/New_York' }, recurrence: 'FREQ=DAILY', reminders: [{ minutes: 5 }] });
    expect(call[call.indexOf('--idempotency-key') + 1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await expect(lark.calendarWrite(item, 'create', { ...args, attendees: ['ou_guest'] })).rejects.toThrow('本次未创建');
    expect(await journal('lark-cli.json.events.jsonl')).toHaveLength(1);
  });

  it('企微周期提醒明确传递重复规则、时区与五分钟提醒，未知规则先拒绝', async () => {
    const calls = []; wecom.wecomRun = async args => { calls.push(args); return { data: { schedule_id: 'weekly-event' } }; };
    const args = { summary: '喝水', start: '2026-10-21T01:00:00Z', end: '2026-10-21T01:15:00Z', timeZone: 'Asia/Tokyo', rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' };
    await wecom.wecomCalendarWrite(item, 'create', args);
    const option = flag => JSON.parse(calls[0][calls[0].indexOf(flag) + 1]);
    expect(option('--repeat-rule')).toMatchObject({ is_repeat: true, is_custom: true, repeat_type: 'weekly', repeat_day_of_week: ['MO', 'WE', 'FR'] });
    expect(option('--timezone')).toEqual({ timezone_id: 'Asia/Tokyo' });
    expect(option('--reminders')).toEqual({ is_remind: true, reminder_time: [-300] });
    expect((await repos.calendar.findEvent('weekly-event')).recurring).toBe(true);
    await expect(wecom.wecomCalendarWrite(item, 'create', { ...args, rrule: 'FREQ=MONTHLY' })).rejects.toThrow(/不支持/);
    expect(calls).toHaveLength(1);
  });

  const projected = (id, calendar = 'cal-1', channel = 'feishu') => ({ event_id: id, calendar_id: calendar, channel, summary: id, start_time: new Date('2026-10-21T01:00:00Z'), end_time: new Date('2026-10-21T02:00:00Z'), is_all_day: false, timezone: 'Asia/Shanghai', status: 'active', recurring: false, attendees: [], url: null, raw: {} });
  const window = () => [new Date('2026-10-20T16:00:00Z'), new Date('2026-10-21T16:00:00Z')];
  it('同步只裁决原渠道与日历内的来源，空窗口也通知无提醒规则的会前计划来源', async () => {
    for (const row of [projected('own'), projected('other-calendar', 'cal-2'), projected('other-channel', 'wecom', 'wecom')]) await repos.calendar.upsertEvent(row);
    const notified = [];
    const channel = new FeishuChannels({ ...deps(larkBin), notifySourceChanged: async (_, id, fp) => { notified.push([id, fp]); }, linkedEventIdsInWindow: (...args) => repos.reminders.linkedEventIdsInWindow(...args) });
    expect(await channel.syncCalendarWindow('cal-1', ...window())).toEqual({ ok: true });
    expect(notified).toEqual([['own', null]]);
    expect((await repos.calendar.findEvent('other-calendar')).status).toBe('active');
    expect((await repos.calendar.findEvent('other-channel')).status).toBe('active');
    const calls = await journal('lark-cli.json.calls.jsonl');
    expect(JSON.stringify(calls)).toContain('2026-10-20T16:00:00.000Z');
  });
  it('飞书嵌套时间、全天包含式结束日与空标题保留；坏条目令整个观察不完整', async () => {
    const mapped = mapRemoteEvent({ event_id: 'all-day', summary: '', start_time: { date: '2026-10-21' }, end_time: { date: '2026-10-21' } }, 'Asia/Shanghai');
    expect(mapped?.start.toISOString()).toBe('2026-10-20T16:00:00.000Z');
    expect(mapped?.end.toISOString()).toBe('2026-10-21T16:00:00.000Z'); expect(mapped?.isAllDay).toBe(true);
    await repos.calendar.upsertEvent(projected('preserved'));
    await writeFile(join(root, 'lark-cli.json'), JSON.stringify({ agendaOverride: [{ event_id: 'broken', start_time: { datetime: 'bad' }, end_time: { datetime: 'bad' } }] }));
    expect((await lark.syncCalendarWindow('cal-1', ...window())).ok).toBe(false);
    expect((await repos.calendar.findEvent('preserved')).status).toBe('active');
    expect((await repos.calendar.getSync('cal-1')).complete).toBe(false);
  });
  it('来源通知失败可重试且未发布完整观察，跨归属同ID不能覆盖旧事件', async () => {
    await repos.calendar.upsertEvent(projected('preserved')); let count = 0;
    const channel = new FeishuChannels({ ...deps(larkBin), notifySourceChanged: async () => { if (++count === 1) throw new Error('notify failed'); } });
    expect((await channel.syncCalendarWindow('cal-1', ...window())).ok).toBe(false);
    expect((await repos.calendar.getSync('cal-1')).complete).toBe(false);
    expect((await channel.syncCalendarWindow('cal-1', ...window())).ok).toBe(true); expect(count).toBe(2);
    await expect(repos.calendar.upsertEvent(projected('preserved', 'wecom', 'wecom'))).rejects.toThrow(/归属/);
    expect((await repos.calendar.findEvent('preserved')).calendar_id).toBe('cal-1');
  });
  it('同步状态的日历ID跨渠道碰撞不能报告成功或覆盖原渠道新鲜度', async () => {
    await repos.calendar.saveSync({ calendar_id: 'cal-1', channel: 'wecom', window_start: window()[0], window_end: window()[1], complete: true });
    expect((await lark.syncCalendarWindow('cal-1', ...window())).ok).toBe(false);
    expect((await repos.calendar.getSync('cal-1')).channel).toBe('wecom');
  });
  it('企微只接受覆盖窗口且数量完整的观察，越界和缺行不能宣告来源删除', async () => {
    const from = new Date(Date.now() - 3600000), to = new Date(Date.now() + 3600000);
    let calls = 0; wecom.wecomRun = async () => { calls++; return { data: { schedule_list: [], schedule_list_count: 1 } }; };
    expect((await wecom.syncWecomCalendarWindow(from, to)).ok).toBe(false);
    wecom.wecomRun = async () => { calls++; return { data: { schedule_list: [], schedule_list_count: 0 } }; };
    expect((await wecom.syncWecomCalendarWindow(new Date(Date.now() - 40 * 86400000), to)).ok).toBe(false);
    expect(calls).toBe(1);
    expect((await wecom.syncWecomCalendarWindow(from, to)).ok).toBe(true);
  });

  const delivery = (send, routes = () => repos.messageRoutes, extra = {}) => new OutboxDelivery({
    repo: () => repos.outbox, routes, sent: () => {},
    adapters: { feishu: { available: () => true, supports: () => true, send }, ...extra },
  });
  const enqueue = (dedupKey = 'workitem:work-1:result:t1', channel = 'feishu') => repos.outbox.enqueue({ dedupKey, channel, target: 'original-owner', kind: 'text', content: { text: '已完成' } });

  it('健康证据保存失败不覆盖已持久的送达回执，也不阻断回复关联', async () => {
    await enqueue(); let sends = 0;
    const worker = new OutboxDelivery({ repo: () => repos.outbox, routes: () => repos.messageRoutes,
      sent: async () => { throw Error('health evidence unavailable'); },
      adapters: { feishu: { available: () => true, supports: () => true, send: async () => ({ messageId: 'remote-' + ++sends }) } } });
    await worker.drain(); await worker.drain();
    expect((await repos.outbox.recent())[0]).toMatchObject({ status: 'sent', message_id: 'remote-1' });
    expect((await repos.messageRoutes.lookup('remote-1')).work_item_id).toBe('work-1');
    expect(sends).toBe(1);
  });

  it('发送成功后回复关联失败：重启只补路由，不重新发送', async () => {
    let sends = 0;
    const row = (await enqueue()).row;
    const sender = async () => ({ messageId: `remote-${++sends}` });
    await delivery(sender, () => ({ record: async () => { throw new Error('route disk failure'); } })).drain();
    let stored = (await repos.outbox.recent())[0];
    expect(stored).toMatchObject({ status: 'pending', message_id: 'remote-1' });
    await reopen();
    await repos.outbox.mark(row.id, { status: 'pending', retryInMs: 0 });
    await delivery(sender).drain();
    stored = (await repos.outbox.recent())[0];
    expect(stored.status).toBe('sent');
    expect(sends).toBe(1);
    expect((await repos.messageRoutes.lookup('remote-1')).work_item_id).toBe('work-1');
  });

  it('重启将无回执 sending 停在 unknown；有回执只补路由', async () => {
    const a = (await enqueue('workitem:work-1:result:t1')).row;
    const b = (await enqueue('workitem:work-1:result:t2')).row;
    await repos.outbox.claim(5);
    await repos.outbox.mark(b.id, { status: 'sending', messageId: 'confirmed-before-crash' });
    await reopen();
    let sends = 0;
    const worker = delivery(async () => { sends++; return { messageId: 'unexpected' }; });
    await worker.recover();
    await worker.drain();
    const rows = await repos.outbox.recent();
    expect(rows.find(r => r.id === a.id).status).toBe('unknown');
    expect(rows.find(r => r.id === b.id).status).toBe('sent');
    expect(sends).toBe(0);
  });

  it('发送结果未知不会再次发出；并发 drain 共用一次认领', async () => {
    await enqueue();
    let sends = 0;
    const worker = delivery(async () => { sends++; throw Object.assign(new Error('response lost'), { outcome: 'unknown' }); });
    await Promise.all([worker.drain(), worker.drain()]);
    await worker.drain();
    expect((await repos.outbox.recent())[0].status).toBe('unknown');
    expect(sends).toBe(1);
  });

  it('普通传输异常没有未发送证据时按 unknown 处理', async () => {
    await enqueue();
    let sends = 0;
    const worker = delivery(async () => { sends++; throw new Error('connection reset after dispatch'); });
    await worker.drain();
    await worker.drain();
    expect((await repos.outbox.recent())[0].status).toBe('unknown');
    expect(sends).toBe(1);
  });

  it('明确未发送的失败有界重试，三次后停止', async () => {
    const row = (await enqueue()).row;
    let sends = 0;
    const worker = delivery(async () => { sends++; throw Object.assign(new Error('platform rejected'), { outcome: 'failed' }); });
    await worker.drain();
    await repos.outbox.mark(row.id, { status: 'pending', retryInMs: 0 });
    await worker.drain();
    await repos.outbox.mark(row.id, { status: 'pending', retryInMs: 0 });
    await worker.drain();
    await worker.drain();
    expect((await repos.outbox.recent())[0].status).toBe('failed');
    expect(sends).toBe(3);
  });

  it('切换工作区前 pause 等待在途结束，且阻止新一轮认领', async () => {
    await enqueue();
    let release, started;
    const entered = new Promise(resolve => { started = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const worker = delivery(async () => { started(); await blocked; return { messageId: 'old-workspace-message' }; });
    const sending = worker.drain();
    await entered;
    let paused = false;
    const stopping = worker.pause().then(() => { paused = true; });
    await enqueue('workitem:work-1:result:t2');
    await worker.drain();
    expect(paused).toBe(false);
    release();
    await Promise.all([sending, stopping]);
    expect((await repos.outbox.recent()).map(row => row.status)).toEqual(['pending', 'sent']);
    worker.resume();
    await worker.drain();
    expect((await repos.outbox.recent()).every(row => row.status === 'sent')).toBe(true);
  });

  it('本地结果保持原目标与每回合稳定key，不登记飞书回复路由', async () => {
    const row = (await enqueue('workitem:work-1:result:t7', 'local')).row;
    const received = [];
    const worker = delivery(async () => { throw new Error('wrong channel'); }, () => ({ record: async () => { throw new Error('wrong route'); } }), {
      local: { available: () => true, supports: () => true, send: async row => { received.push([row.target, row.dedup_key]); return { messageId: `local:${row.dedup_key}` }; } },
    });
    await worker.drain();
    expect(received).toEqual([['original-owner', row.dedup_key]]);
    expect((await repos.outbox.recent())[0].status).toBe('sent');
  });
});
