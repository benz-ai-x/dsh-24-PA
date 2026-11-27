// Boots the real dsh web Host (official CLI, real Loader) with the 24pa
// bundle installed into a throwaway profile, then talks to the plugin's
// /api/24pa endpoint over the authenticated loopback connection.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, delimiter, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactString } from '../../scripts/secrets/redact.mjs';

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

export async function bootHost({ env: extraEnv = {}, root: reuseRoot, bin: requestedBin, packageSpec: requestedPackage, extraPlugins, vendorClis = {}, beforeBoot } = {}) {
  const root = reuseRoot ?? (await mkdtemp(join(tmpdir(), 'pa24-host-')));
  // F25 backend matrix: PA24_E2E_STORAGE=sqlite flips the workspace AGENTS.md
  // to the SQLite ledger before the host boots, so the same suite runs
  // against both backends without per-file config forks.
  if (extraEnv.PA24_WORKSPACE) {
    const storage = process.env.PA24_E2E_STORAGE === 'sqlite' ? 'sqlite' : 'postgres';
    const { readFile, writeFile } = await import('node:fs/promises');
    const agentsPath = join(extraEnv.PA24_WORKSPACE, 'AGENTS.md');
    const source = await readFile(agentsPath, 'utf8');
    if (!source.includes('"storage"')) {
      await writeFile(agentsPath, source.replace(/(```json\s*\n\{)\n/, `$1\n  "storage": "${storage}",\n`));
    }
    if (storage === 'sqlite') {
      const { setE2eSqliteWorkspace } = await import('./pg.mjs');
      await setE2eSqliteWorkspace(extraEnv.PA24_WORKSPACE);
    }
  }
  const bin = requestedBin ?? dshBin();
  const packageSpec = requestedPackage ?? process.env.PA24_E2E_PACKAGE ?? pkgDir;
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
  runSync(bin, ['plugin', '--profile', 'pa24-test', 'add', packageSpec, '--ignore-scripts', '--store-dir', join(root, 'store')], env, 'plugin add');
  // Optional companion plugins for runtime-variant runs: on dsh 0.2.0-rc.2 the
  // web host ships no schedule service, so digest e2e needs the experimental
  // schedule bundle (0.2.1-alpha.1 carries the service in the web patch). An
  // entry may carry its own pnpm flags after the package spec.
  for (const extra of extraPlugins ?? (process.env.PA24_E2E_EXTRA_PLUGINS ?? '').split(',').filter(Boolean)) {
    runSync(bin, ['plugin', '--profile', 'pa24-test', 'add', ...extra.split(' ').filter(Boolean), '--ignore-scripts', '--store-dir', join(root, 'store')], env, `extra plugin add (${extra})`);
  }
  // Entries of the profile's own patch layer, written once below so that no
  // entry overwrites another.
  const layers = [], cli = {};
  // The plugin never looks a vendor CLI up on PATH by itself (#306), but on a
  // host line without the official connectors its row names the bare
  // executables, which a child process would resolve on PATH. So the row
  // always names a file: a stand-in the test put on PATH, else a path that
  // does not exist — or the value `vendorClis` gives. Only stand-ins under the
  // temporary directory qualify, so a vendor CLI installed on this machine is
  // never handed to the plugin. A test of the row naming nothing passes `false`.
  if (vendorClis) {
    const temporary = [tmpdir(), realpathSync(tmpdir())];
    const standIns = (extraEnv.PATH ?? process.env.PATH ?? '').split(delimiter)
      .filter(entry => temporary.some(dir => entry === dir || entry.startsWith(`${dir}${sep}`)));
    const missing = join(root, 'no-vendor-cli');
    // A patch layer replaces a row's `config` wholesale, so the plugin row's
    // config is restated as the bundle generates it, then given the two paths.
    const lines = (await readFile(join(pkgDir, 'cordis.patch.yml'), 'utf8')).split('\n');
    const start = lines.findIndex(line => /^\s*- id: pa24\s*$/.test(line));
    const pad = lines[start].match(/^\s*/)[0].length;
    const row = [];
    for (let index = start; index < lines.length; index++) {
      const line = lines[index];
      // The row ends where the next entry of the insert list begins.
      if (index > start && line.trim() && !line.startsWith(' '.repeat(pad + 2))) break;
      row.push(line.slice(pad));
    }
    for (const [key, name] of [['larkCliBin', 'lark-cli'], ['wecomCliBin', 'wecom-cli']]) {
      const dir = standIns.find(entry => existsSync(join(entry, name)));
      cli[key] = vendorClis[key] ?? (dir === undefined ? join(missing, name) : join(dir, name));
    }
    layers.push(`${row.join('\n').trimEnd()}\n${Object.entries(cli).map(([key, path]) => `    ${key}: ${JSON.stringify(path)}`).join('\n')}\n`);
  }
  // A boot that leaves the row without a file path — `vendorClis: false`, or a
  // bare name a test gives — must not let a child process resolve that name on
  // this machine's PATH, whatever the host line does with it. Those boots run
  // with PATH holding a directory with nothing but node in it, which the
  // stand-ins need; where a link cannot be made, Node's own directory stands in.
  if (vendorClis === false || Object.values(cli).some(path => !path.includes(sep))) {
    const onlyNode = join(root, 'only-node');
    await mkdir(onlyNode, { recursive: true });
    try {
      // A reused root already carries the link.
      await symlink(process.execPath, join(onlyNode, process.platform === 'win32' ? 'node.exe' : 'node')).catch(error => { if (error.code !== 'EEXIST') throw error; });
      env.PATH = onlyNode;
    } catch {
      env.PATH = dirname(process.execPath);
    }
  }
  // Runs once the profile's packages are in place and before the Host reads
  // them: a test stands in for what an ignored install script would have
  // downloaded, or adds an entry to the patch layer through `addPatch`.
  const profile = join(root, 'home/profiles/pa24-test');
  if (beforeBoot) await beforeBoot({ root, profile, addPatch: entry => layers.push(`${entry.trimEnd()}\n`) });
  if (layers.length) await writeFile(join(profile, 'cordis.patch.yml'), layers.join(''));

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
    async exportSession(sessionId) {
      const response = await fetch(`${origin}/api/session.export?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=false`, { headers: { cookie } });
      if (!response.ok) throw new Error(`session export HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
    waitUntil,
    child,
    // Startup stdout carries the one-time launch token; redact before the
    // captured logs can be written into evidence files (#228).
    logs: () => ({ stdout: redactString(stdout), stderr: redactString(stderr) }),
    async stop({ keepRoot = false } = {}) {
      if (stopped) return;
      stopped = true;
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))]);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      if (process.env.PA24_E2E_STORAGE === 'sqlite') {
        const { closeE2eSqlite } = await import('./pg.mjs');
        await closeE2eSqlite();
      }
      if (!keepRoot) await rm(root, { recursive: true, force: true }).catch(() => {});
    },
  };
}
