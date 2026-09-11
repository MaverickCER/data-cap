import type { DataSchema, FieldsShape } from "./types.js"

/**
 * Which direction data moves across a declared boundary, and what kind of
 * boundary it is. Author-declared documentation only -- never statically
 * verified against an operation's actual `execute`/`subscribe` body (those
 * stay opaque per AGENTS.md invariant 6). A report may never present an
 * endpoint as a proven fact; see AGENTS.md's declared-vs-proven invariant.
 */
export type DataFlowDirection = "input" | "output"

/** What kind of boundary a declared data-flow endpoint crosses -- a data store (`database`/`cache`/`storage`/`queue`), an external entity (`api`/`external-service`/`user-input`), or something internal to this codebase (`computed`/`internal`). */
export type DataFlowEndpointKind =
  | "database"
  | "cache"
  | "storage"
  | "queue"
  | "api"
  | "external-service"
  | "user-input"
  | "computed"
  | "internal"

/**
 * One declared data-flow boundary an operation crosses. A getter/
 * subscription's endpoints are typically `"input"` (where `execute`/
 * `subscribe` acquires data from); a mutator's are typically `"output"`
 * (where it sends data to) -- nothing enforces the typical case, since this
 * is documentation, not a runtime contract.
 */
export interface DataFlowEndpoint {
  /** Which way data moves across this boundary. */
  readonly direction: DataFlowDirection
  /** What kind of boundary this is. */
  readonly kind: DataFlowEndpointKind
  /** Short identifier, e.g. "stripe-api", "postgres:users" -- a semantic label, not a sentence. */
  readonly name: string
  /** A literal, trackable location for this endpoint -- a URL, a route path, a `table:column` reference. Distinct from `name` (a short label): this is meant to be compared/matched across capabilities (e.g. flagging two capabilities that declare the same URL as likely-duplicate fetches), not just read by a person. */
  readonly url?: string
  /**
   * The declared data-safety state of this field's value AT this specific
   * boundary crossing -- e.g. a field that arrives `"encrypted"` on an
   * `"input"` endpoint and is sent back out `"redacted"` on an `"output"`
   * endpoint. Declared only, same presence-only discipline as every other
   * field in this vocabulary: this records what a developer states about
   * handling at this crossing, never that data-cap has verified the field's
   * actual runtime value matches the claim.
   */
  readonly handling?: "plaintext" | "masked" | "redacted" | "hashed" | "encrypted"
}

