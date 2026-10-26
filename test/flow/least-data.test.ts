import { describe, expect, it } from "vitest"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import { analyzeLeastData, leastDataFindings } from "../../src/flow/least-data.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

const CAP_FILE = "features/user.ts"
const SHAPE = { id: "", name: "", email: "", passwordHash: "", role: "" }

function field(name: string, shape: unknown, sensitivity?: string): FieldNode {
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

function getter(
  name: string,
  endpoints: OperationNode["endpoints"],
  writes: string[][],
): OperationNode {
  return {
    kind: "getter",
    name,
    docs: undefined,
    writes,
    hasProcessor: false,
    hasOptimistic: false,
    endpoints,
  }
}

function inventory(fields: FieldNode[], getters: OperationNode[] = []): CapabilityInventory {
  const capability: CapabilityNode = {
    file: CAP_FILE,
    exportName: "userData",
    kind: "createData",
    docs: undefined,
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields,
    getters,
    mutators: [],
    subscriptions: [],
  }
  return {
    schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
    capabilities: [capability],
    warnings: [],
  }
}

const fid = (name: string): string => flowNodeId("field", CAP_FILE, `userData.${name}`)
const fnId = (name: string): string => flowNodeId("function", "app.ts", name)
const http = flowNodeId("boundary", "boundary:code", "http-response")
const fieldNode = (name: string): FlowNodeInput => ({
  kind: "field",
  scope: CAP_FILE,
  name: `userData.${name}`,
  status: "static",
})
const fnNode = (name: string, status: FlowNodeInput["status"] = "static"): FlowNodeInput => ({
  kind: "function",
  scope: "app.ts",
  name,
  status,
})
const httpNode: FlowNodeInput = {
  kind: "boundary",
  scope: "boundary:code",
  name: "http-response",
  status: "static",
  boundaryKind: "client-response",
}
const edge = (
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

describe("analyzeLeastData: unused paths", () => {
  it("reports a shape key that nothing reads, forwards or sends", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h"), httpNode],
      edges: [
        edge("reads", fid("user"), fnId("h"), ["email"]),
        edge("side-effect", fnId("h"), http, ["email"]),
      ],
      unknowns: [],
    })
    const report = analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow })
    expect(report.unusedPaths.map((u) => u.path.join("."))).toEqual([
      "id",
      "name",
      "passwordHash",
      "role",
    ])
    expect(report.unusedPaths[0]).toMatchObject({
      capability: { file: CAP_FILE, exportName: "userData" },
      field: "user",
      fieldNode: fid("user"),
    })
  })

  it("a read used only locally still counts as a use", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h")],
      edges: [edge("reads", fid("user"), fnId("h"), ["role"])],
      unknowns: [],
    })
    const report = analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow })
    expect(report.unusedPaths.map((u) => u.path.join("."))).not.toContain("role")
  })

  it("passing the whole value along does not by itself count as using every key", () => {
    const flow = buildFlowModel({
      nodes: [
        fieldNode("user"),
        fnNode("a"),
        fnNode("b"),
        { kind: "parameter", scope: "app.ts", name: "b.user", status: "static" },
      ],
      edges: [
        edge("reads", fid("user"), fnId("a"), []),
        edge("passes", fnId("a"), flowNodeId("parameter", "app.ts", "b.user"), []),
      ],
      unknowns: [],
    })
    const report = analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow })
    expect(report.unusedPaths).toHaveLength(5)
  })

  it("a whole value reaching a boundary uses every key", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h"), httpNode],
      edges: [edge("side-effect", fnId("h"), http, [])],
      unknowns: [],
    })
    expect(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }).unusedPaths,
    ).toEqual([])
  })

  it("an edge with no path at all reaching a boundary uses every key", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h"), httpNode],
      edges: [edge("side-effect", fnId("h"), http, undefined)],
      unknowns: [],
    })
    expect(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }).unusedPaths,
    ).toEqual([])
  })

  it("a declared output endpoint on the field uses every key", () => {
    const stripe = flowNodeId("boundary", "boundary", "stripe")
    const flow = buildFlowModel({
      nodes: [
        fieldNode("user"),
        {
          kind: "boundary",
          scope: "boundary",
          name: "stripe",
          status: "declared",
          boundaryKind: "external-service",
        },
      ],
      edges: [edge("crosses-boundary", fid("user"), stripe, undefined, { status: "declared" })],
      unknowns: [],
    })
    expect(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }).unusedPaths,
    ).toEqual([])
  })

  it("a declared input endpoint is not a use", () => {
    const pg = flowNodeId("boundary", "boundary", "pg")
    const flow = buildFlowModel({
      nodes: [
        fieldNode("user"),
        {
          kind: "boundary",
          scope: "boundary",
          name: "pg",
          status: "declared",
          boundaryKind: "database",
        },
      ],
      edges: [edge("crosses-boundary", pg, fid("user"), undefined, { status: "declared" })],
      unknowns: [],
    })
    expect(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }).unusedPaths,
    ).toHaveLength(5)
  })

  it("a discards edge is not a use", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h")],
      edges: [edge("discards", fnId("h"), fid("user"), ["role"])],
      unknowns: [],
    })
    expect(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }).unusedPaths.map(
        (u) => u.path.join("."),
      ),
    ).toContain("role")
  })

  it("carries the field's sensitivity and where the field is declared to be fetched from", () => {
    const flow = buildFlowModel({ nodes: [fieldNode("user")], edges: [], unknowns: [] })
    const inv = inventory(
      [field("user", { token: "" }, "secret")],
      [
        getter(
          "getUser",
          [
            { direction: "input", kind: "database", name: "postgres:users" },
            { direction: "output", kind: "api", name: "ignored" },
          ],
          [["user"]],
        ),
      ],
    )
    const [unused] = analyzeLeastData({ capability: inv, flow }).unusedPaths
    expect(unused).toMatchObject({
      sensitivity: "secret",
      fetchedFrom: ["postgres:users"],
      path: ["token"],
    })
  })

  it("is empty for a field whose shape is not an object", () => {
    const flow = buildFlowModel({ nodes: [fieldNode("user")], edges: [], unknowns: [] })
    for (const shape of ["", 0, [], null, undefined]) {
      expect(
        analyzeLeastData({ capability: inventory([field("user", shape)]), flow }).unusedPaths,
      ).toEqual([])
    }
  })

  it("does not assess a field whose downstream trace is incomplete, and says so", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h")],
      edges: [edge("reads", fid("user"), fnId("h"), ["email"])],
      unknowns: [
        {
          reason: "unresolved-call",
          subject: fnId("h"),
          source: { file: "app.ts", line: 3, column: 1 },
        },
      ],
    })
    const report = analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow })
    expect(report.unusedPaths).toEqual([])
    expect(report.indeterminate).toEqual([
      {
        capability: { file: CAP_FILE, exportName: "userData" },
        field: "user",
        fieldNode: fid("user"),
        reason: "flow-incomplete",
        paths: [["id"], ["name"], ["email"], ["passwordHash"], ["role"]],
      },
    ])
  })

  it("assesses every key the unknown does not concern, and names the ones it blocks", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h")],
      edges: [edge("reads", fid("user"), fnId("h"), ["email"])],
      unknowns: [
        {
          reason: "unresolved-call",
          subject: fnId("h"),
          source: { file: "app.ts", line: 3, column: 1 },
          data: [{ origin: fid("user"), path: ["email"] }],
        },
      ],
    })
    const report = analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow })
    expect(report.unusedPaths.map((u) => u.path.join("."))).toEqual([
      "id",
      "name",
      "passwordHash",
      "role",
    ])
    expect(report.indeterminate).toEqual([
      expect.objectContaining({ field: "user", reason: "flow-incomplete", paths: [["email"]] }),
    ])
  })

  it("an unknown about a different field blocks nothing here", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fieldNode("team"), fnNode("h")],
      edges: [edge("reads", fid("user"), fnId("h"), ["email"])],
      unknowns: [
        {
          reason: "unresolved-call",
          subject: fnId("h"),
          source: { file: "app.ts", line: 3, column: 1 },
          data: [{ origin: fid("team"), path: [] }],
        },
      ],
    })
    const report = analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow })
    expect(report.indeterminate).toEqual([])
    expect(report.unusedPaths).toHaveLength(4)
  })

  it("does not assess a field that has no node in the flow model", () => {
    const flow = buildFlowModel({ nodes: [], edges: [], unknowns: [] })
    const report = analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow })
    expect(report.unusedPaths).toEqual([])
    expect(report.indeterminate).toHaveLength(1)
  })

  it("skips inactive capabilities", () => {
    const flow = buildFlowModel({ nodes: [fieldNode("user")], edges: [], unknowns: [] })
    const inv = inventory([field("user", SHAPE)])
    const inactive: CapabilityInventory = {
      ...inv,
      capabilities: inv.capabilities.map((c) => ({ ...c, active: false })),
    }
    expect(analyzeLeastData({ capability: inactive, flow }).unusedPaths).toEqual([])
  })
})

