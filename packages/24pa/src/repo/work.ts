// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { ResolvedTaskSkill } from '../skills.js';
import type { PaDb } from '../db.js';
import { enqueueOutbox, type NewOutbox } from './outbox.js';
import { randomUUID } from 'node:crypto';
import { readLedgerOwner } from './ledger.js';

export interface WorkExecutionScope {
  workspaceId: string;
  workspacePath: string;
  parentSessionId: string;
  childSessionId: string;
  generation: number;
  input: 'start' | 'followup';
}

export type WorkItemStatus =
  | 'accepted'
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'needs_reconciliation';

export const UNSETTLED_WORK_STATUSES = ['accepted', 'queued', 'running', 'waiting_input', 'needs_reconciliation'] as const;

export interface WorkItemRow {
  execution_mode?: 'worker' | 'skill';
  active_skill_run_id?: string | null;
  id: string;
  title: string;
  role: string;
  instruction: string;
  skill?: string | null;
  skill_definition?: ResolvedTaskSkill | null;
  origin: 'feishu' | 'local';
  parent_session_id: string;
  child_session_id: string | null;
  delivery: string;
  recovery_gen?: number;
  execution_id?: string | null;
  execution_scope?: WorkExecutionScope | null;
  status: WorkItemStatus;
  progress: string | null;
  result: string | null;
  result_ref: any;
  created_at: Date;
  updated_at: Date;
}

export class WorkItemRepo {
  constructor(private readonly db: PaDb) {}

  async claimNext(): Promise<WorkItemRow | null> {
    const result = await this.db.query<WorkItemRow>(
      `update pa24.work_item set status = 'running', progress = 'Worker 正在处理', updated_at = now()
       where id = (select id from pa24.work_item where execution_mode = 'worker' and status in ('queued', 'accepted') order by created_at, id limit 1)
       and status in ('queued', 'accepted') returning *`,
    );
    return result.rows[0] ?? null;
  }

  /** Commit the input identity before native admission, so a later DB outage
   * cannot erase the link to the independently persisted Session history. */
  async beginExecution(item: WorkItemRow, workspacePath: string, input: WorkExecutionScope['input']): Promise<WorkItemRow> {
    return this.db.withTransaction(async tx => {
      const owner = await readLedgerOwner(tx);
      if (!owner) throw new Error('账本尚未登记工作区，不能接纳 Worker 输入。');
      const scope: WorkExecutionScope = { workspaceId: owner.workspace_id, workspacePath,
        parentSessionId: item.parent_session_id, childSessionId: item.child_session_id ?? item.id,
        generation: item.recovery_gen ?? 0, input };
      const result = await tx.query<WorkItemRow>(
        `update pa24.work_item set execution_id = $2, execution_scope = $3, updated_at = now()
         where id = $1 and status = 'running' and recovery_gen = $4 returning *`,
        [item.id, randomUUID(), JSON.stringify(scope), scope.generation],
      );
      if (!result.rows[0]) throw new Error('事项代次或状态已变更，未接纳新输入。');
      return result.rows[0];
    });
  }

  async restoreExecution(id: string, expectedId: string, previous: WorkItemRow): Promise<void> {
    await this.db.query(`update pa24.work_item set execution_id = $3, execution_scope = $4
      where id = $1 and execution_id = $2`,
    [id, expectedId, previous.execution_id ?? null, previous.execution_scope ? JSON.stringify(previous.execution_scope) : null]);
  }

  async ownsExecution(item: WorkItemRow): Promise<boolean> {
    return !!item.execution_scope?.workspaceId && (await readLedgerOwner(this.db))?.workspace_id === item.execution_scope.workspaceId;
  }

  async finishWithDelivery(id: string, output: string, failed: boolean, delivery: NewOutbox, expected?: { executionId?: string; generation: number }): Promise<WorkItemRow | null> {
    return this.db.withTransaction(async tx => {
      const result = await tx.query<WorkItemRow>(
        `update pa24.work_item set status = $2, result = $3, progress = $4, updated_at = now()
         where id = $1 and status = 'running'
         ${expected ? 'and recovery_gen = $5' : ''}
         ${expected?.executionId ? 'and execution_id = $6' : ''} returning *`,
        [id, failed ? 'failed' : 'completed', output, failed ? 'Worker 未完成，结果待回传' : 'Worker 已完成，结果待回传',
          ...(expected ? [expected.generation] : []), ...(expected?.executionId ? [expected.executionId] : [])],
      );
      if (!result.rows[0]) return null;
      await enqueueOutbox(tx, delivery);
      return result.rows[0];
    });
  }

