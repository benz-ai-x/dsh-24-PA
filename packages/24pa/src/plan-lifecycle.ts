import { randomUUID } from 'node:crypto';
import { freezePlanTiming, planTimingRequest, planTimingChange, samePlanTiming } from './plan-time.js';
import type { DigestRepo, DigestPlanRow } from './repo.js';
import type { NativeScheduleService } from './host.js';
import { digestWakePrompt } from './prompts.js';

export interface PlanIntent {
  id: string;
  operation: 'create' | 'update' | 'delete';
  phase: 'pending' | 'calling' | 'unknown' | 'conflict';
  request: Record<string, any>;
  spec: Record<string, unknown>;
  kind: string;
  targetStatus: 'active' | 'paused' | 'stopped';
  expected?: Record<string, unknown>;
  error?: string;
}
type NewPlan = Omit<DigestPlanRow, 'created_at' | 'updated_at' | 'revision' | 'lifecycle' | 'schedule_id' | 'status'>;
type Context = { repo: DigestRepo; native: NativeScheduleService | null };

/** A persisted plan owns its native task, including incomplete mutations.
 * All entry points share this module; no caller clears an unconfirmed ID. */
export class PlanLifecycle {
  private paused = false;
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(private readonly deps: { repo(): DigestRepo; native(): NativeScheduleService | null; available?(): boolean }) {}

  async pause(): Promise<void> { this.paused = true; await Promise.allSettled([...this.pending.values()]); }
  resumeAdmission(): void { this.paused = false; }
  private run<T>(id: string, work: (ctx: Context) => Promise<T>): Promise<T> {
    if (this.paused || this.deps.available?.() === false) return Promise.reject(new Error('工作区正在切换或停止，暂不接受计划变更。'));
    // Capture ownership before any await, including queued operations.
    const ctx = { repo: this.deps.repo(), native: this.deps.native() };
    const next = (this.pending.get(id) ?? Promise.resolve()).catch(() => {}).then(() => work(ctx));
    this.pending.set(id, next);
    void next.finally(() => { if (this.pending.get(id) === next) this.pending.delete(id); }).catch(() => {});
    return next;
  }

  async enable(input: NewPlan): Promise<DigestPlanRow> {
    return this.run(input.id, async ctx => {
      if (!ctx.native) throw new Error('当前 Host 未提供原生 Schedule 服务。');
      let plan = await ctx.repo.getPlan(input.id);
      if (plan?.lifecycle) {
        const operation = plan.lifecycle.operation;
        plan = await this.settle(ctx, plan);
        if (operation === 'create' && plan.status === 'active') return plan;
      }
      if (plan?.status === 'active' && plan.kind === 'once') return plan;
      if (plan && plan.status !== 'stopped') throw new Error(`计划已存在（${plan.id}）；请使用计划控制。`);
      const spec = freezePlanTiming(input.schedule_spec);
      const intent = this.intent('create', input, spec);
      if (plan) {
        plan = (await ctx.repo.updatePlan(plan.id, { ...input, schedule_id: null, schedule_spec: spec, status: 'paused', lifecycle: intent }))!;
      } else {
        plan = await ctx.repo.insertPlan({ ...input, schedule_id: null, schedule_spec: spec, status: 'paused', lifecycle: intent });
      }
      return this.settle(ctx, plan);
    });
  }

  async stop(id: string, targetStatus: 'paused' | 'stopped', expectedRevision?: number): Promise<{ plan: DigestPlanRow; warning: string | null; changedDuringCheck?: boolean }> {
    return this.run(id, async ctx => {
      let plan = await this.required(ctx, id);
      if (expectedRevision !== undefined && plan.revision !== expectedRevision) return { plan, warning: '计划已在监督期间改变，未停止新的计划状态。', changedDuringCheck: true };
      // A pending create has never called the host and can be canceled locally.
      if (plan.lifecycle?.operation === 'create' && plan.lifecycle.phase === 'pending') {
        plan = await ctx.repo.comparePlan(plan, { status: targetStatus, lifecycle: null });
        return { plan, warning: null };
      }
      if (plan.lifecycle?.operation === 'create' && !plan.schedule_id) {
        plan = await ctx.repo.comparePlan(plan, { status: targetStatus, lifecycle: { ...plan.lifecycle, targetStatus } });
      } else {
        plan = await ctx.repo.comparePlan(plan, { status: targetStatus, lifecycle: plan.schedule_id ? { ...this.intent('delete', plan, plan.schedule_spec), targetStatus } : null });
      }
      try { plan = await this.settle(ctx, plan); return { plan, warning: null }; }
      catch (error) { return { plan: await this.required(ctx, id), warning: (error as Error).message }; }
    });
  }

