/** `buildData`'s own config shape: fields only, nothing else. */
declare interface BuildDataConfig<TFields extends FieldsShape> {
    /** The default/example value for every field, declaring the capability's shape. */
    readonly fields: TFields;
}

declare interface CapabilityBase<TFields, TGetters> {
    runGetters(calls: RunGettersCalls<TGetters>, options?: RunGettersOptions): Promise<RunGettersResult<TFields, TGetters>>;
    getSnapshot(): DataCapabilitySnapshot<TFields>;
    getAuthoritativeState(): DataState<TFields>;
    subscribe(listener: () => void): () => void;
    describe(): CapabilityDescriptor;
}

/** Static, non-reactive operation metadata -- returned by `.describe()`, distinct from the live `operations` snapshot key. See requirement O (build tooling/ESLint/devtools discoverability). */
export declare interface CapabilityDescriptor {
    /** Every declared getter, by name. */
    readonly getters: Readonly<Record<string, OperationDescriptor>>;
    /** Every declared mutator, by name. */
    readonly mutators: Readonly<Record<string, OperationDescriptor>>;
    /** Every declared subscription, by name. */
    readonly subscriptions: Readonly<Record<string, OperationDescriptor>>;
}

declare type CapabilityGetterMethods<TFields, TGetters> = {
    [K in keyof OperationSection<TGetters>]: (params?: DeepPartial<DeclaredParams<OperationSection<TGetters>[K]>>, signal?: AbortSignal) => Promise<OwnedPatch<TFields, DeclaredWrites<OperationSection<TGetters>[K]>>>;
};

declare type CapabilityMutatorMethods<TFields, TMutators> = {
    [K in keyof OperationSection<TMutators>]: (params?: DeepPartial<DeclaredParams<OperationSection<TMutators>[K]>>, signal?: AbortSignal) => Promise<OwnedPatch<TFields, DeclaredWrites<OperationSection<TMutators>[K]>>>;
};

declare type CapabilitySubscriptionMethods<TSubscriptions> = {
    [K in keyof OperationSection<TSubscriptions>]: (params?: DeepPartial<DeclaredParams<OperationSection<TSubscriptions>[K]>>) => () => void;
};

/**
 * AbortSignal composition utilities. The runtime always composes an internal
 * signal from developer-provided ones rather than replacing them outright --
 * see specs/architecture.md.
 */
/**
 * Combines multiple signals into one that aborts as soon as any input does.
 * Prefers the native `AbortSignal.any()` where available; falls back to a
 * manual composition for engines without it (Node < 20, still within this
 * package's `engines.node >= 18` floor).
 */
export declare function composeSignals(signals: readonly AbortSignal[]): AbortSignal;

/** An isolated coordination domain for dedup and shared subscriptions -- see `createCoordinator`/`defaultCoordinator`. */
export declare interface Coordinator {
    /**
     * Deduplicates concurrent calls to `fn` (by its own identity) with
     * canonically-equal `params`. Non-canonicalizable params (or a
     * non-canonicalizable-adjacent failure) simply never dedupe -- `fn` runs
     * fresh every time, never throwing and never silently colliding two
     * unrelated calls onto one shared promise.
     *
     * Each caller's own `signal` only affects THEIR OWN wait -- aborting it
     * rejects this call's returned promise without affecting the shared
     * underlying execution or any other caller sharing it.
     */
    dedupe<TParams, TResult>(fn: (params: TParams, signal: AbortSignal) => Promise<TResult>, params: TParams, signal: AbortSignal): Promise<TResult>;
    /**
     * Acquires a shared subscription for `subscribeFn`. The first acquirer
     * establishes the transport; later acquirers with the same function
     * identity reuse it and immediately learn its current status. Returns a
     * release function -- the transport tears down only once every acquirer
     * has released.
     */
    acquireSubscription<TEvent>(subscribeFn: SubscribeFn<TEvent>, handlers: SubscriptionHandlers<TEvent>): () => void;
}

/** Creates a fresh, isolated `Coordinator` -- an independent dedup/shared-subscription domain, e.g. per-tenant on a server (ADR 0027). */
export declare function createCoordinator(): Coordinator;

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
 */
