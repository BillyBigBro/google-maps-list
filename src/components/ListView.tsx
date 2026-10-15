"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PlacesTable from "@/components/PlacesTable";
import PlacesMap from "@/components/PlacesMap";
import { usePlacesTable } from "@/components/usePlacesTable";
import Button, { ButtonLink } from "@/components/Button";
import { rememberList } from "@/lib/recent";
import type { ListRow, PlaceList } from "@/lib/types";

type Banner = { kind: "info" | "error" | "success"; text: string } | null;

type Props = {
  list: PlaceList;
  rows: ListRow[];
  /** Browser key for the Maps JavaScript API; null renders a setup hint instead. */
  mapsApiKey: string | null;
  mapId: string;
};

export default function ListView({ list, rows, mapsApiKey, mapId }: Props) {
  const router = useRouter();
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * Overlay of edits made in this tab, merged over the server rows at render
   * time. Keeps the table responsive without a data-fetching effect, and
   * survives router.refresh() without needing to be re-seeded.
   */
  const [edits, setEdits] = useState<Record<string, Partial<ListRow>>>({});

  const mergedRows = useMemo(
    () => rows.map((row) => (edits[row.id] ? { ...row, ...edits[row.id] } : row)),
    [rows, edits],
  );

  // Shared by table and map: clicking either one highlights the place in both.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Opening a list by URL is how it gets into this browser's shortcuts.
  useEffect(() => {
    rememberList(list.id);
  }, [list.id]);

  const handleUpdateEntry = useCallback((entryId: string, patch: Record<string, unknown>) => {
    setEdits((current) => ({ ...current, [entryId]: { ...current[entryId], ...patch } }));
    void fetch(`/api/entries/${entryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, []);

  const { table, now } = usePlacesTable(mergedRows, handleUpdateEntry);
  // Filtered (and sorted) exactly as the table shows them — the map's input.
  const visibleRows = table.getRowModel().rows.map((r) => r.original);

  async function handleEnrich(refresh = false) {
    if (
      refresh &&
      !confirm(
        `Re-fetch all ${list.entryCount} places from Google? This costs one API request each — only needed if details look stale or incomplete.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setBanner({ kind: "info", text: "Fetching place details from Google…" });
    try {
      const res = await fetch(`/api/lists/${list.id}/enrich${refresh ? "?refresh=1" : ""}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrichment failed.");

      if (data.abortedReason) {
        // Every remaining request would fail identically, so the run stopped.
        // Report what Google actually said rather than a bare count.
        const untried = data.pending - data.attempted;
        setBanner({
          kind: "error",
          text:
            `Stopped after ${data.attempted} of ${data.pending} places — ${data.abortedReason}` +
            (untried > 0 ? ` The remaining ${untried} weren't attempted.` : ""),
        });
      } else if (data.failed > 0) {
        setBanner({
          kind: "info",
          text: `Enriched ${data.enriched} of ${data.pending}. ${data.failed} couldn't be matched: ${data.errors.slice(0, 3).join("; ")}`,
        });
      } else {
        setBanner({
          kind: "success",
          text: `Enriched all ${data.enriched} place${data.enriched === 1 ? "" : "s"}.`,
        });
      }
      router.refresh();
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Enrichment failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setBanner({ kind: "error", text: "Couldn't copy — copy the URL from the address bar." });
    }
  }

  const unenriched = list.entryCount - list.enrichedCount;

  return (
    <main className="flex w-full flex-col gap-4 p-4 lg:h-dvh lg:p-5">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded text-sm text-[var(--muted)] transition-colors duration-150 hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span aria-hidden="true">←</span> All lists
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold">{list.name}</h1>
          <p className="text-sm text-[var(--muted)]">
            {list.entryCount} place{list.entryCount === 1 ? "" : "s"}
            {unenriched > 0 && ` · ${unenriched} missing details`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => handleEnrich(false)}
            variant="primary"
            busy={busy}
            disabled={unenriched === 0}
            title={
              unenriched === 0
                ? "Every place already has its Google details"
                : `Look up ${unenriched} place${unenriched === 1 ? "" : "s"} via the Places API`
            }
          >
            {busy ? "Fetching…" : unenriched === 0 ? "All details fetched" : "Fetch details"}
          </Button>
          <Button onClick={handleCopyLink} title="Copy this list's URL to share it">
            {copied ? "✓ Copied" : "Copy link"}
          </Button>
          {list.enrichedCount > 0 && (
            <Button
              onClick={() => handleEnrich(true)}
              variant="ghost"
              size="sm"
              disabled={busy}
              title="Fetch every place again, including ones already done"
            >
              Re-fetch all
            </Button>
          )}
          <ButtonLink href={`/api/lists/${list.id}/export`} download>
            Export CSV
          </ButtonLink>
        </div>
      </header>

      {banner && (
        <div
          className={`shrink-0 rounded-md border px-4 py-3 text-sm ${
            banner.kind === "error"
              ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
              : banner.kind === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
          }`}
        >
          {banner.text}
        </div>
      )}

      {unenriched > 0 && !banner && (
        <p className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
          Names, addresses and locations came from the shared list.{" "}
          <strong className="text-[var(--foreground)]">Fetch details</strong> adds hours,
          phone numbers, ratings, categories and websites from Google Places.
        </p>
      )}

      {/*
        One third table, two thirds map on wide screens. Below lg the two stack,
        map first, each with its own height so neither collapses.
      */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-3">
        <section className="order-2 h-[70vh] min-h-0 lg:order-1 lg:col-span-1 lg:h-auto">
          <PlacesTable
            table={table}
            totalCount={mergedRows.length}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </section>
        <section className="order-1 h-[55vh] min-h-0 lg:order-2 lg:col-span-2 lg:h-auto">
          <PlacesMap
            apiKey={mapsApiKey}
            mapId={mapId}
            rows={visibleRows}
            now={now}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </section>
      </div>
    </main>
  );
}
