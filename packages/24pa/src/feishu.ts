import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PaConfig } from './config.js';
import { runLarkCli, type LarkCliOptions } from './lark.js';

// Feishu transport seam: production uses the official SDK long connection;
// tests inject events through the same inbound path without a network. The
// gateway handler must finish its durable write before resolving, because
// the SDK waits for the handler before acknowledging the platform.

export interface InboundEvent {
  eventId: string;
  appId: string;
  tenantKey: string;
  kind: 'message' | 'card';
  senderOpenId: string;
  chatType?: string;
  chatId?: string;
  messageId?: string;
  messageType?: string;
  text?: string;
  imageKey?: string;
  fileKey?: string;
  fileName?: string;
  parentMessageId?: string;
  cardAction?: { value?: Record<string, unknown>; message?: string };
}

export interface FeishuTransport {
  readonly name: string;
  start(onEvent: (event: InboundEvent) => Promise<void>): Promise<void>;
  sendText(openId: string, text: string, uuid: string): Promise<{ messageId: string }>;
  sendCard(openId: string, card: unknown, uuid: string): Promise<{ messageId: string }>;
  downloadImage(messageId: string, imageKey: string, type?: 'image' | 'file'): Promise<Buffer>;
  close(): Promise<void>;
}

export function cliOptions(config: PaConfig, bin: string, timeoutMs: number): LarkCliOptions {
  return { bin, profile: config.larkProfile, timeoutMs };
}

export class SdkFeishuTransport implements FeishuTransport {
  readonly name = 'sdk-ws';
  private client: any = null;
  private ws: any = null;

  constructor(private readonly appId: string, private readonly appSecret: string) {}

  async start(onEvent: (event: InboundEvent) => Promise<void>): Promise<void> {
    const sdk = await import('@larksuiteoapi/node-sdk');
    const options = { appId: this.appId, appSecret: this.appSecret, domain: sdk.Domain.Feishu, loggerLevel: sdk.LoggerLevel.error };
    this.client = new sdk.Client(options);
    this.ws = new sdk.WSClient(options);
    const dispatcher = new sdk.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        const event = mapMessageEvent(data);
        if (event) await onEvent(event);
      },
      'card.action.trigger': async (data: any) => {
        const event = mapCardEvent(data);
        if (event) await onEvent(event);
        return { toast: { type: 'info', content: '已收到，正在核验；请以稍后的结果通知为准。' } };
      },
    });
    await this.ws.start({ eventDispatcher: dispatcher });
  }

  private assertClient(): any {
    if (!this.client) throw new Error('飞书连接尚未启动。');
    return this.client;
  }

  async sendText(openId: string, text: string, uuid: string): Promise<{ messageId: string }> {
    const result = await this.assertClient().im.message.create({
      params: { receive_id_type: 'open_id' },
      data: { receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }), uuid },
    });
    if (result.code !== 0 || !result.data?.message_id) throw new Error(`飞书未确认消息发送：${result.msg || result.code}`);
    return { messageId: result.data.message_id as string };
  }

  async sendCard(openId: string, card: unknown, uuid: string): Promise<{ messageId: string }> {
    const result = await this.assertClient().im.message.create({
      params: { receive_id_type: 'open_id' },
      data: { receive_id: openId, msg_type: 'interactive', content: JSON.stringify(card), uuid },
    });
    if (result.code !== 0 || !result.data?.message_id) throw new Error(`飞书未确认卡片发送：${result.msg || result.code}`);
    return { messageId: result.data.message_id as string };
  }

  async downloadImage(messageId: string, imageKey: string, type: 'image' | 'file' = 'image'): Promise<Buffer> {
    const response = await this.assertClient().im.messageResource.get({
      path: { message_id: messageId, file_key: imageKey },
      params: { type },
    });
    const chunks: Buffer[] = [];
    for await (const chunk of response.getReadableStream()) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async close(): Promise<void> {
    this.ws?.close({ force: true });
    this.ws = null;
    this.client = null;
  }
}

