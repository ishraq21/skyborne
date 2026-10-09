# Skyborne page (page/)
The 3D sky city: each Claude Code session is a floating district; each agent is a named "Skybot".
The user is "the Mayor" (City Hall reads "Mayor", plus a name if they set one). Built to film reels.
The local server serves it at `/` and feeds it through `/events` (docs/EVENT_FORMAT.md); all bundled.

## Files
- `src/page.html` (HTML/CSS shell), `01-core` (renderer, camera, sky, `store`), `02-world`, `03a-blocks`,
  `03-district`, `03b-transit`, `04-robot` (bots, moods, moments), `05-city` (docs to districts, director, sound, samples),
  `05b-detail` (live or past, session detail, timeline, long lists; runs nothing at load), `06-ui` (console, cards, loop, sources).
- `dev/fake-city.js`: the preview's fake data source (atlas-api plays a ~40 s story loop).
  `dev/serve.js`: the preview server. `dev/fps.js`: frame rate of N districts on this machine's GPU.

## Build and check
- Once: `npm ci && npx playwright install chromium` (three.js 0.170.0, 4 Fontsource fonts, Playwright; pinned).
- Build: `node build.js` makes `../skyborne/web/` (index.html, three.js and addons, fonts, licenses;
  committed, shipped in the Python package) and `dist/preview.html`. Deterministic: CI fails if stale.
- Preview: `node dev/serve.js`, then open http://127.0.0.1:8000/ (modules don't load from `file://`).
- `node tests/smoke.js` (preview): the four questions in 5 s (15 s on CI), live/past (6 + 20), inbox clocks, alerts, top numbers, detail,
  bot view, logs, keys, safe-to-film everywhere, speed (2,500 steps), plus city, tabs, reel, samples, renaming, recording, 60 districts.
- `node tests/live-smoke.js` (real server): district in 1 s (5 s on CI), backfill, two tabs, renaming and approvals with the
  token, a detail from /api/session, past sessions shown and hidden, a recording. Both fail on requests off 127.0.0.1.

## Data
- One source at a time feeds `applyDocs` (`06-ui.js`): live (`EventSource('/events?feed=50')`: names,
  every recent session, `ready`, then changes; the newest 60 by `updatedAt`), player (a recording's frames, times moved to
  now), or the dev fake. Live by default (`visibleDocs`): past ones show on "Show past sessions"; needs-you always shows.
- The page never writes sessions. Renames: `POST /api/names` with the token (`skyborne-token` meta, then each `ready`'s).
- Approvals: live `asks` are "Needs you" cards above the tabs, oldest first, keyed by id, changed in place (only the clock
  ticks; no `setHTML`); A/D or the buttons `POST /api/answer` with the token. "Sent" until `answer.applied`; on `applied: false`
  or a 409 `terminal`, "Already answered in the terminal" for 3 s. Never show an answer as given early. Safe mode hides detail.
- The server keeps finished helpers; the page's `view()` lets them leave 30 s after they finish.
- Doc (v: 2): docs/EVENT_FORMAT.md. The page reads title, sessionName, headline, startedAt, updatedAt, turns, tokens, context,
  cost, rateLimits, waiting, ended, agents[], feed[]. A detail: /api/session, /api/step with the token (live), else the doc.
- District name: console name, else session name, else folder. Bots get random names (`BOT_NAMES`).

## Hard-won rules
- Everything is bundled (root rule "Local only"): `three` and `three/addons/...` come through the import
  map `build.js` writes (one THREE); fonts are `@font-face` rules with the family names the page uses. A new
  addon import is picked up by `build.js`; a new font needs its Fontsource package and a `FONTS` entry.
- No `ready` within 5 s: show "Can't reach Skyborne"; EventSource keeps retrying. Never fall back to fake data.
- Keep the pixel budget (`PIXEL_BUDGET`, `MAX_DPR`). Bake still meshes (`mergeStatic`); flag moving parts
  `userData.keep`. About 10 draw calls and one material per bot. CSS2D labels: toggle `object.visible`.
- Don't rebuild console HTML needlessly (`setHTML` cache), or clicks get lost.
- Canvas text that can grow (names, signs) is measured and shrunk to fit, like the gate sign in `03a-blocks.js`.
- Browser settings live under the `skyborne.` localStorage prefix (`store` in `01-core.js`); old `cyber.`
  keys are copied over once.

## Design decisions
- The name is Skyborne; top left reads "Skyborne". Author credit: the footer ("Skyborne by Mirza Ishraq" to my-space.io,
  "Follow on X", a GitHub button to the repo) and the reel's watermark (credit left, skyborne.dev right); not the loading screen.
- Districts are real sessions only (an off-by-default "Sample districts" setting exists). The city's UI text never
  says "demo" (the demo site is a separate build).
- Districts grow: park, café, shops, apartments, towers; six helper homes stand by a zebra crossing. Transit: monorail, hover cars, blimp (no
  sky bridges, trams or drones: too cluttered). Reel mode (R) is 9:16; "Safe to film" (S) hides prompts, files and names.
- UI text: every sentence, label and " · " fragment starts with a capital. Folder names and commands stay as written.
- Chrome is "Skyborne milk": milky panels #F4F3EF, graphite #1B1D22, one amber accent #E8A54B (#9A5B0C for
  text), Inter, hairlines; no neon, glow or all-caps. The reel overlay stays dark. The 3D keeps its own colours.
- Bots: faces, moods and moments live in `04-robot.js`. Event moments hold the bot (`moment.hold`).
  Blinks, glances and moments run only near the camera (`NEAR_FACE`).
- Don't edit this file unless the maintainer asks.
