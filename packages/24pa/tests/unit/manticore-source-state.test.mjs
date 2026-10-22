import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { DEFAULT_CONFIG, validateConfig } from '../../lib/config.js';
import { effectiveSources, selectSource, validateSources } from '../../lib/source-config.js';
import { SourceRegistry, unknownCapabilities } from '../../lib/source-registry.js';
import { sourceObjectId } from '../../lib/repo/source-projection.js';
import { SourceCalendar } from '../../lib/source-calendar.js';
import { SourceCalendarWrites } from '../../lib/source-calendar-writes.js';
import { ExternalOperations } from '../../lib/external-operations.js';
import { ReminderRouter } from '../../lib/reminder-router.js';
import { startPgCluster } from '../helpers/pg.mjs';

const entry = (id, patch = {}) => ({ id, domain: 'calendar', platform: 'feishu', name: id, purpose: 'personal', ownerId: 'ou_owner', resourceKind: 'calendar', resourceId: id, filter: 'all', access: 'readwrite', enabled: true, ...patch });
const config = () => ({ version: 1, entries: [entry('a'), entry('b')], defaults: { calendar: 'a', todo: null }, mappings: [{ domain: 'calendar', kind: 'company', name: '公司', sourceId: 'b' }], meetingDurationMinutes: null });
const proof = source => ({ checkedAt: new Date().toISOString(), state: 'verified', identity: { platform: source.platform, ownerId: 'ou_owner', authority: 'app:tenant' }, resource: { kind: source.resourceKind, id: source.resourceId === 'primary' ? 'real-primary' : source.resourceId }, capabilities: { ...unknownCapabilities(), read: 'allowed', create: 'allowed', update: 'allowed', cancel: 'allowed', reminders: 'allowed' }, role: 'owner', message: '实际身份及资源角色通过' });

describe('Manticore 来源配置与路由', () => {
  it('迁移是确定性的候选；显式空来源不恢复原默认', () => {
    const old = { ...DEFAULT_CONFIG, ownerOpenId: 'ou_owner', calendarId: 'old-calendar', todoChannel: 'wecom' };
    const a = effectiveSources(old), b = effectiveSources(old);
    expect(a).toEqual(b);
    expect(a.entries).toHaveLength(2);
    expect(a.entries[0]).toMatchObject({ resourceId: 'old-calendar', ownerId: 'ou_owner' });
    expect(a.entries[1]).toMatchObject({ platform: 'wecom', resourceKind: 'authorized_scope', ownerId: '' });
    const empty = { ...a, entries: [], defaults: { calendar: null, todo: null } };
    expect(effectiveSources({ ...old, sources: empty })).toEqual(empty);
    expect(old.sources).toBeNull();
  });
  it('明确来源优先，映射歧义或缺失不改用默认，不可写也不换目标', () => {
    const c = config();
    expect(selectSource(c, 'calendar', { sourceId: 'a', company: '不存在' }).source.id).toBe('a');
    expect(selectSource(c, 'calendar', { company: '公司' })).toMatchObject({ source: { id: 'b' }, reason: 'mapping' });
    expect(selectSource(c, 'calendar').source.id).toBe('a');
    expect(() => selectSource(c, 'calendar', { company: '未知' })).toThrow(/补充目标/);
    expect(() => selectSource(c, 'calendar', { sourceId: '未知' })).toThrow(/未登记/);
    c.mappings.push({ domain: 'calendar', kind: 'project', name: '项目', sourceId: 'a' });
    expect(() => selectSource(c, 'calendar', { company: '公司', project: '项目' })).toThrow(/不同来源/);
    c.entries[0].access = 'read';
    expect(() => selectSource(c, 'calendar')).toThrow(/仅登记为读取/);
    expect(selectSource(c, 'calendar', {}, false).source.id).toBe('a');
  });
  it('同名来源不猜测，默认关系、会议时长和声明权限都严格校验', () => {
    const c = config(); c.entries.forEach(row => row.name = '同名');
    expect(() => selectSource(c, 'calendar', { sourceId: '同名' })).toThrow(/多项/);
    expect(() => validateSources({ ...c, meetingDurationMinutes: 0 })).toThrow(/时长/);
    expect(validateSources({ ...c, entries: [entry('a', { purpose: 'project' })], defaults: { calendar: 'a', todo: null }, mappings: [] }).entries[0].filter).toBe('all');
    expect(() => validateSources({ ...c, entries: [entry('a', { verified: true })] })).toThrow(/未知字段/);
    expect(() => validateSources({ ...c, defaults: { calendar: 'missing', todo: null } })).toThrow(/已登记/);
    expect(validateConfig({ ...DEFAULT_CONFIG, sources: c }).sources).toEqual(c);
  });
});

