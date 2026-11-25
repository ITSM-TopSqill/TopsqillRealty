/**
 * Universal Customer Differentiator Engine (Universal Topsqill spec, Part 4),
 * Workstream 2. Every differentiator here is a REAL field Topsqill's own
 * CRM (the leads table) already stores or can derive from stored timestamps -
 * nothing here assumes bank, cardholder, wealth, health or other sensitive
 * data Topsqill was never given and has no lawful basis to infer (Part 4.2,
 * Part 21's sensitive-audience restrictions).
 *
 * `directlyTargetable` is false for every entry: Topsqill doesn't yet push
 * custom audiences to Meta/Google (no Custom Audience API integration
 * exists - see the provider capability registry), so every differentiator
 * here is first-party-CRM/analytics-only until that's built. Never claim
 * otherwise (Part 5: "never pretend analytics-only signals can be used for
 * advertising targeting directly").
 */

export type Reliability = "high" | "medium" | "low";
export type PrivacyClass = "first_party_crm" | "first_party_declared";
export type ValueType = "enum" | "boolean" | "number" | "string";
export type Operator = "eq" | "neq" | "gte" | "lte" | "in" | "not_in" | "contains";

export type Differentiator = {
  id: string;
  name: string;
  category: string;
  description: string;
  applicableIndustries: string[]; // ["all"] when it applies everywhere
  signalType: "deterministic_crm" | "declared" | "derived_from_timestamps";
  source: string;
  dataAvailability: "always_present" | "present_when_declared";
  dataFreshness: string;
  reliability: Reliability;
  confidence: Reliability;
  privacyClassification: PrivacyClass;
  providerCompatibility: string[]; // always [] today - see module doc
  restrictions: string;
  directlyTargetable: boolean;
  analyticsOnly: boolean;
  firstPartyAudienceEligible: boolean;
  suggestedApplication: string;
  expectedBusinessValue: string;
  /** How to read this differentiator off a real lead row (LeadFacts, below). */
  field: string;
  valueType: ValueType;
  operators: Operator[];
  enumValues?: string[];
};

