import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { WalletTopup } from "@/components/WalletTopup";
import { timeAgo } from "@/lib/format";

export const metadata = { title: "Ad wallet" };
export const dynamic = "force-dynamic";

type Wallet = {
  balancePaise: number; heldPaise: number; feePct: number;
  topup: { available: boolean; gstPct: number; minInr: number };
  txns: { id: string; kind: string; amountPaise: number; balanceAfter: number; note?: string | null; createdAt: string; campaignId?: string | null; campaignName?: string | null }[];
  payments: { id: string; amountPaise: number; gstPaise: number; totalPaise: number; invoiceNo: string; paidAt: string }[];
};
const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const KIND: Record<string, [string, string]> = {
  topup: ["Money added", "#12B76A"], hold: ["Set aside for a campaign", "#2F7FE6"], release: ["Returned to wallet", "#12B76A"],
  spend: ["Ad spend", "#E5484D"], refund: ["Refund", "#12B76A"], adjust: ["Adjustment", "#6A3FE0"],
};

/** The member's prepaid ad wallet: what's available, what's set aside, adding money, history and invoices. */
export default async function WalletPage({ searchParams }: { searchParams: Promise<{ add?: string; back?: string }> }) {
  const [user, token, sp] = await Promise.all([getUser(), getToken(), searchParams]);
  if (!user) redirect("/signin?next=/wallet");
  const w = await api<Wallet>("/v1/wallet", { token }).catch(() => null);
  const back = sp.back?.startsWith("/campaigns/") ? sp.back : null;
  return (
    <Shell user={user} current="/leads">
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Ad wallet</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>Add money once, then run ads on Facebook, Instagram and Google from any campaign. You pay only for what the ads spend; anything unspent stays here.</p>
      {!w ? <p className="error">Couldn't load your wallet. Please try again.</p> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 16 }}>
            <div className="card pad" style={{ background: "var(--brand)", color: "#fff", border: 0 }}>
              <div className="small" style={{ fontWeight: 700, opacity: .85 }}>Available</div>
              <div style={{ font: '800 30px/1.1 "Bricolage Grotesque",system-ui,sans-serif', marginTop: 6 }}>{rs(w.balancePaise)}</div>
            </div>
            <div className="card pad">
              <div className="small" style={{ fontWeight: 700 }}>Set aside for campaigns</div>
              <div style={{ font: '800 30px/1.1 "Bricolage Grotesque",system-ui,sans-serif', marginTop: 6 }}>{rs(w.heldPaise)}</div>
              <div className="small muted">Comes back when a campaign ends with money unspent</div>
            </div>
          </div>

          <WalletTopup available={w.topup.available} gstPct={w.topup.gstPct} minInr={w.topup.minInr} initial={Number(sp.add) || 0} back={back} defaultName={user.name} />

          <section className="card pad" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>History</h2>
            {w.txns.length ? (
              <div style={{ overflowX: "auto" }}>
                <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ textAlign: "left" }}><th style={{ padding: 6 }}>When</th><th style={{ padding: 6 }}>What</th><th style={{ padding: 6, textAlign: "right" }}>Amount</th><th style={{ padding: 6, textAlign: "right" }}>Available after</th></tr></thead>
                  <tbody>
                    {w.txns.map((t) => {
                      const [label, color] = KIND[t.kind] ?? [t.kind, "#8D8AA3"];
                      const out = t.kind === "spend" || t.kind === "hold" || (t.kind === "adjust" && t.amountPaise < 0);
                      return (
                        <tr key={t.id} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: 6, whiteSpace: "nowrap" }} title={new Date(t.createdAt).toLocaleString("en-IN")}>{timeAgo(t.createdAt)}</td>
                          <td style={{ padding: 6 }}>
                            <b style={{ color }}>{label}</b>
                            {t.campaignId ? <> · <Link href={`/campaigns/${t.campaignId}`}>{(t.campaignName ?? "campaign").slice(0, 50)}</Link></> : null}
                            {t.note ? <div className="muted">{t.note}</div> : null}
                          </td>
                          <td style={{ padding: 6, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700 }}>{out ? "−" : "+"}{rs(Math.abs(t.amountPaise))}</td>
                          <td style={{ padding: 6, textAlign: "right", whiteSpace: "nowrap" }}>{rs(t.balanceAfter)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="small muted">Nothing yet. Add money to start running ads.</p>}
          </section>

          <section className="card pad" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>Invoices</h2>
            {w.payments.length ? w.payments.map((p) => (
              <div key={p.id} className="spread small" style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                <span><b>{p.invoiceNo}</b> · {new Date(p.paidAt).toLocaleDateString("en-IN")} · {rs(p.amountPaise)} + GST {rs(p.gstPaise)}</span>
                <Link href={`/wallet/invoices/${p.id}`} className="btn btn-g sm">View / print</Link>
              </div>
            )) : <p className="small muted">Your GST invoices appear here after each payment.</p>}
          </section>
        </>
      )}
    </Shell>
  );
}
