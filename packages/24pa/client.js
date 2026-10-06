// 24私助工作区 panel (F01): overview / Feishu access / workspace tabs with the
// shared SVG + semantic-color + keyboard/focus vocabulary. Read-mostly; all
// maintenance happens through the assistant conversation.
window.__ModuleLoader__.load({
  id: '@benz-ai-x/dsh-24pa',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const zh = {
      panel: '24私助工作区', title: '24私助', work: '事项总览', feishu: '飞书接入', memory: '结构化记忆', workspace: '工作区',
      review: '手写审核', awaiting_review: '待审核', needs_rereview: '需重新审核', returned: '已退回', collecting: '收集中',
      collected: '已收齐', approved: '已通过', pending_review: '待审核', stale: '已失效', superseded: '已取代',
      reminderOnce: '单次', reminderDaily: '每日', reminderPaused: '已暂停', reminderCanceled: '已取消', reminderDone: '已结束',
      queued: '排队中', running: '处理中', completed: '已完成', accepted: '已接纳',
      waiting_input: '等待补充', failed: '未完成', stopped: '已停止', needs_reconciliation: '需核对',
    };
    const paths = {
      memory: ['M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z', 'M8 7v10m8-10v10M8 9h4a3 3 0 0 1 0 6H8m8-6h-1'],
      bot: ['M9 4h6M12 4V2', 'M6 7h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Z', 'M8 12v2m8-2v2m-7 3h6M1 12v4m22-4v4'],
      chat: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3H13a8 8 0 0 1 8 8.5Z', 'M7 10h10M7 14h6'],
      grid: ['M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z'],
      note: ['M5 3h10l4 4v14H5ZM14 3v5h5M9 12h6m-6 4h6'],
      tasks: ['M10 6h11M10 12h11M10 18h11', 'm2 5 2 2 3-4m-5 8 2 2 3-4m-5 8 2 2 3-4'],
      plug: ['M8 2v5m8-5v5M6 7h12v4a6 6 0 0 1-12 0ZM12 17v5'],
      pulse: ['M2 12h4l3-8 6 16 3-8h4'],
      refresh: ['M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5'],
      check: ['m5 12 4 4L19 6'],
      clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2'],
      info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v.1'],
      alert: ['m12 3 10 18H2ZM12 9v5m0 3v.1'],
      shield: ['m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z', 'm8 11 3 3 5-5'],
      code: ['m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18'],
      close: ['m6 6 12 12M6 18 18 6'],
      arrow: ['M4 12h16m-6-6 6 6-6 6'],
      chevron: ['m9 5 7 7-7 7'],
      folder: ['M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
      external: ['M14 3h7v7m0-7-11 11M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5'],
    };
    const icon = (name, props = {}) => h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false, ...props }, (paths[name] || paths.note).map((d, i) => h('path', { d, key: i })));
    const tile = (name, tone = 'teal') => h('span', { className: 'pa24-icon-tile pa24-tone-' + tone }, icon(name));
    const badge = (label, tone = 'neutral', name) => h('span', { className: 'pa24-badge pa24-tone-' + tone }, name && icon(name, { width: 13, height: 13 }), label);
    const statusStyle = {
      accepted: ['neutral', 'clock'], queued: ['neutral', 'clock'], running: ['blue', 'pulse'], completed: ['teal', 'check'],
      waiting_input: ['amber', 'clock'], failed: ['rose', 'alert'], stopped: ['neutral', 'close'], needs_reconciliation: ['amber', 'info'],
      sent: ['teal', 'check'], pending: ['amber', 'clock'], sending: ['blue', 'pulse'], unknown: ['amber', 'info'], expired: ['neutral', 'close'],
    };
    const toneOf = item => (item.state === 'ok' ? 'teal' : item.state === 'error' ? 'rose' : item.state === 'warn' ? 'amber' : 'neutral');
    const style = `
      .pa24{--pa-ink:var(--dsw-alias-label-primary,#172c38);--pa-muted:#647480;--pa-line:#e3e9ed;--pa-canvas:#f4f7f8;--pa-surface:var(--dsw-alias-bg-base,#fff);--pa-soft:#f8fafb;--pa-teal:#167368;--pa-teal-bg:#e9f5f1;--pa-blue:#305fae;--pa-blue-bg:#edf3ff;--pa-amber:#946019;--pa-amber-bg:#fff5e3;--pa-rose:#ad4961;--pa-rose-bg:#fbeff3;--pa-shadow:0 3px 16px #243b4d05;height:100%;overflow:auto;container-type:inline-size;padding:32px;color:var(--pa-ink);background:var(--pa-canvas);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;scrollbar-gutter:stable}
      body[data-ds-dark-theme] .pa24{--pa-muted:#a0b0bc;--pa-line:#354149;--pa-canvas:#171e22;--pa-surface:#20292e;--pa-soft:#263037;--pa-teal:#80cebb;--pa-teal-bg:#233d38;--pa-blue:#a3c1ff;--pa-blue-bg:#28374f;--pa-amber:#e6be7d;--pa-amber-bg:#40372a;--pa-rose:#eda7bc;--pa-rose-bg:#452e37;--pa-violet:#c8aff3;--pa-violet-bg:#373047;--pa-shadow:none}
      .pa24 *{box-sizing:border-box}.pa24 svg{flex-shrink:0;vertical-align:middle}.pa24 h1,.pa24 h2,.pa24 h3,.pa24 p{margin:0}.pa24 h1{font-size:29px;line-height:1.3;letter-spacing:-.7px;font-weight:700}.pa24 h2{font-size:17px;line-height:1.5;font-weight:650}.pa24 h3{font-size:15px;line-height:1.55;font-weight:650}.pa24 p+p{margin-top:6px}.pa24-wrap{max-width:1100px;margin:auto;min-width:0}
      .pa24-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pa24-between{justify-content:space-between}.pa24-muted{color:var(--pa-muted)}.pa24-meta{font-size:12px;color:var(--pa-muted);overflow-wrap:anywhere}.pa24-note{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85}
      .pa24 button,.pa24 .pa24-link-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:8px 14px;border:1px solid var(--pa-line);border-radius:10px;color:var(--pa-ink);background:var(--pa-surface);font:inherit;font-size:13px;font-weight:550;cursor:pointer;transition:background .15s,border-color .15s;text-decoration:none}
      .pa24 button:hover:not(:disabled){background:var(--pa-soft);border-color:var(--pa-muted)}.pa24 button:disabled{opacity:.45;cursor:not-allowed}.pa24 button.pa24-primary{background:var(--pa-teal);color:#fff;border-color:var(--pa-teal)}body[data-ds-dark-theme] .pa24 button.pa24-primary{color:#172c27}
      .pa24 button.pa24-quiet{background:transparent;border-color:transparent;color:var(--pa-muted)}.pa24 button.pa24-quiet:hover:not(:disabled){background:var(--pa-soft);color:var(--pa-ink);border-color:var(--pa-line)}
      .pa24 :is(button,input,select,summary,a,[tabindex]):focus-visible{outline:3px solid var(--pa-blue);outline-offset:3px}.pa24 input,.pa24 select{min-height:42px;width:100%;font:inherit;padding:10px 12px;border:1px solid var(--pa-line);border-radius:10px;background:var(--pa-surface);color:var(--pa-ink)}
      .pa24-icon-tile{width:40px;height:40px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--tone-bg);color:var(--tone)}.pa24-tone-teal{--tone:var(--pa-teal);--tone-bg:var(--pa-teal-bg)}.pa24-tone-blue{--tone:var(--pa-blue);--tone-bg:var(--pa-blue-bg)}.pa24-tone-amber{--tone:var(--pa-amber);--tone-bg:var(--pa-amber-bg)}.pa24-tone-rose{--tone:var(--pa-rose);--tone-bg:var(--pa-rose-bg)}.pa24-tone-neutral{--tone:var(--pa-muted);--tone-bg:var(--pa-soft)}.pa24-tone-violet{--tone:#7050ad;--tone-bg:#f3effb}.pa24-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;background:var(--tone-bg);color:var(--tone);font-size:11px;font-weight:600;line-height:1.7;white-space:nowrap}
      .pa24-header{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:24px}.pa24-identity{display:flex;align-items:center;gap:14px}.pa24-brand{width:52px;height:52px;border-radius:17px;background:var(--pa-teal);color:#fff;display:inline-flex;align-items:center;justify-content:center}.pa24-brand svg{width:29px;height:29px}body[data-ds-dark-theme] .pa24-brand{color:#172c27}.pa24-eyebrow{font-size:10px;letter-spacing:2px;font-weight:650;color:var(--pa-teal);margin-bottom:3px}.pa24-tagline{margin-top:4px!important;color:var(--pa-muted);font-size:13px}
      .pa24-workspace-strip{display:flex;gap:10px;align-items:center;min-width:0;padding:11px 14px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-surface);margin-bottom:18px}.pa24-workspace-strip>svg{color:var(--pa-teal)}.pa24-path{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--pa-muted)}
      .pa24-notice{display:flex;gap:10px;align-items:flex-start;padding:12px 15px;border:1px solid color-mix(in srgb,var(--tone) 16%,transparent);border-radius:12px;color:var(--tone);background:var(--tone-bg);font-size:12px;margin-bottom:20px}.pa24-notice>svg{margin-top:1px}.pa24-notice>div{flex:1;min-width:0}
      .pa24-error{padding:16px;border:1px solid var(--pa-rose);border-radius:12px;background:var(--pa-rose-bg);margin:14px 0;color:var(--pa-rose);overflow-wrap:anywhere}
      .pa24-tabs{display:flex;gap:6px;border-bottom:1px solid var(--pa-line);margin:0 0 25px;overflow-x:auto;scrollbar-width:thin;padding:3px 0 10px}.pa24-tabs button{flex-shrink:0;min-height:40px;padding:8px 12px;background:transparent;border:1px solid transparent;border-radius:9px;color:var(--pa-muted);font-weight:500}.pa24-tabs button[aria-selected=true]{background:var(--tone-bg);color:var(--tone);font-weight:650}
      .pa24-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.pa24-section-title{display:flex;align-items:center;gap:10px}.pa24-section-desc{margin-top:5px!important;color:var(--pa-muted);font-size:13px}
      .pa24-card{min-width:0;background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:16px;padding:22px;margin-bottom:18px;box-shadow:var(--pa-shadow)}.pa24-card>h2{margin-bottom:15px}.pa24-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.pa24-grid>.pa24-card{margin:0}
      .pa24-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:22px}.pa24-stat{display:flex;align-items:center;gap:14px;padding:18px;border:1px solid var(--pa-line);border-radius:14px;background:var(--pa-surface)}.pa24-stat strong{font-size:27px;line-height:1.2;font-weight:650;font-variant-numeric:tabular-nums}.pa24-stat-label{font-size:12px;color:var(--pa-muted);margin-bottom:4px}.pa24-stat small{font-size:11px;color:var(--pa-muted);margin-left:8px}
      .pa24-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:35px 18px}.pa24-empty>.pa24-icon-tile{width:64px;height:64px;border-radius:22px;margin-bottom:18px}.pa24-empty>.pa24-icon-tile svg{width:29px;height:29px}.pa24-empty h3{font-size:17px;margin:3px 0 8px}.pa24-empty p{max-width:440px;color:var(--pa-muted);font-size:13px}.pa24-empty .pa24-row{margin-top:18px;justify-content:center}
      .pa24-example{display:flex;align-items:center;gap:9px;padding:12px 16px;background:var(--pa-soft);border-radius:10px;font-size:12px;color:var(--pa-muted)}
      .pa24-dl{margin:0}.pa24-field{display:grid;grid-template-columns:130px minmax(0,1fr);gap:16px;padding:10px 0;border-bottom:1px solid var(--pa-line)}.pa24-field:last-child{border-bottom:0}.pa24-field dt{font-size:12px;color:var(--pa-muted);overflow-wrap:anywhere}.pa24-field dd{margin:0;font-size:13px;overflow-wrap:anywhere}
      .pa24-helper{border-radius:10px;padding:12px 14px;background:var(--pa-soft);color:var(--pa-muted);font-size:12px;margin-top:16px}
      .pa24-searchbar{display:flex;gap:8px;align-items:center;padding:14px;background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:12px;margin-bottom:14px}.pa24-search{position:relative;flex:1;min-width:120px}.pa24-search>svg{position:absolute;left:12px;top:12px;color:var(--pa-muted);width:18px;height:18px}.pa24-search input{padding-left:38px;background:var(--pa-soft);font-size:13px}
      .pa24-result-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 15px;font-size:12px;color:var(--pa-muted)}.pa24-memory-list{display:grid;gap:14px}.pa24-memory-card{background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:14px;overflow:hidden}.pa24-memory-body{padding:20px 22px}.pa24-memory-heading{display:flex;align-items:flex-start;gap:10px;justify-content:space-between}.pa24-memory-heading h3{overflow-wrap:anywhere}.pa24-memory-card .pa24-note{margin:15px 0;font-size:14px}.pa24-memory-source{display:flex;gap:6px;align-items:flex-start;font-size:11px;color:var(--pa-muted);overflow-wrap:anywhere}.pa24-memory-footer{padding:10px 22px;background:var(--pa-soft);border-top:1px solid var(--pa-line)}.pa24-memory-footer details{border:0;margin:0;padding:0}.pa24-memory-footer summary{min-height:26px;padding:0;font-size:11px}.pa24-page-nav{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:22px;font-size:12px;color:var(--pa-muted)}.pa24-page-nav button:first-child svg{transform:rotate(180deg)}
      .pa24-job{padding:18px 0;border-top:1px solid var(--pa-line)}.pa24-job:first-of-type{border-top:0;padding-top:0}.pa24-job .pa24-note{margin:10px 0}.pa24-job .pa24-meta{margin:6px 0}
      .pa24-ready{display:grid;gap:10px}.pa24-ready-item{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--pa-line);border-radius:12px}.pa24-ready-item>svg{margin-top:2px;color:var(--tone)}.pa24-ready-item>div{flex:1;min-width:0}
      .pa24-resource{padding:15px 0;border-bottom:1px solid var(--pa-line)}.pa24-resource:last-child{border:0;padding-bottom:0}.pa24-resource:first-child{padding-top:0}.pa24-resource p{margin-top:5px;font-size:12px;color:var(--pa-muted);overflow-wrap:anywhere}
      .pa24 details{border-top:1px solid var(--pa-line);margin-top:16px;padding-top:10px}.pa24 summary{cursor:pointer;color:var(--pa-muted);font-size:12px;min-height:32px;padding:5px 0}.pa24 pre{padding:14px;border:1px solid var(--pa-line);border-radius:10px;background:var(--pa-soft);white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto;font:11px/1.75 ui-monospace,SFMono-Regular,Consolas,monospace;margin:10px 0 0}
      .pa24-footer{display:flex;gap:8px;align-items:baseline;margin:26px 0 5px;padding-top:16px;border-top:1px solid var(--pa-line);font-size:11px;color:var(--pa-muted)}
      .pa24-spin{animation:pa24-spin 1s linear infinite}@keyframes pa24-spin{to{transform:rotate(360deg)}}
      @container(max-width:880px){.pa24-header{align-items:flex-start}.pa24-tabs{gap:2px}.pa24-field{grid-template-columns:110px minmax(0,1fr)}}
      @container(max-width:620px){.pa24-header{flex-direction:column;gap:16px}.pa24 h1{font-size:25px}.pa24-grid{grid-template-columns:1fr}.pa24-stats{gap:8px}.pa24-stat{padding:12px;gap:8px}.pa24-stat>.pa24-icon-tile{display:none}.pa24-card{padding:18px}}
      @media(max-width:760px){.pa24{padding:20px 16px}.pa24 button{min-height:44px}.pa24-tabs button{min-height:44px}.pa24 summary{min-height:40px;display:list-item}}
      @media(prefers-reduced-motion:reduce){.pa24 *{animation:none!important;transition:none!important}}
    `;
    return {
      inject: ['slots', 'locale', 'connection', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('pa24', { zh }));
        const t = ctx.locale.bind('pa24');
        const rpc = async (endpoint, payload = {}, signal) => {
          const response = await fetch('./api/24pa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }), signal });
          if (!response.ok) throw new Error('dsh HTTP ' + response.status);
          const result = await response.json();
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        };
        const date = (value, timeZone) => (value ? new Date(value).toLocaleString('zh-CN', { timeZone: timeZone || 'Asia/Shanghai', hour12: false }) : '尚无记录');
        const badgeOf = status => badge(t(status) || status, ...(statusStyle[status] || ['neutral', 'info']));
        const fields = items => h('dl', { className: 'pa24-dl' }, items.map(([label, value]) => h('div', { key: String(label), className: 'pa24-field' }, h('dt', null, label), h('dd', null, value ?? '未配置'))));
        const sectionHead = (name, title, description, action, tone = 'teal') => h('div', { className: 'pa24-section-head' }, h('div', null, h('div', { className: 'pa24-section-title' }, h('span', { className: 'pa24-tone-' + tone, style: { color: 'var(--tone)' } }, icon(name)), h('h2', null, title)), description && h('p', { className: 'pa24-section-desc' }, description)), action);
        const empty = (name, tone, title, description, actions) => h('div', { className: 'pa24-empty' }, tile(name, tone), h('h3', null, title), h('p', null, description), actions && h('div', { className: 'pa24-row' }, actions));

        function MemoryView({ workspace, openRobot }) {
          const [draft, setDraft] = React.useState(''), [query, setQuery] = React.useState(''), [offset, setOffset] = React.useState(0), [retry, setRetry] = React.useState(0);
          const [view, setView] = React.useState({ status: 'loading', data: null, error: '' });
          React.useEffect(() => {
            const abort = new AbortController();
            setView({ status: 'loading', data: null, error: '' });
            void rpc('memory', { query, offset }, abort.signal).then(data => {
              if (!abort.signal.aborted) setView({ status: 'ready', data, error: '' });
            }).catch(error => { if (!abort.signal.aborted) setView({ status: 'error', data: null, error: error.message }); });
            return () => abort.abort();
          }, [workspace.path, query, offset, retry]);
          const categories = { preference: ['个人偏好', 'violet'], fact: ['事实', 'blue'], project: ['项目', 'teal'], decision: ['决定', 'amber'] };
          const search = () => { setOffset(0); setQuery(draft.trim()); setRetry(v => v + 1); };
          const clear = () => { setDraft(''); setQuery(''); setOffset(0); };
          const data = view.data;
          const button = (name, label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, icon(name), label);
          return h('section', null,
            sectionHead('memory', '结构化记忆', '记住你的偏好与背景，让每次交办更有默契。',
              h('div', { className: 'pa24-row' }, button('refresh', '刷新记忆', () => setRetry(v => v + 1), { disabled: view.status === 'loading', className: 'pa24-quiet' }), button('chat', '通过对话维护记忆', openRobot)), 'violet'),
            h('div', { className: 'pa24-searchbar' },
              h('div', { className: 'pa24-search' }, icon('search'), h('input', { value: draft, placeholder: '搜索正文、主题或来源…', 'aria-label': '筛选记忆', onChange: e => setDraft(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) search(); } })),
              button('search', '筛选', search), (draft || query) && button('close', '查看全部', clear, { className: 'pa24-quiet' })),
            view.status === 'loading' && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), '正在读取记忆内容…'),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('div', { className: 'pa24-row' }, icon('alert'), h('strong', null, '记忆读取失败')), h('p', null, view.error), h('p', null, '请在 dsh 的24私助会话中检查记忆文件，修复后重试。'), button('refresh', '重试读取', () => setRetry(v => v + 1))),
            data && h('div', null,
              h('div', { className: 'pa24-result-meta', role: 'status' }, h('span', null, '共 ' + data.total + ' 条记忆' + (query ? ' · 匹配 ' + data.matched + ' 条' : '')), h('span', null, '记忆版本 ' + data.revision)),
              data.total === 0 ? h('div', { className: 'pa24-card' }, empty('memory', 'violet', '从「记住这件事」开始', '还没有保存的记忆。在 dsh 的24私助会话告诉它你的偏好或项目背景，保存后会直接显示在这里。',
                button('chat', '告诉24私助我的偏好', openRobot, { className: 'pa24-primary' })),
                h('div', { className: 'pa24-example' }, icon('chat', { width: 16, height: 16 }), '试着说：“记住，我希望会议之间留 15 分钟。”')) :
              data.matched === 0 ? h('div', { className: 'pa24-card' }, empty('search', 'violet', '没有找到匹配的记忆', '试试更短的关键词，或清空筛选查看所有记忆。', button('close', '清空筛选', clear))) :
              h('div', { className: 'pa24-memory-list' }, data.records.map(r => {
                const [category, tone] = categories[r.category] || [r.category, 'neutral'];
                return h('article', { key: r.id, className: 'pa24-memory-card' },
                  h('div', { className: 'pa24-memory-body' },
                    h('div', { className: 'pa24-memory-heading' }, h('div', { className: 'pa24-row' }, badge(category, tone), h('h3', null, r.topic || '未设置主题')), badge(r.status === 'confirmed' ? '已确认' : '待核实', r.status === 'confirmed' ? 'teal' : 'amber', r.status === 'confirmed' ? 'check' : 'clock')),
                    h('div', { className: 'pa24-note' }, r.content),
                    h('div', { className: 'pa24-row pa24-between' },
                      h('div', { className: 'pa24-memory-source' }, icon('note', { width: 13, height: 13 }), h('span', null, '来源：' + r.source)),
                      h('time', { className: 'pa24-meta', dateTime: r.updatedAt }, date(r.updatedAt, workspace.config ? workspace.config.timeZone : 'Asia/Shanghai')))),
                  h('div', { className: 'pa24-memory-footer' }, h('details', null, h('summary', null, '修订依据与 JSON'), h('p', { className: 'pa24-meta' }, '修订依据：' + r.reason), h('p', { className: 'pa24-meta' }, '修改会话：' + r.updatedBy), r.validUntil && h('p', { className: 'pa24-meta' }, '有效期至：' + r.validUntil), h('pre', null, JSON.stringify(r, null, 2)))));
              })),
              data.matched > data.limit && h('nav', { className: 'pa24-page-nav', 'aria-label': '记忆分页' }, button('chevron', '上一页', () => setOffset(Math.max(0, data.offset - data.limit)), { disabled: data.offset === 0 }), h('span', null, '第 ' + (Math.floor(data.offset / data.limit) + 1) + ' / ' + Math.ceil(data.matched / data.limit) + ' 页'), button('chevron', '下一页', () => setOffset(data.offset + data.limit), { disabled: data.offset + data.limit >= data.matched }))),
            h('details', null, h('summary', null, '存储位置与维护方式'), h('p', { className: 'pa24-meta' }, (workspace.path || '') + '/.24pa/memory.json'), h('p', { className: 'pa24-meta' }, '通过 dsh 的24私助会话新增、更正、删除和整理（变更集可撤销）；整理仅由你发起。')));
        }

        function ReviewView({ workspace, openRobot }) {
          const [view, setView] = React.useState({ status: 'loading', data: null, error: '' });
          const [retry, setRetry] = React.useState(0);
          React.useEffect(() => {
            const abort = new AbortController();
            setView({ status: 'loading', data: null, error: '' });
            void rpc('notes.queue', {}, abort.signal).then(data => {
              if (!abort.signal.aborted) setView({ status: 'ready', data, error: '' });
            }).catch(error => { if (!abort.signal.aborted) setView({ status: 'error', data: null, error: error.message }); });
            return () => abort.abort();
          }, [workspace.path, retry]);
          const button = (name, label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, icon(name), label);
          const tz = workspace.config ? workspace.config.timeZone : 'Asia/Shanghai';
          const verifyBadge = v => {
            if (!v || !v.verifyResult) return badge('尚未核验', 'neutral', 'info');
            if (v.verifyResult === 'matches') return badge('内容一致', 'teal', 'check');
            if (v.verifyResult === 'changed') return badge('文档已修改', 'amber', 'alert');
            return badge('核验异常', 'rose', 'alert');
          };
          return h('section', null,
            sectionHead('pen', '手写审核', '拍照笔记的待审版本、疑点定位与催办都在这里；批准或退回请在飞书审核卡上完成。',
              button('refresh', '刷新队列', () => setRetry(v => v + 1), { disabled: view.status === 'loading', className: 'pa24-quiet' }), 'rose'),
            h('div', { className: 'pa24-example' }, icon('shield', { width: 16, height: 16 }), '审核裁决只由你在飞书卡片上作出；本页面为只读查阅，不提供网页批准按钮。'),
            view.status === 'loading' && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), '正在读取审核队列…'),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('div', { className: 'pa24-row' }, icon('alert'), h('strong', null, '审核队列读取失败')), h('p', null, view.error), button('refresh', '重试读取', () => setRetry(v => v + 1))),
            view.status === 'ready' && (view.data.count === 0
              ? h('div', { className: 'pa24-card' }, empty('check', 'teal', '没有等待审核的笔记', '拍照整理后的待审版本会出现在这里；审核完成或退回后自动移出。', button('chat', '与24私助对话', openRobot)))
              : view.data.items.map(item => h('article', { key: item.noteId, className: 'pa24-job' },
                  h('div', { className: 'pa24-row pa24-between' }, h('h3', null, item.title || item.noteId), badge(t(item.noteStatus) || item.noteStatus, ...(item.noteStatus === 'awaiting_review' ? ['amber', 'clock'] : item.noteStatus === 'needs_rereview' ? ['rose', 'alert'] : ['neutral', 'pen']))),
                  item.latestVersion && h('div', { className: 'pa24-row' }, badge('v' + item.latestVersion.version + ' ' + (t(item.latestVersion.status) || item.latestVersion.status), item.latestVersion.status === 'pending_review' ? 'amber' : 'neutral', 'shield'), verifyBadge(item.latestVersion)),
                  h('p', { className: 'pa24-meta' }, item.pages + ' 页原稿 · 指纹 ' + (item.latestVersion ? item.latestVersion.fingerprint : '—') + (item.latestVersion && item.latestVersion.verifiedAt ? ' · 上次核验 ' + date(item.latestVersion.verifiedAt, tz) : '')),
                  item.reminders.length > 0 && h('p', { className: 'pa24-meta' }, '催办：' + item.reminders.map(r => (t('reminder' + (r.kind === 'daily' ? 'Daily' : 'Once')) || r.kind) + ' ' + (t('reminder' + r.status.charAt(0).toUpperCase() + r.status.slice(1)) || r.status) + (r.status === 'pending' ? '，下次 ' + date(r.remindAt, tz) : '')).join('；')),
                  item.latestVersion && item.latestVersion.docUrl && h('a', { className: 'pa24-link-button', href: item.latestVersion.docUrl, target: '_blank', rel: 'noreferrer' }, icon('external'), '打开飞书文档'),
                  h('p', { className: 'pa24-meta' }, '需要稍后提醒、暂停催办或重新发布候选时，直接告诉24私助。')))));
        }

        function Panel() {
          const [state, setState] = React.useState(null), [error, setError] = React.useState(''), [connError, setConnError] = React.useState(''), [busy, setBusy] = React.useState(false);
          const [tab, setTab] = React.useState('work'), [path, setPath] = React.useState('');
          const main = React.useRef(null);
          const refresh = async () => { const s = await rpc('snapshot'); setState(s); setConnError(''); return s; };
          React.useEffect(() => {
            let live = true, pending = false;
            const load = async () => {
              if (pending) return;
              pending = true;
              try { const s = await rpc('snapshot'); if (live) { setState(s); setConnError(''); } }
              catch (e) { if (live) setConnError(e.message); }
              finally { pending = false; }
            };
            void load(); const timer = setInterval(() => void load(), 2500);
            return () => { live = false; clearInterval(timer); };
          }, []);
          const run = async fn => { setBusy(true); setError(''); try { return await fn(); } catch (e) { setError(e.message); return null; } finally { setBusy(false); } };
          const button = (name, label, fn, props = {}) => h('button', { type: 'button', disabled: busy, onClick: () => void run(fn), ...props }, name && icon(name), label);
          const selectTab = id => { setTab(id); main.current?.scrollTo({ top: 0 }); };
          const openRobot = async () => { const r = await rpc('action', { type: 'robot.open' }); ctx.uiWorkspace.openSession(r.sessionId); };
          if (!state) return h('main', { className: 'pa24' }, h('style', null, style), h('div', { className: 'pa24-wrap' }, empty(connError ? 'alert' : 'bot', connError ? 'rose' : 'teal', connError ? '暂时无法连接工作区' : '正在连接你的工作区', connError || '正在读取配置与当前事项…')));
          const workspace = state.workspace, config = workspace?.config, tz = config?.timeZone;
          const items = state.work || [];
          const active = items.filter(j => ['accepted', 'queued', 'running'].includes(j.status));
          const tabItems = [['work', 'grid', 'teal'], ['feishu', 'plug', 'blue'], ['memory', 'memory', 'violet'], ['review', 'pen', 'rose'], ['workspace', 'folder', 'teal']];
          let content;
          if (tab === 'review') {
            content = h(ReviewView, { workspace, openRobot });
          } else if (tab === 'work') {
            const roleNames = { memo: '备忘整理' };
            const readyItems = (state.readiness?.items || []).map(item => {
              const labels = { host: '宿主', config: '配置', postgres: 'PostgreSQL', workspace: '工作区', feishu: '飞书接入', sessions: '固定会话' };
              const stateLabel = item.state === 'ok' ? '正常' : item.state === 'error' ? '需要处理' : '待核验';
              const iconName = item.state === 'ok' ? 'check' : item.state === 'error' ? 'alert' : 'clock';
              return h('div', { key: item.id, className: 'pa24-ready-item pa24-tone-' + toneOf(item) },
                icon(iconName, { width: 17, height: 17 }),
                h('div', null,
                  h('div', { className: 'pa24-row pa24-between' }, h('strong', null, labels[item.id] || item.id), badge(stateLabel, toneOf(item))),
                  h('p', { className: 'pa24-meta' }, item.message)));
            });
            const stats = [
              ['pulse', 'blue', '正在处理', active.length, '含排队事项'],
              ['check', 'teal', '已完成', items.filter(j => j.status === 'completed').length, '历史事项'],
              ['note', 'violet', '备忘已保存', (state.memos ?? items.filter(j => j.role === 'memo' && j.status === 'completed')).length, '随手记与资料'],
            ];
            const jobCards = items.length
              ? items.map(j => h('article', { className: 'pa24-job', key: j.id },
                  h('div', { className: 'pa24-row pa24-between' }, h('h3', null, j.title), badgeOf(j.status)),
                  h('p', { className: 'pa24-meta' }, (j.origin === 'local' ? 'dsh 会话' : '飞书') + ' · ' + (roleNames[j.role] || j.role)),
                  j.progress && h('p', { className: 'pa24-note' }, j.progress),
                  j.result && h('details', null, h('summary', null, '查看处理结果'), h('div', { className: 'pa24-note' }, j.result)),
                  j.child_session_id && button('external', '查看 Worker 会话', () => ctx.uiWorkspace.openSession({ childSessionId: j.child_session_id, parentSessionId: j.parent_session_id, mode: 'continuable' }), { className: 'pa24-quiet' }),
                  h('p', { className: 'pa24-meta' }, '事项编号：' + j.id)))
              : [h(React.Fragment, { key: 'empty' },
                  empty('chat', 'teal', '下一件事，交给24私助', '在飞书或这里发一段话，机器人会安排合适的 Worker，并把进度与结果带回来。',
                    [button('chat', '与24私助对话', openRobot, { key: 'chat', className: 'pa24-primary', disabled: busy || !workspace })]),
                  h('div', { className: 'pa24-example' }, icon('info', { width: 16, height: 16 }), '可以说：“记一下：下周讨论新的合作方向。”'))];
            content = h('div', null,
              h('div', { className: 'pa24-stats' },
                stats.map(([name, tone, label, value, hint]) =>
                  h('div', { key: label, className: 'pa24-stat' }, tile(name, tone), h('div', null, h('div', { className: 'pa24-stat-label' }, label), h('strong', null, value), h('small', null, hint))))),
              h('section', { className: 'pa24-card' }, sectionHead('tasks', '正在办理的事项', '委托、进度与结果，在这里一目了然。', badge('PostgreSQL 业务账本', 'neutral', 'shield')), jobCards),
              h('section', { className: 'pa24-card' }, sectionHead('pulse', '运行就绪', '配置、账本与接入的真实状态；不把进程在线当作全部就绪。'),
                h('div', { className: 'pa24-ready' }, readyItems)));
          } else if (tab === 'feishu') {
            const check = state.diagnostics;
            const cli = check ? check.cli : null;
            const auth = check ? check.auth : null;
            const diagnosis = (item, fallback = '尚未检查') => !item
              ? badge(fallback, 'neutral', 'clock')
              : item.state === 'ok'
                ? badge('检查通过', 'teal', 'check')
                : ['error', 'mismatch'].includes(item.state)
                  ? badge('需要处理', 'rose', 'alert')
                  : badge(item.state === 'missing' ? '待配置' : '待核验', 'amber', 'info');
            const pendingOutbox = String((state.outbox || []).filter(o => ['pending', 'sending', 'unknown'].includes(o.status)).length) + ' 条（持久 Outbox）';
            const resourceRows = [['folder', '文档目录', config ? config.folderToken : null, 'folder'], ['tasklist', '任务清单', config ? config.tasklistId : null, 'tasks'], ['calendar', '本人日历', config ? config.calendarId : null, 'calendar']].map(([id, label, value]) => {
              const resource = check && check.resources ? check.resources.find(r => r.id === id) : null;
              return h('div', { key: id, className: 'pa24-resource' },
                h('div', { className: 'pa24-row' },
                  h('div', { style: { flex: 1, minWidth: 0 } }, h('h3', null, label), h('p', null, value || '尚未配置')),
                  diagnosis(resource, value ? '尚未检查' : '待配置')),
                resource ? h('p', null, resource.message) : null);
            });
            content = h('div', { className: 'pa24-grid' },
              h('section', { className: 'pa24-card' },
                sectionHead('plug', '飞书接入', '用自然语言配置，在这里查阅接入情况。',
                  h('div', { className: 'pa24-row' },
                    button('refresh', busy ? '检查中…' : '检查接入状态', () => rpc('action', { type: 'connection.check' }), { className: 'pa24-primary' }),
                    button('chat', '通过对话配置', openRobot)), 'blue'),
                fields([
                  ['固定 CLI profile', badge(config ? config.larkProfile : '未配置', 'blue')],
                  ['接入模式', config && config.mode === 'feishu' ? '飞书模式' : '体验模式 · 未连接飞书'],
                  ['上次检查', check ? date(check.checkedAt, tz) : '尚未检查，点击右上方按钮开始'],
                ]),
                h('div', { className: 'pa24-helper' }, '可以说：“检查飞书接入，告诉我还缺什么。” 检查只读取，不创建飞书对象。')),
              h('section', { className: 'pa24-card' },
                h('div', { className: 'pa24-row pa24-between' }, h('h2', null, '机器人连接'), badge(state.transport && state.transport.connected ? '长连接已启动' : '未启动', state.transport && state.transport.connected ? 'blue' : 'neutral', 'plug')),
                fields([
                  ['连接状态', (state.transport && state.transport.message) || '未启动'],
                  ['最近收到本人消息', date(state.transport ? state.transport.lastReceivedAt : null, tz)],
                  ['最近发送获平台确认', date(state.transport ? state.transport.lastSentAt : null, tz)],
                  ['待发消息', pendingOutbox],
                ]),
                h('p', { className: 'pa24-helper' }, '在飞书发送 /24pa 并收到回复后，再核对收发记录。长连接启动不代表端到端可用。')),
              h('section', { className: 'pa24-card' },
                h('div', { className: 'pa24-row pa24-between' }, h('h2', null, 'CLI 与用户授权'), diagnosis(auth)),
                fields([
                  ['安装状态', cli ? cli.message : '尚未检查'],
                  ['CLI 版本', cli ? cli.version : '尚未检查'],
                  ['用户授权', auth ? auth.message : '尚未检查'],
                  ['CLI 用户', auth ? auth.userName : '尚未取得'],
                  ['用户令牌', auth ? auth.tokenStatus : '尚未确认'],
                ]),
                h('details', null, h('summary', null, '路径与身份明细'),
                  fields([['CLI 路径', cli ? cli.path : '尚未检查'], ['CLI open_id', auth ? auth.openId : '尚未取得'], ['配置主人', config ? config.ownerOpenId : '未配置']]))),
              h('section', { className: 'pa24-card' },
                sectionHead('folder', '使用的飞书资源', '检查结果仅代表可读性；写入由实际任务回执验证。'),
                resourceRows,
                h('details', null, h('summary', null, '配置来源与生效时间'),
                  fields([['配置来源', (workspace ? workspace.path : '') + '/AGENTS.md'], ['生效时间', date(workspace ? workspace.loadedAt : null, tz)], ['文件与生效版本', check && check.source ? check.source.message : '尚未检查']]))));
          } else if (tab === 'memory') {
            content = workspace && h(MemoryView, { key: workspace.path, workspace, openRobot: () => void run(openRobot) });
          } else if (tab === 'workspace') {
            const enabledNames = (config && config.enabledWorkers ? config.enabledWorkers : []).map(w => ({ memo: '备忘整理' }[w] || w)).join('、') || '无';
            content = h('div', { className: 'pa24-grid' },
              h('section', { className: 'pa24-card' },
                sectionHead('folder', '当前工作区', '在 dsh 添加服务器目录，再选择绑定。空目录首次绑定时生成 AGENTS.md。'),
                h('label', { style: { display: 'block', margin: '18px 0 12px' } },
                  h('span', { className: 'pa24-meta' }, '选择 dsh 工作区'),
                  h('select', { value: path, onChange: e => setPath(e.target.value), style: { marginTop: 6 } },
                    h('option', { value: '' }, '选择一个工作区…'),
                    (state.availableWorkspaces || []).map(w => h('option', { value: w.path, key: w.id }, w.title + ' · ' + w.path)))),
                button('folder', '绑定所选工作区', () => rpc('action', { type: 'workspace.bind', path }), { disabled: busy || !path }),
                h('div', { className: 'pa24-helper' }, '当前目录', h('p', { className: 'pa24-meta' }, workspace ? workspace.path : '未绑定'))),
              h('section', { className: 'pa24-card' },
                sectionHead('code', '当前生效配置', '配置源是工作区 AGENTS.md；凭据值由服务器环境或 CLI 授权保存。',
                  h('div', { className: 'pa24-row' },
                    button('chat', '通过对话修改配置', openRobot),
                    button('refresh', '重载 AGENTS.md', () => rpc('action', { type: 'workspace.reload' }), { className: 'pa24-quiet' })), 'blue'),
                workspace && fields([
                  ['固定飞书 profile', config ? config.larkProfile : null],
                  ['时区', config ? config.timeZone : null],
                  ['同时处理数', config ? config.maxWorkers : null],
                  ['已启用 Worker', enabledNames],
                  ['飞书接入会话', workspace.accessSessionId || '未建立'],
                  ['本地助理会话', workspace.localSessionId || '未建立'],
                ]),
                workspace && workspace.configError && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, '当前生效配置保留上一有效版本'), h('p', null, workspace.configError)),
                h('details', null, h('summary', null, '查看完整配置 JSON'), h('pre', null, JSON.stringify(config, null, 2)))));
          }
          return h('main', { className: 'pa24', ref: main }, h('style', null, style), h('div', { className: 'pa24-wrap' },
            h('header', { className: 'pa24-header' },
              h('div', { className: 'pa24-identity' }, h('span', { className: 'pa24-brand' }, icon('bot')), h('div', null, h('div', { className: 'pa24-eyebrow' }, 'YOUR PERSONAL ASSISTANT'), h('h1', null, t('title')), h('p', { className: 'pa24-tagline' }, '日常交给我，重要的事由你决定。'))),
              h('div', { className: 'pa24-row' }, button('chat', '与24私助对话', openRobot, { className: 'pa24-primary', disabled: busy || !workspace }), button('refresh', '刷新', () => refresh(), { className: 'pa24-quiet' }))),
            h('div', { className: 'pa24-workspace-strip' }, icon('folder', { width: 17, height: 17 }), h('span', { className: 'pa24-path', title: workspace?.path }, workspace?.path || '尚未绑定工作区'), badge('工作区', 'neutral'), h('button', { type: 'button', className: 'pa24-quiet', onClick: () => selectTab('workspace') }, '查看配置', icon('chevron', { width: 14, height: 14 }))),
            config?.mode === 'demo' && h('div', { className: 'pa24-notice pa24-tone-amber' }, icon('info', { width: 18, height: 18 }), h('div', null, h('strong', null, '体验模式'), ' · 未连接飞书；业务账本使用 PostgreSQL，备忘仅入账本。')),
            (error || connError) && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, connError ? '连接暂时中断，以下为上次读取的状态' : '操作未完成'), h('p', null, error || connError)),
            h('nav', { className: 'pa24-tabs', role: 'tablist', 'aria-label': '24私助工作区导航' }, tabItems.map(([id, name, tone], index) => h('button', { key: id, id: 'pa24-tab-' + id, type: 'button', role: 'tab', className: 'pa24-tone-' + tone, 'aria-selected': tab === id, 'aria-controls': 'pa24-content', tabIndex: tab === id ? 0 : -1, onClick: () => selectTab(id), onKeyDown: e => {
              const next = e.key === 'ArrowRight' ? (index + 1) % tabItems.length : e.key === 'ArrowLeft' ? (index + tabItems.length - 1) % tabItems.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabItems.length - 1 : null;
              if (next === null) return; e.preventDefault(); selectTab(tabItems[next][0]); e.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus();
            } }, icon(name, { width: 17, height: 17 }), t(id)))),
            h('div', { id: 'pa24-content', role: 'tabpanel', 'aria-labelledby': 'pa24-tab-' + tab, tabIndex: 0 }, content),
            h('footer', { className: 'pa24-footer' }, icon('shield', { width: 13, height: 13 }), '业务账本使用 PostgreSQL；配置与记忆通过对话维护，界面不伪造成功。')));
        }
        const SidebarIcon = () => icon('bot', { width: 22, height: 22 });
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'pa24' }, Panel));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'pa24', order: 24, label: () => t('panel') }, SidebarIcon));
      },
    };
  },
});
