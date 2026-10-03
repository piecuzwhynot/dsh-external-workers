# dsh-external-workers

> **Persistent external agent workers for DeepSeek Harness.** Delegate long-running tasks to
> **Claude Code**, **Codex CLI** and **Antigravity CLI** — through their own official CLIs and your
> existing subscription logins — with jobs that survive a restart or a context compaction.

给 DeepSeek Harness 用的外部 agent 泳道：把长任务派给 Claude Code、Codex、Antigravity 三个 CLI，用你自己已有的订阅登录。每条泳道一个持久会话，作业重启和压缩都不会丢。

**English** | [中文](README.zh.md)

---

## Why not just make Claude or GPT the brain?

Because the economics are lopsided, and because "cheap and general" and "best at this particular job"
are two different things.

DeepSeek is cheap enough that **talking is the default action**: thinking out loud, arguing a design,
reading a log, a small edit, a quick check. Routing that to a premium model pays a lot for very little.
So the brain stays where it is — DSH holds the conversation, the plan and the context, and it is the
thing you actually talk to.

What DSH should not do is *everything*. Some work is not a question of price but of kind:

- **Repo-scale autonomous work** — a 40-file refactor, running the tests, fixing what breaks. Claude Code
  and Codex bring their own agent harness and tools, and those subscriptions are already paid for.
- **A genuinely independent opinion.** A different model reviewing the first one's work catches what
  self-review cannot; the same brain agreeing with itself is worth very little.
- **Hours of work that should not sit in your conversation.** A lane runs in its own session and its own
  directory, keeps going while you talk about something else, and comes back with artifacts and a result
  you can inspect.
- **A different character, or a huge context**, when the task is shaped that way.

So the design is complementary, not competitive: **DSH is the orchestrator and the conversational brain;
the external workers are specialists you hand one self-contained job at a time.** The cheap, fast
conversation stays cheap; the expensive model is spent only where it is genuinely better.

Two honest rules of thumb:

- **Talk to DSH. Delegate when the work is long, self-contained, or needs another pair of eyes** — not
  merely because another model is "smarter".
- **A worker starts from zero.** It knows nothing about this conversation, so the packet *is* the
  briefing: files, logs, acceptance criteria. That is a real cost, and it is why small talk stays here.

