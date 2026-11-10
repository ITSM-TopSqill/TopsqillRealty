import { Injectable, Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ClaudeService } from "./claude.service";
import { DB_READ, type Database } from "../db/db.module";
import { users } from "../db/schema";

type Profile = { name: string; type: string; city?: string | null; localities?: string[]; agency?: string | null; years?: number | null; notes?: string };

/**
 * The writing features members see: profile text, listing descriptions,
 * posts, comments and follow-up messages. Every one has a sensible fallback,
 * so the feature still works when the AI is unavailable.
 */
@Injectable()
export class WriterService {
  constructor(private readonly claude: ClaudeService, @Inject(DB_READ) private readonly read: Database) {}

  /** Who a message is from: the member's real name and agency, never a placeholder. */
  async senderOf(userId: string) {
    const [me] = await this.read.select({ name: users.name, agency: users.agency, phone: users.phone })
      .from(users).where(eq(users.id, userId)).limit(1);
    return { name: me?.name ?? "Your Topsqill.ai advisor", agency: me?.agency ?? null, phone: me?.phone ?? null };
  }

  async profile(userId: string, p: Profile) {
    const locs = p.localities?.length ? p.localities : [p.city ?? "your city"];
    const fallback = () => ({
      headline: p.type === "dealer" ? `Helping families find homes in ${locs.join(" and ")}`
        : p.type === "builder" ? `Building homes across ${p.city ?? "India"}`
        : p.type === "seller" ? `Owner selling property in ${locs[0]}`
        : `Looking for a home in ${locs.join(" or ")}`,
      about: p.type === "dealer"
        ? `I have spent ${p.years ?? 5} years helping buyers and tenants across ${locs.join(", ")}. Every listing I share is verified in person and priced with real registration data. Open to co-broking with verified dealers on Topsqill.ai.`
        : p.type === "builder"
        ? `${p.name} develops residential projects in ${p.city ?? "India"} with a focus on on-time possession, transparent pricing and RERA compliance. Channel partners are welcome.`
        : `I am looking for a home in ${locs.join(" or ")}. Verified listings only, please.`,
      specialties: p.type === "dealer" ? ["Resale", "Rentals", "New launches", "Co-broking"] : ["Verified listings", "Clear title", "Quick response"],
    });
    const prompt = `Write a professional profile for an Indian real estate network. Return ONLY JSON {"headline": max 90 chars no emojis, "about": 60-110 words first person, "specialties": [4 short strings]}.
Member: ${JSON.stringify({ ...p, localities: locs })}`;
    const { data, source } = await this.claude.json(prompt, fallback, { userId, feature: "write.profile", maxTokens: 700 });
    return { ...data, source };
  }

  async listingCopy(userId: string, listing: Record<string, unknown>, localityRate?: number) {
    const fallback = () => ({
      title: `${listing.bhk ?? ""} BHK ${String(listing.kind ?? "home").toLowerCase()} in ${listing.locality}`.trim(),
      description: `A ${String(listing.furnishing ?? "well-kept").toLowerCase()} ${listing.bhk ?? ""} BHK in ${listing.locality}, ${listing.city}, spread across ${Number(listing.areaSqft ?? 0).toLocaleString("en-IN")} sq ft. ${listing.possession ?? ""}. Clear title and loan approved by major banks.`.replace(/\s+/g, " "),
      usps: [listing.facing, listing.possession, listing.furnishing].filter(Boolean).map(String).slice(0, 5),
      priceTip: localityRate && listing.priceInr && listing.areaSqft
        ? `Estimate: this works out to ₹${Math.round(Number(listing.priceInr) / Number(listing.areaSqft)).toLocaleString("en-IN")} per sq ft, against a locality average of ₹${localityRate.toLocaleString("en-IN")}.`
        : "",
    });
    const prompt = `Write an Indian property listing. Return ONLY JSON {"title": max 60 chars, "description": 70-110 words warm and specific, "usps": [5 short points], "priceTip": one sentence comparing the asking price with the locality average, call it an estimate}.
Use only these facts, never promise returns. Locality average: ₹${localityRate ?? "unknown"} per sq ft.
Listing: ${JSON.stringify(listing)}`;
    const { data, source } = await this.claude.json(prompt, fallback, { userId, feature: "write.listing", maxTokens: 900 });
    return { ...data, source };
  }

