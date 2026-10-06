import { randomUUID } from 'node:crypto';
import type { DshContext } from './host.js';
import type { PaRuntime } from './runtime.js';
import { DIGEST_UNCONFIRMED_GRACE_MS } from './runtime.js';
import { FakeFeishuTransport } from './runtime.js';
import type { InboundEvent } from './feishu.js';

// Read-mostly admin endpoint for the 24私助工作区 panel. It rides the dsh
// connection service, so loopback + cookie auth apply; secrets never enter
// responses. `test.inject` exists only when the transport was explicitly
// replaced (PA24_TRANSPORT=fake), never against the production SDK link.

const PATH = '/api/24pa';

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
          if (endpoint === 'snapshot') return respond({ ok: true, value: await snapshot(runtime) });
          if (endpoint === 'action') return respond({ ok: true, value: await action(runtime, payload) });
          if (endpoint === 'memory') {
            if (!runtime.memory) throw new Error('尚未绑定工作区。');
            return respond({
              ok: true,
              value: await runtime.memory.search({
                query: str(payload.query),
                category: str(payload.category),
                topic: str(payload.topic),
                status: str(payload.status),
                limit: Number.isFinite(Number(payload.limit)) ? Number(payload.limit) : 20,
                offset: Number.isFinite(Number(payload.offset)) ? Number(payload.offset) : 0,
              }),
            });
          }
          if (endpoint === 'notes.queue') {
            return respond({ ok: true, value: await runtime.reviewQueue() });
          }
          if (endpoint === 'roles') {
            return respond({ ok: true, value: { roles: runtime.listRoles() } });
          }
          if (endpoint === 'memo') {
            const memos = runtime.repos
              ? await runtime.repos.memos.search({
                  topic: str(payload.topic),
                  query: str(payload.query),
                  limit: 50,
                })
              : [];
            return respond({ ok: true, value: { memos } });
          }
          throw new Error('未知管理接口。');
        } catch (error) {
          return respond({ ok: false, error: { message: (error as Error).message } });
        }
      },
    };
    void ctx.connection.fetch.register(route);
    return () => {};
  });
}

function str(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

async function snapshot(runtime: PaRuntime): Promise<Record<string, unknown>> {
  const base = runtime.snapshot();
  const repos = runtime.repos;
  return {
    ...base,
    work: repos ? await repos.workItems.list(undefined, 50) : [],
    outbox: repos ? await repos.outbox.recent(20) : [],
  };
}

async function action(runtime: PaRuntime, payload: PanelAction): Promise<unknown> {
  const type = String(payload.type ?? '');
  if (type === 'workspace.bind') {
    const path = String(payload.path ?? '');
    return runtime.bind(path, true).then(() => snapshot(runtime));
  }
  if (type === 'workspace.reload') return runtime.reloadWorkspace().then(() => snapshot(runtime));
  if (type === 'connection.check') return runtime.checkAccess();
  if (type === 'notes.poll') return { verified: await runtime.pollPendingNotes() };
  if (type === 'notes.remind-poll') return { sent: await runtime.dispatchReviewReminders() };
  if (type === 'digest.supervise') {
    const graceMs = Number(payload.graceMs);
    return runtime.superviseDigests(Number.isFinite(graceMs) && graceMs >= 0 ? graceMs : DIGEST_UNCONFIRMED_GRACE_MS);
  }
  if (type === 'robot.open') return { sessionId: await runtime.openLocalSession() };
  if (type === 'role.register') {
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
  }
  if (type === 'work.list') {
    return { items: runtime.repos ? await runtime.repos.workItems.list(undefined, 100) : [] };
  }
  if (type === 'test.inject') {
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
  }
  throw new Error('管理台只提供工作区绑定、配置重载、只读检查、事项查询与测试注入。');
}
