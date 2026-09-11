import type { EvidenceModel } from "../build/evidence-model.js"

/**
 * A pure function from the full Evidence Model to one field of a
 * projection's output shape. Must not mutate `evidence` -- the membrane
 * `defineEvidenceProjection()` wraps it in enforces that at runtime, see
 * `createTrackingProxy()` below -- and must not perform I/O; `data-cap` can
 * enforce the read-only half of purity but not the "no side effects" half.
 */
export type EvidenceProjector<T> = (evidence: EvidenceModel) => T

/** One independent, pure projector function per key of the projection's output shape `T`. */
export type EvidenceProjectionSchema<T extends Record<string, unknown>> = {
  readonly [K in keyof T]: EvidenceProjector<T[K]>
}

/** `project()`'s return shape: the computed output, plus which `EvidenceModel` field paths fed each output key. */
export interface EvidenceProjectionResult<T extends Record<string, unknown>> {
  /** The projection's own output -- exactly what calling the projection directly returns. */
  readonly value: T
  /** Per output key, every dotted `EvidenceModel` path that key's own projector actually read, sorted. */
  readonly sources: Readonly<Record<keyof T, readonly string[]>>
}

/**
 * The function `defineEvidenceProjection()` returns. Callable directly for
 * the common case (`projection(evidence)` -> `T`); `.project()` returns the
 * same value alongside automatic, per-field provenance.
 */
export interface EvidenceProjection<T extends Record<string, unknown>> {
  (evidence: EvidenceModel): T
  /**
   * Declared as a property holding a function, not as a method: what's
   * actually attached is a closure (`Object.assign(invoke, {project})`) that
   * never reads `this`, so a consumer is free to destructure or pass it
   * around. A method signature would claim otherwise and make every such
   * use look like an unbound-method bug.
   */
  readonly project: (evidence: EvidenceModel) => EvidenceProjectionResult<T>
}

/**
 * Declares a projection: a pure transform from the `EvidenceModel` to any
 * consumer-defined output shape, built entirely from `schema`'s independent
 * per-field projector functions.
 *
 * `data-cap`'s own reference projections (`reference-projections.ts`'s
 * Classification/Privacy/Retention/Compliance/Audit Evidence) are built
 * through this exact function, with no privileged internal path -- a
 * consumer's own projection is a first-class citizen, not a lesser one.
 *
 * @remarks
 * A per-field schema, rather than one monolithic `(evidence) => T` function,
 * is what makes automatic provenance possible at all: each projector runs
 * against its own read-tracking membrane, so `.project()` can say which
 * evidence a *specific output field* was derived from, not merely which
 * evidence the whole report touched. That is the difference between "this
 * report read the Capability Model" and "this row's `sensitivity` came from
 * `capability.capabilities.0.docs.sensitivity`" -- the second is reviewable
 * evidence, the first is trivia.
 *
 * Superseded ADR 0050's earlier `(name, project)` signature, whose `name`
 * existed only to label a thrown error. That named-wrapper design predates
 * this mechanism and bought strictly less: the membrane below both enforces
 * the purity the old wrapper only documented, and produces provenance the
 * old wrapper had no way to compute.
 */
export function defineEvidenceProjection<T extends Record<string, unknown>>(
  schema: EvidenceProjectionSchema<T>,
): EvidenceProjection<T> {
  function project(evidence: EvidenceModel): EvidenceProjectionResult<T> {
    const value = {} as Record<string, unknown>
    const sources = {} as Record<string, readonly string[]>
    for (const key of Object.keys(schema)) {
      const projector = schema[key as keyof T]
      const { proxy, readPaths } = createTrackingProxy(evidence)
      value[key] = projector(proxy)
      sources[key] = readPaths()
    }
    return { value: value as T, sources: sources as Readonly<Record<keyof T, readonly string[]>> }
  }

  function invoke(evidence: EvidenceModel): T {
    return project(evidence).value
  }

  return Object.assign(invoke, { project })
}

