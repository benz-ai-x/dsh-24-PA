import type { InboxRepo, InboxRow } from './repo.js';

/** Owns a received message until its reply is durable. A workspace may retire
 * only after both dispatch and admitted turns have released its ledger. */
export class InboxLifecycle {
  private paused = false;
  private draining: Promise<void> | null = null;
  private readonly admissions = new Map<string, Promise<void>>();
  private readonly replies = new Map<string, { inboxId: string; finish?: () => Promise<void> }[]>();
  private finishing: Promise<void> | null = null;

  constructor(private readonly deps: {
    repo(): InboxRepo | null;
    available(): boolean;
    process(row: InboxRow): Promise<void>;
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
    this.draining = this.drain(repo).catch(() => {}).finally(() => { this.draining = null; });
  }

  private async drain(repo: InboxRepo): Promise<void> {
    await this.flushReplies();
    while (!this.paused && this.deps.available()) {
      const rows = await repo.claim(5);
      if (!rows.length) return;
      for (const row of rows) {
        try { await this.deps.process(row); }
        catch (error) { await repo.mark(row.event_id, { status: 'rejected', error: (error as Error).message }); }
      }
    }
  }

  async admit(sessionId: string, inboxId: string, requestId: string, submit: () => Promise<void>): Promise<void> {
    const repo = this.deps.repo()!;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    this.admissions.set(sessionId, pending);
    try {
      await submit();
      await repo.mark(inboxId, { status: 'admitted', requestId, targetSession: sessionId });
      const queue = this.replies.get(sessionId) ?? [];
      queue.push({ inboxId });
      this.replies.set(sessionId, queue);
    } finally {
      this.admissions.delete(sessionId);
      release();
    }
  }

  async complete(sessionId: string, deliver: (inboxId: string) => Promise<void>, error?: string): Promise<void> {
    // A fast host may finish a turn while prompt admission is still flushing.
    await this.admissions.get(sessionId);
    const pending = this.replies.get(sessionId)?.find(row => !row.finish);
    if (!pending) return;
    const repo = this.deps.repo()!;
    // Assign the result once. A later turn can never consume this input even
    // when its local commit fails and is retried by the dispatcher.
    pending.finish = async () => {
      await deliver(pending.inboxId);
      await repo.mark(pending.inboxId, { status: error ? 'rejected' : 'delivered', error });
    };
    await this.flushReplies();
  }

  private flushReplies(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.finishing = (async () => {
      for (const queue of this.replies.values()) {
        while (queue[0]?.finish) { await queue[0].finish(); queue.shift(); }
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
