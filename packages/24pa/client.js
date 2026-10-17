// 24私助工作区 panel (F01): business overview / access modules with the
// shared SVG + semantic-color + keyboard/focus vocabulary. Read-mostly; all
// maintenance happens through the assistant conversation.
// F20 (1.6 补充): workspace configuration management moved to the dsh
// settings「24私助」section entirely (binding/reload/config/health) — the
// panel shows business tabs only, plus the WeCom access module.
// F21 (P53): UI/UX walkthrough fixes — tighter vertical rhythm, one primary
// action per view, unified status-badge vocabulary, human-first copy with
// tech detail folded away, and design-doc tab color semantics.
// F26 (P58): capability cards — 一级导航收敛为三分类 tab（业务内容/接入与
// 通讯/系统维护，用户原型评审裁决 prototypes/pa24-card-panel v0.3），卡片由
// CARD_REGISTRY 驱动：注册即生卡，点卡片进入二级详情（原视图平移）。浅色为
// 设计主参考（--pa-ink/--pa-muted 双层文字层级暗色跟随不掉队）。
window.__ModuleLoader__.load({
  id: '@benz-ai-x/dsh-24pa',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const zh = {
      panel: '24私助工作区', title: '24私助',
      settings: '24私助', biz: '业务内容', access: '接入与通讯', system: '系统维护',
      review: '手写审核', awaiting_review: '待审核', needs_rereview: '需重新审核', returned: '已退回', collecting: '收集中',
      collected: '已收齐', approved: '已通过', pending_review: '待审核', stale: '已失效', superseded: '已取代',
      reminderOnce: '单次', reminderDaily: '每日', reminderPaused: '已暂停', reminderCanceled: '已取消', reminderDone: '已结束',
      queued: '排队中', running: '处理中', completed: '已完成', accepted: '已接纳',
      waiting_input: '等待补充', failed: '未完成', stopped: '已停止', needs_reconciliation: '需核对',
      'status.ok': '正常', 'status.warn': '待核验', 'status.error': '需要处理', 'status.missing': '待配置', 'status.unchecked': '尚未检查',
    };
    // F27（P59）：中英双语——命名空间字典走 register({zh,en})；内联文案走
    // resolveText({zh,en}) 的 L() 帮助函数（dsh 官方内联双语通道，与字符串
    // 同址维护）；切换即时生效由 Panel 的 useSyncExternalStore 订阅保证。
    const en = {
      panel: '24PA Workspace', title: '24PA',
      settings: '24PA', biz: 'Business', access: 'Access & Messaging', system: 'System Maintenance',
      review: 'Handwriting Review', awaiting_review: 'Awaiting review', needs_rereview: 'Needs re-review', returned: 'Returned', collecting: 'Collecting',
      collected: 'All pages in', approved: 'Approved', pending_review: 'Awaiting review', stale: 'Stale', superseded: 'Superseded',
      reminderOnce: 'Once', reminderDaily: 'Daily', reminderPaused: 'Paused', reminderCanceled: 'Canceled', reminderDone: 'Done',
      queued: 'Queued', running: 'Running', completed: 'Completed', accepted: 'Accepted',
      waiting_input: 'Waiting for input', failed: 'Failed', stopped: 'Stopped', needs_reconciliation: 'Needs reconciliation',
      'status.ok': 'OK', 'status.warn': 'Needs review', 'status.error': 'Needs attention', 'status.missing': 'Not configured', 'status.unchecked': 'Not checked',
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
    const tile = (name, tone = 'neutral') => h('span', { className: 'pa24-icon-tile pa24-tone-' + tone }, icon(name));
    const badge = (label, tone = 'neutral', name) => h('span', { className: 'pa24-badge pa24-tone-' + tone }, name && icon(name, { width: 13, height: 13 }), label);
    const statusStyle = {
      accepted: ['neutral', 'clock'], queued: ['neutral', 'clock'], running: ['blue', 'pulse'], completed: ['blue', 'check'],
      waiting_input: ['amber', 'clock'], failed: ['danger', 'alert'], stopped: ['neutral', 'close'], needs_reconciliation: ['amber', 'info'],
      sent: ['blue', 'check'], pending: ['amber', 'clock'], sending: ['blue', 'pulse'], unknown: ['amber', 'info'], expired: ['neutral', 'close'],
    };
    // P53: 状态徽章统一语法——四档通用词（正常/待核验/需要处理/待配置/尚未检查）各配
    // 固定 tone 与图标；诊断徽章可用 label 覆盖具体原因词（未授权/已过期/企业不可用），
    // 但 tone/图标必须取自同一档，保证 SPEC §13「状态全局一致」。
    const STATUS = { ok: ['status.ok', 'blue', 'check'], warn: ['status.warn', 'amber', 'clock'], error: ['status.error', 'danger', 'alert'], missing: ['status.missing', 'amber', 'info'], unchecked: ['status.unchecked', 'neutral', 'clock'] };
    const style = `
      .pa24{--pa-ink:var(--dsw-alias-label-primary,#1f2937);--pa-muted:#667085;--pa-line:#e4e7ec;--pa-canvas:#f7f8fa;--pa-surface:var(--dsw-alias-bg-base,#fff);--pa-soft:#f2f4f7;--pa-brand:#2b5da8;--pa-brand-hover:#244f8e;--pa-blue:#2b5da8;--pa-blue-bg:#edf2fa;--pa-green:#1f7a4d;--pa-green-bg:#e9f5ef;--pa-violet:#6941c6;--pa-violet-bg:#f0ebfa;--pa-amber:#8a5b18;--pa-amber-bg:#fff7e8;--pa-danger:#b42318;--pa-danger-bg:#fff1f0;--pa-shadow:none;height:100%;overflow:auto;container-type:inline-size;padding:32px;color:var(--pa-ink);background:var(--pa-canvas);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;scrollbar-gutter:stable}
      body[data-ds-dark-theme] .pa24{--pa-ink:var(--dsw-alias-label-primary,rgb(249 250 251));--pa-muted:var(--dsw-alias-label-caption,rgb(129 133 140));--pa-line:var(--dsw-alias-border-l2,rgba(255 255 255/12%));--pa-canvas:var(--dsw-alias-bg-base,var(--dsw-static-neutral-bluish-950,rgb(21 21 23)));--pa-surface:var(--dsw-alias-bg-layer-2,var(--dsw-static-neutral-bluish-850,rgb(44 44 46)));--pa-soft:var(--dsw-alias-bg-layer-3,var(--dsw-static-neutral-bluish-800,rgb(53 54 56)));--pa-brand:#3764ab;--pa-brand-hover:#4174c2;--pa-blue:#a0bdf0;--pa-blue-bg:#25364f;--pa-green:#7cc7a2;--pa-green-bg:#1f3226;--pa-violet:#b9a5ef;--pa-violet-bg:#2b2447;--pa-amber:#dfbc83;--pa-amber-bg:#3b3225;--pa-danger:#f0aaa5;--pa-danger-bg:#412b2c;--pa-shadow:none}
      .pa24 *{box-sizing:border-box}.pa24 svg{flex-shrink:0;vertical-align:middle}.pa24 h1,.pa24 h2,.pa24 h3,.pa24 p{margin:0}.pa24 h1{font-size:21px;line-height:1.35;letter-spacing:-.4px;font-weight:700}.pa24 h2{font-size:17px;line-height:1.5;font-weight:650}.pa24 h3{font-size:15px;line-height:1.55;font-weight:650}.pa24 p+p{margin-top:6px}.pa24-wrap{max-width:1100px;margin:auto;min-width:0}
      .pa24-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pa24-between{justify-content:space-between}.pa24-muted{color:var(--pa-muted)}.pa24-meta{font-size:12px;color:var(--pa-muted);overflow-wrap:anywhere}.pa24-ellip{display:inline-block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom}.pa24-note{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85}
      .pa24 button,.pa24 .pa24-link-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:8px 14px;border:1px solid var(--pa-line);border-radius:10px;color:var(--pa-ink);background:var(--pa-surface);font:inherit;font-size:13px;font-weight:550;cursor:pointer;transition:background .15s,border-color .15s;text-decoration:none}
      .pa24 button:hover:not(:disabled){background:var(--pa-soft);border-color:var(--pa-muted)}.pa24 button:disabled{opacity:.45;cursor:not-allowed}.pa24 button.pa24-primary{background:var(--pa-blue);color:#fff;border-color:var(--pa-blue)}body[data-ds-dark-theme] .pa24 button.pa24-primary{color:#172c27}
      .pa24 button.pa24-quiet{background:transparent;border-color:transparent;color:var(--pa-muted)}.pa24 button.pa24-quiet:hover:not(:disabled){background:var(--pa-soft);color:var(--pa-ink);border-color:var(--pa-line)}
      .pa24 :is(button,input,select,summary,a,[tabindex]):focus-visible{outline:3px solid var(--pa-blue);outline-offset:3px}.pa24 input,.pa24 select{min-height:42px;width:100%;font:inherit;padding:10px 12px;border:1px solid var(--pa-line);border-radius:10px;background:var(--pa-surface);color:var(--pa-ink)}
      .pa24-icon-tile{width:40px;height:40px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--tone-bg);color:var(--tone)}.pa24-tone-blue{--tone:var(--pa-blue);--tone-bg:var(--pa-blue-bg)}.pa24-tone-green{--tone:var(--pa-green);--tone-bg:var(--pa-green-bg)}.pa24-tone-violet{--tone:var(--pa-violet);--tone-bg:var(--pa-violet-bg)}.pa24-tone-amber{--tone:var(--pa-amber);--tone-bg:var(--pa-amber-bg)}.pa24-tone-danger{--tone:var(--pa-danger);--tone-bg:var(--pa-danger-bg)}.pa24-tone-neutral{--tone:var(--pa-muted);--tone-bg:var(--pa-soft)}.pa24-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;background:var(--tone-bg);color:var(--tone);font-size:11px;font-weight:600;line-height:1.7;white-space:nowrap}
      .pa24-header{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:16px}.pa24-identity{display:flex;align-items:center;gap:12px}.pa24-brand{width:44px;height:44px;border-radius:11px;background:var(--pa-brand);color:#fff;display:inline-flex;align-items:center;justify-content:center}.pa24-brand svg{width:24px;height:24px}.pa24-title-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.pa24-tagline{color:var(--pa-muted);font-size:13px}
      
      .pa24-notice{display:flex;gap:10px;align-items:flex-start;padding:12px 15px;border:1px solid color-mix(in srgb,var(--tone) 16%,transparent);border-radius:12px;color:var(--tone);background:var(--tone-bg);font-size:12px;margin-bottom:20px}.pa24-notice>svg{margin-top:1px}.pa24-notice>div{flex:1;min-width:0}
      .pa24-error{padding:16px;border:1px solid var(--pa-danger);border-radius:12px;background:var(--pa-danger-bg);margin:14px 0;color:var(--pa-danger);overflow-wrap:anywhere}
      .pa24-tabs{display:flex;gap:6px;border-bottom:1px solid var(--pa-line);margin:0 0 18px;overflow-x:auto;scrollbar-width:thin;padding:3px 0 10px}.pa24-tabs button{flex-shrink:0;min-height:40px;padding:8px 12px;background:transparent;border:1px solid transparent;border-radius:9px;color:var(--pa-muted);font-weight:500}.pa24-tabs button[aria-selected=true]{background:var(--tone-bg);color:var(--tone);font-weight:650}
      .pa24-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}.pa24-section-title{display:flex;align-items:center;gap:10px}.pa24-section-desc{margin-top:5px!important;color:var(--pa-muted);font-size:13px}
      .pa24-card{min-width:0;background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:16px;padding:16px 18px;margin-bottom:16px;box-shadow:var(--pa-shadow)}.pa24-card>h2{margin-bottom:10px}.pa24-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.pa24-grid>.pa24-card{margin:0}
      .pa24-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}.pa24-stat{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--pa-line);border-radius:14px;background:var(--pa-surface)}.pa24-stat strong{font-size:22px;line-height:1.2;font-weight:650;font-variant-numeric:tabular-nums}.pa24-stat-label{font-size:12px;color:var(--pa-muted);margin-bottom:4px}.pa24-stat small{font-size:11px;color:var(--pa-muted);margin-left:8px}
      .pa24-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:35px 18px}.pa24-empty>.pa24-icon-tile{width:64px;height:64px;border-radius:22px;margin-bottom:18px}.pa24-empty>.pa24-icon-tile svg{width:29px;height:29px}.pa24-empty h3{font-size:17px;margin:3px 0 8px}.pa24-empty p{max-width:440px;color:var(--pa-muted);font-size:13px}.pa24-empty .pa24-row{margin-top:18px;justify-content:center}
      .pa24-example{display:flex;align-items:center;gap:9px;padding:12px 16px;background:var(--pa-soft);border-radius:10px;font-size:12px;color:var(--pa-muted)}
      .pa24-dl{margin:0}.pa24-field{display:grid;grid-template-columns:120px minmax(0,1fr);gap:12px;padding:7px 0;border-bottom:1px solid var(--pa-line)}.pa24-field:last-child{border-bottom:0}.pa24-field dt{font-size:12px;color:var(--pa-muted);overflow-wrap:anywhere}.pa24-field dd{margin:0;font-size:13px;overflow-wrap:anywhere}
      .pa24-helper{border-radius:10px;padding:12px 14px;background:var(--pa-soft);color:var(--pa-muted);font-size:12px;margin-top:16px}
      .pa24-searchbar{display:flex;gap:8px;align-items:center;padding:14px;background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:12px;margin-bottom:14px}.pa24-search{position:relative;flex:1;min-width:120px}.pa24-search>svg{position:absolute;left:12px;top:12px;color:var(--pa-muted);width:18px;height:18px}.pa24-search input{padding-left:38px;background:var(--pa-soft);font-size:13px}
      .pa24-result-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 15px;font-size:12px;color:var(--pa-muted)}.pa24-memory-list{display:grid;gap:14px}.pa24-memory-card{background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:14px;overflow:hidden}.pa24-memory-body{padding:20px 22px}.pa24-memory-heading{display:flex;align-items:flex-start;gap:10px;justify-content:space-between}.pa24-memory-heading h3{overflow-wrap:anywhere}.pa24-memory-card .pa24-note{margin:15px 0;font-size:14px}.pa24-memory-source{display:flex;gap:6px;align-items:flex-start;font-size:11px;color:var(--pa-muted);overflow-wrap:anywhere}.pa24-memory-footer{padding:10px 22px;background:var(--pa-soft);border-top:1px solid var(--pa-line)}.pa24-memory-footer details{border:0;margin:0;padding:0}.pa24-memory-footer summary{min-height:26px;padding:0;font-size:11px}.pa24-page-nav{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:22px;font-size:12px;color:var(--pa-muted)}.pa24-page-nav button:first-child svg{transform:rotate(180deg)}
      .pa24-job{padding:18px 0;border-top:1px solid var(--pa-line)}.pa24-job:first-of-type{border-top:0;padding-top:0}.pa24-job .pa24-note{margin:10px 0}.pa24-job .pa24-meta{margin:6px 0}
      .pa24-ready{display:grid;gap:10px}.pa24-ready-item{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border:1px solid var(--pa-line);border-radius:12px}.pa24-ready-item>svg{margin-top:2px;color:var(--tone)}.pa24-ready-item>div{flex:1;min-width:0}
      .pa24-resource{padding:15px 0;border-bottom:1px solid var(--pa-line)}.pa24-resource:last-child{border:0;padding-bottom:0}.pa24-resource:first-child{padding-top:0}.pa24-resource p{margin-top:5px;font-size:12px;color:var(--pa-muted);overflow-wrap:anywhere}
      .pa24 details{border-top:1px solid var(--pa-line);margin-top:16px;padding-top:10px}.pa24 summary{cursor:pointer;color:var(--pa-muted);font-size:12px;min-height:32px;padding:5px 0}.pa24 pre{padding:14px;border:1px solid var(--pa-line);border-radius:10px;background:var(--pa-soft);white-space:pre-wrap;overflow-wrap:anywhere;max-height:400px;overflow:auto;font:11px/1.75 ui-monospace,SFMono-Regular,Consolas,monospace;margin:10px 0 0}
      .pa24-footer{display:flex;gap:8px;align-items:baseline;margin:26px 0 5px;padding-top:16px;border-top:1px solid var(--pa-line);font-size:11px;color:var(--pa-muted)}
      .pa24-cardgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:14px;align-items:stretch}
      .pa24-cap{position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:16px;padding:15px 16px 13px;box-shadow:var(--pa-shadow);transition:border-color .15s}
      .pa24-cap:hover{border-color:color-mix(in srgb,var(--tone) 45%,var(--pa-line))}
      .pa24-cap .pa24-icon-tile{width:34px;height:34px;border-radius:10px}.pa24-cap .pa24-icon-tile svg{width:17px;height:17px}
      .pa24-cap-head{display:flex;align-items:flex-start;gap:10px}
      .pa24-cap-title{flex:1;min-width:0}.pa24-cap-title b{display:block;font-size:14px;font-weight:650;color:var(--pa-ink)}.pa24-cap-title small{display:block;font-size:11px;color:var(--pa-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pa24-cap-body{flex:1;font-size:12.5px;line-height:1.7}
      .pa24-cap-kpi{display:flex;gap:18px;flex-wrap:wrap}.pa24-cap-kpi strong{display:block;font-size:19px;line-height:1.25;font-weight:650;color:var(--tone);font-variant-numeric:tabular-nums}.pa24-cap-kpi small{display:block;font-size:11px;color:var(--pa-muted)}
      .pa24-cap-line{display:flex;justify-content:space-between;gap:8px}.pa24-cap-line b{font-weight:600;color:var(--pa-ink)}
      .pa24-cap-foot{display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--pa-line);padding-top:10px}
      .pa24-cap-foot .pa24 button,.pa24-cap-foot button{min-height:30px;padding:4px 10px;font-size:12px;border-radius:8px}
      .pa24-cap-hidden{opacity:.55}
      .pa24-cap-hide{position:absolute;top:8px;right:8px;min-height:26px!important;padding:2px 9px!important;font-size:11px!important;display:none}
      .pa24-manage .pa24-cap-hide{display:inline-flex}.pa24-manage .pa24-cap{outline:1.5px dashed var(--pa-line);outline-offset:-6px}
      .pa24-next{display:flex;align-items:flex-start;gap:7px;font-size:11.5px;line-height:1.6;padding:8px 10px;border-radius:9px;background:var(--tone-bg);color:var(--tone)}
      .pa24-chip{display:none;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:99px;font-size:10px;font-weight:700;background:var(--pa-amber-bg);color:var(--pa-amber)}
      .pa24-chip.show{display:inline-flex}.pa24-chip.error{background:var(--pa-danger-bg);color:var(--pa-danger)}
      .pa24-detail-bar{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
      .pa24-form-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--pa-line)}.pa24-form-row:last-child{border-bottom:0}.pa24-form-row>label{font-size:12px;color:var(--pa-muted)}.pa24-form-row input[type=text],.pa24-form-row input[type=number],.pa24-form-row select{min-height:36px}
      .pa24-check{display:inline-flex;align-items:center;gap:6px;margin:0 16px 0 0;font-size:13px;min-height:32px;cursor:pointer}.pa24-check input{width:15px;height:15px;min-height:0}
      .pa24-form-actions{position:sticky;bottom:0;z-index:2;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;margin-top:16px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-surface);box-shadow:var(--pa-shadow)}
      .pa24-spin{animation:pa24-spin 1s linear infinite}@keyframes pa24-spin{to{transform:rotate(360deg)}}
      @container(max-width:880px){.pa24-header{align-items:flex-start}.pa24-tabs{gap:2px}.pa24-field{grid-template-columns:110px minmax(0,1fr)}}
      @container(max-width:620px){.pa24-header{flex-direction:column;gap:16px}.pa24 h1{font-size:19px}.pa24-grid{grid-template-columns:1fr}.pa24-stats{gap:8px}.pa24-stat{padding:12px;gap:8px}.pa24-stat>.pa24-icon-tile{display:none}.pa24-card{padding:18px}}
      .pa24-settings{padding:22px;height:auto;min-width:0;width:100%}
      .pa24-settings-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}
      .pa24-settings-brand{width:34px;height:34px;border-radius:9px}
      @media(max-width:760px){.pa24{padding:20px 16px}.pa24 button{min-height:44px}.pa24-tabs button{min-height:44px}.pa24 summary{min-height:40px;display:list-item}}
      @media(prefers-reduced-motion:reduce){.pa24 *{animation:none!important;transition:none!important}}
    `;
    return {
      inject: ['slots', 'locale', 'connection', 'uiWorkspace', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('pa24', { zh, en }));
        const t = ctx.locale.bind('pa24');
        // F27: 内联双语通道——dsh locale 服务的 resolveText 按当前语言与回退
        // 链解析 {zh,en}；与字符串同址维护，避免大字典间接层。
        const L = (zhText, enText) => ctx.locale.resolveText({ zh: zhText, en: enText });
        const statusBadge = (tier, label) => { const item = STATUS[tier] || STATUS.unchecked; return badge(label || t(item[0]), item[1], item[2]); };
        const rpc = async (endpoint, payload = {}, signal) => {
          const response = await fetch('./api/24pa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, payload }), signal });
          if (!response.ok) throw new Error('dsh HTTP ' + response.status);
          const result = await response.json();
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        };
        const date = (value, timeZone) => (value ? new Date(value).toLocaleString('zh-CN', { timeZone: timeZone || 'Asia/Shanghai', hour12: false }) : L('尚无记录', 'No record yet'));
        const badgeOf = status => badge(t(status) || status, ...(statusStyle[status] || ['neutral', 'info']));
        const fields = items => h('dl', { className: 'pa24-dl' }, items.map(([label, value]) => h('div', { key: String(label), className: 'pa24-field' }, h('dt', null, label), h('dd', null, value ?? L('未配置', 'Not configured')))));
        const sectionHead = (name, title, description, action, tone = 'neutral') => h('div', { className: 'pa24-section-head' }, h('div', null, h('div', { className: 'pa24-section-title' }, h('span', { className: 'pa24-tone-' + tone, style: { color: 'var(--tone)' } }, icon(name)), h('h2', null, title)), description && h('p', { className: 'pa24-section-desc' }, description)), action);
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
          const categories = { preference: [L('个人偏好', 'Preference'), 'neutral'], fact: [L('事实', 'Fact'), 'neutral'], project: [L('项目', 'Project'), 'blue'], decision: [L('决定', 'Decision'), 'neutral'] };
          const search = () => { setOffset(0); setQuery(draft.trim()); setRetry(v => v + 1); };
          const clear = () => { setDraft(''); setQuery(''); setOffset(0); };
          const data = view.data;
          const button = (name, label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, icon(name), label);
          return h('section', null,
            sectionHead('memory', L('结构化记忆', 'Structured memory'), L('记住你的偏好与背景，让每次交办更有默契。', 'Your preferences and background, remembered so every handoff lands better.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新记忆', 'Refresh memories'), () => setRetry(v => v + 1), { disabled: view.status === 'loading', className: 'pa24-quiet' }), button('chat', L('通过对话维护记忆', 'Manage memories in chat'), openRobot)), 'neutral'),
            h('div', { className: 'pa24-searchbar' },
              h('div', { className: 'pa24-search' }, icon('search'), h('input', { value: draft, placeholder: L('搜索正文、主题或来源…', 'Search content, topic, or source…'), 'aria-label': L('筛选记忆', 'Filter memories'), onChange: e => setDraft(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) search(); } })),
              button('search', L('筛选', 'Filter'), search), (draft || query) && button('close', L('查看全部', 'Show all'), clear, { className: 'pa24-quiet' })),
            view.status === 'loading' && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取记忆内容…', 'Reading memories…')),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('div', { className: 'pa24-row' }, icon('alert'), h('strong', null, L('记忆读取失败', 'Failed to read memories'))), h('p', null, view.error), h('p', null, L('请在 dsh 的24私助会话中检查记忆文件，修复后重试。', 'Check the memory file in the 24PA dsh session and retry after fixing.')), button('refresh', L('重试读取', 'Retry read'), () => setRetry(v => v + 1))),
            data && h('div', null,
              h('div', { className: 'pa24-result-meta', role: 'status' }, h('span', null, L('共 ' + data.total + L(' 条记忆', ' memories') + (query ? L(' · 匹配 ', ' · ') + data.matched + L(' 条', ' matched') : ''), data.total + (query ? ' memories (' + data.matched + ' matched)' : ' memories total'))), h('span', null, L('记忆版本 ' + data.revision, 'Memory revision ' + data.revision))),
              data.total === 0 ? h('div', { className: 'pa24-card' }, empty('memory', 'neutral', L('从「记住这件事」开始', 'Start with “remember this”'), L('还没有保存的记忆。在 dsh 的24私助会话告诉它你的偏好或项目背景，保存后会直接显示在这里。', 'Nothing saved yet. Tell the 24PA dsh session your preferences or project background and they will show up here.'),
                button('chat', L('告诉24私助我的偏好', 'Tell 24PA my preferences'), openRobot, { className: 'pa24-primary' })),
                h('div', { className: 'pa24-example' }, icon('chat', { width: 16, height: 16 }), L('试着说：“记住，我希望会议之间留 15 分钟。”', 'Try: “Remember, I want 15 minutes between meetings.”'))) :
              data.matched === 0 ? h('div', { className: 'pa24-card' }, empty('search', 'neutral', L('没有找到匹配的记忆', 'No matching memories'), L('试试更短的关键词，或清空筛选查看所有记忆。', 'Try shorter keywords, or clear the filter to see everything.'), button('close', L('清空筛选', 'Clear filter'), clear))) :
              h('div', { className: 'pa24-memory-list' }, data.records.map(r => {
                const [category, tone] = categories[r.category] || [r.category, 'neutral'];
                return h('article', { key: r.id, className: 'pa24-memory-card' },
                  h('div', { className: 'pa24-memory-body' },
                    h('div', { className: 'pa24-memory-heading' }, h('div', { className: 'pa24-row' }, badge(category, tone), h('h3', null, r.topic || L('未设置主题', 'No topic set'))), badge(r.status === 'confirmed' ? L('已确认', 'Confirmed') : L('待核实', 'Unverified'), r.status === 'confirmed' ? 'blue' : 'amber', r.status === 'confirmed' ? 'check' : 'clock')),
                    h('div', { className: 'pa24-note' }, r.content),
                    h('div', { className: 'pa24-row pa24-between' },
                      h('div', { className: 'pa24-memory-source' }, icon('note', { width: 13, height: 13 }), h('span', null, L('来源：', 'Source: ') + r.source)),
                      h('time', { className: 'pa24-meta', dateTime: r.updatedAt }, date(r.updatedAt, workspace.config ? workspace.config.timeZone : 'Asia/Shanghai')))),
                  h('div', { className: 'pa24-memory-footer' }, h('details', null, h('summary', null, L('修订依据与 JSON', 'Revision basis & JSON')), h('p', { className: 'pa24-meta' }, L('修订依据：', 'Reason: ') + r.reason), h('p', { className: 'pa24-meta' }, L('修改会话：', 'Updated by: ') + r.updatedBy), r.validUntil && h('p', { className: 'pa24-meta' }, L('有效期至：', 'Valid until: ') + r.validUntil), h('pre', null, JSON.stringify(r, null, 2)))));
              })),
              data.matched > data.limit && h('nav', { className: 'pa24-page-nav', 'aria-label': L('记忆分页', 'Memory pagination') }, button('chevron', L('上一页', 'Previous'), () => setOffset(Math.max(0, data.offset - data.limit)), { disabled: data.offset === 0 }), h('span', null, L('第 ' + (Math.floor(data.offset / data.limit) + 1) + ' / ' + Math.ceil(data.matched / data.limit) + L(' 页', ''), 'Page ' + (Math.floor(data.offset / data.limit) + 1) + ' / ' + Math.ceil(data.matched / data.limit))), button('chevron', L('下一页', 'Next'), () => setOffset(data.offset + data.limit), { disabled: data.offset + data.limit >= data.matched }))),
            h('details', null, h('summary', null, L('存储位置与维护方式', 'Storage & maintenance')), h('p', { className: 'pa24-meta' }, (workspace.path || '') + '/.24pa/memory.json'), h('p', { className: 'pa24-meta' }, L('通过 dsh 的24私助会话新增、更正、删除和整理（变更集可撤销）；整理仅由你发起。', 'Add, correct, remove, and tidy through the 24PA dsh session (changesets are undoable); tidying is always owner-initiated.'))));
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
            if (!v || !v.verifyResult) return badge(L('尚未核验', 'Not verified'), 'neutral', 'info');
            if (v.verifyResult === 'matches') return badge(L('内容一致', 'Content matches'), 'blue', 'check');
            if (v.verifyResult === 'changed') return badge(L('文档已修改', 'Document changed'), 'amber', 'alert');
            return badge(L('核验异常', 'Verification failed'), 'danger', 'alert');
          };
          return h('section', null,
            sectionHead('pen', L('手写审核', 'Handwriting review'), L('拍照笔记的待审版本、疑点定位与催办都在这里；批准或退回请在飞书审核卡上完成。', 'Pending versions, doubt locations, and follow-up nudges for photographed notes; approve or return on the Feishu review card.'),
              button('refresh', L('刷新队列', 'Refresh queue'), () => setRetry(v => v + 1), { disabled: view.status === 'loading', className: 'pa24-quiet' }), 'danger'),
            h('div', { className: 'pa24-example' }, icon('shield', { width: 16, height: 16 }), L('审核裁决只由你在飞书卡片上作出；本页面为只读查阅，不提供网页批准按钮。', 'Review verdicts are made by you on the Feishu card only; this page is read-only and has no approve button.')),
            view.status === 'loading' && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取审核队列…', 'Reading the review queue…')),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('div', { className: 'pa24-row' }, icon('alert'), h('strong', null, L('审核队列读取失败', 'Failed to read the review queue'))), h('p', null, view.error), button('refresh', L('重试读取', 'Retry read'), () => setRetry(v => v + 1))),
            view.status === 'ready' && (view.data.count === 0
              ? h('div', { className: 'pa24-card' }, empty('check', 'blue', L('没有等待审核的笔记', 'No notes awaiting review'), L('拍照整理后的待审版本会出现在这里；审核完成或退回后自动移出。', 'Pending versions from photographed notes appear here and move out once reviewed or returned.'), button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot)))
              : view.data.items.map(item => h('article', { key: item.noteId, className: 'pa24-job' },
                  h('div', { className: 'pa24-row pa24-between' }, h('h3', null, item.title || item.noteId), badge(t(item.noteStatus) || item.noteStatus, ...(item.noteStatus === 'awaiting_review' ? ['amber', 'clock'] : item.noteStatus === 'needs_rereview' ? ['danger', 'alert'] : ['amber', 'pen']))),
                  item.latestVersion && h('div', { className: 'pa24-row' }, badge('v' + item.latestVersion.version + ' ' + (t(item.latestVersion.status) || item.latestVersion.status), item.latestVersion.status === 'pending_review' ? 'amber' : 'neutral', 'shield'), verifyBadge(item.latestVersion)),
                  h('p', { className: 'pa24-meta' }, item.pages + L(' 页原稿 · 指纹 ', ' pages · fingerprint ') + (item.latestVersion ? item.latestVersion.fingerprint : '—') + (item.latestVersion && item.latestVersion.verifiedAt ? L(' · 上次核验 ', ' · last verified ') + date(item.latestVersion.verifiedAt, tz) : '')),
                  item.reminders.length > 0 && h('p', { className: 'pa24-meta' }, L('催办：', 'Reminders: ') + item.reminders.map(r => (t('reminder' + (r.kind === 'daily' ? 'Daily' : 'Once')) || r.kind) + ' ' + (t('reminder' + r.status.charAt(0).toUpperCase() + r.status.slice(1)) || r.status) + (r.status === 'pending' ? L('，下次 ', ', next ') + date(r.remindAt, tz) : '')).join(L('；', '; '))),
                  item.latestVersion && item.latestVersion.docUrl && h('a', { className: 'pa24-link-button', href: item.latestVersion.docUrl, target: '_blank', rel: 'noreferrer' }, icon('external'), L('打开飞书文档', 'Open Feishu doc')),
                  h('p', { className: 'pa24-meta' }, L('需要稍后提醒、暂停催办或重新发布候选时，直接告诉24私助。', 'For a later nudge, pausing follow-ups, or republishing a candidate, just tell 24PA.'))))));
        }

        // F17: Panel 与 SettingsSection 共用的动作外壳（busy/error/run/button）。
        // reloadAfter：动作成功后立即重读 snapshot——设置分区无轮询需要；
        // 面板有 2.5s 轮询，保持原行为不重读。
        // 打开固定本地助理会话——面板与设置分区共用。
        const openRobot = async () => { const r = await rpc('action', { type: 'robot.open' }); ctx.uiWorkspace.openSession(r.sessionId); };
        function usePanelActions({ reloadAfter } = {}) {
          const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
          const run = async fn => { setBusy(true); setError(''); try { const r = await fn(); if (reloadAfter) await reloadAfter(); return r; } catch (e) { setError(e.message); return null; } finally { setBusy(false); } };
          const button = (name, label, fn, props = {}) => h('button', { type: 'button', disabled: busy, onClick: () => void run(fn), ...props }, name && icon(name), label);
          return { busy, error, run, button };
        }

        // F17: 工作区管理两张卡（绑定/切换 + 生效配置）独立成组件，
        // 面板 workspace tab 与设置分区共用；动作走既有 RPC，不新增端点。
        // path 为受控值由父级持有，面板侧保证切 tab 不丢已选未绑定的目录。
        function WorkspaceCards({ snapshot, busy, button, openRobot, path, onPathChange }) {
          const workspace = snapshot.workspace, config = workspace ? workspace.config : null;
          const enabledNames = (config && config.enabledWorkers ? config.enabledWorkers : []).map(w => ({ memo: L('备忘整理', 'Memo worker') }[w] || w)).join('、') || L('无', 'None');
          return h(React.Fragment, null,
            h('section', { className: 'pa24-card' },
              sectionHead('folder', L('当前工作区', 'Current workspace'), L('在 dsh 添加服务器目录，再选择绑定。空目录首次绑定时生成 AGENTS.md。', 'Add the server directory in dsh, then bind. An empty directory gets an AGENTS.md on first bind.')),
              h('label', { style: { display: 'block', margin: '18px 0 12px' } },
                h('span', { className: 'pa24-meta' }, L('选择 dsh 工作区', 'Choose a dsh workspace')),
                h('select', { value: path, onChange: e => onPathChange(e.target.value), style: { marginTop: 6 } },
                  h('option', { value: '' }, L('选择一个工作区…', 'Pick a workspace…')),
                  (snapshot.availableWorkspaces || []).map(w => h('option', { value: w.path, key: w.id }, w.title + ' · ' + w.path)))),
              button('folder', L('绑定所选工作区', 'Bind selected workspace'), () => rpc('action', { type: 'workspace.bind', path }), { disabled: busy || !path, className: 'pa24-primary' }),
              h('div', { className: 'pa24-helper' }, L('当前目录', 'Current directory'), h('p', { className: 'pa24-meta' }, workspace ? workspace.path : L('未绑定', 'Not bound')))),
            h('section', { className: 'pa24-card' },
              sectionHead('code', L('当前生效配置', 'Effective configuration'), L('配置源是工作区 AGENTS.md；凭据值由服务器环境或 CLI 授权保存。', 'The source is the workspace AGENTS.md; secret values live in the server environment or CLI auth.'),
                h('div', { className: 'pa24-row' },
                  button('chat', L('通过对话修改配置', 'Change config in chat'), openRobot),
                  button('refresh', L('重载 AGENTS.md', 'Reload AGENTS.md'), () => rpc('action', { type: 'workspace.reload' }), { className: 'pa24-quiet' })), 'blue'),
              workspace && fields([
                [L('固定飞书 profile', 'Feishu CLI profile'), config ? config.larkProfile : null],
                [L('时区', 'Time zone'), config ? config.timeZone : null],
                [L('同时处理数', 'Parallel workers'), config ? config.maxWorkers : null],
                [L('已启用 Worker', 'Enabled workers'), enabledNames],
                [L('飞书接入会话', 'Feishu access session'), workspace.accessSessionId || L('未建立', 'Not created')],
                [L('本地助理会话', 'Local assistant session'), workspace.localSessionId || L('未建立', 'Not created')],
              ]),
              workspace && workspace.configError && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, L('当前生效配置保留上一有效版本', 'Keeping the last valid configuration')), h('p', null, workspace.configError)),
              h('details', null, h('summary', null, L('查看完整配置 JSON', 'View full configuration JSON')), h('pre', null, JSON.stringify(config, null, 2)))));
        }

        function HealthBlock() {
          const [view, setView] = React.useState({ status: 'idle', data: null, error: '' });
          const load = () => {
            setView({ status: 'loading', data: null, error: '' });
            void rpc('health', {}).then(data => setView({ status: 'ready', data, error: '' })).catch(error => setView({ status: 'error', data: null, error: error.message }));
          };
          const badgeOfCap = c => statusBadge(['ok', 'warn', 'error'].includes(c.state) ? c.state : 'unchecked');
          const button = (name, label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, icon(name), label);
          return h('section', null,
            sectionHead('pulse', L('健康与预算', 'Health & budget'), L('能力可用性、同步新鲜度与本 Host 的投入统计；凭据不进入诊断。', 'Capability availability, sync freshness, and this host’s usage; secrets never enter diagnostics.'),
              h('div', { className: 'pa24-row' }, button('refresh', view.status === 'idle' ? L('读取健康状态', 'Read health status') : L('刷新', 'Refresh'), load, { disabled: view.status === 'loading', className: 'pa24-quiet' })), 'blue'),
            view.status === 'loading' && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取健康状态…', 'Reading health status…')),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('div', { className: 'pa24-row' }, icon('alert'), h('strong', null, L('健康状态读取失败', 'Failed to read health status'))), h('p', null, view.error), button('refresh', L('重试', 'Retry'), load)),
            view.status === 'ready' && h('div', { className: 'pa24-card' },
              h('div', { className: 'pa24-ready' }, (view.data.capabilities ?? []).map(c => h('div', { key: c.id, className: 'pa24-ready-item pa24-tone-' + (c.state === 'ok' ? 'blue' : c.state === 'warn' ? 'amber' : 'danger') }, icon(c.state === 'ok' ? 'check' : 'alert', { width: 17, height: 17 }), h('div', null, h('div', { className: 'pa24-row pa24-between' }, h('strong', null, c.id), badgeOfCap(c)), h('p', { className: 'pa24-meta' }, c.message))))),
              view.data.usage && h('div', { style: { marginTop: 14 } }, fields([
                [L('模型轮次', 'Model turns'), view.data.usage.modelTurns], [L('输入笔记页', 'Note pages in'), view.data.usage.notePagesInput], [L('生成裁片', 'Crops generated'), view.data.usage.noteCrops],
                [L('发送队列', 'Outbox queued'), view.data.usage.outboxQueued], [L('结果未知', 'Unknown results'), (view.data.usage.outboxUnknown ?? 0) + (view.data.usage.operationsUnknown ?? 0)],
                [L('发送延迟 p50/p95', 'Outbox latency p50/p95'), (view.data.usage.outboxLatencyMs?.p50 ?? '—') + ' / ' + (view.data.usage.outboxLatencyMs?.p95 ?? '—') + ' ms'],
              ]), h('p', { className: 'pa24-meta' }, view.data.usage.note)),
              view.data.dataFlow && h('details', null, h('summary', null, L('数据流与保留披露', 'Data flow & retention')), fields([
                [L('模型输入', 'Model input'), view.data.dataFlow.modelInput], [L('额外日志', 'Extra logs'), view.data.dataFlow.extraLogs], [L('保留期限', 'Retention'), view.data.dataFlow.retention], [L('凭据', 'Secrets'), view.data.dataFlow.secrets],
              ])),
              view.data.degraded && h('div', { className: 'pa24-example' }, icon('info', { width: 16, height: 16 }), view.data.degraded.modelDown + ' ' + view.data.degraded.pgDown)));
        }

        // ---- F26: 能力卡片体系（原型 prototypes/pa24-card-panel v0.3 裁决）----
        // 一级导航＝三分类 tab；卡片＝内容单元：元数据＋tier（角标聚合的纯函数）
        // ＋body（摘要）＋detail（二级详情，原视图平移）。注册即生卡。
        const CATEGORY_TABS = [['biz', 'grid', 'blue'], ['access', 'plug', 'green'], ['system', 'shield', 'violet']];
        const CARD_HIDDEN_KEY = 'pa24.panelCards.hidden';
        const readHiddenPrefs = () => { try { return JSON.parse(localStorage.getItem(CARD_HIDDEN_KEY)) || {}; } catch (e) { return {}; } };
        const writeHiddenPrefs = prefs => { try { localStorage.setItem(CARD_HIDDEN_KEY, JSON.stringify(prefs)); } catch (e) { /* 无痕模式等场景静默降级为会话内记忆 */ } };
        // 面板级一次性补充数据（快照之外的三个只读源），手动刷新/重绑工作区时重取；
        // 卡片 tier 依赖它们做角标聚合，失败按「尚未检查」降级，不阻塞渲染。
        const useExtra = (workspacePath, tick) => {
          const [view, setView] = React.useState({ status: 'loading', data: null });
          React.useEffect(() => {
            const abort = new AbortController();
            // 重取时保留上一份数据，卡片不闪「读取中…」；失败降级沿用旧值。
            setView(v => ({ status: 'loading', data: v.data }));
            const out = {};
            void Promise.all([
              rpc('notes.queue', {}, abort.signal).then(r => { out.review = r; }).catch(() => {}),
              rpc('memory', { query: '', offset: 0 }, abort.signal).then(r => { out.memory = r; }).catch(() => {}),
              rpc('health', {}, abort.signal).then(r => { out.health = r; }).catch(() => {}),
            ]).then(() => { if (!abort.signal.aborted) setView({ status: 'ready', data: out }); });
            return () => abort.abort();
          }, [workspacePath, tick]);
          return view.data || {};
        };
        const capLine = (label, value) => h('div', { className: 'pa24-cap-line' }, h('span', { className: 'pa24-muted' }, label), h('b', null, value));
        const capKpi = items => h('div', { className: 'pa24-cap-kpi' }, items.map(([value, label]) => h('div', { key: label }, h('strong', null, value), h('small', null, label))));
        const nextStrip = text => h('div', { className: 'pa24-next' }, icon('info', { width: 13, height: 13 }), h('span', null, text));
        const readinessTier = (state, ids) => {
          const rows = (state.readiness?.items || []).filter(i => ids.includes(i.id));
          if (!rows.length) return 'unchecked';
          if (rows.some(i => i.state === 'error')) return 'error';
          if (rows.some(i => i.state !== 'ok')) return 'warn';
          return 'ok';
        };
        // 全应用健康聚合（用户 2026-10-11 裁决：一键检查含主动平台探测）：
        // readiness 六项＋health capabilities＋消息通道，任一 error→需处理。
        const healthAggregate = ({ state, extra }) => {
          const rows = [];
          for (const item of (state.readiness?.items || [])) rows.push(item.state);
          for (const cap of (extra.health?.capabilities || [])) rows.push(cap.state);
          if (state.transport) rows.push(state.transport.connected ? 'ok' : (state.workspace && state.workspace.config && state.workspace.config.mode === 'feishu' ? 'error' : 'warn'));
          if (!rows.length) return { tier: 'unchecked', ok: 0, warn: 0, error: 0 };
          const ok = rows.filter(x => x === 'ok').length, warn = rows.filter(x => x === 'warn').length, error = rows.filter(x => x === 'error').length;
          return { tier: error > 0 ? 'error' : warn > 0 ? 'warn' : 'ok', ok, warn, error };
        };
        const lastActiveCheck = state => {
          const times = [state.diagnostics && state.diagnostics.checkedAt, state.wecom && state.wecom.checkedAt].filter(Boolean).map(x => new Date(x).getTime());
          return times.length ? new Date(Math.max(...times)) : null;
        };
        const wecomChannelsOn = config => !!(config && ['calendarChannel', 'todoChannel', 'notifyChannel'].some(k => config[k] === 'wecom'));
        const wecomTier = config => (wecomChannelsOn(config) ? 'ok' : 'unchecked');
        const qwennoteConfigured = config => !!(config && (config.extraLocalTools || []).some(x => String(x).startsWith('mcp__qwennote__')));
        const extraToolCap = extra => (extra.health?.capabilities || []).find(c => c.id === 'extra-local-tools');

        // 二级详情：原 work tab 的统计与事项列表（运行就绪移入系统维护）。
        function WorkDetail({ state, button, busy, workspace, openRobot }) {
          const items = state.work || [];
          const active = items.filter(j => ['accepted', 'queued', 'running'].includes(j.status));
          const roleNames = { memo: L('备忘整理', 'Memo worker') };
          const stats = [
            ['pulse', 'blue', L('正在处理', 'In progress'), active.length, L('含排队事项', 'incl. queued')],
            ['check', 'blue', L('已完成', 'Completed'), items.filter(j => j.status === 'completed').length, L('历史事项', 'past items')],
            ['note', 'neutral', L('备忘已保存', 'Memos saved'), (state.memos ?? items.filter(j => j.role === 'memo' && j.status === 'completed')).length, L('随手记与资料', 'quick notes & material')],
          ];
          const jobCards = items.length
            ? items.map(j => h('article', { className: 'pa24-job', key: j.id },
                h('div', { className: 'pa24-row pa24-between' }, h('h3', null, j.title), badgeOf(j.status)),
                h('p', { className: 'pa24-meta' }, (j.origin === 'local' ? L('dsh 会话', 'dsh session') : L('飞书', 'Feishu')) + ' · ' + (roleNames[j.role] || j.role)),
                j.progress && h('p', { className: 'pa24-note' }, j.progress),
                j.result && h('details', null, h('summary', null, L('查看处理结果', 'View result')), h('div', { className: 'pa24-note' }, j.result)),
                j.child_session_id && button('external', L('查看 Worker 会话', 'Open worker session'), () => ctx.uiWorkspace.openSession({ childSessionId: j.child_session_id, parentSessionId: j.parent_session_id, mode: 'continuable' }), { className: 'pa24-quiet' }),
                h('p', { className: 'pa24-meta' }, L('事项编号：' + j.id, 'Item ' + j.id))))
            : [h(React.Fragment, { key: 'empty' },
                empty('chat', 'blue', L('下一件事，交给24私助', 'Hand the next thing to 24PA'), L('在飞书或这里发一段话，机器人会安排合适的 Worker，并把进度与结果带回来。', 'Send a message here or on Feishu; the bot picks the right worker and brings back progress and results.'),
                  [button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot, { key: 'chat', className: 'pa24-primary', disabled: busy || !workspace })]),
                h('div', { className: 'pa24-example' }, icon('info', { width: 16, height: 16 }), L('可以说：“记一下：下周讨论新的合作方向。”', 'Try: “Note: discuss the new partnership direction next week.”')))];
          return h('div', null,
            h('div', { className: 'pa24-stats' },
              stats.map(([name, tone, label, value, hint]) =>
                h('div', { key: label, className: 'pa24-stat' }, tile(name, tone), h('div', null, h('div', { className: 'pa24-stat-label' }, label), h('strong', null, value), h('small', null, hint))))),
            h('section', { className: 'pa24-card' }, sectionHead('tasks', L('正在办理的事项', 'Items in flight'), L('委托、进度与结果，在这里一目了然。', 'Delegations, progress, and results at a glance.')), jobCards));
        }

        // 二级详情：运行就绪（原 work tab 区块移入系统维护分类）。
        function ReadinessDetail({ state }) {
          const readyItems = (state.readiness?.items || []).map(item => {
            const labels = { host: L('宿主', 'Host'), config: L('配置', 'Config'), postgres: L('业务账本', 'Ledger'), workspace: L('工作区', 'Workspace'), feishu: L('飞书接入', 'Feishu access'), sessions: L('固定会话', 'Fixed sessions') };
            const tier = item.state === 'ok' ? 'ok' : item.state === 'error' ? 'error' : 'warn';
            return h('div', { key: item.id, className: 'pa24-ready-item pa24-tone-' + STATUS[tier][1] },
              icon(STATUS[tier][2], { width: 17, height: 17 }),
              h('div', null,
                h('div', { className: 'pa24-row pa24-between' }, h('strong', null, labels[item.id] || item.id), statusBadge(tier)),
                h('p', { className: 'pa24-meta' }, item.message)));
          });
          return h('section', { className: 'pa24-card' }, sectionHead('pulse', L('运行就绪', 'Readiness'), L('配置、账本与接入的真实状态；不把进程在线当作全部就绪。', 'Real state of config, ledger, and access; process-up alone does not mean ready.')),
            h('div', { className: 'pa24-ready' }, readyItems));
        }

        // 二级详情：原 feishu tab 全量内容平移。
        function FeishuDetail({ state, busy, button, openRobot }) {
          const workspace = state.workspace, config = workspace ? workspace.config : null, tz = config ? config.timeZone : 'Asia/Shanghai';
          const check = state.diagnostics;
          const cli = check ? check.cli : null;
          const auth = check ? check.auth : null;
          const diagnosis = (item, configured = true) => !item
            ? statusBadge(configured ? 'unchecked' : 'missing')
            : statusBadge(item.state === 'ok' ? 'ok' : ['error', 'mismatch'].includes(item.state) ? 'error' : item.state === 'missing' ? 'missing' : 'warn');
          const pendingOutbox = String((state.outbox || []).filter(o => ['pending', 'sending', 'unknown'].includes(o.status)).length) + L(' 条', ' pending');
          const resourceRows = [['folder', L('文档目录', 'Docs folder'), config ? config.folderToken : null, 'folder'], ['tasklist', L('任务清单', 'Task list'), config ? config.tasklistId : null, 'tasks'], ['calendar', L('本人日历', 'Owner calendar'), config ? config.calendarId : null, 'calendar']].map(([id, label, value]) => {
            const resource = check && check.resources ? check.resources.find(r => r.id === id) : null;
            return h('div', { key: id, className: 'pa24-resource' },
              h('div', { className: 'pa24-row' },
                h('div', { style: { flex: 1, minWidth: 0 } }, h('h3', null, label), h('p', null, value || L('尚未配置', 'Not configured yet'))),
                diagnosis(resource, !!value)),
              resource ? h('p', null, resource.message) : null);
          });
          return h('div', { className: 'pa24-grid' },
            h('section', { className: 'pa24-card' },
              sectionHead('plug', L('飞书接入', 'Feishu access'), L('用自然语言配置，在这里查阅接入情况。', 'Configure in natural language; review the access state here.'),
                h('div', { className: 'pa24-row' },
                  button('refresh', busy ? L('检查中…', 'Checking…') : L('检查接入状态', 'Check access'), () => rpc('action', { type: 'connection.check' })),
                  button('chat', L('通过对话配置', 'Configure in chat'), openRobot)), 'blue'),
              fields([
                [L('固定 CLI profile', 'Feishu CLI profile'), badge(config ? config.larkProfile : L('未配置', 'Not configured'), 'neutral')],
                [L('接入模式', 'Mode'), config && config.mode === 'feishu' ? L('飞书模式', 'Feishu mode') : L('体验模式 · 未连接飞书', 'Demo · not connected to Feishu')],
                [L('上次检查', 'Last check'), check ? date(check.checkedAt, tz) : L('尚未检查，点击右上方按钮开始', 'Not checked yet — click the button above to start')],
              ]),
              h('div', { className: 'pa24-helper' }, L('可以说：“检查飞书接入，告诉我还缺什么。” 检查只读取，不创建飞书对象。', 'Try: “Check the Feishu access and tell me what is missing.” Checks are read-only and create no Feishu objects.'))),
            h('section', { className: 'pa24-card' },
              h('div', { className: 'pa24-row pa24-between' }, h('h2', null, L('机器人连接', 'Bot connection')), badge(state.transport && state.transport.connected ? L('长连接已启动', 'Connected') : L('未启动', 'Not started'), state.transport && state.transport.connected ? 'blue' : 'neutral', 'plug')),
              fields([
                [L('连接状态', 'Connection'), (state.transport && state.transport.message) || (state.transport && state.transport.connected ? L('长连接运行中（无报错）', 'Running (no errors)') : L('未启动', 'Not started'))],
                [L('最近收到本人消息', 'Last owner message in'), date(state.transport ? state.transport.lastReceivedAt : null, tz)],
                [L('最近发送获平台确认', 'Last send acknowledged'), date(state.transport ? state.transport.lastSentAt : null, tz)],
                [L('待发消息', 'Outbox pending'), pendingOutbox],
              ]),
              h('p', { className: 'pa24-helper' }, L('建议在飞书发一条 /24pa 实测收发；连接正常不代表消息一定送达，发送后以收发记录为准。', 'Send /24pa on Feishu to verify both directions; a healthy connection does not guarantee delivery — trust the send log.'))),
            h('section', { className: 'pa24-card' },
              h('div', { className: 'pa24-row pa24-between' }, h('h2', null, L('CLI 与用户授权', 'CLI & user auth')), diagnosis(auth)),
              fields([
                [L('安装状态', 'Install'), cli ? cli.message : L('尚未检查', 'Not checked')],
                [L('CLI 版本', 'CLI version'), cli ? cli.version : L('尚未检查', 'Not checked')],
                [L('用户授权', 'User auth'), auth ? auth.message : L('尚未检查', 'Not checked')],
                [L('CLI 用户', 'CLI user'), auth ? auth.userName : L('尚未取得', 'Not acquired')],
                [L('用户令牌', 'User token'), auth ? auth.tokenStatus : L('尚未确认', 'Unconfirmed')],
              ]),
              h('details', null, h('summary', null, L('路径与身份明细', 'Path & identity details')),
                fields([
                  [L('CLI 路径', 'CLI path'), cli ? h('span', { className: 'pa24-ellip', title: cli.path }, cli.path) : L('尚未检查', 'Not checked')],
                  [L('CLI open_id', 'CLI open_id'), auth ? h('span', { className: 'pa24-ellip', title: auth.openId }, auth.openId) : L('尚未取得', 'Not acquired')],
                  [L('配置主人', 'Configured owner'), config ? h('span', { className: 'pa24-ellip', title: config.ownerOpenId }, config.ownerOpenId) : L('未配置', 'Not configured')],
                ]))),
            h('section', { className: 'pa24-card' },
              sectionHead('folder', L('使用的飞书资源', 'Feishu resources in use'), L('检查结果仅代表可读性；写入由实际任务回执验证。', 'Checks prove readability only; writes are verified by real task receipts.')),
              resourceRows,
              h('details', null, h('summary', null, L('配置来源与生效时间', 'Source & effective time')),
                fields([[L('配置来源', 'Source'), (workspace ? workspace.path : '') + '/AGENTS.md'], [L('生效时间', 'Effective at'), date(workspace ? workspace.loadedAt : null, tz)], [L('文件与生效版本', 'File vs. effective version'), check && check.source ? check.source.message : L('尚未检查', 'Not checked')]]))));
        }

        // 二级详情：QwenNote 听记（F18 WP3 的面板落点，状态来自维护健康）。
        function MinutesDetail({ state, extra, button, openRobot }) {
          const config = state.workspace ? state.workspace.config : null;
          const cap = extraToolCap(extra);
          const configured = qwennoteConfigured(config);
          return h('div', null,
            sectionHead('note', L('QwenNote 听记', 'QwenNote minutes'), L('录音卡转写/纪要/速记经 mcp__qwennote__* 工具进入本地24私助会话（仅本地会话；飞书入口与 Worker 不放行）。', 'Recorder transcripts, minutes, and quick notes reach the local 24PA session via mcp__qwennote__* tools (local session only; the Feishu entry and workers stay excluded).'),
              h('div', { className: 'pa24-row' }, button('chat', L('通过对话配置', 'Configure in chat'), openRobot)), 'amber'),
            h('section', { className: 'pa24-card' },
              fields([
                [L('工作区放行', 'Workspace allowance'), configured ? (config.extraLocalTools || []).join(L('、', ', ')) : L('未配置（AGENTS.md 的 extraLocalTools）', 'Not configured (extraLocalTools in AGENTS.md)')],
                [L('通道健康', 'Channel health'), cap ? cap.message : L('尚无健康结论；在系统维护读取健康状态后显示', 'No health verdict yet — shows after reading health under System Maintenance')],
                [L('工具状态', 'Tool status'), cap ? statusBadge(['ok', 'warn', 'error'].includes(cap.state) ? cap.state : 'unchecked') : statusBadge('unchecked')],
              ]),
              nextStrip(L('首次接入：profile 配置 dsh-mcp-client 条目（serverName qwennote）→ 本人浏览器完成一次授权 → AGENTS.md 的 extraLocalTools 放行 mcp__qwennote__*。', 'First-time setup: add the dsh-mcp-client entry (serverName qwennote) to the profile → authorize once from your browser → allow mcp__qwennote__* via extraLocalTools in AGENTS.md.')),
              h('div', { className: 'pa24-helper' }, L('听记是按需读取的外部资料，不落业务账本；从中提炼的候选行动走既有审核与行动授权，不因来源是听记跳过确认。', 'Minutes are external material read on demand and never land in the ledger; candidate actions go through the existing review and action authorization — the source never skips confirmation.'))));
        }

        // F19：tts 引擎是否启用（多卡判断收敛一处；none/未配置都按关闭）。
        const voiceOn = config => !!config?.tts?.engine && config.tts.engine !== 'none';

        // 卡片注册表：tier 为纯函数（角标聚合复用同一结果）；label 可覆盖状态词。
        const CARDS = [
          {
            id: 'work', cat: 'biz', tone: 'blue', icon: 'grid', title: ['事项', 'Items'], sub: ['进行中的委派与等待', 'Delegations in flight and waiting'], action: ['查看事项', 'Open items'],
            tier: ({ state }) => (state.work || []).some(j => j.status === 'failed') ? 'warn' : 'ok',
            body: ({ state }) => {
              const items = state.work || [];
              return capKpi([
                [String(items.filter(j => ['accepted', 'queued', 'running'].includes(j.status)).length), L('进行中', 'Active')],
                [String(items.filter(j => j.status === 'waiting_input').length), L('等待本人', 'Waiting on you')],
                [String(items.filter(j => j.status === 'failed').length), L('未完成', 'Failed')],
              ]);
            },
            detail: helpers => h(WorkDetail, helpers),
          },
          {
            id: 'reminders', cat: 'biz', tone: 'amber', icon: 'clock', title: ['提醒', 'Reminders'], sub: ['账本触发 · 模型离线仍送达', 'Ledger-fired · delivered even with the model offline'], action: ['管理提醒', 'Manage reminders'],
            tier: ({ state }) => ((state.outbox || []).some(o => o.status === 'unknown') ? 'warn' : 'ok'),
            body: ({ state, config }) => {
              const pending = (state.outbox || []).filter(o => ['pending', 'sending'].includes(o.status)).length;
              return h('div', null, capLine(L('待发', 'Pending'), pending + L(' 条', '')), capLine(L('投递出口', 'Delivery'), config && config.notifyChannel === 'wecom' ? L('企微推送', 'WeCom push') : L('飞书', 'Feishu')));
            },
            detail: helpers => empty('clock', 'amber', L('提醒经对话管理', 'Reminders are managed in chat'), L('设置、稍后、暂停与休假都通过24私助会话办理；提醒由账本触发，模型离线也能按时送达。', 'Snooze, pause, and vacation are all handled in the 24PA session; the ledger fires reminders on time even with the model offline.'),
              [helpers.button('chat', L('与24私助对话', 'Chat with 24PA'), helpers.openRobot, { key: 'chat', className: 'pa24-primary' })]),
          },
          {
            id: 'review', cat: 'biz', tone: 'danger', icon: 'pen', title: ['手写审核', 'Handwriting review'], sub: ['待审文档与版本核验', 'Pending versions & verification'], action: ['打开审核', 'Open review'],
            tier: ({ extra }) => (extra.review ? (extra.review.count > 0 ? 'warn' : 'ok') : 'unchecked'),
            label: ({ extra }) => (extra.review && extra.review.count > 0 ? L('待审 ' + extra.review.count, extra.review.count + ' to review') : null),
            body: ({ extra }) => (extra.review && extra.review.count > 0
              ? h('div', null, capLine(L('待审版本', 'Awaiting review'), extra.review.count + L(' 份', '')), h('p', { className: 'pa24-meta' }, L('批准/退回在飞书审核卡上完成', 'Approve/return happens on the Feishu review card')))
              : h('p', { className: 'pa24-meta' }, L('拍照整理后的待审版本会出现在这里', 'Pending versions from photographed notes appear here'))),
            detail: helpers => (helpers.workspace ? h(ReviewView, { key: helpers.workspace.path, workspace: helpers.workspace, openRobot: helpers.openRobot }) : empty('pen', 'blue', L('尚未绑定工作区', 'No workspace bound'), L('在 dsh 设置的「24私助」分区绑定工作区后，手写审核队列会显示在这里。', 'Bind a workspace in the dsh settings “24PA” section and the review queue will show up here.'))),
          },
          {
            id: 'memory', cat: 'biz', tone: 'violet', icon: 'memory', title: ['结构化记忆', 'Structured memory'], sub: ['偏好 · 事实 · 项目背景', 'Preferences · facts · project background'], action: ['检索记忆', 'Search memories'],
            tier: ({ state }) => (state.workspace ? 'ok' : 'missing'),
            body: ({ extra }) => (extra.memory ? capLine(L('已保存', 'Stored'), extra.memory.total + L(' 条', '')) : h('p', { className: 'pa24-meta' }, L('读取中…', 'Loading…'))),
            detail: helpers => (helpers.workspace ? h(MemoryView, { key: helpers.workspace.path, workspace: helpers.workspace, openRobot: helpers.openRobot }) : empty('memory', 'violet', L('尚未绑定工作区', 'No workspace bound'), L('绑定工作区后，记忆会按确认状态显示在这里。', 'Once a workspace is bound, memories show up here with their confirmation status.'))),
          },
          {
            id: 'digest', cat: 'biz', tone: 'green', icon: 'pulse', title: ['晨报与复盘', 'Digest & retrospective'], sub: ['周期服务 · 原生定时唤醒 · 语音版', 'Scheduled services · native Schedule wake · voice'], action: ['调整计划', 'Adjust plans'],
            tier: () => 'unchecked',
            label: () => L('对话管理', 'Managed in chat'),
            body: helpers => h('p', { className: 'pa24-meta' }, L('晨报/晚间/每周回顾计划经24私助会话开启与调整', 'Morning/evening/weekly digest plans are enabled and adjusted in the 24PA session')
              + (voiceOn(helpers.config) ? L('；语音引擎 ' + helpers.config.tts.engine, '; voice engine ' + helpers.config.tts.engine) : '')),
            detail: helpers => {
              const tts = helpers.state?.tts, engine = helpers.config?.tts?.engine || 'none', on = voiceOn(helpers.config);
              const probe = tts?.probe?.result;
              const engineLine = engine === 'none'
                ? L('语音版未启用：在 AGENTS.md 配置块设置 tts.engine（melo 或 volcengine）。', 'Voice is off: set tts.engine (melo or volcengine) in the AGENTS.md config block.')
                : L(`语音引擎：${engine}${tts?.voice ? ' · ' + tts.voice : ''}`, `Voice engine: ${engine}${tts?.voice ? ' · ' + tts.voice : ''}`);
              return h('div', null,
                empty('pulse', 'green', L('周期服务经对话管理', 'Scheduled services are managed in chat'), L('对24私助说「开启晨报」或「调整每周回顾时间」即可；开启语音版后到点先送达语音、紧跟全文文本。', 'Say “enable the morning digest” or “move the weekly retrospective”; with voice on, the audio lands first, then the full text.'),
                  [helpers.button('chat', L('与24私助对话', 'Chat with 24PA'), helpers.openRobot, { key: 'chat', className: 'pa24-primary' })]),
                h('div', { className: 'pa24-card', style: { marginTop: 14 } },
                  h('div', { className: 'pa24-note' },
                    h('p', { className: 'pa24-meta' }, engineLine),
                    probe ? h('p', { className: 'pa24-meta' }, (probe.ready ? L('引擎预检通过。', 'Engine probe passed.') : L('引擎预检未通过：', 'Engine probe failed: ') + (probe.problems || []).join('；'))) : h('p', { className: 'pa24-meta' }, L('尚未预检（引擎/密钥/依赖存在性只读检查）。', 'Not probed yet (read-only check of engine/key/dependencies).'))),
                  on && h('p', { className: 'pa24-meta', style: { marginTop: 8 } }, L('引擎与音色经 AGENTS.md 配置块 tts 字段调整（密钥环境变量见初始化指南「语音晨报/复盘」节）。', 'Engine and voice are set via the tts field of the AGENTS.md config block; the key environment variable is documented in the setup guide.')),
                  h('div', { className: 'pa24-row' },
                    helpers.button('refresh', L('检测语音引擎', 'Probe voice engine'), () => rpc('action', { type: 'tts.probe' }), { className: 'pa24-quiet' }),
                    on && helpers.button('bot', L('发一条测试语音', 'Send a test voice'), () => rpc('action', { type: 'tts.test' }), { key: 'test', className: 'pa24-quiet' }))));
            },
          },
          {
            id: 'feishu', cat: 'access', tone: 'green', icon: 'plug', title: ['飞书', 'Feishu'], sub: ['唯一收信入口 · 发件与审核卡', 'The only inbound · outbound & review cards'], action: ['接入详情', 'Access details'],
            tier: ({ state, config }) => (state.transport && state.transport.connected ? 'ok' : config && config.mode === 'feishu' ? 'warn' : 'unchecked'),
            body: ({ state }) => h('div', null,
              capLine(L('消息通道', 'Messaging'), state.transport && state.transport.connected ? L('长连接已启动', 'Connected') : L('未启动', 'Not started')),
              capLine(L('CLI 授权', 'CLI auth'), state.diagnostics && state.diagnostics.auth ? (state.diagnostics.auth.state === 'ok' ? L('有效', 'Valid') : state.diagnostics.auth.message) : L('尚未检查', 'Not checked'))),
            detail: helpers => h(FeishuDetail, helpers),
          },
          {
            id: 'wecom', cat: 'access', tone: 'amber', icon: 'bot', title: ['企业微信', 'WeCom'], sub: ['日程/待办第二渠道 · 单向推送', 'Second channel for calendar/todo · one-way push'], action: ['接入详情', 'Access details'],
            tier: ({ state }) => {
              const config = state.workspace ? state.workspace.config : null;
              if (!wecomTier(config) || !state.wecom) return 'unchecked';
              const states = (state.wecom.services || []).map(s => s.state);
              if (states.includes('error') || states.includes('unavailable')) return 'error';
              if (states.some(s => ['unauthorized', 'expired'].includes(s))) return 'warn';
              return 'ok';
            },
            label: ({ state }) => {
              const services = state.wecom ? state.wecom.services || [] : [];
              const bad = services.find(s => ['unauthorized', 'expired'].includes(s.state));
              return bad ? (bad.state === 'expired' ? L('已过期', 'Expired') : L('未授权', 'Unauthorized')) : null;
            },
            body: ({ state, config }) => h('div', null,
                capLine(L('启用渠道', 'Channels'), wecomChannelsOn(config) ? L('已启用', 'Enabled') : L('未启用', 'Not enabled')),
                capLine(L('上次检查', 'Last check'), state.wecom ? date(state.wecom.checkedAt, config ? config.timeZone : 'Asia/Shanghai') : L('尚未检查', 'Not checked'))),
            detail: helpers => h(WecomView, helpers),
          },
          {
            id: 'qwennote', cat: 'access', tone: 'amber', icon: 'note', title: ['QwenNote 听记', 'QwenNote minutes'], sub: ['录音卡转写 · 纪要 · 速记', 'Recorder transcripts · minutes · quick notes'], action: ['接入详情', 'Access details'],
            tier: ({ state, extra }) => {
              if (!qwennoteConfigured(state.workspace ? state.workspace.config : null)) return 'missing';
              const cap = extraToolCap(extra);
              if (!cap) return 'unchecked';
              return ['ok', 'warn', 'error'].includes(cap.state) ? cap.state : 'unchecked';
            },
            label: ({ state }) => (qwennoteConfigured(state.workspace ? state.workspace.config : null) ? null : L('待配置', 'Not configured')),
            body: ({ extra }) => {
              const cap = extraToolCap(extra);
              return h('div', null,
                capLine(L('放行结论', 'Allowance'), cap ? cap.message : L('尚未检查', 'Not checked')),
                nextStrip(L('首次接入需本人浏览器完成一次授权；完成后本卡转「正常」。', 'First-time setup needs a one-time authorization from your browser; the card turns OK once it lands.')));
            },
            detail: helpers => h(MinutesDetail, helpers),
          },
          {
            id: 'wiki', cat: 'access', tone: 'neutral', icon: 'folder', title: ['飞书知识库', 'Feishu wiki'], sub: ['备忘/待审文档落库节点', 'Where memos and pending docs land'], action: ['去配置', 'Configure'],
            tier: () => 'missing', label: () => L('未配置', 'Not configured'),
            body: () => h('p', { className: 'pa24-meta' }, L('配置知识库节点后，备忘与手写待审文档直接建入授权知识库（F22 交付后生效）。', 'Once a wiki node is configured, memos and pending docs are created directly in the authorized wiki (ships with F22).')),
            detail: helpers => empty('folder', 'neutral', L('知识库落库待配置', 'Wiki landing not configured'), L('该能力随 F22 交付：届时在工作区配置知识库节点后，这里显示节点与最近落库文档。', 'Arrives with F22: configure a wiki node in the workspace and this shows the node and recent documents.'),
              [helpers.button('chat', L('与24私助对话', 'Chat with 24PA'), helpers.openRobot, { key: 'chat', className: 'pa24-primary' })]),
          },
          {
            id: 'healthcheck', cat: 'system', tone: 'blue', icon: 'shield', title: ['全应用健康检查', 'Full-app health check'], sub: ['一键全量检查与总体结论', 'One-click full check & verdict'], action: ['全量报告', 'Full report'],
            tier: helpers => healthAggregate(helpers).tier,
            body: helpers => {
              const a = healthAggregate(helpers);
              const last = lastActiveCheck(helpers.state);
              const pending = a.warn + a.error;
              return h('div', null,
                capKpi([[String(a.ok), L('正常', 'OK')], [String(a.warn), L('待核验', 'Needs review')], [String(a.error), L('需要处理', 'Needs attention')]]),
                h('p', { className: 'pa24-meta', style: { marginTop: 6 } }, last ? L('最近主动检查 ' + date(last.toISOString(), helpers.tz), 'Last active check ' + date(last.toISOString(), helpers.tz)) : L('尚未执行主动检查', 'No active check yet')),
                pending > 0 && nextStrip(L('有 ' + pending + ' 项待核验或需要处理——打开全量报告查看 nextSteps。', pending + ' item(s) need review or attention — open the full report for next steps.')));
            },
            quick: helpers => helpers.button('refresh', helpers.busy ? L('检查中…', 'Checking…') : L('一键全量检查', 'Run full check'), () => helpers.run(helpers.runFullCheck), { disabled: helpers.busy }),
            detail: helpers => h(HealthReportDetail, { key: 'healthcheck', helpers }),
          },
          {
            id: 'storage', cat: 'system', tone: 'blue', icon: 'folder', title: ['账本与备份', 'Ledger & backup'], sub: ['业务状态唯一权威', 'The single source of business truth'], action: ['运行就绪', 'Readiness'],
            tier: ({ state }) => readinessTier(state, ['postgres', 'workspace']),
            label: ({ config }) => (config ? (config.storage === 'postgres' ? 'PostgreSQL' : 'SQLite') : null),
            body: ({ state }) => {
              const rows = (state.readiness?.items || []).filter(i => ['postgres', 'workspace'].includes(i.id));
              return h('div', null, rows.length ? rows.map(r => capLine(r.id === 'postgres' ? L('业务账本', 'Ledger') : L('工作区', 'Workspace'), r.state === 'ok' ? L('正常', 'OK') : r.message)) : h('p', { className: 'pa24-meta' }, L('读取中…', 'Loading…')));
            },
            detail: helpers => h(ReadinessDetail, helpers),
          },
          {
            id: 'config', cat: 'system', tone: 'blue', icon: 'code', title: ['参数配置', 'Configuration'], sub: ['六组 22 项 · 校验写回', '22 fields · validated write-back'], action: ['打开表单', 'Open form'],
            tier: ({ state }) => (state.workspace?.configError ? 'warn' : 'ok'),
            label: ({ config }) => (config ? (config.mode === 'feishu' ? L('飞书', 'Feishu') : 'demo') : null),
            body: ({ config, state }) => (config ? h('div', null,
              capLine(L('模式', 'Mode'), config.mode === 'feishu' ? L('飞书', 'Feishu') : 'demo'),
              capLine(L('渠道', 'Channels'), [config.calendarChannel, config.todoChannel, config.notifyChannel].map(v => (v === 'wecom' ? L('企微', 'WeCom') : L('飞书', 'Feishu'))).join(' / ')),
              capLine(L('存储', 'Storage'), config.storage === 'postgres' ? 'PostgreSQL' : 'SQLite'),
              state.workspace?.configError && h('p', { className: 'pa24-meta', style: { color: 'var(--pa-danger)' } }, state.workspace.configError))
              : h('p', { className: 'pa24-meta' }, L('尚未绑定工作区', 'No workspace bound'))),
            detail: helpers => h(ConfigFormDetail, { key: 'config', helpers }),
          },
          {
            id: 'budget', cat: 'system', tone: 'green', icon: 'pulse', title: ['模型与预算', 'Models & budget'], sub: ['路由 · 用量 · 健康判定', 'Routing · usage · health verdict'], action: ['健康报告', 'Health report'],
            tier: ({ extra }) => (extra.health ? 'ok' : 'unchecked'),
            body: ({ extra }) => (extra.health && extra.health.usage
              ? h('div', null, capLine(L('模型轮次', 'Model turns'), extra.health.usage.modelTurns ?? '—'), capLine(L('发送队列', 'Outbox queued'), extra.health.usage.outboxQueued ?? '—'))
              : h('p', { className: 'pa24-meta' }, L('读取中…', 'Loading…'))),
            detail: () => h(HealthBlock),
          },
        ];

        // 二级详情：全应用健康检查——聚合结论＋运行就绪＋能力健康报告。
        function HealthReportDetail({ helpers }) {
          const { state } = helpers;
          const a = healthAggregate(helpers);
          const last = lastActiveCheck(state);
          return h('div', null,
            sectionHead('shield', L('全应用健康检查', 'Full-app health check'), L('聚合运行就绪、能力健康与消息通道的总体结论；一键全量检查会对飞书（及启用的企微渠道）发起只读平台探测。', 'An aggregated verdict over readiness, capability health, and messaging; the one-click full check runs read-only probes against Feishu (and any enabled WeCom channel).'),
              h('div', { className: 'pa24-row' }, helpers.button('refresh', helpers.busy ? L('检查中…', 'Checking…') : L('一键全量检查', 'Run full check'), () => helpers.run(helpers.runFullCheck), { disabled: helpers.busy, className: 'pa24-primary' })), 'blue'),
            h('section', { className: 'pa24-card' },
              h('div', { className: 'pa24-stats' }, [
                ['check', 'blue', L('正常', 'OK'), a.ok, L('各域健康', 'healthy domains')],
                ['clock', 'amber', L('待核验', 'Needs review'), a.warn, L('有 nextSteps', 'has next steps')],
                ['alert', 'danger', L('需要处理', 'Needs attention'), a.error, L('阻断对应能力', 'blocks its capability')],
              ].map(([name, tone, label, value, hint]) =>
                h('div', { key: label, className: 'pa24-stat' }, tile(name, tone), h('div', null, h('div', { className: 'pa24-stat-label' }, label), h('strong', null, value), h('small', null, hint))))),
              h('p', { className: 'pa24-meta' }, last ? L('最近主动检查：' + date(last.toISOString(), helpers.tz), 'Last active check: ' + date(last.toISOString(), helpers.tz)) : L('尚未执行主动检查——点击右上方按钮开始（只读，不创建平台对象）。', 'No active check yet — click the button above to start (read-only, creates no platform objects).'))),
            h(ReadinessDetail, { state }),
            h(HealthBlock));
        }

        // F33/P60: 参数配置表单——六组 22 项。保存＝workspace.config-update
        // （服务端校验→AGENTS.md 唯一 json 块替换→重载）；失败保留输入并显示
        // 字段级错误。storage/version/密钥引用名不在表单（白名单在服务端强制）。
        function ConfigFormDetail({ helpers }) {
          const { config, state } = helpers;
          const VOICES = [
            ['zh_female_cancan_uranus_bigtts', L('知性灿灿（女声·晨报主推）', 'Cancan (female, digest pick)')],
            ['zh_female_zhixingnv_uranus_bigtts', L('知性女声（女声·沉稳）', 'Zhixing female (steady)')],
            ['zh_male_m191_uranus_bigtts', L('云舟（男声·稳重）', 'Yunzhou (male, steady)')],
            ['zh_female_vv_uranus_bigtts', L('Vivi（女声·元气）', 'Vivi (female, lively)')],
            ['zh_female_xiaohe_uranus_bigtts', L('小何（女声·甜）', 'Xiaohe (female, sweet)')],
          ];
          const WORKER_IDS = ['memo', 'tasks', 'calendar', 'reminders', 'handwriting', 'digest'];
          const KNOWN_EXTRA = ['subagent_codex', 'subagent_claude_code', 'mcp__qwennote__*'];
          const [form, setForm] = React.useState(() => ({
            mode: config?.mode ?? 'demo',
            larkProfile: config?.larkProfile ?? '',
            ownerOpenId: config?.ownerOpenId ?? '',
            timeZone: config?.timeZone ?? 'Asia/Shanghai',
            calendarChannel: config?.calendarChannel ?? 'feishu',
            todoChannel: config?.todoChannel ?? 'feishu',
            notifyChannel: config?.notifyChannel ?? 'feishu',
            folderToken: config?.folderToken ?? '',
            tasklistId: config?.tasklistId ?? '',
            calendarId: config?.calendarId ?? 'primary',
            maxWorkers: config?.maxWorkers ?? 2,
            enabledWorkers: [...(config?.enabledWorkers ?? ['memo'])],
            workerModels: JSON.parse(JSON.stringify(config?.workerModels ?? {})),
            extraKnown: KNOWN_EXTRA.filter(x => (config?.extraLocalTools ?? []).includes(x)),
            tts: { engine: config?.tts?.engine ?? 'none', voice: config?.tts?.voice ?? '', volcKeyEnv: config?.tts?.volcKeyEnv ?? '', meloDir: config?.tts?.meloDir ?? '' },
          }));
          const [saveState, setSaveState] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const set = (key, value) => { setForm(f => ({ ...f, [key]: value })); setSaveState(null); };
          const setTts = (key, value) => { setForm(f => ({ ...f, tts: { ...f.tts, [key]: value } })); setSaveState(null); };
          const authOpenId = state.diagnostics?.auth?.openId;
          const row = (label, control, hint) => h('div', { className: 'pa24-form-row' }, h('label', null, label), h('div', { style: { minWidth: 0 } }, control, hint && h('p', { className: 'pa24-meta', style: { marginTop: 2, marginBottom: 0 } }, hint)));
          const txt = (value, onSet, extra = {}) => h('input', { type: 'text', value, onChange: e => onSet(e.target.value), ...extra });
          const sel = (options, value, onSet) => h('select', { value, onChange: e => onSet(e.target.value) }, options.map(([v, l]) => h('option', { key: v, value: v }, l)));
          // 粘贴飞书链接自动提取末段 token（folder/tasklist 链接形态）。
          const extractToken = v => { const s = String(v).trim(); if (!s.includes('://')) return s; const q = s.match(/[?&](?:token|node_token|guid)=([A-Za-z0-9_-]{10,})/); if (q) return q[1]; const tail = s.split('?')[0].split('/').filter(Boolean).pop() || ''; return /^[A-Za-z0-9_-]{16,}$/.test(tail) ? tail : s; };
          const toggleIn = key => (value, on) => setForm(f => { const cur = new Set(f[key]); if (on) cur.add(value); else cur.delete(value); return { ...f, [key]: [...cur] }; });
          const wmGet = role => form.workerModels[role] || {};
          const wmSet = (role, patch) => { setForm(f => ({ ...f, workerModels: { ...f.workerModels, [role]: { ...wmGet(role), ...patch } } })); setSaveState(null); };
          const roleRows = [...new Set([...(form.enabledWorkers || []), ...Object.keys(form.workerModels)])].filter(r => WORKER_IDS.includes(r) || form.workerModels[r]);
          const save = async () => {
            setBusy(true);
            try {
              const models = {};
              for (const [role, route] of Object.entries(form.workerModels)) {
                const provider = String(route.provider || '').trim(), model = String(route.model || '').trim();
                if (provider || model) models[role] = { ...(provider ? { provider } : {}), ...(model ? { model } : {}), ...(route.simplePersona ? { simplePersona: true } : {}) };
              }
              const extra = [...new Set([...form.extraKnown, ...(config?.extraLocalTools ?? []).filter(v => !KNOWN_EXTRA.includes(v))])];
              await rpc('action', { type: 'workspace.config-update', config: {
                mode: form.mode, larkProfile: form.larkProfile.trim(), ownerOpenId: form.ownerOpenId.trim(), timeZone: form.timeZone.trim(),
                calendarChannel: form.calendarChannel, todoChannel: form.todoChannel, notifyChannel: form.notifyChannel,
                folderToken: form.folderToken.trim(), tasklistId: form.tasklistId.trim(), calendarId: form.calendarId.trim(),
                maxWorkers: Number(form.maxWorkers), enabledWorkers: form.enabledWorkers, workerModels: models, extraLocalTools: extra,
                tts: form.tts,
              } });
              setSaveState({ ok: true, message: L('已保存并重载生效。', 'Saved and reloaded.') });
            } catch (e) { setSaveState({ ok: false, message: (e && e.message) || String(e) }); }
            finally { setBusy(false); }
          };
          const tryVoice = async () => {
            setBusy(true);
            try { await rpc('action', { type: 'tts.test' }); setSaveState({ ok: true, message: L('试听已发送（使用当前已保存的配置）。', 'Sample sent (uses the saved config).') }); }
            catch (e) { setSaveState({ ok: false, message: L('试听失败：', 'Sample failed: ') + ((e && e.message) || e) }); }
            finally { setBusy(false); }
          };
          if (!config) return empty('code', 'blue', L('尚未绑定工作区', 'No workspace bound'), L('在 dsh 设置的「24私助」分区绑定工作区后可编辑参数。', 'Bind a workspace in the dsh settings “24PA” section to edit parameters.'));
          return h('div', null,
            sectionHead('code', L('参数配置', 'Configuration'), L('保存＝校验→写回 AGENTS.md 配置块→重载生效；工作规则不受影响，校验失败保留原文。', 'Save = validate → rewrite the AGENTS.md config block → reload; prose rules untouched, file kept on validation failure.')),
            saveState && h('div', { role: saveState.ok ? 'status' : 'alert', className: saveState.ok ? 'pa24-example' : 'pa24-error' }, icon(saveState.ok ? 'check' : 'alert', { width: 16, height: 16 }), h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, saveState.message)),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('模式与身份', 'Mode & identity')),
              row('mode', sel([['demo', 'demo'], ['feishu', 'feishu']], form.mode, v => set('mode', v)), form.mode === 'feishu' ? L('飞书应用凭据需在环境变量中就位（引用名见下方）。', 'Feishu app credentials must be present in env vars (see below).') : null),
              row('larkProfile', txt(form.larkProfile, v => set('larkProfile', v), { placeholder: 'default' }), L('lark-cli 固定 profile 名。', 'The pinned lark-cli profile name.')),
              row('ownerOpenId', h('div', { className: 'pa24-row', style: { flexWrap: 'nowrap' } },
                txt(form.ownerOpenId, v => set('ownerOpenId', v), { readOnly: true, style: { flex: 1, minWidth: 0 } }),
                h('button', { type: 'button', className: 'pa24-quiet', onClick: () => (authOpenId ? set('ownerOpenId', authOpenId) : setSaveState({ ok: false, message: L('先在「飞书接入」运行检查，取得授权身份后再应用。', 'Run the Feishu check first to obtain the authorized identity.') })) }, L('应用授权值', 'Apply authorized'))),
                L('身份字段只读；一键应用当前 CLI 授权的 open_id' + (authOpenId ? '' : '（尚未取得授权身份）') + '。', 'Identity is read-only; one-click apply of the CLI-authorized open_id' + (authOpenId ? '' : ' (not yet available)') + '.')),
              row('timeZone', h('div', null, txt(form.timeZone, v => set('timeZone', v), { placeholder: 'Asia/Shanghai', list: 'pa24-tz-list' }),
                h('datalist', { id: 'pa24-tz-list' }, ['Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'].map(z => h('option', { key: z, value: z })))), L('IANA 时区名，保存时即时校验。', 'IANA timezone name; validated on save.'))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('渠道选择', 'Channels')),
              row('calendarChannel', sel([['feishu', L('飞书', 'Feishu')], ['wecom', L('企微', 'WeCom')]], form.calendarChannel, v => set('calendarChannel', v))),
              row('todoChannel', sel([['feishu', L('飞书', 'Feishu')], ['wecom', L('企微', 'WeCom')]], form.todoChannel, v => set('todoChannel', v))),
              row('notifyChannel', sel([['feishu', L('飞书', 'Feishu')], ['wecom', L('企微', 'WeCom')]], form.notifyChannel, v => set('notifyChannel', v)), L('提醒与汇报的推送出口；企微为单向推送，收信仍在飞书。', 'Reminder & digest push outlet; WeCom is one-way, inbound stays on Feishu.'))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('飞书资源', 'Feishu resources')),
              row('folderToken', txt(form.folderToken, v => set('folderToken', v), { onBlur: e => set('folderToken', extractToken(e.target.value)), placeholder: L('粘贴文件夹链接或 token', 'Paste folder link or token') })),
              row('tasklistId', txt(form.tasklistId, v => set('tasklistId', v), { onBlur: e => set('tasklistId', extractToken(e.target.value)), placeholder: L('粘贴任务清单链接或 guid', 'Paste task-list link or guid') })),
              row('calendarId', txt(form.calendarId, v => set('calendarId', v), { placeholder: 'primary' }), L('默认 primary（本人日历）。', 'Defaults to primary (your calendar).'))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('运行参数', 'Runtime')),
              row('maxWorkers', h('input', { type: 'number', min: 1, max: 8, step: 1, value: form.maxWorkers, onChange: e => set('maxWorkers', e.target.value) }), L('1–8 的整数。', 'An integer from 1 to 8.')),
              row('enabledWorkers', h('div', { style: { minWidth: 0 } }, WORKER_IDS.map(r =>
                h('label', { key: r, className: 'pa24-check' }, h('input', { type: 'checkbox', checked: form.enabledWorkers.includes(r), onChange: e => toggleIn('enabledWorkers')(r, e.target.checked) }), r)))),
              row('workerModels', h('div', { style: { minWidth: 0 } },
                roleRows.length ? roleRows.map(role => h('div', { key: role, className: 'pa24-row', style: { flexWrap: 'nowrap', marginBottom: 6 } },
                  h('span', { style: { width: 86, fontSize: 12, color: 'var(--pa-muted)', flexShrink: 0 } }, role),
                  txt(wmGet(role).provider || '', v => wmSet(role, { provider: v }), { placeholder: 'provider', style: { flex: 1, minWidth: 80 } }),
                  txt(wmGet(role).model || '', v => wmSet(role, { model: v }), { placeholder: 'model', style: { flex: 1, minWidth: 80 } }),
                  h('label', { className: 'pa24-check', style: { margin: 0 } }, h('input', { type: 'checkbox', checked: !!wmGet(role).simplePersona, onChange: e => wmSet(role, { simplePersona: e.target.checked }) }), L('简 persona', 'simple'))))
                  : h('p', { className: 'pa24-meta' }, L('先勾选上方 Worker。', 'Check a worker above first.'))),
                L('按角色覆盖 provider/model；handwriting 需视觉模型路由，未配置则手写整理不可用。', 'Per-role provider/model overrides; handwriting needs a vision route or note整理 stays unavailable.')),
              row('extraLocalTools', h('div', { style: { minWidth: 0 } }, KNOWN_EXTRA.map(x =>
                h('label', { key: x, className: 'pa24-check' }, h('input', { type: 'checkbox', checked: form.extraKnown.includes(x), onChange: e => toggleIn('extraKnown')(x, e.target.checked) }), x)),
                h('p', { className: 'pa24-meta' }, L('本地会话额外放行的工具；精确 qwennote 工具名经对话维护。', 'Extra tools allowed in the local session; precise qwennote tool names are maintained in chat.')))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('存储与密钥引用（只读）', 'Storage & secret refs (read-only)')),
              row('storage', h('strong', null, config.storage === 'postgres' ? 'PostgreSQL' : 'SQLite'), L('切换存储后端涉及数据迁移，请按初始化指南的迁移流程办理。', 'Switching backends involves data migration — follow the migration procedure in the init guide.')),
              row('appIdEnv', h('code', null, config.appIdEnv || '—'), L('环境变量引用名；密钥值永不进界面。', 'Env var reference; secret values never appear in the UI.')),
              row('appSecretEnv', h('code', null, config.appSecretEnv || '—')),
              row('pgDsnEnv', h('code', null, config.pgDsnEnv || '—'), config.storage === 'sqlite' ? L('SQLite 模式不使用。', 'Unused under SQLite.') : null)),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('语音 TTS（晨报复盘）', 'Voice TTS (digests)')),
              row('tts.engine', sel([['none', 'none'], ['melo', 'melo'], ['volcengine', 'volcengine']], form.tts.engine, v => setTts('engine', v))),
              form.tts.engine === 'volcengine' && row('tts.voice', h('div', { className: 'pa24-row', style: { flexWrap: 'nowrap' } },
                sel(form.tts.voice && !VOICES.some(([v]) => v === form.tts.voice) ? [[form.tts.voice, form.tts.voice], ...VOICES] : VOICES, form.tts.voice, v => setTts('voice', v)),
                h('button', { type: 'button', className: 'pa24-quiet', disabled: busy, onClick: () => void tryVoice() }, icon('chat', { width: 15, height: 15 }), L('试听', 'Sample'))), L('试听发送到飞书，使用当前已保存的配置。', 'The sample goes to Feishu using the saved config.')),
              form.tts.engine === 'volcengine' && row('tts.volcKeyEnv', txt(form.tts.volcKeyEnv, v => setTts('volcKeyEnv', v), { placeholder: 'VOLC_TTS_KEY' }), L('火山引擎密钥所在环境变量名。', 'Env var name holding the Volcengine key.')),
              form.tts.engine === 'melo' && row('tts.meloDir', txt(form.tts.meloDir, v => setTts('meloDir', v), { placeholder: '/opt/melo-tts' }), L('melo 部署目录（绝对路径）。', 'melo deployment directory (absolute path).'))),
            h('div', { className: 'pa24-form-actions' },
              h('button', { type: 'button', className: 'pa24-primary', disabled: busy, onClick: () => void save() }, icon('check', { width: 16, height: 16 }), busy ? L('保存中…', 'Saving…') : L('保存并重载', 'Save & reload')),
              h('span', { className: 'pa24-meta' }, L('保存后立即重载生效；对话修改与表单等价（同一配置源）。', 'Reload applies immediately; chat edits and the form share the same config source.')))));
        }

        function CardShell({ card, tier, label, manage, hidden, onToggleHidden, body, foot }) {
          return h('section', { className: 'pa24-cap pa24-tone-' + card.tone + (hidden ? ' pa24-cap-hidden' : '') },
            manage && h('button', { type: 'button', className: 'pa24-quiet pa24-cap-hide', 'aria-pressed': hidden ? 'true' : 'false', onClick: onToggleHidden }, hidden ? L('显示', 'Show') : L('隐藏', 'Hide')),
            h('div', { className: 'pa24-cap-head' },
              tile(card.icon, card.tone),
              h('div', { className: 'pa24-cap-title' }, h('b', null, L(...card.title)), h('small', null, L(...card.sub))),
              statusBadge(tier, label || undefined)),
            h('div', { className: 'pa24-cap-body' }, body),
            foot && h('div', { className: 'pa24-cap-foot' }, foot));
        }

        function CardGrid({ cat, helpers, manage, hidden, toggleHidden, openDetail }) {
          const cards = CARDS.filter(c => c.cat === cat);
          return h('div', { className: 'pa24-cardgrid' }, cards.map(card => {
            const isHidden = (hidden[cat] || []).includes(card.id);
            if (isHidden && !manage) return null;
            const tier = card.tier(helpers);
            const label = card.label ? card.label(helpers) : null;
            return h(CardShell, {
              key: card.id, card, tier, label: label || '', manage, hidden: isHidden,
              onToggleHidden: () => toggleHidden(cat, card.id),
              body: card.body(helpers),
              foot: [...(card.quick ? [card.quick(helpers)] : []), h('button', { key: 'open', type: 'button', onClick: () => openDetail(card.id) }, icon('arrow'), card.action ? L(...card.action) : L('查看详情', 'Open'))],
            });
          }));
        }

        function Panel() {
          const [state, setState] = React.useState(null), [connError, setConnError] = React.useState('');
          const [tab, setTab] = React.useState('biz'), [detail, setDetail] = React.useState(null), [noticeClosed, setNoticeClosed] = React.useState(false);
          // F27: 订阅 locale 快照——语言切换即时重渲染（快照含 revision）。
          React.useSyncExternalStore(cb => ctx.locale.subscribe(cb), () => ctx.locale.getSnapshot());
          const [manage, setManage] = React.useState(false), [hidden, setHidden] = React.useState(readHiddenPrefs());
          const [extraTick, setExtraTick] = React.useState(0);
          const main = React.useRef(null);
          const refresh = async () => { const s = await rpc('snapshot'); setState(s); setConnError(''); setExtraTick(v => v + 1); return s; };
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
          const { busy, error, run, button } = usePanelActions();
          const extra = useExtra(state ? (state.workspace ? state.workspace.path : '') : '', extraTick);
          const selectTab = id => { setTab(id); setDetail(null); main.current?.scrollTo({ top: 0 }); };
          const openDetail = id => { setDetail(id); main.current?.scrollTo({ top: 0 }); };
          const toggleHidden = (cat, id) => {
            const list = hidden[cat] || [];
            const next = { ...hidden, [cat]: list.includes(id) ? list.filter(x => x !== id) : [...list, id] };
            setHidden(next); writeHiddenPrefs(next);
          };
          if (!state) return h('main', { className: 'pa24' }, h('style', null, style), h('div', { className: 'pa24-wrap' }, empty(connError ? 'alert' : 'bot', connError ? 'danger' : 'blue', connError ? L('暂时无法连接工作区', 'Cannot reach the workspace right now') : L('正在连接你的工作区', 'Connecting to your workspace'), connError || L('正在读取配置与当前事项…', 'Reading configuration and current items…'))));
          const workspace = state.workspace, config = workspace?.config, tz = config?.timeZone;
          // 一键全量检查（用户裁决：含主动平台探测）：飞书 → 启用中的企微 →
          // 刷新快照与补充数据；单步失败不中断（健康报告会呈现失败项）。
          const runFullCheck = async () => {
            await rpc('action', { type: 'connection.check' }).catch(() => {});
            if (wecomChannelsOn(config)) await rpc('action', { type: 'connection.wecom-check' }).catch(() => {});
            await refresh();
          };
          const helpers = { state, extra, workspace, config, tz, busy, button, run, runFullCheck, openRobot: () => void run(openRobot) };
          // F26: tab 角标＝分类内「需注意/需处理」卡片数；出现 error 时角标转红，
          // 仅 warn 时保持琥珀（口径为实施默认，后续可裁决调整）。
          const chipOf = cat => {
            const tiers = CARDS.filter(c => c.cat === cat && !(hidden[cat] || []).includes(c.id)).map(c => c.tier(helpers));
            const errors = tiers.filter(x => x === 'error').length;
            const warns = tiers.filter(x => x === 'warn').length;
            return errors + warns > 0 ? { n: errors + warns, tone: errors > 0 ? 'error' : 'warn' } : null;
          };
          const entry = detail ? CARDS.find(c => c.id === detail) : null;
          let content;
          if (entry) {
            content = h('div', null,
              h('div', { className: 'pa24-detail-bar' },
                button('chevron', L('返回卡片', 'Back to cards'), () => setDetail(null), { className: 'pa24-quiet' }),
                h('h2', { style: { margin: 0 } }, L(...entry.title), h('span', { className: 'pa24-muted', style: { fontSize: 12, fontWeight: 400, marginLeft: 8 } }, L(...entry.sub)))),
              entry.detail(helpers));
          } else {
            content = h(CardGrid, { cat: tab, helpers, manage, hidden, toggleHidden, openDetail });
          }
          return h('main', { className: 'pa24' + (manage ? ' pa24-manage' : ''), ref: main }, h('style', null, style), h('div', { className: 'pa24-wrap' },
            h('header', { className: 'pa24-header' },
              h('div', { className: 'pa24-identity' }, h('span', { className: 'pa24-brand' }, icon('bot')), h('div', null, h('div', { className: 'pa24-title-row' }, h('h1', null, t('title')), h('p', { className: 'pa24-tagline' }, L('日常交给我，重要的事由你决定。', 'Leave the routine to me; the important calls stay yours.'))))),
              h('div', { className: 'pa24-row' }, button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot, { className: 'pa24-primary', disabled: busy || !workspace }), button('refresh', L('刷新', 'Refresh'), () => refresh(), { className: 'pa24-quiet' }), button('grid', manage ? L('完成', 'Done') : L('管理卡片', 'Manage cards'), () => setManage(v => !v), { className: 'pa24-quiet', 'aria-pressed': manage ? 'true' : 'false' }))),
            manage && h('div', { className: 'pa24-notice pa24-tone-blue' }, icon('info', { width: 18, height: 18 }), h('div', null, h('strong', null, L('管理态', 'Manage')), L(' · 点卡片右上角「隐藏」收起（再点「显示」恢复）；偏好保存在本浏览器，按分类分别记忆。', ' · Use Hide on a card top-right to tuck it away (Show brings it back); preferences persist in this browser, remembered per category.'))),
            config?.mode === 'demo' && !noticeClosed && h('div', { className: 'pa24-notice pa24-tone-amber' }, icon('info', { width: 18, height: 18 }), h('div', null, h('strong', null, L('体验模式', 'Demo mode')), L(' · 未连接飞书；数据保存在本机数据库，不会发到飞书。', ' · Not connected to Feishu; data stays in the local database and never reaches Feishu.')), h('button', { type: 'button', className: 'pa24-quiet', 'aria-label': L('关闭体验模式提示', 'Dismiss demo-mode notice'), onClick: () => setNoticeClosed(true) }, icon('close', { width: 15, height: 15 }))),
            (error || connError) && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, connError ? L('连接暂时中断，以下为上次读取的状态', 'Connection lost — showing the last read state') : L('操作未完成', 'Action did not complete')), h('p', null, error || connError)),
            h('nav', { className: 'pa24-tabs', role: 'tablist', 'aria-label': L('24私助工作区导航', '24PA workspace navigation') }, CATEGORY_TABS.map(([id, name, tone], index) => {
              const chip = chipOf(id);
              return h('button', { key: id, id: 'pa24-tab-' + id, type: 'button', role: 'tab', className: 'pa24-tone-' + tone, 'aria-selected': tab === id, 'aria-controls': 'pa24-content', tabIndex: tab === id ? 0 : -1, onClick: () => selectTab(id), onKeyDown: e => {
                const next = e.key === 'ArrowRight' ? (index + 1) % CATEGORY_TABS.length : e.key === 'ArrowLeft' ? (index + CATEGORY_TABS.length - 1) % CATEGORY_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? CATEGORY_TABS.length - 1 : null;
                if (next === null) return; e.preventDefault(); selectTab(CATEGORY_TABS[next][0]); e.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus();
              } }, icon(name, { width: 17, height: 17 }), t(id), chip && h('span', { className: 'pa24-chip show' + (chip.tone === 'error' ? ' error' : ''), 'aria-label': L('待核验或需要处理 ', 'Needs review or attention ') + chip.n + L(' 项', ' item(s)') }, String(chip.n)));
            })),
            h('div', { id: 'pa24-content', role: 'tabpanel', 'aria-labelledby': 'pa24-tab-' + tab, tabIndex: 0 }, content),
            h('footer', { className: 'pa24-footer' }, icon('shield', { width: 13, height: 13 }), L('数据保存在本机（业务账本随工作区配置，默认 SQLite、可选 PostgreSQL）；参数可经表单或对话维护，界面只显示真实结果。', 'Data stays on this machine (ledger per workspace config — SQLite by default, PostgreSQL optional); parameters are maintained via the form or chat, and the UI only shows real results.'))));
        }

        // F20: 企微接入面板模块——对标飞书接入：渠道配置、CLI 与身份、
        // 服务级授权（含平台 helpMessage 原文）与 nextSteps 导航。
        function WecomView({ state, busy, button, openRobot }) {
          const wecom = state.wecom;
          const workspace = state.workspace, config = workspace ? workspace.config : null, tz = config ? config.timeZone : 'Asia/Shanghai';
          const channelBadge = value => value === 'wecom' ? badge(L('企微', 'WeCom'), 'neutral', 'bot') : badge(L('飞书', 'Feishu'), 'neutral', 'plug');
          const serviceMeta = { calendar: L('日程', 'Calendar'), todo: L('待办', 'Todo'), push: L('推送', 'Push') };
          const serviceBadge = s => statusBadge(
            { ok: 'ok', unauthorized: 'missing', expired: 'warn', unavailable: 'error', error: 'error', skipped: 'unchecked' }[s.state] || 'unchecked',
            { unauthorized: L('未授权', 'Unauthorized'), expired: L('已过期', 'Expired'), unavailable: L('企业不可用', 'Enterprise unavailable'), error: L('异常', 'Error'), skipped: L('未启用', 'Not enabled') }[s.state]);
          return h('div', { className: 'pa24-grid' },
            h('section', { className: 'pa24-card' },
                sectionHead('bot', L('企微接入', 'WeCom access'), L('日程/待办第二操作渠道与提醒单向推送（不做收信，飞书保持唯一交互入口）。', 'A second operation channel for calendar/todo plus one-way reminder push (no inbound; Feishu stays the only interaction entry).'),
                  h('div', { className: 'pa24-row' },
                    button('refresh', busy ? L('检查中…', 'Checking…') : L('检查企微接入', 'Check WeCom access'), () => rpc('action', { type: 'connection.wecom-check' })),
                    button('chat', L('通过对话配置', 'Configure in chat'), openRobot)), 'blue'),
              fields([
                [L('日程渠道', 'Calendar channel'), channelBadge(config ? config.calendarChannel : 'feishu')],
                [L('待办渠道', 'Todo channel'), channelBadge(config ? config.todoChannel : 'feishu')],
                [L('推送渠道', 'Push channel'), channelBadge(config ? config.notifyChannel : 'feishu')],
                [L('上次检查', 'Last check'), wecom ? date(wecom.checkedAt, tz) : L('尚未检查，点击右上方按钮开始', 'Not checked yet — click the button above to start')],
              ]),
              h('div', { className: 'pa24-helper' }, L('可以说：“检查企微接入，告诉我还缺什么。” 检查只读，不发送消息、不建企微对象；完整接入步骤让24私助给出指南（说“给我企微接入指南”）。', 'Try: “Check WeCom access and tell me what is missing.” Checks are read-only — no messages sent, no WeCom objects created; for the full walkthrough ask 24PA for the guide.'))),
            wecom && h('section', { className: 'pa24-card' },
              h('div', { className: 'pa24-row pa24-between' }, h('h2', null, L('CLI 与身份', 'CLI & identity')), statusBadge(wecom.cli.state === 'ok' ? 'ok' : 'error', wecom.cli.state === 'ok' ? undefined : L('CLI 不可用', 'CLI unavailable'))),
              fields([
                [L('CLI 状态', 'CLI status'), wecom.cli.message],
                [L('机器人绑定与授权真人', 'Bot binding & authorized user'), wecom.identity.message],
                [L('推送目标', 'Push target'), wecom.identity.userid ? h('span', { className: 'pa24-ellip', title: wecom.identity.userid }, wecom.identity.userid) : L('未解析', 'Unresolved')],
              ])),
            wecom && h('section', { className: 'pa24-card' },
              sectionHead('shield', L('服务级授权', 'Service-level authorization'), L('按启用渠道只读探测；服务级授权会过期（报 850003 时按指引续期），链接需在企微 App 内打开。', 'Read-only probes per enabled channel; service-level grants expire (follow the renewal guide on 850003), and links must open inside the WeCom app.')),
              (wecom.services ?? []).length === 0
                ? h('p', { className: 'pa24-meta' }, L('没有已启用的企微渠道（三渠道均为 feishu）。', 'No WeCom channel is enabled (all three channels are on feishu).'))
                : (wecom.services ?? []).map(s => h('div', { key: s.id, className: 'pa24-resource' },
                    h('div', { className: 'pa24-row' },
                      h('div', { style: { flex: 1, minWidth: 0 } }, h('h3', null, serviceMeta[s.id] || s.id), h('p', null, s.message)),
                      serviceBadge(s)),
                    s.helpMessage && h('p', { className: 'pa24-note pa24-meta' }, s.helpMessage))),
              h('details', null, h('summary', null, L('下一步（nextSteps）', 'Next steps')), (wecom.nextSteps ?? []).map((n, i) => h('p', { key: i, className: 'pa24-note' }, n)))),
            !wecom && h('section', { className: 'pa24-card' }, empty('bot', 'blue', L('尚未检查企微接入', 'WeCom access not checked yet'), L('点击右上方「检查企微接入」发起一次只读检查：CLI 可执行、机器人绑定与授权真人、按启用域的服务级授权探测。', 'Click “Check WeCom access” above for a read-only pass: CLI binary, bot binding and authorized user, and service-level probes per enabled domain.'), button('chat', L('让24私助带我做接入', 'Walk me through it'), openRobot, { className: 'pa24-primary' }))));
        }

        // F17: 设置模态里的「24私助」分区——复用 WorkspaceCards 与既有 RPC，
        // 自取 snapshot（settings.section 的 owner props 只有 close）。
        function SettingsSection({ close }) {
          const [state, setState] = React.useState(null), [connError, setConnError] = React.useState('');
          const [path, setPath] = React.useState('');
          const load = async () => { const s = await rpc('snapshot'); setState(s); setConnError(''); return s; };
          React.useEffect(() => {
            let live = true;
            void load().catch(e => { if (live) setConnError(e.message); });
            return () => { live = false; };
          }, []);
          const { busy, error, button } = usePanelActions({ reloadAfter: load });
          const openPanel = () => {
            try { if (ctx.layout) ctx.layout.selectPanel('pa24'); } catch (e) { console.warn('pa24: failed to open the 24PA panel, closing settings only', e); }
            close();
          };
          return h('div', { className: 'pa24 pa24-settings' }, h('style', null, style),
            h('div', { className: 'pa24-settings-head' },
              h('div', { className: 'pa24-row' },
                h('span', { className: 'pa24-brand pa24-settings-brand' }, icon('bot', { width: 18, height: 18 })),
                h('div', null, h('h2', null, t('settings')), h('p', { className: 'pa24-meta' }, L('工作区绑定、配置重载、生效配置查看与健康预算；日常操作与接入诊断在24私助面板。', 'Workspace binding, config reload, effective-config review, and health & budget; daily actions and access diagnostics live in the 24PA panel.')))),
              h('div', { className: 'pa24-row' }, button('external', L('打开24私助面板', 'Open the 24PA panel'), openPanel, { className: 'pa24-quiet' }))),
            (error || connError) && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, connError ? L('连接暂时中断', 'Connection lost') : L('操作未完成', 'Action did not complete')), h('p', null, error || connError)),
            !state
              ? h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), connError ? L('无法读取工作区状态。', 'Cannot read workspace state.') : L('正在读取工作区状态…', 'Reading workspace state…'))
              : h('div', null,
                h(WorkspaceCards, { snapshot: state, busy, button, openRobot, path, onPathChange: setPath }),
                h(HealthBlock)));
        }
        // P53: 宿主侧栏只有图标位——无障碍名由宿主 register 的 label 提供，
        // title 仅补悬停提示。
        const SidebarIcon = () => h('span', { title: t('panel'), style: { display: 'inline-flex' } }, icon('bot', { width: 22, height: 22 }));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'pa24' }, Panel));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'pa24', order: 24, label: () => t('panel') }, SidebarIcon));
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'pa24', order: 25, label: () => t('settings') }, SettingsSection));
      },
    };
  },
});
