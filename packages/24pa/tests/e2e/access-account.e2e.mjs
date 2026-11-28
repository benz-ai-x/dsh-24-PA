// 24PA's block on the host's Plugins page (#309), end to end on a real
// Host: the block is registered under the plugin's package name, registering
// it reads no platform, and the one operation the page can start is the
// owner's read-only check, which reaches the switched-on channel through the
// CLI the plugin runs. Disabling the plugin withdraws the block. A second
// instance does the same on a profile with the official Feishu connector
// installed, where the CLI is the connector's to supply; it runs only when
// PA24_E2E_OFFICIAL_CONNECTORS names the connectors' version. The page itself
// is a browser surface; what it draws from this block is covered by the
// block's unit tests and a screenshot walk-through, not here.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { writeStandIn } from '../helpers/stub-cli.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { PA24_PACKAGE_NAME } from '../../lib/connector-account.js';

const key = PA24_PACKAGE_NAME;
const connectors = process.env.PA24_E2E_OFFICIAL_CONNECTORS;
const larkStub = resolve('tests/helpers/stub-lark-cli.mjs');
const instances = [];
afterAll(async () => {
  for (const instance of instances.reverse()) {
    await instance.host?.stop(); await instance.llm?.close();
    if (instance.root) await rm(instance.root, { recursive: true, force: true });
  }
});

/** Poll `read` until it returns a value; a Host that is reloading its plugins answers nothing, which is not a failure here. */
async function until(read, label, host) {
  for (let index = 0; index < 240; index++) {
    const found = await read().catch(() => undefined);
    if (found !== undefined) return found;
    await delay(250);
  }
  throw new Error(`等待${label}超时\n${JSON.stringify(host.logs()).slice(-3000)}`);
}

