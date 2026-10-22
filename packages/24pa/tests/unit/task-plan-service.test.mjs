import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { makeSkillPackage, parseSkillMarkdown } from '../../lib/skill-package.js';
import { SkillPackages } from '../../lib/skill-packages.js';
import { SkillManagement } from '../../lib/skill-management.js';
import { SkillRuns } from '../../lib/skill-runs.js';
import { PlanLifecycle } from '../../lib/plan-lifecycle.js';
import { TaskPlanService, taskPlanForm } from '../../lib/task-plan-service.js';
import { TaskPlanAccess } from '../../lib/task-plan-access.js';
import { SourceRegistry, unknownCapabilities } from '../../lib/source-registry.js';
import { createDailyScheduleRecord, createEveryScheduleRecord, ScheduleId } from '@deepseek-ai/dsh-schedule';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`定时任务配置服务 (${backend})`, () => {
  let db, cluster, repos, service, runs, plans, native, nativeRows, creates, config, entry, owner, access, gates;
  const identity = () => ({ requestId: randomUUID(), requestHash: randomUUID() });
  const gate = (key, work) => { const next = (gates.get(key) ?? Promise.resolve()).catch(() => {}).then(work); gates.set(key, next); return next; };
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { runs?.dispose(); await db?.close(); await cluster?.stop(); });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    runs?.dispose(); gates = new Map(); creates = 0; nativeRows = []; owner = 'owner-a';
    config = { sources: { version: 1, defaults: { calendar: 'A', todo: null }, mappings: [], meetingDurationMinutes: 60,
      entries: ['A', 'B'].map(id => ({ id, domain: 'calendar', platform: 'feishu', name: id, purpose: 'personal', ownerId: 'owner', resourceKind: 'calendar',
        resourceId: `cal-${id}`, filter: 'all', access: 'readwrite', enabled: true })) } };
    const sources = new SourceRegistry({ repo: () => repos.sources, config: () => config, connectionHash: () => 'connection', gate,
      probe: async source => ({ state: 'verified', checkedAt: new Date().toISOString(), identity: { platform: 'feishu', authority: 'app:fixed', ownerId: 'owner' },
        resource: { kind: source.resourceKind, id: source.resourceId }, capabilities: Object.fromEntries(Object.keys(unknownCapabilities()).map(key => [key, 'allowed'])), message: '已核验' }) });
    await sources.synchronize();
    access = new TaskPlanAccess({ sources, owner: async channel => ({ channel, target: owner, identityKey: owner, connectionHash: 'connection' }) });
    const markdown = '---\n' + JSON.stringify({ name: 'plan-calendar', description: '创建本人日程', metadata: { track: 'agent', tools: ['pa24_work'], pa24: {
      schemaVersion: 1, mode: 'business', parameters: {}, actions: ['calendar_create'], expectedResult: '日程', completionCriteria: '原平台回执',
    } } }) + '\n---\n创建约定日程。';
    entry = await repos.skills.change({ ...identity(), op: 'save', displayName: '定时日程验证', version: { package_data: makeSkillPackage([{ path: 'SKILL.md', bytes: Buffer.from(markdown) }]), definition: parseSkillMarkdown(markdown), validation_error: null } });
    entry = await repos.skills.change({ ...identity(), op: 'publish', id: entry.id, expectedRevision: entry.revision, versionId: entry.draft_version });
    const packages = new SkillPackages({ context: () => ({ cwd: '/workspace', binding: 'binding', repo: repos.skills }), registry: null, plans: async () => [], pausePlan: async () => {}, check: async () => [] });
    const manager = new SkillManagement({ context: () => ({ cwd: '/workspace', binding: 'binding', enabled: true, allowed: [entry.name] }), registry: null, builtins: () => [], plans: async () => [], packages });
    runs = new SkillRuns({ host: {}, packages, management: manager, context: () => ({ cwd: '/workspace', binding: 'binding', repos }),
      sourceSession: async () => 'local', tools: async () => ['pa24_work'], permissionHash: () => 'permission', checkBusiness() {}, checkTemplate() {},
      template: async () => '结果', lease: work => work(), control: work => work(), detached: work => work() });
    native = {
      create: async (sessionId, request) => { const id = ScheduleId(`native-${++creates}`);
        const record = request.every_seconds ? createEveryScheduleRecord(id, request.prompt, request.every_seconds, Date.now(), request.title)
          : createDailyScheduleRecord(id, request.prompt, request.daily, Date.now(), request.title);
        nativeRows.push({ ...record, sessionId, status: 'active' }); return record; },
      catalog: async () => structuredClone(nativeRows),
      delete: async ({ id }) => { nativeRows = nativeRows.filter(row => row.id !== id); return { deleted: true }; },
    };
    plans = new PlanLifecycle({ repo: () => repos.digests, native: () => native });
    service = new TaskPlanService({ context: () => ({ binding: 'binding', timeZone: 'Asia/Shanghai', sessionId: 'fixed-access', repos }),
      management: manager, skills: runs, access, lifecycle: plans, gate });
  });
  const command = (op, row, extra = {}) => ({ op, ...(row ? { id: row.id, expectedRevision: row.revision } : {}), requestId: randomUUID(), workspaceBinding: 'binding', ...extra });
  const create = async extra => (await service.change(command('save', null, { title: '日程计划', skillId: `managed:${entry.id}`, timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'feishu' }, ...extra }))).plan;
  const enable = async (row, extra = {}) => {
    const preview = await service.preview({ id: row.id, workspaceBinding: 'binding', ...extra });
    return (await service.change(command('enable', row, { confirm: true, fingerprint: preview.fingerprint, ...extra }))).plan;
  };
  it('预览和列表不创建计划；重复确认启用只创建一份原生计划', async () => {
    const row = await create(), preview = await service.preview({ id: row.id, workspaceBinding: 'binding' });
    expect(creates).toBe(0); expect((await service.list({ workspaceBinding: 'binding' })).rows.some(item => item.id === row.id)).toBe(true);
    const input = command('enable', row, { confirm: true, fingerprint: preview.fingerprint });
    const [one, two] = await Promise.all([service.change(input), service.change(input)]);
    expect(one.plan.schedule_id).toBe(two.plan.schedule_id); expect(one.plan.owner_enabled).toBe(true); expect(creates).toBe(1);
    expect(one.plan.task_authorization.targets[0].target.resource.id).toBe('cal-A'); expect(nativeRows[0].sessionId).toBe('fixed-access');
    await expect(repos.digests.comparePlan(await repos.digests.getPlan((await create()).id), { status: 'active' })).rejects.toThrow(/尚未获准/);
  });
  it('默认 A 改 B 后仍用 A；明确重配才用 B；旧预览拒绝变化后的目标', async () => {
    let row = await enable(await create());
    row = (await service.change(command('pause', row))).plan;
    config.sources.defaults.calendar = 'B';
    row = (await service.change(command('save', row, { ...taskPlanForm(row), title: '改名仍用原目标' }))).plan;
    expect(row.task_authorization.targets[0].target.resource.id).toBe('cal-A');
    row = await enable(row); expect(row.task_authorization.targets[0].target.resource.id).toBe('cal-A');
    row = (await service.change(command('pause', row))).plan;
    const old = await service.preview({ id: row.id, workspaceBinding: 'binding', rebind: true });
    config.sources.defaults.calendar = 'A';
    await expect(service.change(command('enable', row, { confirm: true, rebind: true, fingerprint: old.fingerprint }))).rejects.toThrow(/重新预览/);
    config.sources.defaults.calendar = 'B'; row = await enable(row, { rebind: true });
    expect(row.task_authorization.targets[0].target.resource.id).toBe('cal-B');
  });
  it('编辑明确选择须重配；原选择的映射变化不静默改绑', async () => {
    config.sources.mappings = [{ domain: 'calendar', kind: 'company', name: 'Alpha', sourceId: 'A' }];
    let row = await enable(await create({ selectors: { calendar: { company: 'Alpha' } } }));
    config.sources.mappings[0].sourceId = 'B';
    expect((await access.action(row.task_authorization, 'calendar_create', { company: 'Alpha' })).sourceId).toBe('A');
    row = (await service.change(command('pause', row))).plan;
    row = (await service.change(command('save', row, { ...taskPlanForm(row), selectors: { calendar: { sourceId: 'B' } } }))).plan;
    await expect(enable(row)).rejects.toThrow(/业务目标选择已改变/);
    row = await enable(row, { rebind: true });
    expect(row.task_authorization.targets[0].target.resource.id).toBe('cal-B');
  });
  it('间隔列表读取实际原生时点；刷新不后移，读取失败不伪造预览', async () => {
    const now = Date.parse('2026-10-23T00:00:00Z'), clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    let row = await enable(await create({ timing: { type: 'interval', seconds: 60 } }));
    const list = async () => (await service.list({ workspaceBinding: 'binding' })).rows.find(item => item.id === row.id);
    clock.mockReturnValue(now + 10_000);
    expect((await list()).nextTimes.slice(0, 2)).toEqual(['2026-10-23T00:01:00.000Z', '2026-10-23T00:02:00.000Z']);
    clock.mockReturnValue(now + 20_000);
    expect((await list()).nextTimes[0]).toBe(nativeRows[0].scheduledAt);
    nativeRows[0].scheduledAt = '2026-10-23T00:02:00.000Z';
    expect((await list()).nextTimes[0]).toBe('2026-10-23T00:02:00.000Z');
    native.catalog = async () => { throw new Error('目录读取失败'); };
    expect(await list()).toMatchObject({ nextTimes: [], timingError: '目录读取失败' });
    row = (await service.change(command('pause', row))).plan;
    expect(await list()).toMatchObject({ nextTimes: [], timingError: null });
  });
  it('复制不继承授权；投递主人变化不能自动改投；多个阻断分别保留', async () => {
    let row = await enable(await create());
    const copy = (await service.change(command('copy', row))).plan;
    expect(copy).toMatchObject({ owner_enabled: false, task_authorization: null, schedule_id: null });
    row = (await service.change(command('pause', row))).plan; owner = 'owner-b';
    await expect(enable(row)).rejects.toThrow(/原投递身份/);
    owner = 'owner-a'; await repos.taskPlans.block(row.id, { key: 'manual', kind: 'manual', reason: '主人要求核对' });
    row = await repos.taskPlans.get(row.id);
    await expect(enable(row)).rejects.toThrow(/阻断/);
    expect((await repos.taskPlans.blocks(row.id)).map(item => item.key)).toEqual(['manual']);
    expect((await repos.taskPlans.get(row.id)).owner_enabled).toBe(false);
  });
  it('原生创建回执未知时重试认领原 ID；旧启用请求不复活后续暂停', async () => {
    let row = await create(); const preview = await service.preview({ id: row.id, workspaceBinding: 'binding' });
    const input = command('enable', row, { confirm: true, fingerprint: preview.fingerprint }), createNative = native.create;
    native.create = async (...args) => { await createNative(...args); throw new Error('回执丢失'); };
    await expect(service.change(input)).rejects.toThrow(/回执丢失/); native.create = createNative;
    row = (await service.change(input)).plan; expect(creates).toBe(1); expect(row.status).toBe('active');
    const paused = (await service.change(command('pause', row))).plan;
    await service.change(input); expect((await repos.taskPlans.get(row.id)).status).toBe('paused'); expect(creates).toBe(1);
    expect(paused.schedule_id).toBeNull();
  });
  it('暂停删除结果未知时保留 ID，重试只清理同一计划；编辑须已暂停', async () => {
    let row = await enable(await create());
    await expect(service.change(command('save', row, taskPlanForm(row)))).rejects.toThrow(/先确认原生计划暂停/);
    const remove = native.delete, input = command('pause', row);
    native.delete = async () => { throw new Error('删除结果未知'); };
    await expect(service.change(input)).rejects.toThrow(/删除结果未知/);
    row = await repos.taskPlans.get(row.id); expect(row.schedule_id).not.toBeNull(); expect(row.owner_enabled).toBe(false);
    native.delete = remove; row = (await service.change(input)).plan; expect(row.schedule_id).toBeNull();
    row = (await service.change(command('save', row, { ...taskPlanForm(row), title: '新名字' }))).plan;
    expect(row.title).toBe('新名字'); expect(row.task_authorization.targets[0].target.sourceId).toBe('A');
  });
  it('等待运行阻止回收；终态仍有未决原生回执也保留，结清后还原暂停', async () => {
    let row = await create(); const prepared = await runs.preparePlan(row.task_config, row.session_id);
    const run = await repos.skillRuns.admit({ ...prepared, request_id: randomUUID(), request_hash: 'planned', trial: false });
    await db.query('update pa24.skill_run set plan_id = $2 where id = $1', [run.id, row.id]);
    await repos.skillRuns.transition(run.id, 'waiting', '待补充');
    await expect(service.change(command('delete', row))).rejects.toThrow(/选择等待/);
    row = (await service.change(command('delete', row, { running: 'wait' }))).plan;
    expect(row.delete_when_idle).toBe(true); expect(row.recycled_at).toBeNull();
    await repos.skillRuns.nativeReceipt(run.id, 'job', run.session_id, 'job', 'start', {});
    await repos.skillRuns.transition(run.id, 'failed', '结果待查');
    expect((await repos.taskPlans.finishDelete(row.id)).recycled_at).toBeNull();
    await repos.skillRuns.nativeReceipt(run.id, 'job', run.session_id, 'job', 'end', { producerReported: true });
    row = await repos.taskPlans.finishDelete(row.id); expect(row.recycled_at).not.toBeNull();
    row = (await service.change(command('restore', row))).plan;
    expect(row).toMatchObject({ status: 'paused', owner_enabled: false, task_authorization: null, recycled_at: null });
  });
  it('动作始终核验固定目标，移除后拒绝；模型不能另选 B', async () => {
    const row = await enable(await create()), authorization = row.task_authorization;
    config.sources.defaults.calendar = 'B';
    expect((await access.action(authorization, 'calendar_create', { summary: '会议' }))._sourceTarget.resource.id).toBe('cal-A');
    await expect(access.action(authorization, 'calendar_create', { sourceId: 'B' })).rejects.toThrow(/超出/);
    config.sources.mappings = [{ domain: 'calendar', kind: 'company', name: 'Beta', sourceId: 'B' },
      { domain: 'calendar', kind: 'project', name: 'Beta-project', sourceId: 'B' },
      { domain: 'calendar', kind: 'company', name: 'Alpha', sourceId: 'A' }];
    await expect(access.action(authorization, 'calendar_create', { company: 'Beta' })).rejects.toThrow(/超出/);
    await expect(access.action(authorization, 'calendar_create', { sourceId: 'A', project: 'Beta-project' })).rejects.toThrow(/超出/);
    await expect(access.action(authorization, 'calendar_create', { project: 'unregistered' })).rejects.toThrow(/尚未配置/);
    expect((await access.action(authorization, 'calendar_create', { company: 'Alpha' })).sourceId).toBe('A');
    config.sources.entries = config.sources.entries.filter(source => source.id !== 'A');
    await expect(access.action(authorization, 'calendar_create', { summary: '会议' })).rejects.toThrow(/已变更/);
  });
});
