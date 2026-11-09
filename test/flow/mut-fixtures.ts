import { flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowModel, FlowNodeInput } from "../../src/flow/flow-model.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

export const CAP_FILE = "features/user.ts"

export function fieldNodeOf(name: string, shape: unknown, sensitivity?: string): FieldNode {
  return {
    path: [name],
    docs: undefined,
    owner: { value: undefined, declaredOn: undefined },
    sensitivity: {
      value: sensitivity,
      declaredOn: sensitivity === undefined ? undefined : "capability",
    },
    purpose: { value: undefined, declaredOn: undefined },
    legalBasis: { value: undefined, declaredOn: undefined },
    dataResidency: { value: undefined, declaredOn: undefined },
    auditRequired: { value: undefined, declaredOn: undefined },
    declarationPosition: undefined,
    writtenBy: [],
    shape,
  }
}

export function operation(
  kind: OperationNode["kind"],
  name: string,
  endpoints: OperationNode["endpoints"],
  writes: string[][],
): OperationNode {
  return {
    kind,
    name,
    docs: undefined,
    writes,
    hasProcessor: false,
    hasOptimistic: false,
    endpoints,
  }
}

export function inventoryOf(
  fields: FieldNode[],
  operations: {
    getters?: OperationNode[]
    mutators?: OperationNode[]
    subscriptions?: OperationNode[]
  } = {},
  overrides: Partial<CapabilityNode> = {},
): CapabilityInventory {
  const capability: CapabilityNode = {
    file: CAP_FILE,
    exportName: "userData",
    kind: "createData",
    docs: undefined,
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields,
    getters: operations.getters ?? [],
    mutators: operations.mutators ?? [],
    subscriptions: operations.subscriptions ?? [],
    ...overrides,
  }
  return {
    schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
    capabilities: [capability],
    warnings: [],
  }
}

export const fid = (name: string): string => flowNodeId("field", CAP_FILE, `userData.${name}`)
export const fnId = (name: string): string => flowNodeId("function", "app.ts", name)
export const HTTP = flowNodeId("boundary", "boundary:code", "http-response")
export const fieldInput = (name: string): FlowNodeInput => ({
  kind: "field",
  scope: CAP_FILE,
  name: `userData.${name}`,
  status: "static",
})
export const fnInput = (
  name: string,
  status: FlowNodeInput["status"] = "static",
): FlowNodeInput => ({
  kind: "function",
  scope: "app.ts",
  name,
  status,
})
export const httpInput: FlowNodeInput = {
  kind: "boundary",
  scope: "boundary:code",
  name: "http-response",
  status: "static",
  boundaryKind: "client-response",
}
export const edgeInput = (
  kind: FlowEdgeInput["kind"],
  from: string,
  to: string,
  path: string[] | undefined,
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput => ({
  kind,
  from,
  to,
  status: "static",
  origin: fid("user"),
  ...(path === undefined ? {} : { path }),
  ...extra,
})

/** A model with an extra, hand-made (unvalidated) edge appended: for code paths a validated model cannot reach. */
export function withRawEdges(flow: FlowModel, ...edges: FlowEdgeInput[]): FlowModel {
  return {
    ...flow,
    edges: [...flow.edges, ...edges.map((e) => ({ ...e, id: `raw:${e.kind}:${e.from}->${e.to}` }))],
  }
}
