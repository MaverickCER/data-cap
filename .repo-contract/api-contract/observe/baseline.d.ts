/**
 * `data-cap/observe` (Experimental): record which field names cross a boundary at runtime, never
 * their values, into a sink you supply. Pass the recording to `data-cap --observations`.
 *
 * @packageDocumentation
 */

/** The part of a web `Response` or `Request` that `observeResponse` uses; both satisfy it. */
export declare interface BodyReadable {
    /** A copy whose body can be read without consuming the original's. */
    clone(): BodyReadable;
    /** The body parsed as JSON. */
    json(): Promise<unknown>;
}

/** An in-memory sink: the only one this package provides. */
export declare function createMemorySink(): {
    readonly sink: ObservationSink;
    /** Every event recorded so far, in order. */
    events(): readonly ObservationEvent[];
    /** Every skip recorded so far: what the walker knowingly left out. */
    skips(): readonly ObservationSkip[];
};

/** What kind of boundary a declared data-flow endpoint crosses: a data store (`database`/`cache`/`storage`/`queue`), an external entity (`api`/`external-service`/`user-input`), or something internal to this codebase (`computed`/`internal`). */
declare type DataFlowEndpointKind = "database" | "cache" | "storage" | "queue" | "api" | "external-service" | "user-input" | "computed" | "internal";

/** The one place a capability-qualified field name is formed. */
export declare function fieldPathName(capability: string, path: readonly string[]): string;

/** What a data-flow rule can name as a destination: the declared endpoint kinds, plus the two destinations only code analysis can see. */
declare type FlowBoundaryKind = DataFlowEndpointKind | "client-response" | "log";

/** The declared data-safety state of a value at a boundary crossing: the vocabulary of `DataFlowEndpoint.handling` and of flow policy rules. */
declare type FlowHandling = "plaintext" | "masked" | "redacted" | "hashed" | "encrypted";

/**
 * Wraps `target[method]` so every call is observed with `observeValue`. `observe: "args"` (the
 * default) observes the first argument, `"result"` the result, and `"both"` both. A returned
 * `Response` is observed through a clone, a native promise through its resolved value. The call
 * then goes through with its `this`, arguments and result untouched. Returns a restore function
 * (a no-op if someone else has since replaced the method). Throws a `TypeError` at set-up when `target[method]` is not a function.
 */
export declare function instrumentBoundary(target: object, method: string, context: InstrumentContext, sink: ObservationSink): () => void;

/** `observeValue` context plus the walker options, for `instrumentBoundary` and `observeSink`. */
export declare interface InstrumentContext extends ObserveValueContext {
    readonly options?: ObserveValueOptions;
    /** What to observe on each call: the first argument (default), the returned value, or both. */
    readonly observe?: InstrumentObserve;
}

/** Which call results `instrumentBoundary` observes. */
export declare type InstrumentObserve = "args" | "result" | "both";

/** One observation: a field name was seen at a boundary during one scope. Never a value. */
export declare interface ObservationEvent {
    /** Caller-supplied id of the execution or test the event was seen in. */
    readonly scope: string;
    readonly boundary: ObservedBoundary;
    /** Capability-qualified dotted field path, for example `userData.user.email`: the same naming the static Flow Model uses for field nodes. */
    readonly field: string;
    /** Declared handling of the value at this crossing, when the caller knows it. */
    readonly handling?: FlowHandling;
    /**
     * When the crossing was seen: epoch milliseconds or an ISO 8601 string. Present only when the caller supplied a
     * `clock` (the recorder never reads one itself, so it stays deterministic); the Observation Model keeps first/last seen.
     */
    readonly at?: string | number;
}

/** Where events go. The package never provides one that does I/O. */
export declare interface ObservationSink {
    /** Receives one event. A throw here is caught; the observed code never sees it. */
    record(event: ObservationEvent): void;
    /** Optional channel for what the walker left out; pass `skips()` of the memory sink to `buildObservationModel`. */
    skip?(info: ObservationSkip): void;
}

/**
 * Evidence the recorder knowingly did not capture: below `field` (a capability-qualified path, or the capability
 * itself for the root) something was left out, for the stated reason. Names only, never a value.
 */
export declare interface ObservationSkip {
    readonly scope: string;
    readonly boundary: ObservedBoundary;
    readonly field: string;
    readonly reason: ObservationSkipReason;
}

