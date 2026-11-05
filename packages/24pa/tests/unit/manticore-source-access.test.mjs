import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { effectiveSources } from '../../lib/source-config.js';
import { SourceAccess } from '../../lib/source-access.js';

const config = { ...DEFAULT_CONFIG, ownerOpenId: 'owner', calendarId: 'primary' };
const source = () => effectiveSources(config).entries[0];
const auth = { appId: 'app', verified: true, identities: { user: { openId: 'owner', tokenStatus: 'valid' } } };
const context = '机器人身份： 名字：Bot ID：bot-1 授权真人用户身份： 名字：Owner ID：owner';
const make = (lark, wecom = async () => { throw Error('不应访问企微'); }) => new SourceAccess({ config: () => config, lark, wecom, identityRetryDelayMs: 0 });

describe('来源只读检查的实际 CLI 契约', () => {
  it('primary 必须按本人唯一解析，再读实际 role；公开权限不能冒充写入角色', async () => {
    const calls = [];
    const access = make(async args => {
      calls.push(args);
      if (args[0] === 'auth') return { data: auth };
      if (args[2] === 'primary') return { data: { calendars: [{ user_id: 'owner', calendar: { calendar_id: 'real' } }] } };
      return { data: { calendar_id: 'real', permissions: 'public', role: 'reader' } };
    });
    const result = await access.check(source());
    expect(result).toMatchObject({ state: 'verified', resource: { id: 'real' }, capabilities: { read: 'allowed', create: 'denied' } });
    expect(calls.at(-1)).toContain('real'); expect(calls.flat()).not.toContain('create');
  });
  it('第三方日历即便返回 owner 仍不能写入；只有忙闲权限不报完整详情可读', async () => {
    for (const [calendar, capability] of [[{ role: 'owner', is_third_party: true }, { create: 'denied', read: 'allowed' }], [{ role: 'free_busy_reader' }, { create: 'denied', read: 'denied' }]]) {
      const access = make(async args => ({ data: args[0] === 'auth' ? auth : { calendar_id: 'real', ...calendar } }));
      expect((await access.check({ ...source(), resourceId: 'real' })).capabilities).toMatchObject(capability);
    }
  });
  it('身份不足不读资源，主日历有歧义不猜一个', async () => {
    let calls = 0;
    const access = make(async args => { calls++; if (args[0] !== 'auth') throw Error('不应读取资源'); return { data: { ...auth, verified: false } }; });
    await expect(access.check(source())).rejects.toThrow(/身份/);
    // 绑定匹配而核验结论未过（verified=false、令牌仍 valid）：先重读一次再判死。
    expect(calls).toBe(2);
    const ambiguous = make(async args => ({ data: args[0] === 'auth' ? auth : { calendars: [{ user_id: 'owner', calendar: { calendar_id: 'a' } }, { user_id: 'owner', calendar: { calendar_id: 'b' } }] } }));
    await expect(ambiguous.check(source())).rejects.toThrow(/唯一/);
  });
  it('令牌过期后的惰性刷新：首个回执仍报旧态、重读一次即恢复；绑定不符或应用缺失不重试', async () => {
    let reads = 0;
    const recovered = make(async args => {
      if (args[0] !== 'auth') throw Error('不应读取资源');
      reads++;
      return { data: reads === 1 ? { appId: 'app', verified: true, identities: { user: { openId: 'owner', tokenStatus: 'expired' } } } : auth };
    });
    const result = await recovered.identity('feishu');
    expect(result).toEqual({ platform: 'feishu', ownerId: 'owner', authority: 'app:app' });
    expect(reads).toBe(2);
    let wrongOwner = 0;
    const mismatch = make(async args => {
      if (args[0] !== 'auth') throw Error('不应读取资源');
      wrongOwner++;
      return { data: { appId: 'app', verified: true, identities: { user: { openId: 'other', tokenStatus: 'valid' } } } };
    });
    await expect(mismatch.identity('feishu')).rejects.toThrow('固定飞书 profile 的应用、有效用户令牌与主人身份尚未核验一致。');
    expect(wrongOwner).toBe(1);
    let missing = 0;
    const noGrant = make(async args => {
      if (args[0] !== 'auth') throw Error('不应读取资源');
      missing++;
      return { data: { appId: 'app', verified: false, identities: {} } };
    });
    await expect(noGrant.identity('feishu')).rejects.toThrow(/身份/);
    expect(missing).toBe(1);
    let noApp = 0;
    const missingApp = make(async args => {
      if (args[0] !== 'auth') throw Error('不应读取资源');
      noApp++;
      return { data: { verified: true, identities: { user: { openId: 'owner', tokenStatus: 'valid' } } } };
    });
    await expect(missingApp.identity('feishu')).rejects.toThrow(/身份/);
    expect(noApp).toBe(1);
  });
  it('清单 owner 与 creator 分开；群成员不是已证实的本人编辑权限', async () => {
    const access = make(async args => ({ data: args[0] === 'auth' ? auth : { tasklist: { guid: 'list', creator: { id: 'owner', type: 'user' }, owner: { id: 'someone', type: 'user' }, members: [{ id: 'chat', type: 'chat', role: 'editor' }] } } }));
    const result = await access.check({ ...source(), domain: 'todo', resourceKind: 'tasklist', resourceId: 'list' });
    expect(result.capabilities).toMatchObject({ read: 'allowed', create: 'unknown' });
  });
  it('本人相关待办可读不证明创建权限，明确标记仅允许尝试', async () => {
    const access = make(async args => ({ data: args[0] === 'auth' ? auth : { items: [], has_more: false } }));
    const result = await access.check({ ...source(), domain: 'todo', resourceKind: 'authorized_scope', resourceId: 'authorized' });
    expect(result.capabilities).toMatchObject({ read: 'allowed', create: 'attemptable', update: 'unknown' });
    expect(result.message).toMatch(/创建权限尚未核验/);
  });
  it('企微授权范围核对 bot 与真人；具体容器不伪装，待办 probe 使用独立状态参数', async () => {
    const calls = [];
    const access = make(async () => { throw Error('不应访问飞书'); }, async args => {
      calls.push(args); return { raw: { extra_identity_context: context }, data: {} };
    });
    const row = { ...source(), platform: 'wecom', ownerId: 'owner', domain: 'todo', resourceKind: 'authorized_scope', resourceId: 'authorized' };
    const result = await access.check(row);
    expect(result.capabilities.create).toBe('attemptable');
    expect(result.identity).toEqual({ platform: 'wecom', ownerId: 'owner', authority: 'bot:bot-1' });
    expect(calls.at(-1)).toEqual(['todo', 'list', '--status-filter', 'proceed', 'finished', '--limit', '1']);
    const before = calls.length;
    expect((await access.check({ ...row, resourceKind: 'tasklist', resourceId: 'project-list' })).capabilities.read).toBe('adapter_unavailable');
    expect(calls).toHaveLength(before);
    await expect(access.check({ ...row, ownerId: 'other' })).rejects.toThrow(/身份/);
  });
});
