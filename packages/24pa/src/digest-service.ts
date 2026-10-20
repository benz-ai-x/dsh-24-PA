import { inspectDigestDeliveries } from './digest-supervision.js';
import { noteDerivedContent } from './note-derivation.js';
// Recurring-digest & daily-planning service (F32): 周期服务 (GLOSSARY) — the
// owner-enabled morning/evening/weekly digests, today's overview and daily
// planning behind one deep module. F19 voice delivery extends here. The
// runtime keeps role bindings, the follow-up tick and channel selection.

import type { DshSession, NativeScheduleService } from './host.js';
import type { MemoryStore } from './memory.js';
import type { ChannelContextDeps } from './channel-deps.js';
import type { WorkItemRow, NewOutbox, DigestPlanRow, DigestOccurrenceRow } from './repo.js';
import type { NoteTrustResult } from './note-trust.js';
import { PlanLifecycle } from './plan-lifecycle.js';
import type { ResolvedTaskSkill } from './skills.js';
import { isoDate, hash } from './util.js';
import { DailyPlanning } from './daily-planning.js';
import { localDay } from './calendar-time.js';
import { digestPeriod, type DigestPeriod } from './digest-period.js';
import { captureDigestTrigger } from './digest-trigger.js';

export interface DigestDeps extends ChannelContextDeps {
  startedAt(): string | null;
  reviewQueueCount(): Promise<number>;
  memory(): MemoryStore | null;
  nativeSchedule(): NativeScheduleService | null;
  planChangesAvailable?(): boolean;
  syncCalendarWindow(calendarId: string, from: Date, to: Date): Promise<{ ok: boolean; error?: string }>;
  calendarWrite(item: WorkItemRow, kind: 'create' | 'update' | 'cancel', args: Record<string, unknown>, operationId?: string): Promise<unknown>;
  inspectNoteTrust(noteId: string, versionId: string): Promise<NoteTrustResult>;
  ownerNotification(dedupKey: string, report: string): Promise<NewOutbox | null>;
  /** F40（spec 2.11）：任务 skill 目录（宿主挂载时含工作区自定义）。 */
  skillCatalog(): import('./skills.js').SkillCatalog;
  waitingFollowups?(): import('./waiting-followups.js').WaitingFollowups;
}

export const DIGEST_UNCONFIRMED_GRACE_MS = 10 * 60 * 1000;

/** 口播正文上限（spec 2.2）：超限截断并在语音内播报提示。 */
export const DIGEST_SPOKEN_MAX_CHARS = 1200;

/**
 * 口播变体（F19）：剥离只对阅读有意义的元数据——同步时间戳、来源括注、
 * 文档链接、数据缺失清单与页脚——再截断到上限并播报提示。纯文本变换，
 * 不依赖 facts 结构，对 renderDigest 的最终输出做稳定降维。
 */
export function buildSpokenVariant(report: string): string {
  const spoken: string[] = [];
  let dropping = false;
  for (const raw of report.split('\n')) {
    const line = raw.trim();
    if (line === '三、数据缺失') {
      dropping = true; // 缺失清单与页脚是给主人核对的元数据，不进语音（缺失节后即报告结尾）
      continue;
    }
    if (dropping) continue;
    if (line.startsWith('来源：')) continue; // 页脚
    const out = line
      .replace(/（日历同步于[^）]*）/g, '')
      .replace(/（审核于[^）]*）/g, '')
      .replace(/（来源：[^）]*）/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .trimEnd();
    spoken.push(out);
  }
  const text = spoken.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= DIGEST_SPOKEN_MAX_CHARS) return text;
  return `${text.slice(0, DIGEST_SPOKEN_MAX_CHARS)}\n……正文较长，语音版到此截断，完整内容请看随后的文字版。`;
}

export type DigestFacts = {
    period?: DigestPeriod & { observedAt: string; late: boolean; snapshotNote: string; completionTimeNote: string };
    nextWeek?: { calendar: DigestFacts['calendar']; tasks: DigestFacts['tasksDue'] };
    calendar: { fresh: boolean; syncedAt: string | null; events: { summary: string; start: string; end: string; allDay: boolean }[] };
    tasksDue: { guid: string; summary: string; dueAt: string | null; plannedAt: string | null; estimateMinutes: number | null; overdue: boolean }[];
    tasksCompletedToday: { guid: string; summary: string }[];
    waiting: { id: string; title: string; checkpointAt: string | null }[];
    reviewQueueCount: number;
    reviewedNotes: { noteId: string; version: number; summary: string; docUrl: string | null; reviewedAt: string | null }[];
    projects: { id: string; name: string; completed: number; total: number }[];
    missing: string[];
};

export class DigestService {
  private readonly planning: DailyPlanning;
  readonly plans: PlanLifecycle;
  private paused = false;
  private supervising: Promise<unknown> | null = null;
  private readonly admitted = new Set<Promise<unknown>>();
  async pause(): Promise<void> {
    this.paused = true;
    await Promise.allSettled([...this.admitted, ...(this.supervising ? [this.supervising] : [])]);
    await this.plans.pause();
  }
  /** Register before the first read/skill load. Binding cannot replace any
   * dependency until the whole admitted request has finished. */
  private withPlanWork<T>(work: () => Promise<T>): Promise<T> {
    if (this.paused || this.deps.planChangesAvailable?.() === false) return Promise.reject(new Error('工作区正在切换或停止，暂不接受计划变更。'));
    const result = Promise.resolve().then(work);
    this.admitted.add(result);
    void result.finally(() => this.admitted.delete(result)).catch(() => {});
    return result;
  }
  resume(): void { this.paused = false; this.plans.resumeAdmission(); }
  constructor(private readonly deps: DigestDeps) {
    this.planning = new DailyPlanning(deps);
    this.plans = new PlanLifecycle({ repo: () => deps.repos().digests, native: () => deps.nativeSchedule(), available: () => deps.planChangesAvailable?.() ?? true });
  }
  recoverPlans() { return this.plans.recover(); }

