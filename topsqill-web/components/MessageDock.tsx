"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clientApi } from "@/lib/api";
import { Avatar } from "./ui";
import { timeAgo } from "@/lib/format";
import { refreshCounts, useLiveCount } from "./Live";
import type { Conversation, Message, Paged, PersonCard, Media } from "@/lib/types";

/**
 * The messaging bar in the bottom-right corner of every page, on desktop.
 *
 * Click the bar to open the inbox; click a chat to open it in its own small
 * window beside the bar, so you can keep talking while you browse. Open
 * windows (and whether each is minimised) survive moving between pages. On
 * phones, and on the Messages page itself, the bar is not shown.
 */
type Win = { id: string; min: boolean };
type DockState = { open: boolean; wins: Win[] };

const KEY = "topsqill:dock";
const EMPTY: DockState = { open: false, wins: [] };
const MAX_WINDOWS = 2;

let dock: DockState = EMPTY;
let inbox: Conversation[] | null = null;
let mounted = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function set(next: DockState) {
  dock = next;
  try { sessionStorage.setItem(KEY, JSON.stringify(dock)); } catch { /* private mode: state just isn't kept */ }
  listeners.forEach((l) => l());
}
function setInbox(items: Conversation[]) { inbox = items; listeners.forEach((l) => l()); }

if (typeof window !== "undefined") {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as DockState | null;
    if (saved && Array.isArray(saved.wins)) dock = { open: !!saved.open, wins: saved.wins.slice(0, MAX_WINDOWS) };
  } catch { /* ignore */ }
}

let loading: Promise<void> | null = null;
function loadInbox() {
  loading ??= clientApi<{ items: Conversation[] }>("/v1/conversations")
    .then((r) => setInbox(r.items))
    .catch(() => {})
    .finally(() => { loading = null; });
  return loading;
}

/**
 * Opens a chat in a window on the bar. Returns false when the bar is not on
 * screen (phones, the Messages page), so the caller can go to /messages instead.
 */
export function openChat(conversationId: string): boolean {
  if (!mounted || !window.matchMedia("(min-width: 861px)").matches) return false;
  const others = dock.wins.filter((w) => w.id !== conversationId);
  set({ ...dock, wins: [{ id: conversationId, min: false }, ...others].slice(0, MAX_WINDOWS) });
  if (!inbox?.some((c) => c.id === conversationId)) loadInbox();
  return true;
}

function closeChat(id: string) { set({ ...dock, wins: dock.wins.filter((w) => w.id !== id) }); }
function toggleChat(id: string) { set({ ...dock, wins: dock.wins.map((w) => (w.id === id ? { ...w, min: !w.min } : w)) }); }

