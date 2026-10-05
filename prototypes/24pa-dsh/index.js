import z from '@deepseek-ai/schemastery';
import { PrototypeRuntime } from './runtime.js';
export const name = 'pa24-prototype';
export const inject = ['sessionController','sessions','connection','webServer','agentPresets','workspaceRegistry','subagents','fs'];
export const Config = z.object({
  stateDirectory:z.string().required(), workspacePath:z.string().default(''),
  larkCliBin:z.string().default('lark-cli'), reminderTickMs:z.natural().min(250).default(1000),
  maxImageBytes:z.natural().min(1024).max(20971520).default(10485760),
  cliTimeoutMs:z.natural().min(1000).default(90000), modelTimeoutMs:z.natural().min(1000).default(180000),
});
export function apply(ctx, config) {
  const runtime = new PrototypeRuntime(ctx,config);
  ctx.effect(()=>ctx.reflect.provide('pa24Prototype',runtime));
  ctx.on('session/event',(session,event)=>{ void runtime.enqueue(()=>runtime.onTurn(session,event)).catch(e=>runtime.report(e)); });
  ctx.effect(()=>ctx.connection.fetch.register({path:'/api/24pa-prototype',methods:['POST'],requestBody:'buffered',async fetch(request){
    const respond=value=>Response.json(value,{headers:{'cache-control':'no-store'}});
    try {
      const {endpoint,payload}=await request.json();
      if(endpoint==='snapshot') return respond({ok:true,value:runtime.snapshot()});
      if(endpoint==='action') return respond({ok:true,value:await runtime.admin(payload)});
      if(endpoint==='memory') return respond({ok:true,value:await runtime.store.memory({action:'search',query:String(payload?.query||'')},null)});
      throw new Error('未知管理接口。');
    }catch(e){ return respond({ok:false,error:{message:e.message}}); }
  }}));
  ctx.effect(()=>{ void runtime.start().catch(e=>runtime.report(e)); return ()=>runtime.stop(); });
}
