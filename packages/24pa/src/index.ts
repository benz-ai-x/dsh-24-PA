import z from '@deepseek-ai/schemastery';
import type { DshContext } from './host.js';
import { PaRuntime, HostStartupError } from './runtime.js';
import { registerPanel } from './panel.js';

export const name = 'pa24';
export const inject = ['sessionController', 'sessions', 'connection', 'agentPresets', 'workspaceRegistry', 'subagents', 'fs'];

export const Config = z.object({
  stateDirectory: z.string().required(),
  workspacePath: z.string().default(''),
  larkCliBin: z.string().default('lark-cli'),
  wecomCliBin: z.string().default('wecom-cli'),
  cliTimeoutMs: z.natural().min(1000).default(90000),
  dispatchTickMs: z.natural().min(50).default(400),
  outboxTickMs: z.natural().min(250).default(1000),
  reminderTickMs: z.natural().min(250).default(1000),
  noteVerifyTickMs: z.natural().min(1000).default(60_000),
  reviewReminderTickMs: z.natural().min(250).default(5000),
});

export function apply(ctx: DshContext, config: any) {
  const runtime = new PaRuntime(ctx, {
    stateDirectory: config.stateDirectory,
    workspacePath: config.workspacePath,
    larkCliBin: config.larkCliBin,
    wecomCliBin: config.wecomCliBin,
    cliTimeoutMs: config.cliTimeoutMs,
    dispatchTickMs: config.dispatchTickMs,
    outboxTickMs: config.outboxTickMs,
    reminderTickMs: config.reminderTickMs,
    noteVerifyTickMs: config.noteVerifyTickMs,
    reviewReminderTickMs: config.reviewReminderTickMs,
  });
  ctx.reflect.provide('pa24', runtime);
  ctx.on('session/event', (session, event) => runtime.onSessionEvent(session, event));
  registerPanel(ctx, runtime);
  ctx.effect(() => {
    void runtime
      .start()
      .catch(error => {
        runtime.startupError = new HostStartupError(error instanceof Error ? error.message : String(error));
        // Startup failures must release everything they acquired so a fixed
        // environment can simply restart the Host.
        runtime.stop().catch(() => {});
      })
      .then(() => {
        if (runtime.startupError) console.warn(`[pa24] 启动未完成：${runtime.startupError.message}`);
      });
    return () => {
      runtime.stop().catch(() => {});
    };
  });
}
