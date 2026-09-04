import { useEffect, useMemo, useState } from "react";
import Head from "next/head";

// Matches on the status column to decide what counts as "live". Edit this if
// the actual wording on the board differs (e.g. "Go-Live", "Trading").
const LIVE_KEYWORD = "live";

function findColumn(columns, keywords) {
  const titles = Object.keys(columns || {});
  const match = titles.find((t) =>
    keywords.some((k) => t.toLowerCase().includes(k))
  );
  return match || null;
}

function StatusChip({ value }) {
  const v = (value || "").toLowerCase();
  let tone = "neutral";
  if (v.includes(LIVE_KEYWORD) || /(done|complete|ready|installed)/.test(v))
    tone = "good";
  else if (/(risk|blocked|delay|issue|hold)/.test(v)) tone = "warn";
  else if (v === "") tone = "empty";
  return <span className={`chip chip-${tone}`}>{value || "—"}</span>;
}

export default function Home() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

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
              ? "The request timed out fetching the board — it may be too large for a single request. Try again, or ask Claude to add server-side filtering."
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

  const statusCol = useMemo(
    () => (data ? findColumn(data.items[0]?.columns, ["status"]) : null),
    [data]
  );
  const countryCol = useMemo(
    () =>
      data ? findColumn(data.items[0]?.columns, ["country", "market"]) : null,
    [data]
  );

  // Every distinct status value seen across the board, ordered by overall
  // frequency (most common first) so the pivot table's columns read sensibly.
  const allStatuses = useMemo(() => {
    if (!data || !statusCol) return [];
    const counts = {};
    data.items.forEach((item) => {
      const v = item.columns[statusCol] || "Not set";
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([status]) => status);
  }, [data, statusCol]);

  // Country -> { total, live, byStatus: { status: count } }
  const byCountry = useMemo(() => {
    if (!data || !countryCol) return [];
    const table = {};
    data.items.forEach((item) => {
      const country = item.columns[countryCol] || "Not set";
      const status = statusCol ? item.columns[statusCol] || "Not set" : "Not set";
      if (!table[country]) table[country] = { total: 0, live: 0, byStatus: {} };
      table[country].total += 1;
      if (status.toLowerCase().includes(LIVE_KEYWORD)) table[country].live += 1;
      table[country].byStatus[status] = (table[country].byStatus[status] || 0) + 1;
    });
    return Object.entries(table)
      .map(([country, stats]) => ({ country, ...stats }))
      .sort((a, b) => b.total - a.total);
  }, [data, countryCol, statusCol]);

  const totals = useMemo(() => {
    if (!data) return { total: 0, live: 0 };
    const live = data.items.filter((item) =>
      statusCol
        ? (item.columns[statusCol] || "").toLowerCase().includes(LIVE_KEYWORD)
        : false
    ).length;
    return { total: data.total, live };
  }, [data, statusCol]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.items;
    return data.items.filter((item) => {
      const inName = item.name.toLowerCase().includes(q);
      const inCols = Object.values(item.columns).some((v) =>
        (v || "").toLowerCase().includes(q)
      );
      return inName || inCols;
    });
  }, [data, query]);

  const tableColumns = useMemo(() => {
    if (!data || data.items.length === 0) return [];
    const allTitles = Object.keys(data.items[0].columns).filter(
      (t) => t.toLowerCase() !== "sfk format"
    );
    return allTitles.slice(0, 6);
  }, [data]);

  return (
    <>
      <Head>
        <title>SFK — Part Subway Funded</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div className="page">
        <header className="masthead">
          <div className="masthead-inner">
            <div>
              <p className="eyebrow-plain">Small Format Kiosk</p>
              <h1>Part Subway Funded</h1>
              <p className="subtitle">
                Live from {data ? `“${data.boardName}”` : "Sign Up → Ready to Go"} on Monday.com
              </p>
            </div>
            <div className="masthead-actions">
              {data && (
                <p className="fetched">
                  Updated{" "}
                  {new Date(data.fetchedAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
              <button className="refresh" onClick={load} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
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
            <div className="panel">
              Loading sites… this board covers every country, so it can take
              up to a minute the first time.
            </div>
          )}

          {data && (
            <>
              <section className="kpi-row">
                <div className="kpi-card kpi-primary">
                  <p className="kpi-value">{totals.total}</p>
                  <p className="kpi-label">Total stores in programme</p>
                </div>
                <div className="kpi-card kpi-live">
                  <p className="kpi-value">{totals.live}</p>
                  <p className="kpi-label">
                    Live{totals.total ? ` · ${Math.round((totals.live / totals.total) * 100)}%` : ""}
                  </p>
                </div>
                <div className="kpi-card">
                  <p className="kpi-value">{byCountry.length || "—"}</p>
                  <p className="kpi-label">Countries in programme</p>
                </div>
              </section>

              {byCountry.length > 0 && (
                <section className="panel pivot-panel">
                  <h2>By country</h2>
                  <div className="table-scroll">
                    <table className="pivot-table">
                      <thead>
                        <tr>
                          <th>Country</th>
                          <th className="num-col total-col">Total</th>
                          <th className="num-col live-col">Live</th>
                          {allStatuses
                            .filter((s) => !s.toLowerCase().includes(LIVE_KEYWORD))
                            .map((status) => (
                              <th key={status} className="num-col">
                                {status}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {byCountry.map((row) => (
                          <tr key={row.country}>
                            <td className="site-name">{row.country}</td>
                            <td className="num-col total-col">{row.total}</td>
                            <td className="num-col live-col">{row.live}</td>
                            {allStatuses
                              .filter((s) => !s.toLowerCase().includes(LIVE_KEYWORD))
                              .map((status) => (
                                <td key={status} className="num-col">
                                  {row.byStatus[status] || "—"}
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
                          {allStatuses
                            .filter((s) => !s.toLowerCase().includes(LIVE_KEYWORD))
                            .map((status) => (
                              <td key={status} className="num-col">
                                {byCountry.reduce(
                                  (sum, row) => sum + (row.byStatus[status] || 0),
                                  0
                                )}
                              </td>
                            ))}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>
              )}

              <section className="panel table-panel">
                <div className="table-toolbar">
                  <h2 className="table-heading">All sites</h2>
                  <input
                    type="text"
                    placeholder="Search sites…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <span className="result-count">
                    {filteredItems.length} of {data.total}
                  </span>
                </div>

                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Site</th>
                        {tableColumns.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item) => (
                        <tr key={item.id}>
                          <td className="site-name">{item.name}</td>
                          {tableColumns.map((col) =>
                            col === statusCol ? (
                              <td key={col}>
                                <StatusChip value={item.columns[col]} />
                              </td>
                            ) : (
                              <td key={col}>{item.columns[col] || "—"}</td>
                            )
                          )}
                        </tr>
                      ))}
                      {filteredItems.length === 0 && (
                        <tr>
                          <td colSpan={tableColumns.length + 1} className="empty-row">
                            No sites match “{query}”.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </>
  );
}
