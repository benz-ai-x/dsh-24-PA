import type { DshAgent, DshContext, DshSession, ContentBlock } from './host.js';
import type { Repos, SkillRunRow, SkillRunSnapshot, SkillRunReview } from './repo.js';
import type { SkillPackages } from './skill-packages.js';
import type { SkillDefinitionLike } from './skills.js';
import { skillContract, skillHash, skillParameters, readSkillFile, parseSkillMarkdown } from './skill-package.js';
import { SkillRunHost, type RunInput, type RunToolCall, type RunToolResult } from './skill-run-host.js';
import { consumedTurn } from './host-turn.js';
import { SkillRunNative, uncertainTool } from './skill-run-native.js';
import { skillDelegationTools } from './local-tool-access.js';
import { skillRequirements } from './skill-requirements.js';

interface RunContext { binding: string; cwd: string; repos: Repos }
interface SkillRunsDeps {
  host: DshContext;
  context(): RunContext | null;
  packages: SkillPackages;
  sourceSession(): Promise<string>;
  tools(mode: 'local' | 'business'): Promise<string[]>;
  permissionHash(): string;
  checkBusiness(name: string, actions: string[]): void;
  startBusiness(run: SkillRunRow, content: ContentBlock[]): Promise<void>;
  template(def: SkillDefinitionLike, parameters: Record<string, unknown>): Promise<string>;
  checkTemplate(def: SkillDefinitionLike): void;
  lease<T>(work: () => Promise<T>): Promise<T>;
  detached<T>(work: () => T): T;
}
const requestId = (id: unknown): string => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(id)) throw new Error('缺少有效的运行操作标识。');
  return id;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Manual run admission, native evidence, and WorkItem settlement share one
 * durable identity. UI callers never turn host acceptance into completion. */
