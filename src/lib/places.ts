import type { OpeningHours, Place } from "./types";

const BASE = "https://places.googleapis.com/v1";

/**
 * Every field here is billed. Google groups fields into Essentials / Pro /
 * Enterprise SKUs and charges the highest tier touched by the request, so
 * adding a field can change the price of every lookup. `regularOpeningHours`,
 * `websiteUri` and the phone fields are what push this set past Essentials.
 * Trim this list if you want to cut cost and can live with fewer columns.
 */
const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "rating",
  "userRatingCount",
  "priceLevel",
  "types",
  "primaryTypeDisplayName",
  "regularOpeningHours",
  "nationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "businessStatus",
] as const;

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  types?: string[];
  primaryTypeDisplayName?: { text?: string };
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
};

export type EnrichedPlace = Partial<Place> & { placeId: string | null };

export class PlacesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PlacesApiError";
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new PlacesApiError(
      "GOOGLE_MAPS_API_KEY is not set. Add it to .env.local to enable enrichment.",
      0,
    );
  }
  return key;
}

/** Exact lookup. Preferred whenever the source URL gave us a Place ID. */
export async function fetchPlaceDetails(placeId: string): Promise<EnrichedPlace> {
  const res = await fetch(`${BASE}/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": DETAIL_FIELDS.join(","),
    },
  });

  if (!res.ok) throw await toError(res);
  return mapPlace((await res.json()) as GooglePlace);
}

/**
 * Fuzzy lookup for entries whose URL carried no Place ID. Biasing by the
 * coordinates from the original link makes a big difference for chains.
 */
export async function searchPlaceByText(
  query: string,
  bias?: { lat: number; lng: number },
): Promise<EnrichedPlace | null> {
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 1,
  };

  if (bias) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.lat, longitude: bias.lng },
        radius: 500.0,
      },
    };
  }

  const res = await fetch(`${BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": DETAIL_FIELDS.map((f) => `places.${f}`).join(","),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw await toError(res);

  const json = (await res.json()) as { places?: GooglePlace[] };
  const first = json.places?.[0];
  return first ? mapPlace(first) : null;
}

/**
 * Looks a place up by its exact coordinates rather than by name.
 *
 * Shared lists give us each place's own map pin, so a tight radius plus a name
 * match identifies the business precisely — better than a text search, which
 * has to guess between branches of a chain. It also bills to a different quota
 * metric (SearchNearbyRequest) than searchText, which matters when one of them
 * runs dry.
 *
 * Returns null unless a returned place's name actually matches: a single
 * address can host a dozen businesses, so a confident match or nothing.
 */
export async function searchPlaceNearby(
  name: string,
  center: { lat: number; lng: number },
  radiusMetres = 50,
): Promise<EnrichedPlace | null> {
  const res = await fetch(`${BASE}/places:searchNearby`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": DETAIL_FIELDS.map((f) => `places.${f}`).join(","),
    },
    body: JSON.stringify({
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: radiusMetres,
        },
      },
      maxResultCount: 10,
      rankPreference: "DISTANCE",
    }),
  });

  if (!res.ok) throw await toError(res);

  const json = (await res.json()) as { places?: GooglePlace[] };
  const match = (json.places ?? []).find((p) =>
    namesMatch(p.displayName?.text ?? "", name),
  );
  return match ? mapPlace(match) : null;
}

/** Tolerant of punctuation, case, accents and "The …" — but not of guessing. */
function namesMatch(a: string, b: string): boolean {
  const normalise = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/^the\s+/, "")
      .replace(/[^a-z0-9]/g, "");

  const left = normalise(a);
  const right = normalise(b);
  if (!left || !right) return false;

  // Containment covers "Hako" vs "Hako Sushi" without matching unrelated names.
  return left === right || left.includes(right) || right.includes(left);
}

function mapPlace(p: GooglePlace): EnrichedPlace {
  const hours: OpeningHours | null = p.regularOpeningHours
    ? {
        weekdayDescriptions: p.regularOpeningHours.weekdayDescriptions ?? [],
        openNow: p.regularOpeningHours.openNow,
      }
    : null;

  return {
    placeId: p.id ?? null,
    name: p.displayName?.text ?? undefined,
    formattedAddress: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    primaryType: p.primaryTypeDisplayName?.text ?? p.types?.[0] ?? null,
    types: p.types ?? [],
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
    priceLevel: formatPriceLevel(p.priceLevel),
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    googleMapsUri: p.googleMapsUri ?? null,
    openingHours: hours,
    businessStatus: p.businessStatus ?? null,
  };
}

/** "PRICE_LEVEL_MODERATE" → "$$", so the column sorts and scans cleanly. */
function formatPriceLevel(level: string | undefined): string | null {
  switch (level) {
    case "PRICE_LEVEL_FREE":
      return "Free";
    case "PRICE_LEVEL_INEXPENSIVE":
      return "$";
    case "PRICE_LEVEL_MODERATE":
      return "$$";
    case "PRICE_LEVEL_EXPENSIVE":
      return "$$$";
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "$$$$";
    default:
      return null;
  }
}

async function toError(res: Response): Promise<PlacesApiError> {
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) detail = body.error.message;
  } catch {
    // Non-JSON error body; the status text is the best we have.
  }
  return new PlacesApiError(detail, res.status);
}
