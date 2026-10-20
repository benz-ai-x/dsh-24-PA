import { UNSETTLED_WORK_STATUSES } from './repo/work.js';
import type { WorkItemRepo, WorkItemRow } from './repo/work.js';
import type { NewOutbox } from './repo/outbox.js';
import type { WorkCompletion } from './work-completion.js';

/** The single-host admission gate owns capacity for new work AND continuations.
 * Native child operations stay behind the host adapter; durable state stays in
 * the same repository on SQLite and PostgreSQL. */
export class WorkItemLifecycle {
  private serial: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, { failures: number; nextAt: number; recovering: boolean; revision: number }>();
  private settling: Promise<void> | null = null;
  constructor(private readonly deps: {
    repo: () => WorkItemRepo; maxWorkers: () => number; available: () => boolean;
    start: (item: WorkItemRow) => Promise<void>;
    resume: (item: WorkItemRow, input: string) => Promise<string | void>;
    interrupt: (item: WorkItemRow) => void;
    quiesce?: (item: WorkItemRow) => Promise<void>;
    track: (item: WorkItemRow) => void;
    completion?: { workspacePath: () => string; read: (item: WorkItemRow) => Promise<WorkCompletion>;
      delivered: () => void; warn: (message: string) => void };
  }) {}

  private gate<T>(run: () => Promise<T>): Promise<T> {
    const result = this.serial.then(run);
    this.serial = result.catch(() => {});
    return result;
  }

  pump(): Promise<void> { return this.gate(() => this.fillSlots()); }
  idle(): Promise<void> { return this.gate(async () => {}); }

  admit(create: () => Promise<WorkItemRow>): Promise<WorkItemRow> {
    return this.gate(async () => {
      if (!this.deps.available()) throw new Error('事项调度尚未就绪或工作区正在切换，请稍后重试。');
      const item = await create();
      this.deps.track(item);
      await this.fillSlots();
      return (await this.deps.repo().get(item.id))!;
    });
  }

  private async fillSlots() {
    if (!this.deps.available()) return;
    const repo = this.deps.repo();
    while (this.deps.available() && await repo.countByStatus('running') < this.deps.maxWorkers()) {
      const item = await repo.claimNext();
      if (!item) break;
      this.deps.track(item);
      try {
        const executing = this.deps.completion ? await repo.beginExecution(item, this.deps.completion.workspacePath(), 'start') : item;
        this.deps.track(executing);
        await this.deps.start(executing);
      }
      catch (error) {
        const failed = await repo.update(item.id, { status: 'failed', progress: `Worker 未启动：${(error as Error).message}` });
        if (failed) this.deps.track(failed);
      }
    }
  }

  resume(id: string, input: string, supplement = false): Promise<WorkItemRow & { acceptedMessageId?: string }> {
    return this.gate(async () => {
      if (!this.deps.available()) throw new Error('事项调度尚未就绪。');
      const repo = this.deps.repo();
      const item = await repo.get(id);
      if (!item?.child_session_id) throw new Error('此事项尚无原生 Worker 会话，请核对后重新委派。');
      if (item.status === 'needs_reconciliation') throw new Error('上次输入接纳结果待核对，请先核对外部结果并明确停止本事项，再决定是否继续。');
      if (supplement && item.status === 'stopped') throw new Error('事项已停止，不因引用复活。');
      if (['accepted', 'queued'].includes(item.status)) throw new Error('事项尚在排队，请启动后再补充。');
      if (!supplement && item.status === 'running') throw new Error('事项正在运行或排队中。');
      if (item.status !== 'running' && await repo.countByStatus('running') >= this.deps.maxWorkers()) throw new Error('Worker 并发已满，请稍后继续。');
      if (item.status !== 'running') {
        await this.deps.quiesce?.(item);
        await repo.setRecoveryGen(id, (item.recovery_gen ?? 0) + 1);
      }
      let running = await repo.update(id, { status: 'running', progress: supplement ? '收到补充输入，等待 Worker 处理' : '继续处理' });
      this.deps.track(running!);
      let acceptedMessageId: string | void;
      try {
        if (this.deps.completion) running = await repo.beginExecution(running!, this.deps.completion.workspacePath(), 'followup');
        this.deps.track(running!);
        acceptedMessageId = await this.deps.resume(running!, input);
      }
      catch (error) {
        const outcome = (error as { outcome?: string }).outcome ?? 'rejected';
        try {
          if (outcome === 'rejected' && running?.execution_id && running.execution_id !== item.execution_id) await repo.restoreExecution(id, running.execution_id, item);
          const restored = await repo.update(id, {
            status: outcome === 'unknown' ? 'needs_reconciliation' : item.status,
            progress: `${outcome === 'unknown' ? '继续输入接纳待核对，勿自动重发' : '继续输入未送达'}：${(error as Error).message}`,
          });
          if (restored) this.deps.track(restored);
        } catch (localError) {
          throw Object.assign(new Error(`${(error as Error).message}；本地状态待核对：${(localError as Error).message}`), { outcome });
        }
        throw Object.assign(error as Error, { outcome });
      }
      return { ...running!, ...(typeof acceptedMessageId === 'string' ? { acceptedMessageId } : {}) };
    }).catch(error => {
      // The host adapter explicitly tags uncertain send outcomes. Validation,
      // capacity, parent/skill resolution and local intent failures precede it.
      throw Object.assign(error, { outcome: error.outcome ?? 'rejected' });
    });
  }