export const DIFFERENTIATORS: Differentiator[] = [
  {
    id: "lead_stage", name: "CRM stage", category: "Lifecycle", field: "stage", valueType: "enum",
    operators: ["eq", "neq", "in", "not_in"], enumValues: ["new", "contacted", "site_visit", "negotiation", "booked", "lost"],
    description: "Where the lead actually sits in the sales pipeline right now.",
    applicableIndustries: ["all"], signalType: "deterministic_crm", source: "Topsqill CRM (leads.stage)",
    dataAvailability: "always_present", dataFreshness: "real-time", reliability: "high", confidence: "high",
    privacyClassification: "first_party_crm", providerCompatibility: [],
    restrictions: "Analytics/CRM segmentation only - not pushed to any ad platform.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Follow-up prioritisation, or excluding booked/lost leads from any CRM segment.",
    expectedBusinessValue: "Avoids wasting sales effort on closed-out leads.",
  },
  {
    id: "lead_qualified", name: "Qualified lead", category: "Customer value", field: "qualified", valueType: "boolean",
    operators: ["eq"],
    description: "Topsqill's own rule-based score crossed the qualifying threshold (score >= 70 and a verified phone).",
    applicableIndustries: ["all"], signalType: "derived_from_timestamps", source: "src/leads/scoring.ts scoreLead()",
    dataAvailability: "always_present", dataFreshness: "set at lead creation/update", reliability: "high", confidence: "high",
    privacyClassification: "first_party_crm", providerCompatibility: [],
    restrictions: "Deterministic rule, not a trained model - see scoring.ts for the exact formula.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Building a segment of genuinely promising leads to prioritise or study.",
    expectedBusinessValue: "Separates real buyers from noise without guessing.",
  },
  {
    id: "lead_score", name: "Lead score (0-100)", category: "Customer value", field: "score", valueType: "number",
    operators: ["gte", "lte"],
    description: "The same 0-100 rule-based score shown on every lead card.",
    applicableIndustries: ["all"], signalType: "deterministic_crm", source: "src/leads/scoring.ts scoreLead()",
    dataAvailability: "always_present", dataFreshness: "set at lead creation/update", reliability: "high", confidence: "high",
    privacyClassification: "first_party_crm", providerCompatibility: [],
    restrictions: "Deterministic rule, not a predictive model.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Fine-grained segments beyond the binary qualified/not-qualified split.",
    expectedBusinessValue: "Lets a dealer target, say, the top quartile of leads specifically.",
  },
  {
    id: "lead_source", name: "Lead source", category: "Acquisition", field: "source", valueType: "enum",
    operators: ["eq", "neq", "in", "not_in"],
    enumValues: ["website", "meta", "google", "linkedin", "whatsapp", "portal_99acres", "portal_magicbricks", "portal_housing", "call", "topsqill", "manual", "other", "channel_partner"],
    description: "Which channel actually brought this lead in.",
    applicableIndustries: ["all"], signalType: "deterministic_crm", source: "Topsqill CRM (leads.source)",
    dataAvailability: "always_present", dataFreshness: "real-time", reliability: "high", confidence: "high",
    privacyClassification: "first_party_crm", providerCompatibility: [],
    restrictions: "Analytics/CRM segmentation only.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Comparing lead quality by acquisition channel.",
    expectedBusinessValue: "Identifies which channel brings the best (not just the most) leads.",
  },
  {
    id: "campaign_sourced", name: "Came from a paid ad campaign", category: "Acquisition", field: "campaignSourced", valueType: "boolean",
    operators: ["eq"],
    description: "Whether this lead is linked to one of this owner's Topsqill ad campaigns (vs. organic/other).",
    applicableIndustries: ["all"], signalType: "deterministic_crm", source: "Topsqill CRM (leads.campaign_id)",
    dataAvailability: "always_present", dataFreshness: "real-time", reliability: "high", confidence: "high",
    privacyClassification: "first_party_crm", providerCompatibility: [],
    restrictions: "Analytics/CRM segmentation only.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Isolating ad-driven leads for the marketing-assistant's lead follow-up tool.",
    expectedBusinessValue: "Separates marketing-attributable leads from the rest of the pipeline.",
  },
  {
    id: "budget_max", name: "Stated maximum budget (INR)", category: "Purchase economics", field: "budgetMax", valueType: "number",
    operators: ["gte", "lte"],
    description: "The highest budget the lead declared when enquiring.",
    applicableIndustries: ["real_estate"], signalType: "declared", source: "Topsqill CRM (leads.budget_max, self-declared)",
    dataAvailability: "present_when_declared", dataFreshness: "set at lead creation", reliability: "medium", confidence: "medium",
    privacyClassification: "first_party_declared", providerCompatibility: [],
    restrictions: "Self-declared, not verified against any financial source. Never treat as proof of actual financial capacity.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "A legitimate first-party alternative to any request for 'premium'/'high-net-worth' targeting: use declared budget range on real enquiries instead of inferring wealth.",
    expectedBusinessValue: "Lets a dealer focus on leads whose stated budget fits a premium listing, without assuming anything about the person's actual finances.",
  },
  {
    id: "locality", name: "Locality of interest", category: "Geography", field: "locality", valueType: "string",
    operators: ["eq", "contains"],
    description: "The locality the lead actually asked about.",
    applicableIndustries: ["real_estate"], signalType: "declared", source: "Topsqill CRM (leads.locality)",
    dataAvailability: "present_when_declared", dataFreshness: "set at lead creation", reliability: "medium", confidence: "medium",
    privacyClassification: "first_party_declared", providerCompatibility: [],
    restrictions: "Analytics/CRM segmentation only.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Segmenting leads by the area they're actually shopping in.",
    expectedBusinessValue: "Matches follow-up and creative to what the lead actually asked for.",
  },
  {
    id: "city", name: "City", category: "Geography", field: "city", valueType: "string", operators: ["eq", "contains"],
    description: "The city the lead is interested in.",
    applicableIndustries: ["all"], signalType: "declared", source: "Topsqill CRM (leads.city)",
    dataAvailability: "present_when_declared", dataFreshness: "set at lead creation", reliability: "medium", confidence: "medium",
    privacyClassification: "first_party_declared", providerCompatibility: [],
    restrictions: "Analytics/CRM segmentation only.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Geographic segmentation for multi-city dealers.",
    expectedBusinessValue: "Lets multi-market dealers build city-specific follow-up lists.",
  },
  {
    id: "days_since_activity", name: "Days since last activity", category: "Engagement recency", field: "daysSinceActivity", valueType: "number",
    operators: ["gte", "lte"],
    description: "How long it's been since anyone touched this lead - the strongest real recency signal Topsqill has.",
    applicableIndustries: ["all"], signalType: "derived_from_timestamps", source: "Topsqill CRM (leads.last_activity_at)",
    dataAvailability: "always_present", dataFreshness: "real-time", reliability: "high", confidence: "high",
    privacyClassification: "first_party_crm", providerCompatibility: [],
    restrictions: "A lead with no activity yet is treated as its days-since-creation, not excluded.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Finding stale leads worth reactivating, or fresh ones worth calling today.",
    expectedBusinessValue: "Surfaces real churn/reactivation risk instead of guessing.",
  },
  {
    id: "days_since_created", name: "Lead age (days)", category: "Lifecycle", field: "daysSinceCreated", valueType: "number",
    operators: ["gte", "lte"],
    description: "How many days since this lead first came in.",
    applicableIndustries: ["all"], signalType: "derived_from_timestamps", source: "Topsqill CRM (leads.created_at)",
    dataAvailability: "always_present", dataFreshness: "real-time", reliability: "high", confidence: "high",
    privacyClassification: "first_party_crm", providerCompatibility: [],
    restrictions: "Analytics/CRM segmentation only.",
    directlyTargetable: false, analyticsOnly: true, firstPartyAudienceEligible: true,
    suggestedApplication: "Distinguishing brand-new enquiries from long-running ones for different follow-up cadences.",
    expectedBusinessValue: "Prevents treating a 60-day-old lead the same as one from this morning.",
  },
];

