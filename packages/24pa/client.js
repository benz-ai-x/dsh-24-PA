// 24私助工作区 panel (F01): business overview / access modules with the
// shared SVG + semantic-color + keyboard/focus vocabulary. Read-mostly for
// business content; parameters are editable through the System-category
// configuration form (F33), whose save path validates, rewrites the AGENTS.md
// config block, and reloads — chat and the form share one config source.
// F35 (2.6): workspace configuration management (binding/reload/effective
// config/health & budget) lives on the panel's System category under the
// Workspace & config card — the dsh settings「24私助」section is retired;
// the panel is the single entry for workspace management.
// F21 (P53): UI/UX walkthrough fixes — tighter vertical rhythm, one primary
// action per view, unified status-badge vocabulary, human-first copy with
// tech detail folded away, and design-doc tab color semantics.
// F26 (P58): capability cards — 一级导航收敛为四分类 tab（事务与计划/知识与
// 资料/接入与设置/运行与维护），卡片由
// CARD_REGISTRY 驱动：注册即生卡，点卡片进入二级详情（原视图平移）。浅色为
// 设计主参考（--pa-ink/--pa-muted 双层文字层级暗色跟随不掉队）。
window.__ModuleLoader__.load({
  id: '@benz-ai-x/dsh-24pa',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const zh = {
      panel: '24私助工作区', title: '24私助',
      work: '事务与计划', knowledge: '知识与资料', setup: '接入与设置', ops: '运行与维护',
      review: '手写审核', awaiting_review: '待审核', needs_rereview: '需重新审核', returned: '已退回', collecting: '收集中',
      collected: '已收齐', approved: '已通过', pending_review: '待审核', stale: '已失效', superseded: '已取代',
      reminderOnce: '单次', reminderDaily: '每日', reminderPaused: '已暂停', reminderCanceled: '已取消', reminderDone: '已结束',
      queued: '排队中', running: '处理中', completed: '已完成', accepted: '已接纳',
      sent: '已发送', pending: '待发送', sending: '发送中', failed: '未完成', expired: '已过期', unknown: '结果未知',
      waiting_input: '等待补充', stopped: '已停止', needs_reconciliation: '需核对',
      'status.ok': '正常', 'status.warn': '待核验', 'status.error': '需要处理', 'status.missing': '待配置', 'status.unchecked': '尚未检查',
    };
    // F27（P59）：中英双语——命名空间字典走 register({zh,en})；内联文案走
    // resolveText({zh,en}) 的 L() 帮助函数（dsh 官方内联双语通道，与字符串
    // 同址维护）；切换即时生效由 Panel 的 useSyncExternalStore 订阅保证。
    const en = {
      panel: '24PA Workspace', title: '24PA',
      work: 'Work & plans', knowledge: 'Knowledge & content', setup: 'Connections & setup', ops: 'Operations & maintenance',
      review: 'Handwriting Review', awaiting_review: 'Awaiting review', needs_rereview: 'Needs re-review', returned: 'Returned', collecting: 'Collecting',
      collected: 'All pages in', approved: 'Approved', pending_review: 'Awaiting review', stale: 'Stale', superseded: 'Superseded',
      reminderOnce: 'Once', reminderDaily: 'Daily', reminderPaused: 'Paused', reminderCanceled: 'Canceled', reminderDone: 'Done',
      queued: 'Queued', running: 'Running', completed: 'Completed', accepted: 'Accepted',
      sent: 'Sent', pending: 'Pending', sending: 'Sending', failed: 'Failed', expired: 'Expired', unknown: 'Unknown',
      waiting_input: 'Waiting for input', stopped: 'Stopped', needs_reconciliation: 'Needs reconciliation',
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
      body[data-ds-dark-theme] .pa24{--pa-ink:var(--dsw-alias-label-primary,rgb(249 250 251));--pa-muted:color-mix(in srgb,var(--dsw-alias-label-caption,rgb(129 133 140)) 75%,#fff);--pa-line:color-mix(in srgb,var(--dsw-alias-border-l2,rgba(255 255 255/12%)) 55%,#fff);--pa-canvas:var(--dsw-alias-bg-base,var(--dsw-static-neutral-bluish-950,rgb(21 21 23)));--pa-surface:color-mix(in srgb,var(--dsw-alias-bg-layer-2,var(--dsw-static-neutral-bluish-850,rgb(44 44 46))) 90%,#fff);--pa-soft:color-mix(in srgb,var(--dsw-alias-bg-layer-3,var(--dsw-static-neutral-bluish-800,rgb(53 54 56))) 87%,#fff);--pa-brand:#3764ab;--pa-brand-hover:#4174c2;--pa-blue:#a0bdf0;--pa-blue-bg:#25364f;--pa-green:#7cc7a2;--pa-green-bg:#1f3226;--pa-violet:#b9a5ef;--pa-violet-bg:#2b2447;--pa-amber:#dfbc83;--pa-amber-bg:#3b3225;--pa-danger:#f0aaa5;--pa-danger-bg:#412b2c;--pa-shadow:none}
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
      .pa24-cap-title{flex:1;min-width:0}.pa24-cap-title b{display:block;font-size:14px;font-weight:650;color:var(--pa-ink)}.pa24-cap-title small{display:-webkit-box;font-size:11px;color:var(--pa-muted);margin-top:2px;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2}
      .pa24-cap-att{border-color:color-mix(in srgb,var(--tone) 55%,var(--pa-line))}.pa24-cap-att .pa24-icon-tile{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--tone) 35%,transparent)}
      .pa24-cap-att .pa24-cap-foot button{border-color:color-mix(in srgb,var(--tone) 45%,var(--pa-line));color:var(--tone);font-weight:650}
      .pa24-manage-done{background:var(--pa-blue-bg);color:var(--pa-blue);border-color:var(--pa-blue)}
      .pa24-cap-body{flex:1;font-size:12.5px;line-height:1.7}
      .pa24-cap-kpi{display:flex;gap:18px;flex-wrap:wrap}.pa24-cap-kpi strong{display:block;font-size:19px;line-height:1.25;font-weight:650;color:var(--tone);font-variant-numeric:tabular-nums}.pa24-cap-kpi small{display:block;font-size:11px;color:var(--pa-muted)}
      .pa24-cap-line{display:flex;justify-content:space-between;gap:8px}.pa24-cap-line b{font-weight:600;color:var(--pa-ink)}
      .pa24-cap-foot{display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--pa-line);padding-top:10px}
      .pa24-cap-foot .pa24 button,.pa24-cap-foot button{min-height:30px;padding:4px 10px;font-size:12px;border-radius:8px}
      .pa24-cap-hidden{opacity:.55}
      .pa24-cap-hide{align-self:flex-end;padding:4px 10px!important;font-size:11px!important;display:none}
      .pa24-manage .pa24-cap-hide{display:inline-flex}.pa24-manage .pa24-cap{outline:1.5px dashed var(--pa-line);outline-offset:-6px}
      .pa24-filter-active{background:var(--pa-blue-bg);color:var(--pa-blue);border-color:var(--pa-blue)}
      .pa24-next{display:flex;align-items:flex-start;gap:7px;font-size:11.5px;line-height:1.6;padding:8px 10px;border-radius:9px;background:var(--tone-bg);color:var(--tone)}
      .pa24-chip{display:none;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:99px;font-size:10px;font-weight:700;background:var(--pa-amber-bg);color:var(--pa-amber)}
      .pa24-chip.show{display:inline-flex}.pa24-chip.error{background:var(--pa-danger-bg);color:var(--pa-danger)}
      .pa24-detail-bar{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
      .pa24-form-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--pa-line)}.pa24-form-row:last-child{border-bottom:0}.pa24-form-row>label{font-size:12px;color:var(--pa-muted)}.pa24-form-row input[type=text],.pa24-form-row input[type=number],.pa24-form-row select{min-height:36px}
      .pa24-check{display:inline-flex;align-items:center;gap:6px;margin:0 16px 0 0;font-size:13px;min-height:32px;cursor:pointer}.pa24-check input{width:15px;height:15px;min-height:0}
      .pa24-form-actions{position:sticky;bottom:0;z-index:2;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;margin-top:16px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-surface);box-shadow:0 -4px 14px color-mix(in srgb,var(--pa-ink) 9%,transparent)}
      .pa24-spin{animation:pa24-spin 1s linear infinite}@keyframes pa24-spin{to{transform:rotate(360deg)}}
      @container(max-width:880px){.pa24-header{align-items:flex-start}.pa24-tabs{gap:2px}.pa24-field{grid-template-columns:110px minmax(0,1fr)}}
      @container(max-width:620px){.pa24-header{flex-direction:column;gap:16px}.pa24-form-row{grid-template-columns:1fr;gap:4px;padding:10px 0}.pa24 h1{font-size:19px}.pa24-grid{grid-template-columns:1fr}.pa24-stats{gap:8px}.pa24-stat{padding:12px;gap:8px}.pa24-stat>.pa24-icon-tile{display:none}.pa24-card{padding:18px}.pa24-form-actions{gap:8px;padding:10px 12px}.pa24-form-actions>.pa24-meta{display:none}}
      @media(max-width:760px){.pa24{padding:20px 16px}.pa24 button{min-height:44px}.pa24-tabs button{min-height:44px}.pa24 summary{min-height:40px;display:list-item}}
      @media(prefers-reduced-motion:reduce){.pa24 *{animation:none!important;transition:none!important}}
    `;
    return {
      inject: ['slots', 'locale', 'connection', 'uiWorkspace'],
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
        const sectionHead = (name, title, description, action, tone = 'neutral') => h('div', { className: 'pa24-section-head' }, h('div', null, h('div', { className: 'pa24-section-title' }, h('span', { className: 'pa24-tone-' + tone, style: { color: 'var(--tone)' } }, icon(name)), title && h('h2', null, title)), description && h('p', { className: 'pa24-section-desc' }, description)), action);
        const empty = (name, tone, title, description, actions) => h('div', { className: 'pa24-empty' }, tile(name, tone), h('h3', null, title), h('p', null, description), actions && h('div', { className: 'pa24-row' }, actions));
        const WORKER_IDS = ['memo', 'tasks', 'calendar', 'reminders', 'handwriting', 'digest'];
        const WORKER_NAMES = {
          memo: ['备忘整理', 'Memo'], tasks: ['待办管理', 'Tasks'], calendar: ['日程编排', 'Calendar'],
          reminders: ['事项提醒', 'Reminders'], handwriting: ['手写整理', 'Handwriting'], digest: ['晨报复盘', 'Digest'],
        };
        const roleName = id => WORKER_NAMES[id] ? L(...WORKER_NAMES[id]) : id;
        const ACTIVE_WORK = ['accepted', 'queued', 'running', 'waiting_input'];

        // arch-5: the loading/ready/error triplet behind one hook. Views declare
        // the rpc key, payload and deps; abort-on-unmount and retry come along.
        const useRpc = (key, payload, deps) => {
          const [retry, setRetry] = React.useState(0);
          const [view, setView] = React.useState({ status: 'loading', data: null, error: '' });
          React.useEffect(() => {
            const abort = new AbortController();
            setView({ status: 'loading', data: null, error: '' });
            void rpc(key, payload, abort.signal).then(data => {
              if (!abort.signal.aborted) setView({ status: 'ready', data, error: '' });
            }).catch(error => { if (!abort.signal.aborted) setView({ status: 'error', data: null, error: error.message }); });
            return () => abort.abort();
          }, [...deps, retry]);
          return [view, () => setRetry(v => v + 1)];
        };

        function MemoryView({ workspace, openRobot }) {
          const [draft, setDraft] = React.useState(''), [query, setQuery] = React.useState(''), [offset, setOffset] = React.useState(0);
          const [view, retryFetch] = useRpc('memory', { query, offset }, [workspace.path, query, offset]);
          const categories = { preference: [L('个人偏好', 'Preference'), 'neutral'], fact: [L('事实', 'Fact'), 'neutral'], project: [L('项目', 'Project'), 'blue'], decision: [L('决定', 'Decision'), 'neutral'] };
          const search = () => { setOffset(0); setQuery(draft.trim()); retryFetch(); };
          const clear = () => { setDraft(''); setQuery(''); setOffset(0); };
          const data = view.data;
          const button = (name, label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, icon(name), label);
          return h('section', null,
            sectionHead('memory', null, L('记住你的偏好与背景，让每次交办更有默契。', 'Your preferences and background, remembered so every handoff lands better.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新记忆', 'Refresh memories'), retryFetch, { disabled: view.status === 'loading', className: 'pa24-quiet' }), button('chat', L('通过对话维护记忆', 'Manage memories in chat'), openRobot)), 'neutral'),
            h('div', { className: 'pa24-searchbar' },
              h('div', { className: 'pa24-search' }, icon('search'), h('input', { value: draft, placeholder: L('搜索正文、主题或来源…', 'Search content, topic, or source…'), 'aria-label': L('筛选记忆', 'Filter memories'), onChange: e => setDraft(e.target.value), onKeyDown: e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) search(); } })),
              button('search', L('筛选', 'Filter'), search), (draft || query) && button('close', L('查看全部', 'Show all'), clear, { className: 'pa24-quiet' })),
            view.status === 'loading' && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取记忆内容…', 'Reading memories…')),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('div', { className: 'pa24-row' }, icon('alert'), h('strong', null, L('记忆读取失败', 'Failed to read memories'))), h('p', null, view.error), h('p', null, L('请在 dsh 的24私助会话中检查记忆文件，修复后重试。', 'Check the memory file in the 24PA dsh session and retry after fixing.')), button('refresh', L('重试读取', 'Retry read'), retryFetch)),
            data && h('div', null,
              h('div', { className: 'pa24-result-meta', role: 'status' }, h('span', null, L('共 ' + data.total + L(' 条记忆', ' memories') + (query ? L(' · 匹配 ', ' · ') + data.matched + L(' 条', ' matched') : ''), data.total + (query ? ' memories (' + data.matched + ' matched)' : ' memories total'))), h('span', null, L('记忆版本 ' + data.revision, 'Memory revision ' + data.revision))),
              data.matched === 0 ? h('div', { className: 'pa24-card' }, empty('search', 'neutral', L('没有找到匹配的记忆', 'No matching memories'), L('试试更短的关键词，或清空筛选查看所有记忆。', 'Try shorter keywords, or clear the filter to see everything.'), button('close', L('清空筛选', 'Clear filter'), clear))) :
              data.total === 0 ? h('div', { className: 'pa24-card' }, empty('memory', 'neutral', L('从「记住这件事」开始', 'Start with “remember this”'), L('还没有保存的记忆。在 dsh 的24私助会话告诉它你的偏好或项目背景，保存后会直接显示在这里。', 'Nothing saved yet. Tell the 24PA dsh session your preferences or project background and they will show up here.'),
                button('chat', L('告诉24私助我的偏好', 'Tell 24PA my preferences'), openRobot, { className: 'pa24-primary' })),
                h('div', { className: 'pa24-example' }, icon('chat', { width: 16, height: 16 }), L('试着说：“记住，我希望会议之间留 15 分钟。”', 'Try: “Remember, I want 15 minutes between meetings.”'))) :
              h('div', { className: 'pa24-memory-list' }, data.records.map(r => {
                const [category, tone] = categories[r.category] || [r.category, 'neutral'];
                return h('article', { key: r.id, className: 'pa24-memory-card' },
                  h('div', { className: 'pa24-memory-body' },
                    h('div', { className: 'pa24-memory-heading' }, h('div', { className: 'pa24-row' }, badge(category, tone), h('h3', null, r.topic || L('未设置主题', 'No topic set'))), badge(r.status === 'confirmed' ? L('已确认', 'Confirmed') : L('待核实', 'Unverified'), r.status === 'confirmed' ? 'blue' : 'amber', r.status === 'confirmed' ? 'check' : 'clock')),
                    h('div', { className: 'pa24-note' }, r.content),
                    h('div', { className: 'pa24-row pa24-between' },
                      h('div', { className: 'pa24-memory-source' }, icon('note', { width: 13, height: 13 }), h('span', null, L('来源：', 'Source: ') + r.source)),
                      h('time', { className: 'pa24-meta', dateTime: r.updatedAt }, date(r.updatedAt, workspace.config?.timeZone || 'Asia/Shanghai')))),
                  h('div', { className: 'pa24-memory-footer' }, h('details', null, h('summary', null, L('修订依据与 JSON', 'Revision basis & JSON')), h('p', { className: 'pa24-meta' }, L('修订依据：', 'Reason: ') + r.reason), h('p', { className: 'pa24-meta' }, L('修改会话：', 'Updated by: ') + r.updatedBy), r.validUntil && h('p', { className: 'pa24-meta' }, L('有效期至：', 'Valid until: ') + r.validUntil), h('pre', null, JSON.stringify(r, null, 2)))));
              })),
              data.matched > data.limit && h('nav', { className: 'pa24-page-nav', 'aria-label': L('记忆分页', 'Memory pagination') }, button('chevron', L('上一页', 'Previous'), () => setOffset(Math.max(0, data.offset - data.limit)), { disabled: data.offset === 0 }), h('span', null, L('第 ' + (Math.floor(data.offset / data.limit) + 1) + ' / ' + Math.ceil(data.matched / data.limit) + L(' 页', ''), 'Page ' + (Math.floor(data.offset / data.limit) + 1) + ' / ' + Math.ceil(data.matched / data.limit))), button('chevron', L('下一页', 'Next'), () => setOffset(data.offset + data.limit), { disabled: data.offset + data.limit >= data.matched }))),
            h('details', null, h('summary', null, L('存储位置与维护方式', 'Storage & maintenance')), h('p', { className: 'pa24-meta' }, (workspace.path || '') + '/.24pa/memory.json'), h('p', { className: 'pa24-meta' }, L('通过 dsh 的24私助会话新增、更正、删除和整理（变更集可撤销）；整理仅由你发起。', 'Add, correct, remove, and tidy through the 24PA dsh session (changesets are undoable); tidying is always owner-initiated.'))));
        }

        function ReviewView({ workspace, openRobot }) {
          const [view, retryFetch] = useRpc('notes.queue', {}, [workspace.path]);
          const [mode, setMode] = React.useState('pending');
          const [historyFilter, setHistoryFilter] = React.useState('all');
          const button = (name, label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, icon(name), label);
          const tz = workspace.config?.timeZone || 'Asia/Shanghai';
          const verifyBadge = v => {
            if (!v || !v.verifyResult) return badge(L('尚未核验', 'Not verified'), 'neutral', 'info');
            if (v.verifyResult === 'matches') return badge(L('内容一致', 'Content matches'), 'blue', 'check');
            if (v.verifyResult === 'changed') return badge(L('文档已修改', 'Document changed'), 'amber', 'alert');
            return badge(L('核验异常', 'Verification failed'), 'danger', 'alert');
          };
          const reviewStatus = (status, decision) => {
            const key = decision || status;
            const meta = {
              approve: [L('已通过', 'Approved'), 'blue', 'check'], approved: [L('已通过', 'Approved'), 'blue', 'check'],
              return: [L('已退回', 'Returned'), 'amber', 'pen'], returned: [L('已退回', 'Returned'), 'amber', 'pen'],
              pending_review: [L('待审核', 'Pending review'), 'amber', 'clock'], awaiting_review: [L('待审核', 'Pending review'), 'amber', 'clock'],
              needs_rereview: [L('需重新审核', 'Needs re-review'), 'danger', 'alert'], superseded: [L('已取代', 'Superseded'), 'neutral', 'close'], stale: [L('已失效', 'Stale'), 'neutral', 'close'],
            }[key] || [key, 'neutral', 'info'];
            return badge(...meta);
          };
          const history = view.data?.history ?? [];
          const visibleHistory = historyFilter === 'all' ? history : historyFilter === 'unverified'
            ? history.filter(row => !row.verifyResult)
            : history.filter(row => (row.decision || row.status) === historyFilter);
          const pending = view.status === 'ready' && (view.data.count === 0
            ? h('div', { className: 'pa24-card' }, empty('check', 'blue', L('没有等待审核的笔记', 'No notes awaiting review'), L('拍照整理后的待审版本会出现在这里；审核完成或退回后自动移入审核记录。', 'Pending versions from photographed notes appear here and move into review history once reviewed or returned.'), button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot)))
            : view.data.items.map(item => h('article', { key: item.noteId, className: 'pa24-job' },
                h('div', { className: 'pa24-row pa24-between' }, h('h3', null, item.title || item.noteId), reviewStatus(item.noteStatus)),
                item.latestVersion && h('div', { className: 'pa24-row' }, badge('v' + item.latestVersion.version + ' ' + (t(item.latestVersion.status) || item.latestVersion.status), item.latestVersion.status === 'pending_review' ? 'amber' : 'neutral', 'shield'), verifyBadge(item.latestVersion)),
                h('p', { className: 'pa24-meta' }, item.pages + L(' 页原稿 · 指纹 ', ' pages · fingerprint ') + (item.latestVersion ? item.latestVersion.fingerprint : '—') + (item.latestVersion && item.latestVersion.verifiedAt ? L(' · 上次核验 ', ' · last verified ') + date(item.latestVersion.verifiedAt, tz) : '')),
                item.reminders.length > 0 && h('p', { className: 'pa24-meta' }, L('催办：', 'Reminders: ') + item.reminders.map(r => (t('reminder' + (r.kind === 'daily' ? 'Daily' : 'Once')) || r.kind) + ' ' + (t('reminder' + r.status.charAt(0).toUpperCase() + r.status.slice(1)) || r.status) + (r.status === 'pending' ? L('，下次 ', ', next ') + date(r.remindAt, tz) : '')).join(L('；', '; '))),
                item.latestVersion && item.latestVersion.docUrl && h('a', { className: 'pa24-link-button', href: item.latestVersion.docUrl, target: '_blank', rel: 'noreferrer' }, icon('external'), L('打开飞书文档', 'Open Feishu doc')),
                h('p', { className: 'pa24-meta' }, L('需要稍后提醒、暂停催办或重新发布候选时，直接告诉24私助。', 'For a later nudge, pausing follow-ups, or republishing a candidate, just tell 24PA.')))));
          return h('section', null,
            sectionHead('pen', null, L('拍照笔记的待审版本、审核记录与版本核验都在这里；批准或退回请在飞书审核卡上完成。', 'Pending versions, review history, and verification; approve or return on the Feishu review card.'),
              button('refresh', L('刷新队列', 'Refresh queue'), retryFetch, { disabled: view.status === 'loading', className: 'pa24-quiet' }), 'danger'),
            h('div', { className: 'pa24-example' }, icon('shield', { width: 16, height: 16 }), L('审核裁决只由你在飞书卡片上作出；本页面为只读查阅，不提供网页批准按钮。', 'Review verdicts are made by you on the Feishu card only; this page is read-only and has no approve button.')),
            h('div', { className: 'pa24-row', role: 'group', 'aria-label': L('审核视图', 'Review views'), style: { margin: '14px 0' } },
              button('tasks', L('待处理 ' + (view.data?.count ?? 0), 'Pending ' + (view.data?.count ?? 0)), () => setMode('pending'), { className: mode === 'pending' ? 'pa24-filter-active' : 'pa24-quiet', 'aria-pressed': mode === 'pending' }),
              button('clock', L('审核记录 ' + history.length, 'History ' + history.length), () => setMode('history'), { className: mode === 'history' ? 'pa24-filter-active' : 'pa24-quiet', 'aria-pressed': mode === 'history' })),
            view.status === 'loading' && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取审核队列…', 'Reading the review queue…')),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('div', { className: 'pa24-row' }, icon('alert'), h('strong', null, L('审核队列读取失败', 'Failed to read the review queue'))), h('p', null, view.error), button('refresh', L('重试读取', 'Retry read'), retryFetch)),
            view.status === 'ready' && mode === 'pending' && pending,
            view.status === 'ready' && mode === 'history' && h('section', { className: 'pa24-card' },
              h('div', { className: 'pa24-row pa24-between' }, h('h2', null, L('审核记录', 'Review history')),
                h('select', { value: historyFilter, onChange: e => setHistoryFilter(e.target.value), 'aria-label': L('筛选审核记录', 'Filter review history'), style: { maxWidth: 220 } },
                  h('option', { value: 'all' }, L('全部状态', 'All statuses')),
                  h('option', { value: 'pending_review' }, L('待审核', 'Pending review')),
                  h('option', { value: 'return' }, L('已退回', 'Returned')),
                  h('option', { value: 'approve' }, L('已通过', 'Approved')),
                  h('option', { value: 'unverified' }, L('待核验', 'Needs verification')))),
              visibleHistory.length === 0
                ? empty('search', 'neutral', L('没有符合条件的审核记录', 'No matching review history'), L('调整状态筛选，或等待新的审核版本。', 'Change the filter or wait for a new review version.'))
                : visibleHistory.map(row => h('article', { key: row.noteId + ':v' + row.version, className: 'pa24-job' },
                    h('div', { className: 'pa24-row pa24-between' }, h('h3', null, row.title || row.noteId), reviewStatus(row.status, row.decision)),
                    h('div', { className: 'pa24-row' }, badge('v' + row.version, 'neutral', 'shield'), verifyBadge(row)),
                    row.summary && h('p', { className: 'pa24-note' }, row.summary),
                    h('p', { className: 'pa24-meta' }, L('版本创建 ', 'Created ') + date(row.createdAt, tz) + (row.decidedAt ? L(' · 审核 ', ' · Reviewed ') + date(row.decidedAt, tz) : '') + L(' · 指纹 ', ' · Fingerprint ') + row.fingerprint),
                    row.docUrl && h('a', { className: 'pa24-link-button', href: row.docUrl, target: '_blank', rel: 'noreferrer' }, icon('external'), L('打开飞书文档', 'Open Feishu doc'))))));
        }

        // 面板动作外壳（busy/error/run/button）。reloadAfter 曾服务设置分区
        // （无轮询，动作后立即重读）；F35 设置分区撤销后无调用方，参数移除，
        // 面板自身有 2.5s 轮询。
        // 打开固定本地助理会话——面板各视图共用。
        const openRobot = async () => { const r = await rpc('action', { type: 'robot.open' }); ctx.uiWorkspace.openSession(r.sessionId); };
        function usePanelActions() {
          const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
          const run = async fn => { setBusy(true); setError(''); try { return await fn(); } catch (e) { setError(e.message); return null; } finally { setBusy(false); } };
          const button = (name, label, fn, props = {}) => h('button', { type: 'button', disabled: busy, onClick: () => void run(fn), ...props }, name && icon(name), label);
          return { busy, error, run, button };
        }

        // F17: 工作区管理两张卡（绑定/切换 + 生效配置）独立成组件，F35 起
        // 仅由主面板「工作区与配置」卡的详情挂载；动作走既有 RPC，不新增端点。
        // path 为受控值由父级持有，详情返回即弃（切卡不丢已选未绑定的目录）。
        function WorkspaceCards({ snapshot, busy, button, openRobot, openConfig, path, onPathChange }) {
          const workspace = snapshot.workspace, config = workspace ? workspace.config : null;
          const enabledNames = (config && config.enabledWorkers ? config.enabledWorkers : []).map(roleName).join('、') || L('无', 'None');
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
                  button('code', L('打开参数表单', 'Open config form'), openConfig, { className: 'pa24-quiet' }),
                  button('chat', L('通过对话修改配置', 'Change config in chat'), openRobot, { className: 'pa24-quiet' }),
                  button('refresh', L('重载 AGENTS.md', 'Reload AGENTS.md'), () => rpc('action', { type: 'workspace.reload' }), { className: 'pa24-quiet' })), 'blue'),
              workspace && fields([
                [L('固定飞书 profile', 'Feishu CLI profile'), config ? config.larkProfile : null],
                [L('时区', 'Time zone'), config ? config.timeZone : null],
                [L('同时处理数', 'Parallel workers'), config ? config.maxWorkers : null],
                [L('已启用 Worker', 'Enabled workers'), enabledNames],
              ]),
              workspace && workspace.configError && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, L('当前生效配置保留上一有效版本', 'Keeping the last valid configuration')), h('p', null, workspace.configError)),
              workspace && h('details', null, h('summary', null, L('内部会话与技术标识', 'Internal sessions and technical IDs')), fields([
                [L('飞书接入会话', 'Feishu access session'), workspace.accessSessionId || L('未建立', 'Not created')],
                [L('本地助理会话', 'Local assistant session'), workspace.localSessionId || L('未建立', 'Not created')],
              ])),
              h('details', null, h('summary', null, L('查看完整配置 JSON', 'View full configuration JSON')), h('pre', null, JSON.stringify(config, null, 2)))));
        }

        function HealthBlock({ data: providedData, title }) {
          const [view, setView] = React.useState(() => providedData ? { status: 'ready', data: providedData, error: '' } : { status: 'idle', data: null, error: '' });
          React.useEffect(() => {
            if (providedData) setView({ status: 'ready', data: providedData, error: '' });
          }, [providedData]);
          const load = () => {
            setView({ status: 'loading', data: null, error: '' });
            void rpc('health', {}).then(data => setView({ status: 'ready', data, error: '' })).catch(error => setView({ status: 'error', data: null, error: error.message }));
          };
          // F39: info 档按能力位配词——tts＝预检未跑、calendar-sync＝同步未运行，
          // 都不是「检查未做」；lark-cli 的 info（检查未发起）维持「尚未检查」。
          const INFO_WORDS = { tts: ['未预检', 'Not probed'], 'calendar-sync': ['未运行', 'Not run yet'] };
          const badgeOfCap = c => statusBadge(['ok', 'warn', 'error'].includes(c.state) ? c.state : 'unchecked', c.state === 'info' && INFO_WORDS[c.id] ? L(...INFO_WORDS[c.id]) : undefined);
          const capName = id => ({
            'vision-route': L('手写视觉路由', 'Handwriting vision route'), 'lark-cli': L('飞书 CLI', 'Feishu CLI'), 'calendar-sync': L('日历同步', 'Calendar sync'),
            'wecom-cli': L('企业微信 CLI', 'WeCom CLI'), tts: L('语音引擎', 'Voice engine'), 'extra-local-tools': L('本地工具扩展', 'Local tool extensions'), 'qwennote-channel': L('听记通道', 'Minutes channel'),
          }[id] || id);
          const button = (name, label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, icon(name), label);
          return h('section', null,
            sectionHead('pulse', title || L('健康与预算', 'Health & budget'), L('能力可用性、同步新鲜度与本 Host 的投入统计；凭据不进入诊断。', 'Capability availability, sync freshness, and this host’s usage; secrets never enter diagnostics.'),
              h('div', { className: 'pa24-row' }, button('refresh', view.status === 'idle' ? L('读取健康状态', 'Read health status') : L('刷新', 'Refresh'), load, { disabled: view.status === 'loading', className: 'pa24-quiet' })), 'blue'),
            view.status === 'idle' && h('div', { className: 'pa24-card' }, empty('pulse', 'neutral', L('尚未读取健康状态', 'Health not read yet'), L('点击「读取健康状态」查看能力、模型路由、用量与预算口径。', 'Read health to inspect capabilities, model routing, usage, and budget.'), button('refresh', L('读取健康状态', 'Read health status'), load))),
            view.status === 'loading' && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取健康状态…', 'Reading health status…')),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('div', { className: 'pa24-row' }, icon('alert'), h('strong', null, L('健康状态读取失败', 'Failed to read health status'))), h('p', null, view.error), button('refresh', L('重试', 'Retry'), load)),
            view.status === 'ready' && h('div', { className: 'pa24-card' },
              h('div', { className: 'pa24-ready' }, (view.data.capabilities ?? []).map(c => h('div', { key: c.id, className: 'pa24-ready-item pa24-tone-' + (c.state === 'ok' ? 'blue' : c.state === 'warn' ? 'amber' : c.state === 'info' ? 'neutral' : 'danger') }, icon(c.state === 'ok' ? 'check' : c.state === 'info' ? 'info' : 'alert', { width: 17, height: 17 }), h('div', null,
                h('div', { className: 'pa24-row pa24-between' }, h('strong', null, capName(c.id)), badgeOfCap(c)),
                h('p', { className: 'pa24-meta' }, c.message),
                (c.detail?.nextSteps ?? []).length > 0 && h('details', null, h('summary', null, L('处理建议', 'Next steps')), (c.detail.nextSteps).map((step, i) => h('p', { key: i, className: 'pa24-note pa24-meta' }, step))))))),
              view.data.usage && h('div', { style: { marginTop: 14 } }, fields([
                [L('模型轮次', 'Model turns'), view.data.usage.modelTurns], [L('输入笔记页', 'Note pages in'), view.data.usage.notePagesInput], [L('生成裁片', 'Crops generated'), view.data.usage.noteCrops],
                [L('发送队列', 'Outbox queued'), view.data.usage.outboxQueued], [L('结果未知', 'Unknown results'), (view.data.usage.outboxUnknown ?? 0) + (view.data.usage.operationsUnknown ?? 0)],
                [L('发送延迟 p50/p95', 'Outbox latency p50/p95'), (view.data.usage.outboxLatencyMs?.p50 ?? '—') + ' / ' + (view.data.usage.outboxLatencyMs?.p95 ?? '—') + ' ms'],
                [L('预算口径', 'Budget'), view.data.usage.quota],
              ]), h('p', { className: 'pa24-meta' }, view.data.usage.note)),
              view.data.dataFlow && h('details', null, h('summary', null, L('数据流与保留披露', 'Data flow & retention')), fields([
                [L('模型输入', 'Model input'), view.data.dataFlow.modelInput], [L('额外日志', 'Extra logs'), view.data.dataFlow.extraLogs], [L('保留期限', 'Retention'), view.data.dataFlow.retention], [L('凭据', 'Secrets'), view.data.dataFlow.secrets],
              ])),
              view.data.degraded && h('div', { className: 'pa24-example' }, icon('info', { width: 16, height: 16 }), view.data.degraded.modelDown + ' ' + view.data.degraded.pgDown)));
        }

        // F35: 设置「24私助」分区整体迁回主面板——「工作区与配置」卡的二级
        // 详情＝WorkspaceCards（绑定/切换＋生效配置/重载）＋健康与预算；
        // 复用既有组件与 RPC，零新增端点。path 受控于本组件（详情返回即弃）；
        // 动作成功后立即重读快照（原设置分区 reloadAfter 的即时性，不等轮询）。
        function WorkspaceDetail({ helpers }) {
          const [path, setPath] = React.useState('');
          const refreshAfter = fn => async () => { const r = await fn(); await helpers.refresh(); return r; };
          const wButton = (name, label, fn, props) => helpers.button(name, label, refreshAfter(fn), props);
          return h('div', null,
            h(WorkspaceCards, { snapshot: helpers.state, busy: helpers.busy, button: wButton, openRobot: helpers.openRobot, openConfig: () => helpers.openCard('config'), path, onPathChange: setPath }),
            h(HealthBlock, { data: helpers.extra.health }));
        }

        // ---- F26: 能力卡片体系（原型 prototypes/pa24-card-panel v0.3 裁决）----
        // 一级导航＝四分类 tab；卡片＝内容单元：元数据＋tier（角标聚合的纯函数）
        // ＋body（摘要）＋detail（二级详情，原视图平移）。注册即生卡。
        const CATEGORY_TABS = [['work', 'grid', 'blue'], ['knowledge', 'memory', 'violet'], ['setup', 'plug', 'green'], ['ops', 'shield', 'amber']];
        const CARD_HIDDEN_KEY = 'pa24.panelCards.hidden';
        const CATEGORY_MIGRATION = {
          work: 'work', activity: 'work', reminders: 'work', digest: 'work', review: 'knowledge', memory: 'knowledge',
          feishu: 'setup', wecom: 'setup', qwennote: 'setup', wiki: 'setup', workspace: 'setup', config: 'setup',
          healthcheck: 'ops', storage: 'ops', budget: 'ops',
        };
        const readHiddenPrefs = () => {
          try {
            const stored = JSON.parse(localStorage.getItem(CARD_HIDDEN_KEY) || '{}');
            const migrated = {};
            for (const [oldCat, ids] of Object.entries(stored)) {
              for (const id of Array.isArray(ids) ? ids : []) {
                const cat = CATEGORY_MIGRATION[id] || oldCat;
                migrated[cat] = [...new Set([...(migrated[cat] || []), id])];
              }
            }
            return migrated;
          } catch (e) { return {}; }
        };
        const writeHiddenPrefs = prefs => { try { localStorage.setItem(CARD_HIDDEN_KEY, JSON.stringify(prefs)); } catch (e) { /* 无痕模式等场景静默降级为会话内记忆 */ } };
        // 面板级补充数据只在挂载、手动刷新和重绑工作区时读取；普通轮询只读快照。
        const useExtra = (workspacePath, tick) => {
          const [view, setView] = React.useState({ status: 'loading', data: null, errors: {} });
          React.useEffect(() => {
            const abort = new AbortController();
            if (!workspacePath) {
              setView({ status: 'ready', data: {}, errors: {} });
              return () => abort.abort();
            }
            setView(v => ({ status: 'loading', data: v.data, errors: v.errors || {} }));
            const out = {}, errors = {};
            const capture = (key, request) => request.then(result => { out[key] = result; }).catch(error => { errors[key] = error.message; });
            void Promise.all([
              capture('review', rpc('notes.queue', {}, abort.signal)),
              capture('memory', rpc('memory', { query: '', offset: 0 }, abort.signal)),
              capture('health', rpc('health', {}, abort.signal)),
              capture('roles', rpc('roles', {}, abort.signal)),
              capture('reminders', rpc('reminders', {}, abort.signal)),
              capture('digests', rpc('digests', {}, abort.signal)),
            ]).then(() => { if (!abort.signal.aborted) setView({ status: 'ready', data: out, errors }); });
            return () => abort.abort();
          }, [workspacePath, tick]);
          return { ...(view.data || {}), _status: view.status, _errors: view.errors || {} };
        };
        const capLine = (label, value) => h('div', { className: 'pa24-cap-line' }, h('span', { className: 'pa24-muted' }, label), h('b', null, value));
        // F35: 模式显示词收敛一处（config/workspace 两卡 label＋body 共用）。
        const modeLabel = config => (config && config.mode === 'feishu' ? L('飞书', 'Feishu') : L('体验', 'Demo'));
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
        // F34: 「需注意」档位统一口径——卡片描边、接入进度行与 tab 角标共用。
        const ATTENTION_TIERS = ['warn', 'error', 'missing'];

        function WorkDetail({ state, extra, button, busy, workspace, openRobot }) {
          const items = state.work || [];
          const activeItems = items.filter(j => ACTIVE_WORK.includes(j.status));
          const historyItems = items.filter(j => !ACTIVE_WORK.includes(j.status));
          const roles = extra.roles?.roles ?? [];
          const enabled = workspace?.config?.enabledWorkers ?? [];
          const stats = [
            ['pulse', 'blue', L('正在处理', 'In progress'), activeItems.length, L('含排队与等待', 'incl. queued and waiting')],
            ['check', 'blue', L('已完成', 'Completed'), items.filter(j => j.status === 'completed').length, L('历史事项', 'past items')],
            ['note', 'neutral', L('备忘已保存', 'Memos saved'), (state.memos ?? items.filter(j => j.role === 'memo' && j.status === 'completed')).length, L('随手记与资料', 'quick notes & material')],
          ];
          const jobCard = j => h('article', { className: 'pa24-job', key: j.id },
            h('div', { className: 'pa24-row pa24-between' }, h('h3', null, j.title), badgeOf(j.status)),
            h('p', { className: 'pa24-meta' }, (j.origin === 'local' ? L('dsh 会话', 'dsh session') : L('飞书', 'Feishu')) + ' · ' + roleName(j.role)),
            j.progress && h('p', { className: 'pa24-note' }, j.progress),
            j.result && h('details', null, h('summary', null, L('查看处理结果', 'View result')), h('div', { className: 'pa24-note' }, j.result)),
            j.child_session_id && button('external', L('查看 Worker 会话', 'Open worker session'), () => ctx.uiWorkspace.openSession({ childSessionId: j.child_session_id, parentSessionId: j.parent_session_id, mode: 'continuable' }), { className: 'pa24-quiet' }),
            h('p', { className: 'pa24-meta' }, L('事项编号：' + j.id, 'Item ' + j.id)));
          return h('div', null,
            h('div', { className: 'pa24-stats' }, stats.map(([name, tone, label, value, hint]) =>
              h('div', { key: label, className: 'pa24-stat' }, tile(name, tone), h('div', null, h('div', { className: 'pa24-stat-label' }, label), h('strong', null, value), h('small', null, hint))))),
            h('section', { className: 'pa24-card' }, sectionHead('tasks', L('正在办理的事项', 'Items in flight'), L('进行中、排队和等待本人的事项。', 'Active, queued, and waiting items.')),
              activeItems.length ? activeItems.map(jobCard) : empty('chat', 'blue', L('下一件事，交给24私助', 'Hand the next thing to 24PA'), L('在飞书或这里发一段话，机器人会安排合适的 Worker，并把进度与结果带回来。', 'Send a message here or on Feishu; the bot picks the right worker and brings back progress and results.'),
                [button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot, { key: 'chat', className: 'pa24-primary', disabled: busy || !workspace })]),
              !activeItems.length && h('div', { className: 'pa24-example' }, icon('info', { width: 16, height: 16 }), L('可以说：“记一下：下周讨论新的合作方向。”', 'Try: “Note: discuss the new partnership direction next week.”'))),
            historyItems.length > 0 && h('section', { className: 'pa24-card' }, sectionHead('check', L('历史事项', 'Item history'), L('已完成、未完成和已停止的事项。', 'Completed, failed, and stopped items.')), historyItems.map(jobCard)),
            h('section', { className: 'pa24-card' }, sectionHead('bot', L('Worker 可用状态', 'Worker availability'), L('启用来自当前配置；可用来自实际角色注册。', 'Enabled comes from config; availability comes from role registration.')),
              h('div', { className: 'pa24-ready' }, WORKER_IDS.map(id => {
                const role = roles.find(r => r.id === id);
                return h('div', { key: id, className: 'pa24-ready-item pa24-tone-' + (role?.available && enabled.includes(id) ? 'blue' : 'neutral') },
                  icon(role?.available && enabled.includes(id) ? 'check' : 'info', { width: 17, height: 17 }),
                  h('div', null, h('div', { className: 'pa24-row pa24-between' }, h('strong', null, roleName(id)),
                    h('span', { className: 'pa24-row' },
                      badge(enabled.includes(id) ? L('已启用', 'Enabled') : L('未启用', 'Disabled'), enabled.includes(id) ? 'blue' : 'neutral', enabled.includes(id) ? 'check' : 'close'),
                      role ? badge(role.available ? L('可用', 'Available') : L('不可用', 'Unavailable'), role.available ? 'blue' : 'amber', role.available ? 'check' : 'alert') : badge(L('尚未读取', 'Not read'), 'neutral', 'clock')))));
              }))));
        }

        function ActivityDetail({ state, button, openCard, tz }) {
          const workEvents = (state.work || []).map(j => ({
            id: 'work-' + j.id, at: j.updated_at || j.created_at, title: j.title, status: j.status,
            meta: (j.origin === 'local' ? L('本地会话', 'Local session') : L('飞书', 'Feishu')) + ' · ' + roleName(j.role), item: j, kind: 'work',
          }));
          const outboxKind = kind => ({ text: L('文本', 'Text'), card: L('卡片', 'Card'), audio: L('语音', 'Audio') }[kind] || kind);
          const outboxEvents = (state.outbox || []).map(o => ({
            id: 'outbox-' + o.id, at: o.sent_at || o.created_at, title: (o.channel === 'wecom' ? L('企微投递', 'WeCom delivery') : o.channel === 'local' ? L('本地投递', 'Local delivery') : L('飞书投递', 'Feishu delivery')) + ' · ' + outboxKind(o.kind),
            status: o.status, meta: o.dedup_key, item: o, kind: 'outbox',
          }));
          const events = [...workEvents, ...outboxEvents].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 40);
          return h('section', null,
            sectionHead('pulse', null, L('实际事项与投递的只读时间线；异常提供原因与下一步。', 'Read-only timeline of real work and deliveries, with causes and next steps.'),
              button('shield', L('查看健康报告', 'Open health report'), () => openCard('healthcheck'), { className: 'pa24-quiet' }), 'blue'),
            events.length === 0
              ? h('div', { className: 'pa24-card' }, empty('clock', 'neutral', L('暂无运行记录', 'No activity yet'), L('事项处理或消息投递后，实际记录会出现在这里。', 'Real work and delivery events will appear here.')))
              : h('div', { className: 'pa24-card' }, events.map(event => h('article', { key: event.id, className: 'pa24-job' },
                  h('div', { className: 'pa24-row pa24-between' }, h('h3', null, event.title), badgeOf(event.status)),
                  h('p', { className: 'pa24-meta' }, date(event.at, tz) + ' · ' + event.meta),
                  event.kind === 'work' && event.item.progress && h('p', { className: 'pa24-note' }, event.item.progress),
                  event.kind === 'work' && event.item.result && h('details', null, h('summary', null, L('处理结果与诊断', 'Result and diagnostics')), h('div', { className: 'pa24-note' }, event.item.result)),
                  event.kind === 'work' && event.item.child_session_id && button('external', L('查看内部会话', 'Open internal session'), () => ctx.uiWorkspace.openSession({ childSessionId: event.item.child_session_id, parentSessionId: event.item.parent_session_id, mode: 'continuable' }), { className: 'pa24-quiet' }),
                  event.kind === 'outbox' && event.item.last_error && h('div', { className: 'pa24-error' }, h('strong', null, L('投递异常', 'Delivery error')), h('p', null, event.item.last_error), h('p', null, L('下一步：核对对应渠道与身份后重试；结果未知时先核对远端，不要重复创建。', 'Next: verify the channel and identity before retrying. If the result is unknown, reconcile remotely first.')))))));
        }

        // 二级详情：运行就绪（原 work tab 区块移入运行与维护分类）。
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

        function BackupDetail({ state, config, button, openRobot }) {
          return h(React.Fragment, null,
            h(ReadinessDetail, { state }),
            h('section', { className: 'pa24-card' },
              sectionHead('folder', L('备份与恢复', 'Backup and recovery'), L('联合备份覆盖业务账本、工作区文件与 dsh 状态，创建和校验由本地24私助会话执行。', 'Joint backups cover the ledger, workspace files, and dsh state. Create and verify them in the local 24PA session.'),
                button('chat', L('通过对话管理备份', 'Manage backups in chat'), openRobot, { className: 'pa24-quiet' }), 'blue'),
              fields([
                [L('账本类型', 'Ledger type'), config?.storage === 'postgres' ? 'PostgreSQL' : 'SQLite'],
                [L('备份内容', 'Backup contents'), L('业务账本＋工作区文件＋dsh 状态及校验清单', 'Ledger + workspace + dsh state with a verification manifest')],
                [L('凭据边界', 'Credential boundary'), L('凭据值不进入备份，只保留环境变量引用名', 'Secret values stay out; only environment reference names are kept')],
                [L('最近备份结果', 'Latest backup'), L('面板不推断备份目录状态，以创建时的会话回报和校验结果为准', 'The panel does not guess; use the creation receipt and verification result')],
              ]),
              h('div', { className: 'pa24-helper' }, L('恢复前先执行备份校验；旧 Outbox 与远端对象先对账再继续发送，避免重复投递。', 'Verify a backup before restoring. Reconcile old outbox rows and remote objects before sending again.'))));
        }

        // arch-4: timezone resolves once through this helper — the snapshot
        // config is authoritative, the literal fallback covers the unbound state.
        const tzOf = state => (state.workspace && state.workspace.config ? state.workspace.config.timeZone : null) || 'Asia/Shanghai';

        // F22：wiki 资源行的查找与定档收敛一处（卡片 tier/body 与 WikiDetail 共用）。
        const wikiResource = state => (state.diagnostics && state.diagnostics.resources ? state.diagnostics.resources.find(r => r.id === 'wiki') : null);
        const resourceTierOf = row => (!row ? 'unchecked' : row.state === 'ok' ? 'ok' : ['error', 'mismatch'].includes(row.state) ? 'error' : row.state === 'missing' ? 'missing' : 'warn');

        // 二级详情：原 feishu tab 全量内容平移。
        function FeishuDetail({ state, busy, button, openRobot }) {
          const workspace = state.workspace, config = workspace ? workspace.config : null, tz = tzOf(state);
          const check = state.diagnostics;
          const cli = check ? check.cli : null;
          const auth = check ? check.auth : null;
          // arch-5: the resource tier cascade has one home (resourceTierOf);
          // diagnosis is only the badge rendering of it plus the unconfigured shell.
          const diagnosis = (item, configured = true) => !item
            ? statusBadge(configured ? 'unchecked' : 'missing')
            : statusBadge(resourceTierOf(item));
          const pendingOutbox = String((state.outbox || []).filter(o => ['pending', 'sending', 'unknown'].includes(o.status)).length) + L(' 条', ' pending');
          const resourceRows = [['folder', L('文档目录', 'Docs folder'), config ? config.folderToken : null, 'folder'], ['wiki', L('知识库', 'Wiki node'), config ? config.wikiNodeToken : null, 'wiki'], ['tasklist', L('任务清单', 'Task list'), config ? config.tasklistId : null, 'tasks'], ['calendar', L('本人日历', 'Owner calendar'), config ? config.calendarId : null, 'calendar']].map(([id, label, value]) => {
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

        // 二级详情：飞书知识库（F22 转正——落库节点配置与可读性诊断）。
        function WikiDetail({ state, button, openRobot }) {
          const config = state.workspace ? state.workspace.config : null;
          const row = wikiResource(state);
          return h('div', null,
            sectionHead('folder', L('飞书知识库', 'Feishu wiki'), L('备忘与手写待审文档的落库节点；未配置时回退文档目录。', 'Where memos and pending review docs land; falls back to the docs folder when unset.'),
              h('div', { className: 'pa24-row' },
                button('refresh', L('检查接入状态', 'Check access'), () => rpc('action', { type: 'connection.check' })),
                button('chat', L('通过对话配置', 'Configure in chat'), openRobot, { className: 'pa24-quiet' })), 'blue'),
            h('section', { className: 'pa24-card' },
              fields([
                [L('节点 token（wikiNodeToken）', 'Node token (wikiNodeToken)'), config && config.wikiNodeToken ? h('span', { className: 'pa24-ellip', title: config.wikiNodeToken }, config.wikiNodeToken) : L('未配置（可选）', 'Not configured (optional)')],
                [L('可读性诊断', 'Readability'), row ? row.message : L('尚未检查，点击上方按钮开始', 'Not checked yet — click the button above to start')],
                [L('落库去向', 'Landing target'), config && config.wikiNodeToken ? L('备忘与手写待审文档都建到该知识库节点下', 'Memos and pending review docs land under this wiki node') : L('回退文档目录（folderToken）', 'Falls back to the docs folder (folderToken)')],
              ]),
              h('div', { className: 'pa24-helper' }, L('待审文档直接建在知识库里，审核卡片即「写完了请审核」通知；批准或退回走版本状态机，文档位置不变。', 'Pending review docs are created inside the wiki; the review card is the “done, please review” notice. Approve/reject work through the version state machine and never move the doc.'))));
        }

        // 二级详情：QwenNote 听记（F18 WP3 的面板落点，状态来自维护健康）。
        function MinutesDetail({ state, extra, button, openRobot, openCard }) {
          const config = state.workspace ? state.workspace.config : null;
          const cap = extraToolCap(extra);
          const configured = qwennoteConfigured(config);
          return h('div', null,
            sectionHead('note', L('QwenNote 听记', 'QwenNote minutes'), L('录音卡转写/纪要/速记经 mcp__qwennote__* 工具进入本地24私助会话（仅本地会话；飞书入口与 Worker 不放行）。', 'Recorder transcripts, minutes, and quick notes reach the local 24PA session via mcp__qwennote__* tools (local session only; the Feishu entry and workers stay excluded).'),
              h('div', { className: 'pa24-row' },
                button('code', L('打开本地工具配置', 'Open local tool config'), () => openCard('config', 'pa24-extra-tools'), { className: 'pa24-quiet' }),
                button('chat', L('通过对话配置', 'Configure in chat'), openRobot, { className: 'pa24-quiet' })), 'amber'),
            h('section', { className: 'pa24-card' },
              fields([
                [L('工作区放行', 'Workspace allowance'), configured ? (config.extraLocalTools || []).join(L('、', ', ')) : L('尚未放行（可在参数表单的高级工具区配置）', 'Not allowed yet (configure in the advanced tools section)')],
                [L('通道健康', 'Channel health'), cap ? cap.message : L('尚无健康结论；在运行与维护读取健康状态后显示', 'No health verdict yet — shows after reading health under Operations & maintenance')],
                [L('工具状态', 'Tool status'), cap ? statusBadge(['ok', 'warn', 'error'].includes(cap.state) ? cap.state : 'unchecked') : statusBadge('unchecked')],
              ]),
              nextStrip(L('首次接入：profile 配置 dsh-mcp-client 条目（serverName qwennote）→ 本人浏览器完成一次授权 → 参数表单的高级工具区放行 mcp__qwennote__*。', 'First-time setup: add the dsh-mcp-client entry (serverName qwennote) to the profile → authorize once from your browser → allow mcp__qwennote__* in the advanced tools section of the config form.')),
              h('div', { className: 'pa24-helper' }, L('听记是按需读取的外部资料，不落业务账本；从中提炼的候选行动走既有审核与行动授权，不因来源是听记跳过确认。', 'Minutes are external material read on demand and never land in the ledger; candidate actions go through the existing review and action authorization — the source never skips confirmation.'))));
        }

        // F19：tts 引擎是否启用（多卡判断收敛一处；none/未配置都按关闭）。
        const voiceOn = config => !!config?.tts?.engine && config.tts.engine !== 'none';

        function ReminderDetail({ extra, config, tz, button, openRobot, refresh }) {
          const data = extra.reminders;
          const rules = data?.rules ?? [];
          const occurrences = data?.occurrences ?? [];
          const kindName = kind => ({ once: L('单次', 'Once'), every: L('按间隔', 'Interval'), daily: L('每日', 'Daily'), weekly: L('每周', 'Weekly') }[kind] || kind);
          const ruleStatus = status => {
            const meta = {
              active: [L('已启用', 'Active'), 'blue', 'check'], paused: [L('已暂停', 'Paused'), 'amber', 'clock'],
              stopped: [L('已停止', 'Stopped'), 'neutral', 'close'], completed: [L('已结束', 'Completed'), 'neutral', 'check'],
            }[status];
            return meta ? badge(...meta) : badgeOf(status);
          };
          const occurrenceStatus = status => status === 'skipped'
            ? badge(L('已跳过', 'Skipped'), 'neutral', 'close')
            : status === 'snoozed' ? badge(L('已稍后', 'Snoozed'), 'amber', 'clock') : badgeOf(status);
          return h('section', null,
            sectionHead('clock', L('提醒管理', 'Reminder management'), L('设置、稍后、暂停与休假通过24私助会话办理；这里核对真实规则与投递实例。', 'Edit reminders in chat; inspect actual rules and delivery occurrences here.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新', 'Refresh'), refresh, { className: 'pa24-quiet' }), button('chat', L('通过对话管理', 'Manage in chat'), openRobot)), 'amber'),
            extra._errors?.reminders && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, L('提醒读取失败', 'Failed to read reminders')), h('p', null, extra._errors.reminders)),
            !data && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取提醒…', 'Reading reminders…')),
            data && rules.length === 0 && occurrences.length === 0 && h('div', { className: 'pa24-card' }, empty('clock', 'amber', L('还没有提醒', 'No reminders yet'), L('告诉24私助要提醒的内容和时间，保存后可在这里核对。', 'Tell 24PA what and when to remind; saved rules will appear here.'), button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot, { className: 'pa24-primary' }))),
            rules.length > 0 && h('section', { className: 'pa24-card' }, sectionHead('tasks', L('提醒规则', 'Reminder rules'), L('启用状态、计划和下一次触发。', 'Status, schedule, and next trigger.')), rules.map(rule => h('article', { key: rule.ruleId, className: 'pa24-job' },
              h('div', { className: 'pa24-row pa24-between' }, h('h3', null, rule.text), ruleStatus(rule.status)),
              h('div', { className: 'pa24-row' }, badge(kindName(rule.kind), 'neutral', 'clock')),
              h('p', { className: 'pa24-meta' }, (rule.expression || rule.kind) + ' · ' + rule.timeZone),
              h('p', { className: 'pa24-meta' }, rule.nextDueAt ? L('下次触发 ', 'Next due ') + date(rule.nextDueAt, tz) : L('没有后续触发', 'No upcoming trigger')),
              rule.nextOccurrence && h('p', { className: 'pa24-meta' }, L('待发送实例 ', 'Pending occurrence ') + date(rule.nextOccurrence.dueAt, tz))))),
            occurrences.length > 0 && h('section', { className: 'pa24-card' }, sectionHead('pulse', L('最近投递实例', 'Recent occurrences'), L('到期、稍后、跳过、发送和异常状态。', 'Due, snoozed, skipped, sent, and failed occurrences.')), occurrences.slice(0, 12).map(row => h('article', { key: row.id, className: 'pa24-job' },
              h('div', { className: 'pa24-row pa24-between' }, h('h3', null, row.ruleId), occurrenceStatus(row.status)),
              h('p', { className: 'pa24-meta' }, L('计划时间 ', 'Due ') + date(row.dueAt, tz) + (row.deferredUntil ? L(' · 稍后到 ', ' · Snoozed until ') + date(row.deferredUntil, tz) : ''))))),
            h('p', { className: 'pa24-meta' }, L('提醒内容经24私助会话调整；投递出口：', 'Edit reminders in chat. Delivery outlet: ') + (config?.notifyChannel === 'wecom' ? L('企微', 'WeCom') : L('飞书', 'Feishu'))));
        }

        function DigestDetail({ extra, state, config, tz, button, openRobot, openCard, refresh }) {
          const plans = extra.digests?.plans ?? [];
          const skills = extra.digests?.skills ?? [];
          const on = voiceOn(config);
          const tts = state.tts;
          const probe = tts?.probe?.result;
          const engineLine = !on
            ? L('语音版未启用：可在参数表单的「语音 TTS」分组选择引擎。', 'Voice is off: choose an engine in the Voice TTS section of the config form.')
            : L(`语音引擎：${config.tts.engine}${tts?.voice ? ' · ' + tts.voice : ''}`, `Voice engine: ${config.tts.engine}${tts?.voice ? ' · ' + tts.voice : ''}`);
          const scheduleText = plan => {
            const schedule = plan.schedule || {};
            if (schedule.daily) return L('每日 ', 'Daily ') + schedule.daily.time + ' · ' + (schedule.daily.time_zone || config?.timeZone);
            if (schedule.weekly) return L('每周 ', 'Weekly, weekdays ') + (schedule.weekly.weekdays || []).join(L('、', ', ')) + ' ' + schedule.weekly.time + ' · ' + (schedule.weekly.time_zone || config?.timeZone);
            if (schedule.at) return L('单次 · ', 'Once · ') + date(schedule.at, tz);
            if (schedule.after_seconds) return L('单次 · ', 'Once · after ') + schedule.after_seconds + L(' 秒后', 's');
            return L('计划时间见原生 Schedule', 'See native Schedule');
          };
          const planStatus = status => status === 'active' ? badge(L('已启用', 'Active'), 'blue', 'check') : status === 'paused' ? badge(L('已暂停', 'Paused'), 'amber', 'clock') : badge(L('已停止', 'Stopped'), 'neutral', 'close');
          const planKind = kind => ({ morning: L('晨报', 'Morning digest'), evening: L('晚间回顾', 'Evening review'), weekly: L('每周回顾', 'Weekly review'), once: L('一次性简报', 'One-off digest') }[kind] || kind);
          // F40（spec 2.11）：计划行配置面——时间内联编辑、语音开关、skill 选择、立即运行一次。
          const PlanCard = ({ plan, skills, config, button, refresh }) => {
            const [time, setTime] = React.useState((plan.schedule?.daily ?? plan.schedule?.weekly)?.time ?? '');
            const [busy, setBusy] = React.useState(false);
            const [note, setNote] = React.useState('');
            const [error, setError] = React.useState('');
            const editable = plan.status === 'active' && (plan.schedule?.daily || plan.schedule?.weekly);
            const act = async (fn, okText) => {
              setBusy(true); setError(''); setNote('');
              try {
                const r = await fn();
                setNote(okText + (r?.message ? '：' + r.message : ''));
                await refresh();
              } catch (e) {
                setError(e.message);
              } finally { setBusy(false); }
            };
            const saveTime = () => act(
              () => rpc('action', { type: 'digest.reschedule', planId: plan.planId, kind: plan.kind, time, weekdays: plan.schedule?.weekly?.weekdays }),
              L('已改时间', 'Rescheduled'));
            const toggleVoice = () => act(
              () => rpc('action', { type: 'digest.set-voice', planId: plan.planId, voice: !plan.voice }),
              plan.voice ? L('已切为纯文本', 'Switched to text') : L('已开启语音版', 'Voice enabled'));
            const setSkill = skill => act(() => rpc('action', { type: 'digest.set-skill', planId: plan.planId, skill }), L('已换 skill', 'Skill updated'));
            const runNow = () => act(() => rpc('action', { type: 'digest.run-now', planId: plan.planId }), L('已生成', 'Generated'));
            return h('article', { key: plan.planId, className: 'pa24-job' },
              h('div', { className: 'pa24-row pa24-between' }, h('h3', null, plan.title || planKind(plan.kind)), planStatus(plan.status)),
              h('div', { className: 'pa24-row', style: { flexWrap: 'wrap' } },
                badge(plan.voice ? L('语音＋文本', 'Voice + text') : L('纯文本', 'Text only'), 'neutral', plan.voice ? 'bot' : 'note'),
                badge(L('skill ', 'Skill ') + (plan.skill || '—'), 'neutral', 'code')),
              h('p', { className: 'pa24-meta' }, scheduleText(plan)),
              plan.pendingChange && h('p', { role: 'alert', className: 'pa24-error' },
                L('计划变更尚未确认：', 'Plan change is not confirmed: ') + (plan.pendingChange.error || L('正在核对原计划，请勿重复创建。', 'Checking the original plan; do not create a duplicate.'))),
              plan.lastWindow && h('p', { className: 'pa24-meta' }, L('最近窗口 ', 'Last window ') + plan.lastWindow),
              editable && h('div', { className: 'pa24-row', style: { flexWrap: 'wrap', alignItems: 'center', gap: 8 } },
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pa-muted)' } },
                  L('时间 ', 'Time '),
                  h('input', { type: 'time', step: 1, value: time, onChange: e => setTime(e.target.value), disabled: busy, style: { width: 110, minHeight: 34 } }),
                  button('check', L('保存', 'Save'), saveTime, { disabled: busy || !time, className: 'pa24-quiet' })),
                button(plan.voice ? 'note' : 'bot', plan.voice ? L('关语音', 'Voice off') : L('开语音', 'Voice on'), toggleVoice, { disabled: busy, className: 'pa24-quiet' }),
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pa-muted)' } },
                  L('skill ', 'Skill '),
                  h('select', { value: plan.skill || '', onChange: e => e.target.value !== plan.skill && setSkill(e.target.value), disabled: busy, style: { width: 190, minHeight: 34 } },
                    skills.map(s => h('option', { key: s.name, value: s.name },
                      s.name + (s.track === 'template' ? '' : L('（agent 轨·模型执行）', ' (agent track·model-run)')))))),
                button('play', L('立即运行一次', 'Run now'), runNow, { disabled: busy, className: 'pa24-quiet' })),
              error && h('p', { role: 'alert', style: { color: 'var(--pa-danger, #b42318)', fontSize: 12, margin: '4px 0' } }, error),
              note && h('p', { style: { color: 'var(--pa-green, #1f7a4d)', fontSize: 12, margin: '4px 0' } }, note),
              (plan.recent ?? []).length > 0 && h('details', null,
                h('summary', null, L('最近执行记录', 'Recent runs')),
                plan.recent.map((run, i) => h('p', { key: i, className: 'pa24-meta' }, run.window + ' · ' + (t(run.status) || run.status) + (run.completedAt ? ' · ' + date(run.completedAt, tz) : '')))),
              h('details', null,
                h('summary', null, L('技术标识', 'Technical IDs')),
                h('p', { className: 'pa24-meta' }, plan.planId + (plan.scheduleId ? ' · ' + plan.scheduleId : ''))));
          };
          return h('section', null,
            sectionHead('pulse', L('周期服务计划', 'Scheduled service plans'), L('按计划直接改时间、语音与任务 skill，并可立即运行一次；复杂变更仍通过24私助会话。', 'Edit time, voice, and task skill per plan and run once on demand; complex changes stay in chat.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新', 'Refresh'), refresh, { className: 'pa24-quiet' }), button('chat', L('通过对话调整', 'Adjust in chat'), openRobot)), 'green'),
            extra._errors?.digests && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, L('计划读取失败', 'Failed to read plans')), h('p', null, extra._errors.digests)),
            !extra.digests && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取周期计划…', 'Reading digest plans…')),
            extra.digests && plans.length === 0 && h('div', { className: 'pa24-card' }, empty('pulse', 'green', L('还没有周期服务计划', 'No digest plans yet'), L('对24私助说「开启晨报」或「开启每周回顾」即可建立计划。', 'Ask 24PA to enable the morning digest or weekly retrospective.'), button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot, { className: 'pa24-primary' }))),
            plans.length > 0 && h('section', { className: 'pa24-card' }, plans.map(p => h(PlanCard, { key: p.planId, plan: p, skills, tz, config, button, refresh }))),
            h('section', { className: 'pa24-card' },
              sectionHead('bot', L('语音 TTS', 'Voice TTS'), L('语音版到点先送达语音，随后紧跟全文文本。', 'Voice plans deliver audio first, then the full text.'),
                button('code', L('打开语音配置', 'Open voice config'), () => openCard('config', 'pa24-tts-config'), { className: 'pa24-quiet' }), 'green'),
              h('div', { className: 'pa24-note' },
                h('p', { className: 'pa24-meta' }, engineLine),
                probe ? h('p', { className: 'pa24-meta' }, (probe.ready ? L('引擎预检通过。', 'Engine probe passed.') : L('引擎预检未通过：', 'Engine probe failed: ') + (probe.problems || []).join('；'))) : h('p', { className: 'pa24-meta' }, L('尚未预检（引擎/密钥/依赖存在性只读检查）。', 'Not probed yet (read-only check of engine/key/dependencies).')),
                on && h('p', { className: 'pa24-meta' }, L('引擎、音色与密钥引用均在参数表单维护。', 'Manage the engine, voice, and secret reference in the config form.'))),
              h('div', { className: 'pa24-row' },
                button('refresh', L('检测语音引擎', 'Probe voice engine'), () => rpc('action', { type: 'tts.probe' }), { className: 'pa24-quiet' }),
                on && button('bot', L('发一条测试语音', 'Send a test voice'), () => rpc('action', { type: 'tts.test' }), { key: 'test', className: 'pa24-quiet' }))));
        }

        // 卡片注册表：tier 为纯函数（角标聚合复用同一结果）；label 可覆盖状态词。
        const CARDS = [
          {
            id: 'work', cat: 'work', tone: 'blue', icon: 'grid', title: ['事项', 'Items'], sub: ['进行中的委派与等待', 'Delegations in flight and waiting'], action: ['查看事项', 'Open items'],
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
            id: 'activity', cat: 'work', tone: 'blue', icon: 'pulse', title: ['运行记录', 'Activity'], sub: ['事项与投递时间线', 'Work and delivery timeline'], action: ['查看时间线', 'Open timeline'],
            tier: ({ state }) => (state.work || []).some(j => ['failed', 'needs_reconciliation'].includes(j.status)) || (state.outbox || []).some(o => ['failed', 'unknown'].includes(o.status)) ? 'warn' : 'ok',
            body: ({ state, tz }) => {
              const work = state.work || [], outbox = state.outbox || [];
              const latest = [...work.map(j => j.updated_at || j.created_at), ...outbox.map(o => o.sent_at || o.created_at)].filter(Boolean).sort().pop();
              return h('div', null, capLine(L('事项记录', 'Work records'), work.length + L(' 条', '')), capLine(L('最近活动', 'Latest activity'), latest ? date(latest, tz) : L('尚无记录', 'No record yet')));
            },
            detail: helpers => h(ActivityDetail, helpers),
          },
          {
            id: 'reminders', cat: 'work', tone: 'amber', icon: 'clock', title: ['提醒', 'Reminders'], sub: ['账本触发 · 模型离线仍送达', 'Ledger-fired · delivered even with the model offline'], action: ['管理提醒', 'Manage reminders'],
            tier: ({ state }) => ((state.outbox || []).some(o => o.status === 'unknown') ? 'warn' : 'ok'),
            body: ({ state, config, extra }) => {
              const pending = (state.outbox || []).filter(o => ['pending', 'sending'].includes(o.status)).length;
              const rules = extra.reminders?.rules?.length;
              return h('div', null, capLine(L('提醒规则', 'Reminder rules'), rules == null ? L('读取中…', 'Loading…') : rules + L(' 条', '')), capLine(L('待发 / 出口', 'Pending / outlet'), pending + L(' 条 / ', ' / ') + (config && config.notifyChannel === 'wecom' ? L('企微', 'WeCom') : L('飞书', 'Feishu'))));
            },
            detail: helpers => h(ReminderDetail, helpers),
          },
          {
            id: 'review', cat: 'knowledge', tone: 'danger', icon: 'pen', title: ['手写审核', 'Handwriting review'], sub: ['待审文档与版本核验', 'Pending versions & verification'], action: ['打开审核', 'Open review'],
            tier: ({ extra }) => (extra.review ? (extra.review.count > 0 ? 'warn' : 'ok') : 'unchecked'),
            label: ({ extra }) => (extra.review && extra.review.count > 0 ? L('待审 ' + extra.review.count, extra.review.count + ' to review') : null),
            body: ({ extra }) => (extra.review && extra.review.count > 0
              ? h('div', null, capLine(L('待审版本', 'Awaiting review'), extra.review.count + L(' 份', '')), h('p', { className: 'pa24-meta' }, L('批准/退回在飞书审核卡上完成', 'Approve/return happens on the Feishu review card')))
              : h('p', { className: 'pa24-meta' }, L('拍照整理后的待审版本会出现在这里', 'Pending versions from photographed notes appear here'))),
            detail: helpers => (helpers.workspace ? h(ReviewView, { key: helpers.workspace.path, workspace: helpers.workspace, openRobot: helpers.openRobot }) : empty('pen', 'blue', L('尚未绑定工作区', 'No workspace bound'), L('在接入与设置的「工作区与配置」绑定工作区后，手写审核队列会显示在这里。', 'Bind a workspace via Workspace & config under Connections & setup and the review queue will show up here.'))),
          },
          {
            id: 'memory', cat: 'knowledge', tone: 'violet', icon: 'memory', title: ['结构化记忆', 'Structured memory'], sub: ['偏好 · 事实 · 项目背景', 'Preferences · facts · project background'], action: ['检索记忆', 'Search memories'],
            tier: ({ state }) => (state.workspace ? 'ok' : 'missing'),
            body: ({ extra }) => (extra.memory ? capLine(L('已保存', 'Stored'), extra.memory.total + L(' 条', '')) : h('p', { className: 'pa24-meta' }, L('读取中…', 'Loading…'))),
            detail: helpers => (helpers.workspace ? h(MemoryView, { key: helpers.workspace.path, workspace: helpers.workspace, openRobot: helpers.openRobot }) : empty('memory', 'violet', L('尚未绑定工作区', 'No workspace bound'), L('绑定工作区后，记忆会按确认状态显示在这里。', 'Once a workspace is bound, memories show up here with their confirmation status.'))),
          },
          {
            id: 'digest', cat: 'work', tone: 'green', icon: 'pulse', title: ['晨报与复盘', 'Digest & retrospective'], sub: ['周期服务 · 原生定时唤醒 · 语音版', 'Scheduled services · native Schedule wake · voice'], action: ['调整计划', 'Adjust plans'],
            tier: ({ extra }) => extra.digests ? 'ok' : 'unchecked',
            body: ({ extra, config }) => {
              const plans = extra.digests?.plans;
              return h('div', null,
                capLine(L('周期计划', 'Digest plans'), plans ? plans.filter(p => p.status === 'active').length + L(' 条启用', ' active') : L('读取中…', 'Loading…')),
                capLine(L('语音引擎', 'Voice engine'), voiceOn(config) ? config.tts.engine : L('未启用', 'Off')));
            },
            detail: helpers => h(DigestDetail, helpers),
          },
          {
            id: 'feishu', cat: 'setup', tone: 'green', icon: 'plug', title: ['飞书', 'Feishu'], sub: ['唯一收信入口 · 发件与审核卡', 'The only inbound · outbound & review cards'], action: ['接入详情', 'Access details'],
            tier: ({ state, config }) => {
              if (config?.mode !== 'feishu') return 'unchecked';
              if (!state.transport?.connected) return 'warn';
              const check = state.diagnostics;
              if (!check?.auth) return 'unchecked';
              const rows = [check.auth, ...(check.resources ?? [])];
              if (rows.some(row => ['error', 'mismatch'].includes(row.state))) return 'error';
              if (rows.some(row => row.state === 'missing')) return 'warn';
              if (rows.some(row => row.state !== 'ok')) return 'unchecked';
              return 'ok';
            },
            body: ({ state }) => h('div', null,
              capLine(L('消息通道', 'Messaging'), state.transport && state.transport.connected ? L('长连接已启动', 'Connected') : L('未启动', 'Not started')),
              capLine(L('CLI 授权', 'CLI auth'), state.diagnostics && state.diagnostics.auth ? (state.diagnostics.auth.state === 'ok' ? L('有效', 'Valid') : state.diagnostics.auth.message) : L('尚未检查', 'Not checked'))),
            detail: helpers => h(FeishuDetail, helpers),
          },
          {
            id: 'wecom', cat: 'setup', tone: 'amber', icon: 'bot', title: ['企业微信', 'WeCom'], sub: ['日程/待办第二渠道 · 单向推送', 'Second channel for calendar/todo · one-way push'], action: ['接入详情', 'Access details'],
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
                capLine(L('上次检查', 'Last check'), state.wecom ? date(state.wecom.checkedAt, tzOf(state)) : L('尚未检查', 'Not checked'))),
            detail: helpers => h(WecomView, helpers),
          },
          {
            id: 'qwennote', cat: 'setup', tone: 'amber', icon: 'note', title: ['QwenNote 听记', 'QwenNote minutes'], sub: ['录音卡转写 · 纪要 · 速记', 'Recorder transcripts · minutes · quick notes'], action: ['接入详情', 'Access details'],
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
            // F22：知识库落库转正——已配置按诊断行定档，未配置保持「未检查或
            // 未启用」档（可选能力不催办，与占位期进度口径一致）。
            id: 'wiki', cat: 'setup', tone: 'blue', icon: 'folder', title: ['飞书知识库', 'Feishu wiki'], sub: ['备忘/待审文档落库节点', 'Where memos and pending docs land'], action: ['查看详情', 'Access details'],
            tier: ({ state, config }) => (!config || !config.wikiNodeToken ? 'unchecked' : resourceTierOf(wikiResource(state))),
            label: ({ state, config }) => (!config || !config.wikiNodeToken ? L('未配置（可选）', 'Not configured (optional)') : null),
            body: ({ state, config }) => {
              const row = wikiResource(state);
              return h('div', null,
                capLine(L('节点 token', 'Node token'), config && config.wikiNodeToken
                  ? h('span', { className: 'pa24-ellip', title: config.wikiNodeToken }, config.wikiNodeToken)
                  : L('未配置——备忘与待审文档回退文档目录', 'Not set — memos and pending docs fall back to the docs folder')),
                capLine(L('可读性', 'Readability'), row ? row.message : L('尚未检查', 'Not checked')));
            },
            detail: helpers => h(WikiDetail, helpers),
          },
          {
            id: 'workspace', cat: 'setup', tone: 'blue', icon: 'folder', title: ['工作区与配置', 'Workspace & config'], sub: ['绑定 · 切换 · 生效配置 · 健康预算', 'Bind · switch · effective config · health'], action: ['管理工作区', 'Manage workspace'],
            tier: ({ state }) => (state.workspace ? 'ok' : 'missing'),
            body: ({ state, config }) => (state.workspace
              ? h('div', null,
                capLine(L('当前目录', 'Directory'), h('span', { className: 'pa24-ellip', title: state.workspace.path }, state.workspace.path)),
                capLine(L('模式 / 存储', 'Mode / storage'), modeLabel(config) + ' / ' + (config && config.storage === 'postgres' ? 'PostgreSQL' : 'SQLite')))
              : h('p', { className: 'pa24-meta' }, L('尚未绑定工作区——点开本卡选择并绑定。', 'No workspace bound yet — open this card to pick and bind one.'))),
            detail: helpers => h(WorkspaceDetail, { key: 'workspace', helpers }),
          },
          {
            id: 'healthcheck', cat: 'ops', tone: 'blue', icon: 'shield', title: ['全应用健康检查', 'Full-app health check'], sub: ['一键全量检查与总体结论', 'One-click full check & verdict'], action: ['全量报告', 'Full report'],
            tier: helpers => healthAggregate(helpers).tier,
            body: helpers => {
              const a = healthAggregate(helpers);
              const last = lastActiveCheck(helpers.state);
              const pending = a.warn + a.error;
              // F34: 口径单位明确化——数字是「检查项」，tab 角标是「卡片」；
              // 未跑主动检查时说明当前结论来自静态聚合，消除「有数字却说未检查」的矛盾。
              return h('div', null,
                capKpi([[String(a.ok), L('正常', 'OK')], [String(a.warn), L('待核验', 'Needs review')], [String(a.error), L('需要处理', 'Needs attention')]]),
                h('p', { className: 'pa24-meta', style: { marginTop: 6 } }, last ? L('最近主动检查 ' + date(last.toISOString(), helpers.tz) + '；以下数字按检查项计', 'Last active check ' + date(last.toISOString(), helpers.tz) + '; counts below are per check item') : L('尚未执行主动检查；以上为就绪与能力健康的静态聚合，按检查项计', 'No active check yet; the counts above are the passive readiness/capability aggregate, per check item')),
                pending > 0 && nextStrip(L('共 ' + (a.ok + a.warn + a.error) + ' 项检查：待核验 ' + a.warn + ' · 需要处理 ' + a.error + '——打开全量报告查看处理建议。', (a.ok + a.warn + a.error) + ' checks total: ' + a.warn + ' need review · ' + a.error + ' need attention — open the full report for next steps.')));
            },
            quick: helpers => helpers.button('refresh', helpers.busy ? L('检查中…', 'Checking…') : L('一键全量检查', 'Run full check'), () => helpers.run(helpers.runFullCheck), { disabled: helpers.busy }),
            detail: helpers => h(HealthReportDetail, { key: 'healthcheck', helpers }),
          },
          {
            id: 'storage', cat: 'ops', tone: 'blue', icon: 'folder', title: ['账本与备份', 'Ledger & backup'], sub: ['业务状态唯一权威', 'The single source of business truth'], action: ['运行与备份', 'Readiness and backup'],
            tier: ({ state }) => readinessTier(state, ['postgres', 'workspace']),
            body: ({ state }) => {
              const rows = (state.readiness?.items || []).filter(i => ['postgres', 'workspace'].includes(i.id));
              return h('div', null, rows.length ? rows.map(r => capLine(r.id === 'postgres' ? L('业务账本', 'Ledger') : L('工作区', 'Workspace'), r.state === 'ok' ? L('正常', 'OK') : r.message)) : h('p', { className: 'pa24-meta' }, L('读取中…', 'Loading…')));
            },
            detail: helpers => h(BackupDetail, helpers),
          },
          {
            id: 'config', cat: 'setup', tone: 'blue', icon: 'code', title: ['参数配置', 'Configuration'], sub: ['七组配置 · 校验写回', 'Seven sections · validated write-back'], action: ['打开表单', 'Open form'],
            tier: ({ state }) => (state.workspace?.configError ? 'warn' : 'ok'),
            body: ({ config, state }) => (config ? h('div', null,
              capLine(L('模式', 'Mode'), modeLabel(config)),
              capLine(L('渠道', 'Channels'), [config.calendarChannel, config.todoChannel, config.notifyChannel].map(v => (v === 'wecom' ? L('企微', 'WeCom') : L('飞书', 'Feishu'))).join(' / ')),
              capLine(L('存储', 'Storage'), config.storage === 'postgres' ? 'PostgreSQL' : 'SQLite'),
              state.workspace?.configError && h('p', { className: 'pa24-meta', style: { color: 'var(--pa-danger)' } }, state.workspace.configError))
              : h('p', { className: 'pa24-meta' }, L('尚未绑定工作区', 'No workspace bound'))),
            detail: helpers => h(ConfigFormDetail, { key: 'config', helpers }),
          },
          {
            id: 'budget', cat: 'ops', tone: 'green', icon: 'pulse', title: ['模型与预算', 'Models & budget'], sub: ['路由 · 用量 · 健康判定', 'Routing · usage · health verdict'], action: ['健康报告', 'Health report'],
            tier: ({ extra }) => (extra.health ? 'ok' : 'unchecked'),
            body: ({ extra }) => (extra.health && extra.health.usage
              ? h('div', null, capLine(L('模型轮次', 'Model turns'), extra.health.usage.modelTurns ?? '—'), capLine(L('发送队列', 'Outbox queued'), extra.health.usage.outboxQueued ?? '—'))
              : h('p', { className: 'pa24-meta' }, L('读取中…', 'Loading…'))),
            detail: helpers => h(HealthBlock, { data: helpers.extra.health, title: L('模型与预算', 'Models & budget') }),
          },
        ];
        const CARD_ORDER = ['work', 'reminders', 'digest', 'activity', 'review', 'memory', 'feishu', 'wecom', 'qwennote', 'wiki', 'workspace', 'config', 'healthcheck', 'budget', 'storage'];
        CARDS.sort((a, b) => CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id));
        const ACCESS_CARD_IDS = new Set(['feishu', 'wecom', 'qwennote', 'wiki']);

        // 二级详情：全应用健康检查——聚合结论＋运行就绪＋能力健康报告。
        function HealthReportDetail({ helpers }) {
          const { state } = helpers;
          const a = healthAggregate(helpers);
          const last = lastActiveCheck(state);
          const nextSteps = [...new Set([...(state.diagnostics?.nextSteps ?? []), ...(state.wecom?.nextSteps ?? [])])];
          return h('div', null,
            sectionHead('shield', null, L('聚合运行就绪、能力健康与消息通道的总体结论；一键全量检查会对飞书（及启用的企微渠道）发起只读平台探测。', 'An aggregated verdict over readiness, capability health, and messaging; the one-click full check runs read-only probes against Feishu (and any enabled WeCom channel).'),
              h('div', { className: 'pa24-row' }, helpers.button('refresh', helpers.busy ? L('检查中…', 'Checking…') : L('一键全量检查', 'Run full check'), () => helpers.run(helpers.runFullCheck), { disabled: helpers.busy, className: 'pa24-primary' })), 'blue'),
            h('section', { className: 'pa24-card' },
              h('div', { className: 'pa24-stats' }, [
                ['check', 'blue', L('正常', 'OK'), a.ok, L('各域健康', 'healthy domains')],
                ['clock', 'amber', L('待核验', 'Needs review'), a.warn, L('有处理建议', 'has next steps')],
                ['alert', 'danger', L('需要处理', 'Needs attention'), a.error, L('阻断对应能力', 'blocks its capability')],
              ].map(([name, tone, label, value, hint]) =>
                h('div', { key: label, className: 'pa24-stat' }, tile(name, tone), h('div', null, h('div', { className: 'pa24-stat-label' }, label), h('strong', null, value), h('small', null, hint))))),
              h('p', { className: 'pa24-meta' }, last ? L('最近主动检查：' + date(last.toISOString(), helpers.tz), 'Last active check: ' + date(last.toISOString(), helpers.tz)) : L('尚未执行主动检查——点击右上方按钮开始（只读，不创建平台对象）。', 'No active check yet — click the button above to start (read-only, creates no platform objects).'))),
            h(ReadinessDetail, { state }),
            h(HealthBlock, { data: helpers.extra.health }),
            nextSteps.length > 0 && h('details', null, h('summary', null, L('处理建议', 'Next steps')), nextSteps.map((step, i) => h('p', { key: i, className: 'pa24-note' }, step))));
        }

        // F33/P60: 参数配置表单——七组配置（F36 增密钥组）。保存＝workspace.config-update
        // （服务端校验→AGENTS.md 唯一 json 块替换→重载）；失败保留输入并显示
        // 字段级错误。storage/version/密钥引用名不在表单（白名单在服务端强制）。
        function ConfigFormDetail({ helpers }) {
          const { config, state } = helpers;
          // arch-4: the voice list rides the snapshot's configMeta (single
          // source in config.ts) — client.js no longer carries a second copy.
          const VOICES = (state.configMeta && state.configMeta.fields ? state.configMeta.fields : [])
            .find(f => f.name === 'tts.voice')?.options ?? [];
          const KNOWN_EXTRA = ['subagent_codex', 'subagent_claude_code', 'mcp__qwennote__*'];
          const makeForm = (config = helpers.config) => ({
            mode: config?.mode ?? 'demo',
            larkProfile: config?.larkProfile ?? '',
            ownerOpenId: config?.ownerOpenId ?? '',
            timeZone: config?.timeZone ?? 'Asia/Shanghai',
            calendarChannel: config?.calendarChannel ?? 'feishu',
            todoChannel: config?.todoChannel ?? 'feishu',
            notifyChannel: config?.notifyChannel ?? 'feishu',
            folderToken: config?.folderToken ?? '',
            wikiNodeToken: config?.wikiNodeToken ?? '',
            tasklistId: config?.tasklistId ?? '',
            calendarId: config?.calendarId ?? 'primary',
            maxWorkers: config?.maxWorkers ?? 2,
            enabledWorkers: [...(config?.enabledWorkers ?? ['memo'])],
            workerModels: JSON.parse(JSON.stringify(config?.workerModels ?? {})),
            extraKnown: KNOWN_EXTRA.filter(x => (config?.extraLocalTools ?? []).includes(x)),
            extraSkills: (config?.extraBusinessSkills ?? []).join(', '),
            tts: { engine: config?.tts?.engine ?? 'none', voice: config?.tts?.voice ?? '', volcKeyEnv: config?.tts?.volcKeyEnv ?? '', meloDir: config?.tts?.meloDir ?? '' },
            appIdEnv: config?.appIdEnv ?? 'PA24_FEISHU_APP_ID',
            appSecretEnv: config?.appSecretEnv ?? 'PA24_FEISHU_APP_SECRET',
            pgDsnEnv: config?.pgDsnEnv ?? 'PA24_PG_DSN',
          });
          const [form, setForm] = React.useState(makeForm);
          // Polling may change the effective config while this draft is open.
          // Compare with its stable editing baseline, never a newer snapshot.
          const [baseline, setBaseline] = React.useState(makeForm);
          const sourceConfig = React.useRef(config);
          const [saveState, setSaveState] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const configDirty = JSON.stringify(form) !== JSON.stringify(baseline);
          const set = (key, value) => { setForm(f => ({ ...f, [key]: value })); setSaveState(null); };
          const setTts = (key, value) => { setForm(f => ({ ...f, tts: { ...f.tts, [key]: value } })); setSaveState(null); };
          const authOpenId = state.diagnostics?.auth?.openId;
          // F34: diagnostics 未加载时不再断言「尚未取得授权身份」（走查 P3）。
          const diagChecked = !!(state.diagnostics && state.diagnostics.checkedAt);
          const withFieldId = (node, id) => {
            let assigned = false;
            const visit = current => {
              if (!React.isValidElement(current)) return current;
              if ((current.type === 'input' || current.type === 'select') && !assigned) {
                assigned = true;
                return React.cloneElement(current, { id });
              }
              if (current.props?.children) return React.cloneElement(current, undefined, ...React.Children.map(current.props.children, visit));
              return current;
            };
            return visit(node);
          };
          const row = (label, control, hint) => {
            const id = 'pa24-field-' + String(label).replace(/[^\p{L}\p{N}]+/gu, '-');
            return h('div', { key: id, className: 'pa24-form-row' }, h('label', { htmlFor: id }, label), h('div', { style: { minWidth: 0 } }, withFieldId(control, id), hint && h('p', { className: 'pa24-meta', style: { marginTop: 2, marginBottom: 0 } }, hint)));
          };
          const txt = (value, onSet, extra = {}) => h('input', { type: 'text', value, onChange: e => onSet(e.target.value), ...extra });
          const sel = (options, value, onSet) => h('select', { value, onChange: e => onSet(e.target.value) }, options.map(([v, l]) => h('option', { key: v, value: v }, l)));
          // 粘贴飞书链接自动提取末段 token（folder/tasklist 链接形态）。
          const extractToken = v => { const s = String(v).trim(); if (!s.includes('://')) return s; const q = s.match(/[?&](?:token|node_token|guid)=([A-Za-z0-9_-]{10,})/); if (q) return q[1]; const tail = s.split('?')[0].split('/').filter(Boolean).pop() || ''; return /^[A-Za-z0-9_-]{16,}$/.test(tail) ? tail : s; };
          const toggleIn = key => (value, on) => setForm(f => { const cur = new Set(f[key]); if (on) cur.add(value); else cur.delete(value); return { ...f, [key]: [...cur] }; });
          const wmGet = role => form.workerModels[role] || {};
          const wmSet = (role, patch) => { setForm(f => ({ ...f, workerModels: { ...f.workerModels, [role]: { ...(f.workerModels[role] || {}), ...patch } } })); setSaveState(null); };
          const roleRows = [...new Set([...(form.enabledWorkers || []), ...Object.keys(form.workerModels)])].filter(r => WORKER_IDS.includes(r) || form.workerModels[r]);
          const normalize = draft => {
              const form = draft;
              const models = {};
              for (const [role, route] of Object.entries(form.workerModels)) {
                const provider = String(route.provider || '').trim(), model = String(route.model || '').trim();
                models[role] = { provider, model, simplePersona: !!route.simplePersona };
              }
              const extra = [...new Set([...form.extraKnown, ...(sourceConfig.current?.extraLocalTools ?? []).filter(v => !KNOWN_EXTRA.includes(v))])];
              const skills = (form.extraSkills || '').split(/[,，\n]/).map(x => x.trim()).filter(Boolean);
              return {
                mode: form.mode, larkProfile: form.larkProfile.trim(), ownerOpenId: form.ownerOpenId.trim(), timeZone: form.timeZone.trim(),
                calendarChannel: form.calendarChannel, todoChannel: form.todoChannel, notifyChannel: form.notifyChannel,
                folderToken: form.folderToken.trim(), wikiNodeToken: form.wikiNodeToken.trim(), tasklistId: form.tasklistId.trim(), calendarId: form.calendarId.trim(),
                maxWorkers: Number(form.maxWorkers), enabledWorkers: form.enabledWorkers, workerModels: models, extraLocalTools: extra, extraBusinessSkills: skills,
                appIdEnv: form.appIdEnv.trim(), appSecretEnv: form.appSecretEnv.trim(), pgDsnEnv: form.pgDsnEnv.trim(),
                tts: form.tts,
              };
          };
          const adoptSaved = saved => {
            sourceConfig.current = saved;
            const canonical = makeForm(saved);
            setForm(canonical); setBaseline(canonical);
          };
          const save = async () => {
            setBusy(true);
            try {
              const normalized = normalize(form), original = normalize(baseline);
              const patch = Object.fromEntries(Object.entries(normalized).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key])));
              if (patch.tts) patch.tts = Object.fromEntries(Object.entries(normalized.tts).filter(([key, value]) => value !== original.tts[key]));
              if (patch.workerModels) {
                const routes = {};
                for (const role of new Set([...Object.keys(normalized.workerModels), ...Object.keys(original.workerModels)])) {
                  const current = normalized.workerModels[role] || {}, previous = original.workerModels[role] || {};
                  const changed = {};
                  for (const [key, fallback] of Object.entries({ provider: '', model: '', simplePersona: false })) {
                    if ((current[key] ?? fallback) !== (previous[key] ?? fallback)) changed[key] = current[key] ?? fallback;
                  }
                  // Empty strings clear only edited fields; do not remove a
                  // whole route that may have concurrent changes elsewhere.
                  if (Object.keys(changed).length) routes[role] = changed;
                }
                if (Object.keys(routes).length) patch.workerModels = routes;
                else delete patch.workerModels;
              }
              const saved = Object.keys(patch).length ? await rpc('action', { type: 'workspace.config-update', config: patch }) : state;
              adoptSaved(saved.workspace.config);
              await helpers.refresh().catch(() => {});
              setSaveState({ ok: true, message: L('已保存并重载生效。', 'Saved and reloaded.') });
            } catch (e) { setSaveState({ ok: false, message: (e && e.message) || String(e) }); }
            finally { setBusy(false); }
          };
          // F36: 密钥组——只写不回显；非空＝写入密钥库，勾选清除＝清空该位，
          // 其余不动。走独立 action（workspace.secret-update），与 AGENTS.md 解耦。
          const SECRET_FIELDS = [
            ['feishuAppId', L('飞书 App ID（feishuAppId）', 'Feishu App ID (feishuAppId)')],
            ['feishuAppSecret', L('飞书 App Secret（feishuAppSecret）', 'Feishu App Secret (feishuAppSecret)')],
            ['pgDsn', L('PostgreSQL DSN（pgDsn）', 'PostgreSQL DSN (pgDsn)')],
            ['volcTtsKey', L('豆包 TTS Key（volcTtsKey）', 'Volcengine TTS key (volcTtsKey)')],
          ];
          const secretPlaceholder = (secrets, key) => {
            const s = secrets && secrets[key];
            return s && s.set ? (s.source === 'env' ? L('已设置（来源：环境变量）', 'Set (from env var)') : L('已设置（来源：密钥库）', 'Set (from secret store)')) : L('未设置——在此填写', 'Not set — enter here');
          };
          const secretHelper = (secrets, key, clearing) => clearing
            ? L('保存后将清除密钥库中的该值（环境变量不受影响）。', 'Saving clears this value from the store (env vars, if any, stay).')
            : L('留空保存＝保持不变；填写后保存＝写入密钥库。', 'Leave blank to keep; enter a value to store it.');
          const [secretDraft, setSecretDraft] = React.useState({});
          const [secretClears, setSecretClears] = React.useState({});
          const secretDirty = Object.values(secretDraft).some(value => String(value || '').trim()) || Object.values(secretClears).some(Boolean);
          const dirty = configDirty || secretDirty;
          React.useEffect(() => {
            helpers.setFormDirty(dirty);
            return () => helpers.setFormDirty(false);
          }, [dirty]);
          const reset = () => {
            adoptSaved(config);
            setSecretDraft({});
            setSecretClears({});
            setSaveState(null);
          };
          const saveSecrets = async () => {
            const values = {};
            let changed = false;
            for (const [key] of SECRET_FIELDS) {
              const draft = (secretDraft[key] || '').trim();
              if (draft) { values[key] = draft; changed = true; }
              else if (secretClears[key]) { values[key] = ''; changed = true; }
            }
            if (!changed) { setSaveState({ ok: true, message: L('密钥无改动。', 'No secret changes.') }); return; }
            setBusy(true);
            try {
              await rpc('action', { type: 'workspace.secret-update', values });
              setSecretDraft({}); setSecretClears({});
              await helpers.refresh().catch(() => {});
              setSaveState({ ok: true, message: L('密钥已保存到工作区密钥库。', 'Secrets saved to the workspace store.') });
            } catch (e) { setSaveState({ ok: false, message: (e && e.message) || String(e) }); }
            finally { setBusy(false); }
          };
          const tryVoice = async () => {
            setBusy(true);
            try { await rpc('action', { type: 'tts.test' }); setSaveState({ ok: true, message: L('试听已发送（使用当前已保存的配置）。', 'Sample sent (uses the saved config).') }); }
            catch (e) { setSaveState({ ok: false, message: L('试听失败：', 'Sample failed: ') + ((e && e.message) || e) }); }
            finally { setBusy(false); }
          };
          if (!config) return empty('code', 'blue', L('尚未绑定工作区', 'No workspace bound'), L('在接入与设置的「工作区与配置」绑定工作区后可编辑参数。', 'Bind a workspace via Workspace & config under Connections & setup to edit parameters.'));
          // F34: 保存/试听反馈随保存栏展示（sticky 常驻视口底）——原先渲染在
          // 表单顶部，用户在表单中下部点保存时错误在视口外不可见（走查 S6）。
          return h('fieldset', { disabled: busy, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
            sectionHead('code', null, L('保存＝校验→写回 AGENTS.md 配置块→重载生效；工作规则不受影响，校验失败保留原文。', 'Save = validate → rewrite the AGENTS.md config block → reload; prose rules untouched, file kept on validation failure.'), null, 'blue'),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('模式与身份', 'Mode & identity')),
              row(L('模式（mode）', 'Mode (mode)'), sel([['demo', L('体验模式', 'Demo')], ['feishu', L('飞书模式', 'Feishu')]], form.mode, v => set('mode', v)), form.mode === 'feishu' ? L('飞书应用凭据需在环境变量中就位（引用名见下方）。', 'Feishu app credentials must be present in env vars (see below).') : null),
              row(L('lark-cli profile（larkProfile）', 'lark-cli profile (larkProfile)'), txt(form.larkProfile, v => set('larkProfile', v), { placeholder: 'default' }), L('lark-cli 固定 profile 名。', 'The pinned lark-cli profile name.')),
              row(L('主人 OpenID（ownerOpenId）', 'Owner OpenID (ownerOpenId)'), h('div', { className: 'pa24-row', style: { flexWrap: 'nowrap' } },
                txt(form.ownerOpenId, v => set('ownerOpenId', v), { readOnly: true, style: { flex: 1, minWidth: 0 } }),
                h('button', { type: 'button', className: 'pa24-quiet', onClick: () => (authOpenId ? set('ownerOpenId', authOpenId) : setSaveState({ ok: false, message: L('先在「飞书接入」运行检查，取得授权身份后再应用。', 'Run the Feishu check first to obtain the authorized identity.') })) }, L('应用授权值', 'Apply authorized'))),
                L('身份字段只读；一键应用当前 CLI 授权的 open_id' + (authOpenId ? '' : diagChecked ? '（检查过，尚未取得授权身份）' : '（在「接入」分类运行检查后可获取）') + '。', 'Identity is read-only; one-click apply of the CLI-authorized open_id' + (authOpenId ? '' : diagChecked ? ' (checked, not yet acquired)' : ' (run a check under Access to acquire)') + '.')),
              row(L('业务 skill 放行面（extraBusinessSkills）', 'Business skills (extraBusinessSkills)'), h('textarea', { rows: 2, value: form.extraSkills, onChange: e => set('extraSkills', e.target.value), placeholder: 'standup-prep, my-routine' }, null), L('逗号或换行分隔的 kebab-case skill 名；点名目录外名会被过滤并在健康里提示。', 'Comma/newline-separated kebab-case skill names; unknown names are filtered with a health note.')),
              row(L('时区（timeZone）', 'Time zone (timeZone)'), h('div', null, txt(form.timeZone, v => set('timeZone', v), { placeholder: 'Asia/Shanghai', list: 'pa24-tz-list' }),
                h('datalist', { id: 'pa24-tz-list' }, ['Asia/Shanghai', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'].map(z => h('option', { key: z, value: z })))), L('IANA 时区名，保存时即时校验。', 'IANA timezone name; validated on save.'))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('渠道选择', 'Channels')),
              row(L('日程渠道（calendarChannel）', 'Calendar channel (calendarChannel)'), sel([['feishu', L('飞书', 'Feishu')], ['wecom', L('企微', 'WeCom')]], form.calendarChannel, v => set('calendarChannel', v)), L('日程事件的写入渠道。', 'Where calendar events are written.')),
              row(L('待办渠道（todoChannel）', 'Todo channel (todoChannel)'), sel([['feishu', L('飞书', 'Feishu')], ['wecom', L('企微', 'WeCom')]], form.todoChannel, v => set('todoChannel', v)), L('待办的写入渠道。', 'Where todos are written.')),
              row(L('推送渠道（notifyChannel）', 'Push channel (notifyChannel)'), sel([['feishu', L('飞书', 'Feishu')], ['wecom', L('企微', 'WeCom')]], form.notifyChannel, v => set('notifyChannel', v)), L('提醒与汇报的推送出口；企微为单向推送，收信仍在飞书。', 'Reminder & digest push outlet; WeCom is one-way, inbound stays on Feishu.'))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('飞书资源', 'Feishu resources')),
              row(L('飞书文件夹（folderToken）', 'Feishu folder (folderToken)'), txt(form.folderToken, v => set('folderToken', v), { onBlur: e => set('folderToken', extractToken(e.target.value)), placeholder: L('粘贴文件夹链接或 token', 'Paste folder link or token') })),
              row(L('知识库节点（wikiNodeToken，可选）', 'Wiki node (wikiNodeToken, optional)'), txt(form.wikiNodeToken, v => set('wikiNodeToken', v), { onBlur: e => set('wikiNodeToken', extractToken(e.target.value)), placeholder: L('粘贴知识库节点链接或 token，留空回退文件夹', 'Paste wiki node link or token; empty falls back to the folder') }), L('已配置时备忘与手写待审文档建到该节点下；留空沿用 folderToken。', 'When set, memos and pending review docs land under this node; empty keeps folderToken.')),
              row(L('任务清单（tasklistId）', 'Task list (tasklistId)'), txt(form.tasklistId, v => set('tasklistId', v), { onBlur: e => set('tasklistId', extractToken(e.target.value)), placeholder: L('粘贴任务清单链接或 guid', 'Paste task-list link or guid') })),
              row(L('日历（calendarId）', 'Calendar (calendarId)'), txt(form.calendarId, v => set('calendarId', v), { placeholder: 'primary' }), L('默认 primary（本人日历）。', 'Defaults to primary (your calendar).'))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('运行参数', 'Runtime')),
              row(L('并发数（maxWorkers）', 'Parallelism (maxWorkers)'), h('input', { type: 'number', min: 1, max: 8, step: 1, value: form.maxWorkers, onChange: e => set('maxWorkers', e.target.value) }), L('1–8 的整数。', 'An integer from 1 to 8.')),
              row(L('启用的 Worker（enabledWorkers）', 'Enabled workers (enabledWorkers)'), h('div', { style: { minWidth: 0 } }, WORKER_IDS.map(r =>
                h('label', { key: r, className: 'pa24-check' }, h('input', { type: 'checkbox', checked: form.enabledWorkers.includes(r), onChange: e => toggleIn('enabledWorkers')(r, e.target.checked) }), roleName(r) + '（' + r + '）')))),
              row(L('模型路由（workerModels）', 'Model routes (workerModels)'), h('div', { style: { minWidth: 0 } },
                roleRows.length ? roleRows.map(role => h('div', { key: role, className: 'pa24-row', style: { flexWrap: 'nowrap', marginBottom: 6 } },
                  h('span', { style: { width: 86, fontSize: 12, color: 'var(--pa-muted)', flexShrink: 0 } }, roleName(role)),
                  txt(wmGet(role).provider || '', v => wmSet(role, { provider: v }), { placeholder: L('provider（留空继承默认）', 'provider (blank inherits default)'), 'aria-label': roleName(role) + L(' provider', ' provider') }),
                  txt(wmGet(role).model || '', v => wmSet(role, { model: v }), { placeholder: L('model（留空继承默认）', 'model (blank inherits default)'), 'aria-label': roleName(role) + L(' model', ' model') }),
                  h('label', { className: 'pa24-check', style: { margin: 0 } }, h('input', { type: 'checkbox', checked: !!wmGet(role).simplePersona, onChange: e => wmSet(role, { simplePersona: e.target.checked }), 'aria-label': roleName(role) + L(' 精简提示词', ' simple persona') }), L('精简', 'Simple'))))
                  : h('p', { className: 'pa24-meta' }, L('先勾选上方 Worker。', 'Check a worker above first.'))),
                L('按角色覆盖 provider/model，留空即继承默认路由。', 'Per-role provider/model overrides; blank fields inherit the default route.'),
                form.enabledWorkers.includes('handwriting') && !(form.workerModels.handwriting && (form.workerModels.handwriting.model || form.workerModels.handwriting.provider)) && h('p', { className: 'pa24-meta', style: { color: 'var(--pa-amber)' } }, L('已启用手写整理但未配置视觉模型路由——该能力将不可用。', 'Handwriting is enabled without a vision model route and will be unavailable.'))),
              h('details', { id: 'pa24-extra-tools', style: { marginTop: 4 } }, h('summary', null, L('extraLocalTools（高级，默认收起）', 'extraLocalTools (advanced, collapsed)')),
                h('div', { style: { minWidth: 0, paddingTop: 6 } }, KNOWN_EXTRA.map(x =>
                  h('label', { key: x, className: 'pa24-check' }, h('input', { type: 'checkbox', checked: form.extraKnown.includes(x), onChange: e => toggleIn('extraKnown')(x, e.target.checked) }), x)),
                  h('p', { className: 'pa24-meta' }, L('本地会话额外放行的工具；精确 qwennote 工具名经对话维护。', 'Extra tools allowed in the local session; precise qwennote tool names are maintained in chat.'))))),
            // F36: 密钥值只写不回显——进工作区密钥库（.24pa/secrets.json，0600），
            // 永不进 AGENTS.md/系统提示/备份；环境变量（下方引用名）存在时优先。
            h('section', { className: 'pa24-card' },
              h('h2', null, L('密钥（工作区密钥库）', 'Secrets (workspace store)')),
              SECRET_FIELDS.map(([key, label]) => row(label, h('div', { className: 'pa24-row', style: { flexWrap: 'nowrap' } },
                txt(secretDraft[key] || '', v => setSecretDraft(d => ({ ...d, [key]: v })), { type: 'password', autoComplete: 'new-password', placeholder: secretPlaceholder(state.secrets, key), style: { flex: 1, minWidth: 0 } }),
                h('button', { type: 'button', className: 'pa24-quiet', 'aria-pressed': secretClears[key] ? 'true' : 'false', onClick: () => setSecretClears(c => ({ ...c, [key]: !c[key] })) }, secretClears[key] ? L('撤销清除', 'Undo clear') : L('清除', 'Clear'))),
                secretHelper(state.secrets, key, secretClears[key]))),
              h('div', { className: 'pa24-row' },
                h('button', { type: 'button', className: 'pa24-quiet', disabled: busy || !secretDirty, onClick: () => void saveSecrets() }, icon('shield', { width: 15, height: 15 }), L('保存密钥', 'Save secrets')),
                h('span', { className: 'pa24-meta' }, L('只写不回显；保存到工作区密钥库，AGENTS.md 与备份不含密钥值。', 'Write-only; saved to the workspace secret store — AGENTS.md and backups never contain secret values.')))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('存储与密钥引用', 'Storage & secret refs')),
              row(L('存储（storage）', 'Storage (storage)'), h('strong', null, config.storage === 'postgres' ? 'PostgreSQL' : 'SQLite'), L('切换存储后端涉及数据迁移，请按初始化指南的迁移流程办理。', 'Switching backends involves data migration — follow the migration procedure in the init guide.')),
              row(L('App ID 引用（appIdEnv）', 'App ID ref (appIdEnv)'), txt(form.appIdEnv, v => set('appIdEnv', v), { placeholder: 'PA24_FEISHU_APP_ID' }), L('可选：环境变量引用名；同名环境变量存在时优先于密钥库。', 'Optional env-var reference; a set env var overrides the secret store.')),
              row(L('App Secret 引用（appSecretEnv）', 'App Secret ref (appSecretEnv)'), txt(form.appSecretEnv, v => set('appSecretEnv', v), { placeholder: 'PA24_FEISHU_APP_SECRET' }), L('可选：环境变量引用名；同名环境变量存在时优先于密钥库。', 'Optional env-var reference; a set env var overrides the secret store.')),
              row(L('PG DSN 引用（pgDsnEnv）', 'PG DSN ref (pgDsnEnv)'), txt(form.pgDsnEnv, v => set('pgDsnEnv', v), { placeholder: 'PA24_PG_DSN' }), config.storage === 'sqlite' ? L('SQLite 模式不使用。', 'Unused under SQLite.') : L('可选：环境变量引用名；同名环境变量存在时优先于密钥库。', 'Optional env-var reference; a set env var overrides the secret store.'))),
            h('section', { className: 'pa24-card', id: 'pa24-tts-config' },
              h('h2', null, L('语音 TTS（晨报复盘）', 'Voice TTS (digests)')),
              row(L('语音引擎（tts.engine）', 'Voice engine (tts.engine)'), sel([['none', L('不启用', 'Off')], ['melo', L('Melo 本地', 'Melo local')], ['volcengine', L('豆包云', 'Volcengine')]], form.tts.engine, v => setTts('engine', v))),
              form.tts.engine === 'volcengine' && row(L('音色（tts.voice）', 'Voice (tts.voice)'), h('div', { className: 'pa24-row', style: { flexWrap: 'nowrap' } },
                sel(form.tts.voice && !VOICES.some(o => o.value === form.tts.voice) ? [[form.tts.voice, form.tts.voice], ...VOICES.map(o => [o.value, o.label])] : VOICES.map(o => [o.value, o.label]), form.tts.voice, v => setTts('voice', v)),
                h('button', { type: 'button', className: 'pa24-quiet', disabled: busy, onClick: () => void tryVoice() }, icon('chat', { width: 15, height: 15 }), L('试听', 'Sample'))), L('试听发送到飞书，使用当前已保存的配置。', 'The sample goes to Feishu using the saved config.')),
              form.tts.engine === 'volcengine' && row(L('密钥引用（tts.volcKeyEnv）', 'Key env ref (tts.volcKeyEnv)'), txt(form.tts.volcKeyEnv, v => setTts('volcKeyEnv', v), { placeholder: 'VOLC_TTS_KEY' }), L('可选：环境变量引用名（优先于密钥库）；密钥本体在「密钥」组填写。', 'Optional env-var reference (overrides the store); the key itself goes in the Secrets group.')),
              form.tts.engine === 'melo' && row(L('部署目录（tts.meloDir）', 'Deploy dir (tts.meloDir)'), txt(form.tts.meloDir, v => setTts('meloDir', v), { placeholder: '/opt/melo-tts' }), L('melo 部署目录（绝对路径）。', 'melo deployment directory (absolute path).'))),
            // F34: 保存栏与三个分组同层级（此前被嵌进「运行参数」section，
            // sticky 包含块被钳制导致首屏不可见——走查 P1 回归锚点见
            // client.test.mjs「表单结构守卫」）；保存/试听反馈随栏展示。
            h('div', { className: 'pa24-form-actions' },
              saveState && h('div', { role: saveState.ok ? 'status' : 'alert', className: saveState.ok ? 'pa24-example' : 'pa24-error', style: { flex: '1 1 100%', margin: 0 } }, icon(saveState.ok ? 'check' : 'alert', { width: 16, height: 16 }), h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, saveState.message)),
              h('button', { type: 'button', className: 'pa24-quiet', disabled: busy || !dirty, onClick: reset }, icon('close', { width: 16, height: 16 }), L('重置修改', 'Reset changes')),
              h('button', { type: 'button', className: 'pa24-primary', disabled: busy || !configDirty, onClick: () => void save() }, icon('check', { width: 16, height: 16 }), busy ? L('保存中…', 'Saving…') : L('保存并重载', 'Save & reload')),
              h('span', { className: 'pa24-meta', role: 'status' }, configDirty ? L('参数有未保存修改', 'Unsaved configuration changes') : secretDirty ? L('密钥有未保存修改，请点「保存密钥」', 'Unsaved secrets — use Save secrets') : L('保存后立即重载生效；对话修改与表单等价（同一配置源）。', 'Reload applies immediately; chat edits and the form share the same config source.'))));
        }

        function CardShell({ card, tier, label, manage, hidden, onToggleHidden, body, foot }) {
          const cardTitle = L(...card.title);
          return h('section', { className: 'pa24-cap pa24-tone-' + card.tone + (hidden ? ' pa24-cap-hidden' : '') + (ATTENTION_TIERS.includes(tier) ? ' pa24-cap-att' : '') },
            manage && h('button', { type: 'button', className: 'pa24-quiet pa24-cap-hide', 'aria-pressed': hidden ? 'true' : 'false', 'aria-label': (hidden ? L('显示 ', 'Show ') : L('隐藏 ', 'Hide ')) + cardTitle, onClick: onToggleHidden }, hidden ? L('显示', 'Show') : L('隐藏', 'Hide')),
            h('div', { className: 'pa24-cap-head' },
              tile(card.icon, card.tone),
              h('div', { className: 'pa24-cap-title' }, h('b', null, cardTitle), h('small', null, L(...card.sub))),
              statusBadge(tier, label || undefined)),
            h('div', { className: 'pa24-cap-body' }, body),
            foot && h('div', { className: 'pa24-cap-foot' }, foot));
        }

        function CardGrid({ cat, helpers, manage, hidden, toggleHidden, openDetail }) {
          const cards = CARDS.filter(c => c.cat === cat);
          const tierById = new Map(cards.map(c => [c.id, c.tier(helpers)]));
          // 接入进度只覆盖四个接入卡；工作区与参数配置不计入接入就绪率。
          const progress = cat === 'setup' && !manage ? (() => {
            const tiers = cards.filter(c => ACCESS_CARD_IDS.has(c.id) && !(hidden[cat] || []).includes(c.id)).map(c => tierById.get(c.id));
            const ok = tiers.filter(x => x === 'ok').length;
            const pending = tiers.filter(x => ATTENTION_TIERS.includes(x)).length;
            const unchecked = tiers.length - ok - pending;
            return h('p', { className: 'pa24-meta', style: { margin: '0 2px 12px' } },
              L('接入进度：就绪 ' + ok + ' / ' + tiers.length, 'Access progress: ' + ok + ' ready / ' + tiers.length),
              pending > 0 ? L(' · 需处理 ' + pending, ' · ' + pending + ' need attention') : '',
              unchecked > 0 ? L(' · 未检查或未启用 ' + unchecked, ' · ' + unchecked + ' unchecked or off') : '',
              pending > 0 ? L('——从需处理的卡片开始。', ' — start with the cards needing attention.') : '');
          })() : null;
          return h('div', null, progress, h('div', { className: 'pa24-cardgrid' }, cards.map(card => {
            const isHidden = (hidden[cat] || []).includes(card.id);
            if (isHidden && !manage) return null;
            const tier = tierById.get(card.id);
            const label = card.label ? card.label(helpers) : null;
            return h(CardShell, {
              key: card.id, card, tier, label: label || '', manage, hidden: isHidden,
              onToggleHidden: () => toggleHidden(cat, card.id),
              body: card.body(helpers),
              foot: [...(card.quick ? [card.quick(helpers)] : []), h('button', { key: 'open', type: 'button', 'aria-label': (card.action ? L(...card.action) : L('查看详情', 'Open')) + '：' + L(...card.title), onClick: () => openDetail(card.id) }, icon('arrow'), card.action ? L(...card.action) : L('查看详情', 'Open'))],
            });
          })));
        }

        function Panel() {
          const [state, setState] = React.useState(null), [connError, setConnError] = React.useState('');
          const [tab, setTab] = React.useState('work'), [detail, setDetail] = React.useState(null), [noticeClosed, setNoticeClosed] = React.useState(false);
          // F27: 订阅 locale 快照——语言切换即时重渲染（快照含 revision）。
          React.useSyncExternalStore(cb => ctx.locale.subscribe(cb), () => ctx.locale.getSnapshot());
          const [manage, setManage] = React.useState(false), [hidden, setHidden] = React.useState(readHiddenPrefs());
          const [extraTick, setExtraTick] = React.useState(0);
          const [refreshing, setRefreshing] = React.useState(false), [lastRefreshAt, setLastRefreshAt] = React.useState(null);
          // F34: 管理态 Esc 可退（与「完成」等效）；隐藏动作给一条轻反馈，
          // 说明去哪恢复——不留悬念也不打断（无确认弹窗）。
          const [hideNote, setHideNote] = React.useState('');
          const hideNoteTimer = React.useRef(null);
          const formDirty = React.useRef(false);
          React.useEffect(() => () => clearTimeout(hideNoteTimer.current), []);
          React.useEffect(() => {
            if (!manage) return undefined;
            const onKey = e => { if (e.key === 'Escape') setManage(false); };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
          }, [manage]);
          const main = React.useRef(null);
          const refresh = async () => {
            setRefreshing(true);
            try {
              const s = await rpc('snapshot');
              setState(s); setConnError(''); setExtraTick(v => v + 1); setLastRefreshAt(new Date().toISOString());
              return s;
            } finally { setRefreshing(false); }
          };
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
          const canLeave = () => !formDirty.current || window.confirm(L('有未保存修改，确定放弃吗？', 'Discard unsaved changes?'));
          const selectTab = id => {
            if (!canLeave()) return false;
            formDirty.current = false;
            setTab(id); setDetail(null); main.current?.scrollTo({ top: 0 });
            return true;
          };
          const openDetail = id => { setDetail(id); main.current?.scrollTo({ top: 0 }); };
          const closeDetail = () => {
            if (!canLeave()) return;
            formDirty.current = false;
            setDetail(null);
          };
          const openCard = (id, anchor) => {
            if (!canLeave()) return;
            const card = CARDS.find(c => c.id === id);
            if (!card) return;
            formDirty.current = false;
            setTab(card.cat); setDetail(id); main.current?.scrollTo({ top: 0 });
            if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }), 0);
          };
          const toggleManage = () => {
            if (!canLeave()) return;
            formDirty.current = false;
            setManage(v => !v); setDetail(null);
          };
          const chatWithRobot = () => {
            if (!canLeave()) return;
            formDirty.current = false;
            void run(openRobot);
          };
          const toggleHidden = (cat, id) => {
            const list = hidden[cat] || [];
            const wasHidden = list.includes(id);
            const next = { ...hidden, [cat]: wasHidden ? list.filter(x => x !== id) : [...list, id] };
            setHidden(next); writeHiddenPrefs(next);
            if (!wasHidden) {
              const card = CARDS.find(c => c.id === id);
              setHideNote(L('已隐藏「' + L(...card.title) + '」——本管理态中点「显示」可恢复。', 'Hidden "' + L(...card.title) + '" — Show in this manage mode brings it back.'));
              clearTimeout(hideNoteTimer.current);
              hideNoteTimer.current = setTimeout(() => setHideNote(''), 5000);
            }
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
          const helpers = { state, extra, workspace, config, tz, busy, button, run, runFullCheck, refresh, openCard, setFormDirty: value => { formDirty.current = value; }, openRobot: chatWithRobot };
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
                button('chevron', L('返回卡片', 'Back to cards'), closeDetail, { className: 'pa24-quiet' }),
                h('h2', { style: { margin: 0 } }, L(...entry.title), h('span', { className: 'pa24-muted', style: { fontSize: 12, fontWeight: 400, marginLeft: 8 } }, L(...entry.sub)))),
              entry.detail(helpers));
          } else {
            content = h(CardGrid, { cat: tab, helpers, manage, hidden, toggleHidden, openDetail });
          }
          return h('main', { className: 'pa24' + (manage ? ' pa24-manage' : ''), ref: main }, h('style', null, style), h('div', { className: 'pa24-wrap' },
            h('header', { className: 'pa24-header' },
              h('div', { className: 'pa24-identity' }, h('span', { className: 'pa24-brand' }, icon('bot')), h('div', null, h('div', { className: 'pa24-title-row' }, h('h1', null, t('title')), h('p', { className: 'pa24-tagline' }, L('日常交给我，重要的事由你决定。', 'Leave the routine to me; the important calls stay yours.'))))),
              h('div', { className: 'pa24-row' },
                button('chat', L('与24私助对话', 'Chat with 24PA'), chatWithRobot, { className: 'pa24-primary', disabled: busy || !workspace }),
                button('refresh', refreshing ? L('刷新中…', 'Refreshing…') : L('刷新', 'Refresh'), () => refresh(), { className: 'pa24-quiet', disabled: refreshing }),
                button('grid', manage ? L('完成（Esc）', 'Done (Esc)') : L('管理卡片', 'Manage cards'), toggleManage, { className: manage ? 'pa24-manage-done' : 'pa24-quiet', 'aria-pressed': manage ? 'true' : 'false' }),
                lastRefreshAt && h('span', { className: 'pa24-meta', role: 'status' }, L('已更新 ', 'Updated ') + date(lastRefreshAt, tz)))),
            manage && h('div', { className: 'pa24-notice pa24-tone-blue' }, icon('info', { width: 18, height: 18 }), h('div', null, h('strong', null, L('管理态', 'Manage')), L(' · 点卡片顶部「隐藏」收起（再点「显示」恢复）；偏好保存在本浏览器，按分类分别记忆；Esc 退出。', ' · Use Hide at the top of a card to tuck it away (Show brings it back); preferences persist in this browser, remembered per category; Esc exits.'), hideNote && h('p', { className: 'pa24-meta', style: { marginTop: 4 } }, hideNote))),
            config?.mode === 'demo' && !noticeClosed && h('div', { className: 'pa24-notice pa24-tone-amber' }, icon('info', { width: 18, height: 18 }), h('div', null, h('strong', null, L('体验模式', 'Demo mode')), L(' · 未连接飞书；数据保存在本机数据库，不会发到飞书。', ' · Not connected to Feishu; data stays in the local database and never reaches Feishu.')), h('button', { type: 'button', className: 'pa24-quiet', 'aria-label': L('关闭体验模式提示', 'Dismiss demo-mode notice'), onClick: () => setNoticeClosed(true) }, icon('close', { width: 15, height: 15 }))),
            (error || connError) && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, connError ? L('连接暂时中断，以下为上次读取的状态', 'Connection lost — showing the last read state') : L('操作未完成', 'Action did not complete')), h('p', null, error || connError)),
            h('nav', { className: 'pa24-tabs', role: 'tablist', 'aria-label': L('24私助工作区导航', '24PA workspace navigation') }, CATEGORY_TABS.map(([id, name, tone], index) => {
              const chip = chipOf(id);
              return h('button', { key: id, id: 'pa24-tab-' + id, type: 'button', role: 'tab', className: 'pa24-tone-' + tone, 'aria-selected': tab === id, 'aria-controls': 'pa24-content', tabIndex: tab === id ? 0 : -1, onClick: () => selectTab(id), onKeyDown: e => {
                const next = e.key === 'ArrowRight' ? (index + 1) % CATEGORY_TABS.length : e.key === 'ArrowLeft' ? (index + CATEGORY_TABS.length - 1) % CATEGORY_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? CATEGORY_TABS.length - 1 : null;
                if (next === null) return; e.preventDefault(); if (selectTab(CATEGORY_TABS[next][0])) e.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus();
              } }, icon(name, { width: 17, height: 17 }), t(id), chip && h('span', { className: 'pa24-chip show' + (chip.tone === 'error' ? ' error' : ''), 'aria-label': L('该分类有 ' + chip.n + ' 张卡片需要关注（角标按卡片计，健康卡内的数字按检查项计）', chip.n + ' card(s) in this category need attention (the chip counts cards; health-card numbers count checks)') }, String(chip.n)));
            })),
            h('div', { id: 'pa24-content', role: 'tabpanel', 'aria-labelledby': 'pa24-tab-' + tab, tabIndex: 0 }, content),
            h('footer', { className: 'pa24-footer' }, icon('shield', { width: 13, height: 13 }), L('数据保存在本机（业务账本随工作区配置，默认 SQLite、可选 PostgreSQL）；参数可经表单或对话维护，界面只显示真实结果。', 'Data stays on this machine (ledger per workspace config — SQLite by default, PostgreSQL optional); parameters are maintained via the form or chat, and the UI only shows real results.'))));
        }

        // F20: 企微接入面板模块——对标飞书接入：渠道配置、CLI 与身份、
        // 服务级授权（含平台 helpMessage 原文）与 nextSteps 导航。
        function WecomView({ state, busy, button, openRobot }) {
          const wecom = state.wecom;
          const workspace = state.workspace, config = workspace ? workspace.config : null, tz = tzOf(state);
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

        // P53: 宿主侧栏只有图标位——无障碍名由宿主 register 的 label 提供，
        // title 仅补悬停提示。
        const SidebarIcon = () => h('span', { title: t('panel'), style: { display: 'inline-flex' } }, icon('bot', { width: 22, height: 22 }));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'pa24' }, Panel));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'pa24', order: 24, label: () => t('panel') }, SidebarIcon));
        // F35: settings.section 注入撤销——「24私助」分区整体迁回主面板
        // （接入与设置 → 工作区与配置），设置模态不再出现本插件分区。
      },
    };
  },
});
