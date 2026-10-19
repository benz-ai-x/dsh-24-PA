// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';
import type { DataChannel } from './task.js';

export interface CalendarEventRow {
  event_id: string;
  calendar_id: string;
  summary: string;
  start_time: Date;
  end_time: Date;
  is_all_day: boolean;
  timezone: string | null;
  status: string;
  recurring: boolean;
  attendees: any;
  url: string | null;
  raw: any;
  synced_at: Date;
  /** F16: which channel owns this event; legacy rows read as 'feishu'. */
  channel: DataChannel;
}

export interface CalendarSyncRow {
  calendar_id: string;
  window_start: Date;
  window_end: Date;
  complete: boolean;
  last_synced_at: Date | null;
  last_error: string | null;
  /** F16: which channel produced this sync state. */
  channel: DataChannel;
}

export class CalendarRepo {
  constructor(private readonly db: PaDb) {}

  async upsertEvent(row: Omit<CalendarEventRow, 'synced_at' | 'channel'> & { synced_at?: Date; channel?: DataChannel }): Promise<CalendarEventRow> {
    const result = await this.db.query<CalendarEventRow>(
      `insert into pa24.calendar_event (event_id, calendar_id, summary, start_time, end_time, is_all_day, timezone, status, recurring, attendees, url, raw, synced_at, channel)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13)
       on conflict (event_id) do update set
         summary = excluded.summary,
         start_time = excluded.start_time,
         end_time = excluded.end_time,
         is_all_day = excluded.is_all_day,
         timezone = excluded.timezone,
         status = excluded.status,
         recurring = excluded.recurring,
         attendees = excluded.attendees,
         url = excluded.url,
         raw = excluded.raw,
         synced_at = now()
       where pa24.calendar_event.calendar_id = excluded.calendar_id and pa24.calendar_event.channel = excluded.channel
       returning *`,
      [row.event_id, row.calendar_id, row.summary, row.start_time, row.end_time, row.is_all_day, row.timezone, row.status, row.recurring,
       row.attendees === undefined ? null : JSON.stringify(row.attendees), row.url, row.raw === undefined ? null : JSON.stringify(row.raw), row.channel ?? 'feishu'],
    );
    if (!result.rows[0]) throw new Error('日程标识与已有归属冲突');
    return result.rows[0];
  }

  async markCanceledExcept(calendarId: string, liveEventIds: readonly string[], windowStart: Date, windowEnd: Date, channel: DataChannel = 'feishu'): Promise<void> {
    await this.db.query(
      `update pa24.calendar_event set status = 'canceled', synced_at = now()
       where calendar_id = $1 and channel = $5 and status = 'active'
         and not (end_time <= $2 or start_time >= $3)
         and event_id <> all($4::text[])`,
      [calendarId, windowStart, windowEnd, liveEventIds, channel],
    );
  }

  async observedIn(calendarId: string, from: Date, to: Date, channel: DataChannel): Promise<CalendarEventRow[]> {
    return (await this.db.query<CalendarEventRow>(
      'select * from pa24.calendar_event where calendar_id = $1 and channel = $4 and start_time < $3 and end_time > $2',
      [calendarId, from, to, channel],
    )).rows;
  }

  async eventsIn(calendarId: string, from: Date, to: Date): Promise<CalendarEventRow[]> {
    const result = await this.db.query<CalendarEventRow>(
      `select * from pa24.calendar_event
       where calendar_id = $1 and status = 'active' and start_time < $3 and end_time > $2
       order by start_time`,
      [calendarId, from, to],
    );
    return result.rows;
  }

  async markCanceled(eventId: string): Promise<void> {
    await this.db.query(`update pa24.calendar_event set status = 'canceled', synced_at = now() where event_id = $1`, [eventId]);
  }

  async findEvent(eventId: string): Promise<CalendarEventRow | null> {
    const result = await this.db.query<CalendarEventRow>('select * from pa24.calendar_event where event_id = $1', [eventId]);
    return result.rows[0] ?? null;
  }

  /**
   * Persist sync state. A failed sync advances the error/complete flags but
   * must NOT advance last_synced_at: that timestamp means "data current as
   * of", and a failure provides no such guarantee.
   */
  async saveSync(row: Omit<CalendarSyncRow, 'last_synced_at' | 'last_error' | 'channel'> & { lastError?: string; channel?: DataChannel }): Promise<void> {
    const ok = row.complete && !row.lastError;
    await this.db.query(
      `insert into pa24.calendar_sync_state (calendar_id, window_start, window_end, complete, last_synced_at, last_error, channel)
       values ($1,$2,$3,$4,${ok ? 'now()' : 'null'},$5,$6)
       on conflict (calendar_id) do update set
         window_start = excluded.window_start,
         window_end = excluded.window_end,
         complete = excluded.complete,
         last_synced_at = coalesce(excluded.last_synced_at, pa24.calendar_sync_state.last_synced_at),
         last_error = excluded.last_error
       where pa24.calendar_sync_state.channel = excluded.channel`,
      [row.calendar_id, row.window_start, row.window_end, row.complete, row.lastError ?? null, row.channel ?? 'feishu'],
    );
  }

  async getSync(calendarId: string): Promise<CalendarSyncRow | null> {
    const result = await this.db.query<CalendarSyncRow>('select * from pa24.calendar_sync_state where calendar_id = $1', [calendarId]);
    return result.rows[0] ?? null;
  }
}
