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
const setup = (start = Promise.resolve(), stop = Promise.resolve()) => {
  const runtime = { skillPackages: { register: vi.fn(async () => {}) }, start: vi.fn(() => start), stop: vi.fn(() => stop) };
  PaRuntime.mockImplementation(() => runtime);
  let disposer;
  const ctx = { reflect: { provide: vi.fn() }, on: vi.fn(), effect: vi.fn(fn => {
    const cleanup = fn();
    if (typeof cleanup === 'function') disposer = cleanup;
  }) };
  apply(ctx, config);
  return { runtime, dispose: () => disposer() };
};

beforeEach(() => { vi.clearAllMocks(); });

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
