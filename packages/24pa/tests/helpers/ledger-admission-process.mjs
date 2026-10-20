// A separate OS process, through the public Runtime boundary, for first-use
// admission races. No process-local lock can serialize these participants.
import { once } from 'node:events';
import { fixture } from './runtime.mjs';
const f = await fixture({ env: { PA24_PG_DSN: process.env.PA24_TEST_PG_DSN } });
const path = process.argv[2];
try {
  const start = once(process, 'message');
  process.send({ ready: true }); await start;
  try {
    await f.rt.bind(path);
    const lead = f.agents.get(await f.rt.openLocalSession());
    const work = await f.rt.delegate({ worker: 'memo', title: '竞争赢家', instruction: '保存赢家标记' }, lead);
    await f.rt.work({ action: 'memo_save', topic: 'winner', content: f.rt.config.ownerOpenId }, { id: work.workId });
    await f.rt.control({ action: 'stop', workId: work.workId }, lead);
    process.send({ accepted: true, path, owner: f.rt.config.ownerOpenId });
  } catch (error) { process.send({ accepted: false, path, error: error.message, sessions: f.agents.size }); }
} finally { await f.cleanup(); process.disconnect(); }
