import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorkspaceLedgerIdentity } from './db.js';

/** The identity travels with a workspace backup or move; paths are not IDs. */
export async function workspaceLedgerIdentity(workspacePath: string, ownerOpenId: string): Promise<WorkspaceLedgerIdentity> {
  const directory = join(workspacePath, '.24pa');
  const path = join(directory, 'ledger-identity.json');
  let source: string;
  try { source = await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.ledger-identity-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, workspaceId: randomUUID() }) + '\n', { mode: 0o600, flag: 'wx' });
      try { await link(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { await rm(temporary, { force: true }); }
    source = await readFile(path, 'utf8');
  }
  return { workspaceId: parseWorkspaceIdentity(source), workspacePath, ownerOpenId };
}

/** Shared by admission and backup verification; never regenerates bad data. */
export function parseWorkspaceIdentity(source: string): string {
  let identity: { version?: unknown; workspaceId?: unknown };
  try { identity = JSON.parse(source); }
  catch { throw new Error('工作区账本身份文件损坏；请从同一工作区的备份恢复后重试。'); }
  if (identity?.version !== 1 || typeof identity.workspaceId !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(identity.workspaceId)) {
    throw new Error('工作区账本身份文件无效；请核对或从同一工作区的备份恢复。');
  }
  return identity.workspaceId;
}
