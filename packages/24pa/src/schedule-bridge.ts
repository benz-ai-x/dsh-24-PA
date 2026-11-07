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
  // These plans act for their owning access session. Pass that native actor
  // so management does not inject a schedule-change notice back into itself.
  return {
    create: async (sessionId: string, request: Record<string, unknown>) => entry(await service.create({
      title: request.title, prompt: request.prompt, timing: nativeTiming(request), target: { kind: 'session', sessionId },
    }, sessionId)) as { id: string; scheduledAt?: string } & Record<string, unknown>,
    delete: async (request: { sessionId: string; id: string }) => service.edit({ id: request.id, action: 'delete' }, request.sessionId),
    history: async (request: Parameters<NativeScheduleService['history']>[0]) => service.history(request),
    update: async (request: Parameters<NonNullable<NativeScheduleService['update']>>[0]) => {
      // change 已是 planTimingChange（＝nativeTiming）产出的判别联合；
      // nativeTiming 对该形状幂等（planTimingRequest 只认 selector 键）。
      const result = await service.edit({
        id: request.id, action: 'update',
        patch: { title: request.title, prompt: request.prompt, timing: nativeTiming(request.change) },
        expectedUpdatedAt: request.expected?.updatedAt ?? null,
      }, request.sessionId);
      // 0.2.2 的 edit 不抛冲突：未命中/冲突都以 {id, code} 返回，成功条目
      // 无 code 但必有 kind——按 code 判别，不能按 id（每个变体都有 id）。
      const missed = result?.code !== undefined;
      return { id: request.id, updated: !missed, record: missed ? undefined : entry(result),
        code: missed ? result.code : undefined };
    },
    ...(service.catalog ? { catalog: async () => (await service.catalog()).map((row: AnySchedule) => entry(row)) } : {}),
  };
}
