import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DshContext, FsTarget, FsWriteIntent } from './host.js';

// The single editable memory authority is the workspace JSON file. Writes go
// through the host fs service with a version guard; every mutation appends an
// audit line and, for batch maintenance, a reversible changeset. There is no
// scheduled or background reorganization.

export interface MemoryRecord {
  id: string;
  category: 'preference' | 'fact' | 'project' | 'decision';
  topic: string;
  content: string;
  source: string;
  sourceVersion?: string;
  status: 'confirmed' | 'unverified';
  validUntil?: string | null;
  updatedAt: string;
  updatedBy: string;
  reason: string;
}

export interface MemoryFile {
  schemaVersion: 1;
  revision: number;
  records: MemoryRecord[];
}

export interface MemoryChange {
  op: 'put' | 'delete';
  id?: string;
  record?: Omit<MemoryRecord, 'updatedAt' | 'updatedBy' | 'id'> & { id?: string };
  reason: string;
}

export interface AppliedChangeset {
  id: string;
  reason: string;
  appliedAt: string;
  appliedBy: string;
  baseRevision: number;
  resultingRevision: number;
  changes: MemoryChange[];
  /** Snapshots for undo: record state before each change, keyed by record id. */
  before: Record<string, MemoryRecord | null>;
  after: Record<string, MemoryRecord | null>;
}

export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryError';
  }
}

const CATEGORIES = ['preference', 'fact', 'project', 'decision'] as const;
const STATUSES = ['confirmed', 'unverified'] as const;

export function emptyMemory(): MemoryFile {
  return { schemaVersion: 1, revision: 0, records: [] };
}

function validateRecord(record: MemoryRecord): void {
  if (!record || typeof record !== 'object') throw new MemoryError('记忆条目无效。');
  if (typeof record.id !== 'string' || !record.id) throw new MemoryError('记忆条目缺少 id。');
  if (!(CATEGORIES as readonly string[]).includes(record.category)) throw new MemoryError(`记忆类别无效：${record.category}`);
  if (typeof record.topic !== 'string') throw new MemoryError('记忆主题必须为字符串。');
  if (typeof record.content !== 'string' || !record.content.trim() || record.content.length > 12000) throw new MemoryError('记忆内容需为 1–12000 字。');
  if (typeof record.source !== 'string' || !record.source.trim()) throw new MemoryError('记忆需要可回查的来源。');
  if (!(STATUSES as readonly string[]).includes(record.status)) throw new MemoryError('记忆状态必须是 confirmed 或 unverified。');
  if (record.validUntil != null && (typeof record.validUntil !== 'string' || Number.isNaN(Date.parse(record.validUntil)))) throw new MemoryError('validUntil 必须是可解析的日期。');
  for (const key of ['updatedAt', 'updatedBy', 'reason'] as const) {
    if (typeof record[key] !== 'string' || !record[key].trim()) throw new MemoryError(`记忆条目缺少 ${key}。`);
  }
}

