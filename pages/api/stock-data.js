// Stock management data — on-hand counts from the Hardware Stock board
// (once it exists; see lib/stock.js) plus required counts computed live
// from the Sign Up + 5 country boards. See lib/stock.js for the full logic
// and the Monday board column IDs, all verified rather than guessed.

import { fetchStockOnHand, fetchRequiredStock, HARDWARE_TYPES, COUNTRIES } from "../../lib/stock";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  try {
    // Run independently so a problem on one side (e.g. the stock board
    // not being set up yet) doesn't take down the other.
    const [onHand, required] = await Promise.all([
      fetchStockOnHand().catch((err) => ({ configured: true, rows: [], error: err.message })),
      fetchRequiredStock().catch((err) => ({ error: err.message })),
    ]);

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      hardwareTypes: HARDWARE_TYPES,
      countries: COUNTRIES,
      onHand,
      required,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error fetching stock data." });
  }
}
