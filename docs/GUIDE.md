# Skyborne guide

The details behind the [README](../README.md): installing, the city and its console, approving from
the city, recordings, what is stored, troubleshooting, settings and known issues.

## Platforms

Tested with Claude Code 2.1.288 and 2.1.289; the city needs a browser with WebGL (any current
Chrome, Edge, Firefox or Safari). Tested end to end with real Claude Code sessions on macOS. The test suite runs on macOS, Linux and
Windows; Claude Code itself has not been tried with Skyborne on Linux or Windows yet. On Windows
without Git Bash, Claude Code runs the permission hook in PowerShell, where approving from the city
hasn't been tried and `claude -p` runs may wait for the city's answer; the terminal's dialog works
either way.

## Install

Install Skyborne with `uv tool install skyborne` (the [README](../README.md#install) has the steps,
including how to get uv), then run `skyborne install`, which copies Skyborne's Claude Code plugin into `~/.claude/skills/skyborne`
(`$CLAUDE_CONFIG_DIR/skills/skyborne` if you set that), where Claude Code loads it as
`skyborne@skills-dir`. Sessions you start after that send their events to Skyborne; sessions already
open don't.

It then asks whether to also install Skyborne's status line, which the console's Usage and Context
numbers come from (cost, context use and rate limits). Saying yes backs up your `settings.json` to `~/.skyborne/backups/`, changes only its
`statusLine` key, and keeps showing your previous status line if you had one. `--statusline` and
`--no-statusline` answer without asking; `--port N` points the plugin, and the status line if you added
it, at another port (`--no-statusline` leaves an existing status line as it is).

After updating Skyborne, run `skyborne install` again so the plugin matches the new version
(`skyborne doctor` says when it's needed). Plugins from before approvals came in don't let the city
answer them.

## Using the city

The first time it starts, `skyborne` offers to import your sessions from the last 7 days, so the
city isn't empty. It reads the transcripts Claude Code already keeps; nothing leaves your computer.
The city shows live sessions: not ended, and heard from in the last 30 minutes (**Settings → Live
window** changes that). **Show past sessions** in the Sessions tab brings back the rest of the 60 most
recently active sessions, and a search box finds one by name or folder; this browser remembers the
choice. A session that is waiting for your approval always shows.

A district goes to sleep after 3 quiet minutes, unless a bot in it is mid-step: a long command (a build,
a video export) or a long think sends nothing until it ends, so that session stays awake and live for up
to 3 hours. An Esc ends the turn at once. A conversation you move to the background carries on in a new
session: the old district ends ("Continued in another session") and the new one counts only its own
tokens, not the copy of the conversation it starts with.

| Address | What it is |
| - | - |
| `http://127.0.0.1:7317/` | the city, with its console (below) |
| `http://127.0.0.1:7317/status` | a small text status page: recent sessions and what their lead is doing |
| `http://127.0.0.1:7317/events` | the live state of every session, as Server-Sent Events ([format](EVENT_FORMAT.md)) |
| `http://127.0.0.1:7317/health` | version, database path, event count, last event time |

Keys in the city: `R` reel mode (9:16, for filming), `S` safe to film (hides prompts, files and
project names), `T` time of day, `M` sound, `C` console, `F` full screen. On a "Needs you" card in
focus: `A` approve, `D` deny. In the console: `↑` `↓` move through a list, `Enter` opens, `Esc` goes back.

## The console

- **At the top**: **Needs you** (requests waiting for an answer), **Working**, **Usage** (the 5-hour
  limit's use on a Pro or Max plan; otherwise what the sessions active today would cost at API list
  prices, Claude Code's own estimate, which on a Pro, Max, Team or Enterprise plan isn't what you pay)
  and **Context** (the fullest live session's context window). Usage and Context come from Skyborne's
  status line and show "—" without it. Hover or click Usage for where the tokens went, by session and by agent.
- **Sessions**: what needs you first, then errors, then anything **Slow** (working, but no news for 2
  minutes: a long command, or Claude thinking), then the rest. Click a session (or press `Enter` on it)
  for its detail:
  - **Timeline**: one bar per tool call, as long as it ran and coloured by kind, the lead and each helper
    on rows of their own; quiet stretches over 2 minutes fold into a hatched break. Click a bar or a
    row in the step list for the call's full input, output and error (output over 20 KB was cut when
    stored, and says so).
  - **Conversation**: your prompts and Claude's final reply in each turn (text written between tool
    calls isn't recorded).
  - **Files changed**: each file Edit, MultiEdit, Write or NotebookEdit touched, with its edits (edits
    made through shell commands aren't counted).
  - **Approvals**: each request, the answer, where it was given and how long it waited.
  - **Tokens per agent**, each API message counted once.
  - Clicking a bot, in the city or on its chip, shows the same detail for that bot alone.
- **Logs**: every session's newest lines, filtered by kind (prompts, tools, errors, replies, helpers)
  and by session, with how long each tool call ran. Click a line for its step in the detail.
- **Settings**: your name on City Hall, the live window, desktop alerts, time of day, safe to film,
  sound, sample districts and playing a recording.
- **Safe to film** hides prompts, replies, commands, paths, file names and MCP tool names in every view.

## Approving from the city

When Claude Code asks permission to run a tool, a **Needs you** card appears at the top of the
console, oldest first: the session, the Skybot asking (lead or helper), the tool, the exact
command, file path or address, how long it has waited and how long until Skyborne leaves it to the
terminal. **Approve** or **Deny** answers Claude Code; a denied call is told "Denied from
Skyborne". The card says "Sent" until Claude Code confirms it applied your answer (its transcript
records that, within about a second), then closes. The dialog in the terminal shows at the same time
and still works: whichever you answer first wins, and the card clears. A click the terminal beat is
never shown as given: the card says "Already answered in the terminal", then closes. With several
pages open, the first click wins and the other pages' cards follow it. The amber beam from the bot to
City Hall turns green when you approve and red when you deny. In safe to film, the card shows only
"Bash command" or "File path"; **Show** reveals it.

- Skyborne never answers on its own. A request nobody answers from the city waits up to 10 minutes,
  then its card says "Answer in the terminal", where the dialog is still open. Change the wait with
  `{"approval_timeout_seconds": N}` (kept between 30 and 3600) in `~/.skyborne/config.json`, then run
  `skyborne install` again.
- A "No" typed in the terminal clears the card within a second. After a "Yes" typed in the terminal,
  the card clears when the tool finishes: Claude Code sends nothing earlier. A click on the card
  meanwhile has no effect: the card waits, then says "Already answered in the terminal".
- Questions Claude asks you (`AskUserQuestion`) and leaving plan mode (`ExitPlanMode`) need more than
  yes or no: their cards only say "Answer in the terminal".
- `claude -p` and Agent SDK runs have no one at a terminal, so Skyborne never holds their requests:
  they behave exactly as without Skyborne (except, untested, on Windows without Git Bash: see
  Platforms).
- There's no "always allow" in the city; use the terminal's own options for that.
- **Desktop alerts** (Settings, off by default; the browser asks your permission the first time) pop up
  when a new request needs you while the city's page isn't in front. They name the bot, the session and
  the tool, never the command; in safe to film they say only "A Skybot needs your approval".
- Every request that gets a card is logged when it ends: what was asked, the answer, where it was
  given (Skyborne or the terminal) and how long it waited. See [SECURITY.md](../SECURITY.md).

## Recordings

`skyborne record` writes one session to a file the city can play in place of live data
(**Settings → Recording → Play…**). It always takes out ids, keys and tokens, home folders, your
names and email, and real times; `--stand-ins` also replaces prompts, replies, file contents and tool
output. It won't write a file its final check finds anything in, and it lists every line of text the
page will show so you can read them first. See [RECORDING_FORMAT.md](RECORDING_FORMAT.md).

## When Skyborne isn't running

When Skyborne isn't running, Claude Code behaves as if it wasn't installed: each event is sent by
`curl` as a background hook, so nothing waits and nothing shows in the terminal. The one hook that
waits, the permission request, ends at once with no answer when Skyborne isn't there, and the
terminal's dialog works as usual. Events from that time are not recorded; token counts are filled in
from the session's transcripts when Skyborne starts again.

## Uninstalling

`skyborne uninstall` puts `settings.json` back byte for byte if you haven't changed it since. If you
have, it restores only the `statusLine` key and keeps your other changes. Then `uv tool uninstall
skyborne` removes the program itself. Your history stays in `~/.skyborne`; delete that folder too if you
want it gone, after `skyborne uninstall`, which needs what is in it.

## Troubleshooting

Start with `skyborne doctor`. It checks everything below that it can and says in plain words what to do.

- **The city is empty, or my session isn't in it.** Only sessions started *after* `skyborne install`
  send events, so start a new Claude Code session. Claude Code also runs hooks only after you accept
  its folder trust prompt. An old session may be hidden: see **Show past sessions** and the live window
  under [Using the city](#using-the-city).
- **`skyborne: command not found`** (on Windows, "not recognized"). Run `uv tool update-shell` and open a
  new terminal.
- **Port 7317 is taken.** Start with `skyborne --port 7400` (any free port), run
  `skyborne install --port 7400` so the plugin sends events to the same place, then start a new Claude
  Code session. `skyborne install --port` moves the status line to the new port as well, if you added it.
  From then on run `skyborne doctor --port 7400` too: without it, the doctor checks 7317. The city's
  address changes too (`http://127.0.0.1:7400/`), and its settings start fresh there.
- **No "Needs you" card appears when Claude asks permission, or the doctor says the plugin is from an
  older Skyborne.** Run `skyborne install` again, then start a new Claude Code session. Do this after
  every update (with `--port N` if you use another port), and after you change `approval_timeout_seconds`.
- **Doctor reports hooks or the plugin turned off.** Something in your Claude Code settings blocks them:
  `disableAllHooks`, `enabledPlugins` set to false for Skyborne, or (on managed machines)
  `allowManagedHooksOnly` or `strictKnownMarketplaces`. The doctor names which one. Skyborne
  doesn't change those for you. It reads only your own `settings.json` and the managed settings file,
  so a setting in a project's `.claude/settings.json` or `settings.local.json` that turns the plugin
  off won't show up in its output.
- **Usage and Context show "—".** They come from Skyborne's status line. If you haven't added it, run
  `skyborne install --statusline`. If you have, Context stays "—" until a live session has reported.
- **A card says "Answer in the terminal".** The request waited out its time (10 minutes by default),
  or it is a question or a plan, which need more than yes or no. The dialog is still open in the
  terminal.

If it's still wrong, [open an issue](https://github.com/ishraq21/skyborne/issues/new/choose) with the
doctor's output.

## Settings

Four places hold settings.

**`~/.skyborne/config.json`** (you create it; unknown keys are ignored):

| Key | Default | What it does |
| - | - | - |
| `retention_days` | `30` | Session data older than this many days is deleted. Must be a whole number above 0. |
| `approval_timeout_seconds` | `600` | How long a permission request waits for an answer from the city before it is left to the terminal. Kept between 30 and 3600. Run `skyborne install` after changing it. |

**Command-line options:**

| Option | Default | What it does |
| - | - | - |
| `skyborne --version` | — | Prints the installed Skyborne version and exits. |
| `skyborne --port N` | `7317` | The port the city listens on (`127.0.0.1` only). Give `skyborne install` and `skyborne doctor` the same `--port`. |
| `skyborne --no-open` | opens a browser | Starts without opening the city. |
| `skyborne --verbose` | off | Logs every event's name and short session id. |
| `skyborne import --days N` | `7` | How far back to look for past sessions. |

**In the city (Settings tab):** these are kept by your browser, for the address you opened (another browser,
or the city on another port, starts with the defaults): your name on City Hall, the live window (15
minutes, 30 minutes, 1 hour or 3 hours; 30 by default), desktop alerts, time of day, miniature lens, bot
name tags and safe to film. Sound, sample districts and playing a recording are not kept: a fresh page starts
without them.

**Environment variables**, for the unusual case. `SKYBORNE_HOME` moves Skyborne's whole folder (the
default is `~/.skyborne`), and `CLAUDE_CONFIG_DIR` points Skyborne at a different Claude Code folder, the
one Claude Code itself uses when it's set. Set them the same way for every `skyborne` command and for
Claude Code, or the pieces won't find each other.

## What is stored

Everything Claude Code sends to the hooks, in `~/.skyborne/skyborne.db` (SQLite): your prompts,
Claude's answers, every tool call's input, and tool output (cut to 20 KB per field). Also token counts
read from Claude Code's transcripts, each session's title from them, the latest status line per session,
the names you give districts,
how each permission request ended, and, if you import them, the same for past sessions. The folder is readable only by you. Data older than 30 days is deleted; change that with `{"retention_days": N}` in
`~/.skyborne/config.json`. See [SECURITY.md](../SECURITY.md).

## Known issues

- A bot stopped by Esc without Claude Code reporting it can stay awake (and its district live) for up
  to 3 hours. The lead's Esc is read from the transcript; a helper's stop has only been seen through its
  `SubagentStop` hook.
- Sessions brought in with `skyborne import` don't know about forks or hand-overs: an imported fork
  counts the copied conversation again, and its original doesn't show "Continued in another session".
  Live sessions do.

## Development notes

The built page in `skyborne/web/` is committed, so installing Skyborne needs no Node; CI checks it
matches its sources.

The reducer evals in [`tests/evals/`](../tests/evals/) replay recorded Claude Code events (scrubbed of
personal data) and compare the result with saved documents. [FINDINGS.md](FINDINGS.md)
records how Claude Code actually behaves, which this design is built on.
