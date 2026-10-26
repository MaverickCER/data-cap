import { describe, expect, it } from "vitest"
import { buildFlowModel, flowEdgeId, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeKind } from "../../src/flow/flow-model.js"
import { analyzeLeastData, leastDataFindings } from "../../src/flow/least-data.js"
import type { LeastDataReport } from "../../src/flow/least-data.js"
import {
  CAP_FILE,
  edgeInput,
  fieldInput,
  fieldNodeOf,
  fid,
  fnId,
  fnInput,
  HTTP,
  httpInput,
  inventoryOf,
  operation,
  withRawEdges,
} from "./mut-fixtures.js"

const CAP = { file: CAP_FILE, exportName: "userData" }
const TWO = { email: "", name: "" }
const THREE = { email: "", name: "", role: "" }

function usedKeys(kind: FlowEdgeKind): string[] {
  const flow = buildFlowModel({
    nodes: [fieldInput("user"), fnInput("h")],
    edges: [edgeInput(kind, fid("user"), fnId("h"), ["email"])],
    unknowns: [],
  })
  const report = analyzeLeastData({ capability: inventoryOf([fieldNodeOf("user", TWO)]), flow })
  return report.unusedPaths.map((u) => u.path[0] ?? "")
}

describe("analyzeLeastData: which edge kinds are a use", () => {
  it.each(["reads", "passes", "returns", "transforms", "side-effect", "crosses-boundary"] as const)(
    "%s with the key's path uses the key",
    (kind) => {
      expect(usedKeys(kind)).toEqual(["name"])
    },
  )

  it.each(["writes", "calls", "discards"] as const)("%s does not use the key", (kind) => {
    expect(usedKeys(kind)).toEqual(["email", "name"])
  })
})

