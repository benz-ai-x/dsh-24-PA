import { effectiveSources, selectSource, sourceScopeFingerprint, type LegacySourceConfiguration, type SourceRegistration } from './source-config.js';
import type { SourceRegistry, SourceTarget } from './source-registry.js';
import type { SourceProjectionRepo, SourceMembershipRow, SourceObservation, ObservedSourceItem, SourceRoles } from './repo/source-projection.js';
import type { TaskRow, ActionOperationRow } from './repo.js';
import { sourceObjectId } from './repo/source-projection.js';
import { localDay } from './calendar-time.js';
import { isDeepStrictEqual } from 'node:util';

export type TodoRole = 'all' | 'responsible' | 'following' | 'assigned' | 'creator';
const query = { from: null, to: null };
interface SourceTodoDeps {
  config(): LegacySourceConfiguration & { timeZone: string };
  registry: SourceRegistry;
  projection(): SourceProjectionRepo;
  read(target: SourceTarget): Promise<SourceObservation>;
  object(target: SourceTarget, guid: string): Promise<ObservedSourceItem>;
  localTasks(): Promise<TaskRow[]>;
  operation(id: string): Promise<ActionOperationRow | null>;
  relations(): Promise<ActionOperationRow[]>;
  projectTasks?(id: string): Promise<TaskRow[]>;
  gate<T>(key: string, work: () => Promise<T>): Promise<T>;
}
function unknownRole(roles: SourceRoles, role: TodoRole): boolean {
  return role !== 'all' && (roles.unknown ? roles.unknown.includes(role) : !roles.complete);
}

/** Complete filtering precedes pagination and counting. The panel reads this
 * saved view; only an explicit refresh crosses the platform boundary. */
export class SourceTodo {
  constructor(private readonly deps: SourceTodoDeps) {}

  /** A legacy task GUID alone proves neither the platform identity nor the
   * original source. Only a durable receipt or a qualified projection ID links it. */
  private async localReference(task: TaskRow): Promise<{ objectId: string; target?: SourceTarget } | null> {
    const operation = await this.deps.operation(task.id), receipt = operation?.receipt;
    const target = operation?.params.sourceTarget as SourceTarget | undefined;
    if (operation?.status === 'succeeded' && target?.domain === 'todo' && target.platform === task.channel
      && receipt?.guid === task.task_guid && receipt.channel === task.channel && isDeepStrictEqual(receipt.sourceTarget, target)
      && receipt.objectId === sourceObjectId(target, task.task_guid)) return { objectId: receipt.objectId, target };
    if (task.id.startsWith('object:')) {
      const locations = await this.deps.projection().locations(task.id);
      if (locations.some(row => row.domain === 'todo' && row.platform === task.channel && row.native_id === task.task_guid
        && sourceObjectId({ domain: row.domain, platform: row.platform, identityKey: row.identity_key }, row.native_id) === task.id)) return { objectId: task.id };
    }
    return null;
  }

  async localObjectId(task: TaskRow): Promise<string | null> { return (await this.localReference(task))?.objectId ?? null; }

  private selected(args: Record<string, unknown>): SourceRegistration[] {
    const config = effectiveSources(this.deps.config());
    let entries = config.entries.filter(row => row.domain === 'todo');
    if (args.sourceId !== undefined || args.company !== undefined || args.project !== undefined) entries = [selectSource(config, 'todo', {
      ...(args.sourceId !== undefined ? { sourceId: String(args.sourceId) } : {}),
      ...(args.company !== undefined ? { company: String(args.company) } : {}), ...(args.project !== undefined ? { project: String(args.project) } : {}),
    }, false).source];
    if (args.channel !== undefined) {
      if (!['feishu', 'wecom'].includes(String(args.channel))) throw new Error('待办平台筛选无效。');
      entries = entries.filter(row => row.platform === args.channel);
    }
    return entries;
  }

