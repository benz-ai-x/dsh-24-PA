import { randomUUID } from 'node:crypto';
import type { PaDb } from '../db.js';

export type BackupOperation = 'create' | 'verify' | 'restore_check';
export interface BackupRecord {
  id: string; request_id: string; request_hash: string; workspace_id: string;
  operation: BackupOperation; status: 'running' | 'succeeded' | 'partial' | 'failed' | 'interrupted';
  actor_session_id: string; backup_dir: string | null; target_dir: string | null;
  manifest_hash: string | null; result: Record<string, any> | null; error: string | null;
  started_at: Date; finished_at: Date | null;
}

/** Creation, verification and isolated drills are independent durable facts. */
export class BackupRepo {
  constructor(private readonly db: PaDb) {}
  async begin(input: { requestId: string; requestHash: string; workspaceId: string; operation: BackupOperation; actor: string; backupDir?: string; targetDir?: string }) {
    const row = (await this.db.query<BackupRecord>(`insert into pa24.backup_record
      (id, request_id, request_hash, workspace_id, operation, status, actor_session_id, backup_dir, target_dir)
      values ($1,$2,$3,$4,$5,'running',$6,$7,$8) on conflict (request_id) do nothing returning *`,
      [randomUUID(), input.requestId, input.requestHash, input.workspaceId, input.operation, input.actor, input.backupDir ?? null, input.targetDir ?? null])).rows[0];
    if (row) return { row, admitted: true };
    const prior = (await this.db.query<BackupRecord>('select * from pa24.backup_record where request_id=$1', [input.requestId])).rows[0];
    if (!prior || prior.request_hash !== input.requestHash || prior.workspace_id !== input.workspaceId) throw new Error('备份请求标识已用于其他内容；请查阅原记录。');
    return { row: prior, admitted: false };
  }
  async finish(id: string, status: BackupRecord['status'], result: Record<string, any>, error?: string) {
    return (await this.db.query<BackupRecord>(`update pa24.backup_record set status=$2, result=$3, error=$4,
      backup_dir=coalesce($5,backup_dir), target_dir=coalesce($6,target_dir), manifest_hash=$7, finished_at=now()
      where id=$1 and status='running' returning *`, [id, status, JSON.stringify(result), error ?? null,
      result.backupDir ?? null, result.targetDir ?? null, result.manifestHash ?? null])).rows[0];
  }
  async interrupted() {
    await this.db.query(`update pa24.backup_record set status='interrupted', finished_at=now(),
      error='上次进程结束前未保存完成凭据；产物状态需重新校验，不能推断成功或自动重做。' where status='running'`);
  }
  async get(id: string, workspaceId: string) {
    return (await this.db.query<BackupRecord>('select * from pa24.backup_record where id=$1 and workspace_id=$2', [id, workspaceId])).rows[0] ?? null;
  }
  async list(workspaceId: string, operation: string, offset: number, limit: number) {
    const values: unknown[] = [workspaceId];
    let where = 'workspace_id=$1';
    if (operation !== 'all') { values.push(operation); where += ' and operation=$2'; }
    const total = Number((await this.db.query<{ n: string }>(`select count(*) as n from pa24.backup_record where ${where}`, values)).rows[0]!.n);
    const rows = (await this.db.query<BackupRecord>(`select * from pa24.backup_record where ${where} order by started_at desc,id desc limit $${values.length + 1} offset $${values.length + 2}`, [...values, limit, offset])).rows;
    return { total, rows, offset, limit };
  }
}
