import { SqliteDb } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/sqlite.js';
import { WorkspaceBackup } from '/Users/pc2026/.codex/worktrees/main-final-architecture/dsh-24-PA/packages/24pa/lib/backup.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=await mkdtemp(join(tmpdir(),'pa24-backup-complete-'));
const sources=Object.fromEntries(['workspace','stateDirectory','sessions','storages','attachments'].map(k=>[k,join(root,k)]));
for(const path of Object.values(sources)) await mkdir(path);
await mkdir(join(sources.workspace,'.24pa'));
await writeFile(join(sources.workspace,'AGENTS.md'),'# owner rules');
const path=join(root,'live.db'),db=new SqliteDb(path);
let reader;
try {
 await db.migrate();
 await db.query('create table test_a (id integer primary key, value text)');
 await db.query('create table test_b (id integer primary key, value text)');
 db.checkpoint();
 reader=new DatabaseSync(path);
 reader.exec('begin'); reader.prepare('select * from test_a').all();
 await db.query("insert into test_a values (1, 'committed-before-backup')");
 const original=fs.promises.readFile;
 fs.promises.readFile=async function(p,...args){
  const bytes=await original.call(this,p,...args);
  if(String(p)===path){
   reader.exec('rollback'); db.checkpoint();
   await db.query("insert into test_b values (1, 'new-wal-generation')");
  }
  return bytes;
 };
 syncBuiltinESMExports();
 let result;
 try {result=await new WorkspaceBackup(sources,db).create(join(root,'backups'),{credentialReferences:[],watermarks:[]});}
 finally{fs.promises.readFile=original;syncBuiltinESMExports();}
 const restored=new DatabaseSync(join(result.backupDir,'pa24.db'));
 const output={complete:result.complete,failures:result.failures,liveA:(await db.query('select * from test_a')).rows,restoredA:restored.prepare('select * from test_a').all(),restoredB:restored.prepare('select * from test_b').all(),integrity:restored.prepare('pragma integrity_check').all(),scope:'Read I/O seam controlled: after main file copied, external reader retires, checkpoint truncates WAL, next committed write creates a new WAL generation.'};
 restored.close();
 await writeFile('/tmp/pa24-backup-complete-result.json',JSON.stringify(output,null,2));
 console.log(JSON.stringify(output,null,2));
} finally {reader?.close();await db.close();await rm(root,{recursive:true,force:true});}
