import { randomBytes } from 'node:crypto';

export const PROTOCOL = Object.freeze({
  commit: '874637a0dbc24050f72d1385add4fc6170a2d726',
  version: '2.4.10', clientVersion: '132106', appId: 'bot',
});
export const DEFAULT_BASE = 'https://ilinkai.weixin.qq.com';
const ID_FIELDS = new Set(['message_id', 'msg_id', 'svr_id']);

// Node's source-aware reviver preserves uint64 identifiers before Number rounding.
export function parseWire(text) {
  return JSON.parse(text, (key, value, context) => {
    if (!ID_FIELDS.has(key) || typeof value !== 'number') return value;
    if (!context?.source || !/^\d+$/.test(context.source)) throw new Error('invalid_wire_id');
    return context.source;
  });
}

export function apiBase(value = DEFAULT_BASE) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !url.hostname.endsWith('.weixin.qq.com') || !['', '/'].includes(url.pathname) ||
      url.search || url.hash) throw new Error('untrusted_api_base');
  return url.origin;
}

export function headers(token, method = 'POST') {
  const result = { 'iLink-App-Id': PROTOCOL.appId, 'iLink-App-ClientVersion': PROTOCOL.clientVersion };
  if (method === 'POST') {
    Object.assign(result, {
      'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),
    });
    if (token) result.Authorization = `Bearer ${token}`;
  }
  return result;
}

export function withBaseInfo(body) {
  return { ...body, base_info: { channel_version: PROTOCOL.version, bot_agent: '24PA-Probe/0.1.0' } };
}

export function receipt(response) {
  const data = response.data;
  const codes = {};
  for (const key of ['ret', 'errcode']) {
    if (Number.isSafeInteger(data?.[key])) codes[key] = data[key];
  }
  const isObject = data !== null && typeof data === 'object' && !Array.isArray(data);
  const shape = { kind: data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data };
  if (isObject) Object.assign(shape, { keyCount: Object.keys(data).length,
    retType: typeof data.ret, errcodeType: typeof data.errcode, messageIdType: typeof data.message_id });
  const errors = ['invalid_response', 'cancelled', 'network_or_timeout', 'body_read_or_timeout', 'response_too_large', 'transport_unknown'];
  const base = { http: response.http ?? null, ...codes, shape,
    ...(errors.includes(response.error) ? { error: response.error } : {}) };
  if (response.http < 200 || response.http >= 300 || !response.http || !data ||
      typeof data !== 'object' || Array.isArray(data)) return { ...base, status: 'unknown' };
  if (Number.isSafeInteger(data.ret) && data.ret !== 0 ||
      Number.isSafeInteger(data.errcode) && data.errcode !== 0) return { ...base, status: 'rejected' };
  if (data.ret !== 0 || (data.errcode !== undefined && data.errcode !== 0)) return { ...base, status: 'unknown' };
  const nativeId = typeof data.message_id === 'string' && /^[1-9]\d*$/.test(data.message_id)
    ? data.message_id : undefined;
  return { ...base, status: 'accepted', ...(nativeId ? { nativeId } : {}) };
}

// Read success has its own contract. The observed getupdates envelope omits zero error codes.
// This does not relax sendmessage acknowledgement: an empty send response remains unknown.
export function updatesResult(response) {
  const observation = receipt(response);
  const d = response.data;
  if (observation.status === 'rejected') return observation;
  if (!response.http || response.http < 200 || response.http >= 300 || !d || Array.isArray(d) ||
      typeof d !== 'object' || !Array.isArray(d.msgs) || typeof d.get_updates_buf !== 'string' ||
      d.ret !== undefined && d.ret !== 0 || d.errcode !== undefined && d.errcode !== 0 ||
      d.sync_buf !== undefined && typeof d.sync_buf !== 'string' ||
      d.ret === undefined && d.errmsg !== undefined && d.errmsg !== '') return { ...observation, status: 'unknown' };
  return { ...observation, status: 'read_success',
    basis: d.ret === 0 ? 'explicit_zero_and_update_envelope' : 'observed_update_envelope_without_error_codes' };
}

export async function request(endpoint, { base = DEFAULT_BASE, token, body, signal, timeout = 15_000, fetcher = fetch } = {}) {
  const method = body === undefined ? 'GET' : 'POST';
  const url = new URL(endpoint, `${apiBase(base)}/`);
  if (url.origin !== apiBase(base) || !url.pathname.startsWith('/ilink/bot/')) throw new Error('invalid_endpoint');
  let http = null;
  try {
    const res = await fetcher(url, {
      method, headers: headers(token, method), redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
    });
    http = res.status;
    const chunks = []; let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new Error('response_too_large');
      chunks.push(chunk);
    }
    try { return { http: res.status, data: parseWire(Buffer.concat(chunks).toString('utf8')) }; }
    catch { return { http: res.status, error: 'invalid_response' }; }
  } catch (error) {
    // A socket error or abort is not evidence that a send failed before dispatch.
    return { http, error: signal?.aborted ? 'cancelled' : error?.message === 'response_too_large'
      ? 'response_too_large' : http ? 'body_read_or_timeout' : 'network_or_timeout' };
  }
}

export function admit(message, identity, challenge) {
  const m = message && typeof message === 'object' ? message : {};
  const stable = typeof m.message_id === 'string' && /^[1-9]\d*$/.test(m.message_id);
  if (!identity.owner || !identity.bot || m.from_user_id !== identity.owner || m.to_user_id !== identity.bot ||
      m.group_id || m.message_type !== 1) return { reason: 'identity_or_group', id: stable ? m.message_id : null };
  if (!stable) return { reason: 'missing_message_id', id: null };
  if (!Array.isArray(m.item_list) || m.item_list.length !== 1 || m.item_list[0]?.type !== 1 ||
      m.item_list[0]?.text_item?.text !== challenge) return { reason: 'outside_test_scope', id: m.message_id };
  if (typeof m.context_token !== 'string' || !m.context_token) return { reason: 'missing_context', id: m.message_id };
  return { reason: 'test_input', id: m.message_id, context: m.context_token };
}
