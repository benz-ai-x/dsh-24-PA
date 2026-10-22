import { mapRemoteEvent } from './feishu-channels.js';
import { wecomParseWallTime, wecomWallTime } from './wecom.js';
import type { SourceTarget } from './source-registry.js';
import type { ObservedSourceItem, SourceObservation, SourceObservationQuery, SourceRoles } from './repo/source-projection.js';

export interface SourceCalendarReaderDeps {
  timeZone(): string;
  lark(args: string[]): Promise<{ data: any }>;
  wecom(args: string[]): Promise<{ data: any }>;
  now?(): Date;
}

/** Reads platform instances and role evidence. No mutation or title-based merge. */
export class SourceCalendarReader {
  constructor(private readonly deps: SourceCalendarReaderDeps) {}

  async object(target: SourceTarget, eventId: string): Promise<ObservedSourceItem> {
    if (target.platform === 'feishu') {
      const { data } = await this.deps.lark(['calendar', 'events', 'get', '--as', 'user', '--calendar-id', target.resource.id, '--event-id', eventId, '--user-id-type', 'open_id']);
      if (data?.event?.event_id !== eventId) throw new Error('日程核验未返回唯一匹配的原对象。');
      const item = await this.feishuItem(target, data.event);
      if (!item) throw new Error('原日程时间无法核实。');
      return item;
    }
    const { data } = await this.deps.wecom(['calendar', 'schedules', 'get', '--schedule-ids', JSON.stringify([eventId])]);
    const matches = Array.isArray(data?.schedule_list) ? data.schedule_list.filter((row: any) => row.schedule_id === eventId) : [];
    if (matches.length !== 1) throw new Error('企微核验未返回唯一匹配的原对象。');
    const item = this.wecomItem(target, matches[0]);
    if (!item) throw new Error('原日程时间无法核实。');
    return item;
  }

  async read(target: SourceTarget, query: SourceObservationQuery): Promise<SourceObservation> {
    const observedAt = this.deps.now?.() ?? new Date();
    const items: ObservedSourceItem[] = [], reasons: string[] = [];
    try {
      if (!query.from || !query.to || !(new Date(query.from) < new Date(query.to))) throw new Error('日程查询需要明确时间范围。');
      if (target.platform === 'feishu') await this.feishu(target, query, items, reasons);
      else await this.wecom(target, query, items, reasons, observedAt);
      const unique = new Map<string, ObservedSourceItem>();
      for (const item of items) {
        if (unique.has(item.nativeId)) throw new Error('同一来源返回重复的日程实例，需核对远端结果。');
        unique.set(item.nativeId, item);
      }
      return { query, observedAt, items, state: reasons.length ? 'partial' : 'complete', ...(reasons.length ? { reason: [...new Set(reasons)].join('；') } : {}) };
    } catch (error) {
      return { query, observedAt, items, state: items.length ? 'partial' : 'failed', reason: [...reasons, (error as Error).message].join('；') };
    }
  }

  private async feishu(target: SourceTarget, query: SourceObservationQuery, items: ObservedSourceItem[], reasons: string[]): Promise<void> {
    // Fixed CLI instance_view has a 40-day window and a 1,000-instance cap.
    // Split at the cap (as the official +agenda shortcut does); a saturated
    // two-hour window remains explicitly incomplete, never an empty success.
    const seen = new Map<string, string>();
    const window = async (from: number, to: number): Promise<void> => {
      const maxSpan = 39 * 86400;
      if (to - from > maxSpan) { await window(from, from + maxSpan); await window(from + maxSpan, to); return; }
      const { data } = await this.deps.lark(['calendar', 'events', 'instance_view', '--as', 'user', '--calendar-id', target.resource.id,
        '--start-time', String(from), '--end-time', String(to), '--user-id-type', 'open_id']);
      if (!Array.isArray(data?.items)) throw new Error('飞书日程实例列表无法解析。');
      if (data.items.length >= 1000) {
        if (to - from > 7200) { const middle = Math.floor((from + to) / 2); await window(from, middle); await window(middle, to); return; }
        reasons.push('飞书日程实例达到两小时窗口上限，范围不完整');
      }
      if (data.has_more === true) reasons.push('飞书实例接口仍有未返回结果');
      for (const raw of data.items) {
        const event = mapRemoteEvent(raw, this.deps.timeZone(), 'exclusive');
        if (!event) { reasons.push('存在无法解析标识或时间的日程'); continue; }
        if (event.start >= new Date(query.to!) || event.end <= new Date(query.from!)) continue;
        // Instance IDs are stable native IDs; adjacent windows may repeat one.
        const fingerprint = JSON.stringify([event.summary, event.start, event.end, event.canceled, raw.organizer_calendar_id]);
        if (seen.has(event.eventId)) {
          if (seen.get(event.eventId) !== fingerprint) reasons.push('同一日程实例在本次读取中发生变化，需重新核验');
          continue;
        }
        seen.set(event.eventId, fingerprint);
        const item = (await this.feishuItem(target, raw))!;
        items.push(item);
      }
    };
    await window(Math.floor(Date.parse(query.from!) / 1000), Math.ceil(Date.parse(query.to!) / 1000));
  }

