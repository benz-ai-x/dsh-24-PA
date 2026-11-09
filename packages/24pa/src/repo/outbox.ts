// Split from repo.ts (round-3 review): one aggregate per file; the
// Repos facade in index.ts is the unchanged seam every caller already uses.
import type { PaDb, PaQueryer } from '../db.js';
import type { WeixinIdentity, WeixinAcceptance } from '../weixin-protocol.js';
import { randomUUID } from 'node:crypto';

export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'unknown' | 'limited' | 'failed' | 'expired';
export interface DeliveryAssociation { inboxEventId?: string; workItemId?: string; workerRunId?: string; planId?: string; skillRunId?: string; noticeId?: string }

export interface OutboxRow {
  id: number;
  dedup_key: string;
  channel: 'feishu' | 'local' | 'wecom' | 'weixin';
  target: string;
  kind: 'text' | 'card' | 'audio';
  content: any;
  status: OutboxStatus;
  message_id: string | null;
  attempts: number;
  next_attempt_at: Date | null;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
  binding_generation?: string | null;
  delivery_target?: WeixinIdentity | null;
  association?: DeliveryAssociation | null;
  client_id?: string | null;
  acceptance?: WeixinAcceptance | null;
  segment_group?: string | null;
  segment_index?: number;
  revision?: number;
}

export interface NewOutbox {
  dedupKey: string;
  channel: OutboxRow['channel'];
  target: string;
  kind: 'text' | 'card' | 'audio';
  content: unknown;
  deliveryTarget?: WeixinIdentity;
  association?: DeliveryAssociation;
  segmentGroup?: string;
  segmentIndex?: number;
}

/** Shared insertion for business transactions that also enqueue a notification. */
export async function enqueueOutbox(db: PaQueryer, row: NewOutbox): Promise<{ created: boolean; row: OutboxRow }> {
  if (row.channel === 'weixin' && (!row.deliveryTarget || row.target !== row.deliveryTarget.ownerId ||
    !row.association || !(row.association.inboxEventId || row.association.workItemId ||
      row.association.planId && row.association.skillRunId && row.association.noticeId))) throw new Error('微信投递缺少固定身份或显式输入/工作/计划结果关联。');
  const result = await db.query<OutboxRow>(
    `insert into pa24.outbox (dedup_key, channel, target, kind, content, status, binding_generation, delivery_target, association, client_id, segment_group, segment_index)
     values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11) on conflict (dedup_key) do nothing returning *`,
    [row.dedupKey, row.channel, row.target, row.kind, JSON.stringify(row.content), row.deliveryTarget?.generation ?? null,
      row.deliveryTarget ? JSON.stringify(row.deliveryTarget) : null, row.association ? JSON.stringify(row.association) : null,
      row.channel === 'weixin' ? `24pa-${randomUUID()}` : null, row.segmentGroup ?? null, row.segmentIndex ?? 0],
  );
  if (result.rowCount === 0) {
    const existing = await db.query<OutboxRow>('select * from pa24.outbox where dedup_key = $1', [row.dedupKey]);
    return { created: false, row: existing.rows[0]! };
  }
  return { created: true, row: result.rows[0]! };
}

export class OutboxRepo {
  constructor(private readonly db: PaDb) {}

  /** Idempotent enqueue: one business notification keeps one stable key. */
  async enqueue(row: NewOutbox): Promise<{ created: boolean; row: OutboxRow }> {
    return enqueueOutbox(this.db, row);
  }
  async enqueueGroup(rows: NewOutbox[]): Promise<OutboxRow[]> {
    return this.db.withTransaction(async tx => { const result: OutboxRow[] = []; for (const row of rows) result.push((await enqueueOutbox(tx, row)).row); return result; });
  }

  async recoverInterrupted(): Promise<void> {
    await this.db.query(`update pa24.outbox set status = 'unknown', revision = revision + 1, last_error = '投递中断且未保存平台回执；请先核对，不自动重发。' where status = 'sending' and message_id is null and acceptance is null`);
    await this.db.query(`update pa24.outbox set status = 'pending', revision = revision + 1, next_attempt_at = null where status in ('sending', 'unknown') and (message_id is not null or acceptance is not null)`);
  }

  async claim(limit: number): Promise<OutboxRow[]> {
    const result = await this.db.query<OutboxRow>(
      `update pa24.outbox set status = 'sending', attempts = attempts + 1, revision = revision + 1
       where id in (
         select id from pa24.outbox
         where status = 'pending' and (next_attempt_at is null or next_attempt_at <= now())
         and (segment_group is null or not exists (
           select 1 from pa24.outbox earlier where earlier.segment_group = pa24.outbox.segment_group
           and earlier.segment_index < pa24.outbox.segment_index and earlier.status <> 'sent'
         ))
         order by id limit $1 for update skip locked
       ) returning *`,
      [limit],
    );
    return result.rows;
  }