/** A workspace in Feishu mode, a model script and the stand-in's state; the instance's Host is booted by the test. */
async function fixture(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const instance = { root, workspace: join(root, 'workspace'), larkState: join(root, 'lark.json') };
  instances.push(instance);
  await mkdir(instance.workspace);
  await writeFile(join(instance.workspace, 'AGENTS.md'), '# 插件页接入状态\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu',
    ownerOpenId: 'ou_page_owner', folderToken: 'fixture-folder', tasklistId: 'fixture-list' }) + '\n```\n');
  const scriptPath = join(root, 'script.json');
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到。' }] }));
  instance.llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json') });
  await writeFile(instance.larkState, JSON.stringify({ ownerOpenId: 'ou_page_owner', appId: 'cli_page_app' }));
  return instance;
}
/** Every run of the lark-cli stand-in. */
const calls = async instance => (await readFile(`${instance.larkState}.calls.jsonl`, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
/** The page's check, started as the page starts it, through to the stored result. */
const inspected = async instance => {
  expect(await instance.host.remote('connectorAccounts/start', { key, operation: 'inspect' })).toMatch(/^[0-9a-f-]{36}$/);
  return instance.host.waitUntil(row => !!row.diagnostics?.checkedAt, { label: '页面发起的只读检查' });
};

describe('接入状态进宿主插件页', () => {
  it('区块按24私助的包名登记，登记本身不读平台；页面能发起的只有只读检查，它读到的是已启用的渠道', async () => {
    const instance = await fixture('pa24-access-account-');
    // The stand-in is on PATH, so the fixture names it in the plugin row.
    const bin = join(instance.root, 'bin'); await mkdir(bin);
    await writeStandIn(bin, 'lark', instance.larkState);
    const host = instance.host = await bootHost({ env: { PA24_WORKSPACE: instance.workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_page_app', PA24_FEISHU_APP_SECRET: 'page-secret',
      DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: instance.llm.url, PATH: `${bin}${delimiter}${process.env.PATH}` } });
    await host.waitUntil(row => row.transport?.connected === true && !!row.workspace?.localSessionId, { label: '工作区就绪' });
    // Starting the Host and registering the block read no platform.
    expect(await calls(instance)).toEqual([]);
    expect((await host.api('snapshot')).diagnostics?.checkedAt ?? null).toBeNull();
    // The registry refuses for this block any operation but the read-only check.
    // (The refusal's wording is the host's own, and is not pinned here.)
    await expect(host.remote('connectorAccounts/start', { key, operation: 'sign-out' })).rejects.toThrow();
    // The page's check is the owner's: it reaches the Feishu channel through the CLI the plugin runs.
    expect((await inspected(instance)).diagnostics.auth.state).toBe('ok');
    const journal = await calls(instance);
    expect(journal.length).toBeGreaterThan(0);
    expect(JSON.stringify(journal)).toContain('auth');
  }, 300000);

  it('主人停用24私助后区块随之撤下，页面的检查被拒；重新启用后区块回来，检查又能发起', async () => {
    const instance = await fixture('pa24-access-account-toggle-');
    const bin = join(instance.root, 'bin'); await mkdir(bin);
    await writeStandIn(bin, 'lark', instance.larkState);
    const host = instance.host = await bootHost({ env: { PA24_WORKSPACE: instance.workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_page_app', PA24_FEISHU_APP_SECRET: 'page-secret',
      DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: instance.llm.url, PATH: `${bin}${delimiter}${process.env.PATH}` } });
    await host.waitUntil(row => row.transport?.connected === true && !!row.workspace?.localSessionId, { label: '工作区就绪' });
    await host.remote('pluginManager/setBundleEnabled', { name: key, enabled: false });
    // The operation the page could start a moment ago is now refused: the block is no longer registered.
    // (The refusal's wording is the host's own, and is not pinned here.)
    await expect(host.remote('connectorAccounts/start', { key, operation: 'inspect' })).rejects.toThrow();
    await host.remote('pluginManager/setBundleEnabled', { name: key, enabled: true });
    await until(() => host.api('snapshot').then(row => row.transport?.connected === true && !!row.workspace?.localSessionId ? true : undefined), '重新启用后的工作区', host);
    expect((await inspected(instance)).diagnostics.auth.state).toBe('ok');
  }, 300000);
});

describe.skipIf(!connectors)('装了官方飞书连接器的 profile', () => {
  it('24私助的行不写 CLI：区块照常登记，页面发起的检查经连接器供给的 lark-cli 读到飞书', async () => {
    const instance = await fixture('pa24-access-account-connectors-');
    // The connector's executable comes from an install script the fixture ignores: a stand-in takes its place where the
    // connector's row looks for it. A rename replaces the hard-linked file rather than the store's copy.
    const standIn = async file => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.stand-in`, '#!/usr/bin/env node\nawait import(' + JSON.stringify(larkStub) + ');\n', { mode: 0o755 });
      await rename(`${file}.stand-in`, file);
    };
    const host = instance.host = await bootHost({
      env: { PA24_WORKSPACE: instance.workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_page_app', PA24_FEISHU_APP_SECRET: 'page-secret', PA24_LARK_STUB_STATE: instance.larkState,
        DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: instance.llm.url, npm_config_registry: 'https://registry.npmjs.org' },
      extraPlugins: [`@deepseek-ai/dsh-feishu@${connectors}`],
      // The plugin row names no CLI: the connector's executable has to be the one found.
      vendorClis: false,
      async beforeBoot({ profile }) { await standIn(join(profile, 'node_modules/@larksuite/cli/bin/lark-cli')); },
    });
    await host.waitUntil(row => row.transport?.connected === true && !!row.workspace?.localSessionId, { label: '工作区就绪', timeoutMs: 180000 });
    const { stdout, stderr } = host.logs();
    expect(stdout + stderr).not.toMatch(/did not activate/);
    // Registering the block read no platform; the page's check reaches Feishu through the connector's CLI.
    expect(await calls(instance)).toEqual([]);
    const { diagnostics } = await inspected(instance);
    expect(diagnostics.cli).toMatchObject({ state: 'ok', source: 'official', connector: `@deepseek-ai/dsh-feishu@${connectors}` });
    expect(diagnostics.auth.state).toBe('ok');
  }, 600000);
});
