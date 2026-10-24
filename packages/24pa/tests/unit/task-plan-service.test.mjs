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
import { TaskPlanEngine } from '../../lib/task-plan-engine.js';
import { digestWindowKey, digestPeriod } from '../../lib/digest-period.js';
import { PaRuntime } from '../../lib/runtime.js';
import { SourceRegistry, unknownCapabilities } from '../../lib/source-registry.js';
import { createDailyScheduleRecord, createEveryScheduleRecord, createAtScheduleRecord, ScheduleId } from '@deepseek-ai/dsh-schedule';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`定时任务配置服务 (${backend})`, () => {
  let db, cluster, repos, service, runs, plans, native, nativeRows, creates, config, entry, owner, access, gates, engine, engineDeps;
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
      authorizePlan: (configuration, skill, previous) => access.authorize(configuration, skill, previous),
      verifyPlan: run => access.verify(run.snapshot.plan.authorization),
      template: async () => '结果', lease: work => work(), control: work => work(), detached: work => work() });
    native = {
      create: async (sessionId, request) => { creates++; const id = ScheduleId(`native-${randomUUID()}`);
        const record = request.every_seconds ? createEveryScheduleRecord(id, request.prompt, request.every_seconds, Date.now(), request.title)
          : request.at ? createAtScheduleRecord(id, request.prompt, request.at, Date.now(), request.title)
          : createDailyScheduleRecord(id, request.prompt, request.daily, Date.now(), request.title);
        nativeRows.push({ ...record, sessionId, status: 'active' }); return record; },
      catalog: async () => structuredClone(nativeRows),
      delete: async ({ id }) => { nativeRows = nativeRows.filter(row => row.id !== id); return { deleted: true }; },
    };
    plans = new PlanLifecycle({ repo: () => repos.digests, native: () => native });
    service = new TaskPlanService({ context: () => ({ binding: 'binding', timeZone: 'Asia/Shanghai', sessionId: 'fixed-access', deliveryChannel: 'feishu', repos }),
      management: manager, skills: runs, access, lifecycle: plans, gate });
    engineDeps = { context: () => ({ binding: 'binding', cwd: '/workspace', sessionId: 'fixed-access', repos }), skills: runs, access, permissionHash: () => 'fixed-plan-permission' };
    engine = new TaskPlanEngine(engineDeps);
  });
  const command = (op, row, extra = {}) => ({ op, ...(row ? { id: row.id, expectedRevision: row.revision } : {}), requestId: randomUUID(), workspaceBinding: 'binding', ...extra });
  const create = async extra => (await service.change(command('save', null, { title: '日程计划', skillId: `managed:${entry.id}`, timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'feishu' }, ...extra }))).plan;
  const enable = async (row, extra = {}) => {
    const preview = await service.preview({ id: row.id, workspaceBinding: 'binding', ...extra });
    return (await service.change(command('enable', row, { confirm: true, fingerprint: preview.fingerprint, ...extra }))).plan;
  };
  const reminder = (row, at = new Date(Date.now() - 1000).toISOString(), extra = {}) => ({
    schedule_id: row.schedule_id, occurrence_at: at, reminder_prompt: nativeRows.find(item => item.id === row.schedule_id)?.prompt, ...extra,
  });
  const message = (...reminders) => ({ id: randomUUID(), source: { kind: 'schedule' }, content: [{ type: 'text', text: `[SCHEDULE REMINDER BATCH]\n原生计划\nreminders_json: ${JSON.stringify(reminders)}` }] });
  const legacy = () => plans.enable({ id: `legacy-${randomUUID()}`, kind: 'morning', title: '原晨报', skill: entry.name, voice: true,
    session_id: 'fixed-access', schedule_spec: { daily: { time: '08:30:00', time_zone: 'Asia/Tokyo' } }, last_window: null });
  const oldClaim = async (row, at) => {
    const version = await repos.skills.version(entry.active_version);
    return repos.digests.claimRun({ planId: row.id, windowKey: digestWindowKey(row.kind, 'Asia/Tokyo', at),
      timeContext: digestPeriod(row.kind, 'Asia/Tokyo', at, 'schedule'), skill: { ...version.definition,
        metadata: { ...version.definition.metadata, pa24Identity: { versionId: version.id } } } });
  };
  it('重配目标保留暂停选择且预览携带计划固定时区；重复确认不改启停', async () => {
    let row = await create({ timeZone: 'America/New_York' });
    row = (await service.change(command('pause', await enable(row)))).plan;
    config.sources.defaults.calendar = 'B';
    const preview = await service.preview({ id: row.id, workspaceBinding: 'binding', rebind: true });
    expect(preview.timeZone).toBe('America/New_York');
    const input = command('rebind', row, { confirm: true, fingerprint: preview.fingerprint });
    const result = await service.change(input);
    expect(result.plan).toMatchObject({ owner_enabled: false, status: 'paused', schedule_id: null });
    expect(result.plan.task_authorization.targets[0].target.sourceId).toBe('B');
    expect((await service.change(input)).repeated).toBe(true);
    expect(creates).toBe(1);
  });
  it('管理摘要下次运行使用计划固定时区而非工作区默认', async () => {
    const row = await enable(await create({ timeZone: 'America/New_York', timing: { type: 'interval', seconds: 60 } }));
    const overview = await service.summary({ workspaceBinding: 'binding' });
    expect(overview.next).toMatchObject({ id: row.id, timeZone: 'America/New_York' });
  });
  it('管理摘要和筛选按全部计划一致计算，旧启用与受阻计划不混入暂停或下次运行', async () => {
    const before = await repos.taskPlans.summary(), prefix = '管理全量-' + randomUUID();
    for (let i = 0; i < 21; i++) await create({ title: prefix + '-' + i });
    const old = await legacy(), active = await enable(await create({ title: prefix + '-active' }));
    const blocked = await enable(await create({ title: prefix + '-blocked' }));
    await repos.taskPlans.block(blocked.id, { key: 'attention', kind: 'manual', reason: '需核对' });
    const overview = await service.summary({ workspaceBinding: 'binding' });
    expect(overview).toMatchObject({ total: before.total + 24, enabled: before.enabled + 2, paused: before.paused + 22, blocked: before.blocked + 1 });
    expect(overview.next).not.toBeNull(); expect(overview.next.id).not.toBe(blocked.id);
    expect((await service.list({ workspaceBinding: 'binding', query: prefix })).total).toBe(23);
    expect((await service.list({ workspaceBinding: 'binding', query: prefix, offset: 20 })).rows).toHaveLength(3);
    const query = state => service.list({ workspaceBinding: 'binding', query: prefix, state });
    expect((await query('enabled')).rows.map(row => row.id)).toEqual([active.id]);
    expect((await query('paused')).total).toBe(22);
    expect((await query('blocked')).rows[0]).toMatchObject({ id: blocked.id, nextTimes: [] });
    expect((await service.list({ workspaceBinding: 'binding', query: old.id, state: 'enabled' })).total).toBe(1);
    expect((await service.list({ workspaceBinding: 'binding', query: old.id, state: 'paused' })).total).toBe(0);
    await expect(service.list({ workspaceBinding: 'binding', offset: -1 })).rejects.toThrow(/页码/);
  });
  it('迁移保留原身份、时间、语音和成功结果；旧触发重放不再执行，最新未消费触发正常准入', async () => {
    let row = await legacy(); const at = new Date(Date.now() - 7200000);
    const original = await oldClaim(row, at);
    await repos.digests.completeRun({ planId: row.id, occurrenceId: original.row.id, report: '历史完整结果', notifications: [] });
    row = await repos.taskPlans.get(row.id); const beforeNative = structuredClone(nativeRows);
    const preview = await service.migrationPreview({ id: row.id, workspaceBinding: 'binding' });
    expect(preview.configuration).toMatchObject({ timeZone: 'Asia/Tokyo', delivery: { channel: 'feishu', voice: true } });
    const input = command('migrate', row, { confirm: true, fingerprint: preview.fingerprint });
    const one = await service.change(input), two = await service.change(input);
    expect(two.repeated).toBe(true); expect(one.plan.id).toBe(row.id); expect(nativeRows).toEqual(beforeNative); expect(creates).toBe(1);
    expect(one.plan).toMatchObject({ status: 'active', owner_enabled: true, schedule_id: row.schedule_id, schedule_generation: row.schedule_generation, skill: entry.name, voice: true });
    expect((await service.inspect({ id: row.id, workspaceBinding: 'binding' })).legacyHistory[0].report).toBe('历史完整结果');
    expect((await repos.taskPlans.migration(row.id)).original.schedule_spec).toEqual(row.schedule_spec);
    await engine.consume([message(reminder(row, at.toISOString()))], 'fixed-access');
    const [handled] = (await repos.planTriggers.list(row.id)).rows;
    expect(handled).toMatchObject({ status: 'skipped', run_id: null }); expect(handled.reason).toContain('旧简报');
    expect(await repos.taskPlans.blocks(row.id)).toEqual([]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
    await engine.consume([message(reminder(row, new Date(Date.now()).toISOString()))], 'fixed-access');
    expect((await repos.planTriggers.list(row.id)).rows.filter(trigger => trigger.run_id)).toHaveLength(1);
    await expect(oldClaim(row, new Date())).rejects.toThrow(/通用运行准入|计划已升级/);
    await expect(repos.digests.recordWorkSource('late-old-work', { kind: 'schedule', sessionId: row.session_id, turn: 1,
      deliveries: [{ scheduleId: row.schedule_id, generation: row.schedule_generation, occurrenceAt: at.toISOString(), messageId: 'old' }] })).rejects.toThrow(/不重复委派/);
  });
  it('迁移暂停计划保持暂停且不创建调度，身份或版本改变使旧确认失效', async () => {
    let row = await legacy(); await plans.stop(row.id, 'paused'); row = await repos.taskPlans.get(row.id);
    const preview = await service.migrationPreview({ id: row.id, workspaceBinding: 'binding' });
    const input = command('migrate', row, { confirm: true, fingerprint: preview.fingerprint });
    owner = 'changed-owner'; await expect(service.change(input)).rejects.toThrow(/重新预览迁移/);
    expect((await repos.taskPlans.get(row.id)).task_config).toBeNull(); expect(await repos.taskPlans.migration(row.id)).toBeNull();
    owner = 'owner-a'; const result = await service.change(input);
    expect(result.plan).toMatchObject({ status: 'paused', owner_enabled: false, schedule_id: null, session_id: 'fixed-access' });
    expect(nativeRows).toEqual([]); expect(creates).toBe(1);
  });
  it('旧窗口未结束时不迁移；缺失原生代次或会话不符时保留原记录待核对', async () => {
    const row = await legacy(); await oldClaim(row, new Date());
    await expect(service.migrationPreview({ id: row.id, workspaceBinding: 'binding' })).rejects.toThrow(/未结束或待核对/);
    expect((await repos.taskPlans.get(row.id)).task_config).toBeNull();
    const other = await legacy();
    await repos.digests.comparePlan(other, { schedule_generation: null });
    await expect(service.migrationPreview({ id: other.id, workspaceBinding: 'binding' })).rejects.toThrow(/尚未核验/);
    expect(creates).toBe(2);
  });
  it('迁移与旧窗口认领竞争只有一条路径获准，不遗漏迁移前刚创建的发生记录', async () => {
    const row = await legacy(), preview = await service.migrationPreview({ id: row.id, workspaceBinding: 'binding' });
    const outcomes = await Promise.allSettled([
      repos.taskPlans.migrate({ ...identity(), id: row.id, expectedRevision: row.revision, configuration: preview.configuration, authorization: preview.authorization }),
      oldClaim(row, new Date()),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const current = await repos.taskPlans.get(row.id), history = await repos.digests.occurrencesOf(row.id);
    expect(current.task_config ? history.length === 0 : history.length === 1).toBe(true);
    expect(nativeRows).toHaveLength(1); expect(creates).toBe(1);
  });
  it('预览和列表不创建计划；重复确认启用只创建一份原生计划', async () => {
    const row = await create(), preview = await service.preview({ id: row.id, workspaceBinding: 'binding' });
    expect(creates).toBe(0); expect((await service.list({ workspaceBinding: 'binding' })).rows.some(item => item.id === row.id)).toBe(true);
    const input = command('enable', row, { confirm: true, fingerprint: preview.fingerprint });
    const [one, two] = await Promise.all([service.change(input), service.change(input)]);
    expect(one.plan.schedule_id).toBe(two.plan.schedule_id); expect(one.plan.owner_enabled).toBe(true); expect(creates).toBe(1);
    expect(one.plan.task_authorization.targets[0].target.resource.id).toBe('cal-A'); expect(nativeRows[0].sessionId).toBe('fixed-access');
    await expect(repos.digests.comparePlan(await repos.digests.getPlan((await create()).id), { status: 'active' })).rejects.toThrow(/尚未获准/);
  });
  it('计划接续原快照仍绑定 A，当前配置使用已确认 B；双击共享原交办且不绕过同计划重叠', async () => {
    let row = await enable(await create());
    await engine.consume([message(reminder(row))], 'fixed-access');
    const first = (await repos.planTriggers.list(row.id)).rows[0], original = await repos.skillRuns.get(first.run_id);
    await repos.skillRuns.transition(original.id, 'completed', '完成', '原结果');
    row = (await service.change(command('pause', row))).plan;
    row = (await service.change(command('save', row, { ...taskPlanForm(row), selectors: { calendar: { sourceId: 'B' } } }))).plan;
    row = await enable(row, { rebind: true });
    row = (await service.change(command('pause', row))).plan;
    const base = { rerunId: original.id, configuration: 'original', workspaceBinding: 'binding' };
    const preview = await runs.preview(base), current = await runs.preview({ ...base, configuration: 'current' });
    expect(preview.plan.authorization.targets[0].target.sourceId).toBe('A');
    expect(current.plan.authorization.targets[0].target.sourceId).toBe('B');
    expect(preview.sourceSessionId).toBe('fixed-access');
    const launch = vi.spyOn(runs, 'launch').mockResolvedValue(false);
    const input = { ...base, requestId: randomUUID(), confirm: true, fingerprint: preview.fingerprint };
    const [one, two] = await Promise.all([runs.start(input), runs.start(input)]);
    expect(one.run.id).toBe(two.run.id); expect(one.run.work_item_id).toBe(original.work_item_id);
    expect(one.run.plan.authorization.targets[0].target.sourceId).toBe('A');
    expect(one.run.plan_id).toBe(row.id); expect(one.run.trigger_kind).toBe('manual');
    const extra = await engine.previewRun({ id: row.id, workspaceBinding: 'binding' });
    const skipped = await engine.runNow({ id: row.id, workspaceBinding: 'binding', requestId: randomUUID(), confirm: true, fingerprint: extra.fingerprint });
    expect(skipped.run).toBeNull(); expect(skipped.trigger.status).toBe('skipped');
    config.sources.entries = config.sources.entries.filter(source => source.id !== 'A');
    launch.mockRestore(); await runs.poll();
    expect((await repos.skillRuns.get(one.run.id)).status).toBe('stopped');
    expect((await repos.planTriggers.list(row.id)).rows.find(trigger => trigger.run_id === one.run.id).status).toBe('skipped');
    expect(await repos.taskPlans.blocks(row.id)).toEqual([]);
    await expect(runs.preview(base)).rejects.toThrow(/已变更/);
    expect((await runs.preview({ ...base, configuration: 'current' })).plan.authorization.targets[0].target.sourceId).toBe('B');
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
  it('高优先级来源遮蔽的公司条件不能成为后续动作的授权依据', async () => {
    config.sources.mappings = [{ domain: 'calendar', kind: 'company', name: 'Beta', sourceId: 'B' }];
    const row = await enable(await create({ selectors: { calendar: { sourceId: 'A', company: 'Beta' } } }));
    expect(row.task_authorization.targets[0].target.sourceId).toBe('A');
    await expect(access.action(row.task_authorization, 'calendar_create', { company: 'Beta' })).rejects.toThrow(/超出/);
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
  it('明确修复连续失败只解除该阻断，保留其他阻断和主人的暂停选择', async () => {
    let row = await enable(await create()); row = (await service.change(command('pause', row))).plan;
    await repos.taskPlans.block(row.id, { key: 'failures', kind: 'failures', reason: '连续失败' });
    await repos.taskPlans.block(row.id, { key: 'manual', kind: 'manual', reason: '另需核对' });
    await db.query('update pa24.digest_plan set failure_count = 3 where id = $1', [row.id]); row = await repos.taskPlans.get(row.id);
    const preview = await service.preview({ id: row.id, workspaceBinding: 'binding' });
    const input = command('repair', row, { key: 'failures', confirm: true, fingerprint: preview.fingerprint });
    await service.change(input); await service.change(input);
    expect(await repos.taskPlans.get(row.id)).toMatchObject({ owner_enabled: false, status: 'paused', failure_count: 0, schedule_id: null });
    expect((await repos.taskPlans.blocks(row.id)).map(block => block.key)).toEqual(['manual']); expect(creates).toBe(1);
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
    config.sources.entries.find(source => source.id === 'A').name = 'Alpha Calendar';
    expect((await access.action(authorization, 'calendar_create', { summary: '会议' }))._sourceTarget.resource.id).toBe('cal-A');
    expect((await access.action(authorization, 'calendar_create', { sourceId: 'Alpha Calendar' })).sourceId).toBe('A');
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
  it('并发消费同一原生触发只建立一个运行，原包、目标和原生输入留档', async () => {
    const row = await enable(await create()), input = message(reminder(row)); config.sources.defaults.calendar = 'B';
    await Promise.all([engine.consume([input], 'fixed-access'), engine.consume([input], 'fixed-access')]);
    const triggers = await repos.planTriggers.list(row.id); expect(triggers.total).toBe(1);
    const run = await repos.skillRuns.get(triggers.rows[0].run_id);
    expect(run).toMatchObject({ plan_id: row.id, trigger_kind: 'schedule', status: 'pending', source_session_id: 'fixed-access', mode: 'business' });
    expect(run.snapshot.plan.authorization.targets[0].target.sourceId).toBe('A');
    expect(run.snapshot.permissionHash).toBe('fixed-plan-permission');
    expect(JSON.parse(Buffer.from(triggers.rows[0].snapshot.nativeInput.jsonBase64, 'base64').toString())).toEqual(input);
    await engine.consume([message(reminder(row, new Date().toISOString()))], 'fixed-access');
    expect((await repos.planTriggers.list(row.id)).rows.some(event => event.status === 'skipped' && event.run_id === null)).toBe(true);
  });
  it('暂停会停止未启动队列；手动暂停仍可确认单次运行且不恢复未来计划', async () => {
    let row = await enable(await create()); await engine.consume([message(reminder(row))], 'fixed-access');
    const first = (await repos.planTriggers.list(row.id)).rows[0];
    row = (await service.change(command('pause', row))).plan;
    expect(await repos.skillRuns.get(first.run_id)).toMatchObject({ status: 'stopped' });
    expect((await repos.planTriggers.list(row.id)).rows[0].status).toBe('skipped');
    const preview = await engine.previewRun({ id: row.id, workspaceBinding: 'binding' });
    const input = { id: row.id, workspaceBinding: 'binding', requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true };
    const [one, two] = await Promise.all([engine.runNow(input), engine.runNow(input)]);
    expect(one.run.id).toBe(two.run.id); expect(one.run.trigger_kind).toBe('manual');
    expect(await repos.taskPlans.get(row.id)).toMatchObject({ owner_enabled: false, status: 'paused', schedule_id: null });
    await expect(engine.runNow({ ...input, fingerprint: 'different' })).rejects.toThrow(/其他内容/);
  });
  it('补执行只取原生队列的最近一次；重建引擎从原历史恢复不重复', async () => {
    const row = await enable(await create());
    const older = message(reminder(row, new Date(Date.now() - 120_000).toISOString())), latest = message(reminder(row));
    const session = { id: 'fixed-access', header: {}, ownEvents: () => [{ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, removedCount: 0, inserted: [older, latest] } }] };
    await engine.recover(session); await new TaskPlanEngine(engineDeps).recover(session);
    const events = (await repos.planTriggers.list(row.id)).rows;
    expect(events).toHaveLength(2); expect(events.filter(event => event.run_id)).toHaveLength(1);
    expect(events.find(event => event.status === 'skipped').reason).toContain('更新的触发');
    expect(events.find(event => event.run_id).snapshot.messageId).toBe(latest.id);
  });
  it('旧代次、未来时点与取消不执行；普通对话中的计划格式不成为触发', async () => {
    const row = await enable(await create()), own = reminder(row);
    const old = message({ ...own, reminder_prompt: own.reminder_prompt.replace(row.schedule_generation, randomUUID()) });
    const future = message(reminder(row, new Date(Date.now() + 60_000).toISOString()));
    const canceled = message(reminder(row, new Date(Date.now() - 2000).toISOString()));
    await engine.consume([old, future], 'fixed-access');
    await engine.consume([canceled], 'fixed-access', new Set([canceled.id]));
    const user = { ...message(own), source: { kind: 'user' } };
    expect((await engine.consume([user], 'fixed-access')).size).toBe(0);
    expect((await engine.consume([message(own)], 'another-session')).size).toBe(0);
    expect((await repos.planTriggers.list(row.id)).rows.every(event => !event.run_id && event.status === 'rejected')).toBe(true);
  });
  it('过期一次计划留待处理事件；权限撤销留拒绝依据并阻断未来触发', async () => {
    const at = new Date(Date.now() + 60_000).toISOString();
    const once = await enable(await create({ timing: { type: 'once', at } }));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(at) + 3_600_001);
    await engine.consume([message(reminder(once, at))], 'fixed-access');
    expect((await repos.planTriggers.list(once.id)).rows[0]).toMatchObject({ status: 'expired', run_id: null });
    expect((await repos.taskPlans.blocks(once.id))[0].key).toBe('expired-once'); clock.mockRestore();
    const denied = await enable(await create()); config.sources.entries = config.sources.entries.filter(source => source.id !== 'A');
    await engine.consume([message(reminder(denied))], 'fixed-access');
    expect((await repos.planTriggers.list(denied.id)).rows[0]).toMatchObject({ status: 'rejected', run_id: null });
    expect((await repos.taskPlans.blocks(denied.id))[0].key).toBe('preflight');
    expect(await repos.taskPlans.get(denied.id)).toMatchObject({ owner_enabled: true, status: 'paused' });
  });
  it('原生 pre-step 消费计划不调用模型；混合输入保留普通对话和旧计划', async () => {
    const row = await enable(await create()), scheduled = message(reminder(row));
    let nextCalls = 0;
    const runtime = { accessSessionId: 'fixed-access', executions: { run: work => work() }, planEngine: engine };
    const agent = { id: 'fixed-access' };
    expect(await PaRuntime.prototype.planStep.call(runtime, agent, [scheduled], async () => { nextCalls++; return { kind: 'enter', messages: [scheduled] }; })).toEqual({ kind: 'reject' });
    expect(nextCalls).toBe(0);
    const legacy = { schedule_id: 'legacy-native', occurrence_at: new Date().toISOString(), reminder_prompt: '[24PA计划 legacy] legacy' };
    const mixed = message(reminder(row), legacy), user = { id: 'owner-message', source: { kind: 'user' }, content: [{ type: 'text', text: '下午我的日程怎样' }] };
    const decision = await PaRuntime.prototype.planStep.call(runtime, agent, [mixed, user], async () => ({ kind: 'enter', messages: [mixed, user] }));
    expect(decision.messages[1]).toEqual(user); expect(decision.messages[0].id).toBe(mixed.id);
    expect(decision.messages[0].content[0].text).toContain('legacy-native');
    expect(decision.messages[0].content[0].text).not.toContain(row.schedule_id);
    const run = await repos.skillRuns.get((await repos.planTriggers.list(row.id)).rows.find(event => event.run_id).run_id);
    const notice = { id: randomUUID(), source: { kind: 'subagent-settled', senderSessionId: run.session_id }, content: [{ type: 'text', text: '原生完成通知' }] };
    expect((await engine.consume([notice], 'fixed-access')).get(notice.id)).toBeNull();
    expect((await repos.skillRuns.inputs(run.id))[0].accepted).toBe(false);
  });
});
