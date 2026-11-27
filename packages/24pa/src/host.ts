// Minimal structural types for the dsh host services this plugin consumes.
// Signatures follow dsh 0.2.3-alpha.2; the e2e suite boots the real Host through
// the official CLI, so drift fails loudly in tests instead of being papered
// over here.

import type { Readable, Writable } from 'node:stream';

export interface ContentBlock {
  type: string;
  text?: string;
  mediaType?: string;
  data?: string;
  [key: string]: unknown;
}

export interface SessionHeader {
  cwd?: string;
  parentSession?: { id: string } | string;
  delegationDepth?: number;
  agentPreset?: string;
  origin?: string;
  [key: string]: unknown;
}

export interface SessionEvent {
  type: string;
  time?: number;
  data: Record<string, any>;
}

export interface DshSession {
  id: string;
  header: SessionHeader;
  ownEvents(): SessionEvent[];
}

export interface DshAgent {
  id: string;
  session: DshSession;
  status: string;
  whenIdle?(): Promise<void>;
  ctx?: DshContext;
}

/** The host's agent registry, looked up by session id. */
export interface AgentRegistry {
  get?(id: string): DshAgent | undefined;
}

/** The host's `sessionTitle` service. Unlike the session controller it also
 *  names a subagent-owned session. */
export interface SessionTitleService {
  rename(session: DshSession, title: string): unknown;
}

/** Text in each shipped language, or one string for all of them; `en` is required. */
export type LocalizedText = string | { readonly en: string; readonly [locale: string]: string };

/** The states the host's MCP manager reports for a server: the MCP client's connection states, and the manager's own. */
export type McpServerState = 'closed' | 'waiting-credentials' | 'waiting-authorization' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'disabled';

/** One button of an account block on the host's Plugins page. */
export interface ConnectorAccountButton {
  label: LocalizedText;
  command: { readonly kind: 'start'; readonly operation: string } | { readonly kind: 'cancel' } | { readonly kind: 'open' };
  variant?: 'primary' | 'ghost';
}

/** What an account block on the host's Plugins page shows (#309). */
export interface ConnectorAccountDisplay {
  phase: 'checking' | 'connecting' | 'connected' | 'disconnected' | 'unavailable';
  status: LocalizedText;
  badge?: LocalizedText;
  buttons: readonly ConnectorAccountButton[];
  /** What the page's Connect prompt starts; absent, Connect only opens the page. */
  connect?: { readonly kind: 'start'; readonly operation: string };
  detail?: LocalizedText;
  notes: readonly { readonly text: LocalizedText; readonly button?: ConnectorAccountButton }[];
  failure?: { readonly text: LocalizedText; details?: readonly string[] };
}

/** The fixed text of an account block on the host's Plugins page. */
export interface ConnectorAccountCopy {
  title: LocalizedText;
  hint: LocalizedText;
  activation: { readonly title: LocalizedText; readonly body: LocalizedText; readonly connect: LocalizedText };
}

/** The operation a page button started, which browsers follow while it runs. */
export interface ConnectorOperation<Kind extends string> {
  readonly id: string;
  readonly kind: Kind;
  readonly phase: 'checking';
  readonly cancellable: boolean;
}

/** The most recent finished operation, kept until another one starts. */
export interface ConnectorOperationResult<Kind extends string> {
  readonly id: string;
  readonly kind: Kind;
  readonly outcome: 'succeeded' | 'cancelled' | 'failed';
}

/** The account, the operation in progress, and the last result, as a block's presenter reads them. */
export interface ConnectorAccountView<Account, Kind extends string> {
  readonly account: Account;
  readonly operation?: ConnectorOperation<Kind>;
  readonly result?: ConnectorOperationResult<Kind>;
}

/** One operation a page button may start, with the notice the page shows after it succeeds. */
export interface ConnectorAccountOperation<Kind extends string> {
  readonly kind: Kind;
  readonly notice?: LocalizedText;
}

/** The account a block exposes to the page. */
export interface ConnectorAccountSource<Account, Kind extends string> {
  snapshot(): ConnectorAccountView<Account, Kind>;
  /** Call `listener` after each change, without starting anything; returns a disposer. */
  observe(listener: () => void): () => void;
  /** Each new page subscriber calls this: start a check unless one runs; a source whose view is always current does nothing. */
  refresh(): void;
  start(kind: Kind): string | Promise<string>;
  cancel(id: string): Promise<void>;
}

