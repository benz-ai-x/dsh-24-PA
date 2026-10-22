import { effectiveSources, selectSource, sourceScopeFingerprint, type LegacySourceConfiguration, type SourceRegistration } from './source-config.js';
import type { SourceRegistry, SourceTarget } from './source-registry.js';
import type { SourceProjectionRepo, SourceMembershipRow, SourceObservationQuery, SourceObservation, ObservedSourceItem } from './repo/source-projection.js';
import { parseZonedRange } from './util.js';

type CalendarRole = 'all' | 'involved' | 'organizer' | 'participant';
interface SourceCalendarDeps {
  config(): LegacySourceConfiguration;
  registry: SourceRegistry;
  projection(): SourceProjectionRepo;
  read(target: SourceTarget, query: SourceObservationQuery): Promise<SourceObservation>;
  object?(target: SourceTarget, eventId: string): Promise<ObservedSourceItem>;
  gate<T>(key: string, work: () => Promise<T>): Promise<T>;
}

function roleMatches(row: SourceMembershipRow, role: CalendarRole): boolean {
  return role === 'all' || (role === 'involved' ? row.roles.values.some(value => ['participant', 'organizer'].includes(value)) : row.roles.values.includes(role));
}

/** One query boundary for conversation, cards and busy checks. Browsing only
 * reads stored observations; an explicit verification is a separate action. */
export class SourceCalendar {
  constructor(private readonly deps: SourceCalendarDeps) {}

  async inspect(target: SourceTarget, eventId: string) {
    await this.deps.registry.verify(target, 'read');
    if (!this.deps.object) throw new Error('日程单对象读取尚未接通。');
    const item = await this.deps.object(target, eventId);
    await this.deps.projection().observe(target, { query: { from: item.startTime!.toISOString(), to: item.endTime!.toISOString() },
      state: 'partial', reason: '仅核验单个日程，未核验完整窗口', observedAt: new Date(), items: [item] });
    return item;
  }

  /** Preserve the original location for follow-up plans. IDs shared by two
   * platforms or copies require an explicit source before any plan is bound. */
  async resolve(args: Record<string, unknown>) {
    const config = effectiveSources(this.deps.config());
    const explicit = args.sourceId === undefined ? null : selectSource(config, 'calendar', { sourceId: String(args.sourceId) }, false).source;
    const locations = args.objectId ? await this.deps.projection().locations(String(args.objectId)) : await this.deps.projection().calendarLocations(String(args.eventId ?? ''));
    const valid = locations.filter(row => {
      const source = config.entries.find(source => source.id === row.source_id);
      return row.active && source?.enabled && row.scope_hash === sourceScopeFingerprint(source) && (!explicit || source.id === explicit.id)
        && (!args.eventId || args.eventId === row.locator.eventId) && (!args.channel || row.platform === args.channel)
        && (!args.calendarId || args.calendarId === row.locator.calendarId || args.calendarId === source.resourceId || (args.calendarId === 'wecom' && source.platform === 'wecom'));
    });
    const destinations = new Set(valid.map(row => JSON.stringify([row.platform, row.identity_key, row.locator.calendarId, row.locator.eventId])));
    if (destinations.size > 1) throw new Error('该日程存在多个原对象位置，请明确 sourceId，不能猜测会前准备的目标。');
    if (!valid[0] && (!explicit || !args.eventId || args.objectId)) throw new Error('请先查询并明确原日程及来源，缺失的关联不会由默认来源补造。');
    const target = await this.deps.registry.bind('calendar', { sourceId: valid[0]?.source_id ?? explicit!.id }, 'read');
    if (valid[0] && (target.registrationRevision !== valid[0].registration_revision || target.identityKey !== valid[0].identity_key)) throw new Error('日程原来源已重新登记或更换身份，请重新查询核验。');
    const eventId = String(valid[0]?.locator.eventId ?? args.eventId);
    return { target, eventId, item: await this.inspect(target, eventId) };
  }

