import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {bootHost} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/host.mjs';
import {startMockLlm} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/mock-llm.mjs';
import {DEFAULT_CONFIG} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/config.js';
process.env.DSH_BIN='/Users/pc2026/DSH-Space/deepseek-harness/apps/cli/lib/bin.js';process.env.PA24_E2E_STORAGE='sqlite';
const root=await mkdtemp(join(tmpdir(),'pa24-deep2-host-result-retry-'));const scriptPath=join(root,'script.json');
const config={...DEFAULT_CONFIG,mode:'demo',storage:'sqlite',maxWorkers:1};
for(const name of ['A','B']) {await mkdir(join(root,name));await writeFile(join(root,name,'AGENTS.md'),'# Controlled fault probe\n\n```json\n'+JSON.stringify(config)+'\n```\n');}
const script={mode:'dispatch',delegate:[{worker:'memo',title:'first finished result',instruction:'Read memory then report completion.'},{worker:'memo',title:'second queued result',instruction:'Read memory then report completion.'}],workerTool:{name:'pa24_memory',input:{action:'search',query:'controlled fixture'}},workerReply:'WORKER_COMPLETED_EXPECTED_RESULT',leadReply:'Both requests admitted.'};
await writeFile(scriptPath,JSON.stringify(script));const llm=await startMockLlm({scriptPath,logPath:join(root,'llm.json')});let host,db;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 host=await bootHost({env:{PA24_WORKSPACE:join(root,'A'),DEEPSEEK_BASE_URL:llm.url,DEEPSEEK_API_KEY:'test-key'}});
 const snap0=await host.waitUntil(s=>!!s.workspace?.localSessionId,{label:'A ready'});const local=snap0.workspace.localSessionId;
 db=new DatabaseSync(join(root,'A','data','pa24.db'));
 // Fault injection is a real SQLite transaction failure at the outbound row,
 // not a fake Runtime/service response. Removed immediately after first failure.
 db.exec("create trigger pa24_probe_fail_result before insert on pa24_outbox when NEW.dedup_key like 'workitem:%:result:%' begin select raise(abort, 'CONTROLLED_RESULT_PERSIST_FAILURE'); end");
 const prompt=async(id,text)=>host.remote('session/prompt',{request:{requestId:id,sessionId:local,mode:'queue',content:[{type:'text',text}]}});
 await prompt('trigger-result','Please do both independent controlled read-only requests.');
 for(let i=0;i<200&&!host.logs().stderr.includes('CONTROLLED_RESULT_PERSIST_FAILURE');i++)await pause(100);
 assert(host.logs().stderr.includes('CONTROLLED_RESULT_PERSIST_FAILURE'),'real result settlement must hit trigger');
 const beforeRecovery=await host.api('snapshot');
 db.exec('drop trigger pa24_probe_fail_result');
 const dbRecoveryAt=new Date().toISOString();
 // More than three normal dispatch/outbox cycles after the DB is healthy.
 await pause(4200);
 const afterRecovery=await host.api('snapshot');
 const first=afterRecovery.work.find(w=>w.title==='first finished result'),second=afterRecovery.work.find(w=>w.title==='second queued result');
 assert(first?.status==='running');assert(second&&['accepted','queued'].includes(second.status));
 let bindError;try{await host.api('action',{type:'workspace.bind',path:join(root,'B')});}catch(e){bindError=e.message;}
 const outboxBeforeStop=afterRecovery.outbox.filter(o=>o.dedup_key.startsWith('workitem:'));
 // Positive control: same live Host+healthy DB finishes the second child after
 // explicit stop of the falsely-running first item frees the only slot.
 await writeFile(scriptPath,JSON.stringify({...script,delegate:undefined,leadTool:{name:'pa24_jobs',input:{action:'stop',workId:first.id}},leadReply:'Explicitly stopped first item.'}));
 await prompt('stop-first','Explicitly stop the first item to free capacity.');
 const final=await host.waitUntil(s=>s.work.find(w=>w.id===second.id)?.status==='completed',{label:'healthy DB completes second'});
 const result={commit:'0ef85772a10f45e8e3b4c4d2c85d7249bf28e256',root,hostRoot:host.root,dbRecoveryAt,controlledFault:'SQLite BEFORE INSERT trigger on workitem result only, removed after one warning',waitAfterRecoveryMs:4200,beforeRecovery:beforeRecovery.work.map(w=>({id:w.id,title:w.title,status:w.status,result:w.result})),afterRecovery:afterRecovery.work.map(w=>({id:w.id,title:w.title,status:w.status,result:w.result})),outboxBeforeStop,bindError,positiveControl:final.work.map(w=>({id:w.id,title:w.title,status:w.status,result:w.result})),warnings:host.logs().stderr.split('\n').filter(line=>line.includes('CONTROLLED_RESULT_PERSIST_FAILURE')),modelCalls:llm.log.map(r=>({tools:r.tools.includes('pa24_work')?'worker':'lead',toolResults:r.toolResults,lastUserText:r.lastUserText}))};
 await writeFile('/tmp/pa24-deep2-host-result-retry-result.json',JSON.stringify(result,null,2));await writeFile(join(root,'host-log.json'),JSON.stringify(host.logs(),null,2));console.log(JSON.stringify(result,null,2));
}finally{db?.close();await host?.stop({keepRoot:true});await llm.close();}
