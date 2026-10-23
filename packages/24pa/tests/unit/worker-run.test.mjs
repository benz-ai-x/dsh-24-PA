import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { WorkItemLifecycle } from '../../lib/work-item-lifecycle.js';
import { historyFilter } from '../../lib/run-history.js';
import { WorkerRuns } from '../../lib/worker-runs.js';
import { startPgCluster } from '../helpers/pg.mjs';
for (const backend of ['sqlite', 'postgres']) describe(`ordinary worker run journal / ${backend}`, () => {
  let db, repos, cluster, life, quiesce, services;
  beforeAll(async () => { if (backend === 'postgres') cluster = await startPgCluster(); });
  beforeEach(async () => {
    if (cluster) { await cluster.query('drop schema if exists pa24 cascade'); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate({ workspaceId: 'workspace', workspacePath: '/workspace', ownerOpenId: 'owner' }); repos = createRepos(db);
    quiesce = null; services = [];
    life = new WorkItemLifecycle({ repo: () => repos.workItems, maxWorkers: () => 8, available: () => true,
      start: async () => {}, resume: async () => 'native-' + randomUUID(), interrupt: () => {}, track: () => {}, quiesce: async () => quiesce?.(),
      completion: { workspacePath: () => '/workspace', read: async () => ({ kind: 'pending' }), delivered() {}, warn() {} } });
  });
  afterEach(async () => { for (const service of services) service.dispose(); await db?.close(); });
  afterAll(async () => { await cluster?.stop(); });
  const make = async (extra = {}) => { const id = randomUUID(); return repos.workItems.insert({ id, title: '真实交付', role: 'memo', instruction: '保存原请求', origin: 'local', parent_session_id: 'parent', child_session_id: id, delivery: 'local:parent', status: 'queued', ...extra }); };
  const list = workId => repos.runHistory.list(historyFilter({ kind: 'runs', range: 'all', workId }, 'Asia/Shanghai'));
  const finish = item => life.finish(item.id, { output: '交付物与原对象凭证', executionId: item.execution_id, generation: item.recovery_gen,
    delivery: () => ({ dedupKey: `workitem:${item.id}:result:${item.execution_id}`, channel: 'local', target: 'parent', kind: 'text', content: { text: '回传' } }) });
  const journal = async item => {
    const listeners = new Map(), agent = { id: item.id, session: { id: item.id, header: { cwd: '/workspace', parentSession: 'parent' }, ownEvents: () => [] },
      ctx: { plugin: plugin => ({ await: async () => plugin.apply({ on: (event, listener) => listeners.set(event, listener) }) }) } };
    const service = new WorkerRuns({ context: () => ({ repos, path: '/workspace', binding: 'binding' }), allowed: () => true, expire: async () => {} });
    services.push(service); await service.attach(agent);
    return { agent, request: next => listeners.get('agent/request')({ agent }, next),
      execute: (next, signal = new AbortController().signal) => listeners.get('tools/execute')({ agent, callId: randomUUID(), name: 'save_file', arguments: {}, signal }, next) };
  };
  it('旧交办不伪造档案；首次执行、运行中补充和结束后接续有稳定且不同的身份', async () => {
    const old = await make({ status: 'completed' }); expect((await list(old.id)).total).toBe(0);
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id); const first = item.active_worker_run_id;
    expect(first).toBeTruthy(); expect((await repos.workerRuns.inputs(first))[0].instruction).toBe('保存原请求');
    await life.resume(item.id, '补充资料B', true); item = await repos.workItems.get(item.id);
    expect(item.active_worker_run_id).toBe(first); expect(await repos.workerRuns.inputs(first)).toHaveLength(2);
    await finish(item); expect((await repos.workerRuns.get(first)).result).toBe('交付物与原对象凭证');
    await expect(life.resume(item.id, '迟到补充', true)).rejects.toThrow('结束');
    await life.resume(item.id, '只完成剩余C'); item = await repos.workItems.get(item.id);
    expect(item.active_worker_run_id).not.toBe(first); expect((await repos.workerRuns.get(item.active_worker_run_id)).snapshot.fromRunId).toBe(first);
    const history = await list(item.id); expect(history.total).toBe(2); expect(history.rows.map(row => row.source).sort()).toEqual(['continuation','manual']);
    expect(history.rows.every(row => row.record_kind === 'worker')).toBe(true); await life.stop(item.id);
  });
  it('完成、运行结果、主人验收状态与投递在同一事务；投递失败回滚结果', async () => {
    let item = await make({ acceptance_required: true, completion_criteria: '可核对原对象' }); await life.pump(); item = await repos.workItems.get(item.id);
    await expect(life.finish(item.id, { output: '不得提交', delivery: () => ({ dedupKey: null, channel: 'local', target: 'parent', kind: 'text', content: {} }) })).rejects.toThrow();
    expect((await repos.workerRuns.get(item.active_worker_run_id)).status).toBe('running');
    await finish(item); await finish(item);
    expect(await repos.workItems.get(item.id)).toMatchObject({ status: 'completed', acceptance_status: 'pending' });
    const detail = await repos.workerRuns.detail(item.active_worker_run_id); expect(detail.deliveries).toHaveLength(1); expect(detail.control.state.terminal.status).toBe('completed');
  });
  it('停止请求与实际确认分开，未确认占用执行名额且不能盲接续', async () => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id);
    quiesce = () => { throw new Error('native drain unavailable'); }; await life.stop(item.id); quiesce = null;
    let detail = await repos.workerRuns.detail(item.active_worker_run_id); expect(detail.run.status).toBe('stopping'); expect(detail.control.state.stop.settledAt).toBeNull();
    await expect(life.resume(item.id, '继续')).rejects.toThrow('尚未确认停止');
    await repos.workItems.stopReceipt(item.id, true); detail = await repos.workerRuns.detail(item.active_worker_run_id);
    expect(detail.run.status).toBe('stopped'); expect(detail.control.state.stop.settledAt).toBeTypeOf('number');
  });
  it('验收回执与状态原子保存，重复操作只返回原修订，旧确认不覆盖进展', async () => {
    expect((await repos.runHistory.summary()).waiting_work).toBe(0);
    let item = await make({ acceptance_required: true }); await life.pump(); item = await repos.workItems.get(item.id); await finish(item); item = await repos.workItems.get(item.id);
    expect((await repos.runHistory.summary()).waiting_work).toBe(1);
    const input = { op: 'accept', instruction: '人工核对交付物', expectedRevision: item.revision }, id = randomUUID();
    const claimed = await repos.workControls.prepare(id, id, item.id, item.revision, input);
    const one = await repos.workControls.acceptance(claimed.row, item.revision, 'accept', input.instruction);
    const again = await repos.workControls.acceptance(claimed.row, item.revision, 'accept', input.instruction);
    expect(again.work.revision).toBe(one.work.revision); expect((await repos.workControls.get(id)).record.phase).toBe('completed');
    await expect(repos.workControls.prepare(randomUUID(), 'stale', item.id, item.revision, input)).rejects.toThrow('新进展');
    const summary = await repos.runHistory.summary(); expect(summary.waiting_work).toBe(0);
  });
  it('重启可继续核对停止，不把未确认停止当完成；保留超时原因', async () => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id);
    quiesce = () => { throw Error('暂未结束'); }; await life.stop(item.id, 'timed_out');
    expect((await repos.workerRuns.get(item.active_worker_run_id)).status).toBe('stopping');
    quiesce = null; await life.retryStops(); const detail = await repos.workerRuns.detail(item.active_worker_run_id);
    expect(detail.run.status).toBe('timed_out'); expect(detail.control.state.terminal.status).toBe('timed_out');
  });
  it('原交办结果未知先核对，补投只改原 Outbox 且不新建执行', async () => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id); await finish(item);
    let detail = await repos.workerRuns.detail(item.active_worker_run_id); const id = Number(detail.deliveries[0].id);
    await repos.outbox.mark(id, { status: 'unknown', error: '回执丢失' }); detail = await repos.workerRuns.detail(item.active_worker_run_id);
    await expect(repos.planResults.repair({ runId: detail.run.id, outboxId: id, fingerprint: detail.deliveries[0].fingerprint, requestId: randomUUID(), requestHash: 'blocked', op: 'retry' })).rejects.toThrow('未知结果须先核对');
    await repos.planResults.repair({ runId: detail.run.id, outboxId: id, fingerprint: detail.deliveries[0].fingerprint, requestId: randomUUID(), requestHash: 'review', op: 'review', outcome: 'not_sent', evidence: '原入口确认未接纳' });
    detail = await repos.workerRuns.detail(item.active_worker_run_id); expect(detail.deliveries[0].status).toBe('failed');
    const retry = { runId: detail.run.id, outboxId: id, fingerprint: detail.deliveries[0].fingerprint, requestId: randomUUID(), requestHash: 'retry', op: 'retry' };
    await repos.planResults.repair(retry); await repos.planResults.repair(retry);
    detail = await repos.workerRuns.detail(item.active_worker_run_id); expect(detail.deliveries[0].status).toBe('pending'); expect((await list(item.id)).total).toBe(1);
    expect(detail.deliveries[0].target).toBe('parent'); expect(detail.run.result).toBe('交付物与原对象凭证');
  });
  it('未知动作须逐项核对；迟到证据使核对失效，原回执从不改写为成功', async () => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id);
    const callId = await repos.workerRuns.call(item.active_worker_run_id, 'save_file', { path: '/workspace/result' });
    await repos.workerRuns.callResult(callId, 'unknown', { error: 'lost acknowledgement' }); await life.stop(item.id);
    await expect(life.resume(item.id, '继续剩余部分')).rejects.toThrow('未核对动作');
    const detail = await repos.workerRuns.detail(item.active_worker_run_id); item = await repos.workItems.get(item.id);
    const input = { op: 'review', runId: detail.run.id, fingerprint: detail.fingerprint, summary: '文件核对完成', completed: '文件A已保存', remaining: '仅整理摘要', calls: [{ id: callId, outcome: 'completed', evidence: '/workspace/result 已有原文件' }] };
    const id = randomUUID(), claim = await repos.workControls.prepare(id, id, item.id, item.revision, input);
    await repos.workerRuns.review(claim.row, input); const saved = await repos.workerRuns.detail(detail.run.id);
    expect(saved.reviewed).toBe(true); expect(saved.calls[0].status).toBe('unknown'); await repos.workItems.assertResumable(item.id);
    await life.resume(item.id, '只完成剩余摘要'); const continued = await repos.workItems.get(item.id);
    expect(continued.active_worker_run_id).not.toBe(detail.run.id);
    await repos.workerRuns.callResult(callId, 'unknown', { error: 'new conflicting receipt' });
    expect((await repos.workItems.get(item.id)).status).toBe('running');
    expect((await repos.workerRuns.detail(detail.run.id)).reviewed).toBe(false);
    await expect(repos.workItems.assertResumable(item.id)).rejects.toThrow('未核对动作');
    const cold = await journal(continued);
    await expect(cold.request(async () => { throw Error('must not dispatch'); })).rejects.toThrow('未核对动作');
    expect((await repos.workerRuns.get(continued.active_worker_run_id)).status).toBe('needs_reconciliation');
    expect((await repos.workerRuns.get(detail.run.id)).status).toBe('stopped');
  });
  it('明确未接纳的交办单列拒绝事件，不计一次执行', async () => {
    const item = await make();
    const failing = new WorkItemLifecycle({ repo: () => repos.workItems, maxWorkers: () => 8, available: () => true, start: async () => { throw Error('职责配置缺失'); }, resume: async () => {}, interrupt() {}, track() {}, completion: { workspacePath: () => '/workspace', read: async () => ({ kind: 'pending' }), delivered() {}, warn() {} } });
    await failing.pump(); expect((await list(item.id)).total).toBe(0);
    const events = await repos.runHistory.list(historyFilter({ kind: 'events', range: 'all', workId: item.id }, 'Asia/Shanghai'));
    expect(events.total).toBe(1); expect(events.rows[0]).toMatchObject({ status: 'rejected', record_kind: 'worker', summary: '职责配置缺失' });
    const first = (await repos.workItems.get(item.id)).active_worker_run_id;
    await life.resume(item.id, '职责已修复，明确接续');
    const continued = await repos.workItems.get(item.id);
    expect(continued.active_worker_run_id).not.toBe(first);
    expect((await repos.workerRuns.get(continued.active_worker_run_id)).snapshot.fromRunId).toBe(first);
    expect((await repos.workerRuns.get(first)).status).toBe('rejected');
    expect((await list(item.id)).total).toBe(1);
    expect((await repos.runHistory.list(historyFilter({ kind: 'events', range: 'all', workId: item.id }, 'Asia/Shanghai'))).total).toBe(1);
  });
  it('真实 ToolRuntime 在写入后包装的错误仍是未知，冷读门禁阻止后续模型、工具和补充', async () => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id);
    const hook = await journal(item), ctx = new Context(); let writes = 0;
    try {
      await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
      ctx.tools.register({ name: 'save_file', description: 'test write', parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'object' }, render: () => [] },
        execute: async () => { writes++; throw Error('write completed but acknowledgement lost'); } });
      const result = await hook.execute(() => ctx.tools.execute({ callId: 'real-tool', name: 'save_file', arguments: {}, signal: new AbortController().signal }));
      expect(result.isError).toBe(true); expect(writes).toBe(1);
      const detail = await repos.workerRuns.detail(item.active_worker_run_id);
      expect(detail.calls[0].status).toBe('unknown'); expect(detail.run.status).toBe('needs_reconciliation');
      expect((await repos.workItems.get(item.id)).status).toBe('needs_reconciliation');
      await expect(life.resume(item.id, '换个参数再试', true)).rejects.toThrow('核对');
      // A stale status projection cannot bypass durable unresolved evidence.
      await repos.workItems.update(item.id, { status: 'running' });
      const cold = await journal(item); let models = 0;
      await expect(cold.request(async () => { models++; })).rejects.toThrow('核对');
      await expect(cold.execute(async () => { writes++; return {}; })).rejects.toThrow();
      expect(models).toBe(0); expect(writes).toBe(1);
    } finally { await ctx.fiber.dispose(); }
  });
  it('关联平台动作未知也在模型和工具边界阻断，不能换参数绕过', async () => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id);
    const hook = await journal(item); let dispatched = 0;
    await repos.operations.begin({ id: 'external', workItemId: item.id, action: 'calendar.create', params: {} });
    await repos.operations.update('external', { status: 'unknown', error: 'lost receipt' });
    await expect(hook.request(async () => { dispatched++; })).rejects.toThrow('核对');
    await expect(hook.execute(async () => { dispatched++; return {}; })).rejects.toThrow();
    expect(dispatched).toBe(0); expect((await repos.workItems.get(item.id)).status).toBe('needs_reconciliation');
  });
  it('未知回执写库失败后，当前门禁与冷恢复都保留未结清调用的阻断', async () => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id);
    const hook = await journal(item), save = repos.workerRuns.callResult;
    repos.workerRuns.callResult = async () => { throw Error('receipt ledger unavailable'); };
    try { await expect(hook.execute(async () => ({ isError: true }))).rejects.toThrow('ledger unavailable'); }
    finally { repos.workerRuns.callResult = save; }
    expect((await repos.workerRuns.detail(item.active_worker_run_id)).calls[0].status).toBe('running');
    await expect(hook.request(async () => { throw Error('must not dispatch'); })).rejects.toThrow('核对');
    await repos.workItems.update(item.id, { status: 'running' });
    const cold = await journal(item);
    await expect(cold.request(async () => { throw Error('must not dispatch'); })).rejects.toThrow('核对');
  });
  it.each(['unknown', 'succeeded'])('停止期间到达的 %s 工具凭证只修复原记录，不复活交办', async outcome => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id);
    const hook = await journal(item); let release, entered;
    const pending = new Promise(resolve => { entered = resolve; });
    const execution = hook.execute(async () => { entered(); return new Promise(resolve => { release = resolve; }); });
    await pending; await life.stop(item.id);
    release(outcome === 'unknown' ? { isError: true, error: { message: 'lost receipt' } } : { value: { saved: true } });
    await execution;
    const detail = await repos.workerRuns.detail(item.active_worker_run_id);
    expect(detail.calls[0].status).toBe(outcome); expect(detail.run.status).toBe('stopped');
    expect((await repos.workItems.get(item.id)).status).toBe('stopped');
    await expect(life.resume(item.id, '迟到补充', true)).rejects.toThrow('补充不会复活');
  });
  it('收到与采用以原生消费证据区分，工具计时不包含等待', async () => {
    let item = await make(); await life.pump(); item = await repos.workItems.get(item.id); const run = await repos.workerRuns.get(item.active_worker_run_id);
    const at = run.snapshot.startedAt + 1, input = { id: 'message-' + item.id, source: { kind: 'user' }, content: [{ type: 'text', text: `[24PA execution: ${item.execution_id}]` }] };
    const events = [{ type: 'agent/inbox/spliced', time: at, data: { target: 'queue', start: 0, removedCount: 0, inserted: [input] } }];
    const session = { id: item.id, header: { cwd: '/workspace', parentSession: 'parent' }, ownEvents: () => events };
    const service = new WorkerRuns({ context: () => ({ repos, path: '/workspace', binding: 'binding' }), allowed: () => true, expire: async () => {} });
    await service.observe(session); expect((await repos.workerRuns.inputs(run.id))[0].status).toBe('received');
    events.push({ type: 'turn/start', time: at + 1, data: { turn: 1 } },
      { type: 'agent/inbox/spliced', time: at + 2, data: { target: 'queue', start: 0, removedCount: 1, inserted: [], outcome: 'consumed' } },
      { type: 'user/message', time: at + 3, data: input }, { type: 'step/start', time: at + 4, data: { turn: 1, step: 1 } },
      { type: 'step/end', time: at + 104, data: { turn: 1, step: 1 } });
    await service.observe(session); expect((await repos.workerRuns.inputs(run.id))[0]).toMatchObject({ status: 'adopted', adopted_turn: 1 });
    expect((await repos.runControls.get(run.id)).state.executionMs).toBe(100);
    service.dispose(); await life.stop(item.id);
  });
});