/** Why the walker did not record part of a value. */
export declare type ObservationSkipReason = "dotted-key" | "max-depth" | "max-nodes" | "cycle";

/**
 * Records one event per valid field path and returns how many it recorded.
 * Never throws: invalid input records nothing, and a throwing sink stops
 * recording without propagating (observation must not break the observed
 * program).
 */
export declare function observeBoundary(sink: ObservationSink, input: ObserveBoundaryInput): number;

/** What a caller passes to `observeBoundary`. */
export declare interface ObserveBoundaryInput {
    readonly scope: string;
    readonly boundary: ObservedBoundary;
    /** The capability's export name, used to qualify each field path. */
    readonly capability: string;
    /** Field paths (key names only) observed at the boundary. */
    readonly fields: readonly (readonly string[])[];
    readonly handling?: FlowHandling;
    /** Caller-supplied time source (epoch ms), read once per call. The recorder never defaults to `Date.now()`. */
    readonly clock?: () => number;
}

/** What kind of boundary was crossed and its stable name (matches a `boundary` node of the Flow Model). */
export declare interface ObservedBoundary {
    readonly kind: FlowBoundaryKind;
    readonly name: string;
}

/**
 * Observes the JSON body of a web `Response` or `Request` without consuming the caller's: it clones, parses the
 * clone asynchronously and observes the parsed value (`observeValue`: names and paths only). Returns `response`
 * itself, untouched, so it can wrap a call (`const res = observeResponse(sink, ctx, await fetch(url))`). Scope and
 * the caller's `clock` are read when this is called, not when the body is parsed. A body that is not JSON, was
 * already used, or cannot be cloned records nothing; never throws and does no I/O beyond the clone. Cloning a
 * streaming body buffers it for the second reader, so avoid it on unbounded streams. Web-standard classes only.
 */
export declare function observeResponse<T extends BodyReadable>(sink: ObservationSink, context: ObserveValueContext, response: T, options?: ObserveValueOptions): T;

/** A one-argument pass-through that observes its argument and returns it: `const tap = observeSink(sink, ctx); res.json(tap(body))`. */
export declare function observeSink(sink: ObservationSink, context: InstrumentContext): <T>(value: T) => T;

/**
 * Walks any JSON-like `value` and records, through `observeBoundary`, the field path of every
 * object and leaf in it: names and paths, never a value. It returns `value` itself, so it can wrap
 * a call (`res.json(observeValue(sink, ctx, body))`). Array elements (and, with `collections`, Map
 * values and Set members)
 * collapse into the Flow Model's element marker `[]`. Functions, symbols and `undefined` are ignored; getters are
 * never run; cycles are not re-entered; depth and visited-value count are bounded. The root itself is not a field
 * (a root primitive records nothing). Keys that are empty or contain a dot cannot be path segments (the Flow Model
 * names a path by joining segments with a dot, so there is no reversible spelling). They are skipped, but never
 * silently. Every skip (`dotted-key`, `max-depth`,
 * `max-nodes`, `cycle`) is reported to `options.onSkip` and to `sink.skip`. Never throws.
 */
export declare function observeValue<T>(sink: ObservationSink, context: ObserveValueContext, value: T, options?: ObserveValueOptions): T;

/** What `observeValue` and `observeSink` need besides the value; `scope` may be a function evaluated at each call (for example the current test name). */
export declare interface ObserveValueContext {
    readonly scope: string | (() => string);
    readonly boundary: ObservedBoundary;
    /** The capability's export name, used to qualify each field path. */
    readonly capability: string;
    readonly handling?: FlowHandling;
    readonly clock?: () => number;
}

/** Bounds and switches for the walker. */
export declare interface ObserveValueOptions {
    /** Deepest nesting recorded (default 8); anything deeper is not walked and not recorded. */
    readonly maxDepth?: number;
    /** Most values visited per call (default 1000). */
    readonly maxNodes?: number;
    /** Walk `Map` values and `Set` members under the element marker `[]` (default off: they are leaves). Map keys are never read. */
    readonly collections?: boolean;
    /**
     * Called once per distinct (reason, path) when the walker leaves something out, with the path (dotted, relative to
     * the capability, `""` for the root) below which evidence is missing. Names only. The same information goes to
     * `sink.skip` when the sink has one. A throwing callback is ignored.
     */
    readonly onSkip?: (reason: ObservationSkipReason, path: string) => void;
}

export { }
