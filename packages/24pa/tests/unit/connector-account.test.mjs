// #309: 24私助's own block on the host's Plugins page. The block shows the
// stored results of the switched-on channels; a page that opens reads no
// platform, and the one operation that does is the owner's read-only check.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AccessAccountSource, checkedAtNote, feishuAccessReport, PACKAGE, presentAccess, registerAccessAccount, wecomAccessReport } from '../../lib/connector-account.js';
import { fixture } from '../helpers/runtime.mjs';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

const access = (patch = {}) => ({ checkedAt: '2026-11-26T07:40:06.000Z', source: { state: 'ok', message: '一致' }, cli: { state: 'ok', message: 'CLI 可执行' }, auth: { state: 'ok', message: '身份一致' }, resources: [], ...patch });
const wecom = (patch = {}) => ({ checkedAt: '2026-11-26T07:40:06.000Z', cli: { state: 'ok', message: 'wecom-cli 1.0' }, auth: { state: 'ok', message: 'ok' }, identity: { state: 'ok', message: '机器人已绑定' }, services: [], nextSteps: [], ...patch });
const reported = (patch = {}) => ({ state: 'reported', mode: 'feishu', timeZone: 'Asia/Shanghai', feishu: { checkedAt: '2026-11-26T07:40:06.000Z', issues: [] }, wecom: null, ...patch });

/** A runtime double: what the block reads, and a count of what the check reads. */
function runtimeDouble(state = reported()) {
  const listeners = new Set();
  return {
    state, listeners,
    onAccessAccount: vi.fn(listener => { listeners.add(listener); return () => listeners.delete(listener); }),
    accessAccountState: vi.fn(() => state),
    accessCheck: vi.fn(async () => {}),
  };
}

describe('已存结果里哪些是问题', () => {
  it('飞书：没检查过就没有结论；CLI、配置文件、账号登录、资源任一不通过各算一项，未配的知识库不算', () => {
    expect(feishuAccessReport(null)).toEqual({ checkedAt: null, issues: [] });
    expect(feishuAccessReport(access()).issues).toEqual([]);
    const result = access({
      cli: { state: 'error', message: '需要官方飞书插件提供的 lark-cli' }, source: { state: 'error', message: 'AGENTS.md 读取失败' },
      auth: { state: 'mismatch', message: '登录用户或应用与当前配置不一致' },
      resources: [{ id: 'folder', label: '文档目录', state: 'error', message: '权限不足' }, { id: 'wiki', label: '知识库', state: 'missing', message: '未配置' }],
    });
    expect(feishuAccessReport(result)).toEqual({ checkedAt: result.checkedAt, issues: [
      'lark-cli：需要官方飞书插件提供的 lark-cli', 'AGENTS.md：AGENTS.md 读取失败', '账号登录：登录用户或应用与当前配置不一致', '文档目录：权限不足',
    ] });
  });

  it('企业微信：CLI、身份与未通过的服务各算一项；未启用与只读探不到的不算', () => {
    expect(wecomAccessReport(null)).toEqual({ checkedAt: null, issues: [] });
    expect(wecomAccessReport(wecom({ services: [{ id: 'push', state: 'unverified', message: '以首次真实推送为准' }, { id: 'calendar', state: 'skipped', message: '未启用' }] })).issues).toEqual([]);
    const result = wecom({
      cli: { state: 'error', message: '插件行配置的 wecom-cli 不可执行' }, identity: { state: 'missing', message: '未解析' },
      services: [{ id: 'todo', state: 'expired', message: '授权已过期' }],
    });
    expect(wecomAccessReport(result).issues).toEqual(['wecom-cli：插件行配置的 wecom-cli 不可执行', '机器人绑定与授权真人：未解析', '待办：授权已过期']);
  });

  it('检查时间按工作区时区分别用中英文写', () => {
    const note = checkedAtNote('feishu', '2026-11-26T07:40:06.000Z', 'Asia/Shanghai');
    expect(note.zh).toBe('飞书：检查于 2026/11/26 15:40');
    expect(note.en).toBe('Feishu: checked at 11/26/2026, 15:40');
    expect(checkedAtNote('wecom', '2026-11-26T07:40:06.000Z', 'Asia/Shanghai').zh).toBe('企业微信：检查于 2026/11/26 15:40');
  });
});

