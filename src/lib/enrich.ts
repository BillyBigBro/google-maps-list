import {
  getEntryUrlsByPlaceRef,
  getUnenrichedPlaces,
  markPlaceEnrichFailed,
  updatePlaceFromGoogle,
} from "./db";
import {
  fetchPlaceDetails,
  PlacesApiError,
  searchPlaceByText,
  searchPlaceNearby,
} from "./places";
import { parseMapsUrl } from "./maps-url";

export type EnrichResult = {
  /** How many places needed enriching when the run started. */
  pending: number;
  attempted: number;
  enriched: number;
  failed: number;
  /** Set when the run stopped early because every request would fail the same way. */
  abortedReason: string | null;
  errors: string[];
};

type Pending = Awaited<ReturnType<typeof getUnenrichedPlaces>>[number];

/** Google's default quota is generous but not unlimited; stay well under it. */
const CONCURRENCY = 5;

/**
 * Enriches every not-yet-enriched place in a list. Already-enriched places are
 * skipped entirely, so re-running after a partial failure only pays for what
 * is still missing.
 */
export async function enrichList(listId: string): Promise<EnrichResult> {
  const pending = await getUnenrichedPlaces(listId);
  const urlByPlaceRef = await getEntryUrlsByPlaceRef(listId);

  const result: EnrichResult = {
    pending: pending.length,
    attempted: 0,
    enriched: 0,
    failed: 0,
    abortedReason: null,
    errors: [],
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
    while (cursor < pending.length && result.abortedReason === null) {
      const item = pending[cursor++];
      result.attempted++;
      try {
        const data = await lookup(item, urlByPlaceRef.get(item.placeRef));
        if (data) {
          await updatePlaceFromGoogle(item.placeRef, data);
          result.enriched++;
        } else {
          await markPlaceEnrichFailed(item.placeRef, "No match found on Google Maps");
          result.failed++;
          result.errors.push(`${item.title}: no match found`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markPlaceEnrichFailed(item.placeRef, message);
        result.failed++;
        result.errors.push(`${item.title}: ${message}`);

        // Auth and quota failures will hit every remaining row identically —
        // stop rather than burn the rest of the list on the same error, and
        // say so, since "0 of 37" otherwise implies all 37 were tried.
        if (err instanceof PlacesApiError && [401, 403, 429].includes(err.status)) {
          result.abortedReason =
            err.status === 429
              ? `Google rate-limited the request: ${message} Quotas reset at midnight Pacific time, and the daily limit can be raised in Google Cloud Console → APIs & Services → Quotas. Already-enriched places are kept, so retrying only costs the ones still missing.`
              : `Google rejected the API key (HTTP ${err.status}): ${message}`;
          // Logged server-side too — Railway's deploy logs are where you'd
          // look when the browser only shows a summary.
          console.error("[enrich] aborting run:", err.status, message);
        }
      }
    }
  });

  await Promise.all(workers);
  // Dedupe the error list so one systemic failure doesn't produce 200 lines.
  result.errors = [...new Set(result.errors)].slice(0, 25);
  return result;
}

/**
 * Three routes to the same place, cheapest and most precise first:
 *
 *   1. Place Details, when the source gave us a real Place ID (Takeout CSVs do).
 *   2. Nearby Search on the place's own pin, matched by name. Share links
 *      always carry coordinates, so this is the usual path.
 *   3. Text search, for anything without coordinates or without a name match.
 *
 * Steps 2 and 3 bill to different quota metrics, so when one is exhausted the
 * other still works — which is why a quota error here falls through instead of
 * giving up.
 */
async function lookup(item: Pending, sourceUrl: string | undefined) {
  if (item.placeId) return fetchPlaceDetails(item.placeId);

  const parsed = sourceUrl ? parseMapsUrl(sourceUrl) : null;
  const lat = item.lat ?? parsed?.lat ?? null;
  const lng = item.lng ?? parsed?.lng ?? null;
  const hasCoords = lat != null && lng != null;

  if (hasCoords) {
    try {
      const nearby = await searchPlaceNearby(item.title, { lat, lng });
      if (nearby) return nearby;
    } catch (err) {
      // A quota wall on this metric shouldn't end the run — text search draws
      // from a different one. Anything else is a real error worth surfacing.
      if (!(err instanceof PlacesApiError) || err.status !== 429) throw err;
    }
  }

  const queryText = item.address ? `${item.title}, ${item.address}` : item.title;
  return searchPlaceByText(queryText, hasCoords ? { lat, lng } : undefined);
}
