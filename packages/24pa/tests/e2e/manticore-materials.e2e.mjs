// Real dsh Loader, public panel API, SQLite/PostgreSQL and stubbed Feishu CLI.
// No production accounts or authorization caches are used.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootHost } from '../helpers/host.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
let root, host, hostRoot, cluster, workspace, env, binding, noteId, revision, versionId, candidateId, operationId;
const owner = 'ou_material_owner';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
const read = (kind, extra = {}) => host.api('materials', { workspaceBinding: binding, kind, noteId, ...extra });
const change = (action, extra = {}) => host.api('action', { type: 'material.change', workspaceBinding: binding, noteId, action, requestId: crypto.randomUUID(), instruction: '隔离验收主人明确授权本次操作', ...extra });
const rows = async sql => JSON.parse(await cluster.query(`select coalesce(json_agg(t), '[]'::json) as v from (${sql}) t`));
const until = async (fn, label) => { for (let i=0; i<80; i++) { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve,250)); } throw Error('等待失败：'+label); };
const approve = async () => {
  const [token] = await rows(`select token from pa24.review_token where version_id='${versionId}' and action='approve' order by expires_at desc`);
  await host.api('action', { type: 'test.inject', event: { eventId: crypto.randomUUID(), appId: 'test-app', senderOpenId: owner, chatType: 'p2p', kind: 'card', cardAction: { value: { pa24: 'review', token: token.token } } } });
  await until(async () => (await read('detail')).selected.status === 'approved', '本人批准精确版本');
};
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(),'pa24-manticore-materials-')); cluster = await startPgCluster();
  workspace = join(root,'workspace'); const bin = join(root,'bin'); await mkdir(workspace); await mkdir(bin);
  await writeFile(join(workspace,'AGENTS.md'), '# 24私助资料隔离验收\n\n```json\n'+JSON.stringify({ ...DEFAULT_CONFIG, storage: process.env.PA24_E2E_STORAGE === 'sqlite' ? 'sqlite' : 'postgres', mode:'feishu', ownerOpenId:owner, folderToken:'folder', tasklistId:'tasks', calendarId:'primary', pgDsnEnv:'PA24_TEST_DSN', appIdEnv:'PA24_TEST_APP', appSecretEnv:'PA24_TEST_SECRET' },null,2)+'\n```\n');
  const state = join(root,'lark-state.json'); await writeFile(state,JSON.stringify({ ownerOpenId:owner }));
  await writeFile(join(bin,'lark-cli'), `#!${process.execPath}\nawait import(${JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs'))});\n`); await chmod(join(bin,'lark-cli'),0o755);
  env = { PA24_WORKSPACE:workspace, PA24_TRANSPORT:'fake', PA24_TEST_DSN:cluster.dsn, PA24_TEST_APP:'test-app', PA24_TEST_SECRET:'test-secret', PA24_LARK_STUB_STATE:state, PATH:bin+':'+process.env.PATH };
  host = await bootHost({env}); hostRoot = host.root; const snapshot = await host.waitUntil(s => s.workspace && s.transport?.connected, {label:'资料工作区就绪'}); binding = snapshot.workspaceBinding;
},600000);
afterAll(async () => { await host?.stop(); await cluster?.stop(); if(root) await rm(root,{recursive:true,force:true}); });

