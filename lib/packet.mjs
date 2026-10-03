/**
 * Context packet builder.
 *
 * A worker never inherits this Harness's project knowledge, so every
 * delegation ships a self-contained packet: the task, the inlined context the
 * caller named (files, logs, references), the acceptance criteria, and the
 * output contract. Images are referenced by absolute path (Codex also receives
 * them as real image attachments).
 *
 * @module dsh-external-workers/packet
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { expandPath } from './cli.mjs'

const DEFAULT_MAX_FILE_BYTES = 65536
const DEFAULT_MAX_TOTAL_BYTES = 524288
const DEFAULT_LOG_TAIL_LINES = 200

/** Resolve a caller-supplied path against the calling session's working directory. */
export function resolveUserPath(value, baseDir) {
  const expanded = expandPath(String(value))
  return isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)
}

/** Read a file, truncated to `maxBytes`, reporting what happened. */
function readCapped(path, maxBytes) {
  const size = statSync(path).size
  if (size <= maxBytes) return { text: readFileSync(path, 'utf8'), truncated: false, size }
  const buffer = readFileSync(path)
  return { text: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true, size }
}

/** Tail of a text file, bounded by lines and bytes. */
function readTail(path, maxLines, maxBytes) {
  const { text, truncated, size } = readCapped(path, maxBytes)
  const lines = text.split(/\r?\n/)
  const tail = lines.length > maxLines ? lines.slice(-maxLines) : lines
  return { text: tail.join('\n'), truncated: truncated || lines.length > maxLines, size }
}

function fence(language, body) {
  const safe = body.includes('```') ? body.replaceAll('```', '``\u200b`') : body
  return '```' + language + '\n' + safe + '\n```'
}

function guessLanguage(path) {
  const match = /\.([A-Za-z0-9]+)$/.exec(path)
  const ext = match === null ? '' : match[1].toLowerCase()
  const map = {
    js: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'tsx', jsx: 'jsx', json: 'json',
    md: 'md', yml: 'yaml', yaml: 'yaml', py: 'python', ps1: 'powershell', sh: 'bash',
    html: 'html', css: 'css', toml: 'toml', sql: 'sql', lua: 'lua', rs: 'rust', go: 'go',
  }
  return map[ext] ?? ''
}

/**
 * Build and write `packet.md` for one job.
 * @returns { packetPath, notes }
 */
