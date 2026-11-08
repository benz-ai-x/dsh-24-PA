import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

test('loopback page is idle, API requires the local capability and same origin, and one process owns a directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), '24pa-weixin-server-unit-'));
  const child = spawn(process.execPath, ['server.mjs', '--state-dir', directory], { cwd: new URL('.', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('server_start_timeout')), 5000);
      child.stdout.on('data', data => { output += data; const match = output.match(/Test page: (http:\/\/127\.0\.0\.1:\d+\/#\w+)/); if (match) { clearTimeout(timer); resolve(new URL(match[1])); } });
      child.once('exit', () => { clearTimeout(timer); reject(Error('server_start_failed')); });
    });
    const auth = { Authorization: `Bearer ${url.hash.slice(1)}` };
    assert.equal((await fetch(url.origin)).status, 200);
    assert.equal((await fetch(`${url.origin}/status`)).status, 403);
    assert.equal((await fetch(`${url.origin}/status`, { headers: { ...auth, Origin: 'https://other.test' } })).status, 403);
    const state = await (await fetch(`${url.origin}/status`, { headers: auth })).json();
    assert.equal(state.phase, 'unbound'); assert.equal(state.recentEvents.length, 0); assert.equal(state.deliveries.length, 0);
    assert.equal((await fetch(`${url.origin}/activate`, { method: 'POST', headers: auth, body: '{}' })).status, 400);
    const duplicate = spawn(process.execPath, ['server.mjs', '--state-dir', directory], { cwd: new URL('.', import.meta.url), stdio: 'ignore' });
    assert.notEqual((await once(duplicate, 'exit'))[0], 0);
    assert.equal((await fetch(`${url.origin}/status`, { headers: auth })).status, 200);
  } finally {
    const done = once(child, 'exit'); child.kill('SIGTERM'); await done;
    rmSync(directory, { recursive: true, force: true });
  }
});
