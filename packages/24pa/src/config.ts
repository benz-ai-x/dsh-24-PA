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
}

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
};

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
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
  if (
    !Array.isArray(extraLocalTools) ||
    extraLocalTools.some(x => typeof x !== 'string' || !isExtraLocalToolEntry(x)) ||
    new Set(extraLocalTools).size !== extraLocalTools.length
  ) {
    throw new ConfigError(`extraLocalTools 只接受不重复的 ${DELEGATION_EXTRA_TOOLS.join('、')}、${QWENNOTE_TOOL_WILDCARD} 或 ${QWENNOTE_TOOL_PREFIX}<工具名>。`);
  }
  const config: PaConfig = {
    version: 1,
    mode: input.mode,
    storage,
    larkProfile: input.larkProfile as string,
    ownerOpenId: input.ownerOpenId as string,
    folderToken: input.folderToken as string,
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

export function parseAgentsMd(source: string): ParsedAgentsMd {
  const blocks = [...source.matchAll(JSON_BLOCK)];
  if (blocks.length !== 1) throw new ConfigError('AGENTS.md 必须包含唯一的一个 ```json 配置块。');
  const block = blocks[0]!;
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
