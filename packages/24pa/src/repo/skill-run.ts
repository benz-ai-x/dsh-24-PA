import { createHash, randomUUID } from 'node:crypto';
import type { PaDb, PaQueryer } from '../db.js';
import type { SkillDefinitionLike } from '../skills.js';
import type { SkillContract, SkillPackage } from '../skill-package.js';
import type { SkillEntryRow } from './skill.js';
import type { WorkItemRow } from './work.js';
import { initializeRunControl, type RunControlRow } from './run-control.js';
import { finishRunControl } from '../run-control.js';
import type { TaskPlanAuthorization, TaskPlanConfiguration } from '../task-plan.js';
import type { TaskPlanRow } from './task-plan.js';
import { hasExecutionCapacity } from './execution-capacity.js';

export type SkillRunStatus = 'pending' | 'running' | 'waiting' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'timed_out' | 'needs_reconciliation';
export interface SkillRunSnapshot {
  name: string;
  definition: SkillDefinitionLike;
  package: SkillPackage;
  contract: SkillContract | null;
  parameters: Record<string, unknown>;
  tools: string[];
  permissionHash: string;
  executionLimitMs?: number;
  provider?: { id: string; fingerprint: string };
  plan?: { id: string; title: string; generation: string; triggeredAt: string; source: 'schedule' | 'manual';
    configuration: TaskPlanConfiguration; authorization: TaskPlanAuthorization };
  continuation?: { fromRunId: string; instruction: string; runs: Array<{ id: string; status: string; result: string | null; calls: SkillRunCall[]; review: SkillRunReview['record'] | null }> };
}
export interface SkillRunRow {
  id: string; request_id: string; request_hash: string; work_item_id: string;
  skill_id: string; version_id: string; source_session_id: string; session_id: string;
  workspace_path: string; mode: 'local' | 'business' | 'template'; trial: boolean;
  snapshot: SkillRunSnapshot; status: SkillRunStatus; progress: string | null; result: string | null;
  delivery_status: 'not_requested'; recovery: { message: unknown } | null;
  created_at: Date; updated_at: Date;
  plan_id?: string | null; trigger_kind?: string | null; triggered_at?: Date | null;
}
export interface SkillRunCall {
  run_id: string; call_id: string; tool: string; arguments: Record<string, unknown>;
  status: 'running' | 'returned' | 'failed' | 'unknown'; result: unknown;
  session_id: string | null; root_call_id: string | null; final_result: unknown;
}
export interface SkillRunSession { run_id: string; session_id: string; parent_session_id: string | null; workspace_path: string }
export interface SkillRunInput { run_id: string; session_id: string | null; message_id: string; message: { id: string; source?: Record<string, unknown> }; accepted: boolean }
export interface SkillRunNative { run_id: string; kind: 'activation' | 'job'; owner_id: string; native_id: string; start_data: Record<string, any> | null; end_data: Record<string, any> | null }
export interface SkillRunReview {
  request_id: string; request_hash: string; run_id: string; evidence_hash: string; created_at: Date;
  record: { actor: string; summary: string; completed: string; remaining: string;
    calls: Array<{ sessionId: string; callId: string; outcome: 'completed' | 'not_performed' | 'partial'; evidence: string }>;
    native: Array<{ kind: string; ownerId: string; nativeId: string; evidence: string }> };
}
export type SkillRunAdmission = Omit<SkillRunRow, 'id' | 'session_id' | 'work_item_id' | 'status' | 'progress' | 'result' | 'delivery_status' | 'recovery' | 'created_at' | 'updated_at'>
  & { workItemId?: string; expectedRevision: number | null; originalRerun?: boolean };
// jsonb key order differs from SQLite JSON; hashes describe content, not its
// serialization order or backend-specific timestamp representation.
const canonical = (value: any): any => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const evidenceHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// Native descriptors can contain NUL separators (agent-instructions scope).
// PostgreSQL jsonb cannot store those string values. A versioned envelope
// preserves their exact JSON on both backends; legacy object rows still read.
const decodeInput = (row: SkillRunInput): SkillRunInput => {
  const stored = row.message as unknown as { encoding?: string; jsonBase64?: string; id?: string };
  return !stored.id && stored.encoding === 'native-input-json-base64-v1' && typeof stored.jsonBase64 === 'string'
    ? { ...row, message: JSON.parse(Buffer.from(stored.jsonBase64, 'base64').toString('utf8')) } : row;
};

