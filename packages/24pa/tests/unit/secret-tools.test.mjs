import { describe, expect, it } from 'vitest';
import { redactString } from '../../scripts/secrets/redact.mjs';
import { scanLine, scanText } from '../../scripts/secrets/scan.mjs';
import { createHash } from 'node:crypto';

// Randomly generated 48-hex values, never real credentials. The ALLOWED value
// is pinned by sha256 in scripts/secrets/allowlist.json to test suppression;
// the BLOCKED value must always be flagged.
const FAKE_ALLOWED = 'ec530ec3b74a7a3e2f6a8a054007a6e04c90f64dbd1138ac';
const FAKE_BLOCKED = '0784ed7250c0486e395547e9c5aa0064de34c2b699cbddf0';
const FAKE_LAUNCH = 'MpZ5TestLaunchToken1234567890abcd';
const FAKE_JWT = `eyJ${'a'.repeat(20)}.eyJ${'b'.repeat(20)}.${'c'.repeat(10)}`;

const allowlistFixture = [
  {
    sha256: createHash('sha256').update(FAKE_ALLOWED).digest('hex'),
    file: 'tests/unit/secret-tools.test.mjs',
    reason: 'fixture',
  },
];

describe('redactString', () => {
  it('redacts the launch token from a URL while keeping locator info', () => {
    const url = `http://127.0.0.1:32111/?token=${FAKE_LAUNCH}#/home`;
    expect(redactString(url)).toBe(`http://127.0.0.1:32111/?token=[REDACTED:len=${FAKE_LAUNCH.length}]#/home`);
  });

  it('redacts quoted JSON credential fields and keeps keys readable', () => {
    const line = `{"key":"notereview:N-1:v1","token":"${FAKE_BLOCKED}"}`;
    expect(redactString(line)).toContain(`"token":"[REDACTED:len=48]"`);
    expect(redactString(line)).toContain('"key":"notereview:N-1:v1"');
  });

  it('redacts button tokens that carry an action suffix after a colon', () => {
    // Real shape from the review-card evidence: "<48-hex>:body" / "<48-hex>:derived".
    const line = `{"pa24":"review","token":"${FAKE_BLOCKED}:body"}`;
    expect(redactString(line)).toContain(`"token":"[REDACTED:len=53]"`);
    expect(scanLine(`{"token":"${FAKE_BLOCKED}:derived"}`).map((h) => h.id)).toEqual(['cred-field']);
  });

  it('reaches secrets hidden behind nested/escaped JSON', () => {
    const inner = `started at http://127.0.0.1:32111/?token=${FAKE_LAUNCH}`;
    const wrapped = JSON.stringify({ stdout: JSON.stringify({ url: inner }) });
    const out = redactString(wrapped);
    expect(out).not.toContain(FAKE_LAUNCH);
    expect(out).toContain(`token=[REDACTED:len=${FAKE_LAUNCH.length}`);
  });

  it('redacts JWTs and leaves non-credential hex fingerprints alone', () => {
    const fingerprint = 'a'.repeat(64);
    const out = redactString(`{"jwt":"${FAKE_JWT}","fingerprint":"${fingerprint}"}`);
    expect(out).not.toContain(FAKE_JWT);
    expect(out).toContain(`"${fingerprint}"`);
  });

  it('is idempotent and skips env-var names and existing markers', () => {
    const text = `"appSecretEnv":"PA24_FEISHU_APP_SECRET","token":"[REDACTED:len=48]"`;
    expect(redactString(text)).toBe(text);
    const once = redactString(`?token=${FAKE_LAUNCH}`);
    expect(redactString(once)).toBe(once);
  });
});

describe('scanLine/scanText', () => {
  it('detects launch URLs, credential fields and known key shapes', () => {
    const ids = (line) => scanLine(line).map((h) => h.id);
    expect(ids(`open http://127.0.0.1:1/?token=${FAKE_LAUNCH}`)).toContain('url-launch-token');
    expect(ids(`"token":"${FAKE_BLOCKED}"`)).toContain('cred-field');
    expect(ids(`auth Bearer ${FAKE_JWT}`)).toContain('jwt');
    expect(ids('ghp_' + 'a1'.repeat(20))).toContain('github-token');
  });

  it('does not flag env-var names, short values or redacted markers', () => {
    expect(scanLine('"appSecretEnv":"PA24_FEISHU_APP_SECRET"')).toHaveLength(0);
    expect(scanLine('"tokenId":"note-1"')).toHaveLength(0);
    expect(scanLine('"token":"[REDACTED:len=48]"')).toHaveLength(0);
  });

  it('suppresses allowlisted values via value hash scoped to the pinned file', async () => {
    const text = `{"token":"${FAKE_ALLOWED}","secret":"${FAKE_BLOCKED}"}\n`;
    const inScope = await scanText(text, 'pkg/tests/unit/secret-tools.test.mjs', allowlistFixture);
    expect(inScope.map((f) => f.id)).toEqual(['cred-field']); // only FAKE_BLOCKED
    const outOfScope = await scanText(text, 'docs/evidence/sample.log', allowlistFixture);
    expect(outOfScope.map((f) => f.id).sort()).toEqual(['cred-field', 'cred-field']);
  });

  it('reports unexempted hits with file and line', async () => {
    const text = `ok\n"token":"${FAKE_BLOCKED}"\n`;
    const findings = await scanText(text, 'evidence/sample.log', []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'evidence/sample.log', line: 2, id: 'cred-field' });
    expect(findings[0].preview).not.toContain(FAKE_BLOCKED);
  });
});