/**
 * Documentation metadata for one field.
 *
 * `owner`, `sensitivity`, and `protections` override the capability-level
 * value of the same name for this field specifically -- not every field in
 * a capability is equally sensitive or equally owned. `protections` and
 * `retention` are documentation-presence signals only: a generator may say
 * a safeguard/policy is "documented" or "not documented," never that it is
 * adequate, correct, or enforced. `purpose`/`legalBasis`/`dataResidency`/
 * `auditRequired` carry the same presence-only discipline -- declared
 * governance facts, never a claim that data-cap has determined they satisfy
 * any law (see `specs/decisions/0051-documentdata-metadata-and-governance-fields.md`).
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
export interface FieldDocs {
  /** Why this field exists / what it's for. */
  readonly description?: string
  /** Overrides the capability's own `owner` for this field specifically. */
  readonly owner?: string
  /** Overrides the capability's own `sensitivity` for this field specifically. */
  readonly sensitivity?: string
  /** Overrides the capability's own `protections` for this field specifically. */
  readonly protections?: string
  /** Documented retention policy for this field -- presence only, never an enforcement claim. */
  readonly retention?: string
  /**
   * The declared reason this field's data is collected/retained. Declared
   * only -- data-cap never verifies the stated purpose matches actual usage.
   * Overrides the capability's own `purpose` for this field specifically.
   */
  readonly purpose?: string
  /**
   * The declared legal basis asserted for processing this field (e.g.
   * `"consent"`, `"contract"`, `"legitimate interest"`). Records that a
   * basis was declared -- never that data-cap has determined the basis is
   * legally valid. Overrides the capability's own `legalBasis` for this
   * field specifically.
   */
  readonly legalBasis?: string
  /**
   * The declared jurisdiction(s) this field's data is permitted/expected to
   * be *stored* in -- a policy constraint, not an observed fact, not a
   * processing-location claim, not a data-subject-location claim. Overrides
   * the capability's own `dataResidency` for this field specifically.
   */
  readonly dataResidency?: string | readonly string[]
  /**
   * Whether access to this field is documented as requiring an audit trail.
   * Declared only, same presence-only discipline as `protections`/
   * `retention`. Overrides the capability's own `auditRequired` for this
   * field specifically.
   */
  readonly auditRequired?: boolean
  /**
   * When this field's data (or the credential/source behind it) is declared
   * to stop being valid, as an ISO-8601 date (`"2026-12-31"`). Declared
   * only: nothing expires anything at runtime, and `data-cap` never fetches
   * a real expiry from a provider. Build tooling reads it to report what is
   * expiring soon (see the Lifecycle Model) -- a date that has already
   * passed is reported as expired, never acted on.
   */
  readonly expiresAt?: string
  /** Whether this field is documented as deprecated. Presence-only, same discipline as every other declared fact here -- nothing warns at runtime. */
  readonly deprecated?: boolean
  /** Why this field is deprecated, and what to use instead. Only meaningful alongside `deprecated`. */
  readonly deprecatedReason?: string
  /**
   * The date by which a deprecated field is intended to be removed, ISO-8601.
   * Field-level only: a removal deadline is about one specific field's own
   * migration, and a capability-wide `removeBy` would say nothing about
   * which of its fields still need work.
   */
  readonly removeBy?: string
  /**
   * The previous name of this field, when it was renamed. Field-level only,
   * for the same reason as `removeBy`. Build tooling uses this to correlate
   * an added-field/removed-field pair across two runs into one rename rather
   * than reporting an unrelated addition and deletion -- see `ChangeModel`'s
   * `renamedFields`. Only ever populated from an *authored* value, never
   * guessed from name similarity.
   */
  readonly renamedFrom?: string
  /**
   * Free-form extension bag for anything data-cap itself has no named
   * concept for -- opaque, never inspected or validated by any code path in
   * this package. Once a concept matters enough for data-cap to reason
   * about, it gets its own named field above; everything else stays here.
   */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** `FieldDocs` for every field in `TFields`, keyed the same way. */
export type CapabilityFieldDocs<TFields> = { [K in keyof TFields]?: FieldDocs }

/**
 * Developer-supplied evidence assertions for one field -- categorically
 * different from every field on `FieldDocs`: those are declared-and-never-
 * verified (ADR 0049's own invariant), while `dynamicAccess` is re-checked
 * against reality every run (see the build-tooling side of this feature).
 * Kept structurally separate, in `CapabilityDocs.evidence` rather than
 * folded into `FieldDocs`, specifically so this different epistemic status
 * is visible in the shape itself, not just in a doc comment (ADR 0053).
 */
