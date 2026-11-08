import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { weixinIdentity } from '../../lib/repo/weixin.js';
import { OutboxDelivery } from '../../lib/outbox-delivery.js';
import { WeixinCredentialVault } from '../../lib/weixin-credentials.js';
import { parseWeixinWire, weixinSendReceipt, weixinEnvelope, weixinUpdates, splitWeixinText } from '../../lib/weixin-protocol.js';
import { redactDiagnostic } from '../../lib/diagnostic-redaction.js';
import { startPgCluster } from '../helpers/pg.mjs';

describe('WX 协议边界', () => {
  it('uint64 消息号无损；ret 缺省有原生号与 ret0 无号均独立记录接纳', () => {
    const data = parseWeixinWire('{"message_id":18446744073709551615}');
    expect(weixinSendReceipt({ http: 200, data })).toMatchObject({ messageId: '18446744073709551615', acceptance: { basis: 'native_message_id' } });
    expect(weixinSendReceipt({ http: 200, data: { ret: 0 } })).toMatchObject({ acceptance: { basis: 'explicit_zero' } });
    expect(weixinSendReceipt({ http: 200, data: { ret: 0 } }).messageId).toBeUndefined();
  });
  it('客户端号、空对象、矛盾失败、HTTP错误及截断响应不冒充接纳', () => {
    for (const data of [{}, { client_id: 'made-here' }, { ret: '0' }, { message_id: '0' }, { ret: -14, message_id: '123' }]) {
      expect(() => weixinSendReceipt({ http: 200, data })).toThrow();
    }
    expect(() => weixinSendReceipt({ http: 502, data: { ret: 0 } })).toThrow();
    expect(() => weixinSendReceipt({ http: 200, error: 'truncated' })).toThrow();
    expect(weixinUpdates({ http: 200, data: { msgs: [], get_updates_buf: 'cursor' } })).toEqual({ messages: [], cursor: 'cursor' });
    expect(() => weixinUpdates({ http: 200, data: { msgs: [] } })).toThrow();
  });
  it('凭据先剥离；陌生人与群拒绝，分段不切断代理对', () => {
    const identity = { accountId: 'bot', ownerId: 'owner', generation: 'g', sessionId: 's' };
    const raw = { from_user_id: 'owner', to_user_id: 'bot', message_id: '123', message_type: 1, message_state: 2,
      item_list: [{ type: 1, text_item: { text: '请查日程' } }], context_token: 'private-context', bot_token: 'private-bot' };
    const result = weixinEnvelope(raw, identity);
    expect(result.envelope.text).toBe('请查日程'); expect(result.context).toBe('private-context');
    expect(JSON.stringify(result.envelope)).not.toContain('private');
    expect(weixinEnvelope({ ...raw, from_user_id: 'other' }, identity).envelope.rejection).toBeTruthy();
    expect(weixinEnvelope({ ...raw, group_id: 'group' }, identity).envelope.rejection).toBeTruthy();
    const text = 'a'.repeat(3999) + '😀' + '中'.repeat(4001), segments = splitWeixinText(text);
    expect(segments.join('')).toBe(text); expect(segments.every(x => x.length <= 4000 && !/[\uD800-\uDBFF]$/.test(x))).toBe(true);
    expect(JSON.stringify(redactDiagnostic({ nested: { context_token: 'secret-a', botToken: 'secret-b', verify_code: '1234' }, error: 'context_token=secret-c qrcode=secret-d' }))).not.toMatch(/secret-|1234/);
  });
});

