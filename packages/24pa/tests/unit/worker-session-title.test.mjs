import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../helpers/runtime.mjs';

describe('Worker 子会话的标题', () => {
  let f;
  afterEach(async () => { vi.restoreAllMocks(); await f?.cleanup(); f = null; });
  it('委派后经会话标题服务以子代理标签命名子会话；dsh 0.2.3 不再为首条任务为中继消息的子会话生成兜底标题', async () => {
    f = await fixture({ dispatchTickMs: 50 });
    f.a = await f.workspace('a'); f.options.workspacePath = f.a;
    await f.rt.start(); f.parent = f.agents.get(await f.rt.openLocalSession());
    // The host's session controller refuses to name a subagent-owned Session.
    const controllerRename = vi.spyOn(f.ctx.sessionController, 'rename');
    const { workId } = await f.rt.delegate({ worker: 'memo', title: '整理会议纪要', instruction: '保存并报告' }, f.parent);
    const work = await f.rt.repos.workItems.get(workId);
    const child = work.child_session_id ?? workId;
    expect(f.agents.get(child).session.header.origin).toBe('subagent');
    expect(f.titles.calls).toEqual([{ sessionId: child, title: '备忘整理 · 整理会议纪要' }]);
    expect(controllerRename).not.toHaveBeenCalled();
  });
  it('宿主没有会话标题服务时跳过命名，委派照常建立', async () => {
    f = await fixture({ dispatchTickMs: 50 });
    const get = f.ctx.get;
    f.ctx.get = name => name === 'sessionTitle' ? null : get(name);
    f.a = await f.workspace('a'); f.options.workspacePath = f.a;
    await f.rt.start(); f.parent = f.agents.get(await f.rt.openLocalSession());
    const { workId } = await f.rt.delegate({ worker: 'memo', title: '整理会议纪要', instruction: '保存并报告' }, f.parent);
    const work = await f.rt.repos.workItems.get(workId);
    expect(f.agents.has(work.child_session_id ?? workId)).toBe(true);
    expect(f.titles.calls).toEqual([]);
  });
});
