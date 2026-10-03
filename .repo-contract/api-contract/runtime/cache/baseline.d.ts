/**
 * Creates a bounded, least-recently-used-eviction cache of complete
 * `DataState` snapshots keyed by an opaque string the caller computes (e.g.
 * a canonicalized function-identity + params key, mirroring the
 * coordinator's own dedup key -- computing that key is an integration
 * concern outside this module, which is deliberately keying-scheme-agnostic).
 */
export declare function createDataCache<TFields>(options?: DataCacheOptions): DataCache<TFields>;

export declare interface DataCache<TFields> {
    get(key: string): DataState<TFields> | undefined;
    set(key: string, state: DataState<TFields>): void;
    delete(key: string): void;
    clear(): void;
    readonly size: number;
}

export declare interface DataCacheOptions {
    /** Maximum number of entries retained; least-recently-used entries are evicted first. Defaults to 100. */
    readonly maxEntries?: number;
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

export { }
