"use client";

import { useEffect, useRef, useState } from "react";
import { clientApi } from "@/lib/api";
import { PersonRow, since } from "./PersonRow";
import { MessageButton, ConnectionMenu } from "./NetworkActions";
import type { NetPage, NetPerson } from "./types";

const TYPES = [["", "Everyone"], ["dealer", "Dealers"], ["builder", "Builders"], ["buyer", "Buyers"], ["seller", "Owners"]] as const;

/** My connections: search, filter by kind, sort, message, remove, and load more. */
export function ConnectionList({ initial }: { initial: NetPage }) {
  const [items, setItems] = useState<NetPerson[]>(initial.items);
  const [total, setTotal] = useState(initial.total ?? initial.items.length);
  const [next, setNext] = useState(initial.nextOffset);
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [loading, setLoading] = useState(false);
  const first = useRef(true);

  const url = (offset: number) => `/v1/connections?status=accepted&limit=30&offset=${offset}&sort=${sort}${type ? `&type=${type}` : ""}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`;

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try { const r = await clientApi<NetPage>(url(0)); setItems(r.items); setTotal(r.total ?? r.items.length); setNext(r.nextOffset); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, sort]);

  async function more() {
    if (next == null) return;
    setLoading(true);
    try { const r = await clientApi<NetPage>(url(next)); setItems((x) => [...x, ...r.items]); setNext(r.nextOffset); }
    finally { setLoading(false); }
  }

  return (
    <>
      <div className="nw-tools">
        <div style={{ position: "relative", flex: "1 1 220px" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, company or city" aria-label="Search your connections" style={{ width: "100%", paddingLeft: 34 }} />
          <span aria-hidden style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", opacity: .55 }}>🔎</span>
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Show">
          {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as "recent" | "name")} aria-label="Sort by">
          <option value="recent">Recently added</option>
          <option value="name">Name (A–Z)</option>
        </select>
      </div>
      <p className="small muted" style={{ margin: "0 0 4px" }} aria-live="polite">{loading ? "Loading…" : `${total.toLocaleString("en-IN")} ${total === 1 ? "person" : "people"}`}</p>
      {items.length ? items.map((p) => (
        <PersonRow key={p.id} p={p} meta={p.since ? `Connected ${since(p.since)}` : null}>
          <MessageButton peerId={p.id} />
          <ConnectionMenu peerId={p.id} name={p.name} onRemoved={() => { setItems((x) => x.filter((y) => y.id !== p.id)); setTotal((n) => Math.max(n - 1, 0)); }} />
        </PersonRow>
      )) : !loading ? <p className="small muted" style={{ padding: "16px 0" }}>{q || type ? "No one matches. Try another name or filter." : "No connections yet. Start with the suggestions on Grow your network."}</p> : null}
      {next != null ? <div style={{ textAlign: "center", marginTop: 12 }}><button className="btn btn-g" onClick={more} disabled={loading}>{loading ? "Loading…" : "Show more"}</button></div> : null}
    </>
  );
}
