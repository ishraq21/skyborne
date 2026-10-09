
// =====================================================================
// city blocks: the streets, buildings and street life inside a district
// =====================================================================
// City scale: a Skybot is about 1.9 to the top of its head, so a car is about as long as a bot is tall, a door
// (DOOR_H) fits a bot, and a ground floor (GROUND_H) is a little taller than the floors above it (FLOOR_H).
// BS: building footprints, grown with the island. Every lot fits between the sidewalk (ROAD_OUT + 0.7) and
// the island's rim (its 10 sides keep their flat edges 0.951 × ISLAND_R from the middle).
const ROAD_IN = 9.0, ROAD_OUT = 11.6, LANE_IN = 9.65, LANE_OUT = 10.95, WALK_R = 11.95, LOT_R = 13.75;
const FLOOR_H = 1.6, GROUND_H = 2.8, DOOR_H = 2.4, DOOR_W = 1.3, BS = 1.3; // a Skybot is about 1.25 across its hands
// Building lots around the ring road, in the order a district grows into them.
// a = angle from the district's front (local +z, away from City Hall) toward +x.
const LOTS = [
  { a: 0.62, type: 'park' },
  { a: -0.62, type: 'cafe' },
  { a: -1.45, type: 'apartment' },
  { a: 1.45, type: 'shop' },
  { a: -2.2, type: 'tower' },
  { a: 2.2, type: 'tower' },
  { a: 2.75, type: 'apartment' },
  { a: -2.75, type: 'shop' },
];
// development points a district needs before each lot gets built (see District.develop)
const LOT_STEPS = [0, 5, 12, 22, 34, 50, 70, 95];
const ASPHALT = 0x3b4152, CURB = 0xddd6c6;
const IDLE_SPOTS = [[6.6, -1.25], [5.1, 0.0], [-5.4, 5.6], [4.6, 6.25], [-7.1, 1.75], [0.75, 7.6], [-3.0, -2.0]];

function makeRoadRing() {
  const g = new THREE.Group();
  const road = new THREE.Mesh(new THREE.RingGeometry(ROAD_IN, ROAD_OUT, 96, 1).rotateX(-Math.PI / 2), stdMat(ASPHALT, { roughness: 0.95 }));
  road.position.y = 0.11; road.receiveShadow = true; g.add(road);
  const walk = new THREE.Mesh(new THREE.RingGeometry(ROAD_OUT, ROAD_OUT + 0.7, 96, 1).rotateX(-Math.PI / 2), stdMat(CURB));
  walk.position.y = 0.14; walk.receiveShadow = true; g.add(walk);
  const curb = new THREE.Mesh(new THREE.TorusGeometry(ROAD_IN, 0.08, 4, 96).rotateX(Math.PI / 2), stdMat(CURB)); curb.position.y = 0.13; g.add(curb);
  const dashes = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU, r = (ROAD_IN + ROAD_OUT) / 2;
    dashes.push(new THREE.BoxGeometry(0.75, 0.02, 0.1).rotateY(a).translate(Math.sin(a) * r, 0.125, Math.cos(a) * r));
  }
  const dm = new THREE.Mesh(mergeGeometries(dashes), stdMat(0xf5e6a8)); dashes.forEach((d) => d.dispose()); g.add(dm);
  return g;
}

