// Documents portal backend — Vercel Node Serverless Function.
// Session-gated via the desk_session cookie (same HMAC scheme as middleware.js).
// Files live in Vercel Blob under desk-docs/<uuid>/<name> with unguessable
// pathnames; the listing is private to the Suite and downloads are proxied
// through this function so raw blob URLs never appear in the page.
//
// Env required:
//   DESK_SESSION_SECRET - HMAC key for the session cookie
//   BLOB_READ_WRITE_TOKEN - Vercel Blob store token (auto-provisioned)
//
// Routes (all require a valid session):
//   GET  /api/desk-docs            -> { docs: [{url, name, size, uploadedAt}] }
//   GET  /api/desk-docs?dl=<url>   -> streams the file back (download proxy)
//   POST /api/desk-docs            -> JSON {name, data(base64)} -> { doc }
//   DELETE /api/desk-docs?url=<url>

import { put, list, del } from '@vercel/blob';
import crypto from 'node:crypto';

const PREFIX = 'desk-docs/';
const MAX_BYTES = 4 * 1024 * 1024;

function getCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
function validSession(value) {
  const secret = process.env.DESK_SESSION_SECRET;
  if (!secret || typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [user, exp, sig] = parts;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(user)) return false;
  if (!/^\d+$/.test(exp)) return false;
  if (Number(exp) * 1000 < Date.now()) return false;
  const expected = crypto.createHmac('sha256', secret).update(user + '.' + exp).digest('hex');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
const safeName = n =>
  String(n || 'file').split('/').pop().replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'file';
const json = (res, obj, status = 200) => {
  res.status(status).setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
};

export default async function handler(req, res) {
  if (!validSession(getCookie(req.headers.cookie, 'desk_session')))
    return json(res, { ok: false, error: 'auth' }, 401);
  if (!process.env.BLOB_READ_WRITE_TOKEN)
    return json(res, { ok: false, error: 'blob_not_configured' }, 500);

  try {
    if (req.method === 'GET' && req.query.dl) {
      const { blobs } = await list({ prefix: PREFIX });
      const hit = blobs.find(b => b.url === req.query.dl);
      if (!hit) return json(res, { ok: false, error: 'not_found' }, 404);
      const upstream = await fetch(hit.url);
      const name = hit.pathname.split('/').pop();
      res.status(200);
      res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('content-disposition', `attachment; filename="${name}"`);
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.end(buf);
    }

    if (req.method === 'GET') {
      const { blobs } = await list({ prefix: PREFIX });
      return json(res, {
        ok: true,
        docs: blobs
          .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
          .map(b => ({ url: b.url, name: b.pathname.split('/').pop(), size: b.size, uploadedAt: b.uploadedAt })),
      });
    }

    if (req.method === 'POST') {
      const { name, data } = req.body || {};
      if (!data || typeof data !== 'string') return json(res, { ok: false, error: 'no_file' }, 400);
      const buf = Buffer.from(data, 'base64');
      if (buf.length > MAX_BYTES) return json(res, { ok: false, error: 'too_large' }, 413);
      const fname = safeName(name);
      const blob = await put(`${PREFIX}${crypto.randomUUID()}/${fname}`, buf, { access: 'public' });
      return json(res, { ok: true, doc: { url: blob.url, name: fname, size: blob.size, uploadedAt: blob.uploadedAt } });
    }

    if (req.method === 'DELETE') {
      const target = req.query.url;
      if (!target) return json(res, { ok: false, error: 'no_url' }, 400);
      const { blobs } = await list({ prefix: PREFIX });
      if (!blobs.some(b => b.url === target)) return json(res, { ok: false, error: 'not_found' }, 404);
      await del(target);
      return json(res, { ok: true });
    }

    return json(res, { ok: false, error: 'method' }, 405);
  } catch (e) {
    return json(res, { ok: false, error: 'failed' }, 500);
  }
}
