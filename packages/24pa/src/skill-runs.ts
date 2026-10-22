import type { DshAgent, DshContext, DshSession, ContentBlock } from './host.js';
import type { Repos, SkillRunRow, SkillRunSnapshot, SkillRunReview } from './repo.js';
import type { SkillPackages } from './skill-packages.js';
import type { SkillManagement } from './skill-management.js';
import type { SkillDefinitionLike } from './skills.js';
import { skillContract, skillHash, skillParameters } from './skill-package.js';
import { captureRunSkill, templateRunParameters } from './skill-selection.js';
import type { TaskPlanConfiguration, TaskPlanAuthorization } from './task-plan.js';
import { SkillRunHost, type RunInput, type RunToolCall, type RunToolResult } from './skill-run-host.js';
import { consumedTurn } from './host-turn.js';
import { SkillRunNative, uncertainTool } from './skill-run-native.js';
import { skillDelegationTools } from './local-tool-access.js';
import { skillRequirements } from './skill-requirements.js';
import { SkillRunClock } from './skill-run-clock.js';
import { SkillRunTemplates } from './skill-run-template.js';
import { initialRunControl, beginRunAttempt, blockRun, clearRunBlock, runControlSummary, type RunBlockKind } from './run-control.js';
import { isDeepStrictEqual } from 'node:util';
import { planTriggerId } from './repo/plan-trigger.js';

