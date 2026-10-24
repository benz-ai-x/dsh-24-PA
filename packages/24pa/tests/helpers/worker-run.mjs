import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Handler errors stop further model steps. Read the durable public run detail
// instead of expecting a fabricated completed result or another model request.
export async function waitWorkerToolError(host, title, message, tool = 'pa24_work') {
  const snapshot = await host.waitUntil(
    value => value.work?.some(work => work.title === title && work.status === 'needs_reconciliation'),
    { timeoutMs: 30000, label: `${title}：保留工具错误并等待核对` },
  );
  const work = snapshot.work.find(work => work.title === title);
  assert.ok(work.active_worker_run_id, '拒绝操作仍须关联原运行');
  const detail = await host.api('worker.run', {
    runId: work.active_worker_run_id, workspaceBinding: snapshot.workspaceBinding,
  });
  assert.equal(detail.run.status, 'needs_reconciliation');
  const errors = detail.calls.filter(call => call.tool === tool && call.status === 'unknown');
  assert.ok(errors.some(call => JSON.stringify(call.result).includes(message)),
    `运行记录必须保留错误 ${message}：${JSON.stringify(errors)}`);
  return detail;
}

export async function waitWorkerInput(host, title, message) {
  const snapshot = await host.waitUntil(
    value => value.work?.some(work => work.title === title && work.status === 'waiting_input'),
    { timeoutMs: 30000, label: `${title}：写入前等待补充` },
  );
  const work = snapshot.work.find(work => work.title === title);
  let detail;
  for (let i = 0; i < 100; i++) {
    detail = await host.api('worker.run', { runId: work.active_worker_run_id, workspaceBinding: snapshot.workspaceBinding });
    if (detail.calls.every(call => call.status !== 'running')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(detail.run.status, 'waiting');
  assert.ok(detail.calls.some(call => call.status === 'succeeded' && call.result?.value?.businessExecuted === false
    && call.result.value.reason.includes(message)), `等待记录必须有明确未执行的依据：${JSON.stringify(detail.calls)}`);
  assert.ok(detail.calls.every(call => call.status !== 'unknown'));
  return detail;
}

export async function changeWorker(host, work, op, instruction = '') {
  const snapshot = await host.api('snapshot');
  const latest = await host.api('work.inspect', { workId: work.id, workspaceBinding: snapshot.workspaceBinding });
  return host.api('action', { type: 'work.change', workId: work.id, expectedRevision: latest.work.revision,
    workspaceBinding: snapshot.workspaceBinding, requestId: randomUUID(), confirm: true, op, instruction });
}
