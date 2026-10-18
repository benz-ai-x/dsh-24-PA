// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

export type DataChannel = 'feishu' | 'wecom';

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
  /** F16: which channel owns this task; legacy rows read as 'feishu'. */
  channel: DataChannel;
}

export class TaskRepo {
  constructor(private readonly db: PaDb) {}

  /** Upsert the local projection; the owning channel remains the authority. */
  async save(row: Omit<TaskRow, 'created_at' | 'channel'> & { created_at?: Date; channel?: DataChannel }): Promise<TaskRow> {
    const result = await this.db.query<TaskRow>(
      `insert into pa24.task (id, work_item_id, task_guid, url, summary, due_at, due_has_time, planned_at, estimate_minutes, status, external_updated_at, last_synced_at, channel)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
      [row.id, row.work_item_id ?? null, row.task_guid, row.url, row.summary, row.due_at, row.due_has_time ?? false, row.planned_at, row.estimate_minutes, row.status, row.external_updated_at, row.last_synced_at, row.channel ?? 'feishu'],
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
  constructor(private readonly db: PaDb) {}

  /** Id+name pairs for the today overview's project rollup (F28). */
  async listIdNames(): Promise<Array<{ id: string; name: string }>> {
    const result = await this.db.query<{ id: string; name: string }>('select id, name from pa24.project');
    return result.rows;
  }

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
