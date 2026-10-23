import { randomUUID } from 'node:crypto';
import { sha256Hex, type RecognizedNote, type NoteCandidate } from './handwriting.js';
import type { DshSession } from './host.js';

export interface MaterialSource {
  kind: 'handwriting' | 'qwennote';
  type: 'images' | 'transcript' | 'minutes' | 'quick-note';
  title: string;
  reference?: string;
  sessionId?: string;
  callId?: string;
  toolName?: string;
  readAt?: string;
  digest?: string;
  /** The explicitly selected external material; never an automatic library mirror. */
  originalText?: string;
}
export interface MaterialDraft extends RecognizedNote {
  title: string;
  pageOrder: number[];
  candidates: (NoteCandidate & { id: string })[];
}
export const materialSourceReference = ({ originalText: _text, ...source }: MaterialSource) => source;

const bounded = (value: unknown, max: number, label: string, allowEmpty = true): string => {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`${label}需要${allowEmpty ? '' : '非空'}文本，最多 ${max} 字。`);
  return value;
};
const strings = (value: unknown, max = 50): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`列表最多 ${max} 项。`);
  return value.map(v => bounded(v, 1000, '列表项'));
};
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const materialFingerprint = (value: unknown): string => sha256Hex(JSON.stringify(stable(value)));
export function candidateParameters(candidate: NoteCandidate): Record<string, unknown> {
  return Object.fromEntries(['summary', 'due', 'start', 'end', 'sourceId', 'company', 'project', 'assigneeIds'].filter(key => (candidate as any)[key] !== undefined).map(key => [key, (candidate as any)[key]]));
}
const candidateMatch = (candidate: NoteCandidate) => materialFingerprint({ ...candidateParameters(candidate), sourceQuote: candidate.sourceQuote ?? '' });

/** ID is a relationship, never an authorization. Ambiguous equal candidates
 * get distinct IDs; an explicitly retained ID must belong to this note. */
export function parseMaterialDraft(value: unknown, previous: MaterialDraft | null, pageNos: number[], title: string): MaterialDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('缺少资料草稿。');
  const raw = value as Record<string, any>;
  const old = previous?.candidates ?? [], used = new Set<string>();
  if (!Array.isArray(raw.candidates ?? []) || (raw.candidates?.length ?? 0) > 50) throw new Error('候选行动最多 50 项。');
  const candidates = (raw.candidates ?? []).map((entry: any) => {
    const c = typeof entry === 'string' ? { summary: entry } : entry;
    if (!c || typeof c !== 'object') throw new Error('候选行动格式无效。');
    const result: NoteCandidate = { summary: bounded(c.summary, 500, '行动摘要', false) };
    for (const key of ['sourceQuote', 'due', 'start', 'end', 'sourceId', 'company', 'project'] as const) {
      if (c[key] != null && c[key] !== '') result[key] = bounded(c[key], key === 'sourceQuote' ? 1000 : 300, key);
    }
    if (c.assigneeIds !== undefined) result.assigneeIds = strings(c.assigneeIds, 50);
    if (c.unknowns !== undefined) result.unknowns = strings(c.unknowns, 20);
    let id: string;
    if (c.id) {
      if (!old.some(row => row.id === c.id) || used.has(c.id)) throw new Error('候选关联标识不存在或重复；新行动不要提供 id。');
      id = c.id;
    } else {
      const matches = old.filter(row => !used.has(row.id) && candidateMatch(row) === candidateMatch(result));
      id = matches.length === 1 ? matches[0]!.id : `a-${randomUUID()}`;
    }
    used.add(id);
    return { ...result, id };
  });
  const pageOrder = raw.pageOrder ?? pageNos;
  if (!Array.isArray(pageOrder) || pageOrder.length !== pageNos.length || new Set(pageOrder).size !== pageOrder.length || pageOrder.some((no: unknown) => !pageNos.includes(Number(no)) || !Number.isInteger(no))) throw new Error('原稿页序必须包含全部已保存页，且不得重复或添加不存在的页。');
  const pages = raw.pages === undefined ? [] : raw.pages;
  if (!Array.isArray(pages) || pages.length > 50 || pages.some((p: any) => !pageNos.includes(p?.pageNo))) throw new Error('逐页转写需引用真实原稿页。');
  if (new Set(pages.map((p: any) => p.pageNo)).size !== pages.length) throw new Error('逐页转写页号重复。');
  const doubts = raw.doubts ?? [], diagrams = raw.diagrams ?? [];
  for (const list of [doubts, diagrams]) {
    if (!Array.isArray(list) || list.length > 100) throw new Error('疑点或图示列表超出范围。');
    for (const item of list) {
      if (!pageNos.includes(item?.pageNo)) throw new Error('疑点或图示必须引用真实原稿页。');
      if (item.region && ['x', 'y', 'w', 'h'].some(key => !Number.isFinite(item.region[key]) || item.region[key] < 0 || item.region[key] > 1)) throw new Error('区域坐标需在 0–1 范围。');
    }
  }
  const relativeDates = raw.relativeDates ?? [];
  if (!Array.isArray(relativeDates) || relativeDates.length > 20) throw new Error('相对日期依据最多 20 项。');
  return { title: bounded(raw.title ?? title, 300, '标题', false), transcript: bounded(raw.transcript ?? '', 100000, '正文'),
    summary: bounded(raw.summary ?? '', 4000, '摘要'), pageOrder: [...pageOrder], candidates,
    suggestions: strings(raw.suggestions), unknowns: strings(raw.unknowns),
    relativeDates: relativeDates.map((r: any) => ({ original: bounded(r.original, 300, '日期原话'), interpretation: bounded(r.interpretation, 1000, '日期解释') })),
    ...(pages.length ? { pages: pages.map((p: any) => ({ pageNo: p.pageNo, transcript: bounded(p.transcript, 20000, '逐页转写') })) } : {}),
    ...(doubts.length ? { doubts: doubts.map((d: any) => ({ pageNo: d.pageNo, kind: bounded(d.kind ?? 'unclear', 50, '疑点类型'), quote: bounded(d.quote ?? '', 500, '疑点原话'), certainty: d.region ? 'estimated' as const : 'page' as const, ...(d.region ? { region: d.region } : {}), ...(d.note ? { note: bounded(d.note, 1000, '疑点说明') } : {}) })) } : {}),
    ...(diagrams.length ? { diagrams: diagrams.map((d: any) => ({ pageNo: d.pageNo, description: bounded(d.description, 2000, '图示说明'), ...(d.region ? { region: d.region } : {}) })) } : {}),
  };
}

