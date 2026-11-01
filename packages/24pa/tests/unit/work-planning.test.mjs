import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { WorkPlanningRepo } from '../../lib/repo/work-planning.js';
import { WorkPlanning } from '../../lib/work-planning.js';
import { startPgCluster } from '../helpers/pg.mjs';
import { TaskPlanAccess } from '../../lib/task-plan-access.js';
import { WORK_METHOD_SKILLS } from '../../lib/work-methods.js';
import { planningAvailability } from '../../lib/work-planning-validation.js';
import { localDay } from '../../lib/calendar-time.js';
import { openBackupLedger } from '../../lib/backup-ledger.js';
import { BackupInspectionRepo } from '../../lib/repo/backup-inspection.js';

const zone = 'Asia/Shanghai', date = localDay(new Date(), zone, 1).date, previous = localDay(date, zone, -1).date, next = localDay(date, zone, 1).date;
const at = hour => `${date}T${String(hour).padStart(2, '0')}:00:00+08:00`;
const owner = { id: 'owner-work', role: 'calendar', instruction: '本周重点是客户方案，工作时段9点至12点；确认采纳方案；方案完成。' };
const background = { id: 'background-work', role: 'skill', execution_mode: 'skill', instruction: '按既定计划生成建议。' };
const focusArgs = { expectedRevision: 0, focuses: [{ id: 'client', title: '客户方案', outcome: '交付可评审初稿' }], instruction: '本周重点是客户方案' };
const item = (patch = {}) => ({ id: 'proposal', title: '客户方案初稿', outcome: '一份可评审的初稿', reason: '直接推进已确认的客户成果', nextAction: '先整理客户的三个关键需求', focusId: 'client',
  references: [{ kind: 'todo', id: 'todo-without-deadline' }], estimateMinutes: 60, start: null, end: null, ...patch });

