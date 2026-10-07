// Site smoke test: open the built demo site (page/site, from `node build.js --site`) in a headless browser and
// check what a first-time visitor meets: the welcome pop-up (first visit only, focus on Launch, Esc and a click
// outside close it, Tab stays inside, the city's keys wait, the camera holds until Launch), the city with its
// sample districts and the recorded one, the console open and usable (tabs, a session's detail), the recorded
// request's card (its buttons say "Demo" and send nothing), the footer's About pill, one full loop of the recording,
// a phone-sized screen (the pop-up fits without scrolling, nothing scrolls sideways), and the first view drawn
// without any mouse movement. Fails on any page error or any request that leaves 127.0.0.1, and on any request
// for /events or /api (the site has no server). Reports the time to the pop-up and to the first city frame and
// the transfer size, with the CPU slowed 4x and a "Fast 4G" connection (9 Mbps, 170 ms); it fails on those only with
// SKYBORNE_GPU=1 (a real graphics card) outside CI, since software drawing makes the time meaningless.
// Run:  node build.js --site && node tests/site-smoke.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const SITE = path.resolve(__dirname, '..', 'site');
const dist = (f) => path.resolve(__dirname, '..', 'dist', f);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml' };
const COMMAND = 'uv tool install skyborne';

function serve() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(url.pathname);
    let file = path.join(SITE, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!path.resolve(file).startsWith(SITE + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const type = TYPES[path.extname(file)] || 'application/octet-stream', head = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    // GitHub Pages compresses text on the way out, so the timing below should too
    if (/gzip/.test(req.headers['accept-encoding'] || '') && /^text\//.test(type)) {
      res.writeHead(200, { ...head, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' }); res.end(zlib.gzipSync(fs.readFileSync(file))); return;
    }
    res.writeHead(200, head);
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, requests })));
}

