"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { Avatar } from "./ui";
import { timeAgo } from "@/lib/format";
import type { Conversation, Message, Paged } from "@/lib/types";
import Link from "next/link";
import { refreshCounts } from "./Live";

/**
 * Chat.
 *
 * New messages arrive by polling every few seconds. That is deliberate for now:
 * it is simple, works behind every proxy, and costs little at this scale. The
 * backend already publishes over WebSocket, so this can be swapped later
 * without changing the rest of the screen.
 */
export function Messenger({ me, conversations, activeId, initialMessages }: {
  me: string; conversations: Conversation[]; activeId: string | null; initialMessages: Message[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const active = conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => { setMessages(initialMessages); }, [initialMessages, activeId]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  // Mark as read on open, then watch for replies every few seconds. New
  // messages are added to what is on screen rather than replacing it.
  useEffect(() => {
    if (!activeId) return;
    const markRead = () => clientApi(`/v1/conversations/${activeId}/read`, { method: "POST" }).then(() => refreshCounts()).catch(() => {});
    markRead();
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await clientApi<Paged<Message>>(`/v1/conversations/${activeId}/messages?limit=20`);
        let gotNew = false;
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const fresh = res.items.slice().reverse().filter((m) => !known.has(m.id));
          if (!fresh.length) return prev;
          gotNew = fresh.some((m) => m.senderId !== me);
          return [...prev.filter((m) => !m.id.startsWith("tmp-")), ...fresh];
        });
        if (gotNew) markRead();
      } catch { /* a dropped poll is harmless */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [activeId, me]);

  // The inbox (previews, unread dots, order) refreshes every 15 seconds.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [router]);

  async function send() {
    const text = body.trim();
    if (!text || !activeId) return;
    setSending(true); setError("");
    const optimistic: Message = { id: `tmp-${Date.now()}`, conversationId: activeId, senderId: me, body: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setBody("");
    try {
      const saved = await clientApi<Message>(`/v1/conversations/${activeId}/messages`, { method: "POST", body: { body: text } });
      setMessages((m) => m.map((x) => (x.id === optimistic.id ? saved : x)));
      router.refresh();
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setBody(text);
      setError((e as Error).message || "Your message was not sent. Please try again.");
    } finally { setSending(false); }
  }

  return (
    <div className={`card chat ${activeId ? "inthread" : ""}`}>
      <div className="clist">
        <div className="pad" style={{ paddingBottom: 8 }}><h1 style={{ fontSize: 20 }}>Messages</h1></div>
        {conversations.length === 0 ? <p className="pad muted small">No conversations yet.</p> : null}
        {conversations.map((c) => (
          <button key={c.id} className={`ci ${c.id === activeId ? "on" : ""}`} onClick={() => router.push(`/messages?c=${c.id}`)}>
            <Avatar person={c.peer} size={44} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="row" style={{ justifyContent: "space-between" }}>
                <b style={{ fontSize: 14 }}>{c.peer?.name ?? "Member"}</b>
                <span className="small muted">{timeAgo(c.lastMessageAt)}</span>
              </span>
              <span className="small muted" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: c.unread ? 800 : 400 }}>
                {c.lastSenderId === me ? "You: " : ""}{c.lastMessagePreview ?? "Say hello"}
              </span>
            </span>
            {c.unread ? <span className="badge-dot" style={{ position: "static" }}>{c.unread}</span> : null}
          </button>
        ))}
      </div>

      <div className="thread">
        {active ? (
          <>
            <div className="row pad" style={{ borderBottom: "1px solid var(--line)", padding: "10px 14px" }}>
              <button className="btn btn-g sm" onClick={() => router.push("/messages")} aria-label="Back to inbox">←</button>
              <Avatar person={active.peer} size={38} />
              <div style={{ minWidth: 0 }}>
                {active.peer ? <Link href={`/profile/${active.peer.id}`} style={{ fontSize: 14, fontWeight: 800 }}>{active.peer.name}</Link> : <b>Member</b>}
                <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active.peer?.headline}</div>
              </div>
            </div>

            <div className="msgs">
              {messages.length === 0 ? <p className="small muted" style={{ textAlign: "center", margin: "auto" }}>Say hello 👋 Your messages are private to the two of you.</p> : null}
              {messages.map((m) => (
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

            {error ? <p className="error small" style={{ margin: "0 14px" }} role="alert">{error}</p> : null}
            <div className="composer">
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} placeholder="Write a message…"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="btn btn-p" onClick={send} disabled={sending || !body.trim()}>Send</button>
            </div>
          </>
        ) : (
          <div className="empty" style={{ display: "grid", placeItems: "center", height: "100%" }}>
            <div>
              <h3>Pick a conversation</h3>
              <p className="small">Or message someone from their profile or a listing.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