for (const backend of ['sqlite', 'postgres']) describe(`WX 持久收发 / ${backend}`, () => {
  let db, repos, root, cluster;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-wx-ledger-'));
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else db = new SqliteDb(join(root, 'ledger.db'));
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  const fresh = async () => { const row = await repos.weixin.register(randomUUID(), 'bot', 'owner'); return repos.weixin.activate(row.generation, null); };
  const envelope = (row, id = '18446744073709551615') => ({ ...weixinIdentity(row), nativeId: id, text: '请查明天的日程', replyTo: null, rejection: null });
  const enqueue = async (row, suffix = '', index = 0) => repos.outbox.enqueue({ dedupKey: `${row.generation}/${index}/${suffix}`, channel: 'weixin', target: row.owner_id, kind: 'text',
    content: { text: `第${index}段` }, deliveryTarget: weixinIdentity(row), association: { inboxEventId: 'input-with:colons', workItemId: 'original-work' },
    segmentGroup: row.generation, segmentIndex: index });
  const delivery = send => new OutboxDelivery({ repo: () => repos.outbox, routes: () => repos.messageRoutes, sent: () => {},
    adapters: { weixin: { available: () => true, supports: () => true, send } } });

  it('续办恢复按持久采用输入找到原运行和结果，不依赖当前交办或投递入口', async () => {
    const id = randomUUID(), run = `run-${id}`, sourceId = `input-${id}`, outboxKey = `result-${id}`;
    await db.query("insert into pa24.work_item (id,title,role,instruction,origin,parent_session_id,delivery,status) values ($1,'原交办','memo','核对','local','original-local','local','completed')", [id]);
    await db.query("insert into pa24.worker_run (id,work_item_id,session_id,source,status,instruction,snapshot,outbox_key) values ($1,$2,$2,'continuation','completed','核对','{}',$3)", [run, id, outboxKey]);
    const scope = { workspaceId: 'original-workspace', parentSessionId: 'original-local', ownerInput: { kind: 'weixin', sourceId, remoteIdentity: { accountId: 'bot', ownerId: 'owner', generation: 'current', sessionId: 'wx-session' } } };
    await db.query("insert into pa24.worker_run_input (execution_id,run_id,scope,instruction,status) values ($1,$2,$3,'核对','adopted')", [id, run, JSON.stringify(scope)]);
    expect(await repos.workerRuns.ownerInputResults(sourceId)).toMatchObject([{ scope, status: 'completed', adopted: 'adopted', outbox_key: null }]);
    await repos.outbox.enqueue({ dedupKey: outboxKey, channel: 'local', target: 'original-local', kind: 'text', content: { text: '原结果' } });
    expect(await repos.workerRuns.ownerInputResults(sourceId)).toMatchObject([{ scope, status: 'completed', adopted: 'adopted', outbox_key: outboxKey }]);
    expect(await repos.workerRuns.ownerInputResults('first-input')).toEqual([]);
  });

  it('接纳/拒绝/重复同事务推进游标；故障回滚与停用后迟到批次不跳消息', async () => {
    const row = await fresh(), first = envelope(row), rejected = { ...first, nativeId: '124', rejection: '首版仅支持文字', text: '' };
    const accepted = await repos.weixin.receive(row, 'cursor-1', [first, rejected, first]);
    expect(accepted.inserted).toHaveLength(1); expect(accepted.rejected).toHaveLength(1);
    const refusal = (await repos.outbox.byInbox(accepted.rejected[0].eventId))[0];
    expect(refusal).toMatchObject({ channel: 'weixin', status: 'pending', binding_generation: row.generation });
    await repos.outbox.review({ id: refusal.id, revision: refusal.revision, generation: row.generation, requestId: randomUUID(), actorSessionId: 'desktop', action: 'abandon', evidence: '隔离测试不发出' });
    const batch = (await db.query('select * from pa24.weixin_batch where generation = $1', [row.generation])).rows[0];
    expect(batch.receipts.map(x => x.outcome)).toEqual(['received', 'rejected', 'duplicate']);
    const current = await repos.weixin.get(row.generation);
    expect(current.cursor).toBe('cursor-1');
    await expect(repos.weixin.receive(current, 'skip', [envelope(row, '125'), { ...envelope(row, '126'), ownerId: 'other' }])).rejects.toThrow();
    expect((await repos.weixin.get(row.generation)).cursor).toBe('cursor-1');
    expect((await db.query("select * from pa24.inbox where binding_generation = $1 and status = 'received'", [row.generation])).rows).toHaveLength(1);
    const affected = await repos.weixin.impact(row.generation);
    await repos.weixin.change(row.generation, row.version, 'disable', affected.fingerprint);
    await expect(repos.weixin.receive(current, 'late', [envelope(row, '127')])).rejects.toThrow(/停止或改变/);
  });
  it('未知首段阻断后段；本人核对无号接纳后只补账，随后原序发后段', async () => {
    const row = await fresh(), a = (await enqueue(row, '', 0)).row, b = (await enqueue(row, '', 1)).row;
    let sends = 0;
    const worker = delivery(async () => { sends++; throw new Error('socket lost'); });
    await worker.drain(); await worker.drain();
    expect(sends).toBe(1); expect((await repos.outbox.get(b.id)).status).toBe('pending');
    const unknown = await repos.outbox.get(a.id);
    await expect(repos.outbox.review({ id: a.id, revision: unknown.revision, generation: row.generation, requestId: randomUUID(), actorSessionId: 'desktop', action: 'abandon', evidence: '未核对' })).rejects.toThrow(/未知/);
    await repos.outbox.review({ id: a.id, revision: unknown.revision, generation: row.generation, requestId: randomUUID(), actorSessionId: 'desktop', action: 'received', evidence: '本人已在微信看到第一段' });
    await delivery(async out => { expect(Number(out.id)).toBe(Number(b.id)); sends++; return weixinSendReceipt({ http: 200, data: { message_id: '9876543210987654321' } }); }).drain();
    expect(sends).toBe(2); expect((await repos.outbox.get(a.id))).toMatchObject({ status: 'sent', message_id: null, acceptance: { basis: 'owner_visible' } });
    expect(await repos.messageRoutes.lookupRemote('weixin', row.account_id, row.generation, '9876543210987654321')).toMatchObject({ workItemId: 'original-work', inboxEventId: 'input-with:colons' });
    expect(await repos.messageRoutes.lookupRemote('weixin', row.account_id, 'other-generation', '9876543210987654321')).toBeNull();
  });
  it('无原生号的已接纳回执在崩溃恢复后不会再次发出', async () => {
    const row = await fresh(), out = (await enqueue(row)).row;
    await repos.outbox.mark(out.id, { status: 'sending', acceptance: { basis: 'explicit_zero', ret: 0, at: new Date().toISOString() } });
    const worker = delivery(async () => { throw new Error('must never send'); });
    await worker.recover(); await worker.drain();
    expect((await repos.outbox.get(out.id))).toMatchObject({ status: 'sent', message_id: null });
    expect((await repos.weixin.impact(row.generation)).deliveries).toEqual([]);
  });
  it('绑定切换阻断仅看自身未结记录；退休会话永久保留', async () => {
    const row = await fresh(), pending = await repos.weixin.register(row.workspace_id, 'new-bot', 'owner');
    await enqueue(row);
    const affected = await repos.weixin.impact(row.generation);
    await expect(repos.weixin.activate(pending.generation, { generation: row.generation, version: row.version, fingerprint: affected.fingerprint })).rejects.toThrow(/未结/);
    const out = (await repos.outbox.recent()).find(x => x.binding_generation === row.generation);
    await repos.outbox.review({ id: out.id, revision: out.revision, generation: row.generation, requestId: randomUUID(), actorSessionId: 'desktop', action: 'abandon', evidence: '放弃未发送内容，保留结果' });
    const cleared = await repos.weixin.impact(row.generation);
    const next = await repos.weixin.activate(pending.generation, { generation: row.generation, version: row.version, fingerprint: cleared.fingerprint });
    expect(next.generation).not.toBe(row.generation); expect((await repos.weixin.get(row.generation))).toMatchObject({ state: 'retired', session_id: row.session_id });
  });
  it('凭据隔离、同绑定最新上下文及权限，账本和普通信封无 token', async () => {
    const row = await fresh(), identity = weixinIdentity(row), vault = new WeixinCredentialVault(root);
    await vault.save({ ...identity, token: 'private-token', base: 'https://ilinkai.weixin.qq.com' });
    await vault.context(identity, 'newest-context');
    expect((await new WeixinCredentialVault(root).get(identity)).context).toBe('newest-context');
    await expect(vault.get({ ...identity, ownerId: 'someone-else' })).rejects.toThrow();
    expect((await stat(join(root, '.24pa/weixin/secrets.json'))).mode & 0o777).toBe(0o600);
    await repos.weixin.receive(row, 'cursor', [{ ...envelope(row), context_token: 'private-token', bot_token: 'private-token' }]);
    const saved = await db.query('select * from pa24.inbox where binding_generation = $1', [row.generation]);
    expect(JSON.stringify(saved.rows)).not.toContain('private-token');
  });
});