// ---- cars that drive the ring road ----
const CAR_COLORS = [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xf783ac, 0xf8f9fa, 0x9775fa, 0xff922b, 0x38d9a9];
const CARG = {
  body: new RoundedBoxGeometry(0.46, 0.28, 0.92, 2, 0.09),
  cabin: new RoundedBoxGeometry(0.4, 0.24, 0.48, 2, 0.08),
  wheel: new THREE.CylinderGeometry(0.1, 0.1, 0.07, 10).rotateZ(Math.PI / 2),
  lamp: new THREE.BoxGeometry(0.1, 0.06, 0.03),
};
let CAR_HEAD = null, CAR_TAIL = null;
function makeCar(color) {
  CAR_HEAD ||= glowMat(0xfff4d6, 0.5, 3.2, { base: 0xffffff });
  CAR_TAIL ||= glowMat(0xff3b3b, 0.5, 2.6, { base: 0x551111 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(CARG.body, stdMat(color, { roughness: 0.35, metalness: 0.25 })); body.position.y = 0.22; body.castShadow = true; g.add(body);
  const cab = new THREE.Mesh(CARG.cabin, stdMat(0x2b3550, { roughness: 0.2, metalness: 0.4 })); cab.position.set(0, 0.44, -0.04); g.add(cab);
  for (const [x, z] of [[-0.24, 0.3], [0.24, 0.3], [-0.24, -0.3], [0.24, -0.3]]) { const w = new THREE.Mesh(CARG.wheel, stdMat(0x1d2029)); w.position.set(x, 0.1, z); g.add(w); }
  for (const x of [-0.14, 0.14]) {
    const h = new THREE.Mesh(CARG.lamp, CAR_HEAD); h.position.set(x, 0.24, 0.465); g.add(h);
    const t = new THREE.Mesh(CARG.lamp, CAR_TAIL); t.position.set(x, 0.24, -0.465); g.add(t);
  }
  return g;
}
// A car is built at its first size and drawn CAR_SCALE bigger: about as long as a Skybot is tall (2.0).
// Each lane runs one way; a car eases off to keep its distance from the car ahead (CAR_GAP between their
// middles) and stops before it would touch it (CAR_STOP), so cars never pass through each other.
const CAR_SCALE = 2.2, CAR_GAP = 5.2, CAR_STOP = 2.6;
// the distance along the lane from car c to the car ahead of it, middle to middle (Infinity when it's alone)
function gapAhead(c, cars) {
  let best = Infinity;
  for (const o of cars) {
    if (o === c || o.r !== c.r || o.gone || (o.leaving && o.s < 0.5)) continue;
    const da = (((o.a - c.a) * c.dir) % TAU + TAU) % TAU;
    best = Math.min(best, da * c.r);
  }
  return best;
}
class Car {
  constructor(d, lane, dir, a0) {
    this.d = d; this.r = lane; this.dir = dir; this.a = a0; this.speed = 2.0 + Math.random() * 1.2; this.v = 0; this.s = 0; this.leaving = false; this.gone = false;
    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    this.mesh = protoClone('car:' + color, () => makeCar(color));
    d.group.add(this.mesh);
  }
  update(dt, cars) {
    const gap = gapAhead(this, cars);
    const want = this.d.asleep ? 0 : this.speed * clamp((gap - CAR_STOP) / (CAR_GAP - CAR_STOP), 0, 1);
    this.v = want < this.v ? want : Math.min(want, this.v + dt * 2.5); // brakes at once, pulls away gently
    this.a += this.dir * Math.min(this.v * dt, Math.max(0, gap - CAR_STOP)) / this.r;
    this.s = this.leaving ? Math.max(0, this.s - dt * 1.5) : Math.min(1, this.s + dt * 1.2);
    if (this.leaving && this.s <= 0) { this.gone = true; this.d.group.remove(this.mesh); return; }
    this.mesh.position.set(Math.sin(this.a) * this.r, 0.12, Math.cos(this.a) * this.r);
    this.mesh.rotation.y = Math.atan2(this.dir * Math.cos(this.a), -this.dir * Math.sin(this.a));
    this.mesh.scale.setScalar(Math.max(0.001, this.s) * CAR_SCALE);
  }
}
// where a new car can join a lane: an angle at least CAR_GAP from every car on it, or null when the lane is full
function freeLaneAngle(lane, cars) {
  const on = cars.filter((c) => c.r === lane && !c.gone);
  for (let k = 0; k < 12; k++) {
    const a = Math.random() * TAU;
    if (on.every((c) => Math.abs(((a - c.a + Math.PI) % TAU + TAU) % TAU - Math.PI) * lane >= CAR_GAP)) return a;
  }
  return null;
}

// ---- building facades ----
function windowTextures(hue, seed, style) {
  const r = rng(seed);
  const base = new THREE.Color(hue);
  const css = '#' + base.getHexString();
  const glass = style === 'glass';
  const map = canvasTex(128, 64, (g, w, h) => {
    if (glass) {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#2c4a6b'); gr.addColorStop(1, '#16304f'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = css; g.globalAlpha = 0.35; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,.55)'; for (let x = 0; x <= w; x += 32) g.fillRect(x, 0, 2, h); g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
      g.fillStyle = 'rgba(190,230,255,.22)'; g.fillRect(4, 6, 40, 20);
    } else {
      g.fillStyle = css; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, h - 5, w, 5);
      g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, 0, w, 3);
      for (let i = 0; i < 3; i++) { const x = 10 + i * 40; g.fillStyle = '#28304a'; g.fillRect(x, 14, 28, 32); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(x, 14, 28, 3); g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(x - 2, 46, 32, 3); }
    }
  }, { repeat: true });
  const lit = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    if (glass) { for (let x = 0; x < w; x += 32) if (r() < 0.6) { g.fillStyle = r() > 0.4 ? '#cfefff' : '#ffe2b0'; g.fillRect(x + 4, 6, 26, h - 12); } }
    else for (let i = 0; i < 3; i++) if (r() < 0.65) { const x = 10 + i * 40; g.fillStyle = r() > 0.25 ? '#ffd9a0' : '#a9e8ff'; g.fillRect(x + 2, 17, 24, 28); }
  }, { repeat: true });
  return { map, lit };
}
function facadeBox(d, w, floors, depth, hue, seed, style) {
  const { map, lit } = windowTextures(hue, seed, style);
  const cols = Math.max(1, Math.round(w / 1.15));
  map.repeat.set(cols, floors); lit.repeat.set(cols, floors);
  const m = new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap: lit, emissiveIntensity: 0.08, roughness: style === 'glass' ? 0.25 : 0.75, metalness: style === 'glass' ? 0.35 : 0 });
  const entry = { m, dayI: 0.06, nightI: 1.55, dim: 1 }; nightLit.push(entry); d.windowLit.push(entry);
  const cap = stdMat(new THREE.Color(hue).multiplyScalar(0.55).getHex());
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, floors * FLOOR_H, depth).translate(0, floors * FLOOR_H / 2, 0), [m, m, cap, cap, m, m]);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function shiftHue(hex, dh, ds = 0, dl = 0) {
  const c = new THREE.Color(hex), hsl = {}; c.getHSL(hsl);
  return c.setHSL((hsl.h + dh + 1) % 1, clamp(hsl.s + ds, 0, 1), clamp(hsl.l + dl, 0, 1)).getHex();
}