  async resume(id: string): Promise<DigestPlanRow> {
    return this.run(id, async ctx => {
      let plan = await this.required(ctx, id);
      if (plan.lifecycle) plan = await this.settle(ctx, plan);
      if (plan.status !== 'paused') throw new Error(`计划当前状态为 ${plan.status}，无法恢复。`);
      if (plan.schedule_id) throw new Error('原生计划尚未清理，请先暂停并核对。');
      const spec = freezePlanTiming(plan.schedule_spec);
      plan = await ctx.repo.comparePlan(plan, { lifecycle: this.intent('create', plan, spec), schedule_spec: spec });
      return this.settle(ctx, plan);
    });
  }

  async adjust(id: string, spec: Record<string, unknown>, kind: string): Promise<DigestPlanRow> {
    return this.run(id, async ctx => {
      let plan = await this.required(ctx, id);
      if (plan.lifecycle && plan.lifecycle.phase !== 'conflict') plan = await this.settle(ctx, plan);
      if (!plan.schedule_id) throw new Error('计划没有可调整的原生任务，请恢复或重新开启。');
      if (!ctx.native?.catalog || !ctx.native.update) throw new Error('当前 Host 缺少 Schedule catalog/update，不能安全调整。');
      const entry = (await ctx.native.catalog()).find(e => e.id === plan.schedule_id && e.sessionId === plan.session_id);
      if (!entry || entry.status !== 'active') throw new Error('原生计划已结束或不存在，请重新设置。');
      const { sessionId: _session, status: _status, lastDelivery: _delivery, ...expected } = entry;
      const intent = this.intent('update', { ...plan, kind }, freezePlanTiming(spec));
      intent.expected = expected;
      plan = await ctx.repo.comparePlan(plan, { status: 'paused', lifecycle: intent });
      return this.settle(ctx, plan);
    });
  }

  async configure(id: string, patch: Pick<Partial<DigestPlanRow>, 'voice' | 'skill'>): Promise<void> {
    await this.run(id, async ctx => { await this.required(ctx, id); await ctx.repo.updatePlan(id, patch); });
  }

  async recover(): Promise<Array<{ planId: string; error?: string }>> {
    // Recovery is itself admitted work: pause waits for its inventory read and
    // all repairs, and a workspace switch cannot redirect its repository.
    return this.run('__recovery__', async ctx => {
      const results = [];
      for (const plan of await ctx.repo.listPlans()) if (plan.lifecycle) {
        const previous = this.pending.get(plan.id) ?? Promise.resolve();
        const repair = previous.catch(() => {}).then(() => this.required(ctx, plan.id)).then(current => this.settle(ctx, current));
        this.pending.set(plan.id, repair);
        try { await repair; results.push({ planId: plan.id }); }
        catch (error) { results.push({ planId: plan.id, error: (error as Error).message }); }
        finally { if (this.pending.get(plan.id) === repair) this.pending.delete(plan.id); }
      }
      return results;
    });
  }

