import { writeFile } from 'node:fs/promises';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { registerPanel } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/panel.js';
const output='/var/folders/8x/zbvzzwh525lfw_ldp529f4lm0000gn/T/pa24-deep2-ui-knowledge-panel-results.json';
const f=await fixture();let route;
f.ctx.effect=fn=>fn(); f.ctx.connection={fetch:{register:r=>{route=r;}}};registerPanel(f.ctx,f.rt);
const rpc=async (endpoint,payload={})=>(await route.fetch(new Request('http://127.0.0.1/api/24pa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint,payload})}))).json();
try{
 const a=await f.workspace('A',{ownerOpenId:'owner-A',tts:{engine:'melo',meloDir:'/nonexistent-probe-dir',voice:'zh_female_cancan_uranus_bigtts',volcKeyEnv:'PA24_VOLC_TTS_KEY'}});
 const b=await f.workspace('B',{ownerOpenId:'owner-B',tts:{engine:'melo',meloDir:'/nonexistent-probe-dir',voice:'zh_female_cancan_uranus_bigtts',volcKeyEnv:'PA24_VOLC_TTS_KEY'}});
 await f.rt.bind(a);const aSnapshot=await rpc('snapshot');const oldBinding=aSnapshot.value.workspaceBinding;
 await f.rt.bind(b,true);const bSnapshot=await rpc('snapshot');
 const rejectedConfig=await rpc('action',{type:'workspace.config-update',workspaceBinding:oldBinding,config:{ownerOpenId:'wrong-owner'}});
 const testAccepted=await rpc('action',{type:'tts.test',workspaceBinding:oldBinding});
 const bOutbox=await f.rt.repos.outbox.recent(20);
 await f.rt.bind(a,true);const aOutbox=await f.rt.repos.outbox.recent(20);
 const result={scenario:'Two authenticated panel tabs: tab A retains snapshot/binding A, another tab binds B, delayed A test-voice action arrives after B active',aSnapshot:{path:aSnapshot.value.workspace.path,binding:oldBinding,owner:aSnapshot.value.workspace.config.ownerOpenId},bSnapshot:{path:bSnapshot.value.workspace.path,binding:bSnapshot.value.workspaceBinding,owner:bSnapshot.value.workspace.config.ownerOpenId},rejectedConfig,testAccepted,bOutbox,aOutbox};
 await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({output,rejectedConfig,testAccepted,bOutbox:bOutbox.map(r=>({channel:r.channel,target:r.target,kind:r.kind})),aOutbox:aOutbox.length},null,2));
}finally{await f.cleanup();}
