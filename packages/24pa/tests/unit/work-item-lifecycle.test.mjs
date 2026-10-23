import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { WorkItemLifecycle } from '../../lib/work-item-lifecycle.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`WorkItem lifecycle / ${backend}`, () => {
  let db, repos, cluster, root, lifecycle, starts, resumes, interrupts, failStart, failResume;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); }
    else { root = await mkdtemp(join(tmpdir(), 'pa24-lifecycle-')); db = new SqliteDb(join(root, 'pa24.db')); }
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
  beforeEach(async () => {
    await db.query('delete from pa24.outbox'); await db.query('delete from pa24.work_item');
    starts = []; resumes = []; interrupts = []; failStart = new Set(); failResume = false;
    lifecycle = new WorkItemLifecycle({ repo: () => repos.workItems, maxWorkers: () => 1, available: () => true,
      start: async item => { starts.push(item.id); if (failStart.has(item.id)) throw new Error('start unavailable'); },
      resume: async (item, input) => { resumes.push({ id: item.id, parent: item.parent_session_id, child: item.child_session_id, input }); if (failResume) throw new Error('send unavailable'); },
      interrupt: item => interrupts.push(item.id), track: () => {},
    });
  });
  const item = (id, status = 'queued') => repos.workItems.insert({ id, title: id, role: 'memo', instruction: 'save', origin: 'local',
    parent_session_id: 'original-parent', child_session_id: `child-${id}`, delivery: 'local:original-parent', status });
  const finish = (id, failed = false) => lifecycle.finish(id, { output: failed ? 'failed output' : 'completed output', failed,
    delivery: row => ({ dedupKey: `workitem:${row.id}:t1`, channel: 'local', target: row.parent_session_id, kind: 'text', content: { text: 'result' } }) });

  it('concurrent pumps keep one running worker and completion/stop refill FIFO slots', async () => {
    await item('a'); await item('b'); await item('c');
    await Promise.all(Array.from({ length: 8 }, () => lifecycle.pump()));
    expect(starts).toEqual(['a']); expect(await repos.workItems.countByStatus('running')).toBe(1);
    await finish('a'); expect(starts).toEqual(['a', 'b']);
    await lifecycle.stop('b'); expect(starts).toEqual(['a', 'b', 'c']); expect(interrupts).toEqual(['b']);
    expect((await repos.outbox.recent())[0]).toMatchObject({ channel: 'local', target: 'original-parent', status: 'pending' });
  });
  it('start failure and failed turns release capacity', async () => {
    failStart.add('a'); await item('a'); await item('b'); await item('c');
    await lifecycle.pump(); expect(starts).toEqual(['a', 'b']);
    expect((await repos.workItems.get('a')).status).toBe('failed');
    await finish('b', true); expect(starts).toEqual(['a', 'b', 'c']);
    expect((await repos.workItems.get('b')).result).toBe('failed output');
  });
  it('continuation failure restores status; supplements cannot bypass the capacity gate', async () => {
    await item('a', 'completed'); failResume = true;
    await expect(lifecycle.resume('a', 'continue')).rejects.toThrow('send unavailable');
    expect((await repos.workItems.get('a')).status).toBe('completed');
    failResume = false; await item('b'); await lifecycle.pump();
    await expect(lifecycle.resume('a', 'supplement', true)).rejects.toThrow('已停止或结束');
    expect((await repos.workItems.get('a')).status).toBe('completed');
    await lifecycle.resume('b', 'supplement', true);
    expect(resumes.at(-1)).toMatchObject({ id: 'b', child: 'child-b', parent: 'original-parent' });
  });
  it('restart consumes accepted/queued work without resurrecting stopped items', async () => {
    await item('a', 'stopped'); await item('b', 'accepted'); await item('c');
    await lifecycle.recover(); expect(starts).toEqual(['b']);
    expect((await repos.workItems.get('a')).status).toBe('stopped');
    await expect(lifecycle.resume('a', 'reply', true)).rejects.toThrow('停止');
  });
  it('failed restart input becomes visible reconciliation work and releases a slot', async () => {
    await item('a', 'running'); await item('b'); failResume = true;
    await lifecycle.recover(); expect(starts).toEqual(['b']);
    expect(await repos.workItems.get('a')).toMatchObject({ status: 'needs_reconciliation', recovery_gen: 1 });
  });
  it('result state and durable delivery roll back together; repeated turn does not redeliver', async () => {
    await item('a', 'running');
    await expect(lifecycle.finish('a', { output: 'result', delivery: () => ({ dedupKey: null, channel: 'local', target: 'parent', kind: 'text', content: {} }) })).rejects.toThrow();
    expect((await repos.workItems.get('a')).status).toBe('running');
    await finish('a'); await finish('a');
    expect(await repos.outbox.recent()).toHaveLength(1);
  });
});
