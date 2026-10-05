import { randomUUID } from 'node:crypto';
import {
  ScheduleId,
  createAfterScheduleRecord,
  createAtScheduleRecord,
  createEveryScheduleRecord,
  createDailyScheduleRecord,
  createWeeklyScheduleRecord,
  resolveRecurringOccurrence,
  type RecurringScheduleRecord,
} from '@deepseek-ai/dsh-schedule';
import type { PaDatabase } from './pg.js';
import { ReminderRepo, type ReminderRuleRow } from './repo.js';

// Deterministic reminders (P18/P20): rule state and every occurrence live in
// PostgreSQL; delivery goes through the durable outbox, so nothing here needs
// a live model. Time math reuses the public dsh-schedule functions — no
// private runtime, no second time engine. Quiet hours / temporary vacation
// (P15/P21) are read from the memory authority at dispatch time.

export interface SilencePolicy {
  silentUntil(): Promise<Date | null>;
  reason(): Promise<string | null>;
}

export interface ReminderEngineHooks {
  /** Enqueue one durable owner notification; returns the outbox dedup key. */
  notify(dedupKey: string, text: string): Promise<void>;
  /** Look up an outbox row's send state by dedup key (platform acceptance). */
  outboxState(dedupKey: string): Promise<{ status: string; messageId: string | null } | null>;
}

export interface CreateReminderInput {
  kind: 'once' | 'every' | 'daily' | 'weekly';
  text: string;
  /** once: delay in seconds from now (or absolute at ISO when at is set). */
  afterSeconds?: number;
  at?: string;
  everySeconds?: number;
  /** daily/weekly: local HH:mm:ss. */
  time?: string;
  weekdays?: number[];
  timeZone: string;
  source?: string;
  workItemId?: string;
}

export class ReminderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderError';
  }
}

export class ReminderEngine {
  private readonly db: PaDatabase;
  private readonly repo: ReminderRepo;
  private readonly hooks: ReminderEngineHooks;
  private readonly policy: SilencePolicy;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private closed = false;

  constructor(db: PaDatabase, hooks: ReminderEngineHooks, policy: SilencePolicy) {
    this.db = db;
    this.repo = new ReminderRepo(db);
    this.hooks = hooks;
    this.policy = policy;
  }

