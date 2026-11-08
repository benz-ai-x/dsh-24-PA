import { randomBytes } from 'node:crypto';

/** iLink contract pinned to Tencent/openclaw-weixin 874637a (2.4.10).
 * Wire values never escape this module into logs or business persistence. */
export const WEIXIN_PROTOCOL = { version: '2.4.10', clientVersion: '132106', appId: 'bot' } as const;
export const WEIXIN_API_BASE = 'https://ilinkai.weixin.qq.com';
export type WireObject = Record<string, unknown>;
export interface WeixinResponse { http: number | null; data?: WireObject; error?: string }
export interface WeixinRequest {
  base?: string; token?: string; body?: WireObject; signal?: AbortSignal; timeout?: number;
}
export type WeixinRequestFn = (endpoint: string, options?: WeixinRequest) => Promise<WeixinResponse>;
export interface WeixinAcceptance {
  basis: 'explicit_zero' | 'native_message_id' | 'owner_visible';
  http?: number; ret?: number; errcode?: number; at: string;
}
export interface WeixinSendReceipt { messageId?: string; acceptance: WeixinAcceptance }

export function weixinApiBase(value = WEIXIN_API_BASE): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !url.hostname.endsWith('.weixin.qq.com') || !['', '/'].includes(url.pathname) ||
      url.search || url.hash) throw new Error('微信接口地址不受信任。');
  return url.origin;
}
const object = (value: unknown): value is WireObject => !!value && typeof value === 'object' && !Array.isArray(value);
export const weixinNativeId = (value: unknown): string | null => typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;

export function parseWeixinWire(text: string): WireObject {
  const data: unknown = JSON.parse(text, (key: string, value: unknown, context?: { source: string }) => {
    if (!['message_id', 'msg_id', 'svr_id'].includes(key) || typeof value !== 'number') return value;
    if (!context?.source || !/^\d+$/.test(context.source)) throw new Error('微信消息标识无法无损读取。');
    return context.source;
  });
  if (!object(data)) throw new Error('微信响应格式无法确认。');
  return data;
}

/** Errors deliberately contain no platform text, URLs, request bodies or tokens. */
export class WeixinProtocolError extends Error {
  constructor(message: string, readonly outcome: 'failed' | 'unknown', readonly needsLogin = false) { super(message); }
}
function checkResponse(response: WeixinResponse): WireObject {
  const { data, http } = response;
  if (!http || http < 200 || http >= 300 || !data) throw new WeixinProtocolError('微信响应未确认，请先核对投递。', 'unknown');
  for (const key of ['ret', 'errcode']) {
    const code = data[key];
    if (code !== undefined && (!Number.isSafeInteger(code) || typeof code !== 'number')) {
      throw new WeixinProtocolError('微信业务返回码格式无法确认。', 'unknown');
    }
    if (typeof code === 'number' && code !== 0) {
      throw new WeixinProtocolError(code === -14 ? '微信凭据已失效，请在电脑端重新登录。' : '微信明确拒绝本次请求。', 'failed', code === -14);
    }
  }
  return data;
}
export function weixinSendReceipt(response: WeixinResponse): WeixinSendReceipt {
  const data = checkResponse(response), messageId = weixinNativeId(data.message_id);
  // Official send.test.ts explicitly accepts {message_id: uint64-string} with no ret.
  // An empty object or a client-generated ID is not an acknowledgement.
  if (data.ret !== 0 && (!messageId || (data.errmsg !== undefined && data.errmsg !== ''))) {
    throw new WeixinProtocolError('微信未返回可核验的接纳依据，请先核对投递。', 'unknown');
  }
  return { ...(messageId ? { messageId } : {}), acceptance: {
    basis: data.ret === 0 ? 'explicit_zero' : 'native_message_id', http: response.http!,
    ...(data.ret === 0 ? { ret: 0 } : {}), ...(data.errcode === 0 ? { errcode: 0 } : {}), at: new Date().toISOString(),
  } };
}
export function weixinUpdates(response: WeixinResponse): { messages: unknown[]; cursor: string } {
  const data = checkResponse(response);
  if (!Array.isArray(data.msgs) || typeof data.get_updates_buf !== 'string' ||
      data.ret === undefined && data.errmsg !== undefined && data.errmsg !== '') {
    throw new WeixinProtocolError('微信收信响应格式无法确认，游标未推进。', 'unknown');
  }
  return { messages: data.msgs, cursor: data.get_updates_buf };
}

