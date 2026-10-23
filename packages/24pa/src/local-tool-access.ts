import { DELEGATION_TOOL_PROVIDER, QWENNOTE_TOOL_PREFIX, QWENNOTE_TOOL_WILDCARD } from './config.js';
import type { DshContext } from './host.js';

// The local session carries the full standard-mode tool base beside the pa24
// tools (user-confirmed 2026-10-07). Terminal, generic delegation (subagent/
// workflow/ralph) stay local-only: the feishu entry session and workers keep
// their business whitelists, so one preset never implies one permission set
// (ADR-0001).
//
// restrict() refuses allow names that are not live tools on the agent's scope
// chain, so this list may only name capabilities the preset always registers:
// exactly one platform shell, and never the provider-gated delegation tools —
// those mount only after their provider bundles are installed into the
// profile, so they are opt-in through the workspace config instead.
const STANDARD_CODING_TOOLS = [
  'read', 'write', 'edit', 'read_image', 'glob', 'grep',
  process.platform === 'win32' ? 'pwsh' : 'bash',
  'job_kill', 'job_list', 'job_output',
  'skill',
  'create_goal', 'get_goal', 'update_goal',
  'exit_plan_mode',
  'ask_user_question',
  'todo_write',
  'web_fetch', 'web_search',
  'present',
  'subagent', 'subagent_fork',
  'interrupt_agent', 'send_message', 'list_agents',
  'workflow',
  'ralph',
];

const ROLE_TOOLS: Record<string, string[]> = {
  // pa24_connection on the feishu entry is the read-only access wizard
  // (guide/check/wecom_guide/wecom_check): diagnostics over the chat the owner
  // already uses. Config writes stay local-only (ADR-0001) via pa24_workspace.
  'feishu-access': ['pa24_delegate', 'pa24_jobs', 'pa24_notes', 'pa24_memory', 'pa24_maintenance', 'pa24_connection'],
  'local-robot': [
    'pa24_delegate', 'pa24_jobs', 'pa24_notes', 'pa24_memory', 'pa24_maintenance', 'pa24_workspace', 'pa24_connection',
    ...STANDARD_CODING_TOOLS,
  ],
  worker: ['pa24_work', 'pa24_memory'],
};

/** Native local Skill subtasks get only explicitly declared standard coding
 * tools. This does not grant any pa24 maintenance or business role. */
export const skillDelegationTools = (declared: readonly string[]): string[] => declared.filter(name => STANDARD_CODING_TOOLS.includes(name));

/** Live-mount signals one agent creation sees; both are cheap host-plane probes. */
export interface ExtraToolSignals {
  /** Names in the host-plane (global) tool view — where profile-level MCP tools mount. */
  globalToolNames: ReadonlySet<string>;
  /** Whether a ctx.subagents provider currently resolves under this name. */
  providerAvailable(name: string): boolean;
}

/** QwenNote channel diagnostics (F18 WP3): three observable signals compose
 *  the three states — the dsh-mcp-client plugin exposes no status service
 *  (verified in its source), so presence is inferred: workspace config asks
 *  for qwennote tools, the host tool plane either mounted the mcp__qwennote__
 *  prefix or rolled it back (token failure breaks the whole tool generation),
 *  and mcp-remote's token cache directory records that authorization ever
 *  succeeded. No tool is ever called for diagnosis. */
export interface QwennoteChannelSignals {
  configured: boolean;
  mounted: boolean;
  tokenCache: { exists: boolean; updatedAt: Date | null };
}

export function qwennoteChannelState(signals: QwennoteChannelSignals): { state: 'info' | 'warn' | 'error'; message: string; nextSteps: string[] } {
  if (signals.configured && signals.mounted) {
    return { state: 'info', message: '听记工具已挂载；授权与实际资料读取仍以本次调用回执为准，尚不能据此证明资料可读。', nextSteps: ['在本地24私助对话按需查询或读取所选听记；面板保留最近一次实际调用状态。'] };
  }
  if (!signals.configured) {
    return { state: 'warn', message: '未配置：AGENTS.md 的 extraLocalTools 未包含 mcp__qwennote__ 条目。', nextSteps: ['在 AGENTS.md 的 extraLocalTools 中加入 "mcp__qwennote__*"，并确认 profile 配置了 dsh-mcp-client 条目（见初始化指南「听记接入」）。'] };
  }
  if (!signals.tokenCache.exists) {
    return { state: 'error', message: '工具未挂载，未发现授权缓存；授权状态尚未核实。', nextSteps: ['由本人浏览器核对授权（初始化指南「听记接入」节：重启宿主触发 mcp-remote 发起，授权链接约 5 分钟轮换，需重新触发取新链接）。'] };
  }
  return {
    state: 'warn',
    message: `连接失败或 token 过期：曾授权过（缓存 ${signals.tokenCache.updatedAt?.toISOString() ?? '时间未知'}）但当前工具未挂载。`,
    nextSteps: ['重启宿主让 mcp-remote 重连；仍失败则按「听记接入」节重新授权（旧缓存会被新授权覆盖）。'],
  };
}

