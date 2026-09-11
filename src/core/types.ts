/**
 * Core contract types for data-cap.
 *
 * Pure type-only module -- no runtime code (see vitest.config.ts's coverage
 * exclusion for this file). Mirrors env-cap's own `runtime/types.ts`
 * structurally: this file is the vocabulary read by `build.ts`/`document.ts`,
 * plus the getter/mutator/subscription operation types the runtime's
 * `createData` (`@maverickcer/data-cap/runtime`) executes -- `ownership.ts`/
 * `patch.ts` give those real runtime meaning; this module only ever declares
 * their shape. `buildData` itself only ever reads `fields` off a `DataSchema`
 * -- the operation sections exist for `documentData`/the runtime to consume.
 */

import type { NullableMarker, OptionalMarker } from "./fields.js"

/**
 * The generic *bound* only, never surfaced to a consumer's inferred type --
 * the same variance workaround env-cap's `EnvSchema` uses so `TFields extends
 * FieldsShape` still infers a precise, per-key literal type from the actual
 * object literal passed to `buildData`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FieldsShape = Record<string, any>

/**
 * Resolves the application-facing type for one declared field default.
 * Functions are never valid field values -- a function-typed default
 * resolves to `never` (see fields.ts's runtime counterpart, which throws).
 */
export type InferFieldValue<F> =
  F extends NullableMarker<infer Inner>
    ? InferFieldValue<Inner> | null
    : F extends OptionalMarker<infer Inner>
      ? InferFieldValue<Inner> | undefined
      : F extends readonly (infer Item)[]
        ? InferFieldValue<Item>[]
        : F extends Date | URL | RegExp
          ? F
          : F extends (...args: never[]) => unknown
            ? never
            : F extends object
              ? { [K in keyof F]: InferFieldValue<F[K]> }
              : F

/** Resolves the application-facing field-value type for an entire `fields` shape, key by key. */
export type InferFields<F extends FieldsShape> = { [K in keyof F]: InferFieldValue<F[K]> }

/** `buildData`'s own config shape: fields only, nothing else. */
export interface BuildDataConfig<TFields extends FieldsShape> {
  /** The default/example value for every field, declaring the capability's shape. */
  readonly fields: TFields
}

/**
 * A patch over a resolved fields value: nested plain objects accept any
 * subset of their keys, recursively, but arrays are atomic -- a patch never
 * partially patches an array's items, only replaces the whole array (see
 * ownership.ts/patch.ts). Date/URL/RegExp are opaque leaves, never
 * decomposed.
 */
export type DeepPartial<T> = T extends readonly (infer Item)[]
  ? readonly Item[]
  : T extends Date | URL | RegExp
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T

/**
 * Declares which fields an operation may write. `true` claims a whole
 * subtree (at any level, including the root -- a getter may legitimately
 * declare `fields: true` to mean "the entire capability"); a nested object
 * claims only the listed sub-keys. Arrays can only ever be owned wholesale
 * (`true`) -- there is no per-item ownership concept, matching arrays being
 * atomic, ordinary values.
 */
export type FieldOwnership<T> =
  | true
  | {
      [K in keyof T]?: T[K] extends readonly unknown[]
        ? true
        : T[K] extends object
          ? FieldOwnership<T[K]>
          : true
    }

/**
 * One uncommitted optimistic transition, folded on top of `authoritativeState`
 * by `project()`. Owned and managed by the (future) standalone runtime --
 * this is just the data shape the pure `project()` function folds over.
 */
export interface PendingTransition<TFields> {
  readonly id: symbol
  readonly fieldsPatch: DeepPartial<TFields> | undefined
  readonly infoPatch: DeepPartial<DataInfo<TFields>> | undefined
}

/** Distinguishes "first attempt in flight" (`loading`) from "recovering after a failure" (`retrying`). */
export type DataStatus = "idle" | "loading" | "success" | "error" | "retrying"

/** The latest relevant error for a field/operation, never a history -- see FieldInfo.error. */
export interface DataError {
  /** The getter/mutator/subscription operation key that produced this error. */
  readonly operator: string
  /** The raw error value the operation rejected/threw with, unwrapped. */
  readonly error: unknown
}

/** Current connection/lifecycle metadata for a field's subscription, if it has one. */
export interface SubscriptionInfo {
  /** The subscription's current connection status. */
  readonly status: "connecting" | "connected" | "reconnecting" | "disconnected" | "error"
  /** The subscription operation key that owns this connection. */
  readonly source?: string
  /** When the subscription most recently entered `"connected"`, as epoch ms. */
  readonly connectedAt?: number
  /** When the subscription most recently entered `"disconnected"`, as epoch ms. */
  readonly disconnectedAt?: number
  /** When the subscription most recently delivered an event, as epoch ms. */
  readonly lastEventAt?: number
  /** The error the connection settled with, if it's currently in an `"error"` status. */
  readonly error?: DataError
  /** How many consecutive reconnect attempts have occurred since the last successful connection. */
  readonly reconnectAttempt?: number
}

