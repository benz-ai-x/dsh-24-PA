import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { initialState, transition, QUESTION } from './model.js';
import { FeishuGateway, hash, cli } from './feishu.js';
import { WorkspaceStore, ROLES } from './workspace.js';
import { perform, text } from './business.js';
import { inspectConnection } from './connection.js';

const texts = content => (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
const running = job => ['queued','running'].includes(job.status);
export class PrototypeRuntime {
  constructor(ctx, config) {
    this.ctx = ctx; this.baseConfig = config; this.config = config;
    this.state = initialState(); this.jobs = new Map(); this.originals = new Map();
    this.cards = new Map(); this.routes = new Map(); this.serial = Promise.resolve(); this.closed = false;
    this.connection = '正在加载工作区'; this.gateway = null;
    this.sessionBindings = {};
    this.lifetime = new AbortController();
  }
  enqueue(work) { const result = this.serial.then(() => { if (this.closed) throw new Error('原型已卸载。'); return work(); }); this.serial = result.catch(() => {}); return result; }
  change(action) { this.state = transition(this.state, { at: new Date().toISOString(), ...action }); }
  report(error) { if (!this.closed) this.change({ type: 'notice', text: `未完成：${error.message || String(error)}` }); }
  snapshot() {
    return { ...this.state, question: QUESTION, mode: this.config.mode, connection: this.connection,
      workspace: this.store ? { id: this.store.workspace.id, path: this.store.path, config: this.store.config, leadId: this.leadId, robotId: this.robotId, loadedAt: this.store.loadedAt } : null,
      feishu: this.store ? this.connectionStatus() : null,
      availableWorkspaces: this.ctx.workspaceRegistry.list().map(w => ({ id: w.id, title: w.title, path: w.path })),
      workers: Object.entries(ROLES).map(([id, role]) => ({ id, name: role.name, enabled: this.config.enabledWorkers?.includes(id), running: [...this.jobs.values()].filter(j => j.role === id && running(j)).length })),
      jobs: [...this.jobs.values()].map(({ content, timer, ...job }) => job),
      limits: '可丢弃原型：工作区配置、JSON 记忆、原稿与原生会话持久保存；业务队列、提醒与审核凭证只保留本次运行。正式版使用 PostgreSQL 恢复业务。',
    };
  }
  async start() {
    await mkdir(this.baseConfig.stateDirectory, { recursive: true });
    let saved;
    try { const data=JSON.parse(await readFile(join(this.baseConfig.stateDirectory, 'workspace.json'), 'utf8')); saved=data.path; this.sessionBindings=data.sessions || {}; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await this.bind(this.baseConfig.workspacePath || saved || join(this.baseConfig.stateDirectory, 'workspace'), true);
    this.timer = setInterval(() => { void this.enqueue(() => this.tick()).catch(e => this.report(e)); }, this.config.reminderTickMs);
    this.timer.unref();
  }
  async bind(path, initialize = false) {
    if ([...this.jobs.values()].some(running) || this.state.sessions[0].running) throw new Error('请先完成或停止当前工作，再更换工作区。');
    const store = await new WorkspaceStore(this.ctx, path).open(initialize);
    const sameWorkspace = this.store?.path === store.path;
    await this.gateway?.close(); this.gateway = null; this.liveReady = false;
    this.store = store; this.config = { ...this.baseConfig, ...store.config };
    this.leadId = this.sessionBindings[store.path]?.leadId || `pa24-${hash(store.path).slice(0,12)}-lead`;
    this.robotId = this.sessionBindings[store.path]?.robotId || `pa24-${hash(store.path).slice(0,12)}-robot`;
    this.diagnostics = null; this.lastReceivedAt = null; this.lastSentAt = null;
    if (!sameWorkspace) { this.state = initialState(this.config.larkProfile); this.jobs.clear(); this.cards.clear(); this.routes.clear(); this.originals.clear(); }
    await this.saveBinding();
    await this.ensureLead(); await this.connect();
  }
  async saveBinding() {
    this.sessionBindings[this.store.path]={leadId:this.leadId,robotId:this.robotId};
    await writeFile(join(this.baseConfig.stateDirectory,'workspace.json'),JSON.stringify({path:this.store.path,sessions:this.sessionBindings}),{mode:0o600});
  }
  async createOwnedSession(key) {
    try { return await this.ctx.sessionController.create({sessionId:this[key],workspaceId:this.store.workspace.id,agentPreset:'pa24-prototype'}); }
    catch(error) {
      if(error.code!=='agent-preset/conflict')throw error;
      const previous=this[key]; this[key]=`pa24-${hash(this.store.path).slice(0,12)}-${key==='leadId'?'lead':'robot'}-${randomUUID().slice(0,8)}`;
      const created=await this.ctx.sessionController.create({sessionId:this[key],workspaceId:this.store.workspace.id,agentPreset:'pa24-prototype'});
      await this.saveBinding();
      this.change({type:'notice',text:`旧会话 ${previous} 已选择其他预设，历史保留；24PA 已建立新的${key==='leadId'?'飞书接入':'机器人'}会话。`});
      return created;
    }
  }
  async connect() {
    if (this.config.mode === 'demo') { this.connection = 'demo：未连接飞书，业务对象仅内存；Agent 调用真实 dsh 模型'; return; }
    this.gateway = new FeishuGateway(this.config);
    try {
      await this.gateway.start(data => this.receive(data), value => this.handleCard(value), e => { this.report(e); void this.notify(`未完成：${e.message}`).catch(err => this.report(err)); });
      this.liveReady = true; this.connection = '飞书长连接已启动，请从手机发消息验证收发';
    } catch (e) { this.connection = `飞书未就绪：${e.message}`; }
  }
  async ensureLead() {
    const created = await this.createOwnedSession('leadId');
    await this.ctx.sessionController.rename({ sessionId: created.sessionId, title: '24PA · 飞书接入会话' });
    this.change({ type: 'session.bind', session: 'Lead', realId: created.sessionId });
    const resolved = await this.ctx.sessionController.resolveAgent(created.sessionId);
    if ('error' in resolved) throw resolved.error;
    this.lead = resolved.agent; return this.lead;
  }
  async robot() {
    const created = await this.createOwnedSession('robotId');
    await this.ctx.sessionController.rename({ sessionId: created.sessionId, title: '24PA 机器人' });
    return { sessionId: created.sessionId };
  }
  roleFor(agent) {
    if (agent?.session.header.cwd !== this.store?.path) return null;
    if (agent.id === this.leadId) return 'lead';
    const job = this.jobs.get(agent.id); if (job) return job.role;
    // Native child provenance is authoritative; an inherited preset is not maintenance authority.
    const preset=agent.ctx ? this.ctx.agentPresets.composedPreset(agent.ctx) : agent.session.header.agentPreset;
    if (!agent.parentAgent && agent.session.header.origin !== 'subagent' && preset === 'pa24-prototype') return 'robot';
    return null;
  }
  connectionStatus() {
    const c = this.store.config;
    return { profile:c.larkProfile, mode:c.mode, source:join(this.store.path,'AGENTS.md'), loadedAt:this.store.loadedAt,
      config:{ownerOpenId:c.ownerOpenId,folderToken:c.folderToken,tasklistId:c.tasklistId,calendarId:c.calendarId,timeZone:c.timeZone},
      credentials:[c.appIdEnv,c.appSecretEnv].map(name=>({name,present:!!process.env[name]})),
      bot:{message:this.connection,started:!!this.liveReady,lastReceivedAt:this.lastReceivedAt,lastSentAt:this.lastSentAt},
      checking:!!this.connectionCheck, check:this.diagnostics || null };
  }
  async checkConnection() {
    if (this.connectionCheck) { await this.connectionCheck; return this.connectionStatus(); }
    const store=this.store, config=this.config;
    this.connectionCheck=inspectConnection(config,store).then(result=>{if(this.store===store)this.diagnostics=result;});
    try { await this.connectionCheck; } finally { this.connectionCheck=null; }
    return this.connectionStatus();
  }
  async admin(action) {
    if (action.type === 'workspace.bind') return this.enqueue(async () => { await this.bind(text(action.path, 4096), true); return this.snapshot(); });
    if (action.type === 'workspace.reload') return this.enqueue(async () => { await this.bind(this.store.path); return this.snapshot(); });
    if (action.type === 'robot.open') return this.robot();
    if (action.type === 'connection.check') return this.checkConnection();
    throw new Error('管理台只提供工作区绑定、配置重载、只读检查与机器人会话入口。');
  }
  async stop() {
    this.closed = true; this.lifetime.abort(); clearInterval(this.timer);
    for (const j of this.jobs.values()) clearTimeout(j.timer);
    const parents = new Set([this.leadId,...[...this.jobs.values()].map(j=>j.parentSessionId)]);
    const agents=[];
    for(const id of parents) { if(!id)continue; const resolved=await this.ctx.sessionController.resolveAgent(id); if(!('error' in resolved))agents.push(resolved.agent); }
    await this.ctx.subagents.drainContinuableDescendants(agents);
    await this.gateway?.close();
  }
  async notify(message, session = 'Lead', card, workId) {
    const job = this.jobs.get(workId);
    if (job?.parentSessionId && job.parentSessionId !== this.leadId) { this.change({type:'notice',text:message}); return; }
    this.change({ type: 'session.message', session: 'Lead', role: 'assistant', text: message });
    if (this.liveReady) { const id = await this.gateway.send(`[24PA 机器人] ${message}`, card); this.lastSentAt=new Date().toISOString(); this.routes.set(id, workId || null); }
  }
  async receive(data) {
    return this.enqueue(async () => {
      const m = data.message, content = JSON.parse(m.content);
      this.lastReceivedAt = new Date().toISOString();
      const reference = m.parent_id ? this.routes.get(m.parent_id) : null;
      if (m.parent_id && !this.routes.has(m.parent_id)) return this.notify('这条引用没有可恢复的事项记录，请告诉我事项名称或重新发送材料。');
      if (m.message_type === 'image') {
        const bytes = await this.gateway.download(m.message_id, content.image_key);
        return this.acceptImage(bytes, m.message_id);
      }
      if (m.message_type !== 'text') return this.notify('目前支持文字和单页手写照片；录音 Worker 尚未安装。');
      const input = text(content.text);
      const execute = input.match(/^\/执行\s+(N-[a-zA-Z0-9-]+)\s+([\s\S]+)$/);
      if (execute) { const note = this.findNote(execute[1]); const result = await perform(this, {type:'note.action',id:note.id,hash:note.hash,title:execute[2],authorized:true}, 'human'); return this.notify(result); }
      if (input === '/24pa' || input === '/帮助') return this.notify('直接告诉我需要办理什么，或用手机拍照发送笔记。我会委派对应 Worker。可说“查看正在处理的事”“继续某件事”“暂停某件事”。笔记整理后会收到待审核文档和按钮。配置及记忆维护在 dsh 工作区会话中进行。');
      await this.submitLead(input, reference);
    });
  }
  async submitLead(input, reference) {
    const lead = await this.ensureLead();
    const content = [{ type: 'text', text: `${reference ? `[回复事项 ${reference}]\n` : ''}${input}\n\n[接入信息：当前时间 ${new Date().toISOString()}，用户时区 ${this.config.timeZone}。]` }];
    await this.ctx.sessionController.prompt({ requestId: randomUUID(), sessionId: lead.id, mode: 'queue', content, clientTimeZone: this.config.timeZone }, this.lifetime.signal);
    await this.ctx.sessions.flush(lead.session);
    this.change({ type: 'session.message', session: 'Lead', role: 'user', text: input });
  }
  async acceptImage(bytes, name) {
    let mediaType, extension;
    if (bytes[0] === 0x89 && bytes.subarray(1,4).toString() === 'PNG') [mediaType,extension] = ['image/png','png'];
    else if (bytes[0] === 0xff && bytes[1] === 0xd8) [mediaType,extension] = ['image/jpeg','jpg'];
    else if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') [mediaType,extension] = ['image/webp','webp'];
    else throw new Error('请发送 PNG、JPEG 或 WebP 原图。');
    if (bytes.length > this.config.maxImageBytes) throw new Error('单页图片上限 10 MiB。');
    const id = `N-${randomUUID().slice(0,8)}`;
    const folder = join(this.store.path, '.24pa-prototype', 'originals'); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, `${id}.${extension}`), bytes, { flag: 'wx', mode: 0o600 });
    this.originals.set(id, { bytes, mediaType, extension });
    await this.submitLead(`本人通过飞书拍照提交了一页纸质笔记（${name}）。请交给 handwriting Worker 整理并生成待人工审核的文档。调用 pa24_delegate 时传 imageId=${id}；原图已保存，交由宿主附给 Worker。`);
    await this.notify(`已收到原稿 ${id}，Lead 正在安排手写整理。`);
    return id;
  }
  async delegate(args, exec) {
    if (!['lead','robot'].includes(this.roleFor(exec.agent))) throw new Error('只有24PA机器人可以委派 Worker。');
    if (!this.config.enabledWorkers.includes(args.worker)) throw new Error('此 Worker 未启用。');
    const id = `pa24-worker-${args.worker}-${randomUUID()}`;
    const job = { id, parentSessionId:exec.agent.id, origin:exec.agent.id===this.leadId?'feishu':'dsh', role: args.worker, title: text(args.title, 200), brief: text(args.instruction), status: 'queued', createdAt: new Date().toISOString(), noteId: args.imageId || null, progress: '等待执行', result: '', content: [] };
    if (args.worker === 'handwriting' && !this.originals.has(args.imageId)) throw new Error('需要本次运行已收到的图片编号。');
    if (args.imageId && [...this.jobs.values()].some(j => j.noteId === args.imageId)) throw new Error('这页笔记已有事项，请查看或继续原事项。');
    if (args.imageId && args.worker !== 'handwriting') throw new Error('纸质笔记只交给手写 Worker。');
    job.content = [{ type: 'text', text: `事项：${job.title}\n本人委托（由 Lead 转述）：${job.brief}\n当前时间：${new Date().toISOString()}；时区：${this.config.timeZone}。\n${ROLES[job.role].brief}\n完成后说明实际结果、出处或需要本人确认的内容。` }];
    if (job.noteId) { const image = this.originals.get(job.noteId); job.content.push({ type: 'image', mediaType: image.mediaType, data: image.bytes.toString('base64') }); }
    this.jobs.set(id, job); await this.pump();
    return { workId: id, worker: args.worker, status: job.status, message: '事项已接纳；接纳不代表完成。' };
  }
  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (const job of this.jobs.values()) {
        if (job.status !== 'queued') continue;
        if ([...this.jobs.values()].filter(j => j.status === 'running').length >= this.config.maxWorkers) break;
        job.status = 'running'; job.progress = 'Worker 正在处理';
        try {
          const resolved = await this.ctx.sessionController.resolveAgent(job.parentSessionId);
          if ('error' in resolved) throw resolved.error;
          await this.ctx.subagents.startContinuable({ provider: 'spawn', label: `${ROLES[job.role].name} · ${job.title}`, childId: job.id, signal: new AbortController().signal,
            request: { parent: resolved.agent, prompt: job.content, persona: `你是 24PA 的 ${ROLES[job.role].name} Worker。${ROLES[job.role].brief} 将结果交回发起会话。`, toolFilter: { allow: job.role === 'handwriting' ? [] : ['pa24_work','pa24_memory'] }, maxDepth: 1, ...(this.config.workerModels[job.role] ? { agentOptions: this.config.workerModels[job.role] } : {}) } });
          job.content = [];
          job.started = true; this.armTimeout(job);
        } catch (e) { job.status = 'failed'; job.progress = e.message; await this.notify(`“${job.title}”未启动：${e.message}`, 'Lead', undefined, job.id); }
      }
    } finally { this.pumping = false; }
  }
  armTimeout(job) {
    clearTimeout(job.timer);
    job.timer = setTimeout(() => { if (job.status === 'running') { job.status = 'failed'; job.progress = '执行超时，需要核对后继续'; this.ctx.subagents.interrupt(job.id, { kind: 'user', parentSessionId: job.parentSessionId }); void this.notify(`“${job.title}”处理超时，请核对已产生的结果后继续。`, 'Lead', undefined, job.id).catch(e => this.report(e)); void this.pump(); } }, this.config.modelTimeoutMs);
  }
  async control(args, exec) {
    if (!['lead','robot'].includes(this.roleFor(exec.agent))) throw new Error('事项调度由24PA机器人负责。');
    if (args.action === 'list') return { items: this.snapshot().jobs };
    const job = this.jobs.get(args.workId); if (!job) throw new Error('事项不存在；重启后的旧业务账本需要核对。');
    if (args.action === 'inspect') { const { timer, content, ...view } = job; return view; }
    if (args.action === 'stop') { job.status = 'stopped'; job.progress = '本人要求停止；已完成操作保留'; clearTimeout(job.timer); this.ctx.subagents.interrupt(job.id, { kind: 'user', parentSessionId: job.parentSessionId }); await this.pump(); }
    else if (args.action === 'continue') {
      if (!job.started) throw new Error('此事项尚无原生 Worker 会话，请核对失败原因后重新委派。');
      if (running(job)) throw new Error('事项正在运行；请等待结果或明确停止后再继续。');
      if ([...this.jobs.values()].filter(j => j.status === 'running').length >= this.config.maxWorkers) throw new Error('Worker 并发已满，请稍后继续。');
      job.status = 'running'; job.progress = '继续处理';
      try { const parent=await this.ctx.sessionController.resolveAgent(job.parentSessionId); if('error' in parent)throw parent.error; await this.ctx.subagents.sendMessage(parent.agent, job.id, [{ type: 'text', text: text(args.instruction) }], { signal: exec.signal }); this.armTimeout(job); }
      catch (e) { job.status = 'failed'; job.progress = e.message; throw e; }
    } else throw new Error('未知事项操作。');
    return { workId: job.id, status: job.status };
  }
  async work(args, exec) {
    if (this.gateway && !this.liveReady) throw new Error('飞书身份校验或连接尚未通过。');
    const role = this.roleFor(exec.agent), job = this.jobs.get(exec.agent?.id);
    if (!job || job.status !== 'running' || !ROLES[role]?.actions.includes(args.action)) throw new Error('此 Worker 没有执行这项操作的权限，或事项已停止。');
    if (args.action === 'agenda') return this.gateway ? cli(this.config, ['calendar','+agenda','--as','user','--calendar-id',this.config.calendarId, ...(args.start ? ['--start',args.start] : []), ...(args.end ? ['--end',args.end] : [])]) : { demo: true, events: [], message: '演示日历为空；未查询本人飞书日历。' };
    if (args.action === 'calendar_create') {
      for (const value of [args.start,args.end]) if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('日程需要带时区的明确开始和结束时间。');
      if (Date.parse(args.end) <= Date.parse(args.start)) throw new Error('结束时间须晚于开始时间。');
      if (this.gateway && !this.liveReady) throw new Error('飞书未就绪。');
      return this.gateway ? cli(this.config, ['calendar','+create','--as','user','--calendar-id',this.config.calendarId,'--summary',`[24PA原型] ${text(args.title,500)}`,'--start',args.start,'--end',args.end]) : { demo: true, title: args.title, start: args.start, end: args.end, message: '仅演示安排；未创建飞书日程。' };
    }
    const operations = { task_add:'task.add', task_complete:'task.complete', memo_add:'memo.add', remind:'reminder.add', reminder_cancel:'reminder.cancel' };
    const message = await this.enqueue(() => perform(this, { ...args, type: operations[args.action], session:'Lead' }, 'model'));
    job.progress = message;
    return { mode: this.config.mode, message, tasks: this.state.tasks, memos: this.state.memos, reminders: this.state.reminders };
  }
  async memory(args, exec) {
    const role = this.roleFor(exec.agent); if (!role) throw new Error('记忆仅对绑定的 24PA 工作区会话开放。');
    return this.store.memory(args, role === 'robot' ? exec.agent.id : null, this.ctx.fs, exec.signal);
  }
  async onTurn(session, event) {
    if (this.closed) return;
    const isLead = session.id === this.leadId, job = this.jobs.get(session.id);
    if (!isLead && !job) return;
    if (isLead && event.type === 'turn/start') this.change({ type:'session.running', running:true });
    if (event.type !== 'turn/end') return;
    await this.ctx.sessions.flush(session);
    const output = texts(session.ownEvents().filter(e => e.type === 'assistant/message' && e.data.turn === event.data.turn && !e.data.interrupted).at(-1)?.data.message.content);
    const failure = event.data.reason?.error;
    if (isLead) {
      this.change({ type:'session.running', running:false });
      if (failure) await this.notify(failure.code === 'MISSING_CREDENTIAL' ? 'dsh 尚未配置模型，请在模型设置中配置后再发送任务。' : `Lead 未完成本轮：${failure.message}`);
      else if (output) await this.notify(output);
      return;
    }
    if (job.status !== 'running') return;
    clearTimeout(job.timer);
    job.result = output; job.status = failure || !output ? 'failed' : 'completed'; job.progress = failure?.message || (output ? 'Worker 已完成，结果交回 Lead' : 'Worker 未产生结果');
    if (job.role === 'handwriting' && job.status === 'completed') {
      try {
        const existing = this.state.notes.find(n => n.id === job.noteId);
        if (existing) await perform(this, { type:'note.revise', id:existing.id, text:output }, 'model');
        else {
          const image = this.originals.get(job.noteId), external = await this.publishNote(job.noteId, 1, output);
          this.change({ type:'note.create', id:job.noteId, title:job.title, text:output, hash:hash(output), external, original:{ sha256:hash(image.bytes), mediaType:image.mediaType, bytes:image.bytes.length } });
          await this.notify(`${job.title}已整理为 v1，请核对原稿并审核。${external ? `\n${external.url}` : '\n当前 demo 模式未创建飞书文档；整理内容可在管理台查看。'}`, 'Lead', this.reviewCard(this.findNote(job.noteId), job.id), job.id);
        }
        job.status = 'waiting_review'; job.progress = '等待本人审核';
      } catch (e) { job.status = 'failed'; job.progress = `文档发布未确认：${e.message}`; await this.notify(job.progress, 'Lead', undefined, job.id); }
    }
    await this.pump();
  }
  findNote(id) { const n = this.state.notes.find(n => n.id === id); if (!n) throw new Error('笔记不存在或原型已重启。'); return n; }
  async publishNote(id, version, body) { return this.gateway ? this.gateway.createDocument(`手写笔记 ${id} v${version}`, body, { statusLabel:`24PA原型 ${id} v${version}：待本人审核`, image:this.originals.get(id) }) : null; }
  reviewCard(n, workId) {
    const button = (label, type) => { const token = randomUUID(); this.cards.set(token, { type, id:n.id, version:n.version, hash:n.hash, session:'Lead', workId, expires:Date.now()+86400000 }); return { tag:'button', text:{tag:'plain_text',content:label}, type:'default', value:{pa24Token:token} }; };
    return { header:{template:'turquoise',title:{tag:'plain_text',content:`${n.title} · v${n.version} · 待本人审核`}}, elements:[{tag:'div',text:{tag:'lark_md',content:`${n.external ? `[打开文档与原稿](${n.external.url})` : 'demo：未创建飞书文档'}\n审核只覆盖本版本；创建行动项需单独授权。`}}, {tag:'action',actions:[button('本人审核通过','note.approve'),button('退回修改','note.reject')]}] };
  }
  async handleCard(value) {
    const action = this.cards.get(value?.pa24Token);
    if (!action || action.expires < Date.now()) throw new Error('按钮已过期或原型已重启，请重新核对当前版本。');
    await this.enqueue(async () => {
      const result = await perform(this, action, 'human');
      const job = this.jobs.get(action.workId); if (job) { job.status = action.type === 'note.approve' ? 'completed' : 'needs_revision'; job.progress = result; }
      await this.notify(result, 'Lead', undefined, action.workId);
    });
  }
  async tick() {
    for (const r of this.state.reminders.filter(r => r.status === 'pending' && r.at <= Date.now())) {
      this.change({ type:'reminder.fire', id:r.id });
      try { await this.notify(`提醒：${r.text}`); this.change({ type:'reminder.receipt', id:r.id, accepted:true }); }
      catch (e) { this.change({ type:'reminder.receipt', id:r.id, accepted:false }); this.report(e); }
    }
  }
}
