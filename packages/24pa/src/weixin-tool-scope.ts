import type { DshAgent, DshContext, ToolDefinition } from './host.js';

export interface WeixinToolPolicy { allow: readonly string[]; active: boolean }
interface NativeExecutor {
  describe(tools: readonly ToolDefinition[]): unknown;
  execute(input: unknown): Promise<unknown>;
}

/** Host restrict() exempts registrations on the Agent itself. Keep the
 * model catalog and the final execution guard on the same business policy. */
export async function mountWeixinToolScope(host: DshContext, agent: DshAgent,
  policy: (agent: DshAgent | undefined) => WeixinToolPolicy | null): Promise<void> {
  const loader = host.get('loader') as { import(name: string, base: string, options: object): Promise<{ NativeToolExecutor: new (ctx: DshContext) => NativeExecutor }> } | null;
  if (!agent.ctx || !loader?.import) throw new Error('微信会话缺少宿主工具装配接口。');
  const { NativeToolExecutor } = await loader.import('@deepseek-ai/dsh-tool-executor-native', import.meta.url, {});
  if (typeof NativeToolExecutor !== 'function') throw new Error('微信会话需要宿主的原生工具执行器。');
  await agent.ctx.plugin({ name: 'pa24-weixin-tool-scope', inject: ['tools'], apply(scope: DshContext) {
    if (!scope.tools.guard || !scope.tools.setExecutor) throw new Error('微信会话需要宿主的工具执行门禁，未开放业务入口。');
    const native = new NativeToolExecutor(scope);
    scope.tools.guard(exec => {
      const current = policy(exec.agent);
      return current?.active && current.allow.includes(exec.name) ? undefined : '该工具不在当前微信业务授权范围内。';
    });
    scope.tools.setExecutor({
      describe(tools: readonly ToolDefinition[]) {
        const current = policy(agent);
        return native.describe(tools.filter(tool => current?.active && current.allow.includes(tool.name)));
      },
      execute: (input: unknown) => native.execute(input),
    });
  } }).await();
}
