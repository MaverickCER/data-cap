/**
 * Runtime error hierarchy for operation-execution misuse, extending
 * `core/errors.ts`'s `DataCapError`/stable-`code` convention into
 * `runtime/`. Not a port of env-cap's batch-validate `EnvValidationError`/
 * `EnvNotReadyError` pair -- data-cap's failure model is per-operation
 * (see `DataError` in `core/types.ts`), not a validate-once gate, so there
 * is no equivalent "not ready yet" error here (ADR 0004: fields are always
 * synchronously readable).
 */

import { DataCapError } from "../core/errors.js"

/**
 * Thrown by `createData`'s `runGetters` when asked to run a getter name
 * that was never declared on the schema -- a caller/typo bug, not a data
 * failure (a genuine getter failure surfaces as a per-operation
 * `{status: "error"}` outcome instead, never a thrown rejection here).
 */
export class UnknownGetterError extends DataCapError {
  readonly code = "DATA_CAP_UNKNOWN_GETTER"
  /** The undeclared getter name that was requested. */
  readonly getterName: string

  constructor(getterName: string) {
    super(`runGetters: no getter named "${getterName}" is declared`)
    this.name = "UnknownGetterError"
    this.getterName = getterName
  }
}
