import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Probe, atomicJson } from './probe.mjs';
import { notificationPlan, notificationReceipt, notificationScope } from './notification-plan.mjs';

const dirs = [];
const steps = [{ afterMs: 60_000, context: 'original' }, { afterMs: 120_000, context: 'original' }];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), '24pa-notification-unit-')); dirs.push(directory);
  const probe = new Probe(directory, { notificationSteps: steps, ...options });
  probe.credentials = { bot: 'fixture-bot', owner: 'fixture-owner', token: 'fixture-private-bot-token', base: 'https://ilinkai.weixin.qq.com' };
  atomicJson(probe.vaultFile, probe.credentials);
  return probe;
}
const scope = probe => notificationScope(probe.state.run, probe.steps);
function input(probe, overrides = {}) {
  return { message_id: '18446744073709551615', from_user_id: probe.credentials.owner, to_user_id: probe.credentials.bot,
    message_type: 1, message_state: 2, context_token: 'fixture-private-context',
    item_list: [{ type: 1, text_item: { text: probe.challenge } }], ...overrides };
}
const batch = (msgs = []) => ({ http: 200, data: { msgs, get_updates_buf: 'fixture-private-cursor' } });
const seed = probe => probe.consume(batch([input(probe)]).data);

test('finite notification scope validates count, timing and context and cannot reuse an earlier account experiment', () => {
  for (const plan of [[], [steps[0]], [...steps, { afterMs: 120_001, context: 'original' }],
    [{ afterMs: 60_000, context: 'omitted' }, steps[1]], [{ ...steps[0], text: 'arbitrary' }, steps[1]],
    [steps[0], { afterMs: 120_000, context: 'foreign' }]]) assert.throws(() => notificationPlan(plan));
  const probe = fixture(); const before = readFileSync(probe.ledgerFile, 'utf8');
  assert.throws(() => new Probe(probe.directory));
  assert.throws(() => new Probe(probe.directory, { notificationSteps: [steps[0], { ...steps[1], afterMs: 180_000 }] }));
  assert.equal(readFileSync(probe.ledgerFile, 'utf8'), before);
  assert.throws(() => new Probe(probe.directory, { notificationSteps: [steps[0], { afterMs: Infinity, context: 'original' }] }));
});

test('exact scope confirmation is mandatory and incomplete or foreign input never provides a send context', async () => {
  const probe = fixture();
  await assert.rejects(() => probe.activate());
  await assert.rejects(() => probe.activate('owner-two-test-replies'));
  for (const overrides of [{ message_state: 1 }, { from_user_id: 'foreign' }, { to_user_id: 'foreign-bot' }, { group_id: 'group' }]) {
    probe.consume(batch([input(probe, { ...overrides, message_id: String(probe.state.inboundCount + 1) })]).data);
  }
  assert.equal(probe.state.inputAt, undefined); assert.equal(probe.credentials.context, undefined);
  assert.equal(probe.enabled, false);
});

test('scheduled notifications use the original context and independent times without an immediate response', async () => {
  let clock = 1000000, probe, polls = 0; const sends = [];
  probe = fixture({ clock: () => clock, transport: async (endpoint, options) => {
    if (endpoint.endsWith('getupdates')) {
      if (++polls === 1) return batch([input(probe)]);
      clock += 60_000; return batch();
    }
    sends.push({ clock, msg: options.body.msg }); return { http: 200, data: { message_id: String(9000 + sends.length) } };
  } });
  await probe.activate(scope(probe)); await probe.worker;
  assert.deepEqual(sends.map(row => row.clock), [1060000, 1120000]);
  assert.ok(sends.every(row => row.msg.context_token === 'fixture-private-context' && row.msg.to_user_id === 'fixture-owner'));
  assert.ok(probe.state.deliveries.every(row => row.newInbound === 0 && row.status === 'accepted'));
  assert.equal(probe.publicState().gateA.status, 'not_applicable');
  assert.equal(probe.exportEvidence().notificationB.decision, 'unverified');
  assert.equal(probe.exportEvidence().notificationB.visibleOriginalContextSamples, 0);
  for (const step of probe.steps) probe.confirmVisible(step.kind);
  assert.equal(probe.exportEvidence().notificationB.visibleOriginalContextSamples, 2);
  assert.equal(probe.exportEvidence().notificationB.decision, 'unverified');
  const exported = JSON.stringify(probe.exportEvidence());
  for (const secret of ['fixture-private-context', 'fixture-private-bot-token', 'fixture-private-cursor', 'fixture-owner', 'fixture-bot', probe.challenge]) assert.ok(!exported.includes(secret));
});

