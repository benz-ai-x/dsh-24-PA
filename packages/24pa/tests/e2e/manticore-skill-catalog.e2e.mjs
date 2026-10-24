import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { SkillManagement } from '../../lib/skill-management.js';
import { editSkillPackage, exportSkillPackage, makeSkillPackage, readSkillFile, skillHash, SKILL_PACKAGE_PREVIEW_BYTES } from '../../lib/skill-package.js';

let root, host, binding, workspace, llm, packageDir, marker, managedPackage;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-manticore-catalog-'));
  workspace = join(root, 'workspace');
  await mkdir(join(workspace, '.dsh/skills'), { recursive: true });
  await writeFile(join(workspace, 'AGENTS.md'), '# 24私助隔离验证\n\n```json\n' + JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n```\n');
  // Feed the actual exporter output into the real filesystem provider on
  // startup: this verifies the fixed host's YAML/frontmatter contract.
  const manager = new SkillManagement({ registry: null, builtins: () => [{ name: 'roundtrip-skill', description: '可回读的说明："双引号"\n第二行', content: '仅用于隔离读取，不执行。', metadata: { track: 'agent', tools: ['pa24_memory'], params: { topic: '今日' } }, invocation: { modelInvocable: false, userInvocable: true } }], context: () => ({ cwd: null, binding: null, enabled: false, allowed: [] }), plans: async () => [] });
  const detail = await manager.inspect('builtin:roundtrip-skill', null);
  const exported = await manager.exportMarkdown(detail.id, detail.fingerprint, null);
  await writeFile(join(workspace, '.dsh/skills/roundtrip-skill.md'), exported.content);
  packageDir = join(workspace, '.dsh/skills/package-skill'); marker = join(root, 'python-executed.marker');
  const markdown = '---\n' + JSON.stringify({ name: 'package-skill', description: '二十文件目录包', metadata: { track: 'agent', tools: [], pa24: {
    schemaVersion: 1, mode: 'local', parameters: {}, expectedResult: '只读验证', completionCriteria: '不产生副作用',
  } } }) + '\n---\n目录包正文';
  const files = [
    { path: 'SKILL.md', bytes: Buffer.from(markdown) },
    { path: 'scripts/never-execute.py', bytes: Buffer.from(`from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('executed', encoding='utf-8')\n`) },
    { path: 'assets/pixel.bin', bytes: Buffer.from([0, 255, 1]) },
    { path: 'empty.txt', bytes: Buffer.alloc(0) },
    { path: 'references/' + Array.from({ length: 8 }, (_, index) => 'level-' + index).join('/') + '/item.txt', bytes: Buffer.from('深层长路径资源') },
    { path: 'long.txt', bytes: Buffer.alloc(SKILL_PACKAGE_PREVIEW_BYTES + 20, 97) },
    ...Array.from({ length: 14 }, (_, index) => ({ path: `references/group-${index % 3}/item-${index}.txt`, bytes: Buffer.from(`静态资源 ${index}`) })),
  ];
  managedPackage = makeSkillPackage(files);
  for (const file of files) {
    const path = join(packageDir, ...file.path.split('/')); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.bytes);
  }
  const scriptPath = join(root, 'mock-llm.json'); await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '普通读取不应请求此模型。' }] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json'), recordInputs: true });
  host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url } });
  binding = (await host.waitUntil(snapshot => !!snapshot.workspaceBinding, { label: 'Skill 目录工作区就绪' })).workspaceBinding;
}, 600_000);
afterAll(async () => { await host?.stop(); await llm?.close(); if (root) await rm(root, { recursive: true, force: true }); });

describe('M01a 真实 dsh Loader 与面板读取', () => {
  const directorySnapshot = async root => {
    const files = [];
    const walk = async (dir, prefix = '') => {
      for (const name of (await readdir(dir)).sort()) {
        const path = join(dir, name), relative = prefix + name, info = await stat(path);
        if (info.isDirectory()) await walk(path, relative + '/');
        else files.push([relative, skillHash(await readFile(path))]);
      }
    };
    await walk(root); return files;
  };
  const contentInput = detail => ({ id: detail.id, fingerprint: detail.fingerprint, workspaceBinding: binding,
    ...(detail.versionId ? { versionId: detail.versionId } : {}), ...(detail.packageHash ? { packageHash: detail.packageHash } : {}) });
  const change = payload => host.api('action', { type: 'skill.change', workspaceBinding: binding, requestId: randomUUID(), ...payload });

  it('真实目录包括内置原件和工作区导出的 Markdown，读取不产生运行或投递', async () => {
    const before = await host.api('snapshot');
    const catalog = await host.api('skills.catalog', { workspaceBinding: binding });
    expect(catalog.discovery).toBe('complete');
    expect(catalog.entries.some(row => row.type === 'persona')).toBe(true);
    expect(catalog.entries.some(row => row.type === 'setup')).toBe(true);
    const local = catalog.entries.find(row => row.name === 'roundtrip-skill' && row.source === 'project-dsh');
    expect(local?.status).toBe('loaded');
    const detail = await host.api('skills.inspect', { id: local.id, workspaceBinding: binding });
    expect(detail.content).toBe('仅用于隔离读取，不执行。');
    expect(detail.metadata).toMatchObject({ tools: ['pa24_memory'], params: { topic: '今日' } });
    const file = await host.api('skills.export', { id: detail.id, fingerprint: detail.fingerprint, workspaceBinding: binding });
    expect(file.filename).toBe('roundtrip-skill.md');
    expect(file.content).toContain('"disable-model-invocation": true');
    await expect(host.api('skills.inspect', { id: local.id, workspaceBinding: 'stale-binding' })).rejects.toThrow('工作区已切换');
    const after = await host.api('snapshot');
    expect(after.work).toEqual(before.work);
    expect(after.outbox).toEqual(before.outbox);
    expect(llm.requests).toHaveLength(0);
  });

  it('真实 Loader 三来源共享包清单与单文件预览，历史只读且普通阅读零业务副作用', async () => {
    const created = await change({ op: 'save', displayName: '受管包历史', filename: 'managed.zip', base64: (await exportSkillPackage(managedPackage)).toString('base64') });
    const id = 'managed:' + created.entry.id, versionId = created.entry.draft_version;
    const currentPackage = editSkillPackage(managedPackage, readSkillFile(managedPackage, 'SKILL.md').toString('utf8').replace('目录包正文', '当前版本 B'));
    const updated = await change({ op: 'save', id, expectedRevision: created.entry.revision, filename: 'managed.zip', base64: (await exportSkillPackage(currentPackage)).toString('base64') });
    await change({ op: 'delete', id, expectedRevision: updated.entry.revision });
    const before = await host.api('snapshot'), beforeTree = await directorySnapshot(join(workspace, '.dsh'));
    const beforeRuns = (await host.api('skills.runs', { workspaceBinding: binding })).total;
    const catalog = await host.api('skills.catalog', { workspaceBinding: binding });
    const builtin = catalog.entries.find(row => row.source === 'builtin' && row.status === 'loaded');
    const project = catalog.entries.find(row => row.name === 'package-skill' && row.source === 'project-dsh');
    expect(project?.status).toBe('loaded');

    const builtinDetail = await host.api('skills.inspect', { id: builtin.id, workspaceBinding: binding });
    const builtinInput = contentInput(builtinDetail), builtinManifest = await host.api('skills.package-content', builtinInput);
    expect(builtinManifest).toMatchObject({ source: 'builtin', snapshot: 'current-read', packageHash: builtinManifest.packageHash });
    expect(builtinManifest.files.map(file => file.path)).toEqual(['SKILL.md']);
    const builtinFile = await host.api('skills.package-content', { ...builtinInput, packageHash: builtinManifest.packageHash, path: 'SKILL.md' });
    expect(builtinFile).toMatchObject({ path: 'SKILL.md', packageBytes: builtinManifest.bytes, preview: { kind: 'text', truncated: false } });
    expect(builtinFile.preview.content).toContain(builtinDetail.content.trim());

    const projectDetail = await host.api('skills.inspect', { id: project.id, workspaceBinding: binding });
    const projectInput = contentInput(projectDetail), projectManifest = await host.api('skills.package-content', projectInput);
    expect(projectManifest).toMatchObject({ source: 'project-dsh', snapshot: 'current-read', workspaceBinding: binding });
    expect(projectManifest.files.map(file => file.path)).toEqual(managedPackage.files.map(file => file.path));
    expect(projectManifest.files).toHaveLength(20); expect(projectManifest.files.every(file => file.content === undefined)).toBe(true);
    expect(JSON.stringify(projectManifest)).not.toContain(workspace); expect(projectManifest.resourceBase).toBeUndefined();
    const python = await host.api('skills.package-content', { ...projectInput, packageHash: projectManifest.packageHash, path: 'scripts/never-execute.py' });
    expect(python.preview.kind).toBe('text'); expect(python.preview.content).toContain('python-executed.marker');
    expect(python.hash).toBe(managedPackage.files.find(file => file.path === python.path).hash);
    const binary = await host.api('skills.package-content', { ...projectInput, packageHash: projectManifest.packageHash, path: 'assets/pixel.bin' });
    expect(binary.preview).toEqual({ kind: 'binary', content: null, truncated: false });
    const long = await host.api('skills.package-content', { ...projectInput, packageHash: projectManifest.packageHash, path: 'long.txt' });
    expect(long.preview.kind).toBe('text'); expect(long.preview.truncated).toBe(true);
    expect(Buffer.byteLength(long.preview.content)).toBe(SKILL_PACKAGE_PREVIEW_BYTES);
    const empty = await host.api('skills.package-content', { ...projectInput, packageHash: projectManifest.packageHash, path: 'empty.txt' });
    expect(empty.preview).toEqual({ kind: 'text', content: '', truncated: false });

    const changedPath = 'references/group-0/item-0.txt', diskPath = join(packageDir, ...changedPath.split('/')), original = await readFile(diskPath);
    await writeFile(diskPath, '只修改资源，不修改定义');
    try {
      await expect(host.api('skills.package-content', { ...projectInput, packageHash: projectManifest.packageHash })).rejects.toThrow(/资源已变化/);
      await expect(host.api('skills.package-content', { ...projectInput, packageHash: projectManifest.packageHash, path: changedPath })).rejects.toThrow(/资源已变化/);
    } finally { await writeFile(diskPath, original); }
    await expect(host.api('skills.package-content', { ...projectInput, workspaceBinding: 'stale-binding' })).rejects.toThrow(/工作区/);
    await expect(host.api('skills.package-content', { ...projectInput, fingerprint: '0'.repeat(64) })).rejects.toThrow(/变更/);

    const managedDetail = await host.api('skills.version', { id, versionId, workspaceBinding: binding });
    expect(managedDetail.entry.status).toBe('deleted'); expect(managedDetail.packageHash).toMatch(/^[0-9a-f]{64}$/);
    const managedInput = contentInput(managedDetail), managedManifest = await host.api('skills.package-content', managedInput);
    expect(managedManifest).toMatchObject({ id, source: 'managed', snapshot: 'immutable-version', versionId, packageHash: managedDetail.packageHash });
    const historical = await host.api('skills.package-content', { ...managedInput, path: 'SKILL.md' });
    expect(historical).toMatchObject({ versionId, packageBytes: managedManifest.bytes, preview: { kind: 'text', truncated: false } });
    expect(historical.preview.content).toContain('目录包正文'); expect(historical.preview.content).not.toContain('当前版本 B');
    const managedResource = await host.api('skills.package-content', { ...managedInput, path: changedPath });
    expect(managedResource.preview.content).toBe('静态资源 0');
    await expect(host.api('skills.package-content', { ...managedInput, versionId: updated.entry.draft_version, path: 'SKILL.md' })).rejects.toThrow(/快照/);

    const after = await host.api('snapshot');
    expect(after.work).toEqual(before.work); expect(after.outbox).toEqual(before.outbox);
    expect((await host.api('skills.runs', { workspaceBinding: binding })).total).toBe(beforeRuns);
    expect(llm.requests).toHaveLength(0);
    await expect(access(marker)).rejects.toThrow();
    await expect(access(join(workspace, 'node_modules'))).rejects.toThrow();
    expect(await directorySnapshot(join(workspace, '.dsh'))).toEqual(beforeTree);
  }, 120_000);
});
