export type PlaceStatus = "none" | "want" | "visited" | "skip";

/** A point in the weekly schedule. `day` is 0 = Sunday, matching Google. */
export type OpeningPoint = { day: number; hour: number; minute: number };

/** One opening interval. A missing `close` means "open from then on" (24/7). */
export type OpeningPeriod = { open: OpeningPoint; close?: OpeningPoint };

export type OpeningHours = {
  /** Human readable lines, e.g. "Monday: 9:00 AM – 5:00 PM" */
  weekdayDescriptions: string[];
  /**
   * Structured schedule, used to work out open/closed at view time.
   * Google's `openNow` is deliberately not stored: it is only true for the
   * instant we enriched, and would be stale by the time anyone reads it.
   */
  periods?: OpeningPeriod[];
};

/** A place as Google knows it. Shared across lists and cached by placeId. */
export type Place = {
  id: string;
  placeId: string | null;
  name: string;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  primaryType: string | null;
  types: string[];
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: string | null;
  phone: string | null;
  website: string | null;
  googleMapsUri: string | null;
  openingHours: OpeningHours | null;
  /**
   * The place's offset from UTC, in minutes. "Open now" is a question about
   * the place's local time, not the viewer's, so this is what makes the answer
   * correct for someone browsing a Tokyo list from California.
   */
  utcOffsetMinutes: number | null;
  businessStatus: string | null;
  enrichedAt: string | null;
  enrichError: string | null;
};

/** A place's membership in one list, carrying the user's own annotations. */
export type ListEntry = {
  id: string;
  listId: string;
  sourceTitle: string;
  sourceNote: string | null;
  sourceUrl: string | null;
  tags: string[];
  status: PlaceStatus;
  myRating: number | null;
  myNote: string | null;
  position: number;
};

/** What the table renders: one row per place in a list. */
export type ListRow = ListEntry & { place: Place };

export type PlaceList = {
  id: string;
  name: string;
  source: "takeout" | "sharelink" | "manual";
  sourceUrl: string | null;
  createdAt: string;
  entryCount: number;
  enrichedCount: number;
};
