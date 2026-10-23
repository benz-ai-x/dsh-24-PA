// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb, PaQueryer } from '../db.js';

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'unknown' | 'failed' | 'expired';

export interface OutboxRow {
  id: number;
  dedup_key: string;
  channel: 'feishu' | 'local' | 'wecom';
  target: string;
  kind: 'text' | 'card' | 'audio';
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
  channel: 'feishu' | 'local' | 'wecom';
  target: string;
  kind: 'text' | 'card' | 'audio';
  content: unknown;
}

/** Shared insertion for business transactions that also enqueue a notification. */
export async function enqueueOutbox(db: PaQueryer, row: NewOutbox): Promise<{ created: boolean; row: OutboxRow }> {
  const result = await db.query<OutboxRow>(
    `insert into pa24.outbox (dedup_key, channel, target, kind, content, status)
     values ($1, $2, $3, $4, $5, 'pending') on conflict (dedup_key) do nothing returning *`,
    [row.dedupKey, row.channel, row.target, row.kind, JSON.stringify(row.content)],
  );
  if (result.rowCount === 0) {
    const existing = await db.query<OutboxRow>('select * from pa24.outbox where dedup_key = $1', [row.dedupKey]);
    return { created: false, row: existing.rows[0]! };
  }
  return { created: true, row: result.rows[0]! };
}

export class OutboxRepo {
  constructor(private readonly db: PaDb) {}

  /** Idempotent enqueue: one business notification keeps one stable key. */
  async enqueue(row: NewOutbox): Promise<{ created: boolean; row: OutboxRow }> {
    return enqueueOutbox(this.db, row);
  }

  async recoverInterrupted(): Promise<void> {
    await this.db.query(`update pa24.outbox set status = 'unknown', last_error = '投递中断且未保存平台回执；请先核对，不自动重发。' where status = 'sending' and message_id is null`);
    await this.db.query(`update pa24.outbox set status = 'pending', next_attempt_at = null where status in ('sending', 'unknown') and message_id is not null`);
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

  async mark(id: number, patch: { status: OutboxStatus; messageId?: string; error?: string; retryInMs?: number; releaseAttempt?: boolean }): Promise<void> {
    await this.db.query(
      `update pa24.outbox set
         status = case when $8::bool then 'expired' else $2::text end,
         message_id = coalesce($3, message_id),
         last_error = $4,
         attempts = case when $9::bool and attempts > 0 then attempts - 1 else attempts end,
         sent_at = case when $5::bool then now() else sent_at end,
         next_attempt_at = case when $6::bool then now() + make_interval(secs => $7) else next_attempt_at end
       where id = $1`,
      [id, patch.status, patch.messageId ?? null, patch.error ?? null, patch.status === 'sent', patch.retryInMs !== undefined, (patch.retryInMs ?? 0) / 1000, patch.status === 'expired', patch.releaseAttempt === true],
    );
  }

  async recent(limit = 50): Promise<OutboxRow[]> {
    const result = await this.db.query<OutboxRow>('select * from pa24.outbox order by id desc limit $1', [limit]);
    return result.rows;
  }
}
