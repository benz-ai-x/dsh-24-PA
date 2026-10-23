import { createHash, randomUUID } from 'node:crypto';

export interface MemoryRecord {
  id: string;
  category: 'preference' | 'fact' | 'project' | 'decision';
  topic: string;
  content: string;
  source: string;
  sourceVersion?: string;
  status: 'confirmed' | 'unverified';
  lifecycle?: 'active' | 'inactive' | 'recycled';
  recycledFrom?: 'active' | 'inactive';
  confirmation?: { kind: 'owner_instruction'; text: string; at: string; by: string; reference?: string; statementHash?: string };
  scope?: { kind: 'personal' | 'company' | 'project'; name?: string };
  validFrom?: string | null;
  validUntil?: string | null;
  sourceCheck?: { state: 'unchecked' | 'current' | 'changed' | 'unavailable'; checkedAt?: string; evidence?: string; version?: string };
  conflict?: { state: 'unresolved' | 'resolved'; relatedIds: string[]; reason: string };
  updatedAt: string;
  updatedBy: string;
  reason: string;
}
export interface MemoryTombstone { id: string; deletedAt: string; revision: number; mutationId: string }
export interface MemoryFile { schemaVersion: 1 | 2; revision: number; lastMutationId?: string; records: MemoryRecord[]; tombstones?: MemoryTombstone[] }
export interface MemoryChange {
  op: 'put' | 'delete' | 'activate' | 'deactivate' | 'restore' | 'purge';
  id?: string;
  record?: Omit<MemoryRecord, 'updatedAt' | 'updatedBy' | 'id'> & { id?: string };
  reason: string;
}
export interface AppliedChangeset {
  formatVersion?: 2;
  mutationId?: string;
  resultingHash?: string;
  id: string;
  reason: string;
  appliedAt: string;
  appliedBy: string;
  baseRevision: number;
  resultingRevision: number;
  changes: MemoryChange[];
  before: Record<string, MemoryRecord | null>;
  after: Record<string, MemoryRecord | null>;
  purgedIds?: string[];
}
export class MemoryError extends Error {
  constructor(message: string) { super(message); this.name = 'MemoryError'; }
}
export const emptyMemory = (): MemoryFile => ({ schemaVersion: 2, revision: 0, records: [], tombstones: [] });
export const memoryHash = (file: MemoryFile) => createHash('sha256').update(JSON.stringify(file)).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function member(value: unknown, allowed: readonly string[], label: string) {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new MemoryError(`${label}无效。`);
}
function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemoryError(`${label}无效。`);
}
function text(value: unknown, label: string, limit = 12000) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new MemoryError(`${label}需为 1–${limit} 字。`);
}
function date(value: unknown, label: string) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new MemoryError(`${label}必须是可解析的日期。`);
}
export function validateRecord(record: MemoryRecord): void {
  object(record, '记忆条目'); if (typeof record.id !== 'string' || !record.id) throw new MemoryError('记忆条目缺少 id。');
  member(record.category, ['preference', 'fact', 'project', 'decision'], '记忆类别');
  if (typeof record.topic !== 'string') throw new MemoryError('记忆主题必须为字符串。');
  text(record.content, '记忆内容'); text(record.source, '记忆来源');
  member(record.status, ['confirmed', 'unverified'], '记忆状态');
  if (record.lifecycle !== undefined) member(record.lifecycle, ['active', 'inactive', 'recycled'], '记忆生命周期');
  if (record.recycledFrom !== undefined) member(record.recycledFrom, ['active', 'inactive'], '回收前状态');
  if (record.validFrom != null) date(record.validFrom, 'validFrom');
  if (record.validUntil != null) date(record.validUntil, 'validUntil');
  if (record.validFrom && record.validUntil && Date.parse(record.validFrom) > Date.parse(record.validUntil)) throw new MemoryError('记忆有效开始时间不能晚于结束时间。');
  if (record.sourceVersion !== undefined && typeof record.sourceVersion !== 'string') throw new MemoryError('sourceVersion 必须为字符串。');
  if (record.confirmation !== undefined) {
    object(record.confirmation, '确认依据'); member(record.confirmation.kind, ['owner_instruction'], '确认依据类型');
    text(record.confirmation.text, '本人确认指令'); text(record.confirmation.by, '确认会话'); date(record.confirmation.at, '确认时间');
    if (record.confirmation.reference !== undefined) text(record.confirmation.reference, '确认引用');
  }
  if (record.scope !== undefined) {
    object(record.scope, '记忆范围'); member(record.scope.kind, ['personal', 'company', 'project'], '记忆范围');
    if (record.scope.kind !== 'personal' || record.scope.name !== undefined) text(record.scope.name, '范围名称', 500);
  }
  if (record.sourceCheck !== undefined) {
    object(record.sourceCheck, '来源核验'); member(record.sourceCheck.state, ['unchecked', 'current', 'changed', 'unavailable'], '来源核验状态');
    if (record.sourceCheck.state !== 'unchecked') { date(record.sourceCheck.checkedAt, '来源核验时间'); text(record.sourceCheck.evidence, '来源核验依据'); }
    if (record.sourceCheck.version !== undefined && typeof record.sourceCheck.version !== 'string') throw new MemoryError('来源核验版本无效。');
  }
  if (record.conflict !== undefined) {
    object(record.conflict, '冲突信息'); member(record.conflict.state, ['unresolved', 'resolved'], '冲突状态');
    if (!Array.isArray(record.conflict.relatedIds) || record.conflict.relatedIds.some(id => typeof id !== 'string' || !id)) throw new MemoryError('冲突关联 ID 无效。');
    text(record.conflict.reason, '冲突处理依据');
  }
  for (const key of ['updatedAt', 'updatedBy', 'reason'] as const) text(record[key], `记忆条目 ${key}`);
  date(record.updatedAt, '更新时间');
}
export function parseMemoryFile(raw: string): MemoryFile {
  let data: unknown;
  try { data = JSON.parse(raw); } catch (error) { throw new MemoryError(`记忆文件不是有效 JSON：${(error as Error).message}`); }
  object(data, '记忆文件结构');
  const file = data as unknown as MemoryFile;
  if (![1, 2].includes(file.schemaVersion)) throw new MemoryError('记忆 schemaVersion 必须为 1 或 2。');
  if (!Number.isSafeInteger(file.revision) || file.revision < 0) throw new MemoryError('记忆 revision 无效。');
  if (!Array.isArray(file.records)) throw new MemoryError('记忆 records 必须是数组。');
  if (file.lastMutationId !== undefined) text(file.lastMutationId, 'lastMutationId');
  if (file.tombstones !== undefined && !Array.isArray(file.tombstones)) throw new MemoryError('记忆删除标记必须是数组。');
  const ids = new Set<string>();
  for (const tombstone of file.tombstones ?? []) {
    object(tombstone, '记忆删除标记'); if (typeof tombstone.id !== 'string' || !tombstone.id) throw new MemoryError('删除标记缺少 id。'); date(tombstone.deletedAt, '删除时间'); text(tombstone.mutationId, '删除操作标识');
    if (!Number.isSafeInteger(tombstone.revision) || tombstone.revision < 1 || tombstone.revision > file.revision) throw new MemoryError('删除标记 revision 无效。');
    if (Object.keys(tombstone).some(key => !['id', 'deletedAt', 'revision', 'mutationId'].includes(key))) throw new MemoryError('删除标记不能保存正文或额外内容。');
    if (ids.has(tombstone.id)) throw new MemoryError(`记忆删除标记编号重复：${tombstone.id}`);
    ids.add(tombstone.id);
  }
  for (const record of file.records) {
    validateRecord(record);
    if (ids.has(record.id)) throw new MemoryError(`记忆条目编号重复或已永久删除：${record.id}`);
    ids.add(record.id);
  }
  return file;
}
export interface MemoryFilter {
  query?: string; category?: string; topic?: string; status?: string; lifecycle?: string;
  freshness?: string; project?: string; sourceState?: string; conflict?: string; confirmation?: string;
  mode?: 'business' | 'facts' | 'manage'; limit?: number; offset?: number;
}
export interface MemoryViewRecord extends MemoryRecord {
  effective: { lifecycle: 'active' | 'inactive' | 'recycled'; freshness: 'current' | 'upcoming' | 'expired'; confirmation: 'verified' | 'missing' | 'unverified'; conflict: 'none' | 'candidate' | 'unresolved' | 'resolved'; relatedIds: string[]; useAs: 'fact' | 'clue' | 'excluded' };
}
export const memoryStatementHash = (record: MemoryRecord) => createHash('sha256').update(canonical({ category: record.category, topic: record.topic, content: record.content, scope: record.scope ?? { kind: 'personal' }, validFrom: record.validFrom ?? null, validUntil: record.validUntil ?? null })).digest('hex');
const scopeKey = (record: MemoryRecord) => canonical(record.scope ?? { kind: 'personal' });
function overlaps(a: MemoryRecord, b: MemoryRecord) {
  return Math.max(a.validFrom ? Date.parse(a.validFrom) : -Infinity, b.validFrom ? Date.parse(b.validFrom) : -Infinity) <= Math.min(a.validUntil ? Date.parse(a.validUntil) : Infinity, b.validUntil ? Date.parse(b.validUntil) : Infinity);
}
export function memoryViews(file: MemoryFile, now = Date.now()): MemoryViewRecord[] {
  return file.records.map(record => {
    const lifecycle = record.lifecycle ?? 'active';
    const freshness = record.validUntil && Date.parse(record.validUntil) < now ? 'expired' : record.validFrom && Date.parse(record.validFrom) > now ? 'upcoming' : 'current';
    const confirmation = record.status !== 'confirmed' ? 'unverified' : record.confirmation?.statementHash === memoryStatementHash(record) ? 'verified' : 'missing';
    const relatedIds = record.status !== 'confirmed' || lifecycle !== 'active' ? [] : file.records.filter(other => other.id !== record.id && (other.lifecycle ?? 'active') === 'active' && other.status === 'confirmed' && other.category === record.category && other.topic === record.topic && scopeKey(other) === scopeKey(record) && other.content !== record.content && overlaps(other, record) && !(record.conflict?.state === 'resolved' && record.conflict.relatedIds.includes(other.id) && other.conflict?.state === 'resolved' && other.conflict.relatedIds.includes(record.id))).map(other => other.id);
    const conflict = record.conflict?.state === 'unresolved' ? 'unresolved' : relatedIds.length ? 'candidate' : record.conflict?.state === 'resolved' ? 'resolved' : 'none';
    const useAs = lifecycle !== 'active' || freshness !== 'current' || conflict === 'unresolved' ? 'excluded' : confirmation !== 'verified' || conflict === 'candidate' ? 'clue' : 'fact';
    return { ...record, effective: { lifecycle, freshness, confirmation, conflict, relatedIds: [...new Set([...relatedIds, ...(record.conflict?.relatedIds ?? [])])], useAs } };
  });
}
export function queryMemory(file: MemoryFile, filter: MemoryFilter, now = Date.now()) {
  const mode = filter.mode ?? 'business';
  if (!['business', 'facts', 'manage'].includes(mode)) throw new MemoryError('记忆查询范围无效。');
  const allowed: Record<string, readonly string[]> = { category: ['preference', 'fact', 'project', 'decision'], status: ['confirmed', 'unverified'], lifecycle: ['active', 'inactive', 'recycled'], freshness: ['current', 'expired', 'upcoming'], sourceState: ['unchecked', 'current', 'changed', 'unavailable'], conflict: ['none', 'candidate', 'unresolved', 'resolved'], confirmation: ['verified', 'missing', 'unverified'] };
  for (const [key, values] of Object.entries(allowed)) { const value = filter[key as keyof MemoryFilter]; if (value) member(value, values, key); }
  const limit = filter.limit ?? 20, requestedOffset = filter.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) throw new MemoryError('记忆分页需为有效整数（每页 1–100 条）。');
  const all = memoryViews(file, now);
  const visible = all.filter(record => mode === 'manage' || (mode === 'facts' ? record.effective.useAs === 'fact' : record.effective.useAs !== 'excluded'));
  const query = (filter.query ?? '').trim().toLowerCase();
  const matched = visible.filter(record =>
    (!filter.category || record.category === filter.category) && (!filter.topic || record.topic === filter.topic) &&
    (!filter.status || record.status === filter.status) && (!filter.lifecycle || record.effective.lifecycle === filter.lifecycle) &&
    (!filter.freshness || record.effective.freshness === filter.freshness) && (!filter.confirmation || record.effective.confirmation === filter.confirmation) &&
    (!filter.sourceState || (record.sourceCheck?.state ?? 'unchecked') === filter.sourceState) && (!filter.conflict || record.effective.conflict === filter.conflict) &&
    (!filter.project || (record.scope?.kind === 'project' && record.scope.name === filter.project)) &&
    (!query || `${record.topic}\n${record.content}\n${record.source}\n${record.scope?.name ?? ''}`.toLowerCase().includes(query)));
  const maxOffset = Math.max(0, Math.ceil(matched.length / limit) - 1) * limit;
  const offset = Math.min(requestedOffset, maxOffset);
  const counts = { total: all.length, active: 0, inactive: 0, recycled: 0, expired: 0, upcoming: 0, conflicts: 0, facts: 0, clues: 0, permanent: file.tombstones?.length ?? 0 };
  for (const record of all) { counts[record.effective.lifecycle]++; if (record.effective.freshness !== 'current') counts[record.effective.freshness]++; if (['unresolved', 'candidate'].includes(record.effective.conflict)) counts.conflicts++; if (record.effective.useAs === 'fact') counts.facts++; if (record.effective.useAs === 'clue') counts.clues++; }
  return { revision: file.revision, schemaVersion: file.schemaVersion, total: visible.length, matched: matched.length, offset, limit, counts, records: matched.slice(offset, offset + limit) };
}
export function normalizeChanges(changes: MemoryChange[]): MemoryChange[] {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new MemoryError('变更集需包含 1–100 条修改。');
  return changes.map(change => {
    if (!change || typeof change.reason !== 'string' || !change.reason.trim()) throw new MemoryError('每条记忆修订需说明本人指令依据。');
    member(change.op, ['put', 'delete', 'activate', 'deactivate', 'restore', 'purge'], '修订操作');
    if (change.op !== 'put') { if (typeof change.id !== 'string' || !change.id) throw new MemoryError(`${change.op} 的 id 必须是非空字符串。`); return change; }
    if (!change.record) throw new MemoryError('put 修订缺少条目内容。');
    if (change.id && change.record.id && change.id !== change.record.id) throw new MemoryError('put 的 id 与 record.id 不一致，请明确唯一目标。');
    const { id, ...put } = change;
    return { ...put, record: { ...change.record, id: change.record.id ?? id ?? randomUUID() } };
  });
}
export function stageMemoryChanges(file: MemoryFile, changes: MemoryChange[], actor: string, mutationId: string, at: string) {
  text(actor, '记忆修订会话');
  const before: Record<string, MemoryRecord | null> = Object.create(null), after: Record<string, MemoryRecord | null> = Object.create(null);
  const next: MemoryFile = { ...file, schemaVersion: 2, records: [...file.records], tombstones: [...file.tombstones ?? []], revision: file.revision + 1, lastMutationId: mutationId };
  for (const change of changes) {
    const id = change.id ?? change.record?.id!;
    if (next.tombstones!.some(row => row.id === id)) throw new MemoryError(`记忆 ${id} 已永久删除，不能恢复或复用此 ID。`);
    const index = next.records.findIndex(record => record.id === id), current = index < 0 ? null : next.records[index]!;
    if (!Object.hasOwn(before, id)) before[id] = current;
    if (change.op === 'purge') {
      if (!current || current.lifecycle !== 'recycled') throw new MemoryError('永久删除前必须先回收该记忆并核对当前版本。');
      next.records.splice(index, 1); next.tombstones!.push({ id, deletedAt: at, revision: next.revision, mutationId }); after[id] = null; before[id] = null;
    } else if (change.op === 'put') {
      const { effective: _, ...input } = change.record as MemoryRecord & { effective?: unknown };
      const entry: MemoryRecord = { ...input, id, validUntil: input.validUntil ?? null, lifecycle: input.lifecycle ?? current?.lifecycle ?? 'active', updatedAt: at, updatedBy: actor, reason: change.reason };
      if (current?.lifecycle === 'recycled' && entry.lifecycle !== 'recycled') throw new MemoryError('回收项必须先明确恢复，不能以修改绕过恢复。');
      if (entry.lifecycle === 'recycled' && entry.recycledFrom === undefined && current?.recycledFrom) entry.recycledFrom = current.recycledFrom;
      if (entry.confirmation && !entry.confirmation.statementHash) entry.confirmation = { ...entry.confirmation, statementHash: memoryStatementHash(entry) };
      validateRecord(entry);
      if (index < 0) next.records.push(entry); else next.records[index] = entry;
      after[id] = entry;
    } else {
      if (!current) throw new MemoryError(`记忆条目不存在：${id}`);
      if (change.op === 'restore' && current.lifecycle !== 'recycled') throw new MemoryError('只有回收项可以恢复。');
      if (['activate', 'deactivate'].includes(change.op) && current.lifecycle === 'recycled') throw new MemoryError('回收项须明确恢复后才能启停。');
      const lifecycle = change.op === 'delete' ? 'recycled' : change.op === 'deactivate' ? 'inactive' : change.op === 'restore' ? current.recycledFrom ?? 'active' : 'active';
      const entry: MemoryRecord = { ...current, lifecycle, updatedAt: at, updatedBy: actor, reason: change.reason };
      if (change.op === 'delete' && current.lifecycle !== 'recycled') entry.recycledFrom = current.lifecycle ?? 'active';
      if (change.op === 'restore') delete entry.recycledFrom;
      next.records[index] = entry; after[id] = entry;
    }
  }
  // A later purge in the same batch must not retain an earlier body in history.
  const purgedIds = next.tombstones!.filter(row => row.mutationId === mutationId).map(row => row.id);
  for (const id of purgedIds) { before[id] = null; after[id] = null; }
  parseMemoryFile(JSON.stringify(next));
  return { next, before, after, purgedIds };
}

