import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap, Marker } from "maplibre-gl";
import type { PublicHop } from "../../shared/types";

export type MapPoint = { key: string; lat: number; lng: number; place: string; idxs: number[] };

export function pointsFor(hops: PublicHop[]): MapPoint[] {
  const byKey = new Map<string, MapPoint>();
  for (const h of hops) {
    if (h.lat == null || h.lng == null) continue;
    const key = `${h.lat},${h.lng}`;
    const p = byKey.get(key);
    if (p) p.idxs.push(h.idx);
    else byKey.set(key, { key, lat: h.lat, lng: h.lng, place: h.place, idxs: [h.idx] });
  }
  return [...byKey.values()];
}

type Props = {
  hops: PublicHop[];
  activeKey: string | null;
  onHoverKey: (key: string | null) => void;
  className?: string;
};

export function TrailMap({ hops, activeKey, onHoverKey, className = "" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, { marker: Marker; dot: HTMLDivElement }>());
  const [ready, setReady] = useState(false);
  const hoverRef = useRef(onHoverKey);
  hoverRef.current = onHoverKey;

  const points = useMemo(() => pointsFor(hops), [hops]);
  const line = useMemo(
    () => hops.filter((h) => h.lat != null && h.lng != null).map((h) => [h.lng!, h.lat!] as [number, number]),
    [hops],
  );

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [maplibregl, worker] = await Promise.all([
        import("maplibre-gl"),
        import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"),
        import("maplibre-gl/dist/maplibre-gl.css"),
      ]);
      if (cancelled || !el.current) return;
      // Bundlers move maplibre away from its worker file; point it there explicitly.
      maplibregl.setWorkerUrl(worker.default);
      const m = new maplibregl.Map({
        container: el.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [-98, 39],
        zoom: 2.6,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("load", () => {
        m.addSource("trail", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } });
        m.addLayer({
          id: "trail-glow",
          type: "line",
          source: "trail",
          paint: { "line-color": "#17402f", "line-width": 6, "line-opacity": 0.12, "line-blur": 2 },
        });
        m.addLayer({
          id: "trail",
          type: "line",
          source: "trail",
          paint: { "line-color": "#17402f", "line-width": 1.6, "line-dasharray": [2, 1.5], "line-opacity": 0.85 },
        });
        map.current = m;
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  // Sync trail + markers with data.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      const src = m.getSource("trail") as import("maplibre-gl").GeoJSONSource | undefined;
      src?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });

      const seen = new Set<string>();
      const last = points.length ? points.reduce((a, b) => (Math.max(...a.idxs) > Math.max(...b.idxs) ? a : b)) : null;
      for (const p of points) {
        seen.add(p.key);
        let entry = markers.current.get(p.key);
        if (!entry) {
          const dot = document.createElement("div");
          dot.className = "fwp-pin";
          dot.addEventListener("mouseenter", () => hoverRef.current(p.key));
          dot.addEventListener("mouseleave", () => hoverRef.current(null));
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            hoverRef.current(p.key);
          });
          const marker = new maplibregl.Marker({ element: dot }).setLngLat([p.lng, p.lat]).addTo(m);
          entry = { marker, dot };
          markers.current.set(p.key, entry);
        }
        entry.dot.dataset.count = String(p.idxs.length);
        entry.dot.dataset.last = String(p === last);
        entry.dot.title = `${p.place} · hop${p.idxs.length > 1 ? "s" : ""} ${p.idxs.slice(0, 6).join(", ")}${p.idxs.length > 6 ? "…" : ""}`;
        entry.dot.textContent = p.idxs.length > 1 ? String(p.idxs.length) : "";
      }
      for (const [key, entry] of markers.current) {
        if (!seen.has(key)) {
          entry.marker.remove();
          markers.current.delete(key);
        }
      }
      if (points.length === 1) m.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 5 });
      else if (points.length > 1) {
        const lngs = points.map((p) => p.lng);
        const lats = points.map((p) => p.lat);
        m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 48, maxZoom: 6, duration: 0 });
      }
    })();
  }, [ready, points, line]);

  useEffect(() => {
    for (const [key, entry] of markers.current) entry.dot.dataset.active = String(key === activeKey);
  }, [activeKey, points]);

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-line bg-paper-2 ${className}`}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!points.length && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
          No pins yet. Every hop drops one, city-level only.
        </div>
      )}
      <style>{`
        .fwp-pin { width: 14px; height: 14px; border-radius: 999px; background: #17402f; border: 2.5px solid #f4efe2;
          box-shadow: 0 1px 4px rgba(0,0,0,.35); cursor: pointer; transition: transform .15s, background .15s;
          display: grid; place-items: center; font: 600 8px/1 'IBM Plex Mono', monospace; color: #f4efe2; }
        .fwp-pin[data-count]:not([data-count="1"]) { width: 20px; height: 20px; }
        .fwp-pin[data-last="true"] { background: #b3261e; }
        .fwp-pin[data-active="true"] { transform: scale(1.7); background: #a97b1c; z-index: 5; }
      `}</style>
    </div>
  );
}
