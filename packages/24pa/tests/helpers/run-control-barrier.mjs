// Isolated Loader fault injection for input admission and durable checkpoints.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const name = 'pa24-test-run-control-barrier';
export const inject = ['sessions'];
export function apply(ctx) {
  const path = process.env.PA24_TEST_RUN_BARRIER;
  if (!path) throw new Error('The test barrier needs an isolated state file.');
  const read = async () => JSON.parse(await readFile(path, 'utf8'));
  const write = async value => {
    const temporary = path + '.' + randomUUID();
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, path);
  };
  const flush = ctx.sessions.flush.bind(ctx.sessions);
  ctx.sessions.flush = async session => {
    const state = await read();
    if (state.kind !== 'graceful-stop' || state.entered || !session.id.startsWith('pa24-skill-')) return flush(session);
    const events = session.ownEvents();
    if (!events.some(event => event.type === 'tool/result')) return flush(session);
    const persistence = ctx.get('sessionPersistence');
    if (!persistence) throw new Error('The graceful-stop barrier needs real session persistence.');
    const handle = await persistence.open(session.id, 'read');
    let persistedStepEnded;
    try { persistedStepEnded = (await handle.read(0)).events.some(event => event.type === 'step/end'); }
    finally { await handle.close(); }
    await write({ ...state, entered: true, sessionId: session.id, persistedStepEnded, stepEnded: events.some(event => event.type === 'step/end') });
    while ((await read()).kind === 'graceful-stop' && !(await read()).release) await new Promise(resolve => setTimeout(resolve, 25));
    return flush(session);
  };
  ctx.effect(() => async () => {
    ctx.sessions.flush = flush;
    const state = await read();
    if (state.kind === 'graceful-stop') await write({ ...state, disposeStarted: true });
  });
  ctx.on('agent/created', async ({ agent }) => {
    await agent.ctx.plugin({ name: 'pa24-test-run-control-scope', apply(scope) {
      scope.on('agent/pre-step', async (payload, next) => {
    const state = await read();
    const match = state.kind === 'recover' ? '[24PA recover input:' : state.kind === 'resume' ? '[24PA resume:' : '[24PA skill run:';
    if (['recover', 'resume', 'start'].includes(state.kind) && !state.entered && payload.messages.some(message => message.content.some(part => part.type === 'text' && part.text.includes(match)))) {
      await ctx.sessions.flush(payload.agent.session);
      const temporary = path + '.' + randomUUID();
      await writeFile(temporary, JSON.stringify({ ...state, entered: true, sessionId: payload.agent.id, messages: payload.messages }));
      await rename(temporary, path);
      while ((await read()).kind === state.kind) {
        if ((await read()).interrupt) { payload.agent.cancel({ kind: 'user' }, { keepInbox: true }); break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
        return next();
      });
    } }).await();
  });
}
