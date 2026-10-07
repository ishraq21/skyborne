
// =====================================================================
// the console, HUD, reel overlay
// =====================================================================
let uiDirty = true, uiT = 0, tab = 'city', logFilter = 'all', logKind = 'all', sessFilter = store.get('sfilter', 'all');
const STATUS_WORD = { working: 'Working', done: 'Done', error: 'Error', idle: 'Idle', wait: 'Needs you', asleep: 'Asleep' };
// the Sessions tab's filter chips: id, label, and which district statuses it matches
const SESS_CHIPS = [['all', 'All'], ['active', 'Active'], ['working', 'Working'], ['wait', 'Needs you'], ['idle', 'Idle'], ['asleep', 'Asleep'], ['done', 'Done'], ['error', 'Error']];
const SESS_EMPTY = { active: 'Nothing is active right now.', working: 'Nothing is working right now.', wait: 'Nothing needs you right now.', idle: 'Nothing is idle right now.', asleep: 'Nothing is asleep right now.', done: 'Nothing is done right now.', error: 'No errors right now.' };
const sessMatch = (f, st) => f === 'all' || (f === 'active' ? st !== 'asleep' : st === f);
const STATUS_RANK = { wait: 0, error: 1, working: 2, done: 3, idle: 4, asleep: 5 };

function cityStats() {
  let work = 0, wait = 0, tok = 0, districts = 0;
  const waiting = [];
  for (const d of city.districts.values()) {
    if (d.leaving) continue; districts++; tok += d.tokens;
    const needs = city.needs.has(d.id);  // a request still waiting counts however long it waits (Claude Code is silent meanwhile)
    for (const b of d.robots.values()) {
      if (b.leaving) continue;
      if (!d.asleep && b.data.status === 'working') work++;
      if ((!d.asleep || needs) && b.data.waiting) { wait++; if (!d.isSample) waiting.push(b); }
    }
  }
  return { work, wait, tok, districts, waiting };
}
function safeLine(f) { return prefs.safe ? (SAFE_TEXT[f.kind] || 'Working') : f.text; }
function headlineFor(d) {
  const h = d.doc?.headline || '';
  if (prefs.safe) { const st = d.status(); return st === 'wait' ? 'Waiting for you' : st === 'working' ? 'Working' : st === 'asleep' ? 'Asleep' : 'Between tasks'; }
  return h;
}
const STATUSLINE_HINT = "Needs Skyborne's status line: run skyborne install --statusline";
const PLAN_NOTE = "On a Pro, Max, Team or Enterprise plan this isn't what you pay: usage is part of your plan.";
// the Usage tile: the 5-hour limit when Claude Code reports one (Pro and Max plans), else what the sessions
// active today would cost at API list prices (Claude Code's own estimate; on a Pro, Max, Team or Enterprise plan
// usage is part of the plan, so it's not a bill), else a dash. Both come from Skyborne's status line.
function usageNow() {
  let five = null, at = -1, cost = 0, costN = 0, statusline = false;
  const now = Date.now(), midnight = new Date(now).setHours(0, 0, 0, 0);
  for (const doc of city.allDocs.values()) {
    if (doc.context || doc.cost || doc.rateLimits) statusline = true;
    const f = doc.rateLimits?.five_hour;
    if (f && typeof f.used_percentage === 'number' && (doc.updatedAt || 0) > at) { five = f; at = doc.updatedAt || 0; }
    if (typeof doc.cost?.usd === 'number' && (doc.updatedAt || 0) >= midnight) { cost += doc.cost.usd; costN++; }
  }
  // the status line only runs while a session is busy, so the newest reading can be from a window that has since reset
  const reset = !!five && typeof five.resets_at === 'number' && five.resets_at * 1000 <= now;
  if (five && !reset) return { value: Math.round(five.used_percentage) + '%', label: '5-hour limit', five, statusline };
  if (costN) return { value: '$' + (cost < 100 ? cost.toFixed(2) : Math.round(cost)), label: 'API est. today', cost, costN, reset, statusline };
  return { value: '—', label: 'Usage', reset, statusline };
}
// the Context tile: the fullest live session's context window
function contextNow() {
  const now = Date.now();
  let best = null;
  for (const d of city.districts.values()) {
    if (d.leaving || d.isSample || !d.doc?.context || !isLive(d.doc, now, prefs.liveMin * 60_000)) continue;
    if (!best || d.doc.context.percent > best.doc.context.percent) best = d;
  }
  if (best) { const c = best.doc.context; return { value: Math.round(c.percent) + '%', tip: `Fullest: ${best.displayName()} · ${fmtTokens(c.tokens)} of ${fmtTokens(c.window)} tokens` }; }
  return { value: '—', tip: usageNow().statusline ? 'No live session has reported its context yet' : STATUSLINE_HINT };
}


