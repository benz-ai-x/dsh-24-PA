import type { PaQueryer, WorkspaceLedgerIdentity } from '../db.js';

const ownershipConflict = () => new Error('账本归属与当前工作区或主人不符；请核对连接与工作区身份，按初始化指南备份、核对和导出，不能直接接纳。');
const unprovenLegacy = () => new Error('历史账本归属无法唯一证明；请按初始化指南停机备份、核对和导出，不能自动认领。');

export async function readLedgerOwner(db: PaQueryer) {
  const owners = (await db.query<{ id: number; workspace_id: string; owner_open_id: string }>('select id, workspace_id, owner_open_id from pa24.ledger_owner')).rows;
  if (owners.length > 1 || (owners[0] && owners[0].id !== 1)) throw ownershipConflict();
  return owners[0] ?? null;
}

/** Runs under the adapter's admission transaction, before any migrations. */
export async function assertLedgerOwnership(db: PaQueryer, tables: readonly string[], identity: WorkspaceLedgerIdentity): Promise<void> {
  if (tables.includes('ledger_owner')) {
    const owner = await readLedgerOwner(db);
    if (owner) {
      if (owner.workspace_id !== identity.workspaceId || (owner.owner_open_id !== '' && owner.owner_open_id !== identity.ownerOpenId)) throw ownershipConflict();
      return;
    }
  }
  // Look only for existence, not business content. Schema bookkeeping and
  // SQLite's unused note counter do not make an otherwise blank ledger owned.
  let hasHistory = false;
  for (const table of tables) {
    if (table === 'schema_migrations' || table === 'ledger_owner') continue;
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw unprovenLegacy();
    const predicate = table === 'note_seq' ? ' where id <> 1 or next <> 1' : '';
    if ((await db.query(`select 1 as present from pa24.${table}${predicate} limit 1`)).rowCount) { hasHistory = true; break; }
  }
  if (!hasHistory) return;
  if (!identity.ownerOpenId || !tables.includes('workspace_state') || !tables.includes('binding')) throw unprovenLegacy();
  const paths = (await db.query<{ path: string }>('select path from pa24.workspace_state')).rows;
  const owners = (await db.query<{ owner_open_id: string }>('select distinct owner_open_id from pa24.binding')).rows;
  if (paths.length !== 1 || paths[0]!.path !== identity.workspacePath || owners.length !== 1 || owners[0]!.owner_open_id !== identity.ownerOpenId) throw unprovenLegacy();
}

/** The surrounding admission transaction serializes the check and claim. */
export async function claimLedgerOwnership(db: PaQueryer, identity: WorkspaceLedgerIdentity): Promise<void> {
  await db.query(
    `insert into pa24.ledger_owner (id, workspace_id, owner_open_id) values (1, $1, $2)
     on conflict (id) do update set owner_open_id = excluded.owner_open_id
     where pa24.ledger_owner.owner_open_id = ''`,
    [identity.workspaceId, identity.ownerOpenId],
  );
}
