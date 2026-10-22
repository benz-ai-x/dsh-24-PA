import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { makeSkillPackage, parseSkillMarkdown } from '../../lib/skill-package.js';
import { recordRunStep } from '../../lib/run-control.js';
import { SkillRuns } from '../../lib/skill-runs.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`共享执行容量 (${backend})`, () => {
  let db, cluster, repos, entry, version;
  const identity = () => ({ requestId: randomUUID(), requestHash: randomUUID() });
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); });
  beforeEach(async () => {
    for (const table of ['skill_run_call', 'skill_run_native', 'skill_run_review', 'skill_run_session', 'skill_run_control', 'skill_run_resume', 'skill_run', 'work_item']) await db.query(`delete from pa24.${table}`);
    const markdown = '---\nname: capacity\ndescription: capacity\nmetadata:\n  track: agent\n  tools: []\n---\nReturn a result.';
    entry = await repos.skills.change({ ...identity(), op: 'save', displayName: '并发核验', version: { package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(markdown) }]), definition: parseSkillMarkdown(markdown), validation_error: null } });
    entry = await repos.skills.change({ ...identity(), op: 'publish', id: entry.id, expectedRevision: entry.revision, versionId: entry.draft_version });
    version = await repos.skills.version(entry.active_version);
  });
  const admit = () => repos.skillRuns.admit({ request_id: randomUUID(), request_hash: 'new', skill_id: entry.id, version_id: version.id,
    expectedRevision: entry.revision, source_session_id: 'parent', workspace_path: '/workspace', mode: 'local', trial: false,
    snapshot: { name: '并发核验', definition: version.definition, package: version.package_data, contract: null, parameters: {}, tools: [], permissionHash: 'same' } });
  const worker = (id, status = 'queued', parent = 'parent') => repos.workItems.insert({ id, title: id, role: 'memo', instruction: 'save', origin: 'local',
    parent_session_id: parent, child_session_id: `child-${id}`, delivery: `local:${parent}`, status });

  it('并发启动共享同一上限；释放后另一条队列运行才能启动', async () => {
    const runs = await Promise.all(Array.from({ length: 4 }, admit));
    const claims = await Promise.all(runs.map(run => repos.skillRuns.claimLaunch(run.id, 'start', 2)));
    expect(claims.filter(Boolean)).toHaveLength(2);
    const pending = runs[claims.indexOf(false)], active = runs[claims.indexOf(true)];
    expect((await repos.workItems.get(pending.work_item_id)).status).toBe('queued');
    await repos.skillRuns.transition(active.id, 'completed', 'done', '结果');
    expect(await repos.skillRuns.claimLaunch(pending.id, 'start', 2)).toBe(true);
    expect((await repos.workItems.get(pending.work_item_id)).status).toBe('running');
  });
  it('等待中的未结束步骤仍占位，步骤结束后释放；补充和恢复重新竞争同一名额', async () => {
    const one = await admit(), two = await admit();
    await repos.skillRuns.claimLaunch(one.id, 'start', 1);
    await repos.runControls.change(one.id, state => recordRunStep(state, 'step', 'start', 1000));
    await repos.skillRuns.transition(one.id, 'waiting', '等待信息');
    expect(await repos.skillRuns.claimLaunch(two.id, 'start', 1)).toBe(false);
    await repos.runControls.change(one.id, state => recordRunStep(state, 'step', 'end', 2000));
    expect(await repos.skillRuns.claimLaunch(two.id, 'start', 1)).toBe(true);
    const resume = await repos.runControls.prepareResume({ runId: one.id, requestId: randomUUID(), hash: 'resume', message: { text: '补充' }, change() {} });
    expect(await repos.runControls.claimResume(resume.request_id, 1)).toBe(false);
    expect(await repos.runControls.claimRecovery(one.id, { text: '原输入' }, 1)).toBe(false);
    expect((await repos.runControls.resumes(one.id))[0].status).toBe('prepared');
    await repos.skillRuns.transition(two.id, 'completed', 'done');
    expect(await repos.runControls.claimResume(resume.request_id, 1)).toBe(true);
  });
  it('旧 Worker 与 Skill 相互计入上限，恢复旧 Worker 不能超额', async () => {
    const run = await admit(); await worker('old');
    const [launched, claimed] = await Promise.all([repos.skillRuns.claimLaunch(run.id, 'start', 1), repos.workItems.claimNext(1)]);
    expect(Number(launched) + Number(!!claimed)).toBe(1);
    if (claimed) {
      await repos.workItems.update('old', { status: 'completed' });
      expect(await repos.skillRuns.claimLaunch(run.id, 'start', 1)).toBe(true);
    }
    await expect(repos.workItems.update('old', { status: 'running' }, 1)).rejects.toThrow(/并发/);
    await repos.skillRuns.transition(run.id, 'completed', 'done');
    expect(await repos.workItems.update('old', { status: 'running' }, 1)).toMatchObject({ status: 'running' });
  });
  it('Run 的子交办沿用所属执行名额，不把同一运行重复计数', async () => {
    const run = await admit(); await repos.skillRuns.claimLaunch(run.id, 'start', 1);
    await worker('child-work', 'queued', run.session_id);
    expect(await repos.workItems.claimNext(1)).toMatchObject({ id: 'child-work', status: 'running' });
    const another = await admit(); expect(await repos.skillRuns.claimLaunch(another.id, 'start', 1)).toBe(false);
  });
  it('超时后仍在结束的作业继续占位，明确结束才释放', async () => {
    const one = await admit(), two = await admit(); await repos.skillRuns.claimLaunch(one.id, 'start', 1);
    await repos.skillRuns.nativeReceipt(one.id, 'job', one.session_id, 'job', 'start', {});
    await repos.skillRuns.transition(one.id, 'timed_out', '超时');
    expect(await repos.skillRuns.claimLaunch(two.id, 'start', 1)).toBe(false);
    await repos.skillRuns.nativeReceipt(one.id, 'job', one.session_id, 'job', 'end', { producerReported: true });
    expect(await repos.skillRuns.claimLaunch(two.id, 'start', 1)).toBe(true);
  });
  it('常规 poll 能启动已排队的确定性模板，不要求重启也不创建模型会话', async () => {
    const run = await admit(); await db.query("update pa24.skill_run set mode = 'template' where id = $1", [run.id]);
    let calls = 0;
    const engine = new SkillRuns({ host: {}, context: () => ({ cwd: '/workspace', binding: 'fixed', repos }), packages: {}, permissionHash: () => 'same', maxWorkers: () => 1,
      template: async () => { calls++; return '确定性结果'; }, control: work => work(), detached: work => work() });
    try { await engine.poll(); expect(calls).toBe(1); expect(await repos.skillRuns.get(run.id)).toMatchObject({ status: 'completed', result: '确定性结果' }); }
    finally { engine.dispose(); }
  });
});
