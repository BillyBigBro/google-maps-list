/** Reports duplicate place rows that collide on place_id. */
process.loadEnvFile(".env.local");

const { pool, ready } = await import("../src/lib/db");
await ready();

const lists = await pool().query(
  `SELECT l.id, l.name, COUNT(e.id)::int AS entries
     FROM lists l LEFT JOIN list_entries e ON e.list_id = l.id
    GROUP BY l.id, l.name ORDER BY l.created_at`,
);
console.log("\nlists:");
for (const r of lists.rows) console.log(`  ${r.id}  ${r.entries} entries  ${r.name}`);

const totals = await pool().query(
  `SELECT COUNT(*)::int AS total,
          COUNT(place_id)::int AS with_place_id,
          COUNT(enriched_at)::int AS enriched
     FROM places`,
);
console.log("\nplaces:", totals.rows[0]);

// Rows that mean the same real place but were created separately.
const dupes = await pool().query(
  `SELECT name, COUNT(*)::int AS rows
     FROM places
    GROUP BY name HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, name LIMIT 15`,
);
console.log(`\nplace names appearing on more than one row: ${dupes.rowCount}`);
for (const r of dupes.rows) console.log(`  ${r.rows}x  ${r.name}`);

process.exit(0);
