/**
 * Model catalog discovery — the list of models a worker can actually be asked to
 * use, read from the product itself instead of being hardcoded here.
 *
 * Every entry comes from a real source:
 *   - Codex  : the CLI's own `$CODEX_HOME/models_cache.json` (slug, display name,
 *              supported reasoning levels, speed tiers).
 *   - Google : `agy models` (works before sign-in; slug + display name).
 *   - Claude : the aliases and effort levels the CLI documents in its own --help.
 *
 * @module dsh-external-workers/models
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resolveCli, CliError } from './cli.mjs'
import { readDotted } from './products.mjs'

const CACHE_TTL_MS = 10 * 60 * 1000
/** worker → { at, value } */
const cache = new Map()

/** Run a command, capture stdout, never throw. */
function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let done = false
    let child
    const finish = (code) => { if (!done) { done = true; resolve({ code, stdout, stderr }) } }
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      return finish(-1)
    }
    const timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } finish(-1) }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.on('error', () => { clearTimeout(timer); finish(-1) })
    child.on('close', (code) => { clearTimeout(timer); finish(code) })
  })
}

/** Claude Code's documented model aliases and effort levels. */
function claudeCatalog() {
  return {
    worker: 'claude',
    source: "Claude Code's own --help (aliases, or a model's full name)",
    models: [
      { id: 'fable', label: 'fable (alias for the latest model)' },
      { id: 'opus', label: 'opus (alias for the latest Opus)' },
      { id: 'sonnet', label: 'sonnet (alias for the latest Sonnet)' },
    ],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    speedTiers: [],
    note: 'Any full model name is also accepted. Claude Code resolves the alias to whatever is current on your plan.',
  }
}

/** Codex's own model cache. */
function codexCatalog() {
  const home = process.env.CODEX_HOME ?? join(homedir(), '.codex')
  const path = join(home, 'models_cache.json')
  if (!existsSync(path)) {
    return {
      worker: 'gpt',
      source: `Codex model cache (${path}) — not found`,
      models: [],
      efforts: [],
      speedTiers: [],
      error: 'Codex has not written its model cache yet; run `codex` once interactively, then ask again.',
    }
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    const list = Array.isArray(raw.models) ? raw.models : []
    if (list.length === 0) throw new Error('models array is empty')
    const models = list
      .filter((model) => model?.slug !== undefined)
      .map((model) => ({
        id: String(model.slug),
        label: `${model.display_name ?? model.slug}${model.description ? ` — ${String(model.description).slice(0, 90)}` : ''}`,
        efforts: Array.isArray(model.supported_reasoning_levels)
          ? model.supported_reasoning_levels.map((level) => level?.effort).filter((effort) => typeof effort === 'string')
          : [],
        defaultEffort: typeof model.default_reasoning_level === 'string' ? model.default_reasoning_level : null,
        speedTiers: Array.isArray(model.service_tiers)
          ? model.service_tiers.map((tier) => tier?.id).filter((id) => typeof id === 'string')
          : [],
      }))
    const efforts = [...new Set(models.flatMap((model) => model.efforts))]
    const speedTiers = [...new Set(models.flatMap((model) => model.speedTiers))]
    return { worker: 'gpt', source: `Codex model cache (${path})`, models, efforts, speedTiers }
  } catch (error) {
    return {
      worker: 'gpt',
      source: `Codex model cache (${path})`,
      models: [],
      efforts: [],
      speedTiers: [],
      error: `could not read the Codex model cache: ${error.message}`,
    }
  }
}

/** Antigravity CLI's own model list. */
async function agyCatalog(workerCfg) {
  let cli
  try { cli = resolveCli('google', workerCfg ?? {}) } catch (error) {
    return {
      worker: 'google',
      source: 'agy models',
      models: [],
      efforts: [],
      speedTiers: [],
      error: error instanceof CliError ? error.message : String(error?.message ?? error),
    }
  }
  const result = await run(cli, ['models'], 30000)
  const models = []
  for (const line of result.stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const [id, ...rest] = trimmed.split('\t')
    if (id === undefined || id.length === 0) continue
    models.push({ id: id.trim(), label: rest.join(' ').trim() || id.trim() })
  }
  const efforts = ['low', 'medium', 'high', 'max']
  if (models.length === 0) {
    return {
      worker: 'google',
      source: 'agy models',
      models: [],
      efforts,
      speedTiers: [],
      error: result.stderr.trim().slice(0, 400) || 'agy models returned nothing; sign in once with `agy`.',
    }
  }
  return { worker: 'google', source: 'agy models', models, efforts, speedTiers: [], note: 'The effort is often part of the slug itself (…-high / …-medium / …-low).' }
}

/**
 * A custom product's own model list, read by running the command its recipe
 * declares. The recipe owns both the command and how to read its output, so a
 * product that ships a `models` subcommand needs no code.
 */
