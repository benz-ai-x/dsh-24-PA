// F32 interface-level tests for the recurring-digest service: the module's
// own seam, no Host involved. Deep coverage stays in the f09 e2e (real
// Schedule wake); these pin the pure-assembly edges cheapest to assert here.
import { describe, expect, it, vi } from 'vitest';
import { DigestService, buildSpokenVariant, DIGEST_SPOKEN_MAX_CHARS } from '../../lib/digest-service.js';
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
  currentFingerprint: async () => 'fp',
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
  const makeBuildDeps = (tts, notifyChannelOverride) => {
    const plan = {
      id: 'dig-morning-x', kind: 'morning', title: '晨报', schedule_id: null, session_id: 'sess-access',
      schedule_spec: {}, status: 'active', last_window: null, voice: true, created_at: new Date(), updated_at: new Date(),
    };
    const deps = makeDeps({
      config: () => ({ timeZone: 'Asia/Shanghai', notifyChannel: tts.notifyChannel ?? notifyChannelOverride ?? 'feishu', ownerOpenId: 'ou_owner', tts }),
      notifyOwner: async () => {},
      repos: () => ({
        digests: {
          getPlan: async () => plan,
          claimOccurrence: async () => ({ created: true, row: { id: 501, status: 'delivering' } }),
          updateOccurrence: async () => {},
          updatePlan: async () => {},
          occurrencesOf: async () => [],
        },
        outbox: { enqueue: async () => {} },
        workItems: { update: async () => {} },
        calendar: { eventsIn: async () => [], getSync: async () => null },
        tasks: { list: async () => [] },
        waiting: { list: async () => [] },
        projects: { listIdNames: async () => [], tasksOf: async () => [] },
        notes: { recentApproved: async () => [] },
      }),
      reviewQueueCount: async () => 0,
    });
    return { deps, plan };
  };

  it('digestBuild：plan.voice＋引擎可用时先入 audio 行，再入全文文本行', async () => {
    const enqueued = [];
    const notified = [];
    const { deps } = makeBuildDeps({ engine: 'volcengine', voice: 'zh_female_cancan_uranus_bigtts', volcKeyEnv: 'PA24_VOLC_TTS_KEY', meloDir: '' }, 'feishu');
    const baseRepos = deps.repos();
    deps.repos = () => ({ ...baseRepos, outbox: { enqueue: async row => { enqueued.push(row); return { created: true, row }; } } });
    deps.notifyOwner = async (key, body) => { notified.push([key, body]); };
    await new DigestService(deps).digestBuild({ id: 'w1' }, { planId: 'dig-morning-x' });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].kind).toBe('audio');
    expect(enqueued[0].dedupKey).toBe('digest:501:voice');
    expect(enqueued[0].target).toBe('ou_owner');
    expect(String(enqueued[0].content.text)).not.toContain('来源：');
    expect(notified[0][0]).toBe('digest:501');
  });

  it('digestBuild：engine=none 或 wecom 通道时不入 audio 行（降级文本＋告警）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const run = async ttsConfig => {
        const { deps } = makeBuildDeps(ttsConfig, ttsConfig.notifyChannel);
        const enqueued = [];
        const baseRepos = deps.repos();
        deps.repos = () => ({ ...baseRepos, outbox: { enqueue: async row => { enqueued.push(row); return { created: true, row }; } } });
        await new DigestService(deps).digestBuild({ id: 'w1' }, { planId: 'dig-morning-x' });
        return enqueued;
      };
      const noneTts = { engine: 'none', voice: '', volcKeyEnv: '', meloDir: '', notifyChannel: 'feishu' };
      expect(await run(noneTts)).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('未配置 TTS 引擎'));
      expect(await run({ ...noneTts, notifyChannel: 'wecom' })).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('企微'));
    } finally {
      warn.mockRestore();
    }
  });

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