describe("analyzeLeastData: exact report shape", () => {
  it("states the exact unused path record, with sensitivity and fetch sources", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user"), fnInput("h")],
      edges: [edgeInput("reads", fid("user"), fnId("h"), ["email"])],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO, "pii")]),
      flow,
    })
    expect(report).toEqual({
      unusedPaths: [
        {
          capability: CAP,
          field: "user",
          fieldNode: fid("user"),
          path: ["name"],
          sensitivity: "pii",
          fetchedFrom: [],
        },
      ],
      wholeFieldToClient: [],
      indeterminate: [],
    })
  })

  it("reports a field absent from the flow as not-analyzed, listing each key as its own path", () => {
    const flow = buildFlowModel({ nodes: [], edges: [], unknowns: [] })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report).toEqual({
      unusedPaths: [],
      wholeFieldToClient: [],
      indeterminate: [
        {
          capability: CAP,
          field: "user",
          fieldNode: fid("user"),
          reason: "not-analyzed",
          paths: [["email"], ["name"]],
        },
      ],
    })
  })

  it("skips a field with no keys without reporting anything", () => {
    const flow = buildFlowModel({ nodes: [], edges: [], unknowns: [] })
    const report = analyzeLeastData({
      capability: inventoryOf([
        fieldNodeOf("a", {}),
        fieldNodeOf("b", null),
        fieldNodeOf("c", ["x", "y"]),
        fieldNodeOf("d", "text"),
      ]),
      flow,
    })
    expect(report).toEqual({ unusedPaths: [], wholeFieldToClient: [], indeterminate: [] })
  })

  it("skips a field whose path is empty", () => {
    const flow = buildFlowModel({ nodes: [], edges: [], unknowns: [] })
    const noName = { ...fieldNodeOf("x", TWO), path: [] }
    const report = analyzeLeastData({ capability: inventoryOf([noName]), flow })
    expect(report).toEqual({ unusedPaths: [], wholeFieldToClient: [], indeterminate: [] })
  })

  it("skips inactive capabilities", () => {
    const flow = buildFlowModel({ nodes: [], edges: [], unknowns: [] })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)], {}, { active: false }),
      flow,
    })
    expect(report).toEqual({ unusedPaths: [], wholeFieldToClient: [], indeterminate: [] })
  })

  it("names a nested field node by joining its whole path with dots", () => {
    const nested = { ...fieldNodeOf("user", TWO), path: ["user", "profile"] }
    const flow = buildFlowModel({
      nodes: [
        {
          kind: "field",
          scope: CAP_FILE,
          name: "userData.user.profile",
          status: "static",
        },
      ],
      edges: [],
      unknowns: [],
    })
    const report = analyzeLeastData({ capability: inventoryOf([nested]), flow })
    expect(report.indeterminate).toEqual([])
    expect(report.unusedPaths.map((u) => u.fieldNode)).toEqual([
      flowNodeId("field", CAP_FILE, "userData.user.profile"),
      flowNodeId("field", CAP_FILE, "userData.user.profile"),
    ])
    expect(report.unusedPaths.map((u) => u.field)).toEqual(["user", "user"])
  })

  it("counts only edges that carry this field's own data", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user"), fieldInput("other"), fnInput("h")],
      edges: [edgeInput("reads", fid("other"), fnId("h"), ["email"], { origin: fid("other") })],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.unusedPaths.map((u) => u.path[0])).toEqual(["email", "name"])
  })

  it("an edge out of a boundary is never a use", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user"), httpInput, fnInput("h")],
      edges: [
        edgeInput("reads", HTTP, fnId("h"), ["email"]),
        edgeInput("reads", fid("user"), fnId("h"), ["name"]),
      ],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.unusedPaths.map((u) => u.path[0])).toEqual(["email"])
  })

  it("an edge from a node the model does not contain is judged by its path", () => {
    const flow = withRawEdges(
      buildFlowModel({ nodes: [fieldInput("user")], edges: [], unknowns: [] }),
      edgeInput("reads", "ghost", fid("user"), ["email"]),
    )
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.unusedPaths.map((u) => u.path[0])).toEqual(["name"])
  })

  it("a whole-value edge into a node the model does not contain uses nothing", () => {
    const flow = withRawEdges(
      buildFlowModel({ nodes: [fieldInput("user")], edges: [], unknowns: [] }),
      edgeInput("side-effect", fid("user"), "ghost", undefined),
    )
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.unusedPaths.map((u) => u.path[0])).toEqual(["email", "name"])
    expect(report.wholeFieldToClient).toEqual([])
  })

  it("a whole-value edge into a non-boundary node uses nothing", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user"), fnInput("h")],
      edges: [edgeInput("side-effect", fid("user"), fnId("h"), undefined)],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.unusedPaths.map((u) => u.path[0])).toEqual(["email", "name"])
  })

  it.each(["returns", "passes", "reads", "transforms"] as const)(
    "a whole-value %s into a boundary is not the boundary use of a side effect or crossing",
    (kind) => {
      const flow = buildFlowModel({
        nodes: [fieldInput("user"), httpInput],
        edges: [edgeInput(kind, fid("user"), HTTP, undefined)],
        unknowns: [],
      })
      const report = analyzeLeastData({
        capability: inventoryOf([fieldNodeOf("user", TWO)]),
        flow,
      })
      expect(report.unusedPaths.map((u) => u.path[0])).toEqual(["email", "name"])
    },
  )

  it("a whole-value crossing into a boundary uses every key", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user"), httpInput],
      edges: [edgeInput("crosses-boundary", fid("user"), HTTP, [])],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.unusedPaths).toEqual([])
  })
})

