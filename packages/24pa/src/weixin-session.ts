import type { DshAgent, DshContext, DshSession, SessionEvent, SessionHeader } from './host.js';
import type { WeixinBindingRow } from './repo/weixin.js';
import { canceledInputIds, consumedTurn } from './host-turn.js';

type ReadHandle = { header: SessionHeader & { id: string }; inheritedEventCount: number;
  read(start: number): Promise<{ events: SessionEvent[] }>; close(): Promise<void> };
export async function readWeixinSession(host: DshContext, id: string): Promise<DshSession> {
  const live = host.sessions.get?.(id);
  if (live) {
    if (!await host.sessions.flush(live)) throw new Error('微信会话尚未确认持久化。');
    const events = [...live.ownEvents()];
    return { id: live.id, header: { ...live.header }, ownEvents: () => events };
  }
  const persistence = host.get('sessionPersistence') as { open?(id: string, access: 'read'): Promise<ReadHandle> } | null;
  if (!persistence?.open) throw new Error('宿主缺少公开持久会话读取能力。');
  const handle = await persistence.open(id, 'read');
  try {
    const { events } = await handle.read(0), own = events.slice(handle.inheritedEventCount);
    return { id: handle.header.id, header: handle.header, ownEvents: () => own };
  } finally { await handle.close(); }
}
function assertSession(session: DshSession, binding: WeixinBindingRow, cwd: string): void {
  let preset = session.header.agentPreset;
  for (const event of session.ownEvents()) if (event.type === 'agent-preset/selected') preset = event.data.agentPreset;
  if (session.id !== binding.session_id || session.header.cwd !== cwd || session.header.parentSession ||
      session.header.origin === 'subagent' || preset !== 'pa24') throw new Error('微信会话的工作区、预设或父子归属不符，未启用。');
}
interface AgentHandle { agent: DshAgent; dispose(): Promise<void> }
interface ExactAgentFactory {
  get(id: string): DshAgent | undefined;
  create(options: { sessionId: string; meta: SessionHeader; agentOptions: { provider: string; model: string };
    setup(ctx: DshContext, agent: DshAgent): Promise<{ commit(): void }> }): Promise<AgentHandle>;
  resume(options: { resumeSessionId: string; agentOptions: { provider: string; model: string };
    setup(ctx: DshContext, agent: DshAgent): Promise<{ commit(): void }> }): Promise<AgentHandle>;
}

/** Exact-ID public Host factory: remote registration precedes every mount.
 * Input still uses the existing SessionController / native Worker path. */
