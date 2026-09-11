/**
 * Graph-export reference projections (ADR 0050) -- DOT renderers over
 * Dependency Model and Ownership Model, answering the Capability/Data
 * Dependency Graph and Data Ownership Graph requests. Deliberately a fresh,
 * small renderer rather than a forced reuse of `flow-diagram.ts`'s private
 * `DiagramBuilder`: that class is Mermaid- and OWASP-data-flow-vocabulary-
 * specific (external entities/data stores/trust boundaries built from
 * `FieldFlow`/`DataFlowEndpoint`), a different domain from a capability's
 * consumer graph or its ownership matrix -- generalizing it would have
 * meant bending an OWASP-shaped renderer to fit an unrelated graph, not
 * genuine reuse.
 */

import type { DependencyModel } from "./dependency-model.js"
import { groupEdgesByCapability } from "./dependency-projections.js"
import { NodeIdAllocator } from "./node-id-allocator.js"
import type { OwnershipModel } from "./ownership-model.js"

function escapeDotLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

/**
 * Renders Dependency Model as a DOT digraph: one node per capability, one
 * node per consuming file, edges labeled by relationship. `capabilities`
 * supplies the full capability list -- since `model.edges` alone can never
 * reveal a capability with zero edges, this is what lets a genuinely
 * unconsumed capability still appear as a node (see `groupEdgesByCapability`,
 * ADR 0056).
 */
export function renderDependencyGraphDot(
  capabilities: readonly { readonly file: string; readonly exportName: string }[],
  model: DependencyModel,
): string {
  const ids = new NodeIdAllocator()
  const nodeLines: string[] = []
  const edgeLines: string[] = []
  const declaredCapabilities = new Set<string>()

  for (const { capability } of groupEdgesByCapability(capabilities, model.edges)) {
    const key = `capability:${capability.file}#${capability.exportName}`
    const id = ids.idFor(key)
    declaredCapabilities.add(key)
    nodeLines.push(`  "${id}" [label="${escapeDotLabel(capability.exportName)}", shape=box];`)
  }

  for (const edge of model.edges) {
    const consumerKey = `consumer:${edge.from}`
    const consumerId = ids.idFor(consumerKey)
    if (!nodeLines.some((line) => line.startsWith(`  "${consumerId}" `))) {
      nodeLines.push(`  "${consumerId}" [label="${escapeDotLabel(edge.from)}", shape=ellipse];`)
    }
    const capabilityKey = `capability:${edge.to.capability.file}#${edge.to.capability.exportName}`
    const capabilityId = ids.idFor(capabilityKey)
    if (!declaredCapabilities.has(capabilityKey)) {
      nodeLines.push(
        `  "${capabilityId}" [label="${escapeDotLabel(edge.to.capability.exportName)}", shape=box];`,
      )
      declaredCapabilities.add(capabilityKey)
    }
    const detail = edge.to.field?.join(".") ?? edge.to.operation
    const label = detail !== undefined ? `${edge.relationship}: ${detail}` : edge.relationship
    const style = edge.resolution === "resolved" ? "solid" : "dashed"
    edgeLines.push(
      `  "${consumerId}" -> "${capabilityId}" [label="${escapeDotLabel(label)}", style=${style}];`,
    )
  }

  return ["digraph DependencyGraph {", "  rankdir=LR;", ...nodeLines, ...edgeLines, "}"].join("\n")
}

/** Renders Ownership Model as a DOT digraph: one node per owner, one node per capability/field they're accountable for. */
export function renderOwnershipGraphDot(model: OwnershipModel): string {
  const ids = new NodeIdAllocator()
  const nodeLines: string[] = []
  const edgeLines: string[] = []
  const declaredNodes = new Set<string>()

  for (const entry of model.entries) {
    const ownerKey = `owner:${entry.owner}`
    const ownerId = ids.idFor(ownerKey)
    // `UNOWNED` is itself the string `"(unowned)"`, so `entry.owner` already
    // reads correctly for the unowned bucket -- no special-casing needed.
    nodeLines.push(
      `  "${ownerId}" [label="${escapeDotLabel(entry.owner)}", shape=box, peripheries=2];`,
    )

    for (const capability of entry.capabilities) {
      const key = `capability:${capability.file}#${capability.exportName}`
      const id = ids.idFor(key)
      if (!declaredNodes.has(key)) {
        nodeLines.push(`  "${id}" [label="${escapeDotLabel(capability.exportName)}", shape=box];`)
        declaredNodes.add(key)
      }
      edgeLines.push(`  "${ownerId}" -> "${id}";`)
    }

    for (const field of entry.fields) {
      const key = `field:${field.capability.file}#${field.capability.exportName}.${field.field.join(".")}`
      const id = ids.idFor(key)
      const label = `${field.capability.exportName}.${field.field.join(".")}`
      if (!declaredNodes.has(key)) {
        nodeLines.push(`  "${id}" [label="${escapeDotLabel(label)}", shape=ellipse];`)
        declaredNodes.add(key)
      }
      edgeLines.push(`  "${ownerId}" -> "${id}";`)
    }
  }

  return ["digraph OwnershipGraph {", "  rankdir=LR;", ...nodeLines, ...edgeLines, "}"].join("\n")
}
