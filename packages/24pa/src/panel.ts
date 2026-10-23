import { randomUUID } from 'node:crypto';
import type { DshContext } from './host.js';
import type { PaRuntime } from './runtime.js';
import { DIGEST_UNCONFIRMED_GRACE_MS } from './digest-service.js';
import { ConfigError, CONFIG_FIELDS } from './config.js';
import { FakeFeishuTransport } from './feishu.js';
import type { InboundEvent } from './feishu.js';

// Read-mostly admin endpoint for the 24私助工作区 panel. It rides the dsh
// connection service, so loopback + cookie auth apply; secrets never enter
// responses. `test.inject` exists only when the transport was explicitly
// replaced (PA24_TRANSPORT=fake), never against the production SDK link.

const PATH = '/api/24pa';

// Backend half of the panel RPC surface's single source (F19 前置：RPC 常量化).
// Endpoints and action types live here once for the dispatcher; the browser
// half (client.js) still carries its own literals and follows up separately.
// Future actions (digest voice toggles, …) extend this table instead of
// adding another layer of scattered string literals in comparisons.
export const PANEL_RPC = {
  endpoints: {
    snapshot: 'snapshot',
    action: 'action',
    memory: 'memory',
    memoryHistory: 'memory.history',
    health: 'health',
    budget: 'budget',
    healthSnapshot: 'health.snapshot',
    healthTestPreview: 'health.test.preview',
    configEvidence: 'workspace.evidence',
    notesQueue: 'notes.queue',
    materials: 'materials',
    minutes: 'minutes',
    roles: 'roles',
    reminders: 'reminders',
    digests: 'digests',
    skillsCatalog: 'skills.catalog',
    skillsInspect: 'skills.inspect',
    skillsExport: 'skills.export',
    skillsPackage: 'skills.package',
    skillsVersion: 'skills.version',
    skillsPreview: 'skills.preview',
    skillsRuns: 'skills.runs',
    skillsRun: 'skills.run',
    plans: 'plans',
    planSummary: 'plans.summary',
    plan: 'plans.inspect',
    planDraft: 'plans.draft',
    planPreview: 'plans.preview',
    planRunPreview: 'plans.run-preview',
    planMigrationPreview: 'plans.migration-preview',
    runHistory: 'runs',
    runSummary: 'runs.summary',
    runExport: 'runs.export',
    runDiagnostics: 'runs.diagnostics',
    workInspect: 'work.inspect',
    workerRun: 'worker.run',
    sources: 'sources',
    calendar: 'calendar',
    todos: 'todos',
  },
  actions: {
    workspaceBind: 'workspace.bind',
    workspaceReload: 'workspace.reload',
    workspaceConfigUpdate: 'workspace.config-update',
    workspaceSecretUpdate: 'workspace.secret-update',
    connectionCheck: 'connection.check',
    connectionWecomCheck: 'connection.wecom-check',
    healthCheck: 'health.check',
    healthTest: 'health.test',
    healthTestCleanup: 'health.test.cleanup',
    healthIdentityAccept: 'health.identity-accept',
    notesPoll: 'notes.poll',
    materialChange: 'material.change',
    notesRemindPoll: 'notes.remind-poll',
    digestSupervise: 'digest.supervise',
    digestReschedule: 'digest.reschedule',
    digestSetSkill: 'digest.set-skill',
    digestSetVoice: 'digest.set-voice',
    digestRunNow: 'digest.run-now',
    ttsProbe: 'tts.probe',
    ttsTest: 'tts.test',
    robotOpen: 'robot.open',
    roleRegister: 'role.register',
    workList: 'work.list',
    workChange: 'work.change',
    skillChange: 'skill.change',
    skillRun: 'skill.run',
    budgetRelease: 'budget.release',
    planChange: 'plan.change',
    planDelivery: 'plan.delivery',
    sourceCheck: 'source.check',
    calendarVerify: 'calendar.verify',
    todosVerify: 'todos.verify',
    testInject: 'test.inject',
  },
} as const;

interface PanelAction {
  type?: string;
  [key: string]: unknown;
}

