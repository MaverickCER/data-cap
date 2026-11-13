/**
 * The `data-cap` entry: declare a capability's fields with `buildData`, and its documentation with
 * `documentData`. It also exports the `DataState` types and the error classes. It imports nothing.
 * Tests run it on Node 22 or later, as a bundle with Web globals only, and on Bun and Deno.
 *
 * @packageDocumentation
 */

/**
 * Declares a schema's fields and returns their state. `data.fields` is readable
 * synchronously the instant this returns, holding the declared defaults. There is
 * no throw-until-ready gate, unlike `@maverickcer/env-cap`'s `createEnv` (see
 * specs/architecture.md).
 *
 * `buildData` is the low-level, pure and synchronous primitive: it reads only
 * `config.fields`. It ignores a `getters`, `mutators` or `subscriptions` section
 * on the same object; `createData` from `data-cap/runtime` runs those.
 * `data.info` is always present but starts empty. Nothing has
 * executed yet, so there is no metadata to report.
 *
 * @remarks
 * Throws synchronously, at call time, for a structurally invalid field default: a function value,
 * or a cyclic reference. That is a schema-authoring mistake to fix, not a runtime condition to warn
 * past.
 */
export declare function buildData<TFields extends FieldsShape>(config: BuildDataConfig<TFields>): BuiltData<TFields>;

/** `buildData`'s own config shape: fields only, nothing else. */
export declare interface BuildDataConfig<TFields extends FieldsShape> {
    /** The default/example value for every field, declaring the capability's shape. */
    readonly fields: TFields;
}

/**
 * The synchronous `{fields, info}` state `buildData` returns: structurally
 * `DataState<InferFields<TFields>>`, not a distinct shape. This alias makes `buildData`'s own
 * signature read as "the shape `buildData` returns". Every other consumer should keep using
 * `DataState` directly.
 */
export declare type BuiltData<TFields extends FieldsShape> = DataState<InferFields<TFields>>;

/**
 * Governance metadata for one capability, passed to `documentData`. Its keys are checked against the schema.
 * Every value here is declared by the author: the build pass checks that it is present, never that it is true.
 */
export declare interface CapabilityDocs<TSchema extends DataSchema<FieldsShape>> {
    /** Display name: falls back to the export/binding name when omitted. */
    readonly name?: string;
    /** Why this capability exists / what it's for. */
    readonly description?: string;
    /** Who's accountable for this capability. A field's own `owner` (see `FieldDocs`) overrides this for that field specifically. */
    readonly owner?: string;
    /** Free-form classification: never validated. */
    readonly category?: string;
    /** Mutual-exclusivity group: more than one *active* capability sharing this value is a real conflict (only one implementation of a group should be live at once). */
    readonly exclusiveGroup?: string;
    /** Defaults to `true` when omitted. Gates `exclusiveGroup` conflict checks and manifest membership. */
    readonly active?: boolean;
    /** Data classification. Standard vocabulary: `"public"` / `"internal"` / `"confidential"` / `"restricted"` (ascending); custom values are allowed but flagged as non-standard, never blocking. */
    readonly sensitivity?: string;
    /** Documented safeguard: presence only, never an adequacy claim. */
    readonly protections?: string;
    /** Documented retention policy: presence only, never an enforcement claim. */
    readonly retention?: string;
    /**
     * The declared reason this capability's data is collected or retained.
     * Declared only: data-cap never verifies the stated purpose matches
     * actual usage. A field's own `purpose` (see `FieldDocs`) overrides this
     * for that field specifically.
     */
    readonly purpose?: string;
    /**
     * The declared legal basis asserted for processing this capability's data
     * (e.g. `"consent"`, `"contract"`, `"legitimate interest"`). Records that
     * a basis was declared, never that data-cap has determined the basis is
     * legally valid. It records declared governance facts; data-cap does not
     * determine whether those facts satisfy a law. A field's own `legalBasis`
     * overrides this for that field specifically.
     */
    readonly legalBasis?: string;
    /**
     * The declared jurisdiction(s) this capability's data is permitted or
     * expected to be *stored* in. It is a policy constraint, not an observed
     * fact, a processing-location claim or a data-subject-location claim.
     * A field's own `dataResidency` overrides this for that field
     * specifically.
     */
    readonly dataResidency?: string | readonly string[];
    /**
     * The declared safeguard relied on for any transfer of this capability's
     * data out of `dataResidency`'s own jurisdiction(s): paired conceptually
     * with `dataResidency`, same presence-only discipline. A field's own
     * `transferSafeguard` (see `FieldDocs`) overrides this for that field
     * specifically.
     */
    readonly transferSafeguard?: string;
    /**
     * Whether access to this capability's data is documented as requiring an
     * audit trail. Declared only, same presence-only discipline as
     * `protections`/`retention`. A field's own `auditRequired` overrides this
     * for that field specifically.
     */
    readonly auditRequired?: boolean;
    /**
     * When this capability's data (or the credential/source behind it) is
     * declared to stop being valid, as an ISO-8601 date. A field's own
     * `expiresAt` (see `FieldDocs`) overrides this for that field
     * specifically. Declared only: nothing expires at runtime.
     */
    readonly expiresAt?: string;
    /** Whether this capability is documented as deprecated. Presence-only; nothing warns at runtime. */
    readonly deprecated?: boolean;
    /** Why this capability is deprecated, and what to use instead. Only meaningful alongside `deprecated`. */
    readonly deprecatedReason?: string;
    /**
     * Free-form extension bag for anything data-cap itself has no named
     * concept for. It is opaque: no code path in this package inspects or
     * validates it. An example is a jurisdiction-specific regulatory
     * classification such as `{ regulatory: "GDPR,PCI-DSS" }`. Once a concept
     * matters enough for data-cap to reason about, it gets its own named field
     * above, as `purpose`, `legalBasis`, `dataResidency`, `transferSafeguard`
     * and `auditRequired` did. Everything else stays here.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
    /** Declared data-flow rules for this capability's fields, evaluated against the Flow Model (see `FlowPolicyDocs`). */
    readonly flowPolicy?: readonly FlowPolicyDocs[];
    /**
     * Developer-supplied evidence assertions: verified over time, unlike
     * every other field above, which is declared-only. Kept structurally
     * separate for exactly that reason (see `EvidenceFieldDocs`).
     */
    readonly evidence?: {
        readonly fields?: Readonly<Record<string, EvidenceFieldDocs>>;
    };
    /** Per-field documentation, overriding this capability's own `owner`/`sensitivity`/`protections` where declared. Keys are checked against the schema's real `fields` shape. */
    readonly fields?: CapabilityFieldDocs<TSchema["fields"]>;
    /** Per-getter documentation. Keys are checked against the schema's real `getters` names: a nonexistent or misspelled getter name is a compile error. */
    readonly getters?: SchemaOperationDocs<TSchema, "getters">;
    /** Per-mutator documentation. Keys are checked against the schema's real `mutators` names. */
    readonly mutators?: SchemaOperationDocs<TSchema, "mutators">;
    /** Per-subscription documentation. Keys are checked against the schema's real `subscriptions` names. */
    readonly subscriptions?: SchemaOperationDocs<TSchema, "subscriptions">;
}

