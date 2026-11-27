import z from '@deepseek-ai/schemastery';
import type { DshContext } from './host.js';
import { PaRuntime, HostStartupError } from './runtime.js';
import { registerPanel } from './panel.js';
import { hasOfficialConnectors } from './cli-source.js';

export const name = 'pa24';
export const inject = ['sessionController', 'sessions', 'connection', 'agentPresets', 'workspaceRegistry', 'subagents', 'fs', 'skills'];

export const Config = z.object({
  stateDirectory: z.string().required(),
  backupSessionsRoot: z.string(),
  backupStoragesRoot: z.string(),
  backupAttachmentsRoot: z.string(),
  workspacePath: z.string().default(''),
  // Absent by default: the vendor CLIs come from the official connectors, or from PATH on a host line without them (src/cli-source.ts).
  larkCliBin: z.string(),
  wecomCliBin: z.string(),
  cliTimeoutMs: z.natural().min(1000).default(90000),
  dispatchTickMs: z.natural().min(50).default(400),
  outboxTickMs: z.natural().min(250).default(1000),
  reminderTickMs: z.natural().min(250).default(1000),
  noteVerifyTickMs: z.natural().min(1000).default(60_000),
  reviewReminderTickMs: z.natural().min(250).default(5000),
});

export function apply(ctx: DshContext, config: any) {
  // A host line without the official connectors (the rc line) has none to
  // supply the CLIs: there the entry names the bare executables in the
  // settings, and PATH resolves them when a process starts.
  // Read once, here: the CLI account service is a row of the host's base
  // bundle, there before any plugin row applies. The official-connector e2e
  // boots that host with no CLI in the plugin row and sees the connectors'
  // CLI; were the service late, the entry would name bare executables, which
  // the connector line refuses.
  const noConnectors = !hasOfficialConnectors(ctx);
  const runtime = new PaRuntime(ctx, {
    stateDirectory: config.stateDirectory,
    backupSessionsRoot: config.backupSessionsRoot,
    backupStoragesRoot: config.backupStoragesRoot,
    backupAttachmentsRoot: config.backupAttachmentsRoot,
    workspacePath: config.workspacePath,
    larkCliBin: config.larkCliBin || (noConnectors ? 'lark-cli' : undefined),
    wecomCliBin: config.wecomCliBin || (noConnectors ? 'wecom-cli' : undefined),
    cliTimeoutMs: config.cliTimeoutMs,
    dispatchTickMs: config.dispatchTickMs,
    outboxTickMs: config.outboxTickMs,
    reminderTickMs: config.reminderTickMs,
    noteVerifyTickMs: config.noteVerifyTickMs,
    reviewReminderTickMs: config.reviewReminderTickMs,
  });
  ctx.reflect.provide('pa24', runtime);
  ctx.effect(() => runtime.skillPackages.register());
  ctx.on('agent/created', async ({ agent }) => { await runtime.skillRuns.attach(agent); await runtime.workerRuns.attach(agent); });
  ctx.on('agent/pre-step', ({ agent, messages }, next) => runtime.planStep(agent, messages, next));
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
    return () => runtime.stop();
  });
}
