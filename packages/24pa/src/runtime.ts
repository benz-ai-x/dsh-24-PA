import { UNSETTLED_WORK_STATUSES } from './repo/work.js';
import { WorkspaceExecution } from './workspace-execution.js';
import { consumedTurn } from './host-turn.js';
import { randomUUID, createHash } from 'node:crypto';
import { WorkspaceBackup } from './backup.js';
import { readFileSync } from 'node:fs';

/** F42：角色注册占位（≥10 字过校验）；真实 persona 在 Worker 启动时自 skill 目录装载。 */
const SKILL_SOURCED_PERSONA_PLACEHOLDER = '职责、完成标准与边界经任务 skill（worker-persona-*）在会话启动时装载；此处仅注册占位。';
import { createRequire } from 'node:module';
import { mkdir, realpath, stat, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type { DshContext, DshAgent, DshSession, ContentBlock, WorkspaceInfo, ContinuableStartSpec, NativeScheduleService } from './host.js';
import { PaDatabase, resolveDsn } from './pg.js';
import { SqliteDb } from './sqlite.js';
import type { PaDb } from './db.js';
import { InboxLifecycle } from './inbox-lifecycle.js';
import { WorkItemLifecycle } from './work-item-lifecycle.js';
import { createRepos, type Repos, type WorkItemRow, type ActionOperationRow, type TaskRow, type CalendarSyncRow, type NewOutbox } from './repo.js';
import { acquireHostLock, type HostLock } from './lock.js';
import { template, ConfigError, QWENNOTE_TOOL_PREFIX, QWENNOTE_TOOL_WILDCARD, VOLC_TTS_VOICES, noteParentToken, type PaConfig } from './config.js';
import { qwennoteChannelState } from './tools.js';
import { runLarkCli, sendLarkAudioMessage } from './lark.js';
import { resolveTtsEngine, probeTts, type TtsReadiness } from './tts.js';
import { writeSecretStore, secretStatus, resolveSecret, secretRefs, secretEnvironment, SECRET_KEYS, type SecretKey, type SecretStore, type SecretStatus } from './secrets.js';
import { readWorkspaceConfiguration, writeWorkspaceConfiguration, type WorkspaceConfiguration } from './workspace-config.js';
import { SdkFeishuTransport, FakeFeishuTransport, inspectAccess, cliOptions, type FeishuTransport, type InboundEvent, type AccessDiagnostics } from './feishu.js';
import { HandwritingPipeline } from './handwriting-pipeline.js';
import { WecomChannels, WECOM_CALENDAR_ID, type WecomDiagnostics } from './wecom-channels.js';
import { DigestService } from './digest-service.js';
import { ExternalOperations } from './external-operations.js';
import { OutboxDelivery } from './outbox-delivery.js';
import { TaskLifecycle } from './task-lifecycle.js';
import { assertToolDeclaration, type ResolvedTaskSkill, SkillCatalog, DEFAULT_PENDING_REMIND_TEMPLATE } from './skills.js';
import { FeishuChannels, mapRemoteEvent, taskExternal, taskFingerprint } from './feishu-channels.js';
import { text, nowIso, isoDate, eventFingerprint, hash, platformMessageKey } from './util.js';

import { RoleRegistry, type WorkerRoleDefinition, type WorkerActionHandler } from './roles.js';
import {
  WORKER_PROMPTS,
  workerPersonaFor,
  workerStartPrompt,
  digestWakePrompt,
  workspaceRulesSection,
} from './prompts.js';
import { MemoryStore, type MemoryChange } from './memory.js';
import { ReminderEngine, type SilencePolicy } from './reminders.js';
import { ReminderRouter } from './reminder-router.js';
import {
  createEveryScheduleRecord,
  createDailyScheduleRecord,
  createWeeklyScheduleRecord,
  resolveRecurringOccurrence,
  ScheduleId,
  type RecurringScheduleRecord,
} from '@deepseek-ai/dsh-schedule';
import {
  RECOGNITION_PAGE_LIMIT,
  advanceReminder,
  looksLikeVisionModel,
  sha256Hex,
  type NoteCandidate,
} from './handwriting.js';
import type { NoteRow, NotePageRow, ReviewReminderRow } from './repo.js';

/** dsh-skill 未挂载时 ctx.skills 是 cordis 惰性服务 getter（读即抛「without
 * inject」），防御性探测必须 try/catch 而非可选链。 */
function hostSkillRegistry(ctx: DshContext): ConstructorParameters<typeof SkillCatalog>[0] {
  try {
    return (ctx as unknown as { skills?: ConstructorParameters<typeof SkillCatalog>[0] }).skills ?? null;
  } catch {
    return null;
  }
}

const textOf = (content: readonly ContentBlock[] | undefined): string =>
  (content || []).filter(b => b.type === 'text').map(b => String(b.text ?? '')).join('\n').trim();



const SOURCE_LABELS: Record<'task' | 'calendar', string> = { task: '任务', calendar: '日程' };

/** Bounded grace before an unattributable delivery pauses its digest plan (P24). */
export { DIGEST_UNCONFIRMED_GRACE_MS } from './digest-service.js';

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

export type RuntimeRole = 'feishu-access' | 'local-robot' | 'worker' | null;
export type ReadinessItem = { id: string; state: 'ok' | 'warn' | 'error' | 'info'; message: string; detail?: unknown };

export class HostStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostStartupError';
  }
}

export interface RuntimeOptions {
  stateDirectory: string;
  backupSessionsRoot?: string;
  backupStoragesRoot?: string;
  backupAttachmentsRoot?: string;
  workspacePath: string;
  larkCliBin: string;
  wecomCliBin: string;
  cliTimeoutMs: number;
  dispatchTickMs: number;
  outboxTickMs: number;
  reminderTickMs: number;
  noteVerifyTickMs: number;
  reviewReminderTickMs: number;
  env?: Record<string, string | undefined>;
}

/** F16: calendar projection namespace for the wecom channel. */

// F23: wecom service-auth monitor cadence. Slow on purpose — read-only
// probes against wecom-cli; the ALERT is suppressed to one window per day
// (latest condition wins), the probe itself always runs.
const WECOM_AUTH_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const WECOM_AUTH_FIRST_CHECK_DELAY_MS = 10 * 60 * 1000;

export class PaRuntime {
  private readonly ctx: DshContext;
  readonly options: RuntimeOptions;
  private readonly env: Record<string, string | undefined>;
  private serial: Promise<unknown> = Promise.resolve();
  private readonly executions = new WorkspaceExecution();
  private builtInRoles: WorkerRoleDefinition[] = [];
  private readonly workerParents = new Set<string>();
  private readonly executionMessages = new Map<string, { generation: number; messageId: string }>();
  private readonly sessionGates = new Map<string, Promise<unknown>>();
  private readonly inboxLifecycle = new InboxLifecycle({
    repo: () => this.repos?.inbox ?? null,
    available: () => !this.closed && !this.workspaceChanging,
    process: row => this.processInbox(row),
    execute: work => this.executions.detached(() => this.executions.run(work)),
  });
  private workspaceBinding: string | null = null;

  private lock: HostLock | null = null;
  /** Best-effort usage counters since host start (P39 预算观测). */
  readonly usage = { modelRequests: 0, notePagesInput: 0, noteCrops: 0 };
  private db: PaDb | null = null;
  /** Resolved connection used by the active ledger, independent of later env/store edits. */
  private activePostgresDsn: string | null = null;
  private get dbRef(): PaDb {
    if (!this.db) throw new Error('业务账本未连接。');
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
  /** F36: 工作区密钥库（.24pa/secrets.json，0600）；env 引用优先、库兜底。 */
  private secretStore: SecretStore = {};
  private accessSessionId: string | null = null;
  private localSessionId: string | null = null;
  private preparingWorkspace: { workspace: WorkspaceInfo & { statePath: string }; config: PaConfig; accessSessionId: string; localSessionId: string; sessionNotices: { dedupKey: string; text: string }[]; extraToolResolution?: { requested: string[]; active: string[]; filtered: string[] } } | null = null;
  workspaceChanging = false;

  private transport: FeishuTransport | null = null;
  private transportError: string | null = null;
  private lastReceivedAt: string | null = null;
  private lastSentAt: string | null = null;
  private diagnostics: AccessDiagnostics | null = null;
  private checking: Promise<AccessDiagnostics> | null = null;

  private dispatchTimer: NodeJS.Timeout | null = null;
  private outboxTimer: NodeJS.Timeout | null = null;
  private wecomAuthTimer: NodeJS.Timeout | null = null;
  private noteVerifyTimer: NodeJS.Timeout | null = null;
  private reviewReminderTimer: NodeJS.Timeout | null = null;
  private reviewReminding = false;

  private readonly externalOperations = new ExternalOperations(() => this.repos!.operations);
  private readonly outboxDelivery = new OutboxDelivery({
    repo: () => this.repos!.outbox,
    routes: () => this.repos!.messageRoutes,
    sent: () => { this.lastSentAt = nowIso(); },
    adapters: {
      local: {
        available: () => !this.closed && !!this.config,
        supports: kind => kind === 'text',
        send: row => this.gate(row.target, async () => {
          const resolved = await this.ctx.sessionController.resolveAgent(row.target).catch(error => { throw Object.assign(new Error(`原发起会话暂不可用：${(error as Error).message}`), { outcome: 'failed' }); });
          if ('error' in resolved) throw Object.assign(new Error('原发起会话暂不可用，稍后补交事项结果。'), { outcome: 'failed' });
          let result;
          try {
            result = await this.executions.detached(() => this.ctx.sessionController.prompt({ requestId: row.dedup_key, sessionId: row.target, mode: 'queue', content: [{ type: 'text', text: String(row.content?.text ?? '') }], clientTimeZone: this.config!.timeZone }, this.lifetime.signal));
          } catch (error) {
            throw Object.assign(new Error(`会话接纳结果未知：${(error as Error).message}`), { outcome: 'unknown' });
          }
          if ('error' in result) throw Object.assign(new Error('原发起会话未接纳事项结果。'), { outcome: 'failed' });
          try { await this.ctx.sessions.flush(resolved.agent.session); }
          catch (error) { throw Object.assign(new Error(`会话已接纳但持久化未确认：${(error as Error).message}`), { outcome: 'unknown' }); }
          return { messageId: `local:${row.dedup_key}` };
        }),
      },
      wecom: {
        available: () => !!this.config,
        supports: kind => kind === 'text',
        send: row => this.wecomChannels.wecomSendText(row.target, String(row.content?.text ?? ''), platformMessageKey(row.channel, row.kind, row.dedup_key, row.target)),
      },
      feishu: {
        available: () => !!this.transport,
        supports: () => true,
        send: async row => {
          if (row.kind === 'audio') {
            const synth = resolveTtsEngine(this.config!.tts, this.secretEnv());
            if (!synth) throw Object.assign(new Error('TTS 引擎未配置（tts.engine=none），语音行无法投递。'), { outcome: 'failed' });
            const ogg = await synth(String(row.content?.text ?? '')).catch(error => { throw Object.assign(new Error(`语音合成失败：${(error as Error).message}`), { outcome: 'failed' }); });
            return sendLarkAudioMessage(cliOptions(this.config!, this.options.larkCliBin, 120_000), row.target, ogg, row.dedup_key);
          }
          return row.kind === 'card'
            ? this.transport!.sendCard(row.target, row.content, platformMessageKey(row.channel, row.kind, row.dedup_key, row.target))
            : this.transport!.sendText(row.target, String(row.content?.text ?? ''), platformMessageKey(row.channel, row.kind, row.dedup_key, row.target));
        },
      },
    },
  });

  private readonly taskLifecycle = new TaskLifecycle({
    repo: () => this.repos!.tasks,
    createChannel: () => this.config!.todoChannel,
    adapters: {
      feishu: {
        create: (item, args) => this.feishu.taskCreate(item, args),
        update: (item, task, args) => this.feishu.taskUpdate(item, { ...args, taskId: task.id }),
        complete: (item, task) => this.feishu.taskComplete(item, task),
        refresh: task => this.feishu.refreshTask(task),
      },
      wecom: {
        create: (item, args) => this.wecomChannels.wecomTaskCreate(item, args),
        update: async () => { throw new Error('企微待办首版不支持修改（F16 范围：创建/完成/删除）；如需调整，可删除后重建。'); },
        complete: (item, task) => this.wecomChannels.wecomTaskFinish(item, task),
        refresh: task => this.wecomChannels.refreshWecomTaskFromRemote(task),
        cancel: (item, task, reason) => this.wecomChannels.wecomTaskDelete(item, task, reason),
      },
    },
  });

  /** Common deep-module dependency subset (F31): wired once, spread into
   *  each channel module's initializer. */
  private baseChannelDeps() {
    return {
      repos: () => this.repos!,
      config: () => this.config!,
      notifyOwner: (dedupKey: string, body: string) => this.notifyOwner(dedupKey, body),
      stagedOperation: (item: WorkItemRow, kind: string, paramsKey: string, params: Record<string, unknown>, hint?: string) => this.stagedOperation(item, kind, paramsKey, params, hint),
      stagedOperationWithId: (id: string, item: WorkItemRow, action: string, params: Record<string, unknown>) => this.stagedOperationWithId(id, item, action, params),
      failStaged: (operationId: string, error: unknown) => this.failStaged(operationId, error),
      performExternal: <T>(operationId: string, invoke: () => Promise<T>) => this.externalOperations.perform(operationId, invoke),
    };
  }

  /** Handwriting note pipeline (F29): submit→publish→review→verify→republish
   *  behind a deep module; the runtime keeps role bindings and tick loops. */
  private readonly handwriting: HandwritingPipeline = new HandwritingPipeline({
    skillParams: name => this.skillCatalog.params(name),
    ...this.baseChannelDeps(),
    cli: () => ({ bin: this.options.larkCliBin, timeoutMs: this.options.cliTimeoutMs }),
    workspace: () => this.workspace,
    transport: () => this.transport,
    accessSessionId: () => this.accessSessionId,
    assertLive: context => this.assertFeishuLive(context),
    trackWorkItem: item => this.trackWorkItem(item),
    roleFor: agent => this.roleFor(agent),
    reviewQueue: () => this.reviewQueue(),
    usage: this.usage,
    dbRef: () => this.dbRef,
  });

  /** WeCom channel module (F30): calendar/todo/notify + auth monitoring. The
   *  runtime keeps channel selection (config semantics) and role bindings. */
  private readonly wecomChannels = new WecomChannels({
    ...this.baseChannelDeps(),
    cli: () => ({ bin: this.options.wecomCliBin, timeoutMs: this.options.cliTimeoutMs }),
    notifySourceChanged: (sourceType, sourceId, fp) => this.notifySourceChanged(sourceType, sourceId, fp),
    gate: (key, work) => this.gate(key, work),
    stagedOperationWithId: (operationId, item, action, params) => this.stagedOperationWithId(operationId, item, action, params),
    isClosed: () => this.closed,
  });

  /** Feishu channel module (round-3 arch-1): lark-cli writes, projection sync
   *  and receipts behind one deep module; channel selection stays here. */
  private readonly feishu = new FeishuChannels({
    ...this.baseChannelDeps(),
    cli: () => ({ bin: this.options.larkCliBin, timeoutMs: this.options.cliTimeoutMs }),
    gate: (key, work) => this.gate(key, work),
    stagedOperationWithId: (operationId, item, action, params) => this.stagedOperationWithId(operationId, item, action, params),
    notifySourceChanged: (sourceType, sourceId, fp) => this.notifySourceChanged(sourceType, sourceId, fp),
    memory: () => this.memory,
  });

  /** Reminder routing (round-3 arch-8): the F45 delegated-vs-ledger decision
   *  lives beside the ledger engine; the role table stays declarative. The
   *  ledger reference resolves lazily because repos bind at workspace load. */
  private readonly reminderRouter = new ReminderRouter({
    config: () => this.config!,
    repos: () => this.repos!,
    calendarWrite: (item, kind, args, operationId) => this.calendarWrite(item, kind, args, operationId),
    channelsLive: () => {
      if (this.config?.calendarChannel === 'wecom') return true;
      return this.config?.mode === 'feishu' && !!this.transport;
    },
    ledger: () => this.reminders!,
    resolveTask: args => this.resolveTask(args),
  });

  /** F40（spec 2.11）：任务 skill 目录——构造器里接宿主 registry 并注册内置件。 */
  private readonly skillCatalog: SkillCatalog;

  /** Recurring-digest & daily-planning service (F32): plans/build/render/
   *  delivery; F19 voice + F40/F41 skill tracks extend here. The runtime
   *  keeps role bindings, the follow-up tick and channel selection. */
  private readonly digest = new DigestService({
    ...this.baseChannelDeps(),
    cli: () => ({ bin: this.options.larkCliBin, timeoutMs: this.options.cliTimeoutMs }),
    accessSessionId: () => this.accessSessionId,
    workspace: () => this.workspace,
    startedAt: () => this.startedAt,
    reviewQueueCount: async () => Number(((await this.reviewQueue()) as { count?: number }).count ?? 0),
    memory: () => this.memory,
    nativeSchedule: () => this.nativeSchedule(),
    planChangesAvailable: () => !this.closed && !this.workspaceChanging,
    syncCalendarWindow: (calendarId, from, to) => this.syncCalendarWindow(calendarId, from, to),
    calendarWrite: (item, kind, args) => this.calendarWrite(item, kind, args),
    inspectNoteTrust: (noteId, versionId) => this.handwriting.inspectTrust(noteId, versionId),
    ownerNotification: (key, report) => this.ownerNotification(key, report),
    skillCatalog: () => this.skillCatalog,
  });

  /** Panel surface (digest.supervise action): stable runtime face (F32). */
  async superviseDigests(graceMs?: number): Promise<unknown> {
    return this.executions.run(async () => {
      return this.digest.superviseDigests(graceMs);
    });
  }

  async digestPlans(): Promise<unknown> {
    return this.executions.run(async () => {
      if (!this.repos) return { plans: [], skills: await this.skillCatalog.list() };
      return { ...((await this.digest.digestList()) as Record<string, unknown>), skills: await this.skillCatalog.list() };
    });
  }

  /** F40（spec 2.11）：面板三动作——改时间/换 skill/立即运行一次。 */
  async digestReschedule(args: Record<string, unknown>): Promise<unknown> {
    return this.executions.run(async () => {
      return this.digest.digestControl({ ...args, op: 'adjust' });
    });
  }

  async digestSetSkill(args: Record<string, unknown>): Promise<unknown> {
    return this.executions.run(async () => {
      return this.digest.digestControl({ ...args, op: 'skill' });
    });
  }

  async digestSetVoice(args: Record<string, unknown>): Promise<unknown> {
    return this.executions.run(async () => {
      return this.digest.digestControl({ ...args, op: 'voice', voice: args.voice !== false });
    });
  }

  async digestRunNow(planId: string): Promise<unknown> {
    return this.executions.run(async () => {
      return this.digest.digestRunNow(planId);
    });
  }
  private outboxSending = false;
  /** 最近一次 tts.probe 结果（健康面只读缓存，不做子进程探测）。 */
  private ttsProbeCache: { at: string; result: TtsReadiness } | null = null;
  private noteVerifying = false;
  closed = false;
  startedAt: string | null = null;
  startupError: HostStartupError | null = null;
  private readonly lifetime = new AbortController();

  constructor(ctx: DshContext, options: RuntimeOptions) {
    this.ctx = ctx;
    this.options = options;
    this.skillCatalog = new SkillCatalog(hostSkillRegistry(ctx), () => this.workspace?.statePath ?? null, file => {
      try {
        // F43：随包指南单一来源；读失败＝不注册该向导 skill（安全降级）。
        return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8') ?? null;
      } catch {
        return null;
      }
    });
    this.skillCatalog.registerBuiltins();
    this.env = options.env ?? process.env;
    this.registerBuiltInRoles();
    this.builtInRoles = this.roles.list();
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
      return { memoId: memo.id, topic, message: '资料摘要已保存入业务账本，可按主题检索。' };
    },
  };

