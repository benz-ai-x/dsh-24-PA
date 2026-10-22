import { mkdir, mkdtemp, realpath, open, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DshAgent, DshContext, DshSession, ContentBlock, SessionHeader, SessionEvent } from './host.js';
import type { SkillRegistryLike } from './skills.js';
import type { SkillRunRow } from './repo/skill-run.js';
import { readSkillFile, skillHash, validateSkillPackage } from './skill-package.js';
import { consumedTurn } from './host-turn.js';

export interface RunInput { id: string; content: ContentBlock[]; source?: { kind?: string; rpcId?: string; name?: string; senderSessionId?: string }; [key: string]: unknown }
interface RunAgent extends DshAgent {
  inbox: { nextTurn: RunInput[]; nextStep: RunInput[]; remove(id: string): boolean };
  runMaintenance<T>(work: () => Promise<T>): Promise<T>;
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
  on(event: 'agent/request', listener: (payload: { agent: DshAgent }, next: () => Promise<unknown>) => Promise<unknown>): void;
  on(event: 'tools/execute', listener: (exec: RunToolCall, next: () => Promise<RunToolResult>) => Promise<unknown>): void;
  on(event: 'tools/result', listener: (exec: RunToolCall, result: RunToolResult) => undefined): void;
  on(event: 'subagent/start' | 'subagent/end', listener: (info: RunActivation) => void): void;
}
export interface RunHooks {
  allowed(): boolean;
  authorize(): Promise<void>;
  beforeModel(session: DshSession): Promise<void>;
  ownsInput(message: RunInput): Promise<boolean>;
  input(message: RunInput, accepted: boolean): Promise<void>;
  block(reason: string): Promise<void>;
  execute(call: RunToolCall, next: () => Promise<RunToolResult>): Promise<unknown>;
  final(call: RunToolCall, result: RunToolResult): void;
  activation(phase: 'start' | 'end', info: RunActivation): void;
}
export const runMarker = (run: SkillRunRow) => `[24PA skill run: ${run.id}]`;

/** Native Session operations only. Ledger decisions remain in SkillRuns. */
export class SkillRunHost {
  private readonly live = new Map<string, RunAgent>();
  private readonly resources = new Map<string, string>();
  constructor(private readonly ctx: DshContext) {}

  ownsInput(run: SkillRunRow, message: RunInput): boolean {
    if (message.source?.kind !== 'user') return false;
    if (run.mode === 'local') return message.source.rpcId === run.request_id;
    return message.content.some(block => block.type === 'text' && block.text === runMarker(run));
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
      scope.tools.guard(exec => exec.agent?.id !== agent.id ? undefined
        : !hooks.allowed() ? 'Skill 运行已停止、授权变化或结果待核对。' : !tools.includes(exec.name) && !nativeResult(exec.name) ? '工具未在本次 Skill 授权范围内。' : undefined);
      scope.on('agent/pre-step', async ({ agent: current, messages }, next) => {
        if (current.id !== agent.id) return next();
        let foreign = false;
        for (const message of messages) {
          const accepted = await hooks.ownsInput(message);
          await hooks.input(message, accepted);
          if (!accepted) foreign = true;
        }
        try {
          if (foreign) throw new Error('专用运行会话收到其他输入，已保存全部输入；请核对后从管理入口续办。');
          await hooks.authorize();
          await this.verifyResources(run);
        } catch (error) { await hooks.block((error as Error).message); return { kind: 'reject' }; }
        return next();
      });
      scope.on('tools/execute', async (call, next) => {
        if (call.agent?.id !== agent.id) return next();
        await hooks.authorize();
        await this.verifyResources(run);
        return hooks.execute(call, next);
      });
      scope.on('agent/request', async ({ agent: current }, next) => {
        if (current.id !== agent.id) return next();
        await hooks.beforeModel(current.session);
        await hooks.authorize();
        return next();
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
      `执行一次${run.trial ? '试运行（会真实执行获准动作）' : '手工运行'}：${run.snapshot.name}`,
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
        // A child can leave its live scope during this await. Only that
        // closed-handle race falls back to the durable file; other flush
        // failures remain failures, never evidence of completion.
        if (!(error instanceof Error) || error.name !== 'SessionHandleClosedError') throw error;
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
    if (root) await this.checkpoint(root.session);
    if (owners.some(owner => this.ownedJobs(owner).some(job => ['running', 'stopping'].includes(job.status)))) throw new Error('原生作业尚未确认结束，请继续核对。');
  }
  async resumePending(run: SkillRunRow, remember: (message: RunInput) => Promise<void>): Promise<void> {
    if (run.mode !== 'local') throw new Error('业务 Worker 的未完成输入需核对原会话后接续。');
    const resolved = await this.ctx.sessionController.resolveAgent(run.session_id);
    if ('error' in resolved) throw resolved.error;
    const agent = this.live.get(run.session_id);
    if (!agent?.runMaintenance || !agent.inbox) throw new Error('原运行作用域或输入恢复接口不可用。');
    await agent.runMaintenance(async () => {
      const events = agent.session.ownEvents();
      const consumed = events.filter(e => e.type === 'turn/start').some(e => consumedTurn(agent.session, e.data.turn).requestIds.has(run.request_id));
      if (consumed) throw new Error('原输入已有消费记录，不能自动重发。');
      const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep];
      if (pending.some(message => !this.ownsInput(run, message)) || pending.length > 1) throw new Error('原输入不唯一或混入其他输入，需人工核对。');
      const message = pending[0] ?? run.recovery?.message as RunInput | undefined;
      if (!message || !this.ownsInput(run, message) || typeof message.id !== 'string') throw new Error('没有可核验的原输入恢复意图。');
      await remember(message);
      if (pending.length && !agent.inbox.remove(message.id)) throw new Error('原输入队列已变化。');
      agent.followup(message);
      await this.checkpoint(agent.session);
    });
  }
}
