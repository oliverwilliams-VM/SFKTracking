// Returns trend deltas ("1 month ago", "3 months ago") by finding the
// snapshot closest to each target date. Returns an empty/graceful response
// if no Redis store is configured or no history has accumulated yet -
// history only exists from the day this feature was deployed onward, it
// can't be backfilled.

import { Redis } from "@upstash/redis";

const SNAPSHOTS_KEY = "sfk:snapshots";
// "key" is a stable identifier the frontend reads by (label text can change
// without breaking it). "week" also gets a tighter absolute tolerance (see
// below) rather than the default 40%-of-target one - 40% of 7 days is only
// 2.8 days either way, barely different, but being explicit here means it
// won't quietly get looser if the days value ever changes.
const TARGETS_DAYS = [
  { key: "week", label: "1 wk ago", days: 7, toleranceMs: 3 * 24 * 60 * 60 * 1000 },
  { key: "month", label: "1 mo ago", days: 30 },
  { key: "quarter", label: "3 mo ago", days: 90 },
];

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Finds the snapshot whose date is closest to (now - days), preferring the
// nearest older one so "1 month ago" doesn't quietly become "3 weeks ago".
function closestSnapshot(snapshots, days, toleranceMs) {
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
  // Don't match a snapshot more than ~40% outside the target window (or the
  // explicit override) - a 3-day-old snapshot standing in for "1 month ago"
  // would be misleading.
  const tolerance = toleranceMs ?? days * 24 * 60 * 60 * 1000 * 0.4;
  return best && bestDiff <= tolerance ? best : null;
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

    const points = TARGETS_DAYS.map(({ key, label, days, toleranceMs }) => {
      const snap = closestSnapshot(snapshots, days, toleranceMs);
      if (!snap) return null;
      // Carry every field a snapshot might have, not just total/live - the
      // week-on-week tracker needs ledgerUsed/tableForecast/
      // tableOrderNotOrdered/installingSoon too. Older snapshots (recorded
      // before those fields existed) just won't have them - the frontend
      // treats a missing field as "no comparison available" rather than 0.
      return {
        key,
        label,
        date: snap.date,
        total: snap.total,
        live: snap.live,
        ledgerUsed: snap.ledgerUsed || null,
        tableForecast: snap.tableForecast || null,
        tableOrderNotOrdered: snap.tableOrderNotOrdered ?? null,
        installingSoon: snap.installingSoon || null,
      };
    }).filter(Boolean);

    res.status(200).json({ enabled: true, points, snapshotCount: snapshots.length });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error reading history." });
  }
}
