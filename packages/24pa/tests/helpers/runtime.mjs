import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaRuntime } from '../../lib/runtime.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';
export { PaRuntime, DEFAULT_CONFIG, mkdir, writeFile, readFile, rm, join };
export const delay = ms => new Promise(r => setTimeout(r, ms));
export const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject }; };
export async function fixture(overrides = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pa24-runtime-'))), agents = new Map(), prompts = [];
  const nativeInputs = new Map(), storedSessions = new Map(); let continuation = 0;
  const acceptInput = (id, content, source) => { const message = { id, content, source }; nativeInputs.set(id, message); return id; };
  const persistence = { open: async (id, access) => {
    if (access !== 'read') throw new Error('fixture persistence is read-only');
    const stored = storedSessions.get(id); if (!stored) throw Object.assign(new Error('stored Session missing'), { name: 'SessionPersistenceNotFoundError' });
    return { header: structuredClone(stored.header), inheritedEventCount: 0,
      read: async () => ({ events: structuredClone(stored.events) }), close: async () => {} };
  } };
  const ctx = {
skills: null, get: name => name === 'sessionPersistence' ? persistence : null, fs: { resolve: async path => path, stat: async path => stat(path).catch(() => null), readText: path => readFile(path, 'utf8'), writeText: async (path, content) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content) } },
    workspaceRegistry: { list: () => [], create: async path => ({ id: path, path, title: '24私助' }) },
    sessionController: { create: async request => { if (!agents.has(request.sessionId)) agents.set(request.sessionId, { id: request.sessionId, status: 'idle', whenIdle: async () => { }, ctx: {}, session: { id: request.sessionId, header: { cwd: request.workspaceId, agentPreset: request.agentPreset }, ownEvents: () => [] } }); return { sessionId: request.sessionId }; }, rename: async () => { }, resolveAgent: async id => agents.has(id) ? { agent: agents.get(id) } : { error: new Error('missing agent') }, prompt: async request => { prompts.push(request); return { accepted: true } } },
    sessions: { get: id => agents.get(id)?.session, flush: async session => { storedSessions.set(session.id, { header: { ...structuredClone(session.header), id: session.id }, events: structuredClone(session.ownEvents()) }); return true; } }, subagents: { startActivation: async spec => { const events = []; agents.set(spec.childId, { id: spec.childId, status: 'idle', whenIdle: async () => { }, session: { id: spec.childId, header: { cwd: spec.request.parent.session.header.cwd, parentSession: { id: spec.request.parent.id } }, ownEvents: () => events } }); return { messageId: acceptInput('start-' + spec.childId, spec.request.prompt, { kind: 'user' }) }; }, sendMessage: async (parent, _id, content) => acceptInput('continue-' + continuation++, content, { kind: 'agent-message', senderSessionId: parent.id }), interrupt: () => { }, drainChildren: async (_parent, ids) => { for (const id of ids) await agents.get(id)?.whenIdle?.(); }, drainDescendants: async () => { } },
};
  const options = { stateDirectory: join(root, 'state'), workspacePath: '', env: {}, larkCliBin: 'missing', wecomCliBin: 'missing', cliTimeoutMs: 3000, reminderTickMs: 600000, dispatchTickMs: 600000, outboxTickMs: 600000, noteVerifyTickMs: 600000, reviewReminderTickMs: 600000, ...overrides };
  const runtimes = []; const make = () => { const rt = new PaRuntime(ctx, options); runtimes.push(rt); return rt; }; const rt = make();
  const workspace = async (name, patch = {}) => { const path = join(root, name); await mkdir(path, { recursive: true }); await writeFile(join(path, 'AGENTS.md'), '# 主人规则\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, ...patch }) + '\n```\n'); return path; };
  const cleanup = async () => { for (const runtime of runtimes) await runtime.stop(); await rm(root, { recursive: true, force: true }); };
  return { root, ctx, options, rt, make, agents, prompts, nativeInputs, storedSessions, acceptInput, workspace, cleanup };
}
