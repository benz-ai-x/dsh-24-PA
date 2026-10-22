import type { PaConfig } from './config.js';
import { effectiveSources, selectSource, sourceScopeFingerprint } from './source-config.js';
import type { SourceRegistry, SourceTarget } from './source-registry.js';
import type { SourceCalendarReader } from './source-calendar-reader.js';
import type { Repos, WorkItemRow, ActionOperationRow } from './repo.js';
import { sourceObjectId, type ObservedSourceItem } from './repo/source-projection.js';
import { ExternalOperations, isCandidateOperation } from './external-operations.js';
import { absoluteInstant } from './calendar-time.js';
import { hash, text } from './util.js';
import { wecomWallTime } from './wecom.js';
import { wecomRepeatRule } from './wecom-channels.js';
import { mapRemoteEvent } from './feishu-channels.js';

export type CalendarMutation = 'create' | 'update' | 'cancel' | 'reminders';
interface SourceCalendarWritesDeps {
  config(): PaConfig;
  registry: SourceRegistry;
  reader: SourceCalendarReader;
  repos(): Repos;
  external: ExternalOperations;
  lark(args: string[]): Promise<{ data: any }>;
  wecom(args: string[]): Promise<{ data: any }>;
  gate<T>(key: string, work: () => Promise<T>): Promise<T>;
  mirror?(target: SourceTarget, item: ObservedSourceItem): Promise<void>;
}
const requestFields = ['sourceId', 'company', 'project', 'calendarId', 'channel', 'objectId', 'eventId', 'summary', 'title', 'start', 'end', 'durationMinutes',
  'timeZone', 'attendees', 'rrule', 'repeatScope', 'instanceStart', 'effect', 'reminderMinutes', 'instruction', '_authorization'];
const unknown = (message: string) => Object.assign(new Error(message), { outcome: 'unknown' });
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

/** Freezes the first authorized destination and all defaults in the existing
 * action ledger. Retries recover that intent before consulting new defaults. */
export class SourceCalendarWrites {
  constructor(private readonly deps: SourceCalendarWritesDeps) {}

  async target(args: Record<string, unknown>, capability: 'read' | 'create' = 'create'): Promise<SourceTarget> {
    if (args._sourceTarget) {
      const target = args._sourceTarget as SourceTarget;
      await this.deps.registry.verify(target, capability); return target;
    }
    let sourceId = args.sourceId === undefined ? undefined : String(args.sourceId);
    if (sourceId === undefined && args.calendarId !== undefined) {
      const listed = await this.deps.registry.list();
      const matches = listed.entries.filter(row => row.domain === 'calendar' && (!args.channel || row.platform === args.channel)
        && (row.resourceId === args.calendarId || row.evidence?.resource?.id === args.calendarId || (args.calendarId === 'wecom' && row.platform === 'wecom' && row.resourceKind === 'authorized_scope')));
      if (matches.length !== 1) throw new Error('原生日历标识未对应唯一登记来源，请明确 sourceId；不会改用默认来源。');
      sourceId = matches[0]!.id;
    }
    const target = await this.deps.registry.bind('calendar', { ...(sourceId !== undefined ? { sourceId } : {}),
      ...(args.company !== undefined ? { company: String(args.company) } : {}), ...(args.project !== undefined ? { project: String(args.project) } : {}) }, capability);
    if (args.channel && args.channel !== target.platform) throw new Error('指定平台与登记来源不符，请核对唯一目标。');
    if (args.calendarId !== undefined && args.calendarId !== target.resource.id) {
      const registration = effectiveSources(this.deps.config()).entries.find(row => row.id === target.sourceId);
      if (args.calendarId !== registration?.resourceId && !(target.platform === 'wecom' && args.calendarId === 'wecom')) throw new Error('指定日历标识与登记来源不符，请核对唯一目标。');
    }
    return target;
  }

