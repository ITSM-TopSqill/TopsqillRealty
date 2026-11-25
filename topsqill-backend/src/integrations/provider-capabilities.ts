/**
 * Universal Connector Capability Registry (Part 22 of the Universal
 * Topsqill spec). This file is the static, code-level truth about what
 * Topsqill's own integration code actually supports for each provider -
 * objectives, placements, bidding, creative formats, read/write/webhook
 * support, restrictions. It never changes at runtime; only a developer
 * shipping new integration code changes it.
 *
 * Deliberately NOT a live discovery system that calls out to every
 * provider's API to ask what it supports - that's a much bigger, slower
 * thing to build honestly. This is the same "data, not an LLM guess"
 * discipline already used in src/campaigns/industries.ts: a maintained
 * table nothing silently assumes beyond.
 *
 * Runtime status (connected / awaiting credentials / errors / last sync)
 * is NOT here - see ProviderRegistryService, which layers real, derivable
 * signals (ad-account IDs configured, env tokens present, recent sync
 * history) on top of this static data.
 */

export type ProviderKind = "advertising" | "messaging" | "crm" | "analytics" | "ecommerce" | "payments";

/**
 * How sure Topsqill is that a provider actually works, from least to most
 * verified. Never skip straight to "connected" just because a form was
 * filled in - that's the exact anti-pattern Part 22 calls out.
 */
export type CapabilityStatus =
  | "unsupported"          // no integration code exists
  | "designed"             // integration code exists, nothing configured yet
  | "awaiting_credentials" // code exists, admin hasn't supplied real account IDs/tokens
  | "connected"            // credentials present, not yet proven to work end-to-end
  | "read_verified"
  | "write_verified"
  | "webhook_verified"
  | "production_verified"  // real campaigns have synced through it
  | "error";

export type ProviderCapability = {
  id: string;
  name: string;
  kind: ProviderKind;
  /** Campaign objectives Topsqill's own code can actually launch on this provider today. Empty if none. */
  objectives: string[];
  placements: string[];
  biddingMethods: string[];
  creativeFormats: string[];
  conversionTracking: boolean;
  reporting: boolean;
  writeSupport: boolean;
  readSupport: boolean;
  webhookSupport: boolean;
  restrictions: string;
  /** The status this provider sits at when nothing dynamic (env, DB config) raises or lowers it. */
  baseStatus: CapabilityStatus;
};

export const PROVIDER_CAPABILITIES: ProviderCapability[] = [
  {
    id: "meta", name: "Meta (Facebook/Instagram)", kind: "advertising",
    objectives: ["Lead generation"],
    placements: ["Feed", "Stories", "Reels (Advantage+ automatic placement)"],
    biddingMethods: ["Lowest cost"],
    creativeFormats: ["Single image", "Single video", "Carousel"],
    conversionTracking: true, reporting: true, writeSupport: true, readSupport: true, webhookSupport: true,
    restrictions: "Housing/Special Ad Category rules apply to real-estate campaigns. Literal postal/PIN-code targeting isn't supported for India - only locality/neighbourhood radius targeting.",
    baseStatus: "designed",
  },
  {
    id: "google", name: "Google Search", kind: "advertising",
    objectives: ["Lead generation"],
    placements: ["Search"],
    biddingMethods: ["Maximise conversions"],
    creativeFormats: ["Responsive search ad (headlines + descriptions)"],
    conversionTracking: true, reporting: true, writeSupport: true, readSupport: true, webhookSupport: false,
    restrictions: "No Display, Shopping, Performance Max or YouTube - only Search campaigns are implemented.",
    baseStatus: "designed",
  },
  { id: "whatsapp", name: "WhatsApp Business (messaging)", kind: "messaging",
    objectives: [], placements: [], biddingMethods: [], creativeFormats: ["Template message"],
    conversionTracking: false, reporting: false, writeSupport: true, readSupport: true, webhookSupport: true,
    restrictions: "Messaging only, not an ad placement. Requires the lead/contact to have opted in; template messages must be pre-approved by Meta.",
    baseStatus: "designed" },
  { id: "linkedin", name: "LinkedIn Ads", kind: "advertising", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
  { id: "tiktok", name: "TikTok Ads", kind: "advertising", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
  { id: "x", name: "X Ads", kind: "advertising", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
  { id: "pinterest", name: "Pinterest Ads", kind: "advertising", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
  { id: "snapchat", name: "Snapchat Ads", kind: "advertising", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
  { id: "microsoft_ads", name: "Microsoft Advertising", kind: "advertising", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
  { id: "ga4", name: "Google Analytics 4", kind: "analytics", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists - Topsqill tracks conversions through its own leads table and the Meta/Google conversion APIs only.", baseStatus: "unsupported" },
  { id: "hubspot", name: "HubSpot CRM", kind: "crm", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists - Topsqill's own CRM (the Leads module) is the only lead store.", baseStatus: "unsupported" },
  { id: "salesforce", name: "Salesforce", kind: "crm", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
  { id: "shopify", name: "Shopify", kind: "ecommerce", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
  { id: "razorpay", name: "Razorpay", kind: "payments", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: true, readSupport: true, webhookSupport: true,
    restrictions: "Used for the member wallet (topping up ad spend), not for tracking end-customer purchases.", baseStatus: "designed" },
  { id: "stripe", name: "Stripe", kind: "payments", objectives: [], placements: [], biddingMethods: [], creativeFormats: [],
    conversionTracking: false, reporting: false, writeSupport: false, readSupport: false, webhookSupport: false,
    restrictions: "No integration code exists.", baseStatus: "unsupported" },
];

export function providerById(id: string) {
  return PROVIDER_CAPABILITIES.find((p) => p.id === id) ?? null;
}
