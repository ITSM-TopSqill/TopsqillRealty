import { normalisePhone } from "../auth/phone";

export type LeadInput = {
  name?: string; phone?: string; email?: string;
  budgetMin?: number; budgetMax?: number;
  city?: string; locality?: string;
  timeline?: string; source?: string;
  otpVerified?: boolean; listingPrice?: number;
};

/**
 * Scores a lead 0 to 100 so dealers call the most promising people first.
 * Deliberately rule-based: fast, free, explainable, and the same every time.
 * AI enrichment can adjust it later, but this is what every lead starts with.
 */
export function scoreLead(input: LeadInput): { score: number; qualified: boolean; reason: string } {
  const reasons: string[] = [];
  let score = 30;

  const phone = normalisePhone(input.phone ?? "");
  if (phone) { score += 15; } else { score -= 20; reasons.push("no valid phone number"); }
  if (input.otpVerified) { score += 12; reasons.push("phone verified"); }
  if (input.email && /.+@.+\..+/.test(input.email) && !/tempmail|mailinator|guerrillamail|yopmail/i.test(input.email)) score += 5;
  if (input.name && input.name.trim().split(/\s+/).length >= 2) score += 4;

  // Budget against the listing price is the strongest signal of a real buyer.
  if (input.listingPrice && input.budgetMax) {
    const ratio = input.budgetMax / input.listingPrice;
    if (ratio >= 0.95) { score += 20; reasons.push("budget matches the listing"); }
    else if (ratio >= 0.8) { score += 10; reasons.push("budget slightly below the listing"); }
    else { score -= 15; reasons.push("budget well below the listing"); }
  } else if (input.budgetMax) { score += 6; }

  const t = (input.timeline ?? "").toLowerCase();
  if (/immediate|now|urgent|this month|15 days/.test(t)) { score += 15; reasons.push("ready to move now"); }
  else if (/1 month|3 month|2-3|two to three/.test(t)) { score += 10; reasons.push("moving within 3 months"); }
  else if (/6 month/.test(t)) score += 4;
  else if (/year|later|just looking|exploring/.test(t)) { score -= 8; reasons.push("only exploring"); }

  if (input.locality) score += 4;
  // Someone who typed a search query is further along than someone who tapped an ad.
  if (input.source === "google") score += 6;
  else if (input.source === "whatsapp" || input.source === "topsqill") score += 5;
  else if (input.source === "meta") score += 2;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const qualified = score >= 70 && !!phone;
  const reason = reasons.length ? reasons.join(", ") : "standard enquiry";
  return { score, qualified, reason: reason.slice(0, 200) };
}
