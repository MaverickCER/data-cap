/**
 * Array identity: computes a stable per-item key from developer-declared
 * identity field names. It then reconciles an array's `DataInfo` map against
 * a new `fields` array using that key. Unaffected items keep their reference
 * identity (see specs/architecture.md's "DataInfo array reconciliation").
 *
 * Internal: not re-exported from the public `.` barrel. Consumed by the
 * (future) standalone runtime whenever it populates `info` for an
 * identity-configured array field.
 *
 * Identity is declared as an array of key names (`["id"]`, `["postId",
 * "commentId"]`). It is never a callback or a dot-notation path. It never
 * uses React's "key" terminology: this is a data concept, not a rendering
 * one. Identity metadata exists only for `DataInfo` and never alters
 * `fields` itself. Arrays without a declared identity get no per-item
 * `DataInfo` at all. There is no numeric-index fallback: that would bring
 * back the array-index-as-key fragility this system exists to avoid.
 */

import { canonicalize } from "./canonicalize.js"

/** Declared identity field names for one array item shape: e.g. `["id"]`, or `["postId", "commentId"]` for a composite key. */
export type IdentityKeys<Item> = readonly (keyof Item & string)[]

/** Why one array item couldn't be assigned a stable identity key. */
export type IdentityWarningReason = "missing-key" | "malformed-item" | "duplicate-identity"

/** One array item that couldn't be reconciled by identity: surfaced, never silently dropped. */
export interface IdentityWarning {
  /** Path to the array field, then the item's index within it. */
  readonly path: readonly string[]
  /** Why this item couldn't be reconciled. */
  readonly reason: IdentityWarningReason
}

// A missing key and a non-canonicalizable component both degrade to the exact
// same token `canonicalize(undefined)` naturally produces (`undefined` is
// itself a supported, always-defined canonicalizable case), so no per-call-site
// fallback is needed. A plain function, never a module-top-level
// `const x = canonicalize(undefined)`: that top-level call is one esbuild can't
// prove side-effect-free, so it could never be tree-shaken; forcing every
// consumer of `data-cap/helpers` to pay for canonicalize.ts even
// when they only import `processors`/`shape` (see test/helpers/tree-shaking.test.ts).
function missingComponentToken(): string {
  // `canonicalize(undefined)` is always a string (`atom("u", "")`); `String()` only narrows the type.
  return String(canonicalize(undefined))
}

/**
 * Computes the joined identity key for one array item. Each declared key's
 * value is canonicalized on its own, so `1` and `"1"`, or `NaN` and any
 * number, can never collide. The parts are concatenated through
 * `canonicalize`'s self-delimiting encoding, so no extra separator is needed. A missing key, a
 * `null` or `undefined` component, or one that cannot be canonicalized (a
 * function, a symbol) becomes the same fixed token. Nothing throws or silently
 * collides with unrelated data, and each case is recorded as a warning against
 * `path`.
 */
export function computeItemIdentity<Item>(
  item: Item,
  keys: IdentityKeys<Item>,
  path: readonly string[],
  warnings: IdentityWarning[],
): string {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    warnings.push({ path, reason: "malformed-item" })
    return keys.map(() => missingComponentToken()).join("")
  }

  const itemRecord = item as Record<string, unknown>
  let joined = ""
  for (const key of keys) {
    if (!Object.hasOwn(itemRecord, key)) {
      warnings.push({ path: [...path, key], reason: "missing-key" })
      joined += missingComponentToken()
      continue
    }
    joined += canonicalize(itemRecord[key]) ?? missingComponentToken()
  }
  return joined
}

/** The result of reconciling an array field's identity-keyed `DataInfo` map against a new `fields` array. */
export interface ReconcileArrayInfoResult<TInfo> {
  /** The reconciled identity-keyed info map, preserving reference identity for unaffected items. */
  readonly info: Partial<Record<string, TInfo>>
  /** Items that couldn't be reconciled by identity, never silently dropped. */
  readonly warnings: readonly IdentityWarning[]
}

/**
 * Recomputes an array field's identity-keyed `DataInfo` map by diffing
 * against the previous map. An identity the current operation did not touch
 * (per `touchedIdentities`), but that still exists in `nextItems`, keeps its
 * previous `TInfo` object reference exactly. This is the release-blocking
 * performance invariant `next.info.comments["1"] === previous.info.comments["1"]`
 * relies on. Identities no longer present in `nextItems` are dropped, so no
 * orphans remain. The key SET is always fully recomputed, never
 * incrementally, even though individual entries keep their references.
 *
 * A duplicate identity across two items is not an error. Both items stay in
 * `fields` untouched, but they share one `DataInfo` slot. The last item the
 * walk meets sets that slot's info, and a warning records it.
 */
export function reconcileArrayInfo<Item, TInfo>(
  prevInfo: Partial<Record<string, TInfo>> | undefined,
  nextItems: readonly Item[],
  identityKeys: IdentityKeys<Item>,
  touchedIdentities: ReadonlySet<string> | "all",
  makeInfoFor: (item: Item, identityKey: string) => TInfo,
): ReconcileArrayInfoResult<TInfo> {
  const warnings: IdentityWarning[] = []
  const nextInfo: Partial<Record<string, TInfo>> = {}
  const seenKeys = new Set<string>()

  for (const [index, item] of nextItems.entries()) {
    const key = computeItemIdentity(item, identityKeys, [String(index)], warnings)

    if (seenKeys.has(key)) {
      warnings.push({ path: [String(index)], reason: "duplicate-identity" })
    }
    seenKeys.add(key)

    const touched = touchedIdentities === "all" || touchedIdentities.has(key)
    if (!touched && prevInfo !== undefined && Object.hasOwn(prevInfo, key)) {
      nextInfo[key] = prevInfo[key]
    } else {
      nextInfo[key] = makeInfoFor(item, key)
    }
  }

  return { info: nextInfo, warnings }
}
