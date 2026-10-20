"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
  type Table,
  type VisibilityState,
} from "@tanstack/react-table";
import { hasSchedule, openStateAt, openStateOn } from "@/lib/opening-hours";
import type { ListRow } from "@/lib/types";

const column = createColumnHelper<ListRow>();

/** The clock filter: open right now, or open at a chosen weekday and time. */
export type OpenFilter = { mode: "now" } | { mode: "at"; day: number; minute: number };

/**
 * "now" reuses the column's live open/closed value, so it stays correct as
 * the clock ticks. "at" checks each place's schedule at that weekday and
 * time in the place's own local time. Places with no stored hours never
 * match, since we can't say they'll be open.
 */
const openAtFilter: FilterFn<ListRow> = (row, id, filter: OpenFilter) =>
  filter.mode === "now"
    ? row.getValue(id) === "open"
    : openStateOn(row.original.place.openingHours, filter.day, filter.minute) === "open";

/**
 * Category filter: the value is the list of ticked categories, and a place
 * matches if its category is any of them.
 */
const inSelectedCategories: FilterFn<ListRow> = (row, id, selected: string[]) =>
  selected.includes(row.getValue<string | null>(id) ?? "");
// Unticking the last box removes the filter, rather than matching nothing.
inSelectedCategories.autoRemove = (value) => !Array.isArray(value) || value.length === 0;

/**
 * The table instance lives here rather than inside <PlacesTable> so the page
 * can hand the *same* filtered rows to both the table and the map. One source
 * of truth means a filter can never apply to one and not the other.
 */
export function usePlacesTable(
  rows: ListRow[],
  onUpdateEntry: (entryId: string, patch: Record<string, unknown>) => void,
): { table: Table<ListRow>; now: Date | null } {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  // The table now shares the screen with a map, so it starts narrow: the
  // columns you scan by are on, the rest are a click away under "Columns".
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    price: false,
    address: false,
    hours: false,
    phone: false,
    website: false,
    businessStatus: false,
    listNote: false,
    tags: false,
    myNote: false,
    latitude: false,
    longitude: false,
  });

  /**
   * "Open now" is computed from the stored schedule rather than read from a
   * stored flag, so it is correct for whoever is looking and whenever they
   * look. The clock ticks so a place that closes at 21:00 flips — in the table
   * and on the map — while the tab is left open.
   *
   * Starts null and is set after mount: the server and the browser would
   * otherwise disagree about the current time and trip a hydration mismatch.
   */
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const columns = useMemo(
    () => [
      column.accessor((r) => r.place.name || r.sourceTitle, { id: "name", header: "Name" }),
      column.accessor((r) => r.place.primaryType, {
        id: "category",
        header: "Category",
        filterFn: inSelectedCategories,
      }),
      column.accessor((r) => r.place.rating, {
        id: "rating",
        header: "Rating",
        sortUndefined: "last",
      }),
      column.accessor((r) => r.place.userRatingCount, {
        id: "reviews",
        header: "# Ratings",
        sortUndefined: "last",
      }),
      column.accessor((r) => r.place.priceLevel, { id: "price", header: "Price" }),
      column.accessor((r) => r.place.formattedAddress, { id: "address", header: "Address" }),
      column.accessor(
        (r) =>
          now && hasSchedule(r.place.openingHours)
            ? openStateAt(r.place.openingHours, r.place.utcOffsetMinutes, now)
            : "unknown",
        { id: "openNow", header: "Open now", filterFn: openAtFilter },
      ),
      column.accessor((r) => r.place.openingHours?.weekdayDescriptions.join("\n"), {
        id: "hours",
        header: "Hours",
        enableSorting: false,
      }),
      column.accessor((r) => r.place.phone, { id: "phone", header: "Phone" }),
      column.accessor((r) => r.place.website, {
        id: "website",
        header: "Website",
        enableSorting: false,
      }),
      column.accessor((r) => r.place.businessStatus, {
        id: "businessStatus",
        header: "Status (Google)",
      }),
      column.accessor((r) => r.sourceNote, {
        id: "listNote",
        header: "List note",
        enableSorting: false,
      }),
      column.accessor((r) => r.tags.join(", "), {
        id: "tags",
        header: "Tags",
        enableSorting: false,
      }),
      column.accessor((r) => r.myNote, { id: "myNote", header: "My note", enableSorting: false }),
      column.accessor((r) => r.place.lat, { id: "latitude", header: "Lat" }),
      column.accessor((r) => r.place.lng, { id: "longitude", header: "Lng" }),
    ],
    [now],
  );

  // TanStack caches each row's column values until `data` changes, so the
  // time-dependent "open now" value would freeze at whatever it was on first
  // render (before the clock is even set). A new array each tick invalidates
  // that cache; the row objects themselves are unchanged.
  const data = useMemo(() => (now ? [...rows] : rows), [rows, now]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    // Cell renderers reach the save handler through table meta instead of
    // closing over it, so the column definitions don't need rebuilding.
    meta: { onUpdateEntry },
  });

  return { table, now };
}

export type PlacesTableMeta = {
  onUpdateEntry: (entryId: string, patch: Record<string, unknown>) => void;
};
