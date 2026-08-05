export type PlaceStatus = "none" | "want" | "visited" | "skip";

export type OpeningHours = {
  /** Human readable lines, e.g. "Monday: 9:00 AM – 5:00 PM" */
  weekdayDescriptions: string[];
  openNow?: boolean;
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
