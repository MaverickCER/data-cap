/**
 * Builds the one authoritative, in-memory model every report generator
 * reads from -- a pure function over an already-discovered `LinkResult`,
 * never touching the filesystem or an AST itself. Generators that only
 * need ownership/sensitivity/flow-endpoint data (a manifest, the docs
 * catalog, the exclusive-group check) read this and never pay for the
 * separate, more expensive usage-scan pass (`scan-dependencies.ts`) that
 * produces `DependencyEdge`s -- those stay a distinct, optional layer.
 *
 * Field/operation granularity is deliberately top-level only, matching
 * what `documentData()`'s `CapabilityFieldDocs` can actually describe
 * (`{[K in keyof TFields]?: FieldDocs}` -- one level deep, not a recursive
 * walk of nested field paths). `OperationNode.writes` is resolved down to
 * the same top-level granularity: an operation "writes" a top-level field
 * whenever its statically-extracted `writes` shape claims that field at
 * all (`true` at the root, or any truthy value under that key), regardless
 * of how deep within the field the actual claimed subtree goes.
 */

import type {
  CapabilityOperationDocs,
  DataFlowEndpoint,
  FieldDocs,
  OperationDocs,
} from "../core/document.js"
import { displayPath } from "./display-path.js"
import type { DiscoveredCapability, LinkResult } from "./link.js"
import type { LooseCapabilityDocs, ParseWarning, RawOperationPresence } from "./parse.js"
import type { SourcePosition } from "./source-position.js"

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
export const CAPABILITY_MODEL_SCHEMA_VERSION = 3

/** One top-level field of a capability, resolved from the inventory's shared model. */
/**
 * One resolved governance value plus its provenance (ADR 0057) -- the one path a
 * `FieldNode` consumer reads for a governed property, replacing what used to require
 * separately checking a bare resolved property AND `field.docs.X` to get the full
 * picture. `declaredOn: undefined` means neither the field nor its capability
 * declared a value at all (`value` is then also `undefined`).
 */
export interface ResolvedGovernanceValue<T> {
  /** The effective value: the field's own declaration, else the capability's. */
  readonly value: T | undefined
  /** Where `value` came from. */
  readonly declaredOn: "field" | "capability" | undefined
}

export interface FieldNode {
  /** Top-level field key, as a single-element path (see the module doc comment on why granularity stops here). */
  readonly path: readonly string[]
  /** This field's own declared documentation, if any -- `description`/`protections`/`retention`/`metadata` have no resolution concept and live only here; for the six governed properties below, prefer `.value`/`.declaredOn` over reading this object directly (ADR 0057). */
  readonly docs: FieldDocs | undefined
  /** Resolved: the field's own `docs.owner`, else the capability's `owner`, plus which one declared it. */
  readonly owner: ResolvedGovernanceValue<string>
  /** Resolved: the field's own `docs.sensitivity`, else the capability's `sensitivity` -- same inheritance rule as `owner` (ADR 0049, ADR 0050, ADR 0057). */
  readonly sensitivity: ResolvedGovernanceValue<string>
  /** Resolved: the field's own `docs.purpose`, else the capability's `purpose` -- same inheritance rule as `owner`/`sensitivity` (ADR 0051, ADR 0057). Declared only, never verified. */
  readonly purpose: ResolvedGovernanceValue<string>
  /** Resolved: the field's own `docs.legalBasis`, else the capability's `legalBasis` -- same inheritance rule. A declared fact, never a legal determination (ADR 0051, ADR 0057). */
  readonly legalBasis: ResolvedGovernanceValue<string>
  /** Resolved: the field's own `docs.dataResidency`, else the capability's `dataResidency` -- same inheritance rule. The declared permitted-storage jurisdiction(s), not an observed fact (ADR 0051, ADR 0057). */
  readonly dataResidency: ResolvedGovernanceValue<string | readonly string[]>
  /** Resolved: the field's own `docs.auditRequired`, else the capability's `auditRequired` -- same inheritance rule (ADR 0051, ADR 0057). */
  readonly auditRequired: ResolvedGovernanceValue<boolean>
  /** Every getter/mutator/subscription whose statically-extracted `writes` shape claims this field. */
  readonly writtenBy: readonly {
    /** Which kind of operation wrote this field. */
    readonly kind: "getter" | "mutator" | "subscription"
    /** The writing operation's key name. */
    readonly name: string
  }[]
  /** The field's literal-evaluated declared default -- structural comparison only (e.g. `structural-duplication.ts`), never a runtime value. */
  readonly shape: unknown
  /** Position of this field's own key in the `fields` object literal -- only when `fields` was resolved as an inline literal in this file; `undefined` when identifier-resolved across a file boundary this pass doesn't retain AST access to (never guessed at -- ADR 0052). */
  readonly declarationPosition: SourcePosition | undefined
}