  async insert(row: Omit<WorkItemRow, 'created_at' | 'updated_at' | 'progress' | 'result' | 'result_ref' | 'child_session_id'> & { child_session_id?: string }): Promise<WorkItemRow> {
    const result = await this.db.query<WorkItemRow>(
      `insert into pa24.work_item (id, title, role, instruction, origin, parent_session_id, child_session_id, delivery, status, skill, skill_definition)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
      [row.id, row.title, row.role, row.instruction, row.origin, row.parent_session_id, row.child_session_id ?? null, row.delivery, row.status, row.skill ?? null, row.skill_definition ? JSON.stringify(row.skill_definition) : null],
    );
    return result.rows[0]!;
  }

  async update(id: string, patch: Partial<Pick<WorkItemRow, 'status' | 'progress' | 'result' | 'result_ref' | 'child_session_id'>>): Promise<WorkItemRow | null> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value === undefined ? null : key === 'result_ref' ? JSON.stringify(value) : value);
      n += 1;
    }
    const result = await this.db.query<WorkItemRow>(`update pa24.work_item set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  async get(id: string): Promise<WorkItemRow | null> {
    const result = await this.db.query<WorkItemRow>('select * from pa24.work_item where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async list(statuses?: readonly WorkItemStatus[], limit = 100, workersOnly = false): Promise<WorkItemRow[]> {
    if (statuses && statuses.length > 0) {
      const result = await this.db.query<WorkItemRow>(
        `select * from pa24.work_item where status = any($1) ${workersOnly ? "and execution_mode = 'worker'" : ''} order by created_at desc limit $2`,
        [statuses, limit],
      );
      return result.rows;
    }
    const result = await this.db.query<WorkItemRow>(`select * from pa24.work_item ${workersOnly ? "where execution_mode = 'worker'" : ''} order by created_at desc limit $1`, [limit]);
    return result.rows;
  }

  /** Bump the crash-recovery generation counter (F28): outside the generic
   *  update() patch whitelist because it is reconcile-internal state. */
  async setRecoveryGen(id: string, gen: number): Promise<void> {
    await this.db.query(`update pa24.work_item set recovery_gen = $2 where id = $1`, [id, gen]);
  }

  async countByStatus(status: WorkItemStatus): Promise<number> {
    const result = await this.db.query<{ count: string }>('select count(*) as count from pa24.work_item where status = $1', [status]);
    return Number(result.rows[0]!.count);
  }

  async activeForParent(parentSessionId: string): Promise<WorkItemRow[]> {
    const result = await this.db.query<WorkItemRow>(
      `select * from pa24.work_item where parent_session_id = $1 and status = any($2)`,
      [parentSessionId, UNSETTLED_WORK_STATUSES],
    );
    return result.rows;
  }
}

export type OperationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';

export interface ActionOperationRow {
  id: string;
  work_item_id: string;
  action: string;
  params: any;
  status: OperationStatus;
  attempt: number;
  receipt: any;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ActionOperationRepo {
  constructor(private readonly db: PaDb) {}

  /** Claim only a never-executed or explicitly failed attempt. Running and
   * unknown writes are not eligible, including after a process restart. */
  async claim(id: string): Promise<ActionOperationRow | null> {
    const result = await this.db.query<ActionOperationRow>(
      `update pa24.action_operation set status = 'running', updated_at = now()
       where id = $1 and status in ('pending', 'failed') returning *`, [id],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Register an operation under its stable key. Execution eligibility and
   * durable remote receipts are enforced by ExternalOperations, not insertion.
   */
  async begin(row: { id: string; workItemId: string; action: string; params: unknown }): Promise<{ created: boolean; row: ActionOperationRow }> {
    const result = await this.db.query<ActionOperationRow>(
      `insert into pa24.action_operation (id, work_item_id, action, params, status)
       values ($1, $2, $3, $4, 'pending') on conflict (id) do nothing returning *`,
      [row.id, row.workItemId, row.action, JSON.stringify(row.params)],
    );
    if (result.rowCount === 0) {
      const existing = await this.db.query<ActionOperationRow>('select * from pa24.action_operation where id = $1', [row.id]);
      return { created: false, row: existing.rows[0]! };
    }
    return { created: true, row: result.rows[0]! };
  }

  /** Succeeded operations whose id starts with prefix (F28): revision-impact
   *  notices fan out to objects created from OLDER note versions. */
  async succeededWithIdPrefix(prefix: string): Promise<Array<Pick<ActionOperationRow, 'id' | 'params' | 'status'>>> {
    const result = await this.db.query<Pick<ActionOperationRow, 'id' | 'params' | 'status'>>(
      `select id, params, status from pa24.action_operation where id like $1 and status = 'succeeded'`,
      [prefix],
    );
    return result.rows;
  }

  async update(id: string, patch: { status: OperationStatus; receipt?: unknown; error?: string }): Promise<ActionOperationRow | null> {
    const result = await this.db.query<ActionOperationRow>(
      `update pa24.action_operation set status = $2,
         attempt = attempt + 1,
         receipt = coalesce($3::jsonb, receipt),
         error = $4, updated_at = now()
       where id = $1 returning *`,
      [id, patch.status, patch.receipt === undefined ? null : JSON.stringify(patch.receipt), patch.error ?? null],
    );
    return result.rows[0] ?? null;
  }

  async calendarCreatesForWork(workItemId: string): Promise<ActionOperationRow[]> {
    return (await this.db.query<ActionOperationRow>("select * from pa24.action_operation where work_item_id = $1 and action in ('calendar.create', 'wecom_calendar.create')", [workItemId])).rows;
  }

  async confirmedCalendarCreates(eventId: string): Promise<ActionOperationRow[]> {
    return (await this.db.query<ActionOperationRow>(`select * from pa24.action_operation where status = 'succeeded'
      and action in ('calendar.create', 'wecom_calendar.create') and receipt->>'eventId' = $1`, [eventId])).rows;
  }

  async unresolvedCalendarCreates(): Promise<ActionOperationRow[]> {
    return (await this.db.query<ActionOperationRow>(`select * from pa24.action_operation
      where action in ('calendar.create', 'wecom_calendar.create') and (status in ('running', 'unknown') or (status = 'failed' and receipt->>'_externalResult' is not null))`)).rows;
  }

  async get(id: string): Promise<ActionOperationRow | null> {
    const result = await this.db.query<ActionOperationRow>('select * from pa24.action_operation where id = $1', [id]);
    return result.rows[0] ?? null;
  }
}
