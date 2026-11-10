"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import Link from "next/link";
import { MediaUploader, type UploadedItem } from "./MediaUploader";
import { refreshPages } from "@/lib/refresh";
import type { Listing } from "@/lib/types";

const KINDS = ["Apartment", "Builder floor", "Villa", "Plot", "Office", "Shop"];
const CITIES = ["Gurgaon", "Noida", "Greater Noida", "Delhi", "Faridabad", "Mumbai", "Pune", "Bengaluru", "Hyderabad"];

type Form = {
  title: string; purpose: "sale" | "rent"; kind: string; bhk: string; areaSqft: string; priceInr: string;
  city: string; locality: string; possession: string; furnishing: string; facing: string;
  description: string; amenities: string; usps: string;
};

const EMPTY: Form = {
  title: "", purpose: "sale", kind: "Apartment", bhk: "3", areaSqft: "", priceInr: "",
  city: "", locality: "", possession: "Ready to move", furnishing: "Unfurnished", facing: "",
  description: "", amenities: "", usps: "",
};

function fromListing(l: Listing): Form {
  return {
    title: l.title, purpose: l.purpose, kind: l.kind, bhk: l.bhk != null ? String(l.bhk) : "",
    areaSqft: l.areaSqft != null ? String(l.areaSqft) : "", priceInr: l.priceInr != null ? String(l.priceInr) : "",
    city: l.city, locality: l.locality, possession: l.possession ?? "Ready to move", furnishing: l.furnishing ?? "Unfurnished",
    facing: l.facing ?? "", description: l.description ?? "", amenities: (l.amenities ?? []).join(", "), usps: (l.usps ?? []).join("\n"),
  };
}

/**
 * Add a listing, with an AI assist that fills the form from one sentence.
 * Given an existing `listing`, the same form edits it instead.
 */
export function NewListingForm({ defaultCity, listing }: { defaultCity: string; listing?: Listing }) {
  const router = useRouter();
  const editing = !!listing;
  const [raw, setRaw] = useState("");
  const [form, setForm] = useState<Form>(listing ? fromListing(listing) : { ...EMPTY, city: defaultCity });
  const [media, setMedia] = useState<UploadedItem[]>(() =>
    (listing?.media ?? []).map((m) => ({ mediaId: m.id, name: m.label ?? "Photo", progress: 100, status: "ready" as const, media: m })));
  const cities = CITIES.includes(form.city) || !form.city ? CITIES : [form.city, ...CITIES];
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [error, setError] = useState("");
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

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
        mediaIds: media.filter((m) => m.status === "ready").map((m) => m.mediaId),
      };
      if (listing) {
        await clientApi(`/v1/listings/${listing.id}`, { method: "PATCH", body });
        await refreshPages([`/listings/${listing.id}`, "/listings", `/profile/${listing.ownerId}`]);
        router.push(`/listings/${listing.id}`);
        router.refresh();
        return;
      }
      const created = await clientApi<{ id: string }>("/v1/listings", { method: "POST", body });
      router.push(`/listings/${created.id}`);
    } catch (e) { setError((e as Error).message); setBusy(null); }
  }

  return (
    <div className="col">
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
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Photos and videos</label>
            <MediaUploader items={media} onChange={setMedia} max={20} coverFirst />
            {media.some((m) => m.status !== "ready" && m.status !== "failed")
              ? <p className="small muted">Your photos are still processing. You can publish once they are ready.</p>
              : null}
          </div>
        </div>

        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          {editing ? <Link href={`/listings/${listing!.id}`} className="btn btn-g">Cancel</Link> : null}
          <button className="btn btn-ai" onClick={save} disabled={busy !== null || media.some((m) => m.status === "uploading" || m.status === "processing")}>
            {busy === "save" ? (editing ? "Saving…" : "Publishing…") : editing ? "Save changes" : "Publish listing"}
          </button>
        </div>
      </div>
    </div>
  );
}
