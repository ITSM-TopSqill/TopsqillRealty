/**
 * Small pure helpers for reading what ad platforms and portals send.
 * Kept separate from the service so they can be tested without a database.
 */

/** "1.5 Cr", "80 lakh", "₹95,00,000" and 2500000 all become a number. */
export function parseBudget(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number") return raw;
  const s = String(raw).toLowerCase().replace(/,/g, "");
  const m = s.match(/(\d+(?:\.\d+)?)\s*(cr|crore|lakh|lac|l\b|k)?/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = m[2] ?? "";
  if (unit.startsWith("c")) return Math.round(n * 1e7);
  if (unit.startsWith("l")) return Math.round(n * 1e5);
  if (unit === "k") return Math.round(n * 1e3);
  return Math.round(n);
}
