import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { DigestService } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/digest-service.js';
import { SqliteDb } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/sqlite.js';
import { createRepos } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/repo.js';
import { SkillCatalog } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/skills.js';
const require=createRequire('/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/package.json');
const {renderReminderFraming}=await import(require.resolve('@deepseek-ai/dsh-schedule'));
const root=await mkdtemp(join(tmpdir(),'pa24-final-digest-'));
const db=new SqliteDb(join(root,'ledger.db')); await db.migrate();
const repos=createRepos(db);
const catalog=new SkillCatalog({register:()=>()=>{},list:async()=>[{name:'custom-brief',source:'project-dsh',provider:'filesystem',description:'简报'}],get:async name=>({name,source:'project-dsh',content:'按本次事实生成简报',metadata:{}})});
const now=new Date();
const deps={repos:()=>repos,config:()=>({timeZone:'Asia/Shanghai',calendarId:'cal',notifyChannel:'feishu',ownerOpenId:'owner',tts:{engine:'none'}}),skillCatalog:()=>catalog,accessSessionId:()=>'access',workspace:()=>({statePath:root}),startedAt:()=>now.toISOString(),nativeSchedule:()=>null,memory:()=>null,reviewQueueCount:async()=>0,inspectNoteTrust:async()=>({currentValidity:'matches'}),syncCalendarWindow:async()=>({ok:true}),ownerNotification:async(dedupKey,report)=>({dedupKey,channel:'feishu',target:'owner',kind:'text',content:{text:report}})};
const digest=new DigestService(deps);
try {
await repos.digests.insertPlan({id:'plan',kind:'morning',title:'晨报',schedule_id:'sched',session_id:'access',schedule_spec:{daily:{time:'08:00:00',time_zone:'Asia/Shanghai'}},status:'active',last_window:null,voice:false,skill:'custom-brief'});
const create=async(id,kind)=>{
const item=await repos.workItems.insert({id,title:'周期计划',role:'digest',instruction:'生成简报',origin:'feishu',parent_session_id:'access',child_session_id:id,delivery:'feishu:owner',status:'queued'});
const content=kind==='schedule'?renderReminderFraming({id:'sched',prompt:'周期计划',scheduledAt:now.toISOString()}):'请现在运行一次简报';
await digest.admit(item,{id:'access',ownEvents:()=>[{type:'turn/start',data:{turn:1}},{type:'user/message',data:{id:id+'-message',source:{kind},content:[{type:'text',text:content}]}}]});return item;};
const manual=await create('manual-worker','user');
const first=await digest.digestBuild(manual,{planId:'plan'});
await digest.digestDeliver(manual,{planId:'plan',report:'手动运行结果'});
const scheduled=await create('schedule-worker','schedule');
const second=await digest.digestBuild(scheduled,{planId:'plan'});
const sources=await repos.digests.completedSources('plan');
console.log(JSON.stringify({manual:first,scheduled:second,outbox:(await repos.outbox.recent(20)).map(r=>({key:r.dedup_key,text:r.content.text})),completedSources:sources},null,2));
} finally {await db.close();await rm(root,{recursive:true,force:true});}
