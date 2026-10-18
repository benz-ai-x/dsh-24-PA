// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

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

export class OutboxRepo {
  constructor(private readonly db: PaDb) {}

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
