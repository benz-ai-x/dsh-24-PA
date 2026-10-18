// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

export class MaintenanceRepo {
  constructor(private readonly db: PaDb) {}

  async watermarks(): Promise<Array<{ table: string; rows: number }>> {
    // `tbl` alias, not `table`: TABLE is a reserved word SQLite rejects as a
    // column alias (the equivalence matrix caught this — PG's leniency had
    // been masking it).
    const result = await this.db.query<{ tbl: string; n: string }>(
      `select 'work_item' as tbl, count(*) as n from pa24.work_item union all select 'note', count(*) from pa24.note union all select 'reminder_rule', count(*) from pa24.reminder_rule union all select 'outbox', count(*) from pa24.outbox`,
    );
    return result.rows.map(r => ({ table: r.tbl, rows: Number(r.n) }));
  }

  async unknownOperationCount(): Promise<number> {
    const result = await this.db.query<{ n: string }>(`select count(*) as n from pa24.action_operation where status = 'unknown'`);
    return Number(result.rows[0]?.n ?? 0);
  }

  async attemptTotals(): Promise<{ operations: number; outbox: number }> {
    const result = await this.db.query<{ ops: string; obx: string }>(
      `select (select coalesce(sum(attempt),0) from pa24.action_operation) as ops, (select coalesce(sum(attempts),0) from pa24.outbox) as obx`,
    );
    return { operations: Number(result.rows[0]?.ops ?? 0), outbox: Number(result.rows[0]?.obx ?? 0) };
  }
}
