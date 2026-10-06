import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, realpath, stat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { DshContext, DshAgent, DshSession, ContentBlock, WorkspaceInfo } from './host.js';
import { PaDatabase, resolveDsn } from './pg.js';
import { createRepos, type Repos, type WorkItemRow, type ActionOperationRow, type TaskRow } from './repo.js';
import { acquireHostLock, type HostLock, HostAlreadyActive } from './lock.js';
import { parseAgentsMd, template, ConfigError, type PaConfig } from './config.js';
import { runLarkCli } from './lark.js';
import { SdkFeishuTransport, inspectAccess, type FeishuTransport, type InboundEvent, type AccessDiagnostics, cliOptions } from './feishu.js';
import { RoleRegistry, type WorkerRoleDefinition, type WorkerActionHandler } from './roles.js';
import { MemoryStore, type MemoryChange } from './memory.js';
import { ReminderEngine, ReminderError, type SilencePolicy } from './reminders.js';
import {
  createEveryScheduleRecord,
  createDailyScheduleRecord,
  createWeeklyScheduleRecord,
  resolveRecurringOccurrence,
  ScheduleId,
  type RecurringScheduleRecord,
} from '@deepseek-ai/dsh-schedule';
import {
  cropBox,
  detectImageMediaType,
  extensionOf,
  fingerprintOf,
  MAX_PAGES_PER_NOTE,
  MAX_PAGE_BYTES,
  newReviewToken,
  normalizeDocument,
  noteDocumentXml,
  pendingReviewLine,
  RECOGNITION_PAGE_LIMIT,
  REVIEW_TOKEN_TTL_MS,
  reviewCard,
  sha256Hex,
  systemLine,
  diffNormalized,
  advanceReminder,
  type CropSpec,
  type DoubtSpec,
  type DiagramSpec,
  type RecognizedNote,
  type Region,
} from './handwriting.js';
import type { NoteRow, NotePageRow, ReviewReminderRow } from './repo.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const nowIso = () => new Date().toISOString();
const text = (value: unknown, max = 12000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`请输入 1–${max} 字的内容。`);
  return value.trim();
};
const textOf = (content: readonly ContentBlock[] | undefined): string =>
  (content || []).filter(b => b.type === 'text').map(b => String(b.text ?? '')).join('\n').trim();

let BUILTIN_ROLE_IDS: string[] = [];

function parseDue(value: unknown): { dueAt: Date | null; dueHasTime: boolean; dueArg: string | null } {
  if (value == null || value === '') return { dueAt: null, dueHasTime: false, dueArg: null };
  const raw = String(value).trim();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`截止时间无法解析：${raw}`);
  const dueHasTime = /[:T]/.test(raw) || raw.toLowerCase().startsWith('+');
  return { dueAt: date, dueHasTime, dueArg: raw };
}

const isoDate = (value: Date | string | null): string | null => (value == null ? null : new Date(value).toISOString());

function parseZonedRange(args: Record<string, unknown>): { from: Date; to: Date } {
  const from = new Date(String(args.from ?? ''));
  const to = new Date(String(args.to ?? ''));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new Error('需要明确的时间范围（from/to，ISO 格式，to 晚于 from）。');
  }
  if (to.getTime() - from.getTime() > 62 * 24 * 3600 * 1000) {
    throw new Error('单次查询范围不能超过 62 天；请分段查询。');
  }
  return { from, to };
}

function mapRemoteEvent(raw: any): { eventId: string; summary: string; start: Date; end: Date; isAllDay: boolean; timezone: string | null; canceled: boolean; recurring: boolean; attendees: unknown; url: string | null } | null {
  const eventId = String(raw?.event_id ?? raw?.eventId ?? raw?.id ?? '');
  const summary = String(raw?.summary ?? raw?.title ?? '');
  const start = new Date(String(raw?.start_time ?? raw?.start ?? raw?.startTime ?? ''));
  const end = new Date(String(raw?.end_time ?? raw?.end ?? raw?.endTime ?? ''));
  if (!eventId || !summary || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    eventId,
    summary,
    start,
    end,
    isAllDay: raw?.is_all_day === true || raw?.allDay === true,
    timezone: raw?.timezone ? String(raw.timezone) : null,
    canceled: raw?.status === 'canceled' || raw?.canceled === true,
    recurring: !!(raw?.rrule ?? raw?.recurrence?.length),
    attendees: raw?.attendees ?? raw?.attendee_ids ?? null,
    url: raw?.url ? String(raw.url) : raw?.meeting_url ? String(raw.meeting_url) : null,
  };
}

function taskExternal(data: any): { guid: string; url: string | null } {
  const task = data?.task ?? data;
  const guid = task?.guid ?? task?.task_guid ?? task?.taskId;
  if (!guid) throw new Error('未取得真实任务 ID；请先核对飞书任务清单，不要盲目重试。');
  return { guid: String(guid), url: task?.url ? String(task.url) : null };
}

const SOURCE_LABELS: Record<'task' | 'calendar', string> = { task: '任务', calendar: '日程' };

/** Bounded grace before an unattributable delivery pauses its digest plan (P24). */
export const DIGEST_UNCONFIRMED_GRACE_MS = 10 * 60 * 1000;

/** Stable fingerprint of a followed task: identity + content + due (P19). */
function taskFingerprint(task: { task_guid: string; summary: string; due_at: Date | null }): string {
  return hash(`${task.task_guid}\n${task.summary}\n${isoDate(task.due_at) ?? ''}`);
}

/** Stable fingerprint of a followed calendar event: identity + summary + start. */
function eventFingerprint(event: { event_id: string; summary: string; start_time: Date }): string {
  return hash(`${event.event_id}\n${event.summary}\n${isoDate(event.start_time) ?? ''}`);
}

/**
 * Next occurrence for a template schedule. resolveRecurringOccurrence refuses
 * dispatches before the record's scheduledAt (the first fire); in that window
 * the next occurrence IS scheduledAt.
 */
function nextTemplateOccurrence(record: RecurringScheduleRecord, now: number): Date {
  try {
    const resolved = resolveRecurringOccurrence(record, now);
    return new Date(resolved.nextScheduledAt ?? resolved.occurrenceAt);
  } catch {
    return new Date((record as { scheduledAt?: string }).scheduledAt ?? Date.now() + 60_000);
  }
}

const WORKER_PERSONAS: Record<string, { name: string; persona: string; brief: string }> = {
  memo: {
    name: '备忘整理',
    persona: '你是 24私助的备忘整理 Worker。把收到的想法、资料链接和文字材料整理保存，返回出处；需要背景时用 pa24_memory 检索（只读）。不执行其他业务，不产生新授权。结果交回发起会话。',
    brief: '整理随手想法和文字材料：调用 memo_save 保存到配置的飞书目录（演示模式仅入账本），用 memo_find 按主题/日期/关键词找回。',
  },
};

export type RuntimeRole = 'feishu-access' | 'local-robot' | 'worker' | null;
export type ReadinessItem = { id: string; state: 'ok' | 'warn' | 'error' | 'info'; message: string; detail?: unknown };

export class HostStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostStartupError';
  }
}

interface PendingDelivery {
  inboxId: string;
  sessionId: string;
}

export interface RuntimeOptions {
  stateDirectory: string;
  workspacePath: string;
  larkCliBin: string;
  cliTimeoutMs: number;
  dispatchTickMs: number;
  outboxTickMs: number;
  reminderTickMs: number;
  noteVerifyTickMs: number;
  reviewReminderTickMs: number;
  env?: Record<string, string | undefined>;
}

export interface NativeScheduleService {
  create(sessionId: string, request: Record<string, unknown>, signal?: AbortSignal): Promise<{ id: string; scheduledAt?: string } & Record<string, unknown>>;
  delete(request: { sessionId: string; id: string }): Promise<unknown>;
  history(request: { sessionId: string; id: string; limit: number }): Promise<{ records?: unknown[] } & Record<string, unknown>>;
}

export class PaRuntime {
  private readonly ctx: DshContext;
  readonly options: RuntimeOptions;
  private readonly env: Record<string, string | undefined>;
  private serial: Promise<unknown> = Promise.resolve();
  private readonly sessionGates = new Map<string, Promise<unknown>>();
  private readonly pendingDeliveries = new Map<string, PendingDelivery[]>();

  private lock: HostLock | null = null;
  private db: PaDatabase | null = null;
  private get dbRef(): PaDatabase {
    if (!this.db) throw new Error('PostgreSQL 业务账本未连接。');
    return this.db;
  }
  repos: Repos | null = null;
  config: PaConfig | null = null;
  private instructions = '';
  private sourceHash = '';
  private loadedAt: string | null = null;
  private configError: string | null = null;

  readonly roles = new RoleRegistry();
  memory: MemoryStore | null = null;
  reminders: ReminderEngine | null = null;
  workspace: (WorkspaceInfo & { statePath: string }) | null = null;
  private accessSessionId: string | null = null;
  private localSessionId: string | null = null;

  private transport: FeishuTransport | null = null;
  private transportError: string | null = null;
  private lastReceivedAt: string | null = null;
  private lastSentAt: string | null = null;
  private diagnostics: AccessDiagnostics | null = null;
  private checking: Promise<AccessDiagnostics> | null = null;

  private dispatchTimer: NodeJS.Timeout | null = null;
  private outboxTimer: NodeJS.Timeout | null = null;
  private noteVerifyTimer: NodeJS.Timeout | null = null;
  private reviewReminderTimer: NodeJS.Timeout | null = null;
  private reviewReminding = false;
  private dispatching = false;
  private outboxSending = false;
  private noteVerifying = false;
  closed = false;
  startedAt: string | null = null;
  startupError: HostStartupError | null = null;
  private readonly lifetime = new AbortController();

  constructor(ctx: DshContext, options: RuntimeOptions) {
    this.ctx = ctx;
    this.options = options;
    this.env = options.env ?? process.env;
    this.registerBuiltInRoles();
    BUILTIN_ROLE_IDS = this.roles.list().map(r => r.id);
  }

  /** Built-in, auditable action implementations a registered role may bind (P44). */
  private readonly builtInActions: Record<string, WorkerActionHandler> = {
    digest_summarize: async (args, item) => {
      const topic = text(args.topic, 200);
      const content = text(args.content, 60000);
      const source = text(args.source ?? `资料摘要事项 ${item.id}`, 500);
      const summary = content.length > 400 ? `${content.slice(0, 400)}…（共 ${content.length} 字，已入库）` : content;
      const memo = await this.repos!.memos.insert({
        id: `digest:${item.id}:${hash(summary).slice(0, 12)}`,
        work_item_id: item.id,
        topic,
        content: summary,
        doc_url: null,
        doc_id: null,
        doc_revision: null,
        source,
        occurred_on: new Date().toISOString().slice(0, 10),
      });
      await this.repos!.workItems.update(item.id, { result_ref: { memoId: memo.id, operationId: `digest:${item.id}` } });
      return { memoId: memo.id, topic, message: '资料摘要已保存入账本（PostgreSQL），可按主题检索。' };
    },
  };

  private registerBuiltInRoles(): void {
    this.roles.register({
      id: 'tasks',
      name: '待办管理',
      persona: '你是 24私助的待办管理 Worker。创建、修改、完成本人明确委托的飞书任务并按主题/项目跟踪；截止时间、计划投入时间与估时分开记录。完成任务必须有本人明确动作或飞书实际状态，不从对话结束推断。飞书任务是权威对象；网络结果未知时先核对，不盲目重试。结果交回发起会话。',
      brief: '待办与项目：task_create/task_update/task_complete/task_get/task_list/task_cancel 维护飞书任务（幂等、先核对、取消按平台能力如实说明），project_create/project_adopt/project_progress 拆解目标并按实际任务状态汇报进展；outreach_send/task_assign 按本人明确指令对外发信或分派任务（需 instruction 依据，草稿不发送）；task_repeat_* 周期任务模板（跳过本次/停止以后）；waiting_* 等待事项与检查点（只提醒本人，不自动催办他人）。',
      available: true,
      actions: {
        task_create: async (args, item) => this.taskCreate(item, args),
        task_update: async (args, item) => this.taskUpdate(item, args),
        task_complete: async (args, item) => this.taskComplete(item, args),
        task_get: async args => this.taskGet(args),
        task_cancel: async args => {
          const task = await this.resolveTask(args);
          if (!String(args.reason ?? '').trim()) throw new Error('取消需要说明本人的理由，用于记录与后续核对。');
          return {
            guid: task.task_guid,
            url: task.url,
            message: '飞书任务平台不提供删除/取消接口。按平台真实能力：可用 task_update 在标题中标注取消原因，或 task_complete 归档；未执行任何写入。',
          };
        },
        task_list: async args => this.taskList(args),
        project_create: async args => this.projectCreate(args),
        project_adopt: async (args, item) => this.projectAdopt(item, args),
        project_progress: async args => this.projectProgress(args),
        outreach_send: async (args, item) => this.outreachSend(item, args),
        task_assign: async (args, item) => this.taskAssign(item, args),
        task_repeat_create: async args => this.taskRepeatCreate(args),
        task_repeat_list: async () => this.taskRepeatList(),
        task_repeat_skip: async args => this.taskRepeatSkip(args),
        task_repeat_stop: async args => this.taskRepeatStop(args),
        task_repeat_update: async args => this.taskRepeatUpdate(args),
        waiting_create: async args => this.waitingCreate(args),
        waiting_list: async args => this.waitingList(args),
        waiting_control: async args => this.waitingControl(args),
      },
    });
    this.roles.register({
      id: 'memo',
      name: '备忘整理',
      persona: WORKER_PERSONAS.memo!.persona,
      brief: WORKER_PERSONAS.memo!.brief,
      available: true,
      actions: {
        memo_save: async (args, item) => this.saveMemo(item, args),
        memo_find: async args => {
          const memos = await this.repos!.memos.search({
            topic: args.topic ? text(args.topic, 200) : undefined,
            query: args.query ? text(args.query, 200) : undefined,
            from: args.from ? String(args.from) : undefined,
            to: args.to ? String(args.to) : undefined,
            limit: 20,
          });
          return {
            count: memos.length,
            memos: memos.map(m => ({
              id: m.id,
              topic: m.topic,
              content: m.content,
              url: m.doc_url,
              source: m.source,
              // pg returns DATE columns as Date objects; tool output must stay
              // lossless JSON.
              date: m.occurred_on == null ? null : String(m.occurred_on).slice(0, 10),
            })),
          };
        },
      },
    });
    this.roles.register({
      id: 'digest',
      name: '简报整理',
      persona:
        '你是 24私助的简报 Worker。按计划类型汇总当日/当周的实际状态：日程（带同步时间与新鲜度）、任务（截止与计划分开）、项目进展、等待事项与待审队列；重点与容量是建议，事实与建议必须分开标注，每条带来源；数据缺失如实列出，不显示为零。你只产出简报文本并交给宿主投递，不修改任务/日历，不写长期记忆，不自动延期任何未完成任务。',
      brief: '智能简报：digest_build {planId} 生成当前窗口简报（晨报/晚间/每周），交回 Lead 汇报。',
      available: true,
      actions: {
        digest_build: async (args, item) => this.digestBuild(item, args),
      },
    });
    this.roles.register({
      id: 'calendar',
      name: '日程编排',
      persona: '你是 24私助的日程编排 Worker。只读写配置授权的本人日历；时间必须带时区；查询先经同步投影并报告新鲜度，读不到就说明资料缺失而不是“没有会议”。创建/改期/取消仅凭本人明确指令，变更前展示范围，写后以平台回执为准。邀请他人须本人明确邀请指令，同名或不明确的联系人先澄清；不臆造忙闲。结果交回发起会话。',
      brief: '日程与会议：calendar_query/calendar_busy 查询（同步水位、冲突、新鲜度），calendar_create/update/cancel 维护本人日程（staged 幂等、写后回执），meeting_schedule 解析参会人并按明确指令邀请。',
      available: true,
      actions: {
        calendar_query: async args => this.calendarQuery(args),
        calendar_busy: async args => this.calendarBusy(args),
        calendar_create: async (args, item) => this.calendarWrite(item, 'create', args),
        calendar_update: async (args, item) => this.calendarWrite(item, 'update', args),
        calendar_cancel: async (args, item) => this.calendarWrite(item, 'cancel', args),
        meeting_schedule: async (args, item) => this.meetingSchedule(item, args),
        plan_today: async args => this.planToday(args),
        plan_preview: async args => this.planPreview(args),
        plan_adopt: async (args, item) => this.planAdopt(item, args),
        overview_today: async () => this.overviewToday(),
      },
    });
    this.roles.register({
      id: 'reminders',
      name: '事项提醒',
      persona: '你是 24私助的事项提醒 Worker。创建提醒前确认时间、时区与内容；时间计算由宿主的 dsh-schedule 公开函数完成，不自行推算。提醒由 PostgreSQL 发生实例和 Outbox 投递，模型离线也能发出。完成/稍后/取消都绑定原规则与实例，重复请求不产生多份。只报告平台接受状态，不推断已读。',
      brief: '提醒：reminder_create（once/every/daily/weekly，可 linkTaskGuid/linkEventId 跟随任务或日程——来源改期/取消后旧提醒停发并更正）、reminder_list、reminder_cancel/pause/resume、reminder_skip、reminder_snooze、reminder_status（实例与平台接受状态）。',
      available: true,
      actions: {
        reminder_create: async args => {
          let link: { sourceType: 'task' | 'calendar'; sourceId: string; fingerprint: string } | undefined;
          if (args.linkTaskGuid || args.linkEventId) {
            if (args.linkTaskGuid && args.linkEventId) throw new Error('一次只能跟随一个来源（任务或日程）。');
            if (args.linkTaskGuid) {
              const task = await this.resolveTask({ taskId: args.linkTaskGuid, guid: args.linkTaskGuid });
              link = { sourceType: 'task', sourceId: task.task_guid, fingerprint: taskFingerprint(task) };
            } else {
              const event = await this.repos!.calendar.findEvent(String(args.linkEventId));
              if (!event) throw new Error('日程不存在；请先 calendar_query 同步并取得 event_id。');
              link = { sourceType: 'calendar', sourceId: event.event_id, fingerprint: eventFingerprint(event) };
            }
          }
          const result = await this.reminders!.create({
            kind: String(args.kind ?? 'once') as any,
            text: text(args.text, 500),
            afterSeconds: args.afterSeconds == null ? undefined : Number(args.afterSeconds),
            at: args.at == null ? undefined : String(args.at),
            everySeconds: args.everySeconds == null ? undefined : Number(args.everySeconds),
            time: args.time == null ? undefined : String(args.time),
            weekdays: Array.isArray(args.weekdays) ? (args.weekdays as number[]) : undefined,
            timeZone: String(args.timeZone ?? this.config!.timeZone),
            source: args.source ? text(args.source, 500) : undefined,
            link,
          });
          return result;
        },
        reminder_list: async () => this.reminders!.list(),
        reminder_cancel: async args => this.reminders!.setStatus(String(args.ruleId ?? ''), 'stopped', String(args.reason ?? '')),
        reminder_pause: async args => this.reminders!.setStatus(String(args.ruleId ?? ''), 'paused', String(args.reason ?? '')),
        reminder_resume: async args => this.reminders!.setStatus(String(args.ruleId ?? ''), 'active', String(args.reason ?? '')),
        reminder_skip: async args => this.reminders!.skipThis(String(args.ruleId ?? ''), String(args.reason ?? '')),
        reminder_snooze: async args => this.reminders!.snooze(String(args.ruleId ?? ''), Number(args.seconds ?? 0), String(args.reason ?? '')),
        reminder_status: async args => this.reminders!.occurrenceStatus(String(args.occurrenceId ?? '')),
        digest_enable: async args => this.digestEnable(args),
        digest_control: async args => this.digestControl(args),
        digest_list: async () => this.digestList(),
      },
    });
    this.roles.register({
      id: 'handwriting',
      name: '手写笔记',
      persona:
        '你是 24私助的手写笔记 Worker。你收到的图片是主人手写笔记的原稿：逐字忠实转写，不补写、不美化；整理摘要、AI 建议和疑点必须与原文分开标注；相对日期保留原话并说明解释依据；无法辨认的内容明确列为未知，不臆测成事实。你只产生候选内容：用 note_submit 提交结构化结果，由宿主写入待审文档并发给本人审核；你没有批准审核或创建任务、日程、消息等外部行动的工具。识别质量没有把握时如实说明。',
      brief: '手写整理：查看原稿图片，用 note_submit 提交转写/摘要/AI建议/疑点/候选行动/相对日期，等待本人审核；不执行任何外部行动。',
      available: true,
      actions: {
        note_submit: async (args, item) => this.noteSubmit(item, args),
      },
    });
  }

  /** Maintainer-facing role registration (P44); duplicates and invalid definitions are refused, keeping the old set. */
  async registerRole(definition: WorkerRoleDefinition, actionNames: readonly string[] = []): Promise<void> {
    if (this.roles.hasRegistered(definition.id)) {
      throw new Error(`角色已注册：${definition.id}；如需更新请先移除并处理在途事项。`);
    }
    // Validate every action binding before touching the registry so a bad
    // name cannot leave a half-registered, unpersisted role behind.
    const bindings: [string, WorkerActionHandler][] = actionNames.map(name => {
      const handler = this.builtInActions[name];
      if (!handler) throw new Error(`未提供该动作实现：${name}。`);
      return [name, handler];
    });
    this.roles.register(definition);
    for (const [name, handler] of bindings) this.bindRoleAction(definition.id, name, handler);
    await this.persistRegisteredRoles();
  }