export function materialDiff(before: MaterialDraft | null, after: MaterialDraft) {
  const fields = ['title', 'transcript', 'summary', 'pageOrder', 'pages', 'doubts', 'unknowns', 'suggestions', 'relativeDates', 'diagrams'] as const;
  const changes = fields.filter(key => materialFingerprint(before?.[key] ?? null) !== materialFingerprint(after[key] ?? null));
  const old = before?.candidates ?? [];
  return { changed: changes.length > 0 || materialFingerprint(old) !== materialFingerprint(after.candidates), fields: changes,
    candidates: after.candidates.map(row => { const prior = old.find(c => c.id === row.id); return { id: row.id, summary: row.summary, change: !prior ? 'added' : materialFingerprint(prior) === materialFingerprint(row) ? 'unchanged' : 'changed' }; }),
    removed: old.filter(row => !after.candidates.some(c => c.id === row.id)).map(row => ({ id: row.id, summary: row.summary })),
    reordered: old.filter(row => after.candidates.some(c => c.id === row.id)).map(c => c.id).join() !== after.candidates.filter(row => old.some(c => c.id === row.id)).map(c => c.id).join(),
  };
}

/** Evidence is taken from the actual local Session, never model-supplied text. */
export function qwenReadEvidence(session: DshSession, callId: string) {
  const events = session.ownEvents();
  const calls = events.filter(e => e.type === 'tool/call' && e.data.callId === callId && String(e.data.name).startsWith('mcp__qwennote__'));
  const results = events.filter(e => e.type === 'tool/result' && e.data.message?.toolCallId === callId);
  if (calls.length !== 1 || results.length !== 1 || results[0]!.data.message?.isError || results[0]!.data.error) throw new Error('需要本地会话中唯一且成功的 QwenNote 读取回执 callId；失败或未完成的读取不能导入。');
  const content = (results[0]!.data.message.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  if (!content.trim() || content.length > 200000) throw new Error('听记回执没有可导入的文字，或超过单份资料 20 万字上限。');
  return { callId, sessionId: session.id, toolName: String(calls[0]!.data.name), arguments: typeof calls[0]!.data.arguments === 'string' ? calls[0]!.data.arguments : JSON.stringify(calls[0]!.data.arguments ?? {}), content, digest: sha256Hex(content) };
}
