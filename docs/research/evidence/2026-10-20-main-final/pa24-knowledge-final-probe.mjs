import { writeFile, readFile, appendFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { FakeFeishuTransport } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/feishu.js';
import { sha256Hex } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/handwriting.js';
import { workToolProperties } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/work-tool-schema.js';
import Ajv from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/node_modules/ajv/dist/ajv.js';
const packageRoot = '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa';
const validate = new Ajv({strict:false}).compile({type:'object', required:['action'], properties:workToolProperties,additionalProperties:false});
const findings = [];
async function runSample(name, input, beforeFetchEdit) {
 const f = await fixture();
 try {
  const state = join(f.root,'lark.json'), bin = join(f.root,'lark-cli');
  await writeFile(state,JSON.stringify(beforeFetchEdit ? {probeEdit:beforeFetchEdit}:{}));
  const wrapper = `#!/usr/bin/env node
import {readFile, writeFile, appendFile} from 'node:fs/promises';
process.env.PA24_LARK_STUB_STATE=${JSON.stringify(state)};
const args=process.argv.slice(2), statePath=${JSON.stringify(state)};
if(args.includes('+fetch')) {
 const state=JSON.parse(await readFile(statePath,'utf8'));
 if(state.probeEdit) {
  const path=statePath+'.docs.jsonl'; const docs=(await readFile(path,'utf8')).trim().split('\\n').map(JSON.parse);
  const id=args[args.indexOf('--doc')+1]; const doc=docs.findLast(row=>row.id===id);
  if(doc) { const edited={...doc,content:doc.content.replaceAll(state.probeEdit.from,state.probeEdit.to),revision:doc.revision+1}; await appendFile(path,JSON.stringify(edited)+'\\n'); delete state.probeEdit; await writeFile(statePath,JSON.stringify(state)); }
 }
}
await import(${JSON.stringify(packageRoot+'/tests/helpers/stub-lark-cli.mjs')});
`;
  await writeFile(bin,wrapper); await chmod(bin,0o755); f.options.larkCliBin=bin;
  f.ctx.get=name=>name==='attachments'?{admitPromptContent:async blocks=>blocks}:null;
  const workspace=await f.workspace('a',{mode:'feishu',ownerOpenId:'owner',tasklistId:'list',calendarId:'calendar',folderToken:'folder',maxWorkers:8,enabledWorkers:['memo','calendar','handwriting','tasks'],workerModels:{handwriting:{provider:'test',model:'vision-test'}}});
  await f.rt.bind(workspace); f.rt.transport=new FakeFeishuTransport('test'); const local=f.agents.get(await f.rt.openLocalSession());
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]), image=join(f.root,'original.png'); await writeFile(image,bytes);
  await f.rt.repos.notes.insertNote({id:'N-1',title:'记录',origin:'feishu'});
  await f.rt.repos.notes.insertPage({note_id:'N-1',page_no:1,message_id:'image',image_key:'image',media_type:'image/png',byte_size:bytes.length,sha256:sha256Hex(bytes),storage_path:image,source_type:'image',quality:null,status:'saved'});
  const worker={id:(await f.rt.delegate({worker:'handwriting',noteId:'N-1',title:'整理',instruction:'整理原稿'},local)).workId};
  const submit={action:'note_submit',...input}; if(!validate(submit)) throw new Error(JSON.stringify(validate.errors));
  const published=await f.rt.work(submit,worker);
  const version=await f.rt.repos.notes.getVersion(published.versionId);
  const token=(await f.rt.repos.notes.tokensOf(published.versionId)).find(row=>row.action==='approve').token;
  await f.rt.handwriting.processReviewCard('approval',{senderOpenId:'owner',cardAction:{value:{pa24:'review',token}}});
  const trust=await f.rt.handwriting.inspectTrust('N-1',published.versionId);
  const adopted=await f.rt.work({action:'note_adopt_actions',noteId:'N-1',versionId:published.versionId,indexes:[0],instruction:'执行所选候选行动'},worker);
  findings.push({name,toolSchemaAcceptsInput:true,submit,docSnapshot:version.doc_snapshot,persistedCandidates:version.content.candidates,persistedDoubts:version.content.doubts,persistedUnknowns:version.content.unknowns,trust:{status:trust.version.status,currentValidity:trust.currentValidity},adopted,tasks:(await f.rt.repos.tasks.list()).map(row=>({summary:row.summary,dueAt:row.due_at})),actionOperation:await f.rt.repos.operations.get('note.action:N-1:v1:0')});
 } finally { await f.cleanup(); }
}
await runSample('initial-publication-edit-before-first-readback',{transcript:'联系王工',summary:'联系王工',candidates:[{summary:'联系王工',sourceQuote:'联系王工'}]},{from:'联系王工',to:'联系李工'});
await runSample('doubts-only-critical-name',{transcript:'联系王或李，原稿不清',summary:'联系负责人',doubts:[{pageNo:1,kind:'name',quote:'联系王或李',note:'候选0联系人的姓氏不清，须确认是王工还是李工'}],candidates:[{summary:'联系王工',sourceQuote:'联系王或李'}]});
await runSample('partial-time-block',{transcript:'11月1日上午安排评审，结束时间待定',summary:'安排评审',candidates:[{summary:'安排评审',sourceQuote:'11月1日上午安排评审',start:'2026-11-01T02:00:00Z'}]});
const output=join(tmpdir(),'pa24-knowledge-final-results.json'); await writeFile(output,JSON.stringify(findings,null,2)); console.log(JSON.stringify({output,findings:findings.map(({name,toolSchemaAcceptsInput,trust,adopted,tasks})=>({name,toolSchemaAcceptsInput,trust,adopted,tasks}))},null,2));
