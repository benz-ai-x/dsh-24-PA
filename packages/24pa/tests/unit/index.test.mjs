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
  const runtime = { skillPackages: { register: vi.fn(async () => {}) }, start: vi.fn(() => start), stop: vi.fn(() => stop) };
  PaRuntime.mockImplementation(() => runtime);
  let disposer;
  const ctx = { reflect: { provide: vi.fn() }, on: vi.fn(), get: name => host[name], effect: vi.fn(fn => {
    const cleanup = fn();
    if (typeof cleanup === 'function') disposer = cleanup;
  }) };
  apply(ctx, row);
  return { runtime, dispose: () => disposer() };
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
