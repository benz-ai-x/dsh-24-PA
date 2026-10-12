// WeCom channel module (F30): the calendar/todo/notify operations plus the
// auth monitor behind one deep module. Channel selection (calendarChannel /
// todoChannel / notifyChannel config semantics) and role bindings stay in the
// runtime; wecom-cli is not idempotent so every write goes through staged
// operations first (spec 1.6).

import { runWecomCli, WecomCliError, wecomAuthAlertPlan, wecomWallTime, wecomParseWallTime } from './wecom.js';
import { text, nowIso, isoDate } from './util.js';
import { eventFingerprint, parseZonedRange, parseDue } from './runtime.js';
import type { PaConfig } from './config.js';
import type { Repos, TaskRow, WorkItemRow, ActionOperationRow } from './repo.js';

export const WECOM_CALENDAR_ID = 'wecom';
const WECOM_AUTH_ALERT_SUPPRESS_MS = 24 * 60 * 60 * 1000;

export interface WecomServiceCheck {
  id: 'calendar' | 'todo' | 'push';
  state: 'ok' | 'unauthorized' | 'expired' | 'unavailable' | 'error' | 'skipped';
  message: string;
  /** Verbatim platform guidance (contains the in-app authorization link). */
  helpMessage?: string;
}

export interface WecomDiagnostics {
  checkedAt: string;
  cli: { state: 'ok' | 'error'; message: string };
  auth: { state: 'ok' | 'error'; message: string };
  identity: { state: 'ok' | 'error' | 'missing'; message: string; userid?: string; userName?: string };
  services: WecomServiceCheck[];
  nextSteps: string[];
}

function anyWecomChannel(config: PaConfig): boolean {
  return config.calendarChannel === 'wecom' || config.todoChannel === 'wecom' || config.notifyChannel === 'wecom';
}

export interface WecomDeps {
  repos(): Repos;
  config(): PaConfig;
  cli(): { wecomCliBin: string; cliTimeoutMs: number };
  notifyOwner(dedupKey: string, body: string): Promise<void>;
  notifySourceChanged(sourceType: 'task' | 'calendar', sourceId: string, currentFingerprint: string | null): Promise<void>;
  gate<T>(key: string, work: () => Promise<T>): Promise<T>;
  stagedOperation(item: WorkItemRow, kind: string, paramsKey: string, params: Record<string, unknown>, reconcileHint?: string): Promise<{ created: boolean; row: ActionOperationRow }>;
  stagedOperationWithId(operationId: string, item: WorkItemRow, action: string, params: Record<string, unknown>): Promise<{ created: boolean; row: ActionOperationRow }>;
  failStaged(operationId: string, error: unknown): Promise<void>;
  linkedEventIdsInWindow(from: Date, to: Date): Promise<string[]>;
  isClosed(): boolean;
}

export class WecomChannels {
  constructor(private readonly deps: WecomDeps) {}

  private wecomIdentityCache: { userid: string; name: string } | null = null;
  private wecomIdentityFailedAt = 0;
  private wecomAuthLastAlertAt = 0;
  private wecomDiagnostics: WecomDiagnostics | null = null;

  /** Last inspection result, for readiness/health surfaces (F30). */
  get diagnostics(): WecomDiagnostics | null {
    return this.wecomDiagnostics;
  }

  // ---- wecom channel (F16, spec 1.6) ----------------------------------------
  //
  // 企业微信作为日程/待办的第二操作渠道与提醒单向推送出口：不做收信，
  // 飞书保持唯一交互入口。写操作同样先落 staged 账——wecom-cli 没有平台
  // 幂等键（实测重复 create 产生重复对象），操作键是唯一防线。

  wecomRun(args: readonly string[]) {
    return runWecomCli({ bin: this.deps.cli().wecomCliBin, timeoutMs: this.deps.cli().cliTimeoutMs }, args);
  }

