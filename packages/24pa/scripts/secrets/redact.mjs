// Shared secret redaction for logs and evidence exported from this repo.
// Import redactString() in probes/test helpers before writing artifacts to
// docs/research/evidence, or run directly to fix up existing files:
//   node packages/24pa/scripts/secrets/redact.mjs <file...>

const VALUE = '[A-Za-z0-9_.:\\-]{16,}';
const KEYS = [
  'approve_?token',
  'access_?token',
  'refresh_?token',
  'session_?token',
  'app_?secret',
  'token',
  'secret',
  'password',
].join('|');

const RULES = [
  // dsh web startup URL carries the one-time launch token as a query param.
  { id: 'url-launch-token', pattern: new RegExp(`([?&]token=)(${VALUE})`, 'g'), group: 2 },
  // Review-card button tokens and other credential-shaped JSON/JS fields.
  { id: 'cred-field', pattern: new RegExp(`(["'\`]?)(?:${KEYS})\\1(\\s*[:=]\\s*)(["'\`]?)(${VALUE})\\3`, 'gi'), group: 4 },
  { id: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, group: 0 },
  { id: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{30,}/g, group: 0 },
  {
    id: 'pem-private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    group: 0,
  },
];

function isSafeValue(raw) {
  // Environment-variable *names* are references, not credentials.
  if (/^[A-Z][A-Z0-9_]*$/.test(raw)) return true;
  // Already-redacted markers survive re-runs untouched.
  if (/^\[?REDACTED/.test(raw)) return true;
  // Documented placeholder values are examples, not credentials.
  if (/^(replace_with|changeme|your|example|dummy)[_\-/]/i.test(raw)) return true;
  return false;
}

function looksLikeCredential(raw) {
  return /\d/.test(raw) || raw.length >= 32;
}

function applyRule(text, rule) {
  return text.replace(rule.pattern, (match, ...groups) => {
    const raw = rule.group === 0 ? match : groups[rule.group - 1];
    if (!raw || isSafeValue(raw)) return match;
    if (rule.id === 'cred-field' && !looksLikeCredential(raw)) return match;
    return match.replace(raw, `[REDACTED:len=${raw.length}]`);
  });
}

export function redactString(text) {
  let current = text;
  // Nested/escaped JSON (JSON-in-string) hides secrets behind backslashes;
  // re-running the rules reaches the fixpoint within a few passes.
  for (let pass = 0; pass < 5; pass++) {
    const next = RULES.reduce(applyRule, current);
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
