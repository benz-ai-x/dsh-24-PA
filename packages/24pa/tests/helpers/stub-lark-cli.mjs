#!/usr/bin/env node
// Stub lark-cli for tests: speaks the same fixed-argv + `--json` envelope as
// the real CLI. Behavior and recorded side effects live in a JSON state file
// (PA24_LARK_STUB_STATE); failure injection is available via state.failNext.
// The plugin still spawns a real process and parses real stdout, so only the
// Feishu network side is replaced.
import { readFile, writeFile } from 'node:fs/promises';

const statePath = process.env.PA24_LARK_STUB_STATE;
const args = process.argv.slice(2);
// Skip flag values (--profile <name>) the same way the real CLI parses.
const plain = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--profile');
const json = args.includes('--json');

const readState = async () => {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return { docs: [], calls: [], ownerOpenId: 'ou_test_owner' };
  }
};
const writeState = async state => writeFile(statePath, JSON.stringify(state, null, 2));

const ok = data => {
  if (json) console.log(JSON.stringify({ ok: true, data }));
  process.exit(0);
};
const fail = message => {
  if (json) console.error(JSON.stringify({ ok: false, error: { message } }));
  else console.error(message);
  process.exit(1);
};

const state = await readState();
state.calls.push({ at: new Date().toISOString(), args });
await writeState(state);

const docIndex = () => state.docs.length + 1;

if (plain[0] === undefined && args.includes('--version')) {
  console.log('stub-lark-cli 1.0.87-test');
  process.exit(0);
}
if (plain[0] === 'auth' && plain[1] === 'status') {
  if (state.failNext?.command === 'auth') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'auth status injected failure');
  }
  ok({ verified: true, identities: { user: { openId: state.ownerOpenId ?? 'ou_test_owner', userName: '测试主人', tokenStatus: 'valid' } } });
}
if (plain[0] === 'docs' && plain[1] === '+create') {
  if (state.failNext?.command === 'docs.create') {
    await writeState({ ...state, failNext: null });
    fail(state.failNext.error ?? 'docs create injected failure');
  }
  const stdin = await new Promise(resolveStdin => {
    let data = '';
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => resolveStdin(data));
    process.stdin.on('error', () => resolveStdin(data));
  });
  const id = `docstub-${docIndex()}`;
  const doc = { id, content: stdin, revision: 1 };
  state.docs.push(doc);
  await writeState({ ...state, docs: state.docs });
  ok({ document: { document_id: id, url: `https://example.feishu.cn/wiki/${id}`, revision_id: 1 }, warnings: [] });
}
if (plain[0] === 'docs' && plain[1] === '+fetch') {
  const docArg = args[args.indexOf('--doc') + 1];
  const doc = state.docs.find(d => d.id === docArg);
  if (!doc) fail(`文档不存在：${docArg}`);
  ok({ document: { document_id: doc.id, url: `https://example.feishu.cn/wiki/${doc.id}`, content: doc.content, revision_id: doc.revision, reference_map: {} } });
}
if (plain[0] === 'drive' && plain[1] === 'files' && plain[2] === 'list') ok({ files: [{ token: 'fld_test', name: '体验目录', type: 'folder' }] });
if (plain[0] === 'task' && plain[1] === 'tasklists' && plain[2] === 'get') ok({ tasklist: { guid: 'tl_test', name: '体验清单' } });
if (plain[0] === 'calendar') ok({ calendar: { calendar_id: 'cal_test', summary: '测试主人' } });
fail(`stub-lark-cli 未实现的命令：${args.join(' ')}`);
