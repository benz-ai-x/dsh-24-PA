// Minimal structural types for the dsh host services this plugin consumes.
// Signatures follow dsh 0.2.1-alpha.1 (deepseek-harness 5badb150); the e2e
// suite boots the real Host through the official CLI, so drift fails loudly
// in tests instead of being papered over here.

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
  parentAgent?: DshAgent;
  ctx?: DshContext;
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
  persona?: string;
  toolFilter?: { allow?: string[]; deny?: string[] };
  maxDepth?: number;
  /** Per-child provider/model override; dsh merges it over the parent's options. */
  agentOptions?: { provider: string; model: string };
}

export interface ContinuableStartSpec {
  provider: string;
  label?: string;
  childId: string;
  signal?: AbortSignal;
  /** dsh 0.2.1-alpha.2 requires an explicit delivery; 'parent' keeps the
   *  continuable semantics (the child's completion notifies the Lead). */
  delivery: 'parent' | 'caller';
  request: SubagentStartRequest;
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
  interpolate?: (data: unknown) => string;
}

export interface ConnectionFetchRoute {
  path: string;
  methods: readonly ('GET' | 'HEAD' | 'POST')[];
  requestBody: 'buffered' | 'streaming';
  fetch: (request: Request) => Promise<Response>;
}

export type Disposer = () => void | Promise<void>;

export interface DshContext {
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
  };
  sessions: {
    flush(session: DshSession): Promise<boolean>;
  };
  subagents: {
    /** dsh 0.2.1-alpha.2+; the runtime probes and falls back to the legacy name below. */
    startActivation?(spec: ContinuableStartSpec): Promise<unknown>;
    /** dsh ≤ 0.2.1-alpha.1 legacy name. */
    startContinuable?(spec: Omit<ContinuableStartSpec, 'delivery'>): Promise<unknown>;
    sendMessage(sender: DshAgent, targetId: string, content: ContentBlock[], options?: { signal?: AbortSignal }): Promise<unknown>;
    interrupt(targetSessionId: string, authority: { kind: string; parentSessionId?: string }): void;
    /** dsh 0.2.1-alpha.2+; legacy drainContinuableDescendants below. */
    drainDescendants?(parents: readonly DshAgent[]): Promise<unknown>;
    drainContinuableDescendants?(parents: readonly DshAgent[]): Promise<unknown>;
    listChildren(parentSessionId: string, signal?: AbortSignal): Promise<unknown>;
  };
  tools: {
    register(definition: ToolDefinition): () => void;
    restrict(filter: { allow?: string[]; deny?: string[] }): void;
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
  get(service: string): any;
}
