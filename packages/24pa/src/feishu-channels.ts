// Feishu channel module (round-3 arch-1): the calendar/task/memo operations
// that talk to lark-cli behind one deep module — CLI envelopes, staged
// operations, projection sync and receipts. Channel selection semantics
// (calendarChannel / todoChannel config branches) stay in the runtime, which
// keeps thin dispatchers in front of this module and wecom-channels; the
// wecom mirror (wecom-channels.ts) proves the seam shape.

import { runLarkCli } from './lark.js';
import { cliOptions } from './feishu.js';
import { text, nowIso, isoDate, parseZonedRange, parseDue, eventFingerprint, hash } from './util.js';
import { noteParentToken } from './config.js';
import { taskPlanKey } from './task-lifecycle.js';
import type { PaConfig } from './config.js';
import type { SharedChannelDeps } from './channel-deps.js';
import type { TaskRow, WorkItemRow, ActionOperationRow } from './repo.js';
import type { MemoryStore } from './memory.js';

export interface FeishuDeps extends SharedChannelDeps {
  gate<T>(key: string, work: () => Promise<T>): Promise<T>;
  stagedOperationWithId(operationId: string, item: WorkItemRow, action: string, params: Record<string, unknown>): Promise<{ created: boolean; row: ActionOperationRow }>;
  notifySourceChanged(sourceType: 'task' | 'calendar', sourceId: string, currentFingerprint: string | null): Promise<void>;
  linkedEventIdsInWindow(from: Date, to: Date): Promise<string[]>;
  memory(): MemoryStore | null;
}

// ---- remote-shape mappers (moved from runtime.ts; pure, Feishu-CLI shaped) ----

export function mapRemoteEvent(raw: any): { eventId: string; summary: string; start: Date; end: Date; isAllDay: boolean; timezone: string | null; canceled: boolean; recurring: boolean; attendees: unknown; url: string | null } | null {
  const eventId = String(raw?.event_id ?? raw?.eventId ?? raw?.id ?? '');
  const summary = String(raw?.summary ?? raw?.title ?? '');
  const start = new Date(String(raw?.start_time ?? raw?.start ?? raw?.startTime ?? ''));
  const end = new Date(String(raw?.end_time ?? raw?.end ?? raw?.endTime ?? ''));
  if (!eventId || !summary || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    eventId,
    summary,
    start,
    end,
    isAllDay: raw?.is_all_day === true || raw?.allDay === true,
    timezone: raw?.timezone ? String(raw.timezone) : null,
    canceled: raw?.status === 'canceled' || raw?.canceled === true,
    recurring: !!(raw?.rrule ?? raw?.recurrence?.length),
    attendees: raw?.attendees ?? raw?.attendee_ids ?? null,
    url: raw?.url ? String(raw.url) : raw?.meeting_url ? String(raw.meeting_url) : null,
  };
}

export function taskExternal(data: any): { guid: string; url: string | null } {
  const task = data?.task ?? data;
  const guid = task?.guid ?? task?.task_guid ?? task?.taskId;
  if (!guid) throw Object.assign(new Error('未取得真实任务 ID；请先核对飞书任务清单，不要盲目重试。'), { outcome: 'unknown' });
  return { guid: String(guid), url: task?.url ? String(task.url) : null };
}

/** Stable fingerprint of a followed task: identity + content + due (P19). */
export function taskFingerprint(task: { task_guid: string; summary: string; due_at: Date | null }): string {
  return hash(`${task.task_guid}\n${task.summary}\n${isoDate(task.due_at) ?? ''}`);
}
export class FeishuChannels {
  constructor(private readonly deps: FeishuDeps) {}

  // ---- calendar projection & writes ---------------------------------------

