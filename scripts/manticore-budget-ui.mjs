// Isolated real Loader fixture. Build before starting; no real account calls.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG } from '../packages/24pa/lib/config.js';
import { bootHost } from '../packages/24pa/tests/helpers/host.mjs';
import { startMockLlm } from '../packages/24pa/tests/helpers/mock-llm.mjs';
let root, host, llm, stopping = false;
async function stop() { if (stopping) return; stopping = true; await host?.stop(); await llm?.close(); if (root) await rm(root, { recursive: true, force: true }); }
process.once('SIGINT', () => void stop().then(() => process.exit(0)));
process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
try {
  process.env.PA24_E2E_STORAGE = 'sqlite';
  root = await mkdtemp(join(tmpdir(), 'pa24-budget-ui-')); const workspace = join(root, 'workspace'); await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), '# Isolated budget UI fixture\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', enabledWorkers: ['skill','memo'], budget: { ...DEFAULT_CONFIG.budget, maxRequests: 1 } }) + '\n```\n');
  const scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [{ text: '预算界面验收结果：完整输入保留。' }], onlySkillRuns: true }));
  llm = await startMockLlm({ scriptPath });
  host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url } });
  const binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
  const markdown = '---\n' + JSON.stringify({ name: 'budget-ui', description: '隔离验收', metadata: { track: 'agent', tools: [], pa24: { schemaVersion: 1, mode: 'local', parameters: {}, actions: [], expectedResult: '返回结果', completionCriteria: '保留原输入' } } }) + '\n---\n\n返回原输入的结果。';
  const created = await host.api('action', { type: 'skill.change', op: 'save', requestId: randomUUID(), workspaceBinding: binding, displayName: '预算界面验收', markdown });
  const id = 'managed:' + created.entry.id;
  await host.api('action', { type: 'skill.change', op: 'publish', requestId: randomUUID(), workspaceBinding: binding, id, expectedRevision: created.entry.revision, confirm: true });
  for (let i=0;i<2;i++) {
    const input = { id, versionId: created.entry.draft_version, parameters: {}, workspaceBinding: binding };
    const preview = await host.api('skills.preview', input);
    const { run } = await host.api('action', { type: 'skill.run', ...input, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true });
    const deadline = Date.now()+20000;
    while (Date.now()<deadline) { const detail=await host.api('skills.run', { runId: run.id, workspaceBinding: binding }); if (detail.run.status === (i ? 'waiting' : 'completed')) break; await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  console.log(JSON.stringify({ url: host.url, root, workspace, platform: 'local mock only', states: ['actual usage', 'unknown price', 'budget waiting', 'explicit one-time release'] }, null, 2));
  await new Promise(() => {});
} catch (error) { await stop(); throw error; }
