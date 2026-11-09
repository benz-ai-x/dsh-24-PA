import type { Repos, OutboxRow } from './repo.js';
import type { TaskPlanAccess } from './task-plan-access.js';
import type { DeliveryHold } from './outbox-delivery.js';
import type { SilencePolicy } from './reminders.js';
import { taskPlanFingerprint } from './task-plan-access.js';
import { sameWeixinIdentity } from './weixin-protocol.js';

/** Delivery uses the saved recipient and current identity. Business target
 * revocation may cause an error notice, so it cannot forbid that notice. */
export class PlanResults {
  constructor(private readonly deps: { repos(): Repos; access: TaskPlanAccess; silence: SilencePolicy; binding?(): string | null }) {}
  reconcile(): Promise<void> { return this.deps.repos().planResults.reconcile(); }
  async change(input: Record<string, unknown>) {
    if (typeof input.workspaceBinding !== 'string' || input.workspaceBinding !== this.deps.binding?.()) throw new Error('工作区已切换，请刷新运行记录。');
    if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestId) || input.confirm !== true) throw new Error('请确认本次投递处理。');
    if (input.op !== 'retry' && input.op !== 'review') throw new Error('投递操作无效。');
    const repo = this.deps.repos().planResults;
    await repo.repair({ requestId: input.requestId, requestHash: taskPlanFingerprint(input), runId: String(input.runId), outboxId: Number(input.outboxId),
      fingerprint: String(input.fingerprint), op: input.op, outcome: input.outcome as 'sent' | 'not_sent' | undefined,
      evidence: typeof input.evidence === 'string' ? input.evidence.trim().slice(0, 4000) : undefined,
      messageId: typeof input.messageId === 'string' ? input.messageId.trim().slice(0, 500) : undefined });
    return { deliveries: await repo.inspect(String(input.runId)), workspaceBinding: input.workspaceBinding };
  }
  async beforeSend(row: OutboxRow): Promise<DeliveryHold | null> {
    const selected = await this.deps.repos().planResults.delivery(Number(row.id));
    if (!selected) return row.association?.planId || row.association?.skillRunId || row.association?.noticeId || row.dedup_key.startsWith('plan-result-')
      ? { status: 'failed', error: '缺少原计划的固定投递关联，未发送。' } : null;
    const { delivery, notice, run, obsolete } = selected, plan = run.snapshot.plan;
    if (!plan || run.plan_id !== plan.id || notice.plan_id !== plan.id || notice.run_id !== run.id || delivery.run_id !== run.id
      || !notice.destination || taskPlanFingerprint(notice.destination) !== taskPlanFingerprint(plan.authorization.delivery)
      || plan.configuration.delivery.channel !== notice.destination.channel
      || notice.destination.channel !== row.channel || notice.destination.target !== row.target || delivery.component !== row.kind
      || row.kind === 'audio' && (notice.kind !== 'result' || row.channel !== 'feishu' || !plan.configuration.delivery.voice)) {
      return { status: 'failed', error: '投递与原计划、运行、通知或格式的关联不符，未发送。' };
    }
    if (notice.destination.channel === 'weixin' && (!row.delivery_target || !sameWeixinIdentity(notice.destination, row.delivery_target)
      || row.target !== notice.destination.ownerId || row.binding_generation !== notice.destination.generation
      || row.association?.planId !== plan.id || row.association?.skillRunId !== run.id || row.association?.noticeId !== notice.id
      || row.association.inboxEventId || row.association.workItemId || row.association.workerRunId || row.segment_group !== notice.id)) {
      return { status: 'failed', error: '微信投递与原计划结果及固定身份的关联不符，未发送。' };
    }
    if (obsolete) return { status: 'expired', error: '原处理要求已经结束或更新，旧通知保留而不再推送。' };
    if (delivery.expires_at && new Date(delivery.expires_at).getTime() <= Date.now()) return { status: 'expired', error: '普通结果超过本次触发的投递有效期，结果仍保留。' };
    try { await this.deps.access.verifyDelivery(notice.destination); }
    catch (error) { return { status: row.channel === 'weixin' ? 'limited' : 'failed', error: `固定投递目标核验失败：${(error as Error).message}` }; }
    const until = delivery.override_quiet ? null : await this.deps.silence.silentUntil();
    // The original request may have been resolved while identity or quiet
    // preferences were being read. Recheck the saved intent after preparation.
    const latest = await this.deps.repos().planResults.delivery(Number(row.id));
    if (!latest || taskPlanFingerprint([latest.delivery, latest.notice, latest.run.plan_id, latest.run.snapshot.plan])
      !== taskPlanFingerprint([delivery, notice, run.plan_id, plan])) {
      return { status: 'failed', error: '投递准备期间原计划结果关联已变化，未发送。' };
    }
    if (latest.obsolete) return { status: 'expired', error: '原处理要求已经结束或更新，旧通知保留而不再推送。' };
    const now = Date.now();
    // Identity and preference reads may be slow. The deadline governs entry
    // into the platform send, not when preparation started.
    if (delivery.expires_at && new Date(delivery.expires_at).getTime() <= now) return { status: 'expired', error: '投递准备完成时已超过有效期，结果仍保留。' };
    if (until && until.getTime() > now) return { status: 'pending', error: '免打扰期间暂缓投递。',
      retryInMs: Math.max(1, Math.min(until.getTime(), delivery.expires_at ? new Date(delivery.expires_at).getTime() : Infinity) - now) };
    return null;
  }
  async updated(row: OutboxRow): Promise<void> {
    const repos = this.deps.repos(), record = await repos.planResults.delivery(Number(row.id));
    if (record) await repos.planResults.refresh(record.run.id);
  }
}
