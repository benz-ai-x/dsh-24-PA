import { createHash, randomUUID } from 'node:crypto';
import type { PaDb, PaQueryer } from '../db.js';
import type { WeixinEnvelope, WeixinIdentity } from '../weixin-protocol.js';
import { UNSETTLED_WORK_STATUSES } from './work.js';
import { enqueueOutbox } from './outbox.js';

export interface WeixinBindingRow {
  generation: string; workspace_id: string; account_id: string; owner_id: string; session_id: string;
  state: 'pending' | 'active' | 'retired'; enabled: boolean; session_ready: boolean; version: number; cursor: string;
  last_received_at: Date | null; last_sent_at: Date | null; created_at: Date; updated_at: Date;
}
export interface WeixinImpact {
  fingerprint: string; inbox: string[]; work: string[]; deliveries: number[]; unknown: number[];
}
export const weixinIdentity = (row: WeixinBindingRow): WeixinIdentity => ({ generation: row.generation,
  accountId: row.account_id, ownerId: row.owner_id, sessionId: row.session_id });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function binding(tx: PaQueryer, generation: string, lock = false): Promise<WeixinBindingRow> {
  const row = (await tx.query<WeixinBindingRow>(`select * from pa24.weixin_binding where generation = $1${lock ? ' for update' : ''}`, [generation])).rows[0];
  if (!row) throw new Error('微信绑定不存在。'); return row;
}
async function impact(tx: PaQueryer, row: WeixinBindingRow): Promise<WeixinImpact> {
  const inbox = (await tx.query<{ event_id: string; status: string }>(`select event_id, status from pa24.inbox where binding_generation = $1 and status in ('received', 'processing', 'admitted') order by event_id`, [row.generation])).rows;
  const work = (await tx.query<{ id: string; status: string; revision: number }>(`select id, status, revision from pa24.work_item where parent_session_id = $1 and status = any($2) order by id`, [row.session_id, UNSETTLED_WORK_STATUSES])).rows;
  const deliveries = (await tx.query<{ id: number; status: string; revision: number }>(`select id, status, revision from pa24.outbox where binding_generation = $1 and status not in ('sent', 'expired') order by id`, [row.generation])).rows;
  return { fingerprint: digest([row.generation, row.version, inbox, work, deliveries]), inbox: inbox.map(x => x.event_id), work: work.map(x => x.id),
    deliveries: deliveries.map(x => x.id), unknown: deliveries.filter(x => ['sending', 'unknown'].includes(x.status)).map(x => x.id) };
}

