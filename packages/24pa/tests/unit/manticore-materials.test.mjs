import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, join, readFile, writeFile } from '../helpers/runtime.mjs';
import { FakeFeishuTransport } from '../../lib/feishu.js';
import { sha256Hex } from '../../lib/handwriting.js';
import { noteDerivedContent } from '../../lib/note-derivation.js';
import { parseMaterialDraft, materialDiff, qwenReadEvidence } from '../../lib/material-draft.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`M05 资料草稿、来源、审核及行动 (${backend})`, () => {
  let f, cluster, local, binding, workspace, child, events;
  const bytes = Buffer.from([137,80,78,71,13,10,26,10]);
  beforeEach(async () => {
    f = await fixture();
    if (backend === 'postgres') { cluster = await startPgCluster(); f.options.env.PA24_TEST_DSN = cluster.dsn; }
    const bin = join(f.root, 'lark-cli'), state = join(f.root, 'lark.json');
    await writeFile(state, JSON.stringify({ ownerOpenId: 'owner' }));
    await writeFile(bin, `#!${process.execPath}\nprocess.env.PA24_LARK_STUB_STATE=${JSON.stringify(state)};\nawait import(${JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs'))});\n`); await chmod(bin, 0o755);
    f.options.larkCliBin = bin;
    workspace = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', calendarId: 'calendar', tasklistId: 'list', maxWorkers: 5,
      enabledWorkers: ['handwriting','tasks','calendar'], workerModels: { handwriting: { provider: 'test', model: 'vision-test' } }, extraLocalTools: ['mcp__qwennote__*'],
      ...(backend === 'postgres' ? { storage: 'postgres', pgDsnEnv: 'PA24_TEST_DSN' } : {}) });
    const previousGet = f.ctx.get; f.ctx.get = name => name === 'attachments' ? { admitPromptContent: async blocks => blocks } : previousGet(name);
    f.ctx.tools = { schemas: () => [{ name: 'mcp__qwennote__read', description: '读取所选听记' }] };
    await f.rt.bind(workspace); f.rt.transport = new FakeFeishuTransport('test');
    local = f.agents.get(await f.rt.openLocalSession()); binding = f.rt.snapshot().workspaceBinding;
    f.rt.noteExtraToolResolution({ requested: ['mcp__qwennote__*'], active: ['mcp__qwennote__read'], filtered: [] });
    events = []; local.session.ownEvents = () => events;
    const path = join(workspace, '.24pa', 'originals', 'N-1', 'page.png'); await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, bytes);
    await f.rt.repos.notes.insertNote({ id: 'N-1', title: '项目纪要', origin: 'feishu' });
    await f.rt.repos.notes.insertPage({ note_id: 'N-1', page_no: 1, message_id: 'image', image_key: 'image', media_type: 'image/png', byte_size: bytes.length, sha256: sha256Hex(bytes), storage_path: path, source_type: 'image', quality: null, status: 'saved' });
    child = { id: (await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿并发布审核' }, local)).workId };
  });
  afterEach(async () => { await f?.cleanup(); await cluster?.stop(); cluster = null; });
  const detail = noteId => f.rt.materialSnapshot({ workspaceBinding: binding, kind: 'detail', noteId: noteId || 'N-1' });
  const mutation = (action, args = {}) => f.rt.changeMaterial({ workspaceBinding: binding, action, noteId: 'N-1', requestId: crypto.randomUUID(), instruction: '主人明确核对并同意本次操作', ...args });
  const submit = extra => f.rt.work({ action: 'note_submit', transcript: '李工完成报告；另行准备资料', summary: '项目纪要', candidates: [{ summary: '准备报告', sourceQuote: '李工完成报告' }, { summary: '准备资料' }], ...extra }, child);
  const approve = async versionId => {
    const token = (await f.rt.repos.notes.tokensOf(versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve-' + crypto.randomUUID(), { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
  };
  const calls = async () => (await readFile(join(f.root, 'lark.json.calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);

  it('保存与发布分开、CAS 冲突、重识别不覆盖人工修订，旧按钮无法批准新草稿', async () => {
    const first = await submit(); const before = await detail(); const oldCalls = (await calls()).length;
    expect(noteDerivedContent(before.selected).derivedStatus).toBe('ready');
    const edited = { ...before.material.draft, transcript: '主人修正：王工完成报告', candidates: [...before.material.draft.candidates].reverse() };
    const saved = await mutation('save_draft', { expectedRevision: before.material.revision, draft: edited });
    expect(saved).toMatchObject({ saved: true, published: false }); expect((await calls()).length).toBe(oldCalls);
    await expect(mutation('save_draft', { expectedRevision: before.material.revision, draft: edited })).rejects.toThrow('已变化');
    await approve(first.versionId); expect((await f.rt.repos.notes.getVersion(first.versionId)).status).toBe('stale');
    expect(await submit({ transcript: '模型再识别：赵工完成报告' })).toMatchObject({ protectedDraft: true, published: false });
    const current = await detail(); expect(current.material.draft.transcript).toContain('王工'); expect(current.material.recognition.transcript).toContain('赵工');
    expect(current.diff.reordered).toBe(true); expect(current.diff.fields).toContain('transcript'); expect(current.versions).toHaveLength(1);
    const next = await mutation('publish_draft', { expectedRevision: saved.revision });
    expect(next.version).toBe(2);
    expect(await mutation('publish_draft', { expectedRevision: saved.revision })).toMatchObject({ versionId: next.versionId, reused: true }); expect((await detail()).selected.content.transcript).toContain('王工');
    expect((await f.rt.repos.notes.getVersion(first.versionId)).status).toBe('superseded');
    await approve(next.versionId); expect((await detail()).selected.status).toBe('approved');
  });

  it('跨版本重排和改文保留候选关系；已成功对象返回变化建议，不重做', async () => {
    const first = await submit(); await approve(first.versionId);
    let view = await detail(); const candidateId = view.selected.content.candidates[0].id;
    const execute = await mutation('adopt_actions', { versionId: first.versionId, candidateIds: [candidateId] });
    expect(execute).toMatchObject({ executed: 1, failed: 0 });
    const originalOperation = execute.results[0].operationId;
    const draft = { ...view.material.draft, candidates: [view.material.draft.candidates[1], { ...view.material.draft.candidates[0], summary: '准备修订报告' }] };
    const saved = await mutation('save_draft', { expectedRevision: view.material.revision, draft });
    const next = await mutation('publish_draft', { expectedRevision: saved.revision }); await approve(next.versionId);
    const result = await mutation('adopt_actions', { versionId: next.versionId, candidateIds: [candidateId] });
    expect(result.results[0]).toMatchObject({ ok: true, reused: true, changeProposal: { proposed: { summary: '准备修订报告' } } });
    expect((await f.rt.repos.tasks.list()).map(t => t.summary)).toEqual(['准备报告']);
    expect((await calls()).filter(row => row.args.includes('create') && row.args.includes('task'))).toHaveLength(1);
    expect((await f.rt.repos.notes.actionLinks('N-1'))[0]).toMatchObject({ version_id: first.versionId, candidate_id: candidateId, authorization_record: { owner: 'owner', versionId: first.versionId } });
    await expect(mutation('adopt_actions', { versionId: first.versionId, candidateIds: [candidateId] })).rejects.toThrow(/修改|不一致/);
  });

  it('同版本重发只增加通知意图，重复 requestId 去重，不重复识别/发布；主体变化拒绝旧卡', async () => {
    const first = await submit(), before = (await calls()).filter(row => row.args.includes('+create')).length;
    const requestId = 'same-resend';
    await mutation('resend', { versionId: first.versionId, requestId }); await mutation('resend', { versionId: first.versionId, requestId });
    expect((await calls()).filter(row => row.args.includes('+create'))).toHaveLength(before);
    expect((await f.rt.repos.outbox.recent(20)).filter(o => o.dedup_key.includes(':resend:'))).toHaveLength(1);
    expect(await f.rt.repos.notes.versionsOf('N-1')).toHaveLength(1);
    const oldToken = (await f.rt.repos.notes.tokensOf(first.versionId)).find(t => t.action === 'approve').token;
    f.rt.config.ownerOpenId = 'new-owner';
    await f.rt.handwriting.processReviewCard('wrong-identity', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token: oldToken } } });
    expect((await f.rt.repos.notes.getVersion(first.versionId)).status).toBe('pending_review');
  });

  it('听记依真实本地工具回执导入，无虚构原稿；明确保存后可走同一冻结审核流程', async () => {
    const call = { type: 'tool/call', data: { callId: 'qwen-read-1', name: 'mcp__qwennote__read', arguments: '{"id":"minutes-1"}' } };
    const result = { type: 'tool/result', data: { message: { toolCallId: 'qwen-read-1', content: [{ type: 'text', text: '会议原话：周一准备材料。' }] } } };
    events.push(call, result); f.rt.onSessionEvent(local.session, result);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(await f.rt.minutesSnapshot()).toMatchObject({ configured: true, mounted: true, lastRead: { state: 'succeeded' } });
    f.rt.extraToolResolution = null; expect(await f.rt.minutesSnapshot()).toMatchObject({ configured: true, mounted: null, lastRead: null });
    f.rt.noteExtraToolResolution({ requested: ['mcp__qwennote__*'], active: ['mcp__qwennote__read'], filtered: [] });
    const input = { action: 'import_minutes', callId: 'qwen-read-1', title: '项目会议', materialType: 'transcript', sourceText: '会议原话：周一准备材料。', reference: 'minutes-1', instruction: '保存这份会议文字为待整理草稿' };
    const imported = await f.rt.notesTool(input, local);
    expect(imported).toMatchObject({ published: false, source: { kind: 'qwennote', type: 'transcript' } });
    expect(await f.rt.notesTool(input, local)).toMatchObject({ reused: true, noteId: imported.noteId });
    await expect(f.rt.notesTool({ ...input, sourceText: '伪造来源' }, local)).rejects.toThrow('不在实际');
    await expect(f.rt.notesTool(input, f.agents.get(f.rt.snapshot().workspace.accessSessionId))).rejects.toThrow('只能由本地');
    const view = await detail(imported.noteId); expect(view.pages).toEqual([]); expect(view.sourceText).toContain('会议原话');
    const published = await mutation('publish_draft', { noteId: imported.noteId, expectedRevision: imported.revision });
    const version = await f.rt.repos.notes.getVersion(published.versionId); expect(version.doc_snapshot).toContain('听记来源'); expect(version.doc_snapshot).not.toContain('原稿索引');
    expect(noteDerivedContent(version).derivedStatus).toBe('ready');
    await approve(published.versionId); expect((await f.rt.repos.notes.getVersion(published.versionId)).status).toBe('approved');
    expect(await f.rt.repos.tasks.list()).toEqual([]); expect((await f.rt.memory.search({})).total).toBe(0);
  });

  it('发布回读失败后换请求恢复同一文档；候选执行锁定当前资料，草稿保存不穿过执行边界', async () => {
    await submit(); const view = await detail();
    const saved = await mutation('save_draft', { expectedRevision: view.material.revision, draft: { ...view.material.draft, transcript: '主人确认的新修订' } });
    const insertVersion = f.rt.repos.notes.insertVersion.bind(f.rt.repos.notes); let once = true;
    f.rt.repos.notes.insertVersion = async row => { if (once) { once = false; throw new Error('本地版本提交中断'); } return insertVersion(row); };
    await expect(mutation('publish_draft', { expectedRevision: saved.revision })).rejects.toThrow('本地版本提交中断');
    const creates = (await calls()).filter(row => row.args.includes('docs') && row.args.includes('+create')).length;
    const published = await mutation('publish_draft', { expectedRevision: saved.revision }); await approve(published.versionId);
    expect((await calls()).filter(row => row.args.includes('docs') && row.args.includes('+create'))).toHaveLength(creates);
    let enter, release; const entered = new Promise(resolve => { enter = resolve; }), held = new Promise(resolve => { release = resolve; });
    const taskCreate = f.rt.taskCreate.bind(f.rt); f.rt.taskCreate = async (...args) => { enter(); await held; return taskCreate(...args); };
    const executing = mutation('adopt_actions', { versionId: published.versionId, candidateIds: [view.material.draft.candidates[0].id] }); await entered;
    let savedAgain = false; const saving = mutation('save_draft', { expectedRevision: saved.revision, draft: { ...view.material.draft, transcript: '执行后修订' } }).then(value => { savedAgain = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 30)); expect(savedAgain).toBe(false); release();
    expect(await executing).toMatchObject({ executed: 1, failed: 0 }); await saving;
    expect((await f.rt.repos.workItems.list(undefined, 30)).filter(row => row.id.startsWith('pa24-material-')).every(row => ['failed','completed'].includes(row.status))).toBe(true);
  });

  it('批准凭证绑定当前主人；远端人工修订后的重识别只提供对照', async () => {
    const published = await submit(); await approve(published.versionId); const initial = await detail();
    f.rt.config.ownerOpenId = 'new-owner';
    await expect(mutation('adopt_actions', { versionId: published.versionId, candidateIds: [initial.material.draft.candidates[0].id] })).rejects.toThrow('当前主人');
    f.rt.config.ownerOpenId = 'owner';
    const journal = join(f.root, 'lark.json.docs.jsonl'), docs = (await readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse);
    const old = docs.filter(row => row.id === initial.selected.doc_id).at(-1);
    await writeFile(journal, JSON.stringify({ ...old, content: old.content.replace('李工完成报告', '主人远端手工修订'), revision: old.revision + 1 }) + '\n', { flag: 'a' });
    const next = await f.rt.notesTool({ action: 'republish', noteId: 'N-1' }, local);
    expect(await submit({ transcript: '新模型识别' })).toMatchObject({ protectedDraft: true, published: false });
    const current = await detail(); expect(current.selected.id).toBe(next.versionId); expect(current.selected.doc_snapshot).toContain('主人远端手工修订');
  });

  it('直接资料操作有真实运行档案，重复请求和失败重放不再执行，不能启动 Worker 接续', async () => {
    const first = await submit(), view = await detail(), agents = f.agents.size;
    const input = { expectedRevision: view.material.revision, requestId: 'direct-publish-once' };
    const result = await mutation('publish_draft', input);
    expect(await mutation('publish_draft', input)).toEqual(result);
    const run = await f.rt.workerRuns.inspect({ workspaceBinding: binding, runId: result.runId });
    expect(run).toMatchObject({ run: { status: 'completed', session_id: local.id, snapshot: { executor: 'material-action', modelRequested: false } }, execution: null });
    expect(run.inputs).toEqual([]); expect(run.calls).toHaveLength(1); expect(run.calls[0].status).toBe('succeeded');
    expect((await f.rt.runHistory.list({ workspaceBinding: binding, workId: result.workId, range: 'all' })).rows).toHaveLength(1);
    expect(f.agents.size).toBe(agents);
    for (const action of ['continue', 'stop']) await expect(f.rt.control({ action, workId: result.workId }, local)).rejects.toThrow('原资料');
    await expect(f.rt.changeWork({ workspaceBinding: binding, workId: result.workId, expectedRevision: run.work.revision, requestId: crypto.randomUUID(), op: 'continue', confirm: true, instruction: '继续' })).rejects.toThrow('原资料');
    const adopt = { versionId: result.versionId, candidateIds: [view.material.draft.candidates[0].id], requestId: 'failed-before-approval' };
    await expect(mutation('adopt_actions', adopt)).rejects.toThrow('审核');
    await approve(result.versionId);
    await expect(mutation('adopt_actions', adopt)).rejects.toThrow('审核');
    expect(await f.rt.repos.tasks.list()).toHaveLength(0);
    expect(await mutation('adopt_actions', { ...adopt, requestId: 'new-explicit-approved-request' })).toMatchObject({ executed: 1, failed: 0 });
    expect(f.agents.size).toBe(agents);
  });

  it('面板显式操作在空白会话被切到其他预设后建立正确入口，不修改原会话也不请求模型', async () => {
    await submit(); const view = await detail(), previous = local.id, prompts = f.prompts.length;
    local.session.header.agentPreset = 'standard';
    const result = await mutation('publish_draft', { expectedRevision: view.material.revision });
    const run = await f.rt.workerRuns.inspect({ workspaceBinding: binding, runId: result.runId });
    expect(run.run.session_id).not.toBe(previous);
    expect(f.agents.get(run.run.session_id).session.header.agentPreset).toBe('pa24');
    expect(f.agents.get(previous).session.header.agentPreset).toBe('standard');
    expect(f.prompts).toHaveLength(prompts); expect(run.inputs).toEqual([]);
  });

  it('部分失败返回原回执，重启中断保留未知动作且不覆盖历史成功或自动接续', async () => {
    const first = await submit(); await approve(first.versionId); const view = await detail();
    const original = f.rt.taskCreate.bind(f.rt), summaries = [];
    f.rt.taskCreate = async (item, args) => { summaries.push(args.summary); if (args.summary === '准备资料') throw new Error('该候选暂时失败'); return original(item, args); };
    const input = { versionId: first.versionId, candidateIds: view.material.draft.candidates.map(c => c.id), requestId: 'partial-once' };
    const result = await mutation('adopt_actions', input); expect(result).toMatchObject({ executed: 1, failed: 1 });
    expect(await mutation('adopt_actions', input)).toEqual(result); expect(summaries).toHaveLength(2);
    expect((await f.rt.workerRuns.inspect({ workspaceBinding: binding, runId: result.runId })).run.status).toBe('failed');
    const item = await f.rt.repos.workItems.insert({ id: 'pa24-material-interrupted', title: '中断资料操作', role: 'handwriting', instruction: '{}', origin: 'local', parent_session_id: local.id, delivery: `local:${local.id}`, status: 'running' });
    const run = await f.rt.repos.workerRuns.beginMaterial(item, { path: workspace, id: f.rt.workspace.id }, 'publish_draft');
    const agents = f.agents.size; await f.rt.repos.workerRuns.recoverMaterials(); await f.rt.repos.workerRuns.recoverMaterials();
    const recovered = await f.rt.workerRuns.inspect({ workspaceBinding: binding, runId: run.id });
    expect(recovered).toMatchObject({ run: { status: 'failed' }, work: { status: 'failed' }, execution: null });
    expect(recovered.calls[0].status).toBe('unknown'); expect(recovered.inputs).toEqual([]); expect(f.agents.size).toBe(agents);
    await expect(f.rt.repos.workerRuns.finishMaterial(item.id, '迟到结果', {})).rejects.toThrow('不能覆盖');
    expect(await mutation('adopt_actions', input)).toEqual(result); expect(await f.rt.repos.tasks.list()).toHaveLength(1);
  });

  it('完整计数与分页不受最近记录上限影响；原稿按工作区与摘要校验，不接受旧绑定', async () => {
    for (let i = 2; i <= 54; i++) { await f.rt.repos.notes.insertNote({ id: 'N-' + i, title: '记录' + i, origin: 'feishu' }); await f.rt.repos.notes.updateNote('N-' + i, { status: i % 2 ? 'returned' : 'awaiting_review' }); }
    const page = await f.rt.materialSnapshot({ workspaceBinding: binding, status: 'pending', limit: 20, offset: 40 });
    expect(page).toMatchObject({ matched: 53, total: 54 }); expect(page.items).toHaveLength(13); expect(page.counts.returned + page.counts.awaiting_review).toBe(53); expect((await f.rt.reviewQueue()).count).toBe(53);
    const read = await f.rt.materialSnapshot({ workspaceBinding: binding, kind: 'original', noteId: 'N-1', pageNo: 1 }); expect(read.data).toContain('data:image/png;base64,');
    await writeFile(join(workspace, '.24pa', 'originals', 'N-1', 'page.png'), Buffer.from('changed'));
    await expect(f.rt.materialSnapshot({ workspaceBinding: binding, kind: 'original', noteId: 'N-1', pageNo: 1 })).rejects.toThrow('摘要');
    await expect(f.rt.materialSnapshot({ workspaceBinding: 'other' })).rejects.toThrow('工作区');
  });
});

it('候选标识不可任意冒用，重复行动不含糊合并；正文/页序/疑点/候选差异单独可见', () => {
  const base = parseMaterialDraft({ transcript: '原文', candidates: [{ summary: 'A' }, { summary: 'A' }] }, null, [1,2], '原稿');
  expect(base.candidates[0].id).not.toBe(base.candidates[1].id);
  expect(() => parseMaterialDraft({ ...base, candidates: [{ id: 'foreign', summary: 'A' }] }, base, [1,2], '原稿')).toThrow('关联');
  const next = parseMaterialDraft({ ...base, pageOrder: [2,1], unknowns: ['日期待核对'], candidates: [...base.candidates].reverse() }, base, [1,2], '原稿');
  expect(materialDiff(base, next)).toMatchObject({ reordered: true, fields: ['pageOrder','unknowns'] });
  expect(() => qwenReadEvidence({ id: 'a', ownEvents: () => [{ type: 'tool/call', data: { callId: 'x', name: 'mcp__qwennote__read' } }, { type: 'tool/result', data: { message: { toolCallId: 'x', isError: true, content: [{ type: 'text', text: 'failed' }] } } }] }, 'x')).toThrow('成功');
});
