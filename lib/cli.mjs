/**
 * Per-product CLI adapters: binary resolution, argument construction, output
 * parsing, and failure classification.
 *
 * Everything here drives the OFFICIAL CLI of each product through its own
 * subscription login. No browser automation, no cookie reading, no key
 * creation, and no touching of the user's private conversations: each worker
 * runs in its own working directory with its own dedicated session id.
 *
 * @module dsh-external-workers/cli
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, delimiter } from 'node:path'
import { homedir } from 'node:os'
import { buildCustomArgs, readDotted } from './products.mjs'

const LOCAL = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
const ROAMING = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')

/** A failure that names why the worker cannot run (as opposed to a task that failed). */
export class CliError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'CliError'
    this.kind = kind
  }
}

/** Expand `~` and `%VAR%`/`$VAR` in a configured path. */
export function expandPath(value) {
  if (typeof value !== 'string' || value.length === 0) return value
  let out = value
  if (out.startsWith('~')) out = join(homedir(), out.slice(1))
  out = out.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (m, name) => process.env[name] ?? m)
  out = out.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name) => process.env[name] ?? m)
  return out
}

/** Directory entries, newest first, ignoring failures. */
function entriesSortedByMtime(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const full = join(dir, entry.name)
        let mtime = 0
        try { mtime = statSync(full).mtimeMs } catch { /* ignore */ }
        return { name: entry.name, full, isDir: entry.isDirectory(), mtime }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

/**
 * Find the newest file named `fileName` under `root`, at most `depth` levels deep.
 * @returns the absolute path, or null.
 */
function findNewestFile(root, fileName, depth = 2) {
  if (!existsSync(root)) return null
  let best = null
  const walk = (dir, level) => {
    for (const entry of entriesSortedByMtime(dir)) {
      if (entry.isDir) {
        if (level > 0) walk(entry.full, level - 1)
        continue
      }
      if (entry.name.toLowerCase() === fileName.toLowerCase()) {
        if (best === null || entry.mtime > best.mtime) best = { path: entry.full, mtime: entry.mtime }
      }
    }
  }
  walk(root, depth)
  return best === null ? null : best.path
}

/** Look a command name up on PATH (Windows extensions included). */
function lookupOnPath(names) {
  const pathValue = process.env.PATH ?? ''
  for (const dir of pathValue.split(delimiter)) {
    if (dir.length === 0) continue
    for (const name of names) {
      const candidate = join(dir, name)
      try { if (existsSync(candidate) && statSync(candidate).isFile()) return candidate } catch { /* ignore */ }
    }
  }
  return null
}

/** Per-worker discovery recipe. Ordered: first hit wins. */
const DISCOVERY = {
  claude: {
    names: ['claude.exe', 'claude.cmd', 'claude.bat', 'claude'],
    roots: [
      // A native install (`claude install stable`) is the stable choice: its
      // path never moves. The Desktop-bundled copy below is version+hash keyed.
      join(homedir(), '.local', 'bin'),
      join(LOCAL, 'Programs', 'claude-code'),
      join(LOCAL, 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude', 'claude-code'),
      join(ROAMING, 'Claude', 'claude-code'),
      join(LOCAL, 'Claude', 'claude-code'),
    ],
    file: 'claude.exe',
    depth: 2,
    hint: 'Install Claude Code (`claude install stable`), then sign in once with `claude auth login`.',
  },
  gpt: {
    names: ['codex.exe', 'codex.cmd', 'codex.bat', 'codex'],
    roots: [
      join(LOCAL, 'OpenAI', 'Codex', 'bin'),
      join(homedir(), '.codex', '.sandbox-bin'),
    ],
    file: 'codex.exe',
    depth: 1,
    hint: 'Install the Codex CLI, or run `codex login`.',
  },
  google: {
    names: ['agy.exe', 'agy.cmd', 'agy.bat', 'agy'],
    roots: [
      join(LOCAL, 'agy', 'bin'),
      join(LOCAL, 'Programs', 'agy', 'bin'),
    ],
    file: 'agy.exe',
    depth: 1,
    hint: 'Install Antigravity CLI: irm https://antigravity.google/cli/install.ps1 | iex   (then sign in once with `agy`).',
  },
}

/**
 * Resolve the CLI binary for one worker.
 * @param worker - 'claude' | 'gpt' | 'google', or a custom product id
 * @param workerCfg - that worker's config block (may pin `cliPath`).
 * @param recipe - a custom product recipe (null/undefined for the built-ins).
 * @returns the absolute path of an existing file.
 * @throws CliError('cli-missing') when nothing usable is found.
 */
export function resolveCli(worker, workerCfg = {}, recipe = null) {
  if (typeof workerCfg.cliPath === 'string' && workerCfg.cliPath.trim().length > 0) {
    const pinned = expandPath(workerCfg.cliPath.trim())
    if (!existsSync(pinned)) throw new CliError('cli-missing', `configured cliPath does not exist: ${pinned}`)
    return pinned
  }

  // A custom product describes its own discovery, so no code change is needed
  // to support it. `bin.file` (defaulting to the first name) is what the newest
  // search under each root looks for; the names are what PATH is searched for.
  if (recipe !== null && recipe !== undefined) {
    const bin = recipe.bin
    for (const root of bin.roots) {
      const found = findNewestFile(expandPath(root), bin.file, bin.depth)
      if (found !== null) return found
    }
    const onPath = lookupOnPath(bin.names)
    if (onPath !== null) return onPath
    throw new CliError('cli-missing', `no ${recipe.id} CLI found. ${bin.hint}`)
  }

  const discovery = DISCOVERY[worker]
  if (discovery === undefined) throw new CliError('cli-missing', `unknown worker "${worker}"`)

  for (const root of discovery.roots) {
    const found = findNewestFile(root, discovery.file, discovery.depth)
    if (found !== null) return found
  }
  const onPath = lookupOnPath(discovery.names)
  if (onPath !== null) return onPath
  throw new CliError('cli-missing', `no ${worker} CLI found. ${discovery.hint}`)
}

/** True when the pid is still a live process (Windows-safe existence probe). */
export function processAlive(pid) {
  if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** The short instruction every worker receives; the real payload is the packet file. */
export function buildPrompt(job) {
  const rel = `jobs/${job.id}`
  return [
    'You are an external worker invoked through the DeepSeek Harness worker bridge.',
    `Working directory: ${job.cwd}`,
    `Read the complete task packet at ./${rel}/packet.md and carry the task out.`,
    'The packet holds the task, inlined context (files, logs, references), the acceptance criteria, and what to do with deliverables.',
    `Write every deliverable file under ./${rel}/out/ .`,
    'Do not ask clarifying questions. If something genuinely blocks you, say exactly what blocked you.',
    'End your final message with these four sections: ## RESULT, ## DECISIONS, ## ARTIFACTS, ## BLOCKERS.',
  ].join('\n')
}

/**
 * Build the exact command line for one run.
 * @param recipe - custom product recipe; when present the command line comes
 *                 from its templates instead of a hand-written branch.
 * @returns { file, args, cwd, env }
 */
export function buildInvocation(worker, job, workerCfg = {}, runtimeCfg = {}, recipe = null) {
  const file = resolveCli(worker, workerCfg, recipe)
  const prompt = buildPrompt(job)
  const extra = Array.isArray(workerCfg.extraArgs) ? workerCfg.extraArgs.map(String) : []
  const timeoutMinutes = Number.isFinite(runtimeCfg.timeoutMinutes) ? runtimeCfg.timeoutMinutes : 30
  const resuming = job.newSession !== true && typeof job.sessionId === 'string' && job.sessionId.length > 0
  const images = Array.isArray(job.images) ? job.images.filter((p) => typeof p === 'string') : []

  if (recipe !== null && recipe !== undefined) {
    const args = buildCustomArgs(recipe, {
      prompt,
      session: resuming ? job.sessionId : null,
      model: typeof job.model === 'string' && job.model.length > 0 ? job.model : null,
      effort: typeof job.effort === 'string' && job.effort.length > 0 ? job.effort : null,
      speed: typeof job.speed === 'string' && job.speed.length > 0 ? job.speed : null,
      cwd: job.cwd,
      timeout: timeoutMinutes,
      images,
    })
    args.push(...extra)
    return { file, args, cwd: job.cwd, env: {} }
  }

  if (worker === 'claude') {
    const args = ['-p', prompt, '--output-format', 'json']
    if (resuming) args.push('--resume', job.sessionId)
    if (typeof job.model === 'string' && job.model.length > 0) args.push('--model', job.model)
    if (typeof job.effort === 'string' && job.effort.length > 0) args.push('--effort', job.effort)
    if (typeof workerCfg.permissionMode === 'string' && workerCfg.permissionMode.length > 0) {
      args.push('--permission-mode', workerCfg.permissionMode)
    }
    args.push('--add-dir', job.cwd)
    args.push(...extra)
    return { file, args, cwd: job.cwd, env: {} }
  }

  if (worker === 'gpt') {
    const args = ['exec']
    if (resuming) args.push('resume', job.sessionId)
    args.push('--json', '--skip-git-repo-check')
    if (!resuming) args.push('-C', job.cwd)
    args.push('-c', `sandbox_mode="${workerCfg.sandboxMode ?? 'workspace-write'}"`)
    args.push('-c', `approval_policy="${workerCfg.approvalPolicy ?? 'never'}"`)
    // Every knob goes through -c: `codex exec resume` accepts none of the
    // dedicated flags, and -c behaves identically on both paths.
    if (job.model !== null && typeof job.model === 'string' && job.model.length > 0) args.push('-c', `model="${job.model}"`)
    if (typeof job.effort === 'string' && job.effort.length > 0) args.push('-c', `model_reasoning_effort="${job.effort}"`)
    if (typeof job.speed === 'string' && job.speed.length > 0) args.push('-c', `service_tier="${job.speed}"`)
    for (const image of images) args.push('-i', image)
    args.push(...extra)
    args.push(prompt)
    return { file, args, cwd: job.cwd, env: {} }
  }

  if (worker === 'google') {
    const args = ['-p', prompt, '--output-format', 'json', '--print-timeout', `${timeoutMinutes + 5}m`]
    if (resuming) args.push('--conversation', job.sessionId)
    if (typeof job.model === 'string' && job.model.length > 0) args.push('--model', job.model)
    if (typeof job.effort === 'string' && job.effort.length > 0) args.push('--effort', job.effort)
    args.push(...extra)
    return { file, args, cwd: job.cwd, env: {} }
  }

  throw new CliError('cli-missing', `unknown worker "${worker}"`)
}

/**
 * Parse a custom product's output using its recipe.
 *
 * `json` reads the whole stdout as one object; `jsonl` walks the lines and keeps
 * the LAST event that carries each field (the usual streaming shape); `text`
 * takes stdout as the result and pulls the session out with a regex when the
 * recipe gives one.
 */
export function parseCustom(recipe, text) {
  const empty = { sessionId: null, resultText: null, errorText: null, usage: null, raw: null }
  const output = recipe.output
  const pick = (value, path) => {
    const found = path === null ? undefined : readDotted(value, path)
    return typeof found === 'string' && found.length > 0 ? found : null
  }

  if (output.format === 'text') {
    const body = text.trim()
    let sessionId = null
    if (output.sessionPattern !== null) {
      const match = output.sessionPattern.exec(text)
      if (match !== null && typeof match[1] === 'string' && match[1].length > 0) sessionId = match[1]
    }
    return { sessionId, resultText: body.length > 0 ? body : null, errorText: null, usage: null, raw: null }
  }

  if (output.format === 'jsonl') {
    let sessionId = null
    let resultText = null
    let errorText = null
    let model = null
    let usage = null
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.length === 0 || trimmed[0] !== '{') continue
      let event
      try { event = JSON.parse(trimmed) } catch { continue }
      sessionId = pick(event, output.session) ?? sessionId
      resultText = pick(event, output.text) ?? resultText
      errorText = pick(event, output.error) ?? errorText
      model = pick(event, output.model) ?? model
      if (event.usage !== undefined && event.usage !== null && typeof event.usage === 'object') usage = event.usage
    }
    return { sessionId, resultText, errorText, usage, raw: model === null ? null : { model } }
  }

  const envelope = lastJsonObject(text)
  if (envelope === null) return empty
  return {
    sessionId: pick(envelope, output.session),
    resultText: pick(envelope, output.text),
    errorText: pick(envelope, output.error),
    usage: envelope.usage !== undefined && envelope.usage !== null && typeof envelope.usage === 'object' ? envelope.usage : null,
    raw: envelope,
  }
}

/**
 * Parse one worker's stdout into a normalized run result.
 * @returns { sessionId, resultText, errorText, usage, raw }
 */
export function parseRun(worker, stdoutText, recipe = null) {
  const text = typeof stdoutText === 'string' ? stdoutText : ''
  if (recipe !== null && recipe !== undefined) return parseCustom(recipe, text)
  if (worker === 'gpt') return { ...parseCodex(text), raw: null }
  const envelope = lastJsonObject(text)
  const parsed = worker === 'claude' ? parseClaude(envelope) : parseAgy(envelope)
  return { ...parsed, raw: envelope }
}

/** Parse the last complete JSON object out of a text blob. */
function lastJsonObject(text) {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  try { return JSON.parse(trimmed) } catch { /* fall through */ }
  const lines = trimmed.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (line.length === 0 || line[0] !== '{') continue
    try { return JSON.parse(line) } catch { /* keep looking */ }
  }
  return null
}

