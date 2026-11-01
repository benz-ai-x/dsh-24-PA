import { absoluteInstant, localDay } from './calendar-time.js';
import type { PlanningReference, PlanningWindow, WorkPlanItem } from './work-planning-model.js';

export function planningObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('规划参数必须是对象。');
  return value as Record<string, unknown>;
}
export function planningText(value: unknown, label: string, max = 1200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}须为 1–${max} 字符。`);
  return value.trim();
}
export function planningList(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`规划列表最多 ${max} 项。`);
  return value;
}
export function planningRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('请提供读取到的 expectedRevision（新记录为 0）。');
  return Number(value);
}
export function planningDate(value: unknown, timeZone: string): string {
  if (value === undefined) return localDay(new Date(), timeZone).date;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('工作日期须为 YYYY-MM-DD。');
  const day = localDay(value, timeZone);
  if (day.date !== value) throw new Error('工作日期无效。');
  return value;
}
export function planningWindows(value: unknown, date: string, timeZone: string): PlanningWindow[] {
  const day = localDay(date, timeZone);
  const windows = planningList(value ?? [], 8).map(raw => {
    const row = planningObject(raw), start = absoluteInstant(String(row.start)), end = absoluteInstant(String(row.end));
    if (start < day.from || end > day.to || end <= start) throw new Error('工作时段须位于指定日期内且结束晚于开始。');
    return { start: start.toISOString(), end: end.toISOString() };
  }).sort((a, b) => a.start.localeCompare(b.start));
  if (windows.some((window, index) => index > 0 && window.start < windows[index - 1]!.end)) throw new Error('工作时段不能重叠。');
  return windows;
}
export const overlaps = (a: PlanningWindow, b: PlanningWindow) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

/** Subtract the union of busy intervals; overlapping meetings are not counted twice. */
export function freePlanningWindows(windows: PlanningWindow[], busy: PlanningWindow[]): PlanningWindow[] {
  return windows.flatMap(window => {
    let free = [window];
    for (const event of busy) free = free.flatMap(part => {
      if (!overlaps(part, event)) return [part];
      const result: PlanningWindow[] = [];
      if (Date.parse(part.start) < Date.parse(event.start)) result.push({ start: part.start, end: event.start });
      if (Date.parse(event.end) < Date.parse(part.end)) result.push({ start: event.end, end: part.end });
      return result;
    });
    return free;
  });
}

export function planningAvailability(windows: PlanningWindow[], events: (PlanningWindow & { freeBusy: string })[], fresh: boolean, bufferMinutes = 0, now = new Date()) {
  const remaining = windows.filter(window => Date.parse(window.end) > now.getTime())
    .map(window => ({ start: new Date(Math.max(Date.parse(window.start), now.getTime())).toISOString(), end: window.end }));
  const busy = events.filter(event => event.freeBusy !== 'free').map(event => ({
    start: new Date(Date.parse(event.start) - bufferMinutes * 60000).toISOString(), end: new Date(Date.parse(event.end) + bufferMinutes * 60000).toISOString(),
  }));
  const free = fresh ? freePlanningWindows(remaining, busy) : [];
  return { free, capacityMinutes: windows.length && fresh ? free.reduce((sum, window) => sum + (Date.parse(window.end) - Date.parse(window.start)) / 60000, 0) : null };
}

export function planningItems(value: unknown): WorkPlanItem[] {
  const items = planningList(value, 3).map(raw => {
    const row = planningObject(raw);
    const estimate = row.estimateMinutes ?? null;
    if (estimate !== null && (!Number.isSafeInteger(estimate) || Number(estimate) < 1 || Number(estimate) > 1440)) throw new Error('估时须为 1–1440 分钟；未知填 null。');
    if (!!row.start !== !!row.end) throw new Error('候选时间块需要完整的 start/end。');
    const start = row.start ? absoluteInstant(String(row.start)).toISOString() : null;
    const end = row.end ? absoluteInstant(String(row.end)).toISOString() : null;
    if (start && end && (Date.parse(end) <= Date.parse(start) || estimate === null || Date.parse(end) - Date.parse(start) < Number(estimate) * 60000)) throw new Error('候选时间块必须容纳明确的估时。');
    return {
      id: planningText(row.id, '重点编号', 100), title: planningText(row.title, '重点标题', 300),
      outcome: planningText(row.outcome, '预期成果'), reason: planningText(row.reason, '优先理由'), nextAction: planningText(row.nextAction, '下一步'),
      focusId: row.focusId ? planningText(row.focusId, '近期重点编号', 100) : null,
      references: planningList(row.references ?? [], 12).map((reference): PlanningReference => {
        const ref = planningObject(reference);
        if (ref.kind !== 'todo' && ref.kind !== 'work') throw new Error('关联来源只能是 todo 或 work。');
        return { kind: ref.kind, id: planningText(ref.id, '来源编号', 500) };
      }), estimateMinutes: estimate as number | null, start, end,
    };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('今日重点编号不能重复。');
  return items;
}
