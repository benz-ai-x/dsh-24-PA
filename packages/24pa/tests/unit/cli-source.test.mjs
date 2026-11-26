// #306: how lark-cli and wecom-cli are supplied. The official-connector lookup
// runs against a fake package layout with stand-in executables. No vendor CLI
// is executed, and the one PATH lookup below runs with PATH replaced by a
// temporary directory, so nothing installed on this machine can be reached.
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliUnavailableError, CLI_SOURCE_LABELS, hasOfficialConnectors, runnableAsGiven, VendorClis } from '../../lib/cli-source.js';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

describe('CLI 来源的文字', () => {
  it('readiness 与面板用的是同一组', async () => {
    // The panel runs in the browser and cannot import the plugin's server code; its own table must not drift.
    const client = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
    const literal = /const CLI_SOURCE = (\{[^}]*\});/.exec(client)?.[1];
    expect(literal).toBeTruthy();
    const labels = Object.fromEntries([...literal.matchAll(/(\w+): \['([^']+)'/g)].map(([, key, zh]) => [key, zh]));
    expect(labels).toEqual(CLI_SOURCE_LABELS);
  });
});

/** The packages a connector line installs, as the plugin would resolve them. */
async function installed() {
  const root = await mkdtemp(join(tmpdir(), 'pa24-cli-source-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  // Package names resolve to their package.json, as the plugin's own lookup does.
  const packages = new Map();
  const executable = async (name, mode = 0o755) => {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '#!/bin/sh\n', { mode });
    return path;
  };
  for (const name of ['@deepseek-ai/dsh-feishu', '@deepseek-ai/dsh-wecom', '@larksuite/cli', '@wecom/cli', '@wecom/cli-darwin-arm64']) {
    packages.set(name, await executable(`${name}/package.json`, 0o644));
    await writeFile(packages.get(name), '{}');
  }
  const lark = await executable('@larksuite/cli/bin/lark-cli');
  const wecom = await executable('@wecom/cli-darwin-arm64/bin/wecom-cli');
  return { root, packages, lark, wecom, resolvePackage: name => packages.get(name) ?? null };
}
const connectorLine = (layout, settings = {}) => new VendorClis({ officialConnectors: () => true, profile: 'off', resolvePackage: layout.resolvePackage, ...settings }, { platform: 'darwin', arch: 'arm64' });

describe('宿主是否带官方连接器', () => {
  it('以宿主有没有 CLI 账号服务为准', () => {
    expect(hasOfficialConnectors({ get: name => name === 'cliAccounts' ? {} : null })).toBe(true);
    expect(hasOfficialConnectors({ get: () => null })).toBe(false);
  });

  it('每次查找都问一遍：服务晚到，下一次查找就按带连接器的宿主处理', async () => {
    const layout = await installed();
    let shipped = false;
    const clis = new VendorClis({ officialConnectors: () => shipped, resolvePackage: layout.resolvePackage });
    expect(clis.describe('lark')).toBeInstanceOf(CliUnavailableError);
    shipped = true;
    expect(clis.describe('lark').source).toBe('official');
  });
});

describe('给定的可执行文件能否运行', () => {
  it('路径在原地检查，裸名按 PATH 逐项目录找；什么都不启动', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'pa24-cli-source-path-')));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const standIn = join(dir, 'lark-cli');
    await writeFile(standIn, '#!/bin/sh\nexit 99\n', { mode: 0o644 });
    // PATH holds only this directory for the duration of the test.
    const saved = process.env.PATH;
    process.env.PATH = dir;
    try {
      // Present but not executable does not count.
      expect(runnableAsGiven('lark-cli')).toBe(false);
      await chmod(standIn, 0o755);
      expect(runnableAsGiven('lark-cli')).toBe(true);
      expect(runnableAsGiven('wecom-cli')).toBe(false);
      expect(runnableAsGiven(standIn)).toBe(true);
      expect(runnableAsGiven(join(dir, 'wecom-cli'))).toBe(false);
    } finally { process.env.PATH = saved; }
  });
});