// Each builder returns a group whose front (+z) faces the road; height = how tall it ends up. Footprints are BS
// times their first size; a ground floor is GROUND_H tall and its door DOOR_H, so a Skybot fits through it.
function buildPark(d, r) {
  const g = new THREE.Group(), K = 0.9; // the park stays about its first size: it fits between the sidewalk and the rim
  const lawn = new THREE.Mesh(new THREE.CylinderGeometry(1.5 * K, 1.6 * K, 0.14, 22), stdMat(0x77c766)); lawn.position.y = 0.07; lawn.receiveShadow = true; g.add(lawn);
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(0.55 * K, 0.55 * K, 0.05, 22), new THREE.MeshStandardMaterial({ color: 0x7fd3f0, emissive: 0x2a7ab8, emissiveIntensity: 0.45, roughness: 0.12, metalness: 0.2 }));
  pond.position.set(0.5 * K, 0.15, -0.25 * K); g.add(pond);
  for (const [x, z, s] of [[-0.75, 0.45, 0.75], [-0.35, -0.85, 0.9], [0.95, 0.75, 0.6]]) { const t = makeTree(r, s * 1.35, 0.05); t.position.set(x * K, 0.12, z * K); g.add(t); }
  const bench = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.12, 0.4, 2, 0.05), stdMat(0xa8754f)); bench.position.set(0.25 * K, 0.42, 1.05 * K); bench.castShadow = true; g.add(bench);
  const flowers = [0xff7aa8, 0xffd43b, 0xb197fc, 0xff8787, 0x74c0fc];
  for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(RG_FLOWER, stdMat(flowers[i % 5])); const a = r() * TAU, rr = (0.9 + r() * 0.45) * K; f.position.set(Math.cos(a) * rr, 0.2, Math.sin(a) * rr); g.add(f); }
  return { group: g, height: 3.2, w: 3.2 * K, depth: 3.2 * K };
}
const RG_FLOWER = new THREE.SphereGeometry(0.07, 6, 4);
function buildCafe(d, r) {
  const g = new THREE.Group(), hue = d.hue, W = 2.2 * BS, D = 1.6 * BS, front = D / 2;
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, GROUND_H, D, 2, 0.1), stdMat(0xf6efe2)); body.position.y = GROUND_H / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.18, D + 0.2), stdMat(shiftHue(hue, 0, 0, -0.18))); roof.position.y = GROUND_H + 0.09; roof.castShadow = true; g.add(roof);
  const sw = W / 6;
  for (let i = 0; i < 6; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.05, 0.85), stdMat(i % 2 ? 0xffffff : hue)); st.position.set(-W / 2 + sw / 2 + i * sw, GROUND_H - 0.22, front + 0.36); st.rotation.x = 0.38; st.castShadow = true; g.add(st); }
  const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.1), glowMat(0xffd59a, 0.35, 2.2, { base: 0x3a2c1a })); win.position.set(-0.65, 1.25, front + 0.005); g.add(win);
  const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.05), stdMat(0x5a3e2b)); door.position.set(0.7, DOOR_H / 2, front + 0.02); g.add(door);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.34), glowMat(hue, 0.7, 2.4, { base: 0x222222 })); sign.position.set(0, GROUND_H + 0.42, front + 0.1); g.add(sign);
  for (const x of [-0.85, 0.85]) {
    const z = front + 0.7; // on the sidewalk, clear of the road
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 12), stdMat(0xffffff)); top.position.set(x, 0.75, z); g.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), stdMat(0x2c3142)); leg.position.set(x, 0.375, z); g.add(leg);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6), stdMat(0x2c3142)); pole.position.set(x, 1.5, z); g.add(pole);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.32, 8), stdMat(x < 0 ? hue : 0xffffff)); umb.position.set(x, 2.3, z); umb.castShadow = true; g.add(umb);
  }
  return { group: g, height: GROUND_H + 0.7, w: 3.1, depth: 2.6 };
}
function buildShop(d, r, seed) {
  const g = new THREE.Group(), hue = shiftHue(d.hue, (r() - 0.5) * 0.12, 0, 0.12), W = 2.2 * BS, D = 1.7 * BS, front = D / 2;
  const floors = seed % 2; // floors above the shop
  const ground = new THREE.Mesh(new RoundedBoxGeometry(W, GROUND_H, D, 2, 0.08), stdMat(shiftHue(hue, 0, -0.2, 0.2))); ground.position.y = GROUND_H / 2; ground.castShadow = true; ground.receiveShadow = true; g.add(ground);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), glowMat(0xdff6ff, 0.4, 2.0, { base: 0x22303e })); display.position.set(-0.6, 1.15, front + 0.005); g.add(display);
  const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.05), stdMat(0x2c3142)); door.position.set(0.75, DOOR_H / 2, front + 0.02); g.add(door);
  const board = new THREE.Mesh(new THREE.BoxGeometry(W - 0.35, 0.36, 0.1), glowMat(d.hue, 0.8, 2.6, { base: 0x222222 })); board.position.set(0, GROUND_H - 0.2, front + 0.06); g.add(board);
  let h = GROUND_H;
  if (floors) { const up = facadeBox(d, W, floors, D, hue, seed, 'brick'); up.position.y = GROUND_H; g.add(up); h += floors * FLOOR_H; }
  for (const x of [-0.65, 0.58]) { const ac = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.29, 0.47), stdMat(0xc9cedb)); ac.position.set(x, h + 0.145, -0.26); ac.castShadow = true; g.add(ac); }
  return { group: g, height: h + 0.4, w: 3.1, depth: 2.6 };
}
// a lobby a Skybot can walk into: a plain ground floor with a door in the middle and lit glass either side
function lobby(g, W, D, color, glass) {
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, GROUND_H, D), stdMat(color)); body.position.y = GROUND_H / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
  const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.05), stdMat(0x2c3142)); door.position.set(0, DOOR_H / 2, D / 2 + 0.02); g.add(door);
  const pw = W / 2 - DOOR_W / 2 - 0.35; // glass from just beside the door to just short of the corner
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, 1.4), glass); p.position.set(s * (DOOR_W / 2 + 0.2 + pw / 2), 1.35, D / 2 + 0.005); g.add(p); }
}
function buildApartment(d, r, seed) {
  const g = new THREE.Group(), hue = shiftHue(d.hue, (r() - 0.5) * 0.2, -0.05, 0.08), W = 2.3 * BS, D = 1.9 * BS;
  const floors = 1 + (seed % 3); // above the lobby
  lobby(g, W, D, shiftHue(hue, 0, -0.15, 0.18), glowMat(0xffe2b0, 0.3, 2.2, { base: 0x3a3226 }));
  const body = facadeBox(d, W, floors, D, hue, seed, 'brick'); body.position.y = GROUND_H; g.add(body);
  const rail = stdMat(0xf2f2f2);
  for (let f = 0; f < floors; f++) for (const x of [-0.78, 0.78]) {
    const y = GROUND_H + f * FLOOR_H;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.07, 0.4), rail); b.position.set(x, y + 0.04, D / 2 + 0.2); b.castShadow = true; g.add(b);
    const rr = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.28, 0.04), rail); rr.position.set(x, y + 0.21, D / 2 + 0.38); g.add(rr);
  }
  const top = GROUND_H + floors * FLOOR_H;
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.65, 12), stdMat(0x9a7b5f)); tank.position.set(0.58, top + 0.72, -0.39); tank.castShadow = true; g.add(tank);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.43, 0.29, 12), stdMat(0x6d5541)); cap.position.set(0.58, top + 1.19, -0.39); g.add(cap);
  for (const [x, z] of [[0.32, -0.65], [0.84, -0.65], [0.32, -0.13], [0.84, -0.13]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4), stdMat(0x3a3f4f)); l.position.set(x, top + 0.2, z); g.add(l); }
  return { group: g, height: top + 1.4, w: 3.25, depth: 2.85 };
}
function buildTall(d, r, seed) {
  const g = new THREE.Group(), hue = shiftHue(d.hue, 0.5 + (r() - 0.5) * 0.15, -0.2, 0.05), W = 1.9 * BS;
  const floors = 3 + (seed % 4); // above the lobby
  lobby(g, W, W, 0xdfe5ee, glowMat(0xcfefff, 0.35, 2.2, { base: 0x22344a }));
  const body = facadeBox(d, W, floors, W, hue, seed, 'glass'); body.position.y = GROUND_H; g.add(body);
  const top = GROUND_H + floors * FLOOR_H;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.26, W + 0.2), stdMat(0xe9edf5)); crown.position.y = top + 0.13; crown.castShadow = true; g.add(crown);
  const glow = new THREE.Mesh(new THREE.BoxGeometry(W + 0.24, 0.07, W + 0.24), glowMat(d.hue, 0.8, 2.8)); glow.position.y = top + 0.02; g.add(glow);
  if (seed % 2) {
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.09, 2.0, 6), stdMat(0xd0d4de)); spire.position.y = top + 1.26; g.add(spire);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glowMat(0xff5050, 1.5, 3.2)); tip.position.y = top + 2.3; g.add(tip);
  } else {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.08, 20), stdMat(0x3b4152)); pad.position.y = top + 0.3; g.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 4, 28).rotateX(Math.PI / 2), glowMat(0xffd43b, 0.8, 2.6)); ring.position.y = top + 0.35; g.add(ring);
  }
  return { group: g, height: top + 2.4, w: 2.7, depth: 2.7 };
}
const BUILDERS = { park: buildPark, cafe: buildCafe, shop: buildShop, apartment: buildApartment, tower: buildTall };

