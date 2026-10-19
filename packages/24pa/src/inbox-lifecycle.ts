import type { InboxRepo, InboxRow } from './repo.js';

/** Owns a received message until its reply is durable. A workspace may retire
 * only after both dispatch and admitted turns have released its ledger. */
export class InboxLifecycle {
  private paused = false;
  private draining: Promise<void> | null = null;
  private readonly admissions = new Map<string, Promise<void>>();
  private readonly replies = new Map<string, { inboxId: string; requestId: string; finish?: () => Promise<void> }[]>();
  private finishing: Promise<void> | null = null;

  constructor(private readonly deps: {
    repo(): InboxRepo | null;
    available(): boolean;
    process(row: InboxRow): Promise<void>;
    execute?<T>(work: () => Promise<T>): Promise<T>;
  }) {}

  async assertIdle(): Promise<void> {
    await this.flushReplies();
    if (this.admissions.size || [...this.replies.values()].some(q => q.length) || await this.deps.repo()?.hasUnsettled()) {
      throw new Error('有已接收消息正在处理或等待回传；请完成后再切换工作区或接入身份。');
    }
    await this.draining;
  }

  async pauseForSwitch(): Promise<void> { this.paused = true; await this.assertIdle(); }
  resume(): void { this.paused = false; this.dispatch(); }
  async stop(): Promise<void> { this.paused = true; await this.draining; await this.flushReplies().catch(() => {}); }

  dispatch(): void {
    if (this.paused || this.draining || !this.deps.available()) return;
    const repo = this.deps.repo();
    if (!repo) return;
    this.draining = (this.deps.execute ? this.deps.execute(() => this.drain(repo)) : this.drain(repo)).catch(() => {}).finally(() => { this.draining = null; });
  }

  private async drain(repo: InboxRepo): Promise<void> {
    await this.flushReplies();
    while (!this.paused && this.deps.available()) {
      const rows = await repo.claim(5);
      if (!rows.length) return;
      for (const row of rows) {
        try { await this.deps.process(row); }
        catch (error) {
          const admitted = (await repo.get(row.event_id))?.status === 'admitted';
          const status = admitted && (error as { outcome?: string }).outcome !== 'rejected' ? 'admitted' : 'rejected';
          // Local bookkeeping failure after acceptance never makes an input
          // retryable. The persisted intent and in-memory identity survive.
          await repo.mark(row.event_id, { status, error: (error as Error).message }).catch(() => {});
        }
      }
    }
  }

  async admit(sessionId: string, inboxId: string, requestId: string, submit: () => Promise<string | void>): Promise<void> {
    const repo = this.deps.repo()!;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    this.admissions.set(sessionId, pending);
    try {
      // Persist intent before crossing the host boundary. A timeout after
      // acceptance must never turn into an automatically resendable input.
      await repo.mark(inboxId, { status: 'admitted', requestId, targetSession: sessionId });
      const queue = this.replies.get(sessionId) ?? [];
      const reply = { inboxId, requestId };
      queue.push(reply);
      this.replies.set(sessionId, queue);
      try {
        const acceptedMessageId = await submit();
        if (typeof acceptedMessageId === 'string') {
          // Keep the host identity before any fallible local write. A later
          // consumed-turn receipt can repair this write without resending.
          reply.requestId = acceptedMessageId;
          await repo.mark(inboxId, { status: 'admitted', requestId: acceptedMessageId });
        }
      }
      catch (error) {
        if ((error as { outcome?: string }).outcome === 'rejected') {
          queue.splice(queue.indexOf(reply), 1);
          throw error;
        }
        await repo.mark(inboxId, { status: 'admitted', requestId: reply.requestId, error: `宿主接纳待核对，不能自动重发：${(error as Error).message}` }).catch(() => {});
      }
    } finally {
      this.admissions.delete(sessionId);
      release();
    }
  }

  async complete(sessionId: string, requestIds: ReadonlySet<string>, deliver: (inboxId: string) => Promise<void>, error?: string): Promise<void> {
    await this.admissions.get(sessionId);
    const repo = this.deps.repo()!;
    for (const pending of this.replies.get(sessionId) ?? []) {
      if (pending.finish || !requestIds.has(pending.requestId)) continue;
      pending.finish = async () => {
        await deliver(pending.inboxId);
        await repo.mark(pending.inboxId, { status: error ? 'rejected' : 'delivered', requestId: pending.requestId, error });
      };
    }
    await this.flushReplies();
  }

  async cancelTarget(sessionId: string, error: string): Promise<void> {
    await this.admissions.get(sessionId);
    await this.deps.repo()!.rejectForTarget(sessionId, error);
    this.replies.delete(sessionId);
  }

  private flushReplies(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.finishing = (async () => {
      for (const queue of this.replies.values()) {
        for (let index = 0; index < queue.length;) {
          const reply = queue[index]!;
          if (!reply.finish) { index++; continue; }
          await reply.finish(); queue.splice(index, 1);
        }
      }
    })().finally(() => { this.finishing = null; });
    return this.finishing;
  }

  static async recover(repo: InboxRepo, interrupted: (row: InboxRow) => Promise<void>): Promise<void> {
    await repo.resetProcessing();
    for (const row of await repo.listAdmitted()) {
      await interrupted(row);
      await repo.mark(row.event_id, { status: 'rejected', error: '重启中断；请重新发送该消息' });
    }
  }
}