/** One account of the host's Plugins page. */
export interface ConnectorAccountRegistration<Account, Kind extends string> {
  /** Stable key, unique among the page's accounts. */
  readonly key: string;
  /** The npm package whose bundle page carries the block; at most one account per package. */
  readonly packageName?: string;
  readonly source: ConnectorAccountSource<Account, Kind>;
  /** The operations a page button may start; the registry rejects any other. */
  readonly operations: readonly ConnectorAccountOperation<Kind>[];
  readonly copy: ConnectorAccountCopy;
  present(view: ConnectorAccountView<Account, Kind>): ConnectorAccountDisplay;
}

/** The host's Plugins page account registry, which the web application loads. */
export interface ConnectorAccountsService {
  /** Show the account for as long as the returned disposer has not run; throws when the key or the package is taken. */
  register<Account, Kind extends string>(registration: ConnectorAccountRegistration<Account, Kind>): () => void;
}

/** The host's subprocess service, where the host loads one. A child starts in its scrubbed environment and inside its managed process range. */
export interface SubprocessService {
  spawn(spec: {
    argv: readonly string[];
    cwd: string;
    stdio: { stdin: 'ignore' | 'pipe'; stdout: 'pipe'; stderr: 'pipe' };
    /** What the provider gets to end the process and whatever it started. */
    graceMs: number;
    /** Entries layered after the provider's scrub of the environment; undefined removes one. */
    env?: NodeJS.ProcessEnv;
  }): {
    readonly stdin: Writable | undefined;
    readonly stdout: Readable | undefined;
    readonly stderr: Readable | undefined;
    /** Exit facts; rejects when the process could not start. */
    readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
    /** Begin the provider's termination; idempotent. */
    terminate(): void;
    /** Resolves once nothing of the process range it manages is left to observe; false when the signal aborted first. */
    waitForExit(signal?: AbortSignal): Promise<boolean>;
  };
}

/** The profile this process runs, as the launcher provides it. */
export interface ProfileContextService {
  readonly name: string;
  /** The profile directory: packages installed into the profile resolve from its node_modules. */
  readonly dir: string;
}

export interface CreateSessionRequest {
  sessionId?: string;
  workspaceId?: string;
  cwd?: string;
  agentPreset?: string;
}

export interface PromptRequest {
  requestId: string;
  sessionId: string;
  mode: 'queue' | 'steer';
  content: ContentBlock[];
  clientTimeZone?: string;
}

export type AgentResolution = { agent: DshAgent } | { error: Error & { code?: string } };

export interface SubagentStartRequest {
  parent: DshAgent;
  prompt: ContentBlock[];
  maxDepth?: number;
  /** Per-child provider/model override; dsh merges it over the parent's options. */
  agentOptions?: { provider: string; model: string };
}

export interface ContinuableStartSpec extends SubagentStartRequest {
  provider: string;
  label: string;
  childId: string;
  signal: AbortSignal;
  /** 'parent' also notifies the Lead when the child completes. */
  delivery: 'parent' | 'caller';
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: { schema?: Record<string, unknown>; render?: (args: unknown, value: unknown) => unknown[] };
  execute: (args: any, exec: ToolRunContext) => Promise<unknown>;
  timeoutMs?: number;
}

export interface ToolRunContext {
  agent?: DshAgent;
  signal: AbortSignal;
  [key: string]: unknown;
}

export interface WorkspaceInfo {
  id: string;
  title: string;
  path: string;
}

/**
 * Host-native scheduling surface (moved from runtime in the round-3 review):
 * the contract digest-service consumes and the runtime adapts from the host
 * context — defined beside the other host interfaces so no module imports
 * runtime just for a type (the old circular seam).
 */
export interface NativeScheduleService {
  create(sessionId: string, request: Record<string, unknown>, signal?: AbortSignal): Promise<{ id: string; scheduledAt?: string } & Record<string, unknown>>;
  delete(request: { sessionId: string; id: string }): Promise<unknown>;
  catalog?(): Promise<Array<Record<string, unknown> & { id: string; sessionId: string; status: string; prompt: string }>>;
  update?(request: { sessionId: string; id: string; expected: Record<string, unknown>; change: Record<string, unknown>; title: string; prompt: string }): Promise<{ id: string; updated: boolean; record?: Record<string, unknown>; code?: string }>;
  history(request: { sessionId: string; id: string; limit: number; before?: string }): Promise<{ records?: unknown[] } & Record<string, unknown>>;
}

export interface FsTarget {
  path: string;
  [key: string]: unknown;
}

export interface FsWriteIntent {
  kind: string;
  version?: unknown;
}

export interface FsWritePolicy {
  mode: string;
  workspaceRoot?: string;
}

