// Returns trend deltas ("1 month ago", "3 months ago") by finding the
// snapshot closest to each target date. Returns an empty/graceful response
// if no Redis store is configured or no history has accumulated yet -
// history only exists from the day this feature was deployed onward, it
// can't be backfilled.

import { Redis } from "@upstash/redis";

const SNAPSHOTS_KEY = "sfk:snapshots";
const TARGETS_DAYS = [
  { label: "1 mo ago", days: 30 },
  { label: "3 mo ago", days: 90 },
];

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Finds the snapshot whose date is closest to (now - days), preferring the
// nearest older one so "1 month ago" doesn't quietly become "3 weeks ago".
function closestSnapshot(snapshots, days) {
  const targetTime = Date.now() - days * 24 * 60 * 60 * 1000;
  let best = null;
  let bestDiff = Infinity;
  for (const s of snapshots) {
    const diff = Math.abs(new Date(s.date).getTime() - targetTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  // Don't match a snapshot more than ~40% outside the target window - a
  // 3-day-old snapshot standing in for "1 month ago" would be misleading.
  const toleranceMs = days * 24 * 60 * 60 * 1000 * 0.4;
  return best && bestDiff <= toleranceMs ? best : null;
}

export default async function handler(req, res) {
  const redis = getRedis();
  if (!redis) {
    return res.status(200).json({ enabled: false, points: [] });
  }

  try {
    const raw = await redis.lrange(SNAPSHOTS_KEY, 0, -1);
    const snapshots = raw
      .map((s) => (typeof s === "string" ? JSON.parse(s) : s))
      .filter(Boolean);

    if (snapshots.length === 0) {
      return res.status(200).json({ enabled: true, points: [], building: true });
    }

    const points = TARGETS_DAYS.map(({ label, days }) => {
      const snap = closestSnapshot(snapshots, days);
      return snap ? { label, total: snap.total, live: snap.live, date: snap.date } : null;
    }).filter(Boolean);

    res.status(200).json({ enabled: true, points, snapshotCount: snapshots.length });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error reading history." });
  }
}
