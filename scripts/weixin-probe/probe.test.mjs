import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Probe, atomicJson } from './probe.mjs';
import { admit, apiBase, headers, parseWire, receipt, request, withBaseInfo } from './protocol.mjs';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function create(options) {
  const dir = mkdtempSync(join(tmpdir(), '24pa-weixin-unit-')); dirs.push(dir);
  return new Probe(dir, options);
}
function bind(probe) {
  probe.credentials = { bot: 'fixture-bot', owner: 'fixture-owner', token: ['fixture', 'credential'].join('-'), base: 'https://ilinkai.weixin.qq.com' };
  atomicJson(probe.vaultFile, probe.credentials);
}
function message(probe, overrides = {}) {
  return { message_id: '18446744073709551615', from_user_id: probe.credentials.owner,
    to_user_id: probe.credentials.bot, message_type: 1, message_state: 2,
    context_token: ['fixture', 'context'].join('-'), item_list: [{ type: 1, text_item: { text: probe.challenge } }], ...overrides };
}
function batch(probe, overrides = {}) { return { ret: 0, msgs: [message(probe)], get_updates_buf: 'fixture-cursor', ...overrides }; }

test('uint64 identities stay exact, including escaped property names and nested quoted IDs', () => {
  const x = parseWire('{"message_id":18446744073709551615,"nested":{"svr_id":9007199254740993},"msg_id":17,"text":"\\\"message_id\\\":123"}');
  assert.equal(x.message_id, '18446744073709551615'); assert.equal(x.nested.svr_id, '9007199254740993');
  assert.equal(x.msg_id, '17'); assert.equal(x.text, '"message_id":123');
  assert.equal(parseWire('{"message_\\u0069d":9007199254740993}').message_id, '9007199254740993');
  assert.throws(() => parseWire('{"message_id":1.5}')); assert.throws(() => parseWire('{"message_id":1e20}'));
});

test('receipt requires explicit ret zero, separates optional native ID, and fails closed on HTTP/shape errors', () => {
  assert.equal(receipt({ http: 200, data: { ret: 0 } }).status, 'accepted');
  assert.equal(receipt({ http: 200, data: {} }).shape.keyCount, 0);
  assert.equal(receipt({ http: 200, data: [] }).shape.kind, 'array');
  assert.equal(receipt({ http: 200, error: 'invalid_response' }).error, 'invalid_response');
  assert.equal(receipt({ http: 200, data: { ret: 0, message_id: '18446744073709551615' } }).nativeId, '18446744073709551615');
  for (const data of [{}, { client_id: 'local' }, [], null, { ret: '0' }, { ret: 0, errcode: '0' }]) assert.equal(receipt({ http: 200, data }).status, 'unknown');
  assert.equal(receipt({ http: 200, data: { ret: -14 } }).status, 'rejected');
  assert.equal(receipt({ http: 200, data: { ret: 0, errcode: -14 } }).status, 'rejected');
  for (const http of [null, 403, 500, 302]) assert.equal(receipt({ http, data: { ret: 0 } }).status, 'unknown');
});

test('protocol headers identify the probe without falsely identifying it as OpenClaw', () => {
  const h = headers('fixture'); assert.equal(h.Authorization, 'Bearer fixture');
  assert.equal(h['iLink-App-ClientVersion'], '132106');
  assert.match(Buffer.from(h['X-WECHAT-UIN'], 'base64').toString(), /^\d+$/);
  assert.equal(headers(undefined, 'GET').AuthorizationType, undefined);
  assert.equal(withBaseInfo({}).base_info.bot_agent, '24PA-Probe/0.1.0');
});

test('returned API hosts and HTTP redirects cannot send credentials to arbitrary origins', async () => {
  for (const url of ['http://ilinkai.weixin.qq.com', 'https://evil.test', 'https://ilinkai.weixin.qq.com.evil.test', 'https://u:p@ilinkai.weixin.qq.com', 'https://ilinkai.weixin.qq.com/path']) assert.throws(() => apiBase(url));
  let seen;
  await request('ilink/bot/sendmessage', { body: {}, fetcher: async (url, options) => { seen = options; return new Response('{"ret":0}'); } });
  assert.equal(seen.redirect, 'error');
  await assert.rejects(() => request('https://evil.test/ilink/bot/sendmessage'));
});

