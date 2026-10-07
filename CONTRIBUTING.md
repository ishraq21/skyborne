# Contributing to Skyborne

Thanks for helping. Skyborne is small and has firm limits, so please read the first section before
you write any code.

## What Skyborne is, and isn't

Skyborne watches **Claude Code** and nothing else. It is built on three promises, and a pull request
that breaks one of them won't be merged:

- **Claude Code only.** No support for other coding agents or runtimes.
- **Local only.** At runtime Skyborne makes no network requests off your computer. Everything it
  shows is bundled (the 3D engine, the fonts).
- **No telemetry, no cloud.** No accounts, no analytics, no "phone home", not even opt-in.

Before you start on a **new feature**, please [open an issue](https://github.com/ishraq21/skyborne/issues/new/choose)
and say what you'd like to build. It saves you from writing something that doesn't fit. Bug fixes,
documentation and test improvements don't need that first step.

## Set up

You need Python 3.11 or newer and Node 24 (Node is only for the page in `page/`).

```sh
git clone https://github.com/ishraq21/skyborne.git
cd skyborne
python3 -m venv .venv
```

On Windows, use `python` and `.venv\Scripts\` in place of `python3` and `.venv/bin/`. Then the
Development steps from the [README](README.md#development):

```sh
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -m pytest                        # unit tests, reducer evals, server, import, scrub and record tests
SKYBORNE_LIVE=1 .venv/bin/python -m pytest tests/live -s   # drives real Claude Code sessions (macOS/Linux)

cd page
npm ci && npx playwright install chromium         # once: three.js, the fonts and the test browser (Node 24)
node build.js                                     # builds the city into skyborne/web/ and dist/preview.html (commit both)
node dev/serve.js                                 # a preview with a fake city at http://127.0.0.1:8000/
node dev/icons.js                                 # remakes the tab icon's PNGs after a change to src/icons/icon.svg
node tests/smoke.js && node tests/live-smoke.js   # browser tests: the preview, then the real server
node build.js --site && node tests/site-smoke.js  # the demo site (page/site, not committed) and its test
```

Some of those lines are optional:

- The `SKYBORNE_LIVE=1` line starts real Claude Code sessions, which use your Claude usage. You
  don't need it for most changes; run it if you touch hooks, approvals or how sessions are read.
- On a fresh Linux machine, if the test browser won't start, use `npx playwright install
  --with-deps chromium` (this is what CI does).
- `node dev/serve.js` keeps running until you stop it (Ctrl+C). It's for looking at the city while
  you work.
- `node dev/icons.js` rewrites the committed icon PNGs. Run it only after changing `src/icons/icon.svg`.

## House rules

These come from [CLAUDE.md](CLAUDE.md), which is the full list.

- **Never get in Claude Code's way.** Hook endpoints answer within 50 ms with a `200` and an empty
  body (a held approval is the one exception). Errors are swallowed and logged. If Skyborne is down,
  Claude Code must behave as if it was never installed. No `MessageDisplay` hook.
- **Stay on your machine.** The server listens on `127.0.0.1` only, checks `Host` and `Origin` on
  every request, and needs the per-launch token for actions (approve, deny, rename). It never
  approves anything on its own, and every decision is logged.
- **Don't touch people's settings.** Hooks ship inside `plugin/`, not in `~/.claude/settings.json`.
  If a change must edit `settings.json`, it asks first, backs it up, touches only its own key and
  restores it on uninstall.
- **Server: Python standard library only.** Tests use pytest. Ask in an issue before adding any
  dependency, for either Python or Node.
- **Check, don't guess.** Before you use a Claude Code field, event or flag, look it up in the
  [Claude Code docs](https://code.claude.com/docs) or in a real recorded payload. If the docs and
  what Claude Code really does disagree, trust what it does and note it in
  [docs/FINDINGS.md](docs/FINDINGS.md).
- **No real session data in git.** Test fixtures are scrubbed first: `tests/fixtures/scrub.py` (built
  on `skyborne/scrub.py`) for recorded payloads and transcripts, `skyborne record --stand-ins` for
  recordings. Read what you're adding before you commit it.
- **Build, then commit the build.** After any change in `page/`, run `node build.js` and commit
  `skyborne/web/` and `page/dist/preview.html`. CI fails if either is out of date.
- **Docs move with the code.** If a change alters what Skyborne does, update the README and docs in
  the same pull request. Every claim in them should match real behaviour.
- **Build on what's there.** Change only what the task needs, and keep the city, the console, reel
  mode, Safe to film, sample districts and renaming working.

## Pull request checklist

The same list is in the pull request template, which also asks why you made the change, what changed
and how you tested it.

- [ ] It keeps the three promises: Claude Code only, local only, no telemetry or cloud.
- [ ] I opened an issue first if this is a new feature.
- [ ] I added or updated tests, and `python -m pytest` passes.
- [ ] If I changed `page/`, I ran `node build.js`, committed `skyborne/web/` and
      `page/dist/preview.html`, and `node tests/smoke.js && node tests/live-smoke.js` pass.
- [ ] I checked the city, the console, reel mode, Safe to film, sample districts and renaming still work.
- [ ] I updated the README and docs where behaviour changed.
- [ ] I added a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) if users would notice the
      change. Plain words, written for someone using Skyborne; the maintainer tidies the wording at release.
- [ ] I checked any Claude Code field or event I used against the docs or a real payload.
- [ ] No real session data, secrets or personal paths are in the diff.

CI runs the tests on Linux, macOS and Windows (Python 3.11 to 3.13) plus the page build and browser
tests. On a pull request the browser tests (slow, about 5 to 11 minutes) run only the ones the change needs
(the page, or the server and recorded sessions, or the CI workflow itself); pushes to `main` and releases
always run them all. It needs to be green before a merge.

## Contributions made with Claude Code

Welcome. Claude Code reads `CLAUDE.md` in this repo on its own, so it already knows these rules.
You're still the author: read and understand every line it wrote, run the checks yourself and say in
the pull request that Claude Code helped.

## Security problems

Please don't open a public issue for a security problem. Report it privately, as described in
[SECURITY.md](SECURITY.md).

## License

Skyborne is under the [Apache License 2.0](LICENSE). When you send a contribution, you agree it is
licensed under the same terms (section 5 of the license). The name Skyborne and the Skybot logo are
trademarks; see [TRADEMARK.md](TRADEMARK.md).

By taking part you also agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
