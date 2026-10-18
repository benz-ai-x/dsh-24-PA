// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb } from '../db.js';

export interface DigestPlanRow {
  id: string;
  kind: 'morning' | 'evening' | 'weekly' | 'once' | string;
  title: string;
  schedule_id: string | null;
  session_id: string;
  schedule_spec: any;
  status: 'active' | 'paused' | 'stopped' | string;
  last_window: string | null;
  /** F19（spec 2.3）：本计划是否投递语音版（引擎取工作区 tts 配置）。 */
  voice: boolean;
  /** F40（spec 2.11）：绑定的任务 skill 名（内置 digest-* 或工作区自定义）。 */
  skill: string;
  created_at: Date;
  updated_at: Date;
}

export interface DigestOccurrenceRow {
  id: string;
  plan_id: string;
  window_key: string;
  status: 'delivering' | 'model_done' | 'sent' | 'unconfirmed' | string;
  report: any;
  outbox_key: string | null;
  delivered_at: Date | null;
  completed_at: Date | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

function digestPatch(setsOut: string[], valuesOut: unknown[], patch: Record<string, unknown>, jsonKeys: readonly string[] = []): void {
  for (const [key, value] of Object.entries(patch)) {
    setsOut.push(`${key} = $${valuesOut.length + 1}`);
    valuesOut.push(jsonKeys.includes(key) ? JSON.stringify(value) : value ?? null);
  }
}

export class DigestRepo {
  constructor(private readonly db: PaDb) {}

  async insertPlan(row: Omit<DigestPlanRow, 'created_at' | 'updated_at'>): Promise<DigestPlanRow> {
    const result = await this.db.query<DigestPlanRow>(
      `insert into pa24.digest_plan (id, kind, title, schedule_id, session_id, schedule_spec, status, last_window, voice, skill)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [row.id, row.kind, row.title, row.schedule_id, row.session_id, JSON.stringify(row.schedule_spec), row.status, row.last_window, row.voice, row.skill],
    );
    return result.rows[0]!;
  }

  async getPlan(id: string): Promise<DigestPlanRow | null> {
    const result = await this.db.query<DigestPlanRow>('select * from pa24.digest_plan where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async updatePlan(id: string, patch: Partial<Pick<DigestPlanRow, 'schedule_id' | 'schedule_spec' | 'status' | 'last_window' | 'title' | 'voice' | 'skill'>>): Promise<DigestPlanRow | null> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    digestPatch(sets, values, patch, ['schedule_spec']);
    const result = await this.db.query<DigestPlanRow>(`update pa24.digest_plan set ${sets.join(', ')} where id = $1 returning *`, values);
    return result.rows[0] ?? null;
  }

  async listPlans(status?: string): Promise<DigestPlanRow[]> {
    const result = status
      ? await this.db.query<DigestPlanRow>('select * from pa24.digest_plan where status = $1 order by created_at', [status])
      : await this.db.query<DigestPlanRow>('select * from pa24.digest_plan order by created_at');
    return result.rows;
  }

  /** Active meeting-prep plans bound to one calendar event (F28): the
   *  duplicate-start guard and the source-change cancel path share it. */
  async activeMeetingPreps(eventId: string): Promise<Array<{ id: string; schedule_id: string | null; session_id: string }>> {
    const result = await this.db.query<{ id: string; schedule_id: string | null; session_id: string }>(
      `select id, schedule_id, session_id from pa24.digest_plan where kind = 'meeting_prep' and status = 'active' and schedule_spec->>'eventId' = $1`,
      [eventId],
    );
    return result.rows;
  }

  /** Claim one window for one plan; a repeat delivery in the same window returns the existing row. */
  async claimOccurrence(row: { planId: string; windowKey: string }): Promise<{ created: boolean; row: DigestOccurrenceRow }> {
    const id = `${row.planId}:${row.windowKey}`;
    const result = await this.db.query<DigestOccurrenceRow>(
      `insert into pa24.digest_occurrence (id, plan_id, window_key, status, delivered_at)
       values ($1,$2,$3,'delivering', now()) on conflict (plan_id, window_key) do nothing returning *`,
      [id, row.planId, row.windowKey],
    );
    if ((result.rowCount ?? 0) > 0) return { created: true, row: result.rows[0]! };
    const existing = await this.db.query<DigestOccurrenceRow>('select * from pa24.digest_occurrence where plan_id = $1 and window_key = $2', [row.planId, row.windowKey]);
    return { created: false, row: existing.rows[0]! };
  }

  async updateOccurrence(id: string, patch: Partial<Pick<DigestOccurrenceRow, 'status' | 'report' | 'outbox_key' | 'completed_at' | 'error'>>): Promise<void> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    digestPatch(sets, values, patch, ['report']);
    await this.db.query(`update pa24.digest_occurrence set ${sets.join(', ')} where id = $1`, values);
  }

  async occurrencesOf(planId: string, limit = 20): Promise<DigestOccurrenceRow[]> {
    const result = await this.db.query<DigestOccurrenceRow>(
      'select * from pa24.digest_occurrence where plan_id = $1 order by created_at desc limit $2',
      [planId, limit],
    );
    return result.rows;
  }
}

export interface MinutesRow {
  id: string;
  work_item_id: string | null;
  event_id: string | null;
  topic: string;
  memo_id: string | null;
  doc_url: string | null;
  candidates: any;
  status: 'draft' | 'actions_taken' | string;
  created_at: Date;
  updated_at: Date;
}

export class MinutesRepo {
  constructor(private readonly db: PaDb) {}

  async insert(row: Omit<MinutesRow, 'created_at' | 'updated_at'>): Promise<MinutesRow> {
    const result = await this.db.query<MinutesRow>(
      `insert into pa24.minutes (id, work_item_id, event_id, topic, memo_id, doc_url, candidates, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [row.id, row.work_item_id, row.event_id, row.topic, row.memo_id, row.doc_url, JSON.stringify(row.candidates ?? []), row.status],
    );
    return result.rows[0]!;
  }

  async get(id: string): Promise<MinutesRow | null> {
    const result = await this.db.query<MinutesRow>('select * from pa24.minutes where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async update(id: string, patch: Partial<Pick<MinutesRow, 'memo_id' | 'doc_url' | 'candidates' | 'status'>>): Promise<void> {
    const sets = ['updated_at = now()'];
    const values: unknown[] = [id];
    digestPatch(sets, values, patch, ['candidates']);
    await this.db.query(`update pa24.minutes set ${sets.join(', ')} where id = $1`, values);
  }

  /** Latest minutes for meeting-prep scoping (F28). */
  async recent(limit: number): Promise<Array<Pick<MinutesRow, 'id' | 'topic' | 'doc_url' | 'candidates'>>> {
    const result = await this.db.query<Pick<MinutesRow, 'id' | 'topic' | 'doc_url' | 'candidates'>>(
      `select id, topic, doc_url, candidates from pa24.minutes order by created_at desc limit $1`,
      [limit],
    );
    return result.rows;
  }
}

/** Cross-table maintenance statistics (F28): backup manifest watermarks and
 *  health/retry figures that previously lived as raw SQL in the runtime. */
