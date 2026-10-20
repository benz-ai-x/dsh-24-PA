import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootHost } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/host.mjs';
import { startMockLlm } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/config.js';
import { DatabaseSync } from 'node:sqlite';
process.env.DSH_BIN='/Users/pc2026/DSH-Space/deepseek-harness/apps/cli/lib/bin.js';
process.env.PA24_E2E_STORAGE='sqlite';
const root = await mkdtemp(join(tmpdir(),'pa24-skill-tools-'));
const workspace=join(root,'workspace'), scriptPath=join(root,'script.json');
let host,llm;
try {
 await mkdir(join(workspace,'.dsh/skills'),{recursive:true});
 await writeFile(join(workspace,'AGENTS.md'),'```json\n'+JSON.stringify({...DEFAULT_CONFIG,storage:'sqlite',mode:'demo',enabledWorkers:['skill'],extraBusinessSkills:['restricted-probe']})+'\n```\n');
 await writeFile(join(workspace,'.dsh/skills/restricted-probe.md'),'---\nname: restricted-probe\ndescription: Restrict probe\nmetadata:\n  track: agent\n  tools:\n    - pa24_work\n---\nDo not use memory. Only pa24_work is declared.\n');
 await writeFile(scriptPath,JSON.stringify({mode:'dispatch',delegate:{worker:'skill',title:'restrict-probe',instruction:'Run restricted-probe',skill:'restricted-probe'},leadReply:'accepted',workerTool:{name:'pa24_memory',input:{action:'search',query:'probe'}},workerReply:'memory-call-finished'}));
 llm=await startMockLlm({scriptPath,logPath:'/tmp/pa24-skill-tools-model-log.json'});
 host=await bootHost({env:{PA24_WORKSPACE:workspace,DEEPSEEK_BASE_URL:llm.url,DEEPSEEK_API_KEY:'test-key',PA24_TRANSPORT:'fake'}});
 const ready=await host.waitUntil(s=>s.workspace?.localSessionId&&s.readiness?.items.some(i=>i.id==='postgres'&&i.state==='ok'),{label:'ready'});
 await host.remote('session/prompt',{request:{requestId:'restrict-probe',sessionId:ready.workspace.localSessionId,mode:'queue',content:[{type:'text',text:'Run restricted-probe'}],clientTimeZone:'Asia/Shanghai'}});
 const final=await host.waitUntil(s=>s.work?.some(w=>w.title==='restrict-probe'&&['completed','failed'].includes(w.status)),{label:'skill complete',timeoutMs:90000});
 const reader=new DatabaseSync(join(workspace,'data/pa24.db'),{readOnly:true});
 const row=reader.prepare("select id,status,skill_definition from pa24_work_item where title='restrict-probe'").get();reader.close();
 const workerRequests=llm.log.filter(r=>r.tools.includes('pa24_work')&&!r.tools.includes('pa24_delegate'));
 const result={work:{...row,skill_definition:JSON.parse(row.skill_definition)},workerRequests:workerRequests.map(({tools,toolResults})=>({tools,toolResults})),hostErrors:host.logs().stderr.slice(-4000)};
 await writeFile('/tmp/pa24-skill-tools-result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
} finally {await host?.stop();await llm?.close();await rm(root,{recursive:true,force:true});}