  async query(args: Record<string, unknown> = {}, refresh = true, paginate = true) {
    const role = args.role === undefined || args.role === '' ? null : String(args.role) as TodoRole;
    if (role !== null && !['all', 'responsible', 'following', 'assigned', 'creator'].includes(role)) throw new Error('待办角色筛选无效。');
    const status = String(args.status ?? 'all');
    if (!['all', 'open', 'completed', 'canceled'].includes(status)) throw new Error('待办状态筛选无效。');
    const deadline = String(args.deadline ?? 'all');
    if (!['all', 'overdue', 'today', 'undated', 'upcoming'].includes(deadline)) throw new Error('待办截止筛选无效。');
    const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 50);
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('待办分页参数无效。');
    const search = String(args.query ?? '').trim().toLowerCase();
    const selected = this.selected(args), snapshot = await this.deps.registry.list();
    const [locals, relations] = await Promise.all([this.deps.localTasks(), this.deps.relations()]);
    const localObjects = new Map(await Promise.all(locals.map(async task => [task.id, await this.localObjectId(task)] as const)));
    const projectTasks = args.projectId === undefined ? null : await this.deps.projectTasks?.(String(args.projectId)) ?? [];
    const objects = new Map<string, { row: SourceMembershipRow; locations: any[]; match: boolean; stale: boolean }>();
    const sources = [];
    for (const source of selected) {
      const stored = snapshot.entries.find(row => row.id === source.id);
      const scope = { sourceId: source.id, registrationRevision: stored?.revision ?? 0, scopeHash: sourceScopeFingerprint(source) };
      let failure: string | null = null, refreshed = false;
      if (refresh && source.enabled) try {
        await this.deps.gate(`source-todo:${source.id}`, async () => {
          const target = await this.deps.registry.bind('todo', { sourceId: source.id }, 'read');
          if (target.registrationRevision !== scope.registrationRevision || target.scopeHash !== scope.scopeHash) throw new Error('查询期间来源已改变，请重试。');
          await this.deps.projection().observe(target, await this.deps.read(target));
        }); refreshed = true;
      } catch (error) { failure = (error as Error).message; }
      const cache = await this.deps.projection().cached(scope, query), observation = cache.observation;
      const current = effectiveSources(this.deps.config()).entries.find(row => row.id === source.id);
      if (!current || sourceScopeFingerprint(current) !== scope.scopeHash) throw new Error('查询期间来源配置已改变，请重新查询。');
      const filter = role ?? (source.filter === 'responsible' ? 'responsible' : 'all');
      let unknownRoles = 0, matching = 0;
      const rows = cache.items.map(row => {
        const assigned = relations.some(operation => {
          const target = operation.params.sourceTarget as SourceTarget | undefined;
          return target?.identityKey === row.identity_key && target.platform === row.platform && operation.receipt?.guid === row.native_id
            && Array.isArray(operation.params.assigneeIds) && operation.params.assigneeIds.some((id: string) => id !== target.identity.ownerId && Array.isArray(row.body.assignees) && row.body.assignees.some((person: any) => person.id === id && !['removed', 'reject', 'notshow'].includes(person.state)))
            && typeof operation.params.instruction === 'string' && operation.params.instruction.trim();
        });
        const roles = assigned ? { ...row.roles, values: [...new Set([...row.roles.values, 'assigned'])], unknown: row.roles.unknown?.filter(value => value !== 'assigned') } : row.roles;
        if (unknownRole(roles, filter)) unknownRoles++;
        return { ...row, roles };
      });
      let state = !source.enabled ? 'disabled' : failure ? 'failed' : !refreshed && stored?.evidence?.state === 'failed' ? 'failed'
        : !refreshed && stored?.evidence?.state !== 'verified' ? 'unverified' : observation?.state ?? 'unverified';
      if (state === 'complete' && unknownRoles) state = 'partial';
      if (state === 'complete' && status === 'canceled') state = 'partial';
      const fresh = refreshed && state === 'complete';
      if (source.enabled) for (const row of rows) {
        const matches = (filter === 'all' || row.roles.values.includes(filter));
        if (matches) matching++;
        const stale = !fresh || !observation || row.observed_at < observation.observed_at;
        const location = { sourceId: source.id, sourceName: source.name, platform: source.platform, locator: row.locator,
          roles: row.roles, capabilities: source.access === 'read' ? { ...row.capabilities, update: 'denied', complete: 'denied', cancel: 'denied' } : row.capabilities,
          filter, matching: matches, checkedAt: row.observed_at.toISOString(), stale };
        const existing = objects.get(row.object_id);
        if (existing) { existing.locations.push(location); existing.match ||= matches; existing.stale &&= stale; if (row.observed_at > existing.row.observed_at) existing.row = row; }
        else objects.set(row.object_id, { row, locations: [location], match: matches, stale });
      }
      sources.push({ sourceId: source.id, name: source.name, platform: source.platform, filter, state, fresh, matching, unknownRoles,
        checkedAt: observation?.observed_at.toISOString() ?? null, lastCompleteAt: observation?.last_complete_at?.toISOString() ?? null,
        reason: !source.enabled ? '来源已停用，本次不读取或计入待办' : failure ?? observation?.reason ?? (status === 'canceled' ? '原生列表不提供完整已删除待办范围，不能报告已删除总数' : unknownRoles ? `${unknownRoles} 项待办的所选角色尚未核实，可能遗漏匹配结果` : stored?.evidence?.state === 'failed' ? stored.evidence.message : state === 'unverified' ? '尚未核验此来源' : null) });
    }
    const today = localDay(new Date(), this.deps.config().timeZone), now = Date.now();
    const bucket = (body: Record<string, unknown>): string => {
      if (!body.dueAt && !body.dueDate) return 'undated';
      if (body.dueDate) return String(body.dueDate) < today.date ? 'overdue' : body.dueDate === today.date ? 'today' : 'upcoming';
      const time = Date.parse(String(body.dueAt));
      return time < now ? 'overdue' : time < today.to.getTime() ? 'today' : 'upcoming';
    };
    const all = [...objects].filter(([, object]) => object.match).map(([objectId, { row, locations, stale }]) => {
      const links = locals.filter(task => localObjects.get(task.id) === objectId);
      return { ...row.body, objectId, guid: row.native_id, channel: row.platform, summary: String(row.body.summary ?? ''),
        status: String(row.body.status), description: String(row.body.description ?? ''), dueAt: row.body.dueAt ?? null, dueDate: row.body.dueDate ?? null, bucket: bucket(row.body), locations, stale,
        checkedAt: row.observed_at.toISOString(), url: locations.find(location => location.locator.url)?.locator.url ?? null,
        workItemIds: [...new Set(links.map(task => task.work_item_id).filter(Boolean))], taskId: links.length === 1 ? links[0]!.id : null,
        plannedAt: links.length === 1 ? links[0]!.planned_at?.toISOString() ?? null : null, estimateMinutes: links.length === 1 ? links[0]!.estimate_minutes : null };
    }).filter(row => (projectTasks === null || projectTasks.some(task => localObjects.get(task.id) === row.objectId))
      && (status === 'all' || row.status === status) && (deadline === 'all' || row.bucket === deadline)
      && (!search || `${row.summary}\n${row.description ?? ''}`.toLowerCase().includes(search)));
    const weight = { overdue: 0, today: 1, upcoming: 2, undated: 3 };
    all.sort((a, b) => weight[a.bucket as keyof typeof weight] - weight[b.bucket as keyof typeof weight]
      || String(a.dueAt ?? a.dueDate ?? '').localeCompare(String(b.dueAt ?? b.dueDate ?? '')) || a.objectId.localeCompare(b.objectId));
    const enabled = sources.filter(source => source.state !== 'disabled');
    const complete = enabled.length > 0 && enabled.every(source => source.state === 'complete'), fresh = complete && enabled.every(source => source.fresh);
    const counts = { open: all.filter(row => row.status === 'open').length, overdue: all.filter(row => row.status === 'open' && row.bucket === 'overdue').length,
      today: all.filter(row => row.status === 'open' && ((row.dueDate === today.date) || (row.dueAt && Date.parse(String(row.dueAt)) >= today.from.getTime() && Date.parse(String(row.dueAt)) < today.to.getTime()))).length,
      undated: all.filter(row => row.status === 'open' && row.bucket === 'undated').length };
    return { sources, complete, fresh, counts, count: all.length, total: complete ? all.length : null, offset, limit, hasMore: paginate && offset + limit < all.length,
      tasks: paginate ? all.slice(offset, offset + limit) : all,
      message: !selected.length ? '没有已登记的待办来源，请在参数配置登记；不能据此判断没有待办。' : fresh ? `已核验 ${enabled.length} 个来源，匹配 ${all.length} 项待办。`
        : `当前可展示 ${all.length} 项待办；请查看来源范围和核验时间，未完整核验时不能据此判断全部完成。` };
  }

  async resolve(args: Record<string, unknown>): Promise<{ target: SourceTarget; guid: string; item: ObservedSourceItem }> {
    const config = effectiveSources(this.deps.config());
    const explicit = args.sourceId === undefined && args.company === undefined && args.project === undefined ? null : selectSource(config, 'todo', {
      ...(args.sourceId !== undefined ? { sourceId: String(args.sourceId) } : {}), ...(args.company !== undefined ? { company: String(args.company) } : {}), ...(args.project !== undefined ? { project: String(args.project) } : {}),
    }, false).source;
    const key = String(args.taskId ?? args.guid ?? '');
    const local = (await this.deps.localTasks()).find(task => task.id === key);
    if (local && args.guid !== undefined && args.guid !== local.task_guid && args.guid !== local.id) throw new Error('指定 GUID 与本地待办原对象不符。');
    const reference = local ? await this.localReference(local) : null;
    if (local && !reference) throw new Error('旧待办缺少原身份和来源的持久证据，不能按裸 GUID 自动绑定；请先查询并核对原平台对象。');
    if (reference && args.objectId !== undefined && args.objectId !== reference.objectId) throw new Error('指定对象与原待办持久回执不符。');
    const guid = local?.task_guid ?? key;
    if (reference?.target) {
      const target = reference.target;
      if ((explicit && explicit.id !== target.sourceId) || (args.channel !== undefined && args.channel !== target.platform)
        || ((args.tasklistId ?? args._tasklistId) !== undefined && (args.tasklistId ?? args._tasklistId) !== target.resource.id)) throw new Error('指定来源、平台或清单与原待办持久回执不符。');
      await this.deps.registry.verify(target, 'read');
      return { target, guid, item: await this.deps.object(target, guid) };
    }
    const objectId = reference?.objectId ?? (args.objectId ? String(args.objectId) : null);
    const locations = objectId ? await this.deps.projection().locations(objectId) : await this.deps.projection().todoLocations(guid);
    const valid = locations.filter(row => row.domain === 'todo' && row.active && (!guid || row.native_id === guid) && (!explicit || row.source_id === explicit.id)
      && (!args.channel || row.platform === args.channel) && config.entries.some(source => source.enabled && source.id === row.source_id && sourceScopeFingerprint(source) === row.scope_hash));
    const destinations = new Set(valid.map(row => JSON.stringify([row.platform, row.identity_key, row.native_id])));
    if (destinations.size > 1) throw new Error('该标识对应多个平台或身份的待办，请明确来源和原对象。');
    if (!valid[0] && (!explicit || !guid || objectId)) throw new Error('请先核验待办来源并确定原对象；不能用当前默认目标猜测旧对象。');
    const sourceId = valid[0]?.source_id ?? explicit!.id;
    const target = await this.deps.registry.bind('todo', { sourceId }, 'read');
    if ((args.channel !== undefined && args.channel !== target.platform) || ((args.tasklistId ?? args._tasklistId) !== undefined && (args.tasklistId ?? args._tasklistId) !== target.resource.id)) throw new Error('指定平台或清单与原待办来源不符。');
    if (valid[0] && (valid[0].identity_key !== target.identityKey || valid[0].registration_revision !== target.registrationRevision)) throw new Error('原待办身份或来源代次已改变，请重新查询核验。');
    const id = valid[0]?.native_id ?? guid;
    const item = await this.deps.object(target, id);
    return { target, guid: id, item };
  }

  async get(args: Record<string, unknown>) {
    const { target, guid, item } = await this.resolve(args);
    await this.deps.projection().observe(target, { query, items: [item], observedAt: new Date(), state: 'partial', reason: '仅核验单个待办，未核验全部来源范围' });
    return { ...item.body, objectId: sourceObjectId(target, guid), guid, sourceTarget: target, channel: target.platform, url: item.locator.url, roles: item.roles, stale: false, message: `已按${target.platform === 'feishu' ? '飞书' : '企微'}最新状态刷新原待办，业务状态以原平台读回为准。` };
  }
}
