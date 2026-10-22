import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { startPgCluster } from '../helpers/pg.mjs';

let root, host, llm, binding, bootEnv, scriptPath, workspace, cluster;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-manticore-run-'));
  workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  cluster = storage === 'postgres' ? await startPgCluster() : null;
  await writeFile(join(workspace, 'AGENTS.md'), '# 24私助隔离验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage }, null, 2) + '\n```\n');
  scriptPath = join(root, 'script.json');
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: 'PINNED_RESULT_A：已按明确完成标准生成结果。' }] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json'), recordInputs: true });
  bootEnv = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env: bootEnv });
  binding = (await host.waitUntil(snapshot => !!snapshot.workspaceBinding && !!snapshot.workspace?.localSessionId, { label: 'Skill 工作区就绪' })).workspaceBinding;
}, 600_000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
const markdown = (content, tools = []) => '---\n' + JSON.stringify({ name: 'local-run', description: '本地隔离验证', metadata: { track: 'agent', tools, pa24: {
  schemaVersion: 1, mode: 'local', parameters: { subject: { type: 'string', required: true } }, expectedResult: '返回可核验结果', completionCriteria: '如实说明完成情况',
} } }) + '\n---\n\n' + content;
const change = payload => host.api('action', { type: 'skill.change', workspaceBinding: binding, requestId: randomUUID(), ...payload });
const runDetail = runId => host.api('skills.run', { runId, workspaceBinding: binding });
const until = async (read, check) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('运行等待超时：' + JSON.stringify(await read()));
};
const start = async (steps, tools = []) => {
  await writeFile(scriptPath, JSON.stringify(Array.isArray(steps) ? { steps } : steps));
  const created = await change({ op: 'save', displayName: '工具验证', markdown: markdown('按已授权范围完成隔离测试。', tools) });
  const id = 'managed:' + created.entry.id;
  const published = await change({ op: 'publish', id, expectedRevision: created.entry.revision, confirm: true });
  const base = { id, versionId: created.entry.draft_version, parameters: { subject: '测试' }, workspaceBinding: binding };
  const preview = await host.api('skills.preview', base);
  const result = await host.api('action', { type: 'skill.run', ...base, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true });
  return { ...result, entry: published.entry, id };
};

it('真实 Loader：保存、发布、独立本地运行、相同请求不重跑、重启回读原结果', async () => {
  const created = await change({ op: 'save', displayName: '本地验证', markdown: markdown('固定版本 A，不调用工具。') });
  const id = 'managed:' + created.entry.id, versionId = created.entry.draft_version;
  const published = await change({ op: 'publish', id, expectedRevision: created.entry.revision, versionId, confirm: true });
  const base = { id, versionId, parameters: { subject: '验证' }, workspaceBinding: binding };
  const preview = await host.api('skills.preview', base);
  expect(preview.tools).toEqual([]); expect(llm.requests).toHaveLength(0);
  const command = { type: 'skill.run', ...base, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true };
  const [started, duplicate] = await Promise.all([host.api('action', command), host.api('action', command)]);
  expect(duplicate.run.id).toBe(started.run.id);
  expect([started.repeated, duplicate.repeated].sort()).toEqual([false, true]);
  expect(started.run.status, JSON.stringify(started)).not.toBe('needs_reconciliation');
  let detail;
  const deadline = Date.now() + 30000;
  do {
    detail = await host.api('skills.run', { runId: started.run.id, workspaceBinding: binding });
    if (detail.run.status === 'completed') break;
    if (detail.run.status === 'needs_reconciliation') throw Error(JSON.stringify(detail));
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  expect(detail.run.status, JSON.stringify(detail)).toBe('completed');
  expect(detail.run.result).toContain('PINNED_RESULT_A');
  expect(detail.run.delivery_status).toBe('not_requested');
  expect(detail.run.session_id).not.toBe(detail.run.source_session_id);
  expect(llm.requests, JSON.stringify(llm.requests)).toHaveLength(1); expect(llm.requests[0].tools).toEqual([]);
  const work = (await host.api('snapshot')).work.find(row => row.id === detail.run.work_item_id);
  expect(work).toMatchObject({ status: 'completed', child_session_id: null, execution_mode: 'skill' });
  expect((await host.api('skills.inspect', { id, workspaceBinding: binding })).verification).toEqual({ runs: 1, trials: 0, completed: 1 });
  expect((await host.api('action', command)).run.id).toBe(started.run.id);
  expect(llm.requests, JSON.stringify(llm.requests)).toHaveLength(1);
  await change({ op: 'save', id, expectedRevision: published.entry.revision, displayName: '本地验证新版', markdown: markdown('固定版本 B') });
  expect((await host.api('skills.run', { runId: started.run.id, workspaceBinding: binding })).run.version_id).toBe(versionId);
  const hostRoot = host.root;
  await host.stop({ keepRoot: true });
  host = await bootHost({ env: bootEnv, root: hostRoot });
  binding = (await host.waitUntil(snapshot => !!snapshot.workspaceBinding && !!snapshot.workspace?.localSessionId, { label: 'Skill 工作区重启就绪' })).workspaceBinding;
  const restored = await host.api('skills.run', { runId: started.run.id, workspaceBinding: binding });
  expect(restored.run.result).toBe(detail.run.result); expect(restored.run.status).toBe('completed');
  expect(llm.requests, JSON.stringify(llm.requests)).toHaveLength(1);
}, 600_000);

it('缺少声明的运行依赖可以保存草稿，但不能启用；修正后可重新检查启用', async () => {
  const content = markdown('读取资料，不执行外部动作。').replace('"parameters":', '"dependencies":{"commands":["pa24-missing-executable-for-test"],"environment":["PA24_MISSING_REQUIREMENT_TEST"]},"parameters":');
  const created = await change({ op: 'save', displayName: '缺依赖草稿', markdown: content });
  const id = 'managed:' + created.entry.id;
  const detail = await host.api('skills.inspect', { id, workspaceBinding: binding });
  expect(detail.restrictions.join(' ')).toContain('缺少可执行依赖'); expect(detail.restrictions.join(' ')).toContain('缺少环境变量');
  await expect(change({ op: 'publish', id, expectedRevision: created.entry.revision, confirm: true })).rejects.toThrow(/缺少/);
  await expect(host.api('skills.preview', { id, parameters: { subject: '验证' }, workspaceBinding: binding })).rejects.toThrow(/缺少/);
  const fixed = await change({ op: 'save', id, expectedRevision: created.entry.revision, markdown: markdown('已移除不使用的依赖。') });
  expect((await change({ op: 'publish', id, expectedRevision: fixed.entry.revision, confirm: true })).entry.status).toBe('enabled');
}, 60_000);

it('真实工具回执落账；禁用 Skill 阻止新运行，不截断已开始的版本', async () => {
  const started = await start([{ tool: { name: 'bash', input: { description: '隔离写入', command: "printf 'one-action\\n' >> run-actions.txt; sleep 1", workdir: workspace, timeoutMs: 5000 } } }, { text: 'TOOL_RESULT：写入结果如回执。' }], ['bash']);
  await until(() => runDetail(started.run.id), value => value.calls.some(call => call.status === 'running'));
  await change({ op: 'disable', id: started.id, expectedRevision: started.entry.revision });
  const detail = await until(() => runDetail(started.run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(detail.run.status, JSON.stringify(detail)).toBe('completed');
  expect(detail.calls).toHaveLength(1); expect(detail.calls[0]).toMatchObject({ tool: 'bash', status: 'returned' });
  expect(await readFile(join(workspace, 'run-actions.txt'), 'utf8')).toBe('one-action\n');
  await expect(host.api('skills.preview', { id: started.id, workspaceBinding: binding })).rejects.toThrow(/禁用/);
}, 60_000);

it('停止正在运行的工具：保存实际回执，取消不代表已经发生的动作被撤销', async () => {
  const started = await start([{ tool: { name: 'bash', input: { description: '等待停止', command: "printf 'before-stop\\n' >> stop-actions.txt; sleep 10; printf 'after-stop\\n' >> stop-actions.txt", workdir: workspace, timeoutMs: 20000 } } }, { text: '不得继续' }], ['bash']);
  await until(() => readFile(join(workspace, 'stop-actions.txt'), 'utf8').catch(() => ''), text => text.includes('before-stop'));
  await host.api('action', { type: 'skill.run', op: 'stop', runId: started.run.id, workspaceBinding: binding });
  const detail = await runDetail(started.run.id);
  expect(detail.run.status, JSON.stringify(detail)).toBe('needs_reconciliation');
  expect(detail.calls[0].status).toBe('unknown');
  expect(await readFile(join(workspace, 'stop-actions.txt'), 'utf8')).toBe('before-stop\n');
  const base = { rerunId: started.run.id, configuration: 'original', workspaceBinding: binding, instruction: '只补尚未写入的 after-stop，不重复 before-stop。' };
  await expect(host.api('skills.preview', base)).rejects.toThrow(/核对/);
  const command = { type: 'skill.run', op: 'review', runId: started.run.id, requestId: randomUUID(), workspaceBinding: binding,
    fingerprint: detail.fingerprint, confirm: true, summary: '已读取实际文件并确认进程结束', completed: 'before-stop 已写入一次', remaining: '只写入 after-stop',
    calls: [{ sessionId: detail.calls[0].session_id, callId: detail.calls[0].call_id, outcome: 'partial', evidence: 'stop-actions.txt 当前仅有 before-stop 一行' }], native: [] };
  const reviewed = await host.api('action', command);
  expect(reviewed.run.status).toBe('stopped'); expect(reviewed.reviewed).toBe(true);
  expect(reviewed.calls[0].status).toBe('unknown'); expect(reviewed.reviews).toHaveLength(1);
  expect((await host.api('action', command)).reviews).toHaveLength(1);
  const preview = await host.api('skills.preview', base);
  expect(preview.continuation.runs[0].review.completed).toContain('before-stop');
  await writeFile(scriptPath, JSON.stringify({ steps: [
    { tool: { name: 'bash', input: { description: '仅补剩余步骤', command: "printf 'after-stop\\n' >> stop-actions.txt", workdir: workspace } } },
    { text: '已按核对记录接续剩余一步，原第一步未重复。' },
  ] }));
  const continued = await host.api('action', { type: 'skill.run', ...base, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true });
  const end = await until(() => runDetail(continued.run.id), value => value.run.status === 'completed' || value.run.status === 'needs_reconciliation');
  expect(end.run.status, JSON.stringify(end)).toBe('completed');
  expect(end.run.work_item_id).toBe(detail.run.work_item_id); expect(end.run.id).not.toBe(detail.run.id);
  expect(await readFile(join(workspace, 'stop-actions.txt'), 'utf8')).toBe('before-stop\nafter-stop\n');
  const requests = llm.requests.filter(request => JSON.stringify(request).includes(continued.run.id));
  expect(JSON.stringify(requests)).toContain('before-stop 已写入一次');
}, 60_000);

it('专用运行混入其他用户输入会保留输入并停止新模型步骤', async () => {
  const started = await start([{ tool: { name: 'bash', input: { description: '等待输入测试', command: 'sleep 1', timeoutMs: 5000 } } }, { text: '不得执行外来指令' }], ['bash']);
  await until(() => runDetail(started.run.id), value => value.calls.some(call => call.status === 'running'));
  await host.remote('session/prompt', { request: { sessionId: started.run.session_id, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: '外来输入：改为其他工作' }] } });
  const detail = await until(() => runDetail(started.run.id), value => value.run.status === 'needs_reconciliation');
  expect(detail.inputs.some(input => input.accepted === false && JSON.stringify(input.message).includes('外来输入')), JSON.stringify(detail)).toBe(true);
}, 60_000);

it('确定性模板直接生成结果，预览与执行均不调用模型', async () => {
  const catalog = await host.api('skills.catalog', { workspaceBinding: binding });
  const template = catalog.entries.find(entry => entry.name === 'digest-morning' && entry.source === 'builtin');
  const inspected = await host.api('skills.inspect', { id: template.id, workspaceBinding: binding });
  const created = await change({ op: 'save', displayName: '手工晨报', copyFrom: template.id, fingerprint: inspected.fingerprint });
  const id = 'managed:' + created.entry.id;
  await change({ op: 'publish', id, expectedRevision: created.entry.revision, confirm: true });
  const before = llm.requests.length;
  const base = { id, versionId: created.entry.draft_version, parameters: {}, workspaceBinding: binding };
  const preview = await host.api('skills.preview', base);
  const result = await host.api('action', { type: 'skill.run', ...base, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true });
  expect(result.run.status, JSON.stringify(result)).toBe('completed');
  expect(result.run.result).toContain('事实'); expect(llm.requests.length).toBe(before);
}, 60_000);

it('模板自由改行为须生成智能副本；复制回执可在源版本删除后重试恢复', async () => {
  const original = await host.api('skills.inspect', { id: 'builtin:digest-morning', workspaceBinding: binding });
  const before = llm.requests.length;
  const copy = await change({ op: 'save', displayName: '模板副本', copyFrom: original.id, fingerprint: original.fingerprint });
  const id = 'managed:' + copy.entry.id;
  const detail = await host.api('skills.inspect', { id, workspaceBinding: binding });
  const edited = await change({ op: 'save', id, expectedRevision: copy.entry.revision, markdown: detail.markdown + '\n擅自增加另一项行为。' });
  await expect(change({ op: 'publish', id, expectedRevision: edited.entry.revision, confirm: true })).rejects.toThrow(/模板/);
  const command = { op: 'save', displayName: '智能副本', copyFrom: id, versionId: edited.entry.draft_version, intelligentCopy: true, requestId: randomUUID() };
  const converted = await change(command);
  const convertedDetail = await host.api('skills.inspect', { id: 'managed:' + converted.entry.id, workspaceBinding: binding });
  expect(convertedDetail).toMatchObject({ track: 'agent', metadata: { tools: [], pa24: { mode: 'local' } }, entry: { status: 'draft' } });
  expect(convertedDetail.content).toContain('模型用量'); expect(convertedDetail.content).toContain('擅自增加另一项行为');
  await change({ op: 'delete', id, expectedRevision: edited.entry.revision });
  const repeated = await change(command);
  expect(repeated).toMatchObject({ repeated: true, entry: { id: converted.entry.id } });
  expect(llm.requests.length).toBe(before);
  expect((await host.api('skills.inspect', { id: original.id, workspaceBinding: binding })).fingerprint).toBe(original.fingerprint);
}, 60_000);

it('后台作业继续归属原运行，结束通知推动第二回合再结算', async () => {
  const started = await start([
    { tool: { name: 'bash', input: { description: '后台写入', command: "sleep 2; printf 'job-once\\n' >> background-actions.txt", workdir: workspace, run_in_background: true } } },
    { text: '后台作业已开始，等待其完成。' }, { text: 'BACKGROUND_RESULT：后台作业实际结束。' },
  ], ['bash']);
  const waiting = await until(() => runDetail(started.run.id), value => value.native.some(item => item.kind === 'job' && item.start_data && !item.end_data));
  expect(waiting.run.status, JSON.stringify(waiting)).toBe('running');
  const detail = await until(() => runDetail(started.run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(detail.run.status, JSON.stringify(detail)).toBe('completed');
  expect(detail.run.result).toContain('BACKGROUND_RESULT');
  expect(detail.inputs.some(input => input.message.source.kind === 'tool-jobs' && input.accepted)).toBe(true);
  expect(detail.native.find(item => item.kind === 'job').end_data).toMatchObject({ status: 'completed', producerReported: true });
  expect(await readFile(join(workspace, 'background-actions.txt'), 'utf8')).toBe('job-once\n');
}, 60_000);

it('停止已经脱离原回合的后台作业，保留启动和终止证据', async () => {
  const started = await start([
    { tool: { name: 'bash', input: { description: '停止后台作业', command: "printf 'started\\n' >> stopped-background.txt; sleep 10; printf 'must-not-run\\n' >> stopped-background.txt", workdir: workspace, run_in_background: true } } },
    { text: '后台作业运行中。' },
  ], ['bash']);
  await until(() => runDetail(started.run.id), value => value.native.some(item => item.kind === 'job' && !item.end_data));
  await host.api('action', { type: 'skill.run', op: 'stop', runId: started.run.id, workspaceBinding: binding });
  const detail = await runDetail(started.run.id);
  expect(detail.run.status, JSON.stringify(detail)).toBe('stopped');
  expect(detail.native.find(item => item.kind === 'job').end_data).toMatchObject({ status: 'killed', producerReported: true });
  expect(await readFile(join(workspace, 'stopped-background.txt'), 'utf8')).toBe('started\n');
}, 60_000);

it('原生子任务的会话、启动和回传在同一运行内留存', async () => {
  const started = await start([
    { tool: { name: 'subagent', input: { description: '子任务验证', prompt: '只返回 CHILD_RESULT，不调用工具。' } } },
    { text: 'CHILD_RESULT：子任务已完成。' }, { text: 'ROOT_RESULT：已汇总子任务。' }, { text: 'ROOT_RESULT：已汇总子任务。' },
  ], ['subagent']);
  const detail = await until(() => runDetail(started.run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(detail.run.status, JSON.stringify(detail)).toBe('completed');
  expect(detail.sessions).toHaveLength(2);
  const child = detail.sessions.find(item => item.session_id !== detail.run.session_id);
  expect(child.parent_session_id).toBe(detail.run.session_id);
  expect(detail.native.find(item => item.kind === 'activation').end_data).toMatchObject({ id: child.session_id, local: true, stopReason: 'completed' });
  expect(detail.inputs.some(input => input.message.source.kind === 'subagent-settled' && input.accepted)).toBe(true);
}, 60_000);

it('主会话结束后等待原生子任务的实际工具完成，并记下子任务回执', async () => {
  const started = await start({ mode: 'native-run',
    rootStep: { tool: { name: 'subagent', input: { description: '子任务执行验证', prompt: '[NATIVE_CHILD] 完成获准的隔离工具验证。' } } },
    childStep: { tool: { name: 'bash', input: { description: '子任务写入', command: "sleep 2; printf 'child-once\\n' >> child-actions.txt", workdir: workspace, timeoutMs: 5000 } } },
  }, ['subagent', 'bash']);
  const pending = await until(async () => ({ ...await runDetail(started.run.id), requests: llm.requests.slice(-6) }), value => value.calls.some(call => call.tool === 'bash' && call.status === 'running') || !['running', 'pending'].includes(value.run.status));
  expect(pending.run.status, JSON.stringify(pending)).toBe('running');
  const detail = await until(() => runDetail(started.run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(detail.run.status, JSON.stringify(detail)).toBe('completed');
  expect(detail.run.result).toContain('ROOT_RESULT');
  const call = detail.calls.find(call => call.tool === 'bash');
  expect(call.status).toBe('returned'); expect(call.session_id).not.toBe(detail.run.session_id);
  expect(await readFile(join(workspace, 'child-actions.txt'), 'utf8')).toBe('child-once\n');
}, 60_000);

it('停止原生子任务树；中断工具保留未知结果，迟到回传不能复活运行', async () => {
  const started = await start({ mode: 'native-run',
    rootStep: { tool: { name: 'subagent', input: { description: '停止子任务验证', prompt: '[NATIVE_CHILD] 完成获准的隔离工具验证。' } } },
    childStep: { tool: { name: 'bash', input: { description: '等待中断', command: "printf 'started\\n' >> stopped-child.txt; sleep 10; printf 'must-not-run\\n' >> stopped-child.txt", workdir: workspace, timeoutMs: 20000 } } },
  }, ['subagent', 'bash']);
  await until(() => readFile(join(workspace, 'stopped-child.txt'), 'utf8').catch(() => ''), value => value === 'started\n');
  await host.api('action', { type: 'skill.run', op: 'stop', runId: started.run.id, workspaceBinding: binding });
  const detail = await runDetail(started.run.id);
  expect(detail.run.status, JSON.stringify(detail)).toBe('needs_reconciliation');
  expect(detail.calls.find(call => call.tool === 'bash').status).toBe('unknown');
  expect(detail.native.find(item => item.kind === 'activation').end_data).toMatchObject({ stopReason: 'aborted' });
  expect(await readFile(join(workspace, 'stopped-child.txt'), 'utf8')).toBe('started\n');
  await expect(host.api('skills.preview', { rerunId: detail.run.id, configuration: 'original', workspaceBinding: binding })).rejects.toThrow(/核对/);
  await expect(host.api('action', { type: 'skill.run', rerunId: detail.run.id, configuration: 'original', workspaceBinding: binding,
    requestId: randomUUID(), fingerprint: 'bypass-without-preview', confirm: true })).rejects.toThrow(/核对/);
}, 60_000);

it('原生编程子任务只得到已声明工具，不能继承工作区维护权限', async () => {
  const before = llm.requests.length;
  const started = await start({ mode: 'native-run',
    rootStep: { tool: { name: 'subagent', input: { description: '子任务权限验证', prompt: '[NATIVE_CHILD] 检查权限边界。' } } },
    childStep: { tool: { name: 'pa24_workspace', input: { action: 'reload' } } },
  }, ['subagent', 'bash']);
  const detail = await until(() => runDetail(started.run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(detail.run.status, JSON.stringify(detail)).toBe('completed');
  expect(llm.requests.slice(before).every(request => !request.tools.includes('pa24_workspace'))).toBe(true);
  const denied = detail.calls.find(call => call.tool === 'pa24_workspace');
  expect(denied, JSON.stringify(detail)).toMatchObject({ status: 'failed', result: null, final_result: { isError: true } });
}, 60_000);

it('本地 Skill 通过原生业务交办执行，Worker 保留业务门禁并结算自己的交办', async () => {
  const started = await start({ mode: 'dispatch',
    delegate: { worker: 'memo', title: 'Skill 内部资料查询', instruction: '检索现有备忘，不新增外部内容。' },
    workerAction: { action: 'memo_find', query: '不存在的隔离验收资料' }, workerReply: 'BUSINESS_CHILD：查询完成。',
    leadReply: '业务查询已交办。', leadReport: 'BUSINESS_ROOT：已汇总查询结果。',
  }, ['pa24_delegate']);
  const detail = await until(() => runDetail(started.run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(detail.run.status, JSON.stringify(detail)).toBe('completed');
  const call = detail.calls.find(call => call.tool === 'pa24_work');
  expect(call, JSON.stringify(detail)).toMatchObject({ status: 'returned', arguments: { action: 'memo_find' } });
  const child = (await host.api('snapshot')).work.find(item => item.id === call.session_id);
  expect(child).toMatchObject({ status: 'completed', parent_session_id: detail.run.session_id, execution_mode: 'worker' });
}, 60_000);
