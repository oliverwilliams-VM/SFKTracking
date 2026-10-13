// Daily cron job (see vercel.json) that records a snapshot of totals so the
// dashboard can show trend deltas ("X since 1 month ago", "+X vs last
// week"). Requires a Redis store - see README for the one-time setup
// (Upstash for Redis via the Vercel Marketplace, since Vercel's own KV
// product was sunset).
//
// Secured with CRON_SECRET: Vercel automatically sends this as a Bearer
// token when it invokes a cron job, if the env var is set. Without it, this
// endpoint would be publicly triggerable by anyone who found the URL.

import { Redis } from "@upstash/redis";
import { fetchSfkItems } from "../../lib/monday";
import { fetchTableForecast } from "../../lib/tableForecast";
import { HARDWARE_TYPES } from "../../lib/stock";
import { computeLedgerUsed } from "../../lib/ledgerCalc";

const LIVE_KEYWORD = "live";
const SNAPSHOTS_KEY = "sfk:snapshots";
const MAX_SNAPSHOTS = 400; // ~13 months of daily snapshots

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Condenses fetchTableForecast()'s full result (which also carries full
// per-site detail rows and shape breakdowns, too much to snapshot daily)
// down to just the headline numbers the week-on-week tracker needs -
// mirrors the tableForecastSummary calc in pages/index.js.
function summarizeTableForecast(tf) {
  const metrics = ["stage6Plus", "stage5Below"];
  const out = {};
  metrics.forEach((key) => {
    const funded = {};
    const nonFunded = {};
    const total = {};
    ["UK", "EMEA"].forEach((country) => {
      const f = tf.funded[country][key]?.sites || 0;
      const w = tf.wholeEstate[country][key]?.sites || 0;
      const nf = key === "stage6Plus" ? tf.nonFundedShippingReady?.[country] || 0 : w - f;
      funded[country] = f;
      nonFunded[country] = nf;
      total[country] = key === "stage6Plus" ? f + nf : w;
    });
    funded.Total = funded.UK + funded.EMEA;
    nonFunded.Total = nonFunded.UK + nonFunded.EMEA;
    total.Total = total.UK + total.EMEA;
    out[key] = { funded, nonFunded, total };
  });
  return out;
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
    const ledgerUsed = computeLedgerUsed(items, HARDWARE_TYPES);

    // Table Forecast depends on separate Monday boards (FZE Readiness
    // forms) too - fetched independently so a hiccup there doesn't stop the
    // core total/live/ledger snapshot from being recorded.
    let tableForecast = null;
    let tableOrderNotOrdered = null;
    let installingSoon = null;
    try {
      const tf = await fetchTableForecast();
      tableForecast = summarizeTableForecast(tf);
      tableOrderNotOrdered = (tf.stage8To10Rows || []).filter((r) => !r.tableOrdered).length;
      installingSoon = tf.installingSoon || null;
    } catch {
      // Leave these null - history.js skips fields that are missing on a
      // given snapshot rather than showing a misleading 0.
    }

    const snapshot = {
      date: new Date().toISOString(),
      total,
      live,
      ledgerUsed,
      tableForecast,
      tableOrderNotOrdered,
      installingSoon,
    };

    await redis.lpush(SNAPSHOTS_KEY, JSON.stringify(snapshot));
    await redis.ltrim(SNAPSHOTS_KEY, 0, MAX_SNAPSHOTS - 1);

    res.status(200).json({ ok: true, snapshot });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error taking snapshot." });
  }
}
