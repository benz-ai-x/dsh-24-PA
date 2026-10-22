import type { PaDb, PaQueryer } from '../db.js';
import type { TaskPlanAuthorization } from '../task-plan.js';
import type { SkillRunRow } from './skill-run.js';
import type { TaskPlanRow } from './task-plan.js';
import { enqueueOutbox, type OutboxRow } from './outbox.js';
import { taskPlanFingerprint } from '../task-plan-access.js';
import { buildSpokenVariant } from '../spoken-result.js';

export type PlanDeliveryStatus = 'not_requested' | 'suppressed' | 'pending' | 'sent' | 'partial' | 'failed' | 'unknown' | 'expired';
export interface PlanNotice {
  id: string; run_id: string; plan_id: string; kind: 'result' | 'failure' | 'attention' | 'stopped';
  status: 'not_requested' | 'suppressed' | 'queued'; reason: string | null;
  destination: TaskPlanAuthorization['delivery']; created_at: Date;
}
export interface PlanDelivery {
  outbox_id: number; notice_id: string; run_id: string; component: 'text' | 'audio';
  expires_at: Date | null; override_quiet: boolean;
}
const attention = (run: SkillRunRow) => ['waiting', 'needs_reconciliation'].includes(run.status);
const noticeId = (run: SkillRunRow, kind: PlanNotice['kind']) => `plan-result-${taskPlanFingerprint([run.id, kind, kind === 'attention' ? [run.status, run.progress] : null])}`;
const deliveryFingerprint = (row: OutboxRow) => taskPlanFingerprint([row.id, row.status, row.message_id, row.attempts, row.last_error]);
function aggregate(notice: PlanNotice, rows: OutboxRow[]): PlanDeliveryStatus {
  if (notice.status !== 'queued') return notice.status;
  if (!rows.length) return 'failed';
  if (rows.every(row => row.status === 'sent')) return 'sent';
  if (rows.some(row => row.status === 'sent')) return 'partial';
  if (rows.some(row => row.status === 'unknown')) return 'unknown';
  if (rows.some(row => ['pending', 'sending'].includes(row.status))) return 'pending';
  if (rows.every(row => row.status === 'expired')) return 'expired';
  return 'failed';
}

/** Completion accounting, the comparison baseline and notification intents
 * share a transaction. Sending and repairing delivery never execute a Skill. */
export class PlanResultRepo {
  constructor(private readonly db: PaDb) {}

  async reconcile(): Promise<void> {
    const plans = (await this.db.query<{ plan_id: string }>(`select distinct r.plan_id from pa24.skill_run r where r.plan_id is not null and
      (r.status in ('waiting', 'needs_reconciliation') or (r.status in ('completed', 'failed', 'timed_out', 'stopped')
        and not exists (select 1 from pa24.task_plan_run_outcome o where o.run_id = r.id)))`)).rows;
    for (const row of plans) await this.db.withTransaction(tx => this.settlePlan(row.plan_id, tx));
    const deliveries = (await this.db.query<{ id: string }>("select id from pa24.skill_run where plan_id is not null and delivery_status in ('pending', 'partial')")).rows;
    for (const run of deliveries) await this.refresh(run.id);
  }