/** `FieldDocs` for every field in `TFields`, keyed the same way. */
export declare type CapabilityFieldDocs<TFields> = {
    [K in keyof TFields]?: FieldDocs;
};

/** `OperationDocs` for every operation in `TOperations`, keyed the same way. */
export declare type CapabilityOperationDocs<TOperations> = {
    [K in keyof TOperations]?: OperationDocs;
};

/**
 * Throw-based error hierarchy with a stable `code` discriminant, preferred
 * over `instanceof` for programmatic handling across bundling boundaries
 * (mirrors env-cap's own `EnvValidationError`/`EnvNotReadyError` convention).
 *
 * Invariant: no error here ever embeds a raw or processed field value in its
 * message; only field paths (key names), which are never sensitive.
 */
export declare abstract class DataCapError extends Error {
    /** Stable, programmatic discriminant: prefer this over `instanceof` across bundling boundaries. */
    abstract readonly code: string;
}

/** The latest relevant error for a field/operation, never a history: see FieldInfo.error. */
export declare interface DataError {
    /** The getter/mutator/subscription operation key that produced this error. */
    readonly operator: string;
    /** The raw error value the operation rejected/threw with, unwrapped. */
    readonly error: unknown;
}

/**
 * Which direction data moves across a declared boundary, and what kind of
 * boundary it is. Author-declared documentation only: never statically
 * verified against an operation's actual `execute`/`subscribe` body (those
 * stay opaque per `AGENTS.md` invariant 6). A report may never present an
 * endpoint as a proven fact; see `AGENTS.md`'s declared-vs-proven invariant.
 */
export declare type DataFlowDirection = "input" | "output";

/**
 * One declared data-flow boundary an operation crosses. A getter's or subscription's endpoints are
 * typically `"input"`: where `execute` or `subscribe` acquires data from. A mutator's are typically
 * `"output"`: where it sends data to. Nothing enforces the typical case, since this is
 * documentation, not a runtime contract.
 */
