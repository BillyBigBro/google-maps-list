# Maps List Dashboard

An interactive dashboard for browsing and organizing Google Maps saved lists.
Import a list, enrich it with Google Places data, then sort, filter, tag and
export it as a table.

## Why it works this way

**Google has no public API for user-created Lists.** The Places API can tell you
everything about *a* place, but nothing can read "my saved list" through an
official endpoint. So ingestion happens in two steps:

1. **Get the places out of the list** — via a Google Takeout CSV export.
2. **Enrich each place** — via the Places API, which supplies hours, phone,
   website, rating, category and coordinates.

Pasting a `maps.app.goo.gl` share link directly is the next feature (see
[Roadmap](#roadmap)); it needs a headless browser and is inherently more
fragile, which is why the reliable path exists first.

Note also that there is **no write API for Google Maps lists** — this app can't
push changes back to Google. Your tags, statuses and notes live here, and you
export them as CSV.

## Setup

Requires Node.js 20+ and a Postgres database.

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and GOOGLE_MAPS_API_KEY
npm run dev
```

Open http://localhost:3000. Tables are created automatically on first query —
there is no separate migration step.

If you don't want to install Postgres locally, the simplest path is to create
the Railway Postgres service first (below) and paste its **public** connection
URL into `.env.local`. You then develop against the same database you deploy to.

### Getting a Places API key

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Places API (New)** — not the legacy "Places API".
3. Create an API key under *Credentials* and set it as `GOOGLE_MAPS_API_KEY`.
4. Restrict it to the Places API. The key is only ever used server-side, so an
   IP restriction is appropriate — never expose it to the browser.

The app runs without a key; you just get the columns that came from the CSV.

### Cost

Enrichment makes **one Places request per place**, once. Results are cached in
Postgres and never re-fetched, and the `places` table is shared across lists and
users — so the second person to save a given restaurant costs nothing.

Google bills Places fields in tiers (Essentials / Pro / Enterprise) and charges
the highest tier your request touches. The default field set in
[`src/lib/places.ts`](src/lib/places.ts) includes opening hours, phone and
website, which pushes it past the cheapest tier. Trim `DETAIL_FIELDS` there to
cut cost. Check current
[Places API pricing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
before enriching a large library — the SKU structure changed in 2025.

## Deploying to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**, pick this repo.
3. **New → Database → Add PostgreSQL** in the same project.
4. On the app service, open *Variables* and add:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — Railway resolves the reference |
   | `GOOGLE_MAPS_API_KEY` | your key |

5. Generate a domain under *Settings → Networking*.

Railway autodetects Next.js, so no Dockerfile is needed. [`railway.json`](railway.json)
points the deploy healthcheck at `/api/health`, which verifies database
connectivity — a deploy with a bad `DATABASE_URL` fails visibly instead of
serving errors.

Two things to do once deployed:

- Add Railway's egress IPs to your Google API key restriction.
- **The app has no authentication yet.** Anyone with the URL can see, edit and
  delete every list. Don't share the domain until auth is in place.

## Exporting your lists from Google

1. Go to [Google Takeout → Maps](https://takeout.google.com/settings/takeout/custom/maps).
2. Select **Saved** — this is the section containing your lists.
3. Export, download the archive and unzip it.
4. You'll find one CSV per list, named after the list.

The CSVs contain `Title,Note,URL`. Column names are matched loosely, so older
exports with different headers still work.

## Using it

- **Import Takeout CSV** — creates a list from a CSV.
- **Fetch details** — enriches every place that doesn't yet have Google data.
  Safe to re-run; it only fetches what's missing, so a partial failure costs
  nothing to retry.
- **Search / category / status filters**, and click any column header to sort.
- **Columns** — toggle visibility. Lat/Lng, Hours and Google's business status
  are hidden by default.
- **My status / Tags / My note** — your own annotations, saved as you edit.
- **Export CSV** — the full enriched table including your annotations.

## Architecture

```
src/
  app/
    page.tsx                     server component: loads lists + rows
    api/
      health/route.ts            deploy healthcheck (app + database)
      lists/route.ts             GET all lists · POST import CSV
      lists/[id]/route.ts        GET rows · PATCH rename · DELETE
      lists/[id]/enrich/route.ts POST run enrichment
      lists/[id]/export/route.ts GET CSV download
      entries/[id]/route.ts      PATCH user annotations · DELETE
  components/
    Dashboard.tsx                client shell: list switching, actions
    PlacesTable.tsx              TanStack Table grid
  lib/
    db.ts                        Postgres schema + queries
    types.ts                     shared types
    takeout.ts                   Takeout CSV parsing
    maps-url.ts                  extracts Place ID / CID / coords from Maps URLs
    places.ts                    Places API (New) client
    enrich.ts                    enrichment orchestration
scripts/
  test-db.mts                    exercises every query (npm run test:db)
```

Three tables: `lists`, `places`, and `list_entries` joining them. Places are
keyed by Google Place ID and **shared across lists**, so a restaurant saved in
three lists is only enriched once. `list_entries` carries the per-list data —
the note from Takeout plus your own tags, status and rating.

Enrichment prefers an exact Place Details lookup when the source URL contained a
Place ID, and falls back to a text search biased by the coordinates in the URL.
That bias matters for chains — "Blue Bottle Coffee" alone would resolve almost
anywhere.

Initial page data is loaded server-side; the client keeps an overlay of your
in-flight edits merged over the server rows, which is why the table stays
responsive without a data-fetching effect.

### Testing

```bash
npm run test:db
```

Runs every database query against an in-memory Postgres (`pg-mem`) — no live
database needed. Worth re-running after any change to [db.ts](src/lib/db.ts).

## Roadmap

- **Authentication** (Google OAuth via Auth.js) and per-user scoping. Required
  before the deployed URL can be shared — every table needs a `user_id` and
  every query needs to filter on it.
- **Paste a share link.** Resolve the `maps.app.goo.gl` redirect, then drive a
  headless browser (Playwright) to scroll the list panel and read the entries.
  [maps-url.ts](src/lib/maps-url.ts) already handles resolution and parsing;
  what's missing is the browser worker. Caveats: against Google's Terms of
  Service, breaks when they change their markup, and gets bot-challenged from
  datacenter IPs — so it will be less reliable on Railway than locally.
- Per-user enrichment quota, so one large import can't run up the bill.
- Map view alongside the table.

## Notes on dependencies

- **`pg` with hand-written SQL**, no ORM. The schema is three tables; Prisma's
  install scripts are blocked by npm 11's script policy and Prisma 7 changed its
  generator, neither of which is worth fighting at this size.
- **TanStack Table is pinned to v8.** v9 shipped a rewritten API (`useTable`
  rather than `useReactTable`); this code targets v8.
