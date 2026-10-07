# Changelog

What changed in each release of Skyborne, loosely following
[Keep a Changelog](https://keepachangelog.com/). Each version here is a release on
[PyPI](https://pypi.org/project/skyborne/) and a page under
[GitHub Releases](https://github.com/ishraq21/skyborne/releases). From the next release on, that page's
notes are the version's section here.

## [Unreleased]

**Demo site**
- [skyborne.dev](https://skyborne.dev) plays a recorded session in the city, beside a few sample districts, with nothing to install. Its buttons are marked Demo and send nothing.
- The package's Homepage link points there from the next release.

**Guide: troubleshooting and settings**
- A new Troubleshooting section covers the common problems (an empty city, a taken port, no "Needs you" card, Usage and Context showing "—"), starting with `skyborne doctor`.
- A new Settings section lists the `config.json` keys with their defaults, the command-line options, which city settings your browser keeps and the environment variables.
- The Install section points at `uv tool install skyborne`.

**Changing the port**
- `skyborne install --port N` now moves Skyborne's status line to the new port too. Before, it kept sending to the old port, so Usage and Context stayed empty.
- `skyborne doctor` warns when the status line and the port you check don't match.

## [0.1.0] - 2026-10-07

First public release. See the [v0.1.0 release page](https://github.com/ishraq21/skyborne/releases/tag/v0.1.0).

**A 3D sky city for your Claude Code sessions**
- Each session is a floating district and each agent is a little robot, a Skybot, that acts out what it is doing.
- The city updates the moment Claude Code does something, and sessions are kept for 30 days.
- The first run offers to bring in the last 7 days of sessions.

**Approve or deny from the city**
- A "Needs you" card shows the exact command, file or address Claude is asking about, with Approve and Deny.
- Skyborne never answers on its own. The terminal's own prompt works at the same time, and whichever you answer first wins.
- Every answer is logged.

**A console beside the city**
- Sessions with a timeline of every step, the conversation, files changed, approvals and tokens per agent, plus a Logs view and Settings.
- Usage and Context come from an optional status line that `skyborne install` offers to add.

**Reel mode and Safe to film**
- A portrait, phone-shaped view for recording videos, and a switch that hides your prompts, files and project names.

**Everything stays on your computer**
- It listens on `127.0.0.1` only, makes no requests to the internet and has no telemetry.

**Install with uv**
- `uv tool install skyborne`, then `skyborne install` and `skyborne`. The commands `skyborne doctor`, `skyborne import` and `skyborne record` come with it.

**Known gap: tested end to end on macOS only**
- Linux and Windows pass the automated tests but haven't been tried with real Claude Code sessions, and the browser tests only run in Chromium, so Firefox and Safari are unchecked. Help is welcome: [Linux (#2)](https://github.com/ishraq21/skyborne/issues/2), [Windows (#3)](https://github.com/ishraq21/skyborne/issues/3), [Firefox and Safari (#4)](https://github.com/ishraq21/skyborne/issues/4).
- More known issues are in the [guide](https://github.com/ishraq21/skyborne/blob/main/docs/GUIDE.md#known-issues).
