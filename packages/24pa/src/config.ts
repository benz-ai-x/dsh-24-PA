import { createHash } from 'node:crypto';
import { agentsMdTemplate } from './prompts.js';

// AGENTS.md is the single editable authority for non-secret workspace config:
// stable rules stay as prose, machine-checked settings live in exactly one
// fenced json block, and secrets are environment variable *names* only.

export const WORKER_ROLES = ['memo'] as const;
export type WorkerRole = (typeof WORKER_ROLES)[number];

export interface WorkerModelRoute {
  provider: string;
  model: string;
  /**
   * Use the reviewed simplified persona (second-level structure for weaker
   * models) instead of the structured one; falls back to the structured copy
   * when the role has no simplified variant. See src/prompts.ts (B7).
   */
  simplePersona?: boolean;
}

export interface PaConfig {
  version: number;
  mode: 'demo' | 'feishu';
  /**
   * Business-ledger backend (spec 2.1, F25): SQLite file in the workspace by
   * default (zero external dependencies), PostgreSQL by explicit choice —
   * existing PG deployments must opt in with storage: "postgres" on upgrade.
   * Whichever backend is named is the one that runs; no silent fallback.
   */
  storage: 'sqlite' | 'postgres';
  larkProfile: string;
  ownerOpenId: string;
  folderToken: string;
  /**
   * Feishu wiki node token for note landing (spec 2.12, F22): when set, memo
   * docs and handwriting review docs are created under this wiki node
   * (docs +create accepts a wiki node as --parent-token); empty falls back to
   * folderToken, so existing workspaces keep their behavior unchanged.
   */
  wikiNodeToken: string;
  tasklistId: string;
  calendarId: string;
  /**
   * Per-domain operation channels (spec 1.6, F16): which backend executes
   * calendar / todo writes and where reminders are delivered. 'feishu' keeps
   * the v1 single-channel behavior and is the default for existing files.
   */
  calendarChannel: 'feishu' | 'wecom';
  todoChannel: 'feishu' | 'wecom';
  notifyChannel: 'feishu' | 'wecom';
  timeZone: string;
  appIdEnv: string;
  appSecretEnv: string;
  pgDsnEnv: string;
  maxWorkers: number;
  /** Role ids; runtime-registered roles are valid beyond the built-in set. */
  enabledWorkers: string[];
  workerModels: Partial<Record<string, WorkerModelRoute>>;
  /**
   * Extra tools the local role may also use: the provider-gated delegation
   * tools, plus QwenNote minutes tools mounted by a profile-level
   * dsh-mcp-client entry (serverName `qwennote`, F18). Naming an unmounted
   * tool is tolerated — the agent-side resolution filters it out — so opting
   * in stays a workspace decision recorded here, never a startup crash.
   */
  extraLocalTools: string[];
  /**
   * Workspace business skills the Lead may delegate to the generic skill
   * runner (spec 2.11/F44) — the explicit opt-in surface, same shape as
   * extraLocalTools: naming a skill that is not in the catalog is tolerated
   * (filtered at delegation time), never a startup crash.
   */
  extraBusinessSkills: string[];
  /**
   * Voice-delivery engine (spec 2.3, F19): which TTS backend synthesizes
   * digest audio. 'none' keeps text-only delivery and is the default for
   * existing files; choosing an engine makes its own fields required.
   */
  tts: TtsConfig;
}

/** TTS 引擎（spec 2.3/F19）：none＝语音关闭（默认，存量配置零影响）。 */
export type TtsEngine = 'none' | 'melo' | 'volcengine';

export interface TtsConfig {
  engine: TtsEngine;
  /** 豆包语音合成 2.0 speaker ID（VOLC_TTS_VOICES 为首发清单，允许自定义）。 */
  voice: string;
  /** 豆包 API Key 的环境变量名；密钥本体只进宿主环境，不落 AGENTS.md。 */
  volcKeyEnv: string;
  /** Melo 部署目录（含合成脚本、venv 与模型文件）。 */
  meloDir: string;
}