describe("analyzeLeastData: whole field to client", () => {
  const sendWhole = (keysShape: unknown, extraEdges = [] as ReturnType<typeof edgeInput>[]) =>
    analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", keysShape)]),
      flow: buildFlowModel({
        nodes: [fieldInput("user"), fnInput("h"), httpInput],
        edges: [edgeInput("side-effect", fnId("h"), HTTP, undefined), ...extraEdges],
        unknowns: [],
      }),
    }).wholeFieldToClient

  it("reports the exact record for a two-key field", () => {
    expect(sendWhole(TWO)).toEqual([
      {
        capability: CAP,
        field: "user",
        fieldNode: fid("user"),
        boundary: HTTP,
        boundaryName: "http-response",
        keys: ["email", "name"],
        edges: [flowEdgeId("side-effect", fnId("h"), HTTP, undefined, "static", fid("user"))],
      },
    ])
  })

  it("does not report a one-key field", () => {
    expect(sendWhole({ email: "" })).toEqual([])
  })

  it("reports a three-key field too", () => {
    expect(sendWhole(THREE)[0]?.keys).toEqual(["email", "name", "role"])
  })

  it("collects every whole-value send to the same boundary, ordered by id", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user"), fnInput("a"), fnInput("b"), httpInput],
      edges: [
        edgeInput("side-effect", fnId("b"), HTTP, undefined),
        edgeInput("side-effect", fnId("a"), HTTP, []),
      ],
      unknowns: [],
    })
    const unsorted = { ...flow, edges: [...flow.edges].reverse() }
    const [record] = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow: unsorted,
    }).wholeFieldToClient
    expect(record?.edges).toEqual([
      flowEdgeId("side-effect", fnId("a"), HTTP, [], "static", fid("user")),
      flowEdgeId("side-effect", fnId("b"), HTTP, undefined, "static", fid("user")),
    ])
  })

  it("ignores sends of only part of the value", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user"), fnInput("h"), httpInput],
      edges: [edgeInput("side-effect", fnId("h"), HTTP, ["email"])],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.wholeFieldToClient).toEqual([])
  })

  it.each(["returns", "passes", "reads", "crosses-boundary", "transforms"] as const)(
    "ignores a whole-value %s to the client response",
    (kind) => {
      const flow = buildFlowModel({
        nodes: [fieldInput("user"), fnInput("h"), httpInput],
        edges: [edgeInput(kind, fnId("h"), HTTP, undefined)],
        unknowns: [],
      })
      const report = analyzeLeastData({
        capability: inventoryOf([fieldNodeOf("user", TWO)]),
        flow,
      })
      expect(report.wholeFieldToClient).toEqual([])
    },
  )

  it("ignores a whole-value side effect on a boundary of another kind", () => {
    const db = flowNodeId("boundary", "boundary:code", "pg")
    const flow = buildFlowModel({
      nodes: [
        fieldInput("user"),
        fnInput("h"),
        {
          kind: "boundary",
          scope: "boundary:code",
          name: "pg",
          status: "static",
          boundaryKind: "database",
        },
      ],
      edges: [edgeInput("side-effect", fnId("h"), db, undefined)],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.wholeFieldToClient).toEqual([])
  })

  it("ignores a whole-value side effect on a non-boundary node that merely carries the client kind", () => {
    const flow = buildFlowModel({
      nodes: [
        fieldInput("user"),
        fnInput("h"),
        {
          kind: "function",
          scope: "app.ts",
          name: "sink",
          status: "static",
          boundaryKind: "client-response",
        },
      ],
      edges: [edgeInput("side-effect", fnId("h"), fnId("sink"), undefined)],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.wholeFieldToClient).toEqual([])
  })

  it("tolerates a whole-value side effect whose target is not in the model", () => {
    const flow = withRawEdges(
      buildFlowModel({ nodes: [fieldInput("user")], edges: [], unknowns: [] }),
      edgeInput("side-effect", fid("user"), "ghost", undefined),
    )
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.wholeFieldToClient).toEqual([])
  })

  it("ignores sends that carry another field's data", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user"), fieldInput("other"), fnInput("h"), httpInput],
      edges: [edgeInput("side-effect", fnId("h"), HTTP, undefined, { origin: fid("other") })],
      unknowns: [],
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", TWO)]),
      flow,
    })
    expect(report.wholeFieldToClient).toEqual([])
  })
})

describe("analyzeLeastData: fetchedFrom", () => {
  it("lists the input endpoints of the operations that write this field, sorted and de-duplicated", () => {
    const flow = buildFlowModel({
      nodes: [fieldInput("user")],
      edges: [],
      unknowns: [],
    })
    const input = (name: string) => ({
      name,
      direction: "input" as const,
      kind: "database" as const,
    })
    const output = (name: string) => ({
      name,
      direction: "output" as const,
      kind: "database" as const,
    })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", { email: "" })], {
        getters: [
          operation("getter", "g1", [input("zeta"), output("out")], [["user"]]),
          operation("getter", "g2", [input("alpha")], [["other"]]),
          operation("getter", "g3", [input("both")], [["other"], ["user"]]),
        ],
        mutators: [operation("mutator", "m1", [input("mid"), input("zeta")], [["user"]])],
        subscriptions: [operation("subscription", "s1", [input("beta")], [["user"]])],
      }),
      flow,
    })
    expect(report.unusedPaths).toHaveLength(1)
    expect(report.unusedPaths[0]?.fetchedFrom).toEqual(["beta", "both", "mid", "zeta"])
  })

  it("is empty when no operation writes the field", () => {
    const flow = buildFlowModel({ nodes: [fieldInput("user")], edges: [], unknowns: [] })
    const report = analyzeLeastData({
      capability: inventoryOf([fieldNodeOf("user", { email: "" })], {
        getters: [
          operation(
            "getter",
            "g",
            [{ name: "x", direction: "input", kind: "database" }],
            [["other"]],
          ),
        ],
      }),
      flow,
    })
    expect(report.unusedPaths[0]?.fetchedFrom).toEqual([])
  })
})

