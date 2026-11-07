// Real isolated dsh client; no production account or 8010 changes.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootHost } from '../tests/helpers/host.mjs';
import { DEFAULT_CONFIG } from '../lib/config.js';
process.env.PA24_E2E_STORAGE = 'sqlite';
const root = await mkdtemp(join(tmpdir(), 'pa24-f52-ui-')), workspace = join(root, 'workspace');
await mkdir(workspace);
await writeFile(join(workspace, 'AGENTS.md'), '# F52 isolated acceptance\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'demo', ownerOpenId: 'ou_f52_fixture', tts: { ...DEFAULT_CONFIG.tts, engine: 'volcengine', voice: 'zh_female_shuangkuaisisi_moon_bigtts' } }, null, 2) + '\n```\n');
let host;
try {
  host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_PG_DSN: 'f52-fixture-env', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:9' } });
  const ready = await host.waitUntil(s => s.workspace?.config);
  await writeFile(process.env.PA24_F52_UI_STATE || '/private/tmp/24pa-f52-ui-session.json', JSON.stringify({ url: host.url, workspace, binding: ready.workspaceBinding }));
  console.log('F52 real client ready; isolated launch address in /private/tmp/24pa-f52-ui-session.json');
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
} finally { await host?.stop(); await rm(root, { recursive: true, force: true }); }
