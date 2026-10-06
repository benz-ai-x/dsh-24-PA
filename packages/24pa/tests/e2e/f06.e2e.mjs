// F06 end-to-end: handwriting collection, recognition, and human review.
// Real Loader + isolated PostgreSQL + real lark-cli subprocess (Feishu stubbed)
// + scripted LLM (the mock still receives the real image wire blocks, proving
// the vision route). Covers P28 collection (pages, duplicates, corrupt,
// restart durability), P29 single-page recognition to a pending doc, P31
// approve/return with opaque tokens and idempotency, P32 edit invalidation,
// republish v2, and the preserved historical approval.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const waitToolResult = async (toolName, substr, label, timeoutMs = 60_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const last = llm.log.filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
    if (last && last.toolResults.join('').includes(substr)) return last.toolResults.join('');
    await new Promise(r => setTimeout(r, 500));
  }
  const last = llm.log.filter(r => r.tools.includes(toolName) && r.toolResults.length > 0).at(-1);
  throw new Error(`等待工具结果（${label}，含 "${substr}"）超时；最后工具结果：${last ? last.toolResults.join('').slice(0, 400) : '无'}`);
};
const waitOutbox = async (prefix, label, timeoutMs = 30_000) => {
  for (let i = 0; i < timeoutMs / 500; i++) {
    const snap = await host.api('snapshot');
    const row = (snap.outbox ?? []).find(o => o.dedup_key.startsWith(prefix) && o.status === 'sent');
    if (row) return row;
    await new Promise(r => setTimeout(r, 500));
  }
  const inbox = await rows(`select event_id, kind, status, error from pa24.inbox order by created_at desc limit 6`);
  const versions = await rows(`select id, status, verify_result from pa24.note_version order by created_at desc limit 4`);
  throw new Error(`等待发送（${label}）超时；inbox=${JSON.stringify(inbox)} versions=${JSON.stringify(versions)}`);
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
// Real, decodable PNGs: the dsh attachment admission decodes every image, so
// magic bytes alone would be rejected before the child ever starts.
let CRC_TABLE;
const crc32 = buf => {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const png = (seed = 0) => {
  const w = 8;
  const h = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) raw.push((seed + x * 13) % 256, (seed + y * 29) % 100, 128);
  }
  const idat = deflateSync(Buffer.from(raw));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
const garbage = Buffer.from('this is definitely not an image');
const b64 = buf => buf.toString('base64');
const baseConfig = (withVision) => ({
  version: 1, mode: 'feishu', larkProfile: 'default', ownerOpenId: 'ou_test_owner',
  folderToken: 'fld_test', tasklistId: 'tl_test', calendarId: 'primary', timeZone: 'Asia/Shanghai',
  appIdEnv: 'PA24_FEISHU_APP_ID', appSecretEnv: 'PA24_FEISHU_APP_SECRET', pgDsnEnv: 'PA24_PG_DSN',
  maxWorkers: 3, enabledWorkers: ['memo', 'tasks', 'calendar', 'reminders', 'handwriting'],
  workerModels: withVision ? { handwriting: { provider: 'deepseek-official', model: 'deepseek-flash' } } : {},
});
const writeAgentsMd = async (withVision) =>
  writeFile(join(workspace, 'AGENTS.md'), `# 24私助工作区\n\n\`\`\`json\n${JSON.stringify(baseConfig(withVision), null, 2)}\n\`\`\`\n`);
const setStubState = async (patch) => writeFile(stubStatePath, JSON.stringify({ ownerOpenId: 'ou_test_owner', ...patch }, null, 2));
const recognizeScript = (noteId, workerAction) => ({
  mode: 'dispatch',
  delegate: { worker: 'handwriting', title: `整理 ${noteId}`, instruction: `整理笔记 ${noteId}`, noteId },
  leadReply: '已交给手写整理，结果稍后回传。',
  workerAction,
  workerReply: '已提交识别结果，等待本人审核。',
});
const submitAction = (noteId, extra = {}) => ({
  action: 'note_submit', noteId,
  transcript: `周一例会：讨论 Q4 预算。\n下一步：${noteId} 归档预算初稿。`,
  summary: '例会记录，含 Q4 预算讨论与下一步',
  suggestions: ['建议先汇总各部门需求'],
  unknowns: ['第二行“预算”二字不确定'],
  candidates: ['周五前交预算初稿'],
  relativeDates: [{ original: '周五前', interpretation: '以收稿日期为基准的本周五' }],
  ...extra,
});
const clickCard = (eventId, token) => inject(ownerEvent(eventId, { kind: 'card', cardAction: { value: { pa24: 'review', token } } }));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f06-'));
  cluster = await startPgCluster();
  scriptPath = join(root, 'llm-script.json');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm-log.json') });
  workspace = join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  const binDir = join(root, 'bin');
  await mkdir(binDir);
  stubStatePath = join(root, 'lark-stub-state.json');
  await setStubState({});
  const stubSource = resolve(here, '../helpers/stub-lark-cli.mjs');
  await writeFile(join(binDir, 'lark-cli'), `#!/bin/sh\nexec ${process.execPath} ${stubSource} "$@"\n`);
  await chmod(join(binDir, 'lark-cli'), 0o755);
  // Boot without the vision route first: the capability-missing path is part
  // of the acceptance (P29 能力缺失准确报错), then reload adds the route.
  await writeAgentsMd(false);
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

describe('F06 手写笔记整理与人工审核（真实 Loader + 隔离 PG）', () => {
  it('P28：批次收集三页、重复页识别、损坏资源反馈，重启后原稿与页序仍在', async () => {
    // 第 1 页：新笔记
    await inject(ownerEvent('evt-img-1', { messageType: 'image', imageKey: 'img-1', imageData: b64(png(1)) }));
    const ack1 = await waitOutbox('noteack:N-1:p1:', '第1页回执');
    expect(ack1.message_id).toMatch(/^fake-/);

    // 第 2、3 页：引用回执继续发图 → 同一笔记追加页
    await inject(ownerEvent('evt-img-2', { messageType: 'image', imageKey: 'img-2', imageData: b64(png(2)), parentMessageId: ack1.message_id }));
    const ack2 = await waitOutbox('noteack:N-1:p2:', '第2页回执');
    await inject(ownerEvent('evt-img-3', { messageType: 'image', imageKey: 'img-3', imageData: b64(png(3)), parentMessageId: ack2.message_id }));
    await waitOutbox('noteack:N-1:p3:', '第3页回执');

    // 重复页：同一原稿再发一次 → 不重复保存
    await inject(ownerEvent('evt-img-4', { messageType: 'image', imageKey: 'img-1', imageData: b64(png(1)), parentMessageId: ack2.message_id }));
    await waitOutbox('noteinfo:evt-img-4', '重复页反馈');

    // 损坏资源：未知格式 → 记为缺页并反馈
    await inject(ownerEvent('evt-img-5', { messageType: 'image', imageKey: 'img-bad', imageData: b64(garbage), parentMessageId: ack2.message_id }));
    await waitOutbox('noteinfo:evt-img-5', '损坏资源反馈');

    let pages = await rows(`select page_no, status, quality, sha256 from pa24.note_page where note_id='N-1' order by page_no`);
    expect(pages.filter(p => p.status === 'saved')).toHaveLength(3);
    expect(pages.filter(p => p.status === 'rejected')).toHaveLength(1);
    expect(pages.find(p => p.page_no === 4).quality).toContain('无法识别的图片格式');

    // 重启：原稿文件与页序以账本为准恢复
    await host.stop({ keepRoot: true });
    host = await bootHost({ root: hostRoot, env: bootEnv });
    await host.waitUntil(
      s => (s.readiness?.items ?? []).find(i => i.id === 'postgres')?.state === 'ok' && !!s.workspace && s.transport?.connected === true,
      { label: '重启就绪' },
    );
    pages = await rows(`select page_no, status from pa24.note_page where note_id='N-1' order by page_no`);
    expect(pages.filter(p => p.status === 'saved')).toHaveLength(3);
    const originals = await readdir(join(workspace, '.24pa', 'originals', 'N-1'));
    expect(originals.filter(f => f.startsWith('p') && f.endsWith('.png'))).toHaveLength(3);

    // F07 起多页识别可用；本用例不再注入多页整理（由 f07.e2e 覆盖）。
  });

  it('P29：视觉路由缺失时明确报错；配置重载后识别请求真的携带图片并发布待审文档', async () => {
    // 图片文件消息（PNG 文件，非拍照）→ 新笔记 N-2
    await inject(ownerEvent('evt-file-1', { messageType: 'file', fileKey: 'img-file-1', fileName: 'note.png', imageData: b64(png(5)) }));
    const ack = await waitOutbox('noteack:N-2:p1:', '图片文件回执');
    expect((await rows(`select media_type, source_type from pa24.note_page where note_id='N-2'`))[0]).toEqual({ media_type: 'image/png', source_type: 'file' });
    expect((await rows(`select source_type from pa24.note_page where note_id='N-1' and page_no=1`))[0].source_type).toBe('image');

    // 未配置视觉路由：委派被明确拒绝
    await writeScript(recognizeScript('N-2', submitAction('N-2')));
    await inject(ownerEvent('evt-org-1', { text: '整理这份笔记', parentMessageId: ack.message_id }));
    await waitToolResult('pa24_delegate', '视觉模型路由', '缺路由拒绝');

    // 重载配置加入视觉路由后成功
    await writeAgentsMd(true);
    await host.api('action', { type: 'workspace.reload' });
    await inject(ownerEvent('evt-org-2', { text: '整理这份笔记', parentMessageId: ack.message_id }));
    await waitWorkItem('整理 N-2', '识别完成');

    // 识别请求真的包含图片（视觉路由生效，非模型自述）
    const visionRequest = llm.log.find(r => r.tools.includes('pa24_work') && r.images >= 1);
    expect(visionRequest, '识别请求必须携带图片线块').toBeTruthy();

    const versions = await rows(`select version, status, fingerprint, doc_id, doc_url from pa24.note_version where note_id='N-2'`);
    expect(versions).toHaveLength(1);
    expect(versions[0].status).toBe('pending_review');
    expect(versions[0].fingerprint).toHaveLength(64);
    const tokens = await rows(`select action from pa24.review_token where version_id='N-2:v1'`);
    expect(tokens.map(t => t.action).sort()).toEqual(['approve', 'return']);
    await waitOutbox('notereview:N-2:v1', '审核卡发送');
    // 文档已回读并插入原稿图片（stub 记录了 media-insert 与回读内容）
    const stubDocs = (await readFile(`${stubStatePath}.docs.jsonl`, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
    const doc = [...stubDocs].reverse().find(d => d.id === versions[0].doc_id);
    expect(doc.content).toContain('<img src=');
    expect(doc.content).toContain('待本人审核 N-2 v1');
    // 视觉模型版本随版本存档（P29 AC4）
    const model = (await rows(`select content->'model' as model from pa24.note_version where id='N-2:v1'`))[0].model;
    expect(model).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' });
    // 有界轮询：待审版本的核验结果与时间持久化（P32 AC1；面板触发同一有界入口）
    await host.api('action', { type: 'notes.poll' });
    let polled;
    for (let i = 0; i < 30 && !polled; i++) {
      const v = await rows(`select verify_result, (verified_at is not null) as checked from pa24.note_version where id='N-2:v1'`);
      if (v[0].verify_result === 'matches') polled = v[0];
      else await new Promise(r => setTimeout(r, 500));
    }
    expect(polled?.checked).toBe(true);
  });

  it('P31：非主人点击被拒绝，主人批准指定版本，重复点击返回原结果', async () => {
    const [approveToken] = (await rows(`select token from pa24.review_token where version_id='N-2:v1' and action='approve'`)).map(r => r.token);
    // 非主人操作：入口层直接拒绝，不产生任何裁决
    await inject({ eventId: 'evt-card-foreign', appId: 'cli_test_app', kind: 'card', senderOpenId: 'ou_someone_else', chatType: 'p2p', cardAction: { value: { pa24: 'review', token: approveToken } } });
    let foreign;
    for (let i = 0; i < 30 && !foreign; i++) {
      const r = await rows(`select status from pa24.inbox where event_id='evt-card-foreign'`);
      if (r[0]?.status === 'rejected') foreign = r[0];
      else await new Promise(r2 => setTimeout(r2, 500));
    }
    expect(foreign?.status).toBe('rejected');
    expect((await rows(`select count(*)::int as n from pa24.review_decision`))[0].n).toBe(0);
    await clickCard('evt-card-1', approveToken);
    await waitOutbox(`review:${approveToken.slice(0, 12)}:`, '批准通知', 30_000);
    expect((await rows(`select decision from pa24.review_decision where version_id='N-2:v1'`))).toEqual([{ decision: 'approve' }]);
    expect((await rows(`select status from pa24.note_version where id='N-2:v1'`))[0].status).toBe('approved');
    expect((await rows(`select status from pa24.note where id='N-2'`))[0].status).toBe('approved');
    expect((await rows(`select doc_sync_status from pa24.review_decision where version_id='N-2:v1'`))[0].doc_sync_status).toBe('synced');

    // 重复点击：返回原结果，不产生第二份裁决
    await clickCard('evt-card-1b', approveToken);
    await waitOutbox(`review:${approveToken.slice(0, 12)}:evt-card-1b`, '重复点击通知', 30_000);
    expect((await rows(`select count(*)::int as n from pa24.review_decision`))[0].n).toBe(1);

    // 系统状态块更新后核验仍 matches（系统块排除在指纹外）
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'verify', noteId: 'N-2' } }, leadReply: '已核验。' });
    await inject(ownerEvent('evt-verify-1', { text: '核验笔记 N-2 的审核状态' }));
    const result = await waitToolResult('pa24_notes', 'matches', '核验一致');
    expect(result).toContain('v1');
  });

  it('P31：退回指定版本并记录凭证', async () => {
    await inject(ownerEvent('evt-img-10', { messageType: 'image', imageKey: 'img-10', imageData: b64(png(7)) }));
    const ack = await waitOutbox('noteack:N-3:p1:', 'N-3 回执');
    await writeScript(recognizeScript('N-3', submitAction('N-3')));
    await inject(ownerEvent('evt-org-3', { text: '整理这份笔记', parentMessageId: ack.message_id }));
    await waitWorkItem('整理 N-3', 'N-3 识别完成');
    const [returnToken] = (await rows(`select token from pa24.review_token where version_id='N-3:v1' and action='return'`)).map(r => r.token);
    await clickCard('evt-card-3', returnToken);
    await waitOutbox(`review:${returnToken.slice(0, 12)}:`, '退回通知', 30_000);
    expect((await rows(`select status from pa24.note_version where id='N-3:v1'`))[0].status).toBe('returned');
    expect((await rows(`select status from pa24.note where id='N-3'`))[0].status).toBe('returned');
  });

  it('P32：文档修改后旧批准仅覆盖旧快照，重发候选 v2 再批准，历史凭证保留', async () => {
    // 主人在飞书编辑了 N-2 的文档（stub 注入追加内容）
    const docId = (await rows(`select doc_id from pa24.note_version where id='N-2:v1'`))[0].doc_id;
    await setStubState({ docEdits: { [docId]: '<p>主人补充：预算改为 12 万</p>' } });

    // 核验发现 changed → 需重新审核；旧批准作为历史事实保留
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'verify', noteId: 'N-2' } }, leadReply: '已核验。' });
    await inject(ownerEvent('evt-verify-2', { text: '再核验笔记 N-2' }));
    await waitToolResult('pa24_notes', 'changed', '核验变化');
    expect((await rows(`select status from pa24.note where id='N-2'`))[0].status).toBe('needs_rereview');
    expect((await rows(`select count(*)::int as n from pa24.review_decision where version_id='N-2:v1' and decision='approve'`))[0].n).toBe(1);

    // 刷新候选：当前文档成为 v2，旧卡不能批准新内容
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'republish', noteId: 'N-2' } }, leadReply: '已重发候选。' });
    await inject(ownerEvent('evt-repub-1', { text: '重新发布 N-2 的候选' }));
    const repub = await waitToolResult('pa24_notes', 'addedLines', '重发候选');
    expect(repub).toContain('v2');
    const v2 = (await rows(`select id, status, fingerprint from pa24.note_version where note_id='N-2' and version=2`))[0];
    expect(v2.status).toBe('pending_review');
    await waitOutbox('notereview:N-2:v2', 'v2 审核卡');

    // 旧 v1 卡现在点击：版本已不是待审状态 → 拒绝
    const [oldApprove] = (await rows(`select token from pa24.review_token where version_id='N-2:v1' and action='approve'`)).map(r => r.token);
    await clickCard('evt-card-old', oldApprove);
    await waitOutbox(`review:${oldApprove.slice(0, 12)}:evt-card-old`, '旧卡拒绝', 30_000);
    expect((await rows(`select count(*)::int as n from pa24.review_decision where version_id='N-2:v1'`))[0].n).toBe(1);

    // v1 与 v2 指纹不同；批准 v2 成功，两份裁决并存（历史快照可查）
    const v1fp = (await rows(`select fingerprint from pa24.note_version where id='N-2:v1'`))[0].fingerprint;
    expect(v2.fingerprint).not.toBe(v1fp);
    const [v2Approve] = (await rows(`select token from pa24.review_token where version_id='N-2:v2' and action='approve'`)).map(r => r.token);
    await clickCard('evt-card-v2', v2Approve);
    await waitOutbox(`review:${v2Approve.slice(0, 12)}:`, 'v2 批准通知', 30_000);
    const decisions = await rows(`select version_id, decision from pa24.review_decision where note_id='N-2' order by decided_at`);
    expect(decisions).toEqual([{ version_id: 'N-2:v1', decision: 'approve' }, { version_id: 'N-2:v2', decision: 'approve' }]);
  });

  it('P31/P32：状态同步失败时凭证仍保存，核验后补同步；结束批次后不再追加页', async () => {
    // 新笔记：识别 → 批准时文档状态更新失败
    await inject(ownerEvent('evt-img-30', { messageType: 'image', imageKey: 'img-30', imageData: b64(png(11)) }));
    const ack = await waitAck('evt-img-30');
    const noteA = noteIdOfAck(ack);
    await writeScript(recognizeScript(noteA, submitAction(noteA)));
    await inject(ownerEvent('evt-org-5', { text: '整理这份笔记', parentMessageId: ack.message_id }));
    await waitWorkItem(`整理 ${noteA}`, '识别完成');
    const [approveToken] = (await rows(`select token from pa24.review_token where version_id='${noteA}:v1' and action='approve'`)).map(r => r.token);
    await setStubState({ failNext: { command: 'docs.update', error: '注入的文档更新失败' } });
    await clickCard('evt-card-5', approveToken);
    await waitOutbox(`reviewsync:${approveToken.slice(0, 12)}:evt-card-5`, '同步失败通知', 30_000);
    // 凭证已保存；同步标记为 failed（凭证已保存、标识同步中）
    const decision = (await rows(`select decision, doc_sync_status from pa24.review_decision where version_id='${noteA}:v1'`))[0];
    expect(decision.decision).toBe('approve');
    expect(decision.doc_sync_status).toBe('failed');
    expect((await rows(`select status from pa24.note_version where id='${noteA}:v1'`))[0].status).toBe('approved');
    // 核验一致后自动补同步（恢复路径）
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'verify', noteId: noteA } }, leadReply: '已核验。' });
    await inject(ownerEvent('evt-verify-5', { text: `核验笔记 ${noteA}` }));
    const result = await waitToolResult('pa24_notes', '补同步', '核验并补同步');
    expect(result).toContain('matches');
    expect((await rows(`select doc_sync_status from pa24.review_decision where version_id='${noteA}:v1'`))[0].doc_sync_status).toBe('synced');

    // 结束批次：collected 之后不再追加页（P28 AC1 显式结束）
    await inject(ownerEvent('evt-img-31', { messageType: 'image', imageKey: 'img-31', imageData: b64(png(12)) }));
    const ack2 = await waitAck('evt-img-31');
    const noteB = noteIdOfAck(ack2);
    expect(noteB).not.toBe(noteA);
    await writeScript({ mode: 'dispatch', leadTool: { name: 'pa24_notes', input: { action: 'finish', noteId: noteB } }, leadReply: '已结束批次。' });
    await inject(ownerEvent('evt-finish-6', { text: '结束这批笔记' }));
    const finished = await waitToolResult('pa24_notes', '批次已结束', '结束批次');
    expect(finished).toContain(noteB);
    expect((await rows(`select status from pa24.note where id='${noteB}'`))[0].status).toBe('collected');
    await inject(ownerEvent('evt-img-32', { messageType: 'image', imageKey: 'img-32', imageData: b64(png(13)), parentMessageId: ack2.message_id }));
    await waitOutbox('noteinfo:evt-img-32', '结束后拒绝追加', 30_000);
    expect((await rows(`select count(*)::int as n from pa24.note_page where note_id='${noteB}' and status='saved'`))[0].n).toBe(1);
  });

  it('P29：媒体插入失败不发送待审链接，操作保留可恢复回执', async () => {
    await inject(ownerEvent('evt-img-40', { messageType: 'image', imageKey: 'img-40', imageData: b64(png(14)) }));
    const ack = await waitAck('evt-img-40');
    const noteC = noteIdOfAck(ack);
    await setStubState({ failNext: { command: 'docs.media-insert', error: '注入的媒体插入失败' } });
    await writeScript(recognizeScript(noteC, submitAction(noteC)));
    await inject(ownerEvent('evt-org-7', { text: '整理这份笔记', parentMessageId: ack.message_id }));
    await waitToolResult('pa24_work', '媒体插入失败', '媒体插入失败');
    // 未生成版本、未发送审核卡；staged 操作保留 docId 回执可恢复
    expect((await rows(`select count(*)::int as n from pa24.note_version where note_id='${noteC}'`))[0].n).toBe(0);
    const op = (await rows(`select status, (receipt->>'docId') is not null as has_doc from pa24.action_operation where action='note.publish' and params->>'noteId'='${noteC}'`))[0];
    expect(op.status).toBe('failed');
    expect(op.has_doc).toBe(true);
  });

  it('P31/P29：识别 Worker 没有任何批准或外部行动工具', async () => {
    await inject(ownerEvent('evt-img-20', { messageType: 'image', imageKey: 'img-20', imageData: b64(png(9)) }));
    const ack = await waitAck('evt-img-20');
    const noteD = noteIdOfAck(ack);
    await writeScript(recognizeScript(noteD, { action: 'note_approve', noteId: noteD, decision: 'approve' }));
    await inject(ownerEvent('evt-org-4', { text: '整理这份笔记', parentMessageId: ack.message_id }));
    await waitToolResult('pa24_work', '没有执行这项操作的权限', 'Worker 无批准工具');
    // 未产生任何审核裁决
    expect((await rows(`select count(*)::int as n from pa24.review_decision where note_id='${noteD}'`))[0].n).toBe(0);
  });
});
