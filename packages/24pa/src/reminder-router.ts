// Reminder routing (round-3 arch-8): the F45 decision — clock-shaped
// reminders become calendar events on the chosen channel, everything else
// (linked/every/forced) stays on the ledger engine — behind one module next
// to the ledger it routes between. The runtime's role table keeps only
// declarations; delegated-row lifecycle (reject/cancel) lives here too.

import { randomUUID } from 'node:crypto';
import { ReminderError, firstOccurrence } from './reminders.js';
import {
  createDailyScheduleRecord,
  createWeeklyScheduleRecord,
  ScheduleId,
} from '@deepseek-ai/dsh-schedule';
import { text, eventFingerprint } from './util.js';
import { taskFingerprint } from './feishu-channels.js';
import type { PaConfig } from './config.js';
import type { Repos, TaskRow, WorkItemRow } from './repo.js';
import type { ReminderEngine } from './reminders.js';

export interface ReminderRouterDeps {
  config(): PaConfig;
  repos(): Repos;
  /** Channel-dispatching calendar write (routes wecom/feishu in the runtime). */
  calendarWrite(item: WorkItemRow, kind: 'create' | 'update' | 'cancel', args: Record<string, unknown>): Promise<unknown>;
  /** Whether a calendar channel is live (wecom always; feishu needs mode+transport). */
  channelsLive(): boolean;
  /** Lazy: repos/engine bind at workspace load, after the router is built. */
  ledger(): ReminderEngine;
  resolveTask(args: Record<string, unknown>): Promise<TaskRow>;
}

export class ReminderRouter {
  constructor(private readonly deps: ReminderRouterDeps) {}

  /** F45 路由：时钟型（once/daily/weekly，无跟随、未强制）且日历渠道可用 → 日历；其余 → 账本引擎。 */
  async route(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const clockKind = String(args.kind ?? 'once');
    const hasLink = !!(args.linkTaskGuid || args.linkEventId);
    // 测试缝：__forceLedger 显式走账本保留面（every/跟随型回归同路径）。
    const forceLedger = args.__forceLedger === true;
    if (!hasLink && !forceLedger && ['once', 'daily', 'weekly'].includes(clockKind) && this.deps.channelsLive()) {
      return this.toCalendar(item, args);
    }
    let link: { sourceType: 'task' | 'calendar'; sourceId: string; fingerprint: string } | undefined;
    if (args.linkTaskGuid || args.linkEventId) {
      if (args.linkTaskGuid && args.linkEventId) throw new Error('一次只能跟随一个来源（任务或日程）。');
      if (args.linkTaskGuid) {
        const task = await this.deps.resolveTask({ taskId: args.linkTaskGuid, guid: args.linkTaskGuid });
        link = { sourceType: 'task', sourceId: task.task_guid, fingerprint: taskFingerprint(task) };
      } else {
        const event = await this.deps.repos().calendar.findEvent(String(args.linkEventId));
        if (!event) throw new Error('日程不存在；请先 calendar_query 同步并取得 event_id。');
        link = { sourceType: 'calendar', sourceId: event.event_id, fingerprint: eventFingerprint(event) };
      }
    }
    const result = await this.deps.ledger().create({
      kind: String(args.kind ?? 'once') as any,
      text: text(args.text, 500),
      afterSeconds: args.afterSeconds == null ? undefined : Number(args.afterSeconds),
      at: args.at == null ? undefined : String(args.at),
      everySeconds: args.everySeconds == null ? undefined : Number(args.everySeconds),
      time: args.time == null ? undefined : String(args.time),
      weekdays: Array.isArray(args.weekdays) ? (args.weekdays as number[]) : undefined,
      timeZone: String(args.timeZone ?? this.deps.config().timeZone),
      source: args.source ? text(args.source, 500) : undefined,
      link,
    });
    return result;
  }

  async toCalendar(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
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
      throw new ReminderError('时钟型日程化支持 once/daily/weekly；every 与跟随来源型仍走账本引擎。');
    }
    const end = new Date(start.getTime() + 15 * 60 * 1000);
    const created = (await this.deps.calendarWrite(item, 'create', {
      summary: `提醒：${summary}`,
      start: start.toISOString(),
      end: end.toISOString(),
      ...(rrule ? { rrule } : {}),
    })) as { event_id?: string; eventId?: string; operationId?: string };
    const eventId = created.event_id ?? created.eventId ?? null;
    // 备份行：delegated 状态＝引擎不投递，仅面板/历史/取消路径数据源。
    const ruleId = `rmd-cal-${randomUUID().slice(0, 10)}`;
    await this.deps.repos().reminders.insertRule({
      id: ruleId,
      kind,
      text: summary,
      record: { type: 'calendar', channel: this.deps.config().calendarChannel, event_id: eventId, start: start.toISOString(), rrule: rrule ?? null, operation_id: created.operationId ?? null },
      status: 'delegated',
      next_due_at: start,
      time_zone: timeZone,
      origin_expression: originExpression,
      source: args.source ? text(args.source, 500) : null,
      work_item_id: item.id,
      link_source_type: null,
      link_source_id: null,
      link_fingerprint: null,
    });
    return {
      ruleId,
      eventId,
      calendarChannel: this.deps.config().calendarChannel,
      start: start.toISOString(),
      ...(rrule ? { rrule } : {}),
      message: `提醒已写入${this.deps.config().calendarChannel === 'wecom' ? '企微' : '飞书'}日历（${originExpression}）；到点由对应 App 原生日程提醒（默认提前 5 分钟），与24私助是否在线无关。稍后/改期可直接在 App 内操作，或告诉我来改日程；账本留有备份记录。`,
    };
  }

  async rejectDelegated(ruleId: string, op: string): Promise<unknown> {
    const rule = await this.deps.repos().reminders.getRule(ruleId);
    if (rule?.status === 'delegated') {
      throw new Error(`该提醒已日程化（App 原生提醒），账本侧「${op}」不适用；请在对应日历 App 内操作，或让我更新/删除该日程事件。`);
    }
    return undefined;
  }

  async cancel(item: WorkItemRow, ruleId: string, reason: string): Promise<unknown> {
    const rule = await this.deps.repos().reminders.getRule(ruleId);
    if (rule?.status === 'delegated') {
      const record = rule.record as { event_id?: string | null };
      if (record?.event_id) {
        await this.deps.calendarWrite(item, 'cancel', { eventId: record.event_id });
      }
      return this.deps.ledger().setStatus(ruleId, 'stopped', reason || '取消（日历事件同步删除）');
    }
    return this.deps.ledger().setStatus(ruleId, 'stopped', reason);
  }
}
