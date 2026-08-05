/**
 * Exercises every query in src/lib/db.ts against an in-memory Postgres, so the
 * SQL is verified without needing a live database.
 *
 *   npx tsx scripts/test-db.ts
 */
import { newDb } from "pg-mem";

const mem = newDb();
const pg = mem.adapters.createPg();
// The data layer builds its own Pool from DATABASE_URL; hand it pg-mem's instead.
process.env.DATABASE_URL = "postgres://localhost/memory";
const globalForDb = globalThis as unknown as { __gmapsPool?: unknown };
globalForDb.__gmapsPool = new pg.Pool();

const db = await import("../src/lib/db");

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

console.log("\nschema + lists");
const listId = await db.createList({ name: "Want to go", source: "takeout" });
check("createList returns an id", typeof listId === "string" && listId.length > 0);

let lists = await db.getLists();
check("getLists returns one list", lists.length === 1, lists);
check("entryCount is 0 for an empty list", lists[0]?.entryCount === 0, lists[0]);
check("createdAt is an ISO string", typeof lists[0]?.createdAt === "string", lists[0]);

console.log("\nplaces + dedupe");
const refA = await db.upsertPlaceStub({ placeId: "ChIJ_katz", name: "Katz's" });
const refB = await db.upsertPlaceStub({ placeId: "ChIJ_katz", name: "Katz's again" });
check("same place_id reuses the row", refA === refB, { refA, refB });

const refC = await db.upsertPlaceStub({ placeId: null, name: "Unresolved" });
check("null place_id gets its own row", refC !== refA);

console.log("\nentries");
await db.addEntry({
  listId,
  placeRef: refA,
  sourceTitle: "Katz's Delicatessen",
  sourceNote: "best pastrami",
  sourceUrl: "https://maps.google.com/?cid=123",
  position: 0,
});
const entryId = await db.addEntry({
  listId,
  placeRef: refC,
  sourceTitle: "Unresolved",
  position: 1,
});

let rows = await db.getListRows(listId);
check("getListRows returns both entries", rows.length === 2, rows.length);
check("rows are ordered by position", rows[0]?.sourceTitle === "Katz's Delicatessen", rows[0]);
check("tags default to an empty array", Array.isArray(rows[0]?.tags) && rows[0].tags.length === 0, rows[0]?.tags);
check("status defaults to none", rows[0]?.status === "none", rows[0]?.status);
check("nested place object is populated", rows[0]?.place?.name === "Katz's", rows[0]?.place);

console.log("\nuser annotations");
await db.updateEntry(entryId, {
  tags: ["deli", "nyc"],
  status: "visited",
  myNote: "go early",
  myRating: 5,
});
rows = await db.getListRows(listId);
const edited = rows.find((r) => r.id === entryId);
check("tags round-trip as an array", JSON.stringify(edited?.tags) === '["deli","nyc"]', edited?.tags);
check("status persists", edited?.status === "visited", edited?.status);
check("myNote persists", edited?.myNote === "go early", edited?.myNote);
check("myRating persists as a number", edited?.myRating === 5, edited?.myRating);

await db.updateEntry(entryId, { status: "want" });
rows = await db.getListRows(listId);
const partial = rows.find((r) => r.id === entryId);
check("partial update leaves other fields intact", partial?.myNote === "go early", partial);

console.log("\nenrichment");
let pending = await db.getUnenrichedPlaces(listId);
check("both places start unenriched", pending.length === 2, pending.length);

await db.updatePlaceFromGoogle(refA, {
  placeId: "ChIJ_katz",
  name: "Katz's Delicatessen",
  formattedAddress: "205 E Houston St, New York, NY",
  lat: 40.7223,
  lng: -73.9874,
  primaryType: "Deli",
  types: ["restaurant", "food"],
  rating: 4.5,
  userRatingCount: 61234,
  priceLevel: "$$",
  phone: "(212) 254-2246",
  website: "https://katzsdelicatessen.com",
  googleMapsUri: "https://maps.google.com/?cid=123",
  openingHours: { weekdayDescriptions: ["Monday: 8 AM–10:45 PM"], openNow: true },
  businessStatus: "OPERATIONAL",
});

rows = await db.getListRows(listId);
const enriched = rows.find((r) => r.place.id === refA);
check("rating stored as a number", enriched?.place.rating === 4.5, enriched?.place.rating);
check("types round-trip as jsonb array", JSON.stringify(enriched?.place.types) === '["restaurant","food"]', enriched?.place.types);
check("openingHours round-trips as an object", enriched?.place.openingHours?.weekdayDescriptions?.[0] === "Monday: 8 AM–10:45 PM", enriched?.place.openingHours);
check("enrichedAt is set", typeof enriched?.place.enrichedAt === "string", enriched?.place.enrichedAt);
check("lat/lng are numbers", enriched?.place.lat === 40.7223 && enriched?.place.lng === -73.9874, enriched?.place);

pending = await db.getUnenrichedPlaces(listId);
check("only the unenriched place remains pending", pending.length === 1, pending);

await db.markPlaceEnrichFailed(refC, "No match found");
rows = await db.getListRows(listId);
check("enrich error is recorded", rows.find((r) => r.place.id === refC)?.place.enrichError === "No match found");

lists = await db.getLists();
check("enrichedCount reflects one enriched place", lists[0]?.enrichedCount === 1, lists[0]);
check("entryCount reflects two entries", lists[0]?.entryCount === 2, lists[0]);

console.log("\nsource urls");
const urls = await db.getEntryUrlsByPlaceRef(listId);
check("only entries with a url are returned", urls.size === 1, [...urls]);
check("url maps to the right place", urls.get(refA) === "https://maps.google.com/?cid=123", [...urls]);

console.log("\ndeletes");
await db.deleteEntry(entryId);
rows = await db.getListRows(listId);
check("entry is removed", rows.length === 1, rows.length);

const otherListId = await db.createList({ name: "Shared", source: "takeout" });
await db.addEntry({ listId: otherListId, placeRef: refA, sourceTitle: "Katz's", position: 0 });
await db.deleteList(listId);
const remaining = await db.getListRows(otherListId);
check("place shared with another list survives deletion", remaining.length === 1, remaining);
check("deleted list is gone", (await db.getList(listId)) === null);

await db.renameList(otherListId, "Renamed");
check("renameList works", (await db.getList(otherListId))?.name === "Renamed");

console.log(
  failures === 0
    ? "\nAll database checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