  private selected(args: Record<string, unknown>): SourceRegistration[] {
    const config = effectiveSources(this.deps.config());
    let entries = config.entries.filter(row => row.domain === 'calendar');
    if (args.sourceId !== undefined || args.company !== undefined || args.project !== undefined) {
      const { source } = selectSource(config, 'calendar', {
        ...(args.sourceId !== undefined ? { sourceId: String(args.sourceId) } : {}),
        ...(args.company !== undefined ? { company: String(args.company) } : {}),
        ...(args.project !== undefined ? { project: String(args.project) } : {}),
      }, false);
      entries = [source];
    }
    if (args.calendarId !== undefined) {
      entries = entries.filter(row => row.resourceId === args.calendarId || (args.calendarId === 'wecom' && row.platform === 'wecom' && row.resourceKind === 'authorized_scope'));
      if (!entries.length) throw new Error('所选日历未登记，请通过来源配置核对；不会查询任意未登记资源。');
    }
    if (args.channel !== undefined) {
      if (!['feishu', 'wecom'].includes(String(args.channel))) throw new Error('日程平台筛选无效。');
      entries = entries.filter(row => row.platform === args.channel);
    }
    return entries;
  }

  /** Internal consumers need the entire busy set from one observation, not a
   * page that could incorrectly make later events appear free. */
  all(args: Record<string, unknown>, refresh = true) { return this.query(args, refresh, false); }