/** Host-plane tool names; any probe failure degrades to an empty view. */
export function hostGlobalToolNames(ctx: DshContext): string[] {
  try {
    return (ctx.tools.schemas?.() ?? []).map(schema => schema.name);
  } catch {
    return [];
  }
}

/**
 * Resolve configured extraLocalTools entries against live mounts before they
 * join the restrict() allow list (F18): restrict() rejects names that are not
 * live on the agent's scope chain, so a configured-but-unmounted channel — a
 * delegation tool without its provider bundle, or an mcp__qwennote__ entry
 * without the profile's dsh-mcp-client row — must be dropped here, visibly
 * (`filtered`) rather than fatally. The wildcard entry expands to every
 * mounted qwennote tool; output preserves request order, deduplicated.
 */
export function resolveExtraLocalTools(extras: readonly string[], signals: ExtraToolSignals): { allow: string[]; filtered: string[] } {
  const allow: string[] = [];
  const filtered: string[] = [];
  const seen = new Set<string>();
  const admit = (name: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      allow.push(name);
    }
  };
  for (const extra of extras) {
    const provider = DELEGATION_TOOL_PROVIDER[extra as keyof typeof DELEGATION_TOOL_PROVIDER];
    if (provider !== undefined) {
      if (signals.providerAvailable(provider)) admit(extra);
      else filtered.push(extra);
      continue;
    }
    if (extra === QWENNOTE_TOOL_WILDCARD) {
      const mounted = [...signals.globalToolNames].filter(name => name.startsWith(QWENNOTE_TOOL_PREFIX)).sort();
      if (mounted.length === 0) filtered.push(extra);
      else mounted.forEach(admit);
      continue;
    }
    // A precise mcp__qwennote__<tool> entry: live iff mounted on the host
    // plane. validateConfig gates entries to this prefix; the prefix guard
    // here keeps the resolver honest if it is ever reused ungated.
    if (extra.startsWith(QWENNOTE_TOOL_PREFIX) && signals.globalToolNames.has(extra)) admit(extra);
    else filtered.push(extra);
  }
  return { allow, filtered };
}

/** One lifecycle owns delayed mounts, cancellation, filtering, and restriction. */
export class LocalToolAccess {
  private readonly lifetime = new AbortController();
  constructor(private readonly deps: {
    globalToolNames(): string[];
    providerAvailable(name: string): boolean;
    record(resolution: { requested: string[]; active: string[]; filtered: string[] }): void;
    waitMs?: number;
    pollMs?: number;
  }) {}

  dispose(): void { this.lifetime.abort(); }

  async attach(role: string | null, configured: readonly string[], restrict: (allow: string[], signal: AbortSignal) => Promise<void>): Promise<void> {
    const signal = this.lifetime.signal;
    const extras = role === 'local-robot' ? [...configured] : [];
    const wantsQwennote = extras.some(name => name.startsWith(QWENNOTE_TOOL_PREFIX));
    const deadline = Date.now() + (this.deps.waitMs ?? 60_000);
    while (wantsQwennote && !signal.aborted && !this.deps.globalToolNames().some(name => name.startsWith(QWENNOTE_TOOL_PREFIX)) && Date.now() < deadline) {
      await this.wait(Math.min(this.deps.pollMs ?? 2_000, deadline - Date.now()));
    }
    if (signal.aborted) return;
    const resolved = resolveExtraLocalTools(extras, {
      globalToolNames: new Set(this.deps.globalToolNames()),
      providerAvailable: name => this.deps.providerAvailable(name),
    });
    await restrict([...(role ? ROLE_TOOLS[role] ?? [] : []), ...resolved.allow], signal);
    if (!signal.aborted && extras.length) this.deps.record({ requested: extras, active: resolved.allow, filtered: resolved.filtered });
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      const signal = this.lifetime.signal;
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, ms);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
    });
  }
}
