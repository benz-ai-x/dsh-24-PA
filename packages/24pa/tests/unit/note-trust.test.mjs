import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { createRepos } from '../../lib/repo.js';
import { TrustedNotes } from '../../lib/note-trust.js';
import { HandwritingPipeline } from '../../lib/handwriting-pipeline.js';
import { fingerprintOf, normalizeDocument, pendingReviewLine, systemLine } from '../../lib/handwriting.js';

describe('待审版本当前可信裁定（真实账本＋文档 stub adapter）', () => {
  let root, db, repos, notes, trust, content, fault, reads, duringRead;
  const original = `<p>${pendingReviewLine('N-1', 1)}</p><p>会议确定周五交付</p><img token="original"/>`;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-note-trust-'));
    db = new SqliteDb(join(root, 'ledger.db')); await db.migrate();
    repos = createRepos(db); notes = repos.notes;
  });
  afterAll(async () => { await db?.close(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    for (const table of ['review_decision', 'review_token', 'outbox', 'note_version', 'note_page', 'note']) await db.query(`delete from pa24.${table}`);
    await notes.insertNote({ id: 'N-1', title: '笔记', origin: 'feishu' });
    await notes.insertPage({ note_id: 'N-1', page_no: 1, message_id: 'msg', image_key: 'img', media_type: 'image/png', byte_size: 3, sha256: 'original-sha', storage_path: '/unused', source_type: 'image', quality: null, status: 'saved' });
    content = original; fault = null; reads = 0; duringRead = null;
    trust = new TrustedNotes(() => notes, { read: async () => {
      reads++; if (fault) throw fault; if (duringRead) await duringRead();
      return { content, revision: 'rev' };
    } });
  });
  const version = (number, status = 'approved', xml = original) => notes.insertVersion({
    id: `N-1:v${number}`, note_id: 'N-1', version: number, doc_id: 'doc', doc_url: 'https://example.com/doc', doc_revision: 'rev',
    fingerprint: fingerprintOf(normalizeDocument(xml), ['original-sha']), normalized_text: normalizeDocument(xml),
    content: { summary: '摘要', candidates: [{ summary: '准备报告' }] }, doc_snapshot: xml, status,
  });

  it.each([
    ['approved', 'matches', 'matches'],
    ['pending_review', 'unreviewed', 'matches'],
    ['returned', 'unreviewed', 'matches'],
    ['stale', 'changed', 'changed'],
    ['superseded', 'changed', 'changed'],
  ])('%s 版本严格区分内容匹配与人工批准', async (status, validity, contentValidity) => {
    await version(1, status);
    const result = await trust.inspect('N-1', 'N-1:v1');
    expect(result.currentValidity).toBe(validity); expect(result.contentValidity).toBe(contentValidity);
    expect(result.current).toBe(true);
  });

  it('旧版本即使 approved 且正文未变，也不成为当前已确认事实', async () => {
    await version(1); await version(2, 'pending_review');
    const result = await trust.inspect('N-1', 'N-1:v1');
    expect(result.currentValidity).toBe('changed'); expect(result.current).toBe(false);
    expect(reads).toBe(0); expect((await notes.getVersion('N-1:v1')).status).toBe('approved');
  });

  it('正文变化为 changed，系统状态块更新仍为 matches', async () => {
    await version(1);
    content = original.replace('周五', '周一');
    expect((await trust.inspect('N-1')).currentValidity).toBe('changed');
    content = original.replace(pendingReviewLine('N-1', 1), systemLine('本人已审核 N-1 v1（2026-10-19T01:00:00.000Z；覆盖指纹 0123456789ab…）'));
    expect((await trust.inspect('N-1')).currentValidity).toBe('matches');
  });

  it('远端失败或空文档为 unknown，不能因曾批准而继承可信', async () => {
    await version(1); fault = new Error('permission denied');
    expect(await trust.inspect('N-1')).toMatchObject({ currentValidity: 'unknown', contentValidity: 'unknown', reason: 'permission denied', fingerprint: null });
    fault = null; content = '';
    expect((await trust.inspect('N-1')).currentValidity).toBe('unknown');
    expect((await notes.getVersion('N-1:v1')).status).toBe('approved');
  });

  it('原稿依据缺失为 unknown，资源摘要变化为 changed', async () => {
    await version(1);
    await db.query("update pa24.note_page set sha256 = 'different' where note_id = $1", ['N-1']);
    expect((await trust.inspect('N-1')).currentValidity).toBe('changed');
    await db.query('delete from pa24.note_page');
    expect((await trust.inspect('N-1')).currentValidity).toBe('unknown');
  });

  it('读取期间发布新版本或撤销状态，不使用过时快照判定', async () => {
    await version(1); duringRead = () => version(2, 'pending_review');
    expect(await trust.inspect('N-1', 'N-1:v1')).toMatchObject({ current: false, currentValidity: 'changed' });
    duringRead = () => notes.updateVersion('N-1:v2', { status: 'stale' });
    expect((await trust.inspect('N-1', 'N-1:v2')).currentValidity).toBe('changed');
  });

  it('版本身份必须属于请求笔记；批准仍不自动执行候选行动', async () => {
    await version(1);
    await expect(trust.inspect('other-note', 'N-1:v1')).rejects.toThrow('不属于');
    expect((await trust.inspect('N-1')).currentValidity).toBe('matches');
    expect((await db.query('select * from pa24.action_operation')).rows).toHaveLength(0);
  });

  it('审核事务失败不消费按钮；重试保存一个凭证，重复点击不再裁决', async () => {
    const v = await version(1, 'pending_review');
    await notes.insertToken({ token: 'opaque-token', note_id: 'N-1', version_id: v.id, action: 'approve', owner_open_id: 'owner', fingerprint: v.fingerprint, expires_at: new Date(Date.now() + 60_000) });
    let failCommit = true;
    const pipeline = new HandwritingPipeline({
      repos: () => repos, config: () => ({ ownerOpenId: 'owner', mode: 'demo' }), transport: () => null,
      notifyOwner: (dedupKey, text) => repos.outbox.enqueue({ dedupKey, channel: 'feishu', target: 'owner', kind: 'text', content: { text } }),
      dbRef: () => ({ withTransaction: work => db.withTransaction(client => work({ query: (sql, values) => {
        if (failCommit && sql.includes('insert into pa24.review_decision')) throw new Error('injected decision storage failure');
        return client.query(sql, values);
      } })) }),
    }, { read: async () => ({ content: original, revision: 'rev' }) });
    const event = { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token: 'opaque-token' } } };
    await pipeline.processReviewCard('first', event);
    expect((await notes.getToken('opaque-token')).used_at).toBeNull();
    expect(await notes.decisionsOf('N-1')).toHaveLength(0);
    failCommit = false;
    await pipeline.processReviewCard('retry', event);
    await pipeline.processReviewCard('duplicate', event);
    expect(await notes.decisionsOf('N-1')).toHaveLength(1);
    expect((await notes.getVersion(v.id)).status).toBe('approved');
    expect((await notes.getToken('opaque-token')).used_at).not.toBeNull();
  });
});
