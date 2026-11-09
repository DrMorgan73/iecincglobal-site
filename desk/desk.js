/* IEC Suite — shared shell: nav, clock, themes, sign-out, helpers. */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','&lt;':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DESK = '/desk';
const avatarFor = name => DESK + '/assets/team/' + String(name || '').toLowerCase().replace(/[^a-z]/g, '') + '.jpg';

/* ---- nav + the Office module registry ----
   NAV_GROUPS is the single source of truth for what the Office
   contains: the sidebar renders it, the Organizer (desk/
   organizer.html) rearranges it, and Muse's Office (desk/
   office.html) renders its module grid from it. Ids must match
   the allowlist in api/office-layout.js. */
const NAV_GROUPS = [
  { sec: null, items: [
    { id: 'home',      href: '/',                    icon: '🏠', label: 'Home',          page: 'home',      desc: 'Suite command center — at-a-glance stats and quick actions.' },
    { id: 'suzy-chat', href: '/desk/suzy-chat.html', icon: '💬', label: 'Chat with Suzy', page: 'suzy-chat', desc: 'Talk to Suzy — she carries the agenda, the briefing and the to-do list.' },
    { id: 'demo-users', href: '/desk/demo-users.html', icon: '🎟️', label: 'Demo Users',  page: 'demo-users', desc: 'Demo accounts and the permission matrix for all five assets — plus NDA signings and the activity feed.' },
  ]},
  { sec: 'Deals & People', items: [
    { id: 'opps',     href: '/desk/opportunities.html', icon: '💼', label: 'Dana — Opportunities', page: 'opps', badgeId: 'nav-opps', desc: "Dana's pipeline — scouted employers and data buyers, ranked and followed up." },
    { id: 'deals',    href: '/desk/deals.html',         icon: '⚖️', label: 'Deals',        page: 'deals',    desc: "Judy's deal evaluator — verdicts on every scored opportunity." },
    { id: 'contacts', href: '/desk/contacts.html',      icon: '📇', label: 'Contacts',     page: 'contacts', badgeId: 'nav-contacts', desc: "Rosa's CRM — people, companies and segments, kept clean." },
  ]},
  { sec: 'Work', items: [
    { id: 'projects', href: '/desk/projects.html',     icon: '📁', label: 'Projects',     page: 'projects', desc: 'Every project, tracked in one place.' },
    { id: 'team',     href: '/desk/team.html',          icon: '👥', label: 'Team',         page: 'team',     desc: 'The virtual crew — departments, agents and their briefings.' },
    { id: 'meeting',  href: '/desk/meeting-room.html',  icon: '🏛️', label: 'Meeting Room', page: 'meeting', badge: '8 AM', desc: 'The 8 AM standup room — the whole crew, one table.' },
  ]},
  { sec: 'Offices', items: [
    { id: 'office',    href: '/desk/office.html',        icon: '🏢', label: "Muse's Office", page: 'office',    desc: "Muse's desk — leave work, watch the notes, meet the team she runs." },
    { id: 'virtual',   href: '/desk/virtual-office.html', icon: '🏙️', label: 'Virtual Office', page: 'virtual',  desc: 'The 3D virtual office floor.' },
    { id: 'organizer', href: '/desk/organizer.html',      icon: '🗂️', label: 'My Office',      page: 'organizer', desc: 'The Organizer — every module on one page; drag them into your order, hide what you do not use.' },
  ]},
  { sec: 'Intel', items: [
    { id: 'news',     href: '/desk/news.html',           icon: '📰', label: 'News',         page: 'news',     desc: "What's new in the Suite, plus Piper's daily WIIFM digest." },
    { id: 'growth',   href: '/desk/growth.html',         icon: '🚀', label: 'Growth 24/7',  page: 'growth',   desc: 'The always-on growth board — campaigns and funnels.' },
    { id: 'strategy', href: '/desk/strategy.html',       icon: '🎯', label: 'Strategy',     page: 'strategy', desc: 'Growth strategy and positioning, written down.' },
    { id: 'trade',    href: '/desk/trade.html',          icon: '📈', label: 'Trade Pilot',  page: 'trade',    desc: "Sasha's paper-trading pilot — paper only." },
  ]},
  { sec: 'Records', items: [
    { id: 'yt-archive', href: '/desk/yt-archive.html',  icon: '📺', label: 'YT Archive', page: 'yt-archive', desc: 'The YouTube archive — library and download jobs.' },
    { id: 'docs',       href: '/desk/documents.html',   icon: '📄', label: 'Documents',  page: 'docs',       desc: 'Suite documents and files.' },
    { id: 'vault',      href: '/desk/vault.html',       icon: '🔒', label: 'PDF Vault',  page: 'vault',      desc: 'The locked PDF vault.' },
  ]},
];
const NAV = NAV_GROUPS.flatMap(g => g.items);
const OFFICE_MODULES = NAV_GROUPS.flatMap(g => g.items.map(n => ({ ...n, group: g.sec || 'Everyday' })));
const MODULE_DEFAULT_ORDER = OFFICE_MODULES.map(m => m.id);

