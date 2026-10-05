// Native dsh workspace management; daily input and review arrive through Feishu.
window.__ModuleLoader__.load({
  id:'@benz-ai-x/dsh-24pa-prototype',
  factory(require) {
    const React=require('react'), h=React.createElement;
    const zh={panel:'24PA 工作区',title:'24PA 机器人',subtitle:'一个机器人 · 事务协调与工作区维护',workspace:'工作区',workers:'专业 Worker',work:'正在办理的事项',notes:'手写文档与审核',memory:'结构化记忆',logs:'运行记录',feishu:'飞书接入',maintain:'与24PA机器人对话',lead:'查看飞书接入会话',refresh:'刷新',bind:'绑定所选工作区',reload:'重载 AGENTS.md',empty:'暂无记录',readme:'先在 dsh 侧栏添加服务器目录，再在这里选择。首次绑定空目录会生成 AGENTS.md。',config:'当前生效配置',search:'查询记忆',query:'按关键词查询记忆',memoryHint:'在同一个24PA机器人会话里新增、更正、删除和整理。正文采用 JSON，修订检查版本；整理由你发起。',pending:'等待本人审核',approved:'本人已审核此版本',rejected:'已退回修改',unknown:'需要重新核验',queued:'排队中',running:'处理中',completed:'已完成',waiting_review:'等待本人审核',needs_revision:'待修改',failed:'未完成',stopped:'已停止',open:'打开飞书文档',loading:'正在连接工作区…',demo:'当前为 demo，未连接飞书。配置 AGENTS.md 并重载后，可从飞书文字和拍照入口体验。模型使用 dsh 的实际配置。',emptyWork:'在飞书发送委托或拍照提交笔记；也可在 dsh 与24PA机器人对话。机器人安排 Worker，进度与结果显示在这里。',commands:'可以说：“检查飞书接入”“把同时处理数改为3”“记住我的会议偏好”“帮我记个待办”。',choose:'选择 dsh 工作区',configHint:'配置源：工作区 AGENTS.md。凭据值由服务器环境或 CLI 授权保存。',enabled:'已启用',disabled:'未启用',inspect:'查看原生 Worker 会话',reviewHint:'使用飞书卡片审核指定版本；审核后，可明确发送“/执行 笔记编号 任务内容”创建行动。',maintenanceHint:'飞书负责日常交办、拍照和审核；dsh 的同一个机器人会话既能协调事务，也能维护配置和记忆。此页只查阅状态，无需配置表单。'};
    const en={...zh,panel:'24PA Workspace',title:'24PA · Assistant workspace',refresh:'Refresh',workspace:'Workspace',workers:'Workers',work:'Work items',memory:'Structured memory'};
    const style = `
      .pa24{height:100%;overflow:auto;padding:24px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.6 system-ui}
      .pa24 *{box-sizing:border-box}.pa24 h1{font-size:24px;margin:0 0 8px}.pa24 h2{overflow-wrap:anywhere;font-size:17px;margin:0 0 12px}.pa24 p{margin:6px 0}
      .pa24-wrap{max-width:1180px;margin:auto}.pa24-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pa24-tabs{margin:18px 0}
      .pa24 button{font:inherit;padding:7px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer}
      .pa24 button:disabled{opacity:.45;cursor:default}.pa24 button[aria-selected=true],.pa24 .selected{outline:2px solid var(--dsw-alias-brand-primary);font-weight:650}
      .pa24 textarea,.pa24 input{font:inherit;width:100%;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:inherit;background:var(--dsw-alias-bg-base)}
      .pa24 textarea{min-height:100px;resize:vertical}.pa24 .note-edit{min-height:260px}.pa24-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:16px}
      .pa24-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:16px;margin-bottom:14px}.pa24-note{white-space:pre-wrap;overflow-wrap:anywhere}
      .pa24-dl{display:grid;grid-template-columns:140px 1fr;gap:8px;margin:10px 0}.pa24-dl dt{opacity:.65;overflow-wrap:anywhere}.pa24-dl dd{margin:0;overflow-wrap:anywhere}.pa24-meta{opacity:.7;font-size:12px}.pa24-item{padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.pa24-error{border:1px solid currentColor;padding:12px;border-radius:8px;margin:12px 0}
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
          const fields=items=>h('dl',{className:'pa24-dl'},items.map(([label,value])=>h(React.Fragment,{key:label},h('dt',null,label),h('dd',null,value||'未配置'))));
          const moment=value=>value?new Date(value).toLocaleString():'尚无记录';
          const ext=n=>n.external?.url?h('a',{href:n.external.url,target:'_blank',rel:'noreferrer'},t('open')):null;
          if(!state)return h('main',{className:'pa24'},h('style',null,style),h('p',null,error||t('loading')));
          const workspace=state.workspace;
          let content;
          if(tab==='work') content=h('div',null,
            card(t('work'),rows(state.jobs,j=>h('div',{className:'pa24-item',key:j.id},h('div',{className:'pa24-row'},h('strong',null,j.title),h('span',null,t(j.status))),h('p',{className:'pa24-meta'},`${j.origin==='dsh'?'dsh 会话':'飞书'} · ${state.workers.find(w=>w.id===j.role)?.name||j.role} · ${j.id}`),h('p',null,j.progress),j.result&&h('details',null,h('summary',null,'Worker 结果'),h('div',{className:'pa24-note'},j.result)),j.started&&b(t('inspect'),()=>ctx.uiWorkspace.openSession({childSessionId:j.id,parentSessionId:j.parentSessionId||workspace.leadId,mode:'continuable'}))),t('emptyWork'))),
            card(t('workers'),h('div',{className:'pa24-row'},state.workers.map(w=>h('div',{key:w.id,className:'pa24-card',style:{flex:'1 1 160px',margin:0}},h('strong',null,w.name),h('p',null,w.enabled?t('enabled'):t('disabled')),h('p',{className:'pa24-meta'},`${w.running} 项处理中`))))));
          else if(tab==='feishu') {
            const f=state.feishu, check=f.check;
            content=h('div',null,
              card('飞书接入概览',h('p',null,'用对话完成配置；这里查阅生效值和检查结果。检查只读取，不创建飞书对象。'),
                h('div',{className:'pa24-row'},b(f.checking?'检查中…':'检查接入状态',()=>rpc('action',{type:'connection.check'}),{disabled:busy||f.checking}),b('通过对话配置',async()=>{const r=await rpc('action',{type:'robot.open'});ctx.uiWorkspace.openSession(r.sessionId);})),
                fields([['固定 CLI profile',f.profile],['接入模式',f.mode==='demo'?'demo · 未接入飞书':'feishu'],['配置源',f.source],['配置生效时间',moment(f.loadedAt)],['上次检查',check?moment(check.checkedAt):'尚未检查'],['文件与生效版本',check?.source?.message||'点击检查，核对是否有未重载的修改']]),
                h('p',{className:'pa24-meta'},'例如：“检查飞书接入，告诉我还缺什么”；“文档目录设为…，检查配置并重载”。')),
              h('div',{className:'pa24-grid'},
                card('CLI 与用户授权',fields([['安装状态',check?.cli?.message||'尚未检查'],['CLI 路径',check?.cli?.path||'尚未检查'],['版本',check?.cli?.version||'尚未检查'],['授权检查',check?.auth?.message||'尚未检查'],['CLI 用户',check?.auth?.userName||'尚未取得'],['CLI open_id',check?.auth?.openId||'尚未取得'],['配置主人',f.config.ownerOpenId],['用户令牌',check?.auth?.tokenStatus||'尚未确认']])),
                card('机器人连接',h('p',null,f.bot.message),fields([['最近收到本人消息',moment(f.bot.lastReceivedAt)],['最近发送获平台确认',moment(f.bot.lastSentAt)],...f.credentials.map(c=>[c.name,c.present?'启动环境已提供（值隐藏）':'启动环境未提供'])]),h('p',{className:'pa24-meta'},'长连接启动不代表端到端可用。在飞书发 /24pa 并收到回复，再核对本次运行的收发记录。'))),
              card('使用的飞书资源',fields([['文档目录',f.config.folderToken],['任务清单',f.config.tasklistId],['本人日历',f.config.calendarId],['时区',f.config.timeZone]]),
                check?rows(check.resources,r=>h('p',{key:r.id},`${r.label}：${r.message}`)):h('p',{className:'pa24-meta'},'尚未检查。身份未验证或与主人不一致时，不读取配置的资源。'),h('p',{className:'pa24-meta'},'读取通过只证明可读性；写入权限需要实际任务回执验证。初次 CLI 授权仍需在服务器完成。')));
          }
          else if(tab==='workspace') content=h('div',null,card(t('workspace'),h('p',null,t('readme')),h('label',null,t('choose'),h('select',{value:path,onChange:e=>setPath(e.target.value),style:{width:'100%',padding:12,margin:'10px 0',background:'var(--dsw-alias-bg-base)',color:'inherit'}},h('option',{value:''},'—'),state.availableWorkspaces.map(w=>h('option',{value:w.path,key:w.id},`${w.title} · ${w.path}`)))),b(t('bind'),()=>rpc('action',{type:'workspace.bind',path}),{disabled:busy||!path}),h('p',{className:'pa24-meta'},t('configHint'))),card(t('config'),workspace?h('pre',null,JSON.stringify(workspace.config,null,2)):t('loading'),b(t('reload'),()=>rpc('action',{type:'workspace.reload'}))));
          else if(tab==='memory') content=card(t('memory'),h('p',null,t('memoryHint')),h('p',{className:'pa24-meta'},workspace?`${workspace.path}/.24pa-prototype/memory.json`:''),h('input',{value:query,placeholder:t('query'),onChange:e=>setQuery(e.target.value)}),b(t('search'),async()=>setMemory(await rpc('memory',{query}))),memory&&h('p',null,`revision ${memory.revision}`),rows(memory?.records,r=>h('div',{key:r.id,className:'pa24-item'},h('strong',null,`${r.category} · ${r.topic||r.id}`),h('p',null,r.content),h('p',{className:'pa24-meta'},`${r.status} · ${r.source} · ${r.updatedAt}`))));
          else if(tab==='notes') content=card(t('notes'),h('p',null,t('reviewHint')),rows(state.notes,n=>h('div',{key:n.id,className:'pa24-item'},h('strong',null,`${n.title} · ${n.id} · v${n.version} · ${t(n.status)}`),h('p',null,ext(n)),h('details',null,h('summary',null,'整理内容'),h('div',{className:'pa24-note'},n.text)))));
          else content=card(t('logs'),h('details',null,h('summary',null,'内部会话与诊断'),h('p',null,'Lead 是机器人内部的协调职责。日常交互使用24PA机器人，无需选择另一个维护预设。'),workspace&&b(t('lead'),()=>ctx.uiWorkspace.openSession(workspace.leadId))),rows(state.audit.slice(-30).reverse(),(a,i)=>h('div',{key:i,className:'pa24-item'},h('span',{className:'pa24-meta'},a.at),h('p',null,a.message))),h('details',null,h('summary',null,'完整原型状态'),h('pre',null,JSON.stringify(state,null,2))));
          return h('main',{className:'pa24'},h('style',null,style),h('div',{className:'pa24-wrap'},h('p',{className:'pa24-meta'},t('subtitle')),h('h1',null,t('title')),h('p',null,t('maintenanceHint')),
            card(workspace?workspace.path:t('workspace'),h('div',{className:'pa24-row'},b(t('maintain'),async()=>{const result=await rpc('action',{type:'robot.open'});ctx.uiWorkspace.openSession(result.sessionId);},{disabled:busy||!workspace}),b(t('refresh'),refresh)),h('p',null,state.connection),h('p',{className:'pa24-meta'},t('commands'))),
            state.mode==='demo'&&h('p',{className:'pa24-card'},t('demo')),error&&h('p',{role:'alert',className:'pa24-error'},error),h('nav',{className:'pa24-row pa24-tabs'},['work','feishu','workspace','memory','notes','logs'].map(id=>b(t(id),()=>setTab(id),{key:id,'aria-selected':tab===id}))),content,h('p',{className:'pa24-meta'},state.limits)));
        }
        const Icon=()=>h('span',{'aria-hidden':true,style:{fontWeight:700,fontSize:12}},'24');
        ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'pa24-prototype',locale:'pa24'},Panel));
        ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'pa24-prototype',order:24,locale:'pa24',label:()=>t('panel')},Icon));
      }
    };
  }
});
