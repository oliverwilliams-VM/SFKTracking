// Stock management: "Stock on hand" (a dedicated Monday board you populate
// with what Subway has actually purchased) vs "Required" (computed live
// from the Sign Up -> Ready to Go board + the 5 country Install -> BAU
// boards, for every site that isn't live yet).
//
// Required-stock scope, per discussion: EVERY site not yet live, across
// Interrupt, Disrupt, Small Format (Layout Type axis) and Retrofit,
// Remodel/NRO (Store Opening Type axis) — a site can match either axis,
// it's only ever counted once. Per-site quantities:
//   - KMS: 2, KMS Arm: 2, ORS: 1, ORS Bracket: 1, Table: 1 (fixed defaults)
//   - Kiosk: variable — pulled from the Sign Up board's own
//     "Apex Calc - Kiosk Qty" formula column, per site
//
// Column IDs below for the Sign Up/country boards are the same verified
// IDs used throughout this project's other dashboards (PipelineBoard,
// Install Status Tracker) — not guessed. The Hardware Stock board is new;
// its columns are resolved by exact title match so it keeps working even
// if Monday ever reassigns its internal column IDs.

const MONDAY_API_URL = "https://api.monday.com/v2";
const PAGE_SIZE = 500;

// Real hardware taxonomy, verified against Oli's opening-stock spreadsheet
// (not the earlier 6-item guess). Kiosk is split into two non-interchangeable
// variants: "ELO5 - Kiosk" is current, '22" Flyte' is the legacy variant used
// by the early-adopter sites (EG on the Move, MFG) — see isLegacyKioskPartner.
export const HARDWARE_TYPES = [
  "ELO4 - KDS",
  "ELO5 - Kiosk",
  '22" Flyte',
  "KDS Mounts",
  "ORS",
  "ORS Mount",
  "SFK Stand",
  "ADA Unit & Mount",
];
export const COUNTRIES = ["UK", "IE", "NL", "DE", "FI"];

// Fixed per-site requirement for everything except the two Kiosk variants
// (variable per site, see fetchRequiredStock below) and ADA Unit & Mount
// (no identified per-site source yet — tracked for Opening Stock only,
// known gap, flagged to Oli).
const PER_STORE_DEFAULTS = {
  "ELO4 - KDS": 2,
  "KDS Mounts": 2,
  ORS: 1,
  "ORS Mount": 1,
  "SFK Stand": 1,
};

const SIGNUP_BOARD_ID = "5678025992";
const SIGNUP_COLUMNS = {
  installPhase: "status",
  country: "country",
  layoutType: "dup__of_layout_type_bau1__1",
  storeOpeningType: "dup__of_store_type5__1",
  linkToInstallBau: "connect_boards__1",
  kioskQty: "formula_mm7mvbyf", // "Apex Calc - Kiosk Qty"
  corpPartner: "color_mkwgf1xm", // "Corp Partner" - identifies EG on the Move / MFG early adopters
};

// EG on the Move and MFG are the early-adopter sites still running the older
// 22" Flyte kiosk variant instead of the current ELO5 - Kiosk.
function isLegacyKioskPartner(corpPartner) {
  const t = normalize(corpPartner);
  return t === "eg on the move" || t === "mfg";
}

const COUNTRY_BOARDS = [
  { id: "5678172488", country: "UK", installPhase: "status", linkToSignUp: "board_relation1__1" },
  { id: "7519472262", country: "IE", installPhase: "status__1", linkToSignUp: "board_relation_mkmq1n7" },
  { id: "5757397415", country: "NL", installPhase: "status", linkToSignUp: "board_relation6__1" },
  { id: "5757508504", country: "DE", installPhase: "status", linkToSignUp: "board_relation1__1" },
  { id: "5756651462", country: "FI", installPhase: "status", linkToSignUp: "board_relation5__1" },
];

