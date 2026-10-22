// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb, PaQueryer } from '../db.js';
import { enqueueOutbox, type NewOutbox } from './outbox.js';
import type { PlanIntent } from '../plan-lifecycle.js';
import type { DigestPeriod } from '../digest-period.js';
import type { DigestTriggerSource } from '../digest-trigger.js';
import { lockPlanSkill } from './skill.js';
import type { ResolvedTaskSkill } from '../skills.js';
import type { SkillPackage } from '../skill-package.js';
import { assertTaskPlanEnabled } from './task-plan.js';

export interface DigestPlanRow {
  id: string;
  kind: 'morning' | 'evening' | 'weekly' | 'once' | string;
  title: string;
  schedule_id: string | null;
  session_id: string;
  schedule_spec: any;
  lifecycle?: PlanIntent | null;
  revision?: number;
  schedule_generation?: string | null;
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
  time_context?: DigestPeriod | null;
  skill_snapshot?: { definition: ResolvedTaskSkill | null; package?: SkillPackage; versionId?: string } | null;
  plan_snapshot?: Pick<DigestPlanRow, 'kind' | 'title' | 'voice' | 'skill' | 'schedule_spec' | 'session_id'> | null;
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
    valuesOut.push(jsonKeys.includes(key) && value != null ? JSON.stringify(value) : value ?? null);
  }
}

export class DigestRepo {
  constructor(private readonly db: PaDb) {}

