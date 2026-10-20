import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fixture, join, readFile, writeFile } from '../helpers/runtime.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { WorkspaceBackup } from '../../lib/backup.js';

let pg;
const cleanups = [];
beforeAll(async () => { pg = await startPgCluster(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); await pg.query('drop schema if exists pa24 cascade'); });
afterAll(async () => { await pg?.stop(); });

async function savePrivateMemo(rt, agents) {
  const lead = agents.get(await rt.openLocalSession());
  const task = await rt.delegate({ worker: 'memo', title: 'A 的备忘', instruction: '保存 A 的个人材料' }, lead);
  await rt.work({ action: 'memo_save', topic: 'A_PRIVATE_MARKER', content: '只属于工作区 A 的个人资料' }, { id: task.workId });
  await rt.control({ action: 'stop', workId: task.workId }, lead);
}
async function findMemo(rt, agents) {
  const lead = agents.get(await rt.openLocalSession());
  const task = await rt.delegate({ worker: 'memo', title: '查询资料', instruction: '检索本工作区的资料' }, lead);
  const found = await rt.work({ action: 'memo_find', query: 'A_PRIVATE_MARKER' }, { id: task.workId });
  await rt.control({ action: 'stop', workId: task.workId }, lead);
  return found;
}

async function legacyLedger(storage, path, { paths = [path], owners = ['owner-a'], memo = true } = {}) {
  await mkdir(join(path, 'data'), { recursive: true });
  const db = storage === 'sqlite' ? new SqliteDb(join(path, 'data', 'pa24.db')) : new PaDatabase(pg.dsn);
  await db.migrate();
  // Schema 17 adds only the ownership table: removing it recreates schema 16.
  await db.query('drop table pa24.ledger_owner');
  await db.query('delete from pa24.schema_migrations where version = 17');
  const repos = createRepos(db);
  for (const path of paths) await repos.workspaceState.save(path, {});
  for (const owner of owners) await repos.bindings.upsert({ appId: 'app', tenantKey: 'tenant', ownerOpenId: owner, larkProfile: 'default' });
  if (memo) await repos.memos.insert({ id: 'legacy-memo', topic: 'A_PRIVATE_MARKER', content: '只属于工作区 A 的个人资料', source: 'owner' });
  return db;
}

