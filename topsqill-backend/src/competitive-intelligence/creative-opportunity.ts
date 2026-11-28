/**
 * Creative Opportunity Generator (Module 7): types and validation for a
 * generated batch of original campaign concepts, grounded in one APPROVED
 * market-gap opportunity or competitive-strategy item - never a bare
 * prompt with no real evidence behind it, and never a reproduction of a
 * competitor's actual ad text (the spec's explicit ban).
 */

export const CONCEPT_FORMATS = [
  "Awareness", "Education", "Consideration", "Conversion", "Retargeting", "Product demonstration",
  "Social proof", "Premium positioning", "Price promotion", "Seasonal promotion", "Brand storytelling",
  "Competitive differentiation",
] as const;

export type Confidence = "low" | "medium" | "high";

export type CreativeConcept = {
  id: string;
  angle: string;
  headlines: string[];
  primaryTexts: string[];
  ctaVariations: string[];
  visualConcept: string;
  videoConcept: string;
  carouselConcept: string;
  format: string;
  confidence: Confidence;
};

export function validateConcepts(items: CreativeConcept[]) {
  for (const c of items) {
    if (!(CONCEPT_FORMATS as readonly string[]).includes(c.format)) throw new Error(`"${c.format}" isn't a real concept format.`);
    if (!["low", "medium", "high"].includes(c.confidence)) throw new Error(`Invalid confidence "${c.confidence}".`);
    if (!c.headlines?.length) throw new Error("A concept with no headlines isn't usable.");
  }
}
