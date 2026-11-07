import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootHost } from '../helpers/host.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { readSecretStore } from '../../lib/secrets.js';

const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
let root, workspace, host, pg, binding;
const source = () => readFile(join(workspace, 'AGENTS.md'), 'utf8');
const impact = (config = {}, secretKeys = []) => host.api('workspace.config-impact', { workspaceBinding: binding, config, secretKeys });
const change = (config, version) => host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config, expectedImpactVersion: version });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f52-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  if (storage === 'postgres') pg = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# F52 isolated workspace\n\nKeep these rules.\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, ownerOpenId: 'ou_f52', mode: 'demo' }, null, 2) + '\n```\n');
  host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_PG_DSN: pg?.dsn || 'f52-unused-pg-env', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:9' } });
  const snapshot = await host.waitUntil(s => s.workspace?.config?.storage === storage, { label: 'F52 workspace ready' });
  binding = snapshot.workspaceBinding;
}, 180_000);
afterAll(async () => { await host?.stop(); await pg?.stop(); await rm(root, { recursive: true, force: true }); });

describe(`F52 real Loader/RPC and ${storage} persistence`, () => {
  it('先读影响不写配置；保存沿原流程重载并保留工作规则', async () => {
    const before = await source(), config = { notifyChannel: 'wecom' };
    const preview = await impact(config); expect(preview.kinds.targets).toBe(true);
    expect(await source()).toBe(before);
    const saved = await change(config, preview.version);
    expect(saved.workspace.config.notifyChannel).toBe('wecom');
    expect((await source()).split('```json')[0]).toBe(before.split('```json')[0]);
    expect((await host.api('workspace.evidence', { workspaceBinding: binding })).state).toBe('applied');
  });
  it('旧说明不覆盖新版本，重新读取后可沿同一工作区继续保存', async () => {
    const patch = { timeZone: 'UTC' }, shown = await impact(patch);
    await change({ maxWorkers: 3 }); const before = await source();
    await expect(change(patch, shown.version)).rejects.toThrow(/影响已变化/);
    expect(await source()).toBe(before);
    const next = await impact(patch); expect(Object.values(next.kinds).some(Boolean)).toBe(false);
    expect((await change(patch, next.version)).workspace.config).toMatchObject({ maxWorkers: 3, timeZone: 'UTC', storage });
  });
  it('PG 密钥替换与清除保留环境覆盖、语音及独立配置文件，不迁移账本', async () => {
    const before = await source();
    await host.api('action', { type: 'workspace.secret-update', workspaceBinding: binding, values: { volcTtsKey: 'f52-retained-voice' } });
    for (const value of ['f52-prepared-pg', 'f52-replaced-pg', '']) {
      const preview = await impact({}, ['pgDsn']); expect(preview.storage).toBe(storage);
      const saved = await host.api('action', { type: 'workspace.secret-update', workspaceBinding: binding, values: { pgDsn: value }, expectedImpactVersion: preview.version });
      expect(saved.secrets.pgDsn).toEqual({ set: true, source: 'env' });
      expect(saved.workspace.config.storage).toBe(storage);
      expect(JSON.stringify(saved)).not.toMatch(/f52-prepared-pg|f52-replaced-pg|f52-retained-voice/);
      const store = await readSecretStore(workspace);
      expect(store.pgDsn).toBe(value || undefined); expect(store.volcTtsKey).toBe('f52-retained-voice');
    }
    expect(await source()).toBe(before);
  });
  it('版本说明不能放宽主人归属或工作区绑定规则', async () => {
    const before = await source(), patch = { ownerOpenId: 'another-owner' }, shown = await impact(patch);
    await expect(change(patch, shown.version)).rejects.toThrow(/账本主人/);
    await expect(host.api('workspace.config-impact', { workspaceBinding: 'stale', config: patch })).rejects.toThrow(/工作区已切换/);
    await expect(host.api('action', { type: 'workspace.secret-update', workspaceBinding: 'stale', values: { pgDsn: 'stale' }, expectedImpactVersion: shown.version })).rejects.toThrow(/工作区已切换/);
    expect(await source()).toBe(before);
  });
  it('两种后端都有 PG 引用维护路径，活跃 PG 连接变化仍拒绝热切换', async () => {
    const before = await source(), patch = { pgDsnEnv: 'F52_PREPARED_PG' }, shown = await impact(patch);
    expect(shown.kinds.postgres).toBe(true);
    if (storage === 'postgres') {
      await expect(change(patch, shown.version)).rejects.toThrow(/不能热重载/);
      expect(await source()).toBe(before);
    } else {
      const saved = await change(patch, shown.version);
      expect(saved.workspace.config).toMatchObject({ pgDsnEnv: 'F52_PREPARED_PG', storage: 'sqlite' });
    }
  });
});
