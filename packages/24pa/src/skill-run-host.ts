import { mkdir, mkdtemp, realpath, open, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DshAgent, DshContext, DshSession, ContentBlock, SessionHeader, SessionEvent } from './host.js';
import type { SkillRegistryLike } from './skills.js';
import type { SkillRunRow } from './repo/skill-run.js';
import { readSkillFile, skillHash, validateSkillPackage } from './skill-package.js';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { canceledInputIds } from './host-turn.js';

export interface RunInput { id: string; content: ContentBlock[]; source?: { kind?: string; rpcId?: string; name?: string; senderSessionId?: string }; [key: string]: unknown }
interface RunAgent extends DshAgent {
  inbox: { nextTurn: RunInput[]; nextStep: RunInput[]; remove(id: string): boolean };
  runMaintenance<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  followup(message: RunInput): void;
}
export interface RunToolCall { callId: string; rootCallId?: string; agent?: DshAgent; name: string; arguments: Record<string, unknown>; signal: AbortSignal }
export interface RunToolResult { isError?: boolean; content?: ContentBlock[]; value?: unknown; error?: { message?: string; info?: { name?: string; code?: string } } }
export interface RunActivation { runId: string; id: string; provider: string; local: boolean; stopReason?: string; lastAssistantMessage?: ContentBlock[] }
export interface RunDescendant { kind: 'child' | 'diagnostic'; id: string; parentId: string; mode?: 'continuable' | 'one-shot' | 'external'; activity?: string; reason?: string }
export interface RunJob { id: string; owner?: string; status: string; detail?: string }
interface NativeSubagents {
  listDescendants(id: string, signal?: AbortSignal): Promise<RunDescendant[]>;
  listChildren(id: string, signal?: AbortSignal): Promise<{ id: string }[]>;
  drainDescendants(parents: DshAgent[]): Promise<void>;
  sendMessage(parent: DshAgent, id: string, content: ContentBlock[], options: { signal: AbortSignal }): Promise<string>;
}
interface NativeJobs {
  list(owner: string): RunJob[];
  get(id: string, owner: string): RunJob;
  kill(id: string, owner: string, reason: string): unknown;
  wait(id: string, timeout: number, owner: string, signal?: AbortSignal): Promise<RunJob>;
}
interface RunScope {
  skills: SkillRegistryLike;
  tools: { restrict(filter: { allow: string[] }): void; guard(check: (exec: RunToolCall) => string | undefined): void };
  on(event: 'agent/pre-step', listener: (payload: { agent: DshAgent; messages: RunInput[] }, next: () => Promise<unknown>) => Promise<unknown>): void;
  on(event: 'agent/request', listener: (payload: { agent: DshAgent; turn: number; step: number }, next: () => Promise<unknown>) => Promise<unknown>): void;
  on(event: 'tools/execute', listener: (exec: RunToolCall, next: () => Promise<RunToolResult>) => Promise<unknown>): void;
  on(event: 'tools/result', listener: (exec: RunToolCall, result: RunToolResult) => undefined): void;
  on(event: 'subagent/start' | 'subagent/end', listener: (info: RunActivation) => void): void;
}
export interface RunHooks {
  allowed(): boolean;
  authorize(): Promise<void>;
  prepareInput?(session: DshSession, messages: RunInput[]): Promise<RunInput[]>;
  checkBudget?(session: DshSession): Promise<boolean>;
  dispatchModel?(session: DshSession, turn: number, step: number, route: unknown): Promise<void>;
  beforeModel(session: DshSession): Promise<void>;
  restoreInput(id: string): Promise<RunInput>;
  ownsInput(message: RunInput): Promise<boolean>;
  input(message: RunInput, accepted: boolean): Promise<void>;
  block(reason: string): Promise<void>;
  execute(call: RunToolCall, next: () => Promise<RunToolResult>): Promise<unknown>;
  final(call: RunToolCall, result: RunToolResult): void;
  activation(phase: 'start' | 'end', info: RunActivation): void;
}
export const runMarker = (run: SkillRunRow) => `[24PA skill run: ${run.id}]`;
const recoverMarker = (id: string) => `[24PA recover input: ${id}]`;

/** Native Session operations only. Ledger decisions remain in SkillRuns. */
export class SkillRunHost {
  private readonly live = new Map<string, RunAgent>();
  private readonly resources = new Map<string, string>();
  private readonly resumeInputs = new Map<string, Map<string, ContentBlock[]>>();
  constructor(private readonly ctx: DshContext) {}

