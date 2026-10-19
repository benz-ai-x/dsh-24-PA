import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, join, readFile, writeFile } from '../helpers/runtime.mjs';
import { FakeFeishuTransport } from '../../lib/feishu.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) for (const channel of ['feishu', 'wecom']) describe(`规划采纳公开 Runtime (${backend}/${channel})`, () => {
  let f, cluster, workspacePath, local;
  const start = new Date(Date.now() + 86400000); start.setUTCHours(1, 0, 0, 0);
  const at = minutes => new Date(start.getTime() + minutes * 60000).toISOString();
  const blocks = [
    { summary: '首块', start: at(0), end: at(60) },
    { summary: '重叠块', start: at(30), end: at(90) },
  ];
  const stubName = channel === 'feishu' ? 'lark' : 'wecom';
  beforeEach(async () => {
    f = await fixture({ cliTimeoutMs: 10000 });
    for (const [name, variable] of [['lark', 'PA24_LARK_STUB_STATE'], ['wecom', 'PA24_WECOM_STUB_STATE']]) {
      const state = join(f.root, name + '.json'), bin = join(f.root, name + '-cli');
      await writeFile(state, '{}'); await writeFile(bin, '#!/usr/bin/env node\nprocess.env.' + variable + '=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-' + name + '-cli.mjs')) + ');\n'); await chmod(bin, 0o755); f.options[name + 'CliBin'] = bin;
    }
    if (backend === 'postgres') { cluster = await startPgCluster(); f.options.env.PA24_E_TEST_DSN = cluster.dsn; }
    workspacePath = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list', calendarId: 'cal', calendarChannel: channel, maxWorkers: 8, enabledWorkers: ['calendar'], ...(backend === 'postgres' ? { storage: 'postgres', pgDsnEnv: 'PA24_E_TEST_DSN' } : {}) });
    await f.rt.bind(workspacePath); f.rt.transport = new FakeFeishuTransport('test'); local = f.agents.get(await f.rt.openLocalSession());
  });
  afterEach(async () => { await f?.cleanup(); await cluster?.stop(); cluster = null; });
  const worker = async () => ({ id: (await f.rt.delegate({ worker: 'calendar', title: '采纳选定时间块', instruction: '本人明确采纳所选时间块' }, local)).workId });
  const adopt = (child, selected = blocks) => f.rt.work({ action: 'plan_adopt', blocks: selected }, child);
  const remote = async () => (await readFile(join(f.root, stubName + '.json.' + (channel === 'feishu' ? 'events' : 'schedules') + '.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const fault = command => writeFile(join(f.root, stubName + '.json'), JSON.stringify({ failNext: { command } }));

  it('远端已写而回执落盘失败保留占用，重启/换事项不重复，核对成功沿原身份续办', async () => {
    const child = await worker(), update = f.rt.repos.operations.update.bind(f.rt.repos.operations); let fail = true;
    f.rt.repos.operations.update = (id, patch) => { if (fail && patch.receipt?._externalResult) { fail = false; throw new Error('receipt storage unavailable'); } return update(id, patch); };
    const first = await adopt(child); expect(first).toMatchObject({ adopted: 0, unknown: 1, failed: 1 }); expect(first.results[1].skipped).toBe('unknown_conflict'); expect(await remote()).toHaveLength(1);
    const operationId = first.results[0].operationId; expect((await f.rt.repos.operations.get(operationId)).status).toBe('unknown');
    await f.rt.stop(); f.rt = f.make(); await f.rt.bind(workspacePath); f.rt.transport = new FakeFeishuTransport('test'); local = f.agents.get(await f.rt.openLocalSession());
    expect((await adopt(child, [blocks[0]])).results[0]).toMatchObject({ outcome: 'unknown', operationId });
    expect((await adopt(await worker(), [blocks[1]])).results[0].skipped).toBe('unknown_conflict');
    f.rt.config.timeZone = 'UTC'; expect((await adopt(child, [blocks[0]])).results[0].error).toContain('不能改投'); f.rt.config.timeZone = 'Asia/Shanghai';
    // Explicit maintenance reconciliation after reading the real CLI journal;
    // the application must consume that durable result, never re-send it.
    const [actual] = await remote(), eventId = actual.event_id ?? actual.schedule_id;
    await f.rt.repos.operations.update(operationId, { status: 'succeeded', receipt: { eventId, kind: 'create' } });
    expect((await adopt(child, [blocks[0]])).results[0]).toMatchObject({ outcome: 'succeeded', eventId, operationId }); expect(await remote()).toHaveLength(1);
  });

  it('确定拒绝释放时段，后续重叠块正常成功', async () => {
    await fault('calendar.create'); const result = await adopt(await worker());
    expect(result).toMatchObject({ adopted: 1, unknown: 0, failed: 1 }); expect(result.results.map(r => r.outcome)).toEqual(['failed', 'succeeded']); expect(await remote()).toHaveLength(1);
  });

  it('确认实际未写后，同一未知操作可安全续办且身份不变', async () => {
    await fault('calendar.create_unknown'); const child = await worker(), first = await adopt(child, [blocks[0]]), operationId = first.results[0].operationId;
    expect(first.unknown).toBe(1); expect(await remote()).toHaveLength(0);
    // Operator verified no remote event. No automatically inferred retry.
    await f.rt.repos.operations.update(operationId, { status: 'failed', error: '维护核对：确定未写入' });
    const retry = await adopt(child, [blocks[0]]); expect(retry.results[0]).toMatchObject({ operationId, outcome: 'succeeded' }); expect(await remote()).toHaveLength(1);
  });

  it('已存远端回执但本地投影失败，同项重试修复投影且不被自身日程挡住', async () => {
    const child = await worker(), save = f.rt.repos.calendar.upsertEvent.bind(f.rt.repos.calendar); let failed = false;
    f.rt.repos.calendar.upsertEvent = (...args) => { if (!failed) { failed = true; throw new Error('projection unavailable'); } return save(...args); };
    const first = await adopt(child); expect(first.unknown).toBe(1); expect(first.results[1].skipped).toBe('unknown_conflict');
    const retry = await adopt(child, [blocks[0]]); expect(retry.adopted).toBe(1); expect(retry.results[0].operationId).toBe(first.results[0].operationId); expect(await remote()).toHaveLength(1);
  });

  it('升级认领旧渠道创建身份，已存回执的投影故障沿原操作恢复', async () => {
    const child = await worker(), item = await f.rt.repos.workItems.get(child.id), save = f.rt.repos.calendar.upsertEvent.bind(f.rt.repos.calendar);
    f.rt.repos.calendar.upsertEvent = async () => { throw new Error('old projection failure'); };
    await expect(f.rt.calendarWrite(item, 'create', { ...blocks[0], calendarId: channel === 'wecom' ? 'wecom' : 'cal' })).rejects.toThrow('old projection failure');
    const [original] = await f.rt.repos.operations.calendarCreatesForWork(child.id); expect(original.receipt._externalResult).toBeTruthy();
    f.rt.repos.calendar.upsertEvent = save;
    const repaired = await adopt(child, [blocks[0]]); expect(repaired).toMatchObject({ adopted: 1, unknown: 0 });
    expect(repaired.results[0].operationId).toBe(original.id); expect(await remote()).toHaveLength(1);
    expect((await f.rt.repos.operations.calendarCreatesForWork(child.id))).toHaveLength(1);
  });

});
