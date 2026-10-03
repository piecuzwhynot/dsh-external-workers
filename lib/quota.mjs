/**
 * Plan quota: how much of the 5-hour and weekly allowance is gone, and whether
 * the next run would spend CREDITS instead of plan quota.
 *
 * Why this exists: the bridge hands work to a CLI and cannot see the wall it is
 * about to hit. A weekly limit at 98% means the next delegation dies; worse, on
 * Codex a reached limit silently starts billing credits. Both are avoidable if
 * the numbers are known BEFORE dispatch.
 *
 * Where the numbers come from — Codex's own rollout files
 * (`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`). Every Codex turn appends an
 * `event_msg` / `token_count` event carrying:
 *
 *   rate_limits.primary    { used_percent, window_minutes: 300,   resets_at }   <- 5 hours
 *   rate_limits.secondary  { used_percent, window_minutes: 10080, resets_at }   <- 7 days
 *   rate_limits.credits    { has_credits, unlimited, balance }
 *   rate_limits.plan_type, rate_limits.rate_limit_reached_type
 *
 * That directory is written by EVERY Codex surface — the bridge's own lanes, the
 * Codex desktop app, and the CLI — so the reading stays current even when the
 * usage happened somewhere else. This module reads it, and nothing else: no
 * network, no credentials, no extra process.
 *
 * The other two products are deliberately absent: Claude Code computes
 * five_hour/seven_day usage but caches none of it (it is only rendered in its
 * TUI), and agy logs no numbers at all. Inventing a proxy for them would be a
 * guess dressed as a fact. `readQuota` returns null for them instead, and the
 * caller says so out loud.
 *
 * @module dsh-external-workers/quota
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** A 5-hour window is 300 minutes; a weekly one is 10080. Used to label, not to filter. */
export const WINDOW_LABELS = { 300: '5h', 10080: 'week' }

/** How far back to look for a rollout file before giving up. */
const MAX_DAY_DIRS = 4
const MAX_FILES_PER_DAY = 40
const MAX_TAIL_BYTES = 512 * 1024
/** The web panel polls every few seconds; the numbers only move when Codex runs. */
const CACHE_TTL_MS = 10 * 1000
/** "<product>:<source root>" -> { at, value }. Keyed by the root too: a cache
 *  that ignored which directory was read would serve one CODEX_HOME's numbers
 *  for another. */
const cache = new Map()

/** Local calendar day directory Codex uses: sessions/YYYY/MM/DD. */
function dayDirectory(root, date) {
  const pad = (value) => String(value).padStart(2, '0')
  return join(root, String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()))
}

/**
 * The rollout files worth checking, newest first: today and the few days before
 * it. Ordered by mtime so the newest snapshot is found without reading them all.
 */
function candidateRollouts(root, now) {
  const found = []
  for (let back = 0; back < MAX_DAY_DIRS; back += 1) {
    const dir = dayDirectory(root, new Date(now - back * 86400000))
    let names
    try { names = readdirSync(dir) } catch { continue }
    const files = []
    for (const name of names) {
      if (name.endsWith('.jsonl') !== true) continue
      const full = join(dir, name)
      try { files.push({ full, mtime: statSync(full).mtimeMs }) } catch { /* ignore */ }
    }
    files.sort((a, b) => b.mtime - a.mtime)
    found.push(...files.slice(0, MAX_FILES_PER_DAY))
  }
  return found.sort((a, b) => b.mtime - a.mtime)
}

/** The LAST rate_limits object in one rollout file, or null. */
function lastRateLimits(path) {
  let text
  try {
    const size = statSync(path).size
    const raw = readFileSync(path)
    const slice = size > MAX_TAIL_BYTES ? raw.subarray(size - MAX_TAIL_BYTES) : raw
    text = slice.toString('utf8')
  } catch {
    return null
  }
  let found = null
  for (const line of text.split(/\r?\n/)) {
    // Cheap pre-filter: most lines are not token counts.
    if (line.includes('rate_limits') !== true) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    const limits = event?.payload?.rate_limits
    if (limits === null || typeof limits !== 'object') continue
    found = limits
  }
  return found
}

/** Normalise one rate-limit window. */
function window_(value) {
  if (value === null || typeof value !== 'object') return null
  const percent = Number(value.used_percent)
  if (Number.isFinite(percent) !== true) return null
  const minutes = Number.isFinite(Number(value.window_minutes)) ? Number(value.window_minutes) : null
  const resetsAt = Number.isFinite(Number(value.resets_at)) ? Number(value.resets_at) : null
  return {
    usedPercent: Math.max(0, Math.min(200, Math.round(percent))),
    windowMinutes: minutes,
    label: minutes === null ? null : (WINDOW_LABELS[minutes] ?? `${minutes}m`),
    resetsAt: resetsAt === null ? null : resetsAt * 1000,
  }
}