  /** Registered dynamic roles survive restarts (P44 重启可续办). */
  private async persistRegisteredRoles(): Promise<void> {
    if (!this.workspace) return;
    const { writeFile } = await import('node:fs/promises');
    const declared = this.roles
      .list()
      .filter(r => !BUILTIN_ROLE_IDS.includes(r.id))
      .map(r => ({
        id: r.id,
        name: r.name,
        persona: r.persona,
        brief: r.brief,
        available: r.available,
        actionNames: Object.keys(r.actions),
      }));
    await writeFile(join(this.workspace.statePath, '.24pa', 'roles.json'), JSON.stringify(declared, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  }

  private async restoreRegisteredRoles(): Promise<void> {
    if (!this.workspace) return;
    try {
      const raw = JSON.parse(await readFile(join(this.workspace.statePath, '.24pa', 'roles.json'), 'utf8'));
      for (const def of Array.isArray(raw) ? raw : []) {
        this.roles.register({
          id: String(def.id),
          name: String(def.name),
          persona: String(def.persona),
          brief: String(def.brief),
          available: def.available === true,
          actions: {},
        });
        const actionNames = Array.isArray(def.actionNames) ? def.actionNames.map(String) : [];
        for (const name of actionNames) {
          const handler = this.builtInActions[name];
          if (handler) this.bindRoleAction(String(def.id), name, handler);
        }
      }
    } catch {
      // No persisted roles yet, or an unreadable file is ignored; built-ins
      // are always present.
    }
  }

  private bindRoleAction(roleId: string, action: string, handler: WorkerActionHandler): void {
    const role = this.roles.get(roleId);
    if (!role) return;
    this.roles.register({ ...role, actions: { ...role.actions, [action]: handler } });
  }

  /**
   * Declarative registration surface: bind built-in action implementations by
   * name (the P44 digest demonstration) without shipping executable code over
   * the panel.
   */
  registerRoleActions(roleId: string, actionNames: readonly string[]): void {
    const role = this.roles.get(roleId);
    if (!role) throw new Error(`角色未注册：${roleId}。`);
    for (const name of actionNames) {
      const handler = this.builtInActions[name];
      if (!handler) throw new Error(`未提供该动作实现：${name}。`);
      this.bindRoleAction(roleId, name, handler);
    }
  }

  listRoles(): { id: string; name: string; available: boolean }[] {
    return this.roles.list().map(r => ({ id: r.id, name: r.name, available: r.available }));
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(() => {
      if (this.closed) throw new Error('24私助已停止。');
      return work();
    });
    this.serial = result.catch(() => {});
    return result;
  }

  private gate<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionGates.get(key) ?? Promise.resolve();
    const result = previous.then(work, work);
    this.sessionGates.set(key, result.catch(() => {}));
    return result;
  }

  // ---- lifecycle -----------------------------------------------------------

  async start(): Promise<void> {
    await mkdir(this.options.stateDirectory, { recursive: true });
    this.lock = await acquireHostLock(this.options.stateDirectory);
    if (this.closed) {
      await this.cleanup();
      return;
    }
    const requested = this.options.workspacePath || (await this.readSavedWorkspacePath());
    if (requested) {
      await this.bind(requested, true);
    } else {
      this.configError = '尚未选择24私助工作区目录；请在「24私助工作区」面板绑定。';
    }
    if (this.closed) {
      await this.cleanup();
      return;
    }
    await this.restoreActiveWork();
    await this.reconcileAfterRestart();
    this.dispatchTimer = setInterval(() => void this.kickDispatcher(), this.options.dispatchTickMs);
    this.outboxTimer = setInterval(() => void this.kickOutbox(), this.options.outboxTickMs);
    // Bounded polling for pending-review versions (P32): no Feishu file events
    // are subscribed, so pending candidates are re-verified at a capped cadence
    // and every check persists its result and time on the version row.
    this.noteVerifyTimer = setInterval(() => void this.noteVerifyTick(), this.options.noteVerifyTickMs);
    this.reviewReminderTimer = setInterval(() => {
      void this.reviewReminderTick();
      this.followupTick();
    }, this.options.reviewReminderTickMs);
    this.dispatchTimer.unref?.();
    this.outboxTimer.unref?.();
    this.noteVerifyTimer.unref?.();
    this.reviewReminderTimer.unref?.();
    this.startedAt = nowIso();
  }

  private async readSavedWorkspacePath(): Promise<string | null> {
    if (!this.db) return null;
    const result = await this.db!.query<{ path: string }>('select path from pa24.workspace_state order by updated_at desc limit 1');
    return result.rows[0]?.path ?? null;
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    try {
      if (this.repos) {
        const active = await this.repos.workItems.list(['accepted', 'queued', 'running'], 50);
        const parents = new Set(active.map(item => item.parent_session_id));
        const agents: DshAgent[] = [];
        for (const id of parents) {
          const resolved = await this.ctx.sessionController.resolveAgent(id).catch(() => null);
          if (resolved && !('error' in resolved)) agents.push(resolved.agent);
        }
        if (agents.length > 0) await this.ctx.subagents.drainContinuableDescendants(agents).catch(() => {});
      }
    } finally {
      await this.cleanup();
    }
  }

  /** Release every acquired resource; safe to call again after a late start(). */
  private async cleanup(): Promise<void> {
    if (this.noteVerifyTimer) clearInterval(this.noteVerifyTimer);
    this.noteVerifyTimer = null;
    if (this.reviewReminderTimer) clearInterval(this.reviewReminderTimer);
    this.reviewReminderTimer = null;
    this.reminders?.stop();
    this.reminders = null;
    await this.transport?.close().catch(() => {});
    this.transport = null;
    await this.db?.close().catch(() => {});
    this.db = null;
    this.repos = null;
    await this.lock?.release().catch(() => {});
    this.lock = null;
  }

  // ---- workspace binding & config -----------------------------------------

  /**
   * Post-restart reconciliation (P07): claims die with the process, unfinished
   * work resumes on the same native children with a new generation counter,
   * and user-stopped items stay stopped.
   */
  private async reconcileAfterRestart(): Promise<void> {
    if (!this.repos) return;
    // Inbox rows claimed but never processed run again (admission is
    // idempotent through the stable requestId).
    await this.dbRef
      .query(`update pa24.inbox set status = 'received' where status = 'processing'`)
      .catch(() => {});
    // Admitted-but-undelivered rows cannot be attributed to a turn across a
    // crash: surface them instead of guessing an outcome.
    const orphaned = await this.dbRef.query<{ event_id: string; payload: any }>(
      `select event_id, payload from pa24.inbox where status = 'admitted'`,
    );
    for (const row of orphaned.rows) {
      await this.repos.inbox.mark(row.event_id, { status: 'rejected', error: '重启中断；请重新发送该消息' });
      if (this.config?.ownerOpenId) {
        await this.notifyOwner(
          `reconcile:${row.event_id}`,
          '服务重启前有一条消息正在处理但未完成；如仍需要请重新发送。',
        );
      }
    }
    // Running children get an explicit recovery input; queued/accepted items
    // start through the normal pump on the next delegation/event.
    const interrupted = await this.repos.workItems.list(['running'], 50);
    for (const item of interrupted) {
      if (!item.child_session_id) continue;
      // Synthetic note-republish items own no native child session; a crash
      // mid-republish just needs a clean close (the staged operation keeps
      // idempotency for the next attempt).
      if (item.id.startsWith('pa24-work-notes-')) {
        await this.repos.workItems.update(item.id, { status: 'failed', progress: '重启中断了候选刷新；请重新发起。' });
        continue;
      }
      const gen = (item.recovery_gen ?? 0) + 1;
      await this.repos.workItems.update(item.id, { progress: `重启恢复（第 ${gen} 代）；等待 Worker 核对后续办` } as any);
      await this.dbRef
        .query(`update pa24.work_item set recovery_gen = $2 where id = $1`, [item.id, gen])
        .catch(() => {});
      const parent = await this.ctx.sessionController.resolveAgent(item.parent_session_id).catch(() => null);
      if (!parent || 'error' in parent) continue;
      await this.ctx.subagents
        .sendMessage(
          parent.agent,
          item.child_session_id,
          [
            {
              type: 'text',
              text: `[恢复 第${gen}代] 服务重启。请先核对已完成步骤与外部结果（账本操作编号见工具回执），再继续未完成部分；已成功的操作不要重复执行。`,
            },
          ],
          { signal: this.lifetime.signal },
        )
        .catch(() => {});
    }
    if (interrupted.length > 0 || orphaned.rows.length > 0) void this.pump();
  }

  /** After a restart, re-attach the in-memory role map from the durable ledger. */
  private async restoreActiveWork(): Promise<void> {
    if (!this.repos) return;
    const active = await this.repos.workItems.list(['accepted', 'queued', 'running', 'waiting_input'], 100);
    for (const item of active) this.trackWorkItem(item);
  }

  async bind(path: string, initialize = false): Promise<void> {
    if (!isAbsolute(path)) throw new Error('工作区必须是服务器上的绝对目录。');
    const real = await realpath(await (initialize ? mkdir(path, { recursive: true }).then(() => path) : path));
    if (!(await stat(real)).isDirectory()) throw new Error('请选择目录。');
    // Switching the bound workspace while work is in flight would orphan the
    // running ledger; require the operator to finish or stop first.
    if (this.workspace && this.workspace.statePath !== real && (await this.hasActiveWork())) {
      throw new Error('有进行中的事项；请先完成或停止，再切换工作区。');
    }

    await this.openDatabaseFor(real);
    const saved = await this.repos!.workspaceState.get(real);
    this.accessSessionId = saved?.feishu_session_id ?? `pa24-${hash(real).slice(0, 12)}-feishu`;
    this.localSessionId = saved?.local_session_id ?? `pa24-${hash(real).slice(0, 12)}-local`;

    const agentsMd = join(real, 'AGENTS.md');
    if (initialize && !(await stat(agentsMd).catch(() => null))) {
      const target = await this.ctx.fs.resolve(agentsMd);
      await this.ctx.fs.writeText(target, template(), { kind: 'createIfAbsent' }, undefined, { mode: 'workspace-write', workspaceRoot: real });
    }
    const workspace = await this.ctx.workspaceRegistry.create(real, '24私助');
    this.workspace = { ...workspace, statePath: real };
    this.memory = new MemoryStore(real, this.ctx);
    await this.restoreRegisteredRoles();
    this.reminders = new ReminderEngine(
      this.dbRef,
      {
        notify: async (dedupKey, text) => {
          await this.notifyOwner(dedupKey, text);
        },
        outboxState: async dedupKey => {
          if (!this.repos) return null;
          const rows = await this.repos.outbox.recent(200);
          const row = rows.find(r => r.dedup_key === dedupKey);
          return row ? { status: row.status, messageId: row.message_id } : null;
        },
        // P19 pre-send check: the followed task/meeting must still match the
        // fingerprint captured when the reminder was bound.
        sourceValid: async rule => this.sourceVerdict(rule.link_source_type!, rule.link_source_id!, rule.link_fingerprint),
      },
      this.silencePolicy,
    );
    this.reminders.start(this.options.reminderTickMs);
    await this.loadConfig();
    await this.repos!.workspaceState.save(real, { feishuSessionId: this.accessSessionId, localSessionId: this.localSessionId });
    await this.establishSessions();
    await this.restoreActiveWork();
    await this.connectTransport();
  }

  private async openDatabaseFor(workspacePath: string): Promise<void> {
    const envName = await this.probeConfigDsn(workspacePath);
    const dsn = resolveDsn(envName, this.env);
    const db = new PaDatabase(dsn);
    try {
      await db.check();
      await db.migrate();
    } catch (error) {
      await db.close().catch(() => {});
      throw error;
    }
    await this.db?.close().catch(() => {});
    this.db = db;
    this.repos = createRepos(db);
  }

  /** Read the DSN env name from AGENTS.md before the full config is trusted. */
  private async probeConfigDsn(workspacePath: string): Promise<string> {
    try {
      const source = await readFile(join(workspacePath, 'AGENTS.md'), 'utf8');
      return parseAgentsMd(source).config.pgDsnEnv;
    } catch {
      return 'PA24_PG_DSN';
    }
  }

  async loadConfig(): Promise<PaConfig> {
    const source = await readFile(join(this.workspace!.statePath, 'AGENTS.md'), 'utf8');
    const parsed = parseAgentsMd(source);
    const previous = this.config;
    if (previous && previous.mode !== parsed.config.mode && (await this.hasActiveWork())) {
      throw new ConfigError('身份或接入模式变更前，请先完成或停止进行中的事项。');
    }
    this.config = parsed.config;
    this.instructions = parsed.instructions;
    this.sourceHash = parsed.sourceHash;
    this.loadedAt = nowIso();
    this.configError = null;
    return parsed.config;
  }

  async reloadWorkspace(): Promise<void> {
    return this.enqueue(async () => {
      const previousConfig = this.config;
      const previousHash = this.sourceHash;
      try {
        await this.loadConfig();
      } catch (error) {
        this.configError = `重载失败（保留当前生效配置）：${(error as Error).message}`;
        this.sourceHash = previousHash;
        throw error;
      }
      // Non-destructive reload: keep sessions, work items and diagnostics.
      if (previousConfig?.mode !== this.config!.mode) {
        await this.connectTransport();
      }
    });
  }

  private async hasActiveWork(): Promise<boolean> {
    if (!this.repos) return false;
    let count = 0;
    for (const status of ['accepted', 'queued', 'running', 'waiting_input'] as const) {
      count += await this.repos.workItems.countByStatus(status);
    }
    return count > 0;
  }

  private async connectTransport(): Promise<void> {
    await this.transport?.close().catch(() => {});
    this.transport = null;
    this.transportError = null;
    if (!this.config) return;
    if (this.config.mode !== 'feishu') {
      this.transportError = 'demo：未连接飞书；业务账本使用 PostgreSQL。';
      return;
    }
    const appId = this.env[this.config.appIdEnv];
    const appSecret = this.env[this.config.appSecretEnv];
    if (!appId || !appSecret) {
      this.transportError = `feishu 模式缺少环境变量 ${this.config.appIdEnv}/${this.config.appSecretEnv}；机器人未启动。`;
      return;
    }
    if ((this.env.PA24_TRANSPORT || '').trim() === 'fake') {
      this.transport = new FakeFeishuTransport(appId);
    } else {
      this.transport = new SdkFeishuTransport(appId, appSecret);
    }
    try {
      await this.transport.start(event => this.handleInbound(event));
    } catch (error) {
      this.transportError = `飞书长连接未启动：${(error as Error).message}`;
      await this.transport.close().catch(() => {});
      this.transport = null;
    }
  }

  // ---- sessions ------------------------------------------------------------

  private async createOwnedSession(kind: 'feishu' | 'local'): Promise<string> {
    const key = kind === 'feishu' ? 'accessSessionId' : 'localSessionId';
    const preset = 'pa24';
    const create = async (id: string) =>
      this.ctx.sessionController.create({ sessionId: id, workspaceId: this.workspace!.id, agentPreset: preset });
    try {
      await create(this[key]!);
    } catch (error) {
      if ((error as any)?.code !== 'agent-preset/conflict') throw error;
      const previous = this[key]!;
      this[key] = `pa24-${hash(this.workspace!.statePath).slice(0, 12)}-${kind}-${randomUUID().slice(0, 8)}`;
      await create(this[key]!);
      await this.repos!.workspaceState.save(this.workspace!.statePath, kind === 'feishu' ? { feishuSessionId: this[key]! } : { localSessionId: this[key]! });
      await this.notifyOwner(
        `notice:session-rebound:${this[key]}`,
        `旧会话 ${previous} 已选择其他预设，历史保留；24私助已建立新的${kind === 'feishu' ? '飞书接入' : '本地助理'}会话。`,
      );
    }
    return this[key]!;
  }

  private async establishSessions(): Promise<void> {
    await this.createOwnedSession('feishu');
    await this.ctx.sessionController.rename({ sessionId: this.accessSessionId!, title: '24私助 · 飞书接入会话' }).catch(() => {});
    await this.createOwnedSession('local');
    await this.ctx.sessionController.rename({ sessionId: this.localSessionId!, title: '24私助' }).catch(() => {});
  }

  async openLocalSession(): Promise<string> {
    if (!this.localSessionId) await this.establishSessions();
    return this.localSessionId!;
  }

  roleFor(agent: DshAgent | undefined): RuntimeRole {
    if (!agent || !this.workspace || agent.session.header.cwd !== this.workspace.statePath) return null;
    if (agent.id === this.accessSessionId) return 'feishu-access';
    if (this.workItemByChild.has(agent.id)) return 'worker';
    const header = agent.session.header;
    const isTopLevel = !header.parentSession && header.origin !== 'subagent';
    if (!isTopLevel) return null;
    const preset = this.ctx.agentPresets?.composedPreset(agent.ctx as DshContext) ?? header.agentPreset;
    if (preset === 'pa24' && !agent.parentAgent) return 'local-robot';
    return null;
  }

  private readonly workItemByChild = new Map<string, WorkItemRow>();
  private trackWorkItem(item: WorkItemRow): void {
    if (this.workItemByChild.size > 500) {
      for (const [id, row] of this.workItemByChild) {
        if (['completed', 'failed', 'stopped'].includes(row.status)) this.workItemByChild.delete(id);
      }
    }
    this.workItemByChild.set(item.id, item);
  }

  getTransport(): FeishuTransport | null {
    return this.transport;
  }

  /** Quiet hours / vacation read from the memory authority at dispatch time. */
  private readonly silencePolicy: SilencePolicy = {
    silentUntil: async () => {
      try {
        const now = new Date();
        const vacation = await this.memory!.search({ topic: '休假', limit: 20 });
        for (const record of vacation.records) {
          if (record.status !== 'confirmed') continue;
          const end = record.validUntil ? new Date(record.validUntil) : null;
          if (!end || Number.isNaN(end.getTime())) continue;
          if (end.getTime() > now.getTime()) return end;
        }
        const quiet = await this.memory!.search({ topic: '通知偏好', limit: 20 });
        const tz = this.config?.timeZone ?? 'Asia/Shanghai';
        for (const record of quiet.records) {
          if (record.status !== 'confirmed') continue;
          const match = record.content.match(/安静时段\s*(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})/);
          if (!match) continue;
          const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23' });
          const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
          const minutesNow = Number(parts.hour) * 60 + Number(parts.minute);
          const start = Number(match[1]) * 60 + Number(match[2]);
          const endMin = Number(match[3]) * 60 + Number(match[4]);
          const inWindow = start <= endMin ? minutesNow >= start && minutesNow < endMin : minutesNow >= start || minutesNow < endMin;
          if (!inWindow) continue;
          const end = new Date(now.getTime() + ((endMin - minutesNow + 1440) % 1440 || 1440) * 60_000);
          return end;
        }
        return null;
      } catch (error) {
        // Fail open, but visibly: a broken preference must not silently
        // garble reminders without a trace.
        console.warn(`[pa24] 读取免打扰偏好失败（按不静默处理）：${(error as Error).message}`);
        return null;
      }
    },
  };

  /** One durable owner notification with a stable dedup key. */
  private async notifyOwner(dedupKey: string, text: string): Promise<void> {
    if (!this.config?.ownerOpenId) return; // unbound/demo: nothing to address yet
    await this.repos!.outbox.enqueue({
      dedupKey,
      channel: 'feishu',
      target: this.config.ownerOpenId,
      kind: 'text',
      content: { text },
    });
  }

  // ---- inbound: durable inbox before ACK -----------------------------------

  async handleInbound(event: InboundEvent): Promise<void> {
    const config = this.config;
    if (!config || !this.repos) throw new Error('24私助尚未就绪。');
    this.lastReceivedAt = nowIso();
    const expectedApp = this.env[config.appIdEnv] ?? '';
    const appId = event.appId || expectedApp;
    // Rejections are written atomically: a 'received' row could otherwise be
    // claimed by the dispatcher between insert and mark.
    const reject = async (reason: string): Promise<void> => {
      await this.repos!.inbox.insertRejected(
        { eventId: event.eventId, source: 'feishu', kind: event.kind === 'card' ? 'card' : 'message', payload: event },
        reason,
      );
    };

    if (event.kind === 'message' && event.chatType !== 'p2p') {
      await reject('仅处理主人私聊消息。');
      return;
    }
    if (config.ownerOpenId && event.senderOpenId !== config.ownerOpenId) {
      await reject('发送者不是已绑定的主人。');
      return;
    }
    if (expectedApp && event.appId && event.appId !== expectedApp) {
      await reject('事件来自另一个应用，不属于本24私助。');
      return;
    }
    if (appId && event.tenantKey) {
      const tenants = await this.repos.bindings.tenantsFor(appId, config.ownerOpenId);
      if (tenants.length > 0 && !tenants.includes(event.tenantKey)) {
        await reject('事件来自另一个租户，与已绑定的主人身份不一致。');
        return;
      }
    }
    const { inserted } = await this.repos.inbox.insert({
      eventId: event.eventId,
      source: 'feishu',
      kind: event.kind === 'card' ? 'card' : 'message',
      payload: event,
    });
    if (!inserted) {
      // Platform redelivery of an event we already own; never process twice.
      return;
    }
    if (config.mode === 'feishu') {
      await this.repos.bindings.upsert({
        appId,
        tenantKey: event.tenantKey || 'unknown',
        ownerOpenId: config.ownerOpenId,
        larkProfile: config.larkProfile,
        chatId: event.chatId,
      });
    }
    void this.kickDispatcher();
  }

  private kickDispatcher(): void {
    if (this.dispatching || this.closed) return;
    this.dispatching = true;
    void this.dispatchLoop().catch(() => {}).finally(() => {
      this.dispatching = false;
    });
  }

  private async dispatchLoop(): Promise<void> {
    if (!this.repos) return;
    for (;;) {
      const rows = await this.repos.inbox.claim(5);
      if (rows.length === 0) return;
      for (const row of rows) {
        try {
          await this.processInbox(row);
        } catch (error) {
          await this.repos.inbox.mark(row.event_id, { status: 'rejected', error: (error as Error).message }).catch(() => {});
        }
      }
    }
  }

  private async processInbox(row: { event_id: string; kind: string; payload: any }): Promise<void> {
    if (!this.config || !this.repos) return;
    const event = row.payload as InboundEvent;
    if (row.kind === 'card') {
      await this.processReviewCard(row.event_id, event);
      return;
    }
    const isInboundImage = event.messageType === 'image' || this.isImageFileMessage(event);
    // Replies pin to their original target before any fresh handling: a photo
    // answering a note ack appends a page to that note instead of opening a
    // new one (P28: never auto-merge different discussions).
    if (event.parentMessageId && isInboundImage) {
      const route = await this.repos.messageRoutes.lookup(event.parentMessageId);
      if (route?.note_id) {
        await this.collectNotePage(row.event_id, event, route.note_id);
        return;
      }
    }
    if (isInboundImage) {
      await this.collectNotePage(row.event_id, event, null);
      return;
    }
    const input = String(event.text ?? '').trim();
    if (!input) {
      await this.repos.inbox.mark(row.event_id, { status: 'rejected', error: '空消息' });
      return;
    }
    if (input === '/24pa' || input === '/帮助') {
      const ready = this.readiness();
      const pg = ready.items.find(i => i.id === 'postgres');
      await this.notifyOwner(
        `status:${event.eventId}`,
        [
          '24私助已收到你的消息。',
          `绑定：${this.config.ownerOpenId ? '已按配置绑定主人' : '尚未在配置中绑定主人'}`,
          `业务账本（PostgreSQL）：${pg?.state === 'ok' ? '正常' : pg?.message ?? '未知'}`,
          '直接告诉我需要办理什么；也可以说“查看正在处理的事”。配置与记忆维护请到 dsh 的24私助会话。',
        ].join('\n'),
      );
      await this.repos.inbox.mark(row.event_id, { status: 'delivered', requestId: `status:${event.eventId}` });
      return;
    }
    // A reply to one of our messages is pinned to its original target
    // (work item / note / object); it never falls back to a fresh delegation.
    if (event.parentMessageId) {
      const route = await this.repos.messageRoutes.lookup(event.parentMessageId);
      if (!route) {
        await this.notifyOwner(
          `route-unknown:${event.eventId}`,
          '这条引用没有可恢复的事项记录；请直接说明需要办理什么，或告诉我事项名称。',
        );
        await this.repos.inbox.mark(row.event_id, { status: 'rejected', error: '引用目标未知' });
        return;
      }
      if (route.work_item_id) {
        await this.followUpWorkItem(route.work_item_id, input, row.event_id);
        return;
      }
      if (route.note_id) {
        const note = await this.repos.notes.getNote(route.note_id);
        const pages = note ? await this.repos.notes.pagesOf(note.id) : [];
        const saved = pages.filter(p => p.status === 'saved').length;
        await this.establishSessions();
        const requestId = `feishu:${event.eventId}`;
        const content: ContentBlock[] = [
          {
            type: 'text',
            text: `${input}\n\n[关联手写笔记：${note?.id ?? route.note_id}（已收 ${saved} 页原稿）。需要识别整理时用 pa24_delegate 委派 handwriting 并传 noteId=${note?.id ?? route.note_id}；当前时间 ${nowIso()}，用户时区 ${this.config.timeZone}。]`,
          },
        ];
        await this.gate(this.accessSessionId!, () =>
          this.submitToSession(this.accessSessionId!, requestId, content, this.config!.timeZone, row.event_id),
        );
        return;
      }
      // reply/status routes point at the access session conversation itself
    }
    // Regular delegation: durable admission into the fixed access session.
    await this.establishSessions();
    const requestId = `feishu:${event.eventId}`;
    const content: ContentBlock[] = [
      {
        type: 'text',
        text: `${input}\n\n[接入信息：当前时间 ${nowIso()}，用户时区 ${this.config.timeZone}。]`,
      },
    ];
    await this.gate(this.accessSessionId!, () =>
      this.submitToSession(this.accessSessionId!, requestId, content, this.config!.timeZone, row.event_id),
    );
  }

