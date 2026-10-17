// TTS engines (F19, spec 2.3): 豆包云（volcengine，HTTP 单向流式）与 Melo
// 本地（python＋sherpa-onnx 子进程）把口播正文合成为 ogg/opus，供 outbox
// audio 分支经 lark-cli --audio 投递。一切失败以 TtsError 拒绝，由投递层
// 降级为全文文本；引擎选择来自工作区 AGENTS.md 的 tts 配置块。

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCliProcess } from './cli-gateway.js';
import type { TtsConfig } from './config.js';

export class TtsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsError';
  }
}

/** Synthesize spoken text into ogg/opus bytes (lark-cli --audio native format). */
export type TtsSynth = (text: string) => Promise<Buffer>;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// 生产真机结论（docs/research/F19 研究第六节）：unidirectional 接口、
// seed-tts-2.0 资源、行 JSON 分块、code 0 与 20000000 双成功码、ogg_opus
// 仅 48000；晨报长度约 15–30s、偶发 >60s，异步投递按 300s 预算。
const VOLC_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
const VOLC_RESOURCE_ID = 'seed-tts-2.0';
const VOLC_TIMEOUT_MS = 300_000;
const VOLC_OK_CODES: ReadonlySet<number> = new Set([0, 20000000]);
const MELO_TIMEOUT_MS = 300_000;
const FFMPEG_TIMEOUT_MS = 60_000;