  private async required(ctx: Context, id: string): Promise<DigestPlanRow> {
    const plan = await ctx.repo.getPlan(id);
    if (!plan) throw new Error('计划不存在。');
    return plan;
  }
  private intent(operation: PlanIntent['operation'], plan: Pick<NewPlan, 'id' | 'title' | 'kind'>, spec: Record<string, unknown>): PlanIntent {
    const id = randomUUID();
    return { id, operation, phase: 'pending', spec, kind: plan.kind, targetStatus: 'active', request: {
      ...(operation === 'delete' ? {} : planTimingRequest(spec)), title: `[24PA] ${plan.title}`.slice(0, 120), prompt: `${digestWakePrompt(plan.id, plan.title)}\n24PA计划操作：${id}`,
    } };
  }
  private async settle(ctx: Context, initial: DigestPlanRow): Promise<DigestPlanRow> {
    let plan = initial;
    if (!plan.lifecycle) return plan;
    try {
      const native = ctx.native;
      if (!native) throw new Error('当前 Host 未提供原生 Schedule 服务；原计划身份保留待清理。');
      let intent = plan.lifecycle;
      if (intent.operation === 'delete') {
        if (plan.schedule_id) {
          const result = await native.delete({ sessionId: plan.session_id, id: plan.schedule_id }) as { deleted?: boolean; code?: string } | undefined;
          if (result?.deleted !== true && result?.code !== 'schedule_not_found') throw new Error('原生计划删除未获得确认，保留 ID 待重试。');
        }
        return await ctx.repo.comparePlan(plan, { status: intent.targetStatus, schedule_id: null, lifecycle: null });
      }
      if (intent.phase === 'conflict') throw new Error(intent.error ?? '原生计划更新冲突，请核对后再次明确调整或停止。');
      let record: Record<string, unknown> | undefined;
      if (intent.phase !== 'pending') {
        if (!native.catalog) throw new Error('创建/调整结果未知；Host 缺少 catalog，不能自动重试。');
        const matches = (await native.catalog()).filter(entry => entry.sessionId === plan.session_id && entry.prompt === intent.request.prompt && (intent.operation !== 'update' || entry.id === plan.schedule_id));
        if (matches.length !== 1) throw new Error(matches.length > 1 ? '原生计划存在多个匹配，结果有歧义，请核对。' : '原生计划结果未知，尚未查到唯一回执；请核对，不自动重建。');
        record = matches[0];
        if (intent.targetStatus === 'active' && !samePlanTiming(record!, intent.spec)) {
          plan = await ctx.repo.comparePlan(plan, { schedule_id: String(record!.id), lifecycle: { ...intent, phase: 'conflict', error: '原生计划规则已变化，与待恢复目标不一致；请核对后再次明确调整或停止。' } });
          throw new Error(plan.lifecycle!.error);
        }
      } else {
        plan = await ctx.repo.comparePlan(plan, { lifecycle: { ...intent, phase: 'calling' } });
        intent = plan.lifecycle!;
        if (intent.operation === 'create') {
          record = await native.create(plan.session_id, intent.request);
        } else {
          if (!native.update) throw new Error('当前 Host 缺少 Schedule update，不能安全调整。');
          const result = await native.update({ sessionId: plan.session_id, id: plan.schedule_id!, expected: intent.expected!, change: planTimingChange(intent.spec), title: String(intent.request.title), prompt: String(intent.request.prompt) });
          if (!result.record) {
            plan = await ctx.repo.comparePlan(plan, { lifecycle: { ...intent, phase: 'conflict', error: `原生计划调整未完成：${result.code ?? '回执不完整'}；请核对。` } });
            throw new Error(plan.lifecycle!.error);
          }
          record = result.record;
        }
      }
      if (!record?.id) throw new Error('原生计划回执缺少 ID，需核对。');
      if (intent.targetStatus !== 'active') {
        plan = await ctx.repo.comparePlan(plan, { schedule_id: String(record.id), lifecycle: { ...intent, operation: 'delete', phase: 'pending' } });
        return await this.settle(ctx, plan);
      }
      return await ctx.repo.comparePlan(plan, { schedule_id: String(record.id), status: 'active', kind: intent.kind, schedule_spec: intent.spec, schedule_generation: intent.id, lifecycle: null });
    } catch (error) {
      const intent = plan.lifecycle;
      if (intent) await ctx.repo.comparePlan(plan, { lifecycle: { ...intent, phase: intent.phase === 'conflict' ? 'conflict' : intent.phase === 'pending' ? 'pending' : 'unknown', error: (error as Error).message } }).catch(() => {});
      throw error;
    }
  }
}
