import type { OutboxRepo, OutboxRow, MessageRouteRepo } from './repo.js';

export interface DeliveryAdapter {
  available(): boolean;
  supports(kind: OutboxRow['kind']): boolean;
  send(row: OutboxRow): Promise<{ messageId: string }>;
}
export interface DeliveryHold { status: 'pending' | 'failed' | 'expired'; error: string; retryInMs?: number }
/** Preparation completed, but no platform request has been dispatched. */
export class DeliveryHeld extends Error {
  constructor(readonly hold: DeliveryHold) { super(hold.error); }
}

/** Owns durable delivery through platform confirmation and local reply routing.
 * A recorded message id is never sent again, even when route storage fails. */
export class OutboxDelivery {
  private draining: Promise<void> | null = null;
  private paused = false;
  constructor(private readonly deps: {
    repo(): OutboxRepo;
    routes(): MessageRouteRepo;
    adapters: Partial<Record<OutboxRow['channel'], DeliveryAdapter>>;
    sent(): void;
    beforeSend?(row: OutboxRow): Promise<DeliveryHold | null>;
    updated?(row: OutboxRow): Promise<void>;
  }) {}

  recover(): Promise<void> { return this.deps.repo().recoverInterrupted(); }

  idle(): Promise<void> { return this.draining ?? Promise.resolve(); }
  async pause(): Promise<void> { this.paused = true; await this.idle(); }
  resume(): void { this.paused = false; }

  drain(): Promise<void> {
    if (this.paused) return Promise.resolve();
    if (this.draining) return this.draining;
    this.draining = this.deliver().finally(() => { this.draining = null; });
    return this.draining;
  }

  private async deliver(): Promise<void> {
    const repo = this.deps.repo();
    for (;;) {
      if (this.paused) return;
      const rows = await repo.claim(5);
      if (!rows.length) return;
      for (const row of rows) {
        try { await this.deliverRow(repo, row); }
        finally {
          try { await this.deps.updated?.(row); }
          catch (error) { console.warn(`[pa24] 投递回执汇总待补记：${(error as Error).message}`); }
        }
      }
    }
  }
  private async deliverRow(repo: OutboxRepo, row: OutboxRow): Promise<void> {
    let messageId = row.message_id;
    if (!messageId) {
      let hold: DeliveryHold | null;
      try { hold = await this.deps.beforeSend?.(row) ?? null; }
      catch (error) { hold = { status: 'pending', error: `投递前核验未完成：${(error as Error).message}`, retryInMs: 60000 }; }
      if (hold) { await repo.mark(row.id, { ...hold, releaseAttempt: true }); return; }
      const adapter = this.deps.adapters[row.channel];
      if (!adapter?.supports(row.kind)) {
        await repo.mark(row.id, { status: 'failed', error: '当前渠道不支持该消息类型。' });
        return;
      }
      if (!adapter.available()) {
        await repo.mark(row.id, { status: 'pending', error: '传输未连接，暂缓投递', retryInMs: 60_000 });
        return;
      }
      try {
        messageId = (await adapter.send(row)).messageId;
        if (!messageId) throw Object.assign(new Error('平台未返回消息回执；请先核对。'), { outcome: 'unknown' });
      } catch (error) {
        if (error instanceof DeliveryHeld) { await repo.mark(row.id, { ...error.hold, releaseAttempt: true }); return; }
        const unknown = (error as { outcome?: string })?.outcome !== 'failed';
        await repo.mark(row.id, { status: unknown ? 'unknown' : row.attempts >= 3 ? 'failed' : 'pending', error: (error as Error).message, ...(!unknown && row.attempts < 3 ? { retryInMs: 2000 * row.attempts } : {}) });
        return;
      }
      try {
        // Keep sending until routing is durable. Crash recovery sees this
        // receipt and repairs the local step without invoking the adapter.
        await repo.mark(row.id, { status: 'sending', messageId });
        this.deps.sent();
      } catch (error) {
        await repo.mark(row.id, { status: 'unknown', messageId, error: `平台已确认，本地回执保存失败：${(error as Error).message}` }).catch(() => {});
        return;
      }
    }
    try {
      if (row.channel === 'feishu') await this.route(row.dedup_key, messageId);
      await repo.mark(row.id, { status: 'sent', messageId });
    } catch (error) {
      // Retrying this row means routing only because message_id survives.
      await repo.mark(row.id, { status: 'pending', messageId, error: `已送达，回复关联待补记：${(error as Error).message}`, retryInMs: Math.min(60_000, 2000 * row.attempts) }).catch(() => {});
    }
  }

  private async route(key: string, messageId: string): Promise<void> {
    const [prefix, id] = key.split(':');
    if (!id) return;
    if (prefix === 'workitem') await this.deps.routes().record(messageId, { kind: 'workitem', workItemId: id });
    else if (prefix === 'noteack' || prefix === 'notereview') await this.deps.routes().record(messageId, { kind: 'note', noteId: id });
    else if (prefix === 'reply') await this.deps.routes().record(messageId, { kind: 'reply', inboxEventId: id });
  }
}
