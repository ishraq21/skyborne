
// =====================================================================
// districts: one floating island per Claude Code session
// =====================================================================
// The plaza and what stands on it are spread out (bots and desks keep their size), so the aisles fit a bot.
// The HQ stands behind the desks: its front face is at TOWER_Z + HQ_D / 2, and DOOR just in front of it.
const DESKS = [[0, 3.9], [-3.3, 3.45], [3.3, 3.45], [-1.65, 0.55], [1.65, 0.55], [-4.95, 0.7], [4.95, 0.7]];
const TOWER_Z = -4.6, HQ_W = 6.0, HQ_D = 3.9, HQ_FLOOR_H = 1.6;
const DOOR = new THREE.Vector3(0, 0, TOWER_Z + HQ_D / 2 + 0.1);
const PAD = new THREE.Vector3(-6.25, 0, -2.9);
const KIOSK = new THREE.Vector3(6.25, 0, -3.0), KIOSK_ROT = -0.5;
const BENCH = { x: 5.6, z: -1.0, rot: -1.2 };
const PLAZA_Z = 1.4, PLAZA_R = 7.2, PLAZA_TOP = 0.12, PAD_R = 0.95, PAD_TOP = 0.18;
const ISLAND_R = 16;
const RING1_R = 46, RING_STEP = 40;

function spreadOrder(n) {
  const chosen = [0];
  while (chosen.length < n) {
    let best = -1, bestD = -1;
    for (let i = 0; i < n; i++) {
      if (chosen.includes(i)) continue;
      let d = Infinity; for (const c of chosen) { const k = Math.abs(i - c); d = Math.min(d, Math.min(k, n - k)); }
      if (d > bestD) { bestD = d; best = i; }
    }
    chosen.push(best);
  }
  return chosen;
}
const _orders = {};
// the ground a bot stands on, in district space: the spawn pad and the plaza sit above the grass
// (a foot over the plaza's edge counts as on it). On grass, the top of its bumps (they reach 0.075),
// so feet and shadow stay out of it.
const GRASS_TOP = 0.07;
function groundAt(x, z) {
  if (Math.hypot(x - PAD.x, z - PAD.z) < PAD_R + 0.05) return PAD_TOP;
  if (Math.hypot(x, z - PLAZA_Z) < PLAZA_R + 0.15) return PLAZA_TOP;
  return GRASS_TOP;
}
function slotPosition(slot) {
  let ring = 1, start = 0;
  while (slot >= start + 6 * ring) { start += 6 * ring; ring++; }
  const n = 6 * ring, order = (_orders[n] ||= spreadOrder(n));
  const a = (order[slot - start] / n) * TAU + (ring - 1) * 0.26 + 0.52;
  const R = RING1_R + (ring - 1) * RING_STEP;
  return { x: Math.sin(a) * R, z: Math.cos(a) * R, a, ring };
}

