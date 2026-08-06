/**
 * Checks the coordinate-based lookup against real entries from a shared list,
 * and reports the live open/closed state each one resolves to.
 *
 *   npm run check:nearby -- <shareUrl> <count>
 */
process.loadEnvFile(".env.local");

const { fetchSharedList } = await import("../src/lib/gmaps-list");
const { searchPlaceNearby, PlacesApiError } = await import("../src/lib/places");
const { openStateAt } = await import("../src/lib/opening-hours");

const url = process.argv[2] ?? "https://maps.app.goo.gl/FLBfbugCo6veR3ND9";
const count = Number(process.argv[3] ?? 6);

const list = await fetchSharedList(url);
const sample = list.places.filter((p) => p.lat !== null).slice(0, count);

console.log(`\nresolving ${sample.length} of ${list.places.length} places by coordinates`);
console.log(`your device reports ${new Date().toString().replace(/ \(.*\)$/, "")}\n`);

let matched = 0;
let withSchedule = 0;

for (const place of sample) {
  try {
    const found = await searchPlaceNearby(place.name, { lat: place.lat!, lng: place.lng! });
    if (!found) {
      console.log(`  MISS ${place.name}  (no name match nearby — would fall back to text search)`);
      continue;
    }

    matched++;
    const periods = found.openingHours?.periods?.length ?? 0;
    if (periods > 0) withSchedule++;

    const state = openStateAt(found.openingHours, found.utcOffsetMinutes);
    const offset = found.utcOffsetMinutes;
    const offsetLabel =
      offset == null
        ? "no offset"
        : `UTC${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;

    console.log(`  ok   ${found.name}`);
    console.log(`         ${state.toUpperCase().padEnd(7)} ${offsetLabel} · ${periods} period(s) · ${found.rating ?? "?"}★`);
  } catch (err) {
    const detail = err instanceof PlacesApiError ? `${err.status}: ${err.message}` : String(err);
    console.log(`  ERR  ${place.name}  ${detail}`);
  }
}

console.log(`\nmatched ${matched}/${sample.length}; ${withSchedule} had a usable schedule\n`);
