import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { ConnectionHealth } from '../../lib/connection-health.js';
import { ConnectionTests } from '../../lib/connection-tests.js';
import { SourceRegistry, unknownCapabilities } from '../../lib/source-registry.js';
import { writeWorkspaceConfiguration } from '../../lib/workspace-config.js';
import { hash } from '../../lib/util.js';
import { redactDiagnostic } from '../../lib/diagnostic-redaction.js';
import { startPgCluster } from '../helpers/pg.mjs';
for (const backend of ['sqlite', 'postgres']) describe(`M07 ${backend}`, () => {
  let db, cluster, root, repos, current, version, now, silent, calls, faults, registry, health, tests, deps, testDeps, attempts;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-health-'));
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else db = new SqliteDb(join(root, 'ledger.db'));
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    for (const table of ['health_evidence', 'health_test', 'health_monitor', 'health_identity', 'source_evidence', 'source_registration', 'source_registry_state', 'outbox', 'inbox']) await db.query(`delete from pa24.${table}`);
    current = { ...DEFAULT_CONFIG, mode: 'feishu', ownerOpenId: 'ou_owner', notifyChannel: 'wecom', sources: { version: 1,
      entries: [{ id: 'calendar-a', domain: 'calendar', platform: 'feishu', name: '本人日历', purpose: 'personal', ownerId: 'ou_owner', resourceKind: 'calendar', resourceId: 'cal-a', filter: 'all', access: 'readwrite', enabled: true }], defaults: { calendar: 'calendar-a', todo: null }, mappings: [], meetingDurationMinutes: null } };
    version = 'config-1'; now = new Date('2026-10-23T01:00:00Z'); silent = null; calls = 0; attempts = []; faults = true;
    registry = new SourceRegistry({ repo: () => repos.sources, config: () => current, connectionHash: () => version, gate: (_key, run) => run(), probe: async source => {
      calls++; return { state: 'verified', checkedAt: now.toISOString(), identity: { platform: source.platform, ownerId: source.ownerId, authority: 'app:1' }, resource: { kind: source.resourceKind, id: source.resourceId }, capabilities: { ...unknownCapabilities(), read: 'allowed', create: 'allowed' }, message: '原身份和资源只读核验' };
    } });
    deps = { repo: () => repos.health, outbox: () => repos.outbox, config: () => current, version: () => version, registry, gate: (_key, run) => run(), now: () => now,
      local: async () => ({ state: 'verified', coverage: '实际文件', message: '可读', impact: '不证明远端', nextSteps: [] }), silentUntil: async () => silent,
      notify: async (dedupKey, text) => ({ dedupKey, channel: 'wecom', target: 'owner', kind: 'text', content: { text } }),
      feishu: async () => { calls++; return { auth: { state: 'ok' }, cli: { state: 'ok' }, source: { state: 'ok' }, resources: [], nextSteps: [] }; },
      wecom: async () => { calls++; return { cli: { state: 'ok' }, identity: { state: 'ok', message: '真人与机器人一致' }, services: [{ id: 'calendar', state: faults ? 'expired' : 'ok', message: faults ? '授权过期' : '可读' }, { id: 'push', state: 'unverified', message: '未发送' }], nextSteps: ['原账号续期'] }; } };
    health = new ConnectionHealth(deps);
    testDeps = { repo: () => repos.health, config: () => current, version: () => version, registry, gate: (_key, run) => run(),
      assertBinding: value => { if (value !== 'binding-1') throw Error('工作区已切换'); }, feishuIdentity: async () => {}, wecomIdentity: async () => ({ platform: 'wecom', ownerId: 'owner', authority: 'bot:original' }),
      send: async (platform, target, body, key) => { attempts.push({ platform, target, body, key }); return { messageId: platform === 'wecom' ? 'wecom:local-key' : 'om-real' }; },
      lark: async args => { attempts.push(args); return { data: args.includes('create') ? { event: { event_id: 'event-1' } } : {} }; },
      wecom: async args => { attempts.push(args); throw Error('本测试不应调用'); } };
    tests = new ConnectionTests(testDeps);
  });
  it('刷新无探测，无活动不是故障，新配置不能沿用旧证据', async () => {
    expect((await health.snapshot()).evidence.find(row => row.scope === 'feishu.receive').state).toBe('no_activity'); expect(calls).toBe(0);
    await health.check(['workspace', 'wecom']); expect(calls).toBe(1); expect((await health.snapshot()).evidence.find(row => row.scope === 'wecom.push-authorization').state).toBe('unverified');
    version = 'config-2'; expect((await health.snapshot()).evidence.find(row => row.scope === 'workspace').state).toBe('stale'); expect(calls).toBe(1);
  });
  it('六小时巡检、静默、重启去重和每日限额；失败不改投', async () => {
    silent = new Date(now.getTime() + 3600_000); await health.monitorWecom(); expect(calls).toBe(1); expect(await repos.outbox.recent()).toHaveLength(0);
    now = new Date(now.getTime() + 2 * 3600_000); silent = null; await new ConnectionHealth(deps).monitorWecom(); expect(calls).toBe(1); expect(await repos.outbox.recent()).toHaveLength(1);
    now = new Date(now.getTime() + 6 * 3600_000); await health.monitorWecom(); expect(calls).toBe(2); expect(await repos.outbox.recent()).toHaveLength(1);
    const row = (await repos.outbox.recent())[0]; await repos.outbox.mark(row.id, { status: 'unknown', error: '网络回执丢失' });
    expect((await health.snapshot()).monitor.delivery).toMatchObject({ channel: 'wecom', status: 'unknown', last_error: '网络回执丢失' });
    faults = false; now = new Date(now.getTime() + 24 * 3600_000); await health.monitorWecom(); expect((await health.snapshot()).monitor.problem).toBeNull(); expect(await repos.outbox.recent()).toHaveLength(1);
  });
  it('显式确认发送，重复请求仅返回原回执，企微本地ID不冒充原生ID', async () => {
    const preview = await tests.preview({ workspaceBinding: 'binding-1', action: 'wecom.push' }); expect(attempts).toHaveLength(0);
    await expect(tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-000000001', ...preview })).rejects.toThrow(/明确确认/);
    expect(await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-000000001', ...preview, confirm: true })).toMatchObject({ status: 'succeeded', result: { nativeMessageId: null, deliveryId: 'wecom:local-key' } });
    expect((await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-000000001', ...preview, confirm: true })).replayed).toBe(true); expect(attempts).toHaveLength(1);
  });
  it('只读企微检查保留独立的平台推送回执', async () => {
    await repos.health.save({ scope: 'wecom.push', state: 'verified', configVersion: version, checkedAt: now.toISOString(), coverage: '实际平台回执', message: '平台已接纳', impact: '', nextSteps: [], detail: { deliveryId: 'original-delivery' } });
    await health.check(['wecom']);
    const rows = (await health.snapshot()).evidence;
    expect(rows.find(row => row.scope === 'wecom.push')).toMatchObject({ state: 'verified', detail: { deliveryId: 'original-delivery' } });
    expect(rows.find(row => row.scope === 'wecom.push-authorization').state).toBe('unverified');
  });
  it('同真人更换已接受机器人后不能复用旧测试预览', async () => {
    const old = await tests.preview({ workspaceBinding: 'binding-1', action: 'wecom.push' });
    testDeps.wecomIdentity = async () => ({ platform: 'wecom', ownerId: 'owner', authority: 'bot:replacement' });
    await expect(tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-changed-bot', ...old, confirm: true })).rejects.toThrow(/机器人/);
    expect(attempts).toHaveLength(0);
    const updated = await tests.preview({ workspaceBinding: 'binding-1', action: 'wecom.push' });
    expect((await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-new-bot-01', ...updated, confirm: true })).status).toBe('succeeded');
    expect(attempts).toHaveLength(1);
  });
  it('中断的测试不重做，新配置必须重新预览，旧工作区拒绝写入', async () => {
    const preview = await tests.preview({ workspaceBinding: 'binding-1', action: 'feishu.send' });
    await repos.health.prepareTest('request-000000002', preview.fingerprint, version, preview.plan); await repos.health.updateTest('request-000000002', 'running', { message: '进程中断' });
    expect((await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-000000002', ...preview, confirm: true })).status).toBe('running'); expect(attempts).toHaveLength(0);
    version = 'changed'; await expect(tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-000000003', ...preview, confirm: true })).rejects.toThrow(/配置或身份/);
    await expect(tests.execute({ workspaceBinding: 'binding-old', requestId: 'request-000000003', ...preview, confirm: true })).rejects.toThrow(/工作区/);
  });
  it('资源测试固定具体目标且无邀请无提醒，清理另行确认且不重复', async () => {
    const preview = await tests.preview({ workspaceBinding: 'binding-1', action: 'source.create', sourceId: 'calendar-a' });
    const result = await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-000000004', ...preview, confirm: true });
    expect(result).toMatchObject({ status: 'succeeded', result: { nativeId: 'event-1' } }); expect(attempts[0]).toContain('cal-a'); expect(result.plan.parameters.title).toContain('request-000000004');
    expect(attempts[0].join(' ')).toContain('"reminders":[]'); expect(attempts[0].join(' ')).not.toContain('attendees');
    await tests.cleanup({ workspaceBinding: 'binding-1', testId: result.id, confirm: true }); await tests.cleanup({ workspaceBinding: 'binding-1', testId: result.id, confirm: true }); expect(attempts).toHaveLength(2); expect(attempts[1]).toContain('event-1');
    current.sources.entries = []; current.sources.defaults.calendar = null; await expect(tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-000000005', ...preview, confirm: true })).rejects.toThrow(/允许写入/);
  });
  it('绑定变更保留旧身份，确认新绑定也不复活旧成功证据', async () => {
    const original = { ownerId: 'owner', authority: 'bot:old' }, changed = { ownerId: 'owner', authority: 'bot:new' };
    await repos.health.observeIdentity('wecom', original); await repos.health.save({ scope: 'wecom.push', state: 'verified', configVersion: version, checkedAt: '2026-10-22T00:00:00Z', coverage: '旧回执', message: '旧成功', impact: '', nextSteps: [] });
    expect(await repos.health.observeIdentity('wecom', changed)).toMatchObject({ accepted: original, observed: changed, changed: true }); expect((await health.snapshot()).evidence.find(row => row.scope === 'wecom.push').state).toBe('stale');
    await expect(repos.health.acceptIdentity('wecom', original)).rejects.toThrow(/已更新/); await repos.health.acceptIdentity('wecom', changed); expect((await health.snapshot()).evidence.find(row => row.scope === 'wecom.push').state).toBe('stale');
  });
  it('来源及汇总成功证据随对应身份失效，其他平台来源保持有效', async () => {
    const entry = { ...current.sources.entries[0], id: 'wecom-calendar', platform: 'wecom', resourceKind: 'authorized_scope', resourceId: 'authorized' };
    current.sources.entries.push(entry);
    await health.check(['sources']);
    expect((await health.snapshot()).evidence.find(row => row.scope === 'sources').state).toBe('verified');
    await repos.health.observeIdentity('wecom', { ownerId: 'ou_owner', authority: 'bot:old' });
    await repos.health.observeIdentity('wecom', { ownerId: 'ou_owner', authority: 'bot:new' });
    let rows = (await health.snapshot()).evidence;
    expect(rows.find(row => row.scope === 'source:wecom-calendar').state).toBe('stale');
    expect(rows.find(row => row.scope === 'sources').state).toBe('stale');
    expect(rows.find(row => row.scope === 'source:calendar-a').state).toBe('verified');
    await repos.health.acceptIdentity('wecom', { ownerId: 'ou_owner', authority: 'bot:new' });
    rows = (await health.snapshot()).evidence;
    expect(rows.find(row => row.scope === 'source:wecom-calendar').state).toBe('stale');
  });
  it('次级证据写入失败保留平台成功回执，不降级或重做业务动作', async () => {
    const preview = await tests.preview({ workspaceBinding: 'binding-1', action: 'feishu.send' }), save = repos.health.save;
    repos.health.save = async () => { throw Error('evidence write failed'); };
    try {
      const result = await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-evidence-fail', ...preview, confirm: true });
      expect(result).toMatchObject({ status: 'succeeded', result: { nativeMessageId: 'om-real' }, evidenceError: 'evidence write failed' });
      expect((await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-evidence-fail', ...preview, confirm: true })).status).toBe('succeeded');
      expect(attempts).toHaveLength(1);
    } finally { repos.health.save = save; }
  });
  it('未知结果与诊断脱敏后保存，不将失败当成无活动，也不盲重发', async () => {
    const secret = 'super-private-secret';
    testDeps.sanitize = value => redactDiagnostic(value, [secret]);
    testDeps.send = async () => { attempts.push('send'); throw Error(`raw=${secret} access_token=private-token Authorization: Bearer private-auth`); };
    const preview = await tests.preview({ workspaceBinding: 'binding-1', action: 'feishu.send' });
    const result = await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-unknown-secret', ...preview, confirm: true });
    expect(result.status).toBe('unknown'); expect(JSON.stringify(result)).not.toMatch(/super-private-secret|private-token|private-auth/);
    await tests.execute({ workspaceBinding: 'binding-1', requestId: 'request-unknown-secret', ...preview, confirm: true }); expect(attempts).toHaveLength(1);
    deps.local = async () => { throw Error('refresh_token=private-refresh'); }; await health.check(['memory']);
    const row = (await health.snapshot()).evidence.find(row => row.scope === 'memory'); expect(row.state).toBe('fault'); expect(row.message).not.toContain('private-refresh');
  });
  it('实际身份变更又恢复也不复活旧成功，缺企业标识单独未验证', async () => {
    const original = { ownerId: 'owner', authority: 'bot:old' };
    await repos.health.observeIdentity('wecom', original);
    await repos.health.save({ scope: 'wecom.push', state: 'verified', configVersion: version, checkedAt: '2026-10-22T00:00:00Z', coverage: '旧回执', message: '旧成功', impact: '', nextSteps: [] });
    await repos.health.observeIdentity('wecom', { ...original, ownerId: 'other' }); await repos.health.observeIdentity('wecom', original);
    expect((await health.snapshot()).evidence.find(row => row.scope === 'wecom.push').state).toBe('stale');
    const report = await health.check(['feishu']); expect(report.evidence.find(row => row.scope === 'feishu.enterprise').state).toBe('unverified');
    expect(report.evidence.find(row => row.scope === 'feishu').state).toBe('partial');
  });
  it('完整统计覆盖超过200条，拒绝入站另列；配置并发不覆盖工作规则', async () => {
    for (let index = 0; index < 205; index++) await repos.outbox.enqueue({ dedupKey: `receipt-${index}`, channel: index === 0 ? 'feishu' : 'wecom', target: 'owner', kind: 'text', content: { text: 'test' } });
    await repos.inbox.insertRejected({ eventId: 'foreign', source: 'feishu', kind: 'message', payload: {} }, '非主人');
    const stats = (await health.snapshot()).traffic; expect(stats.channels.reduce((sum, row) => sum + Number(row.count), 0)).toBe(205); expect(stats.inbox[0].status).toBe('rejected');
    const path = join(root, 'AGENTS.md'), original = '# 个人规则不可覆盖\n\n```json\n' + JSON.stringify(DEFAULT_CONFIG) + '\n```\n'; await writeFile(path, original + '\n新规则');
    await expect(writeWorkspaceConfiguration(root, { maxWorkers: 4 }, async () => {}, { expectedConfigHash: hash(original) })).rejects.toThrow(/已被修改/); expect(await readFile(path, 'utf8')).toBe(original + '\n新规则');
  });
});
