import { taskPlanFingerprint } from './task-plan-access.js';
import { localDay } from './calendar-time.js';
import type { SourceTodo } from './source-todo.js';
import type { SourceCalendar } from './source-calendar.js';
import type { WorkItemRow, WaitingItemRow } from './repo.js';
import type { WorkPlanningRepo } from './repo/work-planning.js';
import type { DailyWorkPlan, DailyWorkReview, FocusSet, PlanningContent, ReviewResult, WorkPlanItem } from './work-planning-model.js';
import { planningAvailability, planningDate, planningItems, planningList, planningObject, planningRevision, planningText, planningWindows } from './work-planning-validation.js';

interface PlanningDeps {
  repo(): WorkPlanningRepo;
  timeZone(): string;
  todos(): ReturnType<SourceTodo['query']>;
  calendar(args: Record<string, unknown>): ReturnType<SourceCalendar['all']>;
  work(): Promise<WorkItemRow[]>;
  waiting(): Promise<WaitingItemRow[]>;
  bufferMinutes?(): Promise<number>;
  isBackground(workId: string): Promise<boolean>;
}

/** Method decisions live in business records, not long-term memory. Only
 * interactive calendar work can change confirmed goals or adopt a proposal. */
export class WorkPlanning {
  constructor(private readonly deps: PlanningDeps) {}
  private identity(date?: unknown, zone?: unknown) {
    const timeZone = zone === undefined ? this.deps.timeZone() : planningText(zone, '时区', 100), value = planningDate(date, timeZone);
    return { date: value, timeZone, planId: `day:${timeZone}:${value}`, reviewId: `review:${timeZone}:${value}` };
  }
  async snapshot(date?: unknown, zone?: unknown) {
    const identity = this.identity(date, zone), repo = this.deps.repo();
    const [focus, plan, review, previousReview] = await Promise.all([
      repo.get<FocusSet>('focus'), repo.get<DailyWorkPlan>(identity.planId), repo.get<DailyWorkReview>(identity.reviewId), repo.previousReview(identity.date, identity.timeZone),
    ]);
    return { ...identity, focus, plan, review, previousReview, observedAt: new Date().toISOString() };
  }
  async context(args: Record<string, unknown> = {}) {
    const snapshot = await this.snapshot(args.date, args.timeZone), day = localDay(snapshot.date, snapshot.timeZone), missing: string[] = [];
    const [todos, calendar, work, waiting, bufferMinutes] = await Promise.all([
      this.deps.todos().catch(error => { missing.push(`待办：${(error as Error).message}`); return null; }),
      this.deps.calendar({ from: day.from.toISOString(), to: day.to.toISOString() }).catch(error => { missing.push(`日历：${(error as Error).message}`); return null; }),
      this.deps.work(), this.deps.waiting(),
      this.deps.bufferMinutes?.() ?? Promise.resolve(0),
    ]);
    if (todos && !todos.fresh) missing.push(`待办范围未完整核验：${todos.message}`);
    if (calendar && !calendar.fresh) missing.push('日历范围未完整核验，不能认定空闲。');
    if (work.length >= 1000) missing.push('助理交办超过单次读取上限，未覆盖全部历史。');
    return { ...snapshot, todos, calendar, work: work.map(row => ({ id: row.id, title: row.title, status: row.status,
      acceptanceStatus: row.acceptance_status, progress: row.progress, completionCriteria: row.completion_criteria })),
      waiting, missing, bufferMinutes, availability: planningAvailability(snapshot.plan?.content.workWindows ?? [], calendar?.events ?? [], calendar?.fresh ?? false, bufferMinutes),
      message: '来源为当前核验状态；完成时刻和受阻原因不能由同步时间推断。近期重点和采纳结果必须依据本人指令；建议仅保存为提议。' };
  }

  private requestKey(action: string, item: WorkItemRow, args: Record<string, unknown>) {
    return taskPlanFingerprint([item.id, action, args]);
  }
  private async confirmation(args: Record<string, unknown>, item: WorkItemRow): Promise<string> {
    if (item.role !== 'calendar' || item.execution_mode === 'skill' || await this.deps.isBackground(item.id)) throw new Error('只有交互式日程 Worker 可以确认近期重点或采纳安排。');
    const quote = planningText(args.instruction, '本人指令依据');
    if (!item.instruction.includes(quote)) throw new Error('确认依据必须来自本次主人委托，不能由模型补造。');
    return quote;
  }
  private async replay<T extends PlanningContent>(action: string, args: Record<string, unknown>, item: WorkItemRow) {
    return this.deps.repo().receipt<T>(this.requestKey(action, item, args));
  }