export declare function createData<TSchema extends DataSchema<FieldsShape>>(schema: TSchema, options?: CreateDataOptions): DataCapability<TSchema>;

/** Options for {@link createData}. */
export declare interface CreateDataOptions {
    /** Overrides `defaultCoordinator` -- an explicit, isolated coordination domain (ADR 0027), e.g. per-tenant on a server. */
    readonly coordinator?: Coordinator;
    /**
     * Bounds how many distinct canonicalized-params entries are retained per
     * operation in the reactive `operations` snapshot (an LRU cap -- an
     * operation called with many different params over a session, e.g.
     * search-as-you-type, would otherwise grow this unboundedly). Defaults to
     * 50.
     */
    readonly maxOperationHistory?: number;
}

/** Creates a standalone `DataStoreController`, seeded with `initialState` -- the manual-control building block `createData` composes over. */
export declare function createDataStore<TFields>(initialState: DataState<TFields>): DataStoreController<TFields>;

/** The object `createData(schema)` returns: one callable method per getter/mutator/subscription, plus `getSnapshot`/`getAuthoritativeState`/`subscribe`/`describe`/`runGetters`. */
export declare type DataCapability<TSchema extends DataSchema<FieldsShape>> = CapabilityGetterMethods<InferFields<TSchema["fields"]>, TSchema["getters"]> & CapabilityMutatorMethods<InferFields<TSchema["fields"]>, TSchema["mutators"]> & CapabilitySubscriptionMethods<TSchema["subscriptions"]> & CapabilityBase<InferFields<TSchema["fields"]>, TSchema["getters"]>;

/** A strict superset of `DataState<TFields>` -- every existing `DataStore` consumer (`useSyncExternalStore`, etc.) still works unchanged reading `.fields`/`.info` off it. */
export declare interface DataCapabilitySnapshot<TFields> extends DataState<TFields> {
    /** Every operation's current execution state -- see `OperationsSnapshot`. */
    readonly operations: OperationsSnapshot;
}

/**
 * Throw-based error hierarchy with a stable `code` discriminant, preferred
 * over `instanceof` for programmatic handling across bundling boundaries
 * (mirrors env-cap's own `EnvValidationError`/`EnvNotReadyError` convention).
 *
 * Invariant: no error here ever embeds a raw or processed field value in its
 * message -- only field paths (key names), which are never sensitive.
 */
export declare abstract class DataCapError extends Error {
    /** Stable, programmatic discriminant -- prefer this over `instanceof` across bundling boundaries. */
    abstract readonly code: string;
}

/** The latest relevant error for a field/operation, never a history -- see FieldInfo.error. */
declare interface DataError {
    /** The getter/mutator/subscription operation key that produced this error. */
    readonly operator: string;
    /** The raw error value the operation rejected/threw with, unwrapped. */
    readonly error: unknown;
}

/**
 * Mandatory, sparse metadata mirroring `fields`' logical structure -- never
 * generated eagerly for an untouched field. `fields` stay ordinary arrays;
 * only `info` represents array items as identity-keyed objects (a bare
 * `string` key here, since the identity-joining scheme lives in
 * `identity.ts`, added in a later phase).
 */
declare type DataInfo<T> = T extends readonly (infer Item)[] ? Partial<Record<string, DataInfo<Item> & FieldInfo>> : T extends Date | URL | RegExp ? FieldInfo : T extends object ? {
    [K in keyof T]?: DataInfo<T[K]>;
} & FieldInfo : FieldInfo;

/**
 * The full schema shape both `buildData` and the runtime's `createData`
 * accept -- each reads only the part it needs (`buildData` only ever reads
 * `fields`; a `getters`/`mutators`/`subscriptions` section on the same
 * object is simply ignored by it). `documentData` accepts this same shape
 * so one `documentData(schema, docs)` call documents whichever of the two
 * a given schema is ultimately passed to.
 */
