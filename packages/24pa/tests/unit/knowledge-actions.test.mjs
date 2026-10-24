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
      await writeFile(state, JSON.stringify({ ownerOpenId: 'owner' }));
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

  const edits = [
    { name: '人名', from: '王工', to: '李工' },
    { name: '日期', from: '2026-11-02', to: '2026-11-03' },
    { name: '删除候选', from: '<li>备份材料</li>', to: '' },
    { name: '疑点', from: '人名原稿不清', to: '人名已核对但日期仍不清' },
  ];
  it.each(['first', 'republish'].flatMap(phase => edits.map(edit => ({ phase, ...edit }))))('V01 $phase 的$name变化不能沿用旧派生内容', async sample => {
    await note();
    if (sample.phase === 'first') await writeFile(join(f.root, 'lark.json'), JSON.stringify({ ownerOpenId: 'owner', docCreateEdits: [sample] }));
    const child = f.agents.get((await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId);
    let published = await f.rt.work({ action: 'note_submit', transcript: '联系王工，2026-11-02交付', summary: '联系王工', unknowns: ['人名原稿不清'],
      suggestions: ['优先联系王工'], relativeDates: [{ original: '周一', interpretation: '2026-11-02' }],
      candidates: [{ summary: '联系王工', due: '2026-11-02' }, { summary: '备份材料' }] }, child);
    const approve = async id => {
      const token = (await f.rt.repos.notes.tokensOf(id)).find(row => row.action === 'approve').token;
      await f.rt.handwriting.processReviewCard('approve-' + id, { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    };
    let oldDecisions = [];
    if (sample.phase === 'republish') {
      await approve(published.versionId); oldDecisions = await f.rt.repos.notes.decisionsOf('N-1');
      const old = await f.rt.repos.notes.getVersion(published.versionId);
      const journal = join(f.root, 'lark.json.docs.jsonl'), docs = (await readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse);
      const latest = docs.filter(row => row.id === old.doc_id).at(-1);
      await writeFile(journal, JSON.stringify({ ...latest, content: latest.content.replaceAll(sample.from, sample.to), revision: latest.revision + 1 }) + '\n', { flag: 'a' });
      published = await f.rt.notesTool({ action: 'republish', noteId: 'N-1' }, local);
    }
    const version = await f.rt.repos.notes.getVersion(published.versionId);
    expect(version.doc_snapshot).not.toContain(sample.from);
    if (sample.to) expect(version.doc_snapshot).toContain(sample.to);
    const card = (await f.rt.repos.outbox.recent(20)).find(row => row.dedup_key.startsWith(`notereview:N-1:v${version.version}:`));
    expect(JSON.stringify(card.content)).toContain('仅批准正文');
    await approve(published.versionId);
    expect((await f.rt.repos.notes.getVersion(published.versionId)).status).toBe('approved');
    const waiting = await f.rt.work({ action: 'note_adopt_actions', noteId: 'N-1', versionId: published.versionId, indexes: [0], instruction: '执行第一项' }, child);
    expect(waiting).toMatchObject({ status: 'waiting', businessExecuted: false }); expect(waiting.reason).toMatch(/同源|重建/);
    expect(version.content).toMatchObject({ derivedStatus: 'needs_rebuild', summary: '', transcript: '', candidates: [], unknowns: [], suggestions: [], relativeDates: [], pages: [], doubts: [], diagrams: [] });
    const search = await f.rt.work({ action: 'notes_search', query: 'N-1' }, await worker('handwriting'));
    expect(search.items.find(row => row.version === version.version)).toMatchObject({ summary: '', candidates: [], derivedStatus: 'needs_rebuild' });
    const overview = await f.rt.work({ action: 'overview_today' }, await worker('calendar'));
    expect(overview.reviewedNotes).toEqual([]); expect(overview.missing.join('')).toContain('摘要/候选尚未重建');
    expect((await f.rt.reviewQueue()).history.find(row => row.version === version.version)).toMatchObject({ summary: '', derivedStatus: 'needs_rebuild' });
    expect(await f.rt.repos.tasks.list()).toEqual([]);
    const notices = await f.rt.repos.outbox.recent(20);
    expect(notices.filter(row => row.dedup_key.startsWith('review:')).map(row => row.content.text).join('')).toContain('仅批准正文');
    if (oldDecisions.length) expect((await f.rt.repos.notes.decisionsOf('N-1')).find(row => row.version_id === 'N-1:v1')).toEqual(oldDecisions[0]);
  });

  it.each([false, true])('V01 未改正文或仅平台元数据变化可审核后选定执行（metadata=%s）', async metadata => {
    await note();
    if (metadata) await writeFile(join(f.root, 'lark.json'), JSON.stringify({ ownerOpenId: 'owner', docCreateEdits: [{ from: '<p>', to: '<p block-id="platform-id" render-time="now">' }] }));
    const child = f.agents.get((await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId);
    const published = await f.rt.work({ action: 'note_submit', transcript: '联系王工', summary: '联系王工', candidates: [{ summary: '联系王工' }] }, child);
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    expect(await f.rt.repos.tasks.list()).toEqual([]);
    expect((await f.rt.work({ action: 'notes_search', query: '王工' }, child)).items[0]).toMatchObject({ summary: '联系王工', derivedStatus: 'ready', currentValidity: 'matches' });
    const overview = await f.rt.work({ action: 'overview_today' }, await worker('calendar'));
    expect(overview.reviewedNotes).toMatchObject([{ summary: '联系王工', version: 1 }]);
    expect(await f.rt.work({ action: 'note_adopt_actions', noteId: 'N-1', versionId: published.versionId, indexes: [0], instruction: '执行第一项' }, child)).toMatchObject({ executed: 1, failed: 0 });
    expect((await f.rt.repos.tasks.list()).map(row => row.summary)).toEqual(['联系王工']);
  });

  it.each(['refresh', 'click'])('V01 升级前待审卡在 %s 时换发正文卡，旧按钮不能批准', async mode => {
    await note(); const child = f.agents.get((await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId);
    const published = await f.rt.work({ action: 'note_submit', transcript: '联系王工', summary: '联系王工', candidates: [{ summary: '联系王工' }] }, child);
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    const oldToken = token.replace(/:(body|derived)$/, '');
    await f.rt.db.query('update pa24.review_token set token = $2 where token = $1', [token, oldToken]);
    const version = await f.rt.repos.notes.getVersion(published.versionId); delete version.content.derivation; delete version.content.derivedStatus;
    await f.rt.db.query('update pa24.note_version set content = $2 where id = $1', [version.id, JSON.stringify(version.content)]);
    if (mode === 'refresh') await f.rt.notesTool({ action: 'republish', noteId: 'N-1' }, local);
    const click = token => f.rt.handwriting.processReviewCard('click-' + token, { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    await click(oldToken);
    expect((await f.rt.repos.notes.getVersion(version.id)).status).toBe('pending_review');
    expect(await f.rt.repos.notes.decisionsOf('N-1')).toEqual([]);
    const cards = (await f.rt.repos.outbox.recent(30)).filter(row => row.dedup_key.startsWith('notereview:N-1:v1:'));
    expect(cards).toHaveLength(2);
    const replacement = cards.find(row => JSON.stringify(row.content).includes('仅批准正文'));
    expect(replacement).toBeTruthy(); expect(JSON.stringify(replacement.content)).not.toContain('联系王工');
    const current = (await f.rt.repos.notes.tokensOf(version.id)).find(row => row.action === 'approve' && row.token !== oldToken);
    await click(current.token);
    expect((await f.rt.repos.notes.getVersion(version.id)).status).toBe('approved');
    const waiting = await f.rt.work({ action: 'note_adopt_actions', noteId: 'N-1', versionId: version.id, indexes: [0], instruction: '执行第一项' }, child);
    expect(waiting).toMatchObject({ status: 'waiting', businessExecuted: false }); expect(waiting.reason).toMatch(/同源|重建/);
  });

  it.each(['legacy', 'changed-derived'])('V01 %s 已批准版本不能继承未证实的候选，历史凭证保留', async mode => {
    await note(); const child = f.agents.get((await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId);
    const published = await f.rt.work({ action: 'note_submit', transcript: '联系王工', summary: '联系王工', candidates: [{ summary: '联系王工' }] }, child);
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    const before = await f.rt.repos.notes.decisionsOf('N-1'), version = await f.rt.repos.notes.getVersion(published.versionId);
    if (mode === 'legacy') { delete version.content.derivation; delete version.content.derivedStatus; }
    else version.content.candidates[0].summary = '联系李工';
    await f.rt.db.query('update pa24.note_version set content = $2 where id = $1', [version.id, JSON.stringify(version.content)]);
    const waiting = await f.rt.work({ action: 'note_adopt_actions', noteId: 'N-1', versionId: version.id, indexes: [0], instruction: '执行第一项' }, child);
    expect(waiting).toMatchObject({ status: 'waiting', businessExecuted: false }); expect(waiting.reason).toMatch(/同源|重建/);
    expect((await f.rt.work({ action: 'notes_search', query: 'N-1' }, await worker('handwriting'))).items[0]).toMatchObject({ summary: '', candidates: [], derivedStatus: 'needs_rebuild' });
    expect(await f.rt.repos.tasks.list()).toEqual([]);
    expect(await f.rt.repos.notes.decisionsOf('N-1')).toEqual(before);
    expect((await f.rt.repos.notes.getVersion(version.id)).status).toBe('approved');
  });

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
    await writeFile(join(f.root, 'lark.json.events.jsonl'), JSON.stringify({ event_id: 'event', calendar_id: 'calendar', summary: '评审会', start: start.toISOString(), end: end.toISOString(), status: 'active' }) + '\n');
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
    await writeFile(join(f.root, 'lark.json.events.jsonl'), JSON.stringify({ event_id: 'event-2', calendar_id: 'calendar', summary: '评审会', start: start.toISOString(), end: end.toISOString(), status: 'active' }) + '\n', { flag: 'a' });
    const another = await worker('calendar');
    const competing = await Promise.allSettled([f.rt.work({ ...args, eventId: 'event-2' }, restartedChild), f.rt.work({ ...args, eventId: 'event-2', leadMinutes: 30 }, another)]);
    expect(competing.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(competing.find(row => row.status === 'rejected').reason.message).toContain('已有进行中');
    expect(nativeCreates).toBe(2);
  });

  it('会前准备按原身份与日历匹配，原生 ID 碰撞和未变化的回读不会误停其他计划', async () => {
    const original = { identityKey: 'feishu:owner', platform: 'feishu', resource: { kind: 'calendar', id: 'calendar' } };
    for (const [id, target] of [['original', original], ['other-calendar', { ...original, resource: { kind: 'calendar', id: 'project' } }], ['other-owner', { ...original, identityKey: 'feishu:other' }], ['other-platform', { ...original, platform: 'wecom' }]]) {
      await f.rt.repos.digests.insertPlan({ id, kind: 'meeting_prep', title: id, schedule_id: null, session_id: f.rt.accessSessionId,
        schedule_spec: { eventId: 'same-native', eventFingerprint: 'unchanged', sourceTarget: target }, status: 'active', last_window: null, voice: false, skill: 'meeting-prep' });
    }
    await f.rt.stopChangedMeetingPreps('same-native', 'changed');
    expect((await f.rt.repos.digests.listPlans('active'))).toHaveLength(4);
    await f.rt.stopChangedMeetingPreps('same-native', 'unchanged', original);
    expect((await f.rt.repos.digests.listPlans('active'))).toHaveLength(4);
    await f.rt.stopChangedMeetingPreps('same-native', 'changed', original);
    expect((await f.rt.repos.digests.getPlan('original')).status).toBe('stopped');
    expect((await f.rt.repos.digests.listPlans('active')).map(row => row.id).sort()).toEqual(['other-calendar', 'other-owner', 'other-platform']);
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
  ])('顶层行动疑点关联且无关候选不受阻，修改派生后阻断：$unknown', async sample => {
    await note(); const child = f.agents.get((await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId);
    const published = await f.rt.work({ action: 'note_submit', transcript: '联系王或李，原稿不清', summary: '联系负责人', unknowns: [sample.unknown, '会议背景备注不清'], candidates: [{ summary: sample.summary, sourceQuote: sample.quote, ...(sample.due ? { due: sample.due } : {}) }, { summary: '备份确认材料', sourceQuote: '备份材料' }] }, child);
    const version = await f.rt.repos.notes.getVersion(published.versionId);
    expect(version.content.candidates[0].unknowns).toEqual([sample.unknown]); expect(version.content.candidates[1].unknowns).toBeUndefined();
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    const action = { action: 'note_adopt_actions', noteId: 'N-1', versionId: published.versionId, indexes: [0, 1], instruction: '执行第0项和第1项' };
    const first = await f.rt.work(action, child); expect(first).toMatchObject({ executed: 1, failed: 1 }); expect(first.results[0].error).toContain(sample.unknown);
    const clarification = { index: 0, resolutions: [{ unknown: sample.unknown, answer: '本人明确确认最终行动字段' }], resolved: sample.resolved };
    expect(await f.rt.work({ ...action, indexes: [0], clarifications: [clarification] }, child)).toMatchObject({ executed: 1, failed: 0 });
    expect((await f.rt.repos.operations.get('note.action:N-1:v1:0')).params.clarification).toEqual(clarification);
    // Historical payloads without these associations cannot inherit a proof
    // bound to a different payload, even when their body approval survives.
    delete version.content.candidates[0].unknowns;
    await f.rt.db.query('update pa24.note_version set content = $2 where id = $1', [published.versionId, JSON.stringify(version.content)]);
    const waiting = await f.rt.work(action, child);
    expect(waiting).toMatchObject({ status: 'waiting', businessExecuted: false }); expect(waiting.reason).toMatch(/同源|重建/);
    expect((await f.rt.repos.notes.getVersion(published.versionId)).content.candidates[0].unknowns).toBeUndefined();
  });

  it('混合联系人与日期疑点独立关联，派生变更后不能沿用原批准', async () => {
    await note(); const child = f.agents.get((await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId);
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
    const waiting = await f.rt.work(action, child);
    expect(waiting).toMatchObject({ status: 'waiting', businessExecuted: false }); expect(waiting.reason).toMatch(/同源|重建/);
    expect((await f.rt.repos.tasks.list()).map(row => row.summary)).toEqual(['备份确认材料']);
  });

  it.each(['feishu:task', 'wecom:task', 'feishu:calendar', 'wecom:calendar'])('%s 远端成功后本地失败，不能改澄清；渠道配置变化仍按原意图恢复', async mode => {
    const [channel, kind] = mode.split(':'); f.rt.config.todoChannel = channel; f.rt.config.calendarChannel = channel;
    await note(); const child = f.agents.get((await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId);
    const published = await f.rt.work({ action: 'note_submit', transcript: '联系王或李，下周安排', summary: '整理', candidates: [{ summary: '联系某人', unknowns: ['人名和日期不清'] }] }, child);
    const token = (await f.rt.repos.notes.tokensOf(published.versionId)).find(row => row.action === 'approve').token;
    await f.rt.handwriting.processReviewCard('approve', { senderOpenId: 'owner', cardAction: { value: { pa24: 'review', token } } });
    const resolved = kind === 'task' ? { summary: '联系王工', due: '2026-11-01' } : { summary: '联系王工', start: '2026-11-01T02:00:00Z', end: '2026-11-01T03:00:00Z' };
    const clarification = { index: 0, resolutions: [{ unknown: '人名和日期不清', answer: '王工，11月1日' }], resolved };
    const action = { action: 'note_adopt_actions', noteId: 'N-1', versionId: published.versionId, indexes: [0], instruction: '本人确认王工11月1日' };
    const repository = kind === 'task' ? f.rt.repos.sourceProjection : f.rt.repos.calendar;
    const method = kind === 'task' ? 'recordReceipt' : 'upsertEvent', originalSave = repository[method].bind(repository);
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
    expect(await f.rt.work(action, child)).toMatchObject({ executed: 1, failed: 0 });
    expect(await f.rt.work({ ...action, instruction: '按原授权恢复' }, child)).toMatchObject({ executed: 1, failed: 0 });
    const op = await f.rt.repos.operations.get('note.action:N-1:v1:0');
    expect(op.params).toMatchObject({ summary: '联系王工', clarification, instruction: action.instruction }); expect(op.status).toBe('succeeded');
    const projected = kind === 'task' ? (await f.rt.repos.sourceProjection.todoLocations(op.receipt.guid))[0]?.body : await f.rt.repos.calendar.findEvent(op.receipt.eventId);
    expect(projected.summary).toContain('联系王工');
    const journal = channel === 'feishu' ? (kind === 'task' ? 'lark.json.tasks.jsonl' : 'lark.json.events.jsonl') : (kind === 'task' ? 'wecom.json.todos.jsonl' : 'wecom.json.schedules.jsonl');
    const remote = (await readFile(join(f.root, journal), 'utf8')).trim().split('\n').map(JSON.parse);
    expect(remote).toHaveLength(1); expect(JSON.stringify(remote[0])).toContain('联系王工'); expect(JSON.stringify(remote[0])).not.toContain('联系李工');
  });

  it('候选疑点保留并按关联阻断；明确逐项澄清后执行且存授权，查询故障不变空结果', async () => {
    await note(); const child = f.agents.get((await f.rt.delegate({ worker: 'handwriting', noteId: 'N-1', title: '整理', instruction: '整理原稿' }, local)).workId);
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
