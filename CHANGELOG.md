# Changelog

What changed in each release of Skyborne, loosely following
[Keep a Changelog](https://keepachangelog.com/). Each version here is a release on
[PyPI](https://pypi.org/project/skyborne/) and a page under
[GitHub Releases](https://github.com/ishraq21/skyborne/releases). From the next release on, that page's
notes are the version's section here.

## [Unreleased]

**City scale**
- Districts are about 1.4 times wider, with a wider two-lane road and more room between the desks. The whole city spreads out to match, and the camera's views pull back with it.
- Cars, shops, the café, apartments, towers and each district's HQ are now sized like a real city next to the Skybots:
  - a car is about as long as a Skybot is tall;
  - a Skybot fits through a door;
  - floors are taller.
- City Hall is bigger, and the hover cars fly higher, above the tallest towers.
- Cars on the same lane keep their distance instead of driving through each other.
- Sun shadows now follow the camera, so they also show on districts far from City Hall.
- A full city of 60 districts takes about a fifth fewer draw calls, so frames are smoother on most machines.

**Skybots walk around things**
- Skybots no longer walk through desks, the kiosk, the bench, trees or the HQ. They follow a path around them.
- Skybots no longer walk through each other. A walking bot steps aside for one ahead (both keep right). It never pushes into a bot that is standing still.
- No two bots are sent to stand in the same place:
  - each idle spot is held by one bot at a time;
  - helpers that arrive together beam in side by side around the pad;
  - finished helpers wait in their own spots by the pad;
  - helpers handing their results to the lead stand around it, not on top of each other.

**Console**
- The console has an × in its header that hides it, at every screen size. On a phone the toolbar icon that hides the console was easy to miss.

**Camera**
- Clicking a Skybot or a district, or "Back to the skyline", no longer swings the camera over the clouds on the way. It now keeps facing where it is flying.
- On a phone held upright, with the console open, the picture sits in the strip above the console sheet, so a Skybot you click is no longer hidden behind the sheet. This applies to every view while the console is open, not only a click on a Skybot. A phone held sideways is not fixed yet.

## [0.1.1] - 2026-10-07

**Version option**
- `skyborne --version` prints the installed Skyborne version and exits.

**Demo site**
- [skyborne.dev](https://skyborne.dev) plays a recorded session in the city, beside a few sample districts, with nothing to install. Its buttons are marked Demo and send nothing.
- On PyPI, the package's Homepage link now points there.

**Guide: troubleshooting and settings**
- A new Troubleshooting section covers the common problems (an empty city, a taken port, no "Needs you" card, Usage and Context showing "—"), starting with `skyborne doctor`.
- A new Settings section lists the `config.json` keys with their defaults, the command-line options, which city settings your browser keeps and the environment variables.
- The Install section points at `uv tool install skyborne`.

**Changing the port**
- `skyborne install --port N` now moves Skyborne's status line to the new port too. Before, it kept sending to the old port, so Usage and Context stayed empty.
- `skyborne doctor` warns when the status line and the port you check don't match.
- A leftover Skyborne status line is no longer saved as your "previous" one, which could make the status line start itself over and over after a reinstall.

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