// =====================================================================
// the walk map: where a Skybot can stand, and its paths around desks, buildings, trees and other bots
// =====================================================================
// A grid of WALK_CELL squares over the island, in district space. Every obstacle grows by a bot's radius (BOT_R), so a
// bot's middle may stand in any open cell (0). The furniture every district shares is drawn once (walkBase); each
// district copies it and adds its own trees. A door lane (2) is open: it reaches into a doorway, so a bot can walk up
// to the door. Bots keep inside the ring road.
const WALK_CELL = 0.25, WALK_N = 128, WALK_HALF = WALK_N * WALK_CELL / 2, BOT_R = 0.45, BOT_GAP = 0.85;
const cellOf = (v) => Math.floor((v + WALK_HALF) / WALK_CELL);
const cellMid = (i) => -WALK_HALF + (i + 0.5) * WALK_CELL;
// what's in the way, as it stands: circles { x, z, r } and boxes { x, z, hw, hd, rot } (half sizes; turned like rotation.y)
function walkShapes() {
  const s = DESKS.map(([x, z]) => ({ x, z, hw: 0.725, hd: 0.31, rot: 0 }));
  for (const h of HOMES) { const c = houseAt(h.a, 0, 0); s.push({ x: c.x, z: c.z, hw: HOME_W / 2, hd: HOME_D / 2, rot: h.a }); }
  s.push({ x: 0, z: TOWER_Z, hw: HQ_W / 2, hd: HQ_D / 2, rot: 0 }, { x: KIOSK.x, z: KIOSK.z, hw: 0.65, hd: 0.4, rot: KIOSK_ROT },
    { x: BENCH.x, z: BENCH.z, hw: 0.75, hd: 0.24, rot: BENCH.rot },
    // behind the kiosk, out to the road: too tight for two bots to pass, so nobody walks round there
    { x: KIOSK.x + 1.0, z: KIOSK.z - 0.6, r: 0.9 });
  return s;
}
// how far (x, z) is from a shape's edge (below 0: inside it)
function shapeDist(s, x, z) {
  const dx = x - s.x, dz = z - s.z;
  if (s.r !== undefined) return Math.hypot(dx, dz) - s.r;
  const c = Math.cos(s.rot), n = Math.sin(s.rot), lx = c * dx - n * dz, lz = n * dx + c * dz; // into the box's own frame
  const ox = Math.abs(lx) - s.hw, oz = Math.abs(lz) - s.hd;
  return ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz);
}
function blockShape(m, s) {
  const reach = (s.r ?? Math.hypot(s.hw, s.hd)) + BOT_R;
  const i0 = Math.max(0, cellOf(s.x - reach)), i1 = Math.min(WALK_N - 1, cellOf(s.x + reach));
  const j0 = Math.max(0, cellOf(s.z - reach)), j1 = Math.min(WALK_N - 1, cellOf(s.z + reach));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (shapeDist(s, cellMid(i), cellMid(j)) < BOT_R) m[j * WALK_N + i] = 1;
}
const WALK_EDGE = ROAD_IN - 0.2 - BOT_R; // on the plaza side, a bot's middle keeps inside the road and its kerb
// where a bot may walk: the plaza side of the road; the zebra crossing and, in line with it, the gap between the middle
// cottages; and the path along the island's edge in front of their doors (the cottages themselves are shapes in the
// way, and close off the rest of the home row from the road)
function walkOpen(x, z) {
  const r = Math.hypot(x, z);
  if (r <= WALK_EDGE) return true;
  if (z > 0 && Math.abs(x) <= CROSS_W / 2 - 0.35 && r <= RIM_WALK) return true; // wide enough for two bots to pass
  return r >= ROAD_OUT + 0.4 && r <= RIM_WALK && Math.abs(Math.atan2(x, z)) <= HOME_SPAN;
}
// a house's frame, from district space: x across its front, z out of its front
function inHouse(h, x, z) {
  const c = houseAt(h.a, 0, 0), dx = x - c.x, dz = z - c.z;
  return { lx: dx * Math.cos(h.a) - dz * Math.sin(h.a), lz: dx * Math.sin(h.a) + dz * Math.cos(h.a) };
}
// on the zebra crossing, or within `kerb` of it on either side
function onCrossing(x, z, kerb) {
  const r = Math.hypot(x, z);
  return z > 0 && Math.abs(x) < CROSS_W / 2 + 0.4 && r > ROAD_IN - kerb && r < ROAD_OUT + kerb;
}
let walkBase = null;
function makeWalkMap(trees) {
  if (!walkBase) {
    walkBase = new Uint8Array(WALK_N * WALK_N);
    for (let j = 0; j < WALK_N; j++) for (let i = 0; i < WALK_N; i++) if (!walkOpen(cellMid(i), cellMid(j))) walkBase[j * WALK_N + i] = 1;
    for (const sh of walkShapes()) blockShape(walkBase, sh);
    // door lanes: from the plaza into the HQ's doorway, and from the pavement into each house's front door
    for (let j = cellOf(DOOR.z - 0.2); j <= cellOf(DOOR.z + BOT_R + 0.1); j++) for (let i = cellOf(-0.4); i <= cellOf(0.4); i++) walkBase[j * WALK_N + i] = 2;
    for (const h of HOMES) {
      const c = houseAt(h.a, 0, 0), i0 = cellOf(c.x - 2.5), j0 = cellOf(c.z - 2.5);
      for (let j = j0; j <= j0 + 20; j++) for (let i = i0; i <= i0 + 20; i++) {
        const { lx, lz } = inHouse(h, cellMid(i), cellMid(j));
        if (Math.abs(lx - h.doorX) <= 0.4 && lz >= HOME_D / 2 - 0.45 && lz <= HOME_D / 2 + 0.55) walkBase[j * WALK_N + i] = 2;
      }
    }
  }
  const m = walkBase.slice();
  for (const t of trees) blockShape(m, t);
  // shut the little pockets no bot can walk into (between the kiosk and the bench, say): only cells reachable from the
  // middle of the plaza stay open, so a bot nudged aside can't land in one
  const seen = new Uint8Array(WALK_N * WALK_N), todo = [cellOf(PLAZA_Z) * WALK_N + cellOf(0)];
  seen[todo[0]] = 1;
  while (todo.length) {
    const c = todo.pop(), i = c % WALK_N, j = (c / WALK_N) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, n = b * WALK_N + a;
      if (a >= 0 && b >= 0 && a < WALK_N && b < WALK_N && !seen[n] && m[n] !== 1) { seen[n] = 1; todo.push(n); }
    }
  }
  for (let c = 0; c < m.length; c++) if (!seen[c]) m[c] = 1;
  return m;
}
function walkCell(d, x, z) {
  const i = cellOf(x), j = cellOf(z);
  return i < 0 || j < 0 || i >= WALK_N || j >= WALK_N ? 1 : d.walk[j * WALK_N + i];
}
function walkable(d, x, z) { return walkCell(d, x, z) !== 1; }
// the open cell nearest cell (i, j), as an index (-1: none within a few metres)
function nearestOpen(m, i, j) {
  const ok = (a, b) => a >= 0 && b >= 0 && a < WALK_N && b < WALK_N && m[b * WALK_N + a] !== 1;
  if (ok(i, j)) return j * WALK_N + i;
  for (let r = 1; r <= 12; r++) {
    let best = -1, bd = Infinity;
    for (let b = j - r; b <= j + r; b++) for (let a = i - r; a <= i + r; a++) {
      if (Math.max(Math.abs(a - i), Math.abs(b - j)) !== r || !ok(a, b)) continue;
      const dd = (a - i) ** 2 + (b - j) ** 2; if (dd < bd) { bd = dd; best = b * WALK_N + a; }
    }
    if (best >= 0) return best;
  }
  return -1;
}
// a copy of walk map m with the places in `at` shut within r of them (other bots, and where they're headed)
function withBots(m, at, r) {
  const out = m.slice(), N = WALK_N;
  for (const p of at) {
    const i0 = Math.max(0, cellOf(p.x - r)), i1 = Math.min(N - 1, cellOf(p.x + r)), j0 = Math.max(0, cellOf(p.z - r)), j1 = Math.min(N - 1, cellOf(p.z + r));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (out[j * N + i] !== 1 && Math.hypot(cellMid(i) - p.x, cellMid(j) - p.z) < r) out[j * N + i] = 1;
  }
  return out;
}
// is the straight line from (ax, az) to (bx, bz) open all the way? Every cell it passes through is checked (where it
// passes exactly through a corner, both cells beside it too), past the one it starts in
function walkLine(m, ax, az, bx, bz) {
  const g = (v) => (v + WALK_HALF) / WALK_CELL, x0 = g(ax), z0 = g(az), x1 = g(bx), z1 = g(bz);
  const dx = x1 - x0, dz = z1 - z0, si = Math.sign(dx), sj = Math.sign(dz);
  const tdx = si ? 1 / Math.abs(dx) : Infinity, tdz = sj ? 1 / Math.abs(dz) : Infinity;
  let i = Math.floor(x0), j = Math.floor(z0);
  const iEnd = Math.floor(x1), jEnd = Math.floor(z1);
  let tx = si > 0 ? (i + 1 - x0) * tdx : si < 0 ? (x0 - i) * tdx : Infinity, tz = sj > 0 ? (j + 1 - z0) * tdz : sj < 0 ? (z0 - j) * tdz : Infinity;
  const blocked = (a, b) => a < 0 || b < 0 || a >= WALK_N || b >= WALK_N || m[b * WALK_N + a] === 1;
  for (let k = Math.abs(iEnd - i) + Math.abs(jEnd - j) + 2; k > 0 && (i !== iEnd || j !== jEnd); k--) {
    if (Math.abs(tx - tz) < 1e-9) { if (blocked(i + si, j) || blocked(i, j + sj)) return false; i += si; j += sj; tx += tdx; tz += tdz; }
    else if (tx < tz) { i += si; tx += tdx; } else { j += sj; tz += tdz; }
    if (blocked(i, j)) return false;
  }
  return true;
}
// A* over the grid's 8 neighbours (never cutting a blocked corner), with straight-line distance as the guess. Its
// buffers are shared: a cell's cost counts only when it was reached in this search (seen === gen).
const AS = { cost: new Float32Array(WALK_N * WALK_N), came: new Int32Array(WALK_N * WALK_N), seen: new Uint32Array(WALK_N * WALK_N), done: new Uint32Array(WALK_N * WALK_N), gen: 0 };
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
// A path for a bot in district d from `from` to `to`: waypoints in order, the last one `to` (or the open place nearest
// it). Null when there's no way through. avoid: where other bots stand (it keeps BOT_GAP from them; a start or goal
// that close to one moves to the nearest open place).
function walkPath(d, from, to, avoid = []) {
  const N = WALK_N;
  let m = d.walk;
  if (avoid.length) m = withBots(m, avoid, BOT_GAP);
  const s = nearestOpen(m, cellOf(from.x), cellOf(from.z)), g = nearestOpen(m, cellOf(to.x), cellOf(to.z));
  if (s < 0 || g < 0) return null;
  const end = m[cellOf(to.z) * N + cellOf(to.x)] !== 1 ? { x: to.x, z: to.z } : { x: cellMid(g % N), z: cellMid((g / N) | 0) };
  if (s === g) return [end];
  const gen = ++AS.gen, gi = g % N, gj = (g / N) | 0;
  const hF = [], hN = []; // a binary heap of cells by cost so far plus the guess
  const push = (f, n) => { let k = hF.length; hF.push(f); hN.push(n); while (k > 0) { const p = (k - 1) >> 1; if (hF[p] <= f) break; hF[k] = hF[p]; hN[k] = hN[p]; k = p; } hF[k] = f; hN[k] = n; };
  const pop = () => {
    const top = hN[0], lf = hF.pop(), ln = hN.pop();
    if (hF.length) { let k = 0; for (;;) { let c = 2 * k + 1; if (c >= hF.length) break; if (c + 1 < hF.length && hF[c + 1] < hF[c]) c++; if (hF[c] >= lf) break; hF[k] = hF[c]; hN[k] = hN[c]; k = c; } hF[k] = lf; hN[k] = ln; }
    return top;
  };
  AS.cost[s] = 0; AS.seen[s] = gen; AS.came[s] = -1; push(0, s);
  let found = false;
  for (let spent = 0; hF.length && spent < 9000; spent++) {
    const c = pop();
    if (AS.done[c] === gen) continue;
    AS.done[c] = gen;
    if (c === g) { found = true; break; }
    const ci = c % N, cj = (c / N) | 0;
    for (const [di, dj, w] of NB) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = nj * N + ni;
      if (m[n] === 1 || AS.done[n] === gen) continue;
      if (di && dj && (m[cj * N + ni] === 1 || m[nj * N + ci] === 1)) continue;
      const cost = AS.cost[c] + w;
      if (AS.seen[n] === gen && cost >= AS.cost[n]) continue;
      AS.seen[n] = gen; AS.cost[n] = cost; AS.came[n] = c;
      push(cost + Math.hypot(ni - gi, nj - gj), n);
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = g; c !== -1; c = AS.came[c]) cells.push(c);
  cells.reverse();
  // pull the path straight: from each corner, on to the farthest cell still in plain sight
  const out = [];
  const fromOpen = m[cellOf(from.z) * N + cellOf(from.x)] !== 1;
  let ax = fromOpen ? from.x : cellMid(s % N), az = fromOpen ? from.z : cellMid((s / N) | 0);
  if (ax !== from.x || az !== from.z) out.push({ x: ax, z: az });
  // (the last one is the end itself, which may sit anywhere in the goal's cell)
  const pt = (t) => t === cells.length - 1 ? end : { x: cellMid(cells[t] % N), z: cellMid((cells[t] / N) | 0) };
  let k = 0;
  while (k < cells.length - 1) {
    let far = k + 1;
    for (let t = cells.length - 1; t > k + 1; t--) { const q = pt(t); if (walkLine(m, ax, az, q.x, q.z)) { far = t; break; } }
    k = far;
    if (k === cells.length - 1) break;
    const q = pt(k); ax = q.x; az = q.z; out.push(q);
  }
  out.push(end);
  return out;
}
// at most 4 paths are worked out each frame (the rest wait a frame), so a crowd starting at once can't stall one
const walkBudget = { t: -1, n: 0 };
function mayPlanWalk() { if (walkBudget.t !== clockT.now) { walkBudget.t = clockT.now; walkBudget.n = 0; } return walkBudget.n++ < 4; }