export class WeixinSessions {
  private readonly handles = new Map<string, AgentHandle>();
  constructor(private readonly host: DshContext, private readonly registered: (binding: WeixinBindingRow) => boolean) {}
  async ensure(binding: WeixinBindingRow, workspace: { id: string; path: string }, create: boolean): Promise<DshAgent> {
    if (!this.registered(binding) || binding.state === 'retired') throw new Error('微信远程身份尚未登记或已退休。');
    const agents = this.host.get('agents') as ExactAgentFactory | null;
    if (!agents?.create || !agents.resume) throw new Error('微信接入需要 dsh 0.2.2-rc.1 的公开会话工厂。');
    const live = agents.get(binding.session_id);
    if (live) {
      if (create) throw new Error('新的微信候选会话标识已被占用，未覆盖历史。');
      assertSession(live.session, binding, workspace.path); return live;
    }
    if (create) {
      try { await readWeixinSession(this.host, binding.session_id); }
      catch (error) {
        if ((error as Error).name !== 'SessionPersistenceNotFoundError') throw error;
        return this.build(agents, binding, workspace, true);
      }
      throw new Error('新的微信候选会话标识已被占用，未覆盖历史。');
    }
    assertSession(await readWeixinSession(this.host, binding.session_id), binding, workspace.path);
    return this.build(agents, binding, workspace, false);
  }
  private async build(agents: ExactAgentFactory, binding: WeixinBindingRow, workspace: { id: string; path: string }, create: boolean): Promise<DshAgent> {
    const loader = this.host.get('loader') as { import(name: string, base: string, options: object): Promise<{ installModelSelection(ctx: DshContext): void }> } | null;
    const model = this.host.get('agentDefaultModel') as { currentSelection(): { provider: string; model: string } } | null;
    const presets = this.host.get('agentPresets') as { mount(ctx: DshContext, id: string): Promise<void> } | null;
    const registry = this.host.workspaceRegistry.get(workspace.id) as { attachSession?(id: string): Promise<void> } | undefined;
    if (!loader?.import || !model?.currentSelection || !presets?.mount || !registry?.attachSession) throw new Error('宿主的模型、预设或工作区装配接口不可用。');
    const library = await loader.import('@deepseek-ai/dsh-agent', import.meta.url, {});
    const check = (agent: DshAgent) => {
      if (!this.registered(binding)) throw new Error('微信身份在会话装配期间改变。');
      assertSession(agent.session, binding, workspace.path);
    };
    const setup = async (agentCtx: DshContext, agent: DshAgent) => {
      check(agent); library.installModelSelection(agentCtx); await presets.mount(agentCtx, 'pa24');
      return { commit: () => check(agent) };
    };
    const agentOptions = model.currentSelection();
    const handle = create
      ? await agents.create({ sessionId: binding.session_id, meta: { cwd: workspace.path, agentPreset: 'pa24' }, agentOptions, setup })
      : await agents.resume({ resumeSessionId: binding.session_id, agentOptions, setup });
    this.handles.set(binding.session_id, handle);
    try {
      check(handle.agent); await registry.attachSession(binding.session_id);
      if (!await this.host.sessions.flush(handle.agent.session)) throw new Error('微信会话创建后持久化未确认。');
      return handle.agent;
    } catch (error) { await this.release(binding.session_id); throw error; }
  }
  async release(id: string): Promise<void> { const handle = this.handles.get(id); if (handle) { this.handles.delete(id); await handle.dispose(); } }
  async close(): Promise<void> { for (const id of this.handles.keys()) await this.release(id); }
}

export type WeixinInputEvidence = { state: 'queued' | 'consumed' | 'unknown'; reason: string }
  | { state: 'complete' | 'canceled'; text: string; turn?: number };
/** No new prompt or queue mutation. Incomplete/ambiguous evidence stays visible. */
export function inspectWeixinInput(session: DshSession, requestId: string): WeixinInputEvidence {
  const ids = new Set<string>(), queues = new Map<string, any[]>();
  for (const event of session.ownEvents()) {
    const collect = (message: any) => { if (message?.source?.kind === 'user' && message.source.rpcId === requestId && typeof message.id === 'string') ids.add(message.id); };
    if (event.type === 'user/message') collect(event.data);
    if (event.type === 'agent/inbox/spliced') {
      const data = event.data, queue = queues.get(data.target) ?? [];
      (data.inserted ?? []).forEach(collect); queue.splice(data.start, data.removedCount ?? 0, ...(data.inserted ?? [])); queues.set(data.target, queue);
    }
  }
  if (ids.size !== 1) return { state: 'unknown', reason: '原输入的持久接纳身份缺失或不唯一，未重新提交。' };
  const id = [...ids][0]!;
  if (canceledInputIds(session).has(id)) return { state: 'canceled', text: '原消息已取消，已保留记录；未重新执行。' };
  const ends = session.ownEvents().filter(event => event.type === 'turn/end' && consumedTurn(session, event.data.turn).requestIds.has(requestId));
  if (ends.length === 1) {
    const end = ends[0]!, kind = end.data.reason?.kind;
    if (kind === 'completed') {
      const last = session.ownEvents().filter(event => event.type === 'assistant/message' && event.data.turn === end.data.turn && !event.data.interrupted).at(-1);
      const text = (last?.data.message?.content ?? []).filter((block: any) => block.type === 'text').map((block: any) => String(block.text ?? '')).join('\n').trim();
      if (text) return { state: 'complete', text, turn: end.data.turn };
    }
    return { state: 'consumed', reason: '原消息已消费，但回合未完整结束；请核对原事项，不自动重办。' };
  }
  if (!ends.length && [...queues.values()].some(queue => queue.some(message => message.id === id))) return { state: 'queued', reason: '原消息仍在宿主持久队列，未重复提交；恢复执行状态待核对。' };
  return { state: 'consumed', reason: '原消息已接纳或消费，当前完成证据不足；未重新提交。' };
}
