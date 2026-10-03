# How to use dsh-external-workers

English | [中文](USAGE.zh.md)

---

## 1. The mental model, in 30 seconds

- **DSH agent = orchestrator.** It stays the brain: it plans, decides, and talks to you.
- **Workers = three products; lanes = the contractors.** A **lane** is one product + one model + one
  role, with its own office (working directory `~/.dsh/workers/<lane id>`), its own memory (a
  persistent session) and its own tools. They never see your project unless you hand it to them.
- **A job is a contract.** You hand over a task packet, you get back a result, a decision list, an
  artifact list and a blocker list. The job is recorded on disk, so it survives everything.
- **Nothing is implicit.** No auto-routing, no hidden context passing. If you want a worker to know
  something, it goes in the packet.

---

## 2. First run

### 2.1 See who is ready

Ask the agent:

```
List the external worker tools, then run check_external_job to show the lane roster.
```

`check_external_job` prints a **Lanes** roster — one line per lane:

```
- main [claude] example lane: planning and code review · opus effort high · state=ready · session=7d41f9b2-… · cli=C:\Users\you\.local\bin\claude.exe
- quick [gpt] example lane: fast edits and scripted chores · gpt-6-luna effort medium · state=ready · session=3c8ae501-… · last ran gpt-6-luna · cli=C:\Users\you\AppData\Local\OpenAI\Codex\bin\…\codex.exe
- research [google] example lane: research and data gathering · gemini-3.1-pro-high effort high · state=needs-login · session=none · cli=(unresolved)
```

Each line: the lane id, its product in brackets, its role, the model + effort it is set to run, its
**state**, its **own** session id, the model it last actually ran on once it has run, and the **CLI binary
it resolved to** (or the resolution error, or `(unresolved)`). `state` is one of `ready`, `idle`,
`needs-login`, `cli-missing`, `error`; anything but ready/idle has an explanation attached, which is where
you fix it — and the path on the line is how you check that fix. The roster is printed with every listing,
jobs or not,
and `check_external_job(lane: "quick")` narrows the jobs to one lane.

### 2.2 Set up the lanes (do this once)

```
Show me the available models for the three external workers.
```

