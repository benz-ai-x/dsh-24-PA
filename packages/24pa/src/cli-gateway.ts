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
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Optional stdin payload; omitted closes stdin immediately. */
  stdinContent?: string;
  /** Domain error factory: kind tells which shared failure fired. */
  fail(kind: CliFailKind, cause?: Error): Error;
}

export interface CliProcessResult {
  stdout: string;
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
    if (argv.some(a => typeof a !== 'string')) {
      reject(fail('argv'));
      return;
    }
    const child = spawn(bin, argv, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    let limitError: Error | null = null;
    let settled = false;
    const timer = setTimeout(() => {
      limitError = fail('timeout');
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
      if (stdout.length > STDOUT_LIMIT_BYTES) {
        limitError = fail('limit');
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_KEEP_CHARS) stderr += chunk;
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(fail('spawn', error));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (limitError) {
        reject(limitError);
        return;
      }
      resolve({ stdout, stderr, exitCode: code });
    });
    child.stdin.on('error', () => {
      // Early process exit surfaces through the close handler above.
    });
    child.stdin.end(stdinContent);
  });
}
