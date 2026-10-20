import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaRuntime } from '../../lib/runtime.js';
import { SqliteDb } from '../../lib/sqlite.js';
import { createRepos, InboxRepo } from '../../lib/repo.js';
import { readFile } from 'node:fs/promises';
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
    env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'key', OTHER_APP_ID: 'app-b', OTHER_APP_SECRET: 'key-b' } });
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
    await started; const stopping = rt.stop(); release(); await stopping;
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
    ctx.sessionController.prompt = vi.fn(async () => ({accepted:true}));
    try {
      await rt.getTransport().inject({ ...event('owned-input'), senderOpenId: 'owner', text: 'A private input' });
      await entered;
      const switching = rt.bind(b);
      release();
      await expect(switching).rejects.toThrow(/接收|消息|回传/);
      expect(rt.workspace.statePath).toBe(a);
    } finally { release(); }
    await vi.waitFor(async () => expect((await reposA.inbox.get('owned-input')).status).toBe('admitted'));
    expect(ctx.sessionController.prompt.mock.calls[0][0].sessionId).toBe(sessionA);
    await expect(rt.updateWorkspaceConfig({ appIdEnv: 'OTHER_APP_ID', appSecretEnv: 'OTHER_APP_SECRET' })).rejects.toThrow(/接收|回传/);
    await expect(rt.bind(b)).rejects.toThrow(/接收|消息|回传/);
    rt.onSessionEvent({ id: sessionA, ownEvents: () => [{type:'turn/start', data:{turn:1}}, {type:'user/message',data:{id:'msg-owned',source:{rpcId:'feishu:owned-input'}}}, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'A result' }] } } }] }, { type: 'turn/end', data: { turn: 1 } });
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
  const session = { id, ownEvents: () => [{type:'turn/start',data:{turn:1}}, {type:'user/message',data:{id:'msg-fast',source:{rpcId:'feishu:fast'}}}, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: 'fast result' }] } } }] };
  ctx.sessions = { flush: async () => {} };
  ctx.sessionController.resolveAgent = async () => ({ agent: { session } });
  ctx.sessionController.prompt = async () => {
    rt.onSessionEvent(session, { type: 'turn/end', data: { turn: 1 } });
    await new Promise(resolve => setImmediate(resolve));
    return {accepted:true};
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
  ctx.sessionController.prompt = vi.fn(async () => ({accepted:true}));
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


it('第一回合回传落账失败后，下一回合仍绑定自己的输入并重试原结果', async () => {
  const { rt, workspace, ctx } = await fixture(); await rt.bind(await workspace('retry-replies', 'feishu'));
  const id = (await rt.openLocalSession()).replace(/-local$/, '-feishu');
  ctx.sessions = { flush: async () => {} };
  ctx.sessionController.resolveAgent = async () => ({ agent: { session: { id } } });
  ctx.sessionController.prompt = async () => ({accepted:true});
  for (const name of ['first', 'second']) await rt.getTransport().inject({ ...event(name), senderOpenId: 'owner' });
  await vi.waitFor(async () => expect((await rt.repos.inbox.get('second')).status).toBe('admitted'));
  const enqueue = vi.spyOn(rt.repos.outbox, 'enqueue').mockRejectedValueOnce(new Error('disk temporarily unavailable'));
  const finish = (turn, reply) => rt.onSessionEvent({ id, ownEvents: () => [{type:'turn/start',data:{turn}}, {type:'user/message',data:{id:'msg-'+turn,source:{rpcId:'feishu:'+(turn===1?'first':'second')}}}, { type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: reply }] } } }] }, { type: 'turn/end', data: { turn } });
  finish(1, 'first reply');
  await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
  finish(2, 'second reply');
  await vi.waitFor(async () => expect((await rt.repos.inbox.get('second')).status).toBe('delivered'));
  const outbox = await rt.repos.outbox.recent(10);
  expect(outbox.find(r => r.dedup_key === 'reply:first:1').content.text).toBe('first reply');
  expect(outbox.find(r => r.dedup_key === 'reply:second:2').content.text).toBe('second reply');
});

