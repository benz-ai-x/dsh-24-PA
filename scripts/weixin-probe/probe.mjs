import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { admit, apiBase, DEFAULT_BASE, PROTOCOL, receipt, request, updatesResult, withBaseInfo } from './protocol.mjs';
import { MAX_LATENESS_MS, NOTIFICATION_EXPERIMENT, notificationAssessment, notificationPlan, notificationReceipt, notificationScope } from './notification-plan.mjs';

const digest = value => createHash('sha256').update(String(value)).digest('hex');
const now = () => new Date().toISOString();
const processRun = randomUUID();
export function atomicJson(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, file);
  const parent = openSync(join(file, '..'), 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
function load(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

/** An isolated experiment. It never loads the 24PA runtime, business DB or host configuration. */
export class Probe {
  constructor(directory, { transport = request, delayMs = 120_000, notificationSteps, clock = Date.now } = {}) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    this.directory = directory; this.transport = transport; this.delayMs = delayMs; this.clock = clock;
    this.ledgerFile = join(directory, 'ledger.json'); this.vaultFile = join(directory, 'credentials.json');
    this.receiptsDirectory = join(directory, 'receipts');
    mkdirSync(this.receiptsDirectory, { recursive: true, mode: 0o700 });
    const savedState = load(this.ledgerFile, null);
    const steps = notificationSteps === undefined ? null : notificationPlan(notificationSteps);
    if (steps && !savedState && load(this.vaultFile, null)) throw Error('new_notification_experiment_requires_fresh_login');
    if (savedState && (Boolean(savedState.notification) !== Boolean(steps) || steps &&
        (savedState.notification.experiment !== NOTIFICATION_EXPERIMENT || JSON.stringify(savedState.notification.steps) !== JSON.stringify(steps)))) {
      throw Error('experiment_scope_mismatch_use_new_directory');
    }
    this.steps = steps;
    this.state = savedState ?? {
      run: randomUUID(), protocol: PROTOCOL, createdAt: now(), cursor: '', events: [], seen: [],
      deliveries: [], received: {}, inboundCount: 0, restored: 0,
      ...(steps ? { notification: { experiment: NOTIFICATION_EXPERIMENT, steps } } : {}),
    };
    this.challenge = `24PA ${steps ? '通知条件测试' : '协议测试'} ${this.state.run.slice(0, 8)}`;
    this.credentials = load(this.vaultFile, null);
    this.phase = this.credentials ? 'stopped' : 'unbound';
    this.enabled = false; this.qr = null; this.controller = null; this.worker = null;
    // A dispatched request without a final durable receipt is unknown, never replayed.
    for (const item of this.state.deliveries) {
      if (!/^[a-zA-Z0-9-]+$/.test(item.clientId)) throw new Error('invalid_saved_client_id');
      const saved = load(join(this.receiptsDirectory, `${item.clientId}.json`), null);
      if (saved) Object.assign(item, saved);
      else if (item.status === 'sending') item.status = 'unknown';
    }
    // A crash can occur after a rejection receipt is durable but before the
    // loop records its terminal stop. Recover the stop from that same receipt.
    if (steps && this.state.deliveries.some(item => item.status === 'rejected' &&
        steps.some(step => step.kind === item.kind && step.context === 'original'))) {
      this.state.notificationStopReason = 'original_context_rejected';
    }
    this.restorePending = !steps && this.credentials && this.deliveryBasis('immediate') !== 'pending' &&
      !this.state.deliveries.some(x => x.kind === 'delayed');
    if (this.restorePending) {
      this.state.restored++;
      this.state.recoveredAfterImmediate = false;
      this.state.events.push({ at: now(), type: 'state_restored_after_immediate', cursorHash: digest(this.state.cursor) });
    }
    this.notificationPollObserved = false;
    if (steps) this.event('notification_component_loaded', { processRun, cursorHash: digest(this.state.cursor), priorAttempts: this.state.deliveries.length });
    this.save();
  }
  save() { atomicJson(this.ledgerFile, this.state); }
  event(type, details = {}) { this.state.events.push({ at: now(), type, ...details }); this.save(); }
  deliveryBasis(kind) {
    const item = this.state.deliveries.find(x => x.kind === kind);
    if (item?.status === 'accepted') return 'platform_response';
    if (item?.status === 'unknown' && this.state.received[kind]?.clientId === item.clientId) return 'owner_visible_reconciliation';
    return 'pending';
  }
  publicState() {
    return {
      run: this.state.run, phase: this.phase, enabled: this.enabled, challenge: this.challenge,
      delaySeconds: this.delayMs / 1000,
      candidate: this.credentials ? { bot: this.credentials.bot, owner: this.credentials.owner } : null,
      deliveries: this.state.deliveries.map(({ nativeId, ...item }) => ({ ...item, hasNativeId: Boolean(nativeId) })),
      received: this.state.received, recentEvents: this.state.events.slice(-8).map(({ messageId, ...event }) => event),
      gateA: this.gateA(), restored: this.state.restored,
      ...(this.steps ? { notification: { ...notificationAssessment(this.state, this.steps), steps: this.steps,
        scope: notificationScope(this.state.run, this.steps), inputAt: this.state.inputAt ?? null } } : {}),
    };
  }
  gateA() {
    if (this.steps) return { status: 'not_applicable', notificationB: 'unverified' };
    const deliveries = ['immediate', 'delayed'].map(kind => this.state.deliveries.find(x => x.kind === kind));
    const reasons = [];
    if (!this.state.events.some(x => x.type === 'login_confirmed')) reasons.push('login');
    if (!this.state.events.some(x => x.type === 'inbound' && x.reason === 'test_input')) reasons.push('inbound');
    if (!this.state.recoveredAfterImmediate) reasons.push('restore_and_cursor_observation');
    for (let i = 0; i < deliveries.length; i++) {
      const item = deliveries[i]; const kind = ['immediate', 'delayed'][i];
      if (this.deliveryBasis(kind) === 'pending') reasons.push(`${kind}_receipt`);
      if (!this.state.received[kind]) reasons.push(`${kind}_visible`);
    }
    if (deliveries[1] && (deliveries[1].newInbound !== 0 || deliveries[1].elapsedMs < this.delayMs)) reasons.push('delay_conditions');
    return { status: reasons.length ? 'unverified' : 'observed', pending: reasons,
      receiptBasis: Object.fromEntries(['immediate', 'delayed'].map(kind => [kind, this.deliveryBasis(kind)])), notificationB: 'unverified' };
  }
  exportEvidence() {
    // Deliberate allowlist: no raw account IDs, cursor, arbitrary message text, QR, codes, or tokens.
    return {
      schema: 1, run: this.state.run, protocol: PROTOCOL, createdAt: this.state.createdAt, exportedAt: now(),
      account: this.credentials ? { botHash: digest(this.credentials.bot), ownerHash: digest(this.credentials.owner), apiHost: new URL(this.credentials.base).host } : null,
      requestedDelayMs: this.delayMs, restored: this.state.restored, lastSuccessfulPollAt: this.state.lastSuccessfulPollAt ?? null,
      events: this.state.events.map(({ messageId, ...event }) => event),
      deliveries: this.state.deliveries.map(({ nativeId, ...item }) => ({ ...item, hasNativeId: Boolean(nativeId), ...(nativeId ? { nativeIdHash: digest(nativeId) } : {}) })),
      visibleReceipts: this.state.received, gateA: this.gateA(),
      ...(this.steps ? { notificationB: notificationAssessment(this.state, this.steps), experiment: this.state.notification,
        seedAt: this.state.inputAt ? new Date(this.state.inputAt).toISOString() : null } : {}),
      limits: ['No business integration', 'No proactive-send/window/quota guarantee', 'No proven server idempotency',
        'Replay tests are offline evidence', 'newInbound counts observed messages, not a proof of an empty server queue'],
    };
  }
  async startLogin() {
    if (this.credentials || this.worker || this.state.deliveries.length ||
        !['unbound', 'expired', 'login_error', 'verify_code_blocked'].includes(this.phase)) throw new Error('login_not_available');
    this.phase = 'requesting_qr'; this.qr = null;
    const response = await this.transport('ilink/bot/get_bot_qrcode?bot_type=3', { body: { local_token_list: [] } });
    if (this.phase !== 'requesting_qr') return;
    const d = response.data;
    if (response.http !== 200 || typeof d?.qrcode !== 'string' || !d.qrcode ||
        typeof d.qrcode_img_content !== 'string' || !d.qrcode_img_content || d.qrcode_img_content.length > 4096 ||
        d.ret !== undefined && d.ret !== 0) {
      this.phase = 'login_error'; this.event('qr_failed', { http: response.http }); return;
    }
    this.qr = { code: d.qrcode, content: d.qrcode_img_content, base: DEFAULT_BASE, expires: Date.now() + 300_000 };
    this.phase = 'wait'; this.event('qr_created', { http: response.http });
    this.controller = new AbortController();
    this.worker = this.pollLogin(this.controller.signal).finally(() => { this.worker = null; });
  }
  async pollLogin(signal) {
    try {
      while (!signal.aborted && this.qr && Date.now() < this.qr.expires) {
        if (this.phase === 'need_verifycode' && !this.verifyCode) { await delay(500, undefined, { signal }); continue; }
        let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(this.qr.code)}`;
        if (this.verifyCode) endpoint += `&verify_code=${encodeURIComponent(this.verifyCode)}`;
        this.verifyCode = undefined;
        const response = await this.transport(endpoint, { base: this.qr.base, timeout: 35_000, signal });
        if (signal.aborted) return;
        const d = response.data;
        if (response.http !== 200 || typeof d?.status !== 'string') {
          this.phase = 'login_error'; this.event('login_network_error', { http: response.http }); return;
        }
        const known = ['wait', 'scaned', 'confirmed', 'expired', 'need_verifycode', 'verify_code_blocked', 'scaned_but_redirect', 'binded_redirect'];
        if (!known.includes(d.status)) { this.phase = 'login_error'; this.event('unknown_login_status'); return; }
        if (d.status !== this.phase) this.event('login_status', { status: d.status });
        this.phase = d.status;
        if (d.status === 'confirmed') {
          if (![d.bot_token, d.ilink_bot_id, d.ilink_user_id, d.baseurl].every(x => typeof x === 'string' && x)) {
            this.phase = 'missing_identity'; this.event('login_missing_identity'); return;
          }
          this.credentials = { token: d.bot_token, bot: d.ilink_bot_id, owner: d.ilink_user_id, base: apiBase(d.baseurl) };
          atomicJson(this.vaultFile, this.credentials);
          this.qr = null; this.phase = 'candidate'; this.event('login_confirmed', { http: response.http }); return;
        }
        if (['expired', 'verify_code_blocked', 'binded_redirect'].includes(d.status)) { this.qr = null; return; }
        if (d.status === 'scaned_but_redirect') this.qr.base = apiBase(`https://${d.redirect_host}`);
        await delay(1000, undefined, { signal });
      }
      if (!signal.aborted) { this.phase = 'expired'; this.qr = null; }
    } catch {
      if (!signal.aborted) { this.phase = 'login_error'; this.event('login_protocol_error'); }
    }
  }
  submitCode(code) {
    if (this.phase !== 'need_verifycode' || !/^\d{4,12}$/.test(code)) throw new Error('invalid_verify_code');
    this.verifyCode = code;
  }
  async activate(scope) {
    if (this.steps && (scope !== notificationScope(this.state.run, this.steps) || this.state.notificationStopReason)) throw Error('notification_scope_or_state_not_ready');
    if (!this.credentials || this.worker || this.enabled) throw new Error('not_ready');
    this.enabled = true; this.phase = 'listening'; this.controller = new AbortController();
    this.event('owner_activated_test', this.steps ? { scope } : {});
    this.worker = this.poll(this.controller.signal).finally(() => { this.worker = null; });
  }
  async stop() {
    this.enabled = false; this.controller?.abort(); this.qr = null; this.verifyCode = undefined;
    await this.worker;
    this.phase = this.credentials ? 'stopped' : 'unbound'; this.event('stopped');
  }
  consume(data) {
    if (!Array.isArray(data.msgs ?? []) || typeof data.get_updates_buf !== 'string') throw new Error('invalid_batch');
    const before = this.state.cursor;
    for (const message of data.msgs ?? []) {
      const decision = admit(message, this.credentials, this.challenge);
      const id = decision.id;
      const identityKey = digest(`${this.credentials.bot}\0${this.credentials.owner}\0${id}`);
      if (id && this.state.seen.includes(identityKey)) {
        this.state.events.push({ at: now(), type: 'duplicate', messageHash: digest(id) }); continue;
      }
      if (id) this.state.seen.push(identityKey);
      this.state.inboundCount++;
      this.state.events.push({ at: now(), type: 'inbound', reason: decision.reason,
        messageId: id, messageHash: id ? digest(id) : null, idDigits: id?.length ?? 0,
        fromMatches: message?.from_user_id === this.credentials.owner, toMatches: message?.to_user_id === this.credentials.bot,
        hasSessionId: Boolean(message?.session_id), typeIsUser: message?.message_type === 1,
        stateIsFinished: message?.message_state === 2,
      });
      if (decision.reason === 'test_input' && !this.state.inputAt) {
        this.credentials.context = decision.context;
        atomicJson(this.vaultFile, this.credentials);
        this.state.inputAt = this.clock(); this.state.inputCount = this.state.inboundCount;
      }
    }
    this.state.cursor = data.get_updates_buf;
    if ((data.msgs?.length ?? 0) || before !== this.state.cursor) {
      this.state.events.push({ at: now(), type: 'batch_committed', count: data.msgs?.length ?? 0,
        cursorChanged: before !== this.state.cursor, cursorHash: digest(this.state.cursor) });
    }
    // One durable rename contains all clean decisions plus the matching cursor.
    this.save();
  }
  async send(kind, signal) {
    if (!this.enabled || signal.aborted || this.state.deliveries.some(x => x.kind === kind)) return;
    const step = this.steps?.find(row => row.kind === kind);
    if (this.steps && (!step || !this.state.inputAt || !this.credentials.context ||
        this.clock() < this.state.inputAt + step.afterMs || this.clock() > this.state.inputAt + step.afterMs + MAX_LATENESS_MS ||
        this.state.inboundCount !== this.state.inputCount)) throw Error('outside_notification_scope');
    const item = { kind, clientId: `24pa-probe-${randomUUID()}`, status: 'sending', startedAt: now(),
      elapsedMs: this.clock() - this.state.inputAt, newInbound: this.state.inboundCount - this.state.inputCount,
      lastSuccessfulPollAt: this.state.lastSuccessfulPollAt ?? null,
      ...(step ? { contextMode: step.context, scheduledAt: new Date(this.state.inputAt + step.afterMs).toISOString(),
        processRun, originalContextHash: digest(this.credentials.context),
        sincePreviousSendMs: this.state.deliveries.length ? this.clock() - this.state.inputAt - this.state.deliveries.at(-1).elapsedMs : null } : {}) };
    this.state.deliveries.push(item); this.save();
    let response;
    try { response = await this.transport('ilink/bot/sendmessage', {
      base: this.credentials.base, token: this.credentials.token, signal,
      body: withBaseInfo({ msg: { from_user_id: '', to_user_id: this.credentials.owner,
        client_id: item.clientId, message_type: 2, message_state: 2,
        ...(step?.context === 'omitted' ? {} : { context_token: step?.context === 'invalid' ? '24pa-invalid-test-context' : this.credentials.context }),
        item_list: [{ type: 1, text_item: { text: step
          ? `24私助通知条件测试 ${this.state.run.slice(0, 8)} / ${kind}：口令后约 ${Math.round(item.elapsedMs / 1000)} 秒；${({ original: '原回复上下文', omitted: '不附回复上下文', invalid: '无效测试上下文' })[step.context]}。仅为本人测试，未办理业务。`
          : `24私助协议测试 ${this.state.run.slice(0, 8)}：${kind === 'immediate' ? '即时回复' : `延迟回复（约 ${Math.round(item.elapsedMs / 1000)} 秒）`}。这是一条测试回执，未办理业务。` } }],
      } }),
    }); } catch { response = { http: null, error: 'transport_unknown' }; }
    const observed = { ...(step ? notificationReceipt(response) : receipt(response)), finishedAt: now() };
    // Preserve the observation separately before updating the main ledger. Recovery only settles it.
    atomicJson(join(this.receiptsDirectory, `${item.clientId}.json`), observed);
    Object.assign(item, observed); this.save();
    // The response always settles the original attempt, even if stopped while in flight.
  }
  async poll(signal) {
    if (this.steps) return this.pollNotifications(signal);
    try {
      let failures = 0;
      while (this.enabled && !signal.aborted) {
        const unresolved = this.state.deliveries.some(x => x.kind === 'immediate') && this.deliveryBasis('immediate') === 'pending';
        if (unresolved) { this.enabled = false; this.phase = 'review_required'; return; }
        if (this.state.deliveries.some(x => x.kind === 'delayed')) {
          this.enabled = false; this.phase = 'await_visible_receipts'; return;
        }
        const requestedCursor = digest(this.state.cursor);
        const response = await this.transport('ilink/bot/getupdates', {
          base: this.credentials.base, token: this.credentials.token, timeout: 35_000, signal,
          body: withBaseInfo({ get_updates_buf: this.state.cursor }),
        });
        if (!this.enabled || signal.aborted) return;
        const status = updatesResult(response);
        if (status.status !== 'read_success') {
          this.event('poll_error', status);
          if (status.ret === -14 || status.errcode === -14 || ++failures >= 3) {
            this.enabled = false; this.phase = 'poll_error'; return;
          }
          await delay(failures * 1000, undefined, { signal }); continue;
        }
        failures = 0; this.consume(response.data);
        this.state.lastSuccessfulPollAt = now();
        if (!this.state.events.some(x => x.type === 'read_contract_observed' && x.basis === status.basis)) {
          this.state.events.push({ at: now(), type: 'read_contract_observed', ...status });
        }
        this.save();
        if (this.restorePending) {
          this.state.recoveredAfterImmediate = true; this.restorePending = false;
          this.event('recovery_poll_observed', { requestedCursorHash: requestedCursor, count: response.data.msgs?.length ?? 0 });
        }
        if (this.state.inputAt) {
          const immediate = this.state.deliveries.find(x => x.kind === 'immediate');
          if (!immediate) await this.send('immediate', signal);
          const first = this.state.deliveries.find(x => x.kind === 'immediate');
          if (this.deliveryBasis('immediate') === 'pending') { this.enabled = false; this.phase = 'review_required'; return; }
          if (!this.state.recoveredAfterImmediate) { this.enabled = false; this.phase = 'await_restore'; return; }
          if (Date.now() - this.state.inputAt >= this.delayMs) await this.send('delayed', signal);
          if (this.state.deliveries.some(x => x.kind === 'delayed')) {
            this.enabled = false; this.phase = 'await_visible_receipts'; return;
          }
        }
        await delay(100, undefined, { signal });
      }
    } catch {
      if (!signal.aborted) { this.enabled = false; this.phase = 'probe_error'; this.event('probe_error'); }
    }
  }
  confirmVisible(kind) {
    const item = this.state.deliveries.find(x => x.kind === kind);
    if (!item || item.status === 'sending') throw new Error('no_attempt');
    this.state.received[kind] = { at: now(), basis: 'owner_confirmed_in_local_probe', clientId: item.clientId };
    this.save();
  }
  async pollNotifications(signal) {
    const stop = (reason, terminal = false) => {
      this.enabled = false; this.phase = reason;
      if (terminal) this.state.notificationStopReason = reason;
      this.event('notification_paused', { reason });
    };
    try {
      while (this.enabled && !signal.aborted) {
        if (this.state.deliveries.some(row => ['sending', 'unknown'].includes(row.status) && this.deliveryBasis(row.kind) === 'pending')) return stop('review_required');
        if (this.state.deliveries.some(item => item.status === 'rejected' &&
            this.steps.some(step => step.kind === item.kind && step.context === 'original'))) return stop('original_context_rejected', true);
        if (this.state.deliveries.some(row => row.ret === -14 || row.errcode === -14)) return stop('poll_error', true);
        const pending = this.steps.filter(row => !this.state.deliveries.some(item => item.kind === row.kind));
        const step = pending[0];
        if (!step) return stop('await_visible_receipts');
        const requestedCursorHash = digest(this.state.cursor);
        const response = await this.transport('ilink/bot/getupdates', {
          base: this.credentials.base, token: this.credentials.token, timeout: 35_000, signal,
          body: withBaseInfo({ get_updates_buf: this.state.cursor }),
        });
        if (!this.enabled || signal.aborted) return;
        const observed = updatesResult(response);
        if (observed.status !== 'read_success') { this.event('poll_error', observed); return stop('poll_error'); }
        this.consume(response.data);
        this.state.lastSuccessfulPollAt = now(); this.save();
        if (!this.notificationPollObserved) {
          this.notificationPollObserved = true;
          this.event('notification_cursor_observed', { processRun, requestedCursorHash, count: response.data.msgs.length });
        }
        if (this.state.inputAt) {
          if (this.state.inboundCount !== this.state.inputCount) return stop('new_inbound', true);
          const age = this.clock() - this.state.inputAt;
          if (age > step.afterMs + MAX_LATENESS_MS) return stop('missed_window', true);
          if (pending[1] && age >= pending[1].afterMs) return stop('missed_window', true);
          const previous = this.state.deliveries.at(-1);
          const previousStep = previous && this.steps.find(item => item.kind === previous.kind);
          const earliest = step.afterMs + (previousStep ? Math.max(0, previous.elapsedMs - previousStep.afterMs) : 0);
          if (age >= earliest) {
            await this.send(step.kind, signal);
            const sent = this.state.deliveries.find(item => item.kind === step.kind);
            if (step.context === 'original' && sent?.status === 'rejected') return stop('original_context_rejected', true);
          }
        }
        await delay(100, undefined, { signal });
      }
    } catch {
      if (!signal.aborted) stop('probe_error');
    }
  }
}
