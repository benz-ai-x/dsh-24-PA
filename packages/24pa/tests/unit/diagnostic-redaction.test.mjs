import { describe, expect, it } from 'vitest';
import { redactDiagnostic } from '../../lib/diagnostic-redaction.js';

describe('诊断凭据脱敏', () => {
  it('隐藏任意认证方案的完整 Authorization 值', () => {
    const cases = [
      ['Authorization: Bearer bearer-token', 'Authorization: [已隐藏]'],
      ['Authorization: Basic basic-token', 'Authorization: [已隐藏]'],
      ['authorization: token token-value', 'authorization: [已隐藏]'],
      ['AUTHORIZATION="raw-token"', 'AUTHORIZATION="[已隐藏]"'],
      ['Authorization: raw-token', 'Authorization: [已隐藏]'],
      ['authorization=Basic basic-token, next=value', 'authorization=[已隐藏], next=value'],
      ['upstream Bearer standalone-token', 'upstream Bearer [已隐藏]'],
    ];
    for (const [input, expected] of cases) expect(redactDiagnostic(input)).toBe(expected);
  });

  it('按归一化后缀隐藏嵌套对象中的凭据字段', () => {
    const credentials = [
      'tenant-token', 'app-token', 'user-token', 'camel-token', 'refresh-token',
      'app-secret', 'client-secret', 'api-key', 'authorization-value', 'password-value',
    ];
    const value = {
      tenant_access_token: credentials[0],
      app_access_token: credentials[1],
      user_access_token: credentials[2],
      nested: [{ accessToken: credentials[3], refreshToken: credentials[4] }],
      detail: {
        appSecret: credentials[5], client_secret: credentials[6], apiKey: credentials[7],
        authorization: credentials[8], password: credentials[9],
      },
      resourceId: 'cal-a', ownerOpenId: 'ou_owner',
    };
    const result = redactDiagnostic(value);
    expect(result).toEqual({
      tenant_access_token: '[已隐藏]', app_access_token: '[已隐藏]', user_access_token: '[已隐藏]',
      nested: [{ accessToken: '[已隐藏]', refreshToken: '[已隐藏]' }],
      detail: {
        appSecret: '[已隐藏]', client_secret: '[已隐藏]', apiKey: '[已隐藏]',
        authorization: '[已隐藏]', password: '[已隐藏]',
      },
      resourceId: 'cal-a', ownerOpenId: 'ou_owner',
    });
    for (const credential of credentials) expect(JSON.stringify(result)).not.toContain(credential);
  });

  it('匹配字段的非字符串值也整体隐藏', () => {
    expect(redactDiagnostic({ accessToken: { raw: 'nested-token' }, appSecret: 42 })).toEqual({
      accessToken: '[已隐藏]', appSecret: '[已隐藏]',
    });
  });

  it('保留既有显式密钥、字符串字段和 DSN 脱敏及诊断元数据', () => {
    const date = new Date('2026-10-23T01:00:00Z');
    const result = redactDiagnostic({
      message: 'raw=explicit-secret "tenant_access_token":"string-token" app_secret=app-secret',
      dsn: 'postgres://user:database-password@localhost/db', date,
      appId: 'cli_a', resourceId: 'cal-a', ownerOpenId: 'ou_owner',
    }, ['explicit-secret']);
    expect(result.message).toBe('raw=[已隐藏] "tenant_access_token":"[已隐藏]" app_secret=[已隐藏]');
    expect(result.dsn).toBe('postgres://[已隐藏]@localhost/db');
    expect(result.date).toBe(date);
    expect(result).toMatchObject({ appId: 'cli_a', resourceId: 'cal-a', ownerOpenId: 'ou_owner' });
  });
});
