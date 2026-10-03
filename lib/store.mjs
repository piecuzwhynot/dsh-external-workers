/**
 * Durable store for the external worker bridge.
 *
 * The Harness job registry (`ctx.jobs`) is process-local and in-memory, so it
 * can never satisfy "a job must survive a restart / a compaction". This domain
 * is the source of truth: `storage-domain` writes it through the `json` backend
 * as a whole-file atomic replace at `$DSH_HOME/storages/external_workers.json`.
 *
 * Nothing here is ever put into a model context: job identity, session ids,
 * pids and file paths live on disk, and the tools read them live.
 *
 * ── lanes ───────────────────────────────────────────────────────────────────
 * The unit of work is a LANE, not a product: one lane is a product plus a model
 * (and effort/speed) plus a role, with its OWN working directory and its OWN
 * persistent session. That is what lets one product run a fast model for quick
 * work in one thread while a heavy model grinds on something long in another —
 * the products themselves warn about switching models inside one thread, so
 * lanes keep them apart.
 *
 * @module dsh-external-workers/store
 */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** The three products this bridge drives. */
export const WORKERS = ['claude', 'gpt', 'google']

/** Human-facing label per product. */
export const WORKER_LABEL = {
  claude: 'Claude Code (Anthropic subscription)',
  gpt: 'Codex CLI (ChatGPT subscription)',
  google: 'Antigravity CLI / agy (Google account)',
}

/** A lane id doubles as a directory name and a tool argument. */
export const LANE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

/**
 * Job lifecycle states kept on disk.
 *
 * `blocked` needs a human (missing CLI, not logged in); `retryable` is
 * transient (quota, crash, timeout, interrupted process) and is exactly what
 * `resume_external_job` exists for. Neither is ever silently dropped.
 */
export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'blocked', 'retryable', 'canceled']

const JobRecord = z.object({
  id: z.string(),
  worker: z.string(),
  // Empty on records written before lanes existed; readers fall back to `worker`.
  lane: z.string().default(''),
  status: z.string(),
  task: z.string(),
  instruction: z.string().nullable(),
  parentJobId: z.string().nullable(),
  jobDir: z.string(),
  packetPath: z.string().nullable(),
  cwd: z.string(),
  cli: z.string().nullable(),
  sessionId: z.string().nullable(),
  newSession: z.boolean(),
  model: z.string().nullable(),
  actualModel: z.string().nullable().default(null),
  // Codex credits: the balance read before the run, and what that run spent
  // (a drop in the balance between the snapshot before and the one after).
  // Null on every other product — none of them reports a credit balance.
  creditsBefore: z.number().nullable().default(null),
  creditsSpent: z.number().nullable().default(null),
  effort: z.string().nullable(),
  speed: z.string().nullable(),
  foreground: z.boolean(),
  images: z.array(z.string()),
  timeoutMinutes: z.number(),
  ownerSessionId: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  attempts: z.number(),
  pid: z.number().nullable(),
  exitCode: z.number().nullable(),
  retryable: z.boolean(),
  lastError: z.string().nullable(),
  failureKind: z.string().nullable(),
  resultText: z.string().nullable(),
  artifacts: z.array(z.string()),
  stdoutPath: z.string(),
  stderrPath: z.string(),
})

/**
 * One lane's durable state. The table is keyed by LANE id, so every lane owns
 * its own session id, working directory and standing assignment.
 */
const WorkerRecord = z.object({
  // The lane id (this record's key). Records written before lanes carry ''.
  lane: z.string().default(''),
  // The product behind the lane.
  worker: z.string(),
  sessionId: z.string().nullable(),
  cwd: z.string(),
  cliPath: z.string().nullable(),
  state: z.string(), // ready | needs-login | cli-missing | error
  // The user's standing assignment. `role` is what the orchestrating model
  // reads to decide who does what; model/effort/speed are this lane's defaults.
  role: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  effort: z.string().nullable().default(null),
  speed: z.string().nullable().default(null),
  // What the product reported it actually ran on last time (alias-free).
  lastModel: z.string().nullable().default(null),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  resumeCount: z.number(),
  lastJobId: z.string().nullable(),
  lastError: z.string().nullable(),
})

/** The single domain this plugin owns. */
export const storeSpec = defineDomain({
  name: 'external_workers',
  version: 1,
  global: {
    schema: z.object({ schemaVersion: z.number(), createdAt: z.number() }),
    initial: { schemaVersion: 1, createdAt: 0 },
  },
  tables: {
    jobs: domainTable(JobRecord),
    workers: domainTable(WorkerRecord),
  },
})

/**
 * A fresh job record with every declared field present, so the domain schema
 * never has to guess and no field silently disappears on write.
 */
export function newJobRecord(fields) {
  return {
    id: fields.id,
    worker: fields.worker,
    lane: fields.lane ?? fields.worker,
    status: 'queued',
    task: fields.task,
    instruction: fields.instruction ?? null,
    parentJobId: fields.parentJobId ?? null,
    jobDir: fields.jobDir,
    packetPath: fields.packetPath ?? null,
    cwd: fields.cwd,
    cli: fields.cli ?? null,
    sessionId: fields.sessionId ?? null,
    newSession: fields.newSession === true,
    model: fields.model ?? null,
    actualModel: fields.actualModel ?? null,
    creditsBefore: Number.isFinite(fields.creditsBefore) ? fields.creditsBefore : null,
    creditsSpent: null,
    effort: fields.effort ?? null,
    speed: fields.speed ?? null,
    foreground: fields.foreground === true,
    images: Array.isArray(fields.images) ? fields.images : [],
    // 0 = no limit, which is the default: a real worker job runs for hours.
    timeoutMinutes: Number.isFinite(fields.timeoutMinutes) ? fields.timeoutMinutes : 0,
    ownerSessionId: fields.ownerSessionId ?? null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    attempts: 0,
    pid: null,
    exitCode: null,
    retryable: false,
    lastError: null,
    failureKind: null,
    resultText: null,
    artifacts: [],
    stdoutPath: fields.stdoutPath,
    stderrPath: fields.stderrPath,
  }
}

/** A fresh lane record. */
export function newWorkerRecord(lane, worker, cwd) {
  return {
    lane,
    worker,
    sessionId: null,
    cwd,
    cliPath: null,
    state: 'ready',
    role: null,
    model: null,
    effort: null,
    speed: null,
    lastModel: null,
    createdAt: Date.now(),
    lastUsedAt: null,
    resumeCount: 0,
    lastJobId: null,
    lastError: null,
  }
}
