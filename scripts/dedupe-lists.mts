/**
 * Backfills google_list_id on existing share-link lists, then reports (or
 * removes) duplicates of the same Google list.
 *
 *   npm run dedupe:lists            report only
 *   npm run dedupe:lists -- --apply keep the oldest copy of each, delete the rest
 *
 * The oldest copy is kept because it is the one most likely to be bookmarked
 * and to carry your tags and notes.
 */
process.loadEnvFile(".env.local");

const apply = process.argv.includes("--apply");

const { pool, ready, deleteList } = await import("../src/lib/db");
const { extractListId, resolveListUrl } = await import("../src/lib/gmaps-list");

await ready();

type Row = {
  id: string;
  name: string;
  source_url: string | null;
  google_list_id: string | null;
  entries: number;
  annotations: number;
  created_at: Date;
};

const { rows } = await pool().query<Row>(
  `SELECT l.id, l.name, l.source_url, l.google_list_id, l.created_at,
          COUNT(e.id)::int AS entries,
          COUNT(*) FILTER (
            WHERE e.status <> 'none' OR e.my_note IS NOT NULL OR e.tags::text <> '[]'
          )::int AS annotations
     FROM lists l LEFT JOIN list_entries e ON e.list_id = l.id
    GROUP BY l.id, l.name, l.source_url, l.google_list_id, l.created_at
    ORDER BY l.created_at`,
);

console.log(`\n${rows.length} list(s) in the database`);

// Backfill: resolve each share URL once so duplicates can be recognised.
console.log("\nbackfilling google_list_id…");
for (const row of rows) {
  if (row.google_list_id || !row.source_url) continue;
  try {
    const googleId = extractListId(await resolveListUrl(row.source_url));
    if (googleId) {
      await pool().query(`UPDATE lists SET google_list_id = $1 WHERE id = $2`, [
        googleId,
        row.id,
      ]);
      row.google_list_id = googleId;
      console.log(`  ${row.id} → ${googleId}`);
    } else {
      console.log(`  ${row.id} → could not resolve a list id`);
    }
  } catch (err) {
    console.log(`  ${row.id} → ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Group by Google list id; lists without one can't be compared, so leave them.
const groups = new Map<string, Row[]>();
for (const row of rows) {
  if (!row.google_list_id) continue;
  const group = groups.get(row.google_list_id) ?? [];
  group.push(row);
  groups.set(row.google_list_id, group);
}

const duplicated = [...groups.entries()].filter(([, g]) => g.length > 1);

if (duplicated.length === 0) {
  console.log("\nNo duplicates found.\n");
  process.exit(0);
}

console.log(`\n${duplicated.length} Google list(s) imported more than once:`);
let toDelete: Row[] = [];

for (const [googleId, group] of duplicated) {
  // Keep the oldest, unless a newer copy carries annotations the oldest lacks.
  const byAnnotations = [...group].sort(
    (a, b) => b.annotations - a.annotations || +a.created_at - +b.created_at,
  );
  const keep = byAnnotations[0];
  const drop = group.filter((r) => r.id !== keep.id);
  toDelete = toDelete.concat(drop);

  console.log(`\n  ${googleId} — "${keep.name}"`);
  console.log(`    KEEP   ${keep.id}  ${keep.entries} entries, ${keep.annotations} annotated`);
  for (const r of drop) {
    console.log(`    delete ${r.id}  ${r.entries} entries, ${r.annotations} annotated`);
  }
}

const annotatedLoss = toDelete.reduce((sum, r) => sum + r.annotations, 0);

if (!apply) {
  console.log(`\n${toDelete.length} list(s) would be deleted.`);
  if (annotatedLoss > 0) {
    console.log(`WARNING: those copies hold ${annotatedLoss} annotated entr(ies) that would be lost.`);
  }
  console.log("Re-run with --apply to delete them.\n");
  process.exit(0);
}

console.log(`\ndeleting ${toDelete.length} duplicate list(s)…`);
for (const row of toDelete) {
  await deleteList(row.id);
  console.log(`  deleted ${row.id}`);
}

const after = await pool().query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM places`);
console.log(`\nDone. ${after.rows[0].n} place rows remain.\n`);
process.exit(0);