describe("analyzeLeastData: whole field to client", () => {
  it("reports a whole multi-key field sent to a client response", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h"), httpNode],
      edges: [edge("side-effect", fnId("h"), http, [])],
      unknowns: [],
    })
    const report = analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow })
    expect(report.wholeFieldToClient).toEqual([
      expect.objectContaining({
        field: "user",
        fieldNode: fid("user"),
        boundary: http,
        boundaryName: "http-response",
        keys: ["id", "name", "email", "passwordHash", "role"],
      }),
    ])
    expect(report.wholeFieldToClient[0]?.edges).toHaveLength(1)
  })

  it("does not report a specific path sent to the client", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h"), httpNode],
      edges: [edge("side-effect", fnId("h"), http, ["email"])],
      unknowns: [],
    })
    expect(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }).wholeFieldToClient,
    ).toEqual([])
  })

  it("does not report a whole field with fewer than two keys", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h"), httpNode],
      edges: [edge("side-effect", fnId("h"), http, [])],
      unknowns: [],
    })
    expect(
      analyzeLeastData({ capability: inventory([field("user", { only: "" })]), flow })
        .wholeFieldToClient,
    ).toEqual([])
  })

  it("does not report a whole field sent to a non-client boundary", () => {
    const log = flowNodeId("boundary", "boundary:code", "console")
    const flow = buildFlowModel({
      nodes: [
        fieldNode("user"),
        fnNode("h"),
        {
          kind: "boundary",
          scope: "boundary:code",
          name: "console",
          status: "static",
          boundaryKind: "log",
        },
      ],
      edges: [edge("side-effect", fnId("h"), log, [])],
      unknowns: [],
    })
    expect(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }).wholeFieldToClient,
    ).toEqual([])
  })
})

