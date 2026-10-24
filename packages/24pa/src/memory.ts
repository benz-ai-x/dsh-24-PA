import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DshContext, FsTarget, FsWriteIntent } from './host.js';

// The single editable memory authority is the workspace JSON file. Writes go
// through the host fs service with a version guard; every mutation appends an
// audit line and, for batch maintenance, a reversible changeset. There is no
// scheduled or background reorganization.

import { emptyMemory, MemoryError, parseMemoryFile, memoryHash, canonical, queryMemory, memoryViews, normalizeChanges, stageMemoryChanges } from './memory-model.js';
import type { MemoryRecord, MemoryFile, MemoryChange, AppliedChangeset, MemoryFilter } from './memory-model.js';
export * from './memory-model.js';

interface MemoryCommit { revision: number; audit: 'recorded' | 'pending'; warning?: string }

export class MemoryStore {
  private readonly dir: string;
  private readonly ctx: DshContext;
  private serial: Promise<unknown> = Promise.resolve();
  private targets: { file: FsTarget; log: string; changesets: string } | null = null;

  constructor(workspacePath: string, ctx: DshContext) {
    this.dir = join(workspacePath, '.24pa');
    this.ctx = ctx;
  }

  private async ensureTargets() {
    if (this.targets) return this.targets;
    await mkdir(this.dir, { recursive: true });
    await mkdir(join(this.dir, 'changesets'), { recursive: true });
    this.targets = {
      file: await this.ctx.fs.resolve(join(this.dir, 'memory.json')),
      log: join(this.dir, 'memory-log.jsonl'),
      changesets: join(this.dir, 'changesets'),
    };
    return this.targets;
  }

  private async read(): Promise<{ file: MemoryFile; version: unknown; existed: boolean }> {
    const targets = await this.ensureTargets();
    const info = await this.ctx.fs.stat(targets.file);
    if (!info) return { file: emptyMemory(), version: null, existed: false };
    const file = parseMemoryFile(await this.ctx.fs.readText(targets.file));
    return { file, version: info.version ?? null, existed: true };
  }

  private async write(next: MemoryFile, expectedVersion: unknown, existed: boolean): Promise<unknown> {
    const targets = await this.ensureTargets();
    const intent: FsWriteIntent = existed ? { kind: 'replaceIfVersion', version: expectedVersion } : { kind: 'createIfAbsent' };
    const outcome = await this.ctx.fs.writeText(
      targets.file,
      JSON.stringify(next, null, 2) + '\n',
      intent,
      undefined,
      { mode: 'workspace-write', workspaceRoot: this.dir },
    );
    return outcome;
  }