for (const backend of ['sqlite', 'postgres']) describe(`Manticore 来源、身份与目标快照 (${backend})`, () => {
  let db, cluster, root, repos, current, connection, calls, probe, service;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else { root = await mkdtemp(join(tmpdir(), 'pa24-source-state-')); db = new SqliteDb(join(root, 'ledger.db')); }
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    for (const table of ['source_observation', 'source_membership', 'source_object', 'source_evidence', 'source_registration', 'source_registry_state', 'reminder_rule', 'action_operation', 'work_item']) await db.query(`delete from pa24.${table}`);
    current = { ...DEFAULT_CONFIG, sources: config() }; connection = 'connection-1'; calls = 0; probe = async source => proof(source);
    service = new SourceRegistry({ repo: () => repos.sources, config: () => current, connectionHash: () => connection, probe: source => { calls++; return probe(source); }, gate: (_key, run) => run() });
  });
  it('登记及查看不发起平台检查；重复迁移不改 revision，重新建服务仍能读证据', async () => {
    await service.synchronize(); await service.synchronize();
    const rows = await repos.sources.list(); expect(rows).toHaveLength(2); expect(rows[0].revision).toBe(1);
    expect((await service.list()).entries[0].status).toBe('pending'); expect(calls).toBe(0);
    await service.check('a');
    const reopened = new SourceRegistry({ repo: () => createRepos(db).sources, config: () => current, connectionHash: () => connection, probe: async () => { throw Error('不应调用'); }, gate: (_key, run) => run() });
    expect((await reopened.list()).entries[0].evidence.identity.ownerId).toBe('ou_owner'); expect(calls).toBe(1);
  });
  it('默认和映射改变不改绑原目标；改名不丢证据', async () => {
    const target = await service.bind('calendar');
    current.sources.defaults.calendar = 'b'; current.sources.mappings[0].sourceId = 'a'; current.sources.entries[0].name = '改名';
    await service.synchronize();
    expect((await service.list()).entries[0].status).toBe('verified');
    expect((await service.verify(target, 'create')).resource.id).toBe('a');
    expect((await service.bind('calendar')).sourceId).toBe('b');
  });
  it('移除保留历史；重新加回不会使旧授权和旧证据复活', async () => {
    const target = await service.bind('calendar'), old = current.sources.entries.shift(); current.sources.defaults.calendar = 'b';
    await service.synchronize();
    expect((await service.list()).removed[0].registration.id).toBe('a');
    await expect(service.verify(target, 'create')).rejects.toThrow(/原目标/);
    current.sources.entries.unshift(old); await service.synchronize();
    expect((await service.list()).entries[0].status).toBe('pending');
    await expect(service.verify(target, 'create')).rejects.toThrow(/重新登记/);
  });
  it('实际权限撤销使新写入失败，旧成功检查不能覆盖失败', async () => {
    const target = await service.bind('calendar');
    probe = async source => ({ ...proof(source), capabilities: { ...unknownCapabilities(), read: 'allowed', create: 'denied' }, message: '资源只读' });
    await expect(service.verify(target, 'create')).rejects.toThrow(/资源只读/);
    expect((await service.list()).entries[0].evidence.capabilities.create).toBe('denied');
    expect((await service.list()).entries[1].status).toBe('pending');
  });
  it('登记身份与实际身份不符不能保存已验证；primary 必须解析真正容器', async () => {
    current.sources.entries[0].resourceId = 'primary';
    expect((await service.bind('calendar')).resource.id).toBe('real-primary');
    probe = async source => ({ ...proof(source), identity: { platform: 'feishu', ownerId: 'other', authority: 'app:tenant' } });
    await expect(service.bind('calendar')).rejects.toThrow(/身份或资源/);
    expect((await service.list()).entries[0].status).toBe('failed');
  });
  it('配置/接入变化使证据失效，进行中的旧检查不得盖掉新来源', async () => {
    const target = await service.bind('calendar');
    connection = 'connection-2'; expect((await service.list()).entries[0].status).toBe('pending');
    expect((await service.verify(target, 'create')).identity).toEqual(target.identity);
    let release, started; const entered = new Promise(resolve => started = resolve);
    probe = async source => { started(); await new Promise(resolve => release = resolve); return proof(source); };
    const checking = service.check('a'); await entered;
    current.sources.entries[0] = { ...current.sources.entries[0], resourceId: 'new-calendar' }; await service.synchronize();
    release(); await expect(checking).rejects.toThrow(/变更/);
    expect((await service.list()).entries[0].status).toBe('pending');
  });
  it('一次只读检查失败保留时间，不能作为其他来源的能力证明', async () => {
    await service.check('a'); probe = async () => { throw Error('权限已过期'); };
    expect((await service.check('a')).state).toBe('failed');
    const list = await service.list(); expect(list.entries[0].evidence.message).toBe('权限已过期'); expect(list.entries[0].previousCheckAt).toBeInstanceOf(Date);
    expect(list.entries[1].evidence).toBeNull();
  });
  it('同一用户标识换了应用或机器人，反复检查和改筛选仍不能替换原身份', async () => {
    await service.bind('calendar');
    probe = async source => ({ ...proof(source), identity: { platform: 'feishu', ownerId: 'ou_owner', authority: 'other-app' } });
    await expect(service.bind('calendar')).rejects.toThrow(/身份已改变/);
    await expect(service.bind('calendar')).rejects.toThrow(/身份已改变/);
    current.sources.entries[0].filter = 'involved'; await service.synchronize();
    await expect(service.bind('calendar')).rejects.toThrow(/身份已改变/);
  });
  const window = { from: '2026-10-23T00:00:00.000Z', to: '2026-10-24T00:00:00.000Z' };
  const event = (nativeId, patch = {}) => ({ nativeId, locator: { eventId: nativeId, calendarId: 'real' }, body: { summary: '同名日程' }, roles: { complete: true, values: ['participant'] }, capabilities: {}, active: true, startTime: new Date('2026-10-23T01:00:00Z'), endTime: new Date('2026-10-23T02:00:00Z'), ...patch });
  const observation = (items, patch = {}) => ({ state: 'complete', query: window, observedAt: new Date(), items, ...patch });
  it('对象身份与来源成员关系分开；一个来源清空不会取消另一来源的同一对象', async () => {
    current.sources.entries[1].resourceId = 'a';
    const a = await service.bind('calendar', { sourceId: 'a' }, 'read'), b = await service.bind('calendar', { sourceId: 'b' }, 'read');
    await repos.sourceProjection.observe(a, observation([event('same-native')]));
    await repos.sourceProjection.observe(b, observation([event('same-native')]));
    const objectId = sourceObjectId(a, 'same-native');
    expect((await repos.sourceProjection.locations(objectId))).toHaveLength(2);
    expect((await db.query('select * from pa24.source_object')).rows).toHaveLength(1);
    await repos.sourceProjection.observe(a, observation([]));
    expect((await repos.sourceProjection.cached(a, window)).items).toHaveLength(0);
    expect((await repos.sourceProjection.cached(b, window)).items).toHaveLength(1);
    expect((await repos.sourceProjection.locations(objectId)).filter(row => row.active)).toHaveLength(1);
  });
  it('同原生 ID 在不同平台不碰撞；同名不同 ID 不合并', async () => {
    current.sources.entries[1].platform = 'wecom';
    const a = await service.bind('calendar', { sourceId: 'a' }, 'read'), b = await service.bind('calendar', { sourceId: 'b' }, 'read');
    await repos.sourceProjection.observe(a, observation([event('same-id'), event('other-id')]));
    await repos.sourceProjection.observe(b, observation([event('same-id')]));
    expect((await db.query('select * from pa24.source_object')).rows).toHaveLength(3);
    expect(sourceObjectId(a, 'same-id')).not.toBe(sourceObjectId(b, 'same-id'));
  });
  it('日历副本保留各自忙闲及同一时刻的正文，后读副本不改写其他来源快照', async () => {
    const a = await service.bind('calendar', { sourceId: 'a' }, 'read'), b = await service.bind('calendar', { sourceId: 'b' }, 'read');
    const at = new Date();
    await repos.sourceProjection.observe(a, observation([event('common', { body: { summary: '旧主题', freeBusy: 'busy' } })], { observedAt: at }));
    await repos.sourceProjection.observe(b, observation([event('common', { body: { summary: '新主题', freeBusy: 'free' } })], { observedAt: new Date(at.getTime() + 1000) }));
    const savedA = (await repos.sourceProjection.cached(a, window)).items[0];
    expect(savedA.body).toMatchObject({ summary: '旧主题', freeBusy: 'busy' });
    const calendar = new SourceCalendar({ registry: service, config: () => current, projection: () => repos.sourceProjection, gate: (_k, run) => run(), read: async () => { throw Error('普通浏览不读取远端'); } });
    const result = await calendar.query(window, false);
    expect(result.events).toHaveLength(1); expect(result.events[0].freeBusy).toBe('busy');
    expect(result.events[0].locations.map(row => row.freeBusy)).toEqual(['busy', 'free']);
    expect((await calendar.query({ ...window, sourceId: 'b' }, false)).events[0].freeBusy).toBe('free');
  });
  it('中途失败与角色不全保留缓存和成功时间，不用部分结果清空旧成员', async () => {
    const target = await service.bind('calendar', {}, 'read'), t = new Date('2026-10-23T00:00:00Z');
    await repos.sourceProjection.observe(target, observation([event('a'), event('b')], { observedAt: t }));
    const partial = observation([event('a', { roles: { complete: false, values: [], reason: '下一页无权' } })], { state: 'partial', reason: '角色不全', observedAt: new Date(t.getTime() + 1000) });
    await repos.sourceProjection.observe(target, partial);
    let cache = await repos.sourceProjection.cached(target, window);
    expect(cache.items).toHaveLength(2); expect(cache.observation).toMatchObject({ state: 'partial', last_complete_at: t });
    await repos.sourceProjection.observe(target, observation([], { state: 'failed', reason: '离线', observedAt: new Date(t.getTime() + 2000) }));
    cache = await repos.sourceProjection.cached(target, window);
    expect(cache.items).toHaveLength(2); expect(cache.observation.last_complete_at).toEqual(t);
    await expect(repos.sourceProjection.observe(target, { ...partial, state: 'complete' })).rejects.toThrow(/较早/);
  });
  it('另一时间窗口完整为空仅清理自身窗口；迟到旧观察不能覆盖新正文', async () => {
    const target = await service.bind('calendar', {}, 'read'), t = new Date('2026-10-23T00:00:00Z');
    await repos.sourceProjection.observe(target, observation([event('a')], { observedAt: t }));
    const nextWindow = { from: '2026-10-24T00:00:00.000Z', to: '2026-10-25T00:00:00.000Z' };
    await repos.sourceProjection.observe(target, observation([], { query: nextWindow, observedAt: t }));
    expect((await repos.sourceProjection.cached(target, window)).items).toHaveLength(1);
    await repos.sourceProjection.observe(target, observation([event('a', { body: { summary: '新正文' } })], { observedAt: new Date(t.getTime() + 1000) }));
    await expect(repos.sourceProjection.observe(target, observation([event('a')], { observedAt: t }))).rejects.toThrow(/较早/);
    expect((await repos.sourceProjection.cached(target, window)).items[0].body.summary).toBe('新正文');
  });
  it('来源移除后迟到观察被拒，历史位置仍可用于原对象核对', async () => {
    const target = await service.bind('calendar', {}, 'read'); await repos.sourceProjection.observe(target, observation([event('a')]));
    current.sources.entries.shift(); current.sources.defaults.calendar = 'b'; await service.synchronize();
    await expect(repos.sourceProjection.observe(target, observation([]))).rejects.toThrow(/来源或身份已改变/);
    expect((await repos.sourceProjection.locations(sourceObjectId(target, 'a')))[0].locator.eventId).toBe('a');
  });
  it('聚合全部来源，角色覆盖默认且不永久改配置；计数先筛选再分页', async () => {
    current.sources.entries[1] = entry('b', { purpose: 'project', filter: 'involved' }); await service.synchronize();
    const calendar = new SourceCalendar({ registry: service, config: () => current, projection: () => repos.sourceProjection, gate: (_k, run) => run(),
      read: async target => observation(target.sourceId === 'a' ? [event('personal', { roles: { complete: true, values: [] } })] : [event('owner', { roles: { complete: true, values: ['organizer'] } }), event('other', { roles: { complete: true, values: [] } })]) });
    const normal = await calendar.query({ ...window, limit: 1 }); expect(normal.total).toBe(2); expect(normal.events).toHaveLength(1); expect(normal.hasMore).toBe(true);
    const all = await calendar.query({ ...window, role: 'all' }); expect(all.total).toBe(3);
    expect(current.sources.entries[1].filter).toBe('involved');
    expect((await calendar.query(window)).total).toBe(2); expect(calls).toBe(6);
    const cached = await calendar.query(window, false); expect(cached.fresh).toBe(false); expect(cached.total).toBe(2); expect(calls).toBe(6);
  });
  it('完整对象范围与角色覆盖分开；全部可见不遗漏未知关系，忙闲读取全部页', async () => {
    await service.synchronize();
    const calendar = new SourceCalendar({ registry: service, config: () => current, projection: () => repos.sourceProjection, gate: (_k, run) => run(),
      read: async target => observation(target.sourceId === 'a' ? Array.from({ length: 60 }, (_, i) => event(`external-${i}`, { roles: { complete: false, values: [], reason: '角色未知' } })) : []) });
    const first = await calendar.query({ ...window, limit: 1 });
    expect(first.fresh).toBe(true); expect(first.total).toBe(60); expect(first.events).toHaveLength(1); expect(first.sources[0].unknownRoles).toBe(60);
    const role = await calendar.query({ ...window, role: 'involved' }); expect(role.fresh).toBe(false); expect(role.total).toBeNull(); expect(role.sources[0].reason).toContain('可能遗漏');
    expect((await calendar.all({ ...window, limit: 1 })).events).toHaveLength(60);
    current.sources.entries[1].enabled = false;
    const enabledOnly = await calendar.query(window); expect(enabledOnly.fresh).toBe(true);
    expect(enabledOnly.sources[1].state).toBe('disabled');
    await expect(calendar.query({ ...window, sourceId: 'b' })).rejects.toThrow(/已停用/);
  });
  it('一源失败不清另一来源，合并保留各自权限；已保存全量计数不冒充本次完整', async () => {
    await service.synchronize(); let fail = false;
    const calendar = new SourceCalendar({ registry: service, config: () => current, projection: () => repos.sourceProjection, gate: (_k, run) => run(),
      read: async target => target.sourceId === 'a' && fail ? observation([], { state: 'failed', reason: '离线' }) : observation([event('common')]) });
    const first = await calendar.query(window); expect(first.total).toBe(1); expect(first.events[0].locations).toHaveLength(2);
    fail = true; const second = await calendar.query(window); expect(second.total).toBeNull(); expect(second.events).toHaveLength(1);
    expect(second.sources.find(s => s.sourceId === 'a').state).toBe('failed'); expect(second.events[0].stale).toBe(false);
    const c = calls; connection = 'switched'; const cached = await calendar.query(window, false);
    expect(cached.total).toBeNull(); expect(cached.sources.every(s => s.state === 'unverified')).toBe(true); expect(calls).toBe(c);
  });
  const start = '2026-10-23T01:00:00.000Z', end = '2026-10-23T02:00:00.000Z';
  async function writerFixture(options = {}) {
    const item = await repos.workItems.insert({ id: 'work', title: '日程委托', role: 'calendar', instruction: '本人安排会议', origin: 'local', parent_session_id: 'local', delivery: 'session:local', status: 'running' });
    const writes = [], state = new Map();
    const invoke = async args => {
      writes.push(args); if (options.invoke) return options.invoke(args);
      const eventId = args.includes('--event-id') ? args[args.indexOf('--event-id') + 1] : 'created_0';
      const data = args.includes('--data') ? JSON.parse(args[args.indexOf('--data') + 1]) : {};
      if (args[1] === 'event.attendees') return { data: { attendees: data.attendees.map(row => ({ ...row, attendee_id: row.user_id, rsvp_status: 'needs_action' })) } };
      state.set(eventId, { ...state.get(eventId), ...data, active: args[2] !== 'delete' });
      return { data: { event: { event_id: eventId, ...data } } };
    };
    const object = async (target, eventId) => {
      if (options.object) return options.object(target, eventId);
      const raw = state.get(eventId) ?? {}, active = raw.active !== false;
      return event(JSON.stringify([target.resource.id, eventId]), { locator: { eventId, calendarId: target.resource.id, reminders: raw.reminders ?? [{ minutes: 5 }] },
        body: { summary: raw.summary ?? '原会议', start, end, recurring: options.recurring ?? false }, roles: { complete: true, values: ['organizer'] },
        capabilities: { update: 'allowed', cancel: 'allowed', reminders: 'allowed', effect: 'whole_event' }, active });
    };
    const writer = new SourceCalendarWrites({ config: () => current, registry: service, reader: { object }, repos: () => repos, external: new ExternalOperations(() => repos.operations),
      lark: invoke, wecom: options.wecom ?? invoke, gate: options.gate ?? ((_k, run) => run()), mirror: options.mirror });
    return { writer, item, writes };
  }
  it('占位使用明确来源和预设时长，不猜参会人；换默认后同一请求不重复写入', async () => {
    current.sources.meetingDurationMinutes = 45;
    const { writer, item, writes } = await writerFixture();
    const first = await writer.write(item, 'create', { start });
    expect(first).toMatchObject({ eventId: 'created_0', calendarId: 'a', start, end: '2026-10-23T01:45:00.000Z' });
    expect(first.defaultsUsed).toEqual(['缺主题，使用“会议”', '使用预设会议时长 45 分钟']);
    expect(JSON.parse(writes[0][writes[0].indexOf('--data') + 1]).summary).toBe('会议');
    current.sources.defaults.calendar = 'b'; current.sources.meetingDurationMinutes = 90; await service.synchronize();
    const replay = await writer.write(item, 'create', { start }); expect(replay.calendarId).toBe('a'); expect(writes).toHaveLength(1);
    await writer.write(item, 'create', { start, end, company: '公司' }); expect(writes[1]).toContain('b');
  });
  it('缺时长、歧义、权限撤销或已停用都不创建，也不改用其他来源', async () => {
    const { writer, item, writes } = await writerFixture();
    await expect(writer.write(item, 'create', { start })).rejects.toThrow(/时长/);
    await expect(writer.write(item, 'create', { start, end, company: '未知' })).rejects.toThrow(/补充目标/);
    probe = async source => ({ ...proof(source), capabilities: { ...unknownCapabilities(), read: 'allowed' } });
    await expect(writer.write(item, 'create', { start, end })).rejects.toThrow(/未核验/);
    current.sources.entries[0].enabled = false;
    await expect(writer.write(item, 'create', { start, end })).rejects.toThrow(/停用/); expect(writes).toHaveLength(0);
  });
  it('已接收操作仍对比实际回读；时间按接口秒精度核对，提醒差异独立暴露', async () => {
    let reminderMinutes = [5];
    const { writer, item } = await writerFixture({ object: async (target, eventId) => event(JSON.stringify([target.resource.id, eventId]), {
      locator: { eventId, calendarId: target.resource.id, reminders: reminderMinutes.map(minutes => ({ minutes })) },
      body: { summary: '原会议', start, end },
    }) });
    const first = await writer.write(item, 'create', { summary: '原会议', start: start.replace('.000', '.123'), end: end.replace('.000', '.123') });
    expect(first.verification.state).toBe('verified');
    reminderMinutes = [];
    const replay = await writer.write(item, 'create', { summary: '原会议', start: start.replace('.000', '.123'), end: end.replace('.000', '.123') });
    expect(replay.platformAccepted).toBe(true); expect(replay.verification.state).toBe('conflict');
    expect(replay.verification.differences).toEqual(['本人提醒设置与请求不一致或尚未返回']);
  });
  it('已知平台成功后本地失败，移除来源仍只补原历史，不再次创建或恢复登记', async () => {
    let fail = true, mirrors = 0;
    const { writer, item, writes } = await writerFixture({ mirror: async () => { mirrors++; if (fail) throw Error('本地暂不可写'); } });
    const args = { summary: '原会议', start, end };
    await expect(writer.write(item, 'create', args)).rejects.toThrow(/本地/);
    const op = (await repos.operations.calendarCreatesForWork(item.id))[0]; expect(op.receipt._externalResult).toBeTruthy();
    current.sources.entries.shift(); current.sources.defaults.calendar = 'b'; await service.synchronize(); fail = false;
    const result = await writer.write(item, 'create', args); expect(result.calendarId).toBe('a'); expect(writes).toHaveLength(1); expect(mirrors).toBe(2);
    expect((await repos.sources.get('a')).removed).toBe(true); expect((await repos.sourceProjection.calendarLocations('created_0'))[0].active).toBe(false);
    expect((await repos.operations.get(op.id)).status).toBe('succeeded');
  });
  it('传输未知不重试；仅明确平台拒绝才能沿原目标重试', async () => {
    let failure = Object.assign(Error('超时'), { outcome: 'unknown' });
    const { writer, item, writes } = await writerFixture({ invoke: async () => { throw failure; } });
    await expect(writer.write(item, 'create', { start, end })).rejects.toThrow('超时');
    await expect(writer.write(item, 'create', { start, end })).rejects.toThrow(/待核对/); expect(writes).toHaveLength(1);
    failure = Object.assign(Error('明确拒绝'), { outcome: 'failed' });
    await expect(writer.write(item, 'create', { start, end, summary: '第二次明确请求' })).rejects.toThrow('明确拒绝');
    current.sources.defaults.calendar = 'b'; await service.synchronize();
    await expect(writer.write(item, 'create', { start, end, summary: '第二次明确请求' })).rejects.toThrow('明确拒绝');
    expect(writes.at(-1)).toContain('a');
  });
  it('等价时间、默认值和来源名称重试沿原未知操作；切换默认不能移动原意图', async () => {
    current.sources.meetingDurationMinutes = 60; current.sources.entries[0].name = '个人日历';
    const { writer, item, writes } = await writerFixture({ invoke: async () => { throw Object.assign(Error('超时'), { outcome: 'unknown' }); } });
    await expect(writer.write(item, 'create', { start })).rejects.toThrow('超时');
    current.sources.defaults.calendar = 'b'; current.sources.meetingDurationMinutes = 30;
    await expect(writer.write(item, 'create', { start: '2026-10-23T09:00:00+08:00', end, summary: '会议', sourceId: '个人日历' })).rejects.toThrow(/待核对/);
    await expect(writer.write(item, 'create', { start: '2026-10-23T09:00:00+08:00', durationMinutes: 60, title: '会议', sourceId: 'a' })).rejects.toThrow(/待核对/);
    expect(writes).toHaveLength(1); expect(await repos.operations.calendarCreatesForWork(item.id)).toHaveLength(1);
  });
  it('登记 primary 别名与实际日历 ID 不产生第二个未知创建', async () => {
    current.sources.entries[0].resourceId = 'primary';
    const { writer, item, writes } = await writerFixture({ invoke: async () => { throw Object.assign(Error('超时'), { outcome: 'unknown' }); } });
    await expect(writer.write(item, 'create', { start, end })).rejects.toThrow('超时');
    current.sources.defaults.calendar = 'b';
    await expect(writer.write(item, 'create', { start, end, sourceId: 'a', calendarId: 'primary' })).rejects.toThrow(/待核对/);
    await expect(writer.write(item, 'create', { start, end, calendarId: 'real-primary' })).rejects.toThrow(/待核对/);
    expect(writes).toHaveLength(1); expect(await repos.operations.calendarCreatesForWork(item.id)).toHaveLength(1);
  });
  it.each(['primary', 'real-primary'])('显式来源未知后以原日历 %s 重试，不受当前默认或映射影响', async calendarId => {
    current.sources.entries[0].resourceId = 'primary';
    const { writer, item, writes } = await writerFixture({ invoke: async () => { throw Object.assign(Error('超时'), { outcome: 'unknown' }); } });
    await expect(writer.write(item, 'create', { start, end, sourceId: 'a' })).rejects.toThrow('超时');
    current.sources.defaults.calendar = 'b';
    await expect(writer.write(item, 'create', { start, end, calendarId })).rejects.toThrow(/待核对/);
    await expect(writer.write(item, 'create', { start, end, calendarId, company: '公司' })).rejects.toThrow(/待核对/);
    await expect(writer.write(item, 'create', { start, end, calendarId, sourceId: 'b' })).rejects.toThrow(/日历标识与登记来源不符/);
    expect(writes).toHaveLength(1); expect(await repos.operations.calendarCreatesForWork(item.id)).toHaveLength(1);
  });
  it('提醒父意图对等价时间和来源名称统一防重，保留原规则和写入操作', async () => {
    current.sources.entries[0].name = '个人日历';
    let fail = true;
    const { writer, item, writes } = await writerFixture({ invoke: async () => {
      if (fail) throw Object.assign(Error('超时'), { outcome: 'unknown' }); return { data: { event: { event_id: 'created_0' } } };
    } });
    const router = () => new ReminderRouter({ config: () => current, repos: () => repos, bindCalendar: args => writer.target(args), calendarWrite: (...args) => writer.write(...args), ledger: () => ({}) });
    await expect(router().route(item, { text: '喝水', at: '2026-10-23T09:00:00+08:00' })).rejects.toThrow('超时');
    current.sources.defaults.calendar = 'b'; fail = false;
    await expect(router().route(item, { text: '喝水', at: start, sourceId: '个人日历' })).rejects.toThrow(/待核对/);
    await expect(router().route(item, { text: '喝水', at: start, sourceId: 'a' })).rejects.toThrow(/待核对/);
    expect(writes).toHaveLength(1); expect(await repos.operations.calendarRemindersForWork(item.id)).toHaveLength(1);
  });
  it('不同交办与登记别名对同一原生日历串行；第二次写前读取第一项变更', async () => {
    current.sources.entries[1].resourceId = 'a';
    const gates = new Map(); const gate = (key, run) => { const result = (gates.get(key) ?? Promise.resolve()).then(run, run); gates.set(key, result.catch(() => {})); return result; };
    let inFlight = 0, maximum = 0, summary = '原会议'; const reads = [];
    const { writer, item } = await writerFixture({ gate, invoke: async args => {
      maximum = Math.max(maximum, ++inFlight); await new Promise(resolve => setTimeout(resolve, 10));
      const data = JSON.parse(args[args.indexOf('--data') + 1]); summary = data.summary; inFlight--;
      return { data: { event: { event_id: 'same_0', ...data } } };
    }, object: async target => {
      reads.push(summary);
      return event(JSON.stringify([target.resource.id, 'same_0']), { locator: { eventId: 'same_0', calendarId: target.resource.id },
        body: { summary, start, end }, capabilities: { update: 'allowed', effect: 'whole_event' } });
    } });
    const other = await repos.workItems.insert({ ...item, id: 'work-2' });
    await Promise.all([writer.write(item, 'update', { sourceId: 'a', eventId: 'same_0', summary: '第一项' }), writer.write(other, 'update', { sourceId: 'b', eventId: 'same_0', summary: '第二项' })]);
    expect(maximum).toBe(1); expect(reads).toHaveLength(4); expect(reads[0]).toBe('原会议');
    expect(reads[1]).toBe(reads[2]); expect(new Set([reads[1], reads[3]])).toEqual(new Set(['第一项', '第二项']));
  });
  it('objectId 和 eventId 指向不同对象时拒绝取消，不覆盖任一标识', async () => {
    const { writer, item, writes } = await writerFixture();
    const created = await writer.write(item, 'create', { summary: '原会议', start, end });
    await expect(writer.write(item, 'cancel', { sourceId: 'a', objectId: created.verification.objectId, eventId: 'different_0' })).rejects.toThrow(/指向不同日程/);
    expect(writes).toHaveLength(1);
  });
  it('失败后较晚成功的取消刷新投影，回读离线使旧完整窗口待核验', async () => {
    let accepted = false, reject = true;
    const { writer, item } = await writerFixture({ invoke: async () => {
      if (reject) throw Object.assign(Error('明确拒绝'), { outcome: 'failed' }); accepted = true; return { data: {} };
    }, object: async target => {
      if (accepted) throw Error('回读离线');
      return event(JSON.stringify([target.resource.id, 'cancel_0']), { locator: { eventId: 'cancel_0', calendarId: target.resource.id }, body: { summary: '原会议', start, end }, capabilities: { cancel: 'allowed' } });
    } });
    const args = { sourceId: 'a', eventId: 'cancel_0' };
    await expect(writer.write(item, 'cancel', args)).rejects.toThrow('明确拒绝');
    const target = await service.bind('calendar', { sourceId: 'a' }, 'read');
    await repos.sourceProjection.observe(target, observation([event(JSON.stringify(['a', 'cancel_0']), { locator: { eventId: 'cancel_0', calendarId: 'a' }, body: { summary: '原会议', start, end } })]));
    await new Promise(resolve => setTimeout(resolve, 5)); reject = false;
    const result = await writer.write(item, 'cancel', args); expect(result.verification.state).toBe('unverified');
    const cached = await repos.sourceProjection.cached(target, window);
    expect(cached.items).toHaveLength(0); expect(cached.observation.state).toBe('partial');
  });
  it('成功回执迟到补账不覆盖接受之后的原生编辑及完整观察', async () => {
    let fail = true;
    const { writer, item, writes } = await writerFixture({ mirror: async () => { if (fail) throw Error('本地故障'); }, object: async () => { throw Error('离线'); } });
    const args = { start, end, summary: '原会议' };
    await expect(writer.write(item, 'create', args)).rejects.toThrow('本地故障');
    const target = await service.bind('calendar', { sourceId: 'a' }, 'read');
    await new Promise(resolve => setTimeout(resolve, 5));
    await repos.sourceProjection.observe(target, observation([event(JSON.stringify(['a', 'created_0']), { locator: { eventId: 'created_0', calendarId: 'a' }, body: { summary: '原生新主题', start, end } })]));
    fail = false; await writer.write(item, 'create', args);
    const cached = await repos.sourceProjection.cached(target, window);
    expect(cached.items[0].body.summary).toBe('原生新主题'); expect(cached.observation.state).toBe('complete'); expect(writes).toHaveLength(1);
  });
  it('独立提醒展示实际回读，空提醒冲突不报有效时刻；取消未核验不报停止', async () => {
    let active = true, reminders = [], offline = false;
    const { writer, item, writes } = await writerFixture({ object: async target => {
      if (offline) throw Error('回读离线');
      return event(JSON.stringify([target.resource.id, 'created_0']), { locator: { eventId: 'created_0', calendarId: target.resource.id, reminders },
        body: { summary: '提醒：喝水', start, end: '2026-10-23T01:15:00.000Z' }, active, capabilities: { cancel: 'allowed' } });
    } });
    const router = new ReminderRouter({ config: () => current, repos: () => repos, bindCalendar: args => writer.target(args),
      calendarWrite: (...args) => writer.write(...args), ledger: () => ({ setStatus: (id, status) => repos.reminders.updateRule(id, { status }) }) });
    const args = { kind: 'once', at: start, text: '喝水' };
    const created = await router.route(item, args);
    expect(created.verification.state).toBe('conflict'); expect(created.reminderAt).toBeNull(); expect(created.message).toContain('尚未确认有效提醒时间');
    expect((await repos.reminders.getRule(created.ruleId)).record.reminder_minutes).toEqual([]);
    reminders = [{ minutes: 0 }]; const checked = await router.route(item, args);
    expect(checked.verification.state).toBe('verified'); expect(checked.reminderAt).toBe(start);
    const canceled = await router.cancel(item, created.ruleId, '本人取消');
    expect(canceled.pendingCancellation).toBe(true); expect(canceled.verification.state).toBe('conflict');
    expect((await repos.reminders.getRule(created.ruleId)).status).toBe('delegated');
    offline = true; expect((await router.cancel(item, created.ruleId, '本人取消')).verification.state).toBe('unverified');
    active = false; offline = false; await router.cancel(item, created.ruleId, '本人取消');
    expect((await repos.reminders.getRule(created.ruleId)).status).toBe('stopped');
    expect(writes.filter(args => args[2] === 'create')).toHaveLength(1); expect(writes.filter(args => args[2] === 'delete')).toHaveLength(1);
  });
  it('只取消本人提醒发送 reminders 空数组，不删会议；重复范围不明不写入', async () => {
    const { writer, item, writes } = await writerFixture({ recurring: true });
    await expect(writer.write(item, 'cancel', { sourceId: 'a', eventId: 'series_0' })).rejects.toThrow(/重复日程/);
    const result = await writer.write(item, 'reminders', { sourceId: 'a', eventId: 'series_0', reminderMinutes: [], repeatScope: 'all' });
    expect(result.effect).toBe('personal_reminder'); expect(writes).toHaveLength(1); expect(writes[0]).toContain('patch');
    expect(JSON.parse(writes[0][writes[0].indexOf('--data') + 1])).toEqual({ reminders: [] });
    await expect(writer.write(item, 'cancel', { sourceId: 'a', eventId: 'series_0', effect: 'leave', repeatScope: 'all' })).rejects.toThrow(/退出/);
  });
  it('企微原生修改及取消只沿同身份原创建凭证；不把姓名相同的外部日程当作本人组织', async () => {
    current.sources.entries[0] = entry('a', { platform: 'wecom', resourceKind: 'authorized_scope', resourceId: 'authorized' });
    const sent = [];
    const { writer, item } = await writerFixture({ wecom: async args => { sent.push(args); return { data: args[2] === 'create' ? { schedule_id: 'w-created' } : {} }; } });
    await writer.write(item, 'create', { start, end });
    await writer.write(item, 'update', { sourceId: 'a', eventId: 'w-created', summary: '已改名' });
    expect(sent.at(-1).slice(0, 3)).toEqual(['calendar', 'schedules', 'update']);
    await expect(writer.write(item, 'cancel', { sourceId: 'a', eventId: 'someone-else' })).rejects.toThrow(/原创建凭证/);
    await writer.write(item, 'cancel', { sourceId: 'a', eventId: 'w-created' }); expect(sent.at(-1).slice(0, 3)).toEqual(['calendar', 'schedules', 'cancel']); expect(sent).toHaveLength(3);
  });
  it('邀请失败沿原会议补邀请，缺失回执不声称所有人已收到', async () => {
    let inviteAttempts = 0;
    const { writer, item, writes } = await writerFixture({ invoke: async args => {
      if (args[1] !== 'event.attendees') return { data: { event: { event_id: 'with-people_0' } } };
      inviteAttempts++; if (inviteAttempts === 1) throw Object.assign(Error('暂时拒绝'), { outcome: 'failed' });
      return { data: { attendees: [{ type: 'user', user_id: 'ou_guest', attendee_id: 'guest', rsvp_status: 'needs_action' }] } };
    } });
    const args = { start, end, attendees: ['ou_guest'], instruction: '本人明确邀请' };
    expect((await writer.write(item, 'create', args)).invitation.state).toBe('failed');
    expect((await writer.write(item, 'create', args)).invitation.state).toBe('succeeded');
    expect(writes.filter(args => args[1] === 'events' && args[2] === 'create')).toHaveLength(1); expect(inviteAttempts).toBe(2);
  });
});
