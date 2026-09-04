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

function BouncingDots() {
  return (
    <span className="dots" aria-label="Loading">
      <span></span>
      <span></span>
      <span></span>
    </span>
  );
}

function Logo({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="logo" onError={() => setFailed(true)} />;
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

  // Overall counts per phase, across every country - the top KPI row.
  const phaseOverview = useMemo(() => {
    if (!data) return [];
    const counts = {};
    data.items.forEach((item) => {
      const v = item.installPhase || "Not set";
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
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
            <Logo src="/vita-mojo-logo.svg" alt="Vita Mojo" />
            <Logo src="/subway-logo.svg" alt="Subway" />
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
                {phaseOverview.map(([phase, count]) => (
                  <div className={`phase-card phase-${phaseTone(phase)}`} key={phase}>
                    <p className="phase-count">{count}</p>
                    <p className="phase-name">{phase}</p>
                  </div>
                ))}
              </section>

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
                        .map((phase) => (
                          <span
                            key={phase}
                            className={`badge badge-${phaseTone(phase)}`}
                          >
                            {phase} <strong>{row.byPhase[phase]}</strong>
                          </span>
                        ))}
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
