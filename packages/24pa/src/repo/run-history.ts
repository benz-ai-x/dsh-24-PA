import type { PaDb } from '../db.js';

export type HistoryKind = 'runs' | 'work' | 'events' | 'legacy';
export interface HistoryFilter {
  kind: HistoryKind; from: Date | null; to: Date | null; includeUnresolved: boolean;
  query?: string; status?: string; deliveryStatus?: string; source?: string;
  workId?: string; planId?: string; skillId?: string; versionId?: string; offset: number; limit: number;
}
const RUN_SOURCE = `case when r.trial then 'trial'
  when r.snapshot->'continuation'->>'fromRunId' is not null then
    case when coalesce(r.snapshot->'continuation'->>'instruction', '') <> '' then 'continuation' else 'rerun' end
  when r.trigger_kind = 'schedule' then 'schedule' else 'manual' end`;
const EXECUTION_RECORD = `not exists (select 1 from pa24.plan_trigger unexecuted
  where unexecuted.run_id = r.id and unexecuted.status in ('skipped', 'rejected', 'expired'))`;
const DELIVERY_FAILURE = `exists (select 1 from pa24.task_plan_delivery d join pa24.outbox o on o.id = d.outbox_id
  where d.run_id = r.id and o.status in ('failed', 'unknown'))`;
const PLAN_BLOCKED = (planId: string) => `exists (select 1 from pa24.digest_plan blocked_plan where blocked_plan.id = ${planId}
  and blocked_plan.recycled_at is null and (exists (select 1 from pa24.task_plan_block b where b.plan_id = blocked_plan.id)
  or exists (select 1 from pa24.skill_plan_block b where b.plan_id = blocked_plan.id)))`;
const EVENT_UNRESOLVED = `((${PLAN_BLOCKED('r.plan_id')} and (r.status in ('rejected', 'expired')
  or exists (select 1 from pa24.skill_run stopped where stopped.id = r.run_id and stopped.stop_reason = 'blocked')))
  or exists (select 1 from pa24.task_plan_delivery d join pa24.outbox o on o.id = d.outbox_id
    where d.run_id = r.run_id and o.status in ('failed', 'unknown')))`;
const RUN_UNRESOLVED = `(r.status in ('waiting', 'needs_reconciliation', 'stopping') or ${DELIVERY_FAILURE}
  or (r.stop_reason = 'blocked' and ${PLAN_BLOCKED('r.plan_id')})
  or (r.status in ('failed', 'timed_out') and not exists (select 1 from pa24.skill_run later
    where later.work_item_id = r.work_item_id and later.created_at > r.created_at and later.status = 'completed')))`;

/** Read projections keep executions, work goals and non-execution events
 * separate. Counts use the entire matching ledger, never a recent-row cache. */