for (const storage of ['sqlite', 'postgres']) describe(`工作方法的持久闭环 ${storage}`, () => {
  let db, cluster, root, repo, service, todoFacts, calendarFacts, calls, scheduled;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-method-'));
    if (storage === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else db = new SqliteDb(join(root, 'ledger.sqlite'));
    await db.migrate(); repo = new WorkPlanningRepo(db);
  }, 120000);
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    await db.query('delete from pa24.work_planning_revision'); await db.query('delete from pa24.work_planning'); calls = 0; scheduled = false;
    todoFacts = { fresh: true, complete: true, message: '已核验', tasks: [
      { objectId: 'urgent-low-impact', summary: '归档旧资料', status: 'open', dueDate: previous, stale: false },
      { objectId: 'todo-without-deadline', summary: '客户方案', status: 'open', dueAt: null, dueDate: null, stale: false },
    ] };
    calendarFacts = { fresh: true, complete: true, events: [] };
    service = new WorkPlanning({ repo: () => repo, timeZone: () => zone, todos: async () => { calls++; return todoFacts; },
      calendar: async () => { calls++; return calendarFacts; }, work: async () => [], waiting: async () => [], isBackground: async () => scheduled });
  });
  const save = (patch = {}, actor = owner) => service.savePlan({ date, focusRevision: 1, expectedRevision: 0, items: [item()], ...patch }, actor);
  const confirm = (revision = 1) => service.confirmPlan({ date, expectedRevision: revision, selectedItemIds: ['proposal'], instruction: '确认采纳方案' }, owner);

  it('无截止的重要事项可进入规划，建议与采纳分离，新建议不覆盖已采纳快照', async () => {
    await service.updateFocus(focusArgs, owner); const context = await service.context({ date });
    expect(context.todos.tasks.some(task => task.objectId === 'todo-without-deadline')).toBe(true);
    const proposed = await save(); expect(proposed.content.accepted).toBeNull(); expect(proposed.content.evidence.capacityMinutes).toBeNull();
    const adopted = await confirm(); expect(adopted.content.accepted.items[0].outcome).toBe('一份可评审的初稿');
    await save({ expectedRevision: 2, items: [item({ outcome: '更新后的建议' })] });
    const state = await service.snapshot(date); expect(state.plan.content.items[0].outcome).toBe('更新后的建议');
    expect(state.plan.content.accepted.items[0].outcome).toBe('一份可评审的初稿');
    expect((await db.query('select * from pa24.work_planning_revision')).rows).toHaveLength(4);
  });

  it('并发改动只有一个成功，过时版本和凭空引用被拒绝，重复请求复用原回执', async () => {
    await service.updateFocus(focusArgs, owner); await save();
    const results = await Promise.allSettled([save({ expectedRevision: 1, decisions: ['选项A'] }), save({ expectedRevision: 1, decisions: ['选项B'] })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await expect(save({ expectedRevision: 1, decisions: ['另一项'] })).rejects.toThrow(/版本/);
    expect((await service.updateFocus(focusArgs, owner)).revision).toBe(1);
    await expect(save({ expectedRevision: 2, items: [item({ references: [{ kind: 'todo', id: 'invented' }] })] })).rejects.toThrow(/来源/);
    await expect(service.updateFocus({ ...focusArgs, expectedRevision: 1, instruction: '模型臆造的确认' }, owner)).rejects.toThrow(/委托/);
  });

  it('先合并重叠会议再计算容量，候选不穿越忙碌区间，过载必须给出取舍', async () => {
    await service.updateFocus(focusArgs, owner);
    calendarFacts.events = [{ start: at(10), end: at(11), freeBusy: 'busy' }, { start: at(10).replace(':00:00', ':30:00'), end: at(11).replace(':00:00', ':30:00'), freeBusy: 'busy' }];
    const options = { workWindows: [{ start: at(9), end: at(12) }], instruction: '工作时段9点至12点' };
    await expect(save({ ...options, items: [item({ start: at(10), end: at(11) })] })).rejects.toThrow(/空闲/);
    await expect(save({ ...options, items: [item({ estimateMinutes: 120 })] })).rejects.toThrow(/取舍/);
    const plan = await save({ ...options, items: [item({ start: at(9), end: at(10) })] });
    expect(plan.content.evidence.capacityMinutes).toBe(90);
    calendarFacts.events.push({ start: at(9), end: at(10), freeBusy: 'busy' });
    await expect(confirm()).rejects.toThrow(/日程已改变/);
  });

  it('未确认工时、未知估时和来源缺失均不冒充可用容量', async () => {
    await service.updateFocus(focusArgs, owner); calendarFacts.fresh = false; todoFacts.fresh = false;
    const plan = await save({ items: [item({ estimateMinutes: null })] });
    expect(plan.content.evidence).toMatchObject({ capacityMinutes: null, unknownEstimates: 1 }); expect(plan.content.evidence.missing).toHaveLength(2);
    await expect(save({ expectedRevision: 1, items: [item({ start: at(9), end: at(10) })] })).rejects.toThrow(/空闲/);
    await expect(save({ expectedRevision: 1, items: [item({ start: at(9), end: at(10), estimateMinutes: null })] })).rejects.toThrow(/估时/);
  });

  it('到期重点不能继续采用，重点修订后须重新规划', async () => {
    await service.updateFocus(focusArgs, owner); await save();
    await service.updateFocus({ ...focusArgs, expectedRevision: 1, focuses: [{ ...focusArgs.focuses[0], until: previous }] }, owner);
    await expect(confirm()).rejects.toThrow(/近期重点已改变/);
    await expect(save({ expectedRevision: 1, focusRevision: 2 })).rejects.toThrow(/过期/);
  });

  it('保存前校验最初读取的重点版本，不把旧建议改标为新目标', async () => {
    await service.updateFocus(focusArgs, owner);
    await service.updateFocus({ ...focusArgs, expectedRevision: 1, focuses: [{ ...focusArgs.focuses[0], outcome: '准备演示' }] }, owner);
    await expect(save()).rejects.toThrow(/近期重点版本/);
    expect((await service.snapshot(date)).plan).toBeNull();
  });

  it('采纳前重新核算无时间块重点的负荷，并保存当前证据', async () => {
    await service.updateFocus(focusArgs, owner);
    await save({ workWindows: [{ start: at(9), end: at(12) }], instruction: '工作时段9点至12点', items: [item({ estimateMinutes: 90 })] });
    calendarFacts.events = [{ start: at(9), end: at(11), freeBusy: 'busy' }];
    await expect(confirm()).rejects.toThrow(/取舍/);
    expect((await service.snapshot(date)).plan.content.accepted).toBeNull();
    await save({ expectedRevision: 1, items: [item({ estimateMinutes: 30 })] });
    expect((await confirm(2)).content.accepted.evidence).toMatchObject({ capacityMinutes: 60, estimateMinutes: 30 });
  });

  it('Schedule 来源的普通 calendar Worker 也不能代主人确认', async () => {
    await service.updateFocus(focusArgs, owner); await save(); scheduled = true;
    await expect(service.updateFocus({ ...focusArgs, expectedRevision: 1 }, owner)).rejects.toThrow(/交互式/);
    await expect(confirm()).rejects.toThrow(/交互式/);
    await expect(save({ expectedRevision: 1, workWindows: [{ start: at(9), end: at(12) }], instruction: '工作时段9点至12点' })).rejects.toThrow(/交互式/);
  });

  it('复盘核对采纳快照；日程结束和未知原因不构成完成，调整供次日读取', async () => {
    await service.updateFocus(focusArgs, owner); await save(); await confirm();
    const review = { date, expectedRevision: 0, acceptedRevision: 2, results: [{ itemId: 'proposal', status: 'completed', detail: '方案完成' }], adjustments: ['明天先核对客户反馈'] };
    await expect(service.saveReview(review, background)).rejects.toThrow(/完成结论/);
    await expect(service.saveReview({ ...review, results: [{ itemId: 'proposal', status: 'blocked', detail: '猜测客户没回复' }] }, background)).rejects.toThrow(/未知/);
    todoFacts.tasks[1].status = 'completed';
    const saved = await service.saveReview(review, background); expect(saved.content.results[0].evidence).toBe('platform');
    expect((await service.snapshot(next)).previousReview.content.adjustments).toEqual(['明天先核对客户反馈']);
    expect((await service.snapshot(localDay(date, zone, 3).date)).previousReview.content.adjustments).toEqual(['明天先核对客户反馈']);
    const before = calls; await service.snapshot(date); expect(calls).toBe(before);
  });

  it('后台可以保存建议，不能确认成果、采纳安排或设置工作时段', async () => {
    await service.updateFocus(focusArgs, owner);
    await save({}, background);
    await expect(service.updateFocus({ ...focusArgs, expectedRevision: 1 }, background)).rejects.toThrow(/交互式/);
    await expect(service.confirmPlan({ date, expectedRevision: 1, selectedItemIds: ['proposal'], instruction: '确认采纳方案' }, background)).rejects.toThrow(/交互式/);
    await expect(save({ expectedRevision: 1, workWindows: [{ start: at(9), end: at(12) }], instruction: '工作时段9点至12点' }, background)).rejects.toThrow(/交互式/);
  });

  it('复盘版本、重复项和伪造状态受约束；已提关键问题保留但提示不要重复', async () => {
    await service.updateFocus(focusArgs, owner); await save(); await confirm();
    const review = { date, expectedRevision: 0, acceptedRevision: 2, results: [{ itemId: 'proposal', status: 'unknown', detail: '进展待确认' }], question: '方案是否缺少客户输入？' };
    await expect(service.saveReview({ ...review, acceptedRevision: 1 }, background)).rejects.toThrow(/采纳/);
    await expect(service.saveReview({ ...review, results: [] }, background)).rejects.toThrow(/每一项/);
    await service.saveReview(review, background);
    const next = await service.saveReview({ ...review, expectedRevision: 1 }, background);
    expect(next.content.questionRepeated).toBe(true); expect(next.content.question).toBe(review.question);
  });

  it('数据库重开后记录和修订可恢复；不同日期时区有独立身份', async () => {
    await service.updateFocus(focusArgs, owner); await save(); await confirm();
    await db.close(); db = storage === 'sqlite' ? new SqliteDb(join(root, 'ledger.sqlite')) : new PaDatabase(cluster.dsn); repo = new WorkPlanningRepo(db);
    expect((await service.snapshot(date)).plan.content.accepted.items[0].id).toBe('proposal');
    expect((await service.snapshot(date, 'UTC')).plan).toBeNull();
    expect((await service.snapshot(next)).plan).toBeNull();
  });

  it('备份恢复保留采纳快照、复盘与全部修订，并能继续版本校验', async () => {
    await service.updateFocus(focusArgs, owner); await save(); await confirm();
    await service.saveReview({ date, expectedRevision: 0, acceptedRevision: 2, results: [{ itemId: 'proposal', status: 'unknown', detail: '进展待确认' }] }, background);
    const directory = join(root, 'restored'); await mkdir(directory);
    for (const part of await db.backup()) await writeFile(join(directory, part.name), part.bytes);
    const restored = await openBackupLedger(directory, storage);
    try {
      const inspection = await new BackupInspectionRepo(restored, storage).read();
      expect(inspection.records.work_planning).toHaveLength(3);
      expect(inspection.records.work_planning_revision).toHaveLength(4);
      expect(inspection.records.work_planning.find(row => row.id.startsWith('day:')).content.accepted.items[0].outcome).toBe('一份可评审的初稿');
      expect(inspection.records.work_planning.find(row => row.id.startsWith('review:')).content.acceptedRevision).toBe(2);
    } finally { await restored.close(); }
  }, 120000);
});

