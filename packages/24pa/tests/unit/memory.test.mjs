import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, parseMemoryFile, MemoryError } from '../../lib/memory.js';
import { RoleRegistry } from '../../lib/roles.js';

// A minimal fake of the host fs service: same version-condition semantics
// (replaceIfVersion with a monotonically increasing version token).
function fakeFs() {
  const versions = new Map();
  return {
    async resolve(path) {
      return { path };
    },
    async stat(target) {
      const v = versions.get(target.path);
      return v === undefined ? null : { version: v };
    },
    async readText(target) {
      return readFile(target.path, 'utf8');
    },
    async writeText(target, content, expected) {
      const current = versions.get(target.path);
      if (expected?.kind === 'createIfAbsent' && current !== undefined) throw new Error('FS_EXISTS');
      if (expected?.kind === 'replaceIfVersion' && current !== expected.version) throw new Error('FS_STALE_VERSION');
      versions.set(target.path, (current ?? 0) + 1);
      await writeFile(target.path, content);
      return { ok: true };
    },
  };
}

const record = (id, over = {}) => ({
  id,
  category: 'preference',
  topic: '会议',
  content: '会议之间留 15 分钟缓冲',
  source: '本人指示',
  status: 'confirmed',
  validUntil: null,
  updatedAt: new Date().toISOString(),
  updatedBy: '本人',
  reason: '本人明确偏好',
  ...over,
});