describe('区块显示什么', () => {
  it('检查进行中', () => {
    expect(presentAccess({ account: reported(), operation: { id: 'op-1', kind: 'inspect', phase: 'checking', cancellable: false } })).toEqual({ phase: 'checking', status: { en: 'Checking', zh: '正在检查' }, buttons: [], notes: [] });
  });

  it('检查没跑完：只说去面板看，不显示它抛出的内容', () => {
    const display = presentAccess({ account: reported(), result: { id: 'op-1', kind: 'inspect', outcome: 'failed' } });
    expect(display.phase).toBe('unavailable');
    expect(display.failure.text.zh).toBe('请到24私助面板重新执行检查，并在那里查看诊断。');
    expect(display.buttons.map(button => button.command)).toEqual([{ kind: 'start', operation: 'inspect' }]);
  });

  it('尚未绑定工作区：没有可点的检查', () => {
    const display = presentAccess({ account: { state: 'unbound' } });
    expect(display).toMatchObject({ phase: 'unavailable', buttons: [], detail: { en: 'Bind a workspace in the 24私助 panel first.', zh: '请先在24私助面板绑定工作区。' } });
  });

  it('体验模式且未启用企业微信：说明没有可检查的渠道，不给检查按钮', () => {
    const display = presentAccess({ account: reported({ mode: 'demo', feishu: null }) });
    expect(display).toMatchObject({ phase: 'disconnected', buttons: [], status: { zh: '体验模式：飞书接入与企业微信渠道都未启用' } });
  });

  it('有问题：标出几项并列出每一项', () => {
    const display = presentAccess({ account: reported({ feishu: { checkedAt: null, issues: ['需要官方飞书插件提供的 lark-cli'] }, wecom: { checkedAt: '2026-11-26T07:40:06.000Z', issues: ['待办：授权已过期'] } }) });
    expect(display.phase).toBe('disconnected');
    expect(display.badge.zh).toBe('需要处理');
    expect(display.status).toEqual({ en: '2 items need attention', zh: '2 项需要处理' });
    expect(display.notes).toEqual([{ text: '需要官方飞书插件提供的 lark-cli' }, { text: '待办：授权已过期' }]);
  });

  it('没有问题但还没检查过', () => {
    expect(presentAccess({ account: reported({ feishu: { checkedAt: null, issues: [] } }) })).toMatchObject({ phase: 'disconnected', status: { zh: '尚未检查' } });
  });

  it('全部通过：就绪，并列出各渠道的检查时间', () => {
    const display = presentAccess({ account: reported({ wecom: { checkedAt: '2026-11-26T07:40:06.000Z', issues: [] } }) });
    expect(display.phase).toBe('connected');
    expect(display.badge).toEqual({ en: 'Ready', zh: '已就绪' });
    expect(display.notes.map(note => note.text.zh)).toEqual(['飞书：检查于 2026/11/26 15:40', '企业微信：检查于 2026/11/26 15:40']);
  });
});

