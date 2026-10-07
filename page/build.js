// Builds the Skyborne page. Everything it needs is bundled: no CDN, no web fonts from elsewhere.
//   ../skyborne/web/index.html  -> the city the local server serves at / (it puts this launch's token
//                                  in place of __SKYBORNE_TOKEN__); shipped inside the Python package
//   ../skyborne/web/assets/     -> three.js 0.170 and the addons the page imports, the 4 fonts
//                                  (latin and latin-ext), their licenses, and the tab icons (src/icons;
//                                  `node dev/icons.js` makes the PNGs from the SVG)
//   dist/preview.html           -> the same page with a fake, live city (dev/fake-city.js) for local
//                                  work; serve it with `node dev/serve.js`
//   --site [folder]             -> also the static demo site (default page/site, git-ignored): the same page
//                                  with demo/demo.html in front and demo/recording.json playing inside it
// The output only depends on the sources and node_modules (no dates), so CI can check it's current.
// Usage: node build.js [--site [folder]]
const fs = require('fs');
const path = require('path');
const here = (...p) => path.join(__dirname, ...p);
const mod = (...p) => here('node_modules', ...p);
const WEB = here('..', 'skyborne', 'web');
const ASSETS = path.join(WEB, 'assets');

// order matters: later files use what earlier ones define
const ORDER = ['01-core.js', '02-world.js', '03a-blocks.js', '03-district.js', '03b-transit.js', '04-robot.js', '05-city.js', '05b-detail.js', '06-ui.js'];
// the families the page's CSS and canvases name, and the Fontsource package each comes from
const FONTS = [
  { family: 'Inter', pkg: 'inter', file: 'inter' },
  { family: 'Unbounded', pkg: 'unbounded', file: 'unbounded' },
  { family: 'JetBrains Mono', pkg: 'jetbrains-mono', file: 'jetbrains-mono' },
  { family: 'Martian Mono', pkg: 'martian-mono', file: 'martian-mono' },
];
const SUBSETS = ['latin', 'latin-ext'];

const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
fs.rmSync(ASSETS, { recursive: true, force: true }); // nothing stale survives a rebuild

const app = ORDER.map((f) => fs.readFileSync(here('src', f), 'utf8')).join('\n');
const body = fs.readFileSync(here('src', 'page.html'), 'utf8').replace('/*APP*/', () => app);

// three.js: the module build, plus each addon the app imports and every file those import in turn
const three = JSON.parse(fs.readFileSync(mod('three', 'package.json'), 'utf8'));
if (three.version !== '0.170.0') throw new Error(`three ${three.version} installed; the page is built for 0.170.0 (run npm ci)`);
copy(mod('three', 'build', 'three.module.min.js'), path.join(ASSETS, 'three', 'three.module.min.js'));
const addons = new Set();
const todo = [...app.matchAll(/from 'three\/addons\/([^']+)'/g)].map((m) => m[1]);
while (todo.length) {
  const rel = path.posix.normalize(todo.pop());
  if (addons.has(rel)) continue;
  addons.add(rel);
  const src = fs.readFileSync(mod('three', 'examples', 'jsm', ...rel.split('/')), 'utf8');
  for (const m of src.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) todo.push(path.posix.join(path.posix.dirname(rel), m[1]));
}
for (const rel of [...addons].sort()) copy(mod('three', 'examples', 'jsm', ...rel.split('/')), path.join(ASSETS, 'three', 'addons', ...rel.split('/')));
copy(mod('three', 'LICENSE'), path.join(ASSETS, 'licenses', 'three.js-LICENSE.txt'));
for (const f of ['icon.svg', 'icon-32.png', 'apple-touch-icon.png']) copy(here('src', 'icons', f), path.join(ASSETS, 'icons', f));

// fonts: the variable (wght) files for the subsets the UI's text uses, under the names the page already uses
const faces = [];
for (const f of FONTS) {
  const css = fs.readFileSync(mod('@fontsource-variable', f.pkg, 'wght.css'), 'utf8');
  for (const sub of SUBSETS) {
    const file = `${f.file}-${sub}-wght-normal.woff2`;
    const block = css.split('@font-face').find((b) => b.includes(`/${file})`));
    if (!block) throw new Error(`no ${file} in @fontsource-variable/${f.pkg}`);
    const weight = /font-weight:\s*([^;]+);/.exec(block)[1].trim();
    const range = /unicode-range:\s*([^;]+);/.exec(block)[1].trim();
    copy(mod('@fontsource-variable', f.pkg, 'files', file), path.join(ASSETS, 'fonts', file));
    faces.push(`@font-face{font-family:'${f.family}';font-style:normal;font-display:swap;font-weight:${weight};`
      + `src:url(./assets/fonts/${file}) format('woff2');unicode-range:${range}}`);
  }
  copy(mod('@fontsource-variable', f.pkg, 'LICENSE'), path.join(ASSETS, 'licenses', `${f.family.replace(/ /g, '')}-OFL.txt`));
}