describe('VendorClis：插件行的显式配置优先', () => {
  it('路径记为插件行配置，不再去看连接器', async () => {
    const layout = await installed();
    const clis = connectorLine(layout, { lark: '/opt/tools/lark-cli' });
    expect(clis.describe('lark')).toEqual({ path: '/opt/tools/lark-cli', source: 'config' });
    // The row wins even where the connector is absent.
    expect(connectorLine(layout, { lark: '/opt/tools/lark-cli', resolvePackage: () => null }).describe('lark')).toEqual({ path: '/opt/tools/lark-cli', source: 'config' });
  });

  it('运行时建立后再改插件行的值，下一次查找按新值', async () => {
    const settings = { officialConnectors: () => true, resolvePackage: (await installed()).resolvePackage };
    const clis = new VendorClis(settings);
    expect(clis.describe('lark').source).toBe('official');
    settings.lark = '/opt/tools/lark-cli';
    expect(clis.describe('lark')).toEqual({ path: '/opt/tools/lark-cli', source: 'config' });
  });

  it('带官方连接器的宿主上，插件行留着的裸名被拒绝：它可能捡到 PATH 上任何一个同名程序', () => {
    const clis = new VendorClis({ officialConnectors: () => true, lark: 'lark-cli', wecom: 'wecom-cli' });
    const answer = clis.describe('lark');
    expect(answer).toBeInstanceOf(CliUnavailableError);
    for (const anchor of ['插件行配置的 lark-cli 不是路径（lark-cli）', '只接受可执行文件的绝对路径', '请删除这一项']) expect(answer.message).toContain(anchor);
    expect(() => clis.get('lark')).toThrow(CliUnavailableError);
    expect(clis.describe('wecom').message).toContain('插件行配置的 wecom-cli 不是路径（wecom-cli）');
  });
});

