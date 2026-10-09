/**
 * Field default helpers.
 *
 * `fields.nullable`/`fields.optional` are thin markers recognized only during
 * `buildData`'s schema-authoring walk (see build.ts) -- they never leak
 * into the resolved `fields` object. The runtime default they produce is
 * always `null`/`undefined` respectively, regardless of what `inner` holds;
 * `inner` exists purely so the underlying type can be inferred (see
 * `InferFieldValue` in types.ts).
 *
 * `FIELD_MARKER`/`isFieldMarker` are internal plumbing, not part of the
 * public field-access API -- data-cap's field system never requires a symbol
 * to read a field's value, only to recognize these two authoring-time
 * helpers while building the initial defaults tree.
 *
 * `Symbol.for(...)` (the global symbol registry), not a bare `Symbol(...)`,
 * is load-bearing here -- `core` and `runtime` are separate tsup entries,
 * each independently bundled, so a bare `Symbol()` would create a genuinely
 * different symbol identity in each bundle's own inlined copy of this
 * module. The runtime's `createData` (runtime/capability.ts) calls core's
 * `resolveOperationPatch` against a schema built with core's own
 * `fields.nullable`/`fields.optional` -- both bundles must recognize the
 * *same* marker identity for that ownership walk to work at all, even
 * though no ESM/CJS dual-package resolution is involved (contrast with
 * ADR 0041's `defaultCoordinator` case, which tolerates duplication via
 * graceful degradation -- a duplicated `FIELD_MARKER` doesn't degrade
 * gracefully, it silently misclassifies every marker as a plain object and
 * corrupts ownership resolution, so the global registry is required here,
 * not merely convenient).
 */

// `Symbol.for` registers the marker globally, so two copies of this module (a duplicated install) still
// recognize each other's markers. The key is read through a function so it can be checked directly.
/** @internal Exported for direct unit coverage. */
export function fieldMarkerKey(): string {
  return "data-cap.field-marker"
}

export const FIELD_MARKER: unique symbol = Symbol.for(fieldMarkerKey())

/** Produced by `fields.nullable(...)` -- recognized only during `buildData`'s schema-authoring walk; the resolved runtime default is always `null`. */
export interface NullableMarker<T> {
  /** Internal marker discriminant -- see the module doc comment. */
  readonly [FIELD_MARKER]: "nullable"
  /** The declared inner default, kept only so the underlying type can be inferred -- never the resolved runtime value. */
  readonly inner: T
}

/** Produced by `fields.optional(...)` -- recognized only during `buildData`'s schema-authoring walk; the resolved runtime default is always `undefined`. */
export interface OptionalMarker<T> {
  /** Internal marker discriminant -- see the module doc comment. */
  readonly [FIELD_MARKER]: "optional"
  /** The declared inner default, kept only so the underlying type can be inferred -- never the resolved runtime value. */
  readonly inner: T
}

export type FieldMarker<T = unknown> = NullableMarker<T> | OptionalMarker<T>

export function isFieldMarker(value: unknown): value is FieldMarker {
  if (typeof value !== "object" || value === null || !(FIELD_MARKER in value)) {
    return false
  }
  const kind = value[FIELD_MARKER]
  return kind === "nullable" || kind === "optional"
}

/** Field-default authoring helpers, recognized only inside a `buildData`/`createData` schema. */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- a namespace of static helpers: as methods they are ordinary function bodies, whereas an object literal would be built once at module load, where a change to it cannot be attributed to any test
export class fields {
  /** Infers the underlying type from `defaultInner`; the runtime default is always `null`. */
  static nullable<T>(defaultInner: T): NullableMarker<T> {
    return { [FIELD_MARKER]: "nullable", inner: defaultInner }
  }

  /** Infers the underlying type from `defaultInner`; the runtime default is always `undefined`. */
  static optional<T>(defaultInner: T): OptionalMarker<T> {
    return { [FIELD_MARKER]: "optional", inner: defaultInner }
  }
}
