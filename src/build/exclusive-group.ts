/**
 * Detects two or more *active* capabilities sharing an `exclusiveGroup` --
 * a real conflict, since that's what the field means (mutually exclusive
 * implementations; only one member of a group should be live at once).
 * Direct port of env-cap's own exclusive-group check, since this specific
 * concept transfers unchanged (unlike the flat-namespace assumptions
 * `compatibility.ts` made -- see ADR 0049 for why that one didn't port).
 */

import type { CapabilityInventory, CapabilityNode } from "./inventory.js"
import type { ReportFinding } from "./findings.js"

/** Flags every `exclusiveGroup` shared by more than one *active* capability -- a hard `error`, since that's exactly what the field means. */
export function checkExclusiveGroups(inventory: CapabilityInventory): readonly ReportFinding[] {
  const byGroup = new Map<string, CapabilityNode[]>()
  for (const capability of inventory.capabilities) {
    if (!capability.active || capability.exclusiveGroup === undefined) continue
    const members = byGroup.get(capability.exclusiveGroup) ?? []
    members.push(capability)
    byGroup.set(capability.exclusiveGroup, members)
  }

  const findings: ReportFinding[] = []
  for (const [group, members] of byGroup) {
    if (members.length <= 1) continue
    for (const member of members) {
      const others = members.filter((m) => m !== member).map((m) => m.exportName)
      findings.push({
        code: "EXCLUSIVE_GROUP_CONFLICT",
        family: "structural",
        severity: "error",
        message: `"${member.exportName}" shares exclusiveGroup "${group}" with ${others.length} other active ${others.length === 1 ? "capability" : "capabilities"} (${others.join(", ")}) -- only one member of a group should be active at once.`,
        capability: { file: member.file, exportName: member.exportName },
        position: member.declarationPosition,
      })
    }
  }
  return findings
}
