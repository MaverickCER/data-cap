/**
 * Ownership and sensitivity findings computed directly off the inventory --
 * no file-tree scan needed, unlike `scan-dependencies.ts`. Standard
 * `sensitivity` vocabulary and the presence-only meaning of `protections`
 * are governed by ADR 0049; this module is what actually enforces those
 * boundaries when producing findings.
 */

import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  ResolvedGovernanceValue,
} from "./inventory.js"
import type { ReportFinding } from "./findings.js"

/** The standard `sensitivity` vocabulary (ADR 0049) -- anything else is honored but flagged for drift. */
function isStandardSensitivityLevel(level: string): boolean {
  return (
    level === "public" || level === "internal" || level === "confidential" || level === "restricted"
  )
}

/** A `FieldNode` governed property's own-declared value only, `undefined` when it's absent or only inherited from the capability (ADR 0057). */
function ownValue<T>(resolved: ResolvedGovernanceValue<T>): T | undefined {
  return resolved.declaredOn === "field" ? resolved.value : undefined
}

function checkCapabilityOwnership(capability: CapabilityNode): ReportFinding[] {
  if (capability.docs?.owner !== undefined) return []
  return [
    {
      code: "CAPABILITY_MISSING_OWNER",
      family: "governance",
      severity: "warning",
      message: `"${capability.exportName}" has no documented owner.`,
      capability: { file: capability.file, exportName: capability.exportName },
      position: capability.declarationPosition,
    },
  ]
}

function checkCapabilitySensitivity(capability: CapabilityNode): ReportFinding[] {
  const docs = capability.docs
  if (docs?.sensitivity === undefined) return []
  const sensitivity = docs.sensitivity
  const findings: ReportFinding[] = []
  const ref = {
    capability: { file: capability.file, exportName: capability.exportName },
    position: capability.declarationPosition,
  }
  if (!isStandardSensitivityLevel(sensitivity)) {
    findings.push({
      code: "NONSTANDARD_SENSITIVITY_LEVEL",
      family: "governance",
      severity: "info",
      message: `"${capability.exportName}" declares sensitivity "${sensitivity}", which isn't one of the standard levels (public/internal/confidential/restricted) -- still honored, just flagged for vocabulary drift.`,
      ...ref,
    })
  }
  if (docs.protections === undefined) {
    findings.push({
      code: "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS",
      family: "governance",
      severity: "warning",
      message: `"${capability.exportName}" declares sensitivity "${sensitivity}" but no documented protections.`,
      ...ref,
    })
  }
  return findings
}

function checkFieldSensitivity(capability: CapabilityNode, field: FieldNode): ReportFinding[] {
  // Deliberately the field's own declared value, not the capability-inherited
  // resolved value (`field.sensitivity.value` when `declaredOn === "capability"`)
  // -- checkCapabilitySensitivity already fires
  // SENSITIVE_CAPABILITY_MISSING_PROTECTIONS once per capability, so
  // triggering here on the inherited value would duplicate that finding for
  // every field on a sensitive capability (ADR 0050, ADR 0057).
  const sensitivity = ownValue(field.sensitivity)
  if (sensitivity === undefined) return []
  const findings: ReportFinding[] = []
  const ref = {
    capability: { file: capability.file, exportName: capability.exportName },
    field: field.path,
    position: field.declarationPosition,
  }
  if (!isStandardSensitivityLevel(sensitivity)) {
    findings.push({
      code: "NONSTANDARD_SENSITIVITY_LEVEL",
      family: "governance",
      severity: "info",
      message: `Field "${field.path.join(".")}" on "${capability.exportName}" declares sensitivity "${sensitivity}", which isn't one of the standard levels (public/internal/confidential/restricted) -- still honored, just flagged for vocabulary drift.`,
      ...ref,
    })
  }
  if (field.docs?.protections === undefined) {
    findings.push({
      code: "SENSITIVE_FIELD_MISSING_PROTECTIONS",
      family: "governance",
      severity: "warning",
      message: `Field "${field.path.join(".")}" on "${capability.exportName}" declares sensitivity "${sensitivity}" but no documented protections.`,
      ...ref,
    })
  }
  return findings
}

function checkCapabilityAuditRequired(capability: CapabilityNode): ReportFinding[] {
  if (capability.docs?.auditRequired !== true || capability.docs.owner !== undefined) return []
  return [
    {
      code: "AUDIT_REQUIRED_WITHOUT_OWNER",
      family: "governance",
      severity: "warning",
      message: `"${capability.exportName}" declares auditRequired but has no documented owner to hold accountable for that audit trail.`,
      capability: { file: capability.file, exportName: capability.exportName },
      position: capability.declarationPosition,
    },
  ]
}

/**
 * `purpose`/`legalBasis`/`auditRequired` presence findings for one field --
 * same presence-only discipline `checkFieldSensitivity` established for
 * `protections` (a finding here means "not declared, own or inherited,"
 * never "declared but inadequate"). `purpose`/`legalBasis` trigger off the
 * field's own declared sensitivity, not the capability-inherited value, for
 * the same dedup-avoidance reason `checkFieldSensitivity` does (ADR 0050) --
 * but check the RESOLVED (fallback-inclusive) `purpose`/`legalBasis`, since
 * a capability-level declaration legitimately covers every field under it.
 */
function checkFieldGovernance(capability: CapabilityNode, field: FieldNode): ReportFinding[] {
  const findings: ReportFinding[] = []
  const ref = {
    capability: { file: capability.file, exportName: capability.exportName },
    field: field.path,
    position: field.declarationPosition,
  }
  const ownSensitivity = ownValue(field.sensitivity)
  if (ownSensitivity !== undefined) {
    if (field.purpose.value === undefined) {
      findings.push({
        code: "SENSITIVE_FIELD_MISSING_PURPOSE",
        family: "governance",
        severity: "warning",
        message: `Field "${field.path.join(".")}" on "${capability.exportName}" declares sensitivity "${ownSensitivity}" but no declared purpose (own or inherited).`,
        ...ref,
      })
    }
    if (field.legalBasis.value === undefined) {
      findings.push({
        code: "SENSITIVE_FIELD_MISSING_LEGAL_BASIS",
        family: "governance",
        severity: "warning",
        message: `Field "${field.path.join(".")}" on "${capability.exportName}" declares sensitivity "${ownSensitivity}" but no declared legal basis (own or inherited).`,
        ...ref,
      })
    }
  }
  if (field.auditRequired.value === true && field.owner.value === undefined) {
    findings.push({
      code: "AUDIT_REQUIRED_WITHOUT_OWNER",
      family: "governance",
      severity: "warning",
      message: `Field "${field.path.join(".")}" on "${capability.exportName}" declares auditRequired but has no documented owner (own or inherited) to hold accountable for that audit trail.`,
      ...ref,
    })
  }
  return findings
}

/** Ownership and sensitivity findings for every capability/field in the inventory -- pure, no file-tree scan. */
export function checkOwnershipAndSensitivity(
  inventory: CapabilityInventory,
): readonly ReportFinding[] {
  const findings: ReportFinding[] = []
  for (const capability of inventory.capabilities) {
    findings.push(...checkCapabilityOwnership(capability))
    findings.push(...checkCapabilitySensitivity(capability))
    findings.push(...checkCapabilityAuditRequired(capability))
    for (const field of capability.fields) {
      findings.push(...checkFieldSensitivity(capability, field))
      findings.push(...checkFieldGovernance(capability, field))
    }
  }
  return findings
}
