import { afterAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost, dshBin } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

const legacyBin = process.env.PA24_E2E_LEGACY_DSH_BIN;
const legacyPackage = process.env.PA24_E2E_LEGACY_PACKAGE;
const upgradeIt = legacyBin && legacyPackage ? it : it.skip;
let root, host, llm;

afterAll(async () => {
  await host?.stop();
  await llm?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

upgradeIt('rc.3 正式数据在 alpha.2 恢复原交办、原运行和投递目标', async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-host-upgrade-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), '# 跨版本恢复验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', enabledWorkers: ['memo'] }) + '\n```');
  const scriptPath = join(root, 'script.json');
  const title = 'rc3-to-alpha2-recovery';
  const script = waiting => writeFile(scriptPath, JSON.stringify({ mode: 'dispatch',
    delegate: { worker: 'memo', title, instruction: '只完成原目标', completionCriteria: '结果包含可核对出处' },
    workerTool: { name: 'pa24_run', input: waiting ? { action: 'wait', reason: '需要主人确认主题', kind: 'input' } : { action: 'progress', stage: '已核对输入', completed: '完成原资料核对', next: '交付结果' } },
    workerReply: 'UPGRADE_RESULT：跨版本原运行完成。', leadReply: '已交办。' }));
  await script(true);
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json'), recordInputs: true });
  const env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url };
  host = await bootHost({ env, bin: legacyBin, packageSpec: legacyPackage });
  let binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
  const parent = (await host.api('snapshot')).workspace.localSessionId;
  await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: parent, mode: 'queue', content: [{ type: 'text', text: title }], clientTimeZone: 'Asia/Shanghai' } });
  const admitted = await host.waitUntil(value => value.work.some(work => work.title === title && work.status === 'waiting_input'), { label: 'rc.3 原运行等待' });
  const work = admitted.work.find(work => work.title === title);
  const firstRun = work.active_worker_run_id;
  const hostRoot = host.root;
  await host.stop({ keepRoot: true });
  host = null;

  await script(false);
  host = await bootHost({ env, root: hostRoot, bin: process.env.DSH_BIN || dshBin() });
  binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
  const restored = (await host.api('work.inspect', { workId: work.id, workspaceBinding: binding })).work;
  expect(restored.status).toBe('waiting_input');
  expect(restored.active_worker_run_id).toBe(firstRun);
  expect(restored.parent_session_id).toBe(parent);
  await host.api('action', { type: 'work.change', workspaceBinding: binding, workId: work.id,
    expectedRevision: restored.revision, requestId: randomUUID(), op: 'supplement', instruction: '主题确认：跨版本恢复', confirm: true });
  const completed = await host.waitUntil(value => value.work.some(item => item.id === work.id && item.status === 'completed'), { label: 'alpha.2 跨版本完成' });
  expect(completed.work.find(item => item.id === work.id).active_worker_run_id).toBe(firstRun);
  const detail = await host.api('worker.run', { runId: firstRun, workspaceBinding: binding });
  expect(detail.run.result).toContain('UPGRADE_RESULT');
  expect(detail.inputs).toHaveLength(2);
  expect(detail.inputs.every(input => input.status === 'adopted')).toBe(true);
  expect(detail.deliveries[0].target).toBe(parent);
}, 600000);
