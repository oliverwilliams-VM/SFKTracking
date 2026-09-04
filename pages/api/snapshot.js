// Daily cron job (see vercel.json) that records a snapshot of totals so the
// dashboard can show trend deltas ("X since 1 month ago"). Requires a Redis
// store - see README for the one-time setup (Upstash for Redis via the
// Vercel Marketplace, since Vercel's own KV product was sunset).
//
// Secured with CRON_SECRET: Vercel automatically sends this as a Bearer
// token when it invokes a cron job, if the env var is set. Without it, this
// endpoint would be publicly triggerable by anyone who found the URL.

import { Redis } from "@upstash/redis";
import { fetchSfkItems } from "../../lib/monday";

const LIVE_KEYWORD = "live";
const SNAPSHOTS_KEY = "sfk:snapshots";
const MAX_SNAPSHOTS = 400; // ~13 months of daily snapshots

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const redis = getRedis();
  if (!redis) {
    return res.status(500).json({
      error:
        "No Redis store configured. Install 'Upstash for Redis' from the Vercel Marketplace (see README) to enable trend history.",
    });
  }

  try {
    const { items } = await fetchSfkItems();
    const total = items.length;
    const live = items.filter((item) =>
      (item.installPhase || "").toLowerCase().includes(LIVE_KEYWORD)
    ).length;

    const snapshot = { date: new Date().toISOString(), total, live };

    await redis.lpush(SNAPSHOTS_KEY, JSON.stringify(snapshot));
    await redis.ltrim(SNAPSHOTS_KEY, 0, MAX_SNAPSHOTS - 1);

    res.status(200).json({ ok: true, snapshot });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error taking snapshot." });
  }
}