  /** Resolve the push target via `identity whoami` once per workspace session. */
  async wecomOwnerUserid(): Promise<{ userid: string; name: string }> {
    if (this.wecomIdentityCache) return this.wecomIdentityCache;
    if (Date.now() - this.wecomIdentityFailedAt < 60_000) {
      throw new Error('企微推送目标最近解析失败（60 秒内不重复解析）；用 pa24_connection action=wecom_check 诊断。');
    }
    try {
      const { raw } = await this.wecomRun(['identity', 'whoami']);
      const context = String((raw as any)?.extra_identity_context ?? '');
      const match = /授权真人用户身份：\s*名字：(.+?)\s*ID：([A-Za-z0-9_\-]+)/.exec(context.replace(/\s+/g, ' '));
      if (!match) throw new Error('whoami 未包含授权真人身份；请先在服务器完成 wecom-cli auth init 并由本人扫码。');
      this.wecomIdentityCache = { name: match[1]!.trim(), userid: match[2]! };
      return this.wecomIdentityCache;
    } catch (error) {
      this.wecomIdentityFailedAt = Date.now();
      throw error;
    }
  }

  mapWecomSchedule(rawEvent: any): {
    eventId: string; summary: string; start: Date; end: Date; attendees: unknown;
  } | null {
    const eventId = String(rawEvent?.schedule_id ?? '');
    const summary = rawEvent?.subject == null ? '' : String(rawEvent.subject);
    const tz = this.deps.config().timeZone;
    const start = wecomParseWallTime(String(rawEvent?.begin_time ?? ''), tz);
    const end = wecomParseWallTime(String(rawEvent?.end_time ?? ''), tz);
    if (!eventId || !summary || !start || !end) return null;
    const attendees = Array.isArray(rawEvent?.attendees)
      ? (rawEvent.attendees as any[]).map(a => String(a?.name ?? a?.userid ?? '')).filter(Boolean)
      : null;
    return { eventId, summary, start, end, attendees };
  }

  async syncWecomCalendarWindow(from: Date, to: Date): Promise<{ ok: boolean; error?: string }> {
    const tz = this.deps.config().timeZone;
    try {
      const { data } = await this.wecomRun(['calendar', 'schedules', 'list', '--begin-time', wecomWallTime(from, tz), '--end-time', wecomWallTime(to, tz)]);
      // An unrecognized response shape means the full window is unknown;
      // never run destructive cancellation marking in that case.
      const raw = Array.isArray(data?.schedule_list) ? data.schedule_list : null;
      if (!raw) {
        await this.deps.repos().calendar.saveSync({ calendar_id: WECOM_CALENDAR_ID, window_start: from, window_end: to, complete: false, lastError: '同步返回形状无法识别', channel: 'wecom' });
        return { ok: false, error: '同步返回形状无法识别' };
      }
      const live: string[] = [];
      for (const rawEvent of raw) {
        const mapped = this.mapWecomSchedule(rawEvent);
        if (!mapped) continue;
        const existing = await this.deps.repos().calendar.findEvent(mapped.eventId);
        if (existing) {
          const afterFp = eventFingerprint({ event_id: mapped.eventId, summary: mapped.summary, start_time: mapped.start });
          if (eventFingerprint(existing) !== afterFp) await this.deps.notifySourceChanged('calendar', mapped.eventId, afterFp);
        }
        await this.deps.repos().calendar.upsertEvent({
          event_id: mapped.eventId,
          calendar_id: WECOM_CALENDAR_ID,
          summary: mapped.summary,
          start_time: mapped.start,
          end_time: mapped.end,
          is_all_day: false,
          timezone: tz,
          status: 'active',
          recurring: false,
          attendees: mapped.attendees,
          url: null,
          raw: rawEvent,
          channel: 'wecom',
        });
        live.push(mapped.eventId);
      }
      await this.deps.repos().calendar.markCanceledExcept(WECOM_CALENDAR_ID, live, from, to);
      for (const eventId of await this.deps.linkedEventIdsInWindow(from, to)) {
        if (!live.includes(eventId)) await this.deps.notifySourceChanged('calendar', eventId, null);
      }
      await this.deps.repos().calendar.saveSync({ calendar_id: WECOM_CALENDAR_ID, window_start: from, window_end: to, complete: true, channel: 'wecom' });
      return { ok: true };
    } catch (error) {
      await this.deps.repos().calendar
        .saveSync({ calendar_id: WECOM_CALENDAR_ID, window_start: from, window_end: to, complete: false, lastError: (error as Error).message, channel: 'wecom' })
        .catch(() => {});
      return { ok: false, error: (error as Error).message };
    }
  }

