import { rename, stat } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture, deferred, join, readFile, writeFile, mkdir } from '../helpers/runtime.mjs';
import { FakeFeishuTransport } from '../../lib/feishu.js';
import { SqliteDb } from '../../lib/sqlite.js';
import { createRepos } from '../../lib/repo.js';

const cleanups = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup(patch = {}, options = {}) { const f = await fixture(options); cleanups.push(f.cleanup); const a = await f.workspace('a', patch); await f.rt.bind(a); return { ...f, a }; }
const row = (id, status = 'running') => ({ id, title: id, role: 'memo', instruction: '保存', origin: 'local', parent_session_id: 'parent', child_session_id: id, delivery: 'local:parent', status });
const end = (turn, messageId, requestId, output = '结果', reason = { kind: 'completed' }, message) => [
  { type: 'turn/start', data: { turn } }, { type: 'user/message', data: message ?? { id: messageId, source: requestId ? { rpcId: requestId } : {} } },
  ...(output ? [{ type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text: output }] } } }] : []), { type: 'turn/end', data: { turn, reason } },
];

describe('公开 runtime 执行归属与恢复', () => {
  it('本地空会话被切换预设后，面板并发打开仍只建立一个正确入口并保留原会话', async () => {
    const f = await setup(); const original = await f.rt.openLocalSession();
    f.agents.get(original).session.header.agentPreset = 'standard';
    const opened = await Promise.all(Array.from({length: 4}, () => f.rt.openLocalSession()));
    expect(new Set(opened).size).toBe(1); expect(opened[0]).not.toBe(original);
    expect(f.agents.get(original).session.header.agentPreset).toBe('standard');
    expect(f.agents.get(opened[0]).session.header.agentPreset).toBe('pa24');
    expect((await f.rt.repos.workspaceState.get(f.a)).local_session_id).toBe(opened[0]);
  });
  it('已停止的在途业务先把回执写回 A，切换 B 等它结算', async () => {
    const f = await setup(); const b = await f.workspace('b'); const entered = deferred(), resume = deferred();
    const local = f.agents.get(await f.rt.openLocalSession());
    const work = await f.rt.repos.workItems.insert({ ...row('worker'), parent_session_id: local.id });
    f.rt.roles.get('memo').actions.memo_save = async () => { entered.resolve(); await resume.promise; await f.rt.repos.outbox.enqueue({ dedupKey: 'receipt-A', channel: 'local', target: local.id, kind: 'text', content: { text: 'A receipt' } }); };
    const action = f.rt.work({ action: 'memo_save' }, { id: work.id }); await entered.promise;
    await f.rt.control({ action: 'stop', workId: work.id }, local);
    let switched = false; const switching = f.rt.bind(b).then(() => { switched = true; });
    await new Promise(resolve => setImmediate(resolve)); expect(switched).toBe(false);
    resume.resolve(); await action; await switching;
    expect(await f.rt.repos.outbox.recent()).toEqual([]);
    const db = new SqliteDb(join(f.a, 'data', 'pa24.db')); const repos = createRepos(db);
    try { expect((await repos.outbox.recent()).map(r => r.dedup_key)).toContain('receipt-A'); } finally { await db.close(); }
  });
  it('后台审核等待期间停机仍等待落账，并保留宿主 drain 接收者', async () => {
    const f = await setup(); const entered = deferred(), resume = deferred(); const local = f.agents.get(await f.rt.openLocalSession());
    await f.rt.repos.workItems.insert({ ...row('running'), parent_session_id: local.id });
    f.ctx.subagents.expected = true; f.ctx.subagents.drainDescendants = async function() { expect(this.expected).toBe(true); };
    vi.spyOn(f.rt.repos.notes, 'pendingReviewVersions').mockImplementation(async () => { entered.resolve(); await resume.promise; return []; });
    f.rt.config.mode = 'feishu'; f.rt.transport = { close: async () => { } };
    const polling = f.rt.pollPendingNotes(); await entered.promise;
    let stopped = false; const stopping = f.rt.stop().then(() => { stopped = true; });
    await new Promise(resolve => setImmediate(resolve)); expect(stopped).toBe(false);
    resume.resolve(); await polling; await stopping; expect(f.rt.repos).toBeNull();
  });
  it('身份变更准备期间不能穿透接纳新事项', async () => {
    const f = await setup({}, { env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const local = f.agents.get(await f.rt.openLocalSession()), entered = deferred(), resume = deferred();
    vi.spyOn(FakeFeishuTransport.prototype, 'start').mockImplementation(async () => { entered.resolve(); await resume.promise; });
    const loading = f.rt.updateWorkspaceConfig({ mode: 'feishu', ownerOpenId: 'other', folderToken: 'folder', tasklistId: 'list' }); await entered.promise;
    await expect(f.rt.delegate({ worker: 'memo', title: '新事项', instruction: '保存' }, local)).rejects.toThrow(/切换/);
    resume.resolve(); await loading; expect(f.rt.config.ownerOpenId).toBe('other');
  });
  it('无显式目录冷启动发现上次工作区；手工绑定立即启动纯 queued 队列', async () => {
    const f = await setup(); await f.rt.repos.workItems.insert({ ...row('queued', 'queued'), parent_session_id: await f.rt.openLocalSession() }); await f.rt.stop();
    const fresh = f.make(); await fresh.start(); expect(fresh.workspace.statePath).toBe(f.a); expect((await fresh.repos.workItems.get('queued')).status).toBe('running');
    await fresh.control({ action: 'stop', workId: 'queued' }, f.agents.get(await fresh.openLocalSession())); await fresh.stop();
    const manual = f.make(); await manual.bind(f.a); await manual.repos.workItems.insert({ ...row('later', 'queued'), parent_session_id: await manual.openLocalSession() }); await manual.stop();
    const last = f.make(); await last.bind(f.a); expect((await last.repos.workItems.get('later')).status).toBe('running');
  });
  it('保存目录失效时保持未绑定并允许重新选择，不重建空工作区', async () => {
    const f = await setup({ ownerOpenId: 'original-owner' }); await f.rt.stop();
    await rename(f.a, f.a + '-moved'); const fresh = f.make(); await fresh.start();
    expect(fresh.workspace).toBeNull(); expect(fresh.repos).toBeNull();
    expect(fresh.configError).toContain('重新选择'); expect(await stat(f.a).catch(() => null)).toBeNull();
    await fresh.bind(f.a + '-moved'); expect(fresh.config.ownerOpenId).toBe('original-owner');
  });
  it('最后一个事项刚停止，停机仍等待原生 Worker 退休', async () => {
    const f = await setup(); const local = f.agents.get(await f.rt.openLocalSession());
    const task = await f.rt.delegate({ worker: 'memo', title: '保存', instruction: '保存' }, local);
    await f.rt.control({ action: 'stop', workId: task.workId }, local);
    const entered = deferred(), release = deferred(); f.ctx.subagents.drainDescendants = async function(parents) {
      expect(this).toBe(f.ctx.subagents); expect(parents.map(a => a.id)).toContain(local.id); entered.resolve(); await release.promise;
    };
    const stopping = f.rt.stop(); await entered.promise; expect(f.rt.repos).not.toBeNull();
    release.resolve(); await stopping; expect(f.rt.repos).toBeNull();
  });
  it('动态角色持久化失败不注册；重试成功；切 B 后 A 的角色消失', async () => {
    const f = await setup(); const definition = { id: 'researcher', name: '研究', persona: '只执行本人已授权的研究整理事项。', brief: '整理', actions: {}, available: true };
    await mkdir(join(f.a, '.24pa'), { recursive: true }); await mkdir(join(f.a, '.24pa', 'roles.json'));
    await expect(f.rt.registerRole(definition, ['digest_summarize'])).rejects.toThrow(); expect(f.rt.roles.get('researcher')).toBeUndefined();
    const { rm } = await import('node:fs/promises'); await rm(join(f.a, '.24pa', 'roles.json'), { recursive: true });
    await f.rt.registerRole(definition, ['digest_summarize']); expect(f.rt.roles.get('researcher')).toBeTruthy();
    await f.rt.bind(await f.workspace('b')); expect(f.rt.roles.get('researcher')).toBeUndefined();
    await f.rt.bind(f.a); expect(Object.keys(f.rt.roles.get('researcher').actions)).toEqual(['digest_summarize']);
  });
  it('旧已中止回合不能结束续办代次，实际消费续办输入后才完成', async () => {
    const f = await setup(); const local = f.agents.get(await f.rt.openLocalSession());
    const task = await f.rt.delegate({ worker: 'memo', title: '保存', instruction: '记下材料' }, local); const child = f.agents.get(task.workId);
    await f.rt.control({ action: 'stop', workId: task.workId }, local); const drained = deferred(); child.whenIdle = () => drained.promise;
    const continuation = f.rt.control({ action: 'continue', workId: task.workId }, local); await new Promise(resolve => setImmediate(resolve)); expect((await f.rt.repos.workItems.get(task.workId)).status).toBe('stopped');
    drained.resolve(); await continuation;
    let events = end(1, 'start-' + task.workId, null, '', { kind: 'aborted' }, f.nativeInputs.get('start-' + task.workId)); child.session.ownEvents = () => events;
    f.rt.onSessionEvent(child.session, events.at(-1)); await new Promise(resolve => setImmediate(resolve)); expect((await f.rt.repos.workItems.get(task.workId)).status).toBe('running');
    events = [...events, ...end(2, 'continue-0', null, '续办完成', undefined, f.nativeInputs.get('continue-0'))]; f.rt.onSessionEvent(child.session, events.at(-1));
    await vi.waitFor(async () => expect((await f.rt.repos.workItems.get(task.workId)).status).toBe('completed'));
  });
  it('prompt 已接纳但 flush 失败仍保留关联；计划回合不抢走新输入', async () => {
    const f = await setup({ mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }, { env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const session = f.agents.get((await f.rt.openLocalSession()).replace(/-local$/, '-feishu')).session;
    vi.spyOn(f.ctx.sessions, 'flush').mockRejectedValueOnce(new Error('flush unavailable'));
    await f.rt.getTransport().inject({ eventId: 'input', kind: 'message', appId: 'app', tenantKey: '', senderOpenId: 'owner', chatType: 'p2p', text: '保存' });
    await vi.waitFor(async () => expect((await f.rt.repos.inbox.get('input')).error).toContain('持久化待核对'));
    let events = end(1, 'scheduled-message', null, '计划结果'); session.ownEvents = () => events; f.rt.onSessionEvent(session, events.at(-1));
    await new Promise(resolve => setImmediate(resolve)); expect((await f.rt.repos.inbox.get('input')).status).toBe('admitted');
    events = [...events, ...end(2, 'owner-message', 'feishu:input', '本人结果')]; f.rt.onSessionEvent(session, events.at(-1));
    await vi.waitFor(async () => expect((await f.rt.repos.inbox.get('input')).status).toBe('delivered'));
    expect(f.prompts.filter(p => p.requestId === 'feishu:input')).toHaveLength(1); expect((await f.rt.repos.outbox.recent()).some(r => r.content.text === '本人结果')).toBe(true);
  });
  it('容量满导致补充输入未送达宿主，明确拒绝而不留下 admitted', async () => {
    const f = await setup({ maxWorkers: 1, mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }, { env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const local = f.agents.get(await f.rt.openLocalSession());
    await f.rt.repos.workItems.insert({ ...row('completed', 'waiting_input'), parent_session_id: local.id });
    await f.rt.delegate({ worker: 'memo', title: '占满', instruction: '保存' }, local);
    await f.rt.repos.messageRoutes.record('original', { kind: 'workitem', workItemId: 'completed' });
    const send = vi.spyOn(f.ctx.subagents, 'sendMessage');
    await f.rt.getTransport().inject({ eventId: 'input', kind: 'message', appId: 'app', senderOpenId: 'owner', chatType: 'p2p', text: '补充', parentMessageId: 'original' });
    await vi.waitFor(async () => expect((await f.rt.repos.inbox.get('input')).status).toBe('rejected'));
    expect((await f.rt.repos.inbox.get('input')).error).toContain('并发已满'); expect(send).not.toHaveBeenCalled();
  });
  it.each(['stop', 'archive'])('待核对输入可由本人明确 %s 结清并释放工作区', async action => {
    const f = await setup({ mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }, { env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const local = f.agents.get(await f.rt.openLocalSession()); const task = await f.rt.delegate({ worker: 'memo', title: '保存', instruction: '保存' }, local);
    await f.rt.repos.messageRoutes.record('original', { kind: 'workitem', workItemId: task.workId });
    vi.spyOn(f.ctx.subagents, 'sendMessage').mockRejectedValue(new Error('reply lost')); const interrupt = vi.spyOn(f.ctx.subagents, 'interrupt');
    await f.rt.getTransport().inject({ eventId: 'input', kind: 'message', appId: 'app', senderOpenId: 'owner', chatType: 'p2p', text: '补充', parentMessageId: 'original' });
    await vi.waitFor(async () => expect((await f.rt.repos.workItems.get(task.workId)).status).toBe('needs_reconciliation'));
    expect((await f.rt.maintenanceArchiveCheck()).runningWork.some(row => row.id === task.workId)).toBe(true);
    await expect(f.rt.control({ action: 'continue', workId: task.workId }, local)).rejects.toThrow(/核对/);
    const start = vi.spyOn(f.ctx.subagents, 'startActivation');
    if (action === 'stop') await f.rt.control({ action: 'stop', workId: task.workId }, local);
    else {
      await f.rt.repos.workItems.insert({ ...row('queue-one', 'queued'), parent_session_id: local.id });
      await f.rt.repos.workItems.insert({ ...row('queue-two', 'queued'), parent_session_id: local.id });
      await f.rt.maintenanceArchiveExecute({ confirmStop: true });
      expect(start).not.toHaveBeenCalled();
      expect((await f.rt.repos.workItems.get('queue-one')).status).toBe('stopped');
      expect((await f.rt.repos.workItems.get('queue-two')).status).toBe('stopped');
    }
    expect((await f.rt.repos.workItems.get(task.workId)).status).toBe('stopped');
    expect((await f.rt.repos.inbox.get('input')).status).toBe('rejected'); expect(interrupt).toHaveBeenCalled();
    await f.rt.bind(await f.workspace('b'));
  });
  it('宿主接纳未知且本地诊断写失败，仍保留 admitted 而不假装拒绝', async () => {
    const f = await setup({ mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }, { env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const local = f.agents.get(await f.rt.openLocalSession()); const task = await f.rt.delegate({ worker: 'memo', title: '保存', instruction: '保存' }, local);
    await f.rt.repos.messageRoutes.record('original', { kind: 'workitem', workItemId: task.workId });
    const send = vi.spyOn(f.ctx.subagents, 'sendMessage').mockRejectedValue(new Error('host reply lost'));
    const update = f.rt.repos.workItems.update.bind(f.rt.repos.workItems);
    vi.spyOn(f.rt.repos.workItems, 'update').mockImplementation((id, patch) => patch.status === 'needs_reconciliation' ? Promise.reject(new Error('local state failed')) : update(id, patch));
    await f.rt.getTransport().inject({ eventId: 'input', kind: 'message', appId: 'app', senderOpenId: 'owner', chatType: 'p2p', text: '补充', parentMessageId: 'original' });
    await vi.waitFor(async () => expect((await f.rt.repos.inbox.get('input')).error).toContain('local state failed'));
    expect((await f.rt.repos.inbox.get('input')).status).toBe('admitted'); expect(send).toHaveBeenCalledTimes(1);
  });
  it('较早回合已消费的补充输入独立结算，较新输入仍由后续回合完成', async () => {
    const f = await setup({ mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }, { env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const local = f.agents.get(await f.rt.openLocalSession()); const task = await f.rt.delegate({ worker: 'memo', title: '保存', instruction: '保存' }, local);
    await f.rt.repos.messageRoutes.record('original', { kind: 'workitem', workItemId: task.workId });
    let sequence = 0; f.ctx.subagents.sendMessage = async (parent, _id, content) => f.acceptInput(`supplement-${++sequence}`, content, { kind: 'agent-message', senderSessionId: parent.id });
    const inject = id => f.rt.getTransport().inject({ eventId: id, kind: 'message', appId: 'app', senderOpenId: 'owner', chatType: 'p2p', text: id, parentMessageId: 'original' });
    await inject('first'); await vi.waitFor(async () => expect((await f.rt.repos.inbox.get('first')).request_id).toBe('supplement-1'));
    const child = f.agents.get(task.workId), entered = deferred(), release = deferred();
    let events = end(1, 'supplement-1', null, 'first done', undefined, f.nativeInputs.get('supplement-1')); child.session.ownEvents = () => events;
    vi.spyOn(f.ctx.sessions, 'flush').mockImplementationOnce(async () => { entered.resolve(); await release.promise; return true; });
    f.rt.onSessionEvent(child.session, events.at(-1)); await entered.promise;
    try {
      await inject('second'); await vi.waitFor(async () => {
        const input = await f.rt.repos.inbox.get('second');
        expect(input.request_id, JSON.stringify(input)).toBe('supplement-2');
      });
    } finally { release.resolve(); }
    await vi.waitFor(async () => expect((await f.rt.repos.inbox.get('first')).status).toBe('delivered'));
    expect((await f.rt.repos.inbox.get('second')).status).toBe('admitted'); expect((await f.rt.repos.workItems.get(task.workId)).status).toBe('running');
    events = [...events, ...end(2, 'supplement-2', null, 'second done', undefined, f.nativeInputs.get('supplement-2'))]; f.rt.onSessionEvent(child.session, events.at(-1));
    await vi.waitFor(async () => expect((await f.rt.repos.workItems.get(task.workId)).status).toBe('completed'));
    expect((await f.rt.repos.inbox.get('second')).status).toBe('delivered'); await f.rt.bind(await f.workspace('b'));
  });
  it('补充输入已接纳后的本地提交故障保留真实关联，消费后可补结算且不重发', async () => {
    const f = await setup({ mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }, { env: { PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const local = f.agents.get(await f.rt.openLocalSession()); const task = await f.rt.delegate({ worker: 'memo', title: '保存', instruction: '保存' }, local);
    await f.rt.repos.messageRoutes.record('original', { kind: 'workitem', workItemId: task.workId });
    const send = vi.spyOn(f.ctx.subagents, 'sendMessage').mockImplementation(async (parent, _id, content) => f.acceptInput('accepted-message', content, { kind: 'agent-message', senderSessionId: parent.id }));
    const mark = f.rt.repos.inbox.mark.bind(f.rt.repos.inbox); let failed = false;
    vi.spyOn(f.rt.repos.inbox, 'mark').mockImplementation(async (id, patch) => {
      if (!failed && patch.requestId === 'accepted-message') { failed = true; throw new Error('local commit failed'); }
      return mark(id, patch);
    });
    await f.rt.getTransport().inject({ eventId: 'input', kind: 'message', appId: 'app', senderOpenId: 'owner', chatType: 'p2p', text: '补充', parentMessageId: 'original' });
    await vi.waitFor(async () => expect((await f.rt.repos.inbox.get('input')).request_id).toBe('accepted-message'));
    expect((await f.rt.repos.inbox.get('input')).status).toBe('admitted'); expect(send).toHaveBeenCalledTimes(1);
    const child = f.agents.get(task.workId), events = end(1, 'accepted-message', null, '补充已完成', undefined, f.nativeInputs.get('accepted-message')); child.session.ownEvents = () => events;
    f.rt.onSessionEvent(child.session, events.at(-1)); await vi.waitFor(async () => expect((await f.rt.repos.inbox.get('input')).status).toBe('delivered'));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('归档停止也结清事项的补充输入，随后可以切换', async () => {
    const f = await setup(); const local = f.agents.get(await f.rt.openLocalSession());
    const task = await f.rt.delegate({ worker: 'memo', title: '保存', instruction: '记下材料' }, local);
    await f.rt.repos.inbox.insert({ eventId: 'supplement', source: 'feishu', kind: 'message', payload: {} });
    await f.rt.repos.inbox.mark('supplement', { status: 'admitted', targetSession: task.workId });
    await f.rt.maintenanceArchiveExecute({ confirmStop: true }); expect((await f.rt.repos.inbox.get('supplement')).status).toBe('rejected');
    await f.rt.bind(await f.workspace('b'));
  });
});
