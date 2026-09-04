# SFK — Part Subway Funded Dashboard

Standalone dashboard showing every site on the **Sign Up → Ready to Go** Monday
board (id `5678025992`) where the **SFK Format** column is set to
**Part Subway Funded**. Built the same way as the other two self-hosted
dashboards — no Monday publishing fee, plain Next.js app, deployed to Vercel's
free tier.

## What it shows

- Total count of Part Subway Funded sites
- Breakdown by status column (if the board has one titled "Status")
- Breakdown by country/market column (if present)
- A searchable table of every matching site

The column detection is automatic — it looks at column titles rather than
hardcoded IDs, so it won't break if columns get reordered. If your board's
status or country column is titled something unusual, it'll just fall back to
showing all columns in the table instead of a breakdown card.

## 1. Get a Monday API token

Same route as before: **Monday → Avatar → Developers → My Access Tokens** →
copy your personal token. Same token works across all your dashboards; no need
to generate a new one.

## 2. Push to GitHub

```bash
cd sfk-subway-funded-dashboard
git init
git add .
git commit -m "Initial commit"
gh repo create sfk-subway-funded-dashboard --private --source=. --push
```

(Or push manually to a new empty repo if you don't have `gh` installed.)

## 3. Deploy on Vercel

1. Import the repo at vercel.com (Hobby/free plan)
2. Framework preset: Next.js (auto-detected)
3. Add an environment variable:
   - `MONDAY_API_TOKEN` = your personal token from step 1
4. Deploy

No password gate is set up, matching your decision on the other dashboard —
add one later if this needs to be locked down for a wider audience than SLT.

## Local development

```bash
npm install
MONDAY_API_TOKEN=your_token_here npm run dev
```

Then open http://localhost:3000.

## If the board schema doesn't match

The API route (`pages/api/board-data.js`) assumes:
- Board ID `5678025992` (override with a `MONDAY_BOARD_ID` env var if needed)
- A column literally titled **SFK Format**
- A value containing the text **Part Subway Funded**

If any of those differ slightly from what's actually on the board (e.g. the
column is titled "SFK format type"), tweak the constants at the top of that
file — the match is case-insensitive and does a partial match, so small
wording differences are already handled.
