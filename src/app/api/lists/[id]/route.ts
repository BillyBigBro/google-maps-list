import { NextResponse } from "next/server";
import { deleteList, getList, getListRows, renameList } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const list = await getList(id);
  if (!list) return NextResponse.json({ error: "List not found." }, { status: 404 });

  return NextResponse.json({ list, rows: await getListRows(id) });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getList(id))) {
    return NextResponse.json({ error: "List not found." }, { status: 404 });
  }

  const body = (await request.json()) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "A non-empty name is required." }, { status: 400 });
  }

  await renameList(id, name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteList(id);
  return NextResponse.json({ ok: true });
}
