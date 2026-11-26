// #306 on the runtime: on a host line that ships the official connectors, a
// channel is refused while no CLI is supplied for it — the Feishu channel, a
// Feishu or WeCom source, a WeCom push — readiness and the access checks say
// how to supply it, and a supplied CLI is the one that runs. The installed
// layout is a fake; the executables standing in for the vendor CLIs are the
// test stubs, and the one PATH lookup runs with PATH replaced by a temporary
// directory, so nothing real is run.
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fixture } from '../helpers/runtime.mjs';
import { CliUnavailableError } from '../../lib/cli-source.js';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const stubs = [
  { name: 'lark', connector: '@deepseek-ai/dsh-feishu', dependencies: ['@larksuite/cli'], cliPackage: '@larksuite/cli', stub: 'tests/helpers/stub-lark-cli.mjs', variable: 'PA24_LARK_STUB_STATE' },
  { name: 'wecom', connector: '@deepseek-ai/dsh-wecom', dependencies: ['@wecom/cli', `@wecom/cli-${process.platform}-${process.arch}`], cliPackage: `@wecom/cli-${process.platform}-${process.arch}`, stub: 'tests/helpers/stub-wecom-cli.mjs', variable: 'PA24_WECOM_STUB_STATE' },
];
const source = (id, domain, platform) => ({ id, domain, platform, name: `${platform} ${domain}`, purpose: 'personal', ownerId: platform === 'feishu' ? 'owner' : '',
  resourceKind: platform === 'feishu' ? (domain === 'calendar' ? 'calendar' : 'tasklist') : 'authorized_scope', resourceId: platform === 'feishu' ? (domain === 'calendar' ? 'personal-cal' : 'personal-list') : 'authorized', filter: 'all', access: 'readwrite', enabled: true });
const readinessItem = (rt, id) => rt.readiness().items.find(row => row.id === id);

/** A host line that ships the official connectors; `connect` says whether their packages are installed, `config` the workspace. */
async function connectorLine({ connect = true, config = {} } = {}) {
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
      await mkdir(join(f.root, pkg), { recursive: true }); await writeFile(manifest, JSON.stringify(pkg === connector ? { version: '0.2.3-alpha.2' } : {}));
      packages.set(pkg, manifest);
    }
    const state = join(f.root, `${name}.json`);
    await writeFile(state, JSON.stringify({ ownerOpenId: 'owner', appId: 'cli_test_app' }));
    const executable = join(f.root, cliPackage, 'bin', `${name}-cli`);
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(executable, '#!/usr/bin/env node\nprocess.env.' + variable + '=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve(stub)) + ');\n', { mode: 0o755 });
    await chmod(executable, 0o755);
    executables[name] = executable;
  }
  f.options.cliResolver = name => packages.get(name) ?? null;
  const path = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list', ...config });
  return { ...f, path, executables };
}

