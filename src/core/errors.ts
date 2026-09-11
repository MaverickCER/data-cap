/**
 * Throw-based error hierarchy with a stable `code` discriminant, preferred
 * over `instanceof` for programmatic handling across bundling boundaries
 * (mirrors env-cap's own `EnvValidationError`/`EnvNotReadyError` convention).
 *
 * Invariant: no error here ever embeds a raw or processed field value in its
 * message -- only field paths (key names), which are never sensitive.
 */

export abstract class DataCapError extends Error {
  /** Stable, programmatic discriminant -- prefer this over `instanceof` across bundling boundaries. */
  abstract readonly code: string
}

/**
 * Thrown synchronously by `buildData()`/`documentData()` when a declared
 * field default is structurally invalid: a function value (functions are
 * never valid field data) or a cyclic reference (a value that contains
 * itself, directly or transitively).
 */
export class InvalidFieldDefaultError extends DataCapError {
  readonly code = "DATA_CAP_INVALID_FIELD_DEFAULT"
  /** Path (key names only, never values) to the invalid default. */
  readonly path: readonly string[]

  constructor(path: readonly string[], reason: string) {
    super(`Invalid field default at "${path.join(".")}" -- ${reason}`)
    this.name = "InvalidFieldDefaultError"
    this.path = path
  }
}
