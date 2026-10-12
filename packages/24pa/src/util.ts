import { createHash } from 'node:crypto';

// Tiny shared helpers (F29): used by both the runtime and the handwriting
// pipeline — a leaf module so the two never import each other for values.

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export const nowIso = (): string => new Date().toISOString();

export const text = (value: unknown, max = 12000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`请输入 1–${max} 字的内容。`);
  return value.trim();
};

export const isoDate = (value: Date | string | null): string | null => (value == null ? null : new Date(value).toISOString());

export function parseDue(value: unknown): { dueAt: Date | null; dueHasTime: boolean; dueArg: string | null } {
  if (value == null || value === '') return { dueAt: null, dueHasTime: false, dueArg: null };
  const raw = String(value).trim();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`截止时间无法解析：${raw}`);
  const dueHasTime = /[:T]/.test(raw) || raw.toLowerCase().startsWith('+');
  return { dueAt: date, dueHasTime, dueArg: raw };
}

export function parseZonedRange(args: Record<string, unknown>): { from: Date; to: Date } {
  const from = new Date(String(args.from ?? ''));
  const to = new Date(String(args.to ?? ''));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    throw new Error('需要明确的时间范围（from/to，ISO 格式，to 晚于 from）。');
  }
  if (to.getTime() - from.getTime() > 62 * 24 * 3600 * 1000) {
    throw new Error('单次查询范围不能超过 62 天；请分段查询。');
  }
  return { from, to };
}

/** Stable fingerprint of a followed calendar event: identity + summary + start. */
export function eventFingerprint(event: { event_id: string; summary: string; start_time: Date }): string {
  return hash(`${event.event_id}\n${event.summary}\n${isoDate(event.start_time) ?? ''}`);
}
