
// =====================================================================
// bots: procedural robots with faces, poses and tool props
// =====================================================================
const RG = {
  leg: new THREE.CapsuleGeometry(0.075, 0.2, 4, 10).translate(0, -0.17, 0),
  foot: new RoundedBoxGeometry(0.17, 0.08, 0.24, 2, 0.03).translate(0, -0.34, 0.03),
  arm: new THREE.CapsuleGeometry(0.062, 0.22, 4, 10).translate(0, -0.17, 0),
  hand: new THREE.SphereGeometry(0.078, 10, 8).translate(0, -0.34, 0),
  body: new RoundedBoxGeometry(0.58, 0.5, 0.42, 3, 0.13),
  belly: new RoundedBoxGeometry(0.42, 0.16, 0.06, 2, 0.03),
  head: new RoundedBoxGeometry(0.68, 0.52, 0.54, 3, 0.16),
  face: new THREE.PlaneGeometry(0.55, 0.35),
  ant: new THREE.CylinderGeometry(0.018, 0.022, 0.22, 6).translate(0, 0.11, 0),
  tip: new THREE.SphereGeometry(0.065, 12, 8),
  chest: new THREE.CircleGeometry(0.07, 18),
  ring: new THREE.TorusGeometry(0.58, 0.04, 6, 44).rotateX(Math.PI / 2),
  orb: new THREE.SphereGeometry(0.075, 10, 8),
};
const BOT_SCALE = 1.3;
const BOT_FEET = 0.02; // the soles are 0.013 below a bot's origin: lift it this much so they stand on the ground
const SHELL = new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.38, metalness: 0.12 });
const JOINT = new THREE.MeshStandardMaterial({ color: 0x343a4f, roughness: 0.5, metalness: 0.35 });
const GOLD = new THREE.MeshStandardMaterial({ color: 0xf0c25a, roughness: 0.3, metalness: 0.85, emissive: 0x3a2400, emissiveIntensity: 0.25 });
const SEL_MAT = new THREE.MeshBasicMaterial({ color: 0x6ae6f5, transparent: true, opacity: 0.9, toneMapped: false });
const ORB_MAT = new THREE.MeshBasicMaterial({ color: 0xc8d2ff, toneMapped: false });
const ZTEX = canvasTex(64, 64, (g) => { g.fillStyle = '#e7ecff'; g.font = '800 46px Unbounded, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Z', 32, 34); });
const Z_MAT = new THREE.SpriteMaterial({ map: ZTEX, transparent: true, depthWrite: false });

function roleFromType(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'explore') return 'Scout';
  if (t === 'plan') return 'Architect';
  if (t === 'general-purpose' || t === 'claude') return 'Builder';
  if (t === 'claude-code-guide') return 'Guide';
  if (t === 'statusline-setup') return 'Tinker';
  if (t === 'fork') return 'Twin';
  if (t.includes('review')) return 'Critic';
  if (t.includes('test')) return 'Tester';
  if (t.includes('research') || t.includes('search')) return 'Scout';
  if (t.includes('design')) return 'Artist';
  return 'Builder';
}

// Each limb is one mesh: its parts are painted with vertex colours and share one
// material per bot, so a whole Skybot costs about ten draw calls.
const C_SHELL = 0xf2f4f8, C_JOINT = 0x343a4f;
const botGeoCache = new Map();
function tintGeo(geo, hex, x = 0, y = 0, z = 0, rot = null) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
  g.translate(x, y, z);
  for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
  const c = new THREE.Color(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.clearGroups();
  return g;
}
function botGeo(kind, color, role) {
  const k = kind + ':' + color + ':' + (kind === 'torso' || kind === 'head' ? role : '');
  if (botGeoCache.has(k)) return botGeoCache.get(k);
  let parts;
  if (kind === 'leg') parts = [tintGeo(RG.leg, C_JOINT), tintGeo(RG.foot, color)];
  else if (kind === 'arm') parts = [tintGeo(RG.arm, color), tintGeo(RG.hand, C_SHELL)];
  else if (kind === 'torso') {
    parts = [tintGeo(RG.body, color, 0, 0.63, 0), tintGeo(RG.belly, C_SHELL, 0, 0.52, 0.205)];
    if (role === 'Architect') parts.push(tintGeo(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 10), 0x3c66c9, 0.05, 0.75, -0.25, new THREE.Euler(0, 0, 0.7)));
    if (role === 'Guide') parts.push(tintGeo(new THREE.TorusGeometry(0.2, 0.05, 6, 18).rotateX(Math.PI / 2), 0xf2cf4a, 0, 0.9, 0));
  } else {
    parts = [tintGeo(RG.head, C_SHELL, 0, 0.27, 0), tintGeo(RG.ant, C_JOINT, 0, 0.53, 0)];
    for (const sx of [-1, 1]) parts.push(tintGeo(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14).rotateZ(Math.PI / 2), color, sx * 0.36, 0.27, 0));
    if (role === 'Builder') parts.push(tintGeo(new THREE.SphereGeometry(0.31, 16, 8, 0, TAU, 0, Math.PI / 2), 0xf2c230, 0, 0.5, 0), tintGeo(new THREE.CylinderGeometry(0.4, 0.4, 0.03, 18), 0xf2c230, 0, 0.51, 0.05));
    if (role === 'Critic') parts.push(tintGeo(new THREE.SphereGeometry(0.3, 16, 8).scale(1, 0.32, 1), 0xd9354f, -0.05, 0.54, -0.02, new THREE.Euler(0, 0, 0.2)));
  }
  const g = mergeGeometries(parts, false); parts.forEach((p) => p.dispose());
  botGeoCache.set(k, g);
  return g;
}
let CROWN_GEO = null;
function crownGeo() {
  if (CROWN_GEO) return CROWN_GEO;
  const parts = [new THREE.CylinderGeometry(0.2, 0.22, 0.1, 10, 1, true)];
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; parts.push(new THREE.ConeGeometry(0.045, 0.12, 6).translate(Math.cos(a) * 0.2, 0.1, Math.sin(a) * 0.2)); }
  CROWN_GEO = mergeGeometries(parts.map((p) => { for (const n of Object.keys(p.attributes)) if (n !== 'position' && n !== 'normal') p.deleteAttribute(n); return p.index ? p.toNonIndexed() : p; }), false);
  return CROWN_GEO;
}

const EYE = { working: '#8ff4ff', think: '#c6d0ff', wait: '#ffc35c', error: '#ff6b6b', done: '#9fd0ff', idle: '#8ff4ff', sleep: '#5f6b8a' };
// faces with open eyes can blink and glance; the rest (closed, starry, X) never do
const BLINKY = new Set(['normal', 'focus', 'up', 'wait', 'worried', 'determined', 'sweat', 'bored']);
const NEAR_FACE = 63; // blinks, glances and life moments only for bots this close to the camera (a district's own view is about 49 away)
const CUP_GEO = new THREE.CylinderGeometry(0.075, 0.06, 0.15, 12);
const CUP_MAT = new THREE.MeshStandardMaterial({ color: 0xc8742e, roughness: 0.55 });
const wrapA = (x) => ((x + Math.PI) % TAU + TAU) % TAU - Math.PI;

