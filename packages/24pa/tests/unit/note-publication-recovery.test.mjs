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
  const original = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const recognized = { ...args, suggestions: [], unknowns: [], candidates: [], relativeDates: [] };
  const makePipeline = () => {
    const operations = new ExternalOperations(() => repos.operations);
    return new HandwritingPipeline({
      repos: () => repos,
      config: () => ({ mode: 'feishu', larkProfile: 'default', folderToken: 'folder', ownerOpenId: 'owner', workerModels: {} }),
      cli: () => ({ bin, timeoutMs: 5_000 }),
      dbRef: () => db, assertLive: () => {}, skillParams: async () => ({}),
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
    await repos.notes.insertPage({ note_id: 'N-1', page_no: 1, message_id: 'message', image_key: 'image', media_type: 'image/png', byte_size: 3, sha256: sha256Hex(original), storage_path: join(root, 'original.png'), source_type: 'image', quality: null, status: 'saved' });
    await writeFile(join(root, 'original.png'), original);
    pipeline = makePipeline();
  });

  it('版本已入账后失败，重建 pipeline 重试沿用一个文档、一个版本和一个审核卡', async () => {
    failProjection = true;
    await expect(pipeline.noteSubmit(item, args)).rejects.toThrow('post-version');
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(1);
    const frozen = (await repos.notes.getVersion('N-1:v1')).content;
    expect(frozen.derivedStatus).toBe('ready');
    const before = await calls();
    failProjection = false; pipeline = makePipeline();
    expect(await pipeline.noteSubmit(item, args)).toMatchObject({ version: 1, versionId: 'N-1:v1' });
    expect(await pipeline.noteSubmit(item, args)).toMatchObject({ version: 1, reused: true });
    expect((await repos.notes.getVersion('N-1:v1')).content).toEqual(frozen);
    expect(await createCount()).toBe(1); expect((await calls()).filter(row => row.args.includes('+media-insert'))).toHaveLength(before.filter(row => row.args.includes('+media-insert')).length);
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(1);
    expect((await attempts()).map(row => row.status)).toEqual(['succeeded']);
    expect((await repos.outbox.recent(10)).filter(row => row.dedup_key.startsWith('notereview:N-1:v1:'))).toHaveLength(1);
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

  it.each(['readback', 'version'])('V01 %s 失败后正文被改，重建发布不能把旧候选与新正文拼接', async fault => {
    let removeFault = async () => {};
    if (fault === 'readback') await writeFile(statePath, JSON.stringify({ documentOverride: { content: '<unsupported/>', revision_id: 1 } }));
    else if (backend === 'sqlite') {
      await db.query("create trigger version_fault before insert on pa24_note_version begin select raise(abort, 'VERSION_SQL_DOWN'); end");
      removeFault = () => db.query('drop trigger version_fault');
    } else {
      await db.query("create function pa24.version_fault() returns trigger language plpgsql as $$ begin raise exception 'VERSION_SQL_DOWN'; end $$");
      await db.query('create trigger version_fault before insert on pa24.note_version for each row execute function pa24.version_fault()');
      removeFault = async () => { await db.query('drop trigger version_fault on pa24.note_version'); await db.query('drop function pa24.version_fault()'); };
    }
    try { await expect(pipeline.noteSubmit(item, { ...args, candidates: [{ summary: '联系王工' }] })).rejects.toThrow(fault === 'version' ? 'VERSION_SQL_DOWN' : /不支持|尚无/); }
    finally { await removeFault(); }
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(0);
    const doc = (await readFile(`${statePath}.docs.jsonl`, 'utf8')).trim().split('\n').map(JSON.parse).at(-1);
    await writeFile(`${statePath}.docs.jsonl`, JSON.stringify({ ...doc, content: doc.content.replaceAll('王工', '李工'), revision: doc.revision + 1 }) + '\n', { flag: 'a' });
    await writeFile(statePath, '{}'); pipeline = makePipeline();
    expect(await pipeline.noteSubmit(item, { ...args, candidates: [{ summary: '联系王工' }] })).toMatchObject({ version: 1 });
    const version = await repos.notes.getVersion('N-1:v1');
    expect(version.doc_snapshot).toContain('李工'); expect(version.doc_snapshot).not.toContain('王工');
    expect(version.content).toMatchObject({ candidates: [], summary: '', derivedStatus: 'needs_rebuild' });
    expect(await createCount()).toBe(1);
    expect(JSON.stringify((await repos.outbox.recent(10))[0].content)).toContain('仅批准正文');
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
    expect((await repos.outbox.recent(10)).filter(row => row.dedup_key.startsWith('notereview:N-1:v2:'))).toHaveLength(1);
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
    expect((await repos.outbox.recent(10)).some(row => row.dedup_key.startsWith('notereview:N-1:v2:'))).toBe(false);
    failProjection = false; pipeline = makePipeline();
    expect(await pipeline.notesTool({ action: 'republish', noteId: 'N-1' }, { id: 'local' })).toMatchObject({ version: 2, versionId: 'N-1:v2' });
    const republishItems = (await repos.workItems.list()).filter(row => row.title === '刷新笔记候选 N-1');
    expect(republishItems).toHaveLength(2);
    expect(new Set(republishItems.map(row => row.id)).size).toBe(2);
    const recoveredItem = republishItems.find(row => row.id !== failed.work_item_id);
    expect(recoveredItem.result_ref).toMatchObject({ operationId, versionId: 'N-1:v2' });
    expect((await repos.operations.get(operationId)).status).toBe('succeeded');
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(2); expect(await createCount()).toBe(1);
    expect((await repos.outbox.recent(10)).filter(row => row.dedup_key.startsWith('notereview:N-1:v2:'))).toHaveLength(1);
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
    expect((await repos.outbox.recent(10)).map(row => row.dedup_key)).toEqual([expect.stringMatching(/^notereview:N-1:v2:/)]);
  });
  it('重发只采纳同一读取快照，清空旧派生资料；后续编辑不得混入指纹', async () => {
    await pipeline.noteSubmit(item, { ...args, candidates: [{ summary: '李明周五交付', due: '2026-10-23' }] });
    await writeFile(statePath, JSON.stringify({ docEdits: { 'docstub-1': '<p>改为王明周一交付，删除原候选</p>' } }));
    const read = pipeline.reader.read.bind(pipeline.reader); let count = 0, captured;
    pipeline.reader.read = async id => {
      const result = await read(id);
      if (++count === 1) { captured = result; await writeFile(statePath, JSON.stringify({ docEdits: { 'docstub-1': '<p>随后再次编辑</p>' } })); }
      return result;
    };
    await pipeline.notesTool({ action: 'republish', noteId: 'N-1' }, { id: 'local' });
    const version = await repos.notes.latestVersion('N-1');
    expect(version.doc_snapshot).toBe(captured.content); expect(version.normalized_text).toBe(captured.normalized);
    expect(version.doc_revision).toBe(captured.revision);
    expect(version.content).toMatchObject({ derivedStatus: 'needs_rebuild', candidates: [], transcript: '', summary: '' });
    expect((await pipeline.inspectTrust('N-1')).contentValidity).toBe('changed');
  });

  it('过期卡可续发同版本，旧 token 无效；批准后重发 v2 状态可再次同步', async () => {
    await pipeline.noteSubmit(item, args);
    const first = (await repos.notes.tokensOf('N-1:v1')).find(row => row.action === 'approve');
    await db.query('update pa24.review_token set expires_at = $1', [new Date(Date.now() - 1000)]);
    await pipeline.notesTool({ action: 'republish', noteId: 'N-1' }, { id: 'local' });
    expect(await repos.notes.versionsOf('N-1')).toHaveLength(1);
    const renewed = (await repos.notes.tokensOf('N-1:v1')).find(row => row.action === 'approve' && row.expires_at > new Date());
    expect(renewed.token).not.toBe(first.token);
    const click = token => pipeline.processReviewCard('click-' + token, { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    await click(first.token); expect((await repos.notes.latestVersion('N-1')).status).toBe('pending_review');
    await click(renewed.token); expect((await repos.notes.latestVersion('N-1')).status).toBe('approved');
    await writeFile(statePath, JSON.stringify({ docEdits: { 'docstub-1': '<p>修订正文</p>' } }));
    await pipeline.notesTool({ action: 'republish', noteId: 'N-1' }, { id: 'local' });
    const second = (await repos.notes.tokensOf('N-1:v2')).find(row => row.action === 'approve');
    await click(second.token);
    const doc = await pipeline.reader.read('docstub-1'); expect(doc.content).toContain('本人已审核 N-1 v2');
    expect((await repos.notes.decisionsOf('N-1')).every(row => row.doc_sync_status === 'synced')).toBe(true);
  });

  it('审核状态段尾追加业务正文使版本失效，同步恢复不能抹去正文', async () => {
    await pipeline.noteSubmit(item, args);
    const token = (await repos.notes.tokensOf('N-1:v1')).find(row => row.action === 'approve').token;
    await writeFile(statePath, JSON.stringify({ failNext: { command: 'docs.update' } }));
    await pipeline.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    const before = await pipeline.reader.read('docstub-1');
    const business = '付款账号改为另一账号，金额提高到50000元';
    await writeFile(statePath, JSON.stringify({ documentOverride: { content: before.content.replace('（尚未经人工审核）', '（尚未经人工审核）' + business), revision_id: 99 } }));
    const writes = (await calls()).filter(row => row.args.includes('+update')).length;
    expect((await pipeline.inspectTrust('N-1')).currentValidity).toBe('changed');
    await pipeline.verifyNote('N-1');
    expect((await pipeline.reader.read('docstub-1')).content).toContain(business);
    expect((await calls()).filter(row => row.args.includes('+update'))).toHaveLength(writes);
    expect((await repos.notes.decisionsOf('N-1'))[0].doc_sync_status).toBe('failed');
  });

  it('pending 和 failed 裁决投影恢复，旧版本恢复不得覆盖 v2', async () => {
    await pipeline.noteSubmit(item, args);
    const token = (await repos.notes.tokensOf('N-1:v1')).find(row => row.action === 'return').token;
    await writeFile(statePath, JSON.stringify({ failNext: { command: 'docs.update' } }));
    await pipeline.processReviewCard('return', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    expect((await repos.notes.decisionsOf('N-1'))[0].doc_sync_status).toBe('failed');
    await db.query("update pa24.review_decision set doc_sync_status = 'pending'");
    expect(await pipeline.verifyNote('N-1')).toMatchObject({ repairedDecisionSync: 1 });
    expect((await pipeline.reader.read('docstub-1')).content).toContain('本人退回 N-1 v1');
    await writeFile(statePath, JSON.stringify({ docEdits: { 'docstub-1': '<p>重写</p>' } }));
    await pipeline.notesTool({ action: 'republish', noteId: 'N-1' }, { id: 'local' });
    await db.query("update pa24.review_decision set doc_sync_status = 'pending'");
    await pipeline.verifyNote('N-1');
    expect((await pipeline.reader.read('docstub-1')).content).toContain('待本人审核 N-1 v2');
    expect((await repos.notes.decisionsOf('N-1'))[0].doc_sync_status).toBe('superseded');
  });

});
