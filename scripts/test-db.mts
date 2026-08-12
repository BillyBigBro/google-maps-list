/**
 * Exercises every query in src/lib/db.ts against an in-memory Postgres, so the
 * SQL is verified without needing a live database.
 *
 *   npm run test:db
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

console.log("\nlist ids (share tokens)");
const ids = new Set(Array.from({ length: 500 }, () => db.newListId()));
check("ids are 16 characters", [...ids][0].length === 16, [...ids][0]);
check("500 generated ids are all unique", ids.size === 500, ids.size);
check(
  "ids avoid lookalike characters",
  [...ids].every((id) => !/[0O1lI]/.test(id)),
);

console.log("\nschema + lists");
const listId = await db.createList({
  name: "Want to go",
  source: "sharelink",
  sourceUrl: "https://maps.app.goo.gl/EXAMPLE",
});
check("createList returns an id", typeof listId === "string" && listId.length === 16);

let list = await db.getList(listId);
check("getList finds it", list?.name === "Want to go", list);
check("entryCount is 0 for an empty list", list?.entryCount === 0, list);
check("createdAt is an ISO string", typeof list?.createdAt === "string", list);
check("unknown id returns null", (await db.getList("nope")) === null);

console.log("\nplaces + dedupe");
const refA = await db.upsertPlaceStub({ placeId: "ChIJ_katz", name: "Katz's" });
const refB = await db.upsertPlaceStub({ placeId: "ChIJ_katz", name: "Katz's again" });
check("same place_id reuses the row", refA === refB, { refA, refB });

const refC = await db.upsertPlaceStub({ placeId: null, name: "Unresolved" });
check("null place_id gets its own row", refC !== refA);

console.log("\nseeding from the shared list");
await db.seedPlaceFromList(refA, {
  address: "205 E Houston St",
  lat: 40.7223,
  lng: -73.9874,
});
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
check("seeded address is visible before enrichment", rows[0]?.place.formattedAddress === "205 E Houston St", rows[0]?.place);
check("seeded coordinates are visible", rows[0]?.place.lat === 40.7223, rows[0]?.place);
check("getListRows returns both entries", rows.length === 2, rows.length);
check("rows are ordered by position", rows[0]?.sourceTitle === "Katz's Delicatessen", rows[0]);
check("tags default to an empty array", Array.isArray(rows[0]?.tags) && rows[0].tags.length === 0);
check("status defaults to none", rows[0]?.status === "none", rows[0]?.status);

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
check(
  "partial update leaves other fields intact",
  rows.find((r) => r.id === entryId)?.myNote === "go early",
);

console.log("\nenrichment");
let pending = await db.getUnenrichedPlaces(listId);
check("both places start unenriched", pending.length === 2, pending.length);
check("pending carries the seeded address for a better search", pending[0]?.address === "205 E Houston St", pending[0]);

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
  openingHours: {
    weekdayDescriptions: ["Monday: 8 AM–10:45 PM"],
    periods: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 22, minute: 45 } }],
  },
  utcOffsetMinutes: -240,
  businessStatus: "OPERATIONAL",
});

rows = await db.getListRows(listId);
const enriched = rows.find((r) => r.place.id === refA);
check("rating stored as a number", enriched?.place.rating === 4.5, enriched?.place.rating);
check("types round-trip as jsonb array", JSON.stringify(enriched?.place.types) === '["restaurant","food"]');
check("openingHours round-trips as an object", enriched?.place.openingHours?.weekdayDescriptions?.[0] === "Monday: 8 AM–10:45 PM");
check(
  "opening periods survive the round trip",
  enriched?.place.openingHours?.periods?.[0]?.close?.minute === 45,
  enriched?.place.openingHours?.periods,
);
check("utc offset round-trips", enriched?.place.utcOffsetMinutes === -240, enriched?.place.utcOffsetMinutes);
check("enrichedAt is set", typeof enriched?.place.enrichedAt === "string");
check("lat/lng are numbers", enriched?.place.lat === 40.7223 && enriched?.place.lng === -73.9874);

pending = await db.getUnenrichedPlaces(listId);
check("only the unenriched place remains pending", pending.length === 1, pending);

await db.markPlaceEnrichFailed(refC, "No match found");
rows = await db.getListRows(listId);
check("enrich error is recorded", rows.find((r) => r.place.id === refC)?.place.enrichError === "No match found");

list = await db.getList(listId);
check("enrichedCount reflects one enriched place", list?.enrichedCount === 1, list);
check("entryCount reflects two entries", list?.entryCount === 2, list);

console.log("\nsource urls");
const urls = await db.getEntryUrlsByPlaceRef(listId);
check("only entries with a url are returned", urls.size === 1, [...urls]);
check("url maps to the right place", urls.get(refA) === "https://maps.google.com/?cid=123");

console.log("\nlookup by id");
const second = await db.createList({ name: "Second", source: "takeout" });
const many = await db.getListsByIds([listId, second, "missing-id"]);
check("getListsByIds returns only the ids that exist", many.length === 2, many.map((l) => l.id));
check("getListsByIds with no ids returns empty", (await db.getListsByIds([])).length === 0);

console.log("\nmerging placeholders that turn out to be the same place");
// Two lists imported from share links: neither knows any Place IDs, so each
// gets its own placeholder row for the same restaurant.
const listA = await db.createList({ name: "A", source: "sharelink" });
const listB = await db.createList({ name: "B", source: "sharelink" });
const stubA = await db.upsertPlaceStub({ placeId: null, name: "Joe's Pizza" });
const stubB = await db.upsertPlaceStub({ placeId: null, name: "Joe's Pizza" });
check("share-link imports create separate placeholder rows", stubA !== stubB);

const entryA = await db.addEntry({ listId: listA, placeRef: stubA, sourceTitle: "Joe's Pizza", position: 0 });
const entryB = await db.addEntry({ listId: listB, placeRef: stubB, sourceTitle: "Joe's Pizza", position: 0 });

const first = await db.updatePlaceFromGoogle(stubA, { placeId: "ChIJ_joes", name: "Joe's Pizza", rating: 4.6 });
check("first enrichment keeps its own row", first === stubA, { first, stubA });

// The second one discovers the same Place ID — previously a unique violation.
const merged = await db.updatePlaceFromGoogle(stubB, { placeId: "ChIJ_joes", name: "Joe's Pizza", rating: 4.6 });
check("second enrichment merges into the first row", merged === stubA, { merged, stubA });

const rowsA = await db.getListRows(listA);
const rowsB = await db.getListRows(listB);
check("list A still has its entry", rowsA.length === 1, rowsA.length);
check("list B still has its entry", rowsB.length === 1, rowsB.length);
check("both lists now point at the same place row", rowsA[0]?.place.id === rowsB[0]?.place.id);
check("both entries survived the merge", Boolean(entryA) && Boolean(entryB) && rowsB[0]?.id === entryB);
check("merged row carries the enriched data", rowsB[0]?.place.rating === 4.6, rowsB[0]?.place);
check("the redundant placeholder is gone", (await db.getUnenrichedPlaces(listB)).length === 0);

console.log("\ndeduping lists by google list id");
const g1 = await db.createList({
  name: "Want to go",
  source: "sharelink",
  sourceUrl: "https://maps.app.goo.gl/SHORT",
  googleListId: "GOOGLE_LIST_1",
});
check("finds an existing list by google id", (await db.findListByGoogleId("GOOGLE_LIST_1"))?.id === g1);
check("a different google id is not matched", (await db.findListByGoogleId("GOOGLE_LIST_2")) === null);

console.log("\ndeletes");
await db.deleteEntry(entryId);
check("entry is removed", (await db.getListRows(listId)).length === 1);

await db.addEntry({ listId: second, placeRef: refA, sourceTitle: "Katz's", position: 0 });
await db.deleteList(listId);
check("deleted list is gone", (await db.getList(listId)) === null);
check(
  "place shared with another list survives deletion",
  (await db.getListRows(second)).length === 1,
);

await db.renameList(second, "Renamed");
check("renameList works", (await db.getList(second))?.name === "Renamed");

console.log(
  failures === 0
    ? "\nAll database checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