  async post(userId: string, topic: string, tone: "write" | "punchy" | "short" | "hinglish" | "tags" | "fix", current?: string, context?: Record<string, unknown>) {
    const base = current ?? topic;
    const fallback = () => {
      if (tone === "hinglish") return { text: `${base}\n\nAgar aap ghar dhoondh rahe ho, mujhe DM karo. Sab listings verified hain 🙏 #TopsqillAI` };
      if (tone === "tags") return { text: `${base}\n\n#RealEstate #TopsqillAI #PropertyDeals #HomeBuying` };
      if (tone === "fix") return { text: base.replace(/\s+/g, " ").replace(/\s([,.!?])/g, "$1").replace(/(^|[.!?]\s+)([a-z])/g, (_m, p, c) => p + c.toUpperCase()).trim() };
      if (tone === "punchy") return { text: `🔥 ${base.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ")}\n\nDM me today 👇` };
      if (tone === "short") return { text: base.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ") };
      return { text: `📣 ${topic}\n\nIf you are buying, selling or renting, let’s talk. Drop a comment and I will call you back today. #TopsqillAI` };
    };
    // Each style has its own length rule: fixing grammar must not rewrite the post.
    const instruction = tone === "write" ? `Write a LinkedIn-style post about: "${topic}". 60-110 words, confident and specific, 1-3 emojis, ending with a clear call to action.`
      : tone === "punchy" ? "Rewrite the current post punchier: a strong first line, active verbs, 1-3 emojis, a clear call to action. At most 80 words."
      : tone === "short" ? "Rewrite the current post in about half the words, keeping every key fact (price, place, size) and the call to action."
      : tone === "hinglish" ? "Rewrite the current post in natural Hinglish (Hindi in Roman script mixed with English), friendly tone, same facts, similar length."
      : tone === "tags" ? "Return the current post unchanged, followed by a blank line and 4 to 6 relevant hashtags (place, property type, #RealEstate)."
      : "Fix spelling, grammar and punctuation only. Keep the wording, tone, length and emojis.";
    const prompt = `${instruction}
Return ONLY JSON {"text": the post}. Never promise returns or guaranteed appreciation.
${context ? `Context: ${JSON.stringify(context)}\n` : ""}${current ? `Current post: """${current}"""` : ""}`;
    const { data, source } = await this.claude.json(prompt, fallback, { userId, feature: "write.post", maxTokens: 700 });
    return { text: String((data as { text?: string }).text ?? fallback().text), source };
  }

  async leadFollowUp(userId: string, channel: "whatsapp" | "email" | "call", lead: Record<string, unknown>, sender: Record<string, unknown>) {
    const first = String(lead.name ?? "there").split(" ")[0];
    const fallback = () => ({
      text: channel === "whatsapp"
        ? `Hi ${first}! 👋 Thanks for your interest in ${lead.listingTitle ?? "the property"}. I have sent the brochure and floor plan. Would Saturday or Sunday suit you for a site visit? – ${sender.name}`
        : channel === "email"
        ? `Subject: Your site visit\n\nHi ${first},\n\nThank you for enquiring about ${lead.listingTitle ?? "the property"}. I have attached the floor plan and price sheet. I can arrange a site visit this weekend.\n\nWould Saturday at 11 am work?\n\nBest,\n${sender.name}`
        : `Opening: "Hi ${first}, this is ${String(sender.name).split(" ")[0]} from ${sender.agency ?? "Topsqill.ai"}. You enquired about ${lead.listingTitle ?? "a property"}. Is this a good time?"\n\n1. Are you buying for yourself or as an investment?\n2. Is your budget around ${lead.budgetMax ?? "the listed price"}, and will you need a home loan?\n3. When are you hoping to move?\n\nClose: "Shall we fix a site visit this weekend?"`,
    });
    const prompt = `Write a ${channel === "whatsapp" ? "short WhatsApp message (max 60 words, 1 emoji)" : channel === "email" ? "short email with a subject line (max 120 words)" : "30-second phone call script with 3 qualifying questions"} to a property lead.
Return ONLY JSON {"text": the message}. Friendly, specific, with a clear next step.
Lead: ${JSON.stringify(lead)}. Sender: ${JSON.stringify(sender)}`;
    const { data, source } = await this.claude.json(prompt, fallback, { userId, feature: "write.followup", maxTokens: 700 });
    return { text: String((data as { text?: string }).text ?? fallback().text), source };
  }

  async comment(userId: string, postBody: string, me: Record<string, unknown>) {
    const fallback = () => ({ text: "Thanks for sharing this, really useful for anyone following this market." });
    const prompt = `Write one short, genuine comment (max 25 words, no hashtags) on this real estate post, as ${JSON.stringify(me)}.
Return ONLY JSON {"text": the comment}.
Post: """${postBody.slice(0, 1200)}"""`;
    const { data, source } = await this.claude.json(prompt, fallback, { userId, feature: "write.comment", maxTokens: 300 });
    return { text: String((data as { text?: string }).text ?? fallback().text), source };
  }
}
