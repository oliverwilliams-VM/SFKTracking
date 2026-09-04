// Shared Monday.com fetch logic - used by /api/board-data (live dashboard
// requests) and /api/snapshot (the daily cron job that records history).
//
// Requires an environment variable MONDAY_API_TOKEN (personal API token,
// same one used for the other self-hosted dashboards) set in Vercel.

const BOARD_ID = process.env.MONDAY_BOARD_ID || "5678025992"; // Sign Up -> Ready to Go, all countries
const SFK_COLUMN_TITLE = "SFK Format";
const SFK_TARGET_VALUE = "Part Subway Funded";
const INSTALL_PHASE_TITLE_MATCH = ["install phase"];
const COUNTRY_TITLE_MATCH = ["country", "market"];
const MONDAY_API_URL = "https://api.monday.com/v2";
const PAGE_SIZE = 500; // Monday's max items_page limit - fewer round trips for a big board

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
  if (json.errors) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

function normalize(str) {
  return (str || "").trim().toLowerCase();
}

function findColumnId(columns, keywords) {
  const match = columns.find((c) =>
    keywords.some((k) => normalize(c.title).includes(k))
  );
  return match ? match.id : null;
}

const COLUMNS_QUERY = `
  query ($boardId: [ID!]) {
    boards(ids: $boardId) {
      name
      columns {
        id
        title
      }
    }
  }
`;

// column_values(ids: $colIds) restricts the payload to just the columns we
// need instead of every column on the board - the main speed win.
// updated_at is a free field on the item itself (not a column), used as a
// proxy for "how long has this site sat untouched" (see staleness feature).
const ITEMS_QUERY = `
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
          }
        }
      }
    }
  }
`;

const NEXT_PAGE_QUERY = `
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
        }
      }
    }
  }
`;

if (!process.env.MONDAY_API_TOKEN) {
  // Individual API routes check this too (for a clean HTTP error), but this
  // makes the failure obvious in logs if this module is imported elsewhere.
}

// Fetches every Part Subway Funded item on the board with the fields the
// dashboard and the history snapshot both need. Throws on failure - callers
// decide how to surface that as an HTTP response.
export async function fetchSfkItems() {
  if (!process.env.MONDAY_API_TOKEN) {
    throw new Error(
      "MONDAY_API_TOKEN is not set. Add it as an environment variable in Vercel (Project Settings -> Environment Variables) and redeploy."
    );
  }

  // Step 1: resolve which column IDs we actually need.
  const colData = await mondayQuery(COLUMNS_QUERY, { boardId: [BOARD_ID] });
  const board = colData.boards?.[0];
  if (!board) {
    throw new Error(`Board ${BOARD_ID} not found (check the token has access to it).`);
  }

  const sfkColId = findColumnId(board.columns, [normalize(SFK_COLUMN_TITLE)]);
  const installColId = findColumnId(board.columns, INSTALL_PHASE_TITLE_MATCH);
  const countryColId = findColumnId(board.columns, COUNTRY_TITLE_MATCH);

  if (!sfkColId) {
    throw new Error(
      `Couldn't find a column titled "${SFK_COLUMN_TITLE}" on this board. Columns found: ${board.columns.map((c) => c.title).join(", ")}`
    );
  }

  const colIds = [sfkColId, installColId, countryColId].filter(Boolean);

  // Step 2: page through items, only pulling those columns.
  const firstPage = await mondayQuery(ITEMS_QUERY, {
    boardId: [BOARD_ID],
    colIds,
    cursor: null,
  });

  let allItems = [...firstPage.boards[0].items_page.items];
  let cursor = firstPage.boards[0].items_page.cursor;

  while (cursor) {
    const nextData = await mondayQuery(NEXT_PAGE_QUERY, { cursor, colIds });
    allItems = allItems.concat(nextData.next_items_page.items);
    cursor = nextData.next_items_page.cursor;
  }

  // Filter to items where the SFK Format column reads "Part Subway Funded".
  const filtered = allItems.filter((item) => {
    const sfkValue = item.column_values.find((cv) => cv.id === sfkColId);
    return normalize(sfkValue?.text).includes(normalize(SFK_TARGET_VALUE));
  });

  const items = filtered.map((item) => {
    const get = (id) => item.column_values.find((cv) => cv.id === id)?.text || "";
    return {
      id: item.id,
      name: item.name,
      installPhase: installColId ? get(installColId) : "",
      country: countryColId ? get(countryColId) : "",
      updatedAt: item.updated_at || null,
    };
  });

  return {
    boardName: board.name,
    items,
    hasInstallPhaseColumn: Boolean(installColId),
    hasCountryColumn: Boolean(countryColId),
  };
}
