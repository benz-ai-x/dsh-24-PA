import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { SourceAccess } from '../../lib/source-access.js';
import { SourceTodoReader } from '../../lib/source-todo-reader.js';
import { WecomChannels } from '../../lib/wecom-channels.js';
import { runWecomCli } from '../../lib/wecom.js';
import { makeBaseDeps } from '../helpers/channel-deps.mjs';

const source = { id: 'wecom-todos', name: '企微待办', domain: 'todo', platform: 'wecom', purpose: 'personal', ownerId: 'wou_test_owner', resourceKind: 'authorized_scope', resourceId: 'authorized', filter: 'all', access: 'readwrite', enabled: true };
const config = { ...DEFAULT_CONFIG, todoChannel: 'wecom', sources: { version: 1, entries: [source], defaults: { todo: source.id, calendar: null }, mappings: [], meetingDurationMinutes: null } };
const target = { sourceId: source.id, platform: 'wecom', domain: 'todo', identity: { platform: 'wecom', ownerId: source.ownerId, authority: 'bot:bot-stub-1' }, resource: { kind: source.resourceKind, id: source.resourceId } };
const stub = fileURLToPath(new URL('../helpers/stub-wecom-cli.mjs', import.meta.url));
const lark = async () => { throw new Error('不应调用飞书'); };
let root, state, options;
const wecom = args => runWecomCli(options, args);
const channels = () => new WecomChannels(makeBaseDeps({ config: () => config, cli: () => options }));
const calls = async () => (await readFile(state + '.calls.jsonl', 'utf8')).trim().split('\n').map(JSON.parse);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-wecom-todo-contract-'));
  state = join(root, 'state.json');
  const bin = join(root, 'wecom-cli');
  await writeFile(state, '{}');
  await writeFile(bin, `#!/usr/bin/env node\nprocess.env.PA24_WECOM_STUB_STATE = ${JSON.stringify(state)};\nawait import(${JSON.stringify(stub)});\n`);
  await chmod(bin, 0o755);
  options = { bin, timeoutMs: 5000 };
  const todos = Array.from({ length: 22 }, (_, index) => ({ todo_id: `todo-${index}`, title: `待办 ${index}`, status: index === 21 ? 'finished' : 'proceed', user_status: index === 21 ? 'finished' : 'accept', creator: { userid: source.ownerId }, followers: [{ userid: source.ownerId, user_status: index === 21 ? 'finished' : 'accept' }] }));
  await writeFile(state + '.todos.jsonl', todos.map(row => JSON.stringify(row)).join('\n') + '\n');
});
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe('#258 企微待办 CLI 契约', () => {
  it('来源检查、接入检查与业务分页均传独立枚举，已完成待办不会漏读', async () => {
    const access = await new SourceAccess({ config: () => config, lark, wecom }).check(source);
    expect(access.state).toBe('verified');
    const check = await channels().wecomCheck();
    expect(check.services.find(row => row.id === 'todo').state).toBe('ok');
    const observation = await new SourceTodoReader({ timeZone: () => config.timeZone, lark, wecom }).read(target);
    expect(observation.items).toHaveLength(22);
    expect(observation.items.find(row => row.nativeId === 'todo-21').body.status).toBe('completed');
    expect(observation.state).toBe('partial');
    expect(observation.reason).toContain('真实账号');
    const listCalls = (await calls()).map(row => row.args).filter(args => args[0] === 'todo' && args[1] === 'list');
    expect(listCalls).toEqual([
      ['todo', 'list', '--status-filter', 'proceed', 'finished', '--limit', '1'],
      ['todo', 'list', '--status-filter', 'proceed', 'finished', '--limit', '1'],
      ['todo', 'list', '--status-filter', 'proceed', 'finished', '--limit', '20'],
      ['todo', 'list', '--status-filter', 'proceed', 'finished', '--limit', '20', '--cursor', '20'],
    ]);
  });

  it.each([
    ['JSON 单状态', ['["proceed"]']],
    ['JSON 双状态', ['["proceed","finished"]']],
    ['数字状态', ['0', '1']],
  ])('拒绝%s，防止模拟 CLI 再次接受错误契约', async (_label, statuses) => {
    await expect(wecom(['todo', 'list', '--status-filter', ...statuses, '--limit', '1'])).rejects.toThrow(/40058/);
  });

  it('独立单状态只返回指定状态，未给状态时沿用 CLI 默认值', async () => {
    const completed = await wecom(['todo', 'list', '--status-filter', 'finished', '--limit', '20']);
    expect(completed.data.items.map(row => row.todo_id)).toEqual(['todo-21']);
    const defaults = await wecom(['todo', 'list', '--limit', '20']);
    expect(defaults.data.items).toHaveLength(20);
    expect(defaults.data.items.every(row => row.status === 'proceed')).toBe(true);
  });

  it('普通参数错误没有授权链接时，诊断提示仍明确检查未通过', async () => {
    await writeFile(state, JSON.stringify({ todoListError: { code: 40058, message: "'status_filter' 不合法" } }));
    const check = await channels().wecomCheck();
    expect(check.services.find(row => row.id === 'todo')).toMatchObject({ state: 'error', message: expect.stringContaining('40058') });
    expect(check.nextSteps.join('\n')).toContain('待办');
    expect(check.nextSteps.join('\n')).toContain('未通过');
    expect(check.nextSteps.join('\n')).not.toContain('检查通过');
  });
});
