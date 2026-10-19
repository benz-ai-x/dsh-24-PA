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
  return { rt, workspace, ctx };
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


describe('已持久接收的飞书委托归属', () => {
  it('会话等待及待回传期间拒绝切换；原会话完成后才可激活 B', async () => {
    const { rt, workspace, ctx } = await fixture();
    const a = await workspace('inbox-a', 'feishu'), b = await workspace('inbox-b');
    await rt.bind(a);
    const reposA = rt.repos, sessionA = (await rt.openLocalSession()).replace(/-local$/, '-feishu');
    let ready, release;
    const entered = new Promise(resolve => { ready = resolve; });
    const proceed = new Promise(resolve => { release = resolve; });
    ctx.sessions = { flush: async () => {} };
    ctx.sessionController.create = vi.fn(async () => {}).mockImplementationOnce(async () => { ready(); await proceed; });
    ctx.sessionController.resolveAgent = async id => ({ agent: { session: { id } } });
    ctx.sessionController.prompt = vi.fn(async () => ({}));
    try {
      await rt.getTransport().inject({ ...event('owned-input'), senderOpenId: 'owner', text: 'A private input' });
      await entered;
      await expect(rt.bind(b)).rejects.toThrow(/接收|消息|回传/);
      expect(rt.workspace.statePath).toBe(a);
    } finally { release(); }
    await vi.waitFor(async () => expect((await reposA.inbox.get('owned-input')).status).toBe('admitted'));
    expect(ctx.sessionController.prompt.mock.calls[0][0].sessionId).toBe(sessionA);
    await expect(rt.bind(b)).rejects.toThrow(/接收|消息|回传/);
    rt.onSessionEvent({ id: sessionA, ownEvents: () => [{ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'A result' }] } } }] }, { type: 'turn/end', data: { turn: 1 } });
    await vi.waitFor(async () => expect((await reposA.inbox.get('owned-input')).status).toBe('delivered'));
    expect((await reposA.outbox.recent(10)).some(row => row.content.text === 'A result')).toBe(true);
    await rt.bind(b);
    expect(await rt.repos.inbox.get('owned-input')).toBeNull();
    expect(await rt.repos.outbox.recent(10)).toEqual([]);
  });
});

it('快速 turn/end 等待接纳落账，回传始终返回飞书发起入口', async () => {
  const { rt, workspace, ctx } = await fixture();
  await rt.bind(await workspace('fast-reply', 'feishu'));
  rt.config.notifyChannel = 'wecom';
  const id = (await rt.openLocalSession()).replace(/-local$/, '-feishu');
  const session = { id, ownEvents: () => [{ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'fast result' }] } } }] };
  ctx.sessions = { flush: async () => {} };
  ctx.sessionController.resolveAgent = async () => ({ agent: { session } });
  ctx.sessionController.prompt = async () => {
    rt.onSessionEvent(session, { type: 'turn/end', data: { turn: 1 } });
    await new Promise(resolve => setImmediate(resolve));
    return {};
  };
  await rt.getTransport().inject({ ...event('fast'), senderOpenId: 'owner' });
  await vi.waitFor(async () => expect((await rt.repos.inbox.get('fast')).status).toBe('delivered'));
  expect((await rt.repos.outbox.recent(10))[0]).toMatchObject({ channel: 'feishu', target: 'owner', content: { text: 'fast result' } });
});

it('停止等待已认领消息退出，终止后不会再提交模型请求或写已关闭账本', async () => {
  const { rt, workspace, ctx } = await fixture();
  await rt.bind(await workspace('stop-inbox', 'feishu'));
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  ctx.sessionController.create = async () => { enter(); await held; };
  ctx.sessionController.resolveAgent = async id => ({ agent: { session: { id } } });
  ctx.sessionController.prompt = vi.fn(async () => ({}));
  ctx.sessions = { flush: async () => {} };
  await rt.getTransport().inject({ ...event('stop-claimed'), senderOpenId: 'owner' });
  await entered;
  let stopped = false;
  const stopping = rt.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(stopped).toBe(false);
  release(); await stopping;
  expect(ctx.sessionController.prompt).not.toHaveBeenCalled();
  expect(rt.repos).toBeNull();
});
