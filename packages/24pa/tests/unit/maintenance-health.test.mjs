import { describe, expect, it } from 'vitest';
import { fixture } from '../helpers/runtime.mjs';
import { startPgCluster } from '../helpers/pg.mjs';

describe.each(['sqlite', 'postgres'])('维护健康工具的公开回执 / %s', storage => {
  it('有实际投递、身份和测试记录时仍返回可持久化 JSON，保留时间和只读边界', async () => {
    const cluster = storage === 'postgres' ? await startPgCluster() : null;
    const f = await fixture({ env: cluster ? { PA24_PG_DSN: cluster.dsn } : {} });
    try {
      const workspace = await f.workspace('health', { storage }); await f.rt.bind(workspace);
      const local = f.agents.get(await f.rt.openLocalSession());
      const queued = await f.rt.repos.outbox.enqueue({ dedupKey: 'health-json-notice', channel: 'local', target: local.id, kind: 'text', content: { text: '已有通知' } });
      await f.rt.repos.health.observeIdentity('wecom', { ownerId: 'owner', authority: 'bot:original' });
      await f.rt.repos.health.prepareTest('health-json-test', 'request-hash', 'config-version', { action: 'read-only-evidence' });
      await f.rt.repos.health.saveMonitor('wecom', { notificationKey: 'health-json-notice' });
      const result = await f.rt.maintenanceTool({ action: 'health' }, local);
      expect(result).toEqual(JSON.parse(JSON.stringify(result)));
      expect(result.connectionEvidence.traffic.channels[0].since).toEqual(expect.any(String));
      expect(result.connectionEvidence.identity.accepted_at).toEqual(expect.any(String));
      expect(result.connectionEvidence.tests[0].created_at).toEqual(expect.any(String));
      expect(result.connectionEvidence.monitor.delivery.created_at).toEqual(queued.row.created_at.toISOString());
      expect(result.usage.outboxQueued).toBe(1);
      expect(result.dataFlow.secrets).toContain('凭据值不进入');
      expect(await f.rt.repos.outbox.recent()).toHaveLength(1);
      expect(f.prompts).toHaveLength(0);
    } finally { await f.cleanup(); await cluster?.stop(); }
  });
});
