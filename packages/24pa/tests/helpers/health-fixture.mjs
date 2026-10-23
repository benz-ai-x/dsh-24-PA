import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgCluster } from './pg.mjs';
import { bootHost } from './host.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
const here = fileURLToPath(new URL('.', import.meta.url));
export async function createHealthFixture() {
  const root = await mkdtemp(join(tmpdir(), 'pa24-m07-')), workspace = join(root, 'workspace'), bin = join(root, 'bin');
  await mkdir(workspace); await mkdir(bin); const cluster = await startPgCluster();
  const larkState = join(root, 'lark.json'), wecomState = join(root, 'wecom.json');
  await writeFile(larkState, JSON.stringify({ appId: 'cli-test-app', ownerOpenId: 'ou_test_owner' }));
  await writeFile(wecomState, JSON.stringify({ ownerUserid: 'wou_test_owner' }));
  for (const [command, script] of [['lark-cli', 'stub-lark-cli.mjs'], ['wecom-cli', 'stub-wecom-cli.mjs']]) {
    await writeFile(join(bin, command), `#!/bin/sh\nexec '${process.execPath}' '${resolve(here, script)}' "$@"\n`); await chmod(join(bin, command), 0o755);
  }
  const source = (id, domain, platform) => ({ id, domain, platform, name: id === 'personal-calendar' ? '个人日历' : id === 'wecom-calendar' ? '企微日程' : '企微待办', purpose: 'personal',
    ownerId: platform === 'feishu' ? 'ou_test_owner' : 'wou_test_owner', resourceKind: platform === 'feishu' ? 'calendar' : 'authorized_scope', resourceId: platform === 'feishu' ? 'personal-cal' : 'authorized', filter: 'all', access: 'readwrite', enabled: true });
  const config = { ...DEFAULT_CONFIG, storage: process.env.PA24_E2E_STORAGE === 'sqlite' ? 'sqlite' : 'postgres', mode: 'feishu', ownerOpenId: 'ou_test_owner',
    calendarId: 'personal-cal', folderToken: 'folder-test', tasklistId: 'tasklist-test', notifyChannel: 'feishu', calendarChannel: 'feishu', todoChannel: 'wecom',
    sources: { version: 1, entries: [source('personal-calendar', 'calendar', 'feishu'), source('wecom-calendar', 'calendar', 'wecom'), source('wecom-todo', 'todo', 'wecom')],
      defaults: { calendar: 'personal-calendar', todo: 'wecom-todo' }, mappings: [], meetingDurationMinutes: 30 } };
  const configText = '# 本人规则，保存参数时必须保留。\n\n```json\n' + JSON.stringify(config, null, 2) + '\n```\n'; await writeFile(join(workspace, 'AGENTS.md'), configText);
  const env = { PA24_WORKSPACE: workspace, PA24_PG_DSN: cluster.dsn, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli-test-app', PA24_FEISHU_APP_SECRET: 'test-secret-not-disclosed',
    PA24_LARK_STUB_STATE: larkState, PA24_WECOM_STUB_STATE: wecomState, PATH: `${bin}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'offline-test-key' };
  let host;
  try {
    host = await bootHost({ env });
    await host.waitUntil(s => !!s.workspace && s.readiness.items.some(row => row.id === 'postgres' && row.state === 'ok'), { label: 'M07就绪' });
  } catch (error) { await host?.stop(); await cluster.stop(); await rm(root, { recursive: true, force: true }); throw error; }
  const lines = async path => { try { return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { return []; } };
  return { root, workspace, env, cluster, larkState, wecomState, get host() { return host; },
    calls: async () => [...await lines(larkState + '.calls.jsonl'), ...await lines(wecomState + '.calls.jsonl')],
    events: () => lines(larkState + '.events.jsonl'), todos: () => lines(wecomState + '.todos.jsonl'),
    async restart() { const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: hostRoot }); await host.waitUntil(s => !!s.workspace, { label: 'M07重启恢复' }); return host; },
    async stop() { await host?.stop(); await cluster?.stop(); await rm(root, { recursive: true, force: true }); } };
}
