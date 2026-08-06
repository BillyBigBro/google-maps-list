import type { OpeningHours, OpeningPeriod } from "./types";

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

export type OpenState = "open" | "closed" | "unknown";

/**
 * Whether a place is open, worked out at the moment of asking.
 *
 * "Open now" is a question about the *place's* local time — a Tokyo restaurant
 * is shut at 3am Tokyo time no matter where you are reading from. So when we
 * know the place's UTC offset we use it, and only fall back to the viewer's
 * own timezone when we don't (rows enriched before the offset was stored).
 */
export function openStateAt(
  hours: OpeningHours | null | undefined,
  utcOffsetMinutes: number | null | undefined,
  now: Date = new Date(),
): OpenState {
  const periods = hours?.periods;
  if (!periods || periods.length === 0) return "unknown";

  const nowMinute = weekMinuteAt(now, utcOffsetMinutes);

  for (const period of periods) {
    if (coversMinute(period, nowMinute)) return "open";
  }
  return "closed";
}

/** True when the place's schedule is known well enough to answer at all. */
export function hasSchedule(hours: OpeningHours | null | undefined): boolean {
  return Boolean(hours?.periods && hours.periods.length > 0);
}

/**
 * Minutes since Sunday 00:00 in the relevant timezone.
 *
 * With an offset we shift the instant and read it back with UTC getters, which
 * avoids the host machine's own timezone entering into it at all. Without one
 * we use local getters, which is the viewer's timezone.
 */
function weekMinuteAt(now: Date, utcOffsetMinutes: number | null | undefined): number {
  if (utcOffsetMinutes == null) {
    return now.getDay() * MINUTES_PER_DAY + now.getHours() * 60 + now.getMinutes();
  }

  const shifted = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  return (
    shifted.getUTCDay() * MINUTES_PER_DAY +
    shifted.getUTCHours() * 60 +
    shifted.getUTCMinutes()
  );
}

function toWeekMinute(point: { day: number; hour: number; minute: number }): number {
  return point.day * MINUTES_PER_DAY + point.hour * 60 + point.minute;
}

function coversMinute(period: OpeningPeriod, nowMinute: number): boolean {
  // No close point means the place never shuts (Google's 24/7 representation).
  if (!period.close) return true;

  const start = toWeekMinute(period.open);
  let end = toWeekMinute(period.close);

  // A close that lands at or before the open wraps past Sunday midnight —
  // e.g. a bar open Saturday 20:00 until Sunday 02:00.
  if (end <= start) end += MINUTES_PER_WEEK;

  // The interval is half-open: a place closing at 21:00 is shut at 21:00.
  if (nowMinute >= start && nowMinute < end) return true;

  // Retry a week later so an instant early in the week can fall inside a
  // period that wrapped around from the end of it.
  const wrapped = nowMinute + MINUTES_PER_WEEK;
  return wrapped >= start && wrapped < end;
}
