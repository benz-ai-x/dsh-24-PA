import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { makeSkillPackage, parseSkillMarkdown, skillContract } from '../../lib/skill-package.js';
import { startPgCluster } from '../helpers/pg.mjs';
import { SkillPackages } from '../../lib/skill-packages.js';
import { SkillRuns } from '../../lib/skill-runs.js';

const markdown = body => '---\n' + JSON.stringify({ name: 'example', description: '可核验任务', metadata: { track: 'agent', tools: [], pa24: {
  schemaVersion: 1, mode: 'business', parameters: {}, expectedResult: '生成摘要', completionCriteria: '标注事实来源',
} } }) + '\n---\n\n' + body;
const version = body => ({ package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(markdown(body)) }, { path: 'references/data.txt', bytes: Buffer.from(body) }]), definition: parseSkillMarkdown(markdown(body)), validation_error: null });

for (const backend of ['sqlite', 'postgres']) describe(`Manticore Skill、计划与运行事务 (${backend})`, () => {
  let db, cluster, root, repos;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else { root = await mkdtemp(join(tmpdir(), 'pa24-skill-state-')); db = new SqliteDb(join(root, 'ledger.db')); }
    await db.migrate();
    repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    for (const table of ['skill_run_review', 'skill_run_native', 'skill_run_session', 'skill_run_input', 'skill_run_call', 'skill_run', 'skill_plan_block', 'skill_change', 'skill_version', 'skill_entry', 'digest_work_binding', 'digest_occurrence', 'digest_plan', 'outbox', 'action_operation', 'work_item']) await db.query(`delete from pa24.${table}`);
  });
  const change = input => repos.skills.change({ requestId: randomUUID(), requestHash: randomUUID(), ...input });
  const create = (body = '版本 A') => change({ op: 'save', displayName: '同名任务', version: version(body) });
  const publish = entry => change({ op: 'publish', id: entry.id, expectedRevision: entry.revision, versionId: entry.draft_version });
  const plan = (entry, id = 'plan') => repos.digests.insertPlan({ id, kind: 'morning', title: '原计划', schedule_id: 'native-1', session_id: 'source', schedule_spec: { daily: { time: '08:00:00', time_zone: 'Asia/Shanghai' } }, status: 'active', last_window: null, voice: false, skill: entry.name });
  const resolved = async entry => {
    const v = await repos.skills.version(entry.active_version);
    return { ...v.definition, name: entry.name, source: 'pa24-managed', track: 'agent', metadata: { ...v.definition.metadata, pa24Identity: { versionId: v.id } } };
  };
  const admission = async entry => {
    const v = await repos.skills.version(entry.active_version);
    return { request_id: randomUUID(), request_hash: randomUUID(), skill_id: entry.id, version_id: v.id, source_session_id: 'source', workspace_path: '/workspace', mode: 'local', trial: false, expectedRevision: entry.revision,
      snapshot: { name: entry.display_name, definition: v.definition, package: v.package_data, contract: skillContract(v.definition), parameters: {}, tools: [], permissionHash: 'permission-v1' } };
  };

  it('同名创建身份不同；冲突编辑不留下孤立版本；重试恢复原回执', async () => {
    const first = await create(), second = await create();
    expect(first.name).not.toBe(second.name);
    const input = { requestId: randomUUID(), requestHash: 'same-request', op: 'save', id: first.id, expectedRevision: first.revision, version: version('版本 B') };
    const saved = await repos.skills.change(input);
    expect(await repos.skills.change(input)).toEqual(saved);
    await expect(repos.skills.change({ ...input, requestHash: 'different' })).rejects.toThrow(/不同|其他/);
    await expect(change({ op: 'save', id: first.id, expectedRevision: first.revision, version: version('冲突版本') })).rejects.toThrow(/其他编辑/);
    expect(await repos.skills.versions(first.id)).toHaveLength(2);
    expect((await repos.skills.version(first.draft_version)).definition.content).toBe('版本 A');
  });

  it('单个受管包损坏只影响该条目，其他目录项及版本运行统计仍可读取', async () => {
    const broken = await create(), good = await create();
    const pkg = version('损坏文件').package_data; pkg.hash = 'invalid-package-hash';
    await db.query('update pa24.skill_version set package_data = $2 where id = $1', [broken.draft_version, JSON.stringify(pkg)]);
    const manager = new SkillPackages({ context: () => ({ cwd: '/workspace', binding: 'binding', repo: repos.skills }), registry: null, plans: async () => [], pausePlan: async () => {}, check: async () => [] });
    const rows = await manager.list('binding');
    expect(rows.find(row => row.id === 'managed:' + broken.id)).toMatchObject({ status: 'error' });
    expect(rows.find(row => row.id === 'managed:' + good.id)).toMatchObject({ status: 'loaded', verification: { runs: 0, trials: 0, completed: 0 } });
  });

  it('发布旧版本仍保留后续草稿；改名保留原生别名和计划引用', async () => {
    let entry = await publish(await create());
    const original = entry.active_version, alias = entry.name;
    await plan(entry);
    entry = await change({ op: 'save', id: entry.id, expectedRevision: entry.revision, version: version('版本 B') });
    const draft = entry.draft_version;
    entry = await change({ op: 'rollback', id: entry.id, expectedRevision: entry.revision, versionId: original });
    entry = await change({ op: 'rename', id: entry.id, expectedRevision: entry.revision, displayName: '新名称' });
    expect(entry).toMatchObject({ active_version: original, draft_version: draft, name: alias, display_name: '新名称' });
    expect((await repos.digests.getPlan('plan')).skill).toBe(alias);
  });

  it('禁用挡住新运行和计划恢复；重新启用不清除计划阻断；显式换绑才解除', async () => {
    let entry = await publish(await create());
    const initial = await plan(entry), input = await admission(entry);
    entry = await change({ op: 'disable', id: entry.id, expectedRevision: entry.revision });
    await expect(repos.digests.claimRun({ planId: 'plan', windowKey: 'new', skill: await resolved(entry) })).rejects.toThrow(/禁用/);
    await expect(plan(entry, 'second')).rejects.toThrow(/禁用/);
    await expect(repos.skillRuns.admit(input)).rejects.toThrow(/状态或版本/);
    await repos.digests.updatePlan('plan', { status: 'paused' });
    entry = await publish(entry);
    await expect(repos.digests.comparePlan(await repos.digests.getPlan('plan'), { status: 'active' })).rejects.toThrow(/手工恢复/);
    expect(await repos.skills.planBlocks()).toHaveLength(1);
    await repos.digests.updatePlan('plan', { skill: entry.name });
    expect(await repos.skills.planBlocks()).toHaveLength(0);
    expect((await repos.digests.getPlan('plan')).status).toBe('paused');
    await repos.digests.comparePlan(await repos.digests.getPlan('plan'), { status: 'active' });
    expect((await repos.digests.getPlan('plan')).schedule_id).toBe(initial.schedule_id);
  });

  it('启用版本与声明版本同时核验；在途包和计划输入固定，暂停后仍保存结果', async () => {
    let entry = await publish(await create());
    await plan(entry);
    const oldSkill = await resolved(entry);
    const first = await repos.digests.claimRun({ planId: 'plan', windowKey: 'one', workItemId: 'worker-one', skill: oldSkill });
    entry = await change({ op: 'save', id: entry.id, expectedRevision: entry.revision, version: version('版本 B') });
    entry = await publish(entry);
    await expect(repos.digests.claimRun({ planId: 'plan', windowKey: 'two', skill: oldSkill })).rejects.toThrow(/新旧版本/);
    await change({ op: 'disable', id: entry.id, expectedRevision: entry.revision });
    await repos.digests.updatePlan('plan', { status: 'paused', title: '改名后计划', voice: true });
    const existing = await repos.digests.claimRun({ planId: 'plan', windowKey: 'ignored', workItemId: 'worker-one' });
    expect(existing.created).toBe(false);
    expect(existing.row.skill_snapshot.definition.content).toBe('版本 A');
    expect(existing.row.skill_snapshot.package).toEqual(version('版本 A').package_data);
    expect(existing.row.plan_snapshot).toMatchObject({ title: '原计划', voice: false });
    await repos.digests.completeRun({ planId: 'plan', occurrenceId: first.row.id, report: '原版本结果', notifications: [] });
    expect((await repos.digests.occurrence(first.row.id)).report).toBe('原版本结果');
  });

  it('删除与创建引用并发，至少一方拒绝；有效引用不会指向已删除 Skill', async () => {
    const entry = await publish(await create());
    const results = await Promise.allSettled([plan(entry), change({ op: 'delete', id: entry.id, expectedRevision: entry.revision })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const current = await repos.skills.get(entry.id), bound = await repos.digests.getPlan('plan');
    if (bound) expect(current.status).toBe('enabled');
    else expect(current.status).toBe('deleted');
  });

  it('同一请求只接纳一条运行和交办；冻结版本；Worker 调度不领走本地运行', async () => {
    const entry = await publish(await create()), input = await admission(entry);
    const [one, two] = await Promise.all([repos.skillRuns.admit(input), repos.skillRuns.admit(input)]);
    expect(one.id).toBe(two.id);
    expect((await repos.skillRuns.list()).total).toBe(1);
    expect(await repos.workItems.get(one.work_item_id)).toMatchObject({ execution_mode: 'skill', child_session_id: null, status: 'running' });
    await change({ op: 'save', id: entry.id, expectedRevision: entry.revision, version: version('替换版本') });
    expect((await repos.skillRuns.get(one.id)).snapshot.package).toEqual(input.snapshot.package);
    await expect(repos.skillRuns.repeated(input.request_id, 'other-input')).rejects.toThrow(/不同/);
  });

  it('工具执行意图与未知结果保留，停止和新运行均不能抹除或绕过', async () => {
    const entry = await publish(await create()), input = await admission(entry);
    const run = await repos.skillRuns.admit(input);
    await repos.skillRuns.transition(run.id, 'running', '执行中');
    await repos.skillRuns.beginCall(run.id, 'call-1', 'example', { value: 1 });
    await expect(repos.skillRuns.beginCall(run.id, 'call-1', 'example', { value: 1 })).rejects.toThrow(/已有执行意图/);
    await repos.skillRuns.finishCall(run.id, 'call-1', { error: '回执丢失' }, 'unknown');
    await repos.skillRuns.transition(run.id, 'needs_reconciliation', '待核对');
    await repos.skillRuns.transition(run.id, 'stopped', '不能清除未知');
    expect((await repos.skillRuns.get(run.id)).status).toBe('needs_reconciliation');
    await expect(repos.skillRuns.admit({ ...input, request_id: randomUUID(), workItemId: run.work_item_id })).rejects.toThrow(/核对/);
    await expect(repos.skillRuns.admit({ ...input, request_id: randomUUID() })).rejects.toThrow(/全新运行/);
    expect((await repos.skillRuns.calls(run.id))[0]).toMatchObject({ status: 'unknown', result: { error: '回执丢失' } });
  });

  it('结束后显式重跑新建运行、保留交办；并发重跑只接受一个；迟到完成不复活停止', async () => {
    const entry = await publish(await create()), input = await admission(entry);
    const original = await repos.skillRuns.admit(input);
    await repos.skillRuns.transition(original.id, 'completed', '完成', '原结果');
    const attempts = await Promise.allSettled([1, 2].map(() => repos.skillRuns.admit({ ...input, request_id: randomUUID(), workItemId: original.work_item_id })));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const next = attempts.find(result => result.status === 'fulfilled').value;
    expect(next.id).not.toBe(original.id); expect(next.work_item_id).toBe(original.work_item_id);
    await repos.skillRuns.transition(next.id, 'stopping', '请求停止');
    await repos.skillRuns.transition(next.id, 'completed', '迟到结果', '不应覆盖');
    expect((await repos.skillRuns.get(next.id)).status).toBe('stopping');
    await repos.skillRuns.transition(next.id, 'stopped', '已停止');
    expect((await repos.skillRuns.get(original.id)).result).toBe('原结果');
  });

  it('人工核对逐项留档，不改原始未知回执；新证据使旧核对失效，不能接续绕过', async () => {
    const entry = await publish(await create()), input = await admission(entry), run = await repos.skillRuns.admit(input);
    await repos.skillRuns.transition(run.id, 'running', '执行中');
    await repos.skillRuns.beginCall(run.id, 'partial-write', 'bash', { command: 'partial' });
    await repos.skillRuns.finishCall(run.id, 'partial-write', { error: 'aborted after partial write' }, 'unknown');
    await repos.skillRuns.transition(run.id, 'needs_reconciliation', '待核对');
    const evidence = await repos.skillRuns.evidence(run.id);
    const review = { runId: run.id, requestId: randomUUID(), requestHash: 'review-content', fingerprint: evidence.fingerprint,
      record: { actor: 'source', summary: '核对了实际文件', completed: '第一段已写入', remaining: '仅补第二段', calls: [], native: [] } };
    await expect(repos.skillRuns.review(review)).rejects.toThrow(/逐项/);
    review.record.calls.push({ sessionId: run.session_id, callId: 'partial-write', outcome: 'partial', evidence: '/workspace/result.txt：已读到第一段' });
    const saved = await repos.skillRuns.review(review);
    expect(await repos.skillRuns.review(review)).toEqual(saved);
    expect((await repos.skillRuns.calls(run.id))[0].status).toBe('unknown');
    expect((await repos.skillRuns.get(run.id)).status).toBe('stopped');
    expect((await repos.skillRuns.continuation(run.id))[0].review.completed).toBe('第一段已写入');
    await repos.skillRuns.finalCall(run.id, { callId: 'partial-write', sessionId: run.session_id, name: 'bash', arguments: {} }, { error: 'new late receipt' }, true);
    expect((await repos.skillRuns.evidence(run.id)).reviewed).toBe(false);
    await expect(repos.skillRuns.admit({ ...input, request_id: randomUUID(), workItemId: run.work_item_id })).rejects.toThrow(/核对/);
    await expect(repos.skillRuns.review({ ...review, requestId: randomUUID() })).rejects.toThrow(/新回执/);
  });

  it('并发重试同一运行请求只启动一次，两个调用均返回同一记录', async () => {
    const source = '---\n' + JSON.stringify({ name: 'template', description: '确定性模板', metadata: { track: 'template', tools: [] } }) + '\n---\n模板正文';
    const entry = await publish(await change({ op: 'save', displayName: '模板验证', version: {
      package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(source) }]), definition: parseSkillMarkdown(source), validation_error: null,
    } }));
    const packages = new SkillPackages({ context: () => ({ cwd: '/workspace', binding: 'binding', repo: repos.skills }), registry: null, plans: async () => [], pausePlan: async () => {}, check: async () => [] });
    let executions = 0;
    const runs = new SkillRuns({ host: {}, context: () => ({ cwd: '/workspace', binding: 'binding', repos }), packages,
      sourceSession: async () => 'source', tools: async () => [], permissionHash: () => 'permission', checkBusiness() {}, startBusiness: async () => {}, checkTemplate() {},
      template: async () => { executions++; await new Promise(resolve => setTimeout(resolve, 100)); return '仅执行一次'; }, lease: work => work(), control: work => work(), detached: work => work() });
    const base = { id: 'managed:' + entry.id, workspaceBinding: 'binding' }, preview = await runs.preview(base);
    const command = { ...base, requestId: randomUUID(), confirm: true, fingerprint: preview.fingerprint };
    const results = await Promise.all([runs.start(command), runs.start(command)]);
    expect(executions).toBe(1);
    expect(results[0].run.id).toBe(results[1].run.id);
    expect(results.map(result => result.repeated).sort()).toEqual([false, true]);
    expect((await repos.skillRuns.list(entry.id)).total).toBe(1);
  });

  it('旧运行收到迟到证据并重新核对，不停止正在接续的交办', async () => {
    const entry = await publish(await create()), input = await admission(entry), original = await repos.skillRuns.admit(input);
    await repos.skillRuns.transition(original.id, 'running', '原执行');
    await repos.skillRuns.beginCall(original.id, 'write', 'bash', {});
    await repos.skillRuns.finishCall(original.id, 'write', { error: 'uncertain' }, 'unknown');
    await repos.skillRuns.transition(original.id, 'needs_reconciliation', '待核对');
    const record = { actor: 'source', summary: '已检查实际结果', completed: '部分完成', remaining: '补齐未完成部分',
      calls: [{ sessionId: original.session_id, callId: 'write', outcome: 'partial', evidence: '已查看原文件' }], native: [] };
    const review = async () => repos.skillRuns.review({ runId: original.id, requestId: randomUUID(), requestHash: randomUUID(), fingerprint: (await repos.skillRuns.evidence(original.id)).fingerprint, record });
    await review();
    const next = await repos.skillRuns.admit({ ...input, request_id: randomUUID(), workItemId: original.work_item_id });
    await repos.skillRuns.claimLaunch(next.id, '接续正在执行');
    await repos.skillRuns.finalCall(original.id, { callId: 'write', sessionId: original.session_id, name: 'bash', arguments: {} }, { error: 'late' }, true);
    await review();
    expect((await repos.skillRuns.get(next.id)).status).toBe('running');
    expect(await repos.workItems.get(original.work_item_id)).toMatchObject({ status: 'running', progress: '接续正在执行', active_skill_run_id: next.id });
    expect((await repos.skillRuns.latestForWork(original.work_item_id)).id).toBe(next.id);
    await repos.skillRuns.transition(next.id, 'completed', '接续完成', '新结果');
    expect(await repos.workItems.get(original.work_item_id)).toMatchObject({ status: 'completed', result: '新结果' });
    expect((await repos.skillRuns.evidence(original.id)).reviews).toHaveLength(2);
  });

  it('删除只关闭新操作，历史目录、版本导出和原运行管理仍可访问', async () => {
    const entry = await publish(await create()), input = await admission(entry), run = await repos.skillRuns.admit(input);
    await repos.skillRuns.claimLaunch(run.id, '执行中');
    await change({ op: 'delete', id: entry.id, expectedRevision: entry.revision });
    const packages = new SkillPackages({ context: () => ({ cwd: '/workspace', binding: 'binding', repo: repos.skills }), registry: null, plans: async () => [], pausePlan: async () => {}, check: async () => [] });
    const id = 'managed:' + entry.id;
    expect((await packages.list('binding')).find(row => row.id === id).managedStatus).toBe('deleted');
    expect((await packages.inspect(id, 'binding')).entry.status).toBe('deleted');
    expect((await packages.download(id, entry.active_version, 'binding')).base64).toBeTruthy();
    await expect(packages.capture(id, entry.active_version, 'binding')).rejects.toThrow(/删除/);
    await expect(repos.skillRuns.admit({ ...input, request_id: randomUUID() })).rejects.toThrow(/状态/);
    await repos.skillRuns.transition(run.id, 'stopping', '手工停止');
    await repos.skillRuns.transition(run.id, 'stopped', '已停止');
    expect((await repos.skillRuns.list(entry.id)).rows[0].status).toBe('stopped');
  });

  it('父子会话可以有相同工具 ID；最终回执不覆盖派发证据，缺失意图的拒绝也留档', async () => {
    const entry = await publish(await create()), run = await repos.skillRuns.admit(await admission(entry));
    await repos.skillRuns.transition(run.id, 'running', '执行中');
    await repos.skillRuns.child(run.id, 'native-child', run.session_id, '/workspace/project');
    expect((await repos.skillRuns.bySession('native-child')).id).toBe(run.id);
    for (const session of [run.session_id, 'native-child']) {
      await repos.skillRuns.beginCall(run.id, 'call-1', 'bash', { session }, session);
      await repos.skillRuns.finishCall(run.id, 'call-1', { written: session }, 'returned', session);
    }
    await repos.skillRuns.finalCall(run.id, { callId: 'call-1', sessionId: 'native-child', name: 'bash', arguments: {} }, { error: 'cancelled after dispatch' }, true);
    await repos.skillRuns.finalCall(run.id, { callId: 'denied', sessionId: 'native-child', name: 'write', arguments: {} }, { isError: true, error: 'not authorized' }, false);
    const calls = await repos.skillRuns.calls(run.id);
    expect(calls).toHaveLength(3);
    expect(calls.find(call => call.session_id === run.session_id)).toMatchObject({ status: 'returned', result: { written: run.session_id } });
    expect(calls.find(call => call.session_id === 'native-child' && call.call_id === 'call-1')).toMatchObject({ status: 'unknown', result: { written: 'native-child' } });
    expect(calls.find(call => call.call_id === 'denied')).toMatchObject({ status: 'failed', result: null });
    await repos.skillRuns.nativeReceipt(run.id, 'activation', run.session_id, 'activation-1', 'end', { id: 'native-child', stopReason: 'completed' });
    await repos.skillRuns.nativeReceipt(run.id, 'activation', run.session_id, 'activation-1', 'start', { id: 'native-child' });
    expect(await repos.skillRuns.native(run.id)).toMatchObject([{ start_data: { id: 'native-child' }, end_data: { stopReason: 'completed' } }]);
  });

  it('旧运行的外部动作未决时不能新开运行，即使表层状态已结束', async () => {
    const entry = await publish(await create()), input = await admission(entry), run = await repos.skillRuns.admit(input);
    await repos.skillRuns.child(run.id, 'business-child', run.session_id, '/workspace');
    await repos.operations.begin({ id: 'unknown-create', workItemId: 'business-child', action: 'calendar.create', params: {} });
    await repos.operations.update('unknown-create', { status: 'unknown', error: 'receipt missing' });
    await repos.skillRuns.transition(run.id, 'completed', '旧表层状态');
    expect(await repos.skillRuns.unresolvedOperations(run.work_item_id)).toHaveLength(1);
    await expect(repos.skillRuns.admit({ ...input, request_id: randomUUID(), workItemId: run.work_item_id })).rejects.toThrow(/核对/);
  });
});
