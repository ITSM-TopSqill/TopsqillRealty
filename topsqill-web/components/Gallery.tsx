"use client";

import { createElement, useEffect, useState } from "react";
import { imageUrl } from "@/lib/format";
import type { Media } from "@/lib/types";
import { isPlanOrDoc } from "./PlansAndDocs";

/**
 * Photos, videos and 3D models, with thumbnails. Videos play in place and 3D
 * models (.glb) can be turned and zoomed, and viewed in AR on phones that
 * support it. Falls back to a plain panel when there is nothing to show.
 */
export function Gallery({ media, title }: { media: Media[]; title: string }) {
  // Plans and documents have their own section (PlansAndDocs); the gallery is photos, videos and 3D.
  const items = (media ?? []).filter((m) => m.urls && Object.keys(m.urls).length && !isPlanOrDoc(m) && (
    m.kind === "image" || (m.kind === "video" && (m.urls.mp4 || m.urls.hls)) || (m.kind === "model3d" && m.urls.full)));
  const [index, setIndex] = useState(0);

  if (!items.length) {
    return <div style={{ aspectRatio: "16/7", background: "var(--brand)", opacity: 0.18 }} aria-hidden />;
  }

  const i = Math.min(index, items.length - 1);
  const current = items[i];
  const photos = items.filter((m) => m.kind === "image").length;
  return (
    <div>
      <div style={{ position: "relative", aspectRatio: "16/8", background: current.kind === "image" ? "var(--chip)" : "#0d0b1a" }}>
        {current.kind === "image" ? (
          <img src={imageUrl(current, "full") ?? ""} alt={current.label ?? title}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : current.kind === "video" ? (
          // MP4 plays everywhere; the streaming version is used where it is the only one.
          <video key={current.id} controls playsInline preload="metadata" src={current.urls!.mp4 ?? current.urls!.hls}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} aria-label={current.label ?? `Video of ${title}`} />
        ) : (
          <Model key={current.id} src={current.urls!.full} alt={current.label ?? `3D model of ${title}`} />
        )}
        {current.label && current.kind === "image" ? (
          <span className="pill" style={{ position: "absolute", right: 12, top: 12, background: "rgba(20,16,40,.6)", color: "#fff" }}>
            {current.label}
          </span>
        ) : null}
        {current.kind === "image" ? (
          <span className="pill" style={{ position: "absolute", right: 12, bottom: 12, background: "rgba(20,16,40,.6)", color: "#fff" }}>
            {items.slice(0, i + 1).filter((m) => m.kind === "image").length} / {photos}
          </span>
        ) : null}
      </div>
      {items.length > 1 ? (
        <div style={{ display: "flex", gap: 6, padding: 8, overflowX: "auto" }}>
          {items.map((p, n) => (
            <button key={p.id} onClick={() => setIndex(n)} aria-label={p.kind === "video" ? "Video" : p.kind === "model3d" ? "3D model" : p.label ?? `Photo ${n + 1}`}
              style={{ flex: "0 0 96px", aspectRatio: "4/3", borderRadius: 10, overflow: "hidden", border: n === i ? "2px solid var(--vio)" : "2px solid transparent", background: "#1b1736", color: "#fff" }}>
              {p.kind === "image"
                ? <img src={imageUrl(p, "thumb") ?? ""} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 12, fontWeight: 700 }}>{p.kind === "video" ? "▶ Video" : "🧊 3D"}</span>}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** <model-viewer> is loaded only when a 3D model is actually shown. */
function Model({ src, alt }: { src: string; alt: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    import("@google/model-viewer").then(() => { if (live) setReady(true); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!ready) return <div style={{ display: "grid", placeItems: "center", height: "100%", color: "#fff" }} className="small">Loading 3D model…</div>;
  return createElement("model-viewer", {
    src, alt, "camera-controls": true, "auto-rotate": true, "touch-action": "pan-y", ar: true, "shadow-intensity": "1",
    style: { width: "100%", height: "100%", background: "#0d0b1a" },
  });
}