class Robot {
  constructor(district, a) {
    this.d = district; this.id = a.id; this.key = district.id + ':' + a.id;
    this.isLead = a.id === 'main' || !a.parent;
    this.seed = (hash(this.key) % 1000) / 37;
    this.data = a;
    const prefix = String(a.name || '').split('-')[0];
    this.role = this.isLead ? 'lead' : (ROLE_COLORS[prefix] ? prefix : roleFromType(a.type || String(a.role || '').replace(/ Agent$/, '')));
    this.color = this.isLead ? district.hue : (ROLE_COLORS[this.role] ?? DISTRICT_HUES[hash(this.key) % 8]);
    this.root = new THREE.Group();
    district.group.add(this.root);
    this.build();
    this.pos = new THREE.Vector3();
    this.heading = 0;
    if (!city.primed || district.rise < 1) { this.mode = 'live'; this.scale = 1; this.snap = true; }
    else if (this.isLead) { this.pos.copy(DOOR); this.mode = 'live'; this.heading = 0; this.scale = 1; }
    else {
      const at = district.arrivalPoint(); this.pos.set(at.x, 0, at.z); // the pad, or beside it while another bot stands there
      this.mode = 'beamIn'; this.scale = 0;
      this.beam = makeBeam(0x6ae6f5); this.beam.position.copy(this.pos).setY(0.15); this.beam.scale.set(0.75, 9, 0.75); district.group.add(this.beam);
      sfx('spawn');
      queueMicrotask(() => cityEvent('spawn', this));
    }
    this.t = 0; this.goal = null; this.atDesk = false; this.desk = null; this.walking = false;
    // where it stands (a spot or a place around the lead it holds) and the path it walks there (walkToward)
    this.spot = null; this.spotKind = null; this.fanI = -1; this.newIdle = false;
    this.path = null; this.pathTo = null; this.repathT = 0; this.stuckT = 0; this.waitEnd = 0; this.stepT = 0; this.near = { x: 0, z: 0, d: Infinity };
    this.leaving = false; this.gone = false;
    this.delivering = false; this.delivered = false; this.carry = null;
    this.kindSince = performance.now(); this.cheerT = 0; this.errT = 0; this.fxT = 0; this.arcT = 0; this.tetherT = 0;
    this.blinkT = 1.5 + Math.random() * 4; this.blink = 0; this.expr = '';
    const r = rng(hash(this.key));
    this.nick = (this.isLead && customLeadName(a.name, district.title)) || nickFor(this.key, takenNicks());
    nickCache.set(this.key, this.nick);
    this.idleFace = -1.9 + r() * 1.4;
    this.wanderT = 4 + r() * 8;
    // moods and life moments (browser memory only; they start over on reload)
    this.workSince = this.idleSince = this.localWaitSince = Date.now();
    this.moment = null; this.momentT = 4 + r() * 8; this.lookAt = null; this.glance = 0; this.glanceT = 2 + r() * 4;
    this.proudT = 0; this.moodV = ''; this.moodT = 0; this.errTs = []; this.lastErrTs = undefined; this.camDist = 0;
    this.pose = { legL: 0, legR: 0, armLx: 0, armRx: 0, armLz: 0.08, armRz: -0.08, headX: 0, headY: 0, headZ: 0, bob: 0, lean: 0, yaw: 0 };
    this.walkPhase = r() * TAU;
    this.drawFace('normal', EYE.working);
    this.groundY = groundAt(this.pos.x, this.pos.z);
    this.root.position.copy(this.pos).setY(this.groundY + BOT_FEET);
    this.root.scale.setScalar(Math.max(0.001, this.scale) * BOT_SCALE);
  }

