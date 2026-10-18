// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

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
  constructor(private readonly db: PaDb) {}

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

/** Which channel owns a projected task/calendar row (F16, spec 1.6). */
