import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
let React, act, createRoot, win, root, container, binding, requests, poll, record, failed, delayed;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text);
const click = async text => { const node = button(text); expect(node).toBeTruthy(); await act(async () => node.click()); };
const input = label => [...container.querySelectorAll('label')].find(node => node.querySelector('span')?.textContent === label)?.querySelector('input,textarea,select');
const change = async (node, value) => { expect(node).toBeTruthy(); await act(async () => { const setter = Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype, 'value').set; setter.call(node, value); node.dispatchEvent(new win.Event('input', { bubbles: true })); }); };
const draft = () => ({ title: '项目纪要', transcript: '<script>window.ran = true</script>原文', summary: '摘要', pageOrder: [1], unknowns: [], candidates: [{ id: 'candidate-a', summary: '准备材料', sourceQuote: '明天准备材料' }] });
const counts = { awaiting_review: 53, returned: 3, needs_rereview: 2, verificationUnknown: 1 };
const success = value => ({ ok: true, json: async () => ({ ok: true, value: structuredClone(value) }) });
beforeEach(async () => {
  binding = 'workspace-a'; requests = []; failed = false; delayed = null; win.localStorage.clear();
  record = { note: { id: 'N-1', title: '项目纪要' }, material: { revision: 1, draft: draft(), recognition: draft(), source: { kind: 'handwriting', type: 'images' } }, pages: [{ pageNo: 1, status: 'saved' }], versions: [{ id: 'N-1:v1', version: 1, status: 'pending_review' }], selected: { id: 'N-1:v1', version: 1, status: 'pending_review', fingerprint: 'aaa', content: { ...draft(), derivedStatus: 'ready' }, doc_snapshot: '<p>冻结文档</p>', doc_url: 'https://example.test/document' }, decisions: [], actions: [], diff: { fields: ['transcript'], candidates: [], removed: [], reordered: false } };
  const interval = globalThis.setInterval; vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, delay, ...args) => { if (delay === 2500) poll = fn; return interval(fn, delay, ...args); });
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const req = JSON.parse(init.body); requests.push(req); const p = req.payload;
    if (req.endpoint === 'snapshot') return success({ workspace: { path: '/same-workspace-path', config: { ...DEFAULT_CONFIG, extraLocalTools: ['mcp__qwennote__*'] } }, workspaceBinding: binding, work: [], outbox: [], readiness: { items: [] } });
    if (req.endpoint === 'materials') {
      if (failed) return { ok: true, json: async () => ({ ok: false, error: { message: '本地账本暂不可读' } }) };
      if (p.kind === 'detail') return delayed || success({ ...record, workspaceBinding: binding });
      if (p.kind === 'original') return success({ workspaceBinding: binding, pageNo: 1, data: 'data:image/png;base64,aGVsbG8=' });
      return success({ workspaceBinding: binding, counts, total: 54, matched: 53, items: [{ id: 'N-1', title: '项目纪要', status: 'awaiting_review', materialType: 'images', latest: { version: 1 } }] });
    }
    if (req.endpoint === 'action' && p.type === 'material.change') {
      if (p.action === 'save_draft') { record.material.draft = p.draft; record.material.revision++; return success({ revision: record.material.revision, message: '已保存草稿；尚未发布' }); }
      if (p.action === 'adopt_actions') return success({ message: '仅提出参数变更建议', results: [{ reused: true, changeProposal: { proposed: { summary: '更新现有对象' } } }] });
      return success({ message: '已发布当前修订' });
    }
    if (req.endpoint === 'minutes') return success({ configured: true, mounted: true, lastRead: null, tools: [{ name: 'mcp__qwennote__read' }] });
    if (req.endpoint === 'notes.queue') return success({ count: 58, counts });
    if (req.endpoint === 'health') return success({ capabilities: [{ id: 'extra-local-tools', state: 'ok', message: '通用扩展可用' }, { id: 'qwennote-channel', state: 'info', message: '工具已挂载，尚未验证读取' }] });
    if (req.endpoint === 'memory') return success({ items: [], total: 0, matched: 0 });
    return success({});
  }));
  let mod, Panel; win.__ModuleLoader__ = { load: value => { mod = value; } }; new Function('window','document','navigator',source)(win,win.document,win.navigator);
  mod.factory(() => React).apply({ effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' }, slots: { inject: (_name,fn) => fn(), register: (spec,view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container); await act(async () => root.render(React.createElement(Panel)));
  const category = container.querySelector('#pa24-tab-knowledge'); await act(async () => category.click());
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：手写审核')); await act(async () => card.click());
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });

it.each(['light','dark'])('%s 390px：只读对照、完整计数、原稿按页取回和纯文本展示', async theme => {
  win.document.documentElement.dataset.theme = theme; win.happyDOM.setWindowSize({ width: 390, height: 844 });
  expect(container.textContent).toContain('53 条匹配 / 54 份资料'); await click('项目纪要');
  expect(container.querySelector('script')).toBeNull(); expect(win.ran).toBeUndefined();
  await click('原稿与来源'); await click('第 1 页'); expect(container.querySelector('img').alt).toBe('已核验原稿第 1 页');
  await click('冻结版本'); expect(button('重发审核入口')).toBeTruthy(); expect(button('批准')).toBeUndefined();
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
});

