// Pure projection: `EvidenceModel` (data-cap's own real, Stable evidence --
// see ADR 0050/0054) -> this document's own `RopaModel` JSON shape. No
// filesystem/CLI concerns at all -- `run.ts` is the only file in this
// directory that touches either; an org that just wants the key values (e.g.
// to feed its own privacy-ops dashboard, or a different renderer entirely)
// can call this directly against any `EvidenceModel` it already has on hand,
// the same escape hatch env-cap's own rotation-log generator's
// `buildRotationLogModel()` provides.
import type { CapabilityNode, EvidenceModel, FieldNode } from "data-cap/build"
import type { ControllerIdentity, RopaFieldEntry, RopaModel, RopaRecord } from "./types.js"

const NOT_DOCUMENTED = "Not documented"

/** Deduplicates and joins a list of declared strings for a summary-style cell -- `"Not documented"` when the list is empty (nothing declared anywhere it was collected from). */
function joinDeclared(values: readonly (string | undefined)[]): string {
  const unique = [...new Set(values.filter((v): v is string => v !== undefined))]
  return unique.length > 0 ? unique.join("; ") : NOT_DOCUMENTED
}

/** Field-then-capability override, the same resolution `dataResidency`/`retention`/`protections`/`transferSafeguard` all share in `src/core/document.ts` -- `"Not documented"` when neither level declares a value. Mirrors `inventory.ts`'s own `resolveGovernanceValue` fallback order, applied here to the properties that (per ADR 0057) the inventory itself does not resolve (`retention`/`protections`/`transferSafeguard` have no resolution concept on `FieldNode` -- see that ADR's own reasoning for why `docs.X` stays the one path for them). */
function resolveFieldThenCapability(
  fieldValue: string | undefined,
  capabilityValue: string | undefined,
): string {
  return fieldValue ?? capabilityValue ?? NOT_DOCUMENTED
}

/** Art. 30(1)(d): always the field's own declared `recipientCategories`, verbatim -- see `types.ts`'s own doc comment on why this is never derived from anything data-cap's dependency graph could prove. `["Not documented"]` (never an empty array) when nothing was declared. */
function resolveRecipientCategories(field: FieldNode): readonly string[] {
  const declared = field.docs?.recipientCategories
  return declared !== undefined && declared.length > 0 ? declared : [NOT_DOCUMENTED]
}

function buildFieldEntry(field: FieldNode, capability: CapabilityNode): RopaFieldEntry {
  return {
    field: field.path[0] ?? "",
    dataSubjectCategory: field.docs?.dataSubjectCategory ?? NOT_DOCUMENTED,
    // Partial mapping (c, second half) -- see types.ts's own doc comment and
    // this generator's README for why `sensitivity` is an approximation,
    // not a rigorous personal-data-category taxonomy. `field.sensitivity` is
    // ADR 0057's resolved-value-plus-provenance shape (field's own
    // declaration, else the capability's), the one sanctioned path for it.
    personalDataCategory: field.sensitivity.value ?? NOT_DOCUMENTED,
    recipientCategories: resolveRecipientCategories(field),
    transferSafeguard: resolveFieldThenCapability(
      field.docs?.transferSafeguard,
      capability.docs?.transferSafeguard,
    ),
    retention: resolveFieldThenCapability(field.docs?.retention, capability.docs?.retention),
    // Partial mapping (g) -- see types.ts's own doc comment and the README.
    securityMeasures: resolveFieldThenCapability(
      field.docs?.protections,
      capability.docs?.protections,
    ),
  }
}

function buildRecord(capability: CapabilityNode): RopaRecord {
  const fields = capability.fields.map((field) => buildFieldEntry(field, capability))
  // field.purpose is already resolved (field's own, else the capability's --
  // ADR 0057), so aggregating across fields alone is enough; no separate
  // capability.docs?.purpose fallback is needed here the way
  // resolveFieldThenCapability needs one for retention/protections/
  // transferSafeguard (which ADR 0057 deliberately leaves unresolved).
  const purposesOfProcessing = joinDeclared(capability.fields.map((field) => field.purpose.value))

  return {
    capability: capability.exportName,
    file: capability.file,
    purposesOfProcessing,
    fields,
  }
}

/**
 * Projects every discovered capability (active or not -- see this
 * directory's README on why an inactive capability is still a candidate
 * processing activity worth accounting for, not silently dropped) into a
 * `RopaRecord`. `controller` is the caller-supplied Art. 30(1)(a) fact --
 * `run.ts` passes this example's own `controller-identity.ts`; a caller with
 * no real controller identity on hand should pass `undefined` rather than
 * inventing one, and the rendered document will say so honestly.
 */
export function buildRopaModel(
  evidence: EvidenceModel,
  controller: ControllerIdentity | undefined,
): RopaModel {
  return {
    schemaVersion: 1,
    generatedAt: evidence.provenance.generatedAt,
    controllerIdentity: controller ?? NOT_DOCUMENTED,
    records: evidence.capability.capabilities.map(buildRecord),
  }
}
