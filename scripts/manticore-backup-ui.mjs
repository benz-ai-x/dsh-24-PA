// Actual local Loader / SQLite UI fixture; mock model, no external accounts.
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
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
  root = await mkdtemp(join(tmpdir(), 'pa24-backup-ui-')); const workspace = join(root, 'workspace'); await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), '# Isolated backup UI fixture\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', enabledWorkers: ['memo'] }) + '\n```\n');
  const scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [] }));
  llm = await startMockLlm({ scriptPath });
  host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url } });
  const snapshot = await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId);
  const decode = value => { if (typeof value === 'string') { try { return decode(JSON.parse(value)); } catch { return value; } } if (Array.isArray(value)) return value.map(decode).find(value => value && typeof value === 'object' && !Array.isArray(value)) ?? value; if (value?.type === 'text') return decode(value.text); return value; };
  const maintain = async input => {
    const start = llm.log.length;
    await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', leadTool: { name: 'pa24_maintenance', input }, leadReply: '已完成本次隔离操作。' }));
    await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: snapshot.workspace.localSessionId, mode: 'queue', content: [{ type: 'text', text: '主人发起隔离验收 ' + JSON.stringify(input) }], clientTimeZone: 'Asia/Shanghai' } });
    for (let i = 0; i < 600; i++) { const requests = llm.log.slice(start); if (requests.length >= 2 && requests.at(-1).toolResults?.at(-1)) return decode(requests.at(-1).toolResults.at(-1)); await new Promise(resolve => setTimeout(resolve, 50)); }
    throw Error('Maintenance timed out');
  };
  // Start empty, then create real success / failure / drill records on demand.
  console.log(JSON.stringify({ url: host.url, root, workspace, commandFile: join(root, 'command') }, null, 2));
  let populated = false;
  setInterval(async () => {
    if (populated || await readFile(join(root, 'command'), 'utf8').catch(() => '') !== 'populate') return;
    populated = true;
    try {
      const created = await maintain({ action: 'backup_create', requestId: randomUUID(), targetDir: join(root, 'backups') });
      await maintain({ action: 'backup_verify', requestId: randomUUID(), backupDir: created.backupDir });
      const preview = await maintain({ action: 'backup_preview', backupDir: created.backupDir });
      await maintain({ action: 'backup_restore_check', requestId: randomUUID(), backupDir: created.backupDir, targetDir: join(root, 'isolated'), previewToken: preview.previewToken, confirm: true });
      await maintain({ action: 'backup_verify', requestId: randomUUID(), backupDir: join(root, 'missing-backup') });
      console.log(JSON.stringify({ populated: true, backupDir: created.backupDir, modelRequests: llm.log.length }));
    } catch (error) { console.error(error); }
  }, 500);
  await new Promise(() => {});
} catch (error) { await stop(); throw error; }
