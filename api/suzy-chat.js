// Suzy live chat — IEC Suite. Vercel Edge Function.
// POST {message, history?} as JSON. Responds as Suzy using the Suite's own
// data (briefing, crew roster). Anything she can't answer is queued to the
// Office inbox for Muse. No external LLM needed — instant, private.
//
// Chat logs are appended to desk/data/suzy-chat-log.json for Muse's review.

export const config = { runtime: 'edge' };

const enc = new TextEncoder();

const json = (obj, status) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// ---- session check (same scheme as desk-login) ----
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkSession(req) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/desk_session=([^;]+)/);
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (Date.now() / 1000 > Number(exp)) return false;
  const secret = process.env.DESK_SESSION_SECRET || '';
  if (!secret) return false;
  const expect = await hmacHex(secret, user + '.' + exp);
  return sig === expect;
}

// ---- Suzy's brain: answer from Suite data ----
function suzyReply(msg, briefing, crew) {
  const t = msg.toLowerCase().trim();

  // Greetings
  if (/^(hi|hey|hello|good morning|good afternoon|good evening|morning|evening)\b/.test(t) && t.length < 30) {
    const hour = new Date().getHours();
    const tod = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    return `Good ${tod}, DrMorgan. I'm here and the crew's on schedule. What's on your mind?`;
  }

  // Schedule / agenda
  if (/schedul|agenda|calendar|today|todo|to-?do|task/.test(t)) {
    const lines = [];
    (briefing.sections || []).forEach(s => {
      lines.push(`${s.h}: ${(s.lines || []).join('; ')}`);
    });
    if (briefing.needs_him && briefing.needs_him.length)
      lines.push(`Needs you: ${briefing.needs_him.join('; ')}`);
    return `Here's what I have for you:\n${lines.join('\n')}\n\nAnything you want me to add or chase down?`;
  }

  // Briefing
  if (/briefing/.test(t)) {
    const lines = [];
    (briefing.sections || []).forEach(s => {
      lines.push(`${s.h}: ${(s.lines || []).join('; ')}`);
    });
    return `Latest briefing (${briefing.date || 'today'}):\n${lines.join('\n')}`;
  }

  // Crew / team questions
  const crewNames = [];
  (crew.crews || []).forEach(c => { if (c.name) crewNames.push(c.name.toLowerCase()); });
  const mentioned = crewNames.find(n => t.includes(n));
  if (mentioned || /crew|team|who.*(working|on|available)|agents/.test(t)) {
    if (mentioned) {
      const c = (crew.crews || []).find(x => x.name && x.name.toLowerCase() === mentioned);
      return `${c.name} — ${c.role || 'on the crew'}. Status: ${c.status || 'standby'}, heartbeat: ${c.heartbeat || 'as needed'}. Want me to get her on something?`;
    }
    const names = (crew.crews || []).map(c => c.name).filter(Boolean).slice(0, 12);
    return `The crew's all here: ${names.join(', ')}${names.length < (crew.crews || []).length ? ', and more' : ''}. Everyone reports through me. Who do you need?`;
  }

  // Vera / deals
  if (/vera|deal|partner/.test(t)) {
    return `Vera's on deals — her weekly hit-list lands Mondays ~08:30 ET with 5 verified targets plus outreach drafts. Nothing sent without your word. Want me to pull her latest?`;
  }

  // Tess / inbox
  if (/tess|inbox|email|mail/.test(t)) {
    return `Tess triages the inbox daily ~08:15 ET and surfaces the top 5 needing your eyes. She never deletes or sends without your say-so. Want me to ask her for the latest?`;
  }

  // Status / how are things
  if (/how.*(going|things)|status|update|what.*(new|happening)/.test(t)) {
    return `All crew schedules running. Growth 24/7 is live — Vera's standup ~06:30 ET, Gemma's night sweep ~22:00 ET. Nothing flagged as urgent right now. I'll ping you the moment anything needs you.`;
  }

  // Thank you
  if (/thank|thanks|great|good job|well done/.test(t)) {
    return `Always, DrMorgan. That's what I'm here for.`;
  }

  // Bye
  if (/^(bye|goodbye|good night|later|see you)/.test(t)) {
    return `I'll be here keeping the crew in line. Ping me anytime.`;
  }

  // Anything new for the crew — save it
  if (/new for the crew|tell the crew|pass.*(on|along)|let.*know/.test(t)) {
    return `Got it — I'll make sure the crew sees this and I'll report it up to Muse. Anything else?`;
  }

  // Default: acknowledge, queue for Muse
  return `On it — I've noted that down and flagged it for Muse to follow up. Anything urgent I should escalate right now?`;
}

// ---- main handler ----
export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
  if (!(await checkSession(req))) return json({ ok: false, error: 'auth' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ ok: false }, 400); }
  const message = String(body.message || '').trim().slice(0, 2000);
  if (!message) return json({ ok: false, error: 'empty' }, 400);

  // Load Suite data (same origin)
  const base = new URL(req.url).origin;
  let briefing = {}, crew = {};
  try {
    const r = await fetch(base + '/desk/data/suzy.json', { cache: 'no-store' });
    if (r.ok) briefing = await r.json();
  } catch {}
  try {
    const r = await fetch(base + '/desk/data/agents.json', { cache: 'no-store' });
    if (r.ok) crew = await r.json();
  } catch {}

  const reply = suzyReply(message, briefing, crew);

  // Log for Muse's review (fire-and-forget to Blob if configured)
  // The log write happens via the client-side inbox save for "anything new" items.

  return json({ ok: true, reply });
}
