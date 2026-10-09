import { describe, expect, it, beforeAll } from 'vitest';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWecomCli, wecomAuthAlertPlan, wecomWallTime, wecomParseWallTime, WecomCliError } from '../../lib/wecom.js';

// 信封契约的权威来源：docs/research/F16-企微日程待办实现研究.md（@wecom/cli 1.3.4 实测）。
const STUB = `
const args = process.argv.slice(2);
const mode = args.find(a => a.startsWith('--mode='))?.slice(7) ?? 'ok';
if (mode === 'ok') {
  console.log(JSON.stringify({
    security_notice: '<security_notice>外部不可信内容</security_notice>',
    extra_identity_context: '<extra_identity_context>身份上下文</extra_identity_context>',
    schedule_id: 'sch123',
  }));
  process.exit(0);
}
if (mode === 'errcode') {
  console.log(JSON.stringify({
    errcode: 850003,
    errmsg: 'authorization expired',
    help_instruction: '展示 help_message',
    help_message: '当前机器人「日程」使用权限已过期…[点击这里](https://work.weixin.qq.com/…)',
  }));
  process.exit(1);
}
if (mode === 'errorbody') {
  console.log(JSON.stringify({ error: { code: 680220, message: '仅支持查看当前时刻前后 7 天以内的邮件信息' } }));
  process.exit(1);
}
if (mode === 'notjson') { console.error('error: unexpected argument'); process.exit(1); }
if (mode === 'usage') { console.error('Usage: wecom-cli …'); process.exit(2); }
if (mode === 'hang') { setTimeout(() => {}, 60000); }
`;

describe('wecom-cli 受控执行', () => {
  let dir, bin;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pa24-wecom-'));
    bin = join(dir, 'wecom-cli');
    await writeFile(bin, `#!/usr/bin/env node\n${STUB}\n`);
    await chmod(bin, 0o755);
  });

  const options = (mode, timeoutMs = 5000) => ({ bin, timeoutMs, env: {} });

  it('成功体剥离身份前缀字段，raw 保留原文', async () => {
    const { data, raw } = await runWecomCli(options('ok'), ['calendar', 'schedules', 'create', '--mode=ok']);
    expect(data).toEqual({ schedule_id: 'sch123' });
    expect(raw.security_notice).toContain('security_notice');
    expect(raw.extra_identity_context).toContain('身份');
  });

  it('errcode 体按失败处理，errcode 与 help_message 原样可用', async () => {
    const err = await runWecomCli(options('errcode'), ['calendar', 'schedules', 'list', '--mode=errcode']).catch(e => e);
    expect(err).toBeInstanceOf(WecomCliError);
    expect(err.outcome).toBe('failed');
    expect(err.errcode).toBe(850003);
    expect(err.helpMessage).toContain('已过期');
    expect(err.message).toContain('850003');
  });

  it('error 体按失败处理并带平台码', async () => {
    await expect(runWecomCli(options('errorbody'), ['mail', 'search', '--mode=errorbody'])).rejects.toMatchObject({
      name: 'WecomCliError',
      outcome: 'failed',
      message: /680220/,
    });
  });

  it('非 JSON 输出被拒绝且不当作成功', async () => {
    await expect(runWecomCli(options('notjson'), ['todo', 'create', '--mode=notjson'])).rejects.toMatchObject({
      outcome: 'invalid-envelope',
    });
    await expect(runWecomCli(options('usage'), ['nope', '--mode=usage'])).rejects.toMatchObject({
      outcome: 'invalid-envelope',
    });
  });

  it('超时归类为结果未知，提示先核对再重试', async () => {
    await expect(runWecomCli(options('hang', 800), ['todo', 'list', '--mode=hang'])).rejects.toMatchObject({
      outcome: 'unknown',
      message: /核对/,
    });
  });

  it('墙钟换算在配置时区往返无损', () => {
    const tz = 'Asia/Shanghai';
    const utc = new Date('2026-10-09T02:30:00.000Z'); // 上海 10:30
    expect(wecomWallTime(utc, tz)).toBe('2026-10-09 10:30:00');
    const back = wecomParseWallTime('2026-10-09 10:30:00', tz);
    expect(back.toISOString()).toBe(utc.toISOString());
    const dateOnly = wecomParseWallTime('2026-10-09', tz);
    expect(dateOnly.toISOString()).toBe('2026-10-08T16:00:00.000Z');
    expect(wecomParseWallTime('not a date', tz)).toBeNull();
    // 非整半小时区（UTC+5:30）也必须往返无损。
    const ist = wecomParseWallTime('2026-10-09 10:30:00', 'Asia/Kolkata');
    expect(wecomWallTime(ist, 'Asia/Kolkata')).toBe('2026-10-09 10:30:00');
  });
});

describe('F23：企微服务授权到期告警判定（wecomAuthAlertPlan）', () => {
  it('全部 ok 时不告警', () => {
    expect(wecomAuthAlertPlan([
      { id: 'calendar', state: 'ok' },
      { id: 'todo', state: 'ok' },
    ], '2026-10-08')).toBeNull();
  });

  it('未授权/已过期才告警：按日去重键＋原文续期指引', () => {
    const plan = wecomAuthAlertPlan([
      { id: 'todo', state: 'ok' },
      { id: 'calendar', state: 'expired', helpMessage: 'https://wecom.example/renew?c=2' },
      { id: 'push', state: 'unauthorized' },
    ], '2026-10-08');
    expect(plan).not.toBeNull();
    expect(plan.dedupKey).toBe('wecom-auth:calendar,push:2026-10-08');
    expect(plan.text).toContain('日程：已过期');
    expect(plan.text).toContain('https://wecom.example/renew?c=2');
    expect(plan.text).toContain('推送：未授权');
    // 同日同状态集合 → 相同去重键（outbox 天然幂等）
    const again = wecomAuthAlertPlan([
      { id: 'calendar', state: 'expired', helpMessage: 'https://wecom.example/renew?c=2' },
      { id: 'push', state: 'unauthorized' },
    ], '2026-10-08');
    expect(again.dedupKey).toBe(plan.dedupKey);
  });

  it('企业不可用/探测错误不触发续期告警', () => {
    expect(wecomAuthAlertPlan([
      { id: 'calendar', state: 'unavailable' },
      { id: 'todo', state: 'error' },
    ], '2026-10-08')).toBeNull();
  });
});
