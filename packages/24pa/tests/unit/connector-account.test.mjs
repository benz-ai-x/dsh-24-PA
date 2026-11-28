// #309: 24PA's own block on the host's Plugins page. The block shows the stored
// results of the switched-on channels; a page that opens reads no platform,
// and the one operation that does is the owner's read-only check.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccessAccountSource, checkedAtNote, feishuAccessReport, PA24_PACKAGE_NAME, presentAccess, registerAccessAccount, wecomAccessReport } from '../../lib/connector-account.js';
import { WECOM_SERVICE_NAMES } from '../../lib/wecom.js';
import { fixture } from '../helpers/runtime.mjs';
import { writeStandIn } from '../helpers/stub-cli.mjs';

const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

const AT = '2026-11-26T07:40:06.000Z';
/** A channel that was never checked, and one checked and found nothing wrong. */
const never = { checkedAt: null, issues: [], complete: true };
const clean = { checkedAt: AT, issues: [], complete: true };
const issue = (label, message) => ({ label, message });
const SIGNIN = { en: 'Account sign-in', zh: '账号登录' }, OWNER = { en: 'Owner binding', zh: '主人绑定' }, IDENTITY = { en: 'Bot binding & authorized user', zh: '机器人绑定与授权真人' };
const TODO = { en: 'Todo', zh: '待办' }, FOLDER = { en: 'Docs folder', zh: '文档目录' };
const access = (patch = {}) => ({ checkedAt: AT, source: { state: 'ok', message: '一致' }, cli: { state: 'ok', message: 'CLI 可执行' }, auth: { state: 'ok', message: '身份一致' }, resources: [], ...patch });
const wecom = (patch = {}) => ({ checkedAt: AT, cli: { state: 'ok', message: 'wecom-cli 1.0' }, auth: { state: 'ok', message: 'ok' }, identity: { state: 'ok', message: '机器人已绑定' }, services: [], nextSteps: [], ...patch });
const reported = (patch = {}) => ({ state: 'reported', mode: 'feishu', timeZone: 'Asia/Shanghai', feishu: { ...clean }, wecom: null, ...patch });
const INCOMPLETE = { en: 'The check stops at what it finds wrong first; the remaining items were not checked.', zh: '检查在第一个不通过处停下，其余项没有检查。' };

/** A runtime double: what the block reads, and a count of what the check reads. */
function runtimeDouble(state = reported()) {
  const listeners = new Set();
  return {
    state, listeners,
    onAccessAccount: vi.fn(listener => { listeners.add(listener); return () => listeners.delete(listener); }),
    accessAccountState: vi.fn(() => state),
    checkSwitchedOnAccess: vi.fn(async () => {}),
  };
}