  async updateFocus(args: Record<string, unknown>, item: WorkItemRow) {
    const confirmation = await this.confirmation(args, item), replay = await this.replay<FocusSet>('focus_update', args, item);
    if (replay) return replay;
    const items = planningList(args.focuses, 3).map(raw => {
      const row = planningObject(raw);
      return { id: planningText(row.id, '近期重点编号', 100), title: planningText(row.title, '近期重点', 300), outcome: planningText(row.outcome, '完成标准'),
        until: row.until ? planningDate(row.until, this.deps.timeZone()) : null };
    });
    if (new Set(items.map(row => row.id)).size !== items.length) throw new Error('近期重点编号不能重复。');
    return this.deps.repo().save('focus', planningRevision(args.expectedRevision), { items, confirmation }, item.id, this.requestKey('focus_update', item, args));
  }

  private validateReferences(items: WorkPlanItem[], facts: Awaited<ReturnType<WorkPlanning['context']>>) {
    for (const item of items) {
      if (item.focusId && !facts.focus?.content.items.some(focus => focus.id === item.focusId && (!focus.until || focus.until >= facts.date))) throw new Error('近期重点不存在或已过期，请先核对。');
      for (const reference of item.references) {
        if (reference.kind === 'todo' ? !facts.todos?.tasks.some(task => task.objectId === reference.id) : !facts.work.some(work => work.id === reference.id)) throw new Error('规划引用的业务对象未在当前来源中核验，请重新读取。');
      }
    }
  }

  async savePlan(args: Record<string, unknown>, item: WorkItemRow) {
    const replay = await this.replay<DailyWorkPlan>('daily_plan_save', args, item); if (replay) return replay;
    const facts = await this.context(args), items = planningItems(args.items), expected = planningRevision(args.expectedRevision);
    if (planningRevision(args.focusRevision) !== (facts.focus?.revision ?? 0)) throw new Error('近期重点版本已改变，请重新读取并生成建议。');
    if ((facts.plan?.revision ?? 0) !== expected) {
      const completed = await this.replay<DailyWorkPlan>('daily_plan_save', args, item); if (completed) return completed;
      throw new Error('规划版本已改变，请重新读取。');
    }
    this.validateReferences(items, facts);
    const oldWindows = facts.plan?.content.workWindows ?? [];
    const windows = planningWindows(args.workWindows ?? oldWindows, facts.date, facts.timeZone);
    if (taskPlanFingerprint(windows) !== taskPlanFingerprint(oldWindows)) await this.confirmation(args, item);
    const { free, capacityMinutes } = planningAvailability(windows, facts.calendar?.events ?? [], facts.calendar?.fresh ?? false, facts.bufferMinutes);
    const placed = items.filter((row): row is WorkPlanItem & { start: string; end: string } => !!row.start && !!row.end);
    if (placed.some(row => !free.some(window => Date.parse(window.start) <= Date.parse(row.start) && Date.parse(row.end) <= Date.parse(window.end)))) throw new Error('候选时间块没有位于已确认且核验空闲的工作时段内。');
    if (placed.some((row, index) => placed.slice(index + 1).some(other => Date.parse(row.start) < Date.parse(other.end) && Date.parse(other.start) < Date.parse(row.end)))) throw new Error('候选时间块互相重叠。');
    const estimateMinutes = items.reduce((sum, row) => sum + (row.estimateMinutes ?? 0), 0);
    const decisions = planningList(args.decisions ?? [], 3).map(value => planningText(value, '待决策事项'));
    if (capacityMinutes !== null && estimateMinutes > capacityMinutes && !decisions.length) throw new Error('今日重点超过可用时间，请给出取舍选项及影响。');
    const content: DailyWorkPlan = { date: facts.date, timeZone: facts.timeZone, items, decisions, workWindows: windows,
      evidence: { observedAt: facts.observedAt, missing: facts.missing, focusRevision: facts.focus?.revision ?? 0, capacityMinutes, estimateMinutes, unknownEstimates: items.filter(row => row.estimateMinutes === null).length },
      accepted: facts.plan?.content.accepted ?? null };
    return this.deps.repo().save(facts.planId, expected, content, item.id, this.requestKey('daily_plan_save', item, args), [{ id: 'focus', revision: facts.focus?.revision ?? 0 }]);
  }

