"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PlacesTable from "@/components/PlacesTable";
import type { ListRow, PlaceList } from "@/lib/types";

type Banner = { kind: "info" | "error" | "success"; text: string } | null;

type Props = {
  lists: PlaceList[];
  activeList: PlaceList | null;
  rows: ListRow[];
};

export default function Dashboard({ lists, activeList, rows }: Props) {
  const router = useRouter();
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState<"import" | "enrich" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * Overlay of edits made in this tab, merged over the server rows at render
   * time. This keeps the table responsive without a data-fetching effect, and
   * survives router.refresh() re-renders without needing to be re-seeded.
   */
  const [edits, setEdits] = useState<Record<string, Partial<ListRow>>>({});

  const mergedRows = useMemo(
    () => rows.map((row) => (edits[row.id] ? { ...row, ...edits[row.id] } : row)),
    [rows, edits],
  );

  const handleUpdateEntry = useCallback(
    (entryId: string, patch: Record<string, unknown>) => {
      setEdits((current) => ({ ...current, [entryId]: { ...current[entryId], ...patch } }));
      void fetch(`/api/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    [],
  );

  async function handleImport(file: File) {
    setBusy("import");
    setBanner(null);
    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/lists", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed.");

      setBanner({
        kind: "success",
        text:
          `Imported ${data.imported} places` +
          (data.skipped ? `, skipped ${data.skipped} unusable rows` : "") +
          `. Click "Fetch details" to fill in hours, phone and website.`,
      });
      router.push(`/?list=${data.listId}`);
      router.refresh();
    } catch (err) {
      setBanner({ kind: "error", text: err instanceof Error ? err.message : "Import failed." });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleEnrich() {
    if (!activeList) return;
    setBusy("enrich");
    setBanner({ kind: "info", text: "Fetching place details from Google…" });

    try {
      const res = await fetch(`/api/lists/${activeList.id}/enrich`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrichment failed.");

      setBanner({
        kind: data.failed > 0 ? "info" : "success",
        text:
          `Enriched ${data.enriched} of ${data.attempted} places.` +
          (data.failed > 0 ? ` ${data.failed} failed — ${data.errors[0] ?? ""}` : ""),
      });
      router.refresh();
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Enrichment failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteList() {
    if (!activeList) return;
    if (!confirm(`Delete "${activeList.name}" and its ${activeList.entryCount} places?`)) return;

    await fetch(`/api/lists/${activeList.id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  const unenriched = activeList ? activeList.entryCount - activeList.enrichedCount : 0;

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Maps List Dashboard</h1>
          <p className="text-sm text-[var(--muted)]">
            Import a saved list, enrich it with Google Places data, then sort and tag it.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "import" ? "Importing…" : "Import Takeout CSV"}
          </button>
        </div>
      </header>

      {banner && (
        <div
          className={`rounded-md border px-4 py-3 text-sm ${
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

      {lists.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
            {lists.map((list) => (
              <button
                key={list.id}
                onClick={() => router.push(`/?list=${list.id}`)}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  list.id === activeList?.id
                    ? "bg-[var(--accent)] text-white"
                    : "border border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                {list.name}
                <span className="ml-2 opacity-70">{list.entryCount}</span>
              </button>
            ))}

            {activeList && (
              <div className="ml-auto flex items-center gap-2">
                {unenriched > 0 && (
                  <span className="text-sm text-[var(--muted)]">
                    {unenriched} place{unenriched === 1 ? "" : "s"} missing details
                  </span>
                )}
                <button
                  onClick={handleEnrich}
                  disabled={busy !== null || unenriched === 0}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {busy === "enrich" ? "Fetching…" : "Fetch details"}
                </button>
                <a
                  href={`/api/lists/${activeList.id}/export`}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                >
                  Export CSV
                </a>
                <button
                  onClick={handleDeleteList}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-rose-600 dark:text-rose-400"
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          <PlacesTable
            key={activeList?.id ?? "none"}
            rows={mergedRows}
            onUpdateEntry={handleUpdateEntry}
          />
        </>
      )}
    </main>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] p-10 text-center">
      <h2 className="text-lg font-medium">No lists yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--muted)]">
        Export your saved lists from{" "}
        <a
          href="https://takeout.google.com/settings/takeout/custom/maps"
          target="_blank"
          rel="noreferrer"
          className="text-[var(--accent)] hover:underline"
        >
          Google Takeout
        </a>{" "}
        (choose <strong>Saved</strong>), unzip the archive, and import any of the CSV files
        it produces — one per list. Then click <strong>Fetch details</strong> to pull in
        hours, phone numbers, ratings and categories from the Places API.
      </p>
    </div>
  );
}
