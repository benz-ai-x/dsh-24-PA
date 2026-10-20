import { chmod } from 'node:fs/promises';
import { fixture, join, writeFile } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { FakeFeishuTransport } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/feishu.js';
import { sha256Hex } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/handwriting.js';
const f = await fixture();
const originalGet = f.ctx.get; f.ctx.get = name => name === 'attachments' ? { admitPromptContent: async blocks => blocks } : originalGet(name);
try {
  const bin = join(f.root, 'stub-lark');
  await writeFile(join(f.root, 'lark.json'), '{}');
  await writeFile(bin, '#!/usr/bin/env node\nprocess.env.PA24_LARK_STUB_STATE=' + JSON.stringify(join(f.root, 'lark.json')) + ';\nawait import("/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/stub-lark-cli.mjs");\n');
  await chmod(bin, 0o755); f.options.larkCliBin = bin;
  const path = await f.workspace('a', { mode: 'feishu', ownerOpenId: 'owner', tasklistId: 'list', calendarId: 'calendar', folderToken: 'folder', enabledWorkers: ['handwriting'], workerModels: { handwriting: { provider: 'test', model: 'vision-test' } } });
  await f.rt.bind(path); f.rt.transport = new FakeFeishuTransport('test');
  const local = f.agents.get(await f.rt.openLocalSession());
  const bytes = Buffer.from([137,80,78,71,13,10,26,10]), original = join(f.root, 'original.png'); await writeFile(original, bytes);
  await f.rt.repos.notes.insertNote({ id: 'N-1', title: 'legacy', origin: 'feishu' });
  await f.rt.repos.notes.insertPage({ note_id:'N-1',page_no:1,message_id:'image',image_key:'image',media_type:'image/png',byte_size:bytes.length,sha256:sha256Hex(bytes),storage_path:original,source_type:'image',quality:null,status:'saved' });
  const child = { id:(await f.rt.delegate({worker:'handwriting',noteId:'N-1',title:'整理',instruction:'整理原稿'},local)).workId };
  const pub = await f.rt.work({action:'note_submit',transcript:'联系王工',summary:'联系王工',candidates:[{summary:'联系王工'}]},child);
  const v = await f.rt.repos.notes.getVersion(pub.versionId); delete v.content.derivation; delete v.content.derivedStatus;
  await f.rt.db.query('update pa24.note_version set content = $2 where id = $1',[v.id,JSON.stringify(v.content)]);
  const refresh = await f.rt.notesTool({action:'republish',noteId:'N-1'},local);
  const cards = (await f.rt.repos.outbox.recent(30)).filter(r=>r.dedup_key.startsWith('notereview:N-1:'));
  console.log(JSON.stringify({refresh,cards:cards.map(r=>({key:r.dedup_key,content:r.content})),derived:(await f.rt.reviewQueue()).history.find(r=>r.noteId==='N-1').derivedStatus}));
} finally { await f.cleanup(); }
