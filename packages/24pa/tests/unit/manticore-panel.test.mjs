import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { taskPlanDraft } from '../../lib/task-plan.js';
let React, act, createRoot, win, root, container, binding, requests, plan, run, fault, delayed, savedBlob, intervals, work, emptyHistory;
const source = await readFile(new URL('../../client.js', import.meta.url), 'utf8');
const form = () => ({ title: '项目晨报', skillId: 'builtin:digest-morning', parameters: { title: '项目晨报正文' }, timeZone: 'Asia/Shanghai', timing: { type: 'daily', time: '09:00:00' }, executionLimitMs: 900000, selectors: {}, delivery: { channel: 'none', mode: 'always', voice: false, overrideQuiet: false } });
const auth = () => ({ skill: { name: 'digest-morning', versionId: 'builtin-v1', tools: [], resources: [] }, targets: [], delivery: null });
beforeAll(async () => {
  win = new Window({ url: 'http://localhost/' });
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) vi.stubGlobal(key, key === 'window' ? win : win[key]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); React = await import('react'); ({ act } = React); ({ createRoot } = await import('react-dom/client'));
});
const button = text => [...container.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text || node.getAttribute('aria-label')?.startsWith(text + '：'));
const managerButton = text => [...container.querySelectorAll('.pa24-manager button')].find(node => node.textContent === text);
const field = label => [...container.querySelectorAll('label')].find(node => [...node.childNodes].some(child => child.nodeType === 3 && child.textContent === label))?.querySelector('input,select,textarea');
const click = async node => { expect(node).toBeTruthy(); await act(async () => node.click()); };
const change = async (node, value) => { expect(node).toBeTruthy(); await act(async () => {
  if (node.tagName === 'SELECT') { node.value = value; node.dispatchEvent(new win.Event('change', { bubbles: true })); }
  else { Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new win.Event('input', { bubbles: true })); }
}); };
const open = title => click([...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label')?.endsWith('：' + title)));
beforeEach(async () => {
  binding = 'binding-a'; requests = []; fault = null; delayed = null; savedBlob = null; intervals = []; emptyHistory = false; win.localStorage.clear();
  const draft = taskPlanDraft(form(), 'Asia/Shanghai');
  plan = { id: 'plan-a', kind: 'daily', title: '项目晨报', revision: 1, skill: 'digest-morning', status: 'paused', owner_enabled: false, task_config: draft.configuration, task_authorization: auth(), schedule_spec: draft.scheduleSpec, schedule_id: null, recycled_at: null, blocks: [], nextTimes: draft.nextTimes };
  work = { id: 'work-a', title: '原交办目标', instruction: '原请求', status: 'completed', origin: 'local', delivery: 'local', result: '原交付物', progress_detail: { stage: '等待主人确认', completed: '原资料已核对', next: '交付结果和出处' }, revision: 1, execution_mode: 'worker', acceptance_required: true, acceptance_status: 'pending', completion_criteria: '核对交付物' };
  run = { run: { id: 'run-a', status: 'completed', delivery_status: 'partial', progress: '结果已保存', result: '完整结果', mode: 'template', work_item_id: 'work-a', skill_id: 'builtin:digest-morning', version_id: 'v1', created_at: new Date().toISOString() },
    calls: [], inputs: [], native: [], reviews: [], unresolvedOperations: [], attempts: [], execution: { executionMs: 500, remainingMs: 899500, queuedMs: 10, waitingMs: 0, blocks: [] },
    deliveries: [{ id: 'notice', deliveryStatus: 'partial', deliveries: [{ outbox_id: 12, fingerprint: 'delivery-fingerprint', component: 'audio', outbox: { status: 'failed', channel: 'feishu', target: 'owner', attempts: 1, last_error: '语音合成失败' } }] }] };
  vi.spyOn(globalThis, 'setInterval').mockImplementation((fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }); vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { savedBlob = blob; return 'blob:export'; }); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); vi.spyOn(win.HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request); const p = request.payload, endpoint = request.endpoint;
    try {
      if (fault === endpoint) throw new Error('离线读取失败'); if (delayed?.endpoint === endpoint) return await delayed.promise;
      let value;
      if (endpoint === 'snapshot') value = { workspace: { path: '/workspace', config: DEFAULT_CONFIG }, work: [], outbox: [], readiness: { items: [] } };
      else if (endpoint === 'plans.summary') value = plan.empty ? { total: 0, enabled: 0, paused: 0, blocked: 0, next: null } : { total: 1, enabled: 0, paused: 1, blocked: 0, next: { id: plan.id, title: plan.title, at: plan.nextTimes[0], timeZone: plan.task_config.timeZone } };
      else if (endpoint === 'runs.summary') value = emptyHistory ? { runs24: 0, failed24: 0, delivery_failed24: 0, delivery_unknown24: 0, unresolved: 0, unresolved_events: 0, unexecuted24: 0, active_work: 0, waiting_work: 0, failed_work: 0, run_total: 0, work_total: 0, event_total: 0, legacy_total: 0, empty: true, observedAt: new Date().toISOString() } : { runs24: 31, failed24: 2, delivery_failed24: 1, delivery_unknown24: 2, unresolved: 3, unresolved_events: 1, unexecuted24: 2, active_work: 1, waiting_work: work.acceptance_status === 'accepted' ? 1 : 2, failed_work: 3, empty: false, observedAt: new Date().toISOString() };
      else if (endpoint === 'skills.catalog') value = { entries: ['morning', 'evening', 'weekly'].map(kind => ({ id: 'builtin:digest-' + kind, name: 'digest-' + kind, type: 'template', source: 'builtin' })), discovery: 'complete' };
      else if (endpoint === 'skills.inspect') value = { id: p.id, type: 'template', metadata: { track: 'template', pa24: true } };
      else if (endpoint === 'plans') { const empty = p.state === 'recycled' || (p.query && !plan.title.includes(p.query)); value = { rows: empty ? [] : [structuredClone(plan)], total: empty ? 0 : 1, offset: p.offset, limit: 20 }; }
      else if (endpoint === 'plans.inspect') value = { plan: structuredClone(plan), form: { ...form(), title: plan.title }, blocks: plan.blocks, activeRuns: [], legacyHistory: plan.legacyHistory || [] };
      else if (endpoint === 'plans.draft') value = taskPlanDraft(p, 'Asia/Shanghai');
      else if (['plans.preview', 'plans.run-preview', 'plans.migration-preview'].includes(endpoint)) value = { planId: plan.id, revision: plan.revision, timeZone: plan.task_config.timeZone, fingerprint: 'plan-fingerprint-' + plan.revision, authorization: auth(), nextTimes: plan.nextTimes, message: '已核验当前目标' };
      else if (endpoint === 'runs') {
        const matched = !emptyHistory && (!p.query || '项目晨报'.includes(p.query));
        const runRows = matched ? Array.from({ length: p.offset ? 11 : 20 }, (_, index) => ({ id: !index && !p.offset ? 'run-a' : 'run-' + (index + p.offset), title: '项目晨报', record_kind: run.run.record_kind || 'skill', skill_id: 'builtin:digest-morning', skill_name: '项目晨报', version_id: index === 1 ? null : 'v1', status: 'completed', delivery_status: index === 1 ? 'failed' : 'partial', summary: '结果摘要', source: 'schedule', created_at: new Date().toISOString() })) : [];
        const workRows = matched ? [{ id: work.id, title: work.title, status: work.status, source: work.origin, progress_detail: { stage: '等待主人确认', completed: '原资料已核对', next: '交付结果和出处' }, summary: work.result, run_count: 2, created_at: new Date().toISOString() }] : [];
        const eventRows = matched ? [{ id: 'event-a', title: '项目晨报', run_id: 'run-a', plan_id: 'plan-a', work_item_id: 'work-a', record_kind: 'skill', skill_id: 'builtin:digest-morning', status: 'skipped', summary: '同一计划已有运行在执行', source: 'schedule', created_at: new Date().toISOString() }] : [];
        value = { kind: p.kind, rows: p.kind === 'runs' ? runRows : p.kind === 'work' ? workRows : p.kind === 'events' ? eventRows : [], total: matched && p.kind !== 'legacy' ? p.kind === 'runs' ? 31 : 1 : 0, empty: emptyHistory, timeZone: 'Asia/Shanghai' };
      }
      else if (endpoint === 'skills.run') value = structuredClone(run);
      else if (endpoint === 'worker.run') value = { ...structuredClone(run), work: structuredClone(work), operations: [], reviews: [], deliveries: [{ id: 12, status: 'failed', target: 'original-parent', channel: 'local', kind: 'text', fingerprint: 'worker-delivery' }] };
      else if (endpoint === 'runs.diagnostics') value = { filename: 'diagnostic.json', content: '{"runId":"run-a"}', message: '已脱敏，请预览' };
      else if (endpoint === 'runs.export') value = { filename: 'runs.json', content: JSON.stringify({ total: 31, planId: p.planId }) };
      else if (endpoint === 'work.inspect') value = { work: structuredClone(work), changes: [], runs: { rows: [{ ...run.run }], total: 1 } };
      else if (endpoint === 'action') {
        if (p.type === 'plan.change') {
          if (p.op === 'save') { const draft = taskPlanDraft(p, 'Asia/Shanghai'); plan = { ...plan, title: p.title, task_config: draft.configuration, schedule_spec: draft.scheduleSpec, revision: plan.revision + 1, status: 'paused', owner_enabled: false }; }
          if (p.op === 'enable') { expect(p.fingerprint).toBe('plan-fingerprint-' + plan.revision); plan.status = 'active'; plan.owner_enabled = true; plan.schedule_id = 'native'; plan.revision++; }
          if (p.op === 'pause') { plan.status = 'paused'; plan.owner_enabled = false; plan.schedule_id = null; plan.revision++; }
          value = p.op === 'run' ? { trigger: { status: 'queued' }, run: run.run } : { plan: structuredClone(plan) };
        } else if (p.type === 'work.change') { expect(p.expectedRevision).toBe(work.revision); work.revision++; if (p.op === 'accept') work.acceptance_status = 'accepted'; value = { work: structuredClone(work) }; } else if (p.type === 'plan.delivery') value = { deliveries: run.deliveries };
        else throw Error('unexpected action ' + p.type);
      } else if (endpoint === 'digests') value = { plans: [], skills: [] };
      else if (endpoint === 'health') value = { capabilities: [] };
      else if (endpoint === 'memory') value = { items: [], total: 0, matched: 0 };
      else value = {};
      return { ok: true, json: async () => ({ ok: true, value: { ...value, workspaceBinding: binding } }) };
    } catch (error) { return { ok: true, json: async () => ({ ok: false, error: { message: error.message } }) }; }
  }));
  let mod, Panel; win.__ModuleLoader__ = { load: value => { mod = value; } };
  new Function('window', 'document', 'navigator', source)(win, win.document, win.navigator);
  mod.factory(() => React).apply({ effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key, resolveText: ({ zh }) => zh, subscribe: () => () => {}, getSnapshot: () => 'zh' }, slots: { inject: (_name, fn) => fn(), register: (spec, view) => { if (spec.name === 'main') Panel = view; } }, uiWorkspace: { openSession: () => {} } });
  container = win.document.createElement('div'); win.document.body.append(container); root = createRoot(container); await act(async () => root.render(React.createElement(Panel)));
});
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.restoreAllMocks(); });

