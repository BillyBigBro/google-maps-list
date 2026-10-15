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

  return (
    <ListView
      list={list}
      rows={await getListRows(id)}
      // A separate key from GOOGLE_MAPS_API_KEY on purpose: this one is sent to
      // the browser, so it must be restricted to this site's domain — and a
      // domain-restricted key can't be used for the server's Places calls.
      // Read per request (not NEXT_PUBLIC_) so it's set in Railway, not baked
      // into the build.
      mapsApiKey={process.env.GOOGLE_MAPS_BROWSER_KEY?.trim() || null}
      // Advanced markers need a Map ID. DEMO_MAP_ID works out of the box;
      // create a real one in Cloud Console for production.
      mapId={process.env.GOOGLE_MAPS_MAP_ID?.trim() || "DEMO_MAP_ID"}
    />
  );
}
