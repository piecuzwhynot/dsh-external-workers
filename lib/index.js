/**
 * dsh-external-workers — a host-plane bridge to persistent external agent
 * workers (Claude Code, Codex CLI, Antigravity CLI).
 *
 * Design, in one paragraph: this row is a plain host-plane plugin. It publishes
 * no service, so it needs no `isolate` realm, and it never touches a persona, an
 * injection, a memory pipeline, or a compaction prompt. The six tools are
 * registered into the scope of the sessions it CHOOSES — the host listens for
 * `agent/created` and registers into that agent's own `agent.ctx`, so a session
 * excluded by preset, workspace, or id keeps a byte-for-byte unchanged tool
 * catalog and system prompt. Job state and external session ids live in the
 * durable `external_workers` storage domain
 * (`$DSH_HOME/storages/external_workers.json`), NOT in `ctx.jobs` (process-local,
 * in-memory) and NOT in any model context — so compaction, a forgotten
 * conversation, or a full harness restart cannot lose a job.
 *
 * @module dsh-external-workers
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { storeSpec, newJobRecord, newWorkerRecord, WORKERS, WORKER_LABEL, LANE_ID_PATTERN } from './store.mjs'
import { legacyAdoption, laneTableFrom, pickLaneFrom } from './lanes.mjs'
import { customProducts, knownProductIds, recipeFor, labelFor, toolNameFor } from './products.mjs'
import { readQuota, describeQuota, quotaGate } from './quota.mjs'
import { readTranscript } from './transcript.mjs'
import { buildInvocation, parseRun, classifyFailure, processAlive, resolveCli, expandPath, CliError, cliStatePaths, readActualModel } from './cli.mjs'
import { buildPacket, listArtifacts, resolveUserPath } from './packet.mjs'
import { discoverModels, renderCatalog } from './models.mjs'

export const name = 'external-workers'
export const inject = ['tools', 'storageDomain']

const CONFIG_PATH = new URL('../config.json', import.meta.url)
const MAX_PARSE_BYTES = 32 * 1024 * 1024
const TOOL_NAMES = { claude: 'delegate_claude', gpt: 'delegate_gpt', google: 'delegate_google' }

const DEFAULTS = {
  workspaceRoot: '~/.dsh/workers',
  // No limit by default: a real worker job runs for hours, and killing one at 25
  // minutes threw away work that was already most of the way done.
  defaultTimeoutMinutes: 0,
  notifyOnCompletion: true,
  maxInlineFileBytes: 65536,
  maxTotalInlineBytes: 524288,
  logTailLines: 200,
  scope: { mode: 'per-session', excludePresets: [], excludeWorkspaces: [], excludeSessionIds: [] },
  workers: {
    claude: { enabled: true, permissionMode: 'acceptEdits' },
    gpt: { enabled: true, sandboxMode: 'workspace-write', approvalPolicy: 'never' },
    google: { enabled: true },
  },
}

/** Read config.json, merged under the defaults. Never throws: a broken file means defaults. */
function readConfig() {
  let raw = {}
  try { raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) } catch { raw = {} }
  return {
    ...DEFAULTS,
    ...raw,
    scope: { ...DEFAULTS.scope, ...(raw.scope ?? {}) },
    workers: {
      // Unknown keys are kept: a custom product needs its own block for
      // `cliPath`, `enabled` and `extraArgs`, and dropping it here would make
      // those settings silently unreadable.
      ...(raw.workers ?? {}),
      claude: { ...DEFAULTS.workers.claude, ...(raw.workers?.claude ?? {}) },
      gpt: { ...DEFAULTS.workers.gpt, ...(raw.workers?.gpt ?? {}) },
      google: { ...DEFAULTS.workers.google, ...(raw.workers?.google ?? {}) },
    },
  }
}

/** Normalise a Windows path for comparison. */
const normPath = (value) => String(value ?? '').replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()

/** Kill a whole process tree (workers spawn helper processes). */
function killTree(pid) {
  if (typeof pid !== 'number' || pid <= 0) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch { /* best effort */ }
}

function stamp(ms) {
  if (typeof ms !== 'number' || ms <= 0) return '-'
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

function oneLine(text, limit = 240) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function agentCwd(exec) {
  try {
    const cwd = exec?.agent?.session?.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) return cwd
  } catch { /* fall through */ }
  return process.cwd()
}

/** Read a text file's tail, capped, tolerating absence. */
function readCappedText(path, maxBytes) {
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return ''
    const buffer = readFileSync(path)
    if (buffer.length <= maxBytes) return buffer.toString('utf8')
    return buffer.subarray(buffer.length - maxBytes).toString('utf8')
  } catch {
    return ''
  }
}

/** Resolve the lazily-imported `createUserMessage`, or null when unavailable. */
async function loadUserMessageFactory() {
  try {
    const llm = await import('@deepseek-ai/dsh-llm')
    return typeof llm.createUserMessage === 'function' ? llm.createUserMessage : null
  } catch {
    return null
  }
}

/** Wait for a write stream to be fully flushed and closed. */
function closeStream(stream, graceMs = 2000) {
  return new Promise((resolve) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    try {
      if (stream.closed === true || stream.destroyed === true) return done()
      stream.once('close', done)
      stream.once('error', done)
      stream.end(() => setTimeout(done, 20))
      setTimeout(done, graceMs)
    } catch { done() }
  })
}

