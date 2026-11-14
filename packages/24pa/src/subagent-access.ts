import type { DshAgent, DshContext } from './host.js';

interface SubagentCatalogEntry { id: string }
interface SessionObservation extends Disposable {
  projections?: { values: { subagentCatalog?: SubagentCatalogEntry[] } };
}
interface SessionQuery {
  observeSession(id: string, options?: { signal?: AbortSignal }): Promise<SessionObservation>;
}

export async function directChild(host: DshContext, parentId: string, childId: string): Promise<boolean> {
  const query = host.get('sessionQuery') as SessionQuery | null | undefined;
  if (!query?.observeSession) throw new Error('宿主缺少持久子会话目录查询能力。');
  const observation = await query.observeSession(parentId);
  try {
    const catalog = observation.projections?.values.subagentCatalog;
    if (!catalog) throw new Error('宿主缺少原生子会话目录。');
    return catalog.some(entry => entry.id === childId);
  } finally {
    observation[Symbol.dispose]();
  }
}

export async function assertDirectChild(host: DshContext, parentId: string, childId: string): Promise<void> {
  if (!await directChild(host, parentId, childId)) throw new Error('原生父子会话关系不符，未执行该子会话操作。');
}

export function assertActiveSubagentTree(host: DshContext, agent: DshAgent): void {
  if (!host.subagents.rootOf) throw new Error('宿主缺少原生子任务运行树核验接口。');
  const root = host.subagents.rootOf(agent);
  const agents = host.get('agents') as { get?(id: string): DshAgent | undefined } | null | undefined;
  if (agents?.get?.(root.id) !== root) throw new Error('原生子任务运行树已失效。');
}

export async function assertSubagentAccess(host: DshContext, agent: DshAgent, parentId: string): Promise<void> {
  const parent = agent.session.header.parentSession;
  const actualParentId = typeof parent === 'string' ? parent : parent?.id;
  if (agent.session.header.origin !== 'subagent' || actualParentId !== parentId) throw new Error('原生子任务的持久父会话不符。');
  assertActiveSubagentTree(host, agent);
  await assertDirectChild(host, parentId, agent.id);
}