describe('M02 管理界面', () => {
  it('重配保持暂停，预览明确固定时区', async () => {
    plan.task_config.timeZone = 'America/New_York';
    await open('定时任务'); await click(button('项目晨报')); await click(button('重新绑定目标 · 先预览'));
    expect(container.textContent).toContain('未来触发时间 · America/New_York');
    await click(field('确认本计划的工具、资源、目标和此项操作')); await click(button('确认执行此操作'));
    expect(requests.filter(row => row.endpoint === 'action').at(-1).payload.op).toBe('rebind');
    expect(plan.owner_enabled).toBe(false);
  });
  it('JSON与参数字段共用唯一输入；无效JSON不被字段编辑覆盖', async () => {
    await open('定时任务'); await click(button('晨报预设'));
    await change(field('参数对象'), '{"title":"JSON标题","custom":"保留值"}');
    expect(field('title · 结果标题').value).toBe('JSON标题');
    await change(field('title · 结果标题'), '字段标题');
    expect(JSON.parse(field('参数对象').value)).toEqual({ title: '字段标题', custom: '保留值' });
    await change(field('参数对象'), '{'); expect(field('title · 结果标题').disabled).toBe(true);
    expect(field('参数对象').value).toBe('{');
  });
  it('目录或详情读取失败时刷新可恢复，保留表单输入', async () => {
    fault = 'skills.catalog'; await open('定时任务'); await click(button('晨报预设'));
    await change(field('名称'), '保留草稿');
    expect(field('Skill').querySelectorAll('option')).toHaveLength(1);
    fault = 'skills.inspect'; await click(managerButton('刷新'));
    expect(field('Skill').querySelectorAll('option')).toHaveLength(4);
    fault = null; await click(managerButton('刷新'));
    expect(field('名称').value).toBe('保留草稿'); expect(field('title · 结果标题')).toBeTruthy();
    expect(requests.filter(row => row.endpoint === 'skills.catalog')).toHaveLength(3);
    expect(requests.filter(row => row.endpoint === 'skills.inspect')).toHaveLength(3);
  });
  it('切换工作区后补充读取挂起也不能显示原运行摘要', async () => {
    await open('运行记录');
    const summary = () => [...container.querySelectorAll('.pa24-manager .pa24-history-metric')].find(node => node.textContent.includes('24 小时运行'))?.querySelector('strong')?.textContent;
    expect(summary()).toBe('31'); await click(button('返回卡片'));
    let release; delayed = { endpoint: 'runs.summary', promise: new Promise(resolve => { release = resolve; }) };
    binding = 'binding-b'; await act(async () => intervals.find(row => row.ms === 2500).fn());
    await open('运行记录'); expect(summary()).toBeUndefined();
    await act(async () => release({ ok: true, json: async () => ({ ok: true, value: { runs24: 0, workspaceBinding: binding } }) }));
  });
  it('预设统一表单先预览后保存暂停；离页保留草稿，授权确认后启用', async () => {
    await open('定时任务'); await click(button('晨报预设')); await change(field('名称'), '调整后的晨报'); expect(button('保存为暂停').disabled).toBe(true);
    await change(field('日历公司'), '甲公司'); await change(field('日历项目'), 'Manticore');
    await click(button('返回卡片')); await open('定时任务'); expect(field('名称').value).toBe('调整后的晨报'); expect(field('日历项目').value).toBe('Manticore');
    await click(button('校验并预览时间')); expect(container.textContent).toContain('未来触发时间'); await click(button('保存为暂停')); expect(plan.status).toBe('paused'); expect(plan.task_config.selectors).toEqual({ calendar: { company: '甲公司', project: 'Manticore' } });
    await click(button('核验并启用')); expect(button('确认执行此操作').disabled).toBe(true); await click(field('确认本计划的工具、资源、目标和此项操作')); await click(button('确认执行此操作'));
    expect(plan.status).toBe('active'); expect(button('编辑配置').disabled).toBe(true); await click(button('暂停未来运行')); expect(plan.status).toBe('paused');
    const actions = requests.filter(row => row.endpoint === 'action').map(row => row.payload); expect(actions.map(row => row.op)).toEqual(['save', 'enable', 'pause']); expect(actions.every(row => row.workspaceBinding === binding && row.requestId)).toBe(true);
  });
  it('跨卡进入运行记录保留计划筛选，准确分页和导出不执行业务', async () => {
    await open('定时任务'); await click(button('项目晨报')); await click(button('查看全部运行'));
    await click(container.querySelector('.pa24-history-advanced-toggle'));
    expect(field('计划标识').value).toBe('plan-a'); expect(field('时间范围').value).toBe('all'); expect(container.textContent).toContain('匹配记录 31');
    await click(button('下一页')); expect(requests.filter(row => row.endpoint === 'runs').at(-1).payload).toMatchObject({ planId: 'plan-a', offset: 20, range: 'all' });
    await click(button('导出全部筛选结果')); expect(JSON.parse(await savedBlob.text())).toMatchObject({ total: 31, planId: 'plan-a' });
    expect(requests.filter(row => row.endpoint === 'runs.export').at(-1).payload.offset).toBeUndefined(); expect(requests.some(row => row.endpoint === 'action')).toBe(false);
  });
  it('失败只补投，诊断先预览后下载，原交办可打开', async () => {
    await open('运行记录'); await click(button('查看执行与投递')); expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    await click(button('投递')); expect(container.textContent).toContain('部分投递'); expect(container.textContent).not.toContain('结果投递：未请求');
    await click(button('明确补投此结果')); expect(requests.filter(row => row.endpoint === 'action').map(row => row.payload.type)).toEqual(['plan.delivery']);
    await click(button('诊断')); await click(button('预览脱敏诊断')); expect(savedBlob).toBeNull(); expect(container.textContent).toContain('已脱敏，请预览'); await click(button('确认下载这份诊断')); expect(await savedBlob.text()).toContain('run-a');
    await click(button('概览')); await click(button('查看原助理交办')); expect(container.textContent).toContain('原交办目标'); expect(container.textContent).toContain('原请求');
  });
  it('交办验收绑定已查看的修订，进展刷新后清除旧确认', async () => {
    await open('运行记录'); await click(button('查看执行与投递')); await click(button('查看原助理交办'));
    await change(field('交办操作'), 'accept'); await change(field('补充、剩余工作或验收依据'), '已核对交付文件'); await click(field('确认针对这项交办执行所选操作'));
    expect(button('提交交办操作').disabled).toBe(false);
    work.revision++; await act(async () => intervals.filter(row => row.ms === 5000).at(-1).fn());
    expect(button('提交交办操作').disabled).toBe(true); expect(field('补充、剩余工作或验收依据').value).toBe('已核对交付文件');
    await click(field('确认针对这项交办执行所选操作')); await click(button('提交交办操作'));
    expect(requests.filter(row => row.endpoint === 'action').at(-1).payload).toMatchObject({ type: 'work.change', op: 'accept', expectedRevision: 2, workId: 'work-a', confirm: true });
    expect(container.textContent).toContain('已接受');
    await click(button('助理交办')); await act(async () => intervals.find(row => row.ms === 2500).fn());
    const waitingMetric = [...container.querySelectorAll('.pa24-history-metric')].find(node => node.textContent.includes('待我处理'));
    expect(waitingMetric.querySelector('strong').textContent).toBe('1');
  });
  it('普通 Worker 运行打开独立详情并只补投原结果', async () => {
    run.run.record_kind = 'worker'; run.inputs = [{ execution_id: 'execution', instruction: '补充的主题', status: 'adopted' }];
    await open('运行记录'); await click(button('查看执行与投递'));
    expect(container.textContent).toContain('交办执行与投递'); expect(container.textContent).toContain('补充的主题');
    await click(button('投递')); await click(button('明确补投此结果'));
    expect(requests.filter(row => row.endpoint === 'action').at(-1).payload).toMatchObject({ type: 'plan.delivery', runId: 'run-a', outboxId: 12, fingerprint: 'worker-delivery', op: 'retry' });
    expect(requests.filter(row => row.endpoint === 'worker.run').length).toBeGreaterThan(0);
  });
  it('资料直接运行及关联交办均显示业务结果，完整输入回执折叠且无通用接续', async () => {
    work.id = 'pa24-material-a'; work.acceptance_required = false; work.acceptance_status = null;
    work.instruction = JSON.stringify({ action: 'adopt_actions', noteId: 'N-1', versionId: 'N-1:v1' });
    work.result = JSON.stringify({ message: '已返回原行动对象', results: [{ ok: true, reused: true, url: 'https://example.test/original-task' }] });
    Object.assign(run.run, { record_kind: 'worker', work_item_id: work.id, instruction: work.instruction, result: work.result, snapshot: { executor: 'material-action', title: '明确执行资料候选' } });
    run.execution = null;
    await open('运行记录'); await click(button('查看执行与投递'));
    const verify = () => {
      expect(container.textContent).toContain('已返回原行动对象');
      expect(container.querySelector('a[href="https://example.test/original-task"]')).not.toBeNull();
      for (const node of container.querySelectorAll('pre,p')) if (node.textContent.trim().startsWith('{')) {
        expect(node.closest('details')).not.toBeNull(); expect(node.closest('details').open).toBe(false);
      }
    };
    verify(); await click(button('查看原助理交办')); verify();
    expect([...field('交办操作').options].map(option => option.value)).not.toContain('continue');
    expect(requests.filter(row => row.endpoint === 'action')).toHaveLength(0);
  });
  it('未知投递先填平台证据，未收到结论不自动补投', async () => {
    run.deliveries[0].deliveries[0].outbox.status = 'unknown'; await open('运行记录'); await click(button('查看执行与投递')); await click(button('投递'));
    expect(button('明确补投此结果')).toBeUndefined(); await click(button('核对原平台是否收到')); expect(button('确认并保存投递核对').disabled).toBe(true);
    await change(field('核对依据'), '已检查原平台无此消息'); await click(button('确认并保存投递核对'));
    const actions = requests.filter(row => row.endpoint === 'action'); expect(actions).toHaveLength(1); expect(actions[0].payload).toMatchObject({ type: 'plan.delivery', op: 'review', outcome: 'not_sent', confirm: true });
  });
  it('同一筛选手动刷新失败保留旧结果；筛选改变后不冒充新匹配', async () => {
    await open('运行记录'); expect(container.textContent).toContain('匹配记录 31');
    fault = 'runs'; await click(managerButton('刷新')); expect(container.textContent).toContain('离线读取失败'); expect(container.textContent).toContain('匹配记录 31');
    await change(field('标题、摘要或标识'), '新筛选'); expect(container.textContent).not.toContain('匹配记录 31');
    fault = null; await click(button('返回卡片')); await open('定时任务'); expect(container.textContent).toContain('匹配计划 1');
    fault = 'plans'; await click(managerButton('刷新')); expect(container.textContent).toContain('离线读取失败'); expect(container.textContent).toContain('匹配计划 1');
    await change(field('搜索计划'), '新计划'); expect(container.textContent).not.toContain('匹配计划 1');
    fault = 'snapshot'; await click(managerButton('刷新')); expect(container.textContent).toContain('连接暂时中断');
  });
  it('错误和无匹配分开，切换工作区不接纳旧列表', async () => {
    fault = 'runs'; await open('运行记录'); expect(container.textContent).toContain('离线读取失败'); expect(container.textContent).not.toContain('匹配记录 0');
    fault = null; await click(managerButton('刷新')); await change(field('标题、摘要或标识'), '无匹配'); expect(container.textContent).toContain('当前筛选没有记录');
    let release; delayed = { endpoint: 'runs', promise: new Promise(resolve => { release = resolve; }) }; await change(field('标题、摘要或标识'), '项目');
    binding = 'binding-b'; await act(async () => intervals.find(row => row.ms === 2500).fn());
    await act(async () => release({ ok: true, json: async () => ({ ok: true, value: { rows: [{ id: 'old', title: '旧工作区敏感资料' }], total: 1, workspaceBinding: 'binding-a' } }) }));
    expect(container.textContent).not.toContain('旧工作区敏感资料');
  });
  it('摘要与桌面计划行使用真实下次运行，分组表单和固定操作栏保留预览流程', async () => {
    plan.task_config.timeZone = 'America/New_York';
    await open('定时任务');
    expect(container.querySelector('.pa24-plan-metrics')).toBeTruthy();
    expect(container.querySelector('.pa24-plan-row.pa24-plan-header')).toBeTruthy();
    expect(container.querySelector('.pa24-plan-metrics').textContent).toContain('下一次运行');
    await click(managerButton('刷新'));
    expect(container.textContent).toContain('America/New_York');
    await click(button('晨报预设'));
    expect(container.querySelectorAll('.pa24-form-section')).toHaveLength(3);
    expect(container.querySelector('.pa24-form-actions')).toBeTruthy();
    expect(button('保存为暂停').disabled).toBe(true);
    await click(button('校验并预览时间'));
    expect(container.textContent).toContain('未来触发时间');
    expect(container.textContent).toContain('结果、投递与授权');
  });
  it('计划行分别呈现状态、执行、投递和执行时间', async () => {
    plan.recentRun = { status: 'completed', delivery_status: 'partial', created_at: '2001-02-03T04:05:06.000Z' };
    await open('定时任务');
    const cells = container.querySelectorAll('.pa24-plan-row:not(.pa24-plan-header) .pa24-plan-cell');
    expect(container.querySelector('.pa24-plan-header').textContent).toContain('最近执行');
    expect(cells).toHaveLength(4);
    expect(cells[2].textContent).toContain('已暂停');
    expect(cells[3].textContent).toContain('最近执行');
    expect(cells[3].textContent).toContain('投递：');
    expect(cells[3].textContent).toContain('2001');
  });
  it('旧启用计划列表使用 schedule_spec 的固定时区', async () => {
    plan.task_config = null; plan.schedule_spec = { daily: { time: '08:30:00', time_zone: 'Asia/Tokyo' } };
    plan.status = 'active'; plan.owner_enabled = true; plan.nextTimes = ['2001-01-01T00:00:00.000Z'];
    await open('定时任务');
    const expected = new Date(plan.nextTimes[0]).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo', hour12: false });
    expect(container.querySelector('.pa24-plan-row:not(.pa24-plan-header)').textContent).toContain(expected);
  });
  it('无匹配和回收站空态不渲染无意义分页', async () => {
    await open('定时任务'); await change(field('搜索计划'), '不存在的计划');
    expect(container.textContent).toContain('没有匹配的计划');
    expect(button('上一页')).toBeUndefined();
    await change(field('搜索计划'), ''); await change(field('计划状态'), 'recycled');
    expect(container.textContent).toContain('回收站为空');
    expect(button('上一页')).toBeUndefined();
  });
  it('空计划总览使用专用图标和中性空态，不冒充健康', async () => {
    plan.empty = true; await click(button('刷新'));
    const card = [...container.querySelectorAll('.pa24-cap')].find(node => node.textContent.includes('时间 + Skill'));
    expect(card.textContent).toContain('暂无计划');
    expect(card.textContent).not.toContain('正常');
    expect(card.textContent).not.toContain('暂无已核验触发时间');
    expect(card.querySelector('svg path').getAttribute('d')).toContain('M8 2v4m8-4v4');
  });
  it('预览错误进入固定操作栏，失败后不能沿用旧预览保存', async () => {
    await open('定时任务'); await click(button('晨报预设')); await click(button('校验并预览时间'));
    expect(button('保存为暂停').disabled).toBe(false);
    fault = 'plans.draft'; await click(button('校验并预览时间'));
    const actions = container.querySelector('.pa24-form-actions');
    expect(actions.querySelector('[role="alert"]').textContent).toContain('离线读取失败');
    expect(actions.textContent).toContain('请先校验并预览时间');
    expect(button('保存为暂停').disabled).toBe(true);
  });
  it('编辑计划时，详情启用错误不归入表单固定栏', async () => {
    await open('定时任务'); await click(button('项目晨报')); await click(button('编辑配置'));
    fault = 'plans.preview'; await click(button('核验并启用'));
    expect(container.querySelector('.pa24-form-actions [role="alert"]')).toBeNull();
    expect(container.querySelector('.pa24-manager > [role="alert"]').textContent).toContain('离线读取失败');
  });
  it('旧简报只进入兼容与历史，不形成第二套计划空态', async () => {
    await open('定时任务');
    expect(container.textContent).toContain('兼容与历史');
    expect(container.textContent).not.toContain('还没有周期服务计划');
    expect(container.textContent).not.toContain('对24私助说「开启晨报」');
  });
  it('旧简报历史沿原计划进入旧档案', async () => {
    plan.legacyHistory = [{ id: 'occurrence-a', report: '历史完整结果' }];
    await open('定时任务'); await click(button('项目晨报')); await click(button('查看旧简报历史'));
    expect(requests.filter(row => row.endpoint === 'runs').at(-1).payload).toMatchObject({ kind: 'legacy', planId: 'plan-a', range: 'all' });
  });
  it('三个主视图独立统计，执行与投递分列，键盘导航和真实交办投影一致', async () => {
    await open('运行记录');
    const tabs = container.querySelector('[aria-label="运行档案主视图"]');
    expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(3); expect(tabs.textContent).not.toContain('旧简报');
    expect(container.querySelectorAll('.pa24-history-metric')).toHaveLength(4);
    const second = container.querySelectorAll('.pa24-history-run-row:not(.pa24-history-header)')[1];
    expect(second.children[2].textContent).toContain('历史未记录'); expect(second.children[3].textContent).toContain('执行已结束'); expect(second.children[4].textContent).toContain('投递失败');
    const press = async (node, key) => { await act(async () => node.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); };
    const runsTab = container.querySelector('#pa24-history-tab-runs'); runsTab.focus(); await press(runsTab, 'ArrowRight');
    expect(win.document.activeElement.id).toBe('pa24-history-tab-work'); expect(container.querySelector('#pa24-history-tab-work').getAttribute('aria-selected')).toBe('true');
    expect(container.querySelectorAll('.pa24-history-metric')).toHaveLength(3);
    const workRow = container.querySelector('.pa24-history-work-row:not(.pa24-history-header)');
    expect(workRow.textContent).toContain('关联 2 次运行'); expect(workRow.textContent).toContain('等待主人确认'); expect(workRow.textContent).toContain('原资料已核对'); expect(workRow.textContent).toContain('下一步：交付结果和出处');
    expect([...container.querySelectorAll('.pa24-history-metric')].some(node => node.textContent.includes('24 小时执行失败'))).toBe(false);
    await click(button('查看交办详情')); await act(async () => intervals.filter(row => row.ms === 5000).at(-1).fn());
    expect(container.querySelector('[role="dialog"]').textContent).toContain('真实阶段'); await click(button('关闭详情'));
    await press(container.querySelector('#pa24-history-tab-work'), 'ArrowRight');
    expect(container.querySelectorAll('.pa24-history-metric')).toHaveLength(2); expect(container.querySelector('.pa24-history-event-row:not(.pa24-history-header)').textContent).toContain('同一计划已有运行在执行');
    expect([...container.querySelectorAll('.pa24-history-metric')].some(node => node.textContent.includes('进行中交办'))).toBe(false);
    await click(button('核对未执行原记录')); expect(requests.filter(row => row.endpoint === 'skills.run').at(-1).payload.runId).toBe('run-a'); await click(button('关闭详情'));
    await press(container.querySelector('#pa24-history-tab-events'), 'Home'); expect(container.querySelector('#pa24-history-tab-runs').getAttribute('aria-selected')).toBe('true');
  });
  it('未执行事件保留并可选接续来源', async () => {
    await open('运行记录'); await click(container.querySelector('.pa24-history-advanced-toggle'));
    await change(field('发起来源'), 'continuation'); await click(button('未执行事件'));
    expect(field('发起来源').value).toBe('continuation');
    expect([...field('发起来源').options].some(option => option.value === 'continuation' && option.textContent === '接续')).toBe(true);
    expect(requests.filter(row => row.endpoint === 'runs').at(-1).payload).toMatchObject({ kind: 'events', source: 'continuation', offset: 0 });
    expect(requests.filter(row => row.endpoint === 'action')).toHaveLength(0);
  });
  it('投递实际失败与待核对分开呈现，未知不使用失败红也不增加统计卡', async () => {
    await open('运行记录');
    const failed = [...container.querySelectorAll('.pa24-history-metric')].find(node => node.textContent.includes('24 小时投递失败'));
    expect(failed.querySelector('strong').textContent).toBe('1'); expect(failed.className).toContain('danger');
    const unknown = [...container.querySelectorAll('.pa24-history-scope .pa24-badge')].find(node => node.textContent.includes('24 小时投递待核对'));
    expect(unknown).toBeTruthy(); expect(unknown.textContent).toContain('2'); expect(unknown.className).toContain('amber'); expect(unknown.className).not.toContain('danger');
    expect(container.querySelectorAll('.pa24-history-metric')).toHaveLength(4);
    expect(container.querySelector('.pa24-run-history').textContent).toContain('未知不计入投递失败，仍保留在全量待处理');
    await click(button('返回卡片'));
    const card = [...container.querySelectorAll('.pa24-cap')].find(node => node.textContent.includes('执行 · 投递 · 助理交办'));
    expect(card.textContent).toContain('24 小时投递待核对'); expect(card.textContent).toContain('24 小时投递失败');
  });
  it('高级筛选显示有效数量，视图切换清理不支持字段、页码归零并关闭详情', async () => {
    await open('定时任务'); await click(button('项目晨报')); await click(button('查看全部运行')); await click(container.querySelector('.pa24-history-advanced-toggle'));
    await change(field('交办标识'), 'work-a'); await change(field('Skill ID'), 'builtin:digest-morning'); await change(field('版本标识'), 'v1');
    await change(field('发起来源'), 'schedule'); await change(field('投递状态'), 'failed'); await change(field('当前状态'), 'completed');
    expect(container.querySelector('.pa24-history-advanced-toggle .pa24-badge').textContent).toBe('6');
    await click(button('下一页')); await click(button('查看执行与投递')); expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    await click(button('助理交办')); expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(requests.filter(row => row.endpoint === 'runs').at(-1).payload).toMatchObject({ kind: 'work', offset: 0, planId: 'plan-a', workId: 'work-a', skillId: 'builtin:digest-morning', status: 'completed' });
    const workFilter = requests.filter(row => row.endpoint === 'runs').at(-1).payload;
    expect(workFilter.source).toBeUndefined(); expect(workFilter.deliveryStatus).toBeUndefined(); expect(workFilter.versionId).toBeUndefined();
    expect(container.querySelector('.pa24-history-advanced-toggle .pa24-badge').textContent).toBe('3');
    await click(button('未执行事件')); expect(requests.filter(row => row.endpoint === 'runs').at(-1).payload).toMatchObject({ kind: 'events', offset: 0, planId: 'plan-a', workId: 'work-a', skillId: 'builtin:digest-morning' });
    expect(requests.filter(row => row.endpoint === 'runs').at(-1).payload.status).toBeUndefined();
    await click([...container.querySelectorAll('summary')].find(node => node.textContent === '兼容与历史')); await click(button('查看旧简报档案'));
    const legacyFilter = requests.filter(row => row.endpoint === 'runs').at(-1).payload;
    expect(legacyFilter).toMatchObject({ kind: 'legacy', offset: 0, planId: 'plan-a' }); expect(legacyFilter.workId).toBeUndefined(); expect(legacyFilter.skillId).toBeUndefined(); expect(legacyFilter.source).toBeUndefined();
    expect(container.querySelector('.pa24-history-advanced-toggle .pa24-badge').textContent).toBe('1');
  });
  it('Drawer 标题、初始焦点、焦点圈定、Esc 与焦点归还正确，关闭不发起业务操作', async () => {
    await open('运行记录'); const opener = button('查看执行与投递'); opener.focus(); await click(opener);
    const dialog = container.querySelector('[role="dialog"]'); expect(dialog.getAttribute('aria-modal')).toBe('true'); expect(dialog.querySelector('h2').textContent).toBe('项目晨报');
    const close = button('关闭详情'); expect(win.document.activeElement).toBe(close);
    const focusable = [...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.closest('[hidden]') && !(node.closest('details:not([open])') && node.tagName !== 'SUMMARY'));
    const last = focusable.at(-1), press = async (node, key, shiftKey = false) => { await act(async () => node.dispatchEvent(new win.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))); };
    last.focus(); await press(last, 'Tab'); expect(win.document.activeElement).toBe(close);
    await press(close, 'Tab', true); expect(win.document.activeElement).toBe(last);
    await press(close, 'Escape'); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(win.document.activeElement).toBe(opener);
    expect(requests.filter(row => row.endpoint === 'action')).toHaveLength(0);
    await click(opener); await click(button('关闭详情')); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(win.document.activeElement).toBe(opener);
    expect(run.run.status).toBe('completed'); expect(requests.filter(row => row.endpoint === 'action')).toHaveLength(0);
  });
  it('筛选变化关闭 Drawer，但不停止或改写运行', async () => {
    await open('运行记录'); await click(button('查看执行与投递')); expect(container.querySelector('[role="dialog"]')).toBeTruthy();
    await change(field('标题、摘要或标识'), '项目'); expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(requests.filter(row => row.endpoint === 'runs').at(-1).payload).toMatchObject({ query: '项目', offset: 0 });
    expect(run.run.status).toBe('completed'); expect(requests.filter(row => row.endpoint === 'action')).toHaveLength(0);
  });
  it('交办 Drawer 读取失败明确呈现并可在原工作区重试', async () => {
    fault = 'work.inspect'; await open('运行记录'); await click(button('助理交办')); await click(button('查看交办详情'));
    await act(async () => intervals.filter(row => row.ms === 5000).at(-1).fn());
    expect(container.querySelector('[role="dialog"] [role="alert"]').textContent).toContain('离线读取失败');
    expect(container.querySelector('[role="dialog"]').textContent).not.toContain('正在读取交办');
    fault = null; await click(button('重试交办读取')); await act(async () => intervals.filter(row => row.ms === 5000).at(-1).fn());
    expect(container.querySelector('[role="dialog"]').textContent).toContain('真实阶段'); expect(container.querySelector('[role="dialog"] [role="alert"]')).toBeNull();
    expect(requests.filter(row => row.endpoint === 'action')).toHaveLength(0);
  });
  it('空运行档案使用独立 History 与中性状态，不冒充健康或故障', async () => {
    emptyHistory = true; await click(button('刷新'));
    const card = [...container.querySelectorAll('.pa24-cap')].find(node => node.textContent.includes('执行 · 投递 · 助理交办'));
    expect(card.textContent).toContain('暂无档案'); expect(card.textContent).toContain('暂无运行档案'); expect(card.textContent).not.toContain('正常');
    expect(card.querySelector('svg path').getAttribute('d')).toContain('M3 12a9 9');
    await open('运行记录'); const blank = container.querySelector('.pa24-run-history .pa24-empty');
    expect(blank.textContent).toContain('此类档案尚无记录'); expect(blank.textContent).toContain('普通查看不会启动运行'); expect(blank.querySelector('svg path').getAttribute('d')).toContain('M3 12a9 9');
    expect(requests.filter(row => row.endpoint === 'action')).toHaveLength(0);
  });
});
