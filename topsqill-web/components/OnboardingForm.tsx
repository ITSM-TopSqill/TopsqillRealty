"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

const TYPES = [
  { value: "dealer", label: "Dealer", blurb: "I help people buy, sell and rent property." },
  { value: "builder", label: "Builder", blurb: "I develop projects and work with channel partners." },
  { value: "buyer", label: "Buyer", blurb: "I’m looking for a home or an investment." },
  { value: "seller", label: "Owner", blurb: "I own property I want to sell or rent out." },
];
const CITIES = ["Gurgaon", "Noida", "Greater Noida", "Delhi", "Faridabad", "Mumbai", "Pune", "Bengaluru", "Hyderabad"];

/** Three short steps: who you are, where you work, and the AI-written profile. */
export function OnboardingForm({ name: initialName }: { name: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [type, setType] = useState("dealer");
  const [name, setName] = useState(initialName === "New member" ? "" : initialName);
  const [city, setCity] = useState("Gurgaon");
  const [localities, setLocalities] = useState("");
  const [agency, setAgency] = useState("");
  const [years, setYears] = useState("5");
  const [notes, setNotes] = useState("");
  const [headline, setHeadline] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!name.trim()) { setError("Add your name first."); return; }
    setBusy(true); setError("");
    try {
      const res = await clientApi<{ headline: string; about: string }>("/v1/ai/write/profile", {
        method: "POST",
        body: { name, type, city, localities: localities.split(",").map((s) => s.trim()).filter(Boolean), agency, years: Number(years) || undefined, notes },
      });
      setHeadline(res.headline); setAbout(res.about); setStep(2);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError("");
    try {
      await clientApi("/v1/me", {
        method: "PATCH",
        body: {
          name, type, city, headline, about,
          localities: localities.split(",").map((s) => s.trim()).filter(Boolean),
          agency: agency || undefined, yearsExperience: Number(years) || undefined,
        },
      });
      router.replace("/");
      router.refresh();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="col">
      <div className="row" style={{ gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <i key={i} style={{ flex: 1, height: 5, borderRadius: 5, background: i <= step ? "var(--brand)" : "var(--chip)" }} />
        ))}
      </div>

      {step === 0 ? (
        <>
          <h2 style={{ fontSize: 18 }}>Who are you here as?</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {TYPES.map((t) => (
              <button key={t.value} onClick={() => setType(t.value)}
                className="card pad" style={{ textAlign: "left", borderColor: type === t.value ? "var(--vio)" : "var(--line)", borderWidth: 2 }}>
                <b style={{ fontSize: 17 }}>{t.label}</b>
                <div className="small muted">{t.blurb}</div>
              </button>
            ))}
          </div>
          <button className="btn btn-ai" onClick={() => setStep(1)}>Continue</button>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <h2 style={{ fontSize: 18 }}>A few details</h2>
          <div className="field"><label htmlFor="name">{type === "builder" ? "Company name" : "Full name"}</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Riya Kapoor" />
          </div>
          <div className="field"><label htmlFor="city">City</label>
            <select id="city" value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="field"><label htmlFor="locs">{type === "buyer" ? "Localities you like" : "Localities you work in"}</label>
            <input id="locs" value={localities} onChange={(e) => setLocalities(e.target.value)} placeholder="Sector 150, Sector 137" />
          </div>
          {type === "dealer" ? (
            <div className="field"><label htmlFor="agency">Agency</label>
              <input id="agency" value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="Keystone Realty" />
            </div>
          ) : null}
          {type === "dealer" || type === "builder" ? (
            <div className="field"><label htmlFor="years">Years of experience</label>
              <input id="years" type="number" min={0} max={60} value={years} onChange={(e) => setYears(e.target.value)} />
            </div>
          ) : null}
          <div className="field"><label htmlFor="notes">Anything that makes you different? A few words is enough.</label>
            <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button className="btn btn-g" onClick={() => setStep(0)}>Back</button>
            <button className="btn btn-ai" onClick={generate} disabled={busy}>{busy ? "Writing…" : "✨ Write my profile"}</button>
          </div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <h2 style={{ fontSize: 18 }}>Your profile</h2>
          <p className="small muted">Edit anything you like before saving.</p>
          <div className="field"><label htmlFor="headline">Headline</label>
            <input id="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} />
          </div>
          <div className="field"><label htmlFor="about">About</label>
            <textarea id="about" rows={6} value={about} onChange={(e) => setAbout(e.target.value)} />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button className="btn btn-g" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-ai" onClick={save} disabled={busy}>{busy ? "Saving…" : "Create my profile"}</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
