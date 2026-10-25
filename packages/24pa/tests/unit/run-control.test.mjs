import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { RunControlRepo } from '../../lib/repo/run-control.js';
import { makeSkillPackage, parseSkillMarkdown } from '../../lib/skill-package.js';
import { initialRunControl, recordRunStep, checkpointRunTime, blockRun, clearRunBlock, beginRunAttempt, failRunAttempt, runControlSummary, canExecuteRun } from '../../lib/run-control.js';
import { startPgCluster } from '../helpers/pg.mjs';
import { SkillRunTemplates } from '../../lib/skill-run-template.js';
import { SkillRuns } from '../../lib/skill-runs.js';
import { WorkspaceExecution } from '../../lib/workspace-execution.js';
import { runCliProcess } from '../../lib/cli-gateway.js';
import { SkillRunHost } from '../../lib/skill-run-host.js';
import { SkillRunNative } from '../../lib/skill-run-native.js';
import { DEFAULT_BUDGET } from '../../lib/model-budget.js';
import { ModelBudgets } from '../../lib/model-budgets.js';
import { canceledInputIds } from '../../lib/host-turn.js';

describe('运行累计执行与等待时间', () => {
  it('并行子步骤计活跃墙钟一次；重复观测不重复计时，重启离线不填入开放区间', () => {
    const state = initialRunControl(900000, 0);
    recordRunStep(state, 'root:1:1', 'start', 1000);
    recordRunStep(state, 'child:1:1', 'start', 2000);
    checkpointRunTime(state, ['root:1:1', 'child:1:1'], 6000);
    expect(state.executionMs).toBe(5000);
    const restored = structuredClone(state); checkpointRunTime(restored, [], 1_000_000);
    expect(restored.executionMs).toBe(5000);
    recordRunStep(restored, 'root:1:1', 'end', 7000); recordRunStep(restored, 'child:1:1', 'end', 8000);
    recordRunStep(restored, 'root:1:1', 'end', 7000);
    expect(restored.executionMs).toBe(7000);
    expect(() => recordRunStep(restored, 'root:1:1', 'start', 9000)).toThrow(/身份/);
  });
  it('要求等待后已发出的工具仍计执行，等待统计扣除这段重叠', () => {
    const state = initialRunControl(900000, 0);
    recordRunStep(state, 'root:1:1', 'start', 1000);
    blockRun(state, { key: 'input', kind: 'input', reason: '缺少主题' }, 2000);
    recordRunStep(state, 'root:1:1', 'end', 3000);
    clearRunBlock(state, 'input', 7000);
    expect(runControlSummary(state, 7000)).toMatchObject({ executionMs: 2000, waitingMs: 4000, queuedMs: 1000 });
  });
  it('首次执行前的授权等待不重复计作排队时间', () => {
    const state = initialRunControl(900000, 1000);
    blockRun(state, { key: 'authorization', kind: 'authorization', reason: '等待权限恢复' }, 2000);
    clearRunBlock(state, 'authorization', 12000);
    recordRunStep(state, 'first', 'start', 13000);
    expect(runControlSummary(state, 13000)).toMatchObject({ queuedMs: 2000, waitingMs: 10000, executionMs: 0 });
  });
  it('三次明确未执行暂错属于原运行，累计用时和尝试序号不重置', () => {
    const state = initialRunControl(900000, 0);
    for (let number = 1; number <= 4; number++) {
      beginRunAttempt(state, number * 1000);
      recordRunStep(state, String(number), 'start', number * 1000);
      recordRunStep(state, String(number), 'end', number * 1000 + 500);
      expect(failRunAttempt(state, '明确未发出请求的暂错', true, number * 1000 + 500)).toBe(number < 4);
    }
    expect(state.executionMs).toBe(2000); expect(state.attempts).toHaveLength(4);
    expect(() => beginRunAttempt(state, 5000)).toThrow(/重试/);
    const uncertain = initialRunControl(); beginRunAttempt(uncertain);
    expect(failRunAttempt(uncertain, '请求结果未知', false)).toBe(false);
    expect(() => beginRunAttempt(uncertain)).toThrow(/重试/);
  });
});