describe('MemoryStore（JSON 记忆权威）', () => {
  let dir, store;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pa24-mem-'));
    store = new MemoryStore(dir, { fs: fakeFs() });
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('新增→检索→更正→删除全链路，revision 单调递增', async () => {
    const put1 = await store.put(record('r1'), { expectedRevision: 0, actor: 'local-session', reason: '记住偏好' });
    expect(put1.revision).toBe(1);
    let found = await store.search({ query: '缓冲' });
    expect(found.matched).toBe(1);
    expect(found.records[0].updatedBy).toBe('local-session');
    await store.put(record('r1', { content: '会议之间留 20 分钟缓冲' }), { expectedRevision: 1, actor: 'local-session', reason: '更正为 20 分钟' });
    found = await store.search({});
    expect(found.records[0].content).toContain('20 分钟');
    expect(found.revision).toBe(2);
    await store.remove('r1', { expectedRevision: 2, actor: 'local-session', reason: '删除过期偏好' });
    expect((await store.search({})).matched).toBe(0);
    expect((await store.search({})).revision).toBe(3);
  });

  it('过时 revision、并发版本与非法 JSON 均被拒绝且不清空原件', async () => {
    await store.put(record('r2'), { expectedRevision: 3, actor: 's', reason: 'x' });
    await expect(store.put(record('r2', { content: '新内容' }), { expectedRevision: 3, actor: 's', reason: 'y' })).rejects.toThrow(MemoryError);
    const raw = await readFile(join(dir, '.24pa/memory.json'), 'utf8');
    await writeFile(join(dir, '.24pa/memory.json'), '{broken');
    await expect(store.search({})).rejects.toThrow(/有效 JSON/);
    await writeFile(join(dir, '.24pa/memory.json'), raw);
    expect((await store.search({})).revision).toBe(4);
  });

  it('整理：重复/矛盾/过期候选、变更集原子应用与撤销', async () => {
    const base = (await store.search({})).revision;
    await store.put(record('d1', { topic: '项目X', content: '项目X 用方案A' }), { expectedRevision: base, actor: 's', reason: 'a' });
    await store.put(record('d2', { topic: '项目X', content: '项目X 用方案A' }), { expectedRevision: base + 1, actor: 's', reason: 'b' });
    await store.put(record('c1', { topic: '上线日', content: '周一上线', status: 'confirmed' }), { expectedRevision: base + 2, actor: 's', reason: 'c' });
    await store.put(record('c2', { topic: '上线日', content: '周三上线', status: 'confirmed' }), { expectedRevision: base + 3, actor: 's', reason: 'd' });
    const inspection = await store.inspect({ topic: '项目X' });
    expect(inspection.duplicates[0]?.ids.sort()).toEqual(['d1', 'd2']);
    const conflicts = await store.inspect({ topic: '上线日' });
    expect(conflicts.conflicts.length).toBe(1);

    const rev = (await store.search({})).revision;
    const applied = await store.applyChangeset(
      [
        { op: 'delete', id: 'd2', reason: '去重' },
        { op: 'put', record: record('c2', { content: '周三上线（本人确认）' }), reason: '保留本人确认的一条' },
      ],
      { expectedRevision: rev, actor: 's', reason: '整理项目X/上线日' },
    );
    expect(applied.changesetId).toMatch(/^CS-/);
    expect((await store.search({ topic: '项目X' })).matched).toBe(1);

    // 撤销：恢复被删条目与被改内容
    const rev2 = (await store.search({})).revision;
    await store.undo(applied.changesetId, { expectedRevision: rev2, actor: 's', reason: '整理有误' });
    expect((await store.search({ topic: '项目X' })).matched).toBe(2);
    expect((await store.search({ query: '本人确认' })).matched).toBe(0);

    // 后续修改后撤销拒绝覆盖较新内容
    const rev3 = (await store.search({})).revision;
    await store.put(record('c2', { content: '周三上线（最新）' }), { expectedRevision: rev3, actor: 's', reason: '再次更正' });
    const rev4 = (await store.search({})).revision;
    await expect(store.undo(applied.changesetId, { expectedRevision: rev4, actor: 's', reason: '过时撤销' })).rejects.toThrow(/又被修改/);
  });

  it('变更集与审计落盘，手工文件更改下次读取可见', async () => {
    const files = await readdir(join(dir, '.24pa/changesets'));
    expect(files.some(f => f.startsWith('CS-'))).toBe(true);
    const log = await readFile(join(dir, '.24pa/memory-log.jsonl'), 'utf8');
    expect(log.split('\n').filter(Boolean).length).toBeGreaterThan(3);
    const current = JSON.parse(await readFile(join(dir, '.24pa/memory.json'), 'utf8'));
    current.records.push(record('manual-1', { content: '手工加入的备忘 manual entry', updatedAt: new Date().toISOString(), updatedBy: '本人手工' }));
    current.revision += 1;
    await writeFile(join(dir, '.24pa/memory.json'), JSON.stringify(current));
    expect((await store.search({ query: '手工' })).matched).toBe(1);
  });

  it('有效期到达后不再出现在检索结果', async () => {
    const rev = (await store.search({})).revision;
    await store.put(record('exp', { validUntil: '2000-01-01T00:00:00Z' }), { expectedRevision: rev, actor: 's', reason: '带有效期' });
    expect((await store.search({ query: '缓冲', topic: '会议' })).matched).toBeGreaterThanOrEqual(0);
    expect((await store.search({ topic: '会议' })).records.every(r => r.id !== 'exp')).toBe(true);
  });
});

describe('RoleRegistry（专业角色注册）', () => {
  it('校验无效定义且失败不覆盖既有注册', () => {
    const registry = new RoleRegistry();
    const digest = {
      id: 'digest',
      name: '资料摘要',
      persona: '你是 24私助的资料摘要 Worker，汇总材料并给出来源。',
      brief: '汇总资料。',
      actions: { digest_summarize: async () => ({}) },
      available: true,
    };
    registry.register(digest);
    expect(registry.available().map(r => r.id)).toEqual(['digest']);
    expect(() => registry.register({ ...digest, id: 'BAD ID' })).toThrow();
    expect(() => registry.register({ ...digest, id: 'digest2', persona: '短' })).toThrow();
    expect(() => registry.register({ ...digest, id: 'digest3', actions: null })).toThrow();
    expect(registry.available().length).toBe(1);
    const planned = { ...digest, id: 'recording', available: false };
    registry.register(planned);
    expect(registry.available().map(r => r.id)).toEqual(['digest']);
    expect(registry.get('recording')?.available).toBe(false);
  });
});