// Places a bot can be sent to stand, each held by one bot at a time (District.claimSpot): idle spots around the plaza
// and by the kiosk, spots beside the pad where finished helpers wait, and spare spots for a bot when every desk is
// taken (none in the aisles between desks, where a bot standing would block the way). face: which way the bot looks
// there (null: its own idle look). FAN: where a helper stands to hand its result
// to the lead, around the lead.
const toKiosk = (x, z) => Math.atan2(KIOSK.x - x, KIOSK.z - z);
const SPOT_PLACES = {
  idle: [...IDLE_SPOTS.map(([x, z]) => ({ x, z, face: null })), { x: 4.3, z: -1.2, face: toKiosk(4.3, -1.2) }], // (a bot by the kiosk may have a coffee)
  pad: [[1.1, 1.3], [2.2, 0.5], [0.1, 2.3], [2.2, 1.9]].map(([x, z]) => ({ x: PAD.x + x, z: PAD.z + z, face: 0.4 })),
  spare: [[0, 5.6], [-3.3, 5.4], [3.3, 5.4], [-6.4, 2.6], [6.4, 2.6]].map(([x, z]) => ({ x, z, face: Math.PI })), // round the plaza's edge, out of the aisles
};
const FAN = [[1.3, 0.35], [-1.3, 0.35], [1.2, -0.9], [-1.2, -0.9], [0, -1.3]];
// where helpers beam in: the pad, then around it when several arrive at once (then wherever's clear nearest it)
const ARRIVALS = [{ x: PAD.x, z: PAD.z }, ...Array.from({ length: 6 }, (_, k) => ({ x: PAD.x + Math.sin(k * TAU / 6) * 1.1, z: PAD.z + Math.cos(k * TAU / 6) * 1.1 }))];

function facadeTextures(hue, seed) {
  const r = rng(seed);
  const base = new THREE.Color(hue).lerp(new THREE.Color(0xffffff), 0.28);
  const css = '#' + base.getHexString();
  const map = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = css; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, h - 6, w, 6);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, 0, w, 3);
    for (let i = 0; i < 5; i++) { const x = 14 + i * 48; g.fillStyle = '#2a3048'; g.fillRect(x, 14, 34, 34); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x, 14, 34, 3); }
  });
  const lit = [];
  for (let v = 0; v < 3; v++) {
    lit.push(canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 5; i++) {
        if (r() < 0.62) { const x = 14 + i * 48; const warm = r() > 0.25; g.fillStyle = warm ? '#ffd9a0' : '#a9e8ff'; g.fillRect(x + 2, 17, 30, 29); }
      }
    }));
  }
  return { map, lit };
}

