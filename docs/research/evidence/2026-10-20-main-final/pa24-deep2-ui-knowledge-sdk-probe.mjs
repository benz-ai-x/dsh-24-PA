import { writeFile } from 'node:fs/promises';
import sdk from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/node_modules/@larksuiteoapi/node-sdk/lib/index.js';
import { SdkFeishuTransport } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/feishu.js';
import { fixture, delay } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
let dispatcher;
const oldStart=sdk.WSClient.prototype.start, oldClose=sdk.WSClient.prototype.close;
sdk.WSClient.prototype.start=async function({eventDispatcher}) { dispatcher=eventDispatcher; };
sdk.WSClient.prototype.close=function() {};
const events=[], transport=new SdkFeishuTransport('expected-app','stub-secret');
const message={schema:'2.0',header:{event_id:'sdk-msg-evt',event_type:'im.message.receive_v1',app_id:'expected-app',tenant_key:'expected-tenant'},event:{sender:{sender_id:{open_id:'owner'}},message:{message_id:'sdk-msg',chat_id:'chat',chat_type:'p2p',message_type:'text',content:JSON.stringify({text:'/24pa status'})}}};
const card={schema:'2.0',header:{event_id:'sdk-card-evt',event_type:'card.action.trigger',app_id:'expected-app',tenant_key:'expected-tenant'},event:{operator:{open_id:'owner'},action:{value:{pa24:'review',token:'invalid'}},context:{open_message_id:'review-card',open_chat_id:'chat'}}};
const output='/var/folders/8x/zbvzzwh525lfw_ldp529f4lm0000gn/T/pa24-deep2-ui-knowledge-sdk-results.json';
const f=await fixture({env:{PA24_TRANSPORT:'fake',PA24_FEISHU_APP_ID:'expected-app',PA24_FEISHU_APP_SECRET:'stub-secret'}});
try {
 await transport.start(async event=>events.push(event));
 await dispatcher.invoke(message,{needCheck:false});
 await dispatcher.invoke(card,{needCheck:false});
 await dispatcher.invoke(card,{needCheck:false});
 const ws=await f.workspace('a',{mode:'feishu',ownerOpenId:'owner',folderToken:'folder',tasklistId:'list',calendarId:'calendar'}); await f.rt.bind(ws);
 await f.rt.repos.bindings.upsert({appId:'expected-app',tenantKey:'expected-tenant',ownerOpenId:'owner',larkProfile:'default'});
 const identityControls=[];
 for(const foreign of [{label:'wrong-app',app_id:'foreign-app',tenant_key:'expected-tenant'},{label:'wrong-tenant',app_id:'expected-app',tenant_key:'foreign-tenant'}]) {
  const raw={...card,header:{...card.header,event_id:'raw-'+foreign.label,app_id:foreign.app_id,tenant_key:foreign.tenant_key}};
  await dispatcher.invoke(raw,{needCheck:false});
  const direct={...events[1],eventId:'direct-'+foreign.label,appId:foreign.app_id,tenantKey:foreign.tenant_key};
  await f.rt.transport.inject(direct);identityControls.push({label:foreign.label,rawHeader:raw.header,mapped:events.at(-1),directInbox:await f.rt.repos.inbox.get(direct.eventId)});
 }
 for(const event of events) await f.rt.transport.inject(event);
 for(let i=0;i<100;i++){if((await Promise.all(events.map(e=>f.rt.repos.inbox.get(e.eventId)))).every(r=>r.status!=='received'&&r.status!=='processing'))break;await delay(10);}
 const result={sdkVersion:sdk.version??'1.74.0',rawMessageHeader:message.header,rawCardHeader:card.header,identityControls,normalized:events,inbox:await Promise.all(events.map(e=>f.rt.repos.inbox.get(e.eventId))),bindings:await f.rt.repos.bindings.tenantsFor('expected-app','owner'),outbox:await f.rt.repos.outbox.recent(20)};
 await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({output,events,bindings:result.bindings,identityControls:result.identityControls,inbox:result.inbox.map(x=>({event_id:x.event_id,status:x.status,error:x.error})),outbox:result.outbox.map(x=>({key:x.dedup_key,text:x.content.text}))},null,2));
}finally{await transport.close();sdk.WSClient.prototype.start=oldStart;sdk.WSClient.prototype.close=oldClose;await f.cleanup();}
