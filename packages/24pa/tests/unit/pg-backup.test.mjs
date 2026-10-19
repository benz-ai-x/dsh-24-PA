import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PaDatabase } from '../../lib/pg.js';
import { startPgCluster } from '../helpers/pg.mjs';

it('真实 LATIN1 库备份可恢复原始文字，不能经 UTF-8 有损解码', async () => {
  const cluster = await startPgCluster();
  const admin = new PaDatabase(cluster.superDsn);
  const sourceDsn = cluster.superDsn.replace('/pa24_test', '/source_latin1');
  const restoreDsn = cluster.superDsn.replace('/pa24_test', '/restore_latin1');
  const source = new PaDatabase(sourceDsn), restored = new PaDatabase(restoreDsn);
  try {
    for (const name of ['source_latin1', 'restore_latin1']) {
      await admin.query(`create database ${name} encoding 'LATIN1' template template0 lc_collate 'C' lc_ctype 'C'`);
    }
    await source.query("create schema pa24; create table pa24.example (label text); insert into pa24.example values ('café')");
    const [part] = await source.backup();
    expect(part.bytes.includes(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe(true);
    const dump = join(cluster.dir, 'dump.sql');
    await writeFile(dump, part.bytes);
    await promisify(execFile)(join(process.env.PA24_PG_BIN || '/opt/homebrew/bin', 'psql'), ['--dbname', restoreDsn, '-v', 'ON_ERROR_STOP=1', '-f', dump], { timeout: 30_000 });
    expect((await restored.query('select label from pa24.example')).rows).toEqual([{ label: 'café' }]);
  } finally {
    await Promise.all([admin.close(), source.close(), restored.close()]);
    await cluster.stop();
  }
});
