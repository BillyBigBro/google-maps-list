"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { hasSchedule, openStateAt } from "@/lib/opening-hours";
import type { ListRow, PlaceStatus } from "@/lib/types";

const STATUS_LABELS: Record<PlaceStatus, string> = {
  none: "—",
  want: "Want to go",
  visited: "Visited",
  skip: "Skip",
};

const STATUS_STYLES: Record<PlaceStatus, string> = {
  none: "text-[var(--muted)]",
  want: "text-blue-600 dark:text-blue-400",
  visited: "text-emerald-600 dark:text-emerald-400",
  skip: "text-rose-600 dark:text-rose-400 line-through",
};

const column = createColumnHelper<ListRow>();

type Props = {
  rows: ListRow[];
  onUpdateEntry: (entryId: string, patch: Record<string, unknown>) => void;
};

export default function PlacesTable({ rows, onUpdateEntry }: Props) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    latitude: false,
    longitude: false,
    businessStatus: false,
    hours: false,
  });
  const [showColumns, setShowColumns] = useState(false);

  /**
   * "Open now" is computed from the stored schedule rather than read from a
   * stored flag, so it is correct for whoever is looking and whenever they
   * look. The clock ticks so a place that closes at 21:00 flips while the tab
   * is left open.
   *
   * Starts null and is set after mount: the server and the browser would
   * otherwise disagree about the current time and trip a hydration mismatch.
   */
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const columns = useMemo(
    () => [
      column.accessor((r) => r.place.name || r.sourceTitle, {
        id: "name",
        header: "Name",
        cell: (ctx) => {
          const row = ctx.row.original;
          const href = row.place.googleMapsUri ?? row.sourceUrl;
          return (
            <div className="min-w-[200px]">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  {ctx.getValue()}
                </a>
              ) : (
                <span className="font-medium">{ctx.getValue()}</span>
              )}
              {row.place.enrichError && (
                <p className="text-xs text-rose-500" title={row.place.enrichError}>
                  not enriched
                </p>
              )}
            </div>
          );
        },
      }),
      column.accessor((r) => r.place.primaryType, {
        id: "category",
        header: "Category",
        cell: (ctx) => <Muted value={ctx.getValue()} />,
        filterFn: "equalsString",
      }),
      column.accessor((r) => r.place.rating, {
        id: "rating",
        header: "Rating",
        cell: (ctx) => {
          const value = ctx.getValue();
          return value == null ? <Dash /> : <span>{value.toFixed(1)}</span>;
        },
        sortUndefined: "last",
      }),
      column.accessor((r) => r.place.userRatingCount, {
        id: "reviews",
        header: "Reviews",
        cell: (ctx) => {
          const value = ctx.getValue();
          return value == null ? <Dash /> : <span>{value.toLocaleString()}</span>;
        },
        sortUndefined: "last",
      }),
      column.accessor((r) => r.place.priceLevel, {
        id: "price",
        header: "Price",
        cell: (ctx) => <Muted value={ctx.getValue()} />,
      }),
      column.accessor((r) => r.place.formattedAddress, {
        id: "address",
        header: "Address",
        cell: (ctx) => (
          <span className="block max-w-[280px] truncate text-[var(--muted)]" title={ctx.getValue() ?? ""}>
            {ctx.getValue() ?? "—"}
          </span>
        ),
      }),
      column.accessor(
        (r) =>
          now && hasSchedule(r.place.openingHours)
            ? openStateAt(r.place.openingHours, r.place.utcOffsetMinutes, now)
            : "unknown",
        {
          id: "openNow",
          header: "Open now",
          filterFn: "equalsString",
          cell: (ctx) => {
            const state = ctx.getValue();
            if (state === "unknown") return <Dash />;

            const place = ctx.row.original.place;
            // Without the place's offset we fall back to the viewer's clock,
            // which is only right for places in the viewer's timezone. Say so
            // rather than quietly presenting a guess as fact.
            const basis =
              place.utcOffsetMinutes == null
                ? "Based on your device's timezone — re-run Fetch details for this place's own local time"
                : `Local time at the place (UTC${formatOffset(place.utcOffsetMinutes)})`;

            return (
              <span
                title={basis}
                className={
                  state === "open"
                    ? "font-medium text-emerald-600 dark:text-emerald-400"
                    : "text-[var(--muted)]"
                }
              >
                {state === "open" ? "Open" : "Closed"}
                {place.utcOffsetMinutes == null && <span aria-hidden="true"> *</span>}
              </span>
            );
          },
        },
      ),
      column.accessor((r) => r.place.openingHours?.weekdayDescriptions.join("\n"), {
        id: "hours",
        header: "Hours",
        enableSorting: false,
        cell: (ctx) => {
          const value = ctx.getValue();
          if (!value) return <Dash />;
          return (
            <details className="max-w-[260px]">
              <summary className="cursor-pointer text-xs text-[var(--accent)]">view</summary>
              <pre className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">{value}</pre>
            </details>
          );
        },
      }),
      column.accessor((r) => r.place.phone, {
        id: "phone",
        header: "Phone",
        cell: (ctx) => <Muted value={ctx.getValue()} />,
      }),
      column.accessor((r) => r.place.website, {
        id: "website",
        header: "Website",
        enableSorting: false,
        cell: (ctx) => {
          const value = ctx.getValue();
          if (!value) return <Dash />;
          return (
            <a
              href={value}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              {hostname(value)}
            </a>
          );
        },
      }),
      column.accessor((r) => r.place.businessStatus, {
        id: "businessStatus",
        header: "Status (Google)",
        cell: (ctx) => <Muted value={ctx.getValue()?.replace(/_/g, " ").toLowerCase() ?? null} />,
      }),
      column.accessor((r) => r.sourceNote, {
        id: "listNote",
        header: "List note",
        enableSorting: false,
        cell: (ctx) => (
          <span className="block max-w-[220px] truncate text-[var(--muted)]" title={ctx.getValue() ?? ""}>
            {ctx.getValue() ?? "—"}
          </span>
        ),
      }),
      column.accessor((r) => r.status, {
        id: "myStatus",
        header: "My status",
        cell: (ctx) => (
          <select
            value={ctx.getValue()}
            onChange={(e) =>
              onUpdateEntry(ctx.row.original.id, { status: e.target.value })
            }
            className={`cursor-pointer appearance-none rounded border border-transparent bg-[var(--surface)] px-1 py-0.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border)] hover:bg-[var(--surface-hover)] focus-visible:border-[var(--accent)] ${STATUS_STYLES[ctx.getValue()]}`}
          >
            {(Object.keys(STATUS_LABELS) as PlaceStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        ),
        filterFn: "equalsString",
      }),
      column.accessor((r) => r.tags.join(", "), {
        id: "tags",
        header: "Tags",
        enableSorting: false,
        cell: (ctx) => (
          <input
            defaultValue={ctx.getValue()}
            placeholder="add tags…"
            onBlur={(e) => {
              const next = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
              if (next.join(", ") !== ctx.getValue()) {
                onUpdateEntry(ctx.row.original.id, { tags: next });
              }
            }}
            className="w-32 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        ),
      }),
      column.accessor((r) => r.myNote, {
        id: "myNote",
        header: "My note",
        enableSorting: false,
        cell: (ctx) => (
          <input
            defaultValue={ctx.getValue() ?? ""}
            placeholder="note…"
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== (ctx.getValue() ?? "")) {
                onUpdateEntry(ctx.row.original.id, { myNote: next || null });
              }
            }}
            className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus:bg-[var(--surface)]"
          />
        ),
      }),
      column.accessor((r) => r.place.lat, { id: "latitude", header: "Lat" }),
      column.accessor((r) => r.place.lng, { id: "longitude", header: "Lng" }),
    ],
    [onUpdateEntry, now],
  );

  const table = useReactTable({
    data: rows,
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
  });

  const categoryColumn = table.getColumn("category");
  const categories = useMemo(
    () =>
      [...(categoryColumn?.getFacetedUniqueValues().keys() ?? [])]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .sort(),
    [categoryColumn],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search places…"
          className="w-56 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />

        <select
          value={(categoryColumn?.getFilterValue() as string) ?? ""}
          onChange={(e) => categoryColumn?.setFilterValue(e.target.value || undefined)}
          className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={(table.getColumn("myStatus")?.getFilterValue() as string) ?? ""}
          onChange={(e) =>
            table.getColumn("myStatus")?.setFilterValue(e.target.value || undefined)
          }
          className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20"
        >
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABELS) as PlaceStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        <div className="relative">
          <button
            onClick={() => setShowColumns((v) => !v)}
            aria-expanded={showColumns}
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              showColumns
                ? "border-[var(--accent)] bg-[var(--surface-active)]"
                : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
            }`}
          >
            Columns
          </button>
          {showColumns && (
            <>
              {/* Click-away target so the menu closes like a real popover. */}
              <div className="fixed inset-0 z-10" onClick={() => setShowColumns(false)} />
              <div className="absolute z-20 mt-1 w-52 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
                {table.getAllLeafColumns().map((col) => (
                  <label
                    key={col.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-[var(--surface-hover)]"
                  >
                    <input
                      type="checkbox"
                      checked={col.getIsVisible()}
                      onChange={col.getToggleVisibilityHandler()}
                      className="cursor-pointer accent-[var(--accent)]"
                    />
                    {typeof col.columnDef.header === "string" ? col.columnDef.header : col.id}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <span className="ml-auto text-sm text-[var(--muted)]">
          {table.getFilteredRowModel().rows.length} of {rows.length} places
        </span>
      </div>

      <div className="thin-scroll overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-[var(--border)]">
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={`whitespace-nowrap px-3 py-2 text-left font-medium text-[var(--muted)] transition-colors duration-150 ${
                      header.column.getCanSort()
                        ? "cursor-pointer select-none hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                        : ""
                    } ${header.column.getIsSorted() ? "text-[var(--accent)]" : ""}`}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--border)] transition-colors duration-100 last:border-0 hover:bg-[var(--surface-hover)]"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="px-3 py-8 text-center text-[var(--muted)]"
                >
                  No places match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Muted({ value }: { value: string | null | undefined }) {
  return value ? <span>{value}</span> : <Dash />;
}

function Dash() {
  return <span className="text-[var(--muted)]">—</span>;
}

/** 540 → "+09:00", -300 → "-05:00" */
function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
