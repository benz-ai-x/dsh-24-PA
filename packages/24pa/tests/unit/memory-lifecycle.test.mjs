import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import nodeFs from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryStore, parseMemoryFile, planMemoryRestore, emptyMemory, memoryStatementHash } from '../../lib/memory.js';
import { fixture as runtimeFixture } from '../helpers/runtime.mjs';
const at = '2026-10-23T00:00:00Z';
const record = (id, patch = {}) => ({ id, category: 'fact', topic: `主题 ${id}`, content: `完整正文 ${id}`, source: '本人明确指令', status: 'confirmed', confirmation: { kind: 'owner_instruction', text: `请记住 ${id}`, at, by: 'owner' }, updatedAt: at, updatedBy: 'owner', reason: '主人维护', ...patch });
const opts = revision => ({ expectedRevision: revision, actor: 'owner', reason: '主人明确维护' });
const paths = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'm06-memory-')); paths.push(dir);
  const fs = { async resolve(path) { return { path }; }, async stat({ path }) { try { return { version: createHash('sha256').update(await readFile(path)).digest('hex') }; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }, async readText({ path }) { return readFile(path, 'utf8'); }, async writeText(target, value, intent) { const current = await this.stat(target); if ((intent.kind === 'createIfAbsent' && current) || (intent.kind === 'replaceIfVersion' && current?.version !== intent.version)) throw Error('FS_STALE_VERSION'); await writeFile(target.path, value); return { ok: true }; } };
  const store = new MemoryStore(dir, { fs });
  const memoryPath = join(dir, '.24pa/memory.json');
  return { dir, fs, store, memoryPath, file: async () => parseMemoryFile(await readFile(memoryPath, 'utf8')) };
}

it('schema 1 只读不迁移，缺确认依据只作线索；第一次维护升级并保留未知字段', async () => {
  const { store, memoryPath, file } = await fixture(); await store.search({});
  const legacy = { schemaVersion: 1, revision: 7, records: [record('legacy', { confirmation: undefined, extra: { ownerNote: 'retain' } })] };
  await writeFile(memoryPath, JSON.stringify(legacy)); const raw = await readFile(memoryPath, 'utf8');
  const found = await store.search({}); expect(found.records[0].effective).toMatchObject({ confirmation: 'missing', useAs: 'clue' });
  expect((await store.search({ mode: 'facts' })).matched).toBe(0); expect(await readFile(memoryPath, 'utf8')).toBe(raw);
  await store.transition('legacy', 'deactivate', opts(7)); expect((await file())).toMatchObject({ schemaVersion: 2, revision: 8, records: [{ extra: { ownerNote: 'retain' }, lifecycle: 'inactive' }] });
});

it('确认绑定具体陈述，来源核验独立；复制旧确认或只审核文档不能提升当前事实', async () => {
  const { store } = await fixture();
  await store.put(record('confirmed', { sourceCheck: { state: 'unavailable', checkedAt: at, evidence: '只读检查返回 403' } }), opts(0));
  const checked = (await store.search({ mode: 'facts' })).records[0]; expect(checked.effective.useAs).toBe('fact');
  expect(checked.confirmation.statementHash).toBe(memoryStatementHash(checked));
  await store.put({ ...checked, content: '改写后的另一项陈述' }, opts(1));
  expect((await store.search({})).records[0].effective).toMatchObject({ useAs: 'clue', confirmation: 'unverified' });
  await expect(store.put(record('doc', { confirmation: { kind: 'document_approval', text: '文档已审核', at, by: 'owner' } }), opts(2))).rejects.toThrow('确认依据类型');
  await store.put(record('inferred', { status: 'unverified', confirmation: undefined, source: '审核通过的笔记' }), opts(2));
  expect((await store.search({ mode: 'facts' })).matched).toBe(0);
});

