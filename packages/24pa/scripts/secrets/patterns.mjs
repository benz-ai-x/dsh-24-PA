// Single source of credential shapes for redact.mjs and scan.mjs; the two
// tools must never drift apart. Values are captured in the named group
// `value` (patterns without one match the whole credential).

export const FIELD_VALUE = '[A-Za-z0-9_.:\\-]{16,}';
export const URL_VALUE = '[A-Za-z0-9_.\\-]{16,}';

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

export const PATTERNS = [
  // dsh web startup URL carries the one-time launch token as a query param.
  { id: 'url-launch-token', regex: new RegExp(`[?&]token=(?<value>${URL_VALUE})`, 'g') },
  // Review-card button tokens ("<48hex>:body") and other credential fields.
  // The lookbehind stops mid-identifier matches (PA24_FEISHU_APP_SECRET=…),
  // and the optional escaped quotes tolerate JSON-in-string shapes like
  // \"token\":\"…\" without any closing-quote backreference.
  {
    id: 'cred-field',
    regex: new RegExp(
      `(?<![A-Za-z0-9_])(?:\\\\?["'\`]?)(?:${KEYS})(?:\\\\?["'\`]?)\\s*[:=]\\s*(?:\\\\?["'\`]?)(?<value>${FIELD_VALUE})`,
      'gi',
    ),
  },
  { id: 'jwt', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g },
  { id: 'github-token', regex: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { id: 'openai-key', regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { id: 'slack-token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'aws-key', regex: /AKIA[0-9A-Z]{16}/g },
  { id: 'google-key', regex: /AIza[0-9A-Za-z_-]{30,}/g },
  { id: 'pem-private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
];

export function isSafeValue(raw) {
  // Environment-variable *names* are references, not credentials.
  if (/^[A-Z][A-Z0-9_]*$/.test(raw)) return true;
  // Already-redacted markers survive re-runs untouched.
  if (/^\[?REDACTED/.test(raw)) return true;
  // Documented placeholder values are examples, not credentials.
  if (/^(replace_with|changeme|your|example|dummy)[_-]/i.test(raw)) return true;
  // Feishu media/image/file tokens are resource identifiers inside document
  // payloads; fetching them still requires tenant authorization.
  if (/^(img_v2_|media[-_]|file_v)[-A-Za-z0-9_]*$/i.test(raw)) return true;
  return false;
}

// `token: params.appSecret` assigns identifiers, not credentials; real token
// values carry digits, and long-enough alpha strings stay covered.
export function looksLikeCredential(raw) {
  return /\d/.test(raw) || raw.length >= 32;
}
