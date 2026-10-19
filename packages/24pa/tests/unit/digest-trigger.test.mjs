import { describe, expect, it } from 'vitest';
import { renderReminderFraming, renderRecurringReminderBatchFraming } from '@deepseek-ai/dsh-schedule';
import { captureDigestTrigger } from '../../lib/digest-trigger.js';

const at = '2026-10-18T15:59:00.000Z';
const framing = renderReminderFraming({ id: 'schedule-1', prompt: '计划', scheduledAt: at });
const message = (text = framing, kind = 'schedule', id = 'message') => ({ type: 'user/message', data: { id, source: { kind }, content: [{ type: 'text', text }] } });
const start = turn => ({ type: 'turn/start', data: { turn } });
const end = turn => ({ type: 'turn/end', data: { turn } });
const capture = events => captureDigestTrigger({ id: 'access', ownEvents: () => events });

describe('原生 Schedule 已消费输入适配', () => {
  it('单次和批次均只接受宿主 source，而非相同的用户/模型文本', () => {
    expect(capture([start(1), message()])).toMatchObject({ kind: 'schedule', deliveries: [{ scheduleId: 'schedule-1', occurrenceAt: at, messageId: 'message' }] });
    const batch = renderRecurringReminderBatchFraming([{ record: { id: 's1', prompt: '' }, occurrenceAt: at }, { record: { id: 's2', prompt: '' }, occurrenceAt: at }]);
    expect(capture([start(1), message(batch)]).deliveries.map(row => row.scheduleId)).toEqual(['s1', 's2']);
    expect(capture([start(1), message(framing, 'user')]).kind).toBe('admission');
    expect(() => capture([start(1), message(framing, 'tool')])).toThrow('轮次');
  });

  it('忽略历史轮次和还在 next-turn 队列中的提醒', () => {
    const pending = { type: 'agent/inbox/spliced', data: { target: 'next-turn', inserted: [message().data] } };
    expect(capture([start(1), message(), end(1), start(2), message('人工委派', 'user'), pending])).toMatchObject({ kind: 'admission', turn: 2 });
  });

  it('当前轮次消耗的 Schedule 不被后续普通输入或排队事件覆盖', () => {
    expect(capture([start(1), message(), message('补充', 'user'), { type: 'agent/inbox/spliced', data: { target: 'next-turn', inserted: [] } }])).toMatchObject({ kind: 'schedule', turn: 1 });
  });

  it('没有打开的轮次或只有未消费 inbox 时拒绝判定', () => {
    expect(() => capture([start(1), message(), end(1)])).toThrow('轮次');
    expect(() => capture([start(1), { type: 'agent/inbox/spliced', data: { inserted: [message().data] } }])).toThrow('轮次');
  });

  it('宿主格式错误、无效时间和同计划多个窗口明确拒绝，不退回执行日', () => {
    expect(() => capture([start(1), message('bad envelope')])).toThrow('格式');
    expect(() => capture([start(1), message(framing.replace(at, 'invalid'))])).toThrow('有效');
    expect(() => capture([start(1), message(), message(framing.replace(at, '2026-10-19T15:59:00.000Z'), 'schedule', 'second')])).toThrow('多个窗口');
  });
});
