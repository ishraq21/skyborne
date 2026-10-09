
// =====================================================================
// shared materials, textures, effects
// =====================================================================
const clockT = { now: 0 }; // seconds since boot, shared by shaders and animation
const matCache = new Map();
function stdMat(hex, o = {}) {
  const key = 'std:' + hex + ':' + JSON.stringify(o);
  if (!matCache.has(key)) { const { flat, ...rest } = o; matCache.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.82, metalness: 0.0, flatShading: !!flat, ...rest })); }
  return matCache.get(key);
}
function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.userData = { canvas: c, ctx: g };
  return t;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

// Lit things that glow harder at night (windows, lamps, screens).
const nightLit = [];
const glowCache = new Map();
// shared by everything that asks for the same glow (so it can be baked together);
// pass own: true for a material that one object animates by itself
function glowMat(hex, dayI, nightI, o = {}) {
  const { base, own, ...rest } = o;
  const key = own ? null : [hex, dayI, nightI, base ?? '', JSON.stringify(rest)].join('|');
  if (key && glowCache.has(key)) return glowCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color: base ?? 0x222222, emissive: hex, emissiveIntensity: dayI, roughness: 0.6, ...rest });
  nightLit.push({ m, dayI, nightI, dim: 1, shared: !!key });
  if (key) glowCache.set(key, m);
  return m;
}

// ---------------- draw-call diet ----------------
// Static parts are baked into one mesh per material, so a whole neighbourhood
// costs a few dozen draw calls instead of hundreds. Anything flagged
// userData.keep (moving parts, picking targets) is left exactly as it is.
function canBake(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || o.renderOrder !== 0 || o.children.length) return false;
  if (o.userData.keep || o.userData.robot || o.userData.district) return false;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  return mats.every((m) => m && m.visible !== false && !m.isShaderMaterial);
}
function sliceGeo(g, start, count) {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) out.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(start * attr.itemSize, (start + count) * attr.itemSize), attr.itemSize, attr.normalized));
  return out;
}
function bakeReady(g, mat, uv) {
  for (const name of Object.keys(g.attributes)) if (!(name === 'position' || name === 'normal' || (name === 'uv' && uv) || (name === 'color' && mat.vertexColors))) g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  if (uv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (mat.vertexColors && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.clearGroups(); g.morphAttributes = {};
  return g;
}
function flipWinding(g) {
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array, s = attr.itemSize;
    for (let t = 0; t + 2 < attr.count; t += 3) for (let k = 0; k < s; k++) { const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k, tmp = a[i1]; a[i1] = a[i2]; a[i2] = tmp; }
  }
}
// Plain coloured parts (no textures, no glow, opaque) that differ only in colour bake into one mesh: each
// part's colour is painted into its vertices and they share one material per surface (roughness, metalness,
// flat shading). Only a material whose every other setting is the default is painted, and nothing changes these
// materials after they're made (a material changed at run time must not be baked: flag its mesh userData.keep).
const paintCache = new Map();
function paintable(m) {
  return m.type === 'MeshStandardMaterial' && !m.vertexColors && !m.map && !m.emissiveMap && !m.alphaMap && !m.normalMap && !m.bumpMap && !m.roughnessMap
    && !m.metalnessMap && !m.aoMap && !m.lightMap && !m.envMap && m.emissive.getHex() === 0 && !m.transparent && m.opacity === 1 && m.side === THREE.FrontSide
    && !m.displacementMap && !m.alphaTest && m.fog && m.toneMapped && !m.clippingPlanes && m.colorWrite && !m.dithering && !m.premultipliedAlpha
    && m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile && Object.keys(m.defines || {}).every((k) => k === 'STANDARD')
    && m.blending === THREE.NormalBlending && m.depthTest && m.depthWrite && !m.polygonOffset && !m.wireframe && m.visible && m.envMapIntensity === 1;
}
function paintMat(m) {
  const key = [m.roughness, m.metalness, m.flatShading].join('|');
  if (!paintCache.has(key)) {
    const p = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: m.roughness, metalness: m.metalness, flatShading: m.flatShading });
    p.name = 'painted'; paintCache.set(key, p);
  }
  return paintCache.get(key);
}
function paintGeoColour(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
}
// items: [mesh, matrix relative to where the baked group will sit]
function bakeItems(items) {
  const buckets = new Map();
  for (const [o, rel] of items) {
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(rel);
    if (rel.determinant() < 0) flipWinding(g);
    const multi = Array.isArray(o.material), total = g.attributes.position.count;
    const parts = multi && g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const grp of parts) {
      let mat = multi ? o.material[grp.materialIndex] : o.material;
      const count = Math.min(grp.count, total - grp.start);
      if (!mat || count <= 0) continue;
      const sub = grp.start === 0 && count === total ? g : sliceGeo(g, grp.start, count);
      if (paintable(mat)) { paintGeoColour(sub, mat.color); mat = paintMat(mat); }
      const key = mat.uuid + (o.castShadow ? ':c' : '') + (o.receiveShadow ? ':r' : '');
      let b = buckets.get(key); if (!b) buckets.set(key, b = { mat, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
      b.geos.push(sub);
    }
  }
  const out = new THREE.Group();
  for (const b of buckets.values()) {
    const uv = b.mat.name !== 'painted' && b.geos.some((g) => g.attributes.uv);
    for (const g of b.geos) bakeReady(g, b.mat, uv);
    const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (!geo) continue;
    if (b.geos.length > 1) for (const g of b.geos) g.dispose();
    const m = new THREE.Mesh(geo, b.mat); m.castShadow = b.cast; m.receiveShadow = b.recv; m.matrixAutoUpdate = false;
    out.add(m);
  }
  out.userData.keep = true; out.userData.baked = true;
  return out;
}
// take the bakeable meshes out of `root` (matrices relative to `frame`)
function collectStatic(root, frame = root) {
  frame.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert(), items = [];
  const walk = (o) => {
    if (o !== root && o.userData.keep) return;
    for (const c of [...o.children]) walk(c);
    if (canBake(o)) { items.push([o, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)]); o.parent.remove(o); }
  };
  walk(root);
  return items;
}
// free GPU buffers of geometries nothing in the scene uses any more
function freeGeometries(items) {
  const used = new Set(); scene.traverse((o) => { if (o.geometry) used.add(o.geometry); });
  for (const [o] of items) if (!used.has(o.geometry)) o.geometry.dispose();
}
const protoCache = new Map();
function protoClone(key, make) {
  if (!protoCache.has(key)) { const g = make(); mergeStatic(g); protoCache.set(key, g); }
  const c = protoCache.get(key).clone();
  c.traverse((o) => { if (o.userData.baked) o.userData.baked = false; }); // shares the prototype's geometry
  return c;
}
function mergeStatic(root) {
  const items = collectStatic(root);
  if (!items.length) return null;
  const baked = bakeItems(items);
  root.add(baked);
  return baked;
}
function updateNightLit() {
  for (const e of nightLit) e.m.emissiveIntensity = lerp(e.dayI, e.nightI, night.k) * e.dim;
}

