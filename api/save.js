import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
const genCode = () =>
  Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join("");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { state } = req.body ?? {};
  if (!state || typeof state !== "string" || state.length > 8192) {
    return res.status(400).json({ error: "invalid" });
  }

  let code;
  for (let i = 0; i < 10; i++) {
    code = genCode();
    if (!(await redis.exists(code))) break;
  }

  await redis.set(code, state, { ex: 60 * 60 * 24 * 30 }); // 30-day TTL
  res.json({ code });
}
