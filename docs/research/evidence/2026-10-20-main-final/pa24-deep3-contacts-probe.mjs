import assert from 'node:assert/strict';
import {writeFile,readFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import {FakeFeishuTransport} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/feishu.js';
const pkg='/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa';
const results=[];
for(const fillerCount of [0,48,49]){
 const f=await fixture();
 try{
  const state=join(f.root,'lark.json'),bin=join(f.root,'lark-cli');
  await writeFile(state,'{}');
  await writeFile(bin,'#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE='+JSON.stringify(state)+';\nawait import('+JSON.stringify(pkg+'/tests/helpers/stub-lark-cli.mjs')+');\n');
  await chmod(bin,0o755);f.options.larkCliBin=bin;
  await f.rt.bind(await f.workspace('contacts',{mode:'feishu',ownerOpenId:'owner',tasklistId:'list',calendarId:'calendar',folderToken:'folder',maxWorkers:5,enabledWorkers:['tasks','calendar']}));
  f.rt.transport=new FakeFeishuTransport('test');
  const local=f.agents.get(await f.rt.openLocalSession());
  local.session.ownEvents=()=>[{type:'turn/start',data:{turn:1}},{type:'user/message',data:{id:'contacts-request',source:{kind:'user'},content:[{type:'text',text:'联系李雷，需要唯一确定对象'}]}}];
  const record=(id,topic,content)=>({op:'put',reason:'本人提供的隔离测试资料',record:{id,category:'fact',topic,content,source:'本人提供',status:'confirmed',reason:'本人明确记住'}});
  const changes=[record('person-1','联系人：李雷','联系人 李雷：ou_person_one（产品组）'),...Array.from({length:fillerCount},(_,i)=>record('background-'+i,'项目背景 '+i,'与李雷讨论过项目背景 '+i)),record('person-2','联系人：李雷','联系人 李雷：ou_person_two（财务组）')];
  await f.rt.memoryTool({action:'apply',expectedRevision:0,reason:'本人提供两位同名联系人和项目背景',changes},local);
  const page=await f.rt.memoryTool({action:'search',query:'李雷',limit:50},local);
  const all=await f.rt.memoryTool({action:'search',query:'李雷',limit:100},local);
  assert.equal(all.records.filter(r=>r.topic==='联系人：李雷').length,2);
  const tasks={id:(await f.rt.delegate({worker:'tasks',title:'给李雷留言',instruction:'给李雷发送本次测试问候，姓名有歧义应先澄清'},local)).workId};
  const calendar={id:(await f.rt.delegate({worker:'calendar',title:'邀请李雷',instruction:'邀请李雷参加测试会议，姓名有歧义应先澄清'},local)).workId};
  const attempt=async(fn)=>{try{return {ok:true,result:await fn()};}catch(e){return {ok:false,error:e.message};}};
  const send=await attempt(()=>f.rt.work({action:'outreach_send',name:'李雷',content:'隔离测试问候',instruction:'本人要求发给李雷'},tasks));
  const meeting=await attempt(()=>f.rt.work({action:'meeting_schedule',title:'隔离测试会议',start:'2026-11-01T02:00:00Z',end:'2026-11-01T03:00:00Z',attendees:[{name:'李雷'}],instruction:'本人要求邀请李雷'},calendar));
  const calls=await readFile(state+'.calls.jsonl','utf8').then(s=>s.trim().split('\n').filter(Boolean).map(JSON.parse)).catch(()=>[]);
  results.push({fillerCount,matchingRecords:all.matched,firstPageSize:page.records.length,allContacts:all.records.filter(r=>r.topic==='联系人：李雷').map(r=>r.content),send,meeting,calls});
  if(fillerCount<49){assert.equal(send.ok,false);assert.equal(meeting.ok,false);assert.equal(calls.length,0);}
  else {assert.equal(send.ok,true);assert.equal(meeting.ok,true);assert.equal(send.result.target.openId,'ou_person_one');assert.equal(meeting.result.attendees[0].openId,'ou_person_one');}
 }finally{await f.cleanup();}
}
const output={scenario:'Two same-name confirmed contacts; 49 matching background records hide the second contact beyond the resolver first page. Real public Runtime and memory writes, SQLite, isolated CLI stub, no platform network.',results};
await writeFile('/tmp/pa24-deep3-contacts-results.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
