/* IEC Suite — shared shell: nav, clock, themes, sign-out, helpers. */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','&lt;':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DESK = '/desk';
const avatarFor = name => DESK + '/assets/team/' + String(name || '').toLowerCase().replace(/[^a-z]/g, '') + '.jpg';

/* ---- nav ---- */
const NAV = [
  { href: '/',                 icon: '🏠', label: 'Home',         page: 'home' },
  { href: '/desk/office.html',   icon: '🏢', label: "Muse's Office", page: 'office' },
  { href: '/desk/projects.html',     icon: '📁', label: 'Projects',     page: 'projects' },
  { href: '/desk/team.html',          icon: '👥', label: 'Team',         page: 'team' },
  { href: '/desk/meeting-room.html',  icon: '🏛️', label: 'Meeting Room', page: 'meeting', badge: '8 AM' },
  { href: '/desk/virtual-office.html', icon: '🏙️', label: 'Virtual Office', page: 'virtual' },
  { href: '/desk/suzy-chat.html',     icon: '💬', label: 'Chat with Suzy', page: 'suzy-chat' },
  { href: '/desk/opportunities.html', icon: '💼', label: 'Opportunities',page: 'opps', badgeId: 'nav-opps' },
  { href: '/desk/contacts.html',      icon: '📇', label: 'Contacts',     page: 'contacts', badgeId: 'nav-contacts' },
  { href: '/desk/deals.html',         icon: '⚖️', label: 'Deals',        page: 'deals' },
  { href: '/desk/news.html',           icon: '📰', label: 'News',         page: 'news' },
  { href: '/desk/growth.html',        icon: '🚀', label: 'Growth 24/7',  page: 'growth' },
  { href: '/desk/strategy.html',      icon: '🎯', label: 'Strategy',     page: 'strategy' },
  { href: '/desk/trade.html',         icon: '📈', label: 'Trade Pilot',  page: 'trade' },
  { href: '/desk/documents.html',      icon: '📄', label: 'Documents',    page: 'docs' },
];
(function buildNav(){
  const nav = $('nav'); if(!nav) return;
  const page = document.body.dataset.page || 'home';
  nav.innerHTML = NAV.map(n =>
    `<a href="${n.href}" class="${n.page === page ? 'on' : ''}"><i>${n.icon}</i>${n.label}` +
    (n.badge ? `<span class="badge">${n.badge}</span>` : '') +
    (n.badgeId ? `<span class="badge" id="${n.badgeId}" style="display:none"></span>` : '') +
    `</a>`).join('');
})();

/* nav badges from localStorage */
function refreshBadges(){
  try{
    const opps = JSON.parse(localStorage.getItem('morgan-desk-opportunities')) || [];
    const b1 = $('nav-opps');
    if(b1){ b1.textContent = opps.length; b1.style.display = opps.length ? '' : 'none'; }
    const cs = JSON.parse(localStorage.getItem('morgan-desk-contacts')) || [];
    const b2 = $('nav-contacts');
    if(b2){ b2.textContent = cs.length; b2.style.display = cs.length ? '' : 'none'; }
  }catch{}
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
