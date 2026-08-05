import Papa from "papaparse";
import { getList, getListRows } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const list = await getList(id);
  if (!list) return new Response("List not found.", { status: 404 });

  const rows = (await getListRows(id)).map((row) => ({
    Name: row.place.name || row.sourceTitle,
    Category: row.place.primaryType ?? "",
    Rating: row.place.rating ?? "",
    Reviews: row.place.userRatingCount ?? "",
    Price: row.place.priceLevel ?? "",
    Address: row.place.formattedAddress ?? "",
    Phone: row.place.phone ?? "",
    Website: row.place.website ?? "",
    Hours: row.place.openingHours?.weekdayDescriptions.join(" | ") ?? "",
    "Business status": row.place.businessStatus ?? "",
    Latitude: row.place.lat ?? "",
    Longitude: row.place.lng ?? "",
    "List note": row.sourceNote ?? "",
    Status: row.status,
    Tags: row.tags.join(", "),
    "My rating": row.myRating ?? "",
    "My note": row.myNote ?? "",
    "Maps link": row.place.googleMapsUri ?? row.sourceUrl ?? "",
  }));

  const csv = Papa.unparse(rows);
  const filename = `${list.name.replace(/[^\w\s-]/g, "").trim() || "list"}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
