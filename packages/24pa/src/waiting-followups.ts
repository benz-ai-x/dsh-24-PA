import { randomUUID } from 'node:crypto';
import type { Repos, WaitingItemRow, DigestPlanRow } from './repo.js';
import type { PlanLifecycle } from './plan-lifecycle.js';
import { hash, isoDate, text } from './util.js';

/** A waiting checkpoint owns one native wake and one agent-track question. */
export class WaitingFollowups {
  constructor(private readonly deps: {
    repos(): Repos; plans(): PlanLifecycle; sessionId(): string | null;
    gate<T>(work: () => Promise<T>): Promise<T>; silentUntil(): Promise<Date | null>;
  }) {}
  private planId(item: WaitingItemRow): string { return `waiting-${hash(`${item.id}:${isoDate(item.checkpoint_at)}`)}`; }
  private async ensure(item: WaitingItemRow): Promise<DigestPlanRow | null> {
    if (item.status !== 'waiting' || !item.checkpoint_at) return null;
    const id = this.planId(item), old = await this.deps.repos().digests.getPlan(id);
    if (old && !old.lifecycle) return old; // Paused/stopped is an explicit disposition.
    const session = this.deps.sessionId();
    if (!session) throw new Error('等待检查点已保存，但缺少固定接入会话，尚未建立智能跟进计划。');
    return this.deps.plans().enable({ id, kind: 'waiting_followup', title: `等待跟进：${item.title}`, session_id: session,
      schedule_spec: old?.schedule_spec ?? { at: new Date(Math.max(Date.now() + 1000, new Date(item.checkpoint_at).getTime())).toISOString(), waitingId: item.id, checkpointAt: isoDate(item.checkpoint_at) },
      last_window: null, voice: false, skill: 'waiting-followup' });
  }
  create(args: Record<string, unknown>) { return this.deps.gate(async () => {
    const dedupKey = args.dedupKey ? String(args.dedupKey) : null;
    let item = dedupKey ? await this.deps.repos().waiting.byDedupKey(dedupKey) : null;
    const reused = !!item;
    if (!item) {
      let checkpoint: Date | null = null;
      if (args.checkpointInSeconds != null) {
        const seconds = Number(args.checkpointInSeconds);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 365 * 86400) throw new Error('检查点需为 1 秒–365 天。');
        checkpoint = new Date(Date.now() + seconds * 1000);
      } else if (args.checkpointAt) {
        checkpoint = new Date(String(args.checkpointAt));
        if (!Number.isFinite(checkpoint.getTime())) throw new Error('checkpointAt 需为可解析的 ISO 时间。');
      }
      const title = text(args.title, 200); if (!title) throw new Error('等待事项需要标题。');
      item = await this.deps.repos().waiting.insert({ id: `wt-${randomUUID().slice(0, 12)}`, title, detail: args.detail ? text(args.detail, 2000) : '', sourceDesc: args.sourceDesc ? text(args.sourceDesc, 500) : '', ...(dedupKey ? { dedupKey } : {}), checkpointAt: checkpoint });
    }
    const plan = await this.ensure(item);
    return { waitingId: item.id, reused, status: item.status, checkpointAt: isoDate(item.checkpoint_at), planId: plan?.id ?? null,
      message: item.checkpoint_at ? '等待事项已保存；检查点由智能 skill 读取当前事实后只询问本人一次，收到答复后可再设时间，不自动向对方催办。' : '等待事项已保存；尚未设置检查点，需要跟进时再设时间。' };
  }); }
  async list(status?: string): Promise<unknown> {
    const items = [];
    for (const item of await this.deps.repos().waiting.list(status)) {
      const plan = item.checkpoint_at ? await this.deps.repos().digests.getPlan(this.planId(item)) : null;
      items.push({ id: item.id, title: item.title, status: item.status, checkpointAt: isoDate(item.checkpoint_at), asked: item.ask_count, source: item.source_desc, planId: plan?.id ?? null, planStatus: plan?.status ?? null, pendingChange: plan?.lifecycle ?? null });
    }
    return { items };
  }
  control(args: Record<string, unknown>) { return this.deps.gate(async () => {
    const item = await this.deps.repos().waiting.get(String(args.waitingId ?? ''));
    if (!item) throw new Error('等待事项不存在。');
    const op = String(args.op ?? '');
    if (!['received', 'cancel', 'reschedule', 'keep'].includes(op)) throw new Error('未知等待操作（received/cancel/reschedule/keep）。');
    if (op === 'received' && item.status !== 'waiting') throw new Error(`等待事项当前为 ${item.status}。`);
    let checkpoint: Date | null = null;
    if (op === 'reschedule') {
      const seconds = Number(args.inSeconds);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 365 * 86400) throw new Error('改期需要 inSeconds（1 秒–365 天）。');
      checkpoint = new Date(Date.now() + seconds * 1000);
    }
    const status = op === 'received' ? 'received' : op === 'cancel' ? 'canceled' : 'waiting';
    // Ledger disposition wins before any slow host delete; late delivery uses
    // the same checkpoint comparison inside the Outbox transaction.
    const updated = await this.deps.repos().waiting.control(item.id, { status, checkpoint_at: checkpoint, result: args.note ? text(args.note, 500) : op });
    const warnings = await this.stopOtherPlans(updated!);
    const plan = await this.ensure(updated!);
    return { waitingId: item.id, status, checkpointAt: isoDate(checkpoint), planId: plan?.id ?? null, warnings,
      message: op === 'reschedule' ? '检查点已调整，届时由智能 skill 询问本人。' : status === 'waiting' ? '继续等待；原检查点已结束，需要跟进时再设时间。' : '等待事项已结束，旧检查点不再新增询问；已发送消息保留历史。' };
  }); }
  private async stopOtherPlans(item: WaitingItemRow): Promise<string[]> {
    const warnings = [];
    for (const plan of await this.deps.repos().digests.listPlans()) {
      if (plan.kind !== 'waiting_followup' || plan.schedule_spec.waitingId !== item.id || (item.checkpoint_at && plan.id === this.planId(item))) continue;
      if (plan.status === 'stopped' && !plan.schedule_id && !plan.lifecycle) continue;
      const result = await this.deps.plans().stop(plan.id, 'stopped'); if (result.warning) warnings.push(result.warning);
    }
    return warnings;
  }
  repair(): Promise<number> { return this.deps.gate(async () => {
    let repaired = 0;
    for (const item of await this.deps.repos().waiting.all()) {
      try {
        await this.stopOtherPlans(item);
        if (item.status === 'waiting' && item.checkpoint_at) { await this.ensure(item); repaired++; }
      } catch (error) { console.warn(`[pa24] 等待 ${item.id} 恢复待核对：${(error as Error).message}`); }
    }
    return repaired;
  }); }
  async facts(plan: DigestPlanRow): Promise<unknown> {
    const item = await this.current(plan);
    if (new Date(item.checkpoint_at!).getTime() > Date.now()) throw new Error('等待检查点尚未到达，暂不询问。');
    return { waiting: { id: item.id, title: item.title, detail: item.detail, source: item.source_desc, checkpointAt: isoDate(item.checkpoint_at), status: item.status, asked: item.ask_count }, missing: ['没有自动读取对方回复的来源，以本人答复为准'] };
  }
  private async current(plan: DigestPlanRow): Promise<WaitingItemRow> {
    const item = await this.deps.repos().waiting.get(String(plan.schedule_spec.waitingId));
    if (!item || item.status !== 'waiting' || isoDate(item.checkpoint_at) !== plan.schedule_spec.checkpointAt) throw new Error('等待状态或检查点已改变，旧询问不再发布。');
    return item;
  }
  async beforeDelivery(plan: DigestPlanRow): Promise<void> {
    const quiet = await this.deps.silentUntil();
    await this.current(plan);
    if (!quiet || quiet.getTime() <= Date.now()) return;
    await this.deps.gate(async () => {
      const item = await this.current(plan);
      const updated = await this.deps.repos().waiting.defer(item.id, plan.schedule_spec.checkpointAt, quiet);
      if (!updated) throw new Error('等待状态已改变，旧询问不再发布。');
      await this.stopOtherPlans(updated); await this.ensure(updated);
    });
    throw new Error(`当前处于免打扰，检查点已延期至 ${quiet.toISOString()}，本次未发送询问。`);
  }
}
