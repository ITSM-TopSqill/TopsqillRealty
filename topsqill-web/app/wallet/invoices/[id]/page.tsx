import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { PrintButton } from "@/components/PrintButton";

export const metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

type Invoice = {
  invoiceNo: string; date: string; paymentRef?: string | null;
  seller: { name: string; gstin: string; address: string; stateCode: string; sac: string; email: string };
  buyer: { name?: string; gstin?: string | null; address?: string | null; email?: string | null; phone?: string | null };
  lines: { description: string; sac: string | null; amountPaise: number }[];
  tax: { name: string; paise: number }[]; totalPaise: number;
};
const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A printable tax invoice for one wallet top-up. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, token] = await Promise.all([params, getUser(), getToken()]);
  if (!user) redirect(`/signin?next=/wallet/invoices/${id}`);
  const inv = await api<Invoice>(`/v1/wallet/invoices/${id}`, { token }).catch(() => null);
  if (!inv) notFound();
  return (
    <main style={{ maxWidth: 760, margin: "24px auto", padding: "0 16px", background: "var(--bg)" }}>
      <div className="row no-print" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <Link href="/wallet" className="small">← Ad wallet</Link>
        <PrintButton />
      </div>
      <article className="card pad" style={{ background: "#fff", color: "#111" }}>
        <div className="spread" style={{ alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 22 }}>Tax invoice</h1>
            <div className="small">No. <b>{inv.invoiceNo}</b> · {new Date(inv.date).toLocaleDateString("en-IN")}</div>
            {inv.paymentRef ? <div className="small">Payment ref. {inv.paymentRef}</div> : null}
          </div>
          <div className="small" style={{ textAlign: "right" }}>
            <b>{inv.seller.name}</b>
            {inv.seller.address ? <div style={{ whiteSpace: "pre-wrap" }}>{inv.seller.address}</div> : null}
            {inv.seller.gstin ? <div>GSTIN {inv.seller.gstin}</div> : null}
            {inv.seller.email ? <div>{inv.seller.email}</div> : null}
          </div>
        </div>
        <div className="small" style={{ margin: "16px 0", padding: "8px 10px", background: "#f6f5fb", borderRadius: 8 }}>
          <b>Billed to:</b> {inv.buyer.name}{inv.buyer.gstin ? ` · GSTIN ${inv.buyer.gstin}` : ""}
          {inv.buyer.address ? <div>{inv.buyer.address}</div> : null}
          <div>{[inv.buyer.email, inv.buyer.phone].filter(Boolean).join(" · ")}</div>
        </div>
        <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}><th style={{ padding: 6 }}>Description</th><th style={{ padding: 6 }}>SAC</th><th style={{ padding: 6, textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => <tr key={l.description}><td style={{ padding: 6 }}>{l.description}</td><td style={{ padding: 6 }}>{l.sac ?? "—"}</td><td style={{ padding: 6, textAlign: "right" }}>{rs(l.amountPaise)}</td></tr>)}
            {inv.tax.map((t) => <tr key={t.name}><td style={{ padding: 6 }} colSpan={2}>{t.name}</td><td style={{ padding: 6, textAlign: "right" }}>{rs(t.paise)}</td></tr>)}
            <tr style={{ borderTop: "2px solid #111" }}><td style={{ padding: 6 }} colSpan={2}><b>Total paid</b></td><td style={{ padding: 6, textAlign: "right" }}><b>{rs(inv.totalPaise)}</b></td></tr>
          </tbody>
        </table>
        <p className="small" style={{ marginTop: 16, color: "#555" }}>Prepaid credit for advertising on Facebook, Instagram and Google, run by {inv.seller.name}. This is a computer-generated invoice.</p>
      </article>
      <style>{`@media print{.no-print{display:none!important}body{background:#fff}}`}</style>
    </main>
  );
}