  /** Feishu calendar projection query (conflicts + freshness); channel selection stays in the runtime. */
  async calendarQuery(args: Record<string, unknown>): Promise<unknown> {
    const calendarId = String(args.calendarId ?? this.deps.config().calendarId);
    const { from, to } = parseZonedRange(args);
    const sync = await this.syncCalendarWindow(calendarId, from, to);
    const events = await this.deps.repos().calendar.eventsIn(calendarId, from, to);
    const conflicts: { a: string; b: string }[] = [];
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        if (events[i]!.end_time > events[j]!.start_time && events[j]!.end_time > events[i]!.start_time) {
          conflicts.push({ a: events[i]!.event_id, b: events[j]!.event_id });
        }
      }
    }
    const state = await this.deps.repos().calendar.getSync(calendarId);
    return {
      calendarId,
      from: isoDate(from),
      to: isoDate(to),
      fresh: sync.ok,
      syncedAt: isoDate(state?.last_synced_at ?? null),
      message: sync.ok
        ? `共 ${events.length} 个日程（不含已取消）；冲突 ${conflicts.length} 处。`
        : `本次同步失败（${sync.error}）；以下为投影数据，可能过期，不视为完整日历。`,
      conflicts: conflicts.map(c => ({
        a: events.find(e => e.event_id === c.a)!.summary,
        b: events.find(e => e.event_id === c.b)!.summary,
      })),
      events: events.map(e => ({
        eventId: e.event_id,
        summary: e.summary,
        start: isoDate(e.start_time),
        end: isoDate(e.end_time),
        allDay: e.is_all_day,
        timezone: e.timezone,
        recurring: e.recurring,
        url: e.url,
      })),
    };
  }

  async calendarBusy(args: Record<string, unknown>): Promise<unknown> {
    const calendarId = String(args.calendarId ?? this.deps.config().calendarId);
    const { from, to } = parseZonedRange(args);
    const sync = await this.syncCalendarWindow(calendarId, from, to);
    const events = await this.deps.repos().calendar.eventsIn(calendarId, from, to);
    return {
      fresh: sync.ok,
      message: sync.ok ? `该时段忙闲如下（${events.length} 项）。` : `本次同步失败（${sync.error}）；展示投影，可能过期。`,
      busy: events.map(e => ({ summary: e.summary, start: isoDate(e.start_time), end: isoDate(e.end_time), allDay: e.is_all_day })),
    };
  }

  async calendarWrite(item: WorkItemRow, kind: 'create' | 'update' | 'cancel', args: Record<string, unknown>, operationIdOverride?: string): Promise<unknown> {
    const calendarId = String(args.calendarId ?? this.deps.config().calendarId);
    const summary = kind === 'cancel' ? null : args.summary === undefined ? null : text(args.summary, 500);
    const start = args.start !== undefined ? new Date(String(args.start)) : null;
    const end = args.end !== undefined ? new Date(String(args.end)) : null;
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw new Error('日程时间需为可解析的 ISO 时间。');
    if (start && end && end <= start) throw new Error('结束时间须晚于开始时间。');
    if (kind === 'create' && (!summary || !start || !end)) throw new Error('创建需要 summary、start、end。');
    const eventId = kind === 'create' ? '' : String(args.eventId ?? '');
    if (kind !== 'create' && !eventId) throw new Error('需要 eventId（可先 calendar_query 查询）。');
    if (kind === 'update' && !summary && !start && !end) throw new Error('需要至少一项修改（summary/start/end）。');
    const attendees = Array.isArray(args.attendees) ? (args.attendees as string[]) : null;
    const paramsKey = `${calendarId}\n${kind}\n${eventId}\n${summary ?? ''}\n${start?.toISOString() ?? ''}\n${end?.toISOString() ?? ''}\n${(attendees ?? []).join(',')}\n${typeof args.rrule === 'string' ? args.rrule : ''}`;
    return this.deps.gate(`calendar-event:${eventId || 'new'}`, async () => {
    const staged = operationIdOverride
      ? await this.deps.stagedOperationWithId(operationIdOverride, item, `calendar.${kind}`, { calendarId, kind, eventId, summary, start, end, ...(args._authorization as Record<string, unknown> ?? {}) })
      : await this.deps.stagedOperation(
          item,
          `calendar.${kind}`,
          paramsKey,
          { calendarId, kind, eventId, summary, start, end },
          '请先用 calendar_query 重新同步窗口核对日程实际状态，确认后再继续。',
        );
    if (!staged.created && staged.row.status === 'succeeded') {
      return { operationId: staged.row.id, reused: true, ...(staged.row.receipt ?? {}), message: '此日程操作此前已提交，未重复写入。' };
    }
    try {
      const cliArgs = ['calendar', kind === 'create' ? '+create' : kind === 'update' ? '+update' : '+delete', '--as', 'user', '--calendar-id', calendarId];
      if (kind === 'create') {
        cliArgs.push('--summary', `[24PA] ${summary}`, '--start', start!.toISOString(), '--end', end!.toISOString());
        if (attendees && attendees.length > 0) cliArgs.push('--attendee-ids', attendees.join(','));
        // F45：rrule 重复日程（RFC5545）；paramsKey 纳入以防同参数不同规则的误重放。
        if (typeof args.rrule === 'string' && args.rrule) cliArgs.push('--rrule', args.rrule);
      } else if (kind === 'update') {
        cliArgs.push('--event-id', eventId);
        if (summary) cliArgs.push('--summary', `[24PA] ${summary}`);
        if (start) cliArgs.push('--start', start.toISOString());
        if (end) cliArgs.push('--end', end.toISOString());
      } else {
        cliArgs.push('--event-id', eventId);
      }
      const { data } = await this.deps.performExternal(staged.row.id, () => runLarkCli(cliOptions(this.deps.config(), this.deps.cli().bin, this.deps.cli().timeoutMs), cliArgs));
      const event = data?.event ?? data;
      const newEventId = String(event?.event_id ?? event?.eventId ?? eventId);
      if (!newEventId) throw Object.assign(new Error('日程回执缺少真实 eventId；请先核对远端。'), { outcome: 'unknown' });
      const url = event?.url ? String(event.url) : null;
      if (newEventId && (kind === 'create' || kind === 'update')) {
        // Merge with the prior projection and the platform receipt; never
        // fabricate times that neither the request nor the receipt provided.
        const prior = await this.deps.repos().calendar.findEvent(newEventId);
        const receiptStart = Date.parse(String(event?.start_time ?? event?.start ?? '')) ? new Date(String(event.start_time ?? event.start)) : null;
        const receiptEnd = Date.parse(String(event?.end_time ?? event?.end ?? '')) ? new Date(String(event.end_time ?? event.end)) : null;
        const startTime = start ?? receiptStart ?? prior?.start_time;
        const endTime = end ?? receiptEnd ?? prior?.end_time;
        if (!startTime || !endTime) {
          // No trustworthy time source: refresh the window instead of guessing.
          await this.syncCalendarWindow(calendarId, new Date(Date.now() - 24 * 3600 * 1000), new Date(Date.now() + 7 * 24 * 3600 * 1000)).catch(() => {});
        } else {
          await this.deps.repos().calendar.upsertEvent({
            event_id: newEventId,
            calendar_id: calendarId,
            summary: summary ?? String(event?.summary ?? prior?.summary ?? ''),
            start_time: startTime,
            end_time: endTime,
            is_all_day: prior?.is_all_day ?? false,
            timezone: prior?.timezone ?? null,
            status: 'active',
            recurring: prior?.recurring ?? false,
            attendees: attendees ?? prior?.attendees ?? null,
            url: url ?? prior?.url ?? null,
            raw: event,
          });
        }
      }
      if (kind === 'cancel' && eventId) {
        await this.deps.repos().calendar.markCanceled(eventId);
        await this.deps.notifySourceChanged('calendar', eventId, null);
      }
      if (kind === 'update') {
        // Any successful update may have moved the source: linked reminders
        // and prep plans re-derive their validity from the new fingerprint.
        const prior = await this.deps.repos().calendar.findEvent(newEventId);
        await this.deps.notifySourceChanged('calendar', newEventId, eventFingerprint({ event_id: newEventId, summary: prior?.summary ?? summary ?? '', start_time: prior?.start_time ?? start! }));
      }
      await this.deps.repos().operations.update(staged.row.id, { status: 'succeeded', receipt: { eventId: newEventId, url, kind } });
      return {
        operationId: staged.row.id,
        eventId: newEventId,
        url,
        message: kind === 'create' ? '日程已创建（以平台回执为准）。' : kind === 'update' ? '日程已修改（以平台回执为准）。' : '日程已取消（以平台回执为准）。',
      };
    } catch (error) {
      await this.deps.failStaged(staged.row.id, error);
      throw error;
    }
    });
  }

  /**
   * Meeting scheduling with explicit-invitation semantics (P12): attendees
   * come from explicit open ids or memory contact records; ambiguity must be
   * clarified before anything is sent.
   */
  async meetingSchedule(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const title = text(args.title, 200);
    const start = new Date(String(args.start ?? ''));
    const end = new Date(String(args.end ?? ''));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new Error('会议需要明确的开始/结束时间（ISO，含时区）。');
    const attendeeInputs = Array.isArray(args.attendees) ? (args.attendees as Record<string, unknown>[]) : [];
    if (attendeeInputs.length === 0) throw new Error('需要提供参会人；没有参会人时用 calendar_create 建个人日程。');
    if (!String(args.instruction ?? '').trim()) throw new Error('缺少本人明确的邀请指令依据（instruction）。');
    const resolved: { name: string; openId: string }[] = [];
    const unresolved: string[] = [];
    for (const attendee of attendeeInputs) {
      const name = String(attendee.name ?? '').trim();
      const openId = String(attendee.openId ?? '').trim();
      if (openId) {
        resolved.push({ name: name || openId, openId });
        continue;
      }
      if (!name) {
        unresolved.push('未提供姓名或 openId 的参会人');
        continue;
      }
      // Verbatim move from runtime: memory is non-null on the live path (the
      // original used a non-null assertion); the null-store TypeError is the
      // preserved failure mode, not a new guard message.
      const memory = await this.deps.memory()!.search({ query: name, limit: 50 });
      const contactRecords = memory.records.filter(r => (r.topic === `联系人：${name}` || r.content.includes(`联系人 ${name}：`)) && r.status === 'confirmed');
      const ids = [...new Set(contactRecords.flatMap(r => r.content.match(/ou_[A-Za-z0-9_]+/g) ?? []))];
      if (ids.length === 1) resolved.push({ name, openId: ids[0]! });
      else unresolved.push(`${name}（${ids.length === 0 ? '记忆中没有对应 open_id' : `记忆中有 ${ids.length} 位候选`}）`);
    }
    if (unresolved.length > 0) {
      throw new Error(`以下参会人无法唯一确定，请先澄清后再邀请：${unresolved.join('；')}。未发出任何邀请。`);
    }
    const result = (await this.calendarWrite(item, 'create', {
      summary: title,
      start: start.toISOString(),
      end: end.toISOString(),
      attendees: resolved.map(r => r.openId),
      calendarId: args.calendarId,
    })) as Record<string, unknown>;
    return {
      ...result,
      attendees: resolved,
      message: `已按本人明确指令创建会议并邀请 ${resolved.length} 位参会人（${resolved.map(r => r.name).join('、')}）；结果以平台回执为准。`,
    };
  }

  async syncCalendarWindow(calendarId: string, from: Date, to: Date): Promise<{ ok: boolean; error?: string }> {
    try {
      const { data } = await runLarkCli(cliOptions(this.deps.config(), this.deps.cli().bin, this.deps.cli().timeoutMs), [
        'calendar', '+agenda', '--as', 'user', '--calendar-id', calendarId,
        '--start', from.toISOString().slice(0, 10), '--end', to.toISOString().slice(0, 10),
      ]);
      const raw = (data?.events ?? data?.items ?? data ?? []);
      // An unrecognized response shape means the full window is unknown;
      // never run destructive cancellation marking in that case.
      if (!Array.isArray(raw)) {
        await this.deps.repos().calendar.saveSync({ calendar_id: calendarId, window_start: from, window_end: to, complete: false, lastError: '同步返回形状无法识别' });
        return { ok: false, error: '同步返回形状无法识别' };
      }
      const live: string[] = [];
      for (const rawEvent of raw) {
        const mapped = mapRemoteEvent(rawEvent);
        if (!mapped) continue;
        const existing = await this.deps.repos().calendar.findEvent(mapped.eventId);
        if (existing) {
          const afterFp = eventFingerprint({ event_id: mapped.eventId, summary: mapped.summary, start_time: mapped.start });
          if (eventFingerprint(existing) !== afterFp) await this.deps.notifySourceChanged('calendar', mapped.eventId, afterFp);
        }
        await this.deps.repos().calendar.upsertEvent({
          event_id: mapped.eventId,
          calendar_id: calendarId,
          summary: mapped.summary,
          start_time: mapped.start,
          end_time: mapped.end,
          is_all_day: mapped.isAllDay,
          timezone: mapped.timezone,
          status: mapped.canceled ? 'canceled' : 'active',
          recurring: mapped.recurring,
          attendees: mapped.attendees,
          url: mapped.url,
          raw: rawEvent,
        });
        live.push(mapped.eventId);
      }
      await this.deps.repos().calendar.markCanceledExcept(calendarId, live, from, to);
      // Remote cancellations surface through linked reminders too: any linked
      // event in this window that is no longer live gets its correction (P19).
      for (const eventId of await this.deps.linkedEventIdsInWindow(from, to)) {
        if (!live.includes(eventId)) await this.deps.notifySourceChanged('calendar', eventId, null);
      }
      await this.deps.repos().calendar.saveSync({ calendar_id: calendarId, window_start: from, window_end: to, complete: true });
      return { ok: true };
    } catch (error) {
      await this.deps.repos().calendar
        .saveSync({ calendar_id: calendarId, window_start: from, window_end: to, complete: false, lastError: (error as Error).message })
        .catch(() => {});
      return { ok: false, error: (error as Error).message };
    }
  }

  // ---- tasks ----------------------------------------------------------------

  async refreshTask(task: TaskRow): Promise<TaskRow | null> {
    try {
      const { data } = await runLarkCli(cliOptions(this.deps.config(), this.deps.cli().bin, this.deps.cli().timeoutMs), [
        'task', '+search', '--as', 'user', '--query', task.summary.replace(/^\[24PA\] /, '').slice(0, 20),
      ]);
      const remote = (data?.tasks ?? data?.items ?? []).find((t: any) => String(t.guid ?? t.task_guid) === task.task_guid);
      if (!remote) return null;
      return await this.deps.repos().tasks.save({
        ...task,
        summary: typeof remote.summary === 'string' && remote.summary ? remote.summary : task.summary,
        status: remote.completed === true || remote.status === 'completed' ? 'completed' : 'open',
        last_synced_at: new Date(), external_updated_at: new Date(),
      });
    } catch { return null; }
  }

  async taskComplete(item: WorkItemRow, taskRef: TaskRow): Promise<unknown> {
    return this.deps.gate(`task:${taskRef.task_guid}`, async () => {
      const local = await this.deps.repos().tasks.get(taskRef.id);
      if (!local) throw new Error('任务不存在；请先用 task_list 查看。');
      const refreshed = await this.refreshTask(local);
      const task = refreshed ?? local;
      if (task.status === 'completed') return { guid: task.task_guid, status: 'completed', reused: true, stale: !refreshed, message: refreshed ? '任务此前已是完成状态（含远端核对）。' : '任务此前已是完成状态（本地投影，本次远端核对未完成）。' };
      const staged = await this.deps.stagedOperation(item, 'task.complete', task.task_guid, { guid: task.task_guid });
      if (!staged.created && staged.row.status === 'succeeded') {
        await this.deps.repos().tasks.save({ ...task, status: 'completed' });
        return { operationId: staged.row.id, guid: task.task_guid, status: 'completed', reused: true, message: '此前已完成，未重复提交。' };
      }
      try {
        await this.deps.performExternal(staged.row.id, () => runLarkCli(cliOptions(this.deps.config(), this.deps.cli().bin, this.deps.cli().timeoutMs), ['task', '+complete', '--as', 'user', '--task-id', task.task_guid]));
        const updated = await this.deps.repos().tasks.save({ ...task, status: 'completed', last_synced_at: new Date(), external_updated_at: new Date() });
        await this.deps.repos().operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: task.task_guid, status: 'completed' } });
        return { operationId: staged.row.id, guid: updated.task_guid, url: updated.url, status: 'completed', message: '任务已完成（以飞书实际状态为准）。' };
      } catch (error) {
        await this.deps.failStaged(staged.row.id, error);
        throw error;
      }
    });
  }

  async taskCreate(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const summary = text(args.summary, 500);
    const { dueAt, dueHasTime, dueArg } = parseDue(args.due);
    const plannedAt = args.plannedAt ? new Date(String(args.plannedAt)) : null;
    if (plannedAt && Number.isNaN(plannedAt.getTime())) throw new Error('计划投入时间无法解析。');
    const estimateMinutes = args.estimateMinutes == null ? null : Number(args.estimateMinutes);
    if (estimateMinutes != null && (!Number.isFinite(estimateMinutes) || estimateMinutes < 0)) throw new Error('估时需为非负分钟数。');
    const batchSuffix = (args.opSuffix ? `\n${String(args.opSuffix)}` : '') + taskPlanKey(args);
    const overrideId = args._operationId ? String(args._operationId) : null;
    const authorization = args._instruction ? { instruction: text(args._instruction, 500) } : {};
    const staged = overrideId
      ? await this.deps.stagedOperationWithId(overrideId, item, 'task.create', { tasklistId: this.deps.config().tasklistId, summary, due: dueArg, ...authorization })
      : await this.deps.stagedOperation(item, 'task.create', `${this.deps.config().tasklistId}\n${summary}\n${dueArg ?? ''}${batchSuffix}`, {
          tasklistId: this.deps.config().tasklistId,
          summary,
          due: dueArg,
          ...authorization,
        });
    if (!staged.created && staged.row.status === 'succeeded') {
      const existing = await this.deps.repos().tasks.get(staged.row.id);
      return { operationId: staged.row.id, reused: true, guid: existing?.task_guid ?? staged.row.receipt?.guid, url: existing?.url ?? staged.row.receipt?.url ?? null, message: '此任务此前已创建，未重复写入飞书。' };
    }
    try {
      const cliArgs = ['task', '+create', '--as', 'user', '--summary', `[24PA] ${summary}`, '--tasklist-id', this.deps.config().tasklistId, '--idempotency-key', staged.row.id];
      if (dueArg) cliArgs.push('--due', dueArg);
      const { data } = await this.deps.performExternal(staged.row.id, () => runLarkCli(cliOptions(this.deps.config(), this.deps.cli().bin, this.deps.cli().timeoutMs), cliArgs));
      const external = taskExternal(data);
      const task = await this.deps.repos().tasks.save({
        id: staged.row.id,
        work_item_id: item.id,
        task_guid: external.guid,
        url: external.url,
        summary,
        due_at: dueAt,
        due_has_time: dueHasTime,
        planned_at: plannedAt,
        estimate_minutes: estimateMinutes == null ? null : Math.round(estimateMinutes),
        status: 'open',
        external_updated_at: new Date(),
        last_synced_at: new Date(),
      });
      if (args.projectId) await this.deps.repos().projects.link(String(args.projectId), task.id);
      await this.deps.repos().operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: external.guid, url: external.url, summary } });
      return { operationId: staged.row.id, guid: external.guid, url: external.url, dueAt: isoDate(task.due_at), plannedAt: isoDate(task.planned_at), estimateMinutes: task.estimate_minutes, message: '任务已创建（飞书为权威对象）。' };
    } catch (error) {
      await this.deps.failStaged(staged.row.id, error);
      throw error;
    }
  }

  async resolveTask(args: Record<string, unknown>): Promise<TaskRow> {
    const key = String(args.taskId ?? args.guid ?? '');
    const task = (await this.deps.repos().tasks.get(key)) ?? (await this.deps.repos().tasks.byGuid(key));
    if (!task) throw new Error('任务不存在；请先用 task_list 查看当前任务。');
    return task;
  }

  async taskUpdate(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const taskRef = await this.resolveTask(args);
    if (taskRef.channel === 'wecom') {
      throw new Error('企微待办首版不支持修改（F16 范围：创建/完成/删除）；如需调整，可删除后重建。');
    }
    const summary = args.summary == null ? null : text(args.summary, 500);
    const { dueAt, dueHasTime, dueArg } = parseDue(args.due === undefined ? null : args.due);
    const plannedAt = args.plannedAt === undefined ? undefined : args.plannedAt === null ? null : new Date(String(args.plannedAt));
    if (plannedAt && Number.isNaN(plannedAt.getTime())) throw new Error('计划投入时间无法解析。');
    const estimateMinutes = args.estimateMinutes === undefined ? undefined : args.estimateMinutes === null ? null : Number(args.estimateMinutes);
    if (estimateMinutes != null && (!Number.isFinite(estimateMinutes) || estimateMinutes < 0)) throw new Error('估时需为非负分钟数。');
    if (!summary && args.due === undefined && plannedAt === undefined && estimateMinutes === undefined) {
      throw new Error('需要说明要修改的内容（summary、due、plannedAt 或 estimateMinutes）。');
    }
    return this.deps.gate(`task:${taskRef.task_guid}`, async () => {
      // Re-read inside the gate and refresh from the remote so a stale
      // projection never overwrites another worker's or the owner's changes.
      const stale = await this.deps.repos().tasks.get(taskRef.id);
      if (!stale) throw new Error('任务不存在；请先用 task_list 查看。');
      await this.refreshTask(stale);
      const task = (await this.deps.repos().tasks.get(taskRef.id)) ?? stale;
      const staged = await this.deps.stagedOperation(item, 'task.update', `${task.task_guid}\n${summary ?? ''}\n${dueArg ?? ''}${taskPlanKey(args)}`, { guid: task.task_guid, summary, due: dueArg, plannedAt, estimateMinutes });
      if (!staged.created && staged.row.status === 'succeeded') {
        return { operationId: staged.row.id, reused: true, guid: task.task_guid, url: task.url, message: '此修改此前已提交，未重复写入。' };
      }
      try {
        const cliArgs = ['task', '+update', '--as', 'user', '--task-id', task.task_guid];
        if (summary) cliArgs.push('--summary', `[24PA] ${summary}`);
        if (dueArg) cliArgs.push('--due', dueArg);
        const { data } = summary || dueArg
          ? await this.deps.performExternal(staged.row.id, () => runLarkCli(cliOptions(this.deps.config(), this.deps.cli().bin, this.deps.cli().timeoutMs), cliArgs))
          : { data: {} }; // Local planning fields do not issue an empty platform update.
        const external = taskExternal({ task: { guid: task.task_guid, url: task.url, ...(data?.task ?? {}) } });
        const updated = await this.deps.repos().tasks.save({
          ...task,
          summary: summary ?? task.summary,
          due_at: dueArg !== null ? dueAt : task.due_at,
          due_has_time: dueArg !== null ? dueHasTime : task.due_has_time,
          planned_at: plannedAt === undefined ? task.planned_at : plannedAt,
          estimate_minutes: estimateMinutes === undefined ? task.estimate_minutes : estimateMinutes == null ? null : Math.round(estimateMinutes),
          external_updated_at: new Date(),
          last_synced_at: new Date(),
          url: external.url ?? task.url,
        });
        await this.deps.notifySourceChanged('task', task.task_guid, taskFingerprint(updated));
        await this.deps.repos().operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: task.task_guid, summary: updated.summary } });
        return { operationId: staged.row.id, guid: task.task_guid, url: updated.url, summary: updated.summary, dueAt: isoDate(updated.due_at), message: '任务已按本人指令修改；截止与计划/估时分别记录。' };
      } catch (error) {
        await this.deps.failStaged(staged.row.id, error);
        throw error;
      }
    });
  }

  // ---- memo docs ------------------------------------------------------------

  async createMemoDocument(item: WorkItemRow, topic: string, content: string): Promise<{ docId: string | null; url: string | null; revision: string | null; warnings: string[] }> {
    const config = this.deps.config();
    const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const paragraphs = content
      .split('\n')
      .map(line => `<p>${xml(line) || '<br/>'}</p>`)
      .join('\n');
    const title = `[24PA] ${topic}`;
    const body = `<title>${xml(title)}</title><p>来源事项：${xml(item.id)}</p><p>保存时间：${nowIso()}</p><h1>内容</h1>${paragraphs}`;
    // F22：知识库节点优先，未配置沿用文档目录（wiki 优先、folder 回退）。
    const parentToken = noteParentToken(config);
    const { data } = await runLarkCli(cliOptions(config, this.deps.cli().bin, this.deps.cli().timeoutMs), [
      'docs', '+create', '--as', 'user', '--doc-format', 'xml', '--parent-token', parentToken, '--content', '-',
    ], body);
    const doc = data?.document;
    const warnings = Array.isArray(data?.warnings) ? data.warnings.map((x: unknown) => String(x)) : [];
    // A returned document id wins even with warnings: the external object
    // exists, so the failure must not orphan it — read back and record it.
    if (!doc?.document_id || !doc?.url) {
      throw new Error(warnings.length ? `文档创建未完成（${warnings.join('；')}）；请先核对配置的目录或知识库，不要盲目重试。` : '未取得文档标识；请先核对配置的目录或知识库，不要盲目重试。');
    }
    return { docId: doc.document_id, url: doc.url, revision: null, warnings };
  }

  async readMemoDocument(docId: string): Promise<{ revision: string | null }> {
    const readback = await runLarkCli(cliOptions(this.deps.config(), this.deps.cli().bin, this.deps.cli().timeoutMs), [
      'docs', '+fetch', '--as', 'user', '--doc', docId, '--doc-format', 'xml', '--detail', 'full',
    ]);
    if (!readback.data?.document?.content) throw new Error('文档回读不完整，保存结果未确认。');
    return { revision: readback.data.document.revision_id != null ? String(readback.data.document.revision_id) : null };
  }
}