/** Turn a raw rate_limits object into the shape the rest of the plugin uses. */
export function normalizeQuota(limits, extra = {}) {
  if (limits === null || typeof limits !== 'object') return null
  const credits = limits.credits === null || limits.credits === undefined ? null : {
    hasCredits: limits.credits.has_credits === true,
    unlimited: limits.credits.unlimited === true,
    balance: typeof limits.credits.balance === 'string' && limits.credits.balance.length > 0 ? Number(limits.credits.balance) : null,
  }
  const primary = window_(limits.primary)
  const secondary = window_(limits.secondary)
  // `primary` is the short window and `secondary` the long one on Codex today,
  // but the window length is what actually identifies them — so label by that
  // and keep both, rather than trusting the slot name.
  const windows = [primary, secondary].filter((item) => item !== null)
  const short = windows.find((item) => item.windowMinutes !== null && item.windowMinutes <= 1440) ?? null
  const long = windows.find((item) => item.windowMinutes !== null && item.windowMinutes > 1440) ?? null
  const reached = typeof limits.rate_limit_reached_type === 'string' && limits.rate_limit_reached_type.length > 0
    ? limits.rate_limit_reached_type
    : null
  return {
    product: extra.product ?? 'gpt',
    readAt: extra.readAt ?? Date.now(),
    source: extra.source ?? null,
    planType: typeof limits.plan_type === 'string' ? limits.plan_type : null,
    short,
    long,
    windows,
    credits,
    limitReached: reached,
    // True when the plan allowance is gone, so the next run is billed to credits.
    // `rate_limit_reached_type` is Codex's own verdict and wins; the percentage
    // fallback uses ANY window at 100%, because a spent 5-hour window cannot
    // serve a request either — waiting for the weekly one to fill up as well
    // would hide exactly the moment money starts being spent.
    willUseCredits: reached !== null || windows.some((item) => item.usedPercent >= 100),
  }
}

/**
 * The newest quota snapshot Codex wrote, or null when there is none to read.
 *
 * Only `gpt` can be answered: the numbers live in Codex's rollout files, so
 * asking for another product returns null rather than handing back Codex's
 * figures under someone else's name. That guard belongs here, not only in the
 * caller — a mislabelled quota is worse than no quota.
 *
 * Cached for a few seconds because the web panel polls, while the numbers only
 * change when Codex runs. A delegation passes `fresh: true`, since that is the
 * moment the answer actually has to be current.
 *
 * @param options.codexHome override for tests
 * @param options.now       clock override for tests
 * @param options.product   product id to stamp on the result (only 'gpt')
 * @param options.fresh     skip the cache
 */
export function readQuota(options = {}) {
  const product = options.product ?? 'gpt'
  if (product !== 'gpt') return null
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const root = join(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  const cacheKey = `${product}:${root}`
  const cached = cache.get(cacheKey)
  if (options.fresh !== true && cached !== undefined && now - cached.at < CACHE_TTL_MS) return cached.value
  let value = null
  for (const file of candidateRollouts(root, now)) {
    const limits = lastRateLimits(file.full)
    if (limits === null) continue
    value = normalizeQuota(limits, { product, readAt: now, source: file.full })
    if (value !== null) break
  }
  cache.set(cacheKey, { at: now, value })
  return value
}

/** "51% of the week, resets in 2d 4h" — one line for a warning or the panel. */
export function describeQuota(quota, now = Date.now()) {
  if (quota === null) return 'quota: not readable from this product'
  const parts = []
  for (const item of [quota.short, quota.long]) {
    if (item === null) continue
    const label = item.label ?? (item.windowMinutes === null ? 'window' : `${item.windowMinutes}m`)
    const reset = item.resetsAt === null ? '' : ` (resets in ${describeReset(item.resetsAt - now)})`
    parts.push(`${label} ${item.usedPercent}%${reset}`)
  }
  if (quota.credits !== null) {
    const balance = quota.credits.balance === null ? '' : ` $${quota.credits.balance.toFixed(2)}`
    parts.push(`credits${balance}${quota.credits.hasCredits === true ? '' : ' (none)'}`)
  }
  if (quota.planType !== null) parts.push(`plan ${quota.planType}`)
  if (quota.willUseCredits) parts.push('LIMIT REACHED — the next run spends credits')
  return parts.join(' · ')
}

/** "2d 4h" / "35m" / "now" */
export function describeReset(ms) {
  if (Number.isFinite(ms) !== true) return 'unknown'
  if (ms <= 0) return 'now'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/**
 * Decide whether a delegation should be held back.
 *
 * @param quota     a readQuota() result, or null when unreadable
 * @param options.threshold   percent at which the user wants to be asked (default 90)
 * @param options.allowQuota  the user already said "keep going"
 * @param options.allowCredits the user already approved spending credits
 * @param options.needsCredits true when this job cannot run on the plan at all
 * @returns { blocked, reason, text } — blocked means: ask the user first
 */
export function quotaGate(quota, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : 90
  if (quota === null) return { blocked: false, reason: null, text: null, quota: null }

  const hot = [quota.short, quota.long].filter((item) => item !== null && item.usedPercent >= threshold)
  if (quota.willUseCredits && options.allowCredits !== true) {
    return {
      blocked: true,
      reason: 'credits',
      quota,
      text: [
        `**Codex plan allowance is gone.** ${describeQuota(quota)}`,
        '',
        'The next run would be billed to **credits**, not to your plan. Nothing has been started.',
        'Tell the user, and only continue if they approve — then call again with `allow_credits: true`.',
      ].join('\n'),
    }
  }
  if (hot.length > 0 && options.allowQuota !== true) {
    return {
      blocked: true,
      reason: 'threshold',
      quota,
      text: [
        `**Codex quota is nearly used up** (threshold ${threshold}%): ${describeQuota(quota)}`,
        '',
        'Nothing has been started. Ask the user whether to continue; if they say yes, call again with `allow_quota: true`.',
      ].join('\n'),
    }
  }
  return { blocked: false, reason: null, text: null, quota }
}