test('transport failures, malformed body and timeout while reading the body are not acknowledgements', async () => {
  const err = await request('ilink/bot/sendmessage', { body: {}, fetcher: async () => { throw Error('contains confidential response'); } });
  assert.equal(receipt(err).status, 'unknown'); assert.ok(!JSON.stringify(err).includes('confidential'));
  const malformed = await request('ilink/bot/sendmessage', { body: {}, fetcher: async () => new Response('{"ret":') });
  assert.equal(malformed.http, 200); assert.equal(receipt(malformed).status, 'unknown');
  const timeout = await request('ilink/bot/sendmessage', { body: {}, timeout: 10,
    fetcher: async (_url, { signal }) => new Response(new ReadableStream({ start(controller) {
      const timer = setTimeout(() => controller.close(), 100);
      signal.addEventListener('abort', () => { clearTimeout(timer); controller.error(new Error('aborted')); }, { once: true });
    } })),
  });
  assert.equal(receipt(timeout).status, 'unknown');
  assert.equal(timeout.http, 200); assert.equal(timeout.error, 'body_read_or_timeout');
});

test('only the QR-authenticated owner, expected bot, private text challenge and stable ID are admitted', () => {
  const p = create(); bind(p); const m = message(p);
  assert.equal(admit(m, p.credentials, p.challenge).reason, 'test_input');
  for (const override of [{ from_user_id: 'foreign' }, { to_user_id: 'other-bot' }, { group_id: 'group' }, { message_type: 2 }]) assert.equal(admit({ ...m, ...override }, p.credentials, p.challenge).reason, 'identity_or_group');
  assert.equal(admit(m, { ...p.credentials, owner: '' }, p.challenge).reason, 'identity_or_group');
  assert.equal(admit({ ...m, message_id: 123 }, p.credentials, p.challenge).reason, 'missing_message_id');
  assert.equal(admit({ ...m, item_list: [{ type: 2 }] }, p.credentials, p.challenge).reason, 'outside_test_scope');
});

test('durable clean decisions and cursor are stored together; replay does not adopt the input twice', () => {
  const p = create(); bind(p); p.consume(batch(p)); const at = p.state.inputAt;
  p.consume(batch(p)); assert.equal(p.state.inputAt, at); assert.equal(p.state.inboundCount, 1);
  const ledger = JSON.parse(readFileSync(p.ledgerFile, 'utf8'));
  assert.equal(ledger.cursor, 'fixture-cursor'); assert.equal(ledger.events.filter(x => x.type === 'inbound').length, 1);
  assert.equal(ledger.events.filter(x => x.type === 'duplicate').length, 1);
  const text = JSON.stringify(ledger); assert.ok(!text.includes(p.credentials.token)); assert.ok(!text.includes(p.credentials.context));
  assert.equal(statSync(p.vaultFile).mode & 0o777, 0o600); assert.equal(statSync(p.directory).mode & 0o777, 0o700);
});

test('foreign content and contexts never enter the ledger, evidence or selected reply context', () => {
  const p = create(); bind(p);
  p.consume(batch(p, { msgs: [message(p, { from_user_id: 'foreign', context_token: 'foreign-context', item_list: [{ type: 1, text_item: { text: 'private unrelated text' } }] })] }));
  const evidence = JSON.stringify(p.exportEvidence());
  for (const secret of ['foreign-context', 'private unrelated text', 'fixture-owner', 'fixture-bot', 'fixture-cursor', p.credentials.token]) assert.ok(!evidence.includes(secret));
  assert.equal(p.credentials.context, undefined); assert.equal(p.state.inputAt, undefined);
});

