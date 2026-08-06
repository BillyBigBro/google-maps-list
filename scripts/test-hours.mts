/**
 * Opening-hours logic. Pure functions, no network or database.
 *
 *   npm run test:hours
 */
import { hasSchedule, openStateAt } from "../src/lib/opening-hours";
import type { OpeningHours } from "../src/lib/types";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}`, detail ?? "");
  }
}

const hours = (periods: OpeningHours["periods"]): OpeningHours => ({
  weekdayDescriptions: [],
  periods,
});

/** An instant expressed in UTC, so these tests don't depend on the host clock. */
const utc = (isoLike: string) => new Date(`${isoLike}Z`);

// 2026-08-09 is a Sunday, so 08-10 is Monday and 08-15 is Saturday.
const MON_9_TO_17 = hours([
  { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
]);

console.log("\nbasic weekday hours (place at UTC+0)");
check("open in the middle of the shift", openStateAt(MON_9_TO_17, 0, utc("2026-08-10T12:00")) === "open");
check("closed before opening", openStateAt(MON_9_TO_17, 0, utc("2026-08-10T08:59")) === "closed");
check("open exactly at opening time", openStateAt(MON_9_TO_17, 0, utc("2026-08-10T09:00")) === "open");
check("closed exactly at closing time", openStateAt(MON_9_TO_17, 0, utc("2026-08-10T17:00")) === "closed");
check("closed on a day with no period", openStateAt(MON_9_TO_17, 0, utc("2026-08-11T12:00")) === "closed");

console.log("\novernight hours crossing midnight");
const FRI_NIGHT = hours([
  { open: { day: 5, hour: 20, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } },
]);
check("open before midnight", openStateAt(FRI_NIGHT, 0, utc("2026-08-14T23:30")) === "open");
check("open after midnight", openStateAt(FRI_NIGHT, 0, utc("2026-08-15T01:30")) === "open");
check("closed after the 2am close", openStateAt(FRI_NIGHT, 0, utc("2026-08-15T02:30")) === "closed");

console.log("\nperiod wrapping from Saturday into Sunday");
const SAT_NIGHT = hours([
  { open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 3, minute: 0 } },
]);
check("open late Saturday", openStateAt(SAT_NIGHT, 0, utc("2026-08-15T23:00")) === "open");
check("open early Sunday, wrapped across the week boundary", openStateAt(SAT_NIGHT, 0, utc("2026-08-16T01:00")) === "open");
check("closed Sunday morning after close", openStateAt(SAT_NIGHT, 0, utc("2026-08-16T04:00")) === "closed");

console.log("\nalways open");
const ALWAYS = hours([{ open: { day: 0, hour: 0, minute: 0 } }]);
check("open on a Sunday", openStateAt(ALWAYS, 0, utc("2026-08-09T03:00")) === "open");
check("open on a Wednesday", openStateAt(ALWAYS, 0, utc("2026-08-12T15:00")) === "open");

console.log("\nthe place's timezone, not the viewer's");
// Tokyo is UTC+9. 03:00 Monday in Tokyo is 18:00 Sunday UTC.
const TOKYO = 9 * 60;
check(
  "shut at 3am local even though it is Sunday evening in UTC",
  openStateAt(MON_9_TO_17, TOKYO, utc("2026-08-09T18:00")) === "closed",
);
check(
  "open at noon Monday Tokyo time (03:00 UTC)",
  openStateAt(MON_9_TO_17, TOKYO, utc("2026-08-10T03:00")) === "open",
);
// Los Angeles is UTC-7 in August. 10:00 Monday LA is 17:00 Monday UTC.
const LA = -7 * 60;
check(
  "open at 10am Los Angeles time (17:00 UTC)",
  openStateAt(MON_9_TO_17, LA, utc("2026-08-10T17:00")) === "open",
);
check(
  "the same instant is closed in Tokyo and open in LA",
  openStateAt(MON_9_TO_17, TOKYO, utc("2026-08-10T17:00")) === "closed" &&
    openStateAt(MON_9_TO_17, LA, utc("2026-08-10T17:00")) === "open",
);

console.log("\nunknown schedules");
check("no hours at all", openStateAt(null, 0, utc("2026-08-10T12:00")) === "unknown");
check("hours with no periods", openStateAt(hours([]), 0, utc("2026-08-10T12:00")) === "unknown");
check("hasSchedule is false without periods", hasSchedule(hours([])) === false);
check("hasSchedule is true with periods", hasSchedule(MON_9_TO_17) === true);

console.log("\nfalling back to the viewer's clock when the offset is unknown");
// With no offset the answer follows the host timezone, so assert only that it
// still produces a definite answer rather than a specific one.
const fallback = openStateAt(MON_9_TO_17, null, utc("2026-08-10T12:00"));
check("still answers open or closed", fallback === "open" || fallback === "closed", fallback);

console.log(
  failures === 0 ? "\nAll opening-hours checks passed.\n" : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
