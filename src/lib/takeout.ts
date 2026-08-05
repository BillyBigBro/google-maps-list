import Papa from "papaparse";
import { parseMapsUrl } from "./maps-url";

export type ImportedEntry = {
  title: string;
  note: string | null;
  url: string | null;
  placeId: string | null;
};

export type ParsedTakeout = {
  entries: ImportedEntry[];
  /** Rows that had no usable title, reported back so imports aren't silently lossy. */
  skipped: number;
};

/**
 * Google Takeout writes one CSV per saved list with a "Title,Note,URL" header.
 * Header casing and the note column's name have both changed over the years,
 * so columns are matched loosely rather than by exact string.
 */
const COLUMN_ALIASES = {
  title: ["title", "name", "place"],
  note: ["note", "notes", "comment", "comments", "description"],
  url: ["url", "link", "google maps url", "maps url"],
} as const;

export function parseTakeoutCsv(csv: string): ParsedTakeout {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const headers = (parsed.meta.fields ?? []).map((f) => f.toLowerCase());
  const titleKey = pickColumn(headers, COLUMN_ALIASES.title);
  const noteKey = pickColumn(headers, COLUMN_ALIASES.note);
  const urlKey = pickColumn(headers, COLUMN_ALIASES.url);

  if (!titleKey && !urlKey) {
    throw new Error(
      "Could not find a Title or URL column. Expected a Google Takeout list CSV with headers like \"Title,Note,URL\".",
    );
  }

  const entries: ImportedEntry[] = [];
  let skipped = 0;

  for (const row of parsed.data) {
    const url = urlKey ? clean(row[urlKey]) : null;
    const parsedUrl = url ? parseMapsUrl(url) : null;
    // Fall back to the name embedded in the URL when the Title cell is blank.
    const title = (titleKey ? clean(row[titleKey]) : null) ?? parsedUrl?.name ?? null;

    if (!title) {
      skipped++;
      continue;
    }

    entries.push({
      title,
      note: noteKey ? clean(row[noteKey]) : null,
      url,
      placeId: parsedUrl?.placeId ?? null,
    });
  }

  return { entries, skipped };
}

/** Guess a list name from the CSV filename Takeout produced, e.g. "Want to go.csv". */
export function listNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base.length > 0 ? base : "Imported list";
}

function pickColumn(headers: string[], aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const hit = headers.find((h) => h === alias);
    if (hit) return hit;
  }
  // Fall back to a substring match ("place title", "maps url", …).
  for (const alias of aliases) {
    const hit = headers.find((h) => h.includes(alias));
    if (hit) return hit;
  }
  return null;
}

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
