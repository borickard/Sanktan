import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const code = (req.query.c ?? "").toUpperCase();
  if (!code) return res.status(400).json({ error: "missing code" });

  const state = await redis.get(code);
  if (!state) return res.status(404).json({ error: "not found or expired" });

  res.json({ state });
}
