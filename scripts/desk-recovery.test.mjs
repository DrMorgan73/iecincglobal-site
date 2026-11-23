/* Local test suite for the IEC Suite sign-in standard (Nov 23, 2026):
   api/desk-login.js + api/desk-recover.js + api/desk-reset.js +
   api/_desk-credential-store.js + api/_desk-auth.js.

   The credential store runs against an in-memory table through its
   transport seam; fetch is mocked for Resend (mail is captured, never
   sent). No real database, no network.
   Run: node scripts/desk-recovery.test.mjs   (exit 1 on failure) */

process.env.DESK_USER = 'office';
process.env.DESK_PASS = 'env-password-123';
process.env.DESK_SESSION_SECRET = 'test-desk-secret';
process.env.DEMO_ADMIN_RESEND_API_KEY = 'test-resend-key';
process.env.QUESTIONNAIRE_DATABASE_URL = 'postgres://unused.invalid/db';

const { __setDeskStoreTransport } = await import('../api/_desk-credential-store.js');

/* ---------------- in-memory desk_credential table ---------------- */
const rows = new Map(); // username -> row
__setDeskStoreTransport(async (query, params) => {
  const q = query.replace(/\s+/g, ' ').trim();
  if (/^CREATE TABLE IF NOT EXISTS/.test(q)) return { rows: [] };
  if (/^SELECT .* WHERE username = \$1/.test(q)) {
    const r = rows.get(params[0]);
    return { rows: r ? [{ ...r }] : [] };
  }
  if (/^SELECT .* WHERE token_hash = \$1/.test(q)) {
    for (const r of rows.values()) if (r.token_hash === params[0]) return { rows: [{ ...r }] };
    return { rows: [] };
  }
  if (/^INSERT INTO desk_credential/.test(q)) {
    const [username, tokenHash, expires] = params;
    const r = rows.get(username) || { username, pass_salt: null, pass_hash: null, token_hash: null, token_expires: null };
    r.token_hash = tokenHash; r.token_expires = expires;
    rows.set(username, r);
    return { rows: [] };
  }
  if (/^UPDATE desk_credential SET pass_salt/.test(q)) {
    const [username, salt, hash] = params;
    const r = rows.get(username);
    if (r) { r.pass_salt = salt; r.pass_hash = hash; r.token_hash = null; r.token_expires = null; }
    return { rows: [] };
  }
  throw new Error('unhandled query: ' + q);
});

/* ---------------- mocked Resend ---------------- */
const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.resend.com')) {
    mails.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: 'test-mail' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unexpected fetch: ' + url);
};

const login = (await import('../api/desk-login.js')).default;
const recover = (await import('../api/desk-recover.js')).default;
const reset = (await import('../api/desk-reset.js')).default;

const post = (handler, body, raw) => handler(new Request('https://iecincglobal.com/api/x', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: raw !== undefined ? raw : JSON.stringify(body)
}));

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

/* Baseline: env credential governs before any recovery. */
let r = await post(login, { username: 'office', password: 'env-password-123' });
check('baseline login with env password → 200', r.status === 200 && (r.headers.get('set-cookie') || '').includes('desk_session='));
r = await post(login, { username: 'office', password: 'wrong' });
check('login with wrong password → 401', r.status === 401);

/* Recovery: unknown username — generic 200, no mail. */
r = await post(recover, { username: 'nobody' });
check('recover unknown user → generic 200', r.status === 200 && (await r.json()).ok === true);
check('recover unknown user → no mail sent', mails.length === 0);

/* Recovery: malformed body — still generic. */
r = await post(recover, null, '{not json');
check('recover malformed body → generic 200', r.status === 200);

/* Recovery: the real username — one mail, token inside. */
r = await post(recover, { username: 'office' });
check('recover real user → generic 200', r.status === 200);
check('recover real user → exactly one mail', mails.length === 1);
const mail = mails[0];
check('mail to info@iecincglobal.com only', JSON.stringify(mail.to) === '["info@iecincglobal.com"]' && !mail.cc && !mail.bcc);
check('mail from info@iecincglobal.com', /info@iecincglobal\.com/.test(mail.from));
const tokenMatch = String(mail.text).match(/token=([0-9a-f]{64})/);
check('mail carries a 64-hex token link', !!tokenMatch);
const token = tokenMatch[1];
const rowAfterRecover = rows.get('office');
check('store holds only the token hash', rowAfterRecover && rowAfterRecover.token_hash && rowAfterRecover.token_hash !== token);

/* Reset: bogus token, short password. */
r = await post(reset, { token: 'f'.repeat(64), password: 'a-brand-new-password' });
check('reset with bogus token → 401', r.status === 401);
r = await post(reset, { token, password: 'short' });
check('reset with short password → 400', r.status === 400);

/* Reset: the real token — signs in, burns the token. */
r = await post(reset, { token, password: 'a-brand-new-password' });
check('reset with real token → 200 + session cookie', r.status === 200 && (r.headers.get('set-cookie') || '').includes('desk_session=office.'));
r = await post(reset, { token, password: 'another-new-password' });
check('token reuse → 401 (single-use)', r.status === 401);

/* After reset: the override replaces the env password. */
r = await post(login, { username: 'office', password: 'env-password-123' });
check('old env password after reset → 401', r.status === 401);
r = await post(login, { username: 'office', password: 'a-brand-new-password' });
check('new password after reset → 200', r.status === 200);

/* Expiry: a fresh token aged past 30 minutes is refused. */
mails.length = 0;
r = await post(recover, { username: 'office' });
const token2 = String(mails[0].text).match(/token=([0-9a-f]{64})/)[1];
rows.get('office').token_expires = new Date(Date.now() - 60 * 1000).toISOString();
r = await post(reset, { token: token2, password: 'yet-another-password' });
check('expired token → 401', r.status === 401);
r = await post(login, { username: 'office', password: 'a-brand-new-password' });
check('password unchanged by expired-token attempt → 200', r.status === 200);

globalThis.fetch = realFetch;
console.log(`\ndesk-recovery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
