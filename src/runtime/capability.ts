/**
 * The batteries-included, optional, Experimental-tier operations layer.
 * `createData(schema)` composes `buildData` + `createDataStore` + a
 * `Coordinator` -- nothing here is a new primitive; it's an orchestration
 * layer over the existing Stable ones. Applications that want full manual
 * control keep using `buildData`/`createDataStore`/`coordinator` directly
 * (see `test/integration/runtime-core/basic-standalone/`); this module is for applications that
 * want the getter/mutator/subscription execution loop, dedup, optimistic
 * lifecycle, and per-operation status handled for them.
 *
 * See specs/decisions/0048-builddata-createdata-split-and-optional-operations-layer.md
 * for the full rationale, including why this ships as a new module rather
 * than folded into `buildData` itself (core must stay synchronous/
 * stateless -- nothing here is pure).
 */

import { buildData } from "../core/build.js"
import { canonicalize } from "../core/canonicalize.js"
import { resolveOperationPatch } from "../core/ownership.js"
import { patchInto } from "../core/patch.js"
import type {
  DataError,
  DataSchema,
  DataState,
  DataStatus,
  DeepPartial,
  FieldOwnership,
  FieldsShape,
  InferFields,
  OwnedPatch,
  SubscriptionInfo,
} from "../core/types.js"
import { composeSignals } from "./abort.js"
import { defaultCoordinator } from "./coordinator.js"
import type { Coordinator, SubscribeFn, SubscriptionHandlers } from "./coordinator.js"
import { UnknownGetterError } from "./errors.js"
import { createDataStore } from "./store.js"

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** Options for {@link createData}. */
export interface CreateDataOptions {
  /** Overrides `defaultCoordinator` -- an explicit, isolated coordination domain (ADR 0027), e.g. per-tenant on a server. */
  readonly coordinator?: Coordinator
  /**
   * Bounds how many distinct canonicalized-params entries are retained per
   * operation in the reactive `operations` snapshot (an LRU cap -- an
   * operation called with many different params over a session, e.g.
   * search-as-you-type, would otherwise grow this unboundedly). Defaults to
   * 50.
   */
  readonly maxOperationHistory?: number
}

/** One operation's current execution state, keyed by canonicalized params in `operations`. Distinct from `info.<field>` -- see the module doc comment. */
export interface OperationState {
  /** This call's current lifecycle status. */
  readonly status?: DataStatus
  /** The error this call settled with, if it failed. */
  readonly error?: DataError
  /** When this call started, as epoch ms. */
  readonly startedAt?: number
  /** When this call settled (success or error), as epoch ms. */
  readonly settledAt?: number
  /** True while a mutator's optimistic transition for this call is still pending. */
  readonly optimistic?: boolean
  /** Populated only for subscription operations. */
  readonly subscription?: SubscriptionInfo
}

/** Every operation's current `OperationState`, keyed by operation name then canonicalized params. */
export type OperationsSnapshot = Readonly<Record<string, Readonly<Record<string, OperationState>>>>

/** A strict superset of `DataState<TFields>` -- every existing `DataStore` consumer (`useSyncExternalStore`, etc.) still works unchanged reading `.fields`/`.info` off it. */
export interface DataCapabilitySnapshot<TFields> extends DataState<TFields> {
  /** Every operation's current execution state -- see `OperationsSnapshot`. */
  readonly operations: OperationsSnapshot
}

/** The settled result of one `runGetters` call: either the resolved patch, or the error it failed with. */
export type OperationOutcome<T> =
  | {
      /** Always `"success"` for this variant. */
      readonly status: "success"
      /** The resolved, ownership-narrowed patch. */
      readonly value: T
    }
  | {
      /** Always `"error"` for this variant. */
      readonly status: "error"
      /** The error the call rejected with. */
      readonly error: DataError
    }

/** Static, per-operation metadata -- one entry within a `CapabilityDescriptor`. */
export interface OperationDescriptor {
  /** Which kind of operation this is. */
  readonly kind: "getter" | "mutator" | "subscription"
  /** The operation's declared `writes` ownership shape (`true` means the whole capability). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural metadata over a heterogeneous, per-operation ownership shape
  readonly writes: FieldOwnership<any> | true | undefined
  /** Whether this operation declares a `processor`. */
  readonly hasProcessor: boolean
  /** Only meaningful for mutators. */
  readonly hasOptimistic: boolean
}

