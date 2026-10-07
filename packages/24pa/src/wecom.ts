import { spawn } from 'node:child_process';

// Controlled wecom-cli gateway (F16): fixed argv arrays (never a shell
// string), the CLI's JSON output decides success, and the three observed
// envelope shapes map onto the same outcome vocabulary as lark.ts.
//
// Contract (research: docs/research/F16-企微日程待办实现研究.md, measured on
// @wecom/cli 1.3.4):
// - success: exit 0, stdout JSON. Business fields are mixed with the
//   `security_notice` / `extra_identity_context` prefix fields, which are
//   stripped from `data` (kept in `raw`) so callers never mistake them for
//   business output.
// - business error A ("errcode body"): exit 1, stdout
//   `{errcode, errmsg, help_message?}` — 850002 not authorized, 850003
//   authorization expired, 853006 not available for the corporation. The
//   help_message carries the in-app authorization link and must stay
//   available verbatim for diagnostics.
// - business error B ("error body"): exit 1, stdout
//   `{error: {code, message}}` — platform limits and parameter errors.
// - CLI argument errors exit 1 with usage text on stderr; unknown commands
//   exit 2. Business responses (including errors) arrive on stdout.
// - timeouts settle as outcome "unknown": verify the real object first.

export interface WecomCliOptions {
  bin: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export class WecomCliError extends Error {
  constructor(
    message: string,
    public readonly outcome: 'failed' | 'unknown' | 'invalid-envelope',
    public readonly errcode?: number,
    public readonly helpMessage?: string,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'WecomCliError';
  }
}

export interface WecomCliResult {
  /** Parsed stdout with the identity prefix fields stripped. */
  data: any;
  /** Parsed stdout as returned (prefix fields included). */
  raw: any;
}

const PREFIX_FIELDS = ['security_notice', 'extra_identity_context', 'help_instruction'] as const;

function stripPrefixFields(parsed: Record<string, any>): Record<string, any> {
  const data: Record<string, any> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if ((PREFIX_FIELDS as readonly string[]).includes(key)) continue;
    data[key] = value;
  }
  return data;
}

export function runWecomCli(options: WecomCliOptions, args: readonly string[]): Promise<WecomCliResult> {
  return new Promise((resolve, reject) => {
    if (args.some(a => typeof a !== 'string')) {
      reject(new WecomCliError('CLI 参数必须是固定字符串数组。', 'invalid-envelope'));
      return;
    }
    // wecom-cli has no --profile and no --json flag: JSON is the default
    // output shape and credentials are machine-global (~/.config/wecom).
    const argv = [...args];
    const child = spawn(options.bin, argv, {
      cwd: options.cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    let limitError: WecomCliError | null = null;
    let settled = false;
    const timer = setTimeout(() => {
      limitError = new WecomCliError(
        '企微 CLI 超时；结果未知，请先核对企微中的实际对象，不要盲目重试。',
        'unknown',
      );
      child.kill('SIGTERM');
    }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
      if (stdout.length > 16 * 1024 * 1024) {
        limitError = new WecomCliError('企微 CLI 输出超过读取上限。', 'invalid-envelope');
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 65536) stderr += chunk;
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new WecomCliError(`无法启动企微 CLI（${options.bin}）：${error.message}`, 'failed', undefined, undefined, error));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (limitError) {
        reject(limitError);
        return;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        reject(new WecomCliError(
          `企微 CLI 未返回 JSON（exit ${code}）；检查安装与授权${stderr ? `：${stderr.trim().slice(0, 200)}` : '。'}`,
          'invalid-envelope',
          undefined,
          undefined,
          { stdout, stderr },
        ));
        return;
      }
      if (code === 0) {
        resolve({ data: stripPrefixFields(parsed), raw: parsed });
        return;
      }
      if (typeof parsed.errcode === 'number') {
        reject(new WecomCliError(
          `企微 CLI 失败（errcode ${parsed.errcode}）：${parsed.errmsg ?? '无错误说明'}`,
          'failed',
          parsed.errcode,
          typeof parsed.help_message === 'string' ? parsed.help_message : undefined,
          parsed,
        ));
        return;
      }
      if (parsed?.error && typeof parsed.error.code !== 'undefined') {
        reject(new WecomCliError(
          `企微 CLI 失败（${parsed.error.code}）：${parsed.error.message ?? '无错误说明'}`,
          'failed',
          undefined,
          undefined,
          parsed,
        ));
        return;
      }
      reject(new WecomCliError(`企微 CLI 返回不受支持的结果信封（exit ${code}）。`, 'invalid-envelope', undefined, undefined, parsed));
    });
    child.stdin.on('error', () => {
      // Early process exit surfaces through the close handler above.
    });
    child.stdin.end();
  });
}

// ---- wall-clock helpers -----------------------------------------------------
//
// wecom-cli exchanges local wall-clock strings ("YYYY-MM-DD HH:mm:ss", and
// "YYYY-MM-DD" for date-only values) in the configured workspace timezone,
// while the ledger stores timestamptz. These two functions are the only
// place that conversion happens.

function partsInZone(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  return map;
}

/** Format an instant as wecom wall-clock text in the workspace timezone. */
export function wecomWallTime(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  const hour = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}:${p.second ?? '00'}`;
}

/** Parse a wecom wall-clock string (date or datetime) in the workspace timezone. */
export function wecomParseWallTime(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  const asUtc = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  if (Number.isNaN(asUtc)) return null;
  // Two-pass offset resolution: wall time read as UTC, corrected by the
  // zone's offset at that instant (sufficient for non-DST China timelines;
  // a DST boundary inside one request's window would still converge on the
  // retry pass because the projection refreshes from the next sync).
  const offset1 = tzOffsetMillis(new Date(asUtc), timeZone);
  const offset2 = tzOffsetMillis(new Date(asUtc - offset1), timeZone);
  return new Date(asUtc - offset2);
}

function tzOffsetMillis(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const hour = p.hour === '24' ? '00' : p.hour;
  const asUtc = Date.parse(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second ?? '00'}Z`);
  return asUtc - date.getTime();
}
