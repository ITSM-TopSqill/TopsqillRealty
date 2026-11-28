/**
 * Competitive Audience Strategy (Module 9): types and validation for a
 * generated batch of audience segment hypotheses - grounded in the
 * business profile, any saved first-party CRM segments, and optionally
 * tracked competitors as context. Never claims a competitor's customer
 * list or private audience data is available (the spec's explicit ban),
 * and never a fabricated numeric audience size - `audienceEstimate` is a
 * sentence, not a number, unless it's genuinely citing an existing saved
 * segment.
 */

export type Confidence = "low" | "medium" | "high";

export type AudienceSegmentHypothesis = {
  id: string;
  name: string;
  whyValuable: string;
  availableSignals: string;
  dataSource: string;
  providerCompatibility: string;
  audienceEstimate: string;
  confidence: Confidence;
  restrictions: string;
  creativeRecommendation: string;
  testPlan: string;
};

export function validateSegments(items: AudienceSegmentHypothesis[]) {
  for (const s of items) {
    if (!["low", "medium", "high"].includes(s.confidence)) throw new Error(`Invalid confidence "${s.confidence}".`);
    if (!s.whyValuable?.trim()) throw new Error("A segment with no stated value isn't usable.");
    if (!s.dataSource?.trim()) throw new Error("A segment must cite a real data source - never a bare guess.");
  }
}
