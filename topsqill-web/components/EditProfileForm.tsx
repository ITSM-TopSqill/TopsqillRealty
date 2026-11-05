"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { MediaUploader, type UploadedItem } from "./MediaUploader";
import { Avatar } from "./ui";
import type { SessionUser } from "@/lib/session";

const CITIES = ["Gurgaon", "Noida", "Greater Noida", "Delhi", "Faridabad", "Mumbai", "Pune", "Bengaluru", "Hyderabad"];

/** Edit the profile, including the avatar and cover photo. */
export function EditProfileForm({ user }: { user: SessionUser & { about?: string | null; localities?: string[]; agency?: string | null; yearsExperience?: number | null; reraNumber?: string | null } }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [headline, setHeadline] = useState(user.headline ?? "");
  const [about, setAbout] = useState(user.about ?? "");
  const [city, setCity] = useState(user.city ?? "Gurgaon");
  const [localities, setLocalities] = useState((user.localities ?? []).join(", "));
  const [agency, setAgency] = useState(user.agency ?? "");
  const [years, setYears] = useState(String(user.yearsExperience ?? ""));
  const [rera, setRera] = useState(user.reraNumber ?? "");
  const [avatar, setAvatar] = useState<UploadedItem[]>([]);
  const [cover, setCover] = useState<UploadedItem[]>([]);
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function rewrite() {
    setBusy("ai"); setError("");
    try {
      const res = await clientApi<{ headline: string; about: string }>("/v1/ai/write/profile", {
        method: "POST",
        body: { name, type: user.type, city, localities: localities.split(",").map((s) => s.trim()).filter(Boolean), agency, years: Number(years) || undefined, notes: about },
      });
      setHeadline(res.headline); setAbout(res.about);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function save() {
    setBusy("save"); setError(""); setSaved(false);
    const readyAvatar = avatar.find((m) => m.status === "ready");
    const readyCover = cover.find((m) => m.status === "ready");
    try {
      await clientApi("/v1/me", {
        method: "PATCH",
        body: {
          name, headline, about, city,
          localities: localities.split(",").map((s) => s.trim()).filter(Boolean),
          agency: agency || undefined,
          yearsExperience: Number(years) || undefined,
          reraNumber: rera || undefined,
          ...(readyAvatar ? { avatarMediaId: readyAvatar.mediaId } : {}),
          ...(readyCover ? { coverMediaId: readyCover.mediaId } : {}),
        },
      });
      setSaved(true);
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="col">
      <div className="card pad">
        <h2 style={{ fontSize: 17, marginBottom: 10 }}>Photos</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
          <div>
            <div className="row" style={{ marginBottom: 8 }}>
              <Avatar person={user} media={(avatar.find((m) => m.status === "ready")?.media ?? user.avatar) as never} size={56} />
              <b className="small">Profile photo</b>
            </div>
            <MediaUploader items={avatar} onChange={setAvatar} max={1} accept="image/*" />
          </div>
          <div>
            <b className="small">Cover photo</b>
            <div style={{ marginTop: 8 }}>
              <MediaUploader items={cover} onChange={setCover} max={1} accept="image/*" />
            </div>
          </div>
        </div>
      </div>

      <div className="card pad">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <div className="field"><label htmlFor="name">Name</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field"><label htmlFor="city">City</label>
            <select id="city" value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="headline">Headline</label>
            <input id="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={160} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="about">About</label>
            <textarea id="about" rows={6} value={about} onChange={(e) => setAbout(e.target.value)} />
            <button className="btn btn-o sm" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={rewrite} disabled={busy !== null}>
              {busy === "ai" ? "Writing…" : "✨ Rewrite with AI"}
            </button>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="locs">Localities you work in</label>
            <input id="locs" value={localities} onChange={(e) => setLocalities(e.target.value)} placeholder="Sector 150, Sector 137" />
          </div>
          <div className="field"><label htmlFor="agency">Agency</label>
            <input id="agency" value={agency} onChange={(e) => setAgency(e.target.value)} />
          </div>
          <div className="field"><label htmlFor="years">Years of experience</label>
            <input id="years" type="number" min={0} max={60} value={years} onChange={(e) => setYears(e.target.value)} />
          </div>
          <div className="field"><label htmlFor="rera">RERA number</label>
            <input id="rera" value={rera} onChange={(e) => setRera(e.target.value)} placeholder="UPRERAPRJ123456" />
            <span className="small muted">Changing this needs verification again.</span>
          </div>
        </div>

        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
        {saved ? <p className="small" style={{ color: "var(--grn)", marginTop: 12, fontWeight: 700 }}>Saved</p> : null}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn btn-ai" onClick={save} disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}
