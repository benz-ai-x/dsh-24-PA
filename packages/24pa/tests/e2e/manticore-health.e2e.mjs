import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHealthFixture } from '../helpers/health-fixture.mjs';
let fixture;
beforeAll(async () => { fixture = await createHealthFixture(); }, 600_000);
afterAll(async () => fixture?.stop());
const api = (...args) => fixture.host.api(...args);
const binding = async () => (await api('snapshot')).workspaceBinding;
describe('M07 真实 Loader 接入健康', () => {
  it('普通刷新无外部动作，全量只读检查列实际覆盖，未用推送不伪装通过', async () => {
    const initial = await fixture.calls(); await api('health'); await api('health.snapshot', { workspaceBinding: await binding() }); await api('snapshot'); expect(await fixture.calls()).toHaveLength(initial.length);
    const legacy = await api('action', { type: 'connection.check' });
    const retained = await api('health.snapshot', { workspaceBinding: await binding() });
    expect(retained.evidence.find(row => row.scope === 'feishu.identity').checkedAt >= legacy.checkedAt).toBe(true);
    const report = await api('action', { type: 'health.check', workspaceBinding: await binding() });
    expect(report.requestedScopes).toContain('memory'); expect(report.evidence.find(row => row.scope === 'wecom.push').state).toBe('disabled');
    expect(report.evidence.find(row => row.scope === 'feishu.identity').state).toBe('verified');
    expect(report.evidence.find(row => row.scope === 'workspace').state).toBe('verified');
    expect((await fixture.calls()).every(row => !row.args.includes('create') && !row.args.includes('send'))).toBe(true);
    expect(JSON.stringify(await api('health'))).not.toContain('test-secret-not-disclosed');
  });
  it('明确测试经平台边界返回真实对象，重复与重启不重复创建，清理可追溯', async () => {
    const workspaceBinding = await binding(), requestId = randomUUID();
    const preview = await api('health.test.preview', { workspaceBinding, action: 'source.create', sourceId: 'personal-calendar' });
    expect((await fixture.events()).length).toBe(0);
    const result = await api('action', { type: 'health.test', workspaceBinding, requestId, confirm: true, ...preview });
    expect(result.status).toBe('succeeded'); expect(result.result.nativeId).toBeTruthy(); expect((await fixture.events()).filter(row => row.status !== 'canceled')).toHaveLength(1);
    await fixture.restart(); const after = await api('action', { type: 'health.test', workspaceBinding: await binding(), requestId, confirm: true, ...preview }); expect(after.replayed).toBe(true);
    expect((await fixture.events()).filter(row => row.status !== 'canceled')).toHaveLength(1);
    const clean = await api('action', { type: 'health.test.cleanup', workspaceBinding: await binding(), testId: requestId, confirm: true }); expect(clean.cleanup.state).toBe('accepted');
    expect((await fixture.events()).at(-1).status).toBe('canceled');
    const before = (await fixture.calls()).length; await api('action', { type: 'health.test.cleanup', workspaceBinding: await binding(), testId: requestId, confirm: true }); expect(await fixture.calls()).toHaveLength(before);
  });
  it('企微真人变化阻断原身份，旧证据失效，确认新绑定不迁移旧登记', async () => {
    await api('action', { type: 'health.check', workspaceBinding: await binding(), scopes: ['wecom'] });
    await writeFile(fixture.wecomState, JSON.stringify({ ownerUserid: 'wou_different_person' }));
    const check = await api('action', { type: 'health.check', workspaceBinding: await binding(), scopes: ['wecom'] }); expect(check.evidence.find(row => row.scope === 'wecom.identity').state).toBe('fault');
    const snapshot = await api('health.snapshot', { workspaceBinding: await binding() }); expect(snapshot.identity.changed).toBe(true); expect(snapshot.identity.accepted.ownerId).toBe('wou_test_owner');
    const oldSources = (await api('sources')).entries;
    await api('action', { type: 'health.identity-accept', workspaceBinding: await binding(), configVersion: snapshot.configVersion, identity: snapshot.identity.observed, confirm: true });
    expect((await api('sources')).entries.map(row => row.ownerId)).toEqual(oldSources.map(row => row.ownerId));
    await writeFile(fixture.wecomState, JSON.stringify({ ownerUserid: 'wou_test_owner' }));
  });
  it('配置保存与生效版本、冲突及工作规则有真实结果', async () => {
    const snap = await api('snapshot'), path = join(fixture.workspace, 'AGENTS.md'), before = await readFile(path, 'utf8');
    await writeFile(path, before + '\n后续本地规则不可覆盖。\n');
    const evidence = await api('workspace.evidence'); expect(evidence.state).toBe('saved_not_applied'); expect(evidence.savedHash).not.toBe(evidence.activeHash);
    await expect(api('action', { type: 'workspace.config-update', workspaceBinding: snap.workspaceBinding, expectedConfigHash: snap.workspace.sourceHash, config: { maxWorkers: 4 } })).rejects.toThrow(/已被修改/);
    expect(await readFile(path, 'utf8')).toContain('后续本地规则');
    await api('action', { type: 'workspace.reload' });
    const refreshed = await api('snapshot'); await api('action', { type: 'workspace.config-update', workspaceBinding: refreshed.workspaceBinding, expectedConfigHash: refreshed.workspace.sourceHash, config: { maxWorkers: 4 } });
    expect((await api('workspace.evidence')).state).toBe('applied'); expect(await readFile(path, 'utf8')).toContain('后续本地规则');
    const health = await api('health.snapshot', { workspaceBinding: await binding() }); expect(health.evidence.some(row => row.state === 'stale')).toBe(true);
  });
});