  private async stopItem(id: string): Promise<void> {
    const repo = this.deps.repo();
    const item = await repo.get(id);
    if (!item || !UNSETTLED_WORK_STATUSES.some(status => status === item.status)) throw new Error('此事项已结束。');
    const stopped = await repo.update(id, { status: 'stopped', progress: '本人要求停止；已完成及待核对的外部效果保留' });
    this.deps.track(stopped!);
    if (item.status === 'running' || item.status === 'needs_reconciliation') this.deps.interrupt(item);
  }

  stop(id: string): Promise<void> {
    return this.gate(async () => {
      try { await this.stopItem(id); }
      finally { await this.fillSlots(); }
    });
  }

  /** Archive stops the selected queue as one admission decision. Never start a
   * queued worker between two stops, even when an uncertain item freed a slot. */
  stopMany(ids: readonly string[]): Promise<void> {
    return this.gate(async () => { for (const id of ids) await this.stopItem(id); });
  }

  finish(id: string, result: { output: string; failed?: boolean; generation?: number; executionId?: string; delivery: (item: WorkItemRow) => NewOutbox }): Promise<void> {
    return this.gate(async () => {
      const repo = this.deps.repo();
      const item = await repo.get(id);
      if (!item || item.status !== 'running' || (result.generation !== undefined && result.generation !== (item.recovery_gen ?? 0))
        || (result.executionId !== undefined && result.executionId !== item.execution_id)) return;
      const finished = await repo.finishWithDelivery(id, result.output, result.failed === true, result.delivery(item),
        { generation: item.recovery_gen ?? 0, executionId: result.executionId });
      if (finished) this.deps.track(finished);
      await this.fillSlots();
    });
  }

  private deferRetry(attempt: { failures: number; nextAt: number }): void {
    attempt.failures += 1;
    attempt.nextAt = Date.now() + Math.min(30_000, 400 * 2 ** Math.min(attempt.failures - 1, 7));
  }

  /** Events are hints to read durable evidence. A failed hint remains queued;
   * the normal dispatcher retries it without model or external action calls. */
  async complete(id: string, checkpoint?: () => Promise<void>): Promise<void> {
    const pending = this.pending.get(id);
    if (pending) { pending.revision += 1; pending.recovering = false; if (!pending.failures) pending.nextAt = 0; }
    else this.pending.set(id, { failures: 0, nextAt: 0, recovering: false, revision: 0 });
    // Flush the native completion even when the first ledger read fails. The
    // already-committed input marker plus this independent log survives exit.
    try { await checkpoint?.(); }
    catch (error) {
      const attempt = this.pending.get(id)!;
      this.deferRetry(attempt);
      this.deps.completion?.warn(`原回合持久化待确认，将自动重试：${(error as Error).message}`);
      return;
    }
    return this.retryCompletions();
  }

  reset(): void { this.pending.clear(); }