const importMap = JSON.stringify({ imports: { three: './assets/three/three.module.min.js', 'three/addons/': './assets/three/addons/' } });
const doc = (headExtra, bodyStart, title = 'Skyborne') => '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
  + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
  + '<link rel="icon" href="./assets/icons/icon-32.png" sizes="32x32" type="image/png">\n'
  + '<link rel="icon" href="./assets/icons/icon.svg" type="image/svg+xml">\n'
  + '<link rel="apple-touch-icon" href="./assets/icons/apple-touch-icon.png">\n'
  + headExtra + `<title>${title}</title>\n`
  + '<style>\n' + faces.join('\n') + '\nbody{margin:0;background:#9fc3dd}[hidden]{display:none!important}\n</style>\n'
  + `<script type="importmap">${importMap}</script>\n`
  + '</head><body>\n' + bodyStart + body + '\n</body></html>\n';

write(path.join(WEB, 'index.html'), doc('<meta name="skyborne-token" content="__SKYBORNE_TOKEN__">\n', ''));
const fake = fs.readFileSync(here('dev', 'fake-city.js'), 'utf8');
write(here('dist', 'preview.html'), doc('', '<script>\n' + fake + '\n</script>\n'));

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`built skyborne/web (page ${(fs.statSync(path.join(WEB, 'index.html')).size / 1024).toFixed(0)} KB, assets ${(size(ASSETS) / 1024).toFixed(0)} KB: `
  + `${addons.size} three.js addons, ${faces.length} font files) and dist/preview.html`);

// ---------------- the static demo site (node build.js --site) ----------------
// Plays one recording from `skyborne record` in a loop, with nothing to connect to: no server, no tracking,
// no request to any other host. Built only on request, so the local page above never changes.
const siteAt = process.argv.indexOf('--site');
if (siteAt > -1) {
  const zlib = require('zlib');
  const OUT = path.resolve(process.argv[siteAt + 1] && !process.argv[siteAt + 1].startsWith('--') ? process.argv[siteAt + 1] : here('site'));
  const URL = 'https://skyborne.dev/';
  const TITLE = 'Skyborne: a live 3D city of your Claude Code agents';
  const DESC = 'Watch your Claude Code sessions and agents as a live 3D sky city. Approve or deny requests from one place. Local-only, open source, no telemetry.';
  const rec = JSON.parse(fs.readFileSync(here('demo', 'recording.json'), 'utf8'));
  if (rec.format !== 'skyborne-recording' || rec.version !== 1 || rec.standIns !== true) throw new Error('demo/recording.json must be a stand-ins recording from `skyborne record --stand-ins`');
  // the page plays the frames; of the events it needs only the permission requests' commands (nothing else of them ships)
  const slim = { format: rec.format, version: rec.version, standIns: true, session: rec.session, duration: rec.duration, frames: rec.frames,
    events: (rec.events || []).filter((e) => e && e.payload && e.payload.hook_event_name === 'PermissionRequest')
      .map((e) => ({ t: e.t, payload: { hook_event_name: 'PermissionRequest', tool_name: e.payload.tool_name, tool_input: e.payload.tool_input } })) };
  const json = JSON.stringify(slim).replace(/</g, '\\u003c');  // a "</script>" in a command can't end the script early
  const logo = 'data:image/svg+xml;base64,' + fs.readFileSync(here('..', 'docs', 'images', 'logo.svg')).toString('base64');
  const layer = fs.readFileSync(here('demo', 'demo.html'), 'utf8').replace(/\{\{LOGO\}\}/g, () => logo);
  const meta = `<meta name="description" content="${DESC}">\n<link rel="canonical" href="${URL}">\n<meta name="theme-color" content="#f4f3ef">\n`
    + `<meta property="og:type" content="website">\n<meta property="og:site_name" content="Skyborne">\n<meta property="og:url" content="${URL}">\n`
    + `<meta property="og:title" content="${TITLE}">\n<meta property="og:description" content="${DESC}">\n`
    + `<meta property="og:image" content="${URL}og.png">\n<meta property="og:image:width" content="1280">\n<meta property="og:image:height" content="640">\n`
    + `<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${TITLE}">\n<meta name="twitter:description" content="${DESC}">\n`
    + `<meta name="twitter:image" content="${URL}og.png">\n`;
  const recScript = `<script>window.__skyborneDemo.rec = ${json};</script>\n`;
  // only what a site build writes is replaced, and never in this repo's own folders
  if ([WEB, here(), here('..')].includes(OUT) || fs.existsSync(path.join(OUT, 'build.js'))) throw new Error(`--site would write into ${OUT}, which holds the page's sources: pick another folder`);
  for (const name of ['index.html', 'assets', 'og.png']) fs.rmSync(path.join(OUT, name), { recursive: true, force: true });
  fs.cpSync(ASSETS, path.join(OUT, 'assets'), { recursive: true });
  const og = here('demo', 'og.png');
  if (fs.existsSync(og)) copy(og, path.join(OUT, 'og.png'));
  const html = doc(meta, layer + recScript, TITLE);
  write(path.join(OUT, 'index.html'), html);
  const kb = (n) => (n / 1024).toFixed(0) + ' KB';
  console.log(`built the demo site in ${OUT}: page ${kb(html.length)} (${kb(zlib.gzipSync(html).length)} gzipped, recording ${kb(json.length)}), `
    + `total ${kb(size(OUT))}${fs.existsSync(og) ? '' : ' (no og.png yet)'}`);
}
