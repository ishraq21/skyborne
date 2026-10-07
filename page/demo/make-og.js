// Makes page/demo/og.png (1280x640): the link preview for skyborne.dev and the repo's social preview. A daytime
// screenshot of the built demo site's city, with the logo, "Skyborne" and one line over a soft scrim, in type
// large enough to read as a thumbnail on a phone. Uses this machine's graphics card.
//   node build.js --site && node demo/make-og.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const SITE = path.resolve(__dirname, '..', 'site');
const OUT = path.resolve(__dirname, 'og.png');
const LOGO = 'data:image/svg+xml;base64,' + fs.readFileSync(path.resolve(__dirname, '..', '..', 'docs', 'images', 'logo.svg')).toString('base64');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.join(SITE, new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'));
    if (!file.startsWith(SITE + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const browser = await chromium.launch({ args: process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try { localStorage.setItem('skyborne.welcomed', '1'); localStorage.setItem('skyborne.console', 'false'); localStorage.setItem('skyborne.time', '"day"'); localStorage.setItem('skyborne.labels', 'false'); } catch (e) {}
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__skyborne?.city.districts.size >= 7 && getComputedStyle(document.getElementById('boot')).opacity === '0', null, { timeout: 90000 });
  await page.waitForTimeout(9000);  // the opening sweep ends, the districts have risen
  await page.evaluate((logo) => {
    for (const sel of ['.hud', '.foot', '.alert', '.console', '.toast']) document.querySelectorAll(sel).forEach((e) => { e.style.display = 'none'; });
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;justify-content:flex-end;padding:0 64px 56px;'
      + 'background:linear-gradient(0deg,rgba(18,22,34,.82) 0%,rgba(18,22,34,.55) 38%,rgba(18,22,34,0) 72%);color:#fff;font-family:Inter,system-ui,sans-serif';
    d.innerHTML = `<div style="display:flex;align-items:center;gap:26px"><img src="${logo}" width="120" height="120" alt="" style="flex:none;filter:drop-shadow(0 4px 14px rgba(0,0,0,.35))">`
      + `<div><div style="font-family:Unbounded,Inter,sans-serif;font-weight:800;font-size:92px;letter-spacing:.02em;line-height:1">Skyborne</div>`
      + `<div style="margin-top:12px;font-size:38px;font-weight:600;line-height:1.2;text-shadow:0 2px 12px rgba(0,0,0,.4)">A live 3D city of your Claude Code agents.</div></div></div>`;
    document.body.appendChild(d);
  }, LOGO);
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT });
  await browser.close();
  server.close();
  console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