/** Static, non-reactive operation metadata -- returned by `.describe()`, distinct from the live `operations` snapshot key. See requirement O (build tooling/ESLint/devtools discoverability). */
export interface CapabilityDescriptor {
  /** Every declared getter, by name. */
  readonly getters: Readonly<Record<string, OperationDescriptor>>
  /** Every declared mutator, by name. */
  readonly mutators: Readonly<Record<string, OperationDescriptor>>
  /** Every declared subscription, by name. */
  readonly subscriptions: Readonly<Record<string, OperationDescriptor>>
}

/**
 * Normalizes one schema section (`TSchema["getters"]`/`"mutators"`/
 * `"subscriptions"`, always possibly `undefined` when a schema declares
 * none) to a concrete, possibly-empty record type -- never about value-level
 * nullability. `keyof Record<string, never>` is `string`, but no real value
 * is ever assignable to `never`, so a schema with no getters at all still
 * produces zero `CapabilityGetterMethods` keys, not a type error.
 */
type OperationSection<T> = T extends undefined ? Record<string, never> : T

/*
 * Structural property extraction (`TDef extends {params?: infer P} ? P :
 * never`) rather than matching a whole operation definition against the
 * full `GetterDefinition<...>`/`MutatorDefinition<...>`/
 * `SubscriptionDefinition<...>` generic interface. Matching the full
 * interface is fragile here: `createData`'s own generic inference widens
 * an individual operation definition while checking it against
 * `DataSchema`'s `Record<string, GetterDefinition<TFields, any, any,
 * any>>`-shaped bound, which can defeat a conditional type keyed on that
 * same interface. Extracting one declared property at a time is resilient
 * to that widening and needs only the shape actually used below.
 */
type DeclaredParams<TDef> = TDef extends { readonly params?: infer P } ? P : never
type DeclaredWrites<TDef> = TDef extends { readonly writes: infer W }
  ? W
  : TDef extends { readonly writes?: infer W }
    ? W extends undefined
      ? true
      : W
    : true

type CapabilityGetterMethods<TFields, TGetters> = {
  [K in keyof OperationSection<TGetters>]: (
    params?: DeepPartial<DeclaredParams<OperationSection<TGetters>[K]>>,
    signal?: AbortSignal,
  ) => Promise<OwnedPatch<TFields, DeclaredWrites<OperationSection<TGetters>[K]>>>
}

type CapabilityMutatorMethods<TFields, TMutators> = {
  [K in keyof OperationSection<TMutators>]: (
    params?: DeepPartial<DeclaredParams<OperationSection<TMutators>[K]>>,
    signal?: AbortSignal,
  ) => Promise<OwnedPatch<TFields, DeclaredWrites<OperationSection<TMutators>[K]>>>
}

type CapabilitySubscriptionMethods<TSubscriptions> = {
  [K in keyof OperationSection<TSubscriptions>]: (
    params?: DeepPartial<DeclaredParams<OperationSection<TSubscriptions>[K]>>,
  ) => () => void
}

type RunGettersResult<TFields, TGetters> = Partial<{
  [K in keyof OperationSection<TGetters>]: OperationOutcome<
    OwnedPatch<TFields, DeclaredWrites<OperationSection<TGetters>[K]>>
  >
}>

type RunGettersCalls<TGetters> = Partial<{
  [K in keyof OperationSection<TGetters>]: DeepPartial<
    DeclaredParams<OperationSection<TGetters>[K]>
  >
}>

/** Options for `runGetters`. */
export interface RunGettersOptions {
  /** Aborts every getter this call started that hasn't already settled. */
  readonly signal?: AbortSignal
}