And one thing that is not free: workers spend your subscription quota, and a spent Codex allowance falls
back to paid credits — which is why this plugin reads the quota **before** dispatching and asks first
(see [Quota and credits](#quota-and-credits-codex)).

## Two jobs that should never have been yours

Strip away the features and this plugin does two things. Both exist because a human was doing them
badly.

**1. Being the wire.** Without it, delegating means *you* do this: copy the failing output, switch to the
other app, paste it, explain what you want, wait, copy the answer back, paste it into the project, and
keep two windows straight in your head. That is transport work. It costs attention, it breaks focus, and
it loses fidelity — what actually crosses over is your *paraphrase* of the error, not the error. Here the
handover is mechanical: the task is written into a packet with the real files, log tails and acceptance
criteria inlined, the worker runs in its own session, and the result, the artifacts and any failure come
back as a durable record the agent can read. Nobody retypes anything.

**2. Being the memory.** Nobody remembers everything — and no model does either. Any agent that compacts
loses detail eventually, and the loss is **silent**: if nobody notices in time to put it back, the
decision made three hours ago simply is not there any more, and the task quietly goes wrong. Keeping
that in a human's head, or in one chat window, means one compaction, one restart or one closed tab can
break the work.

So the state of a job never lives inside a conversation. It lives on disk: the job record, the worker's
own session id, the packet that was handed over, the artifacts that came back. Compaction and restarts
cannot reach it, a different session can still read it, and resuming a job needs nobody to *remember*
what the job was about.

**And the loss becomes something a machine can act on, which is the part a human cannot do.** You cannot
see what a summarizer quietly dropped — what you notice is only that an agent got vaguer. A machine can
at least see *that* a compaction happened, and then go and re-read the state from somewhere durable and
re-brief whoever lost it. Compaction stops being an invisible hole and becomes an event with a recovery
path.

Two rules keep that honest, because the naive version of the idea does not hold:

- **The workers are not copies of each other, they are different partitions.** A lane working on one part
  of a project never knew what another lane was doing unless it was told. So recovery does not come from
  "the other agent still remembers" — it comes from the durable record that every handover writes. Think
  of the sessions as caches and the disk as the source of truth: compaction is a cache eviction, and
  recovery is going back to the source.
- **More workers lowers the chance of an unrecoverable loss, and raises the chance of two lanes holding
  two versions of the truth.** That is the ordinary cost of replication. A single source of truth is what
  keeps redundancy from turning into disagreement.

What is *not* automated yet, said plainly: noticing that a worker's own session compacted and re-briefing
it is still a manual step today (`resume_external_job`, or a fresh packet). The plugin guarantees the
state is recoverable; it does not yet watch for the moment recovery is needed.

Two things this does **not** buy, said plainly:

- A worker's own long thread still compacts internally. Its artifacts and its packet survive on disk;
  its recollection does not. The plugin keeps the handover durable, not the worker's mind.
- A packet is only as good as what was put in it, and a worker cannot ask you a question. Small talk and
  half-formed ideas belong in DSH, where you can be vague.

## What it is

A native DeepSeek Harness (DSH) plugin. It adds six tools to your sessions, plus one
`delegate_<product>` per custom product you declare:

| Tool | What it does |
|---|---|
| `delegate_claude` | Hand a task to the **Claude Code** worker |
| `delegate_gpt` | Hand a task to the **Codex CLI** worker |
| `delegate_google` | Hand a task to the **Antigravity CLI** (`agy`) worker |
| `check_external_job` | Read any job — status, result, artifacts, errors — from disk |
| `resume_external_job` | Continue a blocked/failed job **in the same worker session** |
| `worker_config` | List the real models each product offers, and manage its **lanes** (role + model + effort + speed) |

**Plus a panel in the Web UI**: a row above the composer lists every job with its live status, and
expands into a drawer with a **Lanes** tab (one card per lane: role, requested model, the model it
last ran on, state, session, directory) and a **Jobs** tab (per-job detail: task, lane, worker
session, artifacts, error, result preview). It renders **nothing at all** while there are no jobs, so
a session that never delegates is untouched.

Each lane is an **independent, long-lived session** in its own product, in its own working directory
(`~/.dsh/workers/<lane id>`), with its own tools. One product can run several lanes — that is how `gpt`
does quick edits on a fast model in one lane while a heavier model grinds through something long in
another. Your DSH agent stays the orchestrator; the lanes do the work.

```
DSH agent (orchestrator)
   │  delegate_gpt(task, lane: "quick", context_files, logs, acceptance, …)
   ▼
Codex lane `quick`  ── runs in ~/.dsh/workers/quick/ ── writes jobs/ext-3/out/*
   │                                                 (its own persistent thread)
   ▼
durable job record (disk)  ──►  completion notice back into your session
```

## Why not just use the built-in subagent?

DSH ships a subagent seam, and there are optional product providers
(`@deepseek-ai/dsh-subagent-codex`, `@deepseek-ai/dsh-subagent-claude-code`). They are **one-shot by
design**: a fresh process, a fresh thread, one turn — the upstream provider README states plainly that
there is *"no continuation, resume, pooling, progress stream, or product-session persistence."*

This plugin is built for the opposite case: **the same worker, over and over.** Each lane keeps one
dedicated session that every later delegation into that lane continues, plus a durable job ledger so
nothing is lost when the conversation is compacted or the harness restarts.

## How it compares to similar projects

Searched the ecosystem (GitHub + the 4,400-entry `awesome-dsh-plugin` list). The honest summary:
**the capability exists elsewhere, but not in this shape.**

| Project | What it is | How this differs |
|---|---|---|
| [Enderfga/claw-orchestrator](https://github.com/Enderfga/claw-orchestrator) ★580+ | A **standalone runtime** (TypeScript, 78 tools) wrapping Claude Code / Codex / Antigravity / Cursor / OpenCode: persistent sessions, councils, dashboards, MCP server, OpenAI-compatible proxy | Closest in *capability*, different in *architecture*: it runs as its own daemon on its own port and you reach it over MCP/HTTP. This plugin **is** a DSH plugin — one composition row, no extra process, no extra port, tools appear directly in the session. It is also ~80 KB of plain JS instead of a runtime. |
| [mjylfz/dsh-subagent-codex](https://github.com/mjylfz/dsh-subagent-codex) | DSH plugin: one `subagent_codex` tool over the official `SubagentProvider` seam | Codex only, **one-shot** (new Codex session every call), subagent-result shaped. This one covers **three** products and **resumes the same session** by default. |
| `@deepseek-ai/dsh-subagent-codex` / `-claude-code` (official, optional) | DSH product providers | Officially **one-shot**, and the Codex one resolves `codex` from `PATH` only. |
| [amlyczz/dsh-agy-link](https://github.com/amlyczz/dsh-agy-link), [darkings/dsh-agy-provider](https://github.com/darkings/dsh-agy-provider), [DavidRm1911/dsh-llm-subscription](https://github.com/DavidRm1911/dsh-llm-subscription) | Use these CLIs/subscriptions as **model providers** in DSH's model picker | Opposite architecture: there, *your DSH agent runs on that model*. Here, *that product's own agent runs the task* with its own tools, workspace and session. |
| [NOirBRight/dsh-external-agents](https://github.com/NOirBRight/dsh-external-agents) | DSH plugin: a **control plane** for the same kind of external coding products (Codex, Claude Code, Cursor Agent, Antigravity) — a Settings section that probes/enables them, tools on the host plane, background jobs in the DSH Job Panel | The closest sibling in intent, and opposite in the one decision that changes daily use: theirs is **one-shot by design** (their ADR 0003 decides that every delegation pays for a fresh product context, and that you cannot add a line to the same Codex thread), while this plugin keeps a **persistent session per lane** you continue and can resume. See the direct comparison below. |
| [czm15053/dsh-peer-link](https://github.com/czm15053/dsh-peer-link), [kirkchinese/claude2dsh](https://github.com/kirkchinese/claude2dsh) | Peer messaging / session import between DSH and Claude Code | Not delegation: no job, no result contract, no resume-as-a-job. |

What appears to be unique here:

1. **Three engines behind one small bridge**, with as many dedicated persistent sessions (lanes) as
   you declare, and every job recorded against the lane it ran in.
2. **Per-session scoping** — the tools attach to the agent scopes you choose (exclude by preset /
   workspace / session id). Sessions you exclude keep a *byte-for-byte unchanged* tool catalog and
   system prompt. Nothing else in the ecosystem does this.
3. **Jobs live in DSH's own durable storage domain**, not in process memory and not in the model's
   context: compact the conversation, restart the harness — the job is still there, still readable.
4. **Failure is a first-class state**: `blocked` (missing CLI / not logged in), `retryable` (quota,
   timeout, dead process). A worker that dies is *never* silently lost.
5. **Lane role + model assignment written into the tool descriptions** — tell it once who does what,
   and routing follows automatically.
6. **Open to any CLI, by configuration** — the three products below are hand-written adapters; every
   other agent CLI is added by describing it in `config.json` (see
   [Custom products](#custom-products)). No fork, no code change, no release.
7. **Quota and credits are read before dispatch** — the one thing nobody else does, because it is the
   one thing that costs money silently (see [Quota and credits](#quota-and-credits-codex)).

#### Versus `dsh-external-agents`, the closest sibling

Same problem, same products, and two projects that answer the central question differently. Theirs is
documented in an ADR, so this is not a guess about their intent:

| | `dsh-external-agents` | this plugin |
|---|---|---|
| Continuity | **one-shot, by design.** Every delegation starts a fresh product context; a new process each time | **one persistent session per lane**, continued by default and resumable after a failure |
| What you can say | "carry out this bounded task" | "continue where you left off, but do X instead" |
| Job records | the harness's own job registry (Job Panel) — in-memory, so a restart loses them | the durable storage domain, readable from any session after a restart or a compaction |
| Sessions per product | one per adapter (one model) | as many lanes as you declare (product + model + role), each with its own directory |
| Adding a product | a fixed set of four shipped adapters; a user-defined argv adapter is an explicit non-goal | any CLI by config recipe — including API-only models with no CLI at all |
| Handover | a bounded task text | a packet on disk (inlined files, logs, images, acceptance criteria) plus collected artifacts |
| Plan quota / credits | not covered | Codex usage is read before dispatch; a spent allowance cannot be spent silently |
| Who sees the tools | host plane — every session in the profile | attached per session; exclusions by preset / workspace / session id |
| **What they do better** | **a real Settings section** (probe each product, enable it, pick the default) — this plugin configures through `config.json` and shows state in the dock panel. And they support **Cursor Agent**, which this plugin does not. | |

If all you want is "enable a worker, fire one task, watch it in the Job Panel", their control plane
does that with a nicer settings surface. This plugin exists for the other case: **the same worker,
used over and over, that has to remember.**

## Requirements

- DeepSeek Harness with the **web profile** (uses the storage domain, shipped by `dsh-web-app`).
- Node **≥ 22.19**.
- At least one of the worker CLIs, installed and signed in with **your own subscription**:
  - **Claude Code** — `claude auth login` (no API key needed)
  - **Codex CLI** — `codex login` (ChatGPT subscription)
  - **Antigravity CLI** — `irm https://antigravity.google/cli/install.ps1 | iex`, then run `agy` once
    (it usually picks up an existing Antigravity/Google sign-in from the OS keyring)

No API keys are created, no browser automation, no cookie reading. A worker that is not installed or
not signed in is simply reported as `blocked` by `check_external_job`.

## Install

```bash
# from a release tarball (the URL never contains a version)
dsh plugin --profile web add --force \
  https://github.com/piecuzwhynot/dsh-external-workers/releases/latest/download/dsh-external-workers.tgz

# a fixed version, with a checksum to verify it
dsh plugin --profile web add --force \
  https://github.com/piecuzwhynot/dsh-external-workers/releases/download/v0.3.0/dsh-external-workers-0.3.0.tgz

# or from a local checkout / tarball
dsh plugin --profile web add link:C:/path/to/dsh-external-workers
dsh plugin --profile web add file:/path/to/dsh-external-workers-0.3.0.tgz
```

Then **restart the harness** (`dsh web`) — the bundle list is read at boot — and open a session.
Ask it: *"list your external worker tools"* and you should see all six.

Verify and remove:

```bash
dsh plugin --profile web list
dsh plugin --profile web remove dsh-external-workers
```

The release artifact is built by `node scripts/release.mjs`, which refuses to pack when the tarball
does not match the working tree byte for byte (that is what catches "packed before rebuilding the
client bundle") and writes `SHA256SUMS` next to it.

> **`link:` installs need a local `node_modules`.** A linked package resolves its own bare imports
> from its real path, so it cannot see the profile's `node_modules`. Either install from npm/tarball,
> or drop junctions/symlinks for `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-storage-domain`,
> `@deepseek-ai/dsh-llm` and `zod` into the package's own `node_modules`.

## Where you configure it

Two places, and they edit the **same** lanes through the same host code, so they can never disagree:

- **Settings → External workers** — a real settings page: one block per lane with its role, model,
  effort and speed editable in place, plus the products, live quota and where the config lives. Saving
  applies immediately; no restart. Adding and removing lanes lives here too.
- **`config.json`** — the declarative version: `lanes`, `products`, `quota`, `scope`, and per-product
  CLI behaviour. Use it to seed a fresh install or to keep the setup in version control.
- **The `worker_config` tool** — the same operations, for when you would rather just say it: *"give the
  quick lane effort high"*.

## Quick start

```
# 1) see the real model list from each product, then set up the lanes
"Show me the available models for the three external workers."
"Run gpt as two lanes: 'quick' on gpt-6-luna/medium with speed priority, and 'deep' on
 gpt-6.1-sol/xhigh with speed priority. Leave claude on opus/high for UI work."

# 2) delegate into a lane
"Delegate to gpt in the 'deep' lane: refactor this module to async, put the result in
 its own folder, then read the artifacts and apply them to my project."

# 3) later, from any session
"Check the external jobs."
```

Details, worked examples and troubleshooting: **[docs/USAGE.md](docs/USAGE.md)** (中文: [docs/USAGE.zh.md](docs/USAGE.zh.md)).

## Configuration

Everything lives in `config.json` next to this package; most of it is read on every use, so edits
apply without a restart.

### Which sessions get the tools (`scope`)

```json
"scope": {
  "mode": "per-session",
  "excludePresets": ["my-persona-preset"],
  "excludeWorkspaces": ["C:\\Users\\me\\companion-workspace"],
  "excludeSessionIds": ["session-…"]
}
```

- `per-session` (default) registers the tools into **each chosen agent's own scope**. An excluded
  session has *no* registration at all — not a hidden tool, an absent one.
- `off` gives them to nobody; `global` gives them to every session (rarely what you want).
- If the agent-scoped registry is unavailable the plugin registers **nothing** and logs an error — it
  never falls back to a global registration.
- A session that switches onto an excluded preset mid-life loses the tools again.

### Lanes

```json
"lanes": [  { "id": "main", "worker": "claude", "role": "example lane: planning and code review", "model": "opus", "effort": "high", "speed": null },
  { "id": "quick", "worker": "gpt", "role": "example lane: fast edits and scripted chores", "model": "gpt-6-luna", "effort": "medium", "speed": "priority" },
  { "id": "deep", "worker": "gpt", "role": "example lane: the heavy model work", "model": "gpt-6.1-sol", "effort": "xhigh", "speed": "priority" },
  { "id": "research", "worker": "google", "role": "example lane: research and data gathering", "model": "gemini-3.1-pro-high", "effort": "high", "speed": null }
]
```

A **lane** is the unit of work: one product + one model (and effort/speed) + one role, with its **own**
persistent session and its **own** working directory `~/.dsh/workers/<lane id>` (a lane that inherited a
pre-lanes session keeps that session's original directory instead — see the upgrade note below). The same
product runs several lanes, and that is the point — Codex and Claude each bind a session to one model and
degrade it when that thread is resumed on another, so `gpt` + `gpt-6-luna` and `gpt` + `gpt-6.1-sol` must
not share a session.

- `id` must match `/^[a-z0-9][a-z0-9_-]{0,31}$/`, and it names the lane's own workspace
  (`~/.dsh/workers/<id>`) — for a lane that inherited a session, the inherited directory wins.
- Delete the whole `lanes` key and the plugin falls back to **one lane per product, named after the
  product** — the behaviour before lanes existed.
- Manage them at runtime with `worker_config`: `action: "set"` edits a lane, `"add"` creates one on a
  product, `"remove"` drops one, `"show"` is the roster.

**Upgrading from a pre-lanes version.** Records used to be keyed by product name. As soon as the config
declares named lanes, the **first lane of each product adopts that product's own record**, so the
session you already have is never thrown away; every further lane of that product starts with a fresh
session on purpose. Two details an upgrader should know. The adopted record keeps its session id, its
state **and its working directory** — the directory travels with the session on purpose, because these
products key their stored conversations by working directory (Claude Code files transcripts under
`~/.claude/projects/<cwd-slug>/`), so a session resumed from a different folder may not be found at all.
A lane renamed from `claude` therefore keeps running in `~/.dsh/workers/claude/`; only genuinely new
lanes get `~/.dsh/workers/<lane id>/`. And the adopted record's old `role`/`model`/`effort`/`speed` are
**not** kept: those four used to be assigned product-wide, so they describe no particular lane — the
lane's config, or a later `worker_config` call, owns them now. Jobs recorded before lanes existed carry
no lane id, and readers fall back to the product name; nothing in the ledger is rewritten or lost.

### Per worker

```json
"workers": {
  "claude": { "enabled": true, "cliPath": null, "permissionMode": "acceptEdits", "extraArgs": [] },
  "gpt":    { "enabled": true, "cliPath": null, "sandboxMode": "workspace-write", "approvalPolicy": "never", "extraArgs": [] },
  "google": { "enabled": true, "cliPath": null, "extraArgs": [] }
}
```

This block is CLI behaviour only: `enabled`, `cliPath`, and each product's own gate (`permissionMode`
for claude, `sandboxMode` / `approvalPolicy` for gpt, `extraArgs` for all three). `role`, `model`,
`effort` and `speed` are **not** read from here — they belong to a lane. `cliPath` pins a binary
(default: newest install, then `PATH`).

Granting a worker more power is a one-line change — see [docs/USAGE.md](docs/USAGE.md#permissions).

### Custom products

The three products above are the ones with a hand-written adapter. **Any other agent CLI can be added
by description, without touching the code** — Kimi, Qwen, Grok, Doubao, a local model runner, whatever
ships next month. A product is a recipe in `config.json`:

```json
"products": {
  "kimi": {
    "label": "Kimi CLI",
    "bin": { "names": ["kimi.exe", "kimi"], "roots": ["~/.kimi/bin"], "hint": "install kimi" },
    "args": {
      "base":   ["-p", "{prompt}"],
      "resume": ["--resume", "{session}"],
      "model":  ["--model", "{model}"],
      "extra":  ["--output-format", "json"]
    },
    "output": { "format": "json", "session": "session_id", "text": "result", "model": "model" },
    "models": { "command": ["models"], "format": "lines" }
  }
}
```

That is all it takes: the product immediately gets a `delegate_kimi` tool, its own lanes, its own
sessions, durable jobs, artifact collection and the panel card. Concretely:

- **`bin`** — how to find the CLI: `names` are searched on `PATH`, `roots` are scanned for the newest
  match, and `workers.<id>.cliPath` pins one outright.
- **`args`** — templates with placeholders `{prompt}` `{session}` `{model}` `{effort}` `{speed}` `{cwd}`
  `{timeout}` `{image}` `{index}`. Sections are emitted in the order **base, cwd, resume, model, effort,
  speed, images, prompt, extra**, and a section whose placeholder has no value is dropped whole — so a
  run with no model never leaves a dangling `--model` behind. A CLI that takes the prompt right after
  its flag puts both in `base`: `["-p", "{prompt}"]`; one that takes it last uses `args.prompt`.
- **`output`** — `json` (one envelope), `jsonl` (last event wins per field) or `text` (stdout as the
  result, plus an optional `sessionPattern` with a capture group). This is how the bridge learns the
  session id, which is what makes a lane's thread continue across runs.
- **`models`** — the CLI's own model-list command, so `worker_config(action: "models")` reports reality
  instead of guesswork.

A recipe is data, so it is validated, not trusted: a broken one is reported at plugin start and by
`worker_config`, naming the field and the rule. Five lines in a config file is the whole cost of
supporting a new CLI — and if you would rather not write it, ask the DSH agent to: it can read the
CLI's `--help` and fill the recipe in for you.

#### Not only CLI products: API-only models too

The example above drives a CLI. A product that offers **only an HTTP API** has no command to run, so
the plugin ships one: [`examples/api-lane.mjs`](examples/api-lane.mjs) turns an OpenAI-compatible
endpoint into a lane. That shape covers far more than OpenAI — xAI (Grok), Moonshot (Kimi), DashScope's
compatible mode (Qwen), Volcengine Ark (Doubao) and most local servers all speak it.

```json
"products": {
  "grok": {
    "label": "Grok (xAI API)",
    "bin": { "names": ["node.exe", "node"], "roots": [] },
    "args": {
      "base":   ["<plugin>/examples/api-lane.mjs", "--history-dir", "{cwd}/.api-history"],
      "prompt": ["-p", "{prompt}"],
      "resume": ["--resume", "{session}"],
      "model":  ["--model", "{model}"]
    },
    "output": { "format": "json", "session": "session_id", "text": "result", "model": "model" }
  }
}
```

The key never goes in `config.json`: the script reads `API_LANE_API_KEY` from the environment (or
`--key-file <path>`), with `API_LANE_BASE_URL` and `API_LANE_MODEL` alongside it.

Two things this buys you, and one it does not:

- **It iterates.** The script keeps the conversation on disk per session, so `--resume` sends the whole
  thread back — a follow-up builds on everything the worker already saw, exactly like a CLI lane. A
  plain "call the API once" wrapper would send one message every time; there is a test that fails if
  that regresses.
- **The packet is inlined.** The bridge normally tells a worker to read `jobs/<id>/packet.md`. A raw API
  model has no file tools, so the script reads that packet and sends it with the prompt, and says so.
- **But an API model has no tools at all.** It cannot read your repo, run your tests, or write files
  into `jobs/<id>/out/`. It answers in text, and the answer is the deliverable. If you need a worker
  that actually *does* things in your project, use a product with a real CLI — the API lane is for
  asking, reviewing, drafting and thinking, not for touching files.

### Why a lane beats a plain subagent

DSH's built-in subagent seam is **one-shot by design** — a fresh process, a fresh thread, one turn. The
upstream provider README says it plainly: *"no continuation, resume, pooling, progress stream, or
product-session persistence."* Every call starts from zero, so you re-brief the model every time, and
whatever it learned in the previous call is gone.

A lane is the opposite: **a worker that iterates.**

| | Plain subagent | A lane |
|---|---|---|
| What it remembers | nothing; each call starts from zero | its own session, kept across calls |
| Follow-ups | re-explain the whole task | "continue, but do X instead" |
| Models it can hold | one model per call | one model per lane, several lanes per product |
| If it fails | the turn is gone | the job is on disk: read it, resume it, retry it |
| If your chat is compacted | the subagent call is gone | the worker session and its jobs are untouched |
| Working directory | the caller's | its own, per lane |
| Who runs the model | your DSH process hosts the request | the product's own agent, on your own subscription |

The practical difference: a subagent is a question you ask. A lane is a **colleague you hired** — brief
them once, then keep handing them the next piece of the same job, and they still remember the
first one.

### Quota and credits (Codex)

`delegate_gpt` reads Codex's own usage records before every run, so it can stop **before** starting
work that would hit the wall:

- At/above `quota.warnAtPercent` (default **90**) on either the 5-hour or the weekly window, the tool
  does **not** start. It returns the real numbers and waits for you; continuing needs an explicit
  `allow_quota: true`.
- If the plan allowance is already spent, the next run would be billed to **credits** — that needs a
  separate `allow_credits: true`, so approving a percentage never silently approves money.
- A run that does spend credits is reported afterwards with the amount, on the job record and in the
  completion notice.

```json
"quota": { "enabled": true, "warnAtPercent": 90 }
```

The numbers come from Codex's rollout files (`$CODEX_HOME/sessions/**`), which **every** Codex surface
writes — this plugin's lanes, the Codex desktop app, and the CLI — so the reading stays current even
when the usage happened somewhere else. Nothing is queried over the network and no credential is read.

**Every reading is shown with its age, and ages honestly.** Codex writes a snapshot only when a turn
runs, so an idle machine legitimately has an old one. Two rules follow, and both exist because the first
version of this feature got them wrong:

- The snapshot time comes from the **event's own timestamp**, never the file's mtime — Codex keeps
  appending unrelated events (a compaction, a settings change) to an old session, which makes the file
  look freshly written while its numbers are hours stale.
- A window whose reading has **already reset** is reported as expired instead of as a number, and it
  cannot gate anything. A 14-hour-old "5h 4%" is not a healthy quota, it is a window that has rolled
  over twice — and a stale number errs in the reassuring direction, which is the worst way to err.

The reset time is the authority while it is coherent with the reading (a reset *before* the reading is
nonsense and is ignored), and the credits warning follows the slot Codex actually names
(`rate_limit_reached_type`) — a spent weekly window says nothing about the 5-hour one.

**Only Codex reports this.** Claude Code computes its own five-hour/weekly usage but renders it only in
its TUI (nothing is cached where a plugin can read it), and the Antigravity CLI logs no numbers at all.
For those two the bridge stays silent rather than showing an invented number — and a hard limit still
surfaces reactively: the job comes back as `retryable` with `failureKind: quota`.

Another practical limit: credits can only be reported **after** a run, not mid-run. The worker is a
single CLI process; nothing can be intercepted while it spends. What the bridge guarantees is that the
spend is never silent and that the *next* task cannot start on credits without your yes.

## How it works

- **Host-plane row.** One `cordis.patch.yml` row mounts the out-of-band plugin bundle. It publishes no
  service, so it needs no `isolate` realm, and it never touches a persona, an injection, a memory
  pipeline or a compaction prompt.
- **Per-session attachment.** The host listens for `agent/created` and registers the tools into that
  agent's own `agent.ctx` (`ctx.tools.register` → the calling context's layer). The catalog is
  reassembled every step, so a newly attached session sees the tools on its next step.
- **Durable ledger.** Jobs and lanes — each lane with its own session id and standing assignment — live
  in the `external_workers` storage domain → `$DSH_HOME/storages/external_workers.json`, written
  atomically. On start the plugin reconciles: anything marked `running` whose process is gone becomes
  `retryable` with the reason.
- **Self-contained task packets.** Every delegation writes `jobs/<id>/packet.md` (task, inlined files,
  log tails, images, references, acceptance criteria, output contract). The worker never has to guess
  about your project; it reads one file.
- **Artifacts by convention.** Workers write deliverables under `jobs/<id>/out/`, which the bridge
  lists back into the job record.
- **Real model discovery.** `worker_config(action: "models")` reads the products themselves — Codex's
  `models_cache.json`, `agy models`, Claude's documented aliases — instead of a hardcoded list.

## Limitations

- Each worker can only do what its own CLI is permitted to do. Anthropic's `acceptEdits`, Codex's
  sandbox and agy's permission grants are all different gates; the bridge reports what it is told
  rather than pretending. See the permissions section in the usage guide.
- Lanes run in **their own** directory (`~/.dsh/workers/<lane id>`), not in your project. Moving
  artifacts into a project is a deliberate second step (or point `cwd` at it — at the cost of
  per-directory session continuity).
- No autonomous routing. The tools are explicit; the orchestrator decides.
- Tested on **Windows** with Node 24 and DSH 0.1.1-rc.2; the CLI adapters themselves are
  platform-neutral.

## License

MIT — see [LICENSE](LICENSE).
