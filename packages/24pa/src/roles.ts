import type { PaRuntime } from './runtime.js';
import type { WorkItemRow } from './repo.js';

// Professional worker roles. Registration is declarative so later feature
// groups (calendar/tasks/reminders/handwriting) plug in without a new
// coordination runtime; unavailable roles are listed but refuse delegation.

export type WorkerActionHandler = (
  args: Record<string, unknown>,
  item: WorkItemRow,
  runtime: PaRuntime,
) => Promise<unknown>;

export interface WorkerRoleDefinition {
  id: string;
  name: string;
  persona: string;
  brief: string;
  /** Business actions this role can execute through pa24_work. */
  actions: Record<string, WorkerActionHandler>;
  /** Registered but not yet implemented features delegate with a clear refusal. */
  available: boolean;
  /** Extra tool names beyond pa24_work/pa24_memory for this role's children. */
  tools?: readonly string[];
}

export class RoleRegistry {
  private readonly roles = new Map<string, WorkerRoleDefinition>();

  register(definition: WorkerRoleDefinition): void {
    if (!definition || typeof definition !== 'object') throw new Error('角色定义无效。');
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(definition.id ?? '')) throw new Error('角色 id 必须是小写字母/数字/下划线（2–31 字符）。');
    if (typeof definition.name !== 'string' || !definition.name.trim()) throw new Error('角色名称不能为空。');
    if (typeof definition.persona !== 'string' || definition.persona.trim().length < 10) throw new Error('角色 persona 至少 10 字，说明职责与边界。');
    if (typeof definition.brief !== 'string') throw new Error('角色工作说明（brief）不能为空。');
    if (!definition.actions || typeof definition.actions !== 'object') throw new Error('角色必须声明可执行的业务动作。');
    // Re-registering the same id with a valid definition replaces it; the
    // previous registration survives any invalid attempt.
    this.roles.set(definition.id, definition);
  }

  has(id: string): boolean {
    return this.roles.has(id);
  }

  get(id: string): WorkerRoleDefinition | undefined {
    return this.roles.get(id);
  }

  list(): WorkerRoleDefinition[] {
    return [...this.roles.values()];
  }

  /** Registered and currently implementable roles for delegation. */
  available(): WorkerRoleDefinition[] {
    return this.list().filter(r => r.available);
  }
}

const unavailable = (id: string, name: string, feature: string): WorkerRoleDefinition => ({
  id,
  name,
  persona: `你是 24私助的${name} Worker。该职责已注册但业务能力尚未交付（${feature}）。收到委托时说明该能力尚未可用，不要臆造结果。`,
  brief: `该职责将在 ${feature} 交付；当前不可委派。`,
  actions: {},
  available: false,
});
