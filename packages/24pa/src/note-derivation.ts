import type { RecognizedNote } from './handwriting.js';
import type { NoteVersionRow } from './repo.js';
import { canonicalDerivationSource } from './note-document.js';
import { createHash } from 'node:crypto';

const fields = ['transcript', 'summary', 'candidates', 'unknowns', 'suggestions', 'relativeDates', 'pages', 'doubts', 'diagrams'];
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const stable = (value: any): any => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const contentDigest = (content: Record<string, any>): string => digest(JSON.stringify(stable(Object.fromEntries(fields.map(key => [key, content[key] ?? null])))));
const emptyContent = (): Record<string, any> => ({ transcript: '', summary: '', candidates: [], unknowns: [], suggestions: [], relativeDates: [], pages: [], doubts: [], diagrams: [], derivedStatus: 'needs_rebuild' });

/** No old derived field survives an edited source, including doubts and
 * suggestions that could otherwise be mistaken for the owner's new text. */
export function freezeNoteDerivation(recognized: RecognizedNote | null, generatedXml: string | null, actualXml: string, fingerprint: string): Record<string, any> {
  if (recognized && generatedXml && canonicalDerivationSource(generatedXml) === canonicalDerivationSource(actualXml)) {
    return { ...recognized, derivedStatus: 'ready', derivation: { format: 1, fingerprint,
      sourceDigest: digest(canonicalDerivationSource(actualXml)), contentDigest: contentDigest(recognized) } };
  }
  return emptyContent();
}

/** Historical approval alone proves neither derivative provenance nor an
 * unchanged derivative payload. Do not mutate the historical credential. */
export function noteDerivedContent(version: Pick<NoteVersionRow, 'content' | 'fingerprint' | 'doc_snapshot'>): Record<string, any> {
  const content = version.content ?? {}, proof = content.derivation;
  try {
    if (content.derivedStatus === 'ready' && proof?.format === 1 && proof.fingerprint === version.fingerprint
      && proof.sourceDigest === digest(canonicalDerivationSource(version.doc_snapshot ?? ''))
      && proof.contentDigest === contentDigest(content)) return content;
  } catch { /* Unsupported historical sources cannot gain new trust. */ }
  return emptyContent();
}
