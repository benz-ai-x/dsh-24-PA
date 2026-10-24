import { mkdir, readFile, writeFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { MIGRATIONS } from './db.js';
import type { DshContext } from './host.js';
import { WorkspaceBackup, safePath, safeRead, within, RESTORE_ISOLATION_FILE } from './backup.js';
import { sha256Hex } from './handwriting.js';
import { parseWorkspaceIdentity } from './ledger-identity.js';
import { MemoryStore, parseMemoryFile, emptyMemory, planMemoryRestore, memoryHash, canonical } from './memory.js';
import type { MemoryFile } from './memory.js';
import { validateSkillPackage } from './skill-package.js';
import { openBackupLedger } from './backup-ledger.js';
import { BackupInspectionRepo } from './repo/backup-inspection.js';
import { inspectBackupSessions } from './backup-host.js';
import type { BackupSessionReference } from './backup-host.js';

export interface RecoveryStep { id: string; status: 'passed' | 'failed' | 'not_checked' | 'required'; message: string; evidence?: unknown }
export interface RestoreContext { workspace: string; workspaceId: string; ownerOpenId: string; binding: string; host: DshContext; sourceRoots: string[] }
const digest = (value: unknown) => sha256Hex(Buffer.from(canonical(value)));

async function memoryAt(workspace: string): Promise<{ file: MemoryFile; present: boolean; bytesHash: string }> {
  try { const raw = await readFile(join(workspace, '.24pa/memory.json')); return { file: parseMemoryFile(raw.toString()), present: true, bytesHash: sha256Hex(raw) }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { file: emptyMemory(), present: false, bytesHash: 'absent' }; throw error; }
}

async function currentMemoryEvidence(workspace: string) {
  const memory = await memoryAt(workspace);
  const pending = await readFile(join(workspace, '.24pa/memory-audit-pending.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (pending) throw new Error('当前记忆有待核对提交记录；请先完成记忆审计核对，再准备恢复。');
  if (memory.file.lastMutationId) {
    for (const name of await readdir(join(workspace, '.24pa/changesets')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
      if (!name.endsWith('.json')) continue;
      const cs = JSON.parse(await readFile(join(workspace, '.24pa/changesets', name), 'utf8'));
      if (cs.mutationId === memory.file.lastMutationId && cs.resultingHash !== memoryHash(memory.file)) throw new Error('当前记忆 JSON 与已记录修订不一致；先核对手工变化，不能用恢复覆盖。');
    }
  }
  return memory;
}

export async function previewRestore(context: RestoreContext, backupDir: string) {
  const manifestBytes = await safeRead(backupDir, 'backup-manifest.json');
  const manifest = JSON.parse(manifestBytes.toString());
  const backupIdentity = parseWorkspaceIdentity((await safeRead(join(backupDir, 'workspace'), '.24pa/ledger-identity.json')).toString());
  if (backupIdentity !== context.workspaceId || manifest.ledgerWorkspaceId !== context.workspaceId) throw new Error('备份属于其他工作区，不能在当前工作区准备恢复。');
  const current = await currentMemoryEvidence(context.workspace);
  const backup = await memoryAt(join(backupDir, 'workspace'));
  const plan = planMemoryRestore(current.file, backup.file);
  const manifestHash = sha256Hex(manifestBytes);
  const evidence = { manifestHash, currentHash: current.bytesHash, backupMemoryHash: backup.bytesHash, workspaceId: context.workspaceId, binding: context.binding };
  return { backupDir, manifestHash, currentRevision: plan.currentRevision, backupRevision: plan.backupRevision,
    added: plan.added, protectedIds: plan.protectedIds, conflicts: plan.conflicts, currentMemoryPresent: current.present,
    previewToken: digest(evidence),
    message: '只在空的隔离目录生成候选副本；保留当前记忆和删除标记，不覆盖现场。旧运行、外部对象及投递仍须逐项核对，凭据另行恢复。',
    deletionEvidence: current.present ? '删除保护基于当前 JSON 与该备份已有的删除标记。' : '当前记忆文件缺失；只能保护该备份已有删除标记，无法推知备份后丢失的删除证据。' };
}

async function newTarget(context: RestoreContext, backupDir: string, target: string) {
  if (!isAbsolute(target)) throw new Error('恢复演练需要绝对 targetDir。');
  const parent = await realpath(dirname(target));
  const actual = join(parent, target.split(/[\\/]/).filter(Boolean).at(-1)!);
  for (const root of [backupDir, ...context.sourceRoots]) {
    const source = await realpath(root).catch(() => resolve(root));
    if (within(source, actual) || within(actual, source)) throw new Error('隔离恢复目录不能位于现场、备份源或备份产物内，也不能包含这些目录。');
  }
  // An existing directory is never overwritten, even when it appears empty.
  await mkdir(actual, { mode: 0o700 });
  return actual;
}

async function copyVerified(backupDir: string, target: string, manifest: any) {
  for (const part of manifest.parts) {
    const bytes = await safeRead(backupDir, part.path);
    if (sha256Hex(bytes) !== part.sha256 || bytes.length !== part.bytes) throw new Error('预览后备份内容发生变化，请重新校验。');
    if (String(part.id).endsWith('-manifest')) {
      const id = String(part.id).replace(/-manifest$/, '');
      if (!['workspace', 'dsh-state', 'sessions', 'storages', 'attachments'].includes(id)) throw new Error('未知备份集合。');
      const listing = JSON.parse(bytes.toString());
      await mkdir(join(target, id), { recursive: true });
      for (const name of listing.directories) {
        await safePath(join(backupDir, id), name, true);
        await mkdir(join(target, id, name), { recursive: true });
      }
      for (const file of listing.files) {
        const data = await safeRead(join(backupDir, id), file.path);
        if (sha256Hex(data) !== file.sha256 || data.length !== file.bytes) throw new Error('复制期间备份文件发生变化，请重新校验。');
        await mkdir(dirname(join(target, id, file.path)), { recursive: true });
        await writeFile(join(target, id, file.path), data, { mode: 0o600, flag: 'wx' });
      }
    } else {
      if (!['pa24.db', 'pa24.sql'].includes(part.path)) throw new Error('不支持的账本文件，需核对备份版本。');
      await writeFile(join(target, part.path), bytes, { mode: 0o600, flag: 'wx' });
    }
  }
  await writeFile(join(target, 'workspace', RESTORE_ISOLATION_FILE), JSON.stringify({ version: 1, state: 'isolated', backupDir, createdAt: new Date().toISOString(), reason: '恢复演练副本；禁止业务执行。' }), { mode: 0o600 });
  await writeFile(join(target, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
}

function closure(records: Record<string, Record<string, any>[]>) {
  const errors: string[] = [];
  const rows = (table: string) => records[table] ?? [];
  const relation = (from: string, column: string, to: string, key = 'id') => {
    const valid = new Set(rows(to).map(row => row[key]));
    for (const row of rows(from)) if (row[column] != null && row[column] !== '' && !valid.has(row[column])) errors.push(`${from}.${column} 引用缺失：${row.id ?? row[column]}`);
  };
  for (const table of ['note_page', 'note_version', 'review_decision', 'note_material', 'note_action_link']) relation(table, 'note_id', 'note');
  relation('review_decision', 'version_id', 'note_version');
  relation('note_action_link', 'version_id', 'note_version');
  relation('note_action_link', 'operation_id', 'action_operation');
  relation('skill_version', 'skill_id', 'skill_entry');
  relation('skill_entry', 'draft_version', 'skill_version'); relation('skill_entry', 'active_version', 'skill_version');
  relation('skill_run', 'work_item_id', 'work_item'); relation('worker_run', 'work_item_id', 'work_item');
  for (const table of ['skill_run_session', 'skill_run_input', 'skill_run_call', 'skill_run_control', 'skill_run_resume']) relation(table, 'run_id', 'skill_run');
  for (const table of ['worker_run_input', 'worker_run_call']) relation(table, 'run_id', 'worker_run');
  relation('work_change', 'work_item_id', 'work_item');
  relation('work_item', 'parent_work_item_id', 'work_item');
  relation('work_item', 'active_skill_run_id', 'skill_run'); relation('work_item', 'active_worker_run_id', 'worker_run');
  for (const table of ['plan_trigger', 'task_plan_run_outcome', 'task_plan_notice', 'task_plan_delivery']) relation(table, 'run_id', 'skill_run');
  for (const table of ['plan_trigger', 'task_plan_block', 'task_plan_run_outcome', 'task_plan_notice', 'task_plan_migration', 'skill_run']) relation(table, 'plan_id', 'digest_plan');
  relation('task_plan_delivery', 'notice_id', 'task_plan_notice');
  for (const table of ['task_plan_delivery', 'task_plan_delivery_change']) relation(table, 'outbox_id', 'outbox');
  for (const decision of rows('review_decision')) {
    const version = rows('note_version').find(row => row.id === decision.version_id);
    if (version && (version.note_id !== decision.note_id || version.fingerprint !== decision.fingerprint)) errors.push(`审核凭证与版本不一致：${decision.id}`);
  }
  for (const entry of rows('skill_entry')) for (const id of [entry.draft_version, entry.active_version].filter(Boolean)) {
    if (rows('skill_version').find(row => row.id === id)?.skill_id !== entry.id) errors.push(`Skill 当前/草稿版本归属错误：${entry.id}`);
  }
  for (const link of rows('note_action_link')) if (rows('note_version').find(row => row.id === link.version_id)?.note_id !== link.note_id) errors.push(`候选行动与待审版本归属不一致：${link.note_id}/${link.candidate_id}`);
  return errors;
}

function sessionReferences(records: Record<string, Record<string, any>[]>, sourceRoot: string) {
  const refs = new Map<string, BackupSessionReference>();
  const add = (id: unknown, parent?: string) => { if (typeof id === 'string' && id) refs.set(id, { ...refs.get(id), id, ...(parent ? { parent } : {}), cwd: sourceRoot }); };
  for (const row of records.workspace_state ?? []) { add(row.local_session_id); add(row.feishu_session_id); }
  for (const row of records.work_item ?? []) { add(row.parent_session_id); if (row.child_session_id && row.status !== 'queued' && !row.active_skill_run_id) add(row.child_session_id, row.parent_session_id); }
  for (const row of records.skill_run ?? []) { add(row.source_session_id); if (!['pending', 'rejected'].includes(row.status)) add(row.session_id, row.mode === 'business' ? row.source_session_id : undefined); }
  for (const row of records.skill_run_session ?? []) add(row.session_id, row.parent_id);
  for (const row of records.worker_run ?? []) if (row.status !== 'rejected') {
    const work = records.work_item?.find(item => item.id === row.work_item_id); add(row.session_id, work?.parent_session_id);
  }
  for (const row of records.material_read_evidence ?? []) add(row.session_id);
  for (const row of records.note_material ?? []) add(row.source?.sessionId);
  return [...refs.values()];
}

function reconciliation(records: Record<string, Record<string, any>[]>) {
  const choose = (row: Record<string, any>, fields: string[]) => Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
  return {
    outbox: (records.outbox ?? []).filter(row => !['sent', 'cancelled', 'expired'].includes(row.status)).map(row => choose(row, ['id', 'dedup_key', 'channel', 'target', 'kind', 'status', 'message_id'])),
    operations: (records.action_operation ?? []).map(row => ({ ...choose(row, ['id', 'work_item_id', 'action', 'status']), target: row.params?._sourceTarget ?? row.params?._channel ?? null, receiptRecorded: Boolean(row.receipt) })),
    runs: [...records.skill_run ?? [], ...records.worker_run ?? []].filter(row => !['completed', 'failed', 'stopped', 'timed_out', 'rejected'].includes(row.status)).map(row => choose(row, ['id', 'work_item_id', 'session_id', 'status'])),
    plans: (records.digest_plan ?? []).filter(row => !['deleted', 'disabled'].includes(row.status)).map(row => choose(row, ['id', 'kind', 'status', 'schedule_id', 'session_id', 'owner_enabled', 'recycled_at'])),
    triggers: (records.plan_trigger ?? []).filter(row => !['completed', 'skipped', 'cancelled'].includes(row.status)).map(row => choose(row, ['id', 'plan_id', 'run_id', 'status', 'occurrence'])),
    remoteObjects: [
      ...(records.task ?? []).map(row => ({ kind: 'todo', ...choose(row, ['id', 'task_guid', 'channel', 'summary', 'source_id']) })),
      ...(records.calendar_event ?? []).map(row => ({ kind: 'calendar', ...choose(row, ['id', 'event_id', 'calendar_id', 'channel', 'source_id']) })),
      ...(records.note_version ?? []).filter(row => row.doc_id).map(row => ({ kind: 'review-document', ...choose(row, ['id', 'note_id', 'doc_id', 'doc_url', 'fingerprint', 'verify_result', 'verified_at']) })),
    ],
  };
}

export async function inspectRecovery(context: RestoreContext, backupDir: string, targetDir: string, mergeMemory: boolean, previewToken?: string) {
  const steps: RecoveryStep[] = [];
  const manifestBytes = await safeRead(backupDir, 'backup-manifest.json');
  const manifestHash = sha256Hex(manifestBytes), manifest = JSON.parse(manifestBytes.toString());
  const fileCheck = await WorkspaceBackup.verify(backupDir);
  steps.push({ id: 'files', status: fileCheck.complete ? 'passed' : 'failed', message: fileCheck.message, evidence: { coverage: fileCheck.coverage, parts: fileCheck.parts } });
  if (!fileCheck.complete) return { backupDir, manifestHash, complete: false, steps, message: '备份校验未通过，尚未导入账本或准备恢复副本。' };
  let preview: Awaited<ReturnType<typeof previewRestore>> | undefined;
  if (mergeMemory) {
    preview = await previewRestore(context, backupDir);
    if (preview.previewToken !== previewToken) throw new Error('恢复预览已经变化或未明确确认；请重新执行 backup_preview。');
  }
  const target = await newTarget(context, backupDir, targetDir);
  await copyVerified(backupDir, target, manifest);
  steps.push({ id: 'isolation', status: 'passed', message: '副本已写入执行隔离标记；检查器不装载 Agent、调度、入站或出站消费者。', evidence: { target, consumersStarted: 0 } });
  const listing = JSON.parse((await safeRead(backupDir, 'workspace-manifest.json')).toString());
  const sourceRoot = listing.root as string;
  const fileAt = async (path: string, expected: string, bytes?: number) => {
    if (typeof path !== 'string' || !isAbsolute(sourceRoot)) throw new Error('缺少资料源路径映射');
    const rel = isAbsolute(path) ? relative(sourceRoot, path) : path;
    const data = await safeRead(join(target, 'workspace'), rel);
    if (sha256Hex(data) !== expected || (bytes !== undefined && bytes !== data.length)) throw new Error('资料字节/摘要不符');
  };
  let ledger: Awaited<ReturnType<typeof openBackupLedger>> | undefined;
  let snapshot: Awaited<ReturnType<BackupInspectionRepo['read']>> | undefined;
  try {
    ledger = await openBackupLedger(target, manifest.storage);
    const errors = await ledger.integrity();
    snapshot = await new BackupInspectionRepo(ledger, ledger.kind).read();
    const versions = snapshot.records.schema_migrations?.map(row => Number(row.version)) ?? [];
    const schema = Math.max(0, ...versions);
    const supported = Math.max(...MIGRATIONS.map(row => row.version));
    if (!schema || schema > supported || schema !== manifest.schemaVersion || MIGRATIONS.some(row => row.version <= schema && !versions.includes(row.version))) errors.push('账本实际 schema 与清单或当前插件不兼容');
    const owners = snapshot.records.ledger_owner ?? [];
    if (owners.length !== 1 || Number(owners[0]?.id) !== 1 || owners[0]?.workspace_id !== context.workspaceId || owners[0]?.workspace_id !== manifest.ledgerWorkspaceId || owners[0]?.owner_open_id !== context.ownerOpenId) errors.push('账本实际归属与当前工作区/主人不符');
    const identity = parseWorkspaceIdentity((await safeRead(join(target, 'workspace'), '.24pa/ledger-identity.json')).toString());
    if (identity !== context.workspaceId) errors.push('副本工作区身份不符');
    errors.push(...closure(snapshot.records));
    steps.push({ id: 'ledger', status: errors.length ? 'failed' : 'passed', message: errors.length ? errors.join('；') : '实际账本已导入并读取，schema、主人、工作区与记录关联通过。', evidence: { schema, versions: ledger.versions, counts: snapshot.counts } });
    if (errors.length) snapshot = undefined; // Wrong-owner content must not leak into lists.
  } catch (error) { steps.push({ id: 'ledger', status: 'failed', message: (error as Error).message }); }
  finally { if (ledger) try { await ledger.close(); } catch { steps.push({ id: 'ledger-stop', status: 'failed', message: '隔离账本关闭未确认，请检查本次隔离进程，现场未切换。' }); } }
  if (snapshot) {
    const failures: string[] = [];
    let originals = 0, crops = 0;
    for (const page of snapshot.records.note_page ?? []) if (page.status === 'saved') try { await fileAt(page.storage_path, page.sha256, Number(page.byte_size)); originals++; } catch { failures.push(`原稿缺失或损坏：${page.id}`); }
    for (const version of snapshot.records.note_version ?? []) {
      if (version.doc_id && (!version.doc_snapshot || !version.normalized_text || !version.fingerprint)) failures.push(`审核快照缺失：${version.id}`);
      for (const crop of version.content?.crops ?? []) try { await fileAt(crop.path, crop.sha256); crops++; } catch { failures.push(`裁片缺失或损坏：${version.id}/${crop.id}`); }
    }
    steps.push({ id: 'materials', status: failures.length ? 'failed' : 'passed', message: failures.length ? failures.join('；') : '实际原稿、裁片和账本审核快照关联通过；未推断远端文档仍有效。', evidence: { originals, crops, versions: snapshot.records.note_version?.length ?? 0 } });
    const skillErrors: string[] = [];
    for (const row of snapshot.records.skill_version ?? []) try { validateSkillPackage(row.package_data); } catch { skillErrors.push(`Skill 版本包损坏：${row.id}`); }
    for (const row of snapshot.records.skill_run ?? []) try { validateSkillPackage(row.snapshot.package); } catch { skillErrors.push(`运行冻结 Skill 包损坏：${row.id}`); }
    steps.push({ id: 'skills', status: skillErrors.length ? 'failed' : 'passed', message: skillErrors.length ? skillErrors.join('；') : '个人 Skill 不可变版本、资源内容和运行包快照逐项核验通过。', evidence: { versions: snapshot.records.skill_version?.length ?? 0, runs: snapshot.records.skill_run?.length ?? 0 } });
    try {
      const sessionsListing = JSON.parse((await safeRead(backupDir, 'sessions-manifest.json')).toString());
      const checked = await inspectBackupSessions(context.host, target, sessionReferences(snapshot.records, sourceRoot), sessionsListing.files.map((row: any) => row.path));
      steps.push({ id: 'sessions', status: checked.failures.length ? 'failed' : 'passed', message: checked.failures.length ? checked.failures.join('；') : '原生 Session 冷读、父子归属及必要附件检查通过。', evidence: checked });
    } catch (error) { steps.push({ id: 'sessions', status: 'not_checked', message: (error as Error).message }); }
  }
  try {
    const workspace = join(target, 'workspace');
    const store = new MemoryStore(workspace, context.host);
    const before = await memoryAt(workspace);
    const checked = await store.search({});
    if (checked.auditWarning) throw new Error(checked.auditWarning);
    let evidence: Record<string, unknown> = { backupRevision: before.file.revision, records: before.file.records.length, tombstones: before.file.tombstones?.length ?? 0 };
    if (mergeMemory) {
      const current = await currentMemoryEvidence(context.workspace);
      const currentPreview = await previewRestore(context, backupDir);
      if (currentPreview.previewToken !== preview!.previewToken) throw new Error('复制期间当前记忆或备份已变化；副本保持隔离，请重新预览。');
      const plan = planMemoryRestore(current.file, before.file);
      await writeFile(join(workspace, '.24pa/memory.json'), JSON.stringify(plan.file, null, 2) + '\n', { mode: 0o600 });
      const cleaned = await store.search({});
      if (cleaned.auditWarning) throw new Error(cleaned.auditWarning);
      // Existing cleanup owns derived history. Reading every protected record
      // proves malformed history didn't silently bypass deletion protection.
      for (const row of plan.file.tombstones ?? []) await store.history(row.id);
      evidence = { ...evidence, currentRevision: plan.currentRevision, candidateRevision: plan.file.revision, added: plan.added, protectedIds: plan.protectedIds, conflicts: plan.conflicts, deletionEvidence: preview!.deletionEvidence };
    }
    steps.push({ id: 'memory', status: 'passed', message: mergeMemory ? '候选副本保留当前记忆与删除标记，历史正文清理完成；现场 JSON 未改动。' : '记忆权威 JSON 与派生审计可读取；尚未合并当前记忆。', evidence });
  } catch (error) { steps.push({ id: 'memory', status: 'failed', message: (error as Error).message }); }
  const reconciliationItems = snapshot ? reconciliation(snapshot.records) : undefined;
  steps.push({ id: 'remote-reconciliation', status: 'required', message: '切换前逐项查询原平台、身份和容器，核对旧运行、待发、已知远端对象与备份后动作。检查器没有发起外部请求或创建/重发对象。', evidence: reconciliationItems });
  steps.push({ id: 'credentials', status: 'required', message: '密钥和授权缓存未恢复；在隔离环境通过专门凭据机制重新配置并验证原身份，不能把环境引用名当授权通过。' });
  steps.push({ id: 'cutover', status: 'required', message: '当前仅完成隔离检查。保留原目录，停止现场 Host 后按指南人工切换；禁止删除隔离标记后直接自动恢复旧计划或 Outbox。' });
  if (sha256Hex(await safeRead(backupDir, 'backup-manifest.json')) !== manifestHash) steps.push({ id: 'source-stability', status: 'failed', message: '检查期间备份清单发生变化，请重新校验。' });
  const complete = !steps.some(step => ['failed', 'not_checked'].includes(step.status));
  const result = { backupDir, targetDir: target, manifestHash, complete, productionReady: false, steps,
    sourceVersion: { format: manifest.formatVersion, schema: manifest.schemaVersion, versions: manifest.versions ?? null },
    capturedAt: { startedAt: manifest.startedAt ?? null, ledgerStartedAt: manifest.ledgerStartedAt ?? null, ledgerFinishedAt: manifest.ledgerFinishedAt ?? null, finishedAt: manifest.createdAt, simultaneous: false },
    message: complete ? '隔离检查通过；这不是现场恢复成功。外部对象/旧待发对账、凭据和人工切换仍未完成。' : '隔离检查未全部通过；请按失败或未检查步骤修复，副本保持禁止执行。' };
  await writeFile(join(target, 'restore-report.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  return result;
}
