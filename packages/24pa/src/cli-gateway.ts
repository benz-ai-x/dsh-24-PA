// Shared CLI process gateway (F33): the spawn/timeout/output-limit/settle
// skeleton that lark.ts and wecom.ts previously duplicated verbatim (8
// segments). Envelope semantics stay in each domain — they pass a fail()
// factory so the shared failures reject as their own error classes.
// Where the host provides its subprocess service, the processes start through
// it (#310): in the service's scrubbed environment and inside its managed
// process range, so that stopping the plugin stops what the CLIs started.
// What the callers see is the same either way.

import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { executionSignal } from './execution-cancellation.js';
import type { SubprocessService } from './host.js';

export type CliFailKind = 'argv' | 'spawn' | 'timeout' | 'limit';

export interface CliProcessOptions {
  bin: string;
  /** Fully assembled argv (flags included); every element must be a string. */
  argv: readonly string[];
  timeoutMs: number;
  stdoutLimitBytes?: number;
  /** Entries the child sees on top of the environment it starts in; undefined removes one. */
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Optional stdin payload; omitted closes stdin immediately. */
  stdinContent?: string;
  /** Domain error factory: kind tells which shared failure fired. */
  fail(kind: CliFailKind, cause?: Error): Error;
}

export interface CliProcessResult {
  stdout: string;
  /** Lossless output for consumers such as pg_dump whose encoding may vary. */
  stdoutBytes: Buffer;
  stderr: string;
  exitCode: number | null;
}

const STDOUT_LIMIT_BYTES = 16 * 1024 * 1024;
/** What a version probe keeps of the answer. */
const VERSION_MAX_CHARS = 100;
const STDERR_KEEP_CHARS = 65536;
/** How long a starter may take to end a process it was told to terminate. */
const TERMINATE_GRACE_MS = 1500;

interface ExitFacts {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/** One started child process, whoever started it. */
interface Started {
  readonly stdin: Writable | undefined;
  readonly stdout: Readable | undefined;
  readonly stderr: Readable | undefined;
  /** Settles once: with the exit facts; with the reason it was terminated; or with the error that it could not start. */
  readonly exited: Promise<ExitFacts>;
  /** Begin terminating the process and whatever it started; further calls change nothing. */
  terminate(reason: Error): void;
}

/** A promise that settles once, on the first of the ways a started process can end. */
function onceSettle() {
  let settle!: (error?: Error, value?: ExitFacts) => void;
  const state = { settled: false };
  const promise = new Promise<ExitFacts>((resolve, reject) => {
    settle = (error, value) => {
      if (state.settled) return;
      state.settled = true;
      if (error) reject(error);
      else resolve(value!);
    };
  });
  return { promise, state, settle: (error?: Error, value?: ExitFacts) => settle(error, value) };
}

let subprocess: SubprocessService | undefined;

/** Start every child through the host's subprocess service from now on (#310); given none, children start as this plugin's own. */
export function startChildrenThrough(service: SubprocessService | undefined): void {
  subprocess = service;
}

/** Run one CLI child under the shared safety skeleton; envelope judgment is
 *  the caller's domain. Settles exactly once: spawn error, timeout
 *  (SIGTERM, outcome unknown to the caller), output-limit breach, or close. */
export function runCliProcess(options: CliProcessOptions): Promise<CliProcessResult> {
  const { bin, argv, timeoutMs, env, cwd, stdinContent, fail } = options;
  const abort = executionSignal();
  return new Promise((resolve, reject) => {
    if (abort?.aborted) { reject(abort.reason); return; }
    if (argv.some(a => typeof a !== 'string')) { reject(fail('argv')); return; }
    let started: Started;
    try {
      started = subprocess ? throughHost(subprocess, options) : asOwnProcess(options);
    } catch (error) {
      // The service refuses an invalid request before starting anything.
      reject(fail('spawn', error as Error));
      return;
    }
    const { stdin, stdout, stderr, exited } = started;
    const stdoutParts: Buffer[] = [], stderrParts: Buffer[] = [];
    let bytes = 0, stderrBytes = 0, settled = false;
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abort?.removeEventListener('abort', cancel);
      stdin?.destroy(); stdout?.destroy(); stderr?.destroy();
      if (error) reject(error);
      else {
        const stdoutBytes = Buffer.concat(stdoutParts);
        resolve({ stdout: stdoutBytes.toString('utf8'), stdoutBytes, stderr: Buffer.concat(stderrParts).toString('utf8'), exitCode: code });
      }
    };
    const timer = setTimeout(() => started.terminate(fail('timeout')), timeoutMs);
    const cancel = () => started.terminate(fail('timeout', abort?.reason));
    abort?.addEventListener('abort', cancel, { once: true });
    stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.stdoutLimitBytes ?? STDOUT_LIMIT_BYTES)) started.terminate(fail('limit'));
      else stdoutParts.push(chunk);
    });
    stderr?.on('data', (chunk: Buffer) => {
      const kept = chunk.subarray(0, Math.max(0, STDERR_KEEP_CHARS - stderrBytes));
      if (kept.length) { stderrParts.push(kept); stderrBytes += kept.length; }
    });
    stdin?.on('error', () => {});
    stdin?.end(stdinContent);
    exited.then(facts => finish(undefined, facts.exitCode), error => finish(error));
  });
}