interface RunContext { binding: string; cwd: string; repos: Repos }
interface SkillRunsDeps {
  host: DshContext;
  context(): RunContext | null;
  packages: SkillPackages;
  management?: SkillManagement;
  sourceSession(): Promise<string>;
  tools(mode: 'local' | 'business'): Promise<string[]>;
  permissionHash(authorization?: TaskPlanAuthorization): string;
  verifyPlan?(run: SkillRunRow): Promise<void>;
  authorizePlan?(configuration: TaskPlanConfiguration, skill: TaskPlanAuthorization['skill'], previous: TaskPlanAuthorization): Promise<TaskPlanAuthorization>;
  maxWorkers?(): number;
  checkBusiness(name: string, actions: string[]): void;
  startBusiness(run: SkillRunRow, content: ContentBlock[]): Promise<void>;
  template(def: SkillDefinitionLike, parameters: Record<string, unknown>, run?: SkillRunRow): Promise<string>;
  checkTemplate(def: SkillDefinitionLike): void;
  lease<T>(work: () => Promise<T>): Promise<T>;
  control<T>(work: () => Promise<T>): Promise<T>;
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
  private readonly clock: SkillRunClock;
  private readonly templates: SkillRunTemplates;
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly active = new Map<string, { run: SkillRunRow; binding: string; allowed: boolean }>();
  private readonly settling = new Map<string, Promise<void>>();
  private readonly resuming = new Set<string>();
  private recovering = false;
  constructor(private readonly deps: SkillRunsDeps) {
    this.host = new SkillRunHost(deps.host); this.native = new SkillRunNative(this.host);
    this.clock = new SkillRunClock(id => this.deps.control(() => this.expire(id)));
    this.templates = new SkillRunTemplates(deps.template, work => deps.control(work));
  }
  dispose(): void { this.clock.dispose(); this.templates.dispose(); }
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
      plan: snapshot.plan,
      packageHash: snapshot.package.hash, files: snapshot.package.files.map(({ content: _content, ...file }) => file) };
  }
  async list(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding);
    const skillId = typeof input.id === 'string' ? input.id.startsWith('managed:') ? input.id.slice(8) : input.id : undefined;
    const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
    return { ...await context.repos.skillRuns.list(skillId, offset, 20), workspaceBinding: context.binding };
  }
  async inspect(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), run = await context.repos.skillRuns.get(String(input.runId));
    if (!run) throw new Error('运行记录不存在。');
    const control = await context.repos.runControls.get(run.id);
    const evidence = await context.repos.skillRuns.evidence(run.id);
    const adoption = new Map(await Promise.all(evidence.sessions.map(async row => {
      const history = await this.host.history(run, row.session_id).catch(() => null);
      return [row.session_id, history ? new Set(history.ownEvents().filter(event => event.type === 'user/message').map(event => event.data.id)) : null] as const;
    })));
    return { run: this.view(run), ...evidence, inputs: evidence.inputs.map(input => ({ ...input,
      adopted: input.session_id && adoption.get(input.session_id) ? adoption.get(input.session_id)!.has(input.message_id) : null })),
      execution: control ? runControlSummary(control.state) : null, attempts: control?.state.attempts ?? [],
      unresolvedOperations: await context.repos.skillRuns.unresolvedOperations(run.work_item_id), workspaceBinding: context.binding };
  }
  private async prepare(input: Record<string, unknown>, options: { sourceSessionId?: string; background?: boolean } = {}) {
    const context = this.context(input.workspaceBinding);
    const previous = input.rerunId ? await context.repos.skillRuns.get(String(input.rerunId)) : null;
    if (input.rerunId && !previous) throw new Error('原运行不存在。');
    if (previous && previous.workspace_path !== context.cwd) throw new Error('原工作区环境无法恢复，请核对原记录。');
    const original = !!previous && input.configuration === 'original';
    const plan = previous?.snapshot.plan ? await context.repos.taskPlans.get(previous.snapshot.plan.id) : null;
    if (previous?.snapshot.plan && (!plan?.task_config || !plan.task_authorization || plan.recycled_at || plan.delete_when_idle
      || (await context.repos.taskPlans.blocks(plan.id)).length || (await context.repos.skills.planBlocks()).some(block => block.plan_id === plan.id))) {
      throw new Error('原计划已删除或仍有阻断，请先还原并核验计划后接续。');
    }
    const planConfiguration = plan ? original ? previous!.snapshot.plan!.configuration : plan.task_config! : null;
    const planAuthorization = plan ? original ? previous!.snapshot.plan!.authorization : plan.task_authorization! : null;
    const selection = await captureRunSkill({ id: planConfiguration?.skillId ?? input.id, versionId: plan ? undefined : input.versionId,
      previous: plan && !original ? null : previous, original,
      binding: context.binding, repos: context.repos, packages: this.deps.packages, management: this.deps.management });
    const { pkg, definition, versionId } = selection;
    if (!previous) await context.repos.skillRuns.checkNewWork(selection.runSkillId);
    const problems = await this.deps.packages.check(definition, pkg);
    if (problems.length) throw new Error(problems.join('\n'));
    if (['worker-persona', 'setup'].includes(String(definition.metadata?.kind)) || definition.name.startsWith('worker-persona-') || definition.name.endsWith('-setup-flow')) throw new Error('职责与接入向导不能作为普通任务运行；向导请通过本地对话办理。');
    const contract = skillContract(definition);
    const mode: 'local' | 'business' | 'template' | undefined = definition.metadata?.track === 'template' ? 'template' : contract?.mode;
    if (!mode) throw new Error('请补齐任务的参数、执行范围、预期结果与完成标准。');
    if ((options.background || plan) && mode === 'local') throw new Error('后台计划仅支持业务任务或确定性模板；本地编程 Skill 请从本地手工运行。');
    if (mode === 'template') this.deps.checkTemplate(definition);
    const rawParameters = planConfiguration?.parameters ?? input.parameters ?? previous?.snapshot.parameters ?? {};
    const parameters = original ? previous!.snapshot.parameters : contract ? skillParameters(contract, rawParameters) : templateRunParameters(rawParameters);
    const tools = mode === 'template' ? [] : definition.metadata?.tools;
    if (!Array.isArray(tools) || tools.some(t => typeof t !== 'string')) throw new Error('请明确声明 metadata.tools；空数组表示不使用工具。');
    const available = mode === 'template' ? [] : await this.deps.tools(mode);
    const missing = tools.filter(tool => !available.includes(tool));
    if (missing.length) throw new Error(`当前身份不具备工具：${missing.join('、')}。`);
    if (mode === 'business') this.deps.checkBusiness(selection.name, contract?.actions ?? []);
    const sourceSessionId = previous?.source_session_id ?? options.sourceSessionId ?? await this.deps.sourceSession();
    const snapshot: SkillRunSnapshot = { name: selection.displayName, definition: { ...definition, name: selection.name }, package: pkg, contract,
      parameters, tools: [...new Set(tools)], permissionHash: this.deps.permissionHash(),
      ...(selection.provider ? { provider: selection.provider } : {}),
      executionLimitMs: original ? previous!.snapshot.executionLimitMs ?? 900000 : initialRunControl(planConfiguration?.executionLimitMs ?? (input.executionLimitMs === undefined ? 900000 : Number(input.executionLimitMs))).limitMs };
    if (plan && planConfiguration && planAuthorization) {
      if (!this.deps.authorizePlan) throw new Error('计划授权核验尚未就绪，不能改用普通运行绕过。');
      const authorization = await this.deps.authorizePlan(planConfiguration, this.planSkill(selection, snapshot), planAuthorization);
      snapshot.permissionHash = this.deps.permissionHash(authorization);
      snapshot.plan = { ...previous!.snapshot.plan!, title: original ? previous!.snapshot.plan!.title : plan.title, source: 'manual',
        configuration: structuredClone(planConfiguration), authorization: { ...authorization, checkedAt: planAuthorization.checkedAt } };
    }
    if (previous) {
      const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
      if (instruction.length > 4000) throw new Error('接续说明最多 4000 字符。');
      snapshot.continuation = { fromRunId: previous.id, instruction, runs: await context.repos.skillRuns.continuation(previous.id) };
    }
    return { context, selection, versionId, mode, snapshot, sourceSessionId, previous, original, plan };
  }
  private planSkill(selection: Awaited<ReturnType<typeof captureRunSkill>>, snapshot: SkillRunSnapshot): TaskPlanAuthorization['skill'] {
    return { id: selection.id, name: selection.name, versionId: selection.versionId, packageHash: snapshot.package.hash,
      tools: snapshot.tools, contract: snapshot.contract, resources: snapshot.package.files.map(file => file.path) };
  }
  async preview(input: Record<string, unknown>) {
    const prepared = await this.prepare(input);
    const { selection, versionId, mode, snapshot, sourceSessionId, context } = prepared;
    return { entry: selection.entry, versionId, mode, name: snapshot.name, parameters: snapshot.parameters, tools: snapshot.tools, contract: snapshot.contract,
      files: snapshot.package.files.map(({ content: _content, ...file }) => file), sourceSessionId, continuation: snapshot.continuation, executionLimitMs: snapshot.executionLimitMs,
      plan: snapshot.plan,
      fingerprint: skillHash(JSON.stringify([selection.revision, versionId, snapshot, sourceSessionId, prepared.plan?.revision ?? null])), workspaceBinding: context.binding,
      message: (snapshot.plan ? '计划接续保留原触发时间范围，固定目标、投递和当前权限仍按计划核验。' : '')
        + (mode === 'template' ? '此模板按确定性规则生成结果，不调用模型。' : '预览只检查配置，不执行任务。试运行与正式运行都会实际调用获准工具，可能修改文件或外部对象。结果默认保存在运行记录。') };
  }
  async preparePlan(configuration: TaskPlanConfiguration, sourceSessionId: string) {
    const prepared = await this.prepare({ id: configuration.skillId, parameters: configuration.parameters,
      executionLimitMs: configuration.executionLimitMs }, { background: true, sourceSessionId });
    const { selection, snapshot, mode, context } = prepared;
    const skill = this.planSkill(selection, snapshot);
    return { skill, snapshot, mode, skill_id: selection.runSkillId, version_id: selection.versionId,
      expectedRevision: selection.revision, source_session_id: sourceSessionId, workspace_path: context.cwd };
  }
  async start(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), id = requestId(input.requestId), hash = skillHash(JSON.stringify(input));
    const priorRun = input.rerunId ? await context.repos.skillRuns.get(String(input.rerunId)) : null;
    if (priorRun?.snapshot.plan) {
      const trigger = await context.repos.planTriggers.get(planTriggerId(priorRun.snapshot.plan.id, `manual:${id}`, id));
      if (trigger) {
        if (trigger.snapshot.requestHash !== hash) throw new Error('运行操作标识已用于不同输入。');
        if (!trigger.run_id) throw new Error(trigger.reason ?? '本次计划接续未获准。');
        return { run: this.view((await context.repos.skillRuns.get(trigger.run_id))!), repeated: true, workspaceBinding: context.binding };
      }
    }
    const repeated = await context.repos.skillRuns.repeated(id, hash);
    if (repeated) return { run: this.view(repeated), repeated: true, workspaceBinding: context.binding };
    const prepared = await this.prepare(input);
    const fingerprint = skillHash(JSON.stringify([prepared.selection.revision, prepared.versionId, prepared.snapshot, prepared.sourceSessionId, prepared.plan?.revision ?? null]));
    if (input.confirm !== true || input.fingerprint !== fingerprint) throw new Error('内容、权限或参数已改变，请重新预览并确认本次真实执行。');
    const inputRun = { request_id: id, request_hash: hash, skill_id: prepared.selection.runSkillId, version_id: prepared.versionId,
      source_session_id: prepared.sourceSessionId, workspace_path: context.cwd, mode: prepared.mode, trial: input.trial === true,
      snapshot: prepared.snapshot, expectedRevision: prepared.selection.revision, workItemId: prepared.previous?.work_item_id, originalRerun: prepared.original };
    let admission;
    if (prepared.plan) {
      inputRun.snapshot.plan!.generation = `manual:${id}`;
      const result = await context.repos.planTriggers.admit({ plan: prepared.plan, source: 'manual', generation: `manual:${id}`, occurrence: id,
        sessionId: prepared.sourceSessionId, triggeredAt: new Date(), requestHash: hash, admission: inputRun });
      if (!result.run) throw new Error(result.trigger.reason ?? '计划接续未获准。');
      admission = { run: result.run, repeated: result.repeated };
    } else admission = await context.repos.skillRuns.admitResult(inputRun);
    // The host owns the model lifetime. A lease covers admission and each
    // tool intent/receipt, rather than holding configuration changes forever.
    await this.launch(admission.run);
    return { run: this.view((await context.repos.skillRuns.get(admission.run.id))!), repeated: admission.repeated, workspaceBinding: context.binding };
  }
  private async launch(run: SkillRunRow): Promise<boolean> {
    const context = this.context(), repo = context.repos.skillRuns;
    if (run.snapshot.plan) {
      try { await this.verifyPlan(run); }
      catch (error) {
        await repo.rejectPendingPlanRun(run.id, `启动前原计划目标核验失败：${errorText(error)}`);
        return false;
      }
    }
    if (!await repo.claimLaunch(run.id, run.mode === 'template' ? '正在生成确定性结果' : '正在提交原生运行', this.deps.maxWorkers?.() ?? 2)) return false;
    try {
      if (run.mode === 'template') {
        await this.templates.start(run, context.repos);
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
    for (const resume of await context.repos.runControls.resumes(run.id)) if (resume.status !== 'prepared') this.host.rememberResume(run.id, resume.request_id, resume.message.content);
    // pa24_delegate already admitted a separate business WorkItem with its
    // own role/action gates. Observing that Worker must preserve those gates.
    const delegatedWork = descendant ? await context.repos.workItems.get(agent.id) : null;
    await this.host.mount(agent, run, {
      allowed: () => owner.allowed && this.deps.context()?.binding === owner.binding && this.deps.permissionHash(run.snapshot.plan?.authorization) === run.snapshot.permissionHash,
      authorize: () => this.authorize(run, owner.binding),
      beforeModel: async session => {
        const clock = await this.clock.observe(context.repos.runControls, run.id, [session], id => id === session.id || this.clockLive(id));
        if (clock && clock.executionMs >= clock.limitMs) {
          owner.allowed = false;
          await this.expire(run.id);
          throw new Error('累计执行时限已用尽。');
        }
        if (clock?.attempts.length && clock.attempts.at(-1)!.endedAt !== null) await context.repos.runControls.change(run.id, state => beginRunAttempt(state));
      },
      ownsInput: async message => await this.ownsResume(run, agent.id, message) || this.native.ownsInput(repo, run, agent.id, message),
      restoreInput: async id => {
        const record = (await repo.inputs(run.id)).find(row => row.session_id === run.session_id && row.message_id === id && row.accepted);
        if (!record) throw new Error('恢复信号没有已保存的原输入依据。');
        return record.message as RunInput;
      },
      input: (message, accepted) => repo.input(run.id, message, accepted, agent.id),
      block: async reason => {
        const control = await context.repos.runControls.get(run.id);
        if (control && !control.state.terminal && (control.state.blocks.length || (await repo.get(run.id))?.status === 'waiting')) await repo.transition(run.id, 'waiting', control.state.blocks.map(block => block.reason).join('；') || '补充已保存，等待原步骤结束后继续');
        else await this.block(run, reason);
      },
      execute: (call, next) => this.deps.lease(() => this.execute(run, owner.binding, call, next)),
      final: (call, result) => this.native.final(repo, run, call, result),
      activation: (phase, info) => this.native.activation(repo, run, agent.id, phase, info),
    }, descendant, delegatedWork ? ['pa24_work', 'pa24_memory'] : run.snapshot.tools);
  }
  private clockLive(id: string): boolean {
    return this.host.executing(id) || this.host.ownedJobs(id).some(job => ['running', 'stopping'].includes(job.status));
  }
  private async expire(id: string): Promise<void> {
    const context = this.context(), run = await context.repos.skillRuns.get(id);
    if (!run || !['running', 'waiting', 'timed_out'].includes(run.status) || run.mode === 'template') return;
    const histories: DshSession[] = [];
    for (const row of await context.repos.skillRuns.sessions(id)) {
      const history = await this.host.history(run, row.session_id); if (history) histories.push(history);
    }
    const control = await this.clock.observe(context.repos.runControls, id, histories, owner => this.clockLive(owner));
    if (!control || control.executionMs < control.limitMs) return;
    const active = this.active.get(id); if (active) active.allowed = false;
    await context.repos.runControls.change(id, state => { state.stop ??= { requestedAt: Date.now(), settledAt: null, error: null }; });
    await context.repos.skillRuns.transition(id, 'timed_out', '累计执行达到时限；已发生动作和未决回执保留');
    this.clock.disarm(id);
    if (this.stopping.has(id) || (await context.repos.runControls.get(id))?.state.stop?.settledAt) return;
    // A request middleware cannot wait for its own Agent to become idle.
    // The separate control lease requests cancellation and retains the old
    // workspace until native termination and its receipts are checkpointed.
    const stopping = this.deps.control(async () => {
      try {
        await this.deps.detached(() => this.host.stop(run));
        const stopped = await this.native.observe(context.repos.skillRuns, run);
        await this.clock.observe(context.repos.runControls, id, stopped.histories, () => false);
        if (stopped.pending) throw new Error('原生子任务或作业尚未确认结束。');
        await context.repos.runControls.change(id, state => { if (state.stop) { state.stop.settledAt = Date.now(); state.stop.error = null; } });
      } catch (error) {
        await context.repos.runControls.change(id, state => { if (state.stop) state.stop.error = `超时后停止待核对：${errorText(error)}`; });
      }
    }).finally(() => this.stopping.delete(id));
    this.stopping.set(id, stopping);
    void stopping.catch(() => {}); // The durable unsettled stop is polled again.
  }
  async waitForInput(run: SkillRunRow, reason: unknown): Promise<unknown> {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 4000) throw new Error('请说明需主人补充的信息（1–4000 字符）。');
    const context = this.context();
    await context.repos.runControls.change(run.id, state => blockRun(state, { key: 'input', kind: 'input', reason: reason.trim() }));
    await context.repos.skillRuns.transition(run.id, 'waiting', reason.trim());
    return { runId: run.id, status: 'waiting', reason: reason.trim(), message: '已保存原运行，等待主人补充后沿本记录继续。' };
  }
  private async ownsResume(run: SkillRunRow, sessionId: string, message: RunInput, request?: string): Promise<boolean> {
    if (sessionId !== run.session_id) return false;
    const context = this.context();
    for (const row of await context.repos.runControls.resumes(run.id)) {
      if (row.status === 'prepared' || (request && row.request_id !== request)) continue;
      const sourceMatches = run.mode === 'local' ? message.source?.kind === 'user' && message.source.rpcId === row.request_id
        : message.source?.kind === 'agent-message' && message.source.senderSessionId === run.source_session_id;
      const expected = run.mode === 'business' ? [{ type: 'text', text: `Agent ${run.source_session_id} sent a message: ` }, ...row.message.content] : row.message.content;
      if (sourceMatches && isDeepStrictEqual(message.content, expected)) return context.repos.runControls.submitted(row.request_id, message.id);
    }
    return false;
  }
  async resume(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), run = await context.repos.skillRuns.get(String(input.runId));
    if (!run) throw new Error('原运行不存在。');
    const id = requestId(input.requestId), hash = skillHash(JSON.stringify(input));
    const prior = (await context.repos.runControls.resumes(run.id)).find(row => row.request_id === id);
    if (prior) {
      if (prior.request_hash !== hash) throw new Error('补充操作标识已用于其他内容。');
      return this.inspect(input);
    }
    const recheck = input.op === 'recheck';
    if (input.confirm !== true || (!recheck && (typeof input.instruction !== 'string' || !input.instruction.trim() || input.instruction.length > 4000))) throw new Error('请明确提交需补充的信息（1–4000 字符）。');
    if (run.status !== 'waiting') throw new Error('只有等待中的原运行可以补充；已结束的运行请显式接续。');
    if (recheck) {
      await this.refreshBlocks(run);
      if ((await context.repos.runControls.get(run.id))?.state.blocks.length) return this.inspect(input);
      if ((await this.pendingInputs(run)).length || (await context.repos.runControls.resumes(run.id)).some(row => row.status !== 'submitted')) { await this.dispatchResumes(run); return this.inspect(input); }
    }
    const content = [{ type: 'text', text: `[24PA resume: ${id}]\n${recheck ? '主人已要求重新检查，原阻断已解除。' : `主人补充：${String(input.instruction).trim()}`}\n沿原运行继续剩余工作，不重做已有成功回执的步骤；原有权限和累计执行时限保持。` }];
    await context.repos.runControls.prepareResume({ runId: run.id, requestId: id, hash, message: { content }, change: state => {
      if (!recheck) {
        if (!state.blocks.some(block => block.key === 'input' && block.kind === 'input')) throw new Error('此运行没有待补充的信息；其他阻断请通过对应入口处理。');
        clearRunBlock(state, 'input');
      }
    } });
    await this.dispatchResumes(run);
    return this.inspect(input);
  }
  private async dispatchResumes(run: SkillRunRow): Promise<boolean> {
    if (this.resuming.has(run.id)) return true;
    this.resuming.add(run.id);
    try { return await this.resumeInputs(run); }
    finally { this.resuming.delete(run.id); }
  }
  private async resumeInputs(run: SkillRunRow): Promise<boolean> {
    if (await this.stopCanceledInput(run)) return true;
    const context = this.context(), controls = context.repos.runControls;
    const resumes = await controls.resumes(run.id), pending = resumes.filter(row => row.status !== 'submitted');
    const originals = await this.pendingInputs(run);
    if (!pending.length && !originals.length) return false;
    const current = await context.repos.skillRuns.get(run.id), control = await controls.get(run.id);
    if (!current || !['running', 'waiting'].includes(current.status) || !control || control.state.terminal) return false;
    await this.refreshBlocks(run);
    if ((await controls.get(run.id))?.state.blocks.length || this.clockLive(run.session_id)) return true;
    await this.native.flush(run.id);
    if ((await context.repos.skillRuns.calls(run.id)).some(call => ['running', 'unknown'].includes(call.status)) || (await context.repos.skillRuns.unresolvedOperations(run.work_item_id)).length) {
      await this.block(run, '原运行仍有未决动作，不能用补充绕过核对。'); return true;
    }
    if (originals.length) {
      const original = originals[0]!;
      await context.repos.skillRuns.input(run.id, original, true, run.session_id);
      if (!await controls.claimRecovery(run.id, original, this.deps.maxWorkers?.() ?? 2)) return true;
      const active = this.active.get(run.id); if (active) active.allowed = true;
      try { await this.deps.detached(() => this.host.resumePending(run, original)); }
      catch (error) { if (!await this.stopCanceledInput(run)) await this.block(run, `恢复原输入未完成：${errorText(error)}`); }
      return true;
    }
    for (const row of pending) {
      if (row.status !== 'prepared') {
        const history = await this.host.history(run);
        const messages = history?.ownEvents().filter(event => event.type === 'agent/inbox/spliced').flatMap(event => event.data.inserted ?? []) ?? [];
        let found = false;
        for (const message of messages) if (await this.ownsResume(run, run.session_id, message, row.request_id)) found = true;
        if (!found) { await controls.unknown(row.request_id); await this.block(run, '补充输入的原生接纳结果待核对，不重复提交。'); }
        return true;
      }
      if (!await controls.claimResume(row.request_id, this.deps.maxWorkers?.() ?? 2)) return true;
      const active = this.active.get(run.id); if (active) active.allowed = true;
      try {
        const nativeId = await this.deps.detached(() => this.host.submitResume(run, row.request_id, row.message.content));
        if (!await controls.submitted(row.request_id, nativeId)) throw new Error('同一补充出现多个原生输入，须核对。');
      } catch (error) {
        await controls.unknown(row.request_id);
        await this.block(run, `补充提交结果待核对：${errorText(error)}`);
        return true;
      }
    }
    return true;
  }
  private async stopCanceledInput(run: SkillRunRow): Promise<boolean> {
    if (run.mode === 'template') return false;
    const history = await this.host.history(run);
    if (!history) return false;
    const parent = history.header.parentSession, parentId = typeof parent === 'string' ? parent : parent?.id;
    if (history.id !== run.session_id || history.header.cwd !== run.workspace_path || (run.mode === 'business' ? parentId !== run.source_session_id : !!parentId)) return false;
    for (const resume of await this.context().repos.runControls.resumes(run.id)) if (resume.status !== 'prepared') this.host.rememberResume(run.id, resume.request_id, resume.message.content);
    const canceled = this.host.canceledInputs(run, history);
    if (!canceled.size) return false;
    const repo = this.context().repos.skillRuns, inputs = await repo.inputs(run.id);
    const admissions = history.ownEvents().filter(event => event.type === 'agent/inbox/spliced').flatMap(event => event.data.inserted ?? []) as RunInput[];
    let owned = inputs.some(input => input.accepted && input.session_id === run.session_id && canceled.has(input.message_id));
    for (const message of admissions) if (canceled.has(message.id) && (this.host.ownsInput(run, message) || await this.ownsResume(run, run.session_id, message))) {
      await repo.input(run.id, message, true, run.session_id); owned = true;
    }
    if (!owned) return false;
    await this.stop({ runId: run.id });
    return true;
  }
  /** Inbox claim proves receipt, user/message proves adoption. An authorization
   * gate between those events must not discard the owner's original words. */
  private async pendingInputs(run: SkillRunRow): Promise<RunInput[]> {
    if (run.mode === 'template') return [];
    const context = this.context(), history = await this.host.history(run);
    if (!history) return [];
    const events = history.ownEvents(), adopted = new Set(events.filter(event => event.type === 'user/message').map(event => event.data.id));
    const candidates = events.filter(event => event.type === 'agent/inbox/spliced').flatMap(event => event.data.inserted ?? []) as RunInput[];
    candidates.push(...(await context.repos.skillRuns.inputs(run.id)).filter(row => row.accepted && row.session_id === run.session_id).map(row => row.message as RunInput));
    const remembered = (await context.repos.skillRuns.get(run.id))?.recovery?.message as RunInput | undefined;
    if (remembered) candidates.push(remembered);
    const selected = new Map<string, RunInput>();
    for (const message of candidates) {
      if (adopted.has(message.id) || !(this.host.ownsInput(run, message) || await this.ownsResume(run, run.session_id, message))) continue;
      const previous = selected.get(message.id);
      if (previous && !isDeepStrictEqual(previous, message)) throw new Error('原输入身份对应不同内容，须先核对。');
      selected.set(message.id, message);
    }
    return [...selected.values()];
  }
  private async waitForBlock(run: SkillRunRow, key: string, kind: RunBlockKind, reason: string): Promise<void> {
    const context = this.context();
    await context.repos.runControls.change(run.id, state => blockRun(state, { key, kind, reason }));
    await context.repos.skillRuns.transition(run.id, 'waiting', reason);
  }
  private async refreshBlocks(run: SkillRunRow): Promise<void> {
    const issues: Array<{ key: string; kind: RunBlockKind; reason: string }> = [];
    if (this.deps.permissionHash(run.snapshot.plan?.authorization) !== run.snapshot.permissionHash) issues.push({ key: 'current-authorization', kind: 'authorization', reason: '身份或授权配置与原运行不同；恢复原范围后可重新检查。' });
    try { await this.verifyPlan(run); } catch (error) { issues.push({ key: 'current-plan', kind: 'authorization', reason: errorText(error) }); }
    const missing = await skillRequirements(run.snapshot.definition, run.snapshot.package);
    if (missing.length) issues.push({ key: 'current-dependencies', kind: 'dependency', reason: missing.join('；') });
    if (run.mode === 'business') try { this.deps.checkBusiness(run.snapshot.definition.name, run.snapshot.contract?.actions ?? []); }
    catch (error) { issues.push({ key: 'current-business', kind: 'authorization', reason: errorText(error) }); }
    const context = this.context();
    const control = await context.repos.runControls.change(run.id, state => {
      if (state.terminal) return;
      for (const key of ['current-authorization', 'current-dependencies', 'current-business', 'current-plan']) {
        const issue = issues.find(item => item.key === key);
        if (issue) blockRun(state, issue); else clearRunBlock(state, key);
      }
    });
    if (control.state.blocks.length && !control.state.terminal) await context.repos.skillRuns.transition(run.id, 'waiting', control.state.blocks.map(block => block.reason).join('；'));
  }
  private async authorize(run: SkillRunRow, binding: string): Promise<void> {
    const context = this.context(binding), current = await context.repos.skillRuns.get(run.id);
    const control = await context.repos.runControls.get(run.id);
    if (control?.state.blocks.length && !control.state.terminal) throw new Error(control.state.blocks.map(block => block.reason).join('；'));
    if (this.active.get(run.id)?.allowed === false || current?.status !== 'running') throw new Error('运行已停止或等待处理，不能继续执行。');
    if (this.deps.permissionHash(run.snapshot.plan?.authorization) !== run.snapshot.permissionHash) {
      await this.waitForBlock(run, 'current-authorization', 'authorization', '身份或授权配置与原运行不同；恢复原范围后可重新检查。');
      throw new Error('当前身份或授权发生变化，等待处理。');
    }
    try { await this.verifyPlan(run); }
    catch (error) { await this.waitForBlock(run, 'current-plan', 'authorization', errorText(error)); throw error; }
    const missing = await skillRequirements(run.snapshot.definition, run.snapshot.package);
    if (missing.length) {
      await this.waitForBlock(run, 'current-dependencies', 'dependency', missing.join('\n'));
      throw new Error(missing.join('\n'));
    }
    for (const prior of run.snapshot.continuation?.runs ?? []) {
      const evidence = await context.repos.skillRuns.evidence(prior.id);
      if (!evidence.reviewed && (evidence.reviews.length || evidence.calls.some(call => ['running', 'unknown'].includes(call.status)))) {
        await this.block(run, '原运行收到新的未决回执，已阻止接续的新动作，请先核对。');
        throw new Error('原运行有新的未决结果。');
      }
    }
    if (run.mode === 'business') try { this.deps.checkBusiness(run.snapshot.definition.name, run.snapshot.contract?.actions ?? []); }
    catch (error) { await this.waitForBlock(run, 'current-business', 'authorization', errorText(error)); throw error; }
  }
  private async verifyPlan(run: SkillRunRow): Promise<void> {
    if (!run.snapshot.plan) return;
    if (!this.deps.verifyPlan) throw new Error('当前运行环境缺少计划授权核验。');
    await this.deps.verifyPlan(run);
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
    this.clock.disarm(run.id);
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
    if (fresh?.status === 'timed_out') { await this.expire(run.id); return; }
    if (!fresh || !['pending', 'running', 'waiting', 'stopping'].includes(fresh.status)) return;
    if (fresh.status === 'pending') { await this.launch(fresh); return; }
    try { await this.native.flush(run.id); }
    catch (error) { return this.block(run, errorText(error)); }
    if (await this.stopCanceledInput(run)) return;
    const calls = await repo.calls(run.id);
    if (calls.some(call => call.status === 'unknown' || (recovering && call.status === 'running'))) return this.block(run, '工具结果待核对；停止或重启不抹除已经发生的动作。');
    let observation;
    try { observation = await this.native.observe(repo, run, recovering); }
    catch (error) { return this.block(run, errorText(error)); }
    const history = observation.root;
    let control;
    try { control = await this.clock.observe(context.repos.runControls, run.id, observation.histories, id => !recovering && this.clockLive(id)); }
    catch (error) { return this.block(run, `执行计时依据待核对：${errorText(error)}`); }
    if (control && control.executionMs >= control.limitMs) { await this.expire(run.id); return; }
    if (await this.dispatchResumes(run)) return;
    if ((await repo.get(run.id))?.status === 'waiting') return;
    if (!history) {
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
    const consumed = new Set(ends.flatMap(event => [...consumedTurn(history, event.data.turn).messageIds]));
    if ((await context.repos.runControls.resumes(run.id)).some(row => row.status === 'submitted' && (!row.native_message_id || !consumed.has(row.native_message_id)))) return;
    if (original.size > 1) return this.block(run, '原输入不唯一，需要核对。');
    if (!ends.length) {
      if (recovering && fresh.status === 'running') await this.block(run, '没有可核验的待采用原输入；请核对原会话及执行结果。');
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
    this.clock.disarm(run.id);
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
    if (!['pending', 'running', 'waiting', 'stopping', 'needs_reconciliation'].includes(run.status)) return this.view(run);
    this.clock.disarm(run.id);
    await context.repos.skillRuns.transition(run.id, 'stopping', '已阻止新的工具调用，正在停止原会话');
    const state = this.active.get(run.id); if (state) state.allowed = false;
    try {
      if (run.mode === 'template') await this.templates.stop(run.id);
      else {
        await this.deps.detached(() => this.host.stop(run));
        const observation = await this.native.observe(context.repos.skillRuns, run);
        await this.clock.observe(context.repos.runControls, run.id, observation.histories, () => false);
        if (observation.pending) throw new Error('原生子任务或作业尚未确认结束。');
      }
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
      const stop = (await context.repos.runControls.get(run.id))?.state.stop;
      if (!stop || stop.settledAt !== null) return this.inspect(input);
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
    await repo.review({ runId: run.id, requestId: id, requestHash: hash, fingerprint: input.fingerprint, record, stopConfirmed: true });
    return this.inspect(input);
  }
}