  async insertPlan(row: Omit<DigestPlanRow, 'created_at' | 'updated_at'>): Promise<DigestPlanRow> {
    return this.db.withTransaction(async tx => {
    await lockPlanSkill(tx, row.skill, row.id);
    const result = await tx.query<DigestPlanRow>(
      `insert into pa24.digest_plan (id, kind, title, schedule_id, session_id, schedule_spec, status, last_window, voice, skill, lifecycle)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [row.id, row.kind, row.title, row.schedule_id, row.session_id, JSON.stringify(row.schedule_spec), row.status, row.last_window, row.voice, row.skill, row.lifecycle ? JSON.stringify(row.lifecycle) : null],
    );
    return result.rows[0]!;
    });
  }

  async getPlan(id: string): Promise<DigestPlanRow | null> {
    const result = await this.db.query<DigestPlanRow>('select * from pa24.digest_plan where id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async updatePlan(id: string, patch: Partial<Pick<DigestPlanRow, 'schedule_id' | 'schedule_spec' | 'status' | 'last_window' | 'title' | 'voice' | 'skill' | 'kind' | 'lifecycle' | 'session_id'>>): Promise<DigestPlanRow | null> {
    return this.db.withTransaction(async tx => {
    const before = (await tx.query<DigestPlanRow>('select * from pa24.digest_plan where id = $1', [id])).rows[0];
    if (!before) return null;
    if (patch.skill !== undefined || patch.status === 'active' || patch.lifecycle?.targetStatus === 'active') {
      await lockPlanSkill(tx, patch.skill ?? before.skill, id, patch.skill !== undefined);
    }
    if (patch.status === 'active' || patch.lifecycle?.targetStatus === 'active') await assertTaskPlanEnabled(tx, id);
    const sets = ['updated_at = now()', 'revision = revision + 1'];
    const values: unknown[] = [id];
    digestPatch(sets, values, patch, ['schedule_spec', 'lifecycle']);
    // Compare the observed row as well: a concurrent rebind cannot slip past
    // validation of the previous Skill.
    values.push(before.revision ?? 0);
    const result = await tx.query<DigestPlanRow>(`update pa24.digest_plan set ${sets.join(', ')} where id = $1 and revision = $${values.length} returning *`, values);
    if (!result.rows[0]) throw new Error('计划状态已变化，请刷新后重试。');
    if (patch.skill !== undefined) await tx.query('delete from pa24.skill_plan_block where plan_id = $1', [id]);
    return result.rows[0] ?? null;
    });
  }

  async comparePlan(plan: DigestPlanRow, patch: Partial<Pick<DigestPlanRow, 'schedule_id' | 'schedule_spec' | 'status' | 'kind' | 'lifecycle' | 'schedule_generation'>>): Promise<DigestPlanRow> {
    return this.db.withTransaction(async tx => {
    if (patch.status === 'active' || patch.lifecycle?.targetStatus === 'active') await lockPlanSkill(tx, plan.skill, plan.id);
    if (patch.status === 'active' || patch.lifecycle?.targetStatus === 'active') await assertTaskPlanEnabled(tx, plan.id);
    const sets = ['updated_at = now()', 'revision = revision + 1'];
    const values: unknown[] = [plan.id, plan.revision ?? 0];
    digestPatch(sets, values, patch, ['schedule_spec', 'lifecycle']);
    const result = await tx.query<DigestPlanRow>(`update pa24.digest_plan set ${sets.join(', ')} where id = $1 and revision = $2 returning *`, values);
    if (!result.rows[0]) throw new Error('计划状态已变化，请读取当前状态后重试。');
    return result.rows[0];
    });
  }

  async listPlans(status?: string): Promise<DigestPlanRow[]> {
    const result = status
      ? await this.db.query<DigestPlanRow>('select * from pa24.digest_plan where status = $1 order by created_at', [status])
      : await this.db.query<DigestPlanRow>('select * from pa24.digest_plan order by created_at');
    return result.rows;
  }

  /** Active meeting-prep plans bound to one calendar event (F28): the
   *  duplicate-start guard and the source-change cancel path share it. */
  async activeMeetingPreps(eventId: string): Promise<Array<Pick<DigestPlanRow, 'id' | 'schedule_id' | 'session_id' | 'schedule_spec'>>> {
    const result = await this.db.query<Pick<DigestPlanRow, 'id' | 'schedule_id' | 'session_id' | 'schedule_spec'>>(
      `select id, schedule_id, session_id, schedule_spec from pa24.digest_plan where kind = 'meeting_prep' and (status = 'active' or lifecycle is not null) and schedule_spec->>'eventId' = $1`,
      [eventId],
    );
    return result.rows;
  }

  /** One unique window; only claimRun may attach it to an active plan. */
  private async claimOn(client: PaQueryer, row: { planId: string; windowKey: string; timeContext?: DigestPeriod; skillSnapshot: DigestOccurrenceRow['skill_snapshot']; planSnapshot: DigestOccurrenceRow['plan_snapshot'] }): Promise<{ created: boolean; row: DigestOccurrenceRow }> {
    const id = `${row.planId}:${row.windowKey}`;
    const result = await client.query<DigestOccurrenceRow>(
      `insert into pa24.digest_occurrence (id, plan_id, window_key, status, delivered_at, time_context, skill_snapshot, plan_snapshot)
       values ($1,$2,$3,'delivering', now(),$4,$5,$6) on conflict (plan_id, window_key) do nothing returning *`,
      [id, row.planId, row.windowKey, row.timeContext ? JSON.stringify(row.timeContext) : null, JSON.stringify(row.skillSnapshot), JSON.stringify(row.planSnapshot)],
    );
    if ((result.rowCount ?? 0) > 0) return { created: true, row: result.rows[0]! };
    const existing = await client.query<DigestOccurrenceRow>('select * from pa24.digest_occurrence where plan_id = $1 and window_key = $2', [row.planId, row.windowKey]);
    return { created: false, row: existing.rows[0]! };
  }

  /** The durable identity of one WorkItem's run survives midnight and retries. */
  async claimRun(input: { planId: string; windowKey: string; workItemId?: string; timeContext?: DigestPeriod; skill?: ResolvedTaskSkill | null; planRevision?: number }): Promise<{ created: boolean; row: DigestOccurrenceRow }> {
    return this.db.withTransaction(async client => {
      if (input.workItemId) {
        const binding = (await client.query<{ occurrence_id: string | null }>('select occurrence_id from pa24.digest_work_binding where work_item_id = $1 for update', [input.workItemId])).rows[0];
        if (binding?.occurrence_id) {
          const row = (await client.query<DigestOccurrenceRow>('select * from pa24.digest_occurrence where id = $1', [binding.occurrence_id])).rows[0];
          if (!row || row.plan_id !== input.planId) throw new Error('该事项已绑定其他计划或运行记录缺失；不能重新猜测窗口。');
          return { created: false, row: this.requireTimeContext(row, input.timeContext) };
        }
      }
      const observed = (await client.query<DigestPlanRow>('select * from pa24.digest_plan where id = $1', [input.planId])).rows[0];
      if (!observed) throw new Error('计划不存在。');
      if ('task_config' in observed && observed.task_config) throw new Error('此计划须通过固定授权的通用运行准入，不能从旧简报入口执行。');
      const version = await lockPlanSkill(client, observed.skill, observed.id);
      await assertTaskPlanEnabled(client, observed.id);
      const plan = (await client.query<DigestPlanRow>('select * from pa24.digest_plan where id = $1 for update', [input.planId])).rows[0];
      if (!plan || plan.status !== 'active') throw new Error(`计划 ${input.planId} 当前未开启，不能开始运行。`);
      if (plan.skill !== observed.skill || (input.planRevision !== undefined && plan.revision !== input.planRevision)) throw new Error('计划配置已变化，请重新读取后运行。');
      if (version && (input.skill?.metadata.pa24Identity as { versionId?: string } | undefined)?.versionId !== version.id) throw new Error('Skill 已更新，请重新读取后运行，不能混用新旧版本。');
      const skillSnapshot: DigestOccurrenceRow['skill_snapshot'] = input.skill === undefined ? null : { definition: input.skill,
        ...(version ? { package: version.package_data, versionId: version.id } : {}) };
      const { kind, title, voice, skill, schedule_spec, session_id } = plan;
      const claimed = await this.claimOn(client, { ...input, skillSnapshot, planSnapshot: input.skill === undefined ? null : { kind, title, voice, skill, schedule_spec, session_id } });
      if (input.workItemId) {
        const binding = await client.query(`insert into pa24.digest_work_binding as binding (work_item_id, occurrence_id) values ($1, $2)
          on conflict (work_item_id) do update set occurrence_id = excluded.occurrence_id
          where binding.occurrence_id is null returning occurrence_id`, [input.workItemId, claimed.row.id]);
        if (!binding.rowCount) throw new Error('该事项已绑定其他运行，不能覆盖原窗口。');
      }
      claimed.row = this.requireTimeContext(claimed.row, input.timeContext);
      return claimed;
    });
  }

  private requireTimeContext(row: DigestOccurrenceRow, context?: DigestPeriod): DigestOccurrenceRow {
    if (row.time_context || !context || ['model_done', 'sent'].includes(row.status)) return row;
    throw new Error('历史运行缺少已固定的事实区间，原记录保留待核对；不能用当前计划时区重建旧窗口。');
  }

  async occurrence(id: string): Promise<DigestOccurrenceRow | null> {
    return (await this.db.query<DigestOccurrenceRow>('select * from pa24.digest_occurrence where id = $1', [id])).rows[0] ?? null;
  }

  async completedSources(planId: string): Promise<DigestTriggerSource[]> {
    const rows = (await this.db.query<{ source: DigestTriggerSource | null }>(`select b.source from pa24.digest_work_binding b join pa24.digest_occurrence o on o.id = b.occurrence_id
      where o.plan_id = $1 and o.status in ('model_done', 'sent') and o.outbox_key is not null`, [planId])).rows;
    return rows.flatMap(row => row.source ? [row.source] : []);
  }

  async recordWorkSource(workItemId: string, source: DigestTriggerSource): Promise<void> {
    await this.db.query(`insert into pa24.digest_work_binding (work_item_id, source) values ($1, $2)
      on conflict (work_item_id) do nothing`, [workItemId, JSON.stringify(source)]);
  }

  async workSource(workItemId: string): Promise<DigestTriggerSource | null> {
    const result = await this.db.query<{ source: DigestTriggerSource | null }>('select source from pa24.digest_work_binding where work_item_id = $1', [workItemId]);
    return result.rows[0]?.source ?? null;
  }

  async runForWorkItem(planId: string, workItemId: string): Promise<DigestOccurrenceRow | null> {
    const binding = (await this.db.query<{ occurrence_id: string | null }>('select occurrence_id from pa24.digest_work_binding where work_item_id = $1', [workItemId])).rows[0];
    if (!binding?.occurrence_id) return null;
    const row = (await this.db.query<DigestOccurrenceRow>('select * from pa24.digest_occurrence where id = $1', [binding.occurrence_id])).rows[0];
    return row?.plan_id === planId ? row : null;
  }

  /** Completion and the send intents are one commit; no remote call is made here. */
  async completeRun(input: { planId: string; occurrenceId: string; report: string; notifications: NewOutbox[] }): Promise<{ reused: boolean; row: DigestOccurrenceRow }> {
    return this.db.withTransaction(async client => {
      const plan = (await client.query<DigestPlanRow>('select * from pa24.digest_plan where id = $1 for update', [input.planId])).rows[0];
      const row = (await client.query<DigestOccurrenceRow>('select * from pa24.digest_occurrence where id = $1 for update', [input.occurrenceId])).rows[0];
      if (!row || row.plan_id !== input.planId) throw new Error('运行窗口不存在或不属于该计划。');
      if (!plan || (plan.status !== 'active' && !(plan.status === 'paused' && row.plan_snapshot))) throw new Error(`计划 ${input.planId} 已暂停或停止，且无可核验的在途快照，本次结果未发布。`);
      if ((row.status === 'model_done' || row.status === 'sent') && (row.outbox_key || input.notifications.length === 0)) {
        return { reused: true, row };
      }
      if (plan.kind === 'waiting_followup') {
        const waiting = await client.query(`update pa24.waiting_item set ask_count = ask_count + 1, last_asked_at = now(), checkpoint_at = null, updated_at = now()
          where id = $1 and status = 'waiting' and checkpoint_at = $2 and checkpoint_at <= now() returning id`, [plan.schedule_spec.waitingId, new Date(plan.schedule_spec.checkpointAt)]);
        if (!waiting.rowCount) throw new Error('等待状态或检查点已改变，旧询问不再发布。');
        if (input.notifications.length !== 1) throw new Error('等待询问缺少本人投递目标，尚未完成。');
      }
      const outboxKey = `digest:${row.id}`;
      for (const notification of input.notifications) await enqueueOutbox(client, notification);
      await client.query(
        `update pa24.digest_occurrence set status = 'model_done', report = $2, outbox_key = $3, completed_at = now(), updated_at = now(), error = null where id = $1`,
        [row.id, JSON.stringify(input.report), input.notifications.length ? outboxKey : null],
      );
      await client.query('update pa24.digest_plan set last_window = $2, updated_at = now(), revision = revision + 1 where id = $1', [input.planId, row.window_key]);
      return { reused: false, row: { ...row, status: 'model_done', report: input.report, outbox_key: input.notifications.length ? outboxKey : null } };
    });
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

  async findGeneration(input: { workItemId: string; memoId: string; eventId: string | null; topic: string; candidates: unknown[] }): Promise<MinutesRow | null> {
    const rows = (await this.db.query<MinutesRow>(
      `select * from pa24.minutes where work_item_id = $1 and memo_id = $2 and event_id is not distinct from $3 and topic = $4 and candidates = $5::jsonb order by created_at limit 2`,
      [input.workItemId, input.memoId, input.eventId, input.topic, JSON.stringify(input.candidates)],
    )).rows;
    if (rows.length > 1) throw new Error(`同次纪要生成存在多个历史身份（${rows.map(row => row.id).join('、')}），行动回执可能分散；请先核对已有纪要及其行动，不自动选择版本或新建。`);
    return rows[0] ?? null;
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
  async recent(limit: number): Promise<Array<Pick<MinutesRow, 'id' | 'topic' | 'doc_url' | 'candidates' | 'event_id'>>> {
    const result = await this.db.query<Pick<MinutesRow, 'id' | 'topic' | 'doc_url' | 'candidates' | 'event_id'>>(
      `select id, topic, doc_url, candidates, event_id from pa24.minutes order by created_at desc limit $1`,
      [limit],
    );
    return result.rows;
  }
}

/** Cross-table maintenance statistics (F28): backup manifest watermarks and
 *  health/retry figures that previously lived as raw SQL in the runtime. */
