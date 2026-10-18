// Recurring-digest & daily-planning service (F32): 周期服务 (GLOSSARY) — the
// owner-enabled morning/evening/weekly digests, today's overview and daily
// planning behind one deep module. F19 voice delivery extends here. The
// runtime keeps role bindings, the follow-up tick and channel selection.

import type { NativeScheduleService } from './runtime.js';
import type { MemoryStore } from './memory.js';
import type { SharedChannelDeps } from './channel-deps.js';
import type { WorkItemRow } from './repo.js';
import { randomUUID } from 'node:crypto';
import { isoDate, hash } from './util.js';
import { digestWakePrompt } from './prompts.js';

export interface DigestDeps extends SharedChannelDeps {
  accessSessionId(): string | null;
  workspace(): { statePath: string } | null;
  startedAt(): string | null;
  reviewQueueCount(): Promise<number>;
  memory(): MemoryStore | null;
  nativeSchedule(): NativeScheduleService | null;
  syncCalendarWindow(calendarId: string, from: Date, to: Date): Promise<{ ok: boolean; error?: string }>;
  calendarWrite(item: WorkItemRow, kind: 'create' | 'update' | 'cancel', args: Record<string, unknown>): Promise<unknown>;
  currentFingerprint(noteId: string, docId: string, versionRow?: { id: string; content: any } | null): Promise<string>;
  /** F40（spec 2.11）：任务 skill 目录（宿主挂载时含工作区自定义）。 */
  skillCatalog(): import('./skills.js').SkillCatalog;
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
  constructor(private readonly deps: DigestDeps) {}