  async wecomCalendarQuery(args: Record<string, unknown>): Promise<unknown> {
    const { from, to } = parseZonedRange(args);
    const sync = await this.syncWecomCalendarWindow(from, to);
    const events = await this.deps.repos().calendar.eventsIn(WECOM_CALENDAR_ID, from, to);
    const state = await this.deps.repos().calendar.getSync(WECOM_CALENDAR_ID);
    return {
      calendarId: WECOM_CALENDAR_ID,
      channel: 'wecom',
      from: isoDate(from),
      to: isoDate(to),
      fresh: sync.ok,
      syncedAt: isoDate(state?.last_synced_at ?? null),
      message: sync.ok
        ? `共 ${events.length} 个企微日程（不含已取消）。`
        : `本次企微同步失败（${sync.error}）；以下为投影数据，可能过期，不视为完整日历。`,
      events: events.map(e => ({
        eventId: e.event_id,
        summary: e.summary,
        start: isoDate(e.start_time),
        end: isoDate(e.end_time),
        allDay: e.is_all_day,
        timezone: e.timezone,
        attendees: e.attendees,
      })),
    };
  }

  async wecomCalendarBusy(args: Record<string, unknown>): Promise<unknown> {
    const { from, to } = parseZonedRange(args);
    const sync = await this.syncWecomCalendarWindow(from, to);
    const events = await this.deps.repos().calendar.eventsIn(WECOM_CALENDAR_ID, from, to);
    return {
      fresh: sync.ok,
      channel: 'wecom',
      message: sync.ok ? `该时段忙闲如下（${events.length} 项，企微）。` : `本次企微同步失败（${sync.error}）；展示投影，可能过期。`,
      busy: events.map(e => ({ summary: e.summary, start: isoDate(e.start_time), end: isoDate(e.end_time), allDay: e.is_all_day })),
    };
  }

