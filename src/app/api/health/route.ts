import { NextResponse } from "next/server";
import { pool, ready } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Railway polls this after each deploy. It checks the database too, so a
 * deploy with a broken DATABASE_URL fails loudly instead of serving 500s.
 *
 * It also reports whether the Places key is present and well-formed. Only
 * derived facts are exposed — never the key itself — so this is safe to hit
 * from a browser, and it answers "is the deployed app configured the way I
 * think it is?" without digging through dashboards.
 */
export async function GET() {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? "";

  const places = {
    configured: key.length > 0,
    // Common paste mistakes that are invisible in a dashboard.
    looksWellFormed: /^AIza[\w-]{30,}$/.test(key),
    hasSurroundingQuotes: /^["'].*["']$/.test(key),
    hasWhitespace: key !== key.trim(),
    length: key.length,
  };

  try {
    await ready();
    await pool().query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected", places });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
        message: err instanceof Error ? err.message : String(err),
        places,
      },
      { status: 503 },
    );
  }
}