// ---------------- where the tokens come from ----------------
// A session's total counts every turn's new input, output, cache writes and cache re-reads (the
// whole conversation is re-read each turn), so most of a big number is cache re-reads.
const TOK_PARTS = [['cr', 'Cache re-read'], ['in', 'New input'], ['cw', 'Cache written'], ['out', 'Output']];
const usageSum = (u) => u.in + u.out + u.cw + u.cr;
// a model id as people say it ("claude-opus-5-5" is Opus 5.5); an id we don't know is shown as it is
const MODEL_NAMES = [['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-fable-5-1', 'Fable 5.1'], ['claude-haiku-4-5', 'Haiku 4.5']];
function modelName(id) {
  id = String(id || ''); if (!id) return '';
  const hit = MODEL_NAMES.find(([prefix]) => id.startsWith(prefix));
  return hit ? hit[1] : id;
}
// one session's tokens, by agent name: the lead, helpers still here, helpers that already left
function districtTokens(d) {
  const t = d.doc?.tokens || {}, parts = t.parts || null, agents = [];
  let named = 0;
  const here = new Set();
  for (const a of d.doc?.agents || []) {
    here.add(a.id);
    const bot = d.robots.get(a.id), role = a.id === 'main' || !a.parent ? 'Lead' : roleOf(d, a.id);
    const name = bot ? bot.displayName() : nickFor(d.id + ':' + a.id);
    const mine = a.usage ? usageSum(a.usage) : 0;
    if (!parts) continue;
    // a helper's tokens arrive as it finishes, so a working one has none to show yet
    agents.push({ name, role, model: modelName(a.model), tokens: mine, pending: !mine && a.status === 'working' && role !== 'Lead' });
    named += mine;
  }
  for (const h of t.helpers || []) {
    if (here.has(h.id)) continue;
    agents.push({ name: nickFor(d.id + ':' + h.id), role: roleOf(d, h.id), model: modelName(h.model), tokens: usageSum(h.usage), left: true });
    named += usageSum(h.usage);
  }
  const earlier = parts ? Math.max(0, d.tokens - named) : 0;
  return { total: d.tokens, parts, agents, earlier };
}
function tokenReport() {
  const ds = [...city.districts.values()].filter((d) => !d.leaving);
  const sum = { in: 0, out: 0, cw: 0, cr: 0 }; let unsplit = 0, total = 0, cost = 0, costN = 0;
  const rows = ds.map((d) => {
    const r = districtTokens(d); total += r.total;
    if (r.parts) for (const k in sum) sum[k] += r.parts[k]; else unsplit += r.total;
    if (typeof d.doc?.cost === 'number') { cost += d.doc.cost; costN++; }
    return { d, ...r };
  }).sort((a, b) => b.total - a.total);
  return { rows, sum, unsplit, total, cost, costN };
}
const tokTipText = (r) => r.parts ? TOK_PARTS.map(([k, label]) => label + ' ' + fmtTokens(r.parts[k])).join(' · ') + (prefs.safe ? '' : '\n' + r.agents.map((a) => `${a.role} · ${a.name}${a.model ? ' (' + a.model + ')' : ''} ${a.pending ? 'counted when it finishes' : a.tokens ? fmtTokens(a.tokens) : 'none yet'}`).join('\n')) : 'Not broken down yet. This session started before the update; restart it to see the breakdown.';
let tokOpen = false, tokPinned = false, tokCloseT = 0;
function renderTokTip() {
  const rep = tokenReport(), body = $('tokTipBody');
  const pct = (n) => rep.total ? Math.round(n / rep.total * 100) + '%' : '0%';
  const row = (label, n) => `<div class="tt-row" data-n="${n}"><span>${label}</span><b>${fmtTokens(n)}</b><em>${pct(n)}</em><i style="width:${rep.total ? Math.max(1, Math.round(n / rep.total * 100)) : 0}%"></i></div>`;
  const u = usageNow();
  let h = u.five ? `<div class="tt-sec" style="margin-top:0">5-hour limit</div><div class="tt-note">${Math.round(u.five.used_percentage)}% used${typeof u.five.resets_at === 'number' ? ' · Resets ' + clockStr(u.five.resets_at * 1000) : ''}. From Claude Code's status line.</div>`
    : u.costN ? `<div class="tt-sec" style="margin-top:0">API estimate today</div><div class="tt-note">About $${u.cost < 10 ? u.cost.toFixed(2) : Math.round(u.cost)} at API list prices across the ${u.costN} session${u.costN === 1 ? '' : 's'} active today, Claude Code's own estimate. ${PLAN_NOTE}</div>`
    : `<div class="tt-note">${u.statusline ? 'No usage limit or cost reported yet.' : esc(STATUSLINE_HINT) + ' to see your usage limit or cost here.'}</div>`;
  if (u.reset) h = '<div class="tt-note" style="margin-top:0">Your last 5-hour reading is from a window that has since reset. A new one comes with the next busy session.</div>' + h;
  h += '<div class="tt-sec">Tokens</div><div class="tt-note">Every turn re-reads the conversation so far, and those cached re-reads count each time.</div><div class="tt-sec">Where they come from</div>'
    + TOK_PARTS.map(([k, label]) => row(label, rep.sum[k])).join('') + (rep.unsplit ? row('Not broken down', rep.unsplit) : '');
  if (rep.costN) h += `<div class="tt-note" style="margin-top:6px">About $${rep.cost < 10 ? rep.cost.toFixed(2) : Math.round(rep.cost)} so far at API list prices, Claude Code's own estimate${rep.costN < rep.rows.length ? ` (${rep.costN} of ${rep.rows.length} sessions report it)` : ''}.${u.five || !u.costN ? ' ' + PLAN_NOTE : ''}</div>`; // the plan note once: here unless the top already says it
  if (!prefs.safe && rep.rows.length) {
    h += '<div class="tt-sec">By session</div>';
    for (const r of rep.rows) {
      h += `<div class="tt-s"><span class="sw" style="background:${hexCss(r.d.hue)}"></span><span class="nm">${esc(r.d.displayName())}</span><b>${fmtTokens(r.total)}</b></div>`;
      if (!r.parts) { h += '<div class="tt-a late"><span>Not broken down yet. Restart this session to see it.</span></div>'; continue; }
      for (const a of r.agents) h += `<div class="tt-a${a.pending ? ' late' : ''}"><span>${esc(a.role)} · ${esc(a.name)}${a.model ? ' · ' + esc(a.model) : ''}${a.left ? ' · Finished' : ''}</span><b>${a.pending ? 'When it finishes' : a.tokens ? fmtTokens(a.tokens) : 'None yet'}</b></div>`;
      if (r.earlier) h += `<div class="tt-a late"><span>Earlier helpers</span><b>${fmtTokens(r.earlier)}</b></div>`;
    }
  }
  const top = body.scrollTop; setHTML(body, h); body.scrollTop = top;
}
function setTokOpen(open, pinned) {
  clearTimeout(tokCloseT);
  tokOpen = open; tokPinned = open && !!pinned;
  $('tokTip').hidden = !open; $('tokStat').setAttribute('aria-expanded', String(open));
  if (open) renderTokTip();
}
const tokSoftClose = () => { if (tokPinned) return; clearTimeout(tokCloseT); tokCloseT = setTimeout(() => setTokOpen(false), 250); };
$('tokStat').addEventListener('mouseenter', () => { if (!tokPinned) setTokOpen(true); });
$('tokStat').addEventListener('mouseleave', tokSoftClose);
$('tokTip').addEventListener('mouseenter', () => clearTimeout(tokCloseT));
$('tokTip').addEventListener('mouseleave', tokSoftClose);
$('tokStat').addEventListener('focus', () => { if (!tokOpen) setTokOpen(true); });
$('tokStat').addEventListener('click', () => setTokOpen(!(tokOpen && tokPinned), true)); // a tap or click keeps it open
$('tokStat').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTokOpen(!(tokOpen && tokPinned), true); }
});
$('console').addEventListener('keydown', (e) => { if (e.key === 'Escape' && tokOpen) { e.stopPropagation(); e.preventDefault(); setTokOpen(false); $('tokStat').focus({ preventScroll: true }); } });
$('console').addEventListener('focusout', (e) => { if (tokOpen && !tokPinned && !$('console').contains(e.relatedTarget)) setTokOpen(false); });
document.addEventListener('pointerdown', (e) => { if (tokOpen && !e.target.closest('#tokStat, #tokTip')) setTokOpen(false); });

function setTab(t) {
  tab = t;
  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === t));
  $('paneCity').hidden = t !== 'city'; $('paneLog').hidden = t !== 'log'; $('paneSet').hidden = t !== 'set';
  uiDirty = true;
}
function setConsole(open) {
  prefs.console = open; store.set('console', open);
  $('console').dataset.open = String(open); $('btnConsole').setAttribute('aria-pressed', String(open));
}

