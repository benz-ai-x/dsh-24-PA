// F45: clock reminders belong to native calendars; the ledger is a backup.
import { ReminderError, firstOccurrence } from './reminders.js';
import {
  createDailyScheduleRecord,
  createWeeklyScheduleRecord,
  ScheduleId,
} from '@deepseek-ai/dsh-schedule';
import { text, hash } from './util.js';
import type { PaConfig } from './config.js';
import type { Repos, WorkItemRow } from './repo.js';
import type { ReminderEngine } from './reminders.js';
import type { SourceTarget } from './source-registry.js';

export interface ReminderRouterDeps {
  config(): PaConfig;
  repos(): Repos;
  /** Channel-dispatching calendar write (routes wecom/feishu in the runtime). */
  calendarWrite(item: WorkItemRow, kind: 'create' | 'update' | 'cancel', args: Record<string, unknown>, operationId?: string): Promise<unknown>;
  bindCalendar?(args: Record<string, unknown>): Promise<SourceTarget>;
  /** Lazy: repos/engine bind at workspace load, after the router is built. */
  ledger(): ReminderEngine;
}

export class ReminderRouter {
  constructor(private readonly deps: ReminderRouterDeps) {}

  /** No public route may start the retired F05 timer. */
  async route(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    if (args.__forceLedger || args.linkTaskGuid || args.linkEventId || !['once', 'daily', 'weekly'].includes(String(args.kind ?? 'once'))) {
      throw new ReminderError('旧账本提醒引擎已退役；时钟提醒支持 once/daily/weekly，条件或来源跟进请使用智能任务 skill（等待回复可用 waiting_create）。');
    }
    return this.toCalendar(item, args);
  }

  private intentId(item: WorkItemRow, args: Record<string, unknown>): string {
    return `reminder.calendar:${item.id}:${hash(JSON.stringify({ kind: args.kind ?? 'once', text: text(args.text, 500), at: args.at ?? null, afterSeconds: args.afterSeconds ?? null, time: args.time ?? null, weekdays: Array.isArray(args.weekdays) ? [...new Set(args.weekdays)].sort() : null, timeZone: args.timeZone ?? null, source: args.source ?? null,
      ...(args.sourceId !== undefined ? { sourceId: args.sourceId } : {}), ...(args.company !== undefined ? { company: args.company } : {}), ...(args.project !== undefined ? { project: args.project } : {}) }))}`;
  }

