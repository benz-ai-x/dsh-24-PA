// A stand-in for a hosted MCP server, for tests: one tool, spoken over stdio
// as MCP JSON-RPC (newline-delimited). Started with `toolLoading: 'on-demand'`
// it lets a test watch the host's MCP client list only the server's loader
// until the model asks for the tool.
import { createInterface } from 'node:readline';

const TOOL = { name: 'echo', description: 'Echoes its text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } };
const send = message => { process.stdout.write(`${JSON.stringify(message)}\n`); };
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  let message;
  try { message = JSON.parse(line); } catch { continue; }
  const { id, method, params } = message;
  if (id === undefined) continue; // A notification gets no response.
  if (method === 'initialize') {
    reply(id, { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'pa24-mcp-stand-in', version: '1.0.0' } });
  } else if (method === 'tools/list') {
    reply(id, { tools: [TOOL] });
  } else if (method === 'tools/call') {
    reply(id, { content: [{ type: 'text', text: String(params?.arguments?.text ?? '') }], isError: false });
  } else {
    reply(id, {});
  }
}
