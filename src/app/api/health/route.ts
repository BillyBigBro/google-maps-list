import { NextResponse } from "next/server";
import { pool, ready } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Railway polls this after each deploy. It checks the database too, so a
 * deploy with a broken DATABASE_URL fails loudly instead of serving 500s.
 */
export async function GET() {
  try {
    await ready();
    await pool().query("SELECT 1");
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
