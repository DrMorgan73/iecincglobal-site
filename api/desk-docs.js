// Documents portal backend — Vercel Edge Function.
// Session-gated via the desk_session cookie (same HMAC scheme as middleware.js).
// Files live in Vercel Blob under desk-docs/<uuid>/<name> with unguessable
// pathnames; the listing is private to the Suite and downloads are proxied
// through this function so raw blob URLs never appear in the page.
//
// Env required:
//   DESK_SESSION_SECRET - HMAC key for the session cookie
//   BLOB_READ_WRITE_TOKEN - Vercel Blob store token
//
// Routes (all require a valid session):
//   GET  /api/desk-docs            -> { docs: [{url, name, size, uploadedAt}] }
//   GET  /api/desk-docs?dl=<url>   -> streams the file back (download proxy)
//   POST /api/desk-docs            -> multipart form {file} -> { doc }
//   DELETE /api/desk-docs?url=<url>

export const config = { runtime: 'edge' };

import { put, list, del } from '@vercel/blob';

const enc = new TextEncoder();
const PREFIX = 'desk-docs/';
const MAX_BYTES = 4 * 1024 * 1024; // stay under the Edge body limit

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function getCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
async function validSession(value) {
  const secret = process.env.DESK_SESSION_SECRET;
  if (!secret) return false;
  const parts = String(value).split('.');
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return false;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = await hmacHex(secret, user + '.' + exp);
  return timingSafeEqual(sig, expected);
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const safeName = n =>
  String(n || 'file').split('/').pop().replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';

export default async function handler(req) {
  const session = getCookie(req.headers.get('cookie'), 'desk_session');
  if (!session || !(await validSession(session))) return json({ ok: false, error: 'auth' }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json({ ok: false, error: 'blob_not_configured' }, 500);

  const url = new URL(req.url);

  if (req.method === 'GET' && url.searchParams.has('dl')) {
    const target = url.searchParams.get('dl');
    const { blobs } = await list({ prefix: PREFIX });
    const hit = blobs.find(b => b.url === target);
    if (!hit) return json({ ok: false, error: 'not_found' }, 404);
    const upstream = await fetch(hit.url);
    const name = hit.pathname.split('/').pop();
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
        'content-disposition': `attachment; filename="${name}"`,
      },
    });
  }

  if (req.method === 'GET') {
    const { blobs } = await list({ prefix: PREFIX });
    return json({
      ok: true,
      docs: blobs
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
        .map(b => ({ url: b.url, name: b.pathname.split('/').pop(), size: b.size, uploadedAt: b.uploadedAt })),
    });
  }

  if (req.method === 'POST') {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return json({ ok: false, error: 'no_file' }, 400);
    if (file.size > MAX_BYTES) return json({ ok: false, error: 'too_large' }, 413);
    const name = safeName(file.name);
    const blob = await put(`${PREFIX}${crypto.randomUUID()}/${name}`, file, { access: 'public' });
    return json({ ok: true, doc: { url: blob.url, name, size: blob.size, uploadedAt: blob.uploadedAt } });
  }

  if (req.method === 'DELETE') {
    const target = url.searchParams.get('url');
    if (!target) return json({ ok: false, error: 'no_url' }, 400);
    const { blobs } = await list({ prefix: PREFIX });
    if (!blobs.some(b => b.url === target)) return json({ ok: false, error: 'not_found' }, 404);
    await del(target);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'method' }, 405);
}
