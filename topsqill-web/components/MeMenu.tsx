"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Avatar } from "./ui";
import type { SessionUser } from "@/lib/session";

/**
 * The "Me" menu in the top bar: profile, settings and Sign out. On phones,
 * where the top tabs are hidden, it also holds the pages the bottom bar
 * has no room for (Requirements, Jobs, Alerts).
 */
export function MeMenu({ user, current }: { user: SessionUser; current: string }) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function signOut() {
    setLeaving(true);
    // Ends the session on the server (the refresh token is revoked) and
    // deletes the cookies; then a full reload, so nothing of this member
    // stays in memory, and this tab's saved chats are cleared too.
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    try { sessionStorage.clear(); } catch { /* storage blocked */ }
    window.location.assign("/signin");
  }

  const first = user.name.split(" ")[0];
  return (
    <div className="me" ref={box}>
      <button type="button" className={`tab me-btn ${current.startsWith("/profile") ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}>
        <Avatar person={user} media={user.avatar as never} size={24} />
        <span className="me-label">Me ▾</span>
      </button>
      {open ? (
        <div className="me-pop card" role="menu" aria-label="Your account">
          <div className="row" style={{ gap: 10, padding: "12px 14px 8px" }}>
            <Avatar person={user} media={user.avatar as never} size={44} />
            <div style={{ minWidth: 0 }}>
              <b className="ell" style={{ display: "block" }}>{user.name}</b>
              {user.headline ? <span className="small muted ell" style={{ display: "block" }}>{user.headline}</span> : null}
            </div>
          </div>
          <div style={{ padding: "0 14px 10px" }}>
            <Link href={`/profile/${user.id}`} className="btn btn-o sm" style={{ width: "100%", justifyContent: "center" }} role="menuitem" onClick={() => setOpen(false)}>
              View profile
            </Link>
          </div>
          <div className="me-sep" />
          <Link href="/profile/edit" role="menuitem" className="me-item" onClick={() => setOpen(false)}>✏️ Edit profile</Link>
          <Link href="/saved" role="menuitem" className="me-item" onClick={() => setOpen(false)}>♥ Saved homes</Link>
          <Link href="/profile/verify" role="menuitem" className="me-item" onClick={() => setOpen(false)}>✅ Verification</Link>
          <Link href="/campaigns" role="menuitem" className="me-item" onClick={() => setOpen(false)}>📣 Campaigns</Link>
          {/* Phones: pages the bottom bar has no room for. */}
          <div className="me-phone">
            <div className="me-sep" />
            <Link href="/requirements" role="menuitem" className="me-item" onClick={() => setOpen(false)}>📋 Requirements</Link>
            <Link href="/jobs" role="menuitem" className="me-item" onClick={() => setOpen(false)}>💼 Jobs</Link>
            <Link href="/notifications" role="menuitem" className="me-item" onClick={() => setOpen(false)}>🔔 Alerts</Link>
          </div>
          {user.isAdmin ? <Link href="/admin" role="menuitem" className="me-item me-phone" onClick={() => setOpen(false)}>🛡 Admin</Link> : null}
          <div className="me-sep" />
          <button type="button" role="menuitem" className="me-item" onClick={signOut} disabled={leaving}>
            {leaving ? "Signing out…" : `↪ Sign out${first ? ` (${first})` : ""}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