  /** Local-date window key for a plan kind (morning/evening share the date, weekly uses ISO week). */
  digestWindowKey(kind: string, timeZone: string, now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    if (kind === 'weekly') {
      // ISO 8601 week: Thursday decides the owning year, Monday starts the
      // week; computed from the local date so year boundaries stay correct.
      const local = new Date(now.toLocaleString('en-US', { timeZone }));
      const day = local.getDay() || 7;
      const thursday = new Date(local.getFullYear(), local.getMonth(), local.getDate() + (4 - day));
      const jan1 = new Date(thursday.getFullYear(), 0, 1);
      const week = Math.round((thursday.getTime() - jan1.getTime()) / (7 * 86400000)) + 1;
      return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    return parts;
  }

  /**
   * Enable a smart plan (P24/P25): one durable business row plus one native
   * Schedule task bound to the fixed access session. Schedule persistence is
   * the enqueue; model work and platform acceptance are tracked separately on
   * the occurrence row.
   */
  async digestEnable(args: Record<string, unknown>): Promise<unknown> {
    const kind = String(args.kind ?? '');
    if (!['morning', 'evening', 'weekly', 'once'].includes(kind)) throw new Error('计划类型：morning/evening/weekly（daily/weekly 定时）或 once（一次性，演示与测试）。');
    const timeZone = String(args.timeZone ?? this.deps.config().timeZone);
    const schedule = this.deps.nativeSchedule();
    if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务，无法建立智能计划。');
    // F40（spec 2.11）：绑定任务 skill；缺省按类型映射内置三件，点名需在目录中且为模板轨（agent 轨随 F41）。
    const skill = args.skill ? String(args.skill) : kind === 'once' ? 'digest-morning' : `digest-${kind}`;
    const catalogSkill = await this.deps.skillCatalog().find(skill);
    if (!catalogSkill) throw new Error(`任务 skill 不存在：${skill}；可用清单见 digest_list 或面板。`);
    if (catalogSkill.track !== 'template') throw new Error(`任务 skill ${skill} 为 agent 轨，周期执行支持随后续版本交付。`);
    const title = { morning: '晨报', evening: '晚间回顾', weekly: '每周回顾', once: '一次性简报' }[kind]!;
    const id = `dig-${kind === 'once' ? 'once-' + randomUUID().slice(0, 8) : kind + '-' + hash(this.deps.workspace()!.statePath + kind).slice(0, 8)}`;
    const existing = await this.deps.repos().digests.getPlan(id);
    if (existing && existing.status !== 'stopped') throw new Error(`${title}计划已存在（${id}）；如需调整用 digest_control resume/pause 或先停止。`);
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
    const created = await schedule.create(this.deps.accessSessionId()!, { ...request, prompt: digestWakePrompt(id, title) });
    const plan = await this.deps.repos().digests.insertPlan({
      id,
      kind,
      title,
      schedule_id: String(created.id),
      session_id: this.deps.accessSessionId()!,
      schedule_spec: request,
      status: 'active',
      last_window: null,
      // F19：开启时可选语音版（引擎取工作区 tts 配置，默认文本）。
      voice: args.voice === true,
      skill,
    });
    return {
      planId: plan.id,
      skill,
      scheduleId: plan.schedule_id,
      nextDueAt: (created as { scheduledAt?: string }).scheduledAt ?? null,
      message: `${title}计划已开启（原生 Schedule 持久入队，绑定飞书接入会话）；到点唤醒 Lead 委派简报 Worker。`,
    };
  }

  async digestControl(args: Record<string, unknown>): Promise<unknown> {
    const plan = await this.deps.repos().digests.getPlan(String(args.planId ?? ''));
    if (!plan) throw new Error('计划不存在；请先用 digest_enable 开启。');
    const op = String(args.op ?? '');
    const schedule = this.deps.nativeSchedule();
    if (op === 'pause' || op === 'stop') {
      let nativeWarning: string | null = null;
      if (schedule && plan.schedule_id) {
        try {
          await schedule.delete({ sessionId: plan.session_id, id: plan.schedule_id });
        } catch (error) {
          nativeWarning = `原生计划移除失败（${(error as Error).message}）；请核对后重试暂停，期间触发会被计划状态拒绝。`;
          console.warn(`[pa24] ${nativeWarning}`);
        }
      }
      await this.deps.repos().digests.updatePlan(plan.id, { status: op === 'pause' ? 'paused' : 'stopped', schedule_id: null });
      return {
        planId: plan.id,
        status: op === 'pause' ? 'paused' : 'stopped',
        nativeWarning,
        message: `${op === 'pause' ? '计划已暂停' : '计划已停止'}（业务历史保留）${nativeWarning ? `；注意：${nativeWarning}` : ''}。`,
      };
    }
    if (op === 'skill') {
      // F40（spec 2.11）：per-plan 任务 skill 切换（须在目录中；agent 轨随后续版本）。
      const skill = String(args.skill ?? '');
      const catalogSkill = await this.deps.skillCatalog().find(skill);
      if (!catalogSkill) throw new Error(`任务 skill 不存在：${skill}；可用清单见 digest_list 或面板。`);
      if (catalogSkill.track !== 'template') throw new Error(`任务 skill ${skill} 为 agent 轨，周期执行支持随后续版本交付。`);
      await this.deps.repos().digests.updatePlan(plan.id, { skill });
      return { planId: plan.id, skill, message: `本计划任务 skill 已切换为 ${skill}。` };
    }
    if (op === 'voice') {
      // F19（spec 2.3）：per-plan 语音开关（引擎取工作区 tts 配置）。
      const voice = args.voice === true;
      await this.deps.repos().digests.updatePlan(plan.id, { voice });
      return { planId: plan.id, voice, message: voice ? '本计划改为语音版＋全文文本兜底。' : '本计划改为纯文本。' };
    }
    if (op === 'resume') {
      if (plan.status !== 'paused') throw new Error(`计划当前状态为 ${plan.status}，无法恢复。`);
      if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务。');
      const prompt = digestWakePrompt(plan.id, plan.title);
      const created = await schedule.create(plan.session_id, { ...plan.schedule_spec, prompt, title: `[24PA] ${plan.title}` });
      await this.deps.repos().digests.updatePlan(plan.id, { status: 'active', schedule_id: String(created.id) });
      return { planId: plan.id, scheduleId: String(created.id), message: '计划已恢复（重新入队）。' };
    }
    if (op === 'adjust') {
      // Adjust swaps the spec on the SAME plan row: remove the old native
      // schedule, create the new one, keep id and history stable (P24 修改).
      if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务。');
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
      if (plan.schedule_id) {
        await schedule.delete({ sessionId: plan.session_id, id: plan.schedule_id }).catch(error => {
          console.warn(`[pa24] 调整时移除旧原生计划失败：${(error as Error).message}`);
        });
      }
      const created = await schedule.create(plan.session_id, { ...request, prompt: digestWakePrompt(plan.id, plan.title), title: `[24PA] ${plan.title}` });
      await this.deps.repos().digests.updatePlan(plan.id, { status: 'active', schedule_id: String(created.id), schedule_spec: request });
      return { planId: plan.id, scheduleId: String(created.id), message: '计划已按新安排调整（同一计划保留历史，只影响以后）。' };
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
        lastWindow: plan.last_window,
        voice: plan.voice,
        skill: plan.skill,
        recent: occurrences.map(o => ({ window: o.window_key, status: o.status, completedAt: isoDate(o.completed_at) })),
      });
    }
    return { plans: view };
  }

  /** Gather planning facts once: calendar (with freshness), tasks, waiting, review queue, preferences. */
  private async planningFacts(now: Date): Promise<DigestFacts> {
    const tz = this.deps.config().timeZone;
    const dayStart = new Date(now.getTime() - 24 * 3600 * 1000);
    const dayEnd = new Date(now.getTime() + 36 * 3600 * 1000);
    const missing: string[] = [];
    const calendarId = this.deps.config().calendarId;
    const sync = await this.deps.syncCalendarWindow(calendarId, dayStart, dayEnd).catch(() => ({ ok: false, error: '同步失败' }));
    if (!sync.ok) missing.push(`日历同步失败（${(sync as { error?: string }).error ?? '未知'}）：以下为投影，可能过期`);
    const events = await this.deps.repos().calendar.eventsIn(calendarId, dayStart, dayEnd);
    const state = await this.deps.repos().calendar.getSync(calendarId);
    const tasks = await this.deps.repos().tasks.list();
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const todayTasks = tasks.filter(t => {
      const due = t.due_at ? new Date(t.due_at) : null;
      const planned = t.planned_at ? new Date(t.planned_at) : null;
      if (t.status === 'completed') return false;
      return (due && due.getTime() > now.getTime() - 24 * 3600 * 1000 && due.getTime() < dayEnd.getTime())
        || (planned && planned.getTime() > now.getTime() - 24 * 3600 * 1000 && planned.getTime() < dayEnd.getTime());
    });
    const completedToday = tasks.filter(t => t.status === 'completed' && t.last_synced_at && now.getTime() - t.last_synced_at.getTime() < 24 * 3600 * 1000);
    const waiting = await this.deps.repos().waiting.list('waiting');
    const reviewQueueCount = await this.deps.reviewQueueCount().catch(() => 0);
    const reviewedNotes: { noteId: string; version: number; summary: string; docUrl: string | null; reviewedAt: string | null }[] = [];
    try {
      const recent = await this.deps.repos().notes.recentApproved(5);
      for (const row of recent) {
        if (reviewedNotes.length >= 3) break;
        // Overview facts must be currently valid: re-verify the live document
        // so an externally edited note stops being presented as confirmed (P35).
        try {
          const live = await this.deps.currentFingerprint(row.note_id, row.doc_id!, row);
          if (live !== row.fingerprint) continue;
        } catch (error) {
          missing.push(`已审笔记 ${row.note_id} v${row.version} 暂无法核验（${(error as Error).message}），未列入概览`);
          continue;
        }
        reviewedNotes.push({
          noteId: row.note_id,
          version: row.version,
          summary: String(row.content?.summary ?? '').slice(0, 60),
          docUrl: row.doc_url,
          reviewedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
        });
      }
    } catch {
      missing.push('已审笔记列表读取失败；概览未包含该部分，不按零处理');
    }
    const projectRows = await this.deps.repos().projects.listIdNames().catch(() => [] as Array<{ id: string; name: string }>);
    const projects: { id: string; name: string; completed: number; total: number }[] = [];
    for (const project of projectRows) {
      const projectTasks = await this.deps.repos().projects.tasksOf(project.id);
      projects.push({ id: project.id, name: project.name, completed: projectTasks.filter(t => t.status === 'completed').length, total: projectTasks.length });
    }
    return {
      calendar: {
        fresh: sync.ok,
        syncedAt: isoDate(state?.last_synced_at ?? null),
        events: events.map(e => ({ summary: e.summary, start: isoDate(e.start_time)!, end: isoDate(e.end_time)!, allDay: e.is_all_day })),
      },
      tasksDue: todayTasks.map(t => ({
        guid: t.task_guid,
        summary: t.summary,
        dueAt: isoDate(t.due_at),
        plannedAt: isoDate(t.planned_at),
        estimateMinutes: t.estimate_minutes,
        overdue: !!(t.due_at && new Date(t.due_at).getTime() < now.getTime()),
      })),
      tasksCompletedToday: completedToday.map(t => ({ guid: t.task_guid, summary: t.summary })),
      waiting: waiting.map(w => ({ id: w.id, title: w.title, checkpointAt: w.checkpoint_at?.toISOString() ?? null })),
      reviewQueueCount,
      reviewedNotes,
      projects,
      missing,
    };
  }

  /**
   * Worker-side digest build (P24/P25): claims the current window idempotently,
   * assembles a sourced facts-vs-suggestions report, and ships it through the
   * outbox. Never writes tasks, calendar, or memory; nothing auto-postpones.
   */
  async digestBuild(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const planId = String(args.planId ?? '');
    const plan = await this.deps.repos().digests.getPlan(planId);
    if (!plan) throw new Error(`计划 ${planId} 不存在。`);
    if (plan.kind === 'meeting_prep') throw new Error('会前准备计划请用 meeting_prep_build 生成准备包。');
    if (plan.status !== 'active') throw new Error(`计划 ${planId} 当前状态为 ${plan.status}，不生成简报。`);
    const windowKey = this.digestWindowKey(plan.kind === 'evening' ? 'evening' : plan.kind, this.deps.config().timeZone);
    const { created, row } = await this.deps.repos().digests.claimOccurrence({ planId: plan.id, windowKey });
    if (!created && row.status === 'model_done') {
      return { planId, windowKey, reused: true, status: row.status, message: `本窗口（${windowKey}）简报已生成，不重复发布。` };
    }
    const { facts, report, outboxKey } = await this.buildAndDeliver(plan, windowKey, row.id);
    await this.deps.repos().digests.updateOccurrence(row.id, { status: 'model_done', report: { facts, report }, completed_at: new Date() });
    await this.deps.repos().digests.updatePlan(plan.id, { last_window: windowKey });
    await this.deps.repos().workItems.update(item.id, { result_ref: { planId: plan.id, windowKey, outboxKey } });
    return { planId, windowKey, outboxKey, message: '简报已生成并入发送队列（Outbox 持久，平台接受状态以发送记录为准）。' };
  }

  /**
   * F40（spec 2.11）：按 plan.skill 解析渲染口径并投递。内置模板轨 skill 的
   * metadata.kind 决定 renderDigest 口径（如 morning 计划绑 digest-weekly 则按
   * 周报渲染）；agent 轨执行随 F41——在此 fail-loud，不静默换轨。
   */
  private async buildAndDeliver(plan: import('./repo.js').DigestPlanRow, windowKey: string, occurrenceId: string): Promise<{ facts: DigestFacts; report: string; outboxKey: string }> {
    const boundSkill = plan.skill ? await this.deps.skillCatalog().find(plan.skill) : null;
    if (plan.skill && !boundSkill) {
      throw new Error(`计划绑定的任务 skill ${plan.skill} 已不在目录中（可能被删除）；用 digest_control op=skill 重绑或恢复该 skill。`);
    }
    if (boundSkill && boundSkill.track !== 'template') {
      throw new Error(`计划绑定的任务 skill ${plan.skill} 为 agent 轨，周期执行支持随后续版本交付；用 digest_control op=skill 切回模板轨。`);
    }
    const renderKind = boundSkill?.kind ?? plan.kind;
    const config = this.deps.config();
    const facts = await this.planningFacts(new Date());
    const report = this.renderDigest({ ...plan, kind: renderKind }, windowKey, facts);
    const outboxKey = `digest:${occurrenceId}`;
    if (config.notifyChannel === 'wecom' || config.ownerOpenId) {
      // F19（spec 2.3）：plan.voice 且引擎可用时，先入语音行（口播正文、投递时
      // 现场合成），全文文本行紧随其后兜底。wecom 通知通道与 tts.engine=none
      // 都按降级处理——只发文本，可观测告警，不中断。
      if (plan.voice) {
        if (config.notifyChannel === 'wecom') {
          console.warn('[pa24] 语音简报降级为文本：通知通道为企微（wecom 语音 parity 后置）。');
        } else if (config.tts.engine === 'none') {
          console.warn('[pa24] 语音简报降级为文本：未配置 TTS 引擎（AGENTS.md tts.engine=none）。');
        } else {
          await this.deps.repos().outbox.enqueue({
            dedupKey: `${outboxKey}:voice`,
            channel: 'feishu',
            target: config.ownerOpenId,
            kind: 'audio',
            content: { text: buildSpokenVariant(report) },
          });
        }
      }
      await this.deps.notifyOwner(outboxKey, report);
      // model_done = model work finished and the send intent is durably
      // queued; platform acceptance is the outbox row's own state (P24 区分).
      await this.deps.repos().digests.updateOccurrence(occurrenceId, { status: 'model_done', outbox_key: outboxKey });
    }
    return { facts, report, outboxKey };
  }

  /**
   * F40「立即运行一次」：以 manual-<ts> 窗口键执行当前 skill 口径，不占用当日
   * 计划窗口（08:00 照常触发），不落 WorkItem（面板发起，无事项上下文）。
   */
  async digestRunNow(planId: string): Promise<unknown> {
    const plan = await this.deps.repos().digests.getPlan(planId);
    if (!plan) throw new Error(`计划 ${planId} 不存在。`);
    if (plan.status !== 'active') throw new Error(`计划 ${planId} 当前状态为 ${plan.status}，不生成简报。`);
    const windowKey = `manual-${Date.now()}`;
    const { created, row } = await this.deps.repos().digests.claimOccurrence({ planId: plan.id, windowKey });
    if (!created && row.status === 'model_done') {
      return { planId, windowKey, reused: true, message: '本次手动运行已生成过，不重复发布。' };
    }
    const { outboxKey } = await this.buildAndDeliver(plan, windowKey, row.id);
    return { planId, windowKey, outboxKey, message: '已生成并入发送队列（手动运行不占用计划窗口）。' };
  }

  renderDigest(
    plan: { kind: string; title: string },
    windowKey: string,
    facts: DigestFacts,
  ): string {
    const lines: string[] = [];
    lines.push(`【${plan.title}】窗口 ${windowKey}`);
    lines.push('');
    lines.push('一、事实（来自实际对象）');
    if (facts.calendar.events.length) {
      lines.push(`· 日程 ${facts.calendar.events.length} 项（日历同步于 ${facts.calendar.syncedAt ?? '无记录'}${facts.calendar.fresh ? '' : '，本次同步失败可能过期'}）：`);
      for (const event of facts.calendar.events.slice(0, 8)) lines.push(`  - ${event.summary} ${event.start} → ${event.end}${event.allDay ? '（全天）' : ''}`);
    } else {
      lines.push(`· 今日无日程（日历同步于 ${facts.calendar.syncedAt ?? '无记录'}${facts.calendar.fresh ? '' : '，本次同步失败可能过期'}）`);
    }
    if (facts.tasksDue.length) {
      lines.push(`· 待办 ${facts.tasksDue.length} 项（截止与计划时间分开记录）：`);
      for (const task of facts.tasksDue.slice(0, 10)) {
        lines.push(`  - ${task.summary}${task.dueAt ? `，截止 ${task.dueAt}` : ''}${task.plannedAt ? `，计划 ${task.plannedAt}` : ''}${task.estimateMinutes != null ? `，估时 ${task.estimateMinutes} 分钟` : ''}${task.overdue ? '，【已逾期】' : ''}`);
      }
    } else {
      lines.push('· 今日没有到期或计划中的待办');
    }
    if (plan.kind !== 'morning' && facts.tasksCompletedToday.length) {
      lines.push(`· 近 24 小时内同步到完成状态 ${facts.tasksCompletedToday.length} 项（来源：任务投影的同步时间，非精确完成时刻）：${facts.tasksCompletedToday.map(t => t.summary).join('、')}`);
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
  async superviseDigests(graceMs: number = DIGEST_UNCONFIRMED_GRACE_MS): Promise<unknown> {
    const schedule = this.deps.nativeSchedule();
    if (!schedule) return { checked: 0, note: '当前 Host 未提供原生 Schedule 服务。' };
    const results = [];
    for (const plan of await this.deps.repos().digests.listPlans('active')) {
      if (!plan.schedule_id) continue;
      let delivered = 0;
      try {
        const history = await schedule.history({ sessionId: plan.session_id, id: plan.schedule_id, limit: 100 });
        delivered = Array.isArray((history as { records?: unknown[] }).records) ? (history as { records: unknown[] }).records.length : 0;
      } catch {
        continue;
      }
      const completed = (await this.deps.repos().digests.occurrencesOf(plan.id, 100)).filter(o => o.status === 'model_done').length;
      if (delivered > completed) {
        const staleDelivery = delivered - completed;
        const oldest = await this.deps.repos().digests.occurrencesOf(plan.id, 1);
        const lastDone = oldest[0]?.completed_at ? new Date(oldest[0].completed_at).getTime() : 0;
        // Unattributable deliveries older than the grace pause the plan.
        const startedAt = this.deps.startedAt();
        const startedAtMs = startedAt ? new Date(startedAt).getTime() : Date.now();
        if (Date.now() - Math.max(lastDone, startedAtMs) > graceMs) {
          try {
            await schedule.delete({ sessionId: plan.session_id, id: plan.schedule_id });
          } catch (error) {
            console.warn(`[pa24] 暂停无归属计划时移除原生 Schedule 失败（将重试）：${(error as Error).message}`);
          }
          await this.deps.repos().digests.updatePlan(plan.id, { status: 'paused', schedule_id: null });
          if (this.deps.config().ownerOpenId) {
            await this.deps.notifyOwner(
              `digestunconfirmed:${plan.id}`,
              `「${plan.title}」计划有 ${staleDelivery} 次投递无法归属到已完成的简报（可能模型未完成或回执写失败），已暂停并标记待核对；恢复前请先核对，不会为过期窗口补发一串简报。`,
            );
          }
          results.push({ planId: plan.id, action: 'paused_unconfirmed', unattributed: staleDelivery });
        }
      }
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

  /** Confirmed preference for inter-meeting buffers (minutes), default 0. */
  async preferenceBufferMinutes(): Promise<number> {
    try {
      const memory = await this.deps.memory()!.search({ topic: '工作偏好', limit: 20 });
      for (const record of memory.records) {
        if (record.status !== 'confirmed') continue;
        const match = record.content.match(/会议之间(?:留|间隔)\s*(\d+)\s*分钟/);
        if (match) return Number(match[1]);
      }
    } catch {
      // preference read failure keeps the default buffer, visibly zero-conflict
    }
    return 0;
  }

  /**
   * Preview candidate time blocks (P16): tomorrow by default, optionally with
   * a temporary insert; proposals only — adoption is a separate explicit step.
   */
  async planPreview(args: Record<string, unknown>): Promise<unknown> {
    const tz = this.deps.config().timeZone;
    const base = args.date ? new Date(String(args.date)) : new Date(Date.now() + 24 * 3600 * 1000);
    if (Number.isNaN(base.getTime())) throw new Error('date 需为可解析日期。');
    const from = new Date(base.toISOString().slice(0, 10) + 'T00:00:00Z');
    const to = new Date(base.toISOString().slice(0, 10) + 'T23:59:59Z');
    const calendarId = this.deps.config().calendarId;
    const sync = await this.deps.syncCalendarWindow(calendarId, from, to).catch(() => ({ ok: false, error: '同步失败' }));
    const events = await this.deps.repos().calendar.eventsIn(calendarId, from, to);
    const bufferMinutes = await this.preferenceBufferMinutes();
    const busy = events.filter(e => !e.is_all_day).map(e => ({ summary: e.summary, start: isoDate(e.start_time)!, end: isoDate(e.end_time)! }));
    if (args.insert) {
      const insertStart = new Date(String((args.insert as Record<string, unknown>).start ?? ''));
      const insertEnd = new Date(String((args.insert as Record<string, unknown>).end ?? ''));
      if (Number.isNaN(insertStart.getTime()) || Number.isNaN(insertEnd.getTime()) || insertEnd <= insertStart) throw new Error('插单需要 start/end（ISO）。');
      const displaced = busy.filter(b => new Date(b.start) < insertEnd && insertStart < new Date(b.end));
      return {
        date: from.toISOString().slice(0, 10),
        fresh: sync.ok,
        busy,
        insert: { start: insertStart.toISOString(), end: insertEnd.toISOString() },
        displacedByInsert: displaced,
        message: displaced.length
          ? `插单与 ${displaced.length} 项现有安排重叠（${displaced.map(d => d.summary).join('、')}）；建议只调整受影响部分（改期建议如下），未受影响安排不动。采纳时用 plan_adopt 只写入你选定的块。`
          : '插单时段空闲，可直接采纳（plan_adopt）。',
        suggestions: displaced.map(d => `将「${d.summary}」改期到插单后，或压缩该时段`),
      };
    }
    const tasks = await this.deps.repos().tasks.list();
    const openTasks = tasks.filter(t => t.status !== 'completed').slice(0, 5);
    return {
      date: from.toISOString().slice(0, 10),
      fresh: sync.ok,
      busy,
      bufferMinutesPerMeeting: bufferMinutes,
      candidateBlocks: openTasks.map((task, index) => ({
        task: task.summary,
        suggestedStart: new Date(from.getTime() + (9 + index) * 3600 * 1000).toISOString(),
        minutes: task.estimate_minutes ?? 60,
      })),
      message: '候选时间块仅为建议；用 plan_adopt 采纳选定项（写入前会重新同步复核）。',
    };
  }

  /**
   * Adopt selected blocks (P16): re-sync the day, re-check conflicts, then
   * write only the chosen blocks through the staged calendar path.
   */
  async planAdopt(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const blocks = Array.isArray(args.blocks) ? (args.blocks as Record<string, unknown>[]) : [];
    if (blocks.length === 0) throw new Error('需要选定要写入的时间块（blocks[]）；未选定的建议不会写入。');
    // Pre-write recheck (P16 AC3): refresh the day's projection and refuse a
    // block that now overlaps an existing arrangement (external changes show
    // up here instead of double-booking).
    const first = blocks[0]!;
    const dayProbe = new Date(String(first.start ?? ''));
    if (Number.isNaN(dayProbe.getTime())) throw new Error('blocks 需要包含 start（ISO）。');
    const dayStart = new Date(dayProbe.toISOString().slice(0, 10) + 'T00:00:00Z');
    const dayEnd = new Date(dayProbe.toISOString().slice(0, 10) + 'T23:59:59Z');
    const calendarId = String(args.calendarId ?? this.deps.config().calendarId);
    const sync = await this.deps.syncCalendarWindow(calendarId, dayStart, dayEnd);
    const existing = await this.deps.repos().calendar.eventsIn(calendarId, dayStart, dayEnd);
    const results = [];
    for (const [index, block] of blocks.entries()) {
      const start = new Date(String(block.start ?? ''));
      const end = new Date(String(block.end ?? ''));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        results.push({ index, ok: false, error: '时间块无效（需要 start/end，end 晚于 start）。' });
        continue;
      }
      const clash = existing.find(e => new Date(e.start_time) < end && start < new Date(e.end_time));
      if (clash) {
        results.push({ index, ok: false, skipped: 'conflict', error: `复核发现与现有安排「${clash.summary}」重叠（写入前重新同步），未写入。` });
        continue;
      }
      try {
        const created = await this.deps.calendarWrite(item, 'create', {
          summary: block.summary,
          start: start.toISOString(),
          end: end.toISOString(),
          calendarId,
        });
        results.push({ index, ok: true, ...(created as object) });
      } catch (error) {
        results.push({ index, ok: false, error: (error as Error).message });
      }
    }
    const failed = results.filter(r => !r.ok).length;
    return {
      fresh: sync.ok,
      adopted: results.length - failed,
      failed,
      results,
      message: failed === 0
        ? `已按你的选择写入 ${results.length} 个时间块（写入前重新同步${sync.ok ? '确认无冲突' : '失败，已按投影复核'}；回执见各块 eventId/url）。`
        : `已采纳 ${results.length - failed} 项，${failed} 项未写入（明细含复核冲突与错误）；失败项核对后可重试。`,
    };
  }

}