  async mark(id: number, patch: { status: OutboxStatus; messageId?: string; acceptance?: WeixinAcceptance; error?: string; retryInMs?: number; releaseAttempt?: boolean }): Promise<void> {
    await this.db.query(
      `update pa24.outbox set
         status = case when $8::bool then 'expired' else $2::text end,
         message_id = coalesce($3, message_id),
         acceptance = coalesce($10, acceptance), revision = revision + 1,
         last_error = $4,
         attempts = case when $9::bool and attempts > 0 then attempts - 1 else attempts end,
         sent_at = case when $5::bool then now() else sent_at end,
         next_attempt_at = case when $6::bool then now() + make_interval(secs => $7) else next_attempt_at end
       where id = $1`,
      [id, patch.status, patch.messageId ?? null, patch.error ?? null, patch.status === 'sent', patch.retryInMs !== undefined, (patch.retryInMs ?? 0) / 1000, patch.status === 'expired', patch.releaseAttempt === true, patch.acceptance ? JSON.stringify(patch.acceptance) : null],
    );
  }
  async get(id: number): Promise<OutboxRow | null> { return (await this.db.query<OutboxRow>('select * from pa24.outbox where id = $1', [id])).rows[0] ?? null; }
  async byInbox(eventId: string): Promise<OutboxRow[]> {
    const rows = (await this.db.query<OutboxRow>(`select * from pa24.outbox where channel = 'weixin'
      and binding_generation = (select binding_generation from pa24.inbox where event_id = $1) order by id`, [eventId])).rows;
    return rows.filter(row => row.association?.inboxEventId === eventId);
  }
  async weixinRows(generation: string, offset = 0): Promise<OutboxRow[]> {
    return (await this.db.query<OutboxRow>('select * from pa24.outbox where binding_generation = $1 order by id desc limit 50 offset $2', [generation, offset])).rows;
  }
  async review(input: { id: number; revision: number; requestId: string; actorSessionId: string;
    generation: string; action: 'received' | 'retry' | 'abandon'; evidence: string }): Promise<OutboxRow> {
    return this.db.withTransaction(async tx => {
      const row = (await tx.query<OutboxRow>('select * from pa24.outbox where id = $1 for update', [input.id])).rows[0];
      if (!row || row.channel !== 'weixin' || row.binding_generation !== input.generation) throw new Error('微信投递身份不符。');
      const previous = (await tx.query<{ outbox_id: number; actor_session_id: string; action: string; evidence: { text: string } }>('select * from pa24.delivery_review where request_id = $1', [input.requestId])).rows[0];
      if (previous) {
        if (Number(previous.outbox_id) !== Number(row.id) || previous.actor_session_id !== input.actorSessionId || previous.action !== input.action || previous.evidence.text !== input.evidence) throw new Error('核对请求标识已用于其他操作。');
        return row;
      }
      if (row.revision !== input.revision || !input.evidence.trim() || !input.actorSessionId) throw new Error('投递版本已改变或缺少本人核对依据，请刷新。');
      if (input.action === 'received' && row.status !== 'unknown') throw new Error('只有未知投递需要本人确认已收到。');
      if (input.action === 'retry' && !['unknown', 'failed', 'limited'].includes(row.status)) throw new Error('仅可补投已核对的未知、失败或受限消息。');
      if (input.action === 'abandon' && !['pending', 'failed', 'limited'].includes(row.status)) throw new Error('仅可放弃明确未发送的消息；未知发送须先核对。');
      if (row.acceptance || row.message_id) throw new Error('已有平台接纳依据，只能补记，不能重发或放弃。');
      await tx.query('insert into pa24.delivery_review (request_id, outbox_id, actor_session_id, action, evidence) values ($1, $2, $3, $4, $5)',
        [input.requestId, row.id, input.actorSessionId, input.action, JSON.stringify({ text: input.evidence, revision: input.revision, generation: input.generation, priorStatus: row.status })]);
      return (await tx.query<OutboxRow>(`update pa24.outbox set status = $2, acceptance = $3, revision = revision + 1,
        attempts = 0, next_attempt_at = null, last_error = $4 where id = $1 returning *`, [row.id,
        input.action === 'abandon' ? 'expired' : 'pending', input.action === 'received' ? JSON.stringify({ basis: 'owner_visible', at: new Date().toISOString() }) : null,
        input.action === 'abandon' ? '主人放弃该次未发送投递，业务结果保留。' : '主人已核对原投递，等待补记或明确补投。'])).rows[0]!;
    });
  }

  async recent(limit = 50): Promise<OutboxRow[]> {
    const result = await this.db.query<OutboxRow>('select * from pa24.outbox order by id desc limit $1', [limit]);
    return result.rows;
  }
}
