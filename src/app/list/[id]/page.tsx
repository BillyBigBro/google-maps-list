import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ListView from "@/components/ListView";
import { getList, getListRows } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const list = await getList(id);
  return { title: list ? `${list.name} — Maps List Dashboard` : "List not found" };
}

export default async function ListPage({ params }: Props) {
  const { id } = await params;

  const list = await getList(id);
  if (!list) notFound();

  return <ListView list={list} rows={await getListRows(id)} />;
}
