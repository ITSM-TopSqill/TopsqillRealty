/**
 * Competitive Strategy Generator (Module 6): a fixed set of starting
 * templates (never invented by the model) - AI picks which genuinely fit
 * the real evidence given, not a quota to fill. Mirrors
 * campaigns/evolution.ts's VALID_FIELDS discipline: a strategy must name
 * one of these exact template ids.
 */

export const STRATEGY_TEMPLATES = [
  { id: "quality", label: "Differentiate on product quality" },
  { id: "price_value", label: "Differentiate on price and value" },
  { id: "convenience", label: "Differentiate on convenience" },
  { id: "experience", label: "Differentiate on customer experience" },
  { id: "trust_proof", label: "Differentiate on trust and proof" },
  { id: "different_need", label: "Target a different legitimate customer need" },
  { id: "education", label: "Educate customers on a category problem" },
  { id: "premium", label: "Build premium positioning" },
  { id: "bundles", label: "Compete through product bundles" },
  { id: "b2b", label: "Target business customers through industry-specific value" },
] as const;

export type StrategyTemplateId = (typeof STRATEGY_TEMPLATES)[number]["id"];
const TEMPLATE_IDS = new Set(STRATEGY_TEMPLATES.map((t) => t.id));

export type Confidence = "low" | "medium" | "high";

export type CompetitiveStrategyItem = {
  id: string;
  template: StrategyTemplateId;
  label: string;
  rationale: string;
  positioning: string;
  targetSegment: string;
  keyMessage: string;
  differentiation: string;
  risk: string;
  confidence: Confidence;
};

export function validateStrategies(items: CompetitiveStrategyItem[]) {
  for (const s of items) {
    if (!TEMPLATE_IDS.has(s.template)) throw new Error(`"${s.template}" isn't a real strategy template.`);
    if (!["low", "medium", "high"].includes(s.confidence)) throw new Error(`Invalid confidence "${s.confidence}".`);
    if (!s.rationale?.trim()) throw new Error("A strategy with no rationale isn't usable.");
  }
}
