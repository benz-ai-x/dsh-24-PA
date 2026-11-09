import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import type { DshContext } from './host.js';
import type { OutboxRepo, OutboxRow, DeliveryAssociation } from './repo/outbox.js';
import { weixinIdentity, type WeixinBindingRow, type WeixinRepo } from './repo/weixin.js';
import { WeixinCredentialVault } from './weixin-credentials.js';
import { createWeixinRequest, splitWeixinText, sameWeixinIdentity, weixinApiBase, weixinEnvelope, weixinSendReceipt, weixinUpdates,
  WEIXIN_API_BASE, WeixinProtocolError, type WeixinIdentity, type WeixinRequest, type WeixinRequestFn } from './weixin-protocol.js';
import { WeixinSessions } from './weixin-session.js';
import { DeliveryHeld, checkDeliveryHold, type DeliveryHold } from './outbox-delivery.js';
import QRCode from 'qrcode';
import type { TaskPlanDestination } from './task-plan.js';
import { taskPlanFingerprint } from './task-plan-access.js';

interface AccessContext { workspaceId: string; hostWorkspaceId: string; workspacePath: string; binding: string; repo: WeixinRepo; outbox: OutboxRepo }
interface Candidate { id: string; accountId: string; ownerId: string; base: string; token: string; workspaceBinding: string }
interface ChangePreview { id: string; expires: number; workspaceBinding: string; action: 'activate' | 'enable' | 'disable' | 'retire';
  generation: string | null; version: number | null; fingerprint: string | null; candidateId?: string }
type LoginPhase = 'idle' | 'requesting' | 'wait' | 'scaned' | 'need_verifycode' | 'candidate' | 'expired' | 'error';

/** Transport, credentials and binding lifecycle behind the desktop/Runtime seam.
 * Business execution remains in the existing Inbox, Lead/Worker and Outbox. */
