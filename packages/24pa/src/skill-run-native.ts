import type { DshSession } from './host.js';
import type { SkillRunRepo, SkillRunRow } from './repo/skill-run.js';
import { SkillRunHost, type RunActivation, type RunInput, type RunToolCall, type RunToolResult } from './skill-run-host.js';
import { consumedTurn } from './host-turn.js';

export const uncertainTool = (result: RunToolResult, aborted = false) =>
  ['ABORTED', 'TOOL_OUTCOME_UNKNOWN'].includes(result.error?.info?.code ?? '')
  || (aborted && result.error?.info?.code !== 'ABORTED_BEFORE_DISPATCH');

/** Native notices, child activations and jobs belong to the initiating Run.
 * Observing never consumes job output, wakes a cold session or grants tools. */
export class SkillRunNative {
  private readonly writes = new Map<string, Set<Promise<void>>>();
  private readonly failures = new Map<string, string>();
  private readonly activations = new Map<string, { repo: SkillRunRepo; run: SkillRunRow; owners: Set<string>; phase: 'start' | 'end'; info: RunActivation }>();
  constructor(private readonly host: SkillRunHost) {}

  private enqueue(id: string, work: () => Promise<void>): void {
    const pending = this.writes.get(id) ?? new Set<Promise<void>>();
    this.writes.set(id, pending);
    const promise = work().catch(error => { this.failures.set(id, String(error)); }).finally(() => pending.delete(promise));
    pending.add(promise);
  }
  async flush(id: string): Promise<void> {
    const pending = this.writes.get(id);
    while (pending?.size) await Promise.all([...pending]);
    if (this.failures.has(id)) throw new Error(`原生运行回执保存失败：${this.failures.get(id)}`);
    await this.flushActivations(id);
  }
  activation(repo: SkillRunRepo, run: SkillRunRow, owner: string, phase: 'start' | 'end', info: RunActivation): void {
    // start precedes catalog admission. Keep the exact lifecycle identity
    // until the durable catalog proves which scoped listener is its parent.
    const key = `${run.id}:${info.runId}:${phase}`, candidate = this.activations.get(key);
    if (candidate) candidate.owners.add(owner);
    else this.activations.set(key, { repo, run, owners: new Set([owner]), phase, info });
    this.enqueue(run.id, () => this.flushActivations(run.id));
  }
  private async flushActivations(id: string): Promise<void> {
    // Do not await flush() here: the write barrier contains this promise.
    const candidates = [...this.activations.entries()].filter(([, item]) => item.run.id === id);
    if (!candidates.length) return;
    const children = await this.host.descendants(candidates[0]![1].run);
    for (const [key, item] of candidates) {
      const child = children.find(row => row.kind === 'child' && row.id === item.info.id && item.owners.has(row.parentId));
      if (!child) continue;
      await item.repo.nativeReceipt(id, 'activation', child.parentId, item.info.runId, item.phase, item.info);
      this.activations.delete(key);
    }
  }
  final(repo: SkillRunRepo, run: SkillRunRow, call: RunToolCall, result: RunToolResult): void {
    this.enqueue(run.id, () => repo.finalCall(run.id, { ...call, sessionId: call.agent!.id }, result, uncertainTool(result, call.signal.aborted)));
  }

  async ownsInput(repo: SkillRunRepo, run: SkillRunRow, owner: string, message: RunInput): Promise<boolean> {
    if (owner === run.session_id && this.host.ownsInput(run, message)) return true;
    const sessions = await repo.sessions(run.id), own = sessions.find(row => row.session_id === owner);
    if (!own) return false;
    const source = message.source;
    if (source?.kind === 'user' && source.rpcId) {
      const delivery = (await repo.nativeDeliveries(run.id)).find(row => row.target === owner && row.dedup_key === source.rpcId);
      if (delivery && message.content.length === 1 && message.content[0]?.type === 'text' && message.content[0].text === String(delivery.content.text ?? '')) {
        return !(await repo.inputs(run.id)).some(row => row.session_id === owner && row.message.source?.rpcId === source.rpcId && row.message_id !== message.id);
      }
    }
    if (source?.kind === 'user' && owner !== run.session_id && !source.rpcId) {
      const first = (await repo.inputs(run.id)).filter(row => row.session_id === owner && row.message.source?.kind === 'user');
      return first.length === 0 || first.some(row => row.message_id === message.id && row.accepted);
    }
    if (source?.kind === 'agent-message' || source?.kind === 'subagent-settled') {
      const sender = source.senderSessionId;
      if (!sender) return false;
      return (source.kind === 'agent-message' && sender === own.parent_session_id && sessions.some(row => row.session_id === sender))
        || await this.host.directChild(owner, sender);
    }
    if (source?.kind === 'tool-jobs') {
      const history = await this.host.history(run, owner);
      if (!history) return false;
      await this.jobs(repo, run, history);
      return (await repo.native(run.id)).some(row => row.kind === 'job' && row.owner_id === owner && row.start_data && row.end_data);
    }
    return false;
  }

  private async jobs(repo: SkillRunRepo, run: SkillRunRow, session: DshSession): Promise<void> {
    const calls = await repo.calls(run.id);
    for (const event of session.ownEvents()) {
      if (!['job/registered', 'job/settled'].includes(event.type)) continue;
      const data = event.data;
      if (data.owner !== session.id || typeof data.jobId !== 'string') throw new Error('作业原生回执的所属会话不符。');
      const callId = data.toolCall?.callId, rootCallId = data.toolCall?.rootCallId;
      if (!calls.some(call => call.session_id === session.id && (call.call_id === callId || call.call_id === rootCallId))) throw new Error('原生作业缺少本次运行的工具执行意图。');
      await repo.nativeReceipt(run.id, 'job', session.id, data.jobId, event.type === 'job/registered' ? 'start' : 'end', data);
    }
  }

