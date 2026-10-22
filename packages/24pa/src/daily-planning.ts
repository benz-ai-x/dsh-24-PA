import type { DigestDeps } from './digest-service.js';
import type { WorkItemRow } from './repo.js';
import { absoluteInstant, localDay, localInstant } from './calendar-time.js';
import { hash, text } from './util.js';
import { WECOM_CALENDAR_ID } from './wecom-channels.js';
import { effectiveSources, selectSource } from './source-config.js';
import type { SourceTarget } from './source-registry.js';

/** One observation of the owner's local day and one evolving busy set for
 * each adoption batch. External writes retain the channel's durable receipts. */
export class DailyPlanning {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: Pick<DigestDeps, 'config' | 'repos' | 'memory' | 'syncCalendarWindow' | 'calendarWrite' | 'queryCalendar' | 'bindCalendar'>) {}

  calendarId(requested?: unknown): string {
    return this.deps.config().calendarChannel === 'wecom' ? WECOM_CALENDAR_ID : String(requested ?? this.deps.config().calendarId);
  }

  async observe(input: string | Date, addDays = 0) {
    const day = localDay(input, this.deps.config().timeZone, addDays);
    return { ...day, ...await this.observeRange(day.from, day.to) };
  }

  async observeRange(from: Date, to: Date) {
    if (this.deps.queryCalendar) {
      try {
        const result = await this.deps.queryCalendar({ from: from.toISOString(), to: to.toISOString() });
        const times = result.sources.map(row => row.checkedAt).filter((value): value is string => !!value).sort();
        return { sync: { ok: result.fresh && !result.hasMore, error: result.fresh ? undefined : result.sources.filter(row => !row.fresh).map(row => `${row.name}：${row.reason ?? row.state}`).join('；') || result.message },
          syncedAt: times[0] ?? null, sources: result.sources,
          events: result.events.map(event => ({ summary: event.summary, start_time: new Date(event.start), end_time: new Date(event.end), is_all_day: event.allDay,
            freeBusy: event.freeBusy, sources: event.locations.map(location => location.sourceName) })) };
      } catch (error) {
        return { sync: { ok: false, error: (error as Error).message }, syncedAt: null, sources: [], events: [] };
      }
    }
    // Compatibility seam for embedders that have not supplied multi-source
    // queries. The product runtime always supplies queryCalendar.
    const calendarId = this.calendarId();
    const sync = await this.deps.syncCalendarWindow(calendarId, from, to).catch(error => ({ ok: false, error: (error as Error).message }));
    const events = await this.deps.repos().calendar.eventsIn(calendarId, from, to);
    const state = await this.deps.repos().calendar.getSync(calendarId);
    return { sync, syncedAt: state?.last_synced_at?.toISOString() ?? null, sources: [], events: events.map(event => ({ ...event, freeBusy: 'busy', sources: [calendarId] })) };
  }

  async bufferMinutes(): Promise<number> {
    try {
      const memory = await this.deps.memory()?.search({ topic: '工作偏好', limit: 20 });
      for (const record of memory?.records ?? []) {
        if (record.status !== 'confirmed') continue;
        const match = record.content.match(/会议之间(?:留|间隔)\s*(\d+)\s*分钟/);
        if (match) return Number(match[1]);
      }
    } catch { /* Missing preference does not invent a buffer. */ }
    return 0;
  }

  async preview(args: Record<string, unknown>): Promise<unknown> {
    const day = await this.observe(args.date ? String(args.date) : new Date(), args.date ? 0 : 1);
    const busy = day.events.filter(e => e.freeBusy !== 'free').map(e => ({ summary: e.summary,
      start: new Date(Math.max(e.start_time.getTime(), day.from.getTime())).toISOString(),
      end: new Date(Math.min(e.end_time.getTime(), day.to.getTime())).toISOString() }));
    if (args.insert) {
      const block = this.block(args.insert as Record<string, unknown>);
      const displaced = busy.filter(b => Date.parse(b.start) < block.end.getTime() && block.start.getTime() < Date.parse(b.end));
      return { date: day.date, fresh: day.sync.ok, sources: day.sources, missing: day.sync.error, busy,
        insert: { start: block.start.toISOString(), end: block.end.toISOString() }, displacedByInsert: displaced,
        suggestions: displaced.map(d => `将「${d.summary}」改期到插单后，或压缩该时段`),
        message: displaced.length ? `插单与 ${displaced.length} 项现有安排重叠；未受影响安排不动；采纳仍需明确选定。` : '插单时段无已知冲突；采纳前会重新同步复核。' };
    }
    const tasks = (await this.deps.repos().tasks.list()).filter(t => t.status === 'open').slice(0, 5);
    return { date: day.date, fresh: day.sync.ok, sources: day.sources, missing: day.sync.error, busy, bufferMinutesPerMeeting: await this.bufferMinutes(),
      candidateBlocks: tasks.map((task, index) => ({ task: task.summary, suggestedStart: localInstant(day.date, `${9 + index}:00:00`.padStart(8, '0'), this.deps.config().timeZone).toISOString(), minutes: task.estimate_minutes ?? 60 })),
      message: '候选时间块仅为建议；用 plan_adopt 采纳选定项（写入前会重新同步复核）。' };
  }

  private block(block: Record<string, unknown>) {
    const start = absoluteInstant(block.start), end = absoluteInstant(block.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('时间块无效（需要 start/end，end 晚于 start）。');
    const summary = text(block.summary, 500); if (!summary) throw new Error('时间块需要标题。');
    return { summary, start, end };
  }

  adopt(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const result = this.serial.then(() => this.adoptBatch(item, args));
    this.serial = result.catch(() => {});
    return result;
  }

  private async adoptBatch(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    if (!Array.isArray(args.blocks) || !args.blocks.length) throw new Error('需要选定要写入的时间块（blocks[]）。');
    const blocks = args.blocks.map(block => this.block(block as Record<string, unknown>));
    const calendarId = this.calendarId(args.calendarId), timeZone = this.deps.config().timeZone;
    const windows = new Map<string, { from: Date; to: Date }>();
    for (const block of blocks) {
      for (let day = localDay(block.start, timeZone); day.from < block.end; day = localDay(day.date, timeZone, 1)) windows.set(day.date, day);
    }
    const busy: { summary: string; start: Date; end: Date }[] = [];
    let fresh = true;
    for (const window of windows.values()) {
      const observation = await this.observeRange(window.from, window.to);
      fresh &&= observation.sync.ok;
      busy.push(...observation.events.filter(event => event.freeBusy !== 'free').map(e => ({ summary: e.summary, start: e.start_time, end: e.end_time })));
    }
    const operations = this.deps.repos().operations;
    const historical = await operations.calendarCreatesForWork(item.id);
    const channel = this.deps.config().calendarChannel ?? 'feishu';
    const uncertain = (await operations.unresolvedCalendarCreates()).filter(op => this.deps.queryCalendar || (
      (op.params.planningChannel ?? op.params.channel ?? 'feishu') === channel &&
      String(op.params.planningCalendarId ?? op.params.calendarId ?? (channel === 'wecom' ? WECOM_CALENDAR_ID : '')) === calendarId));
    const unknownBusy = uncertain.map(op => ({ id: op.id, summary: String(op.params.summary), start: new Date(String(op.params.start)), end: new Date(String(op.params.end)) }));
    const results: { index: number; ok: boolean; outcome: 'succeeded' | 'failed' | 'unknown' | 'conflict'; operationId?: string; error?: string; skipped?: string }[] = [];
    for (const [index, block] of blocks.entries()) {
      let operationId = `plan_adopt:${item.id}:${hash(JSON.stringify({ requestedCalendar: args.calendarId ?? null, summary: block.summary, start: block.start.toISOString(), end: block.end.toISOString(),
        ...(args.sourceId !== undefined ? { sourceId: args.sourceId } : {}), ...(args.company !== undefined ? { company: args.company } : {}), ...(args.project !== undefined ? { project: args.project } : {}) }))}`;
      let previous = await operations.get(operationId);
      // Recover the stored identity across old channel keys and equivalent
      // omitted/explicit calendar arguments; the target check below still applies.
      const candidates = !previous ? historical.filter(op => (op.id.startsWith(`${op.action}:${item.id}:`) || op.id.startsWith(`plan_adopt:${item.id}:`) || op.id.startsWith(`source-calendar:create:${item.id}:`)) &&
        op.params.summary === block.summary && Date.parse(op.params.start) === block.start.getTime() && Date.parse(op.params.end) === block.end.getTime()) : [];
      if (candidates.length > 1) { results.push({ index, ok: false, outcome: 'unknown', error: '同一时间块有多个历史操作身份，请逐一核对，不能新建或猜测重试。' }); continue; }
      if (candidates[0]) { previous = candidates[0]; operationId = previous.id; }
      const legacyKey = channel === 'wecom'
        ? `wecom\ncreate\n\n${block.summary}\n${block.start.toISOString()}\n${block.end.toISOString()}\n${timeZone}\nnull`
        : `${calendarId}\ncreate\n\n${block.summary}\n${block.start.toISOString()}\n${block.end.toISOString()}\n\n\n`;
      const legacyMatches = candidates.length === 1 && operationId === `${channel === 'wecom' ? 'wecom_calendar' : 'calendar'}.create:${item.id}:${hash(legacyKey)}`;
      const frozen = previous?.params.sourceTarget as SourceTarget | undefined;
      let targetMismatch = false;
      if (frozen) {
        const configured = effectiveSources(this.deps.config()).entries.find(source => source.id === frozen.sourceId);
        targetMismatch = previous!.params.timeZone !== timeZone || (!!args.channel && args.channel !== frozen.platform)
          || (!!args.calendarId && args.calendarId !== frozen.resource.id && args.calendarId !== configured?.resourceId && !(args.calendarId === 'wecom' && frozen.platform === 'wecom'));
        if (args.sourceId !== undefined || args.company !== undefined || args.project !== undefined) {
          try { targetMismatch ||= selectSource(effectiveSources(this.deps.config()), 'calendar', args as { sourceId?: string; company?: string; project?: string }, false).source.id !== frozen.sourceId; }
          catch { targetMismatch = true; }
        }
      }
      if (previous && (targetMismatch || (!frozen && !legacyMatches && (previous.params.planningChannel !== channel || previous.params.planningCalendarId !== calendarId || previous.params.planningTimeZone !== timeZone)))) {
        results.push({ index, ok: false, outcome: 'unknown', operationId, error: '原采纳操作的日历归属或时区已改变，请恢复原设置并核对原操作，不能改投。' }); continue;
      }
      if (previous?.status === 'succeeded') {
        busy.push(block); results.push({ index, ok: true, outcome: 'succeeded', operationId, ...previous.receipt }); continue;
      }
      // An acknowledged result only needs local repair; the projected event
      // itself must not block that repair. The channel never sends it again.
      const confirmed = previous?.receipt?._externalResult !== undefined;
      const unresolvedOwn = previous && ['running', 'unknown'].includes(previous.status);
      if (!fresh && !confirmed) { results.push({ index, ok: false, outcome: unresolvedOwn ? 'unknown' : 'failed', operationId, error: '日历同步不完整，无法确认冲突；已有未知操作保持待核对，请恢复同步后沿原操作续办。' }); continue; }
      const unresolved = unknownBusy.find(e => e.id !== operationId && e.start < block.end && block.start < e.end);
      if (!confirmed && unresolved) {
        results.push({ index, ok: false, outcome: 'conflict', skipped: 'unknown_conflict', error: `「${unresolved.summary}」写入结果待核对，保留该时段占用；本项未写入。` }); continue;
      }
      const clash = busy.find(e => e.start < block.end && block.start < e.end);
      if (!confirmed && !unresolvedOwn && clash) { results.push({ index, ok: false, outcome: 'conflict', skipped: 'conflict', error: `复核发现与现有安排「${clash.summary}」重叠，未写入。` }); continue; }
      try {
        const target = !previous && this.deps.bindCalendar ? await this.deps.bindCalendar(args) : frozen;
        const destination = target ? { sourceId: target.sourceId, _sourceTarget: target, calendarId: target.resource.id, channel: target.platform } : { calendarId, channel };
        const request = previous?.params.sourceContract === 1 ? previous.params.request : { summary: block.summary, start: block.start.toISOString(), end: block.end.toISOString(), ...destination, timeZone,
          _authorization: { planningChannel: destination.channel, planningCalendarId: destination.calendarId, planningTimeZone: timeZone, origin: 'plan_adopt', instruction: item.instruction } };
        const created = await this.deps.calendarWrite(item, 'create', request, operationId);
        busy.push(block);
        results.push({ index, ok: true, outcome: 'succeeded', ...(created as object) });
      } catch (error) {
        const durable = await operations.get(operationId);
        const unknown = (error as { outcome?: string }).outcome === 'unknown' || ['running', 'unknown'].includes(durable?.status ?? '') || durable?.receipt?._externalResult !== undefined;
        if (unknown) unknownBusy.push({ id: operationId, ...block });
        results.push({ index, ok: false, outcome: unknown ? 'unknown' : 'failed', operationId, error: (error as Error).message });
      }
    }
    const adopted = results.filter(r => r.ok).length;
    const unknown = results.filter(r => r.outcome === 'unknown').length, failed = results.length - adopted - unknown;
    return { fresh, adopted, failed, unknown, results,
      message: `已确认写入 ${adopted} 项，${unknown} 项结果待核对，${failed} 项未写入（明细含冲突与确定失败）；待核对时段继续保留占用，核对后沿原操作续办。` };
  }
}
