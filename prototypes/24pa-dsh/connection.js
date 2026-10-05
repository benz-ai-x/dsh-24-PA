// Read-only, on-demand checks. Results never contain CLI tokens or environment values.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { cli, hash } from './feishu.js';
const exec = promisify(execFile);
const status = (state, message, extra={}) => ({state,message,...extra});
const safeError = (error, config) => {
  let message=String(error.message || error);
  for(const name of [config.appIdEnv,config.appSecretEnv]) { const secret=process.env[name]; if(secret)message=message.split(secret).join('[已隐藏]'); }
  return message.replace(/(?:access_token|refresh_token|app_secret|authorization)\s*[=:]\s*\S+/gi,'凭据=[已隐藏]').slice(0,500);
};
async function executable(bin) {
  const paths=bin.includes('/')?[resolve(bin)]:(process.env.PATH||'').split(delimiter).map(dir=>join(dir,bin));
  for(const path of paths) { try { await access(path,constants.X_OK); return await realpath(path); } catch { /* try next PATH entry */ } }
  throw new Error('找不到可执行的 lark-cli；请在 dsh 服务器安装并加入启动进程的 PATH。');
}
export async function inspectConnection(config, store) {
  const result={checkedAt:new Date().toISOString(),source:null,cli:null,auth:status('unchecked','尚未检查'),resources:[]};
  const resources=[
    ['folder','文档目录',config.folderToken,['drive','files','list','--folder-token',config.folderToken,'--page-size','1']],
    ['tasklist','任务清单',config.tasklistId,['task','tasklists','get','--tasklist-guid',config.tasklistId]],
    ['calendar','本人日历',config.calendarId,config.calendarId==='primary'?['calendar','calendars','primary']:['calendar','calendars','get','--calendar-id',config.calendarId]],
  ];
  result.resources=resources.map(([id,label,value])=>({id,label,value,...status(value?'unchecked':'missing',value?'未检查可读性':'未配置')}));
  try {
    const file=await readFile(join(store.path,'AGENTS.md'),'utf8');
    result.source=hash(file)===store.sourceHash?status('ok','文件与当前生效版本一致'):status('changed','文件已修改，尚未验证并重载；下方仍显示当前生效配置');
  } catch(error) { result.source=status('error',safeError(error,config)); }
  try {
    const path=await executable(config.larkCliBin);
    const {stdout}=await exec(path,['--version'],{timeout:5000,maxBuffer:16384,env:{...process.env,LARKSUITE_CLI_NO_UPDATE_NOTIFIER:'1',LARKSUITE_CLI_NO_SKILLS_NOTIFIER:'1'}});
    result.cli=status('ok','CLI 可执行',{path,version:stdout.trim().slice(0,100)});
  } catch(error) { result.cli=status('error',safeError(error,config)); return result; }
  const readConfig={...config,cliTimeoutMs:10000};
  try {
    const data=await cli(readConfig,['auth','status','--verify']);
    const user=data.identities?.user;
    const matched=!!config.ownerOpenId && user?.openId===config.ownerOpenId;
    const verified=data.verified===true && user?.tokenStatus==='valid';
    result.auth=status(!user?.openId?'missing':!config.ownerOpenId?'unbound':!matched?'mismatch':verified?'ok':'unverified',
      !user?.openId?'固定 profile 尚无用户授权':!config.ownerOpenId?'已有 CLI 身份；工作区尚未绑定主人':!matched?'CLI 用户与配置主人不一致':verified?'CLI 用户令牌有效，身份与主人一致':'身份匹配，但令牌有效性未确认',
      {profile:config.larkProfile,userName:user?.userName||null,openId:user?.openId||null,verified,matched,tokenStatus:user?.tokenStatus||null});
    if(!matched||!verified) return result;
    result.resources=await Promise.all(resources.map(async([id,label,value,args])=>{
      if(!value)return {id,label,value,...status('missing','未配置')};
      try { await cli(readConfig,[...args,'--as','user']); return {id,label,value,...status('ok','读取接口成功；写入权限尚未验证')}; }
      catch(error) { return {id,label,value,...status('error',safeError(error,config))}; }
    }));
  } catch(error) { result.auth=status('error',safeError(error,config),{profile:config.larkProfile}); }
  return result;
}
