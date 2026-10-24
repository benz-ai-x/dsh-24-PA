// Secret scanner for pre-commit and CI. Exits non-zero when a file contains
// an unexempted credential match.
//
//   node scan.mjs --paths [dir|file...]   scan the working tree (default .)
//   node scan.mjs --staged                scan only staged additions
//   node scan.mjs --history               report hits across all commits
//
// Exemptions are value-hash based (scripts/secrets/allowlist.json): each entry
// pins the sha256 of an explicitly tolerated value with a reason. Directory-
// wide ignores are deliberately not supported.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

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

const PATTERNS = [
  { id: 'url-launch-token', regex: new RegExp(`[?&]token=(${VALUE})`) },
  { id: 'cred-field', regex: new RegExp(`(["'\`]?)(?:${KEYS})\\1\\s*[:=]\\s*["'\`]?(${VALUE})`, 'i') },
  { id: 'jwt', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
  { id: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { id: 'openai-key', regex: /sk-[A-Za-z0-9_-]{20,}/ },
  { id: 'slack-token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { id: 'aws-key', regex: /AKIA[0-9A-Z]{16}/ },
  { id: 'google-key', regex: /AIza[0-9A-Za-z_-]{30,}/ },
];

function isSafeValue(raw) {
  if (/^[A-Z][A-Z0-9_]*$/.test(raw)) return true;
  if (/^\[?REDACTED/.test(raw)) return true;
  // Documented placeholder values are examples, not credentials.
  if (/^(replace_with|changeme|your|example|dummy)[_\-/]/i.test(raw)) return true;
  return false;
}

// `token: params.appSecret` assigns identifiers, not credentials; real
// token values carry digits, and long-enough alpha strings stay covered.
function looksLikeCredential(raw) {
  return /\d/.test(raw) || raw.length >= 32;
}

async function loadAllowlist() {
  const here = path.dirname(new URL(import.meta.url).pathname);
  try {
    return JSON.parse(await readFile(path.join(here, 'allowlist.json'), 'utf8'));
  } catch {
    return [];
  }
}

function isAllowed(allowlist, value, file) {
  const hash = createHash('sha256').update(value).digest('hex');
  return allowlist.some(
    (e) => e.sha256 === hash && (!e.file || (file && file.endsWith(e.file))),
  );
}

export function scanLine(line) {
  const hits = [];
  for (const p of PATTERNS) {
    for (const m of line.matchAll(new RegExp(p.regex.source, p.regex.flags.includes('g') ? p.regex.flags : p.regex.flags + 'g'))) {
      // The credential is the last capture group; groupless patterns match whole.
      const value = m.length > 1 ? m[m.length - 1] : m[0];
      if (!value || isSafeValue(value)) continue;
      if (p.id === 'cred-field' && !looksLikeCredential(value)) continue;
      hits.push({ id: p.id, value });
    }
  }
  return hits;
}

export async function scanText(text, file, allowlist) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const hit of scanLine(lines[i])) {
      if (isAllowed(allowlist, hit.value, file)) continue;
      findings.push({ file, line: i + 1, id: hit.id, preview: previewLine(lines[i], hit.value) });
    }
  }
  return findings;
}

function previewLine(line, value) {
  const idx = line.indexOf(value);
  const start = Math.max(0, idx - 20);
  const mask = (s) => s.split('').map((c, i) => (i < 3 ? c : '…')).join('') + `(${value.length} chars)`;
  return `${start > 0 ? '…' : ''}${line.slice(start, idx)}${mask(value)}`;
}

// .pnpm-store is this machine's untracked dependency cache, same nature as node_modules.
export async function scanPaths(paths, { skip = ['node_modules', '.pnpm-store', '.git'] } = {}) {
  const allowlist = await loadAllowlist();
  const findings = [];
  const { readdir } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  // Default mode mirrors CI: only git-tracked files (local runtime homes like
  // .prototype-runtime stay out). Explicit paths walk the filesystem so
  // not-yet-staged evidence can be checked before adding.
  if (paths.length === 1 && paths[0] === '.') {
    try {
      const tracked = await new Promise((resolve, reject) =>
        execFile('git', ['ls-files'], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))),
      );
      for (const f of tracked.split('\n').filter(Boolean)) {
        if (f.split('/').some((seg) => skip.includes(seg))) continue;
        const text = await readFile(f, 'utf8').catch(() => null);
        if (text !== null) findings.push(...(await scanText(text, f, allowlist)));
      }
      return findings;
    } catch {
      // not a git repo — fall through to the filesystem walk
    }
  }
  async function walk(p) {
    const stat = await import('node:fs/promises').then((fs) => fs.stat(p));
    if (stat.isDirectory()) {
      const entries = await readdir(p, { withFileTypes: true });
      for (const e of entries) {
        if (skip.includes(e.name)) continue;
        await walk(path.join(p, e.name));
      }
    } else if (stat.isFile()) {
      const text = await readFile(p, 'utf8').catch(() => null);
      if (text !== null) findings.push(...(await scanText(text, p, allowlist)));
    }
  }
  for (const p of paths) await walk(p);
  return findings;
}