/** 豆包云首发五音色（2026-10-17 全部经生产 unidirectional 真机合成验证；自定义 ID 经格式校验放行）。 */
export const VOLC_TTS_VOICES: readonly { id: string; label: string }[] = [
  { id: 'zh_female_cancan_uranus_bigtts', label: '知性灿灿（女声·晨报主推）' },
  { id: 'zh_female_zhixingnv_uranus_bigtts', label: '知性女声（女声·沉稳）' },
  { id: 'zh_male_m191_uranus_bigtts', label: '云舟（男声·稳重）' },
  { id: 'zh_female_vv_uranus_bigtts', label: 'Vivi（女声·元气）' },
  { id: 'zh_female_xiaohe_uranus_bigtts', label: '小何（女声·甜）' },
];

/** Provider-gated delegation tools; they mount only after their provider bundles are installed. */
export const DELEGATION_EXTRA_TOOLS = ['subagent_codex', 'subagent_claude_code'] as const;
/** Each delegation tool and the ctx.subagents provider name that mounts it. */
export const DELEGATION_TOOL_PROVIDER: Record<(typeof DELEGATION_EXTRA_TOOLS)[number], string> = {
  subagent_codex: 'codex',
  subagent_claude_code: 'claude-code',
};
/** QwenNote minutes tools register as host-plane globals under this prefix. */
export const QWENNOTE_TOOL_PREFIX = 'mcp__qwennote__';
/** Wildcard entry: allow every currently mounted qwennote tool. */
export const QWENNOTE_TOOL_WILDCARD = 'mcp__qwennote__*';
// Precise names match the harness MCP tool-name charset; a raw name long
// enough to need the 12-hex normalization suffix can exceed the cap here —
// those stay reachable through the wildcard entry instead.
const QWENNOTE_TOOL_NAME = /^mcp__qwennote__[A-Za-z0-9_-]{1,48}$/;

/** Whether one extraLocalTools entry is acceptable: a delegation tool, the qwennote wildcard, or a precise qwennote tool name. */
export function isExtraLocalToolEntry(value: string): boolean {
  return (
    (DELEGATION_EXTRA_TOOLS as readonly string[]).includes(value) ||
    value === QWENNOTE_TOOL_WILDCARD ||
    QWENNOTE_TOOL_NAME.test(value)
  );
}

/**
 * Parent token for note-type doc creation (spec 2.12, F22): the wiki node
 * when configured, the docs folder otherwise. Memo docs and handwriting
 * review docs share this one selection so the fallback rule lives in one
 * place (asserted by unit tests; exercised end-to-end by f01/f22).
 */
