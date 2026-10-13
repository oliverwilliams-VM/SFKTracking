// Stock data for the SW Funded Stock Ledger.
//
// The ledger only covers the bulk hardware Subway itself purchased (SFK
// Format = Part Subway Funded / MFG Funded Site) — Retrofit and Remodel
// sites buy their own, site by site, so they're out of scope entirely.
// "Used" (already Live) and "Accounted For" (Install Phase stage 6+) are
// computed client-side in pages/index.js from the Sign Up data
// /api/board-data already fetches for that population — nothing Monday-side
// is needed for those. All that's needed from here is the hardware-type
// list and the Opening Stock baseline below.

// Real hardware taxonomy, verified against Oli's opening-stock sheet. Kiosk
// is split into two non-interchangeable variants: "ELO5 - Kiosk" is
// current, '22" Flyte' is the legacy variant used by the early-adopter
// sites (EG on the Move, MFG) — see isLegacyKioskPartner in pages/index.js.
// Order drives the ledger's card layout (4 per row) - grouped so related
// pairs sit next to each other: Kiosk+Stand+legacy Kiosk+ADA on row one,
// KDS+Mounts+ORS+Mount on row two.
export const HARDWARE_TYPES = [
  "ELO5 - Kiosk",
  "SFK Stand",
  '22" Flyte',
  "ADA Unit & Mount",
  "ELO4 - KDS",
  "KDS Mounts",
  "ORS",
  "ORS Mount",
];

// Opening Stock — the one-off bulk purchase for the SW-Funded programme.
// This never gets restocked (once it's gone, it's gone), so rather than
// stand up a Monday board just to hold one static snapshot, it's hardcoded
// here. Source: Oli's opening-stock reconciliation sheet (Oct 2026), pooled
// UK vs EMEA per his confirmation. ADA Unit & Mount was given as two rows
// ("- UK" and "- EMEA" variant) — confirmed as one hardware type, the two
// rows summed per bucket. If the real position changes, just edit the
// numbers below and redeploy — no Monday board, no env var.
const OPENING_STOCK = {
  UK: {
    "ELO4 - KDS": 340,
    "ELO5 - Kiosk": 333,
    '22" Flyte': 225,
    "KDS Mounts": 340,
    ORS: 170,
    "ORS Mount": 170,
    "SFK Stand": 333,
    "ADA Unit & Mount": 0,
  },
  EMEA: {
    "ELO4 - KDS": 130,
    "ELO5 - Kiosk": 200,
    '22" Flyte': 24,
    "KDS Mounts": 130,
    ORS: 65,
    "ORS Mount": 65,
    "SFK Stand": 200,
    "ADA Unit & Mount": 65,
  },
};

// Stock on hand = the hardcoded OPENING_STOCK baseline above. No Monday
// board, no API call — kept async and returning the same
// { configured, boardName, rows } shape the dashboard already expects.
export async function fetchStockOnHand() {
  const rows = [];
  Object.entries(OPENING_STOCK).forEach(([country, byType]) => {
    Object.entries(byType).forEach(([hardwareType, qtyInStock]) => {
      rows.push({
        id: `${country}-${hardwareType}`,
        country,
        hardwareType,
        qtyInStock,
        lastUpdated: null,
      });
    });
  });
  return { configured: true, boardName: "Opening Stock (hardcoded)", rows };
}
