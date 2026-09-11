/**
 * `data-cap`'s Finding Model (ADR 0050) -- a thin, versioned envelope
 * around `findings.ts`'s already-unified `ReportFinding[]`. Unlike
 * env-cap's own Finding Model, there are no independently-shaped families
 * to adapt here: every static rule and usage-scan pass already emits into
 * one `ReportFinding` shape (`code`/`severity`/`message` plus optional
 * locators). What this file adds is a `schemaVersion` for versioned JSON
 * publication, and a structured `location` per finding -- a discriminated
 * union over `ReportFinding`'s existing optional `capability`/`field`/
 * `operation`/`source` fields, computed once instead of four independent
 * optional-field checks at each consumer (a SARIF adapter, Evidence Model).
 */

import type { ReportFinding } from "./findings.js"
import type { SourceLocation, SourcePosition } from "./source-position.js"

/**
 * Bump only when a reader could misinterpret the shape -- same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: `LocatedFinding` no longer carries the flat `capability`/`field`/
 * `operation`/`position`/`indeterminateSites` locators alongside `location`
 * (OUT-02), `FindingLocationCapability.file` is now root-relative rather
 * than absolute (OUT-01), and every finding now carries a `family`
 * (NAM-12).
 */
export const FINDING_MODEL_SCHEMA_VERSION = 2

/** A finding's capability locator -- shared by every `FindingLocation` variant except `"none"`. */
export interface FindingLocationCapability {
  /** Root-relative POSIX path of the file declaring the capability -- carried through verbatim from `CapabilityNode.file` (see `display-path.ts`). */
  readonly file: string
  /** The binding name the capability is exported as. */
  readonly exportName: string
}

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
export type FindingLocation =
  | { readonly kind: "none" }
  | {
      readonly kind: "capability"
      readonly capability: FindingLocationCapability
      readonly position?: SourcePosition
    }
  | {
      readonly kind: "field"
      readonly capability: FindingLocationCapability
      readonly field: readonly string[]
      readonly position?: SourcePosition
      /**
       * Every candidate access site a `"FIELD_ACCESS_INDETERMINATE"` finding
       * could actually be about (ADR 0052) -- populated only for that code.
       * Lives here, on the one variant that can carry it, rather than as a
       * flat sibling of `location`: a field-level finding is the only kind
       * that ever has one. Spans potentially multiple consuming files, so
       * each entry carries its own `file` (`SourceLocation`, not just
       * `SourcePosition`).
       */
      readonly indeterminateSites?: readonly SourceLocation[]
    }
  | {
      readonly kind: "operation"
      readonly capability: FindingLocationCapability
      readonly operation: string
      readonly position?: SourcePosition
    }
  | {
      readonly kind: "consumer"
      readonly capability: FindingLocationCapability
      readonly source: string
    }

/** The flat, pre-`location` locator properties a rule/scan emits a `ReportFinding` with -- resolved into `FindingLocation` by `locationOf`, then dropped. */
type FlatLocators =
  "capability" | "field" | "operation" | "source" | "position" | "indeterminateSites"

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
export type LocatedFinding = Omit<ReportFinding, FlatLocators> & {
  readonly location: FindingLocation
}

/** `data-cap`'s Finding Model: every finding, with a structured, pre-computed `location`. */
export interface FindingModel {
  /** Always `FINDING_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof FINDING_MODEL_SCHEMA_VERSION
  /** Every finding, each with its `location` computed. */
  readonly findings: readonly LocatedFinding[]
}

/** Computes one finding's structured `location` from its existing optional locator fields. */
export function locationOf(finding: ReportFinding): FindingLocation {
  if (finding.capability === undefined) return { kind: "none" }
  if (finding.field !== undefined) {
    return {
      kind: "field",
      capability: finding.capability,
      field: finding.field,
      position: finding.position,
      indeterminateSites: finding.indeterminateSites,
    }
  }
  if (finding.operation !== undefined) {
    return {
      kind: "operation",
      capability: finding.capability,
      operation: finding.operation,
      position: finding.position,
    }
  }
  if (finding.source !== undefined) {
    return { kind: "consumer", capability: finding.capability, source: finding.source }
  }
  return { kind: "capability", capability: finding.capability, position: finding.position }
}

/** Projects `findings` into `data-cap`'s Finding Model, replacing each finding's flat locators with one structured `location`. */
export function buildFindingModel(findings: readonly ReportFinding[]): FindingModel {
  return {
    schemaVersion: FINDING_MODEL_SCHEMA_VERSION,
    // Constructed property-by-property rather than spread-minus-locators:
    // a spread would silently carry any locator added to `ReportFinding`
    // later straight back onto `LocatedFinding`, quietly re-introducing
    // exactly the redundancy OUT-02 removed. Listing what IS carried makes
    // a new non-locator property a visible, deliberate addition here.
    findings: findings.map((finding) => ({
      code: finding.code,
      family: finding.family,
      severity: finding.severity,
      message: finding.message,
      location: locationOf(finding),
    })),
  }
}