export class SkillRuns {
  private readonly host: SkillRunHost;
  private readonly native: SkillRunNative;
  private readonly active = new Map<string, { run: SkillRunRow; binding: string; allowed: boolean }>();
  private readonly settling = new Map<string, Promise<void>>();
  private recovering = false;
  constructor(private readonly deps: SkillRunsDeps) { this.host = new SkillRunHost(deps.host); this.native = new SkillRunNative(this.host); }
  private context(binding?: unknown): RunContext {
    const context = this.deps.context();
    if (!context || (binding !== undefined && context.binding !== binding)) throw new Error('运行所属工作区已切换或尚未就绪。');
    return context;
  }
  async codingTools(agent: DshAgent): Promise<string[] | null> {
    const context = this.deps.context();
    const parent = agent.session.header.parentSession, parentId = typeof parent === 'string' ? parent : parent?.id;
    if (!context || !parentId || agent.session.header.origin !== 'subagent' || !this.host.ownedBy(agent.id, parentId)) return null;
    const run = await context.repos.skillRuns.bySession(parentId);
    if (!run || run.mode !== 'local' || await context.repos.workItems.get(agent.id)) return null;
    return skillDelegationTools(run.snapshot.tools);
  }
  private view(run: SkillRunRow) {
    const { snapshot, ...row } = run;
    return { ...row, name: snapshot.name, parameters: snapshot.parameters, tools: snapshot.tools, contract: snapshot.contract,
      packageHash: snapshot.package.hash, files: snapshot.package.files.map(({ content: _content, ...file }) => file) };
  }
  async list(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding);
    const skillId = typeof input.id === 'string' && input.id.startsWith('managed:') ? input.id.slice(8) : undefined;
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
    return { ...await context.repos.skillRuns.list(skillId, offset, 20), workspaceBinding: context.binding };
  }
  async inspect(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), run = await context.repos.skillRuns.get(String(input.runId));
    if (!run) throw new Error('运行记录不存在。');
    return { run: this.view(run), ...await context.repos.skillRuns.evidence(run.id),
      unresolvedOperations: await context.repos.skillRuns.unresolvedOperations(run.work_item_id), workspaceBinding: context.binding };
  }
  private async prepare(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding);
    const previous = input.rerunId ? await context.repos.skillRuns.get(String(input.rerunId)) : null;
    if (input.rerunId && !previous) throw new Error('原运行不存在。');
    const id = previous ? `managed:${previous.skill_id}` : input.id;
    const entry = typeof id === 'string' && id.startsWith('managed:') ? await context.repos.skills.get(id.slice(8)) : null;
    if (!entry) throw new Error('请先将文件或内置原件复制为个人 Skill，再预览运行。');
    if (entry.status === 'disabled' || entry.status === 'deleted') throw new Error('Skill 已禁用或删除，不能开始新运行。');
    if (!previous) await context.repos.skillRuns.checkNewWork(entry.id);
    if (previous && previous.workspace_path !== context.cwd) throw new Error('原工作区环境无法恢复，请核对原记录。');
    const original = previous && input.configuration === 'original';
    const versionId = original ? previous.version_id : previous ? entry.active_version : String(input.versionId ?? entry.active_version ?? entry.draft_version);
    if (!versionId) throw new Error('此 Skill 尚未启用。');
    const pkg = original ? previous.snapshot.package : await this.deps.packages.capture(id, versionId, context.binding);
    const definition = original ? previous.snapshot.definition : parseSkillMarkdown(readSkillFile(pkg, 'SKILL.md').toString('utf8'));
    const problems = await this.deps.packages.check(definition, pkg);
    if (problems.length) throw new Error(problems.join('\n'));
    if (['worker-persona', 'setup'].includes(String(definition.metadata?.kind)) || definition.name.startsWith('worker-persona-') || definition.name.endsWith('-setup-flow')) throw new Error('职责与接入向导不能作为普通任务运行；向导请通过本地对话办理。');
    const contract = skillContract(definition);
    const mode: 'local' | 'business' | 'template' | undefined = definition.metadata?.track === 'template' ? 'template' : contract?.mode;
    if (!mode) throw new Error('请补齐任务的参数、执行范围、预期结果与完成标准。');
    if (mode === 'template') this.deps.checkTemplate(definition);
    const parameters = original ? previous.snapshot.parameters : contract ? skillParameters(contract, input.parameters ?? previous?.snapshot.parameters ?? {}) : {};
    const tools = mode === 'template' ? [] : definition.metadata?.tools;
    if (!Array.isArray(tools) || tools.some(t => typeof t !== 'string')) throw new Error('请明确声明 metadata.tools；空数组表示不使用工具。');
    const available = mode === 'template' ? [] : await this.deps.tools(mode);
    const missing = tools.filter(tool => !available.includes(tool));
    if (missing.length) throw new Error(`当前身份不具备工具：${missing.join('、')}。`);
    if (mode === 'business') this.deps.checkBusiness(entry.name, contract?.actions ?? []);
    const sourceSessionId = previous?.source_session_id ?? await this.deps.sourceSession();
    const snapshot: SkillRunSnapshot = { name: entry.display_name, definition: { ...definition, name: entry.name }, package: pkg, contract,
      parameters, tools: [...new Set(tools)], permissionHash: this.deps.permissionHash() };
    if (previous) {
      const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
      if (instruction.length > 4000) throw new Error('接续说明最多 4000 字符。');
      snapshot.continuation = { fromRunId: previous.id, instruction, runs: await context.repos.skillRuns.continuation(previous.id) };
    }
    return { context, entry, versionId, mode, snapshot, sourceSessionId, previous, original: !!original };
  }
  async preview(input: Record<string, unknown>) {
    const prepared = await this.prepare(input);
    const { entry, versionId, mode, snapshot, sourceSessionId, context } = prepared;
    return { entry, versionId, mode, name: snapshot.name, parameters: snapshot.parameters, tools: snapshot.tools, contract: snapshot.contract,
      files: snapshot.package.files.map(({ content: _content, ...file }) => file), sourceSessionId, continuation: snapshot.continuation,
      fingerprint: skillHash(JSON.stringify([entry.revision, versionId, snapshot, sourceSessionId])), workspaceBinding: context.binding,
      message: mode === 'template' ? '此模板按确定性规则生成结果，不调用模型。' : '预览只检查配置，不执行任务。试运行与正式运行都会实际调用获准工具，可能修改文件或外部对象。结果默认保存在运行记录。' };
  }
  async start(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), id = requestId(input.requestId), hash = skillHash(JSON.stringify(input));
    const repeated = await context.repos.skillRuns.repeated(id, hash);
    if (repeated) return { run: this.view(repeated), repeated: true, workspaceBinding: context.binding };
    const prepared = await this.prepare(input);
    const fingerprint = skillHash(JSON.stringify([prepared.entry.revision, prepared.versionId, prepared.snapshot, prepared.sourceSessionId]));
    if (input.confirm !== true || input.fingerprint !== fingerprint) throw new Error('内容、权限或参数已改变，请重新预览并确认本次真实执行。');
    const run = await context.repos.skillRuns.admit({ request_id: id, request_hash: hash, skill_id: prepared.entry.id, version_id: prepared.versionId,
      source_session_id: prepared.sourceSessionId, workspace_path: context.cwd, mode: prepared.mode, trial: input.trial === true,
      snapshot: prepared.snapshot, expectedRevision: prepared.entry.revision, workItemId: prepared.previous?.work_item_id, originalRerun: prepared.original });
    // The host owns the model lifetime. A lease covers admission and each
    // tool intent/receipt, rather than holding configuration changes forever.
    const launched = await this.launch(run);
    return { run: this.view((await context.repos.skillRuns.get(run.id))!), repeated: !launched, workspaceBinding: context.binding };
  }
  private async launch(run: SkillRunRow): Promise<boolean> {
    const context = this.context(), repo = context.repos.skillRuns;
    if (!await repo.claimLaunch(run.id, run.mode === 'template' ? '正在生成确定性结果' : '正在提交原生运行')) return false;
    try {
      if (run.mode === 'template') {
        const result = await this.deps.template(run.snapshot.definition, run.snapshot.parameters);
        await repo.transition(run.id, 'completed', '模板已生成；未调用模型，未请求投递', result);
      } else if (run.mode === 'local') await this.deps.detached(() => this.host.createLocal(run));
      else await this.deps.detached(() => this.deps.startBusiness(run, this.host.content(run)));
    } catch (error) {
      const native = await this.host.history(run).catch(() => undefined);
      await this.block(run, `启动未完成：${errorText(error)}${native ? '；请核对原会话，不重复提交。' : ''}`);
    }
    return true;
  }
  async attach(agent: DshAgent): Promise<void> {
    const context = this.deps.context();
    if (!context) return;
    const repo = context.repos.skillRuns;
    const parent = agent.session.header.parentSession, parentId = typeof parent === 'string' ? parent : parent?.id;
    const run = await repo.bySession(agent.id) ?? (parentId && this.host.ownedBy(agent.id, parentId) ? await repo.bySession(parentId) : null);
    if (!run) {
      if (agent.id.startsWith('pa24-skill-')) throw new Error('找不到此会话在当前工作区的运行归属。');
      return;
    }
    const descendant = agent.id !== run.session_id;
    if (descendant) {
      if (!parentId || !this.host.ownedBy(agent.id, parentId) || agent.session.header.origin !== 'subagent' || !agent.session.header.cwd) throw new Error('原生子任务的真实父会话不符。');
      await repo.child(run.id, agent.id, parentId, agent.session.header.cwd);
    }
    let state = this.active.get(run.id);
    if (!state) {
      state = { run, binding: context.binding, allowed: run.status === 'running' };
      this.active.set(run.id, state);
      const unknown = (await repo.calls(run.id)).some(call => ['running', 'unknown'].includes(call.status));
      if (unknown) { state.allowed = false; await this.block(run, '上次工具执行缺少确定回执，须先核对实际结果。'); }
    }
    const owner = state;
    // pa24_delegate already admitted a separate business WorkItem with its
    // own role/action gates. Observing that Worker must preserve those gates.
    const delegatedWork = descendant ? await context.repos.workItems.get(agent.id) : null;
    await this.host.mount(agent, run, {
      allowed: () => owner.allowed && this.deps.context()?.binding === owner.binding && this.deps.permissionHash() === run.snapshot.permissionHash,
      authorize: () => this.authorize(run, owner.binding),
      ownsInput: message => this.native.ownsInput(repo, run, agent.id, message),
      input: (message, accepted) => repo.input(run.id, message, accepted, agent.id),
      block: reason => this.block(run, reason),
      execute: (call, next) => this.deps.lease(() => this.execute(run, owner.binding, call, next)),
      final: (call, result) => this.native.final(repo, run, call, result),
      activation: (phase, info) => this.native.activation(repo, run, agent.id, phase, info),
    }, descendant, delegatedWork ? ['pa24_work', 'pa24_memory'] : run.snapshot.tools);
  }
  private async authorize(run: SkillRunRow, binding: string): Promise<void> {
    const context = this.context(binding), current = await context.repos.skillRuns.get(run.id);
    if (this.active.get(run.id)?.allowed === false || current?.status !== 'running' || this.deps.permissionHash() !== run.snapshot.permissionHash) throw new Error('运行已停止或当前身份／授权发生变化，需核对后接续。');
    const missing = await skillRequirements(run.snapshot.definition, run.snapshot.package);
    if (missing.length) {
      await this.block(run, missing.join('\n'));
      throw new Error(missing.join('\n'));
    }
    for (const prior of run.snapshot.continuation?.runs ?? []) {
      const evidence = await context.repos.skillRuns.evidence(prior.id);
      if (!evidence.reviewed && (evidence.reviews.length || evidence.calls.some(call => ['running', 'unknown'].includes(call.status)))) {
        await this.block(run, '原运行收到新的未决回执，已阻止接续的新动作，请先核对。');
        throw new Error('原运行有新的未决结果。');
      }
    }
    if (run.mode === 'business') this.deps.checkBusiness(run.snapshot.definition.name, run.snapshot.contract?.actions ?? []);
  }
  private async execute(run: SkillRunRow, binding: string, call: RunToolCall, next: () => Promise<RunToolResult>) {
    const context = this.context(binding), repo = context.repos.skillRuns;
    await this.authorize(run, binding);
    await repo.beginCall(run.id, call.callId, call.name, call.arguments, call.agent?.id, call.rootCallId);
    try {
      // A native subagent/job outlives this tool call. Its callbacks acquire
      // their own workspace leases instead of inheriting this expired one.
      const result = await this.deps.detached(next);
      const unknown = uncertainTool(result, call.signal.aborted);
      await repo.finishCall(run.id, call.callId, result, unknown ? 'unknown' : result.isError ? 'failed' : 'returned', call.agent?.id);
      if (unknown) await this.block(run, '工具执行中断，已发生的动作和结果需要核对；未将取消视为撤销。');
      return result;
    } catch (error) {
      await repo.finishCall(run.id, call.callId, { error: errorText(error) }, 'unknown', call.agent?.id).catch(() => {});
      await this.block(run, `工具执行或保存回执未确认：${errorText(error)}`);
      throw error;
    }
  }
  private async block(run: SkillRunRow, reason: string): Promise<void> {
    const state = this.active.get(run.id); if (state) state.allowed = false;
    await this.context().repos.skillRuns.transition(run.id, 'needs_reconciliation', reason);
  }
  async onSession(session: DshSession): Promise<boolean> {
    const context = this.deps.context();
    if (!context || (!this.host.attached(session.id) && !session.id.startsWith('pa24-skill-'))) return false;
    // Native evidence survives even a total SQL outage. Ordinary WorkItems
    // keep their existing checkpoint path without an extra SQL dependency.
    try { await this.host.checkpoint(session); }
    catch (error) { if (!(error instanceof Error) || error.name !== 'SessionHandleClosedError') throw error; }
    const run = await context.repos.skillRuns.bySession(session.id);
    if (run) await this.reconcile(run);
    return !!run && (run.session_id === session.id || !await context.repos.workItems.get(session.id));
  }
  private reconcile(run: SkillRunRow, recovering = false): Promise<void> {
    const prior = this.settling.get(run.id); if (prior) return prior;
    const work = this.settle(run, recovering).finally(() => this.settling.delete(run.id));
    this.settling.set(run.id, work); return work;
  }
  private async settle(run: SkillRunRow, recovering: boolean): Promise<void> {
    const context = this.context(), repo = context.repos.skillRuns;
    const fresh = await repo.get(run.id);
    if (!fresh || !['pending', 'running', 'stopping'].includes(fresh.status)) return;
    try { await this.native.flush(run.id); }
    catch (error) { return this.block(run, errorText(error)); }
    const calls = await repo.calls(run.id);
    if (calls.some(call => call.status === 'unknown' || (recovering && call.status === 'running'))) return this.block(run, '工具结果待核对；停止或重启不抹除已经发生的动作。');
    let observation;
    try { observation = await this.native.observe(repo, run, recovering); }
    catch (error) { return this.block(run, errorText(error)); }
    const history = observation.root;
    if (!history) {
      if (recovering && fresh.status === 'pending') { await this.launch(run); return; }
      if (recovering) await this.block(run, '没有可核验的原运行历史，请先核对实际结果。');
      return;
    }
    const parent = history.header.parentSession, parentId = typeof parent === 'string' ? parent : parent?.id;
    if (history.id !== run.session_id || history.header.cwd !== run.workspace_path || (run.mode === 'business' ? parentId !== run.source_session_id : !!parentId)) return this.block(run, '原会话的身份或工作区归属不符。');
    const events = history.ownEvents(), original = new Set<string>();
    for (const event of events) {
      if (event.type === 'user/message' && this.host.ownsInput(run, event.data as RunInput)) original.add(event.data.id);
      if (event.type === 'agent/inbox/spliced') for (const message of event.data.inserted ?? []) if (this.host.ownsInput(run, message)) original.add(message.id);
    }
    const accepted = new Set((await repo.inputs(run.id)).filter(input => input.accepted && input.session_id === run.session_id).map(input => input.message_id));
    const ends = events.filter(event => event.type === 'turn/end' && [...consumedTurn(history, event.data.turn).messageIds].some(id => accepted.has(id)));
    if (original.size > 1) return this.block(run, '原输入不唯一，需要核对。');
    if (!ends.length) {
      if (recovering && fresh.status === 'running') {
        try { await this.host.resumePending(run, message => repo.recovery(run.id, message)); }
        catch (error) { await this.block(run, `恢复原输入未完成：${errorText(error)}`); }
      }
      return;
    }
    if (observation.pending || calls.some(call => call.status === 'running')) return;
    if ((await repo.unresolvedOperations(run.work_item_id)).length) return this.block(run, '关联外部动作尚无确定回执，须先核对实际对象；不能通过重跑绕过。');
    const deliveries = await repo.nativeDeliveries(run.id);
    if (deliveries.some(row => ['unknown', 'failed'].includes(row.status))) return this.block(run, '关联业务交办的结果回传未确认，请核对原投递记录。');
    if (deliveries.some(row => row.status !== 'sent')) return;
    const terminal = ends.at(-1)!, kind = terminal.data.reason?.kind;
    if (!['completed', 'error', 'aborted', 'blocked', 'max-tokens'].includes(kind)) return this.block(run, '原回合只有中断记录，不能证明业务完成。');
    const children = await context.repos.workItems.activeForParent(run.session_id);
    if (children.some(child => child.status === 'needs_reconciliation')) return this.block(run, '关联助理交办有结果待核对，请先核对原子事项。');
    if (children.length) return;
    const output = (events.filter(event => event.type === 'assistant/message' && event.data.turn === terminal.data.turn && !event.data.interrupted).at(-1)?.data.message?.content ?? [])
      .filter((part: ContentBlock) => part.type === 'text').map((part: ContentBlock) => String(part.text ?? '')).join('\n').trim();
    const status = fresh.status === 'stopping' || kind === 'aborted' ? 'stopped' : kind === 'completed' && output ? 'completed' : 'failed';
    const reason = status === 'completed' ? '执行回合已完成，结果已保存；业务完成以结果和动作回执为准，未请求投递'
      : status === 'stopped' ? '已停止；已发生的动作及未知结果保留' : `执行未完成：${terminal.data.reason?.error?.message ?? kind}`;
    const state = this.active.get(run.id); if (state) state.allowed = false;
    await repo.transition(run.id, status, reason, output);
  }
  async recover(): Promise<void> {
    if (this.recovering || !this.deps.context()) return;
    this.recovering = true;
    try { for (const run of await this.context().repos.skillRuns.unfinished()) await this.reconcile(run, true); }
    finally { this.recovering = false; }
  }
  async poll(): Promise<void> {
    if (this.recovering || !this.deps.context()) return;
    for (const run of await this.context().repos.skillRuns.unfinished()) await this.reconcile(run);
  }
  async stop(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), run = await context.repos.skillRuns.get(String(input.runId));
    if (!run) throw new Error('运行不存在。');
    if (!['pending', 'running', 'stopping', 'needs_reconciliation'].includes(run.status)) return this.view(run);
    await context.repos.skillRuns.transition(run.id, 'stopping', '已阻止新的工具调用，正在停止原会话');
    const state = this.active.get(run.id); if (state) state.allowed = false;
    try {
      await this.deps.detached(() => this.host.stop(run));
      const observation = await this.native.observe(context.repos.skillRuns, run);
      if (observation.pending) throw new Error('原生子任务或作业尚未确认结束。');
    } catch (error) { await this.block(run, `停止后的结果待核对：${errorText(error)}`); }
    const calls = await context.repos.skillRuns.calls(run.id);
    await context.repos.skillRuns.transition(run.id, calls.some(call => ['running', 'unknown'].includes(call.status)) ? 'needs_reconciliation' : 'stopped', '已停止；原始动作和结果保留，未知结果须先核对');
    return this.view((await context.repos.skillRuns.get(run.id))!);
  }
  async review(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), repo = context.repos.skillRuns;
    const run = await repo.get(String(input.runId));
    if (!run) throw new Error('运行记录不存在。');
    const id = requestId(input.requestId), hash = skillHash(JSON.stringify(input));
    const prior = (await repo.evidence(run.id)).reviews.find(review => review.request_id === id);
    if (prior) {
      if (prior.request_hash !== hash) throw new Error('核对操作标识已用于其他内容。');
      return this.inspect(input);
    }
    if (input.confirm !== true || typeof input.fingerprint !== 'string') throw new Error('请核对实际动作及停止状态后明确确认。');
    const nonempty = (value: unknown, name: string, max = 4000): string => {
      if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`请填写${name}（1–${max} 字符）。`);
      return value.trim();
    };
    const record: SkillRunReview['record'] = {
      actor: await this.deps.sourceSession(), summary: nonempty(input.summary, '核对结论'),
      completed: nonempty(input.completed, '已完成步骤；没有则写“无”'), remaining: nonempty(input.remaining, '剩余工作；没有则写“无”'),
      calls: [], native: [],
    };
    if (!Array.isArray(input.calls) || !Array.isArray(input.native)) throw new Error('缺少逐项核对结果。');
    for (const item of input.calls) {
      if (!item || !['completed', 'not_performed', 'partial'].includes(item.outcome)) throw new Error('请为每项未决动作选择实际结果。');
      record.calls.push({ sessionId: nonempty(item.sessionId, '会话标识', 200), callId: nonempty(item.callId, '调用标识', 200),
        outcome: item.outcome, evidence: nonempty(item.evidence, '核对依据、对象链接或文件位置') });
    }
    for (const item of input.native) record.native.push({ kind: nonempty(item?.kind, '子任务类型', 30), ownerId: nonempty(item?.ownerId, '所属会话', 200),
      nativeId: nonempty(item?.nativeId, '子任务标识', 200), evidence: nonempty(item?.evidence, '实际执行已经结束的依据') });
    // Close native admission before recording a human finding. The finding
    // supplements unknown receipts; it never rewrites them as native success.
    const state = this.active.get(run.id); if (state) state.allowed = false;
    await this.deps.detached(() => this.host.stop(run));
    await this.native.flush(run.id);
    await this.host.assertStopped(run, (await repo.sessions(run.id)).map(session => session.session_id));
    await repo.review({ runId: run.id, requestId: id, requestHash: hash, fingerprint: input.fingerprint, record });
    return this.inspect(input);
  }
}
