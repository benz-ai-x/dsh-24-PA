// THROWAWAY: live Feishu transport and a small fixed-argv CLI gateway.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function documentHash(document, statusLabel) {
  if (typeof document?.content !== 'string' || document.content.split(statusLabel).length !== 2) throw new Error('文档状态标记缺失或重复，不能核验此版本。');
  if (/<(?:whiteboard|sheet|iframe|view|synced|task|html5-block)\b/i.test(document.content)) throw new Error('原型只审核文字与原稿图片；新增动态资源后须移除或重新整理。');
  return hash(JSON.stringify(canonical({ content: document.content.replace(statusLabel, '__24PA_STATUS__'), references: document.reference_map || {} })));
}
export function cli(config, args, content, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.larkCliBin, ['--profile', config.larkProfile, ...args, '--json'], {
      cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    });
    let stdout = '', stderr = '', limitError;
    const timer = setTimeout(() => { limitError = new Error('飞书 CLI 超时，写入结果可能未知，请先核对飞书对象；原型不会自动重试。'); child.kill('SIGTERM'); }, config.cliTimeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 16 * 1024 * 1024) { limitError = new Error('飞书返回超过原型读取上限。'); child.kill('SIGTERM'); } });
    child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (limitError) return reject(limitError);
      let result;
      try { result = JSON.parse((code === 0 ? stdout : stderr).trim()); }
      catch { return reject(new Error(`飞书 CLI 未返回 JSON（exit ${code}）；检查安装、profile 和授权。`)); }
      if (code !== 0 || result.ok === false) return reject(new Error(result.error?.message || `飞书 CLI 失败（exit ${code}）。`));
      if (result.ok !== true && args[0] !== 'auth') return reject(new Error('飞书结果信封不受支持，不能把它记作成功。'));
      resolve(result.data || result);
    });
    child.stdin.on('error', () => { /* early process exit is reported by close */ });
    child.stdin.end(content);
  });
}
export class FeishuGateway {
  constructor(config) { this.config = config; this.client = null; this.ws = null; }
  async start(onMessage, onCard, onError) {
    const c = this.config;
    const auth = await cli(c, ['auth', 'status']);
    const openId = auth.identities?.user?.openId;
    if (openId !== c.ownerOpenId) throw new Error('飞书 CLI 的用户 openId 与配置主人不一致，或尚未授权；请在服务器核对固定 profile。');
    const sdk = await import('@larksuiteoapi/node-sdk');
    const options = { appId: process.env[c.appIdEnv], appSecret: process.env[c.appSecretEnv], domain: sdk.Domain.Feishu, loggerLevel: sdk.LoggerLevel.error };
    this.client = new sdk.Client(options);
    this.ws = new sdk.WSClient(options);
    const seen = new Set();
    const dispatcher = new sdk.EventDispatcher({}).register({
      'im.message.receive_v1': async data => {
        if (data.sender?.sender_id?.open_id !== c.ownerOpenId || data.message?.chat_type !== 'p2p') return;
        const id = data.message.message_id;
        if (seen.has(id)) return;
        seen.add(id); if (seen.size > 1000) seen.delete(seen.values().next().value);
        // Only prototype memory is committed here. Durable ACK is a production requirement.
        void onMessage(data).catch(onError);
      },
      'card.action.trigger': async data => {
        if (data.operator?.open_id !== c.ownerOpenId) return { toast: { type: 'error', content: '此原型仅供已绑定主人使用。' } };
        void onCard(data.action?.value, data.context?.open_message_id).catch(onError);
        return { toast: { type: 'info', content: '正在核验，请以随后收到的结果为准。' } };
      },
    });
    await this.ws.start({ eventDispatcher: dispatcher });
  }
  async close() { this.ws?.close({ force: true }); }
  async send(text, card) {
    if (!this.client) throw new Error('飞书机器人尚未连接。');
    const result = await this.client.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: { receive_id: this.config.ownerOpenId, msg_type: card ? 'interactive' : 'text', content: JSON.stringify(card || { text }), uuid: randomUUID() },
    });
    if (result.code !== 0 || !result.data?.message_id) throw new Error(`飞书未确认消息发送：${result.msg || result.code}`);
    return result.data.message_id;
  }
  async download(messageId, key) {
    const response = await this.client.im.messageResource.get({ path: { message_id: messageId, file_key: key }, params: { type: 'image' } });
    const chunks = []; let size = 0;
    for await (const chunk of response.getReadableStream()) {
      size += chunk.length;
      if (size > this.config.maxImageBytes) throw new Error('图片超过原型大小上限，请发送较小的单页图片。');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async createTask(id, title) {
    const result = await cli(this.config, ['task', '+create', '--as', 'user', '--summary', `[24PA原型] ${title}`, '--tasklist-id', this.config.tasklistId, '--idempotency-key', id]);
    const task = result.task || result;
    if (!task.guid) throw new Error('未取得真实任务 ID，请核对飞书清单，勿盲目重试。');
    return { id: task.guid, url: task.url || null };
  }
  async completeTask(task) { await cli(this.config, ['task', '+complete', '--as', 'user', '--task-id', task.external.id]); }
  async createDocument(title, text, { statusLabel, image } = {}) {
    const folder = await mkdtemp(join(tmpdir(), '24PA-PROTOTYPE-wipe-me-'));
    try {
      const paragraphs = text.split('\n').map(line => `<p>${xml(line) || '<br/>'}</p>`).join('\n');
      const imageFile = image ? `original.${image.extension}` : null;
      const body = `<title>${xml(`[24PA原型] ${title}`)}</title><p>可丢弃原型。本页审核仅覆盖明确版本，业务凭证仅保留在本次运行中。重启后须重新生成并审核。</p>${statusLabel ? `<p>${xml(statusLabel)}</p>` : ''}<h1>整理内容</h1>${paragraphs}${image ? `<h1>原稿</h1><img path="@./${imageFile}"/>` : ''}`;
      if (image) await writeFile(join(folder, imageFile), image.bytes);
      const result = await cli(this.config, ['docs', '+create', '--as', 'user', '--doc-format', 'xml', '--parent-token', this.config.folderToken, '--content', '-'], body, folder);
      if (result.warnings?.length) throw new Error(`飞书文档创建带有警告，请检查目录中的文档：${result.warnings.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('；')}`);
      const doc = result.document;
      if (!doc?.document_id || !doc.url) throw new Error('未取得文档标识，请先核对体验目录。');
      const readback = await this.readDocument(doc.document_id);
      return { id: doc.document_id, url: doc.url, statusLabel: statusLabel || null, fingerprint: statusLabel ? documentHash(readback, statusLabel) : hash(readback.content), revision: readback.revision_id };
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  async readDocument(id) {
    const result = await cli(this.config, ['docs', '+fetch', '--as', 'user', '--doc', id, '--doc-format', 'xml', '--detail', 'full']);
    if (!result.document?.content || result.document.content.includes('<fragment')) throw new Error('文档读取不完整。');
    return result.document;
  }
  async verify(note) {
    const doc = await this.readDocument(note.external.id);
    if (documentHash(doc, note.external.statusLabel) !== note.external.fingerprint) throw new Error('飞书文档已修改。原型不会批准旧内容，请将修订内容生成新版本后重新审核。');
    return doc;
  }
  async markReview(note, approved) {
    const before = await this.verify(note);
    if (!Number.isInteger(Number(before.revision_id)) || Number(before.revision_id) < 0) throw new Error('未取得文档修订号，暂不能提交审核标识。');
    const label = `24PA原型 ${note.id} v${note.version}：${approved ? '已由本人审核通过' : '已由本人退回'}；仅覆盖指纹 ${note.hash.slice(0,16)} 的保存版本；当前正文有效性以24PA核验为准；核对时间 ${new Date().toISOString()}`;
    await cli(this.config, ['docs', '+update', '--as', 'user', '--doc', note.external.id, '--command', 'str_replace', '--pattern', note.external.statusLabel, '--content', label, '--doc-format', 'xml', '--revision-id', String(before.revision_id)]);
    const after = await this.readDocument(note.external.id);
    if (documentHash(after, label) !== note.external.fingerprint) throw new Error('标识更新时内容发生变化，审核未提交；请重新核对文档。');
    return { ...note.external, statusLabel: label, revision: after.revision_id };
  }
}
