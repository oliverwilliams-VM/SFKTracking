// Pulls the "Sign Up -> Ready to Go" board from Monday.com and returns only
// items whose "SFK Format" column is "Part Subway Funded", with just the
// columns the dashboard actually needs (Install phase, Country) attached.
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

// Hobby plan's max without Fluid Compute. Only fetching the 3 columns we
// actually use (instead of every column on the board) is the bigger lever on
// speed - this is just headroom in case the board is still large.
export const config = {
  maxDuration: 60,
};

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
const ITEMS_QUERY = `
  query ($boardId: [ID!], $colIds: [String!], $cursor: String) {
    boards(ids: $boardId) {
      items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
        cursor
        items {
          id
          name
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
        column_values(ids: $colIds) {
          id
          text
        }
      }
    }
  }
`;

export default async function handler(req, res) {
  if (!process.env.MONDAY_API_TOKEN) {
    return res.status(500).json({
      error:
        "MONDAY_API_TOKEN is not set. Add it as an environment variable in Vercel (Project Settings -> Environment Variables) and redeploy.",
    });
  }

  try {
    // Step 1: resolve which column IDs we actually need.
    const colData = await mondayQuery(COLUMNS_QUERY, { boardId: [BOARD_ID] });
    const board = colData.boards?.[0];
    if (!board) {
      return res.status(404).json({ error: `Board ${BOARD_ID} not found (check the token has access to it).` });
    }

    const sfkColId = findColumnId(board.columns, [normalize(SFK_COLUMN_TITLE)]);
    const installColId = findColumnId(board.columns, INSTALL_PHASE_TITLE_MATCH);
    const countryColId = findColumnId(board.columns, COUNTRY_TITLE_MATCH);

    if (!sfkColId) {
      return res.status(500).json({
        error: `Couldn't find a column titled "${SFK_COLUMN_TITLE}" on this board. Columns found: ${board.columns.map((c) => c.title).join(", ")}`,
      });
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
      };
    });

    // Cache at the edge for a minute so repeat loads within a session are
    // near-instant; stale-while-revalidate keeps it fresh in the background.
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    res.status(200).json({
      boardName: board.name,
      total: items.length,
      items,
      hasInstallPhaseColumn: Boolean(installColId),
      hasCountryColumn: Boolean(countryColId),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error fetching Monday data." });
  }
}
