import { beforeEach, afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteDb } from '../../lib/sqlite.js';
import { createRepos } from '../../lib/repo.js';
import { HandwritingPipeline } from '../../lib/handwriting-pipeline.js';

let root, db, repos, pipeline, downloads, failAck, failInbox;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-collection-'));
  db = new SqliteDb(join(root, 'ledger.db')); await db.migrate(); repos = createRepos(db);
  downloads = 0; failAck = false; failInbox = false;
  const mark = repos.inbox.mark.bind(repos.inbox);
  repos.inbox.mark = async (...args) => { if (failInbox) throw new Error('inbox disk failure'); return mark(...args); };
  pipeline = new HandwritingPipeline({
    repos: () => repos, config: () => ({ mode: 'feishu' }), workspace: () => ({ statePath: root }),
    transport: () => ({ downloadImage: async () => { downloads++; return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); } }),
    notifyOwner: async (dedupKey, text) => { if (failAck) throw new Error('ack disk failure'); return repos.outbox.enqueue({ dedupKey, channel: 'feishu', target: 'owner', kind: 'text', content: { text } }); },
    usage: { notePagesInput: 0 }, roleFor: () => 'local-robot',
  });
});
afterEach(async () => { await db.close(); await rm(root, { recursive: true, force: true }); });
const event = id => ({ eventId: 'event-' + id, messageId: id, imageKey: 'image-' + id, messageType: 'image' });

it.each(['collected', 'awaiting_review', 'approved', 'returned', 'needs_rereview'])('批次 %s 不因回复旧 ack 重新打开', async status => {
  await pipeline.collectNotePage('inbox', event('original'), null);
  const note = (await repos.notes.listNotes())[0];
  await repos.notes.updateNote(note.id, { status });
  await pipeline.collectNotePage('next', event('additional'), note.id);
  expect(await repos.notes.pagesOf(note.id)).toHaveLength(1);
  expect(downloads).toBe(1); expect((await repos.notes.getNote(note.id)).status).toBe(status);
});

it.each(['ack', 'inbox'])('原稿提交后 %s 失败报告已保存，重试只恢复回执', async fault => {
  failAck = fault === 'ack'; failInbox = fault === 'inbox';
  await expect(pipeline.collectNotePage('first', event('original'), null)).rejects.toThrow(/原稿已保存.*重试只补回执/);
  expect(await repos.notes.listNotes()).toHaveLength(1);
  failAck = false; failInbox = false;
  await Promise.all(Array.from({ length: 6 }, () => pipeline.collectNotePage('retry', event('original'), null)));
  expect(await repos.notes.listNotes()).toHaveLength(1); expect(downloads).toBe(1);
  expect((await repos.outbox.recent(20)).filter(row => row.dedup_key.startsWith('noteack:'))).toHaveLength(1);
});
