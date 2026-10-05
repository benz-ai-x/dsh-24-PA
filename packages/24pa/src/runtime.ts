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
  env?: Record<string, string | undefined>;
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
  private dispatching = false;
  private outboxSending = false;
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
      brief: '待办与项目：task_create/task_update/task_complete/task_get/task_list/task_cancel 维护飞书任务（幂等、先核对、取消按平台能力如实说明），project_create/project_adopt/project_progress 拆解目标并按实际任务状态汇报进展。',
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
      },
    });
    this.roles.register({
      id: 'reminders',
      name: '事项提醒',
      persona: '你是 24私助的事项提醒 Worker。创建提醒前确认时间、时区与内容；时间计算由宿主的 dsh-schedule 公开函数完成，不自行推算。提醒由 PostgreSQL 发生实例和 Outbox 投递，模型离线也能发出。完成/稍后/取消都绑定原规则与实例，重复请求不产生多份。只报告平台接受状态，不推断已读。',
      brief: '提醒：reminder_create（once/every/daily/weekly）、reminder_list、reminder_cancel/pause/resume、reminder_skip、reminder_snooze、reminder_status（实例与平台接受状态）。',
      available: true,
      actions: {
        reminder_create: async args => {
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
      },
    });
    const planned: [string, string, string][] = [
      ['handwriting', '手写笔记', 'F06 手写笔记整理与人工审核'],
    ];
    for (const [id, name, feature] of planned) {
      this.roles.register({
        id,
        name,
        persona: `你是 24私助的${name} Worker。该职责已注册但业务能力尚未交付（${feature}）。收到委托时说明该能力尚未可用，不要臆造结果。`,
        brief: `该职责将在 ${feature} 交付；当前不可委派。`,
        actions: {},
        available: false,
      });
    }
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
    this.dispatchTimer.unref?.();
    this.outboxTimer.unref?.();
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
          const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
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
      } catch {
        return null;
      }
    },
    reason: async () => null,
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
      await this.notifyOwner(
        `card-unsupported:${event.eventId}`,
        '卡片操作尚未在此版本启用（手写审核随后交付）；请直接回复文字说明需要办理什么。',
      );
      await this.repos.inbox.mark(row.event_id, { status: 'rejected', error: '卡片暂不支持' });
      return;
    }
    if (event.messageType === 'image') {
      await this.notifyOwner(`image-unsupported:${event.eventId}`, '已收到图片。手写笔记整理在后续版本交付；当前版本请用文字描述需要记录的内容。');
      await this.repos.inbox.mark(row.event_id, { status: 'rejected', error: '图片暂不支持' });
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
    // (work item / object); it never falls back to a fresh delegation.
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
      const ref = item.result_ref as { docUrl?: string; operationId?: string } | null;
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

  async delegate(args: { worker: string; title: string; instruction: string }, agent: DshAgent): Promise<unknown> {
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
        await this.ctx.subagents.startContinuable({
          provider: 'spawn',
          label: `${persona.name} · ${item.title}`,
          childId: item.id,
          signal: this.lifetime.signal,
          request: {
            parent: parent.agent,
            prompt: [{ type: 'text', text: `事项：${item.title}\n委托内容：\n${item.instruction}` }],
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
      }
      await this.repos!.operations.update(staged.row.id, { status: 'succeeded', receipt: { eventId: newEventId, url, kind } });
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

  /** Map a sent platform message to the work item / inbox it answers (P05). */
  private async recordMessageRoute(dedupKey: string, messageId: string): Promise<void> {
    if (!messageId) return;
    if (dedupKey.startsWith('workitem:')) {
      const workItemId = dedupKey.slice('workitem:'.length).split(':')[0];
      await this.repos!.messageRoutes.record(messageId, { kind: 'workitem', workItemId });
    } else if (dedupKey.startsWith('reply:')) {
      const inboxEventId = dedupKey.slice('reply:'.length).split(':')[0];
      await this.repos!.messageRoutes.record(messageId, { kind: 'reply', inboxEventId });
    }
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

  constructor(readonly appId: string) {}

  async start(onEvent: (event: InboundEvent) => Promise<void>): Promise<void> {
    this.handler = onEvent;
  }

  async inject(event: InboundEvent): Promise<void> {
    if (!this.handler) throw new Error('fake transport 未启动。');
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

  async downloadImage(): Promise<Buffer> {
    throw new Error('fake transport 不支持图片。');
  }

  async close(): Promise<void> {
    this.handler = null;
  }
}
