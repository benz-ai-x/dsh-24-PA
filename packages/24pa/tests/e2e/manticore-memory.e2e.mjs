// M06: real fixed dsh Loader/Session/fs and SQLite/PostgreSQL ledger. Only the
// model and Feishu transport are fixtures; no external account is mutated.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { parseMemoryFile, planMemoryRestore } from '../../lib/memory.js';
let root, workspace, cluster, llm, host, hostRoot, scriptPath, bootEnv, localId, accessId, binding;
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const decode = value => {
  if (typeof value === 'string') { try { return decode(JSON.parse(value)); } catch { return value; } }
  if (Array.isArray(value)) return value.map(decode).find(value => value && typeof value === 'object' && !Array.isArray(value)) ?? value;
  if (value?.type === 'text') return decode(value.text);
  return value;
};
let sequence = 0;
async function tool(input, sessionId = localId) {
  const start = llm.log.length;
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', leadTool: { name: 'pa24_memory', input }, leadReply: '已返回实际工具结果。' }));
  await host.remote('session/prompt', { request: { requestId: `m06-${++sequence}`, sessionId, mode: 'queue', content: [{ type: 'text', text: '主人明确发起本地记忆维护：' + JSON.stringify(input) }], clientTimeZone: 'Asia/Shanghai' } });
  for (let index = 0; index < 600; index++) {
    const requests = llm.log.slice(start);
    if (requests.length >= 2) {
      const result = requests.at(-1).toolResults?.at(-1);
      if (result) return decode(result);
    }
    await pause();
  }
  throw Error('等待真实 Session 记忆工具回执超时');
}
async function current() { return parseMemoryFile(await readFile(join(workspace, '.24pa/memory.json'), 'utf8')); }
const put = (id, revision, patch = {}) => ({ action: 'put', id, category: 'preference', topic: `项目 ${id}`, content: `完整记忆正文 ${id}`, source: '本地主人指令', status: 'confirmed', confirmation: `请记住完整记忆正文 ${id}`, expectedRevision: revision, reason: '主人明确维护', ...patch });
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'manticore-m06-')); cluster = await startPgCluster();
  workspace = join(root, 'workspace'); await mkdir(workspace); scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  await writeFile(join(workspace, 'AGENTS.md'), '# M06 隔离工作区\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, version: 1, mode: 'demo', storage: process.env.PA24_E2E_STORAGE === 'sqlite' ? 'sqlite' : 'postgres', pgDsnEnv: 'PA24_PG_DSN', timeZone: 'Asia/Shanghai', enabledWorkers: ['memo'] }) + '\n```\n');
  bootEnv = { PA24_WORKSPACE: workspace, PA24_PG_DSN: cluster.dsn, PA24_TRANSPORT: 'fake', DEEPSEEK_BASE_URL: llm.url, DEEPSEEK_API_KEY: 'test-key' };
  host = await bootHost({ env: bootEnv }); hostRoot = host.root;
  const snapshot = await host.waitUntil(snapshot => Boolean(snapshot.workspace?.localSessionId), { label: 'M06 本地会话' });
  localId = snapshot.workspace.localSessionId; accessId = snapshot.workspace.accessSessionId; binding = snapshot.workspaceBinding;
}, 600_000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); await rm(root, { recursive: true, force: true }); });

describe('Manticore M06 真实 Loader / Session / 条件文件写入', () => {
  it('本地确认、维护、全量管理查询和业务事实查询；保存与资料审核不会自动确认', async () => {
    expect(await tool(put('one', 0))).toMatchObject({ revision: 1, audit: 'recorded' });
    const facts = await tool({ action: 'search', mode: 'facts' }); expect(facts.records[0].effective.useAs).toBe('fact');
    await tool(put('candidate', 1, { status: 'unverified', confirmation: undefined, source: '已审核文档' }));
    expect((await tool({ action: 'search', mode: 'facts' })).matched).toBe(1);
    const panel = await host.api('memory', { workspaceBinding: binding }); expect(panel).toMatchObject({ total: 2, matched: 2, counts: { facts: 1, clues: 1 }, workspaceBinding: binding });
    const logCount = llm.log.length; await host.api('memory', { query: 'candidate' }); await host.api('memory.history', { id: 'one', workspaceBinding: binding }); expect(llm.log.length).toBe(logCount);
    expect(JSON.stringify(await tool({ action: 'search', mode: 'manage' }, accessId))).toContain('仅限');
  });

  it('批次预览授权、CAS 撤销和外部手改；旧 revision 与坏文件拒绝且不清空', async () => {
    const changes = [{ op: 'deactivate', id: 'one', reason: '暂时不用' }, { op: 'delete', id: 'candidate', reason: '回收候选' }];
    const preview = await tool({ action: 'preview', expectedRevision: 2, changes }); expect(preview.previewToken).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(await tool({ action: 'apply', expectedRevision: 2, changes, reason: '批量维护' }))).toContain('先通过 preview');
    const applied = await tool({ action: 'apply', expectedRevision: 2, changes: preview.changes, previewToken: preview.previewToken, reason: '已核对并选择这两项' }); expect(applied.revision).toBe(3);
    expect((await tool({ action: 'search' })).records).toEqual([]);
    expect((await host.api('memory', { lifecycle: 'recycled' })).matched).toBe(1);
    await tool({ action: 'undo', changesetId: applied.changesetId, expectedRevision: 3, reason: '主人要求撤销' }); expect((await current()).revision).toBe(4);
    expect(JSON.stringify(await tool(put('one', 2)))).toContain('重新查询');
    const file = await current(); file.records[0].source = '手工更新的来源'; await writeFile(join(workspace, '.24pa/memory.json'), JSON.stringify(file));
    expect((await host.api('memory', {})).trackedRevision).toBe('changed');
    expect(JSON.stringify(await tool({ action: 'undo', changesetId: applied.changesetId, expectedRevision: 4, reason: '旧撤销' }))).toContain('又被修改');
    const raw = await readFile(join(workspace, '.24pa/memory.json'), 'utf8'); await writeFile(join(workspace, '.24pa/memory.json'), '{broken');
    await expect(host.api('memory', {})).rejects.toThrow('有效 JSON'); expect(await readFile(join(workspace, '.24pa/memory.json'), 'utf8')).toBe('{broken'); await writeFile(join(workspace, '.24pa/memory.json'), raw);
  });

  it('回收恢复与永久删除具有独立回执，实际磁盘所有修订清除正文，旧备份不能复活', async () => {
    const backup = await current();
    await tool({ action: 'delete', id: 'one', expectedRevision: 4, reason: '回收 one' });
    await tool({ action: 'restore', id: 'one', expectedRevision: 5, reason: '恢复 one' });
    await tool({ action: 'delete', id: 'one', expectedRevision: 6, reason: '再次回收 one' });
    const result = await tool({ action: 'purge', id: 'one', expectedRevision: 7, reason: '永久删除 one' }); expect(result).toMatchObject({ revision: 8, audit: 'recorded' });
    const file = await current(); expect(file.tombstones[0].id).toBe('one');
    for (const name of await readdir(join(workspace, '.24pa/changesets'))) expect(await readFile(join(workspace, '.24pa/changesets', name), 'utf8')).not.toContain('完整记忆正文 one');
    const restore = planMemoryRestore(file, backup); expect(restore.protectedIds).toContain('one'); expect(restore.file.records.some(row => row.id === 'one')).toBe(false);
    const history = await host.api('memory.history', { id: 'one', workspaceBinding: binding }); expect(history.permanent).toBe(true); expect(history.revisions.every(row => row.before === null && row.after === null)).toBe(true);
    expect(JSON.stringify(await tool(put('one', 8)))).toContain('永久删除');
  });

  it('重启保留 revision、删除标记与完整查询；只读不会增加模型调用或再次提交', async () => {
    const before = await readFile(join(workspace, '.24pa/memory.json'), 'utf8'); const models = llm.log.length;
    await host.stop({ keepRoot: true }); host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(snapshot => Boolean(snapshot.workspace?.localSessionId));
    const memory = await host.api('memory', {}); expect(memory).toMatchObject({ revision: 8, total: 1, counts: { permanent: 1 } }); expect(memory.records[0].id).toBe('candidate');
    expect(await readFile(join(workspace, '.24pa/memory.json'), 'utf8')).toBe(before); expect(llm.log.length).toBe(models);
    await expect(host.api('memory', { workspaceBinding: 'wrong-workspace' })).rejects.toThrow('工作区');
  });

  it('实际工具入口重复旧确认不能确认新正文，凭证不改写，新的明确确认恢复事实资格', async () => {
    let revision = (await current()).revision;
    const originalCommand = put('colour', revision, { topic: '颜色', content: '我喜欢红色', confirmation: '记住我喜欢红色' });
    expect(await tool(originalCommand)).toMatchObject({ revision: ++revision, audit: 'recorded' });
    const original = (await current()).records.find(row => row.id === 'colour').confirmation;
    expect(await tool({ ...originalCommand, expectedRevision: revision, content: '我喜欢蓝色' })).toMatchObject({ revision: ++revision, audit: 'recorded' });
    expect((await tool({ action: 'search', mode: 'facts', query: '颜色' })).records).toEqual([]);
    const changed = (await host.api('memory', { query: '颜色' })).records[0];
    expect(changed).toMatchObject({ content: '我喜欢蓝色', status: 'unverified', effective: { confirmation: 'unverified', useAs: 'clue' } });
    expect(changed.confirmation).toEqual(original);
    expect(await tool({ ...originalCommand, expectedRevision: revision, content: '我喜欢蓝色' })).toMatchObject({ revision: ++revision });
    expect((await tool({ action: 'search', mode: 'facts', query: '颜色' })).records).toEqual([]);
    expect(await tool({ ...originalCommand, expectedRevision: revision, content: '我喜欢蓝色', confirmation: '我现在确认喜欢蓝色，请更正这条偏好' })).toMatchObject({ revision: ++revision });
    const fresh = (await tool({ action: 'search', mode: 'facts', query: '颜色' })).records[0];
    expect(fresh.content).toBe('我喜欢蓝色'); expect(fresh.confirmation.statementHash).not.toBe(original.statementHash);
  });

  it('旧 schema 1 记录经真实本地工具停用再撤销，恢复默认 active 和业务可检索状态', async () => {
    const file = await current();
    const legacy = { id: 'legacy', category: 'fact', topic: '旧版记录', content: '旧版未声明使用状态的内容', source: '本人历史指令', status: 'unverified', updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'owner', reason: '历史维护' };
    file.schemaVersion = 1; file.records.push(legacy);
    await writeFile(join(workspace, '.24pa/memory.json'), JSON.stringify(file));
    expect(await tool({ action: 'deactivate', id: 'legacy', expectedRevision: file.revision, reason: '暂时停用旧版记录' })).toMatchObject({ revision: file.revision + 1 });
    expect((await tool({ action: 'search', query: '旧版记录' })).records).toEqual([]);
    const history = await tool({ action: 'history', id: 'legacy' });
    expect(await tool({ action: 'undo', changesetId: history.revisions[0].id, expectedRevision: file.revision + 1, reason: '撤销此次停用' })).toMatchObject({ revision: file.revision + 2, audit: 'recorded' });
    expect((await tool({ action: 'search', query: '旧版记录' })).records).toMatchObject([{ id: 'legacy', content: legacy.content, effective: { lifecycle: 'active', useAs: 'clue' } }]);
    expect((await current()).records.find(row => row.id === 'legacy').lifecycle).toBe('active');
  });
});
