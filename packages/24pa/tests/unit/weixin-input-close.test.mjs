import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { fixture } from '../helpers/runtime.mjs';
import { weixinIdentity } from '../../lib/repo/weixin.js';

it.each(['idle', 'running', 'queued'])('电脑端核对失败输入遵守真实宿主取消信号及未结保护：%s', async scenario => {
  const f = await fixture();
  try {
    const workspace = await f.workspace('workspace'); await f.rt.bind(workspace); await f.rt.openLocalSession();
    const registered = await f.rt.repos.weixin.register(f.rt.backupWorkspaceId, 'test-bot', 'test-owner');
    let binding = await f.rt.repos.weixin.activate(registered.generation, null);
    const received = await f.rt.repos.weixin.receive(binding, 'cursor', [{ ...weixinIdentity(binding), nativeId: '123', text: '只读测试', replyTo: null, rejection: null }]);
    const eventId = received.inserted[0], requestId = 'native-request';
    await f.rt.repos.inbox.mark(eventId, { status: 'admitted', requestId, targetSession: binding.session_id, error: '原回合已消费但失败' });
    f.storedSessions.set(binding.session_id, { header: { id: binding.session_id, cwd: workspace, agentPreset: 'pa24' }, events: [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { turn: 1, id: 'native-input', source: { kind: 'user', rpcId: requestId }, content: [{ type: 'text', text: '只读测试' }] } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } },
    ] });
    const impact = await f.rt.repos.weixin.impact(binding.generation);
    binding = await f.rt.repos.weixin.change(binding.generation, binding.version, 'disable', impact.fingerprint);
    let stateCalls = 0;
    f.ctx.sessionController.state = async (request, signal) => {
      // dsh 0.2.2-rc.1 StateController requires this second argument.
      signal.throwIfAborted(); stateCalls++;
      expect(request.sessionId).toBe(binding.session_id);
      return { running: scenario === 'running', queue: scenario === 'queued' ? [{ rpcId: requestId }] : [] };
    };
    const closing = f.rt.weixinDesktop({ workspaceBinding: f.rt.workspaceBinding, generation: binding.generation,
      eventId, requestId: randomUUID(), confirm: true, evidence: '已核对原回合失败，未执行业务；只关闭该输入。' }, 'input-close');
    if (scenario !== 'idle') {
      await expect(closing).rejects.toThrow('原会话仍在运行或排队');
      expect((await f.rt.repos.inbox.get(eventId)).status).toBe('admitted');
      expect((await f.rt.db.query('select * from pa24.weixin_input_review')).rows).toHaveLength(0);
    } else {
      const result = await closing;
      expect(result.inbox.find(row => row.event_id === eventId)).toMatchObject({ status: 'rejected', error: '主人已核对关闭原输入；未证明原业务成功，未重新执行。' });
      expect((await f.rt.db.query('select * from pa24.weixin_input_review')).rows).toHaveLength(1);
    }
    expect(stateCalls).toBe(1);
    expect(await f.rt.repos.outbox.byInbox(eventId)).toHaveLength(0);
    expect(f.prompts).toHaveLength(0);
  } finally { await f.cleanup(); }
});
