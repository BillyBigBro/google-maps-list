import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type QueryResultRow } from "pg";
import type { ListEntry, ListRow, Place, PlaceList, PlaceStatus } from "./types";

/**
 * Railway injects DATABASE_URL when you add the Postgres plugin. Locally,
 * point it at any Postgres instance.
 */
const CONNECTION_STRING = process.env.DATABASE_URL;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source      TEXT NOT NULL,
  source_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS places (
  id                 TEXT PRIMARY KEY,
  place_id           TEXT UNIQUE,
  name               TEXT NOT NULL,
  formatted_address  TEXT,
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  primary_type       TEXT,
  types              JSONB NOT NULL DEFAULT '[]'::jsonb,
  rating             DOUBLE PRECISION,
  user_rating_count  INTEGER,
  price_level        TEXT,
  phone              TEXT,
  website            TEXT,
  google_maps_uri    TEXT,
  opening_hours      JSONB,
  business_status    TEXT,
  enriched_at        TIMESTAMPTZ,
  enrich_error       TEXT
);

CREATE TABLE IF NOT EXISTS list_entries (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  place_ref    TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  source_title TEXT NOT NULL,
  source_note  TEXT,
  source_url   TEXT,
  tags         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status       TEXT NOT NULL DEFAULT 'none',
  my_rating    INTEGER,
  my_note      TEXT,
  position     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entries_list ON list_entries(list_id);
CREATE INDEX IF NOT EXISTS idx_places_place_id ON places(place_id);
`;

const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A list's id is also its share token — it appears in the URL and anyone
 * holding it can view and edit that list. 16 characters of this alphabet is
 * ~93 bits of entropy, so it is not practically guessable. Lookalike
 * characters (0/O, 1/l/I) are excluded so ids survive being read aloud.
 */
export function newListId(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
}

/**
 * Next re-evaluates modules on hot reload, so the pool is cached on globalThis
 * to avoid exhausting Postgres connections in development.
 */
const globalForDb = globalThis as unknown as {
  __gmapsPool?: Pool;
  __gmapsReady?: Promise<void>;
};

export function pool(): Pool {
  if (!globalForDb.__gmapsPool) {
    if (!CONNECTION_STRING) {
      throw new Error(
        "DATABASE_URL is not set. Add a Postgres connection string to .env.local (or let Railway inject it in production).",
      );
    }
    globalForDb.__gmapsPool = new Pool({
      connectionString: CONNECTION_STRING,
      // Railway's managed Postgres terminates TLS with a self-signed cert.
      ssl: needsSsl(CONNECTION_STRING) ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return globalForDb.__gmapsPool;
}

function needsSsl(url: string): boolean {
  if (/sslmode=disable/.test(url)) return false;
  return !/localhost|127\.0\.0\.1/.test(url);
}

/** Applied once per process, before the first query. */
export function ready(): Promise<void> {
  globalForDb.__gmapsReady ??= pool()
    .query(SCHEMA)
    .then(() => undefined);
  return globalForDb.__gmapsReady;
}

async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ready();
  const result = await pool().query<T>(sql, params);
  return result.rows;
}

/* ---------------------------------------------------------------- mapping */

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);

/** JSONB comes back already parsed; TEXT columns and defaults may not. */
function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function toPlace(r: Row): Place {
  return {
    id: String(r.id),
    placeId: str(r.place_id),
    name: String(r.name),
    formattedAddress: str(r.formatted_address),
    lat: num(r.lat),
    lng: num(r.lng),
    primaryType: str(r.primary_type),
    types: parseJson<string[]>(r.types, []),
    rating: num(r.rating),
    userRatingCount: num(r.user_rating_count),
    priceLevel: str(r.price_level),
    phone: str(r.phone),
    website: str(r.website),
    googleMapsUri: str(r.google_maps_uri),
    openingHours: parseJson<Place["openingHours"]>(r.opening_hours, null),
    businessStatus: str(r.business_status),
    enrichedAt: iso(r.enriched_at),
    enrichError: str(r.enrich_error),
  };
}

function toEntry(r: Row): ListEntry {
  return {
    id: String(r.entry_id),
    listId: String(r.list_id),
    sourceTitle: String(r.source_title),
    sourceNote: str(r.source_note),
    sourceUrl: str(r.source_url),
    tags: parseJson<string[]>(r.tags, []),
    status: (str(r.status) ?? "none") as PlaceStatus,
    myRating: num(r.my_rating),
    myNote: str(r.my_note),
    position: Number(r.position ?? 0),
  };
}

/* ------------------------------------------------------------------ lists */

export async function createList(input: {
  name: string;
  source: PlaceList["source"];
  sourceUrl?: string | null;
}): Promise<string> {
  const id = newListId();
  await query(
    `INSERT INTO lists (id, name, source, source_url) VALUES ($1, $2, $3, $4)`,
    [id, input.name, input.source, input.sourceUrl ?? null],
  );
  return id;
}

const LIST_SELECT = `
  SELECT l.id, l.name, l.source, l.source_url, l.created_at,
         COUNT(e.id) AS entry_count,
         COUNT(p.enriched_at) AS enriched_count
    FROM lists l
    LEFT JOIN list_entries e ON e.list_id = l.id
    LEFT JOIN places p       ON p.id = e.place_ref
`;

function toList(r: Row): PlaceList {
  return {
    id: String(r.id),
    name: String(r.name),
    source: String(r.source) as PlaceList["source"],
    sourceUrl: str(r.source_url),
    createdAt: iso(r.created_at) ?? "",
    entryCount: Number(r.entry_count ?? 0),
    enrichedCount: Number(r.enriched_count ?? 0),
  };
}

export async function getList(id: string): Promise<PlaceList | null> {
  const rows = await query(
    `${LIST_SELECT} WHERE l.id = $1
      GROUP BY l.id, l.name, l.source, l.source_url, l.created_at`,
    [id],
  );
  return rows[0] ? toList(rows[0]) : null;
}

/** Bulk lookup for the "recent lists" strip, which is driven by client storage. */
export async function getListsByIds(ids: string[]): Promise<PlaceList[]> {
  if (ids.length === 0) return [];
  // Explicit placeholders rather than `= ANY($1)`: array parameters depend on
  // the driver inferring the column type, which is fragile across engines.
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query(
    `${LIST_SELECT} WHERE l.id IN (${placeholders})
      GROUP BY l.id, l.name, l.source, l.source_url, l.created_at
      ORDER BY l.created_at DESC`,
    ids,
  );
  return rows.map(toList);
}

/** Existing list for this share URL, so re-pasting a link doesn't duplicate it. */
export async function findListBySourceUrl(sourceUrl: string): Promise<PlaceList | null> {
  const rows = await query(
    `${LIST_SELECT} WHERE l.source_url = $1
      GROUP BY l.id, l.name, l.source, l.source_url, l.created_at
      ORDER BY l.created_at DESC LIMIT 1`,
    [sourceUrl],
  );
  return rows[0] ? toList(rows[0]) : null;
}

export async function deleteList(id: string): Promise<void> {
  // Drop places that were only referenced by this list, then the list itself.
  await query(
    `DELETE FROM places
      WHERE id IN (SELECT place_ref FROM list_entries WHERE list_id = $1)
        AND id NOT IN (SELECT place_ref FROM list_entries WHERE list_id <> $1)`,
    [id],
  );
  await query(`DELETE FROM lists WHERE id = $1`, [id]);
}

export async function renameList(id: string, name: string): Promise<void> {
  await query(`UPDATE lists SET name = $1 WHERE id = $2`, [name, id]);
}

/* ----------------------------------------------------------------- places */

/**
 * Places are shared across lists so a restaurant saved in three lists is only
 * ever enriched once. A row with a known placeId is reused; unresolved rows
 * (no placeId yet) always get their own row.
 */
export async function upsertPlaceStub(input: {
  placeId: string | null;
  name: string;
}): Promise<string> {
  if (input.placeId) {
    const existing = await query(`SELECT id FROM places WHERE place_id = $1`, [
      input.placeId,
    ]);
    if (existing.length > 0) return String(existing[0].id);
  }
  const id = randomUUID();
  await query(`INSERT INTO places (id, place_id, name) VALUES ($1, $2, $3)`, [
    id,
    input.placeId,
    input.name,
  ]);
  return id;
}

/** Seeds what the share link already told us, so the table is useful pre-enrichment. */
export async function seedPlaceFromList(
  placeRef: string,
  data: { address: string | null; lat: number | null; lng: number | null },
): Promise<void> {
  await query(
    `UPDATE places
        SET formatted_address = COALESCE(formatted_address, $1),
            lat = COALESCE(lat, $2),
            lng = COALESCE(lng, $3)
      WHERE id = $4`,
    [data.address, data.lat, data.lng, placeRef],
  );
}

export async function updatePlaceFromGoogle(
  placeRef: string,
  data: Partial<Place> & { placeId?: string | null },
): Promise<void> {
  await query(
    `UPDATE places SET
       place_id          = COALESCE($1, place_id),
       name              = COALESCE($2, name),
       formatted_address = $3,
       lat = $4, lng = $5,
       primary_type      = $6,
       types             = $7::jsonb,
       rating            = $8,
       user_rating_count = $9,
       price_level       = $10,
       phone             = $11,
       website           = $12,
       google_maps_uri   = $13,
       opening_hours     = $14::jsonb,
       business_status   = $15,
       enriched_at       = NOW(),
       enrich_error      = NULL
     WHERE id = $16`,
    [
      data.placeId ?? null,
      data.name ?? null,
      data.formattedAddress ?? null,
      data.lat ?? null,
      data.lng ?? null,
      data.primaryType ?? null,
      JSON.stringify(data.types ?? []),
      data.rating ?? null,
      data.userRatingCount ?? null,
      data.priceLevel ?? null,
      data.phone ?? null,
      data.website ?? null,
      data.googleMapsUri ?? null,
      data.openingHours ? JSON.stringify(data.openingHours) : null,
      data.businessStatus ?? null,
      placeRef,
    ],
  );
}

export async function markPlaceEnrichFailed(
  placeRef: string,
  message: string,
): Promise<void> {
  await query(`UPDATE places SET enrich_error = $1 WHERE id = $2`, [
    message.slice(0, 500),
    placeRef,
  ]);
}

/** Places in a list that have never been successfully enriched. */
export async function getUnenrichedPlaces(
  listId: string,
): Promise<
  Array<{
    placeRef: string;
    placeId: string | null;
    title: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
  }>
> {
  const rows = await query(
    `SELECT p.id AS place_ref, p.place_id, e.source_title,
            p.formatted_address, p.lat, p.lng
       FROM list_entries e
       JOIN places p ON p.id = e.place_ref
      WHERE e.list_id = $1 AND p.enriched_at IS NULL
      ORDER BY e.position`,
    [listId],
  );
  return rows.map((r) => ({
    placeRef: String(r.place_ref),
    placeId: str(r.place_id),
    title: String(r.source_title),
    address: str(r.formatted_address),
    lat: num(r.lat),
    lng: num(r.lng),
  }));
}

/** Source URLs live on the entry, not the place; enrichment needs them for bias. */
export async function getEntryUrlsByPlaceRef(
  listId: string,
): Promise<Map<string, string>> {
  const rows = await query(
    `SELECT place_ref, source_url FROM list_entries
      WHERE list_id = $1 AND source_url IS NOT NULL`,
    [listId],
  );
  return new Map(rows.map((r) => [String(r.place_ref), String(r.source_url)]));
}

/* ---------------------------------------------------------------- entries */

export async function addEntry(input: {
  listId: string;
  placeRef: string;
  sourceTitle: string;
  sourceNote?: string | null;
  sourceUrl?: string | null;
  position: number;
}): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO list_entries
       (id, list_id, place_ref, source_title, source_note, source_url, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.listId,
      input.placeRef,
      input.sourceTitle,
      input.sourceNote ?? null,
      input.sourceUrl ?? null,
      input.position,
    ],
  );
  return id;
}

export async function getListRows(listId: string): Promise<ListRow[]> {
  const rows = await query(
    `SELECT e.id AS entry_id, e.list_id, e.source_title, e.source_note,
            e.source_url, e.tags, e.status, e.my_rating, e.my_note, e.position,
            p.*
       FROM list_entries e
       JOIN places p ON p.id = e.place_ref
      WHERE e.list_id = $1
      ORDER BY e.position`,
    [listId],
  );

  return rows.map((r) => ({ ...toEntry(r), place: toPlace(r) }));
}

const USER_FIELDS = {
  tags: "tags",
  status: "status",
  myRating: "my_rating",
  myNote: "my_note",
} as const;

export async function updateEntry(
  entryId: string,
  patch: Partial<Pick<ListEntry, "tags" | "status" | "myRating" | "myNote">>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(USER_FIELDS)) {
    if (!(key in patch)) continue;
    const value = patch[key as keyof typeof USER_FIELDS];
    const isJson = key === "tags";
    values.push(isJson ? JSON.stringify(value ?? []) : value);
    sets.push(`${column} = $${values.length}${isJson ? "::jsonb" : ""}`);
  }
  if (sets.length === 0) return;

  values.push(entryId);
  await query(
    `UPDATE list_entries SET ${sets.join(", ")} WHERE id = $${values.length}`,
    values,
  );
}

export async function deleteEntry(entryId: string): Promise<void> {
  await query(`DELETE FROM list_entries WHERE id = $1`, [entryId]);
}
