import { NextResponse } from "next/server";
import { deleteEntry, updateEntry } from "@/lib/db";
import type { PlaceStatus } from "@/lib/types";

export const runtime = "nodejs";

const STATUSES: PlaceStatus[] = ["none", "want", "visited", "skip"];

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const patch: Parameters<typeof updateEntry>[1] = {};

  if ("tags" in body) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: "tags must be an array." }, { status: 400 });
    }
    patch.tags = body.tags.map(String).map((t) => t.trim()).filter(Boolean);
  }

  if ("status" in body) {
    if (!STATUSES.includes(body.status as PlaceStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    patch.status = body.status as PlaceStatus;
  }

  if ("myRating" in body) {
    const value = body.myRating;
    if (value !== null && (typeof value !== "number" || value < 0 || value > 5)) {
      return NextResponse.json(
        { error: "myRating must be a number from 0 to 5, or null." },
        { status: 400 },
      );
    }
    patch.myRating = value as number | null;
  }

  if ("myNote" in body) {
    patch.myNote = body.myNote == null ? null : String(body.myNote);
  }

  await updateEntry(id, patch);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteEntry(id);
  return NextResponse.json({ ok: true });
}
