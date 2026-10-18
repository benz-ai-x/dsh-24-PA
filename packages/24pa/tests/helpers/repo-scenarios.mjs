import { createRepos } from '../../lib/repo.js';

// Round-3 equivalence matrix: one ordered scenario table parameterized over
// both PaDb factories (PostgreSQL in repo.test.mjs, SQLite in sqlite.test.mjs).
// Every scenario goes through the Repos interface only — no backend-specific
// SQL lives here, so a new repo method exercised here is automatically covered
// on both adapters. Backend-only suites (PG raw-SQL time fixtures, SQLite
// dialect translation/backup) stay in their own test files.

export function defineRepoEquivalenceSuite({ describe, it, expect, beforeAll, afterAll }, makeDb) {
  describe('业务账本等价矩阵（双后端共享场景）', () => {
    let db, repos, cleanup;

    beforeAll(async () => {
      ({ db, cleanup } = await makeDb());
      await db.migrate();
      repos = createRepos(db);
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

    it('F28 第二轮收口：recovery 代数、会前准备守卫、行动前缀与纪要近况', async () => {
      // workItems.setRecoveryGen
      await repos.workItems.setRecoveryGen('wip-1', 3);
      expect((await repos.workItems.get('wip-1')).recovery_gen).toBe(3);
      // inbox.settleDelivered：admitted 的目标会话消息关账
      await repos.inbox.mark('f28-open', { status: 'admitted', requestId: 'r2', targetSession: 'wip-1' });
      await repos.inbox.settleDelivered('wip-1');
      expect((await repos.inbox.get('f28-open')).status).toBe('delivered');
      // digests.activeMeetingPreps：按 eventId 找活跃会前准备（重复守卫/取消共用）
      expect(await repos.digests.activeMeetingPreps('evt-none')).toEqual([]);
      await repos.digests.insertPlan({ id: 'prep-f28', kind: 'meeting_prep', status: 'active', title: '会前', schedule_spec: { eventId: 'evt-f28' }, session_id: 's-prep', schedule_id: null, last_window: null, voice: false, skill: 'digest-morning' });
      const preps = await repos.digests.activeMeetingPreps('evt-f28');
      expect(preps.map(p => p.id)).toEqual(['prep-f28']);
      // projects.listIdNames
      await repos.projects.create({ id: 'pj-f28', name: 'F28 项目' });
      expect((await repos.projects.listIdNames()).map(p => p.name)).toContain('F28 项目');
      // minutes.recent
      await repos.minutes.insert({ id: 'min-f28', work_item_id: null, event_id: null, memo_id: null, doc_url: null, topic: 'F28 纪要', candidates: [], status: 'draft' });
      expect((await repos.minutes.recent(3)).map(m => m.topic)).toContain('F28 纪要');
      // operations.succeededWithIdPrefix
      await repos.operations.begin({ id: 'note.action:n1:v1:task', workItemId: 'wip-1', action: 'task.create', params: { summary: 'x' } });
      await repos.operations.update('note.action:n1:v1:task', { status: 'succeeded' });
      const hits = await repos.operations.succeededWithIdPrefix('note.action:n1:v%');
      expect(hits.map(o => o.id)).toContain('note.action:n1:v1:task');
      // notes.versionsWithDecisions：带审核决定列
      const withDecisions = await repos.notes.versionsWithDecisions(10);
      expect(Array.isArray(withDecisions)).toBe(true);
    });

    afterAll(async () => {
      await db?.close();
      await cleanup?.();
    });
  });
}
