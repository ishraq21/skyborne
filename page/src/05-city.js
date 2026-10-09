
// =====================================================================
// the city: data in, districts out
// =====================================================================
// allDocs: every session the source sent (raw), liveDocs: the ones the city shows (05b-detail.js decides);
// needs: sessions waiting on you (live: the server's open requests; a recording: its documents' word)
const city = { districts: new Map(), freeSlots: [], nextSlot: 0, allDocs: new Map(), liveDocs: [], hiddenPast: 0, needs: new Set(), status: 'connecting', lastData: 0,
  primed: false, names: new Map(), renaming: null };

function inferKind(text = '', status) {
  const t = String(text).toLowerCase();
  if (status === 'done') return 'done';
  if (status === 'error') return 'error';
  if (status === 'idle') return 'idle';
  if (t.startsWith('$')) return 'bash';
  if (t.startsWith('editing')) return 'edit';
  if (t.startsWith('writing')) return 'write';
  if (t.includes('web')) return 'web';
  if (t.startsWith('reading')) return 'read';
  if (t.startsWith('searching')) return 'search';
  if (t.includes('helper') || t.includes('brought in') || t.includes('sending out') || t.includes('briefing')) return 'spawn';
  if (t.includes('task list')) return 'task';
  if (t.includes('needs')) return 'wait';
  if (t.startsWith('new prompt')) return 'prompt';
  if (t.startsWith('done:') || t.startsWith('finished')) return 'answer';
  if (t.includes('clocked in') || t.includes('moved into')) return 'join';
  return 'think';
}
// the four counters behind a session's token total; null from sessions still running the older mod
function tokenParts(t) {
  return t && typeof t.cr === 'number' ? { parts: { in: Number(t.in) || 0, out: Number(t.out) || 0, cw: Number(t.cw) || 0, cr: Number(t.cr) || 0 } } : { parts: null };
}
// helpers that finished and left the roster, kept by the mod so their tokens still have a name
function tokenHelpers(t) {
  return (Array.isArray(t?.helpers) ? t.helpers : []).slice(0, 20).map((h) => ({ id: String(h.id), name: String(h.name || ''), model: typeof h.model === 'string' ? h.model.slice(0, 80) : '', usage: { in: Number(h.usage?.in) || 0, out: Number(h.usage?.out) || 0, cw: Number(h.usage?.cw) || 0, cr: Number(h.usage?.cr) || 0 } }));
}
function normDoc(id, data) {
  const agents = (data.agents || []).map((a) => {
    const status = ['working', 'idle', 'done', 'error'].includes(a.status) ? a.status : 'working';
    const kind = a.kind && KIND_LABEL[a.kind] ? a.kind : inferKind(a.activity, status);
    return {
      id: String(a.id), name: String(a.name || 'Bot'), role: String(a.role || ''), type: String(a.type || String(a.role || '').replace(/ Agent$/, '')),
      status, kind, tool: typeof a.tool === 'string' ? a.tool : '', activity: String(a.activity || ''), activitySince: Number(a.activitySince) || 0,
      parent: a.parent ? String(a.parent) : null, waiting: !!a.waiting || kind === 'wait', tools: Number(a.tools) || 0,
      model: typeof a.model === 'string' ? a.model.slice(0, 80) : '',
      usage: a.usage && typeof a.usage.cr === 'number' ? { in: Number(a.usage.in) || 0, out: Number(a.usage.out) || 0, cw: Number(a.usage.cw) || 0, cr: Number(a.usage.cr) || 0 } : null,
    };
  });
  if (agents.length && !agents.some((a) => a.id === 'main' || !a.parent)) agents[0].parent = null;
  const feed = (data.feed || []).map((f) => ({
    ts: Number(f.ts) || 0, agent: String(f.agent || ''), agentId: f.agentId ? String(f.agentId) : null,
    kind: f.kind && KIND_LABEL[f.kind] ? f.kind : inferKind(f.text), text: String(f.text || ''), tool: f.tool ? String(f.tool) : '',
    toolUseId: f.toolUseId ? String(f.toolUseId) : null, durationMs: typeof f.durationMs === 'number' ? f.durationMs : null,
  }));
  return {
    id, title: String(data.title || id), sessionName: String(data.sessionName || '').trim().slice(0, 40), headline: String(data.headline || ''), startedAt: Number(data.startedAt) || 0,
    updatedAt: Number(data.updatedAt) || 0, turns: Number(data.turns) || 0, tokens: { total: Number(data.tokens?.total) || 0, out: Number(data.tokens?.out) || 0, ...tokenParts(data.tokens), helpers: tokenHelpers(data.tokens) },
    // the window's fill and the cost, as Claude Code reports them; absent from older sessions and from a session's first response
    context: typeof data.context?.percent === 'number' && Number(data.context.window) > 0 ? { tokens: Number(data.context.tokens) || 0, window: Number(data.context.window), percent: clamp(Number(data.context.percent), 0, 100) } : null,
    cost: typeof data.cost?.usd === 'number' ? Number(data.cost.usd) : null,
    waiting: data.waiting || null, agents, feed,
    ended: data.ended && typeof data.ended.at === 'number' ? { at: data.ended.at, reason: String(data.ended.reason || '') } : null,
    rateLimits: data.rateLimits && typeof data.rateLimits === 'object' ? data.rateLimits : null,
  };
}