export function differentiatorById(id: string) {
  return DIFFERENTIATORS.find((d) => d.id === id) ?? null;
}

/* ------------------------------ facts + evaluator ------------------------------ */

/** What a segment's conditions are actually evaluated against - derived once per lead row. */
export type LeadFacts = {
  id: string; name: string; stage: string; qualified: boolean; score: number; source: string;
  campaignSourced: boolean; budgetMax: number | null; locality: string | null; city: string | null;
  daysSinceActivity: number; daysSinceCreated: number;
};

export type Condition = { kind: "condition"; differentiatorId: string; operator: Operator; value: unknown; negate?: boolean };
export type ConditionGroup = { kind: "group"; match: "all" | "any"; conditions: (Condition | ConditionGroup)[]; negate?: boolean };
export type SegmentDefinition = { include: ConditionGroup; exclude?: ConditionGroup };

export class InvalidConditionError extends Error {}

/** Checks a condition references a real differentiator, a real operator for its type, and a sane value - never trusts client input straight into a filter. */
export function validateCondition(c: Condition): Differentiator {
  const d = differentiatorById(c.differentiatorId);
  if (!d) throw new InvalidConditionError(`Unknown differentiator "${c.differentiatorId}".`);
  if (!d.operators.includes(c.operator)) throw new InvalidConditionError(`"${d.name}" doesn't support the "${c.operator}" operator.`);
  if (d.valueType === "enum" && d.enumValues && (c.operator === "eq" || c.operator === "neq")) {
    if (typeof c.value !== "string" || !d.enumValues.includes(c.value)) throw new InvalidConditionError(`"${c.value}" isn't a valid value for "${d.name}".`);
  }
  return d;
}

function evalOne(lead: LeadFacts, c: Condition): boolean {
  const d = validateCondition(c);
  const actual = (lead as unknown as Record<string, unknown>)[d.field];
  let result: boolean;
  switch (c.operator) {
    case "eq": result = actual === c.value; break;
    case "neq": result = actual !== c.value; break;
    case "gte": result = typeof actual === "number" && typeof c.value === "number" && actual >= c.value; break;
    case "lte": result = typeof actual === "number" && typeof c.value === "number" && actual <= c.value; break;
    case "in": result = Array.isArray(c.value) && c.value.includes(actual); break;
    case "not_in": result = Array.isArray(c.value) && !c.value.includes(actual); break;
    case "contains": result = typeof actual === "string" && typeof c.value === "string" && actual.toLowerCase().includes(c.value.toLowerCase()); break;
    default: result = false;
  }
  return c.negate ? !result : result;
}

function evalGroup(lead: LeadFacts, g: ConditionGroup): boolean {
  const results = g.conditions.map((c) => (c.kind === "group" ? evalGroup(lead, c) : evalOne(lead, c)));
  const base = g.match === "all" ? results.every(Boolean) : results.some(Boolean);
  return g.negate ? !base : base;
}

/** Validates every condition in a definition up front, so a bad request fails before touching any lead. */
export function validateSegmentDefinition(def: SegmentDefinition) {
  const walk = (g: ConditionGroup) => { for (const c of g.conditions) c.kind === "group" ? walk(c) : validateCondition(c); };
  walk(def.include);
  if (def.exclude) walk(def.exclude);
}

export function matchesSegment(lead: LeadFacts, def: SegmentDefinition): boolean {
  if (!evalGroup(lead, def.include)) return false;
  if (def.exclude && evalGroup(lead, def.exclude)) return false;
  return true;
}

export function filterLeads(leads: LeadFacts[], def: SegmentDefinition): LeadFacts[] {
  return leads.filter((l) => matchesSegment(l, def));
}