/** One getter/mutator/subscription operation, resolved from the inventory's shared model. */
export interface OperationNode {
  /** Which kind of operation this is. */
  readonly kind: "getter" | "mutator" | "subscription"
  /** The operation's key name. */
  readonly name: string
  /** This operation's own declared documentation, if any. */
  readonly docs: OperationDocs | undefined
  /** Top-level field paths this operation's statically-extracted `writes` shape covers. Empty when `writes` was absent (on a getter/subscription) or unresolvable -- never guessed at. */
  readonly writes: readonly (readonly string[])[]
  /** Whether this operation's config object literal declares a `processor` key -- a proven, structural presence fact (never an evaluation of what the processor does; see ADR 0050). */
  readonly hasProcessor: boolean
  /** Whether this operation's config object literal declares an `optimistic` key -- structurally always `false` for a getter/subscription. */
  readonly hasOptimistic: boolean
  /** Hoisted from `docs.endpoints` for convenient lookup -- author-declared, never statically verified. */
  readonly endpoints: readonly DataFlowEndpoint[]
}

/** One `buildData`/`createData` capability, resolved from the inventory's shared model. */
export interface CapabilityNode {
  /**
   * Root-relative POSIX path of the file declaring this capability -- the
   * one place an absolute discovery path is converted for publication
   * (OUT-01, see `display-path.ts`). Every downstream model that carries a
   * capability's `file` (Ownership, Finding, Dependency, Manifest Snapshot)
   * copies this value rather than re-deriving it, so there is exactly one
   * conversion point. Re-derive a real path with `absolutePathFrom(root,
   * file)` when actual filesystem/import work needs one.
   */
  readonly file: string
  /** The binding name the `buildData`/`createData` result is exported as. */
  readonly exportName: string
  /** `"buildData"` or `"createData"` -- which call form declared this capability. */
  readonly kind: "buildData" | "createData"
  /**
   * This capability's own declared documentation, if any -- the single path for
   * `owner`/`sensitivity`/`purpose`/`legalBasis`/`dataResidency`/`auditRequired`
   * (ADR 0057): a capability has nothing above it to resolve against, so a separate
   * top-level "resolved" property would only ever duplicate `docs.X` verbatim.
   */
  readonly docs: LooseCapabilityDocs | undefined
  /** Defaults to `true` when `docs.active` is absent. */
  readonly active: boolean
  /** Resolved: `docs.exclusiveGroup`, if declared. */
  readonly exclusiveGroup: string | undefined
  /** Position of this capability's own `buildData`/`createData` call site -- always available (ADR 0052). */
  readonly declarationPosition: SourcePosition
  /** Every declared field. */
  readonly fields: readonly FieldNode[]
  /** Every declared getter. */
  readonly getters: readonly OperationNode[]
  /** Every declared mutator. */
  readonly mutators: readonly OperationNode[]
  /** Every declared subscription. */
  readonly subscriptions: readonly OperationNode[]
}

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
export interface CapabilityInventory {
  /** Always `CAPABILITY_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof CAPABILITY_MODEL_SCHEMA_VERSION
  /** Every discovered, linked capability. */
  readonly capabilities: readonly CapabilityNode[]
  /** Parse/link warnings carried through from the discovery/linking pass that produced this inventory, each `file` root-relative like every other path this model publishes (OUT-01). */
  readonly warnings: readonly ParseWarning[]
}

/** Whether a statically-extracted `writes` shape (`true`, a nested plain object, or `undefined`) claims the given top-level field key at all. */
function writesCoversField(writes: unknown, fieldKey: string): boolean {
  if (writes === true) return true
  if (writes !== null && typeof writes === "object" && !Array.isArray(writes)) {
    const record = writes as Record<string, unknown>
    return Object.hasOwn(record, fieldKey) && Boolean(record[fieldKey])
  }
  return false
}

function resolveWritePaths(
  writes: unknown,
  fieldKeys: readonly string[],
): readonly (readonly string[])[] {
  return fieldKeys.filter((key) => writesCoversField(writes, key)).map((key) => [key] as const)
}

function buildOperationNodes(
  kind: OperationNode["kind"],
  names: readonly string[],
  writesEntries: readonly { readonly name: string; readonly writes: unknown }[] | undefined,
  presenceEntries: readonly RawOperationPresence[] | undefined,
  fieldKeys: readonly string[],
  operationDocs: CapabilityOperationDocs<Record<string, unknown>> | undefined,
): readonly OperationNode[] {
  const writesByName = new Map(writesEntries?.map((entry) => [entry.name, entry.writes]) ?? [])
  const presenceByName = new Map(presenceEntries?.map((entry) => [entry.name, entry]) ?? [])
  return names.map((name) => {
    const docs = operationDocs?.[name]
    const presence = presenceByName.get(name)
    return {
      kind,
      name,
      docs,
      writes: resolveWritePaths(writesByName.get(name), fieldKeys),
      hasProcessor: presence?.hasProcessor ?? false,
      hasOptimistic: presence?.hasOptimistic ?? false,
      endpoints: docs?.endpoints ?? [],
    }
  })
}

