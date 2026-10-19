import type { DigestDeps } from './digest-service.js';
import type { WorkItemRow } from './repo.js';
import { absoluteInstant, localDay, localInstant } from './calendar-time.js';
import { hash, text } from './util.js';
import { WECOM_CALENDAR_ID } from './wecom-channels.js';

/** One observation of the owner's local day and one evolving busy set for
 * each adoption batch. External writes retain the channel's durable receipts. */
export class DailyPlanning {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: Pick<DigestDeps, 'config' | 'repos' | 'memory' | 'syncCalendarWindow' | 'calendarWrite'>) {}

  calendarId(requested?: unknown): string {
    return this.deps.config().calendarChannel === 'wecom' ? WECOM_CALENDAR_ID : String(requested ?? this.deps.config().calendarId);
  }

  async observe(input: string | Date, addDays = 0) {
    const day = localDay(input, this.deps.config().timeZone, addDays);
    const calendarId = this.calendarId();
    const sync = await this.deps.syncCalendarWindow(calendarId, day.from, day.to).catch(error => ({ ok: false, error: (error as Error).message }));
    const events = await this.deps.repos().calendar.eventsIn(calendarId, day.from, day.to);
    return { ...day, calendarId, sync, events };
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
    const busy = day.events.map(e => ({ summary: e.summary,
      start: new Date(Math.max(e.start_time.getTime(), day.from.getTime())).toISOString(),
      end: new Date(Math.min(e.end_time.getTime(), day.to.getTime())).toISOString() }));
    if (args.insert) {
      const block = this.block(args.insert as Record<string, unknown>);
      const displaced = busy.filter(b => Date.parse(b.start) < block.end.getTime() && block.start.getTime() < Date.parse(b.end));
      return { date: day.date, fresh: day.sync.ok, busy,
        insert: { start: block.start.toISOString(), end: block.end.toISOString() }, displacedByInsert: displaced,
        suggestions: displaced.map(d => `将「${d.summary}」改期到插单后，或压缩该时段`),
        message: displaced.length ? `插单与 ${displaced.length} 项现有安排重叠；未受影响安排不动；采纳仍需明确选定。` : '插单时段无已知冲突；采纳前会重新同步复核。' };
    }
    const tasks = (await this.deps.repos().tasks.list()).filter(t => t.status === 'open').slice(0, 5);
    return { date: day.date, fresh: day.sync.ok, busy, bufferMinutesPerMeeting: await this.bufferMinutes(),
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
      const sync = await this.deps.syncCalendarWindow(calendarId, window.from, window.to).catch(() => ({ ok: false }));
      fresh &&= sync.ok;
      busy.push(...(await this.deps.repos().calendar.eventsIn(calendarId, window.from, window.to)).map(e => ({ summary: e.summary, start: e.start_time, end: e.end_time })));
    }
    const operations = this.deps.repos().operations;
    const channel = this.deps.config().calendarChannel ?? 'feishu';
    const uncertain = (await operations.unresolvedCalendarCreates()).filter(op =>
      (op.params.planningChannel ?? op.params.channel ?? 'feishu') === channel &&
      String(op.params.planningCalendarId ?? op.params.calendarId ?? (channel === 'wecom' ? WECOM_CALENDAR_ID : '')) === calendarId);
    const unknownBusy = uncertain.map(op => ({ id: op.id, summary: String(op.params.summary), start: new Date(String(op.params.start)), end: new Date(String(op.params.end)) }));
    const results: { index: number; ok: boolean; outcome: 'succeeded' | 'failed' | 'unknown' | 'conflict'; operationId?: string; error?: string; skipped?: string }[] = [];
    for (const [index, block] of blocks.entries()) {
      const operationId = `plan_adopt:${item.id}:${hash(JSON.stringify({ requestedCalendar: args.calendarId ?? null, summary: block.summary, start: block.start.toISOString(), end: block.end.toISOString() }))}`;
      const previous = await operations.get(operationId);
      if (previous?.status === 'succeeded') {
        busy.push(block); results.push({ index, ok: true, outcome: 'succeeded', operationId, ...previous.receipt }); continue;
      }
      if (previous && (previous.params.planningChannel !== channel || previous.params.planningCalendarId !== calendarId || previous.params.planningTimeZone !== timeZone)) {
        results.push({ index, ok: false, outcome: 'unknown', operationId, error: '原采纳操作的日历归属或时区已改变，请恢复原设置并核对原操作，不能改投。' }); continue;
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
        const created = await this.deps.calendarWrite(item, 'create', { summary: block.summary, start: block.start.toISOString(), end: block.end.toISOString(), calendarId, channel, timeZone,
          _authorization: { planningChannel: channel, planningCalendarId: calendarId, planningTimeZone: timeZone, origin: 'plan_adopt', instruction: item.instruction } }, operationId);
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
