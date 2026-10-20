import {fixture} from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import {writeFile} from 'node:fs/promises';
const f=await fixture();
try {
 const workspace=await f.workspace('A'); await f.rt.bind(workspace);
 const old=await f.rt.repos.outbox.enqueue({dedupKey:'old-unconfirmed',channel:'local',target:f.rt.localSessionId,kind:'text',content:{text:'old unknown delivery'}});
 await f.rt.repos.outbox.mark(old.row.id,{status:'unknown',error:'no receipt'});
 for(let i=0;i<201;i++){
  const sent=await f.rt.repos.outbox.enqueue({dedupKey:'new-sent-'+i,channel:'local',target:f.rt.localSessionId,kind:'text',content:{text:'sent'}});
  await f.rt.repos.outbox.mark(sent.row.id,{status:'sent',messageId:'sent-'+i});
 }
 const before=await f.rt.maintenanceArchiveCheck();
 for(let i=0;i<51;i++)await f.rt.repos.reviewReminders.insert({id:'review-'+String(i).padStart(2,'0'),noteId:'N-'+i,versionId:'V-'+i,kind:'once',remindAt:new Date(Date.now()+3600000+i*1000)});
 const result=await f.rt.maintenanceArchiveExecute({confirmStop:true,stopRules:true});
 const stillActive=await f.rt.repos.reviewReminders.activeAll(1000);
 const output={archiveCheck:{blocking:before.blocking,outboxPending:before.outboxPending,message:before.message},trueUnknownCount:(await f.rt.repos.outbox.recent(1000)).filter(r=>r.status==='unknown').length,archiveExecute:{rulesStopped:result.rulesStopped,failures:result.failures,remainingReviewReminders:result.remaining.reviewReminders,message:result.message},activeRemindersAfter:stillActive.map(r=>r.id)};
 await writeFile('/tmp/pa24-archive-caps-result.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
}finally{await f.cleanup();}
