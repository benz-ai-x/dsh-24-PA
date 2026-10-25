import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixture, deferred } from '../helpers/runtime.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { WorkCompletionHistory } from '../../lib/work-completion.js';

for (const storage of ['sqlite', 'postgres']) describe(`original work completion / ${storage}`, () => {
  let cluster, f;
  beforeAll(async () => { if (storage === 'postgres') cluster = await startPgCluster(); });
  afterEach(async () => { vi.restoreAllMocks(); await f?.cleanup(); f = null; });
  afterAll(async () => { await cluster?.stop(); });
  async function setup() {
    if (cluster) await cluster.query('drop schema if exists pa24 cascade');
    f = await fixture({ dispatchTickMs: 50, env: cluster ? { PA24_PG_DSN: cluster.dsn } : {} });
    f.a = await f.workspace('a', { storage }); f.options.workspacePath = f.a;
    await f.rt.start(); f.parent = f.agents.get(await f.rt.openLocalSession());
    return f;
  }
  async function delegate(title = 'work') {
    const { workId } = await f.rt.delegate({ worker: 'memo', title, instruction: '保存并报告' }, f.parent);
    return workId;
  }
  function end(id, { turn = 1, input = f.nativeInputs.get('start-' + id), output = 'original result', reason = { kind: 'completed' }, notify = true } = {}) {
    const child = f.agents.get(id);
    const events = [...child.session.ownEvents(),
      { type: 'agent/inbox/spliced', data: { target: 'queue', start: 0, removedCount: 0, inserted: [input] } },
      { type: 'turn/start', data: { turn } },
      { type: 'agent/inbox/spliced', data: { target: 'queue', start: 0, removedCount: 1, inserted: [], outcome: 'consumed' } },
      { type: 'user/message', data: input },
      ...(output ? [{ type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: output }] } } }] : []),
      { type: 'turn/end', data: { turn, reason } }];
    child.session.ownEvents = () => events;
    if (notify) f.rt.onSessionEvent(child.session, events.at(-1));
    return child.session;
  }
  const work = id => f.rt.repos.workItems.get(id);
  const results = async id => (await f.rt.repos.outbox.recent(100)).filter(r => r.dedup_key.startsWith(`workitem:${id}:result:`));
  async function fault(phase) {
    if (storage === 'sqlite') {
      const spec = phase === 'outbox' ? "insert on pa24_outbox when NEW.dedup_key like 'workitem:%:result:%'"
        : "update on pa24_work_item when NEW.status in ('completed','failed')";
      await f.rt.db.query(`create trigger settlement_fault before ${spec} begin select raise(abort, 'SETTLEMENT_SQL_DOWN'); end`);
      return () => f.rt.db.query('drop trigger settlement_fault');
    }
    const condition = phase === 'outbox' ? "NEW.dedup_key like 'workitem:%:result:%'" : "NEW.status in ('completed','failed')";
    const target = phase === 'outbox' ? 'insert on pa24.outbox' : 'update on pa24.work_item';
    await f.rt.db.query(`create function pa24.settlement_fault() returns trigger language plpgsql as $$ begin if ${condition} then raise exception 'SETTLEMENT_SQL_DOWN'; end if; return NEW; end $$`);
    await f.rt.db.query(`create trigger settlement_fault before ${target} for each row execute function pa24.settlement_fault()`);
    return async () => { await f.rt.db.query(`drop trigger settlement_fault on pa24.${phase === 'outbox' ? 'outbox' : 'work_item'}`); await f.rt.db.query('drop function pa24.settlement_fault()'); };
  }
  async function restartCold(id) {
    await f.rt.stop(); f.agents.delete(id); f.rt = f.make(); await f.rt.start();
  }

  it.each(['before-update', 'outbox'])('%s fault automatically retries the same generation and releases both slots', async phase => {
    await setup(); const a = await delegate('a'), b = await delegate('b'), c = await delegate('c');
    const remove = await fault(phase); end(a); end(b);
    await vi.waitFor(async () => expect((await work(a)).progress).toContain('自动重试'));
    expect(await results(a)).toEqual([]); expect((await work(c)).status).toBe('queued');
    await remove();
    await vi.waitFor(async () => expect((await work(a)).status).toBe('completed'), { timeout: 5000 });
    await vi.waitFor(async () => expect((await work(b)).status).toBe('completed'), { timeout: 5000 });
    expect(await work(a)).toMatchObject({ recovery_gen: 0, result: 'original result' });
    expect((await work(c)).status).toBe('running'); expect(f.nativeInputs.size).toBe(3);
    expect(await results(a)).toHaveLength(1); expect(await results(b)).toHaveLength(1);
  });

  it('total ledger outage still checkpoints the Session before exit; cold restart never resends', async () => {
    await setup(); const id = await delegate();
    const down = vi.spyOn(f.rt.db, 'query').mockRejectedValue(new Error('all ledger reads/writes unavailable'));
    end(id);
    await vi.waitFor(() => expect(f.storedSessions.get(id)?.events.at(-1)?.type).toBe('turn/end'));
    await f.rt.stop(); down.mockRestore(); f.agents.delete(id); f.rt = f.make(); await f.rt.start();
    expect(await work(id)).toMatchObject({ status: 'completed', recovery_gen: 0, result: 'original result' });
    expect(f.nativeInputs.size).toBe(1); expect(await results(id)).toHaveLength(1);
  });

  it('committed transaction with lost acknowledgement is not delivered twice after restart', async () => {
    await setup(); const id = await delegate(); const transaction = f.rt.db.withTransaction.bind(f.rt.db);
    let lost = false;
    vi.spyOn(f.rt.db, 'withTransaction').mockImplementation(async fn => {
      const result = await transaction(fn);
      if (!lost && result?.id === id && result.status === 'completed') { lost = true; throw new Error('commit acknowledgement lost'); }
      return result;
    });
    end(id); await vi.waitFor(() => expect(lost).toBe(true));
    await restartCold(id);
    expect((await work(id)).recovery_gen).toBe(0); expect(await results(id)).toHaveLength(1); expect(f.nativeInputs.size).toBe(1);
  });

  it('lost commit acknowledgements still automatically fill the next free slot', async () => {
    await setup(); const a = await delegate('a'), b = await delegate('b'), c = await delegate('c');
    const transaction = f.rt.db.withTransaction.bind(f.rt.db), lost = new Set();
    vi.spyOn(f.rt.db, 'withTransaction').mockImplementation(async fn => {
      const result = await transaction(fn);
      if ([a, b].includes(result?.id) && result.status === 'completed' && !lost.has(result.id)) {
        lost.add(result.id); throw new Error('commit acknowledgement lost');
      }
      return result;
    });
    end(a); end(b); await vi.waitFor(() => expect(lost.size).toBe(2));
    // Capacity is claimed before the new input is durably prepared and sent.
    // Wait for native admission as well, rather than racing that SQL boundary.
    await vi.waitFor(async () => {
      expect((await work(c)).status).toBe('running'); expect(f.nativeInputs.size).toBe(3);
    }, { timeout: 3000 });
    expect(await results(a)).toHaveLength(1); expect(await results(b)).toHaveLength(1);
  });

  it('temporary cold-read failure retries evidence without resuming the Worker', async () => {
    await setup(); const id = await delegate(), session = end(id, { notify: false });
    await f.ctx.sessions.flush(session);
    const persistence = f.ctx.get('sessionPersistence');
    const open = vi.spyOn(persistence, 'open').mockRejectedValueOnce(new Error('history backend unavailable'));
    await restartCold(id); expect((await work(id)).status).toBe('running');
    await vi.waitFor(async () => expect((await work(id)).status).toBe('completed'), { timeout: 5000 });
    expect(f.nativeInputs.size).toBe(1); expect(open).toHaveBeenCalledTimes(2);
  });

  it('a live Worker with a closed write handle settles from drained history without resend', async () => {
    await setup(); const id = await delegate(); const original = f.ctx.sessions.flush;
    const closed = vi.spyOn(f.ctx.sessions, 'flush').mockImplementation(async session => {
      if (session.id !== id) return original(session);
      const error = new Error(`session "${id}": flush on a closed handle`);
      error.name = 'SessionHandleClosedError'; throw error;
    });
    try {
      const session = end(id);
      await original(session);
      await expect(new WorkCompletionHistory(f.ctx).read(await work(id))).resolves.toMatchObject({ kind: 'complete', output: 'original result' });
      await vi.waitFor(async () => expect((await work(id)).status).toBe('completed'), { timeout: 5000 });
      expect(f.nativeInputs.size).toBe(1);
    } finally { closed.mockRestore(); }
  });

  it.each(['false', 'throw'])('flush %s does not authorize completion; a later successful checkpoint retries automatically', async mode => {
    await setup(); const id = await delegate(); const original = f.ctx.sessions.flush;
    const blocked = vi.spyOn(f.ctx.sessions, 'flush').mockImplementation(async session => {
      if (session.id !== id) return original(session);
      if (mode === 'throw') throw new Error('native checkpoint failed');
      return false;
    });
    end(id); await new Promise(resolve => setTimeout(resolve, 200));
    expect((await work(id)).status).toBe('running'); expect(await results(id)).toEqual([]);
    blocked.mockRestore();
    await vi.waitFor(async () => expect((await work(id)).status).toBe('completed'), { timeout: 5000 });
    expect(f.nativeInputs.size).toBe(1);
  });

  it.each(['missing', 'wrong-parent', 'wrong-workspace', 'unconsumed', 'interrupted', 'foreign-ledger'])('cold %s evidence is explicit reconciliation, never a fabricated result or new input', async corruption => {
    await setup(); const id = await delegate(); const session = end(id, { notify: false });
    await f.ctx.sessions.flush(session);
    const stored = f.storedSessions.get(id);
    if (corruption === 'missing') f.storedSessions.delete(id);
    if (corruption === 'wrong-parent') stored.header.parentSession = 'other-parent';
    if (corruption === 'wrong-workspace') stored.header.cwd = '/other-workspace';
    if (corruption === 'unconsumed') stored.events = [stored.events[0]];
    if (corruption === 'interrupted') stored.events.at(-1).data.reason = { kind: 'interrupted' };
    if (corruption === 'foreign-ledger') {
      const item = await work(id);
      await f.rt.db.query('update pa24.work_item set execution_scope = $2 where id = $1', [id, JSON.stringify({ ...item.execution_scope, workspaceId: 'another-ledger' })]);
    }
    await restartCold(id);
    expect((await work(id)).status).toBe('needs_reconciliation');
    expect(await results(id)).toEqual([]); expect(f.nativeInputs.size).toBe(1);
  });

  it.each([{ kind: 'error', error: { message: 'provider failed' } }, { kind: 'max-tokens' }, { kind: 'completed' }])('failed/no-output turns release capacity once: %j', async reason => {
    await setup(); const id = await delegate(); const session = end(id, { reason, output: '' });
    await vi.waitFor(async () => expect((await work(id)).status).toBe('failed'));
    f.rt.onSessionEvent(session, session.ownEvents().at(-1));
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(await results(id)).toHaveLength(1); expect((await work(id)).recovery_gen).toBe(0);
  });

  it('stop defeats a queued settlement; continuation only accepts the new execution identity', async () => {
    await setup(); const id = await delegate(), remove = await fault('outbox'); end(id);
    await vi.waitFor(async () => expect((await work(id)).progress).toContain('自动重试'));
    await f.rt.control({ action: 'stop', workId: id }, f.parent); await remove();
    await f.rt.control({ action: 'continue', workId: id }, f.parent);
    const child = f.agents.get(id).session;
    f.rt.onSessionEvent(child, child.ownEvents().at(-1));
    await new Promise(resolve => setTimeout(resolve, 600));
    expect((await work(id)).status).toBe('running'); expect(await results(id)).toEqual([]);
    end(id, { turn: 2, input: f.nativeInputs.get('continue-0'), output: 'new generation result' });
    await vi.waitFor(async () => expect((await work(id)).status).toBe('completed'), { timeout: 3000 });
    expect(await work(id)).toMatchObject({ recovery_gen: 1, result: 'new generation result' }); expect(await results(id)).toHaveLength(1);
  });

  it('persistent SQL failure uses bounded retry and duplicate end events do not reset backoff', async () => {
    await setup(); const id = await delegate(), remove = await fault('outbox');
    const attempts = vi.spyOn(f.rt.repos.workItems, 'finishWithDelivery');
    const session = end(id);
    await vi.waitFor(() => expect(attempts).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 30; i++) f.rt.onSessionEvent(session, session.ownEvents().at(-1));
    await new Promise(resolve => setTimeout(resolve, 950));
    expect(attempts.mock.calls.length).toBeLessThanOrEqual(3);
    expect((await work(id)).progress).toContain('自动重试');
    await remove(); await vi.waitFor(async () => expect((await work(id)).status).toBe('completed'), { timeout: 5000 });
    expect(f.nativeInputs.size).toBe(1); expect(await results(id)).toHaveLength(1);
  });

  it('workspace switch waits for an accepted checkpoint; stopped A cannot settle into B', async () => {
    await setup(); const id = await delegate(), entered = deferred(), release = deferred();
    const original = f.ctx.sessions.flush;
    vi.spyOn(f.ctx.sessions, 'flush').mockImplementationOnce(async session => { entered.resolve(); await release.promise; return original(session); });
    end(id); await entered.promise; await f.rt.control({ action: 'stop', workId: id }, f.parent);
    const b = await f.workspace('b'); let switched = false;
    const switching = f.rt.bind(b).then(() => { switched = true; });
    await new Promise(resolve => setTimeout(resolve, 30)); expect(switched).toBe(false);
    release.resolve(); await switching;
    expect(await f.rt.repos.workItems.list()).toEqual([]); expect(await f.rt.repos.outbox.recent()).toEqual([]);
  });
});
