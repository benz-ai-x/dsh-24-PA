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
      waiting: '等待处理', stopping: '正在停止', timed_out: '累计执行超时', skipped: '已跳过', rejected: '已拒绝', delivering: '待投递', model_done: '已生成', unconfirmed: '待核对',
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
      waiting: 'Waiting', stopping: 'Stopping', timed_out: 'Timed out', skipped: 'Skipped', rejected: 'Rejected', delivering: 'Awaiting delivery', model_done: 'Generated', unconfirmed: 'Unconfirmed',
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
      .pa24 :is(button,input,textarea,select,summary,a,[tabindex]):focus-visible{outline:3px solid var(--pa-blue);outline-offset:3px}.pa24 input,.pa24 select{min-height:42px;width:100%;font:inherit;padding:10px 12px;border:1px solid var(--pa-line);border-radius:10px;background:var(--pa-surface);color:var(--pa-ink)}
      .pa24-icon-tile{width:40px;height:40px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--tone-bg);color:var(--tone)}.pa24-tone-blue{--tone:var(--pa-blue);--tone-bg:var(--pa-blue-bg)}.pa24-tone-green{--tone:var(--pa-green);--tone-bg:var(--pa-green-bg)}.pa24-tone-violet{--tone:var(--pa-violet);--tone-bg:var(--pa-violet-bg)}.pa24-tone-amber{--tone:var(--pa-amber);--tone-bg:var(--pa-amber-bg)}.pa24-tone-danger{--tone:var(--pa-danger);--tone-bg:var(--pa-danger-bg)}.pa24-tone-neutral{--tone:var(--pa-muted);--tone-bg:var(--pa-soft)}.pa24-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;background:var(--tone-bg);color:var(--tone);font-size:11px;font-weight:600;line-height:1.7;white-space:nowrap}
      .pa24-header{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:16px}.pa24-identity{display:flex;align-items:center;gap:12px}.pa24-brand{width:44px;height:44px;border-radius:11px;background:var(--pa-brand);color:#fff;display:inline-flex;align-items:center;justify-content:center}.pa24-brand svg{width:24px;height:24px}.pa24-title-row{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.pa24-tagline{color:var(--pa-muted);font-size:13px}
      
      .pa24-notice{display:flex;gap:10px;align-items:flex-start;padding:12px 15px;border:1px solid color-mix(in srgb,var(--tone) 16%,transparent);border-radius:12px;color:var(--tone);background:var(--tone-bg);font-size:12px;margin-bottom:20px}.pa24-notice>svg{margin-top:1px}.pa24-notice>div{flex:1;min-width:0}
      .pa24-error{padding:16px;border:1px solid var(--pa-danger);border-radius:12px;background:var(--pa-danger-bg);margin:14px 0;color:var(--pa-danger);overflow-wrap:anywhere}
      .pa24-tabs{display:flex;gap:6px;border-bottom:1px solid var(--pa-line);margin:0 0 18px;overflow-x:auto;scrollbar-width:thin;padding:3px 0 10px}.pa24-tabs button{flex-shrink:0;min-height:40px;padding:8px 12px;background:transparent;border:1px solid transparent;border-radius:9px;color:var(--pa-muted);font-weight:500}.pa24-tabs button[aria-selected=true]{background:var(--tone-bg);color:var(--tone);font-weight:650}
      .pa24-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}.pa24-section-title{display:flex;align-items:center;gap:10px}.pa24-section-desc{margin-top:5px!important;color:var(--pa-muted);font-size:13px}
      :is(.pa24-skills,.pa24-manager){min-width:0;overflow-wrap:anywhere}:is(.pa24-skills,.pa24-manager) .pa24-section-head{flex-wrap:wrap}:is(.pa24-skills,.pa24-manager) .pa24-section-head>div{flex:1 1 240px;min-width:0}:is(.pa24-skills,.pa24-manager) .pa24-section-head>button{flex-shrink:0;white-space:nowrap}:is(.pa24-skills,.pa24-manager) .pa24-row>label{min-width:0;max-width:100%}:is(.pa24-skills,.pa24-manager) .pa24-note>button{max-width:100%;white-space:normal}
      .pa24-card{min-width:0;background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:16px;padding:16px 18px;margin-bottom:16px;box-shadow:var(--pa-shadow)}.pa24-card>h2{margin-bottom:10px}.pa24-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.pa24-grid>.pa24-card{margin:0}
      .pa24-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}.pa24-stat{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid var(--pa-line);border-radius:14px;background:var(--pa-surface)}.pa24-stat strong{font-size:22px;line-height:1.2;font-weight:650;font-variant-numeric:tabular-nums}.pa24-stat-label{font-size:12px;color:var(--pa-muted);margin-bottom:4px}.pa24-stat small{font-size:11px;color:var(--pa-muted);margin-left:8px}
      .pa24-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:35px 18px}.pa24-empty>.pa24-icon-tile{width:64px;height:64px;border-radius:22px;margin-bottom:18px}.pa24-empty>.pa24-icon-tile svg{width:29px;height:29px}.pa24-empty h3{font-size:17px;margin:3px 0 8px}.pa24-empty p{max-width:440px;color:var(--pa-muted);font-size:13px}.pa24-empty .pa24-row{margin-top:18px;justify-content:center}
      .pa24-example{display:flex;align-items:center;gap:9px;padding:12px 16px;background:var(--pa-soft);border-radius:10px;font-size:12px;color:var(--pa-muted)}
      .pa24-dl{margin:0}.pa24-field{display:grid;grid-template-columns:120px minmax(0,1fr);gap:12px;padding:7px 0;border-bottom:1px solid var(--pa-line)}.pa24-field:last-child{border-bottom:0}.pa24-field dt{font-size:12px;color:var(--pa-muted);overflow-wrap:anywhere}.pa24-field dd{margin:0;font-size:13px;overflow-wrap:anywhere}
      .pa24-helper{border-radius:10px;padding:12px 14px;background:var(--pa-soft);color:var(--pa-muted);font-size:12px;margin-top:16px}
      .pa24-searchbar{display:flex;gap:8px;align-items:center;padding:14px;background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:12px;margin-bottom:14px}.pa24-search{position:relative;flex:1;min-width:120px}.pa24-search>svg{position:absolute;left:12px;top:12px;color:var(--pa-muted);width:18px;height:18px}.pa24-search input{padding-left:38px;background:var(--pa-soft);font-size:13px}
      .pa24-memory-manager .pa24-searchbar{flex-wrap:wrap}.pa24-memory-manager .pa24-search{flex-basis:200px}.pa24-memory-manager .pa24-searchbar button{flex-shrink:0;white-space:nowrap}.pa24-memory-manager .pa24-search input{padding-left:38px}
      .pa24-result-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 15px;font-size:12px;color:var(--pa-muted)}.pa24-memory-manager{min-width:0}.pa24-memory-filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:12px 0}.pa24-memory-filter{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px}.pa24-memory-manager select,.pa24-memory-manager input,.pa24-memory-manager textarea{color:var(--pa-ink);background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:6px;padding:8px;min-width:0;max-width:100%;box-sizing:border-box}.pa24-memory-manager textarea{width:100%;resize:vertical}.pa24-memory-revisions{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;min-width:0}.pa24-memory-manager pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}.pa24-memory-manager .pa24-memory-heading{flex-wrap:wrap}.pa24-memory-list{display:grid;gap:14px}.pa24-memory-card{background:var(--pa-surface);border:1px solid var(--pa-line);border-radius:14px;overflow:hidden}.pa24-memory-body{padding:20px 22px}.pa24-memory-heading{display:flex;align-items:flex-start;gap:10px;justify-content:space-between}.pa24-memory-heading h3{overflow-wrap:anywhere}.pa24-memory-card .pa24-note{margin:15px 0;font-size:14px}.pa24-memory-source{display:flex;gap:6px;align-items:flex-start;font-size:11px;color:var(--pa-muted);overflow-wrap:anywhere}.pa24-memory-footer{padding:10px 22px;background:var(--pa-soft);border-top:1px solid var(--pa-line)}.pa24-memory-footer details{border:0;margin:0;padding:0}.pa24-memory-footer summary{min-height:26px;padding:0;font-size:11px}.pa24-page-nav{display:flex;align-items:center;justify-content:center;gap:18px;margin-top:22px;font-size:12px;color:var(--pa-muted)}.pa24-page-nav button:first-child svg{transform:rotate(180deg)}
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
      :is(.pa24-skills,.pa24-manager) label.pa24-field{display:flex;flex-direction:column;gap:6px;margin:12px 0;min-width:0;max-width:100%;font-size:13px}:is(.pa24-skills,.pa24-manager) label.pa24-field:has(input[type=checkbox]){flex-direction:row;align-items:flex-start}:is(.pa24-skills,.pa24-manager) label.pa24-field input:not([type=checkbox]),:is(.pa24-skills,.pa24-manager) label.pa24-field textarea,:is(.pa24-skills,.pa24-manager) label.pa24-field select{width:100%;min-width:0;max-width:100%;padding:8px;border:1px solid var(--pa-line);border-radius:8px;background:var(--pa-soft);color:var(--pa-ink);font:inherit}:is(.pa24-skills,.pa24-manager) label.pa24-field textarea{resize:vertical}:is(.pa24-skills,.pa24-manager) label.pa24-field input[type=checkbox]{flex:0 0 18px;width:18px;height:18px;min-height:18px;margin:2px 0;padding:0}:is(.pa24-skills,.pa24-manager) fieldset{min-width:0;border:1px solid var(--pa-line);border-radius:10px;padding:12px}:is(.pa24-skills,.pa24-manager) legend{font-size:12px;overflow-wrap:anywhere}
      .pa24-form-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--pa-line)}.pa24-form-row:last-child{border-bottom:0}.pa24-form-row>label{font-size:12px;color:var(--pa-muted)}.pa24-form-row input[type=text],.pa24-form-row input[type=number],.pa24-form-row select{min-height:36px}
      .pa24-check{display:inline-flex;align-items:center;gap:6px;margin:0 16px 0 0;font-size:13px;min-height:32px;cursor:pointer}.pa24-check input{width:15px;height:15px;min-height:0}
      .pa24-source-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px;margin:12px 0}.pa24-source-fields label{display:flex;flex-direction:column;gap:5px;min-width:0}.pa24-sources input,.pa24-sources select{max-width:100%;box-sizing:border-box}.pa24-sources .pa24-check input{width:18px;flex:0 0 18px}.pa24-source-save{position:sticky;bottom:72px;background:var(--pa-surface);border-top:1px solid var(--pa-line);padding:12px 0;margin-top:16px;z-index:2}.pa24-source-save p{margin:6px 0 0}.pa24-sources .pa24-job{overflow-wrap:anywhere}
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

        function MemoryHistory({ id, workspace, binding }) {
          const [view, retry] = useRpc('memory.history', { id, workspaceBinding: binding }, [id, workspace.path, binding]);
          if (view.status === 'loading') return h('p', { role: 'status' }, L('正在读取修订…', 'Reading revisions…'));
          if (view.status === 'error') return h('div', { role: 'alert' }, view.error, h('button', { type: 'button', onClick: retry }, L('重试修订读取', 'Retry revisions')));
          if (view.data?.workspaceBinding !== binding) return h('p', { role: 'alert' }, L('工作区已变化，请重新读取。', 'Workspace changed; read again.'));
          const revisions = view.data?.revisions || [];
          return h('div', null, revisions.length ? revisions.map(row => h('details', { key: row.id },
            h('summary', null, L('修订 ', 'Revision ') + row.resultingRevision + ' · ' + date(row.appliedAt, workspace.config?.timeZone || 'Asia/Shanghai')),
            h('p', { className: 'pa24-meta' }, row.reason), h('p', { className: 'pa24-meta' }, row.id + ' · ' + row.appliedBy + ' · ' + (row.undoable ? L('撤销前仍需核对完整字段', 'Undo requires checking all current fields') : L('不可自动撤销', 'Cannot automatically undo'))),
            h('div', { className: 'pa24-memory-revisions' }, h('div', null, h('strong', null, L('修改前', 'Before')), h('pre', null, row.before ? JSON.stringify(row.before, null, 2) : L('无正文', 'No content'))), h('div', null, h('strong', null, L('修改后', 'After')), h('pre', null, row.after ? JSON.stringify(row.after, null, 2) : L('无正文', 'No content')))))) : h('p', { className: 'pa24-meta' }, L('没有可证明的修订快照；当前 JSON 内容仍可查阅。', 'No proven revision snapshots; the current JSON remains available.')));
        }

        function MemoryView({ workspace, binding, openRobot }) {
          const initial = { query: '', category: '', confirmation: '', lifecycle: '', freshness: '', project: '', sourceState: '', conflict: '' };
          const [filters, setFilters] = React.useState(initial), [draft, setDraft] = React.useState(''), [offset, setOffset] = React.useState(0), [tick, setTick] = React.useState(0);
          const [view, setView] = React.useState({ key: '', status: 'loading', data: null, error: '' });
          const [historyId, setHistoryId] = React.useState(null), [maintenance, setMaintenance] = React.useState(null), [instruction, setInstruction] = React.useState(''), [note, setNote] = React.useState('');
          const key = JSON.stringify([workspace.path, binding, filters, offset]);
          React.useEffect(() => {
            const abort = new AbortController();
            setView(previous => ({ key, status: 'loading', data: previous.key === key ? previous.data : null, error: '' }));
            void rpc('memory', { ...filters, offset, workspaceBinding: binding }, abort.signal).then(data => { if (data.workspaceBinding !== binding) throw new Error(L('工作区已变化，请刷新后重试。', 'Workspace changed; refresh and retry.')); if (!abort.signal.aborted) setView({ key, status: 'ready', data, error: '' }); })
              .catch(error => { if (!abort.signal.aborted) setView(previous => ({ key, status: 'error', data: previous.key === key ? previous.data : null, error: error.message })); });
            return () => abort.abort();
          }, [key, tick]);
          const retry = () => setTick(value => value + 1);
          const update = (name, value) => { setFilters(previous => ({ ...previous, [name]: value })); setOffset(0); };
          const search = () => { update('query', draft.trim()); retry(); };
          const clear = () => { setFilters(initial); setDraft(''); setOffset(0); };
          const data = view.key === key ? view.data : null;
          const categories = { preference: L('个人偏好', 'Preference'), fact: L('事实', 'Fact'), project: L('项目', 'Project'), decision: L('决定', 'Decision') };
          const lifeLabels = { active: L('使用中', 'Active'), inactive: L('已停用', 'Inactive'), recycled: L('已回收', 'Recycled') };
          const scopeLabels = { personal: L('个人', 'Personal'), company: L('公司', 'Company'), project: L('项目', 'Project') };
          const freshnessLabels = { current: L('有效期内', 'Within validity'), expired: L('已过期', 'Expired'), upcoming: L('尚未生效', 'Not yet valid') };
          const confirmationLabels = { verified: L('有本人确认依据', 'Owner confirmation recorded'), missing: L('标为确认但缺有效依据', 'Marked confirmed; valid evidence missing'), unverified: L('未确认', 'Unverified') };
          const sourceLabels = { unchecked: L('来源未核验', 'Source not checked'), current: L('来源已核验', 'Source checked'), changed: L('来源已变化', 'Source changed'), unavailable: L('来源不可访问', 'Source unavailable') };
          const conflictLabels = { none: L('无已知冲突', 'No known conflict'), candidate: L('可能冲突，待核对', 'Possible conflict; check needed'), unresolved: L('冲突未解决', 'Unresolved conflict'), resolved: L('冲突已处理', 'Conflict addressed') };
          const button = (name, label, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, icon(name), label);
          const select = (name, label, values) => h('label', { className: 'pa24-memory-filter' }, label, h('select', { value: filters[name], onChange: event => update(name, event.target.value) }, h('option', { value: '' }, L('全部', 'All')), Object.entries(values).map(([value, text]) => h('option', { key: value, value }, text))));
          const prepare = (record, action = 'edit') => {
            const revision = data?.revision;
            setMaintenance({ record, action, revision }); setNote('');
            const names = { new: '新建记忆', edit: '修改这条记忆', confirm: '确认这条记忆的内容', deactivate: '停用这条记忆', activate: '重新启用这条记忆', delete: '把这条记忆移入回收', restore: '恢复这条已回收记忆', purge: '永久删除这条已回收记忆及可恢复版本', undo: '撤销我指定的修订' };
            setInstruction(`请在本地帮我${names[action]}。\n工作区：${workspace.path}\nexpectedRevision=${revision ?? '请先查询'}${record ? `\nid=${record.id}\n当前完整内容：\n${JSON.stringify(record, null, 2)}` : ''}\n${action === 'new' || action === 'edit' ? '我要保存的内容与来源：请填写。' : action === 'confirm' ? '我的明确确认指令：请填写；资料审核通过不代表记忆已确认。' : action === 'undo' ? '需要撤销的修订 ID：请填写；核对完整字段，不能覆盖后续修改。' : '这是我对上述单条记忆的维护指令。'}\n执行前重新读取当前版本；如有冲突先说明，批量变更须先给我预览选择。${action === 'purge' ? '\n仅处理记忆正文与修订副本；原始资料、会话和既有备份另行处理。' : ''}`);
          };
          return h('section', { className: 'pa24-memory-manager' },
            sectionHead('memory', null, L('查阅长期事实与线索；维护由你在本地会话发起。', 'Read long-term facts and clues; initiate maintenance in your local session.'), h('div', { className: 'pa24-row' }, button('refresh', L('刷新记忆', 'Refresh memories'), retry, { disabled: view.status === 'loading', className: 'pa24-quiet' }), button('plus', L('新建记忆', 'New memory'), () => prepare(null, 'new'))), 'neutral'),
            h('div', { className: 'pa24-searchbar' }, h('div', { className: 'pa24-search' }, icon('search'), h('input', { value: draft, placeholder: L('搜索正文、主题或来源…', 'Search content, topic, or source…'), 'aria-label': L('筛选记忆', 'Filter memories'), onChange: event => setDraft(event.target.value), onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) search(); } })), button('search', L('筛选', 'Filter'), search), button('close', L('清空筛选', 'Clear filters'), clear, { className: 'pa24-quiet' })),
            h('div', { className: 'pa24-memory-filters' }, select('category', L('类别', 'Category'), categories), select('confirmation', L('确认依据', 'Confirmation'), confirmationLabels), select('lifecycle', L('使用状态', 'Lifecycle'), lifeLabels), select('freshness', L('时效', 'Validity'), freshnessLabels), select('conflict', L('冲突', 'Conflict'), conflictLabels), select('sourceState', L('来源核验', 'Source check'), sourceLabels), h('label', { className: 'pa24-memory-filter' }, L('项目名称', 'Project name'), h('input', { value: filters.project, onChange: event => update('project', event.target.value), placeholder: L('精确项目名称', 'Exact project name') }))),
            view.status === 'loading' && h('p', { role: 'status', className: 'pa24-row' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取记忆内容…', 'Reading memories…')),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, L('记忆读取失败', 'Failed to read memories')), h('p', null, view.error), h('p', null, data ? L('下方为上次读取结果，当前文件尚未核实。', 'The last read is shown below; current content is unverified.') : L('请在本地检查记忆文件后重试；未用空记录替代读取失败。', 'Check the memory file locally, then retry.')), button('refresh', L('重试读取', 'Retry read'), retry)),
            data && h('div', null,
              h('div', { className: 'pa24-result-meta', role: 'status' }, h('span', null, L(`共 ${data.total} 条 · 匹配 ${data.matched} 条`, `${data.total} total · ${data.matched} matched`)), h('span', null, L('记忆版本 ', 'Memory revision ') + data.revision)),
              data.counts && h('p', { className: 'pa24-meta' }, L(`可作当前事实 ${data.counts.facts} · 待核实线索 ${data.counts.clues} · 停用 ${data.counts.inactive} · 回收 ${data.counts.recycled} · 冲突 ${data.counts.conflicts} · 永久删除标记 ${data.counts.permanent}`, `${data.counts.facts} current facts · ${data.counts.clues} clues · ${data.counts.inactive} inactive · ${data.counts.recycled} recycled · ${data.counts.conflicts} conflicts · ${data.counts.permanent} deletion markers`)),
              data.auditWarning && h('p', { role: 'alert' }, data.auditWarning), data.trackedRevision === 'changed' && h('p', { role: 'status' }, L('检测到 JSON 内容与已记录修订不同；显示当前文件，维护前请核对手工修改。', 'The JSON differs from its recorded revision; current file content is shown. Check manual changes before maintenance.')),
              data.total === 0 ? h('div', { className: 'pa24-card' }, empty('memory', 'neutral', L('从「记住这件事」开始', 'Start with “remember this”'), L('当前没有记忆正文。明确告诉本地24私助要记住的内容和来源。', 'No memory content yet. Tell your local 24PA what to remember and its source.'), button('chat', L('告诉24私助我的偏好', 'Tell 24PA my preferences'), () => prepare(null, 'new'), { className: 'pa24-primary' }))) : data.matched === 0 ? h('div', { className: 'pa24-card' }, empty('search', 'neutral', L('没有找到匹配的记忆', 'No matching memories'), L('可以清空筛选，或切换使用状态与时效。', 'Clear filters or change lifecycle and validity.'), button('close', L('查看全部', 'Show all'), clear))) : h('div', { className: 'pa24-memory-list' }, (data.records || []).map(record => {
                const state = record.effective || { lifecycle: record.lifecycle || 'active', freshness: 'current', confirmation: record.status === 'confirmed' ? 'missing' : 'unverified', conflict: 'none', useAs: 'clue', relatedIds: [] };
                return h('article', { key: record.id, className: 'pa24-memory-card' }, h('div', { className: 'pa24-memory-body' },
                  h('div', { className: 'pa24-memory-heading' }, h('div', { className: 'pa24-row' }, badge(categories[record.category] || record.category, 'neutral'), h('h3', null, record.topic || L('未设置主题', 'No topic set'))), badge(lifeLabels[state.lifecycle], state.lifecycle === 'active' ? 'blue' : 'neutral')),
                  h('div', { className: 'pa24-note' }, record.content), h('div', { className: 'pa24-row' }, badge(confirmationLabels[state.confirmation], state.confirmation === 'verified' ? 'blue' : 'amber'), badge(freshnessLabels[state.freshness], state.freshness === 'current' ? 'neutral' : 'amber'), badge(conflictLabels[state.conflict], ['candidate', 'unresolved'].includes(state.conflict) ? 'amber' : 'neutral')),
                  h('p', { className: 'pa24-meta' }, state.useAs === 'fact' ? L('可以作为当前事实；当前指令仍优先。', 'Usable as a current fact; current instructions take precedence.') : state.useAs === 'clue' ? L('仅作线索，关键参数须核实。', 'Clue only; verify important parameters.') : L('不进入当前业务检索。', 'Excluded from current business retrieval.')),
                  fields([[L('来源', 'Source'), record.source], [L('来源版本', 'Source version'), record.sourceVersion || L('未记录', 'Not recorded')], [L('范围', 'Scope'), record.scope ? [scopeLabels[record.scope.kind] || record.scope.kind, record.scope.name].filter(Boolean).join(' · ') : L('个人（旧记录默认）', 'Personal (legacy default)')], [L('确认依据', 'Confirmation evidence'), record.confirmation?.text || L('未记录本人确认依据', 'Owner confirmation evidence not recorded')], [L('来源核验', 'Source check'), sourceLabels[record.sourceCheck?.state || 'unchecked']], [L('有效期', 'Validity'), [record.validFrom || L('未设开始', 'No start'), record.validUntil || L('未设结束', 'No end')].join(' → ')]]),
                  record.sourceCheck?.evidence && h('p', { className: 'pa24-meta' }, record.sourceCheck.evidence + ' · ' + date(record.sourceCheck.checkedAt, workspace.config?.timeZone || 'Asia/Shanghai')), ['changed', 'unavailable'].includes(record.sourceCheck?.state) && h('p', { className: 'pa24-meta' }, L('来源状态需要关注，不代表事实已被推翻。', 'The source needs attention; this does not disprove the fact.')),
                  record.conflict?.reason && h('p', null, record.conflict.reason), state.relatedIds?.length > 0 && h('p', { className: 'pa24-meta' }, L('关联记忆：', 'Related memories: ') + state.relatedIds.join('、')),
                  h('time', { className: 'pa24-meta', dateTime: record.updatedAt }, date(record.updatedAt, workspace.config?.timeZone || 'Asia/Shanghai'))),
                  h('div', { className: 'pa24-memory-footer' }, h('div', { className: 'pa24-row' }, button('chat', L('维护此记忆', 'Manage this memory'), () => prepare(record)), button('clock', historyId === record.id ? L('收起修订', 'Hide revisions') : L('查看修订', 'View revisions'), () => setHistoryId(value => value === record.id ? null : record.id))),
                    h('details', null, h('summary', null, L('修订依据与 JSON', 'Revision basis & JSON')), h('p', { className: 'pa24-meta' }, L('修订依据：', 'Reason: ') + record.reason), h('p', { className: 'pa24-meta' }, L('修改会话：', 'Updated by: ') + record.updatedBy), h('pre', null, JSON.stringify(record, null, 2))), historyId === record.id && h(MemoryHistory, { id: record.id, workspace, binding })));
              })),
              data.matched > data.limit && h('nav', { className: 'pa24-page-nav', 'aria-label': L('记忆分页', 'Memory pagination') }, button('chevron', L('上一页', 'Previous'), () => setOffset(Math.max(0, data.offset - data.limit)), { disabled: data.offset === 0 }), h('span', null, `${Math.floor(data.offset / data.limit) + 1} / ${Math.ceil(data.matched / data.limit)}`), button('chevron', L('下一页', 'Next'), () => setOffset(data.offset + data.limit), { disabled: data.offset + data.limit >= data.matched }))),
            maintenance && h('section', { className: 'pa24-card', 'aria-label': L('记忆维护指令', 'Memory maintenance instruction') }, h('h3', null, L('在本地会话维护', 'Maintain in your local session')),
              maintenance.record && h('label', { className: 'pa24-memory-filter' }, L('维护操作', 'Maintenance action'), h('select', { value: maintenance.action, onChange: event => prepare(maintenance.record, event.target.value) }, Object.entries({ edit: L('修改', 'Edit'), confirm: L('确认内容', 'Confirm content'), ...(maintenance.record.lifecycle === 'recycled' ? { restore: L('恢复', 'Restore'), purge: L('永久删除', 'Permanently delete') } : { deactivate: L('停用', 'Deactivate'), activate: L('启用', 'Activate'), delete: L('移入回收', 'Recycle') }), undo: L('撤销指定修订', 'Undo a revision') }).map(([value, label]) => h('option', { key: value, value }, label)))),
              h('p', { className: 'pa24-meta' }, L('检查下方内容后复制到本地会话。页面不会替你提交修改。', 'Review and copy this into your local session; the page does not submit changes.')), h('textarea', { rows: 10, 'aria-label': L('记忆对话内容', 'Memory chat draft'), value: instruction, onChange: event => setInstruction(event.target.value) }),
              h('div', { className: 'pa24-row' }, button('chat', L('复制并打开本地对话', 'Copy and open local chat'), async () => { try { await navigator.clipboard.writeText(instruction); await openRobot(); setNote(L('已复制，请粘贴核对后发送。', 'Copied. Paste, review, and send.')); } catch (error) { setNote(L('复制或打开失败，请手动复制内容。', 'Copy or open failed; copy the content manually.') + ' ' + error.message); } }), button('close', L('关闭维护指令', 'Close instruction'), () => setMaintenance(null))), note && h('p', { role: 'status' }, note)),
            h('details', null, h('summary', null, L('存储位置与维护方式', 'Storage & maintenance')), h('p', { className: 'pa24-meta' }, (workspace.path || '') + '/.24pa/memory.json'), h('p', { className: 'pa24-meta' }, L('仅本地维护；批量先预览，撤销形成新修订。回收可以恢复，永久删除清除正文与可恢复版本并留下无正文标记；原资料、会话和备份分别处理。', 'Local maintenance only. Preview batches; undo creates a new revision. Recycling is reversible; permanent deletion removes content and recoverable revisions, leaving a deletion marker. Source material, sessions, and backups are handled separately.'))));
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
            h(ConfigurationEvidence, { state: helpers.state }),
            h(WorkspaceCards, { snapshot: helpers.state, busy: helpers.busy, button: wButton, openRobot: helpers.openRobot, openConfig: () => helpers.openCard('config'), path, onPathChange: setPath }),
            h(HealthBlock, { data: helpers.extra.health }));
        }

        // ---- F26: 能力卡片体系（原型 prototypes/pa24-card-panel v0.3 裁决）----
        // 一级导航＝四分类 tab；卡片＝内容单元：元数据＋tier（角标聚合的纯函数）
        // ＋body（摘要）＋detail（二级详情，原视图平移）。注册即生卡。
        const CATEGORY_TABS = [['work', 'grid', 'blue'], ['knowledge', 'memory', 'violet'], ['setup', 'plug', 'green'], ['ops', 'shield', 'amber']];
        const CARD_HIDDEN_KEY = 'pa24.panelCards.hidden';
        const CATEGORY_MIGRATION = {
          skills: 'work',
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
        const useExtra = (workspacePath, tick, workspaceBinding) => {
          const [view, setView] = React.useState({ status: 'loading', data: null, errors: {} });
          React.useEffect(() => {
            const abort = new AbortController();
            if (!workspacePath) {
              setView({ binding: workspaceBinding, status: 'ready', data: {}, errors: {} });
              return () => abort.abort();
            }
            setView(v => ({ binding: workspaceBinding, status: 'loading', data: v.binding === workspaceBinding ? v.data : null, errors: v.binding === workspaceBinding ? v.errors : {} }));
            const out = {}, errors = {};
            const capture = (key, request) => request.then(result => { out[key] = result; }).catch(error => { errors[key] = error.message; });
            void Promise.all([
              capture('review', rpc('notes.queue', {}, abort.signal)),
              capture('memory', rpc('memory', { query: '', offset: 0 }, abort.signal)),
              capture('health', rpc('health', {}, abort.signal)),
              capture('roles', rpc('roles', {}, abort.signal)),
              capture('reminders', rpc('reminders', {}, abort.signal)),
              capture('calendar', rpc('calendar', { workspaceBinding }, abort.signal)),
              capture('todos', rpc('todos', { workspaceBinding }, abort.signal)),
              capture('digests', rpc('digests', {}, abort.signal)),
              capture('plans', rpc('plans.summary', { workspaceBinding }, abort.signal)),
              capture('runs', rpc('runs.summary', { workspaceBinding }, abort.signal)),
            ]).then(() => { if (!abort.signal.aborted) setView({ binding: workspaceBinding, status: 'ready', data: out, errors }); });
            return () => abort.abort();
          }, [workspacePath, tick, workspaceBinding]);
          return view.binding === workspaceBinding ? { ...(view.data || {}), _status: view.status, _errors: view.errors || {} } : { _status: 'loading', _errors: {} };
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
          for (const proof of (extra.health?.connectionEvidence?.evidence || [])) rows.push(proof.state === 'fault' ? 'error' : proof.state === 'verified' ? 'ok' : ['unverified', 'stale', 'partial', 'unchecked'].includes(proof.state) ? 'warn' : 'info');
          if (state.transport) rows.push(state.transport.connected ? 'ok' : (state.workspace && state.workspace.config && state.workspace.config.mode === 'feishu' ? 'error' : 'warn'));
          if (!rows.length) return { tier: 'unchecked', ok: 0, warn: 0, error: 0 };
          const ok = rows.filter(x => x === 'ok').length, warn = rows.filter(x => x === 'warn').length, error = rows.filter(x => x === 'error').length;
          return { tier: error > 0 ? 'error' : warn > 0 ? 'warn' : 'ok', ok, warn, error };
        };
        const lastActiveCheck = state => {
          const times = [state.diagnostics && state.diagnostics.checkedAt, state.wecom && state.wecom.checkedAt].filter(Boolean).map(x => new Date(x).getTime());
          return times.length ? new Date(Math.max(...times)) : null;
        };
        const wecomChannelsOn = config => !!(config && (config.sources?.entries?.some(row => row.enabled && row.platform === 'wecom') || ['calendarChannel', 'todoChannel', 'notifyChannel'].some(k => config[k] === 'wecom')));
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
        function ConnectionEvidence({ state, platform, openRepair }) {
          const binding = state.workspaceBinding;
          const current = React.useRef(binding); current.current = binding;
          const [data, setData] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
          const [scope, setScope] = React.useState(platform || 'all'), [sources, setSources] = React.useState([]);
          const [testAction, setTestAction] = React.useState(platform === 'wecom' ? 'wecom.push' : 'feishu.send');
          const [sourceId, setSourceId] = React.useState(''), [preview, setPreview] = React.useState(null), [approved, setApproved] = React.useState(false);
          const [cleanId, setCleanId] = React.useState(''), [identityApproved, setIdentityApproved] = React.useState(false), [feedback, setFeedback] = React.useState('');
          const requestId = React.useRef(null);
          const load = async () => {
            const owner = binding;
            const [health, catalog] = await Promise.all([rpc('health.snapshot', { workspaceBinding: owner }), rpc('sources', { workspaceBinding: owner })]);
            if (current.current !== owner) return;
            setData(health); setSources((catalog.entries || []).filter(row => !platform || row.platform === platform)); setError('');
          };
          React.useEffect(() => { let live = true; current.current = binding; setData(null); setSources([]); setPreview(null); setApproved(false); setCleanId(''); setFeedback('');
            void load().catch(failure => { if (live && current.current === binding) setError(failure.message); });
            return () => { live = false; current.current = null; };
          }, [binding, platform, state.workspace?.configVersion, state.diagnostics?.checkedAt, state.wecom?.checkedAt]);
          React.useEffect(() => { setPreview(null); setApproved(false); requestId.current = null; }, [testAction, sourceId]);
          React.useEffect(() => { setApproved(false); setIdentityApproved(false); }, [state.workspace?.configVersion, data?.identity?.observed?.ownerId, data?.identity?.observed?.authority]);
          const run = async work => { const owner = binding; setBusy(true); setFeedback(''); setError('');
            try { const message = await work(); if (current.current === owner) { setFeedback(message || L('操作已记录。', 'Action recorded.')); await load(); } }
            catch (failure) { if (current.current === owner) setError(failure.message); }
            finally { if (current.current === owner) setBusy(false); }
          };
          const names = { verified: '已核验', partial: '部分可用', unverified: '未验证', unchecked: '未检查', disabled: '未启用', no_activity: '无活动', fault: '故障', stale: '证据已过期' };
          const scopeNames = { workspace: '工作区与账本', feishu: '飞书', wecom: '企业微信', sources: '日历与待办来源', materials: '审核与听记', memory: '结构化记忆', skills: 'Skill 管理', plans: '定时任务', models: '模型路由', voice: '语音', backup: '备份与恢复' };
          const rows = (data?.evidence || []).filter(row => !platform || row.scope === platform || row.scope.startsWith(platform + '.') || row.scope.startsWith('source:') && sources.some(source => 'source:' + source.id === row.scope));
          const tests = (data?.tests || []).filter(row => !platform || row.plan.platform === platform);
          const targetLabel = target => typeof target === 'string' ? target : `${target.platform} · ${target.sourceId} · ${target.resource?.id} · ${target.identity?.ownerId} · ${target.identity?.authority}`;
          return h('section', { className: 'pa24-card' },
            sectionHead('shield', L('检查证据与明确测试', 'Evidence and explicit tests'), L('刷新只读已保存证据。主动检查不发消息、不创建对象、不读听记正文、不启动模型。', 'Refresh reads saved evidence; checks create no objects, send no messages, read no minutes, and invoke no model.'),
              h('button', { type: 'button', className: 'pa24-quiet', disabled: busy, onClick: () => void run(async () => { await load(); return L('已读取保存证据。', 'Saved evidence read.'); }) }, icon('refresh'), L('刷新证据', 'Refresh evidence'))),
            error && h('p', { role: 'alert', className: 'pa24-error' }, error, ' ', h('button', { type: 'button', disabled: busy, onClick: () => void run(load) }, L('重试读取', 'Retry read'))),
            feedback && h('p', { role: 'status', className: 'pa24-helper' }, feedback),
            !data && !error && h('p', { role: 'status' }, L('正在读取检查证据…', 'Reading evidence…')),
            h('div', { className: 'pa24-row' }, h('label', null, L('检查范围 ', 'Check scope '), h('select', { value: scope, onChange: event => setScope(event.target.value), disabled: busy },
              h('option', { value: 'all' }, L('全部模块', 'All modules')), Object.entries(scopeNames).map(([value, label]) => h('option', { key: value, value }, label)))),
              h('button', { type: 'button', disabled: busy, onClick: () => void run(async () => { const result = await rpc('action', { type: 'health.check', workspaceBinding: binding, ...(scope === 'all' ? {} : { scopes: [scope] }) }); return L('只读检查已完成，实际覆盖 ', 'Read-only check completed; covered ') + result.evidence.length + L(' 项证据。', ' evidence items.'); }) }, busy ? L('处理中…', 'Working…') : L('执行只读检查', 'Run read-only check'))),
            data && h('p', { className: 'pa24-meta' }, L('当前配置版本：', 'Current config version: ') + data.configVersion?.slice(0, 16) + ' · ' + L('读取时间：', 'Read at: ') + date(data.readAt, tzOf(state))),
            rows.map(row => h('div', { className: 'pa24-resource', key: row.scope }, h('div', { className: 'pa24-row pa24-between' }, h('strong', null, scopeNames[row.scope] || row.scope), badge(names[row.state] || row.state, row.state === 'verified' ? 'green' : row.state === 'fault' ? 'danger' : 'neutral')),
              h('p', null, row.message), h('p', { className: 'pa24-meta' }, row.coverage), h('p', { className: 'pa24-meta' }, L('检查时间 ', 'Checked ') + date(row.checkedAt, tzOf(state)) + ' · ' + L('证据配置 ', 'Evidence config ') + row.configVersion?.slice(0, 16)),
              h('details', null, h('summary', null, L('影响与修复', 'Impact and repair')), h('p', null, row.impact), row.nextSteps.map((step, index) => h('p', { key: index }, step)), h('p', { className: 'pa24-meta' }, L('参数修改请到「参数配置」；修复后重新检查本项。', 'Edit Parameters, then recheck this scope.')), openRepair && h('button', { type: 'button', onClick: () => openRepair(row) }, L('定位修复配置', 'Open relevant configuration'))))),
            data?.monitor && (!platform || platform === 'wecom') && h('details', null, h('summary', null, L('企业微信自动巡检', 'WeCom monitoring')), fields([
              [L('最近巡检', 'Last check'), date(data.monitor.checkedAt, tzOf(state))], [L('巡检频率', 'Cadence'), L('每 6 小时，只读', 'Every 6 hours, read-only')],
              [L('最近通知日', 'Last notification day'), data.monitor.notifiedDay || L('尚未通知', 'None')], [L('静默至', 'Silent until'), data.monitor.silentUntil ? date(data.monitor.silentUntil, tzOf(state)) : '—'],
              [L('通知错误', 'Notification error'), data.monitor.notificationError || '—'], [L('通知渠道', 'Notification channel'), data.monitor.notificationChannel || '—'],
              [L('通知投递状态', 'Notification delivery'), data.monitor.delivery?.status || '—'], [L('投递失败原因', 'Delivery error'), data.monitor.delivery?.last_error || '—'],
            ]), h('p', { className: 'pa24-meta' }, L('每天最多一条；问题持久去重。通知失败留在原渠道，不改投；恢复不清除主人暂停或其他阻断。', 'At most one notification per day; persistent deduplication, no channel fallback, no clearing unrelated blocks.'))),
            data?.identity?.changed && (!platform || platform === 'wecom') && h('div', { className: 'pa24-error' }, h('strong', null, L('企微绑定发生变化', 'WeCom binding changed')),
              h('p', null, L('原身份：', 'Previous: ') + JSON.stringify(data.identity.accepted)), h('p', null, L('当前检测：', 'Observed: ') + JSON.stringify(data.identity.observed)),
              h('label', null, h('input', { type: 'checkbox', checked: identityApproved, onChange: event => setIdentityApproved(event.target.checked) }), L('我已核对原交办、待发和待审，确认使用以上新身份。', 'I have checked original work, pending deliveries, and reviews and confirm this identity.')),
              h('button', { type: 'button', disabled: busy || !identityApproved, onClick: () => void run(async () => { const result = await rpc('action', { type: 'health.identity-accept', workspaceBinding: binding, configVersion: data.configVersion, identity: data.identity.observed, confirm: true }); setIdentityApproved(false); return result.message; }) }, L('确认新绑定', 'Confirm new binding'))),
            h('details', null, h('summary', null, L('明确触发真实测试', 'Explicit real test')),
              h('p', { className: 'pa24-meta' }, L('以下动作会在原平台留下真实对象或消息，先预览目标再确认。', 'These actions leave real objects or messages. Preview the target before confirming.')),
              h('label', null, L('测试动作 ', 'Action '), h('select', { value: testAction, onChange: event => setTestAction(event.target.value), disabled: busy },
                (!platform || platform === 'feishu') && h('option', { value: 'feishu.send' }, L('发送飞书测试消息', 'Feishu test message')), (!platform || platform === 'wecom') && h('option', { value: 'wecom.push' }, L('发送企微测试消息', 'WeCom test message')), h('option', { value: 'source.create' }, L('创建来源测试对象', 'Create source test object')))),
              testAction === 'source.create' && h('label', null, L('登记来源 ', 'Registered source '), h('select', { value: sourceId, onChange: event => setSourceId(event.target.value), disabled: busy }, h('option', { value: '' }, L('请选择明确来源', 'Choose a source')), sources.filter(source => source.enabled && source.access === 'readwrite').map(source => h('option', { key: source.id, value: source.id }, `${source.name} · ${source.domain} · ${source.platform}`)))),
              h('button', { type: 'button', disabled: busy || testAction === 'source.create' && !sourceId, onClick: () => void run(async () => { const next = await rpc('health.test.preview', { workspaceBinding: binding, action: testAction, sourceId }); if (current.current === binding) { setPreview(next); setApproved(false); requestId.current = globalThis.crypto.randomUUID(); } return L('已生成测试预览，尚未执行。', 'Preview ready; no test executed.'); }) }, L('预览测试目标', 'Preview test target')),
              preview && h('div', { className: 'pa24-example' }, fields([[L('目标', 'Target'), targetLabel(preview.plan.target)], [L('动作', 'Action'), preview.plan.description], [L('费用', 'Cost'), preview.plan.cost], [L('残留与清理', 'Residue and cleanup'), preview.plan.residue]]),
                h('label', null, h('input', { type: 'checkbox', checked: approved, onChange: event => setApproved(event.target.checked) }), L('确认对以上目标执行这一次测试', 'Confirm one test against this target')),
                h('button', { type: 'button', className: 'pa24-primary', disabled: busy || !approved, onClick: () => void run(async () => { const result = await rpc('action', { type: 'health.test', workspaceBinding: binding, requestId: requestId.current, ...preview, confirm: true }); setApproved(false); return `${L('测试状态：', 'Test status: ')}${result.status} · ${result.result?.message || result.message || ''}`; }) }, L('执行已确认测试', 'Execute confirmed test')))),
            tests.length > 0 && h('details', null, h('summary', null, L('测试记录、结果与清理', 'Test results and cleanup')), h('p', { className: 'pa24-meta' }, data.testCoverage), tests.map(test => h('div', { key: test.id, className: 'pa24-resource' }, h('strong', null, test.plan.parameters?.title || test.id),
              h('p', null, `${test.plan.action} · ${test.status} · ${targetLabel(test.plan.target)}`), h('p', null, test.result?.message || L('尚无确认回执；请先核对原目标。', 'No confirmed receipt; reconcile the original target first.')),
              test.result?.nativeId && h('p', { className: 'pa24-meta' }, L('原生对象：', 'Native object: ') + test.result.nativeId),
              test.result?.deliveryId && h('p', { className: 'pa24-meta' }, L('投递标识：', 'Delivery ID: ') + test.result.deliveryId + ' · ' + L('原生消息：', 'Native message: ') + (test.result.nativeMessageId || L('平台未返回', 'Not returned'))),
              h('p', { className: 'pa24-meta' }, test.cleanup?.message || test.result?.residue || test.plan.residue),
              test.status === 'succeeded' && test.plan.action === 'source.create' && !test.cleanup && h('div', null,
                h('label', null, h('input', { type: 'checkbox', checked: cleanId === test.id, onChange: event => setCleanId(event.target.checked ? test.id : '') }), L('确认清理此测试对象', 'Confirm cleanup of this test object')),
                h('button', { type: 'button', disabled: busy || cleanId !== test.id, onClick: () => void run(async () => { const result = await rpc('action', { type: 'health.test.cleanup', workspaceBinding: binding, testId: test.id, confirm: true }); setCleanId(''); return result.cleanup?.message; }) }, L('清理测试对象', 'Clean up test object')))))),
            data?.traffic && h('details', null, h('summary', null, L('完整收发集合统计', 'Complete traffic totals')), h('p', { className: 'pa24-meta' }, data.traffic.coverage),
              fields((data.traffic.channels || []).map(row => [`${row.channel} · ${row.status}`, `${row.count} ${L('条', 'rows')}`])), fields((data.traffic.inbox || []).map(row => [`${row.source} · ${row.kind} · ${row.status}`, `${row.count} ${L('条', 'rows')}`]))));
        }

        function FeishuDetail({ state, busy, button, openRobot, openRepair }) {
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
            h(ConnectionEvidence, { state, platform: 'feishu', openRepair }),
            h('section', { className: 'pa24-card' },
              sectionHead('plug', L('飞书接入', 'Feishu access'), L('用自然语言配置，在这里查阅接入情况。', 'Configure in natural language; review the access state here.'),
                h('div', { className: 'pa24-row' },
                  button('refresh', busy ? L('检查中…', 'Checking…') : L('检查接入状态', 'Check access'), () => rpc('action', { type: 'health.check', scopes: ['feishu'], workspaceBinding: state.workspaceBinding })),
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
                button('refresh', L('检查接入状态', 'Check access'), () => rpc('action', { type: 'health.check', scopes: ['feishu'], workspaceBinding: state.workspaceBinding })),
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

        const todoModels = new Map();
        function TodoDetail(helpers) {
          const { state, tz, button, openRobot, openCard } = helpers, binding = state.workspaceBinding;
          if (!todoModels.has(binding)) todoModels.set(binding, { source: '', role: '', status: 'open', deadline: 'all', query: '', offset: 0, draft: '' });
          const model = todoModels.get(binding), [, redraw] = React.useReducer(n => n + 1, 0);
          const [view, setView] = React.useState({ key: '', data: null, busy: false, error: '' }), [sources, setSources] = React.useState([]), [notice, setNotice] = React.useState('');
          const [sourceError, setSourceError] = React.useState(''), [sourceBusy, setSourceBusy] = React.useState(false), [sourceEpoch, reloadSources] = React.useReducer(n => n + 1, 0);
          const sequence = React.useRef(0), limit = 20;
          const args = JSON.stringify({ ...(model.source ? { sourceId: model.source } : {}), ...(model.role ? { role: model.role } : {}), status: model.status, deadline: model.deadline, query: model.query, offset: model.offset, limit, workspaceBinding: binding });
          const validate = result => {
            if (result.workspaceBinding !== binding || !Array.isArray(result.tasks) || !Array.isArray(result.sources) || !result.counts) throw new Error(L('待办响应或工作区不匹配，请刷新重试。', 'Todo response or workspace changed. Refresh and retry.'));
            return result;
          };
          React.useEffect(() => {
            const abort = new AbortController();
            setSourceBusy(true);
            void rpc('sources', { workspaceBinding: binding }, abort.signal).then(result => {
              if (!Array.isArray(result.entries)) throw new Error(L('待办来源响应不完整。', 'Incomplete todo source response.'));
              if (!abort.signal.aborted) { setSources(result.entries.filter(row => row.domain === 'todo')); setSourceError(''); }
            }).catch(error => { if (!abort.signal.aborted) setSourceError(error.message); }).finally(() => { if (!abort.signal.aborted) setSourceBusy(false); });
            return () => abort.abort();
          }, [binding, sourceEpoch]);
          React.useEffect(() => {
            const abort = new AbortController(), epoch = ++sequence.current;
            setView(old => ({ key: args, data: old.key === args ? old.data : null, busy: true, error: '' }));
            void rpc('todos', JSON.parse(args), abort.signal).then(result => {
              if (!abort.signal.aborted && epoch === sequence.current) setView({ key: args, data: validate(result), busy: false, error: '' });
            }).catch(error => { if (!abort.signal.aborted && epoch === sequence.current) setView(old => ({ ...old, busy: false, error: error.message })); });
            return () => { abort.abort(); sequence.current++; };
          }, [args]);
          const verify = async () => {
            reloadSources();
            const epoch = ++sequence.current;
            setView(old => ({ ...old, busy: true, error: '' }));
            try {
              const data = validate(await rpc('action', { type: 'todos.verify', ...JSON.parse(args) }));
              if (epoch === sequence.current) { setView({ key: args, data, busy: false, error: '' }); await helpers.refresh(); }
            } catch (error) { if (epoch === sequence.current) setView(old => ({ ...old, busy: false, error: error.message })); }
          };
          const change = (key, value) => { model[key] = value; if (key !== 'offset' && key !== 'draft') model.offset = 0; redraw(); };
          const select = (label, key, options) => h('label', { className: 'pa24-field' }, label, h('select', { value: model[key], onChange: event => change(key, event.target.value) }, options.map(([value, title]) => h('option', { key: value, value }, title))));
          const roleLabel = value => ({ all: L('全部授权可见', 'All authorized'), responsible: L('我负责的', 'Assigned to me'), following: L('我关注的', 'Following'), assigned: L('我交办的', 'Assigned by me'), creator: L('我创建的', 'Created by me') }[value] || value);
          const stateLabel = value => ({ complete: L('范围已核验', 'Range verified'), partial: L('范围不完整', 'Incomplete scope'), failed: L('核验失败', 'Verification failed'), disabled: L('已停用', 'Disabled'), unverified: L('待核验', 'Unverified') }[value] || value);
          const prepare = (action, task, location) => {
            model.draft = `请帮我${action}。${task ? `原待办：${task.summary}，guid=${task.guid}，objectId=${task.objectId}。来源：${location.sourceName}（sourceId=${location.sourceId}）。` : `${model.source ? `sourceId=${model.source}。` : ''}内容：请补充。负责人默认我本人，未给截止时请保留未设置。`}${action === '延期或修改' ? '新内容或截止：请补充。' : action === '完成待办' || action === '取消待办' ? '请按原平台核对本人份额与整项影响，有歧义时先确认。' : ''}`;
            setNotice(''); redraw();
          };
          const data = view.key === args ? view.data : null;
          return h('section', { className: 'pa24-sources', 'data-testid': 'todo-detail' },
            sectionHead('tasks', L('待办', 'Todos'), L('原平台业务工作。记录待办与交办助理执行分别办理。', 'Platform business tasks. Recording a todo is separate from asking the assistant to execute it.'),
              h('div', { className: 'pa24-row' }, button('refresh', view.busy ? L('核验中…', 'Verifying…') : L('核验待办', 'Verify todos'), verify, { disabled: view.busy }), button('plus', L('记录待办', 'Record todo'), () => prepare('记录待办')), button('settings', L('配置待办来源', 'Configure sources'), () => openCard('config', 'pa24-sources'), { className: 'pa24-quiet' })), 'blue'),
            h('div', { className: 'pa24-source-fields' },
              select(L('待办来源', 'Todo source'), 'source', [['', L('全部已登记来源', 'All registered sources')], ...(model.source && !sources.some(row => row.id === model.source) ? [[model.source, model.source + L('（来源待加载）', ' (source pending)')]] : []), ...sources.map(row => [row.id, row.name])]),
              select(L('本人角色', 'My role'), 'role', [['', L('按来源默认', 'Source defaults')], ...['all', 'responsible', 'following', 'assigned', 'creator'].map(value => [value, roleLabel(value)])]),
              select(L('业务状态', 'Business status'), 'status', [['open', L('未完成', 'Open')], ['completed', L('已完成', 'Completed')], ['all', L('全部可见状态', 'All visible states')]]),
              select(L('截止范围', 'Deadline'), 'deadline', [['all', L('全部', 'All')], ['overdue', L('已逾期', 'Overdue')], ['today', L('今日尚未到期', 'Due later today')], ['undated', L('未设置截止', 'No deadline')], ['upcoming', L('以后到期', 'Upcoming')]]),
              h('label', { className: 'pa24-field' }, L('搜索待办', 'Search todos'), h('input', { value: model.query, onChange: event => change('query', event.target.value) }))),
            sourceError && h('div', { role: 'alert', className: 'pa24-error' }, L('待办来源加载失败：', 'Todo source loading failed: ') + sourceError, button('refresh', sourceBusy ? L('来源加载中…', 'Loading sources…') : L('重试加载来源', 'Retry sources'), reloadSources, { disabled: sourceBusy })),
            view.error && h('div', { role: 'alert', className: 'pa24-error' }, view.error, button('refresh', L('重试核验', 'Retry verification'), verify, { disabled: view.busy })),
            view.busy && h('p', { role: 'status', className: 'pa24-meta' }, L('正在读取待办；普通浏览不访问原平台。', 'Reading saved todos; browsing does not access the platforms.')),
            data && h('div', null,
              h('p', { role: 'status', className: data.fresh ? 'pa24-notice' : 'pa24-warning' }, data.message),
              capKpi([[data.counts.overdue, L('逾期', 'Overdue')], [data.counts.today, L('今日到期', 'Due today')], [data.counts.open, L('未完成', 'Open')]]),
              h('p', { className: 'pa24-meta' }, data.total === null ? L('计数来自当前可展示的筛选结果，未完整核验时不是全部待办总数。', 'Counts reflect currently available matches; incomplete verification is not a complete total.') : L('计数来自完整筛选结果，分页不会改变总数。', 'Counts cover all matches, regardless of page.')),
              h('details', { className: 'pa24-card' }, h('summary', null, L('来源、查询范围与核验时间', 'Sources, scope and verification')),
                data.sources.length ? data.sources.map(row => h('div', { className: 'pa24-job', key: row.sourceId }, h('strong', null, row.name), ' · ', badge(stateLabel(row.state), row.state === 'complete' ? 'blue' : 'amber'),
                  h('p', { className: 'pa24-meta' }, roleLabel(row.filter) + ' · ' + (row.checkedAt ? date(row.checkedAt, tz) : L('尚无核验记录', 'Never verified'))), row.reason && h('p', { className: 'pa24-warning' }, row.reason))) : h('p', null, L('尚未登记来源。', 'No registered sources.'))),
              data.tasks.length === 0 && h('div', { className: 'pa24-card' }, data.total === 0 ? L('没有符合当前筛选的待办。', 'No todos match the current filters.') : L('没有可展示的结果；请核验来源，不能据此判断全部完成。', 'No results available. Verify sources; this does not prove everything is complete.')),
              data.tasks.map(task => h('article', { key: task.objectId, className: 'pa24-card' },
                h('div', { className: 'pa24-row pa24-between' }, h('h3', null, task.summary), badge(task.status === 'completed' ? L('业务已完成', 'Business completed') : task.status === 'open' ? L('业务未完成', 'Business open') : L('业务状态待核验', 'Status unverified'), task.status === 'completed' ? 'green' : 'amber')),
                h('p', { className: 'pa24-meta' }, L('负责人：', 'Assignees: ') + ((task.assignees || []).map(person => person.name || person.id).join('、') || L('尚未核实', 'Unverified'))),
                h('p', { className: 'pa24-meta' }, L('截止：', 'Due: ') + (task.dueDate || (task.dueAt ? date(task.dueAt, tz) : L('未设置', 'Not set'))) + (task.stale ? L(' · 保存的观察结果', ' · Saved observation') : '')),
                task.description && h('p', null, task.description),
                (task.locations || []).map(location => h('div', { className: 'pa24-job', key: location.sourceId },
                  h('p', { className: 'pa24-meta' }, location.sourceName + ' · ' + (location.platform === 'wecom' ? '企业微信' : '飞书') + ' · ' + (location.roles.values.map(roleLabel).join('、') || L('本人角色待核验', 'Role unverified'))),
                  h('div', { className: 'pa24-row' }, button('check', L('完成待办', 'Complete todo'), () => prepare('完成待办', task, location)), button('edit', L('延期或修改', 'Reschedule or edit'), () => prepare('延期或修改', task, location)), button('close', L('取消待办', 'Cancel todo'), () => prepare('取消待办', task, location), { className: 'pa24-quiet' })))),
                h('div', { className: 'pa24-row' }, task.url && h('a', { className: 'pa24-btn', href: task.url, target: '_blank', rel: 'noreferrer' }, icon('external'), L('打开原待办', 'Open original todo')),
                  (task.workItemIds || []).map(id => button('pulse', L('查看关联交办', 'View linked work'), () => helpers.openRuns ? helpers.openRuns({ kind: 'work', workId: id, range: 'all' }) : openCard('activity'), { key: id, className: 'pa24-quiet' }))))),
              h('div', { className: 'pa24-row' }, button('arrow-left', L('上一页', 'Previous'), () => change('offset', Math.max(0, model.offset - limit)), { disabled: model.offset === 0 || view.busy }), h('span', { className: 'pa24-meta' }, `${data.tasks.length ? model.offset + 1 : 0}–${Math.min(model.offset + data.tasks.length, data.count)} / ${data.count}`), button('arrow-right', L('下一页', 'Next'), () => change('offset', model.offset + limit), { disabled: !data.hasMore || view.busy }))),
            model.draft && h('section', { className: 'pa24-card' }, h('h3', null, L('对话办理草稿', 'Chat request draft')), h('label', { className: 'pa24-field' }, L('请求内容', 'Request'), h('textarea', { rows: 5, value: model.draft, onChange: event => change('draft', event.target.value) })),
              h('p', { className: 'pa24-meta' }, L('补充后复制到24私助对话，由你发送；此处不会自动发起业务变更。', 'Complete and copy this into your 24PA chat to send. This draft does not change business data.')),
              h('div', { className: 'pa24-row' }, button('copy', L('复制草稿', 'Copy draft'), async () => { try { await navigator.clipboard.writeText(model.draft); setNotice(L('草稿已复制。', 'Draft copied.')); } catch { setNotice(L('复制失败，请选中文字手动复制。', 'Copy failed; select the draft and copy it.')); } }), button('chat', L('打开24私助对话', 'Open 24PA chat'), openRobot)), notice && h('p', { role: 'status' }, notice)));
        }

        function CalendarDetail(helpers) {
          const { state, config, tz, button, openRobot, openCard } = helpers;
          const binding = state.workspaceBinding;
          const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
          const [day, setDay] = React.useState(today), [period, setPeriod] = React.useState('day'), [source, setSource] = React.useState(''), [role, setRole] = React.useState('');
          const [query, setQuery] = React.useState(''), [offset, setOffset] = React.useState(0), [view, setView] = React.useState({ data: null, error: '', busy: false });
          const [sources, setSources] = React.useState([]), [draft, setDraft] = React.useState(''), [note, setNote] = React.useState('');
          const sequence = React.useRef(0), limit = 20;
          const validateView = data => {
            if (data.workspaceBinding !== binding) throw new Error(L('工作区已变化，请刷新后重试。', 'Workspace changed. Refresh and retry.'));
            if (!Array.isArray(data.events) || !Array.isArray(data.sources) || !Array.isArray(data.conflicts)) throw new Error(L('日程响应不完整，请重新读取。', 'Incomplete calendar response. Retry reading.'));
            return data;
          };
          const args = JSON.stringify({ date: day, period, ...(source ? { sourceId: source } : {}), ...(role ? { role } : {}), query, offset, limit, workspaceBinding: binding });
          React.useEffect(() => {
            const abort = new AbortController();
            void rpc('sources', { workspaceBinding: binding }, abort.signal).then(result => { if (!abort.signal.aborted) setSources(result.entries.filter(row => row.domain === 'calendar')); }).catch(() => {});
            return () => abort.abort();
          }, [binding]);
          React.useEffect(() => {
            const abort = new AbortController(), epoch = ++sequence.current;
            setView(v => ({ ...v, error: '', busy: true }));
            void rpc('calendar', JSON.parse(args), abort.signal).then(data => {
              if (!abort.signal.aborted && epoch === sequence.current) setView({ data: validateView(data), error: '', busy: false });
            }).catch(error => { if (!abort.signal.aborted && epoch === sequence.current) setView(v => ({ ...v, error: error.message, busy: false })); });
            return () => { abort.abort(); sequence.current++; };
          }, [args]);
          const verify = async () => {
            const epoch = ++sequence.current;
            setView(v => ({ ...v, error: '', busy: true }));
            try {
              const data = await rpc('action', { type: 'calendar.verify', ...JSON.parse(args) });
              if (epoch === sequence.current) { setView({ data: validateView(data), error: '', busy: false }); await helpers.refresh(); }
            } catch (error) { if (epoch === sequence.current) setView(v => ({ ...v, error: error.message, busy: false })); }
          };
          const change = setter => value => { setter(value); setOffset(0); };
          const status = row => ({ complete: L('范围已核验', 'Range verified'), partial: L('部分结果', 'Partial'), failed: L('核验失败', 'Check failed'), disabled: L('已停用', 'Disabled'), unverified: L('待核验', 'Unverified') }[row.state] || row.state);
          const select = (label, value, setter, choices) => h('label', { className: 'pa24-field' }, label, h('select', { value, disabled: view.busy, onChange: e => change(setter)(e.target.value) }, choices.map(([value, title]) => h('option', { key: value, value }, title))));
          const prepare = (action, event, location) => {
            const scope = location ? `来源：${location.sourceName}（sourceId=${location.sourceId}），原日程 ${event.summary}，${event.start} 至 ${event.end}，eventId=${location.locator.eventId}，objectId=${event.objectId}。` : `日期：${day}，时区：${tz}。${source ? `sourceId=${source}。` : ''}`;
            setDraft(`请帮我${action}。${scope}${action === '改期' ? '新时间：请补充。' : action === '创建日程' ? '主题和起止时间：请补充。' : ''}${event?.recurring ? '这是重复日程，请先确认本次、以后或全系列范围。' : ''}`);
            setNote('');
          };
          const data = view.data;
          return h('section', { 'data-testid': 'calendar-detail' },
            sectionHead('calendar', L('日程', 'Calendar'), L('汇总全部已登记日历。普通查看读取已保存结果；“核验日历”只读取原平台。', 'Aggregate registered calendars. Browsing reads saved observations; Verify calendars reads the platforms.'),
              h('div', { className: 'pa24-row' }, button('refresh', view.busy ? L('读取中…', 'Reading…') : L('核验日历', 'Verify calendars'), verify, { disabled: view.busy }), button('plus', L('创建日程', 'Create event'), () => prepare('创建日程')), button('settings', L('配置日历来源', 'Configure sources'), () => openCard('config', 'pa24-sources'), { className: 'pa24-quiet' })), 'amber'),
            h('div', { className: 'pa24-source-fields' },
              h('label', { className: 'pa24-field' }, L('日期', 'Date'), h('input', { type: 'date', value: day, disabled: view.busy, onChange: e => change(setDay)(e.target.value) })),
              select(L('时段', 'Period'), period, setPeriod, [['day', L('全天', 'Whole day')], ['morning', L('上午', 'Morning')], ['afternoon', L('下午', 'Afternoon')], ['evening', L('晚间', 'Evening')]]),
              select(L('日历来源', 'Calendar source'), source, setSource, [['', L('全部已登记来源', 'All registered sources')], ...sources.map(row => [row.id, row.name])]),
              select(L('参与范围', 'Role filter'), role, setRole, [['', L('按各来源默认', 'Source defaults')], ['all', L('全部授权可见', 'All authorized events')], ['involved', L('本人参与或组织', 'Participating or organizing')], ['organizer', L('本人组织', 'Organizing')], ['participant', L('本人参与', 'Participating')]]),
              h('label', { className: 'pa24-field' }, L('搜索日程', 'Search events'), h('input', { value: query, onChange: e => change(setQuery)(e.target.value) }))),
            view.error && h('div', { role: 'alert', className: 'pa24-error' }, view.error, button('refresh', L('重试核验', 'Retry verification'), verify, { disabled: view.busy })),
            view.busy && h('p', { role: 'status', className: 'pa24-meta' }, L('正在读取，现有结果保留到新请求完成。', 'Reading; previous results stay visible until this request finishes.')),
            data && h('div', null,
              h('p', { className: data.fresh ? 'pa24-notice' : 'pa24-warning', role: 'status' }, data.message),
              capKpi([[data.total === null ? L('未确认', 'Unconfirmed') : data.total, L('筛选后的完整总数', 'Complete filtered count')], [data.count, L('当前可展示', 'Currently available')], [data.conflicts.length, L('冲突', 'Conflicts')]]),
              h('section', { className: 'pa24-card' }, h('h3', null, L('逐来源范围与核验时间', 'Scope and verification by source')),
                data.sources.length === 0 ? h('p', null, L('尚未登记来源，不能据此判断没有日程。', 'No sources registered; this does not mean no events.')) : data.sources.map(row => h('div', { className: 'pa24-job', key: row.sourceId },
                  h('div', { className: 'pa24-row pa24-between' }, h('strong', null, row.name), badge(status(row), row.state === 'complete' ? 'blue' : 'amber')),
                  h('p', { className: 'pa24-meta' }, (row.platform === 'wecom' ? '企业微信' : '飞书') + ' · ' + L('筛选 ', 'Filter ') + ({ all: L('全部', 'All'), involved: L('本人参与或组织', 'Involved'), organizer: L('本人组织', 'Organizer'), participant: L('本人参与', 'Participant') }[row.filter] || row.filter) + ' · ' + L('核验 ', 'Checked ') + (row.checkedAt ? date(row.checkedAt, tz) : L('尚无记录', 'Never'))),
                  row.lastCompleteAt && h('p', { className: 'pa24-meta' }, L('最近完整核验 ', 'Last complete check ') + date(row.lastCompleteAt, tz)),
                  row.reason && h('p', { className: 'pa24-warning' }, row.reason), row.unknownRoles > 0 && h('p', { className: 'pa24-warning' }, L('参与关系未完整核实：', 'Incomplete role evidence: ') + row.unknownRoles)))),
              data.events.length === 0 ? h('div', { className: 'pa24-card' }, h('p', null, data.fresh ? L('该范围没有符合筛选的日程。', 'No matching events in this verified range.') : L('当前没有可展示的结果，请先核验来源；不能认定全部空闲。', 'No displayable result yet. Verify sources before concluding availability.'))) :
                data.events.map(event => h('article', { key: event.objectId, className: 'pa24-card' }, h('div', { className: 'pa24-row pa24-between' }, h('h3', null, event.summary || L('无标题', 'Untitled')), event.stale && badge(L('已保存观察', 'Saved observation'), 'amber')),
                  h('p', null, date(event.start, tz) + ' — ' + date(event.end, tz) + ' · ' + (event.timezone || tz)),
                  event.recurring && h('p', { className: 'pa24-meta' }, L('重复日程 · 变更前需明确影响范围', 'Recurring event · specify the change scope')),
                  data.conflicts.some(pair => pair.a === event.objectId || pair.b === event.objectId) && h('p', { className: 'pa24-warning' }, L('与其他安排重叠，尚未调整。', 'Overlaps another event; no changes made.')),
                  event.locations.map(location => h('div', { key: location.sourceId, className: 'pa24-job' }, h('p', { className: 'pa24-meta' }, location.sourceName + ' · ' + (location.roles.values.length ? location.roles.values.map(value => ({ organizer: '组织者', participant: '参与人', creator: '创建者' }[value] || value)).join('、') : L('无已确认的本人关系', 'No confirmed personal role'))),
                    h('div', { className: 'pa24-row' }, /^https?:\/\//.test(location.locator.url || '') && h('a', { className: 'pa24-link-button', href: location.locator.url, target: '_blank', rel: 'noreferrer' }, icon('external'), L('打开原日程', 'Open original event')),
                      button('chat', L('改期', 'Reschedule'), () => prepare('改期', event, location), { className: 'pa24-quiet' }),
                      button('chat', L('取消日程', 'Cancel event'), () => prepare('取消日程，先核验原来源与影响范围', event, location), { className: 'pa24-quiet' }),
                      button('chat', L('仅取消本人提醒', 'Remove my reminder only'), () => prepare('仅取消本人提醒，保留会议', event, location), { className: 'pa24-quiet' })))))),
              h('div', { className: 'pa24-row' }, button('arrow', L('上一页', 'Previous'), () => setOffset(Math.max(0, offset - limit)), { disabled: view.busy || offset === 0 }), h('span', null, L('第 ', 'Page ') + (Math.floor(offset / limit) + 1) + L(' 页', '')), button('arrow', L('下一页', 'Next'), () => setOffset(offset + limit), { disabled: view.busy || !data.hasMore }))),
            draft && h('section', { className: 'pa24-card' }, h('h3', null, L('带上下文继续对话', 'Continue with context')), h('p', { className: 'pa24-meta' }, L('补充需求后复制到对话，发送后由24私助核验办理。', 'Complete the request, copy it into chat, and send it for 24PA to verify and handle.')),
              h('textarea', { 'aria-label': L('日程对话内容', 'Calendar chat draft'), rows: 5, value: draft, onChange: e => setDraft(e.target.value) }),
              button('chat', L('复制并打开对话', 'Copy and open chat'), async () => { try { await navigator.clipboard.writeText(draft); } catch { setNote(L('无法自动复制，请手动复制上方内容后打开对话。', 'Copy the text manually, then open chat.')); return; } await openRobot(); setNote(L('已复制，请粘贴到对话并检查后发送。', 'Copied. Paste into chat, review, and send.')); }), button('chat', L('打开对话', 'Open chat'), openRobot, { className: 'pa24-quiet' }), note && h('p', { role: 'status' }, note)),
            h('details', { className: 'pa24-card' }, h('summary', null, L('提醒备份与历史', 'Reminder backups and history')), h(ReminderDetail, helpers)));
        }

        function ReminderDetail({ extra, config, tz, button, openRobot, refresh }) {
          const data = extra.reminders;
          const rules = data?.rules ?? [];
          const occurrences = data?.occurrences ?? [];
          const kindName = kind => ({ once: L('单次', 'Once'), every: L('按间隔', 'Interval'), daily: L('每日', 'Daily'), weekly: L('每周', 'Weekly') }[kind] || kind);
          const ruleStatus = status => {
            const meta = {
              delegated: [L('日历 App 提醒', 'Calendar app reminder'), 'blue', 'calendar'],
              active: [L('已启用', 'Active'), 'blue', 'check'], paused: [L('已暂停', 'Paused'), 'amber', 'clock'],
              stopped: [L('已停止', 'Stopped'), 'neutral', 'close'], completed: [L('已结束', 'Completed'), 'neutral', 'check'],
            }[status];
            return meta ? badge(...meta) : badgeOf(status);
          };
          const occurrenceStatus = status => status === 'skipped'
            ? badge(L('已跳过', 'Skipped'), 'neutral', 'close')
            : status === 'snoozed' ? badge(L('已稍后', 'Snoozed'), 'amber', 'clock') : badgeOf(status);
          return h('section', null,
            sectionHead('clock', L('提醒管理', 'Reminder management'), L('时钟提醒由日历 App 送达，稍后与改期在对应 App 办理；条件跟进由智能任务执行。', 'Calendar apps deliver clock reminders and handle snoozing; agent skills handle follow-ups.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新', 'Refresh'), refresh, { className: 'pa24-quiet' }), button('chat', L('通过对话管理', 'Manage in chat'), openRobot)), 'amber'),
            extra._errors?.reminders && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, L('提醒读取失败', 'Failed to read reminders')), h('p', null, extra._errors.reminders)),
            !data && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取提醒…', 'Reading reminders…')),
            data && rules.length === 0 && occurrences.length === 0 && h('div', { className: 'pa24-card' }, empty('clock', 'amber', L('还没有提醒', 'No reminders yet'), L('告诉24私助要提醒的内容和时间，保存后可在这里核对。', 'Tell 24PA what and when to remind; saved rules will appear here.'), button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot, { className: 'pa24-primary' }))),
            rules.length > 0 && h('section', { className: 'pa24-card' }, sectionHead('tasks', L('提醒规则', 'Reminder rules'), L('核对实际日历归属、事件与首次安排。', 'Inspect the actual calendar, event, and original start.')), rules.map(rule => h('article', { key: rule.ruleId, className: 'pa24-job' },
              h('div', { className: 'pa24-row pa24-between' }, h('h3', null, rule.text), ruleStatus(rule.status)),
              h('div', { className: 'pa24-row' }, badge(kindName(rule.kind), 'neutral', 'clock')),
              h('p', { className: 'pa24-meta' }, (rule.expression || rule.kind) + ' · ' + rule.timeZone),
              h('p', { className: 'pa24-meta' }, rule.calendarChannel ? (rule.calendarChannel === 'wecom' ? L('企微日历', 'WeCom Calendar') : L('飞书日历', 'Feishu Calendar')) + ' · ' + L('事件 ', 'Event ') + (rule.eventId || L('标识待核对', 'ID unconfirmed')) : L('历史账本记录', 'Legacy ledger record')),
              h('p', { className: 'pa24-meta' }, rule.firstStart ? L('首次安排 ', 'Original start ') + date(rule.firstStart, tz) + ' · ' + L('后续时间以日历 App 为准', 'Check the calendar app for future occurrences') : rule.nextDueAt ? L('下次触发 ', 'Next due ') + date(rule.nextDueAt, tz) : L('没有后续账本计时', 'No future ledger timer')),
              rule.firstReminderAt && h('p', { className: 'pa24-meta' }, L('首次提醒时刻 ', 'Original reminder time ') + date(rule.firstReminderAt, tz) + ' · ' + L('原生编辑后以 App 为准', 'After native edits, check the app')),
              rule.stopReason && h('p', { className: 'pa24-meta' }, rule.stopReason),
              rule.nextOccurrence && h('p', { className: 'pa24-meta' }, L('待发送实例 ', 'Pending occurrence ') + date(rule.nextOccurrence.dueAt, tz))))),
            occurrences.length > 0 && h('section', { className: 'pa24-card' }, sectionHead('pulse', L('最近投递实例', 'Recent occurrences'), L('到期、稍后、跳过、发送和异常状态。', 'Due, snoozed, skipped, sent, and failed occurrences.')), occurrences.slice(0, 12).map(row => h('article', { key: row.id, className: 'pa24-job' },
              h('div', { className: 'pa24-row pa24-between' }, h('h3', null, row.ruleId), occurrenceStatus(row.status)),
              h('p', { className: 'pa24-meta' }, L('计划时间 ', 'Due ') + date(row.dueAt, tz) + (row.deferredUntil ? L(' · 稍后到 ', ' · Snoozed until ') + date(row.deferredUntil, tz) : ''))))),
            h('p', { className: 'pa24-meta' }, L('提醒归属以每条记录的日历渠道为准；这里保留备份和历史，平台接受不代表本人已读。', 'Each record keeps its calendar channel; this view preserves backups and history. Platform acceptance does not mean read.')));
        }

        // Owned by Panel, keyed by workspace and plan; leaving the detail must
        // not discard an in-flight action, its result, or an unsaved draft.
        function planRowState(states, key, plan) {
          if (!states.has(key)) {
            let value = { plan, time: (plan.schedule?.daily ?? plan.schedule?.weekly)?.time ?? '', dirty: false, busy: false, note: '', error: '' };
            const listeners = new Set();
            states.set(key, {
              getSnapshot: () => value,
              subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
              update: patch => { value = { ...value, ...patch }; listeners.forEach(listener => listener()); },
            });
          }
          return states.get(key);
        }

        function PlanCard({ plan: incomingPlan, skills, config, tz, refresh, planStates, workspaceKey }) {
          const row = planRowState(planStates, JSON.stringify([workspaceKey, incomingPlan.planId]), incomingPlan);
          const { plan, time, busy, note, error } = React.useSyncExternalStore(row.subscribe, row.getSnapshot);
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

            React.useEffect(() => {
              if (row.getSnapshot().busy) return;
              row.update({ plan: incomingPlan, ...(!row.getSnapshot().dirty ? { time: (incomingPlan.schedule?.daily ?? incomingPlan.schedule?.weekly)?.time ?? '' } : {}) });
            }, [incomingPlan, row]);
            const button = (name, label, fn, props = {}) => h('button', { type: 'button', onClick: () => void fn(), ...props }, name && icon(name), label);
            const editable = plan.status === 'active' && (plan.schedule?.daily || plan.schedule?.weekly);
            const act = async (fn, okText, confirmTime = false) => {
              if (row.getSnapshot().busy) return;
              row.update({ busy: true, error: '', note: '' });
              try {
                const r = await fn();
                const confirmed = (await rpc('digests')).plans?.find(row => row.planId === plan.planId);
                if (!confirmed) throw new Error(L('操作返回后未读到该计划，请刷新核对。', 'The updated plan could not be read; refresh to check.'));
                row.update({ plan: confirmed, note: okText + (r?.message ? '：' + r.message : ''),
                  ...(confirmTime || !row.getSnapshot().dirty ? { dirty: false, time: (confirmed.schedule?.daily ?? confirmed.schedule?.weekly)?.time ?? '' } : {}) });
                await refresh();
              } catch (e) {
                row.update({ error: e.message });
              } finally { row.update({ busy: false }); }
            };
            const saveTime = () => act(
              () => rpc('action', { type: 'digest.reschedule', planId: plan.planId, kind: plan.kind, time: time.length === 5 ? time + ':00' : time, timeZone: (plan.schedule?.daily ?? plan.schedule?.weekly)?.time_zone, weekdays: plan.schedule?.weekly?.weekdays }),
              L('已改时间', 'Rescheduled'), true);
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
                  h('input', { type: 'time', step: 1, value: time, onChange: e => row.update({ dirty: true, time: e.target.value }), disabled: busy, style: { width: 110, minHeight: 34 } }),
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
        }

        function DigestDetail({ extra, state, config, tz, button, openRobot, openCard, refresh, planStates }) {
          const plans = (extra.digests?.plans ?? []).filter(plan => !plan.managed);
          const skills = extra.digests?.skills ?? [];
          const on = voiceOn(config);
          const tts = state.tts;
          const probe = tts?.probe?.result;
          const engineLine = !on
            ? L('语音版未启用：可在参数表单的「语音 TTS」分组选择引擎。', 'Voice is off: choose an engine in the Voice TTS section of the config form.')
            : L(`语音引擎：${config.tts.engine}${tts?.voice ? ' · ' + tts.voice : ''}`, `Voice engine: ${config.tts.engine}${tts?.voice ? ' · ' + tts.voice : ''}`);
          return h('section', null,
            sectionHead('pulse', L('周期服务计划', 'Scheduled service plans'), L('按计划直接改时间、语音与任务 skill，并可立即运行一次；复杂变更仍通过24私助会话。', 'Edit time, voice, and task skill per plan and run once on demand; complex changes stay in chat.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新', 'Refresh'), refresh, { className: 'pa24-quiet' }), button('chat', L('通过对话调整', 'Adjust in chat'), openRobot)), 'green'),
            extra._errors?.digests && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, L('计划读取失败', 'Failed to read plans')), h('p', null, extra._errors.digests)),
            !extra.digests && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取周期计划…', 'Reading digest plans…')),
            extra.digests && plans.length === 0 && h('div', { className: 'pa24-card' }, empty('pulse', 'green', L('还没有周期服务计划', 'No digest plans yet'), L('对24私助说「开启晨报」或「开启每周回顾」即可建立计划。', 'Ask 24PA to enable the morning digest or weekly retrospective.'), button('chat', L('与24私助对话', 'Chat with 24PA'), openRobot, { className: 'pa24-primary' }))),
            plans.length > 0 && h('section', { className: 'pa24-card' }, plans.map(p => h(PlanCard, { key: p.planId, plan: p, skills, tz, config, refresh, planStates, workspaceKey: state.workspace?.path ?? '' }))),
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

        const planStateLabel = plan => plan.recycled_at ? L('已回收', 'Recycled') : plan.delete_when_idle ? L('等待结束后删除', 'Deleting after completion')
          : plan.blocks?.length || plan.skillBlock ? L('需处理', 'Needs attention') : plan.status === 'active' && (!plan.task_config || plan.owner_enabled) ? L('已启用', 'Enabled') : L('已暂停', 'Paused');
        const planTimingLabel = plan => {
          const spec = plan.schedule_spec || {}, zone = plan.task_config?.timeZone || spec.daily?.time_zone || spec.weekly?.time_zone || spec.cron?.time_zone;
          if (spec.at) return L('一次性 · ', 'Once · ') + date(spec.at, zone);
          if (spec.daily) return L('每天 ', 'Daily ') + spec.daily.time + ' · ' + zone;
          if (spec.weekly) return (plan.kind === 'weekdays' ? L('周一至周五（不含法定工作日判断）', 'Monday–Friday (no holiday calendar)')
            : L('每周 ', 'Weekly ') + spec.weekly.weekdays.map(day => L('星期' + '一二三四五六日'[day - 1], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1])).join('、')) + ' · ' + spec.weekly.time + ' · ' + zone;
          if (spec.every_seconds) return L('每隔 ', 'Every ') + spec.every_seconds + L(' 秒', ' seconds');
          if (spec.cron) return L('规则 ', 'Rule ') + spec.cron.expression + ' · ' + zone + (plan.kind === 'monthly' ? L('（无该月日期则跳过）', ' (skip missing dates)') : '');
          return L('历史未记录时间规则', 'Timing rule not recorded');
        };
        const runStatusLabel = value => ({ pending: L('排队待执行', 'Queued'), running: L('执行中', 'Executing'), waiting: L('等待处理', 'Waiting'), timed_out: L('累计执行超时', 'Execution timed out'), stopping: L('正在停止', 'Stopping'), stopped: L('已停止', 'Stopped'), completed: L('执行已结束', 'Execution finished'), failed: L('执行失败', 'Execution failed'), needs_reconciliation: L('结果待核对', 'Needs reconciliation') }[value] || t(value));
        const runSourceLabel = value => ({ manual: L('手工', 'Manual'), schedule: L('计划', 'Scheduled'), trial: L('试运行', 'Trial'), rerun: L('重跑', 'Rerun'), continuation: L('接续', 'Continuation'), local: L('本地', 'Local'), feishu: L('飞书', 'Feishu') }[value] || L('历史未记录', 'Not recorded'));
        const deliveryLabel = (value, channel) => ({ not_requested: L('仅保存', 'Saved only'), suppressed: L('按规则不推送', 'Suppressed by rule'), pending: L('待投递', 'Pending delivery'), sending: L('正在投递', 'Sending'), sent: channel === 'local' ? L('已送入原会话', 'Delivered to original session') : channel ? L('平台已接收', 'Platform received') : L('结果已投递', 'Result delivered'), partial: L('部分投递', 'Partially delivered'), failed: L('投递失败', 'Delivery failed'), unknown: L('投递待核对', 'Delivery unknown'), expired: L('过期未投递', 'Expired') }[value] || L('历史未记录', 'Not recorded'));
        const saveDownload = file => {
          const url = URL.createObjectURL(new Blob([file.content], { type: 'application/json;charset=utf-8' })), link = document.createElement('a');
          link.href = url; link.download = file.filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
        };
        function PlanAuthorization({ value, config }) {
          const auth = value.authorization, timeZone = value.timeZone || value.configuration?.timeZone;
          return h('div', { className: 'pa24-note' },
            value.message && h('p', null, value.message), (value.notices || []).map((note, i) => h('p', { key: i }, note)),
            auth && h('div', null, h('p', null, L('Skill：', 'Skill: ') + auth.skill.name + ' · ' + auth.skill.versionId),
              h('p', null, L('工具：', 'Tools: ') + (auth.skill.tools.join('、') || L('无', 'None'))),
              h('p', null, L('包内资源：', 'Package resources: ') + (auth.skill.resources.join('、') || L('无', 'None'))),
              auth.targets.map(({ target, capability }) => h('p', { key: target.sourceId + capability },
                ((config?.sources?.entries || []).find(source => source.id === target.sourceId)?.name || target.sourceId) + ' · ' + target.platform + ' · ' + capability + ' · ' + target.resource.id)),
              h('p', null, auth.delivery ? L('固定投递给主人：', 'Fixed owner delivery: ') + auth.delivery.channel + ' · ' + auth.delivery.target : L('结果仅保存', 'Save results only'))),
            value.nextTimes?.length > 0 && h('div', null, h('strong', null, L('未来触发时间', 'Upcoming occurrences') + (timeZone ? ' · ' + timeZone : '')), value.nextTimes.map(at => h('p', { key: at, className: 'pa24-meta' }, date(at, timeZone || 'UTC')))));
        }
        function TaskPlanForm({ form, setForm, catalog, binding, config, busy, onPreview, onSave, draft, refreshTick }) {
          const [skill, setSkill] = React.useState(null), [error, setError] = React.useState('');
          React.useEffect(() => {
            const abort = new AbortController(); setSkill(null); setError('');
            if (form.skillId) rpc('skills.inspect', { id: form.skillId, workspaceBinding: binding }, abort.signal).then(value => { if (!abort.signal.aborted && value.workspaceBinding === binding) setSkill(value); }).catch(error => { if (!abort.signal.aborted) setError(error.message); });
            return () => abort.abort();
          }, [form.skillId, binding, refreshTick]);
          const field = (label, node) => h('label', { key: label, className: 'pa24-field' }, label, node);
          const set = (key, value) => setForm({ ...form, [key]: value });
          const timing = (key, value) => set('timing', { ...form.timing, [key]: value });
          const delivery = (key, value) => set('delivery', { ...form.delivery, [key]: value, ...(key === 'channel' && value !== 'feishu' ? { voice: false } : {}) });
          const text = (value, onChange, props = {}) => h('input', { value: value ?? '', onChange: event => onChange(event.target.value), ...props });
          const options = (value, onChange, entries) => h('select', { value, onChange: event => onChange(event.target.value) }, entries.map(([key, label]) => h('option', { key, value: key }, label)));
          let parameters = null;
          try { const parsed = JSON.parse(form.parametersText); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parameters = parsed; } catch {}
          const parameterFields = skill?.metadata?.pa24?.parameters || (skill?.type === 'template' ? { title: { type: 'string', description: L('结果标题', 'Result title') } } : {});
          return h('fieldset', { className: 'pa24-card', disabled: busy }, h('legend', null, form.id ? L('编辑暂停的计划', 'Edit paused plan') : L('新建定时任务', 'New scheduled task')),
            field(L('名称', 'Name'), text(form.title, value => set('title', value), { maxLength: 120 })),
            field('Skill', options(form.skillId, value => setForm({ ...form, skillId: value, parametersText: '{}' }), [['', L('选择任务或模板', 'Choose a task or template')], ...(catalog?.entries || []).filter(entry => ['task', 'template'].includes(entry.type)).map(entry => [entry.id, entry.name + ' · ' + (entry.source === 'builtin' ? L('内置原件', 'Built-in') : entry.source === 'managed' ? L('受管', 'Managed') : L('工作区', 'Workspace'))])])),
            error && h('p', { role: 'alert', className: 'pa24-error' }, error),
            Object.entries(parameterFields).map(([name, definition]) => field(name + (definition.required ? ' *' : '') + (definition.description ? ' · ' + definition.description : ''),
              h('input', { type: definition.type === 'boolean' ? 'checkbox' : ['integer', 'number'].includes(definition.type) ? 'number' : 'text',
                ...(definition.type === 'boolean' ? { checked: parameters?.[name] ?? definition.default ?? false } : { value: parameters?.[name] ?? definition.default ?? '', step: definition.type === 'integer' ? 1 : 'any' }),
                disabled: !parameters, onChange: event => { const value = definition.type === 'boolean' ? event.target.checked : ['integer', 'number'].includes(definition.type) ? Number(event.target.value) : event.target.value;
                  set('parametersText', JSON.stringify({ ...parameters, [name]: value }, null, 2)); } }))),
            !parameters && h('p', { role: 'alert' }, L('参数 JSON 必须是有效对象；修正后可继续编辑参数字段。', 'Parameters must be a valid JSON object before editing fields.')),
            h('details', null, h('summary', null, L('全部参数 JSON', 'All parameters as JSON')), field(L('参数对象', 'Parameter object'), h('textarea', { rows: 4, value: form.parametersText, onChange: event => set('parametersText', event.target.value) }))),
            field(L('时间规则', 'Timing rule'), options(form.timing.type, value => timing('type', value), [['once', L('一次性', 'Once')], ['daily', L('每天', 'Daily')], ['weekdays', L('周一至周五', 'Monday–Friday')], ['weekly', L('每周', 'Weekly')], ['monthly', L('每月', 'Monthly')], ['interval', L('间隔', 'Interval')], ['advanced', L('高级规则', 'Advanced')]])),
            field(L('时区', 'Time zone'), text(form.timeZone, value => set('timeZone', value))),
            form.timing.type === 'once' && field(L('日期时间（按上方时区，可输入 ISO 偏移）', 'Date and time (zone above, or ISO offset)'), text(form.timing.at, value => timing('at', value), { placeholder: '2026-11-01T09:00:00' })),
            ['daily', 'weekdays', 'weekly', 'monthly'].includes(form.timing.type) && field(L('时刻', 'Time'), text(form.timing.time || '09:00:00', value => timing('time', value.length === 5 ? value + ':00' : value), { type: 'time', step: 60 })),
            form.timing.type === 'weekly' && h('fieldset', { className: 'pa24-note' }, h('legend', null, L('每周哪些天', 'Weekdays')), [1, 2, 3, 4, 5, 6, 7].map(day => field(L('星期' + '一二三四五六日'[day - 1], ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1]), h('input', { type: 'checkbox', checked: (form.timing.weekdays || []).includes(day), onChange: event => timing('weekdays', event.target.checked ? [...(form.timing.weekdays || []), day].sort() : form.timing.weekdays.filter(value => value !== day)) })))),
            form.timing.type === 'monthly' && field(L('每月几日（无该日则跳过）', 'Day of month (skip missing dates)'), text(form.timing.day || 1, value => timing('day', Number(value)), { type: 'number', min: 1, max: 31 })),
            form.timing.type === 'interval' && field(L('间隔秒数（至少 60 秒）', 'Interval seconds (minimum 60)'), text(form.timing.seconds || 3600, value => timing('seconds', Number(value)), { type: 'number', min: 60 })),
            form.timing.type === 'advanced' && field(L('Cron 表达式', 'Cron expression'), text(form.timing.expression, value => timing('expression', value), { placeholder: '0 9 * * 1-5' })),
            field(L('累计执行时限（分钟，等待不计入）', 'Execution limit (minutes, waits excluded)'), text(form.executionLimitMs / 60000, value => set('executionLimitMs', Number(value) * 60000), { type: 'number', min: 1 / 60, max: 1440, step: 'any' })),
            field(L('结果投递', 'Delivery'), options(form.delivery.channel, value => delivery('channel', value), [['none', L('仅保存', 'Save only')], ['feishu', L('飞书主人', 'Feishu owner')], ['wecom', L('企微主人', 'WeCom owner')]])),
            field(L('通知条件', 'Notify when'), options(form.delivery.mode, value => delivery('mode', value), [['always', L('每次完成', 'Every completion')], ['changed', L('结果正文变化', 'Result text changes')], ['errors', L('仅异常或需处理', 'Errors or attention only')]])),
            form.delivery.channel === 'feishu' && field(L('语音并附完整文本', 'Voice plus full text'), h('input', { type: 'checkbox', checked: form.delivery.voice, onChange: event => delivery('voice', event.target.checked) })),
            field(L('我明确预约此时投递，可覆盖免打扰', 'Deliver at my reserved time, overriding quiet hours'), h('input', { type: 'checkbox', checked: form.delivery.overrideQuiet, onChange: event => delivery('overrideQuiet', event.target.checked) })),
            h('details', null, h('summary', null, L('业务写入目标', 'Business write targets')), h('p', { className: 'pa24-meta' }, L('不填时在启用核验时使用默认选择；确认后固定资源。', 'Blank uses the default during verification; confirmation pins the resource.')),
              ['calendar', 'todo'].map(domain => {
                const label = domain === 'calendar' ? L('日历', 'Calendar') : L('待办', 'Task');
                const selection = (key, value) => { const selectors = { ...form.selectors }, current = { ...selectors[domain] }; if (value.trim()) current[key] = value; else delete current[key];
                  if (Object.keys(current).length) selectors[domain] = current; else delete selectors[domain]; set('selectors', selectors); };
                return h('fieldset', { key: domain }, h('legend', null, label),
                  field(label + L('来源', ' source'), options(form.selectors?.[domain]?.sourceId || '', value => selection('sourceId', value), [['', L('按公司／项目或默认来源', 'Use company/project or default')], ...(config?.sources?.entries || []).filter(entry => entry.domain === domain).map(entry => [entry.id, entry.name])])),
                  field(label + L('公司', ' company'), text(form.selectors?.[domain]?.company, value => selection('company', value))),
                  field(label + L('项目', ' project'), text(form.selectors?.[domain]?.project, value => selection('project', value))));
              })),
            draft && h(PlanAuthorization, { value: draft, config }),
            h('div', { className: 'pa24-row' }, h('button', { type: 'button', onClick: onPreview }, L('校验并预览时间', 'Validate and preview')), h('button', { type: 'button', disabled: !draft, onClick: onSave }, L('保存为暂停', 'Save paused'))));
        }
        function TaskPlansDetail(helpers) {
          const { state, config, tz, planStates, openCard, refresh } = helpers, binding = state.workspaceBinding;
          const model = planRowState(planStates, 'task-manager:' + binding, {}), view = React.useSyncExternalStore(model.subscribe, model.getSnapshot);
          const [catalog, setCatalog] = React.useState(null), [catalogError, setCatalogError] = React.useState(''), [list, setList] = React.useState({ loading: true }), [detail, setDetail] = React.useState(null);
          const query = view.query || '', filter = view.filter || '', skillFilter = view.skillFilter || '', offset = view.offset || 0;
          React.useEffect(() => {
            const abort = new AbortController(); setCatalogError(''); setCatalog(previous => previous?.workspaceBinding === binding ? previous : null);
            rpc('skills.catalog', { workspaceBinding: binding }, abort.signal).then(value => { if (!abort.signal.aborted && value.workspaceBinding === binding) setCatalog(value); }).catch(error => { if (!abort.signal.aborted) setCatalogError(error.message); });
            return () => abort.abort();
          }, [binding, view.tick]);
          React.useEffect(() => {
            const abort = new AbortController(), key = JSON.stringify([binding, query, filter, skillFilter, offset]); let pending = false;
            setList(previous => previous.key === key ? { ...previous, loading: true, error: null } : { key, loading: true });
            const load = async () => { if (pending) return; pending = true; try {
              const result = await rpc('plans', { workspaceBinding: binding, query, state: filter, skillId: skillFilter, offset }, abort.signal);
              if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.total)) throw new Error(L('计划列表响应不完整，请刷新重试。', 'Incomplete plan list; refresh to retry.'));
              if (!abort.signal.aborted && result.workspaceBinding === binding) setList({ key, data: result });
              if (view.selected) { const result = await rpc('plans.inspect', { workspaceBinding: binding, id: view.selected }, abort.signal); if (!abort.signal.aborted && result.workspaceBinding === binding) setDetail(result); }
            } catch (error) { if (!abort.signal.aborted) setList(previous => ({ ...previous, loading: false, error: error.message })); } finally { pending = false; } };
            setDetail(previous => previous?.workspaceBinding === binding && previous?.plan.id === view.selected ? previous : null); void load(); const timer = setInterval(load, 5000); return () => { abort.abort(); clearInterval(timer); };
          }, [binding, query, filter, skillFilter, offset, view.tick, view.selected]);
          const update = patch => model.update({ ...patch, error: '', preview: null, approved: false });
          const change = async payload => {
            if (model.getSnapshot().busy) return;
            const selection = model.getSnapshot();
            const body = { type: 'plan.change', workspaceBinding: binding, ...payload }, key = JSON.stringify(body), prior = model.getSnapshot().request;
            const request = prior?.key === key ? prior : { key, id: crypto.randomUUID() }; model.update({ request, busy: true, error: '', note: '' });
            try {
              const result = await rpc('action', { ...body, requestId: request.id });
              const current = model.getSnapshot(), sameSelection = current.selected === selection.selected && current.form === selection.form;
              model.update({ ...(sameSelection ? { selected: result.plan?.id || selection.selected, form: null, preview: null, approved: false } : {}), request: null, tick: (model.getSnapshot().tick || 0) + 1,
                note: result.trigger ? (result.trigger.reason || L('已接纳本次触发；执行状态见运行记录。', 'Trigger accepted; see run history for execution.')) : L('操作已保存，原历史保留。', 'Saved; original history retained.') });
              await refresh().catch(() => {});
            } catch (error) { model.update({ error: error.message }); }
            finally { model.update({ busy: false }); }
          };
          const preview = async (endpoint, op, extra = {}) => {
            if (!detail || view.busy) return; model.update({ busy: true, error: '', preview: null, approved: false });
            try { const result = await rpc(endpoint, { id: detail.plan.id, workspaceBinding: binding, ...extra }); if (result.workspaceBinding === binding && model.getSnapshot().selected === detail.plan.id) model.update({ preview: { ...result, op, extra } }); }
            catch (error) { model.update({ error: error.message }); } finally { model.update({ busy: false }); }
          };
          const edit = form => update({ selected: form.id || null, form: { ...form, parameters: form.parameters || {}, parametersText: JSON.stringify(form.parameters || {}, null, 2) }, draft: null });
          const fresh = preset => edit({ title: preset ? ({ morning: '晨报', evening: '晚间复盘', weekly: '周回顾' })[preset] : '', skillId: preset ? 'builtin:digest-' + preset : '',
            timing: { type: preset === 'weekly' ? 'weekly' : 'daily', time: preset === 'evening' ? '21:00:00' : '09:00:00', weekdays: [5] }, timeZone: config?.timeZone || 'Asia/Shanghai',
            executionLimitMs: 900000, parameters: {}, selectors: {}, delivery: { channel: config?.ownerOpenId ? config.notifyChannel : config?.notifyChannel === 'wecom' ? 'wecom' : 'none', mode: 'always', voice: false, overrideQuiet: false } });
          const formPayload = () => { const { parametersText, ...form } = view.form; return { ...form, parameters: JSON.parse(parametersText) }; };
          const saveDraft = async save => { try {
            const form = formPayload(); if (save) await change({ ...form, op: 'save' }); else { model.update({ busy: true, error: '' }); const draft = await rpc('plans.draft', { ...form, workspaceBinding: binding }); if (draft.workspaceBinding === binding && model.getSnapshot().form === view.form) model.update({ draft }); }
          } catch (error) { model.update({ error: error.message }); } finally { if (!save) model.update({ busy: false }); } };
          const p = detail?.plan, selectedRow = list.data?.rows.find(row => row.id === p?.id), disabled = view.busy;
          const button = (label, fn, extra = {}) => h('button', { key: label, type: 'button', disabled, onClick: () => void fn(), ...extra }, label);
          return h('section', { className: 'pa24-manager' },
            sectionHead('pulse', L('定时任务', 'Scheduled tasks'), L('时间 + Skill。保存、启用、单次执行和投递分别留档。', 'Time + skill. Configuration, activation, execution and delivery have separate records.'), button(L('新建计划', 'New plan'), () => fresh(null)), 'green'),
            h('div', { className: 'pa24-row' }, ['morning', 'evening', 'weekly'].map(preset => button(({ morning: L('晨报预设', 'Morning preset'), evening: L('复盘预设', 'Evening preset'), weekly: L('周回顾预设', 'Weekly preset') })[preset], () => fresh(preset))), button(L('刷新', 'Refresh'), async () => { model.update({ tick: (view.tick || 0) + 1 }); await refresh().catch(() => {}); })),
            catalogError && h('p', { role: 'alert', className: 'pa24-error' }, catalogError),
            catalog && catalog.discovery !== 'complete' && h('p', { role: 'alert' }, catalog.discoveryError || L('Skill 目录读取不完整，请核验接入后刷新。', 'Skill discovery is incomplete; check access and refresh.')),
            view.error && h('p', { role: 'alert', className: 'pa24-error' }, view.error), view.note && h('p', { role: 'status' }, view.note),
            view.form && h(TaskPlanForm, { form: view.form, setForm: form => update({ form, draft: null }), catalog: catalog?.workspaceBinding === binding ? catalog : null, binding, config, refreshTick: view.tick, busy: disabled, onPreview: () => saveDraft(false), onSave: () => saveDraft(true), draft: view.draft }),
            view.form && button(L('放弃草稿并关闭编辑', 'Discard draft and close'), () => update({ form: null, draft: null })),
            h('div', { className: 'pa24-row' }, h('label', { className: 'pa24-field' }, L('搜索计划', 'Search plans'), h('input', { value: query, onChange: event => update({ query: event.target.value, offset: 0 }) })),
              h('label', { className: 'pa24-field' }, L('计划状态', 'Plan status'), h('select', { value: filter, onChange: event => update({ filter: event.target.value, offset: 0 }) }, [['', L('全部未回收', 'All unrecycled')], ['enabled', L('启用', 'Enabled')], ['paused', L('暂停', 'Paused')], ['blocked', L('需处理', 'Needs attention')], ['recycled', L('回收站', 'Recycle bin')]].map(([value, label]) => h('option', { key: value, value }, label)))),
              h('label', { className: 'pa24-field' }, L('按 Skill 筛选', 'Filter by skill'), h('select', { value: skillFilter, onChange: event => update({ skillFilter: event.target.value, offset: 0 }) }, h('option', { value: '' }, L('全部 Skill', 'All skills')), (catalog?.entries || []).map(entry => h('option', { key: entry.id, value: entry.id }, entry.name + ' · ' + entry.source))))),
            list.error && h('p', { role: 'alert', className: 'pa24-error' }, L('读取失败；保留上次读取结果：', 'Read failed; last results retained: ') + list.error),
            list.loading && h('p', { role: 'status' }, L('正在读取计划…', 'Reading plans…')),
            list.data && h('div', { className: 'pa24-card' }, h('p', { className: 'pa24-meta' }, L('匹配计划 ', 'Matching plans: ') + list.data.total),
              !list.data.rows.length && h('p', null, query || filter || skillFilter ? L('没有匹配的计划', 'No matching plans') : L('尚无计划，可新建或选择预设。', 'No plans. Create one or choose a preset.')),
              list.data.rows.map(row => h('article', { key: row.id, className: 'pa24-job' }, button(row.title, () => update({ selected: row.id, form: null, draft: null }), { 'aria-pressed': row.id === view.selected }),
                h('p', null, planStateLabel(row) + ' · ' + row.skill), h('p', null, planTimingLabel(row)), h('p', { className: 'pa24-meta' }, L('下次：', 'Next: ') + (row.nextTimes?.[0] ? date(row.nextTimes[0], row.task_config?.timeZone || tz) : L('暂无已核验触发时间', 'No verified occurrence'))),
                row.timingError && h('p', { role: 'alert', className: 'pa24-error' }, row.timingError),
                row.recentRun && h('p', { className: 'pa24-meta' }, L('最近执行：', 'Last execution: ') + runStatusLabel(row.recentRun.status) + ' · ' + deliveryLabel(row.recentRun.delivery_status)),
                !row.task_config && h('p', { className: 'pa24-meta' }, L('旧计划：核验后沿原关联升级', 'Legacy plan: verify before adoption')))),
              h('div', { className: 'pa24-row' }, button(L('上一页', 'Previous'), () => update({ offset: Math.max(0, offset - 20) }), { disabled: disabled || !offset }), button(L('下一页', 'Next'), () => update({ offset: offset + 20 }), { disabled: disabled || offset + 20 >= list.data.total }))),
            view.selected && !detail && h('p', { role: 'status' }, L('正在读取所选计划…', 'Reading selected plan…')),
            p && h('section', { className: 'pa24-card' }, h('h3', null, p.title), h('p', null, planStateLabel({ ...p, blocks: detail.blocks, skillBlock: selectedRow?.skillBlock })),
              h('p', { className: 'pa24-meta' }, L('主人选择：', 'Owner choice: ') + ((!p.task_config ? p.status === 'active' : p.owner_enabled) ? L('启用', 'Enabled') : L('暂停', 'Paused'))),
              p.task_config && h('p', null, L('固定时区：', 'Pinned time zone: ') + p.task_config.timeZone + ' · ' + L('累计时限 ', 'Execution limit ') + p.task_config.executionLimitMs / 60000 + L(' 分钟', ' min')),
              (detail.blocks || []).map(block => h('div', { key: block.key, className: 'pa24-note' }, h('p', null, block.reason), button(L('核验并解除此阻断', 'Verify and clear this blocker'), () => preview('plans.preview', 'repair', { key: block.key })))),
              selectedRow?.skillBlock && h('p', { role: 'alert' }, selectedRow.skillBlock.reason),
              p.lifecycle?.error && h('p', { role: 'alert' }, p.lifecycle.error),
              h('div', { className: 'pa24-row' },
                p.task_config && !p.recycled_at && !p.delete_when_idle && button(L('暂停未来运行', 'Pause future runs'), () => change({ op: 'pause', id: p.id, expectedRevision: p.revision })),
                p.task_config && !p.recycled_at && !p.delete_when_idle && button(L('核验并启用', 'Verify and enable'), () => preview('plans.preview', 'enable')),
                p.task_config && !p.recycled_at && !p.delete_when_idle && button(L('立即运行 · 先预览', 'Run now · preview'), () => preview('plans.run-preview', 'run')),
                p.task_config && !p.recycled_at && button(L('编辑配置', 'Edit configuration'), () => edit({ ...detail.form, id: p.id, expectedRevision: p.revision }), { disabled: disabled || p.status === 'active' || !!p.schedule_id || !!p.lifecycle }),
                p.task_config && button(L('复制为新计划', 'Copy plan'), () => edit({ ...detail.form, title: p.title + L(' 副本', ' copy') })),
                p.recycled_at && button(L('还原为暂停', 'Restore paused'), () => change({ op: 'restore', id: p.id, expectedRevision: p.revision })),
                button(L('查看全部运行', 'View all runs'), () => helpers.openRuns({ planId: p.id, range: 'all' }))),
              p.status === 'active' && p.task_config && h('p', { className: 'pa24-meta' }, L('修改配置前先暂停；当前运行继续使用原快照。', 'Pause before editing; in-flight runs keep their snapshot.')),
              !p.task_config && h('div', { className: 'pa24-note' }, h('p', null, L('保留原计划时间、状态和历史；核验当前身份与投递后升级。', 'Retain timing, state and history; verify current identity and delivery before adoption.')),
                h('label', { className: 'pa24-field' }, L('原 Skill 来源', 'Original skill source'), h('select', { value: view.migrationSkill || '', onChange: event => update({ migrationSkill: event.target.value }) }, h('option', { value: '' }, L('请选择原来源', 'Select original source')), (catalog?.entries || []).filter(entry => (entry.internalName || entry.name) === p.skill).map(entry => h('option', { key: entry.id, value: entry.id }, entry.name + ' · ' + entry.source)))),
                button(L('预览旧计划迁移', 'Preview legacy migration'), () => preview('plans.migration-preview', 'migrate', { skillId: view.migrationSkill || undefined }))),
              p.task_config && !p.recycled_at && h('details', null, h('summary', null, L('重配目标与删除', 'Rebind or delete')),
                button(L('重新绑定目标 · 先预览', 'Rebind targets · preview'), () => preview('plans.preview', 'rebind', { rebind: true })),
                h('p', null, L('删除保留历史。若有当前运行，可等待结束或请求停止后回收。', 'Deletion keeps history. Wait for active runs or request their stop.')),
                button(L('等待当前运行结束后删除', 'Delete after current runs end'), () => change({ op: 'delete', id: p.id, expectedRevision: p.revision, running: 'wait' })),
                button(L('停止当前运行并删除', 'Stop current runs and delete'), () => change({ op: 'delete', id: p.id, expectedRevision: p.revision, running: 'stop' }))),
              h('details', null, h('summary', null, L('配置、原关联与迁移凭据', 'Configuration and migration evidence')), h('pre', { className: 'pa24-json' }, JSON.stringify({ schedule: p.schedule_spec, configuration: p.task_config, authorization: p.task_authorization, migration: detail.migration }, null, 2))),
              view.preview?.planId === p.id && h('section', { className: 'pa24-note' }, h(PlanAuthorization, { value: view.preview, config }),
                h('label', { className: 'pa24-field' }, h('input', { type: 'checkbox', checked: !!view.approved, onChange: event => model.update({ approved: event.target.checked }) }), L('确认本计划的工具、资源、目标和此项操作', 'Confirm tools, resources, targets and this action')),
                button(L('确认执行此操作', 'Confirm action'), () => change({ op: view.preview.op, id: p.id, expectedRevision: view.preview.revision, fingerprint: view.preview.fingerprint, confirm: true, ...view.preview.extra }), { disabled: disabled || !view.approved }))),
            h('details', null, h('summary', null, L('旧简报入口与语音引擎', 'Legacy digest controls and voice engine')), h(DigestDetail, helpers)));
        }

        function PlanDeliveryControls({ detail, binding, onChanged }) {
          const [selected, setSelected] = React.useState(null), [outcome, setOutcome] = React.useState('not_sent'), [evidence, setEvidence] = React.useState(''), [messageId, setMessageId] = React.useState('');
          const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [note, setNote] = React.useState('');
          const request = React.useRef(null), alive = React.useRef(true);
          React.useEffect(() => () => { alive.current = false; }, []);
          const mutate = async (delivery, op) => {
            if (busy) return;
            const payload = { type: 'plan.delivery', workspaceBinding: binding, runId: detail.run.id, outboxId: Number(delivery.outbox_id), fingerprint: delivery.fingerprint, op, confirm: true,
              ...(op === 'review' ? { outcome, evidence, ...(outcome === 'sent' ? { messageId } : {}) } : {}) };
            const key = JSON.stringify(payload); if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
            setBusy(true); setError(''); setNote('');
            try { await rpc('action', { ...payload, requestId: request.current.id }); if (alive.current) { setSelected(null); setNote(op === 'retry' ? L('已接纳原投递的补投请求；业务不会重跑。', 'Original delivery retry accepted; business execution is not rerun.') : L('核对已保存；未送达的结果须另行明确补投。', 'Verification saved; confirmed unsent results need a separate retry.')); request.current = null; onChanged(); } }
            catch (failure) { if (alive.current) setError(failure.message); } finally { if (alive.current) setBusy(false); }
          };
          return h('section', { className: 'pa24-note' }, h('h4', null, L('结果投递与补投', 'Delivery and retry')), error && h('p', { role: 'alert', className: 'pa24-error' }, error), note && h('p', { role: 'status' }, note),
            detail.deliveries.map(notice => h('article', { key: notice.id, className: 'pa24-job' }, h('p', null, deliveryLabel(notice.deliveryStatus)), notice.reason && h('p', null, notice.reason),
              notice.deliveries.map(delivery => h('div', { key: delivery.outbox_id, className: 'pa24-note' },
                h('p', null, (delivery.component === 'audio' ? L('语音', 'Audio') : L('完整文本', 'Full text')) + ' · ' + deliveryLabel(delivery.outbox.status, delivery.outbox.channel)),
                h('p', { className: 'pa24-meta' }, delivery.outbox.channel + ' · ' + L('固定接收者 ', 'Pinned recipient ') + delivery.outbox.target),
                delivery.outbox.last_error && h('p', { role: 'alert' }, delivery.outbox.last_error),
                delivery.expires_at && h('p', { className: 'pa24-meta' }, L('投递有效至：', 'Delivery expires: ') + new Date(delivery.expires_at).toLocaleString()),
                delivery.outbox.message_id && h('p', { className: 'pa24-meta' }, (delivery.outbox.channel === 'local' ? L('本地投递标识：', 'Local delivery ID: ') : L('原平台回执：', 'Platform receipt: ')) + delivery.outbox.message_id),
                delivery.outbox.status === 'failed' && !delivery.outbox.message_id && h('button', { type: 'button', disabled: busy, onClick: () => mutate(delivery, 'retry') }, L('明确补投此结果', 'Retry this delivery')),
                delivery.outbox.status === 'unknown' && !delivery.outbox.message_id && h('button', { type: 'button', disabled: busy, onClick: () => { setSelected(delivery.outbox_id); setEvidence(''); setMessageId(''); setOutcome('not_sent'); } }, L('核对原平台是否收到', 'Verify platform receipt')),
                selected === delivery.outbox_id && h('fieldset', { disabled: busy }, h('legend', null, L('原投递核对', 'Verify original delivery')),
                  h('label', { className: 'pa24-field' }, L('核对结果', 'Verified outcome'), h('select', { value: outcome, onChange: event => setOutcome(event.target.value) }, h('option', { value: 'not_sent' }, L('确认未收到', 'Confirmed unsent')), h('option', { value: 'sent' }, L('确认已收到', 'Confirmed received')))),
                  h('label', { className: 'pa24-field' }, L('核对依据', 'Evidence'), h('textarea', { value: evidence, rows: 3, maxLength: 4000, onChange: event => setEvidence(event.target.value) })),
                  outcome === 'sent' && h('label', { className: 'pa24-field' }, L('原平台消息标识', 'Original message ID'), h('input', { value: messageId, maxLength: 500, onChange: event => setMessageId(event.target.value) })),
                  h('button', { type: 'button', disabled: !evidence.trim() || (outcome === 'sent' && !messageId.trim()), onClick: () => mutate(delivery, 'review') }, L('确认并保存投递核对', 'Save delivery verification'))))))));
        }
        function WorkControls({ work, changes, binding, changed }) {
          const [op, setOp] = React.useState('supplement'), [instruction, setInstruction] = React.useState(''), [title, setTitle] = React.useState('');
          const [approved, setApproved] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [note, setNote] = React.useState('');
          const request = React.useRef(null), alive = React.useRef(true);
          React.useEffect(() => () => { alive.current = false; }, []);
          React.useEffect(() => { setApproved(false); }, [work.revision]);
          const submit = async () => {
            if (busy) return; setBusy(true); setError(''); setNote('');
            const body = { type: 'work.change', workspaceBinding: binding, workId: work.id, expectedRevision: work.revision, op, instruction, title, confirm: approved };
            const key = JSON.stringify(body); if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
            try {
              const result = await rpc('action', { ...body, requestId: request.current.id });
              if (!alive.current || result.workspaceBinding !== binding) return;
              request.current = null; setApproved(false); setInstruction('');
              setNote(result.workId ? L('新目标已建立：', 'New goal created: ') + result.workId : L('操作已保存。补充是否采用及停止实际结果请查看关联运行。', 'Saved. Check the linked run for input adoption and actual stop confirmation.'));
              changed();
            } catch (error) { if (alive.current) setError(error.message); } finally { if (alive.current) setBusy(false); }
          };
          const active = ['running', 'waiting_input'].includes(work.status), ended = ['completed', 'failed', 'stopped'].includes(work.status);
          const choices = [...(work.execution_mode !== 'skill' ? [...(active ? [['supplement', L('补充原交办', 'Supplement original work')]] : []), ...(ended || work.status === 'waiting_input' ? [['continue', L('明确接续', 'Explicit continuation')]] : []), ...(!ended ? [['stop', L('停止当前交办', 'Stop current work')]] : [])] : []),
            ...(work.acceptance_required && work.status === 'completed' && ['pending','returned'].includes(work.acceptance_status) ? [['accept', L('接受交付物', 'Accept deliverable')], ['return', L('退回并说明未完成项', 'Return with remaining work')]] : []), ['new-goal', L('建立关联新目标', 'Create a linked new goal')]];
          React.useEffect(() => { if (!choices.some(([value]) => value === op)) { setOp(choices[0][0]); setApproved(false); } }, [work.status, work.acceptance_status, op]);
          return h('div', { className: 'pa24-note' },
            work.completion_criteria && h('p', null, L('完成标准：', 'Completion criteria: ') + work.completion_criteria),
            work.acceptance_required && h('p', null, L('主人验收：', 'Owner acceptance: ') + ({ none: L('尚未交付', 'Not delivered'), pending: L('等待验收', 'Awaiting acceptance'), accepted: L('已接受', 'Accepted'), returned: L('已退回', 'Returned') }[work.acceptance_status] || work.acceptance_status)),
            work.parent_work_item_id && h('p', { className: 'pa24-meta' }, L('关联原交办：', 'Related work: ') + work.parent_work_item_id),
            h('label', { className: 'pa24-field' }, L('交办操作', 'Work action'), h('select', { value: op, disabled: busy, onChange: event => { setOp(event.target.value); setApproved(false); } }, choices.map(([value, label]) => h('option', { key: value, value }, label)))),
            op === 'new-goal' && h('label', { className: 'pa24-field' }, L('新目标名称', 'New goal title'), h('input', { value: title, onChange: event => { setTitle(event.target.value); setApproved(false); } })),
            op !== 'stop' && h('label', { className: 'pa24-field' }, op === 'new-goal' ? L('新目标及你选定的上下文', 'New goal and selected context') : L('补充、剩余工作或验收依据', 'Supplement, remaining work or acceptance evidence'), h('textarea', { rows: 4, value: instruction, onChange: event => { setInstruction(event.target.value); setApproved(false); } })),
            h('p', { className: 'pa24-meta' }, op === 'stop' ? L('停止不会撤销已完成动作或关联待办；实际停止结果单独留档。', 'Stopping keeps completed actions and linked tasks. Actual stop confirmation is recorded separately.')
              : op === 'new-goal' ? L('仅携带你在上方填写的上下文，原交办保持原样。', 'Only the context entered above is included; the original work is preserved.')
              : op === 'continue' ? L('未结束运行沿原记录恢复；已结束则新建运行。请明确未完成部分，已成功步骤不重做。', 'Resume unfinished runs; finished runs get a new execution. Specify remaining work; completed steps are retained.')
              : L('收到补充与执行采用分别记录；接受或退回只记录验收，不自动执行新的工作。', 'Receipt and adoption are recorded separately. Acceptance and return do not start new work.')),
            h('label', { className: 'pa24-field' }, h('input', { type: 'checkbox', checked: approved, onChange: event => setApproved(event.target.checked) }), L('确认针对这项交办执行所选操作', 'Confirm this action on the selected work')),
            h('button', { type: 'button', disabled: busy || !approved || (op !== 'stop' && !instruction.trim()) || (op === 'new-goal' && !title.trim()), onClick: submit }, L('提交交办操作', 'Submit work action')),
            error && h('p', { role: 'alert', className: 'pa24-error' }, error), note && h('p', { role: 'status' }, note),
            h('details', null, h('summary', null, L('操作与验收历史', 'Control and acceptance history')), (changes || []).map(row => h('div', { key: row.request_id }, h('p', null, date(row.created_at) + ' · ' + row.record.op + ' · ' + row.record.phase), h('p', null, row.record.input?.instruction || row.record.error || '')))));
        }
        function WorkerRunReview({ detail, binding, changed }) {
          const [summary, setSummary] = React.useState(''), [completed, setCompleted] = React.useState(''), [remaining, setRemaining] = React.useState('');
          const [calls, setCalls] = React.useState({}), [confirmed, setConfirmed] = React.useState(false), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
          const request = React.useRef(null), alive = React.useRef(true);
          React.useEffect(() => () => { alive.current = false; }, []);
          React.useEffect(() => { setConfirmed(false); }, [detail.fingerprint, detail.work.revision]);
          const unknown = detail.calls.filter(row => ['running','unknown'].includes(row.status));
          const unresolved = detail.operations.filter(row => ['running','unknown'].includes(row.status));
          const save = async () => {
            const input = { type: 'work.change', op: 'review', workId: detail.run.work_item_id, expectedRevision: detail.work.revision, runId: detail.run.id,
              fingerprint: detail.fingerprint, summary, completed, remaining, calls: unknown.map(row => ({ id: row.id, outcome: calls[row.id]?.outcome || 'partial', evidence: calls[row.id]?.evidence || '' })), confirm: confirmed, workspaceBinding: binding };
            const key = JSON.stringify(input); if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
            setBusy(true); setError('');
            try { const result = await rpc('action', { ...input, requestId: request.current.id }); if (alive.current && result.workspaceBinding === binding) { setConfirmed(false); changed(); } }
            catch (error) { if (alive.current) setError(error.message); } finally { if (alive.current) setBusy(false); }
          };
          return h('section', { className: 'pa24-note' }, h('h4', null, L('原运行核对', 'Review original run')),
            h('p', null, L('先核对原对象或文件。核对依据单独留档，原未知回执保留；接续须另行明确确认。', 'Check the original objects or files. Findings are stored separately from uncertain receipts; continuation needs a separate explicit action.')),
            !!unresolved.length && h('p', { role: 'alert' }, L('关联平台操作仍待核对：', 'Platform operations still need verification: ') + unresolved.map(row => row.id).join('、')),
            [['核对摘要', summary, setSummary], ['已完成步骤', completed, setCompleted], ['剩余步骤', remaining, setRemaining]].map(([label, value, set]) => h('label', { key: label, className: 'pa24-field' }, L(label, { 核对摘要: 'Review summary', 已完成步骤: 'Completed steps', 剩余步骤: 'Remaining steps' }[label]), h('textarea', { value, rows: 2, maxLength: 4000, onChange: event => { set(event.target.value); setConfirmed(false); } }))),
            unknown.map(row => h('fieldset', { key: row.id }, h('legend', null, row.tool + ' · ' + row.id),
              h('select', { 'aria-label': L('动作核对结果', 'Verified action outcome'), value: calls[row.id]?.outcome || 'partial', onChange: event => { setCalls({ ...calls, [row.id]: { ...calls[row.id], outcome: event.target.value } }); setConfirmed(false); } },
                h('option', { value: 'partial' }, L('部分完成', 'Partially completed')), h('option', { value: 'completed' }, L('已完成', 'Completed')), h('option', { value: 'not_performed' }, L('明确未执行', 'Confirmed not performed'))),
              h('textarea', { 'aria-label': L('动作核对依据', 'Action verification evidence'), rows: 2, maxLength: 4000, value: calls[row.id]?.evidence || '', onChange: event => { setCalls({ ...calls, [row.id]: { ...calls[row.id], evidence: event.target.value } }); setConfirmed(false); } }))),
            h('label', { className: 'pa24-field' }, h('input', { type: 'checkbox', checked: confirmed, onChange: event => setConfirmed(event.target.checked) }), L('已核对实际效果及剩余步骤', 'I verified actual effects and remaining steps')),
            h('button', { type: 'button', disabled: busy || !confirmed || !!unresolved.length || !summary.trim() || !completed.trim() || !remaining.trim() || unknown.some(row => !calls[row.id]?.evidence?.trim()), onClick: save }, L('保存交办运行核对', 'Save work run findings')),
            error && h('p', { role: 'alert', className: 'pa24-error' }, error));
        }
        function WorkerRunDetail({ id, binding, openWork }) {
          const [detail, setDetail] = React.useState(null), [error, setError] = React.useState(''), [diagnostic, setDiagnostic] = React.useState(null), [refresh, setRefresh] = React.useState(0);
          const alive = React.useRef(true);
          React.useEffect(() => { const abort = new AbortController(); let pending = false; alive.current = true;
            const load = async () => { if (pending) return; pending = true; try { const result = await rpc('worker.run', { runId: id, workspaceBinding: binding }, abort.signal); if (!abort.signal.aborted && result.workspaceBinding === binding) { setDetail(result); setError(''); } } catch (error) { if (!abort.signal.aborted) setError(error.message); } finally { pending = false; } };
            void load(); const timer = setInterval(load, 5000); return () => { alive.current = false; abort.abort(); clearInterval(timer); };
          }, [id, binding, refresh]);
          const preview = async () => { try { const result = await rpc('runs.diagnostics', { runId: id, workspaceBinding: binding }); if (alive.current && result.workspaceBinding === binding) setDiagnostic(result); } catch (error) { if (alive.current) setError(error.message); } };
          const run = detail?.run;
          return h('section', { className: 'pa24-card' }, h('h3', null, L('交办执行与投递', 'Work execution and delivery')),
            h('button', { type: 'button', onClick: () => setRefresh(value => value + 1) }, L('刷新运行状态', 'Refresh run status')),
            error && h('p', { role: 'alert', className: 'pa24-error' }, error), !detail && h('p', { role: 'status' }, L('正在读取运行…', 'Reading run…')),
            run && h('div', null, h('p', null, runStatusLabel(run.status)), h('p', null, run.instruction), run.progress && h('p', null, run.progress), run.result && h('pre', { className: 'pa24-json' }, run.result),
              run.progress_detail && h('div', null, h('p', null, L('已完成：', 'Completed: ') + run.progress_detail.completed), h('p', null, L('下一步：', 'Next: ') + run.progress_detail.next)),
              detail.execution && h('p', null, L('累计执行 ', 'Execution ') + Math.round(detail.execution.executionMs / 1000) + L(' 秒；剩余 ', ' s; remaining ') + Math.round(detail.execution.remainingMs / 1000) + L(' 秒', ' s')),
              detail.execution?.blocks.map(block => h('p', { key: block.key }, block.reason)),
              detail.execution?.stop && h('p', null, detail.execution.stop.settledAt ? L('宿主已确认停止', 'Host confirmed stop') : L('已请求停止，仍等待确认', 'Stop requested; awaiting confirmation')),
              h('button', { type: 'button', onClick: () => openWork(run.work_item_id) }, L('查看原助理交办', 'Open original work')),
              h('h4', null, L('补充收到与采用', 'Input receipt and adoption')), (detail.inputs || []).map(row => h('div', { key: row.execution_id }, h('p', null, ({ prepared: L('待接纳', 'Awaiting admission'), received: L('已收到，尚未采用', 'Received, not adopted'), adopted: L('已在原回合采用', 'Adopted in original turn'), rejected: L('未接纳', 'Not admitted'), unknown: L('接纳待核对', 'Admission uncertain') })[row.status]), h('p', null, row.instruction))),
              h('h4', null, L('工具动作与原回执', 'Tool actions and original receipts')), (detail.calls || []).map(call => h('details', { key: call.id }, h('summary', null, call.tool + ' · ' + t(call.status)), h('pre', { className: 'pa24-json' }, JSON.stringify({ arguments: call.args, result: call.result }, null, 2)))),
              !!detail.reviews?.length && h('details', null, h('summary', null, detail.reviewed ? L('当前证据已核对', 'Current evidence reviewed') : L('已有核对，待核验新证据', 'Previous findings; new evidence needs review')), detail.reviews.map(row => h('pre', { key: row.request_id, className: 'pa24-json' }, JSON.stringify(row.record.result, null, 2)))),
              detail.work && ['stopped','failed','timed_out','completed'].includes(run.status) && h(WorkerRunReview, { detail, binding, changed: () => setRefresh(value => value + 1) }),
              h('h4', null, L('固定结果投递', 'Fixed result delivery')), !(detail.deliveries || []).length && h('p', null, L('尚无结果投递', 'No result delivery yet')), (detail.deliveries || []).map(row => h('p', { key: row.id }, row.channel + ' · ' + row.target + ' · ' + deliveryLabel(row.status, row.channel) + (row.last_error ? ' · ' + row.last_error : ''))),
              !!detail.deliveries?.length && h(PlanDeliveryControls, { detail: { run, deliveries: detail.deliveries.map(row => ({ id: row.id, deliveryStatus: row.status, deliveries: [{ outbox_id: row.id, outbox: row, component: row.kind, fingerprint: row.fingerprint }] })) }, binding, onChanged: () => setRefresh(value => value + 1) }),
              h('details', null, h('summary', null, L('当次执行快照', 'Execution snapshot')), h('pre', { className: 'pa24-json' }, JSON.stringify(run.snapshot, null, 2))),
              h('button', { type: 'button', onClick: () => saveDownload({ filename: '24pa-result-' + id + '.json', content: JSON.stringify({ run, inputs: detail.inputs, calls: detail.calls, deliveries: detail.deliveries }, null, 2) }) }, L('下载当次结果', 'Download run result')),
              h('button', { type: 'button', onClick: preview }, L('预览脱敏诊断', 'Preview redacted diagnostics')),
              diagnostic && h('div', { className: 'pa24-note' }, h('p', null, diagnostic.message), h('pre', { className: 'pa24-json' }, diagnostic.content), h('button', { type: 'button', onClick: () => saveDownload(diagnostic) }, L('确认下载这份诊断', 'Confirm diagnostic download')))));
        }

        function RunHistoryDetail(helpers) {
          const { state, extra, planStates, refresh, openCard, tz } = helpers, binding = state.workspaceBinding;
          const model = planRowState(planStates, 'run-history:' + binding, {}), view = React.useSyncExternalStore(model.subscribe, model.getSnapshot);
          const filters = view.filters || { kind: 'runs', range: '7', includeUnresolved: true }, offset = view.offset || 0;
          const [list, setList] = React.useState({ loading: true }), [work, setWork] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
          const alive = React.useRef(true); React.useEffect(() => () => { alive.current = false; }, []);
          const filterKey = JSON.stringify(filters);
          React.useEffect(() => {
            const abort = new AbortController(), key = JSON.stringify([binding, filterKey, offset]); let pending = false;
            setList(previous => previous.key === key ? { ...previous, loading: true, error: null } : { key, loading: true });
            setWork(previous => previous?.workspaceBinding === binding && previous?.work.id === view.workId && previous?.runs.offset === (view.workOffset || 0) ? previous : null);
            const load = async () => { if (pending) return; pending = true; try {
              const result = await rpc('runs', { ...filters, offset, workspaceBinding: binding }, abort.signal);
              if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.total)) throw new Error(L('运行档案响应不完整，请刷新重试。', 'Incomplete run history; refresh to retry.'));
              if (!abort.signal.aborted && result.workspaceBinding === binding) setList({ key, data: result });
              if (view.workId) { const result = await rpc('work.inspect', { workId: view.workId, offset: view.workOffset || 0, workspaceBinding: binding }, abort.signal); if (!abort.signal.aborted && result.workspaceBinding === binding) setWork(result); }
            } catch (error) { if (!abort.signal.aborted) setList(previous => ({ ...previous, loading: false, error: error.message })); } finally { pending = false; } };
            void load(); const timer = setInterval(load, 5000); return () => { abort.abort(); clearInterval(timer); };
          }, [binding, filterKey, offset, view.tick, view.workId, view.workOffset]);
          const set = (key, value) => model.update({ filters: { ...filters, [key]: value }, offset: 0, selectedRun: null, workId: null });
          const openWork = id => model.update({ workId: id, workOffset: 0, selectedRun: null });
          const selectRun = row => model.update({ selectedRun: { id: row.id, skillId: row.skill_id, kind: row.record_kind }, workId: null });
          const exportRows = async () => { setBusy(true); setError(''); try { const file = await rpc('runs.export', { ...filters, workspaceBinding: binding }); if (alive.current && file.workspaceBinding === binding) saveDownload(file); } catch (error) { if (alive.current) setError(error.message); } finally { if (alive.current) setBusy(false); } };
          const field = (label, node) => h('label', { key: label, className: 'pa24-field' }, label, node);
          const select = (key, entries) => h('select', { value: filters[key] || '', onChange: event => set(key, event.target.value) }, entries.map(([value, label]) => h('option', { key: value, value }, label)));
          const statuses = { runs: ['pending', 'running', 'waiting', 'stopping', 'completed', 'failed', 'stopped', 'timed_out', 'needs_reconciliation'], work: ['accepted', 'queued', 'running', 'waiting_input', 'completed', 'failed', 'stopped', 'needs_reconciliation'], events: ['skipped', 'rejected', 'expired'], legacy: ['delivering', 'model_done', 'sent', 'unconfirmed'] };
          const summary = extra.runs, active = view.selectedRun;
          return h('section', { className: 'pa24-manager' }, sectionHead('pulse', L('运行记录', 'Run history'), L('执行、交办目标和未执行事件分别统计。等待恢复与自动重试沿用原运行。', 'Executions, work goals and non-execution events are counted separately. Waits and automatic retries keep the same run.'),
            h('div', { className: 'pa24-row' }, h('button', { type: 'button', onClick: () => { model.update({ tick: (view.tick || 0) + 1 }); void refresh().catch(() => {}); } }, L('刷新', 'Refresh')), h('button', { type: 'button', disabled: busy || !list.data, onClick: exportRows }, L('导出全部筛选结果', 'Export all matching results')))),
            extra._errors?.runs && h('p', { role: 'alert', className: 'pa24-error' }, extra._errors.runs),
            summary?.observedAt && h('div', { className: 'pa24-card' }, capKpi([[summary.runs24, L('24 小时运行', '24h runs')], [summary.failed24, L('执行失败', 'Execution failures')], [summary.delivery_failed24, L('投递失败', 'Delivery failures')], [summary.unexecuted24, L('未执行事件', 'Unexecuted events')]]),
              capKpi([[summary.active_work, L('进行中交办', 'Active work')], [summary.waiting_work, L('待我处理交办', 'Work awaiting you')], [summary.failed_work, L('异常交办', 'Failed work')]]),
              h('p', { className: 'pa24-meta' }, L('跨日未解决：运行 ', 'Unresolved across dates: runs ') + summary.unresolved + L('，未执行事件 ', ', unexecuted events ') + summary.unresolved_events + ' · ' + date(summary.observedAt, tz))),
            h('div', { className: 'pa24-card' }, field(L('档案类别', 'Record category'), h('select', { value: filters.kind, onChange: event => model.update({ filters: { kind: event.target.value, range: filters.range, from: filters.from, to: filters.to, includeUnresolved: filters.includeUnresolved, query: filters.query, planId: filters.planId }, offset: 0, selectedRun: null, workId: null }) },
              [['runs', L('执行记录', 'Executions')], ['work', L('助理交办', 'Work items')], ['events', L('未执行事件', 'Unexecuted events')], ['legacy', L('旧简报档案', 'Legacy digests')]].map(([value, label]) => h('option', { key: value, value }, label)))),
              field(L('时间范围', 'Date range'), select('range', [['7', L('近 7 天', 'Last 7 days')], ['30', L('近 30 天', 'Last 30 days')], ['custom', L('自定义', 'Custom')], ['all', L('全部历史', 'All history')]])),
              filters.range === 'custom' && h('div', null, ['from', 'to'].map(key => field((key === 'from' ? L('开始', 'From') : L('结束', 'To')) + ' · ' + tz, h('input', { type: 'datetime-local', value: filters[key] || '', onChange: event => set(key, event.target.value) })))),
              field(L('保留跨日期待处理与未解决异常', 'Keep unresolved records across dates'), h('input', { type: 'checkbox', checked: filters.includeUnresolved !== false, onChange: event => set('includeUnresolved', event.target.checked) })),
              field(L('标题、摘要或标识', 'Title, summary or ID'), h('input', { value: filters.query || '', onChange: event => set('query', event.target.value) })),
              field(L('执行状态', 'Execution status'), select('status', [['', L('全部状态', 'All statuses')], ...statuses[filters.kind].map(value => [value, filters.kind === 'runs' ? runStatusLabel(value) : t(value)])])),
              h('details', null, h('summary', null, L('来源、关联与投递筛选', 'Source, links and delivery filters')),
                filters.kind !== 'legacy' && field(L('发起来源', 'Initiation source'), select('source', [['', L('全部来源', 'All sources')], ...(filters.kind === 'work' ? [['local', L('本地', 'Local')], ['feishu', L('飞书', 'Feishu')]] : [['manual', L('手工', 'Manual')], ['schedule', L('计划', 'Scheduled')], ...(filters.kind === 'runs' ? [['trial', L('试运行', 'Trial')], ['rerun', L('重跑', 'Rerun')], ['continuation', L('接续', 'Continuation')]] : [])])])),
                [['planId', L('计划标识', 'Plan ID')], ...(['runs', 'work'].includes(filters.kind) ? [['workId', L('交办标识', 'Work ID')]] : []), ...(filters.kind !== 'legacy' ? [['skillId', 'Skill ID']] : []), ...(filters.kind === 'runs' ? [['versionId', L('版本标识', 'Version ID')]] : [])].map(([key, label]) => field(label, h('input', { value: filters[key] || '', onChange: event => set(key, event.target.value) }))),
                filters.kind === 'runs' && field(L('投递状态', 'Delivery status'), select('deliveryStatus', [['', L('全部投递状态', 'All delivery statuses')], ...['not_requested', 'suppressed', 'pending', 'sent', 'partial', 'failed', 'unknown', 'expired'].map(value => [value, deliveryLabel(value)])])))),
            error && h('p', { role: 'alert', className: 'pa24-error' }, error),
            list.error && h('p', { role: 'alert', className: 'pa24-error' }, L('读取失败；下方可能为上次结果：', 'Read failed; results below may be stale: ') + list.error),
            list.loading && h('p', { role: 'status' }, L('正在读取档案…', 'Reading history…')),
            list.data && h('div', { className: 'pa24-card' }, h('p', { className: 'pa24-meta' }, L('匹配记录 ', 'Matching records: ') + list.data.total + ' · ' + L('当前时区 ', 'Time zone ') + list.data.timeZone),
              !list.data.rows.length && h('p', null, list.data.empty ? L('此类档案尚无记录。实际运行或交办后会在这里保留。', 'No records in this category yet. Actual executions or work will appear here.') : L('当前筛选没有记录。可扩大时间范围或清除筛选。', 'No matching records. Widen the range or clear filters.')),
              list.data.rows.map(row => h('article', { key: row.id, className: 'pa24-job' }, h('h3', null, row.title || row.id), h('p', null, (filters.kind === 'runs' ? runStatusLabel(row.status) : t(row.status)) + (row.delivery_status ? ' · ' + deliveryLabel(row.delivery_status) : '')),
                h('p', { className: 'pa24-meta' }, date(row.created_at, tz) + ' · ' + runSourceLabel(row.source)), row.progress && h('p', null, row.progress), row.summary && h('p', null, row.summary),
                filters.kind === 'runs' && h('button', { type: 'button', onClick: () => selectRun(row) }, L('查看执行与投递', 'View execution and delivery')),
                filters.kind === 'work' && h('button', { type: 'button', onClick: () => openWork(row.id) }, L('查看交办详情', 'View work item')),
                filters.kind === 'events' && row.run_id && h('button', { type: 'button', onClick: () => selectRun({ id: row.run_id, record_kind: row.record_kind }) }, L('核对未执行原记录', 'Inspect unexecuted admission')),
                filters.kind === 'events' && row.plan_id && h('button', { type: 'button', onClick: () => helpers.openPlan(row.plan_id) }, L('处理原计划', 'Open original plan')),
                filters.kind === 'legacy' && h('details', null, h('summary', null, L('原始简报与旧关联', 'Original digest and links')), h('pre', { className: 'pa24-json' }, JSON.stringify(row, null, 2))),
                h('details', null, h('summary', null, L('技术标识', 'Technical IDs')), h('p', { className: 'pa24-meta' }, row.id + (row.plan_id ? ' · ' + row.plan_id : ''))))),
              h('div', { className: 'pa24-row' }, h('button', { type: 'button', disabled: !offset, onClick: () => model.update({ offset: Math.max(0, offset - 20) }) }, L('上一页', 'Previous')), h('button', { type: 'button', disabled: offset + 20 >= list.data.total, onClick: () => model.update({ offset: offset + 20 }) }, L('下一页', 'Next')))),
            active?.kind === 'worker' && h(WorkerRunDetail, { key: binding + active.id, id: active.id, binding, openWork }),
            active && active.kind !== 'worker' && h(SkillRunControls, { key: active.id, data: { id: active.skillId }, binding, detailOnly: true, initialRunId: active.id, openWork }),
            view.workId && !work && h('p', { role: 'status' }, L('正在读取交办…', 'Reading work item…')),
            work && h('section', { className: 'pa24-card' }, h('h3', null, work.work.title), h('p', null, t(work.work.status)), h('p', null, work.work.instruction),
              work.work.progress && h('p', null, work.work.progress), work.work.result && h('pre', { className: 'pa24-json' }, work.work.result),
              work.work.progress_detail && h('div', null, h('p', null, L('已完成：', 'Completed: ') + work.work.progress_detail.completed), h('p', null, L('下一步：', 'Next: ') + work.work.progress_detail.next)),
              h('p', { className: 'pa24-meta' }, L('来源：', 'Origin: ') + work.work.origin + ' · ' + L('结果回到：', 'Results return to: ') + work.work.delivery),
              work.work.child_session_id && h('button', { type: 'button', onClick: () => ctx.uiWorkspace.openSession({ childSessionId: work.work.child_session_id, parentSessionId: work.work.parent_session_id, mode: 'continuable' }) }, L('查看原交办会话', 'Open original work session')),
              h(WorkControls, { key: binding + work.work.id, work: work.work, changes: work.changes, binding, changed: () => { model.update({ tick: (model.getSnapshot().tick || 0) + 1 }); void refresh().catch(() => {}); } }),
              h('h4', null, L('关联执行记录 ', 'Linked runs ') + work.runs.total), work.runs.rows.map(row => h('div', { key: row.id }, h('button', { type: 'button', onClick: () => selectRun(row) }, date(row.created_at, tz) + ' · ' + t(row.status)))),
              work.runs.total > 20 && h('div', { className: 'pa24-row' }, h('button', { type: 'button', disabled: !(view.workOffset || 0), onClick: () => model.update({ workOffset: Math.max(0, (view.workOffset || 0) - 20) }) }, L('更近的运行', 'Newer runs')), h('button', { type: 'button', disabled: (view.workOffset || 0) + 20 >= work.runs.total, onClick: () => model.update({ workOffset: (view.workOffset || 0) + 20 }) }, L('更早的运行', 'Older runs')))),
            h('p', { className: 'pa24-meta' }, L('详细诊断默认保留 90 天，可在参数配置调整；结果及业务回执长期保留。', 'Detailed diagnostics default to 90 days in configuration. Results and business receipts persist.')),
            h('button', { type: 'button', onClick: () => openCard('config') }, L('打开参数配置', 'Open configuration')));
        }

        function SkillRunReview({ detail, binding, onSaved }) {
          const [summary, setSummary] = React.useState(''), [completed, setCompleted] = React.useState(''), [remaining, setRemaining] = React.useState('');
          const [calls, setCalls] = React.useState({}), [native, setNative] = React.useState({}), [confirmed, setConfirmed] = React.useState(false);
          const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
          const request = React.useRef(null), alive = React.useRef(true);
          React.useEffect(() => () => { alive.current = false; }, []);
          const unknown = detail.calls.filter(call => ['running', 'unknown'].includes(call.status));
          const pending = detail.native.filter(item => !item.end_data || item.end_data.producerReported === false);
          const callKey = call => JSON.stringify([call.session_id, call.call_id]);
          const nativeKey = item => JSON.stringify([item.kind, item.owner_id, item.native_id]);
          const save = async () => {
            const payload = { type: 'skill.run', op: 'review', runId: detail.run.id, workspaceBinding: binding, fingerprint: detail.fingerprint,
              confirm: confirmed, summary, completed, remaining,
              calls: unknown.map(call => ({ sessionId: call.session_id, callId: call.call_id, ...calls[callKey(call)] })),
              native: pending.map(item => ({ kind: item.kind, ownerId: item.owner_id, nativeId: item.native_id, evidence: native[nativeKey(item)] })) };
            const key = JSON.stringify(payload);
            if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
            setBusy(true); setError('');
            try {
              const result = await rpc('action', { ...payload, requestId: request.current.id });
              if (alive.current) onSaved(result);
            } catch (failure) { if (alive.current) setError(failure.message); }
            finally { if (alive.current) setBusy(false); }
          };
          return h('details', { className: 'pa24-note' }, h('summary', null, L('核对实际结果并结束本次运行', 'Reconcile and close this run')),
            h('p', null, L('先检查文件或原平台对象。填写已完成与剩余步骤；核对结论单独留档，原始未知回执保留。保存后仍须另行预览确认接续。', 'Inspect the actual files or platform objects. Record completed and remaining steps. Findings supplement the original uncertain receipts; continuation needs a separate preview and confirmation.')),
            detail.unresolvedOperations.length > 0 && h('div', { role: 'alert' },
              h('p', null, L('关联平台动作仍待核对，须先修复原对象回执。', 'Related platform operations still require reconciliation of their original receipts.')),
              h('pre', { className: 'pa24-json' }, JSON.stringify(detail.unresolvedOperations, null, 2))),
            [[L('核对结论与依据', 'Findings and evidence'), summary, setSummary], [L('已完成步骤（没有则写“无”）', 'Completed steps (write none if empty)'), completed, setCompleted], [L('剩余工作（没有则写“无”）', 'Remaining work (write none if empty)'), remaining, setRemaining]].map(([label, value, setter]) =>
              h('label', { key: label, className: 'pa24-field' }, label, h('textarea', { value, maxLength: 4000, rows: 3, onChange: event => setter(event.target.value) }))),
            unknown.map(call => { const key = callKey(call), value = calls[key] || {}; return h('fieldset', { key, className: 'pa24-note' },
              h('legend', null, call.tool + ' · ' + call.call_id), h('p', { className: 'pa24-meta' }, call.session_id),
              h('label', { className: 'pa24-field' }, L('实际结果', 'Actual outcome'), h('select', { value: value.outcome || '', onChange: event => setCalls({ ...calls, [key]: { ...value, outcome: event.target.value } }) },
                h('option', { value: '' }, L('请选择', 'Choose')),
                h('option', { value: 'completed' }, L('已完成，保留结果', 'Completed; preserve result')),
                h('option', { value: 'not_performed' }, L('已核实没有执行', 'Verified not performed')),
                h('option', { value: 'partial' }, L('部分完成，按剩余步骤接续', 'Partially completed; continue remaining steps')))),
              h('label', { className: 'pa24-field' }, L('对象链接、文件位置及核对依据', 'Object link, file path and verification evidence'), h('textarea', { value: value.evidence || '', rows: 2, maxLength: 4000, onChange: event => setCalls({ ...calls, [key]: { ...value, evidence: event.target.value } }) }))); }),
            pending.map(item => h('label', { key: nativeKey(item), className: 'pa24-field' }, L('确认已结束的依据：', 'Evidence of termination: ') + item.native_id,
              h('textarea', { value: native[nativeKey(item)] || '', rows: 2, maxLength: 4000, onChange: event => setNative({ ...native, [nativeKey(item)]: event.target.value }) }))),
            h('label', { className: 'pa24-field' }, h('input', { type: 'checkbox', checked: confirmed, onChange: event => setConfirmed(event.target.checked) }), L('我已核对实际效果和停止状态，以上结论可用于后续接续。', 'I verified actual effects and termination; these findings can be used for continuation.')),
            error && h('p', { className: 'pa24-error', role: 'alert' }, error),
            h('button', { type: 'button', disabled: busy || !confirmed || detail.unresolvedOperations.length > 0, onClick: save }, L('保存核对并结束本次运行', 'Save findings and close run')));
        }

        function SkillRunControls({ data, binding, detailOnly = false, initialRunId = null, openWork }) {
          const [values, setValues] = React.useState({}), [preview, setPreview] = React.useState(null);
          const [target, setTarget] = React.useState(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
          const [history, setHistory] = React.useState(null), [selected, setSelected] = React.useState(initialRunId), [detail, setDetail] = React.useState(null);
          const [diagnostics, setDiagnostics] = React.useState(null);
          const [offset, setOffset] = React.useState(0), [refresh, setRefresh] = React.useState(0), [approved, setApproved] = React.useState(false);
          const [instruction, setInstruction] = React.useState('');
          const [resumeInput, setResumeInput] = React.useState(''), [limitMinutes, setLimitMinutes] = React.useState('15');
          const request = React.useRef(null), alive = React.useRef(true);
          const selectedRun = React.useRef(selected); selectedRun.current = selected;
          React.useEffect(() => { setDiagnostics(null); setPreview(null); setApproved(false); setInstruction(''); setResumeInput(''); }, [selected]);
          React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
          React.useEffect(() => {
            const abort = new AbortController();
            const load = async () => {
              try {
                if (!detailOnly) {
                  const result = await rpc('skills.runs', { id: data.id, offset, workspaceBinding: binding }, abort.signal);
                  if (!abort.signal.aborted && result.workspaceBinding === binding) setHistory(result);
                }
                if (selected) {
                  const result = await rpc('skills.run', { runId: selected, workspaceBinding: binding }, abort.signal);
                  if (!abort.signal.aborted && result.workspaceBinding === binding) setDetail(result);
                }
              } catch (failure) { if (!abort.signal.aborted) setError(failure.message); }
            };
            void load(); const timer = setInterval(load, 2500);
            return () => { abort.abort(); clearInterval(timer); };
          }, [data.id, binding, selected, offset, refresh]);
          const fields = data.metadata?.pa24?.parameters || {};
          const status = runStatusLabel;
          const prepare = async selection => {
            setBusy(true); setError(''); setPreview(null); setApproved(false); request.current = null;
            const requestedRun = selectedRun.current, next = selection ? { ...selection, instruction } : null; setTarget(next);
            try {
              const result = await rpc('skills.preview', { id: data.id, versionId: data.versionId, executionLimitMs: Math.round(Number(limitMinutes) * 60000), ...(!next ? { parameters: values } : {}), ...(next || {}), workspaceBinding: binding });
              if (alive.current && selectedRun.current === requestedRun && result.workspaceBinding === binding) setPreview(result);
            } catch (failure) { if (alive.current) setError(failure.message); }
            finally { if (alive.current) setBusy(false); }
          };
          const run = async trial => {
            if (!preview) return;
            const payload = { type: 'skill.run', id: data.id, versionId: preview.versionId, parameters: preview.parameters, ...(target || {}),
              executionLimitMs: preview.executionLimitMs, fingerprint: preview.fingerprint, confirm: true, trial, workspaceBinding: binding };
            const key = JSON.stringify(payload);
            if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
            setBusy(true); setError('');
            try {
              const result = await rpc('action', { ...payload, requestId: request.current.id });
              if (!alive.current) return;
              setSelected(result.run.id); setDetail(null); setRefresh(n => n + 1); setPreview(null); setApproved(false); request.current = null;
            } catch (failure) { if (alive.current) setError(failure.message); }
            finally { if (alive.current) setBusy(false); }
          };
          const stop = async runId => {
            setBusy(true); setError('');
            try { await rpc('action', { type: 'skill.run', op: 'stop', runId, workspaceBinding: binding }); if (alive.current) setRefresh(n => n + 1); }
            catch (failure) { if (alive.current) setError(failure.message); }
            finally { if (alive.current) setBusy(false); }
          };
          const resume = async recheck => {
            const payload = { type: 'skill.run', op: recheck ? 'recheck' : 'resume', runId: detail.run.id, workspaceBinding: binding, instruction: resumeInput, confirm: true };
            const key = JSON.stringify(payload);
            if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
            setBusy(true); setError('');
            try {
              const result = await rpc('action', { ...payload, requestId: request.current.id });
              if (alive.current && selectedRun.current === payload.runId && result.workspaceBinding === binding) { setDetail(result); setResumeInput(''); setRefresh(n => n + 1); }
            } catch (failure) { if (alive.current && selectedRun.current === payload.runId) setError(failure.message); }
            finally { if (alive.current) setBusy(false); }
          };
          const downloadResult = () => {
            const url = URL.createObjectURL(new Blob([detail.run.result || ''], { type: 'text/plain;charset=utf-8' }));
            const link = document.createElement('a'); link.href = url; link.download = 'skill-result-' + detail.run.id + '.txt';
            document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
          };
          const changeValue = (name, field, value) => {
            const next = { ...values };
            if (value === '' && field.type !== 'string') delete next[name]; else next[name] = field.type === 'boolean' ? value : ['number', 'integer'].includes(field.type) ? Number(value) : value;
            setValues(next); setPreview(null); setApproved(false);
          };
          return h('section', { className: 'pa24-note', 'aria-label': L('Skill 运行', 'Skill runs') },
            !detailOnly && h('h4', null, L('手工运行', 'Manual run')),
            !detailOnly && h('p', { className: 'pa24-meta' }, L('预览不会执行。试运行会真实调用获准工具，结果保存在独立运行记录，并关联助理交办。', 'Preview does not execute. A trial really invokes authorized tools; results are saved in a run linked to a work item.')),
            !detailOnly && Object.entries(fields).map(([name, field]) => h('label', { key: name, className: 'pa24-field' }, name + (field.required ? ' *' : '') + (field.description ? ' · ' + field.description : ''),
              h('input', { type: field.type === 'boolean' ? 'checkbox' : ['number', 'integer'].includes(field.type) ? 'number' : 'text',
                ...(field.type === 'boolean' ? { checked: values[name] ?? field.default ?? false } : { value: values[name] ?? field.default ?? '', step: field.type === 'integer' ? 1 : 'any' }),
                onChange: event => changeValue(name, field, field.type === 'boolean' ? event.target.checked : event.target.value) }))),
            !detailOnly && h('label', { className: 'pa24-field' }, L('累计执行时限（分钟，等待不计入）', 'Active execution limit (minutes; waits excluded)'),
              h('input', { type: 'number', min: 1 / 60, max: 1440, step: 'any', value: limitMinutes, onChange: event => { setLimitMinutes(event.target.value); setPreview(null); setApproved(false); } })),
            !detailOnly && h('button', { type: 'button', disabled: busy || ['disabled', 'deleted'].includes(data.entry?.status) || ['persona', 'setup'].includes(data.type), onClick: () => prepare(null) }, L('预览本次运行', 'Preview run')),
            error && h('p', { role: 'alert', className: 'pa24-error' }, error),
            preview && h('div', { className: 'pa24-note' },
              h('p', null, preview.message), h('p', null, L('版本：', 'Version: ') + preview.versionId),
              h('p', null, L('累计执行时限：', 'Active execution limit: ') + (preview.executionLimitMs ?? 900000) / 60000 + L(' 分钟', ' minutes')),
              h('p', null, L('工具：', 'Tools: ') + (preview.tools.join('、') || L('无', 'None'))),
              preview.contract && h('p', null, L('完成标准：', 'Completion criteria: ') + preview.contract.completionCriteria),
              preview.continuation && h('div', { className: 'pa24-note' },
                h('p', null, L('将带入原交办的结果、动作回执和人工核对，仅接续剩余工作。', 'Previous results, receipts and human findings will be carried forward to continue remaining work.')),
                preview.continuation.runs.map(run => h('div', { key: run.id }, h('p', null, run.id + ' · ' + status(run.status)),
                  run.review && h('p', null, L('已完成：', 'Completed: ') + run.review.completed + '\n' + L('剩余：', 'Remaining: ') + run.review.remaining))),
                preview.continuation.instruction && h('p', null, preview.continuation.instruction)),
              h('pre', { className: 'pa24-json' }, JSON.stringify(preview.parameters, null, 2)),
              h('label', { className: 'pa24-field' }, h('input', { type: 'checkbox', checked: approved, onChange: event => setApproved(event.target.checked) }), L('确认这些参数、工具范围和真实执行。', 'Confirm these inputs, tools and actual execution.')),
              h('div', { className: 'pa24-row' },
                h('button', { type: 'button', disabled: busy || !approved, onClick: () => run(true) }, L('试运行', 'Trial run')),
                h('button', { type: 'button', disabled: busy || !approved || (!target && data.entry?.active_version !== preview.versionId), onClick: () => run(false) }, L('正式运行', 'Run')))),
            !detailOnly && h('h4', null, L('运行历史', 'Run history')),
            !detailOnly && (!history ? h('p', { role: 'status' }, L('正在读取运行记录…', 'Reading runs…')) : h('div', null,
              h('p', { className: 'pa24-meta' }, L('共 ' + history.total + ' 次', history.total + ' runs')),
              !history.rows.length && h('p', null, L('尚无运行记录；未试运行。', 'No runs yet; untested.')),
              history.rows.map(row => h('div', { key: row.id, className: 'pa24-row' },
                h('button', { type: 'button', onClick: () => { setSelected(row.id); setDetail(null); } }, row.id.slice(0, 8) + ' · ' + status(row.status)),
                h('span', { className: 'pa24-meta' }, (row.trial ? L('试运行', 'Trial') : L('正式运行', 'Run')) + ' · ' + new Date(row.created_at).toLocaleString()))))),
            history?.total > 20 && h('div', { className: 'pa24-row' },
              h('button', { disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - 20)) }, L('上一页', 'Previous')),
              h('button', { disabled: offset + 20 >= history.total, onClick: () => setOffset(offset + 20) }, L('下一页', 'Next'))),
            selected && !detail && h('p', { role: 'status' }, L('正在读取运行详情…', 'Reading run…')),
            detail && h('div', { className: 'pa24-note' },
              h('h4', null, status(detail.run.status)), h('p', null, detail.run.progress),
              detail.execution ? h('div', { className: 'pa24-note' },
                h('p', null, L('累计执行 ', 'Active execution ') + (detail.execution.executionMs / 1000).toFixed(1) + L(' 秒 · 剩余 ', ' s · Remaining ') + (detail.execution.remainingMs / 1000).toFixed(1) + L(' 秒', ' s')),
                h('p', { className: 'pa24-meta' }, L('排队 ', 'Queued ') + (detail.execution.queuedMs / 1000).toFixed(1) + L(' 秒 · 等待 ', ' s · Waiting ') + (detail.execution.waitingMs / 1000).toFixed(1) + L(' 秒', ' s')),
                detail.execution.blocks.map(block => h('p', { key: block.key }, block.reason)),
                detail.execution.stop && h('p', { role: detail.execution.stop.error ? 'alert' : 'status' }, detail.execution.stop.error || (detail.execution.stop.settledAt
                  ? L('原生执行已确认停止。', 'Native execution has stopped.') : L('已请求停止，正在等待实际执行回执。', 'Stop requested; waiting for native receipts.'))))
                : h('p', { className: 'pa24-meta' }, L('历史记录没有累计执行计时资料。', 'Active execution timing is unavailable for this legacy record.')),
              detail.run.status === 'waiting' && h('div', { className: 'pa24-note' },
                h('p', null, L('补充和放行沿原运行继续，不重置时限。其他阻断须分别处理。', 'Resume this run without resetting its time limit. Resolve each remaining blocker separately.')),
                detail.execution?.blocks.some(block => block.kind === 'input') && h('label', { className: 'pa24-field' }, L('补充给本次运行的信息', 'Information for this run'),
                  h('textarea', { value: resumeInput, rows: 3, maxLength: 4000, onChange: event => setResumeInput(event.target.value) })),
                h('div', { className: 'pa24-row' },
                  detail.execution?.blocks.some(block => block.kind === 'input') && h('button', { type: 'button', disabled: busy || !resumeInput.trim(), onClick: () => resume(false) }, L('补充并继续原运行', 'Submit and resume')),
                  h('button', { type: 'button', disabled: busy, onClick: () => resume(true) }, L('重新检查并继续原运行', 'Recheck and resume')))),
              h('p', { className: 'pa24-meta' }, L('助理交办：', 'Work item: ') + detail.run.work_item_id),
              h('p', { className: 'pa24-meta' }, L('版本：', 'Version: ') + detail.run.version_id),
              h('p', { className: 'pa24-meta' }, L('结果投递：', 'Delivery: ') + deliveryLabel(detail.run.delivery_status)),
              h('p', { className: 'pa24-meta' }, L('触发时间：', 'Triggered: ') + (detail.run.triggered_at ? new Date(detail.run.triggered_at).toLocaleString() : L('历史未记录', 'Not recorded')) + ' · ' + L('接纳时间：', 'Admitted: ') + new Date(detail.run.created_at).toLocaleString()),
              detail.run.result && h('pre', { className: 'pa24-json' }, detail.run.result),
              ['completed', 'failed', 'stopped', 'timed_out'].includes(detail.run.status) && h('label', { className: 'pa24-field' }, L('接续补充说明（可选）', 'Continuation instructions (optional)'),
                h('textarea', { value: instruction, maxLength: 4000, rows: 2, onChange: event => { setInstruction(event.target.value); setPreview(null); setApproved(false); } })),
              h('div', { className: 'pa24-row' },
                detail.run.mode !== 'template' && h('button', { type: 'button', onClick: () => ctx.uiWorkspace.openSession(detail.run.mode === 'business' ? { childSessionId: detail.run.session_id, parentSessionId: detail.run.source_session_id, mode: 'continuable' } : detail.run.session_id) }, L('查看原执行会话', 'Open execution session')),
                detail.run.result && h('button', { type: 'button', onClick: downloadResult }, L('下载结果', 'Download result')),
                openWork && h('button', { type: 'button', onClick: () => openWork(detail.run.work_item_id) }, L('查看原助理交办', 'Open original work item')),
                h('button', { type: 'button', onClick: async () => { const id = detail.run.id; try { const result = await rpc('runs.diagnostics', { workspaceBinding: binding, runId: id }); if (alive.current && selectedRun.current === id && result.workspaceBinding === binding) setDiagnostics(result); } catch (failure) { if (alive.current) setError(failure.message); } } }, L('预览脱敏诊断', 'Preview redacted diagnostics')),
                ['pending', 'running', 'waiting', 'stopping', 'needs_reconciliation'].includes(detail.run.status) && h('button', { type: 'button', disabled: busy, onClick: () => stop(detail.run.id) }, L('停止本次运行', 'Stop run')),
                ['completed', 'failed', 'stopped', 'timed_out'].includes(detail.run.status) && h('button', { type: 'button', disabled: busy || ['disabled', 'deleted'].includes(data.entry?.status), onClick: () => prepare({ rerunId: detail.run.id, configuration: 'original' }) }, L('用原快照重跑 · 先预览', 'Rerun snapshot · preview')),
                ['completed', 'failed', 'stopped', 'timed_out'].includes(detail.run.status) && h('button', { type: 'button', disabled: busy || ['disabled', 'deleted'].includes(data.entry?.status), onClick: () => prepare({ rerunId: detail.run.id, configuration: 'current' }) }, L('用当前配置重跑 · 先预览', 'Rerun current · preview'))),
              diagnostics && h('div', { className: 'pa24-note' }, h('p', null, diagnostics.message), h('pre', { className: 'pa24-json' }, diagnostics.content), h('button', { type: 'button', onClick: () => saveDownload(diagnostics) }, L('确认下载这份诊断', 'Download this diagnostic preview'))),
              h('details', null, h('summary', null, L('输入、资源与版本快照', 'Input, resources and version snapshot')), h('pre', { className: 'pa24-json' }, JSON.stringify({ parameters: detail.run.parameters, contract: detail.run.contract, files: detail.run.files, plan: detail.run.plan }, null, 2))),
              (detail.deliveries || []).length > 0 && h(PlanDeliveryControls, { key: detail.run.id, detail, binding, onChanged: () => setRefresh(n => n + 1) }),
              detail.attempts?.length > 0 && h('details', null, h('summary', null, L('执行尝试（含自动重试）', 'Execution attempts (including retries)')),
                detail.attempts.map(attempt => h('p', { key: attempt.number }, L('第 ', 'Attempt ') + attempt.number + L(' 次', '') + ' · ' + new Date(attempt.startedAt).toLocaleString() + (attempt.error ? ' · ' + attempt.error : '')))),
              h('details', null, h('summary', null, L('实际工具调用与回执', 'Actual tool calls and receipts')), h('pre', { className: 'pa24-json' }, JSON.stringify(detail.calls, null, 2))),
              detail.inputs?.length > 0 && h('details', null, h('summary', null, L('输入接纳与采用', 'Input receipt and adoption')),
                detail.inputs.map(input => h('p', { key: input.message_id }, input.message_id + ' · ' + (!input.accepted ? L('归属未确认', 'Ownership not confirmed')
                  : input.adopted === true ? L('已采用', 'Adopted') : input.adopted === false ? L('已接纳，尚未采用', 'Accepted, not adopted') : L('采用状态暂不可核验', 'Adoption could not be verified'))))),
              detail.reviews?.length > 0 && h('details', null, h('summary', null, L('人工核对记录', 'Human verification history')),
                !detail.reviewed && h('p', { role: 'alert' }, L('核对后收到新证据，需要重新核对后才能接续。', 'New evidence arrived after verification; review it before continuing.')),
                h('pre', { className: 'pa24-json' }, JSON.stringify(detail.reviews, null, 2))),
              (detail.run.status === 'needs_reconciliation' || (['failed', 'stopped', 'timed_out'].includes(detail.run.status) && !detail.reviewed && detail.calls.some(call => ['running', 'unknown'].includes(call.status))) || (detail.reviews?.length > 0 && !detail.reviewed)) && h(SkillRunReview, { key: detail.run.id + ':' + detail.fingerprint, detail, binding,
                onSaved: result => { setDetail(result); setRefresh(n => n + 1); } }),
              detail.native?.length > 0 && h('details', null, h('summary', null, L('子任务与后台作业', 'Subtasks and background jobs')),
                detail.native.map(item => h('div', { key: item.kind + ':' + item.owner_id + ':' + item.native_id, className: 'pa24-note' },
                  h('p', null, (item.kind === 'job' ? L('后台作业', 'Background job') : L('子任务', 'Subtask')) + ' · ' + item.native_id),
                  h('p', { className: 'pa24-meta' }, L('所属会话：', 'Owner session: ') + item.owner_id),
                  h('p', null, item.end_data ? L('结束状态：', 'Terminal status: ') + (item.end_data.status || item.end_data.stopReason) : L('尚无结束回执', 'No terminal receipt yet')),
                  item.end_data?.detail && h('p', null, item.end_data.detail),
                  item.end_data?.producerReported === false && h('p', { role: 'alert' }, L('生产者未确认结束，需要核对实际状态。', 'The producer has not confirmed termination. Reconciliation is required.')))))));
        }

        function SkillsDetail({ binding }) {
          const [catalog, setCatalog] = React.useState({ status: 'loading' });
          const [selected, setSelected] = React.useState(null), [detail, setDetail] = React.useState({ status: 'idle' });
          const [query, setQuery] = React.useState(''), [source, setSource] = React.useState('all'), [page, setPage] = React.useState(0);
          const [tick, setTick] = React.useState(0), [downloading, setDownloading] = React.useState(false), [downloadError, setDownloadError] = React.useState('');
          const [editor, setEditor] = React.useState(null), [busy, setBusy] = React.useState(false), [feedback, setFeedback] = React.useState('');
          const [version, setVersion] = React.useState(''), [confirmed, setConfirmed] = React.useState(false);
          const mutation = React.useRef(null);
          const alive = React.useRef(true);
          const detailTitle = React.useRef(null);
          React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
          React.useEffect(() => { setSelected(null); setEditor(null); setFeedback(''); mutation.current = null; }, [binding]);
          React.useEffect(() => { setVersion(''); setConfirmed(false); }, [selected, tick]);
          React.useEffect(() => { if (detail.status === 'ready' && detail.id === selected) detailTitle.current?.focus(); }, [detail, selected]);
          React.useEffect(() => {
            const abort = new AbortController();
            setCatalog({ status: 'loading' }); setPage(0); setDownloadError('');
            rpc('skills.catalog', { workspaceBinding: binding }, abort.signal).then(data => {
              if (!abort.signal.aborted && data.workspaceBinding === binding) setCatalog({ status: 'ready', data });
            }).catch(error => { if (!abort.signal.aborted) setCatalog({ status: 'error', error: error.message }); });
            return () => abort.abort();
          }, [binding, tick]);
          React.useEffect(() => {
            const abort = new AbortController();
            setDownloadError('');
            if (!selected) { setDetail({ status: 'idle' }); return () => abort.abort(); }
            setDetail({ status: 'loading', id: selected });
            rpc(version ? 'skills.version' : 'skills.inspect', { id: selected, versionId: version, workspaceBinding: binding }, abort.signal).then(data => {
              if (!abort.signal.aborted && data.workspaceBinding === binding) setDetail({ status: 'ready', id: selected, data });
            }).catch(error => { if (!abort.signal.aborted) setDetail({ status: 'error', id: selected, error: error.message }); });
            return () => abort.abort();
          }, [selected, binding, tick, version]);
          const typeLabel = type => ({ task: L('智能任务', 'Agent task'), template: L('确定性模板', 'Template'), persona: L('职责', 'Persona'), setup: L('接入向导', 'Setup guide') }[type] || L('待核验', 'Unverified'));
          const sourceLabel = value => value === 'builtin' ? L('内置原件', 'Built-in original') : value === 'managed' ? L('受管 Skill', 'Managed skill') : L('工作区文件', 'Workspace file');
          const data = detail.id === selected && detail.status === 'ready' ? detail.data : null;
          const download = async (full = false) => {
            if (!data) return;
            setDownloading(true); setDownloadError('');
            try {
              const file = await rpc(full ? 'skills.package' : 'skills.export', { id: data.id, versionId: data.versionId, fingerprint: data.fingerprint, workspaceBinding: binding });
              if (!alive.current || file.workspaceBinding !== binding) return;
              const bytes = full ? Uint8Array.from(atob(file.base64), c => c.charCodeAt(0)) : file.content;
              const url = URL.createObjectURL(new Blob([bytes], { type: full ? 'application/zip' : 'text/markdown;charset=utf-8' }));
              const link = document.createElement('a'); link.href = url; link.download = file.filename;
              document.body.append(link); link.click(); link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 0);
            } catch (error) { if (alive.current) setDownloadError(error.message); }
            finally { if (alive.current) setDownloading(false); }
          };
          const change = async payload => {
            const key = JSON.stringify(payload);
            if (mutation.current?.key !== key) mutation.current = { key, requestId: crypto.randomUUID() };
            setBusy(true); setFeedback('');
            try {
              const result = await rpc('action', { type: 'skill.change', ...payload, requestId: mutation.current.requestId, workspaceBinding: binding });
              if (!alive.current) return;
              mutation.current = null; setEditor(null); setTick(t => t + 1);
              setSelected('managed:' + result.entry.id);
              setFeedback((result.warnings || []).join('；') || L('已保存。', 'Saved.'));
            } catch (error) { if (alive.current) setFeedback(error.message); }
            finally { if (alive.current) setBusy(false); }
          };
          const seed = description => {
            const metadata = { track: 'agent', tools: [], pa24: { schemaVersion: 1, mode: 'local', parameters: {}, expectedResult: description || '填写预期结果', completionCriteria: '完成目标并如实列出结果、依据与未完成项。' } };
            return '---\n' + JSON.stringify({ name: 'personal-skill', description: description || '填写 Skill 用途', metadata }, null, 2) + '\n---\n\n## 目标\n' + (description || '填写具体目标。') + '\n\n## 执行说明\n根据当次参数完成目标；缺少信息时说明需要补充的内容。\n';
          };
          const upload = async file => {
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) { setFeedback(L('上传文件不能超过 8 MiB。', 'Uploads are limited to 8 MiB.')); return; }
            try {
              const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader(); reader.onerror = () => reject(new Error(L('文件读取失败。', 'Could not read file.')));
                reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file);
              });
              if (alive.current) await change({ op: 'save', filename: file.name, base64, displayName: file.name.replace(/\.(zip|md)$/i, '') });
            } catch (error) { if (alive.current) setFeedback(error.message); }
          };
          const entries = catalog.data?.entries || [];
          const matches = entries.filter(entry => (source === 'all' || entry.source === source) && (entry.name + ' ' + entry.description).toLowerCase().includes(query.trim().toLowerCase()));
          const rows = matches.slice(page * 20, (page + 1) * 20);
          return h('div', { className: 'pa24-skills' },
            sectionHead('code', null, L('查看内置原件与工作区 Skill。读取和下载不会执行 Skill。', 'Inspect built-in originals and workspace skills. Reading and downloading do not execute them.'),
              h('button', { type: 'button', onClick: () => setTick(tick + 1), disabled: catalog.status === 'loading' }, icon('refresh'), L('刷新目录', 'Refresh catalog')), 'violet'),
            h('p', { className: 'pa24-note' }, L('文件和内置原件可复制后编辑。草稿保存与启用分开；更新保留旧版本。完整包只包含 Skill 自身文件，不附带工作区配置、计划参数或运行历史。', 'Copy files or built-ins before editing. Saving a draft does not publish it. Earlier versions remain available. Packages contain only skill files.')),
            h('div', { className: 'pa24-row' },
              h('button', { type: 'button', disabled: busy, onClick: () => setEditor({ displayName: '', description: '', markdown: seed('') }) }, L('新建 Skill', 'New skill')),
              h('label', { className: 'pa24-field' }, L('上传 Markdown / ZIP', 'Upload Markdown / ZIP'),
                h('input', { type: 'file', accept: '.md,.zip', disabled: busy, onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); } }))),
            feedback && h('p', { role: 'status', className: 'pa24-note' }, feedback),
            editor && h('section', { className: 'pa24-card', 'aria-label': L('Skill 编辑', 'Skill editor') },
              h('h3', null, editor.id ? L('编辑草稿', 'Edit draft') : L('新建草稿', 'New draft')),
              h('label', { className: 'pa24-field' }, L('显示名称', 'Display name'), h('input', { value: editor.displayName, maxLength: 120, onChange: event => setEditor({ ...editor, displayName: event.target.value }) })),
              !editor.id && h('label', { className: 'pa24-field' }, L('用一句话描述用途', 'Describe what this skill should do'), h('textarea', { rows: 3, value: editor.description, onChange: event => setEditor({ ...editor, description: event.target.value }) })),
              !editor.id && h('button', { type: 'button', onClick: () => setEditor({ ...editor, markdown: seed(editor.description) }) }, L('从描述整理草稿', 'Create draft from description')),
              h('p', { className: 'pa24-meta' }, L('在 SKILL.md 中维护指令、参数、预期结果与完成标准。tools 空数组表示不使用工具；需要工具时明确填写名称。保存草稿不会执行。', 'Edit instructions, parameters, expected output and completion criteria. An empty tools list permits no tools. Saving does not execute the skill.')),
              h('label', { className: 'pa24-field' }, 'SKILL.md', h('textarea', { rows: 18, value: editor.markdown, spellCheck: false, onChange: event => setEditor({ ...editor, markdown: event.target.value }) })),
              h('div', { className: 'pa24-row' },
                h('button', { type: 'button', disabled: busy || !editor.displayName.trim(), onClick: () => change({ op: 'save', id: editor.id, expectedRevision: editor.revision, baseVersionId: editor.versionId, displayName: editor.displayName, markdown: editor.markdown }) }, busy ? L('保存中…', 'Saving…') : L('保存草稿', 'Save draft')),
                h('button', { type: 'button', disabled: busy, onClick: () => setEditor(null) }, L('取消编辑', 'Cancel')))),
            catalog.status === 'loading' && h('p', { role: 'status' }, L('正在读取 Skill 目录…', 'Reading skill catalog…')),
            catalog.status === 'error' && h('p', { role: 'alert', className: 'pa24-error' }, catalog.error),
            catalog.status === 'ready' && !selected && h('section', { className: 'pa24-card' },
              h('p', { className: 'pa24-meta' }, catalog.data.discovery === 'complete'
                ? L('已读取当前目录。同名工作区文件只展示当前生效项；格式不正确或未被发现的文件不会出现在列表中。', 'Current catalog loaded. Only the active workspace entry for each name is shown; invalid or undiscovered files are not listed.')
                : catalog.data.discovery === 'unavailable' ? L('工作区目录不可用，当前仅展示内置原件。', 'Workspace catalog unavailable; showing built-in originals only.')
                : L('工作区发现不完整或完整性未知，不能据此判断工作区没有其他 Skill。', 'Workspace discovery is incomplete or unverified; other skills may exist.')),
              catalog.data.discoveryError && h('p', { role: 'alert', className: 'pa24-error' }, catalog.data.discoveryError),
              h('div', { className: 'pa24-row' },
                h('label', null, L('搜索 Skill', 'Search skills'), h('input', { type: 'search', value: query, onChange: event => { setQuery(event.target.value); setPage(0); } })),
                h('label', null, L('来源', 'Source'), h('select', { value: source, onChange: event => { setSource(event.target.value); setPage(0); } },
                  h('option', { value: 'all' }, L('全部', 'All')), h('option', { value: 'builtin' }, sourceLabel('builtin')), h('option', { value: 'project-dsh' }, sourceLabel('project-dsh')), h('option', { value: 'managed' }, sourceLabel('managed'))))),
              h('p', { className: 'pa24-meta' }, L('当前可见 ' + entries.length + ' 项，匹配 ' + matches.length + ' 项', entries.length + ' visible, ' + matches.length + ' matching')),
              !rows.length && h('p', { role: 'status' }, entries.length ? L('没有匹配项', 'No matches') : L('本次未返回目录项', 'No entries returned')),
              rows.map(entry => h('div', { className: 'pa24-note', key: entry.id },
                h('button', { type: 'button', onClick: () => setSelected(entry.id), 'aria-pressed': selected === entry.id, className: 'pa24-quiet' }, entry.name, ' · ', sourceLabel(entry.source)),
                h('p', null, entry.description), h('p', { className: 'pa24-meta' }, typeLabel(entry.type), ' · ', entry.status === 'error' ? L('待修正', 'Needs correction')
                  : entry.verification?.runs ? L('本版本运行 ' + entry.verification.runs + ' 次 · 试运行 ' + entry.verification.trials + ' 次', entry.verification.runs + ' runs · ' + entry.verification.trials + ' trials for this version') : L('定义已读取 · 本版本未运行', 'Definition read · this version has not run')),
                entry.managedStatus && h('p', { className: 'pa24-meta' }, ({ draft: L('草稿', 'Draft'), enabled: L('已启用', 'Enabled'), disabled: L('已禁用', 'Disabled'), deleted: L('已删除 · 历史保留', 'Deleted · history retained') })[entry.managedStatus]),
                entry.error && h('p', { className: 'pa24-error' }, entry.error))),
              matches.length > 20 && h('div', { className: 'pa24-row' },
                h('button', { type: 'button', disabled: page === 0, onClick: () => setPage(page - 1) }, L('上一页', 'Previous')),
                h('span', null, (page + 1) + ' / ' + Math.ceil(matches.length / 20)),
                h('button', { type: 'button', disabled: (page + 1) * 20 >= matches.length, onClick: () => setPage(page + 1) }, L('下一页', 'Next')))),
            selected && h('section', { className: 'pa24-card', 'aria-label': L('Skill 详情', 'Skill details') },
              h('button', { type: 'button', onClick: () => setSelected(null), className: 'pa24-quiet' }, L('返回 Skill 目录', 'Back to skill catalog')),
              detail.status === 'loading' && h('p', { role: 'status' }, L('正在读取详情…', 'Reading details…')),
              detail.status === 'error' && h('p', { role: 'alert', className: 'pa24-error' }, detail.error),
              data && h('div', null,
                h('h3', { ref: detailTitle, tabIndex: -1 }, data.name), h('p', null, data.description),
                data.entry?.status === 'deleted' && h('p', { role: 'status', className: 'pa24-note' }, L('此 Skill 已删除。版本、结果与运行历史仍可查阅；在途运行可停止，未决结果可核对。不能再编辑、启用或开始新运行。', 'This skill is deleted. Versions, results and run history remain accessible; active runs can be stopped and uncertain results reviewed. Editing, publishing and new runs are unavailable.')),
                fields([[L('来源', 'Source'), sourceLabel(data.source)], [L('类型', 'Type'), typeLabel(data.type)], [L('执行轨', 'Track'), data.track], [L('内容指纹（非版本号）', 'Content fingerprint (not a version)'), data.fingerprint]]),
                h('h4', null, L('运行范围与限制', 'Execution scope and restrictions')),
                data.restrictions.map((text, index) => h('p', { className: 'pa24-meta', key: index }, text)),
                data.verification && h('p', { className: 'pa24-meta' }, L('当前版本：运行 ' + data.verification.runs + ' 次，试运行 ' + data.verification.trials + ' 次，执行回合完成 ' + data.verification.completed + ' 次；业务完成请核对结果。', 'Current version: ' + data.verification.runs + ' runs, ' + data.verification.trials + ' trials, ' + data.verification.completed + ' completed executions; inspect results for business completion.')),
                data.metadata?.pa24?.dependencies && h('details', null, h('summary', null, L('声明的运行依赖', 'Declared dependencies')), h('pre', { className: 'pa24-json' }, JSON.stringify(data.metadata.pa24.dependencies, null, 2))),
                h('h4', null, L('关联计划', 'Linked plans')),
                h('p', { className: 'pa24-meta' }, data.source === 'managed' ? L('计划绑定稳定身份，修改显示名称不改变关联。', 'Plans bind to a stable identity; changing the display name preserves links.') : L('文件与内置项的既有计划按名称绑定。', 'Existing file and built-in plans bind by name.')),
                data.plansError ? h('p', { role: 'alert', className: 'pa24-error' }, data.plansError) : data.plans.length
                  ? data.plans.map(plan => h('p', { key: plan.id }, plan.kind + ' · ' + plan.id + ' · ' + plan.status)) : h('p', null, L('没有按此名称绑定的计划', 'No plans bound to this name')),
                h('details', null, h('summary', null, L('声明与参数', 'Declared metadata')), h('pre', { className: 'pa24-json' }, JSON.stringify(data.metadata, null, 2))),
                h('h4', null, L('指令正文', 'Instructions')), h('pre', { className: 'pa24-json' }, data.content),
                data.type === 'template' && h('p', { className: 'pa24-note' }, L('确定性模板不调用模型。自由修改业务行为请先生成智能副本；智能副本更灵活，实际运行会产生模型用量，工具须另行声明。', 'Deterministic templates do not call a model. Create an agent copy to change behavior; running it uses model tokens and requires explicit tool declarations.')),
                data.entry && h(SkillRunControls, { key: data.id + ':' + data.versionId, data, binding }),
                data.entry && h('section', { className: 'pa24-note' },
                  h('h4', null, L('版本与草稿', 'Versions and draft')),
                  fields([[L('状态', 'Status'), ({ draft: L('草稿', 'Draft'), enabled: L('已启用', 'Enabled'), disabled: L('已禁用', 'Disabled'), deleted: L('已删除', 'Deleted') })[data.entry.status] || data.entry.status], [L('修订', 'Revision'), String(data.entry.revision)], [L('当前启用版本', 'Published version'), data.entry.active_version || L('尚未启用', 'Unpublished')]]),
                  h('label', { className: 'pa24-field' }, L('查看版本', 'View version'), h('select', { value: version || data.entry.draft_version, onChange: event => { setVersion(event.target.value); setConfirmed(false); } },
                    data.versions.map(row => h('option', { key: row.id, value: row.id }, row.id.slice(0, 8) + ' · ' + (row.validation_error ? L('待修正', 'Invalid') : L('已保存', 'Saved')))))),
                  h('p', { className: 'pa24-meta' }, L('文件清单', 'Package files') + ' · ' + data.files.length),
                  data.files.map(file => h('p', { key: file.path, className: 'pa24-meta' }, file.path + ' · ' + file.bytes + ' B')),
                  h('div', { className: 'pa24-row' },
                    h('button', { type: 'button', disabled: busy || data.entry.status === 'deleted', onClick: () => setEditor({ id: data.id, revision: data.entry.revision, versionId: data.versionId, displayName: data.name, markdown: data.markdown }) }, L('编辑此内容为新草稿', 'Edit as new draft')),
                    h('button', { type: 'button', disabled: busy || data.entry.status === 'deleted', onClick: () => change({ op: 'disable', id: data.id, expectedRevision: data.entry.revision }) }, L('禁用并暂停关联计划', 'Disable and pause plans'))),
                  h('label', { className: 'pa24-field' }, h('input', { type: 'checkbox', checked: confirmed, onChange: event => setConfirmed(event.target.checked) }), L('已核对本版本内容、权限声明和关联计划；启用只影响后续运行。', 'I reviewed this version, permissions and linked plans. Publishing affects future runs.')),
                  h('div', { className: 'pa24-row' },
                    h('button', { type: 'button', disabled: busy || data.entry.status === 'deleted' || !confirmed || data.restrictions.length > 0, onClick: () => change({ op: version && version !== data.entry.draft_version ? 'rollback' : 'publish', id: data.id, expectedRevision: data.entry.revision, versionId: data.versionId, confirm: true }) }, L('启用所选版本', 'Publish selected version')),
                    h('button', { type: 'button', disabled: busy || data.entry.status === 'deleted' || !confirmed || data.plansError || data.plans.some(p => p.status !== 'stopped'), onClick: () => change({ op: 'delete', id: data.id, expectedRevision: data.entry.revision }) }, L('删除 Skill，保留历史', 'Delete skill, keep history')))),
                h('div', { className: 'pa24-row' },
                  h('button', { type: 'button', disabled: busy || data.entry?.status === 'deleted', onClick: () => change({ op: 'save', copyFrom: data.id, versionId: data.versionId, fingerprint: data.fingerprint, displayName: (data.name + L(' 副本', ' copy')).slice(0, 120) }) }, L('复制为个人 Skill', 'Copy as personal skill')),
                  data.type === 'template' && h('button', { type: 'button', disabled: busy || data.entry?.status === 'deleted', onClick: () => change({ op: 'save', copyFrom: data.id, versionId: data.versionId, fingerprint: data.fingerprint, intelligentCopy: true, displayName: (data.name + L(' 智能副本', ' agent copy')).slice(0, 120) }) }, L('生成智能副本草稿', 'Create agent copy draft')),
                  h('button', { type: 'button', disabled: downloading, onClick: () => download(false) }, icon('note'), downloading ? L('准备下载…', 'Preparing download…') : L('下载指令 Markdown', 'Download instruction Markdown')),
                  h('button', { type: 'button', disabled: downloading, onClick: () => download(true) }, L('下载完整 ZIP 包', 'Download full ZIP package'))),
                downloadError && h('p', { role: 'alert', className: 'pa24-error' }, downloadError))));
        }

        // 卡片注册表：tier 为纯函数（角标聚合复用同一结果）；label 可覆盖状态词。
        const CARDS = [
          {
            id: 'skills', cat: 'work', tone: 'violet', icon: 'code', title: ['Skill 管理', 'Skill management'], sub: ['能力、版本与手工运行', 'Capabilities, versions and manual runs'], action: ['查看 Skill', 'Browse skills'],
            tier: () => 'unchecked',
            label: () => L('包、版本与运行', 'Packages, versions & runs'),
            body: () => h('p', { className: 'pa24-meta' }, L('创建与导入 Skill、管理版本和关联计划，预览并执行任务，查看实际结果。', 'Create and import skills, manage versions and linked plans, preview and run tasks, and inspect actual results.')),
            detail: helpers => h(SkillsDetail, { key: helpers.state.workspaceBinding, binding: helpers.state.workspaceBinding ?? null }),
          },
          {
            id: 'work', cat: 'work', tone: 'blue', icon: 'tasks', title: ['待办', 'Todos'], sub: ['原平台业务工作与截止', 'Platform tasks and deadlines'], action: ['查看待办', 'View todos'],
            tier: ({ extra }) => extra.todos?.counts ? extra.todos.complete ? 'ok' : 'warn' : 'unchecked',
            body: ({ extra }) => {
              const data = extra.todos;
              return data?.counts ? h('div', null, capKpi([[data.counts.overdue, L('逾期', 'Overdue')], [data.counts.today, L('今日到期', 'Due today')], [data.counts.open, L('未完成', 'Open')]]),
                h('p', { className: 'pa24-meta' }, data.complete ? L('已保存的完整来源观察', 'Saved complete source observations') : L('来源未完整核验，以上为当前可展示计数', 'Sources incomplete; counts reflect available observations')))
                : h('p', { className: 'pa24-meta' }, extra._errors?.todos || L('正在读取待办…', 'Reading todos…'));
            },
            detail: helpers => h(TodoDetail, { key: helpers.state.workspaceBinding, ...helpers }),
          },
          {
            id: 'activity', cat: 'work', tone: 'blue', icon: 'pulse', title: ['运行记录', 'Run history'], sub: ['执行 · 投递 · 助理交办', 'Execution · delivery · work items'], action: ['查看运行档案', 'Open run history'],
            tier: ({ extra }) => extra._errors?.runs ? 'error' : !extra.runs?.observedAt ? 'unchecked' : extra.runs.unresolved || extra.runs.unresolved_events ? 'warn' : 'ok',
            body: ({ extra }) => {
              const summary = extra.runs;
              return summary?.observedAt ? h('div', null, capKpi([[summary.runs24, L('24 小时运行', '24h runs')], [summary.failed24, L('执行失败', 'Execution failures')], [summary.delivery_failed24, L('投递失败', 'Delivery failures')]]),
                capLine(L('未执行事件', 'Unexecuted events'), summary.unexecuted24), capLine(L('待我处理交办', 'Work awaiting you'), summary.waiting_work))
                : h('p', { className: 'pa24-meta' }, extra._errors?.runs || L('正在读取完整统计…', 'Reading complete statistics…'));
            },
            detail: helpers => h(RunHistoryDetail, { key: helpers.state.workspaceBinding, ...helpers }),
          },
          {
            id: 'reminders', cat: 'work', tone: 'amber', icon: 'calendar', title: ['日程', 'Calendar'], sub: ['今日安排 · 多日历与原生提醒', 'Today · calendars and native reminders'], action: ['查看日程', 'View calendar'],
            tier: ({ extra }) => Array.isArray(extra.calendar?.sources) ? extra.calendar.complete ? 'ok' : 'warn' : 'unchecked',
            body: ({ extra, tz }) => {
              const data = Array.isArray(extra.calendar?.sources) ? extra.calendar : null;
              return h('div', null, capLine(L('今日日程', 'Today’s events'), data ? data.total === null ? L('范围未完整核验', 'Coverage unverified') : data.total + L(' 项（已保存）', ' (saved)') : L('读取中…', 'Loading…')),
                capLine(L('下一场', 'Next event'), data?.next ? data.next.summary + ' · ' + date(data.next.start, tz) : L('尚无已核验安排', 'No verified event')),
                data && capLine(L('已知冲突', 'Known conflicts'), data.conflicts.length + L(' 处', '')));
            },
            detail: helpers => h(CalendarDetail, { key: helpers.state.workspaceBinding, ...helpers }),
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
            detail: helpers => (helpers.workspace ? h(MemoryView, { key: helpers.state.workspaceBinding + helpers.workspace.path, workspace: helpers.workspace, binding: helpers.state.workspaceBinding, openRobot: helpers.openRobot }) : empty('memory', 'violet', L('尚未绑定工作区', 'No workspace bound'), L('绑定工作区后，记忆会按确认状态显示在这里。', 'Once a workspace is bound, memories show up here with their confirmation status.'))),
          },
          {
            id: 'digest', cat: 'work', tone: 'green', icon: 'pulse', title: ['定时任务', 'Scheduled tasks'], sub: ['时间 + Skill · 晨报与复盘预设', 'Time + skill · digest presets'], action: ['管理定时任务', 'Manage plans'],
            tier: ({ extra }) => extra._errors?.plans ? 'error' : extra.plans?.total === undefined ? 'unchecked' : extra.plans.blocked || extra.plans.timingError ? 'warn' : 'ok',
            body: ({ extra, tz }) => {
              const plans = extra.plans;
              return plans?.total !== undefined ? h('div', null, capKpi([[plans.enabled, L('启用', 'Enabled')], [plans.paused, L('暂停', 'Paused')], [plans.blocked, L('需处理', 'Needs attention')]]),
                capLine(L('下次运行', 'Next run'), plans.next ? plans.next.title + ' · ' + date(plans.next.at, tz) : L('暂无已核验触发时间', 'No verified occurrence')))
                : h('p', { className: 'pa24-meta' }, extra._errors?.plans || L('正在读取计划统计…', 'Reading plan statistics…'));
            },
            detail: helpers => h(TaskPlansDetail, { key: helpers.state.workspaceBinding, ...helpers }),
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
              if (!wecomChannelsOn(config) || !state.wecom) return 'unchecked';
              if (state.wecom.cli?.state !== 'ok' || state.wecom.identity?.state !== 'ok') return 'error';
              const states = (state.wecom.services || []).map(s => s.state);
              if (states.includes('error') || states.includes('unavailable')) return 'error';
              if (states.some(s => ['unauthorized', 'expired'].includes(s))) return 'warn';
              if (states.some(s => s === 'unverified')) return 'unchecked';
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
            detail: helpers => h(ConfigFormDetail, { key: helpers.state.workspaceBinding, helpers }),
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
        const CARD_ORDER = ['skills', 'work', 'reminders', 'digest', 'activity', 'review', 'memory', 'feishu', 'wecom', 'qwennote', 'wiki', 'workspace', 'config', 'healthcheck', 'budget', 'storage'];
        CARDS.sort((a, b) => CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id));
        const ACCESS_CARD_IDS = new Set(['feishu', 'wecom', 'qwennote', 'wiki']);

        // 二级详情：全应用健康检查——聚合结论＋运行就绪＋能力健康报告。
        function HealthReportDetail({ helpers }) {
          const { state } = helpers;
          const a = healthAggregate(helpers);
          const last = lastActiveCheck(state);
          const nextSteps = [...new Set([...(state.diagnostics?.nextSteps ?? []), ...(state.wecom?.nextSteps ?? [])])];
          return h('div', null,
            h(ConnectionEvidence, { state, openRepair: helpers.openRepair }),
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
        function SourceSettings({ helpers }) {
          const binding = helpers.state.workspaceBinding;
          const [data, setData] = React.useState(null), [draft, setDraft] = React.useState(null), [baseline, setBaseline] = React.useState(null);
          const [busy, setBusy] = React.useState(false), [feedback, setFeedback] = React.useState(null), [failure, setFailure] = React.useState(null);
          const epoch = React.useRef(0), currentBinding = React.useRef(binding); currentBinding.current = binding;
          const load = async (adopt = false) => {
            const request = ++epoch.current;
            try {
              const value = await rpc('sources', { workspaceBinding: binding });
              if (request !== epoch.current || binding !== currentBinding.current) return;
              setData(value); setFailure(null);
              if (adopt) { setDraft(JSON.parse(JSON.stringify(value.config))); setBaseline({ config: JSON.stringify(value.config), hash: value.configHash }); }
            } catch (error) { if (request === epoch.current && binding === currentBinding.current) setFailure(error.message || String(error)); }
          };
          React.useEffect(() => { load(true); return () => { epoch.current++; }; }, [binding]);
          const dirty = !!draft && (JSON.stringify(draft) !== baseline?.config || data?.legacy);
          const update = patch => { setDraft(value => ({ ...value, ...patch })); setFeedback(null); };
          const edit = (id, patch) => { setDraft(value => ({ ...value, entries: value.entries.map(row => row.id === id ? { ...row, ...patch } : row) })); setFeedback(null); };
          const input = (label, value, change, props = {}) => h('label', { className: 'pa24-field' }, label,
            h('input', { value, onChange: event => change(event.target.value), ...props }));
          const select = (label, value, change, options) => h('label', { className: 'pa24-field' }, label,
            h('select', { value, onChange: event => change(event.target.value) }, options.map(([key, title]) => h('option', { key, value: key }, title))));
          const platformLabel = value => value === 'wecom' ? L('企业微信', 'WeCom') : L('飞书', 'Feishu');
          const domainLabel = value => value === 'calendar' ? L('日历', 'Calendar') : L('待办', 'Todo');
          const capabilityLabel = value => ({ allowed: L('当前范围允许，实际结果看回执', 'Allowed in current scope; result needs receipt'), attemptable: L('可按明确授权尝试，写权限待核验', 'May attempt an authorized request; write permission unverified'), denied: L('无权', 'Denied'), adapter_unavailable: L('接入方式待完善', 'Adapter unavailable'), unknown: L('待核验', 'Unverified') })[value] || L('待核验', 'Unverified');
          const add = domain => {
            const id = 'source-' + crypto.randomUUID();
            update({ entries: [...draft.entries, { id, domain, platform: 'feishu', name: '', purpose: 'personal', ownerId: helpers.config?.ownerOpenId || '', resourceKind: domain === 'calendar' ? 'calendar' : 'tasklist', resourceId: '', filter: domain === 'calendar' ? 'all' : 'responsible', access: 'readwrite', enabled: true }] });
          };
          const remove = id => update({ entries: draft.entries.filter(row => row.id !== id), mappings: draft.mappings.filter(row => row.sourceId !== id),
            defaults: Object.fromEntries(Object.entries(draft.defaults).map(([kind, value]) => [kind, value === id ? null : value])) });
          const run = async action => {
            setBusy(true); setFeedback(null);
            try { await action(); }
            catch (error) { if (binding === currentBinding.current) setFeedback({ ok: false, message: error.message || String(error) }); }
            finally { if (binding === currentBinding.current) setBusy(false); }
          };
          const check = id => run(async () => {
            await rpc('action', { type: 'source.check', sourceId: id, workspaceBinding: binding });
            await load(false);
            if (binding === currentBinding.current) setFeedback({ ok: true, message: L('只读检查已结束，请查看该来源的身份、能力和核验时间。', 'Read-only check finished; inspect identity, capabilities and time below.') });
          });
          const save = () => run(async () => {
            await rpc('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { sources: draft }, expectedSourcesHash: baseline.hash });
            await load(true); await helpers.refresh().catch(() => {});
            if (binding === currentBinding.current) setFeedback({ ok: true, message: L('来源已保存并重载；新登记或变更的范围需要只读检查。', 'Sources saved and reloaded; check new or changed scopes.') });
          });
          return h('section', { id: 'pa24-sources', tabIndex: -1, className: 'pa24-card pa24-sources' },
            sectionHead('calendar', L('日历与待办来源', 'Calendar & todo sources'), L('登记需要查询和使用的资源。默认来源仅用于创建；查询覆盖全部启用来源。', 'Register the resources you use. Defaults select creation targets; queries cover all enabled sources.')),
            h('p', { className: 'pa24-helper' }, L('日历和待办均按已登记来源查询与办理。创建时使用明确指定或唯一匹配的来源；修改、完成和取消沿原对象办理。', 'Calendars and todos use registered sources. Creation uses the explicitly selected or uniquely matched source; changes, completion and cancellation retain the original object.')),
            failure && h('div', { role: 'alert', className: 'pa24-error' }, failure, h('button', { type: 'button', onClick: () => load(!draft) }, L('重试读取', 'Retry'))),
            !draft && !failure && h('p', { role: 'status' }, L('正在读取来源…', 'Loading sources…')),
            draft && h('fieldset', { disabled: busy, style: { border: 0, padding: 0, margin: 0, minWidth: 0 } },
              data.legacy && h('p', { className: 'pa24-helper' }, L('已按原配置准备迁移候选。保存保留旧对象和关联，不创建远端日历或待办。身份与真实资源请逐项检查。', 'Migration candidates preserve existing objects and links without creating remote resources. Check identity and resources individually.')),
              h('div', { className: 'pa24-actions' }, h('button', { type: 'button', onClick: () => add('calendar') }, L('添加日历来源', 'Add calendar')), h('button', { type: 'button', onClick: () => add('todo') }, L('添加待办来源', 'Add todo source'))),
              draft.entries.length === 0 && h('p', { className: 'pa24-helper' }, L('尚未登记来源；保存空列表会移除原登记，不恢复旧默认。', 'No sources registered. Saving this empty list removes registrations and keeps defaults empty.')),
              draft.entries.map(source => {
                const saved = data.entries.find(row => row.id === source.id), evidence = saved?.evidence;
                const unchanged = saved && JSON.stringify(Object.fromEntries(Object.keys(source).map(key => [key, saved[key]]))) === JSON.stringify(source);
                return h('article', { key: source.id, className: 'pa24-job' },
                  h('h3', null, domainLabel(source.domain), ' · ', source.name || L('新来源', 'New source')),
                  h('div', { className: 'pa24-source-fields' },
                    input(L('来源名称', 'Name'), source.name, name => edit(source.id, { name })),
                    select(L('平台', 'Platform'), source.platform, platform => edit(source.id, { platform, ownerId: platform === 'feishu' ? helpers.config?.ownerOpenId || '' : '', resourceKind: platform === 'wecom' ? 'authorized_scope' : source.domain === 'calendar' ? 'calendar' : 'tasklist', resourceId: platform === 'wecom' ? 'authorized' : '' }), [['feishu', platformLabel('feishu')], ['wecom', platformLabel('wecom')]]),
                    select(L('用途', 'Purpose'), source.purpose, purpose => edit(source.id, { purpose, filter: purpose !== 'personal' ? source.domain === 'calendar' ? 'involved' : 'responsible' : source.filter }), [['personal', L('个人', 'Personal')], ['company', L('公司', 'Company')], ['project', L('项目', 'Project')]]),
                    select(L('使用范围', 'Access requested'), source.access, access => edit(source.id, { access }), [['read', L('只读', 'Read')], ['readwrite', L('读取与写入', 'Read & write')]]),
                    input(L('授权本人标识', 'Authorized owner ID'), source.ownerId, ownerId => edit(source.id, { ownerId }), { placeholder: L('检查后核对实际身份', 'Verify with the access check') }),
                    select(L('资源类型', 'Resource kind'), source.resourceKind, resourceKind => edit(source.id, { resourceKind, resourceId: resourceKind === 'authorized_scope' ? 'authorized' : '' }), [[source.domain === 'calendar' ? 'calendar' : 'tasklist', source.domain === 'calendar' ? L('具体日历', 'Calendar container') : L('具体待办清单', 'Task list')], ['authorized_scope', L('当前授权范围', 'Authorized scope')]]),
                    input(L('资源标识', 'Resource ID'), source.resourceId, resourceId => edit(source.id, { resourceId }), { readOnly: source.resourceKind === 'authorized_scope' }),
                    select(L('默认筛选', 'Default filter'), source.filter, filter => edit(source.id, { filter }), [['all', L('全部授权可见', 'All authorized items')], [source.domain === 'calendar' ? 'involved' : 'responsible', source.domain === 'calendar' ? L('本人参与或组织', 'Participating or organizing') : L('本人负责', 'Assigned to me')]])),
                  source.platform === 'wecom' && h('p', { className: 'pa24-meta' }, L('授权范围不是独立日历容器。具体公司或项目日历须由相应接口验证；不能靠名称模拟。', 'An authorized scope is not a calendar container. Company/project calendars require matching API verification.')),
                  h('div', { className: 'pa24-actions' },
                    h('label', { className: 'pa24-check' }, h('input', { type: 'checkbox', checked: source.enabled, onChange: event => edit(source.id, { enabled: event.target.checked }) }), L('启用来源', 'Enable source')),
                    h('button', { type: 'button', disabled: !unchanged || !source.enabled, onClick: () => check(source.id) }, L('只读检查', 'Check access')),
                    h('button', { type: 'button', onClick: () => remove(source.id) }, L('移除登记', 'Remove registration'))),
                  !unchanged && h('p', { className: 'pa24-meta' }, L('有未保存修改；先保存来源再检查。', 'Save the source before checking changes.')),
                  evidence && unchanged ? h('div', { className: evidence.state === 'failed' ? 'pa24-error' : 'pa24-helper' },
                    h('p', null, evidence.message),
                    fields([[L('实际身份', 'Verified identity'), evidence.identity ? evidence.identity.ownerId + ' · ' + evidence.identity.authority : L('未核验', 'Unverified')],
                      [L('实际资源', 'Resolved resource'), evidence.resource?.id || L('待解析', 'Unresolved')], [L('读取', 'Read'), capabilityLabel(evidence.capabilities?.read)], [L('创建', 'Create'), capabilityLabel(evidence.capabilities?.create)], [L('核验时间', 'Checked at'), date(evidence.checkedAt, helpers.tz)]]))
                    : h('p', { className: 'pa24-meta' }, L('待核验；登记本身不授予平台权限。', 'Unverified. Registration does not grant platform permissions.')));
              }),
              h('h3', null, L('默认创建与会议时长', 'Creation defaults & meeting duration')),
              h('div', { className: 'pa24-source-fields' }, ...['calendar', 'todo'].map(domain => select(domainLabel(domain) + L('默认来源', ' default'), draft.defaults[domain] || '', value => update({ defaults: { ...draft.defaults, [domain]: value || null } }), [['', L('每次明确目标', 'Ask each time')], ...draft.entries.filter(row => row.domain === domain).map(row => [row.id, row.name || row.id])])),
                input(L('默认会议时长（分钟，留空则补问）', 'Meeting duration (minutes; blank to ask)'), draft.meetingDurationMinutes ?? '', value => update({ meetingDurationMinutes: value === '' ? null : Number(value) }), { type: 'number', min: 1, max: 1440 })),
              h('h3', null, L('公司／项目对应关系', 'Company / project mappings')),
              draft.mappings.map((mapping, index) => h('div', { key: index, className: 'pa24-source-fields' },
                select(L('领域', 'Domain'), mapping.domain, domain => update({ mappings: draft.mappings.map((row, i) => i === index ? { ...row, domain, sourceId: '' } : row) }), [['calendar', domainLabel('calendar')], ['todo', domainLabel('todo')]]),
                select(L('对应类型', 'Mapping type'), mapping.kind, kind => update({ mappings: draft.mappings.map((row, i) => i === index ? { ...row, kind } : row) }), [['company', L('公司', 'Company')], ['project', L('项目', 'Project')]]),
                input(L('公司或项目名称', 'Company or project name'), mapping.name, name => update({ mappings: draft.mappings.map((row, i) => i === index ? { ...row, name } : row) })),
                select(L('写入来源', 'Write target'), mapping.sourceId, sourceId => update({ mappings: draft.mappings.map((row, i) => i === index ? { ...row, sourceId } : row) }), [['', L('请选择', 'Choose')], ...draft.entries.filter(row => row.domain === mapping.domain).map(row => [row.id, row.name || row.id])]),
                h('button', { type: 'button', onClick: () => update({ mappings: draft.mappings.filter((_row, i) => i !== index) }) }, L('移除对应关系', 'Remove mapping')))),
              h('button', { type: 'button', onClick: () => update({ mappings: [...draft.mappings, { domain: 'calendar', kind: 'project', name: '', sourceId: '' }] }) }, L('添加对应关系', 'Add mapping')),
              h('p', { className: 'pa24-meta' }, L('明确来源优先于对应关系和默认值。移除登记保留远端对象与历史；未保存的修改不生效。', 'Explicit sources override mappings and defaults. Removing a registration preserves remote objects and history; unsaved edits do not apply.')),
              h('div', { className: 'pa24-source-save' },
                h('button', { type: 'button', className: 'pa24-primary', disabled: !dirty, onClick: save }, busy ? L('处理中…', 'Working…') : L('保存来源并重载', 'Save & reload sources')),
                feedback && h('p', { role: feedback.ok ? 'status' : 'alert', className: feedback.ok ? 'pa24-helper' : 'pa24-error' }, feedback.message),
                dirty && h('p', { className: 'pa24-meta' }, L('来源修改通过此按钮单独保存。', 'Save source changes with this button.')))));
        }

        function ConfigurationEvidence({ state }) {
          const binding = state.workspaceBinding, [view, setView] = React.useState({ data: null, error: '' }), [tick, setTick] = React.useState(0);
          React.useEffect(() => { let live = true; setView({ data: null, error: '' });
            void rpc('workspace.evidence', { workspaceBinding: binding }).then(data => { if (live) setView({ data, error: '' }); }).catch(error => { if (live) setView({ data: null, error: error.message }); });
            return () => { live = false; };
          }, [binding, state.workspace?.sourceHash, tick]);
          return h('section', { className: 'pa24-card' }, sectionHead('folder', L('配置来源与生效', 'Saved and active configuration'), L('源文件保存成功和运行时生效分别核验。', 'Saved source and active runtime are verified separately.'),
            h('button', { type: 'button', className: 'pa24-quiet', onClick: () => setTick(value => value + 1) }, icon('refresh'), L('读取配置状态', 'Read configuration status'))),
            view.error && h('p', { className: 'pa24-error', role: 'alert' }, view.error), !view.data && !view.error && h('p', { role: 'status' }, L('正在读取配置来源…', 'Reading configuration source…')),
            view.data && h('div', null, fields([
              [L('当前状态', 'State'), { applied: L('已保存并生效', 'Saved and active'), saved_not_applied: L('源文件已有更新，尚未生效', 'Saved changes are not active'), source_error: L('源文件读取失败，旧配置仍生效', 'Source read failed; prior config remains active') }[view.data.state]],
              [L('源文件版本', 'Saved version'), view.data.savedHash?.slice(0, 16) || L('无法读取', 'Unavailable')], [L('生效版本', 'Active version'), view.data.activeHash?.slice(0, 16)],
              [L('生效时间', 'Loaded at'), date(view.data.loadedAt, tzOf(state))], [L('进行中交办', 'Active work'), view.data.impacts?.work], [L('待发或未知投递', 'Pending or unknown deliveries'), view.data.impacts?.outbox], [L('待审版本', 'Pending reviews'), view.data.impacts?.reviews],
            ]), view.data.error && h('p', { role: 'alert', className: 'pa24-error' }, view.data.error), h('p', { className: 'pa24-meta' }, view.data.message)));
        }

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
            diagnosticRetentionDays: config?.diagnosticRetentionDays ?? 90,
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
          const configHash = React.useRef(state.workspace?.sourceHash);
          const liveBinding = React.useRef(state.workspaceBinding); liveBinding.current = state.workspaceBinding;
          React.useEffect(() => () => { liveBinding.current = null; }, []);
          const [saveState, setSaveState] = React.useState(null);
          React.useEffect(() => {
            const field = helpers.repairContext?.field;
            if (!field) return;
            const node = field === 'sources' ? document.getElementById('pa24-sources') : [...document.querySelectorAll('label')].find(label => label.textContent.includes(`（${field}）`))?.control;
            node?.scrollIntoView?.({ block: 'center' }); node?.focus?.();
          }, [helpers.repairContext]);
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
                maxWorkers: Number(form.maxWorkers), diagnosticRetentionDays: Number(form.diagnosticRetentionDays), enabledWorkers: form.enabledWorkers, workerModels: models, extraLocalTools: extra, extraBusinessSkills: skills,
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
            const ownerBinding = state.workspaceBinding;
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
              const saved = Object.keys(patch).length ? await rpc('action', { type: 'workspace.config-update', config: patch, workspaceBinding: ownerBinding, expectedConfigHash: configHash.current }) : state;
              if (liveBinding.current !== ownerBinding) return;
              configHash.current = saved.workspace.sourceHash;
              adoptSaved(saved.workspace.config);
              await helpers.refresh().catch(() => {});
              setSaveState({ ok: true, message: L('已保存并重载生效。', 'Saved and reloaded.') });
            } catch (e) { if (liveBinding.current === ownerBinding) setSaveState({ ok: false, message: (e && e.message) || String(e) }); }
            finally { if (liveBinding.current === ownerBinding) setBusy(false); }
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
            configHash.current = state.workspace?.sourceHash;
            adoptSaved(config);
            setSecretDraft({});
            setSecretClears({});
            setSaveState(null);
          };
          const saveSecrets = async () => {
            const ownerBinding = state.workspaceBinding;
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
              await rpc('action', { type: 'workspace.secret-update', values, workspaceBinding: ownerBinding });
              if (liveBinding.current !== ownerBinding) return;
              setSecretDraft({}); setSecretClears({});
              await helpers.refresh().catch(() => {});
              if (liveBinding.current === ownerBinding) setSaveState({ ok: true, message: L('密钥已保存到工作区密钥库。', 'Secrets saved to the workspace store.') });
            } catch (e) { if (liveBinding.current === ownerBinding) setSaveState({ ok: false, message: (e && e.message) || String(e) }); }
            finally { if (liveBinding.current === ownerBinding) setBusy(false); }
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
            helpers.repairContext && h('section', { className: 'pa24-card', 'aria-label': L('修复上下文', 'Repair context') },
              h('h2', null, L('本次修复依据', 'Repair evidence')), h('p', null, helpers.repairContext.message),
              h('p', { className: 'pa24-meta' }, L('定位字段：', 'Field: ') + helpers.repairContext.field + ' · ' + L('诊断配置：', 'Diagnostic config: ') + helpers.repairContext.configVersion?.slice(0, 16)),
              h('p', null, helpers.repairContext.impact), helpers.repairContext.nextSteps.map((step, index) => h('p', { key: index }, step)),
              h('button', { type: 'button', disabled: busy, onClick: () => void helpers.run(async () => {
                const scope = helpers.repairContext.scope.startsWith('source:') ? 'sources' : helpers.repairContext.scope.split('.')[0];
                await rpc('action', { type: 'health.check', workspaceBinding: state.workspaceBinding, scopes: [scope] }); await helpers.refresh(); helpers.openCard('healthcheck');
              }) }, L('修复后只读重验', 'Recheck after repair'))),
            h(ConfigurationEvidence, { state }),
            h(SourceSettings, { key: state.workspaceBinding, helpers }),
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
              row(L('推送渠道（notifyChannel）', 'Push channel (notifyChannel)'), sel([['feishu', L('飞书', 'Feishu')], ['wecom', L('企微', 'WeCom')]], form.notifyChannel, v => set('notifyChannel', v)), L('智能跟进与汇报的推送出口；时钟提醒使用日历渠道。企微为单向推送，收信仍在飞书。', 'Agent follow-up and digest outlet; clock reminders use the calendar channel. WeCom is outbound only.'))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('飞书资源', 'Feishu resources')),
              row(L('飞书文件夹（folderToken）', 'Feishu folder (folderToken)'), txt(form.folderToken, v => set('folderToken', v), { onBlur: e => set('folderToken', extractToken(e.target.value)), placeholder: L('粘贴文件夹链接或 token', 'Paste folder link or token') })),
              row(L('知识库节点（wikiNodeToken，可选）', 'Wiki node (wikiNodeToken, optional)'), txt(form.wikiNodeToken, v => set('wikiNodeToken', v), { onBlur: e => set('wikiNodeToken', extractToken(e.target.value)), placeholder: L('粘贴知识库节点链接或 token，留空回退文件夹', 'Paste wiki node link or token; empty falls back to the folder') }), L('已配置时备忘与手写待审文档建到该节点下；留空沿用 folderToken。', 'When set, memos and pending review docs land under this node; empty keeps folderToken.')),
              row(L('任务清单（tasklistId）', 'Task list (tasklistId)'), txt(form.tasklistId, v => set('tasklistId', v), { onBlur: e => set('tasklistId', extractToken(e.target.value)), placeholder: L('粘贴任务清单链接或 guid', 'Paste task-list link or guid') })),
              row(L('日历（calendarId）', 'Calendar (calendarId)'), txt(form.calendarId, v => set('calendarId', v), { placeholder: 'primary' }), L('默认 primary（本人日历）。', 'Defaults to primary (your calendar).'))),
            h('section', { className: 'pa24-card' },
              h('h2', null, L('运行参数', 'Runtime')),
              row(L('并发数（maxWorkers）', 'Parallelism (maxWorkers)'), h('input', { type: 'number', min: 1, max: 8, step: 1, value: form.maxWorkers, onChange: e => set('maxWorkers', e.target.value) }), L('1–8 的整数。', 'An integer from 1 to 8.')),
              row(L('详细诊断保留天数（diagnosticRetentionDays）', 'Diagnostic retention (days)'), h('input', { type: 'number', min: 1, max: 3650, step: 1, value: form.diagnosticRetentionDays, onChange: e => set('diagnosticRetentionDays', e.target.value) }), L('默认 90 天；仅清理技术诊断，运行快照、结果和动作回执长期保留。', 'Default: 90 days. Snapshots, results and action receipts remain.')),
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
          const [repairContext, setRepairContext] = React.useState(null);
          const [refreshing, setRefreshing] = React.useState(false), [lastRefreshAt, setLastRefreshAt] = React.useState(null);
          // F34: 管理态 Esc 可退（与「完成」等效）；隐藏动作给一条轻反馈，
          // 说明去哪恢复——不留悬念也不打断（无确认弹窗）。
          const [hideNote, setHideNote] = React.useState('');
          const hideNoteTimer = React.useRef(null);
          const formDirty = React.useRef(false);
          const planStates = React.useRef(new Map());
          React.useEffect(() => () => clearTimeout(hideNoteTimer.current), []);
          React.useEffect(() => {
            if (!manage) return undefined;
            const onKey = e => { if (e.key === 'Escape') setManage(false); };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
          }, [manage]);
          const main = React.useRef(null);
          const snapshotSequence = React.useRef(0);
          const refresh = async () => {
            setRefreshing(true);
            const sequence = ++snapshotSequence.current;
            try {
              const s = await rpc('snapshot');
              if (sequence === snapshotSequence.current) { setState(s); setConnError(''); setExtraTick(v => v + 1); setLastRefreshAt(new Date().toISOString()); }
              return s;
            } catch (failure) {
              if (sequence === snapshotSequence.current) setConnError(failure.message);
              throw failure;
            } finally { setRefreshing(false); }
          };
          React.useEffect(() => {
            let live = true, pending = false;
            const load = async () => {
              if (pending) return;
              pending = true;
              const sequence = ++snapshotSequence.current;
              try { const s = await rpc('snapshot'); if (live && sequence === snapshotSequence.current) { setState(s); setConnError(''); } }
              catch (e) { if (live && sequence === snapshotSequence.current) setConnError(e.message); }
              finally { pending = false; }
            };
            void load(); const timer = setInterval(() => void load(), 2500);
            return () => { live = false; clearInterval(timer); };
          }, []);
          const { busy, error, run, button } = usePanelActions();
          const extra = useExtra(state ? (state.workspace ? state.workspace.path : '') : '', extraTick, state?.workspaceBinding);
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
          const openRepair = row => {
            const fields = { 'feishu.application': 'feishuAppId', 'feishu.resource:folder': 'folderToken', 'feishu.resource:wiki': 'wikiNodeToken', 'feishu.resource:tasklist': 'tasklistId', 'feishu.resource:calendar': 'calendarId', 'wecom.push': 'notifyChannel', voice: 'tts.engine', models: 'workerModels', materials: 'extraLocalTools' };
            const field = row.scope.startsWith('source:') || row.scope === 'sources' || row.scope.startsWith('wecom.') && row.scope !== 'wecom.push' ? 'sources' : fields[row.scope] || (row.scope.startsWith('feishu') ? 'larkProfile' : 'mode');
            setRepairContext({ ...row, field, binding: state.workspaceBinding }); openCard('config');
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
            await rpc('action', { type: 'health.check', workspaceBinding: state.workspaceBinding });
            await refresh();
          };
          const openRuns = filters => {
            planRowState(planStates.current, 'run-history:' + state.workspaceBinding, {}).update({ filters: { kind: 'runs', range: '7', includeUnresolved: true, ...filters }, offset: 0, selectedRun: null, workId: null }); openCard('activity');
          };
          const openPlan = id => { planRowState(planStates.current, 'task-manager:' + state.workspaceBinding, {}).update({ selected: id, form: null, preview: null }); openCard('digest'); };
          const helpers = { state, extra, workspace, config, tz, planStates: planStates.current, busy, button, run, runFullCheck, refresh, openCard, openRuns, openPlan, openRepair, repairContext: repairContext?.binding === state.workspaceBinding ? repairContext : null, setFormDirty: value => { formDirty.current = value; }, openRobot: chatWithRobot };
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
        function WecomView({ state, busy, button, openRobot, openRepair }) {
          const wecom = state.wecom;
          const workspace = state.workspace, config = workspace ? workspace.config : null, tz = tzOf(state);
          const channelBadge = value => value === 'wecom' ? badge(L('企微', 'WeCom'), 'neutral', 'bot') : badge(L('飞书', 'Feishu'), 'neutral', 'plug');
          const serviceMeta = { calendar: L('日程', 'Calendar'), todo: L('待办', 'Todo'), push: L('推送', 'Push') };
          const serviceBadge = s => statusBadge(
            { ok: 'ok', unauthorized: 'missing', expired: 'warn', unavailable: 'error', error: 'error', skipped: 'unchecked' }[s.state] || 'unchecked',
            { unauthorized: L('未授权', 'Unauthorized'), expired: L('已过期', 'Expired'), unavailable: L('企业不可用', 'Enterprise unavailable'), error: L('异常', 'Error'), skipped: L('未启用', 'Not enabled'), unverified: L('未验证', 'Unverified') }[s.state]);
          return h('div', { className: 'pa24-grid' },
            h(ConnectionEvidence, { state, platform: 'wecom', openRepair }),
            h('section', { className: 'pa24-card' },
                sectionHead('bot', L('企微接入', 'WeCom access'), L('日程/待办第二操作渠道与提醒单向推送（不做收信，飞书保持唯一交互入口）。', 'A second operation channel for calendar/todo plus one-way reminder push (no inbound; Feishu stays the only interaction entry).'),
                  h('div', { className: 'pa24-row' },
                    button('refresh', busy ? L('检查中…', 'Checking…') : L('检查企微接入', 'Check WeCom access'), () => rpc('action', { type: 'health.check', scopes: ['wecom'], workspaceBinding: state.workspaceBinding })),
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
