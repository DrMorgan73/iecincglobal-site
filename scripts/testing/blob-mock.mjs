/* In-memory mock of @vercel/blob for the local test suites.
   Implements the subset the api/ functions use — put / list / del —
   with the same shapes as the real package (pathname, url, size,
   uploadedAt). Blob "URLs" are https://blob.mock/<pathname>; a
   test's fetch mock serves their content from the same map.

   Test-only: reached through ./blob-hooks.mjs, never in production. */

export const __blobs = new Map(); // pathname -> { content, url, uploadedAt }

export function __reset() {
  __blobs.clear();
}

function toText(body) {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body && typeof body.text === "function") return body.text();
  return String(body ?? "");
}

export async function put(pathname, body, opts = {}) {
  let finalPath = String(pathname);
  if (opts.addRandomSuffix !== false) {
    finalPath = `${finalPath}-${Math.random().toString(36).slice(2, 10)}`;
  } else if (__blobs.has(finalPath) && !opts.allowOverwrite) {
    throw new Error("This blob already exists, use allowOverwrite");
  }
  const content = await toText(body);
  const record = {
    content,
    url: `https://blob.mock/${finalPath}`,
    uploadedAt: new Date()
  };
  __blobs.set(finalPath, record);
  return { url: record.url, pathname: finalPath, size: Buffer.byteLength(content), uploadedAt: record.uploadedAt };
}

export async function list(opts = {}) {
  const prefix = opts.prefix || "";
  const blobs = [...__blobs.entries()]
    .filter(([pathname]) => pathname.startsWith(prefix))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([pathname, r]) => ({
      pathname,
      url: r.url,
      size: Buffer.byteLength(r.content),
      uploadedAt: r.uploadedAt
    }));
  return { blobs, hasMore: false, cursor: undefined };
}

export async function del(url) {
  for (const [pathname, r] of __blobs.entries()) {
    if (r.url === url || pathname === url) __blobs.delete(pathname);
  }
}
