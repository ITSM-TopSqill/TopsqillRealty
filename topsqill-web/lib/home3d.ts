import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { labelSpot, ROOM_COLOURS, type FloorPlan, type Wall } from "./floorplan";

/**
 * The 3D home built from an illustrative floor plan (see floorplan.ts), as a
 * walkthrough (dollhouse view, walk-around and a guided tour) and as a
 * hologram (glowing wireframe, or four views for a phone-top pyramid).
 * Loaded only when someone opens one of those views.
 */
const WALL_H = 10, LOW_H = 3.4, WALL_T = 0.4, EYE = 5.4, RADIUS = 0.9, SPEED = 7;

type Style = "real" | "holo";

function buildHome(plan: FloorPlan, style: Style) {
  const g = new THREE.Group();
  const ox = -plan.width / 2, oz = -plan.depth / 2;
  const holo = style === "holo";
  const wallMat = holo
    ? new THREE.MeshBasicMaterial({ color: 0x3ff0ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.9 });
  const lowMat = holo ? wallMat : new THREE.MeshStandardMaterial({ color: 0xbfc6c9, roughness: 0.4, metalness: 0.3 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x5ff6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending });

  const add = (mesh: THREE.Mesh) => {
    if (holo) {
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
      lines.position.copy(mesh.position); lines.rotation.copy(mesh.rotation); lines.scale.copy(mesh.scale);
      g.add(lines);
    } else { mesh.castShadow = true; mesh.receiveShadow = true; }
    g.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(ox + x, y + h / 2, oz + z);
    return add(m);
  };

  // Floors
  for (const r of plan.rooms) {
    const mat = holo
      ? new THREE.MeshBasicMaterial({ color: 0x1aa7c0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: ROOM_COLOURS[r.kind].floor, roughness: r.kind === "bedroom" ? 0.7 : 0.5 });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), mat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(ox + r.x + r.w / 2, r.kind === "bath" ? 0.03 : r.kind === "balcony" ? -0.2 : 0.01, oz + r.y + r.d / 2);
    add(f);
  }

  // Walls, with lintels over the doorways
  for (const w of plan.walls) {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const h = w.low ? LOW_H : WALL_H;
    const horizontal = w.y1 === w.y2;
    box(horizontal ? len + WALL_T : WALL_T, h, horizontal ? WALL_T : len + WALL_T, (w.x1 + w.x2) / 2, w.low ? -0.2 : 0, (w.y1 + w.y2) / 2, w.low ? lowMat : wallMat);
  }
  for (const d of plan.doors) {
    if (d.width > 7) continue;
    const h = d.axis === "h";
    box(h ? d.width : WALL_T, WALL_H - 7.2, h ? WALL_T : d.width, d.x, 7.2, d.y, wallMat);
  }

  // A few pieces of furniture, so the rooms read at a glance
  const wood = holo ? wallMat : new THREE.MeshStandardMaterial({ color: 0x8a6446, roughness: 0.6 });
  const fabric = holo ? wallMat : new THREE.MeshStandardMaterial({ color: 0x6f7fa8, roughness: 0.95 });
  const linen = holo ? wallMat : new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.95 });
  const stone = holo ? wallMat : new THREE.MeshStandardMaterial({ color: 0x3d3f45, roughness: 0.3 });
  const white = holo ? wallMat : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
  for (const r of plan.rooms) {
    if (r.kind === "bedroom") {
      const bw = 5.5, bl = 6.5;
      const bx = r.x + Math.min(r.w / 2, r.w - 4.5) - 1, bz = r.y + r.d - (plan.rooms.some((b) => b.kind === "bath" && b.y > r.y && b.x >= r.x && b.x < r.x + r.w) ? 9.5 : 1.5) - bl / 2;
      box(bw, 1.6, bl, bx, 0, bz, wood);
      box(bw - 0.3, 0.6, bl - 0.6, bx, 1.6, bz + 0.1, linen);
      box(bw, 3.2, 0.3, bx, 0, bz + bl / 2, wood);
      box(2.5, 7, 1.8, r.x + 1.5, 0, r.y + r.d - 1.2 - (r.d > 12 ? 0 : 0), wood);
    } else if (r.kind === "living" && r.id === "living") {
      box(7, 1.4, 2.8, r.x + 5, 0, r.y + r.d - 2.2, fabric);
      box(7, 2.8, 0.7, r.x + 5, 0, r.y + r.d - 0.95, fabric);
      box(3.5, 1.3, 2, r.x + 5, 0, r.y + r.d - 6, wood);
      if (r.w > 16) { box(5, 2.5, 3, r.x + r.w - 5, 0, r.y + r.d / 2, wood); }
      box(6, 1.8, 1.2, r.x + 5, 0, r.y + 1, wood);
    } else if (r.kind === "kitchen") {
      box(2, 3, r.d - 2, r.x + r.w - 1.2, 0, r.y + r.d / 2, stone);
      box(r.w - 3, 3, 2, r.x + (r.w - 2) / 2, 0, r.y + 1.2, stone);
    } else if (r.kind === "bath" && r.w >= 4) {
      box(1.6, 1.4, 2.2, r.x + 1.2, 0, r.y + r.d - 1.4, white);
      box(1.8, 2.8, 1.4, r.x + r.w - 1.3, 0, r.y + r.d - 1, white);
    }
  }

  // Room names
  const labels: THREE.Sprite[] = [];
  for (const r of plan.rooms) {
    if (r.id === "hall") continue;
    const s = label(r.name, holo);
    const at = labelSpot(plan, r);
    s.position.set(ox + at.x, r.kind === "bath" ? 7 : 8, oz + at.y);
    g.add(s);
    labels.push(s);
  }
  return { group: g, ox, oz, labels };
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