(async () => {
  if (!fs.existsSync(path.join(SITE, 'index.html'))) { console.error('No page/site yet: run `node build.js --site` first.'); process.exit(1); }
  const { server, requests } = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const gpu = process.env.SKYBORNE_GPU === '1';
  const gpuArgs = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args: gpu ? gpuArgs : ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const SLOW = process.env.CI ? 3 : 1;
  const errors = [], offMachine = [], problems = [];
  const fail = (m) => problems.push(m);
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && /Skyborne frame error|THREE\.WebGLProgram|Shader Error/.test(m.text())) errors.push(m.text()); });
  };
  const open = async (opts = {}, seen = false) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', ...opts });
    await context.route((url) => url.hostname !== '127.0.0.1', (route) => { offMachine.push(route.request().url()); route.abort(); });
    if (seen) await context.addInitScript(() => { try { localStorage.setItem('skyborne.welcomed', '1'); } catch (e) {} });
    context.setDefaultTimeout(30000 * SLOW);
    const page = await context.newPage();
    watch(page);
    return { context, page };
  };
  const ready = (page, n = 7) => page.waitForFunction((n) => window.__skyborne?.city.districts.size >= n && getComputedStyle(document.getElementById('boot')).opacity === '0', n, { timeout: 90000 * SLOW });
  const cam = (page) => page.evaluate(() => window.__skyborne.camera.position.toArray().map((v) => Math.round(v * 10) / 10));
  const ok = (cond, msg) => { if (!cond) fail(msg); };

  // ---- a first visit, on a desktop ----
  {
    const { context, page } = await open({ permissions: ['clipboard-read', 'clipboard-write'] });
    await page.goto(base);
    await page.waitForSelector('#welcome:not([hidden])', { timeout: 30000 });
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'welcomeGo'), 'Focus does not start on Launch');
    ok((await page.textContent('#welcome')).includes("Hi, I'm Mirza"), 'The welcome copy is missing');
    ok(await page.evaluate(() => [...document.querySelectorAll('#welcome .btn')].every((b) => parseFloat(getComputedStyle(b).borderRadius) >= 16 && getComputedStyle(b).textDecorationLine === 'none')), 'The welcome buttons lost their button styling');
    await ready(page);
    // the city runs behind the pop-up, and the camera holds its opening pose until Launch
    const held1 = await cam(page); await page.waitForTimeout(1500); const held2 = await cam(page);
    ok(JSON.stringify(held1) === JSON.stringify(held2), 'The camera moved while the welcome was open: ' + held1 + ' -> ' + held2);
    // the city's keys wait while the welcome is open; Tab stays inside it
    await page.keyboard.press('r'); await page.keyboard.press('c');
    ok(!(await page.evaluate(() => document.body.classList.contains('reel'))), 'The R key reached the city through the welcome');
    const stops = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); stops.push(await page.evaluate(() => document.activeElement.textContent.trim().slice(0, 18))); }
    ok(stops.every((s) => /Launch|Install|X|Report/.test(s)), 'Tab left the welcome: ' + stops.join(' | '));
    await page.screenshot({ path: dist('smoke-site-welcome.png') });
    // Launch closes it, remembers it, and starts the camera sweep
    await page.evaluate(() => document.getElementById('welcomeGo').click());
    ok(await page.evaluate(() => document.getElementById('welcome').hidden), 'Launch did not close the welcome');
    ok(await page.evaluate(() => localStorage.getItem('skyborne.welcomed') === '1'), 'The first visit was not remembered');
    await page.waitForTimeout(1500);
    ok(JSON.stringify(await cam(page)) !== JSON.stringify(held2), 'The camera sweep did not start after Launch');
    // the console is open and the city is full: the recorded session and six sample districts
    ok(await page.evaluate(() => document.getElementById('console').dataset.open === 'true'), 'The console is not open on a desktop');
    const n = await page.evaluate(() => window.__skyborne.city.districts.size);
    ok(n >= 7, `Only ${n} districts in the city (expected the recording and six samples)`);
    ok(Number(await page.textContent('#cntCity')) >= 7, 'The Sessions tab does not count the districts');
    for (const tab of ['log', 'set', 'city']) {
      await page.evaluate((t) => document.querySelector(`[data-tab="${t}"]`).click(), tab);
      ok(await page.evaluate((t) => document.querySelector(`[data-tab="${t}"]`).getAttribute('aria-selected') === 'true', tab), `The ${tab} tab did not open`);
    }
    // the recorded request: a card whose buttons say Demo, and clicking sends nothing
    // all in one go, waiting inside the page: the card is on screen for about four seconds of each loop, and a
    // page drawn in software (CI) can stall for seconds, so waiting from here and looking afterwards loses the race
    const before = requests.length;
    const card = await page.evaluate(async (limit) => {
      const t0 = performance.now();
      while (!document.querySelector('#askList .ask:not(.terminal)')) {
        if (performance.now() - t0 > limit) throw new Error('The recorded request never showed as a card');
        await new Promise((r) => setTimeout(r, 15));
      }
      const el = document.querySelector('#askList .ask:not(.terminal)'), note = () => el.querySelector('.ask-note').textContent;
      const text = el.textContent;
      el.querySelector('[data-ans="allow"]').click(); const afterClick = note();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true })); const afterKey = note();
      return { text, afterClick, afterKey, all: document.getElementById('askList').textContent };
    }, 130000 * SLOW);
    ok(/unittest|rm -rf/.test(card.text) && /Approve · Demo/.test(card.text) && /Deny · Demo/.test(card.text), 'The recorded request card is wrong: ' + card.text.slice(0, 160));
    ok(card.afterClick.startsWith('This is a demo'), 'Approve in the demo shows no note: ' + card.afterClick);
    ok(card.afterKey.startsWith('This is a demo'), 'The D key in the demo shows no note: ' + card.afterKey);
    ok(!/Couldn't send/.test(card.all), 'The demo card said it could not send');
    await page.waitForTimeout(500);
    ok(requests.length === before, 'Answering the demo card sent a request');
    // a session's detail opens from the recording
    const recId = await page.evaluate(() => [...window.__skyborne.city.districts.keys()].find((k) => !String(k).startsWith('sample-')));
    await page.evaluate((id) => window.__skyborne.openDetail(window.__skyborne.city.districts.get(id)), recId);
    await page.waitForSelector('#sessDetail:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(1200);
    ok(/Prompt 1/.test(await page.textContent('#sessDetail')), 'The recorded session\'s detail does not show its prompt');
    await page.screenshot({ path: dist('smoke-site-detail.png') });
    await page.evaluate(() => window.__skyborne.closeDetail());
    // the footer: About is its own pill after the GitHub icon, and no overlay card is left on the page
    ok(await page.evaluate(() => !document.querySelector('.demo-bar') && !document.getElementById('demoCopy')), 'The overlay card is still on the page');
    const foot = await page.$$eval('.foot > *', (els) => els.map((e) => (e.classList.contains('gh') ? 'github' : e.id === 'demoAbout' ? 'about' : e.className.split(' ')[0])));
    ok(foot[foot.length - 1] === 'about' && foot[foot.length - 2] === 'github', 'About is not the last pill, after the GitHub icon: ' + foot.join(', '));
    ok(!(await page.textContent('body')).includes('Newsletter'), 'A Newsletter button is still on the page');
    ok(!(await page.evaluate(() => [...document.querySelectorAll('#welcome a')].map((a) => a.textContent.trim()).includes('Blog'))), 'The welcome still has a Blog link');
    ok((await page.textContent('.foot .credit')).trim() === 'By Mirza Ishraq', 'The footer credit is not "By Mirza Ishraq": ' + (await page.textContent('.foot .credit')));
    ok(/LLM observability/.test(await page.textContent('#welcome')) && /agent tracing/.test(await page.textContent('#welcome')) && !/Best,\s*Mirza/.test(await page.textContent('#welcome')), 'The welcome copy is not as asked');
    const links = await page.$$eval('.foot a, #welcome a', (as) => as.map((a) => a.href));
    ok(links.includes('https://github.com/ishraq21/skyborne') && links.includes('https://github.com/ishraq21/skyborne#install') && links.includes('https://x.com/myspaceio')
      && links.some((l) => l.includes('/issues/new?template=bug_report.md')), 'A link in the footer or the welcome is wrong: ' + links.join(' '));
    await page.screenshot({ path: dist('smoke-site-desktop.png') });
    // reel mode hides the footer, About with it
    await page.keyboard.press('r');
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('demoAbout')).display === 'none' || getComputedStyle(document.querySelector('.foot')).display === 'none'), 'About shows in reel mode');
    await page.keyboard.press('r');
    // About reopens the welcome; Esc closes it; so does a click outside
    await page.evaluate(() => document.getElementById('demoAbout').click());
    ok(await page.evaluate(() => !document.getElementById('welcome').hidden && document.activeElement.id === 'welcomeGo'), 'About did not reopen the welcome with focus on Launch');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => document.getElementById('welcome').hidden), 'Esc did not close the welcome');
    await page.evaluate(() => document.getElementById('demoAbout').click());
    await page.mouse.click(8, 8);
    ok(await page.evaluate(() => document.getElementById('welcome').hidden), 'A click outside did not close the welcome');
    // the recording loops: it leaves the city after its end and comes back
    const gone = await page.waitForFunction((id) => !window.__skyborne.city.districts.has(id), recId, { timeout: 120000 * SLOW }).then(() => true, () => false);
    ok(gone, 'The recording never ended');
    const back = await page.waitForFunction((id) => window.__skyborne.city.districts.has(id), recId, { timeout: 60000 * SLOW }).then(() => true, () => false);
    ok(back, 'The recording did not start over');
    // "Back to live" (reachable after playing a file from Settings) returns to the recording, never to a server
    await page.evaluate(() => window.__skyborne.backToLive());
    await page.waitForTimeout(1500);
    ok(await page.evaluate((id) => window.__skyborne.city.districts.has(id), recId) || await page.waitForFunction((id) => window.__skyborne.city.districts.has(id), recId, { timeout: 15000 * SLOW }).then(() => true, () => false), 'Back to live did not bring the recording back');
    ok(!(await page.evaluate(() => document.querySelector('.empty-note')?.textContent || '')).includes("Can't reach"), 'The page says it cannot reach Skyborne');
    await context.close();
  }

  // ---- a return visit: no welcome, the sweep starts on its own, and the first view draws with no mouse or key ----
  {
    const { context, page } = await open({}, true);
    await page.goto(base);
    ok(await page.evaluate(() => document.getElementById('welcome').hidden), 'The welcome showed again on a return visit');
    await ready(page);
    const lumaOf = async () => {
      const png = await page.screenshot({ clip: { x: 0, y: 100, width: 380, height: 500 } });
      return page.evaluate(async (b64) => {
        const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += (d[i] + d[i + 1] + d[i + 2]) / 3;
        return t / (d.length / 4);
      }, png.toString('base64'));
    };
    const lumas = []; for (let i = 0; i < 4; i++) { lumas.push(Math.round(await lumaOf())); await page.waitForTimeout(250); }
    // a single empty frame in a software-drawn screenshot is a known harmless artifact (as in smoke.js): three in a row is a fault
    if (lumas.some((l, i) => i >= 2 && lumas.slice(i - 2, i + 1).every((x) => x < 60))) fail('The 3D area was dark on a return visit (brightness per sample): ' + lumas.join(' '));
    await context.close();
  }

  // ---- phones: the pop-up fits without scrolling, nothing scrolls sideways, the overlay and console are reachable ----
  for (const [w, h] of [[390, 844], [360, 640]]) {
    const { context, page } = await open({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    await page.goto(base);
    await page.waitForSelector('#welcome:not([hidden])', { timeout: 30000 });
    const fit = await page.evaluate(() => { const c = document.querySelector('#welcome .card'), r = c.getBoundingClientRect(); return { scroll: c.scrollHeight - c.clientHeight, top: r.top, bottom: r.bottom, h: innerHeight, right: r.right, w: innerWidth }; });
    ok(fit.scroll <= 0 && fit.top >= 0 && fit.bottom <= fit.h && fit.right <= fit.w, `The welcome does not fit ${w}x${h} without scrolling: ${JSON.stringify(fit)}`);
    await page.screenshot({ path: dist(`smoke-site-phone-${w}.png`) });
    await page.evaluate(() => document.getElementById('welcomeGo').click());
    await ready(page);
    const side = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(side.sw <= side.iw, `The page scrolls sideways at ${w}x${h}: ${side.sw} > ${side.iw}`);
    // the footer is shown for this check (the page hides it while a "needs you" pill takes a phone's bottom edge): every pill stays on screen
    await page.addStyleTag({ content: '.foot{display:flex !important}' });
    const pills = await page.$$eval('.foot > *', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
    ok(pills.length >= 4 && pills.every(([l, r]) => l >= 0 && r <= w), `A footer pill runs off the screen at ${w}x${h}: ${JSON.stringify(pills)}`);
    const bar = await page.evaluate(() => { const f = document.querySelector('.foot'), r = document.getElementById('demoAbout').getBoundingClientRect(); return { shown: getComputedStyle(f).display !== 'none', l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight }; });
    ok(!bar.shown || (bar.r > bar.l && bar.l >= 0 && bar.r <= bar.w && bar.t >= 0 && bar.b <= bar.h), `The About pill is off screen at ${w}x${h}: ${JSON.stringify(bar)}`);
    ok(await page.evaluate(() => document.getElementById('console').dataset.open === 'false'), 'The console covers the city on a phone at first');
    await page.screenshot({ path: dist(`smoke-site-phone-${w}-city.png`) });
    await page.evaluate(() => document.getElementById('btnConsole').click());
    await page.waitForTimeout(900);
    ok(await page.evaluate(() => document.getElementById('console').dataset.open === 'true'), 'The console button does nothing on a phone');
    await page.screenshot({ path: dist(`smoke-site-phone-${w}-console.png`) });
    await context.close();
  }

  // ---- how fast it comes up: CPU slowed 4x, "Fast 4G" ----
  {
    const { context, page } = await open();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 170, downloadThroughput: 9 * 1024 * 1024 / 8, uploadThroughput: 1.5 * 1024 * 1024 / 8 });
    let bytes = 0; cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
    const t0 = Date.now();
    await page.goto(base, { waitUntil: 'commit' });
    await page.waitForSelector('#welcome:not([hidden])');
    const popupMs = Date.now() - t0;
    await page.waitForFunction(() => window.__skyborneBooted === true, null, { timeout: 120000 * SLOW });
    const frameMs = Date.now() - t0;
    console.log(`Timing (CPU 4x slower, Fast 4G, ${gpu ? 'real graphics card' : 'software drawing'}): welcome ${popupMs} ms, first city frame ${frameMs} ms, transferred ${(bytes / 1024).toFixed(0)} KB`);
    if (gpu && !process.env.CI && frameMs > 3000) fail(`The first city frame took ${frameMs} ms (the aim is under 3000)`);
    await context.close();
  }

  // ---- the site is static: nothing was asked of a server, and nothing left this machine ----
  const dynamic = requests.filter((p) => /^\/(events|api|health|permission)/.test(p));
  ok(!dynamic.length, 'The page asked for server paths: ' + dynamic.join(', '));
  ok(!offMachine.length, 'Requests left 127.0.0.1: ' + offMachine.join(', '));
  errors.forEach((e) => fail('Page error: ' + e));
  await browser.close();
  server.close();
  if (problems.length) { console.error('FAILED\n - ' + problems.join('\n - ')); process.exit(1); }
  console.log('OK site smoke:', JSON.stringify({ requests: [...new Set(requests)].length }));
})().catch((e) => { console.error(e); process.exit(1); });
