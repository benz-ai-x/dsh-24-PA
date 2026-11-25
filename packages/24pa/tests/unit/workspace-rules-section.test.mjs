import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { apply } from '../../lib/tools.js';
import { installToolRuntime, mountAgentScope } from '../helpers/tool-runtime.mjs';

const contexts = [];
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); });

async function fixture(rules) {
  const ctx = new Context(); contexts.push(ctx); await installToolRuntime(ctx);
  const runtime = { skillRuns: { codingTools: async () => null }, businessToolPolicy: () => null, roleForToolMount: () => null,
    configFor: () => ({}), noteExtraToolResolution: () => {}, providerAvailable: () => false, workspaceRulesSection: () => rules };
  // The production agent plugin beside the real Host prompt registry and scope chain.
  apply({ ...ctx, get: () => runtime, effect: fn => ctx.effect(fn), tools: ctx.tools, systemPrompt: ctx.systemPrompt, on: () => {} });
  const agent = await mountAgentScope(ctx, { id: 'lead', session: { id: 'lead', header: { cwd: '/fixture', agentPreset: 'pa24' }, ownEvents: () => [] } });
  return async () => {
    const assembled = await ctx.systemPrompt.assemble({ scope: agent, signal: new AbortController().signal });
    // The Host's own renderer resolves {{variable}} references for a model request.
    return renderPrompt(assembled);
  };
}

describe('工作区自定义规则分节', () => {
  it('规则里的花括号占位符按字面进入系统提示，不被当作提示变量', async () => {
    // {{model}} names a real prompt variable; the spaced form is a malformed reference.
    const rules = '## 24私助：工作区自定义规则\n\n模板里写 {{model}} 或 {{ owner }} 时一律原样保留，不要替换。';
    const rendered = await (await fixture(rules))();
    expect(rendered).toContain(rules);
    expect(rendered).toContain('## 24私助：身份与能力分工');
  });
  it('未绑定工作区时渲染结果不含规则分节', async () => {
    const rendered = await (await fixture(''))();
    expect(rendered).not.toContain('## 24私助：工作区自定义规则');
    expect(rendered).toContain('## 24私助：身份与能力分工');
  });
});