  async settlePlan(id: string, tx: PaQueryer): Promise<void> {
    const plan = (await tx.query<TaskPlanRow>('select * from pa24.digest_plan where id = $1 for update', [id])).rows[0];
    if (!plan) return;
    // Include and lock unfinished runs too: a concurrent terminal transition
    // cannot fall between failure accounting and the next trigger's overlap
    // check. Already accounted terminal history needs no repeated row locks.
    const runs = (await tx.query<SkillRunRow>(`select * from pa24.skill_run r where plan_id = $1 and
      not exists (select 1 from pa24.task_plan_run_outcome o where o.run_id = r.id) order by created_at, id for update`, [id])).rows;
    for (const run of runs) {
      if (!run.snapshot.plan) continue;
      if (attention(run)) {
        await this.notice(tx, run, 'attention');
        await this.refresh(run.id, tx);
        continue;
      }
      if (!['completed', 'failed', 'timed_out', 'stopped'].includes(run.status)) continue;
      const resultHash = run.status === 'completed' ? taskPlanFingerprint(run.result ?? '') : null;
      const recorded = await tx.query(`insert into pa24.task_plan_run_outcome (run_id, plan_id, status, result_hash)
        values ($1,$2,$3,$4) on conflict (run_id) do nothing returning run_id`, [run.id, id, run.status, resultHash]);
      if (!recorded.rowCount) continue;
      if (run.status === 'completed') {
        const changed = resultHash !== plan.last_success_hash;
        plan.failure_count = 0; plan.last_success_hash = resultHash;
        await tx.query('update pa24.digest_plan set failure_count = 0, last_success_hash = $2, updated_at = now() where id = $1', [id, resultHash]);
        const mode = run.snapshot.plan.configuration.delivery.mode;
        await this.notice(tx, run, 'result', mode === 'errors' ? '计划仅通知异常，本次结果已保存。'
          : mode === 'changed' && !changed ? '完整结果正文与最近成功结果相同，已保存而不推送。' : undefined);
      } else if (run.status === 'failed' || run.status === 'timed_out') {
        plan.failure_count++;
        await tx.query('update pa24.digest_plan set failure_count = $2, updated_at = now() where id = $1', [id, plan.failure_count]);
        const stopped = plan.failure_count >= 3;
        if (stopped) {
          await tx.query(`insert into pa24.task_plan_block (plan_id, key, kind, reason) values ($1,'failures','failures',$2)
            on conflict (plan_id, key) do update set reason = excluded.reason`, [id, `连续 ${plan.failure_count} 次最终执行失败，请处理后明确解除此阻断。`]);
          await tx.query("update pa24.digest_plan set status = 'paused', revision = revision + 1, updated_at = now() where id = $1", [id]);
        }
        await this.notice(tx, run, 'failure', undefined, stopped ? '计划已因连续失败暂停；主人启停选择保留。' : undefined);
      } else await this.notice(tx, run, 'stopped', '主人已停止运行，不计入连续失败。');
      await this.refresh(run.id, tx);
    }
  }

  private async notice(tx: PaQueryer, run: SkillRunRow, kind: PlanNotice['kind'], suppressed?: string, extra?: string): Promise<void> {
    const plan = run.snapshot.plan!, id = noticeId(run, kind), configuration = plan.configuration;
    const destination = plan.authorization.delivery;
    const status = !destination || configuration.delivery.channel === 'none' ? 'not_requested' : suppressed ? 'suppressed' : 'queued';
    const added = await tx.query(`insert into pa24.task_plan_notice (id, run_id, plan_id, kind, status, reason, destination)
      values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing returning id`,
    [id, run.id, plan.id, kind, status, suppressed ?? (status === 'not_requested' ? '计划选择仅保存结果。' : null), destination ? JSON.stringify(destination) : null]);
    if (!added.rowCount || status !== 'queued' || !destination) return;
    const label = kind === 'result' ? '执行结果' : kind === 'failure' ? '执行未完成' : '需要处理';
    const body = kind === 'result' ? run.result ?? '' : run.progress ?? run.status;
    const text = `24私助 · ${plan.title}\n${label}\n${body}${extra ? `\n${extra}` : ''}\n\nSkill 版本：${run.version_id}\n运行：${run.id}`
      + (kind !== 'result' ? '\n请在24私助工作区的运行记录中处理，后续触发不会替代本次核对。' : '');
    const components: Array<'text' | 'audio'> = kind === 'result' && configuration.delivery.voice && destination.channel === 'feishu' ? ['text', 'audio'] : ['text'];
    for (const component of components) {
      const queued = await enqueueOutbox(tx, { dedupKey: `${id}:${component}`, channel: destination.channel, target: destination.target,
        kind: component, content: { text: component === 'audio' ? buildSpokenVariant(body) : text } });
      const expiresAt = kind === 'result' ? new Date(new Date(run.triggered_at ?? run.created_at).getTime() + configuration.deliveryTtlMs) : null;
      await tx.query(`insert into pa24.task_plan_delivery (outbox_id, notice_id, run_id, component, expires_at, override_quiet)
        values ($1,$2,$3,$4,$5,$6) on conflict (outbox_id) do nothing`,
      [queued.row.id, id, run.id, component, expiresAt, kind === 'result' && configuration.delivery.overrideQuiet]);
    }
  }

  async delivery(outboxId: number) {
    const delivery = (await this.db.query<PlanDelivery>('select * from pa24.task_plan_delivery where outbox_id = $1', [outboxId])).rows[0];
    if (!delivery) return null;
    const notice = (await this.db.query<PlanNotice>('select * from pa24.task_plan_notice where id = $1', [delivery.notice_id])).rows[0];
    const run = (await this.db.query<SkillRunRow>('select * from pa24.skill_run where id = $1', [delivery.run_id])).rows[0];
    if (!notice || !run) throw new Error('投递缺少原运行依据，未发送。');
    return { delivery, notice, run, obsolete: notice.kind === 'attention' && (!attention(run) || notice.id !== noticeId(run, 'attention')) };
  }