/** Parse the Codex `--json` event stream. */
function parseCodex(text) {
  let sessionId = null
  let resultText = null
  let errorText = null
  let usage = null
  const commentary = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed[0] !== '{') continue
    let event
    try { event = JSON.parse(trimmed) } catch { continue }
    const type = typeof event.type === 'string' ? event.type : ''
    if (type === 'thread.started' && typeof event.thread_id === 'string') sessionId = event.thread_id
    if (type === 'turn.completed' && typeof event.usage === 'object') usage = event.usage
    if (type === 'error' || type === 'turn.failed') {
      errorText = typeof event.message === 'string' ? event.message : JSON.stringify(event)
    }
    if ((type === 'item.completed' || type === 'item.updated') && typeof event.item === 'object' && event.item !== null) {
      const item = event.item
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        if (item.phase === 'final_answer' || item.phase === undefined || item.phase === null) resultText = item.text
        else commentary.push(item.text)
      }
      if (item.type === 'error' && typeof item.message === 'string') errorText = item.message
    }
  }
  if (resultText === null && commentary.length > 0) resultText = commentary[commentary.length - 1]
  return { sessionId, resultText, errorText, usage }
}

/** Parse the Claude Code `--output-format json` envelope. */
function parseClaude(envelope) {
  if (envelope === null || typeof envelope !== 'object') return { sessionId: null, resultText: null, errorText: null, usage: null }
  const isError = envelope.is_error === true || envelope.subtype === 'error'
  const result = typeof envelope.result === 'string' ? envelope.result : null
  return {
    sessionId: typeof envelope.session_id === 'string' ? envelope.session_id : null,
    resultText: isError ? null : result,
    errorText: isError ? (result ?? 'claude reported an error') : null,
    usage: typeof envelope.usage === 'object' ? envelope.usage : null,
  }
}

