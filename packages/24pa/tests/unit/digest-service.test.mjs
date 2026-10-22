// F32 interface-level tests for the recurring-digest service: the module's
// own seam, no Host involved. Deep coverage stays in the f09 e2e (real
// Schedule wake); these pin the pure-assembly edges cheapest to assert here.
import { describe, expect, it, vi } from 'vitest';
import { DigestService, buildSpokenVariant, DIGEST_SPOKEN_MAX_CHARS } from '../../lib/digest-service.js';
import { SkillCatalog } from '../../lib/skills.js';
import { makeBaseDeps } from '../helpers/channel-deps.mjs';

const makeDeps = (over = {}) => ({
  ...makeBaseDeps({ config: () => ({ timeZone: 'Asia/Shanghai' }) }),
  accessSessionId: () => 'sess-access',
  workspace: () => ({ statePath: '/tmp/ws' }),
  startedAt: () => new Date().toISOString(),
  reviewQueue: async () => ({ count: 0, items: [] }),
  memory: () => null,
  nativeSchedule: () => null,
  syncCalendarWindow: async () => ({ ok: true }),
  calendarWrite: async () => ({}),
  inspectNoteTrust: async () => ({ currentValidity: 'matches' }),
  ...over,
});

describe('F32：DigestService 接口直测', () => {
  it('digestWindowKey：晨报按本地日期、weekly 按 ISO 周、时区生效', () => {
    const service = new DigestService(makeDeps());
    const shanghaiNoon = new Date('2026-10-12T04:00:00Z'); // 上海 12:00
    expect(service.digestWindowKey('morning', 'Asia/Shanghai', shanghaiNoon)).toBe('2026-10-12');
    // UTC 前一天深夜（上海已是次日）——窗口键跟随本地日期
    const utcLateNight = new Date('2026-10-11T17:30:00Z'); // 上海 10-12 01:30
    expect(service.digestWindowKey('morning', 'Asia/Shanghai', utcLateNight)).toBe('2026-10-12');
    // 周键形如 2026-W42
    expect(service.digestWindowKey('weekly', 'Asia/Shanghai', shanghaiNoon)).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('digestEnable：宿主无原生 Schedule 时显式报错（能力边界）', async () => {
    const service = new DigestService(makeDeps({ nativeSchedule: () => null }));
    await expect(service.digestEnable({ kind: 'morning' })).rejects.toThrow('原生 Schedule');
  });

  it('preferenceBufferMinutes：无记忆库时回落默认 0', async () => {
    const service = new DigestService(makeDeps({ memory: () => null }));
    await expect(service.preferenceBufferMinutes()).resolves.toBe(0);
  });
});

describe('F19：口播变体与语音入队', () => {
  it('buildSpokenVariant：剥元数据行（syncedAt/来源/URL/缺失节/页脚）', async () => {
    const report = [
      '【晨报】窗口 2026-10-18',
      '',
      '一、事实（来自实际对象）',
      '· 日程 2 项（日历同步于 2026-10-18T08:00:00Z）：',
      '  - 产品评审会 2026-10-18T02:30:00Z → 2026-10-18T03:30:00Z',
      '· 已审核笔记 n1 v3「纪要」https://example.feishu.cn/doc/x（审核于 2026-10-17）',
      '· 近 24 小时内同步到完成状态 1 项（来源：任务投影的同步时间，非精确完成时刻）：任务A',
      '',
      '三、数据缺失',
      '· 日历同步失败',
      '',
      '来源：飞书日历/任务投影、24私助工作账本。',
    ].join('\n');
    const spoken = buildSpokenVariant(report);
    expect(spoken).toContain('【晨报】窗口 2026-10-18');
    expect(spoken).toContain('产品评审会');
    expect(spoken).not.toContain('日历同步于');
    expect(spoken).not.toContain('审核于');
    expect(spoken).not.toContain('（来源：');
    expect(spoken).not.toContain('https://');
    expect(spoken).not.toContain('三、数据缺失');
    expect(spoken).not.toContain('来源：飞书');
  });

  it('buildSpokenVariant：超限截断并播报提示', async () => {
    const long = `【晨报】\n${'今天有非常多的事情要做。'.repeat(200)}`;
    const spoken = buildSpokenVariant(long);
    expect(spoken.length).toBeGreaterThan(DIGEST_SPOKEN_MAX_CHARS);
    expect(spoken).toContain('语音版到此截断');
    expect(buildSpokenVariant('【晨报】今天两件事。')).toBe('【晨报】今天两件事。');
  });

  // 两个 digestBuild 用例共享的仓库/依赖桩（仅 tts 与 notifyChannel 变化）。






  it('digestControl：voice on/off 落 plan 行', async () => {
    const updated = [];
    const plan = {
      id: 'dig-evening-z', kind: 'evening', title: '晚间回顾', schedule_id: 'sch-1', session_id: 's',
      schedule_spec: {}, status: 'active', last_window: null, voice: false, created_at: new Date(), updated_at: new Date(),
    };
    const deps = makeDeps({
      repos: () => ({
        digests: {
          getPlan: async () => plan,
          updatePlan: async (id, patch) => { updated.push([id, patch]); return { ...plan, ...patch }; },
        },
      }),
    });
    const service = new DigestService(deps);
    const result = await service.digestControl({ planId: plan.id, op: 'voice', voice: true });
    expect(updated[0][1]).toEqual({ voice: true });
    expect(result.voice).toBe(true);
  });
});

describe('F40：计划绑定任务 skill', () => {
  const fallback = new SkillCatalog(null); // 宿主未挂载：内置三件回落目录
  // 挂载态目录：含一个 agent 轨自定义与一个模板轨自定义
  const mounted = new SkillCatalog({
    register: () => () => {},
    list: async () => [
      { name: 'standup-prep', description: '站会准备', provider: 'filesystem', source: 'project-dsh', metadata: {} },
      { name: 'quiet-report', description: '静默汇报', provider: 'filesystem', source: 'project-dsh', metadata: { track: 'template', kind: 'morning' } },
    ],
    get: async name => ['standup-prep', 'quiet-report'].includes(name) ? { name, source: 'project-dsh', content: '完成简报', metadata: { track: name === 'quiet-report' ? 'template' : 'agent', kind: 'morning' } } : undefined,
  });

  const planRow = (skill = 'digest-morning') => ({ id: 'dig-morning-x', kind: 'morning', title: '晨报', schedule_id: 's', session_id: 'sess', schedule_spec: {}, status: 'active', last_window: null, voice: false, skill, created_at: new Date(), updated_at: new Date() });
  const enableDeps = catalog => makeDeps({
    skillCatalog: () => catalog,
    workspace: () => ({ statePath: '/tmp/ws' }),
    accessSessionId: () => 'sess',
    nativeSchedule: () => ({ create: async () => ({ id: 'sch-1' }) }),
    repos: () => ({ digests: { getPlan: async () => null, insertPlan: async row => ({ ...row }), comparePlan: async (row, patch) => ({ ...row, ...patch }) } }),
  });

  it('digest_enable：默认映射内置 skill；agent 轨可绑定；自定义正文不能冒充确定性模板', async () => {
    const service = new DigestService(enableDeps(fallback));
    const ok = await service.digestEnable({ kind: 'morning', time: '08:00:00' });
    expect(ok.skill).toBe('digest-morning');
    await expect(service.digestEnable({ kind: 'morning', time: '08:00:00', skill: 'ghost' })).rejects.toThrow(/不存在/);
    const mountedService = new DigestService(enableDeps(mounted));
    const custom = await mountedService.digestEnable({ kind: 'morning', time: '08:00:00', skill: 'standup-prep' });
    expect(custom.skill).toBe('standup-prep'); // F41：agent 轨可绑定
    await expect(mountedService.digestEnable({ kind: 'morning', time: '08:00:00', skill: 'quiet-report' })).rejects.toThrow(/智能副本/);
  });

  it('digest_control op=skill：合法名落行，非法名拒绝', async () => {
    const updated = [];
    const deps = makeDeps({
      skillCatalog: () => fallback,
      repos: () => ({ digests: {
        getPlan: async () => planRow('digest-evening'),
        updatePlan: async (id, patch) => { updated.push([id, patch]); return { id, ...patch }; },
      } }),
    });
    const service = new DigestService(deps);
    const r = await service.digestControl({ planId: 'dig-morning-x', op: 'skill', skill: 'digest-weekly' });
    expect(updated[0][1]).toEqual({ skill: 'digest-weekly' });
    expect(r.skill).toBe('digest-weekly');
    await expect(service.digestControl({ planId: 'dig-morning-x', op: 'skill', skill: 'ghost' })).rejects.toThrow(/不存在/);
  });


});
