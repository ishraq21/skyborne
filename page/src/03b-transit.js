
// =====================================================================
// transit: the Skyborne Loop monorail, hover-car traffic
// and the city blimp
// =====================================================================
const LOOP_Y = -0.9;
function loopRadius(ring) {
  if (ring === 1) return (HALL_R + (RING1_R - ISLAND_R)) / 2;
  const inner = RING1_R + (ring - 2) * RING_STEP + ISLAND_R, outer = RING1_R + (ring - 1) * RING_STEP - ISLAND_R;
  return (inner + outer) / 2;
}
const transit = { loops: new Map(), traffic: [], blimp: null, blimpA: 0 };

// ---- the monorail ----
let TRAIN_WIN = null;
function makeTrainCar(front, back) {
  TRAIN_WIN ||= glowMat(0xbfe9ff, 0.55, 2.6, { base: 0x22344a });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.85, 2.3, 3, 0.28), stdMat(0xf4f6fb, { roughness: 0.3, metalness: 0.2 })); body.castShadow = true; g.add(body);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.24, 1.9), TRAIN_WIN); win.position.y = 0.14; g.add(win);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.08, 2.1), stdMat(0xffb547)); stripe.position.y = -0.12; g.add(stripe);
  const bogie = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 1.5), stdMat(0x232838)); bogie.position.y = -0.52; g.add(bogie);
  for (const [isNose, z] of [[front, 1.12], [back, -1.12]]) {
    if (!isNose) continue;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.47, 16, 10, 0, TAU, 0, Math.PI / 2).rotateX(z > 0 ? Math.PI / 2 : -Math.PI / 2), stdMat(0xf4f6fb, { roughness: 0.3, metalness: 0.2 }));
    nose.scale.set(1, 0.9, 0.75); nose.position.z = z; g.add(nose);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.04), z > 0 ? glowMat(0xfff4d6, 1, 3.2) : glowMat(0xff3b3b, 0.8, 2.6));
    lamp.position.set(0, -0.08, z * 1.3); g.add(lamp);
  }
  mergeStatic(g);
  return g;
}
class Loop {
  constructor(ring) {
    this.ring = ring; this.r = loopRadius(ring); this.stations = new Map();
    this.group = new THREE.Group(); scene.add(this.group);
    const beam = new THREE.Mesh(new THREE.TorusGeometry(this.r, 0.24, 6, 220).rotateX(Math.PI / 2), stdMat(0xe9edf5, { roughness: 0.4, metalness: 0.25 }));
    beam.position.y = LOOP_Y; beam.castShadow = true; beam.receiveShadow = true; this.group.add(beam);
    const guide = new THREE.Mesh(new THREE.TorusGeometry(this.r, 0.05, 4, 220).rotateX(Math.PI / 2), glowMat(0x6ae6f5, 0.7, 2.4)); guide.position.y = LOOP_Y + 0.25; this.group.add(guide);
    const n = ring === 1 ? 6 : 6 * ring, step = TAU / n;
    const a0 = (ring === 1 ? 0.52 : 0.52 + (ring - 1) * 0.26) + step / 2; // halfway between districts
    for (let k = 0; k < n; k++) {
      const a = a0 + k * step;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 16, 8), stdMat(0xd7dbe5, { roughness: 0.6 }));
      p.position.set(Math.sin(a) * this.r, LOOP_Y - 8.2, Math.cos(a) * this.r); p.castShadow = true; this.group.add(p);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.6), stdMat(0xd7dbe5)); cap.position.set(Math.sin(a) * this.r, LOOP_Y - 0.3, Math.cos(a) * this.r); cap.rotation.y = a; this.group.add(cap);
    }
    if (ring === 2) { // spokes back to the inner loop, between the inner districts
      const r1 = loopRadius(1), len = this.r - r1;
      for (let k = 0; k < 3; k++) {
        const a = 0.52 + Math.PI / 6 + k * (TAU / 3);
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, len), stdMat(0xe9edf5, { roughness: 0.4 }));
        s.position.set(Math.sin(a) * (r1 + len / 2), LOOP_Y, Math.cos(a) * (r1 + len / 2)); s.rotation.y = a; s.castShadow = true; this.group.add(s);
      }
    }
    mergeStatic(this.group);
    this.cars = [makeTrainCar(true, false), makeTrainCar(false, false), makeTrainCar(false, true)];
    for (const c of this.cars) this.group.add(c);
    this.ang = Math.random() * TAU; this.v = 0; this.state = 'run'; this.dwell = 0; this.sinceStop = 99;
  }
  addStation(d) {
    if (this.stations.has(d.id)) return;
    const a = d.slotAngle, g = new THREE.Group();
    g.position.set(Math.sin(a) * (this.r + 1.3), LOOP_Y + 0.05, Math.cos(a) * (this.r + 1.3)); g.rotation.y = a;
    const plat = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 1.3), stdMat(0xe9e4d8)); plat.castShadow = true; plat.receiveShadow = true; g.add(plat);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.03, 0.08), stdMat(0xffd43b)); edge.position.set(0, 0.1, -0.6); g.add(edge);
    for (const x of [-1.4, 1.4]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), stdMat(0x3b4152)); post.position.set(x, 0.66, 0.45); g.add(post); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 1.45), stdMat(d.hue)); roof.position.set(0, 1.28, 0.1); roof.castShadow = true; g.add(roof);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 0.05), glowMat(0x6ae6f5, 0.8, 2.6)); strip.position.set(0, 1.22, -0.6); g.add(strip);
    mergeStatic(g);
    this.group.add(g);
    this.stations.set(d.id, { a: a + 2.45 / this.r, mesh: g });
  }
  removeStation(d) {
    const s = this.stations.get(d.id); if (!s) return;
    this.group.remove(s.mesh); s.mesh.traverse((o) => o.geometry?.dispose()); this.stations.delete(d.id);
  }
  update(dt) {
    const vmax = 6.5, acc = 2.4;
    if (this.state === 'dwell') { this.dwell -= dt; if (this.dwell <= 0) { this.state = 'run'; this.sinceStop = 0; } }
    else {
      let dist = Infinity;
      for (const s of this.stations.values()) {
        let da = ((s.a - this.ang) % TAU + TAU) % TAU;
        if (da * this.r < 0.3 && this.sinceStop < 0.5) da += TAU; // just left this one
        dist = Math.min(dist, da * this.r);
      }
      const cap = dist === Infinity ? vmax * 0.6 : Math.sqrt(2 * acc * Math.max(0, dist - 0.02)) + 0.05;
      this.v = Math.min(vmax, this.v + acc * dt, cap);
      const step = this.v * dt;
      if (dist !== Infinity && step >= dist) { this.ang += dist / this.r; this.state = 'dwell'; this.dwell = 2.6; this.v = 0; }
      else { this.ang += step / this.r; this.sinceStop += step; }
      this.ang %= TAU;
    }
    this.cars.forEach((c, i) => {
      const a = this.ang - i * (2.45 / this.r);
      c.position.set(Math.sin(a) * this.r, LOOP_Y + 0.88, Math.cos(a) * this.r);
      c.rotation.y = Math.atan2(Math.cos(a), -Math.sin(a));
    });
  }
}
function ensureLoop(ring) {
  if (!transit.loops.has(ring)) transit.loops.set(ring, new Loop(ring));
  return transit.loops.get(ring);
}