test('a batch without a valid cursor cannot acknowledge or adopt a message', () => {
  const p = create(); bind(p);
  assert.throws(() => p.consume(batch(p, { get_updates_buf: undefined })));
  assert.equal(p.state.seen.length, 0); assert.equal(p.state.cursor, '');
});

test('after a crash in-flight sends become unknown and are never replayed', async () => {
  const p = create(); bind(p); p.consume(batch(p));
  p.state.deliveries.push({ kind: 'immediate', clientId: 'original', status: 'sending' }); p.save();
  let calls = 0;
  const resumed = new Probe(p.directory, { transport: async () => { calls++; return { http: 200, data: { ret: 0 } }; } });
  assert.equal(resumed.enabled, false); assert.equal(resumed.state.deliveries[0].status, 'unknown');
  await resumed.activate(); await resumed.worker;
  assert.equal(calls, 0); assert.equal(resumed.phase, 'review_required'); assert.equal(resumed.state.cursor, 'fixture-cursor');
});

test('a stopped or duplicate send does not dispatch; a failed dispatch is unknown', async () => {
  let calls = 0; const p = create({ transport: async () => { calls++; throw Error('socket'); } });
  bind(p); p.consume(batch(p)); const signal = new AbortController().signal;
  await p.send('immediate', signal); assert.equal(calls, 0);
  p.enabled = true; await p.send('immediate', signal); assert.equal(calls, 1);
  assert.equal(p.state.deliveries[0].status, 'unknown');
  await p.send('immediate', signal); assert.equal(calls, 1);
});

test('late receipt settles the same attempt after stop and does not start another send', async () => {
  let settle; const p = create({ transport: () => new Promise(resolve => { settle = resolve; }) });
  bind(p); p.consume(batch(p)); p.enabled = true;
  const pending = p.send('immediate', new AbortController().signal);
  await p.stop(); settle({ http: 200, data: { ret: 0 } }); await pending;
  assert.equal(p.state.deliveries[0].status, 'accepted'); assert.equal(p.state.deliveries.length, 1); assert.equal(p.enabled, false);
});

test('immediate plus delayed replies have stable single attempts and require separate visible confirmation', async () => {
  let p, sends = 0;
  p = create({ delayMs: 1, transport: async endpoint => {
    if (endpoint.endsWith('sendmessage')) { sends++; return { http: 200, data: { ret: 0 } }; }
    return { http: 200, data: batch(p) };
  } }); bind(p); p.event('login_confirmed');
  await p.activate(); await p.worker;
  assert.equal(sends, 1); assert.equal(p.phase, 'await_restore');
  const transport = p.transport; p = new Probe(p.directory, { delayMs: 1, transport });
  await p.activate(); await p.worker;
  assert.equal(sends, 2); assert.equal(p.state.deliveries[1].newInbound, 0);
  assert.ok(p.state.events.some(x => x.type === 'recovery_poll_observed'));
  assert.equal(p.gateA().status, 'unverified');
  p.confirmVisible('immediate'); p.confirmVisible('delayed'); assert.equal(p.gateA().status, 'observed');
  p.state.deliveries[1].newInbound = 1; assert.equal(p.gateA().status, 'unverified');
  assert.equal(p.exportEvidence().gateA.notificationB, 'unverified');
});

test('ret absent does not open the delayed send even if a local request ID exists', async () => {
  let sends = 0; const p = create({ transport: async endpoint => {
    if (endpoint.endsWith('getupdates')) return { http: 200, data: batch(p, { msgs: [] }) };
    sends++; return { http: 200, data: { client_id: 'local' } };
  } });
  bind(p); p.consume(batch(p)); await p.activate(); await p.worker;
  assert.equal(sends, 1); assert.equal(p.phase, 'review_required'); assert.equal(p.state.deliveries[0].status, 'unknown');
});

