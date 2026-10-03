/**
 * Read a worker's own conversation, so a human can see what it actually did.
 *
 * The point: a job record tells you the result, but not the working — and when
 * the thing being judged is a picture or a model, the result line is not enough.
 * Every product already writes its conversation to disk; this module turns those
 * three private formats into one shape a UI can render.
 *
 * All three formats are UNDOCUMENTED and owned by someone else, so every reader
 * here is defensive: an unknown entry is skipped rather than fatal, and a format
 * that cannot be read says so instead of returning an empty conversation that
 * looks like "the worker said nothing".
 *
 *   claude -> ~/.claude/projects/<slug-of-cwd>/<session-id>.jsonl
 *   gpt    -> $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*<thread-id>*.jsonl
 *   google -> ~/.gemini/antigravity-cli/conversations/<id>.db  (protobuf blobs)
 *
 * @module dsh-external-workers/transcript
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** How much of a long conversation to return. */
const DEFAULT_LIMIT = 60
const MAX_TEXT = 4000
const MAX_SOURCE_BYTES = 24 * 1024 * 1024

const oneLine = (value, max) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Claude Code names a project directory after the working directory. */
export function claudeProjectSlug(cwd) {
  return String(cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-')
}

function readJsonl(path) {
  let text
  try {
    const stat = statSync(path)
    if (stat.size > MAX_SOURCE_BYTES) return null
    text = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const entries = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    try { entries.push(JSON.parse(line)) } catch { /* skip a damaged line */ }
  }
  return entries
}

/** A tool call, reduced to something a human can scan. */
function toolTurn(name, input) {
  const detail = typeof input === 'string'
    ? input
    : input === null || typeof input !== 'object'
      ? ''
      : (input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.prompt ?? '')
  return { kind: 'tool', name: String(name ?? 'tool'), detail: oneLine(detail, 300) }
}

// ── claude ─────────────────────────────────────────────────────────────────
function readClaude({ sessionId, cwd, home }) {
  const root = join(home, '.claude', 'projects')
  const dir = join(root, claudeProjectSlug(cwd))
  const file = join(dir, `${sessionId}.jsonl`)
  if (existsSync(file) !== true) {
    return { ok: false, reason: `no claude transcript at ${file}`, turns: [] }
  }
  const entries = readJsonl(file)
  if (entries === null) return { ok: false, reason: 'transcript unreadable or too large', turns: [] }
  const turns = []
  for (const entry of entries) {
    const role = entry.type === 'user' ? 'user' : entry.type === 'assistant' ? 'assistant' : null
    if (role === null) continue
    const content = entry.message?.content
    const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : null
    if (typeof content === 'string') {
      if (content.trim().length > 0 && content.includes('<') !== true) turns.push({ role, kind: 'text', text: oneLine(content, MAX_TEXT), at })
      continue
    }
    if (Array.isArray(content) !== true) continue
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim().length > 0) {
        // Tool-result echoes and system reminders arrive as user text; the UI
        // does not need either.
        if (block.text.trim().startsWith('<') !== true) turns.push({ role, kind: 'text', text: oneLine(block.text, MAX_TEXT), at })
        continue
      }
      if (block.type === 'tool_use') { turns.push({ ...toolTurn(block.name, block.input), role, at }); continue }
      if (block.type === 'tool_result') {
        const body = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content) ? block.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join(' ') : ''
        if (body.trim().length > 0) turns.push({ role, kind: 'result', text: oneLine(body, 600), at })
      }
    }
  }
  return { ok: true, file, turns }
}

// ── codex ──────────────────────────────────────────────────────────────────
/** The rollout file whose name carries this thread id, newest first. */
function codexRolloutFor(threadId, home, now = Date.now()) {
  if (typeof threadId !== 'string' || threadId.length === 0) return null
  const root = join(process.env.CODEX_HOME ?? join(home, '.codex'), 'sessions')
  const pad = (value) => String(value).padStart(2, '0')
  for (let back = 0; back < 5; back += 1) {
    const day = new Date(now - back * 86400000)
    const dir = join(root, String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate()))
    let names
    try { names = readdirSync(dir) } catch { continue }
    const matches = names.filter((name) => name.includes(threadId)).sort().reverse()
    for (const name of matches) return join(dir, name)
  }
  return null
}

