// Isolated, synthetic data for the shared browser review. Run from packages/24pa.
// It installs this built package into a temporary dsh profile; no production account.
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootHost } from '../tests/helpers/host.mjs';
import { DEFAULT_CONFIG } from '../lib/config.js';
import { SqliteDb } from '../lib/sqlite.js';
process.env.PA24_E2E_STORAGE = 'sqlite';
const root = await mkdtemp(join(tmpdir(), 'pa24-m05-ui-')), workspace = join(root,'workspace'), bin = join(root,'bin');
await mkdir(workspace); await mkdir(bin);
const owner = 'ou_ui_fixture', state = join(root,'lark.json');
await writeFile(state,JSON.stringify({ ownerOpenId:owner }));
await writeFile(join(bin,'lark-cli'), `#!${process.execPath}\nawait import(${JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs'))});\n`); await chmod(join(bin,'lark-cli'),0o755);
await writeFile(join(workspace,'AGENTS.md'),'# 24私助隔离样例工作区\n\n```json\n'+JSON.stringify({...DEFAULT_CONFIG, storage:'sqlite', mode:'feishu', ownerOpenId:owner, folderToken:'fixture-folder',tasklistId:'fixture-list',calendarId:'primary',appIdEnv:'PA24_UI_APP',appSecretEnv:'PA24_UI_SECRET'},null,2)+'\n```\n');
let host, db;
const cleanup = async () => { await db?.close(); await host?.stop(); await rm(root,{recursive:true,force:true}); };
try {
  host=await bootHost({env:{PA24_WORKSPACE:workspace,PA24_TRANSPORT:'fake',PA24_UI_APP:'fixture-app',PA24_UI_SECRET:'fixture-secret',PA24_LARK_STUB_STATE:state,PATH:bin+':'+process.env.PATH}});
  const snapshot=await host.waitUntil(s=>s.workspace&&s.transport?.connected,{label:'资料 UI 样例就绪'}), binding=snapshot.workspaceBinding;
  const api=(endpoint,payload={})=>host.api(endpoint,{workspaceBinding:binding,...payload});
  const change=(noteId,action,payload={})=>api('action',{type:'material.change',noteId,action,requestId:crypto.randomUUID(),instruction:'隔离样例的明确操作授权',...payload});
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
  for(let i=1;i<=22;i++) await api('action',{type:'test.inject',event:{eventId:`ui-image-${i}`,messageId:`ui-image-${i}`,appId:'fixture-app',senderOpenId:owner,chatType:'p2p',messageType:'image',imageKey:`ui-image-${i}`,imageData:image}});
  for(let i=0;i<100;i++){ const list=await api('materials',{limit:100}); if(list.items.length===22&&list.items.every(row=>row.pages===1))break; await new Promise(resolve=>setTimeout(resolve,100)); }
  let first=await api('materials',{kind:'detail',noteId:'N-1'});
  const draft={...first.material.draft,title:'项目预算｜隔离样例',transcript:'王工负责核对预算数字。\n会议讨论尚有一个日期需要确认。',summary:'项目预算讨论',unknowns:['第二行日期需核对'],candidates:[{summary:'准备预算资料',sourceQuote:'王工负责核对预算数字',due:'2026-11-02'}]};
  let saved=await change('N-1','save_draft',{expectedRevision:0,draft});
  await change('N-1','publish_draft',{expectedRevision:saved.revision});
  first=await api('materials',{kind:'detail',noteId:'N-1'});
  await change('N-1','save_draft',{expectedRevision:first.material.revision,draft:{...first.material.draft,transcript:draft.transcript+'\n主人补充：预算按 12 万元准备。',candidates:[{...first.material.draft.candidates[0],summary:'准备修订预算资料'}]}});
  const second=await api('materials',{kind:'detail',noteId:'N-2'});
  saved=await change('N-2','save_draft',{expectedRevision:0,draft:{...second.material.draft,title:'已审行动｜隔离样例',transcript:'本人核对后准备资料。',candidates:[{summary:'准备隔离验收资料',sourceQuote:'本人核对后准备资料'}]}});
  const published=await change('N-2','publish_draft',{expectedRevision:saved.revision});
  db=new SqliteDb(join(workspace,'data','pa24.db'));
  const token=(await db.query("select token from pa24.review_token where version_id=$1 and action='approve'",[published.versionId])).rows[0].token;
  await api('action',{type:'test.inject',event:{eventId:'ui-approve',appId:'fixture-app',senderOpenId:owner,chatType:'p2p',kind:'card',cardAction:{value:{pa24:'review',token}}}});
  await db.close(); db=null;
  console.log(JSON.stringify({url:host.url,root,workspace,binding,noteIds:['N-1','N-2'],fixture:'synthetic originals, CLI and Feishu transport; no actual QwenNote access'}));
  if(!process.argv.includes('--smoke')) await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
} finally { await cleanup(); }
