# dsh-external-workers

> **Persistent external agent workers for DeepSeek Harness.** Delegate long-running tasks to
> **Claude Code**, **Codex CLI** and **Antigravity CLI** — through their own official CLIs and your
> existing subscription logins — with jobs that survive a restart or a context compaction.

给 DeepSeek Harness 用的外部 agent 泳道：把长任务派给 Claude Code、Codex、Antigravity 三个 CLI，用你自己已有的订阅登录。每条泳道一个持久会话，作业重启和压缩都不会丢。

**English** | [中文](README.zh.md)

---

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
writes lore on one model in lane `lore` while building models on another in lane `models`. Your DSH
agent stays the orchestrator; the lanes do the work.

```
DSH agent (orchestrator)
   │  delegate_gpt(task, lane: "lore", context_files, logs, acceptance, …)
   ▼
Codex lane `lore`  ── runs in ~/.dsh/workers/lore/ ── writes jobs/ext-3/out/*
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
# from npm (once published)
dsh plugin --profile web add dsh-external-workers

# or from a local checkout / tarball
dsh plugin --profile web add link:C:/path/to/dsh-external-workers
dsh plugin --profile web add file:/path/to/dsh-external-workers-0.1.0.tgz
```

Then **restart the harness** (`dsh web`) — the bundle list is read at boot — and open a session.
Ask it: *"list your external worker tools"* and you should see all six.

> **`link:` installs need a local `node_modules`.** A linked package resolves its own bare imports
> from its real path, so it cannot see the profile's `node_modules`. Either install from npm/tarball,
> or drop junctions/symlinks for `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-storage-domain`,
> `@deepseek-ai/dsh-llm` and `zod` into the package's own `node_modules`.

## Quick start

```
# 1) see the real model list from each product, then set up the lanes
"Show me the available models for the three external workers."
"Run gpt as two lanes: 'lore' on gpt-6-luna/medium with speed priority, and 'models' on
 gpt-6.1-sol/xhigh with speed priority. Leave claude on opus/high for UI work."

# 2) delegate into a lane
"Delegate to gpt in the 'models' lane: refactor this module to async, put the result in
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
"lanes": [
  { "id": "main", "worker": "claude", "role": "example lane: planning and code review", "model": "opus", "effort": "high", "speed": null },
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
