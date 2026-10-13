// Shared "SW Funded Stock Ledger - Used" calculation. Originally lived only
// client-side in pages/index.js (the swFundedLedger useMemo); pulled out
// here so the daily snapshot cron (api/snapshot.js) can compute the exact
// same Used figures server-side for the week-on-week tracker, without the
// two copies drifting apart (the stage-range bug earlier this project was
// exactly that kind of drift risk).

const LIVE_KEYWORD = "live";

// Fixed per-site requirement for everything except the two Kiosk variants
// and SFK Stand (all three pulled from kioskQty per site - a Stand is 1 per
// kiosk, same count as the kiosk itself, not a flat 1 per store). ADA Unit
// & Mount is 1 per store, every site, confirmed by Oli.
export const LEDGER_PER_SITE_DEFAULTS = {
  "ELO4 - KDS": 2,
  "KDS Mounts": 2,
  ORS: 1,
  "ORS Mount": 1,
  "ADA Unit & Mount": 1,
};

// Which kiosk variant a site needs. "Kiosk Unit Type" is the real, direct
// per-site field (confirmed via a live schema check) - "22" Flyte Kiosks"
// is the legacy variant, everything else (Small Format Kiosk / 27" BAU
// Kiosks / Pending SFK BAU) is current. Corp Partner (EG on the Move/MFG)
// is only a fallback guess for the rare case Kiosk Unit Type is blank.
export function isLegacyKioskPartner(corpPartner) {
  const t = (corpPartner || "").trim().toLowerCase();
  return t === "eg on the move" || t === "mfg";
}
export function isLegacyKioskType(kioskUnitType, corpPartner) {
  const t = (kioskUnitType || "").trim().toLowerCase();
  if (t) return t.includes("22") && t.includes("flyte");
  return isLegacyKioskPartner(corpPartner);
}

// Pulls the leading "6." off an Install Phase label like "6. Contract/
// Invoice Sent" - same pattern used throughout this project.
export function stageNumber(phase) {
  const match = (phase || "").match(/^(\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

// Computes "Used" per hardware type, per UK/EMEA/Total, from the raw SFK
// items (the same population pages/api/board-data.js returns). Split into
// Live (already installed) and Pipeline (Stage 6-10, committed but not yet
// installed) rather than one blended figure - Oli wants the two visible
// separately, not combined. "used" is kept too (live + pipeline) since
// that's what Balance is computed against. Mirrors swFundedLedger in
// pages/index.js exactly.
export function computeLedgerUsed(items, hardwareTypes) {
  const blank = () => Object.fromEntries(hardwareTypes.map((t) => [t, 0]));
  const live = { UK: blank(), EMEA: blank(), Total: blank() };
  const pipeline = { UK: blank(), EMEA: blank(), Total: blank() };

  (items || []).forEach((item) => {
    const countryNorm = (item.country || "").trim().toLowerCase();
    const bucket = countryNorm === "uk" || countryNorm.includes("united kingdom") ? "UK" : "EMEA";
    const kioskType = isLegacyKioskType(item.kioskUnitType, item.corpPartner) ? '22" Flyte' : "ELO5 - Kiosk";
    const isLive = (item.installPhase || "").toLowerCase().includes(LIVE_KEYWORD);
    const stage = stageNumber(item.installPhase);
    // Stage 6-10 (bounded, not an open-ended "6 and above") - hardware
    // committed but not yet installed. Live and Pipeline are mutually
    // exclusive by construction (Install Phase can't read both at once).
    const isPipeline = !isLive && stage !== null && stage >= 6 && stage <= 10;
    if (!isLive && !isPipeline) return;
    const target = isLive ? live : pipeline;

    const kioskQty = item.kioskQty || 0;
    if (kioskType in target[bucket]) {
      target[bucket][kioskType] += kioskQty;
      target.Total[kioskType] += kioskQty;
    }
    // SFK Stand is 1 per kiosk, but only for the current ELO5 - Kiosk - the
    // legacy 22" Flyte came with its own stand, not this SKU.
    if (kioskType === "ELO5 - Kiosk" && "SFK Stand" in target[bucket]) {
      target[bucket]["SFK Stand"] += kioskQty;
      target.Total["SFK Stand"] += kioskQty;
    }
    Object.entries(LEDGER_PER_SITE_DEFAULTS).forEach(([type, qty]) => {
      if (!(type in target[bucket])) return;
      // ADA Unit & Mount is an EMEA-only requirement - UK opening stock is 0
      // to match, so UK sites must not be debited for it.
      if (type === "ADA Unit & Mount" && bucket === "UK") return;
      target[bucket][type] += qty;
      target.Total[type] += qty;
    });
  });

  const used = { UK: blank(), EMEA: blank(), Total: blank() };
  ["UK", "EMEA", "Total"].forEach((bucket) => {
    hardwareTypes.forEach((type) => {
      used[bucket][type] = live[bucket][type] + pipeline[bucket][type];
    });
  });

  return { live, pipeline, used };
}
