/**
 * A floor plan built only from a floor plan photo the owner uploaded: AI
 * reads the real rooms and their sizes from it, and this turns that into
 * the shapes the 2D plan, 3D walkthrough and hologram all draw from. There
 * is no fallback "typical layout" here any more — without a real uploaded
 * plan, nothing is shown, rather than guessing.
 *
 * Units are feet. x runs across the width, y from the front (entrance side,
 * y = 0) to the back. The balcony sits in front of the living room (y < 0).
 */
export type RoomKind = "living" | "kitchen" | "bedroom" | "bath" | "balcony" | "study";
export type Room = { id: string; kind: RoomKind; name: string; x: number; y: number; w: number; d: number };
/** A wall segment: horizontal when y1 === y2, vertical when x1 === x2. */
export type Wall = { x1: number; y1: number; x2: number; y2: number; low?: boolean };
export type Door = { x: number; y: number; axis: "h" | "v"; width: number; main?: boolean };
export type FloorPlan = {
  rooms: Room[]; walls: Wall[]; doors: Door[];
  width: number; depth: number; carpetSqft: number; bhk: number;
  /** Where a visitor starts (just inside the main door) and the rooms to tour, in order. */
  start: { x: number; y: number };
  tour: { x: number; y: number; room: string; pause?: boolean; look?: number }[];
};
/** What the server stores and sends down: the rooms and doors AI read from the real plan, nothing derived yet. */
export type FloorPlanExtraction = { rooms: Room[]; doors: Door[]; width: number; depth: number; carpetSqft: number; bhk: number };

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Turns a real extraction into a drawable, walkable FloorPlan: computes walls and a walkthrough path. */
export function planFromExtraction(e: FloorPlanExtraction): FloorPlan {
  const walls = wallsFor(e.rooms, e.doors);
  const main = e.doors.find((d) => d.main) ?? e.doors[0];
  const start = main ? { x: r1(main.x + (main.axis === "v" ? 2.5 : 0)), y: r1(main.y + (main.axis === "h" ? 2.5 : 0)) } : { x: 3, y: 3 };
  const tour = autoTour(e.rooms, start);
  return { ...e, walls, start, tour };
}

/**
 * A simple walkthrough of real rooms: nearest-room-next from the entrance,
 * pausing to look around the centre of each. No scripted camera moves (those
 * assumed a generated layout); the camera just faces the way it is walking,
 * which `look` left unset already does for every point here.
 */
function autoTour(rooms: Room[], start: { x: number; y: number }): FloorPlan["tour"] {
  const centres = rooms.map((r) => ({ x: r1(r.x + r.w / 2), y: r1(r.y + r.d / 2), room: r.name }));
  const left = [...centres];
  const tour: FloorPlan["tour"] = [];
  let at = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = Math.hypot(left[i].x - at.x, left[i].y - at.y);
      if (d < bd) { bd = d; bi = i; }
    }
    const next = left.splice(bi, 1)[0];
    tour.push({ ...next, pause: true });
    at = next;
  }
  return tour;
}

/**
 * Every room edge becomes a wall; edges on the same line are merged, then the
 * doorways are cut out. The balcony's outer edges are a low parapet.
 */
export function wallsFor(rooms: Room[], doors: Door[]): Wall[] {
  type Seg = { a: number; b: number };
  const lines = new Map<string, { axis: "h" | "v"; at: number; low: boolean; segs: Seg[] }>();
  const add = (axis: "h" | "v", at: number, a: number, b: number, low: boolean) => {
    const k = `${axis}:${at}:${low}`;
    const l = lines.get(k) ?? { axis, at, low, segs: [] };
    l.segs.push({ a: Math.min(a, b), b: Math.max(a, b) });
    lines.set(k, l);
  };
  for (const r of rooms) {
    const low = r.kind === "balcony";
    const x2 = r1(r.x + r.w), y2 = r1(r.y + r.d);
    if (!low || r.y !== 0) add("h", r.y, r.x, x2, low);   // a balcony's inner edge is the living room's wall
    if (!(low && y2 === 0)) add("h", y2, r.x, x2, low);
    add("v", r.x, r.y, y2, low);
    add("v", x2, r.y, y2, low);
  }
  const out: Wall[] = [];
  for (const l of lines.values()) {
    const merged: Seg[] = [];
    for (const s of l.segs.sort((p, q) => p.a - q.a)) {
      const last = merged[merged.length - 1];
      if (last && s.a <= last.b + 0.01) last.b = Math.max(last.b, s.b); else merged.push({ ...s });
    }
    let parts = merged;
    for (const d of doors.filter((d) => d.axis === l.axis && Math.abs((l.axis === "h" ? d.y : d.x) - l.at) < 0.01)) {
      const c = l.axis === "h" ? d.x : d.y;
      const cutA = c - d.width / 2, cutB = c + d.width / 2;
      parts = parts.flatMap((s) => (cutB <= s.a || cutA >= s.b ? [s] : [{ a: s.a, b: cutA }, { a: cutB, b: s.b }].filter((p) => p.b - p.a > 0.05)));
    }
    for (const s of parts) out.push(l.axis === "h" ? { x1: s.a, y1: l.at, x2: s.b, y2: l.at, low: l.low || undefined } : { x1: l.at, y1: s.a, x2: l.at, y2: s.b, low: l.low || undefined });
  }
  return out;
}

export const ROOM_COLOURS: Record<RoomKind, { floor: string; plan: string }> = {
  living: { floor: "#d9cbb3", plan: "#f4ead8" },
  kitchen: { floor: "#c9c4bd", plan: "#e8e4dd" },
  bedroom: { floor: "#b98f65", plan: "#efe0cc" },
  bath: { floor: "#a9c3cf", plan: "#dcebf1" },
  balcony: { floor: "#9aa58c", plan: "#e1ead6" },
  study: { floor: "#a7855f", plan: "#ece3f5" },
};

export function dims(r: Room) { return `${Math.round(r.w)}′ × ${Math.round(r.d)}′`; }

/** Where a room's name goes: its centre, or, for a bedroom with an attached bath, the open part in front of it. */
export function labelSpot(plan: FloorPlan, r: Room) {
  const bath = r.kind === "bedroom" ? plan.rooms.find((b) => b.kind === "bath" && b.y > r.y && b.x >= r.x && b.x < r.x + r.w) : undefined;
  return { x: r.x + r.w / 2, y: bath ? (r.y + bath.y) / 2 : r.y + r.d / 2 };
}
