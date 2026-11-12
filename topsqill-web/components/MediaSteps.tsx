"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { imageUrl } from "@/lib/format";
import type { Media } from "@/lib/types";
import { MediaUploader, type UploadedItem } from "./MediaUploader";
import { MediaSources } from "./MediaSources";

/**
 * The listing's media, in three clear steps, one card per kind of file:
 *   1. Property media: photos, walkthrough video, reel, 3D model
 *   2. Plans and maps: floor plan, site plan, location map
 *   3. Documents: brochure, price list
 * Each card says what it's for and what files it takes, shows how many are
 * added, and opens its own upload area. Everything is optional except that
 * a listing reads best with photos. Files keep their section, so the listing
 * page can show plans and documents in their own place.
 */
type Cat = { id: string; title: string; desc: string; hint: string; icon: string; tint: string; accept: string; max: number; cover?: boolean };
type Step = { id: string; label: string; color: string; cats: Cat[] };

export const STEPS: Step[] = [
  { id: "media", label: "Step 1 – Property media", color: "#12B76A", cats: [
    { id: "photo", title: "Photos", desc: "Rooms, interiors, exteriors, amenities and views. The first photo is the cover.", hint: "JPG, PNG, WebP or HEIC · up to 20", icon: "📷", tint: "#FFE7D6", accept: "image/*", max: 20, cover: true },
    { id: "video", title: "Walkthrough video", desc: "A property walkthrough or site video.", hint: "MP4 or a video from WhatsApp", icon: "🎬", tint: "#DDEBFF", accept: "video/*", max: 2 },
    { id: "reel", title: "Reel", desc: "A short vertical promotional video of the property or project.", hint: "Vertical video, up to 90 seconds works best", icon: "📱", tint: "#F3E1FF", accept: "video/*", max: 2 },
    { id: "model", title: "3D model", desc: "A 3D model buyers can turn and view in AR on their phone.", hint: ".glb file", icon: "🧊", tint: "#DDF7F1", accept: ".glb,model/gltf-binary", max: 2 },
  ] },
  { id: "plans", label: "Step 2 – Property plans and maps", color: "#2F7FE6", cats: [
    { id: "floorplan", title: "Flat floor plan", desc: "Room-by-room layout with bedrooms, bathrooms, kitchen, balcony and sizes.", hint: "JPG, PNG or PDF", icon: "📐", tint: "#EAF1FF", accept: "image/*,application/pdf", max: 4 },
    { id: "siteplan", title: "Project / site plan", desc: "Towers, blocks, amenities, roads, parking and open spaces.", hint: "JPG, PNG or PDF", icon: "🗺️", tint: "#E7F7E9", accept: "image/*,application/pdf", max: 3 },
    { id: "locationmap", title: "Location map", desc: "Nearby metro, schools, hospitals, malls and highways.", hint: "JPG, PNG or PDF", icon: "📍", tint: "#FFF1D6", accept: "image/*,application/pdf", max: 2 },
  ] },
  { id: "docs", label: "Step 3 – Brochure and prices", color: "#7B3DFF", cats: [
    { id: "brochure", title: "Brochure", desc: "The project or property brochure buyers can download.", hint: "PDF", icon: "📘", tint: "#EEE8FF", accept: "application/pdf,image/*", max: 2 },
    { id: "pricelist", title: "Price list", desc: "Price sheet, payment plan or cost breakup.", hint: "PDF or image", icon: "💰", tint: "#FFF6CC", accept: "application/pdf,image/*", max: 2 },
  ] },
];
const ORDER = STEPS.flatMap((s) => s.cats.map((c) => c.id));
const BY_LABEL: Record<string, string> = { "Walkthrough video": "video", "Reel": "reel", "3D model": "model", "Floor plan": "floorplan", "Site plan": "siteplan", "Location map": "locationmap", "Brochure": "brochure", "Price list": "pricelist" };

/** Which section a file belongs to: the one it was added in, or from its label and kind. */
export function categoryOf(i: UploadedItem): string {
  if (i.category) return i.category;
  const m: Media | undefined = i.media;
  if (m?.label && BY_LABEL[m.label]) return BY_LABEL[m.label];
  if (m?.kind === "video") return "video";
  if (m?.kind === "model3d") return "model";
  if (m?.kind === "document") return "brochure";
  return "photo";
}

/** The order files are saved in: photos first (so the cover is a photo), then video, reel, plans, documents. */
export function orderMedia(items: UploadedItem[]) {
  return [...items].sort((a, b) => ORDER.indexOf(categoryOf(a)) - ORDER.indexOf(categoryOf(b)));
}

