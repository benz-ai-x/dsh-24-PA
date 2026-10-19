import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, join, readFile, writeFile } from '../helpers/runtime.mjs';
import { FakeFeishuTransport } from '../../lib/feishu.js';
import { sha256Hex } from '../../lib/handwriting.js';
import { createAtScheduleRecord, ScheduleId } from '@deepseek-ai/dsh-schedule';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`R3 知识与行动公开入口 (${backend})`, () => {
  let f, local, cluster, nativeCreates, entries, nativeUnknown, workspacePath;
  const original = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  beforeEach(async () => {
    f = await fixture(); nativeCreates = 0; entries = []; nativeUnknown = false;
    for (const [name, variable] of [['lark', 'PA24_LARK_STUB_STATE'], ['wecom', 'PA24_WECOM_STUB_STATE']]) {
      const state = join(f.root, name + '.json'), bin = join(f.root, name + '-cli');
      await writeFile(state, '{}');
      await writeFile(bin, '#!/usr/bin/env node\nprocess.env.' + variable + '=' + JSON.stringify(state) + ';\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-' + name + '-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
      f.options[name + 'CliBin'] = bin;
    }
    const schedule = {
      create: async (sessionId, request) => {
        const record = createAtScheduleRecord(ScheduleId('schedule-' + (++nativeCreates)), request.prompt, request.at, Date.now(), request.title);
        entries.push({ ...record, sessionId, status: 'active' });
        if (nativeUnknown) throw new Error('native receipt lost'); return record;
      }, catalog: async () => structuredClone(entries), delete: async () => ({ deleted: true }),
    };
    f.ctx.get = name => name === 'schedule' ? schedule : name === 'attachments' ? { admitPromptContent: async blocks => blocks } : null;
    if (backend === 'postgres') { cluster = await startPgCluster(); f.options.env.PA24_R3_TEST_DSN = cluster.dsn; }
    const path = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', tasklistId: 'list', calendarId: 'calendar', folderToken: 'folder', maxWorkers: 8,
      enabledWorkers: ['memo', 'calendar', 'handwriting', 'tasks'], workerModels: { handwriting: { provider: 'test', model: 'vision-test' } },
      ...(backend === 'postgres' ? { storage: 'postgres', pgDsnEnv: 'PA24_R3_TEST_DSN' } : {}) });
    workspacePath = path; await f.rt.bind(path); f.rt.transport = new FakeFeishuTransport('test'); local = f.agents.get(await f.rt.openLocalSession());
  });
  afterEach(async () => { await f?.cleanup(); await cluster?.stop(); cluster = null; });
  const worker = async role => ({ id: (await f.rt.delegate({ worker: role, title: role, instruction: '本人交办' }, local)).workId });
  const note = async () => {
    const path = join(f.root, 'original.png'); await writeFile(path, original);
    await f.rt.repos.notes.insertNote({ id: 'N-1', title: '记录', origin: 'feishu' });
    await f.rt.repos.notes.insertPage({ note_id: 'N-1', page_no: 1, message_id: 'image', image_key: 'image', media_type: 'image/png', byte_size: original.length, sha256: sha256Hex(original), storage_path: path, source_type: 'image', quality: null, status: 'saved' });
  };

  it('同一笔记跨 session 并发最多一个活动事项，停止后可重新委派', async () => {
    await note(); await f.ctx.sessionController.create({ sessionId: 'other-local', workspaceId: f.rt.workspace.statePath, agentPreset: 'pa24' });
    const other = f.agents.get('other-local'); expect(other.id).not.toBe(local.id);
    const args = { worker: 'handwriting', noteId: 'N-1', title: '识别', instruction: '整理原稿' };
    const results = await Promise.allSettled([f.rt.delegate(args, local), f.rt.delegate(args, other)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const first = results.find(r => r.status === 'fulfilled').value;
    expect((await f.rt.repos.notes.getNote('N-1')).work_item_id).toBe(first.workId);
    await f.rt.workLifecycle.stop(first.workId);
    expect((await f.rt.delegate(args, other)).workId).not.toBe(first.workId);
  });

  it('同会议并发同参数复用，异参数拒绝；创建未知跨重启恢复仍唯一', async () => {
    const child = await worker('calendar'), start = new Date(Date.now() + 86400000), end = new Date(start.getTime() + 3600000);
    await f.rt.repos.calendar.upsertEvent({ event_id: 'event', calendar_id: 'calendar', channel: 'feishu', summary: '评审会', start_time: start, end_time: end, is_all_day: false, timezone: 'Asia/Shanghai', status: 'active', recurring: false, attendees: null, url: null, raw: {} });
    const args = { action: 'meeting_prep_enable', eventId: 'event', leadMinutes: 15 };
    nativeUnknown = true;
    await expect(f.rt.work(args, child)).rejects.toThrow('native receipt lost');
    await expect(f.rt.work({ ...args, leadMinutes: 30 }, child)).rejects.toThrow(/已有进行中/);
    await f.rt.stop(); f.rt = f.make(); await f.rt.bind(workspacePath);
    f.rt.transport = new FakeFeishuTransport('test'); local = f.agents.get(await f.rt.openLocalSession());
    const restartedChild = await worker('calendar');
    nativeUnknown = false;
    const results = await Promise.all(Array.from({ length: 6 }, () => f.rt.work(args, restartedChild)));
    expect(new Set(results.map(r => r.planId)).size).toBe(1); expect(nativeCreates).toBe(1);
    await expect(f.rt.work({ ...args, scopeMemo: false }, restartedChild)).rejects.toThrow(/已有进行中/);
    const event2 = { ...await f.rt.repos.calendar.findEvent('event'), event_id: 'event-2' }; await f.rt.repos.calendar.upsertEvent(event2);
    const another = await worker('calendar');
    const competing = await Promise.allSettled([f.rt.work({ ...args, eventId: 'event-2' }, restartedChild), f.rt.work({ ...args, eventId: 'event-2', leadMinutes: 30 }, another)]);
    expect(competing.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(competing.find(row => row.status === 'rejected').reason.message).toContain('已有进行中');
    expect(nativeCreates).toBe(2);
  });

  it.each(['feishu', 'wecom'])('纪要生成重试/旧身份兼容及 %s 两类行动保留真实授权', async channel => {
    f.rt.config.todoChannel = channel; f.rt.config.calendarChannel = channel;
    const child = await worker('memo');
    const args = { action: 'minutes_build', topic: '评审', content: '本人提供记录', candidates: [{ summary: '准备预算' }, { summary: '安排评审', start: '2026-11-01T02:00:00Z', end: '2026-11-01T03:00:00Z' }] };
    const results = await Promise.all(Array.from({ length: 8 }, () => f.rt.work(args, child)));
    const id = results[0].minutesId; expect(new Set(results.map(r => r.minutesId)).size).toBe(1);
    const instruction = '本人确认执行预算和评审两个行动';
    const adopted = await f.rt.work({ action: 'minutes_adopt_actions', minutesId: id, indexes: [0, 1], instruction }, child);
    expect(adopted).toMatchObject({ executed: 2, failed: 0 });
    for (const index of [0, 1]) expect((await f.rt.repos.operations.get(`minutes.action:${id}:${index}`)).params).toMatchObject({ minutesId: id, index, instruction });
    const other = await worker('memo');
    expect(await f.rt.work({ action: 'minutes_adopt_actions', minutesId: id, indexes: [0, 1], instruction: '再次确认' }, other)).toMatchObject({ executed: 2, failed: 0 });
    expect((await f.rt.repos.operations.get(`minutes.action:${id}:0`)).params.instruction).toBe(instruction);
    expect((await f.rt.work({ ...args, revisionKey: '本人要求第二稿' }, child)).minutesId).not.toBe(id);
    const legacy = await f.rt.work({ ...args, content: '旧随机身份的记录' }, child);
    await f.rt.db.query('update pa24.minutes set id = $2 where id = $1', [legacy.minutesId, 'min-legacy']);
    expect((await f.rt.work({ ...args, content: '旧随机身份的记录' }, child)).minutesId).toBe('min-legacy');
    const old = await f.rt.repos.minutes.get('min-legacy'); await f.rt.repos.minutes.insert({ ...old, id: 'min-legacy-second' });
    await f.rt.work({ action: 'minutes_adopt_actions', minutesId: 'min-legacy-second', indexes: [0], instruction: '本人此前只采纳第二份的第一项' }, child);
    const tasksBefore = (await f.rt.repos.tasks.list()).length;
    await expect(f.rt.work({ ...args, content: '旧随机身份的记录' }, child)).rejects.toThrow('多个历史身份');
    expect((await f.rt.repos.tasks.list()).length).toBe(tasksBefore);
    expect((await f.rt.repos.operations.get('minutes.action:min-legacy-second:0')).status).toBe('succeeded');
  });

  it.each([
    { unknown: '候选0“联系李工”的联系人姓氏无法辨认，可能是李工或王工，尚未确认', summary: '联系李工', quote: '联系李/王工', resolved: { summary: '联系王工' } },
    { unknown: '联系人原稿不清', summary: '联系王工', quote: '联系王或李', resolved: { summary: '联系李工' } },
    { unknown: '日期原稿不清', summary: '提交预算', due: '2026-11-02', quote: '下周交', resolved: { summary: '提交预算', due: '2026-11-03' } },
  ])('新旧顶层行动疑点兼容且无关候选不受阻：$unknown', async sample => {
    await note(); const child = { id: (await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId };
    const published = await f.rt.work({ action: 'note_submit', transcript: '联系王或李，原稿不清', summary: '联系负责人', unknowns: [sample.unknown, '会议背景备注不清'], candidates: [{ summary: sample.summary, sourceQuote: sample.quote, ...(sample.due ? { due: sample.due } : {}) }, { summary: '备份确认材料', sourceQuote: '备份材料' }] }, child);
    const version = await f.rt.repos.notes.getVersion(published.versionId);
    expect(version.content.candidates[0].unknowns).toEqual([sample.unknown]); expect(version.content.candidates[1].unknowns).toBeUndefined();
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    // Existing versions did not persist candidate-local associations. Keep the
    // approved snapshot untouched and exercise read-time compatibility.
    delete version.content.candidates[0].unknowns;
    await f.rt.db.query('update pa24.note_version set content = $2 where id = $1', [published.versionId, JSON.stringify(version.content)]);
    const action = { action: 'note_adopt_actions', noteId: 'N-1', versionId: published.versionId, indexes: [0, 1], instruction: '执行第0项和第1项' };
    const first = await f.rt.work(action, child); expect(first).toMatchObject({ executed: 1, failed: 1 }); expect(first.results[0].error).toContain(sample.unknown);
    const clarification = { index: 0, resolutions: [{ unknown: sample.unknown, answer: '本人明确确认最终行动字段' }], resolved: sample.resolved };
    expect(await f.rt.work({ ...action, indexes: [0], clarifications: [clarification] }, child)).toMatchObject({ executed: 1, failed: 0 });
    expect((await f.rt.repos.operations.get('note.action:N-1:v1:0')).params.clarification).toEqual(clarification);
    expect((await f.rt.repos.notes.getVersion(published.versionId)).content.candidates[0].unknowns).toBeUndefined();
  });

  it('混合联系人与日期疑点独立关联，新旧版本均阻止相关候选且允许无关候选', async () => {
    await note(); const child = { id: (await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId };
    const unknown = '联系人和日期原稿不清';
    const published = await f.rt.work({ action: 'note_submit', transcript: '联系王或李，下周交预算', summary: '整理', unknowns: [unknown], candidates: [
      { summary: '联系王工', sourceQuote: '联系王或李' }, { summary: '提交预算', due: '2026-11-02', sourceQuote: '下周交' }, { summary: '备份确认材料' },
    ] }, child);
    const version = await f.rt.repos.notes.getVersion(published.versionId);
    expect(version.content.candidates.map(row => row.unknowns)).toEqual([[unknown], [unknown], undefined]);
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    const action = { action: 'note_adopt_actions', noteId: 'N-1', versionId: published.versionId, indexes: [0, 1, 2], instruction: '执行所选行动' };
    expect(await f.rt.work(action, child)).toMatchObject({ executed: 1, failed: 2 });
    for (const row of version.content.candidates) delete row.unknowns;
    await f.rt.db.query('update pa24.note_version set content = $2 where id = $1', [published.versionId, JSON.stringify(version.content)]);
    expect(await f.rt.work(action, child)).toMatchObject({ executed: 1, failed: 2 });
    expect((await f.rt.repos.tasks.list()).map(row => row.summary)).toEqual(['备份确认材料']);
  });

  it.each(['feishu:task', 'wecom:task', 'feishu:calendar', 'wecom:calendar'])('%s 远端成功后本地失败，不能改澄清或渠道；原意图恢复只建一个对象', async mode => {
    const [channel, kind] = mode.split(':'); f.rt.config.todoChannel = channel; f.rt.config.calendarChannel = channel;
    await note(); const child = { id: (await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId };
    const published = await f.rt.work({ action: 'note_submit', transcript: '联系王或李，下周安排', summary: '整理', candidates: [{ summary: '联系某人', unknowns: ['人名和日期不清'] }] }, child);
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    const resolved = kind === 'task' ? { summary: '联系王工', due: '2026-11-01' } : { summary: '联系王工', start: '2026-11-01T02:00:00Z', end: '2026-11-01T03:00:00Z' };
    const clarification = { index: 0, resolutions: [{ unknown: '人名和日期不清', answer: '王工，11月1日' }], resolved };
    const action = { action: 'note_adopt_actions', noteId: 'N-1', versionId: published.versionId, indexes: [0], instruction: '本人确认王工11月1日' };
    const repository = kind === 'task' ? f.rt.repos.tasks : f.rt.repos.calendar;
    const method = kind === 'task' ? 'save' : 'upsertEvent', originalSave = repository[method].bind(repository);
    let failOnce = true;
    repository[method] = async (...args) => { if (failOnce) { failOnce = false; throw new Error('local projection failed'); } return originalSave(...args); };
    const changed = { ...clarification, resolved: { ...resolved, summary: '联系李工', ...(kind === 'task' ? { due: '2026-11-02' } : { start: '2026-11-02T02:00:00Z', end: '2026-11-02T03:00:00Z' }) } };
    const competing = await Promise.all([
      f.rt.work({ ...action, clarifications: [clarification] }, child),
      f.rt.work({ ...action, versionId: undefined, clarifications: [changed] }, child),
      f.rt.work({ ...action, versionId: '', clarifications: [changed] }, child),
    ]);
    expect(competing[0]).toMatchObject({ executed: 0, failed: 1 }); expect(competing[0].results[0].error).toContain('local projection failed');
    for (const attempt of competing.slice(1)) { expect(attempt).toMatchObject({ executed: 0, failed: 1 }); expect(attempt.results[0].error).toContain('不能在重试中改写'); }
    const channelKey = kind === 'task' ? 'todoChannel' : 'calendarChannel'; f.rt.config[channelKey] = channel === 'feishu' ? 'wecom' : 'feishu';
    expect((await f.rt.work(action, child)).results[0].error).toContain('当前配置已改变'); f.rt.config[channelKey] = channel;
    expect(await f.rt.work({ ...action, instruction: '按原授权恢复' }, child)).toMatchObject({ executed: 1, failed: 0 });
    const op = await f.rt.repos.operations.get('note.action:N-1:v1:0');
    expect(op.params).toMatchObject({ summary: '联系王工', clarification, instruction: action.instruction }); expect(op.status).toBe('succeeded');
    const projected = kind === 'task' ? (await f.rt.repos.tasks.list())[0] : await f.rt.repos.calendar.findEvent(op.receipt.eventId);
    expect(projected.summary).toContain('联系王工');
    const journal = channel === 'feishu' ? (kind === 'task' ? 'lark.json.tasks.jsonl' : 'lark.json.events.jsonl') : (kind === 'task' ? 'wecom.json.todos.jsonl' : 'wecom.json.schedules.jsonl');
    const remote = (await readFile(join(f.root, journal), 'utf8')).trim().split('\n').map(JSON.parse);
    expect(remote).toHaveLength(1); expect(JSON.stringify(remote[0])).toContain('联系王工'); expect(JSON.stringify(remote[0])).not.toContain('联系李工');
  });

  it('候选疑点保留并按关联阻断；明确逐项澄清后执行且存授权，查询故障不变空结果', async () => {
    await note(); const child = { id: (await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId };
    const published = await f.rt.work({ action: 'note_submit', transcript: '有不清楚的人名和日期', summary: '整理', unknowns: ['会议备注不清'], candidates: [{ summary: '联系某人', unknowns: ['人名不清'] }, { summary: '备份确认材料' }] }, child);
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    const action = { action: 'note_adopt_actions', noteId: 'N-1', versionId: published.versionId, indexes: [0, 1], instruction: '本人确认执行所选行动' };
    expect(await f.rt.work(action, child)).toMatchObject({ executed: 1, failed: 1 });
    const clarification = { index: 0, resolutions: [{ unknown: '人名不清', answer: '王工' }], resolved: { summary: '联系王工', due: '2026-11-01' } };
    expect(await f.rt.work({ ...action, indexes: [0], clarifications: [clarification] }, child)).toMatchObject({ executed: 1, failed: 0 });
    expect(await f.rt.work({ ...action, indexes: [0], instruction: '再执行一次' }, child)).toMatchObject({ executed: 1, failed: 0, results: [{ reused: true }] });
    expect((await f.rt.repos.operations.get('note.action:N-1:v1:0')).params).toMatchObject({ noteId: 'N-1', versionId: published.versionId, index: 0, instruction: action.instruction, clarification });
    f.rt.repos.notes.versionsWithDecisions = async () => { throw new Error('source unavailable'); };
    await expect(f.rt.work({ action: 'notes_search', query: 'N-1' }, child)).rejects.toThrow('source unavailable');
  });
});