test('new inbound terminates this experiment before any due send, while duplicate seed does not count as new', async () => {
  let clock = 1000000, probe, calls = 0;
  probe = fixture({ clock: () => clock, transport: async endpoint => {
    assert.ok(endpoint.endsWith('getupdates')); calls++;
    return batch([input(probe), input(probe, { message_id: '18446744073709551614', item_list: [{ type: 1, text_item: { text: 'unrelated private message' } }] })]);
  } });
  seed(probe); clock += 60_000;
  await probe.activate(scope(probe)); await probe.worker;
  assert.equal(calls, 1); assert.equal(probe.phase, 'new_inbound'); assert.equal(probe.state.inboundCount, 2);
  assert.equal(probe.state.deliveries.length, 0);
  const restored = new Probe(probe.directory, { notificationSteps: steps });
  await assert.rejects(() => restored.activate(scope(restored)));
  assert.ok(!JSON.stringify(restored.exportEvidence()).includes('unrelated private message'));
});

test('restart keeps cursor and receipts, never replays unknown requests, and manual visibility does not rewrite the original status', async () => {
  let clock = 1000000, probe, sent = 0;
  probe = fixture({ clock: () => clock, transport: async endpoint => {
    if (endpoint.endsWith('getupdates')) return batch();
    sent++; throw Error('timeout with private data');
  } }); seed(probe); clock += 60_000;
  await probe.activate(scope(probe)); await probe.worker;
  assert.equal(sent, 1); assert.equal(probe.phase, 'review_required');
  clock += 60_000;
  let polls = 0;
  const resumed = new Probe(probe.directory, { notificationSteps: steps, clock: () => clock, transport: async (endpoint, options) => {
    if (endpoint.endsWith('getupdates')) { polls++; assert.equal(options.body.get_updates_buf, 'fixture-private-cursor'); return batch(); }
    sent++; return { http: 200, data: { ret: 0 } };
  } });
  await resumed.activate(scope(resumed)); await resumed.worker;
  assert.equal(polls, 0); assert.equal(sent, 1);
  resumed.confirmVisible('notification-1');
  await resumed.activate(scope(resumed)); await resumed.worker;
  assert.equal(sent, 2); assert.equal(resumed.state.deliveries[0].status, 'unknown');
  assert.equal(resumed.state.deliveries[1].status, 'accepted');
});

test('late resume does not catch up missed notifications and a failed poll cannot release a due send', async () => {
  for (const mode of ['late', 'failed_poll']) {
    let clock = 1000000, calls = 0;
    const probe = fixture({ clock: () => clock, transport: async endpoint => {
      assert.ok(endpoint.endsWith('getupdates')); calls++;
      return mode === 'late' ? batch() : { http: 200, data: { ret: -14 } };
    } }); seed(probe); clock += mode === 'late' ? 181_000 : 60_000;
    await probe.activate(scope(probe)); await probe.worker;
    assert.equal(calls, 1); assert.equal(probe.state.deliveries.length, 0);
    assert.equal(probe.phase, mode === 'late' ? 'missed_window' : 'poll_error');
  }
});

test('explicit negative context cases are single fixed attempts, and original-context rejection stops further attempts', async () => {
  let clock = 1000000, probe; const sent = [];
  const plan = [...steps, { afterMs: 180_000, context: 'omitted' }, { afterMs: 240_000, context: 'invalid' }];
  probe = fixture({ notificationSteps: plan, clock: () => clock, transport: async (endpoint, options) => {
    if (endpoint.endsWith('getupdates')) { clock += 60_000; return batch(); }
    sent.push(options.body.msg);
    return { http: 200, data: { ret: sent.length > 2 ? -7 : 0 } };
  } }); seed(probe);
  await probe.activate(scope(probe)); await probe.worker;
  assert.equal(sent.length, 4); assert.equal('context_token' in sent[2], false);
  assert.equal(sent[3].context_token, '24pa-invalid-test-context');
  assert.equal(probe.phase, 'await_visible_receipts');
  const rejected = fixture({ clock: () => clock, transport: async endpoint => endpoint.endsWith('getupdates') ? batch() : { http: 200, data: { ret: -7 } } });
  seed(rejected); clock += 60_000;
  await rejected.activate(scope(rejected)); await rejected.worker;
  assert.equal(rejected.phase, 'original_context_rejected'); assert.equal(rejected.state.deliveries.length, 1);
});

test('receipt evidence uses the observed native ID shape and keeps unknown, HTTP errors and contradictory responses distinct', () => {
  assert.equal(notificationReceipt({ http: 200, data: { message_id: '1234567890123456789' } }).status, 'accepted');
  assert.equal(notificationReceipt({ http: 200, data: { ret: 0 } }).basis, 'explicit_ret_zero');
  assert.equal(notificationReceipt({ http: 200, data: { message_id: '42', ret: -14 } }).status, 'rejected');
  for (const data of [{}, { message_id: '42', errmsg: 'failure' }, { message_id: '42', ret: '0' }, { client_id: '42' }]) {
    assert.equal(notificationReceipt({ http: 200, data }).status, 'unknown');
  }
  assert.equal(notificationReceipt({ http: 429, data: { message_id: '42' } }).status, 'unknown');
});
