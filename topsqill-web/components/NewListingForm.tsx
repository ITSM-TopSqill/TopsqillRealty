"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import Link from "next/link";
import type { UploadedItem } from "./MediaUploader";
import { MediaSteps, orderMedia } from "./MediaSteps";
import { LocationPicker } from "./LocationPicker";
import { refreshPages } from "@/lib/refresh";
import type { Listing } from "@/lib/types";
import { ImportFromLink, type ImportDraft, type ImportConfig } from "./ImportFromLink";
import { videoEmbed, tourEmbed } from "@/lib/embeds";
import { buildPlan, canPlan } from "@/lib/floorplan";
import { PlanSvg } from "./HomeViews";

const KINDS = ["Apartment", "Builder floor", "Villa", "Plot", "Office", "Shop"];
const CITIES = ["Gurgaon", "Noida", "Greater Noida", "Delhi", "Faridabad", "Mumbai", "Pune", "Bengaluru", "Hyderabad"];

type Form = {
  title: string; purpose: "sale" | "rent"; kind: string; bhk: string; areaSqft: string; priceInr: string;
  city: string; locality: string; possession: string; furnishing: string; facing: string;
  description: string; amenities: string; usps: string;
  videoUrl: string; tourUrl: string; reraNumber: string;
  lat: number | null; lng: number | null; exact: boolean; sourceUrl: string;
};

const EMPTY: Form = {
  title: "", purpose: "sale", kind: "Apartment", bhk: "3", areaSqft: "", priceInr: "",
  city: "", locality: "", possession: "Ready to move", furnishing: "Unfurnished", facing: "",
  description: "", amenities: "", usps: "",
  videoUrl: "", tourUrl: "", reraNumber: "", lat: null, lng: null, exact: true, sourceUrl: "",
};

function fromListing(l: Listing): Form {
  return {
    title: l.title, purpose: l.purpose, kind: l.kind, bhk: l.bhk != null ? String(l.bhk) : "",
    areaSqft: l.areaSqft != null ? String(l.areaSqft) : "", priceInr: l.priceInr != null ? String(l.priceInr) : "",
    city: l.city, locality: l.locality, possession: l.possession ?? "Ready to move", furnishing: l.furnishing ?? "Unfurnished",
    facing: l.facing ?? "", description: l.description ?? "", amenities: (l.amenities ?? []).join(", "), usps: (l.usps ?? []).join("\n"),
    videoUrl: l.videoUrl ?? "", tourUrl: l.tourUrl ?? "", reraNumber: l.reraNumber ?? "",
    lat: l.lat ?? null, lng: l.lng ?? null, exact: l.locationExact !== false, sourceUrl: l.sourceUrl ?? "",
  };
}

/**
 * Add a listing, with an AI assist that fills the form from one sentence.
 * Given an existing `listing`, the same form edits it instead.
 */
