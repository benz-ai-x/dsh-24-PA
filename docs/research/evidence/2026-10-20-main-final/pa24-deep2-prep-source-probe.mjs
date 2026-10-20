import { writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { FakeFeishuTransport } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/feishu.js';
const pkg='/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa';
const require=createRequire(pkg+'/package.json');
const {createAtScheduleRecord, ScheduleId, renderReminderFraming}=await import(require.resolve('@deepseek-ai/dsh-schedule'));
const f=await fixture(); let result;
try {
 const entries=[];
 const schedule={create:async(sessionId,request)=>{
  const row=createAtScheduleRecord(ScheduleId('native-'+(entries.length+1)),request.prompt,request.at,Date.now(),request.title);
  entries.push({...row,sessionId,status:'active'});return row;
 },delete:async()=>({deleted:true}),catalog:async()=>structuredClone(entries),history:async()=>({records:[]})};
 f.ctx.get=name=>name==='schedule'?schedule:null;
 const state=join(f.root,'lark.json'),bin=join(f.root,'lark-cli');
 await writeFile(state,'{}');await writeFile(bin,'#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE='+JSON.stringify(state)+';\nawait import('+JSON.stringify(pkg+'/tests/helpers/stub-lark-cli.mjs')+');\n');await chmod(bin,0o755);f.options.larkCliBin=bin;
 await f.rt.bind(await f.workspace('a',{mode:'feishu',ownerOpenId:'owner',tasklistId:'list',calendarId:'cal',folderToken:'folder',enabledWorkers:['calendar'],maxWorkers:8}));
 f.rt.transport=new FakeFeishuTransport('test');
 const local=f.agents.get(await f.rt.openLocalSession());
 const setup={id:(await f.rt.delegate({worker:'calendar',title:'创建两场会议',instruction:'分别安排会议A和B及其会前准备'},local)).workId};
 const plans=[];
 for(const [i,label] of ['A','B'].entries()){
  const start=new Date(Date.now()+(i?2*86400000:3600000)),end=new Date(start.getTime()+3600000);
  const e=await f.rt.work({action:'calendar_create',summary:'会议'+label,start:start.toISOString(),end:end.toISOString()},setup);
  plans.push(await f.rt.work({action:'meeting_prep_enable',eventId:e.eventId,leadMinutes:15,scopeMemo:false,scopeMemory:false,scopeTasks:false,scopeMinutes:false},setup));
 }
 const pA=await f.rt.repos.digests.getPlan(plans[0].planId),pB=await f.rt.repos.digests.getPlan(plans[1].planId);
 const nativeA=entries.find(e=>e.id===pA.schedule_id);
 const access=f.agents.get(pA.session_id);
 access.session.ownEvents=()=>[{type:'turn/start',data:{turn:1}},{type:'user/message',data:{id:'native-delivery-A',source:{kind:'schedule'},content:[{type:'text',text:renderReminderFraming(nativeA)}]}}];
 const worker={id:(await f.rt.delegate({worker:'calendar',title:'处理A的会前准备',instruction:'执行本次计划A的会前准备'},access)).workId};
 const captured=await f.rt.repos.digests.workSource(worker.id);
 const built=await f.rt.work({action:'meeting_prep_build',planId:pB.id},worker);
 const outbox=await f.rt.repos.outbox.recent();
 result={plans:[pA,pB],captured,built,boundRun:await f.rt.repos.digests.runForWorkItem(pB.id,worker.id),outbox,completedSourcesForB:await f.rt.repos.digests.completedSources(pB.id)};
}finally{await f.cleanup();}
await writeFile('/tmp/pa24-deep2-prep-source-results.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
