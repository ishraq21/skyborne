// Smoke test: open the local preview (fake city, bundled assets) in a headless browser, let the
// fake city run through one full story loop (~45 s), then check the features that must keep
// working: the city, the console tabs, the Sessions filters, the Tokens popover, the "Needs you" cards, safe-to-film, reel
// mode, sample districts, renaming, sound, time of day, the bundled fonts, playing a recording and a
// full 60-district city, and the saved settings; and the console: the four questions answered
// within 5 s (15 s on CI), live and past sessions (6 live + 20 past), the inbox's order and clocks, desktop alerts, the top
// numbers, a session's detail (timeline, steps, conversation, files, approvals, tokens), a bot's view, the
// log's kinds and durations, the keys, Safe to film in every new view, and the console's speed with a
// 2,500-step session; and, on a page of its own, the first load (the 3D area never goes dark; no infinite or NaN pixels
// in the drawn scene; SKYBORNE_GPU=1 draws with this machine's graphics card, which is what can show such a fault).
// Fails on any page error, caught frame error, or any request that leaves 127.0.0.1.
// Saves screenshots to dist/smoke.png, smoke-asks.png, smoke-detail.png, smoke-reel.png and smoke-60.png,
// and the sign textures to dist/smoke-flag.png and dist/smoke-blimp.png.
// Needs once:  npm ci && npx playwright install chromium
// Run:         node build.js && node tests/smoke.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('../dev/serve');
const dist = (f) => path.resolve(__dirname, '../dist', f);