test('a durable receipt survives failure of the subsequent ledger write without another send', async () => {
  let calls = 0;
  const p = create({ transport: async () => { calls++; return { http: 200, data: { ret: 0, message_id: '18446744073709551615' } }; } });
  bind(p); p.consume(batch(p)); p.enabled = true;
  const save = p.save.bind(p); let writes = 0;
  p.save = () => { if (++writes === 2) throw Error('disk failure'); save(); };
  await assert.rejects(() => p.send('immediate', new AbortController().signal));
  const recovered = new Probe(p.directory);
  assert.equal(recovered.state.deliveries[0].status, 'accepted');
  assert.equal(recovered.state.deliveries[0].nativeId, '18446744073709551615');
  assert.equal(calls, 1); assert.equal(recovered.enabled, false);
});

test('login never accepts an account with missing QR owner identity or follows an untrusted redirect', async () => {
  for (const status of [{ status: 'confirmed', bot_token: 'fixture', ilink_bot_id: 'bot', baseurl: 'https://ilinkai.weixin.qq.com' }, { status: 'scaned_but_redirect', redirect_host: 'evil.test' }]) {
    const p = create({ transport: async endpoint => ({ http: 200, data: endpoint.includes('get_bot_qrcode') ? { qrcode: 'fixture-code', qrcode_img_content: 'fixture-qr-content' } : status }) });
    await p.startLogin(); await p.worker;
    assert.equal(p.credentials, null); assert.equal(p.enabled, false);
    assert.ok(['missing_identity', 'login_error'].includes(p.phase));
  }
});

test('QR login only creates a candidate and requires explicit owner activation', async () => {
  const p = create({ transport: async endpoint => ({ http: 200, data: endpoint.includes('get_bot_qrcode') ? { qrcode: 'fixture-code', qrcode_img_content: 'fixture-content' } : { status: 'confirmed', bot_token: 'fixture', ilink_bot_id: 'bot', ilink_user_id: 'owner', baseurl: 'https://ilinkai.weixin.qq.com' } }) });
  await p.startLogin(); await p.worker;
  assert.equal(p.phase, 'candidate'); assert.equal(p.enabled, false); assert.equal(p.qr, null);
  assert.equal(p.state.deliveries.length, 0); assert.ok(!JSON.stringify(p.exportEvidence()).includes('fixture'));
});

test('after a long stop, pending new inbound is observed before delayed send and prevents a clean delay conclusion', async () => {
  const p = create({ delayMs: 1 }); bind(p); p.event('login_confirmed'); p.consume(batch(p));
  p.state.inputAt -= 121_000;
  p.state.deliveries.push({ kind: 'immediate', clientId: 'first', status: 'accepted', finishedAt: new Date().toISOString() }); p.save();
  const calls = [];
  const restored = new Probe(p.directory, { delayMs: 1, transport: async endpoint => {
    calls.push(endpoint);
    if (endpoint.endsWith('getupdates')) return { http: 200, data: batch(p, { msgs: [message(p, { message_id: '18446744073709551614', item_list: [{ type: 1, text_item: { text: 'new unrelated text' } }] })] }) };
    return { http: 200, data: { ret: 0 } };
  } });
  await restored.activate(); await restored.worker;
  assert.deepEqual(calls, ['ilink/bot/getupdates', 'ilink/bot/sendmessage']);
  assert.equal(restored.state.deliveries[1].newInbound, 1);
  assert.ok(restored.state.deliveries[1].lastSuccessfulPollAt);
  restored.confirmVisible('immediate'); restored.confirmVisible('delayed');
  assert.ok(restored.gateA().pending.includes('delay_conditions'));
});

test('failed recovery polling cannot release the delayed send or satisfy Gate A', async () => {
  const p = create(); bind(p); p.consume(batch(p)); p.state.inputAt -= 121_000;
  p.state.deliveries.push({ kind: 'immediate', clientId: 'first', status: 'accepted' }); p.save();
  const calls = [];
  const restored = new Probe(p.directory, { transport: async endpoint => { calls.push(endpoint); return { http: 200, data: { ret: -14 } }; } });
  await restored.activate(); await restored.worker;
  assert.deepEqual(calls, ['ilink/bot/getupdates']);
  assert.equal(restored.state.deliveries.length, 1);
  assert.ok(restored.gateA().pending.includes('restore_and_cursor_observation'));
});