it('所有管理状态可检索且计数基于全量；业务隔离停用、回收、过期和显式冲突', async () => {
  const { store } = await fixture();
  const changes = Array.from({ length: 47 }, (_, n) => ({ op: 'put', record: record(`r${n}`, { scope: { kind: 'project', name: n < 30 ? '项目甲' : '项目乙' }, ...(n < 5 ? { lifecycle: 'inactive' } : n < 9 ? { lifecycle: 'recycled' } : n < 12 ? { validUntil: '2000-01-01' } : n < 15 ? { conflict: { state: 'unresolved', relatedIds: ['r40'], reason: '证据冲突待核实' } } : {}) }), reason: '主人批量导入' }));
  const preview = await store.previewChangeset(changes, opts(0)); await store.applyChangeset(preview.changes, { ...opts(0), previewToken: preview.previewToken });
  const full = await store.search({ mode: 'manage', limit: 20, offset: 20 });
  expect(full).toMatchObject({ total: 47, matched: 47, offset: 20, counts: { inactive: 5, recycled: 4, expired: 3, conflicts: 3, facts: 32 } }); expect(full.records).toHaveLength(20);
  expect((await store.search({})).total).toBe(32);
  expect((await store.search({ mode: 'manage', project: '项目甲', lifecycle: 'inactive' }))).toMatchObject({ total: 47, matched: 5 });
  expect((await store.search({ mode: 'manage', query: '正文 r46' })).records[0].id).toBe('r46');
  expect((await store.search({ mode: 'manage', freshness: 'expired' })).matched).toBe(3);
  expect((await store.search({ mode: 'manage', offset: 1000 })).offset).toBe(40);
});

it('冲突按类别、范围及有效期间判断；可能冲突只能作为线索，双方处理依据齐全才解除', async () => {
  const { store } = await fixture();
  await store.put(record('a', { topic: '上线', content: '周一', scope: { kind: 'project', name: '甲' } }), opts(0));
  await store.put(record('b', { topic: '上线', content: '周三', scope: { kind: 'project', name: '乙' } }), opts(1));
  expect((await store.search({ mode: 'facts' })).matched).toBe(2);
  await store.put(record('c', { topic: '上线', content: '周五', scope: { kind: 'project', name: '甲' } }), opts(2));
  expect((await store.search({ mode: 'facts' })).records.map(row => row.id)).toEqual(['b']);
  expect((await store.search({ mode: 'manage', conflict: 'candidate' })).matched).toBe(2);
  expect((await store.inspect()).conflicts).toEqual([{ topic: '上线', ids: ['a', 'c'] }]);
  await store.put(record('a', { topic: '上线', content: '周一', scope: { kind: 'project', name: '甲' }, validUntil: '2026-01-01' }), opts(3));
  await store.put(record('c', { topic: '上线', content: '周五', scope: { kind: 'project', name: '甲' }, validFrom: '2026-02-01' }), opts(4));
  expect((await store.search({ mode: 'manage', conflict: 'candidate' })).matched).toBe(0);
});

it('批量预览绑定实际 ID、完整文件和本地会话；同 revision 手改也拒绝旧预览', async () => {
  const { store, memoryPath, file } = await fixture(); await store.put(record('r'), opts(0));
  const changes = [{ op: 'put', record: record(undefined), reason: '新增' }, { op: 'deactivate', id: 'r', reason: '停用' }];
  const preview = await store.previewChangeset(changes, opts(1)); expect(preview.changes[0].record.id).toBeTruthy();
  await expect(store.applyChangeset(preview.changes, { ...opts(1), actor: 'other', previewToken: preview.previewToken })).rejects.toThrow('预览已过期');
  const current = await file(); current.records[0].scope = { kind: 'company', name: '公司' }; await writeFile(memoryPath, JSON.stringify(current));
  expect((await store.search({ mode: 'manage' })).trackedRevision).toBe('changed');
  await expect(store.applyChangeset(preview.changes, { ...opts(1), previewToken: preview.previewToken })).rejects.toThrow('预览已过期');
  const fresh = await store.previewChangeset(changes, opts(1)); await store.applyChangeset(fresh.changes, { ...opts(1), previewToken: fresh.previewToken });
  expect((await store.search({ mode: 'manage' })).records.map(row => row.id)).toContain(fresh.changes[0].record.id);
});

it('回收/恢复保留内容与来源；永久删除清除修订正文、审计理由和一切可撤销版本', async () => {
  const { store, dir, file } = await fixture();
  const secretBody = '要永久清除的独有正文-M06';
  await store.put(record('r', { content: secretBody }), { ...opts(0), reason: secretBody });
  await store.put(record('r', { content: secretBody + ' v2' }), { ...opts(1), reason: secretBody });
  await expect(store.transition('r', 'purge', opts(2))).rejects.toThrow('必须先回收');
  await store.remove('r', opts(2)); expect((await store.search({})).matched).toBe(0); expect((await store.search({ mode: 'manage', lifecycle: 'recycled' })).matched).toBe(1);
  await store.transition('r', 'restore', opts(3)); expect((await store.search({})).records[0].source).toBe('本人明确指令');
  const priorHistory = await store.history('r'); expect(priorHistory.revisions).toHaveLength(4);
  await store.remove('r', opts(4)); const purged = await store.transition('r', 'purge', { ...opts(5), reason: secretBody }); expect(purged.audit).toBe('recorded');
  expect(await file()).toMatchObject({ revision: 6, records: [], tombstones: [{ id: 'r', revision: 6 }] });
  const history = await store.history('r'); expect(history.permanent).toBe(true); expect(history.revisions.every(row => row.before === null && row.after === null && !row.undoable)).toBe(true);
  const names = await readdir(join(dir, '.24pa/changesets'));
  for (const path of [join(dir, '.24pa/memory.json'), join(dir, '.24pa/memory-log.jsonl'), ...names.map(name => join(dir, '.24pa/changesets', name))]) expect(await readFile(path, 'utf8')).not.toContain(secretBody);
  await expect(store.put(record('r'), opts(6))).rejects.toThrow('永久删除');
  await expect(store.undo(priorHistory.revisions[0].id, opts(6))).rejects.toThrow('永久删除');
});