export declare interface DataFlowEndpoint {
    /** Which way data moves across this boundary. */
    readonly direction: DataFlowDirection;
    /** What kind of boundary this is. */
    readonly kind: DataFlowEndpointKind;
    /** Short identifier, e.g. "stripe-api", "postgres:users"; a semantic label, not a sentence. */
    readonly name: string;
    /**
     * A literal, trackable location for this endpoint: a URL, a route path, a `table:column` reference.
     * Unlike `name` (a short label), it is compared and matched across capabilities, not only read by
     * a person. For example, two capabilities that declare the same URL are flagged as likely
     * duplicate fetches.
     */
    readonly url?: string;
    /**
     * The declared data-safety state of this field's value AT this specific
     * boundary crossing. For example, a field can arrive `"encrypted"` on an
     * `"input"` endpoint and leave `"redacted"` on an `"output"` endpoint.
     * Declared only, like every other field in this vocabulary. It records what a developer
     * states about handling at this crossing, never that data-cap verified the runtime value matches it.
     */
    readonly handling?: FlowHandling;
}

/** What kind of boundary a declared data-flow endpoint crosses: a data store (`database`/`cache`/`storage`/`queue`), an external entity (`api`/`external-service`/`user-input`), or something internal to this codebase (`computed`/`internal`). */
export declare type DataFlowEndpointKind = "database" | "cache" | "storage" | "queue" | "api" | "external-service" | "user-input" | "computed" | "internal";

/**
 * Mandatory, sparse metadata mirroring `fields`' logical structure: never
 * generated eagerly for an untouched field. `fields` stay ordinary arrays.
 * Only `info` represents array items as identity-keyed objects. The key is a
 * bare `string` here, because the identity-joining scheme lives in
 * `identity.ts`.
 */
export declare type DataInfo<T> = T extends readonly (infer Item)[] ? Partial<Record<string, DataInfo<Item> & FieldInfo>> : T extends Date | URL | RegExp ? FieldInfo : T extends object ? {
    [K in keyof T]?: DataInfo<T[K]>;
} & FieldInfo : FieldInfo;

/**
 * The full schema shape both `buildData` and the runtime's `createData` accept. Each reads only the
 * part it needs: `buildData` reads `fields` and ignores any `getters`, `mutators` or
 * `subscriptions` section. `documentData` accepts this same shape
 * so one `documentData(schema, docs)` call documents whichever of the two
 * a given schema is ultimately passed to.
 */
export declare interface DataSchema<TFields extends FieldsShape> extends BuildDataConfig<TFields> {
    /** Named getter operations, keyed by the name they're called/documented under. */
    readonly getters?: Record<string, GetterDefinition<InferFields<TFields>, any, any, any>>;
    /** Named mutator operations, keyed by the name they're called/documented under. */
    readonly mutators?: Record<string, MutatorDefinition<InferFields<TFields>, any, any, any>>;
    /** Named subscription operations, keyed by the name they're called/documented under. */
    readonly subscriptions?: Record<string, SubscriptionDefinition<InferFields<TFields>, any, any, any>>;
}

/**
 * `fields` and `info` are always present and always committed/published
 * together as one atomic snapshot: never independently. See
 * specs/architecture.md.
 */
export declare interface DataState<TFields> {
    /** The capability's current field values. */
    readonly fields: TFields;
    /** Execution metadata mirroring `fields`' shape: status/error/timestamps, never the values themselves. */
    readonly info: DataInfo<TFields>;
}

/** Distinguishes "first attempt in flight" (`loading`) from "recovering after a failure" (`retrying`). */
export declare type DataStatus = "idle" | "loading" | "success" | "error" | "retrying";

/**
 * The store contract the standalone runtime implements:
 * `useSyncExternalStore`-compatible without importing React.
 */
export declare interface DataStore<TFields> {
    /** Returns the current, immutable `DataState` snapshot. */
    getSnapshot(): DataState<TFields>;
    /** Registers `listener` to be called after every committed state change; returns an unsubscribe function. */
    subscribe(listener: () => void): () => void;
}

/**
 * A patch over a resolved fields value. Nested plain objects accept any
 * subset of their keys, recursively. Arrays are atomic: a patch replaces the
 * whole array, never part of its items (see ownership.ts and patch.ts).
 * `Date`, `URL` and `RegExp` values are opaque leaves, never decomposed.
 */
declare type DeepPartial<T> = T extends readonly (infer Item)[] ? readonly Item[] : T extends Date | URL | RegExp ? T : T extends object ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : T;

/**
 * Adds documentation/operational metadata to the same capability graph a
 * `buildData`/`createData` call describes, without introducing runtime
 * behavior.
 *
 * `config` should be the exact same schema object passed to `createData` or
 * `buildData`, typically a separately declared `const` that both calls reuse.
 * Passing the same object lets the `getters`, `mutators` and `subscriptions`
 * keys of `docs` be checked against the schema's real operation names, not
 * only its `fields`. A `{fields}`-only config still works for a capability
 * with no operations to document.
 *
 * @remarks
 * Intentionally inert: build tooling discovers this call statically and does
 * all the work at build time. Nothing runs in a process that imports the
 * capability file. That is why this split exists, as it does for env-cap's
 * `documentEnv`. Never throws, whatever the input. A `documentData` call alone is
 * never evidence that a capability exists: static analysis (`build`) inspects
 * only real `buildData` and `createData` calls.
 */
