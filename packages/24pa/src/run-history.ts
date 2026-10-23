import { Temporal } from '@js-temporal/polyfill';
import type { Repos } from './repo.js';
import type { SkillRuns } from './skill-runs.js';
import type { HistoryFilter, HistoryKind } from './repo/run-history.js';

interface HistoryContext { binding: string; timeZone: string; repos: Repos; diagnosticRetentionDays?: number }
const kinds: HistoryKind[] = ['runs', 'work', 'events', 'legacy'];
const statuses: Record<HistoryKind, string[]> = {
  runs: ['pending', 'running', 'waiting', 'stopping', 'completed', 'failed', 'stopped', 'timed_out', 'needs_reconciliation'],
  work: ['accepted', 'queued', 'running', 'waiting_input', 'completed', 'failed', 'stopped', 'needs_reconciliation'],
  events: ['skipped', 'rejected', 'expired'], legacy: ['delivering', 'model_done', 'sent', 'unconfirmed'],
};
function diagnosticFrame(line: string): string | null {
  // Parse the complete location, including spaces and eval frames. An
  // unrecognised frame is omitted instead of copying a possibly private path.
  const match = /^\s+at (?:(.*?) \()?(.+):(\d+):(\d+)\)?$/.exec(line);
  if (!match) return null;
  const label = match[1] && /^[\w$.[\] <>]+$/.test(match[1]) ? match[1] : '';
  const filename = match[2]!.split(/[\\/]/).at(-1)!.replace(/[?#].*$/, '');
  if (!/^[\w.-]+$/.test(filename)) return null;
  return `    at ${label ? label + ' (' : ''}[路径]/${filename}:${match[3]}:${match[4]}${label ? ')' : ''}`;
}
function date(value: unknown, timeZone: string): Date {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请填写自定义时间范围。');
  try {
    const instant = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Temporal.Instant.from(value)
      : Temporal.PlainDateTime.from(value).toZonedDateTime(timeZone, { disambiguation: 'reject' }).toInstant();
    return new Date(Number(instant.epochMilliseconds));
  } catch { throw new Error('时间格式无效或当地时间存在歧义；可填写带时区偏移的 ISO 时间。'); }
}
export function historyFilter(input: Record<string, unknown>, timeZone: string, now = new Date()): HistoryFilter {
  const kind = (input.kind ?? 'runs') as HistoryKind;
  if (!kinds.includes(kind)) throw new Error('运行档案类别无效。');
  const range = input.range ?? '7';
  if (!['7', '30', 'custom', 'all'].includes(String(range))) throw new Error('请选择近 7 天、30 天、自定义或全部历史。');
  const from = range === 'custom' ? date(input.from, timeZone) : range === 'all' ? null : new Date(now.getTime() - Number(range) * 86400000);
  // Rolling windows have no upper bound: database timestamps can carry
  // sub-millisecond precision beyond the browser/server clock's current ms.
  const to = range === 'custom' ? date(input.to, timeZone) : null;
  if (from && to && from > to) throw new Error('开始时间不能晚于结束时间。');
  const text = (key: string, limit = 200) => {
    const value = input[key]; if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || value.length > limit) throw new Error(`筛选字段 ${key} 无效。`);
    return value.trim() || undefined;
  };
  const status = text('status'), source = text('source'), deliveryStatus = text('deliveryStatus');
  if (status && !statuses[kind].includes(status)) throw new Error('此类别不支持该执行状态。');
  if (source && !(kind === 'work' ? ['local', 'feishu'] : kind === 'events' ? ['manual', 'schedule'] : ['manual', 'schedule', 'trial', 'rerun', 'continuation']).includes(source)) throw new Error('此类别不支持该来源筛选。');
  if (deliveryStatus && !['not_requested', 'suppressed', 'pending', 'sent', 'partial', 'failed', 'unknown', 'expired'].includes(deliveryStatus)) throw new Error('投递状态无效。');
  const unsupported = kind === 'runs' ? [] : kind === 'work' ? ['versionId', 'deliveryStatus'] : kind === 'events' ? ['versionId', 'deliveryStatus'] : ['source', 'workId', 'skillId', 'versionId', 'deliveryStatus'];
  for (const key of unsupported) if (text(key)) throw new Error(`当前档案类别不支持 ${key} 筛选，请清除后重试。`);
  const skillId = text('skillId');
  const offset = Number(input.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('历史页码无效。');
  return { kind, from, to, status, source, deliveryStatus, query: text('query', 500),
    workId: text('workId'), planId: text('planId'), skillId: skillId?.replace(/^managed:/, ''), versionId: text('versionId'),
    includeUnresolved: input.includeUnresolved !== false, offset, limit: 20 };
}

/** Exports include only business summaries or an explicit diagnostic allowlist.
 * Package bytes, credentials, raw model requests and full host paths stay out. */
export class RunHistory {
  private cleaned: { binding: string; days: number; at: number } | null = null;
  constructor(private readonly deps: { context(): HistoryContext | null; skills: SkillRuns; secretValues?(): string[] }) {}
  private context(binding: unknown): HistoryContext {
    const context = this.deps.context();
    if (!context || binding !== context.binding) throw new Error('工作区已切换或未就绪，请刷新运行记录。');
    return context;
  }
  async list(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), filter = historyFilter(input, context.timeZone);
    return { ...await context.repos.runHistory.list(filter), filter, timeZone: context.timeZone, workspaceBinding: context.binding };
  }
  async summary(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding);
    return { ...await context.repos.runHistory.summary(), workspaceBinding: context.binding };
  }
  async work(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), work = await context.repos.workItems.get(String(input.workId));
    if (!work) throw new Error('助理交办不存在。');
    const runs = await context.repos.runHistory.list(historyFilter({ kind: 'runs', range: 'all', workId: work.id, offset: input.offset }, context.timeZone));
    return { work, runs, changes: await context.repos.workControls.history(work.id), workspaceBinding: context.binding };
  }
  private redact(value: unknown): string {
    const secrets = (this.deps.secretValues?.() ?? []).filter(Boolean).sort((a, b) => b.length - a.length);
    // Redact original strings before JSON escaping quotes/newlines. Short
    // configured secrets still count; privacy takes precedence over wording.
    return JSON.stringify(value, (key, item) => {
      if (/secret|password|credential|access.?token|refresh.?token|api.?key|authorization/i.test(key)) return '[已脱敏]';
      if (typeof item !== 'string') return item;
      for (const secret of secrets) item = item.replaceAll(secret, '[已脱敏]');
      return item.replace(/Bearer\s+[A-Za-z0-9_.~+/=-]+/gi, 'Bearer [已脱敏]');
    }, 2);
  }
  async export(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding), filter = historyFilter(input, context.timeZone);
    const all = await context.repos.runHistory.list({ ...filter, offset: 0, limit: 2147483647 });
    return { filename: `24pa-${filter.kind}-${new Date().toISOString().slice(0, 10)}.json`,
      content: this.redact({ kind: filter.kind, filter, timeZone: context.timeZone, observedAt: new Date().toISOString(), total: all.rows.length, rows: all.rows }),
      total: all.rows.length, workspaceBinding: context.binding };
  }
  async diagnostics(input: Record<string, unknown>) {
    const context = this.context(input.workspaceBinding);
    const worker = await context.repos.workerRuns.get(String(input.runId));
    if (worker) {
      const detail = await context.repos.workerRuns.detail(worker.id);
      return { filename: `24pa-diagnostic-${worker.id}.json`, workspaceBinding: context.binding,
        message: '此预览排除请求正文、工具参数、结果、投递对象及工作区路径；确认后可下载。',
        content: this.redact({ runId: worker.id, status: worker.status, createdAt: worker.created_at, updatedAt: worker.updated_at,
          calls: detail.calls.map(call => ({ tool: call.tool, status: call.status })), inputs: detail.inputs.map(row => ({ status: row.status, adopted: row.adopted_turn !== null })),
          executionMs: detail.control?.state.executionMs ?? null, limitMs: detail.control?.state.limitMs ?? null,
          deliveries: detail.deliveries.map(row => ({ channel: row.channel, status: row.status, attempts: row.attempts })) }) };
    }
    const detail = await this.deps.skills.inspect(input);
    const retentionDays = context.diagnosticRetentionDays ?? 90;
    const data = { runId: detail.run.id, status: detail.run.status, deliveryStatus: detail.run.delivery_status, mode: detail.run.mode,
      skillId: detail.run.skill_id, versionId: detail.run.version_id, packageHash: detail.run.packageHash,
      createdAt: detail.run.created_at, updatedAt: detail.run.updated_at,
      execution: detail.execution ? { limitMs: detail.execution.limitMs, executionMs: detail.execution.executionMs,
        queuedMs: detail.execution.queuedMs, waitingMs: detail.execution.waitingMs, remainingMs: detail.execution.remainingMs,
        blockKinds: detail.execution.blocks.map(block => block.kind) } : null,
      attempts: detail.attempts.map(attempt => ({ number: attempt.number, startedAt: attempt.startedAt, endedAt: attempt.endedAt, retry: attempt.retry })),
      calls: detail.calls.map(call => ({ tool: call.tool, status: call.status })),
      native: detail.native.map(row => ({ kind: row.kind, ended: !!row.end_data, status: row.end_data?.status ?? null })),
      retentionDays, traces: await context.repos.runDiagnostics.list(detail.run.id, retentionDays),
      notices: detail.deliveries.map(notice => ({ kind: notice.kind, status: notice.deliveryStatus,
        components: notice.deliveries.map(delivery => ({ component: delivery.component, status: delivery.outbox.status, attempts: delivery.outbox.attempts })) })) };
    return { filename: `24pa-diagnostic-${detail.run.id}.json`, content: this.redact(data), workspaceBinding: context.binding,
      message: '此预览排除输入、结果正文、工具参数、投递对象、工作区路径及凭据；确认内容后可下载。' };
  }
  async capture(runId: string, phase: string, error: unknown): Promise<void> {
    const context = this.deps.context();
    if (!context) return;
    const frames = error instanceof Error ? (error.stack ?? '').split('\n').map(diagnosticFrame).filter(Boolean).slice(0, 20) : [];
    const name = error instanceof Error && ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(error.name) ? error.name : 'Error';
    await context.repos.runDiagnostics.append(runId, phase, JSON.parse(this.redact({ name, frames })));
  }
  /** Called by the workspace dispatcher, never by a browsing endpoint. */
  async pruneDiagnostics(now = Date.now()): Promise<void> {
    const context = this.deps.context(); if (!context) return;
    const days = context.diagnosticRetentionDays ?? 90;
    if (this.cleaned?.binding === context.binding && this.cleaned.days === days && now - this.cleaned.at < 3600000) return;
    await context.repos.runDiagnostics.prune(days, new Date(now));
    this.cleaned = { binding: context.binding, days, at: now };
  }
}
