import { Injectable, Inject, BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type Anthropic from "@anthropic-ai/sdk";
import { eq, and, desc } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { listings, listingMedia, media } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { ClaudeService, textOf } from "./claude.service";

const ROOM_KINDS = ["living", "kitchen", "bedroom", "bath", "balcony", "study"] as const;
type Room = { id: string; kind: typeof ROOM_KINDS[number]; name: string; x: number; y: number; w: number; d: number };
type Door = { x: number; y: number; axis: "h" | "v"; width: number; main?: boolean };
export type FloorPlanExtraction = { rooms: Room[]; doors: Door[]; width: number; depth: number; carpetSqft: number; bhk: number };

const SYSTEM = `You read Indian residential floor plan images and turn them into an exact JSON layout.

Coordinate system (feet): x runs across the plan's width (0 = left edge); y runs from the front/entrance
(y = 0) to the back of the home. Every room is a rectangle: {x, y} is its top-left (front-left) corner,
{w, d} its width and depth. A balcony's y may be negative (it sits in front of the living room).

Read every printed room label and dimension (e.g. "Bedroom 17' x 13'", "Kitchen 10'6" x 8'") and use those
exact sizes. Infer each room's position from its placement in the drawing relative to the others and to the
entrance, keeping the rooms non-overlapping and touching the rooms next to them in the real plan.

Doors: for every doorway and the main entrance, output {x, y, axis, width, main?}. "axis" is "h" if the
doorway cuts a horizontal wall (one running left-right, the door opening along x), or "v" for a wall running
front-back (the door opening along y). Mark exactly one door main: true for the flat's own front door.

Return ONLY JSON: {"rooms":[{"id","kind","name","x","y","w","d"}],"doors":[{"x","y","axis","width","main"}],
"width","depth","carpetSqft","bhk"}. "kind" must be exactly one of: living, kitchen, bedroom, bath, balcony, study.
"width"/"depth" are the whole plan's outer size in feet. "carpetSqft" is the sum of all room areas. "bhk" is
the count of bedroom rooms. If no readable floor plan is present, return {"rooms":[]}.`;

const BROCHURE_NOTE = "\n\nThis comes from a project brochure, which may be several pages of text, renders and " +
  "amenity photos with the floor plan on just one of them. Find that page and read only it; ignore the rest.";

/**
 * Builds the real 2D/3D/hologram layout from a floor plan the owner
 * uploaded: a dedicated floor plan photo if there is one, otherwise a floor
 * plan page inside an uploaded brochure PDF. No AI key, nothing uploaded, or
 * nothing readable in either: the listing's layout stays unset (null)
 * rather than showing a guess.
 */
@Injectable()
export class FloorplanService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
    private readonly cache: CacheService,
  ) {}

  async extract(userId: string, listingId: string): Promise<FloorPlanExtraction> {
    const [l] = await this.read.select({ ownerId: listings.ownerId }).from(listings).where(eq(listings.id, listingId)).limit(1);
    if (!l) throw new NotFoundException("That listing could not be found.");
    if (l.ownerId !== userId) throw new ForbiddenException("Only the owner can build this listing's layout.");
    if (!this.claude.available) throw new BadRequestException("AI isn't configured, so a real layout can't be built right now.");

    // A dedicated floor plan photo always wins, so it's never shadowed by a brochure's own plan page.
    const [plan] = await this.read.select({ variants: media.variants })
      .from(listingMedia).innerJoin(media, eq(media.id, listingMedia.mediaId))
      .where(and(eq(listingMedia.listingId, listingId), eq(media.label, "Floor plan"), eq(media.kind, "image")))
      .orderBy(desc(listingMedia.position)).limit(1);

    const [brochure] = plan ? [] : await this.read.select({ variants: media.variants })
      .from(listingMedia).innerJoin(media, eq(media.id, listingMedia.mediaId))
      .where(and(eq(listingMedia.listingId, listingId), eq(media.label, "Brochure")))
      .orderBy(desc(listingMedia.position)).limit(1);

    if (!plan && !brochure) throw new BadRequestException("Upload a floor plan photo, or a brochure with one in it, first.");

    const { publicBase } = await import("../media/storage");
    const base = await publicBase();
    const urlOf = (v: string) => (v.startsWith("http") ? v : `${base}/${v}`);

    let data: Partial<FloorPlanExtraction>;
    if (plan) {
      const path = plan.variants.full_jpeg ?? plan.variants.large_jpeg ?? plan.variants.card_jpeg ?? plan.variants.thumb_jpeg;
      if (!path) throw new BadRequestException("That floor plan photo isn't ready yet. Try again in a moment.");
      const res = await fetch(urlOf(path));
      if (!res.ok) throw new BadRequestException("Couldn't read the floor plan photo.");
      const base64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      const { data: d } = await this.claude.json<Partial<FloorPlanExtraction>>(
        "Read this floor plan and return the JSON described.", () => ({ rooms: [] }),
        { userId, feature: "floorplan.extract", system: SYSTEM, images: [{ base64, mediaType: "image/jpeg" }], maxTokens: 3000, effort: "medium" },
      );
      data = d;
    } else {
      const path = brochure!.variants.original;
      if (!path) throw new BadRequestException("That brochure isn't ready yet. Try again in a moment.");
      const res = await fetch(urlOf(path));
      if (!res.ok) throw new BadRequestException("Couldn't read the brochure.");
      const pdfBase64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      const content: Anthropic.Beta.BetaContentBlockParam[] = [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: "Find the floor plan in this brochure, if it has one, and return the JSON described." },
      ];
      const res2 = await this.claude.chat({
        userId, feature: "floorplan.extract", system: SYSTEM + BROCHURE_NOTE,
        messages: [{ role: "user", content }], maxTokens: 3000, effort: "medium",
      }).catch(() => null);
      const text = res2 ? textOf(res2).replace(/```json|```/g, "").trim() : "";
      const start = text.indexOf("{"), end = text.lastIndexOf("}");
      try { data = start >= 0 ? JSON.parse(text.slice(start, end + 1)) : { rooms: [] }; }
      catch { data = { rooms: [] }; }
    }

    const extraction = sanitize(data);
    if (!extraction) {
      throw new BadRequestException(plan
        ? "That didn't look like a readable floor plan. Try a clearer photo of the plan itself."
        : "Couldn't find a floor plan in that brochure. Upload one as its own photo instead.");
    }

    await this.db.update(listings).set({ floorplanData: extraction, updatedAt: new Date() }).where(eq(listings.id, listingId));
    await this.cache.invalidate(`listing:${listingId}`);
    return extraction;
  }
}

