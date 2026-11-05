/* Node module customization hooks for the local test suites:
   redirects every import of "@vercel/blob" to the in-memory mock in
   ./blob-mock.mjs, so api/demo-activity.js, api/_demo-activity-store.js
   and api/demo-admin.js can run locally with no Blob store and no
   network. Registered via module.register() at the top of a test
   file, before the handler modules are imported. Production never
   sees this — Vercel installs the real package from package.json. */

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@vercel/blob") {
    return {
      url: new URL("./blob-mock.mjs", import.meta.url).href,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}
