import { describe, expect, it, beforeAll } from 'vitest';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLarkCli, LarkCliError } from '../../lib/lark.js';

const STUB = `
import { readFile, writeFile } from 'node:fs/promises';
const statePath = process.env.PA24_LARK_STUB_STATE;
const args = process.argv.slice(2);
const mode = args.find(a => a.startsWith('--mode='))?.slice(7) ?? 'ok';
const state = JSON.parse(await readFile(statePath, 'utf8'));
state.calls = (state.calls ?? 0) + 1;
await writeFile(statePath, JSON.stringify(state));
if (args.includes('--version')) { console.log('stub 1.0'); process.exit(0); }
if (mode === 'notjson') { console.error('plain text failure'); process.exit(2); }
if (mode === 'rejected') { console.error(JSON.stringify({ ok: false, error: { message: '平台拒绝' } })); process.exit(3); }
if (mode === 'envelope') { console.log(JSON.stringify({ data: {} })); process.exit(0); }
if (mode === 'hang') { setTimeout(() => {}, 60000); }
const stdin = await new Promise(r => { let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => r(d)); process.stdin.on('error', () => r(d)); });
console.log(JSON.stringify({ ok: true, data: { echoed: stdin, calls: state.calls } }));
`;

describe('lark-cli 受控执行', () => {
  let dir, bin, statePath;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pa24-lark-'));
    bin = join(dir, 'lark-cli.mjs');
    await writeFile(bin, `#!/usr/bin/env node\n${STUB}\n`);
    await chmod(bin, 0o755);
    statePath = join(dir, 'state.json');
    await writeFile(statePath, '{}');
  });

  const options = (mode, timeoutMs = 5000) => ({
    bin,
    profile: 'default',
    timeoutMs,
    env: { PA24_LARK_STUB_STATE: statePath },
  });

  it('成功路径：固定 argv + stdin + ok 信封', async () => {
    const { data } = await runLarkCli(options('ok'), ['docs', '+create', '--mode=ok', '--json'], '<p>hello</p>');
    expect(data.echoed).toBe('<p>hello</p>');
  });

  it('非 JSON 输出被拒绝且不当作成功', async () => {
    await expect(runLarkCli(options('notjson'), ['x', '--mode=notjson', '--json'])).rejects.toMatchObject({
      name: 'LarkCliError',
      outcome: 'invalid-envelope',
    });
  });

  it('ok:false 与非零退出码按失败处理', async () => {
    await expect(runLarkCli(options('rejected'), ['x', '--mode=rejected', '--json'])).rejects.toMatchObject({
      name: 'LarkCliError',
      outcome: 'failed',
      message: '平台拒绝',
    });
  });

  it('缺少 ok 字段的信封不受支持', async () => {
    await expect(runLarkCli(options('envelope'), ['x', '--mode=envelope', '--json'])).rejects.toMatchObject({
      outcome: 'invalid-envelope',
    });
  });

  it('超时归类为结果未知，提示先核对再重试', async () => {
    await expect(runLarkCli(options('hang', 800), ['x', '--mode=hang', '--json'])).rejects.toMatchObject({
      outcome: 'unknown',
      message: /核对/,
    });
  });
});
