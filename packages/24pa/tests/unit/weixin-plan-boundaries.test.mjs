import { expect, it, vi } from 'vitest';
import { PlanConversation, WeixinPlanRefusal } from '../../lib/plan-conversation.js';
import { PaRuntime } from '../../lib/runtime.js';

function conversation() {
  const row = { id: 'legacy-plan', title: '原固定晨报', skill: 'digest-morning', kind: 'morning', status: 'paused', revision: 1,
    task_config: null, schedule_spec: { daily: { time: '09:00:00' } }, voice: true };
  let builtin = true, source = { kind: 'weixin', sourceId: 'input-a', authority: 'wx-authority', remoteIdentity: { sessionId: 'wx-session' }, messages: [{ id: 'a', text: '恢复原计划' }] };
  const item = { id: 'work', role: 'reminders', origin: 'weixin', parent_session_id: 'wx-session' };
  const plans = { preview: vi.fn(async () => ({ fingerprint: 'f', revision: 1 })), change: vi.fn(async () => ({ plan: row })) };
  const service = new PlanConversation({ context: () => ({ binding: 'workspace', authority: 'wx-authority', repos: { digests: { listPlans: async () => [row] }, taskPlans: { get: async () => row, blocks: async () => [] } } }),
    plans, ownerInput: async () => source, legacyBuiltin: async () => builtin, gate: (_key, work) => work(),
    customPreview: async () => null, customCreate: vi.fn(), legacyControl: vi.fn() });
  return { service, item, plans, setBuiltin: value => { builtin = value; }, confirm: preview => {
    source = { ...source, sourceId: 'input-b', messages: [{ id: 'b', text: preview.confirmationText }] };
    return { op: 'confirm', previewId: preview.previewId, instruction: preview.confirmationText };
  } };
}
it('同名自定义旧计划不进入微信列表，也不能按已知编号恢复', async () => {
  const f = conversation(); f.setBuiltin(false);
  expect((await f.service.list({}, f.item)).plans).toEqual([]);
  await expect(f.service.control({ planId: 'legacy-plan', op: 'resume' }, f.item)).rejects.toBeInstanceOf(WeixinPlanRefusal);
  expect(f.plans.preview).not.toHaveBeenCalled(); expect(f.plans.change).not.toHaveBeenCalled();
});
it('预览后同名目录胜者改变，真实后续确认也不能启用旧计划', async () => {
  const f = conversation(), preview = await f.service.control({ planId: 'legacy-plan', op: 'resume' }, f.item);
  f.setBuiltin(false);
  await expect(f.service.control(f.confirm(preview), f.item)).rejects.toBeInstanceOf(WeixinPlanRefusal);
  expect(f.plans.change).not.toHaveBeenCalled();
});
it('实际内置旧计划仍可明确恢复，保留原对象和语音', async () => {
  const f = conversation(); expect((await f.service.list({}, f.item)).plans[0].planId).toBe('legacy-plan');
  const preview = await f.service.control({ planId: 'legacy-plan', op: 'resume' }, f.item);
  expect(await f.service.control(f.confirm(preview), f.item)).toMatchObject({ plan: { planId: 'legacy-plan', voice: true } });
  expect(f.plans.change).toHaveBeenCalledTimes(1);
});
it('微信新目标返回刚创建的关联交办，保留旧交办编号供追溯', async () => {
  const old = { id: 'old', role: 'memo', title: '旧交办', status: 'completed', result: '旧结果', revision: 1 };
  const created = { id: 'new', role: 'memo', title: '新目标', status: 'queued', result: null, parent_work_id: 'old' };
  const runtime = { executions: { run: work => work() }, assertCall: async () => {}, roleFor: () => 'weixin-access',
    repos: { workItems: { get: async id => id === 'new' ? created : old } }, remoteBusinessWork: () => true,
    captureOwnerInput: async () => ({ kind: 'weixin' }), changeWork: async () => ({ workId: 'new' }), remoteWorkView: PaRuntime.prototype.remoteWorkView };
  expect(await PaRuntime.prototype.control.call(runtime, { action: 'new-goal', workId: 'old' }, { id: 'wx-session' })).toMatchObject({ work: { id: 'new', title: '新目标', status: 'queued', result: null } });
});
