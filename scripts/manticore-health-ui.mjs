// Isolated real-Loader UI fixture. All platform CLI calls use local stubs.
// Build first; keep this worktree's lib unchanged while the fixture is running.
import { createHealthFixture } from '../packages/24pa/tests/helpers/health-fixture.mjs';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
process.env.PA24_E2E_STORAGE ||= 'sqlite';
let fixture, stopping = false;
async function stop() { if (stopping) return; stopping = true; await fixture?.stop(); }
process.once('SIGINT', () => void stop().then(() => process.exit(0)));
process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
try {
  fixture = await createHealthFixture();
  const api = fixture.host.api, snapshot = await api('snapshot'), workspaceBinding = snapshot.workspaceBinding;
  await api('action', { type: 'health.check', workspaceBinding });
  const preview = await api('health.test.preview', { workspaceBinding, action: 'source.create', sourceId: 'personal-calendar' });
  const test = await api('action', { type: 'health.test', workspaceBinding, requestId: randomUUID(), ...preview, confirm: true });
  if (test.status !== 'succeeded') throw Error('fixture explicit test did not complete');
  await api('action', { type: 'workspace.config-update', workspaceBinding, expectedConfigHash: snapshot.workspace.sourceHash, config: { maxWorkers: 3 } });
  await writeFile(fixture.wecomState, JSON.stringify({ ownerUserid: process.argv.includes('--identity-change') ? 'wou_changed_person' : 'wou_test_owner', failNext: { command: 'calendar.list' } }));
  await api('action', { type: 'health.check', workspaceBinding, scopes: ['wecom'] });
  await appendFile(join(fixture.workspace, 'AGENTS.md'), '\n外部编辑的本地规则：刷新只读取，不自动应用。\n');
  console.log(JSON.stringify({ url: fixture.host.url, root: fixture.root, workspace: fixture.workspace, testId: test.id,
    platform: 'local stubs only; no external account writes', states: ['old configuration evidence', 'independent WeCom domain failure', 'known test object and cleanup', 'saved but unapplied source'] }, null, 2));
  if (process.argv.includes('--smoke')) {
    const evidence = await api('workspace.evidence', { workspaceBinding });
    if (evidence.state !== 'saved_not_applied') throw Error('fixture did not preserve saved-vs-active state');
    const result = await api('action', { type: 'health.test.cleanup', workspaceBinding, testId: test.id, confirm: true });
    if (result.cleanup?.state !== 'accepted') throw Error('fixture cleanup did not complete');
    await stop();
  } else await new Promise(() => {});
} catch (error) { await stop(); throw error; }
