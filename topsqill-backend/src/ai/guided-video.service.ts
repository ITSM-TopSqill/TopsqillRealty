import { Injectable, NotFoundException } from "@nestjs/common";
import { ClaudeService } from "./claude.service";
import { ListingsService } from "../listings/listings.service";
import { inr } from "./query";
import { scrubList, scrubSources } from "../common/sources";
import { speakAll } from "./voice";

/**
 * The narration for a listing's guided video: Topsqill's own video, made from
 * the listing's facts, photos and its 3D layout, instead of another site's.
 * Each line is spoken over one scene (intro, photos, each room of the 3D
 * tour, highlights, location, closing) and shown as a caption.
 *
 * Written by AI from the facts only, cached for a day per version of the
 * listing; without AI, written from the same facts by rules.
 */
export type VideoScript = {
  intro: string; photos: string[];
  rooms: { living: string; kitchen: string; master: string; bedroom: string; bath: string; balcony: string; study: string };
  highlights: string; location: string; outro: string;
  source: "claude" | "rules";
  /** Each line spoken by an Indian English voice: { line: mp3 link }. Lines without one use the browser's voice. */
  audio?: Record<string, string>;
};

type ListingRow = {
  id: string; title: string; purpose: string; kind: string; bhk?: number | null; areaSqft?: number | null; priceInr?: number | null;
  city: string; locality: string; possession?: string | null; furnishing?: string | null; facing?: string | null;
  description?: string | null; amenities?: string[]; usps?: string[]; reraNumber?: string | null;
  media?: { kind?: string; label?: string | null; scenes?: { branded?: boolean; items?: { line?: string }[] } | null }[];
};

const LINE = 220;

@Injectable()
export class GuidedVideoService {
  constructor(private readonly claude: ClaudeService, private readonly listings: ListingsService) {}

  async script(id: string): Promise<VideoScript> {
    const l = (await this.listings.getById(id).catch(() => null)) as unknown as ListingRow | null;
    if (!l) throw new NotFoundException("That listing is no longer available.");
    const base = rulesScript(l);
    const photoLabels = (l.media ?? []).filter((m) => m.kind === "image").map((m) => m.label ?? "").slice(0, 8);
    const facts = {
      title: l.title, purpose: l.purpose, kind: l.kind, bhk: l.bhk, areaSqft: l.areaSqft,
      price: l.priceInr ? inr(l.priceInr) + (l.purpose === "rent" ? " a month" : "") : null,
      city: l.city, locality: l.locality, possession: l.possession, furnishing: l.furnishing, facing: l.facing,
      amenities: (l.amenities ?? []).slice(0, 12), highlights: (l.usps ?? []).slice(0, 6),
      description: (l.description ?? "").slice(0, 1200), reraRegistered: !!l.reraNumber, photoLabels,
    };
    const prompt = `Write the voice-over for a 60 to 90 second guided video tour of this Indian property listing. A presenter speaks each line over one scene; it is also shown as a caption.

Rules:
- Use ONLY these facts. Never invent sizes, views, brands, distances, floors or prices. If a room isn't described in the facts, describe it in general, honest terms ("a separate kitchen with room for a dining table" is fine; "Italian marble" is not unless stated).
- Warm, confident Indian English, like an experienced Indian property presenter on a real estate show (natural, never salesy or cartoonish). Each line 1 or 2 short sentences, at most 200 characters. Prices in Indian style (₹1.2 Cr, ₹85 L).
- Never name or mention any website, portal, app or YouTube channel, and no links or phone numbers.
- "photos": one line per photo label given (same order, at most 8); if there are no labels, give 4 general lines about the home.
- The room lines are spoken as the 3D tour enters that room. Note the 3D layout is illustrative, so describe the room, not exact dimensions.

FACTS: ${JSON.stringify(facts)}

Reply with JSON only: {"intro": "...", "photos": ["..."], "rooms": {"living": "...", "kitchen": "...", "master": "...", "bedroom": "...", "bath": "...", "balcony": "...", "study": "..."}, "highlights": "...", "location": "...", "outro": "..."}`;

    const { data, source } = await this.claude.json<Partial<VideoScript>>(prompt, () => ({}), {
      feature: "listing.video", maxTokens: 1500, cacheSeconds: 86_400, effort: "low", timeoutMs: 30_000,
    });
    const script = merge(base, data, source);
    // The voice-over: every line of the script, and the lines AI wrote for the owner's own video.
    const clipLines = (l.media ?? []).filter((m) => m.kind === "video" && !m.scenes?.branded).flatMap((m) => m.scenes?.items ?? []).map((s) => s.line ?? "");
    script.audio = await speakAll([script.intro, ...script.photos, ...Object.values(script.rooms), script.highlights, script.location, script.outro, ...clipLines]);
    return script;
  }
}

