// Boots the real dsh web Host (official CLI, real Loader) with the 24pa
// bundle installed into a throwaway profile, then talks to the plugin's
// /api/24pa endpoint over the authenticated loopback connection.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function dshBin() {
  return process.env.DSH_BIN || resolve(pkgDir, '../../../deepseek-harness/apps/cli/lib/bin.js');
}

const runSync = (bin, args, env, label) => {
  const result = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8', timeout: 180_000 });
  if (result.status !== 0) {
    throw new Error(`dsh ${label} 失败（exit ${result.status}）：\n${result.stderr}\n${result.stdout}`);
  }
  return result;
};

export async function bootHost({ env: extraEnv = {}, root: reuseRoot } = {}) {
  const root = reuseRoot ?? (await mkdtemp(join(tmpdir(), 'pa24-host-')));
  const bin = dshBin();
  const env = {
    ...process.env,
    DSH_HOME: join(root, 'home'),
    npm_config_cache: join(root, 'npm-cache'),
    DSH_TELEMETRY_DISABLED: '1',
    ...extraEnv,
  };
  const profileInitialized = existsSync(join(root, 'home/profiles/pa24-test/package.json'));
  if (!profileInitialized) {
    runSync(bin, ['--profile', 'pa24-test', '--from-default-profile', 'web', '--dump-config'], env, 'profile init');
  }
  runSync(bin, ['plugin', '--profile', 'pa24-test', 'add', pkgDir, '--ignore-scripts', '--store-dir', join(root, 'store')], env, 'plugin add');

  const child = spawn(process.execPath, [bin, '--profile', 'pa24-test', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk;
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const exited = new Promise(resolveExit => child.on('exit', resolveExit));

  const url = await new Promise((resolveUrl, rejectUrl) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const match = stdout.match(/dsh web: (https?:\/\/\S+)/);
      if (match) {
        clearInterval(timer);
        resolveUrl(match[1]);
      } else if (Date.now() - started > 90_000) {
        clearInterval(timer);
        rejectUrl(new Error(`Host 启动超时。stdout:\n${stdout}\nstderr:\n${stderr}`));
      } else if (child.exitCode !== null) {
        clearInterval(timer);
        rejectUrl(new Error(`Host 提前退出（${child.exitCode}）。stdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    }, 250);
  });

  // Exchange the one-time launch token for a session cookie (the same flow
  // the browser and dsh's own web-auth e2e use).
  const authResponse = await fetch(url, { redirect: 'manual' });
  const setCookie = authResponse.headers.get('set-cookie');
  if (!setCookie) throw new Error(`启动地址未返回会话 cookie：HTTP ${authResponse.status}\n${stdout}`);
  const cookie = setCookie.split(';')[0];
  const origin = new URL(url).origin;

  const api = async (endpoint, payload = {}) => {
    const response = await fetch(`${origin}/api/24pa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ endpoint, payload }),
    });
    if (!response.ok) throw new Error(`panel HTTP ${response.status}`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.error?.message ?? 'panel 调用失败');
    return result.value;
  };
  // Calls a dsh Remote method over the same authenticated /api surface the
  // web client uses (e.g. POST /api/session/prompt), so tests drive real UI
  // paths.
  const remote = async (method, args) => {
    const response = await fetch(`${origin}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `rpc-${Math.random().toString(36).slice(2)}`, method, payload: { args } }),
    });
    if (!response.ok) throw new Error(`remote ${method} HTTP ${response.status}`);
    const envelope = await response.json();
    const result = envelope.result ?? envelope;
    if (result && result.ok === false) throw new Error(result.error?.message ?? `remote ${method} 失败`);
    return result?.value ?? result;
  };
  const waitUntil = async (predicate, { timeoutMs = 60_000, intervalMs = 500, label = '条件' } = {}) => {
    const started = Date.now();
    for (;;) {
      const snapshot = await api('snapshot');
      if (predicate(snapshot)) return snapshot;
      if (Date.now() - started > timeoutMs) throw new Error(`等待${label}超时；最后状态：${JSON.stringify(snapshot).slice(0, 3000)}`);
      await new Promise(r => setTimeout(r, intervalMs));
    }
  };

  let stopped = false;
  return {
    root,
    url,
    api,
    remote,
    waitUntil,
    child,
    logs: () => ({ stdout, stderr }),
    async stop({ keepRoot = false } = {}) {
      if (stopped) return;
      stopped = true;
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
      if (!keepRoot) await rm(root, { recursive: true, force: true }).catch(() => {});
    },
  };
}
