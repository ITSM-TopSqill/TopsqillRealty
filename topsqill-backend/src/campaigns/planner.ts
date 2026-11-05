/**
 * Builds an ad campaign plan from the listing and real demand data.
 * Deterministic and explainable: the same inputs always give the same plan,
 * and every number can be justified to the dealer paying for the ads.
 */
export type Channel = { channel: string; budgetPct: number; format: string };
export type Plan = {
  personas: { name: string; share: number; why: string; signals: string[] }[];
  pincodes: { pin: string; area: string; tier: string; reason: string }[];
  radiusKm: number;
  intentKeywords: string[];
  negativeKeywords: string[];
  exclusions: string[];
  languages: string[];
  channels: Channel[];
  schedule: string;
  qualification: { questions: string[]; otp: boolean; bot: boolean; minScore: number };
  compliance: string[];
};

// Cost per lead by segment, from typical Indian real estate benchmarks.
const CPL: Record<string, Record<string, number>> = {
  luxury: { "Instagram and Facebook": 650, "Google Search": 900, YouTube: 720, LinkedIn: 1400, "WhatsApp click-to-chat": 520 },
  mid: { "Instagram and Facebook": 320, "Google Search": 520, YouTube: 400, LinkedIn: 950, "WhatsApp click-to-chat": 260 },
  affordable: { "Instagram and Facebook": 170, "Google Search": 300, YouTube: 230, LinkedIn: 700, "WhatsApp click-to-chat": 140 },
  rent: { "Instagram and Facebook": 95, "Google Search": 170, YouTube: 140, LinkedIn: 420, "WhatsApp click-to-chat": 80 },
};
const PERSONAS: Record<string, { name: string; signals: string[] }> = {
  hni: { name: "HNI families", signals: ["Household income ₹50 L+", "Luxury cars and travel", "Premium clubs and golf", "Business owners and CXOs"] },
  nri: { name: "NRI investors", signals: ["Indians in UAE, US, UK and Singapore", "Interest in Indian property", "NRI banking"] },
  it: { name: "IT and corporate professionals", signals: ["Works at MNCs and tech firms", "Age 28 to 42", "Home loan interest"] },
  upgraders: { name: "Upgrading families", signals: ["Currently in 2 BHK homes", "School and kids’ interests", "Searching bigger homes nearby"] },
  investors: { name: "Investors", signals: ["Rental yield searches", "Owns one or more properties", "Pre-launch interest"] },
  firstTime: { name: "First-time buyers", signals: ["Age 25 to 35", "Home loan eligibility searches", "Affordable housing interest"] },
  tenants: { name: "Relocating tenants", signals: ["Job change or transfer", "Rental searches near offices", "Furnished preference"] },
};

export function segmentOf(purpose: string, priceInr: number): keyof typeof CPL {
  if (purpose === "rent") return "rent";
  if (priceInr >= 2.5e7) return "luxury";
  if (priceInr >= 1e7) return "mid";
  return "affordable";
}

