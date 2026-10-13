import { useEffect, useMemo, useState } from "react";
import Head from "next/head";

// Matches on the Install phase column to decide what counts as "live". Edit
// this if the actual wording on the board differs (e.g. "Go-Live", "Trading").
const LIVE_KEYWORD = "live";

const FLAGS = {
  uk: "🇬🇧",
  gb: "🇬🇧",
  "united kingdom": "🇬🇧",
  ie: "🇮🇪",
  ireland: "🇮🇪",
  nl: "🇳🇱",
  netherlands: "🇳🇱",
  de: "🇩🇪",
  germany: "🇩🇪",
  fi: "🇫🇮",
  finland: "🇫🇮",
};

function flagFor(country) {
  const key = (country || "").trim().toLowerCase();
  return FLAGS[key] || "🏳️";
}

function phaseTone(phase) {
  const v = (phase || "").toLowerCase();
  if (v.includes(LIVE_KEYWORD)) return "good";
  if (v.includes("cancelled") || v.includes("canceled")) return "bad";
  if (/(risk|blocked|delay|issue|hold|awaiting)/.test(v)) return "warn";
  if (v === "" || v === "not set") return "empty";
  return "neutral";
}

// Sorts phases as a pipeline (1, 2, 3... then Live, then Cancelled last) so
// the KPI row reads as a funnel left-to-right instead of by raw frequency.
function phaseSortKey(phase) {
  const v = (phase || "").toLowerCase();
  const numbered = phase.match(/^(\d+)\./);
  if (numbered) return parseInt(numbered[1], 10);
  if (v.includes(LIVE_KEYWORD)) return 900;
  if (v.includes("cancelled") || v.includes("canceled")) return 999;
  return 500;
}

function sortByPipeline(phases) {
  return [...phases].sort((a, b) => phaseSortKey(a) - phaseSortKey(b));
}

// Splits a phase label like "4. HW Placement Approval" into its step number
// and the readable name, so the number can render as a small badge.
function splitPhaseLabel(phase) {
  const match = (phase || "").match(/^(\d+)\.\s*(.*)$/);
  if (match) return { step: match[1], label: match[2] };
  return { step: null, label: phase };
}

// --- SW Funded Stock Ledger helpers -------------------------------------
// Which kiosk variant a site needs. "Kiosk Unit Type" is the real, direct
// per-site field (confirmed via a live schema check) - "22" Flyte Kiosks"
// is the legacy variant, everything else (Small Format Kiosk / 27" BAU
// Kiosks / Pending SFK BAU) is current. Corp Partner (EG on the Move/MFG)
// is only a fallback guess for the rare case Kiosk Unit Type is blank.
function isLegacyKioskPartner(corpPartner) {
  const t = (corpPartner || "").trim().toLowerCase();
  return t === "eg on the move" || t === "mfg";
}
function isLegacyKioskType(kioskUnitType, corpPartner) {
  const t = (kioskUnitType || "").trim().toLowerCase();
  if (t) return t.includes("22") && t.includes("flyte");
  return isLegacyKioskPartner(corpPartner);
}

