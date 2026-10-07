# Recording format

A recording is one Claude Code session, scrubbed, in a single JSON file the city page can play in
place of live data. `skyborne record` makes it:

```sh
skyborne record <session id, or its start> --out demo.json [--stand-ins]
```

Without a session id it lists the most recent sessions. Open the city, go to **Settings →
Recording → Play…** and pick the file; it plays on a loop until **Back to live**. A page can also
play one at load with `?play=<a file on the same server>`. The demo site's recording
(`page/demo/recording.json`, made by `scripts/make_demo_recording.py`) is built into its page instead.

## What's taken out

Always, by `skyborne/scrub.py`:

- **Ids**: session, prompt and message ids, tool call ids and helper ids become stable fakes
  (`00000000-0000-4000-8000-000000000001`, `toolu_000…01`, `a000…01`), the same real id always the
  same fake, so events stay linked.
- **Secrets**: private-key blocks; keys and tokens with a known prefix (`sk-ant-`, `sk-`, `ghp_`,
  `github_pat_`, `xox…-`, `AKIA`, `AIza`, `glpat-`, `npm_`); JWTs; bearer tokens; the value of
  anything named like a secret, whatever it looks like (`DB_PASSWORD=…`, `"token": "…"`, a quoted
  phrase after `--password`, or a `password` or `apiKey` field); and long random-looking strings.
  Each becomes `[secret]`.
- **You and your computer**: your home folder in every form a path takes (`/Users/you`,
  `C:\Users\you`, JSON-escaped, URL-encoded, and the `-Users-you-` form Claude Code uses for project
  folders) becomes `/home/user`; any other home folder too; your login name, full name, git name and
  email, and the computer's name; every email address becomes `user@example.com`.
- **Real times**: every time is counted in milliseconds from the session's start. The status line's
  rate limits (which carry real reset times) are left out; only its model, cost and context stay.

With `--stand-ins`, also what was said and made:

- prompts become "Prompt 1", "Prompt 2"…; Claude's replies and helpers' final answers "Answer 1"…;
- each tool call keeps only what the city shows of it (a command, a file's name, a search pattern,
  a web search, a helper's type); everything else in its input goes, including file contents, edits,
  plans, questions and helper briefs;
- tool output becomes "(Output hidden)" (an Agent call keeps only the ids that link its helper);
  error text, even a long one stored cut, "(Error hidden)"; a compaction's summary "(Summary hidden)";
  helper descriptions, also in a turn's list of helpers still running, "Helper task 1"…; helper
  reports "(Report hidden)";
- the project folder becomes `/home/user/project` everywhere, inside paths and commands too (the
  scratchpad folder with it), and the session's name "Project".

Then the whole file is searched again for anything personal or secret (the same rules, plus your
names and home folder in any letter case). One hit and nothing is written. The command prints what
it replaced and every line of text the page will show, so you can read them before sharing.

What scrubbing can't know: a secret with no recognisable shape (a short password typed in a prompt,
say) or a private fact in plain words. Use `--stand-ins` for anything you share, and read the list.

## The file

```json
{
  "format": "skyborne-recording",
  "version": 1,
  "createdWith": "skyborne 0.1.0",
  "standIns": true,
  "report": {"ids": 20, "home paths": 3, "secrets": 1, "stand-ins": 22},
  "session": {"id": "00000000-0000-4000-8000-000000000001", "title": "project"},
  "duration": 43980,
  "events": [{"t": 0, "payload": { ...a hook event, as stored... }}],
  "facts": [{"t": 1520, "kind": "usage", "message_id": "msg_…", "agent": "main", "model": "…", "final": true, "usage": {"in": 3, "out": 120, "cw": 0, "cr": 22000}}],
  "frames": [{"t": 0, "doc": { ...the session document at that moment... }}]
}
```

| Field | Meaning |
| - | - |
| `events` | the session's hook events (and imported ones), scrubbed, each with `t`: ms from the start |
| `facts` | what the transcripts and status line added: `usage`, error `tool_result`, `statusline` (model, cost, context only), with `t` |
| `frames` | the session document ([EVENT_FORMAT.md](EVENT_FORMAT.md)) each time it changed, at most one every 200 ms, rebuilt from the scrubbed events and facts by Skyborne's reducer; feed cut to the newest 50 items, no `rateLimits`. Its times (`startedAt`, `updatedAt`, `waiting.since`, `agents[].activitySince`, `feed[].ts`, `ended.at`) count from the start too |
| `duration` | the last frame's `t` |

A frame may carry `id` to play several sessions from one file; without it, a frame belongs to
`session.id`. The page plays frames on their `t`, moving their times to the moment it started
playing, and starts again 5 seconds after the last one.