function mapMessageEvent(data: any): InboundEvent | null {
  const header = data?.header ?? {};
  const event = data?.event ?? data;
  const message = event?.message;
  const sender = event?.sender?.sender_id;
  if (!message?.message_id || !sender?.open_id) return null;
  let text: string | undefined;
  let imageKey: string | undefined;
  let fileKey: string | undefined;
  let fileName: string | undefined;
  if (message.message_type === 'text') {
    try {
      text = String(JSON.parse(message.content ?? '{}').text ?? '');
    } catch {
      text = '';
    }
  } else if (message.message_type === 'image') {
    try {
      imageKey = String(JSON.parse(message.content ?? '{}').image_key ?? '');
    } catch {
      imageKey = '';
    }
  } else if (message.message_type === 'file') {
    try {
      const parsed = JSON.parse(message.content ?? '{}');
      fileKey = String(parsed.file_key ?? '');
      fileName = String(parsed.file_name ?? '');
    } catch {
      fileKey = '';
    }
  }
  return {
    eventId: String(header.event_id ?? message.message_id),
    appId: String(header.app_id ?? ''),
    tenantKey: String(header.tenant_key ?? ''),
    kind: 'message',
    senderOpenId: String(sender.open_id),
    chatType: message.chat_type,
    chatId: message.chat_id ? String(message.chat_id) : undefined,
    messageId: String(message.message_id),
    messageType: String(message.message_type ?? ''),
    text,
    imageKey,
    fileKey,
    fileName,
    parentMessageId: message.parent_id ? String(message.parent_id) : undefined,
  };
}

function mapCardEvent(data: any): InboundEvent | null {
  const header = data?.header ?? {};
  const operator = data?.operator ?? data?.event?.operator;
  const action = data?.action ?? data?.event?.action;
  const context = data?.context ?? data?.event?.context;
  if (!operator?.open_id) return null;
  return {
    eventId: String(header.event_id ?? randomUUID()),
    appId: String(header.app_id ?? ''),
    tenantKey: String(header.tenant_key ?? ''),
    kind: 'card',
    senderOpenId: String(operator.open_id),
    messageId: context?.open_message_id ? String(context.open_message_id) : undefined,
    chatId: context?.open_chat_id ? String(context.open_chat_id) : undefined,
    cardAction: { value: action?.value, message: context?.open_message_id ? String(context.open_message_id) : undefined },
  };
}

// ---- Read-only access diagnostics (P41) ----------------------------------
// On-demand only; a page refresh shows stored results and never calls Feishu.

const exec = promisify(execFile);
type CheckState = 'ok' | 'unchecked' | 'missing' | 'unbound' | 'mismatch' | 'unverified' | 'error' | 'changed';
const status = (state: CheckState, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ state, message, ...extra });

function safeError(error: unknown, config: PaConfig): string {
  let message = String((error as Error)?.message ?? error);
  for (const name of [config.appIdEnv, config.appSecretEnv]) {
    const secret = process.env[name];
    if (secret) message = message.split(secret).join('[已隐藏]');
  }
  return message.replace(/(?:access_token|refresh_token|app_secret|authorization)\s*[=:]\s*\S+/gi, '凭据=[已隐藏]').slice(0, 500);
}

async function resolveExecutable(bin: string): Promise<string> {
  const paths = bin.includes('/') ? [resolve(bin)] : (process.env.PATH || '').split(delimiter).map(dir => join(dir, bin));
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      return await realpath(path);
    } catch {
      // try next PATH entry
    }
  }
  throw new Error('找不到可执行的 lark-cli；请在服务器安装并加入启动进程的 PATH。');
}

export interface AccessDiagnostics {
  checkedAt: string;
  source: Record<string, unknown> | null;
  cli: Record<string, unknown> | null;
  auth: Record<string, unknown>;
  resources: Record<string, unknown>[];
  /** Wizard navigation: what to do next, derived from the states above (guide anchors included). */
  nextSteps: string[];
}

