import { writeFile } from 'node:fs/promises';
import { fixture } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/runtime.mjs';
import { startPgCluster } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/tests/helpers/pg.mjs';
const pg = await startPgCluster();
const evidence = { node: process.version, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, results: [] };
try {
  for (const storage of ['sqlite', 'postgres']) {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } });
    try {
      const a = await f.workspace('a', { storage, enabledWorkers: ['memo'] });
      await f.rt.bind(a);
      const work = await f.rt.repos.workItems.insert({ id: `memo-${storage}`, title: '日期检索', role: 'memo', instruction: '检索备忘', origin: 'local', parent_session_id: 'parent', child_session_id: `memo-${storage}`, delivery: 'local:parent', status: 'running' });
      const memo = await f.rt.repos.memos.insert({ id: `m-${storage}`, work_item_id: work.id, topic: '季度评审', content: '日期应当保留年月日', doc_url: null, doc_id: null, doc_revision: null, source: 'user', occurred_on: '2026-10-19' });
      const actual = await f.rt.work({ action: 'memo_find', query: '季度评审' }, { id: work.id });
      evidence.results.push({ storage, repositoryValue: memo.occurred_on, repositoryValueType: typeof memo.occurred_on, isDate: memo.occurred_on instanceof Date, rawString: String(memo.occurred_on), toolResult: actual });
    } finally { await f.cleanup(); }
  }
} finally { await pg.stop(); }
await writeFile('/tmp/pa24-deep2-data-date-result.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
