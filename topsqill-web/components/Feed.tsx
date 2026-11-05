"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { timeAgo, compact, imageUrl } from "@/lib/format";
import { Avatar, TypePill } from "./ui";
import type { Post } from "@/lib/types";
import type { SessionUser } from "@/lib/session";

/** Write a post, with AI help for people who dislike writing. */
export function Composer({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"post" | "ai" | null>(null);
  const [error, setError] = useState("");

  async function writeWithAi() {
    if (!body.trim()) { setError("Type a topic first, then let AI expand it."); return; }
    setBusy("ai"); setError("");
    try {
      const res = await clientApi<{ text: string }>("/v1/ai/write/post", { method: "POST", body: { topic: body } });
      setBody(res.text);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function publish() {
    if (!body.trim()) return;
    setBusy("post"); setError("");
    try {
      await clientApi("/v1/posts", { method: "POST", body: { body } });
      setBody(""); setOpen(false);
      router.refresh();                       // the server re-renders the feed with the new post
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="card pad">
      <div className="row">
        <Avatar person={user} media={user.avatar as never} size={44} />
        {open ? null : (
          <button className="chip" style={{ flex: 1, height: 46, justifyContent: "flex-start" }} onClick={() => setOpen(true)}>
            Share a deal, an update or a requirement…
          </button>
        )}
      </div>
      {open && (
        <div className="col" style={{ marginTop: 12, gap: 10 }}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} autoFocus
            placeholder="What would you like to share?"
            style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 12, padding: 12, background: "var(--card)" }} />
          {error ? <p className="error">{error}</p> : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-g sm" onClick={() => { setOpen(false); setBody(""); setError(""); }}>Cancel</button>
            <button className="btn btn-o sm" onClick={writeWithAi} disabled={busy !== null}>
              {busy === "ai" ? "Writing…" : "✨ Write with AI"}
            </button>
            <button className="btn btn-p sm" onClick={publish} disabled={busy !== null || !body.trim()}>
              {busy === "post" ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One post, with likes and comments that update immediately. */
export function PostCard({ post, meId }: { post: Post; meId: string }) {
  const [liked, setLiked] = useState(!!post.likedByMe);
  const [likes, setLikes] = useState(post.likeCount);
  const [showComments, setShowComments] = useState(false);
  const [, startTransition] = useTransition();

  function toggleLike() {
    const next = !liked;
    // Update the screen first; the request follows. Reverted if it fails.
    setLiked(next); setLikes((n) => n + (next ? 1 : -1));
    startTransition(async () => {
      try { await clientApi(`/v1/posts/${post.id}/like`, { method: next ? "POST" : "DELETE" }); }
      catch { setLiked(!next); setLikes((n) => n + (next ? -1 : 1)); }
    });
  }

  const image = post.media?.length ? imageUrl(post.media[0], "large") : null;

  return (
    <article className="card post">
      <header className="row" style={{ alignItems: "flex-start" }}>
        <Avatar person={post.author} size={46} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Link href={`/profile/${post.authorId}`} style={{ fontWeight: 800 }}>{post.author?.name ?? "Member"}</Link>
            <TypePill type={post.author?.type} />
          </div>
          <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {post.author?.headline}
          </div>
          <div className="small muted">{timeAgo(post.createdAt)}</div>
        </div>
      </header>

      <p className="body">{post.body}</p>
      {image ? <img src={image} alt="" loading="lazy" style={{ width: "100%", borderRadius: 12, marginTop: 12 }} /> : null}

      <div className="small muted" style={{ marginTop: 12 }}>
        {compact(likes)} likes · {post.commentCount} comments
      </div>

      <div className="pac">
        <button className={`pa ${liked ? "on" : ""}`} onClick={toggleLike} aria-pressed={liked}>👍 Like</button>
        <button className="pa" onClick={() => setShowComments((v) => !v)}>💬 Comment</button>
        <Link href={`/listings/${post.refId ?? ""}`} className="pa" style={{ pointerEvents: post.refId ? "auto" : "none", opacity: post.refId ? 1 : .45 }}>
          🏠 View listing
        </Link>
        <button className="pa" onClick={() => navigator.share?.({ text: post.body }).catch(() => {})}>↗ Send</button>
      </div>

      {showComments ? <Comments postId={post.id} meId={meId} /> : null}
    </article>
  );
}

function Comments({ postId, meId }: { postId: string; meId: string }) {
  const [items, setItems] = useState<{ id: string; body: string; authorName: string; createdAt: string }[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  if (items === null) {
    clientApi<{ items: typeof items }>(`/v1/posts/${postId}/comments`)
      .then((r) => setItems(r.items ?? []))
      .catch(() => setItems([]));
  }

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await clientApi(`/v1/posts/${postId}/comments`, { method: "POST", body: { body } });
      const fresh = await clientApi<{ items: typeof items }>(`/v1/posts/${postId}/comments`);
      setItems(fresh.items ?? []); setBody("");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
      <div className="row">
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…"
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          style={{ flex: 1, height: 38, borderRadius: 999, border: "1.5px solid var(--line)", padding: "0 14px", background: "var(--card)" }} />
        <button className="btn btn-p sm" onClick={send} disabled={busy || !body.trim()}>Post</button>
      </div>
      <div className="col" style={{ gap: 8, marginTop: 10 }}>
        {(items ?? []).map((c) => (
          <div key={c.id} style={{ background: "var(--soft)", borderRadius: 12, padding: "9px 12px" }}>
            <b className="small">{c.authorName}</b>
            <span className="small muted"> · {timeAgo(c.createdAt)}</span>
            <div className="small">{c.body}</div>
          </div>
        ))}
        {items && items.length === 0 ? <p className="small muted">No comments yet. Be the first.</p> : null}
      </div>
    </div>
  );
}
