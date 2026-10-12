// Controlled lark-cli gateway: fixed argv arrays (never a shell string), the
// official `--json` envelope decides success, and partial results are treated
// as "verify first" instead of success. Process management lives in the
// shared cli-gateway skeleton (F33); only the lark envelope semantics are
// judged here.

import { runCliProcess } from './cli-gateway.js';

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
  return runCliProcess({
    bin: options.bin,
    argv: ['--profile', options.profile, ...args, '--json'],
    timeoutMs: options.timeoutMs,
    env: {
      ...options.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    },
    cwd: options.cwd,
    stdinContent,
    fail: (kind, cause) => {
      if (kind === 'timeout') return new LarkCliError('飞书 CLI 超时；结果未知，请先核对飞书中的实际对象，不要盲目重试。', 'unknown');
      if (kind === 'limit') return new LarkCliError('飞书 CLI 输出超过读取上限。', 'invalid-envelope');
      if (kind === 'argv') return new LarkCliError('CLI 参数必须是固定字符串数组。', 'invalid-envelope');
      return new LarkCliError(`无法启动飞书 CLI（${options.bin}）：${cause?.message ?? ''}`, 'failed', cause);
    },
  }).then(({ stdout, stderr, exitCode: code }) => {
    const source = code === 0 ? stdout : stderr;
    let parsed: any;
    try {
      parsed = JSON.parse(source.trim());
    } catch {
      throw new LarkCliError(`飞书 CLI 未返回 JSON（exit ${code}）；检查安装、profile 与授权。`, 'invalid-envelope', { stdout, stderr });
    }
    if (code !== 0 || parsed.ok === false) {
      throw new LarkCliError(parsed.error?.message || `飞书 CLI 失败（exit ${code}）。`, 'failed', parsed);
    }
    // lark-cli ≥1.0.87 的部分子命令（auth status 等）成功时返回无 ok 信封的裸对象：
    // exit 0 且无 error 字段视为成功，其余形态仍不受支持。
    if (parsed.ok !== true && !(parsed.ok === undefined && parsed.error === undefined)) {
      throw new LarkCliError('飞书 CLI 返回不受支持的结果信封，不能记作成功。', 'invalid-envelope', parsed);
    }
    return { data: parsed.data ?? parsed, raw: parsed };
  });
}
