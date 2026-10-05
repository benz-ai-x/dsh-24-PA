// npm's file: symlink for the vendored dsh dependency lands one level short;
// rebuild it relative to its final location so tsc and local tests resolve.
import { symlink, rm, mkdir, stat } from 'node:fs/promises';
import { relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(pkgDir, '../../../deepseek-harness/vendor/schemastery');
const linkDir = resolve(pkgDir, 'node_modules/@deepseek-ai');
const link = resolve(linkDir, 'schemastery');
try {
  await stat(resolve(target, 'lib/types/index.d.ts'));
} catch {
  console.error(`[pa24] 未找到本地 dsh vendored schemastery（${target}）；类型检查将缺少该依赖。`);
  process.exit(0);
}
await mkdir(linkDir, { recursive: true });
await rm(link, { recursive: true, force: true });
await symlink(relative(linkDir, target), link, 'dir');
console.log(`[pa24] linked @deepseek-ai/schemastery -> ${relative(linkDir, target)}`);
