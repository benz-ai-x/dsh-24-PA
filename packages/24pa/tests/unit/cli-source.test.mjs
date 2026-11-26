// #306: how lark-cli and wecom-cli are supplied. The official-connector lookup
// runs against a fake package layout with stand-in executables; no vendor CLI
// is executed and nothing is looked up on PATH.
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliUnavailableError, VendorClis } from '../../lib/cli-source.js';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

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
const connectorLine = (layout, settings = {}) => new VendorClis({ officialConnectors: true, profile: 'off', resolvePackage: layout.resolvePackage, ...settings }, { platform: 'darwin', arch: 'arm64' });

describe('VendorClis：插件行的显式配置优先', () => {
  it('路径记为插件行配置，裸名记为 PATH', () => {
    const clis = new VendorClis({ officialConnectors: true, lark: '/opt/tools/lark-cli', wecom: 'wecom-cli' });
    expect(clis.describe('lark')).toEqual({ path: '/opt/tools/lark-cli', source: 'config' });
    expect(clis.describe('wecom')).toEqual({ path: 'wecom-cli', source: 'path' });
  });

  it('运行时建立后再改插件行的值，下一次查找按新值', async () => {
    const settings = { officialConnectors: true, resolvePackage: (await installed()).resolvePackage };
    const clis = new VendorClis(settings);
    expect(clis.describe('lark').source).toBe('official');
    settings.lark = '/opt/tools/lark-cli';
    expect(clis.describe('lark')).toEqual({ path: '/opt/tools/lark-cli', source: 'config' });
  });
});

describe('VendorClis：提供官方连接器的宿主线', () => {
  it('lark-cli 取自飞书连接器托管的 @larksuite/cli', async () => {
    const layout = await installed();
    expect(connectorLine(layout).describe('lark')).toEqual({ path: layout.lark, source: 'official' });
  });

  it('wecom-cli 取自企业微信连接器的平台包', async () => {
    const layout = await installed();
    expect(connectorLine(layout).describe('wecom')).toEqual({ path: layout.wecom, source: 'official' });
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
    const clis = new VendorClis({ officialConnectors: true, anchor: join(root, 'package.json') }, { platform: 'darwin', arch: 'arm64' });
    expect(clis.describe('lark')).toEqual({ path: lark, source: 'official' });
    expect(clis.describe('wecom')).toEqual({ path: wecom, source: 'official' });
  });

  it('Windows 取 .exe 文件名', async () => {
    const layout = await installed();
    await fileLike(layout, '@larksuite/cli/bin/lark-cli.exe');
    const clis = new VendorClis({ officialConnectors: true, resolvePackage: layout.resolvePackage }, { platform: 'win32', arch: 'x64', executable: () => true });
    expect(clis.describe('lark').path).toBe(join(layout.root, '@larksuite/cli/bin/lark-cli.exe'));
  });
});

describe('VendorClis：没有官方连接器的宿主线', () => {
  it('插件行没设值时如实报未设置，不去 PATH 上找', () => {
    const clis = new VendorClis({ officialConnectors: false });
    const answer = clis.describe('lark');
    expect(answer).toBeInstanceOf(CliUnavailableError);
    expect(answer.message).toBe('未设置 lark-cli：请在24私助插件行设置 larkCliBin。');
    expect(() => clis.get('lark')).toThrow(/未设置 lark-cli/);
  });

  it('插件行给了裸名就原样交给进程启动去解析', () => {
    const clis = new VendorClis({ officialConnectors: false, lark: 'lark-cli', wecom: 'wecom-cli' });
    expect(clis.get('lark')).toBe('lark-cli');
    expect(clis.describe('wecom')).toEqual({ path: 'wecom-cli', source: 'path' });
  });
});

async function fileLike(layout, name) {
  const path = join(layout.root, name);
  await writeFile(path, '', { mode: 0o755 });
  layout.packages.set(name, path);
}