describe('官方连接器宿主线上的 CLI 供给', () => {
  it('连接器装好时，两项 CLI 都取自连接器，飞书接入照常启动；就绪报告报出连接器版本', async () => {
    const { make, path, executables } = await connectorLine();
    const rt = make(); await rt.bind(path);
    expect(rt.transport?.name).toBe('fake');
    expect(rt.vendorClis.get('lark')).toBe(executables.lark);
    expect(rt.vendorClis.get('wecom')).toBe(executables.wecom);
    const item = readinessItem(rt, 'vendor-cli');
    expect(item.state).toBe('ok');
    expect(item.message).toContain(`lark-cli：官方连接器提供（@deepseek-ai/dsh-feishu@0.2.3-alpha.2，${executables.lark}）`);
    expect(item.message).toContain(`wecom-cli：官方连接器提供（@deepseek-ai/dsh-wecom@0.2.3-alpha.2，${executables.wecom}）`);
    expect(readinessItem(rt, 'host').message).toContain('官方连接器 @deepseek-ai/dsh-feishu@0.2.3-alpha.2、@deepseek-ai/dsh-wecom@0.2.3-alpha.2');
    const access = await rt.checkAccess();
    expect(access.cli).toMatchObject({ state: 'ok', source: 'official', path: executables.lark, connector: '@deepseek-ai/dsh-feishu@0.2.3-alpha.2' });
    expect(access.auth.state).toBe('ok');
    expect((await rt.wecomCheck()).cli).toMatchObject({ state: 'ok', source: 'official' });
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
    // The message names its own CLI; the readiness does not say the name twice.
    expect(item.message).toContain('需要官方飞书插件提供的 lark-cli');
    expect(item.message).not.toContain('lark-cli：需要官方飞书插件');
    expect(item.message).toContain('wecom-cli：当前配置不会调用它，官方插件与插件行均未提供');
    expect(readinessItem(rt, 'host').message).toContain('官方连接器 未安装');
    // The access check reports the cause without starting a process, and the cause is its only next step.
    const access = await rt.checkAccess();
    expect(access.cli.state).toBe('error');
    expect(access.nextSteps).toEqual([access.cli.message]);
    expect(access.cli.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-feishu');
    const wecom = await rt.wecomCheck();
    expect(wecom.cli.state).toBe('error');
    expect(wecom.nextSteps[0]).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-wecom');
    expect(() => rt.vendorClis.get('lark')).toThrow(CliUnavailableError);
    expect(() => rt.vendorClis.get('wecom')).toThrow(/未安装官方企业微信插件/);
  });

  it('插件行显式给出的路径优先于连接器，运行时建立后再设也生效', async () => {
    const { make, path, options, root } = await connectorLine({ connect: false });
    const rt = make();
    const standalone = join(root, 'standalone-lark');
    await writeFile(standalone, '#!/usr/bin/env node\n', { mode: 0o755 }); await chmod(standalone, 0o755);
    options.larkCliBin = standalone;
    await rt.bind(path);
    expect(rt.vendorClis.get('lark')).toBe(standalone);
    expect(rt.transport?.name).toBe('fake');
    const item = readinessItem(rt, 'vendor-cli');
    expect(item.message).toContain(`lark-cli：插件行显式配置（${standalone}）`);
    // WeCom is neither configured nor installed, and this workspace does not call it.
    expect(item.message).toContain('wecom-cli：当前配置不会调用它');
    expect(item.state).toBe('ok');
  });

  it('插件行留着的裸名或相对路径在连接器宿主上被拒绝，不会绕过连接器去 PATH 或当前目录找', async () => {
    // A profile that keeps `larkCliBin: lark-cli` from before the connectors existed.
    for (const left of ['lark-cli', './lark-cli']) {
      const { make, path, options } = await connectorLine();
      options.larkCliBin = left;
      const rt = make(); await rt.bind(path);
      expect(rt.transport).toBeNull();
      const item = readinessItem(rt, 'vendor-cli');
      expect(item.state).toBe('error');
      for (const anchor of [`插件行配置的 lark-cli 不是绝对路径（${left}）`, '请删除这一项']) expect(item.message).toContain(anchor);
    }
  });

  it('插件行指向跑不起来的路径时飞书接入不启动，readiness 与接入检查说出同一句原因', async () => {
    const { make, path, options, root, executables } = await connectorLine();
    options.larkCliBin = join(root, 'no-such-lark-cli');
    const rt = make(); await rt.bind(path);
    // As when the connector's CLI is missing: every Feishu business action runs lark-cli.
    expect(rt.transport).toBeNull();
    const why = `插件行配置的 lark-cli 不可执行（${join(root, 'no-such-lark-cli')}）`;
    const said = `${why}；请核对24私助插件行的 larkCliBin；要用官方插件托管的，请删除插件行的这一项`;
    const item = readinessItem(rt, 'vendor-cli');
    expect(item.state).toBe('error');
    expect(item.message).toBe(`${said}；wecom-cli：官方连接器提供（@deepseek-ai/dsh-wecom@0.2.3-alpha.2，${executables.wecom}）`);
    expect(rt.snapshot().transport.message).toBe(`飞书接入未启动：${said}`);
    // The channel's own readiness item calls it the fault it is, as it does a missing connector CLI.
    expect(readinessItem(rt, 'feishu').state).toBe('error');
    // The access check says the same, minus the way back to the connector, which only the host line knows.
    const access = await rt.checkAccess();
    expect(access.cli).toMatchObject({ state: 'error', message: `${why}；请核对24私助插件行的 larkCliBin` });
  });

  it('体验模式下插件行路径跑不起来不启动任何接入，也只是说明', async () => {
    const { make, path, options, root, executables } = await connectorLine({ config: { mode: 'demo' } });
    options.larkCliBin = join(root, 'no-such-lark-cli');
    const rt = make(); await rt.bind(path);
    expect(rt.transport).toBeNull();
    const item = readinessItem(rt, 'vendor-cli');
    expect(item.state).toBe('info');
    expect(item.message).toContain(`lark-cli：体验模式未启用飞书接入；登记飞书来源或切换到飞书模式前，需处理：插件行配置的 lark-cli 不可执行（${join(root, 'no-such-lark-cli')}）`);
    expect(item.message).toContain(`wecom-cli：官方连接器提供（@deepseek-ai/dsh-wecom@0.2.3-alpha.2，${executables.wecom}）`);
  });

  it('登记了飞书来源或企微来源：没有对应 CLI 时来源检查不通过，证据里带着安装命令', async () => {
    const sources = { version: 1, entries: [source('personal-calendar', 'calendar', 'feishu'), source('wecom-todo', 'todo', 'wecom')],
      defaults: { calendar: 'personal-calendar', todo: 'wecom-todo' }, mappings: [], meetingDurationMinutes: 30 };
    const { make, path } = await connectorLine({ connect: false, config: { sources } });
    const rt = make(); await rt.bind(path);
    const item = readinessItem(rt, 'vendor-cli');
    expect(item.state).toBe('error');
    expect(item.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-feishu');
    expect(item.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-wecom');
    for (const [id, connector] of [['personal-calendar', 'dsh-feishu'], ['wecom-todo', 'dsh-wecom']]) {
      const listed = await rt.checkSource({ sourceId: id, workspaceBinding: rt.workspaceBinding });
      const entry = listed.entries.find(row => row.id === id);
      expect(entry.evidence.state).toBe('failed');
      expect(entry.evidence.message).toContain(`dsh plugin --profile pa24-test add @deepseek-ai/${connector}`);
    }
  });

  it('显式登记了来源、旧式渠道又选了企微：没有 wecom-cli 时 readiness 仍报错', async () => {
    // Reminders without a bound target and the projections still follow the legacy selectors.
    const sources = { version: 1, entries: [source('personal-calendar', 'calendar', 'feishu'), source('personal-todo', 'todo', 'feishu')],
      defaults: { calendar: 'personal-calendar', todo: 'personal-todo' }, mappings: [], meetingDurationMinutes: 30 };
    const { make, path } = await connectorLine({ connect: false, config: { sources, todoChannel: 'wecom' } });
    const rt = make(); await rt.bind(path);
    const item = readinessItem(rt, 'vendor-cli');
    expect(item.state).toBe('error');
    expect(item.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-wecom');
  });

  it('企微推送：没有 wecom-cli 时每次都报安装命令，不被解析失败的退避盖住', async () => {
    const { make, path } = await connectorLine({ connect: false, config: { mode: 'demo', notifyChannel: 'wecom' } });
    const rt = make(); await rt.bind(path);
    const check = await rt.wecomCheck();
    expect(check.cli.state).toBe('error');
    expect(check.cli.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-wecom');
    const refused = await rt.wecomChannels.wecomOwnerUserid().catch(error => error);
    expect(refused).toBeInstanceOf(CliUnavailableError);
    expect(refused.message).toContain('dsh plugin --profile pa24-test add @deepseek-ai/dsh-wecom');
    // Within the minute in which a failed lookup is not repeated, the cause is still the one said.
    expect(await rt.wecomChannels.wecomOwnerUserid().catch(error => error.message)).toBe(refused.message);
    expect(readinessItem(rt, 'vendor-cli').state).toBe('error');
  });

  it('体验模式不调用 lark-cli：缺它只是提示，不是故障', async () => {
    const { make, path } = await connectorLine({ connect: false, config: { mode: 'demo' } });
    const rt = make(); await rt.bind(path);
    const item = readinessItem(rt, 'vendor-cli');
    expect(item.state).toBe('info');
    expect(item.message).toContain('lark-cli：体验模式未启用飞书接入；登记飞书来源或切换到飞书模式前，需安装官方飞书插件');
  });
});

describe('没有官方连接器的宿主线', () => {
  it('插件行没给值就没有 CLI，运行时不会自己去 PATH 上找', async () => {
    const f = await fixture(); cleanup.push(() => f.cleanup());
    delete f.options.larkCliBin; delete f.options.wecomCliBin;
    expect(() => f.rt.vendorClis.get('lark')).toThrow(/未设置 lark-cli/);
    expect(() => f.rt.vendorClis.get('wecom')).toThrow(/未设置 wecom-cli/);
    f.options.larkCliBin = 'lark-cli'; f.options.wecomCliBin = 'wecom-cli';
    expect(f.rt.vendorClis.get('lark')).toBe('lark-cli');
    expect(f.rt.vendorClis.get('wecom')).toBe('wecom-cli');
    // That line has no connectors to report.
    expect(readinessItem(f.rt, 'host').message).not.toContain('官方连接器');
  });

  it('插件行的裸名由 PATH 解析：PATH 上是替身，跑的就是替身', async () => {
    const f = await fixture(); cleanup.push(() => f.cleanup());
    const dir = await mkdtemp(join(tmpdir(), 'pa24-vendor-path-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const state = join(f.root, 'lark.json');
    await writeFile(state, JSON.stringify({ ownerOpenId: 'owner', appId: 'cli_test_app' }));
    await writeFile(join(dir, 'lark-cli'), '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n', { mode: 0o755 });
    await chmod(join(dir, 'lark-cli'), 0o755);
    // PATH holds the stand-in's directory and Node's own for the duration of the test.
    const saved = process.env.PATH;
    process.env.PATH = `${dir}${delimiter}${dirname(process.execPath)}`;
    try {
      Object.assign(f.options, { larkCliBin: 'lark-cli', wecomCliBin: 'wecom-cli' });
      const path = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' });
      const rt = f.make(); await rt.bind(path);
      expect(rt.vendorClis.get('lark')).toBe('lark-cli');
      const item = readinessItem(rt, 'vendor-cli');
      expect(item.state).toBe('ok');
      expect(item.message).toContain('lark-cli：PATH 上的可执行文件（lark-cli）');
      expect(item.message).toContain('wecom-cli：当前配置不会调用它；PATH 上找不到 wecom-cli');
      const access = await rt.checkAccess();
      expect(access.cli).toMatchObject({ state: 'ok', source: 'path', path: 'lark-cli' });
      expect(access.auth.state).toBe('ok');
    } finally { process.env.PATH = saved; }
  });
});