class District {
  constructor(id, slot, title) {
    this.id = id; this.slot = slot; this.title = title || id; this.isSample = String(id).startsWith('sample-');
    this.hue = DISTRICT_HUES[hash(this.title) % DISTRICT_HUES.length];
    this.seed = hash(id);
    const p = slotPosition(slot);
    this.home = new THREE.Vector3(p.x, 0, p.z);
    this.ring = p.ring; this.slotAngle = p.a;
    // camera/particle frame: n = up, t = outward from City Hall, side = across
    this.n = new THREE.Vector3(0, 1, 0); this.t = new THREE.Vector3(p.x, 0, p.z).normalize(); this.side = new THREE.Vector3().crossVectors(this.n, this.t);
    this.group = new THREE.Group();
    this.group.position.set(p.x, -95, p.z); // inside the cloud sea: it rises out of it
    this.group.rotation.y = p.a; // local +z faces away from City Hall
    this.rise = 0; this.leaving = false; this.dead = false;
    this.robots = new Map();
    this.floors = []; this.floorTarget = 2;
    this.resultCubes = [];
    this.doc = null; this.asleep = false; this.fresh = 'fresh';
    this.tokens = 0; this.tokenRate = 0; this._lastTok = null; this._lastTokT = 0;
    this.webT = 0; this.steamT = 0;
    this.windowLit = []; this.lots = []; this.builtLots = 0; this.devScore = 0; this.helperIds = new Set();
    this.cars = []; this.walkTrees = []; this.spotHolders = new Map(); this.fanHolders = [];
    this.lotItems = []; this.lotBake = null; this.lotsDirty = false; this.towerBake = null; this.bakedFloors = 0;
    this.billboardText = ''; this.signName = '';
    this.build();
    this.walk = makeWalkMap(this.walkTrees);
    scene.add(this.group);
  }