export declare function documentData<TSchema extends DataSchema<FieldsShape>>(config: TSchema, docs: CapabilityDocs<TSchema>): void;

/**
 * Developer-supplied evidence assertions for one field. They differ in kind from every field on
 * `FieldDocs`, which are declared and never verified (ADR 0049's own invariant). `dynamicAccess`
 * is re-checked against the code on every run (see the build-tooling side of this feature).
 * It lives in `CapabilityDocs.evidence`, not in `FieldDocs`, so the shape itself shows this
 * different status, not only a doc comment (ADR 0053).
 */
declare interface EvidenceFieldDocs {
    /**
     * Citations of where this field is accessed in a way static analysis can't see on its own,
     * such as a dynamic key derived at runtime. Each is `"<relative-path>:<line>:<column>"`.
     * Every run re-verifies them. A citation whose file no longer exists, or whose cited line has
     * visibly changed since it was written, is downgraded and flagged, never trusted forever.
     */
    readonly dynamicAccess?: readonly string[];
}

declare const FIELD_MARKER: unique symbol;

/**
 * Documentation metadata for one field.
 *
 * `owner`, `sensitivity`, `protections`, and `transferSafeguard` override the capability-level
 * value of the same name for this field. Fields in one capability can differ in sensitivity, owner
 * and transfer boundary. `protections` and `retention` only signal that documentation is present.
 * A generator may say a safeguard or policy is "documented" or "not documented", never that it is
 * adequate, correct or enforced. `purpose`, `legalBasis`, `dataResidency`, `transferSafeguard` and
 * `auditRequired` follow the same presence-only rule. They are declared governance facts, never a
 * claim that data-cap has determined they satisfy any law
 * (see `specs/decisions/0051-documentdata-metadata-and-governance-fields.md`).
 * `dataSubjectCategory` and `recipientCategories` are field-level only, with no capability-level
 * counterpart; each property's own doc comment says why.
 *
 * The boundary this interface draws is deliberate: a named property here is
 * reserved for a concept data-cap itself understands, projects, or reports
 * on. Anything else (organization-specific detail with no data-cap-defined meaning) belongs in
 * `metadata`, never in an ad hoc extra property. That keeps this vocabulary bounded instead of
 * accreting one-off keys over time.
 *
 * Note what is deliberately absent: there is no per-field `validate`/
 * `validator` property, and no `helpers.validators` combinator library
 * backing one, unlike `@maverickcer/env-cap`'s `EnvVarDocs`. That is a
 * design choice, not a gap. `env-cap` validates on a reject-and-throw
 * pipeline, where a failing validator must carry a message explaining the
 * rejection. `data-cap` has no reject path to write a message for.
 * Invalid processor/operation output resets the field to its declared
 * default via `core/schema.ts`'s `checkValueAgainstSchema`. That keeps fields
 * synchronously readable (`AGENTS.md` invariant 2) and surfaces the
 * mismatch through `DataInfo`. See `helpers/shape.ts`'s own module comment
 * for the full reasoning.
 */
