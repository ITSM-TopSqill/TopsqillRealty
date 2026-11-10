"use client";

import { useEffect, useState, useTransition } from "react";
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
export function PostCard({ post, meId, startOpen = false }: { post: Post; meId: string | null; startOpen?: boolean }) {
  const router = useRouter();
  const [liked, setLiked] = useState(!!post.likedByMe);
  const [likes, setLikes] = useState(post.likeCount);
  const [comments, setComments] = useState(post.commentCount);
  const [showComments, setShowComments] = useState(startOpen);
  const [note, setNote] = useState("");
  const [, startTransition] = useTransition();

  function flash(text: string) { setNote(text); setTimeout(() => setNote(""), 2500); }

  function toggleLike() {
    if (!meId) { router.push(`/signin?next=/posts/${post.id}`); return; }
    const next = !liked;
    // Update the screen first; the request follows. Reverted if it fails.
    setLiked(next); setLikes((n) => n + (next ? 1 : -1));
    startTransition(async () => {
      try {
        const res = await clientApi<{ likeCount: number }>(`/v1/posts/${post.id}/like`, { method: next ? "POST" : "DELETE" });
        setLikes(res.likeCount);
      } catch (e) {
        setLiked(!next); setLikes((n) => n + (next ? -1 : 1));
        flash((e as Error).message);
      }
    });
  }

  async function share() {
    const url = `${window.location.origin}/posts/${post.id}`;
    const text = `${post.author?.name ?? "A member"} on Topsqill.ai: ${post.body.slice(0, 120)}`;
    try {
      if (navigator.share) { await navigator.share({ title: "Topsqill.ai", text, url }); return; }
      await navigator.clipboard.writeText(url);
      flash("Link copied");
    } catch { /* closed the share sheet */ }
  }

  const image = post.media?.length ? imageUrl(post.media[0], "large") : null;
  const listingLink = post.kind === "listing" && post.refId ? `/listings/${post.refId}` : null;

  return (
    <article className="card post">
      <header className="row" style={{ alignItems: "flex-start" }}>
        <Link href={`/profile/${post.authorId}`}><Avatar person={post.author} media={(post.author as { avatar?: never } | null)?.avatar} size={46} /></Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Link href={`/profile/${post.authorId}`} style={{ fontWeight: 800 }}>{post.author?.name ?? "Member"}</Link>
            <TypePill type={post.author?.type} />
          </div>
          <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {post.author?.headline}
          </div>
          <Link href={`/posts/${post.id}`} className="small muted">{timeAgo(post.createdAt)}</Link>
        </div>
      </header>

      <p className="body">{post.body}</p>
      {image ? (
        listingLink
          ? <Link href={listingLink}><img src={image} alt="" loading="lazy" style={{ width: "100%", borderRadius: 12, marginTop: 12 }} /></Link>
          : <img src={image} alt="" loading="lazy" style={{ width: "100%", borderRadius: 12, marginTop: 12 }} />
      ) : null}

      <div className="small muted" style={{ marginTop: 12 }}>
        {compact(likes)} like{likes === 1 ? "" : "s"} · <button className="linklike" onClick={() => setShowComments(true)}>{comments} comment{comments === 1 ? "" : "s"}</button>
        {note ? <span style={{ marginLeft: 8, color: "var(--vio)", fontWeight: 700 }} aria-live="polite">{note}</span> : null}
      </div>

      <div className="pac">
        <button className={`pa ${liked ? "on" : ""}`} onClick={toggleLike} aria-pressed={liked}>{liked ? "💙 Liked" : "👍 Like"}</button>
        <button className="pa" onClick={() => setShowComments((v) => !v)} aria-expanded={showComments}>💬 Comment</button>
        {listingLink
          ? <Link href={listingLink} className="pa">🏠 View listing</Link>
          : <Link href={`/profile/${post.authorId}`} className="pa">👤 Profile</Link>}
        <button className="pa" onClick={share}>↗ Share</button>
      </div>

      {showComments ? <Comments postId={post.id} meId={meId} onAdded={() => setComments((n) => n + 1)} /> : null}
    </article>
  );
}

type CommentRow = { id: string; body: string; authorId: string; authorName: string; authorType?: string; createdAt: string };

function Comments({ postId, meId, onAdded }: { postId: string; meId: string | null; onAdded: () => void }) {
  const [items, setItems] = useState<CommentRow[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    clientApi<{ items: CommentRow[] }>(`/v1/posts/${postId}/comments`)
      .then((r) => { if (live) setItems(r.items ?? []); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [postId]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true); setError("");
    try {
      const row = await clientApi<{ id: string; createdAt: string }>(`/v1/posts/${postId}/comments`, { method: "POST", body: { body: text } });
      setItems((xs) => [{ id: row.id, body: text, authorId: meId ?? "", authorName: "You", createdAt: row.createdAt }, ...(xs ?? [])]);
      setBody("");
      onAdded();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
      {meId ? (
        <div className="row">
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" maxLength={2000}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }} aria-label="Add a comment"
            style={{ flex: 1, height: 38, borderRadius: 999, border: "1.5px solid var(--line)", padding: "0 14px", background: "var(--card)" }} />
          <button className="btn btn-p sm" onClick={send} disabled={busy || !body.trim()}>{busy ? "…" : "Post"}</button>
        </div>
      ) : <Link href={`/signin?next=/posts/${postId}`} className="small">Sign in to comment</Link>}
      {error ? <p className="error small">{error}</p> : null}
      <div className="col" style={{ gap: 8, marginTop: 10 }}>
        {items === null ? <p className="small muted">Loading comments…</p> : null}
        {(items ?? []).map((c) => (
          <div key={c.id} className="row" style={{ alignItems: "flex-start", gap: 8 }}>
            <Avatar person={{ id: c.authorId, name: c.authorName, type: c.authorType }} size={30} />
            <div style={{ flex: 1, background: "var(--soft)", borderRadius: "0 12px 12px 12px", padding: "8px 12px" }}>
              {c.authorId && c.authorName !== "You" ? <Link href={`/profile/${c.authorId}`} className="small" style={{ fontWeight: 800 }}>{c.authorName}</Link> : <b className="small">{c.authorName}</b>}
              <span className="small muted"> · {timeAgo(c.createdAt)}</span>
              <div className="small">{c.body}</div>
            </div>
          </div>
        ))}
        {items && items.length === 0 ? <p className="small muted">No comments yet. Be the first.</p> : null}
      </div>
    </div>
  );
}

/** More posts below the first page, fetched as the member asks for them. */
export function MoreFeed({ cursor, meId }: { cursor: string | null; meId: string }) {
  const [items, setItems] = useState<Post[]>([]);
  const [next, setNext] = useState(cursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!next) return;
    setBusy(true); setError("");
    try {
      const res = await clientApi<{ items: Post[]; nextCursor: string | null }>(`/v1/feed?limit=12&cursor=${encodeURIComponent(next)}`);
      setItems((xs) => {
        const known = new Set(xs.map((x) => x.id));
        return [...xs, ...res.items.filter((p) => !known.has(p.id))];
      });
      setNext(res.nextCursor);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      {items.map((p) => <PostCard key={p.id} post={p} meId={meId} />)}
      {next ? <button className="btn btn-o" onClick={load} disabled={busy} style={{ alignSelf: "center" }}>{busy ? "Loading…" : "Show more posts"}</button>
        : items.length ? <p className="small muted" style={{ textAlign: "center" }}>You’re all caught up.</p> : null}
      {error ? <p className="error small" style={{ textAlign: "center" }}>{error}</p> : null}
    </>
  );
}
