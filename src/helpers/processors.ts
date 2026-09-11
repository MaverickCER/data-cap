/**
 * Optional convenience coercion helpers for writing a getter/mutator/
 * subscription `processor(raw, ctx)` function. Entirely separate from core
 * -- neither `buildData` nor the runtime's `createData` import this module;
 * an application processor calls into it, never the other way around.
 *
 * Unlike env-cap's `helpers.processors` (a per-field pipeline slot that
 * throws a descriptive error on failure), a data-cap processor's returned
 * patch already runs through `core/ownership.ts`'s own shape check and
 * per-field reset-to-default on the way to a commit -- so these never
 * throw and never format an error message; on unparseable input, each
 * simply returns `undefined`, leaving the ownership/shape pipeline's own
 * fallback to decide what happens next.
 */

/** Runs `parse`, returning its result, or `undefined` if it throws. */
function orUndefined<T>(parse: () => T): T | undefined {
  try {
    return parse()
  } catch {
    // unparseable input degrades to `undefined` (see the module doc)
  }
  return undefined
}

export function toString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  // `String(x)` is identity for a string, so no need to special-case one.
  return String(value)
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isNaN(value) ? undefined : value
  // `Number("")` is `0`, not `NaN` -- without this check a blank string
  // would silently resolve to the number 0 instead of degrading to
  // `undefined` like every other unparseable case here.
  if (typeof value !== "string" || value.trim() === "") return undefined
  const result = Number(value)
  return Number.isNaN(result) ? undefined : result
}

export function toInteger(value: unknown): number | undefined {
  const result = toNumber(value)
  // `Number.isInteger(undefined)` is already `false`, so no separate nullish guard.
  return Number.isInteger(result) ? result : undefined
}

export function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (["true", "1", "yes", "on"].includes(normalized)) return true
  if (["false", "0", "no", "off"].includes(normalized)) return false
  return undefined
}

export function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const result = new Date(value)
  return Number.isNaN(result.getTime()) ? undefined : result
}

export function toURL(value: unknown): URL | undefined {
  if (value instanceof URL) return value
  if (typeof value !== "string") return undefined
  return orUndefined(() => new URL(value))
}

export function toRegExp(value: unknown): RegExp | undefined {
  if (value instanceof RegExp) return value
  if (typeof value !== "string") return undefined
  return orUndefined(() => new RegExp(value))
}

export function toBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value
  if (typeof value !== "string" && typeof value !== "number") return undefined
  return orUndefined(() => BigInt(value))
}

export function trim(value: unknown): string | undefined {
  const str = toString(value)
  return str === undefined ? undefined : str.trim()
}

export function toLowerCase(value: unknown): string | undefined {
  const str = toString(value)
  return str === undefined ? undefined : str.toLowerCase()
}

export function toUpperCase(value: unknown): string | undefined {
  const str = toString(value)
  return str === undefined ? undefined : str.toUpperCase()
}

/** Splits a delimited string into trimmed items; an array input passes through stringified. */
export function toArray(value: unknown, separator: string | RegExp = ","): string[] | undefined {
  if (Array.isArray(value)) return value.map((item: unknown) => String(item))
  if (typeof value !== "string") return undefined
  if (value.trim() === "") return []
  return value.split(separator).map((item) => item.trim())
}

/**
 * Parses a JSON string; non-string input returns `undefined`. Returns
 * `unknown` rather than an assertable `<T>` -- its result flows into a
 * processor's returned patch, which already runs through
 * `core/ownership.ts`'s own shape check on the way to a commit, so an
 * unchecked generic cast here would just hide that same unsafety behind a
 * type parameter instead of surfacing it at the call site.
 */
export function parseJSON(value: unknown): unknown {
  if (typeof value !== "string") return undefined
  return orUndefined(() => JSON.parse(value) as unknown)
}