function readCodex({ sessionId, home }) {
  const file = codexRolloutFor(sessionId, home)
  if (file === null) return { ok: false, reason: 'no rollout file carries that thread id', turns: [] }
  const events = readJsonl(file)
  if (events === null) return { ok: false, reason: 'rollout unreadable or too large', turns: [] }
  const turns = []
  for (const event of events) {
    const payload = event.payload
    if (payload === null || typeof payload !== 'object') continue
    const at = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : null
    if (event.type === 'response_item' && payload.type === 'message') {
      const role = payload.role === 'user' ? 'user' : payload.role === 'assistant' ? 'assistant' : null
      // developer/user-injected instructions are the harness talking, not the
      // worker; showing them would drown the actual conversation.
      if (role === null) continue
      const text = Array.isArray(payload.content)
        ? payload.content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
        : typeof payload.content === 'string' ? payload.content : ''
      if (text.trim().length === 0) continue
      // Codex wraps injected context in tags; keep only what the worker wrote.
      if (text.trim().startsWith('<') === true && role === 'user') continue
      turns.push({ role, kind: 'text', text: oneLine(text, MAX_TEXT), at })
      continue
    }
    if (event.type === 'response_item' && payload.type === 'custom_tool_call') {
      turns.push({ ...toolTurn(payload.name, payload.input), role: 'assistant', at })
      continue
    }
    if (event.type === 'response_item' && payload.type === 'custom_tool_call_output') {
      const body = typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? '')
      if (body.trim().length > 0) turns.push({ role: 'tool', kind: 'result', text: oneLine(body, 600), at })
      continue
    }
    if (event.type === 'response_item' && payload.type === 'reasoning') {
      const text = Array.isArray(payload.summary)
        ? payload.summary.map((part) => (typeof part?.text === 'string' ? part.text : '')).join(' ')
        : ''
      if (text.trim().length > 0) turns.push({ role: 'assistant', kind: 'reasoning', text: oneLine(text, 800), at })
    }
  }
  return { ok: true, file, turns }
}

// ── google (agy) ───────────────────────────────────────────────────────────
function readGoogle({ sessionId, home }) {
  const dir = join(home, '.gemini', 'antigravity-cli', 'conversations')
  const file = join(dir, `${sessionId}.db`)
  if (existsSync(file) !== true) return { ok: false, reason: `no conversation database at ${file}`, turns: [] }
  // The steps are protobuf blobs; rendering them properly needs a schema this
  // project does not have. Saying so is the honest answer — an empty list would
  // read as "the worker said nothing", which is a different and false claim.
  return { ok: false, reason: 'agy stores its steps as protobuf blobs — not renderable yet', file, turns: [] }
}

/**
 * The conversation a worker had, oldest turn first.
 *
 * @param options.worker   'claude' | 'gpt' | 'google' | a custom product id
 * @param options.sessionId the product's own session id (what the lane recorded)
 * @param options.cwd      the lane's working directory (claude keys its files by it)
 * @param options.limit    how many of the most recent turns to return
 * @param options.home     home directory override (tests)
 */
export function readTranscript(options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(400, options.limit)) : DEFAULT_LIMIT
  const home = typeof options.home === 'string' && options.home.length > 0 ? options.home : homedir()
  const sessionId = typeof options.sessionId === 'string' && options.sessionId.length > 0 ? options.sessionId : null
  if (sessionId === null) return { ok: false, worker: options.worker ?? null, reason: 'this lane has no session yet', turns: [] }
  let result
  if (options.worker === 'claude') result = readClaude({ sessionId, cwd: options.cwd, home })
  else if (options.worker === 'gpt') result = readCodex({ sessionId, home })
  else if (options.worker === 'google') result = readGoogle({ sessionId, home })
  else result = { ok: false, reason: `no transcript reader for "${options.worker}"`, turns: [] }
  const turns = result.turns ?? []
  return {
    ok: result.ok === true,
    worker: options.worker ?? null,
    sessionId,
    file: result.file ?? null,
    reason: result.reason ?? null,
    total: turns.length,
    turns: turns.slice(-limit),
  }
}