  /** Called by delegation before a Worker can start; never accepts model args. */
  async admit(item: WorkItemRow, session: DshSession, scheduleOnly = false): Promise<void> {
    if (item.parent_session_id !== session.id) throw new Error('事项与触发会话不一致，不能保存计划来源。');
    const source = captureDigestTrigger(session, scheduleOnly);
    if (source) await this.deps.repos().digests.recordWorkSource(item.id, source);
  }

  /** Local-date window key for a plan kind (morning/evening share the date, weekly uses ISO week). */
  digestWindowKey(kind: string, timeZone: string, now = new Date()): string {
    const day = localDay(now, timeZone);
    if (kind !== 'weekly') return day.date;
    const date = new Date(`${day.date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const jan1 = Date.UTC(date.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((date.getTime() - jan1) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  /**
   * Enable a smart plan (P24/P25): one durable business row plus one native
   * Schedule task bound to the fixed access session. Schedule persistence is
   * the enqueue; model work and platform acceptance are tracked separately on
   * the occurrence row.
   */
  digestEnable(args: Record<string, unknown>, intentKey?: string): Promise<unknown> {
    return this.withPlanWork(() => this.enablePlan(args, intentKey));
  }
  private async enablePlan(args: Record<string, unknown>, intentKey?: string): Promise<unknown> {
    const kind = String(args.kind ?? '');
    if (!['morning', 'evening', 'weekly', 'once'].includes(kind)) throw new Error('计划类型：morning/evening/weekly（daily/weekly 定时）或 once（一次性，演示与测试）。');
    const timeZone = String(args.timeZone ?? this.deps.config().timeZone);
    const schedule = this.deps.nativeSchedule();
    if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务，无法建立智能计划。');
    // F40/F41（spec 2.11）：绑定任务 skill；缺省按类型映射内置件，点名须在目录中（模板/agent 双轨均可绑定）。
    const skill = args.skill ? String(args.skill) : kind === 'once' ? 'digest-morning' : `digest-${kind}`;
    await this.requireSkill(skill);
    const title = { morning: '晨报', evening: '晚间回顾', weekly: '每周回顾', once: '一次性简报' }[kind]!;
    const id = kind === 'once'
      ? `dig-once-${hash(this.deps.workspace()!.statePath + JSON.stringify({ intentKey: intentKey ?? null, kind, at: args.at ?? null, afterSeconds: args.afterSeconds ?? null, skill, voice: args.voice === true })).slice(0, 24)}`
      : `dig-${kind}-${hash(this.deps.workspace()!.statePath + kind).slice(0, 8)}`;
    let request: Record<string, unknown>;
    if (kind === 'once') {
      const seconds = Number(args.afterSeconds ?? 0);
      const at = args.at ? new Date(String(args.at)) : null;
      if (at && !Number.isNaN(at.getTime())) request = { at: at.toISOString(), title: `[24PA] ${title}` };
      else if (Number.isInteger(seconds) && seconds >= 1) request = { after_seconds: seconds, title: `[24PA] ${title}` };
      else throw new Error('once 计划需要 afterSeconds（秒）或 at（ISO 时间）。');
    } else {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(String(args.time ?? ''))) throw new Error(`${title}需要本地时间 HH:mm:ss（工作区时区 ${timeZone}）。`);
      const weekdays = Array.isArray(args.weekdays) ? (args.weekdays as number[]) : undefined;
      if (kind === 'weekly' && (!weekdays?.length || weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7))) throw new Error('weekly 计划需要 weekdays（ISO 1–7）。');
      request = kind === 'weekly'
        ? { weekly: { time: String(args.time), time_zone: timeZone, weekdays: [...new Set(weekdays!)].sort() }, title: `[24PA] ${title}` }
        : { daily: { time: String(args.time), time_zone: timeZone }, title: `[24PA] ${title}` };
    }
    const plan = await this.plans.enable({
      id,
      kind,
      title,
      session_id: this.deps.accessSessionId()!,
      schedule_spec: { ...request, time_zone: timeZone },
      last_window: null,
      // F19：开启时可选语音版（引擎取工作区 tts 配置，默认文本）。
      voice: args.voice === true,
      skill,
    });
    return {
      planId: plan.id,
      skill,
      scheduleId: plan.schedule_id,
      nextDueAt: plan.schedule_spec.at ?? null,
      message: `${title}计划已开启（原生 Schedule 持久入队，绑定飞书接入会话）；到点唤醒 Lead 委派简报 Worker。`,
    };
  }

  digestControl(args: Record<string, unknown>): Promise<unknown> {
    return this.withPlanWork(() => this.controlPlan(args));
  }
  private async controlPlan(args: Record<string, unknown>): Promise<unknown> {
    const plan = await this.deps.repos().digests.getPlan(String(args.planId ?? ''));
    if (!plan) throw new Error('计划不存在；请先用 digest_enable 开启。');
    const op = String(args.op ?? '');
    if (plan.kind === 'waiting_followup' && !['pause', 'stop'].includes(op)) throw new Error('等待检查点请用 waiting_control 管理，不能更换任务 skill 或执行规则。');
    const schedule = this.deps.nativeSchedule();
    if (op === 'pause' || op === 'stop') {
      const { plan: stopped, warning: nativeWarning } = await this.plans.stop(plan.id, op === 'pause' ? 'paused' : 'stopped');
      return { planId: plan.id, status: stopped.status, nativeWarning,
        message: `${op === 'pause' ? '计划已暂停' : '计划已停止'}（业务历史保留）${nativeWarning ? `；原生任务待清理：${nativeWarning}` : ''}。` };
    }
    if (op === 'skill') {
      // F40/F41（spec 2.11）：per-plan 任务 skill 切换（须在目录中，双轨可绑）。
      const skill = String(args.skill ?? '');
      await this.requireSkill(skill);
      await this.plans.configure(plan.id, { skill });
      return { planId: plan.id, skill, message: `本计划任务 skill 已切换为 ${skill}。` };
    }
    if (op === 'voice') {
      // F19（spec 2.3）：per-plan 语音开关（引擎取工作区 tts 配置）。
      const voice = args.voice === true;
      await this.plans.configure(plan.id, { voice });
      return { planId: plan.id, voice, message: voice ? '本计划改为语音版＋全文文本兜底。' : '本计划改为纯文本。' };
    }
    if (op === 'resume') {
      const resumed = await this.plans.resume(plan.id);
      return { planId: plan.id, scheduleId: resumed.schedule_id, message: '计划已恢复（重新入队）。' };
    }
    if (op === 'adjust') {
      // Compare-and-update the same native task; retain business history.
      if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务。');
      if (plan.kind === 'waiting_followup') throw new Error('等待检查点请用 waiting_control 调整，不能换成简报计划。');
      const kind = String(args.kind ?? plan.kind);
      if (!['morning', 'evening', 'weekly', 'once'].includes(kind)) throw new Error('调整后的计划类型无效。');
      const timeZone = String(args.timeZone ?? this.deps.config().timeZone);
      let request: Record<string, unknown>;
      if (kind === 'once') {
        const seconds = Number(args.afterSeconds ?? 0);
        const at = args.at ? new Date(String(args.at)) : null;
        if (at && !Number.isNaN(at.getTime())) request = { at: at.toISOString() };
        else if (Number.isInteger(seconds) && seconds >= 1) request = { after_seconds: seconds };
        else throw new Error('once 调整需要 afterSeconds 或 at。');
      } else {
        if (!/^\d{2}:\d{2}:\d{2}$/.test(String(args.time ?? ''))) throw new Error('调整需要新的本地时间 HH:mm:ss。');
        const weekdays = Array.isArray(args.weekdays) ? (args.weekdays as number[]) : undefined;
        request = kind === 'weekly'
          ? { weekly: { time: String(args.time), time_zone: timeZone, weekdays: [...new Set(weekdays ?? [1])].sort() } }
          : { daily: { time: String(args.time), time_zone: timeZone } };
      }
      const adjusted = await this.plans.adjust(plan.id, { ...request, time_zone: timeZone }, kind);
      return { planId: plan.id, scheduleId: adjusted.schedule_id, message: '计划已按新安排调整（同一计划保留历史，只影响以后）。' };
    }
    throw new Error('未知计划操作（pause/resume/stop/adjust/voice/skill）。');
  }

  async digestList(): Promise<unknown> {
    const plans = await this.deps.repos().digests.listPlans();
    const view = [];
    for (const plan of plans) {
      const occurrences = await this.deps.repos().digests.occurrencesOf(plan.id, 3);
      view.push({
        planId: plan.id,
        kind: plan.kind,
        title: plan.title,
        status: plan.status,
        scheduleId: plan.schedule_id,
        schedule: plan.schedule_spec,
        pendingChange: plan.lifecycle ? { operation: plan.lifecycle.operation, phase: plan.lifecycle.phase, error: plan.lifecycle.error ?? null } : null,
        lastWindow: plan.last_window,
        voice: plan.voice,
        skill: plan.skill,
        recent: occurrences.map(o => ({ window: o.window_key, status: o.status, completedAt: isoDate(o.completed_at) })),
      });
    }
    return { plans: view };
  }

  /** Gather planning facts once: calendar (with freshness), tasks, waiting, review queue, preferences. */
  private async planningFacts(now: Date, context = digestPeriod('morning', this.deps.config().timeZone, now, 'manual')): Promise<DigestFacts> {
    const dayStart = new Date(context.from), dayEnd = new Date(context.to), calendarId = this.planning.calendarId();
    const missing: string[] = [];
    const observe = async (from: Date, to: Date) => {
      const sync = await this.deps.syncCalendarWindow(calendarId, from, to).catch(error => ({ ok: false, error: (error as Error).message }));
      const events = await this.deps.repos().calendar.eventsIn(calendarId, from, to);
      const state = await this.deps.repos().calendar.getSync(calendarId);
      if (!sync.ok) missing.push(`日历同步失败（${from.toISOString()} 至 ${to.toISOString()}，${sync.error ?? '未知'}）：以下为投影，可能过期`);
      return { fresh: sync.ok, syncedAt: isoDate(state?.last_synced_at ?? null), events: events.map(e => ({ summary: e.summary,
        start: new Date(Math.max(e.start_time.getTime(), from.getTime())).toISOString(), end: new Date(Math.min(e.end_time.getTime(), to.getTime())).toISOString(), allDay: e.is_all_day })) };
    };
    const calendar = await observe(dayStart, dayEnd);
    const tasks = await this.deps.repos().tasks.all();
    const mapTask = (t: typeof tasks[number]) => ({ guid: t.task_guid, summary: t.summary, dueAt: isoDate(t.due_at), plannedAt: isoDate(t.planned_at), estimateMinutes: t.estimate_minutes,
      overdue: !!(t.due_at && new Date(t.due_at).getTime() < new Date(context.anchorAt).getTime()) });
    const todayTasks = tasks.filter(t => t.status === 'open' && ((t.due_at && t.due_at < dayEnd) || (t.planned_at && t.planned_at >= dayStart && t.planned_at < dayEnd)));
    const completedToday = tasks.filter(t => t.status === 'completed' && t.last_synced_at && t.last_synced_at >= dayStart && t.last_synced_at < dayEnd);
    let nextWeek: DigestFacts['nextWeek'];
    if (context.nextTo) {
      const nextEnd = new Date(context.nextTo);
      nextWeek = { calendar: await observe(dayEnd, nextEnd), tasks: tasks.filter(t => t.status === 'open' &&
        ((t.due_at && t.due_at >= dayEnd && t.due_at < nextEnd) || (t.planned_at && t.planned_at >= dayEnd && t.planned_at < nextEnd))).map(mapTask) };
    }
    const waiting = await this.deps.repos().waiting.list('waiting');
    const reviewQueueCount = await this.deps.reviewQueueCount().catch(() => -1);
    const reviewedNotes: { noteId: string; version: number; summary: string; docUrl: string | null; reviewedAt: string | null }[] = [];
    try {
      const recent = await this.deps.repos().notes.recentApproved(5);
      for (const row of recent) {
        if (reviewedNotes.length >= 3) break;
        const derived = noteDerivedContent(row);
        if (derived.derivedStatus === 'needs_rebuild') { missing.push(`笔记 ${row.note_id} v${row.version} 摘要/候选尚未重建或缺少同源证明，未引用旧派生资料`); continue; }
        // Overview facts must be currently valid: re-verify the live document
        // so an externally edited note stops being presented as confirmed (P35).
        try {
          const trust = await this.deps.inspectNoteTrust(row.note_id, row.id);
          if (trust.currentValidity === 'unknown') throw new Error(trust.reason ?? '核验结果未知');
          if (trust.currentValidity !== 'matches') continue;
        } catch (error) {
          missing.push(`已审笔记 ${row.note_id} v${row.version} 暂无法核验（${(error as Error).message}），未列入概览`);
          continue;
        }
        reviewedNotes.push({
          noteId: row.note_id,
          version: row.version,
          summary: String(derived.summary ?? '').slice(0, 60),
          docUrl: row.doc_url,
          reviewedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
        });
      }
    } catch {
      missing.push('已审笔记列表读取失败；概览未包含该部分，不按零处理');
    }
    const projects: { id: string; name: string; completed: number; total: number }[] = [];
    try {
      for (const project of await this.deps.repos().projects.listIdNames()) {
        try {
          const projectTasks = await this.deps.repos().projects.tasksOf(project.id);
          projects.push({ id: project.id, name: project.name, completed: projectTasks.filter(task => task.status === 'completed').length, total: projectTasks.length });
        } catch { missing.push(`项目「${project.name}」任务读取失败，未按零处理`); }
      }
    } catch { missing.push('项目列表读取失败，概览未包含该部分，不按零处理'); }
    return {
      period: { ...context, observedAt: now.toISOString(), late: now >= dayEnd, snapshotNote: '任务、等待、项目与笔记反映查询时的当前投影，并非原发生时刻的完整历史快照。', completionTimeNote: '完成任务按投影最后同步时间筛选，不能作为精确完成时间。' },
      calendar, nextWeek,
      tasksDue: todayTasks.map(mapTask),
      tasksCompletedToday: completedToday.map(t => ({ guid: t.task_guid, summary: t.summary })),
      waiting: waiting.map(w => ({ id: w.id, title: w.title, checkpointAt: w.checkpoint_at?.toISOString() ?? null })),
      reviewQueueCount,
      reviewedNotes,
      projects,
      missing,
    };
  }

  /**
   * Worker-side digest build (P24/P25): claims its admission window idempotently,
   * assembles a sourced facts-vs-suggestions report, and ships it through the
   * outbox. Never writes tasks, calendar, or memory; nothing auto-postpones.
   */
  async digestBuild(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const planId = String(args.planId ?? '');
    const plan = await this.deps.repos().digests.getPlan(planId);
    if (!plan) throw new Error(`计划 ${planId} 不存在。`);
    const boundRun = await this.deps.repos().digests.runForWorkItem(plan.id, item.id);
    if (boundRun && this.wasDelivered(boundRun)) return this.completedDelivery(item, plan, boundRun);
    if (plan.kind === 'meeting_prep') throw new Error('会前准备计划请用 meeting_prep_build 生成准备包。');
    if (plan.status !== 'active') throw new Error(`计划 ${planId} 当前状态为 ${plan.status}，不生成简报。`);
    const originalReport = boundRun && this.savedReport(boundRun);
    if (originalReport) return this.restoreSavedReport(item, plan, boundRun!, originalReport);
    const boundSkill = await this.boundSkillOrThrow(plan);
    if (boundRun && !boundRun.time_context && !this.savedReport(boundRun)) throw new Error('历史运行缺少已固定的事实区间，原记录保留待核对；请明确重新运行，不能按当前计划猜测。');
    let timeContext = boundRun?.time_context ?? undefined;
    let requestedWindow = boundRun?.window_key;
    if (!requestedWindow || !timeContext) {
      const admitted = await this.deps.repos().workItems.get(item.id);
      if (!admitted?.created_at || !Number.isFinite(new Date(admitted.created_at).getTime())) {
        throw new Error('本事项缺少可确认的准入时间，不能猜测运行窗口。');
      }
      const source = await this.deps.repos().digests.workSource(item.id);
      if (!source || source.sessionId !== admitted.parent_session_id) {
        throw new Error('历史事项缺少可核验的触发来源，不能按执行日期猜测窗口；原记录保留，请重新委派计划任务。');
      }
      let occurrenceAt: Date;
      if (source.kind === 'schedule') {
        const delivery = source.deliveries.find(row => row.scheduleId === plan.schedule_id);
        if (source.sessionId !== plan.session_id || !delivery || !Number.isFinite(Date.parse(delivery.occurrenceAt))) {
          throw new Error('本事项的宿主触发无法匹配当前计划（计划可能已调整），请按当前计划重新委派，不能猜测窗口。');
        }
        if (plan.schedule_generation && delivery.generation !== plan.schedule_generation) throw new Error('本事项来自旧安排或无法核验安排代次；原记录保留待核对，不能套用新计划区间。');
        occurrenceAt = new Date(delivery.occurrenceAt);
      } else if (source.kind === 'admission') {
        // A current, explicitly captured non-Schedule turn is manual work.
        occurrenceAt = new Date(admitted.created_at);
      } else {
        throw new Error('事项触发来源无法核验，请重新委派计划任务。');
      }
      const timeZone = plan.schedule_spec?.daily?.time_zone ?? plan.schedule_spec?.weekly?.time_zone ?? plan.schedule_spec?.time_zone ?? this.deps.config().timeZone;
      requestedWindow ??= this.digestWindowKey(plan.kind, timeZone, occurrenceAt);
      timeContext = digestPeriod(boundSkill?.kind ?? plan.kind, timeZone, occurrenceAt, source.kind === 'schedule' ? 'schedule' : 'manual');
    }
    const { created, row } = await this.deps.repos().digests.claimRun({ planId: plan.id, windowKey: requestedWindow, workItemId: item.id, timeContext });
    const windowKey = row.window_key;
    if (!created && this.wasDelivered(row)) {
      return { planId, windowKey, reused: true, status: row.status, message: `本窗口（${windowKey}）简报已生成，不重复发布。` };
    }
    const savedReport = this.savedReport(row);
    if (savedReport) return this.restoreSavedReport(item, plan, row, savedReport);
    // F41（spec 2.11）：agent 轨＝任务指令交接——Worker（模型）亲自按 skill 正文
    // 与事实生成简报，再经 digest_deliver 交付；模板轨才走确定性组装。
    if (boundSkill?.track === 'agent') {
      const facts = plan.kind === 'waiting_followup' ? await this.deps.waitingFollowups!().facts(plan) : await this.planningFacts(new Date(), row.time_context!);
      return {
        planId,
        windowKey,
        agentTrack: true,
        skill: { name: boundSkill.name, content: boundSkill.content },
        facts,
        message: 'agent 轨：请严格按上述任务指令与完成标准生成简报全文（纯文本），在本事项内调用 digest_deliver（planId、report）交付当前窗口；未达完成标准时在 report 开头如实说明并交付。',
      };
    }
    const { facts, report, outboxKey } = await this.buildAndDeliver(plan, windowKey, row.id, boundSkill);
    await this.deps.repos().workItems.update(item.id, { result_ref: { planId: plan.id, windowKey, outboxKey } });
    return { planId, windowKey, outboxKey, message: '简报已生成并入发送队列（Outbox 持久，平台接受状态以发送记录为准）。' };
  }

  private async restoreSavedReport(item: WorkItemRow, plan: DigestPlanRow, row: DigestOccurrenceRow, report: string) {
    const outboxKey = await this.deliverReport(plan, row.window_key, row.id, report);
    await this.deps.repos().workItems.update(item.id, { result_ref: { planId: plan.id, windowKey: row.window_key, outboxKey } });
    return { planId: plan.id, windowKey: row.window_key, outboxKey, message: '已恢复保存的简报并入发送队列，未重新生成内容。' };
  }

  /** F40：点名 skill 必须在目录中；报错携带可用清单（spec AC）。 */
  private async requireSkill(skill: string): Promise<ResolvedTaskSkill> {
    try {
      const resolved = await this.deps.skillCatalog().resolve(skill, ['pa24_work', 'pa24_memory']);
      if (resolved.track === 'template' && !['morning', 'evening', 'weekly'].includes(resolved.kind ?? '')) {
        throw new Error(`简报不支持此模板种类：${resolved.kind ?? '未声明'}。`);
      }
      return resolved;
    }
    catch (error) { throw new Error(`任务 skill 不存在或不可执行：${skill}；${(error as Error).message}`); }
  }

  private async boundSkillOrThrow(plan: DigestPlanRow): Promise<ResolvedTaskSkill | null> {
    return plan.skill ? this.requireSkill(plan.skill) : null;
  }

  /**
   * F40（spec 2.11）：按 plan.skill 解析渲染口径并投递。内置模板轨 skill 的
   * metadata.kind 决定 renderDigest 口径（如 morning 计划绑 digest-weekly 则按
   * 周报渲染）；agent 轨执行随 F41——在此 fail-loud，不静默换轨。
   */
  private async buildAndDeliver(plan: import('./repo.js').DigestPlanRow, windowKey: string, occurrenceId: string, boundSkill: import('./skills.js').TaskSkill | null): Promise<{ facts: DigestFacts; report: string; outboxKey: string }> {
    const context = (await this.deps.repos().digests.occurrence(occurrenceId))?.time_context;
    if (!context) throw new Error('运行缺少可核验的事实区间，请核对原发生记录，不能按当前时间补写旧报告。');
    const renderKind = context.kind;
    const facts = await this.planningFacts(new Date(), context);
    const report = this.renderDigest({ ...plan, kind: renderKind }, windowKey, facts);
    const outboxKey = await this.deliverReport(plan, windowKey, occurrenceId, report);
    return { facts, report, outboxKey };
  }

  private wasDelivered(row: DigestOccurrenceRow): boolean {
    return (row.status === 'model_done' || row.status === 'sent') && !!row.outbox_key;
  }

  private savedReport(row: DigestOccurrenceRow): string | null {
    if (row.status !== 'model_done' && row.status !== 'sent') return null;
    const report = typeof row.report === 'string' ? row.report : row.report?.report;
    return typeof report === 'string' && report.trim() ? report : null;
  }

  /** Template/agent/meeting preparation share one atomic completion protocol. */
  private async deliverReport(plan: DigestPlanRow, windowKey: string, occurrenceId: string, report: string): Promise<string> {
    if (plan.kind === 'waiting_followup') await this.deps.waitingFollowups!().beforeDelivery(plan);
    const config = this.deps.config();
    const outboxKey = `digest:${occurrenceId}`;
    const notifications: NewOutbox[] = [];
    // Resolve remote owner identity before entering the short ledger transaction.
    const textNotification = await this.deps.ownerNotification(outboxKey, report);
    if (textNotification) {
      // F19（spec 2.3）：plan.voice 且引擎可用时，先入语音行（口播正文、投递时
      // 现场合成），全文文本行紧随其后兜底。wecom 通知通道与 tts.engine=none
      // 都按降级处理——只发文本，可观测告警，不中断。
      if (plan.voice) {
        if (config.notifyChannel === 'wecom') {
          console.warn('[pa24] 语音简报降级为文本：通知通道为企微（wecom 语音 parity 后置）。');
        } else if (config.tts.engine === 'none') {
          console.warn('[pa24] 语音简报降级为文本：未配置 TTS 引擎（AGENTS.md tts.engine=none）。');
        } else {
          notifications.push({
            dedupKey: `${outboxKey}:voice`,
            channel: 'feishu',
            target: config.ownerOpenId,
            kind: 'audio',
            content: { text: buildSpokenVariant(report) },
          });
        }
      }
      notifications.push(textNotification);
    }
    await this.deps.repos().digests.completeRun({ planId: plan.id, occurrenceId, report, notifications });
    return outboxKey;
  }

  /** Used by the meeting preparation path after its source recheck. */
  async deliverPrepared(plan: DigestPlanRow, occurrence: DigestOccurrenceRow, report: string): Promise<string> {
    return this.deliverReport(plan, occurrence.window_key, occurrence.id, this.savedReport(occurrence) ?? report);
  }

  /**
   * F41（spec 2.11）：agent 轨交付——Worker 按任务指令生成简报全文后经此入队。
   * 幂等：窗口已 model_done 则如实返回不重复发布；report 为空拒绝。
   */
  private async completedDelivery(item: WorkItemRow, plan: DigestPlanRow, row: DigestOccurrenceRow): Promise<unknown> {
    await this.deps.repos().workItems.update(item.id, { result_ref: { planId: plan.id, windowKey: row.window_key, outboxKey: row.outbox_key } });
    return { planId: plan.id, windowKey: row.window_key, outboxKey: row.outbox_key, reused: true, message: '本窗口已交付，不重复发布。' };
  }

  async digestDeliver(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const planId = String(args.planId ?? '');
    const plan = await this.deps.repos().digests.getPlan(planId);
    if (!plan) throw new Error(`计划 ${planId} 不存在。`);
    const report = String(args.report ?? '').trim();
    if (!report) throw new Error('digest_deliver 需要携带 report（简报全文）。');
    const pending = await this.deps.repos().digests.runForWorkItem(plan.id, item.id);
    if (pending && this.wasDelivered(pending)) return this.completedDelivery(item, plan, pending);
    if (plan.status !== 'active') throw new Error(`计划 ${planId} 已暂停或停止，本次结果未发布。`);
    const bound = await this.boundSkillOrThrow(plan);
    if (bound?.track !== 'agent') {
      throw new Error(`计划 ${planId} 未绑定 agent 轨任务 skill（当前 ${plan.skill || '未绑定'}）；digest_deliver 仅用于 agent 轨交付。`);
    }
    if (!pending) throw new Error(`本事项没有可确认归属的运行窗口；请在本事项调用 digest_build 后再交付，不能使用其他事项的最新窗口。`);
    let outboxKey: string;
    try { outboxKey = await this.deliverReport(plan, pending.window_key, pending.id, this.savedReport(pending) ?? report); }
    catch (error) {
      // A concurrent successful delivery may have consumed a one-shot waiting
      // checkpoint while this call awaited preferences or recipient identity.
      const settled = await this.deps.repos().digests.runForWorkItem(plan.id, item.id);
      if (settled && this.wasDelivered(settled)) return this.completedDelivery(item, plan, settled);
      throw error;
    }
    await this.deps.repos().workItems.update(item.id, { result_ref: { planId: plan.id, windowKey: pending.window_key, outboxKey } });
    return { planId, windowKey: pending.window_key, outboxKey, message: '简报已交付并入发送队列。' };
  }

  /**
   * F40「立即运行一次」：以 manual-<ts> 窗口键执行当前 skill 口径，不占用当日
   * 计划窗口（08:00 照常触发），不落 WorkItem（面板发起，无事项上下文）。
   */
  digestRunNow(planId: string): Promise<unknown> {
    const admittedAt = new Date();
    return this.withPlanWork(() => this.runPlanNow(planId, admittedAt));
  }
  private async runPlanNow(planId: string, admittedAt: Date): Promise<unknown> {
    const plan = await this.deps.repos().digests.getPlan(planId);
    if (!plan) throw new Error(`计划 ${planId} 不存在。`);
    if (plan.kind === 'waiting_followup') throw new Error('等待跟进请经原检查点的 digest Worker 办理；调整时间用 waiting_control。');
    if (plan.kind === 'meeting_prep') throw new Error('会前准备请经对话委派 calendar Worker，先复查会议来源。');
    if (plan.status !== 'active') throw new Error(`计划 ${planId} 当前状态为 ${plan.status}，不生成简报。`);
    const windowKey = `manual-${admittedAt.getTime()}`;
    const bound = await this.boundSkillOrThrow(plan);
    if (bound?.track === 'agent') {
      throw new Error(`计划绑定 agent 轨 skill ${plan.skill}；「立即运行一次」经对话发起（委派 digest Worker），面板直跑仅支持模板轨。`);
    }
    const { created, row } = await this.deps.repos().digests.claimRun({ planId: plan.id, windowKey, timeContext: digestPeriod(bound?.kind ?? plan.kind, plan.schedule_spec?.daily?.time_zone ?? plan.schedule_spec?.weekly?.time_zone ?? plan.schedule_spec?.time_zone ?? this.deps.config().timeZone, admittedAt, 'manual') });
    if (!created && this.wasDelivered(row)) {
      return { planId, windowKey, reused: true, message: '本次手动运行已生成过，不重复发布。' };
    }
    const { outboxKey } = await this.buildAndDeliver(plan, windowKey, row.id, bound);
    return { planId, windowKey, outboxKey, message: '已生成并入发送队列（手动运行不占用计划窗口）。' };
  }

  renderDigest(
    plan: { kind: string; title: string },
    windowKey: string,
    facts: DigestFacts,
  ): string {
    const lines: string[] = [];
    lines.push(`【${plan.title}】窗口 ${windowKey}`);
    const periodLabel = plan.kind === 'weekly' ? '本周' : '本期';
    if (facts.period) {
      lines.push(`事实区间：${facts.period.localFrom} 至 ${facts.period.localTo}（不含结束日，${facts.period.timeZone}）；实际查询：${facts.period.observedAt}`);
      lines.push(`${facts.period.late ? '迟到运行：保留原发生区间；' : ''}任务为当前投影，等待/项目/笔记为查询时当前状态，不代表历史时点快照。`);
    }
    lines.push('');
    lines.push('一、事实（来自实际对象）');
    if (facts.calendar.events.length) {
      lines.push(`· 日程 ${facts.calendar.events.length} 项（日历同步于 ${facts.calendar.syncedAt ?? '无记录'}${facts.calendar.fresh ? '' : '，本次同步失败可能过期'}）：`);
      for (const event of facts.calendar.events.slice(0, 8)) lines.push(`  - ${event.summary} ${event.start} → ${event.end}${event.allDay ? '（全天）' : ''}`);
    } else {
      lines.push(`· ${periodLabel}无日程（日历同步于 ${facts.calendar.syncedAt ?? '无记录'}${facts.calendar.fresh ? '' : '，本次同步失败可能过期'}）`);
    }
    if (facts.tasksDue.length) {
      lines.push(`· 待办 ${facts.tasksDue.length} 项（截止与计划时间分开记录）：`);
      for (const task of facts.tasksDue.slice(0, 10)) {
        lines.push(`  - ${task.summary}${task.dueAt ? `，截止 ${task.dueAt}` : ''}${task.plannedAt ? `，计划 ${task.plannedAt}` : ''}${task.estimateMinutes != null ? `，估时 ${task.estimateMinutes} 分钟` : ''}${task.overdue ? '，【已逾期】' : ''}`);
      }
    } else {
      lines.push(`· ${periodLabel}没有到期或计划中的待办`);
    }
    if (plan.kind !== 'morning' && facts.tasksCompletedToday.length) {
      lines.push(`· ${periodLabel}同步到完成状态 ${facts.tasksCompletedToday.length} 项（来源：任务投影的同步时间，非精确完成时刻）：${facts.tasksCompletedToday.map(t => t.summary).join('、')}`);
    }
    if (facts.nextWeek) {
      lines.push(`· 下周日历 ${facts.nextWeek.calendar.events.length} 项（同步于 ${facts.nextWeek.calendar.syncedAt ?? '无记录'}${facts.nextWeek.calendar.fresh ? '' : '，可能过期'}）：`);
      for (const event of facts.nextWeek.calendar.events.slice(0, 12)) lines.push(`  - ${event.summary} ${event.start} → ${event.end}`);
      lines.push(`· 下周到期/计划任务 ${facts.nextWeek.tasks.length} 项：${facts.nextWeek.tasks.map(t => t.summary).join('、') || '无已知安排'}`);
    }
    if (facts.waiting.length) {
      lines.push(`· 等待事项 ${facts.waiting.length} 项：${facts.waiting.map(w => `${w.title}${w.checkpointAt ? `（检查点 ${w.checkpointAt}）` : ''}`).join('；')}`);
    } else if (plan.kind !== 'morning') {
      lines.push('· 没有进行中的等待事项');
    }
    if (facts.reviewQueueCount > 0) lines.push(`· 待审手写笔记 ${facts.reviewQueueCount} 份`);
    else if (facts.reviewQueueCount === 0) lines.push('· 没有待审手写笔记');
    else lines.push('· 待审笔记数暂时无法读取（不按零处理）');
    for (const noteItem of facts.reviewedNotes) lines.push(`· 已审核笔记 ${noteItem.noteId} v${noteItem.version}「${noteItem.summary}」${noteItem.docUrl ? ` ${noteItem.docUrl}` : ''}${noteItem.reviewedAt ? `（审核于 ${noteItem.reviewedAt}）` : ''}`);
    for (const project of facts.projects) lines.push(`· 项目「${project.name}」：${project.completed}/${project.total} 完成（来源：飞书任务状态）`);
    lines.push('');
    lines.push('二、建议（推断，需你选定）');
    if (plan.kind === 'morning') {
      const overloaded = facts.tasksDue.reduce((sum, t) => sum + (t.estimateMinutes ?? 30), 0) > 6 * 60;
      lines.push(`· 今日重点建议：${facts.tasksDue.slice(0, 3).map(t => t.summary).join('、') || '（无到期任务，可从项目下一步选择）'}${overloaded ? '；注意：按估时合计已超过 6 小时，建议延后部分任务（不会自动延期）' : ''}`);
    } else {
      const overdue = facts.tasksDue.filter(t => t.overdue);
      lines.push(`· 下一步建议：${overdue.length ? `优先处理 ${overdue.slice(0, 3).map(t => t.summary).join('、')}（已逾期，是否延期由你决定）` : '无逾期任务，可推进项目下一步或安排明日重点'}`);
    }
    if (facts.missing.length) {
      lines.push('');
      lines.push('三、数据缺失');
      for (const miss of facts.missing) lines.push(`· ${miss}`);
    }
    lines.push('');
    lines.push('来源：飞书日历/任务投影、24私助工作账本（等待/待审/项目）；事实与建议已分开，未自动修改任何任务、日程或记忆。');
    return lines.join('\n');
  }

  /**
   * Delivery supervision (P24): a native delivery with no attributable
   * occurrence after the grace window marks the plan unconfirmed-paused; the
   * panel exposes the same bounded check with an overridable grace.
   */
  superviseDigests(graceMs: number = DIGEST_UNCONFIRMED_GRACE_MS): Promise<unknown> {
    if (this.supervising) return this.supervising;
    if (this.paused || this.deps.planChangesAvailable?.() === false) return Promise.resolve({ checked: 0 });
    const run = this.supervise(graceMs);
    this.supervising = run;
    void run.finally(() => { if (this.supervising === run) this.supervising = null; }).catch(() => {});
    return run;
  }
  private async supervise(graceMs: number): Promise<unknown> {
    const schedule = this.deps.nativeSchedule();
    if (!schedule) return { checked: 0, note: '当前 Host 未提供原生 Schedule 服务。' };
    await this.recoverPlans();
    const results = [];
    for (const plan of await this.deps.repos().digests.listPlans('active')) {
      if (!plan.schedule_id) continue;
      const completed = await this.deps.repos().digests.completedSources(plan.id);
      const observation = await inspectDigestDeliveries(schedule, plan, completed, graceMs, Date.now());
      if (!observation.overdue.length) { results.push({ planId: plan.id, action: 'checked', ...observation }); continue; }
      // History reads may overlap owner edits. The lifecycle gate compares the
      // revision again before changing either the mirror or the native task.
      const result = await this.plans.stop(plan.id, 'paused', plan.revision);
      if (result.changedDuringCheck) {
        results.push({ planId: plan.id, action: 'changed_during_check', ...observation, warning: result.warning }); continue;
      }
      if (this.deps.config().ownerOpenId) {
        await this.deps.notifyOwner(`digestunconfirmed:${plan.id}:${plan.schedule_id}`,
          `「${plan.title}」有 ${observation.overdue.length} 条原生投递超过宽限仍无对应完成回执，已暂停并标记待核对${result.warning ? '，原生清理尚未确认' : ''}；恢复前请先核对，不会为过期窗口补发一串简报。`);
      }
      results.push({ planId: plan.id, action: 'paused_unconfirmed', unattributed: observation.overdue.length, ...observation, warning: result.warning });
    }
    return { checked: results.length, results };
  }

  /** Today overview: merged calendar + task view for the Lead (P16 AC4). */
  async overviewToday(): Promise<unknown> {
    const facts = await this.planningFacts(new Date());
    return {
      calendar: { ...facts.calendar, events: facts.calendar.events.slice(0, 10) },
      tasks: facts.tasksDue.slice(0, 10),
      waiting: facts.waiting.slice(0, 5),
      reviewQueue: facts.reviewQueueCount >= 0 ? facts.reviewQueueCount : null,
      reviewedNotes: facts.reviewedNotes,
      missing: facts.missing,
      message: '今日概览来自实际投影；未读取的范围（如某集成未启用）不显示为零。已审核笔记为当前仍匹配的版本，链接可直接打开。',
    };
  }

  /**
   * Today plan (P16): focus, estimates, capacity and conflicts — a proposal,
   * never a write. Buffers come from confirmed preferences (e.g. 会议之间留 15 分钟).
   */
  async planToday(args: Record<string, unknown>): Promise<unknown> {
    const now = new Date();
    const facts = await this.planningFacts(now);
    const bufferMinutes = await this.preferenceBufferMinutes();
    const busyMinutes = facts.calendar.events.reduce((sum, e) => sum + Math.max(0, Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000)) + bufferMinutes, 0);
    const estimateTotal = facts.tasksDue.reduce((sum, t) => sum + (t.estimateMinutes ?? 30), 0);
    const capacityMinutes = Math.max(0, 8 * 60 - busyMinutes);
    const conflicts: string[] = [];
    for (const task of facts.tasksDue) {
      if (task.plannedAt) {
        const clash = facts.calendar.events.find(e => !e.allDay && new Date(e.start) <= new Date(task.plannedAt!) && new Date(task.plannedAt!) < new Date(e.end));
        if (clash) conflicts.push(`「${task.summary}」的计划时段与日程「${clash.summary}」重叠`);
      }
    }
    const overloaded = estimateTotal > capacityMinutes;
    return {
      focus: facts.tasksDue.slice(0, 3).map(t => ({ summary: t.summary, estimateMinutes: t.estimateMinutes ?? null, overdue: t.overdue })),
      capacity: { workdayMinutes: 8 * 60, busyMinutes, bufferMinutesPerMeeting: bufferMinutes, remainingMinutes: capacityMinutes, taskEstimateMinutes: estimateTotal, overloaded },
      conflicts,
      missing: facts.missing,
      message: overloaded
        ? `按估时今日过载（需 ${estimateTotal} 分钟，余 ${capacityMinutes} 分钟）：建议只选重点写入计划（用 plan_adopt 选定时间块），延后项由你决定。`
        : `今日容量 ${capacityMinutes} 分钟，任务估时 ${estimateTotal} 分钟；用 plan_preview 看候选时间块、plan_adopt 采纳选定项。`,
    };
  }

  preferenceBufferMinutes(): Promise<number> { return this.planning.bufferMinutes(); }
  planPreview(args: Record<string, unknown>): Promise<unknown> { return this.planning.preview(args); }
  planAdopt(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> { return this.planning.adopt(item, args); }
}