describe.each(['sqlite', 'postgres'])('%s 历史账本与身份恢复', storage => {
  it('联合备份的账本和身份可一起恢复，通过公开绑定检索原资料', async () => {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
    const path = await f.workspace('backup-source', { storage, ownerOpenId: 'owner-a' });
    await f.rt.bind(path); await savePrivateMemo(f.rt, f.agents);
    const sources = { workspace: path, stateDirectory: f.options.stateDirectory };
    for (const name of ['sessions', 'storages', 'attachments']) {
      sources[name] = join(f.root, name); await mkdir(sources[name]);
    }
    const db = storage === 'sqlite' ? new SqliteDb(join(path, 'data', 'pa24.db')) : new PaDatabase(pg.dsn);
    let backup;
    try { backup = await new WorkspaceBackup(sources, db).create(join(f.root, 'backups'), { credentialReferences: [], watermarks: [] }); }
    finally { await db.close(); }
    expect(backup.complete).toBe(true);
    await f.rt.stop();
    const restoredPath = path + '-restored'; await cp(join(backup.backupDir, 'workspace'), restoredPath, { recursive: true });
    let restoreDsn = pg.dsn;
    if (storage === 'sqlite') {
      await mkdir(join(restoredPath, 'data'));
      await cp(join(backup.backupDir, 'pa24.db'), join(restoredPath, 'data', 'pa24.db'));
    } else {
      await pg.query('create database pa24_restore owner pa24_app');
      restoreDsn = pg.dsn.replace('/pa24_test', '/pa24_restore');
      await promisify(execFile)(join(process.env.PA24_PG_BIN || '/opt/homebrew/bin', 'psql'), ['--dbname', restoreDsn, '-v', 'ON_ERROR_STOP=1', '-f', join(backup.backupDir, 'pa24.sql')]);
    }
    const restored = await fixture({ env: { PA24_PG_DSN: restoreDsn } }); cleanups.push(restored.cleanup);
    await restored.rt.bind(restoredPath);
    expect(JSON.stringify(await findMemo(restored.rt, restored.agents))).toContain('只属于工作区 A');
  });

  it('明确单工作区、单主人历史库升级和搬移后仍可检索', async () => {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
    const a = await f.workspace('legacy', { storage, ownerOpenId: 'owner-a' });
    const db = await legacyLedger(storage, a); await db.close();
    await f.rt.bind(a);
    expect(JSON.stringify(await findMemo(f.rt, f.agents))).toContain('只属于工作区 A');
    const before = await readFile(join(a, '.24pa', 'ledger-identity.json'), 'utf8');
    await f.rt.stop();
    await rename(a, a + '-moved');
    const reopened = f.make(); await reopened.bind(a + '-moved');
    expect(JSON.stringify(await findMemo(reopened, f.agents))).toContain('只属于工作区 A');
    expect(await readFile(join(a + '-moved', '.24pa', 'ledger-identity.json'), 'utf8')).toBe(before);
  });

  it.each(['empty', 'unproven', 'mixed-paths', 'mixed-owners', 'wrong-owner'])('schema 16 接纳判定：%s；拒绝不写迁移和业务状态', async scenario => {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
    const a = await f.workspace('legacy-check', { storage, ownerOpenId: 'owner-a' });
    const options = scenario === 'empty' ? { paths: [], owners: [], memo: false }
      : scenario === 'unproven' ? { paths: [a], owners: [] }
      : scenario === 'mixed-paths' ? { paths: [a, '/another-workspace'] }
      : scenario === 'mixed-owners' ? { owners: ['owner-a', 'owner-b'] }
      : { owners: ['owner-b'] };
    const db = await legacyLedger(storage, a, options);
    try {
      if (scenario === 'empty') { await f.rt.bind(a); expect(await db.schemaVersion()).toBe(17); }
      else {
        const paths = (await db.query('select * from pa24.workspace_state')).rows;
        await expect(f.rt.bind(a)).rejects.toThrow(/历史账本归属/);
        expect(f.rt.workspace).toBeNull();
        expect(await db.schemaVersion()).toBe(16);
        expect((await db.query('select * from pa24.workspace_state')).rows).toEqual(paths);
        expect((await createRepos(db).memos.search({ query: 'A_PRIVATE_MARKER' }))[0].content).toContain('只属于工作区 A');
      }
    } finally { await db.close(); }
  });

  it('身份丢失不能按旧路径认领，恢复备份身份才可重新接纳', async () => {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
    const a = await f.workspace('lost-identity', { storage, ownerOpenId: 'owner-a' });
    await f.rt.bind(a); await savePrivateMemo(f.rt, f.agents); await f.rt.stop();
    const identity = join(a, '.24pa', 'ledger-identity.json'), saved = await readFile(identity, 'utf8');
    await rm(identity);
    const reopened = f.make();
    await expect(reopened.bind(a)).rejects.toThrow(/账本.*归属/);
    await writeFile(identity, saved);
    await reopened.bind(a);
    expect(JSON.stringify(await findMemo(reopened, f.agents))).toContain('只属于工作区 A');
  });

  it('归属迁移失败回滚 schema 与原资料，排障后原库可重开并重试', async () => {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
    const path = await f.workspace('migration-failure', { storage, ownerOpenId: 'owner-a' });
    const db = await legacyLedger(storage, path);
    try {
      if (storage === 'sqlite') {
        await db.query("create trigger fail_admission before insert on pa24.schema_migrations when NEW.version = 17 begin select raise(abort, 'forced admission failure'); end");
      } else {
        await db.query("create function pa24.fail_admission() returns trigger language plpgsql as $$ begin if NEW.version = 17 then raise exception 'forced admission failure'; end if; return NEW; end $$");
        await db.query('create trigger fail_admission before insert on pa24.schema_migrations for each row execute function pa24.fail_admission()');
      }
      await expect(f.rt.bind(path)).rejects.toThrow('forced admission failure');
      expect(f.rt.workspace).toBeNull();
      expect(await db.schemaVersion()).toBe(16);
      await expect(db.query('select * from pa24.ledger_owner')).rejects.toThrow();
      expect((await createRepos(db).memos.search({ query: 'A_PRIVATE_MARKER' }))[0].content).toContain('只属于工作区 A');
      await db.query(storage === 'sqlite' ? 'drop trigger fail_admission' : 'drop trigger fail_admission on pa24.schema_migrations');
    } finally { await db.close(); }
    const reopened = f.make(); await reopened.bind(path);
    expect(JSON.stringify(await findMemo(reopened, f.agents))).toContain('只属于工作区 A');
  });

  it('复制同一身份按恢复处理，改主人或损坏身份拒绝；缺失配置不替代归属', async () => {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
    const a = await f.workspace('identity-source', { storage, ownerOpenId: 'owner-a' });
    await f.rt.bind(a); await savePrivateMemo(f.rt, f.agents); await f.rt.stop();
    const copy = a + '-restored'; await cp(a, copy, { recursive: true });
    const restored = f.make(); await restored.bind(copy);
    expect(JSON.stringify(await findMemo(restored, f.agents))).toContain('只属于工作区 A');
    await restored.stop();
    const config = join(copy, 'AGENTS.md'), text = await readFile(config, 'utf8');
    await writeFile(config, text.replace('owner-a', 'owner-b'));
    const wrongOwner = f.make(); await expect(wrongOwner.bind(copy)).rejects.toThrow(/账本.*归属/);
    await writeFile(config, text);
    await writeFile(join(copy, '.24pa', 'ledger-identity.json'), '{broken');
    await expect(wrongOwner.bind(copy)).rejects.toThrow(/身份文件损坏/);
  });
});

