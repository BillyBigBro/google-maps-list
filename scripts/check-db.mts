/**
 * Verifies DATABASE_URL actually connects and reports what's in there.
 *
 *   npm run check:db
 */
process.loadEnvFile(".env.local");

const { pool, ready } = await import("../src/lib/db");

const target = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
console.log(`\nconnecting to ${target || "(DATABASE_URL not set)"}`);

try {
  await ready();

  const info = await pool().query<{ db: string; v: string }>(
    "SELECT current_database() AS db, version() AS v",
  );
  console.log(`  database : ${info.rows[0].db}`);
  console.log(`  server   : ${info.rows[0].v.split(" on ")[0]}`);

  const tables = await pool().query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  console.log(`  tables   : ${tables.rows.map((r) => r.table_name).join(", ") || "(none)"}`);

  const counts = await pool().query<{ lists: number; places: number; entries: number }>(
    `SELECT (SELECT COUNT(*) FROM lists)        AS lists,
            (SELECT COUNT(*) FROM places)       AS places,
            (SELECT COUNT(*) FROM list_entries) AS entries`,
  );
  const { lists, places, entries } = counts.rows[0];
  console.log(`  rows     : ${lists} lists, ${entries} entries, ${places} places`);

  console.log("\nConnection OK.\n");
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`\nConnection FAILED: ${message}`);

  if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
    console.log("Hint: the host doesn't resolve — is this still the internal railway host?");
  } else if (/ETIMEDOUT|ECONNREFUSED/.test(message)) {
    console.log("Hint: host resolves but nothing answered — check the TCP proxy port.");
  } else if (/password|authentication/i.test(message)) {
    console.log("Hint: wrong password — copy PGPASSWORD from the Postgres service.");
  }
  console.log();
  process.exit(1);
}