interface CapabilityBase<TFields, TGetters> {
  runGetters(
    calls: RunGettersCalls<TGetters>,
    options?: RunGettersOptions,
  ): Promise<RunGettersResult<TFields, TGetters>>
  getSnapshot(): DataCapabilitySnapshot<TFields>
  getAuthoritativeState(): DataState<TFields>
  subscribe(listener: () => void): () => void
  describe(): CapabilityDescriptor
}

/** The object `createData(schema)` returns: one callable method per getter/mutator/subscription, plus `getSnapshot`/`getAuthoritativeState`/`subscribe`/`describe`/`runGetters`. */
export type DataCapability<TSchema extends DataSchema<FieldsShape>> = CapabilityGetterMethods<
  InferFields<TSchema["fields"]>,
  TSchema["getters"]
> &
  CapabilityMutatorMethods<InferFields<TSchema["fields"]>, TSchema["mutators"]> &
  CapabilitySubscriptionMethods<TSchema["subscriptions"]> &
  CapabilityBase<InferFields<TSchema["fields"]>, TSchema["getters"]>

/* -------------------------------------------------------------------------- */
/* Internal, loosely-typed working shapes                                    */
/* -------------------------------------------------------------------------- */
/*
 * Generics are erased at runtime; the exported `createData` signature above
 * is the compile-time contract application code sees. Internally, operation
 * definitions are handled through a single, loosely-typed shape so the
 * getter/mutator/subscription execution logic below isn't duplicated three
 * times for three incompatible generic instantiations.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOwnership = FieldOwnership<any> | true

interface AnyGetterDef {
  readonly params?: unknown
  readonly execute: (params: unknown, signal: AbortSignal) => Promise<unknown>
  readonly processor?: (raw: unknown, params: unknown) => unknown
  readonly writes: AnyOwnership
}

interface AnyMutatorDef {
  readonly params?: unknown
  readonly execute: (params: unknown, signal: AbortSignal) => Promise<unknown>
  readonly processor?: (raw: unknown, params: unknown) => unknown
  readonly writes?: AnyOwnership
  readonly optimistic?: (authoritativeState: DataState<unknown>, params: unknown) => unknown
}

interface AnySubscriptionDef {
  readonly params?: unknown
  readonly subscribe: (params: unknown, handlers: SubscriptionHandlers<unknown>) => () => void
  readonly processor?: (event: unknown, params: unknown) => unknown
  readonly writes: AnyOwnership
}

function identityProcessor(raw: unknown): unknown {
  return raw
}

/** @internal True in every environment except an explicit production `NODE_ENV` -- isomorphic-safe (no bare `process` reference in an environment that lacks it). Exported for direct unit coverage. */
export function isDevMode(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return proc?.env?.["NODE_ENV"] !== "production"
}

/** @internal Exported for direct unit coverage. */
export function warnFieldErrors(fieldErrors: ReadonlyMap<string, DataError>): void {
  if (!isDevMode()) return // the loop below is itself a no-op for an empty map
  for (const dataError of fieldErrors.values()) {
    // When `error` is the `Error` ownership.ts's own `fieldError()` always
    // constructs, `.message` already encodes {operation, path, reason} --
    // never the offending value itself -- exactly the shape ADR 0005
    // requires. Falls back to a plain string conversion for the (currently
    // unreachable, but not type-guaranteed) case of a non-Error value.
    const { error } = dataError
    console.warn(error instanceof Error ? error.message : String(error))
  }
}

/** @internal Builds an info patch mirroring `ownership`'s shape, placing `fieldInfo` at every `true` leaf -- e.g. `{user: {email: true}}` + a FieldInfo produces `{user: {email: <FieldInfo>}}`, never at `user` itself. Exported for direct unit coverage. */
export function buildInfoPatch(
  ownership: AnyOwnership | undefined,
  fieldInfo: Record<string, unknown>,
): unknown {
  if (ownership === undefined) return undefined
  if (ownership === true) return fieldInfo
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(ownership)) {
    const child = buildInfoPatch((ownership as Record<string, AnyOwnership>)[key], fieldInfo)
    if (child !== undefined) result[key] = child
  }
  return result
}

