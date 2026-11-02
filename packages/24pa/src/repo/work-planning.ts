import type { PaDb } from '../db.js';
import type { DailyWorkReview, PlanningContent } from '../work-planning-model.js';

export interface PlanningRow<T extends PlanningContent = PlanningContent> {
  id: string; revision: number; content: T; work_item_id: string; updated_at: Date;
}

/** Current records and immutable revisions commit together. A replay returns
 * its original receipt, never overwrites a more recent owner decision. */
export class WorkPlanningRepo {
  constructor(private readonly db: PaDb) {}

  async get<T extends PlanningContent>(id: string): Promise<PlanningRow<T> | null> {
    return (await this.db.query<PlanningRow<T>>('select * from pa24.work_planning where id = $1', [id])).rows[0] ?? null;
  }

  async revision<T extends PlanningContent>(id: string, revision: number): Promise<PlanningRow<T> | null> {
    const row = (await this.db.query<{ record: PlanningRow<T> }>('select record from pa24.work_planning_revision where record_id = $1 and revision = $2', [id, revision])).rows[0];
    return row ? { ...row.record, updated_at: new Date(row.record.updated_at) } : null;
  }

  async receipt<T extends PlanningContent>(requestKey: string): Promise<PlanningRow<T> | null> {
    const row = (await this.db.query<{ record: PlanningRow<T> }>('select record from pa24.work_planning_revision where request_key = $1', [requestKey])).rows[0];
    return row ? { ...row.record, updated_at: new Date(row.record.updated_at) } : null;
  }

  async previousReview(date: string, timeZone: string): Promise<PlanningRow<DailyWorkReview> | null> {
    return (await this.db.query<PlanningRow<DailyWorkReview>>(`select * from pa24.work_planning
      where id > $1 and id < $2 order by id desc limit 1`, [`review:${timeZone}:`, `review:${timeZone}:${date}`])).rows[0] ?? null;
  }

  async save<T extends PlanningContent>(id: string, expected: number, content: T, workId: string, requestKey: string,
    guards: { id: string; revision: number }[] = []): Promise<PlanningRow<T>> {
    return this.db.withTransaction(async tx => {
      // Guard creation as well as updates: SELECT FOR UPDATE cannot lock an
      // absent focus row. SQLite already serializes write transactions.
      if (this.db.kind === 'postgres') await tx.query('select pg_advisory_xact_lock(842289217, 32)');
      const previous = (await tx.query<{ record: PlanningRow<T> }>('select record from pa24.work_planning_revision where request_key = $1', [requestKey])).rows[0];
      if (previous) return { ...previous.record, updated_at: new Date(previous.record.updated_at) };
      for (const guard of guards) {
        const current = (await tx.query<PlanningRow>('select * from pa24.work_planning where id = $1 for update', [guard.id])).rows[0];
        if ((current?.revision ?? 0) !== guard.revision) throw new Error('规划依据已改变，请重新读取后再提交。');
      }
      const result = expected === 0
        ? await tx.query<PlanningRow<T>>(`insert into pa24.work_planning (id, revision, content, work_item_id)
            values ($1, 1, $2, $3) on conflict (id) do nothing returning *`, [id, JSON.stringify(content), workId])
        : await tx.query<PlanningRow<T>>(`update pa24.work_planning set revision = revision + 1, content = $3,
            work_item_id = $4, updated_at = now() where id = $1 and revision = $2 returning *`, [id, expected, JSON.stringify(content), workId]);
      const row = result.rows[0];
      if (!row) {
        const repeated = (await tx.query<{ record: PlanningRow<T> }>('select record from pa24.work_planning_revision where request_key = $1', [requestKey])).rows[0];
        if (repeated) return { ...repeated.record, updated_at: new Date(repeated.record.updated_at) };
        throw new Error('规划版本已改变，请重新读取后再提交。');
      }
      await tx.query(`insert into pa24.work_planning_revision (request_key, record_id, revision, record)
        values ($1, $2, $3, $4)`, [requestKey, id, row.revision, JSON.stringify(row)]);
      return row;
    });
  }
}
