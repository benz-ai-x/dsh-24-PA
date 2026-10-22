import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
});