it('永久删除清理中断如实返回已提交，重启只清理派生历史且不会重写权威', async () => {
  const { store, dir, fs, memoryPath } = await fixture(); await store.put(record('r', { content: 'interrupt-private-body' }), opts(0)); await store.remove('r', opts(1));
  const changesetsDir = join(dir, '.24pa/changesets'), rename = nodeFs.promises.rename;
  const publication = vi.spyOn(nodeFs.promises, 'rename').mockImplementation(async (source, target) => {
    if (dirname(target) === changesetsDir) throw Object.assign(Error('disk unavailable'), { code: 'EIO' });
    return rename(source, target);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await store.transition('r', 'purge', opts(2)); }
  finally { publication.mockRestore(); syncBuiltinESMExports(); }
  expect(result).toMatchObject({ revision: 3, audit: 'pending' }); expect(result.warning).toContain('清理待完成');
  const raw = await readFile(memoryPath, 'utf8'); expect(raw).not.toContain('interrupt-private-body');
  const interruptedHistory = await Promise.all((await readdir(changesetsDir)).map(name => readFile(join(changesetsDir, name), 'utf8')));
  expect(interruptedHistory.some(content => content.includes('interrupt-private-body'))).toBe(true);
  const restarted = new MemoryStore(dir, { fs }); expect((await restarted.search({})).auditWarning).toBeUndefined(); expect(await readFile(memoryPath, 'utf8')).toBe(raw);
  for (const name of await readdir(join(dir, '.24pa/changesets'))) expect(await readFile(join(dir, '.24pa/changesets', name), 'utf8')).not.toContain('interrupt-private-body');
});

it('旧备份恢复规划保留当前更新和双方删除标记，不复活已删正文且明确冲突', async () => {
  const { store, file } = await fixture(); await store.put(record('keep'), opts(0)); await store.put(record('gone'), opts(1)); const backup = await file();
  await store.put(record('keep', { content: '当前较新正文' }), opts(2)); await store.remove('gone', opts(3)); await store.transition('gone', 'purge', opts(4));
  backup.records.push(record('missing')); const current = await file(); const result = planMemoryRestore(current, backup);
  expect(result.added).toEqual(['missing']); expect(result.protectedIds).toEqual(['gone']); expect(result.conflicts).toEqual(['keep']); expect(result.file.revision).toBe(6);
  expect(result.file.records.map(row => row.id)).toEqual(['keep', 'missing']); expect(result.file.records[0].content).toBe('当前较新正文'); expect(current).toEqual(await file());
  expect(parseMemoryFile(JSON.stringify(result.file)).tombstones).toEqual(current.tombstones);
});

it('新字段完整 CAS 撤销，嵌套对象重排不误报；错误文件不会清空', async () => {
  const { store, memoryPath, file } = await fixture();
  const batch = await store.applyChangeset([{ op: 'put', record: record('r', { scope: { kind: 'project', name: '甲' } }), reason: '本人指令' }], opts(0));
  const changed = await file(); changed.records[0].scope = { name: '乙', kind: 'project' }; await writeFile(memoryPath, JSON.stringify(changed));
  await expect(store.undo(batch.changesetId, opts(1))).rejects.toThrow('又被修改');
  changed.records[0].scope = { name: '甲', kind: 'project' }; await writeFile(memoryPath, JSON.stringify(changed));
  await store.undo(batch.changesetId, opts(1)); expect((await store.search({})).records).toEqual([]);
  await writeFile(memoryPath, '{bad-json'); await expect(store.search({})).rejects.toThrow('有效 JSON'); expect(await readFile(memoryPath, 'utf8')).toBe('{bad-json');
});

it.each([{ validFrom: 'bad' }, { validFrom: '2030-01-01', validUntil: '2020-01-01' }, { lifecycle: 'deleted' }, { scope: { kind: 'project' } }, { sourceCheck: { state: 'current' } }])('无效生命周期字段拒绝且不提交：%j', async patch => {
  const { store } = await fixture(); await expect(store.put(record('r', patch), opts(0))).rejects.toThrow(); expect((await store.search({})).revision).toBe(0);
});

it('本地维护与业务只读分开；批量必须给预览，面板绑定拒绝跨工作区', async () => {
  const f = await runtimeFixture();
  try {
    const path = await f.workspace('memory'); await f.rt.bind(path); const owner = [...f.agents.values()].find(agent => f.rt.roleFor(agent) === 'local-robot');
    const put = { action: 'put', id: 'r', category: 'fact', topic: '主题', content: '正文', source: '本人', status: 'confirmed', confirmation: '请记住正文', reason: '明确维护', expectedRevision: 0 };
    await f.rt.memoryTool(put, owner); expect((await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).matched).toBe(1);
    await expect(f.rt.memoryTool({ action: 'apply', expectedRevision: 1, reason: '批量整理', changes: [{ op: 'deactivate', id: 'r', reason: '停用' }, { op: 'activate', id: 'r', reason: '启用' }] }, owner)).rejects.toThrow('先通过 preview');
    const access = [...f.agents.values()].find(agent => f.rt.roleFor(agent) === 'feishu-access');
    for (const action of ['put', 'delete', 'purge', 'history', 'changesets', 'inspect', 'preview']) await expect(f.rt.memoryTool({ ...put, action }, access)).rejects.toThrow('仅限');
    await expect(f.rt.memoryTool({ action: 'search', mode: 'manage' }, access)).rejects.toThrow('仅限');
    const preview = await f.rt.memoryTool({ action: 'preview', expectedRevision: 1, changes: [{ op: 'deactivate', id: 'r', reason: '停用' }] }, owner);
    await f.rt.memoryTool({ action: 'apply', expectedRevision: 1, reason: '确认预览', changes: preview.changes, previewToken: preview.previewToken }, owner);
    expect((await f.rt.memorySnapshot({})).counts.inactive).toBe(1); expect((await f.rt.memoryTool({ action: 'search' }, access)).records).toEqual([]); await expect(f.rt.memorySnapshot({ workspaceBinding: 'old-binding' })).rejects.toThrow('工作区');
  } finally { await f.cleanup(); }
});

it('停用项回收后修改与恢复保留回收前停用状态，不自动重新启用', async () => {
  const { store } = await fixture(); await store.put(record('r', { lifecycle: 'inactive' }), opts(0)); await store.remove('r', opts(1));
  await store.put(record('r', { content: '回收内更正', confirmation: undefined }), opts(2)); await store.transition('r', 'restore', opts(3));
  expect((await store.search({ mode: 'manage' })).records[0].lifecycle).toBe('inactive'); expect((await store.search({})).records).toEqual([]);
});

it('实际维护入口重复旧确认不会给新正文重新授信，原凭证保留且新明确确认才能成为事实', async () => {
  const f = await runtimeFixture();
  try {
    const path = await f.workspace('confirmation'); await f.rt.bind(path);
    const owner = [...f.agents.values()].find(agent => f.rt.roleFor(agent) === 'local-robot');
    const command = { action: 'put', id: 'colour', category: 'preference', topic: '颜色', content: '我喜欢红色', source: '本地主人指令', status: 'confirmed', confirmation: '记住我喜欢红色', reason: '主人维护' };
    await f.rt.memoryTool({ ...command, expectedRevision: 0 }, owner);
    const original = (await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records[0].confirmation;
    await f.rt.memoryTool({ ...command, content: '我喜欢蓝色', expectedRevision: 1 }, owner);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records).toEqual([]);
    const changed = (await f.rt.memoryTool({ action: 'search', mode: 'manage' }, owner)).records[0];
    expect(changed).toMatchObject({ content: '我喜欢蓝色', status: 'unverified', effective: { confirmation: 'unverified', useAs: 'clue' } });
    expect(changed.confirmation).toEqual(original);
    await f.rt.memoryTool({ ...command, content: '我喜欢蓝色', expectedRevision: 2 }, owner);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records).toEqual([]);
    await f.rt.memoryTool({ ...command, content: '我喜欢蓝色', confirmation: '我现在明确确认：喜欢蓝色，请记住这个更正', expectedRevision: 3 }, owner);
    const confirmed = (await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records[0];
    expect(confirmed.content).toBe('我喜欢蓝色'); expect(confirmed.confirmation.statementHash).not.toBe(original.statementHash);
    const changes = [{ op: 'put', record: { ...confirmed, content: '我喜欢绿色', confirmation: { ...confirmed.confirmation, at: '2026-10-24T00:00:00Z', statementHash: undefined } }, reason: '批量修改，但没有新的确认' }];
    const preview = await f.rt.memoryTool({ action: 'preview', expectedRevision: 4, changes }, owner);
    expect(preview.after.colour.status).toBe('unverified'); expect(preview.after.colour.confirmation).toEqual(confirmed.confirmation);
    await f.rt.memoryTool({ action: 'apply', expectedRevision: 4, changes: preview.changes, previewToken: preview.previewToken, reason: '接受待核实修改' }, owner);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records).toEqual([]);
  } finally { await f.cleanup(); }
});

