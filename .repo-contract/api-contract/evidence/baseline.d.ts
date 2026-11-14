/**
 * `data-cap/evidence`: read a generated Evidence Model without Node. `defineEvidenceProjection`
 * (Stable) builds your own view of it; the flow queries, views and standards adapters are
 * Experimental.
 *
 * @packageDocumentation
 */

/** Finds unused paths and whole-field client exposure. */
export declare function analyzeLeastData(input: LeastDataInput): LeastDataReport;

/**
 * Finds the redundant transformations in a Flow Model, in a fixed order (by place, then kind). A model without
 * `edgeTags` has no round trips or dead derivations to report; forwarding chains come from its edges.
 */
export declare function analyzeRedundantTransforms(flow: FlowModel): RedundantTransform[];

/** A PROV-JSON attribute map. */
declare type Attributes = Record<string, unknown>;

/** One changed capability's known current consumers. */
declare interface BlastRadiusEntry {
    /** The capability key (`file#exportName`): matches `ManifestChangeReport`'s own key convention. */
    readonly capability: string;
    /** Distinct consuming files known (from Dependency Model) to depend on this capability right now, sorted. */
    readonly consumers: readonly string[];
}

/** Projects the flow, policy, claims and observations into CycloneDX 1.6, or `undefined` when no flow was computed. */
export declare function buildCycloneDxBom(evidence: CycloneDxInput, options?: CycloneDxOptions): CycloneDxBom | undefined;

/** `buildData`'s own config shape: fields only, nothing else. */
declare interface BuildDataConfig<TFields extends FieldsShape> {
    /** The default/example value for every field, declaring the capability's shape. */
    readonly fields: TFields;
}

/** Builds the graph view, or `undefined` when no flow was computed. */
export declare function buildFlowGraphView(evidence: FlowGraphViewInput): FlowGraphView | undefined;

/** Projects the policy results and claims into OSCAL assessment-results, or `undefined` when no flow was computed. */
export declare function buildOscalAssessmentResults(evidence: OscalInput, options: OscalOptions): OscalAssessmentResults | undefined;

/** Projects the flow, claims and observations into a PROV-JSON document, or `undefined` when no flow was computed. */
export declare function buildProvDocument(evidence: ProvInput): ProvDocument | undefined;

/**
 * Capability Model's schema version (ADR 0050): `CapabilityInventory` is
 * both. Bumped only when a reader could misinterpret the shape (a field
 * changes type/meaning, or is removed), never for a purely additive field:
 * the same discipline `MANIFEST_SNAPSHOT_SCHEMA_VERSION`
 * (manifest-snapshot.ts) and `JSON_SCHEMA_VERSION` (cli/json.ts) already
 * document. Bumped 1 -> 2 by ADR 0057: `CapabilityNode`'s six governance properties
 * moved to `docs` only; `FieldNode`'s six moved from a bare value to
 * `ResolvedGovernanceValue<T>` (`{value, declaredOn}`). Bumped 2 -> 3:
 * `CapabilityNode.file` is now root-relative, not absolute.
 */
declare const CAPABILITY_MODEL_SCHEMA_VERSION = 3;

/**
 * Governance metadata for one capability, passed to `documentData`. Its keys are checked against the schema.
 * Every value here is declared by the author: the build pass checks that it is present, never that it is true.
 */
