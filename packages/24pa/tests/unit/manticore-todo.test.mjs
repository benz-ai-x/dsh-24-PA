import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { SourceRegistry, unknownCapabilities } from '../../lib/source-registry.js';
import { SourceTodoReader } from '../../lib/source-todo-reader.js';
import { SourceTodo } from '../../lib/source-todo.js';
import { SourceTodoWrites } from '../../lib/source-todo-writes.js';
import { ExternalOperations } from '../../lib/external-operations.js';
import { startPgCluster } from '../helpers/pg.mjs';

const source = (id, patch = {}) => ({ id, domain: 'todo', platform: 'feishu', name: id, purpose: 'personal', ownerId: 'owner', resourceKind: 'tasklist', resourceId: id, filter: 'all', access: 'readwrite', enabled: true, ...patch });
const registration = () => ({ version: 1, entries: [source('a'), source('b', { purpose: 'project', filter: 'responsible' })], defaults: { todo: 'a', calendar: null }, mappings: [{ domain: 'todo', kind: 'project', name: '项目', sourceId: 'b' }], meetingDurationMinutes: null });
const proof = source => ({ state: 'verified', checkedAt: new Date().toISOString(), identity: { platform: source.platform, ownerId: 'owner', authority: source.platform === 'feishu' ? 'app:test' : 'bot:test' }, resource: { kind: source.resourceKind, id: source.resourceId }, capabilities: { ...unknownCapabilities(), read: 'allowed', create: 'allowed' }, message: 'isolated verified' });
const native = (guid, lists = ['a'], patch = {}) => ({ guid, summary: guid, completed_at: '0', creator: { id: 'owner', type: 'user' }, members: [{ id: 'owner', type: 'user', role: 'assignee' }], tasklists: lists.map(tasklist_guid => ({ tasklist_guid })), mode: 2, url: `https://task.example/${guid}`, ...patch });
const target = platform => ({ sourceId: 'a', platform, domain: 'todo', identity: { platform, ownerId: 'owner', authority: 'test' }, identityKey: 'test', resource: { kind: platform === 'feishu' ? 'tasklist' : 'authorized_scope', id: platform === 'feishu' ? 'a' : 'authorized' }, registrationRevision: 1, scopeHash: 'test', connectionHash: 'test', selectedBy: 'default', checkedAt: new Date().toISOString() });

describe('M04 原生待办读取', () => {
  it('飞书空页仍继续游标，单项角色与清单成员分别核验', async () => {
    const calls = [], reader = new SourceTodoReader({ timeZone: () => 'Asia/Shanghai', wecom: async () => { throw Error('unexpected'); }, lark: async args => {
      calls.push(args);
      if (args[2] === 'tasks') return { data: args.includes('--page-token') ? { items: [native('x')], has_more: false } : { items: [], has_more: true, page_token: 'next' } };
      return { data: { task: native('x') } };
    } });
    const result = await reader.read(target('feishu'));
    expect(result.state).toBe('complete'); expect(result.items).toHaveLength(1); expect(result.items[0].roles.values).toContain('responsible');
    expect(calls.filter(args => args[2] === 'tasks')).toHaveLength(2);
  });
  it('分页标志或游标损坏不报完整；读取详情失败保留摘要但角色缺口可见', async () => {
    const reader = new SourceTodoReader({ timeZone: () => 'Asia/Shanghai', wecom: async () => ({}), lark: async args => {
      if (args[2] === 'get') throw Error('scope missing');
      return { data: { items: [native('x')], has_more: true, page_token: 'repeated' } };
    } });
    const result = await reader.read(target('feishu'));
    expect(result.state).toBe('partial'); expect(result.reason).toMatch(/游标/); expect(result.items[0].roles.unknown).toContain('assigned');
  });
  it('企微显式查两种状态并翻到底，分派与关注不混为一谈', async () => {
    const calls = [], reader = new SourceTodoReader({ timeZone: () => 'Asia/Shanghai', lark: async () => ({}), wecom: async args => {
      calls.push(args); const second = args.includes('--cursor');
      return { data: { items: second ? [{ todo_id: 'native-other', title: '原生待办', status: 'proceed', user_status: 'accept', creator: { userid: 'other' }, followers: [{ userid: 'owner', user_status: 'accept' }], deadline: null }] : [], has_more: !second, next_cursor: second ? '' : 'next' } };
    } });
    const result = await reader.read(target('wecom'));
    expect(calls).toHaveLength(2); expect(calls[0]).toContain('["proceed","finished"]');
    expect(result.items[0].roles.values).toContain('responsible'); expect(result.items[0].roles.values).not.toContain('following');
    expect(result.state).toBe('partial'); expect(result.reason).toMatch(/真实账号/);
  });
  it('企微只有名字或无责任状态不能当本人负责，失败详情不能当删除', async () => {
    const reader = new SourceTodoReader({ timeZone: () => 'Asia/Shanghai', lark: async () => ({}), wecom: async args => ({ data: { items: args[1] === 'get' ? [{ todo_id: 'x', success: false }] : [{ todo_id: 'x', title: 'x', status: 'proceed', followers: [{ userid: 'owner' }] }], has_more: false } }) });
    expect((await reader.read(target('wecom'))).items[0].roles.values).not.toContain('responsible');
    await expect(reader.object(target('wecom'), 'x')).rejects.toThrow(/不能把读取失败/);
  });
});