/** One durable run admission owns its WorkItem, input and tool intents.
 * A retry key is not a new run, and a new run cannot bypass an unresolved one. */
export class SkillRunRepo {
  constructor(private readonly db: PaDb) {}
  async evidence(id: string, tx: PaQueryer = this.db) {
    const calls = (await tx.query<SkillRunCall>('select * from pa24.skill_run_call where run_id = $1 order by session_id, call_id', [id])).rows;
    const native = (await tx.query<SkillRunNative>('select * from pa24.skill_run_native where run_id = $1 order by kind, owner_id, native_id', [id])).rows;
    const inputs = (await tx.query<SkillRunInput>('select * from pa24.skill_run_input where run_id = $1 order by message_id', [id])).rows.map(decodeInput);
    const sessions = (await tx.query<SkillRunSession>('select * from pa24.skill_run_session where run_id = $1 order by session_id', [id])).rows;
    const reviews = (await tx.query<SkillRunReview>('select * from pa24.skill_run_review where run_id = $1 order by created_at desc, request_id desc', [id])).rows;
    const hash = evidenceHash({ calls, native, inputs, sessions });
    return { calls, native, inputs, sessions, reviews, fingerprint: hash, reviewed: reviews.some(review => review.evidence_hash === hash) };
  }
  async review(input: { runId: string; requestId: string; requestHash: string; fingerprint: string; record: SkillRunReview['record']; stopConfirmed?: boolean }): Promise<SkillRunReview> {
    return this.db.withTransaction(async tx => {
      const run = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1 for update', [input.runId])).rows[0];
      if (!run) throw new Error('运行记录不存在。');
      const prior = (await tx.query<SkillRunReview>('select * from pa24.skill_run_review where request_id = $1', [input.requestId])).rows[0];
      if (prior) {
        if (prior.request_hash !== input.requestHash || prior.run_id !== input.runId) throw new Error('核对操作标识已用于其他内容。');
        if (input.stopConfirmed) {
          if ((await this.evidence(run.id, tx)).fingerprint !== prior.evidence_hash) throw new Error('运行证据已有新回执，请刷新后重新核对。');
          await this.confirmReviewedStop(run.id, prior.request_id, tx);
        }
        return prior;
      }
      if (!['needs_reconciliation', 'stopped', 'failed', 'timed_out'].includes(run.status)) throw new Error('请先停止原运行，再保存核对结论。');
      const evidence = await this.evidence(run.id, tx);
      if (evidence.fingerprint !== input.fingerprint) throw new Error('运行证据已有新回执，请刷新后重新核对。');
      const unknown = evidence.calls.filter(call => ['running', 'unknown'].includes(call.status));
      if (unknown.length !== input.record.calls.length || unknown.some(call => input.record.calls.filter(item => item.sessionId === call.session_id && item.callId === call.call_id).length !== 1)) throw new Error('须逐项核对所有未决工具动作。');
      const unfinished = evidence.native.filter(item => !item.end_data || item.end_data.producerReported === false);
      if (unfinished.length !== input.record.native.length || unfinished.some(item => input.record.native.filter(row => row.kind === item.kind && row.ownerId === item.owner_id && row.nativeId === item.native_id).length !== 1)) throw new Error('须逐项提供未决子任务／作业已结束的核对依据。');
      if ((await this.unresolvedOperations(run.work_item_id, tx)).length) throw new Error('关联平台动作仍待核对；请先修复原对象回执，不能用运行核对绕过。');
      const saved = (await tx.query<SkillRunReview>(`insert into pa24.skill_run_review (request_id, request_hash, run_id, evidence_hash, record)
        values ($1,$2,$3,$4,$5) returning *`, [input.requestId, input.requestHash, run.id, input.fingerprint, JSON.stringify(input.record)])).rows[0]!;
      if (input.stopConfirmed) await this.confirmReviewedStop(run.id, saved.request_id, tx);
      const status = run.status === 'needs_reconciliation' ? 'stopped' : run.status;
      await tx.query("update pa24.skill_run set status = $2, progress = '人工核对已留档；本次运行结束，接续须另行预览确认', updated_at = now() where id = $1", [run.id, status]);
      await tx.query("update pa24.work_item set status = $3, progress = '人工核对已留档，等待显式接续', updated_at = now() where id = $1 and active_skill_run_id = $2", [run.work_item_id, run.id, status === 'timed_out' ? 'failed' : status]);
      return saved;
    });
  }
  private async confirmReviewedStop(id: string, reviewId: string, tx: PaQueryer): Promise<void> {
    const control = (await tx.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1 for update', [id])).rows[0];
    if (!control?.state.stop || control.state.stop.settledAt !== null) return;
    control.state.stop = { ...control.state.stop, settledAt: Date.now(), error: null, reviewRequestId: reviewId };
    await tx.query('update pa24.skill_run_control set state = $2, revision = revision + 1, updated_at = now() where run_id = $1', [id, JSON.stringify(control.state)]);
  }
  async continuation(id: string, tx: PaQueryer = this.db) {
    const selected = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1', [id])).rows[0];
    if (!selected) throw new Error('原运行不存在。');
    const runs = (await tx.query<SkillRunRow>('select * from pa24.skill_run where work_item_id = $1 order by created_at, id', [selected.work_item_id])).rows;
    const context = [];
    for (const run of runs) {
      const evidence = await this.evidence(run.id, tx);
      if (['pending', 'running', 'waiting', 'stopping', 'needs_reconciliation'].includes(run.status)
        || await this.stopPending(run.id, tx)
        || (!evidence.reviewed && (evidence.reviews.length || evidence.calls.some(call => ['running', 'unknown'].includes(call.status))
          || evidence.native.some(item => !item.end_data || item.end_data.producerReported === false)))) throw new Error('原交办仍在执行或结果待核对，不能新开运行绕过。');
      context.push({ id: run.id, status: run.status, result: run.result, calls: evidence.calls,
        review: evidence.reviews.find(review => review.evidence_hash === evidence.fingerprint)?.record ?? null });
    }
    if ((await this.unresolvedOperations(selected.work_item_id, tx)).length) throw new Error('原交办的外部动作仍待核对，不能重跑绕过。');
    return context;
  }
  async checkNewWork(skillId: string, tx: PaQueryer = this.db): Promise<void> {
    const runs = (await tx.query<SkillRunRow>('select * from pa24.skill_run where skill_id = $1', [skillId])).rows;
    for (const run of runs) {
      const evidence = await this.evidence(run.id, tx);
      const ended = ['completed', 'failed', 'stopped', 'timed_out'].includes(run.status);
      if (run.status === 'needs_reconciliation' || await this.stopPending(run.id, tx)
        || (!evidence.reviewed && (evidence.reviews.length || evidence.calls.some(call => call.status === 'unknown')
          || (ended && (evidence.calls.some(call => call.status === 'running') || evidence.native.some(item => !item.end_data || item.end_data.producerReported === false)))))
        || (await this.unresolvedOperations(run.work_item_id, tx)).length) throw new Error(`本 Skill 的运行 ${run.id} 仍有结果待核对，请先处理原记录，不能通过全新运行绕过。`);
    }
  }
  private async stopPending(id: string, tx: PaQueryer): Promise<boolean> {
    const control = (await tx.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1', [id])).rows[0];
    return !!control?.state.stop && control.state.stop.settledAt === null;
  }
  async hasUnsettled(): Promise<boolean> {
    if ((await this.unfinished()).length) return true;
    const runs = (await this.db.query<SkillRunRow>('select * from pa24.skill_run')).rows;
    for (const run of runs) if (await this.isUnsettled(run, this.db)) return true;
    return false;
  }
  async isUnsettled(run: SkillRunRow, tx: PaQueryer): Promise<boolean> {
      const evidence = await this.evidence(run.id, tx);
      return ['pending', 'running', 'waiting', 'stopping', 'needs_reconciliation'].includes(run.status) || await this.stopPending(run.id, tx)
        || (!evidence.reviewed && !!(evidence.reviews.length
        || evidence.calls.some(call => ['running', 'unknown'].includes(call.status))
        || evidence.native.some(item => !item.end_data || item.end_data.producerReported === false)))
        || (await this.unresolvedOperations(run.work_item_id, tx)).length > 0;
  }
  async get(id: string): Promise<SkillRunRow | null> {
    return (await this.db.query<SkillRunRow>('select * from pa24.skill_run where id = $1', [id])).rows[0] ?? null;
  }
  async bySession(id: string): Promise<SkillRunRow | null> {
    return (await this.db.query<SkillRunRow>('select r.* from pa24.skill_run r join pa24.skill_run_session s on r.id = s.run_id where s.session_id = $1', [id])).rows[0] ?? null;
  }
  async latestForWork(id: string): Promise<SkillRunRow | null> {
    return (await this.db.query<SkillRunRow>('select r.* from pa24.skill_run r join pa24.work_item w on w.active_skill_run_id = r.id where w.id = $1', [id])).rows[0] ?? null;
  }
  async repeated(requestId: string, hash: string): Promise<SkillRunRow | null> {
    const row = (await this.db.query<SkillRunRow>('select * from pa24.skill_run where request_id = $1', [requestId])).rows[0];
    if (row && row.request_hash !== hash) throw new Error('运行操作标识已用于不同输入，请刷新后重试。');
    return row ?? null;
  }
  async list(skillId?: string, offset = 0, limit = 20) {
    const filter = skillId ? 'where skill_id = $1' : '';
    const values = skillId ? [skillId] : [];
    const count = (await this.db.query<{ count: string }>(`select count(*) as count from pa24.skill_run ${filter}`, values)).rows[0]!;
    const rows = (await this.db.query<Omit<SkillRunRow, 'snapshot'>>(`select id, request_id, work_item_id, skill_id, version_id, source_session_id, session_id,
      workspace_path, mode, trial, status, progress, result, delivery_status, created_at, updated_at from pa24.skill_run ${filter}
      order by created_at desc, id limit $${values.length + 1} offset $${values.length + 2}`, [...values, limit, offset])).rows;
    return { rows, total: Number(count.count) };
  }
  async unfinished(): Promise<SkillRunRow[]> {
    return (await this.db.query<SkillRunRow>(`select r.* from pa24.skill_run r where r.status in ('pending', 'running', 'waiting', 'stopping')
      or (r.status = 'timed_out' and exists (select 1 from pa24.skill_run_control c where c.run_id = r.id
        and c.state->'stop' is not null and c.state->'stop'->>'settledAt' is null)) order by r.created_at, r.id`)).rows;
  }
  async unresolvedOperations(workId: string, tx: PaQueryer = this.db): Promise<unknown[]> {
    return (await tx.query(`select * from pa24.action_operation where
      (work_item_id = $1 or work_item_id in (select s.session_id from pa24.skill_run_session s
        join pa24.skill_run r on r.id = s.run_id where r.work_item_id = $1))
      and (status in ('running', 'unknown') or (status = 'failed' and receipt->>'_externalResult' is not null))`, [workId])).rows;
  }
  async nativeDeliveries(id: string): Promise<Array<{ dedup_key: string; target: string; status: string; content: { text?: string } }>> {
    return (await this.db.query<{ dedup_key: string; target: string; status: string; content: { text?: string } }>(`select o.* from pa24.outbox o
      join pa24.skill_run_session s on o.target = s.parent_session_id and o.dedup_key like 'workitem:' || s.session_id || ':%'
      where s.run_id = $1 and o.channel = 'local'`, [id])).rows;
  }
  async admit(input: SkillRunAdmission): Promise<SkillRunRow> {
    return (await this.admitResult(input)).run;
  }
  async admitResult(input: SkillRunAdmission): Promise<{ run: SkillRunRow; repeated: boolean }> {
    return this.db.withTransaction(async tx => {
      await this.lockAdmission(input.skill_id, tx);
      const repeated = !!(await tx.query('select id from pa24.skill_run where request_id = $1', [input.request_id])).rowCount;
      return { run: await this.admitOn(input, tx), repeated };
    });
  }
  async admitOn(input: SkillRunAdmission, tx: PaQueryer): Promise<SkillRunRow> {
      // Files have no managed entry to lock. A durable identity lock gives
      // both providers the same cross-process admission serialization.
      await this.lockAdmission(input.skill_id, tx);
      // Serialize all starts/edits of this skill, including cross-process starts.
      const entry = (await tx.query<SkillEntryRow>('select * from pa24.skill_entry where id = $1 for update', [input.skill_id])).rows[0];
      const prior = (await tx.query<SkillRunRow>('select * from pa24.skill_run where request_id = $1', [input.request_id])).rows[0];
      if (prior) {
        if (prior.request_hash !== input.request_hash) throw new Error('运行操作标识已用于不同输入。');
        return prior;
      }
      if (input.snapshot.provider) {
        const alias = (await tx.query<SkillEntryRow>('select * from pa24.skill_entry where name = $1 for update', [input.snapshot.definition.name])).rows[0];
        if (entry || alias || input.expectedRevision !== null || input.snapshot.provider.id !== input.skill_id
          || !/^(builtin|project-dsh):/.test(input.skill_id) || input.version_id !== input.snapshot.package.hash) throw new Error('文件 Skill 来源或版本不符，不能绕过受管状态。');
      } else {
        if (!entry || entry.status === 'deleted' || entry.status === 'disabled' || entry.revision !== input.expectedRevision) throw new Error('Skill 状态或版本已改变，请重新预览。');
        if (!input.trial && !input.originalRerun && (entry.status !== 'enabled' || entry.active_version !== input.version_id)) throw new Error('正式运行须选择当前启用版本。');
        const version = (await tx.query<{ id: string }>('select id from pa24.skill_version where id = $1 and skill_id = $2', [input.version_id, input.skill_id])).rows[0];
        if (!version) throw new Error('Skill 版本不存在。');
      }
      const name = entry?.name ?? input.snapshot.definition.name;
      const id = randomUUID(), sessionId = `pa24-skill-${id}`, workId = input.workItemId ?? `pa24-work-skill-${randomUUID()}`;
      if (input.workItemId) {
        const work = (await tx.query<WorkItemRow>('select * from pa24.work_item where id = $1 for update', [workId])).rows[0];
        if (!work || work.execution_mode !== 'skill' || work.parent_session_id !== input.source_session_id) throw new Error('原助理交办归属不符。');
        const unresolved = await tx.query("select id from pa24.skill_run where work_item_id = $1 and status in ('pending', 'running', 'waiting', 'stopping', 'needs_reconciliation')", [workId]);
        if (input.snapshot.continuation) {
          const chain = await this.continuation(input.snapshot.continuation.fromRunId, tx);
          if (evidenceHash(chain) !== evidenceHash(input.snapshot.continuation.runs)) throw new Error('接续依据已有变化，请重新预览。');
          const original = (await tx.query<{ work_item_id: string }>('select work_item_id from pa24.skill_run where id = $1', [input.snapshot.continuation.fromRunId])).rows[0];
          if (original?.work_item_id !== workId) throw new Error('接续记录与交办归属不符。');
        }
        else {
          const priorRun = (await tx.query<{ id: string }>('select id from pa24.skill_run where work_item_id = $1 limit 1', [workId])).rows[0];
          if (priorRun) await this.continuation(priorRun.id, tx);
        }
        const unknownOperations = await tx.query(`select id from pa24.action_operation where
          (work_item_id = $1 or work_item_id in (select s.session_id from pa24.skill_run_session s
            join pa24.skill_run r on r.id = s.run_id where r.work_item_id = $1))
          and (status in ('running', 'unknown') or (status = 'failed' and receipt->>'_externalResult' is not null))`, [workId]);
        if (unresolved.rowCount || unknownOperations.rowCount) throw new Error('原交办仍在执行或结果待核对，不能新开运行绕过。');
      } else {
        await this.checkNewWork(input.skill_id, tx);
        await tx.query(`insert into pa24.work_item (id, title, role, instruction, origin, parent_session_id, delivery, status, execution_mode)
          values ($1, $2, 'skill', $3, 'local', $4, $5, 'queued', 'skill')`, [workId, input.snapshot.name, input.snapshot.definition.content, input.source_session_id, `local:${input.source_session_id}`]);
      }
      await tx.query(`update pa24.work_item set status = 'queued', progress = 'Skill 运行已接纳，等待执行名额', result = null,
        child_session_id = $2, skill = $3, skill_definition = $4, active_skill_run_id = $5, recovery_gen = recovery_gen + 1, updated_at = now() where id = $1`,
      [workId, input.mode === 'business' ? sessionId : null, name, JSON.stringify({
        name, description: input.snapshot.definition.description, source: input.snapshot.provider ? input.skill_id.split(':')[0] : 'pa24-managed', track: input.mode === 'template' ? 'template' : 'agent',
        metadata: input.snapshot.definition.metadata, content: input.snapshot.definition.content,
      }), id]);
      const run = (await tx.query<SkillRunRow>(`insert into pa24.skill_run
        (id, request_id, request_hash, work_item_id, skill_id, version_id, source_session_id, session_id, workspace_path, mode, trial, snapshot, plan_id, trigger_kind, triggered_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [id, input.request_id, input.request_hash, workId, input.skill_id, input.version_id, input.source_session_id, sessionId,
        input.workspace_path, input.mode, input.trial, JSON.stringify(input.snapshot), input.plan_id ?? null, input.trigger_kind ?? null, input.triggered_at ?? null])).rows[0]!;
      await tx.query('insert into pa24.skill_run_session (run_id, session_id, parent_session_id, workspace_path) values ($1,$2,$3,$4)',
        [run.id, sessionId, input.mode === 'business' ? input.source_session_id : null, input.workspace_path]);
      await initializeRunControl(tx, run.id, input.snapshot.executionLimitMs);
      return run;
  }
  async lockAdmission(skillId: string, tx: PaQueryer): Promise<void> {
    await tx.query('insert into pa24.skill_run_admission_guard (id) values ($1) on conflict (id) do nothing', [skillId]);
    await tx.query('select id from pa24.skill_run_admission_guard where id = $1 for update', [skillId]);
  }
  async transition(id: string, status: SkillRunStatus, progress: string, result?: string): Promise<SkillRunRow | null> {
    return this.db.withTransaction(async tx => {
      const row = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1 for update', [id])).rows[0];
      if (!row || ['completed', 'failed', 'stopped', 'timed_out', 'needs_reconciliation'].includes(row.status)) return row ?? null;
      if (row.status === 'stopping' && !['stopped', 'timed_out', 'needs_reconciliation'].includes(status)) return row;
      const next = (await tx.query<SkillRunRow>('update pa24.skill_run set status = $2, progress = $3, result = $4, updated_at = now() where id = $1 returning *',
        [id, status, progress, result ?? row.result])).rows[0]!;
      await tx.query('update pa24.work_item set status = $2, progress = $3, result = $4, updated_at = now() where id = $1 and active_skill_run_id = $5',
        [row.work_item_id, status === 'pending' ? 'queued' : status === 'stopping' ? 'running' : status === 'waiting' ? 'waiting_input' : status === 'timed_out' ? 'failed' : status, progress, next.result, id]);
      if (['completed', 'failed', 'stopped', 'timed_out', 'needs_reconciliation'].includes(status)) {
        const control = (await tx.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1 for update', [id])).rows[0];
        if (control) {
          finishRunControl(control.state, status as NonNullable<RunControlRow['state']['terminal']>['status']);
          await tx.query('update pa24.skill_run_control set state = $2, revision = revision + 1, updated_at = now() where run_id = $1', [id, JSON.stringify(control.state)]);
        }
      }
      return next;
    });
  }
  async rejectPendingPlanRun(id: string, reason: string): Promise<void> {
    await this.db.withTransaction(async tx => {
      const run = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1', [id])).rows[0];
      if (run?.plan_id) await this.cancelQueuedPlan(run.plan_id, reason, tx, run.id);
    });
  }
  async cancelQueuedPlan(id: string, reason: string, tx: PaQueryer, runId?: string): Promise<void> {
    const runs = (await tx.query<SkillRunRow>(`update pa24.skill_run set status = 'stopped', progress = $2, updated_at = now() where plan_id = $1 and status = 'pending'
      ${runId ? 'and id = $3' : ''} returning *`, runId ? [id, reason, runId] : [id, reason])).rows;
    for (const run of runs) {
      await tx.query("update pa24.work_item set status = 'stopped', progress = $2, updated_at = now() where id = $1 and active_skill_run_id = $3", [run.work_item_id, reason, run.id]);
      const control = (await tx.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1 for update', [run.id])).rows[0];
      if (control) {
        finishRunControl(control.state, 'stopped');
        await tx.query('update pa24.skill_run_control set state = $2, revision = revision + 1, updated_at = now() where run_id = $1', [run.id, JSON.stringify(control.state)]);
      }
      await tx.query("update pa24.plan_trigger set status = 'skipped', reason = $2, updated_at = now() where run_id = $1 and status = 'queued'", [run.id, reason]);
    }
  }
  async claimLaunch(id: string, progress: string, limit = 2): Promise<boolean> {
    return this.db.withTransaction(async tx => {
      const capacity = await hasExecutionCapacity(tx, limit, { runId: id });
      const selected = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1', [id])).rows[0];
      if (!selected || selected.status !== 'pending') return false;
      if (selected.plan_id) {
        const plan = (await tx.query<TaskPlanRow>('select * from pa24.digest_plan where id = $1 for update', [selected.plan_id])).rows[0];
        const blocked = (await tx.query('select key from pa24.task_plan_block where plan_id = $1', [selected.plan_id])).rowCount
          || (await tx.query('select plan_id from pa24.skill_plan_block where plan_id = $1', [selected.plan_id])).rowCount;
        if (!plan || plan.recycled_at || plan.delete_when_idle || blocked || (selected.trigger_kind === 'schedule'
          && (!plan.owner_enabled || plan.status !== 'active' || plan.schedule_generation !== selected.snapshot.plan?.generation))) {
          await this.cancelQueuedPlan(selected.plan_id, '计划已暂停、删除或阻断，未启动的排队运行已停止。', tx);
          return false;
        }
      }
      if (!capacity) return false;
      const run = (await tx.query<SkillRunRow>("update pa24.skill_run set status = 'running', progress = $2, updated_at = now() where id = $1 and status = 'pending' returning *", [id, progress])).rows[0];
      if (!run) return false;
      await tx.query("update pa24.work_item set status = 'running', progress = $2, updated_at = now() where id = $1 and active_skill_run_id = $3", [run.work_item_id, progress, id]);
      await tx.query("update pa24.plan_trigger set status = 'started', updated_at = now() where run_id = $1 and status = 'queued'", [id]);
      return true;
    });
  }
  async calls(id: string): Promise<SkillRunCall[]> {
    return (await this.db.query<SkillRunCall>('select * from pa24.skill_run_call where run_id = $1 order by created_at, call_id', [id])).rows;
  }
  async beginCall(id: string, callId: string, tool: string, args: Record<string, unknown>, sessionId?: string, rootCallId?: string): Promise<void> {
    await this.db.withTransaction(async tx => {
      const run = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1 for update', [id])).rows[0];
      if (!run || run.status !== 'running') throw new Error('运行已停止或等待核对，未执行此工具。');
      const inserted = await tx.query(`insert into pa24.skill_run_call (run_id, call_id, tool, arguments, status, session_id, root_call_id) values ($1, $2, $3, $4, 'running', $5, $6)
        on conflict (run_id, session_id, call_id) do nothing returning call_id`, [id, callId, tool, JSON.stringify(args), sessionId ?? run.session_id, rootCallId ?? callId]);
      if (!inserted.rowCount) throw new Error('此工具调用已有执行意图，不能重复执行。');
    });
  }
  async finishCall(id: string, callId: string, result: unknown, status: SkillRunCall['status'], sessionId?: string): Promise<void> {
    await this.db.query(`update pa24.skill_run_call set status = $3, result = $4, updated_at = now()
      where run_id = $1 and call_id = $2 and session_id = $5 and status = 'running'`,
      [id, callId, status, JSON.stringify(result), sessionId ?? (await this.get(id))?.session_id]);
  }
  async finalCall(id: string, call: { callId: string; sessionId: string; rootCallId?: string; name: string; arguments: unknown }, result: unknown, unknown: boolean): Promise<void> {
    // A final projection/cancellation can make an observed dispatch uncertain;
    // it cannot erase the dispatch receipt or clear an earlier uncertainty.
    await this.db.query(`insert into pa24.skill_run_call (run_id, call_id, session_id, root_call_id, tool, arguments, status, final_result)
      values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (run_id, session_id, call_id) do update set
      final_result = excluded.final_result, status = case when $9 then 'unknown' else pa24.skill_run_call.status end, updated_at = now()`,
      [id, call.callId, call.sessionId, call.rootCallId ?? call.callId, call.name, JSON.stringify(call.arguments), unknown ? 'unknown' : 'failed', JSON.stringify(result), unknown]);
  }
  async input(id: string, message: { id: string }, accepted: boolean, sessionId?: string): Promise<void> {
    const stored = { encoding: 'native-input-json-base64-v1', jsonBase64: Buffer.from(JSON.stringify(message), 'utf8').toString('base64') };
    await this.db.query(`insert into pa24.skill_run_input (run_id, message_id, message, accepted, session_id) values ($1, $2, $3, $4, $5)
      on conflict (run_id, message_id) do nothing`, [id, message.id, JSON.stringify(stored), accepted, sessionId ?? null]);
  }
  async inputs(id: string): Promise<SkillRunInput[]> {
    return (await this.db.query<SkillRunInput>('select * from pa24.skill_run_input where run_id = $1 order by created_at, message_id', [id])).rows.map(decodeInput);
  }
  async sessions(id: string): Promise<SkillRunSession[]> {
    return (await this.db.query<SkillRunSession>('select * from pa24.skill_run_session where run_id = $1 order by created_at, session_id', [id])).rows;
  }
  async child(id: string, sessionId: string, parentId: string, cwd: string): Promise<void> {
    await this.db.withTransaction(async tx => {
      const parent = (await tx.query<SkillRunSession>('select * from pa24.skill_run_session where run_id = $1 and session_id = $2', [id, parentId])).rows[0];
      if (!parent) throw new Error('原生子任务的父会话尚未归属本次运行。');
      await tx.query(`insert into pa24.skill_run_session (run_id, session_id, parent_session_id, workspace_path) values ($1,$2,$3,$4)
        on conflict (session_id) do nothing`, [id, sessionId, parentId, cwd]);
      const row = (await tx.query<SkillRunSession>('select * from pa24.skill_run_session where session_id = $1', [sessionId])).rows[0];
      if (row?.run_id !== id || row.parent_session_id !== parentId || row.workspace_path !== cwd) throw new Error('原生子任务归属与已保存记录不符。');
    });
  }
  async native(id: string): Promise<SkillRunNative[]> {
    return (await this.db.query<SkillRunNative>('select * from pa24.skill_run_native where run_id = $1 order by created_at, native_id', [id])).rows;
  }
  async nativeReceipt(id: string, kind: SkillRunNative['kind'], owner: string, nativeId: string, phase: 'start' | 'end', data: unknown): Promise<void> {
    const column = phase === 'start' ? 'start_data' : 'end_data';
    await this.db.query(`insert into pa24.skill_run_native (run_id, kind, owner_id, native_id, ${column}) values ($1,$2,$3,$4,$5)
      on conflict (run_id, kind, owner_id, native_id) do update set ${column} = coalesce(pa24.skill_run_native.${column}, excluded.${column})`,
      [id, kind, owner, nativeId, JSON.stringify(data)]);
  }
  async recovery(id: string, message: unknown): Promise<void> {
    await this.db.query('update pa24.skill_run set recovery = $2, updated_at = now() where id = $1', [id, JSON.stringify({ message })]);
  }
}