  ownsInput(run: SkillRunRow, message: RunInput): boolean {
    if (message.source?.kind !== 'user') return false;
    if (run.mode === 'local') return message.source.rpcId === run.request_id;
    return message.content.some(block => block.type === 'text' && block.text === runMarker(run));
  }

  rememberResume(runId: string, requestId: string, content: ContentBlock[]): void {
    const requests = this.resumeInputs.get(runId) ?? new Map<string, ContentBlock[]>();
    requests.set(requestId, content); this.resumeInputs.set(runId, requests);
  }

  canceledInputs(run: SkillRunRow, session: DshSession): Set<string> {
    const canceled = canceledInputIds(session, message => this.recoveryInputId(run, message));
    const owned = new Set<string>();
    for (const event of session.ownEvents()) {
      const messages: RunInput[] = event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : event.type === 'user/message' ? [event.data] : [];
      for (const message of messages) {
        const recovered = this.recoveryInputId(run, message);
        if (recovered) owned.add(recovered);
        if (this.ownsInput(run, message)) owned.add(message.id);
        for (const [requestId, content] of this.resumeInputs.get(run.id) ?? []) {
          const sourceMatches = run.mode === 'local' ? message.source?.kind === 'user' && message.source.rpcId === requestId
            : message.source?.kind === 'agent-message' && message.source.senderSessionId === run.source_session_id;
          const expected = run.mode === 'local' ? content : [{ type: 'text', text: `Agent ${run.source_session_id} sent a message: ` }, ...content];
          if (sourceMatches && isDeepStrictEqual(message.content, expected)) owned.add(message.id);
        }
      }
    }
    // Native context refresh also uses inbox.remove/canceled. It has no
    // authority to cancel an owner's task, even if accepted into its history.
    return new Set([...canceled].filter(id => owned.has(id)));
  }

