// A DeepSeek-Messages-compatible SSE endpoint for tests. The real dsh
// llm-deepseek adapter points at it via DEEPSEEK_BASE_URL, so sessions, tool
// dispatch and the agent loop all run for real; only the model is scripted.
//
// Two script modes, re-read from the script file before every request:
//  - steps: [{tool?, text?}] popped in order (single-session flows);
//  - dispatch: behavior derived from the request itself, so Lead and Worker
//    sessions interleave deterministically:
//      delegate tools present + no tool_result -> tool_use pa24_delegate
//      delegate tools + tool_result            -> leadReply text
//      pa24_work tools + no tool_result        -> workerAction tool_use
//      pa24_work tools + tool_result           -> workerReply text
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};

export async function startMockLlm({ scriptPath, logPath }) {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/messages')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const tools = (body.tools ?? []).map(t => t.name);
    const toolResults = (body.messages ?? [])
      .flatMap(m => (m.role === 'user' ? m.content ?? [] : []))
      .filter(b => b.type === 'tool_result')
      .map(b => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '')));
    const lastUserText = (body.messages ?? [])
      .filter(m => m.role === 'user')
      .flatMap(m => m.content ?? [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .slice(-2000);
    requests.push({ at: new Date().toISOString(), model: body.model, tools, toolResults, lastUserText });
    await writeFile(logPath, JSON.stringify(requests, null, 2)).catch(() => {});

    const script = await readJson(scriptPath, {});
    let step;
    if (script.mode === 'dispatch') {
      // Classify by the LAST message only: a request whose last message
      // carries tool_result blocks continues an in-flight turn; native
      // settlement notices ("Background subagent ... finished") and the
      // host's item-return messages must be answered with a report, never
      // re-delegated. Earlier history must not leak into these decisions.
      const last = (body.messages ?? []).at(-1);
      const isContinuation =
        last?.role === 'user' && (last.content ?? []).some(b => b.type === 'tool_result');
      const lastText = last?.role === 'user'
        ? (last.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n')
        : '';
      const isNotice = lastText.includes('Background subagent') || lastText.includes('[事项回传]');
      if (isNotice) {
        step = { text: script.leadReport ?? '事项已有结果，已记录并汇报。' };
      } else if (tools.includes('pa24_delegate')) {
        step = isContinuation ? { text: script.leadReply ?? '已安排。' } : { tool: { name: 'pa24_delegate', input: script.delegate } };
      } else if (tools.includes('pa24_work')) {
        step = isContinuation ? { text: script.workerReply ?? '已完成。' } : { tool: { name: 'pa24_work', input: script.workerAction } };
      } else {
        step = { text: script.defaultReply ?? '（mock 默认回复）' };
      }
    } else {
      const index = script.nextIndex ?? 0;
      step = (script.steps ?? [])[index] ?? { text: '（mock 默认回复）' };
      script.nextIndex = index + 1;
      await writeFile(scriptPath, JSON.stringify(script, null, 2)).catch(() => {});
    }
    const turn = requests.length;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const send = payload => res.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
    send({ type: 'message_start', message: { id: `msg_mock_${turn}`, type: 'message', role: 'assistant', model: body.model ?? 'mock', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
    let blockIndex = 0;
    if (step.tool) {
      send({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: `toolu_mock_${turn}`, name: step.tool.name, input: {} } });
      send({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.tool.input ?? {}) } });
      send({ type: 'content_block_stop', index: blockIndex });
      blockIndex += 1;
    }
    const text = step.text ?? '';
    if (text) {
      send({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } });
      send({ type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text } });
      send({ type: 'content_block_stop', index: blockIndex });
    }
    send({ type: 'message_delta', delta: { stop_reason: step.tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } });
    send({ type: 'message_stop' });
    res.end();
  });
  await new Promise(resolveListening => {
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolveListening);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    get log() {
      return requests;
    },
    async close() {
      await new Promise(resolveClosed => server.close(resolveClosed));
    },
  };
}
