// Real Loader / native Session / SQL fault. Only model and external platform
// are controlled: successful document creates are counted across recovery.
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';

const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pa24-settlement-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const storage = process.env.PA24_E2E_STORAGE === 'sqlite' ? 'sqlite' : 'postgres';
  const cluster = storage === 'postgres' ? await startPgCluster() : null;
  if (cluster) cleanup.push(() => cluster.stop());
  const workspace = join(root, 'workspace'), bin = join(root, 'bin'), state = join(root, 'lark.json'), scriptPath = join(root, 'script.json');
  await mkdir(workspace); await mkdir(bin);
  await writeFile(join(workspace, 'AGENTS.md'), '# Settlement acceptance\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, mode: 'feishu', ownerOpenId: 'ou_test_owner', folderToken: 'fld_test', tasklistId: 'tl_test' }) + '\n```\n');
  await writeFile(state, JSON.stringify({ ownerOpenId: 'ou_test_owner' }));
  await writeFile(join(bin, 'lark-cli'), `#!/bin/sh\nexec "${process.execPath}" "${resolve('tests/helpers/stub-lark-cli.mjs')}" "$@"\n`);
  await chmod(join(bin, 'lark-cli'), 0o755);
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch',
    delegate: [1, 2, 3].map(n => ({ worker: 'memo', title: `settle-${n}`, instruction: '保存一份备忘并报告完成。' })),
    workerAction: { action: 'memo_save', topic: '结算验收', content: '外部动作成功，结果待交付', source: '本人明确交办' },
    workerReply: 'DOCUMENT_CREATED_ONCE', leadReply: '已安排。' }));
  const llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm.json') });
  cleanup.push(() => llm.close());
  const env = { PA24_WORKSPACE: workspace, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}),
    PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'test_secret', PA24_TRANSPORT: 'fake',
    DEEPSEEK_BASE_URL: llm.url, DEEPSEEK_API_KEY: 'test-key', PA24_LARK_STUB_STATE: state, PATH: `${bin}:${process.env.PATH}` };
  let host = await bootHost({ env }); const hostRoot = host.root;
  cleanup.push(async () => { await host.stop(); await rm(hostRoot, { recursive: true, force: true }); });
  const ready = await host.waitUntil(s => !!s.workspace?.localSessionId && s.transport?.connected, { label: 'settlement ready' });
  const sqlite = storage === 'sqlite' ? new DatabaseSync(join(workspace, 'data', 'pa24.db')) : null;
  if (sqlite) cleanup.push(() => sqlite.close());
  if (sqlite) sqlite.exec("create trigger fail_settlement before insert on pa24_outbox when NEW.dedup_key like 'workitem:%:result:%' begin select raise(abort, 'V16_RESULT_FAULT'); end");
  else await cluster.query("create function fail_settlement() returns trigger language plpgsql as $$ begin if NEW.dedup_key like 'workitem:%:result:%' then raise exception 'V16_RESULT_FAULT'; end if; return NEW; end $$; create trigger fail_settlement before insert on pa24.outbox for each row execute function fail_settlement()");
  await host.remote('session/prompt', { request: { requestId: 'three', sessionId: ready.workspace.localSessionId, mode: 'queue', content: [{ type: 'text', text: '请办理这三个独立事项。' }] } });
  await host.waitUntil(s => s.work.length === 3 && s.work.filter(w => w.status === 'running').length === 2 && s.work.filter(w => w.status === 'queued').length === 1, { label: 'default two slots occupied' });
  for (let i = 0; i < 100 && host.logs().stderr.split('V16_RESULT_FAULT').length - 1 < 2; i++) await delay(100);
  expect(host.logs().stderr.split('V16_RESULT_FAULT').length - 1).toBeGreaterThanOrEqual(2);
  const docs = async () => (await readFile(`${state}.docs.jsonl`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(await docs()).toHaveLength(2);
  expect(llm.log.filter(r => r.tools.includes('pa24_work') && !r.tools.includes('pa24_delegate'))).toHaveLength(4);
  return { get host() { return host; }, llm, docs,
    async history(id) {
      const archive = join(root, 'session.zip');
      await writeFile(archive, await host.exportSession(id));
      const { stdout } = await promisify(execFile)('unzip', ['-p', archive, 'session*.jsonl']);
      return stdout.trim().split('\n').map(line => JSON.parse(line));
    },
    async removeFault() { if (sqlite) sqlite.exec('drop trigger fail_settlement'); else await cluster.query('drop trigger fail_settlement on pa24.outbox; drop function fail_settlement()'); },
    async restart() { await host.stop({ keepRoot: true }); host = await bootHost({ env, root: hostRoot }); },
  };
}

for (const restart of [false, true]) it(`V16: ${restart ? 'restart recovers durable original turns' : 'same Host retries without another event'} and releases both default slots`, async () => {
  const f = await setup();
  // Shutdown happens while SQL still rejects settlement. Native durable logs,
  // not an in-memory retry list or a successful result INSERT, must suffice.
  if (restart) {
    await f.host.stop({ keepRoot: true });
    await f.removeFault(); await f.restart();
  } else await f.removeFault();
  const snapshot = await f.host.waitUntil(s => s.work.length === 3 && s.work.every(w => w.status === 'completed'), { timeoutMs: 15_000, label: 'original turns settle automatically' });
  expect(snapshot.work.every(w => w.recovery_gen === 0)).toBe(true);
  expect(snapshot.work.every(w => w.result === 'DOCUMENT_CREATED_ONCE')).toBe(true);
  expect(snapshot.outbox.filter(r => r.dedup_key.startsWith('workitem:') && r.dedup_key.includes(':result:'))).toHaveLength(3);
  expect(await f.docs()).toHaveLength(3);
  const workerRequests = f.llm.log.filter(r => r.tools.includes('pa24_work') && !r.tools.includes('pa24_delegate'));
  expect(workerRequests).toHaveLength(6);
  expect(workerRequests.some(r => r.lastUserText.includes('[恢复 第'))).toBe(false);
  const observations = [];
  for (const item of snapshot.work) {
    const events = await f.history(item.child_session_id);
    const inputs = new Set();
    for (const event of events) {
      const messages = event.type === 'agent/inbox/spliced' ? event.data.inserted ?? [] : event.type === 'user/message' ? [event.data] : [];
      for (const message of messages) {
        if (message.source?.kind === 'user' || (message.source?.kind === 'agent-message' && message.source.senderSessionId === item.parent_session_id)) inputs.add(message.id);
      }
    }
    const turns = events.filter(event => event.type === 'turn/start').length;
    expect(inputs.size).toBe(1); expect(turns).toBe(1);
    observations.push({ title: item.title, generation: item.recovery_gen, acceptedInputs: inputs.size, turns });
  }
  console.log(JSON.stringify({ recovery: restart ? 'restart' : 'same-host', work: observations,
    workerModelRequests: workerRequests.length, externalDocuments: (await f.docs()).length, resultIntents: 3 }));
});