  private async feishuItem(target: SourceTarget, raw: any): Promise<ObservedSourceItem | null> {
    const event = mapRemoteEvent(raw, this.deps.timeZone(), 'exclusive');
    if (!event) return null;
    const roles = event.canceled ? { complete: true, values: [] } : await this.feishuRoles(target, raw);
    const organizer = roles.values.includes('organizer'), participant = roles.values.includes('participant');
    const recurring = event.recurring || !!raw.recurring_event_id || /_[1-9]\d*$/.test(event.eventId);
    // A shared organizer calendar + the same native instance proves a single
    // event. Personal RSVP, reminders and permissions stay per location.
    const origin = typeof raw.organizer_calendar_id === 'string' && raw.organizer_calendar_id ? raw.organizer_calendar_id : target.resource.id;
    return { nativeId: JSON.stringify([origin, event.eventId]),
      locator: { calendarId: target.resource.id, eventId: event.eventId, organizerCalendarId: raw.organizer_calendar_id ?? null,
        url: event.url, selfRsvpStatus: raw.self_rsvp_status ?? null, reminders: raw.reminders ?? null, recurring, seriesEventId: raw.recurring_event_id ?? null },
      body: { summary: event.summary, start: event.start.toISOString(), end: event.end.toISOString(), allDay: event.isAllDay,
        timezone: event.timezone, recurring, freeBusy: raw.free_busy_status ?? 'busy' },
      roles, capabilities: { update: organizer || (participant && raw.attendee_ability === 'can_modify_event') ? 'allowed' : 'unknown',
        cancel: organizer && origin === target.resource.id ? 'allowed' : 'unknown', leave: 'adapter_unavailable', reminders: participant || organizer ? 'allowed' : 'unknown',
        effect: organizer && origin === target.resource.id ? 'whole_event' : 'personal_copy', requiresSourceCheck: true },
      active: !event.canceled, startTime: event.start, endTime: event.end };
  }

