// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

export interface ReminderRuleRow {
  id: string;
  kind: string;
  text: string;
  record: any;
  status: string;
  next_due_at: Date | null;
  time_zone: string;
  origin_expression: string | null;
  source: string | null;
  work_item_id: string | null;
  /** P19: this reminder follows a task/calendar source; sent only while the fingerprint still matches. */
  link_source_type: 'task' | 'calendar' | null;
  link_source_id: string | null;
  link_fingerprint: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReminderOccurrenceRow {
  id: string;
  rule_id: string;
  due_at: Date;
  status: string;
  deferred_until: Date | null;
  origin_occurrence_id: string | null;
  outbox_dedup_key: string | null;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ReminderRepo {
  constructor(private readonly db: PaDb) {}

  async insertRule(row: Omit<ReminderRuleRow, 'created_at' | 'updated_at'>): Promise<ReminderRuleRow> {
    const result = await this.db.query<ReminderRuleRow>(
      `insert into pa24.reminder_rule (id, kind, text, record, status, next_due_at, time_zone, origin_expression, source, work_item_id, link_source_type, link_source_id, link_fingerprint)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [row.id, row.kind, row.text, JSON.stringify(row.record), row.status, row.next_due_at, row.time_zone, row.origin_expression, row.source, row.work_item_id,
       row.link_source_type ?? null, row.link_source_id ?? null, row.link_fingerprint ?? null],
    );
    return result.rows[0]!;
  }

  async updateRule(id: string, patch: Partial<Pick<ReminderRuleRow, 'status' | 'next_due_at' | 'record'>>): Promise<ReminderRuleRow | null> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(key === 'record' ? JSON.stringify(value) : value ?? null);
      n += 1;
    }
    const result = await this.db.query<ReminderRuleRow>(`update pa24.reminder_rule set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  /** Rules following a source, including finished one-shots: a completed rule
   *  may still owe its owner a correction for what was already sent (P19). */
  async rulesLinkedTo(sourceType: string, sourceId: string): Promise<ReminderRuleRow[]> {
    const result = await this.db.query<ReminderRuleRow>(
      `select * from pa24.reminder_rule where link_source_type = $1 and link_source_id = $2 and status in ('active', 'paused', 'completed')`,
      [sourceType, sourceId],
    );
    return result.rows;
  }

  /** Distinct calendar event ids linked to reminders overlapping [from, to)
   *  (calendar sync cancel path, F28): events outside the window were never
   *  observed and must not be falsely canceled. */
  async linkedEventIdsInWindow(from: Date, to: Date): Promise<string[]> {
    const result = await this.db.query<{ link_source_id: string }>(
      `select distinct r.link_source_id from pa24.reminder_rule r
       join pa24.calendar_event e on e.event_id = r.link_source_id
       where r.link_source_type = 'calendar' and not (e.end_time <= $1 or e.start_time >= $2)`,
      [from, to],
    );
    return result.rows.map(r => r.link_source_id);
  }

  /** Cancel not-yet-sent occurrences of one rule (source-change path, P19).
   *  unclaimedOnly (F28): leave rows whose defer window already elapsed —
   *  they are mid-claim by a dispatcher and cancel through the guarded path. */
  async cancelPendingOccurrences(ruleId: string, unclaimedOnly = false): Promise<number> {
    const guard = unclaimedOnly ? ' and (deferred_until is null or deferred_until > now())' : '';
    const result = await this.db.query(
      `update pa24.reminder_occurrence set status = 'canceled', updated_at = now() where rule_id = $1 and status = 'pending'${guard}`,
      [ruleId],
    );
    return result.rowCount ?? 0;
  }

  /** Sent/pending occurrence counts for one rule (correction decision, P19). */
  async occurrenceCounts(ruleId: string): Promise<{ sent: number; pending: number } | null> {
    const result = await this.db.query<{ sent: string; pending: string }>(
      `select count(*) filter (where status = 'sent') as sent, count(*) filter (where status = 'pending') as pending from pa24.reminder_occurrence where rule_id = $1`,
      [ruleId],
    ).catch(() => null);
    return result ? { sent: Number(result.rows[0]!.sent), pending: Number(result.rows[0]!.pending) } : null;
  }

  async getRule(id: string): Promise<ReminderRuleRow | null> {
    const result = await this.db.query<ReminderRuleRow>('select * from pa24.reminder_rule where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async listRules(status?: string): Promise<ReminderRuleRow[]> {
    const result = status
      ? await this.db.query<ReminderRuleRow>('select * from pa24.reminder_rule where status = $1 order by next_due_at nulls last limit 100', [status])
      : await this.db.query<ReminderRuleRow>('select * from pa24.reminder_rule order by next_due_at nulls last limit 100');
    return result.rows;
  }

  async dueRuleIds(now: Date, lookaheadMs: number): Promise<ReminderRuleRow[]> {
    const result = await this.db.query<ReminderRuleRow>(
      `select * from pa24.reminder_rule where status = 'active' and next_due_at is not null and next_due_at <= $1::timestamptz + make_interval(secs => $2)`,
      [now, lookaheadMs / 1000],
    );
    return result.rows;
  }

  /** Idempotent occurrence materialization (unique PK per rule+instant). */
  async insertOccurrence(row: { id: string; ruleId: string; dueAt: Date; originOccurrenceId?: string }): Promise<boolean> {
    const result = await this.db.query(
      `insert into pa24.reminder_occurrence (id, rule_id, due_at, origin_occurrence_id)
       values ($1,$2,$3,$4) on conflict (id) do nothing`,
      [row.id, row.ruleId, row.dueAt, row.originOccurrenceId ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async claimDueOccurrences(now: Date, limit: number): Promise<ReminderOccurrenceRow[]> {
    const result = await this.db.query<ReminderOccurrenceRow>(
      `update pa24.reminder_occurrence set attempts = attempts + 1
       where id in (
         select id from pa24.reminder_occurrence
         where status = 'pending' and due_at <= $1
           and (deferred_until is null or deferred_until <= $1)
         order by due_at limit $2 for update skip locked
       ) returning *`,
      [now, limit],
    );
    return result.rows;
  }

  /**
   * Update an occurrence. When `fromStatus` is given the update is guarded on
   * that status: terminal/control transitions (sent/skipped/snoozed/canceled)
   * only apply from pending, so an in-flight dispatch can never overwrite a
   * cancel/skip that landed first, and vice versa.
   */
  async updateOccurrence(
    id: string,
    patch: Partial<Pick<ReminderOccurrenceRow, 'status' | 'deferred_until' | 'outbox_dedup_key' | 'last_error'>>,
    fromStatus?: string,
  ): Promise<void> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [id];
    let n = 2;
    for (const [key, value] of Object.entries(patch)) {
      sets.push(`${key} = $${n}`);
      values.push(value ?? null);
      n += 1;
    }
    if (fromStatus) {
      values.push(fromStatus);
      await this.db.query(
        `update pa24.reminder_occurrence set ${sets.join(', ')} where id = $1 and status = $${n}::text`,
        values,
      );
      return;
    }
    await this.db.query(`update pa24.reminder_occurrence set ${sets.join(', ')} where id = $1`, values);
  }

  async nextPendingOccurrence(ruleId: string): Promise<ReminderOccurrenceRow | null> {
    const result = await this.db.query<ReminderOccurrenceRow>(
      `select * from pa24.reminder_occurrence where rule_id = $1 and status = 'pending' order by due_at limit 1`,
      [ruleId],
    );
    return result.rows[0] ?? null;
  }

  async occurrence(id: string): Promise<ReminderOccurrenceRow | null> {
    const result = await this.db.query<ReminderOccurrenceRow>('select * from pa24.reminder_occurrence where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async recentOccurrences(limit = 50): Promise<ReminderOccurrenceRow[]> {
    const result = await this.db.query<ReminderOccurrenceRow>('select * from pa24.reminder_occurrence order by updated_at desc limit $1', [limit]);
    return result.rows;
  }
}
