/**
 * An illustrative floor plan built from a listing's bedrooms and area.
 *
 * It is not the home's real plan: it is a typical Indian layout of the same
 * size (living and dining at the front with the kitchen beside it, bedrooms
 * behind, attached and common bathrooms, a balcony off the living room) so
 * buyers can picture the space. Every view that shows it says so.
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
  tour: { x: number; y: number; room: string }[];
};

/** Kinds of property a layout makes sense for. */
const HOMES = /apartment|flat|house|villa|builder floor|penthouse|studio|independent|row ?house|duplex/i;

export function canPlan(kind: string | null | undefined, bhk: number | null | undefined, areaSqft: number | null | undefined) {
  return !!kind && HOMES.test(kind) && !!bhk && bhk >= 1 && bhk <= 8 && !!areaSqft && areaSqft >= 250 && areaSqft <= 20_000;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildPlan(bhkIn: number, areaSqft: number): FloorPlan {
  const bhk = Math.max(1, Math.min(8, Math.round(bhkIn)));
  // Listed areas in India are usually super built-up; the rooms get about 72% of it.
  const carpet = Math.max(300, areaSqft * 0.72);
  const bathW = 6;
  // Bedrooms of a sensible size; a study takes spare width; spare depth goes to the living room.
  const bedW = r1(Math.max(10, Math.min(15, Math.sqrt(carpet) * 0.42)));
  const widths = Array.from({ length: bhk }, (_, i) => (i === 0 && bhk > 1 ? r1(bedW * 1.2) : bedW));
  // At least 24 ft across, so the living room and kitchen fit side by side.
  const short = 24 - (widths.reduce((a, b) => a + b, 0) + bathW);
  if (short > 0) widths[widths.length - 1] = r1(widths[widths.length - 1] + short);
  const bedsW = r1(widths.reduce((a, b) => a + b, 0));
  const study = r1(Math.min(14, Math.max(0, Math.sqrt(carpet * 1.1) - bedsW - bathW)));
  const studyW = study >= 7 ? study : 0;
  const width = r1(bedsW + bathW + studyW);
  const hall = 3.5;                                               // passage to the bedrooms
  const depth = r1(Math.max(28, carpet / width));
  const back = r1(Math.max(12, Math.min(17, depth * 0.48)));      // bedrooms row
  const front = r1(depth - hall - back);                          // living + kitchen row
  const backY = r1(front + hall);
  const kitchenW = r1(Math.max(8, Math.min(width * 0.28, 12)));
  const livingW = r1(width - kitchenW);
  const hallY = r1(front + hall / 2);

  const rooms: Room[] = [];
  const doors: Door[] = [];
  rooms.push({ id: "living", kind: "living", name: "Living & dining", x: 0, y: 0, w: livingW, d: front });
  rooms.push({ id: "kitchen", kind: "kitchen", name: "Kitchen", x: livingW, y: 0, w: kitchenW, d: front });
  rooms.push({ id: "hall", kind: "living", name: "Passage", x: 0, y: front, w: width, d: hall });
  doors.push({ x: 0, y: r1(front * 0.55), axis: "v", width: 3.5, main: true });
  doors.push({ x: livingW, y: r1(front * 0.6), axis: "v", width: 4 });
  // The passage is open to the living room.
  doors.push({ x: r1(livingW / 2), y: front, axis: "h", width: livingW });

  const balW = r1(Math.min(livingW * 0.7, 16));
  const balX = r1((livingW - balW) / 2);
  rooms.push({ id: "balcony", kind: "balcony", name: "Balcony", x: balX, y: -5, w: balW, d: 5 });
  doors.push({ x: r1(balX + balW / 2), y: 0, axis: "h", width: Math.min(6, balW - 2) });

  // Bedrooms side by side off the passage, the first (master) a little wider; a common bathroom at the end.
  const bedSpace = bedsW;
  const tour: FloorPlan["tour"] = [{ x: 3, y: r1(front * 0.55), room: "Entrance" }];
  const living = { x: r1(livingW / 2), y: r1(front / 2), room: "Living & dining" };
  tour.push(living, { x: living.x, y: -2.5, room: "Balcony" }, living);
  let x = 0;
  for (let i = 0; i < bhk; i++) {
    const w = widths[i];
    const name = i === 0 && bhk > 1 ? "Master bedroom" : bhk === 1 ? "Bedroom" : `Bedroom ${i + 1}`;
    const doorX = r1(x + 2.5);
    rooms.push({ id: `bed${i + 1}`, kind: "bedroom", name, x: r1(x), y: backY, w, d: back });
    doors.push({ x: doorX, y: backY, axis: "h", width: 3 });
    // Attached bathroom at the back corner, for all but the last bedroom of bigger homes.
    let openD = back;
    if (bhk > 1 && i < Math.min(bhk - 1, 3)) {
      const bw = r1(Math.min(6, w - 4)), bd = r1(Math.min(8, back - 5));
      const bx = r1(x + w - bw), by = r1(backY + back - bd);
      rooms.push({ id: `bath${i + 1}`, kind: "bath", name: "Bath", x: bx, y: by, w: bw, d: bd });
      doors.push({ x: r1(bx + bw / 2), y: by, axis: "h", width: 2.5 });
      openD = back - bd;
    }
    tour.push({ x: living.x, y: hallY, room: "Passage" }, { x: doorX, y: hallY, room: name }, { x: doorX, y: r1(backY + 2), room: name },
      { x: r1(x + w / 2), y: r1(backY + openD / 2 + 0.5), room: name }, { x: doorX, y: r1(backY + 2), room: name }, { x: doorX, y: hallY, room: "Passage" });
    x += w;
  }
  const cbx = r1(bedSpace);
  rooms.push({ id: "bath", kind: "bath", name: bhk > 1 ? "Common bath" : "Bath", x: cbx, y: backY, w: bathW, d: back });
  doors.push({ x: r1(cbx + bathW / 2), y: backY, axis: "h", width: 2.5 });
  if (studyW) {
    const sx = r1(cbx + bathW);
    rooms.push({ id: "study", kind: "study", name: "Study", x: sx, y: backY, w: studyW, d: back });
    doors.push({ x: r1(sx + 2.5), y: backY, axis: "h", width: 3 });
    tour.push({ x: living.x, y: hallY, room: "Passage" }, { x: r1(sx + 2.5), y: hallY, room: "Study" }, { x: r1(sx + 2.5), y: r1(backY + 2), room: "Study" },
      { x: r1(sx + studyW / 2), y: r1(backY + back / 2), room: "Study" }, { x: r1(sx + 2.5), y: r1(backY + 2), room: "Study" }, { x: r1(sx + 2.5), y: hallY, room: "Passage" });
  }
  tour.push({ x: living.x, y: hallY, room: "Passage" }, living, { x: r1(livingW - 2.5), y: r1(front * 0.6), room: "Kitchen" },
    { x: r1(livingW + kitchenW / 2), y: r1(front * 0.6), room: "Kitchen" });

  const walls = wallsFor(rooms, doors);
  return { rooms, walls, doors, width, depth, carpetSqft: Math.round(carpet), bhk, start: { x: 3, y: r1(front * 0.55) }, tour };
}

/**
 * Every room edge becomes a wall; edges on the same line are merged, then the
 * doorways are cut out. The balcony's outer edges are a low parapet.
 */
function wallsFor(rooms: Room[], doors: Door[]): Wall[] {
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
