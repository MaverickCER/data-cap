/**
 * Array identity: computes a stable per-item key from developer-declared
 * identity field names, and reconciles an array's `DataInfo` map against a
 * new `fields` array using that key, preserving reference identity for
 * unaffected items (see specs/architecture.md's "DataInfo array
 * reconciliation").
 *
 * Internal -- not re-exported from the public `.` barrel. Consumed by the
 * (future) standalone runtime whenever it populates `info` for an
 * identity-configured array field.
 *
 * Identity is declared as an array of key names (`["id"]`, `["postId",
 * "commentId"]`) -- never a callback, never a dot-notation path, and never
 * React's "key" terminology (this is a data-oriented concept, not a
 * rendering one). Identity metadata exists only for `DataInfo`; it never
 * alters `fields` itself, and arrays without a declared identity get no
 * per-item `DataInfo` at all (never a numeric-index fallback -- that would
 * reintroduce exactly the array-index-as-key fragility this system exists
 * to avoid).
 */

import { canonicalize } from "./canonicalize.js"

/** Declared identity field names for one array item shape -- e.g. `["id"]`, or `["postId", "commentId"]` for a composite key. */
export type IdentityKeys<Item> = readonly (keyof Item & string)[]

/** Why one array item couldn't be assigned a stable identity key. */
export type IdentityWarningReason = "missing-key" | "malformed-item" | "duplicate-identity"

/** One array item that couldn't be reconciled by identity -- surfaced, never silently dropped. */
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
// prove side-effect-free, so it could never be tree-shaken -- forcing every
// consumer of `data-cap/helpers` to pay for canonicalize.ts even
// when they only import `processors`/`shape` (see test/helpers/tree-shaking.test.ts).
function missingComponentToken(): string {
  const token = canonicalize(undefined)
  // `canonicalize(undefined)` is `canonicalizeScalar(undefined, "undefined")` ->
  // `atom("u", "")`, never `undefined` -- this only narrows `string | undefined`.
  // Stryker disable ConditionalExpression, BlockStatement, StringLiteral
  if (token === undefined) {
    throw new Error("unreachable: canonicalize(undefined) is always defined")
  }
  // Stryker restore ConditionalExpression, BlockStatement, StringLiteral
  return token
}

/**
 * Computes the joined identity key for one array item. Each declared key's
 * value is independently canonicalized (so `1` and `"1"`, or `NaN` and any
 * number, can never collide) and concatenated via `canonicalize`'s own
 * self-delimiting encoding -- no additional separator is needed. A missing
 * key, a `null`/`undefined` component, or a non-canonicalizable component
 * (a function, a symbol, ...) all degrade to the same fixed token rather
 * than throwing or silently colliding with unrelated data; each is recorded
 * as a warning against `path`.
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
 * against the previous map: an identity the current operation did not touch
 * (per `touchedIdentities`), but that still exists in `nextItems`, keeps its
 * previous `TInfo` object reference exactly -- this is the release-blocking
 * performance invariant `next.info.comments["1"] === previous.info.comments["1"]`
 * relies on. Identities no longer present in `nextItems` are dropped (no
 * orphans); this is always a full recompute of the key SET (never
 * incremental), even though individual entries are reference-preserved.
 *
 * A duplicate identity across two items is not an error: both items remain
 * in `fields` untouched, but they share one `DataInfo` slot -- the
 * last-encountered item during the walk determines that slot's info
 * (recorded as a warning, never silently ignored).
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
