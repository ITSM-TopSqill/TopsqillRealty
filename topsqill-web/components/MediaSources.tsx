"use client";

import { useCallback, useEffect, useState } from "react";
import { clientApi } from "@/lib/api";
import { imageUrl } from "@/lib/format";
import type { Media } from "@/lib/types";
import type { UploadedItem } from "./MediaUploader";

type Inbox = { configured: boolean; number: string | null; myPhone: string | null };
type IgStatus = { configured: boolean; connected: boolean; username: string | null };
type IgItem = { id: string; type: "image" | "video"; url: string; thumb: string; caption: string; permalink: string; at: string };

/**
 * The member's own photos and videos, from two places besides their device:
 *  - WhatsApp: they send them to Topsqill's WhatsApp number from the number
 *    they signed in with, and they show up here within seconds.
 *  - Instagram: they connect their own account and pick posts and reels.
 * Nothing is ever taken from another listing site.
 */
export function MediaSources({ onAdd, room, have }: { onAdd: (items: UploadedItem[]) => void; room: number; have: string[] }) {
  const [tab, setTab] = useState<"whatsapp" | "instagram" | null>(null);
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={`chip${tab === "whatsapp" ? " on" : ""}`} onClick={() => setTab(tab === "whatsapp" ? null : "whatsapp")}>🟢 From WhatsApp</button>
        <button type="button" className={`chip${tab === "instagram" ? " on" : ""}`} onClick={() => setTab(tab === "instagram" ? null : "instagram")}>📸 From Instagram</button>
      </div>
      {tab === "whatsapp" ? <WhatsAppPanel onAdd={onAdd} room={room} have={have} /> : null}
      {tab === "instagram" ? <InstagramPanel onAdd={onAdd} room={room} /> : null}
    </div>
  );
}

const panel: React.CSSProperties = { marginTop: 10, background: "var(--soft)", borderRadius: 12, padding: "12px 14px" };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 8, marginTop: 10 };

function Tile({ on, onClick, thumb, video, label }: { on: boolean; onClick: () => void; thumb?: string | null; video?: boolean; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} aria-label={label}
      style={{ position: "relative", aspectRatio: "1", borderRadius: 10, overflow: "hidden", padding: 0, border: on ? "3px solid var(--vio)" : "3px solid transparent", background: "#1b1736", color: "#fff" }}>
      {thumb ? <img src={thumb} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ display: "grid", placeItems: "center", height: "100%", fontSize: 12, fontWeight: 700 }}>▶ Video</span>}
      {video && thumb ? <span style={{ position: "absolute", left: 4, bottom: 4, fontSize: 11, background: "rgba(0,0,0,.6)", borderRadius: 6, padding: "1px 5px" }}>▶</span> : null}
      <span style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 6, background: on ? "var(--vio)" : "rgba(255,255,255,.85)", color: "#fff", display: "grid", placeItems: "center", fontSize: 14 }}>{on ? "✓" : ""}</span>
    </button>
  );
}

function WhatsAppPanel({ onAdd, room, have }: { onAdd: (items: UploadedItem[]) => void; room: number; have: string[] }) {
  const [info, setInfo] = useState<Inbox | null>(null);
  const [items, setItems] = useState<Media[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const load = useCallback(() => clientApi<{ items: Media[] }>("/v1/media/mine?source=whatsapp").then((r) => setItems(r.items)).catch(() => {}), []);
  useEffect(() => {
    clientApi<Inbox>("/v1/whatsapp/inbox").then(setInfo).catch((e) => setError((e as Error).message));
    load();
    // New files appear within seconds of being sent, so the list refreshes while it's open.
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <div style={panel}><p className="small error" style={{ margin: 0 }}>{error}</p></div>;
  if (!info) return <div style={panel}><p className="small muted" style={{ margin: 0 }}>Loading…</p></div>;
  if (!info.configured || !info.number) return <div style={panel}><p className="small" style={{ margin: 0 }}>WhatsApp isn’t switched on for Topsqill yet. Upload from your device for now.</p></div>;

  const digits = info.number.replace(/\D/g, "");
  const fresh = items.filter((m) => !have.includes(m.id));
  const add = () => {
    const chosen = fresh.filter((m) => picked.has(m.id)).slice(0, room);
    onAdd(chosen.map((m) => ({ mediaId: m.id, name: m.label ?? (m.kind === "video" ? "WhatsApp video" : "WhatsApp photo"), progress: 100, status: m.status === "ready" ? "ready" : "processing", media: m })));
    setPicked(new Set());
  };
  return (
    <div style={panel}>
      <p className="small" style={{ margin: 0 }}>
        Send your property’s photos and videos on WhatsApp to <b>{info.number}</b>{info.myPhone ? <> from your number <b>{info.myPhone}</b></> : null}. They appear here in a few seconds.
      </p>
      {!info.myPhone ? <p className="small error" style={{ margin: "6px 0 0" }}>Your account has no mobile number. Sign in with your phone number once, so we know the photos are yours.</p> : null}
      <a className="btn btn-p sm" style={{ marginTop: 8, display: "inline-block" }} href={`https://wa.me/${digits}?text=${encodeURIComponent("Photos for my Topsqill listing")}`} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
      {fresh.length ? (
        <>
          <div style={grid}>
            {fresh.map((m) => (
              <Tile key={m.id} on={picked.has(m.id)} thumb={m.kind === "image" ? imageUrl(m, "thumb") : null} video={m.kind === "video"} label={m.kind === "video" ? "WhatsApp video" : "WhatsApp photo"}
                onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(m.id)) n.delete(m.id); else if (n.size < room) n.add(m.id); return n; })} />
            ))}
          </div>
          <button type="button" className="btn btn-o sm" style={{ marginTop: 10 }} disabled={!picked.size || room <= 0} onClick={add}>
            {room <= 0 ? "The listing already has 20 files" : `Add ${picked.size || ""} to the listing`.replace("  ", " ")}
          </button>
        </>
      ) : <p className="small muted" style={{ margin: "10px 0 0" }}>Nothing received yet.</p>}
    </div>
  );
}

