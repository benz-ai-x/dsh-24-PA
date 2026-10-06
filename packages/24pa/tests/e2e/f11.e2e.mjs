// F11 end-to-end: executing selected actions from an approved note version,
// revision impact suggestions, and trusted note status in retrieval/overview.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { bootHost } from '../helpers/host.mjs';

const here = dirname(fileURLToPath(import.meta.url));

let cluster, llm, host, root, workspace, stubStatePath, scriptPath, bootEnv, hostRoot, localSessionId;

const writeScript = async script => writeFile(scriptPath, JSON.stringify(script, null, 2));
const inject = (event) => host.api('action', { type: 'test.inject', event });
const ownerEvent = (eventId, extra = {}) => ({ eventId, senderOpenId: 'ou_test_owner', appId: 'cli_test_app', chatType: 'p2p', ...extra });
const waitWorkItem = async (title, label, timeoutMs = 180_000) =>
  host.waitUntil(s => (s.work ?? []).some(w => w.title === title && w.status === 'completed'), { timeoutMs, label });
const unescapeJsonish = text => text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const waitToolResult = async (toolName, substr, label, timeoutMs = 60_000, since = 0) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
    if (last && unescapeJsonish(last.toolResults.join('')).includes(substr)) return unescapeJsonish(last.toolResults.join(''));
    await new Promise(r => setTimeout(r, 500));
  }
  const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；最后工具结果：${last ? unescapeJsonish(last.toolResults.join('')).slice(0, 500) : '无'}`);
};
const waitOutbox = async (prefix, label, timeoutMs = 60_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const snap = await host.api('snapshot');
    const row = (snap.outbox ?? []).find(o => o.dedup_key.startsWith(prefix) && o.status === 'sent');
    if (row) return row;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待发送（${label}）超时`);
};
const rows = async (sql) => JSON.parse(await cluster.query(`select coalesce(json_agg(t), '[]'::json) as v from (${sql}) t`));
const waitAck = async (eventId, timeoutMs = 30_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const snap = await host.api('snapshot');
    const row = (snap.outbox ?? []).find(o => o.dedup_key.startsWith('noteack:') && o.dedup_key.endsWith(`:${eventId}`) && o.status === 'sent');
    if (row) return row;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待回执（${eventId}）超时`);
};
let CRC_TABLE;
const crc32 = buf => {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c; }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const png = (seed = 0) => {
  const w = 96, h = 96;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = [];
  for (let y = 0; y < h; y++) { raw.push(0); for (let x = 0; x < w; x++) raw.push((seed + x * 7) % 256, (seed + y * 11) % 120, 140); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
};
const b64 = buf => buf.toString('base64');
const baseConfig = {
  version: 1, mode: 'feishu', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
  folderToken: 'fld_test', tasklistId: 'tl_test', calendarId: 'primary', timeZone: 'Asia/Shanghai',
  appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
  maxWorkers: 3, enabledWorkers: ['memo', 'tasks', 'calendar', 'reminders', 'handwriting'],
  workerModels: { handwriting: { provider: 'deepseek-official', model: 'deepseek-flash' } },
};
const hwScript = (title, workerAction, noteId) => ({
  mode: 'dispatch',
  delegate: { worker: 'handwriting', title, instruction: title, ...(noteId ? { noteId } : {}) },
  leadReply: '已交给手写整理。',
  workerAction,
  workerReply: '已完成。',
});
const clickCard = (eventId, token) => inject(ownerEvent(eventId, { kind: 'card', cardAction: { value: { pa24: 'review', token } } }));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f11-'));
  cluster = await startPgCluster();
  scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const binDir = join(root, 'bin');
  await mkdir(binDir);
  stubStatePath = join(root, 'lark-stub-state.json');
  await writeFile(stubStatePath, JSON.stringify({ ownerOpenId: 'ou_test_owner' }));
  const stubSource = resolve(here, '../helpers/stub-lark-cli.mjs');
  await writeFile(join(binDir, 'lark-cli'), `#!/bin/sh\nexec ${process.execPath} ${stubSource} "$@"\n`);
  await chmod(join(binDir, 'lark-cli'), 0o755);
  await writeFile(join(workspace, 'AGENTS.md'), `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify(baseConfig, null, 2)}\n\`\`\`\n`);
  bootEnv = {
    PA24_WORKSPACE: workspace, PA24_PG_DSN: cluster.dsn,
    PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'test_secret', PA24_TRANSPORT: 'fake',
    DEEPSEEK_BASE_URL: llm.url, DEEPSEEK_API_KEY: 'test-key',
    PA24_LARK_STUB_STATE: stubStatePath, PATH: `${binDir}:${process.env.PATH}`,
  };
  host = await bootHost({ env: bootEnv });
  hostRoot = host.root;
  const snap = await host.waitUntil(
    s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
    { label: '插件就绪' },
  );
  localSessionId = snap.workspace.localSessionId;
}, 600_000);