export function MediaSteps({ items, onChange }: { items: UploadedItem[]; onChange: Dispatch<SetStateAction<UploadedItem[]>> }) {
  const byCat = (id: string) => items.filter((i) => categoryOf(i) === id);
  const [open, setOpen] = useState<string | null>(() => (items.length ? null : "photo"));
  const total = 30;

  function setCat(id: string, next: UploadedItem[]) {
    const tagged = next.map((n) => ({ ...n, category: n.category ?? id }));
    // Uploads report progress long after they start, so merge into the latest
    // list: other sections' files stay as they are now, this section's are replaced.
    onChange((prev) => orderMedia([...prev.filter((i) => categoryOf(i) !== id), ...tagged]));
  }

  return (
    <div className="msteps">
      {STEPS.map((step, si) => {
        const done = step.cats.some((c) => byCat(c.id).length);
        return (
          <section key={step.id} style={{ marginTop: si ? 18 : 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="ms-step" style={{ color: step.color, background: `color-mix(in srgb, ${step.color} 13%, transparent)` }}>{step.label}</span>
              {done ? <span className="small" style={{ color: step.color, fontWeight: 700 }}>✓ Added</span> : null}
            </div>
            <div className="ms-card">
              {step.id === "media" ? (
                <div className="ms-src">
                  <span className="small"><b>Photos on your phone?</b> Send them to Topsqill on WhatsApp or pick from your Instagram:</span>
                  <MediaSources room={total - items.length} have={items.map((m) => m.mediaId)}
                    onAdd={(added) => onChange((prev) => orderMedia([...prev, ...added.filter((a) => !prev.some((x) => x.mediaId === a.mediaId))
                      .map((a) => ({ ...a, category: a.media?.kind === "video" ? "video" : "photo" }))]))} />
                </div>
              ) : null}
              {step.cats.map((c) => {
                const n = ORDER.indexOf(c.id) + 1;
                const files = byCat(c.id);
                const isOpen = open === c.id;
                const busy = files.some((f) => f.status === "uploading" || f.status === "processing");
                const thumbs = files.slice(0, 3).map((f) => imageUrl(f.media, "thumb") ?? f.previewUrl).filter(Boolean) as string[];
                return (
                  <div key={c.id} className={`ms-row${isOpen ? " open" : ""}`}>
                    <button type="button" className="ms-head" aria-expanded={isOpen} aria-controls={`ms-${c.id}`} onClick={() => setOpen(isOpen ? null : c.id)}>
                      <span className="ms-tile" style={{ background: c.tint }} aria-hidden>
                        {thumbs.length ? <img src={thumbs[0]} alt="" /> : <span>{c.icon}</span>}
                      </span>
                      <span className="ms-text">
                        <b>{n}. {c.title}</b>
                        <span>{c.desc}</span>
                        <small>{c.hint}</small>
                      </span>
                      <span className="ms-state">
                        {busy ? <span className="ms-pill busy">Uploading…</span>
                          : files.length ? <span className="ms-pill ok">✓ {files.length} added</span>
                          : <span className="ms-pill">{c.cover ? "Recommended" : "Optional"}</span>}
                        <span className="ms-add">{isOpen ? "Close" : files.length ? "Manage" : "+ Add"}</span>
                      </span>
                    </button>
                    {isOpen ? (
                      <div id={`ms-${c.id}`} className="ms-body">
                        <MediaUploader items={files} onChange={(next) => setCat(c.id, next)} max={c.max} accept={c.accept} coverFirst={c.cover}
                          category={c.id} icon={c.icon} compact
                          title={`Add ${c.title.toLowerCase()}`} hint={`Drag files here, or tap to choose · ${c.hint}`} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {step.id === "media" ? <p className="small muted" style={{ margin: "10px 2px 0" }}>Each upload is optional, but listings with photos and a video get far more enquiries.</p> : null}
            </div>
          </section>
        );
      })}
      <style>{`
        .ms-step{display:inline-block;font-size:12.5px;font-weight:800;padding:4px 10px;border-radius:999px}
        .ms-card{border:1.5px solid var(--line);border-radius:16px;padding:6px 14px 12px;background:var(--card)}
        .ms-src{display:flex;flex-direction:column;gap:6px;padding:10px 0 4px}
        .ms-row{border-top:1px solid var(--line)}
        .ms-src + .ms-row{border-top:1px solid var(--line)}
        .ms-card > .ms-row:first-child{border-top:0}
        .ms-head{display:flex;align-items:center;gap:14px;width:100%;padding:14px 2px;background:none;border:0;text-align:left;cursor:pointer;color:inherit;font:inherit;border-radius:12px}
        .ms-head:hover .ms-add{background:var(--vio);color:#fff}
        .ms-head:focus-visible{outline:2px solid var(--vio);outline-offset:2px}
        .ms-tile{flex:0 0 64px;width:64px;height:64px;border-radius:14px;display:grid;place-items:center;font-size:30px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.05)}
        .ms-tile img{width:100%;height:100%;object-fit:cover}
        .ms-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
        .ms-text b{font-size:15.5px}
        .ms-text span{font-size:14px;color:var(--ink2)}
        .ms-text small{font-size:12px;color:var(--ink3)}
        .ms-state{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:0 0 auto}
        .ms-pill{font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;background:var(--chip);color:var(--ink2);white-space:nowrap}
        .ms-pill.ok{background:color-mix(in srgb,#12B76A 15%,transparent);color:#0E8F55}
        .ms-pill.busy{background:color-mix(in srgb,#E08A00 15%,transparent);color:#B26B00}
        .ms-add{font-size:13px;font-weight:800;color:var(--vio);border:1.5px solid var(--vio);border-radius:999px;padding:4px 12px;white-space:nowrap;transition:background .15s,color .15s}
        .ms-body{padding:0 2px 14px}
        @media (max-width:560px){
          .ms-head{flex-wrap:wrap;gap:10px}
          .ms-tile{flex-basis:52px;width:52px;height:52px;font-size:24px}
          .ms-text{flex-basis:calc(100% - 66px)}
          .ms-state{flex-direction:row;align-items:center;width:100%;justify-content:space-between;padding-left:62px}
        }
      `}</style>
    </div>
  );
}
