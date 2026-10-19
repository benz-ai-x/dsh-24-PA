import type { CalendarEventRow, CalendarRepo } from './repo.js';
import { eventFingerprint } from './util.js';

type ObservedEvent = Omit<CalendarEventRow, 'synced_at'>;
export interface CalendarScope { calendarId: string; channel: 'feishu' | 'wecom'; from: Date; to: Date }

/** Only a fully decoded observation may invalidate sources. Notifications
 * precede projection replacement so a failed correction remains retryable. */
export async function observeCalendar(
  repo: CalendarRepo,
  notify: (sourceType: 'calendar', sourceId: string, fingerprint: string | null) => Promise<void>,
  scope: CalendarScope,
  fetch: () => Promise<ObservedEvent[]>,
): Promise<{ ok: boolean; error?: string }> {
  const state = { calendar_id: scope.calendarId, channel: scope.channel, window_start: scope.from, window_end: scope.to };
  try {
    if (!(scope.from < scope.to)) throw new Error('日历观察窗口无效');
    const events = await fetch();
    const ids = new Set<string>();
    // Validate the entire batch before publishing any local effect.
    for (const event of events) {
      if (!event.event_id || ids.has(event.event_id) || !(event.start_time < event.end_time)) throw new Error('日历条目缺失、重复或时间无效');
      ids.add(event.event_id);
      const existing = await repo.findEvent(event.event_id);
      if (existing && (existing.channel !== scope.channel || existing.calendar_id !== scope.calendarId)) throw new Error('日程标识与已有归属冲突');
      // Older Feishu writes stored the owner's unprefixed title while the
      // confirmed receipt already contained our [24PA] prefix. Preserve that
      // existing fingerprint only when the stored receipt proves equivalence;
      // any actual remote rename or time change still invalidates the source.
      if (existing && scope.channel === 'feishu' && existing.raw?.summary === `[24PA] ${existing.summary}` && event.summary === existing.raw.summary) {
        event.summary = existing.summary;
      }
    }
    const prior = await repo.observedIn(scope.calendarId, scope.from, scope.to, scope.channel);
    for (const event of events) {
      const existing = await repo.findEvent(event.event_id);
      const fingerprint = event.status === 'canceled' ? null : eventFingerprint(event);
      if (existing && (fingerprint === null || existing.status !== event.status || eventFingerprint(existing) !== fingerprint)) await notify('calendar', event.event_id, fingerprint);
      await repo.upsertEvent(event);
    }
    const live = events.filter(e => e.status !== 'canceled').map(e => e.event_id);
    for (const event of prior) if (!ids.has(event.event_id)) await notify('calendar', event.event_id, null);
    await repo.markCanceledExcept(scope.calendarId, live, scope.from, scope.to, scope.channel);
    await repo.saveSync({ ...state, complete: true });
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message;
    await repo.saveSync({ ...state, complete: false, lastError: message }).catch(() => {});
    return { ok: false, error: message };
  }
}