describe('已存结果里哪些是问题', () => {
  it('飞书：没检查过就没有结论；lark-cli 不可用时只有它一项，其余项算没检查到', () => {
    expect(feishuAccessReport(null)).toEqual(never);
    expect(feishuAccessReport(access())).toEqual(clean);
    // The check returns at the lark-cli: the account, the file and the resources were not read.
    const result = access({ cli: { state: 'error', message: '需要官方飞书插件提供的 lark-cli' }, auth: { state: 'unchecked', message: '尚未检查' },
      resources: [{ id: 'folder', label: '文档目录', state: 'unchecked', message: '未检查可读性' }] });
    expect(feishuAccessReport(result)).toEqual({ checkedAt: AT, issues: [issue('lark-cli', '需要官方飞书插件提供的 lark-cli')], complete: false });
  });

  it('飞书：账号登录没通过是一项，没读到的资源不算问题；配置文件、资源不通过各算一项，未配的知识库不算', () => {
    // Not signed in, so the resources stay unchecked: one finding, and the check did not get through.
    const missing = { state: 'missing', message: '飞书插件尚未登录账号' };
    expect(feishuAccessReport(access({ auth: missing, resources: [{ id: 'folder', label: '文档目录', state: 'unchecked', message: '未检查可读性' }] })))
      .toEqual({ checkedAt: AT, issues: [issue(SIGNIN, '飞书插件尚未登录账号')], complete: false });
    // Signed in, but as someone else than the workspace's owner, or into a workspace that has no owner yet: the finding is about the
    // owner binding, not about the sign-in, and the resources were not read either.
    const mismatch = { state: 'mismatch', message: '登录用户或应用与当前配置不一致，未读取资源' };
    expect(feishuAccessReport(access({ auth: mismatch, resources: [{ id: 'folder', label: '文档目录', state: 'unchecked', message: '未检查可读性' }] })))
      .toEqual({ checkedAt: AT, issues: [issue(OWNER, '登录用户或应用与当前配置不一致，未读取资源')], complete: false });
    expect(feishuAccessReport(access({ auth: { state: 'unbound', message: '飞书插件已登录；工作区尚未绑定主人' }, resources: [{ id: 'folder', label: '文档目录', state: 'unchecked', message: '未检查可读性' }] })))
      .toEqual({ checkedAt: AT, issues: [issue(OWNER, '飞书插件已登录；工作区尚未绑定主人')], complete: false });
    const result = access({
      source: { state: 'error', message: 'AGENTS.md 读取失败' },
      resources: [{ id: 'folder', label: '文档目录', state: 'error', message: '权限不足' }, { id: 'wiki', label: '知识库', state: 'missing', message: '未配置' },
        { id: 'tasklist', label: '任务清单', state: 'ok', message: '读取接口成功' }],
    });
    expect(feishuAccessReport(result)).toEqual({ checkedAt: AT, issues: [issue('AGENTS.md', 'AGENTS.md 读取失败'), issue(FOLDER, '权限不足')], complete: true });
  });

  it('企业微信：CLI 不可用时只有它一项；身份没解析时也只有它一项，没读的服务不算问题；未启用与只读探不到的不算', () => {
    expect(wecomAccessReport(null)).toEqual(never);
    expect(wecomAccessReport(wecom({ services: [{ id: 'push', state: 'unverified', message: '以首次真实推送为准' }, { id: 'calendar', state: 'skipped', message: '未启用' }] }))).toEqual(clean);
    // The check returns at the wecom-cli: the identity was not resolved, which is no finding of its own.
    expect(wecomAccessReport(wecom({ cli: { state: 'error', message: '插件行配置的 wecom-cli 不可执行' }, identity: { state: 'missing', message: '未解析' } })))
      .toEqual({ checkedAt: AT, issues: [issue('wecom-cli', '插件行配置的 wecom-cli 不可执行')], complete: false });
    // Not connected to WeCom: the services are switched on, but they are read as the resolved identity only, so none was read. The
    // check records each as failed; here that is one finding, the identity, and the rest was not checked.
    const unread = { state: 'error', message: '当前真人与机器人未核验，未以新身份读取该服务。' };
    expect(wecomAccessReport(wecom({ identity: { state: 'error', message: '未解析。' }, services: [{ id: 'calendar', ...unread }, { id: 'todo', ...unread }, { id: 'push', state: 'error', message: '推送目标未解析（见身份检查）。' }] })))
      .toEqual({ checkedAt: AT, issues: [issue(IDENTITY, '未解析。')], complete: false });
    // Under a resolved identity, a service that did not pass is a finding of its own.
    expect(wecomAccessReport(wecom({ services: [{ id: 'todo', state: 'expired', message: '授权已过期' }] })))
      .toEqual({ checkedAt: AT, issues: [issue(TODO, '授权已过期')], complete: true });
  });

  it('问题项的标签跟着页面语言：中文用全角冒号，英文用半角；检查原话不翻译', () => {
    const display = presentAccess({ account: reported({ feishu: { checkedAt: AT, issues: [issue(SIGNIN, '飞书插件尚未登录账号')], complete: false }, wecom: { checkedAt: AT, issues: [issue(TODO, '授权已过期')], complete: true } }) });
    expect(display.notes.map(note => note.text)).toEqual([
      { zh: '账号登录：飞书插件尚未登录账号', en: 'Account sign-in: 飞书插件尚未登录账号' },
      { zh: '待办：授权已过期', en: 'Todo: 授权已过期' },
    ]);
  });

  it('检查时间按工作区时区分别用中英文写', () => {
    const note = checkedAtNote('feishu', AT, 'Asia/Shanghai');
    expect(note.zh).toBe('飞书：检查于 2026/11/26 15:40');
    expect(note.en).toBe('Feishu: checked at 11/26/2026, 15:40');
    expect(checkedAtNote('wecom', AT, 'Asia/Shanghai').zh).toBe('企业微信：检查于 2026/11/26 15:40');
  });

  it('区块里的企业微信服务名与运行时用的是同一张表；面板留自己的一份，内容与它相等', async () => {
    expect(wecomAccessReport(wecom({ services: [{ id: 'push', state: 'error', message: '以实际推送为准' }] })).issues)
      .toEqual([issue({ zh: WECOM_SERVICE_NAMES.push.zh, en: WECOM_SERVICE_NAMES.push.en }, '以实际推送为准')]);
    // The panel runs in the browser and cannot import the server's table: read its source text instead, where the panel writes
    // `serviceMeta = { calendar: L('日程', 'Calendar'), … }`.
    const client = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
    const panel = client.match(/const serviceMeta = \{([^}]*)\}/);
    expect(panel).toBeTruthy();
    expect(Object.fromEntries([...panel[1].matchAll(/(\w+): L\('([^']+)', '([^']+)'\)/g)].map(([, id, zh, en]) => [id, { zh, en }]))).toEqual(WECOM_SERVICE_NAMES);
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
    expect(display).toMatchObject({ phase: 'unavailable', buttons: [], detail: { en: 'Bind a workspace in the 24PA panel first.', zh: '请先在24私助面板绑定工作区。' } });
  });

  it('体验模式且未启用企业微信：说明没有可检查的渠道，不给检查按钮', () => {
    const display = presentAccess({ account: reported({ mode: 'demo', feishu: null }) });
    expect(display).toMatchObject({ phase: 'disconnected', buttons: [], status: { zh: '体验模式：飞书接入与企业微信渠道都未启用' } });
  });

  it('有问题：标出几项并列出每一项；有渠道没检查到时说明', () => {
    const display = presentAccess({ account: reported({
      feishu: { checkedAt: AT, issues: [issue('lark-cli', '需要官方飞书插件提供的 lark-cli')], complete: false },
      wecom: { checkedAt: AT, issues: [issue(TODO, '授权已过期')], complete: true },
    }) });
    expect(display.phase).toBe('disconnected');
    expect(display.badge.zh).toBe('需要处理');
    expect(display.status).toEqual({ en: '2 items need attention', zh: '2 项需要处理' });
    expect(display.detail).toEqual(INCOMPLETE);
    expect(display.notes).toEqual([{ text: { zh: 'lark-cli：需要官方飞书插件提供的 lark-cli', en: 'lark-cli: 需要官方飞书插件提供的 lark-cli' } }, { text: { zh: '待办：授权已过期', en: 'Todo: 授权已过期' } }]);
  });

  it('一个渠道有问题、另一个还没检查过：问题行之外，也给没检查的渠道一行', () => {
    // The owner ran the Feishu check from the 24PA panel only; the WeCom channel was never checked.
    const display = presentAccess({ account: reported({ feishu: { checkedAt: AT, issues: [issue(FOLDER, '权限不足')], complete: true }, wecom: never }) });
    expect(display.status).toEqual({ en: '1 item needs attention', zh: '1 项需要处理' });
    expect(display.detail).toBeUndefined();
    expect(display.notes.map(note => note.text)).toEqual([
      { zh: '文档目录：权限不足', en: 'Docs folder: 权限不足' },
      { zh: '企业微信：尚未检查', en: 'WeCom: not checked yet' },
    ]);
  });

  it('只有一项时英文用单数；企业微信没连接时只报身份一项，并说明其余项没有检查', () => {
    // The instance a fresh installation is in: the calendar and the push are switched on, WeCom is not connected.
    const display = presentAccess({ account: reported({ feishu: null, wecom: wecomAccessReport(wecom({
      identity: { state: 'error', message: '企微真人或机器人未核验。' },
      services: [{ id: 'calendar', state: 'error', message: '当前真人与机器人未核验，未以新身份读取该服务。' }, { id: 'push', state: 'error', message: '推送目标未解析（见身份检查）。' }],
    })) }) });
    expect(display.status).toEqual({ en: '1 item needs attention', zh: '1 项需要处理' });
    expect(display.detail).toEqual(INCOMPLETE);
    expect(display.notes).toEqual([{ text: { zh: '机器人绑定与授权真人：企微真人或机器人未核验。', en: 'Bot binding & authorized user: 企微真人或机器人未核验。' } }]);
  });

  it('没有不通过的项、但检查没走到头：算尚未检查，并说明原因', () => {
    expect(presentAccess({ account: reported({ feishu: { checkedAt: AT, issues: [], complete: false } }) })).toMatchObject({ phase: 'disconnected', status: { zh: '尚未检查' }, detail: INCOMPLETE, notes: [] });
  });

  it('没有问题但还没检查过', () => {
    expect(presentAccess({ account: reported({ feishu: never }) })).toMatchObject({ phase: 'disconnected', status: { zh: '尚未检查' }, notes: [] });
  });

  it('全部通过：就绪，并列出各渠道的检查时间', () => {
    const display = presentAccess({ account: reported({ wecom: { ...clean } }) });
    expect(display.phase).toBe('connected');
    expect(display.badge).toEqual({ en: 'Ready', zh: '已就绪' });
    expect(display.notes.map(note => note.text.zh)).toEqual(['飞书：检查于 2026/11/26 15:40', '企业微信：检查于 2026/11/26 15:40']);
    expect(display.notes.map(note => note.text.en)).toEqual(['Feishu: checked at 11/26/2026, 15:40', 'WeCom: checked at 11/26/2026, 15:40']);
  });

  it('英文文案里产品名写 24PA，「24私助」只出现在中文里：区块的每一句都查到', () => {
    // Every label the reports give an issue with, from the checks' own states.
    const labels = [
      ...feishuAccessReport(access({ auth: { state: 'missing', message: '一' } })).issues,
      ...feishuAccessReport(access({ auth: { state: 'unbound', message: '一' } })).issues,
      ...feishuAccessReport(access({ resources: [['folder', 'error'], ['wiki', 'error'], ['tasklist', 'error'], ['calendar', 'error']].map(([id, state]) => ({ id, label: '资源', state, message: '一' })) })).issues,
      ...wecomAccessReport(wecom({ identity: { state: 'error', message: '一' } })).issues,
    ].map(item => item.label);
    const withIssues = (issues, complete = true) => ({ checkedAt: AT, issues: issues.map(label => issue(label, '原话')), complete });
    // Each branch the block draws, with the sentences it draws them from:
    // 未绑定 (status.unbound, detail.unbound), 体验模式 (status.demo, detail.unchecked), 尚未检查 (status.unchecked, detail.unchecked),
    // 没走到头 (detail.incomplete), 一项与多项需要处理 (badge.attention, status.attention.one, status.attention), 没检查的渠道一行 (note.unchecked),
    // 就绪 (badge.ready, status.ready, note.checkedAt), 检查进行中 (status.checking), 检查没跑完 (status.failed, failure.inspect), 每一个标签 (label.*).
    const accounts = [
      { state: 'unbound' }, reported({ mode: 'demo', feishu: null }), reported({ feishu: never }),
      reported({ feishu: { checkedAt: AT, issues: [], complete: false } }),
      reported({ feishu: withIssues([labels[0]], false) }), reported({ feishu: withIssues(labels.slice(0, 2)) }),
      reported({ feishu: withIssues([]), wecom: withIssues([labels.at(-1)]) }),
      reported({ feishu: withIssues([labels[0]]), wecom: never }),
      reported({ feishu: { ...clean, issues: labels.map(label => issue(label, '原话')) }, wecom: { ...clean } }),
      reported({ feishu: { ...clean }, wecom: { ...clean } }),
    ];
    const texts = [];
    const views = [
      ...accounts.map(account => ({ account })),
      { account: reported(), operation: { id: 'op-1', kind: 'inspect', phase: 'checking', cancellable: false } },
      { account: reported(), result: { id: 'op-1', kind: 'inspect', outcome: 'failed' } },
    ];
    for (const view of views) {
      const display = presentAccess(view);
      for (const value of [display.status, display.badge, display.detail, display.failure?.text, ...display.buttons.map(button => button.label), ...display.notes.map(note => note.text)]) if (value) texts.push(value);
    }
    expect(labels).toHaveLength(7);
    const { register } = { register: vi.fn(() => () => {}) };
    registerAccessAccount({ register }, runtimeDouble());
    const registration = register.mock.calls[0][0];
    texts.push(registration.copy.title, registration.copy.hint, registration.copy.activation.title, registration.copy.activation.body, registration.copy.activation.connect, registration.operations[0].notice);
    for (const value of texts) {
      if (typeof value === 'string') continue;
      expect(value.en, JSON.stringify(value)).not.toContain('24私助');
      expect(value.zh, JSON.stringify(value)).not.toContain('24PA');
    }
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
    expect(runtime.checkSwitchedOnAccess).not.toHaveBeenCalled();
  });

  it('主人点检查才读平台：一次一桩，页面凭返回的标识跟进，结束后记下结果', async () => {
    let finish;
    const runtime = runtimeDouble();
    runtime.checkSwitchedOnAccess.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const source = new AccessAccountSource(runtime);
    const id = source.start('inspect');
    expect(source.snapshot().operation).toEqual({ id, kind: 'inspect', phase: 'checking', cancellable: false });
    expect(() => source.start('inspect')).toThrow(/already running/);
    expect(() => source.start('check')).toThrow(/no operation/);
    // While the check runs, nothing has settled; once it has, the result is recorded.
    let settled = false; void source.settled().then(() => { settled = true; });
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await source.settled();
    expect(runtime.checkSwitchedOnAccess).toHaveBeenCalledTimes(1);
    expect(source.snapshot()).toEqual({ account: runtime.state, result: { id, kind: 'inspect', outcome: 'succeeded' } });
    await source.cancel(id);
  });

  it('检查抛错时记为失败，页面仍可再点', async () => {
    const runtime = runtimeDouble();
    runtime.checkSwitchedOnAccess.mockRejectedValue(new Error('内部诊断，可能带凭据'));
    const source = new AccessAccountSource(runtime);
    source.start('inspect');
    await source.settled();
    expect(source.snapshot().result.outcome).toBe('failed');
    expect(JSON.stringify(source.snapshot())).not.toContain('内部诊断');
    expect(presentAccess(source.snapshot()).buttons).toHaveLength(1);
  });

  it('登记到页面注册表：键与包名是24私助的包，页面只认「检查」一个操作；撤下时不再跟随插件', () => {
    const runtime = runtimeDouble();
    const withdraw = vi.fn();
    const register = vi.fn(() => withdraw);
    const stop = registerAccessAccount({ register }, runtime);
    expect(register).toHaveBeenCalledTimes(1);
    const registration = register.mock.calls[0][0];
    expect(registration).toMatchObject({ key: PA24_PACKAGE_NAME, packageName: '@benz-ai-x/dsh-24pa' });
    expect(registration.operations.map(operation => operation.kind)).toEqual(['inspect']);
    expect(registration.copy.title).toEqual({ en: '24PA access', zh: '24私助接入' });
    expect(registration.present({ account: { state: 'unbound' } }).phase).toBe('unavailable');
    expect(registration.source.snapshot().account).toEqual(runtime.state);
    stop();
    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(runtime.listeners.size).toBe(0);
  });

  it('注册表拒绝登记时，区块不再跟随运行时', () => {
    const runtime = runtimeDouble();
    expect(() => registerAccessAccount({ register: () => { throw new Error('the package is taken'); } }, runtime)).toThrow(/is taken/);
    expect(runtime.listeners.size).toBe(0);
  });
});

