import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMockLlm } from '../helpers/mock-llm.mjs';

let root, scriptPath, llm;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-mock-llm-'));
  scriptPath = join(root, 'script.json');
});
afterEach(async () => {
  await llm?.close();
  llm = null;
  await rm(root, { recursive: true, force: true });
});
const request = async () => {
  const response = await fetch(llm.url + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }) });
  expect(response.status).toBe(200);
  return response.text();
};

it.each(['dispatch', 'native-run'])('%s 只读脚本请求不得回写旧快照', async mode => {
  const script = mode === 'dispatch' ? { mode, defaultReply: 'done' } : { mode, rootStep: { text: 'done' } };
  await writeFile(scriptPath, JSON.stringify(script));
  await utimes(scriptPath, 0, 0);
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json') });
  expect(await request()).toContain('done');
  expect((await stat(scriptPath)).mtimeMs).toBe(0);
});

it('顺序脚本仍原子保存游标', async () => {
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: 'done' }] }));
  await utimes(scriptPath, 0, 0);
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json') });
  expect(await request()).toContain('done');
  expect((await stat(scriptPath)).mtimeMs).toBeGreaterThan(0);
  expect(JSON.parse(await readFile(scriptPath, 'utf8')).nextIndex).toBe(1);
});