  build() {
    const R = this.root;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.32, metalness: 0.14, emissive: 0x000000 });
    // a soft shadow on the ground under the bot, just below its feet: it stays down when the body hops
    this.shadow = contactShadow(0.95, 0.85, -(BOT_FEET - 0.005) / BOT_SCALE); R.add(this.shadow);
    this.bob = new THREE.Group(); this.bob.rotation.order = 'YXZ'; R.add(this.bob); // lean in the bot's own frame, then turn (yaw)
    const mk = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const role = this.role;
    // legs
    this.legL = new THREE.Group(); this.legL.position.set(-0.13, 0.37, 0); this.bob.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.13, 0.37, 0); this.bob.add(this.legR);
    for (const L of [this.legL, this.legR]) mk(botGeo('leg', this.color, role), this.bodyMat, L);
    // torso
    this.body = mk(botGeo('torso', this.color, role), this.bodyMat, this.bob);
    this.tipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: STATUS_HEX.working, emissiveIntensity: 2.4 });
    const chest = new THREE.Mesh(RG.chest, this.tipMat); chest.position.set(0, 0.72, 0.212); this.bob.add(chest);
    // arms
    this.armL = new THREE.Group(); this.armL.position.set(-0.37, 0.83, 0); this.bob.add(this.armL);
    this.armR = new THREE.Group(); this.armR.position.set(0.37, 0.83, 0); this.bob.add(this.armR);
    for (const A of [this.armL, this.armR]) mk(botGeo('arm', this.color, role), this.bodyMat, A);
    // head with a screen face
    this.head = new THREE.Group(); this.head.position.set(0, 0.9, 0); this.bob.add(this.head);
    this.headMesh = mk(botGeo('head', this.color, role), this.bodyMat, this.head);
    this.faceTex = canvasTex(128, 82, () => {});
    this.faceMat = new THREE.MeshBasicMaterial({ map: this.faceTex, toneMapped: false });
    this.faceMat.color.setScalar(1.55);
    const face = new THREE.Mesh(RG.face, this.faceMat); face.position.set(0, 0.27, 0.272); this.head.add(face);
    this.tip = new THREE.Mesh(RG.tip, this.tipMat); this.tip.position.set(0, 0.79, 0); this.head.add(this.tip);
    this.accessory();
    // picking
    for (const m of [this.body, this.headMesh]) m.userData.robot = this;
    // label
    const el = document.createElement('div'); el.className = 'tag'; el.innerHTML = '<span class="n"><i></i><span></span><em></em></span><span class="a"></span>';
    this.labelEl = el; this.labelName = el.querySelector('.n > span'); this.labelRole = el.querySelector('.n em'); this.labelDot = el.querySelector('.n i'); this.labelAct = el.querySelector('.a');
    this.label = new CSS2DObject(el); this.label.position.set(0, 2.0, 0); R.add(this.label);
  }

  accessory() {
    const H = this.head;
    // hats, berets, tubes and scarves are painted into the head and torso (see botGeo)
    if (this.role === 'lead') {
      GOLD.side = THREE.DoubleSide;
      const crown = new THREE.Mesh(crownGeo(), GOLD); crown.position.set(0, 0.56, 0); crown.castShadow = true; H.add(crown);
      this.tip.position.y = 0.86;
    } else if (this.role === 'Builder') {
      this.tip.position.y = 0.92;
    } else if (this.role === 'Scout') {
      const dish = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.12, 12, 1, true).rotateZ(Math.PI / 2), stdMat(0xe8edf5, { side: THREE.DoubleSide })); dish.position.set(0.45, 0.42, 0); H.add(dish);
    } else if (this.role === 'Tester') {
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.02), glowMat(0x98f06a, 1, 2)); badge.position.set(0.17, 0.75, 0.215); this.bob.add(badge);
    }
  }

  drawFace(kind, color, glance = 0) {
    const blink = this.blink > 0 && BLINKY.has(kind);
    const key = kind + color + (blink ? 'b' : '') + glance;
    if (key === this.expr) return; this.expr = key;
    const g = this.faceTex.userData.ctx, W = 128, H = 82;
    g.clearRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#0e1528'); grd.addColorStop(1, '#060a16');
    g.fillStyle = grd; roundRect(g, 0, 0, W, H, 16); g.fill();
    g.fillStyle = color; g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 7;
    g.shadowColor = color; g.shadowBlur = 10;
    const gx = glance * 7, L = 40 + gx, Rx = 88 + gx, Y = 40;
    const focusEyes = () => { for (const cx of [L, Rx]) { roundRect(g, cx - 13, Y - 6, 26, 13, 6); g.fill(); } };
    // brows: dy > 0 tips the inner ends down (cross), dy < 0 lifts them (worried)
    const brows = (dy) => { g.lineWidth = 4; g.beginPath(); g.moveTo(L - 12, Y - 20 - dy); g.lineTo(L + 11, Y - 20 + dy); g.moveTo(Rx + 12, Y - 20 - dy); g.lineTo(Rx - 11, Y - 20 + dy); g.stroke(); };
    const star = (cx, cy, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const an = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr); } g.closePath(); g.fill(); };
    if (blink) { g.beginPath(); g.moveTo(L - 12, Y); g.lineTo(L + 12, Y); g.moveTo(Rx - 12, Y); g.lineTo(Rx + 12, Y); g.stroke(); }
    else if (kind === 'happy' || kind === 'grin') { for (const cx of [L, Rx]) { g.beginPath(); g.arc(cx, Y + 8, 13, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); } }
    else if (kind === 'star') { star(L, Y - 2, 15); star(Rx, Y - 2, 15); }
    else if (kind === 'x') { for (const cx of [L, Rx]) { g.beginPath(); g.moveTo(cx - 10, Y - 10); g.lineTo(cx + 10, Y + 10); g.moveTo(cx + 10, Y - 10); g.lineTo(cx - 10, Y + 10); g.stroke(); } }
    else if (kind === 'sleep') { g.lineWidth = 5; for (const cx of [L, Rx]) { g.beginPath(); g.arc(cx, Y - 4, 11, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); } }
    else if (kind === 'focus') focusEyes();
    else if (kind === 'determined') { focusEyes(); brows(4); }
    else if (kind === 'sweat') {
      focusEyes(); g.shadowBlur = 4; g.fillStyle = '#8fd8ff';
      g.beginPath(); g.moveTo(114, 8); g.quadraticCurveTo(122, 22, 114, 26); g.quadraticCurveTo(106, 22, 114, 8); g.fill();
    }
    else if (kind === 'up') { for (const cx of [L, Rx]) { roundRect(g, cx - 9 + 4, Y - 18, 18, 22, 8); g.fill(); } }
    else if (kind === 'wait') { for (const cx of [L, Rx]) { g.beginPath(); g.arc(cx, Y - 2, 13, 0, TAU); g.fill(); } g.fillStyle = '#0e1528'; for (const cx of [L, Rx]) { g.beginPath(); g.arc(cx + 3, Y - 5, 4.5, 0, TAU); g.fill(); } }
    else if (kind === 'worried') { for (const cx of [L, Rx]) { roundRect(g, cx - 9, Y - 8, 18, 22, 8); g.fill(); } brows(-5); }
    else if (kind === 'bored') { for (const cx of [L, Rx]) { roundRect(g, cx - 11, Y - 1, 22, 13, 6); g.fill(); } g.lineWidth = 4; g.beginPath(); g.moveTo(L - 14, Y - 4); g.lineTo(L + 14, Y - 4); g.moveTo(Rx - 14, Y - 4); g.lineTo(Rx + 14, Y - 4); g.stroke(); }
    else if (kind === 'yawn') { g.lineWidth = 5; g.beginPath(); g.moveTo(L - 11, Y - 7); g.lineTo(L + 9, Y); g.lineTo(L - 11, Y + 7); g.moveTo(Rx + 11, Y - 7); g.lineTo(Rx - 9, Y); g.lineTo(Rx + 11, Y + 7); g.stroke(); }
    else if (kind === 'wink') { roundRect(g, L - 10, Y - 14, 20, 28, 9); g.fill(); g.beginPath(); g.arc(Rx, Y + 8, 13, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    else { for (const cx of [L, Rx]) { roundRect(g, cx - 10, Y - 14, 20, 28, 9); g.fill(); } }
    // a mouth only on the expressive faces, so the everyday look stays eyes-only
    g.fillStyle = color; g.lineWidth = 5;
    if (kind === 'grin' || kind === 'star') { g.beginPath(); g.moveTo(76, 61); g.arc(64, 61, 12, 0, Math.PI); g.closePath(); g.fill(); }
    else if (kind === 'worried') { g.lineWidth = 4; g.beginPath(); g.moveTo(50, 68); for (let i = 1; i <= 4; i++) g.lineTo(50 + i * 7, i % 2 ? 64 : 68); g.stroke(); }
    else if (kind === 'yawn') { g.beginPath(); g.ellipse(64, 65, 8, 10, 0, 0, TAU); g.fill(); }
    else if (kind === 'wink') { g.beginPath(); g.arc(64, 56, 10, Math.PI * 0.2, Math.PI * 0.8); g.stroke(); }
    this.faceTex.needsUpdate = true;
  }

  setData(a) {
    const prev = this.data; this.data = a;
    if (this.isLead) { const custom = customLeadName(a.name, this.d.title); if (custom && custom !== this.nick) { this.nick = custom; nickCache.set(this.key, custom); } }
    if (a.kind !== prev.kind) this.kindSince = performance.now();
    const now = Date.now();
    if (a.status !== prev.status) { if (a.status === 'working') this.workSince = now; else if (a.status === 'idle') this.idleSince = now; }
    if (!prev.waiting && a.waiting) { this.localWaitSince = now; cityEvent('wait', this); }
    if (prev.status !== 'done' && a.status === 'done') {
      this.proudT = 8;
      if (this.isLead) {
        this.cheerT = 2.6; this.root.getWorldPosition(_v).addScaledVector(this.d.n, 2.4); burstConfetti(_v, 160, this.d.group.quaternion); cityEvent('done', this); sfx('done');
        // victory dance; everyone free in the district claps along
        this.startMoment('dance', 4, { hold: true });
        for (const b of this.d.robots.values()) if (b !== this && b.free()) b.startMoment('clap', 4, { hold: true, other: this });
      }
      else if (!this.delivered) { this.startDelivery(); }
    }
    if (prev.status !== 'error' && a.status === 'error') { this.errT = 2.5; sfx('error'); this.neighboursLook(); }
    // errors this bot hit lately, from the session feed (a failed tool call only shows up there)
    const errTs = []; for (const f of this.d.doc?.feed || []) if (f.kind === 'error' && f.agentId === this.id) errTs.push(f.ts);
    this.errTs = errTs;
    const newest = errTs.length ? Math.max(...errTs) : 0;
    if (this.lastErrTs !== undefined && newest > this.lastErrTs) this.neighboursLook();
    this.lastErrTs = newest;
    if (prev.status === 'done' && a.status === 'working') { this.delivered = false; }
  }

  startDelivery() {
    this.delivering = true;
    if (!this.carry) { this.carry = new THREE.Mesh(RESULT_GEO, RESULT_MAT); this.carry.scale.setScalar(1.5); this.carry.position.set(0, 0.62, 0.42); this.bob.add(this.carry); }
    _v.set(0, 0.8, 0.4); this.bob.localToWorld(_v); burstGlitter(_v, 0x6ae6f5, 36, 2);
  }

  leave() {
    this.leaving = true; this.t = 0; this.moment = null; this.lookAt = null;
    this.d.releaseDesk(this); this.d.releaseSpots(this);
    this.clearArc(); this.clearTether();
    if (this.isLead) { this.mode = 'doorOut'; }
    else {
      this.mode = 'beamOut';
      if (!this.beam) { this.beam = makeBeam(0x6ae6f5); this.d.group.add(this.beam); }
      this.beam.position.copy(this.pos).setY(0.15); this.beam.scale.set(0.7, 9, 0.7);
      sfx('leave');
    }
  }

  goalFor() {
    const a = this.data;
    if (this.mode === 'doorOut') return { x: DOOR.x, z: DOOR.z, face: Math.PI };
    if (this.d.asleep) return null; // asleep districts stay put
    if (this.moment?.hold) return this.goal || { x: this.pos.x, z: this.pos.z, face: this.heading }; // stay put for a salute, high-five or wave
    // every place it's sent is its own (a desk, a spot, a place around the lead), so no two bots stand in one place
    if (this.delivering) {
      const lead = this.d.lead();
      if (!lead || lead === this) return { x: DESKS[0][0] + 1.3, z: DESKS[0][1] - 0.6, face: -Math.PI / 2, deliver: true };
      const s = this.d.deliverySpot(this, lead);
      if (s) return { ...s, deliver: true };
      return this.spareGoal(); // everyone's around the lead already: wait for a place
    }
    if (!this.isLead && a.status === 'done') {
      this.d.releaseDesk(this);
      const s = this.d.claimSpot(this, 'pad');
      return s ? { x: s.x, z: s.z, face: s.face } : this.spareGoal();
    }
    if (a.status === 'idle' && !a.waiting) {
      this.d.releaseDesk(this);
      const s = this.d.claimSpot(this, 'idle', this.newIdle); this.newIdle = false;
      return s ? { x: s.x, z: s.z, face: s.face ?? this.idleFace } : this.spareGoal();
    }
    const desk = this.d.freeDesk(this);
    if (desk) { if (this.spot || this.fanI >= 0) this.d.releaseSpots(this); this.desk = desk; return { x: desk.x, z: desk.z - 0.92, face: 0, desk }; }
    return this.spareGoal();
  }
  // a spare place to stand when every desk (or spot) is taken; with none left, it stays where it is
  spareGoal() {
    const s = this.d.claimSpot(this, 'spare');
    return s ? { x: s.x, z: s.z, face: s.face } : { x: this.pos.x, z: this.pos.z, face: this.heading };
  }
  // in the way of other bots: standing or walking in the district (not one fading in or out)
  solid() { return !this.gone && (this.mode === 'live' || this.mode === 'doorOut' || this.mode === 'beamIn') && this.scale > 0.3; }
  // One step toward g along its path (walkPath): around desks, buildings, trees and the bots standing about, aside for
  // a bot just ahead (both keep to their right, or step left when the right is blocked), and never into another bot
  // (only walking bots give way: one standing stays put). Returns whether the bot is walking. A bot that gets no
  // nearer its next waypoint for 1.5 s (blocked, or stepping to and fro) looks for a new path around the bots in its way.
  walkToward(g, speed, dt) {
    const d = this.d;
    this.repathT -= dt;
    const moved = !this.pathTo || Math.hypot(g.x - this.pathTo.x, g.z - this.pathTo.z) > 0.5;
    if (this.repathT <= 0 && (moved || this.stuckT > 1.5) && mayPlanWalk()) {
      const standing = []; for (const o of d.robots.values()) if (o !== this && o.solid() && (!o.walking || o.stuckT > 0.5)) standing.push(o.pos); // and bots held up
      let path = walkPath(d, this.pos, g, standing);
      if (!path && this.spotKind && this.moveOn()) { this.path = this.pathTo = null; this.stepT = 0; return false; } // cut off: another spot, next frame
      this.path = path || walkPath(d, this.pos, g); // boxed in by bots: around the furniture only, and it waits its turn
      if (!this.path) { this.path = [{ x: g.x, z: g.z }]; if (!this.noWayLogged) { this.noWayLogged = true; console.warn('Skyborne: a Skybot found no way through; it walks straight', this.key, g); } }
      this.pathTo = { x: g.x, z: g.z }; this.repathT = moved ? 0.5 : 1.5;
      if (moved) this.stuckT = 0;
    }
    const path = this.path;
    this.stepT -= dt;
    if (!path) return false; // its path is worked out next frame
    // boxed in (two bots in each other's way): stand a moment, then try again. Each waits its own while, so one goes
    // first and the other, standing, is planned around
    if (this.stuckT > 4) { this.waitEnd ||= 5.2 + Math.random() * 2.5; this.stuckT += dt; if (this.stuckT < this.waitEnd) return false; this.stuckT = 1.6; this.waitEnd = 0; }
    while (path.length > 1 && Math.hypot(path[0].x - this.pos.x, path[0].z - this.pos.z) < 0.12) path.shift();
    const wp = path.length > 1 ? path[0] : g; // the last stretch goes to the goal itself, wherever it is now
    let ux = wp.x - this.pos.x, uz = wp.z - this.pos.z;
    const left = Math.hypot(ux, uz);
    if (left < 1e-6) return false;
    ux /= left; uz /= left;
    let side = 0, slow = 1; // how hard to step aside, to the right of travel: (-uz, ux) when facing (ux, uz)
    for (const o of d.robots.values()) {
      if (o === this || !o.solid()) continue;
      const ox = o.pos.x - this.pos.x, oz = o.pos.z - this.pos.z, od = Math.hypot(ox, oz);
      if (od > 1.3 || od < 1e-6 || od > left + 0.6) continue; // far, or past where it's going
      if ((ox * ux + oz * uz) / od < 0.45) continue; // not ahead
      side = Math.max(side, (1.3 - od) / 1.3 * 1.6);
      if (!o.walking && od < 1.0) slow = 0.6;
    }
    const step = Math.min(left, speed * slow * dt), here = walkable(d, this.pos.x, this.pos.z);
    const tryDir = (k) => { const vx = ux - uz * k, vz = uz + ux * k, vl = Math.hypot(vx, vz); return { x: this.pos.x + vx / vl * step, z: this.pos.z + vz / vl * step }; };
    let next = tryDir(side);
    if (here && side && !walkable(d, next.x, next.z)) next = tryDir(-side); // the right is blocked: step left
    if (here && !walkable(d, next.x, next.z)) next = tryDir(0); // no room either side: straight on
    if (here && !walkable(d, next.x, next.z)) { // straight on runs into an edge: slide along it
      next = walkable(d, next.x, this.pos.z) ? { x: next.x, z: this.pos.z } : walkable(d, this.pos.x, next.z) ? { x: this.pos.x, z: next.z } : { x: this.pos.x, z: this.pos.z };
    }
    let nx = next.x, nz = next.z;
    for (const o of d.robots.values()) {
      if (o === this || !o.solid()) continue;
      const px = nx - o.pos.x, pz = nz - o.pos.z, pd = Math.hypot(px, pz);
      if (pd >= BOT_GAP) continue;
      const push = (BOT_GAP - pd) * (o.walking ? 0.5 : 1);
      const qx = pd > 1e-6 ? px / pd : -uz, qz = pd > 1e-6 ? pz / pd : ux;
      if (walkable(d, nx + qx * push, nz + qz * push) || !here) { nx += qx * push; nz += qz * push; }
    }
    // no room to give way (a bot by a bench or a wall): it doesn't squeeze past, it stops and looks for another way
    for (const o of d.robots.values()) {
      if (o === this || !o.solid()) continue;
      const nd = Math.hypot(nx - o.pos.x, nz - o.pos.z);
      // (a little give at the edge, so two bots just touching can still slide past each other: none ever comes nearer than BOT_GAP - 0.05)
      if (nd < BOT_GAP - 0.05 && nd < Math.hypot(this.pos.x - o.pos.x, this.pos.z - o.pos.z) - 1e-6) {
        nx = this.pos.x; nz = this.pos.z;
        if (!o.walking || o.stuckT > 0.5) { this.stuckT = Math.max(this.stuckT, 1.51); this.repathT = Math.min(this.repathT, 0.3); } // in its way for now: look for a way round soon
        break;
      }
    }
    const went = Math.hypot(nx - this.pos.x, nz - this.pos.z), near = this.near, dw = Math.hypot(wp.x - nx, wp.z - nz);
    if (Math.hypot(wp.x - near.x, wp.z - near.z) > 0.01) { near.x = wp.x; near.z = wp.z; near.d = Infinity; } // a new waypoint
    if (dw < near.d - 0.05) { near.d = dw; this.stuckT = 0; } else this.stuckT += dt;
    if (went > 1e-4) this.heading = angleDamp(this.heading, Math.atan2(nx - this.pos.x, nz - this.pos.z), 10, dt);
    if (went > 1e-3) this.stepT = 0.25; // its legs walk while it really moves (animate), not while it's held up
    this.pos.x = nx; this.pos.z = nz;
    return true;
  }
  // Its spot can only be reached past bots standing in the way: it lets the spot go for another of the kind, or (an
  // idle bot, with every idle spot taken) for a spare one. False when there's no other.
  moveOn() {
    const was = this.spot, kind = this.spotKind, s = this.d.claimSpot(this, kind, true);
    if (s && s !== was) return true;
    return kind === 'idle' && !!this.d.claimSpot(this, 'spare');
  }

  update(dt) {
    this.t += dt;
    const a = this.data;
    this.tickMoment(dt);
    if (a.status === 'idle' && !this.walking && !this.moment) { this.wanderT -= dt; if (this.wanderT <= 0) { this.wanderT = 9 + Math.random() * 9; this.newIdle = true; } }
    // entrances and exits
    if (this.mode === 'beamIn') {
      const k = this.t;
      this.beam.material.uniforms.opacity.value = k < 0.4 ? k / 0.4 : Math.max(0, 1 - (k - 1.1) / 0.6);
      this.scale = clamp(easeOutBack(clamp((k - 0.35) / 0.75, 0, 1)), 0, 1.2);
      if (k > 0.35 && !this._flashed) { this._flashed = true; _v.copy(this.pos).setY(0.9); this.d.group.localToWorld(_v); burstGlitter(_v, 0x6ae6f5, 70, 3); }
      if (k > 1.75) {
        this.mode = 'live'; disposeMesh(this.beam); this.beam = null; this.scale = 1;
        // landed: a quick salute, and the lead waves hello if it's free
        this.startMoment('salute', 1.3, { hold: true });
        const lead = this.d.lead(); if (lead && lead !== this && lead.free()) lead.startMoment('wave', 1.8, { hold: true, other: this });
      }
    } else if (this.mode === 'beamOut') {
      const k = this.t;
      this.beam.material.uniforms.opacity.value = k < 0.3 ? k / 0.3 : Math.max(0, 1 - (k - 0.9) / 0.5);
      this.scale = clamp(1 - (k - 0.35) / 0.5, 0, 1);
      if (k > 0.5 && !this._outFlash) { this._outFlash = true; _v.copy(this.pos).setY(0.9); this.d.group.localToWorld(_v); burstGlitter(_v, 0x6ae6f5, 50, 2.5); }
      if (k > 1.5) { this.gone = true; return; }
    }
    // movement
    let walking = false;
    if (this.mode === 'live' || this.mode === 'doorOut') {
      this.goal = this.goalFor();
      if (this.goal && this.snap) { this.pos.set(this.goal.x, 0, this.goal.z); this.heading = this.goal.face ?? 0; this.groundY = groundAt(this.pos.x, this.pos.z); }
      this.snap = false;
      if (this.goal) {
        if (Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) > 0.06) walking = this.walkToward(this.goal, this.delivering ? 2.1 : 1.7, dt);
        else {
          this.path = null; this.pathTo = null; this.stuckT = 0;
          this.heading = angleDamp(this.heading, this.goal.face ?? this.heading, 7, dt);
          if (this.goal.deliver && this.delivering) this.finishDelivery();
          if (this.mode === 'doorOut') { this.gone = true; return; }
        }
      }
    }
    this.walking = walking;
    if (this.moment && walking && !this.moment.hold) this.moment = null;
    this.atDesk = !walking && !!this.goal?.desk && this.mode === 'live' && Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) <= 0.06; // there, not waiting on the way
    // stand on the plaza, the pad or the grass, stepping up and down smoothly
    this.groundY = damp(this.groundY, groundAt(this.pos.x, this.pos.z), 14, dt);
    this.root.position.copy(this.pos).setY(this.groundY + BOT_FEET);
    this.root.rotation.y = this.heading;
    this.root.scale.setScalar(Math.max(0.001, this.scale) * BOT_SCALE);
    // desk screen shows what the bot is doing
    if (this.desk) {
      const show = this.desk.occupant === this;
      this.desk.screen.visible = show && this.atDesk && !this.d.asleep;
      if (show) {
        const sk = a.waiting ? 'wait' : a.status === 'error' ? 'error' : a.status === 'done' ? 'done' : (SCREEN_KIND[a.kind] || 'think');
        this.desk.screen.material = screenMats[sk];
      }
    }
    this.planMoment(dt);
    this.animate(dt);
    this.effects(dt);
  }

  finishDelivery() {
    this.delivering = false; this.delivered = true;
    if (this.carry) { this.bob.remove(this.carry); this.carry = null; }
    const c = this.d.addResultCube();
    c.getWorldPosition(_v); burstGlitter(_v, 0x6ae6f5, 60, 2.6);
    cityEvent('deliver', this); sfx('highfive');
    // high-five with the lead before heading back to the pad
    const lead = this.d.lead(), other = lead && lead !== this ? lead : null;
    this.startMoment('highfive', 1.6, { hold: true, other, fx: true });
    if (other && other.free()) other.startMoment('highfive', 1.6, { hold: true, other: this });
  }

  // ---- moods and life moments ----
  startMoment(name, dur, o = {}) { this.moment = { name, t: dur, dur, hold: !!o.hold, ambient: !!o.ambient, other: o.other || null, fx: !!o.fx, fired: false }; }
  free() { return this.mode === 'live' && !this.leaving && !this.walking && !this.data.waiting && this.data.status !== 'error' && !this.d.asleep && !(this.moment && !this.moment.ambient); }
  relAngle(o) { return o ? wrapA(Math.atan2(o.pos.x - this.pos.x, o.pos.z - this.pos.z) - this.heading) : 0; }
  neighboursLook() { for (const b of this.d.robots.values()) if (b !== this && !b.leaving) b.lookAt = { bot: this, t: 2 }; }
  tickMoment(dt) {
    const m = this.moment; if (!m) return;
    m.t -= dt;
    const o = m.other;
    if (m.t <= 0 || this.mode !== 'live' || this.leaving || this.d.asleep || this.data.waiting || (o && (o.gone || o.leaving || o.mode !== 'live'))) this.moment = null;
  }
  planMoment(dt) {
    if (this.moment || (this.momentT -= dt) > 0) return;
    const a = this.data;
    if (this.mode !== 'live' || this.walking || a.waiting || this.d.asleep || this.camDist > NEAR_FACE) { this.momentT = 3; return; }
    const r = Math.random(), pick = (list) => list[Math.floor(Math.random() * list.length)];
    if (a.status === 'idle') {
      this.momentT = (this.moodV === 'bored' ? 5 : 8) + Math.random() * 12;
      let pal = null; for (const b of this.d.robots.values()) if (b !== this && b.data.status === 'idle' && !b.moment && b.free() && b.pos.distanceTo(this.pos) < 4) { pal = b; break; }
      if (pal && r < 0.3) { this.startMoment('wave', 2.2, { hold: true, ambient: true, other: pal }); pal.startMoment('wave', 2.2, { hold: true, ambient: true, other: this }); pal.momentT = Math.max(pal.momentT, 6); return; }
      if (this.pos.distanceTo(KIOSK) < 3.3 && r < 0.55) { this.startMoment('coffee', 4.5, { ambient: true }); return; }
      const n = pick(['stretch', 'yawn', 'lookup', 'boogie']);
      this.startMoment(n, n === 'boogie' ? 3.5 : 2.6, { ambient: true });
    } else if (a.status === 'working' && this.atDesk) {
      this.momentT = 40 + Math.random() * 50;
      this.startMoment(pick(this.moodV === 'tired' ? ['yawn', 'yawn', 'lean', 'hmm'] : ['lean', 'knuckles', 'hmm']), 2.4, { ambient: true });
    } else this.momentT = 4;
  }
  // a mood grows from what the session is really doing; the strongest one wins
  mood() {
    const a = this.data, now = Date.now();
    if (this.proudT > 0) return 'proud';
    let errs = 0; for (const ts of this.errTs) if (now - ts < 300e3) errs++;
    if (errs >= 2) return 'grumpy';
    if (a.status === 'working') { const w = now - this.workSince; if (w > 20 * 60e3) return 'tired'; if (w > 3 * 60e3) return 'zone'; }
    if (a.status === 'idle' && now - this.idleSince > 5 * 60e3) return 'bored';
    return '';
  }
  waitedS() {
    const w = this.d.doc?.waiting;
    const since = (w && String(w.agent) === this.id && Number(w.since)) || this.localWaitSince;
    return Math.max(0, (Date.now() - since) / 1000);
  }
  // pose targets for a life moment; returns the face to show
  momentPose(m, tgt, t) {
    const k = 1 - m.t / m.dur;
    switch (m.name) {
      case 'salute': tgt.armRx = -2.75; tgt.armRz = 0.75; tgt.headX = -0.1; tgt.bob = 0.02; return 'wink';
      case 'wave': tgt.yaw = this.relAngle(m.other); tgt.armRx = -2.9; tgt.armRz = -0.2 + Math.sin(t * 10) * 0.35; tgt.headX = -0.1; return 'grin';
      case 'highfive': {
        const hit = k > 0.45;
        tgt.yaw = this.relAngle(m.other); tgt.lean = 0.12; tgt.armRx = hit ? -2.6 : -2.2 - k * 1.0; tgt.armRz = 0.3; tgt.bob = hit && k < 0.7 ? 0.12 : 0;
        if (hit && m.fx && !m.fired) {
          m.fired = true;
          this.armR.getWorldPosition(_v); if (m.other && !m.other.gone) { m.other.armR.getWorldPosition(_v2); _v.lerp(_v2, 0.5); }
          _v.addScaledVector(this.d.n, 0.45); burstGlitter(_v, 0xffd27d, 40, 2);
        }
        return hit ? 'star' : 'grin';
      }
      case 'dance': {
        const s = Math.sin(t * 12);
        tgt.yaw = k < 0.5 ? easeInOut(k / 0.5) * TAU : TAU;
        tgt.armLx = -2.8 + s * 0.25; tgt.armRx = -2.8 - s * 0.25; tgt.armLz = 0.3; tgt.armRz = -0.3; tgt.headX = -0.15;
        tgt.bob = Math.abs(Math.sin(t * 8)) * (k < 0.5 ? 0.08 : 0.22);
        return 'star';
      }
      case 'clap': {
        const s = (Math.sin(t * 14) + 1) / 2;
        tgt.yaw = this.relAngle(m.other); tgt.armLx = tgt.armRx = -1.35; tgt.armLz = 0.35 + s * 0.6; tgt.armRz = -tgt.armLz; tgt.bob = Math.abs(Math.sin(t * 7)) * 0.04;
        return 'grin';
      }
      case 'stretch': tgt.armLx = tgt.armRx = -2.95; tgt.armLz = 0.15; tgt.armRz = -0.15; tgt.headX = -0.3; tgt.lean = -0.05; tgt.bob = 0.04; return 'happy';
      case 'yawn': tgt.armRx = -2.1; tgt.armRz = 0.55; tgt.headX = -0.35; tgt.headZ = 0.08; return 'yawn';
      case 'lookup': tgt.headX = -0.65; tgt.headY = Math.sin(t * 0.8) * 0.4; return 'up';
      case 'boogie': {
        const s = Math.sin(t * 6);
        tgt.headZ = s * 0.2; tgt.bob = Math.abs(s) * 0.08; tgt.armLx = -0.7 + s * 0.6; tgt.armRx = -0.7 - s * 0.6;
        tgt.legL = Math.max(0, s) * -0.4; tgt.legR = Math.max(0, -s) * -0.4; tgt.yaw = Math.sin(t * 3) * 0.35;
        return 'grin';
      }
      case 'coffee': { const sip = Math.sin(t * 1.4) > 0.35; tgt.armRx = sip ? -2.05 : -1.15; tgt.armRz = sip ? 0.45 : 0.15; tgt.headX = sip ? -0.22 : 0.05; return sip ? 'happy' : 'normal'; }
      case 'lean': tgt.lean = -0.14; tgt.armLx = tgt.armRx = -2.9; tgt.armLz = 0.75; tgt.armRz = -0.75; tgt.headX = -0.3; return 'happy';
      case 'knuckles': { const sh = Math.sin(t * 30) * 0.06; tgt.armLx = tgt.armRx = -1.5; tgt.armLz = 0.62 + sh; tgt.armRz = -0.62 + sh; return 'determined'; }
      case 'hmm': tgt.armRx = -2.15; tgt.armRz = 0.4; tgt.headZ = 0.22; tgt.headX = -0.12; return 'up';
    }
    return 'normal';
  }

  animate(dt) {
    const a = this.data, P = this.pose, t = clockT.now + this.seed;
    const asleep = this.d.asleep, m = this.moment;
    let tgt = { legL: 0, legR: 0, armLx: 0, armRx: 0, armLz: 0.1, armRz: -0.1, headX: 0, headY: 0, headZ: 0, bob: 0, lean: 0, yaw: 0 };
    let face = 'normal', eye = EYE.working;
    if (this.cheerT > 0) this.cheerT -= dt;
    if (this.errT > 0) this.errT -= dt;
    if (this.proudT > 0) this.proudT -= dt;
    if ((this.moodT -= dt) <= 0) { this.moodT = 0.5; this.moodV = this.mood(); }
    const mood = this.moodV;
    if (this.mode === 'beamIn' || this.mode === 'beamOut') {
      tgt.armLz = 0.5; tgt.armRz = -0.5; face = 'happy'; eye = EYE.working;
    } else if (this.walking && this.stepT > 0) {
      this.walkPhase += dt * 10;
      const s = Math.sin(this.walkPhase);
      tgt.legL = s * 0.6; tgt.legR = -s * 0.6; tgt.armLx = -s * 0.5; tgt.armRx = s * 0.5; tgt.bob = Math.abs(Math.cos(this.walkPhase)) * 0.06;
      if (this.carry) { tgt.armLx = tgt.armRx = -1.25; tgt.armLz = 0.25; tgt.armRz = -0.25; face = 'happy'; eye = EYE.done; }
      else face = a.status === 'idle' ? 'normal' : a.status === 'done' ? 'happy' : 'focus';
    } else if (this.walking) {
      // held up by another bot on its way: it stands and looks about until the way clears
      tgt.headY = Math.sin(t * 1.6) * 0.45; tgt.bob = Math.sin(t * 1.6) * 0.01;
      if (this.carry) { tgt.armLx = tgt.armRx = -1.25; tgt.armLz = 0.25; tgt.armRz = -0.25; }
    } else if (asleep) {
      tgt.headX = 0.45; tgt.armLz = 0.05; tgt.armRz = -0.05; tgt.bob = Math.sin(t * 1.3) * 0.012 - 0.02; tgt.lean = 0.08;
      face = 'sleep'; eye = EYE.sleep;
    } else if (a.waiting) {
      // waiting on the Mayor: polite, then impatient (60 s), then fed up (3 min) with a big wave now and then
      const w = this.waitedS(); eye = EYE.wait;
      if (w > 180 && t % 6 > 1.4) {
        tgt.armLz = 0.03; tgt.armRz = -0.03; tgt.headX = 0.32; tgt.lean = 0.06; tgt.bob = Math.sin(t * 1.2) * 0.01; face = 'worried';
      } else if (w > 60) {
        const s = Math.sin(t * 10);
        tgt.armLx = -2.9 - s * 0.18; tgt.armRx = -2.9 + s * 0.18; tgt.armLz = 0.1 + s * 0.3; tgt.armRz = -0.1 + s * 0.3; tgt.headX = -0.38;
        tgt.legR = Math.max(0, Math.sin(t * 7)) * -0.35; tgt.bob = Math.abs(Math.sin(t * 5)) * 0.05; face = w > 180 ? 'worried' : 'wait';
      } else {
        tgt.armRx = -2.95 + Math.sin(t * 9) * 0.22; tgt.armRz = -0.25 + Math.sin(t * 9) * 0.15; tgt.headX = -0.38; tgt.headZ = Math.sin(t * 2) * 0.06;
        tgt.bob = Math.abs(Math.sin(t * 4.5)) * 0.04; face = 'wait';
      }
    } else if (m && !m.ambient) {
      face = this.momentPose(m, tgt, t); eye = EYE.done;
    } else if (this.cheerT > 0 || (a.status === 'done' && !this.isLead)) {
      const k = this.cheerT > 0 ? 1 : 0.35;
      tgt.armLx = tgt.armRx = -2.85 * k; tgt.armLz = 0.35 * k; tgt.armRz = -0.35 * k; tgt.bob = Math.abs(Math.sin(t * 7)) * 0.16 * k; tgt.headX = -0.15 * k;
      face = this.proudT > 0 ? 'grin' : 'happy'; eye = EYE.done;
    } else if (a.status === 'done') {
      tgt.headY = Math.sin(t * 0.7) * 0.3; face = this.proudT > 0 ? 'grin' : 'happy'; eye = EYE.done;
    } else if (a.status === 'error' || this.errT > 0) {
      tgt.headY = Math.sin(t * 13) * 0.28 * clamp(this.errT / 2.5, 0.25, 1);
      const scratch = Math.sin(t * 0.9) > 0.3;
      tgt.armRx = scratch ? -2.6 : 0; tgt.armRz = scratch ? -0.65 + Math.sin(t * 14) * 0.08 : -0.1; tgt.headZ = 0.14;
      face = 'x'; eye = EYE.error;
    } else if (m) {
      face = this.momentPose(m, tgt, t); eye = a.status === 'idle' ? EYE.idle : EYE.working;
    } else if (a.status === 'idle') {
      tgt.headY = Math.sin(t * 0.45) * 0.7; tgt.headX = mood === 'bored' ? 0.18 : Math.sin(t * 0.3) * 0.1; tgt.armLz = 0.12 + Math.sin(t * 0.8) * 0.04; tgt.armRz = -0.12 - Math.sin(t * 0.8) * 0.04;
      tgt.bob = Math.sin(t * 1.6) * 0.012; eye = EYE.idle;
      face = mood === 'bored' ? 'bored' : mood === 'grumpy' ? 'worried' : 'normal';
    } else {
      // at work: pose by the tool in hand, face by mood
      const k = a.kind, sp = mood === 'zone' ? 22 : 19;
      const type = (side) => -1.05 + Math.sin(t * sp + side) * 0.13;
      if (k === 'read') { tgt.armLx = tgt.armRx = -1.25; tgt.armLz = 0.32; tgt.armRz = -0.32; tgt.headX = 0.28; face = 'focus'; }
      else if (k === 'search') { tgt.armRx = -1.35 + Math.sin(t * 2.2) * 0.12; tgt.armRz = Math.sin(t * 2.2) * 0.42; tgt.headY = Math.sin(t * 2.2) * 0.35; tgt.headX = 0.12; face = 'focus'; }
      else if (k === 'think' || k === 'prompt') { tgt.armRx = -2.15; tgt.armRz = 0.35; tgt.headX = -0.2; tgt.headZ = 0.14; face = 'up'; eye = EYE.think; }
      else if (k === 'spawn') { tgt.armRx = -2.95; tgt.armRz = 0.1; tgt.headX = -0.25; tgt.headY = -0.4; face = 'normal'; }
      else if (k === 'web') { tgt.armLx = type(0); tgt.armRx = type(1.7); tgt.headX = -0.3; face = 'up'; }
      else { tgt.armLx = type(0); tgt.armRx = type(1.7); tgt.armLz = 0.18; tgt.armRz = -0.18; tgt.headX = 0.16 + Math.sin(t * 3) * 0.03; tgt.headY = Math.sin(t * 0.6) * 0.08; face = 'focus'; }
      tgt.bob = Math.sin(t * 2) * 0.008;
      if (face === 'focus' || face === 'normal') face = mood === 'proud' ? 'grin' : mood === 'grumpy' ? 'worried' : mood === 'zone' ? 'determined' : mood === 'tired' && Math.sin(t * 0.4) > 0.3 ? 'sweat' : face;
    }
    // a glance at a neighbour in trouble (head and eyes only; the bot stays put)
    let glance = 0;
    const lk = this.lookAt;
    if (lk) {
      lk.t -= dt;
      if (lk.t <= 0 || !lk.bot || lk.bot.gone || lk.bot.leaving) this.lookAt = null;
      else if (!this.walking && !asleep && this.mode === 'live' && !a.waiting) {
        const rel = wrapA(this.relAngle(lk.bot) - P.yaw);
        tgt.headY = clamp(rel, -0.9, 0.9); glance = rel > 0.15 ? 1 : rel < -0.15 ? -1 : 0;
      }
    }
    if (!(m && m.name === 'dance')) P.yaw = wrapA(P.yaw); // a finished spin settles forward instead of unwinding
    const L = 12;
    for (const k of Object.keys(P)) P[k] = damp(P[k], tgt[k], L, dt);
    this.legL.rotation.x = P.legL; this.legR.rotation.x = P.legR;
    this.armL.rotation.x = P.armLx; this.armR.rotation.x = P.armRx; this.armL.rotation.z = P.armLz; this.armR.rotation.z = P.armRz;
    this.head.rotation.set(P.headX, P.headY, P.headZ);
    this.bob.position.y = P.bob; this.bob.rotation.x = P.lean; this.bob.rotation.y = P.yaw;
    // blinks and idle glances only near the camera, so far-off faces don't redraw
    if (this.camDist < NEAR_FACE && !asleep && this.mode === 'live') {
      this.blinkT -= dt;
      if (this.blinkT < 0) { this.blink = 0.13; this.blinkT = 2.2 + Math.random() * 4; }
      if (this.blink > 0) this.blink -= dt;
      if ((this.glanceT -= dt) < 0) { this.glanceT = 3 + Math.random() * 4; const r = Math.random(); this.glance = r < 0.5 ? 0 : r < 0.75 ? -1 : 1; }
      if (!lk) glance = this.glance;
    } else { this.blink = 0; this.glance = 0; }
    this.drawFace(face, eye, BLINKY.has(face) ? glance : 0);
    // status light
    const sc = this.d.asleep ? STATUS_HEX.asleep : a.waiting ? STATUS_HEX.wait : STATUS_HEX[a.status] ?? STATUS_HEX.idle;
    this.tipMat.emissive.setHex(sc);
    this.tipMat.emissiveIntensity = a.waiting ? 2.5 + Math.sin(t * 9) * 1.5 : this.d.asleep ? 0.6 : 2.4;
    if (this.hover || this.selected) { this.bodyMat.emissive.setHex(0x1b3440); this.bodyMat.emissiveIntensity = 1; }
    else { this.bodyMat.emissive.setHex(this.color); this.bodyMat.emissiveIntensity = night.k * 0.16; }
  }

  prop(name, make) {
    this.props ||= {};
    if (!this.props[name]) { this.props[name] = make(); }
    return this.props[name];
  }
  showProps(kind) {
    const want = {
      book: kind === 'read', glass: kind === 'search', orbs: kind === 'think' || kind === 'prompt', gear: kind === 'mcp' || kind === 'tool' || kind === 'task',
      beacon: !!this.data.waiting, cup: this.moment?.name === 'coffee',
    };
    if (want.cup) this.prop('cup', () => { const c = new THREE.Mesh(CUP_GEO, CUP_MAT); c.position.set(0, -0.44, 0.07); this.armR.add(c); return c; });
    if (want.book) this.prop('book', () => {
      const g = new THREE.Group(); g.position.set(0, 0.62, 0.42);
      const cover = stdMat(0x3c66c9);
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.3), s < 0 ? cover : stdMat(0xfaf6ea)); p.position.x = s * 0.11; p.rotation.z = -s * 0.32; g.add(p); }
      this.bob.add(g); return g;
    });
    if (want.glass) this.prop('glass', () => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 8, 24), stdMat(0xd8b46a, { metalness: 0.7, roughness: 0.3 }));
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.45 }));
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 6), stdMat(0x3a2a20)); handle.position.y = -0.18;
      g.add(ring, lens, handle); g.position.set(0, -0.48, 0.1); g.rotation.x = Math.PI / 2; this.armR.add(g); return g;
    });
    if (want.orbs) this.prop('orbs', () => { const g = new THREE.Group(); for (let i = 0; i < 3; i++) g.add(new THREE.Mesh(RG.orb, ORB_MAT)); g.position.y = 1.75; this.root.add(g); return g; });
    if (want.gear) this.prop('gear', () => {
      const g = new THREE.Group(); const m = glowMat(0xb98bff, 1.2, 2.6, { base: 0x2a1e44 });
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 20), m));
      for (let i = 0; i < 8; i++) { const tth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), m); const an = i / 8 * TAU; tth.position.set(Math.cos(an) * 0.23, Math.sin(an) * 0.23, 0); g.add(tth); }
      g.position.y = 1.85; this.root.add(g); return g;
    });
    if (want.beacon) this.prop('beacon', () => { const b = makeBeam(0xffb547); b.scale.set(0.16, 7, 0.16); b.position.y = 1.7; this.root.add(b); return b; });
    if (this.props) for (const [k, o] of Object.entries(this.props)) {
      const on = !!want[k] && !this.d.asleep && this.mode === 'live' && (k === 'beacon' || !this.walking);
      o.visible = on;
      if (k === 'beacon') o.material.uniforms.opacity.value = on ? 0.55 + Math.sin(clockT.now * 8) * 0.35 : 0;
    }
    if (this.props?.orbs?.visible) { const o = this.props.orbs; o.children.forEach((m, i) => { const an = clockT.now * 2.6 + i * TAU / 3; m.position.set(Math.cos(an) * 0.42, Math.sin(an * 2) * 0.06, Math.sin(an) * 0.42); }); }
    if (this.props?.gear?.visible) { this.props.gear.rotation.z += 0.04; this.props.gear.rotation.y = Math.sin(clockT.now) * 0.4; }
  }

  effects(dt) {
    const a = this.data;
    this.showProps(a.kind);
    if (this.d.asleep || this.mode !== 'live') { this.clearArc(); this.clearTether(); this.zzz(dt); return; }
    this.fxT += dt;
    // sparks while editing or writing
    if (this.atDesk && (a.kind === 'edit' || a.kind === 'write') && a.status === 'working' && !a.waiting) {
      if (this.fxT > 0.05) {
        this.fxT = 0;
        this.armR.getWorldPosition(_v); _v2.set(0, 0.12, 0.6).applyQuaternion(this.root.getWorldQuaternion(_q)); _v.add(_v2); _v.y -= 0.32;
        for (let i = 0; i < 2; i++) glitter.emit({ x: _v.x, y: _v.y, z: _v.z, vx: (Math.random() - .5) * 2.4, vy: 1 + Math.random() * 1.6, vz: (Math.random() - .5) * 2.4, q: this.d.group.quaternion, life: 0.45 + Math.random() * 0.3, size: 0.12, size1: 0.02, color: Math.random() > .5 ? 0xffd27d : 0xfff1c0, gravity: 6 });
      }
    }
    // terminal glyphs while running commands
    if (this.atDesk && a.kind === 'bash' && a.status === 'working' && !a.waiting && this.fxT > 0.18) {
      this.fxT = 0; this.desk.screen.getWorldPosition(_v);
      glitter.emit({ x: _v.x + (Math.random() - .5) * 0.6, y: _v.y, z: _v.z + (Math.random() - .5) * 0.6, vy: 0.9, q: this.d.group.quaternion, life: 1.1, size: 0.1, size1: 0.02, color: 0x7ef59c });
    }
    // smoke when something broke
    if (a.status === 'error' && this.fxT > 0.5) {
      this.fxT = 0; this.head.getWorldPosition(_v);
      puffs.emit({ x: _v.x, y: _v.y, z: _v.z, vx: (Math.random() - .5) * 0.3, vy: 0.8, q: this.d.group.quaternion, life: 1.6, size: 0.35, size1: 1.0, alpha: 0.5, color: 0x5a5f70 });
    }
    // needs the Mayor: an amber arc from the bot to City Hall. Answered from the console, it turns green
    // (approved) or red (denied) for a moment, then the bot moves on
    if (this.flash && this.flash.until <= clockT.now) this.flash = null;
    if (a.waiting || this.flash) {
      const color = this.flash ? this.flash.color : 0xffb547;
      this.arcT -= dt;
      if (this.arcT <= 0 || this.arcColor !== color) {
        this.arcT = this.walking ? 0.25 : 1.2; this.arcColor = color;
        this.head.getWorldPosition(_v); _v.y += 0.6;
        const lift = 6 + _v.distanceTo(hallTop) * 0.22;
        const old = this.arc; this.arc = makeArc(_v.clone(), hallTop.clone(), color, lift, 0.075, 2.2); scene.add(this.arc); disposeMesh(old);
      }
      this.arc.material.uniforms.opacity.value = this.flash ? 1 : 0.65 + Math.sin(clockT.now * 6) * 0.3;
    } else this.clearArc();
    // helper tether back to the lead who sent it
    const lead = !this.isLead ? this.d.lead() : null;
    if (lead && a.status === 'working' && !this.delivering) {
      this.tetherT -= dt;
      if (this.tetherT <= 0) {
        this.tetherT = this.walking || lead.walking ? 0.2 : 1.5;
        lead.head.getWorldPosition(_v); this.head.getWorldPosition(_v2); _v.y += 0.55; _v2.y += 0.55;
        const old = this.tether; this.tether = makeArc(_v.clone(), _v2.clone(), 0x6ae6f5, 1.1 + _v.distanceTo(_v2) * 0.15, 0.03, 1.8); scene.add(this.tether); disposeMesh(old);
      }
    } else this.clearTether();
  }
  zzz(dt) {
    if (!this.d.asleep || this.mode !== 'live') { if (this.zs) this.zs.forEach((s) => (s.visible = false)); return; }
    if (!this.zs) { this.zs = [0, 1, 2].map(() => { const s = new THREE.Sprite(Z_MAT); s.scale.setScalar(0.3); this.root.add(s); return s; }); }
    this.zs.forEach((s, i) => {
      const k = ((clockT.now * 0.35 + i / 3 + this.seed) % 1);
      s.visible = true; s.position.set(0.25 + k * 0.4, 1.6 + k * 1.1, 0.1); s.scale.setScalar(0.18 + k * 0.22); s.material.opacity = 1 - k;
    });
  }
  clearArc() { if (this.arc) { disposeMesh(this.arc); this.arc = null; } this.arcT = 0; this.arcColor = null; }
  clearTether() { if (this.tether) { disposeMesh(this.tether); this.tether = null; } this.tetherT = 0; }

  displayName() { return this.nick; }
  roleText() { return 'Skybot · ' + roleWord(this); }
  activityText() {
    const a = this.data;
    if (a.waiting) return prefs.safe ? SAFE_TEXT.wait : (a.activity || 'Needs approval');
    if (this.d.asleep) return 'Asleep';
    return prefs.safe ? (SAFE_TEXT[a.kind] || SAFE_TEXT.think) : (a.activity || SAFE_TEXT[a.kind] || '');
  }
  statusKey() { return this.data.waiting && city.needs.has(this.d.id) ? 'wait' : this.d.asleep ? 'asleep' : this.data.waiting ? 'wait' : this.data.status || 'idle'; }

  dispose() {
    this.clearArc(); this.clearTether();
    if (this.beam) disposeMesh(this.beam);
    if (this.carry) this.bob.remove(this.carry);
    this.d.releaseDesk(this); this.d.releaseSpots(this);
    this.root.remove(this.label); this.labelEl.remove();
    this.d.group.remove(this.root);
    this.faceTex.dispose(); this.faceMat.dispose(); this.bodyMat.dispose(); this.tipMat.dispose();
    // props: free their own shapes (materials come from shared caches, except the beacon's and the lens)
    if (this.props) for (const [k, o] of Object.entries(this.props)) {
      if (k === 'beacon') { disposeMesh(o); continue; }
      o.traverse((m) => { if (m.geometry && m.geometry !== CUP_GEO && m.geometry !== RG.orb) m.geometry.dispose(); });
      if (k === 'glass') o.children[1].material.dispose();
    }
    if (selection.bot === this) selectBot(null);
  }
}
// Every agent is a Skybot with a name of its own, picked at random (but
// stable for that bot). A lead name that isn't an automatic one (only older recordings carry one) is kept as its nickname.
const BOT_NAMES = ['Ace', 'Acorn', 'Ada', 'Alfie', 'Amber', 'Apollo', 'Arlo', 'Aspen', 'Astro', 'Bagel', 'Basil', 'Bean', 'Biscuit', 'Blaze', 'Bloop', 'Bolt',
  'Bramble', 'Breezy', 'Brick', 'Bubbles', 'Buttons', 'Cactus', 'Cappy', 'Caramel', 'Cashew', 'Chai', 'Chip', 'Cinder', 'Clover', 'Cobalt', 'Comet', 'Cookie',
  'Copper', 'Cosmo', 'Crumpet', 'Dash', 'Dewey', 'Dino', 'Domino', 'Dot', 'Dumpling', 'Ember', 'Fable', 'Fig', 'Finn', 'Fizz', 'Flint', 'Flip', 'Fudge',
  'Ginger', 'Glimmer', 'Goose', 'Gumdrop', 'Hazel', 'Hopper', 'Iggy', 'Indigo', 'Ivy', 'Jazz', 'Jelly', 'Jinx', 'Jojo', 'Juniper', 'Kiwi', 'Koda', 'Lemon',
  'Lumen', 'Mango', 'Maple', 'Marbles', 'Mochi', 'Moss', 'Muffin', 'Nacho', 'Nimbus', 'Noodle', 'Nugget', 'Nutmeg', 'Olive', 'Onyx', 'Orbit', 'Otto',
  'Pebble', 'Peanut', 'Pepper', 'Pickle', 'Pico', 'Pip', 'Pixel', 'Plum', 'Pogo', 'Popcorn', 'Pretzel', 'Quill', 'Quinn', 'Radish', 'Ripple', 'Rivet',
  'Rocket', 'Rusty', 'Sable', 'Saffron', 'Scooter', 'Sesame', 'Sprocket', 'Sprout', 'Sputnik', 'Static', 'Sunny', 'Sushi', 'Taco', 'Tango', 'Tater',
  'Tinsel', 'Toffee', 'Tofu', 'Tumble', 'Turbo', 'Velvet', 'Waffles', 'Whisk', 'Widget', 'Yeti', 'Yoyo', 'Zap', 'Zephyr', 'Ziggy', 'Zuzu'];
