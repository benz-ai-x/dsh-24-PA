// Shared secret redaction for logs and evidence exported from this repo.
// Import redactString() in probes/test helpers before writing artifacts to
// docs/research/evidence, or run directly to fix up existing files:
//   node packages/24pa/scripts/secrets/redact.mjs <file...>
// Credential shapes live in patterns.mjs, single-sourced with scan.mjs.

import { PATTERNS, isSafeValue, looksLikeCredential } from './patterns.mjs';

function applyPattern(text, { regex, id }) {
  return text.replace(regex, (match, ...rest) => {
    // String.replace callbacks receive the named-groups object last.
    const groups = rest[rest.length - 1];
    const value = groups?.value ?? match;
    if (!value || isSafeValue(value)) return match;
    if (id === 'cred-field' && !looksLikeCredential(value)) return match;
    return match.replace(value, `[REDACTED:len=${value.length}]`);
  });
}

export function redactString(text) {
  let current = text;
  // Nested/escaped JSON (JSON-in-string) hides secrets behind backslashes;
  // re-running the patterns reaches the fixpoint within a few passes.
  for (let pass = 0; pass < 5; pass++) {
    const next = PATTERNS.reduce(applyPattern, current);
    if (next === current) break;
    current = next;
  }
  return current;
}

export async function redactFile(path) {
  const { readFile, writeFile } = await import('node:fs/promises');
  const before = await readFile(path, 'utf8');
  const after = redactString(before);
  if (after !== before) await writeFile(path, after, 'utf8');
  return { path, changed: after !== before };
}

if (process.argv[1]?.endsWith('redact.mjs') && process.argv[2]) {
  const files = process.argv.slice(2);
  const results = [];
  for (const file of files) results.push(await redactFile(file));
  for (const r of results) console.log(r.changed ? `redacted: ${r.path}` : `unchanged: ${r.path}`);
}
