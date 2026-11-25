import SessionProjection from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

// Match the real host: newer dsh separates tool registration from execution.
// Older supported hosts still own native execution inside ToolRuntime.
export async function installToolRuntime(ctx) {
  // dsh 0.2.3 activates the system prompt only once its projection registry exists.
  await ctx.plugin(SessionProjection);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  if (typeof ctx.tools.setExecutor === 'function') {
    await ctx.plugin(await import('@deepseek-ai/dsh-tool-executor-native'));
  }
}

export async function executeTool(ctx, input) {
  if (typeof ctx.tools.setExecutor !== 'function') return ctx.tools.execute(input);
  const { callId, name, arguments: args, ...context } = input;
  const batch = await ctx.tools.execute({ ...context, calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) }] });
  if (batch.results.length !== 1 || batch.results[0].callId !== callId) throw new Error('ToolRuntime did not settle the requested call');
  return batch.results[0].result;
}

/** Mount an agent's scope chain beside the real registries, the way the Host scopes a
 *  Session: `agent.ctx` becomes a scope whose subject is the agent. A caller that needs
 *  the agent/created admission triggers it itself. */
export async function mountAgentScope(ctx, agent) {
  const { createRequire } = await import('node:module');
  // Resolve the scope package from the tools package, so both share one instance.
  const { resolve } = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-tools'));
  const { createScope } = await import(resolve('@deepseek-ai/dsh-scope'));
  let scope;
  await ctx.plugin(Object.assign(inner => { scope = createScope(inner, agent); }, { inject: ['tools', 'systemPrompt'] }));
  agent.ctx = scope.ctx;
  return agent;
}
