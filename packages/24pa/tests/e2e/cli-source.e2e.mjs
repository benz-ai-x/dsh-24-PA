// How the vendor CLIs are supplied, end to end (#306): a host of the
// 0.2.3-alpha.2 line, whose base bundle mounts the CLI account service, in an
// instance that installs no official connector. Real Loader and Host, SQLite,
// scripted model. Nothing here comes from the registry, so the file runs with
// the rest of the suite; the plugin's engines pin it to that host line.
import { afterAll, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

const larkStub = resolve('tests/helpers/stub-lark-cli.mjs');
const roots = [], hosts = [], llms = [];
afterAll(async () => {
  for (const host of hosts.splice(0)) await host.stop();
  for (const llm of llms.splice(0)) await llm.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** A Feishu-mode workspace and its model; `boot` starts the Host for it. */
async function instance() {
  const root = await mkdtemp(join(tmpdir(), 'pa24-cli-source-')); roots.push(root);
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), '# CLI 供给验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu',
    ownerOpenId: 'ou_cli_owner', folderToken: 'fixture-folder', tasklistId: 'fixture-list' }) + '\n```\n');
  const scriptPath = join(root, 'script.json');
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '已收到。' }] }));
  const llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json') }); llms.push(llm);
  const env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_source_app', PA24_FEISHU_APP_SECRET: 'cli-source-secret',
    DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url };
  const boot = async ({ env: extra = {}, ...options } = {}) => {
    const host = await bootHost({ ...options, env: { ...env, ...extra } }); hosts.push(host);
    return host;
  };
  const ready = (host, label) => host.waitUntil(row => !!row.workspace?.localSessionId, { label })
    .catch(error => { throw new Error(`${error.message}\n${JSON.stringify(host.logs()).slice(-2500)}`); });
  return { root, env, boot, ready };
}
const item = (snapshot, id) => snapshot.readiness.items.find(row => row.id === id);
const install = 'dsh plugin --profile pa24-test add @deepseek-ai/dsh-feishu';

describe('官方连接器宿主线上不装连接器的实例', () => {
  it('插件行什么都没给：飞书模式拒绝激活，readiness 与接入检查报出安装命令，宿主行报未安装', async () => {
    const test = await instance();
    const host = await test.boot({ vendorClis: false });
    const snapshot = await test.ready(host, '工作区就绪');
    expect(snapshot.transport.connected).toBe(false);
    expect(snapshot.transport.message).toContain('需要官方飞书插件提供的 lark-cli');
    expect(snapshot.transport.message).toContain(install);
    expect(item(snapshot, 'feishu').state).toBe('error');
    expect(item(snapshot, 'vendor-cli').state).toBe('error');
    expect(item(snapshot, 'vendor-cli').message).toContain(install);
    expect(item(snapshot, 'host').message).toContain('官方连接器 未安装');
    // The access check says the same and starts no process.
    const access = await host.api('action', { type: 'connection.check' });
    expect(access.cli.state).toBe('error');
    expect(access.cli.message).toContain(install);
  }, 300000);

  it('夹具的缺省：插件行写的是不存在的文件而不是裸名，机器 PATH 上的 CLI 到不了插件', async () => {
    const test = await instance();
    const host = await test.boot();
    const snapshot = await test.ready(host, '工作区就绪');
    // The Host's own root, where the fixture puts what does not exist; the workspace's root is another directory.
    const missing = join(host.root, 'no-vendor-cli', 'lark-cli');
    expect(item(snapshot, 'vendor-cli').state).toBe('error');
    expect(item(snapshot, 'vendor-cli').message).toContain(`插件行配置的 lark-cli 不可执行（${missing}）`);
    const patch = await readFile(join(host.root, 'home/profiles/pa24-test/cordis.patch.yml'), 'utf8');
    expect(patch).toContain(`larkCliBin: ${JSON.stringify(missing)}`);
    expect(patch).toContain(`wecomCliBin: ${JSON.stringify(join(host.root, 'no-vendor-cli', 'wecom-cli'))}`);
  }, 300000);

  it('插件行给出 larkCliBin 后恢复：PATH 上的替身由夹具写进插件行，接入照常启动', async () => {
    const test = await instance();
    const bin = join(test.root, 'bin'); await mkdir(bin);
    const state = join(test.root, 'lark.json');
    await writeFile(state, JSON.stringify({ ownerOpenId: 'ou_cli_owner', appId: 'cli_source_app' }));
    await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(larkStub) + ');\n', { mode: 0o755 });
    await chmod(join(bin, 'lark-cli'), 0o755);
    const host = await test.boot({ env: { PATH: `${bin}${delimiter}${process.env.PATH}` } });
    const current = await host.waitUntil(row => row.transport?.connected === true && !!row.workspace?.localSessionId, { label: '显式给出 lark-cli 后的飞书接入' })
      .catch(error => { throw new Error(`${error.message}\n${JSON.stringify(host.logs()).slice(-2500)}`); });
    expect(current.transport.connected).toBe(true);
    expect(item(current, 'vendor-cli').state).toBe('ok');
    expect(item(current, 'vendor-cli').message).toContain(`lark-cli：插件行显式配置（${join(bin, 'lark-cli')}）`);
    const access = await host.api('action', { type: 'connection.check' });
    expect(access.cli).toMatchObject({ state: 'ok', source: 'config' });
  }, 300000);

  it('升级后的 profile 补丁层留着旧值 larkCliBin: lark-cli：被拒绝，不会绕过连接器去 PATH 上找', async () => {
    const test = await instance();
    // Before the connectors existed the preset's patch layer carried that line.
    const host = await test.boot({ vendorClis: { larkCliBin: 'lark-cli' } });
    const snapshot = await test.ready(host, '工作区就绪');
    expect(snapshot.transport.connected).toBe(false);
    expect(item(snapshot, 'vendor-cli').state).toBe('error');
    for (const anchor of ['插件行配置的 lark-cli 不是路径（lark-cli）', '请删除这一项']) expect(item(snapshot, 'vendor-cli').message).toContain(anchor);
  }, 300000);
});