  retryCompletions(): Promise<void> {
    if (this.settling) return this.settling;
    if (!this.deps.completion || !this.pending.size || !this.deps.available()) return Promise.resolve();
    // Reading/flushing a native session stays outside the lifecycle gate: a
    // newer supplement may arrive while the old turn flushes. Commit rechecks
    // its identity under the gate and in SQL, so the old turn cannot win.
    const run = async () => {
      for (const [id, attempt] of [...this.pending]) {
        if (!this.deps.available() || Date.now() < attempt.nextAt) continue;
        const revision = attempt.revision;
        const consumed = () => { if (attempt.revision === revision) this.pending.delete(id); else attempt.nextAt = 0; };
        let executionId: string | null | undefined;
        try {
          await this.idle();
          const item = await this.deps.repo().get(id);
          if (!item || item.status !== 'running') {
            // The transaction may have committed before its acknowledgement
            // was lost. Reconcile capacity as well as the idempotent receipt.
            await this.pump();
            consumed(); continue;
          }
          executionId = item.execution_id;
          const evidence = await this.deps.repo().ownsExecution(item) ? await this.deps.completion!.read(item)
            : { kind: 'unproven' as const, reason: '执行记录与当前账本归属不符，请核对原事项。' };
          if (evidence.kind === 'pending' && !attempt.recovering) { attempt.nextAt = Date.now() + 1000; continue; }
          if (evidence.kind !== 'complete') {
            await this.gate(async () => {
              const fresh = await this.deps.repo().get(id);
              if (fresh?.status !== 'running' || fresh.execution_id !== item.execution_id) return;
              const reconciled = await this.deps.repo().update(id, { status: 'needs_reconciliation',
                progress: evidence.kind === 'unproven' ? evidence.reason : '重启后未找到可核验的原完成回合，请先核对实际结果，勿盲目重发。' });
              if (reconciled) this.deps.track(reconciled);
              await this.fillSlots();
            });
          } else {
            const failed = !!evidence.failure;
            const result = failed ? `「${item.title}」未完成：${evidence.failure}` : evidence.output;
            await this.finish(id, { output: result, failed, generation: evidence.generation, executionId: evidence.executionId,
              delivery: row => {
                const dedupKey = `workitem:${row.id}:result:t${evidence.turn}${row.recovery_gen ? `:g${row.recovery_gen}` : ''}`;
                const ref = row.result_ref as { docUrl?: string; operationId?: string } | null;
                const source = ref?.docUrl ? `\n出处：${ref.docUrl}\n操作编号：${ref.operationId}` : '';
                return row.origin === 'local'
                  ? { dedupKey, channel: 'local', target: row.parent_session_id, kind: 'text', content: { text: `[事项回传]「${row.title}」${failed ? '未完成' : '已完成'}；请向本人汇报要点与出处。\n\n${result}${source}` } }
                  : { dedupKey, channel: 'feishu', target: row.delivery.replace(/^feishu:/, ''), kind: 'text', content: { text: `「${row.title}」${failed ? '未完成' : '已完成'}：\n${result}${source}` } };
              } });
            this.deps.completion!.delivered();
          }
          consumed();
        } catch (error) {
          this.deferRetry(attempt);
          const message = `原回合结算暂未提交，将自动重试：${(error as Error).message}`;
          this.deps.completion!.warn(message);
          try {
            await this.gate(async () => {
              const fresh = await this.deps.repo().get(id);
              if (fresh?.status === 'running' && fresh.execution_id === executionId) {
                const updated = await this.deps.repo().update(id, { progress: message });
                if (updated) this.deps.track(updated);
              }
            });
          } catch { /* DB can be wholly unavailable; the native evidence remains independent. */ }
        }
      }
    };
    this.settling = run().finally(() => { this.settling = null; });
    return this.settling;
  }

  /** Resume persisted children first, then fill slots even when the restart
   * contains only queued/accepted items. Failed recovery is visible and does
   * not consume capacity forever. */
  async recover(): Promise<void> {
    if (this.deps.completion) {
      for (const item of await this.deps.repo().list(['running'], 10000)) {
        if (item.execution_id) this.pending.set(item.id, { failures: 0, nextAt: 0, recovering: true, revision: 0 });
      }
      await this.retryCompletions();
    }
    return this.gate(async () => {
      const repo = this.deps.repo();
      for (const item of await repo.list(['running'], 10000)) {
        if (item.execution_id) continue; // Same-generation settlement owns these; never resend the input.
        if (item.id.startsWith('pa24-work-notes-')) {
          await repo.update(item.id, { status: 'failed', progress: '重启中断了候选刷新；请重新发起。' });
          continue;
        }
        const gen = (item.recovery_gen ?? 0) + 1;
        await repo.setRecoveryGen(item.id, gen);
        try {
          if (!item.child_session_id) throw new Error('缺少原生 Worker 会话映射');
          await this.deps.quiesce?.(item);
          const current = { ...item, recovery_gen: gen };
          const executing = this.deps.completion ? await repo.beginExecution(current, this.deps.completion.workspacePath(), 'followup') : current;
          await this.deps.resume(executing, `[恢复 第${gen}代] 服务重启。请先核对已完成步骤与外部结果，再继续未完成部分；已成功的操作不要重复执行。`);
          await repo.update(item.id, { progress: `重启恢复（第 ${gen} 代）；等待 Worker 核对后续办` });
        } catch (error) {
          await repo.update(item.id, { status: 'needs_reconciliation', progress: `恢复输入未确认：${(error as Error).message}` });
        }
        const fresh = await repo.get(item.id);
        if (fresh) this.deps.track(fresh);
      }
      await this.fillSlots();
    });
  }
}
