// Table Forecast — "how many tables do we still need, where, and how
// urgently" for the Subway EMEA programme. Live sites are out of scope
// entirely (their need is already met) - two headline numbers, per Oli's
// spec:
//   - Needed, Stage 6+: active pipeline, far enough along to be a confident
//     near-term need, not yet live
//   - Needed, Stage 5 and below: earlier pipeline (including non-numbered
//     admin states), not yet live
// Each is split UK vs EMEA, and further by scope:
//   - Funded: the SFK-funded population (same scope as the SW Funded Stock
//     Ledger - SFK Format = Part Subway Funded / MFG Funded Site)
//   - Whole Estate: every in-scope, not-yet-live site, full stop -
//     Interrupt, Disrupt, Small Format, Retrofit, Remodel/NRO, funded or not
//   - Non-Funded (Retrofit/Remodel): Whole Estate minus Funded - the FZE
//     self-purchased population, reported as the difference rather than
//     fetched separately, since Funded is always a subset of Whole Estate
//
// Quantity is flat 1 table per site (confirmed - no per-site quantity field
// exists on Monday for this). The real "Type of Table" column (Rectangle /
// Circular / Long Rectangle) is still tracked per item and exported via CSV
// for anyone who wants that detail, but isn't part of the on-screen summary
// (kept off-screen so the headline numbers stay prominent and readable).
//
// Install Phase is read directly off the Sign Up board's own status column
// (title "Install Phase", column id "status") - confirmed via a live schema
// check that "Live" is a real, exact label there.
//
// Two further call-outs, same in-scope population as above:
//   - stage8To10Rows: sites at Install Phase 8, 9 or 10 (far enough along
//     that the table should already be on order), flagged against "H&K
//     Tables Ordered" so the ones that haven't actually ordered stand out.
//   - installingSoon / installingSoonRows: sites with a confirmed Install
//     Date (the mirror from the country Install boards) in the next 2 or 4
//     weeks - the number to give Subway for "installing soon".
//
// Non-Funded's Stage 6+ figure (nonFundedShippingReady) is deliberately not
// Whole Estate minus Funded like the rest of this panel - Oli wants it
// stricter: only non-funded (FZE self-purchase) sites at stage 6+ that also
// have an H&K Shipping Date populated, a sign the table has genuinely been
// actioned. The Stage 5- card's Non-Funded stays as the plain diff.

const MONDAY_API_URL = "https://api.monday.com/v2";
const PAGE_SIZE = 500;

