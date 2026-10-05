// Starts only the disposable profile owned by this workspace.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'prototypes/24pa-dsh');
const env = { ...process.env, DSH_HOME: resolve(process.env.PA24_DSH_HOME || join(root, '.prototype-runtime/home')), npm_config_cache: join(root, '.prototype-runtime/npm-cache') };
function run(command, args, cwd = root, quiet = false) {
  const result = spawnSync(command, args, { cwd, env, stdio: quiet ? ['inherit', 'ignore', 'inherit'] : 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 未完成，exit ${result.status}`);
}
if (process.argv.includes('--pack')) {
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  run('npm', ['pack', '--pack-destination', join(root, 'artifacts')], bundle);
  process.exit(0);
}
const sourceCli = process.env.PA24_DSH_CLI || resolve(root, '../deepseek-harness/apps/cli/lib/bin.js');
const command = existsSync(sourceCli) ? process.execPath : 'dsh';
const prefix = existsSync(sourceCli) ? [sourceCli] : [];
if (!existsSync(join(bundle, 'node_modules/@larksuiteoapi/node-sdk/package.json'))) {
  run('npm', ['ci', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], bundle);
}
if (!existsSync(join(env.DSH_HOME, 'profiles/pa24-prototype/package.json'))) {
  run(command, [...prefix, '--profile', 'pa24-prototype', '--from-default-profile', 'web', '--dump-config'], root, true);
}
run(command, [...prefix, 'plugin', '--profile', 'pa24-prototype', 'add', bundle, '--ignore-scripts', '--store-dir', join(root, '.pnpm-store')]);
console.log(`24PA 可丢弃原型 · 独立 DSH_HOME: ${env.DSH_HOME}\n模式: ${env.PA24_MODE || 'demo'} · Ctrl+C 停止。`);
const child = spawn(command, [...prefix, '--profile', 'pa24-prototype', '--host', env.PA24_BIND_HOST || '127.0.0.1', '--port', env.PA24_PORT || '3210', '--no-open'], { env, cwd: root, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 0 : 1); });