/** Authorization domain set for the user identity login (guide·阶段 2). */
const LARK_AUTH_DOMAINS = 'im,task,calendar,docs,drive';

/**
 * Map diagnostic states to the concrete next actions from feishu-setup.md.
 * Pure on (config, diagnostics) so tests can drive every branch directly;
 * order follows the guide's stage sequence.
 */
export function setupNextSteps(config: PaConfig, result: Omit<AccessDiagnostics, 'nextSteps'>): string[] {
  const steps: string[] = [];
  const stateOf = (block: Record<string, unknown> | null): string | undefined =>
    block == null ? undefined : String(block.state ?? '');
  if (stateOf(result.cli) === 'error') {
    steps.push('lark-cli 不可执行：在服务器安装并加入 dsh 宿主进程的 PATH（指南·阶段 0）；改完重启宿主。');
    return steps;
  }
  const source = stateOf(result.source);
  if (source === 'changed') {
    steps.push('AGENTS.md 已修改未重载：本地24私助会话执行 pa24_workspace action=reload（指南·阶段 4）。');
  } else if (source === 'error') {
    steps.push('AGENTS.md 读取失败：检查工作区文件与权限后重试（指南·阶段 0/4）；该错误未解决前检查结果不完整。');
  }
  const auth = stateOf(result.auth);
  const user = (result.auth as Record<string, unknown>) ?? {};
  if (auth === 'missing') {
    steps.push(
      `固定 profile（${config.larkProfile}）尚无用户授权：发起 lark-cli auth login --no-wait --json --profile ${config.larkProfile} --domain ${LARK_AUTH_DOMAINS}，把验证链接交给本人在浏览器完成，再用 --device-code 收尾（指南·阶段 2）。`,
    );
  } else if (auth === 'unbound') {
    steps.push(`ownerOpenId 未绑定：把 auth status 返回的 user.openId（当前为 ${String(user.openId ?? '未知')}）填入 AGENTS.md（指南·阶段 3/4）。`);
  } else if (auth === 'mismatch') {
    steps.push('CLI 授权用户与配置主人不一致：本人重新 lark-cli auth login，或确认后把 ownerOpenId 改为实际授权用户（指南·阶段 2/4）。');
  } else if (auth === 'unverified') {
    steps.push('用户令牌有效性未确认：重新 lark-cli auth login 刷新令牌后复查（指南·阶段 2）。');
  } else if (auth === 'error') {
    steps.push('auth status --verify 失败：按指南·阶段 6「auth error」行处置（config show 核对应用配置与网络，必要时由本人重新 config init）。');
  }
  for (const resource of result.resources) {
    if (String(resource.state) === 'missing') {
      const where = resource.id === 'folder' ? 'folderToken（飞书云文档文件夹链接复制 token）' : resource.id === 'tasklist' ? 'tasklistId（飞书任务清单链接复制 guid）' : 'calendarId';
      steps.push(`${String(resource.label)}未配置：获取 ${where} 并填入 AGENTS.md（指南·阶段 3）。`);
    } else if (String(resource.state) === 'error') {
      steps.push(`${String(resource.label)}读取失败：多为权限点未开通或应用未发布新版本；对照指南·阶段 1 的权限清单并重新发布。`);
    }
  }
  // All-clear needs every block healthy: a source error above must not be
  // reported as "接入就绪" just because auth and resources passed.
  if (steps.length === 0 && auth === 'ok' && source !== 'error') {
    steps.push(
      config.mode === 'feishu'
        ? '接入检查全部通过：若面板 readiness 的 feishu 项未显示长连接已启动，按指南·阶段 4 重启宿主；随后在飞书发送 /24pa 做端到端验证（指南·阶段 5）。'
        : `接入前置全部就绪：由本人在启动环境填写 ${config.appIdEnv}/${config.appSecretEnv}，你把 AGENTS.md mode 改为 feishu 并重启宿主（指南·阶段 4），再按阶段 5 验收。`,
    );
  }
  return steps;
}

