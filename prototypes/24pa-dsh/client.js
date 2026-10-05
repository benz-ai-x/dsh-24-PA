// Native dsh workspace management; daily input and review arrive through Feishu.
window.__ModuleLoader__.load({
  id:'@benz-ai-x/dsh-24pa-prototype',
  factory(require) {
    const React=require('react'), h=React.createElement;
    const zh={panel:'24PA 工作区',title:'24PA · 你的助理工作区',subtitle:'飞书交办 · Lead 协调 · Worker 执行',workspace:'工作区',workers:'专业 Worker',work:'正在办理的事项',notes:'手写文档与审核',memory:'结构化记忆',logs:'运行记录',maintain:'进入工作区维护会话',lead:'查看 Lead 会话',refresh:'刷新',bind:'绑定所选工作区',reload:'重载 AGENTS.md',empty:'暂无记录',readme:'先在 dsh 侧栏添加服务器目录，再在这里选择。首次绑定空目录会生成 AGENTS.md。',config:'当前生效配置',search:'查询记忆',query:'按关键词查询记忆',memoryHint:'通过工作区维护会话新增、更正、删除和整理。正文采用 JSON，修订检查版本；整理由你发起。',pending:'等待本人审核',approved:'本人已审核此版本',rejected:'已退回修改',unknown:'需要重新核验',queued:'排队中',running:'处理中',completed:'已完成',waiting_review:'等待本人审核',needs_revision:'待修改',failed:'未完成',stopped:'已停止',open:'打开飞书文档',loading:'正在连接工作区…',demo:'当前为 demo，未连接飞书。配置 AGENTS.md 并重载后，可从飞书文字和拍照入口体验。模型使用 dsh 的实际配置。',emptyWork:'从飞书发送一句委托或拍一页纸质笔记。Lead 会安排对应 Worker，进度与结果显示在这里。',commands:'在维护会话中可以说：“查看与会议有关的记忆”“记住我偏好的提醒时间”“整理项目 X 的记忆，列出冲突”。',choose:'选择 dsh 工作区',configHint:'配置源：工作区 AGENTS.md。凭据值由服务器环境或 CLI 授权保存。',enabled:'已启用',disabled:'未启用',inspect:'查看原生 Worker 会话',reviewHint:'使用飞书卡片审核指定版本；审核后，可明确发送“/执行 笔记编号 任务内容”创建行动。',maintenanceHint:'日常交办、拍照和审核在飞书完成。此页用于配置与观察，维护在 dsh 原生会话中完成。'};
    const en={...zh,panel:'24PA Workspace',title:'24PA · Assistant workspace',refresh:'Refresh',workspace:'Workspace',workers:'Workers',work:'Work items',memory:'Structured memory'};
    const style = `
      .pa24{height:100%;overflow:auto;padding:24px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.6 system-ui}
      .pa24 *{box-sizing:border-box}.pa24 h1{font-size:24px;margin:0 0 8px}.pa24 h2{font-size:17px;margin:0 0 12px}.pa24 p{margin:6px 0}
      .pa24-wrap{max-width:1180px;margin:auto}.pa24-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pa24-tabs{margin:18px 0}
      .pa24 button{font:inherit;padding:7px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer}
      .pa24 button:disabled{opacity:.45;cursor:default}.pa24 button[aria-selected=true],.pa24 .selected{outline:2px solid var(--dsw-alias-brand-primary);font-weight:650}
      .pa24 textarea,.pa24 input{font:inherit;width:100%;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base)}
      .pa24 textarea{min-height:100px;resize:vertical}.pa24 .note-edit{min-height:260px}.pa24-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:16px}
      .pa24-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;margin-bottom:14px}.pa24-note{white-space:pre-wrap;overflow-wrap:anywhere}
      .pa24-meta{opacity:.7;font-size:12px}.pa24-item{padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.pa24-error{border:1px solid currentColor;padding:12px;border-radius:8px;margin:12px 0}
      .pa24 pre{white-space:pre-wrap;word-break:break-word;max-height:450px;overflow:auto;font-size:12px}.pa24 a{color:inherit;text-decoration:underline}.pa24 figure{margin:8px 0}.pa24 img{max-width:100%;max-height:260px;object-fit:contain}
      @media(max-width:760px){.pa24{padding:12px}.pa24-grid{grid-template-columns:1fr}}
    `;
    return {
      inject:['slots','locale','layout','connection','uiWorkspace'],
      apply(ctx) {
        ctx.effect(()=>ctx.locale.register('pa24',{zh,en})); const t=ctx.locale.bind('pa24');
        const rpc=async(endpoint,payload={})=>{ const response=await fetch('./api/24pa-prototype',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint,payload})}); if(!response.ok)throw new Error(`dsh HTTP ${response.status}`);const result=await response.json();if(!result.ok)throw new Error(result.error.message);return result.value; };
        function Panel() {
          const [state,setState]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
          const [tab,setTab]=React.useState('work'),[path,setPath]=React.useState(''),[query,setQuery]=React.useState(''),[memory,setMemory]=React.useState(null);
          const refresh=async()=>{const s=await rpc('snapshot');setState(s);return s;};
          React.useEffect(()=>{let live=true;const load=()=>void rpc('snapshot').then(s=>{if(live)setState(s);}).catch(e=>{if(live)setError(e.message);});load();const timer=setInterval(load,2000);return()=>{live=false;clearInterval(timer);};},[]);
          const run=async(fn)=>{setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}};
          const b=(label,fn,props={})=>h('button',{type:'button',disabled:busy,onClick:()=>void run(fn),...props},label);
          const card=(title,...children)=>h('section',{className:'pa24-card'},h('h2',null,title),...children);
          const rows=(items,render,empty=t('empty'))=>items?.length?items.map(render):h('p',{className:'pa24-meta'},empty);
          const ext=n=>n.external?.url?h('a',{href:n.external.url,target:'_blank',rel:'noreferrer'},t('open')):null;
          if(!state)return h('main',{className:'pa24'},h('style',null,style),h('p',null,error||t('loading')));
          const workspace=state.workspace;
          let content;
          if(tab==='work') content=h('div',null,
            card(t('work'),rows(state.jobs,j=>h('div',{className:'pa24-item',key:j.id},h('div',{className:'pa24-row'},h('strong',null,j.title),h('span',null,t(j.status))),h('p',{className:'pa24-meta'},`${state.workers.find(w=>w.id===j.role)?.name||j.role} · ${j.id}`),h('p',null,j.progress),j.result&&h('details',null,h('summary',null,'Worker 结果'),h('div',{className:'pa24-note'},j.result)),j.started&&b(t('inspect'),()=>ctx.uiWorkspace.openSession({childSessionId:j.id,parentSessionId:workspace.leadId,mode:'continuable'}))),t('emptyWork'))),
            card(t('workers'),h('div',{className:'pa24-row'},state.workers.map(w=>h('div',{key:w.id,className:'pa24-card',style:{flex:'1 1 160px',margin:0}},h('strong',null,w.name),h('p',null,w.enabled?t('enabled'):t('disabled')),h('p',{className:'pa24-meta'},`${w.running} 项处理中`))))));
          else if(tab==='workspace') content=h('div',null,card(t('workspace'),h('p',null,t('readme')),h('label',null,t('choose'),h('select',{value:path,onChange:e=>setPath(e.target.value),style:{width:'100%',padding:12,margin:'10px 0',background:'var(--dsw-alias-bg-base)',color:'inherit'}},h('option',{value:''},'—'),state.availableWorkspaces.map(w=>h('option',{value:w.path,key:w.id},`${w.title} · ${w.path}`)))),b(t('bind'),()=>rpc('action',{type:'workspace.bind',path}),{disabled:busy||!path}),h('p',{className:'pa24-meta'},t('configHint'))),card(t('config'),workspace?h('pre',null,JSON.stringify(workspace.config,null,2)):t('loading'),b(t('reload'),()=>rpc('action',{type:'workspace.reload'}))));
          else if(tab==='memory') content=card(t('memory'),h('p',null,t('memoryHint')),h('p',{className:'pa24-meta'},workspace?`${workspace.path}/.24pa-prototype/memory.json`:''),h('input',{value:query,placeholder:t('query'),onChange:e=>setQuery(e.target.value)}),b(t('search'),async()=>setMemory(await rpc('memory',{query}))),memory&&h('p',null,`revision ${memory.revision}`),rows(memory?.records,r=>h('div',{key:r.id,className:'pa24-item'},h('strong',null,`${r.category} · ${r.topic||r.id}`),h('p',null,r.content),h('p',{className:'pa24-meta'},`${r.status} · ${r.source} · ${r.updatedAt}`))));
          else if(tab==='notes') content=card(t('notes'),h('p',null,t('reviewHint')),rows(state.notes,n=>h('div',{key:n.id,className:'pa24-item'},h('strong',null,`${n.title} · ${n.id} · v${n.version} · ${t(n.status)}`),h('p',null,ext(n)),h('details',null,h('summary',null,'整理内容'),h('div',{className:'pa24-note'},n.text)))));
          else content=card(t('logs'),rows(state.audit.slice(-30).reverse(),(a,i)=>h('div',{key:i,className:'pa24-item'},h('span',{className:'pa24-meta'},a.at),h('p',null,a.message))),h('details',null,h('summary',null,'完整原型状态'),h('pre',null,JSON.stringify(state,null,2))));
          return h('main',{className:'pa24'},h('style',null,style),h('div',{className:'pa24-wrap'},h('p',{className:'pa24-meta'},t('subtitle')),h('h1',null,t('title')),h('p',null,t('maintenanceHint')),
            card(workspace?workspace.path:t('workspace'),h('div',{className:'pa24-row'},b(t('maintain'),async()=>{const result=await rpc('action',{type:'maintenance.open'});ctx.uiWorkspace.openSession(result.sessionId);},{disabled:busy||!workspace}),workspace&&b(t('lead'),()=>ctx.uiWorkspace.openSession(workspace.leadId)),b(t('refresh'),refresh)),h('p',null,state.connection),h('p',{className:'pa24-meta'},t('commands'))),
            state.mode==='demo'&&h('p',{className:'pa24-card'},t('demo')),error&&h('p',{role:'alert',className:'pa24-error'},error),h('nav',{className:'pa24-row pa24-tabs'},['work','workspace','memory','notes','logs'].map(id=>b(t(id),()=>setTab(id),{key:id,'aria-selected':tab===id}))),content,h('p',{className:'pa24-meta'},state.limits)));
        }
        const Icon=()=>h('span',{'aria-hidden':true,style:{fontWeight:700,fontSize:12}},'24');
        ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'pa24-prototype',locale:'pa24'},Panel));
        ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'pa24-prototype',order:24,locale:'pa24',label:()=>t('panel')},Icon));
      }
    };
  }
});