// ---- hologram screen textures (shared, animated by scrolling) ----
function screenTex(kind) {
  const W = 256, H = 160;
  const palette = { code: ['#7ef0c0', '#ffd27d', '#9bc1ff', '#ff9fd0'], term: ['#7ef59c'], read: ['#cfe0ff'], web: ['#6ae6f5'], search: ['#c9a8ff'], task: ['#ffd27d'] };
  return canvasTex(W, H, (g) => {
    g.fillStyle = 'rgba(8,16,30,0.0)'; g.fillRect(0, 0, W, H);
    const r = rng(hash(kind));
    if (kind === 'code' || kind === 'term' || kind === 'read' || kind === 'task') {
      const cols = palette[kind];
      for (let y = 10; y < H; y += 13) {
        let x = 12 + (kind === 'code' ? Math.floor(r() * 4) * 14 : 0);
        if (kind === 'term') { g.fillStyle = '#7ef59c'; g.fillRect(8, y, 7, 7); x = 22; }
        if (kind === 'task') { g.strokeStyle = '#ffd27d'; g.lineWidth = 2; g.strokeRect(10, y - 1, 8, 8); if (r() > .45) { g.beginPath(); g.moveTo(11, y + 3); g.lineTo(14, y + 6); g.lineTo(19, y - 1); g.stroke(); } x = 26; }
        const segs = 1 + Math.floor(r() * 3);
        for (let s = 0; s < segs && x < W - 20; s++) {
          const w = 18 + r() * 70; g.fillStyle = cols[Math.floor(r() * cols.length)];
          g.globalAlpha = kind === 'read' ? 0.75 : 0.95; g.fillRect(x, y, Math.min(w, W - 12 - x), 6); x += w + 8;
        }
      }
    } else if (kind === 'web') {
      g.strokeStyle = '#6ae6f5'; g.lineWidth = 3; g.globalAlpha = .95;
      g.beginPath(); g.arc(W / 2, H / 2, 52, 0, TAU); g.stroke();
      g.beginPath(); g.ellipse(W / 2, H / 2, 22, 52, 0, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(W / 2 - 52, H / 2); g.lineTo(W / 2 + 52, H / 2); g.stroke();
      g.beginPath(); g.ellipse(W / 2, H / 2, 52, 18, 0, 0, TAU); g.stroke();
    } else if (kind === 'search') {
      g.strokeStyle = '#c9a8ff'; g.lineWidth = 7; g.beginPath(); g.arc(W / 2 - 12, H / 2 - 10, 34, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(W / 2 + 13, H / 2 + 15); g.lineTo(W / 2 + 46, H / 2 + 48); g.stroke();
    } else if (kind === 'error') {
      g.fillStyle = '#ff6b6b'; g.globalAlpha = .9; g.fillRect(16, 16, W - 32, H - 32);
      g.globalAlpha = 1; g.strokeStyle = '#2a0606'; g.lineWidth = 12; g.beginPath(); g.moveTo(W / 2 - 26, H / 2 - 26); g.lineTo(W / 2 + 26, H / 2 + 26); g.moveTo(W / 2 + 26, H / 2 - 26); g.lineTo(W / 2 - 26, H / 2 + 26); g.stroke();
    } else if (kind === 'done') {
      g.strokeStyle = '#7db8ff'; g.lineWidth = 12; g.beginPath(); g.moveTo(W / 2 - 40, H / 2); g.lineTo(W / 2 - 10, H / 2 + 30); g.lineTo(W / 2 + 44, H / 2 - 30); g.stroke();
    } else if (kind === 'wait') {
      g.fillStyle = '#ffb547'; g.font = 'bold 110px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', W / 2, H / 2 + 6);
    } else if (kind === 'think') {
      g.fillStyle = '#b7c3ff'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(W / 2 - 36 + i * 36, H / 2, 11, 0, TAU); g.fill(); }
    } else { // idle: the city mark
      g.strokeStyle = 'rgba(106,230,245,.55)'; g.lineWidth = 4; g.beginPath(); g.arc(W / 2, H / 2, 30, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(255,181,71,.7)'; g.beginPath(); g.arc(W / 2, H / 2, 9, 0, TAU); g.fill();
    }
    g.globalAlpha = 1; g.strokeStyle = 'rgba(160,220,255,.35)'; g.lineWidth = 3; roundRect(g, 3, 3, W - 6, H - 6, 12); g.stroke();
  }, { repeat: kind === 'code' || kind === 'term' || kind === 'read' || kind === 'task' });
}
const SCREEN_KIND = { bash: 'term', edit: 'code', write: 'code', read: 'read', search: 'search', web: 'web', spawn: 'think', task: 'task', mcp: 'task', tool: 'task', think: 'think', wait: 'wait', error: 'error', done: 'done', answer: 'done', idle: 'idle' };
const screenTextures = {};
const screenMats = {};
for (const k of ['code', 'term', 'read', 'web', 'search', 'error', 'done', 'wait', 'think', 'task', 'idle']) {
  screenTextures[k] = screenTex(k);
  screenMats[k] = new THREE.MeshBasicMaterial({ map: screenTextures[k], transparent: true, opacity: 0.92, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}
function animateScreens(dt) {
  screenTextures.code.offset.y -= dt * 0.18;
  screenTextures.term.offset.y -= dt * 0.32;
  screenTextures.read.offset.y -= dt * 0.06;
  screenTextures.task.offset.y -= dt * 0.04;
  screenMats.think.opacity = 0.6 + Math.sin(clockT.now * 4) * 0.3;
  screenMats.wait.opacity = 0.55 + (Math.sin(clockT.now * 7) > 0 ? 0.4 : 0);
}

// ---- particles: one additive field (sparks, glitter) and one normal field (confetti, steam, dust) ----
const _pv = new THREE.Vector3(), _pu = new THREE.Vector3();
class Particles {
  constructor(capacity, additive, square) {
    this.cap = capacity; this.n = 0;
    this.pos = new Float32Array(capacity * 3); this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity); this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3); this.life = new Float32Array(capacity); this.max = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity); this.s1 = new Float32Array(capacity); this.a0 = new Float32Array(capacity);
    this.grav = new Float32Array(capacity * 3); this.drag = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uProj: { value: 600 } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float uProj; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(size * uProj / -mv.z, 0.0, 96.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: square
        ? `varying vec3 vC; varying float vA; void main(){ vec2 p = abs(gl_PointCoord - 0.5); if (max(p.x, p.y) > 0.42) discard; gl_FragColor = vec4(vC, vA); }`
        : `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = smoothstep(0.5, 0.05, d) * vA; gl_FragColor = vec4(vC * (1.0 + a * 0.4), a); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
  }
  // p.q (optional): a quaternion for the local frame the velocity is written in,
  // so "up" on a district means away from the planet, not world +y.
  emit(p) {
    if (this.n >= this.cap) return;
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    _pv.set(p.vx || 0, p.vy || 0, p.vz || 0); _pu.set(0, 1, 0);
    if (p.q) { _pv.applyQuaternion(p.q); _pu.applyQuaternion(p.q); }
    this.vel[i3] = _pv.x; this.vel[i3 + 1] = _pv.y; this.vel[i3 + 2] = _pv.z;
    const gg = p.gravity ?? 0; this.grav[i3] = -_pu.x * gg; this.grav[i3 + 1] = -_pu.y * gg; this.grav[i3 + 2] = -_pu.z * gg;
    _cA.setHex(p.color ?? 0xffffff); this.col[i3] = _cA.r; this.col[i3 + 1] = _cA.g; this.col[i3 + 2] = _cA.b;
    this.life[i] = 0; this.max[i] = p.life || 1; this.s0[i] = p.size ?? 0.3; this.s1[i] = p.size1 ?? this.s0[i];
    this.a0[i] = p.alpha ?? 1; this.drag[i] = p.drag ?? 0;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] += dt;
      if (this.life[i] >= this.max[i]) { this.swap(i, --this.n); continue; }
      const i3 = i * 3, k = this.life[i] / this.max[i], dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] = this.vel[i3] * dr + this.grav[i3] * dt; this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i3 + 1] * dt; this.vel[i3 + 2] = this.vel[i3 + 2] * dr + this.grav[i3 + 2] * dt;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      this.size[i] = lerp(this.s0[i], this.s1[i], k);
      this.alpha[i] = this.a0[i] * (k < 0.1 ? k / 0.1 : 1 - Math.pow((k - 0.1) / 0.9, 2));
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const a of ['position', 'color', 'size', 'alpha']) g.attributes[a].needsUpdate = true;
  }
  swap(a, b) {
    if (a === b) return;
    for (const [arr, w] of [[this.pos, 3], [this.col, 3], [this.vel, 3], [this.grav, 3]]) for (let j = 0; j < w; j++) arr[a * w + j] = arr[b * w + j];
    for (const arr of [this.size, this.alpha, this.life, this.max, this.s0, this.s1, this.a0, this.drag]) arr[a] = arr[b];
  }
}
const glitter = new Particles(5000, true, false);
const confetti = new Particles(4000, false, true);
const puffs = new Particles(2500, false, false);
function setParticleProj() {
  const v = (viewH * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  glitter.mat.uniforms.uProj.value = v; confetti.mat.uniforms.uProj.value = v; puffs.mat.uniforms.uProj.value = v;
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const CONFETTI = [0xffb547, 0x6ae6f5, 0xff7aa8, 0x7ef0a0, 0xb49ae8, 0xfff07a];
function burstConfetti(p, n = 140, q = null) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = 2 + Math.random() * 5;
    confetti.emit({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * s, vy: 5 + Math.random() * 7, vz: Math.sin(a) * s, q, life: 2.4 + Math.random(), size: 0.16 + Math.random() * 0.1, color: CONFETTI[i % CONFETTI.length], gravity: 9, drag: 1.6 });
  }
}
function burstGlitter(p, color, n = 60, speed = 3) {
  for (let i = 0; i < n; i++) {
    _v.set(Math.random() - .5, Math.random() - .2, Math.random() - .5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    glitter.emit({ x: p.x, y: p.y, z: p.z, vx: _v.x, vy: _v.y, vz: _v.z, life: 0.7 + Math.random() * 0.8, size: 0.22, size1: 0.02, color, drag: 2.2, gravity: -0.4 });
  }
}
function dustRing(p, color = 0xd8cfc0, n = 40, r = 2, q = null) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    puffs.emit({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * r * 1.6, vy: 0.4 + Math.random() * 0.5, vz: Math.sin(a) * r * 1.6, q, life: 1.2 + Math.random() * 0.6, size: 0.9, size1: 2.2, alpha: 0.5, color, drag: 2.0 });
  }
}

// ---- light beams (spawn / leave) and energy arcs (needs the Mayor, helper tethers) ----
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
// fade is clamped: interpolation can pass 1.0 at the top edge, and pow of a negative number is NaN, which the
// bloom spreads over the whole frame (black, on real graphics cards)
function makeBeam(color) {
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 }, time: clockT },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 color; uniform float opacity; uniform float time; varying vec2 vUv;
      void main(){ float fade = pow(max(1.0 - vUv.y, 0.0), 1.6); float bands = 0.65 + 0.35 * sin(vUv.y * 40.0 - time * 9.0);
        gl_FragColor = vec4(color * 1.6, fade * bands * opacity); }`,
  });
  const mesh = new THREE.Mesh(beamGeo, m); mesh.renderOrder = 6; mesh.frustumCulled = false;
  return mesh;
}
const arcMatProto = (color, speed) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 1 }, time: clockT, speed: { value: speed } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 color; uniform float opacity; uniform float time; uniform float speed; varying vec2 vUv;
    void main(){ float dash = smoothstep(0.35, 0.5, fract(vUv.x * 14.0 - time * speed)) * smoothstep(1.0, 0.85, fract(vUv.x * 14.0 - time * speed));
      float ends = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
      gl_FragColor = vec4(color * 1.8, (0.25 + dash * 0.75) * ends * opacity); }`,
});
function makeArc(a, b, color, lift, radius = 0.06, speed = 1.4) {
  const mid = _v.copy(a).add(b).multiplyScalar(0.5);
  mid.addScaledVector(_v2.copy(mid).sub(PC).normalize(), lift);
  const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid.clone(), b.clone());
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, radius, 6, false), arcMatProto(color, speed));
  mesh.renderOrder = 6; mesh.frustumCulled = false; mesh.userData.curve = curve;
  return mesh;
}
function disposeMesh(m) { if (!m) return; m.parent && m.parent.remove(m); m.geometry && m.geometry.dispose(); if (m.material && !m.material.userData?.shared) m.material.dispose?.(); }

// =====================================================================
// clouds
// =====================================================================
// Soft clouds. Each cloud is a cluster of see-through puffs: quads that always face the camera, drawn with
// a puff texture made here at start (billowy blobs with noisy, wispy edges, shaded from above). A cloud is
// one draw call; its puffs are re-sorted back to front as the camera moves, so the layers overlap the right
// way. Colours follow the time of day (night.cloud). Below the city: the cloud sea, a softly lit drifting
// floor with big puffs on it.

// smooth 2D value noise; p (in cells) makes it tile
function valueNoise(seed) {
  const r = rng(seed), N = 256, lat = new Float32Array(N * N);
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const g = (i, j, p) => lat[(((j % p) + p) % p % N) * N + (((i % p) + p) % p % N)];
  return (x, y, p = N) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g(xi, yi, p), b = g(xi + 1, yi, p), c = g(xi, yi + 1, p), d = g(xi + 1, yi + 1, p);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(noise, x, y, oct, p) { let s = 0, w = 0.5, t = 0; for (let o = 0; o < oct; o++) { s += noise(x, y, p) * w; t += w; x *= 2; y *= 2; if (p) p *= 2; w *= 0.5; } return s / t; }
function dataTex(data, size) {
  const t = new THREE.DataTexture(data, size, size);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
// four puff shapes in a 2×2 atlas: a lumpy, irregular outline that frays into wisps (warped noise over a soft
// dome with a flatter bottom), a solid core. R: how lit (bright top, shaded bottom, lumps inside), A: density
const PUFF_TEX = (() => {
  const S = 256, W = S * 2, data = new Uint8Array(W * W * 4), noise = valueNoise(11);
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * S, oy = (k >> 1) * S, sx = k * 13.7, sy = k * 5.3;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = i / S * 2 - 1, y = j / S * 2 - 1;
      const wx = x + (fbm(noise, x * 1.6 + sx, y * 1.6 + sy, 3) - 0.5) * 0.55, wy = y + (fbm(noise, x * 1.6 + sx + 40, y * 1.6 + sy, 3) - 0.5) * 0.45;
      const r = Math.hypot(wx * 1.05, wy > 0 ? wy * 1.1 : wy * 2.0);       // a dome, flatter underneath
      const lumps = fbm(noise, wx * 3.0 + sx, wy * 3.0 + sy, 4), fine = fbm(noise, x * 9 + sx, y * 9 + sy, 3);
      const d = (1 - r) + (lumps - 0.5) * 0.75 + (fine - 0.5) * 0.18;
      let a = clamp((d - 0.12) / 0.38, 0, 1);
      a *= 1 - clamp((Math.hypot(x, y) - 0.86) / 0.13, 0, 1);              // nothing at the tile's edge
      const lit = clamp(0.28 + 0.66 * clamp((wy + 0.55) / 1.1, 0, 1) + (lumps - 0.5) * 0.75 + (fine - 0.5) * 0.15, 0.1, 1);
      const o = ((oy + j) * W + ox + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(lit * 255); data[o + 3] = Math.round(a * a * (3 - 2 * a) * 255);
    }
  }
  return dataTex(data, W);
})();
const cloudLit = { value: new THREE.Color(0xffffff) }, cloudShade = { value: new THREE.Color(0xa9b4c8) };
const PUFF_MAT = new THREE.ShaderMaterial({
  name: 'cloud puffs', transparent: true, depthWrite: false, fog: true,
  uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uPuff: { value: PUFF_TEX }, uLit: cloudLit, uShade: cloudShade },
  vertexShader: `
    attribute vec3 iOffset; attribute float iSize; attribute float iShade; attribute vec2 iTile; attribute float iFlip;
    varying vec2 vUv; varying float vShade;
    #include <fog_pars_vertex>
    void main() {
      vUv = iTile + vec2(iFlip < 0.0 ? 1.0 - uv.x : uv.x, uv.y) * 0.5;
      vShade = iShade;
      vec4 mvPosition = modelViewMatrix * vec4(iOffset, 1.0);
      mvPosition.xy += position.xy * iSize;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform sampler2D uPuff; uniform vec3 uLit; uniform vec3 uShade;
    varying vec2 vUv; varying float vShade;
    #include <fog_pars_fragment>
    void main() {
      vec4 t = texture2D(uPuff, vUv);
      if (t.a < 0.01) discard;
      gl_FragColor = vec4(mix(uShade, uLit, clamp(t.r * vShade, 0.0, 1.0)), t.a);
      #include <fog_fragment>
    }`,
});
PUFF_MAT.userData.shared = true;
const PUFF_QUAD = new THREE.PlaneGeometry(1, 1);
// a cluster of puffs as one mesh. puffs: [x, y, z, size, shade]; their order is redone back to front in sortPuffs
function puffCloud(puffs, r, mat = PUFF_MAT) {
  const n = puffs.length, g = new THREE.InstancedBufferGeometry();
  g.index = PUFF_QUAD.index; g.setAttribute('position', PUFF_QUAD.attributes.position); g.setAttribute('uv', PUFF_QUAD.attributes.uv);
  const src = puffs.map(([x, y, z, size, shade]) => ({ x, y, z, size, shade, tile: [(Math.floor(r() * 4) % 2) * 0.5, (Math.floor(r() * 4) >> 1) * 0.5], flip: r() < 0.5 ? -1 : 1 }));
  const attrs = { iOffset: 3, iSize: 1, iShade: 1, iTile: 2, iFlip: 1 };
  for (const [name, k] of Object.entries(attrs)) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = n;
  let R = 0; for (const p of src) R = Math.max(R, Math.hypot(p.x, p.y, p.z) + p.size * 0.75);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R);
  const m = new THREE.Mesh(g, mat); m.userData.puffs = src; m.userData.order = src.map((_, i) => i);
  writePuffs(m);
  return m;
}
function writePuffs(m) {
  const g = m.geometry, src = m.userData.puffs, order = m.userData.order;
  const o = g.attributes.iOffset.array, s = g.attributes.iSize.array, sh = g.attributes.iShade.array, t = g.attributes.iTile.array, f = g.attributes.iFlip.array;
  order.forEach((idx, i) => { const p = src[idx]; o[i * 3] = p.x; o[i * 3 + 1] = p.y; o[i * 3 + 2] = p.z; s[i] = p.size; sh[i] = p.shade; t[i * 2] = p.tile[0]; t[i * 2 + 1] = p.tile[1]; f[i] = p.flip; });
  for (const k of ['iOffset', 'iSize', 'iShade', 'iTile', 'iFlip']) g.attributes[k].needsUpdate = true;
}
const _camLocal = new THREE.Vector3(), _invM = new THREE.Matrix4();
function sortPuffs(m) {
  _camLocal.copy(camera.position).applyMatrix4(_invM.copy(m.matrixWorld).invert());
  const src = m.userData.puffs, dist = (i) => { const p = src[i]; return (p.x - _camLocal.x) ** 2 + (p.y - _camLocal.y) ** 2 + (p.z - _camLocal.z) ** 2; };
  const order = m.userData.order, before = order.join();
  order.sort((a, b) => dist(b) - dist(a));
  if (order.join() !== before) writePuffs(m);
}
const clouds = [];
(function makeClouds() {
  const r = rng(42);
  for (let i = 0; i < 24; i++) {
    // a cumulus: a row of big overlapping puffs for the base, a few more piled on top toward the middle
    const w = 6 + r() * 4, puffs = [];
    for (let j = 0, n = 4 + Math.floor(r() * 3); j < n; j++) {
      const t = n === 1 ? 0 : j / (n - 1) - 0.5;
      puffs.push([t * w * 2.2 + (r() - 0.5) * 2, r() * 1.2, (r() - 0.5) * w * 0.8, w * (1.0 + r() * 0.35), 0.86 + r() * 0.08]);
    }
    for (let j = 0, n = 3 + Math.floor(r() * 3); j < n; j++) {
      const t = (r() - 0.5) * 1.2;
      puffs.push([t * w, w * (0.45 + r() * 0.4) * (1 - Math.abs(t) * 0.6), (r() - 0.5) * w * 0.6, w * (0.8 + r() * 0.35), 1.0 + r() * 0.12]);
    }
    const m = puffCloud(puffs, r);
    const below = i < 14;
    const R = below ? 17 + r() * 210 : 170 + r() * 155, a = r() * TAU;
    m.position.set(Math.cos(a) * R, below ? -24 - r() * 22 : 40 + r() * 24, Math.sin(a) * R); // the high ones above the sky traffic
    m.rotation.y = r() * TAU;
    m.userData.a = a; m.userData.R = R; m.userData.speed = (0.004 + r() * 0.006) * (r() > .5 ? 1 : -1); m.userData.bob = r() * TAU;
    scene.add(m); clouds.push(m);
  }
})();
// the cloud sea: a drifting, softly lit floor (a tiling noise texture read at two scales), with big puffs on it
const SEA_NOISE = (() => {
  const S = 256, data = new Uint8Array(S * S * 4), noise = valueNoise(31);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const v = Math.round(fbm(noise, i / S * 8, j / S * 8, 5, 8) * 255), o = (j * S + i) * 4;
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  const t = dataTex(data, S); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const seaSun = { value: new THREE.Vector2(1, 0) }, seaLit = { value: new THREE.Color() }, seaShade = { value: new THREE.Color() };
// the sea's puffs: the same shader, in the sea's (slightly cooler) colours; the puff texture is shared, not copied
const SEA_PUFF_MAT = PUFF_MAT.clone(); SEA_PUFF_MAT.name = 'cloud sea puffs'; SEA_PUFF_MAT.userData.shared = true;
Object.assign(SEA_PUFF_MAT.uniforms, { uPuff: { value: PUFF_TEX }, uLit: seaLit, uShade: seaShade });
const SEA_MAT = new THREE.ShaderMaterial({
  name: 'cloud sea', fog: true,
  uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uNoise: { value: SEA_NOISE }, uLit: seaLit, uShade: seaShade, uTime: { value: 0 }, uSun: seaSun },
  vertexShader: `
    varying vec2 vXZ;
    #include <fog_pars_vertex>
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0); vXZ = wp.xz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform sampler2D uNoise; uniform vec3 uLit; uniform vec3 uShade; uniform float uTime; uniform vec2 uSun;
    varying vec2 vXZ;
    #include <fog_pars_fragment>
    float dens(vec2 p) {
      return texture2D(uNoise, p * 0.0032 + uTime * vec2(0.0011, 0.0004)).r * 0.62 + texture2D(uNoise, p * 0.0105 - uTime * vec2(0.0005, 0.0012)).r * 0.38;
    }
    void main() {
      float d = dens(vXZ), toward = dens(vXZ + uSun * 7.0);
      float tops = smoothstep(0.36, 0.64, d), lit = clamp(0.5 + (d - toward) * 6.0, 0.0, 1.0);
      gl_FragColor = vec4(mix(uShade, uLit, clamp(tops * 0.6 + lit * 0.4, 0.0, 1.0)), 1.0);
      #include <fog_fragment>
    }`,
});
const cloudSea = (() => {
  const g = new THREE.Group(); g.name = 'cloudSea';
  const floor = new THREE.Mesh(new THREE.CircleGeometry(700, 48).rotateX(-Math.PI / 2), SEA_MAT);
  floor.position.y = -78; floor.renderOrder = 1; g.add(floor);
  const r = rng(77), puffs = [];
  for (let i = 0; i < 70; i++) {
    const R = 20 + 420 * Math.pow(r(), 1.5), a = r() * TAU;
    puffs.push([Math.cos(a) * R, -74 + r() * 5, Math.sin(a) * R, 26 + r() * 30, 0.85 + r() * 0.2]);
  }
  // drawn first of the see-through things: three orders them by their bounds' centre, which for the sea is the
  // city's centre, not 70 units down, so without this it would paint over clouds that are nearer
  const top = puffCloud(puffs, r, SEA_PUFF_MAT); top.renderOrder = -1; g.add(top); g.userData.puffs = top;
  scene.add(g);
  return g;
})();
const SEA_TINT = new THREE.Color(0.84, 0.88, 0.97), SHADE_TINT = new THREE.Color(0.55, 0.6, 0.74); // shade cooler than light
let puffSortT = 0;
function updateClouds(dt) {
  cloudLit.value.setHex(night.cloud ?? 0xffffff).multiplyScalar(1.18);
  cloudShade.value.copy(cloudLit.value).multiply(SHADE_TINT);
  seaLit.value.copy(cloudLit.value).multiply(SEA_TINT); seaShade.value.copy(seaLit.value).multiply(SHADE_TINT);
  SEA_MAT.uniforms.uTime.value = clockT.now % 10000; // wraps seamlessly (each drift goes a whole number of repeats in 10,000 s), so it never loses precision
  seaSun.value.set(sun.position.x - sun.target.position.x, sun.position.z - sun.target.position.z).normalize(); // the sun follows the camera (followShadow): its direction doesn't
  cloudSea.rotation.y += dt * 0.002;
  for (const c of clouds) {
    const u = c.userData; u.a += u.speed * dt;
    c.position.x = Math.cos(u.a) * u.R; c.position.z = Math.sin(u.a) * u.R;
    c.position.y += Math.sin(clockT.now * 0.2 + u.bob) * 0.004;
  }
  // back to front, a few times a second (the order changes slowly)
  if ((puffSortT -= dt) <= 0) {
    puffSortT = 0.2;
    for (const c of clouds) { c.updateMatrixWorld(); sortPuffs(c); }
    cloudSea.updateMatrixWorld(); sortPuffs(cloudSea.userData.puffs);
  }
}

// =====================================================================
// island bases (shared by City Hall and districts)
// =====================================================================
const GRASS = 0x86c46d, GRASS_DARK = 0x5f9e55, SOIL = 0x8a6143, PAVE = 0xe9e4d8, PAVE_DARK = 0xcfc8b8;
function jitter(geo, amt, seed) {
  const p = geo.attributes.position, r = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    if (!r.has(key)) { const h = hash(key + seed); r.set(key, [((h & 255) / 255 - .5) * amt, (((h >> 8) & 255) / 255 - .5) * amt * 0.6, (((h >> 16) & 255) / 255 - .5) * amt]); }
    const d = r.get(key); p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}
// Soft contact shadows: a dark smudge on the ground under things, so they sit on it instead of looking
// stuck on. Still ones bake with their neighbourhood, so a district pays one draw call per bake for all of them.
const CONTACT_TEX = canvasTex(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.7)'); grd.addColorStop(0.75, 'rgba(255,255,255,0.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const CONTACT_MAT = new THREE.MeshBasicMaterial({ color: 0x151a2b, map: CONTACT_TEX, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
CONTACT_MAT.userData.shared = true; CONTACT_MAT.name = 'contact shadow';
const CONTACT_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
// a w × d shadow lying at height y in its parent's frame: just above the real ground there
// (+0.1 over grass, whose top is jittered by up to 0.075; +0.03 over paving)
function contactShadow(w, d, y, x = 0, z = 0) {
  const m = new THREE.Mesh(CONTACT_GEO, CONTACT_MAT); m.scale.set(w, 1, d); m.position.set(x, y, z);
  return m;
}
// shadowY: where the ground is under the tree, in its own frame (grass by default)
function makeTree(r, s = 1, shadowY = 0.1) {
  const g = new THREE.Group();
  g.add(contactShadow(1.9 * s, 1.9 * s, shadowY));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 0.9 * s, 6), stdMat(0x7a5236, { flat: true }));
  trunk.position.y = 0.45 * s; g.add(trunk);
  const greens = [0x4f9d5a, 0x5fb06a, 0x3f8a52];
  for (let i = 0; i < 2; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry((0.8 - i * 0.22) * s, (1.3 - i * 0.2) * s, 7), stdMat(greens[Math.floor(r() * 3)], { flat: true }));
    c.position.y = (1.2 + i * 0.7) * s; c.rotation.y = r() * TAU; c.castShadow = true; g.add(c);
  }
  trunk.castShadow = true;
  return g;
}
// shadowY: where the ground is under the lamp, in its own frame (a sidewalk by default)
function makeLamp(shadowY = 0.05) {
  const g = new THREE.Group();
  g.add(contactShadow(0.75, 0.75, shadowY));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 2.2, 6), stdMat(0x2c3142));
  pole.position.y = 1.1; pole.castShadow = true; g.add(pole);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), glowMat(0xffd08a, 0.25, 3.2, { base: 0xfff1d0 }));
  bulb.position.y = 2.3; g.add(bulb);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.18, 8), stdMat(0x2c3142)); cap.position.y = 2.48; g.add(cap);
  return g;
}
// Everything under the grass (soil, rock, hanging spikes, roots, vines, floating rocks) is one vertex-coloured
// material, so an island's underside is one draw call. paintGeo gives each face one colour, keeping the low-poly look:
// fn(colour, x, y, z, faceNormalY) for the face's centre.
const EARTH_MAT = stdMat(0xffffff, { flat: true, vertexColors: true }); EARTH_MAT.name = 'earth';
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _pCol = new THREE.Color();
function paintGeo(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i + 2 < p.count; i += 3) {
    _pa.fromBufferAttribute(p, i); _pb.fromBufferAttribute(p, i + 1); _pc.fromBufferAttribute(p, i + 2);
    const cx = (_pa.x + _pb.x + _pc.x) / 3, cy = (_pa.y + _pb.y + _pc.y) / 3, cz = (_pa.z + _pb.z + _pc.z) / 3;
    const ny = _pb.sub(_pa).cross(_pc.sub(_pa)).normalize().y;
    fn(_pCol, cx, cy, cz, ny);
    for (let k = 0; k < 3; k++) { c[(i + k) * 3] = _pCol.r; c[(i + k) * 3 + 1] = _pCol.g; c[(i + k) * 3 + 2] = _pCol.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
// a bent, tapering strand (a root or a vine) through points pts, radius r0 at the top down to r1
function strandGeos(pts, r0, r1) {
  const out = [], up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], len = a.distanceTo(b);
    const ra = lerp(r0, r1, i / (pts.length - 1)), rb = lerp(r0, r1, (i + 1) / (pts.length - 1));
    dir.subVectors(a, b).normalize(); q.setFromUnitVectors(up, dir);
    out.push(new THREE.CylinderGeometry(ra, rb, len, 5, 1, true).applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2));
  }
  return out;
}
// rock colour bands from the soil down to the tip (t: 0 at the top of the rock, 1 at its tip)
const ROCK_BANDS = [[0.16, 0x957a69], [0.42, 0x8a7ba3], [0.72, 0x706594], [1.01, 0x544b72]], _ledgeC = new THREE.Color(0xc9bfb8);
function rockColour(col, t, ny, vary) {
  const band = ROCK_BANDS.find(([to]) => t < to) || ROCK_BANDS[ROCK_BANDS.length - 1];
  col.setHex(band[1]).multiplyScalar(1 + vary);
  if (ny > 0.25) col.lerp(_ledgeC, 0.35); // a ledge catches the light
  return col;
}
function makeIslandBase(R, seed) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(jitter(new THREE.CylinderGeometry(R, R * 0.97, 0.8, 10, 1).translate(0, -0.4, 0), 0.25, seed), stdMat(GRASS, { flat: true }));
  top.receiveShadow = true; g.add(top);
  const r = rng(seed), rr = rng(seed + 5), earth = [];
  const vary = () => (rr() - 0.5) * 0.12;
  // soil: brown, darker toward the rock
  const soilC = new THREE.Color(0x9a6c4a), soilDark = new THREE.Color(0x7a5640);
  earth.push(paintGeo(jitter(new THREE.CylinderGeometry(R * 0.97, R * 0.84, 1.5, 10, 1).translate(0, -1.55, 0), 0.4, seed + 1),
    (col, x, y) => col.copy(soilC).lerp(soilDark, clamp((-0.8 - y) / 1.5, 0, 1)).multiplyScalar(1 + vary())));
  // the rock: six rings stepping in and out into ledges, its tip pushed off-centre, banded from warm stone to dark violet
  const H = R * 1.35, rockTop = -2.3, tipX = (rr() - 0.5) * R * 0.5, tipZ = (rr() - 0.5) * R * 0.5;
  const tOf = (y) => clamp((rockTop - y) / H, 0, 1);
  const rock = new THREE.CylinderGeometry(R * 0.84, 0, H, 10, 6, true).translate(0, rockTop - H / 2, 0);
  const rp = rock.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const t = tOf(rp.getY(i)), ring = Math.round(t * 6), step = ring % 2 ? 0.86 : 1.08;
    const k = ring === 0 || ring === 6 ? 1 : step;
    rp.setXYZ(i, rp.getX(i) * k + tipX * t * t, rp.getY(i), rp.getZ(i) * k + tipZ * t * t);
  }
  earth.push(paintGeo(jitter(rock, R * 0.09, seed + 2), (col, x, y, z, ny) => rockColour(col, tOf(y) + (rr() - 0.5) * 0.08, ny, vary())));
  // a few smaller spikes hanging under the ledges
  for (let i = 0, n = 2 + Math.floor(rr() * 3); i < n; i++) {
    const t0 = 0.22 + rr() * 0.3, a = rr() * TAU, rad = R * 0.84 * (1 - t0) * 0.62, y0 = rockTop - t0 * H;
    const len = H * (0.22 + rr() * 0.2), w = R * 0.84 * (1 - t0) * 0.3;
    const spike = new THREE.CylinderGeometry(w, 0, len, 6, 2, true).translate(Math.cos(a) * rad + tipX * t0 * t0, y0 - len / 2, Math.sin(a) * rad + tipZ * t0 * t0);
    earth.push(paintGeo(jitter(spike, w * 0.3, seed + 10 + i), (col, x, y, z, ny) => rockColour(col, tOf(y) + 0.1, ny, vary())));
  }
  // roots and vines hanging from under the grass edge: out from the soil first, then down past the rock
  const rootC = new THREE.Color(0x6b4a34), vineC = new THREE.Color(0x4f8a4a), leafC = new THREE.Color(0x74c266);
  const nRoots = 6 + Math.floor(rr() * 5), nVines = 2 + Math.floor(rr() * 3);
  for (let i = 0; i < nRoots + nVines; i++) {
    const vine = i >= nRoots, a = (i / (nRoots + nVines)) * TAU + rr() * 0.5, out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-out.z, 0, out.x).multiplyScalar((rr() - 0.5) * 0.8);
    const len = vine ? 2.6 + rr() * 2.4 : 1.6 + rr() * 2.0, p0 = out.clone().multiplyScalar(R * 0.93).setY(-0.95);
    const pts = [p0, p0.clone().addScaledVector(out, 0.9).setY(-0.95 - len * 0.3), p0.clone().addScaledVector(out, 1.2).add(side).setY(-0.95 - len * 0.65), p0.clone().addScaledVector(out, 1.15).addScaledVector(side, 1.6).setY(-0.95 - len)];
    const geos = strandGeos(pts, vine ? 0.09 : 0.16, vine ? 0.04 : 0.03);
    if (vine) for (let j = 1; j < pts.length; j++) for (const sx of [-1, 1]) geos.push(new THREE.IcosahedronGeometry(0.17 + rr() * 0.08, 0).scale(1.3, 0.7, 1).translate(pts[j].x + sx * 0.14, pts[j].y + 0.12 + sx * 0.08, pts[j].z));
    for (const sg of geos) earth.push(paintGeo(sg, (col, x, y, z) => col.copy(vine ? (sg.type === 'IcosahedronGeometry' ? leafC : vineC) : rootC).multiplyScalar(1 + vary())));
  }
  const earthGeo = mergeGeometries(earth, false); earth.forEach((e) => e.dispose());
  const under = new THREE.Mesh(earthGeo, EARTH_MAT); under.receiveShadow = true; g.add(under);
  // floating rocks: jagged chunks with flat tops, some with a grass cap, merged into one mesh (the group spins)
  const bits = new THREE.Group(), chunks = [], grassC = new THREE.Color(0x6fb35e);
  for (let i = 0, n = 4 + Math.floor(r() * 3); i < n; i++) {
    const s = 0.55 + r() * 0.8, a = r() * TAU, d = R * (0.7 + r() * 0.5), capped = r() < 0.5;
    const geo = jitter(new THREE.IcosahedronGeometry(s, 1).scale(1, 0.8, 1), s * 0.3, seed + 20 + i);
    const gp = geo.attributes.position, flat = s * 0.3;
    for (let k = 0; k < gp.count; k++) if (gp.getY(k) > flat) gp.setY(k, flat);
    geo.rotateX((r() - 0.5) * 0.3).rotateZ((r() - 0.5) * 0.3).rotateY(r() * TAU).translate(Math.cos(a) * d, -4 - r() * R * 0.9, Math.sin(a) * d);
    const cy = -4 - R * 0.45;
    chunks.push(paintGeo(geo, (col, x, y, z, ny) => capped && ny > 0.6 ? col.copy(grassC).multiplyScalar(1 + vary()) : rockColour(col, clamp(0.3 + (cy - y) * 0.04 + rr() * 0.3, 0, 1), ny, vary())));
  }
  const bitsGeo = mergeGeometries(chunks, false); chunks.forEach((c) => c.dispose());
  const bitsMesh = new THREE.Mesh(bitsGeo, EARTH_MAT); bitsMesh.userData.baked = true; bits.add(bitsMesh); // baked: a district frees it when it goes
  g.add(bits); g.userData.bits = bits;
  // grass tufts at the rim
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU, d = R * (0.82 + r() * 0.14);
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 4), stdMat(GRASS_DARK, { flat: true }));
    t.position.set(Math.cos(a) * d, 0.18, Math.sin(a) * d); g.add(t);
  }
  return g;
}

// =====================================================================
// City Hall: the Mayor's island at the center of the city
// =====================================================================
// City Hall is built at its first size and drawn 1.4x bigger (HALL_SCALE), in step with the districts around it
const HALL_SCALE = 1.4, HALL_R = 12.5 * HALL_SCALE;
const hall = { group: new THREE.Group(), beaconMat: null, beacon: null, ring: null, ringTex: null, flag: null, flagGeo: null, fountain: null, label: null, waitPulse: 0, dome: null };
function drawRing(text) {
  const t = hall.ringTex, g = t.userData.ctx, c = t.userData.canvas;
  g.clearRect(0, 0, c.width, c.height);
  g.font = '700 50px Unbounded, "Arial Black", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
  const unit = text + '  ✦';
  const w = g.measureText(unit).width + 60;
  const n = Math.max(1, Math.floor(c.width / w)), step = c.width / n;
  g.fillStyle = 'rgba(106,230,245,0.95)';
  for (let i = 0; i < n; i++) g.fillText(unit, step * i + step / 2, c.height / 2 + 2);
  g.fillStyle = 'rgba(106,230,245,0.35)'; g.fillRect(0, 6, c.width, 3); g.fillRect(0, c.height - 9, c.width, 3);
  t.needsUpdate = true;
}
(function buildHall() {
  const H = hall.group;
  H.add(makeIslandBase(12.5, 99));
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.6, 0.2, 48), stdMat(PAVE)); plaza.position.y = 0.1; plaza.receiveShadow = true; H.add(plaza);
  const inlay = new THREE.Mesh(new THREE.RingGeometry(7.6, 8.0, 48).rotateX(-Math.PI / 2), stdMat(0xd8b46a, { metalness: 0.6, roughness: 0.4 })); inlay.position.y = 0.21; H.add(inlay);
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(5.9 - i * 0.55, 5.9 - i * 0.55, 0.28, 40), stdMat(i % 2 ? PAVE_DARK : PAVE));
    s.position.y = 0.34 + i * 0.28; s.castShadow = true; s.receiveShadow = true; H.add(s);
  }
  const baseY = 1.1;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 3.6, 36), stdMat(0xf6f1e7)); drum.position.y = baseY + 1.8; drum.castShadow = true; drum.receiveShadow = true; H.add(drum);
  // glowing windows ring around the drum
  const winMat = glowMat(0xffd59a, 0.15, 2.6, { base: 0x2b2f45 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.2, 0.1), winMat);
    w.position.set(Math.cos(a) * 3.48, baseY + 2.1, Math.sin(a) * 3.48); w.lookAt(0, w.position.y, 0); H.add(w);
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.6, 10), stdMat(0xffffff));
    col.position.set(Math.cos(a) * 4.25, baseY + 1.8, Math.sin(a) * 4.25); col.castShadow = true; H.add(col);
  }
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(4.75, 4.75, 0.45, 40), stdMat(0xebe4d4)); roof.position.y = baseY + 3.8; roof.castShadow = true; H.add(roof);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(4.75, 0.08, 6, 64).rotateX(Math.PI / 2), stdMat(0xd8b46a, { metalness: 0.7, roughness: 0.35 })); trim.position.y = baseY + 4.04; H.add(trim);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3.4, 36, 18, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8b552, metalness: 0.85, roughness: 0.28, emissive: 0x3a2400, emissiveIntensity: 0.2 }));
  dome.position.y = baseY + 4.0; dome.castShadow = true; H.add(dome); hall.dome = dome;
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.9, 12), stdMat(0xf6f1e7)); lantern.position.y = baseY + 7.75; H.add(lantern);
  hall.beaconMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffb547, emissiveIntensity: 1.2, toneMapped: true });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), hall.beaconMat); beacon.position.y = baseY + 8.5; H.add(beacon); hall.beacon = beacon;
  hall.beaconBeam = makeBeam(0xffb547); hall.beaconBeam.position.y = baseY + 8.5; hall.beaconBeam.scale.set(0.42, 60, 0.42); H.add(hall.beaconBeam);
  // the holographic ring with the city's live numbers
  hall.ringTex = canvasTex(3072, 96, () => {}, { repeat: true });
  hall.ringTex.repeat.set(1, 1);
  hall.ring = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 1.1, 96, 1, true), new THREE.MeshBasicMaterial({ map: hall.ringTex, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  hall.ring.position.y = baseY + 6.3; hall.ring.renderOrder = 7; H.add(hall.ring);
  drawRing('SKYBORNE');
  // the flag
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9, 8), stdMat(0xdfe3ee, { metalness: 0.6, roughness: 0.3 })); pole.position.set(7.2, 4.5, -3.2); pole.castShadow = true; H.add(pole);
  const flagTex = canvasTex(512, 300, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#13183a'); grd.addColorStop(1, '#2a1f55'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffb547'; g.fillRect(0, h - 26, w, 10); g.fillStyle = '#6ae6f5'; g.fillRect(0, h - 12, w, 6);
    g.strokeStyle = '#ffb547'; g.lineWidth = 8; g.beginPath(); g.arc(110, 128, 62, 0, TAU); g.stroke();
    // Orion's belt: three stars in a row
    const star = (x, y, r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU - Math.PI / 2, rr = i % 2 ? r * 0.38 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
    g.fillStyle = '#ffffff'; star(78, 150, 17); star(110, 128, 20); star(142, 106, 17);
    g.fillStyle = '#6ae6f5'; star(88, 82, 7); star(136, 176, 7);
    g.fillStyle = '#fff'; g.textBaseline = 'middle';
    let size = 66; g.font = `800 ${size}px Unbounded, "Arial Black", sans-serif`;
    while (g.measureText('SKYBORNE').width > w - 196 - 16 && size > 24) { size -= 2; g.font = `800 ${size}px Unbounded, "Arial Black", sans-serif`; }
    g.fillText('SKYBORNE', 196, 116);
    g.fillStyle = '#ffb547'; g.font = '700 21px Unbounded, "Arial Black", sans-serif'; g.fillText('S K Y   C I T Y', 200, 172);
  });
  hall.flagGeo = new THREE.PlaneGeometry(4.2, 2.45, 24, 10).translate(2.1, 0, 0);
  hall.flagGeo.userData.base = hall.flagGeo.attributes.position.array.slice();
  hall.flag = new THREE.Mesh(hall.flagGeo, new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }));
  hall.flag.position.set(7.2, 7.6, -3.2); hall.flag.castShadow = true; H.add(hall.flag);
  // fountain
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.75, 0.5, 28), stdMat(0xf2ede2)); basin.position.set(0, 0.45, 8.2); basin.castShadow = true; H.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.06, 28), new THREE.MeshStandardMaterial({ color: 0x7fd3f0, emissive: 0x2a7ab8, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.2 }));
  water.position.set(0, 0.68, 8.2); H.add(water);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 10), stdMat(0xf2ede2)); spout.position.set(0, 1.0, 8.2); H.add(spout);
  hall.fountain = new THREE.Vector3(0, 1.6, 8.2).multiplyScalar(HALL_SCALE); // in the world: where the water leaves the spout
  // lamps and trees around the plaza
  for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.26; const l = makeLamp(0.03); l.position.set(Math.cos(a) * 8.6, 0.2, Math.sin(a) * 8.6); H.add(l); }
  const r = rng(5);
  for (let i = 0; i < 7; i++) { const a = r() * TAU, d = 10.4 + r() * 1.2; const t = makeTree(r, 1 + r() * 0.4); t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); H.add(t); }
  // name plate
  const el = document.createElement('div'); el.className = 'dtag hall'; el.innerHTML = '<b>City Hall</b><span id="hallSub">Mayor</span>';
  hall.label = new CSS2DObject(el); hall.label.position.set(0, baseY + 10.6, 0); H.add(hall.label);
  hall.flag.userData.keep = true; hall.ring.userData.keep = true;
  mergeStatic(H);
  H.scale.setScalar(HALL_SCALE);
  scene.add(H);
})();
const hallTop = new THREE.Vector3(0, 9.6 * HALL_SCALE, 0);
function updateHall(dt, waitingCount) {
  // waving flag
  const pos = hall.flagGeo.attributes.position, base = hall.flagGeo.userData.base, t = clockT.now;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    pos.setZ(i, Math.sin(x * 1.6 - t * 3.2) * 0.22 * (x / 4.2) + Math.sin(y * 2 + t * 2) * 0.04 * (x / 4.2));
  }
  pos.needsUpdate = true; hall.flagGeo.computeVertexNormals();
  hall.ring.rotation.y += dt * 0.12;
  hall.ringTex.offset.x -= dt * 0.01;
  // the beacon: calm gold, or a pulsing alarm while any bot needs the Mayor
  const want = waitingCount > 0 ? 1 : 0;
  hall.waitPulse = damp(hall.waitPulse, want, 3, dt);
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);
  hall.beaconMat.emissiveIntensity = lerp(0.9 + night.k * 1.2, 4 + pulse * 5, hall.waitPulse);
  hall.beaconBeam.material.uniforms.opacity.value = hall.waitPulse * (0.22 + pulse * 0.22);
  hall.dome.material.emissiveIntensity = 0.2 + hall.waitPulse * pulse * 0.8;
  // fountain
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * TAU, s = (0.3 + Math.random() * 0.5) * HALL_SCALE;  // a jet in proportion to the bigger fountain (height goes with speed squared)
    puffs.emit({ x: hall.fountain.x, y: hall.fountain.y, z: hall.fountain.z, vx: Math.cos(a) * s, vy: (3.2 + Math.random()) * Math.sqrt(HALL_SCALE), vz: Math.sin(a) * s, life: 0.9, size: 0.16 * HALL_SCALE, size1: 0.1 * HALL_SCALE, alpha: 0.75, color: night.k > 0.6 ? 0x9fd8ff : 0xd8f3ff, gravity: 7.5 });
  }
}
