import ts from 'typescript';

/** One changed capability's known current consumers. */
export declare interface BlastRadiusEntry {
    /** The capability key (`file#exportName`) -- matches `ManifestChangeReport`'s own key convention. */
    readonly capability: string;
    /** Distinct consuming files known (from Dependency Model) to depend on this capability right now, sorted. */
    readonly consumers: readonly string[];
}

/**
 * Projects a manifest diff (optionally combined with the current run's
 * Dependency Model) into `data-cap`'s Change Model. Pure -- takes
 * already-computed inputs, no filesystem access. `capabilities` is only
 * consulted when `dependencyModel` is supplied (it's what
 * `groupEdgesByCapability` needs to find a changed capability's current
 * consumers).
 */
export declare function buildChangeModel(manifest: ManifestChangeReport, capabilities: readonly ChangeModelCapability[], dependencyModel?: DependencyModel): ChangeModel;

/**
 * Computes this run's citation snapshots -- one `CitationSnapshotEntry` per
 * currently-declared citation that resolves to a real, readable file under
 * `root`. A capability with no declared citations at all is simply absent
 * from the returned map (never an empty-object placeholder).
 */
export declare function buildCitationSnapshots(inventory: CapabilityInventory, root: string, fs: BuildFileSystem): Promise<ReadonlyMap<string, Readonly<Record<string, readonly CitationSnapshotEntry[]>>>>;

/** `buildData`'s own config shape: fields only, nothing else. */
declare interface BuildDataConfig<TFields extends FieldsShape> {
    /** The default/example value for every field, declaring the capability's shape. */
    readonly fields: TFields;
}

/**
 * Projects already-scanned `edges` into `data-cap`'s Dependency Model. Pure
 * -- takes already-computed edges as input, no filesystem access, same
 * contract `buildFlowGraph`/`deriveUsageFindings` already follow.
 */
export declare function buildDependencyModel(edges: readonly DependencyEdge[]): DependencyModel;

/** One directory entry from {@link BuildFileSystem.readdir} -- the subset of Node's `Dirent` `src/build/**` reads. */
export declare interface BuildDirent {
    readonly name: string;
    readonly isDirectory: () => boolean;
    readonly isFile: () => boolean;
}

/** Composes `models` (plus always-available Runtime Contract Model) and `provenance` into `data-cap`'s Evidence Model. */
export declare function buildEvidenceModel(models: EvidenceModelInputs, provenance: EvidenceProvenance): EvidenceModel;

/**
 * The filesystem capability `data-cap/build` requires from its caller.
 *
 * `./build` is a **library surface**: it must not acquire filesystem access
 * implicitly (no `node:fs` import anywhere under `src/` outside `src/cli/`).
 * Every public options object in `build/index.ts` carries a required `fs`
 * field of this type, and the caller supplies a concrete adapter -- the
 * `data-cap` CLI builds one over `node:fs/promises` (`src/cli/filesystem.ts`);
 * a test builds either that same real adapter or an in-memory fake. See ADR
 * 0058.
 *
 * "Ambient-fs-free" means specifically: `./build` never reaches for
 * `node:fs` itself. It still performs real filesystem operations -- the
 * capability is always handed in.
 *
 * The shape is modeled on `node:fs/promises`'s own signatures so a thin
 * adapter is a drop-in value, but uses minimal structural types
 * ({@link BuildDirent}/{@link BuildStats}) rather than Node's `Dirent`/
 * `Stats` -- the capability boundary shouldn't leak Node's type surface just
 * because the concrete adapter happens to be Node-backed. Only the
 * operations `src/build/**` actually calls are here.
 *
 * **Not shared with `@maverickcer/env-cap`.** The two packages are
 * independent products with no runtime coupling; a shared types package to
 * dedupe six signatures would add real cross-package coupling for negligible
 * benefit. env-cap has its own, structurally-identical interface.
 */
export declare interface BuildFileSystem {
    /** Read a UTF-8 text file. Rejects if the path doesn't exist or isn't readable. */
    readonly readFile: (path: string, encoding: "utf8") => Promise<string>;
    /** Write a UTF-8 text file, creating or truncating it. The parent directory must already exist. */
    readonly writeFile: (path: string, data: string, encoding: "utf8") => Promise<void>;
    /** Create a directory and every missing parent. A no-op if it already exists. */
    readonly mkdir: (path: string, options: {
        readonly recursive: true;
    }) => Promise<void>;
    /** List a directory's entries with their file-type info. */
    readonly readdir: (path: string, options: {
        readonly withFileTypes: true;
    }) => Promise<readonly BuildDirent[]>;
    /** Stat a path (following symlinks). Rejects if the path doesn't exist. */
    readonly stat: (path: string) => Promise<BuildStats>;
    /** Resolve a path to its canonical, symlink-free absolute form. */
    readonly realpath: (path: string) => Promise<string>;
}

/** Projects `findings` into `data-cap`'s Finding Model, replacing each finding's flat locators with one structured `location`. */
export declare function buildFindingModel(findings: readonly ReportFinding[]): FindingModel;

/** Builds the per-field flow graph and the trust-boundary findings it makes derivable. */
export declare function buildFlowGraph(inventory: CapabilityInventory, edges: readonly DependencyEdge[]): FlowGraph;

/**
 * Builds the `CapabilityInventory` from an already-discovered `LinkResult`
 * -- the one shared model every report generator (Phase C) reads from, and
 * the boundary where each capability's absolute discovery path becomes the
 * root-relative `file` every downstream model publishes (OUT-01). The root
 * comes from `linkResult.root` -- the same one linking itself resolved
 * against -- so the two can never disagree.
 */
export declare function buildInventory(linkResult: LinkResult): CapabilityInventory;

/**
 * Projects `inventory` into `data-cap`'s Lifecycle Model. Pure -- a
 * projection over an already-built inventory, never a second scan, which is
 * why `EvidenceModel` can populate `lifecycle` unconditionally alongside
 * `capability` rather than gating it on an opt-in pass the way
 * `dependency`/`ownership` are gated on a usage scan.
 *
 * `now` is a parameter, never `new Date()` read in here: every time-
 * sensitive computation in one run must agree on the same instant, and a
 * caller-supplied clock is also what makes this testable without freezing
 * time globally.
 */
export declare function buildLifecycleModel(inventory: CapabilityInventory, expiringWithinDays: number, now: Date): LifecycleModel;

/** Builds a deterministic snapshot of the current inventory -- every capability included, active or not (so deactivating a capability is a detectable, diffable change, not a silent disappearance). */
export declare function buildManifestSnapshot(inventory: CapabilityInventory): ManifestSnapshot;

/** Projects every capability's field shape (plus its operations, as a vendor extension) into an OpenAPI-compatible schema document. */
export declare function buildOpenApiSchemaArtifact(inventory: CapabilityInventory, info: {
    readonly title: string;
    readonly version: string;
}): OpenApiSchemaArtifact;

/** Builds the owner -> {capabilities, fields} matrix. Every owner bucket is sorted deterministically; the `UNOWNED` bucket, if present, always sorts last. */
export declare function buildOwnershipMatrix(inventory: CapabilityInventory): readonly OwnershipMatrixEntry[];

/** Projects `inventory` into `data-cap`'s Ownership Model. */
export declare function buildOwnershipModel(inventory: CapabilityInventory): OwnershipModel;

/**
 * Builds `data-cap`'s Runtime Contract Model. Takes no consumer-project
 * argument -- unlike the other six models, this one describes the
 * `data-cap` package itself, and is identical for every caller on the same
 * package version.
 */
export declare function buildRuntimeContractModel(): RuntimeContractModel;

/** Projects Finding Model into a SARIF 2.1.0 log. */
export declare function buildSarifLog(findingModel: FindingModel): SarifLog;

/** A path's stat info from {@link BuildFileSystem.stat} -- the subset of Node's `Stats` `src/build/**` reads. */
export declare interface BuildStats {
    readonly isFile: () => boolean;
    /** Size in bytes -- read by the package-schema resolver to enforce a size ceiling. */
    readonly size: number;
}

/**
 * Capability Model's schema version (ADR 0050) -- `CapabilityInventory` is
 * both. Bumped only when a reader could misinterpret the shape (a field
 * changes type/meaning, or is removed), never for a purely additive field --
 * the same discipline `MANIFEST_SNAPSHOT_SCHEMA_VERSION`
 * (manifest-snapshot.ts) and `JSON_SCHEMA_VERSION` (cli/json.ts) already
 * document. Bumped 1 -> 2 by ADR 0057: `CapabilityNode`'s six governance properties
 * moved to `docs` only; `FieldNode`'s six moved from a bare value to
 * `ResolvedGovernanceValue<T>` (`{value, declaredOn}`). Bumped 2 -> 3 by
 * OUT-01: `CapabilityNode.file` is now root-relative, not absolute.
 */
export declare const CAPABILITY_MODEL_SCHEMA_VERSION = 3;