describe('页面看到的数据源', () => {
  it('视图取自已存结果；插件改了结果就通知页面；页面新订阅时不读任何平台', () => {
    const runtime = runtimeDouble();
    const source = new AccessAccountSource(runtime);
    expect(source.snapshot()).toEqual({ account: runtime.state });
    const notified = vi.fn();
    source.observe(notified);
    for (const listener of runtime.listeners) listener();
    expect(notified).toHaveBeenCalledTimes(1);
    source.refresh();
    expect(runtime.accessCheck).not.toHaveBeenCalled();
  });

  it('主人点检查才读平台：一次一桩，页面凭返回的标识跟进，结束后记下结果', async () => {
    let finish;
    const runtime = runtimeDouble();
    runtime.accessCheck.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const source = new AccessAccountSource(runtime);
    const id = source.start('inspect');
    expect(source.snapshot().operation).toEqual({ id, kind: 'inspect', phase: 'checking', cancellable: false });
    expect(() => source.start('inspect')).toThrow(/already running/);
    expect(() => source.start('check')).toThrow(/no operation/);
    finish();
    for (let index = 0; index < 4 && source.snapshot().operation; index++) await Promise.resolve();
    expect(runtime.accessCheck).toHaveBeenCalledTimes(1);
    expect(source.snapshot().result).toEqual({ id, kind: 'inspect', outcome: 'succeeded' });
    await source.cancel(id);
  });

  it('检查抛错时记为失败，页面仍可再点', async () => {
    const runtime = runtimeDouble();
    runtime.accessCheck.mockRejectedValue(new Error('内部诊断，可能带凭据'));
    const source = new AccessAccountSource(runtime);
    source.start('inspect');
    for (let index = 0; index < 4 && source.snapshot().operation; index++) await Promise.resolve();
    expect(source.snapshot().result.outcome).toBe('failed');
    expect(JSON.stringify(source.snapshot())).not.toContain('内部诊断');
    expect(presentAccess(source.snapshot()).buttons).toHaveLength(1);
  });

  it('登记到页面注册表：键与包名是24私助，页面只认「检查」一个操作；撤下时不再跟随插件', () => {
    const runtime = runtimeDouble();
    const withdraw = vi.fn();
    const register = vi.fn(() => withdraw);
    const stop = registerAccessAccount({ register }, runtime);
    expect(register).toHaveBeenCalledTimes(1);
    const registration = register.mock.calls[0][0];
    expect(registration).toMatchObject({ key: PACKAGE, packageName: '@benz-ai-x/dsh-24pa' });
    expect(registration.operations.map(operation => operation.kind)).toEqual(['inspect']);
    expect(registration.copy.title.zh).toBe('24私助接入');
    expect(registration.present({ account: { state: 'unbound' } }).phase).toBe('unavailable');
    expect(registration.source.snapshot().account).toEqual(runtime.state);
    stop();
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(runtime.listeners.size).toBe(0);
  });
});

describe('运行时给页面的东西', () => {
  /** A runtime whose lark-cli is the test stub; `calls` is how many times the stub has run. */
  async function withLark() {
    const f = await fixture(); cleanup.push(() => f.cleanup());
    const root = await mkdtemp(join(tmpdir(), 'pa24-access-account-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const state = join(root, 'lark.json');
    await writeFile(state, JSON.stringify({ ownerOpenId: 'owner', appId: 'cli_test_app' }));
    const bin = join(root, 'lark-cli');
    await writeFile(bin, '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n', { mode: 0o755 });
    await chmod(bin, 0o755);
    Object.assign(f.options, { larkCliBin: bin, env: { ...f.options.env, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const calls = async () => (await readFile(`${state}.calls.jsonl`, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
    return { f, calls };
  }

  it('没绑定工作区时是「未绑定」；体验模式的检查不读平台；飞书模式读了飞书并通知页面', async () => {
    const { f, calls } = await withLark();
    expect(f.rt.accessAccountState()).toEqual({ state: 'unbound' });
    const changed = vi.fn();
    f.rt.onAccessAccount(changed);
    // Demo mode switches no channel on, so its check has nothing to read.
    await f.rt.bind(await f.workspace('demo', { mode: 'demo' }));
    expect(f.rt.accessAccountState()).toMatchObject({ state: 'reported', mode: 'demo', timeZone: 'Asia/Shanghai', feishu: null, wecom: null });
    await f.rt.accessCheck();
    expect(await calls()).toBe(0);
    // Feishu mode switches the Feishu channel on: its check reads it, and the page hears of the result.
    const rt = f.make(); await rt.bind(await f.workspace('feishu', { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list' }));
    expect(rt.accessAccountState().feishu).toEqual({ checkedAt: null, issues: [] });
    await rt.accessCheck();
    expect(await calls()).toBeGreaterThan(0);
    const state = rt.accessAccountState();
    expect(state.feishu.checkedAt).not.toBeNull();
    expect(state.wecom).toBeNull();
  });
});