  start(tickMs: number): void {
    this.timer = setInterval(() => {
      // A failed tick (bad SQL, transient PG drop) must never take down the
      // Host; the next interval retries and occurrences stay pending.
      void this.tick().catch(error => {
        if (!this.closed) console.warn(`[pa24] 提醒调度轮次失败：${(error as Error).message}`);
      });
    }, tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async create(input: CreateReminderInput): Promise<{ ruleId: string; nextDueAt: string | null; message: string }> {
    const text = input.text.trim();
    if (!text) throw new ReminderError('提醒内容不能为空。');
    if (text.length > 500) throw new ReminderError('提醒内容过长（≤500 字）。');
    const timeZone = String(input.timeZone).trim() || 'Asia/Shanghai';
    const now = Date.now();
    const ruleId = `rmd-${randomUUID().slice(0, 12)}`;
    let record: unknown;
    let nextDueAt: Date | null;
    let kind: string;
    let originExpression: string | null = null;
    if (input.kind === 'once') {
      if (input.at) {
        const at = new Date(input.at);
        if (Number.isNaN(at.getTime())) throw new ReminderError('once 的 at 需为可解析的 ISO 时间。');
        record = createAtScheduleRecord(ScheduleId(ruleId), text, at.toISOString(), now, text.slice(0, 100));
        nextDueAt = at;
        originExpression = at.toISOString();
      } else {
        const seconds = Number(input.afterSeconds);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 365 * 24 * 3600) {
          throw new ReminderError('once 需要 1 秒–365 天的延迟（afterSeconds）或绝对时间（at）。');
        }
        record = createAfterScheduleRecord(ScheduleId(ruleId), text, seconds, now, text.slice(0, 100));
        nextDueAt = new Date(now + seconds * 1000);
        originExpression = `after ${seconds}s`;
      }
      kind = 'once';
    } else if (input.kind === 'every') {
      const seconds = Number(input.everySeconds);
      if (!Number.isInteger(seconds)) throw new ReminderError('every 需要 everySeconds 整数秒。');
      // dsh-schedule enforces its own minimum; surface its error verbatim.
      record = createEveryScheduleRecord(ScheduleId(ruleId), text, seconds, now, text.slice(0, 100));
      const occurrence = resolveRecurringOccurrence(record as RecurringScheduleRecord, now);
      nextDueAt = new Date(occurrence.occurrenceAt);
      kind = 'every';
      originExpression = `every ${seconds}s`;
    } else if (input.kind === 'daily') {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(String(input.time ?? ''))) throw new ReminderError('daily 需要本地时间 HH:mm:ss。');
      record = createDailyScheduleRecord(ScheduleId(ruleId), text, { time: input.time!, time_zone: timeZone }, now, text.slice(0, 100));
      const occurrence = resolveRecurringOccurrence(record as RecurringScheduleRecord, now);
      nextDueAt = new Date(occurrence.occurrenceAt);
      kind = 'daily';
      originExpression = `daily ${input.time} ${timeZone}`;
    } else if (input.kind === 'weekly') {
      if (!/^\d{2}:\d{2}:\d{2}$/.test(String(input.time ?? ''))) throw new ReminderError('weekly 需要本地时间 HH:mm:ss。');
      if (!Array.isArray(input.weekdays) || input.weekdays.length === 0 || input.weekdays.some(d => !Number.isInteger(d) || d < 1 || d > 7)) {
        throw new ReminderError('weekly 需要 weekdays（ISO 1–7，周一=1）。');
      }
      record = createWeeklyScheduleRecord(ScheduleId(ruleId), text, { time: input.time!, time_zone: timeZone, weekdays: [...new Set(input.weekdays)].sort() }, now, text.slice(0, 100));
      const occurrence = resolveRecurringOccurrence(record as RecurringScheduleRecord, now);
      nextDueAt = new Date(occurrence.occurrenceAt);
      kind = 'weekly';
      originExpression = `weekly ${input.time} ${input.weekdays.join(',')} ${timeZone}`;
    } else {
      throw new ReminderError('不支持的提醒类型；cron 请等后续版本（如实说明）。');
    }
    const rule = await this.repo.insertRule({
      id: ruleId,
      kind,
      text,
      record,
      status: 'active',
      next_due_at: nextDueAt,
      time_zone: timeZone,
      origin_expression: originExpression,
      source: input.source ?? null,
      work_item_id: input.workItemId ?? null,
    });
    return {
      ruleId: rule.id,
      nextDueAt: rule.next_due_at ? new Date(rule.next_due_at).toISOString() : null,
      message: `提醒已保存（${kind}${originExpression ? `，${originExpression}` : ''}）；到期由业务账本触发，不依赖模型在线。`,
    };
  }

  async list(): Promise<unknown> {
    const rules = await this.repo.listRules();
    const occurrences = await this.repo.recentOccurrences(30);
    const rulesView = [];
    for (const rule of rules) {
      const next = await this.repo.nextPendingOccurrence(rule.id);
      rulesView.push({
        ruleId: rule.id,
        kind: rule.kind,
        text: rule.text,
        status: rule.status,
        timeZone: rule.time_zone,
        expression: rule.origin_expression,
        nextDueAt: rule.next_due_at ? new Date(rule.next_due_at).toISOString() : null,
        nextOccurrence: next ? { id: next.id, dueAt: new Date(next.due_at).toISOString(), status: next.status } : null,
      });
    }
    return {
      rules: rulesView,
      occurrences: occurrences.map(o => ({
        id: o.id,
        ruleId: o.rule_id,
        dueAt: new Date(o.due_at).toISOString(),
        status: o.status,
        deferredUntil: o.deferred_until ? new Date(o.deferred_until).toISOString() : null,
        origin: o.origin_occurrence_id,
      })),
    };
  }