async function scanStaged() {
  const allowlist = await loadAllowlist();
  const { execFile } = await import('node:child_process');
  const diff = await new Promise((resolve, reject) =>
    execFile('git', ['diff', '--cached', '-U0', '--no-color', '--no-ext-diff'], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))),
  );
  const findings = [];
  let file = null;
  let line = 0;
  for (const row of diff.split('\n')) {
    const fileMatch = row.match(/^\+\+\+ b\/(.*)$/);
    if (fileMatch) { file = fileMatch[1]; continue; }
    const hunkMatch = row.match(/^@@ .*?\+(\d+)/);
    if (hunkMatch) { line = Number(hunkMatch[1]); continue; }
    if (row.startsWith('+')) {
      for (const hit of scanLine(row.slice(1))) {
        if (isAllowed(allowlist, hit.value, file)) continue;
        findings.push({ file, line, id: hit.id, preview: previewLine(row.slice(1), hit.value) });
      }
      line++;
    }
  }
  return findings;
}

async function scanHistory() {
  const allowlist = await loadAllowlist();
  const { execFile } = await import('node:child_process');
  const stream = await new Promise((resolve, reject) =>
    execFile('git', ['log', '--all', '-p', '--no-color'], { maxBuffer: 512 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out))),
  );
  const findings = [];
  let sha = null;
  let file = null;
  for (const row of stream.split('\n')) {
    const commitMatch = row.match(/^commit ([0-9a-f]{40})/);
    if (commitMatch) { sha = commitMatch[1].slice(0, 12); continue; }
    const fileMatch = row.match(/^diff --git a\/.* b\/(.*)$/);
    if (fileMatch) { file = fileMatch[1]; continue; }
    if (row.startsWith('+') && !row.startsWith('+++')) {
      for (const hit of scanLine(row.slice(1))) {
        if (isAllowed(allowlist, hit.value, file)) continue;
        const key = `${sha}:${file}:${hit.id}`;
        if (!findings.some((f) => f.key === key)) {
          findings.push({ key, sha, file, id: hit.id });
        }
      }
    }
  }
  return findings;
}

async function main() {
  const args = process.argv.slice(2);
  let findings;
  let mode;
  if (args.includes('--staged')) {
    mode = 'staged';
    findings = await scanStaged();
  } else if (args.includes('--history')) {
    mode = 'history';
    findings = await scanHistory();
  } else {
    mode = 'paths';
    const paths = args.includes('--paths') ? args.slice(args.indexOf('--paths') + 1) : ['.'];
    findings = await scanPaths(paths.length ? paths : ['.']);
  }
  if (findings.length) {
    console.error(`secret-scan[${mode}]: ${findings.length} unexempted hit(s)`);
    for (const f of findings.slice(0, 50)) {
      console.error(`  ${f.sha ? f.sha + ' ' : ''}${f.file}:${f.line ?? ''} [${f.id}] ${f.preview ?? ''}`);
    }
    if (findings.length > 50) console.error(`  … and ${findings.length - 50} more`);
    process.exit(1);
  }
  console.log(`secret-scan[${mode}]: clean`);
}

const invokedDirectly = process.argv[1]?.endsWith('scan.mjs');
if (invokedDirectly) await main();
