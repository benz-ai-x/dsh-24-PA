import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {bootHost} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/host.mjs';
import {DEFAULT_CONFIG} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/config.js';
process.env.DSH_BIN='/Users/pc2026/DSH-Space/deepseek-harness/apps/cli/lib/bin.js';process.env.PA24_E2E_STORAGE='sqlite';
const root=await mkdtemp(join(tmpdir(),'pa24-deep2-host-cross-workspace-read-'));const scriptPath=join(root,'script.json');
const mockPath=join(root,'mock.mjs');let mock=await readFile('/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/mock-llm.mjs','utf8');
mock=mock.replace('const script = await readJson(scriptPath, {});','let script = await readJson(scriptPath, {}); while (script.holdWorkers && tools.includes("pa24_work")) { await new Promise(r => setTimeout(r, 50)); script = await readJson(scriptPath, {}); }');
await writeFile(mockPath,mock);const {startMockLlm}=await import(mockPath);
const config={...DEFAULT_CONFIG,mode:'demo',storage:'sqlite'};
for(const name of ['A','B']) {await mkdir(join(root,name));await writeFile(join(root,name,'AGENTS.md'),'# Workspace '+name+'\n\n```json\n'+JSON.stringify(config)+'\n```\n');}
const marker='ONLY_B_PRIVATE_WORK_TITLE_c4f39';
let script={mode:'dispatch',holdWorkers:true,delegate:{worker:'memo',title:marker,instruction:'Read own workspace memory and report.'},workerTool:{name:'pa24_memory',input:{action:'search',query:'fixture'}},workerReply:'B read complete',leadReply:'Read complete'};
const writeScript=()=>writeFile(scriptPath,JSON.stringify(script));await writeScript();
const llm=await startMockLlm({scriptPath,logPath:join(root,'llm.json')});let host;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 host=await bootHost({env:{PA24_WORKSPACE:join(root,'A'),DEEPSEEK_BASE_URL:llm.url,DEEPSEEK_API_KEY:'test-key'}});
 let snap=await host.waitUntil(s=>!!s.workspace?.localSessionId,{label:'A ready'});const localA=snap.workspace.localSessionId;
 await host.api('action',{type:'workspace.bind',path:join(root,'B')});snap=await host.api('snapshot');const localB=snap.workspace.localSessionId;
 const prompt=(sessionId,requestId,text)=>host.remote('session/prompt',{request:{requestId,sessionId,mode:'queue',content:[{type:'text',text}]}});
 await prompt(localB,'create-B','Please begin B work');await host.waitUntil(s=>s.work.some(w=>w.title===marker&&w.status==='running'),{label:'B work running'});
 script={...script,delegate:undefined,leadTool:{name:'pa24_maintenance',input:{action:'archive_check'}}};await writeScript();
 let start=llm.log.length;await prompt(localA,'A-archive-read','Show work that would block archiving my session');
 let leaked;for(let n=0;n<120;n++){leaked=llm.log.slice(start).find(r=>r.tools.includes('pa24_delegate')&&r.toolResults.some(t=>t.includes(marker)));if(leaked)break;await pause(100);}
 assert(leaked,'old workspace A must actually receive B title in its maintenance tool result');
 script={...script,leadTool:{name:'pa24_jobs',input:{action:'list'}}};await writeScript();start=llm.log.length;
 await prompt(localA,'A-jobs-read','List my work through the normal job tool');
 let denied;for(let n=0;n<120;n++){denied=llm.log.slice(start).find(r=>r.toolResults.some(t=>t.includes('事项调度由24私助会话负责')));if(denied)break;await pause(100);}
 assert(denied,'normal jobs route must reject the same old A agent');
 script={...script,holdWorkers:false};await writeScript();const final=await host.waitUntil(s=>s.work.some(w=>w.title===marker&&w.status==='completed'),{label:'B completes after releasing model'});
 const result={commit:'0ef85772a10f45e8e3b4c4d2c85d7249bf28e256',root,hostRoot:host.root,localA,localB,activeWorkspace:final.workspace.path,marker,oldAMaintenanceToolResults:leaked.toolResults,oldAJobsToolResults:denied.toolResults.filter(t=>t.includes('事项调度由24私助会话负责')),bWork:final.work.map(w=>({id:w.id,title:w.title,status:w.status})),controlledAdapter:'Only model SSE was held during B native Worker; all sessions, tool dispatch, permissions, work rows and SQLite reads are actual Loader/Runtime.'};
 await writeFile('/tmp/pa24-deep2-host-cross-workspace-read-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{script={...script,holdWorkers:false};await writeScript();await host?.stop({keepRoot:true});await llm.close();}
