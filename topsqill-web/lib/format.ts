/** Indian number and date formatting, so prices read the same way everywhere. */

export function inr(value?: number | null, perMonth = false): string {
  if (!value) return "Price on request";
  if (perMonth) return `₹${Math.round(value).toLocaleString("en-IN")}/month`;
  if (value >= 1e7) {
    const cr = value / 1e7;
    return `₹${(cr >= 10 ? cr.toFixed(1) : cr.toFixed(2)).replace(/\.?0+$/, "")} Cr`;
  }
  if (value >= 1e5) return `₹${Math.round(value / 1e5)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export const sqft = (n?: number | null) => (n ? `${n.toLocaleString("en-IN")} sq ft` : "");

export function timeAgo(iso?: string | Date | null): string {
  if (!iso) return "";
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 10080) return `${Math.floor(m / 1440)}d ago`;
  return `${Math.floor(m / 10080)}w ago`;
}

export const compact = (n?: number | null) =>
  !n ? "0" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);

/** Picks the right image size for the slot, preferring the smallest modern format. */
export function imageUrl(
  media?: { urls?: Record<string, string> } | null,
  size: "thumb" | "card" | "large" | "full" = "card",
): string | null {
  if (!media?.urls) return null;
  for (const format of ["avif", "webp", "jpeg"]) {
    const url = media.urls[`${size}_${format}`];
    if (url) return url;
  }
  return Object.values(media.urls)[0] ?? null;
}

export const initials = (name?: string | null) =>
  (name ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export const TYPE_LABEL: Record<string, string> = { buyer: "Buyer", seller: "Owner", dealer: "Dealer", builder: "Builder" };
export const TYPE_COLOR: Record<string, string> = { buyer: "#4A86D4", seller: "#2E9E90", dealer: "#D9668C", builder: "#D9A441" };
export const STAGE_LABEL: Record<string, string> = {
  new: "New", contacted: "Contacted", site_visit: "Site visit",
  negotiation: "Negotiation", booked: "Booked", lost: "Lost",
};
export const CAMPAIGN_COLOR: Record<string, string> = {
  draft: "#8D8AA3", scheduled: "#2F7FE6", active: "#12B76A", paused: "#E08A00", completed: "#6A3FE0",
};