it('保存与发布分开；确认预览后才写外部，未保存编辑跨详情保留', async () => {
  await click('项目纪要'); await change(input('整理正文'), '主人手工修订'); expect(button('保存草稿').disabled).toBe(false);
  await click('识别结果'); await click('编辑草稿'); expect(input('整理正文').value).toBe('主人手工修订');
  await click('保存草稿'); expect(requests.filter(r => r.endpoint === 'action').map(r => r.payload.action)).toEqual(['save_draft']);
  await click('预览发布'); expect(button('确认发布').disabled).toBe(true);
  await act(async () => input('已核对正文、原稿顺序与候选参数').click()); await click('确认发布');
  expect(requests.filter(r => r.endpoint === 'action').map(r => r.payload.action)).toEqual(['save_draft','publish_draft']);
  expect(requests.at(-1).payload.workspaceBinding).toBe(binding);
});

it('列表读取失败保留上次结果并标注，重试恢复；不假装空列表', async () => {
  failed = true; await click('刷新资料'); expect(container.textContent).toContain('当前显示上次读取的内容'); expect(button('项目纪要')).toBeTruthy();
  failed = false; await click('重试读取'); expect(container.querySelector('[role=alert]')).toBeNull();
});

it('工作区绑定变化后忽略旧详情，旧人工草稿不进入新工作区', async () => {
  await click('项目纪要'); await change(input('整理正文'), 'A 工作区未保存文字');
  let finish; delayed = new Promise(resolve => { finish = resolve; }); await click('刷新资料');
  binding = 'workspace-b'; await act(async () => { await poll(); });
  await act(async () => finish(success({ ...record, workspaceBinding: 'workspace-a', note: { ...record.note, title: '迟到旧详情' } })));
  expect(container.textContent).not.toContain('迟到旧详情'); expect(container.textContent).not.toContain('A 工作区未保存文字');
  expect(requests.some(req => req.endpoint === 'materials' && req.payload.workspaceBinding === 'workspace-b')).toBe(true);
});

it('已审核候选单独授权，复用对象的变更建议显示完整回执', async () => {
  record.selected.status = 'approved'; record.versions[0].status = 'approved'; await click('项目纪要'); await click('候选行动');
  await act(async () => input('准备材料').click()); expect(button('授权执行所选行动').disabled).toBe(true);
  await change(input('本次明确授权'), '按当前最终参数执行'); await click('授权执行所选行动');
  expect(container.textContent).toContain('更新现有对象'); expect(requests.find(r => r.payload.action === 'adopt_actions').payload).toMatchObject({ candidateIds: ['candidate-a'], versionId: 'N-1:v1' });
});

it('听记挂载与可读分开；刷新只读取本地证据，不发 MCP 请求', async () => {
  await click('返回卡片');
  const category = container.querySelector('#pa24-tab-setup'); await act(async () => category.click());
  const card = [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：QwenNote 听记')); await act(async () => card.click());
  expect(container.textContent).toContain('已挂载（不等于可读）'); expect(container.textContent).toContain('尚无本工作区当前配置的实际读取回执');
  await click('刷新接入记录'); expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
});


it('资料页签方向键与 Home/End 同步焦点、选中和关联面板，不触发业务写入', async () => {
  await click('项目纪要');
  const tabs = [...container.querySelector('[role=tablist][aria-label="资料对照视图"]').querySelectorAll('[role=tab]')];
  tabs[2].focus();
  for (const [key, next] of [['ArrowRight',3],['End',4],['ArrowRight',0],['ArrowLeft',4],['Home',0]]) {
    await act(async () => win.document.activeElement.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true })));
    expect(win.document.activeElement).toBe(tabs[next]); expect(tabs.filter(tab => tab.tabIndex === 0)).toEqual([tabs[next]]);
    expect(tabs[next].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('#' + tabs[next].getAttribute('aria-controls')).getAttribute('aria-labelledby')).toBe(tabs[next].id);
  }
  expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
});

it('候选与回执默认显示业务信息，完整 JSON 仅在折叠详情内', async () => {
  record.selected.status = 'approved'; record.versions[0].status = 'approved';
  record.selected.content.candidates[0].due = '2026-11-01';
  await click('项目纪要'); await click('候选行动');
  expect(container.querySelector('dl').textContent).toContain('2026-11-01');
  await act(async () => input('准备材料').click()); await change(input('本次明确授权'), '执行选中的行动'); await click('授权执行所选行动');
  expect(container.querySelector('[aria-label="资料操作结果"] h5').textContent).toContain('建议参数');
  for (const pre of container.querySelectorAll('pre')) {
    if (pre.textContent.trim().startsWith('{')) { expect(pre.closest('details')).not.toBeNull(); expect(pre.closest('details').open).toBe(false); }
  }
});

it('发布预览展示正文、页序、疑点及候选参数的前后值', async () => {
  record.diff = { fields: ['transcript','pageOrder','doubts'], fieldChanges: [
    { field: 'transcript', before: '旧正文', after: '新正文' },
    { field: 'pageOrder', before: [1,2], after: [2,1] },
    { field: 'doubts', before: [{ pageNo: 1, quote: '旧疑点' }], after: [{ pageNo: 2, quote: '新疑点' }] },
  ], candidates: [{ id: 'candidate-a', summary: '准备材料', change: 'changed', before: { summary: '准备材料', due: '2026-11-01' }, after: { summary: '准备材料', due: '2026-11-03' } }], removed: [], reordered: false };
  await click('项目纪要'); await click('预览发布');
  const diff = container.querySelector('[aria-label="发布差异"]');
  for (const text of ['旧正文','新正文','旧疑点','新疑点','2026-11-01','2026-11-03','发布前参数','发布后参数']) expect(diff.textContent).toContain(text);
  expect(button('确认发布').disabled).toBe(true); expect(requests.filter(req => req.endpoint === 'action')).toHaveLength(0);
});
