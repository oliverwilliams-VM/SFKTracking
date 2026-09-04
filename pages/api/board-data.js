// Pulls the "Sign Up -> Ready to Go" board from Monday.com and returns only
// items whose "SFK Format" column is "Part Subway Funded".
//
// Requires an environment variable MONDAY_API_TOKEN (personal API token,
// same one used for the other self-hosted dashboards) set in Vercel.

const BOARD_ID = process.env.MONDAY_BOARD_ID || "5678025992"; // Sign Up -> Ready to Go, all countries
const SFK_COLUMN_TITLE = "SFK Format";
const SFK_TARGET_VALUE = "Part Subway Funded";
const MONDAY_API_URL = "https://api.monday.com/v2";
const PAGE_SIZE = 500; // Monday's max items_page limit - fewer round trips for a big board

// Give this function room to page through a large board (this is the Hobby
// plan's max without Fluid Compute; if the board is big enough to still time
// out, the fix is server-side filtering via query_params, not a bigger number
// here).
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

const BOARD_QUERY = `
  query ($boardId: [ID!], $cursor: String) {
    boards(ids: $boardId) {
      name
      columns {
        id
        title
      }
      items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
        cursor
        items {
          id
          name
          column_values {
            id
            text
            column {
              title
            }
          }
        }
      }
    }
  }
`;

const NEXT_PAGE_QUERY = `
  query ($cursor: String!) {
    next_items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
      cursor
      items {
        id
        name
        column_values {
          id
          text
          column {
            title
          }
        }
      }
    }
  }
`;

function normalize(str) {
  return (str || "").trim().toLowerCase();
}

export default async function handler(req, res) {
  if (!process.env.MONDAY_API_TOKEN) {
    return res.status(500).json({
      error:
        "MONDAY_API_TOKEN is not set. Add it as an environment variable in Vercel (Project Settings -> Environment Variables) and redeploy.",
    });
  }

  try {
    const data = await mondayQuery(BOARD_QUERY, {
      boardId: [BOARD_ID],
      cursor: null,
    });

    const board = data.boards?.[0];
    if (!board) {
      return res.status(404).json({ error: `Board ${BOARD_ID} not found (check the token has access to it).` });
    }

    let allItems = [...board.items_page.items];
    let cursor = board.items_page.cursor;

    // Page through the rest of the board.
    while (cursor) {
      const nextData = await mondayQuery(NEXT_PAGE_QUERY, { cursor });
      allItems = allItems.concat(nextData.next_items_page.items);
      cursor = nextData.next_items_page.cursor;
    }

    // Filter to items where the SFK Format column reads "Part Subway Funded".
    const filtered = allItems.filter((item) =>
      item.column_values.some(
        (cv) =>
          normalize(cv.column?.title) === normalize(SFK_COLUMN_TITLE) &&
          normalize(cv.text).includes(normalize(SFK_TARGET_VALUE))
      )
    );

    // Reshape into a simple { name, columns: { title: text } } structure for the UI.
    const items = filtered.map((item) => {
      const columns = {};
      item.column_values.forEach((cv) => {
        if (cv.column?.title) columns[cv.column.title] = cv.text || "";
      });
      return { id: item.id, name: item.name, columns };
    });

    res.status(200).json({
      boardName: board.name,
      total: items.length,
      items,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unknown error fetching Monday data." });
  }
}
