"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";

type W = { id: string; name: string; email?: string | null; phone?: string | null; balancePaise: number; heldPaise: number; updatedAt: string };
const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Members' wallets: totals, search, and credit or debit by hand (refunds, goodwill) with a reason. */
export function WalletAdmin({ initial }: { initial: { totals: { balancePaise: number; heldPaise: number }; items: W[] } }) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ id: string; amount: string; note: string } | null>(null);
  const [msg, setMsg] = useState("");

  async function search() { setData(await clientApi(`/v1/admin/wallets?q=${encodeURIComponent(q)}`)); }
  async function adjust() {
    if (!edit) return;
    const amount = Number(edit.amount);
    if (!amount || !edit.note.trim()) { setMsg("Enter an amount (negative to take money off) and the reason."); return; }
    if (!confirm(`${amount > 0 ? "Add" : "Take off"} ₹${Math.abs(amount).toLocaleString("en-IN")} ${amount > 0 ? "to" : "from"} this wallet?`)) return;
    try { await clientApi(`/v1/admin/wallets/${edit.id}/adjust`, { method: "POST", body: { amountInr: amount, note: edit.note } }); setEdit(null); setMsg("✓ Done. The member has been told."); await search(); }
    catch (e) { setMsg((e as Error).message); }
  }

  return (
    <section className="card pad">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 17 }}>Members&apos; wallets</h2>
        <span className="small muted">All wallets: {rs(data.totals.balancePaise)} available · {rs(data.totals.heldPaise)} set aside</span>
      </div>
      <div className="row" style={{ gap: 6, margin: "8px 0" }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(); }} placeholder="Name, email or phone" style={{ flex: 1 }} />
        <button className="btn btn-g sm" onClick={search}>Search</button>
      </div>
      {msg ? <p className="small" role="status">{msg}</p> : null}
      {data.items.length ? data.items.map((w) => (
        <div key={w.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
          <div className="spread small" style={{ gap: 8, flexWrap: "wrap" }}>
            <span><b>{w.name}</b> <span className="muted">{[w.email, w.phone].filter(Boolean).join(" · ")}</span></span>
            <span>{rs(w.balancePaise)} available · {rs(w.heldPaise)} set aside <button className="linklike" onClick={() => setEdit({ id: w.id, amount: "", note: "" })}>Adjust</button></span>
          </div>
          {edit?.id === w.id ? (
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <input type="number" placeholder="₹ (negative to take off)" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} style={{ width: 170 }} />
              <input placeholder="Reason (the member sees it)" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
              <button className="btn btn-p sm" onClick={adjust}>Apply</button>
              <button className="btn btn-g sm" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          ) : null}
        </div>
      )) : <p className="small muted">No wallets yet.</p>}
    </section>
  );
}
