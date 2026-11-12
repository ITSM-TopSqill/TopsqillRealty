/**
 * A simple Vastu indicator from the direction a home faces (the side its
 * main entrance opens to), as most Indian buyers read it. It is only a
 * guide: a full Vastu check needs the actual floor plan.
 */
export type Vastu = { score: number; direction: string; verdict: string; notes: string[] };

const DIRS: [RegExp, string, number, string][] = [
  [/north[\s-]*east|\bn\.?\s*e\b/i, "North-east", 95, "Considered the most auspicious entrance: morning light and positive energy."],
  [/south[\s-]*east|\bs\.?\s*e\b/i, "South-east", 62, "Fire corner: fine for many, and best with the kitchen in the south-east."],
  [/north[\s-]*west|\bn\.?\s*w\b/i, "North-west", 72, "Air corner: good for movement and business; keep the entrance well lit."],
  [/south[\s-]*west|\bs\.?\s*w\b/i, "South-west", 45, "Usually advised against for the main entrance; simple remedies are common."],
  [/\beast\b/i, "East", 90, "Sunrise-facing: very popular for health and prosperity."],
  [/\bnorth\b/i, "North", 88, "Linked with wealth and opportunity; a favourite for families."],
  [/\bwest\b/i, "West", 68, "Good for many professions; evenings get the sun."],
  [/\bsouth\b/i, "South", 55, "Often avoided, though many south-facing homes are well designed."],
];

export function vastuFrom(facing?: string | null): Vastu | null {
  if (!facing) return null;
  const hit = DIRS.find(([re]) => re.test(facing));
  if (!hit) return null;
  const [, direction, score, why] = hit;
  const verdict = score >= 85 ? "Excellent" : score >= 70 ? "Good" : score >= 55 ? "Fair" : "Needs remedies";
  return {
    score, direction, verdict,
    notes: [why, "Ask the seller for the floor plan to check the kitchen (south-east), master bedroom (south-west) and pooja room (north-east)."],
  };
}
