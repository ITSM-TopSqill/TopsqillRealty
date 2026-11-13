"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, f: (r: unknown) => void) => void } } }

type Order = { orderId: string; keyId: string; amountPaise: number; currency: string; name: string; description: string; prefill: Record<string, string> };
const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't open the payment window. Check your connection and try again."));
    document.body.appendChild(s);
  });
}

/**
 * Adding money: the amount (plus GST), optional GST details for the invoice,
 * then Razorpay's own checkout (UPI, cards, net banking). We never see the
 * payment details; the wallet is credited once Razorpay confirms.
 */
export function WalletTopup({ available, gstPct, minInr, initial, back, defaultName }: { available: boolean; gstPct: number; minInr: number; initial: number; back: string | null; defaultName: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(Math.max(initial, minInr));
  const [gst, setGst] = useState(false);
  const [billing, setBilling] = useState({ name: defaultName, gstin: "", address: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const tax = Math.round(amount * gstPct);       // paise
  const total = amount * 100 + tax;

  async function pay() {
    setError(""); setMsg("");
    if (amount < minInr) { setError(`The minimum is ₹${minInr.toLocaleString("en-IN")}.`); return; }
    if (gst && billing.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(billing.gstin.toUpperCase())) { setError("That GSTIN doesn't look right (15 characters)."); return; }
    setBusy(true);
    try {
      const o = await clientApi<Order>("/v1/wallet/topup", { method: "POST", body: { amountInr: amount, billing: gst ? { ...billing, gstin: billing.gstin.toUpperCase() } : { name: billing.name } } });
      await loadCheckout();
      const rz = new window.Razorpay!({
        key: o.keyId, order_id: o.orderId, amount: o.amountPaise, currency: o.currency, name: o.name, description: o.description, prefill: o.prefill,
        theme: { color: "#6A3FE0" },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await clientApi("/v1/wallet/topup/confirm", { method: "POST", body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature } });
            setMsg(`✓ ${rs(amount * 100)} added to your wallet.`);
            if (back) router.push(back); else router.refresh();
          } catch (e) { setError((e as Error).message); }
          finally { setBusy(false); }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rz.on("payment.failed", () => { setError("The payment didn't go through. No money was taken; please try again."); setBusy(false); });
      rz.open();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  if (!available) return <section className="card pad small" style={{ background: "var(--soft)" }}>Adding money isn't available yet. Please check back soon.</section>;
  return (
    <section className="card pad" style={{ border: "2px solid var(--vio)" }}>
      <h2 style={{ fontSize: 17, marginBottom: 8 }}>Add money</h2>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {[5000, 10000, 25000, 50000].filter((v) => v >= minInr).map((v) => (
          <button key={v} type="button" className={`chip${amount === v ? " on" : ""}`} onClick={() => setAmount(v)}>₹{v.toLocaleString("en-IN")}</button>
        ))}
      </div>
      <label className="small">Amount for ads (₹)<br />
        <input type="number" min={minInr} step={500} value={amount} onChange={(e) => setAmount(Math.max(Math.round(Number(e.target.value) || 0), 0))} style={{ width: 180 }} />
      </label>
      <div style={{ background: "var(--soft)", borderRadius: 10, padding: "8px 10px", margin: "10px 0", maxWidth: 420 }}>
        <div className="spread small"><span>Added to your wallet</span><b>{rs(amount * 100)}</b></div>
        <div className="spread small"><span>GST ({gstPct}%)</span><span>{rs(tax)}</span></div>
        <div className="spread" style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4 }}><b>You pay</b><b>{rs(total)}</b></div>
      </div>
      <label className="row small" style={{ gap: 6, marginBottom: 6 }}><input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} /> Add my GST details to the invoice</label>
      {gst ? (
        <div className="col" style={{ gap: 6, maxWidth: 420, marginBottom: 8 }}>
          <input placeholder="Business name" value={billing.name} onChange={(e) => setBilling({ ...billing, name: e.target.value })} />
          <input placeholder="GSTIN (15 characters)" value={billing.gstin} maxLength={15} onChange={(e) => setBilling({ ...billing, gstin: e.target.value.toUpperCase() })} />
          <input placeholder="Billing address" value={billing.address} onChange={(e) => setBilling({ ...billing, address: e.target.value })} />
        </div>
      ) : null}
      <button className="btn btn-ai" onClick={pay} disabled={busy || amount < minInr}>{busy ? "Opening payment…" : `Pay ${rs(total)}`}</button>
      <p className="small muted" style={{ margin: "8px 0 0" }}>Secure payment by Razorpay: UPI, cards, net banking. Topsqill never sees your card or bank details. By paying you agree to the <a href="/terms" target="_blank">terms and refund rules</a>.</p>
      {msg ? <p className="small" role="status" style={{ color: "#0E8F55", fontWeight: 700 }}>{msg}</p> : null}
      {error ? <p className="small error" role="alert">{error}</p> : null}
    </section>
  );
}