  private async pages(fetch: (token: string | null) => Promise<{ data: any }>, consume: (item: any) => Promise<void>): Promise<void> {
    let token: string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 1000; page++) {
      const { data } = await fetch(token);
      if (!Array.isArray(data?.items) || typeof data.has_more !== 'boolean') throw new Error('参与关系分页缺少完整列表或结束标记');
      for (const row of data.items) await consume(row);
      if (!data.has_more) return;
      if (typeof data.page_token !== 'string' || !data.page_token || seen.has(data.page_token)) throw new Error('参与关系分页标记缺失或循环');
      token = String(data.page_token); seen.add(token);
    }
    throw new Error('参与关系分页达到保护上限，尚未完整读取');
  }

  private async feishuRoles(target: SourceTarget, raw: any): Promise<SourceRoles> {
    const values = new Set<string>(), owner = target.identity.ownerId;
    let organizerKnown = typeof raw.event_organizer?.user_id === 'string' && !!raw.event_organizer.user_id;
    if (raw.event_organizer?.user_id === owner) values.add('organizer');
    const person = (row: any, id: unknown) => {
      if (typeof id !== 'string' || !id) throw new Error('参与人缺少可核对的用户标识');
      if (row.is_organizer === true) { organizerKnown = true; if (id === owner) values.add('organizer'); }
      if (id === owner && !['removed', 'decline'].includes(row.rsvp_status)) values.add('participant');
    };
    try {
      await this.pages(token => this.deps.lark(['calendar', 'event.attendees', 'list', '--as', 'user', '--calendar-id', target.resource.id,
        '--event-id', raw.event_id, '--user-id-type', 'open_id', '--page-size', '100', ...(token ? ['--page-token', token] : [])]), async row => {
        if (row.type === 'user') person(row, row.user_id);
        else if (row.type === 'chat' && row.rsvp_status !== 'removed') {
          if (!row.attendee_id) throw new Error('群参与人缺少原生标识');
          const path = `/open-apis/calendar/v4/calendars/${encodeURIComponent(target.resource.id)}/events/${encodeURIComponent(raw.event_id)}/attendees/${encodeURIComponent(row.attendee_id)}/chat_members`;
          await this.pages(token => this.deps.lark(['api', 'GET', path, '--as', 'user', '--params', JSON.stringify({ user_id_type: 'open_id', page_size: 100, ...(token ? { page_token: token } : {}) })]), async member => person(member, member.open_id));
        } else if (!['chat', 'resource', 'third_party'].includes(row.type)) throw new Error('无法识别的参与人类型');
      });
      if (!organizerKnown) throw new Error('组织者身份未返回，不能用日历拥有者代替日程组织者');
      return { complete: true, values: [...values] };
    } catch (error) { return { complete: false, values: [...values], reason: (error as Error).message }; }
  }

  private async wecom(target: SourceTarget, query: SourceObservationQuery, items: ObservedSourceItem[], reasons: string[], now: Date): Promise<void> {
    if (target.resource.kind !== 'authorized_scope' || target.resource.id !== 'authorized') throw new Error('当前企微适配器尚未接通指定日历容器。');
    const horizon = 30 * 86400000, requestedFrom = Date.parse(query.from!), requestedTo = Date.parse(query.to!);
    const from = Math.max(requestedFrom, now.getTime() - horizon), to = Math.min(requestedTo, now.getTime() + horizon);
    if (!(from < to)) throw new Error('企微查询只覆盖当前时间前后 30 天，本时段尚不可核验。');
    if (from !== requestedFrom || to !== requestedTo) reasons.push('企微仅核验当前时间前后 30 天，未覆盖完整请求时段');
    const zone = this.deps.timeZone();
    const { data } = await this.deps.wecom(['calendar', 'schedules', 'list', '--begin-time', wecomWallTime(new Date(from), zone), '--end-time', wecomWallTime(new Date(to), zone)]);
    if (!Array.isArray(data?.schedule_list)) throw new Error('企微日程列表无法解析。');
    if (data.schedule_list_count !== data.schedule_list.length || data.has_more === true) reasons.push('企微日程返回数量或范围不完整');
    for (const raw of data.schedule_list) {
      const item = this.wecomItem(target, raw);
      if (!item) { reasons.push('企微日程存在无法解析的标识或时间'); continue; }
      if (item.startTime! >= new Date(query.to!) || item.endTime! <= new Date(query.from!)) continue;
      if (item.body.recurring) reasons.push('企微重复日程返回系列规则，尚未核验该窗口的全部实例');
      items.push(item);
    }
  }

  private wecomItem(target: SourceTarget, raw: any): ObservedSourceItem | null {
    const timezone = String(raw?.timezone?.timezone_id ?? this.deps.timeZone());
    const start = wecomParseWallTime(String(raw?.begin_time ?? ''), timezone), end = wecomParseWallTime(String(raw?.end_time ?? ''), timezone);
    if (typeof raw?.schedule_id !== 'string' || !raw.schedule_id || !start || !end || !(start < end)) return null;
    const participant = Array.isArray(raw.attendees) && raw.attendees.some((row: any) => row.userid === target.identity.ownerId);
    const roles = { complete: false, values: participant ? ['participant'] : [], reason: '企微固定接口未返回可核对的组织者标识，参与关系覆盖不完整' };
    const recurring = raw.repeat_rule?.is_repeat === true;
    return { nativeId: JSON.stringify(['schedule', raw.schedule_id]), locator: { eventId: raw.schedule_id, calendarId: raw.cal_id ?? null,
      calendarName: raw.calendar_name ?? null, reminders: raw.reminders ?? null, recurring, url: null },
      body: { summary: String(raw.subject ?? ''), start: start.toISOString(), end: end.toISOString(), timezone, allDay: raw.is_all_day === true, recurring },
      roles, capabilities: { update: 'adapter_unavailable', cancel: 'unknown', leave: 'adapter_unavailable', reminders: 'adapter_unavailable', effect: 'unknown' },
      active: true, startTime: start, endTime: end };
  }
}