describe('VendorClis：提供官方连接器的宿主线', () => {
  it('lark-cli 取自飞书连接器托管的 @larksuite/cli，并报出连接器与版本', async () => {
    const layout = await installed();
    await writeFile(layout.packages.get('@deepseek-ai/dsh-feishu'), JSON.stringify({ version: '0.2.3-alpha.2' }));
    expect(connectorLine(layout).describe('lark')).toEqual({ path: layout.lark, source: 'official', connector: '@deepseek-ai/dsh-feishu@0.2.3-alpha.2' });
  });

  it('wecom-cli 取自企业微信连接器的平台包', async () => {
    const layout = await installed();
    expect(connectorLine(layout).describe('wecom')).toEqual({ path: layout.wecom, source: 'official', connector: '@deepseek-ai/dsh-wecom' });
  });

  it('未安装连接器时报出缺的是哪个插件、怎么装；取可执行文件时抛出', async () => {
    const layout = await installed();
    const clis = connectorLine(layout, { resolvePackage: name => name.startsWith('@deepseek-ai/dsh-wecom') ? null : layout.resolvePackage(name) });
    const answer = clis.describe('wecom');
    expect(answer).toBeInstanceOf(CliUnavailableError);
    for (const anchor of ['需要官方企业微信插件提供的 wecom-cli', '未安装官方企业微信插件（@deepseek-ai/dsh-wecom）', 'dsh plugin --profile off add @deepseek-ai/dsh-wecom', 'wecomCliBin']) {
      expect(answer.message).toContain(anchor);
    }
    expect(() => clis.get('wecom')).toThrow(CliUnavailableError);
    expect(() => clis.get('wecom')).toThrow(/dsh plugin --profile off add @deepseek-ai\/dsh-wecom/);
  });

  it('不知道实例名时，安装命令用占位符', async () => {
    const layout = await installed();
    const clis = connectorLine(layout, { profile: undefined, resolvePackage: () => null });
    expect(clis.describe('lark').message).toContain('dsh plugin --profile <实例名> add @deepseek-ai/dsh-feishu');
  });

  it('连接器在而平台包缺失，或托管的可执行文件不可执行，都算未提供', async () => {
    const layout = await installed();
    const noPlatform = connectorLine(layout, { resolvePackage: name => name === '@wecom/cli-darwin-arm64' ? null : layout.resolvePackage(name) });
    expect(noPlatform.describe('wecom').message).toContain('没有 darwin-arm64 平台包');
    await chmod(layout.lark, 0o644);
    const answer = connectorLine(layout).describe('lark');
    expect(answer).toBeInstanceOf(CliUnavailableError);
    expect(answer.message).toContain('lark-cli 不可执行');
  });

  it('批准 @larksuite/cli 安装脚本的提示只出现在飞书的错误里', async () => {
    const layout = await installed();
    await chmod(layout.lark, 0o644); await chmod(layout.wecom, 0o644);
    const clis = connectorLine(layout);
    expect(clis.describe('lark').message).toContain('批准 @larksuite/cli 的安装脚本');
    const wecom = clis.describe('wecom').message;
    expect(wecom).toContain('wecom-cli 不可执行');
    expect(wecom).not.toContain('@larksuite/cli');
  });

  it('缺省从 profile 的 package.json 出发解析，像 Node 一样找到已装进 profile 的包', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'pa24-cli-source-anchor-')));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const put = async (name, file, mode = 0o644) => {
      const path = join(root, 'node_modules', name, file);
      await mkdir(dirname(path), { recursive: true }); await writeFile(path, file === 'package.json' ? '{}' : '', { mode });
      return path;
    };
    for (const pkg of ['@deepseek-ai/dsh-feishu', '@deepseek-ai/dsh-wecom', '@larksuite/cli', '@wecom/cli', '@wecom/cli-darwin-arm64']) await put(pkg, 'package.json');
    const lark = await put('@larksuite/cli', 'bin/lark-cli', 0o755);
    const wecom = await put('@wecom/cli-darwin-arm64', 'bin/wecom-cli', 0o755);
    const clis = new VendorClis({ officialConnectors: () => true, anchor: join(root, 'package.json') }, { platform: 'darwin', arch: 'arm64' });
    expect(clis.describe('lark')).toEqual({ path: lark, source: 'official', connector: '@deepseek-ai/dsh-feishu' });
    expect(clis.describe('wecom')).toEqual({ path: wecom, source: 'official', connector: '@deepseek-ai/dsh-wecom' });
  });

  it('Windows 取 .exe 文件名', async () => {
    const layout = await installed();
    await fileLike(layout, '@larksuite/cli/bin/lark-cli.exe');
    const clis = new VendorClis({ officialConnectors: () => true, resolvePackage: layout.resolvePackage }, { platform: 'win32', arch: 'x64', executable: () => true });
    expect(clis.describe('lark').path).toBe(join(layout.root, '@larksuite/cli/bin/lark-cli.exe'));
  });

  it('列出已装的官方连接器及版本，与插件行是否覆盖无关', async () => {
    const layout = await installed();
    await writeFile(layout.packages.get('@deepseek-ai/dsh-feishu'), JSON.stringify({ version: '0.2.3-alpha.2' }));
    expect(connectorLine(layout, { lark: '/opt/tools/lark-cli' }).connectors()).toEqual(['@deepseek-ai/dsh-feishu@0.2.3-alpha.2', '@deepseek-ai/dsh-wecom']);
    expect(connectorLine(layout, { resolvePackage: () => null }).connectors()).toEqual([]);
  });
});

describe('VendorClis：没有官方连接器的宿主线', () => {
  it('插件行没设值时如实报未设置，不去 PATH 上找', () => {
    const clis = new VendorClis({ officialConnectors: () => false });
    const answer = clis.describe('lark');
    expect(answer).toBeInstanceOf(CliUnavailableError);
    expect(answer.message).toBe('未设置 lark-cli：请在24私助插件行设置 larkCliBin。');
    expect(() => clis.get('lark')).toThrow(/未设置 lark-cli/);
  });

  it('插件行给了裸名就原样交给进程启动去解析', () => {
    const clis = new VendorClis({ officialConnectors: () => false, lark: 'lark-cli', wecom: 'wecom-cli' });
    expect(clis.get('lark')).toBe('lark-cli');
    expect(clis.describe('wecom')).toEqual({ path: 'wecom-cli', source: 'path' });
  });
});

async function fileLike(layout, name) {
  const path = join(layout.root, name);
  await writeFile(path, '', { mode: 0o755 });
  layout.packages.set(name, path);
}
