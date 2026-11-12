# Findings: how Claude Code behaves

What Skyborne is built on, and the evidence for it. Observed with Claude Code 2.1.288 on macOS (arm64) in
October 2026, and checked against the official docs at code.claude.com/docs on 2026-10-02. When the docs
and what we observed disagree, the observation wins and is recorded here.

**How the evidence was collected.** A throwaway standard-library Python server listened on `127.0.0.1`
and appended every POST it received, with a receive time in milliseconds. Project hooks sent all 14 events
under test to it as `type: "http"` hooks, plus the status line. A small driver ran real interactive
`claude` sessions in a pseudo-terminal (a fake terminal window a script can read) and recorded the moment a
permission dialog appeared on screen, so terminal and server times share one clock. Five sessions ran
(Haiku 4.5, plus Sonnet for the auto-mode test), each with a debug log.

**Words used here.** *Hook*: a call Claude Code makes at a fixed moment (before a tool runs, when a turn
ends, and so on). *Transcript*: the `.jsonl` file (one JSON object per line) where Claude Code saves a
session. *Helper*: a subagent started with the Agent tool. *Approval*: the "Do you want to proceed?"
permission dialog.

---

## Answers at a glance

| # | Question | Answer (observed unless marked) |
| - | - | - |
| 1 | Approval timing | The terminal dialog appears **at once** (0.07–0.14 s after the hook starts), in parallel with the hook. A hook "allow" or "deny" closes the dialog within 0.1 s. Answering in the terminal first wins. A terminal **No** hangs up on the hook (and stops a command hook); a terminal **Yes** does not. |
| 2 | Helper matching | **Exact.** `SubagentStart` has only `agent_id`, but three other records tie that id to the launching `tool_use_id`. Helper transcripts live in `<session>/subagents/agent-<id>.jsonl` with a `.meta.json` sidecar that names the `toolUseId`. |
| 3 | Durations | `PostToolUse` and `PostToolUseFailure` carry `duration_ms` (run time only, approval wait excluded). |
| 4 | Tokens | `message.usage` on `assistant` lines. **One API message is split over 2–3 lines** with the usage repeated, so summing every line roughly doubles the count (889,376 vs 426,143). Count each `message.id` once, from its last line. Helper usage lives only in the helper transcripts. |
| 5 | Status line | 17 fields, including `cost`, `context_window` and `rate_limits`. Event-driven: about every 2 s while busy, and **silent while a dialog waits** (79 s gap seen). |
| 6 | Claude's replies | Three places, identical text: `Stop.last_assistant_message`, `MessageDisplay` (live, line batches), and the transcript's `text` blocks. |
| 7 | WSL | A Windows browser can open a page served on `127.0.0.1` inside WSL by default (Microsoft's docs; **not tested**). Run the server inside WSL, next to Claude Code. |

Two surprises that shape the design:
- **HTTP hooks are refused for `SessionStart`** (and `Setup`). The debug log says `Skipping HTTP hook … —
  HTTP hooks are not supported for SessionStart`; the docs agree. A command hook works. All other events
  worked over HTTP.
- **A terminal "No" fires no hook at all**: no PostToolUse, no PostToolUseFailure, no PermissionDenied, no
  Stop. The transcript does get a `tool_result` with `is_error: true` for that `tool_use_id`, which is how
  Skyborne clears a "needs you" state.

---

## 1. Approval timing

Claude Code opens the terminal dialog at once and runs the PermissionRequest hook alongside it. It does not
wait for the hook. If the hook returns a decision, Claude Code applies it and closes the dialog. If the hook
returns nothing or times out, the dialog stays up for the person. Whoever answers first wins.

Evidence (seconds on one clock; `hook` = received by the server, `terminal` = seen on screen):

1a. Hook timeout 5 s, server holds 60 s with no answer:
```
220.26  hook      PreToolUse Bash
220.27  hook      PermissionRequest Bash            (server starts holding)
220.41  terminal  permission dialog APPEARS          ← +0.14 s, hook still running
225.28  server    Claude Code hung up after 5005 ms  ← the 5 s timeout
226.28  hook      Notification permission_prompt     ← ~6 s after the dialog
241.56  keys      Enter (Yes, typed in the terminal)
241.65  hook      PostToolUse Bash duration_ms=82
```

1b. Hook timeout 90 s, server holds 60 s, then answers 200 with an empty body:
```
  2.71  hook      PermissionRequest Bash
  2.78  terminal  permission dialog APPEARS          ← +0.07 s: not waiting for the hook
  8.72  hook      Notification permission_prompt
 62.80  server    replied (no decision) after 60088 ms; dialog stays up
 81.40  keys      '3' (No, typed in the terminal)
 81.47  terminal  dialog gone — and no hook of any kind follows
```

1c. Hook answers "allow" after 10 s:
```
 99.60  hook      PermissionRequest Bash
 99.73  terminal  permission dialog APPEARS
109.67  server    replied {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
109.75  hook      PostToolUse Bash duration_ms=73
109.77  terminal  dialog gone                        ← closed by the hook's answer
```
The transcript line under the tool reads `Allowed by PermissionRequest hook`.

1d. Yes in the terminal first, server would answer "allow" at 30 s:
```
125.58  hook      PermissionRequest Bash
125.59  terminal  permission dialog APPEARS
128.72  keys      '1' (Yes)
128.75  hook      PostToolUse Bash duration_ms=23     ← ran at once
155.65  server    late "allow" delivered after 30067 ms; Claude Code had kept the connection open; no effect
```

1e. No in the terminal first, server would answer "allow" at 15 s:
```
175.79  hook      PermissionRequest Bash
175.90  terminal  permission dialog APPEARS
178.99  keys      '3' (No)
179.02  terminal  dialog gone
179.02  server    Claude Code hung up after 3231 ms  ← the hook is cancelled on No
```
The file the command would have created never appeared, so a late "allow" can't overrule the person's No.

1f. Hook answers "deny" after 5 s:
```
  2.63  hook      PermissionRequest Bash
  2.70  terminal  permission dialog APPEARS
  7.69  server    replied {"decision":{"behavior":"deny","message":"Denied by the capture server"}}
  7.76  terminal  dialog gone
```
Claude saw the deny message and `Denied by PermissionRequest hook`. No PostToolUseFailure or
PermissionDenied followed.

Other facts from the same runs:
- `PermissionRequest` has **no `tool_use_id`** (the docs said so then; they list one now, but Claude Code
  2.1.289 still sends none: see "Answering approvals from Skyborne"). It arrived 7–17 ms after its
  `PreToolUse` (7 cases), with the same `tool_input`. Match it by session, agent, `tool_name` and
  `tool_input`, taking the most recent unanswered PreToolUse.
- It carries `permission_suggestions` (for example `setMode acceptEdits`, `addDirectories`).
- `Notification` `permission_prompt` came 5.87–5.94 s after the dialog every time. The docs say it waits
  about 6 s and resets while you type, so it is not a reliable "waiting" signal; PermissionRequest is.
- The status line did **not** run while a dialog waited (one run at 2.54 s, the next at 81.43 s).
- `PermissionDenied` fires **only in auto mode** when the classifier refuses. It came 0.98 s after
  PreToolUse, with `tool_use_id` and a `reason`, and no PermissionRequest at all. Haiku 4.5 can't run auto
  mode. Simple file writes in the project skip the classifier.

Clearing a "needs you" state:
- The hook said allow or deny → the hook's owner made the decision, so it knows.
- The person said **No** in the terminal → the hook's HTTP connection closes (1e) and the transcript gets an
  error `tool_result` for that call. No other event fires.
- The person said **Yes** in the terminal → `PostToolUse` or `PostToolUseFailure` arrives (1d).
- The hook timed out → the dialog stays in the terminal.

## 2. Helper matching

`SubagentStart` carries only `agent_id` and `agent_type`: no tool call id, description or prompt. Three
other records link that `agent_id` to the Agent call's `tool_use_id`:
1. `PostToolUse` for the Agent call: `tool_response.agentId` equals `SubagentStart.agent_id`. It arrived
   0–20 ms after SubagentStart.
2. The helper's sidecar `subagents/agent-<id>.meta.json` holds `toolUseId`, `agentType` and `description`.
3. When a background helper finishes, Claude Code feeds a `<task-notification>` back in as a **new prompt**
   (`UserPromptSubmit`). It contains `<task-id>` (the agent id), `<tool-use-id>`, `<status>` and `<usage>`.

Evidence (two Explore helpers launched in one message; ids replaced by placeholders):
```
5.43  PreToolUse   Agent tool_use=T1 {"description":"count alpha lines", "subagent_type":"Explore"}
5.44  SubagentStart      agent_id=A1 type=Explore
5.46  PostToolUse  Agent tool_use=T1 resp={"isAsync":true,"status":"async_launched","agentId":"A1", ...}
5.87  PreToolUse   Agent tool_use=T2 {"description":"find beta word", "subagent_type":"Explore"}
5.88  SubagentStart      agent_id=A2 type=Explore
5.88  PostToolUse  Agent tool_use=T2 resp={... "agentId":"A2" ...}
7.32  PreToolUse   Read  agent_id=A1 type=Explore      ← a helper's own calls carry agent_id
8.75  SubagentStop agent_id=A1 last_assistant_message='4'
8.78  UserPromptSubmit "<task-notification><task-id>A1</task-id><tool-use-id>T1</tool-use-id>…"
```
The sidecar: `{"agentType":"Explore","description":"count alpha lines","toolUseId":"T1","spawnDepth":1,
"requestShape":"background","requestNonInteractive":true}`

Things to handle:
- **Helpers run in the background by default.** The Agent call returns at launch (`status:
  "async_launched"`, `duration_ms: 3`, no usage). Completion arrives later, as `SubagentStop` plus the
  task-notification prompt. A helper is done at SubagentStop, never at the Agent call's return.
- `Stop` can fire while helpers still run. `Stop.background_tasks` lists them, so "turn ended" doesn't mean
  "session idle".
- **Internal agents**: 11 extra `SubagentStop` events across five runs had an empty `agent_type`, no
  SubagentStart before them, and transcript paths that don't exist. The docs say these are Claude Code's own
  agents. Ignore any SubagentStop without a matching SubagentStart.
- Task notifications show up as `UserPromptSubmit` events that the person never typed. Their transcript
  lines carry `"origin": {"kind": "task-notification"}`. They are not turns.

A helper transcript holds one `user` line (the prompt the lead wrote), about 12 `attachment` lines, then
`assistant` and `user` lines like the main transcript, each with `"isSidechain": true` and `"agentId"`. It
has its own `message.usage` and `model`. The final text is also in `SubagentStop.last_assistant_message`,
along with `agent_transcript_path`.

## 3. Durations

`PostToolUse` and `PostToolUseFailure` carry `duration_ms`: the tool's own run time, excluding approval
waits and PreToolUse hooks. The docs mark it optional, so keep Pre→Post timing by `tool_use_id` as a fallback.

| Call | `duration_ms` | PreToolUse → PostToolUse | Why they differ |
| - | - | - | - |
| `touch a.txt` (approved after a wait) | 82 | 21.39 s | 21 s waiting on the dialog |
| `sleep 2 && echo slept` | 2069 | 2.08 s | no approval needed |
| `ls /nonexistent-dir` (failed) | 25 (on PostToolUseFailure) | 0.56 s | 0.5 s auto-allow by the server |
| Agent launch | 3 | 0.01 s | background launch returns at once |

`PostToolUseFailure` also had `error: "Exit code 1\nls: /nonexistent-dir: No such file or directory"` and
`is_interrupt: false`.

## 4. Tokens

- **Where**: `message.usage` on `type: "assistant"` lines (`input_tokens`, `output_tokens`,
  `cache_creation_input_tokens`, `cache_read_input_tokens`, plus `model`).
- **Double counting**: Claude Code writes one line per content block (`thinking`, `text`, `tool_use`), all
  with the same `message.id`, and every line repeats the usage. Earlier lines have a partial
  `output_tokens` and (in the spike's runs) `stop_reason: null`; only the last line has the final
  numbers. **Count each `message.id` once, from its last line.** (A week later nearly every line
  carried the final `stop_reason`; see "Transcripts as `skyborne import` finds them".)
- **Helpers**: their usage is only in their own `subagents/agent-<id>.jsonl`.
- **The ledger is larger**: Claude Code's own cost ledger counts requests that never appear as assistant
  lines (the `/compact` summary, internal agents). Use the status line's `cost.total_cost_usd` for cost and
  label the two measures separately.

Evidence (one session's transcripts):
```
main transcript: 21 assistant lines, 10 distinct message.id, all 10 span >1 line
  tokens if you sum every assistant line: 889,376   counting each message.id once: 426,143
one helper: 6 lines, 3 messages
  tokens if you sum every line: 79,461               counting each message.id once: 39,930
```
Helper totals in the main session's records are **not** run totals: a task notification said
`<subagent_tokens>13807</subagent_tokens>` while that helper's transcript sums to 25,827 counted once per
message. The docs agree that this number "isn't a total across the whole run".

At exit the main transcript gets a `cost-state` line with `totalCostUSD` and per-model `modelUsage`. In
the run above it summed to 784,229 tokens versus 517,687 from main plus helpers counted once per message;
the last status line showed the same cost as the ledger.

## 5. Status line

The JSON has 17 top-level fields: `model`, `cwd`, `workspace`, `cost`, `context_window`, `rate_limits`,
`prompt_cache`, `session_name`, `session_id`, `prompt_id`, `transcript_path`, `scratchpad_dir`, `thinking`,
`fast_mode`, `version`, `output_style` and `exceeds_200k_tokens`.
- `rate_limits.five_hour` and `seven_day` were missing on the first run of every session and present
  afterwards (the docs: only after the first API response, and only for Pro/Max plans).
- `context_window` is `null` at first and reads all zeros right after `/compact`.
- It runs only on events (new assistant message, `/compact`, permission-mode change…), debounced 300 ms:
  20 runs in 119 s in a busy session, and **not once in the 79 s a dialog waited**. It can't serve as a
  heartbeat.
- `subagentStatusLine` ran every 5.0 s while helpers were listed, with `tasks[]` (`id`, `type`, `status`,
  `tokenCount`).
- **A plugin cannot set `statusLine`**: only `agent` and `subagentStatusLine` take effect from a plugin's
  settings (docs). Installing a status line means editing the user's `settings.json`.

## 6. Claude's replies

The assistant's text is in three places, and they matched exactly in every turn:
1. `Stop.last_assistant_message`: the final text of each turn. It doesn't fire when the person interrupts.
2. `MessageDisplay`: text in whole-line batches **while it streams** (one long reply came as 29 batches over
   6.1 s). Claude Code holds each batch until the hook returns, so a slow hook freezes the person's
   terminal. Skyborne does not use it.
3. The transcript: `text` blocks on assistant lines. The full history, including text between tool calls.

## 7. WSL (documented, not tested)

WSL 2's default NAT mode forwards `localhost`: a Windows browser can open a server bound to `127.0.0.1`
inside WSL. In mirrored mode both sides share `127.0.0.1`. The reverse fails in NAT mode: WSL can't reach a
Windows server on `localhost`. So if Claude Code runs in WSL, the Skyborne server must run inside WSL too.
Bind `127.0.0.1` (IPv4; `localhost` may resolve to `::1`). Sources: Microsoft Learn, "Accessing network
applications with WSL" and "Advanced settings configuration in WSL".

---

## Setup notes
- **Turn a skills-folder plugin off for one folder** with `"enabledPlugins": {"<name>@skills-dir": false}`
  in that folder's `.claude/settings.local.json`. Verified through the debug log.
- **Sessions started from inside another Claude Code session inherit `CLAUDE_CODE_CHILD_SESSION`, which
  turns transcript saving off.** The screen says "Transcript saving is off". Tests that start Claude Code
  strip it.
- **Hook settings reload live**: a hook added to `settings.local.json` mid-session fired at that session's end.
- `--settings <file>` adds one-off settings without touching the user's `settings.json`.
- Workspace trust holds hooks back until the person accepts the folder-trust dialog (docs).

## Why hooks and transcripts, not an in-process mod
An earlier prototype used Claude Code's in-process mod API and sent clipped snapshots to a hosted database.
Its collection ideas were sound (per-turn usage from the engine, exact helper ids), but it summarised instead
of reporting raw events, had no history to backfill from, and relied on Claude Code's newest, least
documented surface. Skyborne uses documented HTTP hooks, a command hook for SessionStart, the status line and
the transcripts instead, shipped as a plugin so nobody's `settings.json` gets hooks written into it.

## Approvals: hook, not channel
Use the `PermissionRequest` hook (proven end to end in section 1): the dialog shows in parallel, a hook
"allow" or "deny" closes it, terminal answers still win, and if Skyborne is down the person answers in the
terminal as usual. Channels relay the same prompt but are a research preview that needs a flag on every
launch. Skyborne answers approvals this way, through a waiting `curl` command hook (see
"Answering approvals from Skyborne" below): the card shows at once and clears when the page answers, the
hook connection closes, a matching PostToolUse/PostToolUseFailure arrives, the transcript shows a refusal
or the session ends; never auto-allow; allow only on a click.

## Lessons from studying a similar open-source visualiser
1. **Read real usage; don't estimate** tokens from characters. Count `message.usage` once per `message.id`.
2. **A helper is done at `SubagentStop`**, not when the Agent call returns (background launches return at once).
3. **Approvals come from `PermissionRequest`**, never from a timer guess.
4. **Never edit other tools' hook entries.** Ship hooks as a plugin. If settings must be touched, match only
   our own marker, back up first, and write atomically.
5. **Encode folders exactly like Claude Code** (realpath, then every non-alphanumeric character to `-`,
   case-insensitive on Windows), and test Windows paths in CI.
6. **Backfill from transcripts** when the server starts or the page opens mid-session.
7. **Keep a model history per agent and ignore `<synthetic>`**.
8. **Find helpers by their transcript path and sidecar**, not by assuming a folder (worktree-isolated helpers
   write elsewhere). `SubagentStop.agent_transcript_path` gives the real path.
9. **Clear per-session state when a session ends.**
10. **Keep hook handlers fast and non-blocking.**

## When the server is down (observed 2026-10-02)
The docs call an HTTP hook's connection failure a "non-blocking error". In practice the person sees it: with
nothing listening on the hook's port, a short session printed these in the **normal** terminal view:
```
UserPromptSubmit hook error   connect ECONNREFUSED 127.0.0.1:7317
PreToolUse:Read hook error    connect ECONNREFUSED 127.0.0.1:7317
PostToolUse:Read hook error   connect ECONNREFUSED 127.0.0.1:7317
Stop hook error occurred · ctrl+o to see
```
The same session with exec-form `curl` command hooks marked `"async": true` showed nothing in the normal
view; the Ctrl+O view listed `Async hook UserPromptSubmit completed, Async hook PreToolUse completed, …`.
The debug log showed each one handed to a background process. So Skyborne posts events with background
`curl` hooks: if Skyborne isn't running, Claude Code looks as if it was never installed. The cost: each event
is its own process, so two events a few milliseconds apart (a tool's PreToolUse and PostToolUse were 16 ms
apart) can reach the server in either order, and Skyborne matches events by their ids, not arrival order.

## From Skyborne's own live tests (2026-10-02, Claude Code 2.1.288, Haiku 4.5)
A real session with the background-curl plugin, in default permission mode:
- Every event arrived, including `SessionEnd`: the background `curl` still delivers it as the session
  exits.
- The "needs you" state reached the live stream no later than the dialog appeared on screen. After
  "Yes" it cleared in 0.22 s (PostToolUse); after a "No" typed in the terminal it cleared in 0.41 s,
  from the transcript's `tool_result` (`is_error: true`, `toolUseResult: "User rejected tool use"`).
  No `Stop` followed the "No".
- **A permission request from inside a helper** carries the helper's `agent_id`. In default mode
  two Explore helpers each asked to run `wc`/`grep` through Bash, and both showed as waiting.
- With Claude Code 2.1.322, a helper told to use only Read still asked to run `find` on a full path
  written with escaped shell characters (`Coding\ \&\ Development`), while a plain `find . -name beta.txt`
  ran without asking. The live test now denies any request that comes up in its helper step.
- With Skyborne stopped mid-session, the session carried on and nothing showed in the terminal.
  After a restart, the turns from before came back from the database and the answer given meanwhile
  came back from the transcript.
- Token totals rebuilt from the database matched a hand count of the transcript exactly.
- For tests: a `claude` started with a fresh, empty `CLAUDE_CONFIG_DIR` stops at the first-run
  setup (not signed in), and its hooks are skipped ("workspace trust not accepted").

## A synchronous PermissionRequest command hook (observed 2026-10-03, Claude Code 2.1.288, Haiku 4.5)
Checked before Skyborne answered approvals: can PermissionRequest wait for an answer while every
other hook stays a background `curl`? The docs say `async` is set per hook handler, so a plugin can mix the
two, and a blocking command hook decides by printing
`{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` and exiting 0.
They don't say whether the dialog waits for a blocking *command* hook. `tests/live/test_permission_hook.py`
ran one plugin with 14 background curls (to a port nothing listened on) plus a blocking PermissionRequest
script, in default permission mode:

| Case | What happened |
| - | - |
| Hook holds 20 s with no answer | The dialog appeared **0.05 s** after the hook started: it doesn't wait. "Yes" typed in the terminal ran the command 0.1 s later. **The hook process kept running** to its own end; Claude Code didn't stop it. |
| Hook prints "allow" after 5 s | The dialog showed meanwhile; the command ran 5.13 s after the hook started, with no key pressed. |
| Hook exits 0 at once with no output (Skyborne down) | The dialog showed as usual; nothing else appeared in the normal view. |
| `claude --resume <id>` | The resumed session kept its session id (the docs' `--fork-session` "create a new session ID instead of reusing the original" agrees). |

So Skyborne can use a blocking, always-exit-0 forwarder for PermissionRequest alone. Because a terminal answer
doesn't stop the hook, the server must release a held request itself when the matching PostToolUse or
PostToolUseFailure arrives, or the transcript shows the call was refused. The background curls to a closed
port showed nothing in the normal view; the debug log lists them as `error: status code 7`.

Also seen: the terminal can draw the dialog without spaces (`Doyouwanttoproceed?`) because it moves the
cursor instead of printing them, so screen checks ignore spacing.

## Answering approvals from Skyborne (observed 2026-10-03, Claude Code 2.1.289, Haiku 4.5)
Skyborne ships one waiting hook: `PermissionRequest` runs `curl -sf -m 600 … /permission; exit 0` through a
shell (hook `timeout` 600); every other hook stays a background `curl`. `test_the_shipped_permission_hook`
in `tests/live/test_permission_hook.py` ran that exact plugin against a stand-in server that held,
answered or refused each request as told:

| Case | What happened |
| - | - |
| Held, then **No** typed in the terminal | The hook's connection closed **0.07 s** after the key; no hook process was left running; nothing showed in the normal view. |
| The server sends "allow" 3 s after that No | It never got through (the hook was gone), and the command did **not** run. |
| The server answers "deny" with a message after 2 s | The dialog closed; Claude's reply quoted "Denied from Skyborne". Only `Stop` followed (no PostToolUse, PostToolUseFailure or PermissionDenied). |
| Held, **Yes** typed in the terminal on a 20 s foreground command | The hook stayed connected; the only things before the tool finished 20.1 s later were one status line run (0.04 s after the key) and nothing in the transcript. PostToolUse came as the tool finished. |
| Hook `timeout: 10`, no answer | Claude Code closed the hook at 10.04 s; nothing showed; the dialog stayed and "Yes" still ran the command. |
| Server answers 404 (an older Skyborne), or nothing listens | The dialog worked as usual; nothing showed in the normal view (`-f` keeps the 404 page off stdout, `exit 0` keeps the exit clean). |
| `AskUserQuestion`, `ExitPlanMode` | Both fire PermissionRequest (input `questions`; `plan` and `planFilePath`). Answered at once with an empty body, the question and the plan dialog showed as usual. |
| `claude -p` | PermissionRequest fires there too, and the run **waits** for a held hook (52.8 s against a 45 s hold, then refused as usual). |
| Held, **Yes** typed in the terminal on a 12 s command, then "deny" sent 3 s later | The deny reached the hook and changed nothing: the command finished, Claude never saw "Denied from Skyborne", and no `hook_permission_decision` line was written (`test_a_late_answer_after_a_yes`). |

What Skyborne does with this:
- A "No" in the terminal clears the card through the closed connection (and the transcript); a "Yes"
  clears it only when the tool finishes, because Claude Code sends nothing earlier. The status line
  run right after the key isn't used: it's optional and runs for many other reasons.
- **The hook passes on `$CLAUDE_CODE_ENTRYPOINT`**: it was `cli` in an interactive session and `sdk-cli`
  in `claude -p` (`test_print_mode_is_told_apart`; transcripts carry the same value as `entrypoint`).
  Requests from `sdk-*` are never held, so scripts aren't kept waiting.
- **When Claude Code applies a hook's answer, the transcript says so**: an `attachment` line
  `{"type": "hook_permission_decision", "decision": "allow" | "deny", "toolUseID": …, "hookEvent":
  "PermissionRequest"}`, written before the call's result (here 2.51 s after the request, with the
  deny's `tool_result` at the same moment: `is_error: true`, `toolDenialKind: "permission-rule"`). No
  such line is written for an answer typed in the terminal. Skyborne's decision log uses it to confirm
  an answer from the page took effect.
- **The docs list `tool_use_id` on PermissionRequest; Claude Code 2.1.289 sends none** (the request's
  keys: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode`,
  `effort`, `hook_event_name`, `tool_name`, `tool_input`, `permission_suggestions`). Skyborne matches by
  session, agent, tool and input, and uses `tool_use_id` if it ever comes.
- Haiku ran `sleep 20` with `run_in_background: true` on its own, so that call returned at once; the
  foreground case asked for it explicitly.

Then Skyborne itself, end to end (`tests/live/test_live_approvals.py`: the real server and plugin, answers
sent the way the page sends them):

| Case | Result |
| - | - |
| Approve from Skyborne | The card showed 2.6 s after the prompt (the dialog too); the command ran 0.12 s after the answer. |
| Deny from Skyborne | The command didn't run; Claude's reply quoted "Denied from Skyborne". |
| Yes typed in the terminal first | The card cleared 0.13 s after the key; a later answer from the page got `409`. |
| No typed in the terminal first | The card cleared 0.19 s after the key; a later "allow" from the page got `409`; the command didn't run. |
| A helper asks (general-purpose, in the background) | The request carried the helper's `agent_id`; its card named the helper; approving it ran the command. Its `hook_permission_decision` line is in the **helper's own transcript** (`subagents/agent-<id>.jsonl`), which Skyborne reads to confirm the answer. |
| `claude -p` | Not held: 7.8 s, refused as without Skyborne. |
| Skyborne stopped | The dialog showed, nothing else did, and "Yes" ran the command. |

The decision log matched: page answers `skyborne`/`page` with `confirmed = 1` (the helper's too), the
terminal's `terminal`/`ran` and `terminal`/`refused`.

## Transcripts as `skyborne import` finds them (2026-10-03)
Counted (field names and counts only, no content read) over the 152 session transcripts changed in
one week on the development machine, Claude Code 2.1.288:
- **Files start and end with lines that have no time.** `last-prompt`, `mode`, `permission-mode`,
  `custom-title`, `ai-title`, `agent-name`, `file-history-snapshot` and the closing `cost-state` carry
  no `timestamp`, and they repeat through the file. Every file had at least one timed line. Times are
  taken only from lines that have one.
- **`stop_reason` is on every line of a message**, not only the last: all but 21 of 31,757 assistant
  lines carried the message's final `stop_reason` (the spike's transcripts had `null` on earlier
  lines). The `thinking` line of a turn's last message already says `end_turn` before its `text` line
  arrives, so a turn ends at the message's last line. Usage is unaffected: the last line still wins.
- **Who wrote a user line**: `origin.kind` is `human` for prompts (799), `task-notification` for
  helper reports (470), `peer` for messages from other sessions (97, always `isMeta`). 61 typed prompts
  had no `origin` (all with a `promptId`; some very long pastes). Claude Code's own lines also have
  none and start with a tag: `<local-command-caveat>`, `<command-name>`, `<local-command-stdout>`,
  `<command-message>`, `<bash-input>`, `<bash-stdout>`; and 44 were "[Request interrupted by user]".
- A call refused in the terminal has `toolDenialKind` on its result line (127 seen).
- **Helpers**: 345 helper transcripts; 12 had no `.meta.json`; 30 sidecars had a `name` and no
  `toolUseId` (named agents), and 19 a `parentAgentId` (a helper launched by a helper). Every one was
  still linked to its Agent call through the call's result (`toolUseResult.agentId`).
- The `toolUseResult` of an Agent call carries `agentId`, `resolvedModel`, `description`, `prompt`
  and `isAsync`.
- Importing all 152 (59,814 events) took about 4 seconds.

## Moved to the background, titles and Esc (observed 2026-10-04, Claude Code 2.1.289)
From one week of the development machine's real sessions (counts and line shapes only; scrubbed):
- **A conversation moved to the background goes on in a new session.** In the week's sessions the old
  one got no `SessionEnd` (`/bg` typed in the terminal does send one, see below). Its transcript ends with an informational system line ("Backgrounding after the current
  tool finishes…"), the `cost-state` line, then `{"type": "continued-in", "timestamp": …,
  "continuedInSessionId": "<new id>"}`. The new session's first hook is `SessionStart` with
  `source: "fork"` (documented), plus `seconds_since_last_response`, `context_tokens`,
  `prompt_cache_likely_expired` and `estimated_cache_write_usd`. It went on working with no prompt: its
  first hooks were tool calls. The old session's hooks stopped there, apart from one `Notification`
  0.7 s later.
- **A fork's transcript opens with a copy of the conversation** since the last compaction: every line
  rewritten with the new `sessionId`, no marker, but each assistant line keeps its `message.id` and
  its original `timestamp`. In the one case seen, 313 of the new session's 375 assistant lines were
  copies, all older than its `SessionStart`; its own lines came 13 s after it or later. Counting the
  copies would count those messages twice, so a fork counts only what follows its `SessionStart`.
- **Tried on purpose (Haiku 4.5, a throwaway project, a test server):**
  - `/fork <prompt>`: the original keeps running (no `continued-in`, no `SessionEnd`), and the copy is a
    second session (`SessionStart` `fork`) whose transcript opens with the copied messages, old times and
    all. Two districts; the copy's 43,870 tokens are its own (with the copies it would have been 87,063).
  - `/bg <prompt>` typed in the terminal: `continued-in` is written, then about 0.5 s later the original
    sends `SessionEnd` `prompt_input_exit` and the terminal's `claude` quits; the moved conversation's
    `SessionStart` `fork` came 46 ms after that. The hand-over is how it ended, so it wins over the exit
    that follows it (unless the session is resumed later).
  - A background session gets `--plugin-dir` but not `--model` (docs: agent view), so the test project
    set its model in `.claude/settings.local.json`.
  - `/branch` and `--fork-session` weren't tried; they're assumed to copy the same way.
- **Titles**: `custom-title` (`customTitle`, from `/rename` or `--name`) and `ai-title` (`aiTitle`,
  Claude Code's own) lines carry no time and repeat through the file (6,435 `ai-title` and 98
  `custom-title` lines in a week); the AI title changes as the session goes. The status line's
  `session_name` is the custom name, else the AI title; Skyborne reads the same from the transcript.
- **Esc** fires no hook (no `Stop`). The lead's transcript gets a user line whose only content is a text
  block "[Request interrupted by user]" or "[Request interrupted by user for tool use]" (48 in two
  weeks); a call cut short also fires `PostToolUseFailure` with `is_interrupt: true`.
- **Long quiet stretches inside a turn**: 7 of over 3 minutes in a week of live sessions, 5 with a tool
  running (a command sends nothing until it ends). Of 15 sessions older than an hour, 14 ended with a
  `SessionEnd` and 1 stopped between turns; none stopped mid-turn.

## A city of 60 districts (2026-10-03)
The city shows the 60 most recently active sessions. Measured in a real browser window on the
development Mac's GPU (`page/dev/fps.js`): 60 districts ran at 51 frames per second (median frame
16.7 ms, slowest 5% 33 ms) with about 4,100 draw calls a frame; 12 districts at a steady 60. The
page's own quality control lowers the pixel ratio when frames run long.
After the visual upgrade (2026-10-05: soft reflections, contact shadows, soft clouds and a cloud sea,
painted island undersides), the same check run back to back with the code before it gave 45–48 frames per
second against 42–43 (the machine was busy, so both are below the 51 above). The median frame stayed at
16.7–16.8 ms, the slowest 5% at about 33 ms, and draw calls at about 4,200 a frame either way.
Headless software rendering (CI) is somewhat slower per frame than before: 10–30% across runs, which vary
a lot. Its start-up takes about 2 s longer, because it builds the reflection map without a GPU; with a GPU
that takes milliseconds.

## Docs check (2026-10-02)
- Plugin `hooks/hooks.json` uses the same shape as settings hooks; types `command`, `http`, `mcp_tool`,
  `prompt`, `agent` (plugins/components, hooks).
- Every event supports `http` except `SessionStart` and `Setup` (command and `mcp_tool` only).
- An HTTP hook's connection failure or non-2xx is a "non-blocking error, execution continues"; a 2xx with
  an empty body is success with no decision. Timeouts are in seconds; `SessionEnd` hooks share a 1.5 s budget.
- A command hook that exits non-zero (other than 2) shows a `<hook> hook error` notice in the transcript; one
  that exits 0 sends its stderr to the debug log only. A command hook with `"async": true` runs in the
  background, can't block or decide anything, and its completion notice shows only in the Ctrl+O view.
- `StopFailure` fires when a turn ends on an API error, with `error`, optional `error_details` and optional
  `last_assistant_message`; it has no decision control.
- Any folder in `~/.claude/skills/` with `.claude-plugin/plugin.json` loads as `<name>@skills-dir`; a
  `strictKnownMarketplaces` allowlist blocks such plugins unless it lists `{"source": "skills-dir"}`.
- Settings that can stop Skyborne's hooks: `disableAllHooks`, `allowManagedHooksOnly` (managed only),
  `allowedHttpHookUrls` (when set, only matching URLs run).
- `cleanupPeriodDays` (default 30) deletes old transcripts silently.
- `CLAUDE_CONFIG_DIR` moves everything under `~/.claude`.

## Still unverified
- WSL access from a Windows browser (documented only).
- Which requests make up the gap between transcript sums and Claude Code's ledger.
- A foreground helper's `PostToolUse` usage fields (only background launches were seen).
- `StopFailure` as actually sent (docs only).
- Approving from the city on Windows without Git Bash, where the hook runs in PowerShell.
- Whether PreToolUse and PermissionRequest carry byte-identical `tool_input` for tools other than Bash
  (seen only for Bash). If not, an answer from the page waits for the turn to end to be settled.
- Where a worktree-isolated helper's transcript is: Skyborne looks next to the session's, so an answer
  to such a helper is settled as unknown.