const NEWS_MS = 60_000;  // a session that arrives with nothing newer than this (a past one shown again) isn't news
function takeSlot() { if (city.freeSlots.length) { city.freeSlots.sort((a, b) => a - b); return city.freeSlots.shift(); } return city.nextSlot++; }

function applyDocs(raw) {
  const now = Date.now();
  const docs = [];
  for (const d of raw) {
    if (!d || !d.exists) continue;
    const data = d.data(); if (!data) continue;
    docs.push(normDoc(d.id, data));
  }
  const seen = new Set();
  for (const doc of docs) {
    seen.add(doc.id);
    let dist = city.districts.get(doc.id);
    if (!dist || dist.leaving) {
      if (dist && dist.leaving) continue;
      dist = new District(doc.id, takeSlot(), doc.title);
      city.districts.set(doc.id, dist);
      if (city.primed && now - doc.updatedAt < NEWS_MS) cityEvent('join', null, dist);  // a past session shown again isn't news
    }
    dist.setDoc(doc, now);
  }
  for (const [id, d] of city.districts) if (!seen.has(id) && !d.leaving) d.leave();
  city.primed = true;
  city.lastData = now;
  uiDirty = true;
}

// ---------------- sample districts (Settings → Show sample districts) ----------------
const samples = { docs: [], timer: null, state: null };
const SAMPLE_TOOL = { bash: 'Bash', edit: 'Edit', read: 'Read', search: 'Grep', web: 'WebSearch', task: 'TodoWrite' };
let sampleSteps = 0;
function startSamples() {
  if (samples.timer) return;
  const r = rng(Date.now() % 100000);
  const now = Date.now();
  const towns = [['atlas-api', 'Skybot'], ['pixel-forge', 'Skybot'], ['dataport', 'Skybot'], ['skyline-ui', 'Skybot'], ...(DEMO?.towns || [])];
  const lines = {
    bash: ['$ npm test', '$ cargo build --release', '$ pytest -q', '$ git diff --stat'], edit: ['Editing router.ts', 'Editing schema.sql', 'Editing App.tsx', 'Editing main.rs'],
    read: ['Reading README.md', 'Reading config.yaml', 'Reading auth.py'], search: ['Searching handleLogin', 'Searching TODO', 'Searching useState'],
    web: ['Web search: three.js tilt-shift', 'Reading a web page'], think: ['Thinking'], task: ['Updating the task list'],
  };
  samples.state = towns.map(([title, lead], i) => ({
    id: 'sample-' + (i + 1), title, lead, tokens: 40_000 + r() * 900_000, turns: 1 + Math.floor(r() * 8), startedAt: now - r() * 3_600_000,
    agents: [{ id: 'main', name: lead, role: 'Lead Agent', type: 'lead', status: 'working', kind: 'think', activity: 'Thinking', activitySince: now, parent: null, waiting: false, tools: 0 }],
    feed: [{ ts: now, agent: lead, agentId: 'main', kind: 'prompt', text: 'Ship the new onboarding flow' }], headline: 'Ship the new onboarding flow', counts: {},
  }));
  const kinds = ['think', 'read', 'search', 'edit', 'bash', 'edit', 'web', 'task', 'bash'];
  const helperTypes = [['Explore', 'Scout'], ['Plan', 'Architect'], ['general-purpose', 'Builder'], ['code-reviewer', 'Critic']];
  const step = () => {
    const t = Date.now();
    for (const s of samples.state) {
      const lead = s.agents[0];
      // on the demo site a sample's steps carry an id, a tool and a duration, so its detail has a timeline to show
      const log = (who, kind, text) => { s.feed.unshift({ ts: t, agent: who.name, agentId: who.id, kind, text, ...(DEMO && SAMPLE_TOOL[kind] ? { toolUseId: 'smp-' + (++sampleSteps), tool: SAMPLE_TOOL[kind], durationMs: 300 + Math.floor(r() * 4200) } : {}) }); s.feed.length = Math.min(s.feed.length, 50); };
      s.tokens += 2_000 + r() * 30_000;
      if (lead.waiting) { if (r() < 0.25) { lead.waiting = false; lead.kind = 'bash'; lead.activity = '$ npm run deploy'; log(lead, 'bash', lead.activity); } }
      else if (lead.status === 'done') { if (r() < 0.2) { lead.status = 'idle'; lead.kind = 'idle'; lead.activity = 'Waiting for the next prompt'; } }
      else if (lead.status === 'idle') { if (r() < 0.18) { lead.status = 'working'; lead.kind = 'think'; lead.activity = 'Thinking'; s.turns++; s.headline = ['Fix the flaky login test', 'Add dark mode to settings', 'Speed up the CSV export', 'Refactor the auth middleware'][Math.floor(r() * 4)]; log(lead, 'prompt', s.headline); } }
      else {
        const roll = r();
        if (roll < 0.1 && s.agents.length < 5) {
          const [type, role] = helperTypes[Math.floor(r() * helperTypes.length)];
          s.counts[role] = (s.counts[role] || 0) + 1;
          const h = { id: 'h' + t + Math.floor(r() * 999), name: `${role} ${s.counts[role]}`, role: `${type} Agent`, type, status: 'working', kind: 'think', activity: 'Starting up', activitySince: t, parent: 'main', waiting: false, tools: 0, ttl: 5 + Math.floor(r() * 6) };
          s.agents.push(h); lead.kind = 'spawn'; lead.activity = `Sending out a ${role}`; log(lead, 'spawn', `Brought in ${h.name}`);
        } else if (roll < 0.15) {
          lead.waiting = true; lead.kind = 'wait'; lead.tool = 'Bash'; lead.activity = 'Needs approval: Bash'; log(lead, 'wait', 'Needs approval for Bash');
        } else if (roll < 0.21 && s.agents.length === 1) {
          lead.status = 'done'; lead.kind = 'done'; lead.activity = 'Answered'; log(lead, 'answer', 'Shipped it. Tests are green.');
        } else {
          const k = kinds[Math.floor(r() * kinds.length)]; lead.kind = k; lead.activity = lines[k][Math.floor(r() * lines[k].length)]; lead.tools++; log(lead, k, lead.activity);
        }
      }
      for (const h of s.agents.slice(1)) {
        if (h.status === 'done') { h.linger = (h.linger || 0) + 1; continue; }
        h.ttl--;
        if (h.ttl <= 0) { h.status = 'done'; h.kind = 'done'; h.activity = 'Finished'; log(h, 'done', 'Finished and handed back the result'); }
        else { const k = kinds[Math.floor(r() * kinds.length)]; h.kind = k; h.activity = lines[k][Math.floor(r() * lines[k].length)]; h.tools++; log(h, k, h.activity); }
      }
      s.agents = s.agents.filter((h) => !(h.linger > 4));
    }
    samples.docs = samples.state.map((s) => ({ id: s.id, exists: true, data: () => ({ v: 2, title: s.title, headline: s.headline, startedAt: s.startedAt, updatedAt: Date.now(), turns: s.turns, tokens: { total: Math.round(s.tokens) }, agents: s.agents, feed: s.feed }) }));
    refreshDocs();
  };
  step();
  samples.timer = setInterval(step, 1700);
}
function stopSamples() { clearInterval(samples.timer); samples.timer = null; samples.docs = []; refreshDocs(); }
function refreshDocs() { applyDocs([...(city.liveDocs || []), ...(prefs.samples ? samples.docs : [])]); }