export interface EvidenceFieldDocs {
  /**
   * Citations of where this field is accessed in a way static analysis
   * can't see on its own (e.g. a truly dynamic key derived at runtime),
   * each `"<relative-path>:<line>:<column>"`. Re-verified every run: a
   * citation whose file no longer exists, or whose cited line has visibly
   * changed since the citation was written, is downgraded and flagged, never
   * trusted forever.
   */
  readonly dynamicAccess?: readonly string[]
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
export interface OperationDocs {
  /** What this operation does. */
  readonly description?: string
  /** Short identifier for where this operation acquires/sends data (e.g. `"stripe-api"`, `"postgres:users"`), not prose. */
  readonly source?: string
  /** What's required to call this operation -- descriptive only, never an authorization/enforcement claim. */
  readonly credentials?: string
  /** Documented shape of what this operation returns/produces. */
  readonly response?: string
  /** Declared data-flow boundaries this operation crosses -- see `DataFlowEndpoint`. */
  readonly endpoints?: readonly DataFlowEndpoint[]
  /**
   * Free-form extension bag for anything data-cap itself has no named
   * concept for -- opaque, never inspected or validated by any code path in
   * this package. The index signature below remains for the same reason it
   * always has (documenting never fights the type checker); `metadata` is
   * the recommended place for new extension data going forward.
   */
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

/** `OperationDocs` for every operation in `TOperations`, keyed the same way. */
export type CapabilityOperationDocs<TOperations> = { [K in keyof TOperations]?: OperationDocs }

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
type SchemaOperationDocs<TSchema, TKey extends "getters" | "mutators" | "subscriptions"> =
  TSchema extends Record<TKey, infer TOperations>
    ? CapabilityOperationDocs<TOperations>
    : Record<string, never>

export interface CapabilityDocs<TSchema extends DataSchema<FieldsShape>> {
  /** Display name -- falls back to the export/binding name when omitted. */
  readonly name?: string
  /** Why this capability exists / what it's for. */
  readonly description?: string
  /** Who's accountable for this capability. A field's own `owner` (see `FieldDocs`) overrides this for that field specifically. */
  readonly owner?: string
  /** Free-form classification -- never validated. */
  readonly category?: string
  /** Mutual-exclusivity group: more than one *active* capability sharing this value is a real conflict (only one implementation of a group should be live at once). */
  readonly exclusiveGroup?: string
  /** Defaults to `true` when omitted. Gates `exclusiveGroup` conflict checks and manifest membership. */
  readonly active?: boolean
  /* jscpd:ignore-start -- these governance fields deliberately mirror `FieldDocs`
     one-for-one (a field's value overrides its capability's), with docs written
     for the capability scope rather than the field scope. The parallel structure
     is the point; a shared base interface would erase the per-scope wording. */
  /** Data classification. Standard vocabulary: `"public"` / `"internal"` / `"confidential"` / `"restricted"` (ascending) -- custom values are allowed but flagged as non-standard, never blocking. */
  readonly sensitivity?: string
  /** Documented safeguard -- presence only, never an adequacy claim. */
  readonly protections?: string
  /** Documented retention policy -- presence only, never an enforcement claim. */
  readonly retention?: string
  /**
   * The declared reason this capability's data is collected/retained.
   * Declared only -- data-cap never verifies the stated purpose matches
   * actual usage. A field's own `purpose` (see `FieldDocs`) overrides this
   * for that field specifically.
   */
  readonly purpose?: string
  /**
   * The declared legal basis asserted for processing this capability's data
   * (e.g. `"consent"`, `"contract"`, `"legitimate interest"`). Records that
   * a basis was declared -- never that data-cap has determined the basis is
   * legally valid; data-cap records declared governance facts, it does not
   * determine whether those facts satisfy a law. A field's own `legalBasis`
   * overrides this for that field specifically.
   */
  readonly legalBasis?: string
  /**
   * The declared jurisdiction(s) this capability's data is permitted/
   * expected to be *stored* in -- a policy constraint, not an observed
   * fact, not a processing-location claim, not a data-subject-location
   * claim. A field's own `dataResidency` overrides this for that field
   * specifically.
   */
  readonly dataResidency?: string | readonly string[]
  /**
   * Whether access to this capability's data is documented as requiring an
   * audit trail. Declared only, same presence-only discipline as
   * `protections`/`retention`. A field's own `auditRequired` overrides this
   * for that field specifically.
   */
  readonly auditRequired?: boolean
  /* jscpd:ignore-end */
  /**
   * When this capability's data (or the credential/source behind it) is
   * declared to stop being valid, as an ISO-8601 date. A field's own
   * `expiresAt` (see `FieldDocs`) overrides this for that field
   * specifically. Declared only -- nothing expires at runtime.
   */
  readonly expiresAt?: string
  /** Whether this capability is documented as deprecated. Presence-only; nothing warns at runtime. */
  readonly deprecated?: boolean
  /** Why this capability is deprecated, and what to use instead. Only meaningful alongside `deprecated`. */
  readonly deprecatedReason?: string
  /**
   * Free-form extension bag for anything data-cap itself has no named
   * concept for -- opaque, never inspected or validated by any code path in
   * this package (e.g. jurisdiction-specific regulatory classification:
   * `{ regulatory: "GDPR,PCI-DSS" }`). Once a concept matters enough for
   * data-cap to reason about, it gets its own named field above (as
   * `purpose`/`legalBasis`/`dataResidency`/`auditRequired` did); everything
   * else stays here.
   */
  readonly metadata?: Readonly<Record<string, unknown>>
  /**
   * Developer-supplied evidence assertions -- verified over time, unlike
   * every other field above, which is declared-only. Kept structurally
   * separate for exactly that reason (see `EvidenceFieldDocs`).
   */
  readonly evidence?: { readonly fields?: Readonly<Record<string, EvidenceFieldDocs>> }
  /** Per-field documentation, overriding this capability's own `owner`/`sensitivity`/`protections` where declared. Keys are checked against the schema's real `fields` shape. */
  readonly fields?: CapabilityFieldDocs<TSchema["fields"]>
  /** Per-getter documentation. Keys are checked against the schema's real `getters` names -- a nonexistent or misspelled getter name is a compile error. */
  readonly getters?: SchemaOperationDocs<TSchema, "getters">
  /** Per-mutator documentation. Keys are checked against the schema's real `mutators` names. */
  readonly mutators?: SchemaOperationDocs<TSchema, "mutators">
  /** Per-subscription documentation. Keys are checked against the schema's real `subscriptions` names. */
  readonly subscriptions?: SchemaOperationDocs<TSchema, "subscriptions">
}

/**
 * Adds documentation/operational metadata to the same capability graph a
 * `buildData`/`createData` call describes, without introducing runtime
 * behavior.
 *
 * `config` should be the exact same schema object passed to `createData`/
 * `buildData` (typically a separately-declared `const` reused by both
 * calls, the same way a `fields` identifier is already shared) -- passing
 * the same object is what lets `docs`' `getters`/`mutators`/`subscriptions`
 * keys be checked against the schema's real operation names, not just its
 * `fields`. A `{fields}`-only config (no operations) still works for a
 * capability with none to document.
 *
 * @remarks
 * Intentionally inert: everything here happens at build time, in build
 * tooling that statically discovers this call -- never at runtime, in every
 * process that imports the capability file, which is exactly what this
 * split (mirroring env-cap's `documentEnv`) exists to avoid. Never throws,
 * regardless of malformed input, and a `documentData` call is never itself
 * evidence that an executable capability exists -- static analysis (`build`)
 * inspects only real `buildData`/`createData` calls.
 */
// Deliberately a true no-op (see the doc comment above): `documentData` has
// no runtime behavior at all, only a compile-time `keyof`-checked shape and a
// static-analysis-visible call site -- its body being empty is observably
// identical to explicitly discarding both arguments, so there is nothing a
// test could assert to distinguish the two. (A `next-line` disable placed
// inside the parameter list, right before the closing paren, does not
// reliably attach as the block's own leading comment -- hence this
// unscoped disable/restore pair instead.)
// Stryker disable BlockStatement
export function documentData<TSchema extends DataSchema<FieldsShape>>(
  config: TSchema,
  docs: CapabilityDocs<TSchema>,
): void {
  // `noUnusedParameters` needs these referenced; a bare `config`/`docs`
  // expression statement trips `no-unused-expressions` instead, and renaming
  // these public parameters to `_config`/`_docs` would leak into every
  // consumer's editor hover.
  // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator
  void config
  // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator
  void docs
}
// Stryker restore BlockStatement