/** The process as this plugin's own: a child of this process, its group on POSIX, signalled and escalated here. */
function asOwnProcess(options: CliProcessOptions): Started {
  const { bin, argv, env, cwd, stdinContent, fail } = options;
  const grouped = process.platform !== 'win32';
  const child = spawn(bin, argv, { cwd, shell: false, detached: grouped, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const done = onceSettle();
  let killTimer: NodeJS.Timeout | undefined, settleTimer: NodeJS.Timeout | undefined;
  let reason: Error | null = null, childClosed = false;
  // A process that was terminated ends with the reason it was, whatever else is observed of its end.
  const end = (error?: Error, code: number | null = null) => {
    clearTimeout(killTimer); clearTimeout(settleTimer);
    done.settle(reason ?? error, error || reason ? undefined : { exitCode: code, signal: null });
  };
  const signal = (name: NodeJS.Signals) => {
    try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { /* Already exited. */ }
  };
  child.on('error', error => end(fail('spawn', error)));
  child.on('close', code => {
    childClosed = true;
    // The group can outlive its leader (for example a detached-stdio child).
    // Complete escalation even when the leader accepts TERM immediately.
    if (reason && grouped && killTimer) return;
    end(undefined, code);
  });
  child.stdin.on('error', () => {});
  child.stdin.end(stdinContent);
  return {
    stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, exited: done.promise,
    terminate(why: Error) {
      if (done.state.settled || reason) return;
      reason = why;
      signal('SIGTERM');
      killTimer = setTimeout(() => {
        killTimer = undefined;
        signal('SIGKILL');
        if (childClosed) end();
      }, 500);
      settleTimer = setTimeout(() => { signal('SIGKILL'); child.unref(); end(); }, 1000);
    },
  };
}

/** The process in the host's managed range: the service scrubs the environment, resolves the executable and escalates the termination. */
function throughHost(service: SubprocessService, options: CliProcessOptions): Started {
  const { bin, argv, env, cwd, stdinContent, fail } = options;
  const handle = service.spawn({
    argv: [bin, ...argv], cwd: cwd ?? process.cwd(),
    stdio: { stdin: stdinContent === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: TERMINATE_GRACE_MS,
    ...(env ? { env } : {}),
  });
  const done = onceSettle();
  let reason: Error | null = null, lastResort: NodeJS.Timeout | undefined;
  const end = (error?: Error, facts?: ExitFacts) => { clearTimeout(lastResort); done.settle(reason ?? error, reason ? undefined : facts); };
  void handle.done.then(facts => end(undefined, facts), error => end(fail('spawn', error as Error)));
  return {
    stdin: handle.stdin, stdout: handle.stdout, stderr: handle.stderr, exited: done.promise,
    terminate(why: Error) {
      if (done.state.settled || reason) return;
      reason = why;
      handle.terminate();
      // The service escalates within its grace period; this only ends the wait should it never report the end.
      lastResort = setTimeout(() => end(), TERMINATE_GRACE_MS + 1000);
    },
  };
}

/** What asking a CLI for its version told. */
export type CliVersionProbe = { ok: true; version: string } | { ok: false; problem: string };

/**
 * Whether a CLI answers `--version`, the one harmless start of it: what an access check runs before it reads anything
 * through the CLI. A failure is said so that the message is the next step.
 */
export async function cliVersion(cli: { path: string }, options: { timeoutMs: number; env?: Record<string, string | undefined> }): Promise<CliVersionProbe> {
  try {
    const { stdout, exitCode } = await runCliProcess({ bin: cli.path, argv: ['--version'], timeoutMs: options.timeoutMs, stdoutLimitBytes: 16384, env: options.env,
      fail: (kind, cause) => new Error(kind === 'spawn' ? `无法启动 ${cli.path}（${cause?.message ?? '未知原因'}）` : `${cli.path} 的版本检查未完成（${kind}）`) });
    if (exitCode !== 0) return { ok: false, problem: `${cli.path} 的版本检查退出码 ${exitCode}` };
    return { ok: true, version: stdout.trim().slice(0, VERSION_MAX_CHARS) };
  } catch (error) {
    return { ok: false, problem: (error as Error).message };
  }
}
