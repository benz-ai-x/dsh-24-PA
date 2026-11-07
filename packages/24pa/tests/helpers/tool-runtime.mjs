import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';

// Match the real host: newer dsh separates tool registration from execution.
// Older supported hosts still own native execution inside ToolRuntime.
export async function installToolRuntime(ctx) {
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
