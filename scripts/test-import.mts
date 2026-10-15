/**
 * End-to-end import check: reads a real shared Maps list from Google and runs
 * it through the same import path the API route uses, into an in-memory
 * Postgres. Hits the network, so it's separate from `npm run test:db`.
 *
 *   npm run test:import -- https://maps.app.goo.gl/XXXX
 */
import { newDb } from "pg-mem";

const mem = newDb();
const pg = mem.adapters.createPg();
process.env.DATABASE_URL = "postgres://localhost/memory";
const globalForDb = globalThis as unknown as { __gmapsPool?: unknown };
globalForDb.__gmapsPool = new pg.Pool();

const db = await import("../src/lib/db");
const { importFromShareLink, importFromCsvText } = await import("../src/lib/import");

const url = process.argv[2] ?? "https://maps.app.goo.gl/FLBfbugCo6veR3ND9";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

console.log(`\nimporting ${url}`);
const result = await importFromShareLink(url);
console.log(`  list id: ${result.listId}  imported: ${result.imported}`);

check("import reported places", result.imported > 0, result);

const list = await db.getList(result.listId);
check("list is readable by its id", list !== null);
check("list name came from Google", Boolean(list?.name && list.name !== "Shared list"), list?.name);
check("entryCount matches what was imported", list?.entryCount === result.imported, list);
check("nothing is enriched yet", list?.enrichedCount === 0, list);

const rows = await db.getListRows(result.listId);
check("rows match entryCount", rows.length === result.imported, rows.length);
check("every row has a name", rows.every((r) => r.place.name.length > 0));
check(
  "coordinates were seeded from the share link",
  rows.filter((r) => r.place.lat !== null).length >= rows.length * 0.8,
  `${rows.filter((r) => r.place.lat !== null).length}/${rows.length}`,
);
check(
  "most rows have a maps link",
  rows.filter((r) => r.sourceUrl).length >= rows.length * 0.8,
);
check("row order is preserved", rows.every((r, i) => r.position === i));

console.log("\nenrichment queue");
const pending = await db.getUnenrichedPlaces(result.listId);
check("everything is queued for enrichment", pending.length === rows.length, pending.length);
check(
  "queue carries coordinates for search bias",
  pending.filter((p) => p.lat !== null).length >= pending.length * 0.8,
);

console.log("\nre-pasting the same link");
// Pretend the first import was enriched, so we can see whether the second
// import pays for it again.
const firstRow = rows[0];
await db.updatePlaceFromGoogle(firstRow.place.id, {
  placeId: "ChIJ_test_reuse",
  name: firstRow.place.name,
  rating: 4.2,
});

const again = await importFromShareLink(url);
check("creates a fresh list rather than reopening the old one", again.listId !== result.listId, again);
check("the fresh list has every place", again.imported === result.imported, again);
check("the old list is left untouched", (await db.getList(result.listId))?.entryCount === result.imported);

const againRows = await db.getListRows(again.listId);
check(
  "an already-enriched place is reused, not looked up again",
  againRows.find((r) => r.sourceTitle === firstRow.sourceTitle)?.place.rating === 4.2,
);
check(
  "so the fresh list only queues places that still need details",
  (await db.getUnenrichedPlaces(again.listId)).length === result.imported - 1,
  (await db.getUnenrichedPlaces(again.listId)).length,
);
check(
  "both lists share place rows instead of duplicating them",
  againRows.every((r, i) => r.place.id === rows[i].place.id),
);

console.log("\ncsv import still works");
const csv = "Title,Note,URL\nJoe's Pizza,,https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJRYNC\n,orphan,\n";
const csvResult = await importFromCsvText(csv, "Want to go.csv");
check("csv imported one place", csvResult.imported === 1, csvResult);
check("csv skipped the title-less row", csvResult.skipped === 1, csvResult);
check("csv list name came from the filename", (await db.getList(csvResult.listId))?.name === "Want to go");

console.log("\nsample rows:");
for (const r of rows.slice(0, 5)) {
  console.log(`  ${r.place.name}`);
  console.log(`    ${r.place.formattedAddress ?? "(no address yet)"}  [${r.place.lat}, ${r.place.lng}]`);
}

console.log(
  failures === 0 ? "\nAll import checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
