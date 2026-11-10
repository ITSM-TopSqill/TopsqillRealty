"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { clientApi } from "@/lib/api";
import { inr, imageUrl } from "@/lib/format";
import { EMPTY, type SearchResults } from "@/lib/search";
import { Avatar } from "./ui";

type Item = { key: string; href: string; node: React.ReactNode };

/**
 * The search box in the top bar. Results appear as you type (people,
 * listings, localities, jobs); Enter opens the full results page. Arrow keys
 * move through the list.
 */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(pathname === "/search" ? params.get("q") ?? "" : "");
  const [res, setRes] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const box = useRef<HTMLFormElement>(null);

  // Type, pause a moment, search. Older answers never overwrite newer ones.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(EMPTY); setBusy(false); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await clientApi<SearchResults>(`/v1/search?q=${encodeURIComponent(term)}&limit=4`);
        if (live) { setRes(r); setActive(-1); }
      } catch { if (live) setRes(EMPTY); }
      finally { if (live) setBusy(false); }
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  const items: Item[] = [
    ...res.people.map((p) => ({ key: `p${p.id}`, href: `/profile/${p.id}`, node: (
      <><Avatar person={p} size={32} /><span className="sr-text"><b>{p.name}</b><small>{[p.type === "seller" ? "Owner" : p.type[0].toUpperCase() + p.type.slice(1), p.agency, p.city].filter(Boolean).join(" · ")}</small></span></>) })),
    ...res.listings.map((l) => ({ key: `l${l.id}`, href: `/listings/${l.id}`, node: (
      <>{imageUrl(l.cover, "thumb") ? <img className="sr-thumb" src={imageUrl(l.cover, "thumb")!} alt="" /> : <span className="sr-thumb" aria-hidden>🏠</span>}
        <span className="sr-text"><b>{l.title}</b><small>{inr(l.priceInr, l.purpose === "rent")} · {l.locality}, {l.city}</small></span></>) })),
    ...res.localities.map((x) => ({ key: `x${x.locality}${x.city}`, href: `/listings?city=${encodeURIComponent(x.city)}&locality=${encodeURIComponent(x.locality)}`, node: (
      <><span className="sr-thumb" aria-hidden>📍</span><span className="sr-text"><b>{x.locality}, {x.city}</b><small>{x.listings} listing{x.listings === 1 ? "" : "s"}{x.avgRate ? ` · avg ₹${x.avgRate.toLocaleString("en-IN")}/sq ft` : ""}</small></span></>) })),
    ...res.jobs.map((j) => ({ key: `j${j.id}`, href: `/jobs/${j.id}`, node: (
      <><span className="sr-thumb" aria-hidden>💼</span><span className="sr-text"><b>{j.title}</b><small>{j.company} · {j.city}</small></span></>) })),
  ];
  const all = `/search?q=${encodeURIComponent(q.trim())}`;

  function go(href: string) { setOpen(false); router.push(href); }

  return (
    <form ref={box} className="searchbox" role="search" onSubmit={(e) => {
      e.preventDefault();
      if (active >= 0 && items[active]) go(items[active].href);
      else if (q.trim().length >= 2) go(all);
    }}>
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Search people, listings, localities, jobs" aria-label="Search" autoComplete="off"
        aria-expanded={open && q.trim().length >= 2} aria-controls="search-results"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, items.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {open && q.trim().length >= 2 ? (
        <div className="sdrop" id="search-results" role="listbox">
          {busy && !items.length ? <div className="sr-note">Searching…</div> : null}
          {!busy && !items.length ? <div className="sr-note">Nothing matches “{q.trim()}”. Try a locality, a name or “3 BHK”.</div> : null}
          {items.map((it, i) => (
            <button type="button" key={it.key} role="option" aria-selected={i === active}
              className={`sr ${i === active ? "on" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => go(it.href)}>
              {it.node}
            </button>
          ))}
          {items.length ? <button type="button" className="sr sr-all" onClick={() => go(all)}>See all results for “{q.trim()}” →</button> : null}
        </div>
      ) : null}
    </form>
  );
}