  async mount(agent: DshAgent, run: SkillRunRow, hooks: RunHooks, descendant = false, tools = run.snapshot.tools): Promise<void> {
    const parent = agent.session.header.parentSession;
    const parentId = typeof parent === 'string' ? parent : parent?.id;
    if (descendant ? !parentId || !this.ownedBy(agent.id, parentId) || agent.session.header.origin !== 'subagent'
      : agent.session.header.cwd !== run.workspace_path || (run.mode === 'local' ? !!parentId : parentId !== run.source_session_id)) throw new Error('Skill 运行的真实会话归属不符。');
    if (!agent.ctx) throw new Error('宿主未提供运行作用域。');
    const resourceBase = run.mode === 'local' ? { kind: 'directory', path: this.resources.get(run.id) ?? await this.materialize(run) }
      : { kind: 'opaque', description: '通过 pa24_work skill_resource 读取本次版本的静态资源。' };
    const def = { ...run.snapshot.definition, source: 'pa24-run', provider: 'pa24-run', resourceBase, invocation: { modelInvocable: true, userInvocable: true } };
    await agent.ctx.plugin({ name: 'pa24-owned-skill-run', inject: ['skills', 'tools'], apply: (scope: RunScope) => {
      if (!scope.skills.registerProvider || !scope.tools.guard) throw new Error('当前宿主缺少受管运行所需的公开 Skill 或工具门禁接口。');
      scope.skills.registerProvider(() => ({ name: 'pa24-run', list: async () => [{ ...def, description: def.description ?? run.snapshot.name, rank: -100, locator: run.id }],
        get: async summary => summary.name === def.name && summary.locator === run.id ? def : undefined }));
      scope.tools.restrict({ allow: tools });
      // The native structured child owns this result channel. It is scoped
      // protocol machinery, not an inherited business/coding capability;
      // restrict() already proves it is visible on this exact child scope.
      const nativeResult = (name: string) => descendant && name === 'structured_output';
      const canceled = () => !descendant && this.canceledInputs(run, agent.session).size > 0;
      scope.tools.guard(exec => exec.agent?.id !== agent.id ? undefined
        : !hooks.allowed() || canceled() ? 'Skill 运行已停止、授权变化或结果待核对。' : !tools.includes(exec.name) && !nativeResult(exec.name) ? '工具未在本次 Skill 授权范围内。' : undefined);
      scope.on('agent/pre-step', async ({ agent: current, messages }, next) => {
        if (current.id !== agent.id) return next();
        if (canceled()) return { kind: 'reject' };
        const replacements = new Map<string, RunInput[]>();
        for (const message of messages) if (hooks.prepareInput) replacements.set(message.id, (await hooks.prepareInput(current.session, [message])));
        const adopted = new Set(agent.session.ownEvents().filter(event => event.type === 'user/message').map(event => event.data.id));
        for (const raw of messages) {
          for (const message of replacements.get(raw.id) ?? [raw]) {
          const id = !descendant && this.recoveryInputId(run, message);
          if (id) {
            const original = await hooks.restoreInput(id);
            replacements.set(raw.id, adopted.has(id) ? [] : [original]);
            // A control wake may overtake a parked original queue entry.
            // The original identity is adopted once at this same boundary.
            if (!adopted.has(id)) (agent as RunAgent).inbox.remove(id);
          }
        }
          }
        const replace = (inputs: RunInput[]) => [...new Map(inputs.flatMap(message => {
          return (replacements.get(message.id) ?? [message]).map(original => [original.id, original] as const);
        })).values()];
        const admitted = replace(messages);
        if (replacements.size && !admitted.length) return { kind: 'reject' };
        let foreign = false;
        for (const message of admitted) {
          const accepted = await hooks.ownsInput(message);
          await hooks.input(message, accepted);
          if (!accepted) foreign = true;
        }
        try {
          if (foreign) throw new Error('专用运行会话收到其他输入，已保存全部输入；请核对后从管理入口续办。');
          if (hooks.checkBudget && !await hooks.checkBudget(current.session)) return { kind: 'reject' };
          await hooks.authorize();
          await this.verifyResources(run);
        } catch (error) { await hooks.block((error as Error).message); return { kind: 'reject' }; }
        const decision = await next() as { kind: 'reject' } | { kind: 'enter'; messages: RunInput[] };
        if (canceled()) return { kind: 'reject' };
        return decision.kind === 'enter' && replacements.size ? { ...decision, messages: replace(decision.messages) } : decision;
      });
      scope.on('tools/execute', async (call, next) => {
        if (call.agent?.id !== agent.id) return next();
        await hooks.authorize();
        await this.verifyResources(run);
        if (canceled()) throw new Error('原输入已取消，未执行新的工具动作。');
        return hooks.execute(call, next);
      });
      scope.on('agent/request', async ({ agent: current, turn, step }, next) => {
        if (current.id !== agent.id) return next();
        await hooks.beforeModel(current.session);
        await hooks.authorize();
        if (canceled()) throw new Error('原输入已取消，未开始新的模型请求。');
        const route = await next();
        await hooks.dispatchModel?.(current.session, turn, step, route);
        return route;
      });
      scope.on('tools/result', (call, result) => { if (call.agent?.id === agent.id) hooks.final(call, result); return undefined; });
      scope.on('subagent/start', info => hooks.activation('start', info));
      scope.on('subagent/end', info => hooks.activation('end', info));
    } }).await();
    this.live.set(agent.id, agent as RunAgent);
  }

