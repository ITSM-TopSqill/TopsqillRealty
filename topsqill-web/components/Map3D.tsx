"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * A tilted 3D map of the neighbourhood, with buildings in 3D, from free
 * OpenStreetMap data (OpenFreeMap): no API key and no per-view cost.
 * The map code only loads when the map scrolls into view.
 */
const STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function Map3D({ lat, lng, label, approximate = false, height = 360 }: { lat: number; lng: number; label?: string; approximate?: boolean; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "ready" | "failed">("idle");
  const [tilted, setTilted] = useState(true);
  const mapRef = useRef<{ easeTo: (o: Record<string, unknown>) => void; remove: () => void } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    const start = async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !box.current) return;
        // The drawing worker is served from this site (see scripts/copy-map-worker.mjs).
        maplibre.setWorkerUrl("/vendor/maplibre-gl-worker.js");
        const map = new maplibre.Map({
          container: box.current, style: STYLE, center: [lng, lat], zoom: approximate ? 14 : 16.2,
          pitch: 60, bearing: -24, maxPitch: 75, attributionControl: { compact: true }, cooperativeGestures: true,
        });
        map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), "top-right");
        new maplibre.Marker({ color: "#6A3FE0" }).setLngLat([lng, lat]).addTo(map);
        map.on("load", () => { if (!cancelled) setState("ready"); });
        map.on("error", () => { /* a missing tile is not fatal */ });
        mapRef.current = map as never;
      } catch { if (!cancelled) setState("failed"); }
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => { cancelled = true; io.disconnect(); mapRef.current?.remove(); mapRef.current = null; };
  }, [lat, lng, approximate]);

  function toggle() {
    const next = !tilted;
    setTilted(next);
    mapRef.current?.easeTo({ pitch: next ? 60 : 0, bearing: next ? -24 : 0, duration: 900 });
  }

  const google = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return (
    <div>
      <div style={{ position: "relative", height, borderRadius: 14, overflow: "hidden", background: "var(--chip)" }}>
        <div ref={box} style={{ position: "absolute", inset: 0 }} aria-label={`3D map of ${label ?? "the location"}`} role="region" />
        {state !== "ready" ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--ink3)", pointerEvents: "none" }} className="small">
            {state === "failed" ? "The map couldn’t load." : "Loading 3D map…"}
          </div>
        ) : null}
        {state === "ready" ? (
          <button type="button" className="chip" onClick={toggle}
            style={{ position: "absolute", left: 10, top: 10, background: "var(--card)", boxShadow: "0 1px 4px rgba(0,0,0,.2)" }}>
            {tilted ? "Flat view" : "3D view"}
          </button>
        ) : null}
      </div>
      <div className="row small muted" style={{ justifyContent: "space-between", marginTop: 6, flexWrap: "wrap", gap: 6 }}>
        <span>{approximate ? "Approximate location: the centre of the locality." : "Location shared by the seller."}</span>
        <a href={google} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a>
      </div>
    </div>
  );
}
