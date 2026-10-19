// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb, PaQueryer } from '../db.js';

export interface OutreachRow {
  id: string;
  work_item_id: string | null;
  kind: 'message' | 'assign' | string;
  target_open_id: string;
  target_name: string;
  content: string;
  instruction: string;
  status: string;
  message_id: string | null;
  task_guid: string | null;
  error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

export class OutreachRepo {
  constructor(private readonly db: PaDb) {}

  async insert(row: Omit<OutreachRow, 'created_at' | 'sent_at' | 'message_id' | 'task_guid' | 'error'>): Promise<{ inserted: boolean; row: OutreachRow }> {
    const result = await this.db.query<OutreachRow>(
      `insert into pa24.outreach (id, work_item_id, kind, target_open_id, target_name, content, instruction, status)
       values ($1,$2,$3,$4,$5,$6,$7,'pending') on conflict (id) do nothing returning *`,
      [row.id, row.work_item_id, row.kind, row.target_open_id, row.target_name, row.content, row.instruction],
    );
    if (result.rowCount === 0) {
      const existing = await this.db.query<OutreachRow>('select * from pa24.outreach where id = $1', [row.id]);
      return { inserted: false, row: existing.rows[0]! };
    }
    return { inserted: true, row: result.rows[0]! };
  }

  async mark(id: string, patch: { status: string; messageId?: string; taskGuid?: string; error?: string }): Promise<void> {
    await this.db.query(
      `update pa24.outreach set status = $2,
         message_id = coalesce($3, message_id),
         task_guid = coalesce($4, task_guid),
         error = $5,
         sent_at = case when $6 then now() else sent_at end
       where id = $1`,
      [id, patch.status, patch.messageId ?? null, patch.taskGuid ?? null, patch.error ?? null, patch.status === 'succeeded'],
    );
  }

}

export interface TaskTemplateRow {
  id: string;
  title: string;
  tasklist_id: string;
  schedule: any;
  origin_expression: string | null;
  status: 'active' | 'stopped' | string;
  next_due_at: Date | null;
  time_zone: string;
  created_at: Date;
  updated_at: Date;
}

export interface TaskTemplateInstanceRow {
  id: string;
  template_id: string;
  due_at: Date;
  status: 'pending' | 'generating' | 'generated' | 'skipped' | 'failed' | string;
  task_id: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export class TaskTemplateRepo {
  constructor(private readonly db: PaDb) {}

  async insert(row: Omit<TaskTemplateRow, 'created_at' | 'updated_at'>, client: PaQueryer = this.db): Promise<TaskTemplateRow> {
    const result = await client.query<TaskTemplateRow>(
      `insert into pa24.task_template (id, title, tasklist_id, schedule, origin_expression, status, next_due_at, time_zone)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [row.id, row.title, row.tasklist_id, JSON.stringify(row.schedule), row.origin_expression, row.status, row.next_due_at, row.time_zone],
    );
    return result.rows[0]!;
  }

  async createWithFirst(row: Omit<TaskTemplateRow, 'created_at' | 'updated_at'>, replaceId?: string): Promise<TaskTemplateRow> {
    return this.db.withTransaction(async client => {
      const created = await this.insert(row, client);
      await this.insertInstance({ id: `${row.id}:${row.next_due_at!.toISOString()}`, templateId: row.id, dueAt: row.next_due_at! }, client);
      if (replaceId && replaceId !== row.id) await this.stop(replaceId, client);
      return created;
    });
  }

  async stop(id: string, client: PaQueryer = this.db): Promise<void> {
    const apply = async (tx: PaQueryer) => {
      await tx.query("update pa24.task_template set status = 'stopped', next_due_at = null, updated_at = now() where id = $1", [id]);
      await tx.query("update pa24.task_template_instance set status = 'skipped', updated_at = now() where template_id = $1 and status = 'pending'", [id]);
    };
    if (client === this.db) return this.db.withTransaction(apply);
    return apply(client);
  }

  /** Current terminal state and successor become visible together. */
  async finishAndAdvance(template: TaskTemplateRow, instance: TaskTemplateInstanceRow, patch: { status: string; taskId?: string | null; error?: string | null }, nextAt: Date): Promise<void> {
    await this.db.withTransaction(async client => {
      const current = (await client.query<TaskTemplateRow>('select * from pa24.task_template where id = $1 for update', [template.id])).rows[0];
      await client.query('update pa24.task_template_instance set status = $2, task_id = coalesce($3, task_id), error = $4, updated_at = now() where id = $1', [instance.id, patch.status, patch.taskId ?? null, patch.error ?? null]);
      if (current?.status !== 'active' || !current.next_due_at || new Date(current.next_due_at).getTime() > new Date(instance.due_at).getTime()) return;
      await this.insertInstance({ id: `${template.id}:${nextAt.toISOString()}`, templateId: template.id, dueAt: nextAt }, client);
      await client.query('update pa24.task_template set next_due_at = $2, updated_at = now() where id = $1', [template.id, nextAt]);
    });
  }

  async recoverableInstances(): Promise<TaskTemplateInstanceRow[]> {
    return (await this.db.query<TaskTemplateInstanceRow>("select * from pa24.task_template_instance where status in ('generating', 'failed') order by due_at")).rows;
  }

  async instance(id: string): Promise<TaskTemplateInstanceRow | null> {
    return (await this.db.query<TaskTemplateInstanceRow>('select * from pa24.task_template_instance where id = $1', [id])).rows[0] ?? null;
  }

  async get(id: string): Promise<TaskTemplateRow | null> {
    const result = await this.db.query<TaskTemplateRow>('select * from pa24.task_template where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async update(id: string, patch: Partial<Pick<TaskTemplateRow, 'title' | 'schedule' | 'status' | 'next_due_at' | 'origin_expression'>>): Promise<TaskTemplateRow | null> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(key === 'schedule' ? JSON.stringify(value) : value ?? null);
      n += 1;
    }
    const result = await this.db.query<TaskTemplateRow>(`update pa24.task_template set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  async list(status?: string): Promise<TaskTemplateRow[]> {
    const result = status
      ? await this.db.query<TaskTemplateRow>('select * from pa24.task_template where status = $1 order by next_due_at nulls last', [status])
      : await this.db.query<TaskTemplateRow>('select * from pa24.task_template order by next_due_at nulls last');
    return result.rows;
  }

  async insertInstance(row: { id: string; templateId: string; dueAt: Date }, client: PaQueryer = this.db): Promise<boolean> {
    const result = await client.query(
      `insert into pa24.task_template_instance (id, template_id, due_at) values ($1,$2,$3) on conflict (id) do nothing`,
      [row.id, row.templateId, row.dueAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Skip every not-yet-generated instance (stop/change-future path, P22). */
  async skipPendingInstances(templateId: string): Promise<number> {
    const result = await this.db.query(
      `update pa24.task_template_instance set status = 'skipped', updated_at = now() where template_id = $1 and status = 'pending'`,
      [templateId],
    );
    return result.rowCount ?? 0;
  }

  async updateInstance(id: string, patch: Partial<Pick<TaskTemplateInstanceRow, 'status' | 'task_id' | 'error'>>): Promise<void> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    await this.db.query(`update pa24.task_template_instance set ${sets.join(', ')} where id = $1`, values);
  }

  /** Claim due instances; SKIP LOCKED keeps one generator per instance. */
  async claimDueInstances(now: Date, limit: number): Promise<TaskTemplateInstanceRow[]> {
    const result = await this.db.query<TaskTemplateInstanceRow>(
      `update pa24.task_template_instance set status = 'generating', updated_at = now()
       where id in (
         select i.id from pa24.task_template_instance i
         join pa24.task_template t on t.id = i.template_id
         where i.status = 'pending' and t.status = 'active' and i.due_at <= $1
         order by i.due_at limit $2 for update skip locked
       ) returning *`,
      [now, limit],
    );
    return result.rows;
  }

  async instancesOf(templateId: string, limit = 20): Promise<TaskTemplateInstanceRow[]> {
    const result = await this.db.query<TaskTemplateInstanceRow>(
      `select * from pa24.task_template_instance where template_id = $1 order by due_at desc limit $2`,
      [templateId, limit],
    );
    return result.rows;
  }
}

export interface WaitingItemRow {
  id: string;
  title: string;
  detail: string;
  source_desc: string;
  dedup_key: string | null;
  checkpoint_at: Date | null;
  status: 'waiting' | 'received' | 'canceled' | string;
  result: string | null;
  ask_count: number;
  last_asked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class WaitingRepo {
  constructor(private readonly db: PaDb) {}

  async insert(row: { id: string; title: string; detail?: string; sourceDesc?: string; dedupKey?: string; checkpointAt?: Date | null }): Promise<WaitingItemRow> {
    const result = await this.db.query<WaitingItemRow>(
      `insert into pa24.waiting_item (id, title, detail, source_desc, dedup_key, checkpoint_at)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [row.id, row.title, row.detail ?? '', row.sourceDesc ?? '', row.dedupKey ?? null, row.checkpointAt ?? null],
    );
    return result.rows[0]!;
  }

  async get(id: string): Promise<WaitingItemRow | null> {
    const result = await this.db.query<WaitingItemRow>('select * from pa24.waiting_item where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async byDedupKey(dedupKey: string): Promise<WaitingItemRow | null> {
    const result = await this.db.query<WaitingItemRow>(
      `select * from pa24.waiting_item where dedup_key = $1 and status = 'waiting' order by created_at limit 2`,
      [dedupKey],
    );
    if (result.rows.length > 1) throw new Error(`同源等待存在多个历史活动项：${result.rows.map(row => row.id).join('、')}；请明确保留哪个并结束其余项。`);
    return result.rows[0] ?? null;
  }

  async update(id: string, patch: Partial<Pick<WaitingItemRow, 'status' | 'result' | 'checkpoint_at' | 'ask_count' | 'last_asked_at'>>): Promise<WaitingItemRow | null> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    const result = await this.db.query<WaitingItemRow>(`update pa24.waiting_item set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  async control(id: string, patch: Pick<WaitingItemRow, 'status' | 'checkpoint_at' | 'result'>): Promise<WaitingItemRow | null> {
    return this.db.withTransaction(async client => {
      await client.query('select id from pa24.waiting_item where id = $1 for update', [id]);
      const row = (await client.query<WaitingItemRow>('update pa24.waiting_item set status = $2, checkpoint_at = $3, result = $4, updated_at = now() where id = $1 returning *', [id, patch.status, patch.checkpoint_at, patch.result])).rows[0];
      await client.query(`update pa24.outbox set status = 'expired', next_attempt_at = null, last_error = '等待事项已由本人修改，旧询问取消'
        where status in ('pending', 'failed') and dedup_key in (
          select 'digest:' || o.id from pa24.digest_occurrence o join pa24.digest_plan p on p.id = o.plan_id where p.kind = 'waiting_followup' and p.schedule_spec->>'waitingId' = $1
        )`, [id]);
      return row ?? null;
    });
  }

  async defer(id: string, checkpoint: string, next: Date): Promise<WaitingItemRow | null> {
    return (await this.db.query<WaitingItemRow>("update pa24.waiting_item set checkpoint_at = $3, updated_at = now() where id = $1 and status = 'waiting' and checkpoint_at = $2 returning *", [id, new Date(checkpoint), next])).rows[0] ?? null;
  }

  async list(status?: string, limit = 30): Promise<WaitingItemRow[]> {
    const result = status
      ? await this.db.query<WaitingItemRow>('select * from pa24.waiting_item where status = $1 order by created_at desc limit $2', [status, limit])
      : await this.db.query<WaitingItemRow>('select * from pa24.waiting_item order by created_at desc limit $1', [limit]);
    return result.rows;
  }
}
