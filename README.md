# Maps List Dashboard

Paste a shared Google Maps list, get a sortable table of every place in it —
with hours, phone numbers, ratings, categories and websites filled in from the
Places API. Tag places, mark them visited, export to CSV.

## How it reads a list

**Google has no public API for user-created Lists.** But the Maps web client
loads list contents from an internal JSON endpoint, and that endpoint works over
plain HTTP — no browser, no cookies, no authentication:

```
GET /maps/preview/entitylist/getlist?...&pb=!1m6!1s<LIST_ID>!2e3!3m1!1e1!…
```

So the flow is:

1. Follow the `maps.app.goo.gl` redirect to get the list id.
2. Call that endpoint and parse the (deeply nested, positional) response, which
   yields each place's **name, address, coordinates, note and feature id**.
3. Optionally enrich each place through the **Places API (New)** for hours,
   phone, website, rating, price and category.

Step 3 is the only part that costs anything, and the only part that needs an API
key. Steps 1–2 are free and instant.

This endpoint is undocumented and can change without notice. The parser is
defensive throughout and fails with an actionable message rather than a stack
trace — and Takeout CSV import remains as a fallback. Worth stating plainly:
reading Maps this way is against Google's Terms of Service, and it is your call
whether that matters for your use.

There is also **no write API for Maps lists** — this app can't push changes back
to Google. Tags, statuses and notes live here, and you export them as CSV.

## No accounts

There is no sign-in. A list lives at an unguessable URL:

```
/list/4Kma99c4XL4BhyHb
```

The id is 16 characters from a 57-character alphabet (~93 bits), so it can't be
found by guessing. Anyone with the URL can view and edit that list — like a
"anyone with the link" share. Bookmark it, or rely on the **Your lists** strip
on the home page, which is remembered in your browser's local storage only; the
server never sees it.

Lookalike characters (`0`/`O`, `1`/`l`/`I`) are excluded from ids so they
survive being read aloud or retyped.

## Setup

Requires Node.js 20+ and a Postgres database.

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL, and optionally the API key
npm run dev
```

Open http://localhost:3000. Tables are created on first query — no migration step.

If you don't want Postgres locally, create the Railway Postgres service first
(below) and paste its **public** connection URL into `.env.local`.

### Getting a Places API key

Optional — the app reads and organizes lists without one; you just don't get the
Google-sourced columns.

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Places API (New)** — not the legacy "Places API".
3. Create an API key under *Credentials*, set it as `GOOGLE_MAPS_API_KEY`.
4. Restrict it to the Places API. It's only used server-side, so an IP
   restriction is appropriate — never expose it to the browser.

### Cost

Enrichment makes **one Places request per place**, once. Results are cached in
Postgres and never re-fetched, and the `places` table is shared across every
list — so the second person to save a given restaurant costs nothing.

Google bills Places fields in tiers (Essentials / Pro / Enterprise) and charges
the highest tier your request touches. The default field set in
[`src/lib/places.ts`](src/lib/places.ts) includes opening hours, phone and
website, which pushes it past the cheapest tier. Trim `DETAIL_FIELDS` to cut
cost. Check current
[Places API pricing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
before enriching a large library — the SKU structure changed in 2025.

## Deploying to Railway

1. Push to GitHub.
2. **New Project → Deploy from GitHub repo**.
3. **New → Database → Add PostgreSQL** in the same project.
4. On the app service, *Variables*:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `GOOGLE_MAPS_API_KEY` | your key (optional) |

   Project-level *Shared Variables* are **not** automatically given to
   services — each must be explicitly shared with the app service, and only
   with the app service. Postgres needs none of them.

5. Generate a domain under *Settings → Networking*.

Railway autodetects Next.js; no Dockerfile needed. [`railway.json`](railway.json)
points the deploy healthcheck at `/api/health`, which verifies database
connectivity, so a bad `DATABASE_URL` fails the deploy instead of serving errors.

One caveat for hosted deploys: Google is more likely to rate-limit or challenge
requests coming from datacenter IPs than from a home connection. At a few
imports a day this hasn't been an issue, but it's the most likely thing to break
first.

## Using it

- **Paste a link** on the home page. In Google Maps: open the list → *Share* →
  copy link. The list must be shared for it to be readable.
- **Fetch details** enriches every place lacking Google data. Safe to re-run; it
  only fetches what's missing, so a partial failure costs nothing to retry.
- **Search / category / status filters**, and click any column header to sort.
- **Columns** toggles visibility. Lat/Lng, Hours and business status are hidden
  by default.
- **My status / Tags / My note** are your own annotations, saved as you edit.
- **Export CSV** gives the full table including your annotations.
- **Import a Takeout CSV** as a fallback if a link won't read.

## Architecture

```
src/
  app/
    page.tsx                     home: paste box, CSV fallback, recent lists
    list/[id]/page.tsx           a list's table (server-rendered)
    api/
      health/route.ts            deploy healthcheck (app + database)
      lists/route.ts             GET by ids · POST import (link or CSV)
      lists/[id]/route.ts        GET rows · PATCH rename · DELETE
      lists/[id]/enrich/route.ts POST run enrichment
      lists/[id]/export/route.ts GET CSV download
      entries/[id]/route.ts      PATCH annotations · DELETE
  components/
    ListView.tsx                 list page shell: actions, banners, edit overlay
    PlacesTable.tsx              TanStack Table grid
  lib/
    gmaps-list.ts                reads a shared list from Google
    import.ts                    share link / CSV → database
    db.ts                        Postgres schema + queries
    places.ts                    Places API (New) client
    enrich.ts                    enrichment orchestration
    takeout.ts                   Takeout CSV parsing
    maps-url.ts                  extracts Place ID / CID / coords from Maps URLs
    recent.ts                    browser-local list shortcuts
    types.ts                     shared types
