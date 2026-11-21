/* Backfill partner client-link codes (…/r/<code>) for every
   partner who has been activated (status active / paused /
   revoked) and does not hold one yet. 'invited' partners receive
   their code at activation; this script exists for records that
   predate the client link (2026-11-21) and as an operator-run
   alternative to the Desk admin list's lazy backfill — both call
   the same store function, and issuing is idempotent and
   collision-checked.

   Usage (from the repo root, with the database URL in the
   environment — the same one the site uses):
     CONTRACTORS_DATABASE_URL=... node scripts/backfill-partner-client-codes.mjs
   (falls back to DATA_ASSETS_DATABASE_URL, then
   QUESTIONNAIRE_DATABASE_URL, exactly like the store.)

   Prints one line per partner: email, status, code. Never prints
   any credential — a client code is a public routing label. */

import {
  contractorsDbConfigured,
  listContractors,
  backfillPartnerClientCodes
} from '../api/_contractors-store.js';

if (!contractorsDbConfigured()) {
  console.error('No contractors database configured (CONTRACTORS_DATABASE_URL / DATA_ASSETS_DATABASE_URL / QUESTIONNAIRE_DATABASE_URL). Nothing done.');
  process.exit(1);
}

const issued = await backfillPartnerClientCodes();
const all = await listContractors();
for (const c of all || []) {
  console.log(`${c.email}\t${c.status}\t${c.clientCode || '(no code)'}`);
}
console.log(`Done — ${issued} new code(s) issued.`);
