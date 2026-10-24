import { Context } from '@deepseek-ai/cordis';
import { mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import type { DshContext } from './host.js';

export interface BackupSessionReference { id: string; parent?: string | null; cwd?: string }

/** Uses the installed native providers in an independent scope with no Agent,
 * controller, model, scheduler, transport or outbox consumer. */
export async function inspectBackupSessions(host: DshContext, directory: string, references: BackupSessionReference[], files: string[]) {
  const loader = host.get('loader') as { import(name: string, base: string, options: object): Promise<any> } | undefined;
  if (!loader?.import) throw new Error('宿主未提供可加载隔离原生会话读取器的 Loader；会话兼容性未检查。');
  const compressed = files.some(path => path.endsWith('.zstd'));
  const plain = files.some(path => /session(?:\.v\d+)?\.jsonl$/.test(path));
  if (compressed && plain) throw new Error('会话集合混合物理编码，需核对原生 provider 配置。');
  const provider = await loader.import('@deepseek-ai/dsh-session-persistence-jsonl', import.meta.url, {});
  const isolated = new Context();
  const failures: string[] = [], formats = new Set<number>(), attachmentRefs = new Map<string, any>();
  let checked = 0, attachments = 0;
  const collect = (value: unknown, depth = 0): void => {
    if (depth > 100 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => collect(item, depth + 1)); return; }
    const row = value as Record<string, any>;
    if (['file', 'image'].includes(row.type) && row.attachment?.attachmentId) attachmentRefs.set(`${row.type}:${row.attachment.attachmentId}`, { kind: row.type, ref: row.attachment });
    Object.values(row).forEach(item => collect(item, depth + 1));
  };
  try {
    await isolated.plugin(provider.default ?? provider, { root: join(directory, 'sessions'), compression: compressed ? 'zstd' : 'none', listConcurrency: 4 });
    const persistence = isolated.get('sessionPersistence') as any;
    // Validate the entire collected session set; required references separately
    // prove that an absent session isn't mistaken for an empty collection.
    const catalog = await persistence.list();
    const refs = new Map<string, BackupSessionReference>(references.map(row => [row.id, row]));
    for (const row of catalog) if (!refs.has(row.header.id)) refs.set(row.header.id, { id: row.header.id });
    for (const ref of refs.values()) {
      let handle: any;
      try {
        handle = await persistence.open(ref.id, 'read');
        if (handle.header.id !== ref.id || (ref.cwd && handle.header.cwd !== ref.cwd)) throw new Error('会话身份或原工作区路径不符');
        const parent = typeof handle.header.parentSession === 'string' ? handle.header.parentSession : handle.header.parentSession?.id;
        if (ref.parent !== undefined && (parent ?? null) !== ref.parent) throw new Error('父会话关系不符');
        formats.add(Number(handle.header.version));
        collect((await handle.read(0)).events);
        checked += 1;
      } catch (error) { failures.push(`会话 ${ref.id}：${(error as Error).name === 'SessionPersistenceNotFoundError' ? '必要会话缺失' : (error as Error).message}`); }
      finally { await handle?.close(); }
    }
    if (attachmentRefs.size) {
      const attachmentProvider = await loader.import('@deepseek-ai/dsh-attachment-local', import.meta.url, {});
      const attachmentHome = join(directory, 'attachment-check');
      await mkdir(join(attachmentHome, 'attachments'), { recursive: true });
      await cp(join(directory, 'attachments'), join(attachmentHome, 'attachments/v1'), { recursive: true, errorOnExist: true });
      await isolated.plugin(attachmentProvider.default ?? attachmentProvider, { dshHome: attachmentHome });
      const store = isolated.get('attachments') as any;
      if (!store) throw new Error('原生附件读取器不可用。');
      for (const [id, item] of attachmentRefs) try {
        if (item.kind === 'image') await store.readImage(item.ref);
        else for await (const _ of store.readFileStream(item.ref)) { /* native stream verifies complete bytes/hash */ }
        attachments += 1;
      } catch { failures.push(`必要附件 ${id} 缺失或损坏`); }
    }
    return { checked, required: references.length, formats: [...formats], attachments, failures, consumersStarted: 0 };
  } finally { await isolated.fiber.dispose(); }
}