/* ---- DrMorgan's saved Office layout (api/office-layout) ----
   { order:[ids], hidden:[ids] } lives server-side in the Office
   Blob store so it follows him across devices. A localStorage
   mirror paints the nav instantly; the server copy then wins. */
const LAYOUT_CACHE_KEY = 'morgan-desk-office-layout';
let deskLayout = null;
function getCachedLayout(){
  try{ return JSON.parse(localStorage.getItem(LAYOUT_CACHE_KEY)) || null; }catch{ return null; }
}
function setDeskLayout(layout){
  deskLayout = layout && Array.isArray(layout.order) ? layout : null;
  try{
    if(deskLayout) localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(deskLayout));
    else localStorage.removeItem(LAYOUT_CACHE_KEY);
  }catch{}
  renderNav();
}
function moduleRank(id){
  const fallback = MODULE_DEFAULT_ORDER.indexOf(id);
  if(!deskLayout) return fallback;
  const i = deskLayout.order.indexOf(id);
  return i < 0 ? 1000 + fallback : i;
}
function moduleHidden(id){
  if(id === 'organizer') return false; /* the door back to the Organizer */
  return !!(deskLayout && Array.isArray(deskLayout.hidden) && deskLayout.hidden.includes(id));
}
function renderNav(){
  const nav = $('nav'); if(!nav) return;
  const page = document.body.dataset.page || 'home';
  nav.innerHTML = NAV_GROUPS.map(g => {
    const items = g.items
      .filter(n => !moduleHidden(n.id))
      .slice()
      .sort((a, b) => moduleRank(a.id) - moduleRank(b.id));
    if(!items.length) return '';
    return (g.sec ? `<div class="nav-sec">${g.sec}</div>` : '') +
      items.map(n =>
        `<a href="${n.href}" class="${n.page === page ? 'on' : ''}"><i>${n.icon}</i>${n.label}` +
        (n.badge ? `<span class="badge">${n.badge}</span>` : '') +
        (n.badgeId ? `<span class="badge" id="${n.badgeId}" style="display:none"></span>` : '') +
        `</a>`).join('');
  }).join('');
  refreshBadges();
}
deskLayout = getCachedLayout();
renderNav();
fetch('/api/office-layout')
  .then(r => (r.ok ? r.json() : null))
  .then(d => { if(d && d.ok) setDeskLayout(d.layout); })
  .catch(() => {});

/* ---- pinned sign-out: always visible at the foot of the sidebar ---- */
(function pinnedSignout(){
  const sb = document.querySelector('.sidebar'); if(!sb) return;
  if(document.getElementById('signout-pinned')) return;
  const bar = document.createElement('div');
  bar.className = 'side-account';
  bar.innerHTML = `<button class="signout-big" id="signout-pinned" title="Sign out of the IEC Suite"><i>🚪</i>Sign out</button>`;
  sb.appendChild(bar);
  bar.querySelector('#signout-pinned').addEventListener('click', () => {
    fetch('/api/desk-logout', {method: 'GET'}).finally(() => { location.href = '/desk/login.html'; });
  });
})();

/* Verified CRM contacts count — one shared fetch + cache so every Desk page
   shows the same audited number: the length of the deduped master
   (desk/data/contacts-verified.json, built by scripts/build-contacts-verified.py).
   The browser's localStorage copy is stale — fallback only if the fetch fails. */
