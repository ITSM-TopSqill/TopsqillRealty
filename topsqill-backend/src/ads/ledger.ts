import { randomUUID } from "node:crypto";
import type { Q } from "./db";

/**
 * The wallet ledger. Every change is one row in wallet_txns with a `ref` that
 * can only be used once per member, so retries (a webhook sent twice, a sync
 * that runs again) never credit or charge twice. Callers run these inside a
 * transaction (inTx); the wallet row is locked first so two changes never race.
 *
 *   balance: money the member can spend or set aside
 *   held:    money set aside for campaigns that are running or in review
 */
export class InsufficientFunds extends Error {
  constructor(public needPaise: number, public havePaise: number) { super("Not enough money in the wallet."); }
}

type Move = { ownerId: string; kind: "topup" | "hold" | "release" | "spend" | "refund" | "adjust"; dBalance: number; dHeld: number; ref: string;
  campaignId?: string | null; paymentId?: string | null; note?: string | null };

async function lock(q: Q, ownerId: string) {
  await q("insert into wallets (owner_id) values ($1) on conflict do nothing", [ownerId]);
  const [w] = await q<{ balance_paise: string; held_paise: string }>("select balance_paise, held_paise from wallets where owner_id = $1 for update", [ownerId]);
  return { balance: Number(w.balance_paise), held: Number(w.held_paise) };
}

/** Applies one change, once. Returns false when this `ref` was already applied. */
async function move(q: Q, m: Move): Promise<boolean> {
  const w = await lock(q, m.ownerId);
  const [seen] = await q("select 1 from wallet_txns where owner_id = $1 and ref = $2", [m.ownerId, m.ref]);
  if (seen) return false;
  const balance = w.balance + m.dBalance, held = w.held + m.dHeld;
  if (balance < 0) throw new InsufficientFunds(-m.dBalance, w.balance);
  if (held < 0) throw new Error("Held amount can't go below zero.");
  await q("update wallets set balance_paise = $2, held_paise = $3, updated_at = now() where owner_id = $1", [m.ownerId, balance, held]);
  const amount = m.kind === "hold" || m.kind === "release" ? m.dHeld : m.dBalance + m.dHeld;
  await q(`insert into wallet_txns (id, owner_id, kind, amount_paise, balance_after, held_after, campaign_id, payment_id, ref, note)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [randomUUID(), m.ownerId, m.kind, amount, balance, held, m.campaignId ?? null, m.paymentId ?? null, m.ref, m.note?.slice(0, 300) ?? null]);
  return true;
}

export const ledger = {
  balance: async (q: Q, ownerId: string) => {
    const [w] = await q<{ balance_paise: string; held_paise: string }>("select balance_paise, held_paise from wallets where owner_id = $1", [ownerId]);
    return { balancePaise: Number(w?.balance_paise ?? 0), heldPaise: Number(w?.held_paise ?? 0) };
  },
  /** Money paid in (a top-up), or credited by an admin. */
  credit: (q: Q, ownerId: string, paise: number, ref: string, o: { kind?: "topup" | "refund" | "adjust"; paymentId?: string; note?: string } = {}) =>
    move(q, { ownerId, kind: o.kind ?? "topup", dBalance: paise, dHeld: 0, ref, paymentId: o.paymentId, note: o.note }),
  /** Taken off by an admin (for example a refund paid out to the member's bank). */
  debit: (q: Q, ownerId: string, paise: number, ref: string, note?: string) =>
    move(q, { ownerId, kind: "adjust", dBalance: -paise, dHeld: 0, ref, note }),
  /** Sets money aside for a campaign. Throws InsufficientFunds when the balance is short. */
  hold: (q: Q, ownerId: string, campaignId: string, paise: number, ref: string) =>
    move(q, { ownerId, kind: "hold", dBalance: -paise, dHeld: paise, ref, campaignId, note: "Set aside for the campaign" }),
  /** Gives set-aside money back to the balance. */
  release: (q: Q, ownerId: string, campaignId: string, paise: number, ref: string, note = "Returned to your wallet") =>
    paise > 0 ? move(q, { ownerId, kind: "release", dBalance: paise, dHeld: -paise, ref, campaignId, note }) : Promise.resolve(false),
  /**
   * Charges ad spend (plus Topsqill's fee). It comes out of the campaign's
   * set-aside money first; any spend reported after that is gone (platforms
   * report late) comes from the balance, as far as the balance goes.
   * Returns what was actually charged.
   */
  spend: async (q: Q, ownerId: string, campaignId: string, paise: number, fromHeldMax: number, ref: string, note: string) => {
    if (paise <= 0) return 0;
    const w = await lock(q, ownerId);
    const fromHeld = Math.min(paise, Math.max(fromHeldMax, 0), w.held);
    const fromBalance = Math.min(paise - fromHeld, w.balance);
    const done = await move(q, { ownerId, kind: "spend", dBalance: -fromBalance, dHeld: -fromHeld, ref, campaignId, note });
    return done ? fromHeld + fromBalance : 0;
  },
};

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
