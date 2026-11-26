// #306 on the runtime: on a host line that ships the official connectors, the
// Feishu channel is refused while no lark-cli is supplied, readiness and the
// access checks say how to supply it, and a supplied CLI is the one that runs.
// The installed layout is a fake; the executables standing in for the vendor
// CLIs are the test stubs, so nothing real is run.
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fixture } from '../helpers/runtime.mjs';
import { CliUnavailableError } from '../../lib/cli-source.js';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const stubs = [
  { name: 'lark', connector: '@deepseek-ai/dsh-feishu', dependencies: ['@larksuite/cli'], cliPackage: '@larksuite/cli', stub: 'tests/helpers/stub-lark-cli.mjs', variable: 'PA24_LARK_STUB_STATE' },
  { name: 'wecom', connector: '@deepseek-ai/dsh-wecom', dependencies: ['@wecom/cli', `@wecom/cli-${process.platform}-${process.arch}`], cliPackage: `@wecom/cli-${process.platform}-${process.arch}`, stub: 'tests/helpers/stub-wecom-cli.mjs', variable: 'PA24_WECOM_STUB_STATE' },
];

/** A host line that ships the official connectors; `connect` says whether their packages are installed. */
async function connectorLine({ connect = true } = {}) {
  const f = await fixture();
  cleanup.push(() => f.cleanup());
  const get = f.ctx.get;
  f.ctx.get = name => name === 'cliAccounts' ? {} : name === 'profileContext' ? { name: 'pa24-test', dir: join(f.root, 'profile') } : get(name);
  delete f.options.larkCliBin; delete f.options.wecomCliBin;
  Object.assign(f.options.env, { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'secret' });
  const packages = new Map(), executables = {};
  for (const { name, connector, dependencies, cliPackage, stub, variable } of connect ? stubs : []) {
    // Each package resolves to its own package.json, as the plugin's lookup expects.
    for (const pkg of [connector, ...dependencies]) {
      const manifest = join(f.root, pkg, 'package.json');
      await mkdir(join(f.root, pkg), { recursive: true }); await writeFile(manifest, '{}');
      packages.set(pkg, manifest);
    }
    const state = join(f.root, `${name}.json`);
    await writeFile(state, JSON.stringify({ ownerOpenId: 'owner', appId: 'cli_test_app' }));
    const executable = join(f.root, cliPackage, 'bin', `${name}-cli`);
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(executable, '#!/usr/bin/env node\nprocess.env.' + variable + '=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve(stub)) + ');\n', { mode: 0o755 });
    await chmod(executable, 0o755);
    executables[name] = await realpath(executable);
  }
  f.options.cliResolver = name => packages.get(name) ?? null;
  const path = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' });
  return { ...f, path, executables };
}

describe('官方连接器宿主线上的 CLI 供给', () => {
  it('连接器装好时，两项 CLI 都取自连接器，飞书接入照常启动', async () => {
    const { make, path, executables } = await connectorLine();
    const rt = make(); await rt.bind(path);
    expect(rt.transport?.name).toBe('fake');
    expect(rt.larkCliBin).toBe(executables.lark);
    expect(rt.wecomCliBin).toBe(executables.wecom);
    const item = rt.readiness().items.find(row => row.id === 'vendor-cli');
    expect(item.state).toBe('ok');
    expect(item.message).toContain(`lark-cli：官方连接器提供（${executables.lark}）`);
    expect(item.message).toContain(`wecom-cli：官方连接器提供（${executables.wecom}）`);
    const access = await rt.checkAccess();
    expect(access.cli).toMatchObject({ state: 'ok', source: 'official', path: executables.lark });
    expect(access.auth.state).toBe('ok');
  });

  it('没装连接器时飞书接入不启动，readiness 与接入检查给出安装命令', async () => {
    const { make, path } = await connectorLine({ connect: false });
    const rt = make(); await rt.bind(path);
    expect(rt.transport).toBeNull();
    const snapshot = rt.snapshot();
    expect(snapshot.transport.message).toContain('需要官方飞书插件提供的 lark-cli');
    expect(snapshot.transport.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-feishu');
    expect(snapshot.readiness.items.find(row => row.id === 'feishu').state).toBe('error');
    const item = snapshot.readiness.items.find(row => row.id === 'vendor-cli');
    expect(item.state).toBe('error');
    expect(item.message).toContain('lark-cli：需要官方飞书插件提供的 lark-cli');
    // The access check reports the cause without starting a process, and the cause is its only next step.
    const access = await rt.checkAccess();
    expect(access.cli.state).toBe('error');
    expect(access.nextSteps).toEqual([access.cli.message]);
    expect(access.cli.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-feishu');
    const wecom = await rt.wecomCheck();
    expect(wecom.cli.state).toBe('error');
    expect(wecom.nextSteps[0]).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-wecom');
    expect(() => rt.larkCliBin).toThrow(CliUnavailableError);
    expect(() => rt.wecomCliBin).toThrow(/未安装官方企业微信插件/);
  });

  it('插件行显式给出的路径优先于连接器，运行时建立后再设也生效', async () => {
    const { make, path, options, root } = await connectorLine({ connect: false });
    const rt = make();
    const standalone = join(root, 'standalone-lark');
    await writeFile(standalone, '#!/usr/bin/env node\n', { mode: 0o755 }); await chmod(standalone, 0o755);
    options.larkCliBin = standalone;
    await rt.bind(path);
    expect(rt.larkCliBin).toBe(standalone);
    expect(rt.transport?.name).toBe('fake');
    const item = rt.readiness().items.find(row => row.id === 'vendor-cli');
    expect(item.message).toContain(`lark-cli：插件行显式配置（${standalone}）`);
    // WeCom is neither configured nor installed, and this workspace does not call it.
    expect(item.message).toContain('wecom-cli：当前配置不会调用它');
    expect(item.state).toBe('ok');
  });
});

describe('没有官方连接器的宿主线', () => {
  it('插件行没给值就没有 CLI，运行时不会自己去 PATH 上找', async () => {
    const f = await fixture(); cleanup.push(() => f.cleanup());
    delete f.options.larkCliBin; delete f.options.wecomCliBin;
    expect(() => f.rt.larkCliBin).toThrow(/未设置 lark-cli/);
    expect(() => f.rt.wecomCliBin).toThrow(/未设置 wecom-cli/);
    f.options.larkCliBin = 'lark-cli'; f.options.wecomCliBin = 'wecom-cli';
    expect(f.rt.larkCliBin).toBe('lark-cli');
    expect(f.rt.wecomCliBin).toBe('wecom-cli');
  });
});