let _verifiedContactsCount = null;
function verifiedContactsCount(){
  if(_verifiedContactsCount !== null) return Promise.resolve(_verifiedContactsCount);
  return fetch('/desk/data/contacts-verified.json')
    .then(r => { if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(list => { _verifiedContactsCount = list.length; return _verifiedContactsCount; });
}

/* nav badges: opportunities from localStorage; contacts from the verified master */
function refreshBadges(){
  try{
    const opps = JSON.parse(localStorage.getItem('morgan-desk-opportunities')) || [];
    const b1 = $('nav-opps');
    if(b1){ b1.textContent = opps.length; b1.style.display = opps.length ? '' : 'none'; }
  }catch{}
  const b2 = $('nav-contacts');
  if(b2){
    verifiedContactsCount()
      .then(n => { b2.textContent = n; b2.style.display = n ? '' : 'none'; })
      .catch(() => {
        try{
          const cs = JSON.parse(localStorage.getItem('morgan-desk-contacts')) || [];
          b2.textContent = cs.length; b2.style.display = cs.length ? '' : 'none';
        }catch{}
      });
  }
}
refreshBadges();

/* ---- clock ---- */
(function tick(){
  const c = $('clock'); if(!c) return;
  const n = new Date();
  c.textContent = n.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const d = $('dateline');
  if(d) d.textContent = n.toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'});
  setTimeout(tick, 15000);
})();

/* ---- desktop moods ---- */
const THEMES = ['iec','midnight','amethyst','ocean','ember','emerald','rose'];
const CUSTOM_KEY = 'morgan-desk-custom-colors';
function getCustom(){ try{ return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || {}; }catch{ return {}; } }
function applyCustom(){
  const c = getCustom(), r = document.documentElement.style;
  if(c.gold) r.setProperty('--gold', c.gold); else r.removeProperty('--gold');
  if(c.teal) r.setProperty('--teal', c.teal); else r.removeProperty('--teal');
  const g = document.getElementById('pick-gold'), t = document.getElementById('pick-teal');
  if(g) g.value = c.gold || getComputedStyle(document.documentElement).getPropertyValue('--gold').trim() || '#f0b942';
  if(t) t.value = c.teal || getComputedStyle(document.documentElement).getPropertyValue('--teal').trim() || '#2dd4bf';
}
function saveCustom(gold, teal){
  const c = getCustom();
  if(gold !== undefined) c.gold = gold;
  if(teal !== undefined) c.teal = teal;
  try{ localStorage.setItem(CUSTOM_KEY, JSON.stringify(c)); }catch{}
  applyCustom();
}

function setTheme(t){
  if(!THEMES.includes(t)) t = 'midnight';
  document.documentElement.dataset.theme = t;
  try{ localStorage.setItem('morgan-desk-theme', t); }catch{}
  document.querySelectorAll('#themes button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  applyCustom();
}
try{ setTheme(localStorage.getItem('morgan-desk-theme') || 'midnight'); }catch{ setTheme('midnight'); }
(function wirePickers(){
  const g = document.getElementById('pick-gold'), t = document.getElementById('pick-teal'), r = document.getElementById('pick-reset');
  if(g) g.addEventListener('input', () => saveCustom(g.value, undefined));
  if(t) t.addEventListener('input', () => saveCustom(undefined, t.value));
  if(r) r.addEventListener('click', () => { try{ localStorage.removeItem(CUSTOM_KEY); }catch{} applyCustom(); });
})();
(function wireThemes(){
  const box = $('themes'); if(!box) return;
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if(!b) return;
    setTheme(b.dataset.t);
  });
})();
function shuffleTheme(){
  const cur = document.documentElement.dataset.theme;
  const rest = THEMES.filter(t => t !== cur);
  setTheme(rest[Math.floor(Math.random() * rest.length)]);
}
document.addEventListener('click', e => {
  if(e.target.closest('[data-action="shuffle-theme"]')) shuffleTheme();
});

/* ---- sign out ---- */
(function wireSignout(){
  const b = $('signout'); if(!b) return;
  b.addEventListener('click', () => {
    fetch('/api/desk-logout', {method: 'GET'}).finally(() => { location.href = '/desk/login.html'; });
  });
})();

/* ---- detail drawer (injected; harmless on pages that don't use it) ---- */
(function injectDrawer(){
  if($('drawer')) return;
  const d = document.createElement('div');
  d.innerHTML = `<div class="scrim" id="scrim"></div>
    <aside class="drawer" id="drawer" aria-hidden="true">
      <button class="drawer-x" id="drawer-x" title="Close">✕</button>
      <div id="drawer-body"></div>
    </aside>`;
  document.body.appendChild(d);
  $('drawer-x').addEventListener('click', closeDrawer);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if(e.key === 'Escape') closeDrawer(); });
})();
function openDrawer(html){
  $('drawer-body').innerHTML = html;
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('scrim').classList.add('open');
}
function closeDrawer(){
  const dr = $('drawer'); if(!dr) return;
  dr.classList.remove('open');
  dr.setAttribute('aria-hidden', 'true');
  $('scrim').classList.remove('open');
}

