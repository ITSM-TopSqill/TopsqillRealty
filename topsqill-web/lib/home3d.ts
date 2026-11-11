import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { type FloorPlan, type Wall } from "./floorplan";
import { buildHome } from "./home3d-build";

/**
 * The 3D home built from an illustrative floor plan (see floorplan.ts), as a
 * walkthrough (dollhouse view, walk-around and a guided tour) and as a
 * hologram (glowing wireframe, or four views for a phone-top pyramid).
 * Loaded only when someone opens one of those views.
 */
const EYE = 5.3, RADIUS = 0.9, SPEED = 7;

function disposeAll(scene: THREE.Object3D) {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) { (mat as THREE.SpriteMaterial).map?.dispose(); mat.dispose(); }
  });
}

/** Trees around the plot and a few neighbouring towers in the distance, so windows and the balcony look out on something. */
function surroundings(span: number) {
  const g = new THREE.Group();
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const trunk = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9 });
  const leaves = [0x4f7d3a, 0x5d8c43, 0x3f6b33].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 6, 8);
  const crownGeo = new THREE.IcosahedronGeometry(3.4, 1);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.2, r = span * (0.95 + rnd() * 0.55);
    const t = new THREE.Group();
    t.position.set(Math.cos(a) * r, -0.3, Math.sin(a) * r * 0.85);
    const s = 0.8 + rnd() * 0.6;
    t.scale.setScalar(s);
    const tr = new THREE.Mesh(trunkGeo, trunk); tr.position.y = 3; tr.castShadow = true;
    const cr = new THREE.Mesh(crownGeo, leaves[i % 3]); cr.position.y = 8; cr.scale.set(1, 1.15, 1); cr.castShadow = true;
    t.add(tr, cr);
    g.add(t);
  }
  const towerMat = [0xd9d2c5, 0xc7ccd1, 0xe3dccf].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x8fb3cc, roughness: 0.15, metalness: 0.4 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3, r = span * (2.2 + rnd() * 0.6);
    const w = 18 + rnd() * 16, h = 40 + rnd() * 90;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.8), towerMat[i % 3]);
    b.position.set(Math.cos(a) * r, h / 2 - 0.3, Math.sin(a) * r);
    b.lookAt(0, h / 2, 0);
    g.add(b);
    for (let f = 6; f < h - 4; f += 10) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 3, w * 0.8 + 0.2), glassMat);
      band.position.copy(b.position); band.position.y = f; band.rotation.copy(b.rotation);
      g.add(band);
    }
  }
  return g;
}