// ---------------- events: sound, director ----------------
function cityEvent(type, bot, dist) {
  if (type === 'wait') sfx('wait');
  director.onEvent(type, bot, dist);
}

// ---------------- sound: tiny synths, no files ----------------
let actx = null; const sfxLast = {};
function sfx(name) {
  if (!prefs.sound || !actx) return;
  const now = actx.currentTime;
  if (sfxLast[name] && now - sfxLast[name] < 0.18) return; sfxLast[name] = now;
  const out = actx.createGain(); out.gain.value = 0.16; out.connect(actx.destination);
  const tone = (f0, f1, dur, type = 'sine', vol = 1, delay = 0) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, now + delay); if (f1) o.frequency.exponentialRampToValueAtTime(f1, now + delay + dur);
    g.gain.setValueAtTime(0.0001, now + delay); g.gain.exponentialRampToValueAtTime(vol, now + delay + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, now + delay + dur);
    o.connect(g); g.connect(out); o.start(now + delay); o.stop(now + delay + dur + 0.05);
  };
  if (name === 'spawn') { tone(260, 1050, 0.55, 'sine', 0.8); tone(520, 2100, 0.5, 'triangle', 0.25, 0.05); }
  else if (name === 'leave') { tone(1000, 240, 0.5, 'sine', 0.6); }
  else if (name === 'done') { tone(659, 0, 1.1, 'sine', 0.8); tone(988, 0, 1.3, 'sine', 0.6, 0.12); tone(1319, 0, 1.4, 'triangle', 0.25, 0.24); }
  else if (name === 'highfive') { tone(1175, 0, 0.12, 'triangle', 0.55); tone(1568, 0, 0.3, 'sine', 0.45, 0.08); tone(2093, 0, 0.35, 'triangle', 0.2, 0.1); }
  else if (name === 'deliver') { tone(1319, 0, 0.35, 'triangle', 0.5); tone(1760, 0, 0.4, 'sine', 0.3, 0.06); }
  else if (name === 'wait') { for (let i = 0; i < 3; i++) tone(1046, 0, 0.18, 'sine', 0.7, i * 0.16); }
  else if (name === 'error') { tone(140, 90, 0.35, 'sawtooth', 0.25); }
  else if (name === 'land') { tone(90, 50, 0.4, 'sine', 0.9); }
  else if (name === 'build') { tone(620, 0, 0.12, 'square', 0.15); tone(820, 0, 0.12, 'square', 0.12, 0.09); }
}

