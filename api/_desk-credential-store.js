/* =====================================================================
   IEC Suite — Desk credential-override store (shared helper; the
   leading underscore keeps Vercel from routing it as a function).

   WHY THIS EXISTS — the Suite sign-in (api/desk-login.js) compares
   against ONE env credential pair (DESK_USER / DESK_PASS). An env
   var cannot be changed by a web endpoint, so the Nov 23, 2026
   sign-in standard (every sign-in page carries a working
   forgot-password recovery) is implemented as a credential
   OVERRIDE: when a password is set through the emailed-token
   recovery flow, its salted hash lands in this table and
   desk-login verifies against the override INSTEAD of the env
   password. No row = the env credential governs, exactly as
   before. A database failure falls back to the env credential —
   the previous behavior, never an open door.

   Database: the project's existing Neon database
   (iec_questionnaires, Neon project snowy-band-99009019) over the
   HTTPS SQL endpoint — the same transport and env
   (QUESTIONNAIRE_DATABASE_URL) as api/_questionnaire-db.js. The
   table self-provisions (CREATE TABLE IF NOT EXISTS) on first use.

     desk_credential
       username       text PK
       pass_salt      text  — recovery-set password salt (hex)
       pass_hash      text  — HMAC-SHA256 peppered hash (see
                              api/_desk-auth.js)
       token_hash     text  — SHA-256 of the outstanding recovery
                              token (the token itself never stored)
       token_expires  timestamptz
       updated_at     timestamptz

   Test seam: __setDeskStoreTransport(fn) replaces the SQL
   transport (fn(query, params) -> { rows }) so the suites can run
   the real handlers against an in-memory table.
   ===================================================================== */

const TABLE = 'desk_credential';

export function dbConfigured() {
  return !!process.env.QUESTIONNAIRE_DATABASE_URL;
}

let transportOverride = null;
export function __setDeskStoreTransport(fn) {
  transportOverride = fn;
}

async function runSql(query, params) {
  if (transportOverride) return transportOverride(query, params || []);
  const uri = process.env.QUESTIONNAIRE_DATABASE_URL || '';
  const host = new URL(uri).hostname;
  const r = await fetch(`https://${host}/sql`, {
    method: 'POST',
    headers: {
      'Neon-Connection-String': uri,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query, params: params || [] })
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data || data.severity === 'ERROR' || data.code) {
    const msg = (data && (data.message || data.code)) || `http_${r.status}`;
    throw new Error(`desk credential db: ${msg}`);
  }
  return data;
}

let ensured = null;
function ensureTable() {
  if (!ensured) {
    ensured = runSql(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
      'username text PRIMARY KEY, pass_salt text, pass_hash text, ' +
      'token_hash text, token_expires timestamptz, ' +
      'updated_at timestamptz NOT NULL DEFAULT now())'
    ).catch(e => { ensured = null; throw e; });
  }
  return ensured;
}

/* The credential row for a username, or null (no row, or the DB is
   not configured). Throws on transport failure — the caller decides
   how to answer. */
export async function getCredential(username) {
  if (!dbConfigured()) return null;
  await ensureTable();
  const data = await runSql(
    `SELECT username, pass_salt, pass_hash, token_hash, token_expires FROM ${TABLE} WHERE username = $1`,
    [username]
  );
  return (data.rows && data.rows[0]) || null;
}

/* The credential row holding this recovery-token hash, or null. */
export async function getCredentialByTokenHash(tokenHash) {
  if (!dbConfigured()) return null;
  await ensureTable();
  const data = await runSql(
    `SELECT username, pass_salt, pass_hash, token_hash, token_expires FROM ${TABLE} WHERE token_hash = $1`,
    [tokenHash]
  );
  return (data.rows && data.rows[0]) || null;
}

/* Record an outstanding recovery token for the username (creating
   the row if this account has never used recovery). Any password
   override already on the row is preserved. */
export async function setResetToken(username, tokenHash, expiresIso) {
  await ensureTable();
  await runSql(
    `INSERT INTO ${TABLE} (username, token_hash, token_expires, updated_at) VALUES ($1, $2, $3, now()) ` +
    'ON CONFLICT (username) DO UPDATE SET token_hash = EXCLUDED.token_hash, ' +
    'token_expires = EXCLUDED.token_expires, updated_at = now()',
    [username, tokenHash, expiresIso]
  );
}

/* Set the recovery-chosen password and burn the token (single-use:
   after this runs, the token hash is gone from the row). */
export async function setPasswordAndClearToken(username, salt, hash) {
  await ensureTable();
  await runSql(
    `UPDATE ${TABLE} SET pass_salt = $2, pass_hash = $3, token_hash = NULL, ` +
    'token_expires = NULL, updated_at = now() WHERE username = $1',
    [username, salt, hash]
  );
}