  async setStatus(ruleId: string, status: 'active' | 'paused' | 'stopped', reason: string): Promise<unknown> {
    if (!reason.trim()) throw new ReminderError('变更提醒状态需要本人指令依据。');
    const rule = await this.repo.getRule(ruleId);
    if (!rule) throw new ReminderError('提醒不存在。');
    // Cancelling/pausing also cancels not-yet-dispatched occurrences so a
    // snoozed follow-up never fires after its rule is gone (P21).
    if (status !== 'active') {
      await this.db.query(
        `update pa24.reminder_occurrence set status = 'canceled', updated_at = now()
         where rule_id = $1 and status = 'pending'`,
        [ruleId],
      );
    }
    const next = status === 'active' && rule.kind !== 'once' ? await this.recomputeNext(rule, Date.now()) : rule.next_due_at;
    const updated = await this.repo.updateRule(ruleId, { status, next_due_at: next });
    return { ruleId, status: updated?.status ?? status, message: `提醒已${status === 'stopped' ? '停止（已排期的未发送实例一并取消）' : status === 'paused' ? '暂停' : '恢复'}。` };
  }

  /** Materialize a not-yet-due occurrence so skip/snooze can act on it. */
  private async ensurePendingOccurrence(rule: ReminderRuleRow): Promise<void> {
    if (rule.kind !== 'once' || !rule.next_due_at || rule.status !== 'active') return;
    const due = new Date(rule.next_due_at);
    await this.repo.insertOccurrence({ id: `${rule.id}:${due.toISOString()}`, ruleId: rule.id, dueAt: due });
    await this.repo.updateRule(rule.id, { status: 'completed', next_due_at: null });
  }

  async skipThis(ruleId: string, reason: string): Promise<unknown> {
    if (!reason.trim()) throw new ReminderError('跳过本次需要本人指令依据。');
    const rule = await this.repo.getRule(ruleId);
    if (!rule || rule.status !== 'active') throw new ReminderError('提醒不存在或未处于活动状态。');
    await this.ensurePendingOccurrence(rule);
    const next = await this.repo.nextPendingOccurrence(ruleId);
    if (next) await this.repo.updateOccurrence(next.id, { status: 'skipped' });
    const advanced = rule.kind === 'once' ? null : await this.recomputeNext(rule, Date.now());
    await this.repo.updateRule(ruleId, { next_due_at: advanced });
    return { ruleId, skippedOccurrence: next?.id ?? null, message: '已跳过本次；周期规则按计划继续。' };
  }