declare interface DataSchema<TFields extends FieldsShape> extends BuildDataConfig<TFields> {
    /** Named getter operations, keyed by the name they're called/documented under. */
    readonly getters?: Record<string, GetterDefinition<InferFields<TFields>, any, any, any>>;
    /** Named mutator operations, keyed by the name they're called/documented under. */
    readonly mutators?: Record<string, MutatorDefinition<InferFields<TFields>, any, any, any>>;
    /** Named subscription operations, keyed by the name they're called/documented under. */
    readonly subscriptions?: Record<string, SubscriptionDefinition<InferFields<TFields>, any, any, any>>;
}

/**
 * `fields` and `info` are always present and always committed/published
 * together as one atomic snapshot -- never independently. See
 * specs/architecture.md.
 */
declare interface DataState<TFields> {
    /** The capability's current field values. */
    readonly fields: TFields;
    /** Execution metadata mirroring `fields`' shape -- status/error/timestamps, never the values themselves. */
    readonly info: DataInfo<TFields>;
}

/** Distinguishes "first attempt in flight" (`loading`) from "recovering after a failure" (`retrying`). */
declare type DataStatus = "idle" | "loading" | "success" | "error" | "retrying";

/**
 * The store contract the standalone runtime implements --
 * `useSyncExternalStore`-compatible without importing React.
 */
declare interface DataStore<TFields> {
    /** Returns the current, immutable `DataState` snapshot. */
    getSnapshot(): DataState<TFields>;
    /** Registers `listener` to be called after every committed state change; returns an unsubscribe function. */
    subscribe(listener: () => void): () => void;
}

export declare interface DataStoreController<TFields> extends DataStore<TFields> {
    /**
     * Commits a patch directly onto authoritative state (getter/subscription-
     * style updates, and a mutator's final settle). Always folds onto the
     * CURRENT authoritative state, never a snapshot captured earlier.
     */
    commitAuthoritative(fieldsPatch: DeepPartial<TFields> | undefined, infoPatch: DeepPartial<DataInfo<TFields>> | undefined): void;
    /** Adds a pending optimistic transition; the visible snapshot reflects it immediately. */
    addPendingTransition(fieldsPatch: DeepPartial<TFields> | undefined, infoPatch: DeepPartial<DataInfo<TFields>> | undefined): symbol;
    /** Removes a pending transition by id (its operation settled, success or failure either way). */
    removePendingTransition(id: symbol): void;
    /** The current authoritative state, independent of any pending optimistic transitions. */
    getAuthoritativeState(): DataState<TFields>;
}

declare type DeclaredParams<TDef> = TDef extends {
    readonly params?: infer P;
} ? P : never;

declare type DeclaredWrites<TDef> = TDef extends {
    readonly writes: infer W;
} ? W : TDef extends {
    readonly writes?: infer W;
} ? W extends undefined ? true : W : true;

/**
 * A patch over a resolved fields value: nested plain objects accept any
 * subset of their keys, recursively, but arrays are atomic -- a patch never
 * partially patches an array's items, only replaces the whole array (see
 * ownership.ts/patch.ts). Date/URL/RegExp are opaque leaves, never
 * decomposed.
 */
declare type DeepPartial<T> = T extends readonly (infer Item)[] ? readonly Item[] : T extends Date | URL | RegExp ? T : T extends object ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : T;

/** The shared `Coordinator` every `createData` call uses unless `CreateDataOptions.coordinator` overrides it. */
export declare const defaultCoordinator: Coordinator;

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
declare const FIELD_MARKER: unique symbol;

/**
 * Current authoritative execution metadata for one field -- never an event
 * history. `source` is the operation key that most recently established the
 * field's current value; `error` clears on the next successful establishing
 * operation unless a still-newer operation has since set a different one.
 */
declare interface FieldInfo {
    /** This field's current lifecycle status. */
    readonly status?: DataStatus;
    /** True while an uncommitted pending optimistic transition is contributing to this field's visible value. */
    readonly optimistic?: boolean;
    /** The error the establishing operation settled with, if it failed. */
    readonly error?: DataError;
    /** The operation key that most recently established this field's current value. */
    readonly source?: string;
    /** When `source` most recently committed a value via a getter/subscription, as epoch ms. */
    readonly fetchedAt?: number;
    /** When `source` most recently committed a value via any operation, as epoch ms. */
    readonly updatedAt?: number;
    /** True once a newer request for this field has superseded the value currently shown. */
    readonly stale?: boolean;
    /** Connection/lifecycle metadata, populated only when this field is established by a subscription. */
    readonly subscription?: SubscriptionInfo;
}

