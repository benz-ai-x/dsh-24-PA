import { nativeTiming } from './plan-time.js';
import type { NativeScheduleService } from './host.js';

type AnySchedule = Record<string, any>;

/** 宿主 Schedule 方言桥：0.2.2 把请求改为 create(request{timing,target})/
 * edit(action+patch)／删除并入 edit，条目归属挪进 target.sessionId；0.2.1
 * 及更早是键控 create(sessionId,request)/update/delete。按能力探测方言，
 * 对内统一呈现 0.2.1 面（sessionId 参数与条目字段），旧宿主直通。 */
export function bridgeScheduleService(service: AnySchedule): NativeScheduleService {
  const modern = typeof service.edit === 'function';
  const entry = (row: AnySchedule) => row && row.sessionId === undefined && row.target?.sessionId !== undefined
    ? { ...row, sessionId: row.target.sessionId } : row;
  if (!modern) return service as unknown as NativeScheduleService;
  return {
    create: async (sessionId: string, request: Record<string, unknown>) => entry(await service.create({
      title: request.title, prompt: request.prompt, timing: nativeTiming(request), target: { kind: 'session', sessionId },
    })) as { id: string; scheduledAt?: string } & Record<string, unknown>,
    delete: async (request: { sessionId: string; id: string }) => service.edit({ id: request.id, action: 'delete' }),
    history: async (request: Parameters<NativeScheduleService['history']>[0]) => service.history(request),
    update: service.edit ? async (request: Parameters<NonNullable<NativeScheduleService['update']>>[0]) => {
      const result = await service.edit({
        id: request.id, action: 'update',
        patch: { title: request.title, prompt: request.prompt, timing: nativeTiming(request.change) },
        expectedUpdatedAt: request.expected?.updatedAt ?? null,
      });
      return { id: request.id, updated: result?.id !== undefined, record: result?.id !== undefined ? entry(result) : undefined,
        code: result?.id !== undefined ? undefined : 'schedule_conflict' };
    } : undefined,
    ...(service.catalog ? { catalog: async () => (await service.catalog()).map((row: AnySchedule) => entry(row)) } : {}),
  };
}