  async toCalendar(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const intentId = this.intentId(item, args);
    const existing = await this.deps.repos().operations.get(intentId);
    if (existing) return this.completeCalendarIntent(item, intentId, existing.params);
    const summary = text(args.text, 500);
    if (!summary) throw new ReminderError('提醒内容不能为空。');
    const kind = String(args.kind ?? 'once');
    const timeZone = String(args.timeZone ?? this.deps.config().timeZone);
    let start: Date;
    let rrule: string | undefined;
    let originExpression: string;
    const now = Date.now();
    if (kind === 'once') {
      if (args.at) {
        const at = new Date(String(args.at));
        if (Number.isNaN(at.getTime())) throw new ReminderError('once 的 at 需为可解析的 ISO 时间。');
        start = at;
        originExpression = at.toISOString();
      } else {
        const seconds = Number(args.afterSeconds);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 365 * 24 * 3600) throw new ReminderError('once 需要 1 秒–365 天的延迟（afterSeconds）或绝对时间（at）。');
        start = new Date(now + seconds * 1000);
        originExpression = `after ${seconds}s`;
      }
    } else if (kind === 'daily') {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(String(args.time ?? ''))) throw new ReminderError('daily 需要本地时间 HH:mm:ss。');
      const record = createDailyScheduleRecord(ScheduleId('f45'), summary, { time: String(args.time), time_zone: timeZone }, now, summary);
      start = firstOccurrence(record, now);
      rrule = 'FREQ=DAILY;INTERVAL=1';
      originExpression = `daily ${args.time} ${timeZone}`;
    } else if (kind === 'weekly') {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(String(args.time ?? ''))) throw new ReminderError('weekly 需要本地时间 HH:mm:ss。');
      const weekdays = Array.isArray(args.weekdays) ? (args.weekdays as number[]) : [];
      if (!weekdays.length || weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7)) throw new ReminderError('weekly 需要 weekdays（ISO 1–7，周一=1）。');
      const sorted = [...new Set(weekdays)].sort();
      const record = createWeeklyScheduleRecord(ScheduleId('f45'), summary, { time: String(args.time), time_zone: timeZone, weekdays: sorted }, now, summary);
      start = firstOccurrence(record, now);
      rrule = `FREQ=WEEKLY;BYDAY=${sorted.map(d => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][d - 1]).join(',')}`;
      originExpression = `weekly ${args.time} ${sorted.join(',')} ${timeZone}`;
    } else {
      throw new ReminderError('时钟型日程化支持 once/daily/weekly；条件与来源跟进由智能任务 skill 承接。');
    }
    const end = new Date(start.getTime() + 15 * 60 * 1000);
    const target = await this.deps.bindCalendar?.(args);
    const channel = target?.platform ?? this.deps.config().calendarChannel;
    const calendarId = target?.resource.id ?? (channel === 'wecom' ? 'wecom' : this.deps.config().calendarId);
    const { row } = await this.deps.repos().operations.begin({
      id: intentId, workItemId: item.id, action: 'reminder.calendar', params: {
        ruleId: `rmd-cal-${hash(intentId)}`, kind, summary, timeZone, originExpression,
        source: args.source ? text(args.source, 500) : null,
        calendar: { channel, calendarId, ...(target ? { sourceId: target.sourceId, _sourceTarget: target } : {}), summary: `提醒：${summary}`, start: start.toISOString(), end: end.toISOString(), timeZone, reminderMinutes: [0], ...(rrule ? { rrule } : {}) },
      },
    });
    return this.completeCalendarIntent(item, intentId, row.params);
  }

  private async completeCalendarIntent(item: WorkItemRow, intentId: string, intent: any): Promise<unknown> {
    const { ruleId, kind, summary, timeZone, originExpression, source, calendar } = intent;
    const prior = await this.deps.repos().reminders.getRule(ruleId);
    if (prior?.status === 'stopped') return { ruleId, status: 'stopped', reused: true, eventId: prior.record.event_id, calendarChannel: prior.record.channel, message: '原提醒已取消；重复创建请求保留停止状态，需要再次提醒时请明确建立新的事项。' };
    const created = await this.deps.calendarWrite(item, 'create', calendar, `${intentId}:write`) as { eventId?: string; event_id?: string; operationId?: string };
    const eventId = created.eventId ?? created.event_id;
    if (!eventId) throw new ReminderError('日程回执缺少事件标识；备份尚未完成，请先核对原操作。');
    if (!await this.deps.repos().reminders.getRule(ruleId)) {
      await this.deps.repos().reminders.insertRule({
        id: ruleId, kind, text: summary,
        record: { type: 'calendar', channel: calendar.channel, calendar_id: calendar.calendarId, event_id: eventId, start: calendar.start, reminder_minutes: calendar.reminderMinutes ?? [5], rrule: calendar.rrule ?? null, operation_id: created.operationId ?? null, ...(calendar._sourceTarget ? { source_target: calendar._sourceTarget } : {}) },
        status: 'delegated', next_due_at: new Date(calendar.start), time_zone: timeZone,
        origin_expression: originExpression, source, work_item_id: item.id,
        link_source_type: null, link_source_id: null, link_fingerprint: null,
      }).catch(async error => { if (!await this.deps.repos().reminders.getRule(ruleId)) throw error; });
    }
    const result = {
      ruleId, eventId, calendarChannel: calendar.channel, start: calendar.start,
      ...(calendar.rrule ? { rrule: calendar.rrule } : {}),
      reminderAt: new Date(Date.parse(calendar.start) - (calendar.reminderMinutes?.[0] ?? 5) * 60000).toISOString(), timeZone,
      message: `提醒已写入${calendar.channel === 'wecom' ? '企微' : '飞书'}日历（${originExpression}）；由对应 App 原生提醒，首次提醒时间 ${new Date(Date.parse(calendar.start) - (calendar.reminderMinutes?.[0] ?? 5) * 60000).toISOString()}（时区 ${timeZone}），与24私助是否在线无关。后续以原日程设置为准；账本留有备份记录。`,
    };
    await this.deps.repos().operations.update(intentId, { status: 'succeeded', receipt: result });
    return result;
  }

  async rejectDelegated(ruleId: string, op: string): Promise<unknown> {
    const rule = await this.deps.repos().reminders.getRule(ruleId);
    if (rule?.status === 'delegated') {
      throw new Error(`该提醒已日程化（App 原生提醒），账本侧「${op}」不适用；请在对应日历 App 内操作，或让我更新/删除该日程事件。`);
    }
    throw new ReminderError('旧账本提醒引擎已退役，不能继续计时；请明确设置新的原生日历提醒，历史记录保留。');
  }

  async cancel(item: WorkItemRow, ruleId: string, reason: string): Promise<unknown> {
    const rule = await this.deps.repos().reminders.getRule(ruleId);
    if (rule?.status === 'delegated') {
      const record = rule.record as { event_id?: string | null; channel?: string; calendar_id?: string; rrule?: string | null; source_target?: SourceTarget };
      if (!record?.event_id) throw new ReminderError('原提醒缺少事件标识，请先核对原事件，不能确认停止。');
      if (record.event_id) {
        const event = await this.deps.repos().calendar.findEvent(record.event_id);
        const channel = record.channel ?? event?.channel;
        const calendarId = record.calendar_id ?? event?.calendar_id;
        if (!channel || !calendarId) throw new ReminderError('原提醒的日历归属缺失，请先核对原事件。');
        await this.deps.calendarWrite(item, 'cancel', { eventId: record.event_id, channel, calendarId,
          ...(record.source_target ? { sourceId: record.source_target.sourceId, _sourceTarget: record.source_target } : {}), ...(record.rrule || event?.recurring ? { repeatScope: 'all' } : {}) }, `reminder.cancel:${rule.id}`);
      }
      return this.deps.ledger().setStatus(ruleId, 'stopped', reason || '取消（日历事件同步删除）');
    }
    return this.deps.ledger().setStatus(ruleId, 'stopped', reason || '本人取消历史提醒');
  }
}