// =====================================================================
// camera: free orbit, fly-to, follow, and the reel director
// =====================================================================
const selection = { bot: null, district: null, follow: true, hover: null };
const fly = { on: false, t: 0, dur: 1.5, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() };
let lastInput = -1e9;
function flyTo(pos, target, dur = 1.5) {
  fly.on = true; fly.t = 0; fly.dur = dur; fly.start = performance.now();
  fly.fromP.copy(camera.position); fly.toP.copy(pos); fly.fromT.copy(controls.target); fly.toT.copy(target);
}
function overview(dur = 1.6) {
  const maxRing = Math.max(1, ...[...city.districts.values()].map((d) => d.ring));
  const dist = (134 + maxRing * 48) * (camera.aspect < 0.9 ? 1.45 : 1);
  const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  flyTo(new THREE.Vector3(Math.sin(az) * dist * 0.78, dist * 0.62, Math.cos(az) * dist * 0.78), new THREE.Vector3(0, 1, 0), dur);
}
function botFrame(bot, out, tgt, dist = 9) {
  if (bot.mode === 'home') { // at home: its front door and lit window, from the path outside
    const s = bot.house.step, h = bot.house.inside;
    tgt.set(s.x, 1.6, s.z); bot.d.group.localToWorld(tgt);
    const out1 = _v2.set(s.x - h.x, 0, s.z - h.z).transformDirection(bot.d.group.matrixWorld);
    out.copy(tgt).addScaledVector(out1, dist).addScaledVector(bot.d.n, dist * 0.42);
    return;
  }
  bot.head.getWorldPosition(tgt); tgt.y += 0.1;
  const fwd = _v2.set(0, 0, 1).applyQuaternion(bot.root.getWorldQuaternion(_q)).normalize();
  out.copy(tgt).addScaledVector(fwd, dist).addScaledVector(bot.d.n, dist * 0.42);
}
function selectBot(bot, flyToo = true) {
  if (selection.bot) selection.bot.selected = false;
  selection.bot = bot;
  if (bot) {
    bot.selected = true; selection.district = bot.d; selection.follow = true;
    if (flyToo && !director.on) { const p = new THREE.Vector3(), t = new THREE.Vector3(); botFrame(bot, p, t); flyTo(p, t, 1.4); }
    openDetail(bot.d, bot.id); if (!prefs.console) setConsole(true);
  }
  uiDirty = true;
}
function selectDistrict(d) {
  if (selection.bot) { selection.bot.selected = false; selection.bot = null; }
  selection.district = d;
  if (d && !director.on) {
    flyTo(d.framePos(0, 42, 26, new THREE.Vector3()), d.frameTarget(new THREE.Vector3()), 1.5);
  }
  uiDirty = true;
}
function clearSelection() { if (selection.bot) selection.bot.selected = false; selection.bot = null; selection.district = null; overview(); uiDirty = true; }