function renderCity() {
  if (detail.id) { renderDetail(); return; }
  renderPastRow();
  const ds = [...city.districts.values()].filter((d) => !d.leaving);
  $('cntCity').textContent = ds.length ? String(ds.length) : '';
  if (!ds.length) {
    const live = city.status === 'live';
    $('sessFilters').hidden = true;
    setHTML($('sessList'), `<div class="empty-note">${live && city.hiddenPast
      ? `<b>Nothing live right now.</b><br>Sessions heard from in the last ${liveLabel()} show here; the past ones are a click away.`
      : live ? '<b>No districts yet.</b><br>Every Claude Code session you run becomes a district here. Send any session a prompt and it rises out of the clouds.'
      : city.status === 'offline' ? '<b>Can\'t reach Skyborne.</b><br>Start it with <code>skyborne</code>; this page reconnects by itself.'
      : city.status === 'replay' ? '<b>Playing a recording…</b>' : '<b>Connecting to Skyborne…</b>'}</div>`);
    return;
  }
  if (city.renaming && renameDrawn) return; // keep the name box steady while you type
  // filter chips: counts per status; Done and Error only show up while there is one
  const counts = {}; for (const d of ds) { const st = d.status(); counts[st] = (counts[st] || 0) + 1; }
  counts.all = ds.length; counts.active = ds.length - (counts.asleep || 0);
  const chips = SESS_CHIPS.filter(([id], i) => i < 6 || counts[id]); // the first six always show
  const filter = chips.some(([id]) => id === sessFilter) ? sessFilter : 'all'; // a chip that's gone shows everything, without forgetting the choice
  $('sessFilters').hidden = false;
  const hadFocus = document.activeElement?.dataset?.sf; // pressing a chip rebuilds the row; keep the keyboard focus on it
  setHTML($('sessFilters'), chips.map(([id, label]) => `<button type="button" data-sf="${id}" aria-pressed="${id === filter}">${label}<span class="n">${counts[id] || 0}</span></button>`).join(''));
  if (hadFocus) $('sessFilters').querySelector(`[data-sf="${hadFocus}"]`)?.focus();
  // what needs you first, then errors, then whatever is slow, then the rest; newest first within each
  const now = Date.now(), slow = new Map(ds.map((d) => [d, slowOf(d, now)]));
  const rank = (d) => { const st = d.status(); return st === 'wait' ? 0 : st === 'error' ? 1 : slow.get(d) ? 2 : st === 'working' ? 3 : 4 + (STATUS_RANK[st] || 0); };
  ds.sort((a, b) => (rank(a) - rank(b)) || ((b.doc?.updatedAt || 0) - (a.doc?.updatedAt || 0)));
  const q = prefs.showPast && !prefs.safe ? $('sessSearch').value.trim().toLowerCase() : '';
  const found = (d) => !q || [d.givenName(), d.doc?.sessionName, d.title].some((t) => String(t || '').toLowerCase().includes(q));
  const shown = ds.filter((d) => d.id === city.renaming || (sessMatch(filter, d.status()) && found(d)));
  if (!shown.length) { setHTML($('sessList'), `<div class="empty-note">${q ? `No session matches “${esc(q)}”.` : SESS_EMPTY[filter]}</div>`); return; }
  const focused = document.activeElement?.closest?.('#sessList [data-d]')?.dataset.d;  // a rebuilt list keeps the keyboard on its card
  setHTML($('sessList'), '<div class="dlist">' + shown.map((d) => {
    const st = d.status(), doc = d.doc || {}, sl = slow.get(d);
    const bots = [...d.robots.values()].filter((b) => !b.leaving);
    if (city.renaming === d.id) {
      const fallback = doc.sessionName || d.title;
      return `<div class="dwrap"><div class="dcard editing">
        <div class="drow"><span class="swatch" style="background:${hexCss(d.hue)}"></span><input class="dname-in" id="renameIn" data-for="${esc(d.id)}" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(d.givenName() || d.title)}" placeholder="${esc(fallback)}" aria-label="District name"></div>
        <div class="dhint">Enter to save · Esc to cancel · Leave it empty to go back to “${esc(fallback)}”. Only Skyborne shows this name; your session isn't touched.</div>
      </div></div>`;
    }
    const folder = d.givenName() && !prefs.safe ? `<span>Folder ${esc(d.title)}</span>` : '';
    // how full the conversation is, only once Claude Code has a reading and while the session is awake
    const leadModel = modelName(d.lead()?.data.model);
    const cx = !d.asleep && doc.context ? doc.context : null;
    const ctxTip = cx ? `${fmtTokens(cx.tokens)} of ${fmtTokens(cx.window)} tokens used in the model's window. The fuller it gets, the nearer Claude Code is to summarising older turns.` : '';
    const pencil = d.isSample || prefs.safe ? '' : `<button type="button" class="dren" data-ren="${esc(d.id)}" aria-label="Rename ${esc(d.displayName())}" title="Rename">✎</button>`;
    return `<div class="dwrap"><button type="button" class="dcard${selection.district === d ? ' sel' : ''}${d.asleep && st !== 'wait' ? ' asleep' : ''}${pencil ? ' has-ren' : ''}" data-d="${esc(d.id)}">
      <div class="drow"><span class="swatch" style="background:${hexCss(d.hue)}"></span><span class="dname">${esc(d.displayName())}</span>${d.isSample ? '<span class="pill asleep" style="margin-left:6px">Sample</span>' : ''}${sl ? '<span class="slow">Slow</span>' : ''}<span class="pill ${st}">${STATUS_WORD[st]}</span></div>
      ${headlineFor(d) ? `<div class="dhead">${esc(headlineFor(d))}</div>` : ''}
      <div class="dmeta">${sl ? `<span class="slow-t">${esc(sl.text)}</span>` : ''}${folder}${doc.startedAt ? '<span>Up ' + agoCoarse(doc.startedAt) + '</span>' : ''}<span>${doc.turns || 0} turns</span>${leadModel ? `<span>${esc(leadModel)}</span>` : ''}<span title="${esc(tokTipText(districtTokens(d)))}">${fmtTokens(d.tokens)} tokens</span>${cx ? `<span title="${esc(ctxTip)}">Context ${Math.round(cx.percent)}%</span>` : ''}<span>Seen ${agoCoarse(doc.updatedAt || 0)}</span></div>
      ${cx ? `<div class="ctxbar${cx.percent >= 95 ? ' max' : cx.percent >= 85 ? ' hi' : ''}" title="${esc(ctxTip)}"><i style="width:${Math.max(1, Math.round(cx.percent))}%"></i></div>` : ''}
      <div class="bots">${bots.map((b) => `<span class="bot" data-bot="${esc(b.key)}"><i style="background:${STATUS_CSS[b.statusKey()]}"></i>${esc(whoOf(d, b.id))}</span>`).join('')}</div>
    </button>${pencil}</div>`;
  }).join('') + '</div>');
  if (city.renaming) { renameDrawn = true; const i = $('renameIn'); if (i) { i.focus(); i.select(); } }
  else if (focused) { const el = $('sessList').querySelector(`[data-d="${CSS.escape(focused)}"]`); if (el && document.activeElement !== el) el.focus({ preventScroll: true }); }
}
const liveLabel = () => (prefs.liveMin >= 60 ? prefs.liveMin / 60 + (prefs.liveMin === 60 ? ' hour' : ' hours') : prefs.liveMin + ' minutes');
// "Show past sessions (N)", and the search box while they show (a recording shows all it has: no row)
function renderPastRow() {
  const n = city.hiddenPast, show = !source?.replay && (n > 0 || prefs.showPast);
  $('pastRow').hidden = !show;
  if (!show) return;
  const label = prefs.showPast ? 'Hide past sessions' : `Show past sessions (${n})`;
  if ($('btnPast').textContent !== label) $('btnPast').textContent = label;
  $('btnPast').setAttribute('aria-pressed', String(prefs.showPast));
  const search = prefs.showPast && !prefs.safe;
  $('sessSearch').hidden = !search;
  if (!search && $('sessSearch').value) $('sessSearch').value = '';
}

// ---------------- renaming a district ----------------
// The name lives in Skyborne's own records (names/<session id>), never in the
// session's record and never in Claude Code, so it can't disturb your work.
let renameDrawn = false;
function startRename(id) {
  if (!city.districts.has(id) || prefs.safe) return;
  city.renaming = id; renameDrawn = false; uiDirty = true;
  if (tab !== 'city') setTab('city');
}
function cancelRename() { if (!city.renaming) return; city.renaming = null; renameDrawn = false; uiDirty = true; }
async function commitRename(id, value) {
  if (city.renaming !== id) return;
  city.renaming = null; renameDrawn = false; uiDirty = true;
  const d = city.districts.get(id); if (!d) return;
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const fallback = d.doc?.sessionName || d.title;
  const reset = !name || name === fallback;
  if ((city.names.get(id) || '') === (reset ? '' : name)) return;
  if (source?.replay) { toast('Renaming is off while a recording plays.'); return; }
  const before = city.names.get(id);
  if (reset) city.names.delete(id); else city.names.set(id, name);
  d.updateLabel();
  try {
    await source.rename(id, reset ? null : name);
    toast(reset ? `Back to ${fallback}` : `Renamed to ${name}`);
  } catch (e) {
    if (before) city.names.set(id, before); else city.names.delete(id);
    d.updateLabel();
    toast(e && e.code === 403 ? RESTARTED : 'Could not save that name. Try again.');
  }
}

// which Skybot wrote a log line: its own name (Pip, Mochi…) and its role ("Lead", "Explore")
function feedBot(f, d) {
  const lead = d.lead();
  let id = f.agentId;
  if (!id) {
    if ((lead && f.agent === lead.data.name) || DEFAULT_LEAD_NAMES.has(f.agent)) id = 'main';
    else { for (const b of d.robots.values()) if (b.data.name === f.agent) { id = b.id; break; } }
  }
  if (!id) id = 'name:' + f.agent;
  const bot = d.robots.get(id);
  const key = d.id + ':' + id;
  const name = bot ? bot.displayName() : (id === 'main' && customLeadName(f.agent, d.title)) || nickFor(key);
  return { id, name, role: id.startsWith('name:') ? 'Helper' : roleOf(d, id) };
}
// the Logs tab: every session's newest lines, filtered by kind and session, newest first. One fixed-height
// row per line, and only the rows in view are built, so thousands of lines stay smooth.
let logRows = [], logSel = -1;
function renderLog() {
  const ds = [...city.districts.values()].filter((d) => !d.leaving);
  setHTML($('logKinds'), LOG_KINDS.map(([id, label]) => `<button type="button" data-lk="${id}" aria-pressed="${logKind === id}">${label}</button>`).join(''));
  setHTML($('logFilters'), [`<button type="button" data-f="all" aria-pressed="${logFilter === 'all'}">All sessions</button>`]
    .concat(ds.map((d) => `<button type="button" data-f="${esc(d.id)}" aria-pressed="${logFilter === d.id}">${esc(d.displayName())}</button>`)).join(''));
  const rows = [];
  for (const d of ds) { if (logFilter !== 'all' && logFilter !== d.id) continue; for (const f of d.doc?.feed || []) if (logKindMatch(logKind, f)) rows.push([f, d]); }
  rows.sort((x, y) => y[0].ts - x[0].ts);
  // every update brings new feed objects, so the selected line is found again by what it says, not by identity
  const key = (r) => r && r[1].id + '|' + r[0].ts + '|' + r[0].agent + '|' + r[0].kind + '|' + (r[0].toolUseId || '') + '|' + r[0].text;
  const selected = key(logRows[logSel]);
  logRows = rows;
  logSel = selected ? rows.findIndex((r) => key(r) === selected) : -1;
  $('cntLog').textContent = rows.length ? String(Math.min(rows.length, 9999)) : '';
  drawLog();
}
function drawLog() {
  const host = $('logList');
  if (!logRows.length) { setHTML(host, `<div class="empty-note">${logKind === 'all' && logFilter === 'all' ? 'The log fills up as bots work.' : 'Nothing like that in the log yet.'}</div>`); return; }
  drawVList(host, document.querySelector('.c-body'), logRows.length, LOG_ROW_H, (i, style) => {
    const [f, d] = logRows[i], k = f.kind || 'think', w = feedBot(f, d);
    return `<div class="lrow k-${k}${i === logSel ? ' sel' : ''}" style="${style}" data-log="${i}" id="lg-${i}" role="option" aria-selected="${i === logSel}">`
      + `<span class="t">${clockStr(f.ts)}</span><i style="background:${KIND_COLOR[k] || KIND_COLOR.tool}"></i>`
      + `<span class="w">${esc(w.role + ' · ' + w.name)}${logFilter === 'all' ? ` <em>· ${esc(d.displayName())}</em>` : ''}</span><span class="dur">${f.durationMs != null ? fmtDur(f.durationMs) : ''}</span>`
      + `<span class="x">${esc(cap((KIND_LABEL[k] || 'Log').toLowerCase()))} · ${esc(safeLine(f))}</span></div>`;
  });
  if (logSel >= 0) host.setAttribute('aria-activedescendant', 'lg-' + logSel); else host.removeAttribute('aria-activedescendant');
}
// a log line opens its session's detail, at its step when it is one
function openLogRow(i) {
  const r = logRows[i]; if (!r) return;
  logSel = i;
  const [f, d] = r;
  openDetail(d, null, f.toolUseId || null);
}
function renderSettings() {
  for (const b of $('segTime').children) b.setAttribute('aria-pressed', String(b.dataset.v === prefs.time));
  $('swTilt').setAttribute('aria-checked', String(prefs.tilt));
  $('swLabels').setAttribute('aria-checked', String(prefs.labels));
  $('swSafe').setAttribute('aria-checked', String(prefs.safe));
  $('swSound').setAttribute('aria-checked', String(prefs.sound));
  $('swSamples').setAttribute('aria-checked', String(prefs.samples));
  $('swNotify').setAttribute('aria-checked', String(prefs.notify));
  for (const b of $('segLive').children) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === prefs.liveMin));
  if (document.activeElement !== $('inMayor')) $('inMayor').value = prefs.mayor;
}

