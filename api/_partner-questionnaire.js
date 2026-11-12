/* =====================================================================
   IEC Partner Portal — CLIENT QUESTIONNAIRE FIELD SET (approved).
   ---------------------------------------------------------------------
   The counts-only questions a partner records for a client mirror
   the APPROVED online questionnaire, general-business segment, in
   questionnaire-form.html (SEGMENTS["general-business"]) — same
   sections, same question numbers, same labels, copied verbatim.
   Answers are stored in the SAME shape the public form produces:
   an object keyed "Q<n>. <label>" -> string value, so a
   partner-entered answer set is indistinguishable in shape from a
   submission in Dana's database and the assessment reads both the
   same way.

   COUNTS ONLY, ZERO PHI. The validator refuses identifier-carrying
   content in ANY answer value — email addresses, phone numbers,
   SSN patterns, date-of-birth patterns — and the API stores
   NOTHING when validation fails. Keys are restricted to the
   approved set; unknown keys are refused, never silently dropped.
   ===================================================================== */

export const QUESTIONNAIRE_SEGMENT = 'general-business';

export const QUESTIONNAIRE_SECTIONS = [
  {
    title: 'A. The business',
    fields: [
      { n: 1, type: 'area', label: 'Legal entities covered (list each) and what each does (one line)' },
      { n: 2, type: 'text', label: 'Locations (city/state only)' },
      { n: 3, type: 'text', label: 'Year each entity started' },
      { n: 4, type: 'text', label: 'Total employees (full-time / part-time)' },
      { n: 5, type: 'text', label: 'Decision-maker for a data licensing agreement — name + title' }
    ]
  },
  {
    title: 'B. Systems',
    fields: [
      {
        n: 6, type: 'fields', label: 'Core operating systems (name each):',
        subs: ['CRM', 'Job/project system', 'Accounting', 'Email/docs (e.g., Microsoft 365, Google Workspace)', 'Phone/call system', 'Other']
      },
      { n: 7, type: 'area', label: 'Are records centralized in one system or spread across several? (describe briefly)' }
    ]
  },
  {
    title: 'C. Volume & history (counts only)',
    fields: [
      { n: 8, type: 'text', label: 'Customers/clients served per year' },
      { n: 9, type: 'text', label: 'Jobs/orders/projects completed per year' },
      {
        n: 10, type: 'fields', label: 'Years of history stored:',
        subs: ['From year', 'Customer records (years)', 'Job/project records (years)', 'Financial records (years)']
      },
      { n: 11, type: 'text', label: 'Call/email volume per month, if tracked (counts only)' }
    ]
  },
  {
    title: 'D. Workflows & documentation',
    fields: [
      {
        n: 12, type: 'checks', label: 'Do written SOPs exist for:',
        options: ['Sales/intake', 'Operations/delivery', 'Billing', 'Customer service', 'Staff training']
      },
      { n: 13, type: 'text', label: 'Approximate number of staff trained on the same standard workflows' },
      { n: 14, type: 'text', label: 'Languages used with customers and in documentation (list all)' }
    ]
  },
  {
    title: 'E. Scope & exclusions',
    fields: [
      { n: 15, type: 'area', label: 'Any data categories you would exclude (describe categories only)' },
      {
        n: 16, type: 'choice', label: 'Any existing agreements restricting licensing of your operational data?',
        options: ['No', 'Yes'], detail: true
      },
      {
        n: 17, type: 'choice', label: 'Willing to sign an exclusive data licensing grant to IEC MSO for evaluation?',
        options: ['Yes', 'Not yet — questions first'], detail: false
      }
    ]
  }
];

export const QUESTIONNAIRE_FIELDS = QUESTIONNAIRE_SECTIONS.flatMap(s => s.fields);
const FIELD_BY_N = new Map(QUESTIONNAIRE_FIELDS.map(f => [f.n, f]));

/* The storage key for one answer — identical to the public form's
   dataset label ("Q8. Customers/clients served per year"). */
export function answerKey(field) {
  return `Q${field.n}. ${field.label}`;
}

/* Identifier patterns that must never appear in a counts-only
   answer. Deliberately conservative: the approved questions ask for
   counts, years, system names and categories — none of them needs
   an email, a phone number, an SSN or a birth date. */
const IDENTIFIER_PATTERNS = [
  /[^\s@]+@[^\s@]+\.[^\s@]{2,}/,              // email address
  /\b\d{3}-\d{2}-\d{4}\b/,                    // SSN, dashed
  /\b\d{9}\b/,                                // SSN / long ID run, bare
  /\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/,            // phone number
  /\b\d{1,2}\/\d{1,2}\/\d{4}\b/               // date of birth style date
];

function valueHasIdentifier(v) {
  return IDENTIFIER_PATTERNS.some(re => re.test(v));
}

/* Validate + normalise a partner-supplied answers object.
   Input keys may be "q8" / "Q8" / 8 / the full storage key.
   Values: a string, or (for 'fields' questions) an object of
   sub-label -> string, or (for 'checks') an array of option
   strings. Output: { ok:true, answers } in storage shape, or
   { ok:false, error } — 'invalid_answers' for shape problems,
   'identifier_content' when an identifier pattern is found.
   On any failure NOTHING is stored (the API returns before any
   write). */
export function validateQuestionnaireAnswers(input) {
  if (input === undefined || input === null) return { ok: true, answers: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'invalid_answers' };
  const out = {};
  for (const [rawKey, rawVal] of Object.entries(input)) {
    let n = null;
    const km = String(rawKey).match(/^q(\d{1,2})$/i);
    if (km) n = Number(km[1]);
    else {
      const lm = String(rawKey).match(/^Q(\d{1,2})\. /);
      if (lm) n = Number(lm[1]);
    }
    const field = n !== null ? FIELD_BY_N.get(n) : undefined;
    if (!field) return { ok: false, error: 'invalid_answers' };
    if (rawVal === null || rawVal === undefined || rawVal === '') continue;
    let val = '';
    if (field.type === 'fields') {
      if (typeof rawVal !== 'object' || Array.isArray(rawVal)) return { ok: false, error: 'invalid_answers' };
      const parts = [];
      for (const [sub, sv] of Object.entries(rawVal)) {
        if (!field.subs.includes(sub)) return { ok: false, error: 'invalid_answers' };
        const s = String(sv ?? '').trim().slice(0, 200);
        if (s) parts.push(`${sub}: ${s}`);
      }
      val = parts.join(' · ');
    } else if (Array.isArray(rawVal)) {
      const items = rawVal.map(v => String(v ?? '').trim().slice(0, 120)).filter(Boolean);
      if (items.length > 10) return { ok: false, error: 'invalid_answers' };
      val = items.join(', ');
    } else {
      val = String(rawVal).trim().slice(0, 600);
    }
    if (!val) continue;
    if (val.length > 1200) return { ok: false, error: 'invalid_answers' };
    if (valueHasIdentifier(val)) return { ok: false, error: 'identifier_content' };
    out[answerKey(field)] = val;
  }
  return { ok: true, answers: Object.keys(out).length ? out : null };
}

export const _internals = { FIELD_BY_N, IDENTIFIER_PATTERNS, valueHasIdentifier };