it('两个独立进程同时首次声明同一 PG 账本，只有赢家接纳并写业务', async () => {
  const f = await fixture(); cleanups.push(f.cleanup);
  const paths = await Promise.all(['a', 'b'].map(name => f.workspace('race-' + name, { storage: 'postgres', ownerOpenId: 'owner-' + name })));
  const children = paths.map(path => fork(new URL('../helpers/ledger-admission-process.mjs', import.meta.url), [path], {
    execArgv: [], env: { ...process.env, PA24_TEST_PG_DSN: pg.dsn }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  }));
  const exits = children.map(child => once(child, 'exit'));
  try {
    await Promise.all(children.map(child => once(child, 'message')));
    const replies = children.map(child => once(child, 'message'));
    children.forEach(child => child.send('bind'));
    const results = (await Promise.all(replies)).map(([result]) => result);
    expect(results.filter(result => result.accepted)).toHaveLength(1);
    const loser = results.find(result => !result.accepted);
    expect(loser.error).toMatch(/账本.*归属/); expect(loser.sessions).toBe(0);
    expect(loser.error).not.toContain(pg.dsn); expect(loser.error).not.toContain('pa24_app:');
    const winner = results.find(result => result.accepted);
    expect((await pg.query('select count(*) from pa24.memo')).trim()).toBe('1');
    expect((await pg.query('select path from pa24.workspace_state')).trim()).toBe(winner.path);
    expect((await pg.query('select owner_open_id from pa24.ledger_owner')).trim()).toBe(winner.owner);
    expect((await Promise.all(exits)).map(([code]) => code)).toEqual([0, 0]);
  } finally {
    children.forEach(child => { if (child.exitCode === null) child.kill(); });
    await Promise.all(exits);
  }
});

it('同主人不同工作区不能共用 PG；独立 PG 库与默认 SQLite 各自隔离', async () => {
  const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
  const a = await f.workspace('independent-a', { storage: 'postgres', ownerOpenId: 'same-owner' });
  const b = await f.workspace('independent-b', { storage: 'postgres', ownerOpenId: 'same-owner' });
  await f.rt.bind(a); await savePrivateMemo(f.rt, f.agents);
  await expect(f.rt.bind(b)).rejects.toThrow(/账本.*归属/);
  await pg.query('create database pa24_independent owner pa24_app');
  const separate = await fixture({ env: { PA24_PG_DSN: pg.dsn.replace('/pa24_test', '/pa24_independent') } }); cleanups.push(separate.cleanup);
  await separate.rt.bind(b); expect(await findMemo(separate.rt, separate.agents)).toEqual({ count: 0, memos: [] });
  const c = await f.workspace('sqlite-c', { ownerOpenId: 'owner-c' }); await f.rt.bind(c);
  expect(await findMemo(f.rt, f.agents)).toEqual({ count: 0, memos: [] });
});

describe('账本接纳：公开工作区绑定及备忘路径', () => {
  it.each(['sqlite', 'postgres'])('%s 首次登记主人后，配置保存、重载与重绑都不能转让账本', async storage => {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
    const path = await f.workspace('owner-enrollment', { storage });
    await f.rt.bind(path);
    await f.rt.updateWorkspaceConfig({ ownerOpenId: 'owner-first' });
    const file = join(path, 'AGENTS.md'), enrolled = await readFile(file, 'utf8');
    for (const ownerOpenId of ['owner-second', '']) {
      await expect(f.rt.updateWorkspaceConfig({ ownerOpenId })).rejects.toThrow(/主人|归属/);
      expect(await readFile(file, 'utf8')).toBe(enrolled);
    }
    await writeFile(file, enrolled.replace('owner-first', 'owner-second'));
    await expect(f.rt.reloadWorkspace()).rejects.toThrow(/主人|归属/);
    expect(f.rt.config.ownerOpenId).toBe('owner-first');
    await expect(f.rt.bind(path)).rejects.toThrow(/账本.*归属/);
    await writeFile(file, enrolled);
    await f.rt.stop();
    const reopened = f.make(); await reopened.bind(path);
    expect(reopened.config.ownerOpenId).toBe('owner-first');
  });

  it('拒绝不同主人工作区接纳 A 的 PG 账本，保留 A 并允许同一 A 重开', async () => {
    const f = await fixture({ env: { PA24_PG_DSN: pg.dsn } }); cleanups.push(f.cleanup);
    const a = await f.workspace('a', { storage: 'postgres', ownerOpenId: 'owner-a' });
    const b = await f.workspace('b', { storage: 'postgres', ownerOpenId: 'owner-b' });
    await f.rt.bind(a); await savePrivateMemo(f.rt, f.agents);
    const before = await findMemo(f.rt, f.agents);
    expect(JSON.stringify(before)).toContain('只属于工作区 A');
    await expect(f.rt.bind(b)).rejects.toThrow(/账本.*归属/);
    expect(f.rt.workspace.statePath).toBe(a);
    expect(f.rt.config.ownerOpenId).toBe('owner-a');
    expect(await findMemo(f.rt, f.agents)).toEqual(before);
    await f.rt.stop();
    const reopened = f.make();
    await expect(reopened.bind(b)).rejects.toThrow(/账本.*归属/);
    expect(reopened.workspace).toBeNull();
    await reopened.bind(a);
    expect(await findMemo(reopened, f.agents)).toEqual(before);
  });
});
