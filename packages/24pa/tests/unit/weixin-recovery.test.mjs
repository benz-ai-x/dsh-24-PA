import { expect, it, vi } from 'vitest';
import { PaRuntime } from '../../lib/runtime.js';
import { inspectWeixinInput, readWeixinSession } from '../../lib/weixin-session.js';
const identity = { accountId: 'bot', ownerId: 'owner', generation: 'generation-b', sessionId: 'wx-session' };
const input = { id: 'native-input-b', source: { kind: 'user', rpcId: 'rpc-b' }, content: [{ type: 'text', text: '明确继续原事项' }] };
const events = [{ type: 'turn/start', data: { turn: 2 } }, { type: 'user/message', data: input }];
for (const [scenario, adopted, status, outbox, generation, expected] of [
  ['本次输入已完成并有原投递记录', 'adopted', 'completed', 'original-result', identity.generation, true],
  ['尚未采用的补充', 'received', 'completed', 'original-result', identity.generation, false],
  ['旧代次不能证明本次完成', 'adopted', 'completed', 'original-result', 'old-generation', false],
  ['运行尚未结束', 'adopted', 'running', null, identity.generation, false],
  ['缺少原结果投递记录', 'adopted', 'completed', null, identity.generation, false],
]) it(`冷恢复：${scenario}，不重新提交或投递`, async () => {
  const complete = vi.fn(), enqueue = vi.fn(), close = vi.fn(), mark = vi.fn();
  const runtime = { workspace: { statePath: '/workspace' }, backupWorkspaceId: 'workspace-id',
    ctx: { sessions: { get: () => null }, get: () => ({ open: async () => ({ header: { id: identity.sessionId, cwd: '/workspace' }, inheritedEventCount: 0, read: async () => ({ events }), close }) }) },
    inboxLifecycle: { restore: () => {}, complete }, weixin: { enqueue },
    repos: { inbox: { listAdmitted: async () => [{ source: 'weixin', event_id: 'input-b', request_id: 'rpc-b', target_session: identity.sessionId, binding_generation: identity.generation, payload: identity }], mark },
      weixin: { get: async () => ({ workspace_id: 'workspace-id', account_id: identity.accountId, owner_id: identity.ownerId, session_id: identity.sessionId, generation: identity.generation }) },
      workerRuns: { ownerInputResults: async () => [{ adopted, status, outbox_key: outbox, scope: { workspaceId: 'workspace-id', parentSessionId: 'original-local-entry', ownerInput: { kind: 'weixin', sourceId: 'input-b', remoteIdentity: { ...identity, generation } } } }] } } };
  await PaRuntime.prototype.reconcileWeixinInputs.call(runtime);
  expect(complete).toHaveBeenCalledTimes(expected ? 1 : 0); expect(enqueue).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
  if (!expected) expect(mark).toHaveBeenCalledWith('input-b', expect.objectContaining({ status: 'admitted' }));
});
it('原输入还在持久队列时只报告等待；flush 未确认不能使用内存完成证据', async () => {
  const session = { id: 'wx-session', header: { cwd: '/workspace' }, ownEvents: () => [{ type: 'agent/inbox/spliced', data: { target: 'queue', start: 0, removedCount: 0, inserted: [input] } }] };
  expect(inspectWeixinInput(session, 'rpc-b').state).toBe('queued');
  await expect(readWeixinSession({ sessions: { get: () => session, flush: async () => false } }, session.id)).rejects.toThrow('持久化');
});
