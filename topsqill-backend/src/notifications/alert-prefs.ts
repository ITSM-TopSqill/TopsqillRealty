import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The alerts a member can switch off, per channel. Account and security
 * notices ("system") always go out. Pure, so the API and the worker share it.
 */
export const ALERT_KINDS = [
  { kind: "message", label: "Messages", hint: "When someone sends you a message" },
  { kind: "connection", label: "Invitations", hint: "Invitations to connect and accepted invitations" },
  { kind: "lead", label: "New leads", hint: "Enquiries on your listings and from your ads" },
  { kind: "match", label: "Matches", hint: "Listings that match your requirements, and buyers for yours" },
  { kind: "comment", label: "Comments and likes", hint: "Activity on your posts" },
  { kind: "post", label: "Network updates", hint: "Posts from people you follow" },
  { kind: "job", label: "Jobs", hint: "Applications to your jobs and updates on yours" },
  { kind: "listing", label: "Listing reviews", hint: "When your listing is approved or needs changes" },
  { kind: "campaign", label: "Ad campaigns", hint: "Campaign approvals, results and wallet updates" },
] as const;
export type Channel = "email" | "push";
export type AlertPrefs = { email?: Record<string, boolean>; push?: Record<string, boolean> };
const KNOWN = new Set<string>(ALERT_KINDS.map((k) => k.kind));

/** Whether the member still wants this kind of alert on this channel. */
export function wantsAlert(prefs: AlertPrefs | null | undefined, channel: Channel, kind: string) {
  if (!KNOWN.has(kind)) return true;
  return prefs?.[channel]?.[kind] !== false;
}

/** Keeps only known kinds and true/false values, so stored settings stay clean. */
export function cleanPrefs(input: unknown): AlertPrefs {
  const out: AlertPrefs = { email: {}, push: {} };
  for (const ch of ["email", "push"] as const) {
    const src = (input as Record<string, unknown> | null)?.[ch];
    if (!src || typeof src !== "object") continue;
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) if (KNOWN.has(k) && typeof v === "boolean") out[ch]![k] = v;
  }
  return out;
}

/** The full table of settings, every kind filled in, for the settings page. */
export function fullPrefs(prefs: AlertPrefs | null | undefined) {
  return ALERT_KINDS.map((k) => ({ ...k, email: wantsAlert(prefs, "email", k.kind), push: wantsAlert(prefs, "push", k.kind) }));
}

/**
 * Unsubscribe links carry a signature instead of a sign-in, so one click
 * from an email works. It covers only "stop this kind of email", nothing else.
 */
export function unsubscribeSig(secret: string, userId: string, kind: string) {
  return createHmac("sha256", secret).update(`unsubscribe:${userId}:${kind}`).digest("base64url").slice(0, 32);
}
export function checkUnsubscribeSig(secret: string, userId: string, kind: string, sig: string) {
  const want = Buffer.from(unsubscribeSig(secret, userId, kind));
  const got = Buffer.from(String(sig ?? ""));
  return want.length === got.length && timingSafeEqual(want, got);
}
export function isUnsubscribeKind(kind: string) { return kind === "all" || KNOWN.has(kind); }
