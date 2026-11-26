// Bisect probe (2026-11-26): minimal handler to isolate the deploy failure.
export default async function handler(req, res) {
  res.status(503).json({ ok: false, error: "probe" });
}
