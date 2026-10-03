/**
 * Custom products: any other agent CLI, described by a recipe in config.json.
 *
 * The three built-ins (claude, gpt, google) have hand-written adapters, because
 * their flags and output shapes are known and tested. Everything else — Kimi,
 * Qwen, Grok, Doubao, a local model runner, a CLI that ships next month — is
 * declared instead of coded:
 *
 *   "products": {
 *     "kimi": {
 *       "label": "Kimi CLI",
 *       "bin": { "names": ["kimi.exe", "kimi"], "roots": ["~/.kimi/bin"], "hint": "install kimi" },
 *       "args": {
 *         "base":   ["-p"],
 *         "prompt": ["{prompt}"],
 *         "resume": ["--resume", "{session}"],
 *         "model":  ["--model", "{model}"],
 *         "extra":  ["--output-format", "json"]
 *       },
 *       "output": { "format": "json", "session": "session_id", "text": "result", "error": "error" },
 *       "models": { "command": ["models"], "format": "lines" }
 *     }
 *   }
 *
 * The recipe is DATA, so adding a product needs no code change and no release.
 * A recipe can also sit in the file disabled (`"enabled": false`) as a template.
 *
 * This module is pure: it validates and normalizes recipes, and expands
 * templates. It never touches the filesystem or spawns anything, which is what
 * lets the whole mechanism be tested without any of those CLIs installed.
 *
 * @module dsh-external-workers/products
 */
import { WORKERS } from './store.mjs'

/** Products with a hand-written adapter. */
export const BUILT_IN = WORKERS

/** A tool name has to survive being called by a model and registered by the harness. */
const TOOL_NAME_PATTERN = /^(?:delegate_)?[a-z][a-z0-9_]{1,30}$/

/** Placeholders a template may use, and where each value comes from. */
export const PLACEHOLDERS = {
  prompt: 'the instruction that points the CLI at the task packet',
  session: 'the session/conversation id to resume (only when resuming)',
  model: 'the model id for this run (only when set)',
  effort: 'the reasoning effort for this run (only when set)',
  speed: 'the speed/service tier for this run (only when set)',
  cwd: 'the working directory the worker runs in',
  timeout: 'the timeout in minutes, as a bare number',
  image: 'one image path, repeated once per image',
  index: 'the 0-based index of the current image',
}

/**
 * Placeholders whose value is always present. `base` and `extra` may use only
 * these: a section is dropped whole when one of its templates has no value, so
 * an optional placeholder in an always-on section would silently take the rest
 * of that section — including the prompt — down with it.
 */
const ALWAYS_PRESENT = ['prompt', 'cwd', 'timeout']

/** Placeholders whose value depends on the run. */
const OPTIONAL = ['session', 'model', 'effort', 'speed', 'image', 'index']

/**
 * The order sections appear in. `base` and `extra` are where a recipe puts
 * anything that has to sit next to the prompt (many CLIs take the prompt as the
 * argument right after a `-p` flag), so `{prompt}` is allowed in them.
 */
export const SECTION_ORDER = ['base', 'cwd', 'resume', 'model', 'effort', 'speed', 'images', 'prompt', 'extra']

const text = (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : null)

/** A list of strings, or null when the section is absent/empty. */
function stringList(value) {
  if (Array.isArray(value) !== true) return null
  const list = value.filter((item) => typeof item === 'string' || typeof item === 'number').map(String)
  return list.length > 0 ? list : null
}

/**
 * Validate one recipe. Every message names the field, because this failure shows
 * up in a config file the user wrote by hand.
 * @returns { recipe } or { error }
 */
