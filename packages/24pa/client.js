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
      calendarClock: ['M8 2v4m8-4v4M3 9h13M5 4h14a2 2 0 0 1 2 2v6', 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', 'M17 14.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM17 16v2l1.5 1.5'],
      plus: ['M12 5v14M5 12h14'],
      sunrise: ['M12 2v4M4.93 6.93l1.42 1.42M2 16h2m16 0h2M17.66 8.35l1.41-1.42M8 16a4 4 0 0 1 8 0M2 20h22'],
      sunset: ['M12 6V2M4.93 10.93l1.42 1.42M2 16h2m16 0h2M17.66 12.35l1.41-1.42M8 16a4 4 0 0 1 8 0M2 20h22'],
      calendarRange: ['M3 4h18v17H3ZM8 2v4m8-4v4M3 9h18M7 13h4m2 0h4M7 17h2m6 0h2'],
      play: ['m8 5 11 7-11 7Z'],
      pause: ['M9 5v14M15 5v14'],
      history: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5M12 7v5l3 2'],
      search: ['M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
      filter: ['M4 5h16M7 12h10m-7 7h4'],
      refresh: ['M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5'],
      check: ['m5 12 4 4L19 6'],
      clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2'],
      info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v.1'],
      alert: ['m12 3 10 18H2ZM12 9v5m0 3v.1'],
      shield: ['m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z', 'm8 11 3 3 5-5'],
      code: ['m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18'],
      blocks: ['M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z'],
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
      .pa24 button:hover:not(:disabled){background:var(--pa-soft);border-color:var(--pa-muted)}.pa24 button:disabled{opacity:.45;cursor:not-allowed}.pa24 button.pa24-primary{background:var(--pa-blue);color:#fff;border-color:var(--pa-blue)}.pa24 button.pa24-primary:hover:not(:disabled){background:color-mix(in srgb,var(--pa-blue) 90%,#000);border-color:var(--pa-blue)}body[data-ds-dark-theme] .pa24 button.pa24-primary{color:#172c27}
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
      .pa24-skill-layout{display:grid;grid-template-columns:minmax(350px,380px) minmax(0,1fr);gap:16px;align-items:start}.pa24-skill-layout>.pa24-card{margin:0}.pa24-skill-catalog{min-width:0;padding:12px}.pa24-skill-detail{min-width:0;padding:18px}.pa24-skill-filters{display:grid;grid-template-columns:minmax(0,1fr) 124px;gap:8px;margin:12px 0}.pa24-skill-filters label{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:11px;color:var(--pa-muted)}.pa24-skill-filters input,.pa24-skill-filters select{min-height:36px;padding:6px 8px;font-size:12px}.pa24-skill-list{display:grid;grid-template-columns:minmax(0,1fr);gap:3px;max-height:calc(100vh - 280px);overflow:auto;padding:2px;margin-top:8px}.pa24 button.pa24-skill-row{display:block;width:100%;min-height:58px;padding:7px 9px;text-align:left;border-color:transparent;background:transparent;border-radius:9px}.pa24-skill-row[aria-pressed=true]{background:var(--pa-blue-bg);border-color:color-mix(in srgb,var(--pa-blue) 35%,var(--pa-line));box-shadow:inset 3px 0 0 var(--pa-blue)}.pa24-skill-row-head{display:flex;align-items:center;justify-content:space-between;gap:7px;min-width:0;max-width:100%;flex-wrap:wrap}.pa24-skill-row-title{display:flex;align-items:baseline;gap:6px;min-width:0;max-width:100%;flex:1 1 130px}.pa24-skill-row-title strong{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.pa24-skill-row-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pa-muted);font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}.pa24-skill-row-tags{display:flex;gap:4px;flex-shrink:0}.pa24-skill-tag{display:inline-block;padding:1px 5px;border-radius:5px;background:var(--pa-soft);color:var(--pa-muted);font-size:10px;line-height:1.6;white-space:nowrap}.pa24-skill-row-desc{display:block;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pa-muted);font-size:11px}.pa24-skill-row-error{display:block;margin-top:3px;color:var(--pa-danger);font-size:11px;overflow-wrap:anywhere}.pa24-skill-pagination{justify-content:center;margin-top:10px}.pa24-skill-actions{margin:14px 0}.pa24-skill-tabs{margin-top:14px}.pa24-skill-detail .pa24-empty{padding:28px 12px}.pa24-package-browser{min-width:0}.pa24-package-summary{margin:10px 0 0;color:var(--pa-muted);font-size:12px}.pa24-package-layout{display:grid;grid-template-columns:minmax(160px,220px) minmax(0,1fr);margin-top:12px;overflow:hidden;border:1px solid var(--pa-line);border-radius:10px}.pa24-package-tree{min-width:0;max-height:460px;overflow:auto;padding:6px;border-right:1px solid var(--pa-line);background:var(--pa-soft)}.pa24-package-tree ul{margin:0;padding:0;list-style:none}.pa24-package-tree li{margin:1px 0}.pa24-package-tree li ul{margin-left:10px;padding-left:5px;border-left:1px solid var(--pa-line)}.pa24-package-tree button{justify-content:flex-start;width:100%;min-height:30px;padding:4px 6px;border-color:transparent;border-radius:6px;background:transparent;font-size:11px;white-space:nowrap}.pa24-package-tree button[aria-current=true]{background:var(--pa-blue-bg);color:var(--pa-blue)}.pa24-package-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pa24-package-chevron{transition:transform .14s}.pa24-package-folder[aria-expanded=true] .pa24-package-chevron{transform:rotate(90deg)}.pa24-package-preview{min-width:0;padding:12px}.pa24-package-file-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.pa24-package-file-head>div{min-width:0}.pa24-package-file-head>button{flex-shrink:0;min-height:30px;padding:4px 7px}.pa24-package-path{font:600 11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;word-break:break-all}.pa24-package-preview pre{max-height:360px;white-space:pre;overflow:auto}.pa24-package-browser>.pa24-meta{margin-top:10px}
      .pa24-materials{min-width:0;overflow-wrap:anywhere}.pa24-material-field{display:flex;flex-direction:column;gap:6px;margin:12px 0;min-width:0;font-size:13px}.pa24-material-field:has(input[type=checkbox]){flex-direction:row;align-items:center}.pa24-material-field input:not([type=checkbox]),.pa24-material-field textarea,.pa24-material-field select{width:100%;min-width:0;max-width:100%;box-sizing:border-box;background:var(--pa-soft);color:var(--pa-ink);border:1px solid var(--pa-line);border-radius:8px;padding:8px;font:inherit}.pa24-material-field input[type=checkbox]{flex:0 0 18px;width:18px;height:18px;min-height:18px}.pa24-material-text{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:13px;max-width:100%}.pa24-original{max-width:100%;height:auto;display:block;margin:12px auto}.pa24-material-compare{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px;margin-top:16px}.pa24-material-main{min-width:0}.pa24-materials fieldset{min-width:0;padding:12px;border:1px solid var(--pa-line);border-radius:8px;margin:12px 0}.pa24-materials button{white-space:normal}.pa24-materials>.pa24-section-head{flex-wrap:wrap}.pa24-materials>.pa24-section-head>button{flex-shrink:0;white-space:nowrap}.pa24-materials .pa24-note{white-space:pre-wrap}.pa24-materials .pa24-row{flex-wrap:wrap}@container(max-width:760px){.pa24-material-compare{display:block}.pa24-original-side{display:none}}
      .pa24-form-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--pa-line)}.pa24-form-row:last-child{border-bottom:0}.pa24-form-row>label{font-size:12px;color:var(--pa-muted)}.pa24-form-row input[type=text],.pa24-form-row input[type=number],.pa24-form-row select{min-height:36px}
      .pa24-backups>.pa24-section-head{flex-wrap:wrap}.pa24-backups>.pa24-section-head>button{flex-shrink:0;white-space:nowrap}
      .pa24-health{min-width:0;overflow-wrap:anywhere}.pa24-health .pa24-example{display:block}.pa24-health .pa24-example .pa24-check{display:flex;margin:12px 0}.pa24-health .pa24-check input{flex:0 0 18px;width:18px;height:18px}.pa24-health select{max-width:100%}
      .pa24-check{display:inline-flex;align-items:center;gap:6px;margin:0 16px 0 0;font-size:13px;min-height:32px;cursor:pointer}.pa24-check input{width:15px;height:15px;min-height:0}
      .pa24-source-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:12px;margin:12px 0}.pa24-source-fields label{display:flex;flex-direction:column;gap:5px;min-width:0}.pa24-sources input,.pa24-sources select{max-width:100%;box-sizing:border-box}.pa24-sources .pa24-check input{width:18px;flex:0 0 18px}.pa24-source-save{position:sticky;bottom:72px;background:var(--pa-surface);border-top:1px solid var(--pa-line);padding:12px 0;margin-top:16px;z-index:2}.pa24-source-save p{margin:6px 0 0}.pa24-sources .pa24-job{overflow-wrap:anywhere}
      .pa24-calendar-detail{min-width:0;overflow-wrap:anywhere}.pa24-calendar-detail>.pa24-section-head{flex-wrap:wrap}.pa24-calendar-detail>.pa24-section-head>div{min-width:0}.pa24-calendar-detail .pa24-notice{margin:12px 0 16px}.pa24-calendar-detail .pa24-notice button{margin-top:10px}.pa24-calendar-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:0 0 16px}.pa24-calendar-metric{min-width:0;padding:13px 14px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-surface)}.pa24-calendar-metric>span,.pa24-calendar-metric>small{display:block;color:var(--pa-muted);font-size:11px}.pa24-calendar-metric>strong{display:block;margin:4px 0;font-size:22px;line-height:1.25;font-variant-numeric:tabular-nums}.pa24-calendar-next{display:flex;align-items:center;gap:16px;min-width:0;margin:0 0 16px;padding:16px 18px;border:1px solid var(--pa-line);border-left:3px solid var(--pa-blue);border-radius:14px;background:var(--pa-surface)}.pa24-calendar-next-time{display:flex;align-items:center;gap:8px;min-width:78px;color:var(--pa-blue);font-size:20px;font-weight:650;font-variant-numeric:tabular-nums}.pa24-calendar-next-body{flex:1;min-width:0}.pa24-calendar-next-body h3{margin:7px 0 4px;font-size:17px;overflow-wrap:anywhere}.pa24-calendar-next-empty{color:var(--pa-muted);border-left-color:var(--pa-line)}.pa24-calendar-next-empty h3{margin-bottom:4px}.pa24-calendar-layout{display:grid;grid-template-columns:minmax(0,1fr) 292px;gap:16px;align-items:start}.pa24-calendar-main{min-width:0}.pa24-calendar-timeline{padding:14px 16px}.pa24-calendar-toolbar{border-bottom:1px solid var(--pa-line);margin-bottom:2px}.pa24-calendar-toolbar .pa24-source-fields{grid-template-columns:repeat(2,minmax(0,1fr));margin:8px 0 12px}.pa24-date-navigation{display:grid;grid-template-columns:auto minmax(150px,1fr) auto auto;gap:8px;align-items:end}.pa24-date-navigation>button:first-child svg{transform:rotate(180deg)}.pa24-date-navigation label{display:flex;flex-direction:column;gap:5px;min-width:0;color:var(--pa-muted);font-size:12px}.pa24-agenda-row{display:grid;grid-template-columns:68px minmax(0,1fr);gap:14px;padding:15px 0;border-bottom:1px solid var(--pa-line)}.pa24-agenda-row:last-child{border-bottom:0}.pa24-agenda-time{padding-top:10px;text-align:right;font-size:13px;font-weight:650;font-variant-numeric:tabular-nums}.pa24-agenda-time small{display:block;margin-top:3px;color:var(--pa-muted);font-size:10px;font-weight:400}.pa24-event-card{min-width:0;padding:12px 14px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-soft)}.pa24-event-card>.pa24-row{align-items:flex-start}.pa24-event-card h3{min-width:0;overflow-wrap:anywhere}.pa24-event-card>.pa24-meta{margin-top:5px}.pa24-event-location{padding:10px 0 0;margin-top:10px;border-top:1px solid var(--pa-line)}.pa24-event-location>.pa24-row{gap:6px}.pa24-event-location .pa24-row:last-child{margin-top:7px}.pa24-event-location button,.pa24-event-location .pa24-link-button{min-height:32px;padding:5px 9px;font-size:12px}.pa24-calendar-page-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:14px}.pa24-calendar-page-footer button:first-child svg{transform:rotate(180deg)}.pa24-source-scope{margin:0;padding:15px 16px}.pa24-source-scope>div:first-child h3{display:flex;align-items:center;gap:7px}.pa24-source-scope>div:first-child svg{width:17px;height:17px}.pa24-source-evidence{padding:13px 0;border-top:1px solid var(--pa-line)}.pa24-source-evidence:first-of-type{margin-top:10px}.pa24-source-evidence:last-child{padding-bottom:0}.pa24-source-evidence .pa24-row{align-items:flex-start;gap:6px}.pa24-source-evidence strong{min-width:0;overflow-wrap:anywhere}.pa24-source-evidence p{margin-top:5px}.pa24-source-evidence button{min-height:32px;margin:5px 0 0 -8px;padding:4px 8px;font-size:12px}.pa24-source-reason{color:var(--pa-amber);font-size:12px;overflow-wrap:anywhere}.pa24-source-catalog-error{margin:12px 0;padding:10px;border:1px solid var(--pa-danger);border-radius:10px;color:var(--pa-danger);font-size:12px}.pa24-source-catalog-error button{margin-top:8px;min-height:32px;padding:4px 8px}.pa24-calendar-draft textarea{display:block;width:100%;max-width:100%;min-height:120px;margin:12px 0;padding:12px;resize:vertical;border:1px solid var(--pa-line);border-radius:10px;background:var(--pa-soft);color:var(--pa-ink);font:inherit;line-height:1.65}@container(max-width:880px){.pa24-calendar-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pa24-calendar-layout{grid-template-columns:minmax(0,1fr)}.pa24-source-scope{margin-bottom:16px}.pa24-source-evidence{display:inline-block;vertical-align:top;width:calc(50% - 12px);margin-right:20px}.pa24-source-evidence:nth-of-type(even){margin-right:0}}
      .pa24-form-actions{position:sticky;bottom:0;z-index:2;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;margin-top:16px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-surface);box-shadow:0 -4px 14px color-mix(in srgb,var(--pa-ink) 9%,transparent)}
      .pa24-plan-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.pa24-plan-metric{display:flex;align-items:flex-start;gap:10px;min-width:0;padding:12px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-surface)}.pa24-plan-metric strong{display:block;font-size:17px;line-height:1.35;font-variant-numeric:tabular-nums}.pa24-plan-metric small{display:block;margin-top:4px;color:var(--pa-muted);font-size:11px;line-height:1.5}.pa24-plan-metric .pa24-icon-tile{width:32px;height:32px;border-radius:9px}.pa24-plan-metric .pa24-icon-tile svg{width:16px;height:16px}
      .pa24-plan-list{padding:0 14px}.pa24-plan-row{display:grid;grid-template-columns:minmax(190px,1.4fr) minmax(145px,1fr) minmax(155px,1fr) minmax(92px,.55fr) minmax(170px,1.1fr);gap:12px;align-items:center;padding:13px 0;border-bottom:1px solid var(--pa-line)}.pa24-plan-row:last-child{border-bottom:0}.pa24-plan-row.pa24-plan-header{padding:8px 0;color:var(--pa-muted);font-size:11px}.pa24-plan-main{min-width:0}.pa24-plan-main>button{padding:0;min-height:0;border:0;background:transparent;color:var(--pa-blue);font-weight:650;text-align:left}.pa24-plan-cell{min-width:0;font-size:12px;overflow-wrap:anywhere}.pa24-plan-cell-label{display:block;margin-bottom:2px;color:var(--pa-muted);font-size:11px}
      .pa24-form-section{padding:2px 0 14px;margin-bottom:16px;border-bottom:1px solid var(--pa-line)}.pa24-form-section-title{display:flex;align-items:center;gap:8px;margin-bottom:10px}.pa24-form-section-title>svg{color:var(--pa-blue)}
      .pa24-history-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px}.pa24-history-metric{min-width:0;padding:13px 14px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-surface)}.pa24-history-metric strong{display:block;font-size:21px;line-height:1.3;font-variant-numeric:tabular-nums}.pa24-history-metric span{display:block;margin-top:3px;font-size:12px;font-weight:600}.pa24-history-metric small{display:block;margin-top:4px;color:var(--pa-muted);font-size:11px;line-height:1.5}.pa24-history-metric.primary{border-color:color-mix(in srgb,var(--pa-blue) 42%,var(--pa-line))}.pa24-history-metric.attention{border-color:color-mix(in srgb,var(--pa-amber) 55%,var(--pa-line));background:var(--pa-amber-bg)}.pa24-history-metric.danger{border-color:color-mix(in srgb,var(--pa-danger) 48%,var(--pa-line))}
      .pa24-history-toolbar{display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(135px,.65fr) minmax(150px,.75fr) auto;gap:10px;align-items:end;padding:14px;margin-bottom:12px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-surface)}.pa24-history-toolbar label.pa24-field{margin:0;font-size:11px;color:var(--pa-muted)}.pa24-history-toolbar .pa24-history-search{position:relative}.pa24-history-toolbar .pa24-history-search input{padding-left:36px}.pa24-history-toolbar .pa24-history-search>svg{position:absolute;left:11px;bottom:12px;width:17px;height:17px;color:var(--pa-muted)}.pa24-history-toolbar>button{white-space:nowrap;margin-bottom:1px}.pa24-history-custom{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 12px}.pa24-history-custom label{margin:0}.pa24-history-advanced{margin:0 0 16px;padding:14px;border:1px solid var(--pa-line);border-radius:12px;background:var(--pa-soft)}.pa24-history-advanced-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 12px}.pa24-history-advanced-grid label{margin:6px 0}.pa24-history-advanced-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;flex-wrap:wrap}.pa24-history-scope{margin:0 0 14px;color:var(--pa-muted);font-size:12px}
      .pa24-history-list{padding:0 16px}.pa24-history-row{display:grid;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--pa-line)}.pa24-history-row:last-child{border-bottom:0}.pa24-history-run-row{grid-template-columns:minmax(190px,1.45fr) minmax(140px,.85fr) minmax(140px,.9fr) minmax(108px,.6fr) minmax(108px,.6fr)}.pa24-history-work-row{grid-template-columns:minmax(200px,1.25fr) minmax(150px,.9fr) minmax(180px,1.1fr) minmax(110px,.6fr)}.pa24-history-event-row{grid-template-columns:minmax(200px,1.2fr) minmax(145px,.85fr) minmax(190px,1.2fr) minmax(100px,.55fr)}.pa24-history-header{padding:9px 0;color:var(--pa-muted);font-size:11px}.pa24-history-record-main{min-width:0}.pa24-history-record-main h3{overflow-wrap:anywhere}.pa24-history-record-main>button{display:block;max-width:100%;min-height:0;padding:0;border:0;border-radius:3px;background:transparent;color:var(--pa-ink);font-size:14px;font-weight:650;text-align:left;white-space:normal;overflow-wrap:anywhere}.pa24-history-record-main>button:hover:not(:disabled){border:0;background:transparent;color:var(--pa-blue);text-decoration:underline}.pa24-history-record-main .pa24-meta{margin-top:4px}.pa24-history-cell{min-width:0;font-size:12px;overflow-wrap:anywhere}.pa24-history-cell-label{display:block;margin-bottom:3px;color:var(--pa-muted);font-size:11px}.pa24-history-status{display:flex;align-items:flex-start;flex-direction:column;gap:5px}.pa24-history-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0 0;border-top:1px solid var(--pa-line);flex-wrap:wrap}.pa24-history-footer nav{display:flex;gap:8px}.pa24-history-compatibility{margin-top:16px}.pa24-history-compatibility>summary{font-size:13px;color:var(--pa-ink)}.pa24-history-compatibility-content{padding-top:12px}
      .pa24-drawer-backdrop{position:fixed;inset:0;z-index:1000;display:flex;justify-content:flex-end;background:rgb(15 23 42 / 38%)}.pa24-drawer{display:flex;flex-direction:column;width:min(780px,88vw);height:100vh;background:var(--pa-canvas);border-left:1px solid var(--pa-line);box-shadow:-18px 0 48px rgb(15 23 42 / 18%);color:var(--pa-ink)}.pa24-drawer-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:20px 22px 16px;border-bottom:1px solid var(--pa-line);background:var(--pa-surface)}.pa24-drawer-header>div{min-width:0}.pa24-drawer-header h2{font-size:18px;overflow-wrap:anywhere}.pa24-drawer-header p{margin-top:5px}.pa24-drawer-close{flex-shrink:0;width:40px;padding:8px!important}.pa24-drawer-tabs{display:flex;gap:6px;padding:10px 22px 0;border-bottom:1px solid var(--pa-line);background:var(--pa-surface)}.pa24-drawer-tabs button{border-radius:8px 8px 0 0;border-bottom-color:transparent;background:transparent;color:var(--pa-muted)}.pa24-drawer-tabs button[aria-selected=true]{color:var(--pa-blue);background:var(--pa-blue-bg)}.pa24-drawer-body{flex:1;min-height:0;overflow:auto;padding:20px 22px 32px;overscroll-behavior:contain}.pa24-drawer-body>.pa24-card{padding:0;border:0;background:transparent}.pa24-drawer-section{min-width:0}.pa24-drawer-section>h3{margin-bottom:12px}.pa24-drawer-work-runs{display:grid;gap:8px}.pa24-drawer-work-runs>button{justify-content:flex-start;text-align:left;white-space:normal}
      @container(max-width:900px){.pa24-history-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pa24-history-toolbar{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.pa24-history-advanced-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pa24-history-header{display:none}.pa24-history-run-row,.pa24-history-work-row,.pa24-history-event-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
      @container(max-width:880px){.pa24-plan-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.pa24-plan-row{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)}.pa24-plan-row.pa24-plan-header{display:none}}
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

        const materialEditors = new Map();
        const materialStatus = value => ({ collecting: ['收集中', 'Collecting'], collected: ['草稿待发布', 'Draft'], awaiting_review: ['待审核', 'Pending review'], pending_review: ['待审核', 'Pending review'], approved: ['已审核', 'Approved'], returned: ['已退回', 'Returned'], needs_rereview: ['需重新审核', 'Needs review'], stale: ['已失效', 'Stale'], superseded: ['历史版本', 'Historical'] }[value] || [value, value]);
        const MATERIAL_TABS = [['original','原稿与来源','Originals & source'],['recognition','识别结果','Recognition'],['draft','编辑草稿','Edit draft'],['version','冻结版本','Frozen version'],['actions','候选行动','Candidate actions']];
        const materialParameters = c => fields([
          [L('行动', 'Action'), c.summary], [L('来源原话', 'Source quote'), c.sourceQuote],
          [L('截止日期', 'Due date'), c.due], [L('日程开始', 'Event start'), c.start], [L('日程结束', 'Event end'), c.end],
          [L('目标来源', 'Target source'), c.sourceId], [L('公司', 'Company'), c.company], [L('项目', 'Project'), c.project],
          [L('负责人', 'Assignees'), c.assigneeIds?.length ? c.assigneeIds.join('、') : L('本人', 'Owner')],
          [L('待确认项', 'Uncertainties'), c.unknowns?.length ? c.unknowns.join('；') : undefined],
        ].filter(([, value]) => value !== undefined && value !== null && value !== ''));
        const materialObjectLink = value => {
          const url = value?.url || value?.docUrl || value?.receipt?.url || value?.receipt?.docUrl;
          return /^https?:\/\//.test(url || '') && h('a', { className: 'pa24-link-button', href: url, target: '_blank', rel: 'noreferrer' }, icon('external'), L('打开原对象', 'Open original object'));
        };
        function MaterialValue({ value }) {
          if (value === null || value === undefined || (Array.isArray(value) && !value.length)) return h('span', null, L('未设置', 'Not set'));
          if (Array.isArray(value)) return h('ol', null, value.map((entry, index) => h('li', { key: index }, h(MaterialValue, { value: entry }))));
          if (typeof value === 'object') {
            const labels = { pageNo: ['页码','Page'], transcript: ['转写','Transcript'], kind: ['类型','Type'], quote: ['原话','Quote'], certainty: ['定位依据','Location basis'], region: ['原稿区域','Original region'], note: ['疑点说明','Doubt'], description: ['说明','Description'], original: ['日期原话','Original date phrase'], interpretation: ['日期解释','Date interpretation'], x: ['横坐标','X'], y: ['纵坐标','Y'], w: ['宽度','Width'], h: ['高度','Height'] };
            return fields(Object.entries(value).filter(([key]) => key !== 'id').map(([key, entry]) => [labels[key] ? L(...labels[key]) : key, h(MaterialValue, { value: entry })]));
          }
          return h('pre', { className: 'pa24-material-text' }, String(value));
        }
        const materialReceipt = value => { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } };
        function MaterialFeedback({ value }) {
          if (typeof value === 'string') return h('p', { role: 'status', className: 'pa24-note' }, value);
          if (!value) return null;
          return h('section', { className: 'pa24-note', 'aria-label': L('资料操作结果', 'Material action result') },
            h('p', { role: 'status' }, value.message || value.error || L('操作已返回，详见结果。', 'Action returned; see the result.')), materialObjectLink(value),
            (value.results || []).map((row, index) => h('article', { key: index }, h('h4', null, L('候选 ', 'Candidate ') + ((row.index ?? index) + 1)),
              h('p', null, row.error || row.message || (row.changeProposal ? L('仅提出变更建议，尚未修改原对象。', 'Change proposed; original object unchanged.') : row.reused ? L('返回已有对象。', 'Existing object returned.') : row.ok ? L('已完成。', 'Completed.') : L('请核对回执。', 'Check the receipt.'))),
              materialObjectLink(row), row.changeProposal && h(React.Fragment, null,
                row.changeProposal.previous && h('section', null, h('h5', null, L('原参数', 'Previous parameters')), materialParameters(row.changeProposal.previous)),
                h('section', null, h('h5', null, L('建议参数（需另行授权）', 'Proposed parameters (separate authorization required)')), materialParameters(row.changeProposal.proposed))))),
            h('details', null, h('summary', null, L('完整操作回执', 'Full action receipt')), h('pre', { className: 'pa24-material-text' }, JSON.stringify(value, null, 2))));
        }
        function ReviewView({ workspace, binding, openRobot }) {
          const [query, setQuery] = React.useState(''), [status, setStatus] = React.useState('pending'), [offset, setOffset] = React.useState(0);
          const [list, setList] = React.useState({ data: null, key: '', error: '', busy: false }), [selected, setSelected] = React.useState(''), [versionId, setVersionId] = React.useState('');
          const [detail, setDetail] = React.useState(null), [detailError, setDetailError] = React.useState(''), [tick, setTick] = React.useState(0), [busy, setBusy] = React.useState(false), [feedback, setFeedback] = React.useState('');
          const [mode, setMode] = React.useState('draft'), [image, setImage] = React.useState(null), [imageError, setImageError] = React.useState(''), [preview, setPreview] = React.useState(false), [confirmed, setConfirmed] = React.useState(false);
          const [selection, setSelection] = React.useState([]), [instruction, setInstruction] = React.useState(''), [editTick, redraw] = React.useState(0);
          const epoch = React.useRef(0), detailEpoch = React.useRef(0), mounted = React.useRef(true);
          React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
          const limit = 20, key = JSON.stringify([binding, query, status, offset]);
          const editorKey = binding + ':' + selected, editor = materialEditors.get(editorKey);
          const button = (name, label, action, props = {}) => h('button', { type: 'button', disabled: busy, onClick: action, ...props }, icon(name), label);
          React.useEffect(() => {
            const abort = new AbortController(), seq = ++epoch.current;
            setList(old => ({ data: old.key === key ? old.data : null, key, error: '', busy: true }));
            rpc('materials', { workspaceBinding: binding, query, status, offset, limit }, abort.signal).then(data => {
              if (abort.signal.aborted || seq !== epoch.current) return;
              if (data.workspaceBinding !== binding || !Array.isArray(data.items)) throw new Error(L('资料响应与工作区不符。', 'Material response does not match this workspace.'));
              setList({ data, key, error: '', busy: false });
            }).catch(e => { if (!abort.signal.aborted && seq === epoch.current) setList(old => ({ ...old, error: e.message, busy: false })); });
            return () => abort.abort();
          }, [key, tick]);
          React.useEffect(() => {
            const abort = new AbortController(), seq = ++detailEpoch.current;
            if (!selected) { setDetail(null); return () => abort.abort(); }
            setDetailError('');
            setDetail(old => old?.note.id === selected && old.workspaceBinding === binding ? old : null);
            rpc('materials', { workspaceBinding: binding, kind: 'detail', noteId: selected, ...(versionId ? { versionId } : {}) }, abort.signal).then(data => {
              if (abort.signal.aborted || seq !== detailEpoch.current) return;
              if (data.workspaceBinding !== binding || data.note?.id !== selected) throw new Error(L('资料归属已变化，请重新选择。', 'Material ownership changed. Select it again.'));
              const old = materialEditors.get(editorKey);
              if (!old?.dirty) materialEditors.set(editorKey, { draft: data.material.draft, revision: data.material.revision, dirty: false });
              setDetail(data);
            }).catch(e => { if (!abort.signal.aborted && seq === detailEpoch.current) setDetailError(e.message); });
            return () => abort.abort();
          }, [binding, selected, versionId, tick]);
          const choose = id => { setSelected(id); setVersionId(''); setImage(null); setImageError(''); setPreview(false); setConfirmed(false); setSelection([]); setFeedback(''); };
          const updateDraft = patch => { if (!editor) return; materialEditors.set(editorKey, { ...editor, draft: { ...editor.draft, ...patch }, dirty: true }); setPreview(false); setConfirmed(false); redraw(editTick + 1); };
          const perform = async (action, payload = {}) => {
            const seq = detailEpoch.current, id = selected; setBusy(true); setFeedback('');
            try {
              const value = await rpc('action', { type: 'material.change', action, workspaceBinding: binding, noteId: id, requestId: crypto.randomUUID(), ...payload });
              if (!mounted.current || seq !== detailEpoch.current || selected !== id) return;
              if (action === 'save_draft') { const old = materialEditors.get(editorKey); materialEditors.set(editorKey, { ...old, dirty: false, revision: value.revision }); }
              setFeedback(value); setPreview(false); setConfirmed(false); setTick(v => v + 1);
            } catch (e) { if (mounted.current && seq === detailEpoch.current) setFeedback(e.message); }
            finally { if (mounted.current) setBusy(false); }
          };
          const field = (label, control) => h('label', { key: label, className: 'pa24-material-field' }, h('span', null, label), control);
          const input = (key, label, multiline = false) => field(label, h(multiline ? 'textarea' : 'input', { value: editor?.draft[key] ?? '', rows: multiline ? key === 'transcript' ? 14 : 4 : undefined, disabled: busy, onChange: e => updateDraft({ [key]: e.target.value }) }));
          const diffNames = { title: '标题', transcript: '正文', summary: '摘要', pageOrder: '原稿页序', pages: '逐页转写', doubts: '定位疑点', unknowns: '待确认项', suggestions: 'AI 建议', relativeDates: '日期依据', diagrams: '图示说明' };
          const diffView = data => data && h('div', { className: 'pa24-note', 'aria-label': L('发布差异', 'Publication changes') }, h('p', null, L('与最新冻结版本比较：', 'Compared with the latest frozen version: ') + (data.fields.map(key => diffNames[key] || key).join('、') || L('正文与页序未变化', 'Body and page order unchanged'))),
            (data.fieldChanges || []).map(change => h('section', { key: change.field }, h('h4', null, diffNames[change.field] || change.field),
              h('h5', null, L('发布前', 'Before')), h(MaterialValue, { value: change.before }), h('h5', null, L('发布后', 'After')), h(MaterialValue, { value: change.after }))),
            data.candidates.filter(c => c.change !== 'unchanged').map(c => h('section', { key: c.id }, h('h4', null, (c.change === 'added' ? L('新增候选：', 'New candidate: ') : L('变更候选：', 'Changed candidate: ')) + c.summary),
              c.before && h(React.Fragment, null, h('h5', null, L('发布前参数', 'Previous parameters')), materialParameters(c.before)), c.after && h(React.Fragment, null, h('h5', null, L('发布后参数', 'New parameters')), materialParameters(c.after)))),
            data.reordered && h('p', null, L('候选行动顺序已调整，关联标识保留。', 'Candidate order changed; identities are preserved.')),
            data.removed.map(c => h('section', { key: c.id }, h('h4', null, L('移除候选（不会删除外部对象）：', 'Removed candidate (external object remains): ') + c.summary), c.before && materialParameters(c.before))));
          const detailReady = detail?.note.id === selected && editor;
          const version = detailReady ? detail.selected : null;
          const frozenCandidates = version?.content?.derivedStatus === 'ready' ? version.content.candidates || [] : [];
          const source = detail?.material.source;
          const originalView = detailReady && h('section', { className: 'pa24-card' }, h('h3', null, source?.kind === 'qwennote' ? L('听记来源原文', 'Original minutes') : L('保存的原稿', 'Saved originals')),
            source?.kind === 'qwennote' ? h(React.Fragment, null, fields([[L('类型', 'Type'), source.type], [L('来源', 'Source'), source.title], [L('引用', 'Reference'), source.reference || '—'], [L('读取工具', 'Read tool'), source.toolName || '—']]), h('pre', { className: 'pa24-material-text' }, detail.sourceText))
              : h(React.Fragment, null, h('div', { className: 'pa24-row' }, detail.pages.map(page => button('image', L('第 ' + page.pageNo + ' 页', 'Page ' + page.pageNo), async () => {
                const seq = detailEpoch.current; setImageError('');
                try { const data = await rpc('materials', { kind: 'original', noteId: selected, pageNo: page.pageNo, workspaceBinding: binding }); if (seq === detailEpoch.current && mounted.current) { if (data.workspaceBinding !== binding) throw new Error('工作区已变化'); setImage(data); } }
                catch (e) { if (seq === detailEpoch.current && mounted.current) setImageError(e.message); }
              }, { key: page.pageNo, disabled: page.status !== 'saved' || busy }))), imageError && h('p', { role: 'alert', className: 'pa24-error' }, imageError), image && h('img', { src: image.data, alt: L('已核验原稿第 ' + image.pageNo + ' 页', 'Verified original page ' + image.pageNo), className: 'pa24-original' }), !image && h('p', { className: 'pa24-meta' }, L('选择页码读取已保存原稿；显示前核对原件摘要。', 'Choose a page to read the saved original; its digest is checked first.'))));
          return h('section', { className: 'pa24-materials' },
            sectionHead('pen', null, L('对照原稿、识别结果、草稿和冻结版本。保存与发布分开，批准或退回仍在飞书。', 'Compare originals, recognition, drafts, and frozen versions. Save and publish separately; approve or return in Feishu.'), button('refresh', L('刷新资料', 'Refresh materials'), () => setTick(v => v + 1), { disabled: busy || list.busy }), 'danger'),
            list.data && capKpi([[list.data.counts.awaiting_review || 0, L('待审笔记', 'Pending notes')], [list.data.counts.returned || 0, L('退回笔记', 'Returned notes')], [list.data.counts.needs_rereview || 0, L('需重审笔记', 'Notes needing review')], [list.data.counts.verificationUnknown || 0, L('核验异常', 'Verification errors')]]),
            h('div', { className: 'pa24-source-fields' }, field(L('标题或资料编号', 'Title or material ID'), h('input', { value: query, onChange: e => { setQuery(e.target.value); setOffset(0); } })), field(L('资料状态', 'Material status'), h('select', { value: status, onChange: e => { setStatus(e.target.value); setOffset(0); } }, [['pending','待处理','Pending'],['','全部资料','All materials'],['collected','草稿待发布','Draft'],['approved','已审核','Approved'],['returned','已退回','Returned'],['needs_rereview','需重审','Needs review']].map(([value, zh, en]) => h('option', { key: value, value }, L(zh, en)))))),
            list.busy && h('p', { role: 'status' }, L('正在读取资料…', 'Reading materials…')),
            list.error && h('div', { role: 'alert', className: 'pa24-error' }, list.error, list.data && h('p', null, L('当前显示上次读取的内容。', 'Showing the last successful read.')), button('refresh', L('重试读取', 'Retry read'), () => setTick(v => v + 1))),
            list.data && h(React.Fragment, null, h('p', { className: 'pa24-meta' }, list.data.matched + L(' 条匹配 / ', ' matching / ') + list.data.total + L(' 份资料', ' total materials')),
              list.data.items.length ? list.data.items.map(row => h('article', { key: row.id, className: 'pa24-job' }, h('div', { className: 'pa24-row pa24-between' }, button('note', row.title || row.id, () => choose(row.id), { 'aria-pressed': selected === row.id }), badge(L(...materialStatus(row.status)), row.status === 'approved' ? 'blue' : 'amber')),
                h('p', { className: 'pa24-meta' }, (({ images: L('手写原稿', 'Handwriting'), transcript: L('听记转写', 'Transcript'), minutes: L('听记纪要', 'Minutes'), 'quick-note': L('速记', 'Quick note') })[row.materialType] || row.materialType) + ' · ' + (row.latest ? 'v' + row.latest.version + ' · ' : '') + date(row.updatedAt, workspace.config?.timeZone))))
                : !list.busy && empty('note', 'neutral', list.data.total ? L('没有匹配资料', 'No matching materials') : L('尚无资料记录', 'No materials yet'), L('在飞书提交手写原稿，或在本地对话选择听记资料。', 'Submit originals in Feishu or select minutes in local chat.'), button('chat', L('打开本地对话', 'Open local chat'), openRobot)),
              list.data.matched > limit && h('nav', { className: 'pa24-row', 'aria-label': L('资料分页', 'Material pages') }, button('chevron', L('上一页', 'Previous'), () => setOffset(Math.max(0, offset - limit)), { disabled: offset === 0 }), h('span', null, Math.floor(offset / limit) + 1), button('chevron', L('下一页', 'Next'), () => setOffset(offset + limit), { disabled: offset + limit >= list.data.matched }))),
            selected && !detailReady && !detailError && h('p', { role: 'status' }, L('正在读取资料详情…', 'Reading material details…')), detailError && h('p', { role: 'alert', className: 'pa24-error' }, detailError),
            detailReady && h('section', { className: 'pa24-card' }, h('h2', null, detail.note.title),
              h('div', { className: 'pa24-row', role: 'tablist', 'aria-label': L('资料对照视图', 'Material comparison views') }, MATERIAL_TABS.map(([value, zh, en], index) => button('note', L(zh, en), () => setMode(value), {
                key: value, id: 'pa24-material-tab-' + value, role: 'tab', 'aria-selected': mode === value, 'aria-controls': 'pa24-material-content', tabIndex: mode === value ? 0 : -1, className: mode === value ? 'pa24-filter-active' : 'pa24-quiet',
                onKeyDown: e => { const next = e.key === 'ArrowRight' ? (index + 1) % MATERIAL_TABS.length : e.key === 'ArrowLeft' ? (index + MATERIAL_TABS.length - 1) % MATERIAL_TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? MATERIAL_TABS.length - 1 : null;
                  if (next === null || busy) return; e.preventDefault(); setMode(MATERIAL_TABS[next][0]); e.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus(); },
              }))),
              h('div', { id: 'pa24-material-content', role: 'tabpanel', 'aria-labelledby': 'pa24-material-tab-' + mode, tabIndex: 0, className: 'pa24-material-compare' }, h('div', { className: mode === 'original' ? '' : 'pa24-original-side' }, originalView), mode !== 'original' && h('div', { className: 'pa24-material-main' },
                mode === 'recognition' && h(React.Fragment, null, h('h3', null, L('最近一次识别（未自动覆盖人工草稿）', 'Latest recognition (manual draft preserved)')), detail.material.recognition ? h(React.Fragment, null, h('pre', { className: 'pa24-material-text' }, detail.material.recognition.transcript), h('details', null, h('summary', null, L('疑点、页码与 AI 推断', 'Doubts, pages, and AI inferences')), h('pre', { className: 'pa24-material-text' }, JSON.stringify(detail.material.recognition, null, 2)))) : h('p', null, L('没有独立的图像识别结果；听记请对照来源文字。', 'No separate image recognition; compare minutes with their source text.'))),
                mode === 'draft' && h(React.Fragment, null, h('p', { className: 'pa24-meta' }, L('草稿修订 ', 'Draft revision ') + editor.revision + (editor.dirty ? L(' · 有未保存修改', ' · Unsaved changes') : L(' · 已保存', ' · Saved'))), input('title', L('标题', 'Title')), input('summary', L('整理摘要', 'Summary'), true), input('transcript', L('整理正文', 'Body'), true),
                  field(L('原稿页序（逗号分隔）', 'Original page order (comma separated)'), h('input', { value: editor.draft.pageOrder.join(','), disabled: busy || !detail.pages.length, onChange: e => updateDraft({ pageOrder: e.target.value.split(',').filter(Boolean).map(Number) }) })),
                  field(L('待确认项（每行一项）', 'Uncertainties (one per line)'), h('textarea', { value: editor.draft.unknowns.join('\n'), rows: 3, disabled: busy, onChange: e => updateDraft({ unknowns: e.target.value.split('\n').filter(Boolean) }) })),
                  h('h3', null, L('草稿候选行动（尚未授权）', 'Draft candidate actions (not authorized)')),
                  editor.draft.candidates.map((candidate, index) => h('fieldset', { key: candidate.id || 'new-' + index }, h('legend', null, L('候选 ', 'Candidate ') + (index + 1)),
                    [['summary','行动摘要','Action'],['sourceQuote','来源原话','Source quote'],['due','截止日期（可空）','Due date (optional)'],['start','日程开始（可空）','Event start (optional)'],['end','日程结束（可空）','Event end (optional)'],['sourceId','目标来源 ID（可空）','Source ID (optional)'],['company','公司（可空）','Company (optional)'],['project','项目（可空）','Project (optional)']].map(([key, zh, en]) => field(L(zh, en), h('input', { value: candidate[key] || '', disabled: busy, onChange: e => updateDraft({ candidates: editor.draft.candidates.map((c, i) => i === index ? { ...c, [key]: e.target.value } : c) }) }))),
                    field(L('负责人 ID（逗号分隔；空为本人）', 'Assignee IDs (comma separated; default owner)'), h('input', { value: (candidate.assigneeIds || []).join(','), disabled: busy, onChange: e => updateDraft({ candidates: editor.draft.candidates.map((c, i) => i === index ? { ...c, assigneeIds: e.target.value ? e.target.value.split(',').map(x => x.trim()).filter(Boolean) : undefined } : c) }) })),
                    h('div', { className: 'pa24-row' }, button('chevron', L('上移', 'Move up'), () => { const rows = [...editor.draft.candidates]; [rows[index-1], rows[index]] = [rows[index], rows[index-1]]; updateDraft({ candidates: rows }); }, { disabled: index === 0 || busy }), button('close', L('移除候选', 'Remove candidate'), () => updateDraft({ candidates: editor.draft.candidates.filter((_, i) => i !== index) }))))),
                  button('plus', L('添加候选', 'Add candidate'), () => updateDraft({ candidates: [...editor.draft.candidates, { summary: '' }] })),
                  h('details', null, h('summary', null, L('逐页转写、疑点定位与 AI 建议', 'Page transcripts, doubt locations, and AI suggestions')), field(L('高级草稿字段 JSON', 'Advanced draft JSON'), h('textarea', { rows: 12, defaultValue: JSON.stringify({ pages: editor.draft.pages || [], doubts: editor.draft.doubts || [], diagrams: editor.draft.diagrams || [], suggestions: editor.draft.suggestions, relativeDates: editor.draft.relativeDates }, null, 2), onBlur: e => { try { const value = JSON.parse(e.target.value); updateDraft(Object.fromEntries(['pages','doubts','diagrams','suggestions','relativeDates'].filter(key => key in value).map(key => [key, value[key]]))); } catch { setFeedback(L('高级字段 JSON 无效，未应用。', 'Invalid advanced JSON; not applied.')); } } }))),
                  h('div', { className: 'pa24-row pa24-material-actions' }, button('check', L('保存草稿', 'Save draft'), () => perform('save_draft', { expectedRevision: editor.revision, draft: editor.draft }), { disabled: busy || !editor.dirty }), button('external', L('预览发布', 'Preview publication'), () => { setPreview(true); setConfirmed(false); }, { disabled: busy || editor.dirty || editor.revision === 0 })),
                  preview && h('section', { className: 'pa24-card' }, h('h3', null, L('发布这份草稿为新的待审版本', 'Publish this draft for review')), diffView(detail.diff), h('p', null, L('将创建飞书文档并发审核卡；内容审核不执行候选行动。', 'Creates a Feishu document and review card; review does not execute actions.')), field(L('已核对正文、原稿顺序与候选参数', 'I checked the body, original order, and candidate parameters'), h('input', { type: 'checkbox', checked: confirmed, onChange: e => setConfirmed(e.target.checked) })), button('external', L('确认发布', 'Confirm publication'), () => perform('publish_draft', { expectedRevision: editor.revision, instruction: '主人在资料面板核对差异后明确发布此修订为待审版本' }), { disabled: busy || !confirmed || editor.dirty }))),
                mode === 'version' && h(React.Fragment, null, field(L('冻结版本', 'Frozen version'), h('select', { value: version?.id || '', onChange: e => { setVersionId(e.target.value); setSelection([]); } }, detail.versions.map(v => h('option', { key: v.id, value: v.id }, 'v' + v.version + ' · ' + L(...materialStatus(v.status)))))),
                  version ? h(React.Fragment, null, badge(L(...materialStatus(version.status)), version.status === 'approved' ? 'blue' : 'amber'), h('pre', { className: 'pa24-material-text' }, version.content.transcript || version.doc_snapshot),
                    h('details', null, h('summary', null, L('查看冻结文档及完整派生字段', 'Frozen document and derived fields')), h('p', { className: 'pa24-meta' }, L('指纹：', 'Fingerprint: ') + version.fingerprint), h('pre', { className: 'pa24-material-text' }, version.doc_snapshot), h('pre', { className: 'pa24-material-text' }, JSON.stringify(version.content, null, 2))),
                    version.doc_url && h('a', { className: 'pa24-link-button', href: version.doc_url, target: '_blank', rel: 'noreferrer' }, icon('external'), L('前往飞书版本文档', 'Open Feishu version document')),
                    h('div', { className: 'pa24-row' }, button('shield', L('核验当前内容', 'Verify current content'), () => perform('verify')), button('chat', L('重发审核入口', 'Resend review entry'), () => perform('resend', { versionId: version.id }), { disabled: busy || version.id !== detail.versions.at(-1)?.id || version.status !== 'pending_review' })),
                    h('h3', null, L('审核凭证与状态同步', 'Review decisions and status sync')), detail.decisions.map(d => h('p', { key: d.id, className: 'pa24-note' }, `${d.version_id} · ${d.decision} · ${d.reviewer_open_id} · ${date(d.decided_at, workspace.config?.timeZone)} · ${d.doc_sync_status}${d.doc_sync_error ? ' · ' + d.doc_sync_error : ''}`))) : h('p', null, L('尚未发布待审版本。', 'No published review version.'))),
                mode === 'actions' && h(React.Fragment, null, h('h3', null, L('冻结版本的候选行动', 'Candidate actions from the frozen version')), h('p', null, L('仅当前已审且内容仍一致的版本可执行。旧对象保留关联；变化先形成建议。', 'Only the current approved, unchanged version can execute. Existing objects remain linked; changes become proposals.')),
                  frozenCandidates.length ? frozenCandidates.map((c, index) => { const id = c.id || `legacy-${version.version}-${index}`; return h('article', { key: id, className: 'pa24-job' }, field(c.summary, h('input', { type: 'checkbox', checked: selection.includes(id), disabled: busy || version.status !== 'approved' || version.id !== detail.versions.at(-1)?.id, onChange: e => setSelection(e.target.checked ? [...selection, id] : selection.filter(x => x !== id)) })), h('p', { className: 'pa24-note' }, c.sourceQuote || L('来源原话未单列，请核对正文。', 'Source quote is not separate; check the body.')), materialParameters(c), h('details', null, h('summary', null, L('完整候选字段', 'Full candidate fields')), h('pre', { className: 'pa24-material-text' }, JSON.stringify(c, null, 2)))); }) : h('p', null, L('没有可执行的同源候选；请整理草稿并发布审核。', 'No proven candidate actions; edit and publish a draft.')),
                  field(L('本次明确授权', 'Authorization for this action'), h('textarea', { value: instruction, rows: 3, onChange: e => setInstruction(e.target.value), placeholder: L('例如：按以上最终参数执行选中的行动', 'Execute the selected actions with the shown parameters') })),
                  button('check', L('授权执行所选行动', 'Authorize selected actions'), () => perform('adopt_actions', { versionId: version.id, candidateIds: selection, instruction }), { disabled: busy || !selection.length || !instruction.trim() || version?.status !== 'approved' || editor.dirty }),
                  h('h3', null, L('已有对象与执行回执', 'Linked objects and receipts')), detail.actions.map(link => h('article', { key: link.candidate_id, className: 'pa24-job' }, h('p', null, link.parameters.summary + ' · ' + ({ succeeded: L('已成功', 'Succeeded'), failed: L('执行失败', 'Failed'), unknown: L('结果待核对', 'Result needs verification'), running: L('处理中', 'Running'), staged: L('已登记', 'Recorded') }[link.operation?.status] || L('尚未执行', 'Not executed'))), materialObjectLink(link.operation?.receipt), h('details', null, h('summary', null, L('授权版本、最终参数与回执', 'Authorized version, parameters, and receipt')), h('pre', { className: 'pa24-material-text' }, JSON.stringify(link, null, 2))))))))),
              feedback && h(MaterialFeedback, { value: feedback }), busy && h('p', { role: 'status' }, L('正在处理，请等待回执…', 'Working; waiting for the receipt…')));
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

        const budgetNumber = value => value === '' || value == null ? null : Number(value);
        const budgetValue = value => value == null ? L('未知', 'Unknown') : Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 });
        function BudgetConfigFields({ value, onChange }) {
          const change = (key, next) => onChange({ ...value, [key]: next });
          const field = (label, node) => h('label', { className: 'pa24-memory-filter', key: label }, label, node);
          const number = (label, key, step = 'any') => field(label, h('input', { type: 'number', min: 0, step, value: value[key] ?? '', onChange: event => change(key, event.target.value), placeholder: L('留空不限', 'Blank: no limit') }));
          const select = (label, key, choices) => field(label, h('select', { value: value[key], onChange: event => change(key, event.target.value) }, choices.map(([id, text]) => h('option', { key: id, value: id }, text))));
          const priceChange = (index, key, next) => change('prices', value.prices.map((price, i) => i === index ? { ...price, [key]: next } : price));
          return h('section', { id: 'pa24-config-budget', 'aria-label': L('模型预算设置', 'Model budget settings') },
            h('h3', null, L('模型预算', 'Model budget')),
            h('p', { className: 'pa24-meta' }, L('按工作区时区统计。限额留空表示不限，0 表示暂停新受管请求；一次放行只影响指定运行的下一次请求。', 'Periods use the workspace timezone. Blank means unlimited; 0 pauses new managed requests. A one-time release allows only the next request of the selected run.')),
            h('div', { className: 'pa24-memory-filters' }, select(L('预算周期', 'Budget period'), 'period', [['day', L('每日', 'Daily')], ['month', L('每月', 'Monthly')]]), select(L('估算币种', 'Estimate currency'), 'currency', [['CNY', 'CNY'], ['USD', 'USD']]),
              number(L('请求次数限额', 'Request limit'), 'maxRequests', 1), number(L('Token 限额', 'Token limit'), 'maxTokens', 1), number(L('估算费用限额', 'Estimated cost limit'), 'maxEstimatedCost'), number(L('预警比例（0–1）', 'Warning ratio (0–1)'), 'warningRatio', 0.05)),
            h('details', null, h('summary', null, L('模型单价与依据', 'Model prices and sources')),
              h('p', { className: 'pa24-meta' }, L('每百万 token 单价，使用上方币种。缺少实际模型价格或缓存价格时费用未知；不会把估价当供应商账单。', 'Rates per million tokens in the selected currency. Missing model or cache prices leave cost unknown. Estimates are not provider bills.')),
              value.prices.map((price, i) => h('fieldset', { key: i, style: { minWidth: 0, border: '1px solid var(--pa-line)', margin: '12px 0' } }, h('legend', null, L('价格 ', 'Price ') + (i + 1)),
                h('div', { className: 'pa24-memory-filters' }, [['provider','提供方','Provider'],['model','模型','Model'],['basis','价格依据','Price source']].map(([key, zh, en]) => field(L(zh,en), h('input', { value: price[key] ?? '', onChange: event => priceChange(i, key, event.target.value) }))),
                  [['inputPerMillion','输入单价','Input rate'],['outputPerMillion','输出单价','Output rate'],['cacheReadPerMillion','缓存读取单价（可选）','Cache read rate (optional)'],['cacheWritePerMillion','缓存写入单价（可选）','Cache write rate (optional)']].map(([key, zh, en]) => field(L(zh,en), h('input', { type: 'number', min: 0, step: 'any', value: price[key] ?? '', onChange: event => priceChange(i,key,event.target.value) })))),
                h('button', { type: 'button', onClick: () => change('prices', value.prices.filter((_, index) => i !== index)) }, L('移除此价格', 'Remove price')))),
              h('button', { type: 'button', disabled: value.prices.length >= 100, onClick: () => change('prices', [...value.prices, { provider: '', model: '', inputPerMillion: '', outputPerMillion: '', basis: '' }]) }, L('添加模型价格', 'Add model price'))));
        }
        function BudgetDetail({ helpers }) {
          const binding = helpers.state.workspaceBinding;
          const [view, reload] = useRpc('budget', { workspaceBinding: binding }, [binding]);
          const [grant, setGrant] = React.useState(null), [confirm, setConfirm] = React.useState(false), [message, setMessage] = React.useState(''), [offset, setOffset] = React.useState(0);
          const { busy, error, button } = usePanelActions();
          const data = view.data?.workspaceBinding === binding ? view.data : null;
          React.useEffect(() => { setOffset(0); }, [data?.period?.from, data?.records?.length]);
          const limit = value => value == null ? L('不限', 'Unlimited') : budgetValue(value);
          const prepare = row => { setGrant({ ...row, requestId: crypto.randomUUID() }); setConfirm(false); setMessage(''); };
          const release = async (selected = grant) => {
            const result = await rpc('action', { type: 'budget.release', workspaceBinding: binding, requestId: selected.requestId ?? selected.id, runId: selected.run_id, workId: selected.work_item_id, sessionId: selected.session_id, scope: 'next-model-request', confirm: true });
            setMessage(result.message); setGrant(null); setConfirm(false); reload(); await helpers.refresh();
          };
          const records = [...(data?.records || [])].reverse();
          return h('section', { className: 'pa24-manager pa24-budget' },
            sectionHead('pulse', L('模型与预算', 'Models & budget'), L('受管请求的持久用量、实际模型和一次放行。', 'Durable usage, actual models, and one-time releases for managed requests.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新用量', 'Refresh usage'), reload), button('code', L('设置预算与模型', 'Configure budget and models'), () => helpers.openCard('config', 'pa24-config-budget')))),
            (error || message) && h('p', { role: error ? 'alert' : 'status', className: error ? 'pa24-error' : 'pa24-helper' }, error || message),
            view.status === 'loading' && h('p', { role: 'status' }, L('正在读取持久用量…', 'Reading durable usage…')),
            view.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, view.error, button('refresh', L('重试读取', 'Retry reading'), reload)),
            data && h(React.Fragment, null,
              h('section', { className: 'pa24-card' }, h('div', { className: 'pa24-row' }, h('h3', null, L('本周期用量', 'Usage this period')), badge(data.status === 'blocked' ? L('等待预算处理', 'Budget action needed') : data.status === 'warning' ? L('接近限额', 'Near limit') : L('限额内', 'Within limits'), data.status === 'ok' ? 'blue' : 'amber')),
                fields([[L('统计时段', 'Period'), date(data.period.from, data.period.timeZone) + ' → ' + date(data.period.to, data.period.timeZone) + ' · ' + data.period.timeZone], [L('开始记录', 'Recorded since'), data.recordedSince ? date(data.recordedSince, data.period.timeZone) : L('尚无受管请求', 'No managed requests yet')],
                  [L('请求次数 / 限额', 'Requests / limit'), data.requests + ' / ' + limit(data.config.maxRequests)], [L('Token / 限额', 'Tokens / limit'), budgetValue(data.tokens) + ' / ' + limit(data.config.maxTokens)], [L('估算费用 / 限额', 'Estimated cost / limit'), budgetValue(data.estimatedCost) + ' / ' + limit(data.config.maxEstimatedCost) + ' ' + data.currency],
                  [L('未取得完整用量', 'Unknown usage'), data.unknownUsage + L(' 次', ' requests')], [L('费用未知', 'Unknown cost'), data.unknownCost + L(' 次', ' requests')], [L('未结算请求', 'Unsettled requests'), data.pending]]),
                data.unknownUsage > 0 && h('p', { className: 'pa24-meta' }, L('已知部分 Token：', 'Known token subtotal: ') + budgetValue(data.knownTokens)),
                data.unknownCost > 0 && h('p', { className: 'pa24-meta' }, L('已知部分估算：', 'Known estimated subtotal: ') + budgetValue(data.knownEstimatedCost) + ' ' + data.currency),
                [...data.reasons, ...data.warnings].map(reason => h('p', { key: reason, className: 'pa24-helper' }, reason)), h('p', { className: 'pa24-meta' }, data.coverage), h('p', { className: 'pa24-meta' }, data.basis), h('p', { className: 'pa24-helper' }, data.notice)),
              h('section', { className: 'pa24-card' }, h('h3', null, L('等待预算处理的运行', 'Runs awaiting budget action')),
                data.waiting.length ? data.waiting.map(row => h('article', { key: row.run_id + ':' + row.session_id, className: 'pa24-resource' }, h('strong', null, row.title), h('p', null, row.reason),
                  row.blocks.filter(block => block.kind !== 'budget').map(block => h('p', { key: block.key }, L('另有阻断：', 'Other blocker: ') + block.reason)),
                  h('div', { className: 'pa24-row' }, button('check', L('准备放行一次', 'Prepare one-time release'), () => prepare(row)), button('clock', L('查看原运行', 'View original run'), () => helpers.openRuns({ query: row.run_id }))),
                  h('details', null, h('summary', null, L('原交办与运行标识', 'Original work and run IDs')), fields([[L('交办', 'Work'), row.work_item_id], [L('运行', 'Run'), row.run_id], [L('会话', 'Session'), row.session_id]])))) : h('p', { className: 'pa24-meta' }, L('没有等待预算处理的运行。', 'No runs awaiting budget action.'))),
              grant && h('section', { className: 'pa24-card', 'aria-label': L('确认预算放行范围', 'Confirm budget release scope') }, h('h3', null, grant.title),
                h('p', null, L('仅放行此运行的下一次受管模型请求；重试也占一次。其他阻断保持，已停止或结束的运行不会复活。', 'Allow only the next managed model request for this run; a retry also consumes it. Other blockers remain, and ended runs cannot be revived.')),
                fields([[L('运行', 'Run'), grant.run_id], [L('会话', 'Session'), grant.session_id]]),
                h('label', { className: 'pa24-check' }, h('input', { type: 'checkbox', checked: confirm, onChange: event => setConfirm(event.target.checked) }), L('确认仅放行以上范围一次', 'Confirm one request in this scope')),
                h('div', { className: 'pa24-row' }, button('check', L('确认放行一次', 'Allow one request'), () => release(), { disabled: busy || !confirm, className: 'pa24-primary' }), button('close', L('取消放行', 'Cancel release'), () => setGrant(null)))),
              h('section', { className: 'pa24-card' }, h('h3', null, L('实际模型与用量依据', 'Actual models and usage evidence')),
                records.length ? records.slice(offset, offset + 20).map(row => h('article', { key: row.id, className: 'pa24-resource' },
                  h('strong', null, row.record.actual ? row.record.actual.provider + ' / ' + row.record.actual.model : L('实际模型尚未回报', 'Actual model not yet reported')),
                  fields([[L('请求时间', 'Requested at'), date(row.record.at, data.period.timeZone)], [L('请求路由', 'Requested route'), [row.record.proposed?.provider, row.record.proposed?.model].filter(Boolean).join(' / ') || L('未记录', 'Not recorded')],
                    [L('Token', 'Tokens'), row.record.usage ? budgetValue(row.record.usage.totalTokens ?? row.record.usage.inputTokens + row.record.usage.outputTokens + (row.record.usage.cacheReadTokens ?? 0) + (row.record.usage.cacheWriteTokens ?? 0)) : L('未知', 'Unknown')], [L('估算费用', 'Estimated cost'), budgetValue(row.record.estimate) + ' ' + row.record.currency], [L('价格依据', 'Price source'), row.record.price?.basis || L('缺少可核对价格', 'No verified price')]]),
                  button('clock', L('查看关联运行', 'View linked run'), () => helpers.openRuns({ query: row.run_id })), h('details', null, h('summary', null, L('完整计量记录', 'Full measurement record')), h('pre', null, JSON.stringify(row, null, 2))))) : h('p', { className: 'pa24-meta' }, L('本周期尚无受管请求；未记录不代表供应商没有费用。', 'No managed requests recorded this period; providers may still have charges.')),
                records.length > 20 && h('nav', { className: 'pa24-page-nav', 'aria-label': L('用量分页', 'Usage pagination') }, button('chevron', L('上一页', 'Previous'), () => setOffset(Math.max(0,offset-20)), { disabled: !offset }), h('span', null, `${offset+1}–${Math.min(offset+20,records.length)} / ${records.length}`), button('chevron', L('下一页', 'Next'), () => setOffset(offset+20), { disabled: offset+20 >= records.length }))),
              data.releases.length > 0 && h('details', { open: data.releases.some(row => row.status === 'ready' && row.record.error) }, h('summary', null, L('一次放行记录', 'One-time release history')), data.releases.map(row => h('div', { key: row.id, className: 'pa24-resource' },
                h('p', null, (row.status === 'used' ? L('已消费', 'Used') : L('等待可执行条件', 'Waiting for execution conditions')) + ' · ' + date(row.created_at, data.period.timeZone)), h('p', { className: 'pa24-meta' }, row.run_id), row.record.error && h('p', { role: 'status' }, row.record.error),
                row.status === 'ready' && row.record.error && h('div', { className: 'pa24-row' },
                  row.record.wake ? h('p', { className: 'pa24-helper' }, L('接纳状态未知，请先核对原运行。', 'Acceptance is unknown; reconcile the original run first.')) : button('refresh', L('重试原许可续办', 'Retry the existing permit'), () => release(row)),
                  button('clock', L('查看原运行', 'View original run'), () => helpers.openRuns({ query: row.run_id }))))))));
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
              capture('minutes', rpc('minutes', {}, abort.signal)),
              capture('memory', rpc('memory', { query: '', offset: 0 }, abort.signal)),
              capture('health', rpc('health', {}, abort.signal)),
              capture('budget', rpc('budget', { workspaceBinding }, abort.signal)),
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

        const backupOperation = operation => ({ create: L('备份产物', 'Backup artifact'), verify: L('完整性校验', 'Integrity verification'), restore_check: L('隔离恢复演练', 'Isolated restore drill') }[operation] || operation);
        const backupStatus = value => ({ running: L('进行中', 'Running'), succeeded: L('本项通过', 'This operation passed'), partial: L('部分检查未通过', 'Checks incomplete'), failed: L('失败', 'Failed'), interrupted: L('中断，待核对', 'Interrupted; check required') }[value] || value);
        function BackupRecordDetail({ id, binding, tz, revision }) {
          const [view, retry] = useRpc('backups.detail', { id, workspaceBinding: binding }, [id, binding, revision]);
          if (view.status === 'loading') return h('p', { role: 'status' }, L('正在读取记录…', 'Reading record…'));
          if (view.status === 'error') return h('div', { role: 'alert' }, view.error, h('button', { type: 'button', onClick: retry }, L('重试详情', 'Retry details')));
          if (view.data?.workspaceBinding !== binding || view.data?.record?.id !== id) return null;
          const record = view.data.record, result = record.result || {};
          const stepState = value => ({ passed: L('通过', 'Passed'), failed: L('失败', 'Failed'), not_checked: L('未检查', 'Not checked'), required: L('后续必做', 'Still required') }[value] || value);
          return h('section', { className: 'pa24-card pa24-backups' }, sectionHead('folder', backupOperation(record.operation), backupStatus(record.status), h('button', { type: 'button', onClick: retry }, L('刷新详情', 'Refresh details'))),
            fields([[L('备份位置', 'Backup location'), record.backup_dir || '—'], [L('隔离副本', 'Isolated copy'), record.target_dir || L('无持久副本', 'No retained copy')], [L('开始时间', 'Started'), date(record.started_at, tz)], [L('完成时间', 'Finished'), record.finished_at ? date(record.finished_at, tz) : L('尚未保存完成凭据', 'No completion receipt')]]),
            record.error && h('p', { role: 'alert' }, record.error), result.message !== record.error && h('p', null, result.message),
            h('p', { className: 'pa24-helper' }, L('备份产物、校验、隔离演练分别留档；通过本项不代表现场已恢复。凭据、远端对象和旧待发仍需核对。', 'Artifact creation, verification and drills are separate facts. Passing one does not prove production recovery. Credentials, remote objects and old deliveries still need reconciliation.')),
            (result.steps || []).map(step => h('details', { key: step.id, className: 'pa24-note', open: ['failed', 'not_checked'].includes(step.status) },
              h('summary', null, stepState(step.status) + ' · ' + ({ files: L('备份清单与文件', 'Manifest and files'), isolation: L('执行隔离', 'Execution isolation'), ledger: L('实际账本', 'Restored ledger'), materials: L('原稿与审核快照', 'Originals and review snapshots'), skills: L('Skill 版本与资源', 'Skill versions and resources'), sessions: L('会话与附件', 'Sessions and attachments'), memory: L('记忆与删除保护', 'Memory and deletion protection'), 'remote-reconciliation': L('外部对象与旧待发', 'Remote objects and old deliveries'), credentials: L('凭据', 'Credentials'), cutover: L('人工切换', 'Manual cutover') }[step.id] || step.id)),
              h('p', null, step.message), step.evidence && h('pre', { className: 'pa24-json' }, JSON.stringify(step.evidence, null, 2)))),
            h('details', null, h('summary', null, L('范围、采集时间与版本', 'Scope, collection times and versions')), h('pre', { className: 'pa24-json' }, JSON.stringify({ coverage: result.coverage, capturedAt: result.capturedAt, sourceVersion: result.sourceVersion, manifestHash: record.manifest_hash, parts: result.parts }, null, 2))));
        }
        function BackupDetail({ state, config, button, openRobot }) {
          const binding = state.workspaceBinding, tz = tzOf(state);
          const [operation, setOperation] = React.useState('all'), [offset, setOffset] = React.useState(0), [tick, setTick] = React.useState(0), [selected, setSelected] = React.useState(null);
          const [view, setView] = React.useState({ key: '', status: 'loading', data: null, error: '' });
          const [task, setTask] = React.useState('backup_create'), [backupDir, setBackupDir] = React.useState(''), [targetDir, setTargetDir] = React.useState(''), [instruction, setInstruction] = React.useState(''), [note, setNote] = React.useState('');
          const key = JSON.stringify([binding, operation, offset]);
          React.useEffect(() => {
            const abort = new AbortController();
            setView(previous => ({ key, status: 'loading', data: previous.key === key ? previous.data : null, error: '' }));
            rpc('backups', { operation, offset, workspaceBinding: binding }, abort.signal).then(data => {
              if (data.workspaceBinding !== binding) throw new Error(L('工作区已变化，请刷新。', 'Workspace changed; refresh.'));
              if (!abort.signal.aborted) setView({ key, status: 'ready', data, error: '' });
            }).catch(error => { if (!abort.signal.aborted) setView(previous => ({ key, status: 'error', data: previous.key === key ? previous.data : null, error: error.message })); });
            return () => abort.abort();
          }, [key, tick]);
          React.useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 5000); return () => clearInterval(timer); }, []);
          React.useEffect(() => { setSelected(null); setInstruction(''); setNote(''); }, [binding, operation]);
          const current = view.key === key ? view : { status: 'loading', data: null, error: '' }, data = current.data;
          const prepare = () => {
            const requestId = 'backup-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36));
            const text = task === 'backup_create' ? `请为当前工作区创建一次联合备份，targetDir=${JSON.stringify(targetDir)}，requestId=${requestId}。备份形成后展示记录和实际覆盖范围。`
              : task === 'backup_verify' ? `请校验当前工作区备份 ${JSON.stringify(backupDir)}，requestId=${requestId}。使用隔离副本核验实际账本、会话、原稿、Skill 和记忆，分别报告未检查项。`
                : `请先调用 backup_preview 预览 ${JSON.stringify(backupDir)} 的恢复保护与冲突。展示结果后由我确认，再使用返回的 previewToken 与 confirm=true 在全新目录 ${JSON.stringify(targetDir)} 执行 backup_restore_check，requestId=${requestId}。保留现场、当前记忆和删除标记；保持执行隔离。`;
            setInstruction(text); setNote('');
          };
          const copy = async () => { try { await navigator.clipboard.writeText(instruction); setNote(L('指令已复制；在本地会话发送后才开始执行。', 'Copied; execution begins only after sending in the local session.')); } catch { setNote(L('复制失败，请手工选中下方指令。', 'Copy failed; select the instruction below.')); } };
          return h(React.Fragment, null, h(ReadinessDetail, { state }),
            h('section', { className: 'pa24-card pa24-backups' }, sectionHead('folder', L('备份与恢复记录', 'Backup and recovery records'), L('持久展示三类独立事实；查询和刷新不会开始备份或恢复。', 'Three independent durable facts. Reading or refreshing starts no backup or restore.'), button('refresh', L('刷新记录', 'Refresh records'), () => setTick(value => value + 1), { className: 'pa24-quiet' }), 'blue'),
              h('label', { className: 'pa24-field' }, L('记录类型', 'Record type'), h('select', { value: operation, onChange: event => { setOperation(event.target.value); setOffset(0); } }, ['all', 'create', 'verify', 'restore_check'].map(value => h('option', { value, key: value }, value === 'all' ? L('全部', 'All') : backupOperation(value))))),
              current.status === 'loading' && h('p', { role: 'status' }, data ? L('正在刷新，暂时显示上次读取结果…', 'Refreshing; showing the previous result…') : L('正在读取备份记录…', 'Reading backup records…')),
              current.error && h('p', { role: 'alert' }, current.error + (data ? L('；以下为上次读取缓存。', '; showing cached results.') : ''), h('button', { type: 'button', onClick: () => setTick(value => value + 1) }, L('重试记录', 'Retry records'))),
              data && h('p', { className: 'pa24-meta' }, L('共 ', 'Total ') + data.total + L(' 条；账本：', ' records; ledger: ') + (config?.storage === 'postgres' ? 'PostgreSQL' : 'SQLite')),
              data && !data.total && h('p', null, operation === 'all' ? L('尚无持久备份记录。历史对话回报不会被推断成已校验或已恢复。', 'No durable backup records. Historical chat receipts are not inferred as verified or restored.') : L('当前筛选无记录。', 'No records match this filter.')),
              (data?.rows || []).map(row => h('div', { key: row.id, className: 'pa24-note' }, h('button', { type: 'button', onClick: () => { setSelected(row.id); setBackupDir(row.backup_dir || ''); } }, backupOperation(row.operation) + ' · ' + backupStatus(row.status)), h('p', { className: 'pa24-meta' }, date(row.started_at, tz)), h('p', { className: 'pa24-meta', style: { overflowWrap: 'anywhere' } }, row.backup_dir || row.target_dir || row.error))),
              data?.total > 20 && h('div', { className: 'pa24-row' }, h('button', { type: 'button', disabled: offset === 0, onClick: () => setOffset(Math.max(0, offset - 20)) }, L('上一页', 'Previous')), h('button', { type: 'button', disabled: offset + 20 >= data.total, onClick: () => setOffset(offset + 20) }, L('下一页', 'Next')))),
            selected && h(BackupRecordDetail, { key: binding + ':' + selected, id: selected, binding, tz, revision: JSON.stringify(data?.rows.find(row => row.id === selected)) }),
            h('section', { className: 'pa24-card' }, sectionHead('chat', L('本地维护入口', 'Local maintenance'), L('准备可核对的操作指令，再到本地24私助会话执行。', 'Prepare a reviewable instruction, then execute it in the local 24PA session.')),
              h('label', { className: 'pa24-field' }, L('操作', 'Operation'), h('select', { value: task, onChange: event => { setTask(event.target.value); setInstruction(''); } }, [['backup_create', L('创建备份', 'Create backup')], ['backup_verify', L('校验备份', 'Verify backup')], ['backup_restore_check', L('预览并引导恢复', 'Preview guided recovery')]].map(([value, label]) => h('option', { value, key: value }, label)))),
              task !== 'backup_create' && h('label', { className: 'pa24-field' }, L('备份绝对路径', 'Absolute backup path'), h('input', { value: backupDir, onChange: event => { setBackupDir(event.target.value); setInstruction(''); } })),
              task !== 'backup_verify' && h('label', { className: 'pa24-field' }, task === 'backup_create' ? L('备份目标父目录', 'Backup destination parent') : L('全新隔离目录（父目录须存在）', 'New isolated directory (parent must exist)'), h('input', { value: targetDir, onChange: event => { setTargetDir(event.target.value); setInstruction(''); } })),
              h('button', { type: 'button', disabled: task !== 'backup_create' && !backupDir.trim() || task !== 'backup_verify' && !targetDir.trim(), onClick: prepare }, L('生成维护指令', 'Prepare instruction')),
              instruction && h('div', null, h('textarea', { readOnly: true, value: instruction, rows: 5, 'aria-label': L('维护指令', 'Maintenance instruction') }), h('div', { className: 'pa24-row' }, h('button', { type: 'button', onClick: copy }, L('复制指令', 'Copy instruction')), button('chat', L('打开本地24私助会话', 'Open local 24PA session'), openRobot)), note && h('p', { role: 'status' }, note)),
              h('p', { className: 'pa24-helper' }, L('密钥与授权缓存不进入备份；远端平台内容只保留本地快照与引用。隔离检查后仍需核对原身份、外部对象、旧待发及凭据，再人工切换。', 'Credentials are excluded. Remote platforms are represented by local snapshots and references. Reconcile identity, remote objects, old deliveries and credentials before manual cutover.'))));
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
          const identityLabel = identity => identity ? `${identity.ownerId} · ${identity.authority}` : L('尚未核验', 'Not verified');
          const targetLabel = target => typeof target === 'string' ? target : `${target.platform} · ${target.sourceId} · ${target.resource?.id} · ${target.identity?.ownerId} · ${target.identity?.authority}`;
          const testTargetLabel = plan => targetLabel(plan.target) + (plan.identity ? ` · ${plan.identity.authority}` : '');
          return h('section', { className: 'pa24-card pa24-health' },
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
              h('p', null, L('原身份：', 'Previous: ') + identityLabel(data.identity.accepted)), h('p', null, L('当前检测：', 'Observed: ') + identityLabel(data.identity.observed)),
              h('label', { className: 'pa24-check' }, h('input', { type: 'checkbox', checked: identityApproved, onChange: event => setIdentityApproved(event.target.checked) }), L('我已核对原交办、待发和待审，确认使用以上新身份。', 'I have checked original work, pending deliveries, and reviews and confirm this identity.')),
              h('button', { type: 'button', disabled: busy || !identityApproved, onClick: () => void run(async () => { const result = await rpc('action', { type: 'health.identity-accept', workspaceBinding: binding, configVersion: data.configVersion, identity: data.identity.observed, confirm: true }); setIdentityApproved(false); return result.message; }) }, L('确认新绑定', 'Confirm new binding'))),
            h('details', null, h('summary', null, L('明确触发真实测试', 'Explicit real test')),
              h('p', { className: 'pa24-meta' }, L('以下动作会在原平台留下真实对象或消息，先预览目标再确认。', 'These actions leave real objects or messages. Preview the target before confirming.')),
              h('label', null, L('测试动作 ', 'Action '), h('select', { value: testAction, onChange: event => setTestAction(event.target.value), disabled: busy },
                (!platform || platform === 'feishu') && h('option', { value: 'feishu.send' }, L('发送飞书测试消息', 'Feishu test message')), (!platform || platform === 'wecom') && h('option', { value: 'wecom.push' }, L('发送企微测试消息', 'WeCom test message')), h('option', { value: 'source.create' }, L('创建来源测试对象', 'Create source test object')))),
              testAction === 'source.create' && h('label', null, L('登记来源 ', 'Registered source '), h('select', { value: sourceId, onChange: event => setSourceId(event.target.value), disabled: busy }, h('option', { value: '' }, L('请选择明确来源', 'Choose a source')), sources.filter(source => source.enabled && source.access === 'readwrite').map(source => h('option', { key: source.id, value: source.id }, `${source.name} · ${source.domain} · ${source.platform}`)))),
              h('button', { type: 'button', disabled: busy || testAction === 'source.create' && !sourceId, onClick: () => void run(async () => { const next = await rpc('health.test.preview', { workspaceBinding: binding, action: testAction, sourceId }); if (current.current === binding) { setPreview(next); setApproved(false); requestId.current = globalThis.crypto.randomUUID(); } return L('已生成测试预览，尚未执行。', 'Preview ready; no test executed.'); }) }, L('预览测试目标', 'Preview test target')),
              preview && h('div', { className: 'pa24-example' }, fields([[L('目标', 'Target'), testTargetLabel(preview.plan)], [L('动作', 'Action'), preview.plan.description], [L('费用', 'Cost'), preview.plan.cost], [L('残留与清理', 'Residue and cleanup'), preview.plan.residue]]),
                h('label', { className: 'pa24-check' }, h('input', { type: 'checkbox', checked: approved, onChange: event => setApproved(event.target.checked) }), L('确认对以上目标执行这一次测试', 'Confirm one test against this target')),
                h('button', { type: 'button', className: 'pa24-primary', disabled: busy || !approved, onClick: () => void run(async () => { const result = await rpc('action', { type: 'health.test', workspaceBinding: binding, requestId: requestId.current, ...preview, confirm: true }); setApproved(false); return `${L('测试状态：', 'Test status: ')}${result.status} · ${result.result?.message || result.message || ''}`; }) }, L('执行已确认测试', 'Execute confirmed test')))),
            tests.length > 0 && h('details', null, h('summary', null, L('测试记录、结果与清理', 'Test results and cleanup')), h('p', { className: 'pa24-meta' }, data.testCoverage), tests.map(test => h('div', { key: test.id, className: 'pa24-resource' }, h('strong', null, test.plan.parameters?.title || test.id),
              h('p', null, `${test.plan.action} · ${test.status} · ${testTargetLabel(test.plan)}`), h('p', null, test.result?.message || L('尚无确认回执；请先核对原目标。', 'No confirmed receipt; reconcile the original target first.')),
              test.result?.nativeId && h('p', { className: 'pa24-meta' }, L('原生对象：', 'Native object: ') + test.result.nativeId),
              test.result?.deliveryId && h('p', { className: 'pa24-meta' }, L('投递标识：', 'Delivery ID: ') + test.result.deliveryId + ' · ' + L('原生消息：', 'Native message: ') + (test.result.nativeMessageId || L('平台未返回', 'Not returned'))),
              h('p', { className: 'pa24-meta' }, test.cleanup?.message || test.result?.residue || test.plan.residue),
              test.status === 'succeeded' && test.plan.action === 'source.create' && !test.cleanup && h('div', null,
                h('label', { className: 'pa24-check' }, h('input', { type: 'checkbox', checked: cleanId === test.id, onChange: event => setCleanId(event.target.checked ? test.id : '') }), L('确认清理此测试对象', 'Confirm cleanup of this test object')),
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
          const cap = extra.health?.capabilities?.find(row => row.id === 'qwennote-channel');
          const configured = qwennoteConfigured(config);
          const [view, refresh] = useRpc('minutes', {}, [state.workspaceBinding]);
          const minutes = view.data;
          return h('div', null,
            sectionHead('note', L('QwenNote 听记', 'QwenNote minutes'), L('录音卡转写/纪要/速记经 mcp__qwennote__* 工具进入本地24私助会话（仅本地会话；飞书入口与 Worker 不放行）。', 'Recorder transcripts, minutes, and quick notes reach the local 24PA session via mcp__qwennote__* tools (local session only; the Feishu entry and workers stay excluded).'),
              h('div', { className: 'pa24-row' },
                button('code', L('打开本地工具配置', 'Open local tool config'), () => openCard('config', 'pa24-extra-tools'), { className: 'pa24-quiet' }),
                button('chat', L('在本地查询或读取听记', 'Query or read minutes in local chat'), openRobot, { className: 'pa24-quiet' }),
                button('refresh', L('刷新接入记录', 'Refresh connection records'), refresh, { disabled: view.status === 'loading' })), 'amber'),
            view.status === 'error' && h('p', { role: 'alert', className: 'pa24-error' }, view.error),
            h('section', { className: 'pa24-card' },
              fields([
                [L('工作区放行', 'Workspace allowance'), configured ? (config.extraLocalTools || []).join(L('、', ', ')) : L('尚未放行（可在参数表单的高级工具区配置）', 'Not allowed yet (configure in the advanced tools section)')],
                [L('通道健康', 'Channel health'), cap ? cap.message : L('尚无健康结论；在运行与维护读取健康状态后显示', 'No health verdict yet — shows after reading health under Operations & maintenance')],
                [L('工具挂载', 'Tool mount'), minutes ? minutes.mounted == null ? L('尚未核验本地会话挂载', 'Local session mount not checked') : minutes.mounted ? L('已挂载（不等于可读）', 'Mounted (readability unproven)') : L('未挂载', 'Not mounted') : L('正在读取…', 'Loading…')],
                [L('实际调用证据', 'Actual call evidence'), minutes?.lastRead ? (minutes.lastRead.state === 'succeeded' ? L('最近一次调用成功', 'Last call succeeded') : L('最近一次调用失败', 'Last call failed')) + ' · ' + date(minutes.lastRead.read_at, config?.timeZone) + ' · ' + minutes.lastRead.tool_name : L('尚无本工作区当前配置的实际读取回执', 'No actual read receipt for the current workspace configuration')],
              ]),
              nextStrip(L('首次接入：profile 配置 dsh-mcp-client 条目（serverName qwennote）→ 本人浏览器完成一次授权 → 参数表单的高级工具区放行 mcp__qwennote__*。', 'First-time setup: add the dsh-mcp-client entry (serverName qwennote) to the profile → authorize once from your browser → allow mcp__qwennote__* in the advanced tools section of the config form.')),
              h('div', { className: 'pa24-helper' }, L('普通刷新不读取听记。请在本地对话先查询、读取，再明确选择保存哪份资料；所选文字可整理成草稿并进入审核，候选行动另行授权。不自动改源、同步全库或写记忆。', 'Refresh does not read minutes. Query and read in local chat, then explicitly choose material to save as a draft for review. Actions need separate authorization; no automatic source edits, library sync, or memory writes.')),
              button('pen', L('查看资料审核与候选行动', 'Open material review and actions'), () => openCard('review')),
              minutes?.tools?.length > 0 && h('details', null, h('summary', null, L('本地已挂载工具', 'Mounted local tools')), h('ul', null, minutes.tools.map(tool => h('li', { key: tool.name }, tool.name + (tool.description ? ' · ' + tool.description : '')))))));
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

        const sourceRoleLabel = value => ({ all: L('全部授权可见', 'All authorized'), involved: L('本人参与或组织', 'Participating or organizing'), organizer: L('本人组织', 'Organizing'), participant: L('本人参与', 'Participating'), responsible: L('我负责的', 'Assigned to me'), following: L('我关注的', 'Following'), assigned: L('我交办的', 'Assigned by me'), creator: L('我创建的', 'Created by me') }[value] || value);
        const latestSourceTime = (rows, key) => rows.map(row => row[key]).filter(value => value && Number.isFinite(Date.parse(value))).sort().at(-1) || null;

        function SourceQueryState({ data, error, busy, verifying, onRetry, tz, domain = 'calendar' }) {
          const todo = domain === 'todo', itemName = todo ? L('待办', 'todos') : L('日程', 'events'), sourceName = todo ? L('待办来源', 'todo sources') : L('日历来源', 'calendar sources');
          const conclusion = todo ? L('全部完成', 'everything is complete') : L('全部空闲', 'complete availability');
          if (error) return h('div', { className: 'pa24-notice pa24-tone-danger', role: 'alert', 'data-testid': 'source-query-state' }, icon('alert'), h('div', null,
            h('strong', null, data ? L('读取失败，以下保留旧观察', 'Read failed; saved observations remain below') : L(`${itemName}读取失败`, `${itemName} read failed`)),
            h('p', null, error), h('p', { className: 'pa24-meta' }, data ? L('当前筛选尚未重新读取，旧结果不代表现时平台状态。', 'This filter has not been read again; old results do not prove current platform state.') : L(`尚未取得可展示的${itemName}，读取失败不会替换为空结果。`, `No displayable ${itemName} were obtained; a failed read is not an empty result.`)),
            h('button', { type: 'button', onClick: onRetry, disabled: busy }, icon('refresh'), L('重试读取', 'Retry read'))));
          if (!data) return busy ? h('div', { className: 'pa24-notice pa24-tone-neutral', role: 'status', 'data-testid': 'source-query-state' }, icon('refresh', { className: 'pa24-spin' }), h('div', null, verifying ? L('正在按明确操作核验原平台；完成前不把旧观察当作本次结果。', 'Verifying the platforms after an explicit request; old observations are not presented as this result.') : L('正在读取保存的来源观察；普通查阅不访问原平台。', 'Reading saved source observations; ordinary browsing does not access the platforms.'))) : null;
          const enabled = data.sources.filter(row => row.state !== 'disabled'), failed = enabled.some(row => row.state === 'failed');
          const completeAt = latestSourceTime(data.sources, 'lastCompleteAt'), checkedAt = latestSourceTime(data.sources, 'checkedAt');
          const title = !data.sources.length ? L(`尚未登记${sourceName}`, `No ${sourceName} registered`)
            : data.fresh ? L('本次已核验', 'Verified in this request') : data.complete ? L('保存的完整观察', 'Saved complete observations')
              : failed ? L('部分来源核验失败', 'Some source checks failed') : L('来源范围未完整核验', 'Source coverage is incomplete');
          const description = !data.sources.length ? L(`请在参数配置登记来源；不能据此判断没有${itemName}。`, `Register sources in configuration; this does not prove there are no ${itemName}.`)
            : data.fresh ? L(`当前筛选的 ${enabled.length} 个启用来源已完整读取。`, `${enabled.length} enabled sources were read completely for this filter.`)
              : data.complete ? L('本次为普通查阅，未发起原平台核验。', 'This is an ordinary read; no platform verification was started.')
                : L(`当前可展示 ${data.count} 个${itemName}；缺失范围与原因见逐来源证据，不能据此判断${conclusion}。`, `${data.count} ${itemName} are available; inspect per-source gaps and reasons. This does not prove ${conclusion}.`);
          return h('div', { className: 'pa24-notice ' + (data.complete ? 'pa24-tone-blue' : data.sources.length ? 'pa24-tone-amber' : 'pa24-tone-neutral'), role: 'status', 'data-testid': 'source-query-state' }, icon(data.complete ? 'check' : 'info'), h('div', null,
            h('strong', null, title), h('p', null, description),
            h('p', { className: 'pa24-meta' }, (completeAt ? L('最新一笔完整观察 ', 'Latest complete source observation ') + date(completeAt, tz) : L('尚无全来源完整观察', 'No complete all-source observation yet')) + (checkedAt ? L(' · 最近观察 ', ' · Latest observation ') + date(checkedAt, tz) : '')),
            busy && h('p', { className: 'pa24-meta' }, L('正在更新，现有结果保留到新响应通过校验。', 'Updating; current results remain until a new response passes validation.'))));
        }

        function SourceScopePanel({ sources, tz, onRetry, busy, catalogError, catalogBusy, onReload, onConfigure, loading, unavailable, roleLabel = sourceRoleLabel, domain = 'calendar' }) {
          const todo = domain === 'todo', itemName = todo ? L('待办', 'todos') : L('日程', 'events');
          const stateLabel = row => row.state === 'complete' ? row.fresh ? L('本次已核验', 'Verified now') : L('完整观察', 'Complete observation')
            : ({ partial: L('范围不完整', 'Incomplete scope'), failed: L('核验失败', 'Verification failed'), disabled: L('已停用', 'Disabled'), unverified: L('未核验', 'Unverified') }[row.state] || row.state);
          return h('aside', { className: 'pa24-card pa24-source-scope', 'aria-label': L('来源与范围', 'Sources and scope'), 'data-testid': 'source-scope-panel' },
            h('div', { className: 'pa24-row pa24-between' }, h('h3', null, icon(todo ? 'tasks' : 'calendar'), L('来源与范围', 'Sources & scope')), onConfigure && h('button', { type: 'button', className: 'pa24-quiet', onClick: onConfigure }, icon('settings'), L('配置', 'Configure'))),
            catalogError && h('div', { className: 'pa24-source-catalog-error', role: 'alert' }, h('p', null, L('来源目录加载失败：', 'Source directory failed: ') + catalogError), h('button', { type: 'button', onClick: onReload, disabled: catalogBusy }, icon('refresh'), catalogBusy ? L('来源加载中…', 'Loading sources…') : L('重试加载来源', 'Retry sources'))),
            catalogBusy && !catalogError && h('p', { className: 'pa24-meta', role: 'status' }, L('正在读取来源目录…', 'Reading source directory…')),
            loading ? h('p', { className: 'pa24-meta' }, L('正在读取来源证据…', 'Reading source evidence…')) : unavailable ? h('p', { className: 'pa24-meta' }, L('来源查询证据尚未取得；读取失败不会替换为无来源或无结果。', 'Source query evidence is unavailable; a failed read is not replaced by no sources or an empty result.')) : sources.length === 0 && !catalogError ? h('p', { className: 'pa24-meta' }, L(`尚未登记来源，不能据此判断没有${itemName}。`, `No registered sources; this does not prove there are no ${itemName}.`)) : null,
            sources.map(row => h('section', { className: 'pa24-source-evidence', key: row.sourceId },
              h('div', { className: 'pa24-row pa24-between' }, h('strong', null, row.name), badge(stateLabel(row), row.state === 'complete' ? 'blue' : row.state === 'unverified' || row.state === 'disabled' ? 'neutral' : 'amber', row.state === 'complete' ? 'check' : row.state === 'failed' ? 'alert' : 'info')),
              h('p', { className: 'pa24-meta' }, (row.platform === 'wecom' ? L('企业微信', 'WeCom') : L('飞书', 'Feishu')) + L(' · 角色条件：', ' · Role filter: ') + roleLabel(row.filter)),
              h('p', { className: 'pa24-meta' }, L('最近完整：', 'Last complete: ') + (row.lastCompleteAt ? date(row.lastCompleteAt, tz) : L('尚无完整观察', 'No complete observation'))),
              h('p', { className: 'pa24-meta' }, L('最近观察：', 'Latest observation: ') + (row.checkedAt ? date(row.checkedAt, tz) : L('尚无观察', 'No observation'))),
              row.reason && h('p', { className: row.state === 'failed' || row.state === 'partial' ? 'pa24-source-reason' : 'pa24-meta' }, row.reason),
              row.state !== 'disabled' && h('button', { type: 'button', className: 'pa24-quiet', disabled: busy, onClick: () => onRetry(row.sourceId) }, icon('refresh'), L(`重试${row.name}`, `Retry ${row.name}`)))));
        }

        const calendarDay = (value, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
        const calendarTime = (value, timeZone) => new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
        const shiftCalendarDay = (value, amount) => {
          const [year, month, day] = value.split('-').map(Number), shifted = new Date(Date.UTC(year, month - 1, day + amount));
          return shifted.toISOString().slice(0, 10);
        };
        const calendarRange = (event, fallbackZone) => {
          const zone = event.timezone || fallbackZone || 'Asia/Shanghai', startDay = calendarDay(event.start, zone);
          if (event.allDay) {
            const endDay = calendarDay(new Date(Date.parse(event.end) - 1).toISOString(), zone), days = startDay === endDay ? startDay : L(`${startDay} 至 ${endDay}`, `${startDay} to ${endDay}`);
            return { zone, allDay: true, short: L('全天', 'All day'), detail: days + L(' · 全天', ' · All day') };
          }
          const endDay = calendarDay(event.end, zone), startTime = calendarTime(event.start, zone), endTime = calendarTime(event.end, zone);
          return { zone, allDay: false, startDay, endDay, startTime, endTime, short: startTime, detail: startDay === endDay ? `${startDay} · ${startTime}–${endTime}` : `${startDay} ${startTime} → ${endDay} ${endTime}` };
        };
        const originalLink = location => /^https?:\/\//.test(location.locator?.url || '') && h('a', { className: 'pa24-link-button', href: location.locator.url, target: '_blank', rel: 'noreferrer' }, icon('external'), L('打开原日程', 'Open original event'));

        function CalendarNext({ data, tz }) {
          const next = data.next;
          if (!next) return h('section', { className: 'pa24-calendar-next pa24-calendar-next-empty', 'data-testid': 'calendar-next' }, icon('clock'), h('div', null,
            h('h3', null, data.complete ? L('当前筛选没有下一场', 'No next event in this filter') : L('当前可展示结果没有下一场', 'No next event in available observations')),
            h('p', { className: 'pa24-meta' }, data.fresh ? L('本次完整筛选中没有结束时间晚于现在的日程。', 'This complete verification found no event ending after now.') : data.complete ? L('保存的完整筛选中没有结束时间晚于现在的日程；本次未访问原平台。', 'Saved complete observations contain no event ending after now; this read did not access the platforms.') : L('当前可展示结果未提供下一场；查询不完整，不能据此判断全部空闲。', 'Available observations have no next event; incomplete coverage does not prove availability.'))));
          const range = calendarRange(next, tz), ongoing = Date.parse(next.start) <= Date.now() && Date.parse(next.end) > Date.now();
          const conflict = data.conflicts.some(pair => pair.a === next.objectId || pair.b === next.objectId);
          return h('section', { className: 'pa24-calendar-next', 'data-testid': 'calendar-next' },
            h('div', { className: 'pa24-calendar-next-time' }, icon(ongoing ? 'pulse' : 'clock'), range.allDay ? L('全天', 'All day') : range.startTime),
            h('div', { className: 'pa24-calendar-next-body' }, h('div', { className: 'pa24-row' }, badge(ongoing ? L('进行中', 'In progress') : L('下一场', 'Next event'), ongoing ? 'green' : 'blue', ongoing ? 'pulse' : 'clock'), conflict && badge(L('已知时间冲突', 'Known conflict'), 'amber', 'alert'), next.stale && badge(L('保存观察', 'Saved observation'), data.complete ? 'neutral' : 'amber')),
              h('h3', null, next.summary || L('无标题', 'Untitled')), h('p', { className: 'pa24-meta' }, range.detail + ' · ' + range.zone),
              h('div', null, next.locations.map(row => h('p', { key: row.sourceId, className: 'pa24-meta' }, row.sourceName + (row.roles?.complete === false ? L(' · 本人关系未完整核验', ' · Personal role evidence incomplete') : row.roles?.values?.length ? L(' · ', ' · ') + row.roles.values.map(sourceRoleLabel).join(L('、', ', ')) : ''))))),
            h('div', { className: 'pa24-row' }, next.locations.map(row => h('span', { key: row.sourceId }, originalLink(row)))));
        }

        function CalendarEventRow({ event, data, tz, onPrepare, button }) {
          const range = calendarRange(event, tz), conflict = data.conflicts.some(pair => pair.a === event.objectId || pair.b === event.objectId);
          return h('div', { className: 'pa24-agenda-row', 'data-testid': 'calendar-event' },
            h('div', { className: 'pa24-agenda-time' }, range.allDay ? L('全天', 'All day') : range.startTime, h('small', null, range.allDay ? calendarDay(event.start, range.zone) : range.endDay === range.startDay ? range.endTime : range.endDay + ' ' + range.endTime)),
            h('article', { className: 'pa24-event-card' },
              h('div', { className: 'pa24-row pa24-between' }, h('h3', null, event.summary || L('无标题', 'Untitled')), h('div', { className: 'pa24-row' }, conflict && badge(L('已知时间冲突', 'Known conflict'), 'amber', 'alert'), event.stale && badge(L('保存观察', 'Saved observation'), data.complete ? 'neutral' : 'amber', 'clock'))),
              h('p', { className: 'pa24-meta' }, range.detail + ' · ' + range.zone),
              event.recurring && h('p', { className: 'pa24-meta' }, L('重复日程 · 变更前需明确本次、以后或全系列', 'Recurring event · specify this instance, future instances, or the series before changing')),
              event.locations.map(location => h('div', { key: location.sourceId, className: 'pa24-event-location' },
                h('div', { className: 'pa24-row' }, h('p', { className: 'pa24-meta' }, location.sourceName + ' · ' + (location.platform === 'wecom' ? L('企业微信', 'WeCom') : L('飞书', 'Feishu'))),
                  location.capabilities?.update === 'denied' && location.capabilities?.cancel === 'denied' && badge(L('只读来源', 'Read-only source'), 'neutral')),
                h('p', { className: 'pa24-meta' }, location.roles.complete ? location.roles.values.length ? location.roles.values.map(sourceRoleLabel).join(L('、', ', ')) : L('未确认本人参与或组织', 'No confirmed personal participation or organization') : L('本人关系未完整核验', 'Personal role evidence is incomplete')),
                location.roles.reason && h('p', { className: 'pa24-meta' }, location.roles.reason),
                h('div', { className: 'pa24-row' }, originalLink(location), button('chat', L('改期', 'Reschedule'), () => onPrepare('改期', event, location), { className: 'pa24-quiet' }),
                  button('chat', L('取消日程', 'Cancel event'), () => onPrepare('取消日程，先核验原来源与影响范围', event, location), { className: 'pa24-quiet' }),
                  button('chat', L('仅取消本人提醒', 'Remove my reminder only'), () => onPrepare('仅取消本人提醒，保留会议', event, location), { className: 'pa24-quiet' }))))));
        }

        function CalendarDetail(helpers) {
          const { state, tz, button, openRobot, openCard } = helpers, binding = state.workspaceBinding;
          const today = () => calendarDay(new Date(), tz || 'Asia/Shanghai');
          const [day, setDay] = React.useState(today), [period, setPeriod] = React.useState('day'), [source, setSource] = React.useState(''), [role, setRole] = React.useState('');
          const [query, setQuery] = React.useState(''), [offset, setOffset] = React.useState(0), [readEpoch, retryRead] = React.useReducer(n => n + 1, 0);
          const [view, setView] = React.useState({ key: '', data: null, error: '', busy: false, mode: 'read' });
          const [catalog, setCatalog] = React.useState({ key: '', entries: [], error: '', busy: false }), [sourceEpoch, reloadSources] = React.useReducer(n => n + 1, 0);
          const [draft, setDraft] = React.useState(''), [draftFocus, setDraftFocus] = React.useState(0), [note, setNote] = React.useState('');
          const sequence = React.useRef(0), catalogSequence = React.useRef(0), draftRef = React.useRef(null), limit = 20;
          const args = JSON.stringify({ date: day, period, ...(source ? { sourceId: source } : {}), ...(role ? { role } : {}), query, offset, limit, workspaceBinding: binding });
          const validateView = result => {
            if (result.workspaceBinding !== binding) throw new Error(L('工作区已变化，请刷新后重试。', 'Workspace changed. Refresh and retry.'));
            const validEvent = row => row && typeof row.objectId === 'string' && Number.isFinite(Date.parse(row.start)) && Number.isFinite(Date.parse(row.end)) && Array.isArray(row.locations);
            if (!Array.isArray(result.events) || !result.events.every(validEvent) || (result.next != null && !validEvent(result.next)) || !Array.isArray(result.sources) || !Array.isArray(result.conflicts)) throw new Error(L('日程响应不完整，请重新读取。', 'Incomplete calendar response. Retry reading.'));
            return result;
          };
          React.useEffect(() => {
            const abort = new AbortController(), epoch = ++catalogSequence.current;
            setCatalog(old => ({ key: binding, entries: old.key === binding ? old.entries : [], busy: true, error: '' }));
            void rpc('sources', { workspaceBinding: binding }, abort.signal).then(result => {
              if (!Array.isArray(result.entries) || !result.entries.every(row => row && typeof row.id === 'string' && typeof row.domain === 'string' && typeof row.name === 'string')) throw new Error(L('日历来源响应不完整。', 'Incomplete calendar source response.'));
              if (!abort.signal.aborted && epoch === catalogSequence.current) setCatalog({ key: binding, entries: result.entries.filter(row => row.domain === 'calendar'), busy: false, error: '' });
            }).catch(error => { if (!abort.signal.aborted && epoch === catalogSequence.current) setCatalog(old => ({ ...old, busy: false, error: error.message })); });
            return () => { abort.abort(); catalogSequence.current++; };
          }, [binding, sourceEpoch]);
          React.useEffect(() => {
            const abort = new AbortController(), epoch = ++sequence.current;
            setView(old => ({ key: args, data: old.key === args ? old.data : null, busy: true, error: '', mode: 'read' }));
            void rpc('calendar', JSON.parse(args), abort.signal).then(result => {
              if (!abort.signal.aborted && epoch === sequence.current) setView({ key: args, data: validateView(result), busy: false, error: '', mode: 'read' });
            }).catch(error => { if (!abort.signal.aborted && epoch === sequence.current) setView(old => ({ ...old, busy: false, error: error.message, mode: 'read' })); });
            return () => { abort.abort(); sequence.current++; };
          }, [args, readEpoch]);
          React.useEffect(() => { if (draftFocus && draft) { draftRef.current?.focus(); draftRef.current?.scrollIntoView?.({ block: 'nearest' }); } }, [draftFocus]);
          const verify = async sourceId => {
            const epoch = ++sequence.current, request = JSON.parse(args);
            setView(old => ({ key: args, data: old.key === args ? old.data : null, busy: true, error: '', mode: 'verify' }));
            try {
              const verified = validateView(await rpc('action', { type: 'calendar.verify', ...request, ...(sourceId ? { sourceId } : {}) }));
              if (epoch !== sequence.current) return;
              const result = sourceId ? validateView(await rpc('calendar', request)) : verified;
              if (epoch === sequence.current) { setView({ key: args, data: result, busy: false, error: '', mode: 'read' }); reloadSources(); await helpers.refresh(); }
            } catch (error) { if (epoch === sequence.current) setView(old => ({ ...old, busy: false, error: error.message, mode: 'verify' })); }
          };
          const change = setter => value => { setter(value); setOffset(0); };
          const changeDay = value => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) change(setDay)(value); };
          const select = (label, value, setter, choices) => h('label', { className: 'pa24-field' }, label, h('select', { value, onChange: event => change(setter)(event.target.value) }, choices.map(([value, title]) => h('option', { key: value, value }, title))));
          const prepare = (action, event, location) => {
            const scope = location ? `来源：${location.sourceName}（sourceId=${location.sourceId}），原日程 ${event.summary}，${event.start} 至 ${event.end}，eventId=${location.locator.eventId}，objectId=${event.objectId}。` : `日期：${day}，时区：${tz}。${source ? `sourceId=${source}。` : ''}`;
            setDraft(`请帮我${action}。${scope}${action === '改期' ? '新时间：请补充。' : action === '创建日程' ? '主题和起止时间：请补充。' : ''}${event?.recurring ? '这是重复日程，请先确认本次、以后或全系列范围。' : ''}`);
            setNote(''); setDraftFocus(value => value + 1);
          };
          const data = view.key === args ? view.data : null, sources = catalog.key === binding ? catalog.entries : [];
          const filtered = Boolean(source || role || query.trim() || period !== 'day'), enabled = data?.sources.filter(row => row.state !== 'disabled') || [];
          const emptyState = () => {
            if (data.count > 0) return empty('calendar', 'neutral', L('当前页没有日程', 'No events on this page'), data.complete ? L('完整筛选结果仍在其他页，请返回上一页。', 'Other pages still contain filtered results; return to the previous page.') : L('当前可展示结果可能在其他页；范围未完整核验，请返回上一页查看。', 'Available observations may be on other pages; coverage is incomplete. Return to the previous page.'), button('arrow', L('上一页', 'Previous'), () => setOffset(Math.max(0, offset - limit))));
            if (!data.sources.length) return empty('calendar', 'neutral', L('尚未登记日历来源', 'No calendar sources'), L('登记并核验来源后才能查阅日程；当前状态不代表没有日程。', 'Register and verify sources to read events; this state does not mean there are no events.'), button('settings', L('配置日历来源', 'Configure sources'), () => openCard('config', 'pa24-sources')));
            if (!data.complete) return empty('calendar', 'amber', L('当前没有可展示日程', 'No displayable events'), L('可查看逐来源原因并重试；未完整核验不等于没有日程。', 'Inspect per-source reasons and retry; incomplete coverage does not mean no events.'), button('refresh', L('核验日历', 'Verify calendars'), () => verify(), { disabled: view.busy }));
            if (data.fresh) return empty('calendar', 'neutral', filtered ? L('当前筛选没有匹配日程', 'No events match this filter') : L('该日没有日程', 'No events on this day'), filtered ? L('可以调整日期、时段、来源、参与范围或搜索词。', 'Adjust the date, period, source, role, or search text.') : L('本次完整核验未发现与当前日期和时段重叠的日程。', 'This complete check found no events overlapping the selected date and period.'), button('plus', L('创建日程', 'Create event'), () => prepare('创建日程')));
            return empty('calendar', 'neutral', filtered ? L('保存的完整观察中没有匹配', 'No match in saved complete observations') : L('保存的完整观察为空', 'Saved complete observations are empty'), L('这是普通查阅结果，未在本次访问原平台；需要最新状态时再明确核验。', 'This ordinary read did not access the platforms; explicitly verify when current state is needed.'), button('refresh', L('核验日历', 'Verify calendars'), () => verify(), { disabled: view.busy }));
          };
          return h('section', { className: 'pa24-calendar-detail', 'data-testid': 'calendar-detail' },
            sectionHead('calendar', L('日程', 'Calendar'), L('当前筛选的下一场、今日安排与查询完整性。普通查看只读保存观察。', 'Next event, today’s schedule, and query completeness for the current filter. Ordinary browsing only reads saved observations.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新', 'Refresh'), retryRead, { disabled: view.busy, className: 'pa24-quiet', title: L('刷新保存观察', 'Refresh saved observations') }),
                button('check', view.busy && view.mode === 'verify' ? L('核验中…', 'Verifying…') : L('核验日历', 'Verify calendars'), () => verify(), { disabled: view.busy }),
                button('plus', L('创建日程', 'Create event'), () => prepare('创建日程'), { className: 'pa24-primary' }), button('settings', L('配置日历来源', 'Configure sources'), () => openCard('config', 'pa24-sources'), { className: 'pa24-quiet' })), 'amber'),
            h(SourceQueryState, { data, error: view.key === args ? view.error : '', busy: view.busy, verifying: view.busy && view.mode === 'verify', onRetry: retryRead, tz }),
            data && h('div', { className: 'pa24-calendar-metrics', 'data-testid': 'calendar-metrics' },
              [[data.count, data.complete ? day === today() ? L('今日安排', 'Today’s events') : L('当日安排', 'Events on this day') : day === today() ? L('今日可展示', 'Available today') : L('当前可展示', 'Currently available'), data.complete ? L('完整筛选结果', 'Complete filtered result') : L('保存观察，不是完整总数', 'Saved observations, not a complete total')],
                [data.events.length, L('本页日程', 'Events on this page'), L(`第 ${Math.floor(offset / limit) + 1} 页`, `Page ${Math.floor(offset / limit) + 1}`)],
                [data.conflicts.length, L('已知冲突', 'Known conflicts'), data.complete ? L('当前完整筛选，不自动改期', 'Complete filter; no automatic changes') : L('仅当前可展示证据，不自动改期', 'Available evidence only; no automatic changes')],
                [`${enabled.filter(row => row.state === 'complete').length} / ${enabled.length}`, L('完整来源', 'Complete sources'), data.fresh ? L('本次核验', 'This verification') : L('逐来源证据见侧栏', 'Per-source evidence in the sidebar')]].map(([value, label, meta]) => h('div', { className: 'pa24-calendar-metric', key: label }, h('span', null, label), h('strong', null, value), h('small', null, meta)))),
            data && h(CalendarNext, { data, tz }),
            h('div', { className: 'pa24-calendar-layout' }, h('div', { className: 'pa24-calendar-main' }, h('section', { className: 'pa24-card pa24-calendar-timeline' },
              h('div', { className: 'pa24-calendar-toolbar' },
                h('div', { className: 'pa24-date-navigation' }, button('arrow', L('前一天', 'Previous day'), () => changeDay(shiftCalendarDay(day, -1)), { className: 'pa24-quiet' }),
                  h('label', { className: 'pa24-field' }, L('日期', 'Date'), h('input', { type: 'date', value: day, onChange: event => changeDay(event.target.value) })), button('arrow', L('后一天', 'Next day'), () => changeDay(shiftCalendarDay(day, 1)), { className: 'pa24-quiet' }), button('clock', L('今天', 'Today'), () => changeDay(today()), { className: 'pa24-quiet' })),
                h('div', { className: 'pa24-source-fields' }, select(L('时段', 'Period'), period, setPeriod, [['day', L('全天', 'Whole day')], ['morning', L('上午', 'Morning')], ['afternoon', L('下午', 'Afternoon')], ['evening', L('晚间', 'Evening')]]),
                  select(L('日历来源', 'Calendar source'), source, setSource, [['', L('全部已登记来源', 'All registered sources')], ...(source && !sources.some(row => row.id === source) ? [[source, source + L('（来源待加载）', ' (source pending)')]] : []), ...sources.map(row => [row.id, row.name])]),
                  select(L('参与范围', 'Role filter'), role, setRole, [['', L('按各来源默认', 'Source defaults')], ['all', L('全部授权可见', 'All authorized events')], ['involved', L('本人参与或组织', 'Participating or organizing')], ['organizer', L('本人组织', 'Organizing')], ['participant', L('本人参与', 'Participating')]]),
                  h('label', { className: 'pa24-field' }, L('搜索日程', 'Search events'), h('input', { type: 'search', value: query, onChange: event => change(setQuery)(event.target.value) })))),
              data && h('div', { className: 'pa24-calendar-agenda', 'aria-label': L('日程时间线', 'Calendar timeline') }, data.events.length === 0 ? emptyState() : data.events.map(event => h(CalendarEventRow, { key: event.objectId, event, data, tz, onPrepare: prepare, button }))),
              data && h('div', { className: 'pa24-calendar-page-footer' }, button('arrow', L('上一页', 'Previous'), () => setOffset(Math.max(0, offset - limit)), { disabled: view.busy || offset === 0 }),
                h('span', { className: 'pa24-meta' }, L(`第 ${Math.floor(offset / limit) + 1} 页 · 本页 ${data.events.length} / 可展示 ${data.count}`, `Page ${Math.floor(offset / limit) + 1} · ${data.events.length} on this page / ${data.count} available`)),
                button('arrow', L('下一页', 'Next'), () => setOffset(offset + limit), { disabled: view.busy || !data.hasMore })))),
            h(SourceScopePanel, { sources: data?.sources || [], tz, onRetry: verify, busy: view.busy, catalogError: catalog.key === binding ? catalog.error : '', catalogBusy: catalog.busy, onReload: reloadSources, onConfigure: () => openCard('config', 'pa24-sources'), loading: !data && view.busy, unavailable: !data && !view.busy })),
            draft && h('section', { className: 'pa24-card pa24-calendar-draft' }, h('h3', null, L('带上下文继续对话', 'Continue with context')), h('p', { className: 'pa24-meta' }, L('草稿已生成并聚焦。补充后复制到对话，由你检查并发送；不会自动发送或直接写入。', 'The draft is visible and focused. Copy it into chat, review, and send; nothing is sent or written automatically.')),
              h('textarea', { ref: draftRef, 'aria-label': L('日程对话内容', 'Calendar chat draft'), rows: 5, value: draft, onChange: event => setDraft(event.target.value) }),
              h('div', { className: 'pa24-row' }, button('chat', L('复制并打开对话', 'Copy and open chat'), async () => { try { await navigator.clipboard.writeText(draft); } catch { setNote(L('无法自动复制，请手动复制上方内容后打开对话。', 'Copy the text manually, then open chat.')); return; } await openRobot(); setNote(L('已复制，请粘贴到对话并检查后发送。', 'Copied. Paste into chat, review, and send.')); }), button('chat', L('打开对话', 'Open chat'), openRobot, { className: 'pa24-quiet' })), note && h('p', { role: 'status' }, note)),
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
            sectionHead('history', L('旧计划兼容控制', 'Legacy plan controls'), L('与上方相同的旧计划；保留原时间、语音、Skill 和运行控制，复杂变更仍通过24私助会话。', 'The same legacy plans as above, with their original timing, voice, skill and run controls; complex changes stay in chat.'),
              h('div', { className: 'pa24-row' }, button('refresh', L('刷新', 'Refresh'), refresh, { className: 'pa24-quiet' }), button('chat', L('通过对话调整', 'Adjust in chat'), openRobot)), 'green'),
            extra._errors?.digests && h('div', { role: 'alert', className: 'pa24-error' }, h('strong', null, L('计划读取失败', 'Failed to read plans')), h('p', null, extra._errors.digests)),
            !extra.digests && !extra._errors?.digests && h('div', { className: 'pa24-card pa24-row', role: 'status' }, icon('refresh', { className: 'pa24-spin' }), L('正在读取周期计划…', 'Reading digest plans…')),
            extra.digests && plans.length === 0 && !extra._errors?.digests && h('p', { className: 'pa24-meta' }, L('当前没有旧周期服务记录。上方定时任务使用同一计划账本，不在此新建另一套计划。', 'No legacy digest plans. The scheduled tasks above use the same plan ledger; no second plan type is created here.')),
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
        const planTimeZone = (plan, fallback) => plan.task_config?.timeZone ?? plan.schedule_spec?.daily?.time_zone ?? plan.schedule_spec?.weekly?.time_zone ?? plan.schedule_spec?.cron?.time_zone ?? plan.schedule_spec?.time_zone ?? fallback;
        const planTimingLabel = plan => {
          const spec = plan.schedule_spec || {}, zone = planTimeZone(plan);
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
        function TaskPlanForm({ form, setForm, catalog, binding, config, busy, onPreview, onSave, onDiscard, draft, refreshTick, formError }) {
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
            h('section', { className: 'pa24-form-section' }, h('h3', { className: 'pa24-form-section-title' }, icon('note'), L('任务内容', 'Task content')),
              field(L('名称', 'Name'), text(form.title, value => set('title', value), { maxLength: 120 })),
              field('Skill', options(form.skillId, value => setForm({ ...form, skillId: value, parametersText: '{}' }), [['', L('选择任务或模板', 'Choose a task or template')], ...(catalog?.entries || []).filter(entry => ['task', 'template'].includes(entry.type)).map(entry => [entry.id, entry.name + ' · ' + (entry.source === 'builtin' ? L('内置原件', 'Built-in') : entry.source === 'managed' ? L('受管', 'Managed') : L('工作区', 'Workspace'))])])),
              error && h('p', { role: 'alert', className: 'pa24-error' }, error),
              Object.entries(parameterFields).map(([name, definition]) => field(name + (definition.required ? ' *' : '') + (definition.description ? ' · ' + definition.description : ''),
                h('input', { type: definition.type === 'boolean' ? 'checkbox' : ['integer', 'number'].includes(definition.type) ? 'number' : 'text',
                  ...(definition.type === 'boolean' ? { checked: parameters?.[name] ?? definition.default ?? false } : { value: parameters?.[name] ?? definition.default ?? '', step: definition.type === 'integer' ? 1 : 'any' }),
                  disabled: !parameters, onChange: event => { const value = definition.type === 'boolean' ? event.target.checked : ['integer', 'number'].includes(definition.type) ? Number(event.target.value) : event.target.value;
                    set('parametersText', JSON.stringify({ ...parameters, [name]: value }, null, 2)); } }))),
              !parameters && h('p', { role: 'alert' }, L('参数 JSON 必须是有效对象；修正后可继续编辑参数字段。', 'Parameters must be a valid JSON object before editing fields.')),
              h('details', null, h('summary', null, L('全部参数 JSON', 'All parameters as JSON')), field(L('参数对象', 'Parameter object'), h('textarea', { rows: 4, value: form.parametersText, onChange: event => set('parametersText', event.target.value) })))),
            h('section', { className: 'pa24-form-section' }, h('h3', { className: 'pa24-form-section-title' }, icon('calendarClock'), L('时间规则', 'Timing')),
              field(L('时间规则', 'Timing rule'), options(form.timing.type, value => timing('type', value), [['once', L('一次性', 'Once')], ['daily', L('每天', 'Daily')], ['weekdays', L('周一至周五', 'Monday–Friday')], ['weekly', L('每周', 'Weekly')], ['monthly', L('每月', 'Monthly')], ['interval', L('间隔', 'Interval')], ['advanced', L('高级规则', 'Advanced')]])),
              field(L('时区', 'Time zone'), text(form.timeZone, value => set('timeZone', value))),
              form.timing.type === 'once' && field(L('日期时间（按上方时区，可输入 ISO 偏移）', 'Date and time (zone above, or ISO offset)'), text(form.timing.at, value => timing('at', value), { placeholder: '2026-11-01T09:00:00' })),
              ['daily', 'weekdays', 'weekly', 'monthly'].includes(form.timing.type) && field(L('时刻', 'Time'), text(form.timing.time || '09:00:00', value => timing('time', value.length === 5 ? value + ':00' : value), { type: 'time', step: 60 })),
              form.timing.type === 'weekly' && h('fieldset', { className: 'pa24-note' }, h('legend', null, L('每周哪些天', 'Weekdays')), [1, 2, 3, 4, 5, 6, 7].map(day => field(L('星期' + '一二三四五六日'[day - 1], ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day - 1]), h('input', { type: 'checkbox', checked: (form.timing.weekdays || []).includes(day), onChange: event => timing('weekdays', event.target.checked ? [...(form.timing.weekdays || []), day].sort() : form.timing.weekdays.filter(value => value !== day)) })))),
              form.timing.type === 'monthly' && field(L('每月几日（无该日则跳过）', 'Day of month (skip missing dates)'), text(form.timing.day || 1, value => timing('day', Number(value)), { type: 'number', min: 1, max: 31 })),
              form.timing.type === 'interval' && field(L('间隔秒数（至少 60 秒）', 'Interval seconds (minimum 60)'), text(form.timing.seconds || 3600, value => timing('seconds', Number(value)), { type: 'number', min: 60 })),
              form.timing.type === 'advanced' && field(L('Cron 表达式', 'Cron expression'), text(form.timing.expression, value => timing('expression', value), { placeholder: '0 9 * * 1-5' })),
              field(L('累计执行时限（分钟，等待不计入）', 'Execution limit (minutes, waits excluded)'), text(form.executionLimitMs / 60000, value => set('executionLimitMs', Number(value) * 60000), { type: 'number', min: 1 / 60, max: 1440, step: 'any' }))),
            h('section', { className: 'pa24-form-section' }, h('h3', { className: 'pa24-form-section-title' }, icon('check'), L('结果、投递与授权', 'Results, delivery and authorization')),
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
                }))),
            draft && h(PlanAuthorization, { value: draft, config }),
            h('div', { className: 'pa24-form-actions' },
              h('button', { type: 'button', onClick: onPreview }, icon('calendarClock'), L('校验并预览时间', 'Validate and preview')),
              h('button', { type: 'button', className: 'pa24-primary', disabled: !draft, onClick: onSave }, icon('check'), L('保存为暂停', 'Save paused')),
              h('button', { type: 'button', className: 'pa24-quiet', onClick: onDiscard }, icon('close'), L('放弃草稿', 'Discard draft')),
              formError && h('p', { role: 'alert', className: 'pa24-error' }, formError),
              h('p', { className: 'pa24-meta' }, draft ? L('预览已通过，可保存为暂停；不会触发运行。', 'Preview passed. Save paused without running.') : L('请先校验并预览时间；通过后才能保存为暂停。', 'Validate and preview first; saving paused unlocks after a valid preview.'))));
        }
        function TaskPlansDetail(helpers) {
          const { state, extra, config, tz, planStates, openCard, refresh } = helpers, binding = state.workspaceBinding;
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
          const update = patch => model.update({ ...patch, error: '', draftError: '', preview: null, approved: false });
          const change = async (payload, errorScope = 'detail') => {
            if (model.getSnapshot().busy) return;
            const selection = model.getSnapshot();
            const body = { type: 'plan.change', workspaceBinding: binding, ...payload }, key = JSON.stringify(body), prior = model.getSnapshot().request;
            const request = prior?.key === key ? prior : { key, id: crypto.randomUUID() }; model.update({ request, busy: true, ...(errorScope === 'form' ? { draftError: '' } : { error: '' }), note: '' });
            try {
              const result = await rpc('action', { ...body, requestId: request.id });
              const current = model.getSnapshot(), sameSelection = current.selected === selection.selected && current.form === selection.form;
              model.update({ ...(sameSelection ? { selected: result.plan?.id || selection.selected, form: null, preview: null, approved: false } : {}), request: null, tick: (model.getSnapshot().tick || 0) + 1,
                note: result.trigger ? (result.trigger.reason || L('已接纳本次触发；执行状态见运行记录。', 'Trigger accepted; see run history for execution.')) : L('操作已保存，原历史保留。', 'Saved; original history retained.') });
              await refresh().catch(() => {});
            } catch (error) { model.update(errorScope === 'form' ? { draftError: error.message } : { error: error.message }); }
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
            const form = formPayload(); if (save) await change({ ...form, op: 'save' }, 'form'); else { model.update({ busy: true, draft: null, draftError: '' }); const draft = await rpc('plans.draft', { ...form, workspaceBinding: binding }); if (draft.workspaceBinding === binding && model.getSnapshot().form === view.form) model.update({ draft }); }
          } catch (error) { model.update({ draftError: error.message }); } finally { if (!save) model.update({ busy: false }); } };
          const p = detail?.plan, selectedRow = list.data?.rows.find(row => row.id === p?.id), disabled = view.busy;
          const button = (label, fn, { name, ...extra } = {}) => h('button', { key: label, type: 'button', disabled, onClick: () => void fn(), ...extra }, name && icon(name), label);
          const summary = extra.plans, summaryMetrics = summary ? [
            ['calendarClock', 'blue', L('下一次运行', 'Next run'), summary.next ? date(summary.next.at, summary.next.timeZone || tz) : L('暂无已核验触发时间', 'No verified occurrence'), summary.next ? summary.next.title + ' · ' + (summary.next.timeZone || tz) : L('当前没有可核验触发', 'No verified schedule')],
            ['play', 'green', L('启用', 'Enabled'), summary.enabled ?? 0, L('当前启用的计划', 'Enabled plans')],
            ['pause', 'neutral', L('暂停 / 未启用', 'Paused / inactive'), summary.paused ?? 0, L('不进入未来触发', 'No future occurrences')],
            ['alert', 'amber', L('需处理', 'Needs attention'), summary.blocked ?? 0, L('依赖、权限、预算或其他阻断', 'Dependency, permission, budget or other blockers')],
          ] : [];
          return h('section', { className: 'pa24-manager' },
            sectionHead('calendarClock', L('定时任务', 'Scheduled tasks'), L('时间 + Skill。保存、启用、单次执行和投递分别留档。', 'Time + skill. Configuration, activation, execution and delivery have separate records.'), button(L('新建计划', 'New plan'), () => fresh(null), { name: 'plus', className: 'pa24-primary' }), 'green'),
            summary && h('div', { className: 'pa24-plan-metrics' }, summaryMetrics.map(([name, tone, label, value, hint]) => h('div', { key: label, className: 'pa24-plan-metric' }, tile(name, tone), h('div', null, h('div', { className: 'pa24-plan-cell-label' }, label), h('strong', null, value), h('small', null, hint))))),
            summary?.timingError && h('p', { role: 'alert', className: 'pa24-error' }, summary.timingError),
            extra._errors?.plans && h('p', { role: 'alert', className: 'pa24-error' }, extra._errors.plans),
            h('div', { className: 'pa24-row' }, ['morning', 'evening', 'weekly'].map(preset => button(({ morning: L('晨报预设', 'Morning preset'), evening: L('复盘预设', 'Evening preset'), weekly: L('周回顾预设', 'Weekly preset') })[preset], () => fresh(preset), { name: preset === 'morning' ? 'sunrise' : preset === 'evening' ? 'sunset' : 'calendarRange' })), button(L('刷新', 'Refresh'), async () => { model.update({ tick: (view.tick || 0) + 1 }); await refresh().catch(() => {}); }, { name: 'refresh' })),
            catalogError && h('p', { role: 'alert', className: 'pa24-error' }, catalogError),
            catalog && catalog.discovery !== 'complete' && h('p', { role: 'alert' }, catalog.discoveryError || L('Skill 目录读取不完整，请核验接入后刷新。', 'Skill discovery is incomplete; check access and refresh.')),
            view.error && h('p', { role: 'alert', className: 'pa24-error' }, view.error), view.note && h('p', { role: 'status' }, view.note),
            view.form && h(TaskPlanForm, { form: view.form, setForm: form => update({ form, draft: null }), catalog: catalog?.workspaceBinding === binding ? catalog : null, binding, config, refreshTick: view.tick, busy: disabled, onPreview: () => saveDraft(false), onSave: () => saveDraft(true), onDiscard: () => update({ form: null, draft: null }), draft: view.draft, formError: view.draftError }),
            h('div', { className: 'pa24-row' }, h('label', { className: 'pa24-field' }, L('搜索计划', 'Search plans'), h('input', { value: query, onChange: event => update({ query: event.target.value, offset: 0 }) })),
              h('label', { className: 'pa24-field' }, L('计划状态', 'Plan status'), h('select', { value: filter, onChange: event => update({ filter: event.target.value, offset: 0 }) }, [['', L('全部未回收', 'All unrecycled')], ['enabled', L('启用', 'Enabled')], ['paused', L('暂停', 'Paused')], ['blocked', L('需处理', 'Needs attention')], ['recycled', L('回收站', 'Recycle bin')]].map(([value, label]) => h('option', { key: value, value }, label)))),
              h('label', { className: 'pa24-field' }, L('按 Skill 筛选', 'Filter by skill'), h('select', { value: skillFilter, onChange: event => update({ skillFilter: event.target.value, offset: 0 }) }, h('option', { value: '' }, L('全部 Skill', 'All skills')), (catalog?.entries || []).map(entry => h('option', { key: entry.id, value: entry.id }, entry.name + ' · ' + entry.source))))),
            list.error && h('p', { role: 'alert', className: 'pa24-error' }, L('读取失败；保留上次读取结果：', 'Read failed; last results retained: ') + list.error),
            list.loading && h('p', { role: 'status' }, L('正在读取计划…', 'Reading plans…')),
            list.data && h('div', { className: 'pa24-card pa24-plan-list' }, h('p', { className: 'pa24-meta' }, L('匹配计划 ', 'Matching plans: ') + list.data.total),
              list.data.rows.length > 0 && h('div', { className: 'pa24-plan-row pa24-plan-header' }, h('span', null, L('计划 / Skill', 'Plan / skill')), h('span', null, L('时间规则', 'Timing')), h('span', null, L('下次运行', 'Next run')), h('span', null, L('状态', 'Status')), h('span', null, L('最近执行', 'Last execution'))),
              !list.data.rows.length && h('p', null, query || skillFilter || (filter && filter !== 'recycled') ? L('没有匹配的计划', 'No matching plans') : filter === 'recycled' ? L('回收站为空', 'The recycle bin is empty') : L('尚无计划，可新建或选择预设。', 'No plans. Create one or choose a preset.')),
              list.data.rows.map(row => h('article', { key: row.id, className: 'pa24-plan-row' },
                h('div', { className: 'pa24-plan-main' }, button(row.title, () => update({ selected: row.id, form: null, draft: null }), { 'aria-pressed': row.id === view.selected }), h('p', { className: 'pa24-meta' }, row.skill)),
                h('div', { className: 'pa24-plan-cell' }, h('span', { className: 'pa24-plan-cell-label' }, L('时间规则', 'Timing')), planTimingLabel(row)),
                h('div', { className: 'pa24-plan-cell' }, h('span', { className: 'pa24-plan-cell-label' }, L('下次运行', 'Next run')), row.nextTimes?.[0] ? date(row.nextTimes[0], planTimeZone(row, tz)) : L('暂无已核验触发时间', 'No verified occurrence')),
                h('div', { className: 'pa24-plan-cell' }, h('span', { className: 'pa24-plan-cell-label' }, L('状态', 'Status')), planStateLabel(row),
                  row.timingError && h('p', { role: 'alert', className: 'pa24-error' }, row.timingError),
                  !row.task_config && h('p', { className: 'pa24-meta' }, L('旧计划：核验后沿原关联升级', 'Legacy plan: verify before adoption'))),
                h('div', { className: 'pa24-plan-cell' }, h('span', { className: 'pa24-plan-cell-label' }, L('最近执行', 'Last execution')), row.recentRun
                  ? h(React.Fragment, null, runStatusLabel(row.recentRun.status),
                    h('p', { className: 'pa24-meta' }, L('投递：', 'Delivery: ') + deliveryLabel(row.recentRun.delivery_status)),
                    h('p', { className: 'pa24-meta' }, row.recentRun.created_at ? date(row.recentRun.created_at, tz) : L('时间未记录', 'Time not recorded')))
                  : h('span', { className: 'pa24-meta' }, L('暂无执行', 'No executions'))))),
              (list.data.total > 20 || offset > 0) && h('div', { className: 'pa24-row' }, button(L('上一页', 'Previous'), () => update({ offset: Math.max(0, offset - 20) }), { disabled: disabled || !offset }), button(L('下一页', 'Next'), () => update({ offset: offset + 20 }), { disabled: disabled || offset + 20 >= list.data.total }))),
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
                button(L('查看全部运行', 'View all runs'), () => helpers.openRuns({ planId: p.id, range: 'all' })),
                detail.legacyHistory?.length > 0 && button(L('查看旧简报历史', 'View legacy digest history'), () => helpers.openRuns({ kind: 'legacy', planId: p.id, range: 'all' }), { name: 'history' })),
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
            h('details', null, h('summary', null, icon('history'), L('兼容与历史', 'Compatibility and history')), h(DigestDetail, helpers)));
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
          const choices = [...(work.execution_mode !== 'skill' && !work.id.startsWith('pa24-material-') ? [...(active ? [['supplement', L('补充原交办', 'Supplement original work')]] : []), ...(ended || work.status === 'waiting_input' ? [['continue', L('明确接续', 'Explicit continuation')]] : []), ...(!ended ? [['stop', L('停止当前交办', 'Stop current work')]] : [])] : []),
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
        function WorkerRunDetail({ id, binding, openWork, section = 'all' }) {
          const [detail, setDetail] = React.useState(null), [error, setError] = React.useState(''), [diagnostic, setDiagnostic] = React.useState(null), [refresh, setRefresh] = React.useState(0);
          const alive = React.useRef(true);
          React.useEffect(() => { const abort = new AbortController(); let pending = false; alive.current = true;
            const load = async () => { if (pending) return; pending = true; try { const result = await rpc('worker.run', { runId: id, workspaceBinding: binding }, abort.signal); if (!abort.signal.aborted && result.workspaceBinding === binding) { setDetail(result); setError(''); } } catch (error) { if (!abort.signal.aborted) setError(error.message); } finally { pending = false; } };
            void load(); const timer = setInterval(load, 5000); return () => { alive.current = false; abort.abort(); clearInterval(timer); };
          }, [id, binding, refresh]);
          const preview = async () => { try { const result = await rpc('runs.diagnostics', { runId: id, workspaceBinding: binding }); if (alive.current && result.workspaceBinding === binding) setDiagnostic(result); } catch (error) { if (alive.current) setError(error.message); } };
          const run = detail?.run, directMaterial = run?.snapshot?.executor === 'material-action';
          const materialResult = materialReceipt(run?.result), overview = section === 'all' || section === 'overview', delivery = section === 'all' || section === 'delivery', diagnostics = section === 'all' || section === 'diagnostics';
          return h('section', { className: 'pa24-card' }, h('h3', null, L('交办执行与投递', 'Work execution and delivery')),
            h('button', { type: 'button', onClick: () => setRefresh(value => value + 1) }, L('刷新运行状态', 'Refresh run status')),
            error && h('p', { role: 'alert', className: 'pa24-error' }, error), !detail && h('p', { role: 'status' }, L('正在读取运行…', 'Reading run…')),
            run && h('div', null,
              overview && h(React.Fragment, null, run.snapshot?.executor === 'material-action' && h('p', { className: 'pa24-note' }, L('资料直接操作，未启动模型；结果返回原发起入口。重试请回原资料核对回执后明确操作。', 'Direct material action; no model started. Results return to the original entry. Check receipts in the material before retrying.')), h('p', null, runStatusLabel(run.status)), h('p', null, directMaterial ? run.snapshot.title : run.instruction), run.progress && h('p', null, run.progress), run.result && (directMaterial ? h(MaterialFeedback, { value: materialResult }) : h('pre', { className: 'pa24-json' }, run.result)), directMaterial && h('details', null, h('summary', null, L('当次资料操作输入', 'Material action input')), h('pre', { className: 'pa24-json' }, run.instruction)),
                run.progress_detail && h('div', null, h('p', null, L('已完成：', 'Completed: ') + run.progress_detail.completed), h('p', null, L('下一步：', 'Next: ') + run.progress_detail.next)),
                detail.execution && h('p', null, L('累计执行 ', 'Execution ') + Math.round(detail.execution.executionMs / 1000) + L(' 秒；剩余 ', ' s; remaining ') + Math.round(detail.execution.remainingMs / 1000) + L(' 秒', ' s')),
                detail.execution?.blocks.map(block => h('p', { key: block.key }, block.reason)),
                detail.execution?.stop && h('p', null, detail.execution.stop.settledAt ? L('宿主已确认停止', 'Host confirmed stop') : L('已请求停止，仍等待确认', 'Stop requested; awaiting confirmation')),
                h('button', { type: 'button', onClick: () => openWork(run.work_item_id) }, L('查看原助理交办', 'Open original work')),
                h('h4', null, L('补充收到与采用', 'Input receipt and adoption')), (detail.inputs || []).map(row => h('div', { key: row.execution_id }, h('p', null, ({ prepared: L('待接纳', 'Awaiting admission'), received: L('已收到，尚未采用', 'Received, not adopted'), adopted: L('已在原回合采用', 'Adopted in original turn'), rejected: L('未接纳', 'Not admitted'), unknown: L('接纳待核对', 'Admission uncertain') })[row.status]), h('p', null, row.instruction))),
                h('h4', null, L('工具动作与原回执', 'Tool actions and original receipts')), (detail.calls || []).map(call => h('details', { key: call.id }, h('summary', null, call.tool + ' · ' + t(call.status)), h('pre', { className: 'pa24-json' }, JSON.stringify({ arguments: call.args, result: call.result }, null, 2)))),
                !!detail.reviews?.length && h('details', null, h('summary', null, detail.reviewed ? L('当前证据已核对', 'Current evidence reviewed') : L('已有核对，待核验新证据', 'Previous findings; new evidence needs review')), detail.reviews.map(row => h('pre', { key: row.request_id, className: 'pa24-json' }, JSON.stringify(row.record.result, null, 2)))),
                detail.work && ['stopped','failed','timed_out','completed'].includes(run.status) && h(WorkerRunReview, { detail, binding, changed: () => setRefresh(value => value + 1) }),
                h('details', null, h('summary', null, L('当次执行快照', 'Execution snapshot')), h('pre', { className: 'pa24-json' }, JSON.stringify(run.snapshot, null, 2))),
                h('button', { type: 'button', onClick: () => saveDownload({ filename: '24pa-result-' + id + '.json', content: JSON.stringify({ run, inputs: detail.inputs, calls: detail.calls, deliveries: detail.deliveries }, null, 2) }) }, L('下载当次结果', 'Download run result'))),
              delivery && h(React.Fragment, null, h('h4', null, L('固定结果投递', 'Fixed result delivery')), !(detail.deliveries || []).length && h('p', null, L('尚无结果投递', 'No result delivery yet')), (detail.deliveries || []).map(row => h('p', { key: row.id }, row.channel + ' · ' + row.target + ' · ' + deliveryLabel(row.status, row.channel) + (row.last_error ? ' · ' + row.last_error : ''))),
                !!detail.deliveries?.length && h(PlanDeliveryControls, { detail: { run, deliveries: detail.deliveries.map(row => ({ id: row.id, deliveryStatus: row.status, deliveries: [{ outbox_id: row.id, outbox: row, component: row.kind, fingerprint: row.fingerprint }] })) }, binding, onChanged: () => setRefresh(value => value + 1) })),
              diagnostics && h(React.Fragment, null, h('p', { className: 'pa24-meta' }, L('诊断只生成脱敏预览；确认预览内容后才下载。', 'Diagnostics require a redacted preview before download.')), h('button', { type: 'button', onClick: preview }, L('预览脱敏诊断', 'Preview redacted diagnostics')),
                diagnostic && h('div', { className: 'pa24-note' }, h('p', null, diagnostic.message), h('pre', { className: 'pa24-json' }, diagnostic.content), h('button', { type: 'button', onClick: () => saveDownload(diagnostic) }, L('确认下载这份诊断', 'Confirm diagnostic download'))))));
        }

        function HistoryDrawer({ title, subtitle, onClose, tabs, children }) {
          const [section, setSection] = React.useState(tabs?.[0]?.[0] || 'overview');
          const dialog = React.useRef(null), closeButton = React.useRef(null), previousFocus = React.useRef(null), closeHandler = React.useRef(onClose);
          closeHandler.current = onClose;
          React.useEffect(() => {
            previousFocus.current = document.activeElement;
            closeButton.current?.focus();
            const onKey = event => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeHandler.current(); return; }
              if (event.key !== 'Tab' || !dialog.current) return;
              const focusable = [...dialog.current.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')]
                .filter(node => !node.closest('[hidden]') && !(node.closest('details:not([open])') && node.tagName !== 'SUMMARY'));
              if (!focusable.length) { event.preventDefault(); dialog.current.focus(); return; }
              const first = focusable[0], last = focusable.at(-1), current = document.activeElement;
              if (event.shiftKey && (current === first || !dialog.current.contains(current))) { event.preventDefault(); last.focus(); }
              else if (!event.shiftKey && (current === last || !dialog.current.contains(current))) { event.preventDefault(); first.focus(); }
            };
            document.addEventListener('keydown', onKey, true);
            return () => { document.removeEventListener('keydown', onKey, true); if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
          }, []);
          const current = tabs?.find(([value]) => value === section);
          return h('div', { className: 'pa24-drawer-backdrop' }, h('section', { ref: dialog, className: 'pa24-drawer', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'pa24-history-drawer-title', tabIndex: -1 },
            h('header', { className: 'pa24-drawer-header' }, h('div', null, h('h2', { id: 'pa24-history-drawer-title' }, title), h('p', { className: 'pa24-meta' }, subtitle)),
              h('button', { ref: closeButton, type: 'button', className: 'pa24-drawer-close', 'aria-label': L('关闭详情', 'Close details'), onClick: () => closeHandler.current() }, icon('close'))),
            tabs && h('nav', { className: 'pa24-drawer-tabs', role: 'tablist', 'aria-label': L('运行详情分区', 'Run detail sections') }, tabs.map(([value, label], index) => h('button', {
              key: value, id: 'pa24-history-drawer-tab-' + value, type: 'button', role: 'tab', 'aria-selected': section === value, 'aria-controls': 'pa24-history-drawer-panel', tabIndex: section === value ? 0 : -1,
              onClick: () => setSection(value), onKeyDown: event => { const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
                if (next === null) return; event.preventDefault(); setSection(tabs[next][0]); event.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus(); },
            }, label))),
            h('div', { className: 'pa24-drawer-body' }, h('section', { className: 'pa24-drawer-section', id: tabs ? 'pa24-history-drawer-panel' : undefined, role: tabs ? 'tabpanel' : undefined, 'aria-labelledby': tabs && current ? 'pa24-history-drawer-tab-' + current[0] : undefined, tabIndex: tabs ? 0 : undefined },
              current && h('h3', null, current[1]), children(section)))));
        }

        function RunHistoryDetail(helpers) {
          const { state, extra, planStates, refresh, openCard, tz } = helpers, binding = state.workspaceBinding;
          const model = planRowState(planStates, 'run-history:' + binding, {}), view = React.useSyncExternalStore(model.subscribe, model.getSnapshot);
          const filters = view.filters || { kind: 'runs', range: '7', includeUnresolved: true }, offset = view.offset || 0;
          const [list, setList] = React.useState({ loading: true }), [work, setWork] = React.useState(null), [workError, setWorkError] = React.useState(''), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
          const alive = React.useRef(true); React.useEffect(() => () => { alive.current = false; }, []);
          const filterKey = JSON.stringify(filters);
          React.useEffect(() => {
            const abort = new AbortController(), key = JSON.stringify([binding, filterKey, offset]); let pending = false;
            setList(previous => previous.key === key ? { ...previous, loading: true, error: null } : { key, loading: true });
            setWork(previous => previous?.workspaceBinding === binding && previous?.work?.id === view.workId && previous?.runs.offset === (view.workOffset || 0) ? previous : null);
            setWorkError('');
            const load = async () => { if (pending) return; pending = true; try {
              const result = await rpc('runs', { ...filters, offset, workspaceBinding: binding }, abort.signal);
              if (!Array.isArray(result.rows) || !Number.isSafeInteger(result.total)) throw new Error(L('运行档案响应不完整，请刷新重试。', 'Incomplete run history; refresh to retry.'));
              if (!abort.signal.aborted && result.workspaceBinding === binding) setList({ key, data: result });
              if (view.workId) try {
                const inspected = await rpc('work.inspect', { workId: view.workId, offset: view.workOffset || 0, workspaceBinding: binding }, abort.signal);
                if (!abort.signal.aborted) { if (inspected.workspaceBinding !== binding) throw new Error(L('工作区已变化，请重新读取交办。', 'Workspace changed; read the work item again.')); setWork(inspected); setWorkError(''); }
              } catch (failure) { if (!abort.signal.aborted) setWorkError(failure.message); }
            } catch (failure) { if (!abort.signal.aborted) setList(previous => ({ ...previous, loading: false, error: failure.message })); } finally { pending = false; } };
            void load(); const timer = setInterval(load, 5000); return () => { abort.abort(); clearInterval(timer); };
          }, [binding, filterKey, offset, view.tick, view.workId, view.workOffset]);
          const closeDetails = () => model.update({ selectedRun: null, workId: null, workOffset: 0 });
          const set = (key, value) => model.update({ filters: { ...filters, [key]: value }, offset: 0, selectedRun: null, workId: null, workOffset: 0 });
          const openWork = id => model.update({ workId: id, workOffset: 0, selectedRun: null });
          const selectRun = row => model.update({ selectedRun: { id: row.id || row.run_id, skillId: row.skill_id, kind: row.record_kind || 'skill', title: row.title, source: row.source, createdAt: row.created_at }, workId: null, workOffset: 0 });
          const exportRows = async () => { setBusy(true); setError(''); try { const file = await rpc('runs.export', { ...filters, workspaceBinding: binding }); if (alive.current && file.workspaceBinding === binding) saveDownload(file); } catch (failure) { if (alive.current) setError(failure.message); } finally { if (alive.current) setBusy(false); } };
          const field = (label, node) => h('label', { key: label, className: 'pa24-field' }, label, node);
          const select = (key, entries) => h('select', { value: filters[key] || '', onChange: event => set(key, event.target.value) }, entries.map(([value, label]) => h('option', { key: value, value }, label)));
          const statuses = { runs: ['pending', 'running', 'waiting', 'stopping', 'completed', 'failed', 'stopped', 'timed_out', 'needs_reconciliation'], work: ['accepted', 'queued', 'running', 'waiting_input', 'completed', 'failed', 'stopped', 'needs_reconciliation'], events: ['skipped', 'rejected', 'expired'], legacy: ['delivering', 'model_done', 'sent', 'unconfirmed'] };
          const sourceValues = { runs: ['manual', 'schedule', 'trial', 'rerun', 'continuation'], work: ['local', 'feishu'], events: ['manual', 'schedule', 'continuation'], legacy: [] };
          const views = [['runs', 'play', L('执行记录', 'Executions')], ['work', 'tasks', L('助理交办', 'Work items')], ['events', 'clock', L('未执行事件', 'Unexecuted events')]];
          const changeKind = kind => {
            if (!statuses[kind] || kind === filters.kind) return;
            model.update({ filters: { kind, range: filters.range || '7', from: filters.from, to: filters.to, includeUnresolved: filters.includeUnresolved !== false, query: filters.query,
              status: statuses[kind].includes(filters.status) ? filters.status : undefined, source: sourceValues[kind].includes(filters.source) ? filters.source : undefined,
              planId: filters.planId, workId: kind === 'legacy' ? undefined : filters.workId, skillId: kind === 'legacy' ? undefined : filters.skillId,
              versionId: kind === 'runs' ? filters.versionId : undefined, deliveryStatus: kind === 'runs' ? filters.deliveryStatus : undefined },
            offset: 0, selectedRun: null, workId: null, workOffset: 0 });
          };
          const clearFilters = () => model.update({ filters: { kind: filters.kind, range: '7', includeUnresolved: true }, offset: 0, selectedRun: null, workId: null, workOffset: 0 });
          const summary = extra.runs, active = view.selectedRun, legacy = filters.kind === 'legacy';
          const sourceOptions = filters.kind === 'work' ? [['local', L('本地', 'Local')], ['feishu', L('飞书', 'Feishu')]] : [['manual', L('手工', 'Manual')], ['schedule', L('计划', 'Scheduled')], ...(filters.kind === 'runs' ? [['trial', L('试运行', 'Trial')], ['rerun', L('重跑', 'Rerun')], ['continuation', L('接续', 'Continuation')]] : filters.kind === 'events' ? [['continuation', L('接续', 'Continuation')]] : [])];
          const advancedFields = [...(!legacy ? ['source', 'skillId'] : []), 'planId', ...(!legacy ? ['workId'] : []), ...(filters.kind === 'runs' ? ['versionId', 'deliveryStatus'] : [])];
          const advancedCount = advancedFields.filter(key => !!filters[key]).length + (filters.includeUnresolved === false ? 1 : 0);
          const clearAdvanced = () => model.update({ filters: { ...filters, source: undefined, planId: undefined, workId: undefined, skillId: undefined, versionId: undefined, deliveryStatus: undefined, includeUnresolved: true }, offset: 0, selectedRun: null, workId: null, workOffset: 0 });
          const toolbar = h(React.Fragment, null,
            h('div', { className: 'pa24-history-toolbar' },
              field(L('标题、摘要或标识', 'Title, summary or ID'), h('div', { className: 'pa24-history-search' }, icon('search'), h('input', { type: 'search', value: filters.query || '', onChange: event => set('query', event.target.value) }))),
              field(L('时间范围', 'Date range'), select('range', [['7', L('近 7 天', 'Last 7 days')], ['30', L('近 30 天', 'Last 30 days')], ['custom', L('自定义', 'Custom')], ['all', L('全部历史', 'All history')]])),
              field(L('当前状态', 'Current status'), select('status', [['', L('全部状态', 'All statuses')], ...statuses[filters.kind].map(value => [value, filters.kind === 'runs' ? runStatusLabel(value) : t(value)])])),
              h('button', { type: 'button', className: 'pa24-history-advanced-toggle', 'aria-expanded': !!view.advanced, 'aria-controls': 'pa24-history-advanced', onClick: () => model.update({ advanced: !view.advanced }) }, icon('filter'), L('高级筛选', 'Advanced filters'), badge(String(advancedCount), advancedCount ? 'blue' : 'neutral'))),
            filters.range === 'custom' && h('div', { className: 'pa24-history-custom' }, ['from', 'to'].map(key => field((key === 'from' ? L('开始', 'From') : L('结束', 'To')) + ' · ' + tz, h('input', { type: 'datetime-local', value: filters[key] || '', onChange: event => set(key, event.target.value) })))),
            view.advanced && h('div', { id: 'pa24-history-advanced', className: 'pa24-history-advanced' }, h('div', { className: 'pa24-history-advanced-grid' },
              !legacy && field(L('发起来源', 'Initiation source'), select('source', [['', L('全部来源', 'All sources')], ...sourceOptions])),
              [['planId', L('计划标识', 'Plan ID')], ...(!legacy ? [['workId', L('交办标识', 'Work ID')], ['skillId', 'Skill ID']] : []), ...(filters.kind === 'runs' ? [['versionId', L('版本标识', 'Version ID')]] : [])].map(([key, label]) => field(label, h('input', { value: filters[key] || '', onChange: event => set(key, event.target.value) }))),
              filters.kind === 'runs' && field(L('投递状态', 'Delivery status'), select('deliveryStatus', [['', L('全部投递状态', 'All delivery statuses')], ...['not_requested', 'suppressed', 'pending', 'sent', 'partial', 'failed', 'unknown', 'expired'].map(value => [value, deliveryLabel(value)])])),
              field(L('保留跨日待处理与未解决异常', 'Keep unresolved records across dates'), h('input', { type: 'checkbox', checked: filters.includeUnresolved !== false, onChange: event => set('includeUnresolved', event.target.checked) }))),
              h('div', { className: 'pa24-history-advanced-footer' }, h('p', { className: 'pa24-meta' }, L('默认保留跨日待处理；关闭后严格限制在所选时间范围。', 'Unresolved records cross date boundaries by default; disable this for a strict date range.')), h('button', { type: 'button', className: 'pa24-quiet', disabled: !advancedCount, onClick: clearAdvanced }, L('清除高级筛选', 'Clear advanced filters')))));
          const metric = (value, label, description, tone = '') => h('div', { className: 'pa24-history-metric' + (tone ? ' ' + tone : ''), key: label }, h('strong', null, value ?? 0), h('span', null, label), h('small', null, description));
          const metrics = !summary?.observedAt || legacy ? [] : filters.kind === 'runs' ? [
            metric(summary.runs24, L('24 小时运行', '24h runs'), L('独立统计，不受列表时间范围影响', 'Independent of the list date range'), 'primary'),
            metric(summary.failed24, L('24 小时执行失败', '24h execution failures'), L('不含同一运行的内部自动重试', 'Excludes retries within the same run'), summary.failed24 ? 'danger' : ''),
            metric(summary.delivery_failed24, L('24 小时投递失败', '24h delivery failures'), L('与执行结果分别统计', 'Counted separately from execution'), summary.delivery_failed24 ? 'danger' : ''),
            metric(summary.unresolved, L('全量需处理', 'All unresolved runs'), L('跨日保留，不是 24 小时计数', 'Across all dates, not a 24h count'), summary.unresolved ? 'attention' : 'primary'),
          ] : filters.kind === 'work' ? [
            metric(summary.active_work, L('进行中交办', 'Active work'), L('全部交办数据', 'All work items')),
            metric(summary.waiting_work, L('待我处理', 'Awaiting you'), L('含等待补充、核对与验收', 'Input, reconciliation and acceptance'), summary.waiting_work ? 'attention' : ''),
            metric(summary.failed_work, L('异常交办', 'Failed work'), L('与单次执行失败分开', 'Separate from individual run failures'), summary.failed_work ? 'danger' : ''),
          ] : [
            metric(summary.unexecuted24, L('24 小时未执行', '24h unexecuted events'), L('跳过、过期和拒绝不计执行', 'Skipped, expired and rejected'), 'primary'),
            metric(summary.unresolved_events, L('全量待处理事件', 'All unresolved events'), L('跨日保留，修复后移出', 'Across dates until resolved'), summary.unresolved_events ? 'attention' : ''),
          ];
          const executionBadge = status => { const style = { pending: ['neutral', 'clock'], running: ['blue', 'pulse'], waiting: ['amber', 'clock'], stopping: ['amber', 'info'], completed: ['blue', 'check'], failed: ['danger', 'alert'], timed_out: ['danger', 'alert'], stopped: ['neutral', 'close'], needs_reconciliation: ['amber', 'info'] }[status] || ['neutral', 'info']; return badge(runStatusLabel(status), ...style); };
          const deliveryBadge = status => { const style = { sent: ['blue', 'check'], failed: ['danger', 'alert'], unknown: ['amber', 'info'], partial: ['amber', 'info'], pending: ['amber', 'clock'], sending: ['blue', 'pulse'] }[status] || ['neutral', 'info']; return badge(deliveryLabel(status), ...style); };
          const rangeLabel = { '7': L('近 7 天', 'Last 7 days'), '30': L('近 30 天', 'Last 30 days'), custom: L('自定义时间', 'Custom range'), all: L('全部历史', 'All history') }[filters.range || '7'];
          const recordMain = (row, action, actionLabel, meta) => h('div', { className: 'pa24-history-record-main' }, action ? h('button', { type: 'button', 'aria-label': actionLabel + '：' + (row.title || row.id), onClick: action }, row.title || row.id) : h('h3', null, row.title || row.id), h('p', { className: 'pa24-meta' }, meta));
          const cell = (label, value) => h('div', { className: 'pa24-history-cell' }, h('span', { className: 'pa24-history-cell-label' }, label), value);
          const rows = list.data?.rows || [];
          const listContent = list.data && h('div', { className: 'pa24-card pa24-history-list' },
            !!rows.length && filters.kind === 'runs' && h('div', { className: 'pa24-history-row pa24-history-run-row pa24-history-header' }, h('span', null, L('运行 / 来源', 'Run / source')), h('span', null, L('开始时间', 'Started')), h('span', null, 'Skill / ' + L('版本', 'version')), h('span', null, L('执行状态', 'Execution')), h('span', null, L('投递状态', 'Delivery'))),
            !!rows.length && filters.kind === 'work' && h('div', { className: 'pa24-history-row pa24-history-work-row pa24-history-header' }, h('span', null, L('交办 / 来源 / 运行', 'Work / source / runs')), h('span', null, L('当前阶段', 'Current stage')), h('span', null, L('最近进展', 'Recent progress')), h('span', null, L('当前状态', 'Status'))),
            !!rows.length && filters.kind === 'events' && h('div', { className: 'pa24-history-row pa24-history-event-row pa24-history-header' }, h('span', null, L('事件 / 来源', 'Event / source')), h('span', null, L('记录时间', 'Recorded')), h('span', null, L('原因', 'Reason')), h('span', null, L('当前状态', 'Status'))),
            rows.map(row => {
              if (filters.kind === 'runs') return h('article', { key: row.id, className: 'pa24-history-row pa24-history-run-row' },
                recordMain(row, () => selectRun(row), L('查看执行与投递', 'View execution and delivery'), runSourceLabel(row.source) + ' · ' + row.id),
                cell(L('开始时间', 'Started'), date(row.created_at, tz)),
                cell('Skill / ' + L('版本', 'version'), row.record_kind === 'worker' ? L('Worker 执行 · 无 Skill 版本', 'Worker execution · no Skill version') : (row.skill_name || row.skill_id || L('历史未记录', 'Not recorded')) + ' · ' + (row.version_id || L('历史未记录', 'Not recorded'))),
                cell(L('执行状态', 'Execution'), h('span', { className: 'pa24-history-status' }, executionBadge(row.status))),
                cell(L('投递状态', 'Delivery'), h('span', { className: 'pa24-history-status' }, deliveryBadge(row.delivery_status))));
              if (filters.kind === 'work') return h('article', { key: row.id, className: 'pa24-history-row pa24-history-work-row' },
                recordMain(row, () => openWork(row.id), L('查看交办详情', 'View work item'), runSourceLabel(row.source) + ' · ' + L('关联 ', 'Linked: ') + (Number.isFinite(Number(row.run_count)) ? Number(row.run_count) : 0) + L(' 次运行', ' run(s)') + ' · ' + row.id),
                cell(L('当前阶段', 'Current stage'), row.progress_detail?.stage || row.progress || L('历史未记录阶段', 'Stage not recorded')),
                cell(L('最近进展', 'Recent progress'), h(React.Fragment, null, row.progress_detail?.completed || row.summary || L('尚无进展记录', 'No progress recorded'), row.progress_detail?.next && h('p', { className: 'pa24-meta' }, L('下一步：', 'Next: ') + row.progress_detail.next))),
                cell(L('当前状态', 'Status'), badgeOf(row.status)));
              if (filters.kind === 'events') return h('article', { key: row.id, className: 'pa24-history-row pa24-history-event-row' },
                h('div', null, recordMain(row, row.run_id ? () => selectRun({ ...row, id: row.run_id }) : null, L('核对未执行原记录', 'Inspect original record'), runSourceLabel(row.source) + ' · ' + row.id), row.plan_id && h('button', { type: 'button', className: 'pa24-quiet', onClick: () => helpers.openPlan(row.plan_id) }, L('处理原计划', 'Open original plan'))),
                cell(L('记录时间', 'Recorded'), date(row.created_at, tz)),
                cell(L('原因', 'Reason'), row.summary || L('历史未记录原因', 'Reason not recorded')),
                cell(L('当前状态', 'Status'), badge(t(row.status), row.status === 'rejected' ? 'amber' : 'neutral', 'info')));
              return h('article', { key: row.id, className: 'pa24-job' }, h('h3', null, row.title || row.id), h('p', null, t(row.status)), h('p', { className: 'pa24-meta' }, date(row.created_at, tz) + ' · ' + row.id),
                h('details', null, h('summary', null, L('原始简报与旧关联', 'Original digest and links')), h('pre', { className: 'pa24-json' }, JSON.stringify(row, null, 2))));
            }),
            !rows.length && empty(list.data.empty ? 'history' : 'search', 'neutral', list.data.empty ? L('此类档案尚无记录', 'No records in this category') : L('当前筛选没有记录', 'No matching records'),
              list.data.empty ? L('实际运行、交办或未执行事件出现后，会按类别保留在这里。普通查看不会启动运行。', 'Actual executions, work and unexecuted events appear here. Browsing never starts a run.') : L('可扩大时间范围或清除筛选；读取失败不会显示为空档案。', 'Widen the date range or clear filters. Read failures are not shown as an empty ledger.'), !list.data.empty && h('button', { type: 'button', onClick: clearFilters }, L('清除筛选', 'Clear filters'))),
            h('footer', { className: 'pa24-history-footer' }, h('span', { className: 'pa24-meta' }, L('匹配记录 ', 'Matching records: ') + list.data.total + ' · ' + rangeLabel + (filters.includeUnresolved !== false && filters.range !== 'all' ? L(' · 含跨日待处理', ' · includes unresolved across dates') : '') + ' · ' + list.data.timeZone),
              (list.data.total > 20 || offset > 0) && h('nav', { 'aria-label': L('运行记录分页', 'Run history pages') }, h('button', { type: 'button', disabled: !offset, onClick: () => model.update({ offset: Math.max(0, offset - 20) }) }, L('上一页', 'Previous')), h('button', { type: 'button', disabled: offset + 20 >= list.data.total, onClick: () => model.update({ offset: offset + 20 }) }, L('下一页', 'Next')))));
          const workErrorNotice = workError && h('div', { role: 'alert', className: 'pa24-error' }, h('p', null, (work ? L('交办读取失败；当前详情可能为上次结果：', 'Work refresh failed; details may be stale: ') : L('交办读取失败：', 'Work read failed: ')) + workError),
            h('button', { type: 'button', onClick: () => model.update({ tick: (view.tick || 0) + 1 }) }, L('重试交办读取', 'Retry work read')));
          const workDrawer = work ? h(React.Fragment, null, workErrorNotice,
            h('section', { className: 'pa24-form-section' }, h('h3', null, L('交办概览', 'Work overview')), h('p', null, badgeOf(work.work.status)),
              work.work.id.startsWith('pa24-material-') ? h('details', null, h('summary', null, L('当次资料操作输入', 'Material action input')), h('pre', { className: 'pa24-json' }, work.work.instruction)) : h('p', null, work.work.instruction),
              work.work.progress_detail && fields([[L('真实阶段', 'Current stage'), work.work.progress_detail.stage], [L('已完成', 'Completed'), work.work.progress_detail.completed], [L('下一步', 'Next'), work.work.progress_detail.next]]),
              !work.work.progress_detail && work.work.progress && h('p', null, work.work.progress),
              work.work.result && (work.work.id.startsWith('pa24-material-') ? h(MaterialFeedback, { value: materialReceipt(work.work.result) }) : h('pre', { className: 'pa24-json' }, work.work.result)),
              h('p', { className: 'pa24-meta' }, L('来源：', 'Origin: ') + work.work.origin + ' · ' + L('结果回到：', 'Results return to: ') + work.work.delivery),
              work.work.child_session_id && h('button', { type: 'button', onClick: () => ctx.uiWorkspace.openSession({ childSessionId: work.work.child_session_id, parentSessionId: work.work.parent_session_id, mode: 'continuable' }) }, L('查看原交办会话', 'Open original work session'))),
            h(WorkControls, { key: binding + work.work.id, work: work.work, changes: work.changes, binding, changed: () => { model.update({ tick: (model.getSnapshot().tick || 0) + 1 }); void refresh().catch(() => {}); } }),
            h('section', { className: 'pa24-form-section' }, h('h3', null, L('关联执行记录 ', 'Linked runs ') + work.runs.total), h('div', { className: 'pa24-drawer-work-runs' }, work.runs.rows.map(row => h('button', { key: row.id, type: 'button', onClick: () => selectRun(row) },
              h('span', null, date(row.created_at, tz) + ' · ' + row.id), h('span', { className: 'pa24-meta' }, runStatusLabel(row.status) + ' · ' + deliveryLabel(row.delivery_status))))),
              !work.runs.rows.length && h('p', { className: 'pa24-meta' }, L('尚无真实执行主记录；未执行事件不计运行数。', 'No execution records yet; unexecuted events do not count as runs.')),
              work.runs.total > 20 && h('div', { className: 'pa24-row' }, h('button', { type: 'button', disabled: !(view.workOffset || 0), onClick: () => model.update({ workOffset: Math.max(0, (view.workOffset || 0) - 20) }) }, L('更近的运行', 'Newer runs')), h('button', { type: 'button', disabled: (view.workOffset || 0) + 20 >= work.runs.total, onClick: () => model.update({ workOffset: (view.workOffset || 0) + 20 }) }, L('更早的运行', 'Older runs'))))) : h(React.Fragment, null, workErrorNotice, !workError && h('p', { role: 'status' }, L('正在读取交办…', 'Reading work item…')));
          return h('section', { className: 'pa24-manager pa24-run-history' }, sectionHead('history', L('运行记录', 'Run history'), L('执行、投递与助理交办分别查阅；等待恢复和自动重试沿用原运行。', 'Review execution, delivery and work separately. Waits and automatic retries keep the same run.'),
            h('div', { className: 'pa24-row' }, h('button', { type: 'button', onClick: () => { model.update({ tick: (view.tick || 0) + 1 }); void refresh().catch(() => {}); } }, L('刷新', 'Refresh')), h('button', { type: 'button', disabled: busy || !list.data, onClick: exportRows }, L('导出全部筛选结果', 'Export all matching results')))),
            extra._errors?.runs && h('p', { role: 'alert', className: 'pa24-error' }, extra._errors.runs),
            h('nav', { className: 'pa24-tabs', role: 'tablist', 'aria-label': L('运行档案主视图', 'Run history views') }, views.map(([kind, name, label], index) => h('button', {
              key: kind, id: 'pa24-history-tab-' + kind, type: 'button', role: 'tab', className: 'pa24-tone-blue', 'aria-selected': !legacy && filters.kind === kind, 'aria-controls': 'pa24-history-primary', tabIndex: (!legacy && filters.kind === kind) || (legacy && index === 0) ? 0 : -1,
              onClick: () => changeKind(kind), onKeyDown: event => { const next = event.key === 'ArrowRight' ? (index + 1) % views.length : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1 : null;
                if (next === null) return; event.preventDefault(); changeKind(views[next][0]); event.currentTarget.parentElement.querySelectorAll('[role=tab]')[next].focus(); },
            }, icon(name, { width: 16, height: 16 }), label))),
            h('div', { id: 'pa24-history-primary', role: 'tabpanel', 'aria-labelledby': 'pa24-history-tab-' + (legacy ? 'runs' : filters.kind), tabIndex: 0, hidden: legacy }, !legacy && h(React.Fragment, null,
              !!metrics.length && h('div', { className: 'pa24-history-metrics' }, metrics),
              summary?.observedAt && h('p', { className: 'pa24-history-scope' },
                filters.kind === 'runs' && h(React.Fragment, null, h('span', { className: 'pa24-badge pa24-tone-' + (summary.delivery_unknown24 ? 'amber' : 'neutral') }, L('24 小时投递待核对 ', '24h delivery unknown: ') + (summary.delivery_unknown24 ?? 0)), ' ', L('未知不计入投递失败，仍保留在全量待处理。', 'Unknown is not a delivery failure and remains unresolved.'), ' · '),
                (filters.kind === 'runs' ? L('24 小时统计与全量未解决分开；列表默认近 7 天。', '24h statistics and all-time unresolved are separate; the list defaults to 7 days.') : filters.kind === 'work' ? L('交办统计来自全部数据，不从当前页推算。', 'Work statistics cover the complete ledger, not the current page.') : L('24 小时未执行与全量待处理事件分开。', '24h unexecuted events and all-time unresolved events are separate.')) + ' · ' + date(summary.observedAt, tz)),
              toolbar, error && h('p', { role: 'alert', className: 'pa24-error' }, error), list.error && h('p', { role: 'alert', className: 'pa24-error' }, L('读取失败；下方可能为上次结果：', 'Read failed; results below may be stale: ') + list.error), list.loading && h('p', { role: 'status' }, L('正在读取档案…', 'Reading history…')), listContent)),
            h('details', { className: 'pa24-history-compatibility', open: legacy ? true : undefined }, h('summary', null, icon('history', { width: 15, height: 15 }), L('兼容与历史', 'Compatibility and history')),
              legacy ? h('div', { className: 'pa24-history-compatibility-content' }, h('p', { className: 'pa24-history-scope' }, L('旧简报仅作为历史档案保留，不与三个主视图混合统计。', 'Legacy digests remain historical records and are not mixed into the three primary views.')), toolbar, error && h('p', { role: 'alert', className: 'pa24-error' }, error), list.error && h('p', { role: 'alert', className: 'pa24-error' }, list.error), list.loading && h('p', { role: 'status' }, L('正在读取档案…', 'Reading history…')), listContent)
                : h('div', { className: 'pa24-history-compatibility-content' }, h('p', { className: 'pa24-meta' }, L('旧简报档案与既有诊断保留规则可在这里查阅。', 'Read legacy digest archives and existing diagnostic retention rules here.')), h('button', { type: 'button', onClick: () => changeKind('legacy') }, L('查看旧简报档案', 'View legacy digests')))),
            (active || view.workId) && h(HistoryDrawer, { key: active ? 'run:' + active.id : 'work:' + view.workId,
              title: active ? (active.title || active.id) : (work?.work.title || L('助理交办', 'Work item')),
              subtitle: active ? runSourceLabel(active.source) + ' · ' + date(active.createdAt, tz) + ' · ' + active.id : L('交办标识：', 'Work ID: ') + view.workId,
              onClose: closeDetails, tabs: active ? [['overview', L('概览', 'Overview')], ['delivery', L('投递', 'Delivery')], ['diagnostics', L('诊断', 'Diagnostics')]] : null,
            }, section => active ? (active.kind === 'worker' ? h(WorkerRunDetail, { id: active.id, binding, openWork, section }) : h(SkillRunControls, { data: { id: active.skillId }, binding, detailOnly: true, initialRunId: active.id, openWork, section })) : workDrawer),
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
          const pending = detail.native.filter(item => (!item.end_data && item.recovery_data?.kind !== 'budget-paused') || item.end_data?.producerReported === false);
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

        function SkillRunControls({ data, binding, detailOnly = false, initialRunId = null, openWork, section = 'all' }) {
          const overview = section === 'all' || section === 'overview', deliveryView = section === 'all' || section === 'delivery', diagnosticsView = section === 'all' || section === 'diagnostics';
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
            preview && overview && h('div', { className: 'pa24-note' },
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
              overview && h(React.Fragment, null,
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
                h('p', { className: 'pa24-meta' }, L('版本：', 'Version: ') + (detail.run.version_id || L('历史未记录', 'Not recorded'))),
                h('p', { className: 'pa24-meta' }, L('触发时间：', 'Triggered: ') + (detail.run.triggered_at ? new Date(detail.run.triggered_at).toLocaleString() : L('历史未记录', 'Not recorded')) + ' · ' + L('接纳时间：', 'Admitted: ') + new Date(detail.run.created_at).toLocaleString()),
                detail.run.result && h('pre', { className: 'pa24-json' }, detail.run.result),
                ['completed', 'failed', 'stopped', 'timed_out'].includes(detail.run.status) && h('label', { className: 'pa24-field' }, L('接续补充说明（可选）', 'Continuation instructions (optional)'),
                  h('textarea', { value: instruction, maxLength: 4000, rows: 2, onChange: event => { setInstruction(event.target.value); setPreview(null); setApproved(false); } })),
                h('div', { className: 'pa24-row' },
                  detail.run.mode !== 'template' && h('button', { type: 'button', onClick: () => ctx.uiWorkspace.openSession(detail.run.mode === 'business' ? { childSessionId: detail.run.session_id, parentSessionId: detail.run.source_session_id, mode: 'continuable' } : detail.run.session_id) }, L('查看原执行会话', 'Open execution session')),
                  detail.run.result && h('button', { type: 'button', onClick: downloadResult }, L('下载结果', 'Download result')),
                  openWork && h('button', { type: 'button', onClick: () => openWork(detail.run.work_item_id) }, L('查看原助理交办', 'Open original work item')),
                  ['pending', 'running', 'waiting', 'stopping', 'needs_reconciliation'].includes(detail.run.status) && h('button', { type: 'button', disabled: busy, onClick: () => stop(detail.run.id) }, L('停止本次运行', 'Stop run')),
                  ['completed', 'failed', 'stopped', 'timed_out'].includes(detail.run.status) && h('button', { type: 'button', disabled: busy || ['disabled', 'deleted'].includes(data.entry?.status), onClick: () => prepare({ rerunId: detail.run.id, configuration: 'original' }) }, L('用原快照重跑 · 先预览', 'Rerun snapshot · preview')),
                  ['completed', 'failed', 'stopped', 'timed_out'].includes(detail.run.status) && h('button', { type: 'button', disabled: busy || ['disabled', 'deleted'].includes(data.entry?.status), onClick: () => prepare({ rerunId: detail.run.id, configuration: 'current' }) }, L('用当前配置重跑 · 先预览', 'Rerun current · preview'))),
                h('details', null, h('summary', null, L('输入、资源与版本快照', 'Input, resources and version snapshot')), h('pre', { className: 'pa24-json' }, JSON.stringify({ parameters: detail.run.parameters, contract: detail.run.contract, files: detail.run.files, plan: detail.run.plan }, null, 2))),
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
                    item.end_data?.producerReported === false && h('p', { role: 'alert' }, L('生产者未确认结束，需要核对实际状态。', 'The producer has not confirmed termination. Reconciliation is required.')))))),
              deliveryView && h(React.Fragment, null, h('h4', null, L('结果投递与原 Outbox', 'Delivery and original Outbox')), h('p', null, L('当前投递状态：', 'Current delivery status: ') + deliveryLabel(detail.run.delivery_status)),
                !(detail.deliveries || []).length && h('p', { className: 'pa24-meta' }, L('尚无投递明细；这不改变执行结果。', 'No delivery records yet; this does not change the execution result.')),
                (detail.deliveries || []).length > 0 && h(PlanDeliveryControls, { key: detail.run.id, detail, binding, onChanged: () => setRefresh(n => n + 1) })),
              diagnosticsView && h(React.Fragment, null, h('p', { className: 'pa24-meta' }, L('诊断只生成脱敏预览；确认预览内容后才下载。', 'Diagnostics require a redacted preview before download.')),
                h('button', { type: 'button', onClick: async () => { const id = detail.run.id; try { const result = await rpc('runs.diagnostics', { workspaceBinding: binding, runId: id }); if (alive.current && selectedRun.current === id && result.workspaceBinding === binding) setDiagnostics(result); } catch (failure) { if (alive.current) setError(failure.message); } } }, L('预览脱敏诊断', 'Preview redacted diagnostics')),
                diagnostics && h('div', { className: 'pa24-note' }, h('p', null, diagnostics.message), h('pre', { className: 'pa24-json' }, diagnostics.content), h('button', { type: 'button', onClick: () => saveDownload(diagnostics) }, L('确认下载这份诊断', 'Download this diagnostic preview'))))));
        }

        const validSkillHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
        const shortSkillHash = value => validSkillHash(value) ? value.slice(0, 12) + '…' : '';
        const formatSkillBytes = bytes => bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KiB' : (bytes / 1024 / 1024).toFixed(1) + ' MiB';
        const skillPackageTree = files => {
          const root = [];
          for (const file of files) {
            const parts = file.path.split('/');
            let siblings = root, path = '';
            for (let index = 0; index < parts.length; index++) {
              const name = parts[index]; path = path ? path + '/' + name : name;
              if (index === parts.length - 1) { siblings.push({ type: 'file', name, path, file }); break; }
              let folder = siblings.find(node => node.type === 'folder' && node.path === path);
              if (!folder) { folder = { type: 'folder', name, path, children: [] }; siblings.push(folder); }
              siblings = folder.children;
            }
          }
          const sort = nodes => {
            nodes.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, 'en') : a.type === 'folder' ? -1 : 1);
            for (const node of nodes) if (node.children) sort(node.children);
            return nodes;
          };
          return sort(root);
        };

        function SkillPackageBrowser({ data, binding }) {
          const snapshotKey = JSON.stringify([binding, data.id, data.versionId || null, data.fingerprint]);
          const [manifest, setManifest] = React.useState({ status: 'loading', key: snapshotKey });
          const [selectedPath, setSelectedPath] = React.useState(''), [preview, setPreview] = React.useState({ status: 'idle' });
          const [collapsed, setCollapsed] = React.useState(new Set()), [reload, setReload] = React.useState(0), [previewTick, setPreviewTick] = React.useState(0);
          const [copyStatus, setCopyStatus] = React.useState('');
          const manifestEpoch = React.useRef(0), previewEpoch = React.useRef(0), treeRef = React.useRef(null);
          const packageData = manifest.key === snapshotKey && manifest.status === 'ready' ? manifest.data : null;
          const previewKey = JSON.stringify([snapshotKey, selectedPath]);
          const currentPreview = preview.key === previewKey && preview.status === 'ready' ? preview.data : null;
          const matchesSnapshot = (value, expectedHash) => !!value && value.id === data.id && value.workspaceBinding === binding
            && value.source === data.source && value.snapshot === (data.source === 'managed' ? 'immutable-version' : 'current-read')
            && value.fingerprint === data.fingerprint && (value.versionId || null) === (data.versionId || null)
            && validSkillHash(value.packageHash) && (!expectedHash || value.packageHash === expectedHash);
          React.useEffect(() => {
            const abort = new AbortController(), epoch = ++manifestEpoch.current;
            const expectedHash = data.packageHash || (manifest.key === snapshotKey ? manifest.data?.packageHash : undefined);
            setManifest({ status: 'loading', key: snapshotKey }); setSelectedPath(''); setPreview({ status: 'idle' }); setCopyStatus(''); setCollapsed(new Set());
            rpc('skills.package-content', { id: data.id, workspaceBinding: binding, fingerprint: data.fingerprint,
              ...(data.versionId ? { versionId: data.versionId } : {}), ...(expectedHash ? { packageHash: expectedHash } : {}) }, abort.signal).then(value => {
              if (epoch !== manifestEpoch.current || abort.signal.aborted) return;
              if (!matchesSnapshot(value, expectedHash) || !Array.isArray(value.files) || !Number.isSafeInteger(value.bytes)
                || value.files.some(file => typeof file.path !== 'string' || !Number.isSafeInteger(file.bytes) || !validSkillHash(file.hash))
                || value.files.reduce((sum, file) => sum + file.bytes, 0) !== value.bytes) throw new Error(L('包清单快照无效，请重新读取。', 'The package manifest snapshot is invalid. Read it again.'));
              setManifest({ status: 'ready', key: snapshotKey, data: value });
              setSelectedPath(value.files.some(file => file.path === 'SKILL.md') ? 'SKILL.md' : value.files[0]?.path || '');
            }).catch(error => { if (epoch === manifestEpoch.current && !abort.signal.aborted) setManifest({ status: 'error', key: snapshotKey, error: error.message }); });
            return () => abort.abort();
          }, [snapshotKey, reload]);
          React.useEffect(() => {
            const abort = new AbortController(), epoch = ++previewEpoch.current;
            if (!packageData || !selectedPath) { setPreview({ status: 'idle', key: previewKey }); return () => abort.abort(); }
            const expected = packageData.files.find(file => file.path === selectedPath);
            if (!expected) { setPreview({ status: 'error', key: previewKey, error: L('所选文件不在当前包清单中。', 'The selected file is not in this package manifest.') }); return () => abort.abort(); }
            setPreview({ status: 'loading', key: previewKey }); setCopyStatus('');
            rpc('skills.package-content', { id: data.id, workspaceBinding: binding, fingerprint: data.fingerprint, packageHash: packageData.packageHash,
              ...(data.versionId ? { versionId: data.versionId } : {}), path: selectedPath }, abort.signal).then(value => {
              if (epoch !== previewEpoch.current || abort.signal.aborted) return;
              if (!matchesSnapshot(value, packageData.packageHash) || value.packageBytes !== packageData.bytes || value.path !== selectedPath
                || value.bytes !== expected.bytes || value.hash !== expected.hash || !value.preview || !['text', 'binary', 'invalid-text'].includes(value.preview.kind)
                || typeof value.preview.truncated !== 'boolean' || (value.preview.kind === 'text' ? typeof value.preview.content !== 'string' : value.preview.content !== null)) {
                throw new Error(L('文件与包清单不属于同一快照，请重新读取。', 'The file and manifest do not belong to the same snapshot. Read them again.'));
              }
              setPreview({ status: 'ready', key: previewKey, data: value });
            }).catch(error => { if (epoch === previewEpoch.current && !abort.signal.aborted) setPreview({ status: 'error', key: previewKey, error: error.message }); });
            return () => abort.abort();
          }, [snapshotKey, packageData, selectedPath, previewTick]);
          const toggleFolder = (path, expand) => setCollapsed(previous => {
            const next = new Set(previous), shouldExpand = expand === undefined ? next.has(path) : expand;
            if (shouldExpand) next.delete(path); else next.add(path);
            return next;
          });
          const treeKeyDown = event => {
            const current = event.target.closest('button');
            if (current?.dataset.folderPath && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.preventDefault(); toggleFolder(current.dataset.folderPath, event.key === 'ArrowRight'); return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const buttons = [...treeRef.current.querySelectorAll('button')], index = buttons.indexOf(current);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? Math.min(buttons.length - 1, index + 1) : Math.max(0, index - 1);
            event.preventDefault(); buttons[next]?.focus();
          };
          const copyPath = async () => {
            if (!selectedPath) return;
            try { await navigator.clipboard.writeText(selectedPath); setCopyStatus(L('已复制包相对路径。', 'Package-relative path copied.')); }
            catch { setCopyStatus(L('复制失败，请选中路径手工复制。', 'Copy failed. Select the path and copy it manually.')); }
          };
          const selectedFile = packageData?.files.find(file => file.path === selectedPath);
          const renderNodes = nodes => h('ul', null, nodes.map(node => h('li', { key: node.path },
            node.type === 'folder' ? [
              h('button', { key: 'folder', type: 'button', className: 'pa24-package-folder', 'data-folder-path': node.path,
                'aria-expanded': !collapsed.has(node.path), title: node.path, onClick: () => toggleFolder(node.path) },
                icon('chevron', { className: 'pa24-package-chevron', width: 14, height: 14 }), icon('folder', { width: 14, height: 14 }), h('span', { className: 'pa24-package-name' }, node.name)),
              !collapsed.has(node.path) && h(React.Fragment, { key: 'children' }, renderNodes(node.children)),
            ] : h('button', { type: 'button', className: 'pa24-package-file', 'data-file-path': node.path,
              'aria-current': selectedPath === node.path ? 'true' : undefined, title: node.path, onClick: () => setSelectedPath(node.path) },
              icon('note', { width: 14, height: 14 }), h('span', { className: 'pa24-package-name' }, node.name)))));
          return h('section', { className: 'pa24-package-browser', 'aria-label': L('Skill 包内容', 'Skill package content') },
            h('div', { className: 'pa24-row pa24-between' }, h('h4', null, L('包内容 · 只读预览', 'Package content · read-only preview')),
              h('button', { type: 'button', className: 'pa24-quiet', disabled: manifest.status === 'loading', onClick: () => setReload(value => value + 1) }, icon('refresh'), L('重新读取', 'Read again'))),
            manifest.status === 'loading' && h('p', { role: 'status' }, L('正在读取包清单…', 'Reading package manifest…')),
            manifest.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('p', null, manifest.error), h('button', { type: 'button', onClick: () => setReload(value => value + 1) }, L('读取当前快照', 'Read current snapshot'))),
            packageData && h(React.Fragment, null,
              h('p', { className: 'pa24-package-summary' }, packageData.files.length + L(' 个文件 · ', ' files · ') + formatSkillBytes(packageData.bytes) + ' · SHA-256 ' + shortSkillHash(packageData.packageHash)),
              h('p', { className: 'pa24-meta', title: packageData.packageHash }, packageData.snapshot === 'immutable-version' ? L('不可变版本快照', 'Immutable version snapshot') : L('当前读取快照（非持久版本）', 'Current read snapshot (not a persistent version)'),
                packageData.versionId ? ' · ' + packageData.versionId : '', ' · ' + packageData.observedAt),
              h('div', { className: 'pa24-package-layout' },
                h('div', { className: 'pa24-package-tree', ref: treeRef, 'aria-label': L('包目录树', 'Package directory tree'), onKeyDown: treeKeyDown }, renderNodes(skillPackageTree(packageData.files))),
                h('div', { className: 'pa24-package-preview' },
                  selectedFile && h(React.Fragment, null,
                    h('div', { className: 'pa24-package-file-head' }, h('div', null, h('div', { className: 'pa24-package-path' }, selectedFile.path),
                      h('p', { className: 'pa24-meta', title: selectedFile.hash }, formatSkillBytes(selectedFile.bytes) + ' · SHA-256 ' + shortSkillHash(selectedFile.hash))),
                      h('button', { type: 'button', className: 'pa24-quiet', onClick: copyPath }, L('复制路径', 'Copy path'))),
                    copyStatus && h('p', { role: 'status', className: 'pa24-meta' }, copyStatus)),
                  preview.status === 'loading' && preview.key === previewKey && h('p', { role: 'status' }, L('正在读取文件预览…', 'Reading file preview…')),
                  preview.status === 'error' && preview.key === previewKey && h('div', { role: 'alert', className: 'pa24-error' }, h('p', null, preview.error), h('button', { type: 'button', onClick: () => setPreviewTick(value => value + 1) }, L('重试', 'Retry'))),
                  currentPreview?.preview.kind === 'binary' && h('p', { role: 'status', className: 'pa24-note' }, L('二进制文件，不返回正文预览。可经既有完整 ZIP 下载取得；不会解析或执行。', 'Binary file: no inline content is returned. Use the existing full ZIP download; nothing is parsed or executed.')),
                  currentPreview?.preview.kind === 'invalid-text' && h('p', { role: 'status', className: 'pa24-note' }, L('文本解码失败（不是有效 UTF-8）；不返回正文预览。可经既有完整 ZIP 下载核验；不会解析或执行。', 'Text decoding failed (not valid UTF-8). No inline preview. Use the existing full ZIP to inspect; nothing is parsed or executed.')),
                  currentPreview?.preview.kind === 'text' && h(React.Fragment, null,
                    currentPreview.preview.truncated && h('p', { role: 'status', className: 'pa24-note' }, L('仅显示前 256 KiB；完整内容请经既有完整 ZIP 下载取得。', 'Only the first 256 KiB is shown. Use the existing full ZIP download for complete content.')),
                    currentPreview.bytes === 0 && h('p', { role: 'status', className: 'pa24-meta' }, L('空文件 · 0 B', 'Empty file · 0 B')),
                    h('pre', { className: 'pa24-json', tabIndex: 0, 'aria-label': selectedPath + L(' 正文', ' content') }, currentPreview.preview.content))))),
            h('p', { className: 'pa24-meta' }, L('仅显示包相对路径。阅读清单或正文不会启动模型、执行脚本、安装依赖或写运行缓存。', 'Only package-relative paths are shown. Reading manifests or files does not start models, execute scripts, install dependencies, or write run caches.')));
        }

        function SkillsDetail({ binding }) {
          const [catalog, setCatalog] = React.useState({ status: 'loading' });
          const [selected, setSelected] = React.useState(null), [detail, setDetail] = React.useState({ status: 'idle' });
          const [query, setQuery] = React.useState(''), [source, setSource] = React.useState('all'), [page, setPage] = React.useState(0);
          const [tick, setTick] = React.useState(0), [downloading, setDownloading] = React.useState(false), [downloadError, setDownloadError] = React.useState('');
          const [editor, setEditor] = React.useState(null), [busy, setBusy] = React.useState(false), [feedback, setFeedback] = React.useState('');
          const [version, setVersion] = React.useState(''), [confirmed, setConfirmed] = React.useState(false), [tab, setTab] = React.useState('overview');
          const mutation = React.useRef(null), catalogEpoch = React.useRef(0), detailEpoch = React.useRef(0);
          const alive = React.useRef(true);
          const detailTitle = React.useRef(null), importInput = React.useRef(null);
          React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
          React.useEffect(() => { setSelected(null); setEditor(null); setFeedback(''); setVersion(''); setConfirmed(false); mutation.current = null; }, [binding]);
          React.useEffect(() => { setVersion(''); setConfirmed(false); }, [tick]);
          React.useEffect(() => { if (detail.status === 'ready' && detail.id === selected) detailTitle.current?.focus(); }, [detail, selected]);
          React.useEffect(() => {
            const abort = new AbortController(), epoch = ++catalogEpoch.current;
            setCatalog(previous => ({ status: 'loading', data: previous.data?.workspaceBinding === binding ? previous.data : null })); setPage(0); setDownloadError('');
            rpc('skills.catalog', { workspaceBinding: binding }, abort.signal).then(data => {
              if (epoch === catalogEpoch.current && !abort.signal.aborted && data.workspaceBinding === binding) setCatalog({ status: 'ready', data });
            }).catch(error => {
              if (epoch === catalogEpoch.current && !abort.signal.aborted) setCatalog(previous => ({ status: 'error', error: error.message, data: previous.data?.workspaceBinding === binding ? previous.data : null }));
            });
            return () => abort.abort();
          }, [binding, tick]);
          React.useEffect(() => {
            const abort = new AbortController(), epoch = ++detailEpoch.current;
            setDownloadError('');
            if (!selected) { setDetail({ status: 'idle' }); return () => abort.abort(); }
            setDetail({ status: 'loading', id: selected });
            rpc(version ? 'skills.version' : 'skills.inspect', { id: selected, versionId: version, workspaceBinding: binding }, abort.signal).then(value => {
              if (epoch === detailEpoch.current && !abort.signal.aborted && value.workspaceBinding === binding && value.id === selected) setDetail({ status: 'ready', id: selected, data: value });
            }).catch(error => { if (epoch === detailEpoch.current && !abort.signal.aborted) setDetail({ status: 'error', id: selected, error: error.message }); });
            return () => abort.abort();
          }, [selected, binding, tick, version]);
          const selectSkill = id => { setSelected(id); setVersion(''); setConfirmed(false); setDownloadError(''); };
          const typeLabel = type => ({ task: L('智能任务', 'Agent task'), template: L('确定性模板', 'Template'), persona: L('职责', 'Persona'), setup: L('接入向导', 'Setup guide') }[type] || L('待核验', 'Unverified'));
          const sourceLabel = value => value === 'builtin' ? L('内置原件', 'Built-in original') : value === 'managed' ? L('受管 Skill', 'Managed skill') : L('工作区文件', 'Workspace file');
          const managedStatusLabels = { draft: L('草稿', 'Draft'), enabled: L('已启用', 'Enabled'), disabled: L('已禁用', 'Disabled'), deleted: L('已删除', 'Deleted') };
          const data = detail.id === selected && detail.status === 'ready' ? detail.data : null;
          const download = async (full = false) => {
            if (!data) return;
            const epoch = detailEpoch.current;
            setDownloading(true); setDownloadError('');
            try {
              const file = await rpc(full ? 'skills.package' : 'skills.export', { id: data.id, versionId: data.versionId, fingerprint: data.fingerprint, workspaceBinding: binding });
              if (!alive.current || epoch !== detailEpoch.current || file.workspaceBinding !== binding) return;
              const bytes = full ? Uint8Array.from(atob(file.base64), c => c.charCodeAt(0)) : file.content;
              const url = URL.createObjectURL(new Blob([bytes], { type: full ? 'application/zip' : 'text/markdown;charset=utf-8' }));
              const link = document.createElement('a'); link.href = url; link.download = file.filename;
              document.body.append(link); link.click(); link.remove();
              setTimeout(() => URL.revokeObjectURL(url), 0);
            } catch (error) { if (alive.current && epoch === detailEpoch.current) setDownloadError(error.message); }
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
              selectSkill('managed:' + result.entry.id);
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
          const entries = catalog.data?.workspaceBinding === binding ? catalog.data.entries : [];
          const matches = entries.filter(entry => (source === 'all' || entry.source === source) && [entry.name, entry.internalName, entry.id, entry.description].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()));
          const rows = matches.slice(page * 20, (page + 1) * 20);
          const detailTabs = [['overview', L('概览', 'Overview')], ['versions', L('版本', 'Versions')], ['plans', L('关联计划', 'Linked plans')], ['package', L('包内容', 'Package')], ['instructions', L('指令正文', 'Instructions')]];
          const detailTabKey = (event, index) => {
            if (event.key === 'Enter') { event.preventDefault(); setTab(detailTabs[index][0]); return; }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? detailTabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % detailTabs.length : (index + detailTabs.length - 1) % detailTabs.length;
            setTab(detailTabs[next][0]); event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next]?.focus();
          };
          return h('div', { className: 'pa24-skills' },
            sectionHead('blocks', L('Skill 管理', 'Skill management'), L('查看内置、工作区与受管 Skill。读取和下载不会执行 Skill。', 'Inspect built-in, workspace and managed skills. Reading and downloading do not execute them.'),
              h('div', { className: 'pa24-row' },
                h('button', { type: 'button', className: 'pa24-primary', disabled: busy, onClick: () => setEditor({ displayName: '', description: '', markdown: seed('') }) }, L('新建 Skill', 'New skill')),
                h('button', { type: 'button', className: 'pa24-quiet', disabled: busy, onClick: () => importInput.current?.click() }, L('导入 Markdown / ZIP', 'Import Markdown / ZIP')),
                h('input', { ref: importInput, type: 'file', accept: '.md,.zip', hidden: true, disabled: busy, onChange: event => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); } }),
                h('button', { type: 'button', className: 'pa24-quiet', onClick: () => setTick(value => value + 1), disabled: catalog.status === 'loading' }, icon('refresh'), L('刷新目录', 'Refresh catalog'))), 'violet'),
            h('details', { className: 'pa24-skill-help' }, h('summary', null, L('包与版本说明', 'Package and version notes')),
              h('p', { className: 'pa24-note' }, L('文件和内置原件可复制后编辑。草稿保存与启用分开；更新保留旧版本。完整包只包含 Skill 自身文件，不附带工作区配置、计划参数或运行历史。', 'Copy files or built-ins before editing. Saving a draft does not publish it. Earlier versions remain available. Packages contain only skill files.'))),
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
            catalog.status === 'loading' && !catalog.data && h('p', { role: 'status' }, L('正在读取 Skill 目录…', 'Reading skill catalog…')),
            catalog.status === 'error' && !catalog.data && h('p', { role: 'alert', className: 'pa24-error' }, catalog.error),
            catalog.data && h('div', { className: 'pa24-skill-layout' },
              h('section', { className: 'pa24-card pa24-skill-catalog', 'aria-label': L('Skill 目录', 'Skill catalog') },
                catalog.status === 'loading' && h('p', { role: 'status', className: 'pa24-meta' }, L('正在刷新；当前仍显示上次目录。', 'Refreshing; the previous catalog remains visible.')),
                catalog.status === 'error' && h('div', { role: 'alert', className: 'pa24-error' }, h('p', null, catalog.error), h('p', null, L('读取失败或当前离线；显示 ' + (catalog.data.observedAt || L('未知时间', 'unknown time')) + ' 的上次目录，内容可能不是最新。', 'Read failed or offline. Showing the previous catalog from ' + (catalog.data.observedAt || 'unknown time') + '; it may be stale.'))),
                h('p', { className: 'pa24-meta' }, catalog.data.discovery === 'complete'
                  ? L('当前目录已读取；同名工作区文件仅展示获胜来源。', 'Catalog loaded; only the winning workspace source for each name is shown.')
                  : catalog.data.discovery === 'unavailable' ? L('工作区目录不可用，当前仅展示内置原件。', 'Workspace catalog unavailable; showing built-in originals only.')
                  : L('工作区发现不完整或完整性未知，不能据此判断没有其他 Skill。', 'Workspace discovery is incomplete or unverified; other skills may exist.')),
                catalog.data.discoveryError && h('p', { role: 'alert', className: 'pa24-error' }, catalog.data.discoveryError),
                h('div', { className: 'pa24-skill-filters' },
                  h('label', null, L('搜索 Skill', 'Search skills'), h('input', { type: 'search', value: query, onChange: event => { setQuery(event.target.value); setPage(0); } })),
                  h('label', null, L('来源', 'Source'), h('select', { value: source, onChange: event => { setSource(event.target.value); setPage(0); } },
                    h('option', { value: 'all' }, L('全部', 'All')), h('option', { value: 'builtin' }, sourceLabel('builtin')), h('option', { value: 'project-dsh' }, sourceLabel('project-dsh')), h('option', { value: 'managed' }, sourceLabel('managed'))))),
                h('p', { className: 'pa24-meta' }, L('当前可见 ' + entries.length + ' 项，匹配 ' + matches.length + ' 项', entries.length + ' visible, ' + matches.length + ' matching')),
                !rows.length && h('p', { role: 'status' }, entries.length ? L('没有匹配项', 'No matches') : L('本次未返回目录项', 'No entries returned')),
                h('div', { className: 'pa24-skill-list' }, rows.map(entry => h('button', { type: 'button', key: entry.id, onClick: () => selectSkill(entry.id), 'aria-pressed': selected === entry.id, className: 'pa24-skill-row' },
                  h('span', { className: 'pa24-skill-row-head' },
                    h('span', { className: 'pa24-skill-row-title' }, h('strong', { title: entry.name }, entry.name), entry.internalName && entry.internalName !== entry.name && h('span', { className: 'pa24-skill-row-id', title: entry.internalName }, entry.internalName)),
                    h('span', { className: 'pa24-skill-row-tags' }, h('span', { className: 'pa24-skill-tag' }, sourceLabel(entry.source)), entry.managedStatus && entry.managedStatus !== 'enabled'
                      ? h('span', { className: 'pa24-skill-tag' }, managedStatusLabels[entry.managedStatus] || entry.managedStatus)
                      : entry.type && h('span', { className: 'pa24-skill-tag' }, typeLabel(entry.type)))),
                  h('span', { className: 'pa24-skill-row-desc' }, entry.description || L('尚无说明', 'No description')),
                  entry.status === 'error' && h('span', { className: 'pa24-skill-row-error' }, entry.error || L('待修正', 'Needs correction'))))),
                matches.length > 20 && h('div', { className: 'pa24-row pa24-skill-pagination' },
                  h('button', { type: 'button', disabled: page === 0, onClick: () => setPage(page - 1) }, L('上一页', 'Previous')),
                  h('span', null, (page + 1) + ' / ' + Math.ceil(matches.length / 20)),
                  h('button', { type: 'button', disabled: (page + 1) * 20 >= matches.length, onClick: () => setPage(page + 1) }, L('下一页', 'Next')))),
              h('section', { className: 'pa24-card pa24-skill-detail', 'aria-label': L('Skill 详情', 'Skill details') },
                !selected && empty('blocks', 'violet', L('选择一个 Skill', 'Select a skill'), L('从左侧目录查看概览、版本、关联计划和真实包内容；选择本身不会执行。', 'Select an item to inspect its overview, versions, linked plans and real package content. Selection does not execute it.')),
                selected && h(React.Fragment, null,
                  h('button', { type: 'button', onClick: () => selectSkill(null), className: 'pa24-quiet' }, L('返回 Skill 目录', 'Back to skill catalog')),
                  detail.status === 'loading' && h('p', { role: 'status' }, L('正在读取详情…', 'Reading details…')),
                  detail.status === 'error' && h('p', { role: 'alert', className: 'pa24-error' }, detail.error),
                  data && h('div', null,
                    h('h3', { ref: detailTitle, tabIndex: -1 }, data.name),
                    h('p', { className: 'pa24-meta' }, data.internalName || data.name), h('p', null, data.description),
                    data.entry?.status === 'deleted' && h('p', { role: 'status', className: 'pa24-note' }, L('此 Skill 已删除。版本、结果与运行历史仍可查阅；不能再编辑、启用或开始新运行。', 'This skill is deleted. Versions, results and run history remain accessible; editing, publishing and new runs are unavailable.')),
                    h('div', { className: 'pa24-row pa24-skill-actions' },
                      h('button', { type: 'button', disabled: busy || data.entry?.status === 'deleted', onClick: () => change({ op: 'save', copyFrom: data.id, versionId: data.versionId, fingerprint: data.fingerprint, displayName: (data.name + L(' 副本', ' copy')).slice(0, 120) }) }, L('复制为个人 Skill', 'Copy as personal skill')),
                      data.type === 'template' && h('button', { type: 'button', disabled: busy || data.entry?.status === 'deleted', onClick: () => change({ op: 'save', copyFrom: data.id, versionId: data.versionId, fingerprint: data.fingerprint, intelligentCopy: true, displayName: (data.name + L(' 智能副本', ' agent copy')).slice(0, 120) }) }, L('生成智能副本草稿', 'Create agent copy draft')),
                      h('button', { type: 'button', disabled: downloading, onClick: () => download(false) }, icon('note'), downloading ? L('准备下载…', 'Preparing download…') : L('下载指令 Markdown', 'Download instruction Markdown')),
                      h('button', { type: 'button', disabled: downloading, onClick: () => download(true) }, L('下载完整 ZIP 包', 'Download full ZIP package'))),
                    downloadError && h('p', { role: 'alert', className: 'pa24-error' }, downloadError),
                    h('div', { className: 'pa24-tabs pa24-skill-tabs', role: 'tablist', 'aria-label': L('Skill 详情视图', 'Skill detail views') }, detailTabs.map(([value, label], index) => h('button', {
                      key: value, id: 'pa24-skill-tab-' + value, type: 'button', role: 'tab', 'aria-selected': tab === value, 'aria-controls': 'pa24-skill-panel', tabIndex: tab === value ? 0 : -1,
                      className: tab === value ? 'pa24-filter-active' : 'pa24-quiet', onClick: () => setTab(value), onKeyDown: event => detailTabKey(event, index),
                    }, label))),
                    h('section', { id: 'pa24-skill-panel', role: 'tabpanel', 'aria-labelledby': 'pa24-skill-tab-' + tab },
                      tab === 'overview' && h(React.Fragment, null,
                        fields([[L('来源', 'Source'), sourceLabel(data.source)], [L('类型', 'Type'), typeLabel(data.type)], [L('执行轨', 'Track'), data.track], [L('内容指纹（非版本号）', 'Content fingerprint (not a version)'), data.fingerprint]]),
                        h('h4', null, L('运行范围与限制', 'Execution scope and restrictions')),
                        data.restrictions.map((text, index) => h('p', { className: 'pa24-meta', key: index }, text)),
                        data.verification && h('p', { className: 'pa24-meta' }, L('当前版本：运行 ' + data.verification.runs + ' 次，试运行 ' + data.verification.trials + ' 次，执行回合完成 ' + data.verification.completed + ' 次；业务完成请核对结果。', 'Current version: ' + data.verification.runs + ' runs, ' + data.verification.trials + ' trials, ' + data.verification.completed + ' completed executions; inspect results for business completion.')),
                        data.metadata?.pa24?.dependencies && h('details', null, h('summary', null, L('声明的运行依赖', 'Declared dependencies')), h('pre', { className: 'pa24-json' }, JSON.stringify(data.metadata.pa24.dependencies, null, 2))),
                        h('details', null, h('summary', null, L('声明与参数', 'Declared metadata')), h('pre', { className: 'pa24-json' }, JSON.stringify(data.metadata, null, 2))),
                        data.entry && h(SkillRunControls, { key: data.id + ':' + data.versionId, data, binding })),
                      tab === 'versions' && (data.entry ? h('section', { className: 'pa24-note' },
                        h('h4', null, L('版本与草稿', 'Versions and draft')),
                        fields([[L('状态', 'Status'), managedStatusLabels[data.entry.status] || data.entry.status], [L('修订', 'Revision'), String(data.entry.revision)], [L('当前启用版本', 'Published version'), data.entry.active_version || L('尚未启用', 'Unpublished')]]),
                        h('label', { className: 'pa24-field' }, L('查看版本', 'View version'), h('select', { value: version || data.entry.draft_version, onChange: event => { setVersion(event.target.value); setConfirmed(false); } },
                          data.versions.map(row => h('option', { key: row.id, value: row.id }, row.id.slice(0, 8) + ' · ' + (row.validation_error ? L('待修正', 'Invalid') : L('已保存', 'Saved')))))),
                        h('div', { className: 'pa24-row' },
                          h('button', { type: 'button', disabled: busy || data.entry.status === 'deleted', onClick: () => setEditor({ id: data.id, revision: data.entry.revision, versionId: data.versionId, displayName: data.name, markdown: data.markdown }) }, L('编辑此内容为新草稿', 'Edit as new draft')),
                          h('button', { type: 'button', disabled: busy || data.entry.status === 'deleted', onClick: () => change({ op: 'disable', id: data.id, expectedRevision: data.entry.revision }) }, L('禁用并暂停关联计划', 'Disable and pause plans'))),
                        h('label', { className: 'pa24-field' }, h('input', { type: 'checkbox', checked: confirmed, onChange: event => setConfirmed(event.target.checked) }), L('已核对本版本内容、权限声明和关联计划；启用只影响后续运行。', 'I reviewed this version, permissions and linked plans. Publishing affects future runs.')),
                        h('div', { className: 'pa24-row' },
                          h('button', { type: 'button', disabled: busy || data.entry.status === 'deleted' || !confirmed || data.restrictions.length > 0, onClick: () => change({ op: version && version !== data.entry.draft_version ? 'rollback' : 'publish', id: data.id, expectedRevision: data.entry.revision, versionId: data.versionId, confirm: true }) }, L('启用所选版本', 'Publish selected version')),
                          h('button', { type: 'button', disabled: busy || data.entry.status === 'deleted' || !confirmed || data.plansError || (data.plans || []).some(p => p.status !== 'stopped'), onClick: () => change({ op: 'delete', id: data.id, expectedRevision: data.entry.revision }) }, L('删除 Skill，保留历史', 'Delete skill, keep history'))))
                        : h('p', { className: 'pa24-note' }, L('此来源只有当前读取快照，没有受管持久版本。可复制为个人 Skill 后建立版本历史。', 'This source has only a current read snapshot, without managed persistent versions. Copy it as a personal skill to create version history.'))),
                      tab === 'plans' && h(React.Fragment, null,
                        h('h4', null, L('关联计划', 'Linked plans')),
                        h('p', { className: 'pa24-meta' }, data.source === 'managed' ? L('计划绑定稳定身份，修改显示名称不改变关联。', 'Plans bind to a stable identity; changing the display name preserves links.') : L('文件与内置项的既有计划按名称绑定。', 'Existing file and built-in plans bind by name.')),
                        data.plansError ? h('p', { role: 'alert', className: 'pa24-error' }, data.plansError) : data.plans?.length
                          ? data.plans.map(plan => h('p', { key: plan.id }, plan.kind + ' · ' + plan.id + ' · ' + plan.status)) : h('p', null, L('没有按此名称绑定的计划', 'No plans bound to this name'))),
                      tab === 'package' && h(SkillPackageBrowser, { key: JSON.stringify([binding, data.id, data.versionId || null, data.fingerprint, tick]), data, binding }),
                      tab === 'instructions' && h(React.Fragment, null,
                        h('h4', null, L('指令正文', 'Instructions')), h('pre', { className: 'pa24-json' }, data.content),
                        data.type === 'template' && h('p', { className: 'pa24-note' }, L('确定性模板不调用模型。自由修改业务行为请先生成智能副本；智能副本更灵活，实际运行会产生模型用量，工具须另行声明。', 'Deterministic templates do not call a model. Create an agent copy to change behavior; running it uses model tokens and requires explicit tool declarations.')))))))));
        }

        // 卡片注册表：tier 为纯函数（角标聚合复用同一结果）；label 可覆盖状态词。
        const CARDS = [
          {
            id: 'skills', cat: 'work', tone: 'violet', icon: 'blocks', title: ['Skill 管理', 'Skill management'], sub: ['能力、版本与手工运行', 'Capabilities, versions and manual runs'], action: ['查看 Skill', 'Browse skills'],
            tier: () => 'unchecked',
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
            id: 'activity', cat: 'work', tone: 'blue', icon: 'history', title: ['运行记录', 'Run history'], sub: ['执行 · 投递 · 助理交办', 'Execution · delivery · work items'], action: ['查看运行档案', 'Open run history'],
            tier: ({ extra }) => extra._errors?.runs ? 'error' : !extra.runs?.observedAt || extra.runs.empty ? 'unchecked' : extra.runs.unresolved || extra.runs.unresolved_events || extra.runs.waiting_work || extra.runs.failed_work ? 'warn' : 'ok',
            label: ({ extra }) => !extra._errors?.runs && extra.runs?.empty ? L('暂无档案', 'No history') : null,
            body: ({ extra }) => {
              const summary = extra.runs;
              if (summary?.empty) return h('div', null, h('p', null, L('暂无运行档案', 'No run history yet')), h('p', { className: 'pa24-meta' }, L('这是中性空状态，不代表异常或健康检查通过。', 'Neutral empty state; neither an error nor a health pass.')));
              return summary?.observedAt ? h('div', null, capKpi([[summary.runs24, L('24 小时运行', '24h runs')], [summary.failed24, L('24 小时执行失败', '24h execution failures')], [summary.delivery_failed24, L('24 小时投递失败', '24h delivery failures')]]),
                capLine(L('24 小时投递待核对', '24h delivery unknown'), summary.delivery_unknown24 ?? 0), capLine(L('全量需处理运行', 'All unresolved runs'), summary.unresolved), capLine(L('全量待处理事件', 'All unresolved events'), summary.unresolved_events),
                capLine(L('待我处理交办', 'Work awaiting you'), summary.waiting_work), capLine(L('异常交办', 'Failed work'), summary.failed_work))
                : h('p', { className: 'pa24-meta' }, extra._errors?.runs || L('正在读取完整统计…', 'Reading complete statistics…'));
            },
            detail: helpers => h(RunHistoryDetail, { key: helpers.state.workspaceBinding, ...helpers }),
          },
          {
            id: 'reminders', cat: 'work', tone: 'amber', icon: 'calendar', title: ['日程', 'Calendar'], sub: ['今日安排 · 多日历与原生提醒', 'Today · calendars and native reminders'], action: ['查看日程', 'View calendar'],
            tier: ({ extra }) => Array.isArray(extra.calendar?.sources) ? extra.calendar.complete ? 'ok' : 'warn' : 'unchecked',
            body: ({ extra, tz }) => {
              const data = Array.isArray(extra.calendar?.sources) ? extra.calendar : null;
              const ongoing = data?.next && Date.parse(data.next.start) <= Date.now() && Date.parse(data.next.end) > Date.now(), nextRange = data?.next ? calendarRange(data.next, tz) : null;
              return h('div', null, capLine(L('今日日程', 'Today’s events'), data ? data.count + (data.complete ? L(' 项（完整观察）', ' (complete observations)') : L(' 项（当前可展示）', ' (currently available)')) : extra._errors?.calendar || L('读取中…', 'Loading…')),
                capLine(ongoing ? L('进行中', 'In progress') : L('下一场', 'Next event'), data?.next ? data.next.summary + ' · ' + nextRange.detail + ' · ' + nextRange.zone : data?.complete ? L('当前筛选无下一场', 'No next event in this filter') : L('当前可展示结果无下一场', 'No next event in available observations')),
                data && capLine(L('已知冲突', 'Known conflicts'), data.conflicts.length + L(' 处', '')),
                data && capLine(L('查询完整性', 'Query completeness'), data.complete ? L('保存的完整观察', 'Saved complete observations') : L('范围不完整', 'Incomplete coverage')));
            },
            detail: helpers => h(CalendarDetail, { key: helpers.state.workspaceBinding, ...helpers }),
          },
          {
            id: 'review', cat: 'knowledge', tone: 'danger', icon: 'pen', title: ['手写审核', 'Handwriting review'], sub: ['待审文档与版本核验', 'Pending versions & verification'], action: ['打开审核', 'Open review'],
            tier: ({ extra }) => (extra.review ? (extra.review.count > 0 ? 'warn' : 'ok') : 'unchecked'),
            label: ({ extra }) => (extra.review && extra.review.count > 0 ? L('待审 ' + extra.review.count, extra.review.count + ' to review') : null),
            body: ({ extra }) => (extra.review && extra.review.count > 0
              ? h('div', null, capKpi([[String(extra.review.count), L('待处理', 'To review')], [String(extra.review.counts?.returned ?? 0), L('已退回', 'Returned')], [String(extra.review.counts?.needs_rereview ?? 0), L('需重审', 'Needs review')], [String(extra.review.counts?.verificationUnknown ?? 0), L('核验未知', 'Unverified')]]), h('p', { className: 'pa24-meta' }, L('批准/退回在飞书审核卡上完成', 'Approve/return happens on the Feishu review card')))
              : h('p', { className: 'pa24-meta' }, L('拍照整理后的待审版本会出现在这里', 'Pending versions from photographed notes appear here'))),
            detail: helpers => (helpers.workspace ? h(ReviewView, { key: helpers.state.workspaceBinding, workspace: helpers.workspace, binding: helpers.state.workspaceBinding, openRobot: helpers.openRobot }) : empty('pen', 'blue', L('尚未绑定工作区', 'No workspace bound'), L('在接入与设置的「工作区与配置」绑定工作区后，手写审核队列会显示在这里。', 'Bind a workspace via Workspace & config under Connections & setup and the review queue will show up here.'))),
          },
          {
            id: 'memory', cat: 'knowledge', tone: 'violet', icon: 'memory', title: ['结构化记忆', 'Structured memory'], sub: ['偏好 · 事实 · 项目背景', 'Preferences · facts · project background'], action: ['检索记忆', 'Search memories'],
            tier: ({ state }) => (state.workspace ? 'ok' : 'missing'),
            body: ({ extra }) => (extra.memory ? capLine(L('已保存', 'Stored'), extra.memory.total + L(' 条', '')) : h('p', { className: 'pa24-meta' }, L('读取中…', 'Loading…'))),
            detail: helpers => (helpers.workspace ? h(MemoryView, { key: helpers.state.workspaceBinding + helpers.workspace.path, workspace: helpers.workspace, binding: helpers.state.workspaceBinding, openRobot: helpers.openRobot }) : empty('memory', 'violet', L('尚未绑定工作区', 'No workspace bound'), L('绑定工作区后，记忆会按确认状态显示在这里。', 'Once a workspace is bound, memories show up here with their confirmation status.'))),
          },
          {
            id: 'digest', cat: 'work', tone: 'green', icon: 'calendarClock', title: ['定时任务', 'Scheduled tasks'], sub: ['时间 + Skill · 晨报与复盘预设', 'Time + skill · digest presets'], action: ['管理定时任务', 'Manage plans'],
            tier: ({ extra }) => extra._errors?.plans ? 'error' : extra.plans?.total === undefined || extra.plans.total === 0 ? 'unchecked' : extra.plans.blocked || extra.plans.timingError ? 'warn' : 'ok',
            label: ({ extra }) => extra.plans?.total === 0 ? L('暂无计划', 'No plans') : undefined,
            body: ({ extra, tz }) => {
              const plans = extra.plans;
              if (plans?.total === 0) return h('p', { className: 'pa24-meta' }, L('暂无计划；可新建或选择预设。', 'No plans yet. Create one or choose a preset.'));
              return plans?.total !== undefined ? h('div', null, capKpi([[plans.enabled, L('启用', 'Enabled')], [plans.paused, L('暂停', 'Paused')], [plans.blocked, L('需处理', 'Needs attention')]]),
                capLine(L('下次运行', 'Next run'), plans.next ? plans.next.title + ' · ' + date(plans.next.at, plans.next.timeZone || tz) : L('暂无已核验触发时间', 'No verified occurrence')))
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
              if (extra.minutes?.lastRead) return extra.minutes.lastRead.state === 'succeeded' ? 'ok' : 'warn';
              const cap = extra.health?.capabilities?.find(row => row.id === 'qwennote-channel');
              if (!cap) return 'unchecked';
              return ['warn', 'error'].includes(cap.state) ? cap.state : 'unchecked';
            },
            label: ({ state, extra }) => !qwennoteConfigured(state.workspace ? state.workspace.config : null) ? L('待配置', 'Not configured') : extra.minutes?.lastRead ? extra.minutes.lastRead.state === 'succeeded' ? L('最近调用成功', 'Last call succeeded') : L('最近调用失败', 'Last call failed') : L('读取未验证', 'Read unverified'),
            body: ({ extra }) => {
              const cap = extra.health?.capabilities?.find(row => row.id === 'qwennote-channel');
              return h('div', null,
                capLine(L('放行结论', 'Allowance'), cap ? cap.message : L('尚未检查', 'Not checked')),
                capLine(L('最近实际调用', 'Latest actual call'), extra.minutes?.lastRead ? date(extra.minutes.lastRead.read_at) : L('尚无回执', 'No receipt yet')),
                nextStrip(L('本人完成授权后，仍需在本地对话实际读取资料；工具挂载不代表可读。', 'After browser authorization, verify a real read in local chat. Mounted tools do not prove readability.')));
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
            detail: helpers => h(BackupDetail, { ...helpers, key: helpers.state.workspaceBinding }),
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
            id: 'budget', cat: 'ops', tone: 'green', icon: 'pulse', title: ['模型与预算', 'Models & budget'], sub: ['实际模型 · 持久用量 · 限额', 'Actual models · durable usage · limits'], action: ['查看预算', 'View budget'],
            tier: ({ extra }) => extra._errors?.budget ? 'error' : !extra.budget?.status ? 'unchecked' : extra.budget.status === 'ok' ? 'ok' : 'warn',
            body: ({ extra }) => extra._errors?.budget ? h('p', { className: 'pa24-meta' }, L('用量读取失败，请打开重试。', 'Usage could not be read; open to retry.')) : extra.budget?.config
              ? h('div', null, capLine(L('本周期请求', 'Requests this period'), extra.budget.requests), capLine(L('Token', 'Tokens'), budgetValue(extra.budget.tokens)), capLine(L('估算费用', 'Estimated cost'), budgetValue(extra.budget.estimatedCost) + ' ' + extra.budget.currency), extra.budget.waiting?.length > 0 && nextStrip(extra.budget.waiting.length + L(' 项运行等待预算处理', ' runs need budget action')))
              : h('p', { className: 'pa24-meta' }, L('尚未读取持久用量', 'Durable usage not read')),
            detail: helpers => h(BudgetDetail, { key: helpers.state.workspaceBinding, helpers }),
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
              [L('生效时间', 'Loaded at'), date(view.data.loadedAt, tzOf(state))], [L('进行中交办', 'Active work'), view.data.impacts?.work], [L('待发或未知投递', 'Pending or unknown deliveries'), view.data.impacts?.outbox], [L('待审版本', 'Pending reviews'), view.data.impacts?.reviews], [L('保留的定时任务', 'Retained plans'), view.data.impacts?.plans],
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
            budget: JSON.parse(JSON.stringify(config?.budget ?? { period: 'month', warningRatio: 0.8, maxRequests: null, maxTokens: null, maxEstimatedCost: null, currency: 'CNY', prices: [] })),
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
                budget: { ...form.budget, warningRatio: Number(form.budget.warningRatio), maxRequests: budgetNumber(form.budget.maxRequests), maxTokens: budgetNumber(form.budget.maxTokens), maxEstimatedCost: budgetNumber(form.budget.maxEstimatedCost),
                  prices: form.budget.prices.map(price => ({ provider: price.provider.trim(), model: price.model.trim(), basis: price.basis.trim(), inputPerMillion: budgetNumber(price.inputPerMillion), outputPerMillion: budgetNumber(price.outputPerMillion),
                    ...Object.fromEntries(['cacheReadPerMillion', 'cacheWritePerMillion'].filter(key => price[key] !== '' && price[key] != null).map(key => [key, Number(price[key])])) })) },
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
              h(BudgetConfigFields, { value: form.budget, onChange: value => set('budget', value) }),
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
            const fields = { 'feishu.application': 'feishuAppId', 'feishu.resource:folder': 'folderToken', 'feishu.resource:wiki': 'wikiNodeToken', 'feishu.resource:tasklist': 'tasklistId', 'feishu.resource:calendar': 'calendarId', 'wecom.push': 'notifyChannel', 'wecom.push-authorization': 'notifyChannel', voice: 'tts.engine', models: 'workerModels', materials: 'extraLocalTools' };
            const field = row.scope.startsWith('source:') || row.scope === 'sources' || row.scope.startsWith('wecom.') && !row.scope.startsWith('wecom.push') ? 'sources' : fields[row.scope] || (row.scope.startsWith('feishu') ? 'larkProfile' : 'mode');
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
              h('div', { className: 'pa24-row pa24-between' }, h('h2', null, L('CLI 与身份', 'CLI & identity')), statusBadge(wecom.cli.state !== 'ok' || wecom.identity.state === 'error' ? 'error' : wecom.identity.state === 'ok' ? 'ok' : 'warn', wecom.cli.state !== 'ok' ? L('CLI 不可用', 'CLI unavailable') : wecom.identity.state === 'ok' ? undefined : L('身份待核验', 'Identity needs verification'))),
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
