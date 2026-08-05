/**
 * Live check of the shared-list reader against a real Maps link.
 * Hits Google, so it's kept out of the normal test run.
 *
 *   npm run test:list -- https://maps.app.goo.gl/XXXX
 */
import {
  extractListId,
  fetchSharedList,
  ListFetchError,
  looksLikeMapsLink,
} from "../src/lib/gmaps-list";

const url = process.argv[2] ?? "https://maps.app.goo.gl/FLBfbugCo6veR3ND9";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

console.log("\nurl recognition");
check("share link recognised", looksLikeMapsLink(url));
check("plain google.com/maps recognised", looksLikeMapsLink("https://www.google.com/maps/@1,2,3z"));
check("non-maps link rejected", !looksLikeMapsLink("https://example.com/x"));

console.log("\nlist id extraction");
check(
  "extracts from a /maps/@ data blob",
  extractListId("https://www.google.com/maps/@/data=!3m1!4b1!4m3!11m2!2sABCDEFGHIJKLMNOPQRSTUVWX!3e2") ===
    "ABCDEFGHIJKLMNOPQRSTUVWX",
);
check(
  "extracts from a placelists url",
  extractListId("https://www.google.com/maps/placelists/list/ABCDEFGHIJKL0123") === "ABCDEFGHIJKL0123",
);
check("returns null for an unrelated url", extractListId("https://google.com/maps") === null);

console.log(`\nlive fetch: ${url}`);
try {
  const list = await fetchSharedList(url);
  console.log(`  list id: ${list.listId}`);
  console.log(`  places : ${list.places.length}`);

  check("got at least one place", list.places.length > 0);
  check("every place has a name", list.places.every((p) => p.name.length > 0));

  const withCoords = list.places.filter((p) => p.lat !== null && p.lng !== null);
  const withAddress = list.places.filter((p) => p.address);
  const withFtid = list.places.filter((p) => p.ftid);

  console.log(`  with coords : ${withCoords.length}/${list.places.length}`);
  console.log(`  with address: ${withAddress.length}/${list.places.length}`);
  console.log(`  with ftid   : ${withFtid.length}/${list.places.length}`);

  check("most places have coordinates", withCoords.length >= list.places.length * 0.8);
  check("most places have a feature id", withFtid.length >= list.places.length * 0.8);
  check(
    "coordinates are plausible",
    withCoords.every((p) => Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180),
  );
  check(
    "ftid is a hex pair",
    withFtid.every((p) => /^0x[0-9a-f]+:0x[0-9a-f]+$/.test(p.ftid!)),
  );
  check(
    "cid is numeric where present",
    list.places.filter((p) => p.cid).every((p) => /^\d+$/.test(p.cid!)),
  );

  console.log("\n  sample:");
  for (const p of list.places.slice(0, 5)) {
    console.log(`    ${p.name}`);
    console.log(`      ${p.address ?? "(no address)"}  [${p.lat}, ${p.lng}]`);
    console.log(`      ${p.mapsUrl ?? "(no url)"}`);
  }
} catch (err) {
  failures++;
  if (err instanceof ListFetchError) {
    console.log(`  FAIL live fetch: ${err.message}${err.hint ? ` — ${err.hint}` : ""}`);
  } else {
    console.log("  FAIL live fetch:", err);
  }
}

console.log(failures === 0 ? "\nAll list-reader checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
