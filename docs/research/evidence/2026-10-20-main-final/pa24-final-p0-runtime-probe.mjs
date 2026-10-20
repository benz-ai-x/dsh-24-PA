import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bootHost } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/host.mjs';
import { startMockLlm } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/config.js';
process.env.DSH_BIN = '/Users/pc2026/DSH-Space/deepseek-harness/apps/cli/lib/bin.js';
process.env.PA24_E2E_STORAGE = 'sqlite';
const root = await mkdtemp(join(tmpdir(), 'pa24-final-p0-runtime-'));
const workspace = join(root, 'workspace'), scriptPath = join(root, 'script.json');
await mkdir(workspace);
await writeFile(join(workspace, 'AGENTS.md'), '# Isolated P0 audit\n\n```json\n' + JSON.stringify(DEFAULT_CONFIG) + '\n```\n');
const script = { mode: 'dispatch', delegate: [1,2,3].map(n => ({ worker: 'memo', title: `fault-${n}`, instruction: 'Read the empty local memory then report completion.' })), workerTool: { name: 'pa24_memory', input: { action: 'search', query: 'p0 isolated' } }, workerReply: 'LOCAL_READ_COMPLETED', leadReply: 'Admitted.' };
await writeFile(scriptPath, JSON.stringify(script));
const llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm.json') });
const env = { PA24_WORKSPACE: workspace, DEEPSEEK_BASE_URL: llm.url, DEEPSEEK_API_KEY: 'fixture-key', npm_config_offline: 'true' };
let host, db, hostRoot;
const pause = ms => new Promise(r => setTimeout(r, ms));
const rows = s => s.work.map(w => ({ id: w.id, title: w.title, status: w.status, result: w.result, recovery_gen: w.recovery_gen, progress: w.progress }));
const output = { commit: '0ef85772a10f45e8e3b4c4d2c85d7249bf28e256', root, model: 'loopback scripted only', config: DEFAULT_CONFIG, steps: [] };
try {
 host = await bootHost({ env }); hostRoot = host.root;
 let snapshot = await host.waitUntil(s => !!s.workspace?.localSessionId, { label: 'default startup' });
 output.steps.push({ action: 'default startup', ready: !!snapshot.workspace?.localSessionId, configError: snapshot.configError ?? null });
 db = new DatabaseSync(join(workspace, 'data', 'pa24.db'));
 db.exec("create trigger audit_fail_result before insert on pa24_outbox when NEW.dedup_key like 'workitem:%:result:%' begin select raise(abort, 'P0_AUDIT_RESULT_FAILURE'); end");
 await host.remote('session/prompt', { request: { requestId: 'fault-three', sessionId: snapshot.workspace.localSessionId, mode: 'queue', content: [{ type: 'text', text: 'Please do the three independent local read requests.' }] } });
 for (let i=0;i<300 && host.logs().stderr.split('P0_AUDIT_RESULT_FAILURE').length - 1 < 2;i++) await pause(100);
 assert(host.logs().stderr.split('P0_AUDIT_RESULT_FAILURE').length - 1 >= 2, 'Both default worker slots must hit the controlled settlement fault');
 db.exec('drop trigger audit_fail_result');
 await pause(4200);
 snapshot = await host.api('snapshot');
 output.steps.push({ action: 'fault removed, normal dispatcher cycles allowed', fault: 'real SQLite trigger blocked final result Outbox inserts', waitMs: 4200, work: rows(snapshot), resultOutbox: snapshot.outbox.filter(o => o.dedup_key.startsWith('workitem:')).map(o => ({ key: o.dedup_key, status: o.status })) });
 assert.equal(snapshot.work.filter(w => w.status === 'running').length, DEFAULT_CONFIG.maxWorkers);
 assert.equal(snapshot.work.filter(w => w.status === 'queued').length, 1);
 // No manual work stop or ledger rewrite: ordinary same-profile shutdown and start.
 db.close(); db = null;
 await host.stop({ keepRoot: true }); host = null;
 host = await bootHost({ env, root: hostRoot });
 snapshot = await host.waitUntil(s => s.work.filter(w => w.title.startsWith('fault-')).length === 3 && s.work.filter(w => w.title.startsWith('fault-')).every(w => w.status === 'completed'), { label: 'ordinary restart settles retained work', timeoutMs: 45000 });
 output.steps.push({ action: 'ordinary same-profile restart', work: rows(snapshot), resultOutbox: snapshot.outbox.filter(o => o.dedup_key.startsWith('workitem:')).map(o => ({ key: o.dedup_key, status: o.status })), nativeResultsPresent: llm.log.filter(r => r.tools.includes('pa24_work')).length });
 // New ordinary work still runs after recovery, with the unchanged default config.
 await writeFile(scriptPath, JSON.stringify({ ...script, delegate: [{ worker: 'memo', title: 'healthy-after-restart', instruction: 'Read local memory and finish.' }] }));
 await host.remote('session/prompt', { request: { requestId: 'normal-after-restart', sessionId: snapshot.workspace.localSessionId, mode: 'queue', content: [{ type: 'text', text: 'Do one fresh local read request.' }] } });
 snapshot = await host.waitUntil(s => s.work.some(w => w.title === 'healthy-after-restart' && w.status === 'completed'), { label: 'healthy new request' });
 output.steps.push({ action: 'new ordinary request after restart', work: rows(snapshot), totalWork: snapshot.work.length });
 output.error = null;
} catch(e) {
 output.error = String(e.stack ?? e);
 if (host) output.lastSnapshot = await host.api('snapshot').then(rows).catch(e => ({ error: e.message }));
} finally {
 db?.close();
 if (host) { await writeFile(join(root, 'host-log.json'), JSON.stringify(host.logs(), null, 2)); await host.stop({ keepRoot: true }); }
 await llm.close();
 output.hostRoot = hostRoot;
 output.modelRequests = llm.log.length;
 await writeFile('/tmp/pa24-final-p0-runtime-result.json', JSON.stringify(output, null, 2));
 console.log(JSON.stringify(output, null, 2));
}
