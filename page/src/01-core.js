import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The signs (flag, blimp, sleeping Z) are painted once at start: wait for the bundled display fonts
// first, at most 1.5 s, so they never come out in the fallback font.
await Promise.race([
  Promise.all(['800 112px Unbounded', '700 50px Unbounded', '600 58px "Martian Mono"'].map((f) => document.fonts.load(f))),
  new Promise((r) => setTimeout(r, 1500)),
]).catch(() => {});

/* =====================================================================
   SKYBORNE — a live miniature sky city of Claude Code agents.
   Every Claude Code session reports to the local Skyborne server (the
   page reads it from /events); each one becomes a floating district.
   ===================================================================== */

// ---------------- constants ----------------
const FRESH_MS = 45_000, ASLEEP_MS = 180_000;
const TAU = Math.PI * 2;
const STATUS_HEX = { working: 0x6ee7a8, done: 0x7db8ff, error: 0xff7a7a, idle: 0x8e97ad, wait: 0xffb547, asleep: 0x4b5163 };
const STATUS_CSS = { working: '#2b7a40', done: '#3a6aa6', error: '#c0392f', idle: '#6e7179', wait: '#e8a54b', asleep: '#a3a5aa' }; // page chrome (matches the CSS tokens)
const DISTRICT_HUES = [0xf2a65a, 0x6cc4a1, 0x7aa7e8, 0xe58fb0, 0xb49ae8, 0xe8d36c, 0x5fc1c9, 0xef8a6b];
const ROLE_COLORS = {
  lead: 0xf4f6fb, Scout: 0x3fc9b0, Architect: 0x9b7bea, Builder: 0xf29a3f, Critic: 0xef6f8e,
  Guide: 0xf2cf4a, Tester: 0x98d65a, Tinker: 0x6aa8f0, Twin: 0xd0d6e6, Artist: 0xf07fd0,
};
const KIND_LABEL = {
  bash: 'CMD', edit: 'EDIT', write: 'WRITE', read: 'READ', search: 'FIND', web: 'WEB', spawn: 'SPAWN', task: 'TASK',
  mcp: 'APP', tool: 'TOOL', think: 'THINK', wait: 'ASK', idle: 'IDLE', done: 'DONE', error: 'ERR', prompt: 'ORDER',
  answer: 'ANSWER', join: 'JOIN', leave: 'LEAVE',
};
const SAFE_TEXT = {
  bash: 'Running a command', edit: 'Editing a file', write: 'Writing a file', read: 'Reading a file',
  search: 'Searching the code', web: 'Browsing the web', spawn: 'Sending out a helper', task: 'Updating the plan',
  mcp: 'Using an app', tool: 'Using a tool', think: 'Thinking', wait: 'Waiting for you', idle: 'On a break',
  done: 'Finished', error: 'Hit an error', prompt: 'New prompt', answer: 'Delivered an answer',
  join: 'Arrived in the district', leave: 'Clocked out',
};
// a 403 on an action or a detail: the server restarted and the page hasn't reconnected yet (its `ready`
// brings the new token)
const RESTARTED = 'Skyborne restarted. Try again in a moment';