export function noteParentToken(config: Pick<PaConfig, 'wikiNodeToken' | 'folderToken'>): string {
  return config.wikiNodeToken || config.folderToken;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_CONFIG: PaConfig = {
  version: 1,
  mode: 'demo',
  storage: 'sqlite',
  larkProfile: 'default',
  ownerOpenId: '',
  folderToken: '',
  wikiNodeToken: '',
  tasklistId: '',
  calendarId: 'primary',
  calendarChannel: 'feishu',
  todoChannel: 'feishu',
  notifyChannel: 'feishu',
  timeZone: 'Asia/Shanghai',
  appIdEnv: 'PA24_FEISHU_APP_ID',
  appSecretEnv: 'PA24_FEISHU_APP_SECRET',
  pgDsnEnv: 'PA24_PG_DSN',
  maxWorkers: 2,
  enabledWorkers: ['memo'],
  workerModels: {},
  extraLocalTools: [],
  extraBusinessSkills: [],
  tts: { engine: 'none', voice: '', volcKeyEnv: '', meloDir: '' },
};

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
// 豆包 speaker ID：zh_female_cancan_uranus_bigtts 形态（小写开头、字/下划线，长度封顶防误粘）。
const VOLC_VOICE_ID = /^[a-z][a-z0-9_]{7,63}$/;
const DEFAULT_TTS: TtsConfig = { engine: 'none', voice: '', volcKeyEnv: '', meloDir: '' };

/** F19/spec 2.3：tts 引擎选择校验。缺省视作 none（存量零影响）；显式 null 报错。 */
function validateTts(raw: unknown): TtsConfig {
  if (raw === undefined) return { ...DEFAULT_TTS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('tts 必须是对象。');
  const input = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter(k => !(k in DEFAULT_TTS));
  if (unknownKeys.length) throw new ConfigError(`tts 只接受 ${Object.keys(DEFAULT_TTS).join('、')} 字段。`);
  for (const key of Object.keys(DEFAULT_TTS) as (keyof TtsConfig)[]) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new ConfigError(`tts.${key} 必须为字符串。`);
  }
  const engine = (input.engine ?? 'none') as TtsEngine;
  if (engine !== 'none' && engine !== 'melo' && engine !== 'volcengine') throw new ConfigError('tts.engine 必须是 none、melo 或 volcengine。');
  const tts: TtsConfig = {
    engine,
    voice: (input.voice ?? '') as string,
    volcKeyEnv: (input.volcKeyEnv ?? '') as string,
    meloDir: (input.meloDir ?? '') as string,
  };
  // 非空即校验格式（切换引擎时保留他引擎残留值不报错，但格式必须合法）。
  if (tts.volcKeyEnv && !ENV_NAME.test(tts.volcKeyEnv)) throw new ConfigError('tts.volcKeyEnv 应填写环境变量名称（大写字母、数字、下划线）。');
  if (tts.voice && !VOLC_VOICE_ID.test(tts.voice)) throw new ConfigError('tts.voice 应填写豆包语音合成 2.0 音色 ID（如 zh_female_cancan_uranus_bigtts）。');
  if (tts.meloDir && !tts.meloDir.startsWith('/')) throw new ConfigError('tts.meloDir 必须是绝对路径。');
  if (engine === 'volcengine') {
    // F36: volcKeyEnv 可空——密钥可走工作区密钥库（空引用名落规范名
    // PA24_VOLC_TTS_KEY 由运行时兜底），环境变量只是可选覆盖。
    if (!tts.voice) throw new ConfigError('volcengine 引擎必须选择 tts.voice 音色。');
  }
  if (engine === 'melo' && !tts.meloDir) throw new ConfigError('melo 引擎必须填写 tts.meloDir 部署目录。');
  return tts;
}
const STRING_FIELDS = [
  'larkProfile',
  'ownerOpenId',
  'folderToken',
  'tasklistId',
  'calendarId',
  'timeZone',
  'appIdEnv',
  'appSecretEnv',
] as const;

export function validateConfig(raw: unknown): PaConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('配置必须是 JSON 对象。');
  const input = raw as Record<string, unknown>;
  const unknown = Object.keys(input).filter(k => !(k in DEFAULT_CONFIG));
  if (unknown.length) throw new ConfigError(`未知配置字段：${unknown.join(', ')}。`);
  if (input.version !== 1) throw new ConfigError('配置 version 必须为 1。');
  if (input.mode !== 'demo' && input.mode !== 'feishu') throw new ConfigError('mode 必须是 demo 或 feishu。');
  // 旧版 AGENTS.md 不含 channel 字段：缺省视作 feishu（规格 1.6 存量零影响）。
  for (const key of ['calendarChannel', 'todoChannel', 'notifyChannel'] as const) {
    const value = input[key] ?? 'feishu';
    if (value !== 'feishu' && value !== 'wecom') throw new ConfigError(`${key} 必须是 feishu 或 wecom。`);
  }
  // F22：知识库节点 token 可选；缺省空串＝沿用 folderToken（存量零影响），
  // 显式 null 报错不静默吞（与 storage 同一缺省纪律）。
  if (input.wikiNodeToken !== undefined && typeof input.wikiNodeToken !== 'string') {
    throw new ConfigError('配置 wikiNodeToken 必须为字符串。');
  }
  for (const key of STRING_FIELDS) {
    if (typeof input[key] !== 'string') throw new ConfigError(`配置 ${key} 必须为字符串。`);
  }
  if (!input.larkProfile) throw new ConfigError('必须固定飞书 CLI profile（larkProfile）。');
  // F25：账本后端缺省 sqlite；postgres 才要求 pgDsnEnv（存量 PG 工作区升级时显式声明）。
  // `undefined` (older file without the field) takes the product default;
  // an explicit `null` must fail loud, not silently become sqlite.
  const storage = (input.storage === undefined ? 'sqlite' : input.storage) as PaConfig['storage'];
  if (storage !== 'sqlite' && storage !== 'postgres') throw new ConfigError('storage 必须是 sqlite 或 postgres。');
  const dsnEnvKeys = storage === 'postgres'
    ? (['appIdEnv', 'appSecretEnv', 'pgDsnEnv'] as const)
    : (['appIdEnv', 'appSecretEnv'] as const);
  for (const key of dsnEnvKeys) {
    if (!ENV_NAME.test(input[key] as string)) throw new ConfigError(`${key} 应填写环境变量名称（大写字母、数字、下划线）。`);
  }
  if (storage === 'sqlite' && input.pgDsnEnv !== undefined && !ENV_NAME.test(input.pgDsnEnv as string)) {
    throw new ConfigError('pgDsnEnv 应填写环境变量名称（大写字母、数字、下划线）。');
  }
  const maxWorkers = input.maxWorkers;
  if (!Number.isInteger(maxWorkers) || (maxWorkers as number) < 1 || (maxWorkers as number) > 8) {
    throw new ConfigError('maxWorkers 必须是 1–8 的整数。');
  }
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: input.timeZone as string });
  } catch {
    throw new ConfigError(`timeZone 无效：${input.timeZone}`);
  }
  const enabledWorkers = input.enabledWorkers;
  const ROLE_ID = /^[a-z][a-z0-9_]{1,30}$/;
  if (
    !Array.isArray(enabledWorkers) ||
    enabledWorkers.length === 0 ||
    enabledWorkers.some(x => typeof x !== 'string' || !ROLE_ID.test(x)) ||
    new Set(enabledWorkers).size !== enabledWorkers.length
  ) {
    throw new ConfigError(`enabledWorkers 必须是不重复的角色 id（如 ${WORKER_ROLES.join(', ')}；运行时注册的角色亦可）。`);
  }
  const workerModels = input.workerModels;
  if (!workerModels || Array.isArray(workerModels) || typeof workerModels !== 'object') throw new ConfigError('workerModels 必须是对象。');
  for (const [role, route] of Object.entries(workerModels)) {
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(role)) throw new ConfigError(`workerModels 角色 id 无效：${role}。`);
    if (!route || typeof route !== 'object' || typeof (route as any).provider !== 'string' || typeof (route as any).model !== 'string' || Object.keys(route).some(k => !['provider', 'model', 'simplePersona'].includes(k))) {
      throw new ConfigError('Worker 模型配置只接受 provider、model、simplePersona 字段。');
    }
    if ((route as any).simplePersona !== undefined && typeof (route as any).simplePersona !== 'boolean') throw new ConfigError('simplePersona 必须是布尔值。');
  }
  const extraLocalTools = input.extraLocalTools ?? [];
  const extraBusinessSkills = input.extraBusinessSkills ?? [];
  const SKILL_NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;
  if (
    !Array.isArray(extraBusinessSkills) ||
    extraBusinessSkills.some(x => typeof x !== 'string' || !SKILL_NAME_RE.test(x)) ||
    new Set(extraBusinessSkills).size !== extraBusinessSkills.length
  ) {
    throw new ConfigError('extraBusinessSkills 只接受不重复的 kebab-case skill 名（如 standup-prep）。');
  }
  if (
    !Array.isArray(extraLocalTools) ||
    extraLocalTools.some(x => typeof x !== 'string' || !isExtraLocalToolEntry(x)) ||
    new Set(extraLocalTools).size !== extraLocalTools.length
  ) {
    throw new ConfigError(`extraLocalTools 只接受不重复的 ${DELEGATION_EXTRA_TOOLS.join('、')}、${QWENNOTE_TOOL_WILDCARD} 或 ${QWENNOTE_TOOL_PREFIX}<工具名>。`);
  }
  const tts = validateTts(input.tts);
  const config: PaConfig = {
    version: 1,
    mode: input.mode,
    storage,
    larkProfile: input.larkProfile as string,
    ownerOpenId: input.ownerOpenId as string,
    folderToken: input.folderToken as string,
    wikiNodeToken: (input.wikiNodeToken ?? '') as string,
    tasklistId: input.tasklistId as string,
    calendarId: input.calendarId as string,
    calendarChannel: (input.calendarChannel ?? 'feishu') as PaConfig['calendarChannel'],
    todoChannel: (input.todoChannel ?? 'feishu') as PaConfig['todoChannel'],
    notifyChannel: (input.notifyChannel ?? 'feishu') as PaConfig['notifyChannel'],
    timeZone: input.timeZone as string,
    appIdEnv: input.appIdEnv as string,
    appSecretEnv: input.appSecretEnv as string,
    pgDsnEnv: (input.pgDsnEnv ?? 'PA24_PG_DSN') as string,
    maxWorkers: maxWorkers as number,
    enabledWorkers: enabledWorkers as string[],
    workerModels: workerModels as PaConfig['workerModels'],
    extraLocalTools: extraLocalTools as string[],
    extraBusinessSkills: extraBusinessSkills as string[],
    tts,
  };
  if (config.mode === 'feishu') {
    for (const key of ['ownerOpenId', 'folderToken', 'tasklistId'] as const) {
      if (!config[key]) throw new ConfigError(`feishu 模式缺少 ${key}。`);
    }
  }
  return config;
}

