/**
 * `data-cap`'s Evidence Model (ADR 0050) -- the composition of the other
 * six canonical models into one provenance-stamped artifact. Every
 * reference projection (a Classification/Privacy/Retention/Audit/
 * Compliance Evidence report, an Assurance report, ...) reads this, never
 * a second, independently-assembled source.
 *
 * No prior art exists for this model in either `data-cap` or `env-cap` --
 * this is first-of-its-kind design work, not a port. `capability` is the
 * only required input; every other project-varying model is independently
 * optional, mirroring `ReportResult`'s own established convention
 * (`manifest?`/`documentation?`/`flow?`) of "a caller passes whatever it
 * actually has." `runtimeContract` is the one exception --
 * always populated automatically, since `buildRuntimeContractModel()`
 * takes no argument and is identical for every caller on the same
 * `data-cap` version; there is no scenario where a caller "doesn't have"
 * it the way it might not have run a usage scan.
 */

import { buildClaimsModel } from "../flow/claims-model.js"
import type { ClaimsModel } from "../flow/claims-model.js"
import type { FlowModel } from "../flow/flow-model.js"
import { FlowModelError } from "../flow/flow-model.js"
import type { ObservationModel } from "../flow/observation-model.js"
import type { PolicyModel } from "../flow/policy-model.js"
import { buildRuntimeContractModel } from "./runtime-contract-model.js"
import type { RuntimeContractModel } from "./runtime-contract-model.js"
import type { CapabilityInventory } from "./inventory.js"
import type { DependencyModel } from "./dependency-model.js"
import type { OwnershipModel } from "./ownership-model.js"
import type { FindingModel } from "./finding-model.js"
import type { ChangeModel } from "./change-model.js"
import type { LifecycleModel } from "./lifecycle-model.js"

/**
 * Bump only when a reader could misinterpret the shape -- same discipline
 * every other model's schema-version constant already documents. Bumped
 * 1 -> 2: `provenance` became required and gained `toolVersion`/`commit`
 * (OUT-06), `lifecycle` was added (EVD-05), and `computed` was added
 * (OUT-04). Bumped 2 -> 3 (ADR 0070): `flow`, `policy`, `observation` and
 * `claims` were added, each with its own `computed` flag. Additive -- a v2
 * reader's interpretation of every field it knew is unchanged.
 */
export const EVIDENCE_MODEL_SCHEMA_VERSION = 3

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
export interface EvidenceProvenance {
  /** ISO-8601 timestamp for when this evidence was generated. */
  readonly generatedAt: string
  /** `data-cap`'s own installed version at generation time. */
  readonly toolVersion: string
  /** The commit SHA this evidence was generated against, or `undefined` when the caller didn't supply one. */
  readonly commit: string | undefined
}

/** The project-varying models Evidence Model composes -- `capability` and `lifecycle` are required; the rest depend on which passes actually ran. */
export interface EvidenceModelInputs {
  /** Capability Model -- the base every other model is derived from or indexed against. */
  readonly capability: CapabilityInventory
  /**
   * Lifecycle Model. Required alongside `capability`, not optional like
   * `dependency`/`ownership`: it is a pure projection over the inventory
   * (`buildLifecycleModel`), so any caller holding a `capability` can always
   * produce one -- there is no scenario where a caller legitimately
   * "doesn't have" it the way it might not have run a usage scan. Only the
   * `expiringWithinDays`/`now` window is a caller choice, and that changes
   * the contents, never the availability.
   */
  readonly lifecycle: LifecycleModel
  /** Dependency Model, when a usage scan was run. */
  readonly dependency?: DependencyModel
  /** Ownership Model, when a usage scan was run. */
  readonly ownership?: OwnershipModel
  /** Finding Model, when at least one rule/scan pass ran. */
  readonly finding?: FindingModel
  /** Change Model, when a previous manifest snapshot was available to diff against. */
  readonly change?: ChangeModel
  /** Flow Model (ADR 0070), when a flow pass ran. */
  readonly flow?: FlowModel
  /** Policy Model, when rules were evaluated. Requires `flow`: a policy is evaluated against a Flow Model. */
  readonly policy?: PolicyModel
  /** Observation Model, when runtime observations were ingested. */
  readonly observation?: ObservationModel
}

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
export interface EvidenceComputedModels {
  /** Whether a usage scan ran and produced a Dependency Model this run. */
  readonly dependency: boolean
  /** Whether an Ownership Model was built this run. */
  readonly ownership: boolean
  /** Whether at least one rule/scan pass ran and produced a Finding Model this run. */
  readonly finding: boolean
  /** Whether a manifest diff was available and produced a Change Model this run. */
  readonly change: boolean
  /** Whether a flow pass ran and produced a Flow Model this run. */
  readonly flow: boolean
  /** Whether policy rules were evaluated and produced a Policy Model this run. */
  readonly policy: boolean
  /** Whether runtime observations were ingested and produced an Observation Model this run. */
  readonly observation: boolean
  /** Whether claims were derived this run -- true exactly when `flow` was computed. */
  readonly claims: boolean
}

