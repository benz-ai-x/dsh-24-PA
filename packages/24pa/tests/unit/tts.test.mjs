import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/cli-gateway.js', () => ({ runCliProcess: vi.fn() }));
const { runCliProcess } = await import('../../lib/cli-gateway.js');
const { volcengineTts, meloTts, resolveTtsEngine, probeTts, TtsError } = await import('../../lib/tts.js');
const { writeFileSync } = await import('node:fs');

const VOLC = { engine: 'volcengine', voice: 'zh_female_cancan_uranus_bigtts', volcKeyEnv: 'PA24_VOLC_TTS_KEY', meloDir: '' };
const MELO = { engine: 'melo', voice: '', volcKeyEnv: '', meloDir: '/tmp/melo-f19' };
const NONE = { engine: 'none', voice: '', volcKeyEnv: '', meloDir: '' };

function lineResponse(lines, status = 200) {
  const body = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
  return new Response(body, { status });
}

describe('豆包云适配器（volcengine）', () => {
  it('按行拼接 base64 OGG 分块（code 0 与 20000000 双成功码）', async () => {
    const a = Buffer.from('OggS-head').toString('base64');
    const b = Buffer.from('-audio-tail').toString('base64');
    const fetchImpl = vi.fn().mockResolvedValue(lineResponse([
      { code: 0, message: '', data: a },
      { code: 20000000, message: 'OK', data: b },
      { code: 20000000, message: 'OK', usage: { text_words: 10 } },
    ]));
    const ogg = await volcengineTts(VOLC, 'key-1', fetchImpl)('早上好');
    expect(ogg.toString()).toBe('OggS-head-audio-tail');
    const init = fetchImpl.mock.calls[0][1];
    expect(init.headers).toMatchObject({ 'X-Api-Resource-Id': 'seed-tts-2.0' });
    expect(String(init.body)).toContain('"speaker":"zh_female_cancan_uranus_bigtts"');
  });

  it('服务端错误码与 HTTP 非 200 都以 TtsError 拒绝', async () => {
    await expect(
      volcengineTts(VOLC, 'key-1', async () => lineResponse([{ code: 45000030, message: 'not granted' }]))('t'),
    ).rejects.toThrow(TtsError);
    await expect(
      volcengineTts(VOLC, 'key-1', async () => new Response('nope', { status: 401 }))('t'),
    ).rejects.toThrow(/401/);
  });

  it('密钥缺失 fail-loud；无音频数据拒绝', async () => {
    await expect(volcengineTts(VOLC, '', async () => lineResponse([]))('t')).rejects.toThrow(/PA24_VOLC_TTS_KEY/);
    await expect(
      volcengineTts(VOLC, 'k', async () => lineResponse([{ code: 0, message: '' }]))('t'),
    ).rejects.toThrow(/未返回音频/);
  });
});

describe('Melo 本地适配器', () => {
  it('两次子进程：python 合成 wav → ffmpeg 转 ogg → 读回并清理', async () => {
    vi.mocked(runCliProcess).mockImplementation(async ({ bin, argv }) => {
      if (bin.endsWith('python3')) {
        writeFileSync(String(argv.at(-1)), 'wav-bytes');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      writeFileSync(String(argv.at(-1)), 'ogg-bytes');
      return { stdout: '', stderr: '', exitCode: 0 };
    });
    const ogg = await meloTts(MELO, '/pkg/melo/melo_synth.py')('早上好');
    expect(ogg.toString()).toBe('ogg-bytes');
    expect(runCliProcess).toHaveBeenCalledTimes(2);
  });

  it('python 失败以 TtsError 拒绝', async () => {
    vi.mocked(runCliProcess).mockReset();
    vi.mocked(runCliProcess).mockResolvedValueOnce({ stdout: '', stderr: 'boom', exitCode: 2 });
    await expect(meloTts(MELO, '/pkg/melo/melo_synth.py')('t')).rejects.toThrow(/Melo 合成失败/);
  });
});

describe('引擎解析与只读预检', () => {
  it('none → null；volcengine 缺密钥可检出；none 预检恒 ready', async () => {
    expect(resolveTtsEngine(NONE)).toBeNull();
    expect(typeof resolveTtsEngine(VOLC, {})).toBe('function');
    const probe = await probeTts(VOLC, {});
    expect(probe.ready).toBe(false);
    expect(probe.problems.join()).toContain('PA24_VOLC_TTS_KEY');
    expect((await probeTts(NONE)).ready).toBe(true);
  });

  it('melo 预检：目录缺失＋python/ffmpeg 不可用逐项报出', async () => {
    vi.mocked(runCliProcess).mockReset();
    vi.mocked(runCliProcess).mockRejectedValue(new Error('spawn ENOENT'));
    const probe = await probeTts(MELO, {});
    expect(probe.ready).toBe(false);
    expect(probe.problems.join()).toContain('Melo 目录不存在');
    expect(probe.problems.join()).toContain('Python 解释器不可用');
    expect(probe.problems.join()).toContain('ffmpeg 不可用');
  });
});
