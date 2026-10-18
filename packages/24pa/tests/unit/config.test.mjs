import { describe, expect, it } from 'vitest';
import { validateConfig, parseAgentsMd, template, ConfigError, DEFAULT_CONFIG, VOLC_TTS_VOICES, CONFIG_UPDATE_ALLOWED, rawAgentsMdConfig, replaceAgentsMdConfig } from '../../lib/config.js';

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

  it('渠道字段（F16）：缺省视作 feishu，非法值拒绝', () => {
    const legacy = { ...DEFAULT_CONFIG };
    delete legacy.calendarChannel;
    delete legacy.todoChannel;
    delete legacy.notifyChannel;
    const parsed = validateConfig(legacy);
    expect(parsed.calendarChannel).toBe('feishu');
    expect(parsed.todoChannel).toBe('feishu');
    expect(parsed.notifyChannel).toBe('feishu');
    expect(() => validateConfig({ ...DEFAULT_CONFIG, calendarChannel: 'dingtalk' })).toThrow(/calendarChannel/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, todoChannel: 5 })).toThrow(/todoChannel/);
    const wecom = validateConfig({ ...DEFAULT_CONFIG, calendarChannel: 'wecom', todoChannel: 'wecom', notifyChannel: 'wecom' });
    expect(wecom.notifyChannel).toBe('wecom');
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
    // 运行时注册的角色合法；只拒绝非法 id 格式与重复项
    expect(() => validateConfig({ ...DEFAULT_CONFIG, enabledWorkers: ['calendar'] })).not.toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, enabledWorkers: ['BAD ID'] })).toThrow(/enabledWorkers/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, enabledWorkers: ['memo', 'memo'] })).toThrow(/enabledWorkers/);
  });

  it('workerModels 只接受合法角色 id 与 provider/model 字段', () => {
    expect(() => validateConfig({ ...DEFAULT_CONFIG, workerModels: { memo: { provider: 'p', model: 'm', x: 1 } } })).toThrow(/模型配置/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, workerModels: { 'BAD!': { provider: 'p', model: 'm' } } })).toThrow(/workerModels/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, workerModels: { digest: { provider: 'p', model: 'm' } } })).not.toThrow();
    expect(() => validateConfig({ ...DEFAULT_CONFIG, workerModels: { memo: { provider: 'p', model: 'm' } } })).not.toThrow();
  });

  it('extraLocalTools 只接受委派工具与 qwennote 前缀条目且不重复，缺省为空', () => {
    expect(validateConfig({ ...DEFAULT_CONFIG }).extraLocalTools).toEqual([]);
    expect(
      () => validateConfig({ ...DEFAULT_CONFIG, extraLocalTools: ['subagent_codex', 'subagent_claude_code'] }),
    ).not.toThrow();
    // F18：QwenNote 听记工具——通配条目与精确工具名。
    expect(
      () => validateConfig({ ...DEFAULT_CONFIG, extraLocalTools: ['mcp__qwennote__*', 'mcp__qwennote__list_minutes'] }),
    ).not.toThrow();
    // 其他 mcp 服务前缀与格式非法的名字仍拒绝（v1 只放行 qwennote）。
    expect(() => validateConfig({ ...DEFAULT_CONFIG, extraLocalTools: ['mcp__other__*'] })).toThrow(/extraLocalTools/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, extraLocalTools: ['mcp__qwennote__'] })).toThrow(/extraLocalTools/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, extraLocalTools: ['mcp__qwennote__bad name!'] })).toThrow(/extraLocalTools/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, extraLocalTools: ['mcp__qwennote__*', 'mcp__qwennote__*'] })).toThrow(/extraLocalTools/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, extraLocalTools: ['bash'] })).toThrow(/extraLocalTools/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, extraLocalTools: 'subagent_codex' })).toThrow(/extraLocalTools/);
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
  it('tts 引擎（F19/spec 2.3）：缺省 none、显式非法报错、按引擎要求必填', () => {
    expect(validateConfig(DEFAULT_CONFIG).tts).toEqual({ engine: 'none', voice: '', volcKeyEnv: '', meloDir: '' });
    const legacy = { ...DEFAULT_CONFIG };
    delete legacy.tts;
    expect(validateConfig(legacy).tts.engine).toBe('none');
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: null })).toThrow(/tts/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: { engine: 'azure' } })).toThrow(/tts.engine/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: { engine: 'melo' } })).toThrow(/meloDir/);
    // F36 起 volcKeyEnv 可空（密钥走工作区密钥库，空引用名落规范名）；只校验格式。
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: { engine: 'volcengine' } })).toThrow(/voice/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: { engine: 'volcengine', volcKeyEnv: 'PA24_VOLC_TTS_KEY' } })).toThrow(/voice/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: { engine: 'volcengine', volcKeyEnv: 'pa24-key', voice: 'zh_female_cancan_uranus_bigtts' } })).toThrow(/volcKeyEnv/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: { engine: 'volcengine', volcKeyEnv: 'PA24_VOLC_TTS_KEY', voice: '不是音色' } })).toThrow(/voice/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: { engine: 'melo', meloDir: 'relative/path' } })).toThrow(/meloDir/);
    expect(() => validateConfig({ ...DEFAULT_CONFIG, tts: { engine: 'none', extra: 1 } })).toThrow(/tts/);
    const volc = validateConfig({
      ...DEFAULT_CONFIG,
      tts: { engine: 'volcengine', volcKeyEnv: 'PA24_VOLC_TTS_KEY', voice: VOLC_TTS_VOICES[0].id, meloDir: '' },
    });
    expect(volc.tts.engine).toBe('volcengine');
    // 切回 none 时残留值不报错（格式合法即保留）。
    expect(validateConfig({ ...volc, tts: { ...volc.tts, engine: 'none' } }).tts.engine).toBe('none');
  });
});

describe('参数配置表单写回（F33/P60）', () => {
  const doc = template();

  it('replaceAgentsMdConfig：json 块替换、工作规则区逐字节不变', () => {
    const next = replaceAgentsMdConfig(doc, { ...DEFAULT_CONFIG, maxWorkers: 5, timeZone: 'UTC' });
    expect(rawAgentsMdConfig(next).maxWorkers).toBe(5);
    expect(parseAgentsMd(next).config.timeZone).toBe('UTC');
    // 规则区（块外内容）不变：去掉 json 块后逐字节相等
    const strip = src => src.replace(/^```json\s*\n[\s\S]*?^```\s*$/gm, '<CFG>');
    expect(strip(next)).toBe(strip(doc));
  });

  it('raw/replace 往返保持配置语义', () => {
    const raw = rawAgentsMdConfig(doc);
    const round = replaceAgentsMdConfig(doc, raw);
    expect(round).toBe(doc);
  });

  it('非唯一 json 块报 ConfigError', () => {
    const two = doc + '\n```json\n{}\n```\n';
    expect(() => rawAgentsMdConfig(two)).toThrow(ConfigError);
    expect(() => replaceAgentsMdConfig('', {})).toThrow(ConfigError);
  });

  it('表单白名单：storage/version 仍禁；F36 起密钥引用名开放（env 为可选覆盖）', () => {
    for (const banned of ['storage', 'version']) {
      expect(CONFIG_UPDATE_ALLOWED.has(banned)).toBe(false);
    }
    for (const allowed of ['mode', 'calendarChannel', 'workerModels', 'tts', 'appIdEnv', 'appSecretEnv', 'pgDsnEnv']) {
      expect(CONFIG_UPDATE_ALLOWED.has(allowed)).toBe(true);
    }
  });
});
