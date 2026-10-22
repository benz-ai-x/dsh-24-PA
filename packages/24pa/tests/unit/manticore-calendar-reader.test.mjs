import { describe, it, expect } from 'vitest';
import { SourceCalendarReader } from '../../lib/source-calendar-reader.js';
const target = { sourceId: 'project', domain: 'calendar', platform: 'feishu', identity: { ownerId: 'ou_me', authority: 'app:a', platform: 'feishu' }, identityKey: 'identity', resource: { kind: 'calendar', id: 'cal' } };
const query = { from: '2026-10-23T00:00:00Z', to: '2026-10-24T00:00:00Z' };
const raw = (id = 'event_0', patch = {}) => ({ event_id: id, summary: '非助理创建的会议', start_time: { timestamp: '1792717200', timezone: 'Asia/Shanghai' }, end_time: { timestamp: '1792720800', timezone: 'Asia/Shanghai' }, event_organizer: { user_id: 'ou_other' }, organizer_calendar_id: 'origin', status: 'confirmed', ...patch });
function reader(lark, wecom = async () => { throw Error('不应调用'); }) {
  return new SourceCalendarReader({ lark, wecom, timeZone: () => 'Asia/Shanghai', now: () => new Date('2026-10-23T00:00:00Z') });
}
describe('Manticore 原生日程读取', () => {
  it('分页读取直接及群参与者，使用真实 ID；同组织者日历+实例在不同副本保持相同对象身份', async () => {
    const calls = [];
    const instance = reader(async args => {
      calls.push(args);
      if (args.includes('instance_view')) return { data: { items: [raw()] } };
      if (args[0] === 'api') {
        const params = JSON.parse(args[args.indexOf('--params') + 1]);
        return { data: params.page_token ? { items: [{ open_id: 'ou_me', rsvp_status: 'accept' }], has_more: false } : { items: [{ open_id: 'ou_someone' }], has_more: true, page_token: 'members-2' } };
      }
      return { data: args.includes('--page-token') ? { items: [{ type: 'chat', attendee_id: 'group' }], has_more: false } : { items: [{ type: 'user', user_id: 'ou_other', is_organizer: true }], has_more: true, page_token: 'people-2' } };
    });
    const a = await instance.read(target, query), b = await instance.read({ ...target, resource: { kind: 'calendar', id: 'other-copy' } }, query);
    expect(a.state).toBe('complete'); expect(a.items[0].roles).toEqual({ complete: true, values: ['participant'] });
    expect(a.items[0].nativeId).toBe(b.items[0].nativeId); expect(a.items[0].locator.calendarId).not.toBe(b.items[0].locator.calendarId);
    expect(calls.filter(call => call[0] === 'api')).toHaveLength(4);
    expect(a.items[0].capabilities.cancel).toBe('unknown');
  });
  it('参与分页失败保留已核实的正向关系并标记不完整，不能借日历 owner 推断组织者', async () => {
    const result = await reader(async args => {
      if (args.includes('instance_view')) return { data: { items: [raw('event_0', { event_organizer: undefined })] } };
      if (args.includes('--page-token')) throw Error('下一页无权');
      return { data: { items: [{ type: 'user', user_id: 'ou_me', rsvp_status: 'accept' }], has_more: true, page_token: 'next' } };
    }).read(target, query);
    expect(result.state).toBe('complete'); expect(result.items[0].roles).toMatchObject({ complete: false, values: ['participant'] });
    expect(result.items[0].roles.reason).toContain('下一页无权');
  });
  it('拒绝参与和未知群成员不会被当作本人参与；全天结束日期使用原生排他规则', async () => {
    const result = await reader(async args => args.includes('instance_view')
      ? { data: { items: [raw('all-day_0', { start_time: { date: '2026-10-23', timezone: 'Asia/Shanghai' }, end_time: { date: '2026-10-24', timezone: 'Asia/Shanghai' } })] } }
      : { data: { items: [{ type: 'user', user_id: 'ou_me', rsvp_status: 'decline' }], has_more: false } }).read(target, query);
    expect(result.state).toBe('complete'); expect(result.items[0].roles.values).toEqual([]);
    expect(result.items[0].endTime.toISOString()).toBe('2026-10-23T16:00:00.000Z');
  });
  it('超过 40 天分窗，后一窗口失败保留前一窗口的部分结果', async () => {
    let count = 0;
    const result = await reader(async args => {
      if (!args.includes('instance_view')) return { data: { items: [], has_more: false } };
      if (++count === 2) throw Error('远端离线');
      return { data: { items: [raw()] } };
    }).read(target, { ...query, to: '2026-12-23T00:00:00Z' });
    expect(result.state).toBe('partial'); expect(result.items).toHaveLength(1); expect(count).toBe(2);
  });
  it('两小时饱和不冒充完整；原生取消状态保留失效成员，重复实例保持独立', async () => {
    const result = await reader(async args => args.includes('instance_view') ? { data: { items: [raw('rec_1792717200'), raw('gone_0', { status: 'cancelled' })] } } : { data: { items: [], has_more: false } }).read(target, query);
    expect(result.items[0].body.recurring).toBe(true); expect(result.items[1].active).toBe(false);
    const dense = await reader(async args => args.includes('instance_view') ? { data: { items: Array.from({ length: 1000 }, (_, i) => raw(`dense-${i}_0`, { status: 'cancelled' })) } } : { data: { items: [], has_more: false } }).read(target, { from: '2026-10-23T00:30:00Z', to: '2026-10-23T02:30:00Z' });
    expect(dense.state).toBe('partial'); expect(dense.reason).toContain('上限');
  });
  it('缺少分页结束证据和无法解析条目都不会清空当前来源', async () => {
    const result = await reader(async args => args.includes('instance_view') ? { data: { items: [raw(), { event_id: 'bad' }] } } : { data: { items: [] } }).read(target, query);
    expect(result.state).toBe('partial'); expect(result.items[0].roles.reason).toContain('结束标记'); expect(result.reason).toContain('无法解析');
  });
  it('企微授权范围按真实 userid 判断参与，姓名不能补造组织者；超出 30 天明确部分范围', async () => {
    const result = await reader(async () => { throw Error('不应调用'); }, async () => ({ data: { schedule_list: [{ schedule_id: 'w1', subject: '外部日程', begin_time: '2026-10-23 09:00:00', end_time: '2026-10-23 10:00:00', creator_name: '主人', attendees: [{ userid: 'u-me', name: '别名' }], timezone: { timezone_id: 'Asia/Shanghai' } }], schedule_list_count: 1 } })).read({ ...target, platform: 'wecom', identity: { platform: 'wecom', ownerId: 'u-me', authority: 'bot:b' }, resource: { kind: 'authorized_scope', id: 'authorized' } }, { ...query, to: '2026-12-01T00:00:00Z' });
    expect(result.state).toBe('partial'); expect(result.items[0].roles.values).toEqual(['participant']); expect(result.reason).toContain('30 天'); expect(result.items[0].roles.reason).toContain('组织者');
  });
});
