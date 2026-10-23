import { expect, it } from 'vitest';
import { WorkspaceExecution } from '../../lib/workspace-execution.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

it('轮询结束后，其定时取消不继承已失效的租约', async () => {
  const executions = new WorkspaceExecution(), fired = deferred();
  await executions.run(async () => {
    setTimeout(() => { executions.control(async () => fired.resolve('cancelled')).catch(error => fired.resolve(error)); }, 20);
  });
  expect(await fired.promise).toBe('cancelled');
  await executions.close();
});

it('配置变更等待长工作时允许取消及回执，回执保存后才切换', async () => {
  const executions = new WorkspaceExecution(), work = deferred(), receipt = deferred(), entered = deferred(), events = [];
  const running = executions.run(async () => { await work.promise; events.push('work ended'); });
  const changing = executions.transition(async () => events.push('changed'));
  await new Promise(resolve => setTimeout(resolve, 0));
  await expect(executions.detached(() => executions.run(async () => events.push('unexpected work')))).rejects.toThrow(/切换/);
  const cancelling = executions.control(async () => { events.push('cancel'); work.resolve(); entered.resolve(); await receipt.promise; events.push('receipt saved'); });
  await entered.promise; await running; await new Promise(resolve => setTimeout(resolve, 0));
  expect(events).toEqual(['cancel', 'work ended']);
  receipt.resolve(); await cancelling; await changing;
  expect(events).toEqual(['cancel', 'work ended', 'receipt saved', 'changed']);
  await executions.close();
});

it('配置已经开始替换时，不准取消回调访问旧工作区', async () => {
  const executions = new WorkspaceExecution(), entered = deferred(), release = deferred();
  const changing = executions.transition(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  await expect(executions.control(async () => 'old ledger')).rejects.toThrow(/切换/);
  release.resolve(); await changing; await executions.close();
});