describe("leastDataFindings", () => {
  const flow = buildFlowModel({
    nodes: [fieldNode("user"), fnNode("h"), httpNode],
    edges: [edge("side-effect", fnId("h"), http, [])],
    unknowns: [],
  })

  it("an unused path is an info finding; an unused sensitive path is a warning", () => {
    const plain = leastDataFindings(
      analyzeLeastData({
        capability: inventory([field("user", { a: "" })]),
        flow: buildFlowModel({ nodes: [fieldNode("user")], edges: [], unknowns: [] }),
      }),
    )
    expect(plain).toEqual([
      expect.objectContaining({
        code: "LEAST_DATA_UNUSED_PATH",
        severity: "info",
        family: "flow",
        field: ["user", "a"],
      }),
    ])
    const sensitive = leastDataFindings(
      analyzeLeastData({
        capability: inventory([field("user", { a: "" }, "secret")]),
        flow: buildFlowModel({ nodes: [fieldNode("user")], edges: [], unknowns: [] }),
      }),
    )
    expect(sensitive[0]).toMatchObject({
      code: "LEAST_DATA_UNUSED_SENSITIVE_PATH",
      severity: "warning",
    })
  })

  it("mentions the declared source so a query projection can be tightened", () => {
    const inv = inventory(
      [field("user", { a: "" })],
      [getter("g", [{ direction: "input", kind: "database", name: "postgres:users" }], [["user"]])],
    )
    const [finding] = leastDataFindings(
      analyzeLeastData({
        capability: inv,
        flow: buildFlowModel({ nodes: [fieldNode("user")], edges: [], unknowns: [] }),
      }),
    )
    expect(finding?.message).toContain("postgres:users")
  })

  it("a whole field to the client is a warning naming the keys", () => {
    const [finding] = leastDataFindings(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }),
    )
    expect(finding).toMatchObject({
      code: "LEAST_DATA_WHOLE_FIELD_TO_CLIENT",
      severity: "warning",
      family: "flow",
    })
    expect(finding?.message).toContain("passwordHash")
  })

  it("an unassessable field is an info finding", () => {
    const findings = leastDataFindings(
      analyzeLeastData({
        capability: inventory([field("user", SHAPE)]),
        flow: buildFlowModel({ nodes: [], edges: [], unknowns: [] }),
      }),
    )
    expect(findings).toEqual([
      expect.objectContaining({ code: "LEAST_DATA_ANALYSIS_INDETERMINATE", severity: "info" }),
    ])
  })

  it("an indeterminate finding names the paths it could not assess", () => {
    const flow = buildFlowModel({
      nodes: [fieldNode("user"), fnNode("h")],
      edges: [edge("reads", fid("user"), fnId("h"), ["email"])],
      unknowns: [
        {
          reason: "unresolved-call",
          subject: fnId("h"),
          source: { file: "app.ts", line: 3, column: 1 },
          data: [{ origin: fid("user"), path: ["email"] }],
        },
      ],
    })
    const finding = leastDataFindings(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }),
    ).find((f) => f.code === "LEAST_DATA_ANALYSIS_INDETERMINATE")
    expect(finding?.message).toContain("email")
    expect(finding?.message).not.toContain("passwordHash")
  })

  it("links an unused path to its field, and a whole-field send to the edges that send it", () => {
    const unused = leastDataFindings(
      analyzeLeastData({
        capability: inventory([field("user", { a: "" })]),
        flow: buildFlowModel({ nodes: [fieldNode("user")], edges: [], unknowns: [] }),
      }),
    )
    expect(unused[0]?.evidence).toEqual([{ model: "flow", id: fid("user") }])
    const whole = leastDataFindings(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }),
    )
    expect(whole[0]?.evidence?.map((ref) => ref.model)).toEqual(["flow", "flow"])
    expect(whole[0]?.evidence?.[0]).toEqual({ model: "flow", id: fid("user") })
  })

  it("is deterministic and ordered", () => {
    const a = leastDataFindings(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }),
    )
    const b = leastDataFindings(
      analyzeLeastData({ capability: inventory([field("user", SHAPE)]), flow }),
    )
    expect(b).toEqual(a)
  })
})