/** @internal Exported for direct unit coverage. */
export function mergeParams(defaultParams: unknown, partial: unknown): unknown {
  // `patchInto` already handles both degenerate cases: an `undefined` patch
  // returns `prev` verbatim, and an `undefined`/primitive `prev` is replaced
  // outright by the patch -- so no separate short-circuits are needed here.
  return patchInto(defaultParams, partial as never)
}

/* -------------------------------------------------------------------------- */
/* createData                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Declares a capability's field contract AND, optionally, the getters/
 * mutators/subscriptions that acquire, mutate, and continuously observe it
 * -- the batteries-included counterpart to `buildData` + hand-wired
 * `createDataStore`/`coordinator` calls. Internally: exactly one
 * `buildData` call, exactly one `createDataStore` instance, and the given
 * (or default) `Coordinator` -- see the module doc comment.
 *
 * A schema with no `getters`/`mutators`/`subscriptions` at all still works,
 * returning a fully valid capability with zero bound operation methods --
 * the direct one-call equivalent of `createDataStore(buildData({fields}))`.
 *
 * @remarks
 * Experimental (see VERSIONING.md) -- the shape of this function may still
 * change in a minor pre-1.0 release as real usage reveals a better one.
 */
export function createData<TSchema extends DataSchema<FieldsShape>>(
  schema: TSchema,
  options: CreateDataOptions = {},
): DataCapability<TSchema> {
  const coordinator = options.coordinator ?? defaultCoordinator
  const maxOperationHistory = options.maxOperationHistory ?? 50

  const initialState = buildData({ fields: schema.fields })
  const store = createDataStore(initialState)

  const getterDefs = (schema.getters ?? {}) as Record<string, AnyGetterDef>
  const mutatorDefs = (schema.mutators ?? {}) as Record<string, AnyMutatorDef>
  const subscriptionDefs = (schema.subscriptions ?? {}) as Record<string, AnySubscriptionDef>

  /* ---- per-operation reactive state: additive, never a duplicate of fields/info ---- */
  const operationsWorking = new Map<string, Map<string, OperationState>>()
  // Starts clean: the initial snapshot cache below (`{}`) is already correct
  // for a capability with zero recorded operation calls. Any real
  // `setOperationState` flips this true. Its initial value is unobservable
  // (the pre-first-call snapshot is `{}` either way).
  // Stryker disable next-line BooleanLiteral
  let operationsDirty = false
  let operationsSnapshotCache: OperationsSnapshot = {}
  const capabilityListeners = new Set<() => void>()
  // The last-returned capability snapshot plus the two inputs it was built
  // from. `store.getSnapshot()` is itself a stable ref while `fields`+`info`
  // are unchanged, so comparing it directly covers both without a per-field
  // check.
  let snapshotCache:
    | {
        readonly store: DataState<unknown>
        readonly operations: OperationsSnapshot
        readonly snapshot: DataCapabilitySnapshot<unknown>
      }
    | undefined

  function notifyCapabilityListeners(): void {
    for (const listener of capabilityListeners) listener()
  }

  function materializeOperationsSnapshot(): OperationsSnapshot {
    if (!operationsDirty) return operationsSnapshotCache
    const next: Record<string, Record<string, OperationState>> = {}
    for (const [operationName, paramsMap] of operationsWorking) {
      const perParams: Record<string, OperationState> = {}
      for (const [key, state] of paramsMap) {
        perParams[key] = state
      }
      next[operationName] = perParams
    }
    operationsSnapshotCache = next
    operationsDirty = false
    return operationsSnapshotCache
  }

  function setOperationState(
    operationName: string,
    key: string,
    patch: Partial<OperationState>,
  ): void {
    let paramsMap = operationsWorking.get(operationName)
    if (paramsMap === undefined) {
      paramsMap = new Map()
      operationsWorking.set(operationName, paramsMap)
    }
    const previous = paramsMap.get(key)
    const next: OperationState = { ...previous, ...patch }
    // Touch: delete+reinsert moves this key to the most-recently-used end
    // (the same LRU technique runtime/cache.ts's Map already uses).
    paramsMap.delete(key)
    paramsMap.set(key, next)
    // Evict the least-recently-used entries down to the cap. Map iteration is
    // insertion order, so the first key is always the oldest.
    // `steps`, not `paramsMap.size` alone, bounds this loop: a mutation
    // gutting the body (removing `paramsMap.delete`) would otherwise leave
    // `paramsMap.size` unchanged forever, spinning until Stryker's own
    // timeout. `evictionCeiling`, captured once before the loop starts, is
    // already far more than any single call could ever need to trim back
    // to `maxOperationHistory`, and lives in the loop's own clause (not the
    // body) so a body-gutting mutation can't remove it alongside the delete.
    const evictionCeiling = paramsMap.size
    // No real call ever needs more than a couple of eviction passes, well
    // under `evictionCeiling` -- this is a backstop against
    // `paramsMap.delete()` itself breaking, not a boundary any real input
    // approaches. Hand-verified: applying each of these mutations
    // individually and running the real suite passes unchanged.
    // Stryker disable next-line ConditionalExpression, EqualityOperator, UpdateOperator
    for (let steps = 0; paramsMap.size > maxOperationHistory && steps <= evictionCeiling; steps++) {
      const oldest = paramsMap.keys().next()
      // Neutralizing this break is itself behaviorally harmless now, not
      // just slow: `paramsMap.delete(undefined)` on an already-empty map is
      // a no-op, so the loop just spends its remaining `steps` budget
      // achieving nothing before exiting via the steps ceiling above, and
      // the `paramsMap.size > 0` guard below correctly still doesn't throw.
      // Hand-verified: mutating this to `false` and running the real suite
      // passes unchanged. Kept as an early exit purely to avoid those wasted
      // iterations in the normal (non-mutated) case.
      // Stryker disable next-line ConditionalExpression
      if (oldest.done === true) break // map already empty (a non-positive cap)
      paramsMap.delete(oldest.value)
    }
    // `paramsMap.size > 0`, not just `> maxOperationHistory`: a non-positive
    // `maxOperationHistory` (the "nonsensical" case the inner `oldest.done`
    // check exists for) means eviction legitimately bottoms out at an empty
    // map, not at `maxOperationHistory` itself -- `0 > -5` is still true, so
    // checking the cap alone would misfire on every such call. Only
    // reachable, under real (unmutated) code, if eviction somehow never
    // keeps pace with insertion within one call and the map never empties
    // -- no fixture can construct that without itself mutating the delete
    // above, so this can't be exercised by a normal test. Hand-verified:
    // gutting the loop body and running the real suite throws this (fast)
    // instead of hanging, confirming the backstop actually works.
    // Stryker disable ConditionalExpression, BlockStatement, StringLiteral, LogicalOperator, CallExpression
    if (paramsMap.size > maxOperationHistory && paramsMap.size > 0) {
      throw new Error(
        "Operation history eviction loop stopped advancing toward maxOperationHistory.",
      )
    }
    // Stryker restore ConditionalExpression, BlockStatement, StringLiteral, LogicalOperator, CallExpression
    operationsDirty = true
    notifyCapabilityListeners()
  }

  let syntheticKeyCounter = 0
  function computeOperationKey(params: unknown): string {
    const key = canonicalize(params)
    if (key !== undefined) return key
    // Non-canonicalizable params degrade to a per-call synthetic key rather
    // than colliding under one shared bucket -- mirrors coordinator.dedupe's
    // own documented non-canonicalizable-params fallback. The prefix can
    // never collide with a real canonicalize() output, whose atoms always
    // start with a single tag letter immediately followed by a digit.
    return `~uncanonicalizable-${++syntheticKeyCounter}`
  }

  /**
   * The identical per-call setup every getter and mutator runs before its own
   * divergent logic: merge params, derive the operation key, wire an abort
   * controller, publish `loading` operation state, and commit the field-level
   * `loading` info patch (always unconditional -- a freshly-started call is
   * never stale, and this is visible even when no `optimistic` callback exists).
   * `writes` is the operation's own ownership (`def.writes` for a getter;
   * `def.writes ?? true` for a mutator -- ADR 0011).
   */
  function beginOperationCall(
    name: string,
    writes: AnyOwnership,
    paramsDef: unknown,
    partialParams: unknown,
    callerSignal: AbortSignal | undefined,
  ): {
    readonly effectiveParams: unknown
    readonly key: string
    readonly signal: AbortSignal
  } {
    const effectiveParams = mergeParams(paramsDef, partialParams)
    const key = computeOperationKey(effectiveParams)
    // A local controller that is never aborted here -- its only job is to mint a
    // fresh signal that only `callerSignal` (if any) can cancel.
    const controller = new AbortController()
    const signal =
      callerSignal !== undefined
        ? composeSignals([callerSignal, controller.signal])
        : controller.signal

    setOperationState(name, key, { status: "loading", startedAt: Date.now() })
    store.commitAuthoritative(undefined, buildInfoPatch(writes, { status: "loading" }) as never)
    return { effectiveParams, key, signal }
  }

  function getCapabilitySnapshot(): DataCapabilitySnapshot<unknown> {
    const storeSnapshot = store.getSnapshot()
    const operations = materializeOperationsSnapshot()
    if (snapshotCache?.store === storeSnapshot && snapshotCache.operations === operations) {
      return snapshotCache.snapshot
    }
    const snapshot: DataCapabilitySnapshot<unknown> = {
      fields: storeSnapshot.fields,
      info: storeSnapshot.info,
      operations,
    }
    snapshotCache = { store: storeSnapshot, operations, snapshot }
    return snapshot
  }

  /* ---- getters ---- */

  const getterMethods: Record<
    string,
    (params?: unknown, signal?: AbortSignal) => Promise<unknown>
  > = {}

  for (const [name, def] of Object.entries(getterDefs)) {
    // Stable dispatch closure, built ONCE per (capability instance,
    // operation name), never per call -- this, not the raw schema-authored
    // `execute` reference, is what coordinator.dedupe actually keys on, so
    // the dedup domain is inherently (this instance x this operation x
    // canonicalized params), never bare function identity.
    const dispatch = (params: unknown, signal: AbortSignal): Promise<unknown> =>
      def.execute(params, signal)
    // Per-getter-identity start token -- ADR 0024's stale-response discard,
    // scoped to the FIELD-level commit only (never to this call's own
    // per-params `operations` entry, which always reflects its own true
    // outcome regardless of sibling calls). A fresh object per call; only the
    // call holding the latest one is allowed to commit at the field level.
    let latestStart: object = {}

    getterMethods[name] = async (
      partialParams?: unknown,
      callerSignal?: AbortSignal,
    ): Promise<unknown> => {
      const myStart = (latestStart = {})
      const { effectiveParams, key, signal } = beginOperationCall(
        name,
        def.writes,
        def.params,
        partialParams,
        callerSignal,
      )

      try {
        const raw = await coordinator.dedupe(dispatch, effectiveParams, signal)
        const processor = def.processor ?? identityProcessor
        const processed = processor(raw, effectiveParams)
        const { acceptedPatch, fieldErrors } = resolveOperationPatch({
          declaredOwnership: def.writes,
          fieldsSchema: schema.fields,
          processedOutput: processed,
          operator: name,
        })
        warnFieldErrors(fieldErrors)

        if (myStart === latestStart) {
          store.commitAuthoritative(
            acceptedPatch,
            buildInfoPatch(def.writes, { status: "success", source: name }) as never,
          )
        }
        setOperationState(name, key, { status: "success", settledAt: Date.now() })
        return acceptedPatch
      } catch (error) {
        const dataError: DataError = { operator: name, error }
        if (myStart === latestStart) {
          store.commitAuthoritative(
            undefined,
            buildInfoPatch(def.writes, { status: "error", error: dataError }) as never,
          )
        }
        setOperationState(name, key, { status: "error", error: dataError, settledAt: Date.now() })
        throw error
      }
    }
  }

  /* ---- mutators ---- */

  const mutatorMethods: Record<
    string,
    (params?: unknown, signal?: AbortSignal) => Promise<unknown>
  > = {}

  for (const [name, def] of Object.entries(mutatorDefs)) {
    const dispatch = (params: unknown, signal: AbortSignal): Promise<unknown> =>
      def.execute(params, signal)
    const effectiveWrites: AnyOwnership = def.writes ?? true

    mutatorMethods[name] = async (
      partialParams?: unknown,
      callerSignal?: AbortSignal,
    ): Promise<unknown> => {
      const { effectiveParams, key, signal } = beginOperationCall(
        name,
        effectiveWrites,
        def.params,
        partialParams,
        callerSignal,
      )

      let transitionId: symbol | undefined
      if (def.optimistic !== undefined) {
        // Authoritative state ONLY, never the visible/projected state -- a
        // second concurrent optimistic transition must never compute
        // against a first transition's still-pending, unconfirmed value.
        const optimisticPatch = def.optimistic(store.getAuthoritativeState(), effectiveParams)
        if (optimisticPatch !== undefined) {
          transitionId = store.addPendingTransition(
            optimisticPatch as never,
            buildInfoPatch(effectiveWrites, { status: "loading", optimistic: true }) as never,
          )
        }
      }

      try {
        const raw = await coordinator.dedupe(dispatch, effectiveParams, signal)
        const processor = def.processor ?? identityProcessor
        const processed = processor(raw, effectiveParams)
        const { acceptedPatch, fieldErrors } = resolveOperationPatch({
          declaredOwnership: effectiveWrites,
          fieldsSchema: schema.fields,
          processedOutput: processed,
          operator: name,
        })
        warnFieldErrors(fieldErrors)

        // Mutators never discard by start sequence (ADR 0025, deliberately
        // unlike getters) -- whichever commit runs last, in real time,
        // wins, regardless of start order.
        store.commitAuthoritative(
          acceptedPatch,
          buildInfoPatch(effectiveWrites, {
            status: "success",
            optimistic: false,
            source: name,
          }) as never,
        )
        setOperationState(name, key, { status: "success", settledAt: Date.now() })
        return acceptedPatch
      } catch (error) {
        const dataError: DataError = { operator: name, error }
        store.commitAuthoritative(
          undefined,
          buildInfoPatch(effectiveWrites, {
            status: "error",
            optimistic: false,
            error: dataError,
          }) as never,
        )
        setOperationState(name, key, { status: "error", error: dataError, settledAt: Date.now() })
        throw error
      } finally {
        // No rollback code path -- removing the pending transition is the
        // entire mechanism (ADR 0023); the visible value reverts on its own
        // because project() no longer folds a transition that no longer
        // exists. The `!== undefined` guard is a pure micro-optimization:
        // `store.removePendingTransition(undefined)` is itself a no-op (no id
        // ever equals `undefined`), so dropping the guard changes nothing.
        // Stryker disable next-line ConditionalExpression
        if (transitionId !== undefined) store.removePendingTransition(transitionId)
      }
    }
  }

  /* ---- subscriptions ---- */

  const subscriptionMethods: Record<string, (params?: unknown) => () => void> = {}

  for (const [name, def] of Object.entries(subscriptionDefs)) {
    // Memoized per canonicalized params -- two calls with the same params
    // reuse the same closure reference (shares a transport via
    // acquireSubscription's own identity-based mechanism); different params
    // get different closures (independent transports). Never changes
    // coordinator.ts itself.
    const subscribeClosures = new Map<string, SubscribeFn<unknown>>()

    subscriptionMethods[name] = (partialParams?: unknown): (() => void) => {
      const effectiveParams = mergeParams(def.params, partialParams)
      const key = computeOperationKey(effectiveParams)

      let subscribeFn = subscribeClosures.get(key)
      if (subscribeFn === undefined) {
        subscribeFn = (handlers: SubscriptionHandlers<unknown>) =>
          def.subscribe(effectiveParams, handlers)
        subscribeClosures.set(key, subscribeFn)
      }

      function commitSubscriptionStatus(subscriptionInfo: SubscriptionInfo): void {
        // Per ADR 0029: a status transition alone never touches `fields`,
        // only `info.<field>.subscription`.
        store.commitAuthoritative(
          undefined,
          buildInfoPatch(def.writes, { subscription: subscriptionInfo }) as never,
        )
        setOperationState(name, key, { subscription: subscriptionInfo })
      }

      const release = coordinator.acquireSubscription(subscribeFn, {
        onEvent: (event) => {
          const processor = def.processor ?? identityProcessor
          const processed = processor(event, effectiveParams)
          const { acceptedPatch, fieldErrors } = resolveOperationPatch({
            declaredOwnership: def.writes,
            fieldsSchema: schema.fields,
            processedOutput: processed,
            operator: name,
          })
          warnFieldErrors(fieldErrors)
          store.commitAuthoritative(
            acceptedPatch,
            buildInfoPatch(def.writes, { status: "success", source: name }) as never,
          )
          setOperationState(name, key, { status: "success", settledAt: Date.now() })
        },
        onStatusChange: (status, detail) => {
          commitSubscriptionStatus(
            detail?.error !== undefined
              ? { status, error: { operator: name, error: detail.error } }
              : { status },
          )
        },
      })

      // `acquireSubscription`'s release removes this consumer from the
      // shared transport's fan-out BEFORE any teardown-triggered
      // onStatusChange("disconnected") fires (so a still-attached sibling
      // consumer, if any, is the one that would normally hear it) -- a
      // capability that releases its own subscription would otherwise never
      // learn its OWN status became "disconnected". This capability's own
      // subscription lifecycle is independent of whether the underlying
      // transport actually tears down (another consumer may still be
      // attached, per ADR 0026) -- from this capability's own perspective,
      // once it releases, it is disconnected, unconditionally.
      return () => {
        release()
        commitSubscriptionStatus({ status: "disconnected" })
      }
    }
  }

  /* ---- runGetters ---- */

  async function runGetters(
    calls: Record<string, unknown>,
    runOptions: RunGettersOptions = {},
  ): Promise<Record<string, OperationOutcome<unknown>>> {
    // One failure must never block or erase another call's success. Each
    // per-getter promise catches its own rejection (an individual getter
    // method still rejects on failure, per normal Promise semantics) and
    // resolves to a `[name, outcome]` pair, so `Promise.all` never rejects
    // and the results stay paired with their names without index bookkeeping.
    const settled = await Promise.all(
      Object.entries(calls).map(
        async ([getterName, params]): Promise<[string, OperationOutcome<unknown>]> => {
          const method = getterMethods[getterName]
          try {
            const value =
              method === undefined
                ? await Promise.reject(new UnknownGetterError(getterName))
                : await method(params, runOptions.signal)
            return [getterName, { status: "success", value }]
          } catch (error) {
            return [getterName, { status: "error", error: { operator: getterName, error } }]
          }
        },
      ),
    )
    return Object.fromEntries(settled)
  }

  /* ---- describe() ---- */

  function describeOperations(
    defs: Record<string, { writes?: AnyOwnership; processor?: unknown; optimistic?: unknown }>,
    kind: OperationDescriptor["kind"],
  ): Record<string, OperationDescriptor> {
    const result: Record<string, OperationDescriptor> = {}
    for (const [name, def] of Object.entries(defs)) {
      result[name] = {
        kind,
        writes: def.writes,
        hasProcessor: def.processor !== undefined,
        // `optimistic` is only ever declared on a mutator; a getter/
        // subscription def simply never carries the key.
        hasOptimistic: def.optimistic !== undefined,
      }
    }
    return result
  }

  function describe(): CapabilityDescriptor {
    return {
      getters: describeOperations(getterDefs, "getter"),
      mutators: describeOperations(mutatorDefs, "mutator"),
      subscriptions: describeOperations(subscriptionDefs, "subscription"),
    }
  }

  /* ---- assemble the returned capability ---- */

  const capability = {
    ...getterMethods,
    ...mutatorMethods,
    ...subscriptionMethods,
    runGetters,
    getSnapshot: getCapabilitySnapshot,
    getAuthoritativeState: () => store.getAuthoritativeState(),
    subscribe: (listener: () => void) => {
      capabilityListeners.add(listener)
      const releaseStore = store.subscribe(listener)
      return () => {
        capabilityListeners.delete(listener)
        releaseStore()
      }
    },
    describe,
  }

  return capability as unknown as DataCapability<TSchema>
}
