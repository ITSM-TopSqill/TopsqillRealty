"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { clientApi } from "@/lib/api";

type Place = { label: string; lat: number; lng: number; locality: string | null; city: string | null };
type Map = import("maplibre-gl").Map;
type Marker = import("maplibre-gl").Marker;

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const INDIA: [number, number] = [78.9629, 22.5937];

/**
 * Sets the listing's map location: search a society, building, street or
 * locality; use the phone's current location; jump to the locality's centre;
 * or click / drag the pin onto the exact building. The seller chooses whether
 * buyers see the exact spot or only the area. When the pin moves, the
 * locality and city it falls in are offered back to fill empty fields.
 */
export function LocationPicker({ lat, lng, exact, locality, city, onChange, onPlace }: {
  lat: number | null; lng: number | null; exact: boolean; locality: string; city: string;
  onChange: (v: { lat: number | null; lng: number | null; exact?: boolean }) => void;
  onPlace?: (p: { locality: string | null; city: string | null }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const marker = useRef<Marker | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<"gps" | "centre" | null>(null);
  const [note, setNote] = useState("");
  const [place, setPlace] = useState("");
  const latest = useRef({ onChange, onPlace });
  latest.current = { onChange, onPlace };

  // Moves the pin (and map), reports the point, and looks up where it is.
  async function setPoint(la: number, ln: number, fly = true, label?: string) {
    latest.current.onChange({ lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 });
    placeMarker(la, ln);
    if (fly) map.current?.flyTo({ center: [ln, la], zoom: Math.max(map.current.getZoom(), 16), duration: 900 });
    if (label) setPlace(label);
    const p = await clientApi<Place | null>(`/v1/geo/reverse?lat=${la}&lng=${ln}`).catch(() => null);
    if (p) { if (!label) setPlace(p.label); latest.current.onPlace?.({ locality: p.locality, city: p.city }); }
  }

  function placeMarker(la: number, ln: number) {
    const m = map.current;
    if (!m) return;
    if (!marker.current) {
      import("maplibre-gl").then((ml) => {
        marker.current = new ml.Marker({ color: "#6A3FE0", draggable: true }).setLngLat([ln, la]).addTo(m);
        marker.current.on("dragend", () => { const p = marker.current!.getLngLat(); setPoint(p.lat, p.lng, false); });
      });
    } else marker.current.setLngLat([ln, la]);
  }

  useEffect(() => {
    let gone = false;
    (async () => {
      const ml = await import("maplibre-gl");
      if (gone || !box.current) return;
      ml.setWorkerUrl("/vendor/maplibre-gl-worker.js");
      const m = new ml.Map({ container: box.current, style: STYLE, center: lat != null && lng != null ? [lng, lat] : INDIA, zoom: lat != null ? 16 : 4, attributionControl: { compact: true },
        // On phones, one finger scrolls the page; two move the map (a tap still drops the pin).
        cooperativeGestures: window.matchMedia("(pointer: coarse)").matches });
      m.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.current = m;
      m.on("click", (e) => setPoint(e.lngLat.lat, e.lngLat.lng, false));
      if (lat != null && lng != null) placeMarker(lat, lng);
    })();
    return () => { gone = true; map.current?.remove(); map.current = null; marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggestions as you type (after a short pause, at least 3 letters).
  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await clientApi<{ items: Place[] }>(`/v1/geo/search?q=${encodeURIComponent(text)}${city ? `&near=${encodeURIComponent(city)}` : ""}`).catch((e) => { setNote((e as Error).message); return { items: [] }; });
      setResults(r.items); setSearching(false);
    }, 550);
    return () => clearTimeout(t);
  }, [q, city]);

  function useGps() {
    if (!navigator.geolocation) { setNote("This browser can’t share your location."); return; }
    setBusy("gps"); setNote("");
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(null); setPoint(p.coords.latitude, p.coords.longitude, true, "Your current location"); },
      (e) => { setBusy(null); setNote(e.code === 1 ? "Location permission was refused. Search instead, or allow location for this site." : "Couldn’t get your location. Search instead."); },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }
  async function useCentre() {
    if (!locality && !city) { setNote("Fill in the locality first."); return; }
    setBusy("centre"); setNote("");
    const r = await clientApi<{ items: Place[] }>(`/v1/geo/search?q=${encodeURIComponent([locality, city].filter(Boolean).join(", "))}`).catch(() => ({ items: [] as Place[] }));
    setBusy(null);
    if (!r.items[0]) { setNote(`Couldn’t find ${locality || city} on the map. Search or click on the map instead.`); return; }
    setPoint(r.items[0].lat, r.items[0].lng, true, r.items[0].label);
    latest.current.onChange({ lat: r.items[0].lat, lng: r.items[0].lng, exact: false });
  }

  return (
    <div className="lp">
      <div style={{ position: "relative" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a society, building, street or locality" aria-label="Search for the property's location"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (results[0]) { setPoint(results[0].lat, results[0].lng, true, results[0].label); setQ(""); setResults([]); } } }}
          style={{ width: "100%", paddingLeft: 36 }} />
        <span aria-hidden style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: .6 }}>🔎</span>
        {q.trim().length >= 3 ? (
          <div className="card lp-list" role="listbox">
            {searching ? <div className="small muted" style={{ padding: "10px 12px" }}>Searching…</div> : null}
            {!searching && !results.length ? <div className="small muted" style={{ padding: "10px 12px" }}>No match. Try a nearby landmark, or click on the map.</div> : null}
            {results.map((r) => (
              <button key={`${r.lat},${r.lng}`} type="button" role="option" aria-selected={false} className="lp-opt"
                onClick={() => { setPoint(r.lat, r.lng, true, r.label); setQ(""); setResults([]); }}>
                📍 <b>{r.label}</b>{r.city ? <span className="muted"> · {r.city}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        <button type="button" className="btn btn-o sm" onClick={useGps} disabled={busy !== null}>{busy === "gps" ? "Finding you…" : "📍 Use my current location"}</button>
        <button type="button" className="btn btn-g sm" onClick={useCentre} disabled={busy !== null}>{busy === "centre" ? "Finding…" : `🏘 ${locality ? `Centre of ${locality}` : "Locality centre"}`}</button>
        {lat != null ? <button type="button" className="linklike small" onClick={() => { marker.current?.remove(); marker.current = null; setPlace(""); onChange({ lat: null, lng: null }); }}>Remove location</button> : null}
      </div>
      <div style={{ position: "relative", height: 300, borderRadius: 14, overflow: "hidden", background: "var(--chip)" }}>
        <div ref={box} style={{ position: "absolute", inset: 0 }} role="region" aria-label="Map: click to place the pin, or drag it" />
        {lat == null ? <div className="lp-hint small">Click on the map to drop the pin</div> : null}
      </div>
      <div className="small" style={{ marginTop: 6, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span className="muted">{lat != null ? <>📌 {place || "Pin placed"} · drag the pin to fine-tune</> : "No location yet: buyers won’t see a map."}</span>
        {lat != null ? <span className="muted">{lat.toFixed(5)}, {lng!.toFixed(5)}</span> : null}
      </div>
      {lat != null ? (
        <fieldset className="row" style={{ gap: 14, flexWrap: "wrap", border: 0, padding: 0, margin: "8px 0 0" }}>
          <legend className="small" style={{ fontWeight: 700, marginBottom: 4 }}>What buyers see</legend>
          <label className="row small" style={{ gap: 6 }}><input type="radio" name="lp-exact" checked={exact} onChange={() => onChange({ lat, lng, exact: true })} /> Exact location</label>
          <label className="row small" style={{ gap: 6 }}><input type="radio" name="lp-exact" checked={!exact} onChange={() => onChange({ lat, lng, exact: false })} /> Approximate area only (about 150 m)</label>
        </fieldset>
      ) : null}
      {note ? <p className="small error" style={{ margin: "6px 0 0" }}>{note}</p> : null}
      <style>{`
        .lp-list{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:30;padding:4px;max-height:260px;overflow:auto;box-shadow:0 10px 30px rgba(20,16,40,.16)}
        .lp-opt{display:block;width:100%;text-align:left;padding:9px 10px;border-radius:10px;background:none;border:0;font:inherit;font-size:14px;color:inherit;cursor:pointer}
        .lp-opt:hover,.lp-opt:focus-visible{background:var(--soft)}
        .lp-hint{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:var(--card);padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.15);pointer-events:none;font-weight:700}
      `}</style>
    </div>
  );
}
