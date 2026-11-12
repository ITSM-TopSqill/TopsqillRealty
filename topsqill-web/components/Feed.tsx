"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { timeAgo, compact, imageUrl, inr } from "@/lib/format";
import { Avatar, TypePill } from "./ui";
import type { Post, PostRef } from "@/lib/types";
import type { SessionUser } from "@/lib/session";

type Tone = "write" | "fix" | "punchy" | "short" | "hinglish" | "tags";
const STYLES: [Tone, string][] = [["fix", "Fix grammar"], ["punchy", "Punchier"], ["short", "Shorter"], ["hinglish", "Hinglish"], ["tags", "Add hashtags"]];

/** Write a post, with AI help for people who dislike writing. */
export function Composer({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"post" | "ai" | null>(null);
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<string | null>(null);

  /** "write" turns a topic into a post; the other styles rewrite what is there. */
  async function writeWithAi(tone: Tone = "write") {
    if (!body.trim()) { setError("Type a topic first, then let AI expand it."); return; }
    setBusy("ai"); setError("");
    try {
      const res = await clientApi<{ text: string }>("/v1/ai/write/post", {
        method: "POST",
        body: tone === "write" ? { topic: body.slice(0, 600) } : { topic: "rewrite", tone, current: body.slice(0, 5000) },
      });
      setUndo(body);
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
          {body.trim().length > 20 ? (
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }} aria-label="Rewrite with AI">
              <span className="small muted" style={{ fontWeight: 700 }}>✨ Rewrite:</span>
              {STYLES.map(([tone, label]) => (
                <button key={tone} className="chip" style={{ height: 30, fontSize: 12.5 }} onClick={() => writeWithAi(tone)} disabled={busy !== null}>{label}</button>
              ))}
              {undo !== null ? <button className="linklike small" onClick={() => { setBody(undo); setUndo(null); }}>Undo</button> : null}
            </div>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-g sm" onClick={() => { setOpen(false); setBody(""); setError(""); setUndo(null); }}>Cancel</button>
            <button className="btn btn-o sm" onClick={() => writeWithAi("write")} disabled={busy !== null}>
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
  const mine = !!meId && meId === post.authorId;
  const [body, setBody] = useState(post.body);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gone, setGone] = useState(false);
  const [shareMenu, setShareMenu] = useState(false);
  const [repostOpen, setRepostOpen] = useState(false);
  const [repostText, setRepostText] = useState("");
  const [reposting, setReposting] = useState(false);
  const [reposts, setReposts] = useState(post.repostOf ? post.repostOf.repostCount : post.repostCount);

  async function saveEdit() {
    const text = (editing ?? "").trim();
    if (!text) { flash("A post can’t be empty"); return; }
    setSaving(true);
    try {
      await clientApi(`/v1/posts/${post.id}`, { method: "PATCH", body: { body: text } });
      setBody(text); setEditing(null); flash("Saved");
    } catch (e) { flash((e as Error).message); }
    finally { setSaving(false); }
  }

  async function remove() {
    setMenu(false);
    if (!confirm("Delete this post? Its likes and comments are deleted too. This can’t be undone.")) return;
    try {
      await clientApi(`/v1/posts/${post.id}`, { method: "DELETE" });
      setGone(true);
      if (window.location.pathname.startsWith("/posts/")) router.push("/");
      else router.refresh();
    } catch (e) { flash((e as Error).message); }
  }

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

  const shareUrl = () => `${window.location.origin}/posts/${post.id}`;
  const shareText = () => `${post.author?.name ?? "A member"} on Topsqill.ai: ${(body || post.repostOf?.body || "").slice(0, 120)}`;
  function shareWhatsApp() {
    setShareMenu(false);
    window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText()}\n${shareUrl()}`)}`, "_blank", "noopener,noreferrer");
  }
  async function copyLink() {
    setShareMenu(false);
    try { await navigator.clipboard.writeText(shareUrl()); flash("Link copied"); } catch { flash("Couldn’t copy the link"); }
  }
  async function shareMore() {
    setShareMenu(false);
    try { if (navigator.share) await navigator.share({ title: "Topsqill.ai", text: shareText(), url: shareUrl() }); else await copyLink(); } catch { /* closed */ }
  }
  async function repost() {
    if (!meId) { router.push(`/signin?next=/posts/${post.id}`); return; }
    setReposting(true);
    try {
      await clientApi(`/v1/posts/${post.repostOf?.id ?? post.id}/repost`, { method: "POST", body: { body: repostText.trim() || undefined } });
      setRepostOpen(false); setRepostText(""); setReposts((n) => n + 1);
      flash("Reposted to your network");
      router.refresh();
    } catch (e) { flash((e as Error).message); }
    finally { setReposting(false); }
  }

  if (gone) return null;
  // A listing post shows its listing card (with the cover photo) instead of a separate image.
  const image = post.ref?.type !== "listing" && post.media?.length ? imageUrl(post.media[0], "large") : null;
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
        {mine ? (
          <div style={{ position: "relative" }}>
            <button className="btn btn-g sm" aria-label="Post options" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>⋯</button>
            {menu ? (
              <div className="card" role="menu" style={{ position: "absolute", right: 0, top: 36, zIndex: 5, minWidth: 150, padding: 4 }}>
                <button role="menuitem" className="pmi" onClick={() => { setMenu(false); setEditing(body); }}>✏️ Edit post</button>
                <button role="menuitem" className="pmi" style={{ color: "var(--red)" }} onClick={remove}>🗑 Delete post</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {editing !== null ? (
        <div style={{ marginTop: 10 }}>
          <textarea value={editing} onChange={(e) => setEditing(e.target.value)} rows={4} maxLength={5000} aria-label="Edit your post" autoFocus
            style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 12, padding: 10, background: "var(--card)", font: "inherit" }} />
          <div className="row" style={{ justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
            <button className="btn btn-g sm" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button className="btn btn-p sm" onClick={saveEdit} disabled={saving || !editing.trim()}>{saving ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : body ? <p className="body">{body}</p> : null}
      {post.repostOfId ? <Reposted original={post.repostOf ?? null} /> : null}
      {post.ref ? <RefCard r={post.ref} mine={mine} /> : null}
      {image ? (
        listingLink
          ? <Link href={listingLink}><img src={image} alt="" loading="lazy" style={{ width: "100%", borderRadius: 12, marginTop: 12 }} /></Link>
          : <img src={image} alt="" loading="lazy" style={{ width: "100%", borderRadius: 12, marginTop: 12 }} />
      ) : null}

      <div className="small muted" style={{ marginTop: 12 }}>
        {compact(likes)} like{likes === 1 ? "" : "s"} · <button className="linklike" onClick={() => setShowComments(true)}>{comments} comment{comments === 1 ? "" : "s"}</button>
        {reposts ? <> · {compact(reposts)} repost{reposts === 1 ? "" : "s"}</> : null}
        {note ? <span style={{ marginLeft: 8, color: "var(--vio)", fontWeight: 700 }} aria-live="polite">{note}</span> : null}
      </div>

      <div className="pac">
        <button className={`pa ${liked ? "on" : ""}`} onClick={toggleLike} aria-pressed={liked}>{liked ? "💙 Liked" : "👍 Like"}</button>
        <button className="pa" onClick={() => setShowComments((v) => !v)} aria-expanded={showComments}>💬 Comment</button>
        {listingLink ? <Link href={listingLink} className="pa">🏠 Listing</Link> : null}
        <button className="pa" onClick={() => setRepostOpen((v) => !v)} aria-expanded={repostOpen}>🔁 Repost</button>
        <span style={{ position: "relative", display: "inline-flex" }}>
          <button className="pa" onClick={() => setShareMenu((v) => !v)} aria-expanded={shareMenu} aria-haspopup="menu">↗ Share</button>
          {shareMenu ? (
            <div className="card" role="menu" style={{ position: "absolute", right: 0, bottom: 40, zIndex: 5, minWidth: 180, padding: 4 }}>
              <button role="menuitem" className="pmi" onClick={shareWhatsApp}>🟢 Share on WhatsApp</button>
              <button role="menuitem" className="pmi" onClick={copyLink}>🔗 Copy link</button>
              <button role="menuitem" className="pmi" onClick={shareMore}>↗ More options</button>
            </div>
          ) : null}
        </span>
      </div>
      {repostOpen ? (
        <div style={{ marginTop: 8 }}>
          <textarea value={repostText} onChange={(e) => setRepostText(e.target.value)} rows={2} maxLength={3000} placeholder="Add your thoughts (optional)" aria-label="Your words with the repost"
            style={{ width: "100%", border: "1.5px solid var(--line)", borderRadius: 12, padding: 10, background: "var(--card)", font: "inherit" }} />
          <div className="row" style={{ justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
            <button className="btn btn-g sm" onClick={() => setRepostOpen(false)} disabled={reposting}>Cancel</button>
            <button className="btn btn-p sm" onClick={repost} disabled={reposting}>{reposting ? "Reposting…" : "Repost"}</button>
          </div>
        </div>
      ) : null}

      {showComments ? <Comments postId={post.id} postBody={body} meId={meId} postAuthorId={post.authorId} onCount={(n) => setComments(n)} onAdded={() => setComments((n) => n + 1)} /> : null}
    </article>
  );
}

/** The original post inside a repost, as a smaller card. */
const KIND_TAG = { listing: ["New listing", "#12B76A"], requirement: ["Requirement", "#2F7FE6"], job: ["Hiring", "#7B3DFF"] } as const;

/** The essentials of what the post is about: price, size and place for a listing; budget and areas for a requirement; role and pay for a job. */
function RefCard({ r, mine }: { r: PostRef; mine: boolean }) {
  const [label, color] = KIND_TAG[r.type];
  const tag = <span className="pill" style={{ color, background: `color-mix(in srgb, ${color} 13%, transparent)`, fontSize: 11.5 }}>{label}</span>;
  if (r.type === "listing") {
    const cover = imageUrl(r.cover, "large");
    const rent = r.purpose === "rent";
    const closed = r.status === "sold";
    return (
      <Link href={`/listings/${r.id}`} className="refcard" style={{ display: "block", marginTop: 12, border: "1.5px solid var(--line)", borderRadius: 14, overflow: "hidden", color: "inherit" }}>
        {cover ? (
          <div style={{ position: "relative" }}>
            <img src={cover} alt={r.title} loading="lazy" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", display: "block" }} />
            {closed ? <span className="pill" style={{ position: "absolute", left: 10, top: 10, background: "#1F1D33", color: "#fff" }}>{rent ? "Rented" : "Sold"}</span> : null}
          </div>
        ) : null}
        <div style={{ padding: "10px 12px", display: "grid", gap: 4 }}>
          <div className="spread" style={{ gap: 8 }}>
            <b style={{ fontSize: 18 }}>{inr(r.priceInr, rent)}</b>
            <span className="row" style={{ gap: 6 }}>{r.verified ? <span className="tag" style={{ color: "#2E9E90" }}>✓ Verified</span> : null}{tag}</span>
          </div>
          <div style={{ fontWeight: 700 }}>{[r.bhk ? `${r.bhk} BHK` : null, r.kind, r.areaSqft ? `${r.areaSqft.toLocaleString("en-IN")} sq ft` : null].filter(Boolean).join(" · ")}</div>
          <div className="small muted">📍 {r.locality}, {r.city}{r.possession ? ` · ${r.possession}` : ""} · {rent ? "For rent" : "For sale"}</div>
          <span className="small" style={{ color: "var(--vio)", fontWeight: 800 }}>View listing →</span>
        </div>
      </Link>
    );
  }
  if (r.type === "requirement") {
    const budget = r.maxPrice ? (r.minPrice ? `${inr(r.minPrice, r.purpose === "rent")} – ${inr(r.maxPrice, r.purpose === "rent")}` : `Up to ${inr(r.maxPrice, r.purpose === "rent")}`) : "Budget open";
    return (
      <div style={{ marginTop: 12, border: "1.5px solid var(--line)", borderRadius: 14, padding: "10px 12px", display: "grid", gap: 4, background: "var(--soft)" }}>
        <div className="spread" style={{ gap: 8 }}><b style={{ fontSize: 16 }}>{budget}</b>{tag}</div>
        <div style={{ fontWeight: 700 }}>{r.purpose === "rent" ? "To rent" : "To buy"}: {[r.bhk ? `${r.bhk} BHK` : null, r.kind].filter(Boolean).join(" ")}</div>
        <div className="small muted">📍 {r.localities?.length ? `${r.localities.join(", ")} · ` : ""}{r.city}{r.timeline ? ` · ${r.timeline}` : ""}{r.status === "matched" ? " · Matched" : ""}</div>
        <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <Link href={`/requirements/${r.id}`} className="btn btn-p sm">{mine ? `See matches${r.matchCount ? ` (${r.matchCount})` : ""}` : "🤝 I have a match"}</Link>
        </div>
      </div>
    );
  }
  const lpa = (v?: string | null) => (v ? String(Number(v)) : "");
  const pay = r.salaryMin || r.salaryMax ? `₹${[lpa(r.salaryMin), lpa(r.salaryMax)].filter(Boolean).join("–")} LPA` : null;
  return (
    <Link href={`/jobs/${r.id}`} style={{ display: "grid", gap: 4, marginTop: 12, border: "1.5px solid var(--line)", borderRadius: 14, padding: "10px 12px", color: "inherit" }}>
      <div className="spread" style={{ gap: 8 }}><b style={{ fontSize: 16 }}>{r.title}</b>{tag}</div>
      <div style={{ fontWeight: 700 }}>{r.company}</div>
      <div className="small muted">📍 {[r.locality, r.city].filter(Boolean).join(", ")} · {r.employment} · {r.workMode} · {r.expMin}–{r.expMax} yrs{pay ? ` · ${pay}` : ""}{r.status === "closed" ? " · Closed" : ""}</div>
      <span className="small" style={{ color: "var(--vio)", fontWeight: 800 }}>{r.status === "closed" ? "View job →" : "View and apply →"}</span>
    </Link>
  );
}

function Reposted({ original }: { original: Post | null }) {
  if (!original) return <div className="small muted" style={{ marginTop: 10, padding: 12, border: "1.5px solid var(--line)", borderRadius: 12 }}>The original post is no longer available.</div>;
  const image = original.media?.length ? imageUrl(original.media[0], "card") : null;
  return (
    <Link href={`/posts/${original.id}`} style={{ display: "block", marginTop: 10, padding: 12, border: "1.5px solid var(--line)", borderRadius: 12, textDecoration: "none", color: "inherit" }}>
      <div className="row" style={{ gap: 8 }}>
        <Avatar person={original.author} media={(original.author as { avatar?: never } | null)?.avatar} size={30} />
        <div style={{ minWidth: 0 }}>
          <b className="small">{original.author?.name ?? "Member"}</b> <TypePill type={original.author?.type} />
          <div className="small muted">{timeAgo(original.createdAt)}</div>
        </div>
      </div>
      <p className="small" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{original.body.length > 400 ? `${original.body.slice(0, 397)}…` : original.body}</p>
      {image ? <img src={image} alt="" loading="lazy" style={{ width: "100%", borderRadius: 10, marginTop: 8 }} /> : null}
    </Link>
  );
}

type CommentRow = { id: string; body: string; authorId: string; authorName: string; authorType?: string; createdAt: string };

function Comments({ postId, postBody, meId, postAuthorId, onAdded, onCount }: {
  postId: string; postBody: string; meId: string | null; postAuthorId: string; onAdded: () => void; onCount: (n: number) => void;
}) {
  const [suggesting, setSuggesting] = useState(false);
  /** Drafts a short comment; the member edits or posts it. */
  async function suggest() {
    setSuggesting(true); setError("");
    try {
      const res = await clientApi<{ text: string }>("/v1/ai/write/comment", { method: "POST", body: { postBody: postBody.slice(0, 4000) } });
      setBody(res.text);
    } catch (e) { setError((e as Error).message); }
    finally { setSuggesting(false); }
  }
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

  /** Your own comments, and any comment on your own post, can be removed. */
  async function removeComment(id: string) {
    if (!confirm("Delete this comment?")) return;
    try {
      const res = await clientApi<{ commentCount: number }>(`/v1/posts/${postId}/comments/${id}`, { method: "DELETE" });
      setItems((xs) => (xs ?? []).filter((c) => c.id !== id));
      onCount(res.commentCount);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
      {meId ? (
        <div className="row">
          <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" maxLength={2000}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }} aria-label="Add a comment"
            style={{ flex: 1, height: 38, borderRadius: 999, border: "1.5px solid var(--line)", padding: "0 14px", background: "var(--card)" }} />
          <button className="btn btn-g sm" onClick={suggest} disabled={busy || suggesting} title="Suggest a comment with AI">{suggesting ? "…" : "✨"}</button>
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
              {meId && (c.authorId === meId || postAuthorId === meId) ? (
                <button className="linklike small" style={{ marginLeft: 8, color: "var(--ink3)" }} onClick={() => removeComment(c.id)} aria-label="Delete comment">Delete</button>
              ) : null}
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
export function MoreFeed({ cursor, meId, filter }: { cursor: string | null; meId: string; filter?: string }) {
  const [items, setItems] = useState<Post[]>([]);
  const [next, setNext] = useState(cursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!next) return;
    setBusy(true); setError("");
    try {
      const res = await clientApi<{ items: Post[]; nextCursor: string | null }>(`/v1/feed?limit=12&cursor=${encodeURIComponent(next)}${filter ? `&filter=${filter}` : ""}`);
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
