// Shared CLI process gateway (F33): the spawn/timeout/output-limit/settle
// skeleton that lark.ts and wecom.ts previously duplicated verbatim (8
// segments). Envelope semantics stay in each domain — they pass a fail()
// factory so the shared failures reject as their own error classes.

import { spawn } from 'node:child_process';

export type CliFailKind = 'argv' | 'spawn' | 'timeout' | 'limit';

export interface CliProcessOptions {
  bin: string;
  /** Fully assembled argv (flags included); every element must be a string. */
  argv: readonly string[];
  timeoutMs: number;
  stdoutLimitBytes?: number;
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
const STDERR_KEEP_CHARS = 65536;

/** Run one CLI child under the shared safety skeleton; envelope judgment is
 *  the caller's domain. Settles exactly once: spawn error, timeout
 *  (SIGTERM, outcome unknown to the caller), output-limit breach, or close. */
export function runCliProcess(options: CliProcessOptions): Promise<CliProcessResult> {
  const { bin, argv, timeoutMs, env, cwd, stdinContent, fail } = options;
  return new Promise((resolve, reject) => {
    if (argv.some(a => typeof a !== 'string')) { reject(fail('argv')); return; }
    const grouped = process.platform !== 'win32';
    const child = spawn(bin, argv, { cwd, shell: false, detached: grouped, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, stderrBytes = 0, limitError: Error | null = null, settled = false, childClosed = false;
    let killTimer: NodeJS.Timeout | undefined, settleTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(settleTimer);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      if (error) reject(error);
      else {
        const stdoutBytes = Buffer.concat(stdout);
        resolve({ stdout: stdoutBytes.toString('utf8'), stdoutBytes, stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code });
      }
    };
    const signal = (name: NodeJS.Signals) => {
      try { if (grouped && child.pid) process.kill(-child.pid, name); else child.kill(name); } catch { /* Already exited. */ }
    };
    const terminate = (error: Error) => {
      if (limitError || settled) return;
      limitError = error; signal('SIGTERM');
      killTimer = setTimeout(() => {
        killTimer = undefined;
        signal('SIGKILL');
        if (childClosed) finish(limitError!);
      }, 500);
      settleTimer = setTimeout(() => { signal('SIGKILL'); child.unref(); finish(limitError!); }, 1000);
    };
    const timer = setTimeout(() => terminate(fail('timeout')), timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      if (limitError) return;
      bytes += chunk.length;
      if (bytes > (options.stdoutLimitBytes ?? STDOUT_LIMIT_BYTES)) terminate(fail('limit'));
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const kept = chunk.subarray(0, Math.max(0, STDERR_KEEP_CHARS - stderrBytes));
      if (kept.length) { stderr.push(kept); stderrBytes += kept.length; }
    });
    child.on('error', error => finish(limitError ?? fail('spawn', error)));
    child.on('close', code => {
      childClosed = true;
      // The group can outlive its leader (for example a detached-stdio child).
      // Complete escalation even when the leader accepts TERM immediately.
      if (limitError && grouped && killTimer) return;
      finish(limitError ?? undefined, code);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdinContent);
  });
}
