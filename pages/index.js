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
  if (/(risk|blocked|delay|issue|hold|awaiting)/.test(v)) return "warn";
  if (v === "" || v === "not set") return "empty";
  return "neutral";
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

  // Every distinct install phase seen, most common first.
  const allPhases = useMemo(() => {
    if (!data) return [];
    const counts = {};
    data.items.forEach((item) => {
      const v = item.installPhase || "Not set";
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([phase]) => phase);
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

  const totals = useMemo(() => {
    if (!data) return { total: 0, live: 0 };
    const live = data.items.filter((item) =>
      (item.installPhase || "").toLowerCase().includes(LIVE_KEYWORD)
    ).length;
    return { total: data.total, live };
  }, [data]);

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
            <span className="brand-mark">SFK</span>
            <span className="brand-name">Part Subway Funded Dashboard</span>
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
              {loading ? "Refreshing…" : "Refresh"}
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

          {loading && !data && <div className="panel">Loading sites…</div>}

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

              <section className="country-row">
                {byCountry.map((row) => (
                  <div className="country-card" key={row.country}>
                    <p className="country-flag">{flagFor(row.country)}</p>
                    <p className="country-name">{row.country}</p>
                    <p className="country-total">{row.total}</p>
                    <p className="country-live">{row.live} live</p>
                  </div>
                ))}
              </section>

              <section className="panel pivot-panel">
                <h2>Install phase by country</h2>
                <div className="table-scroll">
                  <table className="pivot-table">
                    <thead>
                      <tr>
                        <th>Country</th>
                        <th className="num-col total-col">Total</th>
                        <th className="num-col live-col">Live</th>
                        {nonLivePhases.map((phase) => (
                          <th key={phase} className={`num-col phase-${phaseTone(phase)}`}>
                            {phase}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byCountry.map((row) => (
                        <tr key={row.country}>
                          <td className="site-name">
                            {flagFor(row.country)} {row.country}
                          </td>
                          <td className="num-col total-col">{row.total}</td>
                          <td className="num-col live-col">{row.live}</td>
                          {nonLivePhases.map((phase) => (
                            <td key={phase} className="num-col">
                              {row.byPhase[phase] || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="site-name">All countries</td>
                        <td className="num-col total-col">{totals.total}</td>
                        <td className="num-col live-col">{totals.live}</td>
                        {nonLivePhases.map((phase) => (
                          <td key={phase} className="num-col">
                            {byCountry.reduce(
                              (sum, row) => sum + (row.byPhase[phase] || 0),
                              0
                            )}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              {data && (
                <p className="fetched-footer">
                  Updated{" "}
                  {new Date(data.fetchedAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}
