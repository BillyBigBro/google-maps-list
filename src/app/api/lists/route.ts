import { NextResponse } from "next/server";
import { getListsByIds } from "@/lib/db";
import { importFromCsvText, importFromShareLink } from "@/lib/import";
import { ListFetchError } from "@/lib/gmaps-list";

export const runtime = "nodejs";
// Reading a long list plus writing every row can take a while.
export const maxDuration = 120;

/** Bulk lookup for the caller's remembered lists (?ids=a,b,c). */
export async function GET(request: Request) {
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  return NextResponse.json({ lists: await getListsByIds(ids) });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  return contentType.includes("application/json")
    ? handleLink(request)
    : handleCsv(request);
}

async function handleLink(request: Request) {
  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json({ error: "Paste a Google Maps list link." }, { status: 400 });
  }

  try {
    return NextResponse.json(await importFromShareLink(url));
  } catch (err) {
    if (err instanceof ListFetchError) {
      return NextResponse.json(
        { error: err.message, hint: err.hint ?? null },
        { status: 400 },
      );
    }
    console.error("[import] share link failed:", err);
    return NextResponse.json(
      {
        error: "Couldn't read that list from Google.",
        hint: "Check the link, or import a Takeout CSV instead.",
      },
      { status: 502 },
    );
  }
}

async function handleCsv(request: Request) {
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

  try {
    const result = await importFromCsvText(
      await file.text(),
      file.name,
      form.get("name") as string | null,
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not parse the CSV." },
      { status: 400 },
    );
  }
}
