"use client";

import { useState } from "react";
import { imageUrl } from "@/lib/format";
import type { Media } from "@/lib/types";

/** Photo gallery with thumbnails. Falls back to a plain panel when there are no photos. */
export function Gallery({ media, title }: { media: Media[]; title: string }) {
  const photos = (media ?? []).filter((m) => m.kind === "image" && m.urls);
  const [index, setIndex] = useState(0);

  if (!photos.length) {
    return <div style={{ aspectRatio: "16/7", background: "var(--brand)", opacity: 0.18 }} aria-hidden />;
  }

  const current = photos[Math.min(index, photos.length - 1)];
  return (
    <div>
      <div style={{ position: "relative", aspectRatio: "16/8", background: "var(--chip)" }}>
        <img src={imageUrl(current, "full") ?? ""} alt={current.label ?? title}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {current.label ? (
          <span className="pill" style={{ position: "absolute", right: 12, top: 12, background: "rgba(20,16,40,.6)", color: "#fff" }}>
            {current.label}
          </span>
        ) : null}
        <span className="pill" style={{ position: "absolute", right: 12, bottom: 12, background: "rgba(20,16,40,.6)", color: "#fff" }}>
          {Math.min(index, photos.length - 1) + 1} / {photos.length}
        </span>
      </div>
      {photos.length > 1 ? (
        <div style={{ display: "flex", gap: 6, padding: 8, overflowX: "auto" }}>
          {photos.map((p, i) => (
            <button key={p.id} onClick={() => setIndex(i)} aria-label={p.label ?? `Photo ${i + 1}`}
              style={{ flex: "0 0 96px", aspectRatio: "4/3", borderRadius: 10, overflow: "hidden", border: i === index ? "2px solid var(--vio)" : "2px solid transparent" }}>
              <img src={imageUrl(p, "thumb") ?? ""} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