// a tower crane and scaffolding, shown while a lot is under construction
function makeCrane(h) {
  const g = new THREE.Group(), yellow = stdMat(0xf2c230), dark = stdMat(0x2c3142);
  const mastH = h + 2.2;
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.16, mastH, 0.16), yellow); mast.position.y = mastH / 2; mast.castShadow = true; g.add(mast);
  const jib = new THREE.Group(); jib.position.y = mastH; g.add(jib);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.12), yellow); arm.position.x = 0.9; arm.castShadow = true; jib.add(arm);
  const weight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), dark); weight.position.x = -0.6; jib.add(weight);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), stdMat(0xffffff)); cab.position.y = -0.2; jib.add(cab);
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.6, 0.02), dark); cable.position.set(2.2, -0.8, 0); jib.add(cable);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), dark); hook.position.set(2.2, -1.65, 0); jib.add(hook);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), glowMat(0xff5050, 1.5, 3)); light.position.set(2.5, 0.12, 0); jib.add(light);
  g.userData.jib = jib;
  return g;
}

// the district's gate, facing City Hall
function makeGate(d) {
  const g = new THREE.Group(); g.position.set(0, 0.1, -LOT_R); g.scale.setScalar(1.4); // city scale: a Skybot walks under it with room to spare
  const stone = stdMat(0xf3ede2);
  for (const x of [-1.55, 1.55]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.7, 0.4), stone); p.position.set(x, 1.35, 0); p.castShadow = true; g.add(p);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.44), stdMat(d.hue)); band.position.set(x, 2.1, 0); g.add(band);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), glowMat(0xffd08a, 0.4, 3, { base: 0xfff1d0 })); lamp.position.set(x, 2.82, 0); g.add(lamp);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.55, 0.42), stdMat(shiftHue(d.hue, 0, 0, -0.12))); beam.position.y = 2.75; beam.castShadow = true; g.add(beam);
  d.signTex = canvasTex(512, 72, () => {});
  const signMat = new THREE.MeshBasicMaterial({ map: d.signTex, toneMapped: false });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 0.46), signMat); p.position.set(0, 2.75, s * 0.215); if (s < 0) p.rotation.y = Math.PI; g.add(p); }
  return g;
}
function drawGateSign(d) {
  const t = d.signTex; if (!t) return;
  const g = t.userData.ctx, c = t.userData.canvas, name = d.displayName().toUpperCase();
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#141a2e'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = hexCss(d.hue); g.fillRect(0, c.height - 6, c.width, 6);
  let size = 40; g.font = `700 ${size}px Unbounded, "Arial Black", sans-serif`;
  while (g.measureText(name).width > c.width - 40 && size > 16) { size -= 2; g.font = `700 ${size}px Unbounded, "Arial Black", sans-serif`; }
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, c.width / 2, c.height / 2 - 2);
  t.needsUpdate = true;
}

