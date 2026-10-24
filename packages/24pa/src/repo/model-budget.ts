import { randomUUID } from 'node:crypto';
import type { PaDb, PaQueryer } from '../db.js';
import type { RunInput } from '../skill-run-host.js';
import { blockRun, clearRunBlock, canFinishDispatchedStep, budgetBlockKey } from '../run-control.js';
import type { RunControlRow } from './run-control.js';
import type { SkillRunRow } from './skill-run.js';
import type { WorkerRunRow } from './worker-run.js';
import { hasExecutionCapacity } from './execution-capacity.js';
import { budgetPeriod, budgetSummary, estimateUsage, type BudgetConfig, type BudgetMeasurement, type BudgetUsage } from '../model-budget.js';

export interface BudgetOwner { runId: string; workId: string; sessionId: string; kind: 'skill' | 'worker' }
export interface BudgetRequestRow { id: string; run_id: string; work_item_id: string; session_id: string; turn: number; step: number; event_id: string | null; record: BudgetMeasurement }
export interface BudgetReleaseRow { id: string; request_hash: string; run_id: string; work_item_id: string; session_id: string; status: 'ready' | 'used'; native_message_id: string | null;
  record: { control?: RunInput; originals?: RunInput[]; error?: string; executionId?: string; wake?: 'sending' | 'sent'; consumedBy?: string; consumedAt?: string }; created_at: Date }
