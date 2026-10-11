import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { startPgCluster } from '../helpers/pg.mjs';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';

// These tests run against a real, isolated PostgreSQL cluster (initdb in a
// temp dir) — the same boundary production uses, just locally provisioned.
describe('PostgreSQL 业务账本', () => {
  let cluster, db, repos;

  beforeAll(async () => {
    cluster = await startPgCluster();
    db = new PaDatabase(cluster.dsn);
    await db.migrate();
    repos = createRepos(db);
  });

  afterAll(async () => {
    await db.close();
    await cluster.stop();
  });

  it('迁移可重复执行且记录版本', async () => {
    const version = await db.migrate();
    expect(version).toBeGreaterThan(0);
    expect(await db.schemaVersion()).toBe(version);
  });

  it('inbox：同 event_id 只入账一次，领取后状态推进', async () => {
    const first = await repos.inbox.insert({ eventId: 'evt-1', source: 'feishu', kind: 'message', payload: { text: 'hi' } });
    const dup = await repos.inbox.insert({ eventId: 'evt-1', source: 'feishu', kind: 'message', payload: { text: 'hi' } });
    expect(first.inserted).toBe(true);
    expect(dup.inserted).toBe(false);
    const claimed = await repos.inbox.claim(10);
    expect(claimed.map(r => r.event_id)).toContain('evt-1');
    await repos.inbox.mark('evt-1', { status: 'admitted', requestId: 'req-1', targetSession: 'sess-1' });
    const row = await repos.inbox.get('evt-1');
    expect(row.status).toBe('admitted');
    expect(row.request_id).toBe('req-1');
  });

  it('work item：插入、更新与按状态统计', async () => {
    await repos.workItems.insert({
      id: 'wip-1',
      title: '整理备忘',
      role: 'memo',
      instruction: '…',
      origin: 'feishu',
      parent_session_id: 'sess-access',
      delivery: 'feishu:ou_owner',
      status: 'queued',
    });
    await repos.workItems.update('wip-1', { status: 'running', child_session_id: 'wip-1' });
    expect(await repos.workItems.countByStatus('running')).toBe(1);
    const item = await repos.workItems.get('wip-1');
    expect(item.child_session_id).toBe('wip-1');
    expect(item.delivery).toBe('feishu:ou_owner');
  });

  it('action operation：稳定操作键幂等，成功后不重复执行', async () => {
    const first = await repos.operations.begin({ id: 'op-1', workItemId: 'wip-1', action: 'memo.save_doc', params: { topic: 't' } });
    const again = await repos.operations.begin({ id: 'op-1', workItemId: 'wip-1', action: 'memo.save_doc', params: { topic: 't' } });
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    await repos.operations.update('op-1', { status: 'succeeded', receipt: { docId: 'd1' } });
    const row = await repos.operations.get('op-1');
    expect(row.status).toBe('succeeded');
    expect(row.receipt.docId).toBe('d1');
    expect(row.attempt).toBe(1);
  });

  it('outbox：dedup key 幂等、领取后记录回执与重试', async () => {
    const enq = await repos.outbox.enqueue({ dedupKey: 'reply:evt-1:1', channel: 'feishu', target: 'ou_owner', kind: 'text', content: { text: 'ok' } });
    const dup = await repos.outbox.enqueue({ dedupKey: 'reply:evt-1:1', channel: 'feishu', target: 'ou_owner', kind: 'text', content: { text: 'ok' } });
    expect(enq.created).toBe(true);
    expect(dup.created).toBe(false);
    const claimed = await repos.outbox.claim(10);
    expect(claimed.some(r => r.dedup_key === 'reply:evt-1:1')).toBe(true);
    await repos.outbox.mark(enq.row.id, { status: 'sent', messageId: 'om_1' });
    const failed = await repos.outbox.enqueue({ dedupKey: 'workitem:w1:result', channel: 'feishu', target: 'ou_owner', kind: 'text', content: {} });
    const claimed2 = await repos.outbox.claim(10);
    const target = claimed2.find(r => r.id === failed.row.id);
    await repos.outbox.mark(target.id, { status: 'pending', error: '限流', retryInMs: 4000 });
    const recent = await repos.outbox.recent(10);
    const retried = recent.find(r => r.id === failed.row.id);
    expect(retried.status).toBe('pending');
    expect(retried.next_attempt_at).not.toBeNull();
  });

  it('binding 与 workspace_state：按复合键幂等 upsert', async () => {
    await repos.bindings.upsert({ appId: 'cli_a', tenantKey: 't1', ownerOpenId: 'ou_owner', larkProfile: 'default' });
    const row = await repos.bindings.upsert({ appId: 'cli_a', tenantKey: 't1', ownerOpenId: 'ou_owner', larkProfile: 'default' });
    expect(row.status).toBe('active');
    expect(await repos.bindings.get('cli_a', 't1', 'ou_owner')).toBeTruthy();
    await repos.workspaceState.save('/tmp/ws', { feishuSessionId: 's1' });
    await repos.workspaceState.save('/tmp/ws', { localSessionId: 's2' });
    const state = await repos.workspaceState.get('/tmp/ws');
    expect(state.feishu_session_id).toBe('s1');
    expect(state.local_session_id).toBe('s2');
  });

  it('memo：按主题、关键词与日期检索', async () => {
    await repos.memos.insert({ id: 'm1', work_item_id: 'wip-1', topic: '合作方向', content: '下周讨论新的合作方向', doc_url: 'https://x/1', doc_id: 'd1', doc_revision: '1', source: 'wip-1', occurred_on: '2026-10-06' });
    await repos.memos.insert({ id: 'm2', work_item_id: 'wip-1', topic: '读书笔记', content: '原则一书第二章', doc_url: null, doc_id: null, doc_revision: null, source: 'wip-1', occurred_on: '2026-10-01' });
    expect((await repos.memos.search({ topic: '合作方向' })).map(m => m.id)).toEqual(['m1']);
    expect((await repos.memos.search({ query: '合作' })).map(m => m.id)).toEqual(['m1']);
    expect((await repos.memos.search({ from: '2026-10-05' })).map(m => m.id)).toEqual(['m1']);
    expect((await repos.memos.search({})).map(m => m.id).sort()).toEqual(['m1', 'm2']);
    // 同一操作键重放不炸：崩溃在 memo 写入与操作成功标记之间后，重试应更新而非冲突
    await repos.memos.insert({ id: 'm1', work_item_id: 'wip-1', topic: '合作方向', content: '下周讨论新的合作方向（更新）', doc_url: 'https://x/1b', doc_id: 'd1b', doc_revision: '2', source: 'wip-1', occurred_on: '2026-10-06' });
    const updated = await repos.memos.get('m1');
    expect(updated.content).toContain('（更新）');
    expect((await repos.memos.search({})).length).toBe(2);
  });

  // F28 存储缝收口：以下方法平移了此前散在 runtime/reminders 的裸 SQL。
  it('F28 inbox：resetProcessing 回队、listAdmitted 只取 admitted（重启对账）', async () => {
    await repos.inbox.insert({ eventId: 'f28-stuck', source: 'feishu', kind: 'message', payload: {} });
    await repos.inbox.insert({ eventId: 'f28-open', source: 'feishu', kind: 'message', payload: {} });
    await repos.inbox.insert({ eventId: 'f28-done', source: 'feishu', kind: 'message', payload: {} });
    const claimed = await repos.inbox.claim(10);
    expect(claimed.map(r => r.event_id)).toEqual(expect.arrayContaining(['f28-stuck', 'f28-open', 'f28-done']));
    await repos.inbox.mark('f28-open', { status: 'admitted', requestId: 'r1', targetSession: 's1' });
    await repos.inbox.mark('f28-done', { status: 'delivered' });
    await repos.inbox.resetProcessing();
    expect((await repos.inbox.get('f28-stuck')).status).toBe('received');
    expect((await repos.inbox.listAdmitted()).map(r => r.event_id)).toEqual(expect.arrayContaining(['f28-open', 'evt-1']));
  });

  it('F28 workspace_state：latestPath 取最近更新的工作区', async () => {
    await repos.workspaceState.save('/tmp/ws-f28-a', { localSessionId: 'a' });
    await repos.workspaceState.save('/tmp/ws-f28-b', { localSessionId: 'b' });
    // updated_at 显式拨序，避免 PG now() 微秒精度导致两条 save 同拍
    await db.query(`update pa24.workspace_state set updated_at = now() - interval '1 hour' where path = '/tmp/ws-f28-a'`);
    expect(await repos.workspaceState.latestPath()).toBe('/tmp/ws-f28-b');
    await db.query(`update pa24.workspace_state set updated_at = now() where path = '/tmp/ws-f28-a'`);
    expect(await repos.workspaceState.latestPath()).toBe('/tmp/ws-f28-a');
  });

  it('F28 maintenance：水位计数、unknown 操作计数与重试合计', async () => {
    const watermarks = await repos.maintenance.watermarks();
    const byTable = Object.fromEntries(watermarks.map(w => [w.table, w.rows]));
    expect(byTable.work_item).toBeGreaterThan(0); // wip-1 已在上方插入
    expect(Object.keys(byTable).sort()).toEqual(['note', 'outbox', 'reminder_rule', 'work_item']);
    expect(await repos.maintenance.unknownOperationCount()).toBeGreaterThanOrEqual(0);
    const totals = await repos.maintenance.attemptTotals();
    expect(totals.operations).toBeGreaterThanOrEqual(0);
    expect(totals.outbox).toBeGreaterThanOrEqual(0);
  });

  it('F28 reminder：cancelPendingOccurrences(unclaimedOnly) 保留已到期实例', async () => {
    const due = new Date(Date.now() - 60_000);
    await repos.reminders.insertRule({ id: 'rr-f28', kind: 'daily', text: '试验提醒', record: {}, status: 'active', next_due_at: due, time_zone: 'Asia/Shanghai', origin_expression: 'daily 9:00', source: 'test' });
    await repos.reminders.insertOccurrence({ id: 'occ-elapsed', ruleId: 'rr-f28', dueAt: due });
    await repos.reminders.insertOccurrence({ id: 'occ-later', ruleId: 'rr-f28', dueAt: new Date(Date.now() + 7200_000) });
    // occ-later 处于延期窗口内（未来）→ 未被领取；occ-elapsed 的延期已过 → 视为派发中
    await db.query(`update pa24.reminder_occurrence set deferred_until = now() - interval '1 minute' where id = 'occ-elapsed'`);
    await db.query(`update pa24.reminder_occurrence set deferred_until = now() + interval '1 hour' where id = 'occ-later'`);
    const canceled = await repos.reminders.cancelPendingOccurrences('rr-f28', { unclaimedOnly: true });
    expect(canceled).toBe(1); // 只取消 occ-later
    const all = await db.query(`select id, status from pa24.reminder_occurrence where rule_id = 'rr-f28'`);
    const byId = Object.fromEntries(all.rows.map(r => [r.id, r.status]));
    expect(byId['occ-elapsed']).toBe('pending');
    expect(byId['occ-later']).toBe('canceled');
  });
});
