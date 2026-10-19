import type { WorkItemRepo, WorkItemRow } from './repo/work.js';
import type { NewOutbox } from './repo/outbox.js';

/** The single-host admission gate owns capacity for new work AND continuations.
 * Native child operations stay behind the host adapter; durable state stays in
 * the same repository on SQLite and PostgreSQL. */
export class WorkItemLifecycle {
  private serial: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: {
    repo: () => WorkItemRepo; maxWorkers: () => number; available: () => boolean;
    start: (item: WorkItemRow) => Promise<void>;
    resume: (item: WorkItemRow, input: string) => Promise<void>;
    interrupt: (item: WorkItemRow) => void;
    quiesce?: (item: WorkItemRow) => Promise<void>;
    track: (item: WorkItemRow) => void;
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
      try { await this.deps.start(item); }
      catch (error) {
        const failed = await repo.update(item.id, { status: 'failed', progress: `Worker 未启动：${(error as Error).message}` });
        if (failed) this.deps.track(failed);
      }
    }
  }

  resume(id: string, input: string, supplement = false): Promise<WorkItemRow> {
    return this.gate(async () => {
      if (!this.deps.available()) throw new Error('事项调度尚未就绪。');
      const repo = this.deps.repo();
      const item = await repo.get(id);
      if (!item?.child_session_id) throw new Error('此事项尚无原生 Worker 会话，请核对后重新委派。');
      if (supplement && item.status === 'stopped') throw new Error('事项已停止，不因引用复活。');
      if (['accepted', 'queued'].includes(item.status)) throw new Error('事项尚在排队，请启动后再补充。');
      if (!supplement && item.status === 'running') throw new Error('事项正在运行或排队中。');
      if (item.status !== 'running' && await repo.countByStatus('running') >= this.deps.maxWorkers()) throw new Error('Worker 并发已满，请稍后继续。');
      if (item.status !== 'running') {
        await this.deps.quiesce?.(item);
        await repo.setRecoveryGen(id, (item.recovery_gen ?? 0) + 1);
      }
      const running = await repo.update(id, { status: 'running', progress: supplement ? '收到补充输入，等待 Worker 处理' : '继续处理' });
      this.deps.track(running!);
      try { await this.deps.resume(running!, input); }
      catch (error) {
        const restored = await repo.update(id, { status: item.status, progress: `继续输入未送达：${(error as Error).message}` });
        this.deps.track(restored!);
        throw error;
      }
      return running!;
    });
  }

  stop(id: string): Promise<void> {
    return this.gate(async () => {
      const repo = this.deps.repo();
      const item = await repo.get(id);
      if (!item || !['running', 'queued', 'accepted', 'waiting_input'].includes(item.status)) throw new Error('此事项已结束。');
      const stopped = await repo.update(id, { status: 'stopped', progress: '本人要求停止；已完成的外部操作保留' });
      this.deps.track(stopped!);
      try { if (item.status === 'running') this.deps.interrupt(item); }
      finally { await this.fillSlots(); }
    });
  }

  finish(id: string, result: { output: string; failed?: boolean; generation?: number; delivery: (item: WorkItemRow) => NewOutbox }): Promise<void> {
    return this.gate(async () => {
      const repo = this.deps.repo();
      const item = await repo.get(id);
      if (!item || item.status !== 'running' || (result.generation !== undefined && result.generation !== (item.recovery_gen ?? 0))) return;
      const finished = await repo.finishWithDelivery(id, result.output, result.failed === true, result.delivery(item));
      if (finished) this.deps.track(finished);
      await this.fillSlots();
    });
  }

  /** Resume persisted children first, then fill slots even when the restart
   * contains only queued/accepted items. Failed recovery is visible and does
   * not consume capacity forever. */
  recover(): Promise<void> {
    return this.gate(async () => {
      const repo = this.deps.repo();
      for (const item of await repo.list(['running'], 10000)) {
        if (item.id.startsWith('pa24-work-notes-')) {
          await repo.update(item.id, { status: 'failed', progress: '重启中断了候选刷新；请重新发起。' });
          continue;
        }
        const gen = (item.recovery_gen ?? 0) + 1;
        await repo.setRecoveryGen(item.id, gen);
        try {
          if (!item.child_session_id) throw new Error('缺少原生 Worker 会话映射');
          await this.deps.quiesce?.(item);
          await this.deps.resume({ ...item, recovery_gen: gen }, `[恢复 第${gen}代] 服务重启。请先核对已完成步骤与外部结果，再继续未完成部分；已成功的操作不要重复执行。`);
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