/** Parse the Antigravity CLI `--output-format json` envelope. */
function parseAgy(envelope) {
  if (envelope === null || typeof envelope !== 'object') return { sessionId: null, resultText: null, errorText: null, usage: null }
  const isError = typeof envelope.status === 'string' && envelope.status.toUpperCase() === 'ERROR'
  return {
    sessionId: typeof envelope.conversation_id === 'string' && envelope.conversation_id.length > 0 ? envelope.conversation_id : null,
    resultText: isError ? null : (typeof envelope.response === 'string' ? envelope.response : null),
    errorText: isError ? (typeof envelope.error === 'string' && envelope.error.length > 0 ? envelope.error : 'agy reported an error') : null,
    usage: typeof envelope.usage === 'object' ? envelope.usage : null,
  }
}

/** Failure signatures, checked in order. */
const FAILURE_RULES = [
  { kind: 'needs-login', retryable: false, re: /not logged in|please run \/login|authentication required|unauthenticated|invalid api key|please log ?in|sign ?in required|no credentials/i },
  { kind: 'quota', retryable: true, re: /quota|rate ?limit|usage limit|too many requests|\b429\b|credits? (?:exhausted|exceeded)|capacity/i },
  { kind: 'cli-missing', retryable: false, re: /is not recognized|command not found|enoent|no such file/i },
  { kind: 'timeout', retryable: true, re: /timed? ?out|timeout/i },
]

