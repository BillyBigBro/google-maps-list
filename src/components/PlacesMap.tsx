"use client";

import { useEffect, useMemo } from "react";
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  APIProvider,
  ColorScheme,
  InfoWindow,
  Map,
  Pin,
  useMap,
} from "@vis.gl/react-google-maps";
import { openStateAt, type OpenState } from "@/lib/opening-hours";
import type { ListRow } from "@/lib/types";

type Props = {
  apiKey: string | null;
  mapId: string;
  /** The list's icon from Google Maps, drawn on every pin; null for a plain pin. */
  icon: string | null;
  /** Already filtered by the table — the map shows exactly what the table shows. */
  rows: ListRow[];
  now: Date | null;
  selectedId: string | null;
  onSelect: (entryId: string | null) => void;
};

type Located = ListRow & { latLng: google.maps.LatLngLiteral };

/** Google's own pin red, used for lists that have no icon of their own. */
const PIN = { background: "#ea4335", border: "#b31412" };

const WORLD = { lat: 20, lng: 0 };

export default function PlacesMap({ apiKey, mapId, icon, rows, now, selectedId, onSelect }: Props) {
  const located = useMemo(
    () =>
      rows.flatMap((row): Located[] =>
        row.place.lat != null && row.place.lng != null
          ? [{ ...row, latLng: { lat: row.place.lat, lng: row.place.lng } }]
          : [],
      ),
    [rows],
  );

  if (!apiKey) return <MissingKey />;

  const selected = located.find((r) => r.id === selectedId) ?? null;
  const unplaced = rows.length - located.length;

  return (
    <APIProvider apiKey={apiKey}>
      <div className="relative h-full w-full overflow-hidden rounded-lg border border-[var(--border)]">
        <Map
          mapId={mapId}
          defaultCenter={located[0]?.latLng ?? WORLD}
          defaultZoom={located.length ? 11 : 2}
          gestureHandling="greedy"
          colorScheme={ColorScheme.FOLLOW_SYSTEM}
          clickableIcons={false}
          onClick={() => onSelect(null)}
          className="h-full w-full"
        >
          {located.map((row) => {
            const isSelected = row.id === selectedId;
            return (
              <AdvancedMarker
                key={row.id}
                position={row.latLng}
                title={row.place.name}
                zIndex={isSelected ? 1000 : undefined}
                // Saved-place icons in Google Maps sit centred on the place;
                // only the teardrop pin points down at it.
                anchorPoint={icon ? AdvancedMarkerAnchorPoint.CENTER : AdvancedMarkerAnchorPoint.BOTTOM}
                onClick={() => onSelect(row.id)}
              >
                {icon ? (
                  <IconMarker icon={icon} selected={isSelected} />
                ) : (
                  <Pin
                    background={PIN.background}
                    borderColor={PIN.border}
                    glyphColor="#ffffff"
                    scale={isSelected ? 0.85 : 0.6}
                  />
                )}
              </AdvancedMarker>
            );
          })}

          {selected && (
            <InfoWindow
              position={selected.latLng}
              // Clear the selected marker: half a centred 30px icon, or the
              // full height of a selected pin.
              pixelOffset={[0, icon ? -18 : -36]}
              headerContent={<strong className="text-sm text-slate-900">{selected.place.name}</strong>}
              onCloseClick={() => onSelect(null)}
              shouldFocus={false}
            >
              <PlaceCard row={selected} state={now ? openStateAt(selected.place.openingHours, selected.place.utcOffsetMinutes, now) : "unknown"} />
            </InfoWindow>
          )}

          <FitToPlaces places={located} />
          <PanToSelection place={selected} />
        </Map>

        {unplaced > 0 && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-[var(--surface)]/90 px-2.5 py-1 text-xs text-[var(--muted)] shadow">
            {unplaced} place{unplaced === 1 ? " has" : "s have"} no location and aren&apos;t shown
          </div>
        )}
      </div>
    </APIProvider>
  );
}