/** Resolves one governed property: the field's own value if declared, else the capability's, plus which one declared it (ADR 0057). */
function resolveGovernanceValue<T>(
  ownValue: T | undefined,
  capabilityValue: T | undefined,
): ResolvedGovernanceValue<T> {
  if (ownValue !== undefined) return { value: ownValue, declaredOn: "field" }
  if (capabilityValue !== undefined) return { value: capabilityValue, declaredOn: "capability" }
  return { value: undefined, declaredOn: undefined }
}

function buildFieldNodes(
  fieldsShape: Record<string, unknown> | undefined,
  fieldPositions: Readonly<Record<string, SourcePosition>> | undefined,
  capabilityDocs: LooseCapabilityDocs | undefined,
  operations: readonly OperationNode[],
): readonly FieldNode[] {
  if (fieldsShape === undefined) return []
  return Object.keys(fieldsShape).map((key) => {
    const fieldDocs = capabilityDocs?.fields?.[key]
    const writtenBy = operations
      // `resolveWritePaths` only ever emits single-segment `[fieldKey]` paths, so
      // matching `path[0]` is matching the whole path.
      .filter((op) => op.writes.some((path) => path[0] === key))
      .map((op) => ({ kind: op.kind, name: op.name }))
    return {
      path: [key],
      docs: fieldDocs,
      owner: resolveGovernanceValue(fieldDocs?.owner, capabilityDocs?.owner),
      sensitivity: resolveGovernanceValue(fieldDocs?.sensitivity, capabilityDocs?.sensitivity),
      purpose: resolveGovernanceValue(fieldDocs?.purpose, capabilityDocs?.purpose),
      legalBasis: resolveGovernanceValue(fieldDocs?.legalBasis, capabilityDocs?.legalBasis),
      dataResidency: resolveGovernanceValue(
        fieldDocs?.dataResidency,
        capabilityDocs?.dataResidency,
      ),
      auditRequired: resolveGovernanceValue(
        fieldDocs?.auditRequired,
        capabilityDocs?.auditRequired,
      ),
      writtenBy,
      shape: fieldsShape[key],
      declarationPosition: fieldPositions?.[key],
    }
  })
}

function buildCapabilityNode(discovered: DiscoveredCapability, root: string): CapabilityNode {
  const fieldKeys = discovered.fieldsShape !== undefined ? Object.keys(discovered.fieldsShape) : []
  const docs = discovered.docs

  const getters = buildOperationNodes(
    "getter",
    discovered.operationNames?.getters ?? [],
    discovered.operationWrites?.getters,
    discovered.operationPresence?.getters,
    fieldKeys,
    docs?.getters,
  )
  const mutators = buildOperationNodes(
    "mutator",
    discovered.operationNames?.mutators ?? [],
    discovered.operationWrites?.mutators,
    discovered.operationPresence?.mutators,
    fieldKeys,
    docs?.mutators,
  )
  const subscriptions = buildOperationNodes(
    "subscription",
    discovered.operationNames?.subscriptions ?? [],
    discovered.operationWrites?.subscriptions,
    discovered.operationPresence?.subscriptions,
    fieldKeys,
    docs?.subscriptions,
  )

  const fields = buildFieldNodes(discovered.fieldsShape, discovered.fieldPositions, docs, [
    ...getters,
    ...mutators,
    ...subscriptions,
  ])

  return {
    // The single absolute -> root-relative conversion point (OUT-01). Every
    // other model's `file` is a copy of this one, never an independent
    // conversion that could disagree with it.
    file: displayPath(root, discovered.file),
    exportName: discovered.exportName,
    kind: discovered.kind,
    docs,
    active: docs?.active ?? true,
    exclusiveGroup: docs?.exclusiveGroup,
    declarationPosition: discovered.declarationPosition,
    fields,
    getters,
    mutators,
    subscriptions,
  }
}

/**
 * Builds the `CapabilityInventory` from an already-discovered `LinkResult`
 * -- the one shared model every report generator (Phase C) reads from, and
 * the boundary where each capability's absolute discovery path becomes the
 * root-relative `file` every downstream model publishes (OUT-01). The root
 * comes from `linkResult.root` -- the same one linking itself resolved
 * against -- so the two can never disagree.
 */
export function buildInventory(linkResult: LinkResult): CapabilityInventory {
  return {
    schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
    capabilities: linkResult.capabilities.map((discovered) =>
      buildCapabilityNode(discovered, linkResult.root),
    ),
    // Warnings are part of the published model too, so their `file` gets the
    // same absolute -> root-relative treatment as a capability's (OUT-01) --
    // an otherwise fully-relative artifact with one absolute path hiding in
    // its warnings list is exactly the leak this was meant to close.
    warnings: linkResult.warnings.map((warning) => ({
      ...warning,
      file: displayPath(linkResult.root, warning.file),
    })),
  }
}
