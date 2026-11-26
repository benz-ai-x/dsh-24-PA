// 24私助's CLI child processes start through the host's subprocess service
// (#310), end to end on a real Host. A stand-in for lark-cli writes down what
// its process sees of the environment: through the service it gets the
// environment the host hands its children, which carries no credential-shaped
// name such as the host's own model key, and still carries what the test
// passes under an ordinary name. A process of the plugin's own would have
// inherited both.
import { afterAll, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

const cleanup = [];
afterAll(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

describe('CLI 子进程经宿主子进程服务启动', () => {
  it('接入检查跑到的 lark-cli 是宿主起的：看不到宿主的模型密钥，看得到普通名字的变量', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pa24-cli-subprocess-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const workspace = join(root, 'workspace'); await mkdir(workspace);
    await writeFile(join(workspace, 'AGENTS.md'), '# 子进程服务\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu',
      ownerOpenId: 'ou_subprocess_owner', folderToken: 'fixture-folder', tasklistId: 'fixture-list' }) + '\n```\n');
    const scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到。' }] }));
    const llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json') }); cleanup.push(() => llm.close());
    // The stand-in notes its environment, then is the usual stub.
    const larkState = join(root, 'lark.json'), seen = join(root, 'seen.jsonl'), bin = join(root, 'bin');
    await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_subprocess_owner', appId: 'cli_subprocess_app' })); await mkdir(bin);
    await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\n'
      + 'import { appendFileSync } from "node:fs";\n'
      + 'appendFileSync(process.env.PA24_ENV_SEEN, JSON.stringify({ modelKey: process.env.DEEPSEEK_API_KEY ?? null, dshKeys: Object.keys(process.env).filter(name => name.startsWith("DSH_")), stubState: process.env.PA24_LARK_STUB_STATE ?? null, home: process.env.HOME ?? null }) + "\\n");\n'
      + `await import(${JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs'))});\n`, { mode: 0o755 });
    await chmod(join(bin, 'lark-cli'), 0o755);
    const host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_subprocess_app', PA24_FEISHU_APP_SECRET: 'subprocess-secret',
      PA24_LARK_STUB_STATE: larkState, PA24_ENV_SEEN: seen, DEEPSEEK_API_KEY: 'host-model-key', DEEPSEEK_BASE_URL: llm.url, PATH: `${bin}${delimiter}${process.env.PATH}` } });
    cleanup.push(() => host.stop());
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
});