export function validateRecipe(id, raw) {
  if (typeof id !== 'string' || /^[a-z][a-z0-9_-]{1,23}$/.test(id) !== true) {
    return { error: `product id "${id}" must be 2-24 lowercase letters, digits, - or _, starting with a letter` }
  }
  if (BUILT_IN.includes(id)) return { error: `"${id}" is a built-in product and cannot be redefined by a recipe` }
  if (raw === null || typeof raw !== 'object') return { error: `product "${id}" must be an object` }
  if (raw.enabled === false) return { error: null, recipe: null, disabled: true }

  const bin = raw.bin
  if (bin === null || typeof bin !== 'object') return { error: `product "${id}": "bin" is required (how to find the CLI)` }
  const names = stringList(bin.names)
  const roots = stringList(bin.roots) ?? []
  if (names === null) return { error: `product "${id}": bin.names must be a non-empty array of executable names (e.g. ["kimi.exe", "kimi"])` }
  for (const name of names) {
    if (name.includes('/') || name.includes('\\')) return { error: `product "${id}": bin.names holds bare file names, not paths ("${name}"); use bin.roots for directories` }
  }
  if (bin.file !== undefined && typeof bin.file !== 'string') return { error: `product "${id}": bin.file must be a string` }

  const args = raw.args
  if (args === null || typeof args !== 'object') return { error: `product "${id}": "args" is required (the command line templates)` }
  const sections = {}
  let promptReferences = 0
  for (const section of SECTION_ORDER) {
    const list = stringList(args[section])
    if (args[section] !== undefined && list === null) return { error: `product "${id}": args.${section} must be a non-empty array of strings` }
    sections[section] = list
    if (list === null) continue
    for (const item of list) {
      for (const match of item.matchAll(/\{([a-z_]+)\}/g)) {
        const name = match[1]
        if (PLACEHOLDERS[name] === undefined) {
          return { error: `product "${id}": args.${section} uses unknown placeholder {${name}}. Known: ${Object.keys(PLACEHOLDERS).join(', ')}` }
        }
        if (name === 'prompt') promptReferences += 1
        if (name === 'image' && section !== 'images') return { error: `product "${id}": {image} only makes sense inside args.images` }
        if (name === 'index' && section !== 'images') return { error: `product "${id}": {index} only makes sense inside args.images` }
        if ((section === 'base' || section === 'extra') && OPTIONAL.includes(name)) {
          return { error: `product "${id}": args.${section} may only use ${ALWAYS_PRESENT.map((p) => `{${p}}`).join(', ')} — {${name}} is optional, and a section is dropped whole when one of its values is missing, which would take the rest of args.${section} with it. Give {${name}} its own section.` }
        }
      }
    }
  }
  if (promptReferences === 0) {
    return { error: `product "${id}": no section references {prompt} — that is how the task reaches the CLI. Put it in args.prompt (last, like Codex) or in args.base (right after the flag, like \`-p "{prompt}"\`).` }
  }

  const output = raw.output === undefined ? {} : raw.output
  if (output === null || typeof output !== 'object') return { error: `product "${id}": output must be an object` }
  const format = text(output.format) ?? 'json'
  if (['json', 'jsonl', 'text'].includes(format) !== true) {
    return { error: `product "${id}": output.format must be "json", "jsonl" or "text" (got "${format}")` }
  }
  for (const field of ['session', 'text', 'error', 'model']) {
    if (output[field] !== undefined && typeof output[field] !== 'string') return { error: `product "${id}": output.${field} must be a dotted path string` }
  }
  if (format === 'text' && text(output.session) === null && text(output.sessionPattern) === null) {
    // Not fatal: a CLI may simply not report a session, which makes every run a
    // fresh one. Say so in the docs rather than refusing the recipe.
  }
  let sessionPattern = null
  if (output.sessionPattern !== undefined) {
    if (typeof output.sessionPattern !== 'string') return { error: `product "${id}": output.sessionPattern must be a string regex` }
    // A pattern without a capture group would silently yield nothing, so require one.
    if (/\((?!\?)/.test(output.sessionPattern) !== true) {
      return { error: `product "${id}": output.sessionPattern needs a capture group, e.g. "session[:\\s]+([0-9a-f-]+)"` }
    }
    try { sessionPattern = new RegExp(output.sessionPattern, 'i') } catch (error) {
      return { error: `product "${id}": output.sessionPattern is not a valid regex (${error.message})` }
    }
  }

  const models = raw.models === undefined ? null : raw.models
  if (models !== null && (models === null || typeof models !== 'object')) return { error: `product "${id}": models must be an object` }
  const modelCommand = models === null ? null : stringList(models.command)
  const modelFormat = models === null ? 'lines' : (text(models.format) ?? 'lines')
  if (models !== null && modelCommand === null) return { error: `product "${id}": models.command must be a non-empty array (e.g. ["models", "--json"])` }
  if (['lines', 'json'].includes(modelFormat) !== true) return { error: `product "${id}": models.format must be "lines" or "json"` }

  const tool = text(raw.tool) ?? `delegate_${id.replace(/-/g, '_')}`
  if (TOOL_NAME_PATTERN.test(tool) !== true) {
    return { error: `product "${id}": tool name "${tool}" is invalid — use lowercase letters, digits and underscores` }
  }

  const state = raw.state === undefined ? {} : raw.state
  if (state === null || typeof state !== 'object') return { error: `product "${id}": state must be an object` }

  return {
    recipe: {
      id,
      label: text(raw.label) ?? id,
      tool,
      bin: { names, roots, file: text(bin.file) ?? names[0], depth: Number.isFinite(bin.depth) ? bin.depth : 1, hint: text(bin.hint) ?? `Install the ${id} CLI, or set workers.${id}.cliPath to its full path.` },
      args: sections,
      output: {
        format,
        session: text(output.session),
        text: text(output.text),
        error: text(output.error),
        model: text(output.model),
        sessionPattern,
      },
      models: modelCommand === null ? null : { command: modelCommand, format: modelFormat, path: text(models.path), pattern: text(models.pattern) },
      stateDir: text(state.dir),
    },
  }
}

/**
 * Every valid custom recipe in the config, in declaration order.
 * @returns { products, errors } — errors are surfaced, never swallowed: a broken
 * recipe would otherwise look like "the product does not exist".
 */
export function customProducts(config) {
  const declared = config?.products
  const products = []
  const errors = []
  if (declared === null || declared === undefined || typeof declared !== 'object') return { products, errors }
  for (const [id, raw] of Object.entries(declared)) {
    // `_comment` / `_notes` are documentation keys, the same convention the rest
    // of config.json uses. They are not products and must not be reported as
    // broken ones.
    if (id.startsWith('_')) continue
    const result = validateRecipe(id, raw)
    if (result.disabled === true) continue
    if (result.error !== null && result.error !== undefined) { errors.push(result.error); continue }
    if (products.some((product) => product.id === result.recipe.id)) { errors.push(`duplicate product "${id}"`); continue }
    products.push(result.recipe)
  }
  return { products, errors }
}

/** Built-in products first, then custom ones, in declaration order. */
export function knownProductIds(config) {
  return [...BUILT_IN, ...customProducts(config).products.map((product) => product.id)]
}

/** True for the three hand-written adapters. */
export function isBuiltIn(id) {
  return BUILT_IN.includes(id)
}

/** The recipe for a custom product, or null for a built-in / unknown id. */
export function recipeFor(config, id) {
  if (isBuiltIn(id)) return null
  return customProducts(config).products.find((product) => product.id === id) ?? null
}

/** Display name for a product. */
export function labelFor(config, id) {
  if (isBuiltIn(id)) return null
  return recipeFor(config, id)?.label ?? id
}

/** The delegate tool name for a product. */
export function toolNameFor(config, id) {
  if (isBuiltIn(id)) return null
  const recipe = recipeFor(config, id)
  if (recipe !== null) return recipe.tool
  return `delegate_${String(id).replace(/-/g, '_')}`
}

/** Read `a.b.c` out of a parsed object. Never throws. */
export function readDotted(value, path) {
  if (typeof path !== 'string' || path.length === 0) return undefined
  let current = value
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined
    const index = /^\d+$/.test(part) ? Number(part) : null
    current = index === null ? current[part] : current[index]
  }
  return current
}

