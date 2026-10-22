// Isolated Loader fault injection: park a claimed input before admission so
// tests can crash the host or revoke authorization at the actual boundary.
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const name = 'pa24-test-run-control-barrier';
export const inject = ['sessions'];
export function apply(ctx) {
  const path = process.env.PA24_TEST_RUN_BARRIER;
  if (!path) throw new Error('The test barrier needs an isolated state file.');
  const read = async () => JSON.parse(await readFile(path, 'utf8'));
  ctx.on('agent/created', async ({ agent }) => {
    await agent.ctx.plugin({ name: 'pa24-test-run-control-scope', apply(scope) {
      scope.on('agent/pre-step', async (payload, next) => {
    const state = await read();
    const match = state.kind === 'resume' ? '[24PA resume:' : '[24PA skill run:';
    if (state.kind && !state.entered && payload.messages.some(message => message.content.some(part => part.type === 'text' && part.text.includes(match)))) {
      await ctx.sessions.flush(payload.agent.session);
      const temporary = path + '.' + randomUUID();
      await writeFile(temporary, JSON.stringify({ ...state, entered: true, sessionId: payload.agent.id, messages: payload.messages }));
      await rename(temporary, path);
      while ((await read()).kind === state.kind) await new Promise(resolve => setTimeout(resolve, 25));
    }
        return next();
      });
    } }).await();
  });
}
