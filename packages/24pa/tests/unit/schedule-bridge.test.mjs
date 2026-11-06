import { describe, expect, it } from 'vitest';
import { bridgeScheduleService } from '../../lib/schedule-bridge.js';

const dailySpec = { daily: { time: '08:00:00', time_zone: 'Asia/Shanghai' }, title: '[24PA] 晨报', prompt: '唤醒' };

describe('宿主 Schedule 方言桥', () => {
  it('旧方言（无 edit）原样直通', () => {
    const legacy = { create: async () => ({ id: 's1' }), delete: async () => ({ deleted: true }) };
    expect(bridgeScheduleService(legacy)).toBe(legacy);
  });
  it('新方言 create：键控请求转 timing＋target，条目归属还原为 sessionId', async () => {
    const calls = [];
    const service = {
      edit: async () => {},
      create: async input => { calls.push(input); return { kind: 'daily', id: 's1', scheduledAt: '2026-11-07T00:00:00.000Z', target: { kind: 'session', sessionId: 'pa24-feishu' } }; },
    };
    const bridged = bridgeScheduleService(service);
    const created = await bridged.create('pa24-feishu', dailySpec);
    expect(calls[0]).toMatchObject({ title: '[24PA] 晨报', prompt: '唤醒', timing: { kind: 'daily', daily: { time: '08:00:00', time_zone: 'Asia/Shanghai' } }, target: { kind: 'session', sessionId: 'pa24-feishu' } });
    expect(created.sessionId).toBe('pa24-feishu');
  });
  it('新方言 edit 冲突不抛错：按 code 判别为未更新（不能按 id，每个变体都有 id）', async () => {
    for (const code of ['schedule_conflict', 'schedule_not_found']) {
      const service = {
        edit: async input => (input.action === 'delete' ? { id: input.id, deleted: true } : { id: 's1', code }),
        create: async () => { throw new Error('不应调用'); },
      };
      const bridged = bridgeScheduleService(service);
      const result = await bridged.update({ sessionId: 'pa24-feishu', id: 's1', expected: { updatedAt: 'x' }, change: { kind: 'daily', daily: { time: '09:30:00', time_zone: 'UTC' } }, title: '[24PA] 晨报', prompt: '唤醒' });
      expect(result).toMatchObject({ updated: false, record: undefined, code });
    }
  });
  it('新方言删除并入 edit 且结果形状保留', async () => {
    const edits = [];
    const service = {
      edit: async input => { edits.push(input); return { id: input.id, deleted: true }; },
      create: async () => { throw new Error('不应调用'); },
    };
    const bridged = bridgeScheduleService(service);
    await expect(bridged.delete({ sessionId: 'pa24-feishu', id: 's1' })).resolves.toMatchObject({ deleted: true });
    expect(edits[0]).toEqual({ id: 's1', action: 'delete' });
  });
});
