/**
 * Reference projections (ADR 0050) over Capability Model alone -- plain
 * exported functions, deliberately NOT routed through
 * `defineEvidenceProjection()`. A single-model filter gains nothing from
 * full Evidence composition; requiring one would only add a dependency
 * (every other model available) this kind of filter never needs. Answers
 * the Getter/Mutator/Subscription/Field/Operation Report requests as
 * `kind`-filtered views over the one shared inventory, not separate,
 * independently-computed artifacts.
 */

import type { CapabilityInventory, CapabilityNode, FieldNode, OperationNode } from "./inventory.js"

/** One node plus the capability it belongs to. */
export interface WithCapability<T> {
  /** The capability this node belongs to. */
  readonly capability: { readonly file: string; readonly exportName: string }
  /** The node itself. */
  readonly node: T
}

function capabilityRef(capability: CapabilityNode): WithCapability<never>["capability"] {
  return { file: capability.file, exportName: capability.exportName }
}

function projectOperations(
  inventory: CapabilityInventory,
  kind: OperationNode["kind"],
): readonly WithCapability<OperationNode>[] {
  return inventory.capabilities.flatMap((capability) => {
    const operations = {
      getter: capability.getters,
      mutator: capability.mutators,
      subscription: capability.subscriptions,
    }[kind]
    return operations.map((node) => ({ capability: capabilityRef(capability), node }))
  })
}

/** Every getter across every capability -- the Getter Report. */
export function projectGetters(
  inventory: CapabilityInventory,
): readonly WithCapability<OperationNode>[] {
  return projectOperations(inventory, "getter")
}

/** Every mutator across every capability -- the Mutator Report. */
export function projectMutators(
  inventory: CapabilityInventory,
): readonly WithCapability<OperationNode>[] {
  return projectOperations(inventory, "mutator")
}

/** Every subscription across every capability -- the Subscription Report. */
export function projectSubscriptions(
  inventory: CapabilityInventory,
): readonly WithCapability<OperationNode>[] {
  return projectOperations(inventory, "subscription")
}

/** Every getter, mutator, and subscription across every capability -- the Operation Inventory Report. */
export function projectOperationInventory(
  inventory: CapabilityInventory,
): readonly WithCapability<OperationNode>[] {
  return [
    ...projectGetters(inventory),
    ...projectMutators(inventory),
    ...projectSubscriptions(inventory),
  ]
}

/** Every field across every capability -- the Field Inventory Report. */
export function projectFields(
  inventory: CapabilityInventory,
): readonly WithCapability<FieldNode>[] {
  return inventory.capabilities.flatMap((capability) =>
    capability.fields.map((node) => ({ capability: capabilityRef(capability), node })),
  )
}