export function registerPanel(ctx: DshContext, runtime: PaRuntime): void {
  ctx.effect(() => {
    const route = {
      path: PATH,
      methods: ['POST'] as const,
      requestBody: 'buffered' as const,
      async fetch(request: Request): Promise<Response> {
        const respond = (value: unknown) => Response.json(value, { headers: { 'cache-control': 'no-store' } });
        try {
          const body = (await request.json()) as { endpoint?: string; payload?: PanelAction };
          const endpoint = body.endpoint ?? '';
          const payload = body.payload ?? {};
          const E = PANEL_RPC.endpoints;
          if (endpoint === E.action) return respond({ ok: true, value: await action(runtime, payload) });
          if (endpoint === E.snapshot && runtime.closed) return respond({ ok: true, value: { ...runtime.snapshot(), work: [], outbox: [], configMeta: { fields: CONFIG_FIELDS } } });
          return await runtime.inspectWorkspace(async () => {
            if (endpoint === E.healthSnapshot) return respond({ ok: true, value: await runtime.healthSnapshot(payload.workspaceBinding) });
            if (endpoint === E.healthTestPreview) return respond({ ok: true, value: await runtime.connectionTest(payload, 'preview') });
            if (endpoint === E.configEvidence) return respond({ ok: true, value: await runtime.configurationEvidence(payload.workspaceBinding) });
            if (endpoint === E.skillsCatalog) return respond({ ok: true, value: await runtime.skillManagement.list(payload.workspaceBinding) });
            if (endpoint === E.skillsInspect) return respond({ ok: true, value: await runtime.skillManagement.inspect(payload.id, payload.workspaceBinding) });
            if (endpoint === E.skillsExport) return respond({ ok: true, value: await runtime.skillManagement.exportMarkdown(payload.id, payload.fingerprint, payload.workspaceBinding, typeof payload.versionId === 'string' ? payload.versionId : undefined) });
            if (endpoint === E.skillsPackage) return respond({ ok: true, value: typeof payload.id === 'string' && payload.id.startsWith('managed:')
              ? await runtime.skillPackages.download(payload.id, String(payload.versionId ?? ''), payload.workspaceBinding)
              : await runtime.skillManagement.downloadPackage(payload.id, payload.fingerprint, payload.workspaceBinding) });
            if (endpoint === E.skillsVersion) return respond({ ok: true, value: await runtime.skillPackages.inspect(payload.id, payload.workspaceBinding, String(payload.versionId ?? '')) });
            if (endpoint === E.skillsPreview) return respond({ ok: true, value: await runtime.skillRuns.preview(payload) });
            if (endpoint === E.skillsRuns) return respond({ ok: true, value: await runtime.skillRuns.list(payload) });
            if (endpoint === E.skillsRun) return respond({ ok: true, value: await runtime.skillRuns.inspect(payload) });
            if (endpoint === E.plans) return respond({ ok: true, value: await runtime.taskPlans.list(payload) });
            if (endpoint === E.planSummary) return respond({ ok: true, value: await runtime.taskPlans.summary(payload) });
            if (endpoint === E.plan) return respond({ ok: true, value: await runtime.taskPlans.inspect(payload) });
            if (endpoint === E.planDraft) return respond({ ok: true, value: await runtime.taskPlans.draft(payload) });
            if (endpoint === E.planPreview) return respond({ ok: true, value: await runtime.taskPlans.preview(payload) });
            if (endpoint === E.planMigrationPreview) return respond({ ok: true, value: await runtime.taskPlans.migrationPreview(payload) });
            if (endpoint === E.runHistory) return respond({ ok: true, value: await runtime.runHistory.list(payload) });
            if (endpoint === E.runSummary) return respond({ ok: true, value: await runtime.runHistory.summary(payload) });
            if (endpoint === E.runExport) return respond({ ok: true, value: await runtime.runHistory.export(payload) });
            if (endpoint === E.runDiagnostics) return respond({ ok: true, value: await runtime.runHistory.diagnostics(payload) });
            if (endpoint === E.workerRun) return respond({ ok: true, value: await runtime.workerRuns.inspect(payload) });
            if (endpoint === E.workInspect) return respond({ ok: true, value: await runtime.runHistory.work(payload) });
            if (endpoint === E.planRunPreview) return respond({ ok: true, value: await runtime.planEngine.previewRun(payload) });
            if (endpoint === E.sources) return respond({ ok: true, value: await runtime.sourcesSnapshot() });
            if (endpoint === E.calendar) return respond({ ok: true, value: await runtime.calendarSnapshot(payload) });
            if (endpoint === E.todos) return respond({ ok: true, value: await runtime.todoSnapshot(payload) });
            if (endpoint === E.snapshot) return respond({ ok: true, value: await snapshot(runtime) });
            if (endpoint === E.memoryHistory) return respond({ ok: true, value: await runtime.memorySnapshot(payload, true) });
            if (endpoint === E.memory) return respond({ ok: true, value: await runtime.memorySnapshot(payload) });
            if (endpoint === E.budget) return respond({ ok: true, value: await runtime.modelBudgets.snapshot(payload) });
            if (endpoint === E.health) {
              return respond({ ok: true, value: await runtime.maintenanceHealth() });
            }
            if (endpoint === E.notesQueue) {
              return respond({ ok: true, value: await runtime.reviewQueue() });
            }
            if (endpoint === E.materials) return respond({ ok: true, value: await runtime.materialSnapshot(payload) });
            if (endpoint === E.minutes) return respond({ ok: true, value: await runtime.minutesSnapshot() });
            if (endpoint === E.roles) {
              return respond({ ok: true, value: { roles: runtime.listRoles() } });
            }
            if (endpoint === E.reminders) {
              return respond({ ok: true, value: runtime.reminders ? await runtime.reminders.list() : { rules: [], occurrences: [] } });
            }
            if (endpoint === E.digests) {
              return respond({ ok: true, value: await runtime.digestPlans() });
            }
            throw new Error('未知管理接口。');
          });
        } catch (error) {
          return respond({ ok: false, error: { message: (error as Error).message } });
        }
      },
    };
    void ctx.connection.fetch.register(route);
    return () => { };
  });
}

