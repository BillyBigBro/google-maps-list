/**
 * Google Maps URLs come in several shapes depending on how the link was made.
 * We pull out whatever identifiers are present so enrichment can prefer an
 * exact Place Details lookup over a fuzzy text search.
 */
export type ParsedMapsUrl = {
  /** Google Place ID ("ChIJ…"), the only identifier the Places API accepts directly. */
  placeId: string | null;
  /** Legacy customer ID. Not usable by the Places API, but useful as a link. */
  cid: string | null;
  /** Hex feature ID pair ("0x…:0x…") embedded in /data= segments. */
  ftid: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
};

const EMPTY: ParsedMapsUrl = {
  placeId: null,
  cid: null,
  ftid: null,
  name: null,
  lat: null,
  lng: null,
};

export function isShortMapsLink(url: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(url.trim());
}

/**
 * Short links (maps.app.goo.gl/…) hide the real URL behind a redirect.
 * Following it costs one request and yields the full, parseable URL.
 */
export async function resolveShortLink(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // Google serves a barebones redirect page to unknown agents; a normal
      // browser UA gets the canonical URL.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    },
  });
  return res.url || url;
}

export function parseMapsUrl(raw: string): ParsedMapsUrl {
  if (!raw) return EMPTY;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return EMPTY;
  }

  const result: ParsedMapsUrl = { ...EMPTY };
  const href = url.href;

  // ?query_place_id=ChIJ… / ?place_id=ChIJ… / q=place_id:ChIJ…
  result.placeId =
    url.searchParams.get("query_place_id") ??
    url.searchParams.get("place_id") ??
    matchOne(url.searchParams.get("q") ?? "", /^place_id:(.+)$/) ??
    matchOne(href, /!1s(ChIJ[\w-]+)/);

  result.cid = url.searchParams.get("cid") ?? matchOne(href, /[?&]cid=(\d+)/);

  result.ftid =
    url.searchParams.get("ftid") ?? matchOne(href, /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);

  // /maps/place/Some+Place+Name/@…
  const nameSegment = matchOne(url.pathname, /\/maps\/place\/([^/@]+)/);
  if (nameSegment) {
    result.name = safeDecode(nameSegment).replace(/\+/g, " ").trim() || null;
  }
  if (!result.name) {
    const query = url.searchParams.get("query") ?? url.searchParams.get("q");
    if (query && !query.startsWith("place_id:")) result.name = query.trim() || null;
  }

  // Coordinates: "!3d<lat>!4d<lng>" is the place pin; "@lat,lng,zoom" is the
  // viewport centre, which is close enough when the pin form is absent.
  const pin = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const viewport = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const coords = pin ?? viewport;
  if (coords) {
    result.lat = Number(coords[1]);
    result.lng = Number(coords[2]);
  }

  return result;
}

function matchOne(input: string, pattern: RegExp): string | null {
  const m = input.match(pattern);
  return m ? m[1] : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
