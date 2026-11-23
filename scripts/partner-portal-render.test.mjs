/* Local test suite — Partner Portal door RENDER (Nov 23, 2026).
   The handler suites never executed partners/app.js, which is how
   the Nov 23, 2026 door bug shipped: signinFormHtml() placed a
   multi-line comment after `return`, the line terminator inside
   the comment triggered automatic semicolon insertion, and the
   function silently returned undefined — every door page rendered
   the literal text "undefined" where the sign-in form belongs.
   This suite executes the real app.js in a minimal DOM stub,
   drives boot() -> api('me') 401 -> renderDoor(), and inspects
   the HTML actually assigned to #pp-root for all four door pages:
   root EN, root ES, /signin EN, /es/signin ES.

   Run: node scripts/partner-portal-render.test.mjs   (exit 1 on failure) */

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../partners/app.js', import.meta.url), 'utf8');

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log('  ok  ' + name);
  else { failures++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

function makeElement() {
  return {
    innerHTML: '', textContent: '', hidden: false, disabled: false,
    value: '', checked: false, type: '', id: '',
    classList: { add() {}, remove() {} },
    style: {},
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    focus() {}, scrollIntoView() {}, appendChild() {}, removeChild() {}, select() {},
  };
}

async function renderScenario({ lang, page, pathname }) {
  const rootEl = makeElement();
  const windowStub = { addEventListener() {} };
  if (lang) windowStub.PARTNER_PORTAL_LANG = lang;
  if (page) windowStub.PARTNER_PORTAL_PAGE = page;
  const saved = {
    window: globalThis.window, document: globalThis.document,
    location: globalThis.location, fetch: globalThis.fetch,
  };
  globalThis.window = windowStub;
  globalThis.document = {
    getElementById(id) { return id === 'pp-root' ? rootEl : null; },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    createElement() { return makeElement(); },
    body: makeElement(),
    addEventListener() {},
  };
  globalThis.location = {
    search: '', hash: '', pathname,
    hostname: 'partners.iecincglobal.com',
    origin: 'https://partners.iecincglobal.com',
    href: 'https://partners.iecincglobal.com' + pathname,
    reload() {},
  };
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  globalThis.fetch = async () => ({ status: 401, json: async () => ({ ok: false }) });
  try {
    (0, eval)(src);
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    globalThis.window = saved.window; globalThis.document = saved.document;
    globalThis.location = saved.location; globalThis.fetch = saved.fetch;
  }
  return rootEl.innerHTML;
}

const REQUIRED = [
  ['login form (pp-login-form)', 'id="pp-login-form"'],
  ['username field', 'id="pp-login-username"'],
  ['password field', 'id="pp-login-password"'],
  ['password eye toggle', 'data-pw-eye="pp-login-password"'],
  ['forgot-password toggle', 'id="pp-forgot-toggle"'],
  ['forgot-password form', 'id="pp-forgot-form"'],
  ['first-time section', 'pp-firsttime'],
  ['activation form (pp-signin-form)', 'id="pp-signin-form"'],
  ['activation field', 'id="pp-signin-credential"'],
];

const scenarios = [
  { name: 'root door EN (/)', lang: 'en', page: undefined, pathname: '/' },
  { name: 'root door ES (/es)', lang: 'es', page: undefined, pathname: '/es' },
  { name: 'sign-in page EN (/signin)', lang: 'en', page: 'signin', pathname: '/signin' },
  { name: 'sign-in page ES (/es/signin)', lang: 'es', page: 'signin', pathname: '/es/signin' },
];

for (const s of scenarios) {
  console.log(s.name);
  const html = await renderScenario(s);
  check('renders non-empty', html.length > 0);
  for (const [label, needle] of REQUIRED) check('renders ' + label, html.includes(needle));
  check('no literal "undefined" rendered', !html.includes('undefined'));
}

console.log(failures === 0 ? '\npartner-portal-render.test.mjs: ALL GREEN' : `\npartner-portal-render.test.mjs: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
