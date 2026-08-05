/**
 * Confirms GOOGLE_MAPS_API_KEY works, using exactly one Places request.
 *
 *   npm run check:places
 */
process.loadEnvFile(".env.local");

const { searchPlaceByText, hasApiKey, PlacesApiError } = await import("../src/lib/places");

if (!hasApiKey()) {
  console.log("\nGOOGLE_MAPS_API_KEY is not set in .env.local.\n");
  process.exit(1);
}

console.log("\nmaking one Places request…");

try {
  const place = await searchPlaceByText("Katz's Delicatessen, 205 E Houston St, New York", {
    lat: 40.7223,
    lng: -73.9874,
  });

  if (!place) {
    console.log("  Key works, but that query returned no match.\n");
    process.exit(1);
  }

  console.log(`  name    : ${place.name}`);
  console.log(`  address : ${place.formattedAddress}`);
  console.log(`  category: ${place.primaryType}`);
  console.log(`  rating  : ${place.rating} (${place.userRatingCount} reviews)`);
  console.log(`  phone   : ${place.phone}`);
  console.log(`  website : ${place.website}`);
  console.log(`  hours   : ${place.openingHours?.weekdayDescriptions?.[0] ?? "(none)"}`);
  console.log("\nPlaces API key works.\n");
  // Set the code rather than calling process.exit(): on Windows, exiting while
  // fetch's keep-alive sockets are open trips a libuv assertion.
  process.exitCode = 0;
} catch (err) {
  if (err instanceof PlacesApiError) {
    console.log(`\nPlaces API rejected the request (${err.status}): ${err.message}`);
    if (err.status === 403) {
      console.log("Hint: enable 'Places API (New)' — the legacy 'Places API' won't work.");
    }
  } else {
    console.log("\nRequest failed:", err);
  }
  console.log();
  process.exitCode = 1;
}