describe('M05 实际 Loader 的资料公开操作与持久恢复', () => {
  it('从真实原稿保存人工草稿，普通刷新不调模型/发文档，发布冻结版本且重复请求不复制', async () => {
    await host.api('action',{type:'test.inject',event:{eventId:'m05-photo',messageId:'m05-photo',appId:'test-app',senderOpenId:owner,chatType:'p2p',messageType:'image',imageKey:'m05-image',imageData:image}});
    const list = await until(async()=> { const view=await read('list');return view.items.some(item=>item.pages>0) ? view:null; },'保存原稿'); noteId=list.items[0].id;
    const original = await read('original',{pageNo:1}); expect(original.data).toContain(image);
    const initial = await read('detail'); expect(initial.material.revision).toBe(0);
    const saved = await change('save_draft',{expectedRevision:0,draft:{...initial.material.draft,transcript:'主人核对后的项目记录',summary:'项目记录',candidates:[{summary:'准备资料',sourceQuote:'会议要求准备资料'}]}});
    revision=saved.revision; expect(saved.published).toBe(false); expect((await read('detail')).versions).toEqual([]);
    expect((await rows("select count(*)::int as count from pa24.action_operation where action='note.publish'"))[0].count).toBe(0);
    const published = await change('publish_draft',{expectedRevision:revision}); versionId=published.versionId;
    const again = await change('publish_draft',{expectedRevision:revision}); expect(again).toMatchObject({reused:true,versionId});
    const detail = await read('detail'); candidateId=detail.selected.content.candidates[0].id;
    expect(detail.selected.status).toBe('pending_review'); expect(detail.selected.content.transcript).toBe('主人核对后的项目记录');
    expect((await rows("select count(*)::int as count from pa24.action_operation where action='note.document.create'"))[0].count).toBe(1);
    await expect(change('adopt_actions',{versionId,candidateIds:[candidateId]})).rejects.toThrow('审核');
    await expect(host.api('materials',{workspaceBinding:'old-workspace'})).rejects.toThrow('工作区');
  });

  it('本人审核后明确授权生成对象；重发与重复候选保持唯一对象，直接事项均结算', async () => {
    await change('resend',{versionId,requestId:'resend-same'}); await change('resend',{versionId,requestId:'resend-same'});
    expect((await read('detail')).versions).toHaveLength(1); await approve();
    const result = await change('adopt_actions',{versionId,candidateIds:[candidateId]}); expect(result).toMatchObject({executed:1,failed:0}); operationId=result.results[0].operationId;
    expect(await change('adopt_actions',{versionId,candidateIds:[candidateId]})).toMatchObject({executed:1,failed:0});
    expect((await rows('select count(*)::int as count from pa24.task'))[0].count).toBe(1);
    const work = await rows("select status from pa24.work_item where id like 'pa24-material-%'"); expect(work.every(row => ['completed','failed'].includes(row.status))).toBe(true);
  });

  it('Host 重启后原稿、草稿、历史凭证、候选关联和执行回执仍可查询；新版本只能提出变更', async () => {
    await host.stop({keepRoot:true}); host=await bootHost({env,root:hostRoot}); binding=(await host.waitUntil(s=>s.workspace&&s.transport?.connected,{label:'重启后绑定就绪'})).workspaceBinding;
    const before=await read('detail'); expect(before.material.revision).toBe(revision); expect(before.selected.status).toBe('approved'); expect(before.decisions).toHaveLength(1);
    expect(before.actions[0].operation.id).toBe(operationId); expect(before.actions[0].operation.status).toBe('succeeded');
    const saved=await change('save_draft',{expectedRevision:revision,draft:{...before.material.draft,candidates:[{...before.material.draft.candidates[0],summary:'准备修订资料'}]}});
    const published=await change('publish_draft',{expectedRevision:saved.revision}); versionId=published.versionId; await approve();
    const result=await change('adopt_actions',{versionId,candidateIds:[candidateId]}); expect(result.results[0]).toMatchObject({reused:true,operationId,changeProposal:{proposed:{summary:'准备修订资料'}}});
    expect((await rows('select count(*)::int as count from pa24.task'))[0].count).toBe(1);
    const current=await read('detail'); expect(current.versions).toHaveLength(2); expect(current.decisions).toHaveLength(2); expect(current.actions[0].parameters.summary).toBe('准备资料');
    const calls=(await readFile(env.PA24_LARK_STUB_STATE+'.calls.jsonl','utf8')).trim().split('\n').map(JSON.parse); expect(calls.filter(row=>row.args.includes('task')&&row.args.includes('+create'))).toHaveLength(1);
    expect(await host.api('minutes')).toMatchObject({configured:false,mounted:false,lastRead:null});
  });
});
