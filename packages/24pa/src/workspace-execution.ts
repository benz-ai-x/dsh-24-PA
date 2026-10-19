import { AsyncLocalStorage } from 'node:async_hooks';

type Lease = { active: boolean };

/** Concurrent business executions hold the active workspace until their last
 * receipt is saved. Only workspace/configuration transitions are exclusive. */
export class WorkspaceExecution {
  private readonly context = new AsyncLocalStorage<Lease | undefined>();
  private readonly pending = new Set<Promise<unknown>>();
  private paused = false;
  private closed = false;
  private changing: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const inherited = this.context.getStore();
    if (inherited) {
      if (!inherited.active) return Promise.reject(new Error('执行归属已结束，不能继续使用工作区。'));
      return work();
    }
    if (this.closed || this.paused) return Promise.reject(new Error('工作区正在切换或已停止，请稍后重试。'));
    const lease: Lease = { active: true };
    const result = this.context.run(lease, async () => work());
    this.pending.add(result);
    void result.finally(() => { lease.active = false; this.pending.delete(result); }).catch(() => { });
    return result;
  }

  /** Host schedulers and detached background work must acquire their own lease. */
  detached<T>(work: () => T): T { return this.context.run(undefined, work); }

  transition<T>(change: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return Promise.reject(new Error('不能在业务执行内部切换工作区。'));
    const result = this.changing.then(async () => {
      if (this.closed) throw new Error('24私助已停止。');
      this.paused = true;
      await Promise.allSettled([...this.pending]);
      const lease: Lease = { active: true };
      try { return await this.context.run(lease, change); }
      finally { lease.active = false; this.paused = false; }
    });
    this.changing = result.catch(() => { });
    return result;
  }

  /** Host events wait for a transition, then recheck their captured binding. */
  afterTransition<T>(work: () => Promise<T>): Promise<T> {
    return this.detached(() => this.changing.then(() => this.run(work)));
  }

  read<T>(work: () => Promise<T>): Promise<T> {
    return this.context.getStore() ? this.run(work) : this.afterTransition(work);
  }

  stopAccepting(): void { this.closed = true; }

  async close(): Promise<void> {
    this.stopAccepting();
    await this.changing;
    await Promise.allSettled([...this.pending]);
  }
}