const _ft = new THREE.Vector3(), _fp = new THREE.Vector3(), _prevT = new THREE.Vector3();
function updateCamera(dt) {
  if (director.on) { director.update(dt); return; }
  if (fly.on) {
    fly.t = (performance.now() - fly.start) / 1000 / fly.dur; const k = easeInOut(Math.min(1, fly.t));
    camera.position.lerpVectors(fly.fromP, fly.toP, k); controls.target.lerpVectors(fly.fromT, fly.toT, k);
    camera.lookAt(controls.target);  // keep facing where it flies (controls.update() is skipped here), or it swings over the clouds until it lands
    if (fly.t >= 1) fly.on = false;
    return;
  }
  // follow the selected bot by sliding the orbit with it
  if (selection.bot && selection.follow && !selection.bot.gone && !selection.bot.d.leaving && selection.bot.mode !== 'home') { // not down into the cloud sea, nor into its house
    selection.bot.head.getWorldPosition(_ft); _ft.y += 0.1;
    _prevT.copy(controls.target);
    controls.target.x = damp(controls.target.x, _ft.x, 4, dt); controls.target.y = damp(controls.target.y, _ft.y, 4, dt); controls.target.z = damp(controls.target.z, _ft.z, 4, dt);
    camera.position.add(_v.subVectors(controls.target, _prevT));
  }
  controls.autoRotate = !selection.bot && !selection.district && performance.now() - lastInput > 16000;
  controls.update();
}

