import { createRequire } from 'node:module';
import { parentPort, workerData } from 'node:worker_threads';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const progress = new Int32Array(workerData.progress);
const db = new DatabaseSync(workerData.path);
db.exec('pragma busy_timeout = 5000');
parentPort.once('message', () => {
  try {
    for (let version = 1; version <= 25; version++) {
      db.exec(`begin immediate; update backup_left set version=${version}; update backup_right set version=${version}; commit`);
      Atomics.add(progress, 0, 1);
      Atomics.wait(progress, 1, 0, 2);
    }
  } finally { db.close(); parentPort.close(); }
});
parentPort.postMessage('ready');