export interface ParsedAgentsMd {
  config: PaConfig;
  instructions: string;
  sourceHash: string;
}

const JSON_BLOCK = /^```json\s*\n([\s\S]*?)^```\s*$/gm;

/** The single (unique) fenced json block of an AGENTS.md document. */
function findJsonBlock(source: string): RegExpMatchArray {
  const blocks = [...source.matchAll(JSON_BLOCK)];
  if (blocks.length !== 1 || !blocks[0]![1]) throw new ConfigError('AGENTS.md 必须包含唯一的一个 ```json 配置块。');
  return blocks[0]!;
}

export function parseAgentsMd(source: string): ParsedAgentsMd {
  const block = findJsonBlock(source);
  let config: unknown;
  try {
    config = JSON.parse(block[1]!);
  } catch (error) {
    throw new ConfigError(`配置块不是有效 JSON：${(error as Error).message}`);
  }
  return {
    config: validateConfig(config),
    instructions: source.replace(block[0]!, '（接入配置由宿主读取）'),
    sourceHash: createHash('sha256').update(source).digest('hex'),
  };
}

export function template(): string {
  return agentsMdTemplate(JSON.stringify(DEFAULT_CONFIG, null, 2));
}

// F33/P60: 参数配置表单的可更新字段白名单。storage（数据迁移）与 version
// （固定 1）仍不走表单；F36 起三个密钥引用名开放表单编辑（env 为可选覆盖，
// 密钥值本身经 workspace.secret-update 进工作区密钥库，不进配置块）。
// Round-3 arch-4：白名单从 CONFIG_FIELDS 描述符派生（单一来源），并补齐
// extraBusinessSkills（F44 既有字段的表单缺口）。
export interface ConfigFieldDescriptor {
  name: string;
  group: 'identity' | 'channels' | 'resources' | 'runtime' | 'storage' | 'tts';
  label: string;
  kind: 'string' | 'number' | 'enum' | 'boolean' | 'list';
  /** enum 选项（如音色表——client 不再持有第二份）。 */
  options?: readonly { value: string; label: string }[];
  /** 表单可更新（CONFIG_UPDATE_ALLOWED 的派生源）。 */
  formAllowed: boolean;
  default: unknown;
}

