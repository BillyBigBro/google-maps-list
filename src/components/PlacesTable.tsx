"use client";

import { useMemo, useState } from "react";
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
      column.accessor((r) => (r.place.openingHours?.openNow ? "Open" : r.place.openingHours ? "Closed" : null), {
        id: "openNow",
        header: "Open now",
        cell: (ctx) => {
          const value = ctx.getValue();
          if (!value) return <Dash />;
          return (
            <span className={value === "Open" ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--muted)]"}>
              {value}
            </span>
          );
        },
      }),
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
            className={`bg-transparent text-sm outline-none ${STATUS_STYLES[ctx.getValue()]}`}
          >
            {(Object.keys(STATUS_LABELS) as PlaceStatus[]).map((s) => (
              <option key={s} value={s} className="text-[var(--foreground)]">
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
            className="w-32 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-[var(--border)]"
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
            className="w-40 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-[var(--border)]"
          />
        ),
      }),
      column.accessor((r) => r.place.lat, { id: "latitude", header: "Lat" }),
      column.accessor((r) => r.place.lng, { id: "longitude", header: "Lng" }),
    ],
    [onUpdateEntry],
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
          className="w-56 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />

        <select
          value={(categoryColumn?.getFilterValue() as string) ?? ""}
          onChange={(e) => categoryColumn?.setFilterValue(e.target.value || undefined)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none"
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
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none"
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
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
          >
            Columns
          </button>
          {showColumns && (
            <div className="absolute z-20 mt-1 w-52 rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
              {table.getAllLeafColumns().map((col) => (
                <label key={col.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={col.getIsVisible()}
                    onChange={col.getToggleVisibilityHandler()}
                  />
                  {typeof col.columnDef.header === "string" ? col.columnDef.header : col.id}
                </label>
              ))}
            </div>
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
                    className={`whitespace-nowrap px-3 py-2 text-left font-medium text-[var(--muted)] ${
                      header.column.getCanSort() ? "cursor-pointer select-none hover:text-[var(--foreground)]" : ""
                    }`}
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
                className="border-b border-[var(--border)] last:border-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
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

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