/** Restore planning only. Existing records and deletion markers win; callers
 * must present conflicts and commit the reviewed result through their restore
 * boundary. Never use this to overwrite a live workspace without a preview. */
export function planMemoryRestore(current: MemoryFile, backup: MemoryFile) {
  parseMemoryFile(JSON.stringify(current)); parseMemoryFile(JSON.stringify(backup));
  const tombstones = new Map((current.tombstones ?? []).map(row => [row.id, row]));
  for (const row of backup.tombstones ?? []) if (!tombstones.has(row.id)) tombstones.set(row.id, row);
  const records = new Map(current.records.filter(row => !tombstones.has(row.id)).map(row => [row.id, row]));
  const added: string[] = [], protectedIds: string[] = current.records.filter(row => tombstones.has(row.id)).map(row => row.id), conflicts: string[] = [];
  for (const record of backup.records) {
    if (tombstones.has(record.id)) { protectedIds.push(record.id); continue; }
    const existing = records.get(record.id);
    if (existing) { if (canonical(existing) !== canonical(record)) conflicts.push(record.id); continue; }
    records.set(record.id, record); added.push(record.id);
  }
  const file: MemoryFile = { schemaVersion: 2, revision: Math.max(current.revision, backup.revision) + 1, records: [...records.values()], tombstones: [...tombstones.values()] };
  return { file, added, protectedIds: [...new Set(protectedIds)], conflicts, currentRevision: current.revision, backupRevision: backup.revision };
}
