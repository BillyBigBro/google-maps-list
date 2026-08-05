import { NextResponse } from "next/server";
import { getList } from "@/lib/db";
import { enrichList } from "@/lib/enrich";
import { hasApiKey } from "@/lib/places";

export const runtime = "nodejs";
// A large list makes one Places request per place; give it room.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;

  if (!(await getList(id))) {
    return NextResponse.json({ error: "List not found." }, { status: 404 });
  }

  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error:
          "No GOOGLE_MAPS_API_KEY configured. Add it to .env.local and restart the dev server to enable enrichment.",
      },
      { status: 400 },
    );
  }

  const result = await enrichList(id);
  return NextResponse.json(result);
}
