import { createHash } from 'node:crypto';

export type SourceDomain = 'calendar' | 'todo';
export type SourcePlatform = 'feishu' | 'wecom';
export interface SourceRegistration {
  id: string;
  domain: SourceDomain;
  platform: SourcePlatform;
  name: string;
  purpose: 'personal' | 'company' | 'project';
  /** Expected authorized person, never a credential or a grant of access. */
  ownerId: string;
  resourceKind: 'calendar' | 'tasklist' | 'authorized_scope';
  resourceId: string;
  filter: 'all' | 'involved' | 'responsible';
  access: 'read' | 'readwrite';
  enabled: boolean;
}
export interface SourceMapping {
  domain: SourceDomain;
  kind: 'company' | 'project';
  name: string;
  sourceId: string;
}
export interface SourceConfiguration {
  version: 1;
  entries: SourceRegistration[];
  defaults: { calendar: string | null; todo: string | null };
  mappings: SourceMapping[];
  /** null means ask for an end time; it never means an implicit one hour. */
  meetingDurationMinutes: number | null;
}

export class SourceError extends Error {
  constructor(message: string) { super(message); this.name = 'SourceError'; }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SourceError(`${path} 必须为对象。`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  if (extra.length) throw new SourceError(`${path} 含未知字段：${extra.join('、')}。`);
}
function string(value: unknown, path: string, empty = false, max = 256): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new SourceError(`${path} 必须是${empty ? '可为空的' : '非空'}单行文本（最多 ${max} 字）。`);
  return value.trim();
}
function member<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (!allowed.includes(value as T)) throw new SourceError(`${path} 必须为 ${allowed.join(' / ')}。`);
  return value as T;
}
function domain(value: unknown, path: string): SourceDomain { return member(value, ['calendar', 'todo'], path); }