// Pulls the leading "6." off an Install Phase label like "6. Contract/
// Invoice Sent" - same pattern phaseSortKey/splitPhaseLabel already use.
function stageNumber(phase) {
  const match = (phase || "").match(/^(\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

// Exclusive install-date buckets for the Table Order Check filter tabs - a
// site with no date, an overdue date, or one past 6 weeks out all land in
// "All Others" rather than a 4th numbered bucket.
const INSTALL_BUCKETS = ["Install 2 Weeks Out", "Install 4 Weeks Out", "Install 6 Weeks Out", "All Others"];
function installBucket(installDateStr) {
  if (!installDateStr) return "All Others";
  const d = new Date(installDateStr);
  if (Number.isNaN(d.getTime())) return "All Others";
  const diffDays = Math.floor((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return "All Others";
  if (diffDays <= 14) return "Install 2 Weeks Out";
  if (diffDays <= 28) return "Install 4 Weeks Out";
  if (diffDays <= 42) return "Install 6 Weeks Out";
  return "All Others";
}

// Fixed per-site requirement for everything except the two Kiosk variants
// and SFK Stand (all three pulled from kioskQty per site - a Stand is 1 per
// kiosk, same count as the kiosk itself, not a flat 1 per store). ADA Unit
// & Mount is 1 per store, every site, confirmed by Oli.
const LEDGER_PER_SITE_DEFAULTS = {
  "ELO4 - KDS": 2,
  "KDS Mounts": 2,
  ORS: 1,
  "ORS Mount": 1,
  "ADA Unit & Mount": 1,
};

// Simple CSS-bar charts - no charting library needed for two shapes this
// straightforward, and it keeps styling consistent with the rest of the app.
function PipelineChart({ entries, selected, onSelect }) {
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return (
    <div className="chart pipeline-chart">
      {entries.map(([phase, count]) => (
        <button
          type="button"
          className={`pipeline-chart-row ${selected === phase ? "pipeline-chart-row-active" : ""}`}
          key={phase}
          onClick={() => onSelect(selected === phase ? null : phase)}
        >
          <div className="pipeline-chart-top">
            <span className="pipeline-chart-label">{splitPhaseLabel(phase).label}</span>
            <span className="pipeline-chart-count">{count}</span>
          </div>
          <div className="pipeline-chart-track">
            <div
              className={`pipeline-chart-fill fill-${phaseTone(phase)}`}
              style={{ width: `${Math.max(3, (count / max) * 100)}%` }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

// Same bar-chart shape as PipelineChart above, reused for by-country
// breakdowns so the "click a KPI, see the split" panel is visual rather
// than a plain list of numbers. Not clickable (no onSelect) since there's
// nothing further to drill into from a country row.
function CountryBarChart({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="chart pipeline-chart">
      {rows.map((row) => (
        <div className="pipeline-chart-row" key={row.country}>
          <div className="pipeline-chart-top">
            <span className="pipeline-chart-label">
              {flagFor(row.country)} {row.country}
            </span>
            <span className="pipeline-chart-count">{row.count}</span>
          </div>
          <div className="pipeline-chart-track">
            <div
              className="pipeline-chart-fill fill-neutral"
              style={{ width: `${Math.max(3, (row.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BreakdownPanel({ breakdown, hasReasonColumn, onClose }) {
  if (!breakdown) return null;
  return (
    <section className="panel breakdown-panel">
      <div className="breakdown-header">
        <h2>{breakdown.title}</h2>
        <button className="breakdown-close" onClick={onClose}>
          Close
        </button>
      </div>

      {breakdown.type === "by-country" && (
        <>
          <CountryBarChart rows={breakdown.rows} />
          {breakdown.rows.length === 0 && (
            <p className="breakdown-empty">No sites in this phase.</p>
          )}
        </>
      )}

      {breakdown.type === "site-list" && (
        <>
          {breakdown.showReason && !hasReasonColumn && (
            <p className="breakdown-note">
              Couldn't find a reason/notes column on this board, so
              only store and country are shown below. If the board
              has one under a different name, update{" "}
              <code>REASON_TITLE_MATCH</code> in{" "}
              <code>lib/monday.js</code>.
            </p>
          )}
          <div className="cancelled-list">
            {breakdown.items.map((item) => (
              <div className="cancelled-row" key={item.id}>
                <div className="cancelled-row-top">
                  <span className="cancelled-name">{item.name}</span>
                  <span className="cancelled-country">
                    {flagFor(item.country)} {item.country || "—"}
                  </span>
                </div>
                {breakdown.showReason && (
                  <p className="cancelled-reason">
                    {item.reason || "No reason recorded"}
                  </p>
                )}
              </div>
            ))}
            {breakdown.items.length === 0 && (
              <p className="breakdown-empty">No sites in this phase.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const DONUT_COLORS = ["#8b5cf6", "#2dd4bf", "#fbbf24", "#f87171", "#60a5fa", "#f472b6", "#34d399", "#c084fc"];

function DonutChart({ rows }) {
  const total = rows.reduce((sum, r) => sum + r.total, 0) || 1;
  const size = 220;
  const strokeWidth = 34;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let offsetSoFar = 0;
  const segments = rows.map((row, i) => {
    const fraction = row.total / total;
    const length = fraction * circumference;
    const segment = {
      ...row,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
      length,
      offset: offsetSoFar,
      pct: Math.round(fraction * 100),
    };
    offsetSoFar += length;
    return segment;
  });

  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="donut-svg">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--panel-alt)"
            strokeWidth={strokeWidth}
          />
          {segments.map((seg) => (
            <circle
              key={seg.country}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.length} ${circumference - seg.length}`}
              strokeDashoffset={-seg.offset}
            />
          ))}
        </g>
        <text x="50%" y="47%" textAnchor="middle" className="donut-center-value">
          {total}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="donut-center-label">
          sites
        </text>
      </svg>

      <div className="donut-legend">
        {segments.map((seg) => (
          <div className="donut-legend-row" key={seg.country}>
            <span className="donut-swatch" style={{ background: seg.color }} />
            <span className="donut-legend-flag">{flagFor(seg.country)}</span>
            <span className="donut-legend-name">{seg.country}</span>
            <span className="donut-legend-count">
              {seg.total} <span className="donut-legend-pct">({seg.pct}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function downloadCsv(filename, rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = rows.map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function BouncingDots() {
  return (
    <span className="dots" aria-label="Loading">
      <span></span>
      <span></span>
      <span></span>
    </span>
  );
}

function Logo({ candidates, alt }) {
  const [index, setIndex] = useState(0);
  if (index >= candidates.length) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={encodeURI(candidates[index])}
      alt={alt}
      className="logo"
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

// A site is flagged as needing attention if it hasn't been touched (any
// field changed) in this many days and isn't already Live or Cancelled.
const STALE_DAYS = 14;

function daysSince(isoDate) {
  if (!isoDate) return null;
  const diffMs = Date.now() - new Date(isoDate).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

const AUTO_REFRESH_KEY = "sfk-auto-refresh";
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState(null);
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [stock, setStock] = useState(null);
  const [stockError, setStockError] = useState(null);
  const [tableForecast, setTableForecast] = useState(null);
  const [tableForecastError, setTableForecastError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch("/api/board-data")
      .then(async (r) => {
        let json;
        try {
          json = await r.json();
        } catch {
          throw new Error(
            r.status === 504
              ? "The request timed out fetching the board. Try again — it should be faster now that we only pull the columns we need."
              : `Unexpected response (status ${r.status}).`
          );
        }
        if (!r.ok) throw new Error(json.error || "Failed to load");
        return json;
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetch("/api/history")
      .then((r) => r.json())
      .then(setHistory)
      .catch(() => setHistory(null));
    fetch("/api/stock-data")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "Failed to load stock data");
        return json;
      })
      .then(setStock)
      .catch((e) => setStockError(e.message));
    fetch("/api/table-forecast")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "Failed to load the table forecast");
        return json;
      })
      .then(setTableForecast)
      .catch((e) => setTableForecastError(e.message));
  }, []);

  // Auto-refresh: remember the toggle across visits, and only run the timer
  // while it's actually on.
  useEffect(() => {
    const saved = window.localStorage.getItem(AUTO_REFRESH_KEY);
    if (saved === "1") setAutoRefresh(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(AUTO_REFRESH_KEY, autoRefresh ? "1" : "0");
    if (!autoRefresh) return;
    const id = setInterval(load, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  // Every distinct install phase seen, ordered as a pipeline (1, 2, 3...
  // Live, Cancelled) rather than by frequency.
  const allPhases = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    data.items.forEach((item) => seen.add(item.installPhase || "Not set"));
    return sortByPipeline([...seen]);
  }, [data]);

  const nonLivePhases = useMemo(
    () => allPhases.filter((p) => !p.toLowerCase().includes(LIVE_KEYWORD)),
    [allPhases]
  );

  // Country -> { total, live, byPhase: { phase: count } }
  const byCountry = useMemo(() => {
    if (!data) return [];
    const table = {};
    data.items.forEach((item) => {
      const country = item.country || "Not set";
      const phase = item.installPhase || "Not set";
      if (!table[country]) table[country] = { total: 0, live: 0, byPhase: {} };
      table[country].total += 1;
      if (phase.toLowerCase().includes(LIVE_KEYWORD)) table[country].live += 1;
      table[country].byPhase[phase] = (table[country].byPhase[phase] || 0) + 1;
    });
    return Object.entries(table)
      .map(([country, stats]) => ({ country, ...stats }))
      .sort((a, b) => b.total - a.total);
  }, [data]);

  // Overall counts per phase, across every country - the top KPI row.
  const phaseOverview = useMemo(() => {
    if (!data) return [];
    const counts = {};
    data.items.forEach((item) => {
      const v = item.installPhase || "Not set";
      counts[v] = (counts[v] || 0) + 1;
    });
    return sortByPipeline(Object.keys(counts)).map((phase) => [phase, counts[phase]]);
  }, [data]);

  // Live and Installing lead the KPI row as headline figures; everything
  // else (the rest of the pipeline, plus Cancelled) sits below, wrapping
  // across lines rather than a single scrolling row.
  const liveEntry = useMemo(
    () => phaseOverview.find(([phase]) => phase.toLowerCase().includes(LIVE_KEYWORD)),
    [phaseOverview]
  );
  const installingEntry = useMemo(
    () => phaseOverview.find(([phase]) => splitPhaseLabel(phase).label.toLowerCase() === "installing"),
    [phaseOverview]
  );

  const totals = useMemo(() => {
    if (!data) return { total: 0, live: 0 };
    const live = data.items.filter((item) =>
      (item.installPhase || "").toLowerCase().includes(LIVE_KEYWORD)
    ).length;
    return { total: data.total, live };
  }, [data]);

  // Sites that haven't been touched in a while and aren't already done
  // (Live) or dead (Cancelled) - these are the ones worth someone chasing.
  const staleItems = useMemo(() => {
    if (!data) return [];
    return data.items
      .filter((item) => {
        const tone = phaseTone(item.installPhase);
        if (tone === "good" || tone === "bad") return false;
        const days = daysSince(item.updatedAt);
        return days !== null && days >= STALE_DAYS;
      })
      .map((item) => ({ ...item, daysSince: daysSince(item.updatedAt) }))
      .sort((a, b) => b.daysSince - a.daysSince);
  }, [data]);


  // SW Funded Stock Ledger — a separate, narrower view for the bulk
  // hardware Subway itself bought (data.items is already filtered to that
  // population - SFK Format = Part Subway Funded / MFG Funded Site - by
  // the API). Retrofit/Remodel sites buy their own hardware site by site,
  // so they're out of scope here even though they're in the panel above.
  // Pooled UK vs EMEA, not per-country, same convention as Opening Stock.
  //
  // Balance = Opening Stock − Used. "Used" = hardware already committed:
  // sites at Install Phase stage 6+ (contract/invoice sent onward),
  // including everything already Live - one combined figure rather than
  // two separate columns, since both represent hardware that's already
  // spoken for. Kiosk splits into the current and legacy variant via the
  // Kiosk Unit Type / Corp Partner fields (isLegacyKioskType).
  const swFundedLedger = useMemo(() => {
    if (!data || !stock?.hardwareTypes) return null;

    const blank = () => Object.fromEntries(stock.hardwareTypes.map((t) => [t, 0]));
    const opening = { UK: blank(), EMEA: blank(), Total: blank() };
    const used = { UK: blank(), EMEA: blank(), Total: blank() };

    (stock.onHand?.rows || []).forEach((row) => {
      const bucket = row.country === "UK" ? "UK" : row.country === "EMEA" ? "EMEA" : null;
      if (!bucket || !(row.hardwareType in opening[bucket])) return;
      opening[bucket][row.hardwareType] += row.qtyInStock;
      opening.Total[row.hardwareType] += row.qtyInStock;
    });

    data.items.forEach((item) => {
      const countryNorm = (item.country || "").trim().toLowerCase();
      const bucket = countryNorm === "uk" || countryNorm.includes("united kingdom") ? "UK" : "EMEA";
      const kioskType = isLegacyKioskType(item.kioskUnitType, item.corpPartner) ? '22" Flyte' : "ELO5 - Kiosk";
      const live = (item.installPhase || "").toLowerCase().includes(LIVE_KEYWORD);
      const stage = stageNumber(item.installPhase);
      // Stage 6+ (contract/invoice sent onward) or already Live - hardware
      // committed either way, so it counts as Used regardless of which.
      const isUsed = live || (stage !== null && stage >= 6);
      if (!isUsed) return;

      const kioskQty = item.kioskQty || 0;
      used[bucket][kioskType] += kioskQty;
      used.Total[kioskType] += kioskQty;
      // SFK Stand is 1 per kiosk, but only for the current ELO5 - Kiosk -
      // the legacy 22" Flyte came with its own stand, not this SKU (Opening
      // Stock confirms this: SFK Stand's opening figures match ELO5 - Kiosk
      // exactly, 333/200, not the 22" Flyte figures).
      if (kioskType === "ELO5 - Kiosk") {
        used[bucket]["SFK Stand"] += kioskQty;
        used.Total["SFK Stand"] += kioskQty;
      }
      Object.entries(LEDGER_PER_SITE_DEFAULTS).forEach(([type, qty]) => {
        // ADA Unit & Mount is an EMEA-only requirement ("every store across
        // EMEA has to have 1 unit") - UK opening stock is 0 to match, so UK
        // sites must not be debited for it or the balance goes negative.
        if (type === "ADA Unit & Mount" && bucket === "UK") return;
        used[bucket][type] += qty;
        used.Total[type] += qty;
      });
    });

    const rows = stock.hardwareTypes.map((type) => {
      const buckets = ["UK", "EMEA", "Total"].map((bucket) => {
        const o = opening[bucket][type];
        const u = used[bucket][type];
        return { bucket, opening: o, used: u, balance: o - u };
      });
      return { type, buckets };
    });

    return { rows };
  }, [data, stock]);

  // Per-site detail behind the ledger above - exported as a CSV rather than
  // shown on screen (it's one row per SFK site, too much for the page), so
  // Oli can check the raw inputs (install phase as read, Corp Partner,
  // kiosk qty, which bucket it landed in) against what he knows on the
  // ground, rather than trusting the rolled-up totals blind.
  const ledgerDetailRows = useMemo(() => {
    if (!data) return [];
    return data.items.map((item) => {
      const countryNorm = (item.country || "").trim().toLowerCase();
      const bucket = countryNorm === "uk" || countryNorm.includes("united kingdom") ? "UK" : "EMEA";
      const kioskType = isLegacyKioskType(item.kioskUnitType, item.corpPartner) ? '22" Flyte' : "ELO5 - Kiosk";
      const live = (item.installPhase || "").toLowerCase().includes(LIVE_KEYWORD);
      const stage = stageNumber(item.installPhase);
      const isUsed = live || (stage !== null && stage >= 6);
      return {
        name: item.name,
        country: item.country || "",
        bucket,
        installPhase: item.installPhase || "",
        corpPartner: item.corpPartner || "",
        kioskUnitType: item.kioskUnitType || "",
        kioskType,
        kioskQty: item.kioskQty || 0,
        kioskQtySource: item.kioskQtySource || "none",
        classification: isUsed ? (live ? "Used (Live)" : "Used (Stage 6+)") : "Not yet (Stage <6)",
      };
    });
  }, [data]);

  // Table Forecast — two headline numbers (Needed Stage 6+, Needed Stage 5
  // and below), each split UK/EMEA/Total and by scope (Funded / Whole
  // Estate / Non-Funded, Non-Funded as the difference). Live sites are out
  // of scope entirely - their table need is already met, so irrelevant here.
  const TABLE_METRICS = [
    { key: "stage6Plus", label: "Needed — Stage 6+ (active pipeline)" },
    { key: "stage5Below", label: "Needed — Stage 5 and below" },
  ];
  const tableForecastSummary = useMemo(() => {
    if (!tableForecast) return null;
    return TABLE_METRICS.map(({ key, label }) => {
      const countryRows = ["UK", "EMEA"].map((country) => {
        const funded = tableForecast.funded[country][key]?.sites || 0;
        const wholeEstate = tableForecast.wholeEstate[country][key]?.sites || 0;
        // Non-Funded's Stage 6+ figure is stricter than a plain diff - only
        // non-funded sites at stage 6+ with an H&K Shipping Date populated.
        // Stage 5- keeps the plain Whole Estate minus Funded diff.
        const nonFunded =
          key === "stage6Plus" ? tableForecast.nonFundedShippingReady?.[country] || 0 : wholeEstate - funded;
        return { country, funded, wholeEstate, nonFunded };
      });
      const total = {
        country: "Total",
        funded: countryRows.reduce((s, r) => s + r.funded, 0),
        wholeEstate: countryRows.reduce((s, r) => s + r.wholeEstate, 0),
        nonFunded: countryRows.reduce((s, r) => s + r.nonFunded, 0),
      };

      // Table shape breakdown for stock forecasting - Whole Estate (the
      // actual physical need, funded or not) by UK/EMEA/Total.
      const tableTypes = tableForecast.tableTypes || [];
      const shapeRows = ["UK", "EMEA"].map((country) => {
        const byType = tableForecast.wholeEstate[country][key]?.byType || {};
        return { country, counts: tableTypes.map((t) => byType[t] || 0) };
      });
      const shapeTotal = {
        country: "Total",
        counts: tableTypes.map((_, i) => shapeRows.reduce((s, r) => s + r.counts[i], 0)),
      };

      return { key, label, rows: [...countryRows, total], tableTypes, shapeRows: [...shapeRows, shapeTotal] };
    });
  }, [tableForecast]);

  // Stage 8/9/10 table-order check - the ones that haven't ordered yet are
  // the actionable callout, sorted to the top.
  const stage8To10Summary = useMemo(() => {
    if (!tableForecast?.stage8To10Rows) return null;
    const rows = [...tableForecast.stage8To10Rows]
      .map((r) => ({ ...r, installBucket: installBucket(r.installDate) }))
      .sort((a, b) => Number(a.tableOrdered) - Number(b.tableOrdered));
    const notOrdered = rows.filter((r) => !r.tableOrdered);
    const bucketCounts = Object.fromEntries(
      INSTALL_BUCKETS.map((b) => [b, notOrdered.filter((r) => r.installBucket === b).length])
    );
    return { rows, notOrdered, orderedCount: rows.length - notOrdered.length, bucketCounts };
  }, [tableForecast]);
  const [notOrderedBucketFilter, setNotOrderedBucketFilter] = useState(null);
  const filteredNotOrdered = useMemo(() => {
    if (!stage8To10Summary) return [];
    return notOrderedBucketFilter
      ? stage8To10Summary.notOrdered.filter((r) => r.installBucket === notOrderedBucketFilter)
      : stage8To10Summary.notOrdered;
  }, [stage8To10Summary, notOrderedBucketFilter]);

  const searchResults = useMemo(() => {
    if (!data || !search.trim()) return [];
    const q = search.trim().toLowerCase();
    return data.items.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 8);
  }, [data, search]);

  const trendFor = (kind) => {
    if (!history?.enabled || !history.points?.length) return null;
    return history.points
      .map((p) => ({ label: p.label, value: p[kind] }))
      .filter((p) => typeof p.value === "number");
  };

  // Which KPI card is expanded for a by-country breakdown - "__total__" for
  // the Total card, a phase string for a phase card, or null for none.
  const [selectedKpi, setSelectedKpi] = useState(null);
  // When set, scopes the phase breakdown below to just this country's own
  // sites \u2014 set when a phase is clicked from within a specific country's
  // card, cleared when clicked from the aggregate Pipeline overview or the
  // headline cards.
  const [selectedCountry, setSelectedCountry] = useState(null);

  const selectedBreakdown = useMemo(() => {
    if (!selectedKpi || !data) return null;

    if (selectedKpi === "__total__") {
      return {
        type: "by-country",
        title: "Total sites by country",
        rows: byCountry.map((row) => ({ country: row.country, count: row.total })),
      };
    }

    // Every other phase (not just Cancelled) now shows the actual site
    // list rather than just a country count \u2014 and if a specific country's
    // card triggered this, the list is scoped to just that country.
    const items = data.items.filter(
      (item) =>
        item.installPhase === selectedKpi &&
        (!selectedCountry || item.country === selectedCountry)
    );
    const { label } = splitPhaseLabel(selectedKpi);
    const showReason = phaseTone(selectedKpi) === "bad";
    return {
      type: "site-list",
      title: selectedCountry
        ? `${label} \u2014 ${selectedCountry} (${items.length})`
        : `${label} \u2014 all sites (${items.length})`,
      items,
      showReason,
    };
  }, [selectedKpi, selectedCountry, byCountry, data]);

  return (
    <>
      <Head>
        <title>Funded SFK Install Programme</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="page">
        <header className="topbar">
          <div className="topbar-inner">
          <div className="brand">
            <Logo
              candidates={["/Vita Mojo_Primary_Dark.png", "/vita-mojo-logo.svg", "/vita-mojo-logo.png"]}
              alt="Vita Mojo"
            />
            <Logo
              candidates={["/Subway.png", "/subway-logo.svg", "/subway-logo.png"]}
              alt="Subway"
            />
            <span className="brand-name">Funded SFK Install Programme</span>
          </div>

          <div className="topbar-right">
            <div className="search-box">
              <input
                type="text"
                placeholder="Find a site…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {searchResults.length > 0 && (
                <div className="search-results">
                  {searchResults.map((item) => (
                    <div className="search-result" key={item.id}>
                      <span className="search-result-name">{item.name}</span>
                      <span className="search-result-meta">
                        {flagFor(item.country)} {item.country || "—"} ·{" "}
                        {splitPhaseLabel(item.installPhase).label || "Not set"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              className={`auto-refresh-toggle ${autoRefresh ? "auto-refresh-on" : ""}`}
              onClick={() => setAutoRefresh((v) => !v)}
              title="Auto-refresh every 5 minutes"
            >
              <span className="auto-refresh-dot" /> Auto-refresh
            </button>

            <button className="refresh" onClick={load} disabled={loading}>
              {loading ? <BouncingDots /> : "Refresh"}
            </button>
          </div>
          </div>
        </header>

        <main className="content">
          {error && (
            <div className="panel error-panel">
              <strong>Couldn't load the board.</strong>
              <p>{error}</p>
            </div>
          )}

          {loading && !data && (
            <div className="panel loading-panel">
              <BouncingDots />
              <p>Loading sites…</p>
            </div>
          )}

          {data && (
            <>
              {!data.hasInstallPhaseColumn && (
                <div className="panel warn-panel">
                  Couldn't find a column titled "Install phase" on this board
                  — showing totals only. Check the exact column name and
                  update <code>INSTALL_PHASE_TITLE_MATCH</code> in
                  <code> pages/api/board-data.js</code> if it's worded
                  differently.
                </div>
              )}

              <section className="kpi-headline-row">
                <button
                  type="button"
                  className={`phase-card phase-card-headline phase-total ${selectedKpi === "__total__" ? "phase-card-active" : ""}`}
                  onClick={() => {
                    setSelectedKpi(selectedKpi === "__total__" ? null : "__total__");
                    setSelectedCountry(null);
                  }}
                >
                  <p className="phase-count">{totals.total}</p>
                  <p className="phase-name">Total available sites</p>
                  {trendFor("total") && (
                    <div className="trend-row">
                      {trendFor("total").map((t) => (
                        <span className="trend-chip" key={t.label}>
                          {t.value} <span className="trend-chip-label">{t.label}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </button>

                {liveEntry && (
                  <button
                    type="button"
                    className={`phase-card phase-card-headline phase-good ${selectedKpi === liveEntry[0] ? "phase-card-active" : ""}`}
                    onClick={() => {
                      setSelectedKpi(selectedKpi === liveEntry[0] ? null : liveEntry[0]);
                      setSelectedCountry(null);
                    }}
                  >
                    <p className="phase-count">{liveEntry[1]}</p>
                    <p className="phase-name">Live</p>
                    {trendFor("live") && (
                      <div className="trend-row">
                        {trendFor("live").map((t) => (
                          <span className="trend-chip" key={t.label}>
                            {t.value} <span className="trend-chip-label">{t.label}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                )}

                {installingEntry && (
                  <button
                    type="button"
                    className={`phase-card phase-card-headline phase-${phaseTone(installingEntry[0])} ${selectedKpi === installingEntry[0] ? "phase-card-active" : ""}`}
                    onClick={() => {
                      setSelectedKpi(selectedKpi === installingEntry[0] ? null : installingEntry[0]);
                      setSelectedCountry(null);
                    }}
                  >
                    <p className="phase-count">{installingEntry[1]}</p>
                    <p className="phase-name">Installing</p>
                  </button>
                )}
              </section>

              {!selectedCountry && (
                <BreakdownPanel
                  breakdown={selectedBreakdown}
                  hasReasonColumn={data.hasReasonColumn}
                  onClose={() => { setSelectedKpi(null); setSelectedCountry(null); }}
                />
              )}

              {history?.building && (
                <p className="history-building-note">
                  Trend history started tracking today — comparisons will appear once a few weeks have passed.
                </p>
              )}

              <section className="charts-row">
                <div className="panel chart-panel">
                  <h2>Pipeline overview</h2>
                  <PipelineChart
                    entries={phaseOverview}
                    selected={!selectedCountry ? selectedKpi : null}
                    onSelect={(phase) => {
                      setSelectedKpi(phase);
                      setSelectedCountry(null);
                    }}
                  />
                </div>
                <div className="panel chart-panel">
                  <h2>Sites by country</h2>
                  <DonutChart rows={byCountry} />
                </div>
              </section>

              <section className="country-grid">
                {byCountry.map((row) => (
                  <div className="country-card" key={row.country}>
                    <div className="country-card-header">
                      <span className="country-flag">{flagFor(row.country)}</span>
                      <div>
                        <p className="country-name">{row.country}</p>
                        <p className="country-total">
                          {row.total}{" "}
                          <span className="country-live">
                            · {row.live} live
                            {row.total > 0 && ` (${Math.round((row.live / row.total) * 100)}%)`}
                          </span>
                        </p>
                      </div>
                    </div>
                    <PipelineChart
                      entries={nonLivePhases
                        .filter((phase) => row.byPhase[phase])
                        .map((phase) => [phase, row.byPhase[phase]])}
                      selected={selectedCountry === row.country ? selectedKpi : null}
                      onSelect={(phase) => {
                        setSelectedKpi(phase);
                        setSelectedCountry(phase ? row.country : null);
                      }}
                    />
                    {selectedCountry === row.country && (
                      <BreakdownPanel
                        breakdown={selectedBreakdown}
                        hasReasonColumn={data.hasReasonColumn}
                        onClose={() => { setSelectedKpi(null); setSelectedCountry(null); }}
                      />
                    )}
                  </div>
                ))}
              </section>

              <section className="panel ledger-panel">
                <div className="stock-header">
                  <h2>SW Funded Stock Ledger</h2>
                  <button
                    type="button"
                    className="stale-download"
                    onClick={() =>
                      downloadCsv(
                        `sw-funded-ledger-detail-${new Date().toISOString().slice(0, 10)}.csv`,
                        [
                          [
                            "Site",
                            "Country",
                            "Bucket",
                            "Install Phase (as read)",
                            "Corp Partner",
                            "Kiosk Unit Type (as read)",
                            "Kiosk Type",
                            "Kiosk Qty",
                            "Kiosk Qty Source",
                            "Classification",
                          ],
                          ...ledgerDetailRows.map((r) => [
                            r.name,
                            r.country,
                            r.bucket,
                            r.installPhase,
                            r.corpPartner,
                            r.kioskUnitType,
                            r.kioskType,
                            r.kioskQty,
                            r.kioskQtySource,
                            r.classification,
                          ]),
                        ]
                      )
                    }
                  >
                    Download site-level detail (CSV)
                  </button>
                </div>
                <p className="stock-footnote">This is for sites at Stage 6 or above, including Live.</p>
                {stockError ? (
                  <p className="error-panel">{stockError}</p>
                ) : !stock || !data ? (
                  <p className="loading-panel">Loading…</p>
                ) : (
                  <div className="forecast-grid ledger-grid">
                    {swFundedLedger?.rows.map((row) => {
                      const totalBucket = row.buckets.find((b) => b.bucket === "Total");
                      return (
                        <div
                          className={`forecast-card ledger-card${totalBucket.balance < 0 ? " ledger-card-bad" : ""}`}
                          key={row.type}
                        >
                          <div className="ledger-card-head">
                            <h3>{row.type}</h3>
                            <span
                              className={`ledger-card-balance ${totalBucket.balance < 0 ? "stock-cell-bad" : "stock-cell-good"}`}
                            >
                              {totalBucket.balance}
                            </span>
                          </div>
                          <div className="forecast-card-table">
                            <div className="forecast-card-row forecast-card-head">
                              <span></span>
                              <span>Opening</span>
                              <span>Used</span>
                              <span>Balance</span>
                            </div>
                            {row.buckets.map((b) => (
                              <div
                                className={`forecast-card-row${b.bucket === "Total" ? " total" : ""}`}
                                key={b.bucket}
                              >
                                <span className="forecast-card-country">
                                  {b.bucket === "UK" ? "🇬🇧 UK" : b.bucket === "EMEA" ? "🌍 EMEA" : "Total"}
                                </span>
                                <span className="forecast-card-value">{b.opening}</span>
                                <span className="forecast-card-value">{b.used}</span>
                                <span
                                  className={`forecast-card-value ${b.balance < 0 ? "stock-cell-bad" : "stock-cell-good"}`}
                                >
                                  {b.balance}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="panel ledger-panel">
                <div className="stock-header">
                  <h2>Table Forecast</h2>
                  <button
                    type="button"
                    className="stale-download"
                    onClick={() =>
                      downloadCsv(
                        `table-forecast-detail-${new Date().toISOString().slice(0, 10)}.csv`,
                        [
                          ["Site", "Country", "Install Phase (as read)", "Bucket", "Funded", "Table Shape"],
                          ...(tableForecast?.detailRows || []).map((r) => [
                            r.name,
                            r.country,
                            r.installPhase,
                            r.metric === "stage6Plus" ? "Needed (Stage 6+)" : "Needed (Stage 5 and below)",
                            r.funded ? "Yes" : "No",
                            r.tableType,
                          ]),
                        ]
                      )
                    }
                  >
                    Download site-level detail (CSV)
                  </button>
                </div>
                <p className="stock-footnote">
                  Flat 1 table per site (no per-site quantity field exists on Monday). Live sites are
                  out of scope — their need is already met. Funded = the SW Funded Stock Ledger
                  population above. Whole Estate = every in-scope, not-yet-live site (Interrupt,
                  Disrupt, Small Format, Retrofit, Remodel/NRO), funded or not. Non-Funded is the
                  difference — the FZE self-purchased Retrofit/Remodel sites, who buy their own
                  tables. Table shape breakdown below each card is Whole Estate (the full physical
                  need, for stock forecasting) - per-site detail with Funded/Non-Funded split is in
                  the CSV download.
                </p>
                {tableForecastError ? (
                  <p className="error-panel">{tableForecastError}</p>
                ) : !tableForecastSummary ? (
                  <p className="loading-panel">Loading…</p>
                ) : (
                  <div className="forecast-grid">
                    {tableForecastSummary.map((metric) => (
                      <div className="forecast-card" key={metric.key}>
                        <h3>{metric.label}</h3>
                        <div className="forecast-card-table">
                          <div className="forecast-card-row forecast-card-head">
                            <span></span>
                            <span>Funded</span>
                            <span>Non Funded</span>
                            <span>Total</span>
                          </div>
                          {metric.rows.map((r) => (
                            <div
                              className={`forecast-card-row${r.country === "Total" ? " total" : ""}`}
                              key={r.country}
                            >
                              <span className="forecast-card-country">
                                {r.country === "UK" ? "🇬🇧 UK" : r.country === "EMEA" ? "🌍 EMEA" : "Total"}
                              </span>
                              <span className="forecast-card-value">{r.funded}</span>
                              <span className="forecast-card-value">{r.nonFunded}</span>
                              <span className="forecast-card-value">{r.wholeEstate}</span>
                            </div>
                          ))}
                        </div>
                        <div className="forecast-card-subhead">By Table Shape (Whole Estate)</div>
                        <div className="forecast-card-table">
                          <div className="forecast-card-row forecast-card-head shape-breakdown-row">
                            <span></span>
                            {metric.tableTypes.map((t) => (
                              <span key={t}>{t}</span>
                            ))}
                          </div>
                          {metric.shapeRows.map((r) => (
                            <div
                              className={`forecast-card-row shape-breakdown-row${r.country === "Total" ? " total" : ""}`}
                              key={r.country}
                            >
                              <span className="forecast-card-country">
                                {r.country === "UK" ? "🇬🇧 UK" : r.country === "EMEA" ? "🌍 EMEA" : "Total"}
                              </span>
                              {r.counts.map((c, i) => (
                                <span className="forecast-card-value" key={metric.tableTypes[i]}>
                                  {c}
                                </span>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel ledger-panel">
                <div className="stock-header">
                  <h2>Installing Soon</h2>
                  <button
                    type="button"
                    className="stale-download"
                    onClick={() =>
                      downloadCsv(
                        `installing-soon-${new Date().toISOString().slice(0, 10)}.csv`,
                        [
                          ["Site", "Country", "Install Date", "Install Phase (as read)"],
                          ...(tableForecast?.installingSoonRows || []).map((r) => [
                            r.name,
                            r.country,
                            r.installDate,
                            r.installPhase,
                          ]),
                        ]
                      )
                    }
                  >
                    Download site-level detail (CSV)
                  </button>
                </div>
                <p className="stock-footnote">
                  From the confirmed Install Date (pulled from the country Install boards). Next 4
                  weeks includes the next 2 - both counted from today, not yet-live sites only.
                </p>
                {tableForecastError ? (
                  <p className="error-panel">{tableForecastError}</p>
                ) : !tableForecast ? (
                  <p className="loading-panel">Loading…</p>
                ) : (
                  <div className="forecast-grid installing-soon-grid">
                    {[
                      { key: "next2Weeks", label: "Next 2 Weeks" },
                      { key: "next4Weeks", label: "Next 4 Weeks" },
                    ].map(({ key, label }) => (
                      <div className="forecast-card" key={key}>
                        <h3>{label}</h3>
                        <div className="forecast-card-table">
                          <div className="forecast-card-row forecast-card-head installing-soon-row">
                            <span></span>
                            <span>Sites</span>
                          </div>
                          {["UK", "EMEA", "Total"].map((country) => (
                            <div
                              className={`forecast-card-row installing-soon-row${country === "Total" ? " total" : ""}`}
                              key={country}
                            >
                              <span className="forecast-card-country">
                                {country === "UK" ? "🇬🇧 UK" : country === "EMEA" ? "🌍 EMEA" : "Total"}
                              </span>
                              <span className="forecast-card-value">
                                {tableForecast.installingSoon[key][country]}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {stage8To10Summary && stage8To10Summary.rows.length > 0 && (
                <section className="panel stale-panel">
                  <div className="stale-header">
                    <h2>
                      Table Order Check — Stage 8/9/10{" "}
                      <span className={`stale-count${stage8To10Summary.notOrdered.length > 0 ? " stale-count-bad" : ""}`}>
                        {stage8To10Summary.notOrdered.length} of {stage8To10Summary.rows.length} haven't ordered
                      </span>
                    </h2>
                    <button
                      type="button"
                      className="stale-download"
                      onClick={() =>
                        downloadCsv(
                          `table-order-check-stage-8-10-${new Date().toISOString().slice(0, 10)}.csv`,
                          [
                            ["Site", "Country", "Stage", "Install Phase (as read)", "Funded", "Table Ordered Status", "Source"],
                            ...stage8To10Summary.rows.map((r) => [
                              r.name,
                              r.country,
                              r.stage,
                              r.installPhase,
                              r.funded ? "Yes" : "No",
                              r.tableOrderedText,
                              r.tableOrderedSource,
                            ]),
                          ]
                        )
                      }
                    >
                      Download CSV
                    </button>
                  </div>
                  <p className="stock-footnote">
                    Funded sites: H&K Tables Ordered. Non-Funded (FZE) sites: the FZE Readiness form
                    (UK/IE and Germany only - NL falls back to H&K Tables Ordered, which H&K doesn't
                    populate for self-purchase sites, so NL non-funded sites with no response show as
                    not ordered until a Readiness match is added for them).
                  </p>
                  {stage8To10Summary.notOrdered.length === 0 ? (
                    <p className="loading-panel">All Stage 8/9/10 sites have ordered their table.</p>
                  ) : (
                    <>
                      <div className="bucket-tabs">
                        <button
                          type="button"
                          className={`bucket-tab${notOrderedBucketFilter === null ? " active" : ""}`}
                          onClick={() => setNotOrderedBucketFilter(null)}
                        >
                          All <span className="bucket-tab-count">{stage8To10Summary.notOrdered.length}</span>
                        </button>
                        {INSTALL_BUCKETS.map((b) => (
                          <button
                            type="button"
                            key={b}
                            className={`bucket-tab${notOrderedBucketFilter === b ? " active" : ""}`}
                            onClick={() => setNotOrderedBucketFilter(b)}
                          >
                            {b} <span className="bucket-tab-count">{stage8To10Summary.bucketCounts[b]}</span>
                          </button>
                        ))}
                      </div>
                      {filteredNotOrdered.length === 0 ? (
                        <p className="loading-panel">No sites in this group.</p>
                      ) : (
                        <div className="stale-list">
                          {filteredNotOrdered.slice(0, 12).map((r) => (
                            <div className="stale-row" key={r.name}>
                              <span className="stale-name">{r.name}</span>
                              <span className="stale-meta">
                                {flagFor(r.country)} {r.country || "—"} · Stage {r.stage} ·{" "}
                                {r.installDate ? `Install ${r.installDate}` : "No install date"}
                              </span>
                              <span className="stale-days stale-days-bad">{r.tableOrderedText}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {filteredNotOrdered.length > 12 && (
                        <p className="stale-more">
                          + {filteredNotOrdered.length - 12} more — download the CSV for the full list
                        </p>
                      )}
                    </>
                  )}
                </section>
              )}

              {staleItems.length > 0 && (
                <section className="panel stale-panel">
                  <div className="stale-header">
                    <h2>
                      Needs attention{" "}
                      <span className="stale-count">
                        {staleItems.length} site{staleItems.length === 1 ? "" : "s"} untouched {STALE_DAYS}+ days
                      </span>
                    </h2>
                    <button
                      type="button"
                      className="stale-download"
                      onClick={() =>
                        downloadCsv(
                          `sfk-needs-attention-${new Date().toISOString().slice(0, 10)}.csv`,
                          [
                            ["Site", "Country", "Install phase", "Days untouched"],
                            ...staleItems.map((item) => [
                              item.name,
                              item.country || "Not set",
                              splitPhaseLabel(item.installPhase).label || "Not set",
                              item.daysSince,
                            ]),
                          ]
                        )
                      }
                    >
                      Download CSV
                    </button>
                  </div>
                  <div className="stale-list">
                    {staleItems.slice(0, 12).map((item) => (
                      <div className="stale-row" key={item.id}>
                        <span className="stale-name">{item.name}</span>
                        <span className="stale-meta">
                          {flagFor(item.country)} {item.country || "—"} ·{" "}
                          {splitPhaseLabel(item.installPhase).label || "Not set"}
                        </span>
                        <span className="stale-days">{item.daysSince}d</span>
                      </div>
                    ))}
                  </div>
                  {staleItems.length > 12 && (
                    <p className="stale-more">
                      + {staleItems.length - 12} more — download the CSV for the full list
                    </p>
                  )}
                </section>
              )}

              <p className="fetched-footer">
                Updated{" "}
                {new Date(data.fetchedAt).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </>
          )}
        </main>
      </div>
    </>
  );
}
