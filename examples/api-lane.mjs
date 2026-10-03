/**
 * api-lane — turn an OpenAI-compatible HTTP API into a CLI this plugin can drive.
 *
 * Why this exists: the plugin's custom products work by running a COMMAND. That
 * covers every CLI, including API-backed ones — but an AI that only offers an
 * HTTP endpoint has no command to run. This script is that command. Point a
 * product recipe at it and the model behind it behaves like any other lane.
 *
 *   node api-lane.mjs -p "<prompt>" [--resume <session>] [--model <name>]
 *                                  [--history-dir <dir>] [--key-file <path>]
 *
 * What makes it a LANE and not a one-shot call: it keeps the conversation on
 * disk. `--resume <session>` reloads that conversation and sends it again, so a
 * follow-up builds on everything the worker already saw — the same property the
 * CLI products have natively, which plain "spawn a subagent" calls do not.
 *
 * The provider is configured by environment (so no secret has to sit in
 * config.json):
 *   API_LANE_BASE_URL   default https://api.openai.com/v1
 *   API_LANE_API_KEY    the key (or use --key-file)
 *   API_LANE_MODEL      default model when the lane does not name one
 *   API_LANE_SYSTEM     optional system message prepended on a new session
 *
 * OpenAI-compatible covers more than OpenAI: xAI (Grok), Moonshot (Kimi),
 * DashScope's compatible mode (Qwen), Volcengine Ark (Doubao) and many local
 * servers all speak this shape. Only the base URL and the model name change.
 *
 * Output is one JSON object, which is what a product recipe reads:
 *   {"status":"ok","session_id":"…","result":"…","model":"…"}
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'

/** Keep the prompt from growing without bound across hundreds of turns. */
const MAX_MESSAGES = 40
const MAX_CHARS = 400000
/** A packet is inlined whole, but not without limit. */
const MAX_PACKET_CHARS = 200000
/** Give up rather than hang the worker forever. */
const TIMEOUT_MS = 10 * 60 * 1000

function parseArgv(argv) {
  const values = { images: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = index + 1 < argv.length ? argv[index + 1] : null
    if (token === '-p' || token === '--prompt') { values.prompt = next; index += 1; continue }
    if (token === '--resume') { values.session = next; index += 1; continue }
    if (token === '--model') { values.model = next; index += 1; continue }
    if (token === '--history-dir') { values.historyDir = next; index += 1; continue }
    if (token === '--key-file') { values.keyFile = next; index += 1; continue }
    if (token === '--system') { values.system = next; index += 1; continue }
  }
  return values
}

function fail(message, kind = 'error') {
  process.stdout.write(`${JSON.stringify({ status: 'error', error: `${kind}: ${message}` })}\n`)
  process.exit(1)
}

const args = parseArgv(process.argv.slice(2))
if (typeof args.prompt !== 'string' || args.prompt.length === 0) fail('missing -p <prompt>', 'usage')

/**
 * The bridge tells every worker to read a packet file, because the CLI products
 * have file tools. A raw API model has none: that instruction is unusable to it.
 * So the packet is read here and sent WITH the prompt instead.
 *
 * The task, the context and the acceptance criteria all live in that file, so
 * without this the model would receive an instruction it cannot follow and
 * answer nothing useful.
 */