/**
 * Current authoritative execution metadata for one field -- never an event
 * history. `source` is the operation key that most recently established the
 * field's current value; `error` clears on the next successful establishing
 * operation unless a still-newer operation has since set a different one.
 */
export interface FieldInfo {
  /** This field's current lifecycle status. */
  readonly status?: DataStatus
  /** True while an uncommitted pending optimistic transition is contributing to this field's visible value. */
  readonly optimistic?: boolean
  /** The error the establishing operation settled with, if it failed. */
  readonly error?: DataError
  /** The operation key that most recently established this field's current value. */
  readonly source?: string
  /** When `source` most recently committed a value via a getter/subscription, as epoch ms. */
  readonly fetchedAt?: number
  /** When `source` most recently committed a value via any operation, as epoch ms. */
  readonly updatedAt?: number
  /** True once a newer request for this field has superseded the value currently shown. */
  readonly stale?: boolean
  /** Connection/lifecycle metadata, populated only when this field is established by a subscription. */
  readonly subscription?: SubscriptionInfo
}

/**
 * Mandatory, sparse metadata mirroring `fields`' logical structure -- never
 * generated eagerly for an untouched field. `fields` stay ordinary arrays;
 * only `info` represents array items as identity-keyed objects (a bare
 * `string` key here, since the identity-joining scheme lives in
 * `identity.ts`, added in a later phase).
 */
export type DataInfo<T> = T extends readonly (infer Item)[]
  ? Partial<Record<string, DataInfo<Item> & FieldInfo>>
  : T extends Date | URL | RegExp
    ? FieldInfo
    : T extends object
      ? { [K in keyof T]?: DataInfo<T[K]> } & FieldInfo
      : FieldInfo

/**
 * `fields` and `info` are always present and always committed/published
 * together as one atomic snapshot -- never independently. See
 * specs/architecture.md.
 */
export interface DataState<TFields> {
  /** The capability's current field values. */
  readonly fields: TFields
  /** Execution metadata mirroring `fields`' shape -- status/error/timestamps, never the values themselves. */
  readonly info: DataInfo<TFields>
}

/**
 * The store contract the standalone runtime implements --
 * `useSyncExternalStore`-compatible without importing React.
 */