afterAll(async () => {
  await host?.stop();
  await cluster?.stop();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe('F11 审核笔记的行动与综合查询（真实 Loader + 隔离 PG）', () => {
  it('P34：批准后只执行选定行动，重复幂等；过期审核拒绝', async () => {
    await inject(ownerEvent('evt-a1', { messageType: 'image', imageKey: 'img-a1', imageData: b64(png(61)) }));
    const ack = await waitAck('evt-a1');
    const noteId = ack.dedup_key.slice('noteack:'.length).split(':')[0];
    await writeScript(hwScript(`整理 ${noteId}`, {
      action: 'note_submit', noteId,
      transcript: '行动清单：联系王工；预定会议室；买标签纸。',
      summary: '三项候选行动',
      suggestions: [], unknowns: [], relativeDates: [],
      candidates: [
        { summary: '联系王工确认方案', sourceQuote: '联系王工', due: '2026-10-09' },
        { summary: '预定下周五会议室', sourceQuote: '预定会议室' },
        '买标签纸',
      ],
    }, noteId));
    let before = llm.log.length;
    await inject(ownerEvent('evt-a2', { text: '整理这份笔记', parentMessageId: ack.message_id }));
    await waitWorkItem(`整理 ${noteId}`, '识别完成');
    await waitOutbox(`notereview:${noteId}:v1`, '审核卡');

    // 未批准时执行 → 拒绝（审核≠授权，未审更不可）
    await writeScript(hwScript('未审先执行', { action: 'note_adopt_actions', noteId, versionId: `${noteId}:v1`, indexes: [0], instruction: '本人选择第 0 项' }, noteId));
    before = llm.log.length;
    await inject(ownerEvent('evt-a3', { text: '先执行联系王工那条' }));
    await waitWorkItem('未审先执行', '未审拒绝完成');
    await waitToolResult('pa24_work', '只有本人已审核通过的版本', '未审拒绝', 60_000, before);

    // 批准 v1
    const [approveToken] = (await rows(`select token from pa24.review_token where version_id='${noteId}:v1' and action='approve'`)).map(r => r.token);
    await clickCard('evt-a4', approveToken);
    await waitOutbox(`review:${approveToken.slice(0, 12)}:`, '批准通知', 30_000);

    // 只选两项（0、2）
    await writeScript(hwScript('执行两项', { action: 'note_adopt_actions', noteId, versionId: `${noteId}:v1`, indexes: [0, 2], instruction: '本人选择第 0 和第 2 项执行' }, noteId));
    before = llm.log.length;
    await inject(ownerEvent('evt-a5', { text: '执行第一条和第三条' }));
    await waitWorkItem('执行两项', '两项执行完成');
    const adopted = await waitToolResult('pa24_work', '已按你的选择执行 2 项', '两项回执', 60_000, before);
    expect(adopted).toContain('tskstub');
    expect((await rows(`select count(*)::int as n from pa24.task where summary like '%王工%' or summary like '%标签纸%'`))[0].n).toBe(2);
    expect((await rows(`select count(*)::int as n from pa24.task where summary like '%会议室%'`))[0].n).toBe(0);

    // 重复选择 → 返回已有对象
    await writeScript(hwScript('重复执行', { action: 'note_adopt_actions', noteId, versionId: `${noteId}:v1`, indexes: [0], instruction: '本人再次确认' }, noteId));
    before = llm.log.length;
    await inject(ownerEvent('evt-a6', { text: '再执行一次第一条' }));
    await waitWorkItem('重复执行', '重复执行完成');
    await waitToolResult('pa24_work', '重复选择返回已有对象', '幂等回执', 60_000, before);
    expect((await rows(`select count(*)::int as n from pa24.task where summary like '%王工%'`))[0].n).toBe(1);

    // 过期审核：编辑文档 → 版本 stale → 拒绝执行
    const docId = (await rows(`select doc_id from pa24.note_version where id='${noteId}:v1'`))[0].doc_id;
    await writeFile(stubStatePath, JSON.stringify({ ownerOpenId: 'ou_test_owner', docEdits: { [docId]: '<p>主人补充：方案改为 C 稿</p>' } }));
    await writeScript(hwScript('核验过期', { action: 'note_adopt_actions', noteId, versionId: `${noteId}:v1`, indexes: [1], instruction: '本人试试第二条' }, noteId));
    before = llm.log.length;
    await inject(ownerEvent('evt-a7', { text: '第二条也执行试试' }));
    await waitWorkItem('核验过期', '过期拒绝完成');
    await waitToolResult('pa24_work', '文档内容与已审核版本不一致', '过期拒绝', 60_000, before);
    expect((await rows(`select count(*)::int as n from pa24.task where summary like '%会议室%'`))[0].n).toBe(0);
  });

  it('P34：修订产生变更建议且不重复打扰；P35：多版本可信检索', async () => {
    const noteId = (await rows(`select id from pa24.note limit 1`))[0].id;
    const docId = (await rows(`select doc_id from pa24.note_version where id='${noteId}:v1'`))[0].doc_id;

    // 重新发布 v2（当前文档已含主人补充） → 变更建议
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'republish', noteId } }, leadReply: '已重发。' });
    let before = llm.log.length;
    await inject(ownerEvent('evt-b1', { text: `重新发布 ${noteId} 的候选` }));
    await waitToolResult('pa24_notes', 'addedLines', '重发 v2', 60_000, before);
    await waitOutbox(`noteimpact:${noteId}:v2`, '变更建议', 30_000);
    const impact = (await host.api('snapshot')).outbox.find(o => o.dedup_key === `noteimpact:${noteId}:v2` && o.status === 'sent');
    expect(impact.content?.text ?? '').toContain('不会静默删除或覆盖');
    expect(impact.content?.text ?? '').toContain('王工');

    // notes_search：多版本 + 有效性标注
    await writeScript(hwScript('检索笔记', { action: 'notes_search', query: noteId }, noteId));
    before = llm.log.length;
    await inject(ownerEvent('evt-b2', { text: `查一下 ${noteId} 的决定` }));
    await waitWorkItem('检索笔记', '检索完成');
    const search = await waitToolResult('pa24_work', 'currentValidity', '检索回执', 60_000, before);
    expect(search).toContain(`"${noteId}:v1"`);
    expect(search).toContain(`"${noteId}:v2"`);
    expect(search).toContain('changed'); // v1 因文档已改而失效
    expect(search).toContain('不因曾通过而继承');

    // 再次修订（v3）：新的变更建议（逐版本），带差异概述
    await writeFile(stubStatePath, JSON.stringify({ ownerOpenId: 'ou_test_owner', docEdits: { [docId]: '<p>补充：改为 C 稿并抄送李总</p>' } }));
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'republish', noteId } }, leadReply: '已重发。' });
    before = llm.log.length;
    await inject(ownerEvent('evt-b1b', { text: `再修订一次 ${noteId}` }));
    await waitToolResult('pa24_notes', 'addedLines', '重发 v3', 60_000, before);
    const impact3 = await waitOutbox(`noteimpact:${noteId}:v3`, 'v3 变更建议', 30_000);
    expect(impact3.content?.text ?? '').toContain('差异');
    expect(impact3.content?.text ?? '').toContain('不会静默删除或覆盖');
  });

  it('P35：晨报/概览包含已审核笔记与等待/待审（缺数据明示）', async () => {
    // 批准当前候选 v3（v2 已被 v3 修订取代，旧批准按设计不再当作当前事实）
    const noteId2 = (await rows(`select note_id from pa24.note_version where version=3 limit 1`))[0].note_id;
    const [v3Token] = (await rows(`select token from pa24.review_token where version_id='${noteId2}:v3' and action='approve'`)).map(r => r.token);
    await clickCard('evt-b3', v3Token);
    await waitOutbox(`review:${v3Token.slice(0, 12)}:`, 'v3 批准', 30_000);

    await writeScript({ mode: 'dispatch', delegate: { worker: 'calendar', title: '今日概览', instruction: '概览' }, leadReply: 'ok', workerAction: { action: 'overview_today' }, workerReply: 'ok' });
    let before = llm.log.length;
    await inject(ownerEvent('evt-b4', { text: '看看今天的概览' }));
    await waitWorkItem('今日概览', '概览完成');
    const overview = await waitToolResult('pa24_work', 'reviewedNotes', '概览回执', 60_000, before);
    expect(overview).toContain('"version":3');
    expect(overview).toContain('docUrl');
    // 全类事项汇总：任务/日历/等待/待审均在，未读取范围明示
    expect(overview).toContain('"calendar"');
    expect(overview).toContain('"tasks"');
    expect(overview).toContain('"waiting"');
    expect(overview).toContain('"reviewQueue"');
    expect(overview).toContain('"missing"');
  });
});
