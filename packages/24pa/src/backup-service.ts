import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaDb } from './db.js';
import type { BackupRepo, BackupOperation } from './repo/backup.js';
import { WorkspaceBackup } from './backup.js';
import { inspectRecovery, previewRestore } from './backup-restore.js';
import type { RestoreContext } from './backup-restore.js';
import { canonical } from './memory-model.js';
import { sha256Hex } from './handwriting.js';

export interface BackupContext extends RestoreContext {
  db: PaDb; repo: BackupRepo;
  sources: { workspace: string; stateDirectory: string; sessions?: string; storages?: string; attachments?: string };
  credentialReferences: string[];
  watermarks(): Promise<unknown>;
}

const jsonResult = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export class BackupService {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private readonly context: () => BackupContext) {}
  private current(binding: unknown) {
    const ctx = this.context();
    if (binding !== ctx.binding) throw new Error('工作区已切换，请刷新后重新操作。');
    return ctx;
  }
  async list(input: Record<string, unknown>) {
    const ctx = this.current(input.workspaceBinding);
    const operation = typeof input.operation === 'string' ? input.operation : 'all';
    if (!['all', 'create', 'verify', 'restore_check'].includes(operation)) throw new Error('备份记录类型无效。');
    const offset = Number(input.offset ?? 0), limit = Number(input.limit ?? 20);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('备份记录分页参数无效。');
    return jsonResult({ ...await ctx.repo.list(ctx.workspaceId, operation, offset, limit), workspaceBinding: ctx.binding });
  }
  async detail(input: Record<string, unknown>) {
    const ctx = this.current(input.workspaceBinding);
    const record = await ctx.repo.get(String(input.id ?? ''), ctx.workspaceId);
    if (!record) throw new Error('备份记录不存在或不属于当前工作区。');
    return jsonResult({ record, workspaceBinding: ctx.binding });
  }
  async preview(input: Record<string, unknown>) { return previewRestore(this.current(input.workspaceBinding), String(input.backupDir ?? '')); }
  run(operation: BackupOperation, input: Record<string, unknown>, actor: string) {
    const work = async () => {
      const ctx = this.current(input.workspaceBinding);
      const requestId = String(input.requestId ?? '');
      if (!/^[A-Za-z0-9:_-]{8,160}$/.test(requestId)) throw new Error('备份操作需要稳定 requestId（8–160 字符）；重复请求返回原记录。');
      const backupDir = typeof input.backupDir === 'string' ? input.backupDir : undefined;
      const targetDir = typeof input.targetDir === 'string' ? input.targetDir : undefined;
      if (operation === 'restore_check' && input.confirm !== true) throw new Error('准备恢复副本需要明确 confirm=true；先通过 backup_preview 查看记忆保护与冲突。');
      const requestHash = sha256Hex(Buffer.from(canonical({ operation, backupDir, targetDir, previewToken: input.previewToken ?? null, confirm: input.confirm === true, actor })));
      const admission = await ctx.repo.begin({ requestId, requestHash, workspaceId: ctx.workspaceId, operation, actor, backupDir, targetDir });
      if (!admission.admitted) return { ...(admission.row.result ?? {}), record: admission.row, repeated: true,
        message: admission.row.result?.message ?? admission.row.error ?? '同一操作已接纳，尚无完成凭据；请查阅记录，不能自动重复执行。' };
      let temp: string | undefined;
      try {
        let result: Record<string, any>;
        if (operation === 'create') {
          const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
          result = await new WorkspaceBackup(ctx.sources, ctx.db).create(targetDir ?? '', { credentialReferences: ctx.credentialReferences, watermarks: await ctx.watermarks(), versions: { plugin: pkg.version, node: process.version } });
          result.created = true;
          result.productionReady = false;
          result.message += ' 这条记录只证明备份产物形成；实际账本、会话与恢复兼容性需另行校验。';
        } else {
          if (operation === 'verify') temp = await mkdtemp(join(tmpdir(), 'pa24-verify-'));
          result = await inspectRecovery(ctx, backupDir ?? '', operation === 'verify' ? join(temp!, 'copy') : targetDir ?? '', operation === 'restore_check', typeof input.previewToken === 'string' ? input.previewToken : undefined);
          if (operation === 'verify') { await rm(temp!, { recursive: true, force: true }); temp = undefined; delete result.targetDir; result.temporaryCopyRemoved = true; }
        }
        const status = result.complete ? 'succeeded' : 'partial';
        const record = await ctx.repo.finish(admission.row.id, status, result);
        return { ...result, record };
      } catch (error) {
        const message = (error as Error).message;
        const record = await ctx.repo.finish(admission.row.id, 'failed', { backupDir, targetDir, complete: false, productionReady: false, message }, message);
        return { record, complete: false, message };
      } finally { if (temp) await rm(temp, { recursive: true, force: true }); }
    };
    const result = this.serial.then(work).then(jsonResult);
    this.serial = result.catch(() => {});
    return result;
  }
}