/**
 * Decide a job's terminal state from the exit code and the text the CLI produced.
 * @returns { status, failureKind, retryable, message }
 */
export function classifyFailure({ exitCode, stderrText, errorText }) {
  const haystack = `${errorText ?? ''}\n${stderrText ?? ''}`
  for (const rule of FAILURE_RULES) {
    if (rule.re.test(haystack)) {
      return {
        status: rule.retryable ? 'retryable' : 'blocked',
        failureKind: rule.kind,
        retryable: rule.retryable,
        message: `${rule.kind}: ${(errorText ?? stderrText ?? '').trim().slice(0, 600) || `exit code ${exitCode}`}`,
      }
    }
  }
  return {
    status: 'failed',
    failureKind: 'error',
    retryable: true,
    message: (errorText ?? stderrText ?? '').trim().slice(0, 600) || `worker exited with code ${exitCode}`,
  }
}

/** Where a worker's CLI keeps its own state, for the doctor report. */
export function cliStatePaths(worker, recipe = null) {
  if (recipe !== null && recipe !== undefined) return recipe.stateDir === null ? null : expandPath(recipe.stateDir)
  if (worker === 'claude') return join(homedir(), '.claude')
  if (worker === 'gpt') return join(homedir(), '.codex')
  return join(homedir(), '.gemini', 'antigravity-cli')
}