export class WeixinAccess {
  private readonly identities = new Map<string, WeixinBindingRow>();
  private readonly request: WeixinRequestFn;
  readonly sessions: WeixinSessions;
  private consumer: { abort: AbortController; done: Promise<void>; context: AccessContext; generation: string } | null = null;
  private loginAbort: AbortController | null = null;
  private loginPhase: LoginPhase = 'idle';
  private qr: { code: string; content: string; base: string; expires: number } | null = null;
  private candidate: Candidate | null = null;
  private verifyCode: string | undefined;
  private readonly previews = new Map<string, ChangePreview>();
  private phase: 'unbound' | 'stopped' | 'connecting' | 'polling' | 'needs_login' | 'error' = 'unbound';
  private error: string | null = null;
  private quiescing = true;
  private sendEpoch = 0;
  constructor(private readonly deps: { host: DshContext; context(): AccessContext | null; available(): boolean;
    execute<T>(work: () => Promise<T>): Promise<T>; received(): void; request?: WeixinRequestFn }) {
    this.request = deps.request ?? createWeixinRequest();
    this.sessions = new WeixinSessions(deps.host, row => this.identities.get(row.session_id)?.generation === row.generation && this.identities.get(row.session_id)?.state !== 'retired');
  }
  register(rows: WeixinBindingRow[]): void { for (const row of rows) this.identities.set(row.session_id, row); }
  remote(sessionId: string): WeixinBindingRow | null { return this.identities.get(sessionId) ?? null; }
  private context(): AccessContext { const ctx = this.deps.context(); if (!ctx) throw new Error('请先选择已就绪的24私助工作区。'); return ctx; }
  private current(ctx: AccessContext): boolean { return this.deps.available() && this.deps.context()?.binding === ctx.binding; }
  async assertActive(sessionId: string): Promise<WeixinBindingRow> {
    const ctx = this.context(), known = this.remote(sessionId);
    if (!known || known.workspace_id !== ctx.workspaceId) throw new Error('微信会话不属于当前工作区。');
    const row = await ctx.repo.get(known.generation); this.register([row]);
    if (!this.current(ctx) || row.state !== 'active' || !row.enabled) throw new Error('微信绑定已停止或退休；不能从旧入口办理业务。');
    return row;
  }
  /** Captures only the fixed identity, never credentials or a reply token.
   * Platform notification conditions still require separate real-account acceptance. */
  async notificationTarget(): Promise<TaskPlanDestination> {
    const ctx = this.context(), row = await ctx.repo.active(ctx.workspaceId);
    if (!row || !row.enabled || !row.session_ready || this.quiescing || !this.current(ctx) || this.phase !== 'polling') throw new Error('微信未连接到可用的本人绑定，请先在电脑端核对接入。');
    const identity = weixinIdentity(row), credentials = await new WeixinCredentialVault(ctx.workspacePath).get(identity);
    if (!credentials?.context) throw new Error('微信缺少本人会话的回复上下文，请先发来文字再预览通知目标。');
    return { channel: 'weixin', target: row.owner_id, ...identity, identityKey: taskPlanFingerprint(identity),
      connectionHash: taskPlanFingerprint([ctx.workspaceId, identity.generation]) };
  }
  async snapshot() {
    const ctx = this.context(), active = await ctx.repo.active(ctx.workspaceId);
    return { binding: active ? { ...active, cursor: undefined } : null, phase: this.phase, error: this.error,
      loginPhase: this.loginPhase, candidate: this.candidate?.workspaceBinding === ctx.binding ? { id: this.candidate.id, accountId: this.candidate.accountId, ownerId: this.candidate.ownerId } : null,
      verified: Boolean(active?.last_received_at && active?.last_sent_at), notificationSupported: false,
      impact: active ? await ctx.repo.impact(active.generation) : null };
  }
  async loginState() {
    const qr = this.qr;
    return { ...await this.snapshot(), qrImage: qr ? await QRCode.toDataURL(qr.content, { width: 256, margin: 2 }) : null,
      expiresAt: qr ? new Date(qr.expires).toISOString() : null };
  }
  cancelLogin(): void {
    this.loginAbort?.abort(); this.loginAbort = null; this.qr = null; this.candidate = null; this.verifyCode = undefined; this.loginPhase = 'idle';
  }
  async startLogin(): Promise<void> {
    const ctx = this.context(); this.cancelLogin();
    const abort = new AbortController(); this.loginAbort = abort; this.loginPhase = 'requesting';
    const result = await this.request('ilink/bot/get_bot_qrcode?bot_type=3', { body: { local_token_list: [] }, signal: abort.signal });
    if (abort.signal.aborted || !this.current(ctx)) return;
    const data = result.data;
    if (result.http !== 200 || !data || data.ret !== undefined && data.ret !== 0 || typeof data.qrcode !== 'string' || !data.qrcode ||
        typeof data.qrcode_img_content !== 'string' || !data.qrcode_img_content || data.qrcode_img_content.length > 4096) {
      this.loginPhase = 'error'; this.error = '微信二维码获取失败，请重试。'; return;
    }
    this.qr = { code: data.qrcode, content: data.qrcode_img_content, base: WEIXIN_API_BASE, expires: Date.now() + 300_000 };
    this.loginPhase = 'wait'; void this.pollLogin(ctx, abort.signal);
  }
  submitCode(code: string): void {
    if (this.loginPhase !== 'need_verifycode' || !/^\d{4,8}$/.test(code)) throw new Error('请输入当前二维码要求的验证码。');
    this.verifyCode = code;
  }
  private async pollLogin(ctx: AccessContext, signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted && this.current(ctx) && this.qr && Date.now() < this.qr.expires) {
        if (this.loginPhase === 'need_verifycode' && !this.verifyCode) { await wait(500, undefined, { signal }); continue; }
        const code = this.verifyCode; this.verifyCode = undefined;
        const endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(this.qr.code)}${code ? `&verify_code=${encodeURIComponent(code)}` : ''}`;
        const result = await this.request(endpoint, { base: this.qr.base, signal, timeout: 35_000 });
        if (signal.aborted || !this.current(ctx)) return;
        const data = result.data;
        if (result.http !== 200 || !data) throw new Error();
        if (data.status === 'confirmed') {
          if (![data.bot_token, data.ilink_bot_id, data.ilink_user_id, data.baseurl].every(value => typeof value === 'string' && value)) throw new Error();
          this.candidate = { id: randomUUID(), accountId: String(data.ilink_bot_id), ownerId: String(data.ilink_user_id),
            token: String(data.bot_token), base: weixinApiBase(String(data.baseurl)), workspaceBinding: ctx.binding };
          this.qr = null; this.loginPhase = 'candidate'; return;
        }
        if (data.status === 'expired') { this.qr = null; this.loginPhase = 'expired'; return; }
        if (data.status === 'scaned_but_redirect' && typeof data.redirect_host === 'string') this.qr!.base = weixinApiBase(`https://${data.redirect_host}`);
        else if (['wait', 'scaned', 'need_verifycode'].includes(String(data.status))) this.loginPhase = data.status as LoginPhase;
        else throw new Error();
        await wait(1000, undefined, { signal });
      }
      if (!signal.aborted && this.current(ctx)) { this.qr = null; this.loginPhase = 'expired'; }
    } catch { if (!signal.aborted && this.current(ctx)) { this.qr = null; this.loginPhase = 'error'; this.error = '微信授权未完成，请刷新二维码或重新登录；原平台授权可能已变化。'; } }
  }
  async preview(action: ChangePreview['action']) {
    const ctx = this.context(), active = await ctx.repo.active(ctx.workspaceId), impact = active ? await ctx.repo.impact(active.generation) : null;
    if (action === 'activate' && (!this.candidate || this.candidate.workspaceBinding !== ctx.binding)) throw new Error('请先扫码并确认候选微信身份。');
    if (action !== 'activate' && !active) throw new Error('尚未绑定微信。');
    const preview: ChangePreview = { id: randomUUID(), expires: Date.now() + 15 * 60_000, workspaceBinding: ctx.binding, action,
      generation: active?.generation ?? null, version: active?.version ?? null, fingerprint: impact?.fingerprint ?? null,
      ...(action === 'activate' ? { candidateId: this.candidate!.id } : {}) };
    for (const [id, old] of this.previews) if (old.expires < Date.now()) this.previews.delete(id);
    if (this.previews.size >= 128) throw new Error('待确认的微信设置过多，请刷新。');
    this.previews.set(preview.id, preview);
    return { previewId: preview.id, action, expiresAt: new Date(preview.expires).toISOString(), impact,
      current: active ? { accountId: active.account_id, ownerId: active.owner_id } : null,
      candidate: action === 'activate' ? { accountId: this.candidate!.accountId, ownerId: this.candidate!.ownerId } : null,
      sameIdentity: active && this.candidate ? active.account_id === this.candidate.accountId && active.owner_id === this.candidate.ownerId : false };
  }
  async apply(previewId: string): Promise<void> {
    const ctx = this.context(), preview = this.previews.get(previewId);
    if (!preview || preview.workspaceBinding !== ctx.binding || preview.expires < Date.now()) throw new Error('微信设置预览已过期或工作区已改变，请重新预览。');
    this.pause(); // synchronous cancellation; never await a consumer holding a workspace lease
    await this.deps.execute(async () => {
      if (!this.current(ctx)) throw new Error('工作区已改变。');
      if (preview.action !== 'activate') {
        const row = await ctx.repo.change(preview.generation!, preview.version!, preview.action, preview.fingerprint!); this.register([row]);
        if (preview.action === 'retire') await new WeixinCredentialVault(ctx.workspacePath).forget(weixinIdentity(row));
      } else {
        const candidate = this.candidate;
        if (!candidate || candidate.id !== preview.candidateId || candidate.workspaceBinding !== ctx.binding) throw new Error('微信候选身份已改变，请重新预览。');
        const current = await ctx.repo.active(ctx.workspaceId);
        if ((current?.generation ?? null) !== preview.generation || (current?.version ?? null) !== preview.version || current && (await ctx.repo.impact(current.generation)).fingerprint !== preview.fingerprint) throw new Error('微信绑定或关联记录已改变，请重新预览。');
        const same = current?.account_id === candidate.accountId && current.owner_id === candidate.ownerId;
        if (current && !same) { const impact = await ctx.repo.impact(current.generation); if (impact.inbox.length || impact.work.length || impact.deliveries.length) throw new Error('原微信绑定有未结记录，请先处理后再切换。'); }
        const row = same ? current! : await ctx.repo.register(ctx.workspaceId, candidate.accountId, candidate.ownerId);
        this.register([row]);
        try {
          await this.sessions.ensure(row, { id: ctx.hostWorkspaceId, path: ctx.workspacePath }, !same);
          await ctx.repo.sessionReady(row.generation);
          await new WeixinCredentialVault(ctx.workspacePath).save({ ...weixinIdentity(row), base: candidate.base, token: candidate.token });
          await ctx.repo.activate(row.generation, current ? { generation: current.generation, version: preview.version!, fingerprint: preview.fingerprint! } : null);
          if (current && !same) await new WeixinCredentialVault(ctx.workspacePath).forget(weixinIdentity(current));
          this.register(await ctx.repo.list()); this.cancelLogin();
        } catch (error) { if (!same) { await ctx.repo.retirePending(row.generation); this.register(await ctx.repo.list()); } throw error; }
      }
      this.previews.delete(previewId);
    }).catch(error => { this.phase = 'error'; this.error = '微信设置未完全生效，请核对当前保存状态。'; throw error; });
    await this.start();
  }
  pause(): void { this.quiescing = true; this.sendEpoch++; this.consumer?.abort.abort(); this.phase = 'stopped'; }
  async stop(): Promise<void> { this.cancelLogin(); this.pause(); await this.consumer?.done; this.consumer = null; }
  async close(): Promise<void> { await this.stop(); await this.sessions.close(); }
  async start(): Promise<void> {
    const old = this.consumer; old?.abort.abort(); await old?.done;
    const ctx = this.context(), row = await ctx.repo.active(ctx.workspaceId);
    this.register(await ctx.repo.list()); this.consumer = null;
    if (!row) { this.phase = 'unbound'; return; }
    if (!row.enabled) { this.phase = 'stopped'; return; }
    try {
      await this.sessions.ensure(row, { id: ctx.hostWorkspaceId, path: ctx.workspacePath }, false);
      if (!await new WeixinCredentialVault(ctx.workspacePath).get(weixinIdentity(row))) { this.phase = 'needs_login'; return; }
    } catch { this.phase = 'error'; this.error = '微信会话或凭据未恢复，已保存但未生效；请在电脑端核对。'; return; }
    if (!this.current(ctx)) return;
    const abort = new AbortController(); this.quiescing = false; this.phase = 'connecting'; this.error = null;
    const consumer = { abort, context: ctx, generation: row.generation, done: Promise.resolve() };
    this.consumer = consumer; consumer.done = this.poll(ctx, row.generation, abort.signal);
  }
  private async poll(ctx: AccessContext, generation: string, signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted && this.current(ctx)) {
      try {
        const binding = await ctx.repo.get(generation);
        if (!binding.enabled || binding.state !== 'active') return;
        const vault = new WeixinCredentialVault(ctx.workspacePath), credentials = await vault.get(weixinIdentity(binding));
        if (!credentials) { this.phase = 'needs_login'; return; }
        const raw = await this.request('ilink/bot/getupdates', { base: credentials.base, token: credentials.token,
          body: { get_updates_buf: binding.cursor }, timeout: 40_000, signal });
        if (signal.aborted || !this.current(ctx)) return;
        const batch = weixinUpdates(raw), envelopes = batch.messages.map(message => weixinEnvelope(message, weixinIdentity(binding)));
        await this.deps.execute(async () => {
          if (signal.aborted || !this.current(ctx)) return;
          const current = await ctx.repo.get(generation);
          if (!current.enabled || current.version !== binding.version || current.state !== 'active') return;
          // Commit private context first; a crash may replay the batch but never loses a needed token.
          const latest = envelopes.filter(x => x.context).at(-1)?.context;
          if (latest) await vault.context(weixinIdentity(binding), latest);
          await ctx.repo.receive(binding, batch.cursor, envelopes.map(x => x.envelope));
          this.phase = 'polling'; this.error = null; failures = 0; this.deps.received();
        });
      } catch (error) {
        if (signal.aborted || !this.current(ctx)) return;
        if (error instanceof WeixinProtocolError && error.needsLogin) { this.phase = 'needs_login'; this.error = error.message; return; }
        this.phase = 'error'; this.error = '微信收信暂未恢复，正在有界退避重连；原消息和游标保留。'; failures++;
      }
      try { await wait(failures ? Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)) : 300, undefined, { signal }); } catch { return; }
    }
  }
  async enqueue(key: string, target: WeixinIdentity, association: DeliveryAssociation, text: string): Promise<void> {
    const ctx = this.context(), binding = await ctx.repo.get(target.generation);
    if (binding.workspace_id !== ctx.workspaceId || !sameWeixinIdentity(weixinIdentity(binding), target)) throw new Error('微信结果目标不属于原绑定。');
    const segments = splitWeixinText(text || '本次处理没有可披露的文字结果，请在电脑端核对。');
    await ctx.outbox.enqueueGroup(segments.map((part, index) => ({ dedupKey: `${key}:segment:${index}`, channel: 'weixin', target: target.ownerId,
      kind: 'text', content: { text: part }, deliveryTarget: target, association, segmentGroup: key, segmentIndex: index })));
  }
  async beforeSend(row: OutboxRow): Promise<DeliveryHold | null> {
    if (row.channel !== 'weixin') return null;
    const ctx = this.context(), target = row.delivery_target;
    if (!target || row.binding_generation !== target.generation) return { status: 'failed', error: '微信投递缺少原身份。' };
    const binding = await ctx.repo.get(target.generation);
    if (this.quiescing || !this.current(ctx) || binding.workspace_id !== ctx.workspaceId || binding.state !== 'active' || !binding.enabled ||
        binding.account_id !== target.accountId || binding.owner_id !== target.ownerId || binding.session_id !== target.sessionId) {
      return { status: 'pending', error: '原微信绑定已停止或改变，保留原投递目标。', retryInMs: 60_000 };
    }
    return null;
  }
  async send(row: OutboxRow, beforeDispatch?: () => Promise<DeliveryHold | null>) {
    let request: WeixinRequest | undefined;
    const epoch = this.sendEpoch;
    // All reads and checks precede the network dispatch. A preparation error
    // therefore cannot be mistaken for an unknown platform send.
    const hold = await checkDeliveryHold(async () => {
      const ctx = this.context(), initial = await this.beforeSend(row); if (initial) return initial;
      const credentials = await new WeixinCredentialVault(ctx.workspacePath).get(row.delivery_target!);
      if (!credentials?.context) return { status: 'failed', error: '原微信会话缺少可用回复上下文；结果已保存，请先在微信发来文字再核对补投。' };
      const again = await this.beforeSend(row); if (again) return again;
      const final = await beforeDispatch?.(); if (final) return final;
      if (!row.client_id) return { status: 'failed', error: '微信投递缺少持久客户端请求编号。' };
      request = { base: credentials.base, token: credentials.token,
        body: { msg: { from_user_id: '', to_user_id: row.target, client_id: row.client_id, message_type: 2, message_state: 2,
          context_token: credentials.context, item_list: [{ type: 1, text_item: { text: String(row.content?.text ?? '') } }] } } };
      return null;
    });
    if (hold) throw new DeliveryHeld(hold);
    // This must remain after the final await, adjacent to the dispatch.
    if (this.quiescing || epoch !== this.sendEpoch) throw new DeliveryHeld({ status: 'pending', error: '微信入口正在停止，保留原投递。', retryInMs: 60_000 });
    try { return weixinSendReceipt(await this.request('ilink/bot/sendmessage', request)); }
    catch (error) {
      if (error instanceof WeixinProtocolError && error.needsLogin && epoch === this.sendEpoch && this.consumer?.generation === row.binding_generation) {
        this.pause(); this.phase = 'needs_login'; this.error = error.message;
      }
      throw error;
    }
  }
}
