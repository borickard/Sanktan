import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const code = (req.query.c ?? "").toUpperCase();
  if (!code) return res.status(400).json({ error: "missing code" });

  const state = await kv.get(code);
  if (!state) return res.status(404).json({ error: "not found or expired" });

  res.json({ state });
}
