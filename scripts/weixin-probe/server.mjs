import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import QRCode from 'qrcode';
import { Probe } from './probe.mjs';

process.umask(0o077);
const stateArg = process.argv.indexOf('--state-dir');
const directory = stateArg < 0 ? mkdtempSync(join(tmpdir(), '24pa-weixin-probe-')) : resolve(process.argv[stateArg + 1] ?? '');
if (![resolve(tmpdir()), '/private/tmp', '/tmp'].some(root => directory.startsWith(`${root}/`))) throw new Error('Use a private temporary state directory outside the repository');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const lockFile = join(directory, 'server.pid');
if (existsSync(lockFile)) {
  const pid = Number(readFileSync(lockFile, 'utf8'));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid existing probe lock');
  let alive = true;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
  if (alive) throw new Error('This probe already has a running server');
  unlinkSync(lockFile);
}
const fd = openSync(lockFile, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
let probe = new Probe(directory);
const capability = randomBytes(24).toString('hex');
const page = readFileSync(new URL('./index.html', import.meta.url));
let origin;
let shuttingDown = false;
let mutating = false;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'local_origin_required' });
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return; }
  if (req.headers.authorization !== `Bearer ${capability}`) return send(403, { error: 'local_session_required' });
  try {
    if (req.method === 'GET' && req.url === '/status') return send(200, probe.publicState());
    if (req.method === 'GET' && req.url === '/qr') {
      if (!probe.qr) return send(404, { error: 'no_qr' });
      const svg = await QRCode.toString(probe.qr.content, { type: 'svg', margin: 4, width: 320 });
      return send(200, { dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` });
    }
    if (req.method === 'GET' && req.url === '/evidence') return send(200, probe.exportEvidence());
    if (req.method !== 'POST') return send(404, { error: 'not_found' });
    if (mutating || shuttingDown) return send(409, { error: 'busy' });
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 2048) return send(413, { error: 'body_too_large' }); }
    const data = JSON.parse(raw || '{}');
    mutating = true;
    try {
      switch (req.url) {
        case '/login': await probe.startLogin(); break;
        case '/verify': probe.submitCode(data.code); break;
        case '/activate':
          if (data.scope !== 'owner-two-test-replies') return send(400, { error: 'test_scope_required' });
          await probe.activate(); break;
        case '/stop': await probe.stop(); break;
        case '/restore': {
          await probe.stop(); const oldRun = probe.state.run;
          probe = new Probe(directory); if (probe.state.run !== oldRun) throw new Error('restore_failed');
          probe.state.restored++; probe.event('component_restored'); break;
        }
        case '/visible': probe.confirmVisible(data.kind); break;
        default: return send(404, { error: 'not_found' });
      }
    } finally { mutating = false; }
    send(200, probe.publicState());
  } catch { send(400, { error: 'operation_failed_check_status' }); }
});
server.requestTimeout = 20_000;
server.listen(0, '127.0.0.1', () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  // This local-only capability is intentionally shown once, never included in the research evidence.
  console.log(`Test page: ${origin}/#${capability}`);
  console.log(`Private state: ${directory}`);
  console.log('No external request is made until you choose Connect in the page.');
});
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await probe.stop(); server.close(); server.closeAllConnections(); unlinkSync(lockFile);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
