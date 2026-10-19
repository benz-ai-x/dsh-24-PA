import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaRuntime } from '../../lib/runtime.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { FakeFeishuTransport } from '../../lib/feishu.js';

const cleanup = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pa24-transport-activation-')));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const ctx = { skills: null, get: () => null,
    workspaceRegistry: { create: async path => ({ id: path, path, title: '24私助' }) },
    sessionController: { create: async () => {}, rename: async () => {}, resolveAgent: async () => null },
  };
  const rt = new PaRuntime(ctx, { stateDirectory: root, workspacePath: '', reminderTickMs: 60000,
    larkCliBin: 'lark-cli', wecomCliBin: 'wecom-cli', cliTimeoutMs: 1000,
    env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'key' } });
  cleanup.push(() => rt.stop());
  const workspace = async (name, mode = 'demo') => {
    const path = join(root, name); await mkdir(path);
    await writeFile(join(path, 'AGENTS.md'), '```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, mode, ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }) + '\n```');
    return path;
  };
  await rt.bind(await workspace('old'));
  return { rt, workspace };
}
// An unauthorized sender is still durably recorded as rejected before ACK,
// without starting a model or a worker in this transport test.
const event = id => ({ eventId: id, kind: 'message', appId: 'app', tenantKey: '', senderOpenId: 'other', chatType: 'p2p', text: 'test' });
const settled = promise => promise.then(() => ({ ok: true }), error => ({ ok: false, error }));

describe('prepared transport acknowledgements', () => {
  it('rejects an early event when transport startup fails, preserving the old workspace', async () => {
    const { rt, workspace } = await fixture(); const old = rt.repos;
    let received;
    vi.spyOn(FakeFeishuTransport.prototype, 'start').mockImplementationOnce(async handler => {
      received = settled(handler(event('failed-prepare')));
      throw new Error('startup failed');
    });
    await expect(rt.bind(await workspace('failed', 'feishu'))).rejects.toThrow('startup failed');
    expect((await received).ok).toBe(false);
    expect(rt.repos).toBe(old);
    expect(await old.inbox.get('failed-prepare')).toBeNull();
  });
  it('buffers until activation, durably receives in the new workspace, and rejects retired callbacks', async () => {
    const { rt, workspace } = await fixture(); let received, callback;
    vi.spyOn(FakeFeishuTransport.prototype, 'start').mockImplementationOnce(async handler => {
      callback = handler; received = settled(handler(event('activated')));
    });
    await rt.bind(await workspace('next', 'feishu'));
    expect((await received).ok).toBe(true);
    expect((await rt.repos.inbox.get('activated')).status).toBe('rejected');
    await rt.bind(await workspace('third'));
    await expect(callback(event('retired'))).rejects.toThrow('事件尚未持久接收');
    expect(await rt.repos.inbox.get('retired')).toBeNull();
  });
  it('rejects buffered events if the runtime stops while binding is preparing', async () => {
    const { rt, workspace } = await fixture(); let received, release, ready;
    const started = new Promise(resolve => { ready = resolve; });
    vi.spyOn(FakeFeishuTransport.prototype, 'start').mockImplementationOnce(async handler => {
      received = settled(handler(event('stopped'))); ready();
      await new Promise(resolve => { release = resolve; });
    });
    const bound = settled(rt.bind(await workspace('stopped', 'feishu')));
    await started; await rt.stop(); release();
    expect((await bound).ok).toBe(false);
    expect((await received).ok).toBe(false);
    expect(rt.repos).toBeNull();
  });
});
