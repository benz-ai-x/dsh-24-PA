import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { ExternalOperations } from '../../lib/external-operations.js';
import { HandwritingPipeline } from '../../lib/handwriting-pipeline.js';
import { sha256Hex } from '../../lib/handwriting.js';
import { hash } from '../../lib/util.js';
import { startPgCluster } from '../helpers/pg.mjs';

// Public submit/republish, real ledger and real CLI process. Only Feishu is
// replaced; failures occur after the durable version commit, before completion.
for (const backend of ['sqlite', 'postgres']) describe(`手写发布恢复 (${backend})`, () => {
  let root, db, cluster, repos, pipeline, item, bin, statePath, failProjection;
  const args = { transcript: '本周交付', summary: '会议摘要' };
  const recognized = { ...args, suggestions: [], unknowns: [], candidates: [], relativeDates: [] };
  const makePipeline = () => {
    const operations = new ExternalOperations(() => repos.operations);
    return new HandwritingPipeline({
      repos: () => repos,
      config: () => ({ mode: 'feishu', larkProfile: 'default', folderToken: 'folder', ownerOpenId: 'owner', workerModels: {} }),
      cli: () => ({ bin, timeoutMs: 5_000 }),
      assertLive: () => {}, skillParams: async () => ({}),
      roleFor: () => 'local-robot', accessSessionId: () => 'access', trackWorkItem: () => {},
      stagedOperationWithId: (...input) => operations.stageWithId(...input),
      performExternal: (...input) => operations.perform(...input), failStaged: (...input) => operations.fail(...input),
      notifyOwner: (dedupKey, text) => repos.outbox.enqueue({ dedupKey, channel: 'feishu', target: 'owner', kind: 'text', content: { text } }),
    });
  };
  const calls = async () => (await readFile(`${statePath}.calls.jsonl`, 'utf8')).trim().split('\n').map(JSON.parse);
  const createCount = async () => (await calls()).filter(row => row.args.includes('+create')).length;
  const attempts = async () => (await db.query("select * from pa24.action_operation where action = 'note.publish'")).rows;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-publish-recovery-'));
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else db = new SqliteDb(join(root, 'ledger.db'));
    await db.migrate();
    statePath = join(root, 'lark.json'); bin = join(root, 'lark-cli.mjs');
    const stub = new URL('../helpers/stub-lark-cli.mjs', import.meta.url).href;
    await writeFile(bin, `#!${process.execPath}\nprocess.env.PA24_LARK_STUB_STATE = ${JSON.stringify(statePath)};\nawait import(${JSON.stringify(stub)});\n`);
    await chmod(bin, 0o755);
    const faultDb = {
      query: (sql, values) => {
        if (failProjection && sql.startsWith('update pa24.note set')) throw new Error('injected post-version storage failure');
        return db.query(sql, values);
      },
      withTransaction: work => db.withTransaction(work),
    };
    repos = createRepos(faultDb);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    failProjection = false;
    for (const table of ['review_decision', 'review_token', 'outbox', 'note_version', 'note_page', 'note', 'action_operation', 'work_item']) await db.query(`delete from pa24.${table}`);
    for (const suffix of ['.docs.jsonl', '.calls.jsonl']) await rm(`${statePath}${suffix}`, { force: true });
    await writeFile(statePath, '{}');
    item = await repos.workItems.insert({ id: 'work', title: '整理笔记', role: 'handwriting', instruction: '整理', origin: 'local', parent_session_id: 'access', delivery: 'owner', status: 'running' });
    await repos.notes.insertNote({ id: 'N-1', title: '会议', origin: 'feishu', workItemId: item.id });
    await repos.notes.insertPage({ note_id: 'N-1', page_no: 1, message_id: 'message', image_key: 'image', media_type: 'image/png', byte_size: 3, sha256: 'original-sha', storage_path: join(root, 'original.png'), source_type: 'image', quality: null, status: 'saved' });
    pipeline = makePipeline();
  });

  it('版本已入账后失败，重建 pipeline 重试沿用一个文档、一个版本和一个审核卡', async () => {
    failProjection = true;
    await expect(pipeline.noteSubmit(item, args)).rejects.toThrow('post-version');
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(1);
    const before = await calls();
    failProjection = false; pipeline = makePipeline();
    expect(await pipeline.noteSubmit(item, args)).toMatchObject({ version: 1, versionId: 'N-1:v1' });
    expect(await pipeline.noteSubmit(item, args)).toMatchObject({ version: 1, reused: true });
    expect(await createCount()).toBe(1); expect(await calls()).toHaveLength(before.length);
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(1);
    expect((await attempts()).map(row => row.status)).toEqual(['succeeded']);
    expect((await repos.outbox.recent(10)).filter(row => row.dedup_key === 'notereview:N-1:v1')).toHaveLength(1);
  });

  it('升级前含版本号的旧 operation key 仍恢复原版本，不建立新的内容 key', async () => {
    failProjection = true;
    await expect(pipeline.noteSubmit(item, args)).rejects.toThrow('post-version');
    const first = (await attempts())[0];
    const legacyId = `note.publish:work:${hash(`N-1:v1\n${sha256Hex(JSON.stringify(recognized))}`)}`;
    await db.query('update pa24.action_operation set id = $2, params = $3 where id = $1', [first.id, legacyId, JSON.stringify({ noteId: 'N-1', version: 1, republish: false })]);
    failProjection = false; pipeline = makePipeline();
    expect(await pipeline.noteSubmit(item, args)).toMatchObject({ version: 1 });
    expect(await createCount()).toBe(1); expect(await repos.notes.versionsOf('N-1')).toHaveLength(1);
    expect((await attempts()).map(row => row.id)).toEqual([legacyId]);
  });

  it('重新发布在新版本入账后失败，也完成原候选而不是被 unchanged 提前跳过', async () => {
    const first = await pipeline.noteSubmit(item, args);
    const v1 = await repos.notes.getVersion(first.versionId);
    await writeFile(statePath, JSON.stringify({ docEdits: { [v1.doc_id]: '<p>主人补充内容</p>' } }));
    failProjection = true;
    await expect(pipeline.republishNote(item, 'N-1')).rejects.toThrow('post-version');
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(2);
    failProjection = false; pipeline = makePipeline();
    expect(await pipeline.republishNote(item, 'N-1')).toMatchObject({ version: 2, versionId: 'N-1:v2' });
    expect(await createCount()).toBe(1); expect(await repos.notes.versionsOf('N-1')).toHaveLength(2);
    expect((await attempts()).map(row => row.status)).toEqual(['succeeded', 'succeeded']);
    expect((await repos.outbox.recent(10)).filter(row => row.dedup_key === 'notereview:N-1:v2')).toHaveLength(1);
  });

  it.each([false, true])('真实 notesTool 以新事项重试已入账候选，补齐原审核卡（legacy=%s）', async legacy => {
    const first = await pipeline.noteSubmit(item, args);
    const v1 = await repos.notes.getVersion(first.versionId);
    await writeFile(statePath, JSON.stringify({ docEdits: { [v1.doc_id]: '<p>主人补充内容</p>' } }));
    failProjection = true;
    await expect(pipeline.notesTool({ action: 'republish', noteId: 'N-1' }, { id: 'local' })).rejects.toThrow('post-version');
    const published = await repos.notes.getVersion('N-1:v2');
    const failed = (await attempts()).find(row => row.params.version === 2);
    let operationId = failed.id;
    if (legacy) {
      const paramsKey = `republish:${published.doc_id}:${sha256Hex(published.normalized_text)}`;
      operationId = `note.publish:${failed.work_item_id}:${hash(`N-1:v2\n${paramsKey}`)}`;
      await db.query('update pa24.action_operation set id = $2, params = $3 where id = $1', [failed.id, operationId, JSON.stringify({ noteId: 'N-1', version: 2, republish: true })]);
    }
    expect((await repos.outbox.recent(10)).some(row => row.dedup_key === 'notereview:N-1:v2')).toBe(false);
    failProjection = false; pipeline = makePipeline();
    expect(await pipeline.notesTool({ action: 'republish', noteId: 'N-1' }, { id: 'local' })).toMatchObject({ version: 2, versionId: 'N-1:v2' });
    const republishItems = (await repos.workItems.list()).filter(row => row.title === '刷新笔记候选 N-1');
    expect(republishItems).toHaveLength(2);
    expect(new Set(republishItems.map(row => row.id)).size).toBe(2);
    const recoveredItem = republishItems.find(row => row.id !== failed.work_item_id);
    expect(recoveredItem.result_ref).toMatchObject({ operationId, versionId: 'N-1:v2' });
    expect((await repos.operations.get(operationId)).status).toBe('succeeded');
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(2); expect(await createCount()).toBe(1);
    expect((await repos.outbox.recent(10)).filter(row => row.dedup_key === 'notereview:N-1:v2')).toHaveLength(1);
    expect(await pipeline.notesTool({ action: 'republish', noteId: 'N-1' }, { id: 'local' })).toMatchObject({ result: 'unchanged' });
    expect(await attempts()).toHaveLength(2);
  });

  it('旧尝试迟到补账，不把更新候选降回旧版本或重复生成旧文档', async () => {
    failProjection = true;
    await expect(pipeline.noteSubmit(item, args)).rejects.toThrow('post-version');
    failProjection = false;
    await pipeline.noteSubmit(item, { ...args, transcript: '下周交付' });
    await pipeline.noteSubmit(item, args);
    expect(await createCount()).toBe(2);
    expect((await repos.notes.versionsOf('N-1')).map(row => [row.version, row.status])).toEqual([[1, 'superseded'], [2, 'pending_review']]);
    expect((await repos.outbox.recent(10)).map(row => row.dedup_key)).toEqual(['notereview:N-1:v2']);
  });
});