let ringKey = '';
function renderHud(stats) {
  // what needs you: live, the server's open requests (the inbox); a recording, its waiting bots
  const need = source && !source.replay ? asks.length : stats.wait;
  $('sNeed').textContent = need; $('sNeedBox').classList.toggle('warn', need > 0);
  $('sWork').textContent = stats.work;
  const u = usageNow(), c = contextNow();
  $('sUse').textContent = u.value; $('sUseLabel').textContent = u.label;
  $('sCtx').textContent = c.value; $('ctxStat').title = c.tip; $('ctxStat').setAttribute('aria-label', 'Context ' + c.value + '. ' + c.tip);
  const hs = document.getElementById('hallSub'); if (hs) hs.textContent = prefs.mayor ? 'Mayor ' + prefs.mayor : 'Mayor';
  $('cUpdated').textContent = city.lastData ? 'Updated ' + (agoCoarse(city.lastData) === 'just now' ? 'just now' : agoCoarse(city.lastData) + ' ago') : 'Waiting for data';
  const rk = `${stats.districts}|${stats.work}|${fmtTokens(stats.tok)}`;
  if (rk !== ringKey) { ringKey = rk; drawRing(`SKYBORNE   ✦   ${stats.districts} DISTRICT${stats.districts === 1 ? '' : 'S'}   ✦   ${stats.work} AGENT${stats.work === 1 ? '' : 'S'} WORKING   ✦   ${fmtTokens(stats.tok)} TOKENS`); }
  // the Mayor's alert
  const al = $('alert');
  const WAIT_WHAT = { AskUserQuestion: 'a question', ExitPlanMode: 'a plan to review' };  // not yes-or-no requests: say what they are
  if (stats.waiting.length && !director.on) {
    const b = stats.waiting[0];
    $('alertText').textContent = stats.waiting.length === 1
      ? (prefs.safe ? `${b.displayName()} needs you` : `${b.displayName()} in ${b.d.displayName()} needs you: ${WAIT_WHAT[b.data.tool] || b.data.tool || 'a tool'}`)
      : `${stats.waiting.length} Skybots need the Mayor`;
    al.hidden = false; al.dataset.key = b.key;
  } else al.hidden = true;
  // a number never ends a line apart from its word
  $('reelStats').textContent = `${stats.districts}\u00a0district${stats.districts === 1 ? '' : 's'}  ·  ${stats.work}\u00a0agent${stats.work === 1 ? '' : 's'} working`;
}
function setLive(status) {
  city.status = status;
  $('reelLiveText').textContent = prefs.samples ? 'PREVIEW' : status === 'live' ? 'LIVE · REAL CLAUDE AGENTS' : status === 'replay' ? 'REPLAY · RECORDED SESSION'
    : status === 'offline' ? 'OFFLINE' : 'CONNECTING';
  $('reelLive').className = 'live' + (status === 'live' && !prefs.samples ? ' on' : ' warn');
  uiDirty = true;
}

