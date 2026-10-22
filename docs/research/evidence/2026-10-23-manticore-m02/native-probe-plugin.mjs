import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export const name = 'm02-native-probe';
export const inject = ['agents', 'sessionController', 'sessions', 'tools', 'connection', 'schedule', 'pa24'];
export function apply(ctx) {
  const root = process.env.M02_PROBE_ROOT, stateFile = join(root, 'state.json');
  const read = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  const mutate = fn => { const state = read(); fn(state); writeFileSync(stateFile, JSON.stringify(state)); };
  const note = (event, data) => appendFileSync(join(root, 'events.jsonl'), JSON.stringify({ at: Date.now(), event, ...data }) + '\n');
  const flushes = new Map();
  ctx.on('agent/created', async ({ agent }) => {
    if (!read().sessions[agent.id]) return;
    await agent.ctx.plugin({ name: 'm02-native-scope', inject: ['tools'], apply(scope) {
      scope.tools.restrict({ allow: ['bash'] });
      scope.on('agent/pre-step', async (payload, next) => {
        if (payload.agent.id !== agent.id) return next();
        mutate(state => { const row = state.sessions[agent.id]; row.claimed.push(...payload.messages); });
        note('pre-step', { id: agent.id, turn: payload.turn, step: payload.step, count: payload.messages.length });
        if (read().sessions[agent.id].waiting) return { kind: 'reject' };
        return next();
      });
      scope.on('tools/execute', async (exec, next) => {
        const result = await next();
        if (exec.agent?.id === agent.id && read().sessions[agent.id].waitAfterTool) mutate(state => { state.sessions[agent.id].waiting = true; });
        return result;
      });
    } }).await();
  });
  ctx.on('session/event', (session, event) => {
    if (!read().sessions[session.id]) return;
    if (['turn/start', 'turn/end', 'step/start', 'step/end', 'user/message'].includes(event.type)) note('native', { id: session.id, type: event.type, time: event.time, data: event.data });
    if (event.type === 'turn/end') {
      const pending = ctx.sessions.flush(session); flushes.set(session.id, pending);
      pending.catch(error => note('flush-error', { error: String(error) }));
    }
  });
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/m02-probe', methods: ['POST'], requestBody: 'buffered', async fetch(req) {
    try {
      const input = await req.json(); let value;
      if (input.action === 'create') {
        mutate(state => { state.sessions[input.id] = { claimed: [], waiting: !!input.waiting, waitAfterTool: !!input.waitAfterTool }; });
        value = await ctx.sessionController.create({ sessionId: input.id, cwd: process.env.PA24_WORKSPACE, agentPreset: 'pa24' });
        await ctx.sessionController.rename({ sessionId: input.id, title: 'M02 isolated probe' });
      } else if (input.action === 'inspect') {
        const found = await ctx.sessionController.resolveAgent(input.id); if (found.error) throw found.error;
        await flushes.get(input.id); await ctx.sessions.flush(found.agent.session);
        value = { row: read().sessions[input.id], events: found.agent.session.ownEvents(), pending: found.agent.inbox.nextTurn.length + found.agent.inbox.nextStep.length };
      } else if (input.action === 'resume') {
        const found = await ctx.sessionController.resolveAgent(input.id); if (found.error) throw found.error;
        await found.agent.runMaintenance(async () => {
          const row = read().sessions[input.id];
          const message = input.original ? row.claimed[0] : { id: randomUUID(), content: [{ type: 'text', text: '补充信息已保存，请继续原任务。' }], source: { kind: 'user', rpcId: randomUUID() } };
          mutate(state => { state.sessions[input.id].waiting = false; });
          found.agent.followup(message); await ctx.sessions.flush(found.agent.session);
          value = { messageId: message.id };
        });
      } else if (input.action === 'schedule') value = await ctx.schedule.create(input.id, { at: new Date(Date.now() + 400).toISOString(), title: 'M02 probe schedule', prompt: 'M02_ORIGINAL_SCHEDULE' });
      else if (input.action === 'catalog') value = await ctx.schedule.catalog();
      else if (input.action === 'delete') value = await ctx.schedule.delete({ sessionId: input.id, id: input.scheduleId });
      else throw new Error('unknown probe action');
      return Response.json({ ok: true, value });
    } catch (error) { return Response.json({ ok: false, error: String(error) }); }
  } }));
}