// ── the ACTUAL model, as the product reported it ──────────────────────────
// The requested model is what we passed on the command line; the product often
// resolves an alias (or applies its own default), so each one records the truth
// somewhere different:
//   claude -> the `modelUsage` map of its --output-format json envelope
//   gpt    -> the rollout file's `"model"` fields
//   google -> the conversation's own sqlite blobs
// Every reader is best effort: any failure leaves the value null instead of
// breaking the job.

// NOTE: matchAll() requires the global flag — without it the whole reader throws.
const MODEL_PATTERN = /(gemini-[0-9][0-9a-z.-]*|claude-[0-9][0-9a-z.-]*|gpt-oss-[0-9a-z-]*|gpt-[0-9][0-9a-z.-]*)/gi

/** Read at most `maxBytes` from the head of a file. */
function readHead(path, maxBytes) {
  try {
    const buffer = readFileSync(path)
    return (buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer).toString('utf8')
  } catch {
    return null
  }
}

/** Codex: today's (then the previous two days') rollout directory, matched by thread id. */
function codexRolloutModel(threadId) {
  if (typeof threadId !== 'string' || threadId.length === 0) return null
  const root = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  const pad = (value) => String(value).padStart(2, '0')
  for (let back = 0; back < 3; back += 1) {
    const day = new Date(Date.now() - back * 86400000)
    const dir = join(root, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()))
    let names
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (name.includes(threadId) !== true) continue
      const text = readHead(join(dir, name), 4 * 1024 * 1024)
      if (text === null) continue
      const counts = new Map()
      for (const match of text.matchAll(/"model"\s*:\s*"([^"]+)"/g)) {
        if (typeof match[1] === 'string' && match[1].length > 0) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
      }
      if (counts.size > 0) return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
  }
  return null
}

/** Antigravity: the conversation's own sqlite file, scanned for an ASCII model run. */
async function agyConversationModel(conversationId) {
  if (typeof conversationId !== 'string' || conversationId.length === 0) return null
  const file = join(homedir(), '.gemini', 'antigravity-cli', 'conversations', `${conversationId}.db`)
  if (!existsSync(file)) return null
  let DatabaseSync
  try {
    ({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return null
  }
  let db
  try {
    db = new DatabaseSync(file, { readOnly: true })
  } catch {
    return null
  }
  try {
    const counts = new Map()
    for (const table of ['gen_metadata', 'executor_metadata', 'steps', 'battle_mode_infos']) {
      let rows
      try { rows = db.prepare(`SELECT * FROM ${table} LIMIT 60`).all() } catch { continue }
      for (const row of rows) {
        for (const value of Object.values(row)) {
          const buffer = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(String(value), 'utf8')
          for (const match of buffer.toString('latin1').matchAll(MODEL_PATTERN)) {
            counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
          }
        }
      }
    }
    // A placeholder default (MODEL_PLACEHOLDER_M318) is not a model anyone asked for.
    const ranked = [...counts.entries()].filter(([name]) => /^MODEL_/i.test(name) !== true).sort((a, b) => b[1] - a[1])
    return ranked.length > 0 ? ranked[0][0] : null
  } catch {
    return null
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
}

/**
 * The model the worker actually ran on, or null when the product does not say.
 * @param worker - 'claude' | 'gpt' | 'google'
 * @param parsed - a parseRun() result (its `raw` carries the Claude envelope)
 * @param sessionId - the worker session this run used
 */
export async function readActualModel(worker, parsed, sessionId, recipe = null) {
  try {
    // A custom product reports its model only if its recipe says where. Anything
    // else stays null rather than being guessed at from a name pattern.
    if (recipe !== null && recipe !== undefined) {
      const path = recipe.output.model
      if (path === null) return null
      const found = readDotted(parsed?.raw, path)
      return typeof found === 'string' && found.length > 0 ? found : null
    }
    if (worker === 'claude') {
      const usage = parsed === null || parsed === undefined ? undefined : parsed.raw?.modelUsage
      if (usage !== undefined && usage !== null && typeof usage === 'object') {
        const names = Object.keys(usage)
        if (names.length > 0) return names[0]
      }
      return null
    }
    if (worker === 'gpt') return codexRolloutModel(sessionId)
    if (worker === 'google') return await agyConversationModel(sessionId)
    return null
  } catch {
    return null
  }
}
