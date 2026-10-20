import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
const f = await fixture();
const fakeSecret = 'FAKE_AUDIT_SECRET_NEVER_REAL';
const evidence = { scenario: 'Use a selectable directory that is also the Host stateDirectory as the workspace, store an explicitly fake key through runtime, then create and verify a joint backup.' };
try {
  for (const key of ['backupSessionsRoot', 'backupStoragesRoot', 'backupAttachmentsRoot']) {
    f.options[key] = join(f.root, key); await mkdir(f.options[key]);
  }
  const workspace = await f.workspace('state');
  await f.rt.bind(workspace);
  await f.rt.updateWorkspaceSecrets({ feishuAppSecret: fakeSecret });
  const result = await f.rt.maintenanceBackupCreate({ targetDir: join(f.root, 'backups') });
  const copiedPath = join(result.backupDir, 'dsh-state', '.24pa', 'secrets.json');
  const copied = await readFile(copiedPath, 'utf8').catch(() => '');
  const originalMode = (await stat(join(workspace, '.24pa', 'secrets.json'))).mode & 0o777;
  const copiedMode = await stat(copiedPath).then(s => s.mode & 0o777).catch(() => null);
  Object.assign(evidence, { workspaceEqualsStateDirectory: workspace === f.options.stateDirectory, backupComplete: result.complete, verifyComplete: (await f.rt.maintenanceBackupVerify({ backupDir: result.backupDir })).complete, backupFailures: result.failures, secretCopiedInAlternateCollection: copied.includes(fakeSecret), originalMode: originalMode.toString(8), copiedMode: copiedMode?.toString(8), leakedRelativePath: 'dsh-state/.24pa/secrets.json', workspaceCopyCorrectlyExcluded: await stat(join(result.backupDir, 'workspace', '.24pa', 'secrets.json')).then(()=>false).catch(()=>true) });
} finally { await f.cleanup(); }
await writeFile('/tmp/pa24-deep2-data-backup-secret-result.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
