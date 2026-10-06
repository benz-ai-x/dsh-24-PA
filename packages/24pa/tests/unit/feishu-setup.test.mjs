// F15 unit: the bundled feishu-setup.md guide must ship with the package and
// carry every stage, and setupNextSteps must map every diagnostic state to a
// concrete guide-anchored next action.
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupNextSteps } from '../../lib/feishu.js';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const baseConfig = {
  version: 1, mode: 'demo', larkProfile: '24PA', ownerOpenId: 'ou_x', folderToken: 'fld_x',
  tasklistId: 'tl_x', calendarId: 'primary', timeZone: 'Asia/Shanghai', appIdEnv: 'A', appSecretEnv: 'B',
  pgDsnEnv: 'C', maxWorkers: 2, enabledWorkers: ['memo'], workerModels: {}, extraLocalTools: [],
};

const diag = (patch = {}) => ({
  checkedAt: '2026-10-07T00:00:00.000Z',
  source: { state: 'ok' },
  cli: { state: 'ok' },
  auth: { state: 'ok', openId: 'ou_x' },
  resources: [
    { id: 'folder', label: '文档目录', value: 'fld_x', state: 'ok' },
    { id: 'tasklist', label: '任务清单', value: 'tl_x', state: 'ok' },
    { id: 'calendar', label: '本人日历', value: 'primary', state: 'ok' },
  ],
  ...patch,
});

describe('飞书接入指南（feishu-setup.md）', () => {
  it('随包分发且包含全部阶段与关键契约', async () => {
    const content = await readFile(resolve(pkgDir, 'feishu-setup.md'), 'utf8');
    for (const stage of ['阶段 0', '阶段 1', '阶段 2', '阶段 3', '阶段 4', '阶段 5', '阶段 6', '安全红线']) {
      expect(content).toContain(stage);
    }
    // The two contracts the guide must state exactly: the agent-driven Device
    // Flow and the domain-scoped authorization set.
    expect(content).toContain('--device-code');
    expect(content).toContain('--domain im,task,calendar,docs,drive');
    expect(content).toContain('im.message.receive_v1');
    expect(content).toContain('card.action.trigger');
    // Ordering invariant: env before AGENTS.md, restart after.
    expect(content).toContain('先环境变量，后 AGENTS.md，再重启');
  });
});

describe('setupNextSteps 状态映射', () => {
  it('CLI 不可执行时只给安装提示并终止', () => {
    const steps = setupNextSteps(baseConfig, diag({ cli: { state: 'error' }, auth: { state: 'missing' } }));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain('PATH');
  });

  it('AGENTS.md 已改未重载 → reload 提示', () => {
    const steps = setupNextSteps(baseConfig, diag({ source: { state: 'changed' } }));
    expect(steps.join('')).toContain('reload');
  });

  it('auth missing → Device Flow 三步法与 profile 名', () => {
    const steps = setupNextSteps(baseConfig, diag({ auth: { state: 'missing' } }));
    expect(steps.join('')).toContain('auth login --no-wait');
    expect(steps.join('')).toContain('--profile 24PA');
    expect(steps.join('')).toContain('--device-code');
  });

  it('auth unbound → 用 auth status 的 openId 绑定主人', () => {
    const steps = setupNextSteps({ ...baseConfig, ownerOpenId: '' }, diag({ auth: { state: 'unbound', openId: 'ou_real' } }));
    expect(steps.join('')).toContain('ownerOpenId');
    expect(steps.join('')).toContain('ou_real');
  });

  it('auth mismatch / unverified / error 各给对应处置', () => {
    expect(setupNextSteps(baseConfig, diag({ auth: { state: 'mismatch' } })).join('')).toContain('不一致');
    expect(setupNextSteps(baseConfig, diag({ auth: { state: 'unverified' } })).join('')).toContain('刷新令牌');
    expect(setupNextSteps(baseConfig, diag({ auth: { state: 'error' } })).join('')).toContain('config show');
  });

  it('资源缺失/报错 → 指南阶段 3 与权限点提示', () => {
    const steps = setupNextSteps(baseConfig, diag({
      resources: [
        { id: 'folder', label: '文档目录', value: '', state: 'missing' },
        { id: 'tasklist', label: '任务清单', value: 'tl_x', state: 'error' },
        { id: 'calendar', label: '本人日历', value: 'primary', state: 'ok' },
      ],
    }));
    expect(steps.join('')).toContain('folderToken');
    expect(steps.join('')).toContain('权限点');
  });

  it('全部就绪：demo 指引切 feishu，feishu 指引端到端验收', () => {
    const demo = setupNextSteps(baseConfig, diag()).join('');
    expect(demo).toContain('PA24_FEISHU_APP_ID');
    expect(demo).toContain('feishu');
    const feishu = setupNextSteps({ ...baseConfig, mode: 'feishu' }, diag()).join('');
    expect(feishu).toContain('/24pa');
  });
});
