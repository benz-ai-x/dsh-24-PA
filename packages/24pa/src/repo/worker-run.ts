import { randomUUID } from 'node:crypto';
import type { PaDb, PaQueryer } from '../db.js';
import type { WorkItemRow, WorkExecutionScope } from './work.js';
import { initializeRunControl, RunControlRepo } from './run-control.js';
import { finishRunControl } from '../run-control.js';
import { deliveryFingerprint } from './plan-result.js';
import type { OutboxRow } from './outbox.js';
import { taskPlanFingerprint } from '../task-plan-access.js';
import type { WorkChange } from './work-control.js';

export interface WorkerRunRow {
  id: string; work_item_id: string; session_id: string; source: 'manual' | 'continuation';
  status: string; instruction: string; snapshot: { title: string; role: string; origin: string; delivery: string;
    workspacePath: string; workspaceId: string; parentSessionId: string; startedAt: number; completionCriteria: string | null;
    skill: unknown; fromRunId: string | null; [key: string]: unknown };
  progress: string | null; progress_detail: WorkItemRow['progress_detail']; stop_reason: string | null; result: string | null; result_ref: unknown; outbox_key: string | null;
  created_at: Date; updated_at: Date;
}
export interface WorkerInputRow {
  execution_id: string; run_id: string; scope: WorkExecutionScope; instruction: string;
  status: 'prepared' | 'received' | 'adopted' | 'rejected' | 'unknown'; native_message_id: string | null;
  adopted_turn: number | null; reason: string | null; created_at: Date;
}
const terminal = ['completed', 'failed', 'stopped', 'timed_out', 'rejected'];

/** Journal only. WorkItemLifecycle remains the ordinary Worker's execution
 * owner; a shared native child is never registered as a managed Skill session. */
