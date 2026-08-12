import {
  addEntry,
  createList,
  findListByGoogleId,
  seedPlaceFromList,
  upsertPlaceStub,
} from "./db";
import {
  extractListId,
  fetchSharedList,
  ListFetchError,
  looksLikeMapsLink,
  resolveListUrl,
} from "./gmaps-list";
import { listNameFromFilename, parseTakeoutCsv } from "./takeout";

export type ImportResult = {
  listId: string;
  imported: number;
  skipped: number;
  /** True when an identical share link had already been imported. */
  reused: boolean;
};

/**
 * Reads a shared Google Maps list and stores it.
 *
 * Re-pasting a link you've already imported reopens that list instead of
 * creating a duplicate — the common case is someone pasting the same link
 * twice rather than wanting two copies.
 */
export async function importFromShareLink(url: string): Promise<ImportResult> {
  if (!looksLikeMapsLink(url)) {
    throw new ListFetchError(
      "That doesn't look like a Google Maps link.",
      "Paste a link like https://maps.app.goo.gl/… from Maps' Share button.",
    );
  }

  // Resolve first: the same list has many URL spellings, and only Google's own
  // list id identifies it reliably. This costs one redirect, not an API call.
  const googleListId = extractListId(await resolveListUrl(url));
  if (!googleListId) {
    throw new ListFetchError(
      "That link doesn't point to a Maps list.",
      "Open the list in Google Maps, tap Share, and copy that link.",
    );
  }

  const existing = await findListByGoogleId(googleListId);
  if (existing) {
    return { listId: existing.id, imported: existing.entryCount, skipped: 0, reused: true };
  }

  const scraped = await fetchSharedList(url);

  const listId = await createList({
    name: scraped.name ?? "Shared list",
    source: "sharelink",
    sourceUrl: url,
    googleListId,
  });

  // Sequential on purpose: upsertPlaceStub dedupes by place_id, and running it
  // concurrently would race two inserts for the same place.
  for (const [index, place] of scraped.places.entries()) {
    const placeRef = await upsertPlaceStub({ placeId: null, name: place.name });
    await seedPlaceFromList(placeRef, {
      address: place.address,
      lat: place.lat,
      lng: place.lng,
    });
    await addEntry({
      listId,
      placeRef,
      sourceTitle: place.name,
      sourceNote: place.note,
      sourceUrl: place.mapsUrl,
      position: index,
    });
  }

  return { listId, imported: scraped.places.length, skipped: 0, reused: false };
}

export async function importFromCsvText(
  csv: string,
  filename: string,
  nameOverride?: string | null,
): Promise<ImportResult> {
  const parsed = parseTakeoutCsv(csv);
  if (parsed.entries.length === 0) {
    throw new Error("That CSV parsed cleanly but contained no places.");
  }

  const listId = await createList({
    name: nameOverride?.trim() || listNameFromFilename(filename),
    source: "takeout",
  });

  for (const [index, entry] of parsed.entries.entries()) {
    const placeRef = await upsertPlaceStub({ placeId: entry.placeId, name: entry.title });
    await addEntry({
      listId,
      placeRef,
      sourceTitle: entry.title,
      sourceNote: entry.note,
      sourceUrl: entry.url,
      position: index,
    });
  }

  return {
    listId,
    imported: parsed.entries.length,
    skipped: parsed.skipped,
    reused: false,
  };
}