export function buildPlan(input: {
  purpose: string; priceInr: number; bhk?: number | null; kind: string; city: string; locality: string;
  possession?: string | null; amenities?: string[]; goal: string;
  demand: { buyersHere: number; topLocalities: { locality: string; buyers: number }[]; avgRate: number };
  pincodesFor: (locality: string) => string[];
}): Plan {
  const segment = segmentOf(input.purpose, input.priceInr);
  const keys = input.purpose === "rent" ? ["tenants", "it"]
    : segment === "luxury" ? ["hni", "nri", "upgraders"]
    : segment === "mid" ? ["it", "upgraders", "nri"]
    : ["firstTime", "it", "investors"];
  const shares = keys.length === 3 ? [50, 30, 20] : [65, 35];
  const personas = keys.map((k, i) => ({
    name: PERSONAS[k].name, share: shares[i], signals: PERSONAS[k].signals,
    why: k === "hni" ? `A price of ${inr(input.priceInr)} suits households earning ₹50 L or more`
      : k === "nri" ? `${input.city} is a strong NRI market, especially from the Gulf and the US`
      : k === "it" ? `A large tech workforce lives within a short commute of ${input.locality}`
      : k === "upgraders" ? "Families in nearby 2 BHK homes looking for more space"
      : k === "tenants" ? "Steady rental demand from people moving for work"
      : k === "firstTime" ? "The price fits a first home with a loan"
      : `${input.demand.buyersHere} buyers on Topsqill.ai are asking for this area`,
  }));

  const pincodes: Plan["pincodes"] = [];
  for (const pin of input.pincodesFor(input.locality)) {
    pincodes.push({ pin, area: input.locality, tier: "Core", reason: "The property’s own neighbourhood" });
  }
  for (const t of input.demand.topLocalities.slice(0, 3)) {
    for (const pin of input.pincodesFor(t.locality).slice(0, 1)) {
      if (!pincodes.some((p) => p.pin === pin)) {
        pincodes.push({ pin, area: t.locality, tier: "Demand", reason: `${t.buyers} active buyers on Topsqill.ai want this area` });
      }
    }
  }

  const channels: Channel[] = segment === "luxury"
    ? [{ channel: "Instagram and Facebook", budgetPct: 40, format: "Reels and carousel lead ads" },
       { channel: "Google Search", budgetPct: 30, format: "High-intent search ads" },
       { channel: "LinkedIn", budgetPct: 15, format: "Sponsored posts to senior professionals" },
       { channel: "YouTube", budgetPct: 15, format: "Walkthrough video ads" }]
    : input.purpose === "rent"
    ? [{ channel: "Instagram and Facebook", budgetPct: 50, format: "Story and reel lead ads" },
       { channel: "Google Search", budgetPct: 30, format: "Rental search ads" },
       { channel: "WhatsApp click-to-chat", budgetPct: 20, format: "Chat-first ads with instant replies" }]
    : [{ channel: "Instagram and Facebook", budgetPct: 45, format: "Reels and carousel lead ads" },
       { channel: "Google Search", budgetPct: 30, format: "High-intent search ads" },
       { channel: "YouTube", budgetPct: 10, format: "Walkthrough video ads" },
       { channel: "WhatsApp click-to-chat", budgetPct: 15, format: "Chat-first ads with instant replies" }];

  const bhk = input.bhk ? `${input.bhk} bhk ` : "";
  const loc = input.locality.toLowerCase();
  return {
    personas, pincodes: pincodes.slice(0, 9), radiusKm: segment === "luxury" ? 8 : 5,
    intentKeywords: [
      `${bhk}flat in ${loc}`,
      `${input.purpose === "rent" ? "rent" : "buy"} ${bhk}${input.kind.toLowerCase()} ${loc}`,
      `${loc} ${input.possession === "Ready to move" ? "ready to move" : "new"} flats`,
      `property in ${input.city.toLowerCase()}`,
      `${loc} price per sq ft`,
      segment === "luxury" ? `luxury apartments ${input.city.toLowerCase()}` : `${input.city.toLowerCase()} ${bhk}under ${Math.round(input.priceInr / 1e5)} lakh`,
    ],
    negativeKeywords: ["free", "pg", "hostel", "jobs", "salary", input.purpose === "rent" ? "buy" : "rent", "broker job"],
    exclusions: ["Real estate agents and brokers", "Job seekers in real estate", "People already in your CRM", "Age under 25"],
    languages: ["English", "Hindi", ...(["Mumbai", "Pune"].includes(input.city) ? ["Marathi"] : input.city === "Bengaluru" ? ["Kannada"] : input.city === "Hyderabad" ? ["Telugu"] : [])],
    channels,
    schedule: "Highest bids from 7 to 10 pm on weekdays and all day at weekends, when site-visit intent peaks",
    qualification: {
      questions: [
        `What is your budget? (around ${inr(input.priceInr)})`,
        "When are you planning to move? (now, 3 months, 6 months, later)",
        "Is this for living in or as an investment?",
        "Will you need a home loan?",
      ],
      otp: true, bot: true, minScore: 70,
    },
    compliance: [
      input.purpose === "sale" ? "RERA number and website shown on every creative" : "Rental advertisement, RERA not required",
      "No guaranteed-returns language",
      "Prices match the live listing",
      "Lead forms carry a privacy consent line (DPDP Act)",
    ],
  };
}

export function forecast(plan: Plan, budgetInr: number, segment: keyof typeof CPL) {
  let leads = 0, reach = 0;
  for (const c of plan.channels) {
    const spend = (budgetInr * c.budgetPct) / 100;
    leads += spend / (CPL[segment][c.channel] ?? 400);
    reach += (spend / 180) * 1000;
  }
  const q = plan.qualification;
  // Verification removes fake numbers, which costs some volume but raises quality.
  const friction = (q.otp ? 0.88 : 1) * (q.bot ? 0.95 : 1);
  leads = Math.round(leads * friction);
  const qualifiedRate = Math.min(0.9, 0.56 + (q.otp ? 0.07 : 0) + (q.questions.length >= 3 ? 0.05 : 0) + (q.bot ? 0.05 : 0) + (q.minScore >= 70 ? 0.06 : 0));
  const qualified = Math.round(leads * qualifiedRate);
  return {
    reach: Math.round(reach), clicks: Math.round(reach * 0.016), leads, qualified,
    qualifiedRatePct: Math.round(qualifiedRate * 100),
    costPerLead: leads ? Math.round(budgetInr / leads) : 0,
    costPerQualifiedLead: qualified ? Math.round(budgetInr / qualified) : 0,
  };
}

const inr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${Math.round(n / 1e5)} L`);