/**
 * Declares which fields an operation may write. `true` claims a whole
 * subtree (at any level, including the root -- a getter may legitimately
 * declare `fields: true` to mean "the entire capability"); a nested object
 * claims only the listed sub-keys. Arrays can only ever be owned wholesale
 * (`true`) -- there is no per-item ownership concept, matching arrays being
 * atomic, ordinary values.
 */
declare type FieldOwnership<T> = true | {
    [K in keyof T]?: T[K] extends readonly unknown[] ? true : T[K] extends object ? FieldOwnership<T[K]> : true;
};

/**
 * The generic *bound* only, never surfaced to a consumer's inferred type --
 * the same variance workaround env-cap's `EnvSchema` uses so `TFields extends
 * FieldsShape` still infers a precise, per-key literal type from the actual
 * object literal passed to `buildData`.
 */
declare type FieldsShape = Record<string, any>;

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
declare interface GetterDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields>> {
    /** Default/example params, deep-merged with a caller's partial at call time. Omit and annotate via `{} as TParams` to require every param explicitly on every call. */
    readonly params?: TParams;
    /** Performs the actual acquisition (fetch, query, etc.), aborted via `signal`. */
    readonly execute: (params: TParams, signal: AbortSignal) => Promise<TRaw>;
    /** Defaults to identity when omitted -- `execute`'s raw result is then used directly as the patch, and must already be shaped like one. */
    readonly processor?: (raw: TRaw, params: TParams) => OwnedPatch<TFields, TWrites>;
    /** Declares which fields this getter is permitted to write -- see `FieldOwnership`. */
    readonly writes: TWrites;
}

/** Resolves the application-facing field-value type for an entire `fields` shape, key by key. */
declare type InferFields<F extends FieldsShape> = {
    [K in keyof F]: InferFieldValue<F[K]>;
};

/**
 * Resolves the application-facing type for one declared field default.
 * Functions are never valid field values -- a function-typed default
 * resolves to `never` (see fields.ts's runtime counterpart, which throws).
 */
declare type InferFieldValue<F> = F extends NullableMarker<infer Inner> ? InferFieldValue<Inner> | null : F extends OptionalMarker<infer Inner> ? InferFieldValue<Inner> | undefined : F extends readonly (infer Item)[] ? InferFieldValue<Item>[] : F extends Date | URL | RegExp ? F : F extends (...args: never[]) => unknown ? never : F extends object ? {
    [K in keyof F]: InferFieldValue<F[K]>;
} : F;

/**
 * Thrown synchronously by `buildData()`/`documentData()` when a declared
 * field default is structurally invalid: a function value (functions are
 * never valid field data) or a cyclic reference (a value that contains
 * itself, directly or transitively).
 */
export declare class InvalidFieldDefaultError extends DataCapError {
    readonly code = "DATA_CAP_INVALID_FIELD_DEFAULT";
    /** Path (key names only, never values) to the invalid default. */
    readonly path: readonly string[];
    constructor(path: readonly string[], reason: string);
}

/**
 * A mutator operation: performs a side effect. `writes` is optional --
 * omitting it defaults to full-capability-tree ownership, bounded to the
 * declared schema (ADR 0011) -- the common "this mutator can touch
 * anything the schema allows" case doesn't pay a declaration tax.
 */
declare interface MutatorDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields> | undefined> {
    /** Default/example params, deep-merged with a caller's partial at call time. */
    readonly params?: TParams;
    /** Performs the actual side effect (a write, an API call, etc.), aborted via `signal`. */
    readonly execute: (params: TParams, signal: AbortSignal) => Promise<TRaw>;
    /** Defaults to identity when omitted -- `execute`'s raw result is then used directly as the patch. */
    readonly processor?: (raw: TRaw, params: TParams) => OwnedPatch<TFields, TWrites extends undefined ? true : TWrites>;
    /** Declares which fields this mutator may write -- omitting it defaults to the full capability tree. */
    readonly writes?: TWrites;
    /**
     * Computes an optimistic patch from CURRENT AUTHORITATIVE state (never the
     * visible/projected state -- a second concurrent optimistic transition
     * must never compute against a first transition's still-pending value).
     * Returning `undefined` means no optimistic transition for this call.
     */
    readonly optimistic?: (authoritativeState: DataState<TFields>, params: TParams) => OwnedPatch<TFields, TWrites extends undefined ? true : TWrites> | undefined;
}