  async observe(repo: SkillRunRepo, run: SkillRunRow, recovering = false): Promise<{ pending: boolean; root: DshSession | null; histories: DshSession[] }> {
    await this.flush(run.id);
    const root = await this.host.history(run);
    if (!root) return { pending: false, root: null, histories: [] };
    const descendants = await this.host.descendants(run);
    const diagnostic = descendants.find(row => row.kind === 'diagnostic');
    if (diagnostic) throw new Error(`子任务 ${diagnostic.id} 的原生记录不可核验：${diagnostic.reason}`);
    const sessions = await repo.sessions(run.id);
    let pending = false;
    const histories: DshSession[] = [];
    for (const row of sessions) {
      const session = row.session_id === run.session_id ? root : await this.host.history(run, row.session_id);
      if (!session) throw new Error(`原生会话 ${row.session_id} 的历史缺失。`);
      histories.push(session);
      const parent = session.header.parentSession, parentId = typeof parent === 'string' ? parent : parent?.id;
      if (session.id !== row.session_id || session.header.cwd !== row.workspace_path || (parentId ?? null) !== row.parent_session_id
        || (row.session_id !== run.session_id && session.header.origin !== 'subagent')) throw new Error('原生运行会话的身份或归属不符。');
      await this.jobs(repo, run, session);
      if (this.host.busy(row.session_id)) pending = true;
      const turns = session.ownEvents().filter(event => event.type === 'turn/start');
      const ends = session.ownEvents().filter(event => event.type === 'turn/end');
      if (turns.some(turn => !ends.some(end => end.data.turn === turn.data.turn))) {
        if (recovering || !this.host.resident(row.session_id)) throw new Error('原生回合缺少结束依据，不能重复执行原动作。');
        pending = true;
      }
      const inputs = (await repo.inputs(run.id)).filter(input => input.session_id === row.session_id);
      // user/message also contains host-rendered time/runtime/skill context.
      // Only inbox admissions are execution inputs; the host's context
      // renderers do not grant a second task or become a human instruction.
      const admitted = new Set(session.ownEvents().filter(event => event.type === 'agent/inbox/spliced')
        .flatMap(event => event.data.inserted ?? []).map(message => message.id));
      for (const end of ends) {
        const consumed = consumedTurn(session, end.data.turn).messageIds;
        if ([...consumed].some(id => admitted.has(id) && !inputs.some(input => input.message_id === id && input.accepted))) throw new Error('原生回合包含尚未核验归属的输入。');
        if (end.data.reason?.kind === 'interrupted') throw new Error('原生回合被中断，需先核对实际执行结果。');
      }
      const knownJobs = (await repo.native(run.id)).filter(item => item.kind === 'job' && item.owner_id === row.session_id);
      if (this.host.ownedJobs(row.session_id).some(job => !knownJobs.some(item => item.native_id === job.id))) {
        const fresh = await this.host.history(run, row.session_id);
        if (fresh) await this.jobs(repo, run, fresh);
        const recorded = await repo.native(run.id);
        if (this.host.ownedJobs(row.session_id).some(job => !recorded.some(item => item.kind === 'job' && item.owner_id === row.session_id && item.native_id === job.id))) throw new Error('活动作业缺少持久归属回执。');
        pending = true;
      }
    }
    await this.flush(run.id);
    const native = await repo.native(run.id);
    for (const child of descendants) {
      const activations = native.filter(row => row.kind === 'activation' && row.owner_id === child.parentId && row.start_data?.id === child.id);
      if (!activations.length) {
        if (pending && !recovering) continue;
        throw new Error(`子任务 ${child.id} 缺少启动回执。`);
      }
      if (child.mode !== 'external' && !sessions.some(row => row.session_id === child.id && row.parent_session_id === child.parentId)) throw new Error('原生子任务尚未纳入本次运行的权限和动作记录。');
      for (const activation of activations) {
        if (!activation.end_data) {
          if (recovering) throw new Error('子任务缺少结束回执，需核对原执行。');
          pending = true;
        } else if (!['completed', 'aborted', 'error', 'max-tokens', 'refusal'].includes(activation.end_data.stopReason)) throw new Error('子任务返回了无法核验的终止状态。');
      }
    }
    for (const item of native.filter(row => row.kind === 'job')) {
      if (!item.start_data) throw new Error('作业缺少启动回执。');
      if (!item.end_data) {
        const live = this.host.job(item.native_id, item.owner_id);
        if (!recovering && live && ['running', 'stopping'].includes(live.status)) pending = true;
        else {
          // A producer may settle after the earlier session snapshot. Read
          // the new durable edge before calling that ordinary race unknown.
          const history = await this.host.history(run, item.owner_id);
          if (history) await this.jobs(repo, run, history);
          const end = (await repo.native(run.id)).find(row => row.kind === 'job' && row.owner_id === item.owner_id && row.native_id === item.native_id)?.end_data;
          if (!end || end.producerReported !== true) throw new Error('作业没有可靠的结束回执，请核对实际结果。');
          pending = true;
        }
      } else if (item.end_data.producerReported !== true) throw new Error('作业生产者没有确认结束，可能仍有外部执行。');
    }
    if ([...this.activations.values()].some(item => item.run.id === run.id)) {
      if (recovering || !pending) throw new Error('子任务生命周期与原生目录尚未对应，需核对原执行。');
    }
    return { pending: pending || this.host.busy(run.session_id), root, histories };
  }
}