// the scrolling news billboard on the HQ roof: what this district is working on
function makeBillboard(d) {
  const g = new THREE.Group(); g.position.set(0, 0.22, 1.22);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.2, 0.12), stdMat(0x232838)); frame.position.y = 1.32; frame.castShadow = true; g.add(frame);
  for (const x of [-1.3, 1.3]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), stdMat(0x232838)); p.position.set(x, 0.37, -0.02); g.add(p); }
  d.boardMat = new THREE.MeshBasicMaterial({ toneMapped: false, color: 0xffffff });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.0), d.boardMat); screen.position.set(0, 1.32, 0.065); screen.userData.keep = true; g.add(screen);
  return g;
}
function drawBillboard(d, text) {
  const H = 128, pad = 60;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '600 58px "Martian Mono", ui-monospace, monospace';
  const seg = `${text}   ✦   `;
  const w = Math.min(4096, Math.ceil(probe.measureText(seg).width) + pad);
  if (d.boardTex) d.boardTex.dispose();
  d.boardTex = canvasTex(w, H, (g) => {
    g.fillStyle = '#0b1020'; g.fillRect(0, 0, w, H);
    g.fillStyle = 'rgba(106,230,245,.08)'; for (let y = 0; y < H; y += 6) g.fillRect(0, y, w, 2);
    g.font = '600 58px "Martian Mono", ui-monospace, monospace'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd27d'; g.fillText(seg, pad / 2, H / 2 + 3);
  }, { repeat: true });
  d.boardTex.repeat.set((H * (3.6 / 1.0)) / w, 1);
  d.boardMat.map = d.boardTex; d.boardMat.needsUpdate = true;
}
