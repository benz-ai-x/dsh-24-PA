// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

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
  constructor(private readonly db: PaDb) {}

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