That calls `worker_config(action: "models")`, which reads each product **itself** (Codex's own model
cache, `agy models`, Claude's documented aliases) — no invented model names. Add `fresh: true` when a
product has just shipped a new model and you do not want its cached list.

Then, in one message:

```
Set up the division of labour, one lane per job:
- add a lane "lore" on gpt: role "lore writing", model gpt-6-luna, effort medium, speed priority
- add a lane "models" on gpt: role "3D model work", model gpt-6.1-sol, effort xhigh, speed priority
- set the "main" lane (claude) to role "UI / frontend", model opus, effort high
```

A lane is one product + one model + one role, with its own persistent session. Why not one session per
product? Because Codex and Claude each attach a session to **one** model and degrade it when that
thread is resumed on a different one — so `gpt` needs lane `lore` (luna) and lane `models` (sol) as two
separate sessions.

Each `worker_config(action: "set", …)` writes the assignment to disk **and into that product's tool
description**, so from then on the orchestrator knows who does what without being reminded. Use
`action: "add"` to create a lane on a product, and `action: "remove"` to drop a runtime-created lane
from the roster (a lane declared in `config.json` keeps coming back from that file — remove it there).
`clear: true` resets the fields you name, or all four when you name none. Confirm with
`worker_config(action: "show")` — a table of lane, product, role, model, effort, speed, session and
what each lane last ran on.

A lane id that is a bare product name is refused once that product already has named lanes.

### 2.3 Add another CLI (Kimi, Qwen, Grok, Doubao, …)

The three products above are the ones with a hand-written adapter. Anything else is added by
**description**, in `config.json` under `products`, and needs no code change:

```json
"products": {
  "kimi": {
    "label": "Kimi CLI",
    "bin":   { "names": ["kimi.exe", "kimi"], "roots": ["~/.kimi/bin"], "hint": "install kimi" },
    "args":  { "base": ["-p", "{prompt}"], "resume": ["--resume", "{session}"], "extra": ["--output-format", "json"] },
    "output": { "format": "json", "session": "session_id", "text": "result", "model": "model" },
    "models": { "command": ["models"], "format": "lines" }
  }
}
```

Reload the plugin (restart `dsh web`), and that product now has a `delegate_kimi` tool, its own lanes,
its own sessions, durable jobs and a panel card — exactly like the built-ins.

**The honest way to write one.** You do not have to reverse-engineer the CLI by hand; ask the agent:

```
I just installed the kimi CLI at ~/.kimi/bin/kimi.exe. Add it to the external workers plugin:
run its --help, work out the flags for a one-shot prompt, a session resume and a model, then write
the product recipe in config.json. Then add a lane for it and prove it with a trivial task.
```

The agent can read `--help`, run the CLI once to see its real output shape, and fill the recipe in.
The three fields that need actual inspection are `args` (which flags exist), `output` (where the
session id and the text sit in the reply) and `models` (how to list models).

**How the pieces behave**, so you can check a recipe yourself:

| Field | Meaning |
|---|---|
| `bin.names` | Executable names searched on `PATH`. |
| `bin.roots` | Directories scanned for the newest file named `bin.file` (defaults to the first name). |
| `bin.hint` | What the error says when the CLI cannot be found. |
| `args.base` | Always emitted first. Put `["-p", "{prompt}"]` here when the CLI takes the prompt right after its flag. |
| `args.resume/model/effort/speed/cwd` | Emitted only when the run has that value. |
| `args.images` | Repeats once per image; may use `{image}` and `{index}`. |
| `args.prompt` | The prompt on its own, late in the line (the Codex shape). |
| `args.extra` | Always emitted last — output-format flags and the like. |
| `output.format` | `json` (one envelope), `jsonl` (last event wins per field) or `text`. |
| `output.session/text/error/model` | Dotted paths into the parsed reply, e.g. `data.session.id`. |
| `output.sessionPattern` | For `text` output: a regex with a capture group that pulls the session id out of stdout. |
| `models.command/format/path` | The CLI's own model-list command, read as `lines` or `json`. |

Sections are emitted in this order: **base, cwd, resume, model, effort, speed, images, prompt, extra**.
Any section whose placeholder has no value is dropped **whole**, which is why `base` and `extra` may only
use placeholders that always have a value (`{prompt}`, `{cwd}`, `{timeout}`) — the validator refuses the
rest before they can silently eat the section.

A recipe that cannot work is refused with the field named: a missing `bin`, an unknown placeholder, a
`sessionPattern` with no capture group, a format that is not `json`/`jsonl`/`text`. Those errors are
printed when the plugin starts and by `worker_config`, so a typo never turns into a mystery.

**One catch worth knowing.** If the CLI cannot report a session id, the bridge cannot resume anything:
every delegation in that lane starts a fresh conversation. That is not an error, but it is the
difference between a worker that remembers yesterday and one that does not — check `output.session`
or `output.sessionPattern` first.

### 2.4 Quota and credits (why a gpt delegation sometimes stops to ask)

`delegate_gpt` checks Codex's own usage records **before** it starts anything. Two different things can
make it stop and ask you instead of running:

| What it sees | What it does | How you continue |
|---|---|---|
| The 5-hour or weekly window is at/above `quota.warnAtPercent` (default 90) | Returns the real numbers and starts **nothing** | Say continue; the next call carries `allow_quota: true` |
| The plan allowance is spent, so the run would be billed to **credits** | Same, but it says so explicitly | Only you can approve money: `allow_credits: true` |

Both flags are separate on purpose: agreeing to push past 90% is not agreeing to spend money.

After a run that did spend credits, the amount appears on the job (`check_external_job`, and the job
detail in the panel) and in the completion notice:

```
⚠️ credits spent: $0.4242 (balance was $42.5000)
```

Where the numbers come from, and what they cannot cover:

- Codex writes a quota snapshot into its own rollout files (`$CODEX_HOME/sessions/**`) on every turn.
  **Every** Codex surface writes there — this plugin's lanes, the Codex desktop app, the CLI — so the
  reading is current even when you used Codex outside DSH. Nothing is fetched over the network and no
  credential is read.
- **Claude Code and agy report nothing readable.** Claude computes its five-hour/weekly usage but only
  renders it in its TUI; agy logs no numbers. The bridge therefore says nothing about them rather than
  inventing a figure — and a hard limit still shows up reactively as a job with `failureKind: quota`
  that you can `resume_external_job`.
- Credits are measured by comparing the balance **before** and **after** a run. There is no way to
  interrupt a run mid-flight: the worker is one CLI process. So the guarantee is "never silent, and the
  next task needs your yes", not "stops mid-task".

The panel shows the same thing live: a quota strip above the tabs with each product's windows, reset
countdown and credit balance, coloured at your threshold, plus a red "will spend credits" marker.

---

## 3. Delegating work

### 3.1 What to say

You do not need to name the tools. Talk about the work and the agent will route it — the lanes you set
(their roles and models) are printed in each `delegate_*` description.

```
Ask gpt to pull the duplicated code out of these three files into lib/shared.js, run its
own tests to confirm nothing broke, and then apply the result to my project.
```
```
Ask claude to review this module for edge cases and write the missing tests into its own folder.
```
```
Have google research the three options for X, write a comparison table in its own folder,
and then read it back to me.
```

### 3.2 What a good delegation contains

`delegate_*` accepts, and the orchestrator should fill:

| Argument | Why it matters |
|---|---|
| `task` | The complete, standalone task. The worker knows **nothing** about your project or this conversation. |
| `context_files` | Paths inlined into the packet (files or directory listings). This is how the worker learns your code. |
| `logs` | Log files whose tail gets inlined. |
| `images` | Screenshot paths (Codex also receives them as real image attachments). |
| `references` | Free-form notes, URLs, facts. |
| `acceptance` | Explicit success criteria, written into the packet. |
| `lane` | Which lane to run in. **Omit it and you get that product's first lane.** A lane id that does not exist, or that belongs to another product, is refused with a clear error. |
| `cwd` | Working directory. **Default: the directory this lane's session lives in** — a lane you created gets its own workspace (`~/.dsh/workers/<lane>`), while a lane that inherited a pre-lanes session keeps that session's original directory, because these products key their stored conversations by working directory. Keep the default if you want session continuity. |
| `model` / `effort` / `speed` | One-off override of the lane's standing assignment. |
| `new_session` | `true` starts a clean worker session. Default `false` = continue the existing one. |
| `foreground` | `true` waits and returns the result in the same tool call. Default `false` = returns a job id immediately. |
| `timeout_minutes` | Hard kill. Default 30. |

**Rule of thumb:** if you would have to explain it to a contractor who has never seen your repo,
put it in the delegation.

### 3.3 Background by default

`delegate_*` returns immediately:

```
Started gpt job **ext-3** (lane `models` · continuing its session 3c8ae501-…).
Poll it with `check_external_job` (job_id: ext-3).
It keeps running even if this conversation is compacted or the harness restarts.
```

When it finishes, a notice appears in the session that started it:

```
[external-workers] gpt job ext-3 completed (worker session 3c8ae501-…).
<summary>  artifacts: …
Read the full result with check_external_job.
```

Ask for the full text any time, from any session:

```
Check external job ext-3, include the output and the stderr tail.
```

---

## 4. Getting artifacts into your project

Each lane writes into **its own** directory:

```
~/.dsh/workers/<lane id>/jobs/<job-id>/
├─ packet.md      ← what the worker was told
├─ stdout.log     ← raw product output
├─ stderr.log
└─ out/           ← deliverables go here (by contract)
```

They cannot write into your project (and that is deliberate). To land the work:

```
Read the artifacts of ext-3 and apply them to C:\Users\me\Desktop\myproject, then show me the diff.
```

The orchestrator has full file access, so this is a normal DSH edit — reviewed by it, in your repo,
under your normal workflow.

> Prefer to let the worker work directly in the project? Pass `cwd` in the delegation. Be aware that
> Claude Code and Antigravity scope their sessions **by directory**, so a worker that moves around
> loses its thread continuity and starts fresh (the bridge detects the stale session and recovers by
> itself, but the context is gone).

---

## 5. When a job does not finish

Every terminal state is explicit. Nothing is ever silently dropped.

| Status | Meaning | What to do |
|---|---|---|
| `completed` | The worker produced a final answer. | Read it. |
| `blocked` | It cannot run at all: CLI missing, not signed in, disabled in config. | Fix the cause; then `resume_external_job`. |
| `retryable` | Transient: quota, timeout, crashed process, harness restart mid-job. | `resume_external_job` — same worker session, no restart from scratch. |
| `failed` | The worker ran and errored (a real task failure). | Read the error; re-delegate with a better packet or resume with an instruction. |

```
resume_external_job(job_id: "ext-4", instruction: "…")
```

This creates a **new** job record that continues the **same** external session — the original record
is never rewritten, so history stays honest.

---

## 6. What each worker can actually do (permissions)

A worker can only do what its own CLI is allowed to do. These are three different gates, and they are
per **product**: a lane has no permission settings of its own — every lane of `gpt` shares
`workers.gpt`.

### Claude Code — `workers.claude.permissionMode`

| Value | Effect |
|---|---|
| `acceptEdits` *(default)* | Reads files and edits them. Shell commands that would need approval are soft-denied in print mode. |
| `bypassPermissions` | Full trust: everything runs unattended. |
| `plan`, `manual`, `dontAsk`, `auto` | Other Claude Code modes. |

```json
"workers": { "claude": { "permissionMode": "bypassPermissions" } }
```

### Codex — `workers.gpt.sandboxMode` / `approvalPolicy`

| Value | Effect |
|---|---|
| `workspace-write` *(default)* + `approvalPolicy: "never"` | Commands run unattended, confined by Codex's own sandbox. |
| `read-only` | Inspection only. |
| `danger-full-access` | No confinement. |

### Antigravity CLI (`agy`) — grants in its **shared** config

`agy` in headless mode **cannot prompt**. A tool that needs approval is soft-denied — and, importantly,
`agy` still returns `status: SUCCESS` with an empty response. (The bridge detects exactly this: a
successful run with no output is treated as a failure with the real reason attached.)

Grants live in the **shared** Antigravity config — *not* in `~/.gemini/antigravity-cli/settings.json`,
which this version does not read:

`~/.gemini/config/config.json`

```json
"userSettings": {
  "globalPermissionGrants": {
    "allow": [
      "write_file(C:\\Users\\you\\.dsh\\workers\\google)",
      "command(regex:^(python|py|node)\\b.*)",
      "command(regex:^(Get-ChildItem|ls|dir|cat|type|head|tail|grep|rg)\\b.*)"
    ]
  }
}
```

Syntax notes (all verified the hard way):

- `write_file(<absolute directory>)` — **prefix match**, everything below it becomes writable.
  A relative path (`jobs/`) or a trailing backslash does **not** match.
- `command(...)` must use the **regex** form. A bare prefix (`command(python)`) did **not** match
  `python script.py`.
- Wildcards are rejected (`command(*)`, `write_file(*)`).
- Effect is immediate — each `agy` run re-reads the config. Verify from agy's own log:
  `stored shared config permissions: allow=N`.

Everything else (other commands, writes outside the granted directory) stays denied and is reported
as a blocker rather than silently skipped.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No `delegate_*` tools in a session | That session is excluded by `scope`, or the agent predates the plugin load | Check the `scope` rules; open a new session or re-open the chat |
| `no lane named "x"` / `lane "x" belongs to worker "y"` | The `lane` you passed does not exist, or it belongs to another product | `worker_config(action: "show")` lists the lanes; omit `lane` to use that product's first lane |
| `agent-scoped tools registry unavailable` in the log | The host could not resolve `ctx.tools` from the agent's context | The plugin registers nothing (by design) — report it with the log line |
| `blocked / needs-login` | CLI installed but not signed in | `claude auth login` / `codex login` / run `agy` once |
| `blocked / cli-missing` | Binary not found | Install it, or pin `workers.<id>.cliPath` |
| Job `retryable`, reason mentions permission | The worker asked for a tool its CLI refuses | Grant it (section 6) and `resume_external_job` |
| Worker "succeeds" but the result is empty | The product reported success with no output (classic agy behaviour) | The bridge already marks it failed with the real reason — read `lastError` |
| Worker answers in the wrong language | It follows the packet's language | Say which language you want in the task |
| Job vanished after a restart? | It did not — the ledger is on disk | `check_external_job` from any session |

## 8. Where everything lives — and how to watch it

### In the Web UI (the panel)

A **single line** sits directly above the composer, in the same dock as the shipped todo / goal / queue
rows:

```
● External workers   1 running   1 done   1 failed   · 7            [ details ]
```

- It **appears only when there is at least one job** — before that it renders nothing, so an untouched
  session looks exactly as it did. The row never wraps and never grows: it can never push the composer
  around.
- **details** opens a **drawer on the right** with two tabs:
  - **Lanes** — one card per lane: the lane id, its product, its role, the model + effort + speed you
    asked for, **the model it actually ran last** (read back from the product itself), state, that
    lane's **own** session id, and its directory `~/.dsh/workers/<lane id>`, plus how many jobs it has
    (and a shortcut to that lane's jobs).
  - **Jobs** — filter chips per lane, then one row per job (status, product, **lane**, **model +
    effort**, job id, elapsed, artifact count, task, and the error if it failed). **Click any row to
    open that job in full**: the lane, the *complete* result text, every artifact path, the raw error,
    the stderr tail, and the on-disk paths — nothing truncated.
- The drawer has its **own scroll container**, and closes three ways: the ✕ button, `Esc`, or the same
  `details` button.
- It refreshes itself every 6 seconds while a session is open; the data is read-only JSON from the
  plugin's own host half (`GET /api/external-workers/jobs` and `.../job?id=`), over the same durable ledger.
- The panel shows **all** jobs, not just the ones this session started — the ledger is process-wide, and
  each job records the session it came from.

### The DSH side (tools)

```
check_external_job                      # every job + the Lanes roster + which DSH chat started it
check_external_job(job_id: "ext-3")     # one job in full, artifacts included
check_external_job(lane: "models")      # only that lane's jobs
worker_config(action: "show")           # the lane roster: id, product, role, model, effort, speed, session, last ran
```

Under the hood:

| Path | Contents |
|---|---|
| `$DSH_HOME/storages/external_workers.json` | The durable ledger: jobs, and one record per lane (session id, working directory, assignment) |
| `~/.dsh/workers/<lane id>/jobs/<id>/` | `packet.md`, `stdout.log`, `stderr.log`, `out/` (deliverables) |

### Watching a lane from its own product

Every lane's session is a **normal session of that product**, so you can open it in that product and
read exactly what that lane did:

| Product | Open the lane's session |
|---|---|
| Claude Code | `claude --resume <lane session id>` — or read `~/.claude/projects/<cwd-slug>/<session-id>.jsonl` |
| Codex | `codex resume <thread id>` — the same thread also shows up in the Codex app's own session list |
| Antigravity CLI | `agy --conversation <conversation id>` (interactive), or `agy -p --conversation <id> "…"` |

Two things worth knowing:

- **Codex worker threads share your Codex account history.** They are distinct threads (nothing is
  mixed), but they are visible in the Codex app. To physically separate them, point
  `workers.gpt.env` / the child environment at a dedicated `CODEX_HOME` and sign in there once.
- **Antigravity worker conversations do *not* appear in the Antigravity IDE** — the CLI keeps its own
  store under `~/.gemini/antigravity-cli/`, separate from the IDE's `~/.gemini/antigravity/`.
- Typing into a worker session manually is allowed (it is just a session), but the bridge keeps
  delegating into the same thread, so avoid interleaving a manual turn with a running job.

### Raw debugging sources

| Path | Contents |
|---|---|
| `~/.claude/projects/…` | Claude Code's own session transcripts |
| `~/.codex/sessions/…` | Codex thread rollouts (`rollout-<ts>-<thread-id>.jsonl`) |
| `~/.gemini/antigravity-cli/conversations/…` | Antigravity conversations |
| `~/.gemini/antigravity-cli/brain/<conversation>/…/transcript.jsonl` | agy's step-by-step tool calls — the best source for permission denials |
| `~/.gemini/antigravity-cli/log/cli-*.log` | Shows how many permission grants agy actually loaded |

## 9. Design notes worth knowing

- **The tool catalog is rebuilt every step**, so attaching tools to a session never requires
  restarting that conversation, and `worker_config` changes take effect on the next step.
- **The lane's session id is the contract.** It is stored per lane, updated after every run, and used
  to resume. A stale id (deleted session, moved workspace) is detected and recovered by starting a
  fresh session exactly once.
- **Two different notions of "session".** The DSH session (your chat) and the lane's session (the
  product's own conversation) are independent. Compacting one never touches the other.
- **Upgrading from a pre-lanes version.** Records used to be keyed by product name. Once `config.json`
  declares named lanes, the **first lane of each product adopts that product's record**: its session id,
  its working directory and its state all carry over, so the thread you already had is not lost — and the
  directory carries over deliberately, because the products key their stored conversations by working
  directory (Claude Code files transcripts under `~/.claude/projects/<cwd-slug>/`), so a session resumed
  from a different folder may not be found at all. A lane renamed from `claude` therefore keeps running in
  `~/.dsh/workers/claude/`; only genuinely new lanes get `~/.dsh/workers/<lane id>/`. Every further lane of
  that product starts with a fresh session on purpose, and the adopted record's old
  `role`/`model`/`effort`/`speed` are not kept — they were assigned product-wide and describe no particular
  lane. Old jobs carry no lane id, so readers fall back to the product name, and the ledger itself is never
  rewritten.