/** The shortest turn from angle a to angle b. */
function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  el.appendChild(renderer.domElement);

  const span0 = () => Math.max(plan.width, plan.depth);
  const scene = new THREE.Scene();
  // Sky: a soft gradient; light: a studio environment for natural reflections, plus the sun for shadows.
  const sky = document.createElement("canvas"); sky.width = 2; sky.height = 256;
  const sx = sky.getContext("2d")!; const grad = sx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#6fa8dc"); grad.addColorStop(0.55, "#cfe3f3"); grad.addColorStop(1, "#eef3ee");
  sx.fillStyle = grad; sx.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(sky); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(0xdde9f2, span0() * 2.2, span0() * 5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;
  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x8a7a63, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-35, 70, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  const span = Math.max(plan.width, plan.depth);
  Object.assign(sun.shadow.camera, { left: -span * 0.8, right: span * 0.8, top: span * 0.8, bottom: -span * 0.8, near: 1, far: 250 });
  scene.add(sun);
  const { group, ox, oz, labels, ceilings, grass } = buildHome(plan, "real");
  if (grass) { grass.repeat.set(span * 1.2, span * 1.2); }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(span * 6, 64), new THREE.MeshStandardMaterial({ map: grass, color: 0xffffff, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.3; ground.receiveShadow = true;
  scene.add(ground);
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(plan.width + 3, 0.5, plan.depth + 9), new THREE.MeshStandardMaterial({ color: 0xd9d4cb, roughness: 0.9 }));
  plinth.position.set(0, -0.46, -2); plinth.receiveShadow = true;
  scene.add(plinth);
  scene.add(group);
  for (const c of ceilings) c.visible = false;
  scene.add(surroundings(span));

  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 1200);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.47;
  orbit.minDistance = 12; orbit.maxDistance = span * 2;
  orbit.autoRotate = true; orbit.autoRotateSpeed = 0.6;
  orbit.addEventListener("start", () => { orbit.autoRotate = false; });

  let mode: WalkMode = "dollhouse";
  // Walking state, in plan feet
  let px = plan.start.x, py = plan.start.y, yaw = -Math.PI / 2, pitch = 0;
  const keys = new Set<string>();
  let steerF = 0, steerT = 0;
  let tourIdx = 0, tourRoom = "";
  const PAUSE = 5.5;
  let pauseLeft = 0, pauseYaw = 0, pauseFrom = 0, speed = 0;
  let dragging: { x: number; y: number } | null = null;

  const dollhouse = () => {
    camera.fov = 55;
    camera.position.set(-span * 0.32, span * 0.68, -span * 0.62);
    orbit.target.set(0, 0, 0);
    orbit.enabled = true; orbit.autoRotate = true;
    orbit.update();
  };
  let bob = 0;
  const toEye = () => {
    camera.fov = mode === "tour" ? 64 : 72;
    camera.updateProjectionMatrix();
    camera.position.set(ox + px, EYE + Math.sin(bob) * 0.035, oz + py);
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
      bob += Math.abs(step) * 1.7;
      const nx = px + Math.cos(yaw) * step, ny = py + Math.sin(yaw) * step;
      if (clear(plan.walls, nx, py)) px = nx;
      if (clear(plan.walls, px, ny)) py = ny;
      toEye();
      room(roomAt(px, py));
    } else {
      // Guided tour: glide from point to point, easing in and out and turning to face the way ahead;
      // in each room it stops and slowly looks around before moving on.
      const target = plan.tour[tourIdx];
      const dx = target.x - px, dy = target.y - py, dist = Math.hypot(dx, dy);
      if (pauseLeft > 0) {
        // Turn to the room's best view, then pan slowly left and right across it.
        pauseLeft -= dt;
        const t = 1 - pauseLeft / PAUSE;
        const turn = Math.min(1, t * 3.5), ease = turn * turn * (3 - 2 * turn);
        yaw = pauseFrom + angleDiff(pauseFrom, pauseYaw) * ease + Math.sin(Math.max(0, t - 0.28) / 0.72 * Math.PI * 2) * 0.55 * (t > 0.28 ? 1 : 0);
        if (pauseLeft <= 0) tourIdx = (tourIdx + 1) % plan.tour.length;
      } else if (dist < 0.25) {
        if (target.pause) { pauseLeft = PAUSE; pauseFrom = yaw; pauseYaw = target.look ?? yaw; }
        else {
          tourIdx = (tourIdx + 1) % plan.tour.length;
          if (tourIdx === 0) { px = plan.start.x; py = plan.start.y; }
        }
      } else {
        const want = Math.atan2(dy, dx);
        let diff = want - yaw;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        yaw += diff * Math.min(1, dt * 2.6);
        const turning = Math.min(1, Math.abs(diff) / 0.9);
        speed += ((Math.min(4.2, 0.9 + dist * 1.4) * (1 - turning * 0.85)) - speed) * Math.min(1, dt * 2.5);
        const go = Math.min(dist, speed * dt);
        px += (dx / dist) * go; py += (dy / dist) * go;
        bob += go * 1.7;
      }
      pitch += (-0.06 - pitch) * Math.min(1, dt * 2);
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
      // Inside, there's a ceiling with lights and more light from the room; the dollhouse is open-topped.
      for (const c of ceilings) c.visible = m !== "dollhouse";
      scene.environmentIntensity = m === "dollhouse" ? 0.55 : 0.85;
      hemi.intensity = m === "dollhouse" ? 0.7 : 0.95;
      renderer.toneMappingExposure = m === "dollhouse" ? 1.05 : 0.95;
      keys.clear(); steerF = 0; steerT = 0;
      if (m === "dollhouse") { dollhouse(); onRoom(""); tourRoom = ""; return; }
      orbit.enabled = false;
      px = plan.start.x; py = plan.start.y; yaw = 0; pitch = 0; tourIdx = 0; tourRoom = ""; pauseLeft = 0; speed = 0;
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
      envTex.dispose(); pmrem.dispose(); skyTex.dispose();
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
