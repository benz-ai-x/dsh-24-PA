import type { PaDb } from '../db.js';
import { SkillRunRepo, type SkillRunAdmission, type SkillRunRow } from './skill-run.js';
import { TaskPlanRepo, type TaskPlanRow } from './task-plan.js';
import { lockPlanSkill } from './skill.js';
import { taskPlanFingerprint } from '../task-plan-access.js';

export interface PlanTriggerRow {
  id: string; plan_id: string; generation: string; occurrence: string; source: 'schedule' | 'manual';
  status: 'queued' | 'started' | 'skipped' | 'rejected' | 'expired'; reason: string | null; run_id: string | null;
  snapshot: Record<string, unknown>; created_at: Date; updated_at: Date;
}
export interface PlanTriggerInput {
  plan: TaskPlanRow; source: 'schedule' | 'manual'; generation: string; occurrence: string; triggeredAt: Date;
  scheduleId?: string; messageId?: string; sessionId: string; rejection?: string;
  skipReason?: string; nativeMessage?: unknown; requestHash?: string;
  admission?: SkillRunAdmission;
}
export const planTriggerId = (planId: string, generation: string, occurrence: string) => `trigger-${taskPlanFingerprint([planId, generation, occurrence])}`;

/** An occurrence and its Run are admitted in the same business transaction.
 * Skips and rejected/expired triggers remain events, never fictional Runs. */
export class PlanTriggerRepo {
  constructor(private readonly db: PaDb) {}
  async get(id: string): Promise<PlanTriggerRow | null> {
    return (await this.db.query<PlanTriggerRow>('select * from pa24.plan_trigger where id = $1', [id])).rows[0] ?? null;
  }
  async admit(input: PlanTriggerInput): Promise<{ trigger: PlanTriggerRow; run: SkillRunRow | null; repeated: boolean }> {
    return this.db.withTransaction(async tx => {
      const plans = new TaskPlanRepo(this.db), runs = new SkillRunRepo(this.db);
      const skillId = input.admission?.skill_id ?? input.plan.task_config!.skillId.replace(/^managed:/, '');
      await runs.lockAdmission(skillId, tx);
      let rejected = input.rejection;
      try { await lockPlanSkill(tx, input.plan.skill, input.plan.id); } catch (error) { rejected ??= (error as Error).message; }
      const plan = (await tx.query<TaskPlanRow>('select * from pa24.digest_plan where id = $1 for update', [input.plan.id])).rows[0];
      if (!plan?.task_config) throw new Error('计划已不存在或尚未使用通用配置。');
      const id = planTriggerId(plan.id, input.generation, input.occurrence);
      const prior = (await tx.query<PlanTriggerRow>('select * from pa24.plan_trigger where id = $1', [id])).rows[0];
      if (prior) {
        if (prior.snapshot.requestHash !== input.requestHash) throw new Error('触发操作标识已用于其他内容。');
        return { trigger: prior, run: prior.run_id ? (await tx.query<SkillRunRow>('select * from pa24.skill_run where id = $1', [prior.run_id])).rows[0] ?? null : null, repeated: true };
      }
      let status: PlanTriggerRow['status'] = 'queued', reason: string | null = null;
      if (plan.revision !== input.plan.revision || plan.session_id !== input.sessionId || plan.recycled_at || plan.delete_when_idle
        || !plan.task_authorization || (await plans.blocks(plan.id, tx)).length) { status = 'rejected'; reason = '计划配置、授权或阻断已改变。'; }
      else if (input.source === 'schedule' && (!plan.owner_enabled || plan.status !== 'active' || plan.schedule_id !== input.scheduleId || plan.schedule_generation !== input.generation)) { status = 'rejected'; reason = '计划已暂停或原生触发属于旧代次。'; }
      else if (input.source === 'schedule' && Date.now() - input.triggeredAt.getTime() > plan.task_config.missedTtlMs) { status = 'expired'; reason = '已超过本次触发的补执行有效期。'; }
      else if (input.skipReason) { status = 'skipped'; reason = input.skipReason; }
      else if ((await plans.activeRuns(plan.id, tx)).length) { status = 'skipped'; reason = '本计划仍有运行或待核对动作，本次重叠触发跳过。'; }
      else if (rejected || !input.admission) { status = 'rejected'; reason = rejected ?? '缺少完整的运行准入依据。'; }
      let run: SkillRunRow | null = null;
      if (status === 'queued') run = await runs.admitOn({ ...input.admission!, request_id: id, request_hash: taskPlanFingerprint([id, input.admission!.snapshot]),
        plan_id: plan.id, trigger_kind: input.source, triggered_at: input.triggeredAt }, tx);
      const trigger = (await tx.query<PlanTriggerRow>(`insert into pa24.plan_trigger
        (id, plan_id, generation, occurrence, source, status, reason, run_id, snapshot) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [id, plan.id, input.generation, input.occurrence, input.source, status, reason, run?.id ?? null,
        JSON.stringify({ configuration: input.admission?.snapshot.plan?.configuration ?? plan.task_config, authorization: input.admission?.snapshot.plan?.authorization ?? plan.task_authorization,
          requestHash: input.requestHash,
          nativeInput: input.nativeMessage ? { encoding: 'native-input-json-base64-v1', jsonBase64: Buffer.from(JSON.stringify(input.nativeMessage), 'utf8').toString('base64') } : undefined,
          sessionId: input.sessionId, scheduleId: input.scheduleId, messageId: input.messageId, triggeredAt: input.triggeredAt.toISOString() })])).rows[0]!;
      if (status === 'expired' && plan.kind === 'once') {
        await tx.query(`insert into pa24.task_plan_block (plan_id, key, kind, reason) values ($1,'expired-once','manual',$2)
          on conflict (plan_id, key) do nothing`, [plan.id, '一次性计划错过有效期，请调整时间或手工处理。']);
        await tx.query("update pa24.digest_plan set status = 'paused', revision = revision + 1, updated_at = now() where id = $1", [plan.id]);
      }
      return { trigger, run, repeated: false };
    });
  }
  async list(planId: string, offset = 0, limit = 20) {
    const total = Number((await this.db.query<{ count: string }>('select count(*) as count from pa24.plan_trigger where plan_id = $1', [planId])).rows[0]!.count);
    const rows = (await this.db.query<PlanTriggerRow>('select * from pa24.plan_trigger where plan_id = $1 order by created_at desc, id limit $2 offset $3', [planId, limit, offset])).rows;
    return { rows, total };
  }
}
