# Funded SFK Install Programme Dashboard

## What's new in this update

1. **Logos** — fixed (were pointing at the wrong filenames).
2. **Trend history** — Total and Live now show "1 mo ago" / "3 mo ago"
   comparisons, once history has had time to accumulate. Needs a one-time
   Redis setup — see below.
3. **Password gate** — optional, off by default. Set `DASHBOARD_PASSWORD` to
   turn it on.
4. **Needs attention panel** — flags sites that haven't been touched (any
   field changed) in 14+ days and aren't already Live or Cancelled.
5. **Search box** — top right, jump straight to a site by name.
6. **Auto-refresh toggle** — top right, refreshes every 5 minutes when on.
   Remembers your preference between visits.
7. Every KPI card and country badge is clickable — opens a by-country
   breakdown for that phase.

## Required setup

### Monday API token (unchanged)
Same personal token as your other dashboards. `MONDAY_API_TOKEN` in Vercel.

### Trend history (new - optional but recommended)
Vercel's own KV product was discontinued in Dec 2024; the direct replacement
is Upstash for Redis via the Vercel Marketplace. One-time setup:

1. In your Vercel project → **Storage** tab → **Create Database** → choose
   **Upstash for Redis** (free tier is plenty for this).
2. Connect it to this project. Vercel automatically adds `KV_REST_API_URL`
   and `KV_REST_API_TOKEN` as environment variables — no manual copying.
3. Add a `CRON_SECRET` environment variable — any random string works
   (e.g. generate one with `openssl rand -hex 32`). This stops anyone else
   from triggering your snapshot endpoint.
4. Redeploy. `vercel.json` already schedules the snapshot to run daily at
   6am UTC — no further setup needed.

Until a few snapshots have accumulated, the dashboard shows a note instead
of blank/wrong trend numbers rather than guessing. Since this only started
recording from whenever you set it up, "1 month ago" will only be meaningful
once a month has actually passed — there's no way to backfill history that
didn't exist.

If you skip this step entirely, the dashboard works exactly as before, it
just won't show trend chips.

### Password gate (new - optional, off by default)
Set a `DASHBOARD_PASSWORD` environment variable to require a shared password
before anyone can view the dashboard. Leave it unset and the dashboard stays
open, exactly as it's been.

This is a single shared password for anyone with the link, not per-user
login — appropriate for an internal SLT tool, not for anything that needs a
real access-control boundary.

## Logo files
Already wired to your existing filenames:
- `Vita Mojo_Primary_Dark.png`
- `Subway.png`

Falls back to `vita-mojo-logo.(svg|png)` / `subway-logo.(svg|png)` if you
ever rename them. Filenames are case-sensitive on Vercel (Linux) even though
they're not on a Mac.

## Deploying
Same as before: push to your GitHub repo, Vercel redeploys automatically.
New dependency (`@upstash/redis`) will install itself on the next build —
no manual `npm install` needed on Vercel's side.

## Local development
```bash
npm install
vercel env pull .env.development.local   # pulls all your Vercel env vars
npm run dev
```