// ---------------- "Needs you": answering permission requests ----------------
// The live server sends its open requests (`asks`). Each has a card at the top of the console with
// Approve and Deny (or "Answer in the terminal" when only the terminal can answer it). Cards are kept
// by request id and changed in place, so focus, a click in progress and "Show" survive updates. After a
// click the card says the answer was sent until Claude Code confirms it (`answer`); if the terminal had
// answered first, the card says so for a moment, then closes. An answer is never shown as given early.
let asks = [];
const askUI = new Map();  // ask id -> { a, el, shown, busy, sent, note, key, leaveAt }
const ASK_LINGER_MS = 3000;
const TOO_LATE = 'Already answered in the terminal';
function askDetail(a) {
  const i = a.input && typeof a.input === 'object' ? a.input : {};
  // an MCP tool's name carries its server's name, often a project or company: hidden in Safe to film
  const tool = prefs.safe && /^mcp__/.test(a.tool) ? 'Tool' : a.tool;
  if (typeof i.command === 'string') return { label: tool + ' command', text: i.command };
  const path = [i.file_path, i.notebook_path, i.path].find((p) => typeof p === 'string');
  if (path) return { label: tool + ' · File path', text: path };
  if (typeof i.url === 'string') return { label: tool + ' · Address', text: i.url };
  if (Array.isArray(i.questions)) return { label: 'Question', text: i.questions.map((q) => q && q.question).filter(Boolean).join('\n') };
  if (typeof i.plan === 'string') return { label: 'Plan', text: i.plan };
  return { label: tool + ' · Input', text: JSON.stringify(a.input ?? {}, null, 1) };
}
function askCard(a) {
  const el = document.createElement('div');
  el.className = 'ask'; el.tabIndex = 0; el.dataset.ask = a.id; el.setAttribute('role', 'group');
  el.innerHTML = '<div class="ask-h"><span class="ask-who"></span></div><div class="ask-time"></div>'
    + '<div class="ask-label"><span class="ask-what"></span><button type="button" data-show hidden></button></div><div class="ask-detail"></div>'
    + '<div class="ask-act"><button type="button" class="yes" data-ans="allow"></button><button type="button" data-ans="deny"></button><span class="ask-note"></span></div>';
  return { a, el, shown: false, busy: null, note: '', key: '' };
}
function updateAskCard(ui) {
  const a = ui.a, d = city.districts.get(a.session), bot = d?.robots.get(a.agent);
  const name = bot ? bot.displayName() : nickFor(a.session + ':' + a.agent);
  const role = a.agent === 'main' ? 'Lead' : d ? roleOf(d, a.agent) : 'Helper';
  const where = d ? d.displayName() : 'a session';  // never the folder name: it may not be safe to film
  const det = askDetail(a), hide = prefs.safe && !ui.shown, open = a.state === 'open' && !ui.leaveAt && !ui.sent;
  const key = JSON.stringify([name, role, where, det.label, hide ? '' : det.text, prefs.safe, ui.shown, open, ui.busy, ui.note]);
  if (key === ui.key) return;
  ui.key = key;
  const q = (s) => ui.el.querySelector(s);
  ui.el.classList.toggle('terminal', !open);
  ui.el.setAttribute('aria-label', `${name} needs you: ${det.label}`);
  q('.ask-who').innerHTML = `<strong>${esc(role)} · ${esc(name)}</strong> in ${esc(where)}`;
  q('.ask-what').textContent = det.label;
  q('[data-show]').hidden = !prefs.safe; q('[data-show]').textContent = ui.shown ? 'Hide' : 'Show';
  q('.ask-detail').hidden = hide; q('.ask-detail').textContent = hide ? '' : det.text;
  const yes = q('[data-ans="allow"]'), no = q('[data-ans="deny"]');
  yes.hidden = no.hidden = !open; yes.disabled = no.disabled = !!ui.busy;
  yes.innerHTML = (ui.busy === 'allow' ? 'Approving…' : a.demo ? DEMO.yes : 'Approve') + '<kbd>A</kbd>';
  no.innerHTML = (ui.busy === 'deny' ? 'Denying…' : a.demo ? DEMO.no : 'Deny') + '<kbd>D</kbd>';
  q('.ask-note').textContent = open ? ui.note || (a.demo ? DEMO.hint : '') : ui.note || (a.state === 'sent' || ui.sent ? 'Sent. Waiting for Claude Code…' : 'Answer in the terminal');
}
// a card that has to say something before it goes ("Already answered in the terminal") stays a moment
function closeAskSaying(ui, note) {
  ui.note = note; ui.busy = null; ui.leaveAt = Date.now() + ASK_LINGER_MS; updateAskCard(ui);
  setTimeout(() => { uiDirty = true; renderAsks(); }, ASK_LINGER_MS + 50);
}
function renderAsks() {
  const box = $('askList'), here = new Set(asks.map((a) => a.id)), now = Date.now();
  for (const [id, ui] of askUI) {
    if (ui.leaveAt ? now < ui.leaveAt : here.has(id) || ui.busy) continue;  // a click in flight waits for its reply
    ui.el.remove(); askUI.delete(id);
  }
  // oldest first: the one that has waited longest is the one nearest its time limit
  const byAge = [...asks].sort((x, y) => ((Number(x.since) || 0) - (Number(y.since) || 0)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const a of byAge) {
    let ui = askUI.get(a.id);
    if (!ui) { ui = askCard(a); askUI.set(a.id, ui); }
    ui.a = a; updateAskCard(ui);
  }
  // live cards oldest first, cards on their way out after them: a card is only ever moved when its place
  // changes, so the one in focus keeps it (A and D keep working)
  const order = [...askUI.values()].filter((ui) => !ui.leaveAt && here.has(ui.a.id)).sort((x, y) => byAge.indexOf(x.a) - byAge.indexOf(y.a))
    .concat([...askUI.values()].filter((ui) => ui.leaveAt || !here.has(ui.a.id)));
  order.forEach((ui, i) => { if (box.children[i] !== ui.el) box.insertBefore(ui.el, box.children[i] || null); });
  $('asksHead').textContent = asks.length ? 'Needs you · ' + asks.length : 'Needs you';
  $('asks').hidden = !askUI.size;
  tickAsks();
}
// each card's clock: how long it has waited, and how long until Skyborne leaves it to the terminal. Only
// this line changes each second, so the card is never rebuilt and keeps its focus.
function tickAsks() {
  const now = Date.now();
  for (const ui of askUI.values()) {
    const a = ui.a, el = ui.el.querySelector('.ask-time');
    const counting = a.state === 'open' && !ui.sent && !ui.leaveAt && typeof a.until === 'number';
    const t = ui.leaveAt || !a.since ? '' : 'Waiting ' + fmtDur(now - a.since) + (counting ? ' · Times out in ' + fmtClock(a.until - now) : '');
    if (el && el.textContent !== t) el.textContent = t;
  }
}
// a desktop alert for each new request while this page isn't in front (Settings → Desktop alerts). The
// first list after connecting is what was already waiting: never news.
let notifySeen = null;
function notifyAsks(list) {
  if (notifySeen === null) { notifySeen = new Set(list.map((a) => a.id)); return; }
  for (const a of list) {
    if (notifySeen.has(a.id)) continue;
    notifySeen.add(a.id);
    if (a.state !== 'open' || !prefs.notify || source?.replay || document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') continue;
    const d = city.districts.get(a.session);
    const body = prefs.safe ? 'A Skybot needs your approval' : `${d ? whoOf(d, a.agent) : 'A Skybot'} in ${d ? d.displayName() : 'a session'}: ${a.tool}`;
    try {
      const n = new Notification('Claude Code needs you', { body, tag: a.id });  // one alert per request, however many tabs are open
      n.onclick = () => { window.focus(); n.close(); if (!prefs.console) setConsole(true); askUI.get(a.id)?.el.focus(); };
    } catch (e) {}
  }
}
async function setNotify(on) {
  if (on) {
    let perm = 'Notification' in window ? Notification.permission : 'unsupported';
    if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; } }
    if (perm !== 'granted') {
      on = false;
      toast(perm === 'unsupported' ? "This browser can't show desktop alerts." : 'Desktop alerts are blocked for this page. Allow them in the browser\'s site settings.');
    }
  }
  prefs.notify = on; store.set('notify', on); uiDirty = true;
}
async function answerAsk(id, decision) {
  const ui = askUI.get(id);
  if (!ui || ui.busy || ui.a.state !== 'open') return;
  if (ui.a.demo) { ui.note = DEMO.note; updateAskCard(ui); return; }  // the site's recorded request: nothing to send
  ui.busy = decision; ui.note = ''; updateAskCard(ui);
  try {
    await source.answer(id, decision);  // sent: the card waits for Claude Code's word (`answer`)
    ui.busy = null; ui.sent = true; updateAskCard(ui);
  } catch (e) {
    if (e?.code === 409) return closeAskSaying(ui, e.reason === 'terminal' ? TOO_LATE : e.reason === 'answered' ? 'Already answered' : 'This request is over');
    ui.busy = null;
    ui.note = e?.code === 403 ? RESTARTED : "Couldn't send that. Try again.";
    updateAskCard(ui); renderAsks();
  }
}
// Claude Code's word on an answer from the page: applied (the arc to City Hall turns green for an
// approval, red for a denial), too late (the terminal had answered), or unknown (the card just goes)
function onAnswer(m) {
  if (!m) return;
  if (m.applied === false) { const ui = askUI.get(m.id); if (ui) closeAskSaying(ui, TOO_LATE); return; }
  if (m.applied !== true) return;
  const b = findBot(m.session + ':' + m.agent);
  if (b) b.flash = { color: m.decision === 'allow' ? STATUS_HEX.working : STATUS_HEX.error, until: clockT.now + (m.decision === 'allow' ? 1.5 : 1.2) };
}
$('asks').addEventListener('click', (e) => {
  const card = e.target.closest('[data-ask]'); if (!card) return;
  const ans = e.target.closest('[data-ans]');
  if (ans) { answerAsk(card.dataset.ask, ans.dataset.ans); return; }
  const ui = askUI.get(card.dataset.ask);
  if (ui && e.target.closest('[data-show]')) { ui.shown = !ui.shown; updateAskCard(ui); }
});
$('asks').addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase(), card = e.target.closest('[data-ask]');
  if ((k !== 'a' && k !== 'd') || !card) return;
  e.preventDefault(); e.stopPropagation();
  answerAsk(card.dataset.ask, k === 'a' ? 'allow' : 'deny');
});

const htmlCache = new WeakMap();
function setHTML(el, html) { if (htmlCache.get(el) === html) return; htmlCache.set(el, html); el.innerHTML = html; }
let consolePointer = false;
$('console').addEventListener('pointerdown', () => { consolePointer = true; });
// renderUI skips the console while a pointer is down on it (a rebuild would eat the click); once it's up, the
// skipped render is owed, or a click's own change (a tab, a filter) would wait for the next data (seconds)
// a touch-scroll ends with pointercancel, not pointerup (and a window can lose focus mid-press): any of them ends it
const pointerDone = () => { setTimeout(() => { consolePointer = false; uiDirty = true; }, 0); };
for (const type of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(type, pointerDone);

function renderUI() {
  const stats = cityStats();
  renderHud(stats);
  if (!prefs.console || director.on || consolePointer) return stats;
  renderAsks();
  if (tokOpen) renderTokTip();
  if (tab === 'city') renderCity(); else if (tab === 'log') renderLog(); else renderSettings();
  return stats;
}

// ---------------- controls ----------------
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600); }
function ensureAudio() {
  if (!prefs.sound || actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
}
function setSound(on) { prefs.sound = on; $('btnSound').setAttribute('aria-pressed', String(on)); if (on) { ensureAudio(); actx?.resume?.(); sfx('deliver'); } uiDirty = true; }
function setSafe(on) { if (on) for (const ui of askUI.values()) ui.shown = false; detail.drawKey = ''; prefs.safe = on; store.set('safe', on); $('btnSafe').setAttribute('aria-pressed', String(on)); for (const d of city.districts.values()) d.updateLabel(); showRecNote(); toast(on ? 'Safe to film: prompts, files and project names are hidden' : 'Safe to film is off'); uiDirty = true; }
function setTime(v) { prefs.time = v; store.set('time', v); $('tipTime').textContent = 'Time: ' + (v === 'sunset' ? 'dusk' : v) + ' (T)'; uiDirty = true; }
function cycleTime() { const order = ['auto', 'day', 'sunset', 'night']; setTime(order[(order.indexOf(prefs.time) + 1) % order.length]); toast('Time of day: ' + (prefs.time === 'sunset' ? 'dusk' : prefs.time)); }
function setReel(on) {
  if (on === director.on) return;
  document.body.classList.toggle('reel', on);
  $('reelHud').hidden = !on;
  $('btnReel').setAttribute('aria-pressed', String(on));
  if (on) { if (selection.bot) selection.bot.selected = false; selection.bot = null; selection.district = null; director.start(); toast('Reel mode: press R or Esc to leave'); }
  else { director.stop(); overview(1.2); }
  setTimeout(resize, 30);
  uiDirty = true;
}
async function toggleFull() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); }
  catch (e) { toast('Full screen is blocked in this frame. Open the page in its own tab, then press F.'); }
}
function setSamples(on) { prefs.samples = on; if (on) startSamples(); else stopSamples(); setLive(city.status); uiDirty = true; }