for (const backend of ['sqlite', 'postgres']) describe(`M04 待办全流程 (${backend})`, () => {
  let db, cluster, root, repos, config, registry, reader, service, writes, work, remote, calls, failure, mismatch, gates;
  const gate = async (key, action) => { const old = gates.get(key) ?? Promise.resolve(); let release; const hold = new Promise(resolve => { release = resolve; }); gates.set(key, old.then(() => hold)); await old; try { return await action(); } finally { release(); } };
  const lark = async args => {
    calls.push(args); const flag = name => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
    const key = flag('--task-guid');
    if (args[2] === 'tasks' || args[1] === '+get-related-tasks') {
      if (failure === `list:${flag('--tasklist-guid')}`) throw Error('platform offline');
      return { data: { items: [...remote.values()].filter(task => !flag('--tasklist-guid') || task.tasklists.some(list => list.tasklist_guid === flag('--tasklist-guid'))), has_more: false } };
    }
    if (args[1] === 'tasks' && args[2] === 'get') {
      if (failure === 'get') throw Error('readback offline');
      if (!remote.has(key)) throw Error('not found');
      return { data: { task: failure === 'description' ? { ...remote.get(key), description: '旧描述' } : remote.get(key) } };
    }
    if (failure === 'unknown') throw Object.assign(Error('response lost'), { outcome: 'unknown' });
    const data = flag('--data') ? JSON.parse(flag('--data')) : {};
    if (args[2] === 'create') {
      const task = native(`created-${remote.size}`, (data.tasklists ?? []).map(row => row.tasklist_guid), { ...data, members: mismatch ? [] : data.members }); remote.set(task.guid, task); return { data: { task } };
    }
    if (args[2] === 'patch') {
      const task = remote.get(key); for (const field of data.update_fields) { if (Object.hasOwn(data.task, field)) task[field] = data.task[field]; else delete task[field]; }
      return { data: { task } };
    }
    if (args[1] === 'members') { const task = remote.get(key); task.members.push(...data.members); return { data: { task } }; }
    if (args[2] === 'delete') { remote.delete(key); return { data: {} }; }
    throw Error(`unexpected ${args.join(' ')}`);
  };
  const wecom = async args => {
    calls.push(['wecom', ...args]); const items = args.includes('--items') ? JSON.parse(args[args.indexOf('--items') + 1]) : [];
    if (args[1] === 'list') return { data: { items: [...remote.values()].filter(row => row.status !== 'deleted'), has_more: false } };
    if (args[1] === 'get') return { data: { items: items.map(({ todo_id }) => remote.has(todo_id) ? { ...remote.get(todo_id), success: true } : { todo_id, success: false }) } };
    if (failure === 'unknown') throw Object.assign(Error('response lost'), { outcome: 'unknown' });
    const values = items.map(body => {
      let row = remote.get(body.todo_id);
      if (args[1] === 'create') { row = { todo_id: `wc-${remote.size}`, title: body.title, deadline: body.deadline ?? null, status: 'proceed', creator: { userid: 'owner' }, user_status: 'accept', followers: body.follower_ids.map(userid => ({ userid, user_status: 'accept' })) }; remote.set(row.todo_id, row); }
      if (args[1] === 'update') { Object.assign(row, body); if (body.followers) row.followers = body.followers.map(person => ({ ...person, user_status: 'accept' })); }
      if (args[1] === 'finish') { row.user_status = 'finished'; if (body.finished_all || row.followers.length === 1) row.status = 'finished'; }
      if (args[1] === 'delete') { if (row.creator.userid === 'owner') row.status = 'deleted'; else row.user_status = 'removed'; }
      return { todo_id: row.todo_id, success: true };
    });
    return { data: { items: values } };
  };
  const useWecom = async () => {
    config.sources = { ...registration(), entries: [source('w', { platform: 'wecom', resourceKind: 'authorized_scope', resourceId: 'authorized' })], defaults: { todo: 'w', calendar: null }, mappings: [] };
    await registry.synchronize();
  };
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else { root = await mkdtemp(join(tmpdir(), 'pa24-m04-')); db = new SqliteDb(join(root, 'ledger.db')); }
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    for (const table of ['source_observation', 'source_membership', 'source_object', 'source_evidence', 'source_registration', 'source_registry_state', 'project_task', 'task', 'action_operation', 'work_item']) await db.query(`delete from pa24.${table}`);
    config = { ...DEFAULT_CONFIG, ownerOpenId: 'owner', sources: registration() }; remote = new Map(); calls = []; failure = null; mismatch = false; gates = new Map();
    registry = new SourceRegistry({ repo: () => repos.sources, config: () => config, connectionHash: () => 'connection', probe: async source => proof(source), gate });
    await registry.synchronize(); reader = new SourceTodoReader({ timeZone: () => config.timeZone, lark, wecom });
    service = new SourceTodo({ config: () => config, registry, projection: () => repos.sourceProjection, read: t => reader.read(t), object: (t, guid) => reader.object(t, guid), localTasks: () => repos.tasks.all(), operation: id => repos.operations.get(id), projectTasks: id => repos.projects.tasksOf(id), relations: () => repos.operations.todoAssignments(), gate });
    writes = new SourceTodoWrites({ config: () => config, registry, todos: service, reader, repos: () => repos, external: new ExternalOperations(() => repos.operations), lark, wecom, gate, notify: async () => {} });
    work = await repos.workItems.insert({ id: 'work', title: '记录待办', role: 'tasks', instruction: '本人记录待办', origin: 'local', parent_session_id: 'parent', child_session_id: 'child', delivery: 'parent', status: 'running' });
  });
  it('全来源包括非助理对象；默认角色与明确关注角色独立，全部筛选先于分页', async () => {
    for (let i = 0; i < 61; i++) remote.set(`external-${i}`, native(`external-${i}`, ['a']));
    remote.set('a-responsible', native('a-responsible', ['b']));
    remote.set('b-following', native('b-following', ['b'], { members: [{ id: 'other', type: 'user', role: 'assignee' }, { id: 'owner', type: 'user', role: 'follower' }] }));
    const all = await service.query({ limit: 10 }); expect(all.total).toBe(62); expect(all.tasks).toHaveLength(10); expect(all.hasMore).toBe(true); expect(all.counts.open).toBe(62);
    expect((await service.query({ sourceId: 'b' })).tasks.map(row => row.guid)).toEqual(['a-responsible']);
    expect((await service.query({ sourceId: 'b', role: 'following' })).tasks.map(row => row.guid)).toEqual(['b-following']);
    expect((await service.query({ sourceId: 'b' }, false)).tasks.map(row => row.guid)).toEqual(['a-responsible']);
    expect(config.sources.entries[1].filter).toBe('responsible');
  });
  it('同对象多清单合并保留关系，同名不合并；列表失败保留缓存且不报全量', async () => {
    remote.set('one', native('one', ['a', 'b'])); remote.set('two', native('two', ['a'], { summary: 'one' }));
    const initial = await service.query({}); expect(initial.total).toBe(2); expect(initial.tasks.find(row => row.guid === 'one').locations).toHaveLength(2);
    failure = 'list:a'; const partial = await service.query({}); expect(partial.total).toBeNull(); expect(partial.count).toBe(2); expect(partial.sources.find(row => row.sourceId === 'a').state).toBe('failed');
    const before = calls.length; await service.query({}, false); expect(calls).toHaveLength(before);
  });
  it('同次创建默认本人负责，无截止不造期限；源映射只写唯一目标并真实读回', async () => {
    const result = await writes.write(work, 'create', { summary: '方案', project: '项目' });
    expect(result).toMatchObject({ channel: 'feishu', status: 'open', dueAt: null, dueDate: null, verification: { state: 'verified' }, sourceId: 'b' });
    const create = calls.find(args => args[2] === 'create'), body = JSON.parse(create[create.indexOf('--data') + 1]);
    expect(body.members).toEqual([{ id: 'owner', type: 'user', role: 'assignee' }]); expect(body).not.toHaveProperty('due'); expect(body.tasklists).toEqual([{ tasklist_guid: 'b' }]);
    expect((await service.query({ sourceId: 'b' })).count).toBe(1);
  });
  it('分派他人需明确指令，关注不自动成为负责人；创建者不自动成为交办人', async () => {
    await expect(writes.write(work, 'create', { summary: '无授权', assigneeIds: ['other'] })).rejects.toThrow(/明确指令/);
    expect(calls.filter(args => args[2] === 'create')).toHaveLength(0);
    await writes.write(work, 'create', { summary: '明确交办', assigneeIds: ['other'], instruction: '将此待办分派给 other' });
    const assigned = await service.query({ role: 'assigned' }); expect(assigned.tasks.map(row => row.summary)).toEqual(['明确交办']);
    expect((await service.query({ role: 'responsible' })).count).toBe(0);
  });
  it('负责人读回不符沿原对象补齐，重试原创建不会重复生成对象', async () => {
    mismatch = true; const args = { summary: '本人待办' };
    const created = await writes.write(work, 'create', args); expect(created.verification.state).toBe('mismatch');
    expect(created.verification.differences.join()).toMatch(/负责人/);
    const again = await writes.write(work, 'create', args); expect(again.guid).toBe(created.guid); expect(calls.filter(args => args[2] === 'create')).toHaveLength(1);
    mismatch = false; const repaired = await writes.write(work, 'assign', { sourceId: 'a', guid: created.guid, assigneeIds: ['owner'] }); expect(repaired.verification.state).toBe('verified');
    expect(remote.size).toBe(1);
  });
  it('原始未知写入不因切默认、换来源等价写法或重启服务而重发', async () => {
    failure = 'unknown'; await expect(writes.write(work, 'create', { summary: '不重复' })).rejects.toThrow(/response lost/);
    config.sources.defaults.todo = 'b'; await registry.synchronize(); failure = null;
    await expect(writes.write(work, 'create', { summary: '不重复', sourceId: 'a', assigneeIds: ['owner'] })).rejects.toThrow(/未知/);
    expect(calls.filter(args => args[2] === 'create')).toHaveLength(1);
  });
  it('平台接受后本地关联失败，移除来源仍只补原回执、不创建新对象', async () => {
    const original = repos.sourceProjection.recordReceipt.bind(repos.sourceProjection); let first = true;
    repos.sourceProjection.recordReceipt = async (...args) => { if (first) { first = false; throw Error('disk retry'); } return original(...args); };
    await expect(writes.write(work, 'create', { summary: '修复回执' })).rejects.toThrow(/disk retry/);
    config.sources.entries = config.sources.entries.filter(row => row.id !== 'a'); config.sources.defaults.todo = 'b'; await registry.synchronize();
    const result = await writes.write(work, 'create', { summary: '修复回执' });
    expect(result.sourceId).toBe('a'); expect(result.verification.state).toBe('pending'); expect(calls.filter(args => args[2] === 'create')).toHaveLength(1);
    expect((await service.query({}, false)).count).toBe(0);
    repos.sourceProjection.recordReceipt = original;
  });
  it('延期只改原待办截止，清空截止精确发送字段，原成员和投入计划保持', async () => {
    const created = await writes.write(work, 'create', { summary: '截止', due: '2027-01-01', plannedAt: '2026-12-30T09:00:00Z', estimateMinutes: 60 });
    const updated = await writes.write(work, 'update', { guid: created.guid, sourceId: 'a', due: '2027-01-02' });
    expect(updated).toMatchObject({ guid: created.guid, dueDate: '2027-01-02', verification: { state: 'verified' } });
    const cleared = await writes.write(work, 'update', { guid: created.guid, due: null }); expect(cleared.dueDate).toBeNull();
    expect((await repos.tasks.byGuid(created.guid)).estimate_minutes).toBe(60); expect(remote.size).toBe(1); expect(remote.get(created.guid).members).toHaveLength(1);
  });
  it('完成与删除为不同动作，完成不会调用删除；多负责人先澄清影响', async () => {
    remote.set('shared', native('shared', ['a'], { members: [{ id: 'owner', type: 'user', role: 'assignee' }, { id: 'other', type: 'user', role: 'assignee' }] })); await service.query({});
    await expect(writes.write(work, 'complete', { guid: 'shared' })).rejects.toThrow(/多个负责人/);
    const result = await writes.write(work, 'complete', { guid: 'shared', effect: 'whole' }); expect(result.status).toBe('completed'); expect(calls.some(args => args[2] === 'delete')).toBe(false);
    const deleted = await writes.write(work, 'cancel', { guid: 'shared', reason: '本人取消', effect: 'whole' }); expect(deleted.status).toBe('canceled'); expect(remote.size).toBe(0);
  });
  it('冻结计划目标不受默认变化影响，已移除/只读来源阻断未发送操作', async () => {
    const frozen = await writes.target({}); config.sources.defaults.todo = 'b'; await registry.synchronize();
    const result = await writes.write(work, 'create', { summary: '固定来源', _sourceTarget: frozen }); expect(result.sourceId).toBe('a');
    config.sources.entries[0].access = 'read'; await registry.synchronize();
    await expect(writes.checkAction(frozen, 'task_create', {})).rejects.toThrow(/变更/);
    await expect(writes.write(work, 'create', { summary: '不得写', _sourceTarget: frozen })).rejects.toThrow(/变更/);
  });
  it('缓存和范围空结果分开，无源不能报告全部完成', async () => {
    expect((await service.query({}, false)).total).toBeNull();
    expect((await service.query({})).total).toBe(0);
    config.sources.entries = []; config.sources.defaults.todo = null; config.sources.mappings = []; await registry.synchronize();
    const result = await service.query({}); expect(result.total).toBeNull(); expect(result.message).toMatch(/没有已登记/);
  });
  it('企微默认本人同次分派与回读；延期原件、投入字段分开，明确不另建提醒', async () => {
    await useWecom(); const created = await writes.write(work, 'create', { summary: '企微方案' });
    expect(created).toMatchObject({ channel: 'wecom', status: 'open', dueAt: null, verification: { state: 'verified' } });
    expect(remote.get(created.guid).followers).toEqual([{ userid: 'owner', user_status: 'accept' }]);
    const updated = await writes.write(work, 'update', { guid: created.guid, due: '2027-01-01', estimateMinutes: 45 });
    expect(updated.guid).toBe(created.guid); expect(updated.message).toMatch(/平台默认提醒/); expect(updated.dueDate).toBe('2027-01-01');
    expect((await repos.tasks.byGuid(created.guid)).estimate_minutes).toBe(45); expect(remote.size).toBe(1);
    await expect(writes.write(work, 'update', { guid: created.guid, due: null })).rejects.toThrow(/不以重建/);
  });
  it('企微本人完成不伪称整项完成，整项完成需核实创建者', async () => {
    await useWecom(); const created = await writes.write(work, 'create', { summary: '两人协作', assigneeIds: ['owner', 'other'], instruction: '分给我和 other' });
    const self = await writes.write(work, 'complete', { guid: created.guid });
    expect(self).toMatchObject({ effect: 'self', status: 'open', ownerStatus: 'finished', verification: { state: 'verified' } });
    const whole = await writes.write(work, 'complete', { guid: created.guid, effect: 'whole' });
    expect(whole.status).toBe('completed'); expect(whole.verification.state).toBe('verified');
    remote.get(created.guid).creator.userid = 'other';
    await expect(writes.write(work, 'complete', { guid: created.guid, effect: 'whole', opSuffix: 'new' })).rejects.toThrow(/不能提升/);
  });
  it('企微明确删除或退出，退出保留其他人未完成工作', async () => {
    await useWecom(); const created = await writes.write(work, 'create', { summary: '整项删除' });
    await expect(writes.write(work, 'cancel', { guid: created.guid, reason: '本人取消' })).rejects.toThrow(/effect/);
    expect((await writes.write(work, 'cancel', { guid: created.guid, effect: 'whole', reason: '本人取消' })).status).toBe('canceled');
    const other = await writes.write(work, 'create', { summary: '本人退出' }); remote.get(other.guid).creator.userid = 'other';
    await expect(writes.write(work, 'cancel', { guid: other.guid, effect: 'whole', reason: '本人取消' })).rejects.toThrow(/影响/);
    const left = await writes.write(work, 'cancel', { guid: other.guid, effect: 'self', reason: '本人退出' });
    expect(left).toMatchObject({ effect: 'self', status: 'open', ownerStatus: 'removed', verification: { state: 'verified' } });
  });
  it('冻结目标拒绝矛盾渠道、清单与项目；增加指令不能绕过未知写入', async () => {
    const frozen = await writes.target({});
    for (const args of [{ channel: 'wecom' }, { tasklistId: 'b' }, { project: '项目' }]) await expect(writes.checkAction(frozen, 'task_create', args)).rejects.toThrow(/不符/);
    failure = 'unknown'; await expect(writes.write(work, 'create', { summary: '未知保护' })).rejects.toThrow(); failure = null;
    await expect(writes.write(work, 'create', { summary: '未知保护', instruction: '记录给本人' })).rejects.toThrow(/未知/);
    expect(calls.filter(args => args[2] === 'create')).toHaveLength(1);
  });
  it('候选授权变化不可覆盖原创建，完整原授权在恢复时保留', async () => {
    const authorization = { candidateId: 'stable', versionId: 'v1', instruction: '授权创建', parametersFingerprint: 'fp', owner: 'owner' };
    const args = { summary: '候选', _operationId: 'note.action:test:v1:0', _authorization: authorization };
    const first = await writes.write(work, 'create', args); const again = await writes.write(work, 'create', args);
    expect(again.guid).toBe(first.guid); expect((await repos.operations.get(args._operationId)).params.request._authorization).toEqual(authorization);
    await expect(writes.write(work, 'create', { ...args, _authorization: { ...authorization, versionId: 'v2' } })).rejects.toThrow(/授权已变化/);
    expect(remote.size).toBe(1);
  });

  it('描述读回仍为旧内容时标记不一致，明确修正只更新原对象', async () => {
    const created = await writes.write(work, 'create', { summary: '描述核验', description: '旧描述' });
    failure = 'description';
    const result = await writes.write(work, 'update', { guid: created.guid, description: '新描述' });
    expect(result.verification).toMatchObject({ state: 'mismatch', differences: ['描述与请求不符'] });
    failure = null;
    const repaired = await writes.write(work, 'update', { guid: created.guid, description: '最终描述' });
    expect(repaired).toMatchObject({ guid: created.guid, description: '最终描述', verification: { state: 'verified' } });
    expect(remote.size).toBe(1); expect(calls.filter(args => args[2] === 'create')).toHaveLength(1);
  });
  it('同 GUID 跨平台对象不能继承旧本地编号、交办或项目关联', async () => {
    const created = await writes.write(work, 'create', { summary: '飞书原件', estimateMinutes: 40 });
    const local = await repos.tasks.byGuid(created.guid);
    await repos.projects.create({ id: 'local-project', name: '原项目' }); await repos.projects.link('local-project', local.id);
    await useWecom(); remote.clear();
    remote.set(created.guid, { todo_id: created.guid, title: '企微独立对象', deadline: null, status: 'proceed', user_status: 'accept', creator: { userid: 'owner' }, followers: [{ userid: 'owner', user_status: 'accept' }] });
    const result = await service.query({});
    expect(result.tasks[0]).toMatchObject({ taskId: null, workItemIds: [], estimateMinutes: null });
    expect((await service.query({ projectId: 'local-project' })).tasks).toEqual([]);
    await expect(writes.write(work, 'complete', { taskId: local.id })).rejects.toThrow(/原目标/);
    const changed = await writes.write(work, 'update', { guid: created.guid, sourceId: 'w', summary: '明确修改企微对象' });
    expect(changed.verification.state).toBe('pending'); expect(changed.verification.message).toMatch(/GUID.*冲突/);
    expect(await repos.tasks.get(local.id)).toEqual(local);
  });
  it('原对象变更尊重明确项目与渠道，不能忽略矛盾参数而写入', async () => {
    const created = await writes.write(work, 'create', { summary: '个人待办' });
    await expect(writes.write(work, 'update', { guid: created.guid, project: '项目', summary: '误投' })).rejects.toThrow(/不在已登记清单/);
    await expect(writes.write(work, 'update', { guid: created.guid, sourceId: 'a', channel: 'wecom', summary: '误投' })).rejects.toThrow(/不符/);
    expect(remote.get(created.guid).summary).toBe('个人待办'); expect(calls.filter(args => args[2] === 'patch')).toHaveLength(0);
  });

});