(async () => {
  const server = await start(0);
  const base = `http://127.0.0.1:${server.address().port}/`;
  // SKYBORNE_GPU=1: draw with this machine's graphics card instead of software, which shows what software hides
  // (a GPU-only black frame, below). Software drawing is the default, and the only choice on CI.
  const gpuArgs = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args: process.env.SKYBORNE_GPU === '1' ? gpuArgs : ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  // Skyborne is local only: any request off this machine fails the test (and is never sent)
  const offMachine = [];
  await context.route((url) => url.hostname !== '127.0.0.1', (route) => { offMachine.push(route.request().url()); route.abort(); });
  const page = await context.newPage();
  const fontResponses = [];
  page.on('response', (r) => { if (r.url().endsWith('.woff2')) fontResponses.push([r.url(), r.status()]); });
  // settings saved before the Skyborne rename live under 'cyber.': one must be copied over, and a
  // setting already saved under the new prefix must win over its old twin
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cyber.mayor', JSON.stringify('Ada Lovelace'));
    localStorage.setItem('cyber.labels', 'false'); localStorage.setItem('skyborne.labels', 'true');
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /Skyborne frame error|THREE\.WebGLProgram|Shader Error/.test(m.text())) errors.push(m.text()); }); // frame errors are caught and only logged; a shader that fails to build is only logged too
  // First load, no mouse or key, on a page of its own (so the four questions below still count from opening the main
  // page): the city is drawn and stays drawn. Once, the light beam's shader made a NaN pixel (pow of a negative
  // number), which the bloom spread over the whole frame: black for seconds, on real graphics cards only. So the 3D
  // area is never dark for three samples in a row once the boot screen has faded, and no pixel of the scene drawn
  // the way the page draws it (half-float, 4x multisampled) is infinite or NaN. Software drawing clamps such
  // values, so only SKYBORNE_GPU=1 can see the bug; the checks themselves run everywhere.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await ctx.route((url) => url.hostname !== '127.0.0.1', (route) => { offMachine.push(route.request().url()); route.abort(); });
    const p1 = await ctx.newPage();
    p1.on('pageerror', (e) => errors.push(e.message));
    await p1.goto(base);
    await p1.waitForFunction(() => window.__skyborne?.city.status === 'live' && window.__skyborne.city.districts.size >= 5, null, { timeout: 60000 }).catch(() => {});
    await p1.waitForFunction(() => getComputedStyle(document.getElementById('boot')).opacity === '0', null, { timeout: 60000 }).catch(() => {});
    if (process.env.SKYBORNE_GPU === '1') {
      const gpu = await p1.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
      if (/swiftshader|llvmpipe|software/i.test(gpu)) errors.push('SKYBORNE_GPU=1 but the page is drawn in software: ' + gpu);
    }
    const lumaOf = async () => {
      const png = await p1.screenshot({ clip: { x: 0, y: 100, width: 380, height: 500 } });
      return p1.evaluate(async (b64) => {
        const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return t / (d.length / 4);
      }, png.toString('base64'));
    };
    const lumas = []; for (let i = 0; i < (process.env.SKYBORNE_GPU === '1' ? 12 : 4); i++) { lumas.push(Math.round(await lumaOf())); await p1.waitForTimeout(250); }
    // three dark samples in a row (the real fault lasts seconds); a single empty frame in a software-drawn screenshot is a known harmless artifact
    if (lumas.some((l, i) => i >= 2 && lumas.slice(i - 2, i + 1).every((x) => x < 60))) errors.push('The 3D area went dark on first load (mean brightness per sample): ' + lumas.join(' '));
    for (let i = 0; i < 3; i++) {
      const r = await p1.evaluate(() => {
        const o = window.__skyborne, R = o.renderer, rt = o.composer.renderTarget1.clone();
        rt.samples = 4; rt.setSize(o.composer.renderTarget1.width, o.composer.renderTarget1.height);
        R.setRenderTarget(rt); R.render(o.scene, o.camera);
        const w = rt.width, h = rt.height, px = new Uint16Array(w * h * 4); R.readRenderTargetPixels(rt, 0, 0, w, h, px); R.setRenderTarget(null); rt.dispose();
        let bad = 0, lit = 0;
        for (let k = 0; k < w * h; k++) {
          if (px[k * 4] | px[k * 4 + 1] | px[k * 4 + 2]) lit++;
          for (let j = 0; j < 3; j++) if (((px[k * 4 + j] >> 10) & 31) === 31) { bad++; break; }  // exponent bits all set: infinity or NaN
        }
        return { bad, lit };
      });
      if (!r.lit) { errors.push('The scene read-back was all zeros, so the infinite/NaN check saw nothing'); break; }
      if (r.bad) { errors.push(`${r.bad} infinite or NaN pixels in the drawn scene`); break; }
      await p1.waitForTimeout(400);
    }
    await ctx.close();
  }
  await page.goto(base);
  const click = (sel) => page.evaluate((sel) => { document.querySelector(sel).click(); }, sel);
  const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur());
  const SLOW = process.env.CI ? 3 : 1;  // CI machines draw the city in software, beside the console

  // the four questions, each answered within 5 s of the city going live: what needs me (the inbox), what's
  // stuck or slow (near the top of the Sessions list), what's costing the most (Usage → By session), what
  // changed (the newest log line)
  await page.waitForFunction(() => window.__skyborne?.city.status === 'live' && window.__skyborne.city.districts.size >= 5, null, { timeout: 60000 }).catch(() => {});
  // each timed from what you'd do: open the page (the first two), hover Usage, open Logs (a real mouse click,
  // which the console holds back its redraw for until the pointer is up). The 5 s is the acceptance limit.
  // Headless Chromium draws the city in software everywhere; on CI's small runner that leaves the page so
  // busy that just reaching it (the click, each check) can take seconds, so CI gets SLOW times that
  const QUESTION_MS = 5000 * SLOW;
  const within = (t0, fn) => page.waitForFunction(fn, null, { timeout: QUESTION_MS, polling: 50 }).then(() => Date.now() - t0).catch(() => null);
  const questions = {}, tReady = Date.now();
  questions.needsMe = await within(tReady, () => document.querySelector('#asks .ask [data-ans="allow"]:not([hidden])'));
  questions.stuck = await within(tReady, () => [...document.querySelectorAll('#sessList .dcard')].slice(0, 4).some((c) => c.querySelector('.slow')));
  let tq = Date.now(); await click('#tokStat');
  questions.cost = await within(tq, () => document.querySelector('#tokTipBody .tt-s'));
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  // where the tab is, found first: page.click's own waits (a busy software-drawn page) aren't the console's time
  const logTab = await page.evaluate(() => { const r = document.querySelector('.tab[data-tab="log"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  tq = Date.now(); await page.mouse.click(logTab.x, logTab.y);
  questions.changed = await within(tq, () => document.querySelector('#logList .lrow'));
  await click('.tab[data-tab="city"]');
  for (const [q, ms] of Object.entries(questions)) if (ms === null || ms > QUESTION_MS) errors.push(`The console took ${ms} ms to answer "${q}"`);

  const saved = await page.evaluate(() => ({ mayor: localStorage.getItem('skyborne.mayor'), labels: localStorage.getItem('skyborne.labels') }));
  if (saved.mayor !== JSON.stringify('Ada Lovelace')) errors.push(`Old 'cyber.mayor' setting not copied over: ${saved.mayor}`);
  if (saved.labels !== 'true') errors.push(`An old 'cyber.' setting overwrote a newer one: labels=${saved.labels}`);
  await page.waitForTimeout(46000);
  const info = await page.evaluate(() => ({
    districts: window.__skyborne ? window.__skyborne.city.districts.size : 0,
    status: window.__skyborne ? window.__skyborne.city.status : 'not booted',
  }));

  // the Sessions tab's filter chips: "Working" narrows the list, "All" brings it back
  const rows = () => page.evaluate(() => document.querySelectorAll('#sessList .dcard').length);
  const all = await rows(); await click('[data-sf="working"]'); await page.waitForTimeout(1500);
  const working = await rows(); await click('[data-sf="all"]'); await page.waitForTimeout(1500);
  const back = await rows();
  if (!(working > 0 && working < all && back === all)) errors.push(`Sessions filters broken: all=${all} working=${working} back=${back}`);

  // the Tokens popover: opens, adds up to the headline, names sessions, and hides names in Safe to film
  const tip = () => page.evaluate(() => {
    const o = window.__skyborne, ds = [...o.city.districts.values()].filter((d) => !d.leaving);
    o.renderTokTip(); // draw it now, so the rows and the totals come from the same moment
    const text = document.getElementById('tokTip').innerText;
    return {
      open: !document.getElementById('tokTip').hidden, text,
      rows: [...document.querySelectorAll('#tokTipBody .tt-row')].map((r) => Number(r.dataset.n)).reduce((a, b) => a + b, 0),
      total: ds.reduce((a, d) => a + d.tokens, 0), names: ds.map((d) => d.displayName()),
    };
  });
  await click('#tokStat'); await page.waitForTimeout(600);
  const t1 = await tip();
  if (!t1.open || !t1.text.includes('Cache re-read') || !t1.names.some((n) => t1.text.includes(n))) errors.push('Tokens popover missing parts: ' + t1.text.slice(0, 120));
  if (t1.rows !== t1.total) errors.push(`Tokens popover rows add up to ${t1.rows}, headline is ${t1.total}`);
  const bars = await page.evaluate(() => document.querySelectorAll('.ctxbar').length);
  if (!bars) errors.push('No context bar on the Sessions rows');

  // Safe to film: the Tokens popover and the Sessions list drop every real session name
  const realNames = await page.evaluate(() => [...document.querySelectorAll('#sessList .dname')].map((e) => e.textContent));
  await blur(); await page.keyboard.press('s'); await page.waitForTimeout(1500);
  const t2 = await tip();
  if (!t2.open || t2.names.some((n) => t2.text.includes(n))) errors.push('Safe to film still shows names in the Tokens popover');
  const safeList = await page.evaluate(() => document.getElementById('sessList').innerText);
  const leaked = realNames.filter((n) => safeList.includes(n));
  if (!realNames.length || leaked.length) errors.push(`Safe to film still shows names in the Sessions list: ${leaked.join(', ') || 'no names to check'}`);
  await page.keyboard.press('s'); await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: dist('smoke.png') });

  // the console tabs: each shows its own pane and only that one
  const panes = { city: 'paneCity', log: 'paneLog', set: 'paneSet' };
  for (const [tab, pane] of Object.entries(panes)) {
    await click(`.tab[data-tab="${tab}"]`); await page.waitForTimeout(400);
    const shown = await page.evaluate((ids) => ids.filter((id) => !document.getElementById(id).hidden), Object.values(panes));
    if (shown.length !== 1 || shown[0] !== pane) errors.push(`Tab ${tab} shows ${shown.join(', ') || 'no pane'}`);
  }
  // the Settings tab shows the Mayor's name copied over from the old setting
  const mayorShown = await page.evaluate(() => document.getElementById('inMayor').value);
  if (mayorShown !== 'Ada Lovelace') errors.push(`Settings shows the Mayor as "${mayorShown}"`);
  // City Hall carries that name; without one it reads just "Mayor" (nobody's name is built in)
  const hallSub = await page.evaluate(() => document.getElementById('hallSub').textContent);
  if (hallSub !== 'Mayor Ada Lovelace') errors.push(`City Hall reads "${hallSub}"`);
  const plainHall = await page.evaluate(() => { const i = document.getElementById('inMayor'), was = i.value; i.value = ''; i.dispatchEvent(new Event('input'));
    window.__skyborne.renderUI(); const t = document.getElementById('hallSub').textContent; i.value = was; i.dispatchEvent(new Event('input')); return t; });
  if (plainHall !== 'Mayor') errors.push(`City Hall without a name reads "${plainHall}"`);
  // one clean-up for the name, typed or loaded: 'Mayor' alone (what older pages saved for none) is none
  const names = await page.evaluate(() => { const m = window.__skyborne.mayorName; return [m('Mayor'), m('  Ada  '), m(null), m('x'.repeat(30)).length]; });
  if (JSON.stringify(names) !== JSON.stringify(['', 'Ada', '', 24])) errors.push('Mayor names: ' + JSON.stringify(names));
  // the lead's automatic name, new or old (older recordings say 'Claude Bot'), is never taken for a nickname
  const leadNames = await page.evaluate(() => { const c = window.__skyborne.customLeadName; return [c('Skybot', 'atlas-api'), c('Claude Bot', 'atlas-api'), c('Captain', 'atlas-api')]; });
  if (JSON.stringify(leadNames) !== JSON.stringify(['', '', 'Captain'])) errors.push('Lead names: ' + JSON.stringify(leadNames));

  // sample districts: four appear when switched on and leave when switched off
  const samples = () => page.evaluate(() => [...window.__skyborne.city.districts.values()].filter((d) => d.isSample && !d.leaving).map((d) => d.id).sort());
  await click('#swSamples'); await page.waitForTimeout(2500);
  const on = await samples();
  if (on.join() !== 'sample-1,sample-2,sample-3,sample-4') errors.push(`Sample districts on: ${on.join() || 'none'}`);
  await click('#swSamples'); await page.waitForTimeout(3500);
  const off = await samples();
  if (off.length) errors.push(`Sample districts still there after switching off: ${off.join()}`);
  await click('.tab[data-tab="city"]'); await page.waitForTimeout(600);

  // renaming a district: the pencil opens a field, Enter saves to names/<id>, an empty name goes back
  const rename = async (value) => {
    await click('.dren[data-ren="p-atlas"]'); await page.waitForTimeout(600);
    await page.fill('#renameIn', value); await page.press('#renameIn', 'Enter'); await page.waitForTimeout(800);
    return page.evaluate(() => ({
      last: window.__writes[window.__writes.length - 1] || [],
      names: [...document.querySelectorAll('#sessList .dname')].map((e) => e.textContent),
    }));
  };
  const r1 = await rename('Rate Limits');
  if (r1.last[0] !== 'names/p-atlas' || r1.last[1]?.name !== 'Rate Limits' || !r1.names.includes('Rate Limits')) errors.push(`Rename did not save: ${JSON.stringify(r1)}`);
  const r2 = await rename('');
  if (r2.last[0] !== 'names/p-atlas' || r2.last[1] !== 'deleted' || !r2.names.includes('atlas-api')) errors.push(`Clearing a rename did not go back: ${JSON.stringify(r2)}`);

  // "Needs you": a card per permission request with Approve and Deny; a question only the terminal can
  // answer has no buttons; Safe to film hides the command behind Show and the buttons still work; A and D
  // answer the card in focus, and focus stays put when the list changes
  const askCards = () => page.evaluate(() => [...document.querySelectorAll('#asks .ask')].map((el) => ({
    id: el.dataset.ask, text: el.innerText, buttons: [...el.querySelectorAll('[data-ans]')].filter((b) => !b.hidden).length,
    detail: el.querySelector('.ask-detail').hidden ? null : el.querySelector('.ask-detail').textContent })));
  const lastWrite = () => page.evaluate(() => window.__writes[window.__writes.length - 1] || []);
  const cards1 = await askCards();
  // oldest first, each with its clock: how long it has waited and, while Skyborne holds it, its time limit
  const clock = () => page.evaluate(() => [...document.querySelectorAll('#asks .ask')].map((el) => el.querySelector('.ask-time').textContent));
  // the clock ticks once a second; a busy CI page can run that timer late, so wait for the change itself
  const clock1 = await clock();
  await page.waitForFunction((was) => document.querySelector('#asks .ask .ask-time')?.textContent !== was, clock1[0], { timeout: 1500 * SLOW }).catch(() => {});
  const clock2 = await clock();
  if (cards1.map((c) => c.id).join() !== 'ask-1,ask-2') errors.push(`Cards not oldest first: ${cards1.map((c) => c.id)}`);
  if (!/^Waiting .* · Times out in \d+:\d\d$/.test(clock1[0] || '') || /Times out/.test(clock1[1] || '') || clock1[0] === clock2[0]) errors.push(`Card clocks: ${JSON.stringify([clock1, clock2])}`);
  if (!(await page.textContent('#asksHead')).startsWith('Needs you · 2')) errors.push('Inbox heading: ' + await page.textContent('#asksHead'));
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));  // close the Tokens popover
  await page.waitForTimeout(400);
  await page.screenshot({ path: dist('smoke-asks.png') });
  const bashCard = cards1.find((c) => c.id === 'ask-1'), questionCard = cards1.find((c) => c.id === 'ask-2');
  if (!bashCard || bashCard.buttons !== 2 || bashCard.detail !== 'rm -rf dist && npm run build' || !bashCard.text.includes('pixel-forge')) errors.push(`Approval card wrong: ${JSON.stringify(bashCard)}`);
  if (!questionCard || questionCard.buttons !== 0 || !questionCard.text.includes('Answer in the terminal')) errors.push(`A question card should have no buttons: ${JSON.stringify(questionCard)}`);
  await blur(); await page.keyboard.press('s'); await page.waitForTimeout(800);
  const safeCard = (await askCards()).find((c) => c.id === 'ask-1');
  if (!safeCard || safeCard.detail !== null || /rm -rf|pixel-forge/.test(safeCard.text) || !safeCard.text.includes('Bash command')) errors.push(`Safe to film shows the request: ${JSON.stringify(safeCard)}`);
  await click('[data-ask="ask-1"] [data-show]'); await page.waitForTimeout(400);
  if ((await askCards()).find((c) => c.id === 'ask-1')?.detail !== 'rm -rf dist && npm run build') errors.push('Show did not reveal the command in Safe to film');
  const mcpAsk = await page.evaluate(() => window.__fakeAsk({ query: 'select 1' }, 'mcp__acme-db__query')); await page.waitForTimeout(1300);
  const mcpCard = (await askCards()).find((c) => c.id === mcpAsk);
  if (!mcpCard || mcpCard.text.includes('acme') || !mcpCard.text.includes('Tool · Input')) errors.push(`Safe to film shows an MCP tool's name: ${JSON.stringify(mcpCard)}`);
  await click(`[data-ask="${mcpAsk}"] [data-ans="deny"]`); await page.waitForTimeout(600);
  // a card shown with Show is hidden again when Safe to film is turned off and back on
  await blur(); await page.keyboard.press('s'); await page.waitForTimeout(300); await page.keyboard.press('s'); await page.waitForTimeout(500);
  if ((await askCards()).find((c) => c.id === 'ask-1')?.detail !== null) errors.push('Turning Safe to film back on left a card revealed');
  const editAsk = await page.evaluate(() => window.__fakeAsk()); await page.waitForTimeout(1300);
  await click(`[data-ask="${editAsk}"] [data-ans="allow"]`); await page.waitForTimeout(600);
  const w1 = await lastWrite();
  if (w1[0] !== 'answers/' + editAsk || w1[1] !== 'allow') errors.push(`Approve in Safe to film did not answer: ${JSON.stringify(w1)}`);
  await blur(); await page.keyboard.press('s'); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-ask="ask-1"]').focus());
  const npmAsk = await page.evaluate(() => window.__fakeAsk({ command: 'npm publish' }, 'Bash')); await page.waitForTimeout(1300);
  const focused = await page.evaluate(() => document.activeElement?.dataset?.ask);
  if (focused !== 'ask-1') errors.push(`A new card took the focus away: ${focused}`);
  await page.keyboard.press('a'); await page.waitForTimeout(600);
  const w2 = await lastWrite();
  if (w2[0] !== 'answers/ask-1' || w2[1] !== 'allow') errors.push(`A did not approve the card in focus: ${JSON.stringify(w2)}`);
  // an approved lead carries on, as in the real product: its district stops waiting on you
  await page.waitForFunction(() => { const d = window.__skyborne.city.allDocs.get('p-forge'); return d && !d.waiting; }, null, { timeout: 15000 })
    .catch(() => errors.push('pixel-forge still waits on you after its request was approved'));
  await page.evaluate((id) => document.querySelector(`[data-ask="${id}"]`).focus(), npmAsk);
  await page.keyboard.press('d'); await page.waitForTimeout(800);
  const w3 = await lastWrite();
  if (w3[0] !== 'answers/' + npmAsk || w3[1] !== 'deny') errors.push(`D did not deny the card in focus: ${JSON.stringify(w3)}`);
  // waits for `test` to hold and returns what it returned (null on a timeout); slow on CI
  const waitAsk = (test, id) => page.waitForFunction(test, id, { timeout: 15000, polling: 100 }).then((h) => h.jsonValue()).catch(() => null);
  await waitAsk(() => [...document.querySelectorAll('#asks .ask')].map((el) => el.dataset.ask).join() === 'ask-2');
  const left = (await askCards()).map((c) => c.id).join();
  if (left !== 'ask-2') errors.push(`Answered cards should leave: ${left}`);
  // a click the terminal beat: refused at once, or found out after it was sent. Either way the card says
  // so (never "approved"), then closes
  const tooLate = async (late) => {
    const id = await page.evaluate((late) => window.__fakeAsk({ command: 'make deploy' }, 'Bash', late), late);
    await waitAsk((id) => !!document.querySelector(`[data-ask="${id}"] [data-ans="allow"]`), id);
    // click and read in one go: the "Sent" note is drawn during the click, and the fake's reply replaces it soon after
    const clicked = await page.evaluate((id) => {
      const el = document.querySelector(`[data-ask="${id}"]`); el.querySelector('[data-ans="allow"]').click(); return el.innerText;
    }, id);
    const sentText = late === 'after' ? clicked : '';
    // read the card in the same step that sees the note: it closes 3 s later, and CI can take that long to ask again
    const card = await waitAsk((id) => {
      const el = document.querySelector(`[data-ask="${id}"]`);
      return el?.innerText.includes('Already answered in the terminal') && { id, text: el.innerText, buttons: [...el.querySelectorAll('[data-ans]')].filter((b) => !b.hidden).length };
    }, id);
    await waitAsk((id) => !document.querySelector(`[data-ask="${id}"]`), id);
    return { sentText, card, after: (await askCards()).some((c) => c.id === id) };
  };
  for (const late of ['now', 'after']) {
    const r = await tooLate(late);
    if (!r.card || !r.card.text.includes('Already answered in the terminal') || r.card.buttons) errors.push(`A click the terminal beat (${late}) isn't shown as too late: ${JSON.stringify(r.card)}`);
    if (late === 'after' && !r.sentText.includes('Waiting for Claude Code')) errors.push(`A sent answer isn't shown as waiting: ${r.sentText}`);
    if (r.after) errors.push(`The too-late card (${late}) didn't close`);
  }
  await blur();

  // ---------------- the console ----------------
  // the pure helpers: live or past, and the timeline's layout
  const unit = await page.evaluate(() => {
    const o = window.__skyborne, now = 10_000_000, W = 30 * 60_000, bad = [];
    const ok = (name, v) => { if (!v) bad.push(name); };
    ok('live: 29 min', o.isLive({ updatedAt: now - 29 * 60_000 }, now, W));
    ok('past: 31 min', !o.isLive({ updatedAt: now - 31 * 60_000 }, now, W));
    ok('past: ended', !o.isLive({ updatedAt: now, ended: { at: now } }, now, W));
    const all = [{ id: 'a', doc: { updatedAt: now } }, { id: 'b', doc: { updatedAt: now - 3600e3 } }, { id: 'c', doc: { updatedAt: now, ended: { at: now } } }, { id: 'd', doc: { updatedAt: now - 3600e3 } }];
    const v = (x) => o.visibleDocs(all, { now, windowMs: W, showPast: false, needs: new Set(), pinned: null, ...x });
    const ids = (r) => r.shown.map((e) => e.id).join();
    ok('default: live only', ids(v({})) === 'a' && v({}).hidden === 3);
    ok('needs you: always shown', ids(v({ needs: new Set(['b']) })) === 'a,b');
    ok('open detail: always shown', ids(v({ pinned: 'd' })) === 'a,d');
    ok('show past: everything', v({ showPast: true }).shown.length === 4 && v({ showPast: true }).hidden === 0);
    const A = [{ id: 'main' }, { id: 'h1' }], L = (steps, w = 400, n = 0) => o.layoutTimeline(steps, A, w, n);
    let l = L([{ agent: 'main', start: 0, end: 1000 }, { agent: 'main', start: 1000, end: 3000 }]);
    ok('timeline: x in proportion to time', Math.abs(l.bars[0].w - 400 / 3) < 1 && Math.abs(l.bars[1].x - 400 / 3) < 1 && !l.gaps.length);
    l = L([{ agent: 'main', start: 0, end: 1000 }, { agent: 'main', start: 3_600_000, end: 3_601_000 }]);
    ok('timeline: an idle hour folds to a break', l.gaps.length === 1 && l.gaps[0].ms === 3_599_000 && Math.abs(l.bars[0].w - 192) < 1 && Math.abs(l.bars[1].x - 208) < 1);
    l = L([{ agent: 'h1', start: 0, end: 100 }, { agent: 'x9', start: 50, end: 60 }]);
    ok('timeline: helpers on rows of their own', l.rows.join() === 'main,h1,x9' && l.bars[0].row === 1 && l.bars[1].row === 2);
    l = L([{ agent: 'main', start: 0, end: null }, { agent: 'main', start: 0, end: 500 }], 400, 1000);
    ok('timeline: a running step reaches now', Math.abs(l.bars[0].w - 400) < 1 && Math.abs(l.bars[1].w - 200) < 1);
    l = L([{ agent: 'main', start: 0, end: 100_000 }, { agent: 'main', start: 50_000, end: 50_000 }]);
    ok('timeline: a bar is at least 2 px', l.bars[1].w >= 2);
    ok('durations', o.fmtDur(450) === '450 ms' && o.fmtDur(1500) === '1.5 s' && o.fmtDur(125_000) === '2m 05s' && o.fmtDur(3_900_000) === '1h 5m');
    return bad;
  });
  for (const name of unit) errors.push('Unit check failed: ' + name);

  // a bot mid-step (a long command) stays awake and live up to 3 h without news; idle or ended, the usual rules
  const busy = await page.evaluate(() => {
    const o = window.__skyborne, now = Date.now(), win = 30 * 60e3;
    const d = (quietMin, status, ended) => ({ updatedAt: now - quietMin * 60e3, agents: [{ id: 'main', status }], ...(ended ? { ended: { at: now } } : {}) });
    return { working40: o.isBusy(d(40, 'working'), now) && o.isLive(d(40, 'working'), now, win),
      working4h: o.isBusy(d(240, 'working'), now) || o.isLive(d(240, 'working'), now, win),
      idle40: o.isBusy(d(40, 'idle'), now) || o.isLive(d(40, 'idle'), now, win),
      ended: o.isLive(d(1, 'working', true), now, win),
      slowDistrict: o.city.districts.get('p-slow')?.status(), slowAsleep: o.city.districts.get('p-slow')?.asleep,
      moved: o.city.districts.has('p-moved'), slowCard: !!document.querySelector('#sessList [data-d="p-slow"] .slow') };
  });
  if (!busy.working40 || busy.working4h || busy.idle40 || busy.ended || busy.slowDistrict !== 'working' || busy.slowAsleep || busy.moved || !busy.slowCard) errors.push('Busy bots: ' + JSON.stringify(busy));

  // the top numbers: cost (Claude Code's estimate at API prices) without a 5-hour limit, the limit when it's reported
  const tiles = () => page.evaluate(() => ({ use: document.getElementById('sUse').textContent, label: document.getElementById('sUseLabel').textContent,
    ctx: document.getElementById('sCtx').textContent, ctxTip: document.getElementById('ctxStat').title, need: document.getElementById('sNeed').textContent }));
  const tile1 = await tiles();
  if (tile1.label !== 'API est. today' || !/^\$\d/.test(tile1.use) || !/^\d+%$/.test(tile1.ctx) || !tile1.ctxTip.startsWith('Fullest: ') || tile1.need !== '1') errors.push('Top numbers: ' + JSON.stringify(tile1));
  await page.evaluate(() => { window.__fakeLimits = { five_hour: { used_percentage: 41.4, resets_at: Math.floor(Date.now() / 1000) + 3600 } }; });
  await page.waitForFunction(() => document.getElementById('sUseLabel').textContent === '5-hour limit', null, { timeout: 8000 }).catch(() => {});
  const tile2 = await tiles();
  await page.evaluate(() => { window.__skyborne.renderTokTip(); });
  const usageTip = await page.evaluate(() => document.getElementById('tokTipBody').innerText);
  if (tile2.use !== '41%' || !usageTip.includes('Resets')) errors.push('5-hour limit: ' + JSON.stringify(tile2) + ' ' + usageTip.slice(0, 80));
  // a reading from a 5-hour window that has since reset isn't shown as current
  await page.evaluate(() => { window.__fakeLimits = { five_hour: { used_percentage: 92, resets_at: Math.floor(Date.now() / 1000) - 60 } }; });
  await page.waitForFunction(() => document.getElementById('sUseLabel').textContent === 'API est. today', null, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { window.__skyborne.renderTokTip(); });
  const resetTip = await page.evaluate(() => document.getElementById('tokTipBody').innerText);
  const tileReset = await tiles();
  if (tileReset.label !== 'API est. today' || !resetTip.includes('has since reset')) errors.push('A reset 5-hour reading: ' + JSON.stringify(tileReset) + ' ' + resetTip.slice(0, 80));
  // the cost is an estimate at API list prices, and says it isn't a subscriber's bill
  // (the plan note once in each tip: at the top with the cost, else at the bottom under the 5-hour limit)
  const once = (t) => t.split("isn't what you pay").length === 2;
  if (!resetTip.includes('at API list prices') || !once(resetTip) || !once(usageTip)) errors.push('Cost note: ' + resetTip.slice(0, 200) + ' | ' + usageTip.slice(-200));
  await page.evaluate(() => { delete window.__fakeLimits; });

  // a session's detail: a click on its card; all five sections, from the session's record
  await click('.tab[data-tab="city"]'); await page.waitForTimeout(300);
  await click('#sessList [data-d="p-atlas"]');
  await page.waitForFunction(() => window.__skyborne.detail.data && document.querySelectorAll('#dtSteps .srow').length >= 3, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const det = await page.evaluate(() => ({
    open: !document.getElementById('sessDetail').hidden, listHidden: document.getElementById('sessMain').hidden,
    rows: document.querySelectorAll('#dtRows > div').length, canvas: document.getElementById('dtCanvas').width,
    steps: document.querySelectorAll('#dtSteps .srow').length, talk: document.querySelectorAll('#dtTalk .talk').length,
    files: document.querySelectorAll('#dtFiles .frow').length, asks: document.querySelectorAll('#dtAsks .arow').length,
    upTo: document.getElementById('dtAsks').innerText.includes('Up to 1m 05s') && document.getElementById('dtAsks').innerText.includes('Skyborne stopped holding it · Up to 12m 10s'), tok: document.querySelectorAll('#dtTok .frow').length,
    more: !!document.querySelector('#dtTalk [data-more]'), cubes: document.getElementById('console').innerText.includes('Cubes') }));
  if (!det.open || !det.listHidden || det.rows < 3 || !det.canvas || det.steps < 3 || det.talk !== 2 || det.files !== 2 || det.asks !== 3 || !det.upTo || det.tok < 3 || !det.more || det.cubes) errors.push('Session detail: ' + JSON.stringify(det));
  await click('#dtTalk [data-more]'); await page.waitForTimeout(300);
  if (!await page.evaluate(() => document.querySelector('#dtTalk [data-more]').textContent === 'Show less' && !document.querySelector('#dtTalk .tx.fold'))) errors.push('Show more did not unfold the reply');
  // a step opens in full: input, output and error; an output cut when stored says so
  await click('[data-step="p-atlas-b1"]'); await page.waitForTimeout(600);
  const stepText = await page.evaluate(() => document.getElementById('dtStep').innerText);
  if (!/Input[\s\S]*echo SECRET-CMD-XYZ[\s\S]*Output[\s\S]*SECRET-OUT-XYZ[\s\S]*Error[\s\S]*SECRET-ERR-XYZ/.test(stepText)) errors.push('Step panel: ' + stepText.slice(0, 200));
  await page.evaluate(() => document.querySelectorAll('#dtSteps .srow')[3].click()); await page.waitForTimeout(600);
  if (!(await page.evaluate(() => document.getElementById('dtStep').innerText)).includes('Cut to 20 KB when stored')) errors.push('A cut output does not say so');
  // a step opened before its result is stored gets it with a later detail, without a click
  await page.evaluate(() => { window.__fakeStepRunning = true; window.__skyborne.detail.stepCache.clear(); });
  await click('[data-step="p-atlas-b1"]'); await page.waitForTimeout(600);
  const early = await page.evaluate(() => document.getElementById('dtStep').innerText);
  await page.evaluate(() => { delete window.__fakeStepRunning; });
  await page.waitForFunction(() => document.getElementById('dtStep').innerText.includes('SECRET-OUT-XYZ'), null, { timeout: 10000 }).catch(() => {});
  const late = await page.evaluate(() => document.getElementById('dtStep').innerText);
  if (!early.includes('echo SECRET-CMD-XYZ') || early.includes('Output') || !late.includes('SECRET-OUT-XYZ')) errors.push('A step finishing after it opened: ' + JSON.stringify({ early: early.slice(0, 120), late: late.slice(0, 120) }));
  await page.screenshot({ path: dist('smoke-detail.png') });

  // Safe to film: nothing in any new view names a prompt, a reply, a command, a path, a file or an MCP tool
  const leaks = () => page.evaluate(() => {
    const bad = /XYZ|secretco/, out = [], root = document.getElementById('console');
    const m = root.innerText.match(/.{0,24}(XYZ|secretco).{0,8}/); if (m) out.push('text: ' + m[0]);
    for (const el of root.querySelectorAll('*')) for (const a of el.attributes) if (bad.test(a.value)) out.push(`${el.tagName.toLowerCase()}[${a.name}]`);
    return out;
  });
  const hoverBar = () => page.evaluate(() => {  // hover the timeline's first bar: its tooltip shows
    const o = window.__skyborne, cv = document.getElementById('dtCanvas'), r = cv.getBoundingClientRect(), b = o.detail.lay.bars[0];
    cv.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + b.x + 1, clientY: r.top + b.row * 16 + 8 }));
    return !document.getElementById('dtTip').hidden;
  });
  await click('[data-step="p-atlas-b1"]'); await page.waitForTimeout(500);
  const plainLeaks = await leaks();
  await blur(); await page.keyboard.press('s'); await page.waitForTimeout(800);
  const tipShown = await hoverBar();
  const safeDetail = await leaks();
  await click('.tab[data-tab="log"]'); await page.waitForTimeout(800);
  const safeLog = await leaks();
  await click('.tab[data-tab="city"]'); await page.waitForTimeout(500);
  if (!plainLeaks.length) errors.push('The detail shows none of its own text (the Safe to film check has nothing to check)');
  if (!tipShown || safeDetail.length || safeLog.length) errors.push('Safe to film leaks: ' + JSON.stringify({ tipShown, safeDetail, safeLog }));
  await page.keyboard.press('s'); await page.waitForTimeout(500);

  // a bot is a filtered detail: a click on it (here, the scout) filters the steps to it and shows its card
  await page.evaluate(() => { const o = window.__skyborne; o.selectBot(o.city.districts.get('p-atlas').robots.get('a1')); });
  await page.waitForTimeout(800);
  const botView = await page.evaluate(() => ({ bot: window.__skyborne.detail.bot, card: document.querySelector('#dtHead .bview h3')?.textContent,
    pressed: document.querySelector('#dtHead [data-agent="a1"]')?.getAttribute('aria-pressed'), who: [...document.querySelectorAll('#dtSteps .srow .w')].map((e) => e.textContent) }));
  if (botView.bot !== 'a1' || !/^Explore · /.test(botView.card || '') || botView.pressed !== 'true' || botView.who.some((w) => !w.startsWith('Explore · '))) errors.push('Bot view: ' + JSON.stringify(botView));
  await click('#dtHead [data-agent=""]'); await page.waitForTimeout(300);

  // keys: Down picks a step, Enter opens it, Esc closes it, Esc again goes back to the list with the card in focus
  await page.evaluate(() => document.getElementById('dtSteps').focus());
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  const k1 = await page.evaluate(() => ({ sel: window.__skyborne.detail.sel, open: window.__skyborne.detail.open }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const k2 = await page.evaluate(() => ({ open: window.__skyborne.detail.open, id: window.__skyborne.detail.id }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  const k3 = await page.evaluate(() => ({ id: window.__skyborne.detail.id, focus: document.activeElement?.dataset?.d, list: !document.getElementById('sessMain').hidden }));
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
  const k4 = await page.evaluate(() => document.activeElement?.dataset?.d);
  if (!k1.sel || k1.open !== k1.sel || k2.open || k2.id !== 'p-atlas' || k3.id || k3.focus !== 'p-atlas' || !k3.list || !k4 || k4 === 'p-atlas') errors.push('Keys in the console: ' + JSON.stringify({ k1, k2, k3, k4 }));

  // a session that goes takes its open detail with it
  await click('#sessList [data-d="p-port"]'); await page.waitForTimeout(800);
  await page.evaluate(() => window.__fakeGone('p-port'));
  await page.waitForFunction(() => !window.__skyborne.detail.id, null, { timeout: 8000 }).catch(() => {});
  if (await page.evaluate(() => window.__skyborne.detail.id || document.getElementById('sessDetail').hidden === false)) errors.push('The detail of a session that went stayed open');

  // the log: kinds, durations, and a line opens its step in the detail; Esc goes back to the log
  await click('.tab[data-tab="log"]'); await page.waitForTimeout(800);
  const logInfo = await page.evaluate(() => ({ rows: document.querySelectorAll('#logList .lrow').length, durs: [...document.querySelectorAll('#logList .lrow .dur')].filter((e) => e.textContent).length }));
  await click('[data-lk="prompt"]'); await page.waitForTimeout(500);
  const onlyPrompts = await page.evaluate(() => { const r = window.__skyborne.logRows(); return r.length > 0 && r.every(([f]) => f.kind === 'prompt'); });
  await click('[data-lk="tool"]'); await page.waitForTimeout(500);
  const stepLine = await page.evaluate(() => { const r = window.__skyborne.logRows(); const i = r.findIndex(([f]) => f.toolUseId); const el = document.querySelector(`[data-log="${i}"]`); if (!el) return null; el.click(); return r[i][0].toolUseId; });
  // the data lands first and the panel is drawn on the next frame (CI draws about 2 a second): wait for the panel
  // (with the session's data and its body shown too, so a panel left over from an earlier step can't pass)
  await page.waitForFunction((id) => window.__skyborne.detail.open === id && window.__skyborne.detail.data
    && !document.getElementById('dtBody').hidden && !document.getElementById('dtStep').hidden, stepLine, { timeout: 8000 * SLOW }).catch(() => {});
  const fromLog = await page.evaluate(() => ({ open: window.__skyborne.detail.open, tab: document.querySelector('.tab[aria-selected="true"]').dataset.tab, panel: !document.getElementById('dtBody').hidden && !document.getElementById('dtStep').hidden }));
  await page.evaluate(() => document.getElementById('dtSteps').focus());
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.tab[aria-selected="true"]').dataset.tab === 'log', null, { timeout: 3000 * SLOW }).catch(() => {});
  const backTab = await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]').dataset.tab);
  // the checks below start from the log on their own, so a failure above doesn't fail them too
  await click('.tab[data-tab="log"]'); await click('[data-lk="all"]');
  await page.waitForFunction(() => document.querySelector('[data-lk="all"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('#logList .lrow'), null, { timeout: 3000 * SLOW }).catch(() => {});
  // a line picked with the keys stays picked as new data arrives (the fake sends some every 1.5 s)
  await page.evaluate(() => document.getElementById('logList').focus());
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
  const picked = await page.evaluate(() => document.querySelector('#logList .lrow.sel')?.innerText);
  await page.waitForTimeout(3500);
  const stillPicked = await page.evaluate(() => document.querySelector('#logList .lrow.sel')?.innerText);
  if (!picked || stillPicked !== picked) errors.push('The log line picked with the keys was lost: ' + JSON.stringify({ picked, stillPicked }));
  if (!logInfo.rows || !logInfo.durs || !onlyPrompts || !stepLine || fromLog.open !== stepLine || fromLog.tab !== 'city' || !fromLog.panel || backTab !== 'log') errors.push('Logs: ' + JSON.stringify({ logInfo, onlyPrompts, stepLine, fromLog, backTab }));
  // a touch-scroll on the console ends with pointercancel, never pointerup: the console must keep drawing after it
  await page.evaluate(() => { document.getElementById('console').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointercancel')); });
  await page.waitForTimeout(100);
  await click('[data-lk="prompt"]');
  const afterCancel = await page.waitForFunction(() => document.querySelector('[data-lk="prompt"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 3000 * SLOW }).then(() => true).catch(() => false);
  if (!afterCancel) errors.push('The console stopped drawing after a cancelled pointer (a touch-scroll)');
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup')));  // so a failure here doesn't freeze the checks after it
  await page.waitForTimeout(100);
  await click('[data-lk="all"]');
  await click('.tab[data-tab="city"]');

  // desktop alerts (Settings): one per new request while the page isn't in front; generic in Safe to film
  await page.evaluate(() => {
    window.__alerts = [];
    window.Notification = class { constructor(title, o) { window.__alerts.push({ title, ...o }); } close() {} static get permission() { return 'granted'; } static async requestPermission() { return 'granted'; } };
    document.hasFocus = () => false;
  });
  await click('.tab[data-tab="set"]'); await click('#swNotify'); await page.waitForTimeout(400);
  const a1 = await page.evaluate(() => window.__fakeAsk({ command: 'npm run lint' }, 'Bash')); await page.waitForTimeout(900);
  await blur(); await page.keyboard.press('s'); await page.waitForTimeout(300);
  const a2 = await page.evaluate(() => window.__fakeAsk({ query: 'select 1' }, 'mcp__secretco__query')); await page.waitForTimeout(900);
  await page.keyboard.press('s'); await page.waitForTimeout(300);
  const alerts = await page.evaluate(() => { delete document.hasFocus; return window.__alerts; });
  if (alerts.length !== 2 || alerts[0].tag !== a1 || !/Bash$/.test(alerts[0].body) || alerts[1].tag !== a2 || alerts[1].body !== 'A Skybot needs your approval') errors.push('Desktop alerts: ' + JSON.stringify(alerts));
  await click('#swNotify');
  for (const id of [a1, a2]) { await click(`[data-ask="${id}"] [data-ans="deny"]`); await page.waitForTimeout(300); }
  await click('.tab[data-tab="city"]');

  // speed: a 2,500-step session opens in under 300 ms (CI 900), and each list draw while scrolling stays under
  // 30 ms (CI 90): the console's own work, timed here; the 3D frames are drawn apart from it
  await page.evaluate(() => window.__fakeBig());
  await page.waitForFunction(() => window.__skyborne.city.districts.has('p-big'), null, { timeout: 10000 }).catch(() => {});
  const perf = await page.evaluate(async () => {
    const o = window.__skyborne, d = o.city.districts.get('p-big');
    if (!d) return null;
    o.openDetail(d); o.renderUI();
    for (let i = 0; i < 100 && !o.detail.data; i++) await new Promise((r) => setTimeout(r, 50));
    o.detail.drawKey = '';
    const t0 = performance.now(); o.renderUI(); const open = performance.now() - t0;
    const host = document.getElementById('dtSteps'), stepDraws = [];
    for (let k = 1; k <= 20; k++) { host.scrollTop = k * 2500; const t = performance.now(); o.drawSteps(d); stepDraws.push(performance.now() - t); }
    const built = document.querySelectorAll('#dtSteps .srow').length;
    o.closeDetail();
    document.querySelector('.tab[data-tab="log"]').click(); o.renderUI();
    const body = document.querySelector('.c-body'), logDraws = [];
    for (let k = 1; k <= 20; k++) { body.scrollTop = k * 300; const t = performance.now(); o.drawLog(); logDraws.push(performance.now() - t); }
    document.querySelector('.tab[data-tab="city"]').click();
    return { steps: 2500, open: Math.round(open), maxStepDraw: Math.round(Math.max(...stepDraws) * 10) / 10, maxLogDraw: Math.round(Math.max(...logDraws) * 10) / 10, built, logRows: o.logRows().length };
  });
  if (!perf || perf.open > 300 * SLOW || perf.maxStepDraw > 30 * SLOW || perf.maxLogDraw > 30 * SLOW || perf.built > 120) errors.push('Console speed: ' + JSON.stringify(perf));
  await page.evaluate(() => window.__fakeGone('p-big'));
  await blur();

  // reel mode: R turns it on with the 9:16 overlay, and the Skybot logo beside a wordmark that fits inside the side
  // margins (on a narrow, tall phone too) in a row no taller than the wordmark alone, the LIVE pill, and under it the
  // counts ("6 districts · 2 agents working", one centred line; no line of what each bot is doing). At the bottom, the
  // watermark, bold: the author's credit at the left and skyborne.dev at the right, inside the margins, clear of each
  // other and lifted off the bottom. Esc leaves
  await blur(); await page.keyboard.press('r'); await page.waitForTimeout(2500);
  const reelTop = () => page.evaluate(() => {
    const hud = document.getElementById('reelHud'), wm = hud.querySelector('.wm'), a = hud.getBoundingClientRect(), b = wm.getBoundingClientRect();
    const m = hud.querySelector('.r-mark use').getBoundingClientRect();  // the logo drawn: its shapes have a size
    const pad = parseFloat(getComputedStyle(hud).paddingLeft), trail = parseFloat(getComputedStyle(wm).letterSpacing) || 0;
    return { on: window.__skyborne.director.on, body: document.body.classList.contains('reel'), shown: !hud.hidden, text: wm.textContent,
      fits: wm.scrollWidth <= wm.clientWidth && m.left >= a.left + pad - 0.5 && b.right - trail <= a.right - pad + 0.5,
      logo: m.height > 18 && m.right <= b.left + 1, short: hud.querySelector('.r-brand').getBoundingClientRect().height <= b.height + 0.5,
      counts: /^\d+\u00a0districts?  ·  \d+\u00a0agents? working$/.test(document.getElementById('reelStats').textContent) && !document.getElementById('reelTicker'),
      mark: (() => { const [l, r] = [...hud.querySelectorAll('.r-foot span')], lr = l.getBoundingClientRect(), rr = r.getBoundingClientRect();
        return l.textContent === 'Skyborne by Mirza Ishraq' && r.textContent === 'skyborne.dev' && Number(getComputedStyle(l).fontWeight) >= 700 && lr.width > 0 && lr.left >= a.left + pad - 0.5
          && rr.right <= a.right - pad + 0.5 && lr.right + 8 <= rr.left && lr.bottom <= a.bottom - 0.1 * a.height; })(),  // above a posted reel's caption
      toastClear: document.querySelector('.toast').getBoundingClientRect().top >= hud.querySelector('.r-foot').getBoundingClientRect().bottom - 0.5,  // a notice sits under the watermark
      noFollow: getComputedStyle(document.querySelector('.foot')).display === 'none',  // the footer and its links: not on reels (the watermark has the credit)
      oneLine: (() => { const st = document.getElementById('reelStats'), r = st.getBoundingClientRect(); const cs = getComputedStyle(st); return r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) < parseFloat(cs.fontSize) * 1.8 && Math.abs((r.left + r.right) / 2 - (a.left + a.right) / 2) < 2
        && r.top >= document.getElementById('reelLive').getBoundingClientRect().bottom && r.bottom < a.top + a.height / 3; })() };  // under the LIVE pill
  });
  const reel = await reelTop();
  // close-ups of a bot (the opening one, and a later one early and late as the camera closes in and rises): its tag
  // sits below the top's pills. And the longest counts likely ("60 districts · 99 agents working") still fit one line
  // on a 320 px phone
  const tagClear = () => page.evaluate(async () => {
    const sk = window.__skyborne, d = sk.director;
    const bots = [...sk.city.districts.values()].filter((x) => !x.leaving && !x.asleep).flatMap((x) => [...x.robots.values()]).filter((b) => !b.leaving && b.mode === 'live').slice(0, 2);
    const out = []; d.lastEventAt = performance.now() + 1e9;  // the city's own events don't cut away meanwhile
    for (const bot of bots) for (const [type, t] of [['reveal', 50], ['hero', 100], ['hero', 900]]) {
      d.queue.unshift({ type, bot, dur: 1000, a0: 0 }); d.next(); d.t = t;
      await new Promise((r) => setTimeout(r, 2500));  // the camera eases in
      const tag = bot.labelEl.getBoundingClientRect();
      if (!tag.width) continue;  // a tag the city hides doesn't count
      out.push(tag.top >= Math.max(document.getElementById('reelStats').getBoundingClientRect().bottom, document.getElementById('reelLive').getBoundingClientRect().bottom));
    }
    d.lastEventAt = 0; d.next();
    return out.length >= 3 && out.every(Boolean);
  });
  const fitsLong = () => page.evaluate(() => {
    const st = document.getElementById('reelStats'), c = st.cloneNode(); c.id = ''; c.textContent = '60\u00a0districts  ·  99\u00a0agents working';
    st.after(c); const cs = getComputedStyle(c), oneLine = c.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) < parseFloat(cs.fontSize) * 1.8;
    c.remove(); return oneLine;
  });
  reel.tagClear = await tagClear();
  await page.setViewportSize({ width: 320, height: 900 }); await page.waitForTimeout(600);
  const reelPhone = await reelTop();
  reelPhone.tagClear = await tagClear(); reelPhone.fitsLong = await fitsLong();
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(600);
  for (const r of [reel, reelPhone]) {
    if (!r.on || !r.body || !r.shown || r.text !== 'SKYBORNE' || !r.fits || !r.logo || !r.short || !r.noFollow || !r.counts || !r.mark || !r.oneLine || !r.tagClear || !r.toastClear || r.fitsLong === false) errors.push('Reel mode broken: ' + JSON.stringify({ r, phone: r === reelPhone }));
  }
  await page.screenshot({ path: dist('smoke-reel.png') });
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  if (await page.evaluate(() => window.__skyborne.director.on || !document.getElementById('reelHud').hidden)) errors.push('Esc did not leave reel mode');
  // the logo is drawn at the top left and on the loading screen too (the top bar is back once reel mode ends; the
  // loading screen is still laid out after it fades)
  const logos = await page.evaluate(() => ['.wordmark .mark use', '#boot .b-mark use'].map((q) => document.querySelector(q)?.getBoundingClientRect().height || 0));
  if (logos.some((h) => h < 18)) errors.push('The Skybot logo is not drawn at the top left and on the loading screen: ' + JSON.stringify(logos));
  // "Follow on X", in the footer right after the credit, a pill of its own: the author's X profile in a new tab. At every size the footer
  // stays on screen in one row and the button is on top, there to click (on a phone, with the console sheet closed: an
  // open sheet, like an alert, sends the footer away); on a small phone the button is the X logo alone. And the Mayor's
  // alert, long or short, stays clear of the toolbar above phone width. Then the GitHub button: the GitHub mark in a circle, right after
  // it, on top and there to click
  const followAt = async (w, h) => {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    return page.evaluate(() => {
      const f = document.querySelector('.foot .follow'), foot = document.querySelector('.foot'), pill = foot.querySelector('.credit'), credit = pill.querySelector('a');
      const al = document.getElementById('alert'), txt = document.getElementById('alertText'), con = document.getElementById('console');
      const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      const was = { hidden: al.hidden, text: txt.textContent, open: con.dataset.open, transition: con.style.transition };
      al.hidden = true;  // on a phone an alert takes the bottom edge, and the footer steps aside
      const phone = innerWidth <= 760;
      const awayForSheet = !phone || (con.dataset.open = 'true', getComputedStyle(foot).display === 'none');
      if (phone) { con.style.transition = 'none'; con.dataset.open = 'false'; }  // the sheet closed, at once
      const r = f.getBoundingClientRect(), fr = foot.getBoundingClientRect(), c = credit.getBoundingClientRect();
      const label = f.querySelector('span').getBoundingClientRect().width > 0, conR = con.getBoundingClientRect(), pr = pill.getBoundingClientRect();
      // a pill of its own beside the credit's: a gap between them, the same height, its own colour, and no shared backing
      const separate = pr.width > 0 && pr.right + 4 <= r.left && Math.abs(pr.height - r.height) < 1 && getComputedStyle(pill).backgroundColor !== getComputedStyle(f).backgroundColor
        && getComputedStyle(foot).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(foot).backdropFilter === 'none';
      const round = label || Math.abs(r.width - r.height) < 1;  // the logo alone: a circle, not a sliver
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2), reachable = !!top && f.contains(top);
      const g = foot.querySelector('.gh'), gr = g.getBoundingClientRect(), gTop = document.elementFromPoint(gr.left + gr.width / 2, gr.top + gr.height / 2);
      const gh = gr.left >= r.right + 4 && Math.abs(gr.width - gr.height) < 1 && Math.abs(gr.height - r.height) < 1 && !!gTop && g.contains(gTop)
        && g.href === 'https://github.com/ishraq21/skyborne' && g.target === '_blank' && g.rel.includes('noopener') && g.getAttribute('aria-label') === 'Skyborne on GitHub';
      con.dataset.open = was.open; con.offsetHeight; con.style.transition = was.transition;
      al.hidden = false; txt.textContent = 'Gumdrop in a-district-renamed-to-forty-characters-x needs you: mcp__github__create_pull_request';
      const ar = al.getBoundingClientRect(), tr = document.querySelector('.toolbar').getBoundingClientRect();
      const alertClear = phone || (ar.width > 0 && tr.width > 0 && apart(ar, tr));
      al.hidden = was.hidden; txt.textContent = was.text;
      return { after: r.left >= c.right && Math.abs((r.top + r.bottom) / 2 - (c.top + c.bottom) / 2) < 3, onScreen: fr.width > 0 && fr.left >= 0 && fr.right <= innerWidth && fr.bottom <= innerHeight,
        oneRow: fr.height < 40, label, separate, round, reachable, gh, awayForSheet, clearOfConsole: phone || con.dataset.open !== 'true' || apart(fr, conR),
        alertClear, link: f.href === 'https://x.com/myspaceio' && f.target === '_blank' && f.rel.includes('noopener') && f.getAttribute('aria-label') === 'Follow on X' };
    });
  };
  const follow = { 1440: await followAt(1440, 900), 1280: await followAt(1280, 800), 1000: await followAt(1000, 760), 800: await followAt(800, 700),
    390: await followAt(390, 844), 320: await followAt(320, 640) };
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(400);
  const fine = Object.values(follow).every((f) => f.link && f.after && f.separate && f.round && f.onScreen && f.oneRow && f.reachable && f.gh && f.awayForSheet && f.clearOfConsole && f.alertClear)
    && [1440, 1280, 1000, 800, 390].every((w) => follow[w].label) && !follow[320].label;  // a small phone: the logo alone
  if (!fine) errors.push('The Follow on X and GitHub buttons: ' + JSON.stringify(follow));

  // the × in the console's header hides the console at every size (on a phone the toolbar icon is easy to miss):
  // it is on top and big enough to tap, it has a name, it hides the console, and focus goes to the toolbar button, which
  // brings the console back
  for (const [w, h, min] of [[1280, 800, 28], [390, 844, 36]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    await page.evaluate(() => { if (document.getElementById('console').dataset.open !== 'true') document.getElementById('btnConsole').click(); });
    await page.waitForFunction(() => document.getElementById('console').dataset.open === 'true', null, { timeout: 15000 });
    await page.waitForTimeout(600);  // the slide-in
    const x = await page.evaluate((min) => {
      const b = document.getElementById('btnConsoleClose'), r = b.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { box: [r.left + r.width / 2, r.top + r.height / 2], named: b.getAttribute('aria-label') === 'Hide console', big: r.width >= min && r.height >= min,
        reachable: !!top && b.contains(top), onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
    }, min);
    await page.mouse.click(x.box[0], x.box[1]);
    await page.waitForFunction(() => document.getElementById('console').dataset.open === 'false', null, { timeout: 15000 }).catch(() => {});
    const after = await page.evaluate(() => ({ open: document.getElementById('console').dataset.open, pressed: document.getElementById('btnConsole').getAttribute('aria-pressed'), focus: document.activeElement?.id }));
    await page.evaluate(() => document.getElementById('btnConsole').click());
    await page.waitForFunction(() => document.getElementById('console').dataset.open === 'true', null, { timeout: 15000 }).catch(() => {});
    const back = await page.evaluate(() => document.getElementById('console').dataset.open);
    if (!x.named || !x.big || !x.reachable || !x.onScreen || after.open !== 'false' || after.pressed !== 'false' || after.focus !== 'btnConsole' || back !== 'true') errors.push(`The console's × button at ${w}x${h}: ${JSON.stringify({ x, after, back })}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(400);

  // the name on the 3D signs: no text pixels at the edges of the flag and blimp textures, and the
  // ring's longest line fits its texture even in the display font
  await page.evaluate(() => document.fonts.load('800 112px Unbounded'));
  const signs = await page.evaluate(() => {
    const canvases = new Set();
    window.__skyborne.scene.traverse((o) => { for (const m of [].concat(o.material || [])) { const c = m.map && m.map.userData && m.map.userData.canvas; if (c) canvases.add(c); } });
    const find = (w, h) => [...canvases].find((c) => c.width === w && c.height === h);
    // count near-white pixels in a box
    const white = (c, x0, x1, y0, y1) => { const d = c.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) n++; return n; };
    const flag = find(512, 300), blimp = find(1024, 200);
    const g = document.createElement('canvas').getContext('2d');
    g.font = '700 50px Unbounded, "Arial Black", sans-serif';
    const ring = g.measureText('SKYBORNE   ✦   99 DISTRICTS   ✦   99 AGENTS WORKING   ✦   999M TOKENS  ✦').width + 60;
    // the textures may have been drawn before the display font arrived; a cached font draws wider
    g.font = '800 112px Unbounded, "Arial Black", sans-serif';
    const blimpWidth = g.measureText('SKYBORNE').width;
    return {
      blimpWidth,
      flag: flag && { text: white(flag, 196, 500, 80, 150), edge: white(flag, 500, 512, 80, 150), png: flag.toDataURL() },
      blimp: blimp && { text: white(blimp, 12, 1012, 30, 170), edge: white(blimp, 0, 12, 30, 170) + white(blimp, 1012, 1024, 30, 170), png: blimp.toDataURL() },
      ring, font: document.fonts.check('800 112px Unbounded'),
    };
  });
  for (const k of ['flag', 'blimp']) {
    const s = signs[k];
    if (!s) { errors.push(`No ${k} texture found`); continue; }
    if (!s.text || s.edge) errors.push(`The ${k} name doesn't fit: ${s.text} text pixels, ${s.edge} at the edge`);
    fs.writeFileSync(dist(`smoke-${k}.png`), Buffer.from(s.png.split(',')[1], 'base64'));
  }
  if (signs.ring > 3072) errors.push(`The ring's longest line is ${Math.round(signs.ring)}px, wider than its 3072px texture`);
  if (signs.blimpWidth > 1024 - 24) errors.push(`The blimp name is ${Math.round(signs.blimpWidth)}px in the display font, wider than its texture`);

  // the bundled fonts: every family loads from this server
  const fonts = await page.evaluate(async () => {
    const out = {};
    for (const fam of ['Inter', 'Unbounded', 'JetBrains Mono', 'Martian Mono']) {
      const faces = await document.fonts.load(`500 16px "${fam}"`, 'Skyborne');
      out[fam] = faces.some((f) => f.status === 'loaded' && f.family.replace(/"/g, '') === fam);
    }
    return out;
  });
  for (const [fam, loaded] of Object.entries(fonts)) if (!loaded) errors.push(`Font ${fam} did not load`);
  const badFonts = fontResponses.filter(([u, st]) => st !== 200 || !u.startsWith(base + 'assets/fonts/'));
  if (!fontResponses.length || badFonts.length) errors.push(`Font files: ${JSON.stringify(badFonts.length ? badFonts : 'none requested')}`);

  // sound: a real click turns it on (browsers start audio only on a gesture); time of day changes the sky
  await page.click('#btnSound'); await page.waitForTimeout(500);
  const audio = await page.evaluate(() => window.__skyborne.audioState());
  if (audio !== 'running') errors.push(`Sound on, but the audio is ${audio}`);
  await page.click('#btnSound');
  await click('.tab[data-tab="set"]'); await page.waitForTimeout(300);
  const sky = () => page.evaluate(() => ({ fog: window.__skyborne.scene.fog.color.getHexString(), saved: localStorage.getItem('skyborne.time'),
    env: !!window.__skyborne.scene.environment, envI: window.__skyborne.scene.environmentIntensity }));
  await click('#segTime [data-v="day"]'); await page.waitForTimeout(3000); const day = await sky();
  await click('#segTime [data-v="night"]'); await page.waitForTimeout(3000); const night = await sky();
  if (day.fog === night.fog || !String(night.saved).includes('night')) errors.push(`Time of day: day ${JSON.stringify(day)}, night ${JSON.stringify(night)}`);
  // the city's soft reflections are there, and fainter at night
  if (!day.env || !(night.envI < day.envI)) errors.push(`Reflections: day ${JSON.stringify(day)}, night ${JSON.stringify(night)}`);
  // the soft clouds are there (24 of them, each a cluster of at least 7 puffs), and so is the cloud sea with its drifting floor;
  // and they really show: from a view over the city, drawing it with and without the puffs must change the picture
  const cloudsNow = await page.evaluate(() => {
    const s = window.__skyborne, sc = s.scene, g = sc.getObjectByName('cloudSea'), counts = [], puffs = [];
    sc.traverse((o) => { if (o.isMesh && /^cloud (sea )?puffs$/.test(o.material.name)) { puffs.push(o); if (o.material.name === 'cloud puffs') counts.push(o.geometry.instanceCount); } });
    const r = s.renderer, gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, cam = s.camera.clone();
    cam.clearViewOffset(); cam.position.set(0, 95, 150); cam.lookAt(0, -20, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const grab = () => { r.setRenderTarget(null); r.render(sc, cam); const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const a = grab(); puffs.forEach((o) => { o.visible = false; }); const b = grab(); puffs.forEach((o) => { o.visible = true; });
    let changed = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) changed++;
    return { clouds: counts.length, fewest: counts.length ? Math.min(...counts) : 0, sea: !!g, floor: !!(g && g.children[0].material.fragmentShader.includes('uNoise')),
      seaPuffs: g ? g.userData.puffs.geometry.instanceCount : 0, changed }; });
  if (cloudsNow.clouds !== 24 || cloudsNow.fewest < 7 || !cloudsNow.sea || !cloudsNow.floor || cloudsNow.seaPuffs < 50 || cloudsNow.changed < 2000)
    errors.push(`Clouds: ${JSON.stringify(cloudsNow)}`);
  // islands: the underside and the floating rocks are painted (one 'earth' material with colours per face)
  const earth = await page.evaluate(() => [...window.__skyborne.city.districts.values()].map((d) => {
    let n = 0; d.group.traverse((o) => { if (o.isMesh && o.material.name === 'earth' && o.geometry.attributes.color) n++; }); return n; }));
  if (!earth.length || earth.some((n) => n < 2)) errors.push(`Island undersides: ${JSON.stringify(earth)}`);
  // and every district has its soft contact shadows (baked with its still parts)
  const contact = await page.evaluate(() => [...window.__skyborne.city.districts.values()].map((d) => {
    let n = 0; d.group.traverse((o) => { if (o.isMesh && o.material.name === 'contact shadow' && o.parent && o.parent.userData.baked) n++; }); return n; }));
  if (!contact.length || contact.some((n) => n < 1)) errors.push(`Contact shadows: ${JSON.stringify(contact)}`);
  // a bot standing on the plaza (at a desk, or idling there) stands on top of it (0.12 up, plus 0.02 for its soles),
  // and its soft shadow lies on the plaza, just below its feet
  const feet = await page.evaluate(() => {
    for (const d of window.__skyborne.city.districts.values()) for (const b of d.robots.values()) if (b.mode === 'live' && !b.walking && Math.hypot(b.pos.x, b.pos.z - 1.1) < 5.4) {
      const y = b.root.position.y; return { y: +y.toFixed(3), shadow: +(y + b.shadow.position.y * b.root.scale.y).toFixed(3) };
    }
    return null; });
  if (!feet || Math.abs(feet.y - 0.14) > 0.01 || !(feet.shadow > 0.12 && feet.shadow < feet.y)) errors.push(`Bot on the plaza: ${JSON.stringify(feet)}`);
  await click('#segTime [data-v="auto"]');

  // a recording plays in place of the city (through the file picker), then "Back to live" returns
  const recording = { format: 'skyborne-recording', version: 1, session: { id: 'rec-1', title: 'demo-app' }, duration: 60_000, // no loop during the check
    frames: [0, 1500, 3000].map((t, i) => ({ t, doc: { v: 2, title: 'demo-app', headline: 'Recorded turn ' + i, startedAt: 0, updatedAt: t, turns: 1,
      tokens: { total: 1000 * (i + 1) }, waiting: null, feed: [{ ts: t, agent: 'Skybot', agentId: 'main', kind: 'bash', text: '$ npm test' }],
      agents: [{ id: 'main', name: 'Skybot', role: 'Lead Agent', type: 'lead', status: 'working', kind: 'bash', activity: '$ npm test', activitySince: t, tools: i },
        // a helper that failed a minute ago: gone after the 30 s linger, like a finished one
        { id: 'a1', name: 'Scout', role: 'Explore Agent', type: 'Explore', status: 'error', kind: 'error', activity: 'Ran into a problem', activitySince: -60_000, tools: 0, parent: 'main' }] } })) };
  await page.setInputFiles('#inRec', { name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(recording)) });
  // the live districts sink away first (2.4 s of animation, longer on CI's software renderer), then it plays
  await page.waitForFunction(() => { const c = window.__skyborne.city; return c.status === 'replay' && c.districts.size === 1 && [...(c.districts.get('rec-1')?.robots.values() || [])].some((b) => !b.leaving); },
    null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const played = await page.evaluate(() => ({ status: window.__skyborne.city.status, ids: [...window.__skyborne.city.districts.values()].filter((d) => !d.leaving).map((d) => d.id),
    slot: window.__skyborne.city.districts.get('rec-1')?.slot,
    bots: [...(window.__skyborne.city.districts.get('rec-1')?.robots.values() || [])].filter((b) => !b.leaving).length,
    pill: document.getElementById('reelLiveText').textContent, back: !document.getElementById('btnBackLive').hidden }));
  if (played.status !== 'replay' || played.ids.join() !== 'rec-1' || played.slot !== 0 || played.bots !== 1 || !played.pill.startsWith('REPLAY') || !played.back) errors.push('Recording did not play: ' + JSON.stringify(played));
  // a recording carries no status line: the Usage and Context tiles say so with a dash
  const tile3 = await tiles();
  if (tile3.use !== '—' || tile3.label !== 'Usage' || tile3.ctx !== '—') errors.push('Top numbers without a status line: ' + JSON.stringify(tile3));
  // "Safe to film" hides the recording's project name in Settings too
  await blur(); await page.keyboard.press('s'); await page.waitForTimeout(300);
  const note = { safe: await page.textContent('#recNote') };
  await page.keyboard.press('s'); await page.waitForTimeout(300);
  note.off = await page.textContent('#recNote');
  if (note.safe.includes('demo-app') || !note.off.includes('demo-app')) errors.push('Recording note in safe to film: ' + JSON.stringify(note));
  await click('#btnBackLive');
  await page.waitForFunction(() => { const c = window.__skyborne.city; return c.status === 'live' && [...c.districts.values()].filter((d) => !d.leaving).length >= 4; },
    null, { timeout: 30000 }).catch(() => {});
  const liveAgain = await page.evaluate(() => ({ status: window.__skyborne.city.status, n: [...window.__skyborne.city.districts.values()].filter((d) => !d.leaving).length,
    districts: [...window.__skyborne.city.districts.values()].map((d) => `${d.id}${d.leaving ? ' leaving' : ''}${d.rise < 1 ? ' rising' : ''}`) }));
  if (liveAgain.status !== 'live' || liveAgain.n < 4) errors.push('Back to live failed: ' + JSON.stringify(liveAgain));

  // a full city: 60 districts (the most the city shows). Draw calls are reported; headless software
  // rendering says nothing about frame rate on a real GPU, so that's measured separately.
  const many = { format: 'skyborne-recording', version: 1, session: { id: 'c-0', title: 'city' }, duration: 600_000, // no loop during the check
    frames: Array.from({ length: 60 }, (_, i) => ({ t: 0, id: 'c-' + i, doc: { v: 2, title: 'district-' + i, headline: 'Past work', startedAt: 0, updatedAt: -i * 60_000, turns: 3,
      tokens: { total: 50_000 * (i + 1) }, waiting: null, feed: [], agents: [{ id: 'main', name: 'Skybot', role: 'Lead Agent', type: 'lead', status: 'idle', kind: 'idle', activity: 'Left the city', activitySince: 0, tools: 12 }] } })) };
  await page.evaluate((r) => window.__skyborne.playRecording(r), JSON.stringify(many));
  await page.waitForTimeout(12000);
  const city60 = await page.evaluate(async () => {
    const o = window.__skyborne, r = o.renderer, ds = [...o.city.districts.values()].filter((d) => !d.leaving);
    // draw calls per frame: count every pass of a few frames, not just the last one. The shadow map is
    // redrawn every other frame; here it's every frame, so the count doesn't depend on which frames were caught
    r.info.autoReset = false; r.info.reset(); r.shadowMap.autoUpdate = true;
    let frames = 0; await new Promise((done) => { const t0 = performance.now(); const f = () => { frames++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
    const calls = Math.round(r.info.render.calls / Math.max(1, frames)); r.info.autoReset = true; r.shadowMap.autoUpdate = false;
    return { n: ds.length, bots: ds.reduce((n, d) => n + [...d.robots.values()].filter((b) => !b.leaving).length, 0),
      tokens: ds.reduce((n, d) => n + d.tokens, 0), callsPerFrame: calls, framesInASecond: frames };
  });
  if (city60.n !== 60 || city60.bots !== 60 || city60.tokens !== 50_000 * 60 * 61 / 2) errors.push(`A 60-district city: ${JSON.stringify(city60)}`);
  // no more draw calls than before the visual upgrade: 7,430 a frame in this test with the code of 2026-10-04
  // (shadows, cloud sea, painted islands came after), with 10% room
  if (!(city60.callsPerFrame <= 8200)) errors.push(`A 60-district city takes ${city60.callsPerFrame} draw calls a frame (at most 8,200)`);
  await page.screenshot({ path: dist('smoke-60.png') });
  await page.evaluate(() => window.__skyborne.backToLive());

  // live by default: with 6 live and 20 past sessions, the city and the list show the 6 (plus a past one that
  // waits on you); "Show past sessions" brings all 26 back, and the choice is remembered in this browser
  await page.waitForFunction(() => window.__skyborne.city.status === 'live', null, { timeout: 30000 }).catch(() => {});
  await click('.tab[data-tab="city"]');
  await page.evaluate(() => window.__fakeMany(6, 20));
  const shownNow = () => page.evaluate(() => [...window.__skyborne.city.districts.values()].filter((d) => !d.leaving).map((d) => d.id));
  const settled = (n) => page.waitForFunction((n) => [...window.__skyborne.city.districts.values()].filter((d) => !d.leaving).length === n
    && [...window.__skyborne.city.districts.values()].every((d) => !d.leaving), n, { timeout: 20000 }).catch(() => {});
  await settled(7); await page.waitForTimeout(1200);  // the list redraws at least once a second
  const live6 = await shownNow();
  const list6 = await page.evaluate(() => document.querySelectorAll('#sessList .dcard').length);
  const pastLabel = await page.textContent('#btnPast');
  await click('#btnPast'); await settled(26); await page.waitForTimeout(1200);
  const all26 = await shownNow();
  const list26 = await page.evaluate(() => document.querySelectorAll('#sessList .dcard').length);
  const waitingShown = live6.includes('m-6') && all26.includes('m-6');
  if (live6.length !== 7 || live6.filter((id) => +id.slice(2) < 6).length !== 6 || list6 !== 7 || pastLabel !== 'Show past sessions (19)' || all26.length !== 26 || list26 !== 26 || !waitingShown)
    errors.push('Live and past: ' + JSON.stringify({ live6, list6, pastLabel, all26: all26.length, list26, waitingShown }));
  await page.reload();
  await page.waitForFunction(() => window.__skyborne?.city.status === 'live' && !document.getElementById('pastRow').hidden, null, { timeout: 60000 }).catch(() => {});
  const remembered = await page.evaluate(() => ({ pressed: document.getElementById('btnPast').getAttribute('aria-pressed'), saved: localStorage.getItem('skyborne.showPast') }));
  if (remembered.pressed !== 'true' || remembered.saved !== 'true') errors.push('"Show past sessions" not remembered: ' + JSON.stringify(remembered));

  if (offMachine.length) errors.push('Requests left 127.0.0.1: ' + [...new Set(offMachine)].join(', '));
  await browser.close();
  server.close();
  const ok = !errors.length && info.districts > 0 && info.status === 'live';
  console.log(ok ? 'OK' : 'FAIL', JSON.stringify({ ...info, ring: Math.round(signs.ring), blimp: Math.round(signs.blimpWidth), displayFont: signs.font,
    fonts: fontResponses.length, city60, questionsMs: questions, perf }), errors.length ? errors : '');
  process.exit(ok ? 0 : 1);
})();
