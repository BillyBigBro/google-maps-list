"use client";

import { useEffect, useState, type ReactNode } from "react";
import { flexRender, type Cell, type Table } from "@tanstack/react-table";
import { STATUS_LABELS, STATUS_STYLES, type PlacesTableMeta } from "./usePlacesTable";
import { hasSchedule } from "@/lib/opening-hours";
import type { ListRow, PlaceStatus } from "@/lib/types";

type Props = {
  table: Table<ListRow>;
  totalCount: number;
  selectedId: string | null;
  onSelect: (entryId: string | null) => void;
};

const INPUT_CLASS =
  "rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus:bg-[var(--surface)]";

const CONTROL_CLASS =
  "cursor-pointer rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/20";

export default function PlacesTable({ table, totalCount, selectedId, onSelect }: Props) {
  const [showColumns, setShowColumns] = useState(false);

  const categoryColumn = table.getColumn("category");
  const statusColumn = table.getColumn("myStatus");
  const openColumn = table.getColumn("openNow");
  const openOnly = openColumn?.getFilterValue() === "open";

  const categoryCounts = categoryColumn?.getFacetedUniqueValues();
  // Not memoised: the table object mutates in place, so a memo keyed on it
  // would go stale. A few dozen categories is nothing to recompute.
  const categories = [...(categoryCounts?.keys() ?? [])]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .sort();

  // Selecting a pin on the map brings its row into view in the table.
  useEffect(() => {
    if (!selectedId) return;
    document
      .getElementById(`row-${selectedId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const visibleCount = table.getFilteredRowModel().rows.length;
  // "Open now" can only answer for places with a stored weekly schedule.
  // Lists enriched before schedules were stored have none, and an empty
  // result with no explanation reads like a bug.
  const withSchedule = table
    .getCoreRowModel()
    .rows.filter((r) => hasSchedule(r.original.place.openingHours)).length;
  const rows = table.getRowModel().rows;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={(table.getState().globalFilter as string) ?? ""}
          onChange={(e) => table.setGlobalFilter(e.target.value)}
          placeholder="Search places…"
          className="min-w-0 flex-1 basis-40 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />

        <button
          onClick={() => openColumn?.setFilterValue(openOnly ? undefined : "open")}
          aria-pressed={openOnly}
          title="Only show places open right now, in each place's own local time"
          className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
            openOnly
              ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
          }`}
        >
          {openOnly ? "● Open now" : "Open now"}
        </button>

        <select
          value={(categoryColumn?.getFilterValue() as string) ?? ""}
          onChange={(e) => categoryColumn?.setFilterValue(e.target.value || undefined)}
          className={`${CONTROL_CLASS} max-w-[12rem]`}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c} ({categoryCounts?.get(c) ?? 0})
            </option>
          ))}
        </select>

        <select
          value={(statusColumn?.getFilterValue() as string) ?? ""}
          onChange={(e) => statusColumn?.setFilterValue(e.target.value || undefined)}
          className={CONTROL_CLASS}
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
              <div className="absolute right-0 z-20 mt-1 max-h-96 w-52 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
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

        <span className="text-sm text-[var(--muted)]">
          {visibleCount} of {totalCount}
        </span>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[1] bg-[var(--surface)]">
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
            {rows.map((row) => {
              const selected = row.original.id === selectedId;
              return (
                <tr
                  key={row.id}
                  id={`row-${row.original.id}`}
                  onClick={(e) => {
                    // Editing a cell shouldn't also move the map.
                    if ((e.target as HTMLElement).closest("a, input, select, button, summary")) return;
                    onSelect(selected ? null : row.original.id);
                  }}
                  aria-selected={selected}
                  className={`cursor-pointer border-b border-[var(--border)] transition-colors duration-100 last:border-0 ${
                    selected
                      ? "bg-[var(--surface-active)] shadow-[inset_3px_0_0_var(--accent)]"
                      : "hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-top">
                      {renderCell(cell, table)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={table.getVisibleLeafColumns().length}
                  className="px-3 py-8 text-center text-[var(--muted)]"
                >
                  {openOnly && withSchedule === 0 ? (
                    <>
                      None of these places have opening hours stored yet, so
                      &ldquo;Open now&rdquo; can&apos;t tell. Use{" "}
                      <strong className="text-[var(--foreground)]">Re-fetch all</strong> to load them.
                    </>
                  ) : (
                    "No places match these filters."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Presentation for each column, keyed by the column ids defined in usePlacesTable. */
function renderCell(cell: Cell<ListRow, unknown>, table: Table<ListRow>): ReactNode {
  const row = cell.row.original;
  const place = row.place;
  const value = cell.getValue();
  const { onUpdateEntry } = table.options.meta as PlacesTableMeta;

  switch (cell.column.id) {
    case "name": {
      const href = place.googleMapsUri ?? row.sourceUrl;
      return (
        <div className="min-w-[160px]">
          <span className="font-medium">{value as string}</span>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              title="Open in Google Maps"
              className="ml-1.5 text-xs text-[var(--muted)] hover:text-[var(--accent)]"
            >
              ↗
            </a>
          )}
          {place.lat == null && (
            <p className="text-xs text-[var(--muted)]">no location — not on map</p>
          )}
          {place.enrichError && (
            <p className="text-xs text-rose-500" title={place.enrichError}>
              not enriched
            </p>
          )}
        </div>
      );
    }

    case "rating":
      return value == null ? <Dash /> : <span>{(value as number).toFixed(1)}</span>;

    case "reviews":
      return value == null ? <Dash /> : <span>{(value as number).toLocaleString()}</span>;

    case "address":
    case "listNote":
      return (
        <span className="block max-w-[260px] truncate text-[var(--muted)]" title={(value as string) ?? ""}>
          {(value as string) ?? "—"}
        </span>
      );

    case "openNow": {
      const state = value as "open" | "closed" | "unknown";
      if (state === "unknown") return <Dash />;
      // Without the place's offset we fall back to the viewer's clock, which is
      // only right for places in the viewer's timezone. Say so rather than
      // quietly presenting a guess as fact.
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
    }

    case "hours":
      if (!value) return <Dash />;
      return (
        <details className="max-w-[260px]">
          <summary className="cursor-pointer text-xs text-[var(--accent)]">view</summary>
          <pre className="mt-1 whitespace-pre-wrap text-xs text-[var(--muted)]">{value as string}</pre>
        </details>
      );

    case "website":
      if (!value) return <Dash />;
      return (
        <a
          href={value as string}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] hover:underline"
        >
          {hostname(value as string)}
        </a>
      );

    case "businessStatus":
      return <Muted value={(value as string | null)?.replace(/_/g, " ").toLowerCase() ?? null} />;

    case "myStatus": {
      const status = value as PlaceStatus;
      return (
        <select
          value={status}
          onChange={(e) => onUpdateEntry(row.id, { status: e.target.value })}
          className={`cursor-pointer appearance-none rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none transition-colors duration-150 hover:border-[var(--border)] hover:bg-[var(--surface-hover)] focus-visible:border-[var(--accent)] ${STATUS_STYLES[status]}`}
        >
          {(Object.keys(STATUS_LABELS) as PlaceStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      );
    }

    case "tags":
      return (
        <input
          defaultValue={value as string}
          placeholder="add tags…"
          onBlur={(e) => {
            const next = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
            if (next.join(", ") !== value) onUpdateEntry(row.id, { tags: next });
          }}
          className={`w-32 ${INPUT_CLASS}`}
        />
      );

    case "myNote":
      return (
        <input
          defaultValue={(value as string) ?? ""}
          placeholder="note…"
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next !== ((value as string) ?? "")) onUpdateEntry(row.id, { myNote: next || null });
          }}
          className={`w-40 ${INPUT_CLASS}`}
        />
      );

    default:
      return value == null || value === "" ? <Dash /> : <span>{String(value)}</span>;
  }
}

function Muted({ value }: { value: string | null | undefined }) {
  return value ? <span>{value}</span> : <Dash />;
}

function Dash() {
  return <span className="text-[var(--muted)]">—</span>;
}

/** 540 → "+09:00", -300 → "-05:00" */
export function formatOffset(minutes: number): string {
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
