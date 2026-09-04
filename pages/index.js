import { useEffect, useMemo, useState } from "react";
import Head from "next/head";

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
  if (/(done|complete|live|ready|installed|go live)/.test(v)) tone = "good";
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
        const json = await r.json();
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

  const statusBreakdown = useMemo(() => {
    if (!data || !statusCol) return [];
    const counts = {};
    data.items.forEach((item) => {
      const v = item.columns[statusCol] || "Not set";
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data, statusCol]);

  const countryBreakdown = useMemo(() => {
    if (!data || !countryCol) return [];
    const counts = {};
    data.items.forEach((item) => {
      const v = item.columns[countryCol] || "Not set";
      counts[v] = (counts[v] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [data, countryCol]);

  // Columns to show in the table: name + up to 5 other informative columns,
  // skipping the SFK Format column since every row shares the same value.
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
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
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
                Live from {data ? `“${data.boardName}”` : "Sign Up → Ready to Go"}
                {" "}on Monday.com
              </p>
            </div>
            <div className="masthead-actions">
              {data && (
                <p className="fetched">
                  Updated {new Date(data.fetchedAt).toLocaleString("en-GB", {
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

          {loading && !data && <div className="panel">Loading sites…</div>}

          {data && (
            <>
              <section className="kpi-row">
                <div className="kpi-card kpi-primary">
                  <p className="kpi-value">{data.total}</p>
                  <p className="kpi-label">Part Subway Funded sites</p>
                </div>

                {statusBreakdown.length > 0 && (
                  <div className="kpi-card">
                    <p className="kpi-label">By {statusCol}</p>
                    <div className="breakdown">
                      {statusBreakdown.map(([label, count]) => (
                        <div key={label} className="breakdown-row">
                          <StatusChip value={label} />
                          <span className="breakdown-count">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {countryBreakdown.length > 0 && (
                  <div className="kpi-card">
                    <p className="kpi-label">By {countryCol}</p>
                    <div className="breakdown">
                      {countryBreakdown.map(([label, count]) => (
                        <div key={label} className="breakdown-row">
                          <span>{label}</span>
                          <span className="breakdown-count">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="panel table-panel">
                <div className="table-toolbar">
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