/**
 * Re-frames the map whenever the set of visible places changes — which is what
 * makes a filter visibly "apply" to the map. Keyed on the ids rather than the
 * array, so editing a note or tag doesn't yank the view around.
 */
function FitToPlaces({ places }: { places: Located[] }) {
  const map = useMap();
  const key = places.map((p) => p.id).join(",");

  useEffect(() => {
    if (!map || places.length === 0) return;

    if (places.length === 1) {
      map.panTo(places[0].latLng);
      map.setZoom(15);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    for (const p of places) bounds.extend(p.latLng);
    map.fitBounds(bounds, 48);
    // Only the membership of the set matters here; see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  return null;
}

/** Selecting a row in the table brings its pin into view. */
function PanToSelection({ place }: { place: Located | null }) {
  const map = useMap();
  const id = place?.id;

  useEffect(() => {
    if (!map || !place) return;
    map.panTo(place.latLng);
    if ((map.getZoom() ?? 0) < 13) map.setZoom(14);
    // Re-run on a new selection, not on every re-render of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id]);

  return null;
}

/**
 * Info windows render on a white Google-drawn card in both themes, so the text
 * colours here are fixed rather than taken from the page's theme variables.
 */
function PlaceCard({ row, state }: { row: Located; state: OpenState }) {
  const p = row.place;
  const href = p.googleMapsUri ?? row.sourceUrl;

  return (
    <div className="max-w-[240px] space-y-1 text-[13px] leading-snug text-slate-700">
      {(p.primaryType || p.rating != null) && (
        <p>
          {p.primaryType}
          {p.primaryType && p.rating != null && " · "}
          {p.rating != null && (
            <span>
              {p.rating.toFixed(1)}★
              {p.userRatingCount != null && (
                <span className="text-slate-500"> ({p.userRatingCount.toLocaleString()})</span>
              )}
            </span>
          )}
          {p.priceLevel && <span className="text-slate-500"> · {p.priceLevel}</span>}
        </p>
      )}

      {state !== "unknown" && (
        <p className={state === "open" ? "font-medium text-emerald-700" : "text-slate-500"}>
          {state === "open" ? "Open now" : "Closed now"}
        </p>
      )}

      {p.formattedAddress && <p className="text-slate-500">{p.formattedAddress}</p>}
      {row.sourceNote && <p className="italic text-slate-600">“{row.sourceNote}”</p>}

      <div className="flex gap-3 pt-1">
        {href && (
          <a href={href} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">
            Google Maps ↗
          </a>
        )}
        {p.website && (
          <a href={p.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
            Website ↗
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * How Google Maps draws places saved to a list: the list's emoji in a small
 * disc, sized to match — Google's are 20px plus a white outline, measured from
 * a screenshot of Google Maps itself. Selection enlarges it and adds a ring, rather than changing the
 * icon, so you can still tell which list a pin came from.
 */
function IconMarker({ icon, selected }: { icon: string; selected: boolean }) {
  return (
    <div
      className={`flex items-center justify-center rounded-full border bg-white shadow-md transition-transform duration-150 ${
        selected
          ? "h-[30px] w-[30px] border-blue-600 text-base ring-2 ring-blue-600/40"
          : "h-[22px] w-[22px] border-white text-[12px] hover:scale-125"
      }`}
    >
      <span aria-hidden="true" className="leading-none">
        {icon}
      </span>
    </div>
  );
}

function MissingKey() {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-dashed border-[var(--border)] p-8 text-center">
      <div className="max-w-sm space-y-2 text-sm text-[var(--muted)]">
        <p className="font-medium text-[var(--foreground)]">Map not configured</p>
        <p>
          Set <code className="text-[var(--foreground)]">GOOGLE_MAPS_BROWSER_KEY</code> to a
          browser key with the Maps JavaScript API enabled, restricted to this site&apos;s
          domain. The table works without it.
        </p>
      </div>
    </div>
  );
}