export function parseMemoryFile(raw: string): MemoryFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new MemoryError(`记忆文件不是有效 JSON：${(error as Error).message}`);
  }
  const file = data as MemoryFile;
  if (!file || typeof file !== 'object') throw new MemoryError('记忆文件结构无效。');
  if (file.schemaVersion !== 1) throw new MemoryError('记忆 schemaVersion 必须为 1。');
  if (!Number.isInteger(file.revision) || file.revision < 0) throw new MemoryError('记忆 revision 无效。');
  if (!Array.isArray(file.records)) throw new MemoryError('记忆 records 必须是数组。');
  const ids = new Set<string>();
  for (const record of file.records) {
    validateRecord(record);
    if (ids.has(record.id)) throw new MemoryError(`记忆条目编号重复：${record.id}`);
    ids.add(record.id);
  }
  return file;
}

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
    const { writeFile } = await import('node:fs/promises');
    await writeFile(targets.log, JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n', { encoding: 'utf8', flag: 'a', mode: 0o600 });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work);
    this.serial = result.catch(() => {});
    return result;
  }

  async search(filter: {
    query?: string;
    category?: string;
    topic?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ revision: number; total: number; matched: number; offset: number; limit: number; records: MemoryRecord[] }> {
    return this.enqueue(async () => {
      const { file } = await this.read();
      const query = (filter.query ?? '').trim().toLowerCase();
      const now = Date.now();
      const visible = file.records.filter(r => !r.validUntil || Date.parse(r.validUntil) >= now);
      const matched = visible.filter(
        r =>
          (!filter.category || r.category === filter.category) &&
          (!filter.topic || r.topic === filter.topic) &&
          (!filter.status || r.status === filter.status) &&
          (!query || `${r.topic}\n${r.content}\n${r.source}`.toLowerCase().includes(query)),
      );
      const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);
      const maxOffset = Math.max(0, Math.ceil(matched.length / limit) - 1) * limit;
      const offset = Math.min(Math.max(filter.offset ?? 0, 0), maxOffset);
      return { revision: file.revision, total: visible.length, matched: matched.length, offset, limit, records: matched.slice(offset, offset + limit) };
    });
  }

  private async applyChanges(changes: MemoryChange[], actor: string, expectedRevision: number, changesetReason?: string): Promise<{ revision: number; changeset?: AppliedChangeset }> {
    return this.enqueue(async () => {
      const { file, version, existed } = await this.read();
      if (file.revision !== expectedRevision) {
        throw new MemoryError(`记忆已变化（当前 revision ${file.revision}，提交 ${expectedRevision}）；请重新查询后提交。`);
      }
      const before: Record<string, MemoryRecord | null> = {};
      const after: Record<string, MemoryRecord | null> = {};
      const next: MemoryFile = { ...file, records: [...file.records], revision: file.revision + 1 };
      // Rebuilt after every mutation: a splice invalidates earlier indexes.
      let indexById = new Map(next.records.map((r, i) => [r.id, i]));
      for (const change of changes) {
        if (!change || typeof change.reason !== 'string' || !change.reason.trim()) throw new MemoryError('每条记忆修订需说明本人指令依据。');
        if (change.op === 'delete') {
          const id = String(change.id ?? '');
          const index = indexById.get(id);
          if (index === undefined) throw new MemoryError(`要删除的记忆条目不存在：${id}`);
          before[id] = next.records[index]!;
          next.records.splice(index, 1);
          indexById = new Map(next.records.map((r, i) => [r.id, i]));
          after[id] = null;
          continue;
        }
        if (change.op === 'put') {
          const record = change.record;
          if (!record) throw new MemoryError('put 修订缺少条目内容。');
          const id = record.id ?? randomUUID();          const entry: MemoryRecord = {
            ...record,
            id,
            validUntil: record.validUntil ?? null,
            updatedAt: new Date().toISOString(),
            updatedBy: actor,
            reason: change.reason,
          };
          validateRecord(entry);
          const index = indexById.get(id);
          before[id] = index === undefined ? null : next.records[index]!;
          if (index === undefined) {
            next.records.push(entry);
          } else {
            next.records[index] = entry;
          }
          indexById = new Map(next.records.map((r, i) => [r.id, i]));
          after[id] = entry;
          continue;
        }
        throw new MemoryError(`未知修订操作：${String(change.op)}`);
      }
      let changeset: AppliedChangeset | undefined;
      if (changesetReason) {
        changeset = {
          id: `CS-${next.revision}`,
          reason: changesetReason,
          appliedAt: new Date().toISOString(),
          appliedBy: actor,
          baseRevision: file.revision,
          resultingRevision: next.revision,
          changes,
          before,
          after,
        };
      }
      // Persist the changeset BEFORE the memory file: an applied revision is
      // then always undoable; an orphan changeset (later write failed) is
      // harmlessly refused by the undo guard instead of the reverse.
      if (changeset) {
        const targets = await this.ensureTargets();
        const { writeFile } = await import('node:fs/promises');
        await writeFile(join(targets.changesets, `${changeset.id}.json`), JSON.stringify(changeset, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      }
      await this.write(next, version, existed);
      await this.appendAudit({ revision: next.revision, actor, changesetId: changeset?.id ?? null, changes: changes.map(c => ({ op: c.op, id: c.id ?? c.record?.id, reason: c.reason })) });
      return { revision: next.revision, changeset };
    });
  }

  async put(
    record: Omit<MemoryRecord, 'updatedAt' | 'updatedBy' | 'id'> & { id?: string },
    options: { expectedRevision: number; actor: string; reason: string },
  ): Promise<{ revision: number }> {
    const { revision } = await this.applyChanges([{ op: 'put', record, reason: options.reason }], options.actor, options.expectedRevision);
    return { revision };
  }

  async remove(id: string, options: { expectedRevision: number; actor: string; reason: string }): Promise<{ revision: number }> {
    const { revision } = await this.applyChanges([{ op: 'delete', id, reason: options.reason }], options.actor, options.expectedRevision);
    return { revision };
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
      const scoped = scope?.topic ? file.records.filter(r => r.topic === scope.topic) : file.records;
      const byTopic = new Map<string, MemoryRecord[]>();
      for (const record of scoped) {
        const list = byTopic.get(record.topic) ?? [];
        list.push(record);
        byTopic.set(record.topic, list);
      }
      const duplicates: { topic: string; ids: string[] }[] = [];
      const conflicts: { topic: string; ids: string[] }[] = [];
      for (const [topic, records] of byTopic) {
        const sameContent = new Map<string, string[]>();
        for (const record of records) {
          const key = `${record.category}\n${record.content}`;
          sameContent.set(key, [...(sameContent.get(key) ?? []), record.id]);
        }
        const dupIds = [...sameContent.values()].filter(ids => ids.length > 1).flat();
        if (dupIds.length > 0) duplicates.push({ topic, ids: dupIds });
        const confirmed = records.filter(r => r.status === 'confirmed');
        const topics = new Set(confirmed.map(r => r.content));
        if (confirmed.length > 1 && topics.size > 1) conflicts.push({ topic, ids: confirmed.map(r => r.id) });
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

  async applyChangeset(changes: MemoryChange[], options: { expectedRevision: number; actor: string; reason: string }): Promise<{ revision: number; changesetId: string }> {
    const { revision, changeset } = await this.applyChanges(changes, options.actor, options.expectedRevision, options.reason);
    return { revision, changesetId: changeset!.id };
  }

  async listChangesets(): Promise<{ id: string; reason: string; appliedAt: string; appliedBy: string; changes: number }[]> {
    const targets = await this.ensureTargets();
    const names = await readdir(targets.changesets).catch(() => [] as string[]);
    const result = [];
    for (const name of names.filter(n => n.endsWith('.json')).sort()) {
      try {
        const cs = JSON.parse(await readFile(join(targets.changesets, name), 'utf8')) as AppliedChangeset;
        result.push({ id: cs.id, reason: cs.reason, appliedAt: cs.appliedAt, appliedBy: cs.appliedBy, changes: cs.changes.length });
      } catch {
        // A malformed changeset file must not break listing the rest.
      }
    }
    return result;
  }

  async undo(changesetId: string, options: { expectedRevision: number; actor: string; reason: string }): Promise<{ revision: number }> {
    const targets = await this.ensureTargets();
    if (!/^CS-\d+$/.test(changesetId)) throw new MemoryError(`变更集编号无效：${changesetId}`);
    let changeset: AppliedChangeset;
    try {
      changeset = JSON.parse(await readFile(join(targets.changesets, `${changesetId}.json`), 'utf8')) as AppliedChangeset;
    } catch {
      throw new MemoryError(`变更集不存在或不可读：${changesetId}`);
    }
    // Replay backwards; refuse to overwrite records that changed since (the
    // undo must not clobber newer content).
    const inverse: MemoryChange[] = [];
    for (const change of [...changeset.changes].reverse()) {
      const id = change.id ?? change.record?.id ?? '';
      if (change.op === 'delete') {
        const before = changeset.before[id];
        if (!before) throw new MemoryError('变更集缺少撤销所需的前置内容。');
        inverse.push({ op: 'put', record: { ...before, reason: `撤销 ${changesetId}` }, reason: `撤销 ${changesetId}：${options.reason}` });
      } else {
        const before = changeset.before[id] ?? null;
        if (before === null) {
          inverse.push({ op: 'delete', id, reason: `撤销 ${changesetId}：${options.reason}` });
        } else {
          inverse.push({ op: 'put', record: { ...before, reason: `撤销 ${changesetId}` }, reason: `撤销 ${changesetId}：${options.reason}` });
        }
      }
    }
    // Guard against undoing over newer edits: every touched id must still
    // match the changeset's recorded after-state.
    const current = await this.enqueue(() => this.read());
    for (const [id, expectedAfter] of Object.entries(changeset.after)) {
      const currentRecord = current.file.records.find(r => r.id === id) ?? null;
      const same =
        (expectedAfter === null && currentRecord === null) ||
        (expectedAfter && currentRecord && expectedAfter.content === currentRecord.content && expectedAfter.updatedAt === currentRecord.updatedAt);
      if (!same) throw new MemoryError(`条目 ${id} 在变更集之后又被修改；撤销不会覆盖较新内容，请先整理当前状态。`);
    }
    const { revision } = await this.applyChanges(inverse, options.actor, options.expectedRevision, `撤销 ${changesetId}`);
    return { revision };
  }
}