/**
 * `data-cap`'s Evidence Model: the composition of Capability, Lifecycle,
 * Dependency, Ownership, Finding, Change, and Runtime Contract Model into
 * one provenance-stamped artifact.
 */
export interface EvidenceModel {
  /** Always `EVIDENCE_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof EVIDENCE_MODEL_SCHEMA_VERSION
  /** Who/when/what produced this instance -- always present (see `EvidenceProvenance`). */
  readonly provenance: EvidenceProvenance
  /** Capability Model. */
  readonly capability: CapabilityInventory
  /** Lifecycle Model -- always populated, for the reason `EvidenceModelInputs.lifecycle` documents. */
  readonly lifecycle: LifecycleModel
  /**
   * Which of the four optional sub-models below this run actually computed
   * -- read this before concluding anything from an absent one (OUT-04).
   */
  readonly computed: EvidenceComputedModels
  /** Dependency Model, or `undefined` when no usage scan was run -- see `computed.dependency` before reading absence as "no dependencies." */
  readonly dependency: DependencyModel | undefined
  /** Ownership Model, or `undefined` when none was supplied -- see `computed.ownership`. */
  readonly ownership: OwnershipModel | undefined
  /** Finding Model, or `undefined` when nothing was supplied -- see `computed.finding` before reading absence as "no findings." */
  readonly finding: FindingModel | undefined
  /**
   * Change Model, or `undefined` when no manifest diff was available -- see
   * `computed.change` before reading absence as "nothing changed." Not a
   * diffable input across two `EvidenceModel`s the way the other five
   * project-varying fields conceptually are -- it already IS a diff.
   */
  readonly change: ChangeModel | undefined
  /** Flow Model, or `undefined` when no flow pass ran -- see `computed.flow` before reading absence as "no flows." */
  readonly flow: FlowModel | undefined
  /** Policy Model, or `undefined` when no rules were evaluated -- see `computed.policy`. */
  readonly policy: PolicyModel | undefined
  /** Observation Model, or `undefined` when no observations were ingested -- see `computed.observation` before reading absence as "nothing was observed." */
  readonly observation: ObservationModel | undefined
  /**
   * Claims Model, derived by `buildEvidenceModel` from `flow` (plus `policy`
   * and `observation` when present), never supplied by a caller -- one
   * derivation path, so the claims can never disagree with the facts they
   * cite. `undefined` exactly when `flow` is.
   */
  readonly claims: ClaimsModel | undefined
  /**
   * Runtime Contract Model -- always populated, package-scoped rather than
   * project-scoped (see this module's own doc comment). A static append,
   * never itself a diffable "changed since last run" input.
   */
  readonly runtimeContract: RuntimeContractModel
}

/** Composes `models` (plus always-available Runtime Contract Model) and `provenance` into `data-cap`'s Evidence Model. */
export function buildEvidenceModel(
  models: EvidenceModelInputs,
  provenance: EvidenceProvenance,
): EvidenceModel {
  if (models.policy !== undefined && models.flow === undefined) {
    throw new FlowModelError(
      "A Policy Model was supplied without the flow model it is evaluated against; supply `flow` too.",
    )
  }
  const claims =
    models.flow === undefined
      ? undefined
      : buildClaimsModel({
          flow: models.flow,
          policy: models.policy,
          observation: models.observation,
        })
  return {
    schemaVersion: EVIDENCE_MODEL_SCHEMA_VERSION,
    provenance,
    capability: models.capability,
    lifecycle: models.lifecycle,
    // Derived from what was actually supplied, never from whether a supplied
    // model happens to be empty -- an empty `DependencyModel` means the scan
    // ran and proved zero edges, which is a real result (OUT-04).
    computed: {
      dependency: models.dependency !== undefined,
      ownership: models.ownership !== undefined,
      finding: models.finding !== undefined,
      change: models.change !== undefined,
      flow: models.flow !== undefined,
      policy: models.policy !== undefined,
      observation: models.observation !== undefined,
      claims: claims !== undefined,
    },
    dependency: models.dependency,
    ownership: models.ownership,
    finding: models.finding,
    change: models.change,
    flow: models.flow,
    policy: models.policy,
    observation: models.observation,
    claims,
    runtimeContract: buildRuntimeContractModel(),
  }
}