  async query(args: Record<string, unknown>, refresh = true, paginate = true) {
    const { from, to } = parseZonedRange(args);
    const query = { from: from.toISOString(), to: to.toISOString() };
    const role = args.role === undefined ? null : String(args.role) as CalendarRole;
    if (role !== null && !['all', 'involved', 'organizer', 'participant'].includes(role)) throw new Error('日程角色筛选须为 all、involved、organizer 或 participant。');
    const limit = args.limit === undefined ? 50 : Number(args.limit), offset = args.offset === undefined ? 0 : Number(args.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw new Error('日程分页参数无效。');
    const search = String(args.query ?? '').trim().toLowerCase();
    const snapshot = await this.deps.registry.list(), selected = this.selected(args);
    const objects = new Map<string, { row: SourceMembershipRow; locations: ReturnType<SourceCalendar['location']>[]; stale: boolean }>();
    const sources = [];
    for (const source of selected) {
      const stored = snapshot.entries.find(row => row.id === source.id);
      const scope = { sourceId: source.id, registrationRevision: stored?.revision ?? 0, scopeHash: sourceScopeFingerprint(source) };
      let failure: string | null = null, refreshed = false;
      if (refresh && source.enabled) {
        try {
          await this.deps.gate(`source-calendar:${source.id}`, async () => {
            const target = await this.deps.registry.bind('calendar', { sourceId: source.id }, 'read');
            if (target.registrationRevision !== scope.registrationRevision || target.scopeHash !== scope.scopeHash) throw new Error('查询期间来源已改变，请重新查询。');
            await this.deps.projection().observe(target, await this.deps.read(target, query));
          });
          refreshed = true;
        } catch (error) { failure = (error as Error).message; }
      }
      const cache = await this.deps.projection().cached(scope, query);
      const observation = cache.observation;
      const current = effectiveSources(this.deps.config()).entries.find(row => row.id === source.id);
      if (!current || sourceScopeFingerprint(current) !== scope.scopeHash) throw new Error('查询期间来源配置已改变，请重新查询。');
      const filter = role ?? source.filter as CalendarRole;
      const unknownRoles = cache.items.filter(row => !row.roles.complete).length;
      let state = !source.enabled ? 'disabled' : failure ? 'failed'
        : !refreshed && stored?.evidence?.state === 'failed' ? 'failed'
        : !refreshed && stored?.evidence?.state !== 'verified' ? 'unverified'
        : observation?.state ?? 'unverified';
      if (state === 'complete' && filter !== 'all' && unknownRoles > 0) state = 'partial';
      const fresh = refreshed && state === 'complete';
      let matching = 0;
      if (source.enabled) for (const row of cache.items) {
        if (!roleMatches(row, filter) || (search && !String(row.body.summary ?? '').toLowerCase().includes(search))) continue;
        matching++;
        const stale = !fresh || row.observed_at < observation!.observed_at;
        const existing = objects.get(row.object_id), location = this.location(source, row, filter, stale);
        if (existing) {
          existing.locations.push(location); existing.stale &&= stale;
          if (row.observed_at > existing.row.observed_at) existing.row = row;
        } else objects.set(row.object_id, { row, locations: [location], stale });
      }
      sources.push({ sourceId: source.id, name: source.name, platform: source.platform, filter, state, fresh, matching, unknownRoles,
        checkedAt: observation?.observed_at.toISOString() ?? null, lastCompleteAt: observation?.last_complete_at?.toISOString() ?? null,
        reason: !source.enabled ? '来源已停用，本次不读取或计入日程' : failure ?? (state === 'failed' && !refreshed ? stored?.evidence?.message : null) ?? observation?.reason
          ?? (unknownRoles > 0 ? `有 ${unknownRoles} 个对象的参与关系未完整核验${filter === 'all' ? '；当前按全部授权可见对象展示' : '，角色筛选可能遗漏结果'}` : state === 'unverified' ? '尚未核验本时间窗口' : null) });
    }
    const enabled = sources.filter(source => source.state !== 'disabled');
    const complete = enabled.length > 0 && enabled.every(source => source.state === 'complete');
    const fresh = complete && enabled.every(source => source.fresh);
    const all = [...objects].map(([objectId, { row, locations, stale }]) => ({ objectId, summary: String(row.body.summary ?? ''),
      allDay: row.body.allDay === true, timezone: String(row.body.timezone ?? ''), recurring: row.body.recurring === true,
      freeBusy: locations.every(location => location.freeBusy === 'free') ? 'free' : 'busy',
      eventId: String(locations[0]!.locator.eventId), start: row.start_time!.toISOString(), end: row.end_time!.toISOString(),
      locations, stale, checkedAt: row.observed_at.toISOString(), url: String(locations.find(location => location.locator.url)?.locator.url ?? '') || null,
    })).sort((a, b) => a.start.localeCompare(b.start) || a.objectId.localeCompare(b.objectId));
    const conflicts = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length && all[j]!.start < all[i]!.end; j++) {
      if (all[i]!.freeBusy !== 'free' && all[j]!.freeBusy !== 'free') conflicts.push({ a: all[i]!.objectId, b: all[j]!.objectId, aSummary: all[i]!.summary, bSummary: all[j]!.summary });
    }
    return { from: query.from, to: query.to, fresh, complete, sources, conflicts,
      count: all.length, total: complete ? all.length : null, offset, limit, hasMore: paginate && offset + limit < all.length, events: paginate ? all.slice(offset, offset + limit) : all,
      next: all.find(row => Date.parse(row.end) > Date.now()) ?? null,
      message: !selected.length ? '没有已登记的日历来源，请在参数配置登记；不能据此判断没有日程。'
        : fresh ? `已核验 ${sources.length} 个来源，共 ${all.length} 个日程，冲突 ${conflicts.length} 处。`
        : `${refresh ? '本次查询未完整核验' : '以下为已保存的日程观察'}：当前可展示 ${all.length} 个日程；请查看逐来源范围和时间，不能据此断言没有日程或全部空闲。` };
  }

  private location(source: SourceRegistration, row: SourceMembershipRow, filter: CalendarRole, stale: boolean) {
    const capabilities = source.access === 'read' ? { ...row.capabilities, update: 'denied', cancel: 'denied', reminders: 'denied' } : row.capabilities;
    return { sourceId: source.id, sourceName: source.name, platform: source.platform, locator: row.locator, roles: row.roles, capabilities,
      filter, freeBusy: String(row.body.freeBusy ?? 'busy'), stale, checkedAt: row.observed_at.toISOString() };
  }
}
