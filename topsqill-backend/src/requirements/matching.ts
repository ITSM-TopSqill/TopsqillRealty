import { listings, requirements } from "../db/schema";

type L = Pick<typeof listings.$inferSelect, "city" | "locality" | "purpose" | "kind" | "bhk" | "priceInr" | "areaSqft" | "possession">;
type R = Pick<typeof requirements.$inferSelect, "city" | "localities" | "purpose" | "kind" | "bhk" | "minPrice" | "maxPrice" | "minArea" | "timeline">;

/**
 * Scores how well a listing fits a buyer's requirement, 0 to 100.
 * A pure function with no database access: cheap to run over many rows, and easy to test.
 * Anything at 55 or above is shown to the member as a match.
 */
export function matchScore(listing: L, req: R): number {
  if (listing.purpose !== req.purpose) return 0;
  if (listing.city.toLowerCase() !== req.city.toLowerCase()) return 0;

  let score = 35;                                              // right city, right purpose
  const locs = (req.localities ?? []).map((l) => l.toLowerCase());
  score += locs.includes(listing.locality.toLowerCase()) ? 30 : 8;

  if (req.bhk && listing.bhk) {
    if (listing.bhk === req.bhk) score += 15;
    else if (Math.abs(listing.bhk - req.bhk) === 1) score += 6;
    else score -= 5;
  }
  if (req.kind && listing.kind === req.kind) score += 5;

  if (listing.priceInr && req.maxPrice) {
    // Budget is the hard filter buyers care about most. Anything more than 25%
    // over the stated maximum is not a match at all, however well it fits otherwise.
    if (listing.priceInr > req.maxPrice * 1.25) return 0;
    const min = req.minPrice ?? 0;
    if (listing.priceInr <= req.maxPrice && listing.priceInr >= min * 0.8) score += 15;
    else if (listing.priceInr <= req.maxPrice * 1.1) score += 4;  // a small stretch is still worth showing
    else score -= 20;                                             // 10-25% over: shown last, if at all
  }
  if (req.minArea && listing.areaSqft && listing.areaSqft >= req.minArea) score += 3;
  if (/immediately|1 month/i.test(req.timeline ?? "") && listing.possession === "Ready to move") score += 4;

  return Math.max(0, Math.min(99, score));
}

export const MATCH_THRESHOLD = 55;