  async wecomCalendarWrite(item: WorkItemRow, kind: 'create' | 'update' | 'cancel', args: Record<string, unknown>): Promise<unknown> {
    if (kind === 'update') {
      throw new Error('企微日程首版不支持修改（F16 范围：查询/创建/取消）；如需变更，可取消后重建，或本人手动调整。');
    }
    const summary = kind === 'cancel' ? null : args.summary === undefined ? null : text(args.summary, 500);
    const start = args.start !== undefined ? new Date(String(args.start)) : null;
    const end = args.end !== undefined ? new Date(String(args.end)) : null;
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) throw new Error('日程时间需为可解析的 ISO 时间。');
    if (start && end && end <= start) throw new Error('结束时间须晚于开始时间。');
    if (kind === 'create' && (!summary || !start || !end)) throw new Error('创建需要 summary、start、end。');
    const eventId = kind === 'create' ? '' : String(args.eventId ?? '');
    if (kind === 'cancel' && !eventId) throw new Error('需要 eventId（可先 calendar_query 查询企微日程）。');
    const tz = this.deps.config().timeZone;
    const paramsKey = `wecom\n${kind}\n${eventId}\n${summary ?? ''}\n${start?.toISOString() ?? ''}\n${end?.toISOString() ?? ''}`;
    return this.deps.gate(`calendar-event:${eventId || 'wecom-new'}`, async () => {
      const staged = await this.deps.stagedOperation(
        item,
        `wecom_calendar.${kind}`,
        paramsKey,
        { channel: 'wecom', kind, eventId, summary, start, end },
        '请先用 calendar_query 重新同步窗口核对企微日程实际状态，确认后再继续。',
      );
      if (!staged.created && staged.row.status === 'succeeded') {
        return { operationId: staged.row.id, reused: true, ...(staged.row.receipt ?? {}), message: '此企微日程操作此前已提交，未重复写入。' };
      }
      try {
        let newEventId = eventId;
        if (kind === 'create') {
          const { data } = await this.wecomRun([
            'calendar', 'schedules', 'create',
            '--subject', `[24PA] ${summary}`,
            '--begin-time', wecomWallTime(start!, tz),
            '--end-time', wecomWallTime(end!, tz),
          ]);
          newEventId = String(data?.schedule_id ?? '');
          if (!newEventId) throw new Error('企微创建成功但未返回 schedule_id；以 calendar_query 核对。');
          await this.deps.repos().calendar.upsertEvent({
            event_id: newEventId,
            calendar_id: WECOM_CALENDAR_ID,
            summary: `[24PA] ${summary}`,
            start_time: start!,
            end_time: end!,
            is_all_day: false,
            timezone: tz,
            status: 'active',
            recurring: false,
            attendees: null,
            url: null,
            raw: data,
            channel: 'wecom',
          });
        } else {
          await this.wecomRun(['calendar', 'schedules', 'cancel', '--schedule-id', eventId]);
          await this.deps.repos().calendar.markCanceled(eventId).catch(() => {});
          await this.deps.notifySourceChanged('calendar', eventId, null);
        }
        await this.deps.repos().operations.update(staged.row.id, { status: 'succeeded', receipt: { eventId: newEventId, url: null, kind, channel: 'wecom' } });
        return {
          operationId: staged.row.id,
          eventId: newEventId,
          url: null,
          message: kind === 'create' ? '企微日程已创建（以平台回执为准）。' : '企微日程已取消（以平台回执为准）。',
        };
      } catch (error) {
        await this.deps.failStaged(staged.row.id, error);
        throw error;
      }
    });
  }

  async wecomTaskCreate(item: WorkItemRow, args: Record<string, unknown>): Promise<unknown> {
    const summary = text(args.summary, 500);
    const { dueAt, dueHasTime } = parseDue(args.due);
    const plannedAt = args.plannedAt ? new Date(String(args.plannedAt)) : null;
    if (plannedAt && Number.isNaN(plannedAt.getTime())) throw new Error('计划投入时间无法解析。');
    const estimateMinutes = args.estimateMinutes == null ? null : Number(args.estimateMinutes);
    if (estimateMinutes != null && (!Number.isFinite(estimateMinutes) || estimateMinutes < 0)) throw new Error('估时需为非负分钟数。');
    const batchSuffix = args.opSuffix ? `\n${String(args.opSuffix)}` : '';
    const overrideId = args._operationId ? String(args._operationId) : null;
    const authorization = args._instruction ? { instruction: text(args._instruction, 500) } : {};
    const staged = overrideId
      ? await this.deps.stagedOperationWithId(overrideId, item, 'wecom_todo.create', { channel: 'wecom', summary, due: args.due ? String(args.due) : null, ...authorization })
      : await this.deps.stagedOperation(item, 'wecom_todo.create', `wecom\n${summary}\n${args.due ?? ''}${batchSuffix}`, {
          channel: 'wecom',
          summary,
          due: args.due ? String(args.due) : null,
          ...authorization,
        });
    if (!staged.created && staged.row.status === 'succeeded') {
      const existing = await this.deps.repos().tasks.get(staged.row.id);
      return { operationId: staged.row.id, reused: true, guid: existing?.task_guid ?? staged.row.receipt?.guid, url: null, message: '此企微待办此前已创建，未重复写入。' };
    }
    try {
      const tz = this.deps.config().timeZone;
      const todoItem: Record<string, unknown> = { title: `[24PA] ${summary}` };
      if (dueAt) {
        todoItem.deadline = { type: dueHasTime ? 'datetime' : 'date', value: dueHasTime ? wecomWallTime(dueAt, tz) : wecomWallTime(dueAt, tz).slice(0, 10) };
        todoItem.remind_at_deadline = true;
      }
      const { data } = await this.wecomRun(['todo', 'create', '--items', JSON.stringify([todoItem])]);
      const created = (data?.items ?? [])[0] as any;
      const guid = String(created?.todo_id ?? '');
      if (created?.success === false || !guid) {
        throw new Error(`企微待办创建未成功：${created?.title ?? '未返回 todo_id'}；请核对企微待办列表后重试。`);
      }
      const task = await this.deps.repos().tasks.save({
        id: staged.row.id,
        work_item_id: item.id,
        task_guid: guid,
        url: null,
        summary,
        due_at: dueAt,
        due_has_time: dueHasTime,
        planned_at: plannedAt,
        estimate_minutes: estimateMinutes == null ? null : Math.round(estimateMinutes),
        status: 'open',
        external_updated_at: new Date(),
        last_synced_at: new Date(),
        channel: 'wecom',
      });
      if (args.projectId) await this.deps.repos().projects.link(String(args.projectId), task.id);
      await this.deps.repos().operations.update(staged.row.id, { status: 'succeeded', receipt: { guid, summary } });
      return { operationId: staged.row.id, guid, url: null, dueAt: isoDate(task.due_at), plannedAt: isoDate(task.planned_at), estimateMinutes: task.estimate_minutes, channel: 'wecom', message: '企微待办已创建（企微为权威对象）。' };
    } catch (error) {
      await this.deps.failStaged(staged.row.id, error);
      throw error;
    }
  }

  /** Best-effort refresh for wecom todo rows (todo list has no single-get filter). */
  async refreshWecomTaskFromRemote(task: TaskRow): Promise<TaskRow | null> {
    try {
      const { data } = await this.wecomRun(['todo', 'list']);
      const remote = ((data?.items ?? data?.todos ?? []) as any[]).find(t => String(t?.todo_id) === task.task_guid);
      if (!remote) return null;
      const status = remote.status === 'proceed' ? 'open' : 'completed';
      return await this.deps.repos().tasks.save({
        ...task,
        status,
        last_synced_at: new Date(),
        external_updated_at: new Date(),
      });
    } catch {
      return null;
    }
  }

  async wecomTaskFinish(item: WorkItemRow, task: TaskRow): Promise<unknown> {
    return this.deps.gate(`task:${task.task_guid}`, async () => {
      const local = await this.deps.repos().tasks.get(task.id);
      if (!local) throw new Error('待办不存在；请先用 task_list 查看。');
      const refreshed = (await this.refreshWecomTaskFromRemote(local)) ?? local;
      if (refreshed.status === 'completed') {
        return { guid: refreshed.task_guid, status: 'completed', reused: true, message: '企微待办此前已是完成状态（含远端核对）。' };
      }
      const staged = await this.deps.stagedOperation(item, 'wecom_todo.finish', refreshed.task_guid, { channel: 'wecom', guid: refreshed.task_guid });
      if (!staged.created && staged.row.status === 'succeeded') {
        await this.deps.repos().tasks.save({ ...refreshed, status: 'completed' });
        return { operationId: staged.row.id, guid: refreshed.task_guid, status: 'completed', reused: true, message: '此前已完成，未重复提交。' };
      }
      try {
        const { data } = await this.wecomRun(['todo', 'finish', '--items', JSON.stringify([{ todo_id: refreshed.task_guid }])]);
        const finished = ((data?.items ?? []) as any[])[0];
        if (finished?.success === false) throw new Error('企微待办完成未成功；请核对企微待办列表后重试。');
        const updated = await this.deps.repos().tasks.save({ ...refreshed, status: 'completed', last_synced_at: new Date(), external_updated_at: new Date() });
        await this.deps.repos().operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: refreshed.task_guid, status: 'completed' } });
        return { operationId: staged.row.id, guid: updated.task_guid, url: null, status: 'completed', channel: 'wecom', message: '企微待办已完成（以企微实际状态为准）。' };
      } catch (error) {
        await this.deps.failStaged(staged.row.id, error);
        throw error;
      }
    });
  }

  /** wecom todos do have a delete API — unlike the Feishu task platform. */
  async wecomTaskDelete(item: WorkItemRow, task: TaskRow, reason: string): Promise<unknown> {
    return this.deps.gate(`task:${task.task_guid}`, async () => {
      const staged = await this.deps.stagedOperation(item, 'wecom_todo.delete', task.task_guid, { channel: 'wecom', guid: task.task_guid, reason });
      if (!staged.created && staged.row.status === 'succeeded') {
        return { operationId: staged.row.id, guid: task.task_guid, status: 'canceled', reused: true, message: '此企微待办此前已删除。' };
      }
      try {
        const { data } = await this.wecomRun(['todo', 'delete', '--items', JSON.stringify([{ todo_id: task.task_guid }])]);
        const deleted = ((data?.items ?? []) as any[])[0];
        if (deleted?.success === false) throw new Error('企微待办删除未成功；请核对企微待办列表后重试。');
        await this.deps.repos().tasks.save({ ...task, status: 'canceled', last_synced_at: new Date(), external_updated_at: new Date() });
        await this.deps.repos().operations.update(staged.row.id, { status: 'succeeded', receipt: { guid: task.task_guid, status: 'canceled', reason } });
        return { operationId: staged.row.id, guid: task.task_guid, status: 'canceled', channel: 'wecom', message: `企微待办已删除（理由已记录：${reason}）。` };
      } catch (error) {
        await this.deps.failStaged(staged.row.id, error);
        throw error;
      }
    });
  }

  /** Single-direction wecom push via the smart-bot markdown channel. */
  async wecomSendText(target: string, text: string, uuid: string): Promise<{ messageId: string }> {
    // Markdown control characters in reminder prose must not restyle the
    // message; escape the inline markers wecom markdown honors.
    const escaped = text.replace(/([*_`#\[\]])/g, '\\$1');
    const { data } = await this.wecomRun([
      'message', 'aibot', 'send',
      '--chat-id', target,
      '--msg-type', 'markdown',
      '--markdown', JSON.stringify({ content: escaped }),
    ]);
    if (data?.success !== true) throw new Error('企微推送未获平台确认（success!=true）。');
    return { messageId: `wecom:${uuid}` };
  }

  /** Read-only view of the last wecom inspection (no platform calls). */
  wecomDiagnosticsSnapshot(): WecomDiagnostics | null {
    return this.diagnostics;
  }

  /** On-demand read-only wecom access inspection (CLI/identity/service probes). */
  async wecomCheck(): Promise<WecomDiagnostics> {
    if (!this.deps.config()) throw new Error('尚未绑定工作区。');
    const nextSteps: string[] = [];
    const services: WecomServiceCheck[] = [];
    const checkedAt = nowIso();
    // 1. CLI presence: `--version` prints plain text (not the JSON envelope),
    // so it runs through a raw spawn rather than the business gateway.
    let cli: WecomDiagnostics['cli'];
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const run = promisify(execFile);
      const { stdout } = await run(this.deps.cli().wecomCliBin, ['--version'], { timeout: Math.min(this.deps.cli().cliTimeoutMs, 10_000) });
      cli = { state: 'ok', message: `wecom-cli ${String(stdout).trim() || '已安装'}` };
    } catch (error) {
      cli = { state: 'error', message: `无法运行 ${this.deps.cli().wecomCliBin}：${(error as Error).message}` };
      nextSteps.push('安装官方企微 CLI：npm i -g @wecom/cli（详见 wecom-setup.md 准备节）。');
      const result: WecomDiagnostics = { checkedAt, cli, auth: { state: 'error', message: 'CLI 不可用，跳过。' }, identity: { state: 'missing', message: '未解析。' }, services, nextSteps };
      this.wecomDiagnostics = result;
      return result;
    }
    // 2. Identity (whoami covers bot binding + authorized human in one call).
    let identity: WecomDiagnostics['identity'];
    let userid: string | null = null;
    try {
      const owner = await this.wecomOwnerUserid();
      userid = owner.userid;
      identity = { state: 'ok', message: `机器人已绑定；授权真人 ${owner.name}（${owner.userid}）`, userid: owner.userid, userName: owner.name };
    } catch (error) {
      identity = { state: 'error', message: (error as Error).message };
      nextSteps.push('在服务器执行 wecom-cli auth init 并由本人企微扫码绑定机器人（wecom-setup.md 块 A）。');
    }
    // 3. Per-service authorization probes (read-only) for enabled domains.
    const probes: Array<{ id: WecomServiceCheck['id']; enabled: boolean; args: readonly string[] }> = [
      { id: 'calendar', enabled: this.deps.config().calendarChannel === 'wecom', args: ['calendar', 'schedules', 'list'] },
      { id: 'todo', enabled: this.deps.config().todoChannel === 'wecom', args: ['todo', 'list'] },
      { id: 'push', enabled: this.deps.config().notifyChannel === 'wecom', args: [] },
    ];
    for (const probe of probes) {
      if (!probe.enabled) continue;
      if (probe.id === 'push') {
        services.push({
          id: 'push',
          state: userid ? 'ok' : 'error',
          message: userid
            ? `推送目标已解析（${userid}）；无只读探针，以首次真实推送为准。`
            : '推送目标未解析（见身份检查）。',
        });
        continue;
      }
      try {
        await this.wecomRun(probe.args);
        services.push({ id: probe.id, state: 'ok', message: '只读探测通过。' });
      } catch (error) {
        const errcode = (error as WecomCliError)?.errcode;
        const helpMessage = (error as WecomCliError)?.helpMessage;
        const state: WecomServiceCheck['state'] = errcode === 850002 ? 'unauthorized' : errcode === 850003 ? 'expired' : errcode === 853006 ? 'unavailable' : 'error';
        services.push({ id: probe.id, state, message: (error as Error).message, helpMessage });
        if (helpMessage) nextSteps.push(helpMessage);
        else if (state === 'unavailable') nextSteps.push(`该企业未开放「${probe.id === 'calendar' ? '日程' : '待办'}」机器人能力（853006），无法由助理侧修复。`);
      }
    }
    if (nextSteps.length === 0) nextSteps.push('企微渠道检查通过。服务级授权会过期（实测日程授权曾过期），异常时回到本检查。');
    const result: WecomDiagnostics = { checkedAt, cli, auth: { state: identity.state === 'ok' ? 'ok' : 'error', message: identity.message }, identity, services, nextSteps };
    this.wecomDiagnostics = result;
    return result;
  }

  /** F23: one monitoring pass — read-only wecom_check, alert on renewal states. */
  async authTick(): Promise<void> {
    if (this.deps.isClosed() || !this.deps.repos() || !this.deps.config()) return;
    const config = this.deps.config();
    if (!anyWecomChannel(config)) return;
    let plan;
    try {
      // The probe always runs so diagnostics stay fresh even while the
      // notify side is suppressed.
      const diagnostics = await this.wecomCheck();
      const dayKey = wecomWallTime(new Date(), config.timeZone ?? 'Asia/Shanghai').slice(0, 10);
      plan = wecomAuthAlertPlan(diagnostics.services, dayKey);
    } catch {
      return; // probe failures surface through on-demand checks, not the monitor
    }
    if (!plan) return;
    const now = Date.now();
    // Suppression is a single in-memory window (a restart may re-alert once);
    // the day-scoped dedup key keeps the outbox from double-sending per day.
    // The window only advances after a successful enqueue, so a failed push
    // retries on the next tick instead of being silenced for a day.
    if (now - this.wecomAuthLastAlertAt < WECOM_AUTH_ALERT_SUPPRESS_MS) return;
    try {
      await this.deps.notifyOwner(plan.dedupKey, plan.text);
    } catch {
      return; // leave the window unstamped so the next tick retries
    }
    this.wecomAuthLastAlertAt = now;
  }
}
