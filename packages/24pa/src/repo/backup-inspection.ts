import type { PaQueryer } from '../db.js';

const CONTENT_TABLES = [
  'ledger_owner', 'schema_migrations', 'workspace_state', 'work_item', 'task', 'calendar_event',
  'note', 'note_page', 'note_version', 'review_decision', 'note_material', 'note_action_link', 'material_read_evidence',
  'skill_entry', 'skill_version', 'skill_run', 'skill_run_session', 'skill_run_input', 'skill_run_call', 'skill_run_control', 'skill_run_resume',
  'worker_run', 'worker_run_input', 'worker_run_call', 'work_change', 'run_diagnostic',
  'digest_plan', 'plan_trigger', 'task_plan_block', 'task_plan_run_outcome', 'task_plan_notice', 'task_plan_delivery', 'task_plan_delivery_change', 'task_plan_migration',
  'action_operation', 'outbox',
] as const;

/** Queries only a restored isolated ledger; does not run migrations or claim it. */
export class BackupInspectionRepo {
  constructor(private readonly db: PaQueryer, private readonly kind: 'sqlite' | 'postgres') {}
  async read() {
    const tables = this.kind === 'sqlite'
      ? (await this.db.query<{ name: string }>("select name from sqlite_master where type='table' and name like 'pa24_%'")).rows.map(row => row.name.replace(/^pa24_/, ''))
      : (await this.db.query<{ name: string }>("select tablename as name from pg_tables where schemaname='pa24'")).rows.map(row => row.name);
    const records: Record<string, Record<string, any>[]> = {};
    const counts: Record<string, number> = {};
    for (const name of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('账本含不支持的表名。');
      counts[name] = Number((await this.db.query<{ n: string }>(`select count(*) as n from pa24.${name}`)).rows[0]!.n);
      if (!CONTENT_TABLES.includes(name as typeof CONTENT_TABLES[number])) continue;
      records[name] = (await this.db.query(`select * from pa24.${name}`)).rows;
    }
    // node:sqlite only infers types declared in this build's migrations. Older
    // backups and independently integrated tables still retain JSON evidence.
    for (const rows of Object.values(records)) for (const row of rows) for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'string' && ['snapshot', 'package_data', 'definition', 'content', 'params', 'receipt', 'result_ref', 'record', 'draft', 'recognition', 'source', 'parameters', 'authorization_record', 'task_config', 'task_authorization', 'destination'].includes(key)) {
        try { row[key] = JSON.parse(value); } catch { /* Domain validation reports malformed JSON below. */ }
      }
    }
    return { tables, counts, records };
  }
}
