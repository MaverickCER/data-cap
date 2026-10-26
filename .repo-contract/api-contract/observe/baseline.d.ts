/** An in-memory sink -- the only one this package provides. */
export declare function createMemorySink(): {
    readonly sink: ObservationSink;
    events(): readonly ObservationEvent[];
};

/** What kind of boundary a declared data-flow endpoint crosses -- a data store (`database`/`cache`/`storage`/`queue`), an external entity (`api`/`external-service`/`user-input`), or something internal to this codebase (`computed`/`internal`). */
declare type DataFlowEndpointKind = "database" | "cache" | "storage" | "queue" | "api" | "external-service" | "user-input" | "computed" | "internal";

/** The one place a capability-qualified field name is formed. */
export declare function fieldPathName(capability: string, path: readonly string[]): string;

/** What a data-flow rule can name as a destination: the declared endpoint kinds, plus the two destinations only code analysis can see. */
declare type FlowBoundaryKind = DataFlowEndpointKind | "client-response" | "log";

/** The declared data-safety state of a value at a boundary crossing -- the vocabulary of `DataFlowEndpoint.handling` and of flow policy rules. */
declare type FlowHandling = "plaintext" | "masked" | "redacted" | "hashed" | "encrypted";

/** One observation: a field name was seen at a boundary during one scope. Never a value. */
export declare interface ObservationEvent {
    /** Caller-supplied id of the execution or test the event was seen in. */
    readonly scope: string;
    readonly boundary: ObservedBoundary;
    /** Capability-qualified dotted field path, for example `userData.user.email` -- the same naming the static Flow Model uses for field nodes. */
    readonly field: string;
    /** Declared handling of the value at this crossing, when the caller knows it. */
    readonly handling?: FlowHandling;
}

/** Where events go. The package never provides one that does I/O. */
export declare interface ObservationSink {
    record(event: ObservationEvent): void;
}

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
}

/** What kind of boundary was crossed and its stable name (matches a `boundary` node of the Flow Model). */
export declare interface ObservedBoundary {
    readonly kind: FlowBoundaryKind;
    readonly name: string;
}

export { }
