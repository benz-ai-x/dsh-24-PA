import type { ModelBudgets } from './model-budgets.js';
import type { DshAgent, DshSession } from './host.js';
import type { Repos } from './repo.js';
import type { RunInput, RunToolCall, RunToolResult } from './skill-run-host.js';
import { SkillRunClock } from './skill-run-clock.js';
import { beginRunAttempt, blockRun, clearRunBlock, runControlSummary } from './run-control.js';
import { canceledInputIds, consumedTurn, turnHasModelInput } from './host-turn.js';

interface WorkerScope {
  on(event: 'agent/request', listener: (payload: { agent: DshAgent; turn: number; step: number }, next: () => Promise<unknown>) => Promise<unknown>): void;
  on(event: 'agent/pre-step', listener: (payload: { agent: DshAgent; messages: RunInput[] }, next: () => Promise<unknown>) => Promise<unknown>): void;
  on(event: 'tools/execute', listener: (call: RunToolCall, next: () => Promise<RunToolResult>) => Promise<unknown>): void;
}
/** Observes the existing native Worker. It never starts another model or
 * reassigns the Skill execution engine's session ownership. */
export class WorkerRuns {
  private readonly clock: SkillRunClock;
  private readonly activeCalls = new Set<string>();
  private readonly blocked = new Set<string>();
  constructor(private readonly deps: {
    budget?: ModelBudgets;
    lease?<T>(work: () => Promise<T>): Promise<T>;
    context(): { repos: Repos; path: string; binding: string } | null;
    allowed(role: string): boolean;
    expire(workId: string): Promise<void>;
    cancel?(workId: string): Promise<void>;
  }) {
    this.clock = new SkillRunClock(async id => {
      const context = this.deps.context(), run = await context?.repos.workerRuns.get(id);
      if (run && ['running', 'waiting'].includes(run.status)) await this.deps.expire(run.work_item_id);
    });
  }
  dispose(): void { this.clock.dispose(); }
  private async owned(session: DshSession) {
    const context = this.deps.context(); if (!context) return null;
    const item = await context.repos.workItems.get(session.id);
    if (!item || item.execution_mode === 'skill' || !item.active_worker_run_id) return null;
    const run = await context.repos.workerRuns.get(item.active_worker_run_id);
    const parent = session.header.parentSession, parentId = typeof parent === 'string' ? parent : parent?.id;
    if (!run || run.session_id !== session.id || run.snapshot.parentSessionId !== parentId
      || run.snapshot.workspacePath !== context.path || session.header.cwd !== context.path
      || !await context.repos.workItems.ownsExecution(item)) throw new Error('交办运行与当前工作区、原父子会话不符。');
    return { context, item, run };
  }
  private async authorized(agent: DshAgent) {
    const owned = await this.owned(agent.session);
    if (!owned || owned.item.status !== 'running' || owned.run.status !== 'running' || !this.deps.allowed(owned.item.role)) throw new Error('此交办已等待、停止或授权发生变化；未开始新的动作。');
    const control = await owned.context.repos.runControls.get(owned.run.id);
    if (control?.state.blocks.length || control?.state.terminal || control?.state.stop) throw new Error(control.state.blocks.map(block => block.reason).join('；') || '原运行不可继续。');
    try {
      if (this.blocked.has(owned.run.id)) throw new Error('原运行工具回执待核对，不能继续执行。');
      await owned.context.repos.workItems.assertKnownEffects(owned.item.id, true, this.activeCalls);
    }
    catch (error) {
      this.blocked.add(owned.run.id);
      this.clock.disarm(owned.run.id);
      await owned.context.repos.workerRuns.block(owned.run.id, (error as Error).message);
      throw error;
    }
    const canceled = canceledInputIds(agent.session);
    if ((await owned.context.repos.workerRuns.inputs(owned.run.id)).some(input => input.native_message_id && canceled.has(input.native_message_id))) {
      void this.deps.cancel?.(owned.item.id).catch(() => {});
      throw new Error('原交办输入已取消，不能继续执行。');
    }
    return owned;
  }
  async observe(session: DshSession, live = false): Promise<void> {
    const owned = await this.owned(session); if (!owned) return;
    const { run, context } = owned;
    const events = session.ownEvents().filter(event => typeof event.time === 'number' && event.time >= run.snapshot.startedAt);
    for (const input of await context.repos.workerRuns.inputs(run.id)) {
      const candidates: RunInput[] = events.flatMap(event => event.type === 'user/message' ? [event.data as RunInput] : event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : []);
      const accepted = candidates.filter(message => message.content?.some(block => block.type === 'text' && block.text === `[24PA execution: ${input.execution_id}]`)
        && (input.scope.input === 'start' ? message.source?.kind === 'user' : message.source?.kind === 'agent-message' && message.source.senderSessionId === input.scope.parentSessionId));
      const unique = [...new Map(accepted.map(message => [message.id, message])).values()];
      if (unique.length === 1) {
        await context.repos.workerRuns.saveInput(input.execution_id, unique[0]!);
        const turn = events.find(event => ['step/start', 'turn/end'].includes(event.type) && turnHasModelInput(session, event.data.turn) && consumedTurn(session, event.data.turn).messageIds.has(unique[0]!.id))?.data.turn;
        await context.repos.workerRuns.inputReceipt(input.execution_id, turn === undefined ? 'received' : 'adopted', unique[0]!.id, turn);
      }
    }
    await this.clock.observe(context.repos.runControls, run.id, [{ ...session, ownEvents: () => events }], () => live);
  }
  async attach(agent: DshAgent): Promise<void> {
    const owned = await this.owned(agent.session); if (!owned || !agent.ctx) return;
    await agent.ctx.plugin({ name: 'pa24-worker-run-journal', apply: (scope: WorkerScope) => {
      scope.on('agent/pre-step', async ({ agent: current, messages }, next) => {
        if (current.id !== agent.id) return next();
        const active = await this.owned(current.session); if (!active) return { kind: 'reject' };
        const replacements = new Map<string, RunInput[]>();
        for (const message of messages) replacements.set(message.id, this.deps.budget ? (await this.deps.budget.inputs(active.run.id, current.session, [message])) : [message]);
        const replace = (items: RunInput[]) => [...new Map(items.flatMap(message => (replacements.get(message.id) ?? [message]).map(value => [value.id, value] as const))).values()];
        const admitted = replace(messages);
        if (messages.length && !admitted.length) return { kind: 'reject' };
        const inputs = await active.context.repos.workerRuns.inputs(active.run.id);
        for (const message of admitted) {
          const input = inputs.find(input => message.content?.some(block => block.type === 'text' && block.text === `[24PA execution: ${input.execution_id}]`)
            && (input.scope.input === 'start' ? message.source?.kind === 'user' : message.source?.kind === 'agent-message' && message.source.senderSessionId === input.scope.parentSessionId));
          if (input) await active.context.repos.workerRuns.saveInput(input.execution_id, message);
          else if (!await this.deps.budget?.ownsWake(active.run.id, current.id, message)) {
            await active.context.repos.workItems.update(active.item.id, { status: 'needs_reconciliation', progress: '原交办会话收到未关联输入，请通过原交办补充并核对。' });
            return { kind: 'reject' };
          }
        }
        if (messages.some(message => inputs.some(input => input.scope.input !== 'start' && message.content.some(block => block.text === `[24PA execution: ${input.execution_id}]`)))) await this.clearWait(active.item.id);
        if (this.deps.budget && !await this.deps.budget.check(active.run.id, current.session)) { this.clock.disarm(active.run.id); return { kind: 'reject' }; }
        await this.authorized(current);
        const decision = await next() as { kind: 'reject' } | { kind: 'enter'; messages: RunInput[] };
        return decision.kind === 'enter' ? { ...decision, messages: replace(decision.messages) } : decision;
      });
      scope.on('agent/request', async ({ agent: current, turn, step }, next) => {
        if (current.id !== agent.id) return next();
        const active = await this.authorized(current); await this.observe(current.session, true);
        const control = await active.context.repos.runControls.get(active.run.id);
        if (control && control.state.executionMs >= control.state.limitMs) { void this.deps.expire(active.item.id).catch(() => {}); throw new Error('交办累计执行时限已用尽。'); }
        if (control?.state.attempts.length && control.state.attempts.at(-1)!.endedAt !== null) await active.context.repos.runControls.change(active.run.id, state => beginRunAttempt(state));
        const route = await next();
        await this.deps.budget?.check(active.run.id, current.session, { turn, step, route: route as { provider: string; model: string } });
        return route;
      });
      scope.on('tools/execute', async (call, next) => {
        if (call.agent?.id !== agent.id) return next();
        const current = call.agent;
        const execute = async () => {
        const active = await this.authorized(current);
        await this.observe(current.session, true);
        const key = await active.context.repos.workerRuns.call(active.run.id, call.name, call.arguments);
        this.activeCalls.add(key);
        try {
          const result = await next();
          // ToolRuntime returns handler failures as values, including a lost
          // acknowledgement after a write. Only its pre-dispatch cancellation
          // proves that this call did not execute.
          const unknown = (result.isError || call.signal.aborted) && result.error?.info?.code !== 'ABORTED_BEFORE_DISPATCH';
          if (unknown) this.blocked.add(active.run.id);
          await active.context.repos.workerRuns.callResult(key, unknown ? 'unknown' : result.isError ? 'failed' : 'succeeded', result);
          if (unknown) this.clock.disarm(active.run.id);
          // Business tools can return a structured partial result while an
          // external operation remains unknown. That still blocks new steps.
          try { await active.context.repos.workItems.assertKnownEffects(active.item.id, true, this.activeCalls); }
          catch (error) {
            this.blocked.add(active.run.id);
            this.clock.disarm(active.run.id);
            await active.context.repos.workerRuns.block(active.run.id, (error as Error).message);
          }
          return result;
        } catch (error) {
          this.blocked.add(active.run.id);
          this.clock.disarm(active.run.id);
          await active.context.repos.workerRuns.callResult(key, 'unknown', { message: (error as Error).message }).catch(() => {});
          throw error;
        } finally { this.activeCalls.delete(key); }
        };
        return this.deps.lease ? this.deps.lease(execute) : execute();
      });
    } }).await();
  }
  async wait(agent: DshAgent, reason: unknown, kind: unknown = 'input') {
    const active = await this.authorized(agent);
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw new Error('等待须说明所需信息或外部结果。');
    if (!['input', 'external'].includes(String(kind))) throw new Error('等待类型须为主人信息或外部结果。');
    await active.context.repos.runControls.change(active.run.id, state => blockRun(state, { key: String(kind), kind: kind === 'external' ? 'dependency' : 'input', reason }));
    await active.context.repos.workItems.update(active.item.id, { status: 'waiting_input', progress: `${kind === 'external' ? '等待外部结果' : '等待主人补充'}：${reason}` });
    return { runId: active.run.id, status: 'waiting', message: '已保存等待；补充须绑定原交办，未结束运行沿原档案继续。' };
  }
  async progress(agent: DshAgent, input: Record<string, unknown>) {
    const active = await this.authorized(agent);
    const read = (key: string) => { const value = input[key]; if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('请分别填写真实阶段、已完成内容和下一步。'); return value.trim(); };
    const progress = { stage: read('stage'), completed: read('completed'), next: read('next') };
    await active.context.repos.workItems.update(active.item.id, { progress: progress.stage, progress_detail: progress });
    return { runId: active.run.id, progress };
  }
  async clearWait(workId: string): Promise<void> {
    const context = this.deps.context(), run = await context?.repos.workerRuns.current(workId);
    if (!context || !run || !['running', 'waiting'].includes(run.status)) return;
    await context.repos.runControls.change(run.id, state => { clearRunBlock(state, 'input'); clearRunBlock(state, 'external'); });
  }
  async inspect(input: Record<string, unknown>) {
    const context = this.deps.context();
    if (!context || context.binding !== input.workspaceBinding) throw new Error('运行所属工作区已切换。');
    const detail = await context.repos.workerRuns.detail(String(input.runId));
    return { ...detail, work: await context.repos.workItems.get(detail.run.work_item_id), execution: detail.control ? runControlSummary(detail.control.state) : null, workspaceBinding: context.binding };
  }
}