export interface DataStore<TFields> {
  /** Returns the current, immutable `DataState` snapshot. */
  getSnapshot(): DataState<TFields>
  /** Registers `listener` to be called after every committed state change; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
}

/* -------------------------------------------------------------------------- */
/* Operations -- getters, mutators, subscriptions                            */
/* -------------------------------------------------------------------------- */
/*
 * Pure, type-only vocabulary consumed by two different places: `document.ts`
 * (still fully inert -- these types never imply runtime behavior on their
 * own) and `@maverickcer/data-cap/runtime`'s `createData`, which is the only
 * place any of this actually executes. Living here keeps core genuinely
 * synchronous/stateless (nothing below is itself a function that runs
 * anything) while letting `documentData` and the runtime's `createData`
 * share one schema vocabulary instead of two independently-drifting ones.
 */

/**
 * Narrows `DeepPartial<T>` down to exactly the keys `TOwnership` (a
 * `FieldOwnership<T>` value) permits, mirroring its shape one-for-one. A
 * `processor`/`optimistic` callback declared against `writes: {user:
 * {email: true}}` cannot type-check while returning `{post: ...}`, or even
 * `{user: {name: ...}}` -- a sibling field it doesn't own. This narrows the
 * *legal* shape at compile time only; `resolveOperationPatch` still enforces
 * the same boundary at runtime regardless, since a processor's actual
 * return value is never statically provable to match its declared type.
 */
export type OwnedPatch<T, TOwnership> = TOwnership extends true
  ? DeepPartial<T>
  : T extends readonly unknown[]
    ? never // arrays are atomic -- ownable only wholesale (`true`), matching FieldOwnership<T>
    : T extends Date | URL | RegExp
      ? never // opaque leaves -- same rule as arrays
      : T extends object
        ? { [K in keyof TOwnership & keyof T]?: OwnedPatch<T[K], TOwnership[K]> }
        : never

/**
 * A getter operation: acquires data. `writes` is required and explicit
 * (ADR 0011) -- a getter's ownership is typically narrow and specific, so
 * an explicit declaration keeps that scope visible and enforced. `TParams`
 * is inferred purely from `params`'s own literal value (or an explicit `{}
 * as TParams` type-only anchor when there's no sensible runtime default) --
 * never derived from this capability's `fields` nullability, so a
 * `fields.nullable(...)` declaration elsewhere never leaks an `| null`/
 * `| undefined` into an operation's parameter type.
 */
export interface GetterDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields>> {
  /** Default/example params, deep-merged with a caller's partial at call time. Omit and annotate via `{} as TParams` to require every param explicitly on every call. */
  readonly params?: TParams
  /** Performs the actual acquisition (fetch, query, etc.), aborted via `signal`. */
  readonly execute: (params: TParams, signal: AbortSignal) => Promise<TRaw>
  /** Defaults to identity when omitted -- `execute`'s raw result is then used directly as the patch, and must already be shaped like one. */
  readonly processor?: (raw: TRaw, params: TParams) => OwnedPatch<TFields, TWrites>
  /** Declares which fields this getter is permitted to write -- see `FieldOwnership`. */
  readonly writes: TWrites
}

/**
 * A mutator operation: performs a side effect. `writes` is optional --
 * omitting it defaults to full-capability-tree ownership, bounded to the
 * declared schema (ADR 0011) -- the common "this mutator can touch
 * anything the schema allows" case doesn't pay a declaration tax.
 */
export interface MutatorDefinition<
  TFields,
  TParams,
  TRaw,
  TWrites extends FieldOwnership<TFields> | undefined,
> {
  /** Default/example params, deep-merged with a caller's partial at call time. */
  readonly params?: TParams
  /** Performs the actual side effect (a write, an API call, etc.), aborted via `signal`. */
  readonly execute: (params: TParams, signal: AbortSignal) => Promise<TRaw>
  /** Defaults to identity when omitted -- `execute`'s raw result is then used directly as the patch. */
  readonly processor?: (
    raw: TRaw,
    params: TParams,
  ) => OwnedPatch<TFields, TWrites extends undefined ? true : TWrites>
  /** Declares which fields this mutator may write -- omitting it defaults to the full capability tree. */
  readonly writes?: TWrites
  /**
   * Computes an optimistic patch from CURRENT AUTHORITATIVE state (never the
   * visible/projected state -- a second concurrent optimistic transition
   * must never compute against a first transition's still-pending value).
   * Returning `undefined` means no optimistic transition for this call.
   */
  readonly optimistic?: (
    authoritativeState: DataState<TFields>,
    params: TParams,
  ) => OwnedPatch<TFields, TWrites extends undefined ? true : TWrites> | undefined
}

/** Handlers a subscription's `subscribe` implementation drives -- the same shape `coordinator.acquireSubscription` already uses. */
export interface SubscriptionEventHandlers<TEvent> {
  /** Call with each incoming event; committed through `processor` into a `writes`-bounded fields patch. */
  readonly onEvent: (event: TEvent) => void
  /** Call whenever the subscription's connection status changes, optionally with the triggering error. */
  readonly onStatusChange: (
    status: SubscriptionInfo["status"],
    detail?: { readonly error?: unknown },
  ) => void
}

/**
 * A subscription operation: continuously observes data. `writes` is
 * required and explicit, same rationale as a getter's. `onEvent`/
 * `onStatusChange` map to `writes`-bounded `fields` commits and
 * `info.<field>.subscription` commits respectively -- a status transition
 * alone never touches `fields` (ADR 0029). `subscribe`'s own shape matches
 * `coordinator.acquireSubscription`'s `SubscribeFn` exactly (params bound in
 * by the runtime, handlers, a teardown function returned directly) -- no
 * separate `AbortSignal`, since the returned teardown function is already
 * the sanctioned way to stop a subscription.
 */
export interface SubscriptionDefinition<
  TFields,
  TParams,
  TEvent,
  TWrites extends FieldOwnership<TFields>,
> {
  /** Default/example params, deep-merged with a caller's partial at call time. */
  readonly params?: TParams
  /** Opens the connection and drives `handlers`; the returned function tears the subscription down. */
  readonly subscribe: (params: TParams, handlers: SubscriptionEventHandlers<TEvent>) => () => void
  /** Defaults to identity when omitted -- the raw event is used directly as the patch. */
  readonly processor?: (event: TEvent, params: TParams) => OwnedPatch<TFields, TWrites>
  /** Declares which fields this subscription is permitted to write -- see `FieldOwnership`. */
  readonly writes: TWrites
}

/**
 * The full schema shape both `buildData` and the runtime's `createData`
 * accept -- each reads only the part it needs (`buildData` only ever reads
 * `fields`; a `getters`/`mutators`/`subscriptions` section on the same
 * object is simply ignored by it). `documentData` accepts this same shape
 * so one `documentData(schema, docs)` call documents whichever of the two
 * a given schema is ultimately passed to.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- operation maps are intentionally heterogeneous per key; each entry's own generics are still checked individually. */
export interface DataSchema<TFields extends FieldsShape> extends BuildDataConfig<TFields> {
  /** Named getter operations, keyed by the name they're called/documented under. */
  readonly getters?: Record<string, GetterDefinition<InferFields<TFields>, any, any, any>>
  /** Named mutator operations, keyed by the name they're called/documented under. */
  readonly mutators?: Record<string, MutatorDefinition<InferFields<TFields>, any, any, any>>
  /** Named subscription operations, keyed by the name they're called/documented under. */
  readonly subscriptions?: Record<
    string,
    SubscriptionDefinition<InferFields<TFields>, any, any, any>
  >
}
/* eslint-enable @typescript-eslint/no-explicit-any */