export declare interface FieldDocs {
    /** Why this field exists / what it's for. */
    readonly description?: string;
    /** Overrides the capability's own `owner` for this field specifically. */
    readonly owner?: string;
    /** Overrides the capability's own `sensitivity` for this field specifically. */
    readonly sensitivity?: string;
    /** Overrides the capability's own `protections` for this field specifically. */
    readonly protections?: string;
    /** Documented retention policy for this field: presence only, never an enforcement claim. */
    readonly retention?: string;
    /**
     * The declared reason this field's data is collected/retained. Declared
     * only: data-cap never verifies the stated purpose matches actual usage.
     * Overrides the capability's own `purpose` for this field specifically.
     */
    readonly purpose?: string;
    /**
     * The declared legal basis asserted for processing this field (e.g.
     * `"consent"`, `"contract"`, `"legitimate interest"`). Records that a
     * basis was declared: never that data-cap has determined the basis is
     * legally valid. Overrides the capability's own `legalBasis` for this
     * field specifically.
     */
    readonly legalBasis?: string;
    /**
     * The declared jurisdiction(s) this field's data is permitted or expected to be *stored* in.
     * It is a policy constraint, not an observed fact, a processing-location claim or a
     * data-subject-location claim. Overrides
     * the capability's own `dataResidency` for this field specifically.
     */
    readonly dataResidency?: string | readonly string[];
    /**
     * The declared safeguard relied on for any transfer of this field's data out of `dataResidency`'s
     * jurisdictions, such as `"EU Standard Contractual Clauses"` or `"adequacy decision"`.
     * `dataResidency` states where data may be *stored*; this states what protects a transfer *out
     * of* that jurisdiction.
     * Declared only: data-cap never verifies a transfer actually occurred or
     * that the named safeguard is legally adequate. Overrides the capability's
     * own `transferSafeguard` for this field specifically. See
     * `specs/decisions/0067-ropa-fields-recipient-categories-never-inferred.md`.
     */
    readonly transferSafeguard?: string;
    /**
     * Whether access to this field is documented as requiring an audit trail.
     * Declared only, same presence-only discipline as `protections`/
     * `retention`. Overrides the capability's own `auditRequired` for this
     * field specifically.
     */
    readonly auditRequired?: boolean;
    /**
     * The declared category of data subject this field's data concerns (e.g.
     * `"customers"`, `"employees"`, `"minors"`). Declared only: data-cap
     * never verifies who a field's actual data subjects are. Field-level only, with no
     * capability-level counterpart to override. Which data subjects a field concerns is a fact about
     * that field's own data, not one a capability can state for every field.
     */
    readonly dataSubjectCategory?: string;
    /**
     * The declared categories of recipient this field's data has been or will
     * be disclosed to (e.g. `"payment processor"`, `"tax authority"`,
     * `"internal support staff"`). Always explicitly authored: data-cap never
     * infers a recipient category from its own dependency graph.
     * A proven *consumer* inside this codebase is a different fact from a
     * declared *external recipient*, and conflating them would misrepresent both.
     * Field-level only, for the same reason as `dataSubjectCategory`. See
     * `specs/decisions/0067-ropa-fields-recipient-categories-never-inferred.md`
     * for the full reasoning on why this is never derived.
     */
    readonly recipientCategories?: readonly string[];
    /**
     * When this field's data (or the credential/source behind it) is declared
     * to stop being valid, as an ISO-8601 date (`"2026-12-31"`). Declared
     * only: nothing expires anything at runtime, and `data-cap` never fetches
     * a real expiry from a provider. Build tooling reads it to report what is
     * expiring soon (see the Lifecycle Model). A date that has already passed
     * is reported as expired, never acted on.
     */
    readonly expiresAt?: string;
    /** Whether this field is documented as deprecated. Presence-only, same discipline as every other declared fact here: nothing warns at runtime. */
    readonly deprecated?: boolean;
    /** Why this field is deprecated, and what to use instead. Only meaningful alongside `deprecated`. */
    readonly deprecatedReason?: string;
    /**
     * The date by which a deprecated field is intended to be removed, ISO-8601.
     * Field-level only: a removal deadline is about one field's own migration.
     * A capability-wide `removeBy` would say nothing about which of its fields
     * still need work.
     */
    readonly removeBy?: string;
    /**
     * The previous name of this field, when it was renamed. Field-level only,
     * for the same reason as `removeBy`. Build tooling uses it to read an added
     * field and a removed field across two runs as one rename. Without it they
     * are an unrelated addition and deletion (see `ChangeModel`'s `renamedFields`). Only ever populated from an *authored* value, never
     * guessed from name similarity.
     */
    readonly renamedFrom?: string;
    /**
     * Free-form extension bag for anything data-cap itself has no named
     * concept for: opaque, never inspected or validated by any code path in
     * this package. Once a concept matters enough for data-cap to reason
     * about, it gets its own named field above; everything else stays here.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Current authoritative execution metadata for one field: never an event
 * history. `source` is the operation key that most recently established the
 * field's current value. `error` clears on the next successful establishing
 * operation, unless a still-newer operation has since set a different one.
 */
export declare interface FieldInfo {
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
 * subtree at any level, including the root: a getter may declare
 * `fields: true` to mean "the entire capability". A nested object claims only
 * the listed sub-keys. Arrays can only be owned whole (`true`). There is no
 * per-item ownership, because arrays are atomic, ordinary values.
 */
export declare type FieldOwnership<T> = true | {
    [K in keyof T]?: T[K] extends readonly unknown[] ? true : T[K] extends object ? FieldOwnership<T[K]> : true;
};

/** Field-default authoring helpers, recognized only inside a `buildData`/`createData` schema. */
export declare class fields {
    /** Infers the underlying type from `defaultInner`; the runtime default is always `null`. */
    static nullable<T>(defaultInner: T): NullableMarker<T>;
    /** Infers the underlying type from `defaultInner`; the runtime default is always `undefined`. */
    static optional<T>(defaultInner: T): OptionalMarker<T>;
}

/**
 * The generic *bound* only, never surfaced to a consumer's inferred type. It is
 * the variance workaround env-cap's `EnvSchema` uses. With it, `TFields extends
 * FieldsShape` still infers a precise literal type per key from the object
 * passed to `buildData`.
 */
export declare type FieldsShape = Record<string, any>;

/** What a data-flow rule can name as a destination: the declared endpoint kinds, plus the two destinations only code analysis can see. */
export declare type FlowBoundaryKind = DataFlowEndpointKind | "client-response" | "log";

/** The declared data-safety state of a value at a boundary crossing: the vocabulary of `DataFlowEndpoint.handling` and of flow policy rules. */
export declare type FlowHandling = "plaintext" | "masked" | "redacted" | "hashed" | "encrypted";

/** Which fields a data-flow rule governs; every supplied criterion must match, and `classification` or `field` is required. */
export declare interface FlowPolicyAppliesToDocs {
    /** Every field of this capability whose resolved `sensitivity` equals this value. */
    readonly classification?: string;
    /** One field of this capability, by its top-level key. */
    readonly field?: string;
    /** Narrows the rule to one path inside each governed field (for example `["passwordHash"]`). */
    readonly path?: readonly string[];
}

/**
 * One declared data-flow rule: which of this capability's fields it governs,
 * and what must hold wherever their data goes. Evaluated against the Flow Model
 * at build time. A rule is a declaration, never a runtime check. A result is
 * only as complete as the analysis behind it (see the Policy Model's
 * `indeterminate` outcome). At least one of `forbidDestinations`,
 * `allowedDestinations` and `requireHandling` is required.
 */
export declare interface FlowPolicyDocs {
    /** Unique within this capability. */
    readonly id: string;
    /** Why the rule exists. */
    readonly description?: string;
    /** Which fields the rule governs. */
    readonly appliesTo: FlowPolicyAppliesToDocs;
    /** Destinations the governed data must never reach. */
    readonly forbidDestinations?: readonly FlowBoundaryKind[];
    /** If set, the only destinations the governed data may reach. */
    readonly allowedDestinations?: readonly FlowBoundaryKind[];
    /** Handling that exempts a crossing from `forbidDestinations`/`allowedDestinations`. */
    readonly allowedHandling?: readonly FlowHandling[];
    /** If set, every crossing of the governed data must declare one of these handlings. */
    readonly requireHandling?: readonly FlowHandling[];
}

/**
 * A getter operation: acquires data. `writes` is required and explicit
 * (ADR 0011): a getter's ownership is typically narrow and specific, so
 * an explicit declaration keeps that scope visible and enforced. `TParams`
 * is inferred purely from `params`'s own literal value (or an explicit `{}
 * as TParams` type-only anchor when there's no sensible runtime default).
 * It is never derived from this capability's `fields` nullability. So a
 * `fields.nullable(...)` declaration elsewhere never leaks `| null` or
 * `| undefined` into an operation's parameter type.
 */
export declare interface GetterDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields>> {
    /** Default/example params, deep-merged with a caller's partial at call time. Omit and annotate via `{} as TParams` to require every param explicitly on every call. */
    readonly params?: TParams;
    /** Performs the actual acquisition (fetch, query, etc.), aborted via `signal`. */
    readonly execute: (params: TParams, signal: AbortSignal) => Promise<TRaw>;
    /** Defaults to identity when omitted: `execute`'s raw result is then used directly as the patch, and must already be shaped like one. */
    readonly processor?: (raw: TRaw, params: TParams) => OwnedPatch<TFields, TWrites>;
    /** Declares which fields this getter is permitted to write: see `FieldOwnership`. */
    readonly writes: TWrites;
}

/** Resolves the application-facing field-value type for an entire `fields` shape, key by key. */
export declare type InferFields<F extends FieldsShape> = {
    [K in keyof F]: InferFieldValue<F[K]>;
};

/**
 * Resolves the application-facing type for one declared field default.
 * Functions are never valid field values: a function-typed default
 * resolves to `never` (see fields.ts's runtime counterpart, which throws).
 */
export declare type InferFieldValue<F> = F extends NullableMarker<infer Inner> ? InferFieldValue<Inner> | null : F extends OptionalMarker<infer Inner> ? InferFieldValue<Inner> | undefined : F extends readonly (infer Item)[] ? InferFieldValue<Item>[] : F extends Date | URL | RegExp ? F : F extends (...args: never[]) => unknown ? never : F extends object ? {
    [K in keyof F]: InferFieldValue<F[K]>;
} : F;

/**
 * Thrown synchronously by `buildData()`/`documentData()` when a declared field default is
 * structurally invalid. That is a function value (functions are never valid field data), or a value
 * that contains itself, directly or transitively.
 */
export declare class InvalidFieldDefaultError extends DataCapError {
    readonly code = "DATA_CAP_INVALID_FIELD_DEFAULT";
    /** Path (key names only, never values) to the invalid default. */
    readonly path: readonly string[];
    constructor(path: readonly string[], reason: string);
}

/**
 * A mutator operation: performs a side effect. `writes` is optional. Without it the mutator owns
 * the whole capability tree, bounded to the declared schema (ADR 0011), so the common case needs no
 * declaration.
 */
export declare interface MutatorDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields> | undefined> {
    /** Default/example params, deep-merged with a caller's partial at call time. */
    readonly params?: TParams;
    /** Performs the actual side effect (a write, an API call, etc.), aborted via `signal`. */
    readonly execute: (params: TParams, signal: AbortSignal) => Promise<TRaw>;
    /** Defaults to identity when omitted: `execute`'s raw result is then used directly as the patch. */
    readonly processor?: (raw: TRaw, params: TParams) => OwnedPatch<TFields, TWrites extends undefined ? true : TWrites>;
    /** Declares which fields this mutator may write: omitting it defaults to the full capability tree. */
    readonly writes?: TWrites;
    /**
     * Computes an optimistic patch from CURRENT AUTHORITATIVE state, never the
     * visible, projected state. A second concurrent optimistic transition must
     * never compute against a first transition's still-pending value.
     * Returning `undefined` means no optimistic transition for this call.
     */
    readonly optimistic?: (authoritativeState: DataState<TFields>, params: TParams) => OwnedPatch<TFields, TWrites extends undefined ? true : TWrites> | undefined;
}

/** Produced by `fields.nullable(...)`: recognized only during `buildData`'s schema-authoring walk; the resolved runtime default is always `null`. */
export declare interface NullableMarker<T> {
    /** Internal marker discriminant: see the module doc comment. */
    readonly [FIELD_MARKER]: "nullable";
    /** The declared inner default, kept only so the underlying type can be inferred: never the resolved runtime value. */
    readonly inner: T;
}

/**
 * Documentation metadata for one getter/mutator/subscription. Reserved keys
 * are explicitly typed (mirroring the vocabulary real capabilities tend to
 * document: what it does, where it talks to, what it costs to call). The type
 * still accepts arbitrary extra keys for anything project-specific, so
 * documenting never fights the type checker.
 *
 * `credentials` is descriptive only: documenting `credentials: "user
 * session"` is never proof that authorization is actually enforced.
 * `endpoints` is likewise author-declared, never verified.
 */
export declare interface OperationDocs {
    /** What this operation does. */
    readonly description?: string;
    /** Short identifier for where this operation acquires/sends data (e.g. `"stripe-api"`, `"postgres:users"`), not prose. */
    readonly source?: string;
    /** What's required to call this operation: descriptive only, never an authorization/enforcement claim. */
    readonly credentials?: string;
    /** Documented shape of what this operation returns/produces. */
    readonly response?: string;
    /** Declared data-flow boundaries this operation crosses: see `DataFlowEndpoint`. */
    readonly endpoints?: readonly DataFlowEndpoint[];
    /**
     * Free-form extension bag for anything data-cap itself has no named
     * concept for: opaque, never inspected or validated by any code path in
     * this package. The index signature below stays so documenting never
     * fights the type checker. `metadata` is the recommended place for new
     * extension data.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly [key: string]: unknown;
}

/** Produced by `fields.optional(...)`: recognized only during `buildData`'s schema-authoring walk; the resolved runtime default is always `undefined`. */
export declare interface OptionalMarker<T> {
    /** Internal marker discriminant: see the module doc comment. */
    readonly [FIELD_MARKER]: "optional";
    /** The declared inner default, kept only so the underlying type can be inferred: never the resolved runtime value. */
    readonly inner: T;
}

/**
 * Narrows `DeepPartial<T>` down to exactly the keys `TOwnership` (a
 * `FieldOwnership<T>` value) permits, mirroring its shape one-for-one.
 * Take a `processor` or `optimistic` callback declared against
 * `writes: {user: {email: true}}`. It cannot type-check while returning
 * `{post: ...}`, or even `{user: {name: ...}}`, a sibling field it doesn't own. This narrows the *legal* shape at compile
 * time only. `resolveOperationPatch` still enforces the same boundary at runtime, since no type
 * proves what a processor actually returns.
 */
export declare type OwnedPatch<T, TOwnership> = TOwnership extends true ? DeepPartial<T> : T extends readonly unknown[] ? never : T extends Date | URL | RegExp ? never : T extends object ? {
    [K in keyof TOwnership & keyof T]?: OwnedPatch<T[K], TOwnership[K]>;
} : never;

/**
 * Parameterized by the SAME schema type `createData` and `buildData` accept
 * (`TSchema extends DataSchema<FieldsShape>`), not by `TFields` alone.
 * Documentation augments the capability graph those two describe, never a
 * parallel, independently shaped structure. Passing the identical schema
 * object to `createData(schema)` and `documentData(schema, docs)` makes
 * `fields`, `getters`, `mutators` and `subscriptions` below real,
 * `keyof`-checked doc keys instead of arbitrary strings. A
 * `documentData()` call documenting a getter that doesn't exist on the
 * schema, or misspelling one that does, is now a compile error. It is not a
 * silent gap only caught (if at all) by build-tool AST warnings.
 *
 * The `getters`, `mutators` and `subscriptions` docs apply to either target.
 * The low-level `buildData` ignores those operations, and the
 * batteries-included `createData` executes them. One `documentData`
 * call documents either.
 *
 * `owner`, `category`, `exclusiveGroup`, `active`, `sensitivity`,
 * `protections`, `retention` and `metadata` are capability-level governance
 * metadata. They mirror env-cap's `documentEnv()` second-argument vocabulary,
 * reframed for data. `specs/decisions/` holds the full semantic-contract
 * table: what each field means, and exactly what a generator may claim about
 * it. All of it is author-declared, never statically verified: see
 * `AGENTS.md`'s declared-vs-proven invariant.
 */
/**
 * The `getters`/`mutators`/`subscriptions` docs shape for one operation
 * section, resolved from `TSchema` itself rather than plain indexed access
 * (`TSchema["getters"]`). Indexed access on a naked, constrained generic
 * type parameter resolves an absent optional property against the
 * CONSTRAINT's own declaration. That is `DataSchema`'s `Record<string,
 * GetterDefinition<...>>`, not the concrete inferred type. That
 * would silently permit any getter name to be documented on a schema that
 * declares no getters at all. A conditional type with `infer`, keyed on the
 * concrete `TSchema` at each call site, narrows correctly instead.
 *
 * The "no such section declared" branch is `Record<string, never>`, not
 * `Record<never, never>` or `{[K in never]?: OperationDocs}`. Both of the
 * latter collapse to TypeScript's `{}` ("any non-nullish value," not "no
 * properties"). That would silently accept any key once wrapped in
 * `CapabilityOperationDocs`'s own `{[K in keyof T]?: ...}` mapping. The
 * `keyof` of the collapsed `{}` is `string | number | symbol`, not `never`.
 * `Record<string, never>` avoids that trap because it stays a real
 * value-level constraint: no value is assignable to `never`. A key-level
 * constraint could be discarded by a further `keyof` extraction.
 */
declare type SchemaOperationDocs<TSchema, TKey extends "getters" | "mutators" | "subscriptions"> = TSchema extends Record<TKey, infer TOperations> ? CapabilityOperationDocs<TOperations> : Record<string, never>;

/**
 * A subscription operation: continuously observes data. `writes` is
 * required and explicit, same rationale as a getter's. `onEvent`/
 * `onStatusChange` map to `writes`-bounded `fields` commits and
 * `info.<field>.subscription` commits respectively: a status transition
 * alone never touches `fields` (ADR 0029). `subscribe`'s own shape matches
 * `coordinator.acquireSubscription`'s `SubscribeFn` exactly: params bound in by
 * the runtime, handlers, and a returned teardown function. There is no separate
 * `AbortSignal`, since the returned teardown function is already
 * the sanctioned way to stop a subscription.
 */
export declare interface SubscriptionDefinition<TFields, TParams, TEvent, TWrites extends FieldOwnership<TFields>> {
    /** Default/example params, deep-merged with a caller's partial at call time. */
    readonly params?: TParams;
    /** Opens the connection and drives `handlers`; the returned function tears the subscription down. */
    readonly subscribe: (params: TParams, handlers: SubscriptionEventHandlers<TEvent>) => () => void;
    /** Defaults to identity when omitted: the raw event is used directly as the patch. */
    readonly processor?: (event: TEvent, params: TParams) => OwnedPatch<TFields, TWrites>;
    /** Declares which fields this subscription is permitted to write: see `FieldOwnership`. */
    readonly writes: TWrites;
}

/** Handlers a subscription's `subscribe` implementation drives: the same shape `coordinator.acquireSubscription` already uses. */
export declare interface SubscriptionEventHandlers<TEvent> {
    /** Call with each incoming event; committed through `processor` into a `writes`-bounded fields patch. */
    readonly onEvent: (event: TEvent) => void;
    /** Call whenever the subscription's connection status changes, optionally with the triggering error. */
    readonly onStatusChange: (status: SubscriptionInfo["status"], detail?: {
        readonly error?: unknown;
    }) => void;
}

/** Current connection/lifecycle metadata for a field's subscription, if it has one. */
export declare interface SubscriptionInfo {
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