  async write(item: WorkItemRow, kind: CalendarMutation, args: Record<string, unknown>, override?: string): Promise<unknown> {
    const request = Object.fromEntries(requestFields.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
    const requestHash = hash(JSON.stringify(canonical(request)));
    let id = override ?? `source-calendar:${kind}:${item.id}:${requestHash}`;
    return this.deps.gate(`source-calendar-intent:${override ?? item.id}`, async () => {
      let previous = await this.deps.repos().operations.get(id);
      if (!previous && !override) {
        const equivalent = (await this.deps.repos().operations.calendarWritesForWork(item.id))
          .filter(row => row.params.kind === kind && this.sameIntent(args, row.params));
        if (equivalent.length > 1) throw unknown('已有多个等价日程操作，请先核对原回执，未发起新操作。');
        previous = equivalent[0] ?? null;
        if (previous) id = previous.id;
      }
      let params: Record<string, any>;
      if (previous) {
        if (isCandidateOperation(id)) await this.deps.external.candidateCreation(id, 'calendar', args);
        if (previous.params.sourceContract !== 1 || !previous.params.sourceTarget || previous.params.kind !== kind
          || (!isCandidateOperation(id) && previous.params.requestHash !== requestHash && !this.sameIntent(args, previous.params))) throw unknown('原日程操作的参数或来源不一致，需先核对；不会改投当前默认来源。');
        params = previous.params;
      } else {
        params = await this.prepare(kind, args);
        params = { ...params, sourceContract: 1, requestHash, request, ...(args._authorization as Record<string, unknown> ?? {}) };
      }
      const target = params.sourceTarget as SourceTarget;
      // Registration aliases and separate WorkItems may refer to the same
      // native calendar. Hold its lock through read-before-write, acceptance,
      // and readback; the calendar scope also covers series/instance overlap.
      return this.deps.gate(`source-calendar-resource:${JSON.stringify([target.platform, target.identityKey, target.resource.id])}`,
        () => this.writeFrozen(item, kind, id, params, previous));
    });
  }

  /** Compare semantic requests against their saved defaults, before probing a
   * current destination. Equivalent spelling cannot turn an unknown attempt
   * into a new operation, and changing defaults cannot move an old intent. */
  private sameIntent(args: Record<string, unknown>, saved: Record<string, any>): boolean {
    if (saved.sourceContract !== 1 || !saved.sourceTarget || !saved.request) return false;
    const target = saved.sourceTarget as SourceTarget, old = saved.request;
    const sources = effectiveSources(this.deps.config());
    if (args.channel !== undefined && args.channel !== target.platform) return false;
    if (args.calendarId !== undefined && args.calendarId !== target.resource.id && args.calendarId !== old.calendarId) return false;
    if (args._sourceTarget && JSON.stringify(canonical(args._sourceTarget)) !== JSON.stringify(canonical(target))) return false;
    if (args.sourceId !== undefined) {
      if (args.sourceId !== target.sourceId) {
        try { if (selectSource(sources, 'calendar', { sourceId: String(args.sourceId) }, false).source.id !== target.sourceId) return false; }
        catch { return false; }
      }
    } else if (args.company !== undefined || args.project !== undefined) {
      if (args.company !== old.company || args.project !== old.project || old.sourceId !== undefined) {
        try { if (selectSource(sources, 'calendar', { company: args.company as string | undefined, project: args.project as string | undefined }, false).source.id !== target.sourceId) return false; }
        catch { return false; }
      }
    } else if ((old.sourceId !== undefined || old.company !== undefined || old.project !== undefined) && sources.defaults.calendar !== target.sourceId) return false;
    if (saved.kind !== 'create') {
      if (args.eventId !== undefined && args.eventId !== saved.eventId) return false;
      if (args.objectId !== undefined && args.objectId !== old.objectId
        && (!saved.before?.nativeId || args.objectId !== sourceObjectId(target, saved.before.nativeId))) return false;
      if (args.eventId === undefined && args.objectId === undefined) return false;
    }
    try {
      const instant = (value: unknown) => value === undefined || value === null ? null : Math.floor(absoluteInstant(value).getTime() / 1000);
      const start = instant(args.start);
      let end = instant(args.end);
      if (saved.kind === 'create' && end === null && start !== null) {
        const duration = args.durationMinutes === undefined ? (Date.parse(saved.end) - Date.parse(saved.start)) / 60000 : Number(args.durationMinutes);
        if (!Number.isInteger(duration) || duration < 1 || duration > 1440) return false;
        end = start + duration * 60;
      }
      const incoming = { summary: saved.kind === 'create' ? text(args.summary ?? args.title ?? '会议', 500) : args.summary === undefined ? null : text(args.summary, 500),
        start, end, timeZone: String(args.timeZone ?? saved.timeZone),
        attendees: [...new Set(args.attendees as string[] ?? [])].sort(),
        reminderMinutes: [...(args.reminderMinutes as number[] ?? (saved.kind === 'reminders' ? [] : [5]))].sort((a, b) => a - b),
        rrule: args.rrule ? String(args.rrule) : null, repeatScope: args.repeatScope ?? null, instanceStart: instant(args.instanceStart),
        effect: saved.kind === 'reminders' ? 'personal_reminder' : args.effect ?? 'whole_event', authorization: args._authorization ?? null };
      const original = { summary: saved.summary ?? null, start: instant(saved.start), end: instant(saved.end), timeZone: saved.timeZone,
        attendees: [...saved.attendees].sort(), reminderMinutes: [...saved.reminderMinutes].sort((a, b) => a - b),
        rrule: saved.rrule ?? null, repeatScope: saved.repeatScope ?? null, instanceStart: instant(saved.instanceStart), effect: saved.effect,
        authorization: old._authorization ?? null };
      return JSON.stringify(canonical(incoming)) === JSON.stringify(canonical(original));
    } catch { return false; }
  }

  private async writeFrozen(item: WorkItemRow, kind: CalendarMutation, id: string, params: Record<string, any>, previous: ActionOperationRow | null): Promise<unknown> {
    const target = params.sourceTarget as SourceTarget;
    const action = `${target.platform === 'wecom' ? 'wecom_calendar' : 'calendar'}.${kind}`;
    if (previous && previous.action !== action) throw unknown('原操作的渠道或动作与冻结来源不符。');
    const acknowledged = previous?.receipt && (previous.status === 'succeeded' || Object.hasOwn(previous.receipt, '_externalResult'));
    if (!acknowledged) {
      // Never create a new target after removal, identity changes, or an
      // unknown first attempt. Read-only verification cannot authorize replay.
      if (previous && ['running', 'unknown'].includes(previous.status)) throw unknown('原操作结果待核对，不能重复提交；请核验原日程后恢复。');
      await this.deps.registry.verify(target, kind === 'create' ? 'create' : 'read');
      if (kind !== 'create') await this.checkObject(kind, target, params);
    }
    const staged = await this.deps.external.stageWithId(id, item, action, params);
    let receipt: Record<string, any>;
    try {
      if (!staged.created && staged.row.status === 'succeeded') receipt = staged.row.receipt!;
      else {
        const response = await this.deps.external.perform(id, () => this.invoke(id, kind, target, params));
        const data = response.data, event = data?.event ?? data;
        const eventId = kind === 'create' ? target.platform === 'feishu' ? event?.event_id : data?.schedule_id : params.eventId;
        if (typeof eventId !== 'string' || !eventId) throw unknown('平台未返回真实日程标识；请核对原目标，不要重复创建。');
        receipt = { eventId, sourceId: target.sourceId, sourceName: params.sourceName, sourceTarget: target, calendarId: target.resource.id, channel: target.platform,
          kind, effect: kind === 'reminders' ? 'personal_reminder' : params.effect ?? 'whole_event', repeatScope: params.repeatScope ?? null,
          start: params.start ?? null, end: params.end ?? null, timeZone: params.timeZone, defaultsUsed: params.defaultsUsed ?? [],
          url: event?.app_link ?? event?.url ?? null, platformAccepted: true,
          acceptedAt: (await this.deps.repos().operations.get(id))?.receipt?._externalAcceptedAt ?? null };
        // perform() has already saved the raw acceptance. Local repair is
        // mandatory and uses that receipt under its original target even
        // when the source is subsequently removed; it never calls create.
        const observed = this.receiptItem(target, params, eventId, event);
        await this.deps.repos().sourceProjection.recordReceipt(id, target, observed);
        await this.deps.mirror?.(target, observed);
        await this.deps.repos().operations.update(id, { status: 'succeeded', receipt });
      }
    } catch (error) { await this.deps.external.fail(id, error); throw error; }
    const result = { operationId: id, reused: !!previous, ...receipt };
    let verification: Record<string, unknown>;
    try {
      // A recovered acknowledged operation may finish locally even after a
      // source change, but must not read the old object under a new identity.
      await this.deps.registry.verify(target, 'read');
      const observed = await this.deps.reader.object(target, receipt.eventId);
      await this.deps.repos().sourceProjection.observe(target, { state: 'partial', reason: '此记录只核验了单个对象，完整范围需查询日历',
        query: { from: observed.startTime!.toISOString(), to: observed.endTime!.toISOString() }, observedAt: new Date(), items: [observed] });
      await this.deps.mirror?.(target, observed);
      const differences: string[] = [];
      if (kind === 'cancel' && observed.active) differences.push('平台读取仍为有效日程');
      if (kind !== 'cancel' && !observed.active) differences.push('平台读取为已取消');
      if (params.summary !== undefined && observed.body.summary !== params.summary) differences.push('主题与本次请求不一致');
      // Both fixed adapters submit second-precision timestamps.
      if (params.start && Math.floor(Date.parse(String(observed.body.start)) / 1000) !== Math.floor(Date.parse(params.start) / 1000)) differences.push('开始时间与本次请求不一致');
      if (params.end && Math.floor(Date.parse(String(observed.body.end)) / 1000) !== Math.floor(Date.parse(params.end) / 1000)) differences.push('结束时间与本次请求不一致');
      if (kind === 'reminders' || kind === 'create') {
        const reminders = target.platform === 'feishu' ? observed.locator.reminders as { minutes: number }[] | null
          : (observed.locator.reminders as { is_remind?: boolean; reminder_time?: number[] } | null)?.is_remind === false ? []
            : (observed.locator.reminders as { reminder_time?: number[] } | null)?.reminder_time?.map(seconds => ({ minutes: -seconds / 60 }));
        if (!Array.isArray(reminders) || JSON.stringify(reminders.map(row => row.minutes).sort((a, b) => a - b)) !== JSON.stringify([...params.reminderMinutes].sort((a, b) => a - b))) differences.push('本人提醒设置与请求不一致或尚未返回');
      }
      verification = { state: differences.length ? 'conflict' : 'verified', differences, objectId: sourceObjectId(target, observed.nativeId),
        summary: observed.body.summary, start: observed.body.start, end: observed.body.end, active: observed.active, reminders: observed.locator.reminders,
        message: differences.length ? `平台已接收操作，回读差异：${differences.join('；')}` : '已读取原平台对象并核对本次变更' };
    } catch (error) { verification = { state: 'unverified', message: `平台已接收操作，后续读取尚未核验：${(error as Error).message}` }; }
    const invitation = kind === 'create' && params.attendees?.length ? await this.invite(item, id, target, receipt.eventId, params.attendees) : null;
    return { ...result, verification, invitation,
      message: `${target.platform === 'feishu' ? '飞书' : '企微'}已接收${kind === 'create' ? '创建' : kind === 'cancel' ? '取消' : kind === 'reminders' ? '本人提醒设置' : '修改'}，来源：${params.sourceName ?? target.sourceId}（${target.sourceId}）。${(params.defaultsUsed ?? []).join('；')}${invitation && invitation.state !== 'succeeded' ? ' 日程已创建，邀请尚未全部确认，请沿原操作接续。' : ''}` };
  }

  private receiptItem(target: SourceTarget, params: Record<string, any>, eventId: string, raw: any): ObservedSourceItem {
    const before = params.before as ObservedSourceItem | undefined;
    const mapped = target.platform === 'feishu' ? mapRemoteEvent(raw, params.timeZone, 'exclusive') : null;
    const start = mapped?.start ?? (params.start ? new Date(params.start) : before?.startTime ? new Date(before.startTime) : null);
    const end = mapped?.end ?? (params.end ? new Date(params.end) : before?.endTime ? new Date(before.endTime) : null);
    if (!start || !end || !(start < end)) throw new Error('原操作缺少可恢复的日程时间，请核对原回执。');
    const nativeId = before?.nativeId ?? JSON.stringify(target.platform === 'feishu' ? [raw?.organizer_calendar_id ?? target.resource.id, eventId] : ['schedule', eventId]);
    return { nativeId, locator: { ...before?.locator, calendarId: target.resource.id, eventId,
      url: mapped?.url ?? before?.locator.url ?? null, recurring: !!params.rrule || before?.body.recurring === true,
      ...(params.kind === 'reminders' || params.kind === 'create' ? { reminders: params.reminderMinutes.map((minutes: number) => ({ minutes })) } : {}) },
      body: { ...before?.body, summary: mapped?.summary || params.summary || before?.body.summary || '', start: start.toISOString(), end: end.toISOString(),
        allDay: mapped?.isAllDay ?? before?.body.allDay ?? false, timezone: params.timeZone, recurring: !!params.rrule || before?.body.recurring === true },
      roles: before?.roles ?? { complete: false, values: ['creator'], reason: '已确认创建回执；完整参与关系待原平台读取' }, capabilities: before?.capabilities ?? {},
      active: params.kind !== 'cancel', startTime: start, endTime: end };
  }

  private async prepare(kind: CalendarMutation, args: Record<string, unknown>): Promise<Record<string, any>> {
    const config = this.deps.config(), defaultsUsed: string[] = [];
    const timeZone = String(args.timeZone ?? config.timeZone);
    new Intl.DateTimeFormat('en', { timeZone }).format();
    let target: SourceTarget, eventId = String(args.eventId ?? '');
    if (kind === 'create') target = await this.target(args);
    else if (args._sourceTarget) {
      if (!eventId) throw new Error('原对象缺少事件标识，不能按当前默认猜测。');
      target = await this.target(args, 'read');
    } else {
      const locations = args.objectId ? await this.deps.repos().sourceProjection.locations(String(args.objectId)) : eventId ? await this.deps.repos().sourceProjection.calendarLocations(eventId) : [];
      if (args.objectId && eventId && !locations.some(row => row.locator.eventId === eventId)) throw new Error('objectId 与 eventId 指向不同日程，请核对原对象；未执行变更。');
      const sources = effectiveSources(config);
      const registered = await this.deps.registry.list();
      const selected = args.sourceId !== undefined ? selectSource(sources, 'calendar', { sourceId: String(args.sourceId) }).source.id : null;
      const valid = locations.filter(row => row.active && registered.entries.some(source => source.id === row.source_id && source.revision === row.registration_revision && sourceScopeFingerprint(source) === row.scope_hash)
        && (!selected || row.source_id === selected) && (!eventId || row.locator.eventId === eventId)
        && (!args.channel || row.platform === args.channel) && (!args.calendarId || row.locator.calendarId === args.calendarId));
      const destinations = new Set(valid.map(row => JSON.stringify([row.platform, row.identity_key, row.locator.calendarId, row.locator.eventId])));
      if (destinations.size > 1) throw new Error('该对象有多个操作来源或不同影响，请明确 sourceId 和取消／退出／仅提醒的范围；不会择可写来源执行。');
      if (valid[0]) { target = await this.target({ sourceId: valid[0].source_id }, 'read'); eventId = String(valid[0].locator.eventId); }
      else if (args.objectId) throw new Error('原对象来源已移除、变更或未核验，请先核对原关联。');
      else {
        const legacy = eventId ? await this.deps.repos().calendar.findEvent(eventId) : null;
        if (!eventId || (!args.sourceId && !args.calendarId && !legacy)) throw new Error('变更需要明确原对象及来源，请先查询日程。');
        target = await this.target({ ...args, ...(!args.sourceId && legacy ? { calendarId: legacy.calendar_id, channel: legacy.channel } : {}) }, 'read');
      }
    }
    const source = effectiveSources(config).entries.find(source => source.id === target.sourceId)!;
    if (source.access !== 'readwrite') throw new Error('原来源登记为只读，不能变更对象。');
    if (args.effect && !['whole_event', 'personal_reminder'].includes(String(args.effect))) throw new Error('本人退出尚未接通可靠的原生语义，请在原平台办理，不会将退出替换成删除。');
    if (args.effect === 'personal_reminder' && kind !== 'reminders') throw new Error('取消本人提醒须使用 calendar_reminders；不能删除业务会议。');
    const summary = kind === 'create' ? text(args.summary ?? args.title ?? '会议', 500) : args.summary !== undefined ? text(args.summary, 500) : undefined;
    if (kind === 'create' && args.summary === undefined && args.title === undefined) defaultsUsed.push('缺主题，使用“会议”');
    const start = args.start === undefined ? null : absoluteInstant(args.start);
    let end = args.end === undefined ? null : absoluteInstant(args.end);
    if (kind === 'create' && !start) throw new Error('请补充明确开始日期、时间和时区。');
    if (kind === 'create' && !end) {
      const duration = args.durationMinutes === undefined ? effectiveSources(config).meetingDurationMinutes : Number(args.durationMinutes);
      if (!Number.isInteger(duration) || Number(duration) < 1 || Number(duration) > 1440) throw new Error('请补充结束时间或会议时长；当前没有可用的默认时长。');
      end = new Date(start!.getTime() + Number(duration) * 60000);
      if (args.durationMinutes === undefined) defaultsUsed.push(`使用预设会议时长 ${duration} 分钟`);
    }
    if (start && end && end <= start) throw new Error('结束时间必须晚于开始时间。');
    if (kind === 'update' && !summary && !start && !end) throw new Error('需要明确要修改的标题或起止时间。');
    const attendees = args.attendees === undefined ? [] : args.attendees;
    if (!Array.isArray(attendees) || attendees.some(id => typeof id !== 'string' || !/^ou_[A-Za-z0-9_-]+$/.test(id)) || attendees.length > 1000) throw new Error('邀请需先将每位参会人解析为唯一飞书 open_id；没有猜测或发送邀请。');
    if (attendees.length && (!String(args.instruction ?? '').trim() || kind !== 'create')) throw new Error('邀请需要本人明确指令；本入口只在创建时添加指定参会人。');
    if (target.platform === 'wecom' && attendees.length) throw new Error('企微邀请适配尚未核验；本次未创建，请先明确仅占位或由本人在原平台邀请。');
    if (target.platform === 'wecom' && kind === 'reminders') throw new Error('当前企微修改接口未提供仅移除本人提醒的字段，请在原日程办理；未删除会议。');
    const reminderMinutes = args.reminderMinutes === undefined ? kind === 'reminders' ? null : [5] : args.reminderMinutes;
    if (!Array.isArray(reminderMinutes) || reminderMinutes.some(value => !Number.isInteger(value) || value < 0 || value > 20160)) throw new Error('提醒提前量须为分钟数组；清除本人提醒传空数组。');
    if (args.rrule && kind !== 'create') throw new Error('修改重复规则须在原平台核验，不能将普通改期扩展到整个系列。');
    return { sourceTarget: target, sourceName: source.name, channel: target.platform, calendarId: target.resource.id, receiptFormat: `${target.platform}-calendar-v1`, kind,
      eventId, summary, start: start?.toISOString(), end: end?.toISOString(), timeZone, defaultsUsed, attendees: [...new Set(attendees)],
      rrule: args.rrule ? String(args.rrule) : null, repeatScope: args.repeatScope ?? null,
      instanceStart: args.instanceStart === undefined ? null : absoluteInstant(args.instanceStart).toISOString(),
      effect: kind === 'reminders' ? 'personal_reminder' : 'whole_event', reminderMinutes };
  }

  private async checkObject(kind: CalendarMutation, target: SourceTarget, params: Record<string, any>): Promise<void> {
    const source = effectiveSources(this.deps.config()).entries.find(source => source.id === target.sourceId);
    if (source?.access !== 'readwrite') throw new Error('原来源已改为只读。');
    const object = await this.deps.reader.object(target, params.eventId);
    if (!object.active) throw new Error('原日程已取消；未重复写入。');
    if (object.body.recurring) {
      if (!(target.platform === 'wecom' ? ['this', 'future', 'all'] : ['this', 'all']).includes(params.repeatScope)) throw new Error('重复日程需明确本次或全系列；飞书本次及以后尚未接通，请在原平台办理。');
      if (target.platform === 'feishu' && params.repeatScope === 'all' && !String(params.eventId).endsWith('_0')) throw new Error('全系列变更需要查询并明确原系列 eventId；不会把实例自动扩大成全系列。');
      if (target.platform === 'feishu' && params.repeatScope === 'this' && String(params.eventId).endsWith('_0')) throw new Error('仅本次变更需要原生实例 eventId，不能使用系列标识。');
    }
    if (target.platform === 'wecom') {
      const originals = await this.deps.repos().operations.confirmedCalendarCreates(params.eventId);
      const owned = originals.some(row => {
        const original = row.params.sourceTarget as SourceTarget | undefined;
        return original?.platform === 'wecom' && original.sourceId === target.sourceId && original.identityKey === target.identityKey
          && original.registrationRevision === target.registrationRevision && original.resource.id === target.resource.id;
      });
      if (!owned) throw new Error('该企微对象缺少同一身份的原创建凭证，组织者与变更影响尚无法核验，请在原平台核对。');
      if (object.body.recurring && params.repeatScope !== 'all' && !params.instanceStart) throw new Error('企微重复日程的本次／以后操作需要明确原实例开始时间 instanceStart。');
    } else {
      const proof = await this.deps.registry.verify(target, kind === 'reminders' ? 'reminders' : kind as 'update' | 'cancel');
      if (proof.state !== 'verified' || object.capabilities[kind] !== 'allowed') throw new Error('原日程的对象权限或变更影响尚未核验，不会切换来源绕过权限。');
    }
    const start = params.start ? new Date(params.start) : object.startTime!, end = params.end ? new Date(params.end) : object.endTime!;
    if (!(start < end)) throw new Error('变更后的结束时间必须晚于开始时间。');
    params.before = JSON.parse(JSON.stringify(object));
  }

  private invoke(id: string, kind: CalendarMutation, target: SourceTarget, params: Record<string, any>): Promise<{ data: any }> {
    if (target.platform === 'wecom') {
      if (kind !== 'create') {
        const repeat_mod = params.repeatScope ? { repeat_edit_type: { this: 'this_only', future: 'this_and_future', all: 'all' }[params.repeatScope as 'this' | 'future' | 'all'],
          ...(params.instanceStart ? { repeat_event_time: wecomWallTime(new Date(params.instanceStart), params.timeZone) } : {}) } : undefined;
        const body = { schedule_id: params.eventId, ...(repeat_mod ? { repeat_mod } : {}),
          ...(kind === 'update' ? { ...(params.summary !== undefined ? { subject: params.summary } : {}),
            ...(params.start ? { begin_time: wecomWallTime(new Date(params.start), params.timeZone) } : {}), ...(params.end ? { end_time: wecomWallTime(new Date(params.end), params.timeZone) } : {}) } : {}) };
        return this.deps.wecom(['calendar', 'schedules', kind === 'cancel' ? 'cancel' : 'update', '--json', JSON.stringify(body)]);
      }
      const repeat = wecomRepeatRule(params.rrule);
      return this.deps.wecom(['calendar', 'schedules', 'create', '--subject', params.summary,
        '--begin-time', wecomWallTime(new Date(params.start), params.timeZone), '--end-time', wecomWallTime(new Date(params.end), params.timeZone),
        '--timezone', JSON.stringify({ timezone_id: params.timeZone }), '--reminders', JSON.stringify({ is_remind: params.reminderMinutes.length > 0, reminder_time: params.reminderMinutes.map((n: number) => -n * 60) }),
        ...(repeat ? ['--repeat-rule', JSON.stringify(repeat)] : [])]);
    }
    const base = ['calendar', 'events', kind === 'create' ? 'create' : kind === 'cancel' ? 'delete' : 'patch', '--as', 'user', '--calendar-id', target.resource.id];
    if (kind === 'cancel') return this.deps.lark([...base, '--event-id', params.eventId]);
    const time = (value: string) => ({ timestamp: String(Math.floor(Date.parse(value) / 1000)), timezone: params.timeZone });
    const body = kind === 'reminders' ? { reminders: params.reminderMinutes.map((minutes: number) => ({ minutes })) } : {
      ...(params.summary !== undefined ? { summary: params.summary } : {}), ...(params.start ? { start_time: time(params.start) } : {}), ...(params.end ? { end_time: time(params.end) } : {}),
      ...(kind === 'create' ? { reminders: params.reminderMinutes.map((minutes: number) => ({ minutes })), ...(params.rrule ? { recurrence: params.rrule } : {}) } : {}),
    };
    const key = hash(id), idempotency = `${key.slice(0, 8)}-${key.slice(8, 12)}-5${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20, 32)}`;
    return this.deps.lark([...base, ...(kind === 'create' ? ['--idempotency-key', idempotency] : ['--event-id', params.eventId]), '--data', JSON.stringify(body)]);
  }

  private async invite(item: WorkItemRow, operationId: string, target: SourceTarget, eventId: string, attendees: string[]): Promise<Record<string, unknown>> {
    const id = `${operationId}:invite`;
    try {
      const completed = await this.deps.repos().operations.get(id);
      if (completed?.status === 'succeeded') return { state: 'succeeded', operationId: id, reused: true, count: attendees.length };
      await this.deps.registry.verify(target, 'create');
      const staged = await this.deps.external.stageWithId(id, item, 'calendar.invite', { sourceTarget: target, eventId, attendees });
      if (!staged.created) return { state: 'succeeded', operationId: id, reused: true };
      const response = await this.deps.external.perform(id, () => this.deps.lark(['calendar', 'event.attendees', 'create', '--as', 'user', '--calendar-id', target.resource.id,
        '--event-id', eventId, '--user-id-type', 'open_id', '--data', JSON.stringify({ attendees: attendees.map(user_id => ({ type: 'user', user_id })), need_notification: true })]));
      const accepted = Array.isArray(response.data?.attendees) ? response.data.attendees.filter((row: any) => row.type === 'user' && row.attendee_id && row.rsvp_status !== 'removed').map((row: any) => row.user_id) : [];
      if (attendees.some(id => !accepted.includes(id))) throw unknown('邀请回执未覆盖全部指定参会人，请核对原会议参与人；不重复创建会议或盲重发邀请。');
      await this.deps.repos().operations.update(id, { status: 'succeeded', receipt: { eventId, attendees, sourceTarget: target } });
      return { state: 'succeeded', operationId: id, count: attendees.length };
    } catch (error) {
      const row: ActionOperationRow | null = await this.deps.repos().operations.get(id);
      if (row) await this.deps.external.fail(id, error);
      return { state: (error as { outcome?: string }).outcome === 'unknown' ? 'unknown' : 'failed', operationId: id, error: (error as Error).message };
    }
  }
}