/* ---- shared formatting ---- */
const money = v => !v && v !== 0 ? '—' : '$' + Number(v).toLocaleString();
const VLABEL = { solid:'Solid', couldbe:'Could be', pass:"Don't waste your time", unscored:'Unscored' };
const dot = s => ({live:'green', building:'amber', pilot:'blue', shelved:'gray', standby:'gray'}[s] || 'gray');
const OPP_KEY = 'morgan-desk-opportunities';
const loadOpps = () => { try { return JSON.parse(localStorage.getItem(OPP_KEY)) || []; } catch { return []; } };

/* ---- live popups: the Suite feels alive ---- */
(function livePopups(){
  // Styles
  const st = document.createElement('style');
  st.textContent = `
    #live-toasts{position:fixed;bottom:18px;right:18px;z-index:200;display:flex;flex-direction:column;gap:10px;max-width:340px}
    .live-toast{display:flex;gap:12px;align-items:flex-start;background:rgba(16,20,32,.96);
      border:1px solid rgba(240,185,66,.3);border-radius:14px;padding:12px 14px;
      box-shadow:0 8px 32px rgba(0,0,0,.5);animation:toastIn .35s cubic-bezier(.2,.9,.3,1.2);
      cursor:pointer;backdrop-filter:blur(8px)}
    .live-toast.out{animation:toastOut .3s ease forwards}
    @keyframes toastIn{from{opacity:0;transform:translateX(60px) scale(.95)}to{opacity:1;transform:none}}
    @keyframes toastOut{to{opacity:0;transform:translateX(60px) scale(.95)}}
    .live-toast img{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none;border:1px solid rgba(240,185,66,.4)}
    .live-toast .lt-body{flex:1;min-width:0}
    .live-toast .lt-name{font-size:13px;font-weight:700;color:#f0b942;margin-bottom:2px}
    .live-toast .lt-text{font-size:13px;line-height:1.4;color:#dfe5f2}
    .live-toast .lt-time{font-size:11px;color:#7c86a0;margin-top:4px}
    @media(max-width:480px){#live-toasts{left:18px;max-width:none}}
  `;
  document.head.appendChild(st);

  const box = document.createElement('div');
  box.id = 'live-toasts';
  document.body.appendChild(box);

  window.suzyToast = function(name, text, avatar){
    const t = document.createElement('div');
    t.className = 'live-toast';
    const av = avatar || avatarFor(name);
    t.innerHTML = `<img src="${av}" alt="" onerror="this.style.display='none'">
      <div class="lt-body"><div class="lt-name">${esc(name)}</div>
      <div class="lt-text">${esc(text)}</div>
      <div class="lt-time">just now</div></div>`;
    t.addEventListener('click', () => dismiss(t));
    box.appendChild(t);
    // Keep max 3
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => dismiss(t), 8000);
    function dismiss(el){
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }
  };

  // Ambient crew activity — makes the Suite feel live
  const ACTIVITY = [
    ['Vera', 'Reviewing this week\u2019s partnership targets…'],
    ['Tess', 'Inbox triage running — nothing urgent.'],
    ['Gemma', 'Scanning for new opportunities…'],
    ['Piper', 'Morning news digest queued for 8 AM.'],
    ['Iris', 'All project watchers green.'],
    ['Rosa', 'CRM standing by for your upload.'],
    ['Judy', 'Deal evaluator ready when you are.'],
    ['Suzy', 'Crew check-in complete — all on schedule.'],
  ];
  let ai = Math.floor(Math.random() * ACTIVITY.length);
  // First popup shortly after load, then every 3-5 minutes
  setTimeout(() => {
    const [n, txt] = ACTIVITY[ai++ % ACTIVITY.length];
    window.suzyToast(n, txt);
  }, 12000);
  setInterval(() => {
    // Don't popup if user is idle (no interaction in 10 min) or tab hidden
    if (document.hidden) return;
    const [n, txt] = ACTIVITY[ai++ % ACTIVITY.length];
    window.suzyToast(n, txt);
  }, 3 * 60 * 1000 + Math.random() * 2 * 60 * 1000);
})();
