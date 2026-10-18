// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

export interface BindingRow {
  app_id: string;
  tenant_key: string;
  owner_open_id: string;
  lark_profile: string;
  status: string;
  chat_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class BindingRepo {
  constructor(private readonly db: PaDb) {}

  async upsert(row: { appId: string; tenantKey: string; ownerOpenId: string; larkProfile: string; chatId?: string }): Promise<BindingRow> {
    const result = await this.db.query<BindingRow>(
      `insert into pa24.binding (app_id, tenant_key, owner_open_id, lark_profile, status, chat_id)
       values ($1, $2, $3, $4, 'active', $5)
       on conflict (app_id, tenant_key, owner_open_id) do update
         set lark_profile = excluded.lark_profile, updated_at = now()
       returning *`,
      [row.appId, row.tenantKey, row.ownerOpenId, row.larkProfile, row.chatId ?? null],
    );
    return result.rows[0]!;
  }

  async get(appId: string, tenantKey: string, ownerOpenId: string): Promise<BindingRow | null> {
    const result = await this.db.query<BindingRow>(
      'select * from pa24.binding where app_id = $1 and tenant_key = $2 and owner_open_id = $3',
      [appId, tenantKey, ownerOpenId],
    );
    return result.rows[0] ?? null;
  }

  /** Tenants already bound for this app+owner; used to refuse a foreign tenant. Placeholder rows written before any real tenant key are ignored. */
  async tenantsFor(appId: string, ownerOpenId: string): Promise<string[]> {
    const result = await this.db.query<{ tenant_key: string }>(
      `select distinct tenant_key from pa24.binding
       where app_id = $1 and owner_open_id = $2 and tenant_key <> 'unknown'`,
      [appId, ownerOpenId],
    );
    return result.rows.map(r => r.tenant_key);
  }
}

export interface WorkspaceStateRow {
  path: string;
  feishu_session_id: string | null;
  local_session_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class WorkspaceStateRepo {
  constructor(private readonly db: PaDb) {}

  async save(path: string, sessions: { feishuSessionId?: string; localSessionId?: string }): Promise<WorkspaceStateRow> {
    const result = await this.db.query<WorkspaceStateRow>(
      `insert into pa24.workspace_state (path, feishu_session_id, local_session_id) values ($1, $2, $3)
       on conflict (path) do update set
         feishu_session_id = coalesce(excluded.feishu_session_id, pa24.workspace_state.feishu_session_id),
         local_session_id = coalesce(excluded.local_session_id, pa24.workspace_state.local_session_id),
         updated_at = now()
       returning *`,
      [path, sessions.feishuSessionId ?? null, sessions.localSessionId ?? null],
    );
    return result.rows[0]!;
  }

  async get(path: string): Promise<WorkspaceStateRow | null> {
    const result = await this.db.query<WorkspaceStateRow>('select * from pa24.workspace_state where path = $1', [path]);
    return result.rows[0] ?? null;
  }

  /** Most recently touched workspace path, for host restart rebinding (F28). */
  async latestPath(): Promise<string | null> {
    const result = await this.db.query<{ path: string }>('select path from pa24.workspace_state order by updated_at desc limit 1');
    return result.rows[0]?.path ?? null;
  }
}