export class RunHistoryRepo {
  constructor(private readonly db: PaDb) {}
  async list(filter: HistoryFilter) {
    const values: unknown[] = [], clauses: string[] = [];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    let table: string, fields: string, search: string[], unresolved: string;
    if (filter.kind === 'runs') {
      table = 'pa24.skill_run r left join pa24.work_item w on w.id = r.work_item_id';
      fields = `r.id, coalesce(r.snapshot->'plan'->>'title', w.title, r.snapshot->>'name') as title,
        r.snapshot->>'name' as skill_name, r.skill_id, r.version_id, r.work_item_id, r.plan_id,
        r.status, r.delivery_status, r.progress, substr(r.result, 1, 300) as summary,
        ${RUN_SOURCE} as source, r.created_at, r.updated_at, r.triggered_at`;
      search = ['r.id', 'w.title', "r.snapshot->'plan'->>'title'", "r.snapshot->>'name'", 'r.progress', 'r.result']; unresolved = RUN_UNRESOLVED;
      clauses.push(EXECUTION_RECORD);
      for (const [key, column] of [['workId', 'r.work_item_id'], ['planId', 'r.plan_id'], ['skillId', 'r.skill_id'], ['versionId', 'r.version_id'], ['deliveryStatus', 'r.delivery_status']] as const) {
        if (filter[key]) clauses.push(`${column} = ${bind(filter[key])}`);
      }
      if (filter.source) clauses.push(`(${RUN_SOURCE}) = ${bind(filter.source)}`);
    } else if (filter.kind === 'work') {
      table = 'pa24.work_item r';
      fields = 'r.id, r.title, r.origin as source, r.status, r.progress, substr(r.result, 1, 300) as summary, r.created_at, r.updated_at, r.active_skill_run_id, r.role';
      search = ['r.id', 'r.title', 'r.instruction', 'r.progress', 'r.result'];
      unresolved = "r.status in ('waiting_input', 'needs_reconciliation', 'failed')";
      if (filter.source) clauses.push(`r.origin = ${bind(filter.source)}`);
      if (filter.workId) clauses.push(`r.id = ${bind(filter.workId)}`);
      if (filter.planId) clauses.push(`exists (select 1 from pa24.skill_run linked where linked.work_item_id = r.id and linked.plan_id = ${bind(filter.planId)})`);
      if (filter.skillId) clauses.push(`exists (select 1 from pa24.skill_run linked where linked.work_item_id = r.id and linked.skill_id = ${bind(filter.skillId)})`);
    } else if (filter.kind === 'events') {
      table = 'pa24.plan_trigger r left join pa24.digest_plan p on p.id = r.plan_id';
      fields = 'r.id, p.title, r.plan_id, r.run_id, r.source, r.status, r.reason as summary, r.created_at, r.updated_at, r.occurrence';
      search = ['r.id', 'p.title', 'r.reason']; unresolved = EVENT_UNRESOLVED;
      clauses.push("r.status in ('skipped', 'rejected', 'expired')");
      if (filter.planId) clauses.push(`r.plan_id = ${bind(filter.planId)}`);
      if (filter.skillId) clauses.push(`r.snapshot->'configuration'->>'skillId' = ${bind(filter.skillId.startsWith('builtin:') || filter.skillId.startsWith('project-dsh:') ? filter.skillId : `managed:${filter.skillId}`)}`);
      if (filter.source) clauses.push(`r.source = ${bind(filter.source)}`);
    } else {
      table = 'pa24.digest_occurrence r left join pa24.digest_plan p on p.id = r.plan_id';
      fields = 'r.id, p.title, r.plan_id, r.window_key, r.status, r.error as progress, r.report, r.outbox_key, r.created_at, r.updated_at';
      search = ['r.id', 'p.title', 'r.error']; unresolved = "r.status not in ('model_done', 'sent')";
      if (filter.planId) clauses.push(`r.plan_id = ${bind(filter.planId)}`);
    }
    if (filter.status) clauses.push(`r.status = ${bind(filter.status)}`);
    if (filter.query?.trim()) {
      const query = bind(`%${filter.query.trim().toLowerCase().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
      clauses.push(`(${search.map(column => `lower(coalesce(${column}, '')) like ${query} escape '\\'`).join(' or ')})`);
    }
    const dates = [filter.from ? `r.created_at >= ${bind(filter.from)}` : '', filter.to ? `r.created_at <= ${bind(filter.to)}` : ''].filter(Boolean);
    if (dates.length) clauses.push(`((${dates.join(' and ')})${filter.includeUnresolved ? ` or ${unresolved}` : ''})`);
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const total = Number((await this.db.query<{ count: string }>(`select count(*) as count from ${table} ${where}`, values)).rows[0]!.count);
    // Only an empty match needs a separate inventory check. Filters can hide
    // records, so zero matches alone cannot establish an empty ledger.
    const empty = total ? false : !(await this.db.query(`select r.id from ${table}
      ${filter.kind === 'runs' ? `where ${EXECUTION_RECORD}` : filter.kind === 'events' ? "where r.status in ('skipped', 'rejected', 'expired')" : ''} limit 1`)).rowCount;
    const rows = (await this.db.query<Record<string, unknown>>(`select ${fields} from ${table} ${where}
      order by r.created_at desc, r.id limit ${bind(filter.limit)} offset ${bind(filter.offset)}`, values)).rows;
    return { kind: filter.kind, rows, total, empty, offset: filter.offset, limit: filter.limit };
  }
  async summary(now = new Date()) {
    const since = new Date(now.getTime() - 86400000);
    const counts = async (sql: string) => Object.fromEntries(Object.entries((await this.db.query<Record<string, number | string | null>>(sql, [since])).rows[0]!).map(([key, value]) => [key, Number(value ?? 0)]));
    const runs = await counts(`select sum(case when r.created_at >= $1 then 1 else 0 end) as runs24,
      sum(case when r.created_at >= $1 and r.status in ('failed', 'timed_out') then 1 else 0 end) as failed24,
      sum(case when r.created_at >= $1 and ${DELIVERY_FAILURE} then 1 else 0 end) as delivery_failed24,
      sum(case when ${RUN_UNRESOLVED} then 1 else 0 end) as unresolved from pa24.skill_run r where ${EXECUTION_RECORD}`);
    const work = await counts(`select sum(case when r.status in ('accepted', 'queued', 'running') then 1 else 0 end) as active_work,
      sum(case when r.status in ('waiting_input', 'needs_reconciliation') then 1 else 0 end) as waiting_work,
      sum(case when r.status = 'failed' then 1 else 0 end) as failed_work,
      sum(case when r.created_at >= $1 then 1 else 0 end) as work24 from pa24.work_item r`);
    const events = await counts(`select sum(case when r.created_at >= $1 then 1 else 0 end) as unexecuted24,
      sum(case when ${EVENT_UNRESOLVED} then 1 else 0 end) as unresolved_events
      from pa24.plan_trigger r where r.status in ('skipped', 'rejected', 'expired')`);
    return { ...runs, ...work, ...events, from: since.toISOString(), observedAt: now.toISOString() };
  }
}
