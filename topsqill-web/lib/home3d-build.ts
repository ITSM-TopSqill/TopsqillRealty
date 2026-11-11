import * as THREE from "three";
import { labelSpot, type FloorPlan, type Room } from "./floorplan";

/**
 * Builds the 3D home from an illustrative floor plan: floors with real-looking
 * materials (wood, tiles, marble), painted walls with skirting, windows, open
 * doors, ceilings with lights, and furnished rooms. The "holo" style is the
 * same home as a glowing wireframe, without the finishing.
 *
 * Plan feet map to scene units: plan x → x, plan y → z, height → y.
 */
export const WALL_H = 10, LOW_H = 3.4, WALL_T = 0.4;
export type Style = "real" | "holo";

// ---------- Procedural textures (drawn once, shared) ----------
function tex(size: number, draw: (x: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function textures() {
  const r = rand(7);
  // 4 ft square of oak planks, 6 in wide
  const wood = tex(512, (x, s) => {
    const rows = 8, h = s / rows;
    for (let i = 0; i < rows; i++) {
      let at = -r() * s;
      while (at < s) {
        const len = s * (0.35 + r() * 0.5);
        const l = 46 + r() * 14;
        x.fillStyle = `hsl(${28 + r() * 6}, ${38 + r() * 12}%, ${l}%)`;
        x.fillRect(at, i * h, len, h);
        x.strokeStyle = "rgba(60,35,15,.12)";
        for (let g = 0; g < 6; g++) { x.beginPath(); const y = i * h + r() * h; x.moveTo(at, y); x.bezierCurveTo(at + len / 3, y + (r() - 0.5) * 6, at + (2 * len) / 3, y + (r() - 0.5) * 6, at + len, y); x.stroke(); }
        x.fillStyle = "rgba(40,22,8,.55)"; x.fillRect(at, i * h, 2, h);
        at += len;
      }
      x.fillStyle = "rgba(40,22,8,.5)"; x.fillRect(0, i * h, s, 2);
    }
  });
  // 4 ft square of 2 ft vitrified tiles
  const tile = (base: [number, number, number], n: number) => tex(512, (x, s) => {
    const t = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = (r() - 0.5) * 4;
      x.fillStyle = `hsl(${base[0]}, ${base[1]}%, ${base[2] + v}%)`;
      x.fillRect(i * t, j * t, t, t);
      for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(0,0,0,${r() * 0.035})`; x.fillRect(i * t + r() * t, j * t + r() * t, 8 + r() * 30, 2 + r() * 6); }
    }
    x.strokeStyle = "rgba(120,110,100,.55)"; x.lineWidth = 3;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, s); x.moveTo(0, i * t); x.lineTo(s, i * t); x.stroke(); }
  });
  const marble = tex(512, (x, s) => {
    x.fillStyle = "#f1efec"; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 14; i++) {
      x.strokeStyle = `rgba(110,110,120,${0.08 + r() * 0.18})`; x.lineWidth = 1 + r() * 2.5;
      x.beginPath(); let px = r() * s, py = 0; x.moveTo(px, py);
      while (py < s) { px += (r() - 0.5) * 60; py += 20 + r() * 40; x.lineTo(px, py); }
      x.stroke();
    }
  });
  const deck = tex(256, (x, s) => {
    const n = 6, h = s / n;
    for (let i = 0; i < n; i++) { x.fillStyle = `hsl(25, 30%, ${34 + r() * 8}%)`; x.fillRect(0, i * h, s, h - 3); x.fillStyle = "#2a1d14"; x.fillRect(0, i * h + h - 3, s, 3); }
  });
  const grass = tex(256, (x, s) => {
    x.fillStyle = "#7d9a5c"; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 2500; i++) { x.fillStyle = `hsla(${85 + r() * 25}, 35%, ${30 + r() * 25}%, .5)`; x.fillRect(r() * s, r() * s, 2, 3 + r() * 3); }
  });
  const view = tex(256, (x, s) => {
    const g = x.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, "#8ec5ef"); g.addColorStop(0.62, "#d8ecfa"); g.addColorStop(0.63, "#9db58a"); g.addColorStop(1, "#7f9a6c");
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 9; i++) { x.fillStyle = `rgba(70,${100 + r() * 40},60,.85)`; x.beginPath(); x.arc(r() * s, s * 0.63, 14 + r() * 26, Math.PI, 0); x.fill(); }
    for (let i = 0; i < 4; i++) { x.fillStyle = "rgba(190,200,210,.9)"; const w = 20 + r() * 30, h = 40 + r() * 70; x.fillRect(r() * s, s * 0.63 - h, w, h); }
  });
  view.wrapS = view.wrapT = THREE.ClampToEdgeWrapping;
  return { wood, tiles: tile([38, 22, 86], 2), bathTiles: tile([200, 12, 82], 6), kitchenTiles: tile([30, 6, 74], 4), marble, deck, grass, view };
}

function repeat(t: THREE.Texture, w: number, d: number, ft: number) {
  const c = t.clone();
  c.repeat.set(w / ft, d / ft);
  c.needsUpdate = true;
  return c;
}

// ---------- The build ----------
export function buildHome(plan: FloorPlan, style: Style) {
  const holo = style === "holo";
  const g = new THREE.Group();
  const ox = -plan.width / 2, oz = -plan.depth / 2;
  const ceilings: THREE.Object3D[] = [];
  const labels: THREE.Sprite[] = [];
  const T = holo ? null : textures();

  const holoMat = new THREE.MeshBasicMaterial({ color: 0x3ff0ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x5ff6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });
  const std = (o: THREE.MeshStandardMaterialParameters) => (holo ? holoMat : new THREE.MeshStandardMaterial(o));
  const M = {
    wall: std({ color: 0xece3d6, roughness: 0.92 }),
    accent: std({ color: 0xc9b9a3, roughness: 0.9 }),
    sage: std({ color: 0x8fa38c, roughness: 0.9 }),
    skirting: std({ color: 0x5b4a3c, roughness: 0.6 }),
    rail: std({ color: 0x9aa3a8, roughness: 0.3, metalness: 0.7 }),
    oak: std({ color: 0x9a6d47, roughness: 0.55 }),
    walnut: std({ color: 0x5a3c28, roughness: 0.5 }),
    whiteLam: std({ color: 0xf2f0ec, roughness: 0.35 }),
    fabric: std({ color: 0x5d6b8a, roughness: 0.95 }),
    fabric2: std({ color: 0xb59a7a, roughness: 0.95 }),
    cushion: std({ color: 0xd8b25a, roughness: 0.9 }),
    linen: std({ color: 0xf6f4ef, roughness: 0.95 }),
    duvet: std({ color: 0x8aa3b5, roughness: 0.9 }),
    rug: std({ color: 0x9b6e5c, roughness: 1 }),
    black: std({ color: 0x15151a, roughness: 0.25, metalness: 0.3 }),
    screen: std({ color: 0x0b0d12, roughness: 0.1, metalness: 0.5, emissive: 0x1a2a44, emissiveIntensity: 0.35 }),
    steel: std({ color: 0xc3c7cb, roughness: 0.25, metalness: 0.85 }),
    ceramic: std({ color: 0xffffff, roughness: 0.15 }),
    marble: std({ color: 0xffffff, roughness: 0.2, map: T?.marble }),
    glass: holo ? holoMat : new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.25 }),
    mirror: std({ color: 0xdfe8ee, roughness: 0.02, metalness: 1 }),
    leaf: std({ color: 0x4f7d3a, roughness: 0.8 }),
    pot: std({ color: 0xb46a45, roughness: 0.8 }),
    door: std({ color: 0xb08a63, roughness: 0.5 }),
    mainDoor: std({ color: 0x5a3a22, roughness: 0.45 }),
    lamp: holo ? holoMat : new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe2a8, emissiveIntensity: 1.2, roughness: 0.6 }),
    ceiling: std({ color: 0xfbfaf7, roughness: 0.95, side: THREE.DoubleSide }),
    view: holo ? holoMat : new THREE.MeshBasicMaterial({ map: T!.view }),
    frame: std({ color: 0xfafafa, roughness: 0.4 }),
  };

  const add = (m: THREE.Mesh, parent: THREE.Object3D = g, cast = true) => {
    if (holo) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), edgeMat);
      lines.position.copy(m.position); lines.rotation.copy(m.rotation); lines.scale.copy(m.scale);
      parent.add(lines);
    } else { m.castShadow = cast; m.receiveShadow = true; }
    parent.add(m);
    return m;
  };
  /** A box with its base at y; x and z are its centre. */
  const box = (p: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, cast = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    return add(m, p, cast);
  };
  const cyl = (p: THREE.Object3D, rt: number, rb: number, h: number, x: number, y: number, z: number, mat: THREE.Material, seg = 20) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.position.set(x, y + h / 2, z);
    return add(m, p);
  };
  const ball = (p: THREE.Object3D, rad: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 12), mat);
    m.position.set(x, y, z);
    return add(m, p);
  };
  /** A piece of furniture at plan (x, y), turned to face a direction: 0 = +y (back), π = −y (front), π/2 = +x, −π/2 = −x. */
  const piece = (x: number, y: number, face: number) => {
    const p = new THREE.Group();
    p.position.set(ox + x, 0, oz + y);
    p.rotation.y = face;
    g.add(p);
    return p;
  };
  const FACE_FRONT = Math.PI, FACE_BACK = 0, FACE_RIGHT = Math.PI / 2, FACE_LEFT = -Math.PI / 2;

  // ---- Floors
  for (const r of plan.rooms) {
    let mat: THREE.Material;
    if (holo) mat = new THREE.MeshBasicMaterial({ color: 0x1aa7c0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    else {
      const [t, ft, rough] = r.kind === "bedroom" || r.kind === "study" ? [T!.wood, 4, 0.5] : r.kind === "bath" ? [T!.bathTiles, 2, 0.3]
        : r.kind === "balcony" ? [T!.deck, 3, 0.8] : r.kind === "kitchen" ? [T!.kitchenTiles, 4, 0.35] : [T!.tiles, 4, 0.22];
      mat = new THREE.MeshStandardMaterial({ map: repeat(t, r.w, r.d, ft), roughness: rough });
    }
    const f = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(ox + r.x + r.w / 2, r.kind === "bath" ? 0.03 : r.kind === "balcony" ? -0.2 : 0.01, oz + r.y + r.d / 2);
    add(f, g, false);
    if (!holo && r.kind !== "balcony") {
      // Ceiling and a light, seen only from inside (hidden in the dollhouse view)
      const c = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), M.ceiling);
      c.rotation.x = Math.PI / 2;
      c.position.set(ox + r.x + r.w / 2, WALL_H, oz + r.y + r.d / 2);
      g.add(c); ceilings.push(c);
      if (r.id !== "hall") {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(r.kind === "bath" ? 0.4 : 0.7, r.kind === "bath" ? 0.4 : 0.7, 0.08, 24), M.lamp);
        l.position.set(ox + r.x + r.w / 2, WALL_H - 0.05, oz + r.y + r.d / 2);
        g.add(l); ceilings.push(l);
      }
    }
  }

  // ---- Walls with skirting, lintels over doorways
  for (const w of plan.walls) {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const hor = w.y1 === w.y2;
    const cx = ox + (w.x1 + w.x2) / 2, cz = oz + (w.y1 + w.y2) / 2;
    if (w.low) {
      box(g, hor ? len + WALL_T : WALL_T, LOW_H - 0.4, hor ? WALL_T : len + WALL_T, cx, -0.2, cz, M.wall);
      box(g, hor ? len + WALL_T : WALL_T + 0.1, 0.15, hor ? WALL_T + 0.1 : len + WALL_T, cx, LOW_H - 0.6, cz, M.rail);
      continue;
    }
    box(g, hor ? len + WALL_T : WALL_T, WALL_H, hor ? WALL_T : len + WALL_T, cx, 0, cz, M.wall);
    if (!holo) box(g, hor ? len + WALL_T + 0.02 : WALL_T + 0.08, 0.35, hor ? WALL_T + 0.08 : len + WALL_T + 0.02, cx, 0, cz, M.skirting, false);
  }
  for (const d of plan.doors) {
    if (d.width > 7) continue;
    const h = d.axis === "h";
    box(g, h ? d.width : WALL_T, WALL_H - 7.2, h ? WALL_T : d.width, ox + d.x, 7.2, oz + d.y, M.wall);
    if (holo || d.width > 4.5) continue;
    // An open door leaf, hinged at one side, swung into the room beyond.
    const hinge = new THREE.Group();
    hinge.position.set(ox + d.x - (h ? d.width / 2 : 0), 0, oz + d.y - (h ? 0 : d.width / 2));
    hinge.rotation.y = h ? -1.3 : -0.3;
    g.add(hinge);
    const lw = d.width - 0.12;
    box(hinge, lw, 7.1, 0.16, lw / 2 + 0.06, 0, 0, d.main ? M.mainDoor : M.door);
    box(hinge, 0.5, 0.08, 0.3, lw - 0.35, 3.4, 0, M.steel);
  }

  // ---- Windows on outer walls: a frame and a bright view of sky and trees
  const windowAt = (x: number, y: number, axis: "h" | "v", w: number, sill: number, h: number) => {
    if (holo) return;
    const hor = axis === "h";
    const pane = new THREE.Mesh(new THREE.BoxGeometry(hor ? w : WALL_T + 0.04, h, hor ? WALL_T + 0.04 : w), M.view);
    pane.position.set(ox + x, sill + h / 2, oz + y);
    g.add(pane);
    const t = 0.25, deep = WALL_T + 0.14;
    box(g, hor ? w + t * 2 : deep, t, hor ? deep : w + t * 2, ox + x, sill - t, oz + y, M.frame);
    box(g, hor ? w + t * 2 : deep, t, hor ? deep : w + t * 2, ox + x, sill + h, oz + y, M.frame);
    for (const s of [-1, 0, 1]) box(g, hor ? (s ? t : 0.12) : deep, h, hor ? deep : (s ? t : 0.12), ox + x + (hor ? s * (w / 2 + (s ? t / 2 : 0)) : 0), sill, oz + y + (hor ? 0 : s * (w / 2 + (s ? t / 2 : 0))), M.frame);
  };

  // ---- Furniture
  const rooms = plan.rooms;
  const bathIn = (r: Room) => rooms.find((b) => b.kind === "bath" && b.y > r.y && b.x >= r.x && b.x < r.x + r.w);
  const living = rooms.find((r) => r.id === "living")!;
  const kitchen = rooms.find((r) => r.kind === "kitchen")!;
  const entry = plan.doors.find((d) => d.main)!;
  const D = plan.depth;

  // Living: TV wall on the left, sofa facing it, rug and coffee table; dining towards the kitchen.
  {
    const free = Math.max(4.8, entry.y - entry.width / 2 - 0.4);
    const ty = Math.max(2.8, free / 2);
    const tv = piece(0.2 + 0.8, ty, FACE_RIGHT);
    box(tv, 6, 1.5, 1.4, 0, 0, 0, M.walnut);
    box(tv, 6.1, 0.08, 1.45, 0, 1.5, 0, M.oak);
    box(tv, 4.6, 2.6, 0.12, 0, 2.6, -0.5, M.screen);
    box(tv, 1.2, 0.12, 0.5, 0, 2.48, -0.4, M.black);
    if (!holo) box(tv, 7.5, 6, 0.05, 0, 1.5, -0.72, M.accent, false);
    const sx = Math.min(living.w / 2 - 2.8, 10);
    const sl = Math.min(7, Math.max(5, ty * 2 - 0.6));
    const sofa = piece(sx, ty, FACE_LEFT);
    box(sofa, sl, 1.25, 3, 0, 0, 0, M.fabric);
    for (let i = 0; i < 3; i++) box(sofa, sl / 3 - 0.12, 0.45, 2.3, -sl / 3 + (i * sl) / 3, 1.25, 0.25, M.fabric);
    box(sofa, sl, 1.7, 0.75, 0, 1.25, -1.1, M.fabric);
    for (const s of [-1, 1]) box(sofa, 0.6, 2.1, 3, s * (sl / 2 - 0.3), 0, 0, M.fabric);
    for (const s of [-1, 1]) { const c = box(sofa, 1.3, 1.2, 0.35, s * (sl / 2 - 1.2), 1.7, -0.55, M.cushion); c.rotation.x = -0.25; }
    const mid = (1 + sx) / 2 + 0.3;
    const rug = piece(mid, ty, 0);
    box(rug, Math.max(4, sx - 2.2), 0.03, Math.min(7.5, sl + 1), 0, 0.01, 0, M.rug, false);
    box(rug, 2.2, 0.12, 3.4, 0, 1.2, 0, M.glass);
    for (const [a, b] of [[-0.9, -1.5], [0.9, -1.5], [-0.9, 1.5], [0.9, 1.5]]) cyl(rug, 0.06, 0.06, 1.2, a, 0, b, M.steel, 8);
    // Floor lamp and a plant by the sofa
    const lamp = piece(sx + 0.6, Math.max(0.9, ty - sl / 2 - 0.9), 0);
    cyl(lamp, 0.5, 0.5, 0.06, 0, 0, 0, M.black); cyl(lamp, 0.05, 0.05, 5.2, 0, 0, 0, M.black); cyl(lamp, 0.45, 0.7, 0.9, 0, 5.2, 0, M.lamp);
    const pl = piece(Math.min(living.w / 2 + 3.6, living.w - 1), 0.9, 0);
    cyl(pl, 0.55, 0.42, 1.3, 0, 0, 0, M.pot); ball(pl, 0.95, 0, 2.3, 0, M.leaf); ball(pl, 0.7, 0.4, 3.0, 0.2, M.leaf); ball(pl, 0.6, -0.3, 3.3, -0.2, M.leaf);
    // Dining
    const seats = plan.bhk >= 3 ? 6 : 4;
    const tl = seats === 6 ? 6 : 4.5;
    const dx = Math.min(living.w * 0.76, living.w - tl / 2 - 2.2), dy = Math.max(2.9, Math.min(living.d * 0.3, 3.6));
    const din = piece(dx, dy, 0);
    box(din, tl, 0.15, 3, 0, 2.45, 0, M.oak);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(din, 0.2, 2.45, 0.2, a * (tl / 2 - 0.3), 0, b * 1.2, M.walnut);
    const chair = (cx: number, cz: number, face: number) => {
      const c = new THREE.Group(); c.position.set(cx, 0, cz); c.rotation.y = face; din.add(c);
      box(c, 1.5, 0.18, 1.5, 0, 1.5, 0, M.fabric2);
      box(c, 1.5, 1.7, 0.15, 0, 1.68, -0.68, M.fabric2);
      for (const [a, b] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) box(c, 0.12, 1.5, 0.12, a, 0, b, M.walnut);
    };
    const per = seats / 2;
    for (let i = 0; i < per; i++) {
      const cx = -tl / 2 + (tl / per) * (i + 0.5);
      chair(cx, -2.1, 0); chair(cx, 2.1, Math.PI);
    }
    if (!holo) {
      // Pendant light over the table
      cyl(din, 0.02, 0.02, WALL_H - 6.2, 0, 6.2, 0, M.black, 6);
      cyl(din, 0.5, 1.1, 0.8, 0, 5.6, 0, M.lamp);
    }
  }

  // Kitchen: L-shaped counter (front wall and right wall), hob, sink, upper cabinets, fridge.
  {
    const k = kitchen;
    const run = (len: number) => {
      const p = new THREE.Group();
      box(p, len, 2.85, 2, 0, 0, 0, M.whiteLam);
      box(p, len + 0.05, 0.15, 2.1, 0, 2.85, 0.05, M.marble);
      box(p, len, 0.35, 1.9, 0, 0, 0.1, M.walnut);
      for (let i = 0; i < Math.floor(len / 2); i++) box(p, 0.9, 0.06, 0.06, -len / 2 + 1 + i * 2, 2.4, 1.02, M.steel);
      return p;
    };
    const rightLen = Math.max(4, k.d - 3.4);
    const right = piece(k.x + k.w - 1.2, rightLen / 2 + 0.2, FACE_LEFT);
    right.add(run(rightLen));
    box(right, 2.2, 0.06, 1.7, 0, 3.0, 0.1, M.black);                 // hob
    for (const s of [-1, 1]) cyl(right, 0.35, 0.35, 0.03, s * 0.5, 3.06, 0.1, M.steel);
    box(right, Math.min(rightLen, 7), 2.3, 1.25, 0, 5.3, -0.35, M.walnut); // upper cabinets
    box(right, 2.4, 1.6, 1.6, 0, 7.6, -0.2, M.steel);                  // chimney
    const frontLen = Math.max(3, k.w - 2.4);
    const front = piece(k.x + 0.2 + frontLen / 2, 1.2, FACE_BACK);
    front.add(run(frontLen));
    box(front, 2.2, 0.1, 1.4, 0, 2.95, 0, M.steel);                    // sink
    cyl(front, 0.06, 0.06, 1.1, 0, 3.0, -0.6, M.steel, 8);
    windowAt(k.x + 0.2 + frontLen / 2, 0, "h", Math.min(3.5, frontLen - 0.6), 4.0, 3.2);
    const fr = piece(k.x + k.w - 1.5, k.d - 1.5, FACE_LEFT);
    box(fr, 2.6, 6.2, 2.4, 0, 0, 0, M.steel);
    box(fr, 0.08, 1.6, 0.08, 1.0, 3.2, 1.25, M.black);
  }

  for (const r of rooms) {
    if (r.kind === "bedroom") {
      const bath = bathIn(r);
      const right = bath ? bath.x : r.x + r.w;
      const bw = r.name.startsWith("Master") || plan.bhk === 1 ? 6.2 : 5.2;
      const bx = r.x + (right - r.x) / 2;
      const by = r.y + r.d - 0.2 - 3.6;
      const bed = piece(bx, by, FACE_FRONT);
      box(bed, bw, 1.2, 6.8, 0, 0, 0, M.walnut);
      box(bed, bw - 0.2, 0.75, 6.5, 0, 1.2, 0.05, M.linen);
      box(bed, bw - 0.05, 0.28, 4.3, 0, 1.85, 1.15, M.duvet);
      box(bed, bw - 0.05, 0.3, 0.9, 0, 1.85, -0.35, M.linen);
      for (const s of [-1, 1]) { const p = box(bed, bw / 2 - 0.5, 0.45, 1.2, s * (bw / 4), 1.95, -2.6, M.linen); p.rotation.x = -0.2; }
      box(bed, bw + 0.4, 4.2, 0.35, 0, 0, -3.5, M.fabric2);
      if (!holo) box(bed, Math.min(right - r.x - 0.6, bw + 4), 4.4, 0.04, 0, 0, -3.58, M.sage, false);   // accent wall behind the bed
      const room = (right - r.x - bw) / 2;
      if (room > 2.1) for (const s of [-1, 1]) {
        box(bed, 1.5, 1.8, 1.4, s * (bw / 2 + 1.0), 0, -2.9, M.oak);
        cyl(bed, 0.14, 0.2, 0.9, s * (bw / 2 + 1.0), 1.8, -2.9, M.black, 10);
        cyl(bed, 0.35, 0.5, 0.6, s * (bw / 2 + 1.0), 2.7, -2.9, M.lamp, 16);
      }
      windowAt(bx, D, "h", Math.min(5, right - r.x - 2), 4.6, 3.6);
      // Wardrobe on the front wall, away from the door
      const ww = Math.min(6, r.w / 2 - 1.6);   // stays clear of the path from the door to the middle of the room
      if (ww >= 3) {
        const wd = piece(r.x + r.w - 0.2 - ww / 2, r.y + 0.2 + 1.05, FACE_BACK);
        box(wd, ww, 7.4, 2, 0, 0, 0, M.oak);
        const n = Math.max(2, Math.round(ww / 2));
        for (let i = 1; i < n; i++) box(wd, 0.04, 7.2, 0.05, -ww / 2 + (ww / n) * i, 0.1, 1.01, M.walnut);
        for (let i = 0; i < n; i++) box(wd, 0.06, 1.2, 0.08, -ww / 2 + (ww / n) * (i + 0.5) + 0.35, 3.2, 1.04, M.steel);
      }
    } else if (r.kind === "bath" && r.w >= 4) {
      const v = piece(r.x + 0.2 + 0.85, r.y + Math.min(2.2, r.d / 2 - 1), FACE_RIGHT);
      box(v, 2.4, 2.7, 1.6, 0, 0, 0, M.walnut);
      box(v, 2.5, 0.12, 1.7, 0, 2.7, 0.05, M.marble);
      cyl(v, 0.55, 0.45, 0.3, 0, 2.8, 0.1, M.ceramic, 20);
      box(v, 2.2, 2.6, 0.06, 0, 3.6, -0.78, M.mirror);
      const wc = piece(r.x + 1.3, r.y + r.d - 1.2, FACE_FRONT);
      box(wc, 1.3, 1.3, 1.9, 0, 0, 0.2, M.ceramic);
      box(wc, 1.5, 1.7, 0.6, 0, 1.0, -0.75, M.ceramic);
      if (r.w >= 5.5) {
        const sz = Math.min(3, r.d / 3);
        const sh = piece(r.x + r.w - 0.2 - sz / 2, r.y + r.d - 0.2 - sz / 2, 0);
        box(sh, sz, 0.12, sz, 0, 0, 0, M.ceramic);
        box(sh, sz, 6.6, 0.06, 0, 0.12, -sz / 2 - 0.0, M.glass);
        cyl(sh, 0.4, 0.4, 0.06, 0, 7.2, sz / 2 - 0.5, M.steel);
      }
      if (Math.abs(r.y + r.d - D) < 0.2) windowAt(r.x + r.w / 2, D, "h", Math.min(2.2, r.w - 2), 6.4, 1.8);
    } else if (r.kind === "study") {
      const desk = piece(r.x + r.w / 2, r.y + r.d - 0.2 - 1.25, FACE_FRONT);
      box(desk, Math.min(5, r.w - 2), 0.15, 2.4, 0, 2.45, 0, M.oak);
      for (const s of [-1, 1]) box(desk, 0.15, 2.45, 2.2, s * (Math.min(5, r.w - 2) / 2 - 0.2), 0, 0, M.black);
      box(desk, 2, 1.3, 0.1, 0, 2.6, -0.8, M.screen);
      const ch = piece(r.x + r.w / 2, r.y + r.d - 3.6, FACE_BACK);
      box(ch, 1.7, 0.3, 1.7, 0, 1.5, 0, M.black); box(ch, 1.7, 2, 0.2, 0, 1.8, -0.8, M.black); cyl(ch, 0.1, 0.1, 1.5, 0, 0, 0, M.steel, 8);
      const sh = piece(r.x + r.w - 0.2 - 0.6, r.y + r.d / 2 + 1, FACE_LEFT);
      box(sh, 4, 7, 1.2, 0, 0, 0, M.oak);
      for (let i = 1; i < 5; i++) box(sh, 3.8, 0.08, 1.1, 0, i * 1.4, 0.05, M.walnut);
      windowAt(r.x + r.w / 2, D, "h", Math.min(4, r.w - 2), 4.6, 3.4);
    } else if (r.kind === "balcony") {
      const b = piece(r.x + 2.2, r.y + 2.5, 0);
      cyl(b, 0.9, 0.9, 0.1, 0, 2.2, 0, M.oak); cyl(b, 0.1, 0.1, 2.2, 0, 0, 0, M.black, 8);
      for (const s of [-1, 1]) { const c = new THREE.Group(); c.position.set(s * 1.7, 0, 0); c.rotation.y = -s * Math.PI / 2; b.add(c); box(c, 1.6, 0.15, 1.6, 0, 1.4, 0, M.fabric2); box(c, 1.6, 1.4, 0.15, 0, 1.55, -0.72, M.fabric2); for (const [a, z] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) box(c, 0.1, 1.4, 0.1, a, 0, z, M.black); }
      for (const px of [r.x + r.w - 1, r.x + r.w - 2.6]) { const p = piece(px, r.y + 0.9, 0); cyl(p, 0.5, 0.4, 1.1, 0, 0, 0, M.pot); ball(p, 0.8, 0, 1.9, 0, M.leaf); ball(p, 0.55, 0.2, 2.6, 0.1, M.leaf); }
    }
  }

  // ---- Room names (shown over the dollhouse)
  for (const r of rooms) {
    if (r.id === "hall") continue;
    const s = label(r.name, holo);
    const at = labelSpot(plan, r);
    s.position.set(ox + at.x, r.kind === "bath" ? 8.5 : 9.5, oz + at.y);
    g.add(s);
    labels.push(s);
  }
  return { group: g, ox, oz, labels, ceilings, grass: T?.grass ?? null };
}

function label(text: string, holo: boolean) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const x = c.getContext("2d")!;
  x.font = "600 54px system-ui, sans-serif";
  const w = Math.min(500, x.measureText(text).width + 48);
  if (!holo) { x.fillStyle = "rgba(20,16,40,.72)"; roundRect(x, (512 - w) / 2, 22, w, 84, 40); x.fill(); }
  x.fillStyle = holo ? "#7ff8ff" : "#fff";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(10, 2.5, 1);
  s.renderOrder = 10;
  return s;
}

function roundRect(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath();
}
