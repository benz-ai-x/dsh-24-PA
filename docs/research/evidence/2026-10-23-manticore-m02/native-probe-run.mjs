import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootHost } from './host.mjs';
import { startMockLlm } from './mock-llm.mjs';
import { DEFAULT_CONFIG } from '/Users/pc2026/.codex/worktrees/manticore/dsh-24-PA/packages/24pa/lib/config.js';
const root = dirname(fileURLToPath(import.meta.url)), workspace = join(root, 'workspace'), scriptPath = join(root, 'script.json');
await writeFile(join(workspace, 'AGENTS.md'), '# M02 isolated\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite' }) + '\n```\n');
await writeFile(scriptPath, JSON.stringify({ steps: [{ text: 'M02_RESUMED' }] }));
const llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm.json') });
process.env.DSH_BIN = '/Users/pc2026/DSH-Space/deepseek-harness/apps/cli/lib/bin.js';
process.env.PA24_E2E_STORAGE = 'sqlite'; process.env.PA24_E2E_EXTRA_PLUGINS = join(root, 'plugin');
const env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', M02_PROBE_ROOT: root, DEEPSEEK_API_KEY: 'test', DEEPSEEK_BASE_URL: llm.url };
let host; const reports = [], delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const probe = async body => { const res = await fetch(host.origin + '/api/m02-probe', { method: 'POST', headers: { 'content-type': 'application/json', cookie: host.cookie }, body: JSON.stringify(body) }); const value = await res.json(); if (!value.ok) throw Error(value.error); return value.value; };
const until = async (read, check) => { const end = Date.now() + 15000; for (;;) { const value = await read(); if (check(value)) return value; if (Date.now() > end) throw Error('probe timeout ' + JSON.stringify(value)); await delay(100); } };
const inspect = id => probe({ action: 'inspect', id });
const done = (id, count) => until(() => inspect(id), value => value.events.filter(event => event.type === 'turn/end').length >= count);
const prompt = id => host.remote('session/prompt', { request: { sessionId: id, requestId: 'request-' + id, mode: 'queue', content: [{ type: 'text', text: '完成这次隔离验证。' }] } });
const restart = async () => { const previous = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ root: previous, env }); await host.waitUntil(value => !!value.workspace?.localSessionId); };
try {
  host = await bootHost({ env }); await host.waitUntil(value => !!value.workspace?.localSessionId);
  await probe({ action: 'create', id: 'm02-before-input', waiting: true }); await prompt('m02-before-input');
  let first = await done('m02-before-input', 1); assert.equal(first.row.claimed.length, 1); assert.equal(first.events.filter(e => e.type === 'step/start').length, 0); assert.equal(llm.requests.length, 0);
  const original = first.row.claimed[0].id; await restart(); await probe({ action: 'resume', id: 'm02-before-input', original: true });
  first = await done('m02-before-input', 2); assert.equal(first.events.filter(e => e.type === 'user/message' && e.data.id === original).length, 1);
  reports.push({ case: 'pre-step wait + restart', preservedMessageId: original, blockedTurns: 1, completedTurns: 1, modelCalls: llm.requests.length });
  await writeFile(scriptPath, JSON.stringify({ steps: [{ tool: { name: 'bash', input: { command: 'sleep 0.2', description: 'isolated model/tool clock', timeoutMs: 2000 } } }, { text: 'M02_CONTINUED' }] }));
  await probe({ action: 'create', id: 'm02-mid-run', waitAfterTool: true }); const wallStart = Date.now(); await prompt('m02-mid-run');
  const blocked = await done('m02-mid-run', 1); assert.equal(blocked.events.filter(e => e.type === 'turn/end')[0].data.reason.kind, 'blocked');
  assert.equal(blocked.events.filter(e => e.type === 'step/start').length, 1); await delay(1000); await restart(); await probe({ action: 'resume', id: 'm02-mid-run' });
  const resumed = await done('m02-mid-run', 2), events = resumed.events; const starts = new Map(); let activeMs = 0;
  for (const event of events) { const key = event.data.turn + ':' + event.data.step; if (event.type === 'step/start') starts.set(key, event.time); if (event.type === 'step/end') activeMs += event.time - starts.get(key); }
  assert.equal(events.filter(e => e.type === 'step/start').length, 2); assert.ok(activeMs >= 400 && activeMs < 1500, String(activeMs)); assert.ok(Date.now() - wallStart > activeMs + 1000);
  reports.push({ case: 'mid-run wait + restart', steps: 2, activeMs, wallMs: Date.now() - wallStart, sameSession: true });
  await probe({ action: 'create', id: 'm02-native-wake', waiting: true }); const before = llm.requests.length;
  const schedule = await probe({ action: 'schedule', id: 'm02-native-wake' }); const wake = await done('m02-native-wake', 1);
  const catalog = await until(() => probe({ action: 'catalog' }), value => value.find(row => row.id === schedule.id)?.lastDelivery);
  const entry = catalog.find(row => row.id === schedule.id); assert.equal(entry.status, 'inactive'); assert.equal(wake.row.claimed[0].source.kind, 'schedule'); assert.equal(entry.lastDelivery.messageId, wake.row.claimed[0].id);
  await probe({ action: 'delete', id: 'm02-native-wake', scheduleId: schedule.id }); assert.equal((await inspect('m02-native-wake')).row.claimed[0].id, entry.lastDelivery.messageId); assert.equal(llm.requests.length, before);
  reports.push({ case: 'native wake', actualScheduleId: schedule.id, messageId: entry.lastDelivery.messageId, scheduledAt: entry.lastDelivery.scheduledAt, blockedBeforeModel: true, deletedCatalogKeepsDeliveredInput: true });
  await writeFile(join(root, 'report.json'), JSON.stringify({ ok: true, reports }, null, 2)); console.log(JSON.stringify({ ok: true, root, reports }, null, 2));
} catch (error) { console.error(error); if (host) console.error(host.logs().stderr.slice(-4000)); process.exitCode = 1; }
finally { if (host) { await writeFile(join(root, 'host.log'), host.logs().stderr); await host.stop(); } await llm.close(); }