// ---- hover cars on sky lanes, and the city blimp ----
function makeHoverCar(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.3, 1.3, 2, 0.13), stdMat(color, { roughness: 0.3, metalness: 0.35 })); body.castShadow = true; g.add(body);
  const can = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 8, 0, TAU, 0, Math.PI / 2), stdMat(0x2b3550, { roughness: 0.15, metalness: 0.5 })); can.scale.set(1, 0.85, 1.7); can.position.set(0, 0.13, 0.05); g.add(can);
  for (const x of [-0.4, 0.4]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.62, 10).rotateX(Math.PI / 2), stdMat(0xd7dbe5)); pod.position.set(x, -0.04, -0.15); g.add(pod);
    const jet = new THREE.Mesh(new THREE.CircleGeometry(0.1, 10), glowMat(0x6ae6f5, 2, 3.4)); jet.position.set(x, -0.04, -0.47); jet.rotation.y = Math.PI; g.add(jet);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.03), glowMat(0xfff4d6, 1, 3)); head.position.set(0, 0, 0.66); g.add(head);
  mergeStatic(g);
  g.scale.setScalar(2.2); // city scale: about the size of the cars on the district roads
  return g;
}
function makeBlimp() {
  const g = new THREE.Group();
  const env = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 20), stdMat(0xf2f4f8, { roughness: 0.5 })); env.scale.set(2.7, 2.7, 8.2); env.castShadow = true; g.add(env);
  const fin = stdMat(0xffb547);
  for (const [x, y, w, h] of [[0, 1.5, 0.12, 2.0], [0, -1.5, 0.12, 2.0], [1.5, 0, 2.0, 0.12], [-1.5, 0, 2.0, 0.12]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.7), fin); f.position.set(x, y, -6.9); f.castShadow = true; g.add(f); }
  const gond = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.6, 2.6, 2, 0.2), stdMat(0x2c3142)); gond.position.y = -2.95; g.add(gond);
  const gw = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.16, 2.2), glowMat(0xffd59a, 0.6, 2.4)); gw.position.y = -2.9; g.add(gw);
  const tex = canvasTex(1024, 200, (c, w, h) => {
    c.fillStyle = '#141a2e'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#ffb547'; c.fillRect(0, h - 14, w, 14); c.fillStyle = '#6ae6f5'; c.fillRect(0, 0, w, 8);
    c.fillStyle = '#ffffff'; c.font = '800 112px Unbounded, "Arial Black", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SKYBORNE', w / 2, h / 2 - 4);
  });
  const bm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.6 });
  nightLit.push({ m: bm, dayI: 0.25, nightI: 1.3, dim: 1 });
  for (const s of [1, -1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.7), bm); p.position.x = s * 2.74; p.rotation.y = s * Math.PI / 2; g.add(p); }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), glowMat(0xff5050, 1.5, 3.2)); nose.position.z = 8.25; g.add(nose);
  mergeStatic(g);
  return g;
}
function buildSkyTraffic() {
  // [radius, height, turn speed]: above the tallest towers (an HQ tops out near 17)
  const lanes = [[34, 22, 0.13], [56, 24, -0.09], [78, 27, 0.075], [98, 23, -0.065], [118, 31, 0.055], [42, 28, -0.11], [67, 33, 0.08]];
  const colors = [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xf783ac, 0x9775fa, 0x38d9a9];
  lanes.forEach(([R, H, w], i) => { const g = makeHoverCar(colors[i % colors.length]); scene.add(g); transit.traffic.push({ g, R, H, w, a: Math.random() * TAU, bob: Math.random() * TAU }); });
  transit.blimp = makeBlimp(); scene.add(transit.blimp);
}
function updateTransit(dt) {
  for (const l of transit.loops.values()) l.update(dt);
  for (const c of transit.traffic) {
    c.a += c.w * dt;
    const s = Math.sign(c.w);
    c.g.position.set(Math.sin(c.a) * c.R, c.H + Math.sin(clockT.now * 0.7 + c.bob) * 0.6, Math.cos(c.a) * c.R);
    c.g.rotation.set(0, Math.atan2(s * Math.cos(c.a), -s * Math.sin(c.a)), -s * 0.2, 'YXZ');
  }
  if (transit.blimp) {
    transit.blimpA += dt * 0.02;
    const a = transit.blimpA, R = 140;
    transit.blimp.position.set(Math.sin(a) * R, 46 + Math.sin(clockT.now * 0.3) * 1.2, Math.cos(a) * R);
    transit.blimp.rotation.set(Math.sin(clockT.now * 0.4) * 0.03, Math.atan2(Math.cos(a), -Math.sin(a)), 0, 'YXZ');
  }
}
