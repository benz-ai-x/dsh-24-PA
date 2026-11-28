// 24PA's CLI child processes start through the host's subprocess service
// (#310), end to end on a real Host. A stand-in for lark-cli writes down what
// its process sees of the environment: through the service it gets the
// environment the host hands its children, which carries no credential-shaped
// name such as the host's own model key, and still carries what the test
// passes under an ordinary name. A process of the plugin's own would have
// inherited both. A stand-in that never answers is ended by the service,
// with what it started; and the speech readiness probe starts the machine's
// real python and ffmpeg — a smoke test of that path, not proof of who started them.
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

const cleanup = [];
afterAll(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

/** A scratch workspace in Feishu mode, its model, and a Host for it with the environment and PATH stand-in a test names. */
async function feishuHost(root, extra = {}) {
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), '# 子进程服务\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu',
    ownerOpenId: 'ou_subprocess_owner', folderToken: 'fixture-folder', tasklistId: 'fixture-list', ...extra.config }) + '\n```\n');
  const scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到。' }] }));
  const llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json') }); cleanup.push(() => llm.close());
  const host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_subprocess_app', PA24_FEISHU_APP_SECRET: 'subprocess-secret',
    DEEPSEEK_API_KEY: 'host-model-key', DEEPSEEK_BASE_URL: llm.url, ...extra.env } });
  cleanup.push(() => host.stop());
  return host;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('CLI 子进程经宿主子进程服务启动', () => {
  it('接入检查跑到的 lark-cli 是宿主起的：看不到宿主的模型密钥，看得到普通名字的变量', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa24-cli-subprocess-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
    // The stand-in notes its environment, then is the usual stub.
    const larkState = join(root, 'lark.json'), seen = join(root, 'seen.jsonl'), bin = join(root, 'bin');
    await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_subprocess_owner', appId: 'cli_subprocess_app' })); await mkdir(bin);
    await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\n'
      + 'import { appendFileSync } from "node:fs";\n'
      + 'appendFileSync(process.env.PA24_ENV_SEEN, JSON.stringify({ modelKey: process.env.DEEPSEEK_API_KEY ?? null, dshKeys: Object.keys(process.env).filter(name => name.startsWith("DSH_")), stubState: process.env.PA24_LARK_STUB_STATE ?? null, home: process.env.HOME ?? null }) + "\\n");\n'
      + `await import(${JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs'))});\n`, { mode: 0o755 });
    await chmod(join(bin, 'lark-cli'), 0o755);
    const host = await feishuHost(root, { env: { PA24_LARK_STUB_STATE: larkState, PA24_ENV_SEEN: seen, PATH: `${bin}${delimiter}${process.env.PATH}` } });
    await host.waitUntil(row => row.transport?.connected === true && !!row.workspace?.localSessionId, { label: '工作区就绪' });
    const access = await host.api('action', { type: 'connection.check' });
    expect(access.cli.state).toBe('ok');
    const runs = (await readFile(seen, 'utf8')).trim().split('\n').map(JSON.parse);
    expect(runs.length).toBeGreaterThan(1);
    for (const run of runs) {
      expect(run.modelKey).toBeNull();
      expect(run.dshKeys).toEqual([]);
      expect(run.stubState).toBe(larkState);
      expect(run.home).toBe(process.env.HOME);
    }
  }, 300000);

  it('一直不应答的 lark-cli 连同它起的后代，由宿主在检查超时后一并结束', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa24-cli-subprocess-hang-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
    // The stand-in starts a child that ignores TERM and beats a file, notes both pids, never answers, and answers TERM itself at once.
    const bin = join(root, 'bin'); await mkdir(bin);
    const pids = join(root, 'pids.json');
    const child = 'process.on("SIGTERM", () => {}); const { appendFileSync } = require("node:fs"); setInterval(() => appendFileSync(process.env.PA24_PIDS + ".beat", Date.now() + "\\n"), 50);';
    await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\n'
      + 'const { spawn } = require("node:child_process"); const { writeFileSync } = require("node:fs");\n'
      + `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' });\n`
      + 'descendant.on("spawn", () => writeFileSync(process.env.PA24_PIDS, JSON.stringify([process.pid, descendant.pid])));\n'
      + 'setInterval(() => {}, 100);\n', { mode: 0o755 });
    await chmod(join(bin, 'lark-cli'), 0o755);
    // No stand-in for the plugin row this time: the fixture names the one on PATH, and nothing else is needed before the probe.
    const host = await feishuHost(root, { env: { PA24_PIDS: pids, PATH: `${bin}${delimiter}${process.env.PATH}` } });
    await host.waitUntil(row => !!row.workspace?.localSessionId, { label: '工作区就绪' });
    const started = Date.now();
    const access = await host.api('action', { type: 'connection.check' });
    // The version probe gives the CLI five seconds; the call comes back with its reason.
    expect(access.cli.state).toBe('error');
    expect(access.cli.message).toContain('版本检查未完成（timeout）');
    expect(Date.now() - started).toBeLessThan(20000);
    const [leader] = JSON.parse(await readFile(pids, 'utf8'));
    const returnedAt = Date.now();
    // The leader answered TERM at once; the descendant ignored it. The call came back with the descendant no longer running: the service's
    // range covered it, and the call waited for the range to be empty instead of returning when its leader alone had exited. (A process
    // that has just been killed can still be seen for a moment, so what is checked is that it stopped, not that its pid is gone.)
    await new Promise(resolve => setTimeout(resolve, 400));
    const beats = (await readFile(`${pids}.beat`, 'utf8')).trim().split('\n');
    expect(beats.length).toBeGreaterThan(0);
    expect(Number(beats.at(-1))).toBeLessThan(returnedAt + 80);
    for (let index = 0; index < 30 && alive(leader); index++) await new Promise(resolve => setTimeout(resolve, 100));
    expect(alive(leader)).toBe(false);
  }, 300000);

  // Each tool's own way of printing its version; the case is skipped where either tool is not on this machine's PATH.
  it.skipIf(![[ 'python3', '--version' ], ['ffmpeg', '-version']].every(([name, flag]) => spawnSync(name, [flag]).status === 0))('语音就绪预检仍可用：本机真实的 python 与 ffmpeg 都答得上版本', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa24-cli-subprocess-tts-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const meloDir = join(root, 'melo'); await mkdir(meloDir);
    const host = await feishuHost(root, { config: { tts: { engine: 'melo', voice: '', volcKeyEnv: '', meloDir } } });
    await host.waitUntil(row => !!row.workspace?.localSessionId, { label: '工作区就绪' });
    // The probe asks each for its version through the gateway: bare names the host resolves on its PATH.
    const probe = await host.api('action', { type: 'tts.probe' });
    expect(probe).toMatchObject({ engine: 'melo', ready: true, problems: [] });
  }, 300000);
});