it('实际维护入口同措辞新引用确认当前内容，同引用或缺失引用不能重新授信', async () => {
  const f = await runtimeFixture();
  try {
    const path = await f.workspace('confirmation-reference'); await f.rt.bind(path);
    const owner = [...f.agents.values()].find(agent => f.rt.roleFor(agent) === 'local-robot');
    const command = { action: 'put', id: 'colour', category: 'preference', topic: '颜色', content: '我喜欢红色', source: '本地主人指令', status: 'confirmed', confirmation: '我确认当前这条偏好，请记住', confirmationReference: 'message-1', reason: '主人维护' };
    await f.rt.memoryTool({ ...command, expectedRevision: 0 }, owner);
    const original = (await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records[0].confirmation;
    await f.rt.memoryTool({ ...command, content: '我喜欢蓝色', expectedRevision: 1 }, owner);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records).toEqual([]);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'manage' }, owner)).records[0].confirmation).toEqual(original);
    await f.rt.memoryTool({ ...command, content: '我喜欢蓝色', confirmationReference: undefined, expectedRevision: 2 }, owner);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records).toEqual([]);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'manage' }, owner)).records[0].confirmation).toEqual(original);
    await f.rt.memoryTool({ ...command, content: '我喜欢蓝色', confirmationReference: 'message-2', expectedRevision: 3 }, owner);
    const facts = (await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records;
    expect(facts).toMatchObject([{ content: '我喜欢蓝色', status: 'confirmed', confirmation: { text: command.confirmation, reference: 'message-2' }, effective: { confirmation: 'verified', useAs: 'fact' } }]);
    expect(facts[0].confirmation.statementHash).not.toBe(original.statementHash);
    await f.rt.memoryTool({ ...command, content: '我喜欢绿色', confirmation: '改写引用文字也不能改变原指令', confirmationReference: 'message-2', expectedRevision: 4 }, owner);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'facts' }, owner)).records).toEqual([]);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'manage' }, owner)).records[0].confirmation).toEqual(facts[0].confirmation);
  } finally { await f.cleanup(); }
});