/** Owns durable remote identity (including retired Sessions) and atomic receive/cursor. */
export class WeixinRepo {
  constructor(private readonly db: PaDb) {}
  async list(): Promise<WeixinBindingRow[]> { return (await this.db.query<WeixinBindingRow>('select * from pa24.weixin_binding order by created_at, generation')).rows; }
  get(generation: string): Promise<WeixinBindingRow> { return binding(this.db, generation); }
  async active(workspaceId: string): Promise<WeixinBindingRow | null> {
    return (await this.db.query<WeixinBindingRow>("select * from pa24.weixin_binding where workspace_id = $1 and state = 'active'", [workspaceId])).rows[0] ?? null;
  }
  async register(workspaceId: string, accountId: string, ownerId: string): Promise<WeixinBindingRow> {
    const generation = randomUUID(), sessionId = `pa24-weixin-${randomUUID()}`;
    return (await this.db.query<WeixinBindingRow>(`insert into pa24.weixin_binding (generation, workspace_id, account_id, owner_id, session_id, state)
      values ($1, $2, $3, $4, $5, 'pending') returning *`, [generation, workspaceId, accountId, ownerId, sessionId])).rows[0]!;
  }
  async impact(generation: string): Promise<WeixinImpact> { return impact(this.db, await this.get(generation)); }
  async sessionReady(generation: string): Promise<void> { await this.db.query('update pa24.weixin_binding set session_ready = true where generation = $1', [generation]); }
  async reviewInput(input: { eventId: string; generation: string; requestId: string; actorSessionId: string; evidence: string }): Promise<void> {
    await this.db.withTransaction(async tx => {
      const owner = await binding(tx, input.generation, true);
      if (owner.enabled) throw new Error('先停止微信入口，再核对未结输入。');
      const row = (await tx.query<{ status: string; binding_generation: string }>('select status, binding_generation from pa24.inbox where event_id = $1 for update', [input.eventId])).rows[0];
      const old = (await tx.query<{ request_id: string; evidence: string }>('select request_id, evidence from pa24.weixin_input_review where event_id = $1', [input.eventId])).rows[0];
      if (old) { if (old.request_id !== input.requestId || old.evidence !== input.evidence) throw new Error('该输入已有核对记录，请刷新。'); return; }
      if (!row || row.binding_generation !== input.generation || !['received', 'admitted'].includes(row.status) || !input.evidence.trim()) throw new Error('原输入状态或身份已改变。');
      await tx.query('insert into pa24.weixin_input_review (event_id, request_id, actor_session_id, evidence) values ($1, $2, $3, $4)', [input.eventId, input.requestId, input.actorSessionId, input.evidence]);
      await tx.query("update pa24.inbox set status = 'delivered', error = '主人已核对关闭原输入；未证明原业务成功，未重新执行。', processed_at = now() where event_id = $1", [input.eventId]);
    });
  }
  async activate(generation: string, expected: { generation: string; version: number; fingerprint: string } | null): Promise<WeixinBindingRow> {
    return this.db.withTransaction(async tx => {
      const next = await binding(tx, generation, true);
      const current = (await tx.query<WeixinBindingRow>("select * from pa24.weixin_binding where workspace_id = $1 and state = 'active' for update", [next.workspace_id])).rows[0];
      if ((current?.generation ?? null) !== (expected?.generation ?? null) || current && current.version !== expected?.version) throw new Error('微信绑定已改变，请重新预览。');
      if (next.state === 'retired') throw new Error('已退休的微信绑定不能重新启用，请重新扫码。');
      if (current) {
        const affected = await impact(tx, current);
        if (affected.fingerprint !== expected!.fingerprint) throw new Error('微信关联记录已改变，请重新预览。');
        if (current.generation !== next.generation) {
          if (affected.inbox.length || affected.work.length || affected.deliveries.length) throw new Error('原微信绑定有未结消息、工作或投递，请先处理后再切换。');
          await tx.query("update pa24.weixin_binding set state = 'retired', enabled = false, version = version + 1, updated_at = now() where generation = $1", [current.generation]);
        }
      }
      return (await tx.query<WeixinBindingRow>("update pa24.weixin_binding set state = 'active', enabled = true, version = version + 1, updated_at = now() where generation = $1 returning *", [generation])).rows[0]!;
    });
  }
  async change(generation: string, version: number, action: 'enable' | 'disable' | 'retire', fingerprint: string): Promise<WeixinBindingRow> {
    return this.db.withTransaction(async tx => {
      const row = await binding(tx, generation, true), affected = await impact(tx, row);
      if (row.version !== version || affected.fingerprint !== fingerprint || row.state !== 'active') throw new Error('微信绑定或关联记录已改变，请重新预览。');
      if (action === 'retire' && (affected.inbox.length || affected.work.length || affected.deliveries.length)) throw new Error('微信绑定有未结消息、工作或投递，请先处理后再解绑。');
      return (await tx.query<WeixinBindingRow>(`update pa24.weixin_binding set state = $2, enabled = $3, version = version + 1, updated_at = now()
        where generation = $1 returning *`, [generation, action === 'retire' ? 'retired' : 'active', action === 'enable'])).rows[0]!;
    });
  }
  async retirePending(generation: string): Promise<void> {
    await this.db.query("update pa24.weixin_binding set state = 'retired', enabled = false, version = version + 1 where generation = $1 and state = 'pending'", [generation]);
  }
  async receive(expected: WeixinBindingRow, nextCursor: string, envelopes: WeixinEnvelope[]): Promise<{ inserted: string[]; rejected: { eventId: string; nativeId: string | null; reason: string }[] }> {
    return this.db.withTransaction(async tx => {
      const row = await binding(tx, expected.generation, true);
      if (row.state !== 'active' || !row.enabled || row.version !== expected.version || row.cursor !== expected.cursor) throw new Error('微信收信归属已停止或改变，未推进游标。');
      const batchId = digest([row.generation, row.cursor, nextCursor, envelopes]);
      const inserted: string[] = [], rejected: { eventId: string; nativeId: string | null; reason: string }[] = [], receipts: { eventId: string; outcome: string }[] = [];
      for (const [index, envelope] of envelopes.entries()) {
        if (digest(weixinIdentity(row)) !== digest({ generation: envelope.generation, accountId: envelope.accountId, ownerId: envelope.ownerId, sessionId: envelope.sessionId })) throw new Error('微信收件身份与绑定不符。');
        const eventId = `weixin-${digest([row.account_id, row.generation, envelope.rejection ? 'rejected' : 'message', envelope.nativeId ?? [batchId, index], envelope.rejection])}`;
        // Encode only the typed allowlist, even if a caller supplied additional raw fields.
        const clean: WeixinEnvelope = { ...weixinIdentity(row), nativeId: envelope.nativeId, text: envelope.text,
          replyTo: envelope.replyTo, rejection: envelope.rejection };
        const result = await tx.query(`insert into pa24.inbox (event_id, source, kind, payload, status, error, target_session, binding_generation)
          values ($1, 'weixin', 'message', $2, $3, $4, $5, $6) on conflict (event_id) do nothing returning event_id`,
        [eventId, JSON.stringify(clean), envelope.rejection ? 'rejected' : 'received', envelope.rejection, row.session_id, row.generation]);
        receipts.push({ eventId, outcome: !result.rowCount ? 'duplicate' : envelope.rejection ? 'rejected' : 'received' });
        if (result.rowCount) {
          if (envelope.rejection) {
            rejected.push({ eventId, nativeId: envelope.nativeId, reason: envelope.rejection });
            // These reasons are produced only after sender/bot/type checks.
            // Refusal and cursor must commit together, including crash recovery.
            if (envelope.nativeId && envelope.rejection.startsWith('首版')) await enqueueOutbox(tx, {
              dedupKey: `weixin-refusal:${eventId}`, channel: 'weixin', target: row.owner_id, kind: 'text',
              content: { text: '微信首版只支持文字交办；图片、文件和语音请改用文字或电脑端。' },
              deliveryTarget: weixinIdentity(row), association: { inboxEventId: eventId },
            });
          }
          else inserted.push(eventId);
        }
      }
      await tx.query('insert into pa24.weixin_batch (id, generation, receipts) values ($1, $2, $3) on conflict (id) do nothing', [batchId, row.generation, JSON.stringify(receipts)]);
      await tx.query(`update pa24.weixin_binding set cursor = $2,
        last_received_at = case when $3 then now() else last_received_at end where generation = $1`, [row.generation, nextCursor, inserted.length > 0]);
      return { inserted, rejected };
    });
  }
  async sent(generation: string): Promise<void> { await this.db.query('update pa24.weixin_binding set last_sent_at = now() where generation = $1', [generation]); }
}
