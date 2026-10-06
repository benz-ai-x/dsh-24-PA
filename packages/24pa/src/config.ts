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
  larkProfile: string;
  ownerOpenId: string;
  folderToken: string;
  tasklistId: string;
  calendarId: string;
  timeZone: string;
  appIdEnv: string;
  appSecretEnv: string;
  pgDsnEnv: string;
  maxWorkers: number;
  /** Role ids; runtime-registered roles are valid beyond the built-in set. */
  enabledWorkers: string[];
  workerModels: Partial<Record<string, WorkerModelRoute>>;
  /**
   * Provider-gated delegation tools the local session may also use. The preset
   * registers the tool rows, but they only mount after their provider bundles
   * are installed into the dsh profile, so opting in is a deployment decision
   * recorded here rather than a default capability.
   */
  extraLocalTools: string[];
}

/** Closed set: every extra tool the local role may be granted beyond the standard base. */
export const EXTRA_LOCAL_TOOLS = ['subagent_codex', 'subagent_claude_code'] as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const DEFAULT_CONFIG: PaConfig = {
  version: 1,
  mode: 'demo',
  larkProfile: 'default',
  ownerOpenId: '',
  folderToken: '',
  tasklistId: '',
  calendarId: 'primary',
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
  'pgDsnEnv',
] as const;

export function validateConfig(raw: unknown): PaConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('配置必须是 JSON 对象。');
  const input = raw as Record<string, unknown>;
  const unknown = Object.keys(input).filter(k => !(k in DEFAULT_CONFIG));
  if (unknown.length) throw new ConfigError(`未知配置字段：${unknown.join(', ')}。`);
  if (input.version !== 1) throw new ConfigError('配置 version 必须为 1。');
  if (input.mode !== 'demo' && input.mode !== 'feishu') throw new ConfigError('mode 必须是 demo 或 feishu。');
  for (const key of STRING_FIELDS) {
    if (typeof input[key] !== 'string') throw new ConfigError(`配置 ${key} 必须为字符串。`);
  }
  if (!input.larkProfile) throw new ConfigError('必须固定飞书 CLI profile（larkProfile）。');
  for (const key of ['appIdEnv', 'appSecretEnv', 'pgDsnEnv'] as const) {
    if (!ENV_NAME.test(input[key] as string)) throw new ConfigError(`${key} 应填写环境变量名称（大写字母、数字、下划线）。`);
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
    extraLocalTools.some(x => typeof x !== 'string' || !(EXTRA_LOCAL_TOOLS as readonly string[]).includes(x)) ||
    new Set(extraLocalTools).size !== extraLocalTools.length
  ) {
    throw new ConfigError(`extraLocalTools 只接受不重复的 ${EXTRA_LOCAL_TOOLS.join(', ')}。`);
  }
  const config: PaConfig = {
    version: 1,
    mode: input.mode,
    larkProfile: input.larkProfile as string,
    ownerOpenId: input.ownerOpenId as string,
    folderToken: input.folderToken as string,
    tasklistId: input.tasklistId as string,
    calendarId: input.calendarId as string,
    timeZone: input.timeZone as string,
    appIdEnv: input.appIdEnv as string,
    appSecretEnv: input.appSecretEnv as string,
    pgDsnEnv: input.pgDsnEnv as string,
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
