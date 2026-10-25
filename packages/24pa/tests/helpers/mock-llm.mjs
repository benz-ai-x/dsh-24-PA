// A DeepSeek-Messages-compatible SSE endpoint for tests. The real dsh
// llm-deepseek adapter points at it via DEEPSEEK_BASE_URL, so sessions, tool
// dispatch and the agent loop all run for real; only the model is scripted.
//
// Two script modes, re-read from the script file before every request:
//  - steps: [{tool?, text?}] in one or independently keyed sequences;
//  - dispatch: behavior derived from the request itself, so Lead and Worker
//    sessions interleave deterministically:
//      delegate tools present + no tool_result -> tool_use pa24_delegate
//      delegate tools + tool_result            -> leadReply text
//      pa24_work tools + no tool_result        -> workerAction tool_use
//      pa24_work tools + tool_result           -> workerReply text
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = async (path, value) => {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
};

export async function startMockLlm({ scriptPath, logPath, recordInputs = false, sequenceKey }) {
  const requests = [];
  let scriptQueue = Promise.resolve(), logQueue = Promise.resolve();
  const updateScript = change => {
    const operation = scriptQueue.then(async () => {
      const script = await readJson(scriptPath, {});
      const { value, changed } = await change(script);
      if (changed) await writeJson(scriptPath, script);
      return value;
    });
    scriptQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };
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
    const images = (body.messages ?? [])
      .flatMap(m => (Array.isArray(m.content) ? m.content : []))
      .filter(b => b.type === 'image' && b.source?.type === 'base64')
      .length;
    const lastUserText = (body.messages ?? [])
      .filter(m => m.role === 'user')
      .flatMap(m => m.content ?? [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .slice(-2000);
    requests.push({ at: new Date().toISOString(), model: body.model, tools, toolResults, images, lastUserText,
      ...(recordInputs ? { inputs: (body.messages ?? []).filter(message => message.role === 'user') } : {}) });
    logQueue = logQueue.then(() => writeJson(logPath, requests)).catch(() => {});
    await logQueue;

    const sequence = sequenceKey?.(body);
    const step = await updateScript(script => {
      const selected = sequence ? script.sequences?.[sequence] : script;
      let step, changed = false;
      if (script.onlySkillRuns && !(body.messages ?? []).some(message => (message.content ?? []).some(part => part.type === 'text' && /^\[24PA skill run: [^\]]+\]$/.test(part.text)))) {
        // The real manager may notify a parent independently of the owned Run.
        // Parent acknowledgement must not consume that Run's scripted sequence.
        step = { text: '已收到原生运行通知。' };
      } else if (script.mode === 'native-run') {
        const last = (body.messages ?? []).at(-1);
        const continuation = last?.role === 'user' && (last.content ?? []).some(block => block.type === 'tool_result');
        const notice = /background (subagent|job)/i.test(lastUserText);
        const child = (body.messages ?? []).filter(message => message.role === 'user')
          .some(message => (message.content ?? []).some(block => block.type === 'text' && block.text.includes('[NATIVE_CHILD]')));
        step = child ? continuation ? { text: 'CHILD_RESULT：子任务实际结束。' } : script.childStep
          : notice ? { text: 'ROOT_RESULT：已汇总子任务及作业。' }
          : continuation ? { text: 'ROOT_WAIT：等待子任务结果。' } : script.rootStep;
      } else if (script.mode === 'dispatch') {
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
          step = isContinuation
            ? { text: script.leadReply ?? '已安排。' }
            : script.leadTool
              ? { tool: { name: script.leadTool.name, input: script.leadTool.input } }
              : { tools: [].concat(script.delegate ?? []).map(d => ({ name: 'pa24_delegate', input: d })) };
        } else if (tools.includes('pa24_work')) {
          const handoff = isContinuation && script.workerFollowupAction &&
            (last.content ?? []).some(block => block.type === 'tool_result' && JSON.stringify(block.content).includes('agentTrack'));
          // A waiting tool result reaches the model only after owner input.
          // Script the deliberate retry after that input, not an automatic retry.
          const sourceReady = isContinuation && script.workerAfterPreparation &&
            (last.content ?? []).some(block => block.type === 'tool_result' && JSON.stringify(block.content).includes('businessExecuted'));
          step = sourceReady
            ? { tool: { name: 'pa24_work', input: script.workerAfterPreparation } }
            : handoff
            ? { tool: { name: 'pa24_work', input: script.workerFollowupAction } }
            : isContinuation
            ? { text: script.workerReply ?? '已完成。' }
            : script.workerTool
              ? { tool: { name: script.workerTool.name, input: script.workerTool.input } }
              : { tool: { name: 'pa24_work', input: script.workerAction } };
        } else {
          step = { text: script.defaultReply ?? '（mock 默认回复）' };
        }
      } else if (sequenceKey && (!sequence || !selected)) {
        step = { httpError: { status: 500, type: 'test_script_error', message: '本次运行没有已登记的独立模型脚本。' } };
      } else {
        const index = selected.nextIndex ?? 0;
        step = (selected.steps ?? [])[index] ?? { text: '（mock 默认回复）' };
        selected.nextIndex = index + 1;
        if (sequence) (script.sequences ??= {})[sequence] = selected;
        changed = true;
      }
      return { value: step, changed };
    });
    const turn = requests.length;
    if (step.httpError) {
      res.writeHead(step.httpError.status, { 'content-type': 'application/json', 'retry-after': '0.01' });
      res.end(JSON.stringify({ error: { type: step.httpError.type, message: step.httpError.message ?? '隔离模型暂时拒绝请求' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const send = payload => res.write(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`);
    send({ type: 'message_start', message: { id: `msg_mock_${turn}`, type: 'message', role: 'assistant', model: body.model ?? 'mock', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
    let blockIndex = 0;
    const toolCalls = step.tools ?? (step.tool ? [step.tool] : []);
    let toolIndex = 0;
    for (const call of toolCalls) {
      send({ type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: `toolu_mock_${turn}_${toolIndex}`, name: call.name, input: {} } });
      send({ type: 'content_block_delta', index: blockIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.input ?? {}) } });
      send({ type: 'content_block_stop', index: blockIndex });
      blockIndex += 1;
      toolIndex += 1;
    }
    const text = step.text ?? '';
    if (text) {
      send({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } });
      send({ type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text } });
      send({ type: 'content_block_stop', index: blockIndex });
    }
    send({ type: 'message_delta', delta: { stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } });
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
    async setSequence(key, steps) {
      await updateScript(script => {
        script.onlySkillRuns = true;
        (script.sequences ??= {})[key] = { steps };
        return { changed: true };
      });
    },
    get log() {
      return requests;
    },
    async close() {
      await new Promise(resolveClosed => server.close(resolveClosed));
    },
  };
}
