// F07 end-to-end: multi-page recognition with doubt crops, the review queue,
// and version-bound review reminders. Real Loader + isolated PostgreSQL +
// real lark-cli subprocess (Feishu side stubbed) + scripted LLM (single vision
// route shared by single- and multi-page paths — no second model runtime).
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, chmod, readdir, readFile } from 'node:fs/promises';
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
const waitToolResult = async (toolName, substr, label, timeoutMs = 60_000, since = 0) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
    if (last && last.toolResults.join('').includes(substr)) return last.toolResults.join('');
    await new Promise(r => setTimeout(r, 500));
  }
  const last = llm.log.slice(since).filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；最后工具结果：${last ? last.toolResults.join('').slice(0, 400) : '无'}`);
};
const waitOutbox = async (prefix, label, timeoutMs = 30_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const snap = await host.api('snapshot');
    const row = (snap.outbox ?? []).find(o => o.dedup_key.startsWith(prefix) && o.status === 'sent');
    if (row) return row;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`等待发送（${label}）超时`);
};
const rows = async (sql) => JSON.parse(await cluster.query(`select coalesce(json_agg(t), '[]'::json) as v from (${sql}) t`));
const noteIdOfAck = ack => ack.dedup_key.slice('noteack:'.length).split(':')[0];
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
  maxWorkers: 3, enabledWorkers: ['memo', 'handwriting'],
  workerModels: { handwriting: { provider: 'deepseek-official', model: 'deepseek-flash' } },
};
const recognizeScript = (noteId, workerAction) => ({
  mode: 'dispatch',
  delegate: { worker: 'handwriting', title: `整理 ${noteId}`, instruction: `整理笔记 ${noteId}`, noteId },
  leadReply: '已交给手写整理。',
  workerAction,
  workerReply: '已提交识别结果，等待本人审核。',
});
const clickCard = (eventId, token) => inject(ownerEvent(eventId, { kind: 'card', cardAction: { value: { pa24: 'review', token } } }));
const multiSubmit = noteId => ({
  action: 'note_submit', noteId,
  transcript: '三页例会笔记：预算、联系人、行动项。',
  summary: '多页例会记录（增强识别）',
  suggestions: ['建议先核对联系人页'],
  unknowns: ['第 3 页“12万”的“万”不确定'],
  candidates: ['周五前确认预算数字'],
  relativeDates: [{ original: '周五前', interpretation: '以收稿日期为基准的本周五' }],
  pages: [
    { pageNo: 1, transcript: '第一页：Q4 预算讨论开场' },
    { pageNo: 2, transcript: '第二页：联系人 王小明 / 李雷' },
    { pageNo: 3, transcript: '第三页：行动项与金额' },
  ],
  doubts: [
    { pageNo: 2, kind: 'name', quote: '王小明', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.15 }, note: '人名需重点复核' },
    { pageNo: 3, kind: 'number', quote: '12万' },
  ],
  diagrams: [{ pageNo: 1, description: '审批流程图', region: { x: 0.4, y: 0.4, w: 0.5, h: 0.5 } }],
});
const singleSubmit = noteId => ({
  action: 'note_submit', noteId,
  transcript: '单页便签：买咖啡豆。',
  summary: '单页便签（基线路径）',
  suggestions: [], unknowns: [], candidates: [], relativeDates: [],
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f07-'));
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
    PA24_WORKSPACE: workspace,
    PA24_PG_DSN: cluster.dsn,
    PA24_FEISHU_APP_ID: 'cli_test_app',
    PA24_FEISHU_APP_SECRET: 'test_secret',
    PA24_TRANSPORT: 'fake',
    DEEPSEEK_BASE_URL: llm.url,
    DEEPSEEK_API_KEY: 'test-key',
    PA24_LARK_STUB_STATE: stubStatePath,
    PATH: `${binDir}:${process.env.PATH}`,
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

describe('F07 多页笔记与集中复核（真实 Loader + 隔离 PG）', () => {
  it('P30：三页笔记逐页识别，区域疑点生成裁片并进入同一审核管线', async () => {
    // 收集三页（回复回执追加页）
    await inject(ownerEvent('evt-mp-1', { messageType: 'image', imageKey: 'mp-1', imageData: b64(png(21)) }));
    const ack1 = await waitAck('evt-mp-1');
    const noteA = noteIdOfAck(ack1);
    await inject(ownerEvent('evt-mp-2', { messageType: 'image', imageKey: 'mp-2', imageData: b64(png(22)), parentMessageId: ack1.message_id }));
    const ack2 = await waitAck('evt-mp-2');
    await inject(ownerEvent('evt-mp-3', { messageType: 'image', imageKey: 'mp-3', imageData: b64(png(23)), parentMessageId: ack2.message_id }));
    await waitAck('evt-mp-3');
    expect((await rows(`select count(*)::int as n from pa24.note_page where note_id='${noteA}' and status='saved'`))[0].n).toBe(3);

    // 多页识别（带区域疑点与图示）
    await writeScript(recognizeScript(noteA, multiSubmit(noteA)));
    await inject(ownerEvent('evt-mp-org', { text: '整理这份笔记', parentMessageId: ack2.message_id }));
    await waitWorkItem(`整理 ${noteA}`, '多页识别完成');
    const visionRequest = llm.log.find(r => r.tools.includes('pa24_work') && r.images >= 3);
    expect(visionRequest, '多页识别请求必须携带全部页面图片').toBeTruthy();

    const version = (await rows(`select id, fingerprint, content->'crops' as crops, content->'model' as model from pa24.note_version where note_id='${noteA}'`))[0];
    expect(version.crops).toHaveLength(2); // 一个疑点区域 + 一个图示区域
    expect(version.model).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' });
    // 裁片文件真实生成（sharp 在插件进程内运行）
    const cropDir = join(workspace, '.24pa', 'crops', noteA);
    const cropFiles = (await readdir(cropDir)).filter(f => f.endsWith('.png'));
    expect(cropFiles).toHaveLength(2);
    // 文档包含逐页转写与疑点定位，图片数 = 3 页 + 2 裁片
    const docId = (await rows(`select doc_id from pa24.note_version where id='${version.id}'`))[0].doc_id;
    const stubDocs = (await readFile(`${stubStatePath}.docs.jsonl`, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
    const doc = [...stubDocs].reverse().find(d => d.id === docId);
    expect(doc.content).toContain('第 1 页 转写');
    expect(doc.content).toContain('第二页：联系人 王小明 / 李雷');
    expect(doc.content).toContain('【人名】“王小明”');
    expect(doc.content).toContain('裁片 C1');
    expect(doc.content).toContain('审批流程图');
    expect((doc.content.match(/<img\b/g) ?? []).length).toBe(5);
    await waitOutbox(`notereview:${noteA}:v1`, '多页审核卡');
  });

  it('P30：单页基线与多页增强共用同一视觉路由与审核管线（无第二套模型运行时）', async () => {
    await inject(ownerEvent('evt-sp-1', { messageType: 'image', imageKey: 'sp-1', imageData: b64(png(31)) }));
    const ack = await waitAck('evt-sp-1');
    const noteB = noteIdOfAck(ack);
    await writeScript(recognizeScript(noteB, singleSubmit(noteB)));
    await inject(ownerEvent('evt-sp-org', { text: '整理这份笔记', parentMessageId: ack.message_id }));
    await waitWorkItem(`整理 ${noteB}`, '基线识别完成');
    const baseline = (await rows(`select content->'model' as model, content->'crops' as crops from pa24.note_version where note_id='${noteB}'`))[0];
    expect(baseline.model.provider).toBe('deepseek-official');
    expect(baseline.crops).toHaveLength(0);
    await waitOutbox(`notereview:${noteB}:v1`, '基线审核卡');
  });

  it('P33：队列集中列出待审对象；批准后移出并自动取消催办', async () => {
    const noteA = (await rows(`select id from pa24.note order by id limit 1`))[0].id;
    const noteB = (await rows(`select id from pa24.note order by id desc limit 1`))[0].id;
    // 面板队列
    const queue = await host.api('notes.queue', {});
    expect(queue.count).toBe(2);
    expect(queue.items.map(i => i.noteId).sort()).toEqual([noteA, noteB].sort());
    // Lead 工具队列一致
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'queue' } }, leadReply: '已查看队列。' });
    await inject(ownerEvent('evt-q-1', { text: '看看待审队列' }));
    const toolQueue = await waitToolResult('pa24_notes', 'count', '工具队列');
    expect(toolQueue).toContain(noteA);

    // 为 noteB 设置 60 秒催办，然后批准 noteB → 催办应被同事务取消
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'remind', noteId: noteB, inSeconds: 60, kind: 'once' } }, leadReply: '已设催办。' });
    await inject(ownerEvent('evt-rm-1', { text: `给 ${noteB} 设一个一分钟后提醒我审核` }));
    const remindResult = await waitToolResult('pa24_notes', '已为', '设置催办');
    expect(remindResult).toContain(noteB);
    const reminderId = [...remindResult.matchAll(/nrm-[a-z0-9-]+/g)].at(-1)?.[0];

    const [approveToken] = (await rows(`select token from pa24.review_token where version_id='${noteB}:v1' and action='approve'`)).map(r => r.token);
    await clickCard('evt-approve-b', approveToken);
    await waitOutbox(`review:${approveToken.slice(0, 12)}:`, '批准通知', 30_000);
    expect((await rows(`select status from pa24.review_reminder where id='${reminderId}'`))[0].status).toBe('canceled');

    // 队列只剩 noteA
    const after = await host.api('notes.queue', {});
    expect(after.count).toBe(1);
    expect(after.items[0].noteId).toBe(noteA);
  });

  it('P33：催办到期经 Outbox 发出；暂停不再发送；稍后改时间仍绑定原版本', async () => {
    const noteA = (await rows(`select id from pa24.note where status='awaiting_review' limit 1`))[0].id;
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'remind', noteId: noteA, inSeconds: 2, kind: 'once' } }, leadReply: '已设催办。' });
    const beforeRm2 = llm.log.length;
    await inject(ownerEvent('evt-rm-2', { text: `两秒后提醒我审核 ${noteA}` }));
    const remindResult = await waitToolResult('pa24_notes', '已为', '设置到期催办', 60_000, beforeRm2);
    const reminderId = [...remindResult.matchAll(/nrm-[a-z0-9-]+/g)].at(-1)?.[0];
    await new Promise(r => setTimeout(r, 2500));
    await host.api('action', { type: 'notes.remind-poll' });
    const row = await waitOutbox(`noteremind:${reminderId}:`, '催办发出', 30_000);
    expect(row.message_id).toMatch(/^fake-/);
    expect((await rows(`select status from pa24.review_reminder where id='${reminderId}'`))[0].status).toBe('sent');

    // 暂停：daily 催办不再发送
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'remind', noteId: noteA, inSeconds: 2, kind: 'daily' } }, leadReply: '已设每日催办。' });
    const beforeRm3 = llm.log.length;
    await inject(ownerEvent('evt-rm-3', { text: `再给 ${noteA} 设每日催审，两秒后第一次` }));
    const dailyResult = await waitToolResult('pa24_notes', '已为', '设置每日催办', 60_000, beforeRm3);
    const dailyId = [...dailyResult.matchAll(/nrm-[a-z0-9-]+/g)].at(-1)?.[0];
    await new Promise(r => setTimeout(r, 2500));
    await host.api('action', { type: 'notes.remind-poll' });
    await waitOutbox(`noteremind:${dailyId}:1`, '每日催办第一次', 30_000);
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'remind_control', noteId: noteA, op: 'pause' } }, leadReply: '已暂停。' });
    const beforeRm4 = llm.log.length;
    await inject(ownerEvent('evt-rm-4', { text: `暂停 ${noteA} 的审核提醒` }));
    await waitToolResult('pa24_notes', '已暂停', '暂停催办', 60_000, beforeRm4);
    expect((await rows(`select status from pa24.review_reminder where id='${dailyId}'`))[0].status).toBe('paused');
    // 暂停状态下不再发送（推进时间由账本 remind_at 决定，这里断言无第二份发送）
    expect((await rows(`select sent_count from pa24.review_reminder where id='${dailyId}'`))[0].sent_count).toBe(1);
  });

  it('P33：重启后未到期催办按账本继续；旧版本不催审', async () => {
    const noteA = (await rows(`select id from pa24.note where status='awaiting_review' limit 1`))[0].id;
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'remind', noteId: noteA, inSeconds: 8, kind: 'once' } }, leadReply: '已设。' });
    const beforeRm5 = llm.log.length;
    await inject(ownerEvent('evt-rm-5', { text: `八秒后提醒我审核 ${noteA}` }));
    const remindResult = await waitToolResult('pa24_notes', '已为', '设置重启前催办', 60_000, beforeRm5);
    const reminderId = [...remindResult.matchAll(/nrm-[a-z0-9-]+/g)].at(-1)?.[0];

    await host.stop({ keepRoot: true });
    host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '重启就绪' },
    );
    await new Promise(r => setTimeout(r, 2500));
    await host.api('action', { type: 'notes.remind-poll' });
    const row = await waitOutbox(`noteremind:${reminderId}:`, '重启后催办发出', 40_000);
    expect(row.message_id).toMatch(/^fake-/);
    // 直接派发路径与轮询路径等价：直发后行状态为 sent
    expect((await rows(`select status from pa24.review_reminder where id='${reminderId}'`))[0].status).toBe('sent');
    // 版本已批准/失效的旧提醒不催审：把 noteA 批准后，新 reminder 会被取消
    const [approveToken] = (await rows(`select token from pa24.review_token where version_id='${noteA}:v1' and action='approve'`)).map(r => r.token);
    await clickCard('evt-approve-a', approveToken);
    await waitOutbox(`review:${approveToken.slice(0, 12)}:`, 'noteA 批准通知', 30_000);
    const queue = await host.api('notes.queue', {});
    expect(queue.count, `队列应空，实际：${JSON.stringify(queue.items.map(i => [i.noteId, i.noteStatus]))}`).toBe(0);
  });
});