it('实际维护入口撤销旧 schema 1 条目的停用，恢复缺省 active 与原内容', async () => {
  const f = await runtimeFixture();
  try {
    const path = await f.workspace('legacy-undo'); await f.rt.bind(path);
    const owner = [...f.agents.values()].find(agent => f.rt.roleFor(agent) === 'local-robot');
    await f.rt.memoryTool({ action: 'search', mode: 'manage' }, owner);
    const legacy = record('legacy', { confirmation: undefined });
    await writeFile(join(path, '.24pa/memory.json'), JSON.stringify({ schemaVersion: 1, revision: 7, records: [legacy] }));
    await f.rt.memoryTool({ action: 'deactivate', id: 'legacy', expectedRevision: 7, reason: '暂时停用' }, owner);
    expect((await f.rt.memoryTool({ action: 'search' }, owner)).records).toEqual([]);
    const history = await f.rt.memoryTool({ action: 'history', id: 'legacy' }, owner);
    expect(await f.rt.memoryTool({ action: 'undo', changesetId: history.revisions[0].id, expectedRevision: 8, reason: '撤销刚才的停用' }, owner)).toMatchObject({ revision: 9, audit: 'recorded' });
    expect((await f.rt.memoryTool({ action: 'search' }, owner)).records).toMatchObject([{ id: 'legacy', content: legacy.content, effective: { lifecycle: 'active' } }]);
    expect((await f.rt.memoryTool({ action: 'search', mode: 'manage' }, owner)).counts).toMatchObject({ active: 1, inactive: 0 });
  } finally { await f.cleanup(); }
});