/** Keeps only well-formed rooms/doors; a plan with no usable rooms is treated as "couldn't read it". */
function sanitize(data: Partial<FloorPlanExtraction>): FloorPlanExtraction | null {
  const rooms = (Array.isArray(data.rooms) ? data.rooms : [])
    .filter((r): r is Room => !!r && typeof r.x === "number" && typeof r.y === "number" && typeof r.w === "number" && typeof r.d === "number"
      && r.w > 0 && r.d > 0 && (ROOM_KINDS as readonly string[]).includes(r.kind))
    .map((r, i) => ({ ...r, id: String(r.id || `room${i}`), name: String(r.name || r.kind).slice(0, 40) }));
  if (!rooms.length) return null;
  const doors = (Array.isArray(data.doors) ? data.doors : [])
    .filter((d): d is Door => !!d && typeof d.x === "number" && typeof d.y === "number" && (d.axis === "h" || d.axis === "v") && typeof d.width === "number" && d.width > 0)
    .map((d) => ({ x: d.x, y: d.y, axis: d.axis, width: d.width, main: !!d.main }));
  const width = Number(data.width) || Math.max(...rooms.map((r) => r.x + r.w));
  const depth = Number(data.depth) || Math.max(...rooms.map((r) => r.y + r.d));
  const carpetSqft = Math.round(Number(data.carpetSqft) || rooms.reduce((s, r) => s + r.w * r.d, 0));
  const bhk = Math.max(1, Number(data.bhk) || rooms.filter((r) => r.kind === "bedroom").length);
  return { rooms, doors, width, depth, carpetSqft, bhk };
}
