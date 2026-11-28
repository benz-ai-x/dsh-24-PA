import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apply } from '../../lib/index.js';
import { PaRuntime } from '../../lib/runtime.js';

vi.mock('../../lib/runtime.js', () => ({ PaRuntime: vi.fn(), HostStartupError: class HostStartupError extends Error {} }));
vi.mock('../../lib/panel.js', () => ({ registerPanel: vi.fn() }));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const config = {
  stateDirectory: 'state', backupSessionsRoot: 'sessions', backupStoragesRoot: 'storages', backupAttachmentsRoot: 'attachments',
  workspacePath: '', larkCliBin: 'lark-cli', wecomCliBin: 'wecom-cli', cliTimeoutMs: 90000,
  dispatchTickMs: 400, outboxTickMs: 1000, reminderTickMs: 1000, noteVerifyTickMs: 60000, reviewReminderTickMs: 5000,
};
// `host` names the services the host provides; `row` overrides the plugin row's config.
const setup = (start = Promise.resolve(), stop = Promise.resolve(), { host = {}, row = config } = {}) => {
  const runtime = {
    skillPackages: { register: vi.fn(async () => {}) }, start: vi.fn(() => start), stop: vi.fn(() => stop),
    onAccessAccount: vi.fn(() => () => {}), accessAccountState: vi.fn(() => ({ state: 'unbound' })), checkSwitchedOnAccess: vi.fn(async () => {}),
  };
  PaRuntime.mockImplementation(() => runtime);
  let disposer;
  const scopeDisposers = [];
  // As the host does: the callback runs in its own scope once each named service is there, and not at all otherwise.
  let scopesRun = 0;
  const ctx = { reflect: { provide: vi.fn() }, on: vi.fn(), get: name => host[name], effect: vi.fn(fn => {
    const cleanup = fn();
    if (typeof cleanup === 'function') disposer = cleanup;
  }),
  inject: vi.fn((deps, callback) => {
    if (!deps.every(name => name in host)) return;
    scopesRun++;
    callback({ connectorAccounts: host.connectorAccounts, effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') scopeDisposers.push(cleanup); } });
  }) };
  apply(ctx, row);
  return { runtime, ctx, scopesRun: () => scopesRun, disposeScope: () => { for (const cleanup of scopeDisposers.splice(0)) cleanup(); }, dispose: () => disposer() };
};

beforeEach(() => { vi.clearAllMocks(); });

describe('厂商 CLI 的缺省（#306）', () => {
  const row = { ...config, larkCliBin: undefined, wecomCliBin: undefined };
  const runtimeOptions = () => PaRuntime.mock.calls.at(-1)[1];

  it('宿主提供官方连接器服务时，插件行不设缺省，CLI 取自官方连接器', () => {
    setup(Promise.resolve(), Promise.resolve(), { host: { cliAccounts: {} }, row });
    expect(runtimeOptions().larkCliBin).toBeUndefined();
    expect(runtimeOptions().wecomCliBin).toBeUndefined();
  });

  it('宿主没有官方连接器服务时，插件行给出裸名，由 PATH 解析', () => {
    setup(Promise.resolve(), Promise.resolve(), { row });
    expect(runtimeOptions()).toMatchObject({ larkCliBin: 'lark-cli', wecomCliBin: 'wecom-cli' });
  });

  it('插件行显式设置的值在两种宿主线上都原样生效', () => {
    setup(Promise.resolve(), Promise.resolve(), { host: { cliAccounts: {} }, row: { ...row, larkCliBin: '/opt/tools/lark-cli' } });
    expect(runtimeOptions().larkCliBin).toBe('/opt/tools/lark-cli');
  });
});

describe('插件停止生命周期', () => {
  it('disposer 返回并等待 runtime.stop 结算完成', async () => {
    const started = deferred(), stopped = deferred();
    const { runtime, dispose } = setup(started.promise, stopped.promise);
    try {
      const pending = dispose();
      expect(pending).toBeInstanceOf(Promise);
      let settled = false;
      void Promise.resolve(pending).then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      stopped.resolve();
      await pending;
      expect(settled).toBe(true);
      expect(runtime.stop).toHaveBeenCalledTimes(1);
    } finally {
      started.resolve();
      stopped.resolve();
    }
  });

  it('停止错误交还宿主，不在 disposer 静默吞掉', async () => {
    const { dispose } = setup(Promise.resolve(), Promise.reject(new Error('结算失败')));
    await expect(dispose()).rejects.toThrow('结算失败');
  });
});

describe('接入状态进宿主插件页（#309）', () => {
  it('向宿主要求插件页的账号注册表；宿主没有它时，那个作用域不运行，什么都不登记', () => {
    const { ctx, scopesRun } = setup(Promise.resolve(), Promise.resolve(), { host: { tools: {} } });
    expect(ctx.inject).toHaveBeenCalledWith(['connectorAccounts'], expect.any(Function));
    expect(scopesRun()).toBe(0);
  });

  it('宿主有注册表时登记一个区块：键是24私助的包名，视图取自运行时；作用域结束时撤下', () => {
    const withdraw = vi.fn(), register = vi.fn(() => withdraw);
    const { runtime, scopesRun, disposeScope } = setup(Promise.resolve(), Promise.resolve(), { host: { connectorAccounts: { register } } });
    expect(scopesRun()).toBe(1);
    expect(register).toHaveBeenCalledTimes(1);
    const registration = register.mock.calls[0][0];
    expect(registration.key).toBe('@benz-ai-x/dsh-24pa');
    expect(registration.source.snapshot().account).toEqual({ state: 'unbound' });
    expect(runtime.checkSwitchedOnAccess).not.toHaveBeenCalled();
    disposeScope();
    expect(withdraw).toHaveBeenCalledTimes(1);
  });
});
