// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

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
  constructor(private readonly db: PaDb) {}

  async hasUnsettled(): Promise<boolean> {
    const result = await this.db.query(`select event_id from pa24.inbox where status in ('received', 'processing', 'admitted') limit 1`);
    return result.rows.length > 0;
  }

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

  /** Restart reconcile (F28): rows stuck mid-dispatch requeue for retry. */
  async resetProcessing(): Promise<void> {
    await this.db.query(`update pa24.inbox set status = 'received' where status = 'processing'`);
  }

  /** Restart reconcile (F28): admitted-but-undelivered events, surfaced to
   *  the owner instead of guessing an outcome across the crash. */
  async listAdmitted(): Promise<InboxRow[]> {
    const result = await this.db.query<InboxRow>(`select * from pa24.inbox where status = 'admitted'`);
    return result.rows;
  }

  /** Close out admitted events a finished work-item turn consumed (F28). */
  async settleDelivered(targetSession: string): Promise<void> {
    await this.db.query(
      `update pa24.inbox set status = 'delivered', processed_at = now() where target_session = $1 and status = 'admitted'`,
      [targetSession],
    );
  }

  async rejectForTarget(targetSession: string, error: string): Promise<void> {
    await this.db.query(`update pa24.inbox set status = 'rejected', error = $2, processed_at = now()
      where target_session = $1 and status = 'admitted'`, [targetSession, error]);
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