function inlinePacket(prompt) {
  const match = /\.\/([^\s"'`]+packet\.md)/.exec(prompt)
  if (match === null) return null
  const relative = match[1]
  const full = join(process.cwd(), relative)
  if (existsSync(full) !== true) return null
  try {
    const text = readFileSync(full, 'utf8')
    const capped = text.length > MAX_PACKET_CHARS ? `${text.slice(0, MAX_PACKET_CHARS)}\n…(packet truncated)` : text
    return { relative, text: capped }
  } catch {
    return null
  }
}

const packet = inlinePacket(args.prompt)
const promptText = packet === null
  ? args.prompt
  : [
    args.prompt,
    '',
    `----- BEGIN PACKET (${packet.relative}) -----`,
    packet.text,
    '----- END PACKET -----',
    '',
    'Note: you have no file or shell tools in this lane. Everything you need is in the packet above, and your answer is the deliverable — write it out in full.',
  ].join('\n')

const baseUrl = (process.env.API_LANE_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
const model = args.model ?? process.env.API_LANE_MODEL ?? ''
if (model.length === 0) fail('no model: set the lane model, or API_LANE_MODEL', 'config')

let apiKey = process.env.API_LANE_API_KEY ?? ''
if (apiKey.length === 0 && typeof args.keyFile === 'string') {
  try { apiKey = readFileSync(args.keyFile, 'utf8').trim() } catch { /* reported below */ }
}
if (apiKey.length === 0) fail('no API key: set API_LANE_API_KEY, or pass --key-file <path>', 'needs-key')

const historyDir = args.historyDir ?? join(process.cwd(), '.api-history')
const sessionId = typeof args.session === 'string' && args.session.length > 0 ? args.session : randomBytes(6).toString('hex')
const historyPath = join(historyDir, `${sessionId}.json`)

/** Load the conversation this session already has. */
function loadHistory() {
  if (existsSync(historyPath) !== true) return { messages: [], resumed: false }
  try {
    const parsed = JSON.parse(readFileSync(historyPath, 'utf8'))
    return { messages: Array.isArray(parsed.messages) ? parsed.messages : [], resumed: true }
  } catch {
    // A corrupt history must not wedge the lane forever; start clean and say so
    // on stderr without failing the run.
    process.stderr.write(`api-lane: history at ${historyPath} is unreadable; starting a fresh conversation\n`)
    return { messages: [], resumed: false }
  }
}

function saveHistory(messages) {
  mkdirSync(dirname(historyPath), { recursive: true })
  writeFileSync(historyPath, JSON.stringify({ sessionId, model, updatedAt: new Date().toISOString(), messages }, null, 2), 'utf8')
}

/** Trim from the front, never splitting a user/assistant pair at the boundary. */
function trim(messages) {
  let kept = messages.slice(-MAX_MESSAGES)
  let chars = kept.reduce((total, message) => total + String(message.content ?? '').length, 0)
  while (chars > MAX_CHARS && kept.length > 2) {
    const dropped = kept.shift()
    chars -= String(dropped.content ?? '').length
  }
  return kept
}

const { messages, resumed } = loadHistory()
const working = messages.slice()
if (working.length === 0 && typeof process.env.API_LANE_SYSTEM === 'string' && process.env.API_LANE_SYSTEM.length > 0) {
  working.push({ role: 'system', content: process.env.API_LANE_SYSTEM })
}
working.push({ role: 'user', content: promptText })
const outgoing = trim(working)

let response
try {
  response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: outgoing }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
} catch (error) {
  fail(String(error?.message ?? error), 'network')
}

const raw = await response.text()
if (response.ok !== true) {
  // Surface the provider's own words: quota, bad key and wrong model all look
  // different, and the user needs to see which one it is.
  fail(raw.slice(0, 800) || `HTTP ${response.status}`, `http-${response.status}`)
}

let envelope = null
try { envelope = JSON.parse(raw) } catch { fail(`provider did not return JSON: ${raw.slice(0, 300)}`, 'bad-response') }

const text = envelope?.choices?.[0]?.message?.content
if (typeof text !== 'string' || text.length === 0) fail(`no message content in the reply: ${raw.slice(0, 300)}`, 'bad-response')

// Only a successful turn is written back, so a retry after a failure does not
// replay a question the model already answered.
working.push({ role: 'assistant', content: text })
saveHistory(trim(working))

process.stdout.write(`${JSON.stringify({
  status: 'ok',
  session_id: sessionId,
  result: text,
  model: envelope.model ?? model,
  resumed,
  turns: working.length,
  packetInlined: packet === null ? null : packet.relative,
})}\n`)