export class WorkerRunRepo {
  constructor(private readonly db: PaDb) {}
  async get(id: string, tx: PaQueryer = this.db): Promise<WorkerRunRow | null> {
    return (await tx.query<WorkerRunRow>('select * from pa24.worker_run where id = $1', [id])).rows[0] ?? null;
  }
  async current(workId: string, tx: PaQueryer = this.db): Promise<WorkerRunRow | null> {
    return (await tx.query<WorkerRunRow>('select r.* from pa24.worker_run r join pa24.work_item w on w.active_worker_run_id = r.id where w.id = $1', [workId])).rows[0] ?? null;
  }
  async begin(tx: PaQueryer, item: WorkItemRow, instruction: string): Promise<string | null> {
    if (item.execution_mode === 'skill') return null;
    const scope = item.execution_scope!;
    let run = await this.current(item.id, tx);
    if (!run || terminal.includes(run.status)) {
      const id = `worker-run-${randomUUID()}`;
      const snapshot = { title: item.title, role: item.role, origin: item.origin, delivery: item.delivery,
        workspacePath: scope.workspacePath, workspaceId: scope.workspaceId, parentSessionId: scope.parentSessionId,
        startedAt: Date.now(), completionCriteria: item.completion_criteria ?? null, skill: item.skill_definition ?? null, fromRunId: run?.id ?? null };
      run = (await tx.query<WorkerRunRow>(`insert into pa24.worker_run (id, work_item_id, session_id, source, status, instruction, snapshot)
        values ($1,$2,$3,$4,'running',$5,$6) returning *`, [id, item.id, scope.childSessionId, snapshot.fromRunId ? 'continuation' : 'manual', instruction, JSON.stringify(snapshot)])).rows[0]!;
      await initializeRunControl(tx, id);
      await tx.query('update pa24.work_item set active_worker_run_id = $2 where id = $1', [item.id, id]);
    }
    await tx.query(`insert into pa24.worker_run_input (execution_id, run_id, scope, instruction, status)
      values ($1,$2,$3,$4,'prepared')`, [item.execution_id, run.id, JSON.stringify(scope), instruction]);
    await tx.query("update pa24.worker_run set status = 'running', updated_at = now() where id = $1", [run.id]);
    return run.id;
  }
  async inputReceipt(executionId: string, status: WorkerInputRow['status'], nativeId?: string, turn?: number, reason?: string, tx: PaQueryer = this.db): Promise<void> {
    await tx.query(`update pa24.worker_run_input set status = $2, native_message_id = coalesce($3, native_message_id),
      adopted_turn = coalesce($4, adopted_turn), reason = $5, updated_at = now()
      where execution_id = $1 and (status <> 'adopted' or $2 = 'adopted')`, [executionId, status, nativeId ?? null, turn ?? null, reason ?? null]);
  }
  async inputs(id: string): Promise<WorkerInputRow[]> {
    return (await this.db.query<WorkerInputRow>('select * from pa24.worker_run_input where run_id = $1 order by created_at, execution_id', [id])).rows;
  }
  async freeze(id: string, execution: Record<string, unknown>): Promise<void> {
    await this.db.withTransaction(async tx => {
      const run = (await tx.query<WorkerRunRow>('select * from pa24.worker_run where id = $1 for update', [id])).rows[0];
      if (!run || run.snapshot.execution) return;
      await tx.query('update pa24.worker_run set snapshot = $2 where id = $1', [id, JSON.stringify({ ...run.snapshot, execution })]);
    });
  }
  async rejected(workId: string, reason: string): Promise<void> {
    await this.db.withTransaction(async tx => {
      const run = await this.current(workId, tx); if (!run) return;
      const adopted = await tx.query("select execution_id from pa24.worker_run_input where run_id = $1 and status in ('received','adopted')", [run.id]);
      if (adopted.rowCount) return;
      await tx.query("update pa24.worker_run_input set status = 'rejected', reason = $2 where run_id = $1 and status = 'prepared'", [run.id, reason]);
      await tx.query("update pa24.worker_run set status = 'rejected', progress = $2 where id = $1", [run.id, reason]);
    });
  }
  async updateForWork(tx: PaQueryer, item: WorkItemRow): Promise<void> {
    if (item.execution_mode === 'skill') return;
    const status = item.status === 'waiting_input' ? 'waiting' : item.status === 'stopped' ? 'stopping' : item.status;
    await tx.query(`update pa24.worker_run set status = $2, progress = $3, result = case when $2 in ('completed','failed') then $4 else result end, result_ref = $5, progress_detail = $6, updated_at = now()
      where id = $1 and status not in ('completed','failed','stopped','timed_out','rejected')`,
    [item.active_worker_run_id, status, item.progress, item.result, item.result_ref ? JSON.stringify(item.result_ref) : null, item.progress_detail ? JSON.stringify(item.progress_detail) : null]);
  }
  async finish(tx: PaQueryer, item: WorkItemRow, outboxKey: string): Promise<void> {
    await this.updateForWork(tx, item);
    if (!item.active_worker_run_id) return;
    await tx.query('update pa24.worker_run set outbox_key = $2 where id = $1', [item.active_worker_run_id, outboxKey]);
    const row = (await tx.query<{ state: import('../run-control.js').RunControl }>('select state from pa24.skill_run_control where run_id = $1 for update', [item.active_worker_run_id])).rows[0];
    if (row) {
      finishRunControl(row.state, item.status === 'completed' ? 'completed' : 'failed');
      await tx.query('update pa24.skill_run_control set state = $2, revision = revision + 1 where run_id = $1', [item.active_worker_run_id, JSON.stringify(row.state)]);
    }
  }
  async stop(workId: string, settled: boolean, status: 'stopped' | 'timed_out' = 'stopped', error?: string): Promise<void> {
    await this.db.withTransaction(async tx => {
      const run = await this.current(workId, tx); if (!run || !['running','waiting','stopping','needs_reconciliation'].includes(run.status)) return;
      const row = (await tx.query<{ state: import('../run-control.js').RunControl }>('select state from pa24.skill_run_control where run_id = $1 for update', [run.id])).rows[0];
      if (!row) return;
      row.state.stop ??= { requestedAt: Date.now(), settledAt: null, error: null };
      row.state.stop.error = error ?? null;
      if (settled) { row.state.stop.settledAt = Date.now(); finishRunControl(row.state, status); }
      await tx.query('update pa24.skill_run_control set state = $2, revision = revision + 1 where run_id = $1', [run.id, JSON.stringify(row.state)]);
      await tx.query('update pa24.worker_run set status = $2, progress = $3, stop_reason = $4, updated_at = now() where id = $1', [run.id, settled ? status : 'stopping',
        settled ? '宿主已确认停止；已完成动作和未知回执保留' : `已请求停止，等待宿主确认${error ? '：' + error : ''}`, status]);
      if (settled) await tx.query("update pa24.worker_run_call set status = 'unknown', updated_at = now() where run_id = $1 and status = 'running'", [run.id]);
    });
  }
  async call(id: string, tool: string, args: unknown): Promise<string> {
    const key = randomUUID();
    await this.db.query("insert into pa24.worker_run_call (id,run_id,tool,args,status) values ($1,$2,$3,$4,'running')", [key, id, tool, JSON.stringify(args ?? {})]);
    return key;
  }
  async callResult(id: string, status: 'succeeded' | 'failed' | 'unknown', result: unknown): Promise<void> {
    await this.db.withTransaction(async tx => {
      const row = (await tx.query<{ run_id: string }>('select run_id from pa24.worker_run_call where id = $1', [id])).rows[0];
      if (row && status === 'unknown') await this.block(row.run_id, '工具结果未知，请先核对已发生的动作；未开始新的模型或工具步骤。', tx);
      await tx.query('update pa24.worker_run_call set status = $2, result = $3, updated_at = now() where id = $1', [id, status, JSON.stringify(result ?? null)]);
    });
  }
  async block(id: string, reason: string, tx?: PaQueryer): Promise<void> {
    if (!tx) return this.db.withTransaction(query => this.block(id, reason, query));
    const run = await this.get(id, tx); if (!run) return;
    const item = (await tx.query<WorkItemRow>('select * from pa24.work_item where id = $1 for update', [run.work_item_id])).rows[0];
    // Late evidence belongs to its original run. It cannot resurrect a stopped
    // WorkItem or change a different continuation's state.
    if (item?.active_worker_run_id !== id || !['running','waiting_input','needs_reconciliation'].includes(item.status)) return;
    const blocked = await tx.query("update pa24.worker_run set status = 'needs_reconciliation', progress = $2, updated_at = now() where id = $1 and status in ('running','waiting','needs_reconciliation')", [id, reason]);
    if (blocked.rowCount) await tx.query("update pa24.work_item set status = 'needs_reconciliation', progress = $2, revision = revision + 1, updated_at = now() where id = $1", [item.id, reason]);
  }
  async evidence(id: string, tx: PaQueryer = this.db) {
    const calls = (await tx.query<{ id: string; tool: string; status: string; args: unknown; result: unknown }>('select * from pa24.worker_run_call where run_id = $1 order by created_at, id', [id])).rows;
    const inputs = (await tx.query<WorkerInputRow>('select * from pa24.worker_run_input where run_id = $1 order by created_at, execution_id', [id])).rows;
    const reviews = (await tx.query<WorkChange>("select * from pa24.work_change where record->>'op' = 'review' and record->>'phase' = 'completed' and record->'input'->>'runId' = $1 order by created_at desc", [id])).rows;
    const fingerprint = taskPlanFingerprint({ calls: calls.map(({ id, tool, status, args, result }) => ({ id, tool, status, args, result })),
      inputs: inputs.map(({ execution_id, native_message_id, status, adopted_turn, instruction }) => ({ execution_id, native_message_id, status, adopted_turn, instruction })) });
    return { calls, inputs, reviews, fingerprint, reviewed: reviews.some(row => (row.record.result as { fingerprint?: string })?.fingerprint === fingerprint) };
  }
  async review(change: WorkChange, input: Record<string, unknown>) {
    return this.db.withTransaction(async tx => {
      const run = (await tx.query<WorkerRunRow>('select * from pa24.worker_run where id = $1 for update', [input.runId])).rows[0];
      if (!run || run.work_item_id !== change.work_item_id || !terminal.includes(run.status)) throw new Error('请先确认原交办运行已经停止或结束。');
      const evidence = await this.evidence(run.id, tx);
      if (input.fingerprint !== evidence.fingerprint) throw new Error('运行证据已有新回执，请刷新后重新核对。');
      const calls = input.calls as Array<{ id: string; outcome: string; evidence: string }>;
      const unknown = evidence.calls.filter(call => ['running','unknown'].includes(call.status));
      if (!Array.isArray(calls) || calls.length !== unknown.length || unknown.some(call => calls.filter(row => row?.id === call.id).length !== 1)
        || calls.some(row => !['completed','not_performed','partial'].includes(row.outcome) || typeof row.evidence !== 'string' || !row.evidence.trim() || row.evidence.length > 4000)) throw new Error('须逐项核对所有未知动作并填写依据。');
      for (const key of ['summary','completed','remaining']) if (typeof input[key] !== 'string' || !String(input[key]).trim() || String(input[key]).length > 4000) throw new Error('请填写核对摘要、已完成与剩余步骤。');
      const unknownOperations = await tx.query("select id from pa24.action_operation where work_item_id = $1 and status in ('running','unknown')", [run.work_item_id]);
      if (unknownOperations.rowCount) throw new Error('关联平台动作仍待核对，请先修复原对象回执。');
      const result = { runId: run.id, fingerprint: evidence.fingerprint, summary: input.summary, completed: input.completed, remaining: input.remaining, calls };
      await tx.query('update pa24.work_change set record = $2 where request_id = $1', [change.request_id, JSON.stringify({ ...change.record, phase: 'completed', result })]);
      await tx.query("update pa24.work_item set progress = '人工核对已留档，接续须另行确认', revision = revision + 1, updated_at = now() where id = $1", [run.work_item_id]);
      return result;
    });
  }
  async continuation(workId: string, includeRunning = true, activeCalls?: ReadonlySet<string>): Promise<unknown[]> {
    const runs = (await this.db.query<WorkerRunRow>('select * from pa24.worker_run where work_item_id = $1 order by created_at, id', [workId])).rows;
    const context = [];
    for (const run of runs) {
      const evidence = await this.evidence(run.id);
      if (evidence.calls.some(call => call.status === 'unknown' || (includeRunning && call.status === 'running' && !activeCalls?.has(call.id))) && !evidence.reviewed) throw new Error('原运行含未核对动作，请先在运行记录逐项核对。');
      context.push({ runId: run.id, status: run.status, result: run.result, progress: run.progress_detail, calls: evidence.calls,
        review: evidence.reviews.find(row => (row.record.result as { fingerprint?: string })?.fingerprint === evidence.fingerprint)?.record.result ?? null });
    }
    return context;
  }
  async detail(id: string) {
    const run = await this.get(id); if (!run) throw new Error('交办运行记录不存在。');
    const evidence = await this.evidence(id);
    const deliveries = run.outbox_key ? (await this.db.query<OutboxRow>('select * from pa24.outbox where dedup_key = $1', [run.outbox_key])).rows.map(row => ({ ...row, fingerprint: deliveryFingerprint(row) })) : [];
    const operations = (await this.db.query("select * from pa24.action_operation where work_item_id = $1 order by created_at, id", [run.work_item_id])).rows;
    return { run, ...evidence, deliveries, operations, control: await new RunControlRepo(this.db).get(id) };
  }
}
