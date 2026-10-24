// Secret scanner for pre-commit and CI. Exits non-zero when a file contains
// an unexempted credential match (--history is report-only and always exits 0).
//
//   node scan.mjs --paths [dir|file...]   scan tracked files (default .)
//   node scan.mjs --staged                scan only staged additions
//   node scan.mjs --history               report hits across all commits
//
// Exemptions are value-hash based (scripts/secrets/allowlist.json): each entry
// pins the sha256 of an explicitly tolerated value with a reason. Directory-
// wide ignores are deliberately not supported. Credential shapes live in
// patterns.mjs, single-sourced with redact.mjs.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PATTERNS, isSafeValue, looksLikeCredential } from './patterns.mjs';

async function loadAllowlist() {
  const here = path.dirname(fileURLToPath(import.meta.url));
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
    for (const m of line.matchAll(p.regex)) {
      const value = m.groups?.value ?? m[0];
      if (!value || isSafeValue(value)) continue;
      if (p.id === 'cred-field' && !looksLikeCredential(value)) continue;
      hits.push({ id: p.id, value });
    }
  }
  return hits;
}

function previewLine(line, value) {
  const idx = line.indexOf(value);
  const start = Math.max(0, idx - 20);
  return `${start > 0 ? '…' : ''}${line.slice(start, idx)}${value.slice(0, 3)}…(${value.length} chars)`;
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

// .pnpm-store is this machine's untracked dependency cache, same nature as
// node_modules.
export async function scanPaths(paths, { skip = ['node_modules', '.pnpm-store', '.git'] } = {}) {
  const allowlist = await loadAllowlist();
  const findings = [];
  const { readdir, stat } = await import('node:fs/promises');
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
    const st = await stat(p);
    if (st.isDirectory()) {
      const entries = await readdir(p, { withFileTypes: true });
      for (const e of entries) {
        if (skip.includes(e.name)) continue;
        await walk(path.join(p, e.name));
      }
    } else if (st.isFile()) {
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
  let reportOnly = false;
  if (args.includes('--staged')) {
    mode = 'staged';
    findings = await scanStaged();
  } else if (args.includes('--history')) {
    mode = 'history';
    reportOnly = true; // known residue disposition is tracked in #228
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
    if (reportOnly) {
      console.error(`secret-scan[${mode}]: report-only mode, exit 0`);
      return;
    }
    process.exit(1);
  }
  console.log(`secret-scan[${mode}]: clean`);
}

const invokedDirectly = process.argv[1]?.endsWith('scan.mjs');
if (invokedDirectly) await main();
