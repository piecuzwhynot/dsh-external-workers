/**
 * Lane identity: pure functions, no IO, no Harness objects.
 *
 * A LANE is the unit of work — a product plus a model (and effort/speed) plus a
 * role, with its own working directory and its own persistent session. `gpt`
 * can therefore run `lore` (luna) and `models` (sol) as two separate threads,
 * which matters because Codex and Claude both attach a session to one model and
 * warn when a thread is resumed with a different one.
 *
 * This module exists on its own for one reason: the record-key migration below
 * silently decides whether the user keeps the sessions they already have, so it
 * has to be testable without a running Harness. Everything here takes its data
 * as arguments — the caller owns the config file and the durable table.
 *
 * @module dsh-external-workers/lanes
 */
import { WORKERS, LANE_ID_PATTERN } from './store.mjs'

/**
 * The lanes config.json declares, in order. An empty or unusable list falls
 * back to one lane per product, named after the product — which is exactly how
 * this plugin behaved before lanes existed.
 *
 * @param knownProducts product ids that may carry a lane: the built-ins plus any
 *        custom product declared in config.json. Defaults to the built-ins.
 */
export function configuredLanes(config, knownProducts = WORKERS) {
  const declared = Array.isArray(config?.lanes) ? config.lanes : []
  const lanes = []
  for (const entry of declared) {
    if (entry === null || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : ''
    const worker = typeof entry.worker === 'string' ? entry.worker.trim().toLowerCase() : ''
    if (LANE_ID_PATTERN.test(id) !== true || knownProducts.includes(worker) !== true) continue
    if (lanes.some((lane) => lane.id === id)) continue
    lanes.push({ id, worker, role: entry.role ?? null, model: entry.model ?? null, effort: entry.effort ?? null, speed: entry.speed ?? null })
  }
  if (lanes.length > 0) return lanes
  return knownProducts.map((worker) => ({ id: worker, worker, role: null, model: null, effort: null, speed: null }))
}

/** True when config.json names its lanes instead of using the one-per-product default. */
export function lanesAreNamed(config) {
  const declared = config?.lanes
  return Array.isArray(declared) && declared.some((entry) => entry !== null && typeof entry === 'object')
}

/**
 * The legacy record a lane should inherit, if any.
 *
 * Records used to be keyed by product name (`claude`, `gpt`, `google`). Once
 * the config names its lanes, those keys stop matching any lane id — and the
 * persistent session the user already has would be orphaned and silently
 * replaced by a fresh one. So the FIRST lane of each product adopts its
 * product's legacy record. Every further lane of that product starts empty on
 * purpose: separate sessions are the whole point of lanes.
 *
 * @param laneId  the lane being resolved
 * @param config  the parsed config.json
 * @param lookup  (key) => record | undefined, i.e. the durable lane table
 * @param knownProducts product ids that may carry a lane
 * @returns `{ legacy, legacyKey }`, or null when there is nothing to inherit
 */
export function legacyAdoption(laneId, config, lookup, knownProducts = WORKERS) {
  if (lookup(laneId) !== undefined) return null
  const lanes = configuredLanes(config, knownProducts)
  const index = lanes.findIndex((lane) => lane.id === laneId)
  if (index < 0) return null
  if (lanes.findIndex((lane) => lane.worker === lanes[index].worker) !== index) return null
  const legacyKey = lanes[index].worker
  const legacy = lookup(legacyKey)
  if (legacy === undefined) return null
  return { legacy, legacyKey }
}

/**
 * Every lane, merging the durable record (which owns the session and any
 * runtime assignment) over the config declaration. Lanes that exist only in the
 * table — created at runtime, never declared — are appended in table order.
 *
 * A record still keyed by product name is skipped once the config names its
 * lanes: that product's first lane has already adopted its contents, so listing
 * it again would show the same session twice under two names.
 *
 * @param config   the parsed config.json
 * @param entries  [[key, record], …] from the durable table
 * @param knownProducts product ids that may carry a lane
 */
export function laneTableFrom(config, entries, knownProducts = WORKERS) {
  const named = lanesAreNamed(config)
  const lookup = (key) => entries.find(([entryKey]) => entryKey === key)?.[1]
  const declared = configuredLanes(config, knownProducts)
  const lanes = declared.map((lane) => {
    const own = lookup(lane.id)
    const inherited = own === undefined ? legacyAdoption(lane.id, config, lookup, knownProducts) : undefined
    const record = own ?? inherited?.legacy
    // An adopted record carries continuity — session, cwd, state, lastModel —
    // but its role/model/effort/speed were assigned when the PRODUCT was the
    // unit, so they describe no particular lane. For those fields the lane's own
    // declaration wins; for every other lane, a runtime assignment still beats
    // the config file, as it always has.
    const adopted = inherited !== undefined
    const pick = (key) => {
      const text = (value) => (typeof value === 'string' && value.length > 0 ? value : null)
      const fromStore = text(record?.[key])
      const fromConfig = text(lane[key])
      return adopted ? (fromConfig ?? fromStore) : (fromStore ?? fromConfig)
    }
    return {
      id: lane.id,
      worker: lane.worker,
      role: pick('role'),
      model: pick('model'),
      effort: pick('effort'),
      speed: pick('speed'),
      sessionId: record?.sessionId ?? null,
      state: record?.state ?? 'idle',
      lastModel: record?.lastModel ?? null,
    }
  })
  for (const [key, record] of entries) {
    if (lanes.some((lane) => lane.id === key)) continue
    // A record still keyed by product name, when the config declares lanes for
    // that product: its first lane has already adopted the contents, so listing
    // it again would show one session under two names. A product with NO
    // declared lane is kept visible instead — hiding a record would hide a
    // session the user still owns.
    if (named === true && knownProducts.includes(key) && declared.some((lane) => lane.worker === key)) continue
    if (typeof record?.worker !== 'string' || knownProducts.includes(record.worker) !== true) continue
    lanes.push({
      id: key,
      worker: record.worker,
      role: record.role ?? null,
      model: record.model ?? null,
      effort: record.effort ?? null,
      speed: record.speed ?? null,
      sessionId: record.sessionId ?? null,
      state: record.state ?? 'idle',
      lastModel: record.lastModel ?? null,
    })
  }
  return lanes
}

/**
 * Resolve the lane a delegation runs in. An explicit id must exist and must
 * belong to the product being called; otherwise the product's first lane is the
 * default.
 *
 * @returns `{ lane }` or `{ error }` — never throws, so the tool can report it.
 */
export function pickLaneFrom(lanes, worker, laneId) {
  if (typeof laneId === 'string' && laneId.trim().length > 0) {
    const wanted = laneId.trim().toLowerCase()
    const found = lanes.find((lane) => lane.id === wanted)
    if (found === undefined) return { error: `no lane named "${laneId}". Known lanes: ${lanes.map((lane) => lane.id).join(', ')}` }
    if (found.worker !== worker) return { error: `lane "${laneId}" belongs to worker "${found.worker}", not "${worker}"` }
    return { lane: found }
  }
  const first = lanes.find((lane) => lane.worker === worker)
  if (first === undefined) return { error: `no lane configured for worker "${worker}"` }
  return { lane: first }
}
