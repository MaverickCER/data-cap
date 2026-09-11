/**
 * Deterministic canonicalization of arbitrary runtime values into a single
 * comparable string, or `undefined` when the value cannot be safely
 * canonicalized (never throws, never silently collides). Shared by array
 * identity key computation (`identity.ts`) and, in a later phase, the
 * runtime coordinator's execution-dedup key.
 *
 * Internal -- not re-exported from the public `.` barrel.
 *
 * Encoding: every value becomes a self-delimiting "atom" -- `<tag><byteLen>:<payload>`
 * -- and composite values (arrays/objects) concatenate their children's
 * already-self-delimiting atoms directly, with NO separator character
 * between them and therefore nothing to escape. Each atom carries its own
 * payload length, so two distinct logical values can never produce an
 * identical canonical string by one value's content "leaking" into where a
 * delimiter would otherwise be expected -- this sidesteps the entire class
 * of separator-escaping bugs a reserved-character scheme would need to get
 * right.
 */

function atom(tag: string, payload: string): string {
  return `${tag}${payload.length}:${payload}`
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])

/** `canonicalizeBuiltin` returns this when `value` is not one of the built-in object types it handles -- distinct from `undefined`, which means "a built-in that cannot be canonicalized" (e.g. an invalid `Date`). */
const NOT_A_BUILTIN = Symbol("not-a-builtin")

/** Canonicalizes a `number` -- NaN / ±Infinity each get their own tag; every other value goes through `String()`. */
function canonicalizeNumber(num: number): string {
  if (Number.isNaN(num)) return atom("N", "")
  if (num === Number.POSITIVE_INFINITY) return atom("P", "")
  if (num === Number.NEGATIVE_INFINITY) return atom("M", "")
  // Distinguishes `1` from `"1"` via the tag alone; +0/-0 share one canonical
  // form (both `String()` to "0"), a deliberate simplification -- no observable
  // field/param semantics in this package depend on the sign of zero.
  return atom("n", String(num))
}

/** Canonicalizes every non-object value (`typeof value !== "object"`), plus `null`. `undefined` result = unsupported (a function or a symbol). */
function canonicalizeScalar(value: unknown, type: string): string | undefined {
  if (value === undefined) return atom("u", "")
  if (value === null) return atom("z", "")
  if (type === "string") return atom("s", value as string)
  if (type === "boolean") return atom("b", value === true ? "1" : "0")
  if (type === "bigint") return atom("i", (value as bigint).toString())
  if (type === "number") return canonicalizeNumber(value as number)
  // function | symbol
  return undefined
}

/** Canonicalizes the built-in object types with a stable serialization (`Date`/`URL`/`RegExp`), or {@link NOT_A_BUILTIN} for anything else. `undefined` = an invalid `Date`. */
function canonicalizeBuiltin(value: object): string | undefined | typeof NOT_A_BUILTIN {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isNaN(time) ? undefined : atom("d", value.toISOString())
  }
  if (value instanceof URL) return atom("l", value.href)
  if (value instanceof RegExp) return atom("r", value.toString())
  return NOT_A_BUILTIN
}

/** Canonicalizes a non-built-in object: a class instance via its `.toJSON()` (the `JSON.stringify` convention), or a plain object via a sorted own-key walk. `undefined` = unsupported (a class instance with no `.toJSON()`, or an unsafe own key). */
function canonicalizeObject(value: object, seen: ReadonlySet<object>): string | undefined {
  // `Object.getPrototypeOf`'s lib type is `any` -- annotated explicitly so that
  // doesn't silently propagate.
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto !== null && proto !== Object.prototype) {
    const withToJSON = value as { toJSON?: unknown }
    if (typeof withToJSON.toJSON === "function") {
      return canonicalizeInner((withToJSON.toJSON as () => unknown).call(value), seen)
    }
    return undefined
  }

  // Plain object (proto is Object.prototype, or null via Object.create(null)).
  const keys = Object.keys(value)
  for (const key of keys) {
    if (UNSAFE_KEYS.has(key)) return undefined
  }
  const nextSeen = new Set(seen)
  nextSeen.add(value)
  let payload = ""
  // Sorted for property-order independence.
  for (const key of [...keys].sort()) {
    const encodedValue = canonicalizeInner((value as Record<string, unknown>)[key], nextSeen)
    if (encodedValue === undefined) return undefined
    payload += atom("k", key) + encodedValue
  }
  return atom("o", payload)
}

function canonicalizeInner(value: unknown, seen: ReadonlySet<object>): string | undefined {
  const type = typeof value
  // `typeof value` in the condition (not the `type` copy) so `value` narrows to
  // `object` below.
  if (typeof value !== "object" || value === null) return canonicalizeScalar(value, type)

  const builtin = canonicalizeBuiltin(value)
  if (builtin !== NOT_A_BUILTIN) return builtin

  if (seen.has(value)) return undefined // cyclic reference -- non-canonicalizable

  if (Array.isArray(value)) {
    const nextSeen = new Set(seen)
    nextSeen.add(value)
    let payload = ""
    for (const item of value) {
      const encoded = canonicalizeInner(item, nextSeen)
      if (encoded === undefined) return undefined
      payload += encoded
    }
    return atom("a", payload)
  }

  return canonicalizeObject(value, seen)
}

/**
 * Canonicalizes `value` into a deterministic string, or `undefined` if it
 * cannot be safely canonicalized (a function, a symbol, a cyclic reference,
 * an invalid `Date`, a class instance without `.toJSON()`, or any object
 * carrying `__proto__`/`constructor`/`prototype` as an own key). Never
 * throws. Equal inputs always produce equal output; distinct supported
 * values never collide (own-enumerable-key walk only, `Object.keys` --
 * never `for...in`).
 */
export function canonicalize(value: unknown): string | undefined {
  return canonicalizeInner(value, new Set())
}
