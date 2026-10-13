// Stock data for the SW Funded Stock Ledger — the hardcoded Opening Stock
// baseline plus the hardware-type list. "Used" and "Accounted For" are
// computed client-side in pages/index.js from the Sign Up data
// /api/board-data already fetches (that's already filtered to the SFK
// Funded population), so there's nothing else to fetch here. See
// lib/stock.js for the Opening Stock figures.

import { fetchStockOnHand, HARDWARE_TYPES } from "../../lib/stock";

export default async function handler(req, res) {
  try {
    const onHand = await fetchStockOnHand().catch((err) => ({
      configured: true,
      rows: [],
      error: err.message,
    }));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      hardwareTypes: HARDWARE_TYPES,
      onHand,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error fetching stock data." });
  }
}