$('btnConsole').addEventListener('click', () => setConsole(!prefs.console));
$('btnTime').addEventListener('click', cycleTime);
$('btnSafe').addEventListener('click', () => setSafe(!prefs.safe));
$('btnReel').addEventListener('click', () => setReel(!director.on));
$('btnSound').addEventListener('click', () => setSound(!prefs.sound));
$('btnFull').addEventListener('click', toggleFull);
$('alertGo').addEventListener('click', () => { const key = $('alert').dataset.key; const b = findBot(key); if (b) selectBot(b); });
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => setTab(b.dataset.tab));
$('segTime').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTime(b.dataset.v); });
$('swTilt').addEventListener('click', () => { prefs.tilt = !prefs.tilt; store.set('tilt', prefs.tilt); applyTilt(); uiDirty = true; });
$('swLabels').addEventListener('click', () => { prefs.labels = !prefs.labels; store.set('labels', prefs.labels); uiDirty = true; });
$('swSafe').addEventListener('click', () => setSafe(!prefs.safe));
$('swSound').addEventListener('click', () => setSound(!prefs.sound));
$('swSamples').addEventListener('click', () => setSamples(!prefs.samples));
$('inMayor').addEventListener('input', (e) => { prefs.mayor = mayorName(e.target.value); store.set('mayor', prefs.mayor); uiDirty = true; });
function findBot(key) { for (const d of city.districts.values()) for (const b of d.robots.values()) if (b.key === key) return b; return null; }
$('swNotify').addEventListener('click', () => setNotify(!prefs.notify));
$('segLive').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; prefs.liveMin = Number(b.dataset.v); store.set('liveMin', prefs.liveMin); showDocs(); uiDirty = true; });
$('btnPast').addEventListener('click', () => { prefs.showPast = !prefs.showPast; store.set('showPast', prefs.showPast); showDocs(); uiDirty = true; renderUI(); });
$('sessSearch').addEventListener('input', () => { uiDirty = true; renderUI(); });
$('dtBack').addEventListener('click', () => closeDetail());
document.querySelector('.c-body').addEventListener('click', (e) => {
  const ren = e.target.closest('[data-ren]');
  if (ren) { e.stopPropagation(); startRename(ren.dataset.ren); return; }
  if (e.target.closest('.dcard.editing')) return;
  const chip = e.target.closest('[data-bot]');
  if (chip) { const b = findBot(chip.dataset.bot); if (b) selectBot(b); e.stopPropagation(); return; }
  const card = e.target.closest('[data-d]');
  if (card) { const d = city.districts.get(card.dataset.d); if (d) { selectDistrict(d); openDetail(d); } return; }
  const dd = detail.id && city.districts.get(detail.id);
  const agent = e.target.closest('[data-agent]');
  if (agent && dd) {
    const b = agent.dataset.agent && dd.robots.get(agent.dataset.agent);
    if (b && !b.leaving) selectBot(b);  // flies to it and follows, like a click on the bot itself
    else { if (selection.bot) { selection.bot.selected = false; selection.bot = null; } detail.bot = agent.dataset.agent || null; detail.drawKey = ''; uiDirty = true; }
    return;
  }
  const step = e.target.closest('[data-step]'); if (step) { selectStep(step.dataset.step, true); return; }
  if (e.target.closest('[data-close-step]')) { detail.open = null; uiDirty = true; $('dtSteps').focus({ preventScroll: true }); return; }
  const more = e.target.closest('[data-more]');
  if (more) { const i = Number(more.dataset.more); detail.more.has(i) ? detail.more.delete(i) : detail.more.add(i); uiDirty = true; return; }
  const lr = e.target.closest('[data-log]'); if (lr) { openLogRow(Number(lr.dataset.log)); return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'follow') { selection.follow = !selection.follow; uiDirty = true; }
  else if (act === 'district' && dd) { detail.bot = null; detail.drawKey = ''; selectDistrict(dd); }
  else if (act === 'skyline') { detail.bot = null; detail.drawKey = ''; clearSelection(); }
  const f = e.target.closest('[data-f]'); if (f) { logFilter = f.dataset.f; logSel = -1; uiDirty = true; }
  const lk = e.target.closest('[data-lk]'); if (lk) { logKind = lk.dataset.lk; logSel = -1; uiDirty = true; }
  const sf = e.target.closest('[data-sf]'); if (sf) { sessFilter = sf.dataset.sf; store.set('sfilter', sessFilter); uiDirty = true; }
});
document.querySelector('.c-body').addEventListener('keydown', (e) => {
  if (e.target.id === 'renameIn') {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(e.target.dataset.for, e.target.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); }
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.bot) { e.preventDefault(); e.target.click(); }
});
// the console's keys, only while focus is inside it: arrows move through a list, Enter opens, Esc goes back
// (a step, then a session's detail, then the list). A and D stay with the "Needs you" cards.
$('console').addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target, k = e.key, dd = detail.id && city.districts.get(detail.id);
  const steps = dd ? detailSteps() : [], si = steps.findIndex((s) => s.id === detail.sel);
  const moveStep = (by) => { const s = steps[clamp((si < 0 ? (by > 0 ? -1 : steps.length) : si) + by, 0, steps.length - 1)]; if (s) selectStep(s.id, false); };
  let done = true;
  if (k === 'Escape') {
    if (detail.open) { detail.open = null; uiDirty = true; $('dtSteps').focus({ preventScroll: true }); }
    else if (detail.id && !city.renaming) closeDetail();
    else done = false;
  } else if ((k === 'ArrowDown' || k === 'ArrowUp') && t.classList?.contains('dcard')) {
    const cards = [...document.querySelectorAll('#sessList .dcard')], i = cards.indexOf(t);
    cards[clamp(i + (k === 'ArrowDown' ? 1 : -1), 0, cards.length - 1)]?.focus();
  } else if (k === 'ArrowDown' && t.id === 'sessSearch') document.querySelector('#sessList .dcard')?.focus();
  else if ((k === 'ArrowDown' || k === 'ArrowUp') && t.id === 'dtSteps') moveStep(k === 'ArrowDown' ? 1 : -1);
  else if ((k === 'ArrowRight' || k === 'ArrowLeft') && t.id === 'dtCanvas') moveStep(k === 'ArrowRight' ? 1 : -1);
  else if (k === 'Enter' && (t.id === 'dtSteps' || t.id === 'dtCanvas') && detail.sel) selectStep(detail.sel, true);
  else if ((k === 'ArrowDown' || k === 'ArrowUp') && t.id === 'logList' && logRows.length) {
    logSel = clamp((logSel < 0 && k === 'ArrowUp' ? logRows.length : logSel) + (k === 'ArrowDown' ? 1 : -1), 0, logRows.length - 1);
    scrollRowIntoView(document.querySelector('.c-body'), $('logList'), logSel, LOG_ROW_H); drawLog();
  } else if (k === 'Enter' && t.id === 'logList' && logSel >= 0) openLogRow(logSel);
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
});
// the timeline: hover names a step, a click opens it
$('dtCanvas').addEventListener('mousemove', (e) => {
  const r = $('dtCanvas').getBoundingClientRect(), box = $('dtTl').getBoundingClientRect(), tip = $('dtTip');
  const s = timelineHit(e.clientX - r.left, e.clientY - r.top), dd = city.districts.get(detail.id);
  if (!s || !dd) { tip.hidden = true; return; }
  setHTML(tip, stepTip(dd, s)); tip.hidden = false;
  tip.style.left = clamp(e.clientX - box.left + 12, 0, Math.max(0, box.width - tip.offsetWidth)) + 'px';
  tip.style.top = (e.clientY - box.top + 14) + 'px';
});
$('dtCanvas').addEventListener('mouseleave', () => { $('dtTip').hidden = true; });
$('dtCanvas').addEventListener('click', (e) => {
  const r = $('dtCanvas').getBoundingClientRect(), s = timelineHit(e.clientX - r.left, e.clientY - r.top);
  if (s) selectStep(s.id, true);
});
// long lists draw the rows coming into view as they scroll
let scrollDraw = 0;
const onListScroll = (draw) => () => { if (!scrollDraw) scrollDraw = requestAnimationFrame(() => { scrollDraw = 0; draw(); }); };
$('dtSteps').addEventListener('scroll', onListScroll(() => { const dd = city.districts.get(detail.id); if (dd && detail.data) drawSteps(dd); }), { passive: true });
document.querySelector('.c-body').addEventListener('scroll', onListScroll(() => { if (tab === 'log') drawLog(); }), { passive: true });
document.querySelector('.c-body').addEventListener('focusout', (e) => { if (e.target.id === 'renameIn' && city.renaming) commitRename(e.target.dataset.for, e.target.value); });
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/input|textarea|select/i.test(e.target?.tagName || '')) return;
  const k = e.key.toLowerCase();
  if (k === 'r') setReel(!director.on);
  else if (k === 's') setSafe(!prefs.safe);
  else if (k === 'f') toggleFull();
  else if (k === 'c') setConsole(!prefs.console);
  else if (k === 't') cycleTime();
  else if (k === 'm') setSound(!prefs.sound);
  else if (k === 'escape') { if (director.on) setReel(false); else clearSelection(); }
  else return;
  e.preventDefault();
});

