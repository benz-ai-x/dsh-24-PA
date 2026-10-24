import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { WorkItemLifecycle } from '../../lib/work-item-lifecycle.js';
import { ModelBudgetRepo } from '../../lib/repo/model-budget.js';
import { WorkItemRepo } from '../../lib/repo/work.js';
import { ModelBudgets } from '../../lib/model-budgets.js';
import { budgetUsage, budgetSummary, validateBudget, estimateUsage, budgetPeriod, DEFAULT_BUDGET } from '../../lib/model-budget.js';
import { blockRun, clearRunBlock } from '../../lib/run-control.js';
import { startPgCluster } from '../helpers/pg.mjs';
const price = { provider: 'actual', model: 'model-a', inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.2, basis: '主人记录的 2026-10-23 公开价格' };
const config = extra => validateBudget({ ...DEFAULT_BUDGET, prices: [price], ...extra });
it('未知用量、未知缓存价格和混合币种不冒充零；周期使用工作区时区', () => {
  expect(budgetUsage({ inputTokens: 10 })).toBeNull();
  expect(estimateUsage({ inputTokens: 10, outputTokens: 5, cacheWriteTokens: 2 }, price)).toBeNull();
  expect(estimateUsage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2 }, price)).toBeCloseTo(0.0000604);
  expect(budgetUsage({ inputTokens: 2, outputTokens: 1, cacheReadTokens: 20, totalTokens: 23 })).not.toBeNull();
  expect(budgetUsage({ inputTokens: 2, outputTokens: 1, cacheReadTokens: 20, totalTokens: 3 })).toBeNull();
  expect(budgetSummary([{ usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 20 } }], config({})).tokens).toBe(23);
  const report = budgetSummary([{ at: '', currency: 'USD', usage: null, estimate: 1 }], config({ maxTokens: 100 }));
  expect(report).toMatchObject({ tokens: null, estimatedCost: null, knownTokens: 0, unknownCost: 1, unknownUsage: 1, status: 'blocked' });
  expect(budgetSummary([{ currency: 'CNY', usage: { inputTokens: 80, outputTokens: 0 }, estimate: 0 }], config({ maxTokens: 100 })).status).toBe('warning');
  const period = budgetPeriod(config({ period: 'month' }), 'Asia/Shanghai', new Date('2026-10-31T16:00:00Z'));
  expect(period.from.toISOString()).toBe('2026-10-31T16:00:00.000Z'); expect(period.to.toISOString()).toBe('2026-11-30T16:00:00.000Z');
  expect(() => config({ prices: [{ ...price, basis: '' }] })).toThrow('依据');
});
for (const backend of ['sqlite','postgres']) describe('durable model budget / ' + backend, () => {
  let db, repos, cluster, life, owner, session, events, budget;
  beforeAll(async () => { if (backend === 'postgres') cluster = await startPgCluster(); });
  beforeEach(async () => {
    if (cluster) { await cluster.query('drop schema if exists pa24 cascade'); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate({ workspaceId: 'budget-test', workspacePath: '/workspace', ownerOpenId: 'owner' }); repos = createRepos(db);
    life = new WorkItemLifecycle({ repo: () => repos.workItems, maxWorkers: () => 8, available: () => true, start: async () => {}, resume: async () => 'native', interrupt() {}, track() {}, quiesce: async () => {}, completion: { workspacePath: () => '/workspace', read: async () => ({ kind: 'pending' }), delivered() {}, warn() {} } });
    const id = randomUUID(); await repos.workItems.insert({ id, title: '原交办', role: 'memo', instruction: '完整输入', origin: 'local', parent_session_id: 'parent', child_session_id: id, delivery: 'local:parent', status: 'queued' }); await life.pump();
    const work = await repos.workItems.get(id); owner = { runId: work.active_worker_run_id, workId: id, sessionId: id, kind: 'worker' };
    events = []; session = { id, header: { cwd: '/workspace', parentSession: 'parent' }, ownEvents: () => events };
    budget = new ModelBudgets({ host: () => ({}), context: () => ({ repos, path: '/workspace', binding: 'binding', config: config({}), timeZone: 'Asia/Shanghai', maxWorkers: 8 }), activate() {}, detached: fn => fn() });
  });
  afterEach(async () => { await db?.close(); }); afterAll(async () => { await cluster?.stop(); });
  const request = { turn: 1, step: 1, route: { provider: 'proposed', model: 'alias' } };
  const release = () => ({ id: randomUUID(), hash: randomUUID(), ...{ runId: owner.runId, workId: owner.workId, sessionId: owner.sessionId } });
  it('实际路由与原请求价格快照持久去重；缺 usage 的失败尝试另计且不伪造账单', async () => {
    await repos.modelBudget.gate(owner, config({}), 'Asia/Shanghai', request);
    const at = Date.now() + 10;
    events.push({ seq: 11, time: at, type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5 }, message: { source: { provider: 'actual', model: 'model-a' } } } });
    await budget.observe(session); await budget.observe(session);
    let summary = await repos.modelBudget.summary(config({ prices: [{ ...price, outputPerMillion: 100 }] }), 'Asia/Shanghai');
    expect(summary.requests).toBe(1); expect(summary.tokens).toBe(15); expect(summary.estimatedCost).toBeCloseTo(0.00006); expect(summary.records[0].record.price).toEqual(price);
    await repos.modelBudget.gate(owner, config({}), 'Asia/Shanghai', request);
    events.push({ seq: 12, time: at + 1, type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [] } });
    await budget.observe(session); summary = await repos.modelBudget.summary(config({ maxTokens: 100 }), 'Asia/Shanghai');
    expect(summary).toMatchObject({ requests: 2, tokens: null, unknownUsage: 1, pending: 0, status: 'blocked' });
    expect((await repos.modelBudget.requests()).map(row => row.event_id)).toEqual([owner.sessionId + ':11', owner.sessionId + ':12']);
  });
  it('并发到限只放一个新请求；一次放行原子消费，预检不消费', async () => {
    const outcomes = await Promise.all([1,2].map(() => repos.modelBudget.gate(owner, config({ maxRequests: 1 }), 'Asia/Shanghai', request)));
    expect(outcomes.filter(row => row.allowed)).toHaveLength(1); expect(await repos.modelBudget.requests()).toHaveLength(1);
    const input = release(); await repos.modelBudget.grant(input); await repos.modelBudget.grant(input);
    expect(await repos.modelBudget.gate(owner, config({ maxRequests: 1 }), 'Asia/Shanghai')).toMatchObject({ allowed: true });
    expect((await repos.modelBudget.release(input.id)).status).toBe('ready');
    expect(await repos.modelBudget.gate(owner, config({ maxRequests: 1 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: true });
    expect((await repos.modelBudget.release(input.id)).status).toBe('used');
    expect(await repos.modelBudget.gate(owner, config({ maxRequests: 1 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: false });
    expect(await repos.modelBudget.requests()).toHaveLength(2);
  });
  it('放行只解除预算，其他等待和执行时限保留；停止后拒绝迟到放行', async () => {
    await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai');
    await repos.runControls.change(owner.runId, state => { state.executionMs = 120000; blockRun(state, { key: 'input', kind: 'input', reason: '补材料' }); });
    const input = release(); await repos.modelBudget.grant(input);
    expect((await repos.runControls.get(owner.runId)).state).toMatchObject({ executionMs: 120000, blocks: [{ kind: 'input' }] });
    expect(await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: false });
    expect((await repos.modelBudget.release(input.id)).status).toBe('ready');
    await life.stop(owner.workId);
    await expect(repos.modelBudget.grant(release())).rejects.toThrow('迟到');
    await expect(repos.modelBudget.gate(owner, config({}), 'Asia/Shanghai', request)).rejects.toThrow('迟到');
    await repos.modelBudget.wakeError(input.id, 'late rejection', false);
    expect((await repos.workerRuns.get(owner.runId)).status).toBe('stopped');
    expect((await repos.workItems.get(owner.workId)).status).toBe('stopped');
  });
  it('主子会话各自保留预算等待，另一会话的阻断不覆盖指定的一次放行', async () => {
    const child = { ...owner, sessionId: 'native-child' };
    await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai');
    await repos.modelBudget.gate(child, config({ maxRequests: 0 }), 'Asia/Shanghai');
    expect((await budget.snapshot()).waiting).toHaveLength(2);
    const input = { ...release(), sessionId: child.sessionId };
    await repos.modelBudget.grant(input);
    expect((await budget.snapshot()).waiting.map(row => row.session_id)).toEqual([owner.sessionId]);
    expect(await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: false });
    expect(await repos.modelBudget.gate(child, config({ maxRequests: 0 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: true });
    expect((await repos.modelBudget.release(input.id)).status).toBe('used');
    expect((await budget.snapshot()).waiting.map(row => row.session_id)).toEqual([owner.sessionId]);
    expect(await repos.modelBudget.gate(child, config({ maxRequests: 0 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: false });
    expect((await budget.snapshot()).waiting).toHaveLength(2);
  });
  const queueOther = async () => {
    const id = randomUUID(); await repos.workItems.insert({ id, title: '其他交办', role: 'memo', instruction: '其他工作', origin: 'local', parent_session_id: 'other-parent', child_session_id: id, delivery: 'local:other-parent', status: 'queued' }); return id;
  };
  it('子会话预算续办预留共享名额；同运行其他会话仍等待且不能归还该名额', async () => {
    const child = { ...owner, sessionId: 'native-child' };
    await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai');
    await repos.modelBudget.gate(child, config({ maxRequests: 0 }), 'Asia/Shanghai');
    const permit = await repos.modelBudget.grant({ ...release(), sessionId: child.sessionId });
    expect(await repos.modelBudget.claimWake(permit, [], 1)).toBe(true);
    expect((await repos.workerRuns.get(owner.runId)).status).toBe('waiting');
    await queueOther(); expect(await repos.workItems.claimNext(1)).toBeNull();
    expect(await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: false });
    expect(await repos.workItems.claimNext(1)).toBeNull();
    expect(await repos.modelBudget.gate(child, config({ maxRequests: 0 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: true });
    expect((await repos.runControls.get(owner.runId)).state.blocks).toMatchObject([{ key: 'budget:' + owner.sessionId }]);
  });
  it('停止尚未派发的预算续办归还预留名额；迟到失败不会覆盖停止', async () => {
    await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai');
    const permit = await repos.modelBudget.grant(release());
    expect(await repos.modelBudget.claimWake(permit, [], 1)).toBe(true);
    await life.stop(owner.workId); const other = await queueOther();
    expect((await repos.workItems.claimNext(1)).id).toBe(other);
    await repos.modelBudget.wakeError(permit.id, 'late', false);
    expect((await repos.workerRuns.get(owner.runId)).status).toBe('stopped');
  });
  it.runIf(backend === 'postgres')('预算续办失败与主人停止同时发生不会反序死锁或覆盖停止', async () => {
    await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai');
    const permit = await repos.modelBudget.grant(release()); await repos.modelBudget.claimWake(permit, [], 1);
    let locked, releaseStop;
    const lockReached = new Promise(resolve => { locked = resolve; });
    const stopBarrier = new Promise(resolve => { releaseStop = resolve; });
    const wrap = (before, after) => ({ query: db.query.bind(db), withTransaction: fn => db.withTransaction(tx => fn({ query: async (sql, args) => {
      await before(sql); const result = await tx.query(sql, args); await after(sql); return result;
    } })) });
    let runFirst = false;
    const stopping = new WorkItemRepo(wrap(async () => {}, async sql => {
      if (sql.startsWith('update pa24.work_item set updated_at')) { locked(); await stopBarrier; }
    }));
    const failing = new ModelBudgetRepo(wrap(async sql => {
      if (sql.startsWith('select * from pa24.work_item') && sql.includes('for update')) releaseStop();
    }, async sql => {
      if (sql.startsWith('update pa24.worker_run set status = $2')) { runFirst = true; releaseStop(); }
    }));
    const stop = stopping.update(owner.workId, { status: 'stopped', progress: '主人停止' });
    await lockReached; const outcomes = await Promise.allSettled([stop, failing.wakeError(permit.id, 'definite rejection', false)]);
    expect(outcomes.map(row => row.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(runFirst).toBe(false); // The stop won before failure settlement.
    expect((await repos.workerRuns.get(owner.runId)).status).toBe('stopping');
    await repos.workItems.stopReceipt(owner.workId, true);
    expect((await repos.workerRuns.get(owner.runId)).status).toBe('stopped');
    expect((await repos.workItems.get(owner.workId)).status).toBe('stopped');
    expect((await repos.modelBudget.release(permit.id)).record.error).toBe('definite rejection');
  });
  const wakeFixture = () => {
    session.header.parentSession = undefined;
    let attempts = 0, response = 'rejected', binding = 'binding';
    const host = { get: () => null, sessions: { get: id => id === session.id ? session : undefined, flush: async () => true }, sessionController: { prompt: async () => {
      attempts++; if (response === 'unknown') throw new Error('connection lost after sending');
      return response === 'rejected' ? { error: new Error('native prompt explicitly rejected') } : { accepted: true };
    } } };
    const service = new ModelBudgets({ host: () => host, context: () => ({ repos, path: '/workspace', binding, config: config({ maxRequests: 0 }), timeZone: 'Asia/Shanghai', maxWorkers: 1 }), activate() {}, detached: fn => fn() });
    const input = { workspaceBinding: 'binding', requestId: randomUUID(), runId: owner.runId, workId: owner.workId, sessionId: owner.sessionId, scope: 'next-model-request', confirm: true };
    return { service, input, attempts: () => attempts, rebind: () => { binding = 'binding-after-restart'; input.workspaceBinding = binding; }, respond: value => { response = value; } };
  };
  it('宿主明确拒绝续办归还名额且不无界重试；显式重试原许可重新竞争容量', async () => {
    await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai');
    const fixture = wakeFixture(); await fixture.service.grant(fixture.input);
    for (let i = 0; i < 4; i++) await fixture.service.poll();
    expect(fixture.attempts()).toBe(1);
    expect(await repos.modelBudget.release(fixture.input.requestId)).toMatchObject({ status: 'ready', record: { error: 'native prompt explicitly rejected' } });
    expect((await repos.modelBudget.release(fixture.input.requestId)).record.wake).toBeUndefined();
    expect((await repos.workerRuns.get(owner.runId)).status).toBe('waiting');
    const other = await queueOther(); expect((await repos.workItems.claimNext(1)).id).toBe(other);
    fixture.respond('accepted'); fixture.rebind(); await fixture.service.grant(fixture.input);
    expect(fixture.attempts()).toBe(1); // Capacity was not bypassed by the retry.
    await repos.workItems.update(other, { status: 'completed' }); await fixture.service.poll();
    expect(fixture.attempts()).toBe(2);
    expect(await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai', request)).toMatchObject({ allowed: true });
    await life.finish(owner.workId, { output: '完成', delivery: () => ({ dedupKey: 'budget-retry-fixed', channel: 'local', target: 'parent', kind: 'text', content: { text: '完成' } }) });
    expect((await fixture.service.grant(fixture.input)).release.status).toBe('used');
    expect(await repos.modelBudget.releases()).toHaveLength(1);
    await expect(fixture.service.grant({ ...fixture.input, sessionId: 'different' })).rejects.toThrow('其他范围');
  });
  it('接纳未知需要核对，不自动重发，迟到模型不能消费许可或复活运行', async () => {
    await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai');
    const fixture = wakeFixture(); fixture.respond('unknown'); await fixture.service.grant(fixture.input);
    for (let i = 0; i < 4; i++) await fixture.service.poll();
    expect(fixture.attempts()).toBe(1);
    expect((await repos.workerRuns.get(owner.runId)).status).toBe('needs_reconciliation');
    expect((await repos.workItems.get(owner.workId)).status).toBe('needs_reconciliation');
    expect((await repos.modelBudget.release(fixture.input.requestId)).record.wake).toBe('sending');
    await fixture.service.grant(fixture.input); expect(fixture.attempts()).toBe(1);
    await expect(repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai', request)).rejects.toThrow('迟到');
  });
  it('预算恢复保留多个原生消息的身份、来源和完整内容；已有结果仍固定投递', async () => {
    await repos.modelBudget.gate(owner, config({ maxRequests: 0 }), 'Asia/Shanghai');
    const input = release(), row = await repos.modelBudget.grant(input);
    const originals = [1,2].map(n => ({ id: 'original-' + n, source: { kind: 'user', rpcId: 'original-rpc-' + n }, content: [{ type: 'text', text: '全部输入-' + n }, { type: 'image', url: 'data:image/png;base64,AA==' }] }));
    expect(await repos.modelBudget.claimWake(row, originals, 8)).toBe(true);
    const wake = { id: 'wake-id', source: { kind: 'agent-message', senderSessionId: 'parent' }, content: [{ type: 'text', text: 'Agent parent sent a message: ' }, { type: 'text', text: '[24PA budget wake: ' + row.id + ']' }] };
    expect(await budget.inputs(owner.runId, session, [wake])).toEqual(originals);
    await life.finish(owner.workId, { output: '已完成结果', delivery: () => ({ dedupKey: 'budget-fixed', channel: 'local', target: 'parent', kind: 'text', content: { text: '已完成结果' } }) });
    expect((await repos.workerRuns.detail(owner.runId)).deliveries).toMatchObject([{ target: 'parent' }]);
  });
});
