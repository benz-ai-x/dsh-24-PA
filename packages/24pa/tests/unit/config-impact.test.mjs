import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, join, readFile } from '../helpers/runtime.mjs';
import { effectiveSources, sourceConfigurationFingerprint } from '../../lib/source-config.js';
import { writeWorkspaceConfiguration } from '../../lib/workspace-config.js';
import { readSecretStore, writeSecretStore } from '../../lib/secrets.js';

let f, workspace, binding;
beforeEach(async () => {
  f = await fixture({ env: { PA24_PG_DSN: 'fixture-env-dsn' } });
  workspace = await f.workspace('config', { ownerOpenId: 'ou_owner' });
  await f.rt.bind(workspace); binding = f.rt.workspaceBinding;
});
afterEach(async () => { vi.restoreAllMocks(); await f.cleanup(); });
const preview = (config = {}, keys = []) => f.rt.inspectWorkspace(() => f.rt.configurationImpact(config, keys, binding));
const source = () => readFile(join(workspace, 'AGENTS.md'), 'utf8');

describe('保存前影响读取与实际写入边界', () => {
  it('普通音色和来源名称无额外影响，变更默认/身份才说明对应边界；读取无写入', async () => {
    const before = await source(), entries = effectiveSources(f.rt.config);
    entries.entries[0].name = '只改名称';
    expect((await preview({ sources: entries })).kinds).toEqual({ identity: false, targets: false, postgres: false });
    expect((await preview({ tts: { voice: 'another' } })).kinds).toEqual({ identity: false, targets: false, postgres: false });
    entries.defaults.calendar = null;
    expect((await preview({ sources: entries })).kinds.targets).toBe(true);
    const identity = await preview({ larkProfile: 'other' });
    expect(identity.kinds.identity).toBe(true); expect(identity.impacts.outbox).toBe(0);
    expect(await source()).toBe(before); expect(await readSecretStore(workspace)).toEqual({});
    expect(f.prompts).toEqual([]);
  });
  it('来源名称保存也预告磁盘尚未生效的身份与凭据，不将附带应用伪装成普通改名', async () => {
    const sources = effectiveSources(f.rt.config), sourceHash = sourceConfigurationFingerprint(sources);
    sources.entries[0].name = '只改名称';
    await writeWorkspaceConfiguration(workspace, { larkProfile: 'pending-profile' }, async () => {});
    await writeSecretStore(workspace, { feishuAppSecret: 'pending-secret' });
    expect(f.rt.config.larkProfile).toBe('default');
    const shown = await preview({ sources });
    expect(shown).toMatchObject({ pendingSavedChanges: true, kinds: { identity: true, targets: false } });
    expect(shown.impacts.outbox).toBe(0);
    await f.rt.updateWorkspaceConfig({ sources }, binding, sourceHash, undefined, shown.version);
    expect(f.rt.config.larkProfile).toBe('pending-profile');
    expect(f.rt.secretStatusSnapshot().feishuAppSecret.set).toBe(true);
    expect((await f.rt.configurationEvidence(binding)).state).toBe('applied');
  });
  it('说明后新增未决投递会在写入前拒绝，重新读取仍保留实际身份阻断', async () => {
    const patch = { larkProfile: 'other' }, before = await source(), shown = await preview(patch);
    await f.rt.repos.outbox.enqueue({ dedupKey: 'f52-unsettled', channel: 'local', target: 'owner', kind: 'text', content: { text: 'fixture' } });
    await expect(f.rt.updateWorkspaceConfig(patch, binding, undefined, undefined, shown.version)).rejects.toThrow(/影响已变化/);
    expect(await source()).toBe(before);
    const refreshed = await preview(patch); expect(refreshed.impacts.outbox).toBe(1);
    await expect(f.rt.updateWorkspaceConfig(patch, binding, undefined, undefined, refreshed.version)).rejects.toThrow(/原待发/);
    expect(await source()).toBe(before);
  });
  it('配置和密钥的并发修改使旧说明失效，不覆盖另一份已保存值', async () => {
    const patch = { notifyChannel: 'wecom' }, shown = await preview(patch);
    await f.rt.updateWorkspaceConfig({ maxWorkers: 4 }, binding);
    const before = await source();
    await expect(f.rt.updateWorkspaceConfig(patch, binding, undefined, undefined, shown.version)).rejects.toThrow(/尚未写入/);
    expect(await source()).toBe(before);
    const secret = await preview({}, ['pgDsn']);
    await writeSecretStore(workspace, { pgDsn: 'concurrent-dsn', volcTtsKey: 'preserved-voice-key' });
    await expect(f.rt.updateWorkspaceSecrets({ pgDsn: 'old-draft' }, binding, secret.version)).rejects.toThrow(/尚未写入/);
    expect(await readSecretStore(workspace)).toEqual({ pgDsn: 'concurrent-dsn', volcTtsKey: 'preserved-voice-key' });
  });
  it('SQLite 下可准备/替换/清除 PG 凭据；环境覆盖和未改语音值保留，预览不泄露秘密', async () => {
    const before = await source();
    await f.rt.updateWorkspaceSecrets({ volcTtsKey: 'voice-retained' }, binding);
    for (const value of ['pg-prepared', 'pg-replaced', '']) {
      const shown = await preview({}, ['pgDsn']);
      expect(shown).toMatchObject({ storage: 'sqlite', kinds: { postgres: true } });
      expect(JSON.stringify(shown)).not.toMatch(/fixture-env-dsn|pg-prepared|pg-replaced|voice-retained/);
      await f.rt.updateWorkspaceSecrets({ pgDsn: value }, binding, shown.version);
      expect((await readSecretStore(workspace)).pgDsn).toBe(value || undefined);
      expect((await readSecretStore(workspace)).volcTtsKey).toBe('voice-retained');
      expect(f.rt.secretStatusSnapshot().pgDsn).toEqual({ set: true, source: 'env' });
      expect(f.rt.config.storage).toBe('sqlite');
    }
    expect(await source()).toBe(before);
  });
  it('跨工作区的影响读取和过期保存都拒绝', async () => {
    const shown = await preview({ maxWorkers: 3 });
    await f.rt.bind(await f.workspace('other'));
    await expect(preview({ maxWorkers: 3 })).rejects.toThrow(/工作区已切换/);
    await expect(f.rt.updateWorkspaceConfig({ maxWorkers: 3 }, binding, undefined, undefined, shown.version)).rejects.toThrow(/工作区已切换/);
    expect(f.rt.config.maxWorkers).toBe(2);
  });
  it('密钥写盘后应用失败，明确已保存未生效且不回显刚输入的值', async () => {
    vi.spyOn(f.rt, 'prepareTransport').mockRejectedValue(new Error('connect failed: newly-entered-secret'));
    const shown = await preview({}, ['feishuAppSecret']);
    const error = await f.rt.updateWorkspaceSecrets({ feishuAppSecret: 'newly-entered-secret' }, binding, shown.version).catch(error => error);
    expect(error.evidence.state).toBe('saved_not_applied');
    expect(error.message).not.toContain('newly-entered-secret');
    expect((await readSecretStore(workspace)).feishuAppSecret).toBe('newly-entered-secret');
    expect(f.rt.secretStatusSnapshot().feishuAppSecret.set).toBe(false);
    expect((await f.rt.configurationEvidence(binding)).state).toBe('saved_not_applied');
  });
});
