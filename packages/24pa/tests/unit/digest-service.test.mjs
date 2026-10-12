// F32 interface-level tests for the recurring-digest service: the module's
// own seam, no Host involved. Deep coverage stays in the f09 e2e (real
// Schedule wake); these pin the pure-assembly edges cheapest to assert here.
import { describe, expect, it } from 'vitest';
import { DigestService } from '../../lib/digest-service.js';
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
