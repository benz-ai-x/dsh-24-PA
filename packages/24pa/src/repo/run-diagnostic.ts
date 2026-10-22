import { createHash } from 'node:crypto';
import type { PaDb } from '../db.js';

export interface RunDiagnosticRow {
  id: string; run_id: string; phase: string; detail: Record<string, unknown>; created_at: Date;
}

/** Optional technical traces have their own retention; business evidence is
 * never removed by this repository. Repeated observations do not reset age. */
export class RunDiagnosticRepo {
  constructor(private readonly db: PaDb) {}
  async append(runId: string, phase: string, detail: Record<string, unknown>): Promise<void> {
    const id = createHash('sha256').update(JSON.stringify([runId, phase, detail])).digest('hex');
    await this.db.query(`insert into pa24.run_diagnostic (id, run_id, phase, detail)
      values ($1,$2,$3,$4) on conflict (id) do nothing`, [id, runId, phase, JSON.stringify(detail)]);
  }
  async list(runId: string, days: number, now = new Date()): Promise<RunDiagnosticRow[]> {
    return (await this.db.query<RunDiagnosticRow>(`select * from pa24.run_diagnostic where run_id = $1 and created_at >= $2
      order by created_at, id`, [runId, new Date(now.getTime() - days * 86400000)])).rows;
  }
  async prune(days: number, now = new Date()): Promise<number> {
    return (await this.db.query('delete from pa24.run_diagnostic where created_at < $1', [new Date(now.getTime() - days * 86400000)])).rowCount;
  }
}
