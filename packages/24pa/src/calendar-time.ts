import { Temporal } from '@js-temporal/polyfill';

export function localDay(input: string | Date, timeZone: string, addDays = 0) {
  const date = (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? Temporal.PlainDate.from(input, { overflow: 'reject' })
    : Temporal.Instant.from(input instanceof Date ? input.toISOString() : input).toZonedDateTimeISO(timeZone).toPlainDate()).add({ days: addDays });
  return { date: date.toString(),
    from: new Date(date.toZonedDateTime(timeZone).epochMilliseconds),
    to: new Date(date.add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds) };
}

/** Match the host: reject a nonexistent wall time; choose the earlier overlap. */
export function localInstant(date: string, time: string, timeZone: string): Date {
  const local = Temporal.PlainDateTime.from(`${date}T${time}`, { overflow: 'reject' });
  const zoned = local.toZonedDateTime(timeZone, { disambiguation: 'earlier' });
  if (!zoned.toPlainDateTime().equals(local)) throw new Error('该本地时刻因时区切换不存在，请另选时间。');
  return new Date(zoned.epochMilliseconds);
}

export function absoluteInstant(input: unknown): Date {
  return new Date(Temporal.Instant.from(String(input ?? '')).epochMilliseconds);
}