const clean = (v: unknown) => (typeof v === "string" ? scrubSources(v.trim()).slice(0, LINE) : "");

function merge(base: VideoScript, ai: Partial<VideoScript>, source: "claude" | "rules"): VideoScript {
  if (source !== "claude" || !ai || typeof ai !== "object") return base;
  const rooms = { ...base.rooms };
  for (const k of Object.keys(rooms) as (keyof VideoScript["rooms"])[]) rooms[k] = clean(ai.rooms?.[k]) || rooms[k];
  const photos = Array.isArray(ai.photos) ? scrubList(ai.photos.map(clean).filter(Boolean)).slice(0, 8) : [];
  return {
    intro: clean(ai.intro) || base.intro, photos: photos.length ? photos : base.photos, rooms,
    highlights: clean(ai.highlights) || base.highlights, location: clean(ai.location) || base.location,
    outro: clean(ai.outro) || base.outro, source: "claude",
  };
}

/** The same script from the facts alone, for when AI is off. */
export function rulesScript(l: ListingRow): VideoScript {
  const rent = l.purpose === "rent";
  const home = `${l.bhk ? `${l.bhk} BHK ` : ""}${l.kind.toLowerCase()}`;
  const price = l.priceInr ? `${rent ? "for" : "at"} ${inr(l.priceInr)}${rent ? " a month" : ""}` : "";
  const area = l.areaSqft ? `${l.areaSqft.toLocaleString("en-IN")} square feet` : "";
  const amen = (l.amenities ?? []).slice(0, 4);
  const usps = (l.usps ?? []).slice(0, 3);
  const labels = (l.media ?? []).filter((m) => m.kind === "image").map((m) => m.label ?? "").slice(0, 8);
  const photoLine = (label: string, i: number) =>
    label ? `Here is the ${label.toLowerCase()}.` :
    [`Welcome to this ${home} in ${l.locality}.`, `Bright, practical spaces, ready for everyday living.`, l.furnishing ? `It comes ${l.furnishing.toLowerCase()}.` : `Make it yours with your own touch.`, l.facing ? `The home is ${l.facing.toLowerCase()}.` : `A layout that works for the whole family.`][i % 4];
  return {
    intro: scrubSources(`Welcome to this ${home} in ${l.locality}, ${l.city}${area ? `, with ${area}` : ""}${price ? `, ${price}` : ""}.`),
    photos: (labels.length ? labels : ["", "", "", ""]).map(photoLine).map(scrubSources),
    rooms: {
      living: "You step straight into the living and dining area, with space for a full sofa set and a dining table.",
      kitchen: "The kitchen sits right beside the dining area, with counters along two walls.",
      master: "The master bedroom has its own attached bathroom and room for a king-size bed and wardrobe.",
      bedroom: "Another well-sized bedroom, ideal for children, guests or a home office.",
      bath: "A neat bathroom, close to the bedrooms.",
      balcony: "The balcony opens off the living room, a nice spot for morning tea.",
      study: "And a separate study, for working from home in peace.",
    },
    highlights: scrubSources(usps.length ? `Highlights: ${usps.join(". ")}.` : amen.length ? `The society offers ${amen.join(", ")}.` : `${l.possession === "Ready to move" ? "It is ready to move in." : "Possession is on the way."}`),
    location: scrubSources(`It is in ${l.locality}, ${l.city}${l.possession ? `, and it is ${l.possession.toLowerCase()}` : ""}.`),
    outro: `Like what you see? Message the ${rent ? "owner" : "seller"} on Topsqill to book a visit.`,
    source: "rules",
  };
}
