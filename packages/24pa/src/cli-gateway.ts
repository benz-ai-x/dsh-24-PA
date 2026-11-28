// Shared CLI process gateway (F33): the spawn/timeout/output-limit/settle
// skeleton that lark.ts and wecom.ts previously duplicated verbatim (8
// segments). Envelope semantics stay in each domain — they pass a fail()
// factory so the shared failures reject as their own error classes.
// Every process starts through the host's subprocess service (#310): in the
// environment the host hands its children and inside the process range it
// manages. The service owns how a process is ended; this gateway owns why —
// the deadline, the output limit and the execution's abort — and says the
// reason. What outlives a call is the host's to end: the service ends what
// it manages when it is disposed or the Host exits, not when this plugin is
// stopped or reloaded. Stopping or reloading the plugin ends the calls that
// an execution's abort covers, as it always did.

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
  /** Entries the child sees on top of the environment the host hands it (#310); undefined removes one. */
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
/**
 * What the service may take to end a process it was told to terminate — and, once the process has exited, to drain its pipes: a
 * positive number up to the host's own cap. It was 500 ms while this plugin ended processes itself.
 */
const TERMINATE_GRACE_MS = 1500;
/** Beyond the grace, how long a terminated call still waits for the service to report that nothing of the range is left. */
const EXIT_WAIT_SLACK_MS = 1000;

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

/** Start every child through this subprocess service from now on (#310): the plugin entry names the host's when it loads; a test names a stand-in for it. */
export function startChildrenThrough(service: SubprocessService): void {
  subprocess = service;
}

/** Run one CLI child under the shared safety skeleton; envelope judgment is
 *  the caller's domain. Settles exactly once: it could not start; the
 *  deadline, the output limit or the execution's abort ended it (what the
 *  process did by then is not known to the caller); or it exited. */
export function runCliProcess(options: CliProcessOptions): Promise<CliProcessResult> {
  const { bin, argv, timeoutMs, env, cwd, stdinContent, fail } = options;
  const abort = executionSignal();
  return new Promise((resolve, reject) => {
    if (abort?.aborted) { reject(abort.reason); return; }
    if (argv.some(a => typeof a !== 'string')) { reject(fail('argv')); return; }
    if (!subprocess) { reject(fail('spawn', new Error('没有为这个运行时安装子进程服务。'))); return; }
    let started: Started;
    try {
      started = throughHost(subprocess, options);
    } catch (error) {
      // The service refuses an invalid request before starting anything.
      reject(fail('spawn', error as Error));
      return;
    }
    const { stdin, stdout, stderr, exited } = started;
    const stdoutParts: Buffer[] = [], stderrParts: Buffer[] = [];
    let bytes = 0, stderrBytes = 0, settled = false, ending = false;
    // Output that arrives after the call is on its way out is not kept: the limit no longer has a say, and the call ends with its reason.
    const terminate = (why: Error) => { ending = true; started.terminate(why); };
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
    const timer = setTimeout(() => terminate(fail('timeout')), timeoutMs);
    const cancel = () => terminate(fail('timeout', abort?.reason));
    abort?.addEventListener('abort', cancel, { once: true });
    stdout?.on('data', (chunk: Buffer) => {
      if (ending) return;
      bytes += chunk.length;
      if (bytes > (options.stdoutLimitBytes ?? STDOUT_LIMIT_BYTES)) terminate(fail('limit'));
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
  // A process that was terminated ends when nothing of it is left to observe, not when its leader alone reports: the service's
  // range covers what the process started. From the termination a bound is set, and only ends the wait should the service never report.
  void handle.done.then(
    facts => { if (reason) void handle.waitForExit().then(() => end(), () => end()); else end(undefined, facts); },
    error => { if (reason) void handle.waitForExit().then(() => end(), () => end()); else end(fail('spawn', error as Error)); },
  );
  return {
    stdin: handle.stdin, stdout: handle.stdout, stderr: handle.stderr, exited: done.promise,
    terminate(why: Error) {
      if (done.state.settled || reason) return;
      reason = why;
      handle.terminate();
      lastResort = setTimeout(() => end(), TERMINATE_GRACE_MS + EXIT_WAIT_SLACK_MS);
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