/** Substitute `{name}` placeholders. A template is dropped when a value it needs is absent. */
export function fillTemplate(template, values) {
  let out = ''
  for (const part of template.split(/(\{[a-z_]+\})/)) {
    const match = /^\{([a-z_]+)\}$/.exec(part)
    if (match === null) { out += part; continue }
    const value = values[match[1]]
    if (value === undefined || value === null || value === '') return null
    out += String(value)
  }
  return out
}

/**
 * Expand one arg section.
 * @returns the arguments, or [] when a required value is missing.
 */
export function expandSection(templates, values) {
  if (Array.isArray(templates) !== true || templates.length === 0) return []
  const out = []
  for (const template of templates) {
    const filled = fillTemplate(template, values)
    if (filled === null) return []
    out.push(filled)
  }
  return out
}

/**
 * The full argument list for a custom product, in a fixed, documented order:
 *   base, cwd, resume, model, effort, speed, images, prompt, extra
 * A section whose placeholder has no value is skipped entirely, so an absent
 * model never emits a dangling flag. A CLI that wants the prompt right after
 * its flag puts both in `base` (`["-p", "{prompt}"]`), which is why `{prompt}`
 * is allowed there.
 */
export function buildCustomArgs(recipe, values) {
  const args = []
  for (const section of SECTION_ORDER) {
    if (section === 'resume' && (values.session === null || values.session === undefined)) continue
    if (section === 'model' && (values.model === null || values.model === undefined || values.model === '')) continue
    if (section === 'effort' && (values.effort === null || values.effort === undefined || values.effort === '')) continue
    if (section === 'speed' && (values.speed === null || values.speed === undefined || values.speed === '')) continue
    if (section === 'images') {
      const images = Array.isArray(values.images) ? values.images : []
      for (let index = 0; index < images.length; index += 1) {
        args.push(...expandSection(recipe.args.images, { ...values, image: images[index], index }))
      }
      continue
    }
    args.push(...expandSection(recipe.args[section], values))
  }
  return args
}