export function buildPacket(options) {
  const {
    jobId, worker, workerLabel, task, jobDir, cwd, sessionCwd,
    contextFiles = [], logs = [], images = [], references = [], acceptance = [],
    instruction = null, runtime = {},
  } = options

  const maxFileBytes = Number.isFinite(runtime.maxInlineFileBytes) ? runtime.maxInlineFileBytes : DEFAULT_MAX_FILE_BYTES
  const maxTotalBytes = Number.isFinite(runtime.maxTotalInlineBytes) ? runtime.maxTotalInlineBytes : DEFAULT_MAX_TOTAL_BYTES
  const logTailLines = Number.isFinite(runtime.logTailLines) ? runtime.logTailLines : DEFAULT_LOG_TAIL_LINES

  const notes = []
  const sections = []
  let spent = 0

  sections.push(`# Task packet — ${jobId}`)
  sections.push([
    `- Worker: **${workerLabel}** (\`${worker}\`)`,
    `- Your working directory: \`${cwd}\``,
    `- Deliverables directory: \`./jobs/${jobId}/out/\``,
    `- Issued: ${new Date().toISOString()}`,
    instrument(),
  ].filter(Boolean).join('\n'))

  sections.push('## Task\n\n' + (task ?? '(none given)'))

  if (Array.isArray(acceptance) && acceptance.length > 0) {
    sections.push('## Acceptance criteria\n\n' + acceptance.map((line) => `- ${line}`).join('\n'))
  }

  if (typeof instruction === 'string' && instruction.trim().length > 0) {
    sections.push('## Follow-up instruction\n\n' + instruction)
  }

  if (Array.isArray(references) && references.length > 0) {
    sections.push('## References\n\n' + references.map((line) => `- ${line}`).join('\n'))
  }

  if (Array.isArray(contextFiles) && contextFiles.length > 0) {
    const blocks = []
    for (const raw of contextFiles) {
      const path = resolveUserPath(raw, sessionCwd)
      try {
        if (!existsSync(path)) { blocks.push(`### \`${path}\`\n\n_(missing)_`); notes.push(`missing file: ${path}`); continue }
        const stat = statSync(path)
        if (stat.isDirectory()) {
          const listing = readdirSync(path).slice(0, 200).join('\n')
          blocks.push(`### \`${path}\` (directory listing)\n\n${fence('', listing)}`)
          continue
        }
        const budget = Math.max(0, Math.min(maxFileBytes, maxTotalBytes - spent))
        if (budget === 0) { blocks.push(`### \`${path}\`\n\n_(omitted: packet size budget exhausted — read it yourself)_`); notes.push(`omitted (budget): ${path}`); continue }
        const read = readCapped(path, budget)
        spent += read.text.length
        blocks.push(`### \`${path}\`${read.truncated ? ` _(truncated from ${read.size} bytes)_` : ''}\n\n${fence(guessLanguage(path), read.text)}`)
      } catch (error) {
        blocks.push(`### \`${path}\`\n\n_(unreadable: ${error.message})_`)
        notes.push(`unreadable file: ${path}`)
      }
    }
    sections.push('## Context files\n\n' + blocks.join('\n\n'))
  }

  if (Array.isArray(logs) && logs.length > 0) {
    const blocks = []
    for (const raw of logs) {
      const path = resolveUserPath(raw, sessionCwd)
      try {
        if (!existsSync(path)) { blocks.push(`### \`${path}\`\n\n_(missing)_`); notes.push(`missing log: ${path}`); continue }
        const budget = Math.max(0, Math.min(maxTotalBytes - spent, 131072))
        if (budget === 0) { blocks.push(`### \`${path}\`\n\n_(omitted: packet size budget exhausted)_`); continue }
        const read = readTail(path, logTailLines, budget)
        spent += read.text.length
        blocks.push(`### \`${path}\` (last ${logTailLines} lines)\n\n${fence('', read.text)}`)
      } catch (error) {
        blocks.push(`### \`${path}\`\n\n_(unreadable: ${error.message})_`)
      }
    }
    sections.push('## Logs\n\n' + blocks.join('\n\n'))
  }

  if (Array.isArray(images) && images.length > 0) {
    const lines = images.map((raw) => `- \`${resolveUserPath(raw, sessionCwd)}\``)
    sections.push('## Images / screenshots\n\nOpen these files yourself to look at them:\n\n' + lines.join('\n'))
  }

  sections.push([
    '## Output contract',
    '',
    `1. Do the work in \`${cwd}\`.`,
    `2. Write every deliverable file under \`./jobs/${jobId}/out/\` (create it if needed).`,
    '3. Your final message must end with these sections:',
    '',
    '```',
    '## RESULT',
    'what you actually did and what the outcome is (be specific, no filler)',
    '',
    '## DECISIONS',
    'important choices you made and why (or "none")',
    '',
    '## ARTIFACTS',
    'relative paths of every file you produced or changed (or "none")',
    '',
    '## BLOCKERS',
    'anything that stopped you, including missing permissions or approvals (or "none")',
    '```',
    '',
    'If a tool you need is denied, say so under BLOCKERS rather than silently skipping the work.',
  ].join('\n'))

  mkdirSync(join(jobDir, 'out'), { recursive: true })
  const packetPath = join(jobDir, 'packet.md')
  writeFileSync(packetPath, sections.join('\n\n---\n\n') + '\n', 'utf8')
  return { packetPath, notes }

  function instrument() {
    return '- Delegated through the DeepSeek Harness external worker bridge; you are a persistent worker with your own dedicated session and working directory.'
  }
}

/** List artifacts the worker produced under `<jobDir>/out`, relative to the worker cwd. */
export function listArtifacts(jobDir, workerCwd, limit = 100) {
  const root = join(jobDir, 'out')
  const found = []
  const walk = (dir, depth) => {
    if (found.length >= limit || depth > 6) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (found.length >= limit) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      found.push(full.startsWith(workerCwd) ? full.slice(workerCwd.length + 1).replaceAll('\\', '/') : full)
    }
  }
  walk(root, 0)
  return found
}