  private async materialize(run: SkillRunRow): Promise<string> {
    validateSkillPackage(run.snapshot.package);
    const workspace = await realpath(run.workspace_path);
    if (workspace !== run.workspace_path) throw new Error('原工作区路径已变更。');
    const cache = join(workspace, '.24pa', 'skill-runs');
    await mkdir(cache, { recursive: true, mode: 0o700 });
    if (await realpath(cache) !== cache) throw new Error('Skill 运行缓存不能使用符号链接。');
    const root = await mkdtemp(join(cache, run.id + '-'));
    for (const file of run.snapshot.package.files) {
      const path = join(root, file.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, readSkillFile(run.snapshot.package, file.path), { flag: 'wx', mode: 0o400 });
    }
    this.resources.set(run.id, root);
    return root;
  }
  async verifyResources(run: SkillRunRow): Promise<void> {
    if (run.mode !== 'local') return;
    const root = this.resources.get(run.id);
    if (!root || await realpath(root) !== root) throw new Error('本次 Skill 固定资源不可用。');
    for (const file of run.snapshot.package.files) {
      const path = join(root, file.path);
      if (await realpath(dirname(path)) !== dirname(path)) throw new Error('Skill 资源路径已被替换。');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size !== file.bytes || skillHash(await handle.readFile()) !== file.hash) throw new Error(`Skill 固定资源被修改：${file.path}`);
      } finally { await handle.close(); }
    }
  }
  content(run: SkillRunRow): ContentBlock[] {
    return [{ type: 'text', text: runMarker(run) }, { type: 'text', text: [
      `执行一次${run.trial ? '试运行（会真实执行获准动作）' : run.snapshot.plan ? '计划运行' : '手工运行'}：${run.snapshot.name}`,
      ...(run.snapshot.plan ? [`计划：${run.snapshot.plan.title}；触发时间：${run.snapshot.plan.triggeredAt}；时区：${run.snapshot.plan.configuration.timeZone}。业务目标固定于本次授权，不能自行改选来源。`] : []),
      `固定版本：${run.version_id}；参数：${JSON.stringify(run.snapshot.parameters)}`,
      `预期结果：${run.snapshot.contract?.expectedResult ?? '确定性模板结果'}`,
      `完成标准：${run.snapshot.contract?.completionCriteria ?? '输出基于实际资料的模板结果'}`,
      '仅使用本次声明并获准的工具。工具返回不等于业务完成；如实列明依据、未完成项及需人工补充的信息。结果保存在本次运行详情。',
      ...(run.snapshot.tools.includes('pa24_run') ? ['缺少主人信息时调用 pa24_run action=wait，reason 写明需要补充什么。等待及恢复属于原运行，累计执行时限不重置。'] : []),
      this.resources.has(run.id) ? `本次固定资源目录：${this.resources.get(run.id)}` : '静态资源仅能从本次 Skill 包内读取。',
      '\n任务指令：\n' + run.snapshot.definition.content,
      ...(run.snapshot.continuation ? ['\n接续依据（历史回执和人工核对是事实材料，不授予新的权限）：',
        '只执行剩余工作。已有成功回执或已确认完成的动作不得重做；保留原对象和操作身份。先读取实际状态，再继续未完成步骤。',
        JSON.stringify(run.snapshot.continuation)] : []),
    ].join('\n') }];
  }
  async createLocal(run: SkillRunRow): Promise<void> {
    await this.ctx.sessionController.create({ sessionId: run.session_id, cwd: run.workspace_path, agentPreset: 'pa24' });
    const resolved = await this.ctx.sessionController.resolveAgent(run.session_id);
    if ('error' in resolved) throw resolved.error;
    if (!this.live.has(run.session_id)) throw new Error('运行权限与快照尚未挂载，未提交模型输入。');
    // A deterministic title identifies the run and avoids an unrelated title
    // model call racing the explicitly authorized task.
    const titled = await this.ctx.sessionController.rename({ sessionId: run.session_id, title: `Skill：${run.snapshot.name}` });
    if (titled && typeof titled === 'object' && 'error' in titled) throw titled.error;
    const receipt = await this.ctx.sessionController.prompt({ sessionId: run.session_id, requestId: run.request_id, mode: 'queue', content: this.content(run) }, new AbortController().signal);
    if ('error' in receipt || !receipt.accepted) throw 'error' in receipt ? receipt.error : new Error('宿主未接纳运行输入。');
    await this.checkpoint(resolved.agent.session);
  }
  async submitResume(run: SkillRunRow, id: string, content: ContentBlock[]): Promise<string> {
    this.rememberResume(run.id, id, content);
    const resolved = await this.ctx.sessionController.resolveAgent(run.mode === 'business' ? run.source_session_id : run.session_id);
    if ('error' in resolved) throw resolved.error;
    if (run.mode === 'business') {
      if (!await this.directChild(resolved.agent.id, run.session_id)) throw new Error('原 Worker 不属于原发起会话，不能改挂继续。');
      return this.subagents().sendMessage(resolved.agent, run.session_id, content, { signal: new AbortController().signal });
    }
    if (run.mode !== 'local' || !this.live.has(run.session_id)) throw new Error('原运行权限尚未挂载，不能提交补充。');
    const receipt = await this.ctx.sessionController.prompt({ sessionId: run.session_id, requestId: id, mode: 'queue', content }, new AbortController().signal);
    if ('error' in receipt || !receipt.accepted) throw 'error' in receipt ? receipt.error : new Error('宿主未接纳补充输入。');
    await this.checkpoint(resolved.agent.session);
    const messages = resolved.agent.session.ownEvents().filter(event => event.type === 'agent/inbox/spliced').flatMap(event => event.data.inserted ?? []);
    const accepted = messages.filter(message => message.source?.kind === 'user' && message.source.rpcId === id);
    if (accepted.length !== 1) throw new Error('补充输入尚无唯一原生回执，需核对。');
    return accepted[0].id;
  }
  async checkpoint(session: DshSession): Promise<void> {
    if (!await this.ctx.sessions.flush(session)) throw new Error('宿主尚未确认持久化运行证据。');
  }
  async history(run: SkillRunRow, sessionId = run.session_id): Promise<DshSession | null> {
    const live = this.ctx.sessions.get?.(sessionId);
    if (live) {
      try { await this.checkpoint(live); const events = live.ownEvents().slice(); return { id: live.id, header: live.header, ownEvents: () => events }; }
      catch (error) {
        // Closing a retired session's write handle drains its durable log.
        // Never reuse its older memory snapshot or suppress another failure.
        const retired = error instanceof Error && error.message === `session "${sessionId}" is not live in this store`
          && this.ctx.sessions.get?.(sessionId) !== live;
        if (!(error instanceof Error) || (error.name !== 'SessionHandleClosedError' && !retired)) throw error;
      }
    }
    const store = this.ctx.get('sessionPersistence') as { open(id: string, mode: 'read'): Promise<{ header: SessionHeader & { id: string }; inheritedEventCount: number; read(start: number): Promise<{ events: SessionEvent[] }>; close(): Promise<void> }> } | null;
    if (!store?.open) throw new Error('宿主未提供可核验的持久会话历史。');
    let handle: Awaited<ReturnType<typeof store.open>> | undefined;
    try {
      handle = await store.open(sessionId, 'read');
      const { events } = await handle.read(0), own = events.slice(handle.inheritedEventCount);
      return { id: handle.header.id, header: handle.header, ownEvents: () => own };
    } catch (error) { if ((error as Error).name === 'SessionPersistenceNotFoundError') return null; throw error; }
    finally { await handle?.close(); }
  }
  private subagents(): NativeSubagents { return this.ctx.subagents as unknown as NativeSubagents; }
  private jobs(): NativeJobs | undefined { return this.ctx.get('jobs') as NativeJobs | undefined; }
  ownedBy(id: string, parentId: string): boolean {
    const agents = this.ctx.get('agents') as { get(id: string): DshAgent | undefined; isOwnedBy(id: string, owner: DshAgent): boolean } | undefined;
    const parent = agents?.get(parentId);
    return !!parent && agents!.isOwnedBy(id, parent);
  }
  async descendants(run: SkillRunRow): Promise<RunDescendant[]> {
    if (!this.subagents().listDescendants) throw new Error('宿主缺少原生子任务归属核对接口。');
    return this.subagents().listDescendants(run.session_id);
  }
  async directChild(owner: string, child: string): Promise<boolean> {
    return (await this.subagents().listChildren(owner)).some(row => row.id === child);
  }
  job(id: string, owner: string): RunJob | undefined {
    try { const job = this.jobs()?.get(id, owner); return job?.owner === owner ? job : undefined; }
    catch { return undefined; }
  }
  ownedJobs(owner: string): RunJob[] { return this.jobs()?.list(owner).filter(job => job.owner === owner) ?? []; }
  busy(id: string): boolean {
    const agent = this.live.get(id);
    return !!agent && (agent.status !== 'idle' || !!agent.inbox.nextTurn.length || !!agent.inbox.nextStep.length);
  }
  executing(id: string): boolean { return this.live.get(id)?.status === 'running'; }
  recoveryInputId(run: SkillRunRow, message: RunInput): string | null {
    const text = run.mode === 'local' ? message.content[0]?.text : message.content[1]?.text;
    const id = typeof text === 'string' ? /^\[24PA recover input: ([^\]\r\n]+)\]$/.exec(text)?.[1] : null;
    if (!id) return null;
    if (run.mode === 'local') return message.source?.kind === 'user' && message.source.rpcId === `pa24-recovery:${run.id}:${id}` && message.content.length === 1 ? id : null;
    return run.mode === 'business' && message.source?.kind === 'agent-message' && message.source.senderSessionId === run.source_session_id
      && message.content.length === 2 && message.content[0]?.text === `Agent ${run.source_session_id} sent a message: ` ? id : null;
  }
  resident(id: string): boolean { return !!this.ctx.sessions.get?.(id); }
  attached(id: string): boolean { return this.live.has(id); }
  async assertStopped(run: SkillRunRow, sessions: string[]): Promise<void> {
    if (sessions.some(id => { const agent = this.live.get(id); return agent && agent.status !== 'idle'; })
      || sessions.some(id => this.ownedJobs(id).some(job => ['running', 'stopping'].includes(job.status)))) throw new Error('原生运行或后台作业仍在执行，请先停止并核对。');
    if ((await this.descendants(run)).some(child => child.mode === 'external' && child.activity === 'running')) throw new Error('外部子任务仍在运行，不能确认结束。');
  }
  async stop(run: SkillRunRow): Promise<void> {
    const owners = [run.session_id, ...(await this.descendants(run)).filter(row => row.kind === 'child' && row.mode !== 'external').map(row => row.id)];
    const root = this.live.get(run.session_id);
    // Request every stop before awaiting any one branch. Cancellation is not
    // a receipt of rollback; settlement still checks the producers below.
    const drain = root ? this.subagents().drainDescendants([root]) : Promise.resolve();
    const jobs = this.jobs();
    const stopping = jobs ? owners.flatMap(owner => this.ownedJobs(owner).filter(job => ['running', 'stopping'].includes(job.status)).map(job => {
      try { jobs.kill(job.id, owner, '24私助 Skill 运行已停止'); return jobs.wait(job.id, 1000, owner); }
      catch (error) { return Promise.reject(error); }
    })) : [];
    if (run.mode === 'business') {
      this.ctx.subagents.interrupt(run.session_id, { kind: 'user', parentSessionId: run.source_session_id });
    } else {
      const controller = this.ctx.sessionController as DshContext['sessionController'] & { cancel(request: { sessionId: string }): unknown };
      if (!controller.cancel) throw new Error('宿主不支持停止本地顶层运行。');
      controller.cancel({ sessionId: run.session_id });
    }
    const results = await Promise.allSettled([drain, ...stopping, root?.whenIdle?.()]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    if (root && !await this.history(run)) throw new Error('停止后的原生历史尚不可读取，请继续核对。');
    if (owners.some(owner => this.ownedJobs(owner).some(job => ['running', 'stopping'].includes(job.status)))) throw new Error('原生作业尚未确认结束，请继续核对。');
  }
  async resumePending(run: SkillRunRow, message: RunInput): Promise<void> {
    if (run.mode === 'business') {
      const parent = await this.ctx.sessionController.resolveAgent(run.source_session_id);
      if ('error' in parent) throw parent.error;
      if (!await this.directChild(parent.agent.id, run.session_id)) throw new Error('原 Worker 不属于原发起会话。');
      // Public sendMessage owns cold activation. This control message carries
      // no new business instruction; pre-step restores the durable original
      // message ID, or rejects an already adopted control wake.
      await this.subagents().sendMessage(parent.agent, run.session_id, [{ type: 'text', text: recoverMarker(message.id) }], { signal: new AbortController().signal });
      return;
    }
    const resolved = await this.ctx.sessionController.resolveAgent(run.session_id);
    if ('error' in resolved) throw resolved.error;
    const agent = this.live.get(run.session_id);
    if (!agent?.runMaintenance || !agent.inbox) throw new Error('原运行作用域或输入恢复接口不可用。');
    await agent.runMaintenance(async signal => {
      if (agent.session.ownEvents().some(e => e.type === 'user/message' && e.data.id === message.id)) return;
      signal.throwIfAborted();
      if (this.canceledInputs(run, agent.session).size) throw new Error('原输入已取消，不能重新排队。');
      const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep];
      if (pending.some(item => item.id === message.id && !isDeepStrictEqual(item, message))) throw new Error('原输入身份对应不同内容，需人工核对。');
      // Wake without deleting/reinserting the original: a user's queue
      // cancellation remains durable even when it races SQL recovery claim.
      const wake: RunInput = { id: randomUUID(), role: 'user', source: { kind: 'user', rpcId: `pa24-recovery:${run.id}:${message.id}` }, content: [{ type: 'text', text: recoverMarker(message.id) }] };
      agent.followup(wake);
      await this.checkpoint(agent.session);
      if (signal.aborted) {
        agent.inbox.remove(wake.id); agent.inbox.remove(message.id);
        await this.checkpoint(agent.session); signal.throwIfAborted();
      }
    });
  }
}
