import { spawn } from 'node:child_process';

// Controlled lark-cli gateway: fixed argv arrays (never a shell string), the
// official `--json` envelope decides success, and partial results are treated
// as "verify first" instead of success.

export interface LarkCliOptions {
  bin: string;
  profile: string;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export class LarkCliError extends Error {
  constructor(
    message: string,
    public readonly outcome: 'failed' | 'unknown' | 'invalid-envelope',
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'LarkCliError';
  }
}

export interface LarkCliResult {
  data: any;
  raw: any;
}

export function runLarkCli(options: LarkCliOptions, args: readonly string[], stdinContent?: string): Promise<LarkCliResult> {
  return new Promise((resolve, reject) => {
    if (args.some(a => typeof a !== 'string')) {
      reject(new LarkCliError('CLI 参数必须是固定字符串数组。', 'invalid-envelope'));
      return;
    }
    const argv = ['--profile', options.profile, ...args, '--json'];
    const child = spawn(options.bin, argv, {
      cwd: options.cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...options.env,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    let limitError: LarkCliError | null = null;
    let settled = false;
    const timer = setTimeout(() => {
      limitError = new LarkCliError(
        '飞书 CLI 超时；结果未知，请先核对飞书中的实际对象，不要盲目重试。',
        'unknown',
      );
      child.kill('SIGTERM');
    }, options.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
      if (stdout.length > 16 * 1024 * 1024) {
        limitError = new LarkCliError('飞书 CLI 输出超过读取上限。', 'invalid-envelope');
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
      reject(new LarkCliError(`无法启动飞书 CLI（${options.bin}）：${error.message}`, 'failed', error));
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (limitError) {
        reject(limitError);
        return;
      }
      const source = code === 0 ? stdout : stderr;
      let parsed: any;
      try {
        parsed = JSON.parse(source.trim());
      } catch {
        reject(new LarkCliError(`飞书 CLI 未返回 JSON（exit ${code}）；检查安装、profile 与授权。`, 'invalid-envelope', { stdout, stderr }));
        return;
      }
      if (code !== 0 || parsed.ok === false) {
        reject(new LarkCliError(parsed.error?.message || `飞书 CLI 失败（exit ${code}）。`, 'failed', parsed));
        return;
      }
      // lark-cli ≥1.0.87 的部分子命令（auth status 等）成功时返回无 ok 信封的裸对象：
      // exit 0 且无 error 字段视为成功，其余形态仍不受支持。
      if (parsed.ok !== true && !(parsed.ok === undefined && parsed.error === undefined)) {
        reject(new LarkCliError('飞书 CLI 返回不受支持的结果信封，不能记作成功。', 'invalid-envelope', parsed));
        return;
      }
      resolve({ data: parsed.data ?? parsed, raw: parsed });
    });
    child.stdin.on('error', () => {
      // Early process exit surfaces through the close handler above.
    });
    child.stdin.end(stdinContent);
  });
}
