import { NextResponse } from "next/server";
import { addEntry, createList, getLists, upsertPlaceStub } from "@/lib/db";
import { listNameFromFilename, parseTakeoutCsv } from "@/lib/takeout";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ lists: await getLists() });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form upload containing a CSV file." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const csv = await file.text();

  let parsed;
  try {
    parsed = parseTakeoutCsv(csv);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not parse the CSV." },
      { status: 400 },
    );
  }

  if (parsed.entries.length === 0) {
    return NextResponse.json(
      { error: "That CSV parsed cleanly but contained no places." },
      { status: 400 },
    );
  }

  const name =
    (form.get("name") as string | null)?.trim() || listNameFromFilename(file.name);

  const listId = await createList({ name, source: "takeout" });

  // Sequential on purpose: upsertPlaceStub dedupes by place_id, and running it
  // concurrently would race two inserts for the same place.
  for (const [index, entry] of parsed.entries.entries()) {
    const placeRef = await upsertPlaceStub({ placeId: entry.placeId, name: entry.title });
    await addEntry({
      listId,
      placeRef,
      sourceTitle: entry.title,
      sourceNote: entry.note,
      sourceUrl: entry.url,
      position: index,
    });
  }

  return NextResponse.json({
    listId,
    imported: parsed.entries.length,
    skipped: parsed.skipped,
  });
}
