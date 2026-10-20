import { writeFile } from 'node:fs/promises';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { startPgCluster } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/pg.mjs';
const pg = await startPgCluster();
const evidence = { scenario: 'One Host switches two workspaces with different owner ids and the same inherited PostgreSQL DSN. Real public bind/delegate/work/control flow in demo mode; no external writes.', results: [] };
try {
  for (const storage of ['sqlite', 'postgres']) {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } });
    try {
      const a = await f.workspace('workspace-owner-a', { storage, ownerOpenId: 'ou_owner_a', enabledWorkers: ['memo'] });
      const b = await f.workspace('workspace-owner-b', { storage, ownerOpenId: 'ou_owner_b', enabledWorkers: ['memo'] });
      await f.rt.bind(a);
      const leadA = f.agents.get(await f.rt.openLocalSession());
      const workA = await f.rt.delegate({ worker: 'memo', title: 'A 的备忘', instruction: '保存 A 的个人材料' }, leadA);
      const saved = await f.rt.work({ action: 'memo_save', topic: 'A_PRIVATE_MARKER', content: '只属于工作区 A 的个人资料' }, { id: workA.workId });
      await f.rt.control({ action: 'stop', workId: workA.workId }, leadA);
      await f.rt.bind(b);
      const leadB = f.agents.get(await f.rt.openLocalSession());
      const workB = await f.rt.delegate({ worker: 'memo', title: 'B 查询资料', instruction: '检索 B 工作区内资料' }, leadB);
      const found = await f.rt.work({ action: 'memo_find', query: 'A_PRIVATE_MARKER' }, { id: workB.workId });
      evidence.results.push({ storage, ownerBefore: 'ou_owner_a', ownerAfter: f.rt.config.ownerOpenId, workspacesDiffer: a !== b, leadSessionsDiffer: leadA.id !== leadB.id, boundToB: f.rt.workspace.statePath === b, savedInA: saved, leakedIntoB: found });
    } finally { await f.cleanup(); }
  }
} finally { await pg.stop(); }
await writeFile('/tmp/pa24-deep2-data-workspace-result.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
