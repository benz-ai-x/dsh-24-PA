import type { PaDatabase } from './pg.js';

// Repositories over the pa24 schema. Every externally visible effect funnels
// through a durable row first (inbox before ACK, outbox before send,
// action_operation before CLI write) so restarts can reconcile instead of
// replaying blind.

export type InboxStatus = 'received' | 'processing' | 'admitted' | 'delivered' | 'rejected' | 'duplicate';

export interface InboxRow {
  event_id: string;
  source: string;
  kind: string;
  payload: any;
  status: InboxStatus;
  request_id: string | null;
  target_session: string | null;
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
}

export interface NewInbox {
  eventId: string;
  source: 'feishu' | 'local' | 'panel';
  kind: 'message' | 'card' | 'command';
  payload: unknown;
}

export class InboxRepo {
  constructor(private readonly db: PaDatabase) {}

  /** Insert once; platform redelivery returns the original row untouched. */
  async insert(row: NewInbox): Promise<{ inserted: boolean; row: InboxRow }> {
    const result = await this.db.query<InboxRow>(
      `insert into pa24.inbox (event_id, source, kind, payload, status) values ($1, $2, $3, $4, 'received')
       on conflict (event_id) do nothing returning *`,
      [row.eventId, row.source, row.kind, JSON.stringify(row.payload)],
    );
    if (result.rowCount === 0) {
      const existing = await this.db.query<InboxRow>('select * from pa24.inbox where event_id = $1', [row.eventId]);
      return { inserted: false, row: existing.rows[0]! };
    }
    return { inserted: true, row: result.rows[0]! };
  }

  /** Atomically record an event that will never be processed (wrong sender, app, or tenant). */
  async insertRejected(row: NewInbox, reason: string): Promise<void> {
    await this.db.query(
      `insert into pa24.inbox (event_id, source, kind, payload, status, error, processed_at)
       values ($1, $2, $3, $4, 'rejected', $5, now()) on conflict (event_id) do nothing`,
      [row.eventId, row.source, row.kind, JSON.stringify({ ...(row.payload as object), rejected: reason }), reason],
    );
  }

  /** Claim queued rows for the single dispatcher; SKIP LOCKED keeps future workers safe. */
  async claim(limit: number): Promise<InboxRow[]> {
    const result = await this.db.query<InboxRow>(
      `update pa24.inbox set status = 'processing'
       where event_id in (
         select event_id from pa24.inbox where status = 'received'
         order by created_at limit $1 for update skip locked
       ) returning *`,
      [limit],
    );
    return result.rows;
  }

  async mark(eventId: string, patch: { status: InboxStatus; requestId?: string; targetSession?: string; error?: string }): Promise<void> {
    await this.db.query(
      `update pa24.inbox set status = $2,
         request_id = coalesce($3, request_id),
         target_session = coalesce($4, target_session),
         error = $5,
         processed_at = case when $6 then now() else processed_at end
       where event_id = $1`,
      [eventId, patch.status, patch.requestId ?? null, patch.targetSession ?? null, patch.error ?? null, ['admitted', 'delivered', 'rejected', 'duplicate'].includes(patch.status)],
    );
  }

  async get(eventId: string): Promise<InboxRow | null> {
    const result = await this.db.query<InboxRow>('select * from pa24.inbox where event_id = $1', [eventId]);
    return result.rows[0] ?? null;
  }
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

export interface WorkItemRow {
  id: string;
  title: string;
  role: string;
  instruction: string;
  origin: 'feishu' | 'local';
  parent_session_id: string;
  child_session_id: string | null;
  delivery: string;
  recovery_gen?: number;
  status: WorkItemStatus;
  progress: string | null;
  result: string | null;
  result_ref: any;
  created_at: Date;
  updated_at: Date;
}

export class WorkItemRepo {
  constructor(private readonly db: PaDatabase) {}