export class ModelBudgetRepo {
  constructor(private readonly db: PaDb) {}
  private async lock(tx: PaQueryer) {
    await tx.query("insert into pa24.skill_run_admission_guard (id) values ('model-budget') on conflict (id) do nothing");
    await tx.query("select id from pa24.skill_run_admission_guard where id = 'model-budget' for update");
  }
  async owner(id: string, tx: PaQueryer = this.db): Promise<(BudgetOwner & { status: string }) | null> {
    const skill = (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1', [id])).rows[0];
    if (skill) return { runId: id, workId: skill.work_item_id, sessionId: skill.session_id, kind: 'skill', status: skill.status };
    const worker = (await tx.query<WorkerRunRow>('select * from pa24.worker_run where id = $1', [id])).rows[0];
    return worker ? { runId: id, workId: worker.work_item_id, sessionId: worker.session_id, kind: 'worker', status: worker.status } : null;
  }
  private async lockOwner(tx: PaQueryer, owner: BudgetOwner) {
    // Match each execution owner's existing transaction order: managed Skill
    // stops lock Run then WorkItem; ordinary Worker stops lock WorkItem first.
    if (owner.kind === 'skill') await tx.query('select id from pa24.skill_run where id = $1 for update', [owner.runId]);
    const work = (await tx.query<{ active_worker_run_id: string; active_skill_run_id: string; status: string }>('select * from pa24.work_item where id = $1 for update', [owner.workId])).rows[0];
    return { work, run: await this.owner(owner.runId, tx) };
  }
  private async current(tx: PaQueryer, owner: BudgetOwner) {
    const { work, run } = await this.lockOwner(tx, owner);
    const control = (await tx.query<RunControlRow>('select * from pa24.skill_run_control where run_id = $1 for update', [owner.runId])).rows[0];
    if (!run || run.workId !== owner.workId || !['running','waiting'].includes(run.status) || !work || !['running','waiting_input'].includes(work.status)
      || (owner.kind === 'worker' ? work.active_worker_run_id : work.active_skill_run_id) !== owner.runId || !control || control.state.terminal || control.state.stop) throw new Error('原运行已停止、结束或待核对；迟到预算放行不会复活。');
    return control;
  }
  async requests(tx: PaQueryer = this.db): Promise<BudgetRequestRow[]> { return (await tx.query<BudgetRequestRow>('select * from pa24.budget_request order by created_at, id')).rows; }
  async summary(config: BudgetConfig, timeZone: string, tx: PaQueryer = this.db) {
    const period = budgetPeriod(config, timeZone), rows = await this.requests(tx);
    const records = rows.filter(row => new Date(row.record.at) >= period.from && new Date(row.record.at) < period.to);
    return { ...budgetSummary(records.map(row => row.record), config), period, recordedSince: rows[0]?.record.at ?? null, records };
  }
  async waiters() { return (await this.db.query<{ run_id: string; work_item_id: string; session_id: string; reason: string }>('select * from pa24.budget_wait order by created_at')).rows; }
  async releases(id?: string): Promise<BudgetReleaseRow[]> { return (await this.db.query<BudgetReleaseRow>(`select * from pa24.budget_release ${id ? 'where run_id = $1' : ''} order by created_at, id`, id ? [id] : [])).rows; }
  async release(id: string): Promise<BudgetReleaseRow | null> { return (await this.db.query<BudgetReleaseRow>('select * from pa24.budget_release where id = $1', [id])).rows[0] ?? null; }
  async gate(owner: BudgetOwner, config: BudgetConfig, timeZone: string, request?: { turn: number; step: number; route: { provider: string; model: string } }): Promise<{ allowed: boolean; reason?: string }> {
    return this.db.withTransaction(async tx => {
      await this.lock(tx);
      const control = await this.current(tx, owner);
      const grant = (await tx.query<BudgetReleaseRow>("select * from pa24.budget_release where run_id = $1 and session_id = $2 and status = 'ready' order by created_at, id", [owner.runId, owner.sessionId])).rows[0];
      const summary = await this.summary(config, timeZone, tx);
      if (summary.reasons.length && !grant) {
        const reason = `${summary.reasons.join('；')}。原输入和进度已保存；已发请求可能继续计费。`;
        blockRun(control.state, { key: budgetBlockKey(owner.sessionId), kind: 'budget', reason });
        await tx.query('update pa24.skill_run_control set state = $2, revision = revision + 1 where run_id = $1', [owner.runId, JSON.stringify(control.state)]);
        await tx.query(`insert into pa24.budget_wait (run_id, work_item_id, session_id, reason) values ($1,$2,$3,$4)
          on conflict (run_id, session_id) do update set reason = excluded.reason`, [owner.runId, owner.workId, owner.sessionId, reason]);
        await this.state(tx, owner, 'waiting', reason);
        return { allowed: false, reason };
      }
      // Existing independent blocks are authoritative. Only the release
      // transaction may remove the budget block, never a tool or clock tick.
      if (!canFinishDispatchedStep(control.state) || control.state.blocks.some(block => block.key === budgetBlockKey(owner.sessionId))) return { allowed: false, reason: control.state.blocks.map(block => block.reason).join('；') || '累计执行时限已用尽' };
      if (request) {
        const id = randomUUID();
        const record: BudgetMeasurement = { proposed: request.route, prices: config.prices, currency: config.currency, at: new Date().toISOString() };
        if (grant) {
          const executionId = owner.kind === 'worker' ? (await tx.query<{ execution_id: string }>('select execution_id from pa24.work_item where id = $1', [owner.workId])).rows[0]?.execution_id : undefined;
          await tx.query("update pa24.budget_release set status = 'used', record = $2 where id = $1 and status = 'ready'", [grant.id, JSON.stringify({ ...grant.record, executionId, consumedBy: id, consumedAt: record.at })]);
        }
        await tx.query(`insert into pa24.budget_request (id,run_id,work_item_id,session_id,turn,step,record) values ($1,$2,$3,$4,$5,$6,$7)`, [id, owner.runId, owner.workId, owner.sessionId, request.turn, request.step, JSON.stringify(record)]);
      }
      return { allowed: true };
    });
  }
  private async state(tx: PaQueryer, owner: BudgetOwner, status: 'waiting' | 'running' | 'needs_reconciliation', reason: string) {
    // Table names are fixed domain branches, never user input.
    const changed = owner.kind === 'skill'
      ? await tx.query("update pa24.skill_run set status = $2, progress = $3, updated_at = now() where id = $1 and status in ('running','waiting') returning id", [owner.runId, status, reason])
      : await tx.query("update pa24.worker_run set status = $2, progress = $3, updated_at = now() where id = $1 and status in ('running','waiting') returning id", [owner.runId, status, reason]);
    if (!changed.rowCount) return; // A late failed wake cannot undo a stop.
    const active = owner.kind === 'skill' ? 'active_skill_run_id' : 'active_worker_run_id';
    await tx.query(`update pa24.work_item set status = $2, progress = $3, revision = revision + 1, updated_at = now() where id = $1 and ${active} = $4 and status in ('running','waiting_input')`, [owner.workId, status === 'waiting' ? 'waiting_input' : status, reason, owner.runId]);
  }
  async event(owner: BudgetOwner, input: { id: string; turn: number; step: number; at: string; actual: BudgetMeasurement['actual']; usage: BudgetUsage | null; type: string; interrupted: boolean }, config: BudgetConfig): Promise<void> {
    await this.db.withTransaction(async tx => {
      await this.lock(tx);
      if ((await tx.query('select id from pa24.budget_request where event_id = $1', [input.id])).rowCount) return;
      const request = (await tx.query<BudgetRequestRow>(`select * from pa24.budget_request where session_id = $1 and turn = $2 and step = $3 and event_id is null order by created_at, id limit 1`, [owner.sessionId, input.turn, input.step])).rows[0];
      const base = request?.record ?? { proposed: input.actual ?? { provider: '', model: '' }, at: input.at, currency: config.currency, prices: config.prices };
      const price = base.prices.find(price => price.provider === input.actual?.provider && price.model === input.actual?.model);
      const record = { ...base, actual: input.actual, usage: input.usage, estimate: estimateUsage(input.usage, price), price, settledAt: input.at, eventType: input.type, interrupted: input.interrupted };
      if (request) await tx.query('update pa24.budget_request set event_id = $2, record = $3 where id = $1', [request.id, input.id, JSON.stringify(record)]);
      else await tx.query(`insert into pa24.budget_request (id,run_id,work_item_id,session_id,turn,step,event_id,record) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), owner.runId, owner.workId, owner.sessionId, input.turn, input.step, input.id, JSON.stringify(record)]);
    });
  }
  async grant(input: { id: string; hash: string; runId: string; workId: string; sessionId: string }): Promise<BudgetReleaseRow> {
    return this.db.withTransaction(async tx => {
      await this.lock(tx);
      const previous = (await tx.query<BudgetReleaseRow>('select * from pa24.budget_release where id = $1', [input.id])).rows[0];
      if (previous) {
        if (previous.request_hash !== input.hash || previous.run_id !== input.runId || previous.work_item_id !== input.workId || previous.session_id !== input.sessionId) throw new Error('放行标识已用于其他范围。');
        // Receipt replay remains readable after completion. Only an explicit
        // retry of a definitely unsubmitted wake may reuse the unused permit.
        if (previous.status === 'ready' && previous.record.error && !previous.record.wake) {
          const owner = await this.owner(input.runId, tx); if (!owner) throw new Error('原运行不存在。');
          await this.current(tx, owner);
          delete previous.record.error;
          await tx.query('update pa24.budget_release set record = $2 where id = $1', [previous.id, JSON.stringify(previous.record)]);
        }
        return previous;
      }
      const owner = await this.owner(input.runId, tx); if (!owner) throw new Error('原运行不存在。');
      const control = await this.current(tx, owner);
      const waiting = (await tx.query<{ session_id: string; work_item_id: string }>('select * from pa24.budget_wait where run_id = $1 and session_id = $2', [input.runId, input.sessionId])).rows[0];
      if (!control.state.blocks.some(block => block.key === budgetBlockKey(input.sessionId) && block.kind === 'budget') || waiting?.work_item_id !== input.workId || waiting.session_id !== input.sessionId || owner.workId !== input.workId) throw new Error('预算等待范围已变化，请刷新后核对原交办、运行和会话。');
      if ((await tx.query("select id from pa24.budget_release where run_id = $1 and status = 'ready'", [owner.runId])).rowCount) throw new Error('原运行已有尚未消费的一次放行。');
      clearRunBlock(control.state, budgetBlockKey(input.sessionId));
      await tx.query('update pa24.skill_run_control set state = $2, revision = revision + 1 where run_id = $1', [owner.runId, JSON.stringify(control.state)]);
      return (await tx.query<BudgetReleaseRow>(`insert into pa24.budget_release (id,request_hash,run_id,work_item_id,session_id,status,record) values ($1,$2,$3,$4,$5,'ready',$6) returning *`, [input.id, input.hash, owner.runId, owner.workId, input.sessionId, '{}'])).rows[0]!;
    });
  }
  async claimWake(release: BudgetReleaseRow, originals: RunInput[], limit: number): Promise<boolean> {
    return this.db.withTransaction(async tx => {
      if (!await hasExecutionCapacity(tx, limit, { runId: release.run_id, workId: release.work_item_id })) return false;
      await this.lock(tx);
      const owner = await this.owner(release.run_id, tx); if (!owner) return false;
      const control = await this.current(tx, owner);
      const row = (await tx.query<BudgetReleaseRow>('select * from pa24.budget_release where id = $1 for update', [release.id])).rows[0];
      if (!row || row.status !== 'ready' || row.record.error || !canFinishDispatchedStep(control.state)) return false;
      await tx.query('update pa24.budget_release set record = $2 where id = $1', [row.id, JSON.stringify({ ...row.record, originals: row.record.originals ?? originals, wake: 'sending' })]);
      await this.state(tx, owner, control.state.blocks.length ? 'waiting' : 'running', '预算一次放行已保存，沿原运行继续；其他会话等待保留');
      return true;
    });
  }
  async wakeError(id: string, error: string, mayHaveDispatched = true): Promise<void> {
    await this.db.withTransaction(async tx => {
      await this.lock(tx);
      const row = (await tx.query<BudgetReleaseRow>('select * from pa24.budget_release where id = $1', [id])).rows[0];
      if (row?.status !== 'ready') return; // The model already consumed it.
      await tx.query('update pa24.budget_release set record = $2 where id = $1', [id, JSON.stringify({ ...row.record, error, wake: mayHaveDispatched ? row.record.wake : undefined })]);
      const found = await this.owner(row.run_id, tx);
      const owner = found && (await this.lockOwner(tx, found)).run;
      if (owner && ['running', 'waiting'].includes(owner.status)) await this.state(tx, owner, mayHaveDispatched ? 'needs_reconciliation' : 'waiting',
        mayHaveDispatched ? `预算续办是否接纳未知，须先核对原运行：${error}` : `预算续办未接纳，可重试原许可：${error}`);
    });
  }
  async acceptedWake(id: string, message: RunInput): Promise<void> {
    await this.db.withTransaction(async tx => {
      await this.lock(tx);
      const row = (await tx.query<BudgetReleaseRow>('select * from pa24.budget_release where id = $1', [id])).rows[0];
      if (!row || (row.native_message_id && row.native_message_id !== message.id)) throw new Error('预算控制输入身份冲突，须先核对。');
      const owner = await this.owner(row.run_id, tx); if (!owner) throw new Error('原运行不存在。'); await this.current(tx, owner);
      await tx.query('update pa24.budget_release set native_message_id = $2, record = $3 where id = $1', [id, message.id, JSON.stringify({ ...row.record, control: message, wake: 'sent' })]);
    });
  }
}