// ---------------- small utils ----------------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
// c1 sets the overshoot: the default goes 10% past the end, 1.17 about 5%
const easeOutBack = (t, c1 = 1.70158) => { const c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtTokens(n) { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'; return String(n); }
function ago(ts) { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); if (s < 5) return 'now'; if (s < 60) return s + 's'; const m = Math.floor(s / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : ''); }
function clockStr(ts) { const d = new Date(ts); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?(AM|PM)$/i, (m) => m.trim().toLowerCase()[0]); }
function agoCoarse(ts) { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? 'just now' : ago(ts); }
function hexCss(hex) { return '#' + hex.toString(16).padStart(6, '0'); }
// settings were saved under 'cyber.' before the Skyborne rename: copy over any the new prefix doesn't have yet
try { for (const k of Object.keys(localStorage)) if (k.startsWith('cyber.') && localStorage.getItem('skyborne.' + k.slice(6)) == null) localStorage.setItem('skyborne.' + k.slice(6), localStorage.getItem(k)); } catch (e) {}
const store = {
  get(k, d) { try { const v = localStorage.getItem('skyborne.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('skyborne.' + k, JSON.stringify(v)); } catch (e) {} },
};

// set only by the static site's build (page/demo): its recording, extra sample towns and wording; null everywhere else
const DEMO = window.__skyborneDemo || null;

// ---------------- viewer prefs ----------------
// the name on City Hall, if the user sets one ('Mayor' alone, which older pages saved for none, counts as none)
const mayorName = (v) => { v = String(v ?? '').trim().slice(0, 24); return v === 'Mayor' ? '' : v; };
const prefs = {
  mayor: mayorName(store.get('mayor', '')),
  time: ['auto', 'day', 'sunset', 'night'].includes(store.get('time', 'auto')) ? store.get('time', 'auto') : 'auto',
  tilt: store.get('tilt', true),
  labels: store.get('labels', true),
  safe: store.get('safe', false),
  sound: false,               // sound always starts off: browsers need a click first
  console: store.get('console', window.innerWidth > 760),
  samples: false,            // pretend districts for previewing; never on by itself
  liveMin: [15, 30, 60, 180].includes(store.get('liveMin', 30)) ? store.get('liveMin', 30) : 30,  // a session is live if heard from this recently
  showPast: store.get('showPast', false),  // past sessions in the city and the list too
  notify: store.get('notify', false),      // a desktop alert for each new approval request
};

// ---------------- renderer, scene, camera ----------------
const stage = $('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('bootMsg').textContent = 'Skyborne needs WebGL, and this browser has it turned off.';
  throw e;
}
// Big or retina screens can ask for 15+ million pixels a frame, which is what
// froze the page into a black screen. Render within a pixel budget instead:
// the miniature lens and bloom hide the difference.
const MAX_DPR = 1.5, PIXEL_BUDGET = 2.4e6;
let dprScale = 1; // lowered at run time if frames run long
let dpr = 1;
function pickDpr(w, h) {
  const fit = Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h));
  return clamp(Math.min(window.devicePixelRatio || 1, MAX_DPR, fit) * dprScale, 0.45, MAX_DPR);
}
renderer.setPixelRatio(dpr);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // redrawn every other frame (see step), which nobody can see but halves its cost
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
stage.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const PC = new THREE.Vector3(0, -1e6, 0); // far below: 'away from PC' is simply up
scene.fog = new THREE.FogExp2(0xbfd8ee, 0.0042);
// Soft reflections from a studio room three.js builds in code (no files, nothing downloaded), so the
// plastic, glass and gold read like real toys. How strong they are follows the time of day (envI).
{
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  room.dispose(); pmrem.dispose();
}
const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 2000);
camera.position.set(0, 62, 118);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 2, 0);
controls.minDistance = 7;
controls.maxDistance = 260;
controls.maxPolarAngle = 1.32;
controls.minPolarAngle = 0.18;
controls.autoRotateSpeed = 0.35;
controls.zoomSpeed = 0.9;

// ---------------- post: bloom, miniature lens, grade ----------------
const bigScreen = (window.screen?.width || 1920) * (window.screen?.height || 1080) > 4.2e6;
const composerTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: bigScreen ? 0 : 4 });
const composer = new EffectComposer(renderer, composerTarget);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.62, 0.86);
composer.addPass(bloom);