function InstagramPanel({ onAdd, room }: { onAdd: (items: UploadedItem[]) => void; room: number }) {
  const [status, setStatus] = useState<IgStatus | null>(null);
  const [items, setItems] = useState<IgItem[]>([]);
  const [after, setAfter] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const loadStatus = useCallback(() => clientApi<IgStatus>("/v1/instagram/status").then(setStatus).catch((e) => setError((e as Error).message)), []);
  const loadMedia = useCallback(async (cursor?: string) => {
    try {
      const r = await clientApi<{ items: IgItem[]; after: string | null }>(`/v1/instagram/media${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`);
      setItems((x) => (cursor ? [...x, ...r.items] : r.items)); setAfter(r.after);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { if (status?.connected) loadMedia(); }, [status?.connected, loadMedia]);

  // The Instagram login opens in a small window, which tells us when it's done.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "topsqill-connected" || e.data?.service !== "instagram") return;
      if (e.data.error) setError(e.data.error); else { setError(""); loadStatus(); }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [loadStatus]);

  const connect = () => {
    setError("");
    const w = window.open("/api/instagram/start", "instagram", "width=520,height=720");
    if (!w) window.location.href = "/api/instagram/start";
  };
  const disconnect = async () => { await clientApi("/v1/instagram", { method: "DELETE" }).catch(() => {}); setItems([]); loadStatus(); };
  const add = async () => {
    setBusy(true); setNote(""); setError("");
    try {
      const ids = items.filter((i) => picked.has(i.id)).map((i) => i.id).slice(0, room);
      const r = await clientApi<{ items: { id: string; mediaId?: string; kind?: string; error?: string }[] }>("/v1/instagram/import", { method: "POST", body: { ids } });
      const ok = r.items.filter((i) => i.mediaId);
      onAdd(ok.map((i) => {
        const src = items.find((x) => x.id === i.id);
        return { mediaId: i.mediaId!, name: i.kind === "video" ? "Instagram video" : "Instagram photo", progress: 100, status: "processing" as const, previewUrl: src?.thumb };
      }));
      const failed = r.items.length - ok.length;
      setNote(`${ok.length} added below${failed ? `; ${failed} couldn’t be copied` : ""}. They appear once processed.`);
      setPicked(new Set());
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!status) return <div style={panel}><p className="small muted" style={{ margin: 0 }}>{error || "Loading…"}</p></div>;
  if (!status.configured) return <div style={panel}><p className="small" style={{ margin: 0 }}>Instagram isn’t switched on for Topsqill yet. Upload from your device for now.</p></div>;
  if (!status.connected) {
    return (
      <div style={panel}>
        <p className="small" style={{ margin: 0 }}>Connect your Instagram to pick photos and reels from your own posts. It needs an Instagram business or creator account (a free switch in Instagram → Settings → Account type).</p>
        <button type="button" className="btn btn-p sm" style={{ marginTop: 8 }} onClick={connect}>Connect Instagram</button>
        {error ? <p className="small error" style={{ margin: "6px 0 0" }}>{error}</p> : null}
      </div>
    );
  }
  return (
    <div style={panel}>
      <div className="spread small" style={{ flexWrap: "wrap", gap: 6 }}>
        <span>Connected as <b>@{status.username ?? "instagram"}</b>. Pick your own photos and reels.</span>
        <button type="button" className="linklike small" onClick={disconnect}>Disconnect</button>
      </div>
      {items.length ? (
        <div style={grid}>
          {items.map((i) => (
            <Tile key={i.id} on={picked.has(i.id)} thumb={i.thumb} video={i.type === "video"} label={i.caption || (i.type === "video" ? "Reel" : "Photo")}
              onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(i.id)) n.delete(i.id); else if (n.size < room) n.add(i.id); return n; })} />
          ))}
        </div>
      ) : <p className="small muted" style={{ margin: "10px 0 0" }}>{error || "No photos or reels found on this account."}</p>}
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-o sm" disabled={busy || !picked.size || room <= 0} onClick={add}>
          {busy ? "Copying…" : room <= 0 ? "The listing already has 20 files" : `Add ${picked.size || ""} to the listing`.replace("  ", " ")}
        </button>
        {after ? <button type="button" className="linklike small" onClick={() => loadMedia(after)}>Show older posts</button> : null}
      </div>
      {note ? <p className="small muted" style={{ margin: "6px 0 0" }}>{note}</p> : null}
      {error && items.length ? <p className="small error" style={{ margin: "6px 0 0" }}>{error}</p> : null}
    </div>
  );
}
