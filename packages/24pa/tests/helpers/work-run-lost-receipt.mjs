// Only installed in the isolated Loader profile. The real tool handler writes
// a durable effect, then throws so ToolRuntime returns its actual error value.
import { appendFile } from 'node:fs/promises';
export const name = 'pa24-test-worker-lost-receipt';
export const inject = ['pa24'];
export function apply(ctx) {
  const runtime = ctx.get('pa24'), original = runtime.runControl.bind(runtime);
  runtime.runControl = async (args, agent) => {
    if (args.action === 'progress' && args.stage === 'TEST_LOST_ACKNOWLEDGEMENT') {
      await appendFile(process.env.PA24_TEST_WORK_EFFECT, agent.id + '\n');
      throw new Error('Test write completed; acknowledgement lost.');
    }
    return original(args, agent);
  };
  ctx.effect(() => () => { runtime.runControl = original; });
}