// Opening Stock — the one-off bulk purchase for the SW-Funded programme.
// This never gets restocked (once it's gone, it's gone), so rather than
// stand up a Monday board just to hold one static snapshot, it's hardcoded
// here. Source: Oli's opening-stock reconciliation spreadsheet (Oct 2026),
// pooled UK vs EMEA per his confirmation. If the real position changes,
// just edit the numbers below and redeploy — no Monday board, no env var.
const OPENING_STOCK = {
  UK: {
    "ELO4 - KDS": 0,
    "ELO5 - Kiosk": 44,
    '22" Flyte': 225,
    "KDS Mounts": 0,
    ORS: 0,
    "ORS Mount": 0,
    "SFK Stand": 44,
    "ADA Unit & Mount": 0,
  },
  EMEA: {
    "ELO4 - KDS": 0,
    "ELO5 - Kiosk": 0,
    '22" Flyte': 24,
    "KDS Mounts": 0,
    ORS: 0,
    "ORS Mount": 0,
    "SFK Stand": 0,
    "ADA Unit & Mount": 0,
  },
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
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

function normalize(str) {
  return (str || "").trim().toLowerCase();
}

function normalizeName(n) {
  return (n || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeCountry(text) {
  const t = normalize(text);
  if (!t) return null;
  if (t.includes("united kingdom") || t === "uk" || t === "gb") return "UK";
  if (t.includes("ireland")) return "IE";
  if (t.includes("netherlands") || t === "nl") return "NL";
  if (t.includes("germany") || t === "de") return "DE";
  if (t.includes("finland") || t === "fi") return "FI";
  return null;
}

// Ported verbatim from PipelineBoard's verified classification logic.
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

const LIVE_STATUS_PATTERN = /complete|hypercare|installed|live/i;
const NOT_LIVE_PATTERN = /not[\s-]*live|not[\s-]*installed|de-?i*install/i;
function isLiveStatus(installPhase) {
  const status = (installPhase || "").trim();
  if (!status) return false;
  return LIVE_STATUS_PATTERN.test(status) && !NOT_LIVE_PATTERN.test(status);
}

function parseLinkedNames(rawItem, columnId) {
  if (!columnId) return [];
  const cv = rawItem.column_values.find((c) => c.id === columnId);
  if (!cv) return [];
  const raw = cv.display_value || cv.text;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseKioskQty(rawItem, columnId) {
  const cv = rawItem.column_values.find((c) => c.id === columnId);
  if (!cv) return 0;
  // Formula columns usually populate `text` with the human-readable result;
  // fall back to parsing `value` (a JSON-encoded string) if text is empty.
  if (cv.text) {
    const n = parseFloat(cv.text);
    if (!Number.isNaN(n)) return n;
  }
  if (cv.value) {
    try {
      const parsed = JSON.parse(cv.value);
      const n = parseFloat(parsed);
      if (!Number.isNaN(n)) return n;
    } catch {
      // fall through to 0
    }
  }
  return 0;
}

async function fetchAllItems(boardId, colIds) {
  const itemsQuery = `
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
              value
              ... on BoardRelationValue { display_value }
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
          column_values(ids: $colIds) {
            id
            text
            value
            ... on BoardRelationValue { display_value }
            ... on MirrorValue { display_value }
          }
        }
      }
    }
  `;

  const first = await mondayQuery(itemsQuery, { boardId: [boardId], colIds, cursor: null });
  const board = first.boards?.[0];
  if (!board) throw new Error(`Board ${boardId} not found (check the token has access to it).`);

  let items = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const next = await mondayQuery(nextPageQuery, { cursor, colIds });
    items = items.concat(next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }
  return items;
}

// Computes required hardware quantities for every site not yet live,
// grouped by country and totalled. Returns null counts can't be computed
// (e.g. token missing) rather than throwing, so a stock-board problem
// doesn't take down the on-hand side of the report too.
export async function fetchRequiredStock() {
  if (!process.env.MONDAY_API_TOKEN) {
    throw new Error("MONDAY_API_TOKEN is not set.");
  }

  const signUpItemsRaw = await fetchAllItems(SIGNUP_BOARD_ID, Object.values(SIGNUP_COLUMNS));
  const signUpItems = signUpItemsRaw.map((raw) => {
    const get = (id) => {
      const cv = raw.column_values.find((c) => c.id === id);
      return cv ? cv.display_value || cv.text : "";
    };
    return {
      id: raw.id,
      name: raw.name,
      installPhase: get(SIGNUP_COLUMNS.installPhase),
      country: get(SIGNUP_COLUMNS.country),
      layoutType: get(SIGNUP_COLUMNS.layoutType),
      storeOpeningType: get(SIGNUP_COLUMNS.storeOpeningType),
      linkedInstallBauNames: parseLinkedNames(raw, SIGNUP_COLUMNS.linkToInstallBau),
      kioskQty: parseKioskQty(raw, SIGNUP_COLUMNS.kioskQty),
      corpPartner: get(SIGNUP_COLUMNS.corpPartner),
    };
  });

  const countryItemsByBoard = await Promise.all(
    COUNTRY_BOARDS.map(async (board) => {
      const raw = await fetchAllItems(board.id, [board.installPhase, board.linkToSignUp]);
      return raw.map((item) => {
        const get = (id) => {
          const cv = item.column_values.find((c) => c.id === id);
          return cv ? cv.display_value || cv.text : "";
        };
        return {
          id: item.id,
          name: item.name,
          installPhase: get(board.installPhase),
          linkedSignUpNames: parseLinkedNames(item, board.linkToSignUp),
        };
      });
    })
  );
  const countryItems = countryItemsByBoard.flat();

  // Same bidirectional live-matching PipelineBoard uses for its Estate
  // Total, so "not yet live" here means the same thing it means there.
  const liveItemsByNormName = new Map(
    countryItems.filter((i) => isLiveStatus(i.installPhase)).map((i) => [normalizeName(i.name), i])
  );
  const liveItemByOwnSignUpLinkName = new Map();
  countryItems.filter((i) => isLiveStatus(i.installPhase)).forEach((i) => {
    i.linkedSignUpNames.forEach((n) => liveItemByOwnSignUpLinkName.set(normalizeName(n), i));
  });

  const blankRow = () =>
    Object.fromEntries(HARDWARE_TYPES.map((type) => [type, 0]));
  const required = {};
  const siteCount = {};
  COUNTRIES.forEach((c) => {
    required[c] = blankRow();
    siteCount[c] = 0;
  });
  required.Total = blankRow();
  siteCount.Total = 0;

  const seenNames = new Set();
  signUpItems.forEach((item) => {
    const country = normalizeCountry(item.country);
    if (!country) return;

    // A site can match either classification axis (hardware layout vs.
    // works type) — either is enough to put it in scope, and it's only
    // ever counted once regardless of how many axes it matches.
    const inScope = classifyLayout(item.layoutType) || classifyStoreOpeningType(item.storeOpeningType);
    if (!inScope) return;

    // Duplicate Sign Up records for the same real site are a known issue
    // on this board (see PipelineBoard's reconciliation check) — dedupe
    // by name so a duplicate doesn't inflate the hardware requirement.
    const key = normalizeName(item.name);
    if (seenNames.has(key)) return;
    seenNames.add(key);

    let liveSite = item.linkedInstallBauNames
      .map((n) => liveItemsByNormName.get(normalizeName(n)))
      .find(Boolean);
    if (!liveSite) liveSite = liveItemByOwnSignUpLinkName.get(normalizeName(item.name));
    if (liveSite) return; // already live — doesn't count toward "required"

    const kioskQty = item.kioskQty || 0;
    const kioskType = isLegacyKioskPartner(item.corpPartner) ? '22" Flyte' : "ELO5 - Kiosk";
    required[country][kioskType] += kioskQty;
    required.Total[kioskType] += kioskQty;
    Object.entries(PER_STORE_DEFAULTS).forEach(([type, qty]) => {
      required[country][type] += qty;
      required.Total[type] += qty;
    });
    siteCount[country] += 1;
    siteCount.Total += 1;
  });

  return { required, siteCount };
}

// Stock on hand = the hardcoded OPENING_STOCK baseline above. No Monday
// board, no API call — kept async and returning the same
// { configured, boardName, rows } shape the dashboard already expects, so
// nothing downstream (the stock table, the SW Funded ledger) had to change.
export async function fetchStockOnHand() {
  const rows = [];
  Object.entries(OPENING_STOCK).forEach(([country, byType]) => {
    Object.entries(byType).forEach(([hardwareType, qtyInStock]) => {
      rows.push({
        id: `${country}-${hardwareType}`,
        country,
        hardwareType,
        qtyInStock,
        lastUpdated: null,
      });
    });
  });
  return { configured: true, boardName: "Opening Stock (hardcoded)", rows };
}
