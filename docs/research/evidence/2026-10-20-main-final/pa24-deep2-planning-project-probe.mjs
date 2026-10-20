import { writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { FakeFeishuTransport } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/feishu.js';
import { startPgCluster } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/pg.mjs';
const packageRoot='/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa';
const f=await fixture();
const backend=process.env.PA24_DEEP2_BACKEND==='postgres'?'postgres':'sqlite';
const cluster=backend==='postgres'?await startPgCluster():null;
if(cluster)f.options.env.PA24_DEEP2_PG_DSN=cluster.dsn;
const results={backend};
try {
 const state=join(f.root,'lark.json'), bin=join(f.root,'lark-cli');
 await writeFile(state,'{}');
 await writeFile(bin,'#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE='+JSON.stringify(state)+';\nawait import('+JSON.stringify(packageRoot+'/tests/helpers/stub-lark-cli.mjs')+');\n');
 await chmod(bin,0o755); f.options.larkCliBin=bin;
 await f.rt.bind(await f.workspace('a',{mode:'feishu',ownerOpenId:'owner',tasklistId:'list',calendarId:'calendar',folderToken:'folder',maxWorkers:8,enabledWorkers:['tasks','calendar','digest'],...(cluster?{storage:'postgres',pgDsnEnv:'PA24_DEEP2_PG_DSN'}:{})}));
 f.rt.transport=new FakeFeishuTransport('test');
 const local=f.agents.get(await f.rt.openLocalSession());
 const child={id:(await f.rt.delegate({worker:'tasks',title:'项目实施',instruction:'采纳子任务A和B，失败项沿原操作续办'},local)).workId};
 const project=await f.rt.work({action:'project_create',name:'深查项目'},child);
 const originalSave=f.rt.repos.tasks.save.bind(f.rt.repos.tasks); let failed=false;
 f.rt.repos.tasks.save=async row=>{
  if(!failed && row.summary==='子任务B'){failed=true;throw new Error('injected local projection failure after durable remote receipt');}
  return originalSave(row);
 };
 const first=await f.rt.work({action:'project_adopt',projectId:project.projectId,tasks:[{summary:'子任务A'},{summary:'子任务B'}]},child);
 const before=(await f.rt.db.query('select * from pa24.action_operation order by created_at')).rows;
 const retry=await f.rt.work({action:'project_adopt',projectId:project.projectId,tasks:[{summary:'子任务B'}]},child);
 const remote=(await readFile(state+'.tasks.jsonl','utf8')).trim().split('\n').map(JSON.parse);
 const after=(await f.rt.db.query('select * from pa24.action_operation order by created_at')).rows;
 const progress=await f.rt.work({action:'project_progress',projectId:project.projectId},child);
 results.projectSubsetRetry={first,retry,before,after,remote,progress};
 const dueTask=await f.rt.work({action:'task_create',summary:'清除截止核验',due:'2026-11-01'},child);
 const clearResult=await f.rt.work({action:'task_update',guid:dueTask.guid,due:null},child);
 const readback=await f.rt.work({action:'task_get',guid:dueTask.guid},child);
 const allCalls=(await readFile(state+'.calls.jsonl','utf8')).trim().split('\n').map(JSON.parse);
 results.clearDue={created:dueTask,clearResult,readback,taskUpdateCalls:allCalls.filter(r=>r.args[0]==='task'&&r.args.includes('+update'))};
 local.session.ownEvents=()=>[{type:'turn/start',data:{turn:1}},{type:'user/message',data:{id:'planning-request',source:{kind:'user'},content:[{type:'text',text:'规划明日'}]}}];
 const planning={id:(await f.rt.delegate({worker:'calendar',title:'明日规划',instruction:'规划有忙闲冲突的明日'},local)).workId};
 await writeFile(state+'.events.jsonl',JSON.stringify({event_id:'busy-full',summary:'整天会议',start:'2026-10-20T01:00:00Z',end:'2026-10-20T10:00:00Z',status:'active'})+'\n');
 const preview=await f.rt.work({action:'plan_preview',date:'2026-10-20'},planning);
 results.preview=preview;
} finally {await f.cleanup();await cluster?.stop();}
await writeFile('/tmp/pa24-deep2-planning-project-'+(cluster?'postgres-':'')+'results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