  async inspect(runId: string, tx: PaQueryer = this.db) {
    const notices = (await tx.query<PlanNotice>('select * from pa24.task_plan_notice where run_id = $1 order by created_at, id', [runId])).rows;
    const deliveries = (await tx.query<PlanDelivery>('select * from pa24.task_plan_delivery where run_id = $1 order by outbox_id', [runId])).rows;
    const outbox = (await tx.query<OutboxRow>('select o.* from pa24.outbox o join pa24.task_plan_delivery d on d.outbox_id = o.id where d.run_id = $1 order by o.id', [runId])).rows;
    const changes = (await tx.query<{ outbox_id: number; record: Record<string, unknown>; created_at: Date }>(
      'select c.* from pa24.task_plan_delivery_change c join pa24.task_plan_delivery d on d.outbox_id = c.outbox_id where d.run_id = $1 order by c.created_at, c.request_id', [runId])).rows;
    return notices.map(notice => {
      const rows = deliveries.filter(row => row.notice_id === notice.id).map(row => {
        const saved = outbox.find(item => Number(item.id) === Number(row.outbox_id));
        if (!saved) throw new Error('投递记录不完整，请检查原始账本。');
        return { ...row, outbox: saved, fingerprint: deliveryFingerprint(saved), changes: changes.filter(change => Number(change.outbox_id) === Number(row.outbox_id)) };
      });
      return { ...notice, deliveryStatus: aggregate(notice, rows.map(row => row.outbox)), deliveries: rows };
    });
  }
  async repair(input: { requestId: string; requestHash: string; runId: string; outboxId: number; fingerprint: string;
    op: 'retry' | 'review'; outcome?: 'sent' | 'not_sent'; evidence?: string; messageId?: string }): Promise<void> {
    await this.db.withTransaction(async tx => {
      // Lock the immutable intent first, then its mutable delivery receipt.
      const linked = (await tx.query<PlanDelivery>('select * from pa24.task_plan_delivery where outbox_id = $1 for update', [input.outboxId])).rows[0];
      if (!linked || linked.run_id !== input.runId) throw new Error('投递不属于此运行。');
      const prior = (await tx.query<{ request_hash: string }>('select request_hash from pa24.task_plan_delivery_change where request_id = $1', [input.requestId])).rows[0];
      if (prior) { if (prior.request_hash !== input.requestHash) throw new Error('投递操作标识已用于其他内容。'); return; }
      const row = (await tx.query<OutboxRow>('select * from pa24.outbox where id = $1 for update', [input.outboxId])).rows[0];
      if (!row || deliveryFingerprint(row) !== input.fingerprint) throw new Error('投递回执已变化，请刷新后处理。');
      if (input.op === 'retry' && (row.status !== 'failed' || row.message_id)) throw new Error('只有明确未发送的失败可补投；未知结果须先核对。');
      if (input.op === 'retry' && (input.outcome !== undefined || input.messageId !== undefined)) throw new Error('补投不能附带新的送达结论。');
      if (input.op === 'review' && (row.status !== 'unknown' || row.message_id)) throw new Error('此投递无需未知结果核对，请刷新。');
      if (input.op === 'review' && (!input.evidence?.trim() || !['sent', 'not_sent'].includes(input.outcome ?? '') || (input.outcome === 'sent' && !input.messageId?.trim()))) throw new Error('请填写核对依据；确认送达还须填写原平台消息 ID。');
      await tx.query('insert into pa24.task_plan_delivery_change (request_id, request_hash, outbox_id, record) values ($1,$2,$3,$4)',
        [input.requestId, input.requestHash, input.outboxId, JSON.stringify({ actor: 'owner', ...input, before: row })]);
      // A not-sent review only resolves uncertainty. Retrying remains a
      // separate explicit action, with the original recipient and deadline.
      const status = input.op === 'retry' || input.outcome === 'sent' ? 'pending' : 'failed';
      await tx.query(`update pa24.outbox set status = $2, message_id = $3, next_attempt_at = null,
        attempts = case when $4 then 0 else attempts end, last_error = $5 where id = $1`,
      [input.outboxId, status, input.outcome === 'sent' ? input.messageId : null, input.op === 'retry',
        input.op === 'retry' ? '主人明确补投原结果。' : `主人核对：${input.evidence}`]);
    });
    await this.refresh(input.runId);
  }
  async refresh(runId: string, tx: PaQueryer = this.db): Promise<void> {
    const notices = await this.inspect(runId, tx);
    const latest = notices.find(notice => notice.kind !== 'attention') ?? notices.at(-1);
    await tx.query('update pa24.skill_run set delivery_status = $2 where id = $1', [runId, latest?.deliveryStatus ?? 'not_requested']);
  }
}