async function recipeCatalog(recipe, workerCfg) {
  const base = { worker: recipe.id, source: `${recipe.id} ${recipe.models.command.join(' ')}`, models: [], efforts: [], speedTiers: [] }
  let cli
  try {
    cli = resolveCli(recipe.id, workerCfg ?? {}, recipe)
  } catch (error) {
    return { ...base, source: `custom product "${recipe.id}"`, error: error instanceof CliError ? error.message : String(error?.message ?? error) }
  }
  const result = await run(cli, recipe.models.command, 30000)
  const models = []
  if (recipe.models.format === 'json') {
    let parsed = null
    try { parsed = JSON.parse(result.stdout.trim()) } catch { parsed = null }
    const list = parsed === null ? undefined : readDotted(parsed, recipe.models.path ?? '')
    const entries = Array.isArray(list) ? list : []
    for (const entry of entries) {
      if (typeof entry === 'string' && entry.length > 0) { models.push({ id: entry, label: entry }); continue }
      if (entry !== null && typeof entry === 'object') {
        const id = entry.id ?? entry.slug ?? entry.name ?? entry.model
        if (typeof id === 'string' && id.length > 0) models.push({ id, label: String(entry.display_name ?? entry.label ?? entry.name ?? id) })
      }
    }
  } else {
    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      if (recipe.models.pattern !== null) {
        const match = new RegExp(recipe.models.pattern).exec(trimmed)
        if (match === null) continue
        const id = match[1] ?? match[0]
        if (typeof id === 'string' && id.length > 0) models.push({ id, label: trimmed })
        continue
      }
      const [id, ...rest] = trimmed.split('\t')
      if (id === undefined || id.trim().length === 0) continue
      models.push({ id: id.trim(), label: rest.join(' ').trim() || id.trim() })
    }
  }
  if (models.length === 0) {
    return { ...base, error: result.stderr.trim().slice(0, 400) || `\`${recipe.id} ${recipe.models.command.join(' ')}\` returned nothing usable. Check the recipe's models.command/format.` }
  }
  return { ...base, models, note: recipe.models.format === 'lines' && recipe.models.pattern === null ? 'Read from the command output, one model per line (first tab-separated field).' : undefined }
}

/**
 * Discover the models one worker offers.
 * @param worker - 'claude' | 'gpt' | 'google', or a custom product id
 * @param workerCfg - that worker's config block (used to locate the CLI).
 * @param options.fresh - bypass the in-memory cache.
 * @param recipe - a custom product recipe (null for the built-ins).
 */
export async function discoverModels(worker, workerCfg = {}, options = {}, recipe = null) {
  const cacheKey = recipe === null || recipe === undefined ? worker : `${recipe.id}:${JSON.stringify(recipe.models)}`
  if (options.fresh !== true) {
    const hit = cache.get(cacheKey)
    if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  }
  let value
  if (recipe !== null && recipe !== undefined) {
    value = recipe.models === null
      ? { worker: recipe.id, source: 'custom product', models: [], efforts: [], speedTiers: [], error: `product "${recipe.id}" has no models block in config.json, so its model list cannot be read. Add one, or ask the user which models it offers.` }
      : await recipeCatalog(recipe, workerCfg)
  } else if (worker === 'claude') value = claudeCatalog()
  else if (worker === 'gpt') value = codexCatalog()
  else if (worker === 'google') value = await agyCatalog(workerCfg)
  else value = { worker, source: 'unknown', models: [], efforts: [], speedTiers: [], error: `unknown worker "${worker}"` }
  cache.set(cacheKey, { at: Date.now(), value })
  return value
}

/** Render one catalog as model-facing text. */
export function renderCatalog(catalog, limit = 40) {
  const lines = [`**${catalog.worker}** — source: ${catalog.source}`]
  if (catalog.error !== undefined) lines.push(`  ! ${catalog.error}`)
  const shown = catalog.models.slice(0, limit)
  for (const model of shown) {
    const bits = []
    if (Array.isArray(model.efforts) && model.efforts.length > 0) bits.push(`effort: ${model.efforts.join('/')}`)
    if (model.defaultEffort) bits.push(`default: ${model.defaultEffort}`)
    if (Array.isArray(model.speedTiers) && model.speedTiers.length > 0) bits.push(`speed: ${model.speedTiers.join('/')}`)
    lines.push(`  - \`${model.id}\` — ${model.label}${bits.length > 0 ? `  [${bits.join(' · ')}]` : ''}`)
  }
  if (catalog.models.length > shown.length) lines.push(`  … and ${catalog.models.length - shown.length} more`)
  if (Array.isArray(catalog.efforts) && catalog.efforts.length > 0) lines.push(`  effort levels: ${catalog.efforts.join(', ')}`)
  if (Array.isArray(catalog.speedTiers) && catalog.speedTiers.length > 0) lines.push(`  speed tiers: ${catalog.speedTiers.join(', ')}`)
  if (catalog.note !== undefined) lines.push(`  note: ${catalog.note}`)
  return lines.join('\n')
}
