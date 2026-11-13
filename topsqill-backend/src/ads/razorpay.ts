import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay, for members adding money to their ad wallet. Our server creates
 * an order for the exact amount, the member pays in Razorpay's own checkout
 * (card, UPI, net banking: we never see payment details), and the payment is
 * accepted only when Razorpay's signature checks out. The webhook does the
 * same check, so a payment still counts if the member closes the page early.
 */
const API = "https://api.razorpay.com/v1";

export async function createOrder(keyId: string, keySecret: string, o: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "content-type": "application/json" },
    body: JSON.stringify({ amount: o.amountPaise, currency: "INR", receipt: o.receipt.slice(0, 40), notes: o.notes }),
  });
  const body = await res.json().catch(() => ({})) as { id?: string; error?: { description?: string } };
  if (!res.ok || !body.id) throw new Error(`Razorpay: ${body.error?.description ?? res.status}`);
  return body.id;
}

/** Checks the keys work (Admin → Ads → Check). */
export async function checkKeys(keyId: string, keySecret: string) {
  const res = await fetch(`${API}/orders?count=1`, { headers: { authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` } });
  return res.ok ? { ok: true } : { ok: false, error: `Razorpay ${res.status}` };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The checkout's signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export const checkoutSignatureOk = (keySecret: string, orderId: string, paymentId: string, signature: string) =>
  same(createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex"), String(signature ?? ""));

/** The webhook's signature: HMAC-SHA256 of the exact request body with the webhook secret. */
export const webhookSignatureOk = (webhookSecret: string, raw: Buffer, signature: string) =>
  same(createHmac("sha256", webhookSecret).update(raw).digest("hex"), String(signature ?? ""));