function str(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

async function snapshot(runtime: PaRuntime): Promise<Record<string, unknown>> {
  return runtime.inspectWorkspace(async () => {
    const base = runtime.snapshot();
    const repos = runtime.repos;
    return {
      ...base,
      work: repos ? await repos.workItems.list(undefined, 50) : [],
      outbox: repos ? await repos.outbox.recent(20) : [],
      // arch-4: the config field descriptors ride the snapshot so the form and
      // the voice list have one source (config.ts) — client.js carries no copy.
      configMeta: { fields: CONFIG_FIELDS },
    };
  });
}


/**
 * Action registry (round-3 arch-2): one entry per panel action — validation
 * and dispatch live together here, and a new action is one table row instead
 * of a dispatcher branch plus a runtime forwarder plus client literals. The
 * PANEL_RPC vocabulary stays the single source for the string surface.
 */
type PanelActionHandler = (runtime: PaRuntime, payload: PanelAction) => Promise<unknown>;

function requiredBinding(payload: PanelAction): string {
  const binding = str(payload.workspaceBinding);
  if (!binding) throw new ConfigError('缺少工作区绑定标识，请刷新后重新编辑。');
  return binding;
}

const ACTION_HANDLERS: Readonly<Record<string, PanelActionHandler>> = {
  [PANEL_RPC.actions.budgetRelease]: (runtime, payload) => runtime.releaseBudget(payload),
  [PANEL_RPC.actions.materialChange]: (runtime, payload) => runtime.changeMaterial(payload),
  [PANEL_RPC.actions.healthCheck]: (runtime, payload) => runtime.checkHealth(payload),
  [PANEL_RPC.actions.healthTest]: (runtime, payload) => runtime.connectionTest(payload, 'execute'),
  [PANEL_RPC.actions.healthTestCleanup]: (runtime, payload) => runtime.connectionTest(payload, 'cleanup'),
  [PANEL_RPC.actions.healthIdentityAccept]: (runtime, payload) => runtime.acceptWecomIdentity(payload),
  [PANEL_RPC.actions.skillChange]: (runtime, payload) => runtime.changeSkill(payload),
  [PANEL_RPC.actions.skillRun]: (runtime, payload) => runtime.runSkill(payload),
  [PANEL_RPC.actions.sourceCheck]: (runtime, payload) => runtime.checkSource(payload),
  [PANEL_RPC.actions.calendarVerify]: (runtime, payload) => runtime.verifyCalendar(payload),
  [PANEL_RPC.actions.todosVerify]: (runtime, payload) => runtime.verifyTodos(payload),
  [PANEL_RPC.actions.workspaceBind]: async (runtime, payload) => {
    const path = String(payload.path ?? '');
    return runtime.bind(path, true).then(() => snapshot(runtime));
  },
  [PANEL_RPC.actions.workspaceReload]: runtime => runtime.reloadWorkspace().then(() => snapshot(runtime)),
  [PANEL_RPC.actions.workspaceConfigUpdate]: (runtime, payload) => {
    const config = payload.config as Record<string, unknown> | undefined;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new ConfigError('缺少配置补丁。');
    return runtime.updateWorkspaceConfig(config, requiredBinding(payload), str(payload.expectedSourcesHash), str(payload.expectedConfigHash)).then(() => snapshot(runtime));
  },
  // F36: 密钥值进工作区密钥库（.24pa/secrets.json，0600），与 AGENTS.md 解耦。
  [PANEL_RPC.actions.workspaceSecretUpdate]: (runtime, payload) => {
    const values = payload.values as Record<string, unknown> | undefined;
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new ConfigError('缺少密钥补丁。');
    return runtime.updateWorkspaceSecrets(values, requiredBinding(payload)).then(() => snapshot(runtime));
  },
  [PANEL_RPC.actions.connectionCheck]: runtime => runtime.checkAccess(),
  [PANEL_RPC.actions.connectionWecomCheck]: runtime => runtime.wecomCheck(),
  [PANEL_RPC.actions.notesPoll]: async runtime => ({ verified: await runtime.pollPendingNotes() }),
  [PANEL_RPC.actions.notesRemindPoll]: async runtime => ({ sent: await runtime.dispatchReviewReminders() }),
  [PANEL_RPC.actions.digestSupervise]: (runtime, payload) => {
    const graceMs = Number(payload.graceMs);
    return runtime.superviseDigests(Number.isFinite(graceMs) && graceMs >= 0 ? graceMs : DIGEST_UNCONFIRMED_GRACE_MS);
  },
  [PANEL_RPC.actions.planChange]: (runtime, payload) => runtime.changeTaskPlan(payload),
  [PANEL_RPC.actions.planDelivery]: (runtime, payload) => runtime.changePlanDelivery(payload),
  [PANEL_RPC.actions.digestReschedule]: (runtime, payload) => runtime.digestReschedule(payload as Record<string, unknown>),
  [PANEL_RPC.actions.digestSetSkill]: (runtime, payload) => runtime.digestSetSkill(payload as Record<string, unknown>),
  [PANEL_RPC.actions.digestSetVoice]: (runtime, payload) => runtime.digestSetVoice(payload as Record<string, unknown>),
  [PANEL_RPC.actions.digestRunNow]: (runtime, payload) => runtime.digestRunNow(String(payload.planId ?? '')),
  [PANEL_RPC.actions.ttsProbe]: runtime => runtime.ttsProbe(),
  [PANEL_RPC.actions.ttsTest]: runtime => runtime.ttsTestSend(),
  [PANEL_RPC.actions.robotOpen]: async runtime => ({ sessionId: await runtime.openLocalSession() }),
  [PANEL_RPC.actions.roleRegister]: async (runtime, payload) => {
    const definition = payload.definition as Record<string, unknown> | undefined;
    if (!definition || typeof definition !== 'object') throw new Error('缺少角色定义。');
    await runtime.registerRole(
      {
        id: String(definition.id ?? ''),
        name: String(definition.name ?? ''),
        persona: String(definition.persona ?? ''),
        brief: String(definition.brief ?? ''),
        available: definition.available === true,
        actions: {},
      },
      Array.isArray(definition.actionNames) ? definition.actionNames.map(String) : [],
    );
    return { roles: runtime.listRoles() };
  },
  [PANEL_RPC.actions.workChange]: (runtime, payload) => runtime.changeWork(payload),
  [PANEL_RPC.actions.workList]: runtime => runtime.inspectWorkspace(async () => ({ items: runtime.repos ? await runtime.repos.workItems.list(undefined, 100) : [] })),
  [PANEL_RPC.actions.testInject]: async (runtime, payload) => {
    const transport = runtime.getTransport();
    if (!transport || typeof (transport as FakeFeishuTransport).inject !== 'function') {
      throw new Error('test.inject 仅在显式启用 fake 通道（PA24_TRANSPORT=fake）时可用。');
    }
    const event = payload.event as (Partial<InboundEvent> & { imageData?: string }) | undefined;
    if (!event || typeof event !== 'object') throw new Error('缺少事件内容。');
    const inbound: InboundEvent = {
      eventId: String(event.eventId ?? `test-${randomUUID()}`),
      appId: String(event.appId ?? ''),
      tenantKey: String(event.tenantKey ?? 'test-tenant'),
      kind: event.kind === 'card' ? 'card' : 'message',
      senderOpenId: String(event.senderOpenId ?? ''),
      chatType: event.chatType ?? 'p2p',
      chatId: event.chatId ? String(event.chatId) : undefined,
      messageId: event.messageId ? String(event.messageId) : `om-${randomUUID().slice(0, 12)}`,
      messageType: event.messageType ?? 'text',
      text: event.text !== undefined ? String(event.text) : undefined,
      imageKey: event.imageKey ? String(event.imageKey) : undefined,
      fileKey: event.fileKey ? String(event.fileKey) : undefined,
      fileName: event.fileName ? String(event.fileName) : undefined,
      parentMessageId: event.parentMessageId ? String(event.parentMessageId) : undefined,
      ...(event.cardAction ? { cardAction: event.cardAction as { value?: Record<string, unknown>; message?: string } } : {}),
    };
    await (transport as FakeFeishuTransport).inject(inbound, event.imageData ? String(event.imageData) : undefined);
    return { injected: true, eventId: inbound.eventId };
  },
};

/** Dispatch one panel action through the registry (exported for seam tests). */
export async function action(runtime: PaRuntime, payload: PanelAction): Promise<unknown> {
  const type = String(payload.type ?? '');
  const handler = ACTION_HANDLERS[type];
  if (!handler) {
    throw new Error('管理台只提供工作区绑定、配置重载、只读检查、事项查询与测试注入。');
  }
  return handler(runtime, payload);
}