scripts/
  test-db.mts                    every query, against in-memory Postgres
  test-list-fetch.mts            live read of a real shared list
  test-import.mts                end-to-end import into in-memory Postgres
```

Three tables: `lists`, `places`, and `list_entries` joining them. Places are
keyed by Google Place ID and **shared across lists**, so a restaurant saved in
three lists is only enriched once. `list_entries` carries the per-list data —
the note from the shared list plus your tags, status and rating.

Because the share link already gives us address and coordinates, those are
seeded immediately and the table is useful before you spend anything on
enrichment.

### How a place is resolved

Enrichment tries three routes, cheapest and most precise first:

1. **Place Details** — when the source carried a real Place ID. Takeout CSVs
   often do; share links never do.
2. **Nearby Search** on the place's own map pin, matched by name. Share links
   always carry coordinates, so this is the usual path. It beats a text search
   because the pin identifies the exact branch of a chain, and it works even
   when the list has no address — a single coordinate is unambiguous where
   "Blue Bottle Coffee" is not.
3. **Text search** on name plus address, for anything without coordinates or
   where no nearby result's name matched.

Name matching in step 2 ignores case, punctuation, accents and a leading
"The", and accepts containment ("Hako" vs "Hako Sushi") — but nothing looser.
One address can host a dozen businesses, so an uncertain match falls through to
step 3 rather than guessing.

### Quotas

Google meters each of these separately: `PlaceDetailsRequest`,
`SearchNearbyRequest` and `SearchTextRequest` all have their own per-day limits.
New Cloud projects get modest defaults (100/day is common) and can't always
raise them.

Because steps 2 and 3 draw from different buckets, exhausting one doesn't stop
the run — a quota error on Nearby Search falls through to text search. A quota
error with no route left aborts the run and says so, rather than burning the
remainder of the list on the same failure.

Enrichment always resumes: places are only queued when they have no Google data
yet, so retrying after a quota reset costs only what's still missing.

Initial page data is server-rendered; the client keeps an overlay of in-flight
edits merged over the server rows, which is why the table stays responsive
without a data-fetching effect.

### Testing

```bash
npm run check:db                 # is DATABASE_URL reachable? what's in it?
npm run check:places             # does the API key work? (one request)
npm run check:nearby -- <url> 8  # how well does coordinate matching do on a list?

npm run test:db                  # offline: every query against pg-mem
npm run test:list                # live: read a real shared list from Google
npm run test:import              # live: full import path end to end
npm run test:list -- <url>       # point either live test at your own list
```

The `check:` scripts diagnose configuration and print an actionable hint on
failure — reach for them first when something won't connect. `test:db` is
offline and fast; the two live tests hit Google and are what tell you whether
their internal list format has changed.

### Connecting to Railway's Postgres from your machine

`DATABASE_URL` in Railway's own variables uses `postgres.railway.internal:5432`,
which only resolves inside Railway. For local development you need the **public**
URL, which exists only once a TCP proxy is enabled: Postgres service →
*Settings → Public Networking → TCP Proxy* (internal port `5432`). Railway then
provisions a host like `<name>.proxy.rlwy.net` on a random external port and
adds `DATABASE_PUBLIC_URL` to the service's variables.

If that variable shows `${{PGUSER}}`-style placeholders, you've copied the
template rather than the resolved value — assemble it from `PGUSER`,
`PGPASSWORD`, `RAILWAY_TCP_PROXY_DOMAIN`, `RAILWAY_TCP_PROXY_PORT` and
`PGDATABASE`. `npm run check:db` will tell you which part is wrong.

Note that this points local development at your **production** database — data
you import locally shows up in the deployed app.

## Roadmap

- Map view alongside the table.
- Distance-from-a-point column.
- Merging and diffing lists.
- Paging for lists over 500 places (the current page size).

## Notes on dependencies

- **No headless browser.** An earlier version used Playwright; testing showed
  the JSON endpoint works over plain HTTP, so Chromium and the Dockerfile it
  would have required are unnecessary.
- **`pg` with hand-written SQL**, no ORM. The schema is three tables.
- **TanStack Table is pinned to v8.** v9 shipped a rewritten API (`useTable`
  rather than `useReactTable`); this code targets v8.
