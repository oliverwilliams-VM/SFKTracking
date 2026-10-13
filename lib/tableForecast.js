// Table Forecast — "how many tables, of which shape, do we still need" for
// every site not yet live. Three numbers, per Oli's spec:
//   - Funded: the SFK-funded population (same scope as the SW Funded
//     Stock Ledger — SFK Format = Part Subway Funded / MFG Funded Site)
//   - Whole Estate: every not-yet-live site, full stop - Interrupt,
//     Disrupt, Small Format, Retrofit, Remodel/NRO, funded or not
//   - Non-Funded (Retrofit/Remodel): Whole Estate minus Funded - the FZE
//     self-purchased population, reported as the difference rather than
//     fetched separately, since Funded is always a subset of Whole Estate
//
// Quantity is flat 1 table per site (confirmed - no per-site quantity
// field exists on Monday for this), broken down by the real "Type of
// Table" column (Rectangle / Circular / Long Rectangle). Each scope is
// further split into Total / Stage 6+ / Stage 5 (and below) - same stage
// cut as the ledger's "Accounted For" definition.
//
// "Not yet live" is read directly off the Sign Up board's own status
// column (title "Install Phase", column id "status") - confirmed via a
// live schema check that "Live" is a real, exact label there, so no
// cross-reference against the 5 country boards is needed (consistent with
// how the rest of this dashboard already determines live sites).

const MONDAY_API_URL = "https://api.monday.com/v2";
const PAGE_SIZE = 500;

const SIGNUP_BOARD_ID = "5678025992";
// Verified ids, same ones used elsewhere in this project for this board.
const INSTALL_PHASE_COL = "status";
const COUNTRY_COL = "country";
const LAYOUT_TYPE_COL = "dup__of_layout_type_bau1__1";
const STORE_OPENING_TYPE_COL = "dup__of_store_type5__1";
// Resolved by title (not hardcoded) since they're newly added to this fetch.
const SFK_FORMAT_TITLE_MATCH = ["sfk format"];
const TABLE_TYPE_TITLE_MATCH = ["type of table"];
const SFK_TARGET_VALUES = ["part subway funded", "mfg funded site"];

export const TABLE_TYPES = ["Rectangle", "Circular", "Long Rectangle", "Not set"];

function normalize(str) {
  return (str || "").trim().toLowerCase();
}
function normalizeName(n) {
  return (n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function findColumnId(columns, keywords) {
  const match = columns.find((c) => keywords.some((k) => normalize(c.title).includes(k)));
  return match ? match.id : null;
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

function isLiveOrDeadPhase(phase) {
  const p = normalize(phase);
  return p.includes("live") || p.includes("cancelled") || p.includes("canceled") || p.includes("deinstall");
}

// Pulls the leading "6." off a phase label like "6. Contract/Invoice Sent" -
// same pattern used for the ledger's "Accounted For" stage check.
function stageNumber(phase) {
  const match = (phase || "").match(/^(\d+)\./);
  return match ? parseInt(match[1], 10) : null;
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
    sfkColId,
    tableTypeColId,
  ].filter(Boolean);

  const itemsQuery = `
    query ($boardId: [ID!], $colIds: [String!], $cursor: String) {
      boards(ids: $boardId) {
        items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
          cursor
          items { id name column_values(ids: $colIds) { id text } }
        }
      }
    }
  `;
  const nextPageQuery = `
    query ($cursor: String!, $colIds: [String!]) {
      next_items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
        cursor
        items { id name column_values(ids: $colIds) { id text } }
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

  const blankRow = () => Object.fromEntries(TABLE_TYPES.map((t) => [t, 0]));
  const blankBucketSet = () => ({ total: blankRow(), stage6Plus: blankRow(), stage5Below: blankRow() });
  const funded = blankBucketSet();
  const wholeEstate = blankBucketSet();
  const fundedSites = { total: 0, stage6Plus: 0, stage5Below: 0 };
  const wholeEstateSites = { total: 0, stage6Plus: 0, stage5Below: 0 };

  const seenNames = new Set();
  rawItems.forEach((item) => {
    const get = (id) => item.column_values.find((cv) => cv.id === id)?.text || "";

    // Duplicate Sign Up records for the same real site are a known board
    // issue - dedupe by name so a duplicate doesn't inflate the forecast.
    const key = normalizeName(item.name);
    if (seenNames.has(key)) return;
    seenNames.add(key);

    const installPhase = get(INSTALL_PHASE_COL);
    if (isLiveOrDeadPhase(installPhase)) return; // live, cancelled or deinstalled - out of scope

    const inScope =
      classifyLayout(get(LAYOUT_TYPE_COL)) || classifyStoreOpeningType(get(STORE_OPENING_TYPE_COL));
    if (!inScope) return;

    const tableType = TABLE_TYPES.includes(get(tableTypeColId)) ? get(tableTypeColId) : "Not set";
    const stage = stageNumber(installPhase);
    // "Stage 6 and above" vs "Stage 5" (anything else not yet there,
    // including the non-numbered admin states) - same split as the
    // ledger's "Accounted For" definition.
    const bucket = stage !== null && stage >= 6 ? "stage6Plus" : "stage5Below";

    wholeEstate.total[tableType] += 1;
    wholeEstate[bucket][tableType] += 1;
    wholeEstateSites.total += 1;
    wholeEstateSites[bucket] += 1;

    const sfkText = normalize(get(sfkColId));
    const isFunded = SFK_TARGET_VALUES.some((v) => sfkText.includes(v));
    if (isFunded) {
      funded.total[tableType] += 1;
      funded[bucket][tableType] += 1;
      fundedSites.total += 1;
      fundedSites[bucket] += 1;
    }
  });

  return {
    tableTypes: TABLE_TYPES,
    funded,
    wholeEstate,
    fundedSites,
    wholeEstateSites,
  };
}