  async snooze(ruleId: string, seconds: number, reason: string): Promise<unknown> {
    if (!reason.trim()) throw new ReminderError('稍后提醒需要本人指令依据。');
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 7 * 24 * 3600) throw new ReminderError('稍后需为 1 秒–7 天。');
    const rule = await this.repo.getRule(ruleId);
    if (!rule || ['stopped', 'paused'].includes(rule.status)) throw new ReminderError('提醒不存在或已停止/暂停。');
    await this.ensurePendingOccurrence(rule);
    const next = await this.repo.nextPendingOccurrence(ruleId);
    if (!next) throw new ReminderError('没有待发送的提醒实例。');
    if (next.origin_occurrence_id) throw new ReminderError('该实例已是稍后实例；请勿重复延后。');
    await this.repo.updateOccurrence(next.id, { status: 'snoozed' });
    // Linked follow-up: idempotent per (origin, target) so repeated requests
    // never create a pile of deferred copies (P18).
    const target = new Date(Date.now() + seconds * 1000);
    const followUpId = `${ruleId}:${target.toISOString()}`;
    await this.repo.insertOccurrence({ id: followUpId, ruleId, dueAt: target, originOccurrenceId: next.id });
    return { ruleId, snoozedOccurrence: next.id, followUpId, dueAt: target.toISOString(), message: `已稍后 ${seconds} 秒提醒（关联原实例）。` };
  }

  async occurrenceStatus(occurrenceId: string): Promise<unknown> {
    const occurrence = await this.repo.occurrence(occurrenceId);
    if (!occurrence) throw new ReminderError('提醒实例不存在。');
    const outbox = occurrence.outbox_dedup_key ? await this.hooks.outboxState(occurrence.outbox_dedup_key) : null;
    return {
      id: occurrence.id,
      ruleId: occurrence.rule_id,
      dueAt: new Date(occurrence.due_at).toISOString(),
      status: occurrence.status,
      // Platform acceptance only — never infer read or done.
      delivery: outbox ? { status: outbox.status, messageId: outbox.messageId } : null,
      message: outbox ? `发送状态：${outbox.status}${outbox.messageId ? `（平台消息 ${outbox.messageId}）` : ''}；仅代表平台接受，不代表已读。` : '尚未进入发送。',
    };
  }

  private async recomputeNext(rule: ReminderRuleRow, now: number): Promise<Date | null> {
    if (rule.kind === 'once') return rule.next_due_at ? new Date(rule.next_due_at) : null;
    const occurrence = resolveRecurringOccurrence(rule.record as RecurringScheduleRecord, now);
    return new Date(occurrence.occurrenceAt);
  }

  async tick(): Promise<void> {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      await this.materialize();
      await this.dispatch();
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Materialize due occurrences from active rules. Recurring rules advance to
   * the next target atomically with the occurrence insert; a crash between
   * ticks re-derives at most the latest missed occurrence (dsh-schedule
   * semantics), never a backlog flood.
   */
  private async materialize(): Promise<void> {
    const now = new Date();
    const rules = await this.repo.dueRuleIds(now, 5000);
    for (const rule of rules) {
      if (rule.kind === 'once') {
        const due = rule.next_due_at!;
        const occurrenceId = `${rule.id}:${new Date(due).toISOString()}`;
        await this.repo.insertOccurrence({ id: occurrenceId, ruleId: rule.id, dueAt: new Date(due) });
        await this.repo.updateRule(rule.id, { status: 'completed', next_due_at: null });
        continue;
      }
      const resolved = resolveRecurringOccurrence(rule.record as RecurringScheduleRecord, now.getTime());
      const occurrenceId = `${rule.id}:${new Date(resolved.occurrenceAt).toISOString()}`;
      await this.repo.insertOccurrence({ id: occurrenceId, ruleId: rule.id, dueAt: new Date(resolved.occurrenceAt) });
      const nextTarget = resolved.nextScheduledAt ?? resolved.occurrenceAt;
      await this.repo.updateRule(rule.id, { next_due_at: new Date(nextTarget) });
    }
  }

  private async dispatch(): Promise<void> {
    const now = new Date();
    const due = await this.repo.claimDueOccurrences(now, 20);
    for (const occurrence of due) {
      const rule = await this.repo.getRule(occurrence.rule_id);
      if (!rule || rule.status === 'stopped') {
        await this.repo.updateOccurrence(occurrence.id, { status: 'canceled' });
        continue;
      }
      if (rule.status === 'paused') {
        // Paused rules hold their due occurrences, they do not cancel them.
        await this.repo.updateOccurrence(occurrence.id, { status: 'pending', deferred_until: null });
        continue;
      }
      // 'completed' one-shot rules still deliver their materialized occurrence.
      const silentUntil = await this.policy.silentUntil();
      if (silentUntil && silentUntil.getTime() > now.getTime()) {
        // Quiet hours / vacation: hold the occurrence, do not drop it (P21).
        await this.repo.updateOccurrence(occurrence.id, { status: 'pending', deferred_until: silentUntil, last_error: null });
        continue;
      }
      const dedupKey = `reminder:${occurrence.id}`;
      await this.hooks.notify(dedupKey, `提醒：${rule.text}`);
      await this.repo.updateOccurrence(occurrence.id, { status: 'sent', outbox_dedup_key: dedupKey, deferred_until: null });
    }
  }
}
