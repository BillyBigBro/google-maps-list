"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/Button";
import { forgetList, getRecentIds, rememberList } from "@/lib/recent";
import type { PlaceList } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint: string | null } | null>(null);
  const [recent, setRecent] = useState<PlaceList[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // localStorage is client-only, so recents load after mount rather than in render.
  useEffect(() => {
    const load = async (): Promise<PlaceList[]> => {
      const ids = getRecentIds();
      if (ids.length === 0) return [];

      const res = await fetch(`/api/lists?ids=${ids.join(",")}`);
      const data = (await res.json()) as { lists: PlaceList[] };

      // Preserve most-recently-opened order, and drop anything since deleted.
      const byId = new Map(data.lists.map((l) => [l.id, l]));
      return ids.map((id) => byId.get(id)).filter((l): l is PlaceList => Boolean(l));
    };

    load().then(setRecent, () => setRecent([]));
  }, []);

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || busy) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({ message: data.error ?? "Couldn't read that list.", hint: data.hint ?? null });
        return;
      }
      rememberList(data.listId);
      router.push(`/list/${data.listId}`);
    } catch {
      setError({ message: "Network error. Is the server running?", hint: null });
    } finally {
      setBusy(false);
    }
  }

  async function handleCsv(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/lists", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError({ message: data.error ?? "Import failed.", hint: null });
        return;
      }
      rememberList(data.listId);
      router.push(`/list/${data.listId}`);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Maps List Dashboard</h1>
        <p className="mt-2 text-[var(--muted)]">
          Paste a shared Google Maps list and get a sortable table of every place in it.
        </p>
      </div>

      <form onSubmit={handlePaste} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-3 outline-none transition-colors duration-150 hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
          <Button type="submit" variant="primary" size="lg" busy={busy} disabled={!url.trim()}>
            {busy ? "Reading…" : "Read list"}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
            <p>{error.message}</p>
            {error.hint && <p className="mt-1 opacity-80">{error.hint}</p>}
          </div>
        )}

        <p className="text-center text-xs text-[var(--muted)]">
          In Google Maps: open your list → <strong>Share</strong> → copy link. The list
          must be shared for us to read it.
        </p>
      </form>

      <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
        <span className="h-px flex-1 bg-[var(--border)]" />
        or
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <div className="text-center">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleCsv(file);
          }}
        />
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-[var(--accent)] transition-colors duration-150 hover:bg-[var(--surface-hover)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-50"
        >
          Import a Google Takeout CSV instead
        </button>
      </div>

      {recent && recent.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-[var(--muted)]">Your lists</h2>
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            {recent.map((list) => (
              <li
                key={list.id}
                className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 first:rounded-t-lg last:rounded-b-lg hover:bg-[var(--surface-hover)]"
              >
                <Link
                  href={`/list/${list.id}`}
                  className="min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <span className="font-medium group-hover:text-[var(--accent)]">
                    {list.name}
                  </span>
                  <span className="ml-2 text-sm text-[var(--muted)]">
                    {list.entryCount} place{list.entryCount === 1 ? "" : "s"}
                  </span>
                </Link>
                <button
                  onClick={() => {
                    forgetList(list.id);
                    setRecent((cur) => (cur ?? []).filter((l) => l.id !== list.id));
                  }}
                  className="cursor-pointer rounded px-2 py-1 text-xs text-[var(--muted)] opacity-0 transition-all duration-150 hover:bg-[var(--surface-active)] hover:text-[var(--foreground)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] group-hover:opacity-100"
                  title="Remove from this list of shortcuts (the list itself is kept)"
                >
                  hide
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Remembered in this browser only. Bookmark a list&apos;s URL to keep it.
          </p>
        </div>
      )}
    </main>
  );
}