/** Produced by `fields.nullable(...)` -- recognized only during `buildData`'s schema-authoring walk; the resolved runtime default is always `null`. */
declare interface NullableMarker<T> {
    /** Internal marker discriminant -- see the module doc comment. */
    readonly [FIELD_MARKER]: "nullable";
    /** The declared inner default, kept only so the underlying type can be inferred -- never the resolved runtime value. */
    readonly inner: T;
}

/** Static, per-operation metadata -- one entry within a `CapabilityDescriptor`. */
export declare interface OperationDescriptor {
    /** Which kind of operation this is. */
    readonly kind: "getter" | "mutator" | "subscription";
    /** The operation's declared `writes` ownership shape (`true` means the whole capability). */
    readonly writes: FieldOwnership<any> | true | undefined;
    /** Whether this operation declares a `processor`. */
    readonly hasProcessor: boolean;
    /** Only meaningful for mutators. */
    readonly hasOptimistic: boolean;
}

/** The settled result of one `runGetters` call: either the resolved patch, or the error it failed with. */
export declare type OperationOutcome<T> = {
    /** Always `"success"` for this variant. */
    readonly status: "success";
    /** The resolved, ownership-narrowed patch. */
    readonly value: T;
} | {
    /** Always `"error"` for this variant. */
    readonly status: "error";
    /** The error the call rejected with. */
    readonly error: DataError;
};

/**
 * Normalizes one schema section (`TSchema["getters"]`/`"mutators"`/
 * `"subscriptions"`, always possibly `undefined` when a schema declares
 * none) to a concrete, possibly-empty record type -- never about value-level
 * nullability. `keyof Record<string, never>` is `string`, but no real value
 * is ever assignable to `never`, so a schema with no getters at all still
 * produces zero `CapabilityGetterMethods` keys, not a type error.
 */
declare type OperationSection<T> = T extends undefined ? Record<string, never> : T;

/** Every operation's current `OperationState`, keyed by operation name then canonicalized params. */
export declare type OperationsSnapshot = Readonly<Record<string, Readonly<Record<string, OperationState>>>>;

/** One operation's current execution state, keyed by canonicalized params in `operations`. Distinct from `info.<field>` -- see the module doc comment. */
export declare interface OperationState {
    /** This call's current lifecycle status. */
    readonly status?: DataStatus;
    /** The error this call settled with, if it failed. */
    readonly error?: DataError;
    /** When this call started, as epoch ms. */
    readonly startedAt?: number;
    /** When this call settled (success or error), as epoch ms. */
    readonly settledAt?: number;
    /** True while a mutator's optimistic transition for this call is still pending. */
    readonly optimistic?: boolean;
    /** Populated only for subscription operations. */
    readonly subscription?: SubscriptionInfo;
}

/** Produced by `fields.optional(...)` -- recognized only during `buildData`'s schema-authoring walk; the resolved runtime default is always `undefined`. */
declare interface OptionalMarker<T> {
    /** Internal marker discriminant -- see the module doc comment. */
    readonly [FIELD_MARKER]: "optional";
    /** The declared inner default, kept only so the underlying type can be inferred -- never the resolved runtime value. */
    readonly inner: T;
}

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
declare type OwnedPatch<T, TOwnership> = TOwnership extends true ? DeepPartial<T> : T extends readonly unknown[] ? never : T extends Date | URL | RegExp ? never : T extends object ? {
    [K in keyof TOwnership & keyof T]?: OwnedPatch<T[K], TOwnership[K]>;
} : never;

