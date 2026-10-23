import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { SkillPackages } from '../../lib/skill-packages.js';
import { SkillManagement } from '../../lib/skill-management.js';
import { SkillRuns } from '../../lib/skill-runs.js';
import { parseSkillMarkdown } from '../../lib/skill-package.js';
import { startPgCluster } from '../helpers/pg.mjs';

const markdown = (body, metadata = { track: 'template', kind: 'morning' }) => `---\n${JSON.stringify({ name: 'original-template', description: '原始模板', metadata })}\n---\n${body}`;
for (const backend of ['sqlite', 'postgres']) describe(`固定 Skill 来源运行 (${backend})`, () => {
  let db, cluster, root, repos, packages, manager, runs, definition, registryDefinition, path, executions;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-skill-selection-'));
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
    path = join(root, '.dsh/skills/original-template/SKILL.md'); await mkdir(join(root, '.dsh/skills/original-template'), { recursive: true });
  });
  afterAll(async () => { runs?.dispose(); await db?.close(); await cluster?.stop(); await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    runs?.dispose(); executions = 0; definition = parseSkillMarkdown(markdown('模板 A'));
    registryDefinition = { ...definition, source: 'project-dsh', provider: 'filesystem', path };
    await writeFile(path, markdown('模板 A'));
    packages = new SkillPackages({ context: () => ({ cwd: root, binding: 'binding', repo: repos.skills }), registry: null,
      plans: async () => [], pausePlan: async () => {}, check: async () => [] });
    manager = new SkillManagement({ context: () => ({ cwd: root, binding: 'binding', enabled: true, allowed: [] }),
      builtins: () => [definition], registry: { list: async () => [registryDefinition], get: async () => registryDefinition }, plans: async () => [], packages });
    runs = new SkillRuns({ host: {}, packages, management: manager, context: () => ({ cwd: root, binding: 'binding', repos }),
      sourceSession: async () => 'source', tools: async () => [], permissionHash: () => 'permission', checkBusiness() {}, checkTemplate() {},
      template: async (def, parameters) => { executions++; return `${def.content}: ${parameters.title ?? '默认标题'}`; },
      lease: work => work(), control: work => work(), detached: work => work() });
  });
  const start = async input => {
    const preview = await runs.preview({ ...input, workspaceBinding: 'binding' });
    return runs.start({ ...input, workspaceBinding: 'binding', requestId: randomUUID(), confirm: true, fingerprint: preview.fingerprint });
  };
  it('内置原件直接执行、固定完整包和参数，不产生个人副本', async () => {
    const before = await repos.skills.list();
    const result = await start({ id: 'builtin:original-template', parameters: { title: '项目汇总' } });
    const run = await repos.skillRuns.get(result.run.id);
    expect(run).toMatchObject({ skill_id: 'builtin:original-template', status: 'completed', result: '模板 A: 项目汇总' });
    expect(run.version_id).toBe(run.snapshot.package.hash); expect(run.snapshot.provider.id).toBe('builtin:original-template');
    expect(await repos.skills.list()).toEqual(before); expect(executions).toBe(1);
    expect((await runs.list({ id: 'builtin:original-template', workspaceBinding: 'binding' })).rows.some(row => row.id === run.id)).toBe(true);
    await expect(runs.preview({ id: 'builtin:original-template', parameters: { silentlyIgnored: true }, workspaceBinding: 'binding' })).rejects.toThrow(/仅支持/);
  });
  it('文件目录缓存旧定义或预览后变更，均不能执行未经确认的内容', async () => {
    const id = (await manager.list('binding')).entries.find(row => row.source === 'project-dsh').id;
    const input = { id, workspaceBinding: 'binding' }, preview = await runs.preview(input);
    await writeFile(path, markdown('模板 B'));
    await expect(runs.start({ ...input, fingerprint: preview.fingerprint, confirm: true, requestId: randomUUID() })).rejects.toThrow(/不一致/);
    registryDefinition = { ...parseSkillMarkdown(markdown('模板 B')), source: 'project-dsh', provider: 'filesystem', path };
    await expect(runs.start({ ...input, fingerprint: preview.fingerprint, confirm: true, requestId: randomUUID() })).rejects.toThrow(/重新预览/);
    const result = await start(input); expect(result.run.result).toBe('模板 B: 默认标题');
    expect(executions).toBe(1);
  });
  it('原快照接续保留旧结果和包；当前配置接续使用明确选择的新版本', async () => {
    const original = await start({ id: 'builtin:original-template', parameters: { title: '旧参数' } });
    definition = parseSkillMarkdown(markdown('模板 B'));
    const old = await start({ rerunId: original.run.id, configuration: 'original' });
    expect(old.run.result).toBe('模板 A: 旧参数'); expect(old.run.work_item_id).toBe(original.run.work_item_id);
    const current = await start({ rerunId: old.run.id, configuration: 'current', parameters: { title: '新参数' } });
    expect(current.run.result).toBe('模板 B: 新参数');
    expect((await repos.skillRuns.get(original.run.id)).result).toBe('模板 A: 旧参数');
  });
  it('同一原件请求跨调用防重；未决回执阻挡全新执行', async () => {
    const input = { id: 'builtin:original-template', workspaceBinding: 'binding' }, preview = await runs.preview(input);
    const command = { ...input, requestId: randomUUID(), confirm: true, fingerprint: preview.fingerprint };
    const results = await Promise.all([runs.start(command), runs.start(command)]);
    expect(results[0].run.id).toBe(results[1].run.id); expect(executions).toBe(1);
    await repos.skillRuns.nativeReceipt(results[0].run.id, 'job', results[0].run.session_id, 'unfinished-job', 'start', {});
    await expect(runs.preview(input)).rejects.toThrow(/核对/);
    await repos.skillRuns.nativeReceipt(results[0].run.id, 'job', results[0].run.session_id, 'unfinished-job', 'end', { producerReported: true });
  });
});
