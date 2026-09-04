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
  const remainingPhases = useMemo(
    () => phaseOverview.filter(([phase]) => phase !== liveEntry?.[0] && phase !== installingEntry?.[0]),
    [phaseOverview, liveEntry, installingEntry]
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
                  onClick={() =>
                    setSelectedKpi(selectedKpi === "__total__" ? null : "__total__")
                  }
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
                    onClick={() => setSelectedKpi(selectedKpi === liveEntry[0] ? null : liveEntry[0])}
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
                    onClick={() =>
                      setSelectedKpi(selectedKpi === installingEntry[0] ? null : installingEntry[0])
                    }
                  >
                    <p className="phase-count">{installingEntry[1]}</p>
                    <p className="phase-name">Installing</p>
                  </button>
                )}
              </section>

              <section className="phase-overview-row">
                {remainingPhases.map(([phase, count]) => {
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

              {history?.building && (
                <p className="history-building-note">
                  Trend history started tracking today — comparisons will appear once a few weeks have passed.
                </p>
              )}

              {staleItems.length > 0 && (
                <section className="panel stale-panel">
                  <h2>
                    Needs attention{" "}
                    <span className="stale-count">
                      {staleItems.length} site{staleItems.length === 1 ? "" : "s"} untouched {STALE_DAYS}+ days
                    </span>
                  </h2>
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
                    <p className="stale-more">+ {staleItems.length - 12} more</p>
                  )}
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
                            <button
                              type="button"
                              key={phase}
                              className={`badge badge-${phaseTone(phase)} ${selectedKpi === phase ? "badge-active" : ""}`}
                              onClick={() => setSelectedKpi(selectedKpi === phase ? null : phase)}
                            >
                              {label} <strong>{row.byPhase[phase]}</strong>
                            </button>
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