export function NewListingForm({ defaultCity, listing }: { defaultCity: string; listing?: Listing }) {
  const router = useRouter();
  const editing = !!listing;
  // A listing sent back by the review team goes back for review when saved.
  const resubmit = listing?.status === "rejected" || listing?.status === "draft";
  const [raw, setRaw] = useState("");
  const [form, setForm] = useState<Form>(listing ? fromListing(listing) : { ...EMPTY, city: defaultCity });
  const [media, setMedia] = useState<UploadedItem[]>(() =>
    (listing?.media ?? []).map((m) => ({ mediaId: m.id, name: m.label ?? "Photo", progress: 100, status: "ready" as const, media: m })));
  const cities = CITIES.includes(form.city) || !form.city ? CITIES : [form.city, ...CITIES];
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [error, setError] = useState("");
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  /** A draft from "Import from a link" replaces the form's contents; the member then checks it. */
  function applyDraft(d: ImportDraft) {
    setError("");
    setForm((f) => ({
      ...f,
      title: d.title || f.title, purpose: d.purpose, kind: KINDS.includes(d.kind) ? d.kind : f.kind,
      bhk: d.bhk != null ? String(d.bhk) : "", areaSqft: d.areaSqft ? String(d.areaSqft) : "", priceInr: d.priceInr ? String(d.priceInr) : "",
      city: d.city || f.city, locality: d.locality || f.locality,
      possession: d.possession === "Ready to move" ? "Ready to move" : "Under construction",
      furnishing: d.furnishing || f.furnishing, facing: d.facing,
      description: d.description || f.description, amenities: d.amenities.join(", "), usps: d.usps.join("\n"),
      videoUrl: d.videoUrl, tourUrl: d.tourUrl, reraNumber: d.reraNumber,
      lat: d.lat, lng: d.lng, exact: d.locationExact, sourceUrl: d.sourceUrl,
    }));
  }

  /** One home type from a project page with several. */
  function applyConfig(c: ImportConfig, d: ImportDraft) {
    const kind = (KINDS.includes(d.kind) ? d.kind : "Apartment").toLowerCase();
    const where = [d.projectName, d.locality].filter(Boolean).join(", ");
    setForm((f) => ({
      ...f, bhk: c.bhk ? String(c.bhk) : "", areaSqft: String(c.areaSqft), priceInr: c.priceInr ? String(c.priceInr) : "",
      title: `${c.bhk ? `${c.bhk} BHK ` : ""}${kind} in ${where}`.slice(0, 140),
    }));
  }

  async function fillWithAi() {
    if (raw.trim().length < 8) { setError("Describe the property in a sentence first."); return; }
    setBusy("ai"); setError("");
    try {
      const res = await clientApi<{ title?: string; description?: string; usps?: string[]; priceTip?: string }>(
        "/v1/ai/write/listing",
        { method: "POST", body: { listing: { ...form, note: raw, bhk: Number(form.bhk) || undefined, areaSqft: Number(form.areaSqft) || undefined, priceInr: Number(form.priceInr) || undefined } } },
      );
      setForm((f) => ({
        ...f,
        title: res.title ?? f.title,
        description: res.description ?? f.description,
        usps: res.usps?.length ? res.usps.join("\n") : f.usps,
      }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!form.title || !form.city || !form.locality || !form.priceInr) {
      setError(`Add a title, city, locality and price before ${editing ? "saving" : "publishing"}.`);
      return;
    }
    if (form.videoUrl && !videoEmbed(form.videoUrl)) { setError("The video link must be a YouTube or Vimeo link."); return; }
    if (form.tourUrl && !tourEmbed(form.tourUrl)) { setError("The 3D tour link must be from Matterport, Kuula, Momento360, CloudPano or a 360° YouTube video."); return; }
    setBusy("save"); setError("");
    try {
      const body = {
        title: form.title, purpose: form.purpose, kind: form.kind,
        bhk: Number(form.bhk) || undefined, areaSqft: Number(form.areaSqft) || undefined,
        priceInr: Number(form.priceInr), city: form.city, locality: form.locality,
        possession: form.possession, furnishing: form.furnishing, facing: form.facing || (editing ? "" : undefined),
        description: form.description || (editing ? "" : undefined),
        amenities: form.amenities.split(",").map((s) => s.trim()).filter(Boolean),
        usps: form.usps.split("\n").map((s) => s.trim()).filter(Boolean),
        // Only files that finished processing are attached.
        mediaIds: orderMedia(media).filter((m) => m.status === "ready").map((m) => m.mediaId),
        videoUrl: form.videoUrl.trim() || (editing ? "" : undefined),
        tourUrl: form.tourUrl.trim() || (editing ? "" : undefined),
        reraNumber: form.reraNumber.trim() || (editing ? "" : undefined),
        // "Approximate area only" saves the point rounded to about 150 m, so the exact building isn't shown.
        lat: form.lat != null ? (form.exact ? form.lat : Math.round(form.lat * 700) / 700) : (editing ? null : undefined),
        lng: form.lng != null ? (form.exact ? form.lng : Math.round(form.lng * 700) / 700) : (editing ? null : undefined),
        ...(form.lat != null ? { locationExact: form.exact } : {}),
        ...(!editing && form.sourceUrl ? { sourceUrl: form.sourceUrl } : {}),
      };
      if (listing) {
        const saved = await clientApi<{ inReview?: boolean }>(`/v1/listings/${listing.id}`, { method: "PATCH", body });
        if (saved?.inReview) alert("Thanks! Your changes are with our team for review. We'll notify you when it's live.");
        await refreshPages([`/listings/${listing.id}`, "/listings", `/profile/${listing.ownerId}`]);
        router.push(`/listings/${listing.id}`);
        router.refresh();
        return;
      }
      const created = await clientApi<{ id: string; inReview?: boolean }>("/v1/listings", { method: "POST", body });
      if (created.inReview) alert("Submitted! Our team checks every new listing before buyers see it, usually within a few hours. We'll notify you of the decision.");
      router.push(`/listings/${created.id}`);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  return (
    <div className="col">
      {resubmit && (listing?.reviewReasons?.length || listing?.reviewNote) ? (
        <div className="card pad" role="status" style={{ borderLeft: "4px solid #E08A00" }}>
          <b>{listing?.reviewDecision === "changes" ? "↩ What to fix before resubmitting" : "✕ Why it wasn't approved"}</b>
          {listing?.reviewReasons?.length ? <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{listing.reviewReasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
          {listing?.reviewNote ? <p className="small" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}><b>Note from our team:</b> {listing.reviewNote}</p> : null}
        </div>
      ) : null}
      {!editing ? (
        <ImportFromLink onDraft={applyDraft} onConfig={applyConfig} />
      ) : null}
      <div className="card pad" style={{ border: "2px solid var(--vio)" }}>
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>✨ Describe it like you would to a client</h2>
        <p className="small muted" style={{ marginBottom: 10 }}>
          For example: “3 BHK on the 14th floor in Sector 150 Noida, park facing, 1850 sq ft, ready to move, asking 1.65 Cr”.
        </p>
        <textarea rows={3} value={raw} onChange={(e) => setRaw(e.target.value)}
          style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 12, padding: 10, background: "var(--card)" }} />
        <button className="btn btn-ai sm" style={{ marginTop: 10 }} onClick={fillWithAi} disabled={busy !== null}>
          {busy === "ai" ? "Reading…" : "Fill with AI"}
        </button>
      </div>

      <div className="card pad">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="title">Title</label>
            <input id="title" value={form.title} onChange={set("title")} placeholder="Sunlit 3 BHK with park view" />
          </div>
          <div className="field"><label htmlFor="purpose">For</label>
            <select id="purpose" value={form.purpose} onChange={set("purpose")}><option value="sale">Sale</option><option value="rent">Rent</option></select>
          </div>
          <div className="field"><label htmlFor="kind">Type</label>
            <select id="kind" value={form.kind} onChange={set("kind")}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="bhk">Bedrooms</label>
            <input id="bhk" type="number" min={0} max={10} value={form.bhk} onChange={set("bhk")} />
          </div>
          <div className="field"><label htmlFor="area">Area (sq ft)</label>
            <input id="area" type="number" value={form.areaSqft} onChange={set("areaSqft")} placeholder="1650" />
          </div>
          <div className="field"><label htmlFor="price">{form.purpose === "rent" ? "Monthly rent (₹)" : "Price (₹)"}</label>
            <input id="price" type="number" value={form.priceInr} onChange={set("priceInr")} placeholder="16500000" />
          </div>
          <div className="field"><label htmlFor="city">City</label>
            <select id="city" value={form.city} onChange={set("city")}>{cities.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="locality">Locality</label>
            <input id="locality" value={form.locality} onChange={set("locality")} placeholder="Sector 150" />
          </div>
          <div className="field"><label htmlFor="possession">Possession</label>
            <select id="possession" value={form.possession} onChange={set("possession")}>
              <option>Ready to move</option><option>Under construction</option>
            </select>
          </div>
          <div className="field"><label htmlFor="furnishing">Furnishing</label>
            <select id="furnishing" value={form.furnishing} onChange={set("furnishing")}>
              <option>Unfurnished</option><option>Semi-furnished</option><option>Fully furnished</option>
            </select>
          </div>
          <div className="field"><label htmlFor="facing">Facing</label>
            <input id="facing" value={form.facing} onChange={set("facing")} placeholder="Park facing" />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="description">Description</label>
            <textarea id="description" rows={4} value={form.description} onChange={set("description")} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="amenities">Amenities (comma separated)</label>
            <input id="amenities" value={form.amenities} onChange={set("amenities")} placeholder="Clubhouse, Swimming pool, Covered parking" />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="usps">Selling points, one per line</label>
            <textarea id="usps" rows={3} value={form.usps} onChange={set("usps")} />
          </div>
          <div className="field"><label htmlFor="rera">RERA number</label>
            <input id="rera" value={form.reraNumber} onChange={set("reraNumber")} placeholder="UPRERAPRJ123456" maxLength={64} />
          </div>
          <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="video">Walkthrough video link</label>
            <input id="video" value={form.videoUrl} onChange={set("videoUrl")} placeholder="https://youtube.com/watch?v=…  or a Vimeo link" />
            {form.videoUrl && !videoEmbed(form.videoUrl) ? <span className="small error">Use a YouTube or Vimeo link.</span> : null}
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="tour">3D tour link</label>
            <input id="tour" value={form.tourUrl} onChange={set("tourUrl")} placeholder="https://my.matterport.com/show/?m=…  (Matterport, Kuula, Momento360, CloudPano or 360° YouTube)" />
            {form.tourUrl && !tourEmbed(form.tourUrl) ? <span className="small error">Use a Matterport, Kuula, Momento360, CloudPano or 360° YouTube link.</span> : null}
          </div>
          {canPlan(form.kind, Number(form.bhk), Number(form.areaSqft)) ? (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>2D plan, 3D walkthrough and hologram</label>
              <p className="small muted" style={{ margin: "0 0 6px" }}>Made automatically from the type, bedrooms and area, and shown on your listing as an illustrative layout (not the actual floor plan). Add your real floor plan as a photo too.</p>
              <PlanSvg plan={buildPlan(Number(form.bhk), Number(form.areaSqft))} facing={form.facing} title={form.title || "your home"} height={260} />
            </div>
          ) : null}
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: 16, marginBottom: 2 }}>Location on the map</label>
            <p className="small muted" style={{ margin: "0 0 8px" }}>Buyers see it as a 3D neighbourhood map. Search, use your current location, or click on the map and drag the pin onto the building.</p>
            <LocationPicker lat={form.lat} lng={form.lng} exact={form.exact} locality={form.locality} city={form.city}
              onChange={(v) => setForm((f) => ({ ...f, lat: v.lat, lng: v.lng, ...(v.exact !== undefined ? { exact: v.exact } : {}) }))}
              onPlace={(p) => setForm((f) => ({
                ...f,
                // Only fills what's empty: the seller's own words win.
                locality: f.locality.trim() ? f.locality : p.locality ?? f.locality,
                city: !f.city && p.city ? p.city : f.city,
              }))} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label style={{ fontSize: 16, marginBottom: 2 }}>Photos, videos, plans and brochure</label>
            <p className="small muted" style={{ margin: "0 0 10px" }}>Tap a card to add files. Upload from this device, or pick from WhatsApp or Instagram.</p>
            <MediaSteps items={media} onChange={setMedia} />
            {media.some((m) => m.status !== "ready" && m.status !== "failed")
              ? <p className="small muted">Your files are still processing. You can publish once they are ready.</p>
              : null}
          </div>
        </div>

        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          {editing ? <Link href={`/listings/${listing!.id}`} className="btn btn-g">Cancel</Link> : null}
          <button className="btn btn-ai" onClick={save} disabled={busy !== null || media.some((m) => m.status === "uploading" || m.status === "processing")}>
            {busy === "save" ? (editing ? "Saving…" : "Submitting…") : resubmit ? "Save and resubmit" : editing ? "Save changes" : "Submit listing"}
          </button>
        </div>
      </div>
    </div>
  );
}
