/* IEC Suite — shared shell: nav, clock, themes, sign-out, helpers. */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','&lt;':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DESK = '/desk';
const avatarFor = name => DESK + '/assets/team/' + String(name || '').toLowerCase().replace(/[^a-z]/g, '') + '.jpg';

/* ---- nav ---- */
const NAV = [
  { href: '/',                 icon: '🏠', label: 'Home',         page: 'home' },
  { href: '/desk/projects.html',     icon: '📁', label: 'Projects',     page: 'projects' },
  { href: '/desk/team.html',          icon: '👥', label: 'Team',         page: 'team' },
  { href: '/desk/meeting-room.html',  icon: '🏛️', label: 'Meeting Room', page: 'meeting', badge: '8 AM' },
  { href: '/desk/opportunities.html', icon: '💼', label: 'Opportunities',page: 'opps', badgeId: 'nav-opps' },
  { href: '/desk/contacts.html',      icon: '📇', label: 'Contacts',     page: 'contacts', badgeId: 'nav-contacts' },
  { href: '/desk/deals.html',         icon: '⚖️', label: 'Deals',        page: 'deals' },
  { href: '/desk/news.html',           icon: '📰', label: 'News',         page: 'news' },
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
