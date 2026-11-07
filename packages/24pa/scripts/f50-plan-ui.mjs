// Real isolated dsh client; no production account or 8010 changes.
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../tests/helpers/host.mjs';
import { seedLegacyPlan } from '../tests/helpers/legacy-plan-fixture.mjs';
import { DEFAULT_CONFIG } from '../lib/config.js';
process.env.PA24_E2E_STORAGE = 'sqlite';
const root = await mkdtemp(join(tmpdir(), 'pa24-f50-ui-')), workspace = join(root, 'workspace');
await mkdir(workspace);
const bin = join(root, 'lark-cli'), state = join(root, 'lark-state.json');
await writeFile(state, JSON.stringify({ ownerOpenId: 'ou_fixture', appId: 'cli_test_app' }));
await writeFile(bin, '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
await writeFile(join(workspace, 'AGENTS.md'), '# F50 isolated acceptance\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu', ownerOpenId: 'ou_fixture', folderToken: 'folder', tasklistId: 'list', extraBusinessSkills: ['daily-planning', 'daily-review'] }, null, 2) + '\n```\n');
let host;
try {
  host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'fixture', PATH: root + ':' + process.env.PATH, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:9' } });
  const ready = await host.waitUntil(s => s.workspace?.config && s.transport?.connected), binding = ready.workspaceBinding;
  const legacy = await seedLegacyPlan(host, null, { kind: 'weekly', title: '原有语音周报', voice: true, time: '09:00:00', timeZone: 'Asia/Tokyo', weekdays: [2, 6] });
  await host.api('action', { type: 'digest.run-now', planId: legacy.id });
  const draft = await host.api('plans.draft', { preset: 'morning', workspaceBinding: binding });
  await host.api('action', { type: 'plan.change', op: 'save', ...draft.form, workspaceBinding: binding, requestId: randomUUID(), delivery: { ...draft.form.delivery, voice: true } });
  await writeFile('/private/tmp/24pa-f50-ui-session.json', JSON.stringify({ url: host.url, workspace, binding, legacyId: legacy.id }));
  console.log('F50 real client ready; isolated launch address in /private/tmp/24pa-f50-ui-session.json');
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
} finally { await host?.stop(); await rm(root, { recursive: true, force: true }); }