export async function inspectAccess(
  config: PaConfig,
  bin: string,
  workspace: { path: string; sourceHash: string },
): Promise<AccessDiagnostics> {
  const collected = await collectAccess(config, bin, workspace);
  return { ...collected, nextSteps: setupNextSteps(config, collected) };
}

async function collectAccess(
  config: PaConfig,
  bin: string,
  workspace: { path: string; sourceHash: string },
): Promise<Omit<AccessDiagnostics, 'nextSteps'>> {
  const result: Omit<AccessDiagnostics, 'nextSteps'> = {
    checkedAt: new Date().toISOString(),
    source: null,
    cli: null,
    auth: status('unchecked', '尚未检查'),
    resources: [],
  };
  const resources: [string, string, string, string[]][] = [
    ['folder', '文档目录', config.folderToken, ['drive', 'files', 'list', '--folder-token', config.folderToken, '--page-size', '1']],
    ['tasklist', '任务清单', config.tasklistId, ['task', 'tasklists', 'get', '--tasklist-guid', config.tasklistId]],
    ['calendar', '本人日历', config.calendarId, config.calendarId === 'primary' ? ['calendar', 'calendars', 'primary'] : ['calendar', 'calendars', 'get', '--calendar-id', config.calendarId]],
  ];
  result.resources = resources.map(([id, label, value]) => ({ id, label, value, ...status(value ? 'unchecked' : 'missing', value ? '未检查可读性' : '未配置') }));
  try {
    const file = await readFile(join(workspace.path, 'AGENTS.md'), 'utf8');
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(file).digest('hex');
    result.source = hash === workspace.sourceHash ? status('ok', '文件与当前生效版本一致') : status('changed', '文件已修改，尚未重载；下方仍显示当前生效配置');
  } catch (error) {
    result.source = status('error', safeError(error, config));
  }
  try {
    const path = await resolveExecutable(bin);
    const { stdout } = await exec(path, ['--version'], {
      timeout: 5000,
      maxBuffer: 16384,
      env: { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' },
    });
    result.cli = status('ok', 'CLI 可执行', { path, version: stdout.trim().slice(0, 100) });
  } catch (error) {
    result.cli = status('error', safeError(error, config));
    return result;
  }
  const readOptions = cliOptions(config, bin, 10000);
  try {
    const { data } = await runLarkCli(readOptions, ['auth', 'status', '--verify']);
    const user = data?.identities?.user;
    const matched = !!config.ownerOpenId && user?.openId === config.ownerOpenId;
    const verified = data?.verified === true && user?.tokenStatus === 'valid';
    result.auth = status(
      !user?.openId ? 'missing' : !config.ownerOpenId ? 'unbound' : !matched ? 'mismatch' : verified ? 'ok' : 'unverified',
      !user?.openId
        ? '固定 profile 尚无用户授权'
        : !config.ownerOpenId
          ? '已有 CLI 身份；工作区尚未绑定主人'
          : !matched
            ? 'CLI 用户与配置主人不一致，未读取资源'
            : verified
              ? 'CLI 用户令牌有效，身份与主人一致'
              : '身份匹配，但令牌有效性未确认',
      { profile: config.larkProfile, userName: user?.userName ?? null, openId: user?.openId ?? null, verified, matched, tokenStatus: user?.tokenStatus ?? null },
    );
    if (!matched || !verified) return result;
    result.resources = await Promise.all(
      resources.map(async ([id, label, value, args]) => {
        if (!value) return { id, label, value, ...status('missing', '未配置') };
        try {
          await runLarkCli(readOptions, [...args, '--as', 'user']);
          return { id, label, value, ...status('ok', '读取接口成功；写入权限由实际任务回执验证') };
        } catch (error) {
          return { id, label, value, ...status('error', safeError(error, config)) };
        }
      }),
    );
  } catch (error) {
    result.auth = status('error', safeError(error, config), { profile: config.larkProfile });
  }
  return result;
}