// =====================================================================
// main loop
// =====================================================================
let last = performance.now(), perfAcc = 0, perfN = 0, perfT = 0, firstFrame = true;
let lastStats = { wait: 0 };
const intro = { t: 0, on: true, start: 0 };
let frameErrors = 0, shadowTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  try { step(now); }
  catch (e) { if (frameErrors++ < 3) { console.error('Skyborne frame error:', e); } if (frameErrors === 3) toast('Something went wrong drawing the city. Reload the page if it stops moving.'); last = now; }
}
function step(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
  clockT.now += dt;
  updateTimeOfDay(dt); updateNightLit(); animateScreens(dt); updateClouds(dt);
  for (const [id, d] of city.districts) { d.update(dt); if (d.dead) { city.districts.delete(id); city.freeSlots.push(d.slot); if (selection.district === d) selection.district = null; uiDirty = true; } }
  updateHall(dt, lastStats.waiting ? lastStats.waiting.length : 0);
  updateTransit(dt);
  glitter.update(dt); confetti.update(dt); puffs.update(dt);
  if (intro.on) {
    if (!intro.start || DEMO?.holding) intro.start = now;  // the site holds the opening pose while its welcome shows
    intro.t = (now - intro.start) / 4200; const k = easeInOut(Math.min(1, intro.t));
    const pf = camera.aspect < 0.9 ? 1.45 : 1;
    camera.position.set(lerp(-70, 0, k), lerp(190, 84 * pf, k), lerp(300, 112 * pf, k)); controls.target.set(0, lerp(-10, 1, k), 0);
    if (intro.t >= 1 || performance.now() - lastInput < 50) intro.on = false;
    camera.lookAt(controls.target);
  } else updateCamera(dt);
  viewShift.target = prefs.console && !director.on && viewW > 760 ? Math.min(200, ($('console').offsetWidth + 32) / 2) : 0;
  if (Math.abs(viewShift.target - viewShift.cur) > 0.3) { viewShift.cur = damp(viewShift.cur, viewShift.target, 5, dt); applyViewOffset(); }
  updateHover(dt);
  uiT += dt;
  if (uiDirty || uiT > 1) { uiT = 0; uiDirty = false; lastStats = renderUI(); }
  updateLabels();
  shadowTick = (shadowTick + 1) % 2; if (shadowTick === 0 || firstFrame) renderer.shadowMap.needsUpdate = true;
  composer.render();
  labelRenderer.render(scene, camera);
  if (firstFrame) { firstFrame = false; window.__skyborneBooted = true; setTimeout(() => $('boot').classList.add('gone'), 250); }
  // keep it smooth: drop resolution a notch if frames run long
  perfAcc += dt; perfN++; perfT += dt;
  if (perfT > 2) {
    const avg = perfAcc / perfN; perfAcc = 0; perfN = 0; perfT = 0;
    if (avg > 0.034 && dprScale > 0.42) { dprScale *= 0.8; resize(); }
    else if (avg > 0.034 && renderer.shadowMap.enabled && sun.shadow.mapSize.x > 1024) { sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    else if (avg < 0.013 && dprScale < 1) { dprScale = Math.min(1, dprScale * 1.1); resize(); }
  }
}

// ---------------- boot ----------------
// The city's data comes from one source at a time: the local Skyborne server (live), a recording
// (player), or, in the dev preview only, a fake city (window.__skyborneFake, from dev/fake-city.js).
// Each source calls on.docs(Map id → doc), on.names({id: name}) and on.status(status).
let TOKEN = document.querySelector('meta[name="skyborne-token"]')?.content || '';  // this launch's; `ready` brings a restarted server's
const DETAIL_FETCH_MS = 30_000;  // generous: a detail is built on this machine; past this the request gives up
const giveUp = () => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(DETAIL_FETCH_MS) : undefined);
const SHOWN = 60;                 // districts in the city at most: the most recently active sessions
const HELPER_LINGER_MS = 30_000;  // a finished (or failed) helper stays on its island this long, then leaves
let source = null;

// the doc as the city shows it: the server keeps finished helpers, the city lets them go after a while
function view(doc) {
  const now = Date.now(), agents = Array.isArray(doc.agents) ? doc.agents : [];
  const keep = agents.filter((a) => a.id === 'main' || (a.status !== 'done' && a.status !== 'error') || now - (Number(a.activitySince) || 0) < HELPER_LINGER_MS);
  return keep.length === agents.length ? doc : { ...doc, agents: keep };
}
// which sessions need you: live (and the preview), the ones with an open request; a recording, its documents' word
function needsNow() {
  if (source?.replay) return new Set([...city.allDocs].filter(([, doc]) => doc.waiting).map(([id]) => id));
  return new Set(asks.map((a) => a.session));
}
// the sessions the source sent, as the city shows them: live ones (and past ones when asked for), at most
// SHOWN. A recording shows everything it plays.
function showDocs() {
  const all = [...city.allDocs.entries()].sort((a, b) => (Number(b[1].updatedAt) || 0) - (Number(a[1].updatedAt) || 0)).slice(0, SHOWN)
    .map(([id, doc]) => ({ id, doc }));
  city.needs = needsNow();
  const v = source?.replay ? { shown: all, hidden: 0 }
    : visibleDocs(all, { now: Date.now(), windowMs: prefs.liveMin * 60_000, showPast: prefs.showPast, needs: city.needs, pinned: detail.id });
  city.hiddenPast = v.hidden;
  city.liveDocs = v.shown.map(({ id, doc }) => ({ id, exists: true, data: () => view(doc) }));
  refreshDocs();
}
const handlers = {
  docs(map) {
    city.allDocs = map;
    // a session that's gone (cleaned up, or a recording starting over) takes its open detail with it
    if (detail.id && !map.has(detail.id) && !city.districts.get(detail.id)?.isSample) closeDetail('That session is no longer here.');
    showDocs();
  },
  names(names) {
    const m = new Map();
    for (const [id, n] of Object.entries(names || {})) { const name = String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40); if (name) m.set(id, name); }
    city.names = m;
    for (const d of city.districts.values()) d.updateLabel();
    uiDirty = true;
  },
  status(s) { setLive(s); },
  // drawn at once, not at the next frame: frames can be slow (a background tab, a software renderer)
  asks(list) {
    asks = Array.isArray(list) ? list : []; uiDirty = true;
    notifyAsks(asks);
    if (city.needs.size || asks.length) showDocs();  // a session that needs you always shows
    if (prefs.console && !director.on && !consolePointer) renderAsks();
  },
  answer(m) { onAnswer(m); },
};
function useSource(next) {
  try { source?.stop(); } catch (e) {}
  if (detail.id) closeDetail();
  city.allDocs = new Map(); city.liveDocs = []; refreshDocs(); notifySeen = null; handlers.asks([]); notifySeen = null;
  source = next;
  // the old districts sink first (2.4 s), so the new ones rise into the inner slots, not past them
  const begin = () => {
    if (source !== next) return;
    if ([...city.districts.values()].some((d) => d.leaving)) { setTimeout(begin, 150); return; }
    next.start(handlers);
  };
  begin();
}
function connect() { useSource(window.__skyborneFake || liveSource()); }