export function createWeixinRequest(fetcher: typeof fetch = fetch): WeixinRequestFn {
  return async (endpoint, options = {}) => {
    const base = weixinApiBase(options.base), url = new URL(endpoint, `${base}/`);
    if (url.origin !== base || !url.pathname.startsWith('/ilink/bot/')) throw new Error('微信接口路径无效。');
    const method = options.body === undefined ? 'GET' : 'POST';
    const headers: Record<string, string> = { 'iLink-App-Id': WEIXIN_PROTOCOL.appId, 'iLink-App-ClientVersion': WEIXIN_PROTOCOL.clientVersion };
    if (method === 'POST') Object.assign(headers, {
      'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    });
    let http: number | null = null;
    try {
      const response = await fetcher(url, { method, headers, redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(options.timeout ?? 15_000), ...(options.signal ? [options.signal] : [])]),
        ...(options.body === undefined ? {} : { body: JSON.stringify({ ...options.body,
          ...(url.pathname.endsWith('/get_bot_qrcode') ? {} : { base_info: { channel_version: WEIXIN_PROTOCOL.version, bot_agent: '24PA' } }) }) }),
      });
      http = response.status;
      const chunks: Uint8Array[] = []; let size = 0;
      if (!response.body) return { http, error: 'missing_body' };
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 1024 * 1024) return { http, error: 'response_too_large' };
        chunks.push(chunk);
      }
      return { http, data: parseWeixinWire(Buffer.concat(chunks).toString('utf8')) };
    } catch { return { http, error: options.signal?.aborted ? 'cancelled' : 'transport_or_response_unknown' }; }
  };
}

export interface WeixinIdentity { accountId: string; ownerId: string; generation: string; sessionId: string }
export const sameWeixinIdentity = (a: WeixinIdentity, b: WeixinIdentity): boolean => a.accountId === b.accountId && a.ownerId === b.ownerId && a.generation === b.generation && a.sessionId === b.sessionId;
export interface WeixinEnvelope extends WeixinIdentity {
  nativeId: string | null; text: string; replyTo: string | null; rejection: string | null;
}
/** Allowlist before persistence. Tokens stay in the separate credential vault. */
export function weixinEnvelope(value: unknown, identity: WeixinIdentity): { envelope: WeixinEnvelope; context?: string } {
  const raw = object(value) ? value : {};
  const envelope: WeixinEnvelope = { ...identity, nativeId: weixinNativeId(raw.message_id), text: '', replyTo: null, rejection: null };
  if (raw.from_user_id !== identity.ownerId || raw.to_user_id !== identity.accountId || raw.group_id || raw.session_id || raw.message_type !== 1) {
    envelope.rejection = '非已绑定主人的私聊消息'; return { envelope };
  }
  if (!envelope.nativeId) { envelope.rejection = '缺少可靠原消息标识，已隔离'; return { envelope }; }
  if (raw.message_state !== 2) { envelope.rejection = '消息尚未完整结束'; return { envelope }; }
  const items = Array.isArray(raw.item_list) ? raw.item_list : [];
  const texts = items.filter(object).filter(item => item.type === 1 && object(item.text_item) && typeof item.text_item.text === 'string');
  const text = texts.map(item => (item.text_item as { text: string }).text).join('\n');
  if (items.length !== texts.length || !text.trim() || text.length > 32_000) envelope.rejection = '首版仅支持私聊文字，请发送文字或明确事项编号';
  else envelope.text = text;
  // Native quote shapes are not sufficiently verified. Explicit WorkItem IDs remain supported.
  return { envelope, ...(typeof raw.context_token === 'string' && raw.context_token ? { context: raw.context_token } : {}) };
}

/** 4000 is the pinned upstream client limit, not a claimed server quota. */
export function splitWeixinText(text: string, limit = 4000): string[] {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('微信分段上限无效。');
  const chunks: string[] = []; let chunk = '';
  for (const char of text) {
    if (chunk.length + char.length > limit) { chunks.push(chunk); chunk = ''; }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