export interface SystemPromptSection {
  name: string;
  order: number;
  /** Static text, or a function re-evaluated at render time (e.g. reloadable workspace rules). */
  text: string | (() => string);
  /** Whether prompt variables are interpolated; false preserves literal text. */
  interpolate?: boolean;
}

export interface ConnectionFetchRoute {
  path: string;
  methods: readonly ('GET' | 'HEAD' | 'POST')[];
  requestBody: 'buffered' | 'streaming';
  fetch: (request: Request) => Promise<Response>;
}

export type Disposer = () => void | Promise<void>;

export interface DshContext {
  on(event: 'agent/pre-step', listener: (data: { agent: DshAgent; messages: import('./skill-run-host.js').RunInput[] },
    next: () => Promise<{ kind: 'reject' } | { kind: 'enter'; messages: import('./skill-run-host.js').RunInput[] }>) => Promise<{ kind: 'reject' } | { kind: 'enter'; messages: import('./skill-run-host.js').RunInput[] }>): () => void;
  on(event: 'session/event', listener: (session: DshSession, event: SessionEvent) => void): () => void;
  on(event: 'agent/created', listener: (data: { agent: DshAgent }) => void | Promise<void>): () => void;
  effect(factory: () => Disposer | void | Promise<void>): void;
  plugin(definition: any): { await(): Promise<void> } & Record<string, any>;
  reflect: { provide(name: string, value: unknown): void };
  sessionController: {
    create(request: CreateSessionRequest): Promise<{ sessionId: string }>;
    prompt(request: PromptRequest, signal?: AbortSignal): Promise<{ accepted: boolean } | { error: Error }>;
    resolveAgent(sessionId: string): Promise<AgentResolution>;
    rename(request: { sessionId: string; title: string }): Promise<unknown>;
    inspect(sessionId: string, signal?: AbortSignal): Promise<unknown>;
    state?(request: { sessionId: string }, signal: AbortSignal): Promise<{ running: boolean; queue: readonly { rpcId?: string }[] | null }>;
  };
  sessions: {
    flush(session: DshSession): Promise<boolean>;
    get?(id: string): DshSession | undefined;
  };
  subagents: {
    startActivation(spec: ContinuableStartSpec): Promise<unknown>;
    sendMessage(sender: DshAgent, targetId: string, content: ContentBlock[], options?: { signal?: AbortSignal }): Promise<unknown>;
    interrupt(targetSessionId: string, authority: { kind: 'user' }): void;
    rootOf(agent: DshAgent): DshAgent;
    drainDescendants(parents: readonly DshAgent[]): Promise<unknown>;
    /** Named-provider probe (F18): no result means the provider bundle is not installed. */
    getProvider?(name: string): unknown;
  };
  tools: {
    register(definition: ToolDefinition): () => void;
    restrict(filter: { allow?: string[]; deny?: string[] }): void;
    /** Public scoped guard and executor; required by WeChat and business Worker admission. */
    guard?(check: (exec: { agent?: DshAgent; name: string }) => string | undefined): () => void;
    setExecutor?(executor: { describe(tools: readonly ToolDefinition[]): unknown; execute(input: unknown): Promise<unknown> }): () => void;
    /** Host-plane (global) view of mounted tools, name-projected (present since 0.2.0-rc.2); profile-level MCP tools mount there (F18). */
    schemas?(scope?: unknown): Array<{ name: string; [key: string]: unknown }>;
  };
  systemPrompt: {
    section(section: SystemPromptSection): () => void;
  };
  fs: {
    resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>;
    stat(target: FsTarget): Promise<{ version?: unknown; [key: string]: unknown } | null>;
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, policy?: FsWritePolicy): Promise<unknown>;
  };
  workspaceRegistry: {
    create(path: string, title?: string): Promise<WorkspaceInfo>;
    list(): WorkspaceInfo[];
    get(id: string): WorkspaceInfo | undefined;
  };
  agentPresets?: {
    composedPreset(ctx: DshContext): string | undefined;
  };
  connection: {
    fetch: { register(route: ConnectionFetchRoute): Promise<void> | void };
  };
  /** Runs the callback once each named service is available, and again whenever one changes; its scope ends with this plugin. */
  inject(deps: readonly string[], callback: (scope: DshContext) => void): unknown;
  /** The host's Plugins page account registry; a host that loads no web application has none. */
  connectorAccounts?: ConnectorAccountsService;
  /** The host's MCP manager (the web profile loads one): says of each server how its connection stands. */
  mcpManager?: { list(): { name: string; status: { state: McpServerState } }[] };
  /** The host's subprocess service, which the plugin requires (#310): every CLI it runs starts through it. */
  subprocess: SubprocessService;
  get(service: string): any;
}