/** 豆包云适配器：纯 HTTP，零本地依赖；密钥由宿主环境注入。 */
export function volcengineTts(config: TtsConfig, apiKey: string, fetchImpl: FetchLike = fetch): TtsSynth {
  return async text => {
    if (!apiKey) throw new TtsError(`豆包 TTS 密钥未配置（环境变量 ${config.volcKeyEnv || '（未指定）'} 为空）。`);
    let response: Response;
    try {
      response = await fetchImpl(VOLC_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
          'X-Api-Resource-Id': VOLC_RESOURCE_ID,
          'X-Api-Request-Id': randomUUID(),
        },
        body: JSON.stringify({
          req_params: {
            text,
            speaker: config.voice,
            audio_params: { format: 'ogg_opus', sample_rate: 48000 },
          },
        }),
        signal: AbortSignal.timeout(VOLC_TIMEOUT_MS),
      });
    } catch (error) {
      throw new TtsError(`豆包 TTS 请求失败：${(error as Error).message}`);
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new TtsError(`豆包 TTS HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
    }
    const chunks: Buffer[] = [];
    const consume = (line: string): void => {
      if (!line) return;
      let obj: { code?: number; message?: string; data?: string };
      try {
        obj = JSON.parse(line) as { code?: number; message?: string; data?: string };
      } catch {
        throw new TtsError('豆包 TTS 返回了无法解析的分块。');
      }
      // 行必须携带明确 code；缺失按失败处理（fail-loud，不做宽松默认）。
      if (typeof obj.code !== 'number' || !VOLC_OK_CODES.has(obj.code)) throw new TtsError(`豆包 TTS 合成失败（code ${obj.code ?? '无'}）：${obj.message ?? ''}`);
      if (obj.data) chunks.push(Buffer.from(obj.data, 'base64'));
    };
    const decoder = new TextDecoder();
    let carry = '';
    for await (const piece of response.body as unknown as AsyncIterable<Uint8Array>) {
      carry += decoder.decode(piece, { stream: true });
      let nl: number;
      while ((nl = carry.indexOf('\n')) >= 0) {
        consume(carry.slice(0, nl).trim());
        carry = carry.slice(nl + 1);
      }
    }
    consume((carry + decoder.decode()).trim());
    const ogg = Buffer.concat(chunks);
    if (!ogg.length) throw new TtsError('豆包 TTS 未返回音频数据。');
    return ogg;
  };
}

/** Melo 本地适配器：两次子进程（sherpa-onnx 合成 wav → ffmpeg libopus 转 ogg），
 * 共享 CLI 网关骨架；meloDir 内可放 `python` 符号链接指向带 sherpa-onnx 的解释器。 */
/** meloDir 内可放 `python` 符号链接指向带 sherpa-onnx 的解释器；缺省回落 PATH 的 python3。 */
async function resolveMeloPython(meloDir: string): Promise<string> {
  const linked = join(meloDir, 'python');
  return stat(linked).then(() => linked, () => 'python3');
}

export function meloTts(config: TtsConfig, scriptPath: string): TtsSynth {
  return async text => {
    const python = await resolveMeloPython(config.meloDir);
    const work = await mkdtemp(join(tmpdir(), 'pa24-tts-'));
    try {
      const wav = join(work, 'melo.wav');
      const ogg = join(work, 'melo.ogg');
      const synth = await runCliProcess({
        bin: python,
        argv: [scriptPath, '--dir', config.meloDir, '--out', wav],
        timeoutMs: MELO_TIMEOUT_MS,
        stdinContent: text,
        fail: (kind, cause) => new TtsError(`Melo 合成失败（${kind}）${cause ? `：${cause.message}` : ''}`),
      });
      if (synth.exitCode !== 0) throw new TtsError(`Melo 合成失败（exit ${synth.exitCode}）：${synth.stderr.slice(0, 300)}`);
      const transcode = await runCliProcess({
        bin: 'ffmpeg',
        argv: ['-y', '-i', wav, '-c:a', 'libopus', '-b:a', '32k', ogg],
        timeoutMs: FFMPEG_TIMEOUT_MS,
        fail: (kind, cause) => new TtsError(`ffmpeg 转码失败（${kind}）${cause ? `：${cause.message}` : ''}`),
      });
      if (transcode.exitCode !== 0) throw new TtsError(`ffmpeg 转码失败（exit ${transcode.exitCode}）：${transcode.stderr.slice(0, 300)}`);
      const bytes = await readFile(ogg);
      if (!bytes.length) throw new TtsError('Melo 未产出音频数据。');
      return bytes;
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/** 随包分发的 Melo 合成脚本（packages/24pa/melo/melo_synth.py）。 */
export function defaultMeloScript(): string {
  return fileURLToPath(new URL('../melo/melo_synth.py', import.meta.url));
}

/** 引擎选择（none → null，由调用方降级文本）。 */
export function resolveTtsEngine(
  config: TtsConfig,
  env: NodeJS.ProcessEnv = process.env,
  opts: { fetchImpl?: FetchLike; meloScript?: string } = {},
): TtsSynth | null {
  if (config.engine === 'none') return null;
  if (config.engine === 'volcengine') return volcengineTts(config, env[config.volcKeyEnv] ?? '', opts.fetchImpl);
  return meloTts(config, opts.meloScript ?? defaultMeloScript());
}

export interface TtsReadiness {
  engine: TtsConfig['engine'];
  /** none 视作 ready=true（语音投递按设计关闭，无需检查）。 */
  ready: boolean;
  problems: string[];
}

/** 只读能力预检（面板健康/设置页用；不发起真实合成）。 */
export async function probeTts(
  config: TtsConfig,
  env: NodeJS.ProcessEnv = process.env,
  opts: { run?: typeof runCliProcess } = {},
): Promise<TtsReadiness> {
  if (config.engine === 'none') return { engine: 'none', ready: true, problems: [] };
  const run = opts.run ?? runCliProcess;
  const fail = (kind: string) => new Error(kind);
  if (config.engine === 'volcengine') {
    const problems: string[] = [];
    if (!(env[config.volcKeyEnv] ?? '').trim()) problems.push(`环境变量 ${config.volcKeyEnv} 未设置（豆包 API Key）。`);
    if (!config.voice) problems.push('未选择音色（tts.voice）。');
    return { engine: 'volcengine', ready: problems.length === 0, problems };
  }
  const problems: string[] = [];
  if (!config.meloDir) problems.push('未配置 Melo 部署目录（tts.meloDir）。');
  else if (!await stat(config.meloDir).then(() => true, () => false)) problems.push(`Melo 目录不存在：${config.meloDir}`);
  const python = config.meloDir ? await resolveMeloPython(config.meloDir) : null;
  if (python) {
    const probe = await run({ bin: python, argv: ['--version'], timeoutMs: 5_000, fail }).then(r => r.exitCode === 0).catch(() => false);
    if (!probe) problems.push(`Python 解释器不可用（${python}；需含 sherpa-onnx）。`);
  }
  const ff = await run({ bin: 'ffmpeg', argv: ['-version'], timeoutMs: 5_000, fail }).then(r => r.exitCode === 0).catch(() => false);
  if (!ff) problems.push('ffmpeg 不可用（Melo wav→ogg 转码必需）。');
  return { engine: 'melo', ready: problems.length === 0, problems };
}