for (const backend of ['sqlite', 'postgres']) describe(`运行控制持久账本 (${backend})`, () => {
  let db, cluster, root, repos, run;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else { root = await mkdtemp(join(tmpdir(), 'pa24-run-control-')); db = new SqliteDb(join(root, 'ledger.db')); }
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    const markdown = '---\nname: clock\ndescription: clock\nmetadata:\n  track: agent\n  tools: []\n---\nReturn a result.';
    let entry = await repos.skills.change({ requestId: randomUUID(), requestHash: 'create', op: 'save', displayName: '计时验证', version: {
      package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(markdown) }]), definition: parseSkillMarkdown(markdown), validation_error: null } });
    entry = await repos.skills.change({ requestId: randomUUID(), requestHash: 'publish', op: 'publish', id: entry.id, expectedRevision: entry.revision, versionId: entry.draft_version });
    const version = await repos.skills.version(entry.active_version);
    run = await repos.skillRuns.admit({ request_id: randomUUID(), request_hash: 'run', skill_id: entry.id, version_id: version.id, source_session_id: 'source', workspace_path: '/workspace', mode: 'local', trial: false, expectedRevision: entry.revision,
      snapshot: { name: '计时验证', definition: version.definition, package: version.package_data, contract: null, parameters: {}, tools: [], permissionHash: 'allowed' } });
    await repos.runControls.change(run.id, state => Object.assign(state, initialRunControl(900000, 0)));
    await repos.skillRuns.transition(run.id, 'running', '执行中');
  });
  it('执行 2 分钟后等待 20 分钟，重建仓库保留原运行和剩余 13 分钟', async () => {
    await repos.runControls.change(run.id, state => {
      beginRunAttempt(state, 1000); recordRunStep(state, 'first', 'start', 1000); recordRunStep(state, 'first', 'end', 121000);
      blockRun(state, { key: 'input', kind: 'input', reason: '需要补充收件信息' }, 121000);
    });
    await repos.skillRuns.transition(run.id, 'waiting', '需要补充收件信息');
    const restored = new RunControlRepo(db);
    await restored.change(run.id, state => clearRunBlock(state, 'input', 1321000));
    expect(runControlSummary((await restored.get(run.id)).state, 1321000)).toMatchObject({ executionMs: 120000, remainingMs: 780000, waitingMs: 1200000, attempt: 1 });
    expect((await repos.skillRuns.get(run.id)).work_item_id).toBe(run.work_item_id);
  });
  it('多个阻断分别保存；并发解除其中一个不覆盖另一个', async () => {
    await Promise.all([
      repos.runControls.change(run.id, state => blockRun(state, { key: 'input', kind: 'input', reason: '补主题' }, 1000)),
      repos.runControls.change(run.id, state => blockRun(state, { key: 'budget', kind: 'budget', reason: '预算待放行' }, 1000)),
    ]);
    await repos.runControls.change(run.id, state => clearRunBlock(state, 'input', 2000));
    const state = (await repos.runControls.get(run.id)).state;
    expect(state.blocks.map(row => row.key)).toEqual(['budget']); expect(canExecuteRun(state)).toBe(false);
  });
  it.each(['ordinary', 'budget'])('未采用原输入只由一个恢复入口唤醒，先进入=%s', async first => {
    const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '完整原输入' }] };
    await repos.skillRuns.input(run.id, message, true, run.session_id);
    const events = [], session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => events };
    let originalWakes = 0, budgetWakes = 0, captured, proceed;
    const reached = new Promise(resolve => { captured = resolve; }), barrier = new Promise(resolve => { proceed = resolve; });
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null,
      sessionController: { prompt: async () => { budgetWakes++; return { accepted: true }; } } };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    const owner = { runId: run.id, workId: run.work_item_id, sessionId: run.session_id, kind: 'skill' };
    const budget = new ModelBudgets({ host: () => host, context: () => ({ repos, path: '/workspace', binding: 'binding', config: { ...DEFAULT_BUDGET, maxRequests: 0 }, timeZone: 'Asia/Shanghai', maxWorkers: 2 }),
      activate: id => runs.activateBudget(id), resumeInput: (id, sessionId) => runs.resumeBudgetInput(id, sessionId), detached: fn => fn() });
    runs.host.resumePending = async (_, original) => {
      expect(original).toEqual(message); originalWakes++; captured(); await barrier;
      expect(await repos.modelBudget.gate(owner, DEFAULT_BUDGET, 'Asia/Shanghai', { turn: 1, step: 1, route: { provider: 'test', model: 'test' } })).toMatchObject({ allowed: true });
      events.push({ type: 'user/message', data: original });
    };
    await repos.modelBudget.gate(owner, { ...DEFAULT_BUDGET, maxRequests: 0 }, 'Asia/Shanghai');
    const permit = await repos.modelBudget.grant({ id: randomUUID(), hash: randomUUID(), ...owner });
    try {
      expect(await runs.resumeBudgetInput(run.id, 'independent-child')).toBe(false);
      const entering = first === 'ordinary' ? runs.poll() : budget.poll(); await reached;
      await (first === 'ordinary' ? budget.poll() : runs.poll());
      expect(originalWakes).toBe(1); expect(budgetWakes).toBe(0);
      proceed(); await entering;
      expect((await repos.modelBudget.release(permit.id)).status).toBe('used');
      expect((await repos.skillRuns.get(run.id)).status).toBe('running');
    } finally { proceed(); runs.dispose(); }
  });

  it.each(['original', 'supplement'])('先放行主会话时保留子预算等待，%s 沿唯一入口消费许可', async kind => {
    const owner = { runId: run.id, workId: run.work_item_id, sessionId: run.session_id, kind: 'skill' }, childId = randomUUID();
    await repos.skillRuns.child(run.id, childId, run.session_id, '/workspace');
    const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原始输入' }] };
    await repos.skillRuns.input(run.id, message, true, run.session_id);
    const events = kind === 'supplement' ? [{ type: 'user/message', data: message }] : [];
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => events };
    let originalWakes = 0, supplementWakes = 0, genericWakes = 0;
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null,
      sessionController: { prompt: async () => { genericWakes++; return { accepted: true }; } } };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      maxWorkers: () => 8, permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    const config = { ...DEFAULT_BUDGET, maxRequests: 0 };
    const budget = new ModelBudgets({ host: () => host, context: () => ({ repos, path: '/workspace', binding: 'binding', config, timeZone: 'Asia/Shanghai', maxWorkers: 8 }),
      activate: id => runs.activateBudget(id), resumeInput: (id, sessionId) => runs.resumeBudgetInput(id, sessionId), detached: fn => fn() });
    const consume = async input => {
      expect(await repos.modelBudget.gate(owner, config, 'Asia/Shanghai', { turn: 2, step: 1, route: { provider: 'test', model: 'test' } })).toMatchObject({ allowed: true });
      events.push({ type: 'user/message', data: input });
    };
    runs.host.resumePending = async (_, original) => { expect(original).toEqual(message); originalWakes++; await consume(original); };
    runs.host.submitResume = async (_, requestId, content) => {
      expect(content[0].text).toContain('请按表格汇总'); supplementWakes++;
      const input = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: requestId }, content };
      await consume(input); return input.id;
    };
    try {
      if (kind === 'supplement') await runs.waitForInput(run, '请补充格式');
      await repos.modelBudget.gate(owner, config, 'Asia/Shanghai');
      await repos.modelBudget.gate({ ...owner, sessionId: childId }, config, 'Asia/Shanghai');
      if (kind === 'supplement') await runs.resume({ runId: run.id, requestId: randomUUID(), confirm: true, instruction: '请按表格汇总', workspaceBinding: 'binding' });
      expect(originalWakes + supplementWakes).toBe(0);
      const permit = await repos.modelBudget.grant({ id: randomUUID(), hash: randomUUID(), ...owner });
      await budget.poll(); await budget.poll();
      expect([originalWakes, supplementWakes, genericWakes]).toEqual(kind === 'original' ? [1, 0, 0] : [0, 1, 0]);
      expect((await repos.modelBudget.release(permit.id)).status).toBe('used');
      expect((await repos.runControls.get(run.id)).state.blocks.map(block => block.key)).toEqual(['budget:' + childId]);
      if (kind === 'supplement') expect((await repos.runControls.resumes(run.id))[0].status).toBe('submitted');
      expect(await repos.modelBudget.grant({ id: randomUUID(), hash: randomUUID(), ...owner, sessionId: childId })).toMatchObject({ status: 'ready' });
    } finally { runs.dispose(); await repos.skillRuns.transition(run.id, 'stopped', '测试结束'); }
  });
  it.each(['own-budget', 'foreign-budget', 'input', 'authorization', 'dependency', 'stop', 'timeout'])('恢复事务不能越过独立边界：%s', async block => {
    const childId = randomUUID(); await repos.skillRuns.child(run.id, childId, run.session_id, '/workspace');
    await repos.runControls.change(run.id, state => {
      blockRun(state, { key: 'budget:' + childId, kind: 'budget', reason: '子会话等待' });
      if (block === 'stop') state.stop = { requestedAt: Date.now(), settledAt: null, error: null };
      else if (block === 'timeout') state.executionMs = state.limitMs;
      else blockRun(state, { key: block === 'own-budget' ? 'budget:' + run.session_id : block === 'foreign-budget' ? 'budget:unowned' : block,
        kind: block.endsWith('budget') ? 'budget' : block, reason: '仍有独立阻断' });
    });
    const id = randomUUID();
    await repos.runControls.prepareResume({ runId: run.id, requestId: id, hash: id, message: { content: [] }, change: () => {} });
    expect(await repos.runControls.claimRecovery(run.id, { id: 'original' }, 8)).toBe(false);
    expect(await repos.runControls.claimResume(id, 8)).toBe(false);
    expect((await repos.runControls.resumes(run.id))[0].status).toBe('prepared');
    await repos.skillRuns.transition(run.id, 'stopped', '测试结束');
  });

  it.each(['先补充后恢复', '先恢复后补充'])('授权恢复后不得自动提交补充；显式重新检查才恢复（%s）', async order => {
    let permission = 'blocked', submissions = 0;
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [] };
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => permission, lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    runs.host.submitResume = async () => { submissions++; return 'native-' + submissions; };
    try {
      await runs.waitForInput(run, '请补充会议主题');
      if (order === '先恢复后补充') {
        await repos.runControls.change(run.id, state => blockRun(state, { key: 'current-authorization', kind: 'authorization', reason: '授权范围已改变' }));
        permission = 'allowed';
      }
      await runs.resume({ runId: run.id, requestId: randomUUID(), confirm: true, instruction: '会议主题：项目验收', workspaceBinding: 'binding' });
      expect(submissions).toBe(0);
      permission = 'allowed';
      await runs.poll();
      expect(submissions).toBe(0);
      expect((await repos.skillRuns.get(run.id)).status).toBe('waiting');
      expect((await repos.runControls.get(run.id)).state.blocks.map(block => block.key)).toEqual(['current-authorization']);
      await runs.resume({ op: 'recheck', runId: run.id, requestId: randomUUID(), confirm: true, workspaceBinding: 'binding' });
      expect(submissions).toBe(1);
      expect((await repos.runControls.resumes(run.id)).map(row => row.status)).toEqual(['submitted']);
    } finally { runs.dispose(); }
  });

  it('原生回合未闭合时保留已持久等待，running 仍需核对', async () => {
    const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原始任务' }] };
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [
      { type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: message },
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '工具调用已返回' }] } } },
    ] };
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    try {
      await runs.waitForInput(run, '请补充会议主题');
      await runs.poll();
      expect((await repos.skillRuns.get(run.id)).status).toBe('waiting');
      await repos.skillRuns.transition(run.id, 'running', '恢复执行');
      await expect(runs.native.observe(repos.skillRuns, await repos.skillRuns.get(run.id), true)).rejects.toThrow('原生回合缺少结束依据');
    } finally { runs.dispose(); }
  });

  it('中断历史中的持久等待可恢复，running 中断仍需核对', async () => {
    const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原始任务' }] };
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [
      { type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: message },
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '工具调用已返回' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'interrupted' } } },
    ] };
    await repos.skillRuns.input(run.id, message, true, run.session_id);
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    try {
      await runs.waitForInput(run, '请补充会议主题');
      await runs.poll();
      expect((await repos.skillRuns.get(run.id)).status).toBe('waiting');
      await repos.runControls.change(run.id, state => clearRunBlock(state, 'input'));
      await repos.skillRuns.transition(run.id, 'running', '恢复执行');
      await runs.poll();
      expect((await repos.skillRuns.get(run.id)).status).toBe('needs_reconciliation');
    } finally { runs.dispose(); }
  });

  it.each(['无阻断', '仅子会话预算'])('中断输入缺少根会话等待证据时不得重放（%s）', async kind => {
    const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '待恢复输入' }] };
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message] } },
      { type: 'assistant/attempt', data: { turn: 1, error: { message: '执行中断' } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'interrupted' } } },
    ] };
    await repos.skillRuns.input(run.id, message, true, run.session_id);
    if (kind === '仅子会话预算') {
      const childId = randomUUID();
      await repos.skillRuns.child(run.id, childId, run.session_id, '/workspace');
      await repos.runControls.change(run.id, state => blockRun(state, { key: 'budget:' + childId, kind: 'budget', reason: '子会话预算等待' }));
      await repos.skillRuns.transition(run.id, 'waiting', '子会话预算等待');
    }
    const host = { sessions: { get: id => id === session.id ? session : { ...session, id, header: { ...session.header, parentSession: { id: run.session_id }, origin: 'subagent' }, ownEvents: () => [] }, flush: async () => true },
      subagents: { listDescendants: async () => [] }, get: () => null };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    let submissions = 0;
    runs.host.resumePending = async () => { submissions++; };
    try {
      await runs.poll();
      expect((await repos.skillRuns.get(run.id)).status).toBe('needs_reconciliation');
      expect(submissions).toBe(0);
    } finally { runs.dispose(); }
  });

  it('根会话的恢复完成不被更早的等待中断阻断', async () => {
    const original = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原任务' }] };
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [
      { type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: original },
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '等待补充' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'interrupted' } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '恢复完成' }] } } },
      { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
    ] };
    await repos.skillRuns.input(run.id, original, true, run.session_id);
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    try {
      expect(await runs.native.observe(repos.skillRuns, await repos.skillRuns.get(run.id), true)).toMatchObject({ pending: false, root: { id: session.id } });
    } finally { runs.dispose(); }
  });

  it('已采用补充不构成后续 running 中断的恢复证据', async () => {
    const original = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原任务' }] };
    await repos.skillRuns.input(run.id, original, true, run.session_id);
    const requestId = 'resume-evidence';
    await repos.runControls.prepareResume({ runId: run.id, requestId, hash: 'resume-evidence', message: { content: [{ type: 'text', text: '已采用补充' }] }, change: () => {} });
    expect(await repos.runControls.claimResume(requestId, 8)).toBe(true);
    expect(await repos.runControls.submitted(requestId, 'native-resume')).toBe(true);
    const resume = (await repos.runControls.resumes(run.id))[0];
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { id: 'native-resume', role: 'user', source: { kind: 'user', rpcId: requestId }, content: resume.message.content } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [original] } },
      { type: 'assistant/attempt', data: { turn: 2, error: { message: '后续执行中断' } } },
    ] };
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    let submissions = 0;
    runs.host.resumePending = async () => { submissions++; };
    try {
      await runs.recover();
      expect((await repos.skillRuns.get(run.id)).status).toBe('needs_reconciliation');
      expect(submissions).toBe(0);
    } finally { runs.dispose(); }
  });

  it.each(['ready', 'used'])('旧预算拒绝快照不结算新许可（%s），随后原请求完成', async permitState => {
    const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原输入' }] };
    await repos.skillRuns.input(run.id, message, true, run.session_id);
    const owner = { runId: run.id, workId: run.work_item_id, sessionId: run.session_id, kind: 'skill' };
    const events = [
      { type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: message },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } },
    ];
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => events };
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    await repos.modelBudget.gate(owner, { ...DEFAULT_BUDGET, maxRequests: 0 }, 'Asia/Shanghai');
    let captured, proceed;
    const capture = new Promise(resolve => { captured = resolve; }), barrier = new Promise(resolve => { proceed = resolve; });
    const observe = runs.native.observe.bind(runs.native);
    runs.native.observe = async (...args) => { const snapshot = await observe(...args); captured(); await barrier; return snapshot; };
    const request = { turn: 2, step: 1, route: { provider: 'test', model: 'test' } };
    try {
      const settling = runs.poll(); await capture;
      const permit = await repos.modelBudget.grant({ id: randomUUID(), hash: randomUUID(), ...owner });
      expect(await repos.modelBudget.claimWake(permit, [], 2)).toBe(true);
      if (permitState === 'used') await repos.modelBudget.gate(owner, DEFAULT_BUDGET, 'Asia/Shanghai', request);
      proceed(); await settling;
      expect((await repos.skillRuns.get(run.id)).status).toBe('running');
      expect((await repos.runControls.get(run.id)).state.terminal).toBeNull();
      if (permitState === 'ready') expect(await repos.modelBudget.gate(owner, DEFAULT_BUDGET, 'Asia/Shanghai', request)).toMatchObject({ allowed: true });
      events.push({ type: 'turn/start', data: { turn: 2 } }, { type: 'user/message', data: message },
        { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '原请求完成' }] } } },
        { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } });
      await runs.poll(); expect((await repos.skillRuns.get(run.id)).status).toBe('completed');
    } finally { proceed(); runs.dispose(); }
  });
  it('停止意图落盘后重启，预算等待不阻止无在途动作的停止收口', async () => {
    const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原任务' }] };
    await repos.skillRuns.input(run.id, message, true, run.session_id);
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [
      { type: 'turn/start', data: { turn: 1 } }, { type: 'user/message', data: message },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } },
    ] };
    const host = { sessions: { get: () => session, flush: async () => true }, subagents: { listDescendants: async () => [] }, get: () => null };
    const runs = new SkillRuns({ host, context: () => ({ binding: 'binding', cwd: '/workspace', repos }), packages: {},
      permissionHash: () => 'allowed', lease: fn => fn(), control: fn => fn(), detached: fn => fn(), template: async () => '' });
    const owner = { runId: run.id, workId: run.work_item_id, sessionId: run.session_id, kind: 'skill' };
    await repos.modelBudget.gate(owner, { ...DEFAULT_BUDGET, maxRequests: 0 }, 'Asia/Shanghai');
    await repos.skillRuns.transition(run.id, 'stopping', '停止意图已落盘');
    try {
      await runs.recover(); await runs.poll();
      expect((await repos.skillRuns.get(run.id)).status).toBe('stopped');
      expect((await repos.runControls.get(run.id)).state.terminal.status).toBe('stopped');
      await expect(repos.modelBudget.grant({ id: randomUUID(), hash: randomUUID(), ...owner })).rejects.toThrow(/停止|结束/);
    } finally { runs.dispose(); }
  });

  it('另一会话预算等待不拒绝已派发工具，独立人工阻断仍拒绝', async () => {
    await repos.runControls.change(run.id, state => blockRun(state, { key: 'budget:sibling', kind: 'budget', reason: '另一会话到限' }));
    await repos.skillRuns.transition(run.id, 'waiting', '另一会话等待');
    await repos.skillRuns.beginCall(run.id, 'allowed', 'bash', {}, run.session_id);
    expect((await repos.skillRuns.calls(run.id)).find(row => row.call_id === 'allowed').status).toBe('running');
    await repos.runControls.change(run.id, state => blockRun(state, { key: 'input', kind: 'input', reason: '缺信息' }));
    await expect(repos.skillRuns.beginCall(run.id, 'blocked', 'bash', {}, run.session_id)).rejects.toThrow(/等待/);
    expect((await repos.skillRuns.calls(run.id)).some(row => row.call_id === 'blocked')).toBe(false);
  });

  it.each(['paused', 'no-budget', 'open-step', 'unknown-tool', 'unsettled-job'])('冷恢复只确认未执行的预算等待，保留原始回执：%s', async condition => {
    const childId = randomUUID(), epoch = randomUUID(), events = [];
    await repos.skillRuns.child(run.id, childId, run.session_id, '/workspace');
    await repos.skillRuns.nativeReceipt(run.id, 'activation', run.session_id, epoch, 'start', { id: childId, runId: epoch });
    if (condition === 'open-step') events.push({ type: 'step/start', data: { turn: 1, step: 1 } });
    if (condition === 'unknown-tool') await repos.skillRuns.beginCall(run.id, 'unknown', 'bash', {}, childId);
    if (condition === 'unsettled-job') await repos.skillRuns.nativeReceipt(run.id, 'job', childId, 'missing-end', 'start', { id: 'missing-end' });
    const rootSession = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [] };
    const child = { id: childId, header: { cwd: '/workspace', origin: 'subagent', parentSession: run.session_id }, ownEvents: () => events };
    const native = new SkillRunNative({ history: async (_, id) => id === childId ? child : rootSession,
      descendants: async () => [{ kind: 'child', id: childId, parentId: run.session_id, mode: 'local' }],
      busy: () => false, resident: () => false, ownedJobs: () => [], job: () => undefined });
    if (condition === 'paused') {
      expect((await native.observe(repos.skillRuns, run, true, async () => true)).pending).toBe(true);
      const original = (await repos.skillRuns.native(run.id))[0];
      expect(original.end_data).toBeNull(); expect(original.recovery_data).toMatchObject({ kind: 'budget-paused', sessionId: childId, eventCount: 0 });
      expect((await native.observe(repos.skillRuns, run, true, async () => true)).pending).toBe(true);
      expect((await native.observe(repos.skillRuns, run, false, async () => false)).pending).toBe(false);
      expect((await repos.skillRuns.native(run.id))[0]).toEqual(original);
    } else {
      await expect(native.observe(repos.skillRuns, run, true, async () => condition !== 'no-budget')).rejects.toThrow(/结束回执/);
      expect((await repos.skillRuns.native(run.id)).every(row => !row.recovery_data)).toBe(true);
    }
  });

  it('原生规则更新中的 NUL 分隔符无损保存；旧输入仍可读取', async () => {
    const message = { id: randomUUID(), content: [{ type: 'text', text: '原生上下文\u0000\ud800' }], source: { kind: 'agent-instructions', changes: [{ scope: '.\u0000AGENTS.md' }] } };
    await repos.skillRuns.input(run.id, message, true, run.session_id);
    expect((await repos.skillRuns.inputs(run.id))[0].message).toEqual(message);
    expect((await repos.skillRuns.evidence(run.id)).inputs[0].message).toEqual(message);
    const legacy = { id: randomUUID(), content: [{ type: 'text', text: '原输入' }], source: { kind: 'user' } };
    await db.query('insert into pa24.skill_run_input (run_id, message_id, message, accepted, session_id) values ($1,$2,$3,$4,$5)', [run.id, legacy.id, JSON.stringify(legacy), true, run.session_id]);
    expect((await repos.skillRuns.inputs(run.id)).find(row => row.message_id === legacy.id).message).toEqual(legacy);
  });
  it('恢复输入先持久化且同请求只生成一份；相同标识不能更改输入', async () => {
    await repos.runControls.change(run.id, state => blockRun(state, { key: 'input', kind: 'input', reason: '缺信息' }, 1000));
    await repos.skillRuns.transition(run.id, 'waiting', '缺信息');
    const input = { runId: run.id, requestId: randomUUID(), hash: 'same-input', message: { id: randomUUID(), content: [{ type: 'text', text: '主题已补充' }] }, change: state => clearRunBlock(state, 'input', 2000) };
    const [one, two] = await Promise.all([repos.runControls.prepareResume(input), repos.runControls.prepareResume(input)]);
    expect(one.message.id).toBe(two.message.id); expect(await repos.runControls.resumes(run.id)).toHaveLength(1);
    await expect(repos.runControls.prepareResume({ ...input, hash: 'different' })).rejects.toThrow(/其他/);
    expect((await repos.runControls.get(run.id)).state.blocks).toEqual([]);
  });
  it('停止、超时后迟到放行不复活；未知仍保留原记录', async () => {
    await repos.runControls.change(run.id, state => {
      recordRunStep(state, 'long-step', 'start', 1000); recordRunStep(state, 'long-step', 'end', 901000);
    });
    expect(canExecuteRun((await repos.runControls.get(run.id)).state)).toBe(false);
    await repos.skillRuns.transition(run.id, 'timed_out', '累计执行达到时限');
    await repos.skillRuns.transition(run.id, 'running', '迟到放行');
    expect((await repos.skillRuns.get(run.id)).status).toBe('timed_out');
    await expect(repos.runControls.change(run.id, state => clearRunBlock(state, 'budget', 902000))).rejects.toThrow(/结束/);
    await expect(repos.runControls.prepareResume({ runId: run.id, requestId: randomUUID(), hash: 'late', message: {}, change: () => {} })).rejects.toThrow(/结束/);
  });
  it('超时终态仍恢复未完成停止；停止回执落盘后不再轮询', async () => {
    await repos.runControls.change(run.id, state => { state.stop = { requestedAt: Date.now(), settledAt: null, error: '正在核对' }; });
    await repos.skillRuns.transition(run.id, 'timed_out', '已请求超时停止');
    expect((await repos.skillRuns.unfinished()).some(row => row.id === run.id)).toBe(true);
    await repos.runControls.change(run.id, state => { state.stop.settledAt = Date.now(); });
    expect((await repos.skillRuns.unfinished()).some(row => row.id === run.id)).toBe(false);
  });
  it.each(['user', 'parent', 'queued'])('原生明确取消未采用输入（%s）后，轮询和重启不自动提交', async kind => {
    const message = { id: randomUUID(), source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原任务' }] };
    const events = [{ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message] } }];
    if (kind !== 'queued') events.push({ type: 'turn/start', data: { turn: 1 } });
    events.push({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], ...(kind === 'queued' ? { outcome: 'canceled' } : {}) } });
    if (kind !== 'queued') events.push({ type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind } } } });
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => events };
    const runs = new SkillRuns({ host: {}, context: () => ({ cwd: '/workspace', binding: 'binding', repos }), packages: {},
      permissionHash: () => 'allowed', lease: work => work(), control: work => work(), detached: work => work(), template: async () => '' });
    let stops = 0, resumes = 0;
    runs.host.history = async () => session; runs.host.descendants = async () => [];
    runs.host.ownedJobs = () => []; runs.host.stop = async () => { stops++; };
    runs.host.resumePending = async () => { resumes++; };
    try {
      await runs.poll(); await runs.poll(); await runs.recover();
      expect((await repos.skillRuns.get(run.id)).status).toBe('stopped');
      expect(stops).toBe(1); expect(resumes).toBe(0);
    } finally { runs.dispose(); }
  });
  it('SQL 认领后的取消在实际恢复前再次核验，迟到重新入队不能抹去取消', async () => {
    const message = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: run.request_id }, content: [{ type: 'text', text: '原任务' }] };
    const events = [{ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message] } }];
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => events };
    let followed = 0;
    const agent = { id: run.session_id, session, inbox: { nextTurn: [message], nextStep: [], remove() {} },
      runMaintenance: async work => {
        events.push({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' } });
        return work(new AbortController().signal);
      }, followup: () => { followed++; } };
    const host = new SkillRunHost({ sessionController: { resolveAgent: async () => ({ agent }) } });
    host.live.set(run.session_id, agent);
    await expect(host.resumePending(run, message)).rejects.toThrow(/取消/);
    expect(followed).toBe(0);
    events.push({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message] } });
    expect(canceledInputIds(session).has(message.id)).toBe(true);
  });
  it('历史读取只回退已注销会话，持久化失败和存活会话错误仍上抛', async () => {
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [{ type: 'turn/start', data: { turn: 1 } }] };
    const durable = [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }];
    let current = session, failure, reads = 0, closes = 0;
    const host = new SkillRunHost({
      sessions: {
        get: () => current,
        flush: async () => {
          await Promise.resolve();
          if (failure) throw failure;
          return true;
        },
      },
      get: () => ({ open: async () => ({ header: { ...session.header, id: session.id }, inheritedEventCount: 0,
        read: async () => { reads++; return { events: durable }; }, close: async () => { closes++; } }) }),
    });
    failure = new Error(`session "${session.id}" is not live in this store`);
    const reading = host.history(run);
    current = undefined;
    await expect(reading).resolves.toMatchObject({ id: session.id, header: session.header });
    expect((await host.history(run)).ownEvents()).toEqual(durable);
    expect(reads).toBe(2); expect(closes).toBe(2);
    current = session;
    await expect(host.history(run)).rejects.toThrow('not live');
    failure = new Error('durable write failed');
    await expect(host.history(run)).rejects.toThrow('durable write failed');
    expect(reads).toBe(2); expect(closes).toBe(2);
  });
  it('上下文去重和外来输入移除不取消运行；只识别原输入与登记补充', async () => {
    const context = { id: 'context', content: [{ type: 'text', text: 'AGENTS.md' }], source: { kind: 'agent-instructions' } };
    const foreign = { id: 'foreign', content: [{ type: 'text', text: '无关输入' }], source: { kind: 'user', rpcId: 'not-owned' } };
    const original = { id: 'original', content: [{ type: 'text', text: '原任务' }], source: { kind: 'user', rpcId: run.request_id } };
    const events = [], remove = message => events.push(
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [message] } },
      { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' } });
    remove(context); remove(foreign);
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => events };
    let follows = 0;
    const agent = { id: run.session_id, session, inbox: { nextTurn: [original], nextStep: [], remove() {} },
      runMaintenance: work => work(new AbortController().signal), followup: () => { follows++; } };
    const native = new SkillRunHost({ sessionController: { resolveAgent: async () => ({ agent }) }, sessions: { flush: async () => true } });
    native.live.set(run.session_id, agent);
    const listeners = new Map(); let guard, models = 0;
    agent.ctx = { plugin: plugin => ({ await: async () => plugin.apply({
      skills: { registerProvider() {} }, tools: { restrict() {}, guard: check => { guard = check; } }, on: (event, listener) => listeners.set(event, listener),
    }) }) };
    native.materialize = async () => '/workspace'; native.verifyResources = async () => {};
    await native.mount(agent, run, { allowed: () => true, authorize: async () => {}, beforeModel: async () => {},
      ownsInput: async () => true, input: async () => {}, block: async () => {}, execute: (_call, next) => next(), final() {}, activation() {} });
    expect(native.canceledInputs(run, session).size).toBe(0);
    expect(guard({ agent, name: 'example' })).toContain('授权范围'); // not falsely stopped
    expect(await listeners.get('agent/pre-step')({ agent, messages: [original] }, async () => ({ kind: 'enter', messages: [original] }))).toMatchObject({ kind: 'enter' });
    await listeners.get('agent/request')({ agent }, async () => { models++; }); expect(models).toBe(1);
    await native.resumePending(run, original); expect(follows).toBe(1);
    const runs = new SkillRuns({ host: {}, context: () => ({ cwd: '/workspace', binding: 'binding', repos }), packages: {}, template: async () => '' });
    runs.host.history = async () => session;
    await repos.skillRuns.input(run.id, context, true, run.session_id);
    try { expect(await runs.stopCanceledInput(run)).toBe(false); } finally { runs.dispose(); }
    const supplement = { id: 'supplement', content: [{ type: 'text', text: '主人补充' }], source: { kind: 'user', rpcId: 'resume-request' } };
    native.rememberResume(run.id, 'resume-request', supplement.content); remove(supplement);
    expect([...native.canceledInputs(run, session)]).toEqual(['supplement']);
    remove(original); expect(native.canceledInputs(run, session).has(original.id)).toBe(true);
    expect(await listeners.get('agent/pre-step')({ agent, messages: [original] }, async () => ({ kind: 'enter' }))).toMatchObject({ kind: 'reject' });
    expect(guard({ agent, name: 'example' })).toContain('停止');
  });
  it('真实停止校验和人工证据同批成功后结清停止；核对失败不能解锁', async () => {
    await repos.skillRuns.nativeReceipt(run.id, 'job', run.session_id, 'unconfirmed-job', 'start', { id: 'unconfirmed-job' });
    await repos.skillRuns.nativeReceipt(run.id, 'job', run.session_id, 'unconfirmed-job', 'end', { producerReported: false });
    await repos.runControls.change(run.id, state => { state.stop = { requestedAt: Date.now(), settledAt: null, error: '缺少可靠生产者回执' }; });
    await repos.skillRuns.transition(run.id, 'timed_out', '超时');
    const runs = new SkillRuns({ host: {}, context: () => ({ cwd: '/workspace', binding: 'binding', repos }), packages: {}, sourceSession: async () => 'source',
      permissionHash: () => 'allowed', lease: work => work(), control: work => work(), detached: work => work(), template: async () => '' });
    let ended = false;
    runs.host.stop = async () => {}; runs.host.history = async () => null;
    runs.host.assertStopped = async () => { if (!ended) throw new Error('仍在执行'); };
    const command = { runId: run.id, requestId: randomUUID(), workspaceBinding: 'binding', fingerprint: (await repos.skillRuns.evidence(run.id)).fingerprint,
      confirm: true, summary: '检查实际执行已结束', completed: '第一部分', remaining: '第二部分', calls: [],
      native: [{ kind: 'job', ownerId: run.session_id, nativeId: 'unconfirmed-job', evidence: '已检查原工作目录结果与执行进程，确认结束' }] };
    try {
      await expect(runs.review(command)).rejects.toThrow(/仍在执行/);
      expect((await repos.runControls.get(run.id)).state.stop.settledAt).toBeNull();
      ended = true; await runs.review(command); await runs.review(command);
      expect((await repos.runControls.get(run.id)).state.stop).toMatchObject({ reviewRequestId: command.requestId, error: null });
      expect((await repos.runControls.get(run.id)).state.stop.settledAt).not.toBeNull();
      expect((await repos.skillRuns.get(run.id)).status).toBe('timed_out');
      expect((await repos.skillRuns.native(run.id))[0].end_data.producerReported).toBe(false);
      expect(await repos.skillRuns.continuation(run.id)).toHaveLength(1);
      await repos.skillRuns.checkNewWork(run.skill_id);
      expect((await repos.skillRuns.unfinished()).some(row => row.id === run.id)).toBe(false);
    } finally { runs.dispose(); }
  });
  it('模型请求边界发现时限耗尽，会请求实际停止且不等待自己的回合结束', async () => {
    await repos.runControls.change(run.id, state => Object.assign(state, initialRunControl(1000, Date.now() - 2000)));
    let beforeModel, stops = 0;
    const runs = new SkillRuns({ host: { get: () => undefined }, context: () => ({ cwd: '/workspace', binding: 'binding', repos }), packages: {},
      permissionHash: () => 'allowed', lease: work => work(), control: work => work(), detached: work => work(), template: async () => '' });
    runs.host.mount = async (_agent, _run, hooks) => { beforeModel = hooks.beforeModel; };
    runs.host.history = async () => null;
    runs.host.stop = async () => { stops++; };
    runs.native.observe = async () => ({ pending: false, root: null, histories: [] });
    const session = { id: run.session_id, header: { cwd: '/workspace' }, ownEvents: () => [
      { type: 'turn/start', time: Date.now() - 1500, data: { turn: 1 } },
      { type: 'step/start', time: 1, data: { turn: 1, step: 1 } },
    ] };
    // Keep the event identity/timestamp stable across clock observations.
    const events = session.ownEvents(); session.ownEvents = () => events;
    events[1].time = events[0].time;
    try {
      await runs.attach({ id: run.session_id, session });
      await expect(beforeModel(session)).rejects.toThrow(/时限/);
      for (let i = 0; i < 50 && !(await repos.runControls.get(run.id)).state.stop?.settledAt; i++) await new Promise(resolve => setTimeout(resolve, 10));
      expect(stops).toBe(1); expect((await repos.skillRuns.get(run.id)).status).toBe('timed_out');
      expect((await repos.runControls.get(run.id)).state.stop.settledAt).not.toBeNull();
    } finally { runs.dispose(); }
  });
  it('模板受累计时限约束；配置等待期间取消实际 CLI，保存执行时间', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pa24-template-limit-')), output = join(dir, 'result.txt');
    const executions = new WorkspaceExecution(); let entered; const started = new Promise(resolve => { entered = resolve; });
    const templates = new SkillRunTemplates(async () => {
      entered();
      await runCliProcess({ bin: process.execPath, argv: ['-e', "require('node:fs').writeFileSync(process.argv[1], 'before'); setTimeout(() => require('node:fs').appendFileSync(process.argv[1], '-after'), 5000);", output], timeoutMs: 20000, fail: kind => new Error(kind) });
      return '不得超时后完成';
    }, work => executions.control(work));
    try {
      await repos.runControls.change(run.id, state => Object.assign(state, initialRunControl(1000)));
      const generating = executions.run(() => templates.start({ ...run, mode: 'template' }, repos));
      await started;
      const changing = executions.transition(async () => {});
      await Promise.all([generating, changing]);
      expect((await repos.skillRuns.get(run.id)).status).toBe('timed_out');
      expect(await readFile(output, 'utf8')).toBe('before');
      const control = (await repos.runControls.get(run.id)).state;
      expect(control.executionMs).toBeGreaterThanOrEqual(1000); expect(control.executionMs).toBeLessThan(4000);
      expect(control.attempts).toHaveLength(1); expect(control.attempts[0].endedAt).not.toBeNull();
    } finally { templates.dispose(); await executions.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
