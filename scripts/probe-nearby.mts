/**
 * Checks the coordinate-based lookup against real entries from a shared list.
 * Uses a handful of places so it costs only a few requests.
 *
 *   npx tsx scripts/probe-nearby.mts [shareUrl] [count]
 */
process.loadEnvFile(".env.local");

const { fetchSharedList } = await import("../src/lib/gmaps-list");
const { searchPlaceNearby, PlacesApiError } = await import("../src/lib/places");

const url = process.argv[2] ?? "https://maps.app.goo.gl/FLBfbugCo6veR3ND9";
const count = Number(process.argv[3] ?? 6);

const list = await fetchSharedList(url);
const sample = list.places.filter((p) => p.lat !== null).slice(0, count);

console.log(`\nresolving ${sample.length} of ${list.places.length} places by coordinates\n`);

let matched = 0;
for (const place of sample) {
  try {
    const found = await searchPlaceNearby(place.name, { lat: place.lat!, lng: place.lng! });
    if (found) {
      matched++;
      console.log(`  ok   ${place.name}`);
      console.log(`         → ${found.name} · ${found.primaryType ?? "?"} · ${found.rating ?? "?"}★ (${found.userRatingCount ?? 0}) · ${found.phone ?? "no phone"}`);
    } else {
      console.log(`  MISS ${place.name}  (no name match nearby — would fall back to text search)`);
    }
  } catch (err) {
    const detail = err instanceof PlacesApiError ? `${err.status}: ${err.message}` : String(err);
    console.log(`  ERR  ${place.name}  ${detail}`);
  }
}

console.log(`\nmatched ${matched}/${sample.length} by coordinates alone\n`);
