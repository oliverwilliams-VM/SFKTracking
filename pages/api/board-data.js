// Live dashboard data - see lib/monday.js for the actual Monday.com fetch
// logic, which is shared with the daily history snapshot (api/snapshot.js).

import { fetchSfkItems } from "../../lib/monday";

// Hobby plan's max without Fluid Compute. Only fetching the 3 columns we
// actually use (instead of every column on the board) is the bigger lever on
// speed - this is just headroom in case the board is still large.
export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  try {
    const { boardName, items, hasInstallPhaseColumn, hasCountryColumn, hasReasonColumn } = await fetchSfkItems();

    // Cache at the edge for a minute so repeat loads within a session are
    // near-instant; stale-while-revalidate keeps it fresh in the background.
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    res.status(200).json({
      boardName,
      total: items.length,
      items,
      hasInstallPhaseColumn,
      hasCountryColumn,
      hasReasonColumn,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error fetching Monday data." });
  }
}
