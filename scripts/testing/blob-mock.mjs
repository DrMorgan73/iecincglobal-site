/* In-memory mock of @vercel/blob for the local test suites.
   Implements the subset the api/ functions use — put / list /
   del / get — with the same shapes as the real package
   (pathname, url, size, uploadedAt). Blob "URLs" are
   https://blob.mock/<pathname>; a
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

/* SDK get(): origin read by pathname or URL. The mock's map IS
   the origin, so every get is current; calls are logged in
   __gets so suites can assert how a store read (e.g. that it
   passed useCache:false). Returns the SDK's shape:
   { statusCode: 200, stream, headers, blob } or null. */
export const __gets = [];

export async function get(urlOrPathname, opts = {}) {
  __gets.push({ urlOrPathname: String(urlOrPathname), opts });
  let record = __blobs.get(String(urlOrPathname));
  if (!record) {
    for (const r of __blobs.values()) {
      if (r.url === String(urlOrPathname)) { record = r; break; }
    }
  }
  if (!record) return null;
  const bytes = new TextEncoder().encode(record.content);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  return {
    statusCode: 200,
    stream,
    headers: new Headers({ "content-type": "application/json" }),
    blob: {
      pathname: String(urlOrPathname),
      url: record.url,
      downloadUrl: record.url,
      size: bytes.length,
      uploadedAt: record.uploadedAt
    }
  };
}