it('可用容量扣除已过去的时间及会议缓冲，失败读取不产生空闲结论', () => {
  const windows = [{ start: at(9), end: at(12) }], meetings = [{ start: at(10), end: at(11), freeBusy: 'busy' }];
  expect(planningAvailability(windows, meetings, true, 15, new Date(at(9).replace(':00:00', ':30:00'))).capacityMinutes).toBe(60);
  expect(planningAvailability(windows, meetings, true, 0, new Date(at(12))).capacityMinutes).toBe(0);
  expect(planningAvailability(windows, meetings, false, 15, new Date(at(9)))).toEqual({ free: [], capacityMinutes: null });
});

it('两个智能 Skill 可在固定后台授权中运行，但没有确认或外部写动作', async () => {
  const access = new TaskPlanAccess({ sources: {}, owner: async () => { throw Error('unexpected delivery'); } });
  for (const skill of WORK_METHOD_SKILLS) {
    const definition = { id: skill.name, tools: skill.metadata.tools, resources: [], contract: skill.metadata.pa24 };
    const authorization = await access.authorize({ delivery: { channel: 'none' }, selectors: {} }, definition, null);
    for (const action of definition.contract.actions) expect(await access.action(authorization, action, { date })).toEqual({ date });
    await expect(access.action(authorization, 'daily_plan_confirm', {})).rejects.toThrow();
    await expect(access.action(authorization, 'task_update', {})).rejects.toThrow();
  }
});