// live: /events sends names, every recent session, `ready`, the open permission requests (`asks`),
// then each change. After a reconnect (the server restarted) the new set replaces the old one at
// `ready`, and the request list starts over (a new server counts its versions from the start).
// `ready` carries the server's launch token, so actions keep working after a restart without a reload.
function liveSource() {
  let es = null, docs = new Map(), fresh = null, lost = 0, askV = -1;
  const losing = (on) => { if (!lost) lost = setTimeout(() => on.status('offline'), 5000); };  // EventSource retries quietly
  return {
    start(on) {
      on.status('connecting'); losing(on);
      es = new EventSource('/events?feed=50');
      es.addEventListener('open', () => { fresh = new Map(); askV = -1; });
      // two lists can pass each other on the way: only a newer one counts
      es.addEventListener('asks', (e) => { const m = JSON.parse(e.data); if (m.v < askV) return; askV = m.v; on.asks(m.asks); });
      es.addEventListener('answer', (e) => on.answer(JSON.parse(e.data)));
      es.addEventListener('names', (e) => on.names(JSON.parse(e.data).names));
      es.addEventListener('state', (e) => { const m = JSON.parse(e.data); if (fresh) fresh.set(m.id, m.doc); else { docs.set(m.id, m.doc); on.docs(docs); } });
      es.addEventListener('gone', (e) => { const { id } = JSON.parse(e.data); (fresh || docs).delete(id); if (!fresh) on.docs(docs); });
      es.addEventListener('ready', (e) => {
        const token = JSON.parse(e.data || '{}').token;  // an older server sends none: the page's own stays
        if (typeof token === 'string' && token) TOKEN = token;
        if (fresh) docs = fresh; fresh = null; clearTimeout(lost); lost = 0; on.status('live'); on.docs(docs);
      });
      // the server's held requests went with it, so their cards go too (a new server sends its own)
      es.addEventListener('error', () => { fresh = null; on.asks([]); if (city.status === 'live') on.status('connecting'); losing(on); });
    },
    async rename(id, name) {
      const r = await fetch('/api/names', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Skyborne-Token': TOKEN }, body: JSON.stringify({ id, name }) });
      if (!r.ok) throw Object.assign(new Error('rename'), { code: r.status });
    },
    async answer(id, decision) {
      const r = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Skyborne-Token': TOKEN }, body: JSON.stringify({ id, decision }) });
      if (!r.ok) throw Object.assign(new Error('answer'), { code: r.status, reason: (await r.json().catch(() => ({}))).reason });
    },
    // a session's whole record, and one step in full (GET /api/session, /api/step: the token, like actions)
    // a stalled server must not leave the panel on "Loading…": the request gives up with an error, and opening it again tries again
    async detail(id) {
      const r = await fetch('/api/session?id=' + encodeURIComponent(id), { headers: { 'X-Skyborne-Token': TOKEN }, cache: 'no-store', signal: giveUp() });
      if (!r.ok) throw Object.assign(new Error('detail'), { code: r.status });
      return r.json();
    },
    async step(sid, id) {
      const r = await fetch(`/api/step?session=${encodeURIComponent(sid)}&id=${encodeURIComponent(id)}`, { headers: { 'X-Skyborne-Token': TOKEN }, cache: 'no-store', signal: giveUp() });
      if (r.status === 404) return null;
      if (!r.ok) throw Object.assign(new Error('step'), { code: r.status });
      return r.json();
    },
    stop() { es?.close(); clearTimeout(lost); },
  };
}

// player: a file from `skyborne record`. Its frames carry times counted from the start of the
// recording; they're moved to now as they play. It loops after a pause.
function rebase(doc, base) {
  const t = (v) => (typeof v === 'number' ? v + base : v);
  return { ...doc, startedAt: t(doc.startedAt), updatedAt: t(doc.updatedAt),
    waiting: doc.waiting ? { ...doc.waiting, since: t(doc.waiting.since) } : doc.waiting,
    agents: (doc.agents || []).map((a) => ({ ...a, activitySince: t(a.activitySince) })),
    feed: (doc.feed || []).map((f) => ({ ...f, ts: t(f.ts) })),
    ...(doc.ended ? { ended: { ...doc.ended, at: t(doc.ended.at) } } : {}) };
}
// a recorded request that waits in a frame becomes a card. Its command comes from the recording's own
// PermissionRequest events, in order; the id stays the same for as long as the request waits.
function recordedAsks(rec, docs, base) {
  const requests = (rec.events || []).filter((e) => e?.payload?.hook_event_name === 'PermissionRequest');
  const out = [];
  for (const [sid, doc] of docs) {
    const w = doc.waiting;
    if (!w) continue;
    // the request that opened at this time in the recording (the frame's `since` was moved to now by `rebase`)
    const at = w.since - base, mine = requests.find((e) => Math.abs(e.t - at) < 1000);
    out.push({ id: `${sid}:${w.agent}:${w.since}`, session: sid, agent: w.agent, tool: w.tool, input: mine?.payload.tool_input || {}, since: w.since, state: 'open', demo: true });
  }
  return out;
}
function playerSource(rec) {
  let timers = [];
  return {
    replay: true,
    start(on) {
      on.names({}); on.status('replay');
      const play = () => {
        const docs = new Map(), base = Date.now();
        for (const f of rec.frames) timers.push(setTimeout(() => { docs.set(f.id || rec.session.id, rebase(f.doc, base)); on.docs(docs); if (DEMO) on.asks(recordedAsks(rec, docs, base)); }, f.t));
        timers.push(setTimeout(() => { on.docs(new Map()); if (DEMO) on.asks([]); timers.push(setTimeout(play, 3000)); }, (rec.duration || 0) + 5000));
      };
      play();
    },
    async rename() { throw Object.assign(new Error('rename'), { code: 'replay' }); },
    async answer() { throw Object.assign(new Error('answer'), { code: 'replay' }); },
    async detail(id) { return detailFromDoc(id, city.allDocs.get(id)); },  // a recording has only its documents
    async step() { return null; },
    stop() { timers.forEach(clearTimeout); timers = []; },
  };
}
let playing = null; // the recording's title while one plays
function showRecNote() {
  if (playing) $('recNote').textContent = 'Playing ' + (prefs.safe ? 'a recording' : playing) + ' on a loop';
  else $('recNote').innerHTML = 'Play a file from <code>skyborne record</code> in place of live data';
}
function playRecording(text) {
  let rec = null;
  try { rec = JSON.parse(text); } catch (e) {}
  if (!rec || rec.format !== 'skyborne-recording' || rec.version !== 1 || !Array.isArray(rec.frames) || !rec.frames.length || !rec.session) {
    toast('That file is not a Skyborne recording.'); return false;
  }
  useSource(playerSource(rec));
  playing = rec.session.title || 'a recording'; $('btnBackLive').hidden = false; showRecNote();
  toast('Playing the recording'); return true;
}
function backToLive() {
  if (DEMO) { useSource(playerSource(DEMO.rec)); $('btnBackLive').hidden = true; return; }  // the static site has no server to go back to
  connect();
  playing = null; $('btnBackLive').hidden = true; showRecNote();
}
$('btnPlayRec').addEventListener('click', () => $('inRec').click());
$('inRec').addEventListener('change', async () => { const f = $('inRec').files?.[0]; $('inRec').value = ''; if (f) playRecording(await f.text()); });
$('btnBackLive').addEventListener('click', backToLive);
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); toast('The graphics card reset. Rebuilding the city…'); });
renderer.domElement.addEventListener('webglcontextrestored', () => { resize(); });

applyTilt();
setConsole(prefs.console);
setSafe(prefs.safe); $('toast').classList.remove('show');
setTime(prefs.time);
$('btnSafe').setAttribute('aria-pressed', String(prefs.safe));
resize();
setInterval(() => { if (city.allDocs.size || prefs.samples) showDocs(); }, 5000);  // sessions age from live to past
setInterval(() => { if (askUI.size && prefs.console) tickAsks(); }, 1000);
ensureLoop(1); buildSkyTraffic();
window.__skyborne = { composer, mayorName, customLeadName, city, director, transit, selectDistrict, selectBot, overview, renderer, scene, camera, renderTokTip, playRecording, backToLive, audioState: () => actx && actx.state,
  // for the smoke tests: the pure helpers, and the console's own drawing
  isLive, isBusy, visibleDocs, layoutTimeline, fmtDur, detail, openDetail, closeDetail, showDocs, renderUI, drawLog, drawSteps, logRows: () => logRows };
requestAnimationFrame(frame);
if (DEMO) {
  // the static site: its recording plays on a loop beside the sample districts, and nothing connects to a server
  setSamples(true);
  useSource(playerSource(DEMO.rec));
  playing = DEMO.rec.session.title || 'a recording'; showRecNote();
} else connect();
// ?play=<a file on this server>: play a recording at once (a file from `skyborne record`)
const playUrl = new URLSearchParams(location.search).get('play');
if (playUrl && !DEMO) {
  try {
    const u = new URL(playUrl, location.href);
    if (u.origin === location.origin) fetch(u).then((r) => r.text()).then(playRecording).catch(() => toast('Could not load that recording.'));
  } catch (e) {}
}
