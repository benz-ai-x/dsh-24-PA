import { writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { FakeFeishuTransport } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/feishu.js';
const packageRoot='/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa';
const results=[];
for(const kind of ['task','calendar']) {
 const f=await fixture();
 try {
  for(const [name,variable] of [['lark','PA24_LARK_STUB_STATE'],['wecom','PA24_WECOM_STUB_STATE']]) {
   const state=join(f.root,name+'.json'),bin=join(f.root,name+'-cli'); await writeFile(state,'{}'); await writeFile(bin,'#!/usr/bin/env node\nprocess.env.'+variable+'='+JSON.stringify(state)+';\nawait import('+JSON.stringify(packageRoot+'/tests/helpers/stub-'+name+'-cli.mjs')+');\n'); await chmod(bin,0o755); f.options[name+'CliBin']=bin;
  }
  const workspace=await f.workspace('a',{mode:'feishu',ownerOpenId:'owner',tasklistId:'list',calendarId:'calendar',folderToken:'folder',maxWorkers:8,enabledWorkers:['memo','calendar','handwriting','tasks']});
  await f.rt.bind(workspace); f.rt.transport=new FakeFeishuTransport('test'); const local=f.agents.get(await f.rt.openLocalSession());
  const worker={id:(await f.rt.delegate({worker:'memo',title:'会议整理',instruction:'整理会议记录'},local)).workId};
  const candidate={summary:'安排评审',sourceQuote:'安排评审',...(kind==='calendar'?{start:'2026-11-01T02:00:00Z',end:'2026-11-01T03:00:00Z'}:{due:'2026-11-01'})};
  const minutes=await f.rt.work({action:'minutes_build',topic:'评审',content:'主人提供记录',candidates:[candidate]},worker);
  const action={action:'minutes_adopt_actions',minutesId:minutes.minutesId,indexes:[0],instruction:'执行第0项'};
  const repo=kind==='task'?f.rt.repos.tasks:f.rt.repos.calendar, method=kind==='task'?'save':'upsertEvent', original=repo[method].bind(repo); let fail=true;
  repo[method]=async(...args)=>{if(fail){fail=false;throw new Error('injected local projection failure')}return original(...args)};
  const first=await f.rt.work(action,worker), before=await f.rt.repos.operations.get('minutes.action:'+minutes.minutesId+':0');
  await f.rt.updateWorkspaceConfig({[kind==='task'?'todoChannel':'calendarChannel']:'wecom'});
  const retry=await f.rt.work(action,worker),after=await f.rt.repos.operations.get('minutes.action:'+minutes.minutesId+':0');
  const tasks=await f.rt.repos.tasks.list(), events=kind==='calendar'?await f.rt.repos.calendar.eventsIn('wecom',new Date('2026-10-31'),new Date('2026-11-02')):[];
  const remoteFeishu=await readFile(join(f.root,'lark.json.'+(kind==='task'?'tasks':'events')+'.jsonl'),'utf8').catch(()=>''), remoteWecom=await readFile(join(f.root,'wecom.json'),'utf8');
  results.push({kind,configChangeVia:'public updateWorkspaceConfig',first,before,retry,after,tasks,events,remoteFeishu,remoteWecom});
 }finally{await f.cleanup()}
}
const output=join(tmpdir(),'pa24-minutes-recovery-results.json'); await writeFile(output,JSON.stringify(results,null,2));console.log(JSON.stringify({output,results:results.map(({kind,first,retry,tasks,events})=>({kind,first,retry,tasks,events}))},null,2));
