/**
 * AI settings an admin changes on Admin → AI, without a deploy:
 *  - enabled: AI on or off for the whole platform (off = built-in rules everywhere)
 *  - disabled: features switched off one by one (e.g. "listing.import")
 *  - model: which Claude model to use (empty = the CLAUDE_MODEL setting)
 * Stored in app_settings under "ai"; read at most every 30 seconds.
 */
export type AiSettings = { enabled: boolean; disabled: string[]; model: string | null };

export const DEFAULT_AI_SETTINGS: AiSettings = { enabled: true, disabled: [], model: null };

/** Models an admin may pick. */
export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"] as const;

/** Features that call AI, with the names admins see. */
export const AI_FEATURES: Record<string, string> = {
  "assistant": "Ask Topsqill.ai assistant",
  "listing.ask": "Ask about this listing",
  "listing.import": "Import from a link",
  "write.listing": "Listing descriptions",
  "project.extract": "Project import",
  "project.insights": "Project report",
  "campaign.creatives": "Ad creatives",
  "campaign.podcast": "Campaign podcast script",
  "write.post": "Post writing",
  "write.comment": "Comment suggestions",
  "write.followup": "Lead follow-ups",
  "write.profile": "Profile writing",
  "jobs.draft": "Job writing",
  "photo.tag": "Photo labels (Kitchen, Bedroom…)",
  "admin.brief": "Admin daily brief",
};

export function cleanAiSettings(v: unknown): AiSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const disabled = Array.isArray(o.disabled) ? [...new Set(o.disabled.map(String).filter((f) => f in AI_FEATURES))] : [];
  const model = typeof o.model === "string" && (AI_MODELS as readonly string[]).includes(o.model) ? o.model : null;
  return { enabled: o.enabled !== false, disabled, model };
}

/** Is this feature allowed to use AI? A feature like "write.post" is also covered by turning off "write.post". */
export function aiAllowed(s: AiSettings, feature: string) {
  return s.enabled && !s.disabled.includes(feature);
}
