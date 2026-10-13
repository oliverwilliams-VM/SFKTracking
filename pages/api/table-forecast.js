// Table Forecast - how many tables (by shape) are still needed, for the
// SFK-funded population, the whole not-yet-live estate, and the
// difference between them (the FZE self-funded Retrofit/Remodel sites).
// See lib/tableForecast.js for the full logic.

import { fetchTableForecast } from "../../lib/tableForecast";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  try {
    const result = await fetchTableForecast();
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ ...result, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error fetching the table forecast." });
  }
}