  async confirmPlan(args: Record<string, unknown>, item: WorkItemRow) {
    const confirmation = await this.confirmation(args, item), replay = await this.replay<DailyWorkPlan>('daily_plan_confirm', args, item); if (replay) return replay;
    const facts = await this.context(args), plan = facts.plan, expected = planningRevision(args.expectedRevision);
    if (!plan || plan.revision !== expected) {
      const completed = await this.replay<DailyWorkPlan>('daily_plan_confirm', args, item); if (completed) return completed;
      throw new Error('请先读取当前每日工作计划并确认其版本。');
    }
    if ((facts.focus?.revision ?? 0) !== plan.content.evidence.focusRevision) throw new Error('近期重点已改变，请先重新规划。');
    const ids = planningList(args.selectedItemIds, 3).map(value => planningText(value, '采纳项编号', 100));
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !plan.content.items.some(row => row.id === id))) throw new Error('请明确选择当前建议中的重点。');
    const items = plan.content.items.filter(row => ids.includes(row.id));
    this.validateReferences(items, facts);
    if (items.some(row => row.start && row.end && !facts.availability.free.some(window => Date.parse(window.start) <= Date.parse(row.start!) && Date.parse(row.end!) <= Date.parse(window.end)))) throw new Error('日程已改变或未完整核验，请先调整候选时间块。');
    const estimateMinutes = items.reduce((sum, row) => sum + (row.estimateMinutes ?? 0), 0), capacityMinutes = facts.availability.capacityMinutes;
    if (capacityMinutes !== null && estimateMinutes > capacityMinutes && (!plan.content.decisions.length || capacityMinutes !== plan.content.evidence.capacityMinutes)) throw new Error('当前可用时间不足，请重新给出取舍选项并讨论后再采纳。');
    const evidence = { observedAt: facts.observedAt, missing: facts.missing, focusRevision: facts.focus?.revision ?? 0, capacityMinutes, estimateMinutes, unknownEstimates: items.filter(row => row.estimateMinutes === null).length };
    const content = { ...plan.content, accepted: { revision: expected + 1, confirmedAt: new Date().toISOString(), confirmation, items, evidence } };
    return this.deps.repo().save(facts.planId, expected, content, item.id, this.requestKey('daily_plan_confirm', item, args), [{ id: 'focus', revision: facts.focus?.revision ?? 0 }]);
  }

  async saveReview(args: Record<string, unknown>, item: WorkItemRow) {
    const replay = await this.replay<DailyWorkReview>('daily_review_save', args, item); if (replay) return replay;
    const facts = await this.context(args), accepted = facts.plan?.content.accepted;
    if (!accepted || args.acceptedRevision !== accepted.revision) throw new Error('请先读取主人采纳的计划版本，再据此复盘。');
    const results: ReviewResult[] = await Promise.all(planningList(args.results, 3).map(async raw => {
      const row = planningObject(raw), planned = accepted.items.find(entry => entry.id === row.itemId);
      if (!planned || !['completed', 'progress', 'blocked', 'changed', 'unknown'].includes(String(row.status))) throw new Error('复盘项必须对应已采纳重点，状态须明确。');
      const quote = typeof row.instruction === 'string' && row.instruction.trim() ? await this.confirmation({ instruction: row.instruction }, item) : null;
      const completed = planned.references.length > 0 && planned.references.every(ref => ref.kind === 'todo'
        ? facts.todos?.fresh && facts.todos.tasks.some(task => task.objectId === ref.id && task.status === 'completed' && !task.stale)
        : facts.work.some(work => work.id === ref.id && work.status === 'completed' && !['pending', 'returned'].includes(work.acceptanceStatus ?? 'none')));
      if (row.status === 'completed' && !completed && !quote) throw new Error('完成结论缺少当前业务状态或本人说明，不能推断为完成。');
      if (['progress', 'blocked', 'changed'].includes(String(row.status)) && !quote) throw new Error('进展和受阻原因缺少本人说明，请标记未知并提出关键问题。');
      return { itemId: planned.id, status: row.status as ReviewResult['status'], detail: planningText(row.detail, '复盘说明'), evidence: quote ? 'owner' : completed && row.status === 'completed' ? 'platform' : 'unknown' };
    }));
    if (results.length !== accepted.items.length || new Set(results.map(row => row.itemId)).size !== results.length) throw new Error('复盘须覆盖每一项已采纳重点且不能重复。');
    const adjustments = planningList(args.adjustments ?? [], 3).map(value => planningText(value, '调整建议'));
    const question = args.question ? planningText(args.question, '关键问题') : null;
    const oldQuestion = facts.review?.content.acceptedRevision === accepted.revision ? facts.review.content.question : null;
    const content: DailyWorkReview = { date: facts.date, timeZone: facts.timeZone, acceptedRevision: accepted.revision, results,
      adjustments, question, questionRepeated: !!question && question === oldQuestion, observedAt: facts.observedAt, missing: facts.missing };
    const row = await this.deps.repo().save(facts.reviewId, planningRevision(args.expectedRevision), content, item.id, this.requestKey('daily_review_save', item, args), [{ id: facts.planId, revision: facts.plan!.revision }]);
    return row;
  }
}
