import { randomUUID, createHash } from 'node:crypto';
import { mkdir, realpath, stat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { DshContext, DshAgent, DshSession, ContentBlock, WorkspaceInfo } from './host.js';
import { PaDatabase, resolveDsn } from './pg.js';
import { createRepos, type Repos, type WorkItemRow } from './repo.js';
import { acquireHostLock, type HostLock, HostAlreadyActive } from './lock.js';
import { parseAgentsMd, template, ConfigError, type PaConfig, WORKER_ROLES, type WorkerRole } from './config.js';
import { runLarkCli } from './lark.js';
import { SdkFeishuTransport, inspectAccess, type FeishuTransport, type InboundEvent, type AccessDiagnostics, cliOptions } from './feishu.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const nowIso = () => new Date().toISOString();
const text = (value: unknown, max = 12000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`请输入 1–${max} 字的内容。`);
  return value.trim();
};
const textOf = (content: readonly ContentBlock[] | undefined): string =>
  (content || []).filter(b => b.type === 'text').map(b => String(b.text ?? '')).join('\n').trim();

const WORKER_PERSONAS: Record<WorkerRole, { name: string; persona: string; brief: string }> = {
  memo: {
    name: '备忘整理',
    persona: '你是 24私助的备忘整理 Worker。把收到的想法、资料链接和文字材料整理保存，返回出处；不执行其他业务，不产生新授权。结果交回发起会话。',
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
  repos: Repos | null = null;
  config: PaConfig | null = null;
  private instructions = '';
  private sourceHash = '';
  private loadedAt: string | null = null;
  private configError: string | null = null;

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
    try {
      this.lock = await acquireHostLock(this.options.stateDirectory);
    } catch (error) {
      if (error instanceof HostAlreadyActive) throw error;
      throw error;
    }
    const requested = this.options.workspacePath || (await this.readSavedWorkspacePath());
    if (requested) {
      await this.bind(requested, true);
    } else {
      this.configError = '尚未选择24私助工作区目录；请在「24私助工作区」面板绑定。';
    }
    await this.restoreActiveWork();
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
      await this.transport?.close().catch(() => {});
      this.transport = null;
      await this.db?.close().catch(() => {});
      this.db = null;
      await this.lock?.release().catch(() => {});
      this.lock = null;
    }
  }

  // ---- workspace binding & config -----------------------------------------

  /** After a restart, re-attach the in-memory role map from the durable ledger. */
  private async restoreActiveWork(): Promise<void> {
    if (!this.repos) return;
    const active = await this.repos.workItems.list(['accepted', 'queued', 'running', 'waiting_input'], 100);
    for (const item of active) this.trackWorkItem(item);
  }

  async bind(path: string, initialize = false): Promise<void> {
    if (!isAbsolute(path)) throw new Error('工作区必须是服务器上的绝对目录。');
    if (initialize) await mkdir(path, { recursive: true });
    const real = await realpath(path);
    if (!(await stat(real)).isDirectory()) throw new Error('请选择目录。');

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
    const count = await this.repos.workItems.countByStatus('running');
    const queued = await this.repos.workItems.countByStatus('queued');
    return count + queued > 0;
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
      await this.repos!.outbox.enqueue({
        dedupKey: `notice:session-rebound:${this[key]}`,
        channel: 'feishu',
        target: this.config?.ownerOpenId || 'unbound',
        kind: 'text',
        content: { text: `旧会话 ${previous} 已选择其他预设，历史保留；24私助已建立新的${kind === 'feishu' ? '飞书接入' : '本地助理'}会话。` },
      });
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
    this.workItemByChild.set(item.id, item);
  }

  getTransport(): FeishuTransport | null {
    return this.transport;
  }

  // ---- inbound: durable inbox before ACK -----------------------------------

  async handleInbound(event: InboundEvent): Promise<void> {
    const config = this.config;
    if (!config || !this.repos) throw new Error('24私助尚未就绪。');
    this.lastReceivedAt = nowIso();
    const expectedApp = this.env[config.appIdEnv] ?? '';
    const reject = async (reason: string): Promise<void> => {
      await this.repos!.inbox.insert({
        eventId: event.eventId,
        source: 'feishu',
        kind: event.kind === 'card' ? 'card' : 'message',
        payload: { ...event, rejected: reason },
      });
      await this.repos!.inbox.mark(event.eventId, { status: 'rejected', error: reason });
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
        appId: event.appId || expectedApp,
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
      await this.repos.outbox.enqueue({
        dedupKey: `card-unsupported:${event.eventId}`,
        channel: 'feishu',
        target: this.config.ownerOpenId,
        kind: 'text',
        content: { text: '卡片操作尚未在此版本启用（手写审核随后交付）；请直接回复文字说明需要办理什么。' },
      });
      await this.repos.inbox.mark(row.event_id, { status: 'rejected', error: '卡片暂不支持' });
      return;
    }
    if (event.messageType === 'image') {
      await this.repos.outbox.enqueue({
        dedupKey: `image-unsupported:${event.eventId}`,
        channel: 'feishu',
        target: this.config.ownerOpenId,
        kind: 'text',
        content: { text: '已收到图片。手写笔记整理在后续版本交付；当前版本请用文字描述需要记录的内容。' },
      });
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
      await this.repos.outbox.enqueue({
        dedupKey: `status:${event.eventId}`,
        channel: 'feishu',
        target: this.config.ownerOpenId,
        kind: 'text',
        content: {
          text: [
            '24私助已收到你的消息。',
            `绑定：${this.config.ownerOpenId ? '已按配置绑定主人' : '尚未在配置中绑定主人'}`,
            `业务账本（PostgreSQL）：${pg?.state === 'ok' ? '正常' : pg?.message ?? '未知'}`,
            '直接告诉我需要办理什么；也可以说“查看正在处理的事”。配置与记忆维护请到 dsh 的24私助会话。',
          ].join('\n'),
        },
      });
      await this.repos.inbox.mark(row.event_id, { status: 'delivered', requestId: `status:${event.eventId}` });
      return;
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
        await this.repos.outbox.enqueue({
          dedupKey: `reply:${pending.inboxId}:${turn}`,
          channel: 'feishu',
          target: this.config.ownerOpenId,
          kind: 'text',
          content: { text: reply },
        });
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
      await this.deliverWorkItemResult(item.id, `「${fresh.title}」未完成：${failure?.message ?? 'Worker 未产生结果'}`);
      return;
    }
    await this.repos.workItems.update(item.id, {
      status: 'completed',
      result: output,
      progress: 'Worker 已完成，结果已交回',
    });
    await this.deliverWorkItemResult(item.id, output);
  }

  private async deliverWorkItemResult(workItemId: string, output: string): Promise<void> {
    if (!this.repos || !this.config) return;
    const item = await this.repos.workItems.get(workItemId);
    if (!item) return;
    if (item.origin === 'feishu') {
      const ref = item.result_ref as { docUrl?: string; operationId?: string } | null;
      const source = ref?.docUrl ? `\n出处：${ref.docUrl}\n操作编号：${ref.operationId}` : '';
      await this.repos.outbox.enqueue({
        dedupKey: `workitem:${workItemId}:result`,
        channel: 'feishu',
        target: this.config.ownerOpenId,
        kind: 'text',
        content: { text: `「${item.title}」已完成：\n${output}${source}` },
      });
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
    if (!(WORKER_ROLES as readonly string[]).includes(args.worker)) throw new Error('未注册的 Worker 类型。');
    if (!config.enabledWorkers.includes(args.worker as WorkerRole)) throw new Error('此 Worker 未启用。');
    const title = text(args.title, 200);
    const instruction = text(args.instruction);
    const origin: 'feishu' | 'local' = agent.id === this.accessSessionId ? 'feishu' : 'local';
    const id = `pa24-work-${args.worker}-${randomUUID()}`;
    const persona = WORKER_PERSONAS[args.worker as WorkerRole];
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
        const persona = WORKER_PERSONAS[item.role as WorkerRole];
        if (!persona) throw new Error(`Worker 类型未注册：${item.role}`);
        const modelRoute = this.config.workerModels[item.role as WorkerRole];
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
            toolFilter: { allow: ['pa24_work'] },
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
    if (!item || item.role !== 'memo' || item.status !== 'running') {
      throw new Error('此会话不是运行中的 Worker，或事项已停止。');
    }
    const action = String(args.action ?? '');
    if (action === 'memo_find') {
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
    }
    if (action === 'memo_save') {
      return this.saveMemo(item, args);
    }
    throw new Error('未知业务操作。');
  }

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
    if (!created && operation.status === 'succeeded') {
      const memo = await this.repos!.memos.search({ topic, limit: 1 });
      return {
        operationId,
        reused: true,
        message: '此备忘此前已保存，未重复创建文档。',
        docUrl: memo[0]?.doc_url ?? operation.receipt?.docUrl ?? null,
      };
    }
    await this.repos!.operations.update(operationId, { status: 'running' });
    const live = this.transport !== null;
    try {
      let external: { docId: string | null; url: string | null; revision: string | null } = { docId: null, url: null, revision: null };
      if (live && this.config!.mode === 'feishu') {
        external = await this.createMemoDocument(item, topic, content);
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
        receipt: { docId: external.docId, url: external.url, revision: external.revision, memoId: memo.id, demo: !live },
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
      const outcome = (error as any)?.outcome === 'unknown' ? 'unknown' : 'failed';
      await this.repos!.operations.update(operationId, { status: outcome, error: (error as Error).message });
      throw error;
    }
  }

  private async createMemoDocument(item: WorkItemRow, topic: string, content: string): Promise<{ docId: string; url: string; revision: string | null }> {
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
    if (data?.warnings?.length) {
      throw new Error(`飞书文档创建带有警告，请检查目录中的文档：${data.warnings.map((x: unknown) => String(x)).join('；')}`);
    }
    const doc = data?.document;
    if (!doc?.document_id || !doc?.url) throw new Error('未取得文档标识；请先核对体验目录，不要盲目重试。');
    // Read back: creation counts only once the real document content is confirmed.
    const readback = await runLarkCli(cliOptions(config, this.options.larkCliBin, this.options.cliTimeoutMs), [
      'docs', '+fetch', '--as', 'user', '--doc', doc.document_id, '--doc-format', 'xml', '--detail', 'full',
    ]);
    if (!readback.data?.document?.content) throw new Error('文档回读不完整，保存结果未确认。');
    return { docId: doc.document_id, url: doc.url, revision: readback.data.document.revision_id != null ? String(readback.data.document.revision_id) : null };
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
    items.push({
      id: 'host',
      state: this.startupError ? 'error' : this.closed ? 'error' : 'ok',
      message: this.startupError
        ? `启动未完成：${this.startupError.message}`
        : this.closed
          ? '插件已停止'
          : `24私助 Host 运行中（Node ${process.version}）`,
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