describe("leastDataFindings: exact findings", () => {
  const report: LeastDataReport = {
    unusedPaths: [
      {
        capability: CAP,
        field: "user",
        fieldNode: "field:f#userData.user",
        path: ["email"],
        sensitivity: "pii",
        fetchedFrom: ["a", "b"],
      },
      {
        capability: CAP,
        field: "user",
        fieldNode: "field:f#userData.user",
        path: ["deep", "key"],
        sensitivity: undefined,
        fetchedFrom: [],
      },
      {
        capability: CAP,
        field: "user",
        fieldNode: "field:f#userData.user",
        path: ["name"],
        sensitivity: undefined,
        fetchedFrom: [],
      },
    ],
    wholeFieldToClient: [
      {
        capability: CAP,
        field: "user",
        fieldNode: "field:f#userData.user",
        boundary: "boundary:b#http",
        boundaryName: "http-response",
        keys: ["email", "name"],
        edges: ["e1", "e2"],
      },
    ],
    indeterminate: [
      {
        capability: CAP,
        field: "user",
        fieldNode: "field:f#userData.user",
        reason: "flow-incomplete",
        paths: [["email"], ["a", "b"]],
      },
      {
        capability: CAP,
        field: "acct",
        fieldNode: "field:f#userData.acct",
        reason: "not-analyzed",
        paths: [["x"]],
      },
    ],
  }

  it("renders every finding verbatim", () => {
    expect(leastDataFindings(report)).toEqual([
      {
        code: "LEAST_DATA_UNUSED_SENSITIVE_PATH",
        family: "flow",
        severity: "warning",
        message:
          'Path "email" of field "user" on "userData" (sensitivity "pii") is never read, forwarded or sent anywhere in the analyzed code. It is declared as fetched from "a", "b"; consider projecting it out of that source.',
        capability: CAP,
        field: ["user", "email"],
        evidence: [{ model: "flow", id: "field:f#userData.user" }],
      },
      {
        code: "LEAST_DATA_UNUSED_PATH",
        family: "flow",
        severity: "info",
        message:
          'Path "deep.key" of field "user" on "userData" is never read, forwarded or sent anywhere in the analyzed code.',
        capability: CAP,
        field: ["user", "deep", "key"],
        evidence: [{ model: "flow", id: "field:f#userData.user" }],
      },
      {
        code: "LEAST_DATA_UNUSED_PATH",
        family: "flow",
        severity: "info",
        message:
          'Path "name" of field "user" on "userData" is never read, forwarded or sent anywhere in the analyzed code.',
        capability: CAP,
        field: ["user", "name"],
        evidence: [{ model: "flow", id: "field:f#userData.user" }],
      },
      {
        code: "LEAST_DATA_WHOLE_FIELD_TO_CLIENT",
        family: "flow",
        severity: "warning",
        message:
          'Field "user" on "userData" is sent whole to the client response "http-response" (keys: email, name) -- send only the keys the client needs.',
        capability: CAP,
        field: ["user"],
        evidence: [
          { model: "flow", id: "field:f#userData.user" },
          { model: "flow", id: "e1" },
          { model: "flow", id: "e2" },
        ],
      },
      {
        code: "LEAST_DATA_ANALYSIS_INDETERMINATE",
        family: "flow",
        severity: "info",
        message:
          'Field "user" on "userData" could not be assessed for unused data at email, a.b: that data reaches code the analysis could not follow.',
        capability: CAP,
        field: ["user"],
        evidence: [{ model: "flow", id: "field:f#userData.user" }],
      },
      {
        code: "LEAST_DATA_ANALYSIS_INDETERMINATE",
        family: "flow",
        severity: "info",
        message:
          'Field "acct" on "userData" could not be assessed for unused data: it was not part of the flow analysis.',
        capability: CAP,
        field: ["acct"],
        evidence: [{ model: "flow", id: "field:f#userData.acct" }],
      },
    ])
  })

  it("is empty for an empty report", () => {
    expect(
      leastDataFindings({ unusedPaths: [], wholeFieldToClient: [], indeterminate: [] }),
    ).toEqual([])
  })
})
