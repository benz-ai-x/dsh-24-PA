import { afterAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

// dsh 0.2.3 derives no fallback title for a child whose first task is an agent
// message (through  0.2.2-rc.5 it used the first user message), so the plugin
// names the worker session itself. The worker session shows in the Host session
// list and in the "original session" entry of run history.
let root, host, llm;

afterAll(async () => {
  await host?.stop();
  await llm?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

it('Worker 子会话在宿主会话列表中以子代理标签为标题', async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-worker-title-'));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), '# 标题验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', enabledWorkers: ['memo'] }) + '\n```');
  const title = '带标题的普通交办';
  const scriptPath = join(root, 'script.json');
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch',
    delegate: { worker: 'memo', title, instruction: '只完成原目标', completionCriteria: '结果包含可核对出处' },
    workerTool: { name: 'pa24_run', input: { action: 'progress', stage: '已核对输入', completed: '完成原资料核对', next: '交付结果' } },
    workerReply: 'TITLE_RESULT：子会话标题验证完成。', leadReply: '已交办。' }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json') });
  const env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url };
  host = await bootHost({ env });
  const binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
  const parent = (await host.api('snapshot')).workspace.localSessionId;
  await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: parent, mode: 'queue', content: [{ type: 'text', text: title }], clientTimeZone: 'Asia/Shanghai' } });
  const completed = await host.waitUntil(value => value.work.some(work => work.title === title && work.status === 'completed'), { label: '交办完成' });
  const work = completed.work.find(item => item.title === title);
  const child = work.child_session_id ?? work.id;
  const { items } = await host.remote('session/list', { _request: {} });
  const projectionsOf = id => { const item = items.find(row => row.sessionId === id); return item?.projections?.values ?? item?.projections ?? {}; };
  const catalog = projectionsOf(parent).subagentCatalog ?? [];
  expect(catalog.some(row => row.id === child)).toBe(true);
  expect(projectionsOf(child).title).toBe(`备忘整理 · ${title}`);
}, 600000);