declare interface CapabilityDocs<TSchema extends DataSchema<FieldsShape>> {
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
declare type CapabilityFieldDocs<TFields> = {
    [K in keyof TFields]?: FieldDocs;
};

/**
 * The one authoritative model every report generator reads from: see
 * `buildInventory`. This type IS `data-cap`'s Capability Model (ADR 0050),
 * not a separate thing that produces one: `CAPABILITY_MODEL_SCHEMA_VERSION`
 * above versions this exact interface. ADR 0050 kept the `CapabilityInventory`
 * and `buildInventory` names rather than add a `CapabilityModel` wrapper. This
 * type was already the public model, so a rename would only duplicate it. A
 * canonical, versioned, JSON-serializable projection of every discovered
 * capability's fields and operations, active or not.
 */
declare interface CapabilityInventory {
    /** Always `CAPABILITY_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof CAPABILITY_MODEL_SCHEMA_VERSION;
    /** Every discovered, linked capability. */
    readonly capabilities: readonly CapabilityNode[];
    /** Parse/link warnings carried through from the discovery/linking pass that produced this inventory, each `file` root-relative like every other path this model publishes. */
    readonly warnings: readonly ParseWarning[];
}

/** One `buildData`/`createData` capability, resolved from the inventory's shared model. */
declare interface CapabilityNode {
    /**
     * Root-relative POSIX path of the file declaring this capability: the
     * one place an absolute discovery path is converted for publication
     * (see `display-path.ts`). Every downstream model that carries a
     * capability's `file` (Ownership, Finding, Dependency, Manifest Snapshot)
     * copies this value rather than re-deriving it, so there is exactly one
     * conversion point. Re-derive a real path with `absolutePathFrom(root,
     * file)` when actual filesystem/import work needs one.
     */
    readonly file: string;
    /** The binding name the `buildData`/`createData` result is exported as. */
    readonly exportName: string;
    /** `"buildData"` or `"createData"`: which call form declared this capability. */
    readonly kind: "buildData" | "createData";
    /**
     * This capability's own declared documentation, if any. It is the single path for
     * `owner`, `sensitivity`, `purpose`, `legalBasis`, `dataResidency` and
     * `auditRequired` (ADR 0057). A capability has nothing above it to resolve against,
     * so a separate "resolved" property would only copy `docs.X`.
     */
    readonly docs: LooseCapabilityDocs | undefined;
    /** Defaults to `true` when `docs.active` is absent. */
    readonly active: boolean;
    /** Resolved: `docs.exclusiveGroup`, if declared. */
    readonly exclusiveGroup: string | undefined;
    /** Position of this capability's own `buildData`/`createData` call site: always available (ADR 0052). */
    readonly declarationPosition: SourcePosition;
    /** Every declared field. */
    readonly fields: readonly FieldNode[];
    /** Every declared getter. */
    readonly getters: readonly OperationNode[];
    /** Every declared mutator. */
    readonly mutators: readonly OperationNode[];
    /** Every declared subscription. */
    readonly subscriptions: readonly OperationNode[];
}

/** `OperationDocs` for every operation in `TOperations`, keyed the same way. */
declare type CapabilityOperationDocs<TOperations> = {
    [K in keyof TOperations]?: OperationDocs;
};

/**
 * Bump only when a reader could misinterpret the shape: same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: every capability key is now built from a root-relative `file`,
 * and `renamedFields` was added.
 */
declare const CHANGE_MODEL_SCHEMA_VERSION = 2;

/** `data-cap`'s Change Model: the manifest diff, plus an optional blast-radius index. */
declare interface ChangeModel {
    /** Always `CHANGE_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof CHANGE_MODEL_SCHEMA_VERSION;
    /** The underlying manifest diff: see `diffManifestSnapshots`. */
    readonly manifest: ManifestChangeReport;
    /** One entry per added/updated capability, or `undefined` when no `DependencyModel` was supplied: an optional layer, matching `--ownership`/`--flow`'s existing opt-in cost model (the usage scan isn't free). */
    readonly blastRadius: readonly BlastRadiusEntry[] | undefined;
    /**
     * Every added-field/removed-field pair this run's currently-declared
     * `renamedFrom` values correlate into a single rename, sorted by
     * capability key then current name.
     *
     * @remarks
     * Only ever populated from an *authored* `FieldDocs.renamedFrom`: never
     * guessed from name similarity, which is the same "prove it, never infer
     * it" rule `AGENTS.md` invariant 11 applies to every other derived fact
     * here. An additive view, not a filter: `manifest.updatedCapabilities`'s
     * own `fields.added`/`fields.removed` still list a correlated rename's two
     * halves separately, so a consumer that doesn't know about this field
     * loses nothing.
     *
     * Field-level only. `CapabilityDocs` has no `renamedFrom` (see
     * `core/document.ts`), so there is no `renamedCapabilities`. A
     * capability-level rename has no authored field to correlate from, and this
     * model never guesses one from a moved file.
     */
    readonly renamedFields: readonly RenamedField[];
}

/** One claim. */
export declare interface Claim {
    /** Content-addressed. */
    readonly id: string;
    readonly kind: ClaimKind;
    /** Human-readable statement, derived from the structured fields and never parsed. */
    readonly statement: string;
    /** Capability-qualified dotted field name. */
    readonly subject: string;
    /** Boundary name (`field-reaches-boundary`) or rule id (`policy-holds`). */
    readonly object: string;
    /** Epistemic status of the underlying fact: the weakest status along the static path, or `observed` for an observation-only claim. */
    readonly status: FlowStatus;
    readonly verification: ClaimVerification;
    readonly scope: ClaimScope;
    readonly supporting: readonly EvidenceRef[];
    readonly contradicting: readonly EvidenceRef[];
    /** Which sub-models this claim was derived from. */
    readonly derivedFrom: readonly EvidenceRefModel[];
    /** The capability-qualified names of the observed paths that back this claim, sorted and distinct; absent when none did. */
    readonly observedPaths?: readonly string[];
    /** Whether those paths cover the claim's whole path scope; present exactly when `observedPaths` is. */
    readonly pathCoverage?: ClaimPathCoverage;
    /** The latest time any backing observation was seen (ISO 8601, UTC); absent when none carried a time. */
    readonly lastObservedAt?: string;
}

/** What a claim asserts. */
declare type ClaimKind = "field-reaches-boundary" | "field-sourced-from-boundary" | "policy-holds";

/**
 * Whether the observations seen cover the claim's whole path scope or only narrower paths inside it.
 *
 * @public Exported because a public type names it, so the published schema describes it.
 */
declare type ClaimPathCoverage = "whole" | "partial";

/** Bump only when a reader could misinterpret the shape. */
declare const CLAIMS_MODEL_SCHEMA_VERSION = 1;

/** What a claim covers and how completely. */
declare interface ClaimScope {
    /** Every observation scope that contributed to the claim, sorted; empty when none were run or none matched. */
    readonly observationScopes: readonly string[];
    /** False when the static trace behind the claim touched an `unknown` fact: the real picture may be larger. */
    readonly traceComplete: boolean;
    /** Contributing observation scopes whose recorder reported leaving out evidence near this claim's field, sorted; absent when none. */
    readonly truncatedScopes?: readonly string[];
}

/** `data-cap`'s Claims Model. */
export declare interface ClaimsModel {
    /** Always `CLAIMS_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof CLAIMS_MODEL_SCHEMA_VERSION;
    /** Every claim, ordered by id. */
    readonly claims: readonly Claim[];
    readonly summary: ClaimsSummary;
}

/** Claim counts by verification status. */
declare type ClaimsSummary = Readonly<Record<ClaimVerification, number>>;

/** How the evidence lines up for a claim. */
export declare type ClaimVerification = "verified" | "inferred" | "unobserved" | "contradicted" | "observed-only" | "indeterminate";

/** A CycloneDX annotation. */
export declare interface CycloneDxAnnotation {
    readonly "bom-ref": string;
    readonly subjects: readonly string[];
    readonly annotator: {
        readonly component: {
            readonly type: "application";
            readonly name: string;
            readonly version: string;
        };
    };
    readonly timestamp: string;
    readonly text: string;
}

/** The CycloneDX 1.6 document, restricted to what this projection populates. */
export declare interface CycloneDxBom {
    readonly bomFormat: "CycloneDX";
    readonly specVersion: "1.6";
    readonly serialNumber: string;
    readonly version: 1;
    readonly metadata: {
        readonly timestamp: string;
        readonly tools: {
            readonly components: readonly {
                readonly type: "application";
                readonly "bom-ref": string;
                readonly name: string;
                readonly version: string;
            }[];
        };
        readonly component: {
            readonly type: "application";
            readonly "bom-ref": string;
            readonly name: string;
        };
        readonly properties: readonly CycloneDxProperty[];
    };
    readonly services?: readonly CycloneDxService[];
    readonly annotations?: readonly CycloneDxAnnotation[];
}

/** A CycloneDX `serviceData` entry. */
export declare interface CycloneDxData {
    readonly flow: "inbound" | "outbound" | "bi-directional" | "unknown";
    readonly classification: string;
    readonly name: string;
    readonly description: string;
    readonly governance?: {
        readonly owners: readonly {
            readonly organization: {
                readonly name: string;
            };
        }[];
    };
    readonly source?: readonly string[];
    readonly destination?: readonly string[];
}

/** What the projection reads from the Evidence Model. */
export declare type CycloneDxInput = Pick<EvidenceModel, "flow" | "policy" | "claims" | "observation" | "provenance" | "capability">;

/** Options for `buildCycloneDxBom`. */
export declare interface CycloneDxOptions {
    /** Name of the described system (`metadata.component.name`; default `data-cap data-flow`). */
    readonly name?: string | undefined;
}

/** A CycloneDX name/value property. */
export declare interface CycloneDxProperty {
    readonly name: string;
    readonly value: string;
}

/** A CycloneDX service, restricted to what this projection populates. */
export declare interface CycloneDxService {
    readonly "bom-ref": string;
    readonly name: string;
    readonly description: string;
    readonly data?: readonly CycloneDxData[];
    readonly properties: readonly CycloneDxProperty[];
}

/** The latest relevant error for a field/operation, never a history: see FieldInfo.error. */
declare interface DataError {
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
declare type DataFlowDirection = "input" | "output";

/**
 * One declared data-flow boundary an operation crosses. A getter's or subscription's endpoints are
 * typically `"input"`: where `execute` or `subscribe` acquires data from. A mutator's are typically
 * `"output"`: where it sends data to. Nothing enforces the typical case, since this is
 * documentation, not a runtime contract.
 */
declare interface DataFlowEndpoint {
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
declare type DataFlowEndpointKind = "database" | "cache" | "storage" | "queue" | "api" | "external-service" | "user-input" | "computed" | "internal";

/**
 * Mandatory, sparse metadata mirroring `fields`' logical structure: never
 * generated eagerly for an untouched field. `fields` stay ordinary arrays.
 * Only `info` represents array items as identity-keyed objects. The key is a
 * bare `string` here, because the identity-joining scheme lives in
 * `identity.ts`.
 */
declare type DataInfo<T> = T extends readonly (infer Item)[] ? Partial<Record<string, DataInfo<Item> & FieldInfo>> : T extends Date | URL | RegExp ? FieldInfo : T extends object ? {
    [K in keyof T]?: DataInfo<T[K]>;
} & FieldInfo : FieldInfo;

/**
 * The full schema shape both `buildData` and the runtime's `createData` accept. Each reads only the
 * part it needs: `buildData` reads `fields` and ignores any `getters`, `mutators` or
 * `subscriptions` section. `documentData` accepts this same shape
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
 * together as one atomic snapshot: never independently. See
 * specs/architecture.md.
 */
declare interface DataState<TFields> {
    /** The capability's current field values. */
    readonly fields: TFields;
    /** Execution metadata mirroring `fields`' shape: status/error/timestamps, never the values themselves. */
    readonly info: DataInfo<TFields>;
}

/** Distinguishes "first attempt in flight" (`loading`) from "recovering after a failure" (`retrying`). */
declare type DataStatus = "idle" | "loading" | "success" | "error" | "retrying";

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
 * Declares a projection: a pure transform from the `EvidenceModel` to any
 * consumer-defined output shape, built entirely from `schema`'s independent
 * per-field projector functions.
 *
 * `data-cap`'s own reference projections in `reference-projections.ts` are
 * built through this exact function: Classification, Privacy, Retention,
 * Compliance and Audit Evidence. There is no privileged internal path, so a
 * consumer's own projection is a first-class citizen, not a lesser one.
 *
 * @remarks
 * A per-field schema, rather than one monolithic `(evidence) => T` function,
 * is what makes automatic provenance possible at all. Each projector runs
 * against its own read-tracking membrane. So `.project()` can say which
 * evidence a *specific output field* was derived from, not merely which
 * evidence the whole report touched. Compare "this report read the
 * Capability Model" with "this row's `sensitivity` came from
 * `capability.capabilities.0.docs.sensitivity`". The second is reviewable
 * evidence; the first is trivia.
 *
 * Superseded ADR 0050's earlier `(name, project)` signature, whose `name`
 * existed only to label a thrown error. The membrane below does more than that
 * wrapper did. It enforces the purity the wrapper only documented, and it
 * produces provenance the wrapper could not compute.
 */
export declare function defineEvidenceProjection<T extends Record<string, unknown>>(schema: EvidenceProjectionSchema<T>): EvidenceProjection<T>;

/**
 * Bump only when a reader could misinterpret the shape: same discipline
 * `CAPABILITY_MODEL_SCHEMA_VERSION`/`MANIFEST_SNAPSHOT_SCHEMA_VERSION` already
 * document. Bumped 1 -> 2 by ADR 0056: `byCapability`/`consumers` removed from
 * this model's own stored shape (see `dependency-projections.ts`). Bumped
 * 2 -> 3: every edge's `from`/`to.capability.file` is now
 * root-relative, not absolute.
 */
declare const DEPENDENCY_MODEL_SCHEMA_VERSION = 3;

/**
 * A statically-proven connection from one consuming file to a capability
 * (or a specific field/operation on it). Unlike the declared metadata in
 * `core/document.ts` (`source`, `credentials`, `endpoints`), every
 * `DependencyEdge` is derived by AST analysis, never author-declared: see
 * `AGENTS.md`'s declared-vs-proven invariant. Produced by the usage-scan
 * pass (`scan-dependencies.ts`), not by this module.
 */
declare interface DependencyEdge {
    /** Which kind of connection this is: see `DependencyRelationship`. */
    readonly relationship: DependencyRelationship;
    /** The consuming file, as a root-relative POSIX path (see `display-path.ts`). */
    readonly from: string;
    /** What this edge connects to. */
    readonly to: {
        /** The capability being consumed. */
        readonly capability: {
            /** Root-relative POSIX path of the file declaring the capability: the same value `CapabilityNode.file` publishes. */
            readonly file: string;
            /** The binding name the capability is exported as. */
            readonly exportName: string;
        };
        /** The specific field path being read, when `relationship` is `"reads-field"`. */
        readonly field?: readonly string[];
        /** The specific operation name being called, when `relationship` is `"calls-getter"`/`"calls-mutator"`/`"calls-subscription"`. */
        readonly operation?: string;
    };
    /** Whether the consumer reference itself was unambiguously resolved: see the usage-scan pass for what each value means. */
    readonly resolution: "resolved" | "unresolved-consumer" | "indeterminate";
    /** Position of the access site in `from` (file already known via `from`). Set when this edge originates from a specific identifier reference. That is every relationship except the file-level `"imports"` fallback edge scan-dependencies.ts synthesizes for a consumer with no further resolved usage. */
    readonly position: SourcePosition | undefined;
}

/** `data-cap`'s Dependency Model: every proven `DependencyEdge`, unindexed. See `dependency-projections.ts` for on-demand capability/consumer groupings. */
declare interface DependencyModel {
    /** Always `DEPENDENCY_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof DEPENDENCY_MODEL_SCHEMA_VERSION;
    /** Every proven edge, unindexed: same array `scanDependencies` produced. */
    readonly edges: readonly DependencyEdge[];
}

/** How a consuming file uses a capability: an import alone, a field read, or a call to a getter, mutator or subscription. */
declare type DependencyRelationship = "imports" | "reads-field" | "calls-getter" | "calls-mutator" | "calls-subscription";

/** The part of the Evidence Model a flow diagram reads: the flow and the policy results. */
export declare type DiagramInput = Pick<EvidenceModel, "flow" | "policy">;

/** Compares `before` to `after` by content-addressed id (ADR 0070). */
export declare function diffFlow(before: FlowModel, after: FlowModel): FlowDiff;

/** Evaluates `rules` over `evidence`. A rule that needs analysis that did not run is a violation. */
export declare function evaluateEvidenceRules(evidence: EvidenceRulesInput, rules: EvidenceRules): EvidenceRulesResult;

/**
 * Bump only when a reader could misinterpret the shape: same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: `provenance` became required and gained `toolVersion`/`commit`,
 * and `lifecycle` and `computed` were added. Bumped 2 -> 3 (ADR 0070):
 * `flow`, `policy`, `observation` and
 * `claims` were added, each with its own `computed` flag. Additive: a v2
 * reader's interpretation of every field it knew is unchanged.
 */
declare const EVIDENCE_MODEL_SCHEMA_VERSION = 3;

/** Every rule name the evaluator understands, in the order they are evaluated. */
export declare const EVIDENCE_RULE_NAMES: readonly ["noPolicyViolations", "noIndeterminatePolicies", "maxContradictedClaims", "maxUnknowns", "requireComplete", "maxUnusedSensitivePaths", "maxWholeFieldToClient", "requireObservations", "minVerifiedClaims", "requireVerified", "maxRedundantTransforms", "maxObservationAgeDays"];

/**
 * Which project-varying sub-models this particular run actually computed.
 *
 * Without this, a persisted `data.evidence.json` is ambiguous in exactly the
 * way a governance artifact must never be. An absent `dependency` could mean
 * "nothing in this project depends on anything" (a real, reportable finding)
 * or "this run never scanned for dependencies" (no finding at all, only an
 * un-run pass). Those are opposite conclusions and the JSON looked identical
 * either way.
 *
 * env-cap solves the same ambiguity by always computing all six sub-models,
 * so absence never happens. `data-cap` deliberately does not follow that:
 * the usage scan is the expensive pass here, and `--docs` alone is supposed
 * to stay cheap. So instead of forcing every run to pay for a full
 * dependency scan, each sub-model's presence is stated explicitly.
 *
 * `capability`, `lifecycle`, and `runtimeContract` have no flag: they are
 * always populated by construction, so a flag could only ever read `true`.
 *
 * A pass that ran and found nothing is `true` with an empty result, never
 * `false`. "We looked and found none" is a real finding, and this field keeps
 * it apart from "we did not look".
 */
declare interface EvidenceComputedModels {
    /** Whether a usage scan ran and produced a Dependency Model this run. */
    readonly dependency: boolean;
    /** Whether an Ownership Model was built this run. */
    readonly ownership: boolean;
    /** Whether at least one rule/scan pass ran and produced a Finding Model this run. */
    readonly finding: boolean;
    /** Whether a manifest diff was available and produced a Change Model this run. */
    readonly change: boolean;
    /** Whether a flow pass ran and produced a Flow Model this run. */
    readonly flow: boolean;
    /** Whether policy rules were evaluated and produced a Policy Model this run. */
    readonly policy: boolean;
    /** Whether runtime observations were ingested and produced an Observation Model this run. */
    readonly observation: boolean;
    /** Whether claims were derived this run: true exactly when `flow` was computed. */
    readonly claims: boolean;
}

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

/**
 * `data-cap`'s Evidence Model: the composition of Capability, Lifecycle,
 * Dependency, Ownership, Finding, Change, and Runtime Contract Model into
 * one provenance-stamped artifact.
 */
export declare interface EvidenceModel {
    /** Always `EVIDENCE_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof EVIDENCE_MODEL_SCHEMA_VERSION;
    /** Who/when/what produced this instance: always present (see `EvidenceProvenance`). */
    readonly provenance: EvidenceProvenance;
    /** Capability Model. */
    readonly capability: CapabilityInventory;
    /** Lifecycle Model: always populated, for the reason `EvidenceModelInputs.lifecycle` documents. */
    readonly lifecycle: LifecycleModel;
    /**
     * Which of the four optional sub-models below this run actually computed:
     * read this before concluding anything from an absent one.
     */
    readonly computed: EvidenceComputedModels;
    /** Dependency Model, or `undefined` when no usage scan was run: see `computed.dependency` before reading absence as "no dependencies." */
    readonly dependency: DependencyModel | undefined;
    /** Ownership Model, or `undefined` when none was supplied: see `computed.ownership`. */
    readonly ownership: OwnershipModel | undefined;
    /** Finding Model, or `undefined` when nothing was supplied. See `computed.finding` before reading absence as "no findings." */
    readonly finding: FindingModel | undefined;
    /**
     * Change Model, or `undefined` when no manifest diff was available. See
     * `computed.change` before reading absence as "nothing changed." It is not a
     * diffable input across two `EvidenceModel`s the way the other five
     * project-varying fields conceptually are: it already IS a diff.
     */
    readonly change: ChangeModel | undefined;
    /** Flow Model, or `undefined` when no flow pass ran: see `computed.flow` before reading absence as "no flows." */
    readonly flow: FlowModel | undefined;
    /** Policy Model, or `undefined` when no rules were evaluated: see `computed.policy`. */
    readonly policy: PolicyModel | undefined;
    /** Observation Model, or `undefined` when no observations were ingested. See `computed.observation` before reading absence as "nothing was observed." */
    readonly observation: ObservationModel | undefined;
    /**
     * Claims Model, derived by `buildEvidenceModel` from `flow` (plus `policy`
     * and `observation` when present), never supplied by a caller. There is one
     * derivation path, so the claims can never disagree with the facts they
     * cite. `undefined` exactly when `flow` is.
     */
    readonly claims: ClaimsModel | undefined;
    /**
     * Runtime Contract Model: always populated, package-scoped rather than
     * project-scoped (see this module's own doc comment). A static append,
     * never itself a diffable "changed since last run" input.
     */
    readonly runtimeContract: RuntimeContractModel;
}

/**
 * The function `defineEvidenceProjection()` returns. Callable directly for
 * the common case (`projection(evidence)` -> `T`); `.project()` returns the
 * same value alongside automatic, per-field provenance.
 */
export declare interface EvidenceProjection<T extends Record<string, unknown>> {
    (evidence: EvidenceModel): T;
    /**
     * Declared as a property holding a function, not as a method. What is
     * attached is a closure (`Object.assign(invoke, {project})`) that never reads
     * `this`, so a consumer may destructure it or pass it around. A method
     * signature would claim otherwise and make every such
     * use look like an unbound-method bug.
     */
    readonly project: (evidence: EvidenceModel) => EvidenceProjectionResult<T>;
}

/** `project()`'s return shape: the computed output, plus which `EvidenceModel` field paths fed each output key. */
export declare interface EvidenceProjectionResult<T extends Record<string, unknown>> {
    /** The projection's own output: exactly what calling the projection directly returns. */
    readonly value: T;
    /** Per output key, every dotted `EvidenceModel` path that key's own projector actually read, sorted. */
    readonly sources: Readonly<Record<keyof T, readonly string[]>>;
}

/** One independent, pure projector function per key of the projection's output shape `T`. */
export declare type EvidenceProjectionSchema<T extends Record<string, unknown>> = {
    readonly [K in keyof T]: EvidenceProjector<T[K]>;
};

/**
 * A pure function from the full Evidence Model to one field of a
 * projection's output shape. Must not mutate `evidence` or perform I/O. The
 * membrane `defineEvidenceProjection()` wraps `evidence` in enforces the
 * read-only half at runtime (see `createTrackingProxy()` below); nothing
 * enforces the "no side effects" half.
 */
export declare type EvidenceProjector<T> = (evidence: EvidenceModel) => T;

/**
 * Who/when/what produced a given `EvidenceModel` instance: matching
 * env-cap's own `EvidenceProvenance` shape exactly, so a consumer reading
 * both packages' evidence artifacts reads one vocabulary, not two.
 *
 * `generatedAt`/`toolVersion` are required: every real caller can supply
 * both. (The tool version is `data-cap`'s own installed version, read from
 * its `package.json`; see `package-version.ts`.) A provenance stamp
 * that might be missing either one is a provenance stamp no consumer can
 * rely on. `commit` stays caller-supplied and explicitly `string |
 * undefined` (never omitted from the shape). `data-cap` never shells out to
 * `git` itself, so an absent commit is a stated absence, never a guess.
 * This is ADR 0050's "provenance is caller-supplied, never ambient-detected"
 * convention, kept exactly where it still applies.
 */
export declare interface EvidenceProvenance {
    /** ISO-8601 timestamp for when this evidence was generated. */
    readonly generatedAt: string;
    /** `data-cap`'s own installed version at generation time. */
    readonly toolVersion: string;
    /** The commit SHA this evidence was generated against, or `undefined` when the caller didn't supply one. */
    readonly commit: string | undefined;
}

/** A pointer to one record inside the Evidence Model. */
export declare interface EvidenceRef {
    readonly model: EvidenceRefModel;
    /** Flow node/edge id, observation id, or `ruleId#fieldNodeId` for a policy result group. */
    readonly id: string;
}

/** Which sub-model of the Evidence Model a piece of evidence lives in. */
declare type EvidenceRefModel = "flow" | "policy" | "observation";

/** The rules a gate can enforce. Each is optional; at least one is required. */
export declare interface EvidenceRules {
    /** No declared flow policy is violated. */
    readonly noPolicyViolations?: boolean;
    /** Every declared flow policy could be decided (none is left `indeterminate`). */
    readonly noIndeterminatePolicies?: boolean;
    /** At most this many claims are contradicted by evidence. */
    readonly maxContradictedClaims?: number;
    /** The flow analysis left at most this many unknowns (parts of the program it could not follow). */
    readonly maxUnknowns?: number;
    /** The flow analysis is complete: nothing was left unfollowed. */
    readonly requireComplete?: boolean;
    /** At most this many paths of a sensitive field are never read, forwarded or sent. */
    readonly maxUnusedSensitivePaths?: number;
    /** At most this many multi-key fields are sent whole to a client response. */
    readonly maxWholeFieldToClient?: number;
    /** Runtime observations were ingested and there is at least one. */
    readonly requireObservations?: boolean;
    /** At least this many claims are verified (static or declared, corroborated by an observation). */
    readonly minVerifiedClaims?: number;
    /** Each named policy rule (by id) has every one of its claims verified: held statically and corroborated at runtime. */
    readonly requireVerified?: readonly string[];
    /**
     * Every verified claim was last observed no more than this many days before the evidence was generated
     * (`provenance.generatedAt`; the check never reads a clock). Fails closed: a verified claim with no observation
     * time (the recorder was given no `clock`) is a violation, not a skip.
     */
    readonly maxObservationAgeDays?: number;
    /** At most this many redundant transformations (a needless round trip, a forwarding chain, a derivation nobody reads; ADR 0075). */
    readonly maxRedundantTransforms?: number;
}

/** What the evaluator reads from the Evidence Model. */
export declare type EvidenceRulesInput = Pick<EvidenceModel, "capability" | "flow" | "policy" | "claims" | "observation" | "computed" | "provenance">;

/** The verdict. */
export declare interface EvidenceRulesResult {
    /** True exactly when there are no violations. */
    readonly ok: boolean;
    /** The rules that were evaluated, in order. */
    readonly evaluated: readonly (typeof EVIDENCE_RULE_NAMES)[number][];
    readonly violations: readonly EvidenceRuleViolation[];
}

/** One reason the gate did not pass. */
export declare interface EvidenceRuleViolation {
    /** Which rule. */
    readonly rule: (typeof EVIDENCE_RULE_NAMES)[number];
    readonly message: string;
    /** The records in the evidence this rests on, for drill-down. */
    readonly evidence: readonly EvidenceRef[];
}

/** One capability- or field-level `expiresAt` falling within the configured window (or already past it). */
declare interface ExpiringEntry {
    /** Root-relative POSIX path of the declaring file. */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
    /** `undefined` for a capability-level `expiresAt`, set for a per-field one. */
    readonly field: readonly string[] | undefined;
    /** The raw ISO-8601 date string, exactly as declared. */
    readonly expiresAt: string;
    /** Whole days from `now` until expiry; negative when already expired. */
    readonly daysRemaining: number;
}

declare const FIELD_MARKER: unique symbol;

/** A boundary a field's data reaches. */
export declare interface FieldDestination {
    readonly boundary: string;
    readonly boundaryName: string;
    readonly boundaryKind?: FlowBoundaryKind;
    /** Every path of the field that reaches it; `[]` is the whole field. */
    readonly paths: readonly (readonly string[])[];
    /** The weakest status among the edges that carry it there. */
    readonly status: FlowStatus;
    readonly handling: readonly FlowHandling[];
}

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
declare interface FieldDocs {
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

/** One top-level field of a capability, resolved from the inventory's shared model. */
declare interface FieldNode {
    /** Top-level field key, as a single-element path (see the module doc comment on why granularity stops here). */
    readonly path: readonly string[];
    /** This field's own declared documentation, if any: `description`/`protections`/`retention`/`metadata` have no resolution concept and live only here; for the six governed properties below, prefer `.value`/`.declaredOn` over reading this object directly (ADR 0057). */
    readonly docs: FieldDocs | undefined;
    /** Resolved: the field's own `docs.owner`, else the capability's `owner`, plus which one declared it. */
    readonly owner: ResolvedGovernanceValue<string>;
    /** Resolved: the field's own `docs.sensitivity`, else the capability's `sensitivity`; same inheritance rule as `owner` (ADR 0049, ADR 0050, ADR 0057). */
    readonly sensitivity: ResolvedGovernanceValue<string>;
    /** Resolved: the field's own `docs.purpose`, else the capability's `purpose`; same inheritance rule as `owner`/`sensitivity` (ADR 0051, ADR 0057). Declared only, never verified. */
    readonly purpose: ResolvedGovernanceValue<string>;
    /** Resolved: the field's own `docs.legalBasis`, else the capability's `legalBasis`; same inheritance rule. A declared fact, never a legal determination (ADR 0051, ADR 0057). */
    readonly legalBasis: ResolvedGovernanceValue<string>;
    /** Resolved: the field's own `docs.dataResidency`, else the capability's `dataResidency`; same inheritance rule. The declared permitted-storage jurisdiction(s), not an observed fact (ADR 0051, ADR 0057). */
    readonly dataResidency: ResolvedGovernanceValue<string | readonly string[]>;
    /** Resolved: the field's own `docs.auditRequired`, else the capability's `auditRequired`; same inheritance rule (ADR 0051, ADR 0057). */
    readonly auditRequired: ResolvedGovernanceValue<boolean>;
    /** Every getter/mutator/subscription whose statically-extracted `writes` shape claims this field. */
    readonly writtenBy: readonly {
        /** Which kind of operation wrote this field. */
        readonly kind: "getter" | "mutator" | "subscription";
        /** The writing operation's key name. */
        readonly name: string;
    }[];
    /** The field's literal-evaluated declared default: structural comparison only (e.g. `structural-duplication.ts`), never a runtime value. */
    readonly shape: unknown;
    /** Position of this field's own key in the `fields` object literal. Set only when `fields` was resolved as an inline literal in this file. It is `undefined` when identifier-resolved across a file boundary this pass doesn't retain AST access to (never guessed at; ADR 0052). */
    readonly declarationPosition: SourcePosition | undefined;
}

/**
 * Declares which fields an operation may write. `true` claims a whole
 * subtree at any level, including the root: a getter may declare
 * `fields: true` to mean "the entire capability". A nested object claims only
 * the listed sub-keys. Arrays can only be owned whole (`true`). There is no
 * per-item ownership, because arrays are atomic, ordinary values.
 */
declare type FieldOwnership<T> = true | {
    [K in keyof T]?: T[K] extends readonly unknown[] ? true : T[K] extends object ? FieldOwnership<T[K]> : true;
};

/**
 * The generic *bound* only, never surfaced to a consumer's inferred type. It is
 * the variance workaround env-cap's `EnvSchema` uses. With it, `TFields extends
 * FieldsShape` still infers a precise literal type per key from the object
 * passed to `buildData`.
 */
declare type FieldsShape = Record<string, any>;

/** Everything the evidence says about one field. */
export declare interface FieldView {
    readonly id: string;
    readonly name: string;
    readonly scope: string;
    readonly classification?: string;
    /** Declared sources of the field's data. */
    readonly sources: readonly {
        readonly boundary: string;
        readonly boundaryName: string;
        readonly boundaryKind?: FlowBoundaryKind;
        readonly handling?: FlowHandling;
        readonly status: FlowStatus;
    }[];
    readonly destinations: readonly FieldDestination[];
    readonly discardedBy: readonly {
        readonly function: string;
        readonly functionName: string;
        readonly path: readonly string[];
    }[];
    readonly readers: readonly {
        readonly function: string;
        readonly functionName: string;
    }[];
    /** Ids of the claims about this field or a path inside it. */
    readonly claims: readonly string[];
    /** False when the field's trace touches something the analysis could not follow. */
    readonly complete: boolean;
}

/** Keeps matching nodes, the edges between them, and the unknowns that still apply. */
export declare function filterFlow(model: FlowModel, filter: FlowFilter): FlowView;

/**
 * Bump only when a reader could misinterpret the shape: same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: `LocatedFinding` no longer carries the flat `capability`/`field`/
 * `operation`/`position`/`indeterminateSites` locators alongside `location`,
 * `FindingLocationCapability.file` is now root-relative rather than
 * absolute, and every finding now carries a `family`.
 */
declare const FINDING_MODEL_SCHEMA_VERSION = 2;

/**
 * Where a finding points, as a discriminated union: never a formatted
 * string a consumer would have to parse back apart. Ships with only the
 * variants `findings.ts`'s actual emission sites produce today
 * (`"capability"`/`"field"`/`"consumer"`/`"none"`). `"operation"` is
 * included because `ReportFinding.operation` is already part of that
 * type's public shape, even though no current finding populates it. It is
 * trivially reachable the day one does, not a guess about what it would
 * look like. `"capability"`, `"field"` and `"operation"` carry an optional
 * `position` (ADR 0052): the declaration site, when the source
 * `ReportFinding.position` was set. `"consumer"` has none, since a *consuming
 * file* has no single declaration position.
 */
declare type FindingLocation = {
    readonly kind: "none";
} | {
    readonly kind: "capability";
    readonly capability: FindingLocationCapability;
    readonly position?: SourcePosition;
} | {
    readonly kind: "field";
    readonly capability: FindingLocationCapability;
    readonly field: readonly string[];
    readonly position?: SourcePosition;
    /**
     * Every candidate access site a `"FIELD_ACCESS_INDETERMINATE"` finding
     * could actually be about (ADR 0052): populated only for that code.
     * Lives here, on the one variant that can carry it, rather than as a
     * flat sibling of `location`: a field-level finding is the only kind
     * that ever has one. Spans potentially multiple consuming files, so
     * each entry carries its own `file` (`SourceLocation`, not only
     * `SourcePosition`).
     */
    readonly indeterminateSites?: readonly SourceLocation[];
} | {
    readonly kind: "operation";
    readonly capability: FindingLocationCapability;
    readonly operation: string;
    readonly position?: SourcePosition;
} | {
    readonly kind: "consumer";
    readonly capability: FindingLocationCapability;
    readonly source: string;
};

/** A finding's capability locator: shared by every `FindingLocation` variant except `"none"`. */
declare interface FindingLocationCapability {
    /** Root-relative POSIX path of the file declaring the capability: carried through verbatim from `CapabilityNode.file` (see `display-path.ts`). */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
}

/** `data-cap`'s Finding Model: every finding, with a structured, pre-computed `location`. */
declare interface FindingModel {
    /** Always `FINDING_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof FINDING_MODEL_SCHEMA_VERSION;
    /** Every finding, each with its `location` computed. */
    readonly findings: readonly LocatedFinding[];
}

/** The flat, pre-`location` locator properties a rule/scan emits a `ReportFinding` with: resolved into `FindingLocation` by `locationOf`, then dropped. */
declare type FlatLocators = "capability" | "field" | "operation" | "source" | "position" | "indeterminateSites";

/** Bump only when a renderer written for the previous shape could misread the new one. */
export declare const FLOW_GRAPH_VIEW_VERSION = 1;

/**
 * Bump only when a reader could misinterpret the shape: same discipline
 * every other model's schema-version constant already documents.
 */
declare const FLOW_MODEL_SCHEMA_VERSION = 1;

/** What a data-flow rule can name as a destination: the declared endpoint kinds, plus the two destinations only code analysis can see. */
export declare type FlowBoundaryKind = DataFlowEndpointKind | "client-response" | "log";

/** What was and was not analyzed: a projection must not call a graph complete unless `complete`. */
export declare interface FlowCoverage {
    /** Function nodes whose status is not `unknown`. */
    readonly functionsAnalyzed: number;
    /** Function nodes whose status is `unknown`. */
    readonly functionsUnanalyzed: number;
    /** Edges whose status is `unknown`. */
    readonly edgesUnresolved: number;
    /** Number of `FlowUnknown` records. */
    readonly unknowns: number;
    /** True only when nothing above is non-zero apart from `functionsAnalyzed`. */
    readonly complete: boolean;
}

/** Options shared by the diagram renderers. */
export declare interface FlowDiagramOptions {
    /** Draw only this field's flow (by name, for example `userData.user`). */
    readonly field?: string | undefined;
    /** Within `field`, draw only flow of this path (and of the whole field). */
    readonly path?: readonly string[] | undefined;
    /** Draw control-flow `calls` edges (default false: they obscure the data). */
    readonly includeCalls?: boolean | undefined;
}

/** What changed between two Flow Models, by content-addressed id. */
export declare interface FlowDiff {
    readonly addedNodes: readonly FlowNode[];
    readonly removedNodes: readonly FlowNode[];
    readonly changedNodes: readonly FlowNodeChange[];
    readonly addedEdges: readonly FlowEdge[];
    readonly removedEdges: readonly FlowEdge[];
    readonly addedUnknowns: readonly FlowUnknown[];
    readonly removedUnknowns: readonly FlowUnknown[];
    /** True when nothing was added, removed or changed. */
    readonly unchanged: boolean;
}

/** One edge of the Flow Model. */
export declare interface FlowEdge extends FlowEdgeInput {
    /** Content-addressed: `kind:from->to[:path]@status[^origin]`. */
    readonly id: string;
}

/** The one place an edge id is derived. Status is part of the id so a declared and a static record of one edge stay two records (ADR 0071). */
export declare function flowEdgeId(kind: FlowEdgeKind, from: string, to: string, path: readonly string[] | undefined, status: FlowStatus, origin?: string): string;

/** One edge as a producer supplies it: the id is derived, never supplied. */
declare interface FlowEdgeInput {
    readonly kind: FlowEdgeKind;
    /** Id of the source node. */
    readonly from: string;
    /** Id of the target node. */
    readonly to: string;
    readonly status: FlowStatus;
    /** The field path this edge carries, for a field-sensitive edge; absent for an edge about the whole value or about control. */
    readonly path?: readonly string[];
    /** Where in source this edge arises (a call site, a read), when known. */
    readonly source?: SourceLocation;
    /** The data-safety state of the value at this hop, when declared or established: policy evaluation reads it at boundary crossings. */
    readonly handling?: FlowHandling;
    /**
     * Id of the `field` node whose data this edge carries. Present on every
     * data-carrying edge the flow pass derives, so a helper shared by several
     * fields does not make each field appear to reach every other field's
     * destinations. Absent on edges that are not about one field's data (a
     * `calls` edge). `path` is expressed in the origin field's frame.
     */
    readonly origin?: string;
}

/**
 * What an edge means. Data moves `from` -> `to` along `reads`, `writes`,
 * `transforms`, `passes`, `returns` and `crosses-boundary`. `calls` is control
 * flow, and `discards` records that a function received a field and did not
 * forward it. Neither carries data, so tracing does not follow them.
 * `side-effect` links a function to the boundary it acts on.
 */
export declare type FlowEdgeKind = "reads" | "writes" | "transforms" | "discards" | "passes" | "returns" | "calls" | "crosses-boundary" | "side-effect";

/** One tag of the Flow Model. */
export declare interface FlowEdgeTag extends FlowEdgeTagInput {
    /** Content-addressed: `tag:via:edgeId@file:line:column`. */
    readonly id: string;
}

/** One tag as a producer supplies it: the id is derived, never supplied. */
export declare interface FlowEdgeTagInput {
    readonly via: FlowVia;
    /** Id of the existing edge that carries the data at this place (an edge id as `flowEdgeId` derives it). */
    readonly edge: string;
    /** Where the copy, the derivation or the hand-over is. */
    readonly source: SourceLocation;
    /** With `copy`: the value copied was already a fresh copy. */
    readonly fresh?: true;
    /** With `derive`: nothing ever reads the derived value. */
    readonly unused?: true;
}

/** Criteria for `filterFlow`; every supplied criterion must match. */
export declare interface FlowFilter {
    readonly kinds?: readonly FlowNodeKind[];
    readonly statuses?: readonly FlowStatus[];
    /** Exact `classification` match. */
    readonly classification?: string;
    /** Exact `scope` match (a root-relative file path, or a boundary namespace). */
    readonly scope?: string;
    /** Case-insensitive substring of the node name. */
    readonly nameIncludes?: string;
    /** Keep only edges with a path segment equal to this value (applied to edges, not nodes). */
    readonly edgePathIncludes?: string;
}

/** The graph view. */
export declare interface FlowGraphView {
    readonly schemaVersion: typeof FLOW_GRAPH_VIEW_VERSION;
    readonly coverage: FlowCoverage;
    readonly nodes: readonly ViewNode[];
    readonly edges: readonly ViewEdge[];
    readonly unknowns: readonly FlowUnknown[];
    readonly functions: readonly FunctionView[];
    readonly fields: readonly FieldView[];
    /** Counts of claims by verification status, when claims were derived. */
    readonly claims?: ClaimsModel["summary"];
    readonly statusLegend: readonly StatusLegendEntry[];
}

/** What the view reads from the Evidence Model. */
export declare type FlowGraphViewInput = Pick<EvidenceModel, "flow" | "claims">;

/** The declared data-safety state of a value at a boundary crossing: the vocabulary of `DataFlowEndpoint.handling` and of flow policy rules. */
export declare type FlowHandling = "plaintext" | "masked" | "redacted" | "hashed" | "encrypted";

/** `data-cap`'s Flow Model. */
export declare interface FlowModel {
    /** Always `FLOW_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof FLOW_MODEL_SCHEMA_VERSION;
    /** Every node, ordered by id. */
    readonly nodes: readonly FlowNode[];
    /** Every edge, ordered by id. */
    readonly edges: readonly FlowEdge[];
    /** Every explicit unknown, ordered by id. */
    readonly unknowns: readonly FlowUnknown[];
    /** What was and was not analyzed. */
    readonly coverage: FlowCoverage;
    /** What the scanner saw happen to the data of some edges, ordered by id. Absent when it saw nothing worth noting (ADR 0075). */
    readonly edgeTags?: readonly FlowEdgeTag[];
}

/** One node of the Flow Model. */
export declare interface FlowNode extends FlowNodeInput {
    /** Content-addressed: `kind:scope#name`. */
    readonly id: string;
}

/** A node whose content differs between two revisions under the same id. */
export declare interface FlowNodeChange {
    readonly before: FlowNode;
    readonly after: FlowNode;
}

/** The one place a node id is derived. */
export declare function flowNodeId(kind: FlowNodeKind, scope: string, name: string): string;

/** One node as a producer supplies it: the id is derived, never supplied. */
declare interface FlowNodeInput {
    readonly kind: FlowNodeKind;
    /** Root-relative POSIX path of the file that declares this node, or a stable namespace for a node with no file (a boundary). */
    readonly scope: string;
    /** Name unique within `scope` and `kind` (`buildUserProfile`, `buildUserProfile.user`, `User.email`). */
    readonly name: string;
    readonly status: FlowStatus;
    /** Declaration position within `scope`, when there is one. */
    readonly source?: SourcePosition;
    /** Declared or inherited sensitivity classification, when known: carried verbatim, never inferred here. */
    readonly classification?: string;
    /** What kind of boundary this is; only meaningful (and required by policy evaluation) on a `boundary` node. */
    readonly boundaryKind?: FlowBoundaryKind;
}

/** What a flow node is. */
export declare type FlowNodeKind = "function" | "parameter" | "return" | "field" | "boundary";

/** Which fields a rule applies to; every supplied criterion must match, and at least one is required. */
declare interface FlowPolicyAppliesTo {
    /** Exact match against a field node's `classification`. */
    readonly classification?: string | undefined;
    /** Exact match against a field node's `name` (for example `User.email`). */
    readonly field?: string | undefined;
    /** Restricts the rule to fields declared in this file (a root-relative path); never sufficient on its own. */
    readonly scope?: string | undefined;
    /** Narrows the rule to one path inside each matching field (for example `["passwordHash"]`): only flow of that path, or of the whole field, counts. */
    readonly path?: readonly string[] | undefined;
}

/** Which fields a data-flow rule governs; every supplied criterion must match, and `classification` or `field` is required. */
declare interface FlowPolicyAppliesToDocs {
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
declare interface FlowPolicyDocs {
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

/** One declared data-flow rule. At least one constraint must be set. */
declare interface FlowPolicyRule {
    /** Unique, stable identifier. */
    readonly id: string;
    /** Which fields this rule governs. */
    readonly appliesTo: FlowPolicyAppliesTo;
    /** Boundary kinds the governed fields must never reach. */
    readonly forbidDestinations?: readonly FlowBoundaryKind[] | undefined;
    /** If set, the only boundary kinds the governed fields may reach. */
    readonly allowedDestinations?: readonly FlowBoundaryKind[] | undefined;
    /** Handling that exempts a crossing from `forbidDestinations`/`allowedDestinations`. */
    readonly allowedHandling?: readonly FlowHandling[] | undefined;
    /** If set, every boundary crossing of a governed field must declare one of these handlings. */
    readonly requireHandling?: readonly FlowHandling[] | undefined;
    /** Free-text rationale, carried through verbatim. */
    readonly description?: string | undefined;
}

/** ADR 0071: the five epistemic statuses, shared by every flow fact, claim and finding. */
export declare type FlowStatus = "declared" | "static" | "observed" | "inferred" | "unknown";

/** Options for `renderFlowText`. */
export declare interface FlowTextOptions {
    /** Limit the output to one field (by its name, for example `userData.user`) and the functions that touch it. */
    readonly field?: string | undefined;
    /** Heading level of the title (default 1); sections nest below it, so the text can be embedded in a larger document. */
    readonly headingLevel?: number | undefined;
}

/** The result of `traceFlow`. */
export declare interface FlowTrace {
    /** Id of the node the trace started from. */
    readonly start: string;
    /** Which way data edges were followed. */
    readonly direction: FlowTraceDirection;
    /** Every visited node, ordered by id. */
    readonly nodes: readonly FlowNode[];
    /** Every traversed edge, ordered by id. */
    readonly edges: readonly FlowEdge[];
    /** Every explicit unknown attached to a visited node. */
    readonly unknowns: readonly FlowUnknown[];
    /** False when the trace crossed or touched any `unknown` fact: the real flow may reach further than shown. */
    readonly complete: boolean;
}

/** Which way to follow data edges from the start node. */
export declare type FlowTraceDirection = "upstream" | "downstream";

/** Options narrowing a trace. */
export declare interface FlowTraceOptions {
    /** Follow only hops whose edge path is related (equal, prefix, or extension) to this path; an edge with no path applies to every path. */
    readonly path?: readonly string[] | undefined;
    /** Follow only edges, and visit only nodes, with one of these statuses. */
    readonly statuses?: readonly FlowStatus[];
}

/** An explicit record that part of the program could not be analyzed. */
export declare interface FlowUnknown extends FlowUnknownInput {
    /** Content-addressed: `unknown:reason:file:line:column`. */
    readonly id: string;
}

/** A piece of capability-field data an unknown concerns: the field node and the path inside it. */
declare interface FlowUnknownData {
    /** Id of the `field` node the data comes from. */
    readonly origin: string;
    /** Path inside the field; `[]` is the whole field. */
    readonly path: readonly string[];
}

/** One unknown as a producer supplies it. */
declare interface FlowUnknownInput {
    readonly reason: FlowUnknownReason;
    /** Where the unanalyzable construct is. */
    readonly source: SourceLocation;
    /** The node this unknown prevents us from fully describing, when there is one. */
    readonly subject?: string;
    /** Human-readable detail (never parsed). */
    readonly detail?: string;
    /**
     * The tracked data that entered the part of the program that could not be
     * followed. Absent means "unknown which data": every trace that reaches
     * the subject must treat itself as incomplete. Present, it lets a trace of
     * a different field or an unrelated path stay complete: an opaque call that
     * only ever saw `email` says nothing about where `passwordHash` went.
     */
    readonly data?: readonly FlowUnknownData[];
}

/** Why a part of the program could not be analyzed (ADR 0053 citations apply to each). */
export declare type FlowUnknownReason = "dynamic-access" | "unresolved-call" | "unresolved-import" | "unsupported-construct" | "missing-source" | "unanalyzed-function";

/**
 * What the scanner saw happen to the data of an edge at one place, beyond what the edge says (ADR 0075).
 *
 * - `serialize-roundtrip`: the data was taken apart and put back together with nothing in between that reads it
 *   (`JSON.parse(JSON.stringify(x))`, `Object.fromEntries(Object.entries(x))`).
 * - `copy`: the data was copied and nothing was added, dropped or renamed (`structuredClone(x)`, `{ ...x }`,
 *   `[...x]`, `Array.from(x)`). `fresh` says the copied value was itself a copy made by one of these.
 * - `derive`: a value computed from the data was bound to a name that is never read (`unused`).
 * - `forward`: reserved for a producer that knows a function only hands the data on. The scanner does not emit it;
 *   forwarding chains are found from the edges alone, so no reader depends on this tag.
 */
export declare type FlowVia = "copy" | "serialize-roundtrip" | "forward" | "derive";

/** A filtered view: never mistakable for the whole graph. */
export declare interface FlowView {
    readonly nodes: readonly FlowNode[];
    readonly edges: readonly FlowEdge[];
    readonly unknowns: readonly FlowUnknown[];
    /** Nodes removed by the filter. */
    readonly hiddenNodes: number;
    /** Edges removed by the filter. */
    readonly hiddenEdges: number;
    /** True only when nothing was hidden and the source model was itself complete. */
    readonly complete: boolean;
}

/** A path of a field the function received and neither used nor forwarded. */
export declare interface FunctionDiscard {
    readonly origin: string;
    readonly field: string;
    readonly path: readonly string[];
}

/** Data a function sends across a boundary. */
export declare interface FunctionEffect {
    readonly boundary: string;
    readonly boundaryName: string;
    readonly boundaryKind?: FlowBoundaryKind;
    readonly origin: string;
    readonly field: string;
    readonly path: readonly string[];
    readonly handling?: FlowHandling;
    readonly status: FlowStatus;
}

/** Data a function hands on: to a parameter, as its return value, or transformed. */
export declare interface FunctionForward {
    readonly kind: "passes" | "returns" | "transforms";
    readonly to: string;
    readonly toName: string;
    readonly origin: string;
    readonly field: string;
    readonly path: readonly string[];
    readonly status: FlowStatus;
}

/** Data a function takes in. */
export declare interface FunctionRead {
    /** The field the data comes from. */
    readonly origin: string;
    readonly field: string;
    /** Path inside the field. */
    readonly path: readonly string[];
    /** How it arrived: read from the field itself, through a parameter, or as another function's return value. */
    readonly via: "field" | "parameter" | "return";
    /** Id of the node it arrived from. */
    readonly from: string;
    readonly status: FlowStatus;
}

/** Everything the evidence says about one function. */
export declare interface FunctionView {
    readonly id: string;
    readonly name: string;
    readonly scope: string;
    readonly status: FlowStatus;
    readonly source?: {
        readonly line: number;
        readonly column: number;
    };
    readonly inputs: readonly NodeRef[];
    readonly output?: string;
    readonly reads: readonly FunctionRead[];
    readonly forwards: readonly FunctionForward[];
    readonly sideEffects: readonly FunctionEffect[];
    readonly discards: readonly FunctionDiscard[];
    readonly callers: readonly NodeRef[];
    readonly callees: readonly NodeRef[];
    /** Distinct classifications of the fields whose data this function touches. */
    readonly classifications: readonly string[];
    /** The weakest status of the evidence behind this function; `inferred` when part of it could not be followed. */
    readonly confidence: FlowStatus;
    /** Ids of the explicit unknowns attached to this function. */
    readonly unknowns: readonly string[];
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
declare interface GetterDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields>> {
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
declare type InferFields<F extends FieldsShape> = {
    [K in keyof F]: InferFieldValue<F[K]>;
};

/**
 * Resolves the application-facing type for one declared field default.
 * Functions are never valid field values: a function-typed default
 * resolves to `never` (see fields.ts's runtime counterpart, which throws).
 */
declare type InferFieldValue<F> = F extends NullableMarker<infer Inner> ? InferFieldValue<Inner> | null : F extends OptionalMarker<infer Inner> ? InferFieldValue<Inner> | undefined : F extends readonly (infer Item)[] ? InferFieldValue<Item>[] : F extends Date | URL | RegExp ? F : F extends (...args: never[]) => unknown ? never : F extends object ? {
    [K in keyof F]: InferFieldValue<F[K]>;
} : F;

/** Identifies a capability in a report. */
declare interface LeastDataCapability {
    readonly file: string;
    readonly exportName: string;
}

/** Turns a `LeastDataReport` into report findings (family `flow`). */
export declare function leastDataFindings(report: LeastDataReport): ReportFinding[];

/** A field (or some of its paths) this analysis could not assess, and why. */
export declare interface LeastDataIndeterminate {
    readonly capability: LeastDataCapability;
    readonly field: string;
    readonly fieldNode: string;
    readonly reason: "flow-incomplete" | "not-analyzed";
    /** The single-key paths that could not be assessed; every other key of the field was. */
    readonly paths: readonly (readonly string[])[];
}

/** What `analyzeLeastData` reads: the same fields of the Evidence Model a projection over it would. */
declare interface LeastDataInput {
    readonly capability: CapabilityInventory;
    readonly flow: FlowModel;
}

/** The result of `analyzeLeastData`. */
export declare interface LeastDataReport {
    readonly unusedPaths: readonly UnusedPath[];
    readonly wholeFieldToClient: readonly WholeFieldToClient[];
    readonly indeterminate: readonly LeastDataIndeterminate[];
}

/** Bump only when a reader could misinterpret the shape: same discipline every other model's schema-version constant already documents. */
declare const LIFECYCLE_MODEL_SCHEMA_VERSION = 1;

/** `data-cap`'s Lifecycle Model: declared expiry/deprecation/rename data, plus the expiring-soon view. */
declare interface LifecycleModel {
    /** Always `LIFECYCLE_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof LIFECYCLE_MODEL_SCHEMA_VERSION;
    /** Only capabilities with at least one lifecycle-relevant field set, at the capability level or on at least one field. Sorted by `file` then `exportName`. */
    readonly capabilities: readonly LifecycleModelCapability[];
    /** Every capability-/field-level `expiresAt` within the configured window, soonest-first (already-expired entries sort first, since their `daysRemaining` is negative). */
    readonly expiring: readonly ExpiringEntry[];
}

/** One capability's declared lifecycle data, plus every lifecycle-bearing field under it. */
declare interface LifecycleModelCapability {
    /** Root-relative POSIX path: carried through verbatim from `CapabilityNode.file`. */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
    /** Declared ISO-8601 expiry for the capability as a whole. */
    readonly expiresAt: string | undefined;
    /** Whether the capability is documented as deprecated. */
    readonly deprecated: boolean | undefined;
    /** Why it's deprecated, when stated. */
    readonly deprecatedReason: string | undefined;
    /** Declared retention policy at the capability level. */
    readonly retention: string | undefined;
    /** Only fields with at least one lifecycle field set, sorted by path: same "only what's relevant" scope the rendered report uses. */
    readonly fields: readonly LifecycleModelField[];
}

/** One field's declared lifecycle data. Only fields with at least one of these set appear in the model at all. */
declare interface LifecycleModelField {
    /** The field's path within its capability: `readonly string[]`, matching every other model's field addressing (never a flat key string). */
    readonly path: readonly string[];
    /** Declared ISO-8601 expiry, unparsed and uninterpreted here. */
    readonly expiresAt: string | undefined;
    /** Whether the field is documented as deprecated. */
    readonly deprecated: boolean | undefined;
    /** Why it's deprecated, when stated. */
    readonly deprecatedReason: string | undefined;
    /** Declared ISO-8601 removal deadline: field-level only (see `core/document.ts`). */
    readonly removeBy: string | undefined;
    /** The field's previous name, when authored: what `ChangeModel.renamedFields` correlates against. */
    readonly renamedFrom: string | undefined;
    /** Declared retention policy: a policy statement, deliberately independent of `expiresAt`'s temporal constraint (a field can be retained long after its source credential expires, and vice versa). */
    readonly retention: string | undefined;
}

/**
 * One finding, with its structured `location` computed, and *only* that.
 * A rule/scan emits a `ReportFinding` carrying the raw, optional
 * `capability`/`field`/`operation`/`source`/`position`/`indeterminateSites`
 * locators (see `findings.ts`). `locationOf` resolves all six into one
 * required, structured `location`, and this type then drops them. So a
 * consumer has exactly one path to "where does this point". There is no
 * structured answer sitting next to six flat ones that say the same thing
 * (and could drift apart under a hand-constructed value). Two names for one
 * lineage: emit a `ReportFinding`, consume a `LocatedFinding`.
 */
declare type LocatedFinding = Omit<ReportFinding, FlatLocators> & {
    readonly location: FindingLocation;
};

declare type LooseCapabilityDocs = Loosen<Omit<CapabilityDocs<DataSchema<Record<string, unknown>>>, "fields" | "getters" | "mutators" | "subscriptions" | "evidence">> & {
    readonly fields?: Readonly<Partial<Record<string, Loosen<FieldDocs>>>> | undefined;
    readonly getters?: Readonly<Partial<Record<string, Loosen<OperationDocs>>>> | undefined;
    readonly mutators?: Readonly<Partial<Record<string, Loosen<OperationDocs>>>> | undefined;
    readonly subscriptions?: Readonly<Partial<Record<string, Loosen<OperationDocs>>>> | undefined;
    readonly evidence?: {
        readonly fields?: Readonly<Record<string, Loosen<EvidenceFieldDocs>>> | undefined;
    } | undefined;
};

/**
 * `CapabilityDocs` is parameterized by the real `documentData()` schema type
 * so authored calls get `keyof`-checked field/getter/mutator/subscription
 * names. This module (and `inventory.ts`/`link.ts`, which reuse this
 * exact type) deals only in already-parsed AST facts. It has no compile-time
 * schema of its own to check against. `LooseCapabilityDocs` is the build-
 * tool-internal equivalent of "structurally shaped like docs, unconstrained"
 * that the old bare `Record<string, unknown>` parameter gave. Every OTHER
 * property comes from `CapabilityDocs` itself (via `Omit`). But
 * `fields`/`getters`/`mutators`/`subscriptions` are redeclared as plain
 * `Record<string, X>` maps rather than routed through `CapabilityDocs`'
 * own `keyof`-checked generics. `DataSchema`'s `getters`/etc. are
 * themselves optional properties. Those resolve to "no keys allowed" (not
 * "any key allowed") once `CapabilityDocs` requires a concrete schema type.
 * That is exactly backwards from what an unconstrained AST-parsed fact needs here.
 */
/**
 * Every property here is always assigned (never conditionally omitted:
 * see extractCapabilityDocs()/extractOperationDocsMap()/
 * extractEvidenceFieldsMap() below). Some are assigned an `undefined`
 * value when the AST literal didn't declare it. exactOptionalPropertyTypes
 * distinguishes "key absent" from "key present holding undefined". This type
 * widens every property to explicitly include `| undefined` (rather than
 * routing every assignment through a conditional-spread "omit if absent"
 * instead). That matches what this type actually represents: a raw,
 * unconstrained parse result, not a validated CapabilityDocs.
 */
declare type Loosen<T> = {
    readonly [K in keyof T]?: T[K] | undefined;
};

/** One capability whose snapshot shape changed between two runs. */
declare interface ManifestCapabilityUpdate {
    /** The capability key (`file#exportName`) that changed. */
    readonly capability: string;
    /** Human-readable description of each individual change (e.g. `"owner changed from ... to ..."`). */
    readonly changes: readonly string[];
    /**
     * The same field-level diff `changes` describes in prose, as data. It gives
     * `ChangeModel`'s rename correlation a value to match, so no report has to
     * parse structure back out of its own prose. `changes` is unaffected and
     * still reads the same.
     */
    readonly fields: ManifestFieldDiff;
}

/** The diff between two `ManifestSnapshot`s, in a fixed Added/Removed/Updated shape. */
declare interface ManifestChangeReport {
    /** Capability keys present in the new snapshot but not the previous one. */
    readonly addedCapabilities: readonly string[];
    /** Capability keys present in the previous snapshot but not the new one. */
    readonly removedCapabilities: readonly string[];
    /** Capability keys present in both snapshots whose shape changed. */
    readonly updatedCapabilities: readonly ManifestCapabilityUpdate[];
}

/** The structured added/removed field-name diff for one changed capability. */
declare interface ManifestFieldDiff {
    /** Field names present now but not in the previous snapshot, sorted. */
    readonly added: readonly string[];
    /** Field names present in the previous snapshot but not now, sorted. */
    readonly removed: readonly string[];
}

/** The fewest functions in a chain for it to be a `forwarding-hop`. */
export declare const MIN_FORWARDING_HOPS = 3;

/**
 * A mutator operation: performs a side effect. `writes` is optional. Without it the mutator owns
 * the whole capability tree, bounded to the declared schema (ADR 0011), so the common case needs no
 * declaration.
 */
declare interface MutatorDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields> | undefined> {
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

/** A reference to a node by id and name. */
export declare interface NodeRef {
    readonly id: string;
    readonly name: string;
}

/** Produced by `fields.nullable(...)`: recognized only during `buildData`'s schema-authoring walk; the resolved runtime default is always `null`. */
declare interface NullableMarker<T> {
    /** Internal marker discriminant: see the module doc comment. */
    readonly [FIELD_MARKER]: "nullable";
    /** The declared inner default, kept only so the underlying type can be inferred: never the resolved runtime value. */
    readonly inner: T;
}

/** One aggregated observation. */
export declare interface Observation {
    /** Content-addressed: `observation:scope|kind:boundary|field|handling-or-dash`. */
    readonly id: string;
    readonly scope: string;
    readonly boundary: {
        readonly kind: FlowBoundaryKind;
        readonly name: string;
    };
    /** Capability-qualified dotted field path: the Flow Model's field-node naming. */
    readonly field: string;
    readonly handling?: FlowHandling;
    /** How many matching events were recorded. */
    readonly count: number;
    /** Earliest time any matching event carried (ISO 8601, UTC); absent when none carried one. Never used in the id. */
    readonly firstSeen?: string;
    /** Latest time any matching event carried; present exactly when `firstSeen` is. */
    readonly lastSeen?: string;
    /** Always `observed` (ADR 0071). */
    readonly status: "observed";
}

/** Bump only when a reader could misinterpret the shape. */
declare const OBSERVATION_MODEL_SCHEMA_VERSION = 1;

/** One observation: a field name was seen at a boundary during one scope. Never a value. */
declare interface ObservationEvent {
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

/** `data-cap`'s Observation Model. */
export declare interface ObservationModel {
    /** Always `OBSERVATION_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof OBSERVATION_MODEL_SCHEMA_VERSION;
    /** Every distinct scope that contributed at least one observation, sorted. */
    readonly scopes: readonly string[];
    /** Every observation, ordered by id. */
    readonly observations: readonly Observation[];
    /** First/last seen per scope, ordered by scope; absent when no event carried a time. */
    readonly scopeTimes?: readonly ObservationScopeTimes[];
    /** Events (and skip reports) dropped as malformed: stated, never silent. */
    readonly skipped: number;
    /** What the recorder reported leaving out, ordered by scope, field, reason; absent when it reported nothing. */
    readonly truncations?: readonly ObservationTruncation[];
    /** The scopes with a truncation, sorted: a claim built on one cannot be called verified near the cut. Absent when none. */
    readonly truncatedScopes?: readonly string[];
}

/**
 * First and last time anything was observed in one scope; only for scopes whose events carried times.
 *
 * @public Exported because a public type names it, so the published schema describes it.
 */
declare interface ObservationScopeTimes {
    readonly scope: string;
    readonly firstSeen: string;
    readonly lastSeen: string;
}

/** Reads the `data_cap.*` attributes off any OTLP/JSON traces payload. Spans that carry none are not data-cap's and are ignored. */
export declare function observationsFromOtlp(payload: unknown, options?: OtlpReadOptions): OtlpReadResult;

/** Why the walker did not record part of a value. */
declare type ObservationSkipReason = "dotted-key" | "max-depth" | "max-nodes" | "cycle";

/** Maps the observations to OTLP/JSON traces, or `undefined` when none were ingested. */
export declare function observationsToOtlp(evidence: OtlpInput, options?: OtlpOptions): OtlpTraces | undefined;

/**
 * Evidence the recorder knowingly left out in one scope: below `field` something was not captured. Names only.
 *
 * @public Exported because a public type names it, so the published schema describes it.
 */
declare interface ObservationTruncation {
    readonly scope: string;
    /** Capability-qualified dotted path below which evidence is missing (the capability itself for the root). */
    readonly field: string;
    readonly reason: ObservationSkipReason;
    /** How many times the recorder reported this (scope, field, reason). */
    readonly count: number;
}

/** What kind of boundary was crossed and its stable name (matches a `boundary` node of the Flow Model). */
declare interface ObservedBoundary {
    readonly kind: FlowBoundaryKind;
    readonly name: string;
}

/** What was witnessed. */
export declare interface ObservedFlow {
    /** Every scope that contributed any observation, whichever was selected. */
    readonly scopes: readonly string[];
    /** The nodes on a witnessed route, ordered by id. */
    readonly nodes: readonly FlowNode[];
    /** The edges on a witnessed route, ordered by id. */
    readonly edges: readonly FlowEdge[];
    /** Observations (in the selected scope) the static flow carries a route for. */
    readonly explained: readonly Observation[];
    /** Observations (in the selected scope) it does not. */
    readonly unexplained: readonly Observation[];
}

/** The witnessed part of `flow`, for one execution (`scope`) or for all of them. */
export declare function observedFlow(flow: FlowModel, observation: ObservationModel, scope?: string): ObservedFlow;

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
declare interface OperationDocs {
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

/** One getter/mutator/subscription operation, resolved from the inventory's shared model. */
declare interface OperationNode {
    /** Which kind of operation this is. */
    readonly kind: "getter" | "mutator" | "subscription";
    /** The operation's key name. */
    readonly name: string;
    /** This operation's own declared documentation, if any. */
    readonly docs: OperationDocs | undefined;
    /** Top-level field paths this operation's statically-extracted `writes` shape covers. Empty when `writes` was absent (on a getter/subscription) or unresolvable: never guessed at. */
    readonly writes: readonly (readonly string[])[];
    /** Whether this operation's config object literal declares a `processor` key: a proven, structural presence fact (never an evaluation of what the processor does; see ADR 0050). */
    readonly hasProcessor: boolean;
    /** Whether this operation's config object literal declares an `optimistic` key: structurally always `false` for a getter/subscription. */
    readonly hasOptimistic: boolean;
    /** Hoisted from `docs.endpoints` for convenient lookup: author-declared, never statically verified. */
    readonly endpoints: readonly DataFlowEndpoint[];
}

/** Produced by `fields.optional(...)`: recognized only during `buildData`'s schema-authoring walk; the resolved runtime default is always `undefined`. */
declare interface OptionalMarker<T> {
    /** Internal marker discriminant: see the module doc comment. */
    readonly [FIELD_MARKER]: "optional";
    /** The declared inner default, kept only so the underlying type can be inferred: never the resolved runtime value. */
    readonly inner: T;
}

/** The OSCAL assessment-results document, restricted to what this projection populates. */
export declare interface OscalAssessmentResults {
    readonly "assessment-results": {
        readonly uuid: string;
        readonly metadata: {
            readonly title: string;
            readonly "last-modified": string;
            readonly version: string;
            readonly "oscal-version": string;
            /** The shared evidence disclaimer: this document supports a review and establishes nothing by itself. */
            readonly remarks: string;
        };
        readonly "import-ap": {
            readonly href: string;
            readonly remarks?: string;
        };
        readonly results: readonly {
            readonly uuid: string;
            readonly title: string;
            readonly description: string;
            readonly start: string;
            readonly end: string;
            readonly props?: readonly {
                readonly name: string;
                readonly value: string;
            }[];
            readonly "reviewed-controls": {
                readonly "control-selections": readonly {
                    readonly description?: string;
                    readonly "include-controls"?: readonly {
                        readonly "control-id": string;
                    }[];
                }[];
            };
            readonly observations?: readonly {
                readonly uuid: string;
                readonly description: string;
                readonly methods: readonly ("EXAMINE" | "TEST")[];
                readonly types: readonly string[];
                readonly collected: string;
                readonly "relevant-evidence"?: readonly {
                    readonly href?: string;
                    readonly description: string;
                }[];
            }[];
            readonly findings?: readonly {
                readonly uuid: string;
                readonly title: string;
                readonly description: string;
                readonly target: {
                    readonly type: "objective-id" | "statement-id";
                    readonly "target-id": string;
                    readonly status: {
                        readonly state: "satisfied" | "not-satisfied";
                        readonly reason: "pass" | "fail" | "other";
                        readonly remarks?: string;
                    };
                };
                readonly "related-observations"?: readonly {
                    readonly "observation-uuid": string;
                }[];
            }[];
        }[];
        /** One resource per evidence reference, each resolving to the evidence file; present only with `evidenceHref`. */
        readonly "back-matter"?: {
            readonly resources: readonly {
                readonly uuid: string;
                readonly title: string;
                readonly description: string;
                readonly rlinks: readonly {
                    readonly href: string;
                    readonly "media-type": string;
                }[];
            }[];
        };
    };
}

/** What the projection reads from the Evidence Model. */
export declare type OscalInput = Pick<EvidenceModel, "flow" | "policy" | "claims" | "provenance">;

/** Options for `buildOscalAssessmentResults`. */
export declare interface OscalOptions {
    /**
     * data-cap rule id (as in `evidence.policy.rules[].id`, for example `userData/no-pii-to-log`) to
     * the control ids it is evidence for. Never inferred. A control id (`ac-4`) is targeted at its
     * assessment objective (`ac-4_obj`), the part id NIST's SP 800-53 OSCAL catalog gives it. An id
     * that already names a part (`ac-4_obj`, `ac-4_smt`, `ac-4_smt.a`) is targeted as given. Name
     * each objective once: `ac-4` and `ac-4_obj` are the same target and would give two findings.
     */
    readonly controls: Readonly<Record<string, readonly string[]>>;
    /** Document title (default `data-cap data-flow assessment`). */
    readonly title?: string | undefined;
    /**
     * `href` of the assessment plan this result imports. OSCAL requires one. Without it the document
     * carries the placeholder `#data-cap-assessment-plan` and says so in `import-ap.remarks`. That is
     * enough for review, and nothing an OSCAL tool-chain should resolve. See {@link strict}.
     */
    readonly assessmentPlan?: string | undefined;
    /**
     * `href` the evidence file is reachable at from where the document will live (for example
     * `docs/data.evidence.json`). With it, every evidence reference becomes a back-matter resource
     * with an `rlink`, and each observation's `relevant-evidence` points at that resource. Without
     * it the references stay descriptive text.
     */
    readonly evidenceHref?: string | undefined;
    /**
     * Refuse to build a document a tool-chain could not use: `true` requires {@link assessmentPlan}
     * and {@link evidenceHref}, and throws when either is missing. The default builds the reviewable
     * document with placeholders named as such.
     */
    readonly strict?: boolean | undefined;
}

/** An OTLP/JSON attribute. */
export declare interface OtlpAttribute {
    readonly key: string;
    readonly value: OtlpValue;
}

/** What the mapping reads from the Evidence Model. */
export declare type OtlpInput = Pick<EvidenceModel, "observation" | "provenance">;

/** Options for `observationsToOtlp`. */
export declare interface OtlpOptions {
    /** `service.name` of the resource (default `data-cap`). */
    readonly serviceName?: string | undefined;
    /**
     * Also emit one root span per scope (`data_cap.scope.root = "true"`), and point each observation span of that scope
     * at it with `parentSpanId`. The root spans the scope's first to last sighting when the scope carried times. Off by
     * default so the flat output stays byte-identical. The reader skips roots without counting them.
     */
    readonly scopeRoots?: boolean | undefined;
}

/** Options for `observationsFromOtlp`. */
export declare interface OtlpReadOptions {
    /** The most events one span's `data_cap.count` may expand to (default 10 000), so a hostile or buggy count cannot exhaust memory. */
    readonly maxEventsPerSpan?: number | undefined;
    /**
     * Also take `startTimeUnixNano`/`endTimeUnixNano` from spans NOT marked `data_cap.timed` (default false: such a
     * span's stamp is usually the exporter's own instant, not an observation time). The first event of a span gets the
     * start, the others the end. Only spans that carry the `data_cap.*` attributes are read at all. Invalid times are
     * ignored and counted in `ignoredTimes`.
     */
    readonly trustForeignTimes?: boolean | undefined;
}

/** What `observationsFromOtlp` read. */
export declare interface OtlpReadResult {
    readonly events: readonly ObservationEvent[];
    /** Spans that had some `data_cap.*` attributes but not a usable set, or a payload that was not OTLP traces at all. */
    readonly skipped: number;
    /** Start/end times that were read (the span was timed, or `trustForeignTimes` was set) but missing or not a decimal-nanosecond string; absent when none. */
    readonly ignoredTimes?: number;
}

/** An OTLP/JSON span, restricted to the fields this mapping populates. */
export declare interface OtlpSpan {
    readonly traceId: string;
    readonly spanId: string;
    readonly name: string;
    /** Present on a scope's observation spans when `scopeRoots` is on: the root span of that scope. */
    readonly parentSpanId?: string;
    /** `1` is SPAN_KIND_INTERNAL. */
    readonly kind: 1;
    readonly startTimeUnixNano: string;
    readonly endTimeUnixNano: string;
    readonly attributes: readonly OtlpAttribute[];
    /** `{ code: 1 }` is STATUS_CODE_OK. */
    readonly status: {
        readonly code: 1;
    };
}

/** An OTLP/JSON traces payload, restricted to the fields this mapping populates. */
export declare interface OtlpTraces {
    readonly resourceSpans: readonly {
        readonly resource: {
            readonly attributes: readonly OtlpAttribute[];
        };
        readonly scopeSpans: readonly {
            readonly scope: {
                readonly name: string;
                readonly version: string;
            };
            readonly spans: readonly OtlpSpan[];
        }[];
    }[];
}

/** An OTLP/JSON attribute value, restricted to the two kinds this mapping uses. */
export declare type OtlpValue = {
    readonly stringValue: string;
} | {
    readonly intValue: string;
};

/**
 * Narrows `DeepPartial<T>` down to exactly the keys `TOwnership` (a
 * `FieldOwnership<T>` value) permits, mirroring its shape one-for-one.
 * Take a `processor` or `optimistic` callback declared against
 * `writes: {user: {email: true}}`. It cannot type-check while returning
 * `{post: ...}`, or even `{user: {name: ...}}`, a sibling field it doesn't own. This narrows the *legal* shape at compile
 * time only. `resolveOperationPatch` still enforces the same boundary at runtime, since no type
 * proves what a processor actually returns.
 */
declare type OwnedPatch<T, TOwnership> = TOwnership extends true ? DeepPartial<T> : T extends readonly unknown[] ? never : T extends Date | URL | RegExp ? never : T extends object ? {
    [K in keyof TOwnership & keyof T]?: OwnedPatch<T[K], TOwnership[K]>;
} : never;

/** Bump only when a reader could misinterpret the shape: same discipline every other model's schema-version constant already documents. Bumped 1 -> 2: `OwnershipCapabilityRef.file` is now root-relative, not absolute. */
declare const OWNERSHIP_MODEL_SCHEMA_VERSION = 2;

/** Identifies one capability by where it's declared. */
declare interface OwnershipCapabilityRef {
    /** Root-relative POSIX path of the file declaring this capability: carried through verbatim from `CapabilityNode.file` (see `display-path.ts`). */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
}

/** Identifies one field, owned by a specific capability. */
declare interface OwnershipFieldRef {
    /** The capability that owns this field. */
    readonly capability: OwnershipCapabilityRef;
    /** The field's path within its capability. */
    readonly field: readonly string[];
}

/** One owner's row in the ownership matrix: every capability and field they're accountable for. */
declare interface OwnershipMatrixEntry {
    /** The owner's name, or `UNOWNED`. */
    readonly owner: string;
    /** Capabilities this owner is accountable for at the capability level. */
    readonly capabilities: readonly OwnershipCapabilityRef[];
    /** Individual fields (on capabilities not wholly owned by this owner) they're accountable for. */
    readonly fields: readonly OwnershipFieldRef[];
}

/** `data-cap`'s Ownership Model: the owner -> {capabilities, fields} matrix, versioned for JSON publication. */
declare interface OwnershipModel {
    /** Always `OWNERSHIP_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof OWNERSHIP_MODEL_SCHEMA_VERSION;
    /** Every owner's row: see `buildOwnershipMatrix`. */
    readonly entries: readonly OwnershipMatrixEntry[];
}

/** The result of parsing a rules document. */
export declare type ParsedEvidenceRules = {
    readonly ok: true;
    readonly rules: EvidenceRules;
} | {
    readonly ok: false;
    readonly errors: readonly string[];
};

/** Parses a rules document (JSON text), rejecting anything it does not fully understand. */
export declare function parseEvidenceRules(text: string): ParsedEvidenceRules;

/** A recoverable issue found while statically parsing or linking one capability file: never fatal, always surfaced to the caller as data. */
declare interface ParseWarning {
    /** Absolute path (or synthetic label, e.g. `"(package) name"`) the warning applies to. */
    readonly file: string;
    /** Human-readable explanation of what was skipped and why. */
    readonly message: string;
}

/** Bump only when a reader could misinterpret the shape. */
declare const POLICY_MODEL_SCHEMA_VERSION = 1;

/** Why a result is `indeterminate`. */
declare type PolicyIndeterminateReason = "rule-matches-nothing" | "trace-incomplete" | "handling-not-declared" | "boundary-kind-unknown";

/** `data-cap`'s Policy Model. */
export declare interface PolicyModel {
    /** Always `POLICY_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof POLICY_MODEL_SCHEMA_VERSION;
    /** The declared rules, ordered by id. */
    readonly rules: readonly FlowPolicyRule[];
    /** Every evaluation result, ordered by rule, subject, boundary. */
    readonly results: readonly PolicyResult[];
    /** Counts by outcome. */
    readonly summary: PolicySummary;
}

/** How a rule fared against one field (and, when relevant, one boundary). */
export declare type PolicyOutcome = "satisfied" | "violated" | "indeterminate";

/** One evaluation result. */
export declare interface PolicyResult {
    readonly ruleId: string;
    /** Id of the field node the rule was evaluated for; absent only for `rule-matches-nothing`. */
    readonly subject?: string;
    /** Id of the boundary node this result concerns; absent when none was reached or the result is about the trace as a whole. */
    readonly boundary?: string;
    readonly outcome: PolicyOutcome;
    /** Present exactly when `outcome` is `indeterminate`. */
    readonly reason?: PolicyIndeterminateReason;
    /** The weakest epistemic status of the edges the result rests on (`unknown` for an indeterminate result). */
    readonly basis: FlowStatus;
    /** Ids of the edges on the path that justifies this result. */
    readonly edges: readonly string[];
}

/** Counts by outcome. */
declare interface PolicySummary {
    readonly satisfied: number;
    readonly violated: number;
    readonly indeterminate: number;
}

/** A PROV-JSON document, restricted to the sections this projection populates. */
export declare interface ProvDocument {
    readonly prefix: Readonly<Record<string, string>>;
    readonly entity: Record<string, Attributes>;
    readonly activity: Record<string, Attributes>;
    readonly agent: Record<string, Attributes>;
    readonly used?: Record<string, Attributes>;
    readonly wasGeneratedBy?: Record<string, Attributes>;
    readonly wasDerivedFrom?: Record<string, Attributes>;
    readonly wasAssociatedWith?: Record<string, Attributes>;
    readonly wasInformedBy?: Record<string, Attributes>;
}

/** What the projection reads from the Evidence Model. */
export declare type ProvInput = Pick<EvidenceModel, "flow" | "claims" | "observation" | "provenance">;

/** One redundant transformation of the data of one field. */
export declare interface RedundantTransform {
    readonly kind: RedundantTransformKind;
    /** The capability the field belongs to. */
    readonly capability: LeastDataCapability;
    /** The field's top-level name. */
    readonly field: string;
    /** Id of the field's node in the Flow Model. */
    readonly fieldNode: string;
    /** The paths inside the field that are handled redundantly (`[]` is the whole field), sorted. */
    readonly paths: readonly (readonly string[])[];
    /** Where it happens: the copy, the derivation, or the call that starts a forwarding chain. */
    readonly source?: SourceLocation;
    /** For `forwarding-hop`: the ids of the function nodes that only hand the data on, in order, then the function that finally does something with it. Empty otherwise. */
    readonly hops: readonly string[];
    /** Ids of the flow edges this rests on, sorted. */
    readonly edges: readonly string[];
    /** For `round-trip`: how the data was taken apart and put back, `serialized` or `copied`. */
    readonly via?: "serialized" | "copied";
}

/** Turns redundant transformations into report findings (family `flow`, always `info`: this analysis alone never fails a build). */
export declare function redundantTransformFindings(items: readonly RedundantTransform[], flow: FlowModel): ReportFinding[];

/** The kinds of redundant transformation. */
export declare type RedundantTransformKind = "round-trip" | "forwarding-hop" | "dead-derivation";

/** One added-field/removed-field pair correlated into a single rename via the current declaration's `renamedFrom`. */
declare interface RenamedField {
    /** The owning capability's key (`file#exportName`): a rename never crosses capabilities. */
    readonly capability: string;
    /** The field's name before the rename: matches a `removed` entry in that capability's own field diff. */
    readonly previousName: string;
    /** The field's name after the rename: matches an `added` entry in the same diff. */
    readonly currentName: string;
}

/** `buildCycloneDxBom` serialized as stable, indented JSON with a trailing newline, or `undefined` when no flow was computed. */
export declare function renderFlowCycloneDx(evidence: CycloneDxInput, options?: CycloneDxOptions): string | undefined;

/** Renders DOT, or `undefined` when no flow was computed. */
export declare function renderFlowDot(evidence: DiagramInput, options?: FlowDiagramOptions): string | undefined;

/** Renders a Mermaid flowchart, or `undefined` when no flow was computed. */
export declare function renderFlowMermaid(evidence: DiagramInput, options?: FlowDiagramOptions): string | undefined;

/** Renders the graph as Markdown, or `undefined` when no flow was computed. */
export declare function renderFlowText(evidence: FlowGraphViewInput, options?: FlowTextOptions): string | undefined;

/**
 * One reportable fact about the discovered capability graph. `severity` is
 * assigned by the rule that produces the finding, following the two
 * governing invariants in `AGENTS.md`. Static analysis never infers a
 * relationship from insufficient evidence (an ambiguous case is `info` or
 * `indeterminate`-flavored, never guessed at as `error`). A finding
 * built from declared metadata (e.g. a missing `protections` field) never
 * claims more than "documented" vs. "not documented."
 */
declare interface ReportFinding {
    /** Which kind of fact this finding reports. */
    readonly code: ReportFindingCode;
    /** Which analysis pass produced this finding: see `ReportFindingFamily`. */
    readonly family: ReportFindingFamily;
    /** How strongly this finding should be treated. */
    readonly severity: ReportSeverity;
    /** Human-readable explanation of the finding. */
    readonly message: string;
    /** The capability this finding is about, if any. */
    readonly capability?: {
        /** Absolute path of the file declaring the capability. */
        readonly file: string;
        /** The binding name the capability is exported as. */
        readonly exportName: string;
    };
    /** The field path this finding is about, if any. */
    readonly field?: readonly string[];
    /** The operation name this finding is about, if any. */
    readonly operation?: string;
    /** The consuming file, for usage-scan-derived findings only. */
    readonly source?: string;
    /** Position of the declaration site (capability's own call, or field's own key) this finding is anchored to, when one is available: see ADR 0052. Additive: absent for findings with no single declaration-site anchor (e.g. a usage-scan finding whose subject is a consuming file, not a declaration). */
    readonly position?: SourcePosition;
    /**
     * The records in the Evidence Model this finding rests on: flow nodes and edges, a policy result, an unknown
     * (ADR 0070). Lets a reader drill from the finding to the analysis behind it, and lets SARIF show the path.
     * Absent for findings derived from declared metadata alone.
     */
    readonly evidence?: readonly EvidenceRef[];
    /** Every candidate access site a `"FIELD_ACCESS_INDETERMINATE"` finding could actually be about: populated only for that code. Spans potentially multiple consuming files, so each entry carries its own `file` (`SourceLocation`, not only `SourcePosition`). */
    readonly indeterminateSites?: readonly SourceLocation[];
}

/** Every kind of fact a static rule or usage-scan/data-flow pass can report. */
declare type ReportFindingCode = "CAPABILITY_MISSING_OWNER" | "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS" | "SENSITIVE_FIELD_MISSING_PROTECTIONS" | "SENSITIVE_FIELD_MISSING_PURPOSE" | "SENSITIVE_FIELD_MISSING_LEGAL_BASIS" | "AUDIT_REQUIRED_WITHOUT_OWNER" | "NONSTANDARD_SENSITIVITY_LEVEL" | "EXCLUSIVE_GROUP_VIOLATION" | "MANIFEST_EXPORT_NAME_COLLISION" | "DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES" | "DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES" | "ABANDONED_CAPABILITY" | "UNCONSUMED_FIELD" | "FIELD_ACCESS_INDETERMINATE" | "FIELD_DYNAMIC_ACCESS_DECLARED" | "MISSING_DYNAMIC_ACCESS_CITATION" | "STALE_DYNAMIC_ACCESS_CITATION" | "UNRESOLVED_CONSUMER" | "INDETERMINATE_CONSUMER" | "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY" | "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING" | "LEAST_DATA_UNUSED_PATH" | "LEAST_DATA_UNUSED_SENSITIVE_PATH" | "LEAST_DATA_WHOLE_FIELD_TO_CLIENT" | "LEAST_DATA_ANALYSIS_INDETERMINATE" | "LEAST_DATA_REDUNDANT_TRANSFORM" | "FLOW_POLICY_VIOLATED" | "FLOW_POLICY_INDETERMINATE" | "FLOW_ANALYSIS_INCOMPLETE";

/**
 * Which analysis pass a finding came out of: an orthogonal axis to
 * `severity` (how much it matters) and `code` (exactly what it is).
 *
 * This is what makes the `--strict*` flags' own groupings legible in the
 * output rather than only in the orchestrator's source: `--strict-docs`
 * escalates `"governance"`/`"structural"`/`"citation"`, `--strict-ownership`
 * escalates `"usage"`, `--strict-flow` escalates `"flow"`. With `family`, a
 * consumer filters a report ("only what a usage scan proved") by one stable
 * field, instead of a hand-kept list of `ReportFindingCode`s.
 *
 * Deliberately assigned at the emission site, never derived from `code` by a
 * lookup table. The rule that produces a finding is the only thing that
 * actually knows which pass it belongs to. A table would be a second
 * source of truth to drift out of sync (the same reasoning that keeps
 * `severity` at the emission site).
 */
declare type ReportFindingFamily = 
/** Declared-metadata quality: ownership, sensitivity, purpose, legal basis, audit trail (`static-rules.ts`). */
"governance"
/** The shape of the capability graph itself: exclusive-group conflicts, duplicate field shapes/endpoints, manifest export collisions. */
| "structural"
/** Requires a real usage scan to conclude anything: abandoned capabilities, unconsumed fields, consumer resolution (`usage-report.ts`). */
| "usage"
/** A developer-supplied `dynamicAccess` citation's own current integrity (`citation-verification.ts`). */
| "citation"
/** Data-flow boundary crossings for sensitive fields (`flow-graph.ts`), and everything the flow pass derives: declared flow policies, least-data analysis, and what the analysis could not follow (ADR 0070). */
| "flow";

/** How strongly a finding should be treated: `info` never blocks, `warning` blocks only under `--strict*`, `error` always blocks. */
declare type ReportSeverity = "info" | "warning" | "error";

/**
 * One resolved governance value plus its provenance (ADR 0057). It is the one path a
 * `FieldNode` consumer reads for a governed property, instead of checking a resolved
 * property and `field.docs.X` separately. `declaredOn: undefined` means neither the
 * field nor its capability declared a value at all (`value` is then also
 * `undefined`).
 */
declare interface ResolvedGovernanceValue<T> {
    /** The effective value: the field's own declaration, else the capability's. */
    readonly value: T | undefined;
    /** Where `value` came from. */
    readonly declaredOn: "field" | "capability" | undefined;
}

/** Bump only when a reader could misinterpret the shape: same discipline every other model's schema-version constant already documents. */
declare const RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION = 1;

/** `data-cap`'s Runtime Contract Model: the package's own documented execution guarantees. */
declare interface RuntimeContractModel {
    /** Always `RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION;
    /** The `data-cap` package version this model describes: read from `package.json`, the same way `cli/json.ts`'s `TOOL_VERSION` is. */
    readonly packageVersion: string;
    /** Every documented runtime policy fact. */
    readonly policies: readonly RuntimePolicyFact[];
}

/** One documented runtime guarantee, traced to the ADR that governs it. */
declare interface RuntimePolicyFact {
    /** A short, stable identifier for this fact (e.g. `"getter-concurrency"`). */
    readonly key: string;
    /** Human-readable statement of the guarantee. */
    readonly statement: string;
    /** The ADR number (e.g. `"0024"`) that governs this fact: always a real file under `specs/decisions/`. */
    readonly governingAdr: string;
    /** The source file that implements this guarantee, root-relative. */
    readonly module: string;
}

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

/** A `SourcePosition` plus the file it's in, for anywhere the file isn't already implied by the surrounding structure (e.g. a finding's list of candidate sites spanning multiple files). */
declare interface SourceLocation extends SourcePosition {
    readonly file: string;
}

/** A 1-based line/column within a file already known from context (e.g. `DependencyEdge.from`). */
declare interface SourcePosition {
    readonly line: number;
    readonly column: number;
}

/** The meaning of each epistemic status (ADR 0071), for a legend. */
export declare interface StatusLegendEntry {
    readonly status: FlowStatus;
    readonly meaning: string;
}

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
declare interface SubscriptionDefinition<TFields, TParams, TEvent, TWrites extends FieldOwnership<TFields>> {
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
declare interface SubscriptionEventHandlers<TEvent> {
    /** Call with each incoming event; committed through `processor` into a `writes`-bounded fields patch. */
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
 * Follows data edges from `start` in `direction`, breadth-first, terminating
 * on cycles. Downstream from a `field` node follows only that field's own
 * data (edge `origin`, ADR 0070). Upstream collects, for every field whose
 * downstream flow reaches `start`, the edges of that flow that lead to
 * `start`, plus any declared source feeding that field.
 */
export declare function traceFlow(model: FlowModel, start: string, direction: FlowTraceDirection, options?: FlowTraceOptions): FlowTrace;

/**
 * The part of a downstream flow from `start` that lies on some route to `target`: the nodes reachable from `start`
 * that can also reach `target`, and the edges between them. Empty when `target` is not reached. Follows the same
 * rules as `traceFlow` downstream (a field start carries only its own data; `options.path` narrows it).
 */
export declare function traceFlowBetween(model: FlowModel, start: string, target: string, options?: FlowTraceOptions): FlowTrace;

/** A top-level shape key of a field that nothing uses. */
export declare interface UnusedPath {
    readonly capability: LeastDataCapability;
    /** The field's top-level key. */
    readonly field: string;
    /** Id of the field's node in the Flow Model. */
    readonly fieldNode: string;
    /** Always a single-key path: the unused key. */
    readonly path: readonly string[];
    /** The field's resolved sensitivity, when declared. */
    readonly sensitivity: string | undefined;
    /** Names of the declared input endpoints of the operations that write this field: where a tighter projection could be applied. */
    readonly fetchedFrom: readonly string[];
}

/** An edge, as the Flow Model records it. */
export declare interface ViewEdge {
    readonly id: string;
    readonly kind: FlowEdgeKind;
    readonly from: string;
    readonly to: string;
    readonly status: FlowStatus;
    readonly path?: readonly string[];
    readonly origin?: string;
    readonly handling?: FlowHandling;
    readonly source?: {
        readonly file: string;
        readonly line: number;
        readonly column: number;
    };
}

/** A node, with a display label. */
export declare interface ViewNode {
    readonly id: string;
    readonly kind: FlowNodeKind;
    /** Short text for a diagram: the parameter name, `return`, `kind: name` for a boundary, the name otherwise. */
    readonly label: string;
    readonly name: string;
    readonly scope: string;
    readonly status: FlowStatus;
    readonly classification?: string;
    readonly boundaryKind?: FlowBoundaryKind;
    readonly source?: {
        readonly line: number;
        readonly column: number;
    };
}

/** A whole multi-key field sent to a client response. */
export declare interface WholeFieldToClient {
    readonly capability: LeastDataCapability;
    readonly field: string;
    readonly fieldNode: string;
    /** Id of the boundary node. */
    readonly boundary: string;
    readonly boundaryName: string;
    /** Every top-level key of the field's declared shape, all of which go to the client. */
    readonly keys: readonly string[];
    /** Ids of the edges that send the whole value. */
    readonly edges: readonly string[];
}

export { }
