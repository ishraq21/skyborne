
// =====================================================================
// districts: one floating island per Claude Code session
// =====================================================================
// The plaza and what stands on it are spread out (bots and desks keep their size), so the aisles fit a bot.
// The HQ stands behind the desks: its front face is at TOWER_Z + HQ_D / 2, and DOOR just in front of it.
const DESKS = [[0, 3.9], [-3.3, 3.45], [3.3, 3.45], [-1.65, 0.55], [1.65, 0.55], [-4.95, 0.7], [4.95, 0.7]];
const TOWER_Z = -4.6, HQ_W = 6.0, HQ_D = 3.9, HQ_FLOOR_H = 1.6;
const DOOR = new THREE.Vector3(0, 0, TOWER_Z + HQ_D / 2 + 0.1);
const PAD = new THREE.Vector3(-6.25, 0, -2.9);
const KIOSK = new THREE.Vector3(6.25, 0, -3.0);
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
    this.cars = [];
    this.lotItems = []; this.lotBake = null; this.lotsDirty = false; this.towerBake = null; this.bakedFloors = 0;
    this.billboardText = ''; this.signName = '';
    this.build();
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
    kiosk.rotation.y = -0.5;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 32), stdMat(0x2a3044, { metalness: 0.5, roughness: 0.4 })); pad.position.copy(PAD).setY(0.12); pad.receiveShadow = true; G.add(pad);
    this.padRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.045, 6, 40).rotateX(Math.PI / 2), glowMat(0x6ae6f5, 0.9, 2.6, { own: true })); this.padRing.position.copy(PAD).setY(0.2); G.add(this.padRing);
    for (const sx of [-1, 1]) { const t = makeTree(r, (0.95 + r() * 0.3) * 1.2); t.position.set(sx * (5.0 + r() * 0.3), 0, -5.3 - r() * 0.3); G.add(t); }
    const bench = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.16, 0.48, 2, 0.06), stdMat(0xa8754f)); bench.position.set(5.6, 0.45, -1.0); bench.rotation.y = -1.2; bench.castShadow = true; G.add(bench);
    const benchShadow = contactShadow(1.8, 0.75, PLAZA_TOP + 0.03, 5.6, -1.0); benchShadow.rotation.y = -1.2; G.add(benchShadow);

    // street lamps on the sidewalk, trees on the outer edge, the gate
    for (const a of [0.2, -0.2, 1.03, -1.03, 1.83, -1.83, 2.48, -2.48]) { const l = makeLamp(); l.scale.setScalar(1.45); l.position.set(Math.sin(a) * WALK_R, 0.12, Math.cos(a) * WALK_R); G.add(l); }
    for (const a of [1.05, -1.05, 1.83, -1.83]) { const t = makeTree(r, (0.8 + r() * 0.35) * 1.4); const rr = 14.0 + r() * 0.5; t.position.set(Math.sin(a) * rr, 0, Math.cos(a) * rr); G.add(t); }
    G.add(makeGate(this));

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
    for (const e of this.ownLit) { const i = nightLit.indexOf(e); if (i >= 0) nightLit.splice(i, 1); }
    for (const e of this.windowLit) { const i = nightLit.indexOf(e); if (i >= 0) nightLit.splice(i, 1); }
  }
}
const RESULT_GEO = new RoundedBoxGeometry(0.17, 0.17, 0.17, 2, 0.03);
const RESULT_MAT = new THREE.MeshStandardMaterial({ color: 0xbff8ff, emissive: 0x6ae6f5, emissiveIntensity: 2.2, roughness: 0.3 });
