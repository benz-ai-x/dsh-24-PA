// THROWAWAY native dsh panel; React and the transport belong to the Host.
window.__ModuleLoader__.load({
  id: '@benz-ai-x/dsh-24pa-prototype',
  factory(require) {
    const React = require('react'), h = React.createElement;
    const zh = {
      panel:'24PA 原型', title:'24PA · 私人助理体验', refresh:'刷新', loading:'连接原型中…', init:'建立真实 A–E 会话',
      assistant:'助理', sessions:'会话', notes:'手写审核', guided:'引导演练', history:'状态记录',
      draft:'输入消息、待办或备忘', send:'发给 dsh 模型', addTask:'创建待办', memo:'保存备忘', remind:'30 秒后提醒',
      taskList:'本次体验的任务', memoList:'本次体验的备忘', reminderList:'本次体验的提醒', complete:'完成', cancel:'取消',
      empty:'暂无内容', switch:'切换', peek:'查看', stop:'停止当前工作', back:'返回上一个会话', working:'执行中', idle:'空闲',
      active:'当前会话', profile:'固定飞书身份', status:'连接状态', memory:'业务体验状态仅在内存中。重启会清空；原生 dsh 日志与已创建的飞书对象保留。',
      choose:'选择单页原图', recognize:'通过 dsh 视觉模型识别', sample:'加载示例稿（不调用识别）',
      pending:'待人工审核', approved:'本人已审核本版', rejected:'已退回修改', unknown:'内容尚未核验',
      approve:'本人批准本版', reject:'退回修改', check:'核验飞书当前内容', revise:'保存为新版本',
      taskTitle:'单独授权的任务内容', execute:'单独授权创建此任务', noAuto:'审核内容不会自动创建任务。',
      original:'原稿信息', open:'打开飞书对象', snapshot:'当前完整体验状态', audit:'最近变化',
      reset:'开始此情景（清空内存演练数据）', guideOnly:'引导演练使用演示数据，仅在 demo 模式开放；真实操作请使用其他页签。',
      next:'下一步', peekResult:'查看结果（未切换当前会话）', pendingJob:'模型工作',
    };
    const en = { ...zh, panel:'24PA Prototype', title:'24PA · Assistant Prototype', refresh:'Refresh', loading:'Connecting…', assistant:'Assistant', sessions:'Sessions', notes:'Note review', guided:'Walkthroughs', history:'State', active:'Current session', profile:'Fixed Feishu identity', status:'Connection', empty:'No items', open:'Open in Feishu' };
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
      inject: ['slots','locale','layout','connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('pa24', { zh, en }));
        const t = ctx.locale.bind('pa24');
        const rpc = async (name, payload = {}) => {
          const response = await fetch('./api/24pa-prototype', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({endpoint:name,payload}) });
          if (!response.ok) throw new Error(`dsh 连接未就绪 (${response.status})`);
          const result = await response.json();
          if (!result.ok) throw new Error(result.error.message); return result.value;
        };
        function Panel() {
          const [state, setState] = React.useState(null), [error, setError] = React.useState('');
          const [tab, setTab] = React.useState('assistant'), [draft, setDraft] = React.useState('');
          const [peek, setPeek] = React.useState(null), [file, setFile] = React.useState(null);
          const [selected, setSelected] = React.useState(''), [edit, setEdit] = React.useState(''), [taskTitle,setTaskTitle] = React.useState('');
          const [busy,setBusy] = React.useState(false), [scenario,setScenario] = React.useState('route'), [step,setStep] = React.useState(-1);
          const stamp = React.useRef(null);
          const refresh = async () => { const next = await rpc('snapshot'); setState(next); return next; };
          React.useEffect(() => {
            let live = true;
            const load = () => { void rpc('snapshot').then(s => { if(live) setState(s); }).catch(e => { if(live) setError(e.message); }); };
            load(); const interval = setInterval(load, 2000);
            return () => { live = false; clearInterval(interval); };
          }, []);
          const run = async action => {
            setBusy(true); setError('');
            try { const next = await rpc('action', action); setState(next); return next; }
            catch (e) { setError(e.message); await refresh(); throw e; }
            finally { setBusy(false); }
          };
          const b = (label, fn, extra = {}) => h('button', { type:'button', disabled:busy, onClick:() => { void Promise.resolve().then(fn).catch(e => setError(e.message)); }, ...extra }, label);
          const card = (title, ...children) => h('section', {className:'pa24-card'}, h('h2', null,title), ...children);
          const link = ext => ext?.url ? h('a', {href:ext.url,target:'_blank',rel:'noreferrer'},t('open')) : null;
          const rows = (items, render) => items.length ? items.map(render) : h('p',{className:'pa24-meta'},t('empty'));
          const act = type => run({type,text:draft,title:draft,seconds:30,session:state.active});
          const n = state?.notes.find(x => x.id === selected) || state?.notes.at(-1);
          React.useEffect(() => { if(n) setEdit(n.text); }, [n?.id,n?.version]);
          const scenes = {
            route:{title:'A 工作，切到 B',description:'A 的后台结果和旧消息不应抢走当前 B。',steps:['切到 A','切到 B','送达 A 的演练结果','仅查看 A，保持 B']},
            review:{title:'审核后又修改',description:'批准仅覆盖一个版本，修改后应重新审核。',steps:['载入示例 v1','本人批准 v1','修订成 v2','点击旧 v1 批准按钮（应拒绝）']},
            authority:{title:'审核与行动分开',description:'没有人工审核或单独授权时，不能创建行动任务。',steps:['载入示例稿','未审核就执行（应拒绝）','本人批准本版','单独授权创建演示任务']},
            reminder:{title:'提醒不切会话',description:'提醒属于设置时的会话；发送后也不推断已经读过。',steps:['切到 A','设置 5 秒提醒','切到 B，等待提醒']},
          };
          const guide = async () => {
            const latest = await refresh(); const current = latest.notes.at(-1);
            let next;
            if(scenario==='route') {
              if(step===0) next=await run({type:'session.switch',session:'A'});
              if(step===1) next=await run({type:'session.switch',session:'B'});
              if(step===2) next=await run({type:'demo.background'});
              if(step===3) setPeek(latest.sessions.find(s=>s.key==='A'));
            } else if(scenario==='review' || scenario==='authority') {
              if(step===0) { next=await run({type:'note.sample'}); const note=next.notes.at(-1); stamp.current={id:note.id,version:note.version,hash:note.hash}; setSelected(note.id); }
              else if(scenario==='review' && step===1 || scenario==='authority' && step===2) next=await run({type:'note.approve',id:current.id,version:current.version,hash:current.hash});
              else if(scenario==='review' && step===2) next=await run({type:'note.revise',id:current.id,text:current.text+'\n本人修订：截止日期改为下周二。'});
              else if(scenario==='review' && step===3) { try { await run({type:'note.approve',...stamp.current}); } catch(e) { setError('预期结果：'+e.message); } }
              else if(scenario==='authority' && step===1) { try { await run({type:'note.action',id:current.id,hash:current.hash,title:'确认预算',authorized:true}); } catch(e) {setError('预期结果：'+e.message);} }
              else if(scenario==='authority' && step===3) next=await run({type:'note.action',id:current.id,hash:current.hash,title:'确认预算（演示任务）',authorized:true});
            } else {
              if(step===0) next=await run({type:'session.switch',session:'A'});
              if(step===1) next=await run({type:'reminder.add',seconds:5,text:'演练：A 的会议准备提醒'});
              if(step===2) next=await run({type:'session.switch',session:'B'});
            }
            setStep(step+1); if(next)setState(next);
          };
          let content;
          if(!state) content=h('p',null,t('loading'));
          else if(tab==='assistant') content=h('div',{className:'pa24-grid'},
            card(t('assistant'),h('textarea',{value:draft,placeholder:t('draft'),onChange:e=>setDraft(e.target.value)}),
              h('div',{className:'pa24-row'},b(t('send'),()=>act('session.prompt')),b(t('addTask'),()=>act('task.add')),b(t('memo'),()=>act('memo.add')),b(t('remind'),()=>act('reminder.add'))),
              h('div',null,rows(state.sessions.find(s=>s.key===state.active).messages.slice(-8), (m,i)=>h('div',{key:i,className:'pa24-item'},h('b',null,m.role==='user'?'本人':'24PA'),h('div',{className:'pa24-note'},m.text))))),
            h('div',null,card(t('taskList'),rows(state.tasks, task=>h('div',{key:task.id,className:'pa24-item'},h('span',null,`${task.done?'✓':'○'} ${task.title} `),link(task.external),!task.done&&b(t('complete'),()=>run({type:'task.complete',id:task.id}))))),
              card(t('memoList'),rows(state.memos,m=>h('div',{key:m.id,className:'pa24-item'},h('div',{className:'pa24-note'},m.text),link(m.external)))),
              card(t('reminderList'),rows(state.reminders,r=>h('div',{key:r.id,className:'pa24-item'},`${r.session} · ${r.text} · ${new Date(r.at).toLocaleTimeString()} · ${r.status} `,r.status==='pending'&&b(t('cancel'),()=>run({type:'reminder.cancel',id:r.id})))))));
          else if(tab==='sessions') content=h('div',null,h('div',{className:'pa24-row'},b(t('init'),()=>run({type:'sessions.init'})),b(t('back'),()=>run({type:'session.back'}))),
            h('div',{className:'pa24-grid',style:{marginTop:14}},state.sessions.map(s=>card(`${s.key} · ${s.title}${s.key===state.active?' ●':''}`,
              h('p',null,s.running?t('working'):t('idle')),h('p',{className:'pa24-meta'},s.realId||'尚未创建原生会话'),h('div',{className:'pa24-row'},
                b(t('switch'),()=>run({type:'session.switch',session:s.key})),b(t('peek'),async()=>{setPeek(await rpc('peek',{session:s.key}));}),b(t('stop'),()=>run({type:'session.cancel',session:s.key})))))),
            peek&&card(t('peekResult'),h('p',null,peek.key),rows(peek.messages,(m,i)=>h('div',{key:i,className:'pa24-note'},m.text))));
          else if(tab==='notes') content=h('div',null,
            card(t('choose'),h('input',{type:'file',accept:'image/png,image/jpeg,image/webp',onChange:e=>{
              const f=e.target.files?.[0]; if(!f)return; if(f.size>10485760){setError('图片超过 10 MiB 原型上限。');return;}
              const reader=new FileReader();reader.onload=()=>setFile({name:f.name,data:String(reader.result).split(',')[1],preview:reader.result});reader.readAsDataURL(f);
            }}),file&&h('figure',null,h('img',{src:file.preview,alt:file.name})),h('div',{className:'pa24-row'},b(t('recognize'),()=>run({type:'image.recognize',...file,session:state.active}),{disabled:busy||!file}),state.mode==='demo'&&b(t('sample'),async()=>{const s=await run({type:'note.sample'});setSelected(s.notes.at(-1).id);}))),
            h('div',{className:'pa24-row'},state.notes.map(note=>b(`${note.id} v${note.version} · ${t(note.status)}`,()=>setSelected(note.id),{key:note.id,className:note.id===n?.id?'selected':''}))),
            n&&card(`${n.id} · v${n.version} · ${t(n.status)}`,h('p',null,t('noAuto')),link(n.external),h('p',{className:'pa24-meta'},`内容指纹 ${n.hash} · 来源会话 ${n.session}`),
              n.original&&h('p',{className:'pa24-meta'},`${t('original')}：${n.original.mediaType} · ${n.original.bytes} bytes · SHA256 ${n.original.sha256}`),
              h('textarea',{className:'note-edit',value:edit,onChange:e=>setEdit(e.target.value)}),h('div',{className:'pa24-row'},
                b(t('approve'),()=>run({type:'note.approve',id:n.id,version:n.version,hash:n.hash}),{disabled:busy||edit!==n.text}),b(t('reject'),()=>run({type:'note.reject',id:n.id,version:n.version,hash:n.hash})),
                b(t('check'),()=>run({type:'note.check',id:n.id})),b(t('revise'),()=>run({type:'note.revise',id:n.id,text:edit,session:n.session}))),
              h('p',{className:'pa24-meta'},'编辑框改动要先保存为新版本，审核按钮只对应上方版本号。'),
              n.review&&h('p',{className:'pa24-meta'},`最近审核凭证：v${n.review.version} · ${n.review.decision} · ${n.review.at}`),
              h('input',{value:taskTitle,placeholder:t('taskTitle'),onChange:e=>setTaskTitle(e.target.value)}),
              b(t('execute'),()=>run({type:'note.action',id:n.id,hash:n.hash,title:taskTitle,authorized:true}),{disabled:busy||n.status!=='approved'||!taskTitle.trim()})));
          else if(tab==='guided') content=h('div',null,h('p',null,t('guideOnly')),h('div',{className:'pa24-row'},Object.entries(scenes).map(([id,scene])=>b(scene.title,()=>{setScenario(id);setStep(-1);},{key:id,'aria-selected':id===scenario}))),
            card(scenes[scenario].title,h('p',null,scenes[scenario].description),b(t('reset'),async()=>{await run({type:'demo.reset'});stamp.current=null;setPeek(null);setStep(0);},{disabled:busy||state.mode!=='demo'}),
              h('ol',null,scenes[scenario].steps.map((label,i)=>h('li',{key:i},b(`${i+1}. ${label}`,guide,{disabled:busy||step!==i||state.mode!=='demo'}),step>i?' ✓':''))),
              h('p',null,`${t('active')}: ${state.active}`),h('p',null,state.lastChange),
              rows(state.notes,note=>h('p',{key:note.id},`${note.id} v${note.version} · ${t(note.status)} · 任务已创建 ${note.actionsCreated?'是':'否'}`)),
              peek&&h('div',{className:'pa24-note'},`${t('peekResult')}: ${peek.key}\n${peek.messages.map(m=>m.text).join('\n')}`)));
          else content=h('div',null,card(t('audit'),rows(state.audit.slice(-15).reverse(),(a,i)=>h('div',{key:i,className:'pa24-item'},`${a.at} · ${a.type}`,h('p',null,a.message)))),card(t('snapshot'),h('pre',null,JSON.stringify(state,null,2))));
          return h('main',{className:'pa24'},h('style',null,style),h('div',{className:'pa24-wrap'},h('h1',null,t('title')),h('p',null,state?.question),
            h('p',{className:'pa24-meta'},t('memory')),state&&h('div',{className:'pa24-card'},h('div',{className:'pa24-row'},h('strong',null,`${t('active')}: ${state.active}`),h('span',null,`${t('profile')}: ${state.profile}`),b(t('refresh'),refresh)),
              h('p',null,`${t('status')}: ${state.connection}`),h('p',null,state.lastChange),state.jobs.length>0&&h('p',null,`${t('pendingJob')}: ${state.jobs.map(j=>`${j.session}/${j.kind}`).join(', ')}`)),
            error&&h('div',{role:'alert',className:'pa24-error'},error),h('nav',{className:'pa24-row pa24-tabs'},['assistant','sessions','notes','guided','history'].map(id=>b(t(id),()=>setTab(id),{key:id,'aria-selected':tab===id}))),content));
        }
        function Icon() { return h('span',{'aria-hidden':true,style:{fontWeight:700,fontSize:12}},'24'); }
        ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'pa24-prototype',locale:'pa24'},Panel));
        ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'pa24-prototype',order:24,locale:'pa24',label:()=>t('panel')},Icon));
      },
    };
  },
});