export async function apply(ctx, config) {
  const runtime = { ...DEFAULTS, ...(config ?? {}) }
  const workspaceRoot = expandPath(readConfig().workspaceRoot ?? runtime.workspaceRoot ?? DEFAULTS.workspaceRoot)
  const createUserMessage = await loadUserMessageFactory()

  const domain = await ctx.storageDomain.open(storeSpec)
  ctx.effect(() => () => domain.close())

  const jobs = domain.table('jobs')
  const workers = domain.table('workers')
  /** jobId → { child, timedOut, settled } */
  const live = new Map()
  /** sessionId → disposer[] for the tools attached to that agent */
  const attached = new Map()

  const log = (level, message) => {
    try { ctx.logger?.[level]?.(`[external-workers] ${message}`) } catch { /* ignore */ }
  }

  // ── lanes ────────────────────────────────────────────────────────────────
  // A lane is a product + a model + a role, with its OWN working directory and
  // its OWN persistent session. config.json seeds them; worker_config can add
  // and edit them at runtime (the store wins over the config file).
  //
  // The identity rules themselves are pure and live in ./lanes.mjs, because the
  // record-key migration there decides whether an existing session survives a
  // rename and must be testable without a running harness. These wrappers only
  // supply the config file and the durable table.

  // ── products ─────────────────────────────────────────────────────────────
  // The three built-ins plus every custom product a config recipe declares. The
  // recipe is what teaches the bridge how to drive a CLI it has never seen, so
  // these two helpers are how the rest of this file stays product-agnostic.

  /** Every product id that may carry a lane, in order. */
  const productIds = () => knownProductIds(readConfig())

  /** The custom recipe for a product, or null for a built-in. */
  const recipeOf = (worker) => recipeFor(readConfig(), worker)

  /** Display name for a product: built-in label, else the recipe's, else the id. */
  const productLabel = (worker) => WORKER_LABEL[worker] ?? labelFor(readConfig(), worker) ?? worker

  /** The delegate tool name for a product. */
  const toolName = (worker) => TOOL_NAMES[worker] ?? toolNameFor(readConfig(), worker) ?? `delegate_${worker}`

  // ── plan quota ───────────────────────────────────────────────────────────
  // Only Codex publishes its 5-hour / weekly allowance in a place anything can
  // read (its own rollout files), so `quotaOf` answers for gpt and returns null
  // for the rest. A null quota never blocks anything: it means "no opinion",
  // and the bridge still catches a hard limit reactively (quota -> retryable).

  const quotaThreshold = () => {
    const value = Number(readConfig().quota?.warnAtPercent)
    return Number.isFinite(value) && value > 0 && value <= 100 ? value : 90
  }

  const quotaOf = (worker, options = {}) => {
    if (readConfig().quota?.enabled === false) return null
    if (worker !== 'gpt') return null
    try { return readQuota({ product: worker, fresh: options.fresh === true }) } catch (error) { log('warn', `quota read failed: ${error?.message ?? error}`); return null }
  }

  /** One line about quota for a tool result, or null when there is nothing to say. */
  const quotaLine = (worker) => {
    const quota = quotaOf(worker)
    return quota === null ? null : `Codex quota: ${describeQuota(quota)}`
  }

  /** Every lane, merging the durable record over the config declaration. */
  const laneTable = () => laneTableFrom(readConfig(), [...workers.entries()], productIds())

  const laneOf = (laneId) => laneTable().find((lane) => lane.id === laneId)

  /** One product's lanes, in declaration order. */
  const lanesOfProduct = (worker) => laneTable().filter((lane) => lane.worker === worker)

  /** The legacy product-keyed record a lane should inherit, if any. */
  const adoptLegacy = (laneId) => legacyAdoption(laneId, readConfig(), (key) => workers.get(key), productIds())

  /**
   * Resolve the lane a delegation runs in. An explicit id must exist; otherwise
   * the product's first lane is the default.
   */
  const pickLane = (worker, laneId) => {
    if (productIds().includes(worker) !== true) {
      return { error: `unknown product "${worker}". Known: ${productIds().join(', ')}` }
    }
    return pickLaneFrom(laneTable(), worker, laneId)
  }

  const laneCwd = (laneId) => {
    const dir = join(workspaceRoot, laneId)
    mkdirSync(join(dir, 'jobs'), { recursive: true })
    return dir
  }

  const ensureLaneRecord = async (laneId, worker) => {
    const existing = workers.get(laneId)
    if (existing !== undefined) {
      // A lane created before lanes existed carries no id/worker: fill them in.
      if (existing.lane === laneId && existing.worker === worker) return existing
      const repaired = { ...existing, lane: laneId, worker }
      await workers.put(laneId, repaired)
      return repaired
    }
    // Moving a product-keyed record onto its first lane. Copy first, delete
    // second: if the delete fails the duplicate is harmless, a lost session
    // would not be. The assignment is cleared on purpose — role/model/effort/
    // speed used to be set for the whole PRODUCT, so they belong to no
    // particular lane; the lane's own config (or a later worker_config call)
    // owns those four, while the session and the state carry over intact.
    //
    // The DIRECTORY carries over too, and deliberately: the CLI agents key their
    // stored conversations by working directory (Claude Code keeps its
    // transcripts under ~/.claude/projects/<slug-of-cwd>/), so a session resumed
    // from a different folder may not be found at all. Renaming the lane must not
    // move the project out from under the session it is resuming. New lanes still
    // get ~/.dsh/workers/<lane id>.
    const adopted = adoptLegacy(laneId)
    if (adopted !== null) {
      const keepCwd = typeof adopted.legacy.cwd === 'string' && adopted.legacy.cwd.length > 0
      const migrated = { ...adopted.legacy, lane: laneId, worker, cwd: keepCwd ? adopted.legacy.cwd : laneCwd(laneId), role: null, model: null, effort: null, speed: null }
      await workers.put(laneId, migrated)
      try { await workers.delete(adopted.legacyKey) } catch { /* the copy is already durable */ }
      return migrated
    }
    const record = newWorkerRecord(laneId, worker, laneCwd(laneId))
    await workers.put(laneId, record)
    return record
  }

  /** The standing assignment for one lane (durable record wins, then config). */
  const settingsFor = (laneId) => {
    const lane = laneOf(laneId) ?? laneTable().find((candidate) => candidate.id === laneId)
    if (lane === undefined) return { role: null, model: null, effort: null, speed: null }
    return { role: lane.role, model: lane.model, effort: lane.effort, speed: lane.speed }
  }

  // ── lane operations: one implementation, two callers ─────────────────────
  // The `worker_config` tool (what the model calls) and the Settings page (what
  // the human clicks) edit the same lanes. Both go through these functions, so
  // the two surfaces cannot drift: same validation, same record writes, same
  // tool-description refresh.

  const ASSIGNMENT_FIELDS = ['role', 'model', 'effort', 'speed']

  const laneIdError = (laneId) => {
    if (laneId === null || laneId === undefined) return 'a lane id is required'
    if (LANE_ID_PATTERN.test(laneId) !== true) return `invalid lane id "${laneId}": use lowercase letters, digits, - or _, starting with a letter or digit.`
    return null
  }

  /** Set role/model/effort/speed on a lane that already exists. */
  const setLaneAssignment = async (laneId, fields = {}, options = {}) => {
    const invalid = laneIdError(laneId)
    if (invalid !== null) return { ok: false, error: invalid }
    const lane = laneOf(laneId)
    if (lane === undefined) return { ok: false, error: `no lane named "${laneId}". Known lanes: ${laneTable().map((item) => item.id).join(', ')}` }
    const clear = options.clear === true
    const named = ASSIGNMENT_FIELDS.filter((field) => typeof fields[field] === 'string' && fields[field].trim().length > 0)
    if (clear !== true && named.length === 0) return { ok: false, error: 'nothing to set: give at least one of role, model, effort, speed' }
    const record = await ensureLaneRecord(laneId, lane.worker)
    const next = { ...record }
    if (clear === true) {
      for (const field of (named.length > 0 ? named : ASSIGNMENT_FIELDS)) next[field] = null
    } else {
      for (const field of named) next[field] = fields[field].trim()
    }
    await workers.put(laneId, next)
    await refreshAttachments()
    return { ok: true, lane: laneOf(laneId) }
  }

  /** Create a lane on a product. */
  const createLane = async (laneId, worker, fields = {}) => {
    const invalid = laneIdError(laneId)
    if (invalid !== null) return { ok: false, error: invalid }
    if (typeof worker !== 'string' || productIds().includes(worker) !== true) {
      return { ok: false, error: `unknown product. Known products: ${productIds().join(' | ')}` }
    }
    if (workers.get(laneId) !== undefined || laneTable().some((lane) => lane.id === laneId)) {
      return { ok: false, error: `lane "${laneId}" already exists.` }
    }
    // With named lanes, a record keyed by a bare product name is treated as the
    // pre-lanes leftover and hidden from the roster (its product's first lane
    // owns that session), so creating one would make an invisible lane.
    if (productIds().includes(laneId) && laneTable().some((lane) => lane.worker === laneId)) {
      return { ok: false, error: `"${laneId}" is a product name, and that product already has lanes (${lanesOfProduct(laneId).map((lane) => lane.id).join(', ')}). Pick a different lane id.` }
    }
    const record = await ensureLaneRecord(laneId, worker)
    const next = { ...record }
    for (const field of ASSIGNMENT_FIELDS) {
      if (typeof fields[field] === 'string' && fields[field].trim().length > 0) next[field] = fields[field].trim()
    }
    await workers.put(laneId, next)
    await refreshAttachments()
    return { ok: true, lane: laneOf(laneId) }
  }

  /** Drop a lane from the roster. Past jobs and the workspace stay on disk. */
  const dropLane = async (laneId) => {
    const invalid = laneIdError(laneId)
    if (invalid !== null) return { ok: false, error: invalid }
    const declared = Array.isArray(readConfig().lanes)
      && readConfig().lanes.some((entry) => entry !== null && typeof entry === 'object' && String(entry.id ?? '').trim().toLowerCase() === laneId)
    const existing = workers.get(laneId)
    if (existing === undefined) {
      return {
        ok: false,
        error: declared
          ? `lane "${laneId}" is declared in config.json and has no stored state — remove it from that file's \`lanes\` array instead.`
          : `lane "${laneId}" has no stored state and is not declared in config.json.`,
      }
    }
    await workers.delete(laneId)
    await refreshAttachments()
    return { ok: true, declared, worker: existing.worker }
  }

  /** Everything the Settings page needs to render itself. */
  const settingsPayload = () => ({
    ok: true,
    lanes: laneTable().map((lane) => ({ ...lane })),
    products: productIds().map((worker) => ({
      id: worker,
      label: productLabel(worker),
      builtIn: WORKERS.includes(worker),
      hasRecipe: recipeOf(worker) !== null,
      lanes: lanesOfProduct(worker).length,
    })),
    quota: productIds().map((worker) => {
      const quota = quotaOf(worker)
      return quota === null
        ? { product: worker, readable: false, text: null }
        : { product: worker, readable: true, text: describeQuota(quota), willUseCredits: quota.willUseCredits }
    }),
    quotaWarnAtPercent: quotaThreshold(),
    workspaceRoot,
    configPath: fileURLToPath(CONFIG_PATH),
    configDeclaresLanes: Array.isArray(readConfig().lanes),
    laneIdPattern: String(LANE_ID_PATTERN),
  })

  const nextJobId = () => {
    let max = 0
    for (const id of jobs.keys()) {
      const match = /^ext-(\d+)$/.exec(id)
      if (match !== null) max = Math.max(max, Number(match[1]))
    }
    return `ext-${max + 1}`
  }

  // ── crash / restart reconciliation ───────────────────────────────────────
  // Anything that claims to be running but whose process is gone becomes an
  // explicit retryable job rather than a silent hole. Runs once per process.
  const reconcile = async () => {
    const now = Date.now()
    let repaired = 0
    for (const [id, job] of jobs.entries()) {
      if (job.status !== 'running' && job.status !== 'queued') continue
      if (job.status === 'running' && processAlive(job.pid)) continue
      await jobs.put(id, {
        ...job,
        status: 'retryable',
        retryable: true,
        failureKind: 'interrupted',
        finishedAt: now,
        pid: null,
        lastError: job.status === 'running'
          ? 'worker process is gone (harness restarted or the CLI died); the external session is intact — resume this job'
          : 'job never started (harness restarted); resume this job',
      })
      repaired += 1
    }
    return repaired
  }
  const interrupted = await reconcile()
  log('info', interrupted === 0 ? 'loaded; no interrupted jobs' : `reconciled ${interrupted} interrupted job(s) to retryable`)

  // ── completion notices ───────────────────────────────────────────────────
  const notifyOwner = (owner, job, headline) => {
    if (owner === undefined || owner === null || createUserMessage === null) return
    if (readConfig().notifyOnCompletion === false) return
    try {
      owner.inject(createUserMessage({
        content: [{ type: 'text', text: headline }],
        source: { kind: 'plugin', plugin: 'external-workers', form: 'notice', summary: `${job.worker} job ${job.id} ${job.status}` },
      }))
    } catch (error) {
      log('warn', `could not notify owner of ${job.id}: ${error?.message ?? error}`)
    }
  }

  const settle = async (jobId, outcome) => {
    const current = jobs.get(jobId)
    if (current === undefined) return undefined
    const next = { ...current, ...outcome }
    await jobs.put(jobId, next)
    return next
  }

  // ── the run ──────────────────────────────────────────────────────────────
  const runJob = async (jobId, owner) => {
    const job = jobs.get(jobId)
    if (job === undefined) return
    const cfg = readConfig()
    // Records written before lanes carry no lane id: the product name was the key then.
    const laneId = typeof job.lane === 'string' && job.lane.length > 0 ? job.lane : job.worker
    const workerCfg = cfg.workers[job.worker] ?? {}
    const record = await ensureLaneRecord(laneId, job.worker)

    if (workerCfg.enabled === false) {
      const settled = await settle(jobId, {
        status: 'blocked', retryable: false, failureKind: 'disabled', finishedAt: Date.now(),
        lastError: `worker "${job.worker}" is disabled in config.json`,
      })
      notifyOwner(owner, settled, `[external-workers] ${job.worker} job ${jobId} is blocked: that worker is disabled in config.json.`)
      return
    }

    const timeoutMinutes = Number.isFinite(job.timeoutMinutes) ? job.timeoutMinutes : cfg.defaultTimeoutMinutes
    let invocation
    try {
      invocation = buildInvocation(job.worker, job, workerCfg, { timeoutMinutes }, recipeOf(job.worker))
      // A value the CLI refused to take (a lane effort that contradicts the model
      // slug, say) is reported rather than dropped in silence.
      for (const note of invocation.notes ?? []) log('warn', `${jobId}: ${note}`)
    } catch (error) {
      const kind = error instanceof CliError ? error.kind : 'error'
      const settled = await settle(jobId, {
        status: kind === 'cli-missing' ? 'blocked' : 'failed',
        retryable: false,
        failureKind: kind,
        finishedAt: Date.now(),
        lastError: error.message,
      })
      await workers.put(laneId, { ...record, state: kind === 'cli-missing' ? 'cli-missing' : 'error', lastError: error.message })
      notifyOwner(owner, settled, `[external-workers] ${job.worker} job ${jobId} cannot run: ${error.message}`)
      return
    }

    await settle(jobId, { status: 'running', startedAt: Date.now(), attempts: (job.attempts ?? 0) + 1, failureKind: null, lastError: null, cli: invocation.file })

    let outStream
    let errStream
    try {
      outStream = createWriteStream(job.stdoutPath, { flags: 'a' })
      errStream = createWriteStream(job.stderrPath, { flags: 'a' })
    } catch (error) {
      await settle(jobId, { status: 'failed', retryable: true, finishedAt: Date.now(), lastError: `cannot open job logs: ${error.message}` })
      return
    }

    const child = spawn(invocation.file, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const state = { child, timedOut: false, settled: false }
    live.set(jobId, state)
    await jobs.put(jobId, { ...jobs.get(jobId), pid: child.pid ?? null })

    // A real worker job runs for hours, so no timeout is the sensible default:
    // `timeoutMinutes` of 0 (or null/undefined) means "let it run". A positive
    // number keeps the safety net for people who want one.
    const timed = Number.isFinite(timeoutMinutes) && timeoutMinutes > 0
    const timer = timed
      ? setTimeout(() => {
        state.timedOut = true
        killTree(child.pid)
      }, timeoutMinutes * 60 * 1000)
      : null

    child.stdout.pipe(outStream)
    child.stderr.pipe(errStream)

    const finish = async (exitCode, spawnError) => {
      if (state.settled) return
      state.settled = true
      if (timer !== null) clearTimeout(timer)
      live.delete(jobId)
      // The log files must be complete on disk before anything reads them back.
      await Promise.all([closeStream(outStream), closeStream(errStream)])

      const base = jobs.get(jobId)
      if (base === undefined) return
      const stdoutText = readCappedText(job.stdoutPath, MAX_PARSE_BYTES)
      const stderrText = readCappedText(job.stderrPath, 65536)
      const parsed = parseRun(job.worker, stdoutText, recipeOf(job.worker))

      const failure = spawnError !== undefined
        ? { status: 'blocked', failureKind: 'cli-missing', retryable: false, message: `cannot start ${invocation.file}: ${spawnError.message}` }
        : state.timedOut
          ? { status: 'retryable', failureKind: 'timeout', retryable: true, message: `worker exceeded ${timeoutMinutes} minutes and was killed; the worker session is intact` }
          : (exitCode === 0 && parsed.errorText === null && typeof parsed.resultText === 'string' && parsed.resultText.trim().length > 0)
            ? null
            : classifyFailure({ exitCode, stderrText: stderrText.slice(-8000), errorText: parsed.errorText })

      // A stale resume target must not wedge the worker forever: fall back to a
      // fresh dedicated session exactly once.
      const stale = failure !== null && base.sessionId !== null && base.newSession !== true
        && /no conversation|session .*not found|unknown session|invalid session|could not (?:find|resume)/i.test(String(failure.message))
      if (stale && (base.attempts ?? 0) < 2) {
        log('warn', `${jobId}: resume target ${base.sessionId} is gone; retrying with a fresh session`)
        await jobs.put(jobId, { ...base, sessionId: null, newSession: true, status: 'queued', retryable: false, lastError: null, failureKind: null, finishedAt: null, pid: null })
        await runJob(jobId, owner)
        return
      }

      const sessionId = parsed.sessionId ?? base.sessionId
      // What the product says it actually ran on (alias-resolved, or its own default).
      const actualModel = await readActualModel(job.worker, parsed, sessionId, recipeOf(job.worker))
      const artifacts = listArtifacts(job.jobDir, job.cwd)

      // Did this run spend paid credits? Compare the balance the product reports
      // now with the one read before the run. Only Codex reports a balance, so
      // this stays null everywhere else instead of guessing.
      let creditsSpent = null
      if (Number.isFinite(job.creditsBefore)) {
        const after = quotaOf(job.worker)?.credits?.balance ?? null
        if (Number.isFinite(after)) {
          const delta = job.creditsBefore - after
          if (delta > 0.0001) creditsSpent = Math.round(delta * 10000) / 10000
        }
      }

      const settled = await settle(jobId, {
        status: failure === null ? 'completed' : failure.status,
        retryable: failure === null ? false : failure.retryable,
        failureKind: failure === null ? null : failure.failureKind,
        exitCode: exitCode ?? null,
        finishedAt: Date.now(),
        pid: null,
        sessionId,
        actualModel,
        creditsSpent,
        lastError: failure === null ? null : failure.message,
        resultText: failure === null ? parsed.resultText : null,
        artifacts,
      })

      const latestWorkerRecord = workers.get(laneId) ?? record
      await workers.put(laneId, {
        ...latestWorkerRecord,
        lane: laneId,
        worker: job.worker,
        sessionId: sessionId ?? latestWorkerRecord.sessionId,
        cliPath: invocation.file,
        lastModel: actualModel ?? latestWorkerRecord.lastModel,
        state: failure === null
          ? 'ready'
          : failure.failureKind === 'needs-login' ? 'needs-login'
            : failure.failureKind === 'cli-missing' ? 'cli-missing'
              : latestWorkerRecord.state,
        lastUsedAt: Date.now(),
        resumeCount: (latestWorkerRecord.resumeCount ?? 0) + (base.newSession === true ? 0 : 1),
        lastJobId: jobId,
        lastError: failure === null ? null : failure.message,
      })

      // A run that spent credits is reported as such, prominently: this is money,
      // and the user asked to be told every time it happens.
      const creditNote = settled.creditsSpent === null || settled.creditsSpent === undefined
        ? ''
        : `\n⚠️ THIS RUN SPENT CREDITS: $${settled.creditsSpent.toFixed(4)} (balance was $${Number(settled.creditsBefore).toFixed(4)}). The plan allowance is exhausted until it resets.`
      const headline = failure === null
        ? `[external-workers] ${job.worker} job ${jobId} completed (worker session ${sessionId ?? 'unknown'}).\n${oneLine(settled.resultText, 700)}${artifacts.length > 0 ? `\nartifacts: ${artifacts.slice(0, 12).join(', ')}` : ''}${creditNote}\nRead the full result with check_external_job.`
        : `[external-workers] ${job.worker} job ${jobId} ended as ${settled.status} (${settled.failureKind}).\n${oneLine(settled.lastError, 700)}${settled.retryable ? '\nRetryable: use resume_external_job to continue the same worker session.' : ''}${creditNote}`
      notifyOwner(owner, settled, headline)
    }

    child.on('error', (error) => { void finish(null, error) })
    child.on('close', (code) => { void finish(code, undefined) })
  }

  const waitForJob = async (jobId, timeoutMs, signal) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const job = jobs.get(jobId)
      if (job === undefined) return undefined
      if (['completed', 'failed', 'blocked', 'retryable', 'canceled'].includes(job.status)) return job
      if (signal?.aborted === true) return jobs.get(jobId)
      if (Date.now() > deadline) return jobs.get(jobId)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  const formatJob = (job, options = {}) => {
    if (job === undefined) return '(no such job)'
    const lines = [
      `### ${job.id} — ${job.worker}${(typeof job.lane === 'string' && job.lane.length > 0) ? ` · lane \`${job.lane}\`` : ''} — **${job.status}**${job.retryable ? ' (retryable)' : ''}`,
      `task: ${oneLine(job.task, 200)}`,
      `worker session: ${job.sessionId ?? '(new on next run)'}   cwd: ${job.cwd}`,
      `created ${stamp(job.createdAt)} · started ${stamp(job.startedAt)} · finished ${stamp(job.finishedAt)} · attempts ${job.attempts}`,
    ]
    if (job.parentJobId !== null) lines.push(`continues job: ${job.parentJobId}`)
    if (typeof job.ownerSessionId === 'string' && job.ownerSessionId.length > 0) lines.push(`started from DSH session: ${job.ownerSessionId}`)
    const modelLine = [
      job.model ?? null,
      job.actualModel === null || job.actualModel === undefined ? null : `ran on ${job.actualModel}`,
      job.effort === null || job.effort === undefined ? null : `effort ${job.effort}`,
      job.speed === null || job.speed === undefined ? null : `speed ${job.speed}`,
    ].filter((part) => part !== null).join(' · ')
    if (modelLine.length > 0) lines.push(`model: ${modelLine}`)
    if (Number.isFinite(job.creditsSpent)) {
      lines.push(`⚠️ credits spent: $${job.creditsSpent.toFixed(4)}${Number.isFinite(job.creditsBefore) ? ` (balance was $${job.creditsBefore.toFixed(4)})` : ''}`)
    }
    if (job.failureKind !== null) lines.push(`failure: ${job.failureKind} — ${oneLine(job.lastError, 400)}`)
    if (Array.isArray(job.artifacts) && job.artifacts.length > 0) {
      lines.push(`artifacts:\n${job.artifacts.slice(0, 30).map((a) => `  - ${a}`).join('\n')}`)
    }
    if (options.includeOutput === true && typeof job.resultText === 'string') {
      const body = job.resultText.length > 12000 ? `${job.resultText.slice(0, 12000)}\n…(truncated — full text at ${job.stdoutPath})` : job.resultText
      lines.push('', '```', body, '```')
    }
    if (options.includeStderr === true) {
      const tail = readCappedText(job.stderrPath, 4000).trim()
      if (tail.length > 0) lines.push('', `stderr tail:\n\`\`\`\n${tail.slice(-2000)}\n\`\`\``)
    }
    return lines.join('\n')
  }

  // ── job creation ─────────────────────────────────────────────────────────
  const createJob = async ({ worker, laneId, args, exec, parentJobId = null, creditsBefore = null }) => {
    const cfg = readConfig()
    const lane = laneOf(laneId)
    if (lane === undefined) throw new Error(`no lane named "${laneId}"`)
    const settings = settingsFor(laneId)
    const sessionCwd = agentCwd(exec)

    // The record this lane continues. A lane that has just been renamed from a
    // product has no record of its own yet — its predecessor's record is what
    // carries the session, and resolving it here (not later, in
    // ensureLaneRecord) is what makes the FIRST delegation after the rename
    // resume the existing thread instead of silently opening a new one.
    const previous = workers.get(laneId) ?? adoptLegacy(laneId)?.legacy
    const explicitNew = args.new_session === true
    const wantsResume = explicitNew !== true && typeof previous?.sessionId === 'string' && previous.sessionId.length > 0

    // A worker's session and its working directory travel together: the CLI
    // agents key their stored conversations by cwd (Claude Code files
    // transcripts under ~/.claude/projects/<slug-of-cwd>/), so a lane that
    // inherited a session must run in the directory that session was born in, or
    // the resume may find nothing. A lane with no history of its own gets its own
    // office at ~/.dsh/workers/<lane id>.
    const explicitCwd = typeof args.cwd === 'string' && args.cwd.trim().length > 0 ? resolveUserPath(args.cwd.trim(), sessionCwd) : null
    const inheritedCwd = typeof previous?.cwd === 'string' && previous.cwd.length > 0 && existsSync(previous.cwd) ? previous.cwd : null
    const cwd = explicitCwd ?? inheritedCwd ?? laneCwd(laneId)
    mkdirSync(join(cwd, 'jobs'), { recursive: true })

    const jobId = nextJobId()
    const jobDir = join(cwd, 'jobs', jobId)
    mkdirSync(join(jobDir, 'out'), { recursive: true })

    const images = (args.images ?? []).map((path) => resolveUserPath(path, sessionCwd))
    const task = typeof args.task === 'string' ? args.task : ''
    const instruction = parentJobId === null ? null : `Follow-up to job ${parentJobId} in this same worker session.`
    const packet = buildPacket({
      jobId,
      worker,
      workerLabel: `${productLabel(worker)} — lane "${laneId}"${settings.role === null ? '' : ` (${settings.role})`}`,
      task,
      instruction,
      jobDir,
      cwd,
      sessionCwd,
      contextFiles: args.context_files ?? [],
      logs: args.logs ?? [],
      images,
      references: args.references ?? [],
      acceptance: args.acceptance ?? [],
      runtime: cfg,
    })

    const record = newJobRecord({
      id: jobId,
      worker,
      lane: laneId,
      task,
      instruction,
      parentJobId,
      jobDir,
      packetPath: packet.packetPath,
      cwd,
      cli: null,
      sessionId: wantsResume ? previous.sessionId : null,
      newSession: explicitNew,
      model: (typeof args.model === 'string' && args.model.length > 0 ? args.model : settings.model),
      effort: (typeof args.effort === 'string' && args.effort.length > 0 ? args.effort : settings.effort),
      speed: (typeof args.speed === 'string' && args.speed.length > 0 ? args.speed : settings.speed),
      creditsBefore,
      foreground: args.foreground === true,
      images,
      timeoutMinutes: Number.isFinite(args.timeout_minutes) ? args.timeout_minutes : cfg.defaultTimeoutMinutes,
      ownerSessionId: (() => { try { return exec?.agent?.id ?? null } catch { return null } })(),
      stdoutPath: join(jobDir, 'stdout.log'),
      stderrPath: join(jobDir, 'stderr.log'),
    })

    await jobs.put(jobId, record)
    await ensureLaneRecord(laneId, worker)
    if (packet.notes.length > 0) log('warn', `${jobId}: ${packet.notes.join('; ')}`)

    const owner = exec?.agent
    runJob(jobId, owner).catch((error) => log('error', `${jobId} crashed: ${error?.stack ?? error?.message ?? error}`))
    return { jobId, record }
  }

  // ── tool definitions ─────────────────────────────────────────────────────
  const TEXT_OUTPUT = {
    schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
    render(_args, value) { return [{ type: 'text', text: value.text }] },
  }

  const delegateParameters = (worker) => ({
    task: {
      type: 'string',
      required: true,
      description: 'The complete, self-contained task. The worker does NOT know this project, this conversation, or any prior context — state the goal, the constraints, and what "done" means.',
    },
    context_files: { type: 'array', items: { type: 'string' }, description: 'File/directory paths to inline into the task packet (absolute, or relative to this session\'s cwd).' },
    logs: { type: 'array', items: { type: 'string' }, description: 'Log file paths whose tail should be inlined.' },
    images: { type: 'array', items: { type: 'string' }, description: 'Screenshot/image paths the worker should look at.' },
    references: { type: 'array', items: { type: 'string' }, description: 'Extra notes, URLs, or facts the worker needs.' },
    acceptance: { type: 'array', items: { type: 'string' }, description: 'Explicit success criteria.' },
    cwd: { type: 'string', description: 'Working directory for the worker. Defaults to the lane\'s own persistent workspace (~/.dsh/workers/<lane>).' },
    lane: { type: 'string', description: 'Which lane to use (a lane = a product + a model + a role, with its own session and workspace). Omit for the product\'s default lane; see this tool\'s description for the available lanes.' },
    model: { type: 'string', description: 'Model override for this run only (see worker_config for the real list).' },
    effort: { type: 'string', description: 'Reasoning effort for this run only (low | medium | high | xhigh | max, per product).' },
    speed: { type: 'string', description: 'Speed/service tier for this run only, where the product has one (Codex: priority).' },
    new_session: { type: 'boolean', description: `true starts a FRESH dedicated ${worker} session instead of continuing the existing one. Default false (continue the same persistent session).` },
    foreground: { type: 'boolean', description: 'true waits for the worker to finish and returns the result directly. Default false: returns a job id immediately — collect it with check_external_job.' },
    timeout_minutes: { type: 'integer', description: 'Kill the worker after this many minutes. Default 0 = no limit, which is the sensible setting: a real job can run for hours.' },
    allow_quota: { type: 'boolean', description: `${worker === 'gpt' ? 'Codex' : 'The product'}'s plan allowance is nearly used up and the user was asked. Set true only after they said to continue.` },
    allow_credits: { type: 'boolean', description: 'The plan allowance is GONE and this run would spend paid credits. Set true only after the user explicitly approved spending them for this task.' },
  })

  const describeDelegate = (worker) => {
    const lanes = lanesOfProduct(worker)
    const custom = recipeOf(worker)
    const laneLines = lanes.map((lane) => {
      const model = [
        lane.model ?? '(product default)',
        lane.effort === null ? null : `effort ${lane.effort}`,
        lane.speed === null ? null : `speed ${lane.speed}`,
      ].filter((part) => part !== null).join(' · ')
      return `- \`${lane.id}\` — ${lane.role === null ? '**no role assigned yet — ask the user what this lane is for**' : lane.role} (model: ${model})`
    })
    return [
      `Delegate a task to the persistent ${productLabel(worker)} worker and return immediately with a job id.`,
      '',
      lanes.length > 1 ? '**This product runs several lanes. Each lane is a SEPARATE persistent session with its own working directory, so pick the lane whose role matches the task** (pass it as `lane`):' : 'This product runs one lane:',
      ...laneLines,
      '',
      'Lanes exist because a model switch inside one session degrades that session — one lane per model keeps them clean. Change a lane\'s role or model with worker_config.',
      '',
      custom === null
        ? `The worker runs as its own long-lived ${worker} session in its own dedicated working directory, through that product's official CLI and your existing subscription login. Delegated work does not consume this conversation's context, and it never touches your private chats in that product.`
        : `The worker runs as its own long-lived ${worker} session in its own dedicated working directory, driving that CLI exactly as config.json's "${worker}" product recipe describes. Delegated work does not consume this conversation's context.`,
      '',
      'Always ship the context the worker needs: name the relevant files, logs, screenshots and acceptance criteria in the arguments — the worker starts with zero knowledge of this project.',
      '',
      'By default the same lane session is reused across calls, so follow-up tasks build on what that worker already did. Pass new_session: true only for a deliberate clean slate. If this product\'s CLI cannot report a session id, every run is a fresh session.',
      '',
      'The job is durable: it survives compaction and a harness restart. Collect it with check_external_job; continue a blocked or failed one with resume_external_job.',
    ].join('\n')
  }

  /** Build a fresh set of the tool definitions (one set per attached session). */
  const buildTools = () => {
    const definitions = []

    // Built-ins plus every custom product: one delegate tool each.
    for (const worker of productIds()) {
      definitions.push(defineTool({
        name: toolName(worker),
        description: describeDelegate(worker),
        parameters: delegateParameters(worker),
        output: TEXT_OUTPUT,
        async execute(args, exec) {
          // Plan quota is checked BEFORE anything is written or spawned: the
          // point is to ask the user while the work has not started yet, not to
          // report a burned task afterwards. `fresh` because this is the moment
          // the answer has to be current.
          const quota = quotaOf(worker, { fresh: true })
          const gate = quotaGate(quota, {
            threshold: quotaThreshold(),
            allowQuota: args.allow_quota === true,
            allowCredits: args.allow_credits === true,
          })
          if (gate.blocked) return { text: gate.text }

          const picked = pickLane(worker, args.lane)
          if (picked.error !== undefined) return { text: picked.error }
          const { jobId, record } = await createJob({ worker, laneId: picked.lane.id, args, exec, creditsBefore: quota?.credits?.balance ?? null })
          const mode = record.sessionId === null
            ? `new session for this lane`
            : `continuing its session ${record.sessionId}`
          const text = args.foreground === true
            ? formatJob(await waitForJob(jobId, 60 * 60 * 1000, exec?.signal), { includeOutput: true })
            : [
              `Started ${worker} job **${jobId}** (lane \`${picked.lane.id}\` · ${mode}).`,
              `Poll it with \`check_external_job\` (job_id: ${jobId}).`,
              'It keeps running even if this conversation is compacted or the harness restarts.',
              quotaLine(worker),
            ].filter((line) => line !== null).join('\n')
          return { text }
        },
      }))
    }

    definitions.push(defineTool({
      name: 'check_external_job',
      description: [
        'Check the durable external-worker jobs started by delegate_claude / delegate_gpt / delegate_google.',
        '',
        'Works no matter what happened to this conversation: job records live on disk, not in context, so a compacted, restarted, or entirely different session can still read them.',
        'Omit job_id to list recent jobs (newest first). Pass job_id to read one in full, including the worker\'s final result, its artifacts, and any error.',
        'If a job is blocked or retryable, continue it with resume_external_job — the worker keeps its own external session, so it does not start over.',
      ].join('\n'),
      parameters: {
        job_id: { type: 'string', description: 'Exact job id (e.g. ext-3). Omit to list.' },
        worker: { type: 'string', description: 'Only jobs for this product (a built-in or a custom product id).' },
        lane: { type: 'string', description: 'Only jobs from this lane (see worker_config for the lane list).' },
        status: { type: 'string', description: 'Only jobs with this status (queued, running, completed, failed, blocked, retryable).' },
        include_output: { type: 'boolean', description: 'For a single job, include the worker\'s full final result text. Default true for a single job.' },
        include_stderr: { type: 'boolean', description: 'Also show the tail of the worker\'s stderr.' },
        limit: { type: 'integer', description: 'Maximum jobs to list. Default 10.' },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const all = [...jobs.entries()].map(([, job]) => job).sort((a, b) => b.createdAt - a.createdAt)

        if (typeof args.job_id === 'string' && args.job_id.trim().length > 0) {
          const job = jobs.get(args.job_id.trim())
          if (job === undefined) {
            const ids = all.slice(0, 15).map((item) => `${item.id}(${item.worker},${item.status})`).join(', ')
            return { text: `No job named "${args.job_id}". Known jobs: ${ids || '(none yet)'}` }
          }
          return { text: formatJob(job, { includeOutput: args.include_output !== false, includeStderr: args.include_stderr === true }) }
        }

        let filtered = all
        if (typeof args.worker === 'string' && args.worker.length > 0) filtered = filtered.filter((job) => job.worker === args.worker)
        if (typeof args.lane === 'string' && args.lane.length > 0) filtered = filtered.filter((job) => (job.lane || job.worker) === args.lane)
        if (typeof args.status === 'string' && args.status.length > 0) filtered = filtered.filter((job) => job.status === args.status)
        const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(50, args.limit)) : 10
        const shown = filtered.slice(0, limit)

        const laneLines = []
        for (const lane of laneTable()) {
          const record = workers.get(lane.id)
          const workerCfg = readConfig().workers[lane.worker] ?? {}
          let cli = record?.cliPath ?? null
          if (cli === null) {
            try { cli = resolveCli(lane.worker, workerCfg, recipeOf(lane.worker)) } catch (error) { cli = `(${error.message})` }
          }
          const model = [lane.model ?? 'default', lane.effort === null ? null : `effort ${lane.effort}`].filter((part) => part !== null).join(' ')
          // The CLI path is printed on purpose: `state` can be `cli-missing`, and
          // the concrete path (or the resolution error) is what tells you how to
          // fix it. It was computed and thrown away before — the old per-product
          // line showed it, and losing it would be a diagnostic regression.
          laneLines.push(`- ${lane.id} [${lane.worker}] ${lane.role ?? '(no role)'} · ${model} · state=${lane.state} · session=${lane.sessionId ?? 'none'}${lane.lastModel === null ? '' : ` · last ran ${lane.lastModel}`} · cli=${cli ?? '(unresolved)'}`)
        }
        const scopeLine = `Sessions holding these tools: ${attached.size > 0 ? [...attached.keys()].join(', ') : '(none yet)'}`
        const quotaLines = productIds().map((worker) => {
          const quota = quotaOf(worker)
          return quota === null ? null : `- ${worker}: ${describeQuota(quota)}`
        }).filter((line) => line !== null)
        const quotaBlock = quotaLines.length === 0 ? '' : `\n\nPlan quota (read from the product's own records):\n${quotaLines.join('\n')}`

        if (shown.length === 0) {
          // "Nothing recorded" and "your filter matched nothing" are different
          // facts, and telling them apart is the difference between a quiet
          // ledger and a typo in a lane name.
          const head = all.length === 0
            ? 'No external jobs recorded yet.'
            : `No jobs match that filter — ${all.length} recorded in total. Check the lane names below.`
          return { text: `${head}\n\nLanes:\n${laneLines.join('\n')}\n\n${scopeLine}${quotaBlock}` }
        }
        const counts = {}
        for (const job of all) counts[job.status] = (counts[job.status] ?? 0) + 1
        const summary = Object.entries(counts).map(([state, count]) => `${state}:${count}`).join('  ')
        const body = shown.map((job) => formatJob(job, { includeOutput: false })).join('\n\n')
        return { text: `Jobs (${summary})\n\n${body}\n\nLanes:\n${laneLines.join('\n')}\n\n${scopeLine}${quotaBlock}\n\nRead one in full with check_external_job(job_id: "…").` }
      },
    }))

    definitions.push(defineTool({
      name: 'resume_external_job',
      description: [
        'Continue an existing external-worker job in the SAME worker session, with a new instruction.',
        '',
        'Use it when a job is blocked or retryable (quota, crash, timeout, needs-login), or when you want the worker to do a follow-up step on work it already did. The worker keeps its own external session and working directory, so it does not start over — unlike delegate_* with new_session: true.',
        'The original job record is never rewritten: a new job is created that resumes the same worker session.',
      ].join('\n'),
      parameters: {
        job_id: { type: 'string', required: true, description: 'The job to continue.' },
        instruction: { type: 'string', required: true, description: 'What the worker should do next.' },
        extra_context: { type: 'array', items: { type: 'string' }, description: 'Additional file paths to inline for this follow-up.' },
        acceptance: { type: 'array', items: { type: 'string' }, description: 'Success criteria for this follow-up.' },
        foreground: { type: 'boolean', description: 'Wait for the result instead of returning a job id. Default false.' },
        timeout_minutes: { type: 'integer', description: 'Kill the worker after this many minutes. 0 = no limit; omit to keep the lane/product default.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const parent = jobs.get(String(args.job_id ?? '').trim())
        if (parent === undefined) {
          return { text: `No job named "${args.job_id}". Use check_external_job to list the known jobs.` }
        }
        const { jobId } = await createJob({
          worker: parent.worker,
          laneId: (typeof parent.lane === 'string' && parent.lane.length > 0) ? parent.lane : parent.worker,
          exec,
          parentJobId: parent.id,
          args: {
            task: args.instruction,
            context_files: args.extra_context ?? [],
            acceptance: args.acceptance ?? [],
            foreground: args.foreground === true,
            timeout_minutes: args.timeout_minutes,
            cwd: parent.cwd,
            // Resuming is the point: a new external session only when the parent never had one.
            new_session: parent.sessionId === null,
          },
        })
        if (parent.sessionId !== null) {
          const created = jobs.get(jobId)
          if (created !== undefined) await jobs.put(jobId, { ...created, sessionId: parent.sessionId, newSession: false })
        }
        const text = args.foreground === true
          ? formatJob(await waitForJob(jobId, 60 * 60 * 1000, exec?.signal), { includeOutput: true })
          : [
            `Resumed ${parent.worker} job **${parent.id}** as new job **${jobId}**.`,
            `Same worker session (${parent.sessionId ?? 'new'}), same working directory.`,
            'Poll it with `check_external_job`.',
          ].join('\n')
        return { text }
      },
    }))

    definitions.push(defineTool({
      name: 'worker_config',
      description: [
        'Read or change how the external workers are set up. The unit here is a LANE: one lane = one product + one model + one role, with its OWN persistent session and its OWN working directory.',
        '',
        'Lanes are how the user keeps different jobs apart. The same product can run several lanes — e.g. `gpt` on a fast model doing quick edits in one lane while `gpt` on a heavy model grinds through something long in another — because switching models inside a single session degrades that session (the products themselves warn about it).',
        '',
        'When the user wants to decide who does what, or which model runs it:',
        '  1. action "models" — the REAL model list from each product (never invent model names),',
        '  2. show the options and ask which lane gets which job, model and effort,',
        '  3. action "set" to assign an existing lane, or action "add" to create a new lane on a product.',
        '',
        'A role you set is written into that product\'s delegate tool description immediately, so later delegations route themselves.',
        'action "show" prints the roster. Fields left out of "set"/"add" are unchanged; clear: true resets the named fields.',
      ].join('\n'),
      parameters: {
        action: { type: 'string', required: true, enum: ['show', 'models', 'set', 'add', 'remove'], description: 'show = roster; models = the real model list per product; set = edit a lane; add = create a lane; remove = drop a lane from the roster.' },
        lane: { type: 'string', description: 'Lane id (e.g. "quick", "deep", or the product name). Required for set/add/remove.' },
        worker: { type: 'string', description: 'Product: a built-in (claude, gpt, google) or a custom product declared in config.json. Required for "add"; optional for "models" (defaults to all).' },
        model: { type: 'string', description: 'Model id/slug from action "models".' },
        effort: { type: 'string', description: 'Reasoning effort: low | medium | high | xhigh | max (per product).' },
        speed: { type: 'string', description: 'Speed/service tier where the product has one (Codex: priority = 2x speed).' },
        role: { type: 'string', description: 'What this worker is for, in the user\'s own words. This is what makes routing work.' },
        clear: { type: 'boolean', description: 'Reset the named fields (or all four when none are named) back to unset.' },
        fresh: { type: 'boolean', description: 'With action "models": re-read the model list from the product instead of trusting its cache. Use after a product ships a new model.' },
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const action = String(args.action ?? 'show')
        const one = typeof args.lane === 'string' && args.lane.trim().length > 0 ? args.lane.trim().toLowerCase() : null
        const product = typeof args.worker === 'string' && args.worker.length > 0 ? args.worker : null

        if (action === 'models') {
          const targets = product === null ? productIds() : [product]
          const blocks = []
          for (const worker of targets) {
            const catalog = await discoverModels(worker, readConfig().workers[worker] ?? {}, { fresh: args.fresh === true }, recipeOf(worker))
            blocks.push(renderCatalog(catalog))
          }
          return { text: `Real model catalogs (from each product itself):\n\n${blocks.join('\n\n')}\n\nNow assign one with worker_config(action: "set", lane: …, model: …, effort: …, role: "…").` }
        }

        if (action === 'add') {
          if (one === null) return { text: 'action "add" needs a `lane` id (lowercase letters, digits, - or _, e.g. "quick").' }
          if (product === null) {
            return { text: `action "add" needs a \`worker\`. Known products: ${productIds().join(' | ')}. (Add a custom product by declaring it under "products" in config.json.)` }
          }
          const created = await createLane(one, product, args)
          if (created.ok !== true) return { text: created.error }
          const lane = created.lane
          return {
            text: [
              `Created lane **${one}** on **${product}**.`,
              `role: ${lane?.role ?? '(none — tell me what it is for)'}`,
              `model: ${lane?.model ?? '(product default)'}${lane?.effort ? ` · effort ${lane.effort}` : ''}${lane?.speed ? ` · speed ${lane.speed}` : ''}`,
              `workspace: ~/.dsh/workers/${one}   session: (starts fresh on the first delegation)`,
              '',
              `It appears in ${product}'s delegate tool description now, so route ${one}'s work there.`,
            ].join('\n'),
          }
        }

        if (action === 'remove') {
          if (one === null) return { text: 'action "remove" needs a `lane`.' }
          const dropped = await dropLane(one)
          if (dropped.ok !== true) {
            return { text: `${dropped.error}${dropped.error.startsWith('lane "') ? ` Known lanes: ${laneTable().map((lane) => lane.id).join(', ')}` : ''}` }
          }
          return {
            text: [
              `Removed lane **${one}** from the roster. Its past jobs stay in the ledger; its workspace ~/.dsh/workers/${one} and its ${dropped.worker} session are left untouched on disk.`,
              dropped.declared === true
                ? `⚠️ config.json still declares "${one}", so it comes back on the next read — delete that entry from the \`lanes\` array to remove it for good.`
                : 'It was created at runtime, so it stays removed.',
            ].join('\n'),
          }
        }

        if (action === 'set') {
          if (one === null) return { text: 'action "set" needs a `lane` (see action "show" for the roster).' }
          const updated = await setLaneAssignment(one, args, { clear: args.clear === true })
          if (updated.ok !== true) return { text: updated.error }
          const lane = updated.lane
          return {
            text: [
              `Updated lane **${one}** [${lane?.worker ?? '?'}].`,
              `role: ${lane?.role ?? '(none)'}`,
              `model: ${lane?.model ?? '(product default)'}${lane?.effort ? ` · effort ${lane.effort}` : ''}${lane?.speed ? ` · speed ${lane.speed}` : ''}`,
              `session: ${lane?.sessionId ?? '(none yet — the next delegation opens one)'}`,
              '',
              lane?.sessionId === null || lane?.sessionId === undefined
                ? 'This lane has no session yet, so the next delegation opens a fresh one with the new settings.'
                : 'The lane keeps its existing session. Switching the model inside a running session is what the products warn about — pass new_session: true on the next delegation for a clean one.',
              'The change is already written into that product\'s delegate tool description.',
            ].join('\n'),
          }
        }

        const lines = ['| lane | product | role | model | effort | speed | session | last ran |', '|---|---|---|---|---|---|---|---|']
        for (const lane of laneTable()) {
          lines.push(`| ${lane.id} | ${lane.worker} | ${lane.role ?? '—'} | ${lane.model ?? '(default)'} | ${lane.effort ?? '—'} | ${lane.speed ?? '—'} | ${lane.sessionId ?? '—'} | ${lane.lastModel ?? '—'} |`)
        }
        return {
          text: [
            lines.join('\n'),
            '',
            'Each lane keeps its OWN session and working directory (~/.dsh/workers/<lane>), which is what keeps a model switch from degrading another model\'s thread.',
            'A lane renamed from a product keeps that product\'s directory on purpose: these CLIs key their stored conversations by working directory, so moving the folder would risk losing the session.',
            'Manage them with action "set" (edit), "add" (new lane on a product), "remove"; list real models with action "models".',
          ].join('\n'),
        }
      },
    }))

    return definitions
  }

  // ── session scoping: attach the tools to the sessions we choose ──────────
  const exclusionReason = (agent) => {
    const scope = readConfig().scope ?? DEFAULTS.scope
    const sessionId = typeof agent?.id === 'string' ? agent.id : ''
    let cwd = ''
    let preset = ''
    try {
      cwd = agent?.session?.header?.cwd ?? ''
      preset = agent?.session?.header?.agentPreset ?? ''
    } catch { /* ignore */ }

    if ((scope.excludeSessionIds ?? []).includes(sessionId)) return `session ${sessionId} is on the exclude list`
    if ((scope.excludePresets ?? []).includes(preset)) return `preset "${preset}" is on the exclude list`
    const normalized = normPath(cwd)
    for (const entry of scope.excludeWorkspaces ?? []) {
      if (normalized === normPath(entry)) return `workspace "${cwd}" is on the exclude list`
    }
    return null
  }

  const attachTools = (agent) => {
    const sessionId = typeof agent?.id === 'string' ? agent.id : null
    if (sessionId === null || attached.has(sessionId)) return
    // Fail safe: when the agent's own scope has no tools registry, attach nothing.
    // Falling back to the process-global registry would put these tools into EVERY
    // session's catalog — exactly what this plugin must never do.
    let tools = agent?.ctx?.tools
    if (tools === undefined || typeof tools.register !== 'function') {
      try { tools = agent?.ctx?.get?.('tools') } catch { tools = undefined }
    }
    if (tools === undefined || typeof tools.register !== 'function') {
      log('error', `session ${sessionId}: agent-scoped tools registry unavailable; NOT attaching (refusing to register globally, which would change every other session's catalog)`)
      return
    }
    const disposers = []
    try {
      for (const definition of buildTools()) disposers.push(tools.register(definition))
    } catch (error) {
      for (const dispose of disposers) { try { dispose() } catch { /* ignore */ } }
      log('warn', `session ${sessionId}: could not attach tools: ${error?.message ?? error}`)
      return
    }
    attached.set(sessionId, { agent, disposers })
    log('info', `attached ${disposers.length} external-worker tools to session ${sessionId}`)
  }

  const detachTools = (sessionId, why) => {
    const entry = attached.get(sessionId)
    if (entry === undefined) return
    for (const dispose of entry.disposers) { try { dispose() } catch { /* ignore */ } }
    attached.delete(sessionId)
    log('info', `detached external-worker tools from session ${sessionId} (${why})`)
  }

  /**
   * Re-register every attached session's tools. Role and model live in the
   * tool DESCRIPTION, so a new assignment only becomes visible to the model
   * once the definitions are rebuilt.
   */
  const refreshAttachments = async () => {
    const entries = [...attached.entries()].map(([sessionId, entry]) => [sessionId, entry.agent])
    for (const [sessionId] of entries) detachTools(sessionId, 'refreshing after a config change')
    for (const [, agent] of entries) attachTools(agent)
    log('info', `refreshed external-worker tool descriptions for ${entries.length} session(s)`)
  }

  ctx.on('agent/created', ({ agent } = {}) => {
    try {
      const mode = (readConfig().scope ?? DEFAULTS.scope).mode ?? 'per-session'
      if (mode !== 'per-session') {
        log('info', `scope.mode=${mode}; not attaching to session ${agent?.id}`)
        return
      }
      const reason = exclusionReason(agent)
      if (reason !== null) {
        log('info', `session ${agent?.id}: tools withheld — ${reason}`)
        return
      }
      attachTools(agent)
    } catch (error) {
      log('warn', `agent/created handling failed: ${error?.message ?? error}`)
    }
  })

  // A session switched onto an excluded preset mid-life must lose the tools again.
  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type !== 'agent-preset/selected') return
      const preset = event?.data?.agentPreset
      const scope = readConfig().scope ?? DEFAULTS.scope
      if (Array.isArray(scope.excludePresets) && scope.excludePresets.includes(preset)) {
        detachTools(session?.id, `preset switched to excluded "${preset}"`)
      }
    } catch { /* ignore */ }
  })

  // ── read-only JSON feed for the web panel ────────────────────────────────
  // The Client half of this plugin renders a dock row above the composer. It
  // reads the ledger through this one plain GET rather than an RPC channel:
  // no descriptor generation, and the route can never mutate anything.
  const PANEL_JOB_LIMIT = 40
  const buildPanelPayload = () => {
    const all = [...jobs.entries()].map(([, job]) => job).sort((a, b) => b.createdAt - a.createdAt)
    const counts = {}
    for (const job of all) counts[job.status] = (counts[job.status] ?? 0) + 1
    return {
      ok: true,
      generatedAt: Date.now(),
      total: all.length,
      counts,
      lanes: laneTable().map((lane) => ({ ...lane })),
      // Plan quota per product, when the product publishes it. `null` means
      // "this product does not report it", not "zero used".
      quota: productIds().map((worker) => {
        const quota = quotaOf(worker)
        return quota === null
          ? { product: worker, readable: false, text: null }
          : { product: worker, readable: true, text: describeQuota(quota), short: quota.short, long: quota.long, credits: quota.credits, willUseCredits: quota.willUseCredits, planType: quota.planType }
      }),
      threshold: quotaThreshold(),
      jobs: all.slice(0, PANEL_JOB_LIMIT).map((job) => ({
        id: job.id,
        worker: job.worker,
        lane: typeof job.lane === 'string' && job.lane.length > 0 ? job.lane : job.worker,
        status: job.status,
        task: oneLine(job.task, 160),
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        artifacts: Array.isArray(job.artifacts) ? job.artifacts.slice(0, 8) : [],
        failureKind: job.failureKind,
        lastError: job.lastError === null ? null : oneLine(job.lastError, 220),
        retryable: job.retryable === true,
        sessionId: job.sessionId,
        model: job.model,
        actualModel: job.actualModel,
        creditsSpent: job.creditsSpent ?? null,
        effort: job.effort,
        speed: job.speed,
        resultPreview: typeof job.resultText === 'string' ? oneLine(job.resultText, 400) : null,
      })),
    }
  }

  const webServer = ctx.get('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    const sendJson = (res, status, body) => {
      try {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      } catch { /* response already gone */ }
    }
    const methodOk = (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') return true
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return false
    }

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/external-workers/jobs',
      handler: (req, res) => {
        if (!methodOk(req, res)) return
        try { sendJson(res, 200, buildPanelPayload()) } catch (error) { sendJson(res, 500, { ok: false, error: String(error?.message ?? error) }) }
      },
    }))

    // One job in full: the complete result, the raw error, the stderr tail and
    // the on-disk paths — everything the compact feed deliberately truncates.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/external-workers/job',
      handler: (req, res) => {
        if (!methodOk(req, res)) return
        try {
          const url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
          const id = url.searchParams.get('id') ?? ''
          const job = jobs.get(id)
          if (job === undefined) {
            sendJson(res, 404, { ok: false, error: `no job named ${JSON.stringify(id)}` })
            return
          }
          sendJson(res, 200, {
            ok: true,
            lane: laneOf(typeof job.lane === 'string' && job.lane.length > 0 ? job.lane : job.worker) ?? null,
            job: {
              id: job.id,
              worker: job.worker,
              lane: typeof job.lane === 'string' && job.lane.length > 0 ? job.lane : job.worker,
              status: job.status,
              task: job.task,
              instruction: job.instruction,
              parentJobId: job.parentJobId,
              cwd: job.cwd,
              sessionId: job.sessionId,
              newSession: job.newSession,
              model: job.model,
              actualModel: job.actualModel,
              effort: job.effort,
              speed: job.speed,
              cli: job.cli,
              createdAt: job.createdAt,
              startedAt: job.startedAt,
              finishedAt: job.finishedAt,
              attempts: job.attempts,
              exitCode: job.exitCode,
              failureKind: job.failureKind,
              retryable: job.retryable,
              lastError: job.lastError,
              artifacts: Array.isArray(job.artifacts) ? job.artifacts : [],
              packetPath: job.packetPath,
              stdoutPath: job.stdoutPath,
              stderrPath: job.stderrPath,
              jobDir: job.jobDir,
              resultText: typeof job.resultText === 'string' ? job.resultText.slice(0, 400000) : null,
              stderrTail: readCappedText(job.stderrPath, 20000).trim().slice(-8000),
            },
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))

    // ── the Settings page: read the roster, and edit it ──────────────────────
    // The write side is deliberate about two things:
    //   1. it goes through the SAME operations as `worker_config`, so the page and
    //      the model can never disagree about what a lane is;
    //   2. it requires a custom header. The server is localhost-only, but "only
    //      this machine can reach it" is not "only this page can": a foreign site
    //      can send a simple cross-origin POST. Requiring a non-simple header
    //      forces a preflight the browser will then refuse.
    const WRITE_HEADER = 'x-external-workers'
    const MAX_BODY_BYTES = 64 * 1024

    const readJsonBody = (req) => new Promise((resolve, reject) => {
      let text = ''
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) { reject(new Error('request body too large')); try { req.destroy() } catch { /* ignore */ } return }
        text += chunk.toString('utf8')
      })
      req.on('end', () => {
        if (text.trim().length === 0) { resolve({}); return }
        try { resolve(JSON.parse(text)) } catch (error) { reject(new Error(`body is not valid JSON: ${error.message}`)) }
      })
      req.on('error', (error) => reject(error))
    })

    const applySettingsAction = async (body) => {
      const action = typeof body?.action === 'string' ? body.action : ''
      const laneId = typeof body?.lane === 'string' && body.lane.trim().length > 0 ? body.lane.trim().toLowerCase() : null
      const fields = { role: body?.role, model: body?.model, effort: body?.effort, speed: body?.speed }
      if (action === 'set') {
        const result = await setLaneAssignment(laneId, fields, { clear: body?.clear === true })
        return result.ok === true ? { ok: true, message: `lane "${laneId}" updated` } : result
      }
      if (action === 'add') {
        const worker = typeof body?.worker === 'string' ? body.worker.trim().toLowerCase() : null
        const result = await createLane(laneId, worker, fields)
        return result.ok === true ? { ok: true, message: `lane "${laneId}" created on ${worker}` } : result
      }
      if (action === 'remove') {
        const result = await dropLane(laneId)
        return result.ok === true
          ? { ok: true, message: result.declared === true ? `lane "${laneId}" dropped — but config.json still declares it` : `lane "${laneId}" dropped` }
          : result
      }
      return { ok: false, error: `unknown action ${JSON.stringify(action)} — use set, add or remove` }
    }

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/external-workers/settings',
      handler: (req, res) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          try { sendJson(res, 200, settingsPayload()) } catch (error) { sendJson(res, 500, { ok: false, error: String(error?.message ?? error) }) }
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        if (req.headers?.[WRITE_HEADER] !== '1') {
          sendJson(res, 403, { ok: false, error: `a write needs the ${WRITE_HEADER}: 1 header` })
          return
        }
        void (async () => {
          try {
            const body = await readJsonBody(req)
            const result = await applySettingsAction(body)
            if (result.ok !== true) { sendJson(res, 400, { ok: false, error: result.error }); return }
            sendJson(res, 200, { ...settingsPayload(), message: result.message })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
          }
        })()
      },
    }))

    // ── the conversation: read what the worker did, and answer it ────────────
    // Three routes, and each one is deliberately narrow:
    //   GET  conversation  — the worker's own transcript, parsed for a human
    //   POST say           — one message into that lane's session, as a job, so it
    //                        goes through the same quota gate and the same ledger
    //                        as any other delegation
    //   GET  artifact      — one file out of a job's own directory, because the
    //                        thing being judged is often a picture
    const MAX_ARTIFACT_BYTES = 24 * 1024 * 1024
    const CONTENT_TYPES = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
      '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
      '.log': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
    }

    const laneFromQuery = (url) => {
      const wanted = (url.searchParams.get('lane') ?? '').trim().toLowerCase()
      return wanted.length === 0 ? null : laneTable().find((lane) => lane.id === wanted) ?? null
    }

    /** The conversation of one lane, plus the artifacts its recent jobs produced. */
    const conversationPayload = (lane, limit) => {
      const record = workers.get(lane.id)
      // The lane's real directory: an adopted lane keeps the directory its
      // session was born in, and claude keys its transcript by that path.
      const cwd = typeof record?.cwd === 'string' && record.cwd.length > 0 ? record.cwd : laneCwd(lane.id)
      const transcript = readTranscript({ worker: lane.worker, sessionId: lane.sessionId, cwd, limit })
      const own = [...jobs.entries()].map(([, job]) => job)
        .filter((job) => (typeof job.lane === 'string' && job.lane.length > 0 ? job.lane : job.worker) === lane.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 8)
        .map((job) => ({
          id: job.id,
          status: job.status,
          task: oneLine(job.task, 90),
          createdAt: job.createdAt,
          finishedAt: job.finishedAt,
          artifacts: Array.isArray(job.artifacts) ? job.artifacts.slice(0, 40) : [],
        }))
      const running = own.find((job) => job.status === 'running' || job.status === 'queued') ?? null
      return {
        ok: true,
        lane: { id: lane.id, worker: lane.worker, role: lane.role, model: lane.model, model_actual: lane.lastModel, sessionId: lane.sessionId, state: lane.state, cwd },
        supported: transcript.ok === true,
        reason: transcript.reason,
        file: transcript.file,
        total: transcript.total ?? 0,
        turns: transcript.turns ?? [],
        jobs: own,
        running: running === null ? null : { id: running.id, task: oneLine(running.task, 90), startedAt: running.startedAt },
      }
    }

    /** Send one message into a lane's session. A job, so it is gated and recorded. */
    const sayInLane = async (body) => {
      const laneId = typeof body?.lane === 'string' ? body.lane.trim().toLowerCase() : ''
      const lane = laneTable().find((item) => item.id === laneId) ?? null
      if (lane === null) return { ok: false, error: `unknown lane ${JSON.stringify(laneId)}` }
      const message = typeof body?.message === 'string' ? body.message.trim() : ''
      if (message.length === 0) return { ok: false, error: 'the message is empty' }
      // Same gate as delegate_*: the panel must not become a way to spend credits
      // without the approval the tool path requires.
      const quota = quotaOf(lane.worker, { fresh: true })
      const gate = quotaGate(quota, {
        threshold: quotaThreshold(),
        allowQuota: body?.allow_quota === true,
        allowCredits: body?.allow_credits === true,
      })
      if (gate.blocked) return { ok: false, blocked: true, reason: gate.reason, error: gate.text }
      const created = await createJob({
        worker: lane.worker,
        laneId: lane.id,
        args: { task: message, foreground: false, new_session: body?.new_session === true },
        exec: null,
        creditsBefore: quota?.credits?.balance ?? null,
      })
      return { ok: true, jobId: created.jobId, sessionId: created.record.sessionId }
    }

    /** One artifact file, only from a job's own job directory. */
    const artifactRequest = (req, res, url) => {
      const lane = laneFromQuery(url)
      const jobId = (url.searchParams.get('job') ?? '').trim()
      const wanted = (url.searchParams.get('path') ?? '').trim()
      if (lane === null || jobId.length === 0 || wanted.length === 0) {
        sendJson(res, 400, { ok: false, error: 'need lane, job and path' })
        return
      }
      const job = jobs.get(jobId)
      if (job === undefined) {
        sendJson(res, 404, { ok: false, error: `no job named ${JSON.stringify(jobId)}` })
        return
      }
      const jobLane = typeof job.lane === 'string' && job.lane.length > 0 ? job.lane : job.worker
      if (jobLane !== lane.id) {
        sendJson(res, 403, { ok: false, error: 'that job belongs to another lane' })
        return
      }
      // Two allowed roots, both owned by the plugin: the job's own directory, and
      // the lane workspace. Anything else — any path that climbs out with `..`, any
      // absolute path elsewhere on the disk — is refused. This route must never
      // become "a web page that can read any file".
      const roots = [join(job.cwd, 'jobs', job.id), laneCwd(lane.id)]
      const candidate = resolve(job.cwd, wanted)
      const inside = roots.some((root) => {
        const base = resolve(root)
        const prefix = base.endsWith(sep) ? base : base + sep
        return candidate.toLowerCase().startsWith(prefix.toLowerCase())
      })
      if (inside !== true) {
        sendJson(res, 403, { ok: false, error: 'that path is outside the job directory' })
        return
      }
      let stat
      try { stat = statSync(candidate) } catch {
        sendJson(res, 404, { ok: false, error: 'no such artifact' })
        return
      }
      if (stat.isDirectory() === true || stat.size > MAX_ARTIFACT_BYTES) {
        sendJson(res, 413, { ok: false, error: stat.isDirectory() === true ? 'that is a directory' : 'artifact is too large to serve' })
        return
      }
      const type = CONTENT_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream'
      try {
        const body = readFileSync(candidate)
        res.writeHead(200, {
          'content-type': type,
          'content-length': body.length,
          'cache-control': 'no-store',
          // Never let a browser decide a served file is something executable.
          'x-content-type-options': 'nosniff',
        })
        res.end(body)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
      }
    }

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/external-workers/conversation',
      handler: (req, res) => {
        if (!methodOk(req, res)) return
        try {
          const url = new URL(String(req.url ?? '/'), 'http://127.0.0.1')
          const lane = laneFromQuery(url)
          if (lane === null) {
            sendJson(res, 404, { ok: false, error: 'unknown lane', lanes: laneTable().map((item) => item.id) })
            return
          }
          const raw = Number(url.searchParams.get('limit'))
          sendJson(res, 200, conversationPayload(lane, Number.isFinite(raw) ? raw : 80))
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/external-workers/say',
      handler: (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        if (req.headers?.[WRITE_HEADER] !== '1') {
          sendJson(res, 403, { ok: false, error: `a write needs the ${WRITE_HEADER}: 1 header` })
          return
        }
        void (async () => {
          try {
            const result = await sayInLane(await readJsonBody(req))
            sendJson(res, result.ok === true ? 200 : result.blocked === true ? 409 : 400, result)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error?.message ?? error) })
          }
        })()
      },
    }))

    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/external-workers/artifact',
      handler: (req, res) => {
        if (!methodOk(req, res)) return
        try { artifactRequest(req, res, new URL(String(req.url ?? '/'), 'http://127.0.0.1')) } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
        }
      },
    }))

    log('info', 'panel feed registered: GET /api/external-workers/jobs · GET /api/external-workers/job?id= · GET|POST /api/external-workers/settings · GET /api/external-workers/conversation?lane= · POST /api/external-workers/say · GET /api/external-workers/artifact')
  } else {
    log('info', 'no webServer service — the web panel feed is unavailable (the tools still work)')
  }

  ctx.effect(() => () => {
    for (const sessionId of [...attached.keys()]) detachTools(sessionId, 'plugin unloaded')
    for (const [, state] of live) { try { killTree(state.child.pid) } catch { /* ignore */ } }
    live.clear()
  })

  const scopeCfg = readConfig().scope ?? DEFAULTS.scope
  log('info', [
    'ready.',
    `scope.mode=${scopeCfg.mode}`,
    `excludePresets=[${(scopeCfg.excludePresets ?? []).join(',')}]`,
    `excludeWorkspaces=[${(scopeCfg.excludeWorkspaces ?? []).join(',')}]`,
    `excludeSessionIds=${(scopeCfg.excludeSessionIds ?? []).length}`,
    `· lanes: ${laneTable().map((lane) => `${lane.id}(${lane.worker})`).join(' ')}`,
    `· products: ${productIds().join(',')}`,
    (() => {
      const recipeErrors = customProducts(readConfig()).errors
      return recipeErrors.length > 0 ? `· PRODUCT RECIPE ERRORS: ${recipeErrors.join(' ; ')}` : null
    })(),
    `· workspace ${workspaceRoot}`,
    `· cli state: ${productIds().map((w) => cliStatePaths(w, recipeOf(w))).filter((p) => typeof p === 'string').join(' | ')}`,
  ].filter((part) => part !== null).join(' '))
}
