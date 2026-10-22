import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, join, readFile, writeFile } from '../helpers/runtime.mjs';
import { FakeFeishuTransport } from '../../lib/feishu.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const storage of ['sqlite', 'postgres']) describe(`candidate recovery / ${storage}`, () => {
  let cluster, f, config;
  beforeAll(async () => { if (storage === 'postgres') cluster = await startPgCluster(); });
  afterEach(async () => { await f?.cleanup(); f = null; });
  afterAll(async () => { await cluster?.stop(); });
  async function setup(channel) {
    if (cluster) await cluster.query('drop schema if exists pa24 cascade');
    f = await fixture({ cliTimeoutMs: 10000, env: cluster ? { PA24_PG_DSN: cluster.dsn } : {} });
    for (const [name, variable] of [['lark', 'PA24_LARK_STUB_STATE'], ['wecom', 'PA24_WECOM_STUB_STATE']]) {
      const state = join(f.root, name + '.json'), bin = join(f.root, name + '-cli');
      await writeFile(state, JSON.stringify({ ownerOpenId: 'owner' }));
      await writeFile(bin, '#!/usr/bin/env node\nprocess.env.' + variable + '=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-' + name + '-cli.mjs')) + ');\n');
      await chmod(bin, 0o755); f.options[name + 'CliBin'] = bin;
    }
    config = { storage, mode: 'feishu', ownerOpenId: 'owner', tasklistId: 'original-list', calendarId: 'original-calendar', folderToken: 'folder',
      todoChannel: channel, calendarChannel: channel, maxWorkers: 8, enabledWorkers: ['memo', 'handwriting'], workerModels: { handwriting: { provider: 'test', model: 'vision-test' } } };
    f.path = await f.workspace('a', config); await f.rt.bind(f.path);
    f.rt.transport = new FakeFeishuTransport('test'); f.parent = f.agents.get(await f.rt.openLocalSession());
  }
  const worker = async () => ({ id: (await f.rt.delegate({ worker: 'memo', title: '采纳', instruction: '本人授权采纳' }, f.parent)).workId });
  const journal = async (channel, kind) => {
    const name = channel === 'feishu' ? 'lark' : 'wecom';
    const suffix = channel === 'feishu' ? (kind === 'task' ? 'tasks' : 'events') : (kind === 'task' ? 'todos' : 'schedules');
    return (await readFile(join(f.root, `${name}.json.${suffix}.jsonl`), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(JSON.parse);
  };
  async function blockProjection(kind) {
    const table = kind === 'task' ? 'task' : 'calendar_event';
    if (storage === 'sqlite') {
      await f.rt.db.query(`create trigger candidate_fault before insert on pa24_${table} begin select raise(abort, 'CANDIDATE_SQL_DOWN'); end`);
      return () => f.rt.db.query('drop trigger candidate_fault');
    }
    await f.rt.db.query("create function pa24.candidate_fault() returns trigger language plpgsql as $$ begin raise exception 'CANDIDATE_SQL_DOWN'; end $$");
    await f.rt.db.query(`create trigger candidate_fault before insert on pa24.${table} for each row execute function pa24.candidate_fault()`);
    return async () => { await f.rt.db.query(`drop trigger candidate_fault on pa24.${table}`); await f.rt.db.query('drop function pa24.candidate_fault()'); };
  }
  async function restart(channel) {
    await f.rt.stop(); config = { ...config, todoChannel: channel, calendarChannel: channel, tasklistId: 'new-list', calendarId: 'new-calendar', timeZone: 'UTC' };
    await f.workspace('a', config); f.rt = f.make(); await f.rt.bind(f.path); f.rt.transport = new FakeFeishuTransport('test'); f.parent = f.agents.get(await f.rt.openLocalSession());
  }
  it.each(['feishu:task', 'wecom:task', 'feishu:calendar', 'wecom:calendar', 'feishu:task:container', 'feishu:calendar:container'])('%s preserves original receipt, target and owner after restart', async mode => {
    const [channel, kind, container] = mode.split(':'), other = container ? channel : channel === 'feishu' ? 'wecom' : 'feishu'; await setup(channel); const child = await worker();
    const built = await f.rt.work({ action: 'minutes_build', topic: '采纳恢复', content: '本人记录', candidates: [{ summary: '联系王工' }, { summary: '新的行动' }].map(row => ({ ...row, ...(kind === 'calendar' ? { start: '2026-11-01T02:00:00Z', end: '2026-11-01T03:00:00Z' } : { due: '2026-11-02' }) })) }, child);
    const action = { action: 'minutes_adopt_actions', minutesId: built.minutesId, indexes: [0], instruction: '本人批准第一项' };
    const remove = await blockProjection(kind);
    const failed = await f.rt.work(action, child); expect(failed.failed).toBe(1); expect(failed.results[0].error).toContain('CANDIDATE_SQL_DOWN');
    await remove(); const id = `minutes.action:${built.minutesId}:0`, original = await f.rt.repos.operations.get(id);
    expect(original.receipt._externalResult).toBeTruthy(); expect(await journal(channel, kind)).toHaveLength(1);
    await restart(other); const next = await worker(), repaired = await f.rt.work({ ...action, instruction: '恢复第一项' }, next);
    expect(repaired).toMatchObject({ executed: 1, failed: 0 });
    const remote = (await journal(channel, kind))[0], externalId = remote.guid ?? remote.todo_id ?? remote.event_id ?? remote.schedule_id;
    const projected = kind === 'task' ? await f.rt.repos.tasks.get(id) : await f.rt.repos.calendar.findEvent(externalId);
    expect(projected).toMatchObject(kind === 'task' ? { task_guid: externalId, channel, work_item_id: child.id } : { event_id: externalId, channel, calendar_id: channel === 'feishu' ? 'original-calendar' : 'wecom' });
    expect(projected.summary).toContain('联系王工');
    expect(repaired.results[0][kind === 'task' ? 'guid' : 'eventId']).toBe(externalId); expect(repaired.results[0].message).toContain(channel === 'feishu' ? '飞书' : '企微');
    if (!container) expect(await journal(other, kind)).toHaveLength(0); expect(await journal(channel, kind)).toHaveLength(1);
    expect((await f.rt.repos.operations.get(id)).params).toEqual(original.params);
    expect(await f.rt.work({ ...action, indexes: [1] }, next)).toMatchObject({ executed: 1, failed: 0 });
    expect(await journal(other, kind)).toHaveLength(container ? 2 : 1);
  });
  it.each(['missing-target', 'unknown-format', 'foreign-source', 'wrong-action', 'unknown-result', 'bad-receipt', 'legacy'])('%s does not guess a candidate identity or replay an unknown write', async fault => {
    await setup('feishu'); const child = await worker();
    const built = await f.rt.work({ action: 'minutes_build', topic: '核对', content: '本人记录', candidates: [{ summary: '联系王工' }] }, child);
    const action = { action: 'minutes_adopt_actions', minutesId: built.minutesId, indexes: [0], instruction: '本人采纳' };
    const remove = await blockProjection('task'); expect((await f.rt.work(action, child)).failed).toBe(1); await remove();
    const id = `minutes.action:${built.minutesId}:0`, row = await f.rt.repos.operations.get(id);
    if (fault === 'missing-target') delete row.params.tasklistId;
    if (fault === 'unknown-format') row.params.receiptFormat = 'future-v99';
    if (fault === 'foreign-source') row.params.minutesId = 'someone-else';
    if (fault === 'legacy') { delete row.params.receiptFormat; delete row.params.channel; }
    if (fault === 'unknown-result') { row.status = 'unknown'; row.receipt = {}; }
    if (fault === 'bad-receipt') row.receipt._externalResult = { data: { task: { guid: { nested: 'not-an-id' } } } };
    await f.rt.db.query('update pa24.action_operation set params = $2, action = $3, status = $4, receipt = $5 where id = $1',
      [id, JSON.stringify(row.params), fault === 'wrong-action' ? 'outreach.send' : row.action, row.status, JSON.stringify(row.receipt)]);
    await restart('wecom'); const result = await f.rt.work(action, await worker());
    expect(result).toMatchObject(fault === 'legacy' ? { executed: 1, failed: 0 } : { executed: 0, failed: 1 });
    if (fault !== 'legacy') expect(await f.rt.repos.tasks.get(id)).toBeNull();
    expect(await journal('feishu', 'task')).toHaveLength(1); expect(await journal('wecom', 'task')).toHaveLength(0);
  });

});
