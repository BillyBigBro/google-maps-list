import Dashboard from "@/components/Dashboard";
import { getListRows, getLists } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const { list } = await searchParams;
  const lists = await getLists();

  // Fall back to the newest list when the URL names one that no longer exists.
  const active = lists.find((l) => l.id === list) ?? lists[0] ?? null;
  const rows = active ? await getListRows(active.id) : [];

  return <Dashboard lists={lists} activeList={active} rows={rows} />;
}
