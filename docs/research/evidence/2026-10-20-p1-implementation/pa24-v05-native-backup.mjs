import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root=await mkdtemp(join(tmpdir(),'pa24-native-backup-'));const db=new DatabaseSync(join(root,'live.db'));
let reader,restored;
try {
 db.exec('pragma journal_mode=wal; pragma busy_timeout=0; create table marker(id integer primary key, value text); pragma wal_checkpoint(truncate)');
 reader=new DatabaseSync(join(root,'live.db'));reader.exec('begin');reader.prepare('select * from marker').all();
 db.exec("insert into marker values(1,'committed-before-backup')");
 const checkpoint=db.prepare('pragma wal_checkpoint(truncate)').all()[0];assert.equal(checkpoint.busy,1);
 await backup(db,join(root,'snapshot.db'));
 reader.exec('rollback');db.exec("pragma wal_checkpoint(truncate); insert into marker values(2,'next-wal')");
 restored=new DatabaseSync(join(root,'snapshot.db'));assert.deepEqual(restored.prepare('select value from marker order by id').all().map(x=>x.value),['committed-before-backup']);
 await mkdir(join(root,'unwritable-destination'));
 await assert.rejects(backup(db,join(root,'unwritable-destination')));
 assert.equal(db.prepare('select count(*) n from marker').all()[0].n,2);
 console.log(JSON.stringify({node:process.version,sqlite:db.prepare('select sqlite_version() version').all()[0].version,busy:checkpoint.busy,restored:restored.prepare('select * from marker').all(),sourceCount:2,errorControl:'rejected, source unchanged'}));
}finally {restored?.close();reader?.close();db.close();await rm(root,{recursive:true,force:true});}