  private registerBuiltInRoles(): void {
    this.roles.register({
      id: 'tasks',
      name: '待办管理',
      persona: SKILL_SOURCED_PERSONA_PLACEHOLDER,
      brief: WORKER_PROMPTS.tasks.brief,
      available: true,
      actions: {
        task_create: async (args, item) => this.taskCreate(item, args),
        task_update: async (args, item) => this.taskUpdate(item, args),
        task_complete: async (args, item) => this.taskComplete(item, args),
        task_get: async args => this.taskGet(args),
        task_cancel: async (args, item) => this.taskLifecycle.cancel(item, args),
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
      persona: SKILL_SOURCED_PERSONA_PLACEHOLDER,
      brief: WORKER_PROMPTS.memo.brief,
      available: true,
      actions: {
        memo_save: async (args, item) => this.saveMemo(item, args),
        minutes_build: async (args, item) => this.minutesBuild(item, args),
        minutes_adopt_actions: async (args, item) => this.minutesAdoptActions(item, args),
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
      id: 'skill',
      name: '任务 skill 执行',
      persona: SKILL_SOURCED_PERSONA_PLACEHOLDER,
      brief: WORKER_PROMPTS.skill.brief,
      available: true,
      actions: {
        // F44（spec 2.11）：载入放行面内的任务 skill 正文；越权名直接拒绝。
        // 轨判定收在 SkillCatalog.resolveForAgentRun（arch-6）：模板轨 skill
        // 在该 seam 被拒绝，调用方无法遗忘分支而烧掉模型回合。
        skill_run: async (args, item) => {
          const name = String(args.skill ?? item.skill ?? '');
          if (!item.skill || name !== item.skill) throw new Error('任务 skill 必须与该事项持久记录的委派选择一致；旧事项缺少选择时请重新委派。');
          if (!this.config?.extraBusinessSkills.includes(name)) {
            throw new Error(`任务 skill ${name || '（未指定）'} 未在 extraBusinessSkills 放行面内；请在 AGENTS.md 配置后重试。`);
          }
          const resolved = (await this.selectedWorkSkill(item))!;
          return { skill: resolved.name, track: 'agent' as const, content: resolved.content, message: '按上述任务指令执行，完成后汇报（含完成标准核对）；工具面以白名单为准，越权项如实报拒因。' };
        },
      },
    });
    this.roles.register({
      id: 'digest',
      name: '简报整理',
      persona: SKILL_SOURCED_PERSONA_PLACEHOLDER,
      brief: WORKER_PROMPTS.digest.brief,
      available: true,
      actions: {
        digest_build: async (args, item) => this.digest.digestBuild(item, args),
        digest_deliver: async (args, item) => this.digest.digestDeliver(item, args),
      },
    });
    this.roles.register({
      id: 'calendar',
      name: '日程编排',
      persona: SKILL_SOURCED_PERSONA_PLACEHOLDER,
      brief: WORKER_PROMPTS.calendar.brief,
      available: true,
      actions: {
        calendar_query: async args => this.calendarQuery(args),
        calendar_busy: async args => this.calendarBusy(args),
        calendar_create: async (args, item) => this.calendarWrite(item, 'create', args),
        calendar_update: async (args, item) => this.calendarWrite(item, 'update', args),
        calendar_cancel: async (args, item) => this.calendarWrite(item, 'cancel', args),
        meeting_schedule: async (args, item) => this.meetingSchedule(item, args),
        plan_today: async args => this.digest.planToday(args),
        meeting_prep_enable: async args => this.meetingPrepEnable(args),
        meeting_prep_build: async (args, item) => this.meetingPrepBuild(item, args),
        plan_preview: async args => this.digest.planPreview(args),
        plan_adopt: async (args, item) => this.digest.planAdopt(item, args),
        overview_today: async () => this.digest.overviewToday(),
      },
    });
    this.roles.register({
      id: 'reminders',
      name: '事项提醒',
      persona: SKILL_SOURCED_PERSONA_PLACEHOLDER,
      brief: WORKER_PROMPTS.reminders.brief,
      available: true,
      actions: {
        // arch-8：F45 路由与 delegated 生命周期收进 ReminderRouter（提示语义不变）。
        reminder_create: (args, item) => this.reminderRouter.route(item, args),
        reminder_list: async () => this.reminders!.list(),
        reminder_cancel: async (args, item) => this.reminderRouter.cancel(item, String(args.ruleId ?? ''), String(args.reason ?? '')),
        // F45：delegated 行的账本侧生命周期操作如实拒绝（日历事件照常，
        // 暂停/改期在 App 内或经日历更新进行）。
        reminder_pause: async args => { await this.reminderRouter.rejectDelegated(String(args.ruleId ?? ''), '暂停'); return this.reminders!.setStatus(String(args.ruleId ?? ''), 'paused', String(args.reason ?? '')); },
        reminder_resume: async args => { await this.reminderRouter.rejectDelegated(String(args.ruleId ?? ''), '恢复'); return this.reminders!.setStatus(String(args.ruleId ?? ''), 'active', String(args.reason ?? '')); },
        reminder_skip: async args => { await this.reminderRouter.rejectDelegated(String(args.ruleId ?? ''), '跳过'); return this.reminders!.skipThis(String(args.ruleId ?? ''), String(args.reason ?? '')); },
        reminder_snooze: async args => { await this.reminderRouter.rejectDelegated(String(args.ruleId ?? ''), '稍后'); return this.reminders!.snooze(String(args.ruleId ?? ''), Number(args.seconds ?? 0), String(args.reason ?? '')); },
        reminder_status: async args => this.reminders!.occurrenceStatus(String(args.occurrenceId ?? '')),
        digest_enable: async (args, item) => this.digest.digestEnable(args, item.id),
        digest_control: async args => this.digest.digestControl(args),
        digest_list: async () => this.digest.digestList(),
      },
    });
    this.roles.register({
      id: 'handwriting',
      name: '手写笔记',
      persona: SKILL_SOURCED_PERSONA_PLACEHOLDER,
      brief: WORKER_PROMPTS.handwriting.brief,
      available: true,
      actions: {
        note_submit: async (args, item) => this.handwriting.noteSubmit(item, args),
        note_adopt_actions: async (args, item) => this.noteAdoptActions(item, args),
        notes_search: async args => this.notesSearch(args),
      },
    });
  }

  /** Validate and persist the complete catalogue before making it effective. */
  async registerRole(definition: WorkerRoleDefinition, actionNames: readonly string[] = []): Promise<void> {
    return this.executions.run(async () => {
      return this.gate('roles', async () => {
        if (!this.workspace) throw new Error('请先绑定工作区，再注册角色。');
        if (this.roles.hasRegistered(definition.id)) throw new Error(`角色已注册：${definition.id}。`);
        const candidate = new RoleRegistry();
        for (const role of this.roles.list()) candidate.register(role);
        candidate.register({ ...definition, actions: { ...definition.actions, ...this.roleActions(actionNames) } });
        const declared = candidate.list().filter(role => !this.builtInRoles.some(builtin => builtin.id === role.id));
        for (const role of declared) this.roleActions(Object.keys(role.actions));
        await this.writeRuntimeJson(join(this.workspace.statePath, '.24pa', 'roles.json'), declared.map(role => ({
          id: role.id, name: role.name, persona: role.persona, brief: role.brief, available: role.available, actionNames: Object.keys(role.actions),
        })));
        this.roles.replace(candidate.list());
      });
    });
  }

  private roleActions(names: readonly string[]): Record<string, WorkerActionHandler> {
    return Object.fromEntries(names.map(name => {
      const handler = this.builtInActions[name];
      if (!handler) throw new Error(`未提供该动作实现：${name}。`);
      return [name, handler];
    }));
  }

  private async prepareRoles(path: string): Promise<WorkerRoleDefinition[]> {
    const candidate = new RoleRegistry();
    for (const role of this.builtInRoles) candidate.register(role);
    let source: string;
    try { source = await readFile(join(path, '.24pa', 'roles.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate.list(); throw error; }
    const declared = JSON.parse(source);
    if (!Array.isArray(declared)) throw new Error('工作区角色目录必须为数组。');
    for (const role of declared) {
      if (candidate.hasRegistered(role.id)) throw new Error(`工作区角色重复或覆盖内置角色：${role.id}。`);
      candidate.register({ ...role, actions: this.roleActions(Array.isArray(role.actionNames) ? role.actionNames : []) });
    }
    return candidate.list();
  }

  private async writeRuntimeJson(path: string, value: unknown): Promise<void> {
    const tmp = `${path}.${randomUUID()}.tmp`;
    await mkdir(join(path, '..'), { recursive: true });
    try { await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(tmp, path); }
    finally { await rm(tmp, { force: true }); }
  }

  registerRoleActions(roleId: string, actionNames: readonly string[]): void {
    const role = this.roles.get(roleId);
    if (!role) throw new Error(`角色未注册：${roleId}。`);
    this.roles.register({ ...role, actions: { ...role.actions, ...this.roleActions(actionNames) } });
  }

  /** Panel queries hold the same workspace as asynchronous business entries. */
  inspectWorkspace<T>(read: () => Promise<T>): Promise<T> { return this.executions.read(read); }

  listRoles(): { id: string; name: string; available: boolean }[] {
    return this.roles.list().map(r => ({ id: r.id, name: r.name, available: r.available }));
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(() => {
      if (this.closed) throw new Error('24私助已停止。');
      return work();
    });
    this.serial = result.catch(() => { });
    return result;
  }

  private transition<T>(change: () => Promise<T>): Promise<T> {
    return this.enqueue(() => this.executions.transition(async () => {
      this.workspaceChanging = true;
      try { return await change(); }
      finally { this.workspaceChanging = false; }
    }));
  }

  private gate<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.sessionGates.get(key) ?? Promise.resolve();
    const result = previous.then(work, work);
    this.sessionGates.set(key, result.catch(() => { }));
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
    if (this.options.workspacePath) {
      await this.bind(this.options.workspacePath, true);
    } else {
      try {
        const saved = await this.readSavedWorkspacePath();
        if (saved) await this.bind(saved);
        else this.configError = '尚未选择24私助工作区目录；请在「24私助工作区」面板绑定。';
      } catch (error) {
        // Recovery never creates a replacement for missing owner data. Keep the
        // panel available so the owner can locate/rebind the original directory.
        this.configError = `上次绑定的工作区无法恢复，请重新选择目录：${(error as Error).message}`;
      }
    }
    if (this.closed) {
      await this.cleanup();
      return;
    }
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
    // F23: proactive wecom service-auth monitoring — a silent expiry must not
    // wait for the owner to hit a business error. Read-only probes only; the
    // first check runs shortly after start, then at a slow cadence.
    this.wecomAuthTimer = setInterval(() => void this.authTick().catch(() => { }), WECOM_AUTH_CHECK_INTERVAL_MS);
    this.wecomAuthTimer.unref?.();
    const firstCheck = setTimeout(() => void this.authTick().catch(() => { }), WECOM_AUTH_FIRST_CHECK_DELAY_MS);
    firstCheck.unref?.();
    this.startedAt = nowIso();
  }

  private async readSavedWorkspacePath(): Promise<string | null> {
    try {
      const saved = JSON.parse(await readFile(join(this.options.stateDirectory, 'workspace.json'), 'utf8'));
      if (typeof saved.path !== 'string' || !isAbsolute(saved.path)) throw new Error('工作区发现记录无效。');
      return saved.path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.executions.stopAccepting();
    this.lifetime.abort();
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    if (this.outboxTimer) clearInterval(this.outboxTimer);
    if (this.wecomAuthTimer) clearInterval(this.wecomAuthTimer);
    try {
      await this.workLifecycle.idle();
      await this.retireWorkers();
    } finally {
      await this.cleanup();
    }
  }

  /** Native execution can outlive a stopped business row. Keep its parent
   * until the host confirms retirement, including uncertain start outcomes. */
  private async retireWorkers(): Promise<void> {
    const parents = new Set(this.workerParents);
    for (const item of this.workItemByChild.values()) parents.add(item.parent_session_id);
    const agents: DshAgent[] = [];
    for (const id of parents) {
      const resolved = await this.ctx.sessionController.resolveAgent(id).catch(() => null);
      if (resolved && !('error' in resolved)) agents.push(resolved.agent);
    }
    const drain = this.ctx.subagents?.drainDescendants ?? this.ctx.subagents?.drainContinuableDescendants;
    if (agents.length && drain) await this.executions.detached(() => drain.call(this.ctx.subagents, agents));
    this.workerParents.clear();
  }

  /** Release every acquired resource; safe to call again after a late start(). */
  private async cleanup(): Promise<void> {
    await this.executions.close();
    await this.inboxLifecycle.stop();
    await this.workLifecycle.idle();
    await this.digest.pause();
    if (this.noteVerifyTimer) clearInterval(this.noteVerifyTimer);
    this.noteVerifyTimer = null;
    if (this.reviewReminderTimer) clearInterval(this.reviewReminderTimer);
    this.reviewReminderTimer = null;
    this.reminders?.stop();
    this.reminders = null;
    await this.outboxDelivery.pause();
    await this.transport?.close().catch(() => { });
    this.transport = null;
    await this.db?.close().catch(() => { });
    this.db = null;
    this.repos = null;
    await this.lock?.release().catch(() => { });
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
    await this.outboxDelivery.recover();
    await this.workLifecycle.recover();
  }

  /** After a restart, re-attach the in-memory role map from the durable ledger. */
  private async restoreActiveWork(): Promise<void> {
    if (!this.repos) return;
    const active = await this.repos.workItems.list(UNSETTLED_WORK_STATUSES, 100);
    for (const item of active) this.trackWorkItem(item);
  }

  async bind(path: string, initialize = false): Promise<void> {
    return this.transition(async () => {
      this.workspaceChanging = true;
      try { await this.inboxLifecycle.pauseForSwitch(); await this.bindWorkspace(path, initialize); }
      finally { this.workspaceChanging = false; this.outboxDelivery.resume(); this.executions.detached(() => this.inboxLifecycle.resume()); }
      if (!this.closed) {
        await this.restoreActiveWork();
        await this.reconcileAfterRestart();
        await this.digest.recoverPlans();
      }
    });
  }

  private async bindWorkspace(path: string, initialize: boolean): Promise<void> {
    await this.digest.pause();
    try { await this.activateWorkspace(path, initialize); }
    finally { this.digest.resume(); }
  }

  private async activateWorkspace(path: string, initialize: boolean): Promise<void> {
    if (!isAbsolute(path)) throw new Error('工作区必须是服务器上的绝对目录。');
    const real = await realpath(await (initialize ? mkdir(path, { recursive: true }).then(() => path) : path));
    if (!(await stat(real)).isDirectory()) throw new Error('请选择目录。');
    // Switching the bound workspace while work is in flight would orphan the
    // running ledger; require the operator to finish or stop first.
    if (this.workspace && (await this.hasActiveWork())) {
      throw new Error('有进行中的事项；请先完成或停止，再切换工作区。');
    }

    const agentsMd = join(real, 'AGENTS.md');
    if (initialize && !(await stat(agentsMd).catch(() => null))) {
      const target = await this.ctx.fs.resolve(agentsMd);
      await this.ctx.fs.writeText(target, template(), { kind: 'createIfAbsent' }, undefined, { mode: 'workspace-write', workspaceRoot: real });
    }
    // Prepare with target-owned configuration and credentials. Nothing active
    // is stopped or replaced until all fallible preparation has succeeded.
    const candidate = await readWorkspaceConfiguration(real);
    const candidateRoles = await this.prepareRoles(real);
    const { db, postgresDsn } = await this.openDatabaseFor(real, candidate);
    const repos = createRepos(db);
    let next: NonNullable<PaRuntime['preparingWorkspace']>;
    let active: WorkItemRow[];
    let connection: Awaited<ReturnType<PaRuntime['prepareTransport']>> | undefined;
    try {
      const saved = await repos.workspaceState.get(real);
      next = {
        workspace: { ...await this.ctx.workspaceRegistry.create(real, '24私助'), statePath: real },
        config: candidate.config,
        accessSessionId: saved?.feishu_session_id ?? `pa24-${hash(real).slice(0, 12)}-feishu`,
        localSessionId: saved?.local_session_id ?? `pa24-${hash(real).slice(0, 12)}-local`,
        sessionNotices: [],
      };
      this.preparingWorkspace = next;
      next.accessSessionId = await this.prepareOwnedSession('feishu', next);
      next.localSessionId = await this.prepareOwnedSession('local', next);
      await repos.workspaceState.save(real, { feishuSessionId: next.accessSessionId, localSessionId: next.localSessionId });
      active = await repos.workItems.list(UNSETTLED_WORK_STATUSES, 100);
      await InboxLifecycle.recover(repos.inbox, async row => {
        await repos.outbox.enqueue({
          dedupKey: `reconcile:${row.event_id}`, channel: 'feishu',
          target: row.payload?.senderOpenId || candidate.config.ownerOpenId, kind: 'text',
          content: { text: '服务重启前有一条消息正在处理但未完成；如仍需要请重新发送。' }
        });
      });
      connection = await this.prepareTransport(candidate.config, candidate.secrets);
      await this.outboxDelivery.pause();
      await this.workLifecycle.idle();
      if (this.workspace && (await this.hasActiveWork())) throw new Error('有进行中的事项；请先完成或停止，再切换工作区。');
      if (this.closed) throw new Error('24私助已停止。');
      await this.retireWorkers();
      await this.writeRuntimeJson(join(this.options.stateDirectory, 'workspace.json'), { path: real });
    } catch (error) {
      connection?.cancel();
      await connection?.transport?.close().catch(() => { });
      await db.close().catch(() => { });
      throw error;
    } finally {
      this.preparingWorkspace = null;
    }
    const previousDb = this.db;
    const previousReminders = this.reminders;
    const previousTransport = this.transport;
    // Activate synchronously, so callbacks cannot observe half a workspace.
    this.db = db;
    this.activePostgresDsn = postgresDsn;
    this.repos = repos;
    this.workspace = next.workspace;
    this.workspaceBinding = randomUUID();
    this.accessSessionId = next.accessSessionId;
    this.localSessionId = next.localSessionId;
    this.applyWorkspaceConfiguration(candidate);
    this.transport = connection.transport;
    this.transportError = connection.error;
    connection.activate();
    this.memory = new MemoryStore(real, this.ctx);
    this.diagnostics = null;
    this.extraToolResolution = next.extraToolResolution ?? null;
    this.roles.replace(candidateRoles);
    this.executionMessages.clear();
    this.workItemByChild.clear();
    for (const item of active) this.trackWorkItem(item);
    this.reminders = new ReminderEngine(
      db,
      {
        execute: work => this.executions.detached(() => this.executions.run(work)),
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
    previousReminders?.stop();
    await previousTransport?.close().catch(() => { });
    await previousDb?.close().catch(() => { });
    this.reminders.start(this.options.reminderTickMs);
    // Resolve owner/channel only after activation, so a rebound notice cannot
    // enter the previous workspace's ledger or use its notification identity.
    for (const notice of next.sessionNotices) {
      await this.notifyOwner(notice.dedupKey, notice.text).catch(error => console.warn(`[pa24] 会话重建通知写入失败：${(error as Error).message}`));
    }
  }

  private async openDatabaseFor(workspacePath: string, candidate: WorkspaceConfiguration): Promise<{ db: PaDb; postgresDsn: string | null }> {
    const probe = candidate.config;
    // F25: default ledger is a SQLite file in the workspace; PostgreSQL runs
    // only by explicit workspace choice. No silent fallback either way.
    let db: PaDb;
    let postgresDsn: string | null = null;
    if (probe.storage === 'postgres') {
      postgresDsn = resolveDsn(probe.pgDsnEnv, secretEnvironment(probe, this.env, candidate.secrets));
      db = new PaDatabase(postgresDsn);
    } else {
      const dataDir = join(workspacePath, 'data');
      await mkdir(dataDir, { recursive: true });
      db = new SqliteDb(join(dataDir, 'pa24.db'));
    }
    try {
      await db.check();
      await db.migrate();
    } catch (error) {
      await db.close().catch(() => { });
      throw error;
    }
    return { db, postgresDsn };
  }

  async loadConfig(): Promise<PaConfig> {
    return this.transition(() => this.loadWorkspaceConfig());
  }

  private async loadWorkspaceConfig(): Promise<PaConfig> {
    const parsed = await readWorkspaceConfiguration(this.workspace!.statePath);
    await this.checkWorkspaceConfiguration(parsed.config, parsed.secrets);
    const reconnect = this.transportIdentity(this.config, this.secretStore) !== this.transportIdentity(parsed.config, parsed.secrets);
    const connection = reconnect ? await this.prepareTransport(parsed.config, parsed.secrets) : null;
    this.applyWorkspaceConfiguration(parsed);
    if (connection) await this.activateTransport(connection);
    return parsed.config;
  }

  private async checkWorkspaceConfiguration(config: PaConfig, secrets = this.secretStore): Promise<void> {
    if (this.config && this.config.storage !== config.storage) {
      throw new ConfigError('切换存储后端涉及数据迁移，请按初始化指南完成迁移后重新绑定工作区。');
    }
    if (this.config?.storage === 'postgres' && this.activePostgresDsn !== resolveSecret(secretRefs(config).pgDsn, this.env, secrets, 'pgDsn')) {
      throw new ConfigError('PostgreSQL 连接变化不能热重载；请按初始化指南更新连接配置后重新绑定工作区，当前账本连接保持不变。');
    }
    const identityChanged = this.config && (this.config.mode !== config.mode || this.config.ownerOpenId !== config.ownerOpenId || this.config.larkProfile !== config.larkProfile || this.transportIdentity(this.config, this.secretStore) !== this.transportIdentity(config, secrets));
    if (identityChanged) {
      await this.inboxLifecycle.assertIdle();
      if (await this.hasActiveWork()) throw new ConfigError('身份或接入模式变更前，请先完成或停止进行中的事项。');
    }

  }

  private applyWorkspaceConfiguration(parsed: WorkspaceConfiguration): void {
    this.config = parsed.config;
    this.secretStore = parsed.secrets;
    this.instructions = parsed.instructions;
    this.sourceHash = parsed.sourceHash;
    this.loadedAt = nowIso();
    this.configError = null;
  }

  private transportIdentity(config: PaConfig | null, store: SecretStore): string {
    const refs = secretRefs(config);
    return JSON.stringify([config?.mode, resolveSecret(refs.feishuAppId, this.env, store, 'feishuAppId'), resolveSecret(refs.feishuAppSecret, this.env, store, 'feishuAppSecret')]);
  }

  /**
   * Workspace prose rules from the bound AGENTS.md, injected as the
   * `24pa-workspace-rules` system section (order 910). Empty until a
   * workspace is bound and refreshed by every reload; user rules may only
   * tighten, never loosen, the built-in safety boundary (A3, ADR-0001).
   */
  workspaceRulesSection(): string {
    return workspaceRulesSection(this.instructions);
  }

  async reloadWorkspace(): Promise<void> {
    return this.transition(async () => {
      const previousHash = this.sourceHash;
      try {
        await this.loadWorkspaceConfig();
      } catch (error) {
        this.configError = `重载失败（保留当前生效配置）：${(error as Error).message}`;
        this.sourceHash = previousHash;
        throw error;
      }
    });
  }

  /**
   * F33/P60: 参数配置表单保存——以磁盘当前 raw 配置为底合并补丁（防快照过期
   * 覆盖），先跑完整校验器再原子写回唯一 ```json 块（工作规则区逐字节不变），
   * 随后走与 reload 相同的装载路径。storage/version 不在表单白名单。
   */
  async updateWorkspaceConfig(patch: Record<string, unknown>, expectedBinding = this.workspaceBinding): Promise<void> {
    if (!this.workspace) throw new Error('尚未绑定工作区。');
    return this.transition(async () => {
      this.assertWorkspaceBinding(expectedBinding);
      await writeWorkspaceConfiguration(this.workspace!.statePath, patch, (config, secrets) => this.checkWorkspaceConfiguration(config, secrets));
      try {
        await this.loadWorkspaceConfig();
      } catch (error) {
        this.configError = `表单保存后重载失败（文件已写入，保留旧生效配置）：${(error as Error).message}`;
        throw error;
      }
    });
  }

  // ---- F36: 工作区密钥库 ----------------------------------------------------

  /** 每个能力位对应的配置引用名（env 优先时读哪个变量）；空配置落规范名。 */
  private assertWorkspaceBinding(expected: string | null): void {
    if (!expected || expected !== this.workspaceBinding) throw new Error('工作区已切换，请刷新后重新编辑。');
  }

  private secretRefs(): Record<SecretKey, string> {
    return secretRefs(this.config);
  }

  /** env 副本＋密钥库兜底值按引用名回填——消费点统一用它，解析顺序单点成立。 */
  private secretEnv(): Record<string, string | undefined> {
    return secretEnvironment(this.config, this.env, this.secretStore);
  }

  secretValue(key: SecretKey): string {
    const refs = this.secretRefs();
    return resolveSecret(refs[key], this.env, this.secretStore, key);
  }

  /** 面板/快照可见状态（不含值）。 */
  secretStatusSnapshot(): SecretStatus {
    return secretStatus(this.secretRefs(), this.env, this.secretStore);
  }

  /**
   * 表单密钥更新：非空字符串＝写入密钥库，空串＝清除该位，缺省＝不动。
   * 与 AGENTS.md 完全解耦（密钥值永不进配置块）；feishu 凭据变化时重连通道。
   */
  async updateWorkspaceSecrets(values: Record<string, unknown>, expectedBinding = this.workspaceBinding): Promise<void> {
    if (!this.workspace) throw new Error('尚未绑定工作区。');
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new ConfigError('密钥补丁必须是对象。');
    const unknown = Object.keys(values).filter(k => !(SECRET_KEYS as readonly string[]).includes(k));
    if (unknown.length) throw new ConfigError(`未知密钥字段：${unknown.join('、')}。`);
    return this.transition(async () => {
      this.assertWorkspaceBinding(expectedBinding);
      const next: SecretStore = { ...(await readWorkspaceConfiguration(this.workspace!.statePath)).secrets };
      for (const key of SECRET_KEYS) {
        if (!(key in values)) continue;
        const value = values[key];
        if (typeof value !== 'string') throw new ConfigError(`密钥 ${key} 必须是字符串。`);
        const trimmed = value.trim();
        if (trimmed) next[key] = trimmed;
        else delete next[key];
      }
      await this.checkWorkspaceConfiguration(this.config!, next);
      await writeSecretStore(this.workspace!.statePath, next);
      const reconnect = this.transportIdentity(this.config, this.secretStore) !== this.transportIdentity(this.config, next);
      const connection = reconnect || (this.config?.mode === 'feishu' && !this.transport) ? await this.prepareTransport(this.config!, next) : null;
      this.secretStore = next;
      // 凭据可能刚到位/被清除：feishu 模式下按新解析结果重连（与配置保存同口径）。
      if (connection) await this.activateTransport(connection);
    });
  }

  private async hasActiveWork(): Promise<boolean> {
    if (!this.repos) return false;
    let count = 0;
    for (const status of UNSETTLED_WORK_STATUSES) {
      count += await this.repos.workItems.countByStatus(status);
    }
    return count > 0;
  }

  private async activateTransport(connection: Awaited<ReturnType<PaRuntime['prepareTransport']>>): Promise<void> {
    const previous = this.transport;
    this.transport = connection.transport;
    this.transportError = connection.error;
    connection.activate();
    await previous?.close().catch(() => { });
  }

  private async prepareTransport(config: PaConfig, store: SecretStore): Promise<{ transport: FeishuTransport | null; error: string | null; activate(): void; cancel(): void }> {
    const inactive = (error: string) => ({ transport: null, error, activate() { }, cancel() { } });
    if (config.mode !== 'feishu') return inactive('demo：未连接飞书；业务账本按工作区配置运行。');
    const env = secretEnvironment(config, this.env, store);
    const appId = env[config.appIdEnv];
    const appSecret = env[config.appSecretEnv];
    if (!appId || !appSecret) {
      return inactive(`feishu 模式缺少凭据（${config.appIdEnv}/${config.appSecretEnv}）：在面板「工作区与配置 → 密钥」填写，或设置同名环境变量；机器人未启动。`);
    }
    const transport = (this.env.PA24_TRANSPORT || '').trim() === 'fake' ? new FakeFeishuTransport(appId) : new SdkFeishuTransport(appId, appSecret);
    let settle!: (active: boolean) => void;
    const activated = new Promise<boolean>(resolve => { settle = resolve; });
    try {
      await this.executions.detached(() => transport.start(async event => {
        if (!await activated) throw new Error('接入准备已取消，事件尚未持久接收，请重试。');
        // Keep the ownership check and durable receive in the workspace gate.
        // Cancellation/retirement must reject so the platform can redeliver.
        await this.enqueue(async () => {
          if (this.closed || this.transport !== transport) throw new Error('接入已停止或切换，事件尚未持久接收，请重试。');
          await this.handleInbound(event);
        });
      }));
      return { transport, error: null, activate: () => settle(true), cancel: () => settle(false) };
    } catch (error) {
      settle(false);
      await transport.close().catch(() => { });
      throw new Error(`飞书长连接未启动（保留当前生效工作区）：${(error as Error).message}`);
    }
  }

  // ---- sessions ------------------------------------------------------------

  private async prepareOwnedSession(kind: 'feishu' | 'local', target: NonNullable<PaRuntime['preparingWorkspace']>): Promise<string> {
    const key = kind === 'feishu' ? 'accessSessionId' : 'localSessionId';
    const create = () => this.ctx.sessionController.create({ sessionId: target[key], workspaceId: target.workspace.id, agentPreset: 'pa24' });
    try { await create(); }
    catch (error) {
      if ((error as { code?: string }).code !== 'agent-preset/conflict') throw error;
      const previous = target[key];
      target[key] = `pa24-${hash(target.workspace.statePath).slice(0, 12)}-${kind}-${randomUUID().slice(0, 8)}`;
      await create();
      target.sessionNotices.push({ dedupKey: `notice:session-rebound:${target[key]}`, text: `旧会话 ${previous} 已选择其他预设，历史保留；24私助已建立新的${kind === 'feishu' ? '飞书接入' : '本地助理'}会话。` });
    }
    await this.ctx.sessionController.rename({ sessionId: target[key], title: kind === 'feishu' ? '24私助 · 飞书接入会话' : '24私助' }).catch(() => { });
    return target[key];
  }

  /** Agent creation during preparation must use that agent's workspace config. */
  configFor(agent: DshAgent): PaConfig | null {
    const pending = this.preparingWorkspace;
    return pending && agent.session.header.cwd === pending.workspace.statePath && [pending.accessSessionId, pending.localSessionId].includes(agent.id) ? pending.config : this.config;
  }

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
    await this.ctx.sessionController.rename({ sessionId: this.accessSessionId!, title: '24私助 · 飞书接入会话' }).catch(() => { });
    await this.createOwnedSession('local');
    await this.ctx.sessionController.rename({ sessionId: this.localSessionId!, title: '24私助' }).catch(() => { });
  }

  async openLocalSession(): Promise<string> {
    return this.executions.run(async () => {
      if (!this.localSessionId) await this.establishSessions();
      return this.localSessionId!;
    });
  }

  /** Tool construction may precede activation; this never authorizes business calls. */
  roleForToolMount(agent: DshAgent | undefined): RuntimeRole {
    const pending = this.preparingWorkspace;
    if (agent && pending && agent.session.header.cwd === pending.workspace.statePath) {
      if (agent.id === pending.accessSessionId) return 'feishu-access';
      if (agent.id === pending.localSessionId && !agent.parentAgent && !agent.session.header.parentSession && agent.session.header.origin !== 'subagent') return 'local-robot';
    }
    return this.roleFor(agent);
  }

  /** Business access belongs exclusively to the currently activated workspace. */
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

  /** Whether a subagent provider currently resolves (F18): an absent provider bundle leaves its extras unmounted. */
  providerAvailable(name: string): boolean {
    try {
      return this.ctx.subagents?.getProvider?.(name) != null;
    } catch {
      return false;
    }
  }

  private extraToolResolution: { requested: string[]; active: string[]; filtered: string[] } | null = null;

  /** Latest extraLocalTools resolution for the local role; surfaced by the health report (F18). */
  noteExtraToolResolution(resolution: { requested: string[]; active: string[]; filtered: string[] }): void {
    if (this.preparingWorkspace) { this.preparingWorkspace.extraToolResolution = resolution; return; }
    this.extraToolResolution = resolution;
  }

  /** mcp-remote token cache presence for the qwennote channel (F18 WP3):
   *  existence + mtime only — token contents are never read. */
  private async qwennoteTokenCache(): Promise<{ exists: boolean; updatedAt: Date | null }> {
    try {
      const { stat, readdir } = await import('node:fs/promises');
      const { homedir } = await import('node:os');
      const { join } = await import('node:path');
      const dir = join(homedir(), '.mcp-auth', 'mcp-remote-v1');
      const info = await stat(dir).catch(() => null);
      if (!info?.isDirectory()) return { exists: false, updatedAt: null };
      // The newest file mtime approximates the last token refresh.
      let latest: Date | null = null;
      for (const name of await readdir(dir)) {
        const file = await stat(join(dir, name)).catch(() => null);
        if (file?.isFile() && (!latest || file.mtime > latest)) latest = file.mtime;
      }
      return { exists: true, updatedAt: latest };
    } catch {
      return { exists: false, updatedAt: null };
    }
  }

  private readonly workItemByChild = new Map<string, WorkItemRow>();
  private readonly workLifecycle = new WorkItemLifecycle({
    repo: () => this.repos!.workItems,
    maxWorkers: () => this.config!.maxWorkers,
    available: () => !!this.repos && !!this.config && !this.closed && !this.workspaceChanging,
    start: item => this.startWorker(item),
    resume: async (item, input) => {
      const selected = await this.selectedWorkSkill(item);
      if (selected) input += `\n\n任务 skill ${selected.name}：\n${selected.content}`;
      const parent = await this.ctx.sessionController.resolveAgent(item.parent_session_id);
      if ('error' in parent) throw parent.error;
      this.workerParents.add(item.parent_session_id);
      const messageId = await this.executions.detached(() => this.ctx.subagents.sendMessage(parent.agent, item.child_session_id!, [{ type: 'text', text: input }], { signal: this.lifetime.signal })).catch(error => { throw Object.assign(error, { outcome: error.outcome ?? 'unknown' }); });
      if (typeof messageId === 'string') this.executionMessages.set(item.id, { generation: item.recovery_gen ?? 0, messageId });
      return typeof messageId === 'string' ? messageId : undefined;
    },
    quiesce: async item => {
      const parent = await this.ctx.sessionController.resolveAgent(item.parent_session_id);
      if ('error' in parent) throw parent.error;
      if (this.ctx.subagents.drainChildren) {
        await this.executions.detached(() => this.ctx.subagents.drainChildren!(parent.agent, [item.child_session_id ?? item.id]));
      } else {
        // Older hosts expose live agents but prohibit resolving a managed child
        // through the top-level SessionController. An absent child cold-resumes.
        const child = (this.ctx.get('agents') as { get?(id: string): DshAgent | undefined } | null)?.get?.(item.child_session_id ?? item.id);
        if (child?.whenIdle) await child.whenIdle();
        else if (child) throw new Error('宿主无法确认旧 Worker 已停止，请等待其结束后继续。');
      }
    },
    interrupt: item => this.ctx.subagents.interrupt(item.child_session_id ?? item.id, { kind: 'user', parentSessionId: item.parent_session_id }),
    track: item => this.trackWorkItem(item),
  });
  private trackWorkItem(item: WorkItemRow): void {
    if (this.workItemByChild.size > 500) {
      for (const [id, row] of this.workItemByChild) {
        if (['completed', 'failed', 'stopped'].includes(row.status)) this.workItemByChild.delete(id);
      }
    }
    this.workItemByChild.set(item.child_session_id ?? item.id, item);
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
    const notification = await this.ownerNotification(dedupKey, text);
    if (notification) await this.repos!.outbox.enqueue(notification);
  }

  /** Resolve the target before a caller commits its business change + outbox. */
  private async ownerNotification(dedupKey: string, text: string): Promise<NewOutbox | null> {
    if (!this.config) return null;
    if (this.config.notifyChannel === 'wecom') {
      // Single-direction wecom push; the reminder ledger stays the single
      // schedule track, only the delivery exit changes (ADR-0001).
      const owner = await this.wecomChannels.wecomOwnerUserid();
      return {
        dedupKey,
        channel: 'wecom',
        target: owner.userid,
        kind: 'text',
        content: { text },
      };
    }
    if (!this.config.ownerOpenId) return null;
    return {
      dedupKey,
      channel: 'feishu',
      target: this.config.ownerOpenId,
      kind: 'text',
      content: { text },
    };
  }

  /** Public channel surfaces (F30): panel RPC and the connection tool keep a
   *  stable runtime face; implementations live in WecomChannels. */
  private async authTick(): Promise<void> {
    return this.executions.run(async () => {
      await this.wecomChannels.authTick();
    });
  }

  wecomCheck(): Promise<WecomDiagnostics> {
    return this.executions.run(async () => {
      return this.wecomChannels.wecomCheck();
    });
  }

  wecomDiagnosticsSnapshot(): WecomDiagnostics | null {
    return this.wecomChannels.wecomDiagnosticsSnapshot();
  }

  // ---- inbound: durable inbox before ACK -----------------------------------

  async handleInbound(event: InboundEvent): Promise<void> {
    return this.executions.run(async () => {
      const config = this.config;
      if (!config || !this.repos) throw new Error('24私助尚未就绪。');
      this.lastReceivedAt = nowIso();
      const expectedApp = this.secretEnv()[config.appIdEnv] ?? '';
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
    });
  }

  private kickDispatcher(): void { this.executions.detached(() => this.inboxLifecycle.dispatch()); }

  private async processInbox(row: { event_id: string; kind: string; payload: any }): Promise<void> {
    return this.executions.run(async () => {
      if (!this.config || !this.repos) return;
      const event = row.payload as InboundEvent;
      if (row.kind === 'card') {
        await this.handwriting.processReviewCard(row.event_id, event);
        return;
      }
      const isInboundImage = event.messageType === 'image' || this.handwriting.isImageFileMessage(event);
      // Replies pin to their original target before any fresh handling: a photo
      // answering a note ack appends a page to that note instead of opening a
      // new one (P28: never auto-merge different discussions).
      if (event.parentMessageId && isInboundImage) {
        const route = await this.repos.messageRoutes.lookup(event.parentMessageId);
        if (route?.note_id) {
          await this.handwriting.collectNotePage(row.event_id, event, route.note_id);
          return;
        }
      }
      if (isInboundImage) {
        await this.handwriting.collectNotePage(row.event_id, event, null);
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
            `业务账本（${this.db?.kind === 'sqlite' ? 'SQLite' : 'PostgreSQL'}）：${pg?.state === 'ok' ? '正常' : pg?.message ?? '未知'}`,
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
    });
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
    await this.inboxLifecycle.admit(item.child_session_id, inboxEventId, `followup:${inboxEventId}`, async () => {
      const resumed = await this.workLifecycle.resume(item.id, `[本人补充] ${input}\n\n[路由依据：引用原事项「${item.title}」]`, true);
      return resumed.acceptedMessageId;
    });
  }

  private async submitToSession(sessionId: string, requestId: string, content: ContentBlock[], timeZone: string, inboxId: string): Promise<void> {
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId);
    if ('error' in resolved) throw resolved.error;
    this.lifetime.signal.throwIfAborted();
    await this.inboxLifecycle.admit(sessionId, inboxId, requestId, async () => {
      const result = await this.executions.detached(() => this.ctx.sessionController.prompt(
        { requestId, sessionId, mode: 'queue', content, clientTimeZone: timeZone }, this.lifetime.signal,
      ));
      if ('error' in result || !result.accepted) throw Object.assign('error' in result ? result.error : new Error('宿主未接纳输入。'), { outcome: 'rejected' });
    });
    try { await this.ctx.sessions.flush(resolved.agent.session); }
    catch (error) {
      if ((await this.repos!.inbox.get(inboxId))?.status === 'admitted') {
        await this.repos!.inbox.mark(inboxId, { status: 'admitted', error: `宿主已接纳，持久化待核对：${(error as Error).message}` });
      }
    }
  }

  // ---- session events: committed results become deliveries -----------------

  onSessionEvent(session: DshSession, event: { type: string; data: Record<string, any> }): void {
    if (this.closed || event.type !== 'turn/end') return;
    const binding = this.workspaceBinding;
    void this.executions.afterTransition(async () => {
      if (binding !== this.workspaceBinding) return;
      await this.gate(`turn:${session.id}`, () => this.onTurnEnd(session, event));
    }).catch(error => { if (!this.closed) console.warn(`[pa24] 回合结算待核对：${(error as Error).message}`); });
  }

  private async onTurnEnd(session: DshSession, event: { data: Record<string, any> }): Promise<void> {
    if (!this.repos || !this.config) return;
    this.usage.modelRequests += 1;
    await this.ctx.sessions.flush(session).catch(() => { });
    const turn = event.data.turn;
    const consumed = consumedTurn(session, turn);
    const failure = event.data.reason?.error;
    const messages = session
      .ownEvents()
      .filter(e => e.type === 'assistant/message' && e.data.turn === turn && !e.data.interrupted);
    const output = textOf(messages.at(-1)?.data?.message?.content);

    if (session.id === this.accessSessionId) {
      const reply = failure
        ? `本轮未完成：${failure.code === 'MISSING_CREDENTIAL' ? 'dsh 尚未配置模型，请先在模型设置中配置。' : failure.message ?? '模型执行失败'}`
        : output || '（本轮没有产生回复）';
      await this.inboxLifecycle.complete(session.id, consumed.requestIds, async inboxId => {
        const row = await this.repos!.inbox.get(inboxId);
        await this.repos!.outbox.enqueue({
          dedupKey: `reply:${inboxId}:${turn}`, channel: 'feishu',
          target: row!.payload.senderOpenId, kind: 'text', content: { text: reply }
        });
      }, failure ? String(failure.message ?? '模型执行失败') : undefined);
      return;
    }

    const item = this.workItemByChild.get(session.id);
    if (!item) return;
    await this.workLifecycle.idle();
    // Settle each consumed follow-up independently. A newer input can already
    // be queued while this turn flushes, but cannot steal the earlier receipt.
    await this.inboxLifecycle.complete(session.id, consumed.messageIds, async () => {});
    const fresh = await this.repos.workItems.get(item.id);
    if (!fresh || fresh.status !== 'running') return;
    const execution = this.executionMessages.get(fresh.id);
    if (!execution || execution.generation !== (fresh.recovery_gen ?? 0) || !consumed.messageIds.has(execution.messageId)) return;
    const failed = !!failure || !output;
    const result = failed ? `「${fresh.title}」未完成：${failure?.message ?? 'Worker 未产生结果'}` : output;
    await this.workLifecycle.finish(item.id, {
      output: result, failed, generation: execution.generation, delivery: row => {
        const dedupKey = `workitem:${row.id}:result:t${turn ?? 'n'}${row.recovery_gen ? `:g${row.recovery_gen}` : ''}`;
        const ref = row.result_ref as { docUrl?: string; operationId?: string } | null;
        const source = ref?.docUrl ? `\n出处：${ref.docUrl}\n操作编号：${ref.operationId}` : '';
        return row.origin === 'local'
          ? { dedupKey, channel: 'local', target: row.parent_session_id, kind: 'text', content: { text: `[事项回传]「${row.title}」${failed ? '未完成' : '已完成'}；请向本人汇报要点与出处。\n\n${result}${source}` } }
          : { dedupKey, channel: 'feishu', target: row.delivery.replace(/^feishu:/, ''), kind: 'text', content: { text: `「${row.title}」${failed ? '未完成' : '已完成'}：\n${result}${source}` } };
      }
    });
    void this.kickOutbox();
  }

  // ---- delegation & worker control -----------------------------------------

  async delegate(args: { worker: string; title: string; instruction: string; noteId?: string; skill?: string }, agent: DshAgent): Promise<unknown> {
    return this.executions.run(async () => {
      const role = this.roleFor(agent);
      if (role !== 'feishu-access' && role !== 'local-robot') throw new Error('只有24私助会话可以委派 Worker。');
      const config = this.config!;
      const workspace = this.workspace;
      const roleDef = this.roles.get(String(args.worker));
      if (!roleDef) {
        throw new Error(`未注册的 Worker 类型：${args.worker}。已注册：${this.roles.list().map(r => r.id).join(', ')}。`);
      }
      if (!roleDef.available) throw new Error(`「${roleDef.name}」已注册但业务能力尚未交付（${roleDef.brief}）`);
      if (!config.enabledWorkers.includes(String(args.worker))) throw new Error('此 Worker 未在配置中启用（enabledWorkers）。');
      let skillDefinition: ResolvedTaskSkill | null = null;
      if (String(args.worker) === 'skill') {
        // F44：通用 skill 执行 Worker 的双门——enabledWorkers 启用角色（上方既有
        // 校验）＋ per-skill 放行面；未放行在建事项前拒绝，不留半途事项。
        const skillName = String((args as { skill?: unknown }).skill ?? '');
        if (!skillName) throw new Error('委派任务 skill 需要携带 skill 名（worker=skill, skill=<name>）。');
        if (!config.extraBusinessSkills.includes(skillName)) throw new Error(`任务 skill ${skillName} 未在 extraBusinessSkills 放行面内；请先在工作区配置放行。`);
        skillDefinition = await this.skillCatalog.resolveForAgentRun(skillName, ['pa24_work', 'pa24_memory']);
      }
      const title = text(args.title, 200);
      const instruction = text(args.instruction);
      let note: NoteRow | null = null;
      if (String(args.worker) === 'handwriting') {
        if (!args.noteId || !String(args.noteId).trim()) throw new Error('手写整理需要携带 noteId（先由飞书拍照收集原稿，编号形如 N-1）。');
        note = await this.repos!.notes.getNote(String(args.noteId).trim());
        if (!note) throw new Error(`笔记 ${args.noteId} 不存在；请先用飞书拍照发送手写页。`);
        if (note.work_item_id) {
          const existing = await this.repos!.workItems.get(note.work_item_id);
          if (existing && UNSETTLED_WORK_STATUSES.some(status => status === existing.status)) {
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
      const fresh = await this.workLifecycle.admit(async () => {
        if (this.workspace !== workspace) throw new Error('工作区已切换，请在当前工作区重新交办。');
        const item = await this.repos!.workItems.insert({
          id,
          title,
          role: args.worker,
          // Raw delegation text only; context is composed when the child starts.
          instruction,
          skill: args.worker === 'skill' ? args.skill! : null,
          skill_definition: skillDefinition,
          origin,
          parent_session_id: agent.id,
          child_session_id: id,
          delivery: origin === 'feishu' ? `feishu:${config.ownerOpenId}` : `local:${agent.id}`,
          status: 'accepted',
        });
        try {
          if (String(args.worker) === 'digest') await this.digest.admit(item, agent.session);
          if (note) await this.repos!.notes.updateNote(note.id, { work_item_id: id });
          return (await this.repos!.workItems.update(id, { status: 'queued', progress: '排队等待 Worker' }))!;
        } catch (error) {
          await this.repos!.workItems.update(item.id, { status: 'failed', progress: `事项准入未完成：${(error as Error).message}` });
          throw error;
        }
      });
      return { workId: id, worker: args.worker, status: fresh?.status, message: '事项已接纳；接纳不代表完成。' };
    });
  }

  async pump(): Promise<void> {
    return this.executions.run(async () => {
      return this.workLifecycle.pump();
    });
  }

  private async selectedWorkSkill(item: WorkItemRow): Promise<{ name: string; content: string } | null> {
    if (item.role !== 'skill') return null;
    if (!item.skill || !this.config?.extraBusinessSkills.includes(item.skill)) throw new Error('事项选定的任务 skill 缺失或已撤销放行；请核对后重新委派。');
    if (!this.config.enabledWorkers.includes('skill')) throw new Error('任务 skill Worker 已撤销启用。');
    const definition = item.skill_definition;
    if (!definition || definition.name !== item.skill || definition.track !== 'agent' || !definition.content?.trim()) throw new Error('事项缺少已校验的任务 skill 定义，请重新委派。');
    assertToolDeclaration(definition.metadata, ['pa24_work', 'pa24_memory'], item.skill);
    return definition;
  }

  private async startWorker(item: WorkItemRow): Promise<void> {
    if (!this.repos || !this.config) throw new Error('工作区尚未就绪。');
    const selected = await this.selectedWorkSkill(item);
    const parent = await this.ctx.sessionController.resolveAgent(item.parent_session_id);
    if ('error' in parent) throw parent.error;
    const roleDef = this.roles.get(item.role);
    if (!roleDef) throw new Error(`Worker 类型未注册：${item.role}`);
    const modelRoute = this.config.workerModels[item.role];
    // B7: a route flagged simplePersona swaps in the reviewed simplified
    // copy when one exists; registered (dynamic) roles always use their
    // own persona as the fallback.
    // F42：persona 单一来源迁任务 skill 目录（worker-persona-<role>，simple
    // 变体随 simplePersona 路由）；registry 缺席时目录自带内置回落，
    // 动态注册角色仍用自己的 persona 兜底。
    const persona = (await this.skillCatalog.workerPersona(item.role, modelRoute?.simplePersona === true))
      ?? workerPersonaFor(item.role, modelRoute, roleDef.persona);
    // Handwriting children receive the saved originals inline; the dsh
    // attachment service persists them and the vision route carries them
    // to the model (P29: the request really contains the image).
    // startContinuable itself does NOT admit image parts (only the
    // subagent prompt remote does), so admission happens here: inline
    // base64 blocks would otherwise persist unadmitted and break the
    // model request.
    // Legacy in-flight items (delegated before the structured template)
    // carry the old composite instruction with its own time/brief lines;
    // they render one redundant pair of those lines until drained.
    let prompt: ContentBlock[] = [
      {
        type: 'text',
        text: workerStartPrompt({
          title: item.title,
          instruction: selected ? `${item.instruction}\n\n任务 skill ${selected.name}：\n${selected.content}` : item.instruction,
          nowIso: nowIso(),
          timeZone: this.config.timeZone,
          brief: roleDef.brief,
          doneCriteria: WORKER_PROMPTS[item.role]?.doneCriteria,
        }),
      },
    ];
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
    // dsh 0.2.1-alpha.2 renames startContinuable to startActivation and
    // requires an explicit delivery; 'parent' keeps the continuable
    // semantics (the child's completion notifies this Lead). Older hosts
    // (0.2.0-rc.2 / 0.2.1-alpha.1) only expose the legacy name.
    const startSpec: Omit<ContinuableStartSpec, 'delivery'> = {
      provider: 'spawn',
      label: `${roleDef.name} · ${item.title}`,
      childId: item.id,
      signal: this.lifetime.signal,
      request: {
        parent: parent.agent,
        prompt,
        persona,
        // send_message arrives as an adjacent-agent scoped tool and is
        // unaffected by global restrict(); the child can still report to
        // its parent through the native continuation channel.
        toolFilter: { allow: ['pa24_work', 'pa24_memory', ...(roleDef.tools ?? [])] },
        maxDepth: 1,
        ...(modelRoute ? { agentOptions: { provider: modelRoute.provider, model: modelRoute.model } } : {}),
      },
    };
    const subagents = this.ctx.subagents;
    this.workerParents.add(item.parent_session_id);
    let activation: any;
    if (typeof subagents.startActivation === 'function') activation = await this.executions.detached(() => subagents.startActivation!({ ...startSpec, delivery: 'parent' }));
    else if (typeof subagents.startContinuable === 'function') activation = await this.executions.detached(() => subagents.startContinuable!(startSpec));
    else throw new Error('宿主未提供 subagents 启动接口（startActivation/startContinuable 均缺失），请核对 dsh 版本兼容声明。');
    if (typeof activation?.messageId === 'string') this.executionMessages.set(item.id, { generation: item.recovery_gen ?? 0, messageId: activation.messageId });
    void activation?.result?.catch(() => { });
  }

  async control(args: { action: string; workId?: string; instruction?: string }, agent: DshAgent): Promise<unknown> {
    return this.executions.run(async () => {
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
        if (item.status !== 'stopped') await this.workLifecycle.stop(id);
        await this.inboxLifecycle.cancelTarget(item.child_session_id ?? item.id, '本人要求停止事项，补充输入不再续办。');
        return { workId: id, status: 'stopped' };
      }
      if (args.action === 'continue') {
        await this.workLifecycle.resume(id, text(args.instruction ?? '请继续处理本事项。', 2000));
        return { workId: id, status: 'running' };
      }
      throw new Error('未知事项操作。');
    });
  }

  async work(args: Record<string, unknown>, agent: DshAgent): Promise<unknown> {
    return this.executions.run(async () => {
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
    });
  }

  /**
   * pa24_memory: search is open to every workspace role; writes, maintenance
   * and undo require the local top-level 24私助 session (P42/P43).
   */
  async memoryTool(args: Record<string, unknown>, agent: DshAgent): Promise<unknown> {
    return this.executions.run(async () => {
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
    });
  }

  // ---- calendar (F04) -------------------------------------------------------

  private async calendarQuery(args: Record<string, unknown>): Promise<unknown> {
    if (this.config!.calendarChannel === 'wecom') return this.wecomChannels.wecomCalendarQuery(args);
    return this.feishu.calendarQuery(args);
  }

  private async calendarBusy(args: Record<string, unknown>): Promise<unknown> {
    if (this.config!.calendarChannel === 'wecom') return this.wecomChannels.wecomCalendarBusy(args);
    return this.feishu.calendarBusy(args);
  }

  private async calendarWrite(item: WorkItemRow, kind: 'create' | 'update' | 'cancel', args: Record<string, unknown>, operationIdOverride?: string): Promise<unknown> {
    const prior = kind === 'create' ? null : await this.repos!.calendar.findEvent(String(args.eventId ?? ''));
    const channel = prior?.channel ?? args.channel ?? this.config!.calendarChannel;
    const scoped = { ...args, calendarId: prior?.calendar_id ?? args.calendarId };
    if (channel === 'wecom') return this.wecomChannels.wecomCalendarWrite(item, kind, scoped, operationIdOverride);
    return this.feishu.calendarWrite(item, kind, scoped, operationIdOverride);
  }

  /**
   * Meeting scheduling with explicit-invitation semantics (P12): attendees
   * come from explicit open ids or memory contact records; ambiguity must be
   * clarified before anything is sent.
   */
  private async meetingSchedule(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    if (this.config!.calendarChannel === 'wecom') {
      throw new Error('会议邀请（meeting_schedule）依赖飞书联系人解析，企微日程渠道不可用；可先用 calendar_create 建企微日程（不含邀请），邀请由本人在企微发起。');
    }
    return this.feishu.meetingSchedule(item, args);
  }

  private async syncCalendarWindow(calendarId: string, from: Date, to: Date, channel?: 'feishu' | 'wecom'): Promise<{ ok: boolean; error?: string }> {
    if ((channel ?? (calendarId === 'wecom' ? this.config!.calendarChannel : 'feishu')) === 'wecom') return this.wecomChannels.syncWecomCalendarWindow(from, to);
    return this.feishu.syncCalendarWindow(calendarId, from, to);
  }

  // ---- tasks & projects (F03) ----------------------------------------------

  /** Best-effort remote refresh folded into the projection; returns the fresh row or null. */
  private async refreshTaskFromRemote(task: TaskRow): Promise<TaskRow | null> { return this.taskLifecycle.refresh(task); }

  /** Record a staged operation's failure with the unknown/failed distinction. */
  private async failStaged(operationId: string, error: unknown): Promise<void> { return this.externalOperations.fail(operationId, error); }

  private async stagedOperation(item: WorkItemRow, kind: string, paramsKey: string, params: Record<string, unknown>, reconcileHint?: string): Promise<{ created: boolean; row: ActionOperationRow }> { return this.externalOperations.stage(item, kind, paramsKey, params, reconcileHint); }

  /** Staged operation under a caller-chosen stable id (minutes candidates). */
  private async stagedOperationWithId(operationId: string, item: WorkItemRow, action: string, params: Record<string, unknown>): Promise<{ created: boolean; row: ActionOperationRow }> { return this.externalOperations.stageWithId(operationId, item, action, params); }

  private async taskCreate(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> { return this.taskLifecycle.create(item, args); }

  private async resolveTask(args: Record<string, unknown>) { return this.taskLifecycle.resolve(args); }

  private async taskUpdate(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> { return this.taskLifecycle.update(item, args); }

  private async taskComplete(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> { return this.taskLifecycle.complete(item, args); }

  private async taskGet(args: Record<string, unknown>): Promise<unknown> { return this.taskLifecycle.get(args); }

  private async taskList(args: Record<string, unknown>): Promise<unknown> {
    const projectId = args.projectId ? String(args.projectId) : null;
    const tasks = projectId ? await this.repos!.projects.tasksOf(projectId) : await this.repos!.tasks.list(args.status ? String(args.status) : undefined);
    return {
      count: tasks.length,
      tasks: tasks.map(t => ({ id: t.id, guid: t.task_guid, summary: t.summary, url: t.url, status: t.status, channel: t.channel, dueAt: isoDate(t.due_at), plannedAt: isoDate(t.planned_at), estimateMinutes: t.estimate_minutes })),
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
    const open = tasks.filter(t => t.status === 'open');
    const completed = tasks.filter(t => t.status === 'completed');
    return {
      projectId,
      name: project.name,
      goal: project.goal,
      total: tasks.length,
      completed: completed.length,
      canceled: tasks.filter(t => t.status === 'canceled').length,
      remaining: open.map(t => ({ guid: t.task_guid, summary: t.summary, dueAt: isoDate(t.due_at), plannedAt: isoDate(t.planned_at), estimateMinutes: t.estimate_minutes })),
      next: open[0] ? { guid: open[0]!.task_guid, summary: open[0]!.summary, dueAt: isoDate(open[0]!.due_at) } : null,
      message: open.length === 0 ? `项目暂无待办：已完成 ${completed.length} 项，已取消 ${tasks.filter(t => t.status === 'canceled').length} 项。` : `剩余 ${open.length} 项；下一步：${open[0]!.summary}`,
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
    return this.gate(operationId, async () => {
      let { created, row: operation } = await this.stagedOperationWithId(operationId, item, 'memo.save_doc', { topic, contentHash: hash(content) });
      if (!created && this.config!.mode === 'feishu' && operation.receipt?.demo === true && !operation.receipt.docId) {
        await this.repos!.operations.update(operationId, { status: 'failed', receipt: null });
        ({ created, row: operation } = await this.stagedOperationWithId(operationId, item, 'memo.save_doc', { topic, contentHash: hash(content) }));
      }
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
          throw new Error('上次保存的结果未知（超时或响应丢失）；请先核对配置的目录或知识库是否已生成文档，确认后再继续，不会自动重试。');
        }
      }
      const live = this.config!.mode === 'feishu';
      try {
        let external: { docId: string | null; url: string | null; revision: string | null; warnings: string[] } = {
          docId: (operation.receipt?.docId as string | undefined) ?? null,
          url: (operation.receipt?.docUrl as string | undefined) ?? null,
          revision: null,
          warnings: [],
        };
        if (live && !external.docId) {
          external = await this.externalOperations.perform(operationId, () => this.feishu.createMemoDocument(item, topic, content));
        }
        if (external.docId && live) {
          const readback = await this.feishu.readMemoDocument(external.docId);
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
          message: live && external.docId ? '备忘已保存为飞书文档并回读确认。' : '演示模式：备忘已入业务账本，未创建飞书文档。',
        };
      } catch (error) {
        await this.failStaged(operationId, error);
        throw error;
      }
    });
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
    if (!inserted && row.status === 'pending' && !(await this.repos!.operations.get(id))) {
      await this.repos!.outreach.mark(id, { status: 'unknown', error: '旧发送记录没有阶段回执；请先核对远端。' });
      throw new Error('旧发送记录没有阶段回执；请先核对远端，不自动重发。');
    }
    try {
      await this.stagedOperationWithId(id, item, 'outreach.send', { target: resolved.openId, content, instruction });
      const { data } = await this.externalOperations.perform(id, () => runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
        'im', '+messages-send', '--as', 'user', '--user-id', resolved.openId, '--text', content, '--idempotency-key', id,
      ]));
      const messageId = String(data?.message?.message_id ?? data?.message_id ?? '');
      if (!messageId) throw Object.assign(new Error('平台未返回消息标识；请先核对飞书是否已送达，不要盲目重试。'), { outcome: 'unknown' });
      await this.repos!.outreach.mark(id, { status: 'succeeded', messageId });
      await this.repos!.operations.update(id, { status: 'succeeded', receipt: { messageId } });
      return { operationId: id, messageId, target: resolved, message: `已按本人明确指令发送给 ${resolved.name}（以平台回执为准）。` };
    } catch (error) {
      await this.failStaged(id, error);
      const unknown = (error as any)?.outcome === 'unknown';
      await this.repos!.outreach.mark(id, { status: unknown ? 'unknown' : 'failed', error: (error as Error).message });
      throw error;
    }
  }

  /** Assign an existing task to a collaborator under an explicit instruction (P13). */
  private async taskAssign(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const taskRef = await this.resolveTask(args);
    if (taskRef.channel !== 'feishu') throw new Error('当前分派能力只支持飞书任务；企微待办未执行分派。');
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
      await this.externalOperations.perform(staged.row.id, () => runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
        'task', '+assign', '--as', 'user', '--task-id', taskRef.task_guid, '--add', resolved.openId, '--idempotency-key', staged.row.id,
      ]));
      await this.repos!.outreach.insert({
        id: staged.row.id,
        work_item_id: item.id,
        kind: 'assign',
        target_open_id: resolved.openId,
        target_name: resolved.name,
        content: `分派任务 ${taskRef.task_guid}`,
        instruction,
        status: 'pending',
      });
      await this.repos!.outreach.mark(staged.row.id, { status: 'succeeded', taskGuid: taskRef.task_guid });
      await this.repos!.operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: taskRef.task_guid, assignee: resolved.openId } });
      return { operationId: staged.row.id, guid: taskRef.task_guid, assignee: resolved, message: `已把任务分派给 ${resolved.name}（以平台回执为准）。` };
    } catch (error) {
      await this.failStaged(staged.row.id, error);
      await this.repos!.outreach.mark(staged.row.id, { status: (error as any)?.outcome === 'unknown' ? 'unknown' : 'failed', error: (error as Error).message, taskGuid: taskRef.task_guid });
      throw error;
    }
  }

  /** Current fingerprint of a followed source, or null when it cannot be read. */
  private async sourceVerdict(sourceType: 'task' | 'calendar', sourceId: string, expected: string | null): Promise<{ valid: boolean; unknown?: boolean; reason?: string }> {
    try {
      if (sourceType === 'task') {
        const task = (await this.repos!.tasks.byGuid(sourceId)) ?? (await this.repos!.tasks.get(sourceId));
        if (!task) return { valid: false, reason: '任务已不存在' };
        const refreshed = await this.refreshTaskFromRemote(task);
        if (!refreshed) return { valid: false, unknown: true, reason: '任务权威来源读取失败，请重新核对' };
        if (refreshed.status !== 'open') return { valid: false, reason: '任务已完成或取消' };
        const fingerprint = taskFingerprint(refreshed);
        return fingerprint === expected ? { valid: true } : { valid: false, reason: '任务内容或截止已变化' };
      }
      const event = await this.repos!.calendar.findEvent(sourceId);
      if (!event || event.status === 'canceled') return { valid: false, reason: event ? '日程已取消' : '日程已不存在' };
      const state = await this.repos!.calendar.getSync(event.calendar_id);
      if (!state || state.channel !== event.channel || !state.complete || state.last_error || state.window_start >= event.end_time || state.window_end <= event.start_time) {
        return { valid: false, unknown: true, reason: `日历同步异常（${state?.last_error ?? '窗口未覆盖该日程'}），投影可能过期；请先重新查询日历` };
      }
      const fingerprint = eventFingerprint(event);
      return fingerprint === expected ? { valid: true } : { valid: false, reason: '日程内容或时间已变化' };
    } catch (error) {
      return { valid: false, unknown: true, reason: `来源核对失败：${(error as Error).message}` };
    }
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
      await this.repos.reminders.updateRule(rule.id, { status: 'stopped' });
      await this.repos.reminders.cancelPendingOccurrences(rule.id);
      if ((counts && (counts.pending > 0 || counts.canceled > 0)) || upcoming) {
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
    if (sourceType === 'calendar') {
      // Prep packages bound to this meeting stop too (P26): no stale packages.
      const preps = await this.repos!.digests.activeMeetingPreps(sourceId).catch(() => [] as Array<{ id: string; schedule_id: string | null; session_id: string }>);
      for (const prep of preps) {
        const stopped = await this.digest.plans.stop(prep.id, 'stopped');
        if (stopped.warning) throw new Error(stopped.warning);
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
    return this.executions.run(async () => {
      if (!this.repos || this.config?.mode !== 'feishu') return 0;
      let generated = 0;
      for (; ;) {
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
            await this.externalOperations.stageWithId(operationId, { id: 'pa24-system-templates' }, 'task.repeat_generate', { instanceId: instance.id, title: template.title });
            const { data } = await this.externalOperations.perform(operationId, () => runLarkCli(cliOptions(this.config!, this.options.larkCliBin, this.options.cliTimeoutMs), [
              'task', '+create', '--as', 'user', '--summary', `[24PA] ${template.title}`, '--tasklist-id', template.tasklist_id, '--idempotency-key', operationId,
            ]));
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
    });
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
    void this.materializeTemplateInstances().catch(() => { });
    void this.dispatchWaitingCheckpoints().catch(() => { });
    void this.superviseDigests().catch(() => { });
  }

  private async dispatchWaitingCheckpoints(): Promise<number> {
    return this.executions.run(async () => {
      if (!this.config?.ownerOpenId || this.config.mode !== 'feishu') return 0;
      const due = await this.repos!.waiting.claimDue(new Date(), 5);
      for (const item of due) {
        const silentUntil = await this.silencePolicy.silentUntil();
        if (silentUntil && silentUntil.getTime() > Date.now()) {
          await this.repos!.waiting.update(item.id, { checkpoint_at: silentUntil, ask_count: item.ask_count - 1 });
          continue;
        }
        await this.notifyOwner(
          `waiting:${item.id}:${item.ask_count}`,
          `等待跟进：「${item.title}」到检查点了${item.source_desc ? `（来源：${item.source_desc}）` : ''}——收到了吗？回复让助理记录（收到 / 继续等 / 改时间 / 取消）；不会自动向对方催办。`,
        );
        // One ask per checkpoint: without an answer the next ask backs off an
        // hour instead of nagging every tick (P23 到点询问).
        await this.repos!.waiting.update(item.id, { checkpoint_at: new Date(Date.now() + 3600 * 1000) });
      }
      return due.length;
    });
  }

  // ---- daily planning & recurring digests (F09) -------------------------------

  private nativeSchedule(): NativeScheduleService | null {
    const service = this.ctx.get('schedule') as NativeScheduleService | null;
    if (!service || typeof service.create !== 'function') return null;
    // Native schedule mutations start future host timers. They must not carry
    // the creating tool's lease into a later Lead/Worker turn.
    return {
      create: (...args) => this.executions.detached(() => service.create(...args)),
      delete: request => this.executions.detached(() => service.delete(request)),
      history: request => this.executions.detached(() => service.history(request)),
      ...(service.update ? { update: (request: Parameters<NonNullable<NativeScheduleService['update']>>[0]) => this.executions.detached(() => service.update!(request)) } : {}),
      ...(service.catalog ? { catalog: () => this.executions.detached(() => service.catalog!()) } : {}),
    };
  }

  // ---- meeting prep & minutes (F10) -------------------------------------------

  /** Bind a prep package to a meeting: a once digest firing at start-lead (P26). */
  private async meetingPrepEnable(args: Record<string, unknown>): Promise<unknown> {
    const schedule = this.nativeSchedule();
    if (!schedule) throw new Error('当前 Host 未提供原生 Schedule 服务，无法安排会前准备。');
    const eventId = String(args.eventId ?? '');
    const event = await this.repos!.calendar.findEvent(eventId);
    if (!event || event.status === 'canceled') throw new Error('日程不存在或已取消；请先 calendar_query 同步并确认 event_id。');
    const leadMinutes = Number(args.leadMinutes ?? 15);
    if (!Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 24 * 60) throw new Error('提前量需为 1–1440 分钟。');
    const fireAt = new Date(new Date(event.start_time).getTime() - leadMinutes * 60_000);
    if (fireAt.getTime() <= Date.now()) throw new Error(`提前 ${leadMinutes} 分钟已错过（该时间在过去）；如需立即准备请直接让我现在生成。`);
    const scope = {
      memo: args.scopeMemo === false ? false : true,
      memory: args.scopeMemory === false ? false : true,
      tasks: args.scopeTasks === false ? false : true,
      minutes: args.scopeMinutes === false ? false : true,
    };
    const id = `prep-${hash(JSON.stringify({ eventId, start: event.start_time.toISOString(), leadMinutes, scope })).slice(0, 24)}`;
    const active = await this.repos!.digests.activeMeetingPreps(eventId);
    if (active.some(plan => plan.id !== id)) throw new Error(`该会议已有进行中的会前准备（${active[0]!.id}）；如需调整请先停止原计划。`);
    const spec = { at: fireAt.toISOString(), eventId, leadMinutes, eventStart: event.start_time.toISOString(), eventFingerprint: eventFingerprint(event), scope };
    await this.digest.plans.enable({
      id, kind: 'meeting_prep', title: `会前准备：${event.summary}`, session_id: this.accessSessionId!,
      schedule_spec: spec, last_window: null, voice: false, skill: 'meeting-prep',
    });
    return {
      planId: id,
      eventId,
      fireAt: fireAt.toISOString(),
      message: `会前准备已安排：开始前 ${leadMinutes} 分钟生成资料包（绑定该日程；日程取消/改期会自动停止，不会发送过时准备包）。`,
    };
  }

  /**
   * Assemble the prep package (P26): re-check the meeting first, then gather
   * authorized materials with sources; missing material is stated, not invented.
   */
  private async meetingPrepBuild(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const plan = await this.repos!.digests.getPlan(String(args.planId ?? ''));
    if (!plan || plan.kind !== 'meeting_prep') throw new Error('会前准备计划不存在。');
    if (plan.status !== 'active') return { planId: plan.id, skipped: 'plan_stopped', message: `该准备计划已${plan.status === 'stopped' ? '停止' : '暂停'}（会议可能已变化）；如需准备请按最新安排重设。` };
    const eventId = String(plan.schedule_spec?.eventId ?? '');
    let event = await this.repos!.calendar.findEvent(eventId);
    // A just-created meeting may have no prior list observation. Re-read the
    // owning calendar before building, without depending on today's preference.
    if (event && event.status !== 'canceled') {
      const observed = await this.syncCalendarWindow(event.calendar_id, event.start_time, event.end_time, event.channel);
      if (!observed.ok) return { planId: plan.id, skipped: 'source_unknown', message: `暂不发送准备包：日历复查失败（${observed.error ?? '未知原因'}）；请稍后重试。` };
      event = await this.repos!.calendar.findEvent(eventId);
    }
    const expected = plan.schedule_spec?.eventFingerprint ?? (event ? eventFingerprint(event) : null);
    const checkSource = async () => {
      const verdict = await this.sourceVerdict('calendar', eventId, expected);
      if (verdict.unknown) return { planId: plan.id, skipped: 'source_unknown', message: `暂不发送准备包：${verdict.reason}。` };
      // Legacy plans stored only the original start. Keep that condition in
      // addition to the shared freshness/fingerprint check.
      const current = await this.repos!.calendar.findEvent(eventId);
      const gone = !current || current.status === 'canceled';
      const moved = current && plan.schedule_spec?.eventStart && current.start_time.toISOString() !== plan.schedule_spec.eventStart;
      if (!verdict.valid || gone || moved) {
        const { warning: nativeWarning } = await this.digest.plans.stop(plan.id, 'stopped');
        return {
          planId: plan.id, skipped: gone ? 'meeting_gone' : 'meeting_moved', nativeWarning,
          message: `会议已取消或内容/时间已变化，旧准备包不发送；请按最新安排重设。${nativeWarning ? `原生任务待清理：${nativeWarning}` : ''}`
        };
      }
      return null;
    };
    const sourceProblem = await checkSource();
    if (sourceProblem) return sourceProblem;
    if (!event) throw new Error('会议来源无法读取。');
    const { created, row } = await this.repos!.digests.claimRun({ planId: plan.id, windowKey: eventId, workItemId: item.id });
    if (!created && (row.status === 'model_done' || row.status === 'sent') && row.outbox_key) {
      return { planId: plan.id, reused: true, message: '本会议的准备包已生成，不重复发送。' };
    }
    // Authorized materials only, each scoped by the plan's allowed sources.
    const scope = (plan.schedule_spec?.scope ?? {}) as { memo?: boolean; memory?: boolean; tasks?: boolean; minutes?: boolean };
    const keyword = event.summary.slice(0, 12);
    const materials: { topic: string; url: string | null; date: string }[] = [];
    if (scope.memo !== false) {
      const memos = await this.repos!.memos.search({ query: keyword, limit: 5 }).catch(() => []);
      const recent = await this.repos!.memos.search({ limit: 5 }).catch(() => []);
      const seen = new Set<string>();
      for (const memo of [...memos, ...recent]) {
        if (seen.has(memo.id)) continue;
        seen.add(memo.id);
        if (materials.length >= 6) break;
        materials.push({ topic: memo.topic, url: memo.doc_url, date: String(memo.occurred_on ?? '').slice(0, 10) });
      }
    }
    let lastMinutes: { topic: string; url: string | null; actions: string[] } | null = null;
    if (scope.minutes !== false) {
      const rows = await this.repos!.minutes.recent(3).catch(() => [] as Array<{ id: string; topic: string; doc_url: string | null; candidates: unknown }>);
      const match = rows.find(m => m.topic.includes(keyword.slice(0, 4))) ?? rows[0] ?? null;
      if (match) lastMinutes = { topic: match.topic, url: match.doc_url, actions: (Array.isArray(match.candidates) ? match.candidates : []).map((c: { summary: string }) => c.summary).slice(0, 5) };
    }
    let memoryFacts: string[] = [];
    if (scope.memory !== false) {
      try {
        const memory = await this.memory!.search({ query: keyword, limit: 5 });
        memoryFacts = memory.records.filter(r => r.status === 'confirmed').map(r => `${r.topic}：${r.content.slice(0, 60)}（来源：${r.source}）`);
      } catch {
        memoryFacts = [];
      }
    }
    // Only tasks sharing a token with the meeting count as related; otherwise
    // the section stays absent rather than pretending relevance.
    // CJK summaries rarely use separators: match on 2-character sliding
    // windows so 季度评审会第二轮 still relates to 季度评审材料打包.
    const rawTokens = event.summary.split(/[\s:：,，、/]+/).filter(t => t.length >= 2);
    const tokens = new Set<string>();
    for (const token of rawTokens) {
      if (token.length <= 3) tokens.add(token);
      for (let i = 0; i + 2 <= token.length; i++) tokens.add(token.slice(i, i + 2));
    }
    const openTasks = scope.tasks === false ? [] : (await this.repos!.tasks.list('open').catch(() => []))
      .filter(t => [...tokens].some(token => t.summary.includes(token)))
      .slice(0, 5)
      .map(t => t.summary);
    const lines: string[] = [];
    lines.push(`【会前准备】${event.summary}`);
    lines.push(`时间：${isoDate(event.start_time)} → ${isoDate(event.end_time)}（发送前已复查会议状态）`);
    lines.push('');
    if (materials.length || memoryFacts.length || openTasks.length || lastMinutes) {
      lines.push('一、资料（授权范围内，带出处）');
      for (const m of materials) lines.push(`· 备忘「${m.topic}」${m.date ? `（${m.date}）` : ''}${m.url ? ` ${m.url}` : ''}`);
      for (const fact of memoryFacts) lines.push(`· 记忆：${fact}`);
      if (lastMinutes) {
        lines.push(`· 上次纪要「${lastMinutes.topic}」${lastMinutes.url ? ` ${lastMinutes.url}` : ''}${lastMinutes.actions.length ? `；候选行动：${lastMinutes.actions.join('、')}` : ''}`);
      }
      if (openTasks.length) lines.push(`· 相关未完成任务：${openTasks.join('、')}`);
    } else {
      lines.push('一、资料：没有找到与该会议相关的备忘、记忆、纪要或任务——请直接补充材料，本包不编造议程。');
    }
    lines.push('');
    lines.push('二、建议议程与问题清单（建议，供你确认）');
    lines.push('· 建议先确认上次行动项进展（如有）');
    lines.push(materials.length ? '· 针对上述资料列出待确认问题后带出处提问' : '· 没有材料，建议先明确本次会议要决定的 1–3 件事');
    lines.push('');
    lines.push(`来源：会议投影（${event.event_id}）、24私助备忘/记忆/任务；本包生成不代表任何行动已执行。WorkItem：${item.id}`);
    const report = lines.join('\n');
    const changedDuringBuild = await checkSource();
    if (changedDuringBuild) return changedDuringBuild;
    const outboxKey = await this.digest.deliverPrepared(plan, row, report);
    await this.repos!.workItems.update(item.id, { result_ref: { planId: plan.id, eventId, outboxKey } });
    return { planId: plan.id, eventId, message: '会前准备包已生成并入发送队列（发送前复查过会议状态）。' };
  }

  /**
   * Post-meeting minutes (P27): the owner's material becomes a Feishu document
   * plus separately stored candidate actions; generating minutes never
   * executes anything.
   */
  private async minutesBuild(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const topic = text(args.topic, 200);
    const content = text(args.content, 60000);
    const eventId = args.eventId ? String(args.eventId) : null;
    const candidates = (Array.isArray(args.candidates) ? args.candidates : []).slice(0, 30).map((entry: Record<string, unknown>, index: number) => ({
      index,
      summary: text(entry.summary, 300),
      sourceQuote: entry.sourceQuote ? text(entry.sourceQuote, 300) : '（出处未标注）',
      owner: entry.owner ? text(entry.owner, 100) : null,
      due: entry.due ? String(entry.due) : null,
      start: entry.start ? String(entry.start) : null,
      end: entry.end ? String(entry.end) : null,
      unknown: entry.unknown ? text(entry.unknown, 200) : null,
    }));
    const id = `min-${randomUUID().slice(0, 12)}`;
    // Save the minutes document through the memo pipeline (create + readback).
    const saved = (await this.saveMemo(item, { topic: `会议纪要：${topic}`, content, source: `会后纪要（事项 ${item.id}${eventId ? `，会议 ${eventId}` : ''}）` })) as { operationId: string; docUrl?: string | null };
    const memoRow = (await this.repos!.memos.get(saved.operationId)) ?? null;
    const minutes = await this.repos!.minutes.insert({
      id,
      work_item_id: item.id,
      event_id: eventId,
      topic,
      memo_id: memoRow?.id ?? null,
      doc_url: memoRow?.doc_url ?? saved.docUrl ?? null,
      candidates,
      status: 'draft',
    });
    return {
      minutesId: minutes.id,
      docUrl: minutes.doc_url,
      candidates: minutes.candidates,
      message: `纪要已保存为飞书文档并回读确认；候选行动 ${candidates.length} 项仅列出（带出处），未执行任何行动。需要执行时用 minutes_adopt_actions 选择编号。`,
    };
  }

  /**
   * Execute only the selected, sufficiently-specified candidates (P27; the
   * selection/execution contract the handwriting chain reuses). Idempotent per
   * candidate: repeats return the existing object, unknown outcomes refuse a
   * blind retry.
   */
  private async minutesAdoptActions(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const minutes = await this.repos!.minutes.get(String(args.minutesId ?? ''));
    if (!minutes) throw new Error('纪要不存在；请先用 minutes_build 生成。');
    if (!String(args.instruction ?? '').trim()) throw new Error('执行候选行动需要本人明确的指令依据（instruction）。');
    const wanted = Array.isArray(args.indexes) ? (args.indexes as number[]).map(Number) : [];
    if (wanted.length === 0) throw new Error('需要提供选择的候选编号（indexes[]）。');
    const results = [];
    for (const index of wanted) {
      const candidate = (minutes.candidates ?? []).find((c: { index: number }) => c.index === index);
      if (!candidate) {
        results.push({ index, ok: false, error: `候选 ${index} 不存在。` });
        continue;
      }
      if (candidate.unknown) {
        results.push({ index, ok: false, error: `候选 ${index} 含未知项（${candidate.unknown}），信息不足不执行；请先补齐。` });
        continue;
      }
      try {
        if (candidate.start && candidate.end) {
          // Minutes-scoped idempotency for calendar candidates too: repeated
          // selections from any session return the existing event (P27).
          const operationId = `minutes.action:${minutes.id}:${index}`;
          const previous = await this.repos!.operations.get(operationId);
          if (previous?.status === 'succeeded') {
            const receipt = previous.receipt as { eventId?: string; url?: string | null } | null;
            results.push({ index, ok: true, kind: 'calendar', reused: true, eventId: receipt?.eventId ?? null, url: receipt?.url ?? null, message: '该候选此前已执行，返回已有日程。' });
            continue;
          }
          const created = (await this.calendarWrite(item, 'create', { summary: candidate.summary, start: candidate.start, end: candidate.end, _authorization: { minutesId: minutes.id, index } }, operationId)) as { eventId?: string; url?: string | null; operationId?: string };
          await this.repos!.operations.update(operationId, { status: 'succeeded', receipt: { eventId: created.eventId, url: created.url, minutesId: minutes.id, index } });
          results.push({ index, ok: true, kind: 'calendar', ...(created as object), minutesId: minutes.id });
        } else {
          // Minutes-scoped idempotency: the stable key is (minutes, index), not
          // the delegating work item, so a repeated selection from any session
          // returns the same task instead of creating a second one (P27).
          const created = await this.taskCreate(item, {
            summary: candidate.summary,
            due: candidate.due ?? undefined,
            _operationId: `minutes.action:${minutes.id}:${index}`,
          });
          results.push({ index, ok: true, kind: 'task', ...(created as object) });
        }
      } catch (error) {
        results.push({ index, ok: false, error: (error as Error).message });
      }
    }
    const failed = results.filter(r => !r.ok).length;
    if (failed === 0) await this.repos!.minutes.update(minutes.id, { status: 'actions_taken' });
    return {
      minutesId: minutes.id,
      executed: results.length - failed,
      failed,
      results,
      message: failed === 0
        ? `已按你的选择执行 ${results.length} 项（幂等：重复选择同一编号返回已有对象）。`
        : `执行 ${results.length - failed} 项，${failed} 项未执行（见明细：信息不足/失败逐项列出）；纪要生成不等于行动已执行。`,
    };
  }

  // ---- reviewed-note actions & trusted retrieval (F11) ------------------------

  /**
   * Execute selected candidate actions from an approved note version (P34).
   * Content approval and action authorization stay separate records; the
   * version must be approved AND still match the live document.
   */
  private async noteAdoptActions(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const noteId = String(args.noteId ?? '');
    const note = await this.repos!.notes.getNote(noteId);
    if (!note) throw new Error('笔记不存在。');
    const versionId = String(args.versionId ?? '');
    const trust = await this.handwriting.inspectTrust(noteId, versionId);
    const version = trust.version;
    const instruction = String(args.instruction ?? '').trim();
    if (!instruction) throw new Error('执行笔记行动需要本人明确的指令依据（instruction）；审核通过不等于行动授权。');
    if (version.status !== 'approved') {
      throw new Error(`只有本人已审核通过的版本才能执行行动（当前 ${version.status}）；请先在飞书审核卡批准具体版本。`);
    }
    // Re-verify the live document still matches the approved fingerprint:
    // edited or unverifiable content never silently becomes execution params.
    if (trust.currentValidity === 'unknown') throw new Error(`无法核验文档当前内容（${trust.reason}）；暂不执行，请稍后再试。`);
    if (trust.currentValidity !== 'matches') {
      throw new Error('文档内容与已审核版本不一致（已修改）；旧批准不覆盖新内容，请先重新发布候选并审核。');
    }
    const candidates = (Array.isArray(version.content?.candidates) ? version.content.candidates : []) as NoteCandidate[];
    const wanted = Array.isArray(args.indexes) ? (args.indexes as number[]).map(Number) : [];
    if (wanted.length === 0) throw new Error('需要提供选择的候选编号（indexes[]）。');
    const results = [];
    for (const index of wanted) {
      const candidate = candidates[index];
      if (!candidate?.summary) {
        results.push({ index, ok: false, error: `候选 ${index} 不存在或无摘要。` });
        continue;
      }
      // Action identity = (note, version, index): repeats from any session
      // return the existing object (P27 contract reused for notes). The
      // owner's instruction is persisted with the operation so authorization
      // and content approval stay separate records (P34).
      const operationId = `note.action:${noteId}:v${version.version}:${index}`;
      try {
        if (candidate.start && candidate.end) {
          const previous = await this.repos!.operations.get(operationId);
          if (previous?.status === 'succeeded') {
            const receipt = previous.receipt as { eventId?: string; url?: string | null } | null;
            results.push({ index, ok: true, kind: 'calendar', reused: true, eventId: receipt?.eventId ?? null, url: receipt?.url ?? null });
            continue;
          }
          const created = (await this.calendarWrite(item, 'create', { summary: candidate.summary, start: candidate.start, end: candidate.end, _authorization: { noteId, versionId, index, instruction } }, operationId)) as { eventId?: string; url?: string | null };
          await this.repos!.operations.update(operationId, { status: 'succeeded', receipt: { eventId: created.eventId, url: created.url, noteId, versionId, index, instruction } });
          results.push({ index, ok: true, kind: 'calendar', sourceQuote: candidate.sourceQuote ?? null, ...(created as object) });
        } else {
          const created = await this.taskCreate(item, {
            summary: candidate.summary,
            due: candidate.due ?? undefined,
            _operationId: operationId,
            _instruction: instruction,
          });
          results.push({ index, ok: true, kind: 'task', sourceQuote: candidate.sourceQuote ?? null, dueRaw: candidate.due ?? null, ...(created as object) });
        }
      } catch (error) {
        results.push({ index, ok: false, error: (error as Error).message });
      }
    }
    const failed = results.filter(r => !r.ok).length;
    return {
      noteId,
      versionId,
      executed: results.length - failed,
      failed,
      results,
      message: failed === 0
        ? `已按你的选择执行 ${results.length} 项（依据已审核的 ${noteId} v${version.version}；重复选择返回已有对象）。`
        : `执行 ${results.length - failed} 项，${failed} 项未执行（见明细）；审核通过不等于全部行动已执行。`,
    };
  }

  /**
   * Trusted note retrieval (P35): every reference is re-verified against the
   * live document before it may count as a confirmed fact; changed/unknown/
   * unreviewed states are labeled, never inherited by repetition.
   */
  private async notesSearch(args: Record<string, unknown>): Promise<unknown> {
    const query = args.query ? text(args.query, 200) : '';
    const versions = await this.repos!.notes.versionsWithDecisions(30).catch(() => [] as Array<Record<string, any>>);
    const items = [];
    for (const row of versions) {
      const content = row.content ?? {};
      const transcript = String(content.transcript ?? '');
      const summary = String(content.summary ?? '');
      if (query && !(`${transcript}${summary}${row.note_id}`.includes(query))) continue;
      let validity: 'matches' | 'changed' | 'unknown' | 'unreviewed' = 'unreviewed';
      let unknownReason: string | null = null;
      try {
        const trust = await this.handwriting.inspectTrust(row.note_id, row.id);
        validity = trust.currentValidity;
        if (validity === 'unknown') unknownReason = trust.reason;
      } catch (error) {
        validity = 'unknown';
        unknownReason = (error as Error).message;
      }
      items.push({
        noteId: row.note_id,
        version: row.version,
        versionId: row.id,
        reviewStatus: row.status,
        reviewedBy: row.reviewer_open_id ?? null,
        reviewedAt: row.decision_at ?? null,
        // matches = 可作为已确认事实引用；其他状态明确不得当作最新事实
        currentValidity: validity,
        ...(unknownReason ? { unknownReason } : {}),
        summary,
        docUrl: row.doc_url,
        candidates: Array.isArray(content.candidates) ? content.candidates : [],
      });
      if (items.length >= 10) break;
    }
    // Tool outputs must be lossless JSON: strip any Date/undefined leakage
    // from raw SQL rows before handing the result to the model.
    const clean = JSON.parse(JSON.stringify({ count: items.length, items }));
    return {
      ...clean,
      message: '引用已按当前文档核验：仅 currentValidity=matches 的已审版本可作为已确认事实；已变更/无法核验/未审核一律明示，不因曾通过而继承。',
    };
  }

  // ---- maintenance: archive, backup, health (F12) -----------------------------

  /**
   * Pre-archive inventory (P37): running work, native schedules on the access
   * session, and PG reminder rules (external Feishu-side reminders) are listed
   * separately — native plans and external reminders never mix.
   */
  async maintenanceArchiveCheck(): Promise<unknown> {
    return this.executions.run(async () => {
      if (!this.repos) throw new Error('业务账本未就绪。');
      const running = await this.repos.workItems.list(UNSETTLED_WORK_STATUSES, 10000);
      // Native schedules are inventoried from our durable plan rows (every
      // schedule the plugin creates is mirrored there with its schedule_id);
      // dsh's own archive gate remains the authoritative blocker.
      const digestPlans = (await this.repos.digests.listPlans()).filter(plan => plan.status === 'active' || plan.schedule_id || plan.lifecycle).map(plan => ({ id: plan.id, kind: plan.kind, status: plan.status, native: plan.schedule_id != null || plan.lifecycle != null }));
      // F45：delegated 行（日程化备份）也列出——归档处置需要看到它们，带渠道标记。
      const reminderRules = (await this.repos.reminders.listRules())
        .filter(rule => rule.status === 'active' || rule.status === 'delegated')
        .map(rule => ({ id: rule.id, kind: rule.kind, text: rule.text, status: rule.status, nextDueAt: rule.next_due_at ? new Date(rule.next_due_at).toISOString() : null }));
      const reviewReminders = (await this.repos.reviewReminders.activeAll(50)).map(r => ({ id: r.id, noteId: r.note_id, kind: r.kind, remindAt: new Date(r.remind_at).toISOString() }));
      const outboxPending = (await this.repos.outbox.recent(200)).filter(o => ['pending', 'sending', 'unknown'].includes(o.status)).length;
      const blocking = running.length > 0 || digestPlans.some(p => p.native) || outboxPending > 0;
      return {
        runningWork: running.map(w => ({ id: w.id, title: w.title, role: w.role, status: w.status })),
        nativeSchedules: digestPlans.filter(p => p.native),
        externalPgReminders: { reminderRules, reviewReminders },
        outboxPending,
        blocking,
        message: blocking
          ? '存在运行中事项/原生计划/未确认发送：归档会被原生闸阻止。明确停止请用 archive_execute {confirmStop:true, stopRules:...}；PG 提醒规则默认保留，需明确选择才停止。'
          : '没有运行中事项或未确认发送；原生计划与外部提醒清单如下（空闲但有计划也需明确处置后再归档）。',
      };
    });
  }

  /**
   * Explicit stop-and-prepare for archive (P37): stops workers, disposes native
   * schedules with per-item readback, optionally stops PG reminder rules, and
   * reports partial failures honestly. Without confirmStop nothing happens.
   */
  async maintenanceArchiveExecute(args: Record<string, unknown>): Promise<unknown> {
    return this.executions.run(async () => {
      if (!this.repos) throw new Error('业务账本未就绪。');
      if (args.confirmStop !== true) {
        return { changed: false, message: '未执行任何变更：归档前的停止需要明确确认（confirmStop:true）。用户取消不产生副作用。' };
      }
      const stopRules = args.stopRules === true;
      const failures: string[] = [];
      // 1. Stop running work (user-stopped items never resurrect).
      const running = await this.repos.workItems.list(UNSETTLED_WORK_STATUSES, 10000);
      await this.workLifecycle.stopMany(running.map(item => item.id));
      for (const item of running) {
        await this.inboxLifecycle.cancelTarget(item.child_session_id ?? item.id, '归档前按本人指令停止，补充输入不再续办。');
      }
      // 2. Dispose native schedules with readback. Without the schedule service
      // the mirror must NOT claim disposal — that would be a silent divergence.
      const plans = await this.repos.digests.listPlans();
      let nativeDisposed = 0;
      for (const plan of plans) {
        if (!plan.schedule_id && !plan.lifecycle && plan.status !== 'active') continue;
        const result = await this.digest.plans.stop(plan.id, 'paused');
        if (result.warning) failures.push(`原生计划 ${plan.id} 清理未完成：${result.warning}`);
        else if (plan.schedule_id) nativeDisposed += 1;
      }
      // 3. External PG reminders (both kinds) only when explicitly chosen;
      // only successful stops are counted.
      let rulesStopped = 0;
      if (stopRules) {
        for (const rule of await this.repos.reminders.listRules('active')) {
          try {
            await this.repos.reminders.updateRule(rule.id, { status: 'stopped' });
            rulesStopped += 1;
          } catch (error) {
            failures.push(`提醒 ${rule.id} 停止失败：${(error as Error).message}`);
          }
        }
        for (const reminder of await this.repos.reviewReminders.activeAll(50)) {
          try {
            await this.repos.reviewReminders.update(reminder.id, { status: 'canceled' });
            rulesStopped += 1;
          } catch (error) {
            failures.push(`审核催办 ${reminder.id} 停止失败：${(error as Error).message}`);
          }
        }
      }
      // Readback.
      const after = await this.maintenanceArchiveCheck() as { runningWork: unknown[]; nativeSchedules: unknown[]; outboxPending: number };
      return {
        stoppedWork: running.length,
        nativeDisposed,
        rulesStopped,
        failures,
        remaining: { running: after.runningWork.length, native: after.nativeSchedules.length, outboxPending: after.outboxPending },
        message: failures.length
          ? `已执行停止，但 ${failures.length} 项失败（见明细）；未完全清理前不建议归档。`
          : `已停止 ${running.length} 个运行中事项、处置 ${nativeDisposed} 个原生计划${stopRules ? `、停止 ${rulesStopped} 条外部提醒` : '（外部提醒按你的选择保留）'}；恢复后不会自动重建已删计划。`,
      };
    });
  }

  async maintenanceBackupCreate(args: Record<string, unknown>): Promise<unknown> {
    return this.executions.run(async () => {
      if (!this.repos || !this.workspace || !this.config) throw new Error('尚未绑定工作区。');
      return new WorkspaceBackup({
        workspace: this.workspace.statePath, stateDirectory: this.options.stateDirectory,
        sessions: this.options.backupSessionsRoot, storages: this.options.backupStoragesRoot,
        attachments: this.options.backupAttachmentsRoot
      }, this.dbRef).create(String(args.targetDir ?? ''), {
        credentialReferences: [this.config.pgDsnEnv, this.config.appIdEnv, this.config.appSecretEnv, this.config.tts.volcKeyEnv],
        watermarks: await this.repos.maintenance.watermarks(),
      });
    });
  }

  async maintenanceBackupVerify(args: Record<string, unknown>): Promise<unknown> {
    return this.executions.run(async () => {
      return WorkspaceBackup.verify(String(args.backupDir ?? ''));
    });
  }

  /**
   * F24: the handwriting vision route is a config the "route exists" check
   * alone used to bless — a text-only model id must warn loudly instead.
   * Shared by the health report and pa24_connection read so every surface
   * carries the same verdict.
   */
  visionRouteStatus(): { id: string; state: 'ok' | 'warn'; message: string } {
    const route = this.config?.workerModels.handwriting;
    if (!route) {
      return { id: 'vision-route', state: 'warn', message: '未配置 workerModels.handwriting：手写识别不可用（其余能力不受影响，固定提醒继续）' };
    }
    if (!looksLikeVisionModel(route.model)) {
      return { id: 'vision-route', state: 'warn', message: `手写视觉路由 ${route.provider}/${route.model} 疑似非视觉（纯文本）模型——手写识别质量将不可用；请在 AGENTS.md workerModels.handwriting 配置视觉模型（如 GLM-4.5V、Qwen-VL 系列）` };
    }
    return { id: 'vision-route', state: 'ok', message: `手写视觉路由 ${route.provider}/${route.model}` };
  }

  /**
   * Capability health and budget report (P39): readiness plus per-capability
   * state, sync freshness, usage counters, and data-flow disclosure. Secrets
   * never appear; a down dependency is an error, never a silent zero.
   */
  async maintenanceHealth(): Promise<unknown> {
    return this.executions.run(async () => {
      const ready = this.readiness();
      const capabilities: { id: string; state: 'ok' | 'warn' | 'error' | 'info'; message: string; detail?: unknown }[] = [];
      const config = this.config;
      capabilities.push(this.visionRouteStatus());
      // CLI presence + authorization verdict from the last access inspection
      // (on-demand only; no platform calls happen for this report).
      capabilities.push({ id: 'lark-cli', state: this.diagnostics ? (this.diagnostics.auth?.state === 'ok' ? 'ok' : this.diagnostics.auth?.state === 'error' ? 'error' : 'warn') : 'info', message: this.diagnostics ? `最近检查：${this.diagnostics.auth?.message ?? '未见授权结论'}${this.diagnostics.auth?.state === 'unverified' || this.diagnostics.auth?.state === 'error' ? '；授权失效请在服务器重新执行 lark-cli 授权后再检查' : ''}` : '尚未执行接入检查（用 pa24_connection check 发起只读检查）' });
      // F38: calendar-sync 三态——「从未同步」（无状态行，首运行前的正常状态）
      // 是 info，「读取失败」（查询异常）才是 error；两者此前坍缩成同一句
      // 假红「不可读取」（8010/3080 常年误报）。catch 记 message 不吞。
      const calendarChannel = config?.calendarChannel ?? 'feishu';
      let calendarState: CalendarSyncRow | null = null;
      let calendarError = '';
      if (this.repos) {
        try {
          calendarState = await this.repos.calendar.getSync(calendarChannel === 'wecom' ? WECOM_CALENDAR_ID : this.config!.calendarId);
        } catch (error) {
          calendarError = (error as Error).message;
        }
      }
      capabilities.push({
        id: 'calendar-sync',
        state: calendarError ? 'error' : calendarState ? (calendarState.complete ? 'ok' : 'warn') : 'info',
        message: calendarError
          ? `日历同步状态读取失败：${calendarError}`
          : calendarState
            ? (calendarState.complete ? `日历投影同步于 ${isoDate(calendarState.last_synced_at)}（渠道 ${calendarChannel}）` : `上次日历同步失败：${calendarState.last_error ?? '窗口未完成'}`)
            : `尚未执行日历投影同步（渠道 ${calendarChannel}）——日程域首次运行后建立`,
      });
      // F16: wecom channel health mirrors the lark-cli pattern — verdict comes
      // from the last on-demand wecom_check; no platform calls happen here.
      if (config && (config.calendarChannel === 'wecom' || config.todoChannel === 'wecom' || config.notifyChannel === 'wecom')) {
        capabilities.push({
          id: 'wecom-cli',
          state: this.wecomChannels.diagnostics ? (this.wecomChannels.diagnostics.cli.state === 'ok' && this.wecomChannels.diagnostics.identity.state === 'ok' ? 'ok' : 'warn') : 'info',
          message: this.wecomChannels.diagnostics
            ? `最近检查：${this.wecomChannels.diagnostics.cli.state === 'ok' ? 'CLI 可用' : this.wecomChannels.diagnostics.cli.message}；${this.wecomChannels.diagnostics.identity.message}`
            : '企微渠道已启用但尚未执行接入检查（用 pa24_connection action=wecom_check 发起只读检查）',
        });
      }
      // F19: voice engine readiness mirrors the lark-cli pattern — verdict from
      // the last on-demand tts.probe; no subprocess spawns during health.
      if (config && config.tts.engine !== 'none') {
        capabilities.push({
          id: 'tts',
          state: this.ttsProbeCache ? (this.ttsProbeCache.result.ready ? 'ok' : 'warn') : 'info',
          message: this.ttsProbeCache
            ? `语音引擎 ${config.tts.engine}${this.ttsProbeCache.result.ready ? ' 就绪' : `：${this.ttsProbeCache.result.problems.join('；')}`}`
            : `语音引擎 ${config.tts.engine} 已配置（面板「晨报与复盘」里发起只读预检）`,
        });
      }
      // F18: extraLocalTools resolution — configured names that never mounted
      // (missing provider bundle or profile mcp-client entry) surface here
      // instead of failing agent creation.
      if (config && config.extraLocalTools.length > 0) {
        capabilities.push({
          id: 'extra-local-tools',
          state: this.extraToolResolution ? (this.extraToolResolution.filtered.length ? 'warn' : 'ok') : 'info',
          message: this.extraToolResolution
            ? `最近本地会话解析：放行 ${this.extraToolResolution.active.length} 项${this.extraToolResolution.filtered.length ? `；未挂载被过滤：${this.extraToolResolution.filtered.join('、')}` : ''}`
            : '已配置 extraLocalTools 但本地24私助会话尚未创建',
        });
      }
      // F18 WP3: qwennote channel three-state diagnosis (presence inference —
      // mcp-client exposes no status service; no tool is called to diagnose).
      if (config && config.extraLocalTools.some(e => e === QWENNOTE_TOOL_WILDCARD || e.startsWith(QWENNOTE_TOOL_PREFIX))) {
        // F18 fix: the mount signal must come from the agent-resolution snapshot
        // (this.ctx's tool view cannot see the mcp-client layer — different
        // scope; verified on a live reproduction). No snapshot yet = unverified.
        const snapshot = this.extraToolResolution;
        const mounted = (snapshot?.active ?? []).some(n => n.startsWith(QWENNOTE_TOOL_PREFIX));
        if (!snapshot) {
          capabilities.push({ id: 'qwennote-channel', state: 'info', message: '听记通道未验证：本地24私助会话尚未创建（工具挂载以会话解析为准）。' });
        } else {
          const channel = qwennoteChannelState({
            configured: true,
            mounted,
            tokenCache: await this.qwennoteTokenCache(),
          });
          const nextSteps = mounted ? channel.nextSteps : [...channel.nextSteps, '宿主重启后 mcp 工具注册约需半分钟——听记通道显示正常后再打开本地会话，该会话才会带上听记工具。'];
          capabilities.push({ id: 'qwennote-channel', state: channel.state, message: channel.message, detail: { nextSteps } });
        }
      }
      const outboxRows = this.repos ? await this.repos.outbox.recent(200) : [];
      const pending = outboxRows.filter(o => ['pending', 'sending'].includes(o.status));
      const unknownOps = await this.repos!.maintenance.unknownOperationCount().catch(() => null);
      const latencies = outboxRows.filter(o => o.status === 'sent' && o.sent_at).map(o => new Date(o.sent_at!).getTime() - new Date(o.created_at).getTime()).sort((a, b) => a - b);
      const retryTotals = await this.repos!.maintenance.attemptTotals().catch(() => null);
      const retries = retryTotals ? retryTotals.operations + retryTotals.outbox : null;
      const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : null);
      return {
        readiness: ready,
        capabilities,
        usage: {
          since: this.startedAt,
          modelTurns: this.usage.modelRequests,
          notePagesInput: this.usage.notePagesInput,
          noteCrops: this.usage.noteCrops,
          outboxQueued: pending.length,
          outboxUnknown: outboxRows.filter(o => o.status === 'unknown').length,
          operationsUnknown: unknownOps,
          outboxLatencyMs: { p50: pct(0.5), p95: pct(0.95) },
          ledgerRetries: retries,
          quota: '未配置模型限额（当前版本无 quota 配置项；如需硬限额请在模型路由侧设置）',
          note: '计数自本 Host 启动累计（进程内观测，重启清零）；ledgerRetries 来自账本（外部操作重试＋Outbox 重发）；费用口径取决于模型计费，本页只提供可测投入量。',
        },
        dataFlow: {
          modelInput: '笔记原稿图片与转写文本会作为模型输入发送到所配置的 dsh 模型路由；账本与面板不外发。',
          extraLogs: 'dsh 原生会话日志保存于 $DSH_HOME/sessions；24PA 不额外上传。Host 级日志开关影响同 Host 全部会话。',
          retention: 'PG 账本与工作区文件长期保留；备份按部署者执行的维护动作清理。',
          secrets: '诊断与备份仅含凭据引用名（环境变量名），凭据值不进入任何输出。',
        },
        degraded: {
          modelDown: '模型不可用只暂停需要模型的工作；固定提醒经 PG+Outbox 继续发送。',
          pgDown: 'PG 不可用时停止接纳/写入相关业务并保留可恢复状态（启动与账本闸已实现）。',
          offlineAlert: '完全离线告警依赖独立服务器监控（声明边界）。',
        },
      };
    });
  }

  /** F19（spec 2.3）：语音引擎只读预检（面板按需触发；结果缓存供健康面与快照展示）。 */
  async ttsProbe(): Promise<unknown> {
    return this.executions.run(async () => {
      if (!this.config) throw new Error('尚未绑定工作区。');
      const result = await probeTts(this.config.tts, this.secretEnv());
      this.ttsProbeCache = { at: nowIso(), result };
      return { ...result, voice: this.config.tts.voice, voices: VOLC_TTS_VOICES };
    });
  }

  /** F19（spec 2.3）：入队一条测试语音，经真实引擎合成后送达主人飞书。 */
  async ttsTestSend(): Promise<unknown> {
    return this.executions.run(async () => {
      if (!this.config || !this.repos) throw new Error('尚未绑定工作区。');
      if (this.config.tts.engine === 'none') throw new Error('未配置 TTS 引擎：请先在「接入与设置 → 参数配置 → 语音 TTS」选择引擎。');
      if (this.config.notifyChannel === 'wecom') throw new Error('通知通道为企微，暂不支持语音（wecom 语音 parity 后置）。');
      if (!this.config.ownerOpenId) throw new Error('尚未绑定主人飞书身份（ownerOpenId）。');
      // 「二十四私助」为口播形态：TTS 朗读数字串不如汉字自然（研究第六节实测口径）。
      const text = '主人你好，这是二十四私助的语音测试。听到这条消息，说明语音投递链路已经打通。';
      const dedupKey = `tts-test:${randomUUID().slice(0, 8)}`;
      await this.repos.outbox.enqueue({
        dedupKey,
        channel: 'feishu',
        target: this.config.ownerOpenId,
        kind: 'audio',
        content: { text },
      });
      return { queued: true, dedupKey, message: '测试语音已入发送队列，稍后送达主人飞书。' };
    });
  }

  async notesTool(args: Record<string, unknown>, agent: DshAgent): Promise<unknown> {
    return this.executions.run(async () => {
      return this.handwriting.notesTool(args, agent);
    });
  }

  /** Assert the Feishu transport is live; every note write path needs it. */
  private assertFeishuLive(context: string): void {
    if (this.config?.mode !== 'feishu' || !this.transport) throw new Error(`${context}：需要 feishu 模式与已启动的飞书连接。`);
  }

  private noteVerifyTick(): void {
    if (this.noteVerifying || this.closed) return;
    this.noteVerifying = true;
    void this.pollPendingNotes()
      .catch(() => { })
      .finally(() => {
        this.noteVerifying = false;
      });
  }

  /** Verify up to 5 pending-review versions now; returns how many were checked. */
  async pollPendingNotes(): Promise<number> {
    return this.executions.run(async () => {
      if (!this.repos || !this.config || this.config.mode !== 'feishu' || !this.transport) return 0;
      const versions = await this.repos.notes.pendingReviewVersions(5);
      await Promise.all(versions.map(version => this.handwriting.verifyNote(version.note_id).catch(() => { })));
      return versions.length;
    });
  }

  private reviewReminderTick(): void {
    if (this.reviewReminding || this.closed) return;
    this.reviewReminding = true;
    void this.dispatchReviewReminders()
      .catch(() => { })
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
    return this.executions.run(async () => {
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
        // F44（spec 2.11）：待审提醒文案＝handwriting-review-flow 的 params
        // （工作区同名 skill 覆盖可调口径；缺省与既有默认逐字一致）。
        const flowParams = await this.skillCatalog.params('handwriting-review-flow');
        const template = typeof flowParams.pendingRemindTemplate === 'string' && flowParams.pendingRemindTemplate.includes('{noteId}')
          ? flowParams.pendingRemindTemplate
          : DEFAULT_PENDING_REMIND_TEMPLATE.pendingRemindTemplate;
        await this.notifyOwner(
          `noteremind:${reminder.id}:${reminder.sent_count + 1}`,
          template
            .replaceAll('{noteId}', reminder.note_id)
            .replaceAll('{version}', String(version.version))
            .replaceAll('{docPart}', version.doc_url ? `（${version.doc_url}）` : ''),
        );
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
    });
  }

  /** Maintenance surface (P37/P38/P39) — local 24私助 session only for mutations. */
  async maintenanceTool(args: Record<string, unknown>, agent: DshAgent): Promise<unknown> {
    return this.executions.run(async () => {
      const role = this.roleFor(agent);
      const action = String(args.action ?? '');
      if (['archive_check', 'health'].includes(action)) {
        if (action === 'archive_check') return this.maintenanceArchiveCheck();
        return this.maintenanceHealth();
      }
      if (role !== 'local-robot') throw new Error('归档执行、备份与恢复操作只在 dsh 的24私助本地会话进行。');
      if (action === 'archive_execute') return this.maintenanceArchiveExecute(args);
      if (action === 'backup_create') return this.maintenanceBackupCreate(args);
      if (action === 'backup_verify') return this.maintenanceBackupVerify(args);
      throw new Error('未知维护操作。');
    });
  }

  /** Review queue and read-only decision history for the Lead tool and the panel (P33). */
  async reviewQueue(): Promise<unknown> {
    return this.executions.run(async () => {
      if (!this.repos) throw new Error('业务账本未就绪。');
      const queue = await this.repos.notes.reviewQueue();
      const reminders = await this.repos.reviewReminders.activeAll();
      const history = await this.repos.notes.versionsWithDecisions(30);
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
        history: history.map(row => ({
          noteId: row.note_id,
          title: row.title ?? row.note_id,
          version: row.version,
          status: row.status,
          decision: row.decision ?? null,
          summary: String(row.content?.summary ?? ''),
          docUrl: row.doc_url ?? null,
          fingerprint: String(row.fingerprint ?? '').slice(0, 12) + '…',
          decidedAt: isoDate(row.decision_at ?? row.decided_at),
          verifiedAt: isoDate(row.verified_at),
          verifyResult: row.verify_result ?? null,
          createdAt: isoDate(row.created_at),
        })),
      };
    });
  }

  // ---- outbox worker --------------------------------------------------------

  private kickOutbox(): void {
    if (this.outboxSending || this.closed) return;
    this.outboxSending = true;
    void this.executions.detached(() => this.sendOutbox()).catch(() => { }).finally(() => {
      this.outboxSending = false;
    });
  }

  /** The delivery module owns durable receipts, retries and reply routing. */
  async sendOutbox(): Promise<void> {
    return this.executions.run(async () => {
      if (this.repos) await this.outboxDelivery.drain();
    });
  }

  // ---- diagnostics & readiness ---------------------------------------------

  async checkAccess(): Promise<AccessDiagnostics> {
    return this.executions.run(async () => {
      if (this.checking) return this.checking;
      if (!this.workspace || !this.config) throw new Error('尚未绑定工作区。');
      const workspace = this.workspace;
      const config = this.config;
      const bin = this.options.larkCliBin;
      // F36: 报错脱敏覆盖密钥库来源的真实值（env 值 safeError 自行读）。
      const extraSecrets = [this.secretValue('feishuAppId'), this.secretValue('feishuAppSecret')].filter(Boolean);
      const run = (this.checking = inspectAccess(config, bin, { path: workspace.statePath, sourceHash: this.sourceHash }, extraSecrets)
        .then(result => {
          if (this.workspace === workspace) this.diagnostics = result;
          return result;
        })
        .finally(() => {
          this.checking = null;
        }));
      return run;
    });
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
          : `24私助 Host 运行中（Node ${process.version}，dsh ${versions.dsh}，24私助插件 ${versions.plugin}，飞书 SDK ${versions.sdk}）`,
    });
    items.push({
      id: 'config',
      state: config ? 'ok' : 'error',
      message: config
        ? `配置有效：模式=${config.mode === 'feishu' ? '飞书' : '体验'}，profile=${config.larkProfile}，加载于 ${this.loadedAt ? new Date(this.loadedAt).toLocaleString('zh-CN', { timeZone: config.timeZone, hour12: false }) : '未知'}`
        : (this.configError ?? '尚未加载配置'),
      detail: config ? { source: join(this.workspace?.statePath ?? '', 'AGENTS.md'), hash: this.sourceHash.slice(0, 16) } : undefined,
    });
    items.push({
      id: 'postgres',
      state: this.db ? 'ok' : 'error',
      message: this.db
        ? this.db.kind === 'sqlite'
          ? `SQLite 业务账本已连接（${basename(this.db.filePath ?? '')}）`
          : 'PostgreSQL 业务账本已连接'
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
      workspaceBinding: this.workspaceBinding,
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
      wecom: this.wecomChannels.wecomDiagnosticsSnapshot(),
      // F36: 密钥状态只含 {set, source}，永不回显值。
      secrets: this.workspace ? this.secretStatusSnapshot() : null,
      tts: {
        engine: this.config?.tts.engine ?? 'none',
        voice: this.config?.tts.voice ?? '',
        probe: this.ttsProbeCache,
      },
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
let cachedVersions: { dsh: string; sdk: string; plugin: string } | null = null;
function resolveVersions(): { dsh: string; sdk: string; plugin: string } {
  if (cachedVersions) return cachedVersions;
  const require = createRequire(import.meta.url);
  const read = (name: string): string => {
    try {
      return String(require(`${name}/package.json`).version ?? '未知');
    } catch {
      return '未解析';
    }
  };
  cachedVersions = { dsh: read('@deepseek-ai/dsh'), sdk: read('@larksuiteoapi/node-sdk'), plugin: read('..') };
  return cachedVersions;
}