export function MessageDock({ me }: { me: { id: string; name: string; type?: string; avatar?: unknown } }) {
  const pathname = usePathname();
  const state = useSyncExternalStore(subscribe, () => dock, () => EMPTY);
  const items = useSyncExternalStore(subscribe, () => inbox, () => null);
  const unread = useLiveCount("messages");
  const [filter, setFilter] = useState("");
  const hidden = pathname.startsWith("/messages");

  useEffect(() => {
    if (hidden) return;
    mounted = true;
    return () => { mounted = false; };
  }, [hidden]);

  // The inbox is fetched when the bar first appears, again whenever the unread
  // count changes (a new message somewhere), and every 20 seconds while open.
  useEffect(() => { if (!hidden) loadInbox(); }, [hidden, unread]);
  useEffect(() => {
    if (hidden || !state.open) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") loadInbox(); }, 20_000);
    return () => clearInterval(timer);
  }, [hidden, state.open]);

  if (hidden) return null;

  const q = filter.trim().toLowerCase();
  const shown = (items ?? []).filter((c) => !q || (c.peer?.name ?? "").toLowerCase().includes(q) || (c.lastMessagePreview ?? "").toLowerCase().includes(q));

  return (
    <div className="dock" aria-label="Messaging">
      <section className={`dpanel ${state.open ? "open" : ""}`}>
        <div className="dhead" role="button" tabIndex={0} aria-expanded={state.open}
          onClick={() => set({ ...dock, open: !dock.open })}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); set({ ...dock, open: !dock.open }); } }}>
          <span style={{ position: "relative", display: "inline-flex" }}>
            <Avatar person={me} media={me.avatar as Media | null} size={32} />
            <span className="donline" aria-hidden />
          </span>
          <b>Messaging</b>
          {unread ? <span className="dcount" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span> : null}
          <Link href="/messages" className="dbtn" title="Open full Messages page" aria-label="Open full Messages page" onClick={(e) => e.stopPropagation()}>⤢</Link>
          <span className="dbtn" aria-hidden>{state.open ? "⌄" : "⌃"}</span>
        </div>

        {state.open ? (
          <>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)" }}>
              <input className="dsearch" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search messages" aria-label="Search messages" />
            </div>
            <div className="dlist">
              {items === null ? <p className="small muted" style={{ padding: 14 }}>Loading…</p> : null}
              {items && !shown.length ? (
                <p className="small muted" style={{ padding: 14 }}>
                  {q ? "No chats match that." : "No conversations yet. Message someone from their profile or a listing."}
                </p>
              ) : null}
              {shown.map((c) => (
                <button key={c.id} className="ci dci" onClick={() => openChat(c.id)}>
                  <Avatar person={c.peer} size={40} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="row" style={{ justifyContent: "space-between", gap: 6 }}>
                      <b className="ell" style={{ fontSize: 13.5 }}>{c.peer?.name ?? "Member"}</b>
                      <span className="small muted" style={{ flex: "none" }}>{timeAgo(c.lastMessageAt)}</span>
                    </span>
                    <span className="small muted ell" style={{ display: "block", fontWeight: c.unread ? 800 : 400, color: c.unread ? "var(--ink)" : undefined }}>
                      {c.lastSenderId === me.id ? "You: " : ""}{c.lastMessagePreview ?? "Say hello"}
                    </span>
                  </span>
                  {c.unread ? <span className="badge-dot" style={{ position: "static" }}>{c.unread}</span> : null}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {state.wins.map((w) => (
        <ChatWindow key={w.id} win={w} me={me.id} convo={items?.find((c) => c.id === w.id) ?? null} />
      ))}
    </div>
  );
}

/** One chat, in a small window beside the bar. Polls for replies while it is open. */
function ChatWindow({ win, me, convo }: { win: Win; me: string; convo: Conversation | null }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const peer: PersonCard | null = convo?.peer ?? null;

  const markRead = useCallback(() => {
    clientApi(`/v1/conversations/${win.id}/read`, { method: "POST" })
      .then(() => { refreshCounts(); loadInbox(); }).catch(() => {});
  }, [win.id]);

  // Load the history when the window opens, then check for replies every few seconds.
  useEffect(() => {
    if (win.min) return;
    let alive = true;
    const load = async (first: boolean) => {
      try {
        const res = await clientApi<Paged<Message>>(`/v1/conversations/${win.id}/messages?limit=${first ? 30 : 15}`);
        if (!alive) return;
        const page = res.items.slice().reverse();
        let incoming = false;
        setMessages((prev) => {
          if (!prev || first) { incoming = page.some((m) => m.senderId !== me); return page; }
          const known = new Set(prev.map((m) => m.id));
          const fresh = page.filter((m) => !known.has(m.id));
          // Pick up "Seen" on messages already on screen.
          const seen = new Map(page.map((m) => [m.id, m.readAt]));
          const updated = prev.map((m) => (seen.get(m.id) && !m.readAt ? { ...m, readAt: seen.get(m.id) } : m));
          if (!fresh.length) return updated;
          incoming = fresh.some((m) => m.senderId !== me);
          return [...updated.filter((m) => !m.id.startsWith("tmp-")), ...fresh];
        });
        if (incoming || first) markRead();
      } catch (e) {
        if (first && alive) setError((e as Error).message || "Could not load this chat.");
      }
    };
    load(true);
    const timer = setInterval(() => { if (document.visibilityState === "visible") load(false); }, 4000);
    return () => { alive = false; clearInterval(timer); };
  }, [win.id, win.min, me, markRead]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages?.length, win.min]);
  useEffect(() => { if (!win.min) input.current?.focus(); }, [win.min]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setError("");
    const optimistic: Message = { id: `tmp-${Date.now()}`, conversationId: win.id, senderId: me, body: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...(m ?? []), optimistic]);
    setBody("");
    try {
      const saved = await clientApi<Message>(`/v1/conversations/${win.id}/messages`, { method: "POST", body: { body: text } });
      setMessages((m) => (m ?? []).map((x) => (x.id === optimistic.id ? saved : x)));
      loadInbox();
    } catch (e) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== optimistic.id));
      setBody(text);
      setError((e as Error).message || "Your message was not sent. Please try again.");
    }
  }

  return (
    <section className={`dpanel dwin ${win.min ? "" : "open"}`} aria-label={`Chat with ${peer?.name ?? "member"}`}>
      <div className="dhead" role="button" tabIndex={0} aria-expanded={!win.min}
        onClick={() => toggleChat(win.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleChat(win.id); } }}>
        <Avatar person={peer} size={32} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <b className="ell" style={{ display: "block" }}>{peer?.name ?? "Member"}</b>
          {!win.min && peer?.headline ? <span className="small muted ell" style={{ display: "block", fontSize: 11.5 }}>{peer.headline}</span> : null}
        </span>
        {win.min && convo?.unread ? <span className="dcount">{convo.unread}</span> : null}
        <Link href={`/messages?c=${win.id}`} className="dbtn" title="Open in Messages" aria-label="Open in Messages" onClick={(e) => e.stopPropagation()}>⤢</Link>
        <button className="dbtn" aria-label="Close chat" title="Close" onClick={(e) => { e.stopPropagation(); closeChat(win.id); }}>×</button>
      </div>

      {win.min ? null : (
        <>
          <div className="msgs">
            {peer ? (
              <Link href={`/profile/${peer.id}`} className="dpeer">
                <Avatar person={peer} size={56} />
                <b>{peer.name}</b>
                {peer.headline ? <span className="small muted">{peer.headline}</span> : null}
              </Link>
            ) : null}
            {messages === null && !error ? <p className="small muted" style={{ textAlign: "center" }}>Loading…</p> : null}
            {messages?.length === 0 ? <p className="small muted" style={{ textAlign: "center" }}>Say hello 👋</p> : null}
            {messages?.map((m) => (
              <div key={m.id} className={`bub ${m.senderId === me ? "me" : "them"}`}>
                {m.body}
                <div style={{ fontSize: 10.5, opacity: .65, marginTop: 3 }}>
                  {m.id.startsWith("tmp-") ? "Sending…" : timeAgo(m.createdAt)}
                  {m.senderId === me && m.readAt ? " · Seen" : ""}
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>
          {error ? <p className="error small" style={{ margin: "0 10px" }} role="alert">{error}</p> : null}
          <div className="composer">
            <textarea ref={input} value={body} onChange={(e) => setBody(e.target.value)} rows={1} placeholder="Write a message…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="btn btn-p sm" onClick={send} disabled={!body.trim()}>Send</button>
          </div>
        </>
      )}
    </section>
  );
}
