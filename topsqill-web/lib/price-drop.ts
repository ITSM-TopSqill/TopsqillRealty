/** A listing's price cut, shown as a badge for 30 days after the cut. */
export function priceDrop(l: { priceInr?: number | null; previousPriceInr?: number | null; priceDroppedAt?: string | null }) {
  if (!l.priceInr || !l.previousPriceInr || !l.priceDroppedAt || l.previousPriceInr <= l.priceInr) return null;
  if (Date.now() - new Date(l.priceDroppedAt).getTime() > 30 * 86_400_000) return null;
  const cut = l.previousPriceInr - l.priceInr;
  return { from: l.previousPriceInr, cut, pct: Math.round((cut / l.previousPriceInr) * 100) };
}
