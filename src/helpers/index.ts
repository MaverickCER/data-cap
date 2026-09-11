/**
 * Optional convenience helpers for writing processors, working with array
 * identity, and structurally narrowing raw values. Entirely separate from
 * core/runtime -- neither `buildData` nor the runtime's `createData` have
 * knowledge of this module and behave identically without it.
 *
 * Usage: `processors.toNumber(raw.age)`, `shape.isPlainObject(raw)`,
 * `identity.computeItemIdentity(item, ["id"], [], warnings)`.
 *
 * Deliberately built from explicit named imports assembled into plain
 * object literals, not `export * as processors from "./processors.js"`. A
 * bundler (tsup/esbuild) lowers that `export * as` form into a namespace-
 * construction helper call it can't prove side-effect-free, which defeats
 * tree-shaking in a *second*, downstream bundling pass (a consumer's own
 * bundler bundling this already-bundled package): importing only
 * `processors` would still ship all of `shape`'s code. A plain object
 * literal of already-imported bindings has no such call in the way, so
 * `import { processors } from "data-cap/helpers"` alone drops
 * `shape`/`identity` entirely.
 */
import {
  parseJSON,
  toArray,
  toBigInt,
  toBoolean,
  toDate,
  toInteger,
  toLowerCase,
  toNumber,
  toRegExp,
  toString,
  toURL,
  toUpperCase,
  trim,
} from "./processors.js"
import { computeItemIdentity, reconcileArrayInfo } from "./identity.js"
import { isDate, isNullish, isPlainObject, isRegExp, isURL } from "./shape.js"

export { canonicalize } from "./canonicalize.js"
export type {
  IdentityKeys,
  IdentityWarning,
  IdentityWarningReason,
  ReconcileArrayInfoResult,
} from "./identity.js"

/** Convenience coercion helpers for a `processor(raw, ctx)` function (e.g. `processors.toNumber(raw.age)`). Never throw -- unparseable input resolves to `undefined`. */
export const processors = {
  /** Parses a JSON string; non-string input returns `undefined`. */
  parseJSON,
  /** Splits a delimited string into trimmed items; an array input passes through stringified. */
  toArray,
  /** Coerces a string/number to a `bigint`. */
  toBigInt,
  /** Coerces common boolean-like strings (`true`/`1`/`yes`/`on`, and their opposites) to a real boolean. */
  toBoolean,
  /** Parses a value into a `Date`. */
  toDate,
  /** Coerces a value to a number and requires it to be an integer. */
  toInteger,
  /** Lowercases a coercible value. */
  toLowerCase,
  /** Coerces a value to a number, rejecting empty/whitespace-only strings. */
  toNumber,
  /** Compiles a string into a `RegExp`. */
  toRegExp,
  /** Coerces a value to a string. */
  toString,
  /** Parses a value into a `URL`. */
  toURL,
  /** Uppercases a coercible value. */
  toUpperCase,
  /** Trims surrounding whitespace from a coercible value. */
  trim,
}

/** Array-identity primitives -- the same ones the standalone runtime uses to reconcile `info` for an identity-configured array field. */
export const identity = {
  /** Computes the joined identity key for one array item from its declared identity fields. */
  computeItemIdentity,
  /** Reconciles an identity-keyed `DataInfo` map against a new items array, preserving reference identity for untouched entries. */
  reconcileArrayInfo,
}

/** Structural (never business-rule) type guards for narrowing a raw value inside a processor. */
export const shape = {
  /** True for a `Date` instance. */
  isDate,
  /** True for `null`/`undefined`. */
  isNullish,
  /** True for a plain object literal (or `Object.create(null)`) -- false for arrays, `null`, and class instances. */
  isPlainObject,
  /** True for a `RegExp` instance. */
  isRegExp,
  /** True for a `URL` instance. */
  isURL,
}
