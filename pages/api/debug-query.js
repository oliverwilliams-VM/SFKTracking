// Debug query endpoint — lets Claude (or anyone with the token) filter and
// inspect real Sign Up board data directly, instead of guessing or working
// off small samples. Exposes raw business data, so it's gated by its own
// secret (DEBUG_QUERY_TOKEN) rather than the dashboard's shared password,
// and does nothing at all if that env var isn't set.
//
// GET /api/debug-query?token=...&installPhase=live&sfkFormat=part+subway&corpPartner=mfg&minStage=6&limit=25
// GET /api/debug-query?token=...&itemId=69317   (look up one item by its Monday item id,
//                                                 includes rawKioskQtyFormula/rawKioskQtyMirror
//                                                 - the unparsed column_values, for debugging)
// All filters are optional and case-insensitive substring matches, except:
//   - itemId                 exact match on the Monday item id
//   - live=true|false        exact match on the isLive flag
//   - minStage / maxStage    numeric, inclusive, against the leading "N."
//   - limit                  default 25, max 200
// Response: { totalMatching, returned, items: [...] }

import { fetchAllSignUpItemsForDebug } from "../../lib/debugQuery";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  const requiredToken = process.env.DEBUG_QUERY_TOKEN;
  if (!requiredToken) {
    return res.status(404).json({ error: "Not found." });
  }
  if (req.query.token !== requiredToken) {
    return res.status(401).json({ error: "Invalid or missing token." });
  }

  try {
    const items = await fetchAllSignUpItemsForDebug();

    const { itemId, installPhase, sfkFormat, corpPartner, kioskUnitType, country, live, minStage, maxStage } =
      req.query;
    const contains = (value, needle) => (value || "").toLowerCase().includes(needle.toLowerCase());

    const matching = items.filter((item) => {
      if (itemId && String(item.id) !== String(itemId)) return false;
      if (installPhase && !contains(item.installPhase, installPhase)) return false;
      if (sfkFormat && !contains(item.sfkFormat, sfkFormat)) return false;
      if (corpPartner && !contains(item.corpPartner, corpPartner)) return false;
      if (kioskUnitType && !contains(item.kioskUnitType, kioskUnitType)) return false;
      if (country && !contains(item.country, country)) return false;
      if (live === "true" && !item.isLive) return false;
      if (live === "false" && item.isLive) return false;
      if (minStage && (item.stage === null || item.stage < parseInt(minStage, 10))) return false;
      if (maxStage && (item.stage === null || item.stage > parseInt(maxStage, 10))) return false;
      return true;
    });

    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 200);
    res.status(200).json({
      totalMatching: matching.length,
      returned: Math.min(limit, matching.length),
      items: matching.slice(0, limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error." });
  }
}
