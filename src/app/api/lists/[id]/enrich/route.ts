import { NextResponse } from "next/server";
import { getList, resetEnrichment } from "@/lib/db";
import { enrichList } from "@/lib/enrich";
import { hasApiKey } from "@/lib/places";

export const runtime = "nodejs";
// A large list makes one Places request per place; give it room.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;

  // ?refresh=1 re-fetches places already enriched, for when the stored shape
  // has changed. Costs a request per place, so it is never the default.
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";

  if (!(await getList(id))) {
    return NextResponse.json({ error: "List not found." }, { status: 404 });
  }

  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error:
          "No GOOGLE_MAPS_API_KEY configured. Add it to your environment and restart to enable enrichment.",
      },
      { status: 400 },
    );
  }

  if (refresh) await resetEnrichment(id);

  return NextResponse.json(await enrichList(id));
}
