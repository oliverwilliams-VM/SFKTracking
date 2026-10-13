// Debug query — fetches every item on the Sign Up board with every field
// relevant to the stock ledger / table forecast logic, so Claude (or
// anyone) can filter and inspect real data directly instead of guessing
// or working from a 5-item sample. Built for /api/debug-query - see that
// file for the filter params.

const MONDAY_API_URL = "https://api.monday.com/v2";
const PAGE_SIZE = 500;
const SIGNUP_BOARD_ID = "5678025992";

// Verified ids, same ones hardcoded elsewhere in this project for this board.
const INSTALL_PHASE_COL = "status";
const COUNTRY_COL = "country";
const LAYOUT_TYPE_COL = "dup__of_layout_type_bau1__1";
const STORE_OPENING_TYPE_COL = "dup__of_store_type5__1";

// Resolved by title - newer fields, not previously hardcoded, or ones
// worth re-resolving defensively in case Monday ever changes the id.
const TITLE_MATCHES = {
  sfkFormat: ["sfk format"],
  corpPartner: ["corp partner"],
  kioskQtyFormula: ["calc - kiosk qty", "calc-kiosk qty"],
  kioskQtyMirror: ["total kiosk screens"],
  typeOfTable: ["type of table"],
};

function normalize(str) {
  return (str || "").trim().toLowerCase();
}
function findColumnId(columns, keywords) {
  const match = columns.find((c) => keywords.some((k) => normalize(c.title).includes(k)));
  return match ? match.id : null;
}
function stageNumber(phase) {
  const match = (phase || "").match(/^(\d+)\./);
  return match ? parseInt(match[1], 10) : null;
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

export async function fetchAllSignUpItemsForDebug() {
  if (!process.env.MONDAY_API_TOKEN) {
    throw new Error("MONDAY_API_TOKEN is not set.");
  }

  const colData = await mondayQuery(
    `query ($boardId: [ID!]) { boards(ids: $boardId) { columns { id title } } }`,
    { boardId: [SIGNUP_BOARD_ID] }
  );
  const columns = colData.boards?.[0]?.columns || [];
  const resolved = Object.fromEntries(
    Object.entries(TITLE_MATCHES).map(([key, keywords]) => [key, findColumnId(columns, keywords)])
  );

  const colIds = [
    INSTALL_PHASE_COL,
    COUNTRY_COL,
    LAYOUT_TYPE_COL,
    STORE_OPENING_TYPE_COL,
    ...Object.values(resolved),
  ].filter(Boolean);

  const itemsQuery = `
    query ($boardId: [ID!], $colIds: [String!], $cursor: String) {
      boards(ids: $boardId) {
        items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
          cursor
          items {
            id
            name
            updated_at
            column_values(ids: $colIds) {
              id
              text
              value
              ... on MirrorValue { display_value }
            }
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
          updated_at
          column_values(ids: $colIds) {
            id
            text
            value
            ... on MirrorValue { display_value }
          }
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

  function parseNumeric(cv) {
    if (!cv) return 0;
    if (cv.text) {
      const n = parseFloat(cv.text);
      if (!Number.isNaN(n)) return n;
    }
    if (cv.display_value) {
      const n = parseFloat(cv.display_value);
      if (!Number.isNaN(n)) return n;
    }
    if (cv.value) {
      try {
        const n = parseFloat(JSON.parse(cv.value));
        if (!Number.isNaN(n)) return n;
      } catch {
        // fall through
      }
    }
    return 0;
  }

  return rawItems.map((item) => {
    const get = (id) => item.column_values.find((cv) => cv.id === id)?.text || "";
    const getCv = (id) => item.column_values.find((cv) => cv.id === id);
    const kioskQtyFormula = parseNumeric(getCv(resolved.kioskQtyFormula));
    const kioskQtyMirror = parseNumeric(getCv(resolved.kioskQtyMirror));
    const installPhase = get(INSTALL_PHASE_COL);

    return {
      name: item.name,
      updatedAt: item.updated_at || null,
      installPhase,
      stage: stageNumber(installPhase),
      isLive: normalize(installPhase).includes("live"),
      country: get(COUNTRY_COL),
      layoutType: get(LAYOUT_TYPE_COL),
      storeOpeningType: get(STORE_OPENING_TYPE_COL),
      sfkFormat: get(resolved.sfkFormat),
      corpPartner: get(resolved.corpPartner),
      kioskQtyFormula,
      kioskQtyMirror,
      kioskQtyUsed: kioskQtyFormula || kioskQtyMirror,
      kioskQtySource: kioskQtyFormula ? "formula" : kioskQtyMirror ? "mirror" : "none",
      typeOfTable: get(resolved.typeOfTable),
    };
  });
}
