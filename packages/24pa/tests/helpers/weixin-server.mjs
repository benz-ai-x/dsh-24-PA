import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
export async function startWeixinServer() {
  const messages = [], sent = [], calls = [];
  const state = { bot: 'wx-test-bot', owner: 'wx-test-owner', sendMode: 'native', invalidToken: false };
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : null, endpoint = new URL(req.url, 'http://localhost').pathname;
    calls.push({ endpoint, body });
    res.setHeader('content-type', 'application/json');
    if (endpoint.endsWith('/get_bot_qrcode')) return res.end(JSON.stringify({ qrcode: 'isolated-code', qrcode_img_content: 'https://weixin.qq.com/test-only' }));
    if (endpoint.endsWith('/get_qrcode_status')) return res.end(JSON.stringify({ status: 'confirmed', bot_token: 'test-private-token', ilink_bot_id: state.bot, ilink_user_id: state.owner, baseurl: 'https://ilinkai.weixin.qq.com' }));
    if (state.invalidToken) return res.end(JSON.stringify({ ret: -14 }));
    if (endpoint.endsWith('/getupdates')) {
      await delay(150);
      return res.end(JSON.stringify({ msgs: messages.slice(Number(body.get_updates_buf || 0)), get_updates_buf: String(messages.length) }));
    }
    if (endpoint.endsWith('/sendmessage')) {
      sent.push(structuredClone(body.msg));
      return res.end(JSON.stringify(state.sendMode === 'unknown' ? {} : state.sendMode === 'no-id' ? { ret: 0 } : { message_id: String(9876543210987654321n + BigInt(sent.length)) }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { state, calls, sent, messages, url: `http://127.0.0.1:${server.address().port}`,
    input(text, extra = {}) {
      const row = { from_user_id: state.owner, to_user_id: state.bot, message_id: String(18446744073709550000n + BigInt(messages.length)),
        message_type: 1, message_state: 2, context_token: `test-private-context-${messages.length}`,
        item_list: [{ type: 1, text_item: { text } }], ...extra };
      messages.push(row); return row;
    },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
