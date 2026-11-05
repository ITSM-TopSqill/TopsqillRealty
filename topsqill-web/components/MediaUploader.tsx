"use client";

import { useRef, useState } from "react";
import { clientApi } from "@/lib/api";
import { imageUrl } from "@/lib/format";
import type { Media } from "@/lib/types";

/**
 * Uploads photos and videos straight from the browser to Cloud Storage.
 *
 * The file never passes through our servers: the API issues a short-lived signed
 * link, the browser PUTs to it, then tells the API the upload finished. That
 * keeps big videos fast and the API free to answer other requests.
 */
export type UploadedItem = { mediaId: string; name: string; progress: number; status: "uploading" | "processing" | "ready" | "failed"; media?: Media; error?: string; previewUrl?: string };

const MAX = { image: 25e6, video: 500e6, document: 25e6 } as const;

export function MediaUploader({ items, onChange, max = 20, accept = "image/*,video/*,application/pdf" }: {
  items: UploadedItem[]; onChange: (items: UploadedItem[]) => void; max?: number; accept?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function update(mediaId: string, patch: Partial<UploadedItem>) {
    onChange(items.map((i) => (i.mediaId === mediaId ? { ...i, ...patch } : i)));
  }

  async function handleFiles(files: FileList | File[]) {
    setError("");
    const list = Array.from(files).slice(0, Math.max(0, max - items.length));
    if (!list.length) { setError(`You can add up to ${max} files.`); return; }

    for (const file of list) {
      const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "document";
      if (file.size > MAX[kind]) {
        setError(`${file.name} is too large. The limit is ${Math.round(MAX[kind] / 1e6)} MB.`);
        continue;
      }
      try {
        // 1. Ask the API where to put it.
        const ticket = await clientApi<{ mediaId: string; uploadUrl: string; method: string; headers: Record<string, string> }>(
          "/v1/media/uploads", { method: "POST", body: { mimeType: file.type, bytes: file.size, filename: file.name } },
        );
        const entry: UploadedItem = {
          mediaId: ticket.mediaId, name: file.name, progress: 0, status: "uploading",
          previewUrl: kind === "image" ? URL.createObjectURL(file) : undefined,
        };
        items = [...items, entry];
        onChange(items);

        // 2. Send the bytes straight to storage, reporting progress as it goes.
        await putWithProgress(ticket.uploadUrl, file, ticket.headers, (pct) => update(ticket.mediaId, { progress: pct }));

        // 3. Tell the API, which queues resizing or video conversion.
        await clientApi(`/v1/media/${ticket.mediaId}/confirm`, { method: "POST" });
        update(ticket.mediaId, { status: "processing", progress: 100 });
        watch(ticket.mediaId);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  /** Processing happens in the background, so poll until the file is ready. */
  function watch(mediaId: string) {
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      try {
        const media = await clientApi<Media>(`/v1/media/${mediaId}`);
        if (media.status === "ready" || media.status === "failed") {
          clearInterval(timer);
          update(mediaId, { status: media.status as UploadedItem["status"], media });
        }
      } catch { /* keep trying */ }
      if (tries > 40) { clearInterval(timer); update(mediaId, { status: "failed", error: "Processing is taking longer than usual." }); }
    }, 2000);
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
        style={{
          border: `2px dashed ${dragging ? "var(--vio)" : "var(--line)"}`, borderRadius: 14,
          padding: "26px 18px", textAlign: "center", cursor: "pointer",
          background: dragging ? "color-mix(in srgb, var(--vio) 7%, var(--card))" : "var(--soft)",
        }}
      >
        <div style={{ fontSize: 28 }} aria-hidden>📷</div>
        <b>Add photos and videos</b>
        <div className="small muted">Drag them here, or click to choose. Exterior, rooms, amenities and a walkthrough video.</div>
      </div>
      <input ref={input} type="file" accept={accept} multiple hidden
        onChange={(e) => { const f = e.target.files; e.currentTarget.value = ""; if (f) handleFiles(f); }} />

      {error ? <p className="error" style={{ marginTop: 8 }}>{error}</p> : null}

      {items.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 10, marginTop: 12 }}>
          {items.map((it) => (
            <figure key={it.mediaId} style={{ margin: 0, position: "relative", borderRadius: 12, overflow: "hidden", background: "var(--chip)", aspectRatio: "4/3" }}>
              {it.previewUrl || it.media ? (
                <img src={imageUrl(it.media, "thumb") ?? it.previewUrl} alt={it.name}
                  style={{ width: "100%", height: "100%", objectFit: "cover", opacity: it.status === "ready" ? 1 : 0.6 }} />
              ) : (
                <div style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 24 }} aria-hidden>🎬</div>
              )}

              {it.status !== "ready" ? (
                <div style={{ position: "absolute", inset: "auto 0 0 0", background: "rgba(20,16,40,.72)", color: "#fff", fontSize: 11, padding: "4px 6px" }}>
                  {it.status === "uploading" ? `Uploading ${it.progress}%` : it.status === "processing" ? "Processing…" : "Failed"}
                </div>
              ) : it.media?.label ? (
                <figcaption style={{ position: "absolute", inset: "auto 0 0 0", background: "rgba(20,16,40,.6)", color: "#fff", fontSize: 11, padding: "4px 6px" }}>
                  {it.media.label}
                </figcaption>
              ) : null}

              <button type="button" aria-label={`Remove ${it.name}`}
                onClick={() => onChange(items.filter((x) => x.mediaId !== it.mediaId))}
                style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,.92)", fontWeight: 800 }}>
                ×
              </button>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** XMLHttpRequest is used instead of fetch because it reports upload progress. */
function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    if (url.startsWith("dev://")) { onProgress(100); resolve(); return; }   // local development without storage
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Please check your connection."));
    xhr.send(file);
  });
}
