"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { inr } from "@/lib/format";
import { MediaUploader, type UploadedItem } from "./MediaUploader";
import { PlacesPicker, type PickedPlace } from "./PlacesPicker";
import { AudienceSuggest } from "./AudienceSuggest";

const GOALS = ["Qualified buyers", "Site visits", "Brand awareness", "Tenants"];
const BUDGETS = [15000, 30000, 50000, 100000];

/**
 * Builds a campaign straight from an uploaded photo ("creative") or video,
 * with no listing attached: you write the headline and text yourself, and
 * target a city instead of a listing's address. Used for an advertiser who
 * wants to run ads without first creating a listing.
 */
export function CreativeCampaignForm({ kind }: { kind: "creative" | "video" }) {
  const router = useRouter();
  const [uploads, setUploads] = useState<UploadedItem[]>([]);
  const [headline, setHeadline] = useState("");
  const [text, setText] = useState("");
  const [city, setCity] = useState("");
  const [link, setLink] = useState("");
  const [extraPlaces, setExtraPlaces] = useState<PickedPlace[]>([]);
  const [excludePlaces, setExcludePlaces] = useState<PickedPlace[]>([]);
  const [goal, setGoal] = useState(GOALS[0]);
  const [budget, setBudget] = useState(30000);
  const [days, setDays] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [minBudget, setMinBudget] = useState(5000);
  useEffect(() => { clientApi<{ minCampaignInr: number }>("/v1/wallet/minimums").then((m) => setMinBudget(m.minCampaignInr)).catch(() => {}); }, []);

  const ready = uploads.filter((u) => u.status === "ready");

  async function build(e: React.FormEvent) {
    e.preventDefault();
    if (!ready.length) { setError(kind === "video" ? "Add a video." : "Add a photo."); return; }
    if (!headline.trim()) { setError("Give the ad a headline."); return; }
    if (!city.trim()) { setError("Choose a city to target."); return; }
    if (budget < minBudget) { setError(`The minimum budget is ${inr(minBudget)}.`); return; }
    setError(""); setBusy(true);
    try {
      const c = await clientApi<{ id: string }>("/v1/campaigns", {
        method: "POST",
        body: {
          budgetInr: budget, days, goal, mediaIds: ready.map((u) => u.mediaId),
          headline: headline.trim(), text: text.trim() || undefined, city: city.trim(), link: link.trim() || undefined,
          extraPlaces: extraPlaces.length ? extraPlaces : undefined, excludePlaces: excludePlaces.length ? excludePlaces : undefined,
        },
      });
      router.push(`/campaigns/${c.id}`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <AudienceSuggest city={city || undefined} onApply={(v) => {
        setGoal((g) => GOALS.includes(v.goal) ? v.goal : g);
        setBudget(v.budgetInr);
        setExtraPlaces((prev) => [...prev, ...v.areas].slice(0, 8));
        setCity((c) => c.trim() || v.city);
      }} />
      <form className="card pad" onSubmit={build}>
      <div className="field">
        <label>{kind === "video" ? "Video for the ad" : "Photo for the ad"}</label>
        <MediaUploader items={uploads} onChange={setUploads} max={kind === "video" ? 1 : 6}
          accept={kind === "video" ? "video/*" : "image/*"}
          category={kind === "video" ? "video" : "photo"}
          title={kind === "video" ? "Add a video" : "Add a photo"}
          hint="Drag it here, or tap to choose" />
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="headline">Headline</label>
        <input id="headline" maxLength={60} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Your family's next home is here" />
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="text">Ad text (optional)</label>
        <textarea id="text" rows={2} maxLength={400} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Tell people what you're advertising" />
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="city">City to target</label>
        <input id="city" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bengaluru" />
      </div>

      <div style={{ marginTop: 12 }}>
        <PlacesPicker label="Also target these areas (optional)" hint="Add specific localities beyond the city above." value={extraPlaces} onChange={setExtraPlaces} />
      </div>
      <div style={{ marginTop: 12 }}>
        <PlacesPicker label="Don't show ads in these areas (optional)" value={excludePlaces} onChange={setExcludePlaces} />
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="link">Where the ad should send people (optional)</label>
        <input id="link" type="url" maxLength={300} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://your-site.com" />
        <p className="muted small" style={{ marginTop: 4 }}>Leave blank to send people to your Topsqill profile instead.</p>
      </div>

      <div className="field" style={{ marginTop: 12 }}><label>Goal</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {GOALS.map((g) => <button type="button" key={g} className={`chip ${goal === g ? "on" : ""}`} aria-pressed={goal === g} onClick={() => setGoal(g)}>{g}</button>)}
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="budget">Total budget</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {BUDGETS.map((b) => <button type="button" key={b} className={`chip ${budget === b ? "on" : ""}`} aria-pressed={budget === b} onClick={() => setBudget(b)}>{inr(b)}</button>)}
          <input type="number" min={minBudget} step={minBudget < 1000 ? 100 : 1000} value={budget} onChange={(e) => setBudget(Number(e.target.value))} style={{ width: 140 }} />
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>Minimum {inr(minBudget)}</p>
      </div>

      <div className="field" style={{ marginTop: 12 }}><label htmlFor="days">Run for {days} days ({inr(Math.round(budget / Math.max(days, 1)))} a day)</label>
        <input id="days" type="range" min={3} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ accentColor: "#7B3DFF" }} />
      </div>

      {error ? <p className="error" style={{ marginTop: 10 }}>{error}</p> : null}
      <button className="btn btn-ai" style={{ width: "100%", height: 48, marginTop: 16, fontSize: 16 }} disabled={busy}>
        {busy ? "Building…" : "✨ Build my campaign"}
      </button>
      </form>
    </>
  );
}
