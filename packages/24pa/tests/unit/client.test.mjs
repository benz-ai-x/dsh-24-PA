import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// F17 锚点守卫：浏览器半无 DOM 测试环境，这里只做「注册面必须存在」的
// copy guard（与 prompts.test.mjs 的锚点思路一致）；交互验收走 T20 真机。
const client = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../client.js'), 'utf8');

describe('client.js 挂载面（F17）', () => {
  it('语法可解析', () => {
    expect(() => new Function(client)).not.toThrow();
  });

  it('三个插槽注册齐全：主面板、侧栏图标、设置分区', () => {
    expect(client).toContain("ctx.slots.inject('main'");
    expect(client).toContain("ctx.slots.register({ name: 'main', key: 'pa24' }");
    expect(client).toContain("ctx.slots.inject('sidebar.panellist'");
    expect(client).toContain("ctx.slots.inject('settings.section'");
    expect(client).toMatch(/slots\.register\(\{ name: 'settings\.section', id: 'pa24', order: 25, label: \(\) => t\('settings'\) \}/);
  });

  it('设置分区复用 WorkspaceCards 且不新增 RPC 端点', () => {
    expect(client).toContain('function WorkspaceCards({ snapshot, busy, button, openRobot })');
    // 面板 workspace tab 与设置分区都挂同一组件
    expect(client.match(/h\(WorkspaceCards,/g)?.length).toBe(2);
    // F17 不允许出现本插件面板 RPC 之外的新 endpoint 字符串
    const endpoints = [...client.matchAll(/rpc\('([a-z.]+)'/g)].map(m => m[1]);
    expect(new Set(endpoints)).toEqual(new Set(['snapshot', 'action', 'memory', 'notes.queue', 'health']));
  });

  it('设置分区跳转面板走 layout 服务并保留关闭兜底', () => {
    expect(client).toContain("'layout'");
    expect(client).toContain("ctx.layout.selectPanel('pa24')");
    expect(client).toContain('close()');
  });
});
