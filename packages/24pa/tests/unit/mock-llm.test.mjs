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
const request = async (payload = {}) => {
  const response = await fetch(llm.url + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }], ...payload }) });
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

it.each(['old-tool-result', 'settlement-notice'])('明确的新维护指令与 %s 合并时仍执行一次，旧回执本身不触发维护', async kind => {
  const leadRequestText = '隔离测试：本人明确备份 request-unique';
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', leadRequestText,
    leadTool: { name: 'pa24_maintenance', input: { action: 'backup_create', requestId: 'request-unique' } }, leadReply: '已返回结果' }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json') });
  const older = kind === 'old-tool-result' ? { type: 'tool_result', tool_use_id: 'old-delegation', content: '已接纳旧交办' }
    : { type: 'text', text: 'Background subagent finished' };
  const tools = [{ name: 'pa24_delegate' }, { name: 'pa24_maintenance' }];
  const mixed = await request({ tools, messages: [{ role: 'user', content: [older, { type: 'text', text: leadRequestText }] }] });
  expect(mixed).toContain('"type":"tool_use"'); expect(mixed).toContain('"name":"pa24_maintenance"');
  const stale = await request({ tools, messages: [{ role: 'user', content: [older] }] });
  expect(stale).not.toContain('"type":"tool_use"'); expect(stale).toContain('已返回结果');
});

it('顺序脚本仍原子保存游标', async () => {
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: 'done' }] }));
  await utimes(scriptPath, 0, 0);
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json') });
  expect(await request()).toContain('done');
  expect((await stat(scriptPath)).mtimeMs).toBeGreaterThan(0);
  expect(JSON.parse(await readFile(scriptPath, 'utf8')).nextIndex).toBe(1);
});
