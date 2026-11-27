// 24私助's block on the host's Plugins page (#309), end to end on a real
// Host: the block is registered under the plugin's package name, registering
// it reads no platform, and the one operation the page can start is the
// owner's read-only check, which reaches the switched-on channel through the
// CLI the plugin runs. The page itself is a browser surface; what it draws
// from this block is covered by the block's unit tests and a screenshot
// walk-through, not here.
import { afterAll, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

const key = '@benz-ai-x/dsh-24pa';
let root, host, llm, larkState;

afterAll(async () => { await host?.stop(); await llm?.close(); if (root) await rm(root, { recursive: true, force: true }); });
/** Every run of the lark-cli stand-in. */
const calls = async () => (await readFile(`${larkState}.calls.jsonl`, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);

describe('接入状态进宿主插件页', () => {
  it('区块按24私助的包名登记，登记本身不读平台；页面能发起的只有只读检查，它读到的是已启用的渠道', async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-access-account-'));
    const workspace = join(root, 'workspace'); await mkdir(workspace);
    await writeFile(join(workspace, 'AGENTS.md'), '# 插件页接入状态\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu',
      ownerOpenId: 'ou_page_owner', folderToken: 'fixture-folder', tasklistId: 'fixture-list' }) + '\n```\n');
    const scriptPath = join(root, 'script.json');
    await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到。' }] }));
    llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json') });
    larkState = join(root, 'lark.json'); await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_page_owner', appId: 'cli_page_app' }));
    // The stand-in is on PATH, so the fixture names it in the plugin row.
    const bin = join(root, 'bin'); await mkdir(bin);
    await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(larkState) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n', { mode: 0o755 });
    await chmod(join(bin, 'lark-cli'), 0o755);
    host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_page_app', PA24_FEISHU_APP_SECRET: 'page-secret',
      DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, PATH: `${bin}${delimiter}${process.env.PATH}` } });
    await host.waitUntil(row => row.transport?.connected === true && !!row.workspace?.localSessionId, { label: '工作区就绪' });
    // Starting the Host and registering the block read no platform.
    expect(await calls()).toEqual([]);
    expect((await host.api('snapshot')).diagnostics?.checkedAt ?? null).toBeNull();
    // The registry refuses for this block any operation but the read-only check.
    await expect(host.remote('connectorAccounts/start', { key, operation: 'sign-out' })).rejects.toThrow(/has no page operation/);
    // The page's check is the owner's: it reaches the Feishu channel through the CLI the plugin runs.
    const started = await host.remote('connectorAccounts/start', { key, operation: 'inspect' });
    expect(started).toMatch(/^[0-9a-f-]{36}$/);
    const snapshot = await host.waitUntil(row => !!row.diagnostics?.checkedAt, { label: '页面发起的只读检查' });
    expect(snapshot.diagnostics.auth.state).toBe('ok');
    const journal = await calls();
    expect(journal.length).toBeGreaterThan(0);
    expect(JSON.stringify(journal)).toContain('auth');
  }, 300000);
});