it('目标恢复使用原入口的本地回传意图；失败发生于激活前，原工作区仍可用', async () => {
  const { rt, workspace } = await fixture();
  const a = rt.workspace.statePath, b = await workspace('recovery-b');
  const file = join(b, 'AGENTS.md');
  await writeFile(file, (await readFile(file, 'utf8')).replace('"notifyChannel":"feishu"', '"notifyChannel":"wecom"'));
  // Establish B through the public admission path before seeding interrupted
  // input. Unowned historical data must now fail before recovery begins.
  await rt.bind(b); await rt.bind(a);
  await mkdir(join(b, 'data'), { recursive: true });
  const db = new SqliteDb(join(b, 'data', 'pa24.db'));
  await db.migrate();
  const repos = createRepos(db);
  await repos.inbox.insert({ eventId: 'interrupted', source: 'feishu', kind: 'message', payload: { senderOpenId: 'original-owner' } });
  await repos.inbox.mark('interrupted', { status: 'admitted' }); await db.close();
  const recovery = vi.spyOn(InboxRepo.prototype, 'resetProcessing').mockRejectedValueOnce(new Error('recovery disk unavailable'));
  await expect(rt.bind(b)).rejects.toThrow('recovery disk unavailable');
  expect(rt.workspace.statePath).toBe(a);
  recovery.mockRestore(); await rt.bind(b);
  expect((await rt.repos.inbox.get('interrupted')).status).toBe('rejected');
  expect((await rt.repos.outbox.recent(10))[0]).toMatchObject({ channel: 'feishu', target: 'original-owner' });
  await rt.bind(a);
});

it.each(['finish', 'stop'])('引用 Worker 的补充输入在 %s 后释放原工作区', async outcome => {
  const { rt, workspace, ctx } = await fixture();
  const a = await workspace(`followup-${outcome}`, 'feishu'); await rt.bind(a);
  const localId = await rt.openLocalSession(), accessId = localId.replace(/-local$/, '-feishu');
  await rt.repos.workItems.insert({ id: 'work', child_session_id: 'child', title: '原事项', role: 'memo', instruction: 'work', origin: 'feishu', parent_session_id: accessId, delivery: 'feishu:owner', status: 'completed' });
  await rt.repos.messageRoutes.record('original-message', { kind: 'workitem', workItemId: 'work' });
  ctx.sessions = { flush: async () => {} };
  ctx.sessionController.resolveAgent = async id => ({ agent: { id, session: { id } } });
  ctx.subagents = { interrupt: () => {}, sendMessage: async () => {
    if (outcome === 'finish') rt.onSessionEvent({ id: 'child', ownEvents: () => [{type:'turn/start',data:{turn:2}}, {type:'user/message',data:{id:'accepted-supplement',source:{}}}, { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: 'supplement result' }] } } }] }, { type: 'turn/end', data: { turn: 2 } });
    return 'accepted-supplement';
  } };
  await rt.getTransport().inject({ ...event('supplement'), senderOpenId: 'owner', parentMessageId: 'original-message' });
  if (outcome === 'stop') {
    await vi.waitFor(async () => expect((await rt.repos.inbox.get('supplement')).status).toBe('admitted'));
    await rt.control({ action: 'stop', workId: 'work' }, { id: localId, session: { header: { cwd: a, agentPreset: 'pa24' } } });
  }
  await vi.waitFor(async () => expect((await rt.repos.inbox.get('supplement')).status).toBe(outcome === 'stop' ? 'rejected' : 'delivered'));
  await rt.bind(await workspace(`after-${outcome}`));
});


it('Lead 已回传而 Worker 仍在途时，参数与磁盘重载都不能换机器人身份', async () => {
  const { rt, workspace } = await fixture(); const path = await workspace('worker-identity', 'feishu'); await rt.bind(path);
  await rt.repos.workItems.insert({ id: 'running-work', title: '进行中', role: 'memo', instruction: 'work', origin: 'feishu', parent_session_id: 'parent', child_session_id: 'child', delivery: 'feishu:owner', status: 'running' });
  const file = join(path, 'AGENTS.md'), before = await readFile(file, 'utf8');
  await expect(rt.updateWorkspaceConfig({ appIdEnv: 'OTHER_APP_ID', appSecretEnv: 'OTHER_APP_SECRET' })).rejects.toThrow(/进行中的事项/);
  expect(await readFile(file, 'utf8')).toBe(before);
  await writeFile(file, before.replace('PA24_FEISHU_APP_ID', 'OTHER_APP_ID').replace('PA24_FEISHU_APP_SECRET', 'OTHER_APP_SECRET'));
  await expect(rt.reloadWorkspace()).rejects.toThrow(/进行中的事项/);
  expect(rt.secretValue('feishuAppId')).toBe('app');
  await rt.repos.workItems.update('running-work', { status: 'stopped' });
});