// The director: an automatic camera for reels. It cuts to whatever just
// happened (a helper beaming in, a bot needing the Mayor, a finish), and
// otherwise moves between a wide orbit, the busiest district and a hero bot.
const REVEAL_LIFT = 0.6;  // the opening close-up aims this far above the bot's head: its tag sits below the reel's top pills
const director = {
  on: false, shot: null, t: 0, ang: 0, lastEventAt: 0,
  pos: new THREE.Vector3(), tgt: new THREE.Vector3(), queue: [],
  start() { this.on = true; this.t = 0; this.shot = null; this.ang = Math.atan2(camera.position.x, camera.position.z); this.pos.copy(camera.position); this.tgt.copy(controls.target); this.next(true); controls.enabled = false; fly.on = false; },
  stop() { this.on = false; controls.enabled = true; },
  busiest() {
    let best = null, score = -1;
    for (const d of city.districts.values()) { if (d.leaving || d.rise < 1) continue; let s = 0; for (const b of d.robots.values()) s += b.data.waiting ? 5 : b.data.status === 'working' ? 2 : 0.2; s += Math.random(); if (s > score) { score = s; best = d; } }
    return best;
  },
  heroBot(pref) {
    const bots = [];
    for (const d of city.districts.values()) { if (d.leaving || d.asleep || d.rise < 1) continue; for (const b of d.robots.values()) if (b.mode === 'live' && !b.leaving && (!pref || pref(b))) bots.push(b); }
    return bots[Math.floor(Math.random() * bots.length)] || null;
  },
  next(first) {
    const cycle = ['orbit', 'district', 'hero', 'train', 'district', 'hero', 'orbit', 'hero'];
    if (first) { const b = this.heroBot((x) => x.data.status === 'working'); this.shot = b ? { type: 'reveal', bot: b, dur: 11 } : { type: 'orbit', dur: 10 }; }
    else if (this.queue.length) this.shot = this.queue.shift();
    else {
      this._i = ((this._i ?? -1) + 1) % cycle.length;
      const type = cycle[this._i];
      if (type === 'district') { const d = this.busiest(); this.shot = d ? { type, d, dur: 8, a0: Math.random() * TAU } : { type: 'orbit', dur: 9 }; }
      else if (type === 'hero') { const b = this.heroBot((x) => x.data.status === 'working') || this.heroBot(); this.shot = b ? { type, bot: b, dur: 6.5, a0: (Math.random() - .5) * 1.2 } : { type: 'orbit', dur: 9 }; }
      else if (type === 'train' && transit.loops.has(1)) this.shot = { type: 'train', loop: transit.loops.get(1), dur: 8 };
      else this.shot = { type: 'orbit', dur: 10 };
    }
    this.t = 0;
  },
  onEvent(type, bot, dist) {
    if (!this.on) return;
    const now = performance.now();
    if (now - this.lastEventAt < 7000) return;
    if (type === 'wait' || type === 'done' || type === 'deliver') { if (!bot) return; this.queue.unshift({ type: 'hero', bot, dur: 6, a0: (Math.random() - .5) * 0.8, event: type }); }
    else if (type === 'spawn' && bot) this.queue.unshift({ type: 'hero', bot, dur: 6, a0: 0.5, event: type });
    else if (type === 'join' && dist) this.queue.unshift({ type: 'district', d: dist, dur: 8, a0: 0 });
    else return;
    this.lastEventAt = now;
    if (this.shot && this.t > 1.5) this.next();
  },
  update(dt) {
    this.t += dt;
    const s = this.shot;
    if (!s || this.t > s.dur || (s.bot && (s.bot.gone || s.bot.leaving || s.bot.mode === 'home' || s.bot.d.leaving)) || (s.d && s.d.leaving)) { this.next(); return; }
    const k = this.t / s.dur;
    const P = _fp, T = _ft;
    if (s.type === 'orbit') {
      this.ang += dt * 0.09;
      const maxRing = Math.max(1, ...[...city.districts.values()].map((d) => d.ring));
      const R = 92 + maxRing * 40, H = 40 + maxRing * 17 + Math.sin(k * Math.PI) * 8;
      P.set(Math.sin(this.ang) * R, H, Math.cos(this.ang) * R); T.set(0, 3, 0);
    } else if (s.type === 'district') {
      s.d.framePos(s.a0 * 0.2 + (k - 0.5) * 0.9, 43, 20 + k * 4, P); s.d.frameTarget(T);
    } else if (s.type === 'train') {
      const car = s.loop.cars[0], a = s.loop.ang;
      T.copy(car.position);
      P.copy(T).add(_v.set(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(-7.5)).add(_v2.set(Math.sin(a), 0, Math.cos(a)).multiplyScalar(5)).add(_v.set(0, 3.4, 0));
    } else if (s.type === 'hero') {
      s.bot.head.getWorldPosition(T); T.y += 0.05;
      const fwd = _v.set(0, 0, 1).applyQuaternion(s.bot.root.getWorldQuaternion(_q)).normalize();
      const upn = s.bot.d.n, side = _v2.crossVectors(upn, fwd).normalize();
      const a = (s.a0 || 0) + (k - 0.5) * 0.5, dist = 7.2 - k * 1.4;
      P.copy(T).addScaledVector(fwd, Math.cos(a) * dist).addScaledVector(side, Math.sin(a) * dist).addScaledVector(upn, 2.2 + k * 0.5);
    } else if (s.type === 'reveal') {
      s.bot.head.getWorldPosition(_v2).addScaledVector(s.bot.d.n, REVEAL_LIFT);
      const fwd = _v.set(0, 0, 1).applyQuaternion(s.bot.root.getWorldQuaternion(_q)).normalize();
      const e = easeInOut(clamp((k - 0.12) / 0.88, 0, 1));
      const near = _v2.clone().addScaledVector(fwd, 4.6).addScaledVector(s.bot.d.n, 1.2);
      const az = Math.atan2(fwd.x, fwd.z) + e * 1.1;
      const far = new THREE.Vector3(Math.sin(az) * 174, 84, Math.cos(az) * 174);
      P.copy(near).lerp(far, e); T.copy(_v2).lerp(new THREE.Vector3(0, 2, 0), e);
    }
    const lam = s.type === 'reveal' ? 6 : s.type === 'train' ? 3.2 : 1.8;
    this.pos.x = damp(this.pos.x, P.x, lam, dt); this.pos.y = damp(this.pos.y, P.y, lam, dt); this.pos.z = damp(this.pos.z, P.z, lam, dt);
    this.tgt.x = damp(this.tgt.x, T.x, lam * 1.4, dt); this.tgt.y = damp(this.tgt.y, T.y, lam * 1.4, dt); this.tgt.z = damp(this.tgt.z, T.z, lam * 1.4, dt);
    camera.position.copy(this.pos); controls.target.copy(this.tgt); camera.lookAt(this.tgt);
  },
};

// ---------------- picking ----------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(); let pointerIn = false, downAt = null;
function pickables() {
  const list = [];
  for (const d of city.districts.values()) { if (d.leaving) continue; for (const b of d.robots.values()) if (!b.leaving && b.mode !== 'home') list.push(b.body, b.headMesh); }
  for (const d of city.districts.values()) if (!d.leaving) list.push(d.pickMesh);
  return list;
}
function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables(), false);
  for (const h of hits) { if (h.object.userData.robot) return { bot: h.object.userData.robot }; }
  for (const h of hits) { if (h.object.userData.district) return { district: h.object.userData.district }; }
  return {};
}
function setPointer(e) { const r = renderer.domElement.getBoundingClientRect(); pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
renderer.domElement.addEventListener('pointermove', (e) => { setPointer(e); pointerIn = true; });
renderer.domElement.addEventListener('pointerleave', () => { pointerIn = false; });
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; lastInput = performance.now(); fly.on = false; ensureAudio(); });
renderer.domElement.addEventListener('wheel', () => { lastInput = performance.now(); fly.on = false; }, { passive: true });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), quick = performance.now() - downAt.t < 450; downAt = null;
  if (moved > 6 || !quick) { if (selection.bot) selection.follow = moved < 40 ? selection.follow : selection.follow; return; }
  if (director.on) return;
  setPointer(e);
  const h = pick();
  if (h.bot) selectBot(h.bot);
  else if (h.district) selectDistrict(h.district);
  else if (selection.bot || selection.district) clearSelection();
});
let hoverT = 0;
function updateHover(dt) {
  hoverT += dt; if (hoverT < 0.08) return; hoverT = 0;
  let bot = null;
  if (pointerIn && !director.on) { const h = pick(); bot = h.bot || null; renderer.domElement.style.cursor = h.bot || h.district ? 'pointer' : ''; }
  if (selection.hover !== bot) { if (selection.hover) selection.hover.hover = false; selection.hover = bot; if (bot) bot.hover = true; }
}

