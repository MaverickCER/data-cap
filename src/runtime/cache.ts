/**
 * An optional, bounded default cache -- for prototyping, small applications,
 * and simple standalone usage. Never required by core or by store.ts.
 *
 * Caches complete `DataState` (`fields` + `info`) as one atomic unit, never
 * `fields` alone and never a raw, unvalidated response -- rehydrating
 * `fields` without their corresponding `info` would let a consumer see real
 * values while incorrectly believing `status` is unknown/idle. Distinct
 * from execution dedup (`coordinator.ts`'s job: "a request is already in
 * progress"): a cache answers "validated state is already available",
 * dedup answers "don't start a second identical request" -- mechanically
 * separate concerns even when a caller uses both together.
 *
 * Ships as its own `./runtime/cache` entry point (see tsup.config.ts) so a
 * consumer who never imports it pays nothing for it, structurally -- not
 * merely via named-export tree-shaking.
 */

import type { DataState } from "../core/types.js"

export interface DataCacheOptions {
  /** Maximum number of entries retained; least-recently-used entries are evicted first. Defaults to 100. */
  readonly maxEntries?: number
}

export interface DataCache<TFields> {
  get(key: string): DataState<TFields> | undefined
  set(key: string, state: DataState<TFields>): void
  delete(key: string): void
  clear(): void
  readonly size: number
}

const DEFAULT_MAX_ENTRIES = 100

/**
 * Creates a bounded, least-recently-used-eviction cache of complete
 * `DataState` snapshots keyed by an opaque string the caller computes (e.g.
 * a canonicalized function-identity + params key, mirroring the
 * coordinator's own dedup key -- computing that key is an integration
 * concern outside this module, which is deliberately keying-scheme-agnostic).
 */
export function createDataCache<TFields>(options: DataCacheOptions = {}): DataCache<TFields> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new RangeError("maxEntries must be a positive integer")
  }

  // Map preserves insertion order; deleting then re-inserting a key on
  // every read/write moves it to the end, giving simple LRU ordering with
  // no extra bookkeeping structure.
  const entries = new Map<string, DataState<TFields>>()

  function touch(key: string, value: DataState<TFields>): void {
    entries.delete(key)
    entries.set(key, value)
  }

  return {
    get(key) {
      const value = entries.get(key)
      if (value === undefined) return undefined
      touch(key, value)
      return value
    },
    set(key, state) {
      touch(key, state)
      // Evict the oldest entries until the cache is back within `maxEntries`: the keys are listed
      // oldest-first (Map iteration order is insertion order, and `touch` re-inserts on use).
      const excess = entries.size - maxEntries
      for (const oldestKey of [...entries.keys()].slice(0, Math.max(0, excess))) {
        entries.delete(oldestKey)
      }
    },
    delete(key) {
      entries.delete(key)
    },
    clear() {
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}
