import type { DshAgent, DshContext, DshSession, SessionEvent, SessionHeader } from './host.js';
import type { Repos } from './repo.js';
import type { RunInput } from './skill-run-host.js';
import type { BudgetOwner, BudgetReleaseRow } from './repo/model-budget.js';
import { budgetHash, budgetUsage, type BudgetConfig } from './model-budget.js';
import { consumedTurn, turnHasModelInput, canceledInputIds } from './host-turn.js';
import { canExecuteRun } from './run-control.js';
const wakeMarker = (id: string) => `[24PA budget wake: ${id}]`;
const adopted = (session: DshSession) => new Set(session.ownEvents().filter(event => event.type === 'turn/end' || event.type === 'step/start')
  .filter(event => turnHasModelInput(session, event.data.turn)).flatMap(event => [...consumedTurn(session, event.data.turn).messageIds])
  .filter(id => session.ownEvents().some(event => event.type === 'user/message' && event.data.id === id)));
interface BudgetContext { repos: Repos; path: string; binding: string; config: BudgetConfig; timeZone: string; maxWorkers: number }
/** Model accounting and releases are independent of result persistence and
 * outbox delivery. No platform action or template runs through this gate. */
export class ModelBudgets {
  private readonly waking = new Set<string>();
  private readonly sent = new Set<string>();
  constructor(private readonly deps: { host: () => DshContext; context(): BudgetContext | null; activate(runId: string): void; detached<T>(work: () => T): T }) {}
  private context(binding?: unknown) { const ctx = this.deps.context(); if (!ctx || (binding !== undefined && ctx.binding !== binding)) throw new Error('预算所属工作区已切换，请刷新。'); return ctx; }
  async owner(session: DshSession): Promise<BudgetOwner | null> {
    const ctx = this.context(); if (session.header.cwd !== ctx.path) return null;
    const item = await ctx.repos.workItems.get(session.id);
    if (item?.execution_mode === 'worker' && item.active_worker_run_id) return { runId: item.active_worker_run_id, workId: item.id, sessionId: session.id, kind: 'worker' };
    const run = await ctx.repos.skillRuns.bySession(session.id);
    return run ? { runId: run.id, workId: run.work_item_id, sessionId: session.id, kind: 'skill' } : null;
  }
  async observe(session: DshSession): Promise<void> {
    const ctx = this.context(), owner = await this.owner(session); if (!owner) return;
    const startedAt = owner.kind === 'worker' ? (await ctx.repos.workerRuns.get(owner.runId))?.snapshot.startedAt ?? 0 : 0;
    let actual: { provider: string; model: string } | undefined;
    for (const [index, event] of session.ownEvents().entries()) {
      if (event.type === 'request/header') actual = event.data.header?.config;
      if (!['assistant/message','assistant/attempt'].includes(event.type) || typeof event.time !== 'number' || event.time < startedAt) continue;
      const source = event.data.message?.source;
      const route = source?.provider && source?.model ? { provider: source.provider, model: source.model } : actual;
      const usage = event.data.usage ?? event.data.stream?.findLast((record: any) => record.type === 'chunk' && record.chunk?.type === 'usage')?.chunk.usage;
      await ctx.repos.modelBudget.event(owner, { id: `${session.id}:${(event as SessionEvent & { seq?: number }).seq ?? index}`, turn: event.data.turn, step: event.data.step,
        at: new Date(event.time).toISOString(), actual: route && { provider: route.provider, model: route.model }, usage: budgetUsage(usage), type: event.type, interrupted: event.data.interrupted === true }, ctx.config);
    }
  }
  async check(runId: string, session: DshSession, request?: { turn: number; step: number; route: { provider: string; model: string } }): Promise<boolean> {
    const ctx = this.context(), owner = await this.owner(session); if (!owner || owner.runId !== runId) throw new Error('无法证明模型请求属于原运行。');
    await this.observe(session);
    const result = await ctx.repos.modelBudget.gate(owner, ctx.config, ctx.timeZone, request);
    if (!result.allowed && request) throw new Error(result.reason ?? '等待预算处理');
    return result.allowed;
  }
  private matches(release: BudgetReleaseRow, session: DshSession, message: RunInput): boolean {
    if (session.id !== release.session_id) return false;
    const parent = session.header.parentSession, parentId = typeof parent === 'string' ? parent : parent?.id;
    return parentId ? message.source?.kind === 'agent-message' && message.source.senderSessionId === parentId && message.content.length === 2
      && message.content[0]?.text === `Agent ${parentId} sent a message: ` && message.content[1]?.text === wakeMarker(release.id)
      : message.source?.kind === 'user' && message.source.rpcId === `pa24-budget:${release.id}` && message.content.length === 1 && message.content[0]?.text === wakeMarker(release.id);
  }
  async ownsWake(runId: string, sessionId: string, message: RunInput): Promise<boolean> {
    return (await this.context().repos.modelBudget.releases(runId)).some(row => row.session_id === sessionId && row.native_message_id === message.id);
  }
  async inputs(runId: string, session: DshSession, messages: RunInput[]): Promise<RunInput[]> {
    const ctx = this.context(), releases = await ctx.repos.modelBudget.releases(runId), result: RunInput[] = [];
    for (const message of messages) {
      const release = releases.find(row => this.matches(row, session, message));
      if (!release) { result.push(message); continue; }
      if (release.status !== 'ready') continue; // stale wake cannot spend another release
      const canonical = release.record.control ?? message;
      await ctx.repos.modelBudget.acceptedWake(release.id, canonical);
      const originals = (release.record.originals ?? []).filter(original => !adopted(session).has(original.id));
      if (originals.length) {
        if (originals.some(original => canceledInputIds(session).has(original.id))) throw new Error('原输入已取消，预算放行不能重新采用。');
        result.push(...originals);
      } else result.push({ ...canonical, content: [{ type: 'text', text: '主人已明确放行本运行的下一次模型请求。沿原会话继续剩余工作，先核对已有工具回执，不重做已完成动作。' }] });
    }
    return [...new Map(result.map(message => [message.id, message])).values()];
  }
  async snapshot(input: Record<string, unknown> = {}) {
    const ctx = this.context(input.workspaceBinding), summary = await ctx.repos.modelBudget.summary(ctx.config, ctx.timeZone);
    const waiting = [];
    for (const row of await ctx.repos.modelBudget.waiters()) {
      const control = await ctx.repos.runControls.get(row.run_id), owner = await ctx.repos.modelBudget.owner(row.run_id);
      if (!owner || !['running','waiting'].includes(owner.status) || !control || control.state.terminal) continue;
      if (!control.state.blocks.some(block => block.kind === 'budget')) continue;
      const work = await ctx.repos.workItems.get(row.work_item_id);
      waiting.push({ ...row, title: work?.title ?? row.work_item_id, blocks: control.state.blocks });
    }
    return { ...summary, waiting, config: ctx.config, fingerprint: budgetHash(ctx.config), workspaceBinding: ctx.binding,
      coverage: '本工作区受管 Skill 及普通助理交办的原生模型请求；不含自由对话、外部 CLI、TTS 或升级前未记录请求。',
      basis: '宿主持久 Session 事件与派发意向按身份去重。费用使用请求时保存的每百万 token 价格；估算不是供应商账单，未知不按零计算。',
      notice: '仅暂停新的受管模型请求；已发请求可能继续计费，原生日历提醒、已完成结果保存与投递继续。' };
  }
  async grant(input: Record<string, unknown>) {
    const ctx = this.context(input.workspaceBinding);
    if (input.confirm !== true || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestId) || input.scope !== 'next-model-request') throw new Error('请确认仅放行原交办／运行指定会话的下一次模型请求。');
    const release = await ctx.repos.modelBudget.grant({ id: input.requestId, hash: budgetHash(input), runId: String(input.runId), workId: String(input.workId), sessionId: String(input.sessionId) });
    await this.poll(); return { release: await ctx.repos.modelBudget.release(release.id), message: '一次放行已保存，只解除预算阻断；其他阻断、授权与时限继续生效。' };
  }
  private async history(id: string): Promise<DshSession | null> {
    const live = this.deps.host().sessions.get?.(id);
    if (live) { if (!await this.deps.host().sessions.flush(live)) throw new Error('宿主尚未持久化原运行。'); return live; }
    const store = this.deps.host().get('sessionPersistence') as { open(id: string, mode: 'read'): Promise<{ header: SessionHeader & { id: string }; inheritedEventCount: number; read(start: number): Promise<{ events: SessionEvent[] }>; close(): Promise<void> }> } | null;
    if (!store) throw new Error('宿主缺少持久历史读取接口。');
    let handle: Awaited<ReturnType<typeof store.open>> | undefined;
    try { handle = await store.open(id, 'read'); const { events } = await handle.read(0); return { id: handle.header.id, header: handle.header, ownEvents: () => events.slice(handle!.inheritedEventCount) }; }
    catch (error) { if ((error as Error).name === 'SessionPersistenceNotFoundError') return null; throw error; }
    finally { await handle?.close(); }
  }
  async poll(): Promise<void> {
    const ctx = this.context();
    for (const sessionId of new Set((await ctx.repos.modelBudget.requests()).filter(row => !row.event_id).map(row => row.session_id))) {
      const history = await this.history(sessionId); if (history) await this.observe(history);
    }
    for (const release of await ctx.repos.modelBudget.releases()) {
      if (release.status !== 'ready' || this.waking.has(release.id) || this.sent.has(release.id)) continue;
      this.waking.add(release.id);
      try {
        const owner = await ctx.repos.modelBudget.owner(release.run_id), control = await ctx.repos.runControls.get(release.run_id);
        if (!owner || !['running','waiting'].includes(owner.status) || !control || !canExecuteRun(control.state) || control.state.stop) continue;
        const agents = this.deps.host().get('agents') as { get?(id: string): DshAgent & { inbox?: { nextTurn: RunInput[]; nextStep: RunInput[] } } } | null;
        const live = agents?.get?.(release.session_id);
        if (live && (live.status !== 'idle' || live.inbox?.nextTurn.length || live.inbox?.nextStep.length)) continue;
        const history = await this.history(release.session_id);
        if (!history || history.header.cwd !== ctx.path) throw new Error('原会话历史或工作区归属无法核验。');
        await this.observe(history);
        await ctx.repos.workItems.assertKnownEffects(owner.workId, true);
        if (owner.kind === 'skill' && (await ctx.repos.skillRuns.calls(owner.runId)).some(call => ['running','unknown'].includes(call.status))) throw new Error('原运行工具动作待核对。');
        const candidates = owner.kind === 'worker' ? (await ctx.repos.workerRuns.inputs(owner.runId)).flatMap(row => row.message ? [row.message] : [])
          : (await ctx.repos.skillRuns.inputs(owner.runId)).filter(row => row.accepted && row.session_id === release.session_id).map(row => row.message as RunInput);
        const canceled = canceledInputIds(history), adoptedIds = adopted(history);
        if (candidates.some(row => canceled.has(row.id))) throw new Error('原输入已取消，不能预算恢复。');
        const originals = candidates.filter(row => !adoptedIds.has(row.id));
        const alreadyAdoptedWake = release.native_message_id && adoptedIds.has(release.native_message_id);
        if (alreadyAdoptedWake) continue;
        if (!release.record.wake && !await ctx.repos.modelBudget.claimWake(release, originals, ctx.maxWorkers)) continue;
        this.deps.activate(owner.runId);
        const parent = history.header.parentSession, parentId = typeof parent === 'string' ? parent : parent?.id;
        if (parentId) {
          const parentAgent = await this.deps.host().sessionController.resolveAgent(parentId); if ('error' in parentAgent) throw parentAgent.error;
          const children = await this.deps.host().subagents.listChildren(parentId) as Array<{ id: string }>;
          if (!children.some(child => child.id === release.session_id)) throw new Error('预算恢复不能改变原父子会话。');
          await this.deps.detached(() => this.deps.host().subagents.sendMessage(parentAgent.agent, release.session_id, [{ type: 'text', text: wakeMarker(release.id) }], { signal: new AbortController().signal }));
        } else {
          const response = await this.deps.detached(() => this.deps.host().sessionController.prompt({ sessionId: release.session_id, requestId: `pa24-budget:${release.id}`, mode: 'queue', content: [{ type: 'text', text: wakeMarker(release.id) }] }, new AbortController().signal));
          if ('error' in response || !response.accepted) throw 'error' in response ? response.error : new Error('宿主未接纳预算恢复信号。');
        }
        this.sent.add(release.id);
      } catch (error) { await ctx.repos.modelBudget.wakeError(release.id, (error as Error).message); }
      finally { this.waking.delete(release.id); }
    }
  }
}