  private async appendAudit(line: Record<string, unknown>): Promise<void> {
    const targets = await this.ensureTargets();
    const existing = await readFile(targets.log, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (existing.split('\n').some(raw => { try { return JSON.parse(raw).mutationId === line.mutationId; } catch { return false; } })) return;
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    await writeFile(targets.log, separator + JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n', { encoding: 'utf8', flag: 'a', mode: 0o600 });
  }

  private get pendingAuditPath(): string { return join(this.dir, 'memory-audit-pending.json'); }

  private async prepareAudit(intent: Record<string, unknown>): Promise<void> {
    const temp = `${this.pendingAuditPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(intent) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temp, this.pendingAuditPath);
    } finally { await rm(temp, { force: true }); }
  }

  /** Repair derived audit only when the authority proves the outcome; never
   * replay a prepared memory mutation after a crash. */
  private async recoverAudit(file: MemoryFile): Promise<void> {
    let intent: { beforeHash: string; afterHash: string; audit: Record<string, unknown> };
    try { intent = JSON.parse(await readFile(this.pendingAuditPath, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const current = memoryHash(file);
    if (current === intent.afterHash) await this.appendAudit(intent.audit);
    else if (current !== intent.beforeHash) throw new MemoryError('记忆存在未确认的提交记录；请核对 memory.json 与 memory-audit-pending.json 后再修改，不能自动覆盖。');
    await rm(this.pendingAuditPath);
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work);
    this.serial = result.catch(() => {});
    return result;
  }

  async search(filter: MemoryFilter) {
    return this.enqueue(async () => {
      const { file } = await this.read();
      let auditWarning: string | undefined;
      try { await this.recoverAudit(file); await this.clearPurgedHistory(file); }
      catch (error) { auditWarning = `记忆读取成功；审计待核对或删除清理待完成：${(error as Error).message}`; }
      const tracked = await this.trackedRevision(file);
      return { ...queryMemory(file, filter), fingerprint: memoryHash(file), trackedRevision: tracked, ...(auditWarning ? { auditWarning } : {}) };
    });
  }

  /** Strict integrity read for isolated recovery. Ordinary browsing may keep
   * valid records visible despite damaged derived files; a backup check cannot. */
  async verifyIntegrity() {
    return this.enqueue(async () => {
      const { file } = await this.read();
      const targets = await this.ensureTargets();
      let changesets = 0, auditEntries = 0;
      const object = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
      for (const name of (await readdir(targets.changesets)).filter(name => name.endsWith('.json'))) {
        try {
          const cs = JSON.parse(await readFile(join(targets.changesets, name), 'utf8')) as AppliedChangeset;
          if (!object(cs) || typeof cs.id !== 'string' || !Array.isArray(cs.changes)
            || !object(cs.before) || !object(cs.after) || !Number.isInteger(cs.resultingRevision)
            || cs.changes.some(change => !object(change) || typeof change.op !== 'string')) throw new Error('invalid changeset');
          changesets++;
        } catch { throw new MemoryError(`记忆修订文件 ${name} 损坏或结构不完整。`); }
      }
      const raw = await readFile(targets.log, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      for (const [index, line] of raw.split('\n').entries()) {
        if (!line.trim()) continue;
        try { if (!object(JSON.parse(line))) throw new Error('invalid audit'); }
        catch { throw new MemoryError(`记忆审计第 ${index + 1} 行损坏或结构不完整。`); }
        auditEntries++;
      }
      const tracked = await this.trackedRevision(file);
      if (tracked === 'changed') throw new MemoryError('记忆 JSON 与已记录修订不一致；请核对手工变化。');
      if (file.lastMutationId && tracked === 'untracked') throw new MemoryError('记忆最近修订的凭证缺失，不能确认完整性。');
      return { revision: file.revision, changesets, auditEntries, trackedRevision: tracked };
    });
  }

  private async trackedRevision(file: MemoryFile): Promise<'tracked' | 'changed' | 'untracked'> {
    if (!file.lastMutationId) return 'untracked';
    const targets = await this.ensureTargets();
    for (const name of await readdir(targets.changesets)) {
      if (!name.endsWith('.json')) continue;
      try {
        const cs = JSON.parse(await readFile(join(targets.changesets, name), 'utf8')) as AppliedChangeset;
        if (cs.mutationId === file.lastMutationId) return cs.resultingHash === memoryHash(file) ? 'tracked' : 'changed';
      } catch { /* Read errors remain visible in the history/cleanup boundary. */ }
    }
    return 'untracked';
  }

  private previewHash(file: MemoryFile, changes: MemoryChange[], actor: string): string {
    return createHash('sha256').update(canonical({ file, changes, actor })).digest('hex');
  }

  async previewChangeset(changes: MemoryChange[], options: { expectedRevision: number; actor: string }) {
    return this.enqueue(async () => {
      const { file } = await this.read();
      if (file.revision !== options.expectedRevision) throw new MemoryError('记忆版本已变化，请重新查询后预览。');
      const normalized = normalizeChanges(changes);
      const { before, after, purgedIds } = stageMemoryChanges(file, normalized, options.actor, 'preview', new Date().toISOString());
      return { revision: file.revision, changes: normalized, before, after, purgedIds, previewToken: this.previewHash(file, normalized, options.actor) };
    });
  }

  /** Tombstones in the authority make cleanup restartable. These files are
   * derived audit/undo material, never an alternative memory authority. */
  private async clearPurgedHistory(file: MemoryFile): Promise<void> {
    const ids = new Set((file.tombstones ?? []).map(row => row.id));
    if (!ids.size) return;
    const targets = await this.ensureTargets();
    for (const name of await readdir(targets.changesets)) {
      if (!name.endsWith('.json')) continue;
      const path = join(targets.changesets, name);
      let cs: AppliedChangeset;
      try { cs = JSON.parse(await readFile(path, 'utf8')); }
      catch { throw new MemoryError(`修订文件 ${name} 无法核对；永久删除已生效，历史正文清理尚未完成。`); }
      const touched = new Set([...Object.keys(cs.before ?? {}), ...Object.keys(cs.after ?? {}), ...(cs.changes ?? []).map(row => row.id ?? row.record?.id ?? '')].filter(id => ids.has(id)));
      if (!touched.size) continue;
      const cleaned: AppliedChangeset = { ...cs, reason: '相关条目已永久删除，修订理由已清除。', before: { ...cs.before }, after: { ...cs.after }, purgedIds: [...new Set([...cs.purgedIds ?? [], ...touched])] };
      for (const id of touched) { cleaned.before[id] = null; cleaned.after[id] = null; }
      cleaned.changes = cs.changes.map(change => touched.has(change.id ?? change.record?.id ?? '') ? { op: 'purge', id: change.id ?? change.record!.id, reason: '已永久删除' } : change);
      if (canonical(cleaned) !== canonical(cs)) await this.replaceDerived(path, JSON.stringify(cleaned, null, 2) + '\n');
    }
    const raw = await readFile(targets.log, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    const cleaned = raw.split('\n').filter(Boolean).map(line => {
      let event: Record<string, unknown> & { changes?: { id?: string; op?: string; reason?: string }[] };
      try { event = JSON.parse(line); } catch { throw new MemoryError('修订审计包含损坏记录，不能确认历史正文已清理。'); }
      if (!Array.isArray(event.changes) || !event.changes.some(change => ids.has(change.id ?? ''))) return line;
      return JSON.stringify({ mutationId: event.mutationId, revision: event.revision, actor: event.actor, changesetId: event.changesetId, at: event.at, changes: event.changes.map(change => ids.has(change.id ?? '') ? { id: change.id, op: 'purge', reason: '已永久删除' } : change) });
    }).join('\n') + (raw ? '\n' : '');
    if (cleaned !== raw) await this.replaceDerived(targets.log, cleaned);
  }

  private async replaceDerived(path: string, content: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }

  private async applyChanges(changes: MemoryChange[], actor: string, expectedRevision: number, changesetReason?: string, guard?: (file: MemoryFile) => void | Promise<void>, previewToken?: string): Promise<MemoryCommit & { changeset?: AppliedChangeset }> {
    return this.enqueue(async () => {
      const { file, version, existed } = await this.read();
      if (file.revision !== expectedRevision) {
        throw new MemoryError(`记忆已变化（当前 revision ${file.revision}，提交 ${expectedRevision}）；请重新查询后提交。`);
      }
      await this.recoverAudit(file);
      await guard?.(file);
      await this.clearPurgedHistory(file);
      const normalized = normalizeChanges(changes);
      if (previewToken && previewToken !== this.previewHash(file, normalized, actor)) throw new MemoryError('变更预览已过期或内容/会话已变化，请重新预览并确认。');
      const { next, before, after, purgedIds } = stageMemoryChanges(file, normalized, actor, randomUUID(), new Date().toISOString());
      let changeset: AppliedChangeset | undefined;
      {
        changeset = {
          formatVersion: 2,
          mutationId: next.lastMutationId,
          resultingHash: memoryHash(next),
          id: changesetReason ? `CS-${next.revision}` : `MR-${next.revision}-${next.lastMutationId}`,
          reason: purgedIds.length ? '永久删除已回收记忆' : changesetReason ?? normalized[0]!.reason,
          appliedAt: new Date().toISOString(),
          appliedBy: actor,
          baseRevision: file.revision,
          resultingRevision: next.revision,
          changes: normalized.map(change => purgedIds.includes(change.id ?? change.record?.id ?? '') ? { op: 'purge', id: change.id ?? change.record!.id, reason: '已永久删除' } : change),
          before,
          after,
          ...(purgedIds.length ? { purgedIds } : {}),
        };
      }
      // Persist the changeset BEFORE the memory file: an applied revision is
      // then always undoable; an orphan changeset (later write failed) is
      // harmlessly refused by the undo guard instead of the reverse.
      if (changeset) {
        const targets = await this.ensureTargets();
        await writeFile(join(targets.changesets, `${changeset.id}.json`), JSON.stringify(changeset, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      }
      const audit = { mutationId: next.lastMutationId, revision: next.revision, actor, changesetId: changeset?.id ?? null, changes: normalized.map(c => ({ op: c.op, id: c.id ?? c.record?.id, reason: purgedIds.includes(c.id ?? c.record?.id ?? '') ? '已永久删除' : c.reason })) };
      await this.prepareAudit({ beforeHash: memoryHash(file), afterHash: memoryHash(next), audit });
      try { await this.write(next, version, existed); }
      catch (error) {
        // A host exception is not proof that the authority stayed unchanged.
        const observed = await this.read().catch(() => null);
        if (observed && memoryHash(observed.file) === memoryHash(file)) {
          await rm(this.pendingAuditPath, { force: true });
          throw error;
        }
        if (!observed || memoryHash(observed.file) !== memoryHash(next)) throw new MemoryError(`记忆提交结果待核对，不能自动重试：${(error as Error).message}`);
      }
      try {
        await this.recoverAudit(next);
        await this.clearPurgedHistory(next);
        return { revision: next.revision, changeset, audit: 'recorded' };
      } catch (error) {
        return { revision: next.revision, changeset, audit: 'pending', warning: `记忆已提交；审计或永久删除清理待完成，勿重复修改：${(error as Error).message}` };
      }
    });
  }

  async put(
    record: Omit<MemoryRecord, 'updatedAt' | 'updatedBy' | 'id'> & { id?: string },
    options: { expectedRevision: number; actor: string; reason: string },
  ): Promise<MemoryCommit> {
    const { changeset: _, ...commit } = await this.applyChanges([{ op: 'put', record, reason: options.reason }], options.actor, options.expectedRevision);
    return commit;
  }

  async remove(id: string, options: { expectedRevision: number; actor: string; reason: string }): Promise<MemoryCommit> {
    const { changeset: _, ...commit } = await this.applyChanges([{ op: 'delete', id, reason: options.reason }], options.actor, options.expectedRevision);
    return commit;
  }

  async transition(id: string, op: 'activate' | 'deactivate' | 'restore' | 'purge', options: { expectedRevision: number; actor: string; reason: string }): Promise<MemoryCommit> {
    const { changeset: _, ...commit } = await this.applyChanges([{ op, id, reason: options.reason }], options.actor, options.expectedRevision);
    return commit;
  }

  async history(id: string) {
    return this.enqueue(async () => {
      const targets = await this.ensureTargets();
      const { file } = await this.read();
      await this.recoverAudit(file); await this.clearPurgedHistory(file);
      const permanent = file.tombstones?.some(row => row.id === id);
      const revisions = [];
      for (const name of (await readdir(targets.changesets)).filter(name => name.endsWith('.json'))) {
        const cs = JSON.parse(await readFile(join(targets.changesets, name), 'utf8')) as AppliedChangeset;
        if (!cs.changes.some(change => (change.id ?? change.record?.id) === id)) continue;
        revisions.push({ id: cs.id, resultingRevision: cs.resultingRevision, appliedAt: cs.appliedAt, appliedBy: cs.appliedBy, reason: cs.reason, before: permanent ? null : cs.before[id], after: permanent ? null : cs.after[id], undoable: !cs.purgedIds?.length && await this.hasCommitProof(cs, file) });
      }
      return { revision: file.revision, id, permanent: Boolean(permanent), revisions: revisions.sort((a, b) => b.resultingRevision - a.resultingRevision) };
    });
  }

  /** Read-only maintenance analysis: duplicates, conflicts, expired candidates. */
  async inspect(scope?: { topic?: string }): Promise<{
    revision: number;
    duplicates: { topic: string; ids: string[] }[];
    conflicts: { topic: string; ids: string[] }[];
    expired: { id: string; topic: string; validUntil: string }[];
    kept: { id: string; topic: string }[];
  }> {
    return this.enqueue(async () => {
      const { file } = await this.read();
      const scoped = (scope?.topic ? file.records.filter(r => r.topic === scope.topic) : file.records).filter(r => r.lifecycle !== 'recycled');
      const byTopic = new Map<string, MemoryRecord[]>();
      for (const record of scoped) {
        const key = `${record.topic}\n${canonical(record.scope ?? { kind: 'personal' })}`;
        const list = byTopic.get(key) ?? []; list.push(record); byTopic.set(key, list);
      }
      const duplicates: { topic: string; ids: string[] }[] = [];
      const conflicts: { topic: string; ids: string[] }[] = [];
      for (const records of byTopic.values()) {
        const topic = records[0]!.topic;
        const sameContent = new Map<string, string[]>();
        for (const record of records) {
          const key = `${record.category}\n${record.content}`;
          sameContent.set(key, [...(sameContent.get(key) ?? []), record.id]);
        }
        const dupIds = [...sameContent.values()].filter(ids => ids.length > 1).flat();
        if (dupIds.length > 0) duplicates.push({ topic, ids: dupIds });
        const conflictRecords = memoryViews({ ...file, records }).filter(record => ['unresolved', 'candidate'].includes(record.effective.conflict));
        if (conflictRecords.length) conflicts.push({ topic, ids: conflictRecords.map(record => record.id) });
      }
      const now = Date.now();
      const expired = scoped
        .filter(r => r.validUntil && Date.parse(r.validUntil) < now)
        .map(r => ({ id: r.id, topic: r.topic, validUntil: r.validUntil! }));
      const flagged = new Set([...duplicates.flatMap(d => d.ids), ...conflicts.flatMap(c => c.ids), ...expired.map(e => e.id)]);
      const kept = scoped.filter(r => !flagged.has(r.id)).map(r => ({ id: r.id, topic: r.topic }));
      return { revision: file.revision, duplicates, conflicts, expired, kept };
    });
  }

  async applyChangeset(changes: MemoryChange[], options: { expectedRevision: number; actor: string; reason: string; previewToken?: string }): Promise<MemoryCommit & { changesetId: string }> {
    if (!options.reason?.trim()) throw new MemoryError('变更集需说明本人整理指令依据。');
    const { changeset, ...commit } = await this.applyChanges(changes, options.actor, options.expectedRevision, options.reason, undefined, options.previewToken);
    return { ...commit, changesetId: changeset!.id };
  }

  private async hasCommitProof(cs: AppliedChangeset, file: MemoryFile): Promise<boolean> {
    if (cs.mutationId && file.lastMutationId === cs.mutationId) return true;
    const { log } = await this.ensureTargets();
    const raw = await readFile(log, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    return raw.split('\n').some(line => {
      try {
        const event = JSON.parse(line);
        return event.changesetId === cs.id && (cs.mutationId ? event.mutationId === cs.mutationId : event.revision === cs.resultingRevision);
      } catch { return false; }
    });
  }

  async listChangesets(): Promise<{ id: string; reason: string; appliedAt: string; appliedBy: string; changes: number; state: 'applied' | 'not_applied' | 'uncertain' }[]> {
    return this.enqueue(async () => {
      const targets = await this.ensureTargets();
      const { file } = await this.read();
      await this.recoverAudit(file).catch(() => {});
      const names = await readdir(targets.changesets);
      const result = [];
      for (const name of names.filter(n => n.endsWith('.json')).sort()) {
        try {
          const cs = JSON.parse(await readFile(join(targets.changesets, name), 'utf8')) as AppliedChangeset;
          const anotherCommit = cs.mutationId && file.lastMutationId && cs.mutationId !== file.lastMutationId && file.revision === cs.resultingRevision;
          const state = await this.hasCommitProof(cs, file).catch(() => false) ? 'applied' : file.revision < cs.resultingRevision || anotherCommit ? 'not_applied' : 'uncertain';
          result.push({ id: cs.id, reason: cs.reason, appliedAt: cs.appliedAt, appliedBy: cs.appliedBy, changes: cs.changes.length, state } as const);
        } catch { /* A malformed changeset must not hide the remaining files. */ }
      }
      return result;
    });
  }

  async undo(changesetId: string, options: { expectedRevision: number; actor: string; reason: string }): Promise<MemoryCommit> {
    const targets = await this.ensureTargets();
    if (!/^(?:CS-\d+|MR-\d+-[a-f0-9-]+)$/.test(changesetId)) throw new MemoryError(`变更集编号无效：${changesetId}`);
    let changeset: AppliedChangeset;
    try {
      changeset = JSON.parse(await readFile(join(targets.changesets, `${changesetId}.json`), 'utf8')) as AppliedChangeset;
    } catch {
      throw new MemoryError(`变更集不存在或不可读：${changesetId}`);
    }
    if (changeset.purgedIds?.length) throw new MemoryError('该修订包含已永久删除的记忆，不能撤销恢复正文。');
    const touched = changeset.changes.map(change => change.id ?? change.record?.id ?? '');
    if (touched.some(id => !id) || (changeset.formatVersion !== 2 && new Set(touched).size !== touched.length)) {
      throw new MemoryError('历史变更集缺少实际 ID 或批前快照，不能安全自动撤销；请根据原始证据人工整理。');
    }
    const ids = [...new Set(touched)];
    if (ids.some(id => !Object.hasOwn(changeset.before, id) || !Object.hasOwn(changeset.after, id))) throw new MemoryError('变更集缺少完整撤销快照。');
    const inverse: MemoryChange[] = [];
    for (const id of ids) {
      const before = changeset.before[id];
      if (before) {
        if (changeset.after[id]?.lifecycle === 'recycled' && before.lifecycle !== 'recycled') inverse.push({ op: 'restore', id, reason: options.reason });
        inverse.push({ op: 'put', record: { ...before, lifecycle: before.lifecycle ?? 'active' }, reason: `撤销 ${changesetId}：${options.reason}` });
      }
      else if (changeset.after[id] !== null) inverse.push({ op: 'delete', id, reason: `撤销 ${changesetId}：${options.reason}` });
    }
    const { changeset: _, ...commit } = await this.applyChanges(inverse, options.actor, options.expectedRevision, `撤销 ${changesetId}`, async file => {
      if (file.revision < changeset.resultingRevision || !await this.hasCommitProof(changeset, file)) throw new MemoryError('该变更集尚未提交或缺少确切提交证明，不能撤销。');
      for (const id of ids) {
        const current = file.records.find(r => r.id === id) ?? null;
        const expected = changeset.after[id];
        // Include metadata and unknown future fields, independent of key order.
        const same = current === null || expected === null ? current === expected : canonical(current) === canonical(expected);
        if (!same) throw new MemoryError(`条目 ${id} 在变更集之后又被修改；撤销不会覆盖较新内容，请先整理当前状态。`);
      }
    });
    return commit;
  }
}
