import {writeFile} from 'node:fs/promises';
import {fixture,delay} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
const f=await fixture({env:{PA24_TRANSPORT:'fake',PA24_FEISHU_APP_ID:'app',PA24_FEISHU_APP_SECRET:'stub-secret'}});
const sharp=(await import('/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/node_modules/sharp/dist/index.mjs')).default;
const output='/var/folders/8x/zbvzzwh525lfw_ldp529f4lm0000gn/T/pa24-deep2-ui-knowledge-collection-results.json';
const event={eventId:'original-event',appId:'app',tenantKey:'tenant',kind:'message',senderOpenId:'owner',chatType:'p2p',chatId:'chat',messageId:'original-message',messageType:'image',imageKey:'image-key'};
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQcEj4DwADBAHAgChw2gAAAABJRU5ErkJggg==';
const imageDecoded=await sharp(Buffer.from(image,'base64')).raw().toBuffer({resolveWithObject:true});
async function settle(rt,id){for(let i=0;i<100;i++){const row=await rt.repos.inbox.get(id);if(row&&!['received','processing'].includes(row.status))return;await delay(10);}throw new Error('inbox did not settle');}
async function snap(rt){const notes=await rt.repos.notes.listNotes();return {inbox:await rt.repos.inbox.get(event.eventId),notes,pages:await Promise.all(notes.map(n=>rt.repos.notes.pagesOf(n.id))),ackOutbox:(await rt.repos.outbox.recent(50)).filter(r=>r.dedup_key.startsWith('noteack:')),modelPrompts:f.prompts.length};}
try{
 const ws=await f.workspace('a',{mode:'feishu',ownerOpenId:'owner',folderToken:'folder',tasklistId:'list',calendarId:'calendar'});await f.rt.bind(ws);
 const enqueue=f.rt.repos.outbox.enqueue.bind(f.rt.repos.outbox);let fail=true;
 f.rt.repos.outbox.enqueue=async row=>{if(fail&&row.dedupKey.startsWith('noteack:')){fail=false;throw new Error('injected one-shot ack ledger write failure');}return enqueue(row);};
 await f.rt.transport.inject(event,image);await settle(f.rt,event.eventId);const afterFault=await snap(f.rt);
 await f.rt.transport.inject(event,image);await delay(30);const afterRedelivery=await snap(f.rt);
 await f.rt.stop();const restarted=f.make();await restarted.bind(ws);await restarted.transport.inject(event,image);await delay(30);const afterRestartRedelivery=await snap(restarted);
 await restarted.transport.inject({...event,eventId:'new-event-same-message'},image);await settle(restarted,'new-event-same-message');const afterDifferentEventSameMessage=await snap(restarted);
 const result={imageDecoded:{...imageDecoded.info,pixels:[...imageDecoded.data]},injection:'Only first Outbox.enqueue(noteack) throws after original page is durably saved',afterFault,afterRedelivery,afterRestartRedelivery,afterDifferentEventSameMessage};await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({output,...Object.fromEntries(Object.entries(result).filter(([k])=>!['injection','imageDecoded'].includes(k)).map(([k,v])=>[k,{inbox:v.inbox.status,error:v.inbox.error,notes:v.notes.length,pages:v.pages.flat().length,acks:v.ackOutbox.length,prompts:v.modelPrompts}]))},null,2));
}finally{await f.cleanup();}
