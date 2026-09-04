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

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

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

  const totals = useMemo(() => {
    if (!data) return { total: 0, live: 0 };
    const live = data.items.filter((item) =>
      (item.installPhase || "").toLowerCase().includes(LIVE_KEYWORD)
    ).length;
    return { total: data.total, live };
  }, [data]);

  // Which KPI card is expanded for a by-country breakdown - "__total__" for
  // the Total card, a phase string for a phase card, or null for none.
  const [selectedKpi, setSelectedKpi] = useState(null);

  const selectedBreakdown = useMemo(() => {
    if (!selectedKpi || !byCountry.length) return null;
    if (selectedKpi === "__total__") {
      return {
        title: "Total sites by country",
        rows: byCountry.map((row) => ({ country: row.country, count: row.total })),
      };
    }
    return {
      title: `${splitPhaseLabel(selectedKpi).label} by country`,
      rows: byCountry
        .map((row) => ({ country: row.country, count: row.byPhase[selectedKpi] || 0 }))
        .filter((r) => r.count > 0),
    };
  }, [selectedKpi, byCountry]);

  return (
    <>
      <Head>
        <title>SFK — Part Subway Funded</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="page">
        <header className="topbar">
          <div className="brand">
            <Logo
              candidates={["/Vita Mojo_Primary_Dark.png", "/vita-mojo-logo.svg", "/vita-mojo-logo.png"]}
              alt="Vita Mojo"
            />
            <Logo
              candidates={["/Subway.png", "/subway-logo.svg", "/subway-logo.png"]}
              alt="Subway"
            />
            <span className="brand-name">SFK — Part Subway Funded</span>
          </div>

          <div className="topbar-right">
            <div className="stat-block">
              <p className="stat-label">Total sites</p>
              <p className="stat-value">{data ? data.total : "—"}</p>
            </div>
            <div className="stat-block stat-live">
              <p className="stat-label">Live</p>
              <p className="stat-value">{data ? totals.live : "—"}</p>
            </div>
            <button className="refresh" onClick={load} disabled={loading}>
              {loading ? <BouncingDots /> : "Refresh"}
            </button>
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

              <section className="phase-overview-row">
                <button
                  type="button"
                  className={`phase-card phase-total ${selectedKpi === "__total__" ? "phase-card-active" : ""}`}
                  onClick={() =>
                    setSelectedKpi(selectedKpi === "__total__" ? null : "__total__")
                  }
                >
                  <div className="phase-card-top">
                    <p className="phase-count">{totals.total}</p>
                  </div>
                  <p className="phase-name">Total sites</p>
                </button>

                {phaseOverview.map(([phase, count]) => {
                  const { step, label } = splitPhaseLabel(phase);
                  return (
                    <button
                      type="button"
                      className={`phase-card phase-${phaseTone(phase)} ${selectedKpi === phase ? "phase-card-active" : ""}`}
                      key={phase}
                      onClick={() => setSelectedKpi(selectedKpi === phase ? null : phase)}
                    >
                      <div className="phase-card-top">
                        {step && <span className="phase-step">{step}</span>}
                        <p className="phase-count">{count}</p>
                      </div>
                      <p className="phase-name">{label}</p>
                    </button>
                  );
                })}
              </section>

              {selectedBreakdown && (
                <section className="panel breakdown-panel">
                  <div className="breakdown-header">
                    <h2>{selectedBreakdown.title}</h2>
                    <button className="breakdown-close" onClick={() => setSelectedKpi(null)}>
                      Close
                    </button>
                  </div>
                  <div className="breakdown-rows">
                    {selectedBreakdown.rows.map((row) => (
                      <div className="breakdown-row" key={row.country}>
                        <span>
                          {flagFor(row.country)} {row.country}
                        </span>
                        <strong>{row.count}</strong>
                      </div>
                    ))}
                    {selectedBreakdown.rows.length === 0 && (
                      <p className="breakdown-empty">No sites in this phase.</p>
                    )}
                  </div>
                </section>
              )}

              <section className="country-grid">
                {byCountry.map((row) => (
                  <div className="country-card" key={row.country}>
                    <div className="country-card-header">
                      <span className="country-flag">{flagFor(row.country)}</span>
                      <div>
                        <p className="country-name">{row.country}</p>
                        <p className="country-total">
                          {row.total} <span className="country-live">· {row.live} live</span>
                        </p>
                      </div>
                    </div>
                    <div className="phase-badges">
                      {nonLivePhases
                        .filter((phase) => row.byPhase[phase])
                        .map((phase) => {
                          const { label } = splitPhaseLabel(phase);
                          return (
                            <span
                              key={phase}
                              className={`badge badge-${phaseTone(phase)}`}
                            >
                              {label} <strong>{row.byPhase[phase]}</strong>
                            </span>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </section>

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
