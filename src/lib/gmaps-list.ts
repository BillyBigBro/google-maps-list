/**
 * Reads a shared Google Maps list.
 *
 * Maps has no public API for user lists, but the web client fetches list
 * contents from an internal JSON endpoint that works over plain HTTP — no
 * browser, no cookies, no auth. We resolve the share link to get the list id,
 * then call that endpoint and parse the (deeply nested, positional) response.
 *
 * This is undocumented and can change without notice. Every field access is
 * defensive, and callers should treat a parse failure as "ask the user for a
 * CSV instead" rather than a bug.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** Anti-JSON-hijacking guard Google prefixes onto these payloads. */
const JSON_GUARD = /^\)\]\}'\s*/;

export type ScrapedPlace = {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  note: string | null;
  /** "0x…:0x…" feature id, the identifier Maps URLs use. */
  ftid: string | null;
  /** Decimal customer id — builds a canonical maps.google.com/?cid=… link. */
  cid: string | null;
  mapsUrl: string | null;
};

export type ScrapedList = {
  listId: string;
  name: string | null;
  /** Display name of the account that owns the list, when Google includes it. */
  owner: string | null;
  places: ScrapedPlace[];
};

export class ListFetchError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ListFetchError";
  }
}

/* ------------------------------------------------------------- list id */

/**
 * The list id appears as `!2s<id>` (in a /maps/@ data blob) or as a path
 * segment of /maps/placelists/list/<id>.
 */
export function extractListId(url: string): string | null {
  return (
    url.match(/\/maps\/placelists\/list\/([A-Za-z0-9_-]{10,})/)?.[1] ??
    url.match(/!2s([A-Za-z0-9_-]{20,})/)?.[1] ??
    null
  );
}

export function looksLikeMapsLink(input: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps)/i.test(
    input.trim(),
  );
}

/** Follows the share-link redirect to the canonical URL containing the list id. */
export async function resolveListUrl(shareUrl: string): Promise<string> {
  const res = await fetch(shareUrl, {
    redirect: "follow",
    headers: { "User-Agent": BROWSER_UA },
  });
  if (!res.ok && res.status !== 200) {
    throw new ListFetchError(
      `Google returned ${res.status} for that link.`,
      "Check that the link is correct and the list is shared.",
    );
  }
  return res.url || shareUrl;
}

/* ------------------------------------------------------------- fetching */

/**
 * The `pb` parameter is a serialised protobuf query. This is the minimal form
 * that returns list entries; `!4i500` is the page size, so lists longer than
 * 500 places would need paging.
 */
function buildPb(listId: string): string {
  return [
    "!1m6",
    `!1s${listId}`,
    "!2e3",
    "!3m1",
    "!1e1",
    "!3m1",
    "!1e9",
    "!2e2",
    "!3e2",
    "!4i500",
    "!28e2",
    "!16b1",
  ].join("");
}

async function fetchListPayload(listId: string): Promise<unknown> {
  const url =
    "https://www.google.com/maps/preview/entitylist/getlist" +
    `?authuser=0&hl=en&gl=us&pb=${encodeURIComponent(buildPb(listId))}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new ListFetchError(
      `Google's list endpoint returned ${res.status}.`,
      "The list may be private, or Google may have changed their API.",
    );
  }

  const text = await res.text();
  try {
    return JSON.parse(text.replace(JSON_GUARD, ""));
  } catch {
    throw new ListFetchError(
      "Google returned a response we couldn't parse.",
      "This usually means their internal format changed. Import a Takeout CSV instead.",
    );
  }
}

/* -------------------------------------------------------------- parsing */

const at = (node: unknown, ...path: number[]): unknown => {
  let cur = node;
  for (const i of path) {
    if (!Array.isArray(cur)) return null;
    cur = cur[i];
  }
  return cur ?? null;
};

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Google stores the feature id as two SIGNED 64-bit integers (as strings).
 * Reinterpreting them as unsigned gives the familiar `0x…:0x…` pair, and the
 * second half is the CID used by maps.google.com/?cid=.
 */
function decodeFeatureId(pair: unknown): { ftid: string | null; cid: string | null } {
  if (!Array.isArray(pair) || pair.length < 2) return { ftid: null, cid: null };

  // 2^64, written without a BigInt literal so the compile target doesn't matter.
  const TWO_64 = BigInt("18446744073709551616");
  const ZERO = BigInt(0);

  const toUnsigned = (raw: unknown): bigint | null => {
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    try {
      const signed = BigInt(raw);
      return signed < ZERO ? signed + TWO_64 : signed;
    } catch {
      return null;
    }
  };

  const high = toUnsigned(pair[0]);
  const low = toUnsigned(pair[1]);
  if (high === null || low === null) return { ftid: null, cid: null };

  return {
    ftid: `0x${high.toString(16)}:0x${low.toString(16)}`,
    cid: low.toString(10),
  };
}

export function parseListPayload(payload: unknown, listId: string): ScrapedList {
  const entries = at(payload, 0, 8);
  if (!Array.isArray(entries)) {
    throw new ListFetchError(
      "That link didn't contain any places we could read.",
      "Make sure the list is shared publicly — private lists aren't readable.",
    );
  }

  const places: ScrapedPlace[] = [];

  for (const entry of entries) {
    const name = asString(at(entry, 2));
    if (!name) continue;

    const detail = at(entry, 1);
    const { ftid, cid } = decodeFeatureId(at(detail, 6));

    places.push({
      name,
      address: asString(at(detail, 4)),
      lat: asNumber(at(detail, 5, 2)),
      lng: asNumber(at(detail, 5, 3)),
      note: asString(at(entry, 3)),
      ftid,
      cid,
      mapsUrl: cid ? `https://maps.google.com/?cid=${cid}` : null,
    });
  }

  return {
    listId,
    // Positional, and verified against a live payload: [0][4] is the list
    // title and [0][3][0] is the owner's display name.
    name: asString(at(payload, 0, 4)),
    owner: asString(at(payload, 0, 3, 0)),
    places,
  };
}

/* --------------------------------------------------------------- public */

/** Share link in, places out. */
export async function fetchSharedList(shareUrl: string): Promise<ScrapedList> {
  if (!looksLikeMapsLink(shareUrl)) {
    throw new ListFetchError(
      "That doesn't look like a Google Maps link.",
      "Paste a link like https://maps.app.goo.gl/… from Maps' Share button.",
    );
  }

  const resolved = await resolveListUrl(shareUrl);
  const listId = extractListId(resolved);

  if (!listId) {
    throw new ListFetchError(
      "That link doesn't point to a Maps list.",
      "Open the list in Google Maps, tap Share, and copy that link.",
    );
  }

  const parsed = parseListPayload(await fetchListPayload(listId), listId);

  if (parsed.places.length === 0) {
    throw new ListFetchError(
      "That list appears to be empty.",
      "If it isn't, the list may not be shared publicly.",
    );
  }

  return parsed;
}
