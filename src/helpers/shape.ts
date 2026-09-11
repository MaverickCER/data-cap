/**
 * Structural type guards for narrowing an unknown raw value inside a
 * getter/mutator/subscription `processor(raw, ctx)` function.
 *
 * Deliberately not a business-rule validator system (no `shape.email()`,
 * no `shape.range()`) -- data-cap has no per-field validator vocabulary
 * (unlike env-cap's `helpers.validators`); a processor's own logic is the
 * sole place business rules belong. These check only structural JS shape --
 * "is this a plain object" vs. "is this an array" vs. "is this a Date" --
 * the same category of check `core/schema.ts` already performs internally,
 * exposed here for application code writing its own processors.
 *
 * ## Why there is no `helpers.validators` here (a design choice, not a gap)
 *
 * The absence of a validator-combinator library is structural, not an
 * unfinished feature. The two packages fail differently, so they need
 * different vocabularies:
 *
 * - `env-cap` validates on a **reject-and-throw** pipeline: a variable that
 *   fails its declared validator is an invalid environment, and
 *   `createEnv()` refuses to produce a contract at all. A validator there
 *   must therefore carry a human-readable *message* explaining what was
 *   rejected and why -- which is exactly what a combinator library like
 *   `helpers.validators` exists to compose.
 * - `data-cap` has no reject path to write a message for. Fields are
 *   always synchronously readable (AGENTS.md invariant 2), so a
 *   processor/operation result that doesn't match a field's declared shape
 *   **resets that field to its declared default** via `core/schema.ts`'s
 *   `checkValueAgainstSchema` -- the state stays valid and readable, and
 *   the mismatch surfaces through `DataInfo`, never as a thrown validator
 *   error. A `validators.email()` here would have nowhere to put its
 *   message and no failure mode to attach it to; it would only re-describe
 *   the structural check `checkValueAgainstSchema` already performs.
 *
 * A field's own runtime type is its shape descriptor, and a `processor` is
 * the single escape hatch for anything beyond that (AGENTS.md's "Avoid"
 * list). Adding a validator vocabulary would introduce a second, parallel
 * notion of "valid" that nothing in the runtime could enforce.
 */

/**
 * True for a plain object literal (or `Object.create(null)`) -- false for
 * `null`, arrays, and any class instance (including `Date`/`URL`/`RegExp`),
 * matching the same "plain object" notion `core/canonicalize.ts` uses
 * internally.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

export function isDate(value: unknown): value is Date {
  return value instanceof Date
}

export function isURL(value: unknown): value is URL {
  return value instanceof URL
}

export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp
}

export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined
}