// the lead's automatic names, never a nickname ('Claude Bot' was the lead's name before 'Skybot'; older recordings carry it)
const DEFAULT_LEAD_NAMES = new Set(['Nova', 'Atlas', 'Juno', 'Orion', 'Iris', 'Kai', 'Vega', 'Milo', 'Luna', 'Echo', 'Sol', 'Wren', 'Mayor-Bot', 'Skybot', 'Claude Bot', 'Claude', 'Lead', 'Bot', '']);
const nickCache = new Map();
function projectName(title) {
  const words = String(title || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join('').slice(0, 14);
}
// a lead's own name: anything that isn't one of the automatic defaults (only older recordings carry one)
function customLeadName(name, districtTitle) {
  const n = String(name || '').trim(), pn = projectName(districtTitle);
  if (DEFAULT_LEAD_NAMES.has(n) || n === pn || (pn && n.startsWith(pn.slice(0, 13)))) return '';
  return n;
}
// every Skybot gets its own name, picked at random from the list the first
// time it shows up and kept from then on (remembered in this browser)
const savedNicks = store.get('nicks', {});
function nickFor(key, taken) {
  if (nickCache.has(key)) return nickCache.get(key);
  let n = savedNicks[key];
  if (!n || (taken && taken.has(n))) {
    let i = hash(key) % BOT_NAMES.length;
    if (taken) for (let k = 0; k < BOT_NAMES.length && taken.has(BOT_NAMES[i]); k++) i = (i + 1) % BOT_NAMES.length;
    n = BOT_NAMES[i];
    savedNicks[key] = n;
    const keys = Object.keys(savedNicks); if (keys.length > 400) delete savedNicks[keys[0]];
    store.set('nicks', savedNicks);
  }
  nickCache.set(key, n); return n;
}
function takenNicks() {
  const s = new Set();
  for (const d of city.districts.values()) for (const b of d.robots.values()) if (!b.leaving && b.nick) s.add(b.nick);
  return s;
}
// "Scout", "Builder"… from a helper's reported name ("Scout 1", "Scout-1") or its agent type
function roleWord(bot) {
  if (bot.isLead) return 'Lead';
  const m = /^([A-Za-z]+)/.exec(String(bot.data.name || ''));
  return m && ROLE_COLORS[m[1]] ? m[1] : bot.role;
}
function angleDamp(a, b, lambda, dt) {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * (1 - Math.exp(-lambda * dt));
}