/**
 * The one `TypeError` every read-only-membrane trap throws. A function (not a
 * module-scope string constant) so the message literal is ordinary,
 * per-test-attributable code rather than a module-load value. Exported so a test
 * can pin the exact message -- a bare proxy-invariant `TypeError` is not enough.
 */
export function readOnlyMembraneError(): TypeError {
  return new TypeError(
    "EvidenceModel is read-only inside a projector -- a projection must be a pure function of its evidence argument.",
  )
}

/** @internal Read-tracking state threaded through {@link wrapForTracking}. Exported only for that function's own unit tests. */
export interface TrackingContext {
  /** Every dotted path read through the membrane so far. */
  readonly paths: Set<string>
  /** Underlying node -> its membrane proxy, so the same node reads back as the same wrapper. */
  readonly wrapped: WeakMap<object, unknown>
}

/**
 * @internal Wraps `value` in the read-only, read-recording membrane (returning
 * primitives and already-wrapped nodes as-is).
 *
 * Module-level and exported -- not a closure inside {@link createTrackingProxy}
 * -- specifically so its primitive short-circuit and wrapper cache are covered
 * by direct unit tests. Reached in production only through the `Proxy` `get`
 * trap's own recursion, which per-test mutation coverage cannot see into. Not
 * re-exported from any package barrel.
 */
export function wrapForTracking<V>(value: V, path: readonly string[], ctx: TrackingContext): V {
  if (value === null || typeof value !== "object") return value
  const target: object = value
  const cached = ctx.wrapped.get(target)
  if (cached !== undefined) return cached as V

  const proxy = new Proxy(target, {
    get(currentTarget, prop, receiver) {
      const result: unknown = Reflect.get(currentTarget, prop, receiver)
      if (typeof prop !== "string") return result
      // An array's own `length` is a structural fact about the container,
      // never a piece of evidence a reviewer would want cited -- recording
      // it would bury the real reads under one noise entry per array touched.
      if (Array.isArray(currentTarget) && prop === "length") return result
      const nextPath = [...path, prop]
      ctx.paths.add(nextPath.join("."))
      return wrapForTracking(result, nextPath, ctx)
    },
    set() {
      throw readOnlyMembraneError()
    },
    deleteProperty() {
      throw readOnlyMembraneError()
    },
    defineProperty() {
      throw readOnlyMembraneError()
    },
    setPrototypeOf() {
      throw readOnlyMembraneError()
    },
  })
  ctx.wrapped.set(target, proxy)
  return proxy as V
}

/**
 * Wraps a fresh, unfrozen clone of `evidence` in a Proxy membrane that throws
 * on any write and records every field path read through it.
 *
 * @remarks
 * Deliberately does not rely on `Object.freeze()` for the read-only guarantee: a
 * `Proxy` `get` trap on a frozen, non-configurable data property is
 * spec-required to return the exact (`===`) value the target holds, which makes
 * it impossible to substitute a wrapping proxy for a frozen object's nested
 * properties. The membrane's own `set`/`deleteProperty`/`defineProperty`/
 * `setPrototypeOf` traps enforce immutability instead, which works on an
 * unfrozen target. The caller's own `evidence` is never mutated --
 * `structuredClone()` gives this membrane a disposable copy to wrap, so an
 * already-frozen `EvidenceModel` (or one shared across several projections) can
 * still be projected.
 *
 * `structuredClone()` also means a projector can only ever observe plain,
 * JSON-shaped data -- which every canonical model already is, by construction,
 * since all of them are published as JSON.
 */
function createTrackingProxy(evidence: EvidenceModel): {
  proxy: EvidenceModel
  readPaths: () => readonly string[]
} {
  const ctx: TrackingContext = { paths: new Set<string>(), wrapped: new WeakMap<object, unknown>() }
  const proxy = wrapForTracking(structuredClone(evidence), [], ctx)
  return { proxy, readPaths: () => [...ctx.paths].sort() }
}
