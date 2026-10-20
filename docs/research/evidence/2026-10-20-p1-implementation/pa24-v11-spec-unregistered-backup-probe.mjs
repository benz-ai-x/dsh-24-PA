import { SqliteDb } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/sqlite.js';
import { WorkspaceBackup } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/backup.js';
import { workspaceLedgerIdentity } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/ledger-identity.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'pa24-v11-unregistered-backup-'));
const sources = Object.fromEntries(['workspace','stateDirectory','sessions','storages','attachments'].map(k => [k, join(root, k)]));
for (const path of Object.values(sources)) await mkdir(path);
await writeFile(join(sources.workspace, 'AGENTS.md'), '# workspace');
await workspaceLedgerIdentity(sources.workspace, 'owner');
const db = new SqliteDb(join(root, 'ledger.db'));
try {
  await db.migrate();
  const backup = await new WorkspaceBackup(sources, db).create(join(root, 'backups'), { credentialReferences: [], watermarks: [] });
  console.log(JSON.stringify({ node: process.version, schemaVersion: backup.schemaVersion, complete: backup.complete, failures: backup.failures }));
} finally { await db.close(); await rm(root, { recursive: true, force: true }); }
