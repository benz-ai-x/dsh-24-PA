import { Temporal } from '@js-temporal/polyfill';
import { localDay } from './calendar-time.js';

/** The immutable reporting range of one admitted run, independent of query time. */
export interface DigestPeriod {
  kind: string;
  timeZone: string;
  anchorAt: string;
  from: string;
  to: string;
  localFrom: string;
  localTo: string;
  nextTo?: string;
  source: 'schedule' | 'manual';
}

export function digestPeriod(kind: string, timeZone: string, anchor: Date, source: DigestPeriod['source']): DigestPeriod {
  const day = localDay(anchor, timeZone);
  const date = Temporal.PlainDate.from(day.date);
  const first = kind === 'weekly' ? date.subtract({ days: date.dayOfWeek - 1 }) : date;
  const end = first.add({ days: kind === 'weekly' ? 7 : 1 });
  return { kind, timeZone, source, anchorAt: anchor.toISOString(),
    from: localDay(first.toString(), timeZone).from.toISOString(), to: localDay(end.toString(), timeZone).from.toISOString(),
    localFrom: first.toString(), localTo: end.toString(),
    ...(kind === 'weekly' ? { nextTo: localDay(end.add({ days: 7 }).toString(), timeZone).from.toISOString() } : {}),
  };
}