/** Only user intent is editable. Actual permissions and identity proofs live outside config. */
export function validateSources(raw: unknown): SourceConfiguration | null {
  if (raw === undefined || raw === null) return null;
  const input = record(raw, 'sources');
  keys(input, ['version', 'entries', 'defaults', 'mappings', 'meetingDurationMinutes'], 'sources');
  if (input.version !== 1) throw new SourceError('sources.version 必须为 1。');
  if (!Array.isArray(input.entries) || input.entries.length > 100) throw new SourceError('sources.entries 必须是最多 100 项的列表。');
  const entries = input.entries.map((raw, index): SourceRegistration => {
    const path = `sources.entries[${index}]`, row = record(raw, path);
    keys(row, ['id', 'domain', 'platform', 'name', 'purpose', 'ownerId', 'resourceKind', 'resourceId', 'filter', 'access', 'enabled'], path);
    const id = string(row.id, `${path}.id`, false, 80);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new SourceError(`${path}.id 只接受字母、数字、短横线和下划线。`);
    const kind = domain(row.domain, `${path}.domain`);
    const platform = member(row.platform, ['feishu', 'wecom'], `${path}.platform`);
    const resourceKind = member(row.resourceKind, ['calendar', 'tasklist', 'authorized_scope'], `${path}.resourceKind`);
    if (resourceKind !== 'authorized_scope' && resourceKind !== (kind === 'calendar' ? 'calendar' : 'tasklist')) throw new SourceError(`${path} 的资源类型与日历／待办领域不符。`);
    if (typeof row.enabled !== 'boolean') throw new SourceError(`${path}.enabled 必须为布尔值。`);
    const purpose = member(row.purpose, ['personal', 'company', 'project'], `${path}.purpose`);
    const filter = member(row.filter, kind === 'calendar' ? ['all', 'involved'] : ['all', 'responsible'], `${path}.filter`);
    // Shared sources start with a personal-role filter in the editor. The owner
    // may explicitly save "all" for that source; this still cannot grant access.
    return { id, domain: kind, platform, name: string(row.name, `${path}.name`, false, 120), purpose,
      ownerId: string(row.ownerId, `${path}.ownerId`, true), resourceKind, resourceId: string(row.resourceId, `${path}.resourceId`, true),
      filter, access: member(row.access, ['read', 'readwrite'], `${path}.access`), enabled: row.enabled };
  });
  if (new Set(entries.map(row => row.id)).size !== entries.length) throw new SourceError('来源 ID 不得重复。');
  const defaults = record(input.defaults, 'sources.defaults');
  keys(defaults, ['calendar', 'todo'], 'sources.defaults');
  const target = (id: unknown, kind: SourceDomain, path: string): string => {
    const value = string(id, path);
    const source = entries.find(row => row.id === value);
    if (!source || source.domain !== kind) throw new SourceError(`${path} 必须指向同一领域的已登记来源。`);
    // Retain disabled/read-only targets so they produce a visible block,
    // rather than choosing a replacement without the owner's decision.
    return value;
  };
  const calendar = defaults.calendar === null ? null : target(defaults.calendar, 'calendar', 'sources.defaults.calendar');
  const todo = defaults.todo === null ? null : target(defaults.todo, 'todo', 'sources.defaults.todo');
  if (!Array.isArray(input.mappings) || input.mappings.length > 200) throw new SourceError('sources.mappings 必须是最多 200 项的列表。');
  const mappings = input.mappings.map((raw, index): SourceMapping => {
    const path = `sources.mappings[${index}]`, row = record(raw, path);
    keys(row, ['domain', 'kind', 'name', 'sourceId'], path);
    const kind = domain(row.domain, `${path}.domain`);
    return { domain: kind, kind: member(row.kind, ['company', 'project'], `${path}.kind`), name: string(row.name, `${path}.name`, false, 120), sourceId: target(row.sourceId, kind, `${path}.sourceId`) };
  });
  if (new Set(mappings.map(row => JSON.stringify([row.domain, row.kind, row.name]))).size !== mappings.length) throw new SourceError('同一领域的公司／项目映射不得重复。');
  const duration = input.meetingDurationMinutes;
  if (duration !== null && (!Number.isInteger(duration) || Number(duration) < 1 || Number(duration) > 1440)) throw new SourceError('默认会议时长须为 1–1440 分钟，或留空后逐次补问。');
  return { version: 1, entries, defaults: { calendar, todo }, mappings, meetingDurationMinutes: duration as number | null };
}

export interface LegacySourceConfiguration {
  sources?: SourceConfiguration | null;
  ownerOpenId: string;
  calendarId: string;
  tasklistId: string;
  calendarChannel: SourcePlatform;
  todoChannel: SourcePlatform;
}

/** Deterministic, local-only migration; an explicit empty registry stays empty. */
export function effectiveSources(config: LegacySourceConfiguration): SourceConfiguration {
  if (config.sources) return config.sources;
  const entries = (['calendar', 'todo'] as const).map((kind): SourceRegistration => {
    const platform = kind === 'calendar' ? config.calendarChannel : config.todoChannel;
    const resourceId = platform === 'wecom' ? 'authorized' : kind === 'calendar' ? config.calendarId : config.tasklistId;
    return {
      id: `legacy-${kind}-${platform}`, domain: kind, platform,
      name: `${platform === 'feishu' ? '飞书' : '企微'}${kind === 'calendar' ? '原日历来源' : '原待办来源'}`,
      purpose: 'personal', ownerId: platform === 'feishu' ? config.ownerOpenId : '',
      resourceKind: platform === 'wecom' ? 'authorized_scope' : kind === 'calendar' ? 'calendar' : 'tasklist',
      resourceId, filter: kind === 'calendar' ? 'all' : 'responsible', access: 'readwrite', enabled: true,
    };
  });
  return { version: 1, entries, defaults: { calendar: entries[0]!.id, todo: entries[1]!.id }, mappings: [], meetingDurationMinutes: null };
}