// ---------------- labels: names when close, activity when focused ----------------
const _wp = new THREE.Vector3();
function updateLabels() {
  const reel = director.on;
  hall.label.visible = !reel; // reels stay clean: the gate signs and billboards already name things
  for (const d of city.districts.values()) {
    d.label.getWorldPosition(_wp);
    const dist = camera.position.distanceTo(_wp);
    d.labelEl.style.opacity = d.leaving ? d.labelEl.style.opacity : reel ? '0' : String(clamp(1.4 - dist / 240, 0, 1));
    for (const b of d.robots.values()) {
      b.root.getWorldPosition(_wp);
      const bd = camera.position.distanceTo(_wp);
      b.camDist = bd; // faces only blink and glance, and bots only have life moments, when this is small
      const near = reel ? (b.isLead ? 25 : 17) : (b.isLead ? 50 : 34);
      const show = b.mode !== 'beamIn' && !b.leaving && b.scale > 0.5 && (b.selected || b.hover || (prefs.labels && bd < near) || (b.data.waiting && bd < 98));
      b.label.visible = show; // CSS2DRenderer owns the element's display; drive the object instead
      if (!show) continue;
      b.labelName.textContent = b.displayName();
      b.labelRole.textContent = prefs.labels && bd < near * 0.6 || b.selected || b.hover ? roleWord(b) : '';
      b.labelDot.style.background = STATUS_CSS[b.statusKey()] || STATUS_CSS.idle;
      const act = b.selected || b.hover || (prefs.labels && bd < (reel ? 9 : 12));
      b.labelAct.style.display = act ? '' : 'none';
      if (act) b.labelAct.textContent = b.activityText();
      b.labelEl.classList.toggle('sel', !!b.selected);
      b.labelEl.classList.toggle('waiting', !!b.data.waiting);
    }
  }
}