/**
 * Wraps `promise` so it rejects immediately if `signal` aborts. Never
 * affects `promise` itself -- does not cancel or otherwise influence any
 * underlying shared work (see coordinator.ts: a caller giving up on waiting
 * is not the same as the shared execution being cancelled for every caller).
 */
export declare function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T>;

declare type RunGettersCalls<TGetters> = Partial<{
    [K in keyof OperationSection<TGetters>]: DeepPartial<DeclaredParams<OperationSection<TGetters>[K]>>;
}>;

/** Options for `runGetters`. */
export declare interface RunGettersOptions {
    /** Aborts every getter this call started that hasn't already settled. */
    readonly signal?: AbortSignal;
}

declare type RunGettersResult<TFields, TGetters> = Partial<{
    [K in keyof OperationSection<TGetters>]: OperationOutcome<OwnedPatch<TFields, DeclaredWrites<OperationSection<TGetters>[K]>>>;
}>;

/** Opens a shared subscription's transport; the returned function tears it down. */
export declare type SubscribeFn<TEvent> = (handlers: SubscriptionHandlers<TEvent>) => () => void;

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
declare interface SubscriptionDefinition<TFields, TParams, TEvent, TWrites extends FieldOwnership<TFields>> {
    /** Default/example params, deep-merged with a caller's partial at call time. */
    readonly params?: TParams;
    /** Opens the connection and drives `handlers`; the returned function tears the subscription down. */
    readonly subscribe: (params: TParams, handlers: SubscriptionEventHandlers<TEvent>) => () => void;
    /** Defaults to identity when omitted -- the raw event is used directly as the patch. */
    readonly processor?: (event: TEvent, params: TParams) => OwnedPatch<TFields, TWrites>;
    /** Declares which fields this subscription is permitted to write -- see `FieldOwnership`. */
    readonly writes: TWrites;
}

/** Handlers a subscription's `subscribe` implementation drives -- the same shape `coordinator.acquireSubscription` already uses. */
declare interface SubscriptionEventHandlers<TEvent> {
    /** Call with each incoming event; committed through `processor` into a `writes`-bounded fields patch. */
    readonly onEvent: (event: TEvent) => void;
    /** Call whenever the subscription's connection status changes, optionally with the triggering error. */
    readonly onStatusChange: (status: SubscriptionInfo["status"], detail?: {
        readonly error?: unknown;
    }) => void;
}

/** Handlers a coordinator-managed subscription drives -- see `SubscriptionEventHandlers`, the same shape without a bound `params`. */
export declare interface SubscriptionHandlers<TEvent> {
    /** Call with each incoming event. */
    readonly onEvent: (event: TEvent) => void;
    /** Call whenever the subscription's connection status changes, optionally with the triggering error. */
    readonly onStatusChange: (status: SubscriptionInfo["status"], detail?: {
        readonly error?: unknown;
    }) => void;
}

/** Current connection/lifecycle metadata for a field's subscription, if it has one. */
declare interface SubscriptionInfo {
    /** The subscription's current connection status. */
    readonly status: "connecting" | "connected" | "reconnecting" | "disconnected" | "error";
    /** The subscription operation key that owns this connection. */
    readonly source?: string;
    /** When the subscription most recently entered `"connected"`, as epoch ms. */
    readonly connectedAt?: number;
    /** When the subscription most recently entered `"disconnected"`, as epoch ms. */
    readonly disconnectedAt?: number;
    /** When the subscription most recently delivered an event, as epoch ms. */
    readonly lastEventAt?: number;
    /** The error the connection settled with, if it's currently in an `"error"` status. */
    readonly error?: DataError;
    /** How many consecutive reconnect attempts have occurred since the last successful connection. */
    readonly reconnectAttempt?: number;
}

/**
 * Thrown by `createData`'s `runGetters` when asked to run a getter name
 * that was never declared on the schema -- a caller/typo bug, not a data
 * failure (a genuine getter failure surfaces as a per-operation
 * `{status: "error"}` outcome instead, never a thrown rejection here).
 */
export declare class UnknownGetterError extends DataCapError {
    readonly code = "DATA_CAP_UNKNOWN_GETTER";
    /** The undeclared getter name that was requested. */
    readonly getterName: string;
    constructor(getterName: string);
}

export { }
