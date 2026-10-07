// Dev-only peer links: the local harness checkout provides schemastery
// (vendored) and dsh-schedule for tsc and local unit tests. These links live
// in our own node_modules — which npm never packs — so directory installs of
// the plugin never drag harness paths into consumer profiles (that leak once
// broke runtime imports under dsh 0.2.0-rc.2; registry installs were immune
// because devDependencies do not ship).
import { symlink, rm, mkdir, stat } from 'node:fs/promises';
import { relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harness = resolve(pkgDir, '../../../deepseek-harness');
const linkDir = resolve(pkgDir, 'node_modules/@deepseek-ai');

const targets = [
  ['schemastery', resolve(harness, 'vendor/schemastery'), 'lib/types/index.d.ts'],
  ['dsh-schedule', resolve(harness, 'packages/schedule/schedule'), 'lib/types/index.d.ts'],
];

await mkdir(linkDir, { recursive: true });
for (const [name, target, probe] of targets) {
  const link = resolve(linkDir, name);
  try {
    await stat(resolve(target, probe));
  } catch {
    console.error(`[pa24] 未找到本地 ${name}（${target}）；类型检查将缺少该依赖。`);
    continue;
  }
  await rm(link, { recursive: true, force: true });
  await symlink(relative(linkDir, target), link, 'dir');
  console.log(`[pa24] linked @deepseek-ai/${name} -> ${relative(linkDir, target)}`);
}
