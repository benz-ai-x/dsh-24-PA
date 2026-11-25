import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../helpers/runtime.mjs';

describe('Worker 子会话的标题', () => {
  let f;
  afterEach(async () => { vi.restoreAllMocks(); await f?.cleanup(); f = null; });
  it('委派后以子代理标签命名子会话；dsh 0.2.3 不再为首条任务为中继消息的子会话生成兜底标题', async () => {
    f = await fixture({ dispatchTickMs: 50 });
    const rename = vi.spyOn(f.ctx.sessionController, 'rename');
    f.a = await f.workspace('a'); f.options.workspacePath = f.a;
    await f.rt.start(); f.parent = f.agents.get(await f.rt.openLocalSession());
    const { workId } = await f.rt.delegate({ worker: 'memo', title: '整理会议纪要', instruction: '保存并报告' }, f.parent);
    const work = await f.rt.repos.workItems.get(workId);
    expect(rename).toHaveBeenCalledWith({ sessionId: work.child_session_id ?? workId, title: '备忘整理 · 整理会议纪要' });
  });
});