  /** Pin a follow-up to its original work item: resume the same native child. */
  private async followUpWorkItem(workItemId: string, input: string, inboxEventId: string): Promise<void> {
    const item = await this.repos!.workItems.get(workItemId);
    if (!item) {
      await this.notifyOwner(`route-missing:${inboxEventId}`, '引用的事项已不存在；请直接说明需要办理什么。');
      await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: '引用事项不存在' });
      return;
    }
    if (!item.child_session_id) {
      await this.notifyOwner(`route-notstarted:${inboxEventId}`, `「${item.title}」尚无原生 Worker 会话，无法续办；请重新委派。`);
      await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: '事项未启动' });
      return;
    }
    if (item.status === 'stopped') {
      // User-stopped items stay stopped (P07); a reply must not resurrect them.
      await this.notifyOwner(`route-stopped:${inboxEventId}`, `「${item.title}」已按你的要求停止；如需继续请明确说明“继续 ${item.title}”。`);
      await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: '事项已停止，不因引用复活' });
      return;
    }
    const previousStatus = item.status;
    if (['running', 'queued', 'accepted'].includes(item.status)) {
      // Running children receive the supplement at the nearest step boundary.
      await this.repos!.workItems.update(item.id, { progress: '收到补充输入，等待 Worker 处理' });
    } else {
      await this.repos!.workItems.update(item.id, { status: 'running', progress: '按引用继续处理' });
    }
    try {
      const parent = await this.ctx.sessionController.resolveAgent(item.parent_session_id);
      if ('error' in parent) throw parent.error;
      await this.ctx.subagents.sendMessage(
        parent.agent,
        item.child_session_id,
        [{ type: 'text', text: `[本人补充] ${input}\n\n[路由依据：引用原事项「${item.title}」]` }],
        { signal: this.lifetime.signal },
      );
    } catch (error) {
      // Never leave the item dangling in running without a listener.
      await this.repos!.workItems.update(item.id, { status: previousStatus as any, progress: `补充输入未送达：${(error as Error).message}` });
      throw error;
    }
    await this.repos!.inbox.mark(inboxEventId, { status: 'admitted', targetSession: item.child_session_id, requestId: `followup:${inboxEventId}` });
  }

  private async submitToSession(sessionId: string, requestId: string, content: ContentBlock[], timeZone: string, inboxId: string): Promise<void> {
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId);
    if ('error' in resolved) throw resolved.error;
    const result = await this.ctx.sessionController.prompt(
      { requestId, sessionId, mode: 'queue', content, clientTimeZone: timeZone },
      this.lifetime.signal,
    );
    if ('error' in result) throw result.error;
    await this.ctx.sessions.flush(resolved.agent.session);
    if (inboxId) {
      await this.repos!.inbox.mark(inboxId, { status: 'admitted', requestId, targetSession: sessionId });
      const queue = this.pendingDeliveries.get(sessionId) ?? [];
      queue.push({ inboxId, sessionId });
      this.pendingDeliveries.set(sessionId, queue);
    }
  }

  // ---- session events: committed results become deliveries -----------------

  onSessionEvent(session: DshSession, event: { type: string; data: Record<string, any> }): void {
    if (this.closed || event.type !== 'turn/end') return;
    void this.enqueue(() => this.onTurnEnd(session, event)).catch(() => {});
  }

  private async onTurnEnd(session: DshSession, event: { data: Record<string, any> }): Promise<void> {
    if (!this.repos || !this.config) return;
    await this.ctx.sessions.flush(session).catch(() => {});
    const turn = event.data.turn;
    const failure = event.data.reason?.error;
    const messages = session
      .ownEvents()
      .filter(e => e.type === 'assistant/message' && e.data.turn === turn && !e.data.interrupted);
    const output = textOf(messages.at(-1)?.data?.message?.content);

    if (session.id === this.accessSessionId) {
      const queue = this.pendingDeliveries.get(session.id) ?? [];
      const pending = queue.shift();
      this.pendingDeliveries.set(session.id, queue);
      const reply = failure
        ? `本轮未完成：${failure.code === 'MISSING_CREDENTIAL' ? 'dsh 尚未配置模型，请先在模型设置中配置。' : failure.message ?? '模型执行失败'}`
        : output || '（本轮没有产生回复）';
      if (pending) {
        await this.notifyOwner(`reply:${pending.inboxId}:${turn}`, reply);
        await this.repos.inbox.mark(pending.inboxId, {
          status: failure ? 'rejected' : 'delivered',
          error: failure?.message,
        });
      }
      return;
    }

    const item = this.workItemByChild.get(session.id);
    if (!item) return;
    const fresh = await this.repos.workItems.get(item.id);
    if (!fresh || !['running', 'queued'].includes(fresh.status)) return;
    if (failure || !output) {
      await this.repos.workItems.update(item.id, {
        status: 'failed',
        progress: failure?.message ?? 'Worker 未产生结果',
      });
      await this.deliverWorkItemResult(item.id, `「${fresh.title}」未完成：${failure?.message ?? 'Worker 未产生结果'}`, turn);
      return;
    }
    await this.repos.workItems.update(item.id, {
      status: 'completed',
      result: output,
      progress: 'Worker 已完成，结果已交回',
    });
    await this.deliverWorkItemResult(item.id, output, turn);
    // Follow-up inputs routed to this child are settled by this turn.
    await this.dbRef
      .query(
        `update pa24.inbox set status = 'delivered', processed_at = now() where target_session = $1 and status = 'admitted'`,
        [item.id],
      )
      .catch(() => {});
  }

  private async deliverWorkItemResult(workItemId: string, output: string, turn?: number): Promise<void> {
    if (!this.repos || !this.config) return;
    const item = await this.repos.workItems.get(workItemId);
    if (!item) return;
    if (item.origin === 'feishu') {
      const ref = item.result_ref as { docUrl?: string; operationId?: string; noteId?: string; versionId?: string } | null;
      const source = ref?.docUrl ? `\n出处：${ref.docUrl}\n操作编号：${ref.operationId}` : '';
      await this.notifyOwner(`workitem:${workItemId}:result:t${turn ?? 'n'}`, `「${item.title}」已完成：\n${output}${source}`);
      return;
    }
    // Local origin: report back inside the originating 24私助 session.
    const requestId = `workitem:${workItemId}:delivery`;
    await this.gate(item.parent_session_id, async () => {
      const resolved = await this.ctx.sessionController.resolveAgent(item.parent_session_id);
      if ('error' in resolved) return;
      const result = await this.ctx.sessionController.prompt(
        {
          requestId,
          sessionId: item.parent_session_id,
          mode: 'queue',
          content: [{ type: 'text', text: `[事项回传]「${item.title}」已完成，Worker 结果如下；请向本人汇报要点与出处。\n\n${output}` }],
          clientTimeZone: this.config!.timeZone,
        },
        this.lifetime.signal,
      ).catch(() => null);
      if (result && !('error' in result)) await this.ctx.sessions.flush(resolved.agent.session);
    });
  }

  // ---- delegation & worker control -----------------------------------------

  async delegate(args: { worker: string; title: string; instruction: string; noteId?: string }, agent: DshAgent): Promise<unknown> {
    const role = this.roleFor(agent);
    if (role !== 'feishu-access' && role !== 'local-robot') throw new Error('只有24私助会话可以委派 Worker。');
    const config = this.config!;
    const roleDef = this.roles.get(String(args.worker));
    if (!roleDef) {
      throw new Error(`未注册的 Worker 类型：${args.worker}。已注册：${this.roles.list().map(r => r.id).join(', ')}。`);
    }
    if (!roleDef.available) throw new Error(`「${roleDef.name}」已注册但业务能力尚未交付（${roleDef.brief}）`);
    if (!config.enabledWorkers.includes(String(args.worker))) throw new Error('此 Worker 未在配置中启用（enabledWorkers）。');
    const title = text(args.title, 200);
    const instruction = text(args.instruction);
    let note: NoteRow | null = null;
    if (String(args.worker) === 'handwriting') {
      if (!args.noteId || !String(args.noteId).trim()) throw new Error('手写整理需要携带 noteId（先由飞书拍照收集原稿，编号形如 N-1）。');
      note = await this.repos!.notes.getNote(String(args.noteId).trim());
      if (!note) throw new Error(`笔记 ${args.noteId} 不存在；请先用飞书拍照发送手写页。`);
      if (note.work_item_id) {
        const existing = await this.repos!.workItems.get(note.work_item_id);
        if (existing && ['accepted', 'queued', 'running', 'waiting_input'].includes(existing.status)) {
          throw new Error(`这页笔记已有进行中的事项（${note.work_item_id}）；请查看或继续原事项，不要重复委派。`);
        }
      }
      const saved = (await this.repos!.notes.pagesOf(note.id)).filter(p => p.status === 'saved');
      if (saved.length === 0) throw new Error(`笔记 ${note.id} 没有已保存的原稿页；请重新拍照收集。`);
      if (saved.length > RECOGNITION_PAGE_LIMIT) {
        throw new Error(`笔记 ${note.id} 有 ${saved.length} 页，超过单次识别预算（${RECOGNITION_PAGE_LIMIT} 页）；请把批次拆成多份笔记分别整理（已完成页与原稿都会保留）。`);
      }
      // Recognition needs a real vision route; the host default model cannot be
      // assumed to accept images (capability gap must fail loudly, P29).
      if (!config.workerModels.handwriting) throw new Error('手写识别需要单独配置视觉模型路由（AGENTS.md workerModels.handwriting：provider/model）；主助理模型与识别模型分开配置。');
      this.assertFeishuLive('手写整理');
    }
    const origin: 'feishu' | 'local' = agent.id === this.accessSessionId ? 'feishu' : 'local';
    const id = `pa24-work-${args.worker}-${randomUUID()}`;
    const persona = { name: roleDef.name, persona: roleDef.persona, brief: roleDef.brief };
    const item = await this.repos!.workItems.insert({
      id,
      title,
      role: args.worker,
      instruction: `${instruction}\n\n当前时间：${nowIso()}；时区：${config.timeZone}。\n${persona.brief}`,
      origin,
      parent_session_id: agent.id,
      child_session_id: id,
      delivery: origin === 'feishu' ? `feishu:${config.ownerOpenId}` : `local:${agent.id}`,
      status: 'accepted',
    });
    if (note) await this.repos!.notes.updateNote(note.id, { work_item_id: id });
    this.trackWorkItem(item);
    await this.repos!.workItems.update(id, { status: 'queued', progress: '排队等待 Worker' });
    await this.pump();
    const fresh = await this.repos!.workItems.get(id);
    return { workId: id, worker: args.worker, status: fresh?.status, message: '事项已接纳；接纳不代表完成。' };
  }

  async pump(): Promise<void> {
    if (!this.repos || !this.config) return;
    const running = await this.repos.workItems.countByStatus('running');
    let slots = Math.max(0, this.config.maxWorkers - running);
    if (slots === 0) return;
    const queued = await this.repos.workItems.list(['queued'], 20);
    for (const item of queued) {
      if (slots <= 0) break;
      slots -= 1;
      await this.repos.workItems.update(item.id, { status: 'running', progress: 'Worker 正在处理' });
      this.trackWorkItem(item);
      try {
        const parent = await this.ctx.sessionController.resolveAgent(item.parent_session_id);
        if ('error' in parent) throw parent.error;
        const roleDef = this.roles.get(item.role);
        if (!roleDef) throw new Error(`Worker 类型未注册：${item.role}`);
        const persona = { name: roleDef.name, persona: roleDef.persona, brief: roleDef.brief };
        const modelRoute = this.config.workerModels[item.role];
        // Handwriting children receive the saved originals inline; the dsh
        // attachment service persists them and the vision route carries them
        // to the model (P29: the request really contains the image).
        // startContinuable itself does NOT admit image parts (only the
        // subagent prompt remote does), so admission happens here: inline
        // base64 blocks would otherwise persist unadmitted and break the
        // model request.
        let prompt: ContentBlock[] = [{ type: 'text', text: `事项：${item.title}\n委托内容：\n${item.instruction}` }];
        const note = await this.repos.notes.noteByWorkItem(item.id);
        if (item.role === 'handwriting' && note) {
          const savedPages = (await this.repos.notes.pagesOf(note.id)).filter(p => p.status === 'saved');
          const { readFile } = await import('node:fs/promises');
          const imageBlocks: ContentBlock[] = [];
          for (const page of savedPages) {
            const bytes = await readFile(page.storage_path);
            imageBlocks.push({ type: 'image', mediaType: page.media_type, data: bytes.toString('base64') });
          }
          if (imageBlocks.length > 0) {
            const attachments = this.ctx.get('attachments');
            if (!attachments || typeof attachments.admitPromptContent !== 'function') {
              throw new Error('手写识别需要宿主附件服务（attachments）；当前 Host 未提供。');
            }
            const head = prompt[0] as { text: string };
            prompt = [
              ...imageBlocks,
              { type: 'text', text: `${head.text}\n以上是笔记 ${note.id} 的原稿图片（按页序）。完成后调用 pa24_work action=note_submit 提交结构化结果。` },
            ];
            prompt = (await attachments.admitPromptContent(prompt)) as ContentBlock[];
          }
        }
        await this.ctx.subagents.startContinuable({
          provider: 'spawn',
          label: `${persona.name} · ${item.title}`,
          childId: item.id,
          signal: this.lifetime.signal,
          request: {
            parent: parent.agent,
            prompt,
            persona: persona.persona,
            // send_message arrives as an adjacent-agent scoped tool and is
            // unaffected by global restrict(); the child can still report to
            // its parent through the native continuation channel.
            toolFilter: { allow: ['pa24_work', 'pa24_memory', ...(roleDef.tools ?? [])] },
            maxDepth: 1,
            ...(modelRoute ? { agentOptions: { provider: modelRoute.provider, model: modelRoute.model } as any } : {}),
          },
        });
      } catch (error) {
        await this.repos.workItems.update(item.id, { status: 'failed', progress: `Worker 未启动：${(error as Error).message}` });
      }
    }
  }

  async control(args: { action: string; workId?: string; instruction?: string }, agent: DshAgent): Promise<unknown> {
    const role = this.roleFor(agent);
    if (role !== 'feishu-access' && role !== 'local-robot') throw new Error('事项调度由24私助会话负责。');
    const repos = this.repos!;
    if (args.action === 'list') {
      const items = await repos.workItems.list(undefined, 50);
      return { items: items.map(({ instruction, result_ref, ...view }) => view) };
    }
    const id = String(args.workId ?? '');
    const item = await repos.workItems.get(id);
    if (!item) throw new Error('事项不存在。');
    if (args.action === 'inspect') {
      const { instruction, result_ref, ...view } = item;
      return view;
    }
    if (args.action === 'stop') {
      if (!['running', 'queued', 'accepted'].includes(item.status)) throw new Error('此事项已结束。');
      await repos.workItems.update(id, { status: 'stopped', progress: '本人要求停止；已完成的外部操作保留' });
      this.ctx.subagents.interrupt(id, { kind: 'user', parentSessionId: item.parent_session_id });
      return { workId: id, status: 'stopped' };
    }
    if (args.action === 'continue') {
      if (!item.child_session_id) throw new Error('此事项尚无原生 Worker 会话，请核对后重新委派。');
      if (['running', 'queued'].includes(item.status)) throw new Error('事项正在运行或排队中。');
      const running = await repos.workItems.countByStatus('running');
      if (running >= this.config!.maxWorkers) throw new Error('Worker 并发已满，请稍后继续。');
      await repos.workItems.update(id, { status: 'running', progress: '继续处理' });
      const parent = await this.ctx.sessionController.resolveAgent(item.parent_session_id);
      if ('error' in parent) throw parent.error;
      await this.ctx.subagents.sendMessage(
        parent.agent,
        id,
        [{ type: 'text', text: text(args.instruction ?? '请继续处理本事项。', 2000) }],
        { signal: this.lifetime.signal },
      );
      return { workId: id, status: 'running' };
    }
    throw new Error('未知事项操作。');
  }

  async work(args: Record<string, unknown>, agent: DshAgent): Promise<unknown> {
    // The child session id is the work item id; consult the durable ledger
    // for the live status instead of a cached snapshot.
    if (!this.repos) throw new Error('业务账本未就绪。');
    const item = await this.repos.workItems.get(agent.id);
    if (!item || item.status !== 'running') {
      throw new Error('此会话不是运行中的 Worker，或事项已停止。');
    }
    const role = this.roles.get(item.role);
    const handler = role?.actions[String(args.action ?? '')];
    if (!handler) throw new Error(`此 Worker 没有执行这项操作的权限（${item.role}/${String(args.action ?? '')}）。`);
    return handler(args, item, this);
  }

  /**
   * pa24_memory: search is open to every workspace role; writes, maintenance
   * and undo require the local top-level 24私助 session (P42/P43).
   */
  async memoryTool(args: Record<string, unknown>, agent: DshAgent): Promise<unknown> {
    const role = this.roleFor(agent);
    if (!role || !this.memory || !this.workspace) throw new Error('记忆仅对绑定的 24私助 工作区会话开放。');
    const action = String(args.action ?? 'search');
    const readOnly: Record<string, boolean> = {
      search: true,
      put: false,
      delete: false,
      inspect: true,
      apply: false,
      undo: false,
      changesets: true,
    };
    if (!(action in readOnly)) throw new Error('未知记忆操作。');
    if (!readOnly[action] && role !== 'local-robot') {
      throw new Error('记忆写入与整理仅限 dsh 的24私助本地会话；飞书接入与 Worker 只能检索。');
    }
    const actor = agent.id;
    if (action === 'search') {
      return this.memory.search({
        query: args.query ? String(args.query) : undefined,
        category: args.category ? String(args.category) : undefined,
        topic: args.topic ? String(args.topic) : undefined,
        status: args.status ? String(args.status) : undefined,
        limit: Number(args.limit ?? 20),
        offset: Number(args.offset ?? 0),
      });
    }
    if (action === 'inspect') {
      return this.memory.inspect(args.topic ? { topic: String(args.topic) } : undefined);
    }
    if (action === 'changesets') {
      return { changesets: await this.memory.listChangesets() };
    }
    if (action === 'put') {
      const expectedRevision = requireRevision(args.expectedRevision);
      if (!String(args.reason ?? '').trim()) throw new Error('记忆修订需说明本人的指令依据。');
      return this.memory.put(
        {
          id: args.id ? String(args.id) : undefined,
          category: requireCategory(args.category),
          topic: String(args.topic ?? ''),
          content: text(args.content),
          source: text(args.source, 500),
          sourceVersion: args.sourceVersion ? String(args.sourceVersion) : undefined,
          status: requireStatus(args.status),
          validUntil: args.validUntil ? String(args.validUntil) : null,
          reason: String(args.reason),
        },
        { expectedRevision, actor, reason: String(args.reason) },
      );
    }
    if (action === 'delete') {
      const expectedRevision = requireRevision(args.expectedRevision);
      if (!String(args.reason ?? '').trim()) throw new Error('记忆修订需说明本人的指令依据。');
      return this.memory.remove(String(args.id ?? ''), { expectedRevision, actor, reason: String(args.reason) });
    }
    if (action === 'apply') {
      const expectedRevision = requireRevision(args.expectedRevision);
      if (!String(args.reason ?? '').trim()) throw new Error('记忆整理需说明本人的指令依据。');
      const changes = Array.isArray(args.changes) ? (args.changes as MemoryChange[]) : [];
      if (changes.length === 0) throw new Error('变更集为空；请先通过 inspect 查看候选并让本人确认。');
      return this.memory.applyChangeset(changes, { expectedRevision, actor, reason: String(args.reason) });
    }
    if (action === 'undo') {
      const expectedRevision = requireRevision(args.expectedRevision);
      if (!String(args.reason ?? '').trim()) throw new Error('撤销需说明本人的指令依据。');
      return this.memory.undo(String(args.changesetId ?? ''), { expectedRevision, actor, reason: String(args.reason) });
    }
    throw new Error('未知记忆操作。');
  }

  // ---- calendar (F04) -------------------------------------------------------

  private async calendarQuery(args: Record<string, unknown>): Promise<unknown> {
    const calendarId = String(args.calendarId ?? this.config!.calendarId);
    const { from, to } = parseZonedRange(args);
    const sync = await this.syncCalendarWindow(calendarId, from, to);
    const events = await this.repos!.calendar.eventsIn(calendarId, from, to);
    const conflicts: { a: string; b: string }[] = [];
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        if (events[i]!.end_time > events[j]!.start_time && events[j]!.end_time > events[i]!.start_time) {
          conflicts.push({ a: events[i]!.event_id, b: events[j]!.event_id });
        }
      }
    }
    const state = await this.repos!.calendar.getSync(calendarId);
    return {
      calendarId,
      from: isoDate(from),
      to: isoDate(to),
      fresh: sync.ok,
      syncedAt: isoDate(state?.last_synced_at ?? null),
      message: sync.ok
        ? `共 ${events.length} 个日程（不含已取消）；冲突 ${conflicts.length} 处。`
        : `本次同步失败（${sync.error}）；以下为投影数据，可能过期，不视为完整日历。`,
      conflicts: conflicts.map(c => ({
        a: events.find(e => e.event_id === c.a)!.summary,
        b: events.find(e => e.event_id === c.b)!.summary,
      })),
      events: events.map(e => ({
        eventId: e.event_id,
        summary: e.summary,
        start: isoDate(e.start_time),
        end: isoDate(e.end_time),
        allDay: e.is_all_day,
        timezone: e.timezone,
        recurring: e.recurring,
        url: e.url,
      })),
    };
  }

  private async calendarBusy(args: Record<string, unknown>): Promise<unknown> {
    const calendarId = String(args.calendarId ?? this.config!.calendarId);
    const { from, to } = parseZonedRange(args);
    const sync = await this.syncCalendarWindow(calendarId, from, to);
    const events = await this.repos!.calendar.eventsIn(calendarId, from, to);
    return {
      fresh: sync.ok,
      message: sync.ok ? `该时段忙闲如下（${events.length} 项）。` : `本次同步失败（${sync.error}）；展示投影，可能过期。`,
      busy: events.map(e => ({ summary: e.summary, start: isoDate(e.start_time), end: isoDate(e.end_time), allDay: e.is_all_day })),
    };
  }

  private async calendarWrite(item: WorkItemRow, kind: 'create' | 'update' | 'cancel', args: Record<string, unknown>): Promise<unknown> {
    const calendarId = String(args.calendarId ?? this.config!.calendarId);
    const summary = kind === 'cancel' ? null : args.summary === undefined ? null : text(args.summary, 500);
    const start = args.start !== undefined ? new Date(String(args.start)) : null;
    const end = args.end !== undefined ? new Date(String(args.end)) : null;
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw new Error('日程时间需为可解析的 ISO 时间。');
    if (start && end && end <= start) throw new Error('结束时间须晚于开始时间。');
    if (kind === 'create' && (!summary || !start || !end)) throw new Error('创建需要 summary、start、end。');
    const eventId = kind === 'create' ? '' : String(args.eventId ?? '');
    if (kind !== 'create' && !eventId) throw new Error('需要 eventId（可先 calendar_query 查询）。');
    if (kind === 'update' && !summary && !start && !end) throw new Error('需要至少一项修改（summary/start/end）。');
    const attendees = Array.isArray(args.attendees) ? (args.attendees as string[]) : null;
    const paramsKey = `${calendarId}\n${kind}\n${eventId}\n${summary ?? ''}\n${start?.toISOString() ?? ''}\n${end?.toISOString() ?? ''}\n${(attendees ?? []).join(',')}`;
    return this.gate(`calendar-event:${eventId || 'new'}`, async () => {
    const staged = await this.stagedOperation(
      item,
      `calendar.${kind}`,
      paramsKey,
      { calendarId, kind, eventId, summary, start, end },
      '请先用 calendar_query 重新同步窗口核对日程实际状态，确认后再继续。',
    );
    if (!staged.created && staged.row.status === 'succeeded') {
      return { operationId: staged.row.id, reused: true, ...(staged.row.receipt ?? {}), message: '此日程操作此前已提交，未重复写入。' };
    }
    try {
      const cliArgs = ['calendar', kind === 'create' ? '+create' : kind === 'update' ? '+update' : '+delete', '--as', 'user', '--calendar-id', calendarId];
      if (kind === 'create') {
        cliArgs.push('--summary', `[24PA] ${summary}`, '--start', start!.toISOString(), '--end', end!.toISOString());
        if (attendees && attendees.length > 0) cliArgs.push('--attendee-ids', attendees.join(','));
      } else if (kind === 'update') {
        cliArgs.push('--event-id', eventId);
        if (summary) cliArgs.push('--summary', `[24PA] ${summary}`);
        if (start) cliArgs.push('--start', start.toISOString());
        if (end) cliArgs.push('--end', end.toISOString());
      } else {
        cliArgs.push('--event-id', eventId);
      }
      const { data } = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), cliArgs);
      const event = data?.event ?? data;
      const newEventId = String(event?.event_id ?? event?.eventId ?? eventId);
      const url = event?.url ? String(event.url) : null;
      if (newEventId && (kind === 'create' || kind === 'update')) {
        // Merge with the prior projection and the platform receipt; never
        // fabricate times that neither the request nor the receipt provided.
        const prior = await this.repos!.calendar.findEvent(newEventId);
        const receiptStart = Date.parse(String(event?.start_time ?? event?.start ?? '')) ? new Date(String(event.start_time ?? event.start)) : null;
        const receiptEnd = Date.parse(String(event?.end_time ?? event?.end ?? '')) ? new Date(String(event.end_time ?? event.end)) : null;
        const startTime = start ?? receiptStart ?? prior?.start_time;
        const endTime = end ?? receiptEnd ?? prior?.end_time;
        if (!startTime || !endTime) {
          // No trustworthy time source: refresh the window instead of guessing.
          await this.syncCalendarWindow(calendarId, new Date(Date.now() - 24 * 3600 * 1000), new Date(Date.now() + 7 * 24 * 3600 * 1000)).catch(() => {});
        } else {
          await this.repos!.calendar.upsertEvent({
            event_id: newEventId,
            calendar_id: calendarId,
            summary: summary ?? String(event?.summary ?? prior?.summary ?? ''),
            start_time: startTime,
            end_time: endTime,
            is_all_day: prior?.is_all_day ?? false,
            timezone: prior?.timezone ?? null,
            status: 'active',
            recurring: prior?.recurring ?? false,
            attendees: attendees ?? prior?.attendees ?? null,
            url: url ?? prior?.url ?? null,
            raw: event,
          });
        }
      }
      if (kind === 'cancel' && eventId) {
        await this.repos!.calendar.markCanceled(eventId).catch(() => {});
        await this.notifySourceChanged('calendar', eventId, null);
      }
      await this.repos!.operations.update(staged.row.id, { status: 'succeeded', receipt: { eventId: newEventId, url, kind } });
      if (kind === 'update' && summary) {
        const prior = await this.repos!.calendar.findEvent(newEventId);
        await this.notifySourceChanged('calendar', newEventId, eventFingerprint({ event_id: newEventId, summary: prior?.summary ?? summary ?? '', start_time: prior?.start_time ?? start! }));
      }
      return {
        operationId: staged.row.id,
        eventId: newEventId,
        url,
        message: kind === 'create' ? '日程已创建（以平台回执为准）。' : kind === 'update' ? '日程已修改（以平台回执为准）。' : '日程已取消（以平台回执为准）。',
      };
    } catch (error) {
      await this.failStaged(staged.row.id, error);
      throw error;
    }
    });
  }

  /**
   * Meeting scheduling with explicit-invitation semantics (P12): attendees
   * come from explicit open ids or memory contact records; ambiguity must be
   * clarified before anything is sent.
   */
  private async meetingSchedule(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const title = text(args.title, 200);
    const start = new Date(String(args.start ?? ''));
    const end = new Date(String(args.end ?? ''));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error('会议需要明确的开始/结束时间（ISO，含时区）。');
    const attendeeInputs = Array.isArray(args.attendees) ? (args.attendees as Record<string, unknown>[]) : [];
    if (attendeeInputs.length === 0) throw new Error('需要提供参会人；没有参会人时用 calendar_create 建个人日程。');
    if (!String(args.instruction ?? '').trim()) throw new Error('缺少本人明确的邀请指令依据（instruction）。');
    const resolved: { name: string; openId: string }[] = [];
    const unresolved: string[] = [];
    for (const attendee of attendeeInputs) {
      const name = String(attendee.name ?? '').trim();
      const openId = String(attendee.openId ?? '').trim();
      if (openId) {
        resolved.push({ name: name || openId, openId });
        continue;
      }
      if (!name) {
        unresolved.push('未提供姓名或 openId 的参会人');
        continue;
      }
      const memory = await this.memory!.search({ query: name, limit: 50 });
      const contactRecords = memory.records.filter(r => (r.topic === `联系人：${name}` || r.content.includes(`联系人 ${name}：`)) && r.status === 'confirmed');
      const ids = [...new Set(contactRecords.flatMap(r => r.content.match(/ou_[A-Za-z0-9_]+/g) ?? []))];
      if (ids.length === 1) resolved.push({ name, openId: ids[0]! });
      else unresolved.push(`${name}（${ids.length === 0 ? '记忆中没有对应 open_id' : `记忆中有 ${ids.length} 位候选`}）`);
    }
    if (unresolved.length > 0) {
      throw new Error(`以下参会人无法唯一确定，请先澄清后再邀请：${unresolved.join('；')}。未发出任何邀请。`);
    }
    const result = (await this.calendarWrite(item, 'create', {
      summary: title,
      start: start.toISOString(),
      end: end.toISOString(),
      attendees: resolved.map(r => r.openId),
      calendarId: args.calendarId,
    })) as Record<string, unknown>;
    return {
      ...result,
      attendees: resolved,
      message: `已按本人明确指令创建会议并邀请 ${resolved.length} 位参会人（${resolved.map(r => r.name).join('、')}）；结果以平台回执为准。`,
    };
  }

  private async syncCalendarWindow(calendarId: string, from: Date, to: Date): Promise<{ ok: boolean; error?: string }> {
    try {
      const { data } = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
        'calendar', '+agenda', '--as', 'user', '--calendar-id', calendarId,
        '--start', from.toISOString().slice(0, 10), '--end', to.toISOString().slice(0, 10),
      ]);
      const raw = (data?.events ?? data?.items ?? data ?? []);
      // An unrecognized response shape means the full window is unknown;
      // never run destructive cancellation marking in that case.
      if (!Array.isArray(raw)) {
        await this.repos!.calendar.saveSync({ calendar_id: calendarId, window_start: from, window_end: to, complete: false, lastError: '同步返回形状无法识别' });
        return { ok: false, error: '同步返回形状无法识别' };
      }
      const live: string[] = [];
      for (const rawEvent of raw) {
        const mapped = mapRemoteEvent(rawEvent);
        if (!mapped) continue;
        const existing = await this.repos!.calendar.findEvent(mapped.eventId);
        if (existing) {
          const afterFp = eventFingerprint({ event_id: mapped.eventId, summary: mapped.summary, start_time: mapped.start });
          if (eventFingerprint(existing) !== afterFp) await this.notifySourceChanged('calendar', mapped.eventId, afterFp);
        }
        await this.repos!.calendar.upsertEvent({
          event_id: mapped.eventId,
          calendar_id: calendarId,
          summary: mapped.summary,
          start_time: mapped.start,
          end_time: mapped.end,
          is_all_day: mapped.isAllDay,
          timezone: mapped.timezone,
          status: mapped.canceled ? 'canceled' : 'active',
          recurring: mapped.recurring,
          attendees: mapped.attendees,
          url: mapped.url,
          raw: rawEvent,
        });
        live.push(mapped.eventId);
      }
      await this.repos!.calendar.markCanceledExcept(calendarId, live, from, to);
      // Remote cancellations surface through linked reminders too: any linked
      // event in this window that is no longer live gets its correction (P19).
      for (const eventId of await this.linkedEventIdsInWindow(from, to)) {
        if (!live.includes(eventId)) await this.notifySourceChanged('calendar', eventId, null);
      }
      await this.repos!.calendar.saveSync({ calendar_id: calendarId, window_start: from, window_end: to, complete: true });
      return { ok: true };
    } catch (error) {
      await this.repos!.calendar
        .saveSync({ calendar_id: calendarId, window_start: from, window_end: to, complete: false, lastError: (error as Error).message })
        .catch(() => {});
      return { ok: false, error: (error as Error).message };
    }
  }

  // ---- tasks & projects (F03) ----------------------------------------------

  /** Best-effort remote refresh folded into the projection; returns the fresh row or null. */
  private async refreshTaskFromRemote(task: TaskRow): Promise<TaskRow | null> {
    try {
      const { data } = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
        'task', '+search', '--as', 'user', '--query', task.summary.replace(/^\[24PA\] /, '').slice(0, 20),
      ]);
      const remote = (data?.tasks ?? data?.items ?? []).find((t: any) => String(t.guid ?? t.task_guid) === task.task_guid);
      if (!remote) return null;
      const status = remote.completed === true || remote.status === 'completed' ? 'completed' : 'open';
      return await this.repos!.tasks.save({
        ...task,
        summary: typeof remote.summary === 'string' && remote.summary ? remote.summary : task.summary,
        status,
        last_synced_at: new Date(),
        external_updated_at: new Date(),
      });
    } catch {
      return null;
    }
  }

  /** Record a staged operation's failure with the unknown/failed distinction. */
  private async failStaged(operationId: string, error: unknown): Promise<void> {
    const outcome = (error as any)?.outcome === 'unknown' ? 'unknown' : 'failed';
    await this.repos!.operations.update(operationId, { status: outcome, error: (error as Error).message });
  }

  private async stagedOperation(
    item: WorkItemRow,
    kind: string,
    paramsKey: string,
    params: Record<string, unknown>,
    reconcileHint = '请先核对远端实际对象，确认后再继续，不自动重试。',
  ): Promise<{ created: boolean; row: ActionOperationRow }> {
    const operationId = `${kind}:${item.id}:${hash(paramsKey)}`;
    const { created, row } = await this.repos!.operations.begin({ id: operationId, workItemId: item.id, action: kind, params });
    if (!created) {
      if (row.status === 'succeeded') return { created: false, row };
      if (row.status === 'unknown') {
        throw new Error(`上次操作结果未知（超时或响应丢失）；${reconcileHint}`);
      }
    }
    await this.repos!.operations.update(operationId, { status: 'running' });
    return { created: true, row };
  }

  private async taskCreate(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const summary = text(args.summary, 500);
    const { dueAt, dueHasTime, dueArg } = parseDue(args.due);
    const plannedAt = args.plannedAt ? new Date(String(args.plannedAt)) : null;
    if (plannedAt && Number.isNaN(plannedAt.getTime())) throw new Error('计划投入时间无法解析。');
    const estimateMinutes = args.estimateMinutes == null ? null : Number(args.estimateMinutes);
    if (estimateMinutes != null && (!Number.isFinite(estimateMinutes) || estimateMinutes < 0)) throw new Error('估时需为非负分钟数。');
    const batchSuffix = args.opSuffix ? `\n${String(args.opSuffix)}` : ''
    const staged = await this.stagedOperation(item, 'task.create', `${this.config!.tasklistId}\n${summary}\n${dueArg ?? ''}${batchSuffix}`, {
      tasklistId: this.config!.tasklistId,
      summary,
      due: dueArg,
    });
    if (!staged.created && staged.row.status === 'succeeded') {
      const existing = await this.repos!.tasks.get(staged.row.id);
      return { operationId: staged.row.id, reused: true, guid: existing?.task_guid ?? staged.row.receipt?.guid, url: existing?.url ?? staged.row.receipt?.url ?? null, message: '此任务此前已创建，未重复写入飞书。' };
    }
    try {
      const cliArgs = ['task', '+create', '--as', 'user', '--summary', `[24PA] ${summary}`, '--tasklist-id', this.config!.tasklistId, '--idempotency-key', staged.row.id];
      if (dueArg) cliArgs.push('--due', dueArg);
      const { data } = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), cliArgs);
      const external = taskExternal(data);
      const task = await this.repos!.tasks.save({
        id: staged.row.id,
        work_item_id: item.id,
        task_guid: external.guid,
        url: external.url,
        summary,
        due_at: dueAt,
        due_has_time: dueHasTime,
        planned_at: plannedAt,
        estimate_minutes: estimateMinutes == null ? null : Math.round(estimateMinutes),
        status: 'open',
        external_updated_at: new Date(),
        last_synced_at: new Date(),
      });
      if (args.projectId) await this.repos!.projects.link(String(args.projectId), task.id);
      await this.repos!.operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: external.guid, url: external.url, summary } });
      return { operationId: staged.row.id, guid: external.guid, url: external.url, dueAt: isoDate(task.due_at), plannedAt: isoDate(task.planned_at), estimateMinutes: task.estimate_minutes, message: '任务已创建（飞书为权威对象）。' };
    } catch (error) {
      await this.failStaged(staged.row.id, error);
      throw error;
    }
  }

  private async resolveTask(args: Record<string, unknown>) {
    const key = String(args.taskId ?? args.guid ?? '');
    const task = (await this.repos!.tasks.byGuid(key)) ?? (await this.repos!.tasks.get(key));
    if (!task) throw new Error('任务不存在；请先用 task_list 查看当前任务。');
    return task;
  }

  private async taskUpdate(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const taskRef = await this.resolveTask(args);
    const summary = args.summary == null ? null : text(args.summary, 500);
    const { dueAt, dueHasTime, dueArg } = parseDue(args.due === undefined ? null : args.due);
    const plannedAt = args.plannedAt === undefined ? undefined : args.plannedAt === null ? null : new Date(String(args.plannedAt));
    if (plannedAt && Number.isNaN(plannedAt.getTime())) throw new Error('计划投入时间无法解析。');
    const estimateMinutes = args.estimateMinutes === undefined ? undefined : args.estimateMinutes === null ? null : Number(args.estimateMinutes);
    if (!summary && args.due === undefined && plannedAt === undefined && estimateMinutes === undefined) {
      throw new Error('需要说明要修改的内容（summary、due、plannedAt 或 estimateMinutes）。');
    }
    return this.gate(`task:${taskRef.task_guid}`, async () => {
      // Re-read inside the gate and refresh from the remote so a stale
      // projection never overwrites another worker's or the owner's changes.
      const stale = await this.repos!.tasks.get(taskRef.id);
      if (!stale) throw new Error('任务不存在；请先用 task_list 查看。');
      await this.refreshTaskFromRemote(stale);
      const task = (await this.repos!.tasks.get(taskRef.id)) ?? stale;
      const staged = await this.stagedOperation(item, 'task.update', `${task.task_guid}\n${summary ?? ''}\n${dueArg ?? ''}`, { guid: task.task_guid, summary, due: dueArg });
      if (!staged.created && staged.row.status === 'succeeded') {
        return { operationId: staged.row.id, reused: true, guid: task.task_guid, url: task.url, message: '此修改此前已提交，未重复写入。' };
      }
      try {
        const cliArgs = ['task', '+update', '--as', 'user', '--task-id', task.task_guid];
        if (summary) cliArgs.push('--summary', `[24PA] ${summary}`);
        if (dueArg) cliArgs.push('--due', dueArg);
        const { data } = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), cliArgs);
        const external = taskExternal({ task: { guid: task.task_guid, url: task.url, ...(data?.task ?? {}) } });
        const updated = await this.repos!.tasks.save({
          ...task,
          summary: summary ?? task.summary,
          due_at: dueArg !== null ? dueAt : task.due_at,
          due_has_time: dueArg !== null ? dueHasTime : task.due_has_time,
          planned_at: plannedAt === undefined ? task.planned_at : plannedAt,
          estimate_minutes: estimateMinutes === undefined ? task.estimate_minutes : estimateMinutes == null ? null : Math.round(estimateMinutes),
          external_updated_at: new Date(),
          last_synced_at: new Date(),
          url: external.url ?? task.url,
        });
        await this.repos!.operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: task.task_guid, summary: updated.summary } });
        await this.notifySourceChanged('task', task.task_guid, taskFingerprint(updated));
        return { operationId: staged.row.id, guid: task.task_guid, url: updated.url, summary: updated.summary, dueAt: isoDate(updated.due_at), message: '任务已按本人指令修改；截止与计划/估时分别记录。' };
      } catch (error) {
        await this.failStaged(staged.row.id, error);
        throw error;
      }
    });
  }

  private async taskComplete(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const taskRef = await this.resolveTask(args);
    return this.gate(`task:${taskRef.task_guid}`, async () => {
      // Idempotency check inside the gate, against the freshest remote state.
      const local = await this.repos!.tasks.get(taskRef.id);
      if (!local) throw new Error('任务不存在；请先用 task_list 查看。');
      const refreshed = (await this.refreshTaskFromRemote(local)) ?? local;
      if (refreshed.status === 'completed') {
        return { guid: refreshed.task_guid, status: 'completed', reused: true, message: '任务此前已是完成状态（含远端核对）。' };
      }
      const task = refreshed;
      const staged = await this.stagedOperation(item, 'task.complete', task.task_guid, { guid: task.task_guid });
      if (!staged.created && staged.row.status === 'succeeded') {
        await this.repos!.tasks.save({ ...task, status: 'completed' });
        return { operationId: staged.row.id, guid: task.task_guid, status: 'completed', reused: true, message: '此前已完成，未重复提交。' };
      }
      try {
        await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), ['task', '+complete', '--as', 'user', '--task-id', task.task_guid]);
        const updated = await this.repos!.tasks.save({ ...task, status: 'completed', last_synced_at: new Date(), external_updated_at: new Date() });
        await this.repos!.operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: task.task_guid, status: 'completed' } });
        return { operationId: staged.row.id, guid: updated.task_guid, url: updated.url, status: 'completed', message: '任务已完成（以飞书实际状态为准）。' };
      } catch (error) {
        await this.failStaged(staged.row.id, error);
        throw error;
      }
    });
  }

  private async taskGet(args: Record<string, unknown>): Promise<unknown> {
    const task = await this.resolveTask(args);
    const refreshed = await this.refreshTaskFromRemote(task);
    const view = refreshed ?? task;
    return {
      guid: view.task_guid,
      url: view.url,
      summary: view.summary,
      dueAt: isoDate(view.due_at),
      plannedAt: isoDate(view.planned_at),
      estimateMinutes: view.estimate_minutes,
      status: view.status,
      // stale = 本次未能核对到远端最新状态（刷新失败或未命中）
      stale: !refreshed,
      message: refreshed ? '已按飞书最新状态刷新。' : view.last_synced_at ? '本次远端核对未完成，展示此前同步的投影。' : '本地投影（远端核对未完成，状态可能滞后）。',
    };
  }

  private async taskList(args: Record<string, unknown>): Promise<unknown> {
    const projectId = args.projectId ? String(args.projectId) : null;
    const tasks = projectId ? await this.repos!.projects.tasksOf(projectId) : await this.repos!.tasks.list(args.status ? String(args.status) : undefined);
    return {
      count: tasks.length,
      tasks: tasks.map(t => ({ id: t.id, guid: t.task_guid, summary: t.summary, url: t.url, status: t.status, dueAt: isoDate(t.due_at), plannedAt: isoDate(t.planned_at), estimateMinutes: t.estimate_minutes })),
    };
  }

  private async projectCreate(args: Record<string, unknown>): Promise<unknown> {
    const name = text(args.name, 200);
    const goal = args.goal == null ? '' : text(args.goal, 2000);
    const id = `prj-${hash(`${this.workspace!.statePath}\n${name}`).slice(0, 16)}`;
    const project = await this.repos!.projects.create({ id, name, goal });
    return { projectId: project.id, name: project.name, goal: project.goal, message: '项目（或个人清单）已建立；子任务经本人采纳后用 project_adopt 入账。' };
  }

  private async projectAdopt(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const projectId = String(args.projectId ?? '');
    const project = await this.repos!.projects.get(projectId);
    if (!project) throw new Error('项目不存在；请先用 project_create 建立。');
    const tasks = Array.isArray(args.tasks) ? (args.tasks as Record<string, unknown>[]) : [];
    if (tasks.length === 0) throw new Error('需要提供要采纳的子任务列表。');
    const results = [];
    for (const [index, task] of tasks.entries()) {
      try {
        const created = await this.taskCreate(item, {
          summary: task.summary,
          due: task.due,
          plannedAt: task.plannedAt,
          estimateMinutes: task.estimateMinutes,
          projectId,
          opSuffix: `adopt-${projectId}-${index}`,
        });
        results.push({ index, ok: true, ...(created as object) });
      } catch (error) {
        results.push({ index, ok: false, error: (error as Error).message });
      }
    }
    const failed = results.filter(r => !r.ok).length;
    return {
      projectId,
      adopted: results.length - failed,
      failed,
      results,
      message: failed === 0 ? '全部子任务已按本人采纳创建为真实飞书任务并关联项目。' : `已采纳 ${results.length - failed} 项，${failed} 项失败（见明细）；失败项可核对后重试。`,
    };
  }

  private async projectProgress(args: Record<string, unknown>): Promise<unknown> {
    const projectId = String(args.projectId ?? '');
    const project = await this.repos!.projects.get(projectId);
    if (!project) throw new Error('项目不存在。');
    const tasks = await this.repos!.projects.tasksOf(projectId);
    const open = tasks.filter(t => t.status !== 'completed');
    const completed = tasks.filter(t => t.status === 'completed');
    return {
      projectId,
      name: project.name,
      goal: project.goal,
      total: tasks.length,
      completed: completed.length,
      remaining: open.map(t => ({ guid: t.task_guid, summary: t.summary, dueAt: isoDate(t.due_at), plannedAt: isoDate(t.planned_at), estimateMinutes: t.estimate_minutes })),
      next: open[0] ? { guid: open[0]!.task_guid, summary: open[0]!.summary, dueAt: isoDate(open[0]!.due_at) } : null,
      message: open.length === 0 ? '项目全部任务已完成（以飞书任务状态为准）。' : `剩余 ${open.length} 项；下一步：${open[0]!.summary}`,
    };
  }

  /**
   * memo_save as a staged operation: create (CLI) is recorded the moment the
   * platform returns a document id, so a retry resumes from the read-back
   * instead of creating a second document. Outcome-unknown attempts are never
   * auto-retried; they require reconciliation first.
   */
  private async saveMemo(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const topic = text(args.topic, 200);
    const content = text(args.content);
    const source = text(args.source ?? `事项 ${item.id}`, 500);
    const operationId = `memo:${item.id}:${hash(`${topic}\n${content}`)}`;
    const { created, row: operation } = await this.repos!.operations.begin({
      id: operationId,
      workItemId: item.id,
      action: 'memo.save_doc',
      params: { topic, contentHash: hash(content) },
    });
    if (!created) {
      if (operation.status === 'succeeded') {
        const memo = await this.repos!.memos.get(operationId);
        return {
          operationId,
          reused: true,
          message: '此备忘此前已保存，未重复创建文档。',
          docUrl: memo?.doc_url ?? operation.receipt?.docUrl ?? null,
        };
      }
      if (operation.status === 'unknown') {
        throw new Error('上次保存的结果未知（超时或响应丢失）；请先核对飞书目录是否已生成文档，确认后再继续，不会自动重试。');
      }
    }
    await this.repos!.operations.update(operationId, { status: 'running' });
    const live = this.transport !== null;
    try {
      let external: { docId: string | null; url: string | null; revision: string | null; warnings: string[] } = {
        docId: (operation.receipt?.docId as string | undefined) ?? null,
        url: (operation.receipt?.docUrl as string | undefined) ?? null,
        revision: null,
        warnings: [],
      };
      if (live && this.config!.mode === 'feishu' && !external.docId) {
        external = await this.createMemoDocument(item, topic, content);
        // Persist the created document id before anything else can fail, so
        // a retry resumes instead of duplicating the external write.
        await this.repos!.operations.update(operationId, {
          status: 'running',
          receipt: { docId: external.docId, docUrl: external.url, stage: 'created' },
        });
      }
      if (external.docId && live && this.config!.mode === 'feishu') {
        const readback = await this.readMemoDocument(external.docId);
        external = { ...external, revision: readback.revision };
      }
      const memo = await this.repos!.memos.insert({
        id: operationId,
        work_item_id: item.id,
        topic,
        content,
        doc_url: external.url,
        doc_id: external.docId,
        doc_revision: external.revision,
        source,
        occurred_on: new Date().toISOString().slice(0, 10),
      });
      await this.repos!.operations.update(operationId, {
        status: 'succeeded',
        receipt: { docId: external.docId, url: external.url, revision: external.revision, warnings: external.warnings, memoId: memo.id, demo: !live },
      });
      await this.repos!.workItems.update(item.id, {
        result_ref: { operationId, docUrl: external.url, demo: !live },
      });
      return {
        operationId,
        docUrl: external.url,
        demo: !live,
        message: live && external.docId ? '备忘已保存为飞书文档并回读确认。' : '演示模式：备忘已入账本（PostgreSQL），未创建飞书文档。',
      };
    } catch (error) {
      await this.failStaged(operationId, error);
      throw error;
    }
  }

  private async createMemoDocument(item: WorkItemRow, topic: string, content: string): Promise<{ docId: string | null; url: string | null; revision: string | null; warnings: string[] }> {
    const config = this.config!;
    const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const paragraphs = content
      .split('\n')
      .map(line => `<p>${xml(line) || '<br/>'}</p>`)
      .join('\n');
    const title = `[24PA] ${topic}`;
    const body = `<title>${xml(title)}</title><p>来源事项：${xml(item.id)}</p><p>保存时间：${nowIso()}</p><h1>内容</h1>${paragraphs}`;
    const { data } = await runLarkCli(cliOptions(config, this.options.larkCliBin, this.options.cliTimeoutMs), [
      'docs', '+create', '--as', 'user', '--doc-format', 'xml', '--parent-token', config.folderToken, '--content', '-',
    ], body);
    const doc = data?.document;
    const warnings = Array.isArray(data?.warnings) ? data.warnings.map((x: unknown) => String(x)) : [];
    // A returned document id wins even with warnings: the external object
    // exists, so the failure must not orphan it — read back and record it.
    if (!doc?.document_id || !doc?.url) {
      throw new Error(warnings.length ? `文档创建未完成（${warnings.join('；')}）；请先核对体验目录，不要盲目重试。` : '未取得文档标识；请先核对体验目录，不要盲目重试。');
    }
    return { docId: doc.document_id, url: doc.url, revision: null, warnings };
  }

  private async readMemoDocument(docId: string): Promise<{ revision: string | null }> {
    const readback = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
      'docs', '+fetch', '--as', 'user', '--doc', docId, '--doc-format', 'xml', '--detail', 'full',
    ]);
    if (!readback.data?.document?.content) throw new Error('文档回读不完整，保存结果未确认。');
    return { revision: readback.data.document.revision_id != null ? String(readback.data.document.revision_id) : null };
  }

  // ---- outreach, recurring tasks, waiting items (F08) ------------------------

  /** Resolve a collaborator: explicit open_id or a unique confirmed memory contact. */
  private async resolveCollaborator(input: Record<string, unknown>): Promise<{ name: string; openId: string } | { clarify: string }> {
    const name = String(input.name ?? '').trim();
    const openId = String(input.openId ?? '').trim();
    if (openId) return { name: name || openId, openId };
    if (!name) return { clarify: '未提供姓名或 open_id' };
    const memory = await this.memory!.search({ query: name, limit: 50 });
    const contactRecords = memory.records.filter(r => (r.topic === `联系人：${name}` || r.content.includes(`联系人 ${name}：`)) && r.status === 'confirmed');
    const ids = [...new Set(contactRecords.flatMap(r => r.content.match(/ou_[A-Za-z0-9_]+/g) ?? []))];
    if (ids.length === 1) return { name, openId: ids[0]! };
    return { clarify: `${name}（${ids.length === 0 ? '记忆中没有对应 open_id' : `记忆中有 ${ids.length} 位候选`}）` };
  }

  /**
   * Send one outbound message under an explicit owner instruction (P13).
   * Draft-only requests never reach the platform; retries are idempotent.
   */
  private async outreachSend(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const content = text(args.content, 4000);
    const instruction = String(args.instruction ?? '').trim();
    if (!instruction) {
      throw new Error('对外发信必须携带本人明确的指令依据（instruction）；当前请求看起来是草稿——草稿不发送，请向本人确认后再执行。');
    }
    const resolved = await this.resolveCollaborator(args);
    if ('clarify' in resolved) {
      throw new Error(`收件人无法唯一确定（${resolved.clarify}）；请先与本人澄清，未发送任何消息。`);
    }
    this.assertFeishuLive('对外发信');
    const id = `out:${item.id}:${hash(`${resolved.openId}\n${content}`)}`;
    const { inserted, row } = await this.repos!.outreach.insert({
      id,
      work_item_id: item.id,
      kind: 'message',
      target_open_id: resolved.openId,
      target_name: resolved.name,
      content,
      instruction,
      status: 'pending',
    });
    if (!inserted && row.status === 'succeeded') {
      return { operationId: id, reused: true, messageId: row.message_id, message: '这条消息此前已发送，未重复发送。' };
    }
    if (!inserted && row.status === 'unknown') {
      throw new Error('上次发送结果未知（超时或响应丢失）；请先核对飞书是否已送达（操作号见回执），确认后让本人明确要求重发。');
    }
    try {
      const { data } = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
        'im', '+messages-send', '--as', 'user', '--user-id', resolved.openId, '--text', content, '--idempotency-key', id,
      ]);
      const messageId = String(data?.message?.message_id ?? data?.message_id ?? '');
      if (!messageId) throw new Error('平台未返回消息标识；请先核对飞书是否已送达，不要盲目重试。');
      await this.repos!.outreach.mark(id, { status: 'succeeded', messageId });
      return { operationId: id, messageId, target: resolved, message: `已按本人明确指令发送给 ${resolved.name}（以平台回执为准）。` };
    } catch (error) {
      const unknown = (error as any)?.outcome === 'unknown';
      await this.repos!.outreach.mark(id, { status: unknown ? 'unknown' : 'failed', error: (error as Error).message });
      throw error;
    }
  }

  /** Assign an existing task to a collaborator under an explicit instruction (P13). */
  private async taskAssign(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const taskRef = await this.resolveTask(args);
    const instruction = String(args.instruction ?? '').trim();
    if (!instruction) throw new Error('分派任务必须携带本人明确的指令依据（instruction）；未执行任何分派。');
    const resolved = await this.resolveCollaborator(args);
    if ('clarify' in resolved) {
      throw new Error(`被分派人无法唯一确定（${resolved.clarify}）；请先与本人澄清，未执行任何分派。`);
    }
    this.assertFeishuLive('任务分派');
    const id = `assign:${item.id}:${hash(`${taskRef.task_guid}\n${resolved.openId}`)}`;
    const staged = await this.stagedOperation(item, 'task.assign', id, {
      taskGuid: taskRef.task_guid,
      assignee: resolved.openId,
    });
    if (!staged.created && staged.row.status === 'succeeded') {
      return { operationId: staged.row.id, reused: true, guid: taskRef.task_guid, message: '此分派此前已提交，未重复执行。' };
    }
    try {
      await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
        'task', '+assign', '--as', 'user', '--task-id', taskRef.task_guid, '--add', resolved.openId, '--idempotency-key', staged.row.id,
      ]);
      const { inserted } = await this.repos!.outreach.insert({
        id: staged.row.id,
        work_item_id: item.id,
        kind: 'assign',
        target_open_id: resolved.openId,
        target_name: resolved.name,
        content: `分派任务 ${taskRef.task_guid}`,
        instruction,
        status: 'pending',
      });
      if (inserted) await this.repos!.outreach.mark(staged.row.id, { status: 'succeeded', taskGuid: taskRef.task_guid });
      await this.repos!.operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: taskRef.task_guid, assignee: resolved.openId } });
      return { operationId: staged.row.id, guid: taskRef.task_guid, assignee: resolved, message: `已把任务分派给 ${resolved.name}（以平台回执为准）。` };
    } catch (error) {
      await this.failStaged(staged.row.id, error);
      await this.repos!.outreach.mark(staged.row.id, { status: (error as any)?.outcome === 'unknown' ? 'unknown' : 'failed', error: (error as Error).message, taskGuid: taskRef.task_guid });
      throw error;
    }
  }

  /** Current fingerprint of a followed source, or null when it cannot be read. */
  private async sourceVerdict(sourceType: 'task' | 'calendar', sourceId: string, expected: string | null): Promise<{ valid: boolean; reason?: string }> {
    try {
      if (sourceType === 'task') {
        const task = (await this.repos!.tasks.byGuid(sourceId)) ?? (await this.repos!.tasks.get(sourceId));
        if (!task) return { valid: false, reason: '任务已不存在' };
        const fingerprint = taskFingerprint(task);
        return fingerprint === expected ? { valid: true } : { valid: false, reason: '任务内容或截止已变化' };
      }
      const event = await this.repos!.calendar.findEvent(sourceId);
      if (!event || event.status === 'canceled') return { valid: false, reason: event ? '日程已取消' : '日程已不存在' };
      const state = await this.repos!.calendar.getSync(this.config!.calendarId);
      if (state && (!state.complete || state.last_error)) {
        return { valid: false, reason: `日历同步异常（${state.last_error ?? '窗口未完成'}），投影可能过期；请先重新查询日历` };
      }
      const fingerprint = eventFingerprint(event);
      return fingerprint === expected ? { valid: true } : { valid: false, reason: '日程内容或时间已变化' };
    } catch (error) {
      return { valid: false, reason: `来源核对失败：${(error as Error).message}` };
    }
  }

  /** Linked calendar events whose projection overlaps the synced window: only
   * these can be judged gone by this sync — events outside the window were
   * never observed and must not be falsely canceled. */
  private async linkedEventIdsInWindow(from: Date, to: Date): Promise<string[]> {
    if (!this.repos) return [];
    const result = await this.dbRef
      .query<{ link_source_id: string }>(
        `select distinct r.link_source_id from pa24.reminder_rule r
         join pa24.calendar_event e on e.event_id = r.link_source_id
         where r.link_source_type = 'calendar' and not (e.end_time <= $1 or e.start_time >= $2)`,
        [from, to],
      )
      .catch(() => ({ rows: [] as { link_source_id: string }[] }));
    return result.rows.map(r => r.link_source_id);
  }

  /**
   * A followed source changed (detected on task edit or calendar sync): stop
   * its linked rules and send one correction for reminders already delivered
   * under the old fingerprint (P19 竞态更正).
   */
  private async notifySourceChanged(sourceType: 'task' | 'calendar', sourceId: string, currentFingerprint: string | null): Promise<void> {
    if (!this.repos) return;
    const rules = await this.repos.reminders.rulesLinkedTo(sourceType, sourceId);
    for (const rule of rules) {
      if (rule.link_fingerprint === currentFingerprint) continue;
      const counts = await this.repos.reminders.occurrenceCounts(rule.id);
      // A rule with anything still ahead (materialized occurrence or an
      // upcoming next_due_at) owes the owner a drop notice; timing between
      // materialization and this check must not decide visibility.
      const upcoming = rule.next_due_at != null;
      await this.repos.reminders.updateRule(rule.id, { status: 'stopped' }).catch(() => {});
      await this.repos.reminders.cancelPendingOccurrences(rule.id).catch(() => {});
      if ((counts && counts.pending > 0) || upcoming) {
        // Unsent occurrences die with their source; the owner is told the
        // reminder was dropped, not left wondering (P19).
        await this.notifyOwner(
          `remindsrc:${rule.id}:${hash(currentFingerprint ?? 'gone')}`,
          `提醒「${rule.text}」已取消：关联的${SOURCE_LABELS[sourceType]}已变更。如仍需要，请按最新安排重新设置。`,
        );
      }
      if (counts && counts.sent > 0) {
        await this.notifyOwner(
          `srccorr:${rule.id}:${hash(currentFingerprint ?? 'gone')}`,
          `更正：此前按旧安排发给你的提醒「${rule.text}」对应的${SOURCE_LABELS[sourceType]}已经变化；请以最新安排为准，旧提醒不再有效。`,
        );
      }
    }
  }

  /** Recurring task templates (P22): dsh-schedule records + PG-unique instances. */
  private async taskRepeatCreate(args: Record<string, unknown>): Promise<unknown> {
    const title = text(args.title, 500);
    const timeZone = String(args.timeZone ?? this.config!.timeZone);
    const now = Date.now();
    const id = `ttpl-${hash(`${this.workspace!.statePath}\n${title}\n${String(args.kind ?? '')}\n${String(args.time ?? '')}${String(args.everySeconds ?? '')}`).slice(0, 16)}`;
    let schedule: unknown;
    let nextDueAt: Date;
    let origin: string;
    if (args.kind === 'every') {
      const seconds = Number(args.everySeconds);
      if (!Number.isInteger(seconds) || seconds < 60) throw new Error('周期任务模板 every 需要 ≥60 秒的整数间隔（dsh-schedule 下限）。');
      schedule = createEveryScheduleRecord(ScheduleId(id), title, seconds, now, title.slice(0, 100));
      origin = `every ${seconds}s`;
    } else if (args.kind === 'daily' || args.kind === 'weekly') {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(String(args.time ?? ''))) throw new Error('周期任务模板需要本地时间 HH:mm:ss。');
      const weekdays = Array.isArray(args.weekdays) ? (args.weekdays as number[]) : undefined;
      if (args.kind === 'weekly' && (!weekdays?.length || weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7))) {
        throw new Error('weekly 模板需要 weekdays（ISO 1–7）。');
      }
      schedule = args.kind === 'daily'
        ? createDailyScheduleRecord(ScheduleId(id), title, { time: String(args.time), time_zone: timeZone }, now, title.slice(0, 100))
        : createWeeklyScheduleRecord(ScheduleId(id), title, { time: String(args.time), time_zone: timeZone, weekdays: [...new Set(weekdays!)].sort() }, now, title.slice(0, 100));
      origin = `${args.kind} ${args.time} ${timeZone}${weekdays ? ` ${weekdays.join(',')}` : ''}`;
    } else {
      throw new Error('模板类型：every（≥60s）或 daily/weekly（本地时间）。飞书任务 CLI 未暴露原生重复规则，按模板＋唯一实例实现（如实说明）。');
    }
    nextDueAt = nextTemplateOccurrence(schedule as RecurringScheduleRecord, now);
    const template = await this.repos!.taskTemplates.insert({
      id,
      title,
      tasklist_id: this.config!.tasklistId,
      schedule,
      origin_expression: origin,
      status: 'active',
      next_due_at: nextDueAt,
      time_zone: timeZone,
    });
    // The first occurrence must exist as a row before any tick can claim it.
    await this.repos!.taskTemplates.insertInstance({ id: `${template.id}:${nextDueAt.toISOString()}`, templateId: template.id, dueAt: nextDueAt });
    return { templateId: template.id, nextDueAt: template.next_due_at?.toISOString() ?? null, message: `周期任务模板已建立（${origin}）；每次发生生成一个真实飞书任务，支持跳过本次/停止以后。` };
  }

  private async taskRepeatList(): Promise<unknown> {
    const templates = await this.repos!.taskTemplates.list();
    const view = [];
    for (const template of templates) {
      const instances = await this.repos!.taskTemplates.instancesOf(template.id, 8);
      view.push({
        templateId: template.id,
        title: template.title,
        status: template.status,
        expression: template.origin_expression,
        nextDueAt: template.next_due_at?.toISOString() ?? null,
        recentInstances: instances.map(i => ({ dueAt: new Date(i.due_at).toISOString(), status: i.status, taskId: i.task_id })),
      });
    }
    return { templates: view };
  }

  private async taskRepeatSkip(args: Record<string, unknown>): Promise<unknown> {
    const template = await this.requireTemplate(args);
    const instances = (await this.repos!.taskTemplates.instancesOf(template.id, 50)).filter(i => ['pending', 'failed'].includes(i.status)).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
    const target = instances[0];
    if (!target) throw new Error('没有可跳过的未生成实例；下一次发生后才会出现。');
    await this.repos!.taskTemplates.updateInstance(target.id, { status: 'skipped' });
    return { templateId: template.id, skippedDueAt: new Date(target.due_at).toISOString(), message: '已跳过本次（不生成任务）；模板按计划继续。' };
  }

  private async taskRepeatStop(args: Record<string, unknown>): Promise<unknown> {
    const template = await this.requireTemplate(args);
    await this.repos!.taskTemplates.update(template.id, { status: 'stopped' });
    await this.repos!.taskTemplates.skipPendingInstances(template.id);
    return { templateId: template.id, status: 'stopped', message: '已停止以后的生成；已生成的任务与历史保留。' };
  }

  private async taskRepeatUpdate(args: Record<string, unknown>): Promise<unknown> {
    const template = await this.requireTemplate(args);
    const title = args.title ? text(args.title, 500) : null;
    if (!title && args.kind === undefined) throw new Error('需要新的标题或新的周期（kind/time/everySeconds/weekdays）。');
    if (args.kind !== undefined) {
      const recreated = await this.taskRepeatCreate({ title: title ?? template.title, kind: args.kind, time: args.time, everySeconds: args.everySeconds, weekdays: args.weekdays, timeZone: args.timeZone ?? template.time_zone });
      await this.repos!.taskTemplates.update(template.id, { status: 'stopped' });
      await this.repos!.taskTemplates.skipPendingInstances(template.id);
      return { ...recreated as object, oldTemplateStopped: template.id, message: `已按新周期重建模板（旧模板 ${template.id} 停止，只影响以后）。` };
    }
    const updated = await this.repos!.taskTemplates.update(template.id, { ...(title ? { title } : {}) });
    return { templateId: template.id, title: updated?.title, message: '已修改以后生成的任务标题；已生成任务不受影响。' };
  }

  private async requireTemplate(args: Record<string, unknown>) {
    const template = await this.repos!.taskTemplates.get(String(args.templateId ?? ''));
    if (!template) throw new Error('模板不存在；请先用 task_repeat_create 建立。');
    return template;
  }

  /** Bounded materialization of due template instances into real tasks (P22). */
  private async materializeTemplateInstances(): Promise<number> {
    if (!this.repos || this.config?.mode !== 'feishu') return 0;
    let generated = 0;
    for (;;) {
      const due = await this.repos.taskTemplates.claimDueInstances(new Date(), 5);
      if (due.length === 0) break;
      for (const instance of due) {
        const template = await this.repos.taskTemplates.get(instance.template_id);
        if (!template || template.status !== 'active') {
          await this.repos.taskTemplates.updateInstance(instance.id, { status: 'skipped' });
          continue;
        }
        const operationId = `ttask:${instance.id}`;
        const { created, row } = await this.repos.operations.begin({ id: operationId, workItemId: 'pa24-system-templates', action: 'task.repeat_generate', params: { instanceId: instance.id, title: template.title } });
        if (!created && row.status === 'succeeded') {
          // Reconcile keeps the same stable link: the task row id (operationId).
          await this.repos.taskTemplates.updateInstance(instance.id, { status: 'generated', task_id: operationId });
          continue;
        }
        if (!created && row.status === 'unknown') {
          await this.repos.taskTemplates.updateInstance(instance.id, { status: 'failed', error: '生成结果未知；请先核对飞书任务清单是否已生成，确认后再继续。' });
          continue;
        }
        try {
          await this.repos.operations.update(operationId, { status: 'running' });
          const { data } = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
            'task', '+create', '--as', 'user', '--summary', `[24PA] ${template.title}`, '--tasklist-id', template.tasklist_id, '--idempotency-key', operationId,
          ]);
          const external = taskExternal(data);
          await this.repos.tasks.save({
            id: operationId,
            work_item_id: null,
            task_guid: external.guid,
            url: external.url,
            summary: template.title,
            due_at: instance.due_at,
            due_has_time: true,
            planned_at: null,
            estimate_minutes: null,
            status: 'open',
            external_updated_at: new Date(),
            last_synced_at: new Date(),
          });
          await this.repos.taskTemplates.updateInstance(instance.id, { status: 'generated', task_id: operationId });
          await this.repos.operations.update(operationId, { status: 'succeeded', receipt: { guid: external.guid, url: external.url } });
          generated += 1;
        } catch (error) {
          await this.failStaged(operationId, error);
          await this.repos.taskTemplates.updateInstance(instance.id, { status: 'failed', error: (error as Error).message });
        }
        // Advance the template's schedule exactly like the reminder engine:
        // only the latest missed occurrence is materialized (no backlog flood).
        const nextAt = nextTemplateOccurrence(template.schedule as RecurringScheduleRecord, Date.now());
        await this.repos.taskTemplates.update(template.id, { next_due_at: nextAt });
        await this.repos.taskTemplates.insertInstance({ id: `${template.id}:${nextAt.toISOString()}`, templateId: template.id, dueAt: nextAt });
      }
    }
    return generated;
  }

  /** Waiting items (P23): the checkpoint asks the OWNER, never nudges others. */
  private async waitingCreate(args: Record<string, unknown>): Promise<unknown> {
    const title = text(args.title, 200);
    const detail = args.detail ? text(args.detail, 2000) : '';
    const sourceDesc = args.sourceDesc ? text(args.sourceDesc, 500) : '';
    const dedupKey = args.dedupKey ? String(args.dedupKey) : null;
    if (dedupKey) {
      const existing = await this.repos!.waiting.byDedupKey(dedupKey);
      if (existing) return { waitingId: existing.id, reused: true, status: existing.status, message: `已有同源等待事项（${existing.id}），不重复建立。` };
    }
    let checkpointAt: Date | null = null;
    if (args.checkpointInSeconds) {
      const seconds = Number(args.checkpointInSeconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 365 * 24 * 3600) throw new Error('检查点需为 1 秒–365 天。');
      checkpointAt = new Date(Date.now() + seconds * 1000);
    } else if (args.checkpointAt) {
      checkpointAt = new Date(String(args.checkpointAt));
      if (Number.isNaN(checkpointAt.getTime())) throw new Error('checkpointAt 需为可解析的 ISO 时间。');
    }
    const id = `wt-${randomUUID().slice(0, 12)}`;
    const row = await this.repos!.waiting.insert({ id, title, detail, sourceDesc, ...(dedupKey ? { dedupKey } : {}), ...(checkpointAt ? { checkpointAt } : {}) });
    const notice = checkpointAt
      ? `已建立等待事项「${title}」；到点只会来问你是否收到，不会自动向对方催办。没有可自动读取的回复来源时，以你的答复为准。`
      : `已建立等待事项「${title}」（未设检查点）；需要跟进时再设时间。`;
    return { waitingId: row.id, checkpointAt: row.checkpoint_at?.toISOString() ?? null, message: notice };
  }

  private async waitingList(args: Record<string, unknown>): Promise<unknown> {
    const items = await this.repos!.waiting.list(args.status ? String(args.status) : undefined);
    return { items: items.map(w => ({ id: w.id, title: w.title, status: w.status, checkpointAt: w.checkpoint_at?.toISOString() ?? null, asked: w.ask_count, source: w.source_desc })) };
  }

  private async waitingControl(args: Record<string, unknown>): Promise<unknown> {
    const op = String(args.op ?? '');
    const item = await this.repos!.waiting.get(String(args.waitingId ?? ''));
    if (!item) throw new Error('等待事项不存在。');
    if (op === 'received') {
      if (item.status !== 'waiting') throw new Error(`该等待事项当前状态为 ${item.status}。`);
      await this.repos!.waiting.update(item.id, { status: 'received', result: args.note ? text(args.note, 500) : '本人确认已收到', checkpoint_at: null });
      return { waitingId: item.id, status: 'received', message: '已标记收到，后续检查点停止询问。' };
    }
    if (op === 'cancel') {
      await this.repos!.waiting.update(item.id, { status: 'canceled', result: args.note ? text(args.note, 500) : '本人取消' });
      return { waitingId: item.id, status: 'canceled', message: '等待事项已取消。' };
    }
    if (op === 'reschedule') {
      const seconds = Number(args.inSeconds ?? 0);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 365 * 24 * 3600) throw new Error('改期需要 inSeconds（1 秒–365 天）。');
      const next = new Date(Date.now() + seconds * 1000);
      await this.repos!.waiting.update(item.id, { status: 'waiting', checkpoint_at: next });
      return { waitingId: item.id, checkpointAt: next.toISOString(), message: '检查点已调整，到点再来问你。' };
    }
    if (op === 'keep') {
      await this.repos!.waiting.update(item.id, { status: 'waiting' });
      return { waitingId: item.id, status: 'waiting', message: '继续等待；需要时再设检查点。' };
    }
    throw new Error('未知等待操作（received/cancel/reschedule/keep）。');
  }

  /** One bounded follow-up tick: template instances + waiting checkpoints. */
  private followupTick(): void {
    if (this.closed || !this.repos || !this.config) return;
    void this.materializeTemplateInstances().catch(() => {});
    void this.dispatchWaitingCheckpoints().catch(() => {});
    void this.superviseDigests().catch(() => {});
  }

  private async dispatchWaitingCheckpoints(): Promise<number> {
    if (!this.config?.ownerOpenId || this.config.mode !== 'feishu') return 0;
    const due = await this.repos!.waiting.claimDue(new Date(), 5);
    for (const item of due) {
      const silentUntil = await this.silencePolicy.silentUntil();
      if (silentUntil && silentUntil.getTime() > Date.now()) {
        await this.repos!.waiting.update(item.id, { checkpoint_at: silentUntil, ask_count: item.ask_count - 1 });
        continue;
      }
      await this.repos!.outbox.enqueue({
        dedupKey: `waiting:${item.id}:${item.ask_count}`,
        channel: 'feishu',
        target: this.config.ownerOpenId,
        kind: 'text',
        content: { text: `等待跟进：「${item.title}」到检查点了${item.source_desc ? `（来源：${item.source_desc}）` : ''}——收到了吗？回复让助理记录（收到 / 继续等 / 改时间 / 取消）；不会自动向对方催办。` },
      });
      // One ask per checkpoint: without an answer the next ask backs off an
      // hour instead of nagging every tick (P23 到点询问).
      await this.repos!.waiting.update(item.id, { checkpoint_at: new Date(Date.now() + 3600 * 1000) });
    }
    return due.length;
  }

  // ---- daily planning & recurring digests (F09) -------------------------------

  private nativeSchedule(): NativeScheduleService | null {
    const service = this.ctx.get('schedule');
    return service && typeof service.create === 'function' ? (service as NativeScheduleService) : null;
  }

  /** Local-date window key for a plan kind (morning/evening share the date, weekly uses ISO week). */
  private digestWindowKey(kind: string, timeZone: string, now = new Date()): string {
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

  /** Delegation prompt handed to the Lead when a digest window fires (P24). */
  private digestPrompt(planId: string, title: string): string {
    return `[24PA计划 ${planId}] 到达${title}窗口：请委派 digest Worker（pa24_delegate worker=digest）执行 digest_build {planId:"${planId}"}，把简报发给本人；不要执行其他业务。`;
  }

  /**
   * Enable a smart plan (P24/P25): one durable business row plus one native
   * Schedule task bound to the fixed access session. Schedule persistence is
   * the enqueue; model work and platform acceptance are tracked separately on
   * the occurrence row.
   */
  private async digestEnable(args: Record<string, unknown>): Promise<unknown> {
    const kind = String(args.kind ?? '');
    if (!['morning', 'evening', 'weekly', 'once'].includes(kind)) throw new Error('计划类型：morning/evening/weekly（daily/weekly 定时）或 once（一次性，演示与测试）。');
    const timeZone = String(args.timeZone ?? this.config!.timeZone);
    const schedule = this.nativeSchedule();
    if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务，无法建立智能计划。');
    const title = { morning: '晨报', evening: '晚间回顾', weekly: '每周回顾', once: '一次性简报' }[kind]!;
    const id = `dig-${kind === 'once' ? 'once-' + randomUUID().slice(0, 8) : kind + '-' + hash(this.workspace!.statePath + kind).slice(0, 8)}`;
    const existing = await this.repos!.digests.getPlan(id);
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
    const created = await schedule.create(this.accessSessionId!, { ...request, prompt: this.digestPrompt(id, title) });
    const plan = await this.repos!.digests.insertPlan({
      id,
      kind,
      title,
      schedule_id: String(created.id),
      session_id: this.accessSessionId!,
      schedule_spec: request,
      status: 'active',
      last_window: null,
    });
    return {
      planId: plan.id,
      scheduleId: plan.schedule_id,
      nextDueAt: (created as { scheduledAt?: string }).scheduledAt ?? null,
      message: `${title}计划已开启（原生 Schedule 持久入队，绑定飞书接入会话）；到点唤醒 Lead 委派简报 Worker。`,
    };
  }

  private async digestControl(args: Record<string, unknown>): Promise<unknown> {
    const plan = await this.repos!.digests.getPlan(String(args.planId ?? ''));
    if (!plan) throw new Error('计划不存在；请先用 digest_enable 开启。');
    const op = String(args.op ?? '');
    const schedule = this.nativeSchedule();
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
      await this.repos!.digests.updatePlan(plan.id, { status: op === 'pause' ? 'paused' : 'stopped', schedule_id: null });
      return {
        planId: plan.id,
        status: op === 'pause' ? 'paused' : 'stopped',
        nativeWarning,
        message: `${op === 'pause' ? '计划已暂停' : '计划已停止'}（业务历史保留）${nativeWarning ? `；注意：${nativeWarning}` : ''}。`,
      };
    }
    if (op === 'resume') {
      if (plan.status !== 'paused') throw new Error(`计划当前状态为 ${plan.status}，无法恢复。`);
      if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务。');
      const prompt = `[24PA计划 ${plan.id}] 到达${plan.title}窗口：请委派 digest Worker（pa24_delegate worker=digest）执行 digest_build {planId:"${plan.id}"}，把简报发给本人；不要执行其他业务。`;
      const created = await schedule.create(plan.session_id, { ...plan.schedule_spec, prompt, title: `[24PA] ${plan.title}` });
      await this.repos!.digests.updatePlan(plan.id, { status: 'active', schedule_id: String(created.id) });
      return { planId: plan.id, scheduleId: String(created.id), message: '计划已恢复（重新入队）。' };
    }
    if (op === 'adjust') {
      // Adjust swaps the spec on the SAME plan row: remove the old native
      // schedule, create the new one, keep id and history stable (P24 修改).
      if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务。');
      const kind = String(args.kind ?? plan.kind);
      if (!['morning', 'evening', 'weekly', 'once'].includes(kind)) throw new Error('调整后的计划类型无效。');
      const timeZone = String(args.timeZone ?? this.config!.timeZone);
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
      const created = await schedule.create(plan.session_id, { ...request, prompt: this.digestPrompt(plan.id, plan.title), title: `[24PA] ${plan.title}` });
      await this.repos!.digests.updatePlan(plan.id, { status: 'active', schedule_id: String(created.id), schedule_spec: request });
      return { planId: plan.id, scheduleId: String(created.id), message: '计划已按新安排调整（同一计划保留历史，只影响以后）。' };
    }
    throw new Error('未知计划操作（pause/resume/stop/adjust）。');
  }

  private async digestList(): Promise<unknown> {
    const plans = await this.repos!.digests.listPlans();
    const view = [];
    for (const plan of plans) {
      const occurrences = await this.repos!.digests.occurrencesOf(plan.id, 3);
      view.push({
        planId: plan.id,
        kind: plan.kind,
        status: plan.status,
        scheduleId: plan.schedule_id,
        lastWindow: plan.last_window,
        recent: occurrences.map(o => ({ window: o.window_key, status: o.status, completedAt: isoDate(o.completed_at) })),
      });
    }
    return { plans: view };
  }

  /** Gather planning facts once: calendar (with freshness), tasks, waiting, review queue, preferences. */
  private async planningFacts(now: Date): Promise<{
    calendar: { fresh: boolean; syncedAt: string | null; events: { summary: string; start: string; end: string; allDay: boolean }[] };
    tasksDue: { guid: string; summary: string; dueAt: string | null; plannedAt: string | null; estimateMinutes: number | null; overdue: boolean }[];
    tasksCompletedToday: { guid: string; summary: string }[];
    waiting: { id: string; title: string; checkpointAt: string | null }[];
    reviewQueueCount: number;
    projects: { id: string; name: string; completed: number; total: number }[];
    missing: string[];
  }> {
    const tz = this.config!.timeZone;
    const dayStart = new Date(now.getTime() - 24 * 3600 * 1000);
    const dayEnd = new Date(now.getTime() + 36 * 3600 * 1000);
    const missing: string[] = [];
    const calendarId = this.config!.calendarId;
    const sync = await this.syncCalendarWindow(calendarId, dayStart, dayEnd).catch(() => ({ ok: false, error: '同步失败' }));
    if (!sync.ok) missing.push(`日历同步失败（${(sync as { error?: string }).error ?? '未知'}）：以下为投影，可能过期`);
    const events = await this.repos!.calendar.eventsIn(calendarId, dayStart, dayEnd);
    const state = await this.repos!.calendar.getSync(calendarId);
    const tasks = await this.repos!.tasks.list();
    const localNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));
    const todayTasks = tasks.filter(t => {
      const due = t.due_at ? new Date(t.due_at) : null;
      const planned = t.planned_at ? new Date(t.planned_at) : null;
      if (t.status === 'completed') return false;
      return (due && due.getTime() > now.getTime() - 24 * 3600 * 1000 && due.getTime() < dayEnd.getTime())
        || (planned && planned.getTime() > now.getTime() - 24 * 3600 * 1000 && planned.getTime() < dayEnd.getTime());
    });
    const completedToday = tasks.filter(t => t.status === 'completed' && t.last_synced_at && now.getTime() - t.last_synced_at.getTime() < 24 * 3600 * 1000);
    const waiting = await this.repos!.waiting.list('waiting');
    const queue = await this.reviewQueue().catch(() => null);
    const projectRows = (await this.dbRef
      .query<{ id: string; name: string }>('select id, name from pa24.project')
      .catch(() => ({ rows: [] as { id: string; name: string }[] }))).rows;
    const projects: { id: string; name: string; completed: number; total: number }[] = [];
    for (const project of projectRows) {
      const projectTasks = await this.repos!.projects.tasksOf(project.id);
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
      reviewQueueCount: queue ? (queue as { count: number }).count : -1,
      projects,
      missing,
    };
  }

  /**
   * Worker-side digest build (P24/P25): claims the current window idempotently,
   * assembles a sourced facts-vs-suggestions report, and ships it through the
   * outbox. Never writes tasks, calendar, or memory; nothing auto-postpones.
   */
  private async digestBuild(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const planId = String(args.planId ?? '');
    const plan = await this.repos!.digests.getPlan(planId);
    if (!plan) throw new Error(`计划 ${planId} 不存在。`);
    if (plan.status !== 'active') throw new Error(`计划 ${planId} 当前状态为 ${plan.status}，不生成简报。`);
    const windowKey = this.digestWindowKey(plan.kind === 'evening' ? 'evening' : plan.kind, this.config!.timeZone);
    const { created, row } = await this.repos!.digests.claimOccurrence({ planId: plan.id, windowKey });
    if (!created && row.status === 'model_done') {
      return { planId, windowKey, reused: true, status: row.status, message: `本窗口（${windowKey}）简报已生成，不重复发布。` };
    }
    const facts = await this.planningFacts(new Date());
    const report = this.renderDigest(plan, windowKey, facts);
    await this.repos!.digests.updateOccurrence(row.id, { status: 'model_done', report: { facts, report }, completed_at: new Date() });
    await this.repos!.digests.updatePlan(plan.id, { last_window: windowKey });
    const outboxKey = `digest:${row.id}`;
    if (this.config!.ownerOpenId) {
      await this.repos!.outbox.enqueue({
        dedupKey: outboxKey,
        channel: 'feishu',
        target: this.config!.ownerOpenId,
        kind: 'text',
        content: { text: report },
      });
      // model_done = model work finished and the send intent is durably
      // queued; platform acceptance is the outbox row's own state (P24 区分).
      await this.repos!.digests.updateOccurrence(row.id, { status: 'model_done', outbox_key: outboxKey });
    }
    await this.repos!.workItems.update(item.id, { result_ref: { planId: plan.id, windowKey, outboxKey } });
    return { planId, windowKey, outboxKey, message: '简报已生成并入发送队列（Outbox 持久，平台接受状态以发送记录为准）。' };
  }

  private renderDigest(
    plan: { kind: string; title: string },
    windowKey: string,
    facts: Awaited<ReturnType<PaRuntime['planningFacts']>>,
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
    if (facts.reviewQueueCount >= 0) lines.push(`· 待审手写笔记 ${facts.reviewQueueCount} 份`);
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
    const schedule = this.nativeSchedule();
    if (!schedule) return { checked: 0, note: '当前 Host 未提供原生 Schedule 服务。' };
    const results = [];
    for (const plan of await this.repos!.digests.listPlans('active')) {
      if (!plan.schedule_id) continue;
      let delivered = 0;
      try {
        const history = await schedule.history({ sessionId: plan.session_id, id: plan.schedule_id, limit: 100 });
        delivered = Array.isArray((history as { records?: unknown[] }).records) ? (history as { records: unknown[] }).records.length : 0;
      } catch {
        continue;
      }
      const completed = (await this.repos!.digests.occurrencesOf(plan.id, 100)).filter(o => o.status === 'model_done').length;
      if (delivered > completed) {
        const staleDelivery = delivered - completed;
        const oldest = await this.repos!.digests.occurrencesOf(plan.id, 1);
        const lastDone = oldest[0]?.completed_at ? new Date(oldest[0].completed_at).getTime() : 0;
        // Unattributable deliveries older than the grace pause the plan.
        const startedAtMs = this.startedAt ? new Date(this.startedAt).getTime() : Date.now();
        if (Date.now() - Math.max(lastDone, startedAtMs) > graceMs) {
          try {
            await schedule.delete({ sessionId: plan.session_id, id: plan.schedule_id });
          } catch (error) {
            console.warn(`[pa24] 暂停无归属计划时移除原生 Schedule 失败（将重试）：${(error as Error).message}`);
          }
          await this.repos!.digests.updatePlan(plan.id, { status: 'paused', schedule_id: null });
          if (this.config!.ownerOpenId) {
            await this.notifyOwner(
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
  private async overviewToday(): Promise<unknown> {
    const facts = await this.planningFacts(new Date());
    return {
      calendar: { ...facts.calendar, events: facts.calendar.events.slice(0, 10) },
      tasks: facts.tasksDue.slice(0, 10),
      waiting: facts.waiting.slice(0, 5),
      reviewQueue: facts.reviewQueueCount >= 0 ? facts.reviewQueueCount : null,
      missing: facts.missing,
      message: '今日概览来自实际投影；未读取的范围（如某集成未启用）不显示为零。',
    };
  }

  /**
   * Today plan (P16): focus, estimates, capacity and conflicts — a proposal,
   * never a write. Buffers come from confirmed preferences (e.g. 会议之间留 15 分钟).
   */
  private async planToday(args: Record<string, unknown>): Promise<unknown> {
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
  private async preferenceBufferMinutes(): Promise<number> {
    try {
      const memory = await this.memory!.search({ topic: '工作偏好', limit: 20 });
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
  private async planPreview(args: Record<string, unknown>): Promise<unknown> {
    const tz = this.config!.timeZone;
    const base = args.date ? new Date(String(args.date)) : new Date(Date.now() + 24 * 3600 * 1000);
    if (Number.isNaN(base.getTime())) throw new Error('date 需为可解析日期。');
    const from = new Date(base.toISOString().slice(0, 10) + 'T00:00:00Z');
    const to = new Date(base.toISOString().slice(0, 10) + 'T23:59:59Z');
    const calendarId = this.config!.calendarId;
    const sync = await this.syncCalendarWindow(calendarId, from, to).catch(() => ({ ok: false, error: '同步失败' }));
    const events = await this.repos!.calendar.eventsIn(calendarId, from, to);
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
    const tasks = await this.repos!.tasks.list();
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
  private async planAdopt(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
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
    const calendarId = String(args.calendarId ?? this.config!.calendarId);
    const sync = await this.syncCalendarWindow(calendarId, dayStart, dayEnd);
    const existing = await this.repos!.calendar.eventsIn(calendarId, dayStart, dayEnd);
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
        const created = await this.calendarWrite(item, 'create', {
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

  // ---- handwriting notes (F06) ----------------------------------------------

  private isImageFileMessage(event: InboundEvent): boolean {
    if (event.messageType !== 'file') return false;
    return /\.(jpe?g|png|webp)$/i.test(String(event.fileName ?? ''));
  }

  /**
   * Collect one inbound photo/file as a note page (P28): durable original
   * bytes + hash under the workspace, page order tracked in PG, owner ack
   * message routed back to the note so replies append pages to it.
   */
  private async collectNotePage(inboxEventId: string, event: InboundEvent, noteId: string | null): Promise<void> {
    const config = this.config!;
    if (config.mode !== 'feishu' || !this.transport) {
      await this.notifyOwner(`noteinfo:${event.eventId}`, '手写笔记收集需要 feishu 模式与已启动的飞书连接。');
      await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: '手写收集未启用' });
      return;
    }
    // (kept inline: this branch reports to the owner instead of throwing)
    const resourceKey = event.imageKey || event.fileKey || '';
    const resourceType: 'image' | 'file' = event.messageType === 'image' ? 'image' : 'file';
    if (!resourceKey || !event.messageId) {
      await this.notifyOwner(`noteinfo:${event.eventId}`, '这条消息缺少可下载的图片资源；请重新发送照片或图片文件。');
      await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: '缺少图片资源' });
      return;
    }
    const rejectPage = async (note: NoteRow, pageNo: number, reason: string, notifyText: string) => {
      await this.repos!.notes.insertPage({
        note_id: note.id,
        page_no: pageNo,
        message_id: String(event.messageId),
        image_key: resourceKey,
        media_type: 'unknown',
        byte_size: 0,
        sha256: '',
        storage_path: '',
        source_type: resourceType,
        quality: reason,
        status: 'rejected',
      });
      await this.notifyOwner(`noteinfo:${event.eventId}`, notifyText);
      await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: reason });
    };
    try {
      if (noteId) {
        const current = await this.repos!.notes.getNote(noteId);
        if (current?.status === 'collected') {
          await this.notifyOwner(`noteinfo:${event.eventId}`, `笔记 ${noteId} 的批次已结束，不再追加页；如需补充请发新笔记。`);
          await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: '批次已结束' });
          return;
        }
      }
      const bytes = await this.transport.downloadImage(event.messageId, resourceKey, resourceType);
      const mediaType = detectImageMediaType(bytes);
      const pages = noteId ? await this.repos!.notes.pagesOf(noteId) : [];
      const savedCount = pages.filter(p => p.status === 'saved').length;
      const nextNo = pages.length + 1;
      let note: NoteRow;
      if (noteId) {
        const found = await this.repos!.notes.getNote(noteId);
        if (!found) {
          await this.notifyOwner(`noteinfo:${event.eventId}`, '引用的笔记已不存在；请直接发送照片开始新笔记。');
          await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: '引用笔记不存在' });
          return;
        }
        note = found;
      } else {
        const id = await this.repos!.notes.nextNoteId();
        note = await this.repos!.notes.insertNote({ id, title: `手写笔记 ${id}`, origin: 'feishu' });
      }
      if (!mediaType) {
        await rejectPage(note, nextNo, '无法识别的图片格式（需 JPEG/PNG/WebP）', `笔记 ${note.id} 第 ${nextNo} 页不是可识别的图片（需 JPEG/PNG/WebP 原图或图片文件），已记录为缺页；请重发该页。`);
        return;
      }
      if (bytes.length > MAX_PAGE_BYTES) {
        await rejectPage(note, nextNo, `图片超过 ${MAX_PAGE_BYTES} 字节上限`, `笔记 ${note.id} 第 ${nextNo} 页超过 10 MiB 上限；请发送压缩后的图片或改用文件发送。`);
        return;
      }
      if (savedCount >= MAX_PAGES_PER_NOTE) {
        await rejectPage(note, nextNo, `笔记页数超过 ${MAX_PAGES_PER_NOTE} 上限`, `笔记 ${note.id} 已达 ${MAX_PAGES_PER_NOTE} 页上限；请先整理当前批次，或另发新笔记。`);
        return;
      }
      const sha = sha256Hex(bytes);
      const duplicate = pages.find(p => p.status === 'saved' && p.sha256 === sha);
      if (duplicate) {
        await this.notifyOwner(
          `noteinfo:${event.eventId}`,
          `这与笔记 ${note.id} 第 ${duplicate.page_no} 页是同一张原稿（sha256 ${sha.slice(0, 16)}…），未重复保存；如需替换该页请先说明。`,
        );
        await this.repos!.inbox.mark(inboxEventId, { status: 'duplicate', error: '重复页' });
        return;
      }
      const dir = join(this.workspace!.statePath, '.24pa', 'originals', note.id);
      await mkdir(dir, { recursive: true });
      const storagePath = join(dir, `p${nextNo}-${sha.slice(0, 12)}.${extensionOf(mediaType)}`);
      await (await import('node:fs/promises')).writeFile(storagePath, bytes, { mode: 0o600 });
      await this.repos!.notes.insertPage({
        note_id: note.id,
        page_no: nextNo,
        message_id: String(event.messageId),
        image_key: resourceKey,
        media_type: mediaType,
        byte_size: bytes.length,
        sha256: sha,
        storage_path: storagePath,
        source_type: resourceType,
        quality: null,
        status: 'saved',
      });
      // The ack message carries the route back to this note: replying with
      // another photo appends the next page; replying with text reaches Lead.
      await this.notifyOwner(
        `noteack:${note.id}:p${nextNo}:${event.eventId}`,
        `已收到笔记 ${note.id} 第 ${nextNo} 页原稿（${mediaType}，${bytes.length} 字节，sha256 ${sha.slice(0, 16)}…，${resourceType === 'file' ? '文件原图' : '平台图片，可能已压缩'}）。继续拍下一页请直接回复本条消息再发图；整理识别请回复“整理这份笔记”，或说“结束这批笔记”。`,
      );
      await this.repos!.inbox.mark(inboxEventId, { status: 'delivered', requestId: `note:${note.id}:p${nextNo}` });
    } catch (error) {
      // Download interrupted: nothing durable was written; a re-send retries.
      await this.notifyOwner(
        `noteinfo:${event.eventId}`,
        `原稿下载未完成（${(error as Error).message}）；笔记记录未保存该页，请重新发送这张图片。`,
      );
      await this.repos!.inbox.mark(inboxEventId, { status: 'rejected', error: `原稿下载失败：${(error as Error).message}` });
    }
  }

  /** Worker-side structured recognition result → publish the pending version (P29/P30). */
  private async noteSubmit(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const notes = this.repos!.notes;
    const note = await notes.noteByWorkItem(item.id);
    if (!note) throw new Error('本事项未绑定手写笔记；请核对 noteId。');
    const boundedStringList = (value: unknown, max: number, limit: number): string[] => {
      const list = Array.isArray(value) ? value.map(v => text(v, max)) : [];
      if (list.length > limit) throw new Error(`列表条目超过 ${limit} 条上限。`);
      return list;
    };
    const savedPages = (await notes.pagesOf(note.id)).filter(p => p.status === 'saved');
    const savedPageNos = new Set(savedPages.map(p => p.page_no));
    const region = (value: unknown): Region | undefined => {
      if (!value || typeof value !== 'object') return undefined;
      const r = value as Record<string, unknown>;
      const parsed = { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) };
      if (Object.values(parsed).some(v => !Number.isFinite(v) || v < 0 || v > 1)) {
        throw new Error('疑点/图示区域必须是 0–1 的归一化坐标（x/y/w/h）。');
      }
      return parsed;
    };
    const pages = (Array.isArray(args.pages) ? args.pages : []).slice(0, MAX_PAGES_PER_NOTE).map((entry: Record<string, unknown>, index: number) => {
      const pageNo = Number(entry.pageNo);
      if (!Number.isInteger(pageNo) || !savedPageNos.has(pageNo)) {
        throw new Error(`逐页转写第 ${index + 1} 项的页号 ${String(entry.pageNo)} 不在已保存页中（已保存：${[...savedPageNos].sort((a, b) => a - b).join(', ')}）；缺页如实留空，不要臆造。`);
      }
      return { pageNo, transcript: text(entry.transcript, 20000) };
    });
    if (new Set(pages.map(p => p.pageNo)).size !== pages.length) throw new Error('逐页转写存在重复页号。');
    for (let i = 1; i < pages.length; i++) {
      if (pages[i]!.pageNo <= pages[i - 1]!.pageNo) throw new Error(`逐页转写必须按页号升序提交（第 ${i + 1} 项 ${pages[i]!.pageNo} ≤ 前项 ${pages[i - 1]!.pageNo}）；段落顺序以页序为准。`);
    }
    if (pages.length > 0 && pages.length !== savedPages.length) {
      throw new Error(`逐页转写需覆盖全部已保存页（已保存 ${savedPages.length} 页，收到 ${pages.length} 页）；缺失页请明确标注无法辨认。`);
    }
    const doubts: DoubtSpec[] = (Array.isArray(args.doubts) ? args.doubts : []).slice(0, 100).map((entry: Record<string, unknown>, index: number) => {
      const pageNo = Number(entry.pageNo);
      if (!savedPageNos.has(pageNo)) throw new Error(`疑点第 ${index + 1} 项引用了未保存的页号 ${String(entry.pageNo)}。`);
      const specifiedRegion = region(entry.region);
      return {
        pageNo,
        kind: String(entry.kind ?? 'unclear'),
        quote: text(entry.quote, 300),
        region: specifiedRegion,
        certainty: (specifiedRegion ? 'reliable' : 'page') as DoubtSpec['certainty'],
        note: entry.note ? text(entry.note, 300) : undefined,
      };
    });
    const diagrams: DiagramSpec[] = (Array.isArray(args.diagrams) ? args.diagrams : []).slice(0, 50).map((entry: Record<string, unknown>) => {
      const pageNo = Number(entry.pageNo);
      if (!savedPageNos.has(pageNo)) throw new Error(`图示引用了未保存的页号 ${String(entry.pageNo)}。`);
      return { pageNo, description: text(entry.description, 1000), region: region(entry.region) };
    });
    const recognized: RecognizedNote = {
      transcript: text(args.transcript, 20000),
      summary: text(args.summary ?? '（无摘要）', 2000),
      suggestions: boundedStringList(args.suggestions, 500, 50),
      unknowns: boundedStringList(args.unknowns, 500, 50),
      candidates: boundedStringList(args.candidates, 500, 50),
      relativeDates: (Array.isArray(args.relativeDates) ? args.relativeDates : []).slice(0, 20).map((entry: Record<string, unknown>) => ({
        original: text(entry.original, 200),
        interpretation: text(entry.interpretation, 500),
      })),
      ...(pages.length ? { pages } : {}),
      ...(doubts.length ? { doubts } : {}),
      ...(diagrams.length ? { diagrams } : {}),
    };
    // Regioned doubts/diagrams become durable crops before publishing (P30).
    const crops = await this.generateCrops(note.id, savedPages, doubts, diagrams);
    return this.publishNoteVersion(item, note, recognized, null, crops);
  }

  /**
   * Produce zoom crops for regioned doubts/diagrams from the saved originals
   * (P30): normalized regions map through the page's intrinsic size with
   * clamping; each crop keeps its transform record and sha256.
   */
  private async generateCrops(noteId: string, pages: NotePageRow[], doubts: DoubtSpec[], diagrams: DiagramSpec[]): Promise<CropSpec[]> {
    const entries: { kind: 'doubt' | 'diagram'; pageNo: number; region: Region }[] = [];
    for (const doubt of doubts) if (doubt.region) entries.push({ kind: 'doubt', pageNo: doubt.pageNo, region: doubt.region });
    for (const diagram of diagrams) if (diagram.region) entries.push({ kind: 'diagram', pageNo: diagram.pageNo, region: diagram.region });
    if (entries.length === 0) return [];
    let sharp: any;
    try {
      sharp = (await import('sharp')).default;
    } catch (error) {
      throw new Error(`生成疑点裁片需要 sharp（${(error as Error).message}）；请先不带区域提交，区域定位随后补充。`);
    }
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = join(this.workspace!.statePath, '.24pa', 'crops', noteId);
    await mkdir(dir, { recursive: true });
    const crops: CropSpec[] = [];
    for (const [index, entry] of entries.entries()) {
      const page = pages.find(p => p.page_no === entry.pageNo);
      if (!page) continue;
      const meta = await sharp(page.storage_path).metadata();
      if (!meta.width || !meta.height) throw new Error(`无法读取第 ${entry.pageNo} 页原稿尺寸，不能生成裁片。`);
      const { box, certainty } = cropBox(entry.region, meta.width, meta.height);
      const png = await sharp(page.storage_path).extract(box).png().toBuffer();
      const sha = sha256Hex(png);
      const id = `C${index + 1}`;
      const path = join(dir, `p${entry.pageNo}-${id}-${sha.slice(0, 12)}.png`);
      await writeFile(path, png, { mode: 0o600 });
      crops.push({ id, pageNo: entry.pageNo, kind: entry.kind, region: entry.region, certainty, path, sha256: sha });
      // Feed the real clamp verdict back: an adjusted region is published as
      // 估计, never 可靠 (P30 AC2).
      if (certainty === 'estimated' && entry.kind === 'doubt') {
        const target = doubts.find(d => d.pageNo === entry.pageNo && d.region === entry.region);
        if (target) target.certainty = 'estimated';
      }
    }
    return crops;
  }

  /**
   * Publish a pending review version. Stage-resumable: the created document id
   * is persisted on the staged operation before anything else can fail, so a
   * retry resumes from the read-back instead of creating a second document.
   * `republishFromDoc` (P32) skips creation and captures the current document
   * as the next candidate instead.
   */
  private async publishNoteVersion(
    item: WorkItemRow,
    note: NoteRow,
    recognized: RecognizedNote | null,
    republishFromDoc: { docId: string; docUrl: string | null; normalized: string; snapshot: string; revision: string | null } | null,
    crops: CropSpec[] = [],
  ): Promise<unknown> {
    const notes = this.repos!.notes;
    const pages = (await notes.pagesOf(note.id)).filter(p => p.status === 'saved');
    if (pages.length === 0) throw new Error('这份笔记还没有已保存的原稿页。');
    const latest = await notes.latestVersion(note.id);
    const version = (latest?.version ?? 0) + 1;
    const versionId = `${note.id}:v${version}`;
    this.assertFeishuLive('手写笔记发布需要 feishu 模式与飞书连接');
    const visionRoute = this.config!.workerModels.handwriting;
    const paramsKey = republishFromDoc ? `republish:${republishFromDoc.docId}:${sha256Hex(republishFromDoc.normalized)}` : sha256Hex(JSON.stringify(recognized));
    const staged = await this.stagedOperation(
      item,
      'note.publish',
      `${versionId}\n${paramsKey}`,
      { noteId: note.id, version, republish: !!republishFromDoc },
      '请先到飞书体验目录核对是否已生成待审文档，确认后再继续，不会自动重试。',
    );
    if (!staged.created && staged.row.status === 'succeeded') {
      const existing = await notes.getVersion(versionId);
      return { noteId: note.id, version, versionId, reused: true, docUrl: existing?.doc_url ?? staged.row.receipt?.docUrl ?? null, message: '该版本此前已发布，未重复创建文档。' };
    }
    try {
      let docId = (staged.row.receipt?.docId as string | undefined) ?? republishFromDoc?.docId ?? null;
      let docUrl = (staged.row.receipt?.docUrl as string | undefined) ?? republishFromDoc?.docUrl ?? null;
      if (!docId) {
        if (!recognized) throw new Error('发布新版本需要结构化识别结果。');
        const xmlBody = noteDocumentXml(note.id, version, recognized, pages.map(p => ({ pageNo: p.page_no, sha256: p.sha256, mediaType: p.media_type, byteSize: p.byte_size, sourceType: p.source_type })));
        const { data } = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
          'docs', '+create', '--as', 'user', '--doc-format', 'xml', '--parent-token', this.config!.folderToken, '--content', '-',
        ], xmlBody);
        const doc = data?.document;
        if (!doc?.document_id || !doc?.url) throw new Error('文档创建未返回标识；请先核对体验目录，不要盲目重试。');
        docId = String(doc.document_id);
        docUrl = String(doc.url);
        await this.repos!.operations.update(staged.row.id, { status: 'running', receipt: { docId, docUrl, stage: 'created' } });
      }
      // Original images ride into the doc from the saved originals; a failure
      // here leaves the operation resumable at the read-back stage.
      const insertedMedia = staged.row.receipt?.mediaInserted === true;
      if (!republishFromDoc && !insertedMedia) {
        const mediaFiles = [...pages.map(p => p.storage_path), ...crops.map(c => c.path)];
        for (const file of mediaFiles) {
          await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
            'docs', '+media-insert', '--as', 'user', '--doc', docId, '--type', 'image', '--file', file,
          ]);
        }
        await this.repos!.operations.update(staged.row.id, { status: 'running', receipt: { docId, docUrl, stage: 'media', mediaInserted: true } });
      }
      const readback = await this.fetchNoteDocument(docId);
      // Resource completeness: every saved page's original and every crop must
      // be present in the read-back before the review link may go out (P29/P30).
      const imageCount = (readback.content.match(/<img\b/g) ?? []).length;
      if (imageCount < pages.length + crops.length) {
        throw new Error(`文档回读不完整：仅见到 ${imageCount} 张图片（应有 ${pages.length} 页原稿 + ${crops.length} 张裁片）；不发送待审链接，请核对文档。`);
      }
      const normalized = normalizeDocument(readback.content);
      const fingerprint = fingerprintOf(normalized, pages.map(p => p.sha256), crops.map(c => c.sha256));
      const snapshot = republishFromDoc?.snapshot ?? readback.content;
      const finalRecognized = republishFromDoc
        ? { ...(latest?.content ?? {}), republishedFromDoc: true, previousVersion: latest?.version ?? null }
        : { ...recognized, model: visionRoute ? { provider: visionRoute.provider, model: visionRoute.model } : null, crops };
      await notes.insertVersion({
        id: versionId,
        note_id: note.id,
        version,
        doc_id: docId,
        doc_url: docUrl,
        doc_revision: readback.revision,
        fingerprint,
        normalized_text: normalized,
        content: finalRecognized,
        doc_snapshot: snapshot,
        status: 'pending_review',
      });
      await notes.supersedeOlder(note.id, version);
      // A new candidate supersedes the old version: its nags must stop (P33).
      if (latest) {
        await this.repos!.reviewReminders.cancelForVersion(latest.id).catch(error => {
          console.warn(`[pa24] 取消旧版本催办失败（派发时会再核对版本状态）：${(error as Error).message}`);
        });
      }
      await notes.updateNote(note.id, { status: 'awaiting_review' });
      await this.repos!.operations.update(staged.row.id, {
        status: 'succeeded',
        receipt: { docId, docUrl, versionId, fingerprint, revision: readback.revision },
      });
      await this.repos!.workItems.update(item.id, {
        result_ref: { operationId: staged.row.id, docId, docUrl, noteId: note.id, versionId },
      });
      await this.sendReviewCard(note.id, versionId);
      return {
        noteId: note.id,
        version,
        versionId,
        docUrl,
        fingerprint,
        message: `已生成待审版本 v${version} 并回读确认；等待本人在飞书审核卡上批准或退回。`,
      };
    } catch (error) {
      await this.failStaged(staged.row.id, error);
      throw error;
    }
  }

  private async fetchNoteDocument(docId: string): Promise<{ content: string; revision: string | null }> {
    const readback = await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
      'docs', '+fetch', '--as', 'user', '--doc', docId, '--doc-format', 'xml', '--detail', 'full',
    ]);
    const content = readback.data?.document?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('文档回读不完整，不能作为待审内容。');
    return { content, revision: readback.data.document.revision_id != null ? String(readback.data.document.revision_id) : null };
  }

  /** Enqueue the durable review card with opaque, server-verified tokens (P31). */
  private async sendReviewCard(noteId: string, versionId: string): Promise<void> {
    const notes = this.repos!.notes;
    const version = await notes.getVersion(versionId);
    if (!version) throw new Error('版本不存在，无法发送审核卡。');
    const approveToken = newReviewToken();
    const returnToken = newReviewToken();
    const expires = new Date(Date.now() + REVIEW_TOKEN_TTL_MS);
    await notes.insertToken({ token: approveToken, note_id: noteId, version_id: versionId, action: 'approve', owner_open_id: this.config!.ownerOpenId, fingerprint: version.fingerprint, expires_at: expires });
    await notes.insertToken({ token: returnToken, note_id: noteId, version_id: versionId, action: 'return', owner_open_id: this.config!.ownerOpenId, fingerprint: version.fingerprint, expires_at: expires });
    const summary = String(version.content?.summary ?? '（见文档）');
    const card = reviewCard(noteId, version.version, version.doc_url, summary, version.fingerprint.slice(0, 12), approveToken, returnToken);
    await this.repos!.outbox.enqueue({
      dedupKey: `notereview:${noteId}:v${version.version}`,
      channel: 'feishu',
      target: this.config!.ownerOpenId,
      kind: 'card',
      content: card,
    });
  }

  /**
   * Card click → server-side verification and transactional decision (P31).
   * The button only carries an opaque token; every binding is re-checked here.
   */
  private async processReviewCard(inboxEventId: string, event: InboundEvent): Promise<void> {
    const value = (event.cardAction?.value ?? {}) as Record<string, unknown>;
    const finish = async (status: 'delivered' | 'rejected' | 'duplicate', error?: string, requestId?: string) => {
      await this.repos!.inbox.mark(inboxEventId, { status, error, requestId });
    };
    if (value.pa24 !== 'review' || !value.token) {
      await finish('rejected', '未支持的卡片动作');
      return;
    }
    const token = String(value.token);
    const notes = this.repos!.notes;
    const row = await notes.getToken(token);
    const notify = (text: string) => this.notifyOwner(`review:${token.slice(0, 12)}:${inboxEventId}`, text);
    if (!row) {
      await notify('这个审核按钮不属于当前工作区或已失效；请以最新审核卡为准。');
      await finish('rejected', '未知审核令牌');
      return;
    }
    if (row.used_at || row.result) {
      await notify(`该按钮此前已处理：${typeof row.result?.message === 'string' ? row.result.message : '结果见此前通知'}；重复点击不产生新裁决。`);
      await finish('duplicate', '重复卡片动作');
      return;
    }
    if (row.expires_at.getTime() < Date.now()) {
      await notify('这个审核按钮已过期（7 天）；如需审核请要求重新发送审核卡。');
      await finish('rejected', '审核令牌过期');
      return;
    }
    if (this.config!.ownerOpenId && event.senderOpenId !== row.owner_open_id) {
      await notify('审核按钮只对绑定的主人有效；其他成员的操作已被拒绝。');
      await finish('rejected', '非主人操作');
      return;
    }
    const version = await notes.getVersion(row.version_id);
    if (!version || version.note_id !== row.note_id || version.status !== 'pending_review') {
      await notify(`该版本当前不是待审状态（${version?.status ?? '不存在'}）；请核对最新版本后操作。`);
      await finish('rejected', '版本状态不符');
      return;
    }
    // Re-verify the document matches the fingerprint this button was bound to.
    let liveFingerprint: string;
    try {
      liveFingerprint = await this.currentFingerprint(row.note_id, version.doc_id!);
    } catch (error) {
      await notify(`暂时无法核验文档当前内容（${(error as Error).message}）；本次点击未产生裁决，请稍后再试。`);
      await finish('rejected', '文档核验失败（unknown）');
      return;
    }
    if (liveFingerprint !== row.fingerprint) {
      await notes.updateVersion(version.id, { status: 'stale' });
      await notes.updateNote(row.note_id, { status: 'needs_rereview' });
      await notify('文档内容与待审版本不一致（已修改），本按钮不能批准当前内容；旧批准只覆盖旧快照。可要求重新发布候选版本。');
      await finish('rejected', '内容已变化');
      return;
    }
    const { claimed } = await notes.useToken(token);
    if (!claimed) {
      await notify('该按钮刚刚已被处理，结果见稍前通知；不产生重复裁决。');
      await finish('duplicate', '并发重复点击');
      return;
    }
    const decision = row.action === 'approve' ? 'approve' : 'return';
    const decisionId = `rvw-${randomUUID().slice(0, 16)}`;
    // Credential, statuses and the owner-notification intent commit together.
    await this.dbRef.withTransaction(client =>
      this.repos!.notes.decideVersion(client, {
        decisionId,
        noteId: row.note_id,
        versionId: row.version_id,
        versionStatus: decision === 'approve' ? 'approved' : 'returned',
        noteStatus: decision === 'approve' ? 'approved' : 'returned',
        decision,
        reviewerOpenId: event.senderOpenId,
        token,
        fingerprint: row.fingerprint,
        notifyDedupKey: `review:${token.slice(0, 12)}:${inboxEventId}`,
        notifyTarget: this.config!.ownerOpenId,
        notifyText: decision === 'approve'
          ? `已批准 ${row.note_id} v${version.version}（覆盖指纹 ${row.fingerprint.slice(0, 12)}…，审核人 ${event.senderOpenId}）。`
          : `已退回 ${row.note_id} v${version.version}；修改草稿后可要求重新发布候选版本。`,
      }),
    );
    // Document status refresh runs after the ledger commit; a failure here
    // keeps the credential and reports "saved / syncing" (P32).
    let syncMessage: string;
    if (this.config!.mode === 'feishu' && this.transport) {
      try {
        const decidedAt = nowIso();
        const newLine = decision === 'approve'
          ? systemLine(`本人已审核 ${row.note_id} v${version.version}（${decidedAt}；覆盖指纹 ${row.fingerprint.slice(0, 12)}…）`)
          : systemLine(`本人退回 ${row.note_id} v${version.version}（${decidedAt}）；修改后可要求重新发布候选`);
        await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
          'docs', '+update', '--as', 'user', '--doc', version.doc_id!,
          '--command', 'str_replace', '--pattern', pendingReviewLine(row.note_id, version.version),
          '--content', newLine,
        ]);
        await notes.updateDecisionSync(decisionId, { docSyncStatus: 'synced' });
        syncMessage = decision === 'approve' ? '文档审核状态已同步。' : '文档已标注退回状态。';
      } catch (error) {
        await notes.updateDecisionSync(decisionId, { docSyncStatus: 'failed', error: (error as Error).message });
        syncMessage = `审核凭证已保存，但文档状态同步失败（${(error as Error).message}）；标识同步中，可稍后重试核验。`;
      }
    } else {
      syncMessage = 'demo 模式：凭证已入账本，未同步文档状态。';
    }
    const result = {
      decision,
      noteId: row.note_id,
      version: version.version,
      fingerprint: row.fingerprint,
      message:
        decision === 'approve'
          ? `已批准 ${row.note_id} v${version.version}（覆盖指纹 ${row.fingerprint.slice(0, 12)}…，审核人 ${event.senderOpenId}）。${syncMessage}`
          : `已退回 ${row.note_id} v${version.version}；修改草稿后可要求重新发布候选版本。${syncMessage}`,
    };
    await notes.markTokenResult(token, result);
    if (syncMessage) {
      // The decision itself was notified transactionally; only the sync status
      // needs a follow-up when it differs from the happy path. Distinct dedup
      // key so it is never swallowed by the decision notification.
      await this.notifyOwner(`reviewsync:${token.slice(0, 12)}:${inboxEventId}`, `笔记 ${row.note_id} v${version.version}：${syncMessage}`);
    }
    await finish('delivered', undefined, `review:${decisionId}`);
  }

  /** Fingerprint of the live document for one note (shared verification path). */
  private async currentFingerprint(noteId: string, docId: string, versionRow?: { id: string; content: any } | null): Promise<string> {
    const pages = (await this.repos!.notes.pagesOf(noteId)).filter(p => p.status === 'saved');
    const version = versionRow ?? (await this.repos!.notes.latestVersion(noteId));
    const cropShas = (Array.isArray(version?.content?.crops) ? version.content.crops : []).map((c: { sha256: string }) => c.sha256);
    const readback = await this.fetchNoteDocument(docId);
    return fingerprintOf(normalizeDocument(readback.content), pages.map(p => p.sha256), cropShas);
  }

  /** Assert the Feishu transport is live; every note write path needs it. */
  private assertFeishuLive(context: string): void {
    if (this.config?.mode !== 'feishu' || !this.transport) throw new Error(`${context}：需要 feishu 模式与已启动的飞书连接。`);
  }

  /**
   * Retry document status-block sync for decisions whose refresh failed: the
   * credential is durable, only the projection lags (P32 恢复).
   */
  private async repairDecisionSync(noteId: string): Promise<number> {
    const notes = this.repos!.notes;
    const failed = await notes.failedSyncDecisions(noteId);
    let repaired = 0;
    for (const decision of failed) {
      const version = await notes.getVersion(decision.version_id);
      if (!version?.doc_id) continue;
      try {
        const newLine = decision.decision === 'approve'
          ? systemLine(`本人已审核 ${noteId} v${version.version}（${new Date(decision.decided_at).toISOString()}；覆盖指纹 ${decision.fingerprint.slice(0, 12)}…）`)
          : systemLine(`本人退回 ${noteId} v${version.version}（${new Date(decision.decided_at).toISOString()}）；修改后可要求重新发布候选`);
        await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
          'docs', '+update', '--as', 'user', '--doc', version.doc_id,
          '--command', 'str_replace', '--pattern', pendingReviewLine(noteId, version.version),
          '--content', newLine,
        ]);
        await notes.updateDecisionSync(decision.id, { docSyncStatus: 'synced' });
        repaired += 1;
      } catch {
        // Still failing; the credential remains and the lag stays visible.
      }
    }
    return repaired;
  }

  /** Bounded verification of a published version against the live document (P32). */
  private async verifyNote(noteId: string, options: { persist?: boolean } = {}): Promise<unknown> {
    const notes = this.repos!.notes;
    const note = await notes.getNote(noteId);
    if (!note) throw new Error('笔记不存在。');
    const latest = await notes.latestVersion(noteId);
    if (!latest) return { noteId, result: 'none', message: '这份笔记还没有已发布版本。' };
    let outcome: 'matches' | 'changed' | 'unknown';
    let fingerprint: string | null = null;
    let reason: string | null = null;
    try {
      fingerprint = await this.currentFingerprint(noteId, latest.doc_id!);
      outcome = fingerprint === latest.fingerprint ? 'matches' : 'changed';
    } catch (error) {
      outcome = 'unknown';
      reason = (error as Error).message;
    }
    if (options.persist !== false) {
      await notes.updateVersion(latest.id, {
        verified_at: new Date(),
        verify_result: outcome,
        verify_fingerprint: fingerprint,
      });
    }
    let repaired = 0;
    if (outcome === 'changed') {
      if (latest.status !== 'stale') {
        await notes.updateVersion(latest.id, { status: 'stale' });
        await notes.updateNote(noteId, { status: 'needs_rereview' });
        await this.notifyOwner(
          `notechange:${latest.id}`,
          `笔记 ${noteId} 的文档在发布 v${latest.version} 后被修改；待审/批准状态已标记需重新审核（旧批准仅覆盖旧快照）。可让助理“重新发布候选”。`,
        );
      }
    } else if (outcome === 'matches') {
      repaired = await this.repairDecisionSync(noteId);
    }
    return {
      noteId,
      latestVersion: latest.version,
      latestStatus: latest.status,
      result: outcome,
      ...(fingerprint ? { fingerprint } : {}),
      ...(reason ? { reason } : {}),
      ...(repaired > 0 ? { repairedDecisionSync: repaired } : {}),
      message:
        outcome === 'matches'
          ? `文档与 v${latest.version} 的指纹一致。${repaired > 0 ? `并补同步了 ${repaired} 条文档审核状态。` : ''}`
          : outcome === 'changed'
            ? `文档与 v${latest.version} 不一致（changed）；状态已转为需重新审核。`
            : `本次无法核验文档（${reason}）；不能据此宣称一致或已审。`,
    };
  }

  /** Refresh the candidate: current document content becomes v(n+1) (P32). */
  private async republishNote(item: WorkItemRow, noteId: string): Promise<unknown> {
    const notes = this.repos!.notes;
    const note = await notes.getNote(noteId);
    if (!note) throw new Error('笔记不存在。');
    const latest = await notes.latestVersion(noteId);
    if (!latest) throw new Error('这份笔记还没有已发布版本，无候选可刷新；请先识别整理。');
    const readback = await this.fetchNoteDocument(latest.doc_id!);
    const normalized = normalizeDocument(readback.content);
    if (normalized === latest.normalized_text) {
      return { noteId, result: 'unchanged', message: `当前文档与 v${latest.version} 一致，无需重发候选。` };
    }
    const diff = diffNormalized(latest.normalized_text, normalized);
    const carriedCrops = (Array.isArray(latest.content?.crops) ? latest.content.crops : []) as CropSpec[];
    const result = (await this.publishNoteVersion(item, note, null, {
      docId: latest.doc_id!,
      docUrl: latest.doc_url,
      normalized,
      snapshot: readback.content,
      revision: readback.revision,
    }, carriedCrops)) as Record<string, unknown>;
    // Point the document's status line at the new candidate version; the
    // system line is fingerprint-excluded, so this never invalidates it.
    try {
      await runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
        'docs', '+update', '--as', 'user', '--doc', latest.doc_id!,
        '--command', 'str_replace', '--pattern', pendingReviewLine(noteId, latest.version),
        '--content', pendingReviewLine(noteId, Number(result.version)),
      ]);
    } catch {
      // Status-line drift is cosmetic; the review card names the version.
    }
    return {
      ...result,
      diff: {
        addedLines: diff.added.length,
        removedLines: diff.removed.length,
        addedSamples: diff.added.slice(0, 5),
        removedSamples: diff.removed.slice(0, 5),
      },
      message: `已以当前文档内容发布 v${result.version} 待审候选（新增 ${diff.added.length} 行、删除 ${diff.removed.length} 行）；在本人批准前不继承旧结论。`,
    };
  }

  /** Lead-facing note inspection/control (pa24_notes). */
  async notesTool(args: Record<string, unknown>, agent: DshAgent): Promise<unknown> {
    const role = this.roleFor(agent);
    if (role !== 'feishu-access' && role !== 'local-robot') throw new Error('笔记查询与核验由24私助会话负责。');
    const notes = this.repos!.notes;
    const action = String(args.action ?? 'list');
    const noteId = args.noteId ? String(args.noteId) : '';
    if (action === 'queue') {
      return this.reviewQueue();
    }
    if (action === 'list') {
      const rows = await notes.listNotes(args.status ? String(args.status) : undefined, 20);
      const view = [];
      for (const row of rows) {
        const pages = await notes.pagesOf(row.id);
        const latest = await notes.latestVersion(row.id);
        view.push({
          noteId: row.id,
          title: row.title,
          status: row.status,
          pages: pages.length,
          savedPages: pages.filter(p => p.status === 'saved').length,
          latestVersion: latest ? { version: latest.version, status: latest.status, docUrl: latest.doc_url } : null,
        });
      }
      return { notes: view };
    }
    if (action === 'inspect') {
      if (!noteId) throw new Error('需要 noteId。');
      const note = await notes.getNote(noteId);
      if (!note) throw new Error('笔记不存在。');
      const pages = await notes.pagesOf(noteId);
      const versions = await notes.versionsOf(noteId);
      const decisions = await notes.decisionsOf(noteId);
      return {
        noteId: note.id,
        title: note.title,
        status: note.status,
        pages: pages.map(p => ({ pageNo: p.page_no, mediaType: p.media_type, bytes: p.byte_size, sha256: p.sha256.slice(0, 16) + '…', status: p.status, quality: p.quality })),
        versions: versions.map(v => ({ version: v.version, status: v.status, fingerprint: v.fingerprint.slice(0, 16) + '…', docUrl: v.doc_url, decidedAt: isoDate(v.decided_at) })),
        decisions: decisions.map(d => ({ decision: d.decision, versionId: d.version_id, reviewer: d.reviewer_open_id, decidedAt: isoDate(d.decided_at), docSync: d.doc_sync_status })),
      };
    }
    if (action === 'verify') {
      if (!noteId) throw new Error('需要 noteId。');
      return this.verifyNote(noteId);
    }
    if (action === 'finish') {
      if (!noteId) throw new Error('需要 noteId。');
      const note = await notes.getNote(noteId);
      if (!note) throw new Error('笔记不存在。');
      if (note.status !== 'collecting') throw new Error(`该笔记不在收集阶段（${note.status}），无需结束批次。`);
      const pages = (await notes.pagesOf(noteId)).filter(p => p.status === 'saved');
      if (pages.length === 0) throw new Error('该笔记还没有已保存原稿，不能结束为可整理批次。');
      await notes.updateNote(noteId, { status: 'collected' });
      return { noteId, status: 'collected', pages: pages.length, message: `批次已结束（共 ${pages.length} 页）；现在可以委派 handwriting 整理，之后不再追加页。` };
    }
    if (action === 'remind') {
      if (!noteId) throw new Error('需要 noteId。');
      const latest = await notes.latestVersion(noteId);
      if (!latest || latest.status !== 'pending_review') {
        throw new Error(`笔记 ${noteId} 当前没有待审版本（${latest ? latest.status : '尚无版本'}），提醒绑定待审版本；请先发布候选。`);
      }
      const kind = args.kind === 'daily' ? 'daily' : 'once';
      let remindAt: Date;
      if (args.at) {
        remindAt = new Date(String(args.at));
        if (Number.isNaN(remindAt.getTime())) throw new Error('at 需为可解析的 ISO 时间。');
      } else {
        const seconds = Number(args.inSeconds ?? 0);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 365 * 24 * 3600) throw new Error('remind 需要 inSeconds（1 秒–365 天）或绝对时间 at。');
        remindAt = new Date(Date.now() + seconds * 1000);
      }
      const id = `nrm-${randomUUID().slice(0, 12)}`;
      await this.repos!.reviewReminders.insert({ id, noteId, versionId: latest.id, kind, remindAt, reason: args.reason ? text(args.reason, 300) : undefined });
      return { reminderId: id, noteId, versionId: latest.id, kind, remindAt: remindAt.toISOString(), message: `已为 ${noteId} v${latest.version} 设置审核提醒（${kind}）；版本完成审核后自动取消。` };
    }
    if (action === 'remind_control') {
      const op = String(args.op ?? '');
      const byId = args.reminderId ? String(args.reminderId) : '';
      let targets: ReviewReminderRow[];
      if (byId) {
        const row = await this.repos!.reviewReminders.get(byId);
        if (!row) throw new Error('提醒不存在。');
        targets = [row];
      } else {
        if (!noteId) throw new Error('需要 reminderId 或 noteId。');
        targets = await this.repos!.reviewReminders.activeForNote(noteId);
        if (targets.length === 0) throw new Error(`笔记 ${noteId} 没有在途提醒。`);
      }
      const results = [];
      for (const reminder of targets) {
        if (!['pending', 'paused'].includes(reminder.status)) {
          results.push({ id: reminder.id, status: reminder.status, message: '该提醒已结束，操作无效。' });
          continue;
        }
        if (op === 'snooze') {
          const seconds = Number(args.inSeconds ?? 0);
          if (!Number.isInteger(seconds) || seconds < 1 || seconds > 7 * 24 * 3600) throw new Error('snooze 需要 inSeconds（1 秒–7 天）。');
          const next = new Date(Date.now() + seconds * 1000);
          await this.repos!.reviewReminders.update(reminder.id, { status: 'pending', remind_at: next });
          results.push({ id: reminder.id, status: 'pending', remindAt: next.toISOString(), message: `已稍后 ${seconds} 秒提醒（仍绑定原版本）。` });
        } else if (op === 'pause') {
          await this.repos!.reviewReminders.update(reminder.id, { status: 'paused' });
          results.push({ id: reminder.id, status: 'paused', message: '提醒已暂停；审核状态未变。' });
        } else if (op === 'resume') {
          await this.repos!.reviewReminders.update(reminder.id, { status: 'pending' });
          results.push({ id: reminder.id, status: 'pending', message: '提醒已恢复。' });
        } else if (op === 'cancel') {
          await this.repos!.reviewReminders.update(reminder.id, { status: 'canceled' });
          results.push({ id: reminder.id, status: 'canceled', message: '提醒已取消；审核状态未变。' });
        } else {
          throw new Error('未知提醒操作（snooze/pause/resume/cancel）。');
        }
      }
      return { results };
    }
    if (action === 'republish') {
      if (!noteId) throw new Error('需要 noteId。');
      // A durable work item owns the republish so retries stay idempotent.
      const id = `pa24-work-notes-${randomUUID()}`;
      const republishItem = await this.repos!.workItems.insert({
        id,
        title: `刷新笔记候选 ${noteId}`,
        role: 'handwriting',
        instruction: `刷新 ${noteId} 的待审候选`,
        origin: agent.id === this.accessSessionId ? 'feishu' : 'local',
        parent_session_id: agent.id,
        child_session_id: id,
        delivery: agent.id === this.accessSessionId ? `feishu:${this.config!.ownerOpenId}` : `local:${agent.id}`,
        status: 'running',
      });
      this.trackWorkItem(republishItem);
      try {
        return await this.republishNote(republishItem, noteId);
      } finally {
        await this.repos!.workItems.update(id, { status: 'completed', progress: '候选刷新完成' });
      }
    }
    throw new Error('未知笔记操作。');
  }

  /** Map a sent platform message to the work item / note / inbox it answers (P05, P28/P31). */
  private async recordMessageRoute(dedupKey: string, messageId: string): Promise<void> {
    if (!messageId) return;
    if (dedupKey.startsWith('workitem:')) {
      const workItemId = dedupKey.slice('workitem:'.length).split(':')[0];
      await this.repos!.messageRoutes.record(messageId, { kind: 'workitem', workItemId });
    } else if (dedupKey.startsWith('noteack:')) {
      const noteId = dedupKey.slice('noteack:'.length).split(':')[0];
      await this.repos!.messageRoutes.record(messageId, { kind: 'note', noteId });
    } else if (dedupKey.startsWith('notereview:')) {
      // Key form: notereview:<noteId>:v<version>
      const noteId = dedupKey.slice('notereview:'.length).split(':')[0]!;
      await this.repos!.messageRoutes.record(messageId, { kind: 'note', noteId });
    } else if (dedupKey.startsWith('reply:')) {
      const inboxEventId = dedupKey.slice('reply:'.length).split(':')[0];
      await this.repos!.messageRoutes.record(messageId, { kind: 'reply', inboxEventId });
    }
  }

  private noteVerifyTick(): void {
    if (this.noteVerifying || this.closed) return;
    this.noteVerifying = true;
    void this.pollPendingNotes()
      .catch(() => {})
      .finally(() => {
        this.noteVerifying = false;
      });
  }

  /** Verify up to 5 pending-review versions now; returns how many were checked. */
  async pollPendingNotes(): Promise<number> {
    if (!this.repos || !this.config || this.config.mode !== 'feishu' || !this.transport) return 0;
    const versions = await this.repos.notes.pendingReviewVersions(5);
    await Promise.all(versions.map(version => this.verifyNote(version.note_id).catch(() => {})));
    return versions.length;
  }

  private reviewReminderTick(): void {
    if (this.reviewReminding || this.closed) return;
    this.reviewReminding = true;
    void this.dispatchReviewReminders()
      .catch(() => {})
      .finally(() => {
        this.reviewReminding = false;
      });
  }

  /**
   * Send due review nagging (P33): every reminder re-checks its version is
   * still pending review (old versions never nag), reuses the quiet-hours
   * hold, and sends through the durable outbox. once → done; daily advances
   * with a 6h floor and a 3/day cap.
   */
  async dispatchReviewReminders(): Promise<number> {
    if (!this.repos || !this.config || this.config.mode !== 'feishu' || !this.config.ownerOpenId) return 0;
    const due = await this.repos.reviewReminders.claimDue(new Date(), 10);
    let sent = 0;
    for (const reminder of due) {
      const version = await this.repos.notes.getVersion(reminder.version_id);
      if (!version || version.status !== 'pending_review') {
        await this.repos.reviewReminders.update(reminder.id, { status: 'canceled' });
        continue;
      }
      const silentUntil = await this.silencePolicy.silentUntil();
      if (silentUntil && silentUntil.getTime() > Date.now()) {
        await this.repos.reviewReminders.update(reminder.id, { remind_at: silentUntil });
        continue;
      }
      await this.repos!.outbox.enqueue({
        dedupKey: `noteremind:${reminder.id}:${reminder.sent_count + 1}`,
        channel: 'feishu',
        target: this.config.ownerOpenId,
        kind: 'text',
        content: { text: `手写笔记待审核提醒：${reminder.note_id} v${version.version} 仍在等待你的审核${version.doc_url ? `（${version.doc_url}）` : ''}；审核请在飞书审核卡上批准或退回，也可以让助理“暂停/取消这个提醒”。` },
      });
      const sentCount = reminder.sent_count + 1;
      const next = advanceReminder(reminder.kind === 'daily' ? 'daily' : 'once', sentCount, Date.now());
      await this.repos.reviewReminders.update(reminder.id, {
        status: next.status,
        // remind_at stays NOT NULL: completed reminders keep their last due time.
        ...(next.remindAt ? { remind_at: next.remindAt } : {}),
        sent_count: sentCount,
        last_sent_at: new Date(),
      });
      sent += 1;
    }
    return sent;
  }

  /** Review queue view for the Lead tool and the panel (P33). */
  async reviewQueue(): Promise<unknown> {
    if (!this.repos) throw new Error('业务账本未就绪。');
    const queue = await this.repos.notes.reviewQueue();
    const reminders = await this.repos.reviewReminders.activeAll();
    return {
      count: queue.length,
      items: queue.map(note => ({
        noteId: note.id,
        noteStatus: note.status,
        title: note.title,
        pages: note.pages,
        latestVersion: note.latest
          ? {
              version: note.latest.version,
              status: note.latest.status,
              docUrl: note.latest.doc_url,
              fingerprint: note.latest.fingerprint.slice(0, 12) + '…',
              verifiedAt: isoDate(note.latest.verified_at),
              verifyResult: note.latest.verify_result,
            }
          : null,
        reminders: reminders
          .filter(r => r.note_id === note.id)
          .map(r => ({ id: r.id, kind: r.kind, status: r.status, remindAt: new Date(r.remind_at).toISOString(), sent: r.sent_count })),
      })),
    };
  }

  // ---- outbox worker --------------------------------------------------------

  private kickOutbox(): void {
    if (this.outboxSending || this.closed) return;
    this.outboxSending = true;
    void this.sendOutbox().catch(() => {}).finally(() => {
      this.outboxSending = false;
    });
  }

  async sendOutbox(): Promise<void> {
    if (!this.repos || !this.transport) return;
    for (;;) {
      const rows = await this.repos.outbox.claim(5);
      if (rows.length === 0) return;
      for (const row of rows) {
        try {
          const uuid = row.dedup_key.slice(0, 50);
          const sent =
            row.kind === 'card'
              ? await this.transport.sendCard(row.target, row.content, uuid)
              : await this.transport.sendText(row.target, String(row.content?.text ?? ''), uuid);
          this.lastSentAt = nowIso();
          await this.repos.outbox.mark(row.id, { status: 'sent', messageId: sent.messageId });
          await this.recordMessageRoute(row.dedup_key, sent.messageId);
        } catch (error) {
          const unknown = (error as any)?.outcome === 'unknown';
          const attempts = row.attempts;
          if (unknown) {
            await this.repos.outbox.mark(row.id, { status: 'unknown', error: (error as Error).message }).catch(() => {});
          } else if (attempts >= 3) {
            await this.repos.outbox.mark(row.id, { status: 'failed', error: (error as Error).message }).catch(() => {});
          } else {
            await this.repos.outbox.mark(row.id, { status: 'pending', error: (error as Error).message, retryInMs: 2000 * attempts }).catch(() => {});
          }
        }
      }
    }
  }

  // ---- diagnostics & readiness ---------------------------------------------

  async checkAccess(): Promise<AccessDiagnostics> {
    if (this.checking) return this.checking;
    if (!this.workspace || !this.config) throw new Error('尚未绑定工作区。');
    const workspace = this.workspace;
    const config = this.config;
    const bin = this.options.larkCliBin;
    const run = (this.checking = inspectAccess(config, bin, { path: workspace.statePath, sourceHash: this.sourceHash })
      .then(result => {
        if (this.workspace === workspace) this.diagnostics = result;
        return result;
      })
      .finally(() => {
        this.checking = null;
      }));
    return run;
  }

  readiness(): { startedAt: string | null; items: ReadinessItem[] } {
    const items: ReadinessItem[] = [];
    const config = this.config;
    const versions = resolveVersions();
    items.push({
      id: 'host',
      state: this.startupError ? 'error' : this.closed ? 'error' : 'ok',
      message: this.startupError
        ? `启动未完成：${this.startupError.message}`
        : this.closed
          ? '插件已停止'
          : `24私助 Host 运行中（Node ${process.version}，dsh ${versions.dsh}，飞书 SDK ${versions.sdk}）`,
    });
    items.push({
      id: 'config',
      state: config ? 'ok' : 'error',
      message: config
        ? `配置有效：mode=${config.mode}，profile=${config.larkProfile}，加载于 ${this.loadedAt}`
        : (this.configError ?? '尚未加载配置'),
      detail: config ? { source: join(this.workspace?.statePath ?? '', 'AGENTS.md'), hash: this.sourceHash.slice(0, 16) } : undefined,
    });
    items.push({
      id: 'postgres',
      state: this.db ? 'ok' : 'error',
      message: this.db
        ? 'PostgreSQL 业务账本已连接'
        : (this.configError && this.configError.includes('数据库') ? this.configError : 'PostgreSQL 未连接'),
    });
    items.push({
      id: 'workspace',
      state: this.workspace ? 'ok' : 'error',
      message: this.workspace ? `工作区：${this.workspace.statePath}` : '尚未绑定工作区目录',
    });
    items.push({
      id: 'feishu',
      state: this.transport ? 'ok' : this.configError && this.config?.mode === 'demo' ? 'info' : 'warn',
      message: this.transport
        ? `飞书长连接已启动（${this.transport.name}）；收 ${this.lastReceivedAt ?? '无'} / 发 ${this.lastSentAt ?? '无'}`
        : (this.transportError ?? '未启动'),
    });
    items.push({
      id: 'sessions',
      state: this.accessSessionId && this.localSessionId ? 'ok' : 'warn',
      message: this.accessSessionId
        ? `飞书接入会话 ${this.accessSessionId}；本地助理会话 ${this.localSessionId ?? '未建立'}`
        : '固定会话尚未建立',
    });
    return { startedAt: this.startedAt, items };
  }

  snapshot(): Record<string, unknown> {
    return {
      readiness: this.readiness(),
      workspace: this.workspace
        ? {
            path: this.workspace.statePath,
            config: this.config,
            loadedAt: this.loadedAt,
            configError: this.configError,
            accessSessionId: this.accessSessionId,
            localSessionId: this.localSessionId,
          }
        : null,
      availableWorkspaces: this.ctx.workspaceRegistry.list().map(w => ({ id: w.id, title: w.title, path: w.path })),
      transport: {
        connected: !!this.transport,
        name: this.transport?.name ?? null,
        message: this.transportError,
        lastReceivedAt: this.lastReceivedAt,
        lastSentAt: this.lastSentAt,
      },
      diagnostics: this.diagnostics,
    };
  }
}

function requireRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 0) throw new Error('需携带查询得到的 revision（expectedRevision）。');
  return revision;
}

function requireCategory(value: unknown): 'preference' | 'fact' | 'project' | 'decision' {
  const category = String(value ?? '');
  if (!['preference', 'fact', 'project', 'decision'].includes(category)) throw new Error('记忆类别无效。');
  return category as any;
}

function requireStatus(value: unknown): 'confirmed' | 'unverified' {
  const status = String(value ?? '');
  if (!['confirmed', 'unverified'].includes(status)) throw new Error('记忆状态无效。');
  return status as any;
}

/** Cached dependency versions surfaced by readiness (P01). */
let cachedVersions: { dsh: string; sdk: string } | null = null;
function resolveVersions(): { dsh: string; sdk: string } {
  if (cachedVersions) return cachedVersions;
  const require = createRequire(import.meta.url);
  const read = (name: string): string => {
    try {
      return String(require(`${name}/package.json`).version ?? '未知');
    } catch {
      return '未解析';
    }
  };
  cachedVersions = { dsh: read('@deepseek-ai/dsh'), sdk: read('@larksuiteoapi/node-sdk') };
  return cachedVersions;
}

/** In-process fake used by tests and demo mode to exercise the real pipeline. */
export class FakeFeishuTransport implements FeishuTransport {
  readonly name = 'fake';
  private handler: ((event: InboundEvent) => Promise<void>) | null = null;
  readonly sent: { openId: string; text?: string; card?: unknown; uuid: string; messageId: string }[] = [];
  private readonly resources = new Map<string, Buffer>();

  constructor(readonly appId: string) {}

  async start(onEvent: (event: InboundEvent) => Promise<void>): Promise<void> {
    this.handler = onEvent;
  }

  async inject(event: InboundEvent, imageData?: string): Promise<void> {
    if (!this.handler) throw new Error('fake transport 未启动。');
    const key = event.imageKey || event.fileKey;
    if (key && imageData) this.resources.set(key, Buffer.from(imageData, 'base64'));
    await this.handler(event);
  }

  async sendText(openId: string, text: string, uuid: string): Promise<{ messageId: string }> {
    const messageId = `fake-${uuid}`;
    this.sent.push({ openId, text, uuid, messageId });
    return { messageId };
  }

  async sendCard(openId: string, card: unknown, uuid: string): Promise<{ messageId: string }> {
    const messageId = `fake-${uuid}`;
    this.sent.push({ openId, card, uuid, messageId });
    return { messageId };
  }

  async downloadImage(_messageId: string, imageKey: string): Promise<Buffer> {
    const bytes = this.resources.get(imageKey);
    if (!bytes) throw new Error(`fake transport 没有登记图片资源：${imageKey}`);
    return bytes;
  }

  async close(): Promise<void> {
    this.handler = null;
  }
}
