import type { DigestDeps } from './digest-service.js';
import type { WorkItemRow } from './repo.js';
import { absoluteInstant, localDay, localInstant } from './calendar-time.js';
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
    const tasks = (await this.deps.repos().tasks.list()).filter(t => t.status !== 'completed').slice(0, 5);
    return { date: day.date, fresh: day.sync.ok, busy, bufferMinutesPerMeeting: await this.bufferMinutes(),
      candidateBlocks: tasks.map((task, index) => ({ task: task.summary, suggestedStart: localInstant(day.date, `${9 + index}:00:00`.padStart(8, '0'), this.deps.config().timeZone).toISOString(), minutes: task.estimate_minutes ?? 60 })),
      message: '候选时间块仅为建议；用 plan_adopt 采纳选定项（写入前会重新同步复核）。' };
  }

  private block(block: Record<string, unknown>) {
    const start = absoluteInstant(block.start), end = absoluteInstant(block.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('时间块无效（需要 start/end，end 晚于 start）。');
    return { summary: String(block.summary ?? ''), start, end };
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
    const results: { index: number; ok: boolean; error?: string; skipped?: string }[] = [];
    for (const [index, block] of blocks.entries()) {
      if (!fresh) { results.push({ index, ok: false, error: '日历同步不完整，无法确认选定时间块的冲突；请重新同步后重试。' }); continue; }
      const clash = busy.find(e => e.start < block.end && block.start < e.end);
      if (clash) { results.push({ index, ok: false, skipped: 'conflict', error: `复核发现与现有安排「${clash.summary}」重叠，未写入。` }); continue; }
      try {
        const created = await this.deps.calendarWrite(item, 'create', { summary: block.summary, start: block.start.toISOString(), end: block.end.toISOString(), calendarId });
        busy.push(block);
        results.push({ index, ok: true, ...(created as object) });
      } catch (error) { results.push({ index, ok: false, error: (error as Error).message }); }
    }
    const adopted = results.filter(r => r.ok).length;
    return { fresh, adopted, failed: results.length - adopted, results,
      message: `已按你的选择写入 ${adopted} 项，${results.length - adopted} 项未写入（明细含复核冲突与错误）；失败项核对后可重试。` };
  }
}