  build() {
    const G = this.group, r = rng(this.seed);
    const litStart = nightLit.length;
    this.base = makeIslandBase(ISLAND_R, this.seed); G.add(this.base); this.base.userData.bits.userData.keep = true;
    const plaza = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R, PLAZA_R, PLAZA_TOP, 48), stdMat(PAVE)); plaza.position.set(0, PLAZA_TOP / 2, PLAZA_Z); plaza.receiveShadow = true; G.add(plaza);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(PLAZA_R, 0.07, 6, 72).rotateX(Math.PI / 2), stdMat(this.hue)); edge.position.set(0, PLAZA_TOP, PLAZA_Z); G.add(edge);
    G.add(makeRoadRing());

    // the HQ tower (grows a floor as tokens burn)
    this.tower = new THREE.Group(); this.tower.position.set(0, 0.12, TOWER_Z); G.add(this.tower); this.tower.userData.keep = true;
    G.add(contactShadow(HQ_W * 1.3, HQ_D * 1.3, PLAZA_TOP + 0.03, 0, TOWER_Z)); // on G: the tower group is kept, so it would never bake
    const tex = facadeTextures(this.hue, this.seed);
    this.facadeMats = tex.lit.map((lt) => {
      const m = new THREE.MeshStandardMaterial({ map: tex.map, emissive: 0xffffff, emissiveMap: lt, emissiveIntensity: 0.1, roughness: 0.75 });
      const e = { m, dayI: 0.08, nightI: 1.7, dim: 1 }; nightLit.push(e); this.windowLit.push(e); return m;
    });
    this.capMat = stdMat(new THREE.Color(this.hue).multiplyScalar(0.62).getHex());
    this.floorGeo = new THREE.BoxGeometry(HQ_W, HQ_FLOOR_H, HQ_D).translate(0, HQ_FLOOR_H / 2, 0);
    for (let i = 0; i < 2; i++) this.addFloor(true);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, DOOR_H, 0.12), glowMat(0xffc878, 0.4, 2.2, { base: 0x1b1f30 }));
    door.position.set(0, DOOR_H / 2, HQ_D / 2); this.tower.add(door);
    const awning = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.8), stdMat(this.hue)); awning.position.set(0, DOOR_H + 0.12, HQ_D / 2 + 0.38); awning.castShadow = true; this.tower.add(awning);
    this.towerStatic = [door, awning];

    this.roof = new THREE.Group(); this.roof.scale.setScalar(1.3); this.tower.add(this.roof); // built at its first size, for the bigger floors
    const slab = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.22, 3.3), this.capMat); slab.position.y = 0.11; slab.castShadow = true; slab.receiveShadow = true; this.roof.add(slab);
    this.dish = new THREE.Group(); this.dish.position.set(1.35, 0.22, -0.75); this.roof.add(this.dish);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.55, 8), stdMat(0xc9cedb)); stand.position.y = 0.27; this.dish.add(stand);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 8, 0, TAU, 0, 1.0).rotateX(-0.9), stdMat(0xf0f2f7, { side: THREE.DoubleSide, metalness: 0.3, roughness: 0.4 })); bowl.position.y = 0.62; this.dish.add(bowl);
    const feed = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glowMat(0x6ae6f5, 1.2, 3)); feed.position.set(0, 0.95, 0.3); this.dish.add(feed);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.6, 6), stdMat(0xc9cedb)); ant.position.set(-1.65, 1.0, -1.05); this.roof.add(ant);
    this.aviation = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff8080, emissive: 0xff3030, emissiveIntensity: 2 })); this.aviation.position.set(-1.65, 1.85, -1.05); this.roof.add(this.aviation);
    const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.9, 10), stdMat(0x8e8a9c)); chim.position.set(-0.6, 0.55, -0.55); chim.castShadow = true; this.roof.add(chim);
    this.chimneyTop = new THREE.Object3D(); this.chimneyTop.position.set(-0.6, 1.05, -0.55); this.roof.add(this.chimneyTop);
    this.roof.add(makeBillboard(this));

    // desks with hologram screens
    this.desks = DESKS.map(([x, z], i) => {
      const d = new THREE.Group(); d.position.set(x, 0.12, z); G.add(d);
      const top = new THREE.Mesh(new RoundedBoxGeometry(1.45, 0.07, 0.62, 2, 0.025), stdMat(0xe8ecf3, { roughness: 0.5 })); top.position.y = 0.76; top.castShadow = true; top.receiveShadow = true; d.add(top);
      d.add(contactShadow(1.75, 0.85, 0.03));
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.025, 0.04), glowMat(this.hue, 0.6, 2.2)); strip.position.set(0, 0.76, 0.32); d.add(strip);
      for (const sx of [-0.62, 0.62]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.74, 0.5), stdMat(0x2c3142)); leg.position.set(sx, 0.37, 0); leg.castShadow = true; d.add(leg); }
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.5), screenMats.idle); screen.position.set(0, 1.06, 0.12); screen.rotation.x = -0.32; screen.renderOrder = 4; d.add(screen);
      screen.visible = false;
      return { group: d, screen, x, z, occupant: null, index: i };
    });

    // kiosk (coffee), spawn pad, trees, bench
    const kiosk = new THREE.Group(); kiosk.position.copy(KIOSK); G.add(kiosk);
    const kb = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.95, 0.8, 2, 0.12), stdMat(0xf3ede2)); kb.position.y = 0.48; kb.castShadow = true; kiosk.add(kb);
    kiosk.add(contactShadow(1.9, 1.35, 0.1));
    const kr = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 1.05), stdMat(this.hue)); kr.position.y = 2.5; kr.castShadow = true; kiosk.add(kr); // above a Skybot's head
    for (const sx of [-0.66, 0.66]) { const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.55, 6), stdMat(0x2c3142)); p2.position.set(sx, 1.72, 0.42); kiosk.add(p2); }
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.16, 10), stdMat(0xffffff)); cup.position.set(0.3, 1.03, 0.1); kiosk.add(cup);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), glowMat(0xffb547, 0.6, 2.4, { base: 0x3a2a12 })); sign.position.set(0, 2.33, 0.53); kiosk.add(sign);
    kiosk.rotation.y = KIOSK_ROT;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 32), stdMat(0x2a3044, { metalness: 0.5, roughness: 0.4 })); pad.position.copy(PAD).setY(0.12); pad.receiveShadow = true; G.add(pad);
    this.padRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 6, 40).rotateX(Math.PI / 2), glowMat(0x6ae6f5, 0.9, 2.6, { own: true })); this.padRing.position.copy(PAD).setY(0.2); G.add(this.padRing);
    for (const sx of [-1, 1]) {
      const sz = (0.95 + r() * 0.3) * 1.2, t = makeTree(r, sz); t.position.set(sx * (5.0 + r() * 0.3), 0, -5.3 - r() * 0.3); G.add(t);
      this.walkTrees.push({ x: t.position.x, z: t.position.z, r: 0.72 * sz }); // its branches, at a bot's height
    }
    const bench = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.16, 0.48, 2, 0.06), stdMat(0xa8754f)); bench.position.set(BENCH.x, 0.45, BENCH.z); bench.rotation.y = BENCH.rot; bench.castShadow = true; G.add(bench);
    const benchShadow = contactShadow(1.8, 0.75, PLAZA_TOP + 0.03, BENCH.x, BENCH.z); benchShadow.rotation.y = BENCH.rot; G.add(benchShadow);

    // street lamps on the sidewalk, trees on the outer edge, the gate
    // (no lamps by the home row: it reaches the sidewalk)
    for (const a of [1.1, -1.1, 1.83, -1.83, 2.48, -2.48]) { const l = makeLamp(); l.scale.setScalar(1.45); l.position.set(Math.sin(a) * WALK_R, 0.12, Math.cos(a) * WALK_R); G.add(l); }
    for (const a of [1.05, -1.05, 1.83, -1.83]) { const t = makeTree(r, (0.8 + r() * 0.35) * 1.4); const rr = 14.0 + r() * 0.5; t.position.set(Math.sin(a) * rr, 0, Math.cos(a) * rr); G.add(t); }
    G.add(makeGate(this));
    // the home row: still houses (baked with the rest) and the doors and windows that change (homeLights)
    for (const h of HOMES) { const c = houseAt(h.a, 0, 0), holder = new THREE.Group(); holder.position.set(c.x, 0.1, c.z); holder.rotation.y = h.a; holder.add(buildHouse(h.i)); G.add(holder); }
    this.homeLights = makeHomeLights(); this.homeLights.mesh.position.y = 0.1; G.add(this.homeLights.mesh);
    const glowE = { m: this.homeLights.mesh.material, dayI: 0.5, nightI: 1.9, dim: 1 }; nightLit.push(glowE); this.windowLit.push(glowE);
    this.homes = HOMES.map((h) => ({ ...h, holder: null }));

    // label above the tower
    const el = document.createElement('div'); el.className = 'dtag'; el.innerHTML = '<b></b><span></span>';
    this.labelEl = el; this.label = new CSS2DObject(el); this.label.position.set(0, 6, TOWER_Z); G.add(this.label);
    // picking target: the island top
    this.pickMesh = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, ISLAND_R, 1, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.pickMesh.userData.district = this; G.add(this.pickMesh);
    this.ownLit = nightLit.slice(litStart).filter((e) => !e.shared);
    // bake the still parts into a handful of meshes (the dish keeps turning)
    this.dish.userData.keep = true;
    mergeStatic(this.roof);
    mergeStatic(G);
  }
  // finished floors (plus the door and awning) become one mesh per material
  bakeTower() {
    const items = [];
    for (const m of [...this.floors, ...this.towerStatic]) { m.updateMatrix(); items.push([m, m.matrix.clone()]); if (m.parent) m.parent.remove(m); }
    if (this.towerBake) { this.tower.remove(this.towerBake); this.towerBake.traverse((o) => o.geometry?.dispose()); }
    this.towerBake = bakeItems(items); this.tower.add(this.towerBake);
    this.bakedFloors = this.floors.length;
  }
  // a finished building joins the district's baked buildings
  settleLot(lot) {
    if (lot.settled) return;
    lot.settled = true;
    const items = collectStatic(lot.holder, this.group);
    this.lotItems.push(...items); this.lotsDirty = true;
    freeGeometries(items);
  }
  rebakeLots() {
    if (this.lotBake) { this.group.remove(this.lotBake); this.lotBake.traverse((o) => o.geometry?.dispose()); }
    this.lotBake = bakeItems(this.lotItems); this.group.add(this.lotBake);
  }

  addFloor(instant) {
    const i = this.floors.length;
    const mats = [this.facadeMats[i % 3], this.facadeMats[(i + 1) % 3], this.capMat, this.capMat, this.facadeMats[(i + 2) % 3], this.facadeMats[i % 3]];
    const m = new THREE.Mesh(this.floorGeo, mats);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.s = instant ? 1 : 0;
    m.position.y = i * HQ_FLOOR_H; m.scale.y = m.userData.s || 0.0001;
    this.tower.add(m); this.floors.push(m);
  }

  // tokens burned -> floors: 50k=3, 125k=4, 310k=5, 780k=6, 2M=7, 5M=8, 12M=9
  floorsFor(tokens) {
    if (!tokens || tokens < 50_000) return 2;
    return 2 + clamp(Math.floor(Math.log(tokens / 50_000) / Math.log(2.5)) + 1, 1, 7);
  }

  // How built-up the district gets: prompts, tool calls and helpers all count,
  // and it never shrinks back while the session lives.
  develop(doc) {
    for (const a of doc.agents) if (a.parent) this.helperIds.add(a.id);
    const tools = doc.agents.reduce((s, a) => s + (a.tools || 0), 0);
    const score = (doc.turns || 0) * 4 + tools / 3 + this.helperIds.size * 3 + (doc.turns ? 0 : doc.feed.length / 2);
    this.devScore = Math.max(this.devScore, score);
    return LOT_STEPS.filter((s) => s <= this.devScore).length;
  }
  buildLot(i, instant) {
    const lot = LOTS[i], r = rng(this.seed + i * 97), seed = (this.seed >>> 3) + i * 13;
    const made = BUILDERS[lot.type](this, r, seed);
    const holder = new THREE.Group();
    holder.position.set(Math.sin(lot.a) * LOT_R, 0.1, Math.cos(lot.a) * LOT_R);
    holder.rotation.y = lot.a + Math.PI; // front faces the road
    holder.add(made.group); this.group.add(holder);
    if (lot.type !== 'park') holder.add(contactShadow(made.w * 1.3, made.depth * 1.3, 0.02)); // the lot sits 0.1 up, over grass
    const entry = { holder, body: made.group, t: instant ? 1 : 0, h: made.height };
    if (!instant) {
      made.group.scale.y = 0.001;
      entry.crane = makeCrane(made.height); entry.crane.position.set(1.7 * BS, 0, -0.6 * BS); holder.add(entry.crane);
      const sc = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(made.w, made.height, made.depth)), new THREE.LineBasicMaterial({ color: 0xffa94d, transparent: true, opacity: 0.85 }));
      sc.position.y = made.height / 2; entry.scaffold = sc; holder.add(sc);
      sfx('build');
    }
    this.lots[i] = entry;
    if (instant) this.settleLot(entry);
  }

  setDoc(doc, now) {
    this.doc = doc;
    this.title = doc.title || this.title;
    const age = now - (doc.updatedAt || 0);
    // a bot mid-step (a long command) sends nothing until it's done: busy, not asleep (isBusy, 05b-detail.js)
    this.fresh = isBusy(doc, now) ? 'fresh' : age > ASLEEP_MS ? 'asleep' : age > FRESH_MS ? 'dimmed' : 'fresh';
    this.asleep = this.fresh === 'asleep';
    const tok = doc.tokens?.total || 0;
    if (this._lastTok != null && tok > this._lastTok) {
      const dtS = Math.max(1, (now - this._lastTokT) / 1000);
      this.tokenRate = (tok - this._lastTok) / dtS;
    }
    if (this._lastTok == null || tok !== this._lastTok) { this._lastTok = tok; this._lastTokT = now; }
    this.tokens = tok;
    this.floorTarget = this.floorsFor(tok);
    const want = this.develop(doc);
    while (this.builtLots < want) this.buildLot(this.builtLots++, this.rise < 1);
    // reconcile the bots
    const seen = new Set();
    for (const a of doc.agents) {
      seen.add(a.id);
      let bot = this.robots.get(a.id);
      if (!bot) { bot = new Robot(this, a); this.robots.set(a.id, bot); }
      bot.setData(a);
    }
    for (const [id, bot] of this.robots) if (!seen.has(id) && !bot.leaving) bot.leave();
    this.updateLabel();
  }

  lead() { for (const b of this.robots.values()) if (b.isLead && !b.leaving) return b; return null; }
  // a name you gave it (in Skyborne's console, or with /rename in Claude Code), else its folder
  givenName() { return city.names.get(this.id) || this.doc?.sessionName || ''; }
  displayName() { return prefs.safe ? 'District ' + String.fromCharCode(65 + (this.slot % 26)) : (this.givenName() || this.title); }
  status() {
    // a request waiting on you outranks everything, asleep or not: Claude Code sends nothing while a dialog waits
    if (city.needs.has(this.id)) return 'wait';
    if (this.asleep) return 'asleep';
    let s = 'idle';
    for (const b of this.robots.values()) {
      if (b.leaving) continue;
      if (b.data.waiting) return 'wait';
      if (b.data.status === 'error') s = 'error';
      else if (b.data.status === 'working' && s !== 'error') s = 'working';
      else if (b.data.status === 'done' && s === 'idle') s = 'done';
    }
    return s;
  }
  updateLabel() {
    const bots = [...this.robots.values()].filter((b) => !b.leaving).length;
    const name = this.displayName();
    this.labelEl.querySelector('b').textContent = name;
    this.labelEl.querySelector('span').textContent = `${bots} Skybot${bots === 1 ? '' : 's'} · ${fmtTokens(this.tokens)} tokens`;
    if (name !== this.signName) { this.signName = name; drawGateSign(this); }
    const head = prefs.safe ? `SKYBORNE · ${name.toUpperCase()} · ${(STATUS_WORD[this.status()] || 'at work').toUpperCase()}` : (this.doc?.headline ? `NOW · ${this.doc.headline}` : `${name.toUpperCase()} · SKYBORNE`);
    if (head !== this.billboardText) { this.billboardText = head; drawBillboard(this, head); }
  }

  freeDesk(bot) {
    if (bot.isLead) { if (!this.desks[0].occupant || this.desks[0].occupant === bot) { this.desks[0].occupant = bot; return this.desks[0]; } }
    for (const d of this.desks) if (d.occupant === bot) return d;
    for (let i = 1; i < this.desks.length; i++) if (!this.desks[i].occupant) { this.desks[i].occupant = bot; return this.desks[i]; }
    return null;
  }
  releaseDesk(bot) { for (const d of this.desks) if (d.occupant === bot) { d.occupant = null; d.screen.visible = false; } }
  // a place of a kind (SPOT_PLACES) for bot to stand, held until it claims another or lets go; null when every one
  // is taken. fresh: move on to a different one (an idle bot wandering)
  claimSpot(bot, kind, fresh = false) {
    const mine = bot.spotKind === kind ? bot.spot : null;
    if (mine && !fresh) return mine;
    const free = SPOT_PLACES[kind].filter((p) => p !== mine && !this.spotHolders.has(p));
    if (!free.length) return mine;
    const p = kind === 'idle' ? free[Math.floor(Math.random() * free.length)] : free[0];
    this.releaseSpots(bot);
    this.spotHolders.set(p, bot); bot.spot = p; bot.spotKind = kind;
    return p;
  }
  // where a helper stands to hand its result to the lead: a place around the lead nobody else holds, open on the walk map
  deliverySpot(bot, lead) {
    const ok = (i) => (!this.fanHolders[i] || this.fanHolders[i] === bot) && walkable(this, lead.pos.x + FAN[i][0], lead.pos.z + FAN[i][1])
      && !this.standingNear(lead.pos.x + FAN[i][0], lead.pos.z + FAN[i][1], bot);
    let i = bot.fanI ?? -1;
    if (i < 0 || !ok(i)) { i = FAN.findIndex((f, k) => ok(k)); if (i < 0) return null; this.releaseSpots(bot); this.fanHolders[i] = bot; bot.fanI = i; }
    return { x: lead.pos.x + FAN[i][0], z: lead.pos.z + FAN[i][1], face: Math.atan2(-FAN[i][0], -FAN[i][1]) };
  }
  releaseSpots(bot) {
    if (bot.spot && this.spotHolders.get(bot.spot) === bot) this.spotHolders.delete(bot.spot);
    if (bot.fanI >= 0 && this.fanHolders[bot.fanI] === bot) this.fanHolders[bot.fanI] = null;
    bot.spot = null; bot.spotKind = null; bot.fanI = -1;
  }
  // a house for a new helper: the first nobody lives in (null when all six are taken); its door takes the helper's colour
  claimHome(bot) {
    const h = this.homes.find((x) => !x.holder);
    if (!h) return null;
    h.holder = bot; this.paintDoor(h, bot.color);
    return h;
  }
  releaseHome(bot) {
    const h = bot.house;
    if (h && h.holder === bot) { h.holder = null; this.lightHome(h, false); this.paintDoor(h, DOOR_IDLE); }
    bot.house = null;
  }
  // a house's front window, lit while its helper is in
  lightHome(h, on) {
    const t = this.homeLights.glow, px = t.image.data, o = h.i * 4;
    for (let k = 0; k < 3; k++) px[o + k] = on ? HOME_GLOW[k] : 0;
    px[o + 3] = 255; t.needsUpdate = true;
  }
  // a house's front door: its helper's colour, the idle wood colour, or dark while it stands open
  paintDoor(h, color) {
    const { start, count } = this.homeLights.doors[h.i], attr = this.homeLights.mesh.geometry.attributes.color, c = new THREE.Color(color);
    for (let k = start; k < start + count; k++) attr.setXYZ(k, c.r, c.g, c.b);
    attr.needsUpdate = true;
  }
  openDoor(h, open) { if (h) this.paintDoor(h, open ? DOOR_OPEN : h.holder ? h.holder.color : DOOR_IDLE); }
  // is another bot (not `but`) standing within a bot's room of (x, z)?
  standingNear(x, z, but) {
    for (const b of this.robots.values()) if (b !== but && b.solid() && !b.walking && Math.hypot(b.pos.x - x, b.pos.z - z) < BOT_GAP + 0.1) return true;
    return false;
  }
  // where a helper beams in: the pad, or around it, clear of every bot and of every spot a bot is headed for; with all
  // of those taken, the open place nearest the pad that is clear of them
  arrivalPoint() {
    const taken = [...this.spotHolders.keys()];
    for (const b of this.robots.values()) if (!b.gone) taken.push(b.pos);
    const busy = (x, z) => taken.some((p) => Math.hypot(p.x - x, p.z - z) < BOT_GAP + 0.1);
    for (const p of ARRIVALS) if (!busy(p.x, p.z) && walkable(this, p.x, p.z)) return p;
    const c = nearestOpen(withBots(this.walk, taken, BOT_GAP + 0.1), cellOf(PAD.x), cellOf(PAD.z));
    return c >= 0 ? { x: cellMid(c % WALK_N), z: cellMid((c / WALK_N) | 0) } : { x: PAD.x, z: PAD.z };
  }

  addResultCube() {
    const desk = this.desks[0];
    if (this.resultCubes.length >= 6) {
      _v.set(0.5, 1.2, 0); desk.group.localToWorld(_v); burstGlitter(_v, 0x6ae6f5, 70, 3.5);
      for (const c of this.resultCubes) desk.group.remove(c);
      this.resultCubes.length = 0;
    }
    const c = new THREE.Mesh(RESULT_GEO, RESULT_MAT);
    const i = this.resultCubes.length;
    c.position.set(0.5 + (i % 2) * 0.22, 0.89 + Math.floor(i / 2) * 0.2, -0.12 + (i % 2) * 0.05);
    c.rotation.y = i * 0.4;
    desk.group.add(c); this.resultCubes.push(c);
    return c;
  }

  leave() {
    if (this.leaving) return;
    this.leaving = true;
    transit.loops.get(this.ring)?.removeStation(this);
  }

  update(dt) {
    // rise from below the clouds, or sink back when the session ends
    if (!this.leaving && this.rise < 1) {
      this.riseStart ||= performance.now();
      this.rise = Math.min(1, (performance.now() - this.riseStart) / 2600);
      this.group.position.y = lerp(-95, 0, easeOutBack(this.rise, 1.17)); // the same small bounce as before (about 5 units)
      if (this.rise >= 1) {
        ensureLoop(this.ring).addStation(this);
        _v.copy(this.home); dustRing(_v.setY(0.3), 0xe8e0d0, 60, 6); sfx('land');
      }
    }
    if (this.leaving) {
      this.leaveStart ||= performance.now();
      const k = Math.min(1, (performance.now() - this.leaveStart) / 2400);
      this.group.position.y = lerp(0, -100, k * k); // fully under the cloud sea by the time it's gone
      this.labelEl.style.opacity = String(1 - k);
      if (k >= 1) { this.dispose(); return; }
    }
    this.base.userData.bits.rotation.y += dt * 0.05;
    // HQ growth
    while (this.floors.length < this.floorTarget) { this.addFloor(false); sfx('build'); }
    let y = 0, growing = false;
    for (const f of this.floors) {
      if (f.userData.s < 1) { growing = true; f.userData.s = Math.min(1, f.userData.s + dt / 1.4); if (f.userData.s >= 1) { _v.set(0, y + HQ_FLOOR_H + 0.2, 0); this.tower.localToWorld(_v); burstGlitter(_v, 0xffd27d, 40, 2.4); } }
      f.position.y = y; f.scale.y = Math.max(0.0001, easeOutBack(f.userData.s)); y += f.scale.y * HQ_FLOOR_H;
    }
    if (!growing && this.bakedFloors !== this.floors.length) this.bakeTower();
    this.roof.position.y = y;
    this.label.position.y = y + 5.8;
    // new buildings going up
    for (const lot of this.lots) {
      if (!lot || lot.t >= 1) continue;
      lot.t = Math.min(1, lot.t + dt / 4.2);
      const k = clamp((lot.t - 0.12) / 0.78, 0, 1);
      lot.body.scale.y = Math.max(0.001, easeOutBack(k));
      if (lot.crane) lot.crane.userData.jib.rotation.y = Math.sin(lot.t * 9) * 0.9;
      if (lot.t >= 1) {
        lot.holder.remove(lot.crane); lot.holder.remove(lot.scaffold); lot.scaffold.geometry.dispose();
        lot.holder.getWorldPosition(_v); dustRing(_v.setY(_v.y + 0.3), 0xe8e0d0, 30, 2.4); _v.y += lot.h * 0.6; burstGlitter(_v, 0xffd27d, 50, 2.6);
        this.settleLot(lot);
      }
    }
    if (this.lotsDirty) { this.lotsDirty = false; this.rebakeLots(); }
    // windows: dim when the district is asleep
    const dim = this.asleep ? 0.18 : this.fresh === 'dimmed' ? 0.6 : 1;
    for (const e of this.windowLit) e.dim = damp(e.dim, dim, 2, dt);
    this.aviation.material.emissiveIntensity = (Math.sin(clockT.now * 3 + this.seed) > 0.6 ? 3.2 : 0.3) * (this.asleep ? 0.3 : 1);
    this.padRing.material.emissiveIntensity = (1.2 + Math.sin(clockT.now * 2.4) * 0.6) * (this.asleep ? 0.3 : 1);
    if (this.boardTex) this.boardTex.offset.x += dt * (this.asleep ? 0.01 : 0.05);
    // web work spins the dish and sends rings of signal
    let web = false, working = 0;
    for (const b of this.robots.values()) { if (b.data.kind === 'web' && b.atDesk) web = true; if (b.data.status === 'working') working++; }
    this.dish.rotation.y += dt * (web ? 3.5 : 0.25);
    if (web) {
      this.webT += dt;
      if (this.webT > 0.55) {
        this.webT = 0; this.dish.children[2].getWorldPosition(_v);
        for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; glitter.emit({ x: _v.x, y: _v.y, z: _v.z, vx: Math.cos(a) * 2.6, vy: 0.9, vz: Math.sin(a) * 2.6, q: this.group.quaternion, life: 1.1, size: 0.16, size1: 0.05, color: 0x6ae6f5 }); }
      }
    }
    if (this.rise >= 1 && !this.leaving) {
      // chimney steam: a steady wisp, thicker while tokens burn
      const rate = (this.asleep ? 0.3 : 1.2) + clamp(this.tokenRate / 1500, 0, 10) + working * 0.6;
      this.steamT += dt * rate;
      while (this.steamT > 1) {
        this.steamT -= 1; this.chimneyTop.getWorldPosition(_v);
        puffs.emit({ x: _v.x + (Math.random() - .5) * 0.2, y: _v.y, z: _v.z + (Math.random() - .5) * 0.2, vx: 0.25 + Math.random() * 0.2, vy: 1.1 + Math.random() * 0.5, vz: (Math.random() - .5) * 0.3, q: this.group.quaternion, life: 2.6 + Math.random(), size: 0.45, size1: 1.7, alpha: 0.32, color: 0xb9c2e6, drag: 0.6 });
      }
      // traffic on the ring road follows how busy the district is
      const wantCars = this.asleep ? 1 : clamp(1 + working, 1, 5);
      const live = this.cars.filter((c) => !c.leaving);
      if (live.length < wantCars) { const lane = live.length % 2 ? LANE_OUT : LANE_IN, a0 = freeLaneAngle(lane, this.cars); if (a0 !== null) this.cars.push(new Car(this, lane, lane === LANE_IN ? 1 : -1, a0)); }
      else if (live.length > wantCars) live[live.length - 1].leaving = true;
    }
    // the zebra crossing: cars stop for a bot on it (walking or held up there) or walking up to it, and a bot waits at
    // the kerb while a car is on it
    this.crossBusy = false;
    for (const b of this.robots.values()) if (b.solid() && onCrossing(b.pos.x, b.pos.z, b.walking ? 0.9 : BOT_R)) { this.crossBusy = true; break; }
    this.carOnCross = this.cars.some((c) => !c.gone && c.onCross());
    for (const c of this.cars) c.update(dt, this.cars);
    this.cars = this.cars.filter((c) => !c.gone);
    // bots
    for (const [id, b] of this.robots) { b.update(dt); if (b.gone) { b.dispose(); this.robots.delete(id); this.updateLabel(); } }
    for (const c of this.resultCubes) c.rotation.y += dt * 0.8;
  }

  // camera framing helpers
  framePos(angle, dist, height, out) {
    _v.copy(this.t).multiplyScalar(Math.cos(angle)).addScaledVector(this.side, Math.sin(angle));
    return out.copy(this.home).addScaledVector(this.n, height).addScaledVector(_v, dist);
  }
  frameTarget(out, h = 3.5) { return out.copy(this.home).addScaledVector(this.n, h); }

  dispose() {
    this.dead = true;
    for (const b of this.robots.values()) b.dispose();
    this.robots.clear();
    scene.remove(this.group);
    this.group.traverse((o) => { if (o.userData.baked) o.traverse((m) => m.geometry?.dispose()); });
    transit.loops.get(this.ring)?.removeStation(this);
    this.group.remove(this.label);
    this.labelEl.remove();
    this.homeLights.mesh.geometry.dispose(); this.homeLights.mesh.material.dispose(); this.homeLights.glow.dispose();
    for (const e of this.ownLit) { const i = nightLit.indexOf(e); if (i >= 0) nightLit.splice(i, 1); }
    for (const e of this.windowLit) { const i = nightLit.indexOf(e); if (i >= 0) nightLit.splice(i, 1); }
  }
}
const RESULT_GEO = new RoundedBoxGeometry(0.17, 0.17, 0.17, 2, 0.03);
const RESULT_MAT = new THREE.MeshStandardMaterial({ color: 0xbff8ff, emissive: 0x6ae6f5, emissiveIntensity: 2.2, roughness: 0.3 });