const TiltShader = {
  uniforms: { tDiffuse: { value: null }, delta: { value: new THREE.Vector2() }, focus: { value: 0.52 }, band: { value: 0.16 }, amount: { value: 1.0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 delta; uniform float focus; uniform float band; uniform float amount; varying vec2 vUv;
    void main(){
      float d = abs(vUv.y - focus);
      float t = smoothstep(band, band + 0.34, d) * amount;
      vec4 sum = vec4(0.0); float ws = 0.0;
      for (int i = -5; i <= 5; i++) { float fi = float(i); float w = exp(-fi * fi / 12.0); sum += texture2D(tDiffuse, vUv + delta * fi * t) * w; ws += w; }
      gl_FragColor = sum / ws;
    }`,
};
const tiltH = new ShaderPass(TiltShader);
const tiltV = new ShaderPass(TiltShader);
composer.addPass(tiltH);
composer.addPass(tiltV);
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.16 }, contrast: { value: 1.05 }, vignette: { value: 0.32 }, lift: { value: 0.0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast; uniform float vignette; uniform float lift; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.18) * contrast + 0.18 + lift;
      vec2 p = vUv - 0.5; float v = 1.0 - dot(p, p) * vignette * 2.2;
      c.rgb *= clamp(v, 0.0, 1.0);
      gl_FragColor = c;
    }`,
};
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);
composer.addPass(new OutputPass());

function applyTilt() {
  const on = prefs.tilt;
  tiltH.enabled = on; tiltV.enabled = on;
}

// ---------------- sizing (full window, or a 9:16 frame in reel mode) ----------------
let viewW = 1, viewH = 1;
function resize() {
  const r = stage.getBoundingClientRect();
  viewW = Math.max(1, Math.round(r.width)); viewH = Math.max(1, Math.round(r.height));
  dpr = pickDpr(viewW, viewH);
  renderer.setPixelRatio(dpr);
  renderer.setSize(viewW, viewH, false);
  composer.setPixelRatio(dpr);
  composer.setSize(viewW, viewH);
  bloom.resolution.set(viewW * dpr, viewH * dpr);
  labelRenderer.setSize(viewW, viewH);
  camera.aspect = viewW / viewH;
  applyViewOffset();
  camera.fov = viewW / viewH < 0.8 ? 46 : 34;
  camera.updateProjectionMatrix();
  const px = 1.15 / Math.max(viewW, viewH) * Math.max(1, Math.min(viewW, viewH) / 700);
  tiltH.uniforms.delta.value.set(px * (viewH / viewW), 0);
  tiltV.uniforms.delta.value.set(0, px);
  setParticleProj();
}
new ResizeObserver(() => resize()).observe(stage);

// Shift the picture left while the console covers the right side (and up while a phone's sheet covers the
// bottom), so the city stays centred in the space you can see.
const viewShift = { cur: 0, target: 0, curY: 0, targetY: 0 };
function applyViewOffset() {
  if (Math.abs(viewShift.cur) < 0.5 && Math.abs(viewShift.curY) < 0.5) camera.clearViewOffset();
  else camera.setViewOffset(viewW, viewH, viewShift.cur, viewShift.curY, viewW, viewH);
}

// ---------------- sky, stars, time of day ----------------
const skyUniforms = { top: { value: new THREE.Color(0x5b9be6) }, bottom: { value: new THREE.Color(0xdcecf7) }, glow: { value: new THREE.Color(0xfff1d6) }, sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3) }, fogC: { value: new THREE.Color(0xbfd8ee) } };
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(900, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform vec3 glow; uniform vec3 sunDir; uniform vec3 fogC; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(bottom, top, smoothstep(0.38, 0.95, h));
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        c += glow * pow(s, 18.0) * 0.55 + glow * pow(s, 3.0) * 0.12;
        c = mix(fogC, c, smoothstep(-0.1, 0.02, vDir.y)); // below the horizon: the haze the cloud sea fades into
        gl_FragColor = vec4(c, 1.0);
      }`,
  }),
);
sky.renderOrder = -10;
scene.add(sky);

const stars = (() => {
  const n = 1400, pos = new Float32Array(n * 3), r = rng(7);
  for (let i = 0; i < n; i++) {
    const th = r() * TAU, ph = Math.acos(r() * 0.92), R = 820;
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * R; pos[i * 3 + 1] = Math.cos(ph) * R; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * R;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const p = new THREE.Points(g, m); p.renderOrder = -9; scene.add(p); return p;
})();

const hemi = new THREE.HemisphereLight(0xdfefff, 0x6b5a4a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -78; sun.shadow.camera.right = 78; sun.shadow.camera.top = 78; sun.shadow.camera.bottom = -78;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 340;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);

// Night glow is the sum of every emissive in the city: windows, lamps, screens.
const night = { k: 0 }; // 0 day … 1 night, eased
const PRESETS = {
  day:    { top: 0x2f78d8, bottom: 0x9fcdf3, glow: 0xfff3dc, fog: 0xa9cff0, fogD: 0.0032, hemiS: 0xe4f1ff, hemiG: 0x7a6a58, hemiI: 1.05, envI: 0.08, sunC: 0xfff1de, sunI: 2.5, sunEl: 0.95, sunAz: 0.7, night: 0.0, exposure: 1.0, bloom: 0.42, stars: 0, cloud: 0xffffff },
  sunset: { top: 0x3b4d8f, bottom: 0xffb38a, glow: 0xffa060, fog: 0xdaa3a0, fogD: 0.0034, hemiS: 0xffcfb0, hemiG: 0x4a4f86, hemiI: 0.85, envI: 0.09, sunC: 0xffa36a, sunI: 1.9, sunEl: 0.2, sunAz: 2.3, night: 0.45, exposure: 1.0, bloom: 0.62, stars: 0.15, cloud: 0xffe2d6 },
  night:  { top: 0x0a1030, bottom: 0x2b3778, glow: 0x8aa0ff, fog: 0x222c62, fogD: 0.0036, hemiS: 0x95a8ff, hemiG: 0x2c2244, hemiI: 1.0, envI: 0.04, sunC: 0xbfcbff, sunI: 1.3, sunEl: 0.85, sunAz: -0.8, night: 1.0, exposure: 1.18, bloom: 0.85, stars: 1, cloud: 0x7480b8 },
};
function timePreset() {
  if (prefs.time !== 'auto') return prefs.time;
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h >= 6.5 && h < 17) return 'day';
  if ((h >= 17 && h < 19.75) || (h >= 5.25 && h < 6.5)) return 'sunset';
  return 'night';
}
const tod = { cur: null, target: null, from: null, t: 1 };
const _cA = new THREE.Color(), _cB = new THREE.Color();
function mixHex(a, b, t) { return _cA.setHex(a).lerp(_cB.setHex(b), t).getHex(); }
function applyPreset(p) {
  skyUniforms.top.value.setHex(p.top); skyUniforms.bottom.value.setHex(p.bottom); skyUniforms.glow.value.setHex(p.glow);
  scene.fog.color.setHex(p.fog); scene.fog.density = p.fogD; skyUniforms.fogC.value.copy(scene.fog.color);
  hemi.color.setHex(p.hemiS); hemi.groundColor.setHex(p.hemiG); hemi.intensity = p.hemiI;
  scene.environmentIntensity = p.envI;
  sun.color.setHex(p.sunC); sun.intensity = p.sunI;
  const el = p.sunEl, az = p.sunAz;
  sun.position.set(Math.cos(az) * Math.cos(el) * 160, Math.sin(el) * 160 + 30, Math.sin(az) * Math.cos(el) * 160);
  skyUniforms.sunDir.value.copy(sun.position).normalize();
  renderer.toneMappingExposure = p.exposure;
  bloom.strength = p.bloom;
  stars.material.opacity = p.stars;
  night.k = p.night;
  night.cloud = p.cloud;
}
function blendPresets(a, b, t) {
  const o = {};
  for (const k of Object.keys(a)) {
    const va = a[k], vb = b[k];
    o[k] = (k === 'top' || k === 'bottom' || k === 'glow' || k === 'fog' || k === 'hemiS' || k === 'hemiG' || k === 'sunC' || k === 'cloud') ? mixHex(va, vb, t) : lerp(va, vb, t);
  }
  return o;
}
function updateTimeOfDay(dt) {
  const want = timePreset();
  if (tod.target !== want) {
    tod.from = tod.cur ? { ...tod.cur } : { ...PRESETS[want] };
    tod.target = want; tod.t = tod.cur ? 0 : 1; tod.startMs = performance.now();
  }
  if (tod.t < 1) tod.t = Math.min(1, (performance.now() - tod.startMs) / 2200);
  tod.cur = blendPresets(tod.from, PRESETS[tod.target], easeInOut(tod.t));
  applyPreset(tod.cur);
}
