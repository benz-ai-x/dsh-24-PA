import { describe, expect, it } from 'vitest';
import { validateConfig, parseAgentsMd, template, ConfigError, DEFAULT_CONFIG } from '../../lib/config.js';

describe('AGENTS.md 配置校验', () => {
  it('接受默认模板并完整往返', () => {
    const parsed = parseAgentsMd(template());
    expect(parsed.config).toEqual(DEFAULT_CONFIG);
    expect(parsed.instructions).not.toContain('"larkProfile"');
    expect(parsed.sourceHash).toHaveLength(64);
  });

  it('拒绝未知字段与坏版本', () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, extra: 1 })).toThrow(ConfigError);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, version: 2 })).toThrow(/version/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, mode: 'weixin' })).toThrow(/mode/);
  });

  it('要求固定 profile、合法环境变量名与时区', () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, larkProfile: '' })).toThrow(/larkProfile/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, appIdEnv: 'not-env' })).toThrow(/环境变量/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, pgDsnEnv: 'pa24/pg' })).toThrow(/环境变量/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, timeZone: 'Mars/Olympus' })).toThrow(/timeZone/);
  });

  it('校验 maxWorkers 与 enabledWorkers', () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, maxWorkers: 0 })).toThrow(/maxWorkers/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, maxWorkers: 9 })).toThrow(/maxWorkers/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, enabledWorkers: ['calendar'] })).toThrow(/enabledWorkers/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, enabledWorkers: ['memo', 'memo'] })).toThrow(/enabledWorkers/);
  });

  it('workerModels 只接受 provider/model 且角色必须已注册', () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, workerModels: { memo: { provider: 'p', model: 'm', x: 1 } } })).toThrow(/模型配置/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, workerModels: { ghost: { provider: 'p', model: 'm' } } })).toThrow(/未注册/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, workerModels: { memo: { provider: 'p', model: 'm' } } })).not.toThrow();
  });

  it('feishu 模式必须提供主人与资源', () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, mode: 'feishu' })).toThrow(/ownerOpenId/);
    expect(
      () => validateConfig({ ...DEFAULT_CONFIG, mode: 'feishu', ownerOpenId: 'ou_x', folderToken: 'fld', tasklistId: 'tl' }),
    ).not.toThrow();
  });

  it('AGENTS.md 必须恰好一个 json 配置块且为合法 JSON', () => {
    expect(() => parseAgentsMd('# t\n\n```json\n{"version":1}\n```\n\n```json\n{}\n```\n')).toThrow(/唯一/);
    expect(() => parseAgentsMd('# t\n')).toThrow(/唯一/);
    expect(() => parseAgentsMd('```json\n{broken\n```')).toThrow(/有效 JSON/);
  });
});