  async insert(row: Omit<WorkItemRow, 'created_at' | 'updated_at' | 'progress' | 'result' | 'result_ref' | 'child_session_id'> & { child_session_id?: string }): Promise<WorkItemRow> {
    const result = await this.db.query<WorkItemRow>(
      `insert into pa24.work_item (id, title, role, instruction, origin, parent_session_id, child_session_id, delivery, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [row.id, row.title, row.role, row.instruction, row.origin, row.parent_session_id, row.child_session_id ?? null, row.delivery, row.status],
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

  async list(statuses?: readonly WorkItemStatus[], limit = 100): Promise<WorkItemRow[]> {
    if (statuses && statuses.length > 0) {
      const result = await this.db.query<WorkItemRow>(
        `select * from pa24.work_item where status = any($1) order by created_at desc limit $2`,
        [statuses, limit],
      );
      return result.rows;
    }
    const result = await this.db.query<WorkItemRow>('select * from pa24.work_item order by created_at desc limit $1', [limit]);
    return result.rows;
  }

  async countByStatus(status: WorkItemStatus): Promise<number> {
    const result = await this.db.query<{ count: string }>('select count(*) as count from pa24.work_item where status = $1', [status]);
    return Number(result.rows[0]!.count);
  }

  async activeForParent(parentSessionId: string): Promise<WorkItemRow[]> {
    const result = await this.db.query<WorkItemRow>(
      `select * from pa24.work_item where parent_session_id = $1 and status = any($2)`,
      [parentSessionId, ['accepted', 'queued', 'running']],
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
  constructor(private readonly db: PaDatabase) {}

  /**
   * Register an operation under its stable key. Returns the existing row when
   * the key repeats, so retries never execute the external write twice.
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

  async get(id: string): Promise<ActionOperationRow | null> {
    const result = await this.db.query<ActionOperationRow>('select * from pa24.action_operation where id = $1', [id]);
    return result.rows[0] ?? null;
  }
}

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'unknown' | 'failed' | 'expired';

export interface OutboxRow {
  id: number;
  dedup_key: string;
  channel: 'feishu' | 'local';
  target: string;
  kind: 'text' | 'card';
  content: any;
  status: OutboxStatus;
  message_id: string | null;
  attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

export interface NewOutbox {
  dedupKey: string;
  channel: 'feishu' | 'local';
  target: string;
  kind: 'text' | 'card';
  content: unknown;
}

export class OutboxRepo {
  constructor(private readonly db: PaDatabase) {}

  /** Idempotent enqueue: one business notification keeps one stable key. */
  async enqueue(row: NewOutbox): Promise<{ created: boolean; row: OutboxRow }> {
    const result = await this.db.query<OutboxRow>(
      `insert into pa24.outbox (dedup_key, channel, target, kind, content, status)
       values ($1, $2, $3, $4, $5, 'pending') on conflict (dedup_key) do nothing returning *`,
      [row.dedupKey, row.channel, row.target, row.kind, JSON.stringify(row.content)],
    );
    if (result.rowCount === 0) {
      const existing = await this.db.query<OutboxRow>('select * from pa24.outbox where dedup_key = $1', [row.dedupKey]);
      return { created: false, row: existing.rows[0]! };
    }
    return { created: true, row: result.rows[0]! };
  }

  async claim(limit: number): Promise<OutboxRow[]> {
    const result = await this.db.query<OutboxRow>(
      `update pa24.outbox set status = 'sending', attempts = attempts + 1
       where id in (
         select id from pa24.outbox
         where status = 'pending' and (next_attempt_at is null or next_attempt_at <= now())
         order by id limit $1 for update skip locked
       ) returning *`,
      [limit],
    );
    return result.rows;
  }

  async mark(id: number, patch: { status: OutboxStatus; messageId?: string; error?: string; retryInMs?: number }): Promise<void> {
    await this.db.query(
      `update pa24.outbox set
         status = case when $8::bool then 'expired' else $2::text end,
         message_id = coalesce($3, message_id),
         last_error = $4,
         sent_at = case when $5::bool then now() else sent_at end,
         next_attempt_at = case when $6::bool then now() + make_interval(secs => $7) else next_attempt_at end
       where id = $1`,
      [id, patch.status, patch.messageId ?? null, patch.error ?? null, patch.status === 'sent', patch.retryInMs !== undefined, (patch.retryInMs ?? 0) / 1000, patch.status === 'expired'],
    );
  }

  async recent(limit = 50): Promise<OutboxRow[]> {
    const result = await this.db.query<OutboxRow>('select * from pa24.outbox order by id desc limit $1', [limit]);
    return result.rows;
  }
}

export interface BindingRow {
  app_id: string;
  tenant_key: string;
  owner_open_id: string;
  lark_profile: string;
  status: string;
  chat_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class BindingRepo {
  constructor(private readonly db: PaDatabase) {}

  async upsert(row: { appId: string; tenantKey: string; ownerOpenId: string; larkProfile: string; chatId?: string }): Promise<BindingRow> {
    const result = await this.db.query<BindingRow>(
      `insert into pa24.binding (app_id, tenant_key, owner_open_id, lark_profile, status, chat_id)
       values ($1, $2, $3, $4, 'active', $5)
       on conflict (app_id, tenant_key, owner_open_id) do update
         set lark_profile = excluded.lark_profile, updated_at = now()
       returning *`,
      [row.appId, row.tenantKey, row.ownerOpenId, row.larkProfile, row.chatId ?? null],
    );
    return result.rows[0]!;
  }

  async get(appId: string, tenantKey: string, ownerOpenId: string): Promise<BindingRow | null> {
    const result = await this.db.query<BindingRow>(
      'select * from pa24.binding where app_id = $1 and tenant_key = $2 and owner_open_id = $3',
      [appId, tenantKey, ownerOpenId],
    );
    return result.rows[0] ?? null;
  }

  /** Tenants already bound for this app+owner; used to refuse a foreign tenant. Placeholder rows written before any real tenant key are ignored. */
  async tenantsFor(appId: string, ownerOpenId: string): Promise<string[]> {
    const result = await this.db.query<{ tenant_key: string }>(
      `select distinct tenant_key from pa24.binding
       where app_id = $1 and owner_open_id = $2 and tenant_key <> 'unknown'`,
      [appId, ownerOpenId],
    );
    return result.rows.map(r => r.tenant_key);
  }
}

export interface WorkspaceStateRow {
  path: string;
  feishu_session_id: string | null;
  local_session_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class WorkspaceStateRepo {
  constructor(private readonly db: PaDatabase) {}

  async save(path: string, sessions: { feishuSessionId?: string; localSessionId?: string }): Promise<WorkspaceStateRow> {
    const result = await this.db.query<WorkspaceStateRow>(
      `insert into pa24.workspace_state (path, feishu_session_id, local_session_id) values ($1, $2, $3)
       on conflict (path) do update set
         feishu_session_id = coalesce(excluded.feishu_session_id, pa24.workspace_state.feishu_session_id),
         local_session_id = coalesce(excluded.local_session_id, pa24.workspace_state.local_session_id),
         updated_at = now()
       returning *`,
      [path, sessions.feishuSessionId ?? null, sessions.localSessionId ?? null],
    );
    return result.rows[0]!;
  }

  async get(path: string): Promise<WorkspaceStateRow | null> {
    const result = await this.db.query<WorkspaceStateRow>('select * from pa24.workspace_state where path = $1', [path]);
    return result.rows[0] ?? null;
  }
}

export interface MemoRow {
  id: string;
  work_item_id: string | null;
  topic: string;
  content: string;
  doc_url: string | null;
  doc_id: string | null;
  doc_revision: string | null;
  source: string;
  occurred_on: string | null;
  created_at: Date;
}

export class MemoRepo {
  constructor(private readonly db: PaDatabase) {}

  async insert(row: Omit<MemoRow, 'created_at'>): Promise<MemoRow> {
    // Idempotent upsert keyed by operation id: a crash between the memo write
    // and the operation's success update must not make the retry unrecoverable.
    const result = await this.db.query<MemoRow>(
      `insert into pa24.memo (id, work_item_id, topic, content, doc_url, doc_id, doc_revision, source, occurred_on)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do update set
         topic = excluded.topic,
         content = excluded.content,
         doc_url = excluded.doc_url,
         doc_id = excluded.doc_id,
         doc_revision = excluded.doc_revision,
         source = excluded.source,
         occurred_on = excluded.occurred_on
       returning *`,
      [row.id, row.work_item_id, row.topic, row.content, row.doc_url, row.doc_id, row.doc_revision, row.source, row.occurred_on],
    );
    return result.rows[0]!;
  }

  async get(id: string): Promise<MemoRow | null> {
    const result = await this.db.query<MemoRow>('select * from pa24.memo where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async search(filter: { topic?: string; query?: string; from?: string; to?: string; limit?: number }): Promise<MemoRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let n = 1;
    if (filter.topic) {
      conditions.push(`topic = $${n}`);
      values.push(filter.topic);
      n += 1;
    }
    if (filter.query) {
      conditions.push(`(content ilike $${n} or topic ilike $${n})`);
      values.push(`%${filter.query}%`);
      n += 1;
    }
    if (filter.from) {
      conditions.push(`occurred_on >= $${n}::date`);
      values.push(filter.from);
      n += 1;
    }
    if (filter.to) {
      conditions.push(`occurred_on <= $${n}::date`);
      values.push(filter.to);
      n += 1;
    }
    const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const result = await this.db.query<MemoRow>(
      `select * from pa24.memo ${where} order by created_at desc limit $${n}`,
      [...values, Math.min(filter.limit ?? 20, 100)],
    );
    return result.rows;
  }
}

export interface TaskRow {
  id: string;
  work_item_id: string | null;
  task_guid: string;
  url: string | null;
  summary: string;
  due_at: Date | null;
  due_has_time: boolean;
  planned_at: Date | null;
  estimate_minutes: number | null;
  status: string;
  external_updated_at: Date | null;
  last_synced_at: Date | null;
  created_at: Date;
}

export class TaskRepo {
  constructor(private readonly db: PaDatabase) {}

  /** Upsert the local projection; Feishu remains the authority. */
  async save(row: Omit<TaskRow, 'created_at'> & { created_at?: Date }): Promise<TaskRow> {
    const result = await this.db.query<TaskRow>(
      `insert into pa24.task (id, work_item_id, task_guid, url, summary, due_at, due_has_time, planned_at, estimate_minutes, status, external_updated_at, last_synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do update set
         task_guid = excluded.task_guid,
         url = excluded.url,
         summary = excluded.summary,
         due_at = excluded.due_at,
         due_has_time = excluded.due_has_time,
         planned_at = excluded.planned_at,
         estimate_minutes = excluded.estimate_minutes,
         status = excluded.status,
         external_updated_at = excluded.external_updated_at,
         last_synced_at = excluded.last_synced_at
       returning *`,
      [row.id, row.work_item_id ?? null, row.task_guid, row.url, row.summary, row.due_at, row.due_has_time ?? false, row.planned_at, row.estimate_minutes, row.status, row.external_updated_at, row.last_synced_at],
    );
    return result.rows[0]!;
  }

  async byGuid(guid: string): Promise<TaskRow | null> {
    const result = await this.db.query<TaskRow>('select * from pa24.task where task_guid = $1', [guid]);
    return result.rows[0] ?? null;
  }

  async get(id: string): Promise<TaskRow | null> {
    const result = await this.db.query<TaskRow>('select * from pa24.task where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async list(status?: string, limit = 50): Promise<TaskRow[]> {
    const result = status
      ? await this.db.query<TaskRow>('select * from pa24.task where status = $1 order by created_at desc limit $2', [status, limit])
      : await this.db.query<TaskRow>('select * from pa24.task order by created_at desc limit $1', [limit]);
    return result.rows;
  }
}

export interface ProjectRow {
  id: string;
  name: string;
  goal: string;
  status: string;
  created_at: Date;
}

export class ProjectRepo {
  constructor(private readonly db: PaDatabase) {}

  async create(row: { id: string; name: string; goal?: string }): Promise<ProjectRow> {
    const result = await this.db.query<ProjectRow>(
      `insert into pa24.project (id, name, goal) values ($1,$2,$3)
       on conflict (id) do update set name = excluded.name, goal = excluded.goal returning *`,
      [row.id, row.name, row.goal ?? ''],
    );
    return result.rows[0]!;
  }

  async get(id: string): Promise<ProjectRow | null> {
    const result = await this.db.query<ProjectRow>('select * from pa24.project where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async link(projectId: string, taskId: string): Promise<void> {
    await this.db.query(
      `insert into pa24.project_task (project_id, task_id) values ($1,$2) on conflict do nothing`,
      [projectId, taskId],
    );
  }

  async tasksOf(projectId: string): Promise<TaskRow[]> {
    const result = await this.db.query<TaskRow>(
      `select t.* from pa24.task t join pa24.project_task pt on pt.task_id = t.id
       where pt.project_id = $1 order by t.created_at`,
      [projectId],
    );
    return result.rows;
  }
}

export interface CalendarEventRow {
  event_id: string;
  calendar_id: string;
  summary: string;
  start_time: Date;
  end_time: Date;
  is_all_day: boolean;
  timezone: string | null;
  status: string;
  recurring: boolean;
  attendees: any;
  url: string | null;
  raw: any;
  synced_at: Date;
}

export interface CalendarSyncRow {
  calendar_id: string;
  window_start: Date;
  window_end: Date;
  complete: boolean;
  last_synced_at: Date | null;
  last_error: string | null;
}

export class CalendarRepo {
  constructor(private readonly db: PaDatabase) {}

  async upsertEvent(row: Omit<CalendarEventRow, 'synced_at'> & { synced_at?: Date }): Promise<CalendarEventRow> {
    const result = await this.db.query<CalendarEventRow>(
      `insert into pa24.calendar_event (event_id, calendar_id, summary, start_time, end_time, is_all_day, timezone, status, recurring, attendees, url, raw, synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       on conflict (event_id) do update set
         summary = excluded.summary,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         is_all_day = excluded.is_all_day,
         timezone = excluded.timezone,
         status = excluded.status,
         recurring = excluded.recurring,
         attendees = excluded.attendees,
         url = excluded.url,
         raw = excluded.raw,
         synced_at = now()
       returning *`,
      [row.event_id, row.calendar_id, row.summary, row.start_time, row.end_time, row.is_all_day, row.timezone, row.status, row.recurring,
       row.attendees === undefined ? null : JSON.stringify(row.attendees), row.url, row.raw === undefined ? null : JSON.stringify(row.raw)],
    );
    return result.rows[0]!;
  }

  async markCanceledExcept(calendarId: string, liveEventIds: readonly string[], windowStart: Date, windowEnd: Date): Promise<void> {
    await this.db.query(
      `update pa24.calendar_event set status = 'canceled', synced_at = now()
       where calendar_id = $1 and status = 'active'
         and not (end_time <= $2 or start_time >= $3)
         and event_id <> all($4::text[])`,
      [calendarId, windowStart, windowEnd, liveEventIds],
    );
  }

  async eventsIn(calendarId: string, from: Date, to: Date): Promise<CalendarEventRow[]> {
    const result = await this.db.query<CalendarEventRow>(
      `select * from pa24.calendar_event
       where calendar_id = $1 and status = 'active' and start_time < $3 and end_time > $2
       order by start_time`,
      [calendarId, from, to],
    );
    return result.rows;
  }

  async markCanceled(eventId: string): Promise<void> {
    await this.db.query(`update pa24.calendar_event set status = 'canceled', synced_at = now() where event_id = $1`, [eventId]);
  }

  async findEvent(eventId: string): Promise<CalendarEventRow | null> {
    const result = await this.db.query<CalendarEventRow>('select * from pa24.calendar_event where event_id = $1', [eventId]);
    return result.rows[0] ?? null;
  }

  /**
   * Persist sync state. A failed sync advances the error/complete flags but
   * must NOT advance last_synced_at: that timestamp means "data current as
   * of", and a failure provides no such guarantee.
   */
  async saveSync(row: Omit<CalendarSyncRow, 'last_synced_at' | 'last_error'> & { lastError?: string }): Promise<void> {
    const ok = row.complete && !row.lastError;
    await this.db.query(
      `insert into pa24.calendar_sync_state (calendar_id, window_start, window_end, complete, last_synced_at, last_error)
       values ($1,$2,$3,$4,${ok ? 'now()' : 'null'},$5)
       on conflict (calendar_id) do update set
         window_start = excluded.window_start,
         window_end = excluded.window_end,
         complete = excluded.complete,
         last_synced_at = coalesce(excluded.last_synced_at, pa24.calendar_sync_state.last_synced_at),
         last_error = excluded.last_error`,
      [row.calendar_id, row.window_start, row.window_end, row.complete, row.lastError ?? null],
    );
  }

  async getSync(calendarId: string): Promise<CalendarSyncRow | null> {
    const result = await this.db.query<CalendarSyncRow>('select * from pa24.calendar_sync_state where calendar_id = $1', [calendarId]);
    return result.rows[0] ?? null;
  }
}

export interface ReminderRuleRow {
  id: string;
  kind: string;
  text: string;
  record: any;
  status: string;
  next_due_at: Date | null;
  time_zone: string;
  origin_expression: string | null;
  source: string | null;
  work_item_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReminderOccurrenceRow {
  id: string;
  rule_id: string;
  due_at: Date;
  status: string;
  deferred_until: Date | null;
  origin_occurrence_id: string | null;
  outbox_dedup_key: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ReminderRepo {
  constructor(private readonly db: PaDatabase) {}

  async insertRule(row: Omit<ReminderRuleRow, 'created_at' | 'updated_at'>): Promise<ReminderRuleRow> {
    const result = await this.db.query<ReminderRuleRow>(
      `insert into pa24.reminder_rule (id, kind, text, record, status, next_due_at, time_zone, origin_expression, source, work_item_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [row.id, row.kind, row.text, JSON.stringify(row.record), row.status, row.next_due_at, row.time_zone, row.origin_expression, row.source, row.work_item_id],
    );
    return result.rows[0]!;
  }

  async updateRule(id: string, patch: Partial<Pick<ReminderRuleRow, 'status' | 'next_due_at' | 'record'>>): Promise<ReminderRuleRow | null> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(key === 'record' ? JSON.stringify(value) : value ?? null);
      n += 1;
    }
    const result = await this.db.query<ReminderRuleRow>(`update pa24.reminder_rule set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  async getRule(id: string): Promise<ReminderRuleRow | null> {
    const result = await this.db.query<ReminderRuleRow>('select * from pa24.reminder_rule where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async listRules(status?: string): Promise<ReminderRuleRow[]> {
    const result = status
      ? await this.db.query<ReminderRuleRow>('select * from pa24.reminder_rule where status = $1 order by next_due_at nulls last limit 100', [status])
      : await this.db.query<ReminderRuleRow>('select * from pa24.reminder_rule order by next_due_at nulls last limit 100');
    return result.rows;
  }

  async dueRuleIds(now: Date, lookaheadMs: number): Promise<ReminderRuleRow[]> {
    const result = await this.db.query<ReminderRuleRow>(
      `select * from pa24.reminder_rule where status = 'active' and next_due_at is not null and next_due_at <= $1::timestamptz + make_interval(secs => $2)`,
      [now, lookaheadMs / 1000],
    );
    return result.rows;
  }

  /** Idempotent occurrence materialization (unique PK per rule+instant). */
  async insertOccurrence(row: { id: string; ruleId: string; dueAt: Date; originOccurrenceId?: string }): Promise<boolean> {
    const result = await this.db.query(
      `insert into pa24.reminder_occurrence (id, rule_id, due_at, origin_occurrence_id)
       values ($1,$2,$3,$4) on conflict (id) do nothing`,
      [row.id, row.ruleId, row.dueAt, row.originOccurrenceId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimDueOccurrences(now: Date, limit: number): Promise<ReminderOccurrenceRow[]> {
    const result = await this.db.query<ReminderOccurrenceRow>(
      `update pa24.reminder_occurrence set attempts = attempts + 1
       where id in (
         select id from pa24.reminder_occurrence
         where status = 'pending' and due_at <= $1
           and (deferred_until is null or deferred_until <= $1)
         order by due_at limit $2 for update skip locked
       ) returning *`,
      [now, limit],
    );
    return result.rows;
  }

  /**
   * Update an occurrence. When `fromStatus` is given the update is guarded on
   * that status: terminal/control transitions (sent/skipped/snoozed/canceled)
   * only apply from pending, so an in-flight dispatch can never overwrite a
   * cancel/skip that landed first, and vice versa.
   */
  async updateOccurrence(
    id: string,
    patch: Partial<Pick<ReminderOccurrenceRow, 'status' | 'deferred_until' | 'outbox_dedup_key' | 'last_error'>>,
    fromStatus?: string,
  ): Promise<void> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    if (fromStatus) {
      values.push(fromStatus);
      await this.db.query(
        `update pa24.reminder_occurrence set ${sets.join(', ')} where id = $1 and status = $${n}::text`,
        values,
      );
      return;
    }
    await this.db.query(`update pa24.reminder_occurrence set ${sets.join(', ')} where id = $1`, values);
  }

  async nextPendingOccurrence(ruleId: string): Promise<ReminderOccurrenceRow | null> {
    const result = await this.db.query<ReminderOccurrenceRow>(
      `select * from pa24.reminder_occurrence where rule_id = $1 and status = 'pending' order by due_at limit 1`,
      [ruleId],
    );
    return result.rows[0] ?? null;
  }

  async occurrence(id: string): Promise<ReminderOccurrenceRow | null> {
    const result = await this.db.query<ReminderOccurrenceRow>('select * from pa24.reminder_occurrence where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async recentOccurrences(limit = 50): Promise<ReminderOccurrenceRow[]> {
    const result = await this.db.query<ReminderOccurrenceRow>('select * from pa24.reminder_occurrence order by updated_at desc limit $1', [limit]);
    return result.rows;
  }
}

export interface MessageRouteRow {
  message_id: string;
  channel: string;
  kind: string;
  work_item_id: string | null;
  inbox_event_id: string | null;
  note_id: string | null;
  created_at: Date;
}

export class MessageRouteRepo {
  constructor(private readonly db: PaDatabase) {}

  /** Durable platform-message → work item / inbox / note routing (P05, P28). */
  async record(messageId: string, route: { kind: 'workitem' | 'reply' | 'status' | 'notice' | 'note'; workItemId?: string; inboxEventId?: string; noteId?: string }): Promise<void> {
    await this.db.query(
      `insert into pa24.message_route (message_id, channel, kind, work_item_id, inbox_event_id, note_id)
       values ($1, 'feishu', $2, $3, $4, $5) on conflict (message_id) do nothing`,
      [messageId, route.kind, route.workItemId ?? null, route.inboxEventId ?? null, route.noteId ?? null],
    );
  }

  async lookup(messageId: string): Promise<MessageRouteRow | null> {
    const result = await this.db.query<MessageRouteRow>('select * from pa24.message_route where message_id = $1', [messageId]);
    return result.rows[0] ?? null;
  }
}

// ---- handwriting notes (F06) ----------------------------------------------
// Originals are stored under the workspace (.24pa/originals/) with hashes in
// PG; versions keep immutable snapshots and fingerprints so review decisions
// always name the exact content they cover.

export type NoteStatus = 'collecting' | 'awaiting_review' | 'approved' | 'returned' | 'needs_rereview';
export type NoteVersionStatus = 'pending_review' | 'approved' | 'returned' | 'stale' | 'superseded';

export interface NoteRow {
  id: string;
  title: string;
  status: NoteStatus | string;
  origin: string;
  work_item_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface NotePageRow {
  id: string;
  note_id: string;
  page_no: number;
  message_id: string;
  image_key: string | null;
  media_type: string;
  byte_size: number;
  sha256: string;
  storage_path: string;
  /** 'image' = platform-compressed photo, 'file' = uploaded file original (P28). */
  source_type: 'image' | 'file' | string;
  quality: string | null;
  status: 'saved' | 'rejected' | string;
  created_at: Date;
}

export interface NoteVersionRow {
  id: string;
  note_id: string;
  version: number;
  doc_id: string | null;
  doc_url: string | null;
  doc_revision: string | null;
  fingerprint: string;
  normalized_text: string;
  content: any;
  doc_snapshot: string;
  status: NoteVersionStatus | string;
  /** Last bounded verification of the live document (P32: matches/changed/unknown + when). */
  verified_at: Date | null;
  verify_result: 'matches' | 'changed' | 'unknown' | null;
  verify_fingerprint: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export interface ReviewTokenRow {
  token: string;
  note_id: string;
  version_id: string;
  action: 'approve' | 'return' | string;
  owner_open_id: string;
  fingerprint: string;
  expires_at: Date;
  used_at: Date | null;
  result: any;
}

export interface ReviewDecisionRow {
  id: string;
  note_id: string;
  version_id: string;
  decision: 'approve' | 'return' | string;
  reviewer_open_id: string;
  token: string;
  fingerprint: string;
  decided_at: Date;
  doc_sync_status: 'pending' | 'synced' | 'failed' | string;
  doc_sync_error: string | null;
}

export class NoteRepo {
  constructor(private readonly db: PaDatabase) {}

  async nextNoteId(): Promise<string> {
    const result = await this.db.query<{ next: string }>(`select nextval('pa24.note_seq') as next`);
    return `N-${Number(result.rows[0]!.next)}`;
  }

  async insertNote(row: { id: string; title: string; origin: string; workItemId?: string | null }): Promise<NoteRow> {
    const result = await this.db.query<NoteRow>(
      `insert into pa24.note (id, title, status, origin, work_item_id) values ($1, $2, 'collecting', $3, $4) returning *`,
      [row.id, row.title, row.origin, row.workItemId ?? null],
    );
    return result.rows[0]!;
  }

  async getNote(id: string): Promise<NoteRow | null> {
    const result = await this.db.query<NoteRow>('select * from pa24.note where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async noteByWorkItem(workItemId: string): Promise<NoteRow | null> {
    const result = await this.db.query<NoteRow>(
      'select * from pa24.note where work_item_id = $1 order by created_at desc limit 1',
      [workItemId],
    );
    return result.rows[0] ?? null;
  }

  async updateNote(id: string, patch: Partial<Pick<NoteRow, 'status' | 'title' | 'work_item_id'>>): Promise<NoteRow | null> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    const result = await this.db.query<NoteRow>(`update pa24.note set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  async listNotes(status?: string, limit = 50): Promise<NoteRow[]> {
    const result = status
      ? await this.db.query<NoteRow>('select * from pa24.note where status = $1 order by created_at desc limit $2', [status, limit])
      : await this.db.query<NoteRow>('select * from pa24.note order by created_at desc limit $1', [limit]);
    return result.rows;
  }

  async insertPage(row: Omit<NotePageRow, 'id' | 'created_at'>): Promise<{ inserted: boolean; row: NotePageRow }> {
    const id = `${row.note_id}:p${row.page_no}`;
    const result = await this.db.query<NotePageRow>(
      `insert into pa24.note_page (id, note_id, page_no, message_id, image_key, media_type, byte_size, sha256, storage_path, source_type, quality, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (note_id, page_no) do update set
         message_id = excluded.message_id,
         image_key = excluded.image_key,
         media_type = excluded.media_type,
         byte_size = excluded.byte_size,
         sha256 = excluded.sha256,
         storage_path = excluded.storage_path,
         source_type = excluded.source_type,
         quality = excluded.quality,
         status = excluded.status
       returning *`,
      [id, row.note_id, row.page_no, row.message_id, row.image_key, row.media_type, row.byte_size, row.sha256, row.storage_path, row.source_type ?? 'image', row.quality, row.status],
    );
    return { inserted: true, row: result.rows[0]! };
  }

  async getPage(noteId: string, pageNo: number): Promise<NotePageRow | null> {
    const result = await this.db.query<NotePageRow>('select * from pa24.note_page where note_id = $1 and page_no = $2', [noteId, pageNo]);
    return result.rows[0] ?? null;
  }

  async pagesOf(noteId: string): Promise<NotePageRow[]> {
    const result = await this.db.query<NotePageRow>('select * from pa24.note_page where note_id = $1 order by page_no', [noteId]);
    return result.rows;
  }

  async latestVersion(noteId: string): Promise<NoteVersionRow | null> {
    const result = await this.db.query<NoteVersionRow>('select * from pa24.note_version where note_id = $1 order by version desc limit 1', [noteId]);
    return result.rows[0] ?? null;
  }

  async getVersion(id: string): Promise<NoteVersionRow | null> {
    const result = await this.db.query<NoteVersionRow>('select * from pa24.note_version where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async versionsOf(noteId: string): Promise<NoteVersionRow[]> {
    const result = await this.db.query<NoteVersionRow>('select * from pa24.note_version where note_id = $1 order by version', [noteId]);
    return result.rows;
  }

  async insertVersion(row: Omit<NoteVersionRow, 'created_at' | 'decided_at' | 'verified_at' | 'verify_result' | 'verify_fingerprint'>): Promise<NoteVersionRow> {
    const result = await this.db.query<NoteVersionRow>(
      `insert into pa24.note_version (id, note_id, version, doc_id, doc_url, doc_revision, fingerprint, normalized_text, content, doc_snapshot, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [row.id, row.note_id, row.version, row.doc_id, row.doc_url, row.doc_revision, row.fingerprint, row.normalized_text,
       JSON.stringify(row.content), row.doc_snapshot, row.status],
    );
    return result.rows[0]!;
  }

  async updateVersion(id: string, patch: Partial<Pick<NoteVersionRow, 'status' | 'decided_at' | 'doc_revision' | 'verified_at' | 'verify_result' | 'verify_fingerprint'>>): Promise<NoteVersionRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    if (sets.length === 0) return this.getVersion(id);
    const result = await this.db.query<NoteVersionRow>(`update pa24.note_version set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  /** Mark older versions superseded when a newer one is published; approvals keep their own historical status. */
  async supersedeOlder(noteId: string, beforeVersion: number): Promise<void> {
    await this.db.query(
      `update pa24.note_version set status = 'superseded' where note_id = $1 and version < $2 and status in ('pending_review', 'stale')`,
      [noteId, beforeVersion],
    );
  }

  async insertToken(row: Omit<ReviewTokenRow, 'used_at' | 'result'>): Promise<ReviewTokenRow> {
    const result = await this.db.query<ReviewTokenRow>(
      `insert into pa24.review_token (token, note_id, version_id, action, owner_open_id, fingerprint, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [row.token, row.note_id, row.version_id, row.action, row.owner_open_id, row.fingerprint, row.expires_at],
    );
    return result.rows[0]!;
  }

  async getToken(token: string): Promise<ReviewTokenRow | null> {
    const result = await this.db.query<ReviewTokenRow>('select * from pa24.review_token where token = $1', [token]);
    return result.rows[0] ?? null;
  }

  /** Single-writer claim: only the first click decides; later clicks see the stored result. */
  async useToken(token: string): Promise<{ claimed: boolean; row: ReviewTokenRow }> {
    const result = await this.db.query<ReviewTokenRow>(
      `update pa24.review_token set used_at = now() where token = $1 and used_at is null returning *`,
      [token],
    );
    if ((result.rowCount ?? 0) > 0) return { claimed: true, row: result.rows[0]! };
    const existing = await this.db.query<ReviewTokenRow>('select * from pa24.review_token where token = $1', [token]);
    return { claimed: false, row: existing.rows[0]! };
  }

  async markTokenResult(token: string, result: unknown): Promise<void> {
    await this.db.query(`update pa24.review_token set result = $2 where token = $1`, [token, JSON.stringify(result)]);
  }

  async decisionsOf(noteId: string): Promise<ReviewDecisionRow[]> {
    const result = await this.db.query<ReviewDecisionRow>('select * from pa24.review_decision where note_id = $1 order by decided_at', [noteId]);
    return result.rows;
  }

  async updateDecisionSync(id: string, patch: { docSyncStatus: 'synced' | 'failed'; error?: string }): Promise<void> {
    await this.db.query(
      `update pa24.review_decision set doc_sync_status = $2, doc_sync_error = $3 where id = $1`,
      [id, patch.docSyncStatus, patch.error ?? null],
    );
  }

  async failedSyncDecisions(noteId: string): Promise<ReviewDecisionRow[]> {
    const result = await this.db.query<ReviewDecisionRow>(
      `select * from pa24.review_decision where note_id = $1 and doc_sync_status = 'failed' order by decided_at`,
      [noteId],
    );
    return result.rows;
  }

  /**
   * Transactional review decision (P31): credential, version state, note state
   * and the owner-notification intent commit together on one client.
   */
  async decideVersion(client: any, row: {
    decisionId: string;
    noteId: string;
    versionId: string;
    versionStatus: 'approved' | 'returned';
    noteStatus: 'approved' | 'returned';
    decision: 'approve' | 'return';
    reviewerOpenId: string;
    token: string;
    fingerprint: string;
    notifyDedupKey: string;
    notifyTarget: string;
    notifyText: string;
  }): Promise<void> {
    await client.query(
      `insert into pa24.review_decision (id, note_id, version_id, decision, reviewer_open_id, token, fingerprint)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [row.decisionId, row.noteId, row.versionId, row.decision, row.reviewerOpenId, row.token, row.fingerprint],
    );
    await client.query(`update pa24.note_version set status = $2, decided_at = now() where id = $1`, [row.versionId, row.versionStatus]);
    await client.query(`update pa24.note set status = $2, updated_at = now() where id = $1`, [row.noteId, row.noteStatus]);
    await client.query(
      `insert into pa24.outbox (dedup_key, channel, target, kind, content, status)
       values ($1, 'feishu', $2, 'text', $3::jsonb, 'pending') on conflict (dedup_key) do nothing`,
      [row.notifyDedupKey, row.notifyTarget, JSON.stringify({ text: row.notifyText })],
    );
    // Decided versions stop nagging immediately, in the same transaction (P33).
    await client.query(
      `update pa24.review_reminder set status = 'canceled', updated_at = now() where version_id = $1 and status in ('pending', 'paused')`,
      [row.versionId],
    );
  }

  /** Review queue: notes awaiting action with their latest version state (P33). */
  async reviewQueue(limit = 50): Promise<(NoteRow & { latest: NoteVersionRow | null; pages: number })[]> {
    const result = await this.db.query<NoteRow>(
      `select * from pa24.note where status in ('awaiting_review', 'needs_rereview', 'returned') order by updated_at desc limit $1`,
      [limit],
    );
    const rows = [] as (NoteRow & { latest: NoteVersionRow | null; pages: number })[];
    for (const note of result.rows) {
      const latest = await this.latestVersion(note.id);
      const pages = await this.db.query<{ count: string }>(
        `select count(*) as count from pa24.note_page where note_id = $1 and status = 'saved'`,
        [note.id],
      );
      rows.push({ ...note, latest, pages: Number(pages.rows[0]!.count) });
    }
    return rows;
  }

  /** Pending-review versions for the bounded polling loop (P32). */
  async pendingReviewVersions(limit: number): Promise<NoteVersionRow[]> {
    const result = await this.db.query<NoteVersionRow>(
      `select * from pa24.note_version where status = 'pending_review' order by created_at limit $1`,
      [limit],
    );
    return result.rows;
  }
}

export interface ReviewReminderRow {
  id: string;
  note_id: string;
  version_id: string;
  kind: 'once' | 'daily' | string;
  remind_at: Date;
  status: 'pending' | 'paused' | 'sent' | 'done' | 'canceled' | string;
  sent_count: number;
  last_sent_at: Date | null;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ReviewReminderRepo {
  constructor(private readonly db: PaDatabase) {}

  async insert(row: { id: string; noteId: string; versionId: string; kind: 'once' | 'daily'; remindAt: Date; reason?: string }): Promise<ReviewReminderRow> {
    const result = await this.db.query<ReviewReminderRow>(
      `insert into pa24.review_reminder (id, note_id, version_id, kind, remind_at, reason)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [row.id, row.noteId, row.versionId, row.kind, row.remindAt, row.reason ?? null],
    );
    return result.rows[0]!;
  }

  async get(id: string): Promise<ReviewReminderRow | null> {
    const result = await this.db.query<ReviewReminderRow>('select * from pa24.review_reminder where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  /** Due, unpaused reminders; claimed with SKIP LOCKED so one Host sends once. */
  async claimDue(now: Date, limit: number): Promise<ReviewReminderRow[]> {
    const result = await this.db.query<ReviewReminderRow>(
      `update pa24.review_reminder set updated_at = now()
       where id in (
         select id from pa24.review_reminder
         where status = 'pending' and remind_at <= $1
         order by remind_at limit $2 for update skip locked
       ) returning *`,
      [now, limit],
    );
    return result.rows;
  }

  async update(id: string, patch: Partial<Pick<ReviewReminderRow, 'status' | 'remind_at' | 'sent_count' | 'last_sent_at'>>): Promise<ReviewReminderRow | null> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    const result = await this.db.query<ReviewReminderRow>(`update pa24.review_reminder set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  /** Cancel every in-flight nag for a version (decision/supersede path). */
  async cancelForVersion(versionId: string, client?: any): Promise<number> {
    const query = client ?? this.db;
    const result = await query.query
      ? query.query(`update pa24.review_reminder set status = 'canceled', updated_at = now() where version_id = $1 and status in ('pending', 'paused')`, [versionId])
      : await this.db.query(`update pa24.review_reminder set status = 'canceled', updated_at = now() where version_id = $1 and status in ('pending', 'paused')`, [versionId]);
    return result.rowCount ?? 0;
  }

  async activeForNote(noteId: string): Promise<ReviewReminderRow[]> {
    const result = await this.db.query<ReviewReminderRow>(
      `select * from pa24.review_reminder where note_id = $1 and status in ('pending', 'paused') order by remind_at`,
      [noteId],
    );
    return result.rows;
  }

  async activeAll(limit = 50): Promise<ReviewReminderRow[]> {
    const result = await this.db.query<ReviewReminderRow>(
      `select * from pa24.review_reminder where status in ('pending', 'paused') order by remind_at limit $1`,
      [limit],
    );
    return result.rows;
  }
}

export interface Repos {
  inbox: InboxRepo;
  workItems: WorkItemRepo;
  operations: ActionOperationRepo;
  outbox: OutboxRepo;
  bindings: BindingRepo;
  workspaceState: WorkspaceStateRepo;
  memos: MemoRepo;
  messageRoutes: MessageRouteRepo;
  tasks: TaskRepo;
  projects: ProjectRepo;
  calendar: CalendarRepo;
  reminders: ReminderRepo;
  notes: NoteRepo;
  reviewReminders: ReviewReminderRepo;
}

export function createRepos(db: PaDatabase): Repos {
  return {
    inbox: new InboxRepo(db),
    workItems: new WorkItemRepo(db),
    operations: new ActionOperationRepo(db),
    outbox: new OutboxRepo(db),
    bindings: new BindingRepo(db),
    workspaceState: new WorkspaceStateRepo(db),
    memos: new MemoRepo(db),
    messageRoutes: new MessageRouteRepo(db),
    tasks: new TaskRepo(db),
    projects: new ProjectRepo(db),
    calendar: new CalendarRepo(db),
    reminders: new ReminderRepo(db),
    notes: new NoteRepo(db),
    reviewReminders: new ReviewReminderRepo(db),
  };
}