declare interface CapabilityDocs<TSchema extends DataSchema<FieldsShape>> {
    /** Display name -- falls back to the export/binding name when omitted. */
    readonly name?: string;
    /** Why this capability exists / what it's for. */
    readonly description?: string;
    /** Who's accountable for this capability. A field's own `owner` (see `FieldDocs`) overrides this for that field specifically. */
    readonly owner?: string;
    /** Free-form classification -- never validated. */
    readonly category?: string;
    /** Mutual-exclusivity group: more than one *active* capability sharing this value is a real conflict (only one implementation of a group should be live at once). */
    readonly exclusiveGroup?: string;
    /** Defaults to `true` when omitted. Gates `exclusiveGroup` conflict checks and manifest membership. */
    readonly active?: boolean;
    /** Data classification. Standard vocabulary: `"public"` / `"internal"` / `"confidential"` / `"restricted"` (ascending) -- custom values are allowed but flagged as non-standard, never blocking. */
    readonly sensitivity?: string;
    /** Documented safeguard -- presence only, never an adequacy claim. */
    readonly protections?: string;
    /** Documented retention policy -- presence only, never an enforcement claim. */
    readonly retention?: string;
    /**
     * The declared reason this capability's data is collected/retained.
     * Declared only -- data-cap never verifies the stated purpose matches
     * actual usage. A field's own `purpose` (see `FieldDocs`) overrides this
     * for that field specifically.
     */
    readonly purpose?: string;
    /**
     * The declared legal basis asserted for processing this capability's data
     * (e.g. `"consent"`, `"contract"`, `"legitimate interest"`). Records that
     * a basis was declared -- never that data-cap has determined the basis is
     * legally valid; data-cap records declared governance facts, it does not
     * determine whether those facts satisfy a law. A field's own `legalBasis`
     * overrides this for that field specifically.
     */
    readonly legalBasis?: string;
    /**
     * The declared jurisdiction(s) this capability's data is permitted/
     * expected to be *stored* in -- a policy constraint, not an observed
     * fact, not a processing-location claim, not a data-subject-location
     * claim. A field's own `dataResidency` overrides this for that field
     * specifically.
     */
    readonly dataResidency?: string | readonly string[];
    /**
     * The declared safeguard relied on for any transfer of this capability's
     * data out of `dataResidency`'s own jurisdiction(s) -- paired conceptually
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
     * specifically. Declared only -- nothing expires at runtime.
     */
    readonly expiresAt?: string;
    /** Whether this capability is documented as deprecated. Presence-only; nothing warns at runtime. */
    readonly deprecated?: boolean;
    /** Why this capability is deprecated, and what to use instead. Only meaningful alongside `deprecated`. */
    readonly deprecatedReason?: string;
    /**
     * Free-form extension bag for anything data-cap itself has no named
     * concept for -- opaque, never inspected or validated by any code path in
     * this package (e.g. jurisdiction-specific regulatory classification:
     * `{ regulatory: "GDPR,PCI-DSS" }`). Once a concept matters enough for
     * data-cap to reason about, it gets its own named field above (as
     * `purpose`/`legalBasis`/`dataResidency`/`transferSafeguard`/`auditRequired`
     * did); everything else stays here.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
    /**
     * Developer-supplied evidence assertions -- verified over time, unlike
     * every other field above, which is declared-only. Kept structurally
     * separate for exactly that reason (see `EvidenceFieldDocs`).
     */
    readonly evidence?: {
        readonly fields?: Readonly<Record<string, EvidenceFieldDocs>>;
    };
    /** Per-field documentation, overriding this capability's own `owner`/`sensitivity`/`protections` where declared. Keys are checked against the schema's real `fields` shape. */
    readonly fields?: CapabilityFieldDocs<TSchema["fields"]>;
    /** Per-getter documentation. Keys are checked against the schema's real `getters` names -- a nonexistent or misspelled getter name is a compile error. */
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
 * The one authoritative model every report generator reads from -- see
 * `buildInventory`. This type IS `data-cap`'s Capability Model (ADR 0050),
 * not a separate thing that produces one: `CAPABILITY_MODEL_SCHEMA_VERSION`
 * above versions this exact interface. ADR 0050 deliberately kept the
 * `CapabilityInventory`/`buildInventory` names rather than introducing a
 * `CapabilityModel`/`buildCapabilityModel` wrapper, since this type was
 * already the intended public model before that ADR existed -- a rename
 * would duplicate an already-correct, already-public shape for no gain. A
 * canonical, versioned, JSON-serializable projection of every discovered
 * capability's fields and operations, active or not.
 */
export declare interface CapabilityInventory {
    /** Always `CAPABILITY_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof CAPABILITY_MODEL_SCHEMA_VERSION;
    /** Every discovered, linked capability. */
    readonly capabilities: readonly CapabilityNode[];
    /** Parse/link warnings carried through from the discovery/linking pass that produced this inventory, each `file` root-relative like every other path this model publishes (OUT-01). */
    readonly warnings: readonly ParseWarning[];
}

/** One `buildData`/`createData` capability, resolved from the inventory's shared model. */
export declare interface CapabilityNode {
    /**
     * Root-relative POSIX path of the file declaring this capability -- the
     * one place an absolute discovery path is converted for publication
     * (OUT-01, see `display-path.ts`). Every downstream model that carries a
     * capability's `file` (Ownership, Finding, Dependency, Manifest Snapshot)
     * copies this value rather than re-deriving it, so there is exactly one
     * conversion point. Re-derive a real path with `absolutePathFrom(root,
     * file)` when actual filesystem/import work needs one.
     */
    readonly file: string;
    /** The binding name the `buildData`/`createData` result is exported as. */
    readonly exportName: string;
    /** `"buildData"` or `"createData"` -- which call form declared this capability. */
    readonly kind: "buildData" | "createData";
    /**
     * This capability's own declared documentation, if any -- the single path for
     * `owner`/`sensitivity`/`purpose`/`legalBasis`/`dataResidency`/`auditRequired`
     * (ADR 0057): a capability has nothing above it to resolve against, so a separate
     * top-level "resolved" property would only ever duplicate `docs.X` verbatim.
     */
    readonly docs: LooseCapabilityDocs | undefined;
    /** Defaults to `true` when `docs.active` is absent. */
    readonly active: boolean;
    /** Resolved: `docs.exclusiveGroup`, if declared. */
    readonly exclusiveGroup: string | undefined;
    /** Position of this capability's own `buildData`/`createData` call site -- always available (ADR 0052). */
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
 * Bump only when a reader could misinterpret the shape -- same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: every capability key is now built from a root-relative `file`
 * (OUT-01), and `renamedFields` was added (EVD-05).
 */
export declare const CHANGE_MODEL_SCHEMA_VERSION = 2;

/** `data-cap`'s Change Model: the manifest diff, plus an optional blast-radius index. */
export declare interface ChangeModel {
    /** Always `CHANGE_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof CHANGE_MODEL_SCHEMA_VERSION;
    /** The underlying manifest diff -- see `diffManifestSnapshots`. */
    readonly manifest: ManifestChangeReport;
    /** One entry per added/updated capability, or `undefined` when no `DependencyModel` was supplied -- an optional layer, matching `--ownership`/`--flow`'s existing opt-in cost model (the usage scan isn't free). */
    readonly blastRadius: readonly BlastRadiusEntry[] | undefined;
    /**
     * Every added-field/removed-field pair this run's currently-declared
     * `renamedFrom` values correlate into a single rename, sorted by
     * capability key then current name.
     *
     * @remarks
     * Only ever populated from an *authored* `FieldDocs.renamedFrom` -- never
     * guessed from name similarity, which is the same "prove it, never infer
     * it" rule AGENTS.md invariant 11 applies to every other derived fact
     * here. An additive view, not a filter: `manifest.updatedCapabilities`'s
     * own `fields.added`/`fields.removed` still list a correlated rename's two
     * halves separately, so a consumer that doesn't know about this field
     * loses nothing.
     *
     * Field-level only. `CapabilityDocs` deliberately has no `renamedFrom`
     * (see `core/document.ts`), so there is no `renamedCapabilities` -- a
     * capability-level rename has no authored field to correlate from, and
     * guessing one from a moved file would be exactly the inference this
     * model refuses to make.
     */
    readonly renamedFields: readonly RenamedField[];
}

/** The minimal capability shape `buildChangeModel` reads: identity for blast radius, plus each field's own declared `renamedFrom` for rename correlation. `CapabilityNode` satisfies it structurally. */
export declare interface ChangeModelCapability {
    readonly file: string;
    readonly exportName: string;
    readonly fields?: readonly {
        readonly path: readonly string[];
        readonly docs?: {
            readonly renamedFrom?: string;
        } | undefined;
    }[];
}

/** Computes every requested artifact and reports which ones are missing or stale, without writing anything. */
export declare function checkArtifacts(options: GenerateDataArtifactsOptions): Promise<CheckArtifactsResult>;

/** What `checkArtifacts` found -- the full computed report, plus which of its artifacts are stale on disk. */
export declare interface CheckArtifactsResult {
    /** The full report this run would produce, had it been a real (non-`--check`) generation. */
    readonly result: ReportResult;
    /** Paths that are missing or whose on-disk content doesn't match what this run would generate. */
    readonly stale: readonly string[];
}

/**
 * Flags active capabilities outside a shared `exclusiveGroup` that declare
 * an operation endpoint with the same `url` -- `info`, never blocking.
 * Presence-only in the same sense as the rest of this vocabulary: this
 * never proves two capabilities actually fetch the same data at runtime
 * (that would require tracing `execute`/`subscribe` bodies, which this
 * package never does -- ADR 0002), only that both DECLARE the same URL,
 * which is itself a strong, actionable enough signal to surface.
 */
export declare function checkDuplicateEndpoints(inventory: CapabilityInventory): readonly ReportFinding[];

/** Flags every `exclusiveGroup` shared by more than one *active* capability -- a hard `error`, since that's exactly what the field means. */
export declare function checkExclusiveGroups(inventory: CapabilityInventory): readonly ReportFinding[];

/** Ownership and sensitivity findings for every capability/field in the inventory -- pure, no file-tree scan. */
export declare function checkOwnershipAndSensitivity(inventory: CapabilityInventory): readonly ReportFinding[];

/** Flags active capabilities outside a shared `exclusiveGroup` that declare a field with the same path and structural shape -- `info`, never blocking. */
export declare function checkStructuralDuplication(inventory: CapabilityInventory): readonly ReportFinding[];

/** One `dynamicAccess` citation's integrity snapshot -- see `ManifestSnapshotCapability.citationSnapshots`. */
export declare interface CitationSnapshotEntry extends SourceLocation {
    /** Whole-file SHA-256 (hex) of the cited file's content, at the moment this citation was last confirmed to exist. An integrity signal only -- "this file hasn't visibly changed since the citation was written" -- never proof the citation's own underlying claim is semantically correct (see ADR 0053). */
    readonly hash: string;
}

/** One capability or field's declared sensitivity. */
export declare interface ClassificationEntry {
    readonly capability: {
        readonly file: string;
        readonly exportName: string;
    };
    readonly field: readonly string[] | undefined;
    readonly sensitivity: string;
}

/** One capability's declared regulatory-classification metadata bag (ADR 0049's/0051's open `metadata` convention). */
export declare interface ComplianceEntry {
    readonly capability: {
        readonly file: string;
        readonly exportName: string;
    };
    readonly metadata: Readonly<Record<string, unknown>>;
}

/** Files this run would write, computed but not yet written -- shared between `generateDataArtifacts` (writes when nothing blocks) and `checkArtifacts` (never writes, only diffs). */
export declare interface ComputedArtifacts {
    /** The full report, including every finding across every requested generator. */
    readonly result: ReportResult;
    /** Every file this run would write. */
    readonly writes: readonly {
        /** Absolute path this file would be written to. */
        readonly path: string;
        /** The file's full intended content. */
        readonly content: string;
    }[];
}

/**
 * Runs discovery, linking, inventory-building, and every requested
 * generator, returning the full `ReportResult` and the list of files that
 * *would* be written -- without writing anything. The one place both
 * `generateDataArtifacts` and `checkArtifacts` (C9) share, so the two can
 * never compute a different answer for the same inputs.
 */
export declare function computeDataArtifacts(options: GenerateDataArtifactsOptions): Promise<ComputedArtifacts>;

/**
 * Every capability- or field-level `expiresAt` across `inventory` that falls
 * within `expiringWithinDays` of `now` (or is already past it), soonest
 * (or most overdue) first. Skips any subject with no declared `expiresAt`,
 * an unparseable one, or one still further out than the window.
 */
export declare function computeExpiringEntries(inventory: CapabilityInventory, expiringWithinDays: number, now: Date): readonly ExpiringEntry[];

/**
 * SHA-256 over `data-cap`'s own installed version plus the path and raw bytes of
 * every file a real run would discover -- no parsing, no linking, no AST. Still
 * pays for the glob walk itself (a fingerprint has to know which files matter),
 * but nothing after it.
 *
 * Paths are deduplicated and sorted before hashing, so the result never depends
 * on filesystem enumeration order. The tool version is folded in because an
 * engine upgrade can change what the same source produces. Each file's own path
 * is hashed alongside its content so that renaming a file, or moving identical
 * content between two paths, changes the fingerprint.
 */
export declare function computeSourceFingerprint(options: ComputeSourceFingerprintOptions): Promise<string>;

/** Options for {@link computeSourceFingerprint}. */
export declare interface ComputeSourceFingerprintOptions {
    /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
    readonly fs: BuildFileSystem;
    /** Directory discovery resolves against -- same meaning as `GenerateDataArtifactsOptions.root`. */
    readonly root: string;
    /** Discovery globs. Defaults to `DEFAULT_INCLUDE`, matching `discoverCapabilityFiles`. */
    readonly include?: readonly string[];
    /** Discovery exclusion globs. */
    readonly exclude?: readonly string[];
    /** Allow-listed package names whose own resolved schema files also feed the fingerprint. */
    readonly packages?: readonly string[];
}

/**
 * Throw-based error hierarchy with a stable `code` discriminant, preferred
 * over `instanceof` for programmatic handling across bundling boundaries
 * (mirrors env-cap's own `EnvValidationError`/`EnvNotReadyError` convention).
 *
 * Invariant: no error here ever embeds a raw or processed field value in its
 * message -- only field paths (key names), which are never sensitive.
 */
declare abstract class DataCapError extends Error {
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
 * Which direction data moves across a declared boundary, and what kind of
 * boundary it is. Author-declared documentation only -- never statically
 * verified against an operation's actual `execute`/`subscribe` body (those
 * stay opaque per AGENTS.md invariant 6). A report may never present an
 * endpoint as a proven fact; see AGENTS.md's declared-vs-proven invariant.
 */
declare type DataFlowDirection = "input" | "output";

/**
 * One declared data-flow boundary an operation crosses. A getter/
 * subscription's endpoints are typically `"input"` (where `execute`/
 * `subscribe` acquires data from); a mutator's are typically `"output"`
 * (where it sends data to) -- nothing enforces the typical case, since this
 * is documentation, not a runtime contract.
 */
declare interface DataFlowEndpoint {
    /** Which way data moves across this boundary. */
    readonly direction: DataFlowDirection;
    /** What kind of boundary this is. */
    readonly kind: DataFlowEndpointKind;
    /** Short identifier, e.g. "stripe-api", "postgres:users" -- a semantic label, not a sentence. */
    readonly name: string;
    /** A literal, trackable location for this endpoint -- a URL, a route path, a `table:column` reference. Distinct from `name` (a short label): this is meant to be compared/matched across capabilities (e.g. flagging two capabilities that declare the same URL as likely-duplicate fetches), not just read by a person. */
    readonly url?: string;
    /**
     * The declared data-safety state of this field's value AT this specific
     * boundary crossing -- e.g. a field that arrives `"encrypted"` on an
     * `"input"` endpoint and is sent back out `"redacted"` on an `"output"`
     * endpoint. Declared only, same presence-only discipline as every other
     * field in this vocabulary: this records what a developer states about
     * handling at this crossing, never that data-cap has verified the field's
     * actual runtime value matches the claim.
     */
    readonly handling?: "plaintext" | "masked" | "redacted" | "hashed" | "encrypted";
}

/** What kind of boundary a declared data-flow endpoint crosses -- a data store (`database`/`cache`/`storage`/`queue`), an external entity (`api`/`external-service`/`user-input`), or something internal to this codebase (`computed`/`internal`). */
declare type DataFlowEndpointKind = "database" | "cache" | "storage" | "queue" | "api" | "external-service" | "user-input" | "computed" | "internal";

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

export declare class DataProjectGenerationError extends DataCapError {
    readonly code = "DATA_CAP_PROJECT_GENERATION_FAILED";
    /** Every finding from the run (not just the blocking ones), for a caller that wants the full picture. */
    readonly findings: readonly ReportFinding[];
    constructor(findings: readonly ReportFinding[]);
}

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
 * A patch over a resolved fields value: nested plain objects accept any
 * subset of their keys, recursively, but arrays are atomic -- a patch never
 * partially patches an array's items, only replaces the whole array (see
 * ownership.ts/patch.ts). Date/URL/RegExp are opaque leaves, never
 * decomposed.
 */
declare type DeepPartial<T> = T extends readonly (infer Item)[] ? readonly Item[] : T extends Date | URL | RegExp ? T : T extends object ? {
    [K in keyof T]?: DeepPartial<T[K]>;
} : T;

/** How many days out counts as "expiring soon" when a caller doesn't say -- 30, matching env-cap's own `DEFAULT_EXPIRING_WITHIN_DAYS` so a team running both packages gets one answer to "what's expiring soon," not two. */
export declare const DEFAULT_EXPIRING_WITHIN_DAYS = 30;

/** The default `include` glob when none is supplied: every `.ts`/`.tsx` file. */
export declare const DEFAULT_INCLUDE: string[];

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
export declare function defineEvidenceProjection<T extends Record<string, unknown>>(schema: EvidenceProjectionSchema<T>): EvidenceProjection<T>;

/**
 * Bump only when a reader could misinterpret the shape -- same discipline
 * `CAPABILITY_MODEL_SCHEMA_VERSION`/`MANIFEST_SNAPSHOT_SCHEMA_VERSION` already
 * document. Bumped 1 -> 2 by ADR 0056: `byCapability`/`consumers` removed from
 * this model's own stored shape (see `dependency-projections.ts`). Bumped
 * 2 -> 3 by OUT-01: every edge's `from`/`to.capability.file` is now
 * root-relative, not absolute.
 */
export declare const DEPENDENCY_MODEL_SCHEMA_VERSION = 3;

/**
 * A statically-proven connection from one consuming file to a capability
 * (or a specific field/operation on it). Unlike the declared metadata in
 * `core/document.ts` (`source`, `credentials`, `endpoints`), every
 * `DependencyEdge` is derived by AST analysis, never author-declared -- see
 * AGENTS.md's declared-vs-proven invariant. Produced by the usage-scan
 * pass (`scan-dependencies.ts`), not by this module.
 */
export declare interface DependencyEdge {
    /** Which kind of connection this is -- see `DependencyRelationship`. */
    readonly relationship: DependencyRelationship;
    /** The consuming file, as a root-relative POSIX path (OUT-01, see `display-path.ts`). */
    readonly from: string;
    /** What this edge connects to. */
    readonly to: {
        /** The capability being consumed. */
        readonly capability: {
            /** Root-relative POSIX path of the file declaring the capability -- the same value `CapabilityNode.file` publishes. */
            readonly file: string;
            /** The binding name the capability is exported as. */
            readonly exportName: string;
        };
        /** The specific field path being read, when `relationship` is `"reads-field"`. */
        readonly field?: readonly string[];
        /** The specific operation name being called, when `relationship` is `"calls-getter"`/`"calls-mutator"`/`"calls-subscription"`. */
        readonly operation?: string;
    };
    /** Whether the consumer reference itself was unambiguously resolved -- see the usage-scan pass for what each value means. */
    readonly resolution: "resolved" | "unresolved-consumer" | "indeterminate";
    /** Position of the access site in `from` (file already known via `from`), when this edge originates from a specific identifier reference (every relationship except the file-level `"imports"` fallback edge scan-dependencies.ts synthesizes for a consumer with no further resolved usage). */
    readonly position: SourcePosition | undefined;
}

/** `data-cap`'s Dependency Model: every proven `DependencyEdge`, unindexed. See `dependency-projections.ts` for on-demand capability/consumer groupings. */
export declare interface DependencyModel {
    /** Always `DEPENDENCY_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof DEPENDENCY_MODEL_SCHEMA_VERSION;
    /** Every proven edge, unindexed -- same array `scanDependencies` produced. */
    readonly edges: readonly DependencyEdge[];
}

/** Every proven edge targeting one capability. */
export declare interface DependencyModelCapabilityEdges {
    /** The capability every edge in `edges` targets. */
    readonly capability: {
        /** Absolute path of the file declaring the capability. */
        readonly file: string;
        /** The binding name the capability is exported as. */
        readonly exportName: string;
    };
    /** Every proven edge targeting this capability, in scan order. */
    readonly edges: readonly DependencyEdge[];
}

/** Every proven edge originating from one consuming file. */
export declare interface DependencyModelConsumer {
    /** The consuming file. */
    readonly file: string;
    /** Every proven edge originating from this file, in scan order. */
    readonly edges: readonly DependencyEdge[];
}

export declare type DependencyRelationship = "imports" | "reads-field" | "calls-getter" | "calls-mutator" | "calls-subscription";

/**
 * Derives every finding that requires a real usage scan -- as opposed to
 * `static-rules.ts`'s findings, which need only the inventory. An
 * `ABANDONED_CAPABILITY` capability short-circuits its own field/consumer
 * findings: with zero edges, there is nothing further to characterize.
 */
export declare function deriveUsageFindings(inventory: CapabilityInventory, edges: readonly DependencyEdge[]): readonly ReportFinding[];

/**
 * Diffs two snapshots into a change report. `previous === undefined` means
 * no prior snapshot exists (a first run) -- every current capability is
 * reported `added`, never guessed to be "unchanged."
 */
export declare function diffManifestSnapshots(previous: ManifestSnapshot | undefined, current: ManifestSnapshot): ManifestChangeReport;

/**
 * Discovers every file matching `include`/`exclude` under `root`, alphabetically sorted, as absolute paths.
 */
export declare function discoverCapabilityFiles(options: DiscoverOptions): Promise<string[]>;

/** One `buildData`/`createData` capability, linked with its correlated `documentData()` call (if any). */
export declare interface DiscoveredCapability {
    /** Absolute path of the file declaring this capability. */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
    /** `"buildData"` or `"createData"` -- which call form declared this capability. */
    readonly kind: "buildData" | "createData";
    /** The literal-evaluated `fields` shape, or `undefined` when it couldn't be statically resolved (see accompanying warnings). */
    readonly fieldsShape: Record<string, unknown> | undefined;
    /** Static getter/mutator/subscription names (never their function bodies) -- only ever populated for a `createData()` call; `undefined` for `buildData()`, which has no operations section. */
    readonly operationNames: OperationNames | undefined;
    /** Static `writes` field-ownership shapes, keyed the same way as `operationNames` -- `undefined` under the same condition. */
    readonly operationWrites: OperationWritesByKind | undefined;
    /** Static `processor`/`optimistic` key-presence facts, keyed the same way as `operationNames` -- `undefined` under the same condition. */
    readonly operationPresence: OperationPresenceByKind | undefined;
    /** Position of this capability's own `buildData`/`createData` call site -- always available. */
    readonly declarationPosition: SourcePosition;
    /** Position of each top-level field's own key, keyed by field name -- only when `fields` was an inline object literal in this file (see `parse.ts`'s `extractFieldPositions`); `undefined` when identifier-resolved across a file boundary. */
    readonly fieldPositions: Readonly<Record<string, SourcePosition>> | undefined;
    /** The `documentData()` call correlated with this capability, if any. */
    readonly documentedBy: {
        /** Absolute path of the file declaring the correlated `documentData()` call. */
        readonly file: string;
    } | undefined;
    /** Statically-extracted governance metadata from the correlated `documentData()` call, if any -- `undefined` when `documentedBy` is `undefined`, or when its `docs` argument wasn't an inline object literal. */
    readonly docs: LooseCapabilityDocs | undefined;
}

/** Options for `discoverCapabilityFiles`. */
export declare interface DiscoverOptions {
    /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
    readonly fs: BuildFileSystem;
    /** Directory to walk. */
    readonly root: string;
    /** Glob patterns (relative to `root`) a file must match at least one of to be included. Defaults to every `.ts`/`.tsx` file. */
    readonly include?: readonly string[];
    /** Glob patterns (relative to `root`) that prune a file or directory regardless of `include`. */
    readonly exclude?: readonly string[];
}

/**
 * Statically evaluates one AST expression against the allow-listed literal grammar -- never `eval`/`import`/`require`s anything (ADR 0002).
 */
export declare function evaluateLiteral(node: ts.Expression): LiteralEvalResult;

/**
 * Bump only when a reader could misinterpret the shape -- same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: `provenance` became required and gained `toolVersion`/`commit`
 * (OUT-06), `lifecycle` was added (EVD-05), and `computed` was added
 * (OUT-04).
 */
export declare const EVIDENCE_MODEL_SCHEMA_VERSION = 2;

/**
 * Which project-varying sub-models this particular run actually computed
 * (OUT-04).
 *
 * Without this, a persisted `data.evidence.json` is ambiguous in exactly the
 * way a governance artifact must never be: an absent `dependency` could mean
 * "nothing in this project depends on anything" (a real, reportable finding)
 * or "this run never scanned for dependencies" (no finding at all, just an
 * un-run pass). Those are opposite conclusions and the JSON looked identical
 * either way.
 *
 * env-cap solves the same ambiguity by always computing all six sub-models,
 * so absence never happens. `data-cap` deliberately does not follow that:
 * the usage scan is the expensive pass here, and `--docs` alone is supposed
 * to stay cheap. So instead of forcing every run to pay for a full
 * dependency scan, each sub-model's presence is stated explicitly.
 *
 * `capability`, `lifecycle`, and `runtimeContract` have no flag -- they are
 * always populated by construction, so a flag could only ever read `true`.
 *
 * A pass that ran and found nothing is `true` with an empty result, never
 * `false`: "we looked and found none" is a genuine finding, and collapsing
 * it into "we didn't look" is precisely the confusion this field exists to
 * prevent.
 */
export declare interface EvidenceComputedModels {
    /** Whether a usage scan ran and produced a Dependency Model this run. */
    readonly dependency: boolean;
    /** Whether an Ownership Model was built this run. */
    readonly ownership: boolean;
    /** Whether at least one rule/scan pass ran and produced a Finding Model this run. */
    readonly finding: boolean;
    /** Whether a manifest diff was available and produced a Change Model this run. */
    readonly change: boolean;
}

/**
 * Short disclaimer prepended to every artifact that renders sensitivity/
 * protections/endpoints claims (the docs catalog, ownership report,
 * data-flow diagram) -- see AGENTS.md's declared-vs-proven invariant.
 * Never omit this from an artifact that renders governance metadata: it's
 * what keeps "documented" from being misread as "verified" or "compliant."
 */
export declare function evidenceDisclaimer(): string;

/**
 * Developer-supplied evidence assertions for one field -- categorically
 * different from every field on `FieldDocs`: those are declared-and-never-
 * verified (ADR 0049's own invariant), while `dynamicAccess` is re-checked
 * against reality every run (see the build-tooling side of this feature).
 * Kept structurally separate, in `CapabilityDocs.evidence` rather than
 * folded into `FieldDocs`, specifically so this different epistemic status
 * is visible in the shape itself, not just in a doc comment (ADR 0053).
 */
declare interface EvidenceFieldDocs {
    /**
     * Citations of where this field is accessed in a way static analysis
     * can't see on its own (e.g. a truly dynamic key derived at runtime),
     * each `"<relative-path>:<line>:<column>"`. Re-verified every run: a
     * citation whose file no longer exists, or whose cited line has visibly
     * changed since the citation was written, is downgraded and flagged, never
     * trusted forever.
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
    /** Who/when/what produced this instance -- always present (see `EvidenceProvenance`). */
    readonly provenance: EvidenceProvenance;
    /** Capability Model. */
    readonly capability: CapabilityInventory;
    /** Lifecycle Model -- always populated, for the reason `EvidenceModelInputs.lifecycle` documents. */
    readonly lifecycle: LifecycleModel;
    /**
     * Which of the four optional sub-models below this run actually computed
     * -- read this before concluding anything from an absent one (OUT-04).
     */
    readonly computed: EvidenceComputedModels;
    /** Dependency Model, or `undefined` when no usage scan was run -- see `computed.dependency` before reading absence as "no dependencies." */
    readonly dependency: DependencyModel | undefined;
    /** Ownership Model, or `undefined` when none was supplied -- see `computed.ownership`. */
    readonly ownership: OwnershipModel | undefined;
    /** Finding Model, or `undefined` when nothing was supplied -- see `computed.finding` before reading absence as "no findings." */
    readonly finding: FindingModel | undefined;
    /**
     * Change Model, or `undefined` when no manifest diff was available -- see
     * `computed.change` before reading absence as "nothing changed." Not a
     * diffable input across two `EvidenceModel`s the way the other five
     * project-varying fields conceptually are -- it already IS a diff.
     */
    readonly change: ChangeModel | undefined;
    /**
     * Runtime Contract Model -- always populated, package-scoped rather than
     * project-scoped (see this module's own doc comment). A static append,
     * never itself a diffable "changed since last run" input.
     */
    readonly runtimeContract: RuntimeContractModel;
}

/** The project-varying models Evidence Model composes -- `capability` and `lifecycle` are required; the rest depend on which passes actually ran. */
export declare interface EvidenceModelInputs {
    /** Capability Model -- the base every other model is derived from or indexed against. */
    readonly capability: CapabilityInventory;
    /**
     * Lifecycle Model. Required alongside `capability`, not optional like
     * `dependency`/`ownership`: it is a pure projection over the inventory
     * (`buildLifecycleModel`), so any caller holding a `capability` can always
     * produce one -- there is no scenario where a caller legitimately
     * "doesn't have" it the way it might not have run a usage scan. Only the
     * `expiringWithinDays`/`now` window is a caller choice, and that changes
     * the contents, never the availability.
     */
    readonly lifecycle: LifecycleModel;
    /** Dependency Model, when a usage scan was run. */
    readonly dependency?: DependencyModel;
    /** Ownership Model, when a usage scan was run. */
    readonly ownership?: OwnershipModel;
    /** Finding Model, when at least one rule/scan pass ran. */
    readonly finding?: FindingModel;
    /** Change Model, when a previous manifest snapshot was available to diff against. */
    readonly change?: ChangeModel;
}

/**
 * The function `defineEvidenceProjection()` returns. Callable directly for
 * the common case (`projection(evidence)` -> `T`); `.project()` returns the
 * same value alongside automatic, per-field provenance.
 */
export declare interface EvidenceProjection<T extends Record<string, unknown>> {
    (evidence: EvidenceModel): T;
    /**
     * Declared as a property holding a function, not as a method: what's
     * actually attached is a closure (`Object.assign(invoke, {project})`) that
     * never reads `this`, so a consumer is free to destructure or pass it
     * around. A method signature would claim otherwise and make every such
     * use look like an unbound-method bug.
     */
    readonly project: (evidence: EvidenceModel) => EvidenceProjectionResult<T>;
}

/** `project()`'s return shape: the computed output, plus which `EvidenceModel` field paths fed each output key. */
export declare interface EvidenceProjectionResult<T extends Record<string, unknown>> {
    /** The projection's own output -- exactly what calling the projection directly returns. */
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
 * projection's output shape. Must not mutate `evidence` -- the membrane
 * `defineEvidenceProjection()` wraps it in enforces that at runtime, see
 * `createTrackingProxy()` below -- and must not perform I/O; `data-cap` can
 * enforce the read-only half of purity but not the "no side effects" half.
 */
export declare type EvidenceProjector<T> = (evidence: EvidenceModel) => T;

/**
 * Who/when/what produced a given `EvidenceModel` instance -- matching
 * env-cap's own `EvidenceProvenance` shape exactly, so a consumer reading
 * both packages' evidence artifacts reads one vocabulary, not two.
 *
 * `generatedAt`/`toolVersion` are required: every real caller can supply
 * both (the tool version is `data-cap`'s own installed version, read from
 * its `package.json` -- see `package-version.ts`), and a provenance stamp
 * that might be missing either one is a provenance stamp no consumer can
 * rely on. `commit` stays caller-supplied and explicitly `string |
 * undefined` (never omitted from the shape): `data-cap` never shells out to
 * `git` itself, so an absent commit is a stated absence, never a guess --
 * ADR 0050's "provenance is caller-supplied, never ambient-detected"
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

/** One capability- or field-level `expiresAt` falling within the configured window (or already past it). */
export declare interface ExpiringEntry {
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
 * Documentation metadata for one field.
 *
 * `owner`, `sensitivity`, `protections`, and `transferSafeguard` override the
 * capability-level value of the same name for this field specifically -- not
 * every field in a capability is equally sensitive, equally owned, or
 * crosses the same transfer boundary. `protections` and `retention` are
 * documentation-presence signals only: a generator may say a safeguard/
 * policy is "documented" or "not documented," never that it is adequate,
 * correct, or enforced. `purpose`/`legalBasis`/`dataResidency`/
 * `transferSafeguard`/`auditRequired` carry the same presence-only
 * discipline -- declared governance facts, never a claim that data-cap has
 * determined they satisfy any law (see `specs/decisions/0051-documentdata-metadata-and-governance-fields.md`).
 * `dataSubjectCategory`/`recipientCategories` are field-level only (no
 * capability-level counterpart) -- see each property's own doc comment for
 * why.
 *
 * The boundary this interface draws is deliberate: a named property here is
 * reserved for a concept data-cap itself understands, projects, or reports
 * on. Anything else -- organization-specific detail with no data-cap-defined
 * meaning -- belongs in `metadata`, never as an ad hoc extra property, so
 * this vocabulary stays bounded instead of accreting one-off keys over time.
 *
 * Note what is deliberately absent: there is no per-field `validate`/
 * `validator` property, and no `helpers.validators` combinator library
 * backing one, unlike `@maverickcer/env-cap`'s `EnvVarDocs`. That is a
 * design choice, not a gap. `env-cap` validates on a reject-and-throw
 * pipeline, where a failing validator must carry a message explaining the
 * rejection; `data-cap` has no reject path to write a message for --
 * invalid processor/operation output resets the field to its declared
 * default via `core/schema.ts`'s `checkValueAgainstSchema`, keeping fields
 * synchronously readable (AGENTS.md invariant 2) and surfacing the
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
    /** Documented retention policy for this field -- presence only, never an enforcement claim. */
    readonly retention?: string;
    /**
     * The declared reason this field's data is collected/retained. Declared
     * only -- data-cap never verifies the stated purpose matches actual usage.
     * Overrides the capability's own `purpose` for this field specifically.
     */
    readonly purpose?: string;
    /**
     * The declared legal basis asserted for processing this field (e.g.
     * `"consent"`, `"contract"`, `"legitimate interest"`). Records that a
     * basis was declared -- never that data-cap has determined the basis is
     * legally valid. Overrides the capability's own `legalBasis` for this
     * field specifically.
     */
    readonly legalBasis?: string;
    /**
     * The declared jurisdiction(s) this field's data is permitted/expected to
     * be *stored* in -- a policy constraint, not an observed fact, not a
     * processing-location claim, not a data-subject-location claim. Overrides
     * the capability's own `dataResidency` for this field specifically.
     */
    readonly dataResidency?: string | readonly string[];
    /**
     * The declared safeguard relied on for any transfer of this field's data
     * out of `dataResidency`'s own jurisdiction(s) (e.g. `"EU Standard
     * Contractual Clauses"`, `"adequacy decision"`) -- paired conceptually
     * with `dataResidency` (which states where data is permitted to be
     * *stored*; this states what protects a transfer *out of* that
     * jurisdiction), same presence-only discipline as every other field here.
     * Declared only -- data-cap never verifies a transfer actually occurred or
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
     * `"customers"`, `"employees"`, `"minors"`). Declared only -- data-cap
     * never verifies who a field's actual data subjects are. Field-level only:
     * unlike `owner`/`sensitivity`/`purpose`/etc., this has no capability-level
     * counterpart to override -- which data subjects a field concerns is a
     * fact about that field's own data, not something a whole capability can
     * meaningfully state once for every field under it.
     */
    readonly dataSubjectCategory?: string;
    /**
     * The declared categories of recipient this field's data has been or will
     * be disclosed to (e.g. `"payment processor"`, `"tax authority"`,
     * `"internal support staff"`). Always explicitly authored -- data-cap
     * never infers a recipient category from its own dependency graph (a
     * proven *consumer* relationship inside this codebase is a categorically
     * different fact from a declared *external recipient*, and conflating the
     * two would misrepresent both). Field-level only, for the same reason as
     * `dataSubjectCategory`. See
     * `specs/decisions/0067-ropa-fields-recipient-categories-never-inferred.md`
     * for the full reasoning on why this is never derived.
     */
    readonly recipientCategories?: readonly string[];
    /**
     * When this field's data (or the credential/source behind it) is declared
     * to stop being valid, as an ISO-8601 date (`"2026-12-31"`). Declared
     * only: nothing expires anything at runtime, and `data-cap` never fetches
     * a real expiry from a provider. Build tooling reads it to report what is
     * expiring soon (see the Lifecycle Model) -- a date that has already
     * passed is reported as expired, never acted on.
     */
    readonly expiresAt?: string;
    /** Whether this field is documented as deprecated. Presence-only, same discipline as every other declared fact here -- nothing warns at runtime. */
    readonly deprecated?: boolean;
    /** Why this field is deprecated, and what to use instead. Only meaningful alongside `deprecated`. */
    readonly deprecatedReason?: string;
    /**
     * The date by which a deprecated field is intended to be removed, ISO-8601.
     * Field-level only: a removal deadline is about one specific field's own
     * migration, and a capability-wide `removeBy` would say nothing about
     * which of its fields still need work.
     */
    readonly removeBy?: string;
    /**
     * The previous name of this field, when it was renamed. Field-level only,
     * for the same reason as `removeBy`. Build tooling uses this to correlate
     * an added-field/removed-field pair across two runs into one rename rather
     * than reporting an unrelated addition and deletion -- see `ChangeModel`'s
     * `renamedFields`. Only ever populated from an *authored* value, never
     * guessed from name similarity.
     */
    readonly renamedFrom?: string;
    /**
     * Free-form extension bag for anything data-cap itself has no named
     * concept for -- opaque, never inspected or validated by any code path in
     * this package. Once a concept matters enough for data-cap to reason
     * about, it gets its own named field above; everything else stays here.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/** One field's declared origins/destinations and proven in-repo consumers -- the data-flow-diagram/security-review model's atomic unit. */
export declare interface FieldFlow {
    /** Which capability owns this field. */
    readonly capability: {
        /** Absolute path of the file declaring the capability. */
        readonly file: string;
        /** The binding name the capability is exported as. */
        readonly exportName: string;
    };
    /** The field's path within its capability. */
    readonly field: readonly string[];
    /** Resolved: the field's own declared sensitivity, else the capability's -- mirrors `owner`'s inheritance (ADR 0049). */
    readonly sensitivity: string | undefined;
    /** `direction: "input"` endpoints declared on the operation(s) that write this field, each tagged with its declaring operation. */
    readonly declaredOrigins: readonly FieldFlowEndpoint[];
    /** `reads-field` edges statically proven to target this field. */
    readonly provenConsumers: readonly DependencyEdge[];
    /** `direction: "output"` endpoints declared on the operation(s) that write this field, each tagged with its declaring operation. */
    readonly declaredDestinations: readonly FieldFlowEndpoint[];
}

/** Which operation declared one `FieldFlowEndpoint` -- kept alongside the endpoint itself (rather than flattened away) so a consumer like `flow-diagram.ts` can draw a real endpoint -> operation -> field chain, not just endpoint -> field. */
declare interface FieldFlowEndpoint {
    /** The getter/mutator/subscription that declares this endpoint. */
    readonly operation: {
        readonly kind: "getter" | "mutator" | "subscription";
        readonly name: string;
    };
    /** The declared endpoint itself. */
    readonly endpoint: DataFlowEndpoint;
}

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

export declare interface FieldNode {
    /** Top-level field key, as a single-element path (see the module doc comment on why granularity stops here). */
    readonly path: readonly string[];
    /** This field's own declared documentation, if any -- `description`/`protections`/`retention`/`metadata` have no resolution concept and live only here; for the six governed properties below, prefer `.value`/`.declaredOn` over reading this object directly (ADR 0057). */
    readonly docs: FieldDocs | undefined;
    /** Resolved: the field's own `docs.owner`, else the capability's `owner`, plus which one declared it. */
    readonly owner: ResolvedGovernanceValue<string>;
    /** Resolved: the field's own `docs.sensitivity`, else the capability's `sensitivity` -- same inheritance rule as `owner` (ADR 0049, ADR 0050, ADR 0057). */
    readonly sensitivity: ResolvedGovernanceValue<string>;
    /** Resolved: the field's own `docs.purpose`, else the capability's `purpose` -- same inheritance rule as `owner`/`sensitivity` (ADR 0051, ADR 0057). Declared only, never verified. */
    readonly purpose: ResolvedGovernanceValue<string>;
    /** Resolved: the field's own `docs.legalBasis`, else the capability's `legalBasis` -- same inheritance rule. A declared fact, never a legal determination (ADR 0051, ADR 0057). */
    readonly legalBasis: ResolvedGovernanceValue<string>;
    /** Resolved: the field's own `docs.dataResidency`, else the capability's `dataResidency` -- same inheritance rule. The declared permitted-storage jurisdiction(s), not an observed fact (ADR 0051, ADR 0057). */
    readonly dataResidency: ResolvedGovernanceValue<string | readonly string[]>;
    /** Resolved: the field's own `docs.auditRequired`, else the capability's `auditRequired` -- same inheritance rule (ADR 0051, ADR 0057). */
    readonly auditRequired: ResolvedGovernanceValue<boolean>;
    /** Every getter/mutator/subscription whose statically-extracted `writes` shape claims this field. */
    readonly writtenBy: readonly {
        /** Which kind of operation wrote this field. */
        readonly kind: "getter" | "mutator" | "subscription";
        /** The writing operation's key name. */
        readonly name: string;
    }[];
    /** The field's literal-evaluated declared default -- structural comparison only (e.g. `structural-duplication.ts`), never a runtime value. */
    readonly shape: unknown;
    /** Position of this field's own key in the `fields` object literal -- only when `fields` was resolved as an inline literal in this file; `undefined` when identifier-resolved across a file boundary this pass doesn't retain AST access to (never guessed at -- ADR 0052). */
    readonly declarationPosition: SourcePosition | undefined;
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
 * Bump only when a reader could misinterpret the shape -- same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: `LocatedFinding` no longer carries the flat `capability`/`field`/
 * `operation`/`position`/`indeterminateSites` locators alongside `location`
 * (OUT-02), `FindingLocationCapability.file` is now root-relative rather
 * than absolute (OUT-01), and every finding now carries a `family`
 * (NAM-12).
 */
export declare const FINDING_MODEL_SCHEMA_VERSION = 2;

/**
 * Where a finding points, as a discriminated union -- never a formatted
 * string a consumer would have to parse back apart. Ships with only the
 * variants `findings.ts`'s actual emission sites produce today
 * (`"capability"`/`"field"`/`"consumer"`/`"none"`); `"operation"` is
 * included because `ReportFinding.operation` is already part of that
 * type's public shape, even though no current finding populates it --
 * trivially reachable the day one does, not a guess about what it would
 * look like. `"capability"`/`"field"`/`"operation"` carry an optional
 * `position` (ADR 0052) -- the declaration site's own position, when the
 * source `ReportFinding.position` was populated; `"consumer"` doesn't,
 * since it locates a *consuming file*, which has no single declaration
 * position the way a capability/field/operation's own declaration does.
 */
export declare type FindingLocation = {
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
     * could actually be about (ADR 0052) -- populated only for that code.
     * Lives here, on the one variant that can carry it, rather than as a
     * flat sibling of `location`: a field-level finding is the only kind
     * that ever has one. Spans potentially multiple consuming files, so
     * each entry carries its own `file` (`SourceLocation`, not just
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

/** A finding's capability locator -- shared by every `FindingLocation` variant except `"none"`. */
export declare interface FindingLocationCapability {
    /** Root-relative POSIX path of the file declaring the capability -- carried through verbatim from `CapabilityNode.file` (see `display-path.ts`). */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
}

/** `data-cap`'s Finding Model: every finding, with a structured, pre-computed `location`. */
export declare interface FindingModel {
    /** Always `FINDING_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof FINDING_MODEL_SCHEMA_VERSION;
    /** Every finding, each with its `location` computed. */
    readonly findings: readonly LocatedFinding[];
}

/** Export names that collide across two or more different active capability files -- the manifest can't re-export both under the same identifier. */
export declare function findManifestExportCollisions(inventory: CapabilityInventory): ReadonlyMap<string, readonly string[]>;

/** The sidecar path paired with an evidence artifact -- `<evidence-path>.fingerprint`. */
export declare function fingerprintPathFor(evidencePath: string): string;

/** The flat, pre-`location` locator properties a rule/scan emits a `ReportFinding` with -- resolved into `FindingLocation` by `locationOf`, then dropped. */
declare type FlatLocators = "capability" | "field" | "operation" | "source" | "position" | "indeterminateSites";

/** Every field's flow, plus any `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` findings derived from it. */
export declare interface FlowGraph {
    /** Every field's declared origins/destinations and proven consumers. */
    readonly fields: readonly FieldFlow[];
    /** `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` findings derived from `fields`. */
    readonly findings: readonly ReportFinding[];
}

/**
 * Computes every requested artifact and, only if nothing blocks (no
 * `error`-severity finding after `--strict*` escalation), writes all of
 * them. Throws `DataProjectGenerationError` instead of writing a partial
 * set when something does block.
 */
export declare function generateDataArtifacts(options: GenerateDataArtifactsOptions): Promise<ReportResult>;

/** Options for `computeDataArtifacts`/`generateDataArtifacts`/`checkArtifacts`. */
export declare interface GenerateDataArtifactsOptions {
    /** The filesystem capability, shared across every requested pass -- `./build` never imports `node:fs` (ADR 0058). */
    readonly fs: BuildFileSystem;
    /** Directory discovery/linking resolves against. */
    readonly root: string;
    /** Glob patterns (relative to `root`) a file must match at least one of to be discovered. Defaults to every `.ts`/`.tsx` file. */
    readonly include?: readonly string[];
    /** Glob patterns (relative to `root`) that prune a file or directory regardless of `include`. */
    readonly exclude?: readonly string[];
    /** Explicit `tsconfig.json` path override, or `false` to disable alias resolution -- see `LinkOptions.tsconfig`. */
    readonly tsconfig?: string | false;
    /** Explicit cross-package schema discovery allowlist -- see `resolve-package-schema.ts`. */
    readonly packages?: readonly string[];
    /** Output path for the generated manifest `.ts` file. Omit to skip manifest generation (the inventory is still built and static rules still run). */
    readonly location?: string;
    /** Output path for the Markdown documentation catalog. */
    readonly docs?: string;
    /** Output path for the Dependency & Ownership report. */
    readonly ownership?: string;
    /** Output directory for the Data Flow Diagram + Security Data-Flow Review set. */
    readonly flow?: string;
    /** Output path for the composed Evidence Model (ADR 0050), as JSON -- see `ReportResult.evidence`, which is always computed regardless of this option; this only controls whether it's additionally written to disk. */
    readonly evidence?: string;
    /** Escalate every pass's `warning` findings to `error` (never `info`). */
    readonly strict?: boolean;
    /** Escalate static (ownership/sensitivity/duplication) findings to `error`. */
    readonly strictDocs?: boolean;
    /** Escalate proven usage findings (abandoned capabilities, unconsumed owned fields) to `error` -- never escalates unresolved-consumer or indeterminate findings. */
    readonly strictOwnership?: boolean;
    /** Escalate `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY`/`SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING` findings to `error` -- every finding `buildFlowGraph` produces. */
    readonly strictFlow?: boolean;
    /** The commit SHA this run's evidence was generated against, stamped onto `EvidenceModel.provenance.commit`. Caller-supplied only -- `data-cap` never shells out to `git` itself, so omitting this records a stated absence, never a guess. */
    readonly commit?: string;
    /** The single instant every time-sensitive computation in this run shares (`EvidenceModel.provenance.generatedAt`, Lifecycle Model's `daysRemaining`), so none of them can disagree about "now". Defaults to the wall clock at the moment this function is called. */
    readonly generatedAt?: Date;
    /** How many days out counts as "expiring soon" for the Lifecycle Model and the documentation catalog's own expiring section. Defaults to `DEFAULT_EXPIRING_WITHIN_DAYS`. */
    readonly expiringWithinDays?: number;
}

/**
 * The marker every build-tooling-generated file starts with, so it's
 * unambiguous the file is derived output, never hand-edited -- and so
 * `check-artifacts.ts`'s drift check can refuse to ever overwrite a
 * hand-written file that happens to occupy the same output path.
 */
/** Renders the "do not edit by hand" marker in the given comment syntax. */
export declare function generatedBanner(format?: "ts" | "markdown"): string;

/** Renders the Markdown documentation catalog and runs the ownership/sensitivity static rules (C4). */
export declare function generateDocumentation(options: GenerateDocumentationOptions): GenerateDocumentationResult;

/** Options for `generateDocumentation`. */
export declare interface GenerateDocumentationOptions {
    /** The inventory to render documentation from. */
    readonly inventory: CapabilityInventory;
    /** Discovery root every rendered path displays relative to. */
    readonly root: string;
    /** Output path for the rendered documentation catalog. */
    readonly location: string;
    /** Manifest changes since the last report, rendered as a "changes since last report" section when present. */
    readonly changes?: ManifestChangeReport;
    /** Proven usage edges, when the caller already ran the usage scan (`--ownership`/`--flow`) -- renders exact `file:line:column` consumption sites per field when supplied. Omit when no usage scan ran; the catalog still renders, just without that column populated. */
    readonly edges?: readonly DependencyEdge[];
    /** This same run's own `--evidence` output path, when requested -- named in the generated banner's Evidence Model note. */
    readonly evidencePath?: string;
    /**
     * How many days out counts as "expiring soon" in the rendered Lifecycle
     * section. Defaults to `DEFAULT_EXPIRING_WITHIN_DAYS` (30), matching
     * env-cap's own default.
     */
    readonly expiringWithinDays?: number;
    /**
     * The instant `daysRemaining` is measured from. Defaults to the wall clock
     * at call time; `generateDataArtifacts` passes its own single run-wide
     * instant, so the catalog and the published Evidence Model can never
     * report a different "12d remaining" for the same field.
     */
    readonly generatedAt?: Date;
}

/** The rendered documentation catalog plus the ownership/sensitivity findings it surfaces. */
export declare interface GenerateDocumentationResult {
    /** Where this documentation is intended to be written. */
    readonly location: string;
    /** The rendered Markdown content. */
    readonly content: string;
    /** Ownership/sensitivity findings surfaced while rendering. */
    readonly findings: readonly ReportFinding[];
}

/** Builds the flow graph and renders the full Data Flow Diagram + Security Data-Flow Review artifact set (C10). */
export declare function generateFlow(options: GenerateFlowOptions): GenerateFlowResult;

/** One file within the generated flow artifact set. */
export declare interface GenerateFlowFile {
    /** Absolute output path. */
    readonly path: string;
    /** The file's full rendered content. */
    readonly content: string;
}

/** Options for `generateFlow`. */
export declare interface GenerateFlowOptions {
    /** The inventory to build the flow graph from. */
    readonly inventory: CapabilityInventory;
    /** Discovery root every rendered path (consumer nodes, proven-edge labels) displays relative to. */
    readonly root: string;
    /** Directory the flow artifact set will be written under. */
    readonly location: string;
    /** Proven consumer edges from a usage scan, used to derive in-repo flow paths. */
    readonly edges: readonly DependencyEdge[];
    /** Findings from other passes (C2's static rules, C6's usage scan) to fold into the Security Data-Flow Review -- optional, so `--flow` alone still produces a meaningful review of just its own findings. */
    readonly additionalFindings?: readonly ReportFinding[];
    /** This same run's own `--evidence` output path, when requested -- named in the generated banner's Evidence Model note. */
    readonly evidencePath?: string;
}

/** The generated Data Flow Diagram + Security Data-Flow Review set. */
export declare interface GenerateFlowResult {
    /** The directory this set was written under. */
    readonly location: string;
    /** Every generated file in the set. */
    readonly files: readonly GenerateFlowFile[];
    /** This pass's own findings only (`SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY`) -- `additionalFindings` are folded into the rendered review but not echoed back here, so a caller aggregating findings across every generator never double-counts them. */
    readonly findings: readonly ReportFinding[];
}

/** Renders the deterministic manifest `.ts` file -- pure, no filesystem access, no diffing (see this module's own doc comment). */
export declare function generateManifest(options: GenerateManifestOptions): GenerateManifestResult;

/** Options for `generateManifest`. */
export declare interface GenerateManifestOptions {
    /** The inventory to render the manifest from. */
    readonly inventory: CapabilityInventory;
    /** Where the manifest `.ts` file will be written -- used to compute relative import specifiers, not written to here. */
    readonly location: string;
    /** Discovery root every `CapabilityNode.file` is relative to (OUT-01) -- needed to lift each capability back to a real absolute path before computing its import specifier from `location`'s own directory. */
    readonly root: string;
    /** This run's own snapshot of `inventory` -- see `buildManifestSnapshot`. Computed by the caller, once, shared with whatever else in the same run needs it (e.g. citation-verification's own baseline). */
    readonly snapshot: ManifestSnapshot;
    /** `snapshot` diffed against whatever snapshot preceded it -- see `diffManifestSnapshots`. Also computed by the caller; an all-added report on a first run. */
    readonly changes: ManifestChangeReport;
}

/** The rendered manifest plus everything needed to persist and diff it against a future run. */
export declare interface GenerateManifestResult {
    /** Where this manifest is intended to be written. */
    readonly location: string;
    /** The rendered `.ts` source. */
    readonly content: string;
    /** The current inventory's snapshot -- persist this to enable "changes since last report" on the next run. */
    readonly snapshot: ManifestSnapshot;
    /** The diff against `previousSnapshot`, or an all-added report on a first run. */
    readonly changes: ManifestChangeReport;
    /** Manifest-specific findings (e.g. `MANIFEST_EXPORT_NAME_COLLISION`). */
    readonly findings: readonly ReportFinding[];
}

/** Scans `options.files` for usage of every capability in `options.inventory`, then renders the Dependency & Ownership report (C5+C6). */
export declare function generateUsage(options: GenerateUsageOptions): Promise<GenerateUsageResult>;

/** Options for `generateUsage`. */
export declare interface GenerateUsageOptions {
    /** The inventory to scan usage for. */
    readonly inventory: CapabilityInventory;
    /** Output path for the rendered Dependency & Ownership report, or `undefined` when the caller only wants the scan's `edges`/`findings` (a `--flow`-without-`--ownership` run) and will not write the report. Echoed straight back as `result.location`. */
    readonly location: string | undefined;
    /** Every project file to scan as a potential consumer -- typically the same file list `discoverCapabilityFiles` produced, since a consumer need not itself declare a capability. */
    readonly files: readonly string[];
    /** Passed through to `scanDependencies` -- root/tsconfig/packages for import-specifier resolution. `scan.root` also doubles as the discovery root every rendered path in the report displays relative to. */
    readonly scan: ScanDependenciesOptions;
    /** This same run's own `--evidence` output path, when requested -- named in the generated banner's Evidence Model note. */
    readonly evidencePath?: string;
}

/** The rendered Dependency & Ownership report plus the proven `DependencyEdge`s and findings it's built from. */
export declare interface GenerateUsageResult {
    /** Where this report is intended to be written, or `undefined` when the caller requested only the scan results -- see `GenerateUsageOptions.location`. */
    readonly location: string | undefined;
    /** The rendered Markdown content. */
    readonly content: string;
    /** Every proven consumer relationship the scan found. */
    readonly edges: readonly DependencyEdge[];
    /** Ownership/usage findings derived from `edges` (e.g. `ABANDONED_CAPABILITY`). */
    readonly findings: readonly ReportFinding[];
    /** Parse/resolution warnings from the scan, never blocking. */
    readonly warnings: readonly ParseWarning[];
}

/**
 * Trusts the persisted evidence artifact at `options.location` only when its
 * paired `.fingerprint` sidecar matches a freshly (cheaply) computed
 * {@link computeSourceFingerprint} -- never on file presence alone, never on
 * a timestamp. On any mismatch (stale fingerprint, missing/corrupt evidence
 * file, no sidecar at all, an unrecognized `schemaVersion`), falls back to a
 * real `computeDataArtifacts()` call: never hard-fails, never silently
 * serves data that might be stale.
 *
 * @remarks
 * Never writes anything. A cache miss here does not self-heal the cache --
 * only an explicit generation run (`generateDataArtifacts()` with
 * `evidence`) refreshes the artifact and its fingerprint together, so "when
 * was this last regenerated" stays under explicit control rather than
 * becoming an implicit side effect of a read. Two callers hitting the same
 * stale cache both recompute independently; neither one's recompute changes
 * what the other reads.
 */
export declare function getEvidenceModel(options: GetEvidenceModelOptions): Promise<GetEvidenceModelResult>;

/**
 * Options for {@link getEvidenceModel} -- every `computeDataArtifacts()`
 * option, with `evidence` narrowed to required.
 *
 * Deliberately reuses `evidence` rather than introducing a separate
 * `location` for "where the cached artifact lives": that path and the path a
 * real run writes its Evidence Model to are the same file by definition, and
 * two option names for one file could disagree. (`location` was already
 * taken by the *manifest* output path on the base options -- reusing it here
 * would have quietly meant two different things depending on which function
 * read it.) Required, because there is no honest default `data-cap` could
 * guess at for where a project keeps this.
 */
export declare interface GetEvidenceModelOptions extends GenerateDataArtifactsOptions {
    /** Where the persisted evidence artifact (and its `.fingerprint` sidecar) live, e.g. `docs/data.evidence.json`. Resolved against `root` when relative. */
    readonly evidence: string;
}

/** The result of {@link getEvidenceModel}. */
export declare interface GetEvidenceModelResult {
    /** The Evidence Model -- read from the cached artifact on a hit, freshly computed on a miss. Identical in shape either way. */
    readonly evidence: EvidenceModel;
    /** `"hit"` -- the persisted artifact's fingerprint matched current source; read from disk, no recompute. `"miss"` -- a real `computeDataArtifacts()` call ran. */
    readonly source: "hit" | "miss";
    /** Set only when `source === "miss"` -- why the cache wasn't trusted, for a caller that wants to log it. Never a silent fallback. */
    readonly missReason: string | undefined;
}

/** Reads a property name statically (identifier, string literal, or numeric literal) -- a computed key (e.g. `[expr]`) resolves to `undefined` rather than being guessed at. */
export declare function getStaticPropertyName(name: ts.PropertyName): string | undefined;

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

/**
 * Groups `edges` by the capability each targets -- every capability in
 * `capabilities`, including one with zero edges (an `ABANDONED_CAPABILITY`
 * candidate, per `usage-report.ts`), sorted by file then exportName. Takes
 * `capabilities` as well as `edges`, unlike `groupEdgesByConsumer`: a
 * capability with no edges at all can never be discovered by iterating
 * `edges` alone.
 */
export declare function groupEdgesByCapability(capabilities: readonly {
    readonly file: string;
    readonly exportName: string;
}[], edges: readonly DependencyEdge[]): readonly DependencyModelCapabilityEdges[];

/**
 * Groups `edges` by the consuming file each originates from -- the inverse
 * of `groupEdgesByCapability`. Only files with at least one edge appear,
 * sorted by file. Takes `edges` alone: unlike a capability, a file is only
 * ever known to this projection because it produced at least one edge.
 */
export declare function groupEdgesByConsumer(edges: readonly DependencyEdge[]): readonly DependencyModelConsumer[];

/** One `import { X as Y } from "..."` (or namespace/default) binding found in a file's top-level statements. */
export declare interface ImportBinding {
    /** The name this binding is referenced by within the file (`Y` above). */
    readonly localName: string;
    /** The imported name, or the sentinel `"*"` (namespace import) / `"default"` (default import). */
    readonly importedName: string;
    /** The specifier exactly as written (`"..."` above) -- unresolved, relative or bare. */
    readonly moduleSpecifier: string;
}

/** One consuming file's import resolved against a `ScanTarget`. */
export declare interface ImportBindingMatch {
    /** The name this binding is referenced by within the consuming file. */
    readonly localName: string;
    /** Which capability this import resolved to. */
    readonly target: ScanTarget;
    /** `"unresolved-consumer"` when the match came from a same-name heuristic (the import specifier didn't resolve directly to the target's own file -- e.g. a barrel re-export) rather than a directly-resolved import. */
    readonly resolution: "resolved" | "unresolved-consumer";
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

/** Whether `content` starts with a `generatedBanner()`-produced marker, in either format. */
export declare function isGeneratedFile(content: string): boolean;

/** A minimal JSON-Schema-ish type descriptor -- only what can be honestly inferred from a literal default value. `{}` (no `type`) means "unrepresentable/unknown," never a guess. */
export declare type JsonSchemaLike = Record<string, unknown>;

/** Bump only when a reader could misinterpret the shape -- same discipline every other model's schema-version constant already documents. */
export declare const LIFECYCLE_MODEL_SCHEMA_VERSION = 1;

/** `data-cap`'s Lifecycle Model: declared expiry/deprecation/rename data, plus the expiring-soon view. */
export declare interface LifecycleModel {
    /** Always `LIFECYCLE_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof LIFECYCLE_MODEL_SCHEMA_VERSION;
    /** Only capabilities with at least one lifecycle-relevant field set, at the capability level or on at least one field. Sorted by `file` then `exportName`. */
    readonly capabilities: readonly LifecycleModelCapability[];
    /** Every capability-/field-level `expiresAt` within the configured window, soonest-first (already-expired entries sort first, since their `daysRemaining` is negative). */
    readonly expiring: readonly ExpiringEntry[];
}

/** One capability's declared lifecycle data, plus every lifecycle-bearing field under it. */
export declare interface LifecycleModelCapability {
    /** Root-relative POSIX path -- carried through verbatim from `CapabilityNode.file`. */
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
    /** Only fields with at least one lifecycle field set, sorted by path -- same "only what's relevant" scope the rendered report uses. */
    readonly fields: readonly LifecycleModelField[];
}

/** One field's declared lifecycle data. Only fields with at least one of these set appear in the model at all. */
export declare interface LifecycleModelField {
    /** The field's path within its capability -- `readonly string[]`, matching every other model's field addressing (never a flat key string). */
    readonly path: readonly string[];
    /** Declared ISO-8601 expiry, unparsed and uninterpreted here. */
    readonly expiresAt: string | undefined;
    /** Whether the field is documented as deprecated. */
    readonly deprecated: boolean | undefined;
    /** Why it's deprecated, when stated. */
    readonly deprecatedReason: string | undefined;
    /** Declared ISO-8601 removal deadline -- field-level only (see `core/document.ts`). */
    readonly removeBy: string | undefined;
    /** The field's previous name, when authored -- what `ChangeModel.renamedFields` correlates against. */
    readonly renamedFrom: string | undefined;
    /** Declared retention policy -- a policy statement, deliberately independent of `expiresAt`'s temporal constraint (a field can be retained long after its source credential expires, and vice versa). */
    readonly retention: string | undefined;
}

/**
 * Discovers and links every `buildData()`/`createData()`/`documentData()` call across `files`, resolving field shapes and cross-file/aliased references.
 */
export declare function linkCapabilityFiles(files: readonly string[], options: LinkOptions): Promise<LinkResult>;

/** Options for `linkCapabilityFiles`. */
export declare interface LinkOptions {
    /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
    readonly fs: BuildFileSystem;
    /** Directory import specifiers/tsconfig auto-detection resolve against. */
    readonly root: string;
    /** Explicit `tsconfig.json` path override, or `false` to disable alias resolution. Defaults to auto-detecting `root/tsconfig.json`. */
    readonly tsconfig?: string | false;
    /** Explicit cross-package schema discovery allowlist -- see `resolve-package-schema.ts`. */
    readonly packages?: readonly string[];
}

/** Every capability discovered and linked across the project, plus every warning encountered along the way. */
export declare interface LinkResult {
    /**
     * The discovery root this result was produced against (`LinkOptions.root`),
     * carried through so `buildInventory` can publish every `file` root-relative
     * without a second, separately-supplied copy of the same fact that could
     * disagree with the one linking actually used (OUT-01; see
     * `display-path.ts`).
     */
    readonly root: string;
    /** Every discovered, linked capability -- each `file` still ABSOLUTE here, since linking itself does real filesystem work. Relativized once, at model construction, by `buildInventory`. */
    readonly capabilities: readonly DiscoveredCapability[];
    /** Parse/link warnings, never blocking. */
    readonly warnings: readonly ParseWarning[];
}

/** The result of statically evaluating one AST expression -- `ok: false` when the expression falls outside the allow-listed literal grammar, never guessed at. */
export declare type LiteralEvalResult = {
    /** Always `true` for this variant. */
    readonly ok: true;
    /** The evaluated literal value. */
    readonly value: unknown;
} | {
    /** Always `false` for this variant. */
    readonly ok: false;
};

/**
 * One finding, with its structured `location` computed -- and *only* that
 * (OUT-02). A rule/scan emits a `ReportFinding` carrying the raw, optional
 * `capability`/`field`/`operation`/`source`/`position`/`indeterminateSites`
 * locators (see `findings.ts`); `locationOf` resolves all six into one
 * required, structured `location`, and this type then drops them, so a
 * consumer has exactly one path to "where does this point" instead of a
 * structured answer sitting next to six flat ones that say the same thing
 * (and could drift apart under a hand-constructed value). Two names for one
 * lineage: emit a `ReportFinding`, consume a `LocatedFinding`.
 */
export declare type LocatedFinding = Omit<ReportFinding, FlatLocators> & {
    readonly location: FindingLocation;
};

/** Computes one finding's structured `location` from its existing optional locator fields. */
export declare function locationOf(finding: ReportFinding): FindingLocation;

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
 * names -- but this module (and `inventory.ts`/`link.ts`, which reuse this
 * exact type) deals only in already-parsed AST facts, with no compile-time
 * schema of its own to check against. `LooseCapabilityDocs` is the build-
 * tool-internal equivalent of "structurally shaped like docs, unconstrained"
 * the old bare `Record<string, unknown>` parameter gave: every OTHER
 * property comes from `CapabilityDocs` itself (via `Omit`), but
 * `fields`/`getters`/`mutators`/`subscriptions` are redeclared as plain
 * `Record<string, X>` maps rather than routed through `CapabilityDocs`'
 * own `keyof`-checked generics -- `DataSchema`'s `getters`/etc. are
 * themselves optional properties, which resolve to "no keys allowed" (not
 * "any key allowed") once `CapabilityDocs` requires a concrete schema type,
 * exactly backwards from what an unconstrained AST-parsed fact needs here.
 */
/**
 * Every property here is always assigned (never conditionally omitted --
 * see extractCapabilityDocs()/extractOperationDocsMap()/
 * extractEvidenceFieldsMap() below), just sometimes with an `undefined`
 * value when the AST literal didn't declare it. exactOptionalPropertyTypes
 * distinguishes "key absent" from "key present holding undefined";
 * widening every property to explicitly include `| undefined` (rather than
 * routing every assignment through a conditional-spread "omit if absent"
 * instead) matches what this type actually represents: a raw,
 * unconstrained parse result, not a validated CapabilityDocs.
 */
declare type Loosen<T> = {
    readonly [K in keyof T]?: T[K] | undefined;
};

/** One capability whose snapshot shape changed between two runs. */
export declare interface ManifestCapabilityUpdate {
    /** The capability key (`file#exportName`) that changed. */
    readonly capability: string;
    /** Human-readable description of each individual change (e.g. `"owner changed from ... to ..."`). */
    readonly changes: readonly string[];
    /**
     * The same field-level diff `changes` describes in prose, as data (EVD-05).
     * Added so `ChangeModel`'s rename correlation has something to match
     * against without re-parsing a human-readable sentence -- a report
     * deriving structure back out of its own prose is exactly the kind of
     * fragility this codebase avoids. `changes` is unaffected and still reads
     * the same.
     */
    readonly fields: ManifestFieldDiff;
}

/** The diff between two `ManifestSnapshot`s, in a fixed Added/Removed/Updated shape. */
export declare interface ManifestChangeReport {
    /** Capability keys present in the new snapshot but not the previous one. */
    readonly addedCapabilities: readonly string[];
    /** Capability keys present in the previous snapshot but not the new one. */
    readonly removedCapabilities: readonly string[];
    /** Capability keys present in both snapshots whose shape changed. */
    readonly updatedCapabilities: readonly ManifestCapabilityUpdate[];
}

/** The structured added/removed field-name diff for one changed capability. */
export declare interface ManifestFieldDiff {
    /** Field names present now but not in the previous snapshot, sorted. */
    readonly added: readonly string[];
    /** Field names present in the previous snapshot but not now, sorted. */
    readonly removed: readonly string[];
}

/** A persisted, JSON-serializable snapshot of the inventory at one point in time -- see `buildManifestSnapshot`. */
export declare interface ManifestSnapshot {
    /** Bumped only on a breaking change to this snapshot's own shape. Bumped 1 -> 2 by OUT-01: every capability key (`file#exportName`) is now built from a root-relative `file`, so a v1 snapshot's keys can never match a v2 run's. */
    readonly snapshotSchemaVersion: 2;
    /** Every capability, active or not, at snapshot time. */
    readonly capabilities: readonly ManifestSnapshotCapability[];
}

/** One capability's diffable shape at snapshot time -- field/operation names only, never their runtime values. */
export declare interface ManifestSnapshotCapability {
    /** Root-relative POSIX path of the file declaring this capability -- copied verbatim from `CapabilityNode.file` (OUT-01, see `display-path.ts`), which is what makes a committed snapshot diffable between two machines at all. */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
    /** Whether the capability was active at snapshot time. */
    readonly active: boolean;
    /** Resolved owner at snapshot time, if any. */
    readonly owner: string | undefined;
    /** Sorted, dot-joined field paths. */
    readonly fields: readonly string[];
    /** Sorted getter names. */
    readonly getters: readonly string[];
    /** Sorted mutator names. */
    readonly mutators: readonly string[];
    /** Sorted subscription names. */
    readonly subscriptions: readonly string[];
    /** Per-field citation integrity snapshots for declared `evidence.fields[key].dynamicAccess` entries, keyed by field name -- only present for a field that declares at least one citation that resolved to a real file at snapshot time (see `citation-verification.ts`). */
    readonly citationSnapshots?: Readonly<Record<string, readonly CitationSnapshotEntry[]>>;
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

/** An OpenAPI 3.1 document's `components.schemas` shape -- see this module's own doc comment for what's deliberately not included. */
export declare interface OpenApiSchemaArtifact {
    readonly openapi: "3.1.0";
    readonly info: {
        readonly title: string;
        readonly version: string;
    };
    readonly components: {
        readonly schemas: Readonly<Record<string, JsonSchemaLike>>;
    };
}

/**
 * Documentation metadata for one getter/mutator/subscription. Reserved keys
 * are explicitly typed (mirroring the vocabulary real capabilities tend to
 * document -- what it does, where it talks to, what it costs to call) while
 * still accepting arbitrary extra keys for anything project-specific, so
 * documenting never fights the type checker.
 *
 * `credentials` is descriptive only -- documenting `credentials: "user
 * session"` is never proof that authorization is actually enforced.
 * `endpoints` is likewise author-declared, never verified.
 */
declare interface OperationDocs {
    /** What this operation does. */
    readonly description?: string;
    /** Short identifier for where this operation acquires/sends data (e.g. `"stripe-api"`, `"postgres:users"`), not prose. */
    readonly source?: string;
    /** What's required to call this operation -- descriptive only, never an authorization/enforcement claim. */
    readonly credentials?: string;
    /** Documented shape of what this operation returns/produces. */
    readonly response?: string;
    /** Declared data-flow boundaries this operation crosses -- see `DataFlowEndpoint`. */
    readonly endpoints?: readonly DataFlowEndpoint[];
    /**
     * Free-form extension bag for anything data-cap itself has no named
     * concept for -- opaque, never inspected or validated by any code path in
     * this package. The index signature below remains for the same reason it
     * always has (documenting never fights the type checker); `metadata` is
     * the recommended place for new extension data going forward.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly [key: string]: unknown;
}

/** Static operation names discovered on a `createData(...)` call's config object literal -- names (AST object keys) only, never the operations' own function bodies. `undefined` for a `buildData(...)` call, which never has these sections. */
export declare interface OperationNames {
    /** Getter names. */
    readonly getters: readonly string[];
    /** Mutator names. */
    readonly mutators: readonly string[];
    /** Subscription names. */
    readonly subscriptions: readonly string[];
}

/** One getter/mutator/subscription operation, resolved from the inventory's shared model. */
export declare interface OperationNode {
    /** Which kind of operation this is. */
    readonly kind: "getter" | "mutator" | "subscription";
    /** The operation's key name. */
    readonly name: string;
    /** This operation's own declared documentation, if any. */
    readonly docs: OperationDocs | undefined;
    /** Top-level field paths this operation's statically-extracted `writes` shape covers. Empty when `writes` was absent (on a getter/subscription) or unresolvable -- never guessed at. */
    readonly writes: readonly (readonly string[])[];
    /** Whether this operation's config object literal declares a `processor` key -- a proven, structural presence fact (never an evaluation of what the processor does; see ADR 0050). */
    readonly hasProcessor: boolean;
    /** Whether this operation's config object literal declares an `optimistic` key -- structurally always `false` for a getter/subscription. */
    readonly hasOptimistic: boolean;
    /** Hoisted from `docs.endpoints` for convenient lookup -- author-declared, never statically verified. */
    readonly endpoints: readonly DataFlowEndpoint[];
}

/** `RawOperationPresence` entries grouped by operation kind, mirroring `OperationNames`'/`OperationWritesByKind`'s shape. */
export declare interface OperationPresenceByKind {
    /** Getters' extracted presence facts. */
    readonly getters: readonly RawOperationPresence[];
    /** Mutators' extracted presence facts. */
    readonly mutators: readonly RawOperationPresence[];
    /** Subscriptions' extracted presence facts. */
    readonly subscriptions: readonly RawOperationPresence[];
}

/** `RawOperationWrites` entries grouped by operation kind, mirroring `OperationNames`' shape. */
export declare interface OperationWritesByKind {
    /** Getters' extracted `writes` shapes. */
    readonly getters: readonly RawOperationWrites[];
    /** Mutators' extracted `writes` shapes. */
    readonly mutators: readonly RawOperationWrites[];
    /** Subscriptions' extracted `writes` shapes. */
    readonly subscriptions: readonly RawOperationWrites[];
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

/** Bump only when a reader could misinterpret the shape -- same discipline every other model's schema-version constant already documents. Bumped 1 -> 2 by OUT-01: `OwnershipCapabilityRef.file` is now root-relative, not absolute. */
export declare const OWNERSHIP_MODEL_SCHEMA_VERSION = 2;

/** Identifies one capability by where it's declared. */
export declare interface OwnershipCapabilityRef {
    /** Root-relative POSIX path of the file declaring this capability -- carried through verbatim from `CapabilityNode.file` (see `display-path.ts`). */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
}

/** Identifies one field, owned by a specific capability. */
export declare interface OwnershipFieldRef {
    /** The capability that owns this field. */
    readonly capability: OwnershipCapabilityRef;
    /** The field's path within its capability. */
    readonly field: readonly string[];
}

/** One owner's row in the ownership matrix -- every capability and field they're accountable for. */
export declare interface OwnershipMatrixEntry {
    /** The owner's name, or `UNOWNED`. */
    readonly owner: string;
    /** Capabilities this owner is accountable for at the capability level. */
    readonly capabilities: readonly OwnershipCapabilityRef[];
    /** Individual fields (on capabilities not wholly owned by this owner) they're accountable for. */
    readonly fields: readonly OwnershipFieldRef[];
}

/** `data-cap`'s Ownership Model: the owner -> {capabilities, fields} matrix, versioned for JSON publication. */
export declare interface OwnershipModel {
    /** Always `OWNERSHIP_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof OWNERSHIP_MODEL_SCHEMA_VERSION;
    /** Every owner's row -- see `buildOwnershipMatrix`. */
    readonly entries: readonly OwnershipMatrixEntry[];
}

/**
 * Parses one file's top-level statements only (matching `buildData`'s/
 * `createData`'s own intended usage: called once, at module scope, and
 * exported). Nested/conditional/dynamically-constructed calls are not this
 * module's concern -- they cannot be statically discovered and are simply
 * never found, never guessed at.
 */
export declare function parseCapabilityFile(filePath: string, sourceText: string): ParseResult;

/** Everything statically extracted from one source file's AST, before any cross-file linking. */
export declare interface ParseResult {
    /** Absolute path of the parsed file. */
    readonly file: string;
    /** Every `buildData(...)`/`createData(...)` call found in this file. */
    readonly createDataCalls: readonly RawCreateDataCall[];
    /** Every `documentData(...)` call found in this file. */
    readonly documentDataCalls: readonly RawDocumentDataCall[];
    /** Top-level `const X = <expr>` bindings, keyed by name -- for resolving an `identifier`-kind `SchemaRef` within the same file. */
    readonly localConsts: ReadonlyMap<string, ts.Expression>;
    /** Every top-level import binding found in this file. */
    readonly imports: readonly ImportBinding[];
    /** Extraction problems encountered while parsing this file -- never thrown, always collected. */
    readonly warnings: readonly ParseWarning[];
}

/** A recoverable issue found while statically parsing or linking one capability file -- never fatal, always surfaced to the caller as data. */
export declare interface ParseWarning {
    /** Absolute path (or synthetic label, e.g. `"(package) name"`) the warning applies to. */
    readonly file: string;
    /** Human-readable explanation of what was skipped and why. */
    readonly message: string;
}

/** The one place a `SourcePosition` is ever computed from a raw AST node -- every caller reuses this instead of hand-rolling `getLineAndCharacterOfPosition` arithmetic. */
export declare function positionOf(sourceFile: ts.SourceFile, node: ts.Node): SourcePosition;

/** One capability or field's declared privacy-relevant facts. */
export declare interface PrivacyEntry {
    readonly capability: {
        readonly file: string;
        readonly exportName: string;
    };
    readonly field: readonly string[] | undefined;
    readonly sensitivity: string;
    readonly protectionsDocumented: boolean;
}

/**
 * Data Audit Evidence / Data Assurance Report / Data Governance Report
 * (reframed): a rollup of ownership and finding counts plus provenance --
 * never a governance verdict or a risk score, only the counted facts a
 * consumer's own policy can be evaluated against.
 *
 * The clearest case for the per-field schema: `ownedCapabilities` is derived
 * from Ownership Model alone, `findingsBySeverity` from Finding Model alone,
 * and `provenance` from neither. `.project()` reports exactly that, per
 * output field.
 */
export declare const projectAuditEvidence: EvidenceProjection<    {
disclaimer: string;
provenance: EvidenceProvenance;
capabilityCount: number;
ownedCapabilities: number | undefined;
unownedCapabilities: number | undefined;
findingsBySeverity: Record<string, number> | undefined;
}>;

/** Data Classification Evidence: every capability/field with a declared `sensitivity`. */
export declare const projectClassificationEvidence: EvidenceProjection<    {
disclaimer: string;
entries: readonly ClassificationEntry[];
}>;

/** Data Compliance Evidence: every capability's declared `metadata` bag, unvalidated -- `data-cap` asserts no regime applies. */
export declare const projectComplianceEvidence: EvidenceProjection<    {
disclaimer: string;
entries: readonly ComplianceEntry[];
}>;

/** Every field across every capability -- the Field Inventory Report. */
export declare function projectFields(inventory: CapabilityInventory): readonly WithCapability<FieldNode>[];

/** Every getter across every capability -- the Getter Report. */
export declare function projectGetters(inventory: CapabilityInventory): readonly WithCapability<OperationNode>[];

/** Every mutator across every capability -- the Mutator Report. */
export declare function projectMutators(inventory: CapabilityInventory): readonly WithCapability<OperationNode>[];

/** Every getter, mutator, and subscription across every capability -- the Operation Inventory Report. */
export declare function projectOperationInventory(inventory: CapabilityInventory): readonly WithCapability<OperationNode>[];

/** Data Privacy Evidence: sensitivity plus whether protections are documented (presence only, never an adequacy claim). */
export declare const projectPrivacyEvidence: EvidenceProjection<    {
disclaimer: string;
entries: readonly PrivacyEntry[];
}>;

/** Data Retention Evidence: every capability/field with a declared `retention` policy (presence only, never an enforcement claim). */
export declare const projectRetentionEvidence: EvidenceProjection<    {
disclaimer: string;
entries: readonly RetentionEntry[];
}>;

/** Every subscription across every capability -- the Subscription Report. */
export declare function projectSubscriptions(inventory: CapabilityInventory): readonly WithCapability<OperationNode>[];

/** One `buildData(...)`/`createData(...)` call found in a file's top-level statements. */
export declare interface RawCreateDataCall {
    /** The exported binding name (`export const X = buildData(...)`), or `undefined` if unexported -- see the accompanying warning in that case. */
    readonly exportName: string | undefined;
    /** `"buildData"` or `"createData"` -- which call form this is. */
    readonly kind: "buildData" | "createData";
    /** How this call's `fields` argument resolves within this one file. */
    readonly fieldsRef: SchemaRef;
    /** Static getter/mutator/subscription names, or `undefined` for a `buildData()` call. */
    readonly operationNames: OperationNames | undefined;
    /** Static `writes` field-ownership shapes, keyed the same way as `operationNames`. `undefined` for a `buildData()` call, which has no operations section. */
    readonly operationWrites: OperationWritesByKind | undefined;
    /** Static `processor`/`optimistic` key-presence facts, keyed the same way as `operationNames`. `undefined` for a `buildData()` call, which has no operations section. */
    readonly operationPresence: OperationPresenceByKind | undefined;
    /** The full call expression AST node, for later structural inspection. */
    readonly node: ts.CallExpression;
    /** Position of this call's own declaration site -- always available, since `node` always resolves to a real AST location regardless of how `fields` itself resolves. */
    readonly declarationPosition: SourcePosition;
    /** Position of each top-level field's own key, keyed by field name -- only when `fieldsRef.kind === "literal"` (an identifier-resolved `fields` crosses a file boundary this pass doesn't retain AST access to; `undefined` there, never guessed at). */
    readonly fieldPositions: Readonly<Record<string, SourcePosition>> | undefined;
}

/** One `documentData(...)` call found in a file's top-level statements. */
export declare interface RawDocumentDataCall {
    /** How this call's first (`fields` reference) argument resolves within this one file. */
    readonly fieldsRef: SchemaRef;
    /** The second (`docs`) argument, for later structural inspection -- not evaluated here. */
    readonly docsNode: ts.Expression | undefined;
    /** The full call expression AST node, for later structural inspection. */
    readonly node: ts.CallExpression;
}

/**
 * One operation's statically-detected presence of a `processor`/`optimistic`
 * key on its config object literal -- a structural AST-key-presence check,
 * the same technique `extractOperationWrites` already uses for `writes`,
 * never an evaluation of what the function actually does (ADR 0002 stays
 * fully honored: this can tell a `processor` key exists without knowing
 * anything about what it computes). See ADR 0050.
 */
export declare interface RawOperationPresence {
    /** The operation's key name. */
    readonly name: string;
    /** Whether this operation's config object literal has a `processor` key at all. */
    readonly hasProcessor: boolean;
    /** Whether this operation's config object literal has an `optimistic` key at all -- structurally always `false` for a getter/subscription, since `GetterDefinition`/`SubscriptionDefinition` never declare one. */
    readonly hasOptimistic: boolean;
}

/** One operation's statically-extracted `writes` field-ownership shape -- `true` (owns the whole capability), a nested plain object mirroring `FieldOwnership<T>` (untyped, since this is extracted data), or `undefined` when it couldn't be determined (never guessed at). */
export declare interface RawOperationWrites {
    /** The operation's key name. */
    readonly name: string;
    /** The extracted `writes` value, unvalidated against the actual `fields` shape. */
    readonly writes: unknown;
}

/** One added-field/removed-field pair correlated into a single rename via the current declaration's `renamedFrom` (EVD-05). */
export declare interface RenamedField {
    /** The owning capability's key (`file#exportName`) -- a rename never crosses capabilities. */
    readonly capability: string;
    /** The field's name before the rename -- matches a `removed` entry in that capability's own field diff. */
    readonly previousName: string;
    /** The field's name after the rename -- matches an `added` entry in the same diff. */
    readonly currentName: string;
}

/** Renders a diagram scoped to one capability's own fields. `root` is the discovery root every rendered path displays relative to. */
export declare function renderCapabilityDiagram(capability: CapabilityNode, flows: readonly FieldFlow[], root: string): string;

/**
 * Renders Dependency Model as a DOT digraph: one node per capability, one
 * node per consuming file, edges labeled by relationship. `capabilities`
 * supplies the full capability list -- since `model.edges` alone can never
 * reveal a capability with zero edges, this is what lets a genuinely
 * unconsumed capability still appear as a node (see `groupEdgesByCapability`,
 * ADR 0056).
 */
export declare function renderDependencyGraphDot(capabilities: readonly {
    readonly file: string;
    readonly exportName: string;
}[], model: DependencyModel): string;

/**
 * Renders the full Markdown documentation catalog. `root` is the discovery
 * root every rendered path displays relative to (see `display-path.ts`).
 * `changes` is optional -- omit it (or pass `undefined`) when there's no
 * previous snapshot to compare against. `edges` is likewise optional: it's
 * only ever available when the caller also ran the (more expensive) usage
 * scan `--ownership`/`--flow` trigger -- `--docs` requested alone renders
 * exactly as before, with the "Consumed at" column showing "(not scanned)"
 * rather than a false "(none found)". `evidencePath` names this same run's
 * own `--evidence` output, when it requested one, in the banner note.
 */
export declare function renderDocumentation(inventory: CapabilityInventory, root: string, changes?: ManifestChangeReport, edges?: readonly DependencyEdge[], evidencePath?: string, lifecycle?: LifecycleModel): string;

/**
 * Renders the manifest source text for every active capability in
 * `inventory`, importing each from `outputPath`'s own directory. Two
 * capabilities exporting the same identifier name from different files
 * produce a real name collision in the generated output -- surfaced to the
 * caller as a `ReportFinding` by `generate-manifest.ts`, not silently
 * renamed here (renaming would make the manifest's export names diverge
 * from the capability's own declared name, which is worse).
 *
 * This is the trickiest consumer of OUT-01's root-relative
 * `CapabilityNode.file`: an import specifier is relative to the *output
 * file's own directory*, not to `root`, so neither path can be used
 * directly. Both sides are lifted to absolute first (`outputPath` already
 * is; `capability.file` via `absolutePathFrom(root, ...)`) and only then
 * related to each other -- which also keeps a `--package`-discovered
 * capability living outside `root` working exactly as before, since
 * `absolutePathFrom` returns such a path unchanged.
 *
 * Emitted as `import` + a single `export {...}`, not as `export {...} from`:
 * a re-export forwards a binding without introducing a local one, so
 * `manifest`'s own array literal below would reference names that don't
 * exist in the emitted module's scope. That was invisible while the
 * conventional output path (`docs/`) sat outside every example's own
 * `tsconfig` `include`; moving it to `src/generated/` (OUT-03) put the
 * generated file under a real type-check for the first time and surfaced it
 * immediately.
 */
export declare function renderManifest(inventory: CapabilityInventory, outputPath: string, root: string): string;

/** Renders the whole-system overview diagram: every active capability, its declared endpoints, and its proven consumers. `root` is the discovery root every rendered path (consumer node labels, proven-edge labels) displays relative to. */
export declare function renderOverviewDiagram(capabilities: readonly CapabilityNode[], flows: readonly FieldFlow[], root: string): string;

/** Renders Ownership Model as a DOT digraph: one node per owner, one node per capability/field they're accountable for. */
export declare function renderOwnershipGraphDot(model: OwnershipModel): string;

/** Renders a diagram scoped to every field at a given sensitivity level, across every capability. `root` is the discovery root every rendered path displays relative to. */
export declare function renderSensitivityDiagram(level: string, capabilities: readonly CapabilityNode[], flows: readonly FieldFlow[], root: string): string;

/**
 * Renders the full "Dependency & Ownership Report." `root` is the discovery
 * root every rendered path displays relative to (see `display-path.ts`).
 * `evidencePath` names this same run's own `--evidence` output, when it
 * requested one, in the banner note.
 */
export declare function renderUsageReport(inventory: CapabilityInventory, edges: readonly DependencyEdge[], root: string, scannedPackages?: readonly string[], evidencePath?: string): string;

/**
 * One reportable fact about the discovered capability graph. `severity` is
 * assigned by the rule that produces the finding, following the two
 * governing invariants in AGENTS.md: static analysis never infers a
 * relationship from insufficient evidence (an ambiguous case is `info` or
 * `indeterminate`-flavored, never guessed at as `error`), and a finding
 * built from declared metadata (e.g. a missing `protections` field) never
 * claims more than "documented" vs. "not documented."
 */
export declare interface ReportFinding {
    /** Which kind of fact this finding reports. */
    readonly code: ReportFindingCode;
    /** Which analysis pass produced this finding -- see `ReportFindingFamily`. */
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
    /** Position of the declaration site (capability's own call, or field's own key) this finding is anchored to, when one is available -- see ADR 0052. Additive: absent for findings with no single declaration-site anchor (e.g. a usage-scan finding whose subject is a consuming file, not a declaration). */
    readonly position?: SourcePosition;
    /** Every candidate access site a `"FIELD_ACCESS_INDETERMINATE"` finding could actually be about -- populated only for that code. Spans potentially multiple consuming files, so each entry carries its own `file` (`SourceLocation`, not just `SourcePosition`). */
    readonly indeterminateSites?: readonly SourceLocation[];
}

/** Every kind of fact a static rule or usage-scan/data-flow pass can report. */
export declare type ReportFindingCode = "CAPABILITY_MISSING_OWNER" | "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS" | "SENSITIVE_FIELD_MISSING_PROTECTIONS" | "SENSITIVE_FIELD_MISSING_PURPOSE" | "SENSITIVE_FIELD_MISSING_LEGAL_BASIS" | "AUDIT_REQUIRED_WITHOUT_OWNER" | "NONSTANDARD_SENSITIVITY_LEVEL" | "EXCLUSIVE_GROUP_VIOLATION" | "MANIFEST_EXPORT_NAME_COLLISION" | "DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES" | "DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES" | "ABANDONED_CAPABILITY" | "UNCONSUMED_FIELD" | "FIELD_ACCESS_INDETERMINATE" | "FIELD_DYNAMIC_ACCESS_DECLARED" | "MISSING_DYNAMIC_ACCESS_CITATION" | "STALE_DYNAMIC_ACCESS_CITATION" | "UNRESOLVED_CONSUMER" | "INDETERMINATE_CONSUMER" | "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY" | "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING";

/**
 * Which analysis pass a finding came out of -- an orthogonal axis to
 * `severity` (how much it matters) and `code` (exactly what it is).
 *
 * This is what makes the `--strict*` flags' own groupings legible in the
 * output rather than only in the orchestrator's source: `--strict-docs`
 * escalates `"governance"`/`"structural"`/`"citation"`, `--strict-ownership`
 * escalates `"usage"`, `--strict-flow` escalates `"flow"`. A consumer
 * filtering a report ("show me only what a usage scan proved") currently has
 * to hardcode a list of `ReportFindingCode`s and keep it in sync by hand;
 * `family` makes that a real, stable field instead.
 *
 * Deliberately assigned at the emission site, never derived from `code` by a
 * lookup table: the rule that produces a finding is the only thing that
 * actually knows which pass it belongs to, and a table would be a second
 * source of truth to drift out of sync (the same reasoning that keeps
 * `severity` at the emission site).
 */
export declare type ReportFindingFamily = 
/** Declared-metadata quality: ownership, sensitivity, purpose, legal basis, audit trail (`static-rules.ts`). */
"governance"
/** The shape of the capability graph itself: exclusive-group conflicts, duplicate field shapes/endpoints, manifest export collisions. */
| "structural"
/** Requires a real usage scan to conclude anything: abandoned capabilities, unconsumed fields, consumer resolution (`usage-report.ts`). */
| "usage"
/** A developer-supplied `dynamicAccess` citation's own current integrity (`citation-verification.ts`). */
| "citation"
/** Declared data-flow boundary crossings for sensitive fields (`flow-graph.ts`). */
| "flow";

/** Everything one `generateDataArtifacts`/`checkArtifacts` run produced or would produce. */
export declare interface ReportResult {
    /** Present only when `--location` was requested. */
    readonly manifest: GenerateManifestResult | undefined;
    /** Present only when `--docs` was requested. */
    readonly documentation: GenerateDocumentationResult | undefined;
    /**
     * Always present (F1): the usage scan (proven consumption positions,
     * dependency edges, ownership/abandonment findings) runs on every call
     * regardless of which flags were passed -- it's foundational evidence the
     * Dependency Model needs, not something only `--ownership`/`--flow`
     * consumers should get. `--ownership` only controls whether the rendered
     * report additionally gets *written to disk* (`usage.location`) --
     * `usage` itself, and its `edges`/`findings`, are always real.
     */
    readonly usage: GenerateUsageResult;
    /** Present only when `--flow` was requested. */
    readonly flow: GenerateFlowResult | undefined;
    /**
     * `data-cap`'s Evidence Model (ADR 0050), composed from this same run's
     * `inventory`/`usage`/`manifest`/`findings` -- always present, unlike
     * `manifest`/`documentation`/`usage`/`flow` above, since composing it
     * costs nothing beyond data already held in memory. `--evidence` only
     * controls whether it's *additionally written to disk*; every consumer
     * of `ReportResult` (including `--json`) already gets the real, composed
     * model on every run, whether or not a file was requested for it.
     */
    readonly evidence: EvidenceModel;
    /** Every finding across every requested generator, after `--strict*` escalation. */
    readonly findings: readonly ReportFinding[];
    /** Parse/link warnings from discovery, never blocking. */
    readonly warnings: readonly ParseWarning[];
    /** Count of `findings` at `error` severity. */
    readonly errorCount: number;
    /** Count of `findings` at `warning` severity. */
    readonly warningCount: number;
    /** Count of `findings` at `info` severity. */
    readonly infoCount: number;
    /** True when `errorCount > 0` -- `generateDataArtifacts` throws instead of writing when this is true. */
    readonly hasBlockingErrors: boolean;
}

/** How strongly a finding should be treated: `info` never blocks, `warning` blocks only under `--strict*`, `error` always blocks. */
export declare type ReportSeverity = "info" | "warning" | "error";

/** One top-level field of a capability, resolved from the inventory's shared model. */
/**
 * One resolved governance value plus its provenance (ADR 0057) -- the one path a
 * `FieldNode` consumer reads for a governed property, replacing what used to require
 * separately checking a bare resolved property AND `field.docs.X` to get the full
 * picture. `declaredOn: undefined` means neither the field nor its capability
 * declared a value at all (`value` is then also `undefined`).
 */
export declare interface ResolvedGovernanceValue<T> {
    /** The effective value: the field's own declaration, else the capability's. */
    readonly value: T | undefined;
    /** Where `value` came from. */
    readonly declaredOn: "field" | "capability" | undefined;
}

/** One capability or field's declared retention policy. */
export declare interface RetentionEntry {
    readonly capability: {
        readonly file: string;
        readonly exportName: string;
    };
    readonly field: readonly string[] | undefined;
    readonly retention: string;
}

/** Bump only when a reader could misinterpret the shape -- same discipline every other model's schema-version constant already documents. */
export declare const RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION = 1;

/** `data-cap`'s Runtime Contract Model: the package's own documented execution guarantees. */
export declare interface RuntimeContractModel {
    /** Always `RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION`. */
    readonly schemaVersion: typeof RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION;
    /** The `data-cap` package version this model describes -- read from `package.json`, the same way `cli/json.ts`'s `TOOL_VERSION` is. */
    readonly packageVersion: string;
    /** Every documented runtime policy fact. */
    readonly policies: readonly RuntimePolicyFact[];
}

/** One documented runtime guarantee, traced to the ADR that governs it. */
export declare interface RuntimePolicyFact {
    /** A short, stable identifier for this fact (e.g. `"getter-concurrency"`). */
    readonly key: string;
    /** Human-readable statement of the guarantee. */
    readonly statement: string;
    /** The ADR number (e.g. `"0024"`) that governs this fact -- always a real file under `specs/decisions/`. */
    readonly governingAdr: string;
    /** The source file that implements this guarantee, root-relative. */
    readonly module: string;
}

/** SARIF's `level` enum -- see the SARIF 2.1.0 spec, section 3.27.10. */
declare type SarifLevel = "none" | "note" | "warning" | "error";

declare interface SarifLocation {
    readonly physicalLocation: {
        readonly artifactLocation: {
            readonly uri: string;
        };
    };
}

/** A minimal SARIF 2.1.0 log -- only the properties this adapter actually populates, not the full spec surface. */
export declare interface SarifLog {
    readonly $schema: string;
    readonly version: "2.1.0";
    readonly runs: readonly {
        readonly tool: {
            readonly driver: {
                readonly name: string;
                readonly informationUri: string;
                readonly version: string;
                readonly rules: readonly {
                    readonly id: string;
                }[];
            };
        };
        readonly results: readonly SarifResult[];
    }[];
}

declare interface SarifResult {
    readonly ruleId: string;
    readonly level: SarifLevel;
    readonly message: {
        readonly text: string;
    };
    readonly locations?: readonly SarifLocation[];
}

/**
 * Scans `files` for usage of every capability in `targets`, producing the
 * proven `DependencyEdge`s (and any resolution warnings) the ownership/
 * usage report renders. Never mutates or writes anything.
 */
export declare function scanDependencies(files: readonly string[], targets: readonly ScanTarget[], options: ScanDependenciesOptions): Promise<ScanDependenciesResult>;

/** Options for `scanDependencies`. */
export declare interface ScanDependenciesOptions {
    /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
    readonly fs: BuildFileSystem;
    /** Directory import specifiers resolve against. */
    readonly root: string;
    /** Explicit `tsconfig.json` path override, or `false` to disable alias resolution -- same meaning as `LinkOptions.tsconfig`. */
    readonly tsconfig?: string | false;
    /** Explicit cross-package schema discovery allowlist -- see `resolve-package-schema.ts`. */
    readonly packages?: readonly string[];
}

/** Every proven consumer edge the scan found, plus any resolution warnings. */
export declare interface ScanDependenciesResult {
    /** Every proven consumer relationship found. */
    readonly edges: readonly DependencyEdge[];
    /** Resolution warnings encountered during the scan, never blocking. */
    readonly warnings: readonly ParseWarning[];
    /** Allow-listed package names whose own directory was actually walked and scanned as potential consumer source -- the honest "what was actually searched" boundary a "field is unconsumed" conclusion is scoped to (ADR 0053). A package listed in `options.packages` but not resolvable (see `warnings`) is never silently counted as scanned. */
    readonly scannedPackages: readonly string[];
}

/**
 * Walks `sourceFile`'s full AST (not just top-level statements, unlike
 * `parseCapabilityFile`) for every reference to a local name in `matches`,
 * producing one `DependencyEdge` per recognized access pattern found. A
 * binding's own import declaration is walked like any other node but produces
 * no edge -- an import-position identifier is never in an access expression.
 */
export declare function scanFileForUsage(sourceFile: ts.SourceFile, fromFile: string, matches: readonly ImportBindingMatch[]): readonly DependencyEdge[];

/** One capability to scan a file's AST for usage of. */
export declare interface ScanTarget {
    /** Absolute path of the file declaring this capability. */
    readonly file: string;
    /** The binding name the capability is exported as. */
    readonly exportName: string;
    /** Getter names declared on the capability. */
    readonly getterNames: readonly string[];
    /** Mutator names declared on the capability. */
    readonly mutatorNames: readonly string[];
    /** Subscription names declared on the capability. */
    readonly subscriptionNames: readonly string[];
}

/**
 * Parameterized by the SAME schema type `createData`/`buildData` themselves
 * accept (`TSchema extends DataSchema<FieldsShape>`), not by `TFields`
 * alone -- documentation augments the same capability graph those two
 * describe, never a parallel, independently-shaped structure. Passing the
 * identical schema object to `createData(schema)` and `documentData(schema,
 * docs)` is what makes `fields`/`getters`/`mutators`/`subscriptions` below
 * real, `keyof`-checked doc keys instead of arbitrary strings: a
 * `documentData()` call documenting a getter that doesn't exist on the
 * schema, or misspelling one that does, is now a compile error, not a
 * silent gap only caught (if at all) by build-tool AST warnings.
 *
 * `getters`/`mutators`/`subscriptions` docs apply whether the schema being
 * documented is ultimately passed to the low-level `buildData` (which
 * ignores them) or the batteries-included `createData` (which executes
 * them) -- one `documentData` call documents either.
 *
 * `owner`/`category`/`exclusiveGroup`/`active`/`sensitivity`/`protections`/
 * `retention`/`metadata` are capability-level governance metadata, mirroring
 * env-cap's `documentEnv()` second-arg vocabulary but reframed for data
 * (see `specs/decisions/` for the full semantic-contract table: what each
 * field means, and exactly what a generator may claim about it). All of it
 * is author-declared, never statically verified -- see AGENTS.md's
 * declared-vs-proven invariant.
 */
/**
 * The `getters`/`mutators`/`subscriptions` docs shape for one operation
 * section, resolved from `TSchema` itself rather than plain indexed access
 * (`TSchema["getters"]`). Indexed access on a naked, constrained generic
 * type parameter resolves an absent optional property against the
 * CONSTRAINT's own declaration (`DataSchema`'s `Record<string,
 * GetterDefinition<...>>`), not against the concrete inferred type -- which
 * would silently permit any getter name to be documented on a schema that
 * declares no getters at all. A conditional type with `infer`, keyed on the
 * concrete `TSchema` at each call site, narrows correctly instead.
 *
 * The "no such section declared" branch is `Record<string, never>`, not
 * `Record<never, never>` or `{[K in never]?: OperationDocs}` -- both of the
 * latter collapse to TypeScript's `{}` ("any non-nullish value," not "no
 * properties"), which would silently accept any key once wrapped in
 * `CapabilityOperationDocs`'s own `{[K in keyof T]?: ...}` mapping (`keyof`
 * of the collapsed `{}` is `string | number | symbol`, not `never`).
 * `Record<string, never>` avoids that trap by staying a real value-level
 * constraint (no value is assignable to `never`) rather than a key-level
 * one that a further `keyof` extraction could discard.
 */
declare type SchemaOperationDocs<TSchema, TKey extends "getters" | "mutators" | "subscriptions"> = TSchema extends Record<TKey, infer TOperations> ? CapabilityOperationDocs<TOperations> : Record<string, never>;

/**
 * How a `buildData`/`createData`/`documentData` call's `fields` reference
 * resolves, before any cross-file linking is attempted (that's `link.ts`'s
 * job -- this module only ever looks at one file's own AST).
 */
export declare type SchemaRef = 
/** `fields` is an inline object literal in this same call. */
    {
    /** Always `"literal"` for this variant. */
    readonly kind: "literal";
    /** The object literal AST node itself. */
    readonly node: ts.ObjectLiteralExpression;
}
/** `fields` is a bare identifier -- resolved against `ParseResult.localConsts`/cross-file imports by `link.ts`. */
| {
    /** Always `"identifier"` for this variant. */
    readonly kind: "identifier";
    /** The identifier's text. */
    readonly name: string;
}
/** `fields` could not be statically resolved to either of the above. */
| {
    /** Always `"unresolvable"` for this variant. */
    readonly kind: "unresolvable";
    /** Human-readable explanation of why resolution failed. */
    readonly reason: string;
};

/** A `SourcePosition` plus the file it's in, for anywhere the file isn't already implied by the surrounding structure (e.g. a finding's list of candidate sites spanning multiple files). */
export declare interface SourceLocation extends SourcePosition {
    readonly file: string;
}

/** A 1-based line/column within a file already known from context (e.g. `DependencyEdge.from`). */
export declare interface SourcePosition {
    readonly line: number;
    readonly column: number;
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
 * Sentinel bucket for a capability/field with no documented owner at any level --
 * surfaced explicitly rather than silently omitted, so "nobody owns this" is as
 * visible as any real owner.
 */
export declare const UNOWNED = "(unowned)";

/**
 * Re-checks every currently-declared citation against `previousSnapshot`.
 * Two independent failure modes, both real findings, never silently
 * folded into one: a citation whose file no longer resolves at all
 * (`MISSING_DYNAMIC_ACCESS_CITATION`), and one that resolves but whose
 * content hash no longer matches what was recorded last run
 * (`STALE_DYNAMIC_ACCESS_CITATION`). A citation with no prior recorded
 * hash (first time seen, or `previousSnapshot` is `undefined` -- a first
 * run) is never flagged either way -- there is nothing to have gone stale
 * relative to yet, and "missing" only means the file doesn't currently
 * resolve, not that it used to.
 *
 * Deliberately additive to, never a replacement for,
 * `FIELD_DYNAMIC_ACCESS_DECLARED` (`usage-report.ts`) -- that finding
 * states what was *asserted*; these state the assertion's own *current
 * integrity*. Both can legitimately appear together for the same field.
 */
export declare function verifyDynamicAccessCitations(inventory: CapabilityInventory, previousSnapshot: ManifestSnapshot | undefined, root: string, fs: BuildFileSystem): Promise<readonly ReportFinding[]>;

/** One node plus the capability it belongs to. */
export declare interface WithCapability<T> {
    /** The capability this node belongs to. */
    readonly capability: {
        readonly file: string;
        readonly exportName: string;
    };
    /** The node itself. */
    readonly node: T;
}

/**
 * Writes `fingerprint`'s paired sidecar for `evidencePath`. Call immediately
 * after writing the evidence artifact itself, so the two files always describe
 * the same moment in the source tree's history.
 */
export declare function writeEvidenceFingerprint(evidencePath: string, fingerprint: string, fs: BuildFileSystem): Promise<void>;

export { }