function disposeAll(scene: THREE.Object3D) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) { (mat as THREE.SpriteMaterial).map?.dispose(); mat.dispose(); }
  });
}

/** Is a point at least RADIUS from every wall? Doorways are gaps, so they let you through. */
function clear(walls: Wall[], x: number, y: number) {
  for (const w of walls) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - (w.x1 + t * dx), y - (w.y1 + t * dy)) < RADIUS) return false;
  }
  return true;
}

export type WalkMode = "dollhouse" | "walk" | "tour";
export type Walkthrough = {
  setMode(m: WalkMode): void;
  /** For the on-screen arrows: f = forward/back, t = turn left/right, -1..1. */
  steer(f: number, t: number): void;
  dispose(): void;
};

export function mountWalkthrough(el: HTMLElement, plan: FloorPlan, onRoom: (name: string) => void): Walkthrough {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe7ee);
  scene.fog = new THREE.Fog(0xdfe7ee, 120, 260);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9a88f, 1.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.position.set(30, 60, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = Math.max(plan.width, plan.depth);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 200 });
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(span * 2.5, 48), new THREE.MeshStandardMaterial({ color: 0xc9d3c0, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.25; ground.receiveShadow = true;
  scene.add(ground);
  const { group, ox, oz, labels } = buildHome(plan, "real");
  scene.add(group);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 600);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.47;
  orbit.minDistance = 12; orbit.maxDistance = span * 3;
  orbit.autoRotate = true; orbit.autoRotateSpeed = 0.6;
  orbit.addEventListener("start", () => { orbit.autoRotate = false; });

  let mode: WalkMode = "dollhouse";
  // Walking state, in plan feet
  let px = plan.start.x, py = plan.start.y, yaw = -Math.PI / 2, pitch = 0;
  const keys = new Set<string>();
  let steerF = 0, steerT = 0;
  let tourIdx = 0, tourRoom = "";
  let dragging: { x: number; y: number } | null = null;

  const dollhouse = () => {
    camera.fov = 55;
    camera.position.set(0, span * 0.72, span * 0.62);
    orbit.target.set(0, 0, 0);
    orbit.enabled = true; orbit.autoRotate = true;
    orbit.update();
  };
  const toEye = () => {
    camera.fov = 72;
    camera.position.set(ox + px, EYE, oz + py);
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    camera.lookAt(camera.position.clone().add(dir));
  };
  const room = (name: string) => { if (name !== tourRoom) { tourRoom = name; onRoom(name); } };
  const roomAt = (x: number, y: number) => {
    const inside = plan.rooms.filter((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d);
    return (inside.find((r) => r.kind === "bath") ?? inside[0])?.name ?? "";
  };

  const onKey = (e: KeyboardEvent) => {
    if (mode !== "walk" || !/^(Arrow|Key[WASD])/.test(e.code)) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    if (e.type === "keydown") keys.add(e.code); else keys.delete(e.code);
  };
  const onDown = (e: PointerEvent) => { if (mode === "walk") { dragging = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); } };
  const onMove = (e: PointerEvent) => {
    if (!dragging || mode !== "walk") return;
    yaw += (e.clientX - dragging.x) * 0.005;
    pitch = Math.max(-0.6, Math.min(0.5, pitch - (e.clientY - dragging.y) * 0.004));
    dragging = { x: e.clientX, y: e.clientY };
  };
  const onUp = () => { dragging = null; };
  // Walking needs the keys only while the pointer is over the view, so the page keeps scrolling.
  let hovering = false;
  const enter = () => { hovering = true; }, leave = () => { hovering = false; keys.clear(); };
  const keyGate = (e: KeyboardEvent) => { if (hovering) onKey(e); };
  window.addEventListener("keydown", keyGate);
  window.addEventListener("keyup", keyGate);
  renderer.domElement.addEventListener("pointerenter", enter);
  renderer.domElement.addEventListener("pointerleave", leave);
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerup", onUp);

  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();
  dollhouse();

  const clock = new THREE.Clock();
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    if (mode === "dollhouse") orbit.update();
    else if (mode === "walk") {
      let f = steerF, t = steerT;
      if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) t -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) t += 1;
      yaw += t * dt * 1.8;
      const step = Math.max(-1, Math.min(1, f)) * SPEED * dt;
      const nx = px + Math.cos(yaw) * step, ny = py + Math.sin(yaw) * step;
      if (clear(plan.walls, nx, py)) px = nx;
      if (clear(plan.walls, px, ny)) py = ny;
      toEye();
      room(roomAt(px, py));
    } else {
      // Guided tour: glide from point to point, turning to face the way ahead.
      const target = plan.tour[tourIdx];
      const dx = target.x - px, dy = target.y - py, dist = Math.hypot(dx, dy);
      if (dist < 0.3) {
        tourIdx = (tourIdx + 1) % plan.tour.length;
        if (tourIdx === 0) { px = plan.start.x; py = plan.start.y; }
      } else {
        const want = Math.atan2(dy, dx);
        let diff = want - yaw;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        yaw += diff * Math.min(1, dt * 3);
        const go = Math.min(dist, 4.5 * dt * (Math.abs(diff) > 0.8 ? 0.25 : 1));
        px += (dx / dist) * go; py += (dy / dist) * go;
      }
      pitch *= 0.9;
      toEye();
      room(target.room === "Passage" ? roomAt(px, py) : target.room);
    }
    renderer.render(scene, camera);
  };
  frame();

  return {
    setMode(m) {
      mode = m;
      // Names float over the dollhouse; walking, the current room shows in the corner instead.
      for (const l of labels) l.visible = m === "dollhouse";
      keys.clear(); steerF = 0; steerT = 0;
      if (m === "dollhouse") { dollhouse(); onRoom(""); tourRoom = ""; return; }
      orbit.enabled = false;
      px = plan.start.x; py = plan.start.y; yaw = 0; pitch = 0; tourIdx = 0; tourRoom = "";
      toEye();
    },
    steer(f, t) { steerF = f; steerT = t; },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", keyGate);
      window.removeEventListener("keyup", keyGate);
      orbit.dispose();
      disposeAll(scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

export type Hologram = { setPyramid(on: boolean): void; dispose(): void };

/**
 * A glowing, slowly turning wireframe of the home. Pyramid mode draws four
 * views (front, right, back, left) around the centre of a black screen: lay a
 * clear plastic pyramid on a phone or tablet and the home floats inside it.
 */
export function mountHologram(el: HTMLElement, plan: FloorPlan): Hologram {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setClearColor(0x000000, 1);
  const flat = document.createElement("canvas");
  for (const c of [renderer.domElement, flat]) Object.assign(c.style, { display: "block", width: "100%", height: "100%" });
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const { group } = buildHome(plan, "holo");
  const span = Math.max(plan.width, plan.depth);
  const grid = new THREE.PolarGridHelper(span * 0.85, 12, 6, 64, 0x1d8fa0, 0x0f4c58);
  grid.position.y = -0.3;
  const rig = new THREE.Group();
  rig.add(group, grid);
  scene.add(rig);
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 800);

  let pyramid = false;
  const resize = () => {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    if (pyramid) {
      const size = Math.min(w, h);
      flat.width = Math.round(size * Math.min(2, window.devicePixelRatio)); flat.height = flat.width;
      flat.style.width = flat.style.height = `${size}px`;
      const view = Math.round(flat.width / 3);
      renderer.setPixelRatio(1);
      renderer.setSize(view, view, false);
      camera.aspect = 1;
    } else {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
    }
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  const place = (azimuth: number) => {
    const r = span * (pyramid ? 1.15 : 1.55);
    camera.position.set(Math.sin(azimuth) * r, span * 0.75, Math.cos(azimuth) * r);
    camera.lookAt(0, 2, 0);
  };

  const clock = new THREE.Clock();
  let raf = 0;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    const t = clock.getElapsedTime();
    rig.rotation.y = t * 0.25;
    rig.position.y = Math.sin(t * 1.3) * 0.4;
    const flicker = 0.8 + Math.sin(t * 23) * 0.04 + (Math.random() < 0.01 ? -0.3 : 0);
    group.traverse((o) => { const m = (o as THREE.LineSegments).material as THREE.LineBasicMaterial; if (o instanceof THREE.LineSegments && m) m.opacity = flicker; });
    if (!pyramid) { place(0); renderer.render(scene, camera); return; }
    const x = flat.getContext("2d")!;
    const S = flat.width, v = S / 3;
    x.fillStyle = "#000"; x.fillRect(0, 0, S, S);
    // Each view's bottom edge faces the centre, where the pyramid's tip sits.
    const views: [number, number, number, number][] = [
      [0, S / 2, v / 2, 0], [Math.PI / 2, S - v / 2, S / 2, Math.PI / 2], [Math.PI, S / 2, S - v / 2, Math.PI], [-Math.PI / 2, v / 2, S / 2, -Math.PI / 2],
    ];
    for (const [az, cx, cy, rot] of views) {
      place(az);
      renderer.render(scene, camera);
      x.save(); x.translate(cx, cy); x.rotate(rot); x.drawImage(renderer.domElement, -v / 2, -v / 2, v, v); x.restore();
    }
  };
  frame();

  return {
    setPyramid(on) {
      pyramid = on;
      el.replaceChildren(on ? flat : renderer.domElement);
      resize();
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposeAll(scene);
      renderer.dispose();
      el.replaceChildren();
    },
  };
}
