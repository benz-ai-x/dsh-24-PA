import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootHost } from '../helpers/host.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { SkillManagement } from '../../lib/skill-management.js';

let root, host, binding;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-manticore-catalog-'));
  const workspace = join(root, 'workspace');
  await mkdir(join(workspace, '.dsh/skills'), { recursive: true });
  await writeFile(join(workspace, 'AGENTS.md'), '# 24私助隔离验证\n\n```json\n' + JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n```\n');
  // Feed the actual exporter output into the real filesystem provider on
  // startup: this verifies the fixed host's YAML/frontmatter contract.
  const manager = new SkillManagement({ registry: null, builtins: () => [{ name: 'roundtrip-skill', description: '可回读的说明："双引号"\n第二行', content: '仅用于隔离读取，不执行。', metadata: { track: 'agent', tools: ['pa24_memory'], params: { topic: '今日' } }, invocation: { modelInvocable: false, userInvocable: true } }], context: () => ({ cwd: null, binding: null, enabled: false, allowed: [] }), plans: async () => [] });
  const detail = await manager.inspect('builtin:roundtrip-skill', null);
  const exported = await manager.exportMarkdown(detail.id, detail.fingerprint, null);
  await writeFile(join(workspace, '.dsh/skills/roundtrip-skill.md'), exported.content);
  host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake' } });
  binding = (await host.api('snapshot')).workspaceBinding;
}, 600_000);
afterAll(async () => { await host?.stop(); if (root) await rm(root, { recursive: true, force: true }); });

describe('M01a 真实 dsh Loader 与面板读取', () => {
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
  });
});