const SIGNUP_BOARD_ID = "5678025992";
// Verified ids, same ones used elsewhere in this project for this board.
const INSTALL_PHASE_COL = "status";
const COUNTRY_COL = "country";
const LAYOUT_TYPE_COL = "dup__of_layout_type_bau1__1";
const STORE_OPENING_TYPE_COL = "dup__of_store_type5__1";
// "Install Date" - mirror pulling the confirmed date from the country
// Install boards (as opposed to "Requested install Date" or "Planned
// Install Date (Auto)", two other similarly-named columns on this board -
// Oli confirmed this one). "H&K Tables Ordered" - status column, values
// "Ordered/ Not Paid", "Ordered/ Paid", "Not Order". Both confirmed via a
// live schema check (not guessed).
const INSTALL_DATE_COL = "mirror30__1";
const TABLE_ORDERED_COL = "color_mm7z9k2b";
// "H&K Shipping Date:" - date column, confirmed via a live schema check.
const SHIPPING_DATE_COL = "date_mkmkxahk";
// Resolved by title (not hardcoded) since they're newly added to this fetch.
const SFK_FORMAT_TITLE_MATCH = ["sfk format"];
const TABLE_TYPE_TITLE_MATCH = ["type of table"];
const SFK_TARGET_VALUES = ["part subway funded", "mfg funded site"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const TABLE_TYPES = ["Rectangle", "Circular", "Long Rectangle", "Not set"];
export const METRICS = ["stage6Plus", "stage5Below"];
export const COUNTRIES = ["UK", "EMEA"];

function normalize(str) {
  return (str || "").trim().toLowerCase();
}
function normalizeName(n) {
  return (n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function findColumnId(columns, keywords) {
  return columns.find((c) => keywords.some((k) => normalize(c.title).includes(k)))?.id || null;
}

async function mondayQuery(query, variables) {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.MONDAY_API_TOKEN,
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

// Same classification rules used throughout this project (PipelineBoard,
// the old whole-estate Hardware Stock calc) - a site is in scope if it
// matches either axis, counted only once regardless of how many it matches.
function classifyLayout(text) {
  const t = normalize(text);
  if (t === "interrupt") return "interrupt";
  if (t === "disrupt") return "disrupt";
  if (t === "small form factor") return "smallFormat";
  return null;
}
function classifyStoreOpeningType(text) {
  const t = normalize(text);
  if (t.includes("re-model") || t.includes("new restaurant opening")) return "remodelNro";
  if (t.includes("retrofit")) return "retrofit";
  return null;
}

// Live sites are out of scope here too - this is a forward *need* forecast
// (how many tables are still required), and a live site's table need is
// already met, so it's not tracked at all (same treatment as
// cancelled/deinstalled).
function isOutOfScopePhase(phase) {
  const p = normalize(phase);
  return p.includes("cancelled") || p.includes("canceled") || p.includes("deinstall") || p.includes("live");
}

// Pulls the leading "6." off a phase label like "6. Contract/Invoice Sent" -
// same pattern used for the ledger's "stage 6+" check.
function stageNumber(phase) {
  const match = (phase || "").match(/^(\d+)\./);
  return match ? parseInt(match[1], 10) : null;
}

function countryBucket(text) {
  const t = normalize(text);
  return t === "uk" || t.includes("united kingdom") ? "UK" : "EMEA";
}

// "Ordered/ Not Paid" and "Ordered/ Paid" both count as ordered - only
// "Not Order" (or blank) means it isn't.
function isTableOrdered(text) {
  return normalize(text).startsWith("ordered");
}

function parseDateLoose(text) {
  if (!text) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function fetchTableForecast() {
  if (!process.env.MONDAY_API_TOKEN) {
    throw new Error("MONDAY_API_TOKEN is not set.");
  }

  const colData = await mondayQuery(
    `query ($boardId: [ID!]) { boards(ids: $boardId) { columns { id title } } }`,
    { boardId: [SIGNUP_BOARD_ID] }
  );
  const columns = colData.boards?.[0]?.columns || [];
  const sfkColId = findColumnId(columns, SFK_FORMAT_TITLE_MATCH);
  const tableTypeColId = findColumnId(columns, TABLE_TYPE_TITLE_MATCH);

  const colIds = [
    INSTALL_PHASE_COL,
    COUNTRY_COL,
    LAYOUT_TYPE_COL,
    STORE_OPENING_TYPE_COL,
    INSTALL_DATE_COL,
    TABLE_ORDERED_COL,
    SHIPPING_DATE_COL,
    sfkColId,
    tableTypeColId,
  ].filter(Boolean);

  const itemsQuery = `
    query ($boardId: [ID!], $colIds: [String!], $cursor: String) {
      boards(ids: $boardId) {
        items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
          cursor
          items {
            id
            name
            column_values(ids: $colIds) { id text ... on MirrorValue { display_value } }
          }
        }
      }
    }
  `;
  const nextPageQuery = `
    query ($cursor: String!, $colIds: [String!]) {
      next_items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
        cursor
        items {
          id
          name
          column_values(ids: $colIds) { id text ... on MirrorValue { display_value } }
        }
      }
    }
  `;

  const first = await mondayQuery(itemsQuery, { boardId: [SIGNUP_BOARD_ID], colIds, cursor: null });
  const board = first.boards?.[0];
  if (!board) throw new Error(`Board ${SIGNUP_BOARD_ID} not found (check the token has access to it).`);

  let rawItems = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const next = await mondayQuery(nextPageQuery, { cursor, colIds });
    rawItems = rawItems.concat(next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }

  const blankTypeRow = () => Object.fromEntries(TABLE_TYPES.map((t) => [t, 0]));
  const blankMetricSet = () => Object.fromEntries(METRICS.map((m) => [m, { sites: 0, byType: blankTypeRow() }]));
  const blankScope = () => ({ UK: blankMetricSet(), EMEA: blankMetricSet() });
  const funded = blankScope();
  const wholeEstate = blankScope();
  // Non-Funded's Stage 6+ figure isn't Whole Estate minus Funded like the
  // rest of this panel - Oli wants it stricter: only non-funded sites at
  // stage 6+ that also have an H&K Shipping Date populated (a sign the
  // table has genuinely been actioned, not just that the site is far
  // enough along). The Stage 5- card keeps the plain diff.
  const nonFundedShippingReady = { UK: 0, EMEA: 0, Total: 0 };
  const detailRows = [];
  const stage8To10Rows = [];
  const now = new Date();
  const in2Weeks = new Date(now.getTime() + 14 * MS_PER_DAY);
  const in4Weeks = new Date(now.getTime() + 28 * MS_PER_DAY);
  const installingSoon = {
    next2Weeks: { UK: 0, EMEA: 0, Total: 0 },
    next4Weeks: { UK: 0, EMEA: 0, Total: 0 },
  };
  const installingSoonRows = [];

  const seenNames = new Set();
  rawItems.forEach((item) => {
    const get = (id) => item.column_values.find((cv) => cv.id === id)?.text || "";
    const getDate = (id) => {
      const cv = item.column_values.find((cv) => cv.id === id);
      return parseDateLoose(cv?.text || cv?.display_value || "");
    };

    // Duplicate Sign Up records for the same real site are a known board
    // issue - dedupe by name so a duplicate doesn't inflate the forecast.
    const key = normalizeName(item.name);
    if (seenNames.has(key)) return;
    seenNames.add(key);

    const installPhase = get(INSTALL_PHASE_COL);
    if (isOutOfScopePhase(installPhase)) return; // live, cancelled or deinstalled - need already met or moot

    const inScope =
      classifyLayout(get(LAYOUT_TYPE_COL)) || classifyStoreOpeningType(get(STORE_OPENING_TYPE_COL));
    if (!inScope) return;

    const country = countryBucket(get(COUNTRY_COL));
    const tableType = TABLE_TYPES.includes(get(tableTypeColId)) ? get(tableTypeColId) : "Not set";
    const stage = stageNumber(installPhase);
    const metric = stage !== null && stage >= 6 ? "stage6Plus" : "stage5Below";
    const tableOrderedText = get(TABLE_ORDERED_COL);
    const installDate = getDate(INSTALL_DATE_COL);
    const shippingDateText = get(SHIPPING_DATE_COL);
    const hasShippingDate = Boolean(shippingDateText.trim());

    wholeEstate[country][metric].sites += 1;
    wholeEstate[country][metric].byType[tableType] += 1;

    const sfkText = normalize(get(sfkColId));
    const isFunded = SFK_TARGET_VALUES.some((v) => sfkText.includes(v));
    if (isFunded) {
      funded[country][metric].sites += 1;
      funded[country][metric].byType[tableType] += 1;
    } else if (metric === "stage6Plus" && hasShippingDate) {
      nonFundedShippingReady[country] += 1;
      nonFundedShippingReady.Total += 1;
    }

    detailRows.push({
      name: item.name,
      country,
      installPhase,
      metric,
      funded: isFunded,
      tableType,
      tableOrdered: tableOrderedText || "Not set",
      installDate: installDate ? installDate.toISOString().slice(0, 10) : "",
      shippingDate: hasShippingDate ? shippingDateText : "",
    });

    // Stage 8, 9 and 10 - far enough along that the table should already be
    // on order; call out any that aren't.
    if (stage === 8 || stage === 9 || stage === 10) {
      stage8To10Rows.push({
        name: item.name,
        country,
        stage,
        installPhase,
        funded: isFunded,
        tableOrdered: isTableOrdered(tableOrderedText),
        tableOrderedText: tableOrderedText || "Not set",
      });
    }

    // Installing soon - from the confirmed Install Date, cumulative windows
    // (next 4 weeks includes the next 2), future dates only.
    if (installDate && installDate >= now) {
      if (installDate <= in2Weeks) {
        installingSoon.next2Weeks[country] += 1;
        installingSoon.next2Weeks.Total += 1;
      }
      if (installDate <= in4Weeks) {
        installingSoon.next4Weeks[country] += 1;
        installingSoon.next4Weeks.Total += 1;
        installingSoonRows.push({
          name: item.name,
          country,
          installDate: installDate.toISOString().slice(0, 10),
          installPhase,
        });
      }
    }
  });

  return {
    tableTypes: TABLE_TYPES,
    metrics: METRICS,
    countries: COUNTRIES,
    funded,
    wholeEstate,
    nonFundedShippingReady,
    detailRows,
    stage8To10Rows,
    installingSoon,
    installingSoonRows,
  };
}