describe('运行时给页面的东西', () => {
  /** A runtime whose lark-cli and wecom-cli are the test stubs; `calls` is how many times the lark stub has run, `state` the wecom stub's state file. */
  async function withBoth() {
    const f = await fixture(); cleanup.push(() => f.cleanup());
    const root = await mkdtemp(join(tmpdir(), 'pa24-access-account-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const lark = join(root, 'lark.json'), state = join(root, 'wecom.json');
    await writeFile(lark, JSON.stringify({ ownerOpenId: 'owner', appId: 'cli_test_app' }));
    await writeFile(state, JSON.stringify({ ownerUserid: 'wou_owner' }));
    Object.assign(f.options, { larkCliBin: await writeStandIn(root, 'lark', lark), wecomCliBin: await writeStandIn(root, 'wecom', state),
      env: { ...f.options.env, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'secret' } });
    const calls = async () => (await readFile(`${lark}.calls.jsonl`, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
    let bound = 0;
    /** Bind `rt` to a fresh Feishu-mode workspace with `patch` applied; returns what the page read at each notification since. */
    const bind = async (rt, patch = {}) => {
      const heard = []; rt.onAccessAccount(() => heard.push(rt.accessAccountState()));
      await rt.bind(await f.workspace(`feishu-${++bound}`, { mode: 'feishu', ownerOpenId: 'owner', folderToken: 'folder', tasklistId: 'list', ...patch }));
      return heard;
    };
    return { f, calls, state, bind };
  }

  it('没绑定工作区时是「未绑定」；体验模式的检查不读平台；飞书模式读了飞书并通知页面', async () => {
    const { f, calls, bind } = await withBoth();
    expect(f.rt.accessAccountState()).toEqual({ state: 'unbound' });
    // Demo mode switches no channel on, so its check has nothing to read.
    await f.rt.bind(await f.workspace('demo', { mode: 'demo' }));
    expect(f.rt.accessAccountState()).toMatchObject({ state: 'reported', mode: 'demo', timeZone: 'Asia/Shanghai', feishu: null, wecom: null });
    await f.rt.checkSwitchedOnAccess();
    expect(await calls()).toBe(0);
    // Feishu mode switches the Feishu channel on: its check reads it, and the page is told the result.
    const rt = f.make(), heard = await bind(rt);
    expect(rt.accessAccountState().feishu).toEqual(never);
    await rt.checkSwitchedOnAccess();
    expect(await calls()).toBeGreaterThan(0);
    const state = rt.accessAccountState();
    expect(state.feishu.checkedAt).not.toBeNull();
    expect(state.wecom).toBeNull();
    expect(heard.at(-1)).toEqual(state);
  });

  it('配置重载与保存密钥会清掉已存结果，并告诉页面', async () => {
    const { f, bind } = await withBoth();
    const rt = f.make(), heard = await bind(rt);
    await rt.checkSwitchedOnAccess();
    expect(rt.accessAccountState().feishu.checkedAt).not.toBeNull();
    // A saved configuration change replaces the file the results were checked against.
    let before = heard.length;
    await rt.updateWorkspaceConfig({ maxWorkers: 4 }, rt.workspaceBinding);
    expect(rt.accessAccountState().feishu).toEqual(never);
    expect(heard.length).toBeGreaterThan(before);
    await rt.checkSwitchedOnAccess();
    expect(rt.accessAccountState().feishu.checkedAt).not.toBeNull();
    before = heard.length;
    await rt.updateWorkspaceSecrets({ volcTtsKey: 'voice' }, rt.workspaceBinding);
    expect(rt.accessAccountState().feishu).toEqual(never);
    expect(heard.length).toBeGreaterThan(before);
  });

  it('配置换入之后才通知页面：重载打开企业微信渠道时，页面被通知那一刻读到的已是新配置', async () => {
    const { f, bind } = await withBoth();
    const rt = f.make(), heard = await bind(rt);
    expect(rt.accessAccountState().wecom).toBeNull();
    await rt.updateWorkspaceConfig({ notifyChannel: 'wecom' }, rt.workspaceBinding);
    // The WeCom channel is on under the configuration that came in, and the page was told of that one, not of the one that went out.
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.at(-1)).toEqual({ state: 'reported', mode: 'feishu', timeZone: 'Asia/Shanghai', feishu: never, wecom: never });
    expect(rt.accessAccountState()).toEqual(heard.at(-1));
  });

  it('企微身份变了：旧结果作废时告诉页面，主人确认新绑定后也告诉', async () => {
    const { f, state, bind } = await withBoth();
    const rt = f.make(), heard = await bind(rt, { notifyChannel: 'wecom' }), reports = () => heard.map(view => view.wecom);
    expect((await rt.wecomCheck()).identity.state).toBe('ok');
    expect(reports().at(-1).checkedAt).not.toBeNull();
    let before = heard.length;
    // Another bot is seen: the stored result was read as the old binding. The page is told it is gone before the check records its own result.
    await writeFile(state, JSON.stringify({ ownerUserid: 'wou_owner', botId: 'other-bot' }));
    expect((await rt.wecomCheck()).identity.state).toBe('error');
    expect(reports().slice(before)).toContainEqual(never);
    expect(reports().at(-1).checkedAt).not.toBeNull();
    // The owner has looked at what the old binding left, and confirms the new one.
    before = heard.length;
    const observed = (await rt.repos.health.identity('wecom')).observed;
    await rt.acceptWecomIdentity({ workspaceBinding: rt.workspaceBinding, confirm: true, configVersion: rt.connectionVersion(), identity: observed });
    expect(heard.length).toBeGreaterThan(before);
    expect(reports().at(-1)).toEqual(never);
    expect(rt.accessAccountState().wecom).toEqual(never);
  });
});