/** Editing a legacy default materializes its registrations in AGENTS.md.
 * Retaining the original IDs lets existing objects and frozen authorizations
 * keep their original destination while new requests use the new default. */
export function migrateLegacySourceChange(before: LegacySourceConfiguration, after: LegacySourceConfiguration): SourceConfiguration | null {
  if (before.sources || after.sources) return after.sources ?? null;
  const old = effectiveSources(before), next = effectiveSources(after);
  if (JSON.stringify(old) === JSON.stringify(next)) return null;
  const entries = [...old.entries], defaults = { ...old.defaults };
  for (const source of next.entries) {
    const match = entries.find(row => row.domain === source.domain && row.platform === source.platform && row.ownerId === source.ownerId
      && row.resourceKind === source.resourceKind && row.resourceId === source.resourceId);
    if (match) { defaults[source.domain] = match.id; continue; }
    const id = entries.some(row => row.id === source.id) ? `${source.id}-${sourceScopeFingerprint(source).slice(0, 12)}` : source.id;
    entries.push({ ...source, id }); defaults[source.domain] = id;
  }
  return { ...old, entries, defaults };
}

export interface SourceSelector { sourceId?: string; company?: string; project?: string }
export interface SourceSelection { source: SourceRegistration; reason: 'explicit' | 'mapping' | 'default' }

/** Routing returns one registration; it neither grants access nor falls back after a failure. */
export function selectSource(config: SourceConfiguration, kind: SourceDomain, selector: SourceSelector = {}, writable = true): SourceSelection {
  let id: string | null = null, reason: SourceSelection['reason'] = 'default';
  if (selector.sourceId !== undefined) {
    const input = string(selector.sourceId, '明确来源');
    const exact = config.entries.find(row => row.domain === kind && row.id === input);
    const matches = exact ? [exact] : config.entries.filter(row => row.domain === kind && row.name === input);
    if (matches.length !== 1) throw new SourceError(matches.length ? '来源名称对应多项，请指定唯一来源。' : '明确指定的来源未登记；请先在参数配置登记，不会改用默认来源。');
    id = matches[0]!.id; reason = 'explicit';
  } else {
    const names = (['company', 'project'] as const).filter(key => selector[key] !== undefined);
    if (names.length) {
      const ids = new Set(names.map(key => {
        const name = string(selector[key], key);
        const match = config.mappings.find(row => row.domain === kind && row.kind === key && row.name === name);
        if (!match) throw new SourceError(`尚未配置${key === 'company' ? '公司' : '项目'}「${name}」的来源，请补充目标。`);
        return match.sourceId;
      }));
      if (ids.size !== 1) throw new SourceError('公司与项目映射到不同来源，请明确本次唯一目标。');
      id = [...ids][0]!; reason = 'mapping';
    } else id = config.defaults[kind];
  }
  const source = config.entries.find(row => row.id === id && row.domain === kind);
  if (!source) throw new SourceError('尚未配置默认来源，请明确目标或在参数配置设置。');
  if (!source.enabled) throw new SourceError(`来源「${source.name}」已停用；不会改投其他来源。`);
  if (writable && source.access !== 'readwrite') throw new SourceError(`来源「${source.name}」仅登记为读取；请确认写入范围。`);
  if (!source.resourceId) throw new SourceError(`来源「${source.name}」缺少资源标识，请先补齐并核验。`);
  return { source, reason };
}

/** Display names, purposes and query filters do not rebind a frozen write
 * target. Memberships retain all roles, so filtering never needs a new cache. */
export function sourceScopeFingerprint(source: SourceRegistration): string {
  return createHash('sha256').update(JSON.stringify([source.id, source.domain, source.platform, source.ownerId, source.resourceKind, source.resourceId, source.access, source.enabled])).digest('hex');
}

export function sourceConfigurationFingerprint(config: SourceConfiguration): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