/** 配置字段的单一描述表（arch-4）：标签/分组/类型/默认/可更新一处声明，面板与文档从这里取。 */
export const CONFIG_FIELDS: readonly ConfigFieldDescriptor[] = [
  { name: 'mode', group: 'identity', label: '接入模式（mode）', kind: 'enum', options: [{ value: 'demo', label: '体验' }, { value: 'feishu', label: '飞书' }], formAllowed: true, default: DEFAULT_CONFIG.mode },
  { name: 'larkProfile', group: 'identity', label: '固定 CLI profile（larkProfile）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.larkProfile },
  { name: 'ownerOpenId', group: 'identity', label: '配置主人（ownerOpenId）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.ownerOpenId },
  { name: 'calendarChannel', group: 'channels', label: '日程渠道（calendarChannel）', kind: 'enum', options: [{ value: 'feishu', label: '飞书' }, { value: 'wecom', label: '企微' }], formAllowed: true, default: DEFAULT_CONFIG.calendarChannel },
  { name: 'todoChannel', group: 'channels', label: '待办渠道（todoChannel）', kind: 'enum', options: [{ value: 'feishu', label: '飞书' }, { value: 'wecom', label: '企微' }], formAllowed: true, default: DEFAULT_CONFIG.todoChannel },
  { name: 'notifyChannel', group: 'channels', label: '通知渠道（notifyChannel）', kind: 'enum', options: [{ value: 'feishu', label: '飞书' }, { value: 'wecom', label: '企微' }], formAllowed: true, default: DEFAULT_CONFIG.notifyChannel },
  { name: 'folderToken', group: 'resources', label: '飞书文件夹（folderToken）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.folderToken },
  { name: 'wikiNodeToken', group: 'resources', label: '知识库节点（wikiNodeToken，可选）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.wikiNodeToken },
  { name: 'tasklistId', group: 'resources', label: '任务清单（tasklistId）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.tasklistId },
  { name: 'calendarId', group: 'resources', label: '本人日历（calendarId）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.calendarId },
  { name: 'timeZone', group: 'runtime', label: '时区（timeZone）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.timeZone },
  { name: 'maxWorkers', group: 'runtime', label: '并行上限（maxWorkers）', kind: 'number', formAllowed: true, default: DEFAULT_CONFIG.maxWorkers },
  { name: 'enabledWorkers', group: 'runtime', label: '启用角色（enabledWorkers）', kind: 'list', formAllowed: true, default: DEFAULT_CONFIG.enabledWorkers },
  { name: 'workerModels', group: 'runtime', label: '模型路由（workerModels）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.workerModels },
  { name: 'extraLocalTools', group: 'runtime', label: '本地额外工具（extraLocalTools）', kind: 'list', formAllowed: true, default: DEFAULT_CONFIG.extraLocalTools },
  { name: 'extraBusinessSkills', group: 'runtime', label: '业务 skill 放行面（extraBusinessSkills）', kind: 'list', formAllowed: true, default: DEFAULT_CONFIG.extraBusinessSkills },
  { name: 'tts', group: 'tts', label: '语音 TTS（tts）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.tts },
  { name: 'tts.engine', group: 'tts', label: 'TTS 引擎（tts.engine）', kind: 'enum', options: [{ value: 'none', label: '关闭' }, { value: 'melo', label: 'Melo 本地' }, { value: 'volcengine', label: '豆包云' }], formAllowed: false, default: DEFAULT_CONFIG.tts.engine }, // dotted tts.* fields describe structure; updatability rides the top-level 'tts' entry
  { name: 'tts.voice', group: 'tts', label: '音色（tts.voice）', kind: 'enum', options: VOLC_TTS_VOICES.map(v => ({ value: v.id, label: v.label })), formAllowed: false, default: '' },
  { name: 'tts.volcKeyEnv', group: 'tts', label: '豆包密钥环境变量名（tts.volcKeyEnv）', kind: 'string', formAllowed: false, default: '' },
  { name: 'tts.meloDir', group: 'tts', label: 'Melo 部署目录（tts.meloDir）', kind: 'string', formAllowed: false, default: '' },
  { name: 'appIdEnv', group: 'storage', label: 'App ID 环境变量名（appIdEnv）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.appIdEnv },
  { name: 'appSecretEnv', group: 'storage', label: 'App Secret 环境变量名（appSecretEnv）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.appSecretEnv },
  { name: 'pgDsnEnv', group: 'storage', label: 'PG DSN 环境变量名（pgDsnEnv）', kind: 'string', formAllowed: true, default: DEFAULT_CONFIG.pgDsnEnv },
];

export const CONFIG_UPDATE_ALLOWED: ReadonlySet<string> = new Set(
  CONFIG_FIELDS.filter(f => f.formAllowed && !f.name.includes('.')).map(f => f.name),
);

/** Parse the raw JSON object of the unique config block; ConfigError on malformed input. */
export function rawAgentsMdConfig(source: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(findJsonBlock(source)[1]!);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ConfigError(`配置块不是有效 JSON：${(error as Error).message}`);
  }
}

/** Replace the unique config block in place; prose rules stay byte-identical. */
export function replaceAgentsMdConfig(source: string, config: Record<string, unknown>): string {
  // Splice by match index instead of source.replace(searchText, …): a literal
  // replace would hit the FIRST identical substring anywhere in the prose,
  // while the block's own index pins the swap to the actual config block.
  const block = findJsonBlock(source);
  const start = block.index! + block[0]!.indexOf(block[1]!);
  // The capture includes the newline before the closing fence (^``` needs a
  // line start), so the replacement re-appends it to stay byte-compatible.
  return source.slice(0, start) + JSON.stringify(config, null, 2) + '\n' + source.slice(start + block[1]!.length);
}
