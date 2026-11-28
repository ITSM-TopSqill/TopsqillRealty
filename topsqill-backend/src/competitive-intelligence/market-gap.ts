/**
 * Competitive Market Gap Engine (Module 5): types and validation for a
 * generated batch of opportunities. The actual generation (an AI call
 * grounded in real business/competitor data) lives in
 * MarketGapAnalysisService - this file is pure, testable shape/validation
 * logic, mirroring campaigns/evolution.ts's split.
 */

export type Confidence = "low" | "medium" | "high";

export type MarketGapOpportunity = {
  id: string;
  observation: string;
  evidence: string;
  opportunity: string;
  businessRelevance: string;
  suggestedCampaign: string;
  suggestedCreative: string;
  suggestedAudience: string;
  confidence: Confidence;
  risk: string;
  validationExperiment: string;
};

/** Every opportunity must have a real confidence level and non-empty evidence - never a bare, unsupported claim. */
export function validateOpportunities(items: MarketGapOpportunity[]) {
  for (const o of items) {
    if (!["low", "medium", "high"].includes(o.confidence)) throw new Error(`Invalid confidence "${o.confidence}".`);
    if (!o.evidence?.trim()) throw new Error("An opportunity with no evidence isn't usable - evidence is required.");
  }
}
