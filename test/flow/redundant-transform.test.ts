import { describe, expect, it } from "vitest"
import { buildFlowModel, flowEdgeId, flowNodeId } from "../../src/flow/flow-model.js"
import type {
  FlowEdgeInput,
  FlowEdgeTagInput,
  FlowModel,
  FlowNodeInput,
  FlowUnknownInput,
} from "../../src/flow/flow-model.js"
import {
  analyzeRedundantTransforms,
  MIN_FORWARDING_HOPS,
  redundantTransformFindings,
} from "../../src/flow/redundant-transform.js"

const CAP = "features/user.ts"
const FILE = "app/p.ts"
const FIELD = flowNodeId("field", CAP, "userData.user")
const OTHER_FIELD = flowNodeId("field", CAP, "userData.team")
const BOUNDARY = flowNodeId("boundary", "boundary", "http")

const fnId = (name: string): string => flowNodeId("function", FILE, name)
const paramId = (fn: string, name = "u"): string => flowNodeId("parameter", FILE, `${fn}.${name}`)
const returnId = (fn: string): string => flowNodeId("return", FILE, `${fn}#return`)

/** The nodes of the project: two fields, a boundary, and a function with a parameter and a return for each name. */
function nodes(...names: string[]): FlowNodeInput[] {
  return [
    { kind: "field", scope: CAP, name: "userData.user", status: "static" },
    { kind: "field", scope: CAP, name: "userData.team", status: "static" },
    {
      kind: "boundary",
      scope: "boundary",
      name: "http",
      status: "static",
      boundaryKind: "client-response",
    },
    ...names.flatMap((name): FlowNodeInput[] => [
      { kind: "function", scope: FILE, name, status: "static" },
      { kind: "parameter", scope: FILE, name: `${name}.u`, status: "static" },
      { kind: "return", scope: FILE, name: `${name}#return`, status: "static" },
    ]),
  ]
}

const at = (line: number, column = 3) => ({ file: FILE, line, column })

function edge(
  kind: FlowEdgeInput["kind"],
  from: string,
  to: string,
  path: readonly string[] = ["email"],
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput {
  return { kind, from, to, path, status: "static", origin: FIELD, source: at(1), ...extra }
}

/** What a function that only hands the data on to `next` does with it, and gets back from it. */
function forwards(
  name: string,
  next: string,
  path: readonly string[] = ["email"],
): FlowEdgeInput[] {
  return [
    edge("reads", paramId(name), fnId(name), path),
    edge("passes", fnId(name), paramId(next), path, { source: at(10) }),
    edge("passes", returnId(next), fnId(name), path),
    edge("returns", fnId(name), returnId(name), path),
  ]
}

/** The function that finally uses the data: it sends it to the client. */
function sends(name: string, path: readonly string[] = ["email"]): FlowEdgeInput[] {
  return [
    edge("reads", paramId(name), fnId(name), path),
    edge("side-effect", fnId(name), BOUNDARY, path),
  ]
}

function model(
  names: string[],
  edges: FlowEdgeInput[],
  options: { tags?: FlowEdgeTagInput[]; unknowns?: FlowUnknownInput[] } = {},
): FlowModel {
  return buildFlowModel({
    nodes: nodes(...names),
    edges,
    unknowns: options.unknowns ?? [],
    ...(options.tags === undefined ? {} : { edgeTags: options.tags }),
  })
}

const idOf = (e: FlowEdgeInput): string =>
  flowEdgeId(e.kind, e.from, e.to, e.path, e.status, e.origin)

describe("forwarding chains", () => {
  const chain = (path: readonly string[] = ["email"]): FlowEdgeInput[] => [
    edge("passes", fnId("entry"), paramId("a"), path),
    ...forwards("a", "b", path),
    ...forwards("b", "c", path),
    ...forwards("c", "d", path),
    ...sends("d", path),
  ]
  const names = ["entry", "a", "b", "c", "d"]

  it(`reports a chain of ${MIN_FORWARDING_HOPS} functions that only hand the data on, once, with the function that uses it`, () => {
    const found = analyzeRedundantTransforms(model(names, chain()))
    expect(found).toEqual([
      {
        kind: "forwarding-hop",
        capability: { file: CAP, exportName: "userData" },
        field: "user",
        fieldNode: FIELD,
        paths: [["email"]],
        source: at(10),
        hops: [fnId("a"), fnId("b"), fnId("c"), fnId("d")],
        edges: [
          idOf(edge("passes", fnId("a"), paramId("b"), ["email"])),
          idOf(edge("passes", fnId("b"), paramId("c"), ["email"])),
          idOf(edge("passes", fnId("c"), paramId("d"), ["email"])),
        ].sort(),
      },
    ])
  })

  it("does not report a chain of two", () => {
    const edges = [
      edge("passes", fnId("entry"), paramId("a")),
      ...forwards("a", "b"),
      ...forwards("b", "d"),
      ...sends("d"),
    ]
    expect(analyzeRedundantTransforms(model(names, edges))).toEqual([])
  })

  it("does not count a function that also sends the path anywhere", () => {
    const edges = [...chain(), edge("side-effect", fnId("b"), BOUNDARY)]
    expect(analyzeRedundantTransforms(model(names, edges))).toEqual([])
  })

  it("does not count a function that drops, transforms or returns something else", () => {
    for (const extra of [
      edge("discards", fnId("b"), FIELD),
      edge("transforms", fnId("b"), returnId("b")),
    ]) {
      const found = analyzeRedundantTransforms(model(names, [...chain(), extra]))
      expect(found.filter((item) => item.kind === "forwarding-hop")).toEqual([])
    }
  })

  it("does not count a function that hands the path to a second callee", () => {
    const edges = [...chain(), edge("passes", fnId("b"), paramId("d"))]
    expect(analyzeRedundantTransforms(model(names, edges))).toEqual([])
    const second = [...chain(), edge("passes", fnId("b"), paramId("entry"))]
    expect(analyzeRedundantTransforms(model(names, second))).toEqual([])
  })

  it("does not count a function that returns its own copy instead of what the callee returned", () => {
    const edges = chain().filter(
      (item) => !(item.kind === "passes" && item.from === returnId("c") && item.to === fnId("b")),
    )
    expect(analyzeRedundantTransforms(model(names, edges))).toEqual([])
  })

  it("does not count a function that is not sure what it does (an edge that is not static)", () => {
    const edges = chain().map((item) =>
      item.kind === "passes" && item.from === fnId("b")
        ? { ...item, status: "inferred" as const }
        : item,
    )
    expect(analyzeRedundantTransforms(model(names, edges))).toEqual([])
  })

  it("counts a function whose callee changed what came back: the wrapper still only hands it on", () => {
    const edges = chain().map((item) =>
      item.kind === "returns" || (item.kind === "passes" && item.from.startsWith("return:"))
        ? { ...item, status: "inferred" as const }
        : item,
    )
    expect(edges.filter((item) => item.status === "inferred")).toHaveLength(6)
    const found = analyzeRedundantTransforms(model(names, edges))
    expect(found.map((item) => item.hops)).toEqual([["a", "b", "c", "d"].map(fnId)])
  })

  it("does not count a function with an edge that is unknown", () => {
    const edges = chain().map((item) =>
      item.kind === "returns" && item.from === fnId("b")
        ? { ...item, status: "unknown" as const }
        : item,
    )
    expect(analyzeRedundantTransforms(model(names, edges))).toEqual([])
  })

  it("does not count a function that receives nothing through a parameter", () => {
    const edges = chain().filter(
      (item) => !(item.kind === "reads" && item.from === paramId("b") && item.to === fnId("b")),
    )
    expect(analyzeRedundantTransforms(model(names, edges))).toEqual([])
  })

  it("does not report a chain through an unknown that concerns the data in one of its functions", () => {
    const unknown = (data?: FlowUnknownInput["data"]): FlowUnknownInput => ({
      reason: "unresolved-call",
      source: at(11),
      subject: fnId("b"),
      ...(data === undefined ? {} : { data }),
    })
    expect(
      analyzeRedundantTransforms(
        model(names, chain(), { unknowns: [unknown([{ origin: FIELD, path: ["email"] }])] }),
      ),
    ).toEqual([])
    expect(analyzeRedundantTransforms(model(names, chain(), { unknowns: [unknown()] }))).toEqual([])
    expect(
      analyzeRedundantTransforms(
        model(names, chain(), { unknowns: [unknown([{ origin: FIELD, path: ["name"] }])] }),
      ),
    ).toHaveLength(1)
    expect(
      analyzeRedundantTransforms(
        model(names, chain(), { unknowns: [unknown([{ origin: OTHER_FIELD, path: ["email"] }])] }),
      ),
    ).toHaveLength(1)
    expect(
      analyzeRedundantTransforms(
        model(names, chain(), { unknowns: [{ ...unknown(), subject: fnId("entry") }] }),
      ),
    ).toHaveLength(1)
  })

  it("merges the paths that go through the same chain into one report", () => {
    const edges = [...chain(["email"]), ...chain(["name"])]
    const found = analyzeRedundantTransforms(model(names, edges))
    expect(found).toHaveLength(1)
    expect(found[0]?.paths).toEqual([["email"], ["name"]])
  })

  it("rests a merged report on the pass edges of every path that goes through the chain", () => {
    const edges = [...chain(["email"]), ...chain(["name"])]
    const [found] = analyzeRedundantTransforms(model(names, edges))
    expect(found?.edges).toEqual(
      [
        ...["email", "name"].flatMap((path) => [
          idOf(edge("passes", fnId("a"), paramId("b"), [path])),
          idOf(edge("passes", fnId("b"), paramId("c"), [path])),
          idOf(edge("passes", fnId("c"), paramId("d"), [path])),
        ]),
      ].sort(),
    )
  })

  it("reports the whole field handed on as the whole path", () => {
    const found = analyzeRedundantTransforms(model(names, chain([])))
    expect(found.map((item) => item.paths)).toEqual([[[]]])
  })

  it("reports a chain of one field apart from the same chain of another", () => {
    const other = chain(["email"]).map((item) => ({ ...item, origin: OTHER_FIELD }))
    const found = analyzeRedundantTransforms(model(names, [...chain(["email"]), ...other]))
    expect(found.map((item) => item.fieldNode).sort()).toEqual([OTHER_FIELD, FIELD].sort())
    expect(found.map((item) => item.field).sort()).toEqual(["team", "user"])
  })

  it("reports a longer chain once, from its first function", () => {
    const edges = [
      edge("passes", fnId("entry"), paramId("a")),
      ...forwards("a", "b"),
      ...forwards("b", "c"),
      ...forwards("c", "d"),
      ...forwards("d", "e"),
      ...sends("e"),
    ]
    const found = analyzeRedundantTransforms(model([...names, "e"], edges))
    expect(found).toHaveLength(1)
    expect(found[0]?.hops).toEqual(["a", "b", "c", "d", "e"].map(fnId))
  })

  it("stops at a cycle instead of walking it forever", () => {
    const edges = [
      edge("passes", fnId("entry"), paramId("a")),
      ...forwards("a", "b"),
      ...forwards("b", "c"),
      ...forwards("c", "a"),
    ]
    expect(analyzeRedundantTransforms(model(names, edges))).toEqual([])
    const headed = [edge("passes", fnId("entry"), paramId("x")), ...forwards("x", "a"), ...edges]
    const found = analyzeRedundantTransforms(model([...names, "x"], headed))
    expect(found.map((item) => item.hops)).toEqual([["x", "a", "b", "c", "a"].map(fnId)])
  })

  it("leaves out an edge with no source, and a model with no parameters", () => {
    const edges = chain().map((item) =>
      item.kind === "passes" && item.from === fnId("a") && item.to === paramId("b")
        ? { ...item, source: undefined as never }
        : item,
    )
    const stripped = edges.map(({ source, ...rest }) =>
      source === undefined ? rest : { ...rest, source },
    )
    expect(analyzeRedundantTransforms(model(names, stripped))[0]?.source).toBeUndefined()
    expect(analyzeRedundantTransforms(model([], []))).toEqual([])
  })

  it("does not take a parameter or a return of a function that is not in the model for an owner", () => {
    const bare = buildFlowModel({
      nodes: [
        ...nodes("a", "b", "c").filter((node) => !(node.kind === "function" && node.name === "b")),
      ],
      edges: [],
      unknowns: [],
    })
    expect(analyzeRedundantTransforms(bare)).toEqual([])
  })
})

describe("tagged transformations", () => {
  const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
  const readName = edge("reads", FIELD, fnId("f"), ["name"], { source: at(3) })
  const tag = (
    via: FlowEdgeTagInput["via"],
    extra: Partial<FlowEdgeTagInput> = {},
    on: FlowEdgeInput = read,
    line = 5,
  ): FlowEdgeTagInput => ({ via, edge: idOf(on), source: at(line, 9), ...extra })
  const run = (tags: FlowEdgeTagInput[], unknowns: FlowUnknownInput[] = []) =>
    analyzeRedundantTransforms(model(["f", "g"], [read, readName], { tags, unknowns }))

  it("a serialize round trip is a round trip", () => {
    expect(run([tag("serialize-roundtrip")])).toEqual([
      {
        kind: "round-trip",
        capability: { file: CAP, exportName: "userData" },
        field: "user",
        fieldNode: FIELD,
        paths: [["email"]],
        source: at(5, 9),
        hops: [],
        edges: [idOf(read)],
        via: "serialized",
      },
    ])
  })

  it("a copy of a fresh copy is a round trip; a copy of anything else is not", () => {
    expect(run([tag("copy", { fresh: true })]).map((item) => [item.kind, item.via])).toEqual([
      ["round-trip", "copied"],
    ])
    expect(run([tag("copy")])).toEqual([])
  })

  it("an unused derivation is dead; a derivation nobody said was unused is not", () => {
    const [dead] = run([tag("derive", { unused: true })])
    expect(dead).toEqual({
      kind: "dead-derivation",
      capability: { file: CAP, exportName: "userData" },
      field: "user",
      fieldNode: FIELD,
      paths: [["email"]],
      source: at(5, 9),
      hops: [],
      edges: [idOf(read)],
    })
    expect(run([tag("derive")])).toEqual([])
  })

  it("a forward tag, and a flag on the wrong kind of tag, mean nothing", () => {
    expect(
      run([tag("forward"), tag("forward", { fresh: true }), tag("derive", { fresh: true })]),
    ).toEqual([])
    expect(run([tag("serialize-roundtrip", { unused: true })]).map((item) => item.kind)).toEqual([
      "round-trip",
    ])
  })

  it("groups the paths read at one place into one report, and keeps places apart", () => {
    const found = run([
      tag("serialize-roundtrip"),
      tag("serialize-roundtrip", {}, readName),
      tag("serialize-roundtrip", {}, read, 8),
    ])
    expect(found.map((item) => [item.source?.line, item.paths])).toEqual([
      [5, [["email"], ["name"]]],
      [8, [["email"]]],
    ])
    expect(found[0]?.edges).toEqual([idOf(read), idOf(readName)].sort())
  })

  it("keeps a round trip and a derivation at the same place apart", () => {
    const found = run([tag("serialize-roundtrip"), tag("derive", { unused: true })])
    expect(found.map((item) => item.kind)).toEqual(["dead-derivation", "round-trip"])
  })

  it("is never reported for data an unknown of the same function concerns", () => {
    const unknown = (data?: FlowUnknownInput["data"], subject = fnId("f")): FlowUnknownInput => ({
      reason: "unresolved-call",
      source: at(7),
      subject,
      ...(data === undefined ? {} : { data }),
    })
    expect(run([tag("serialize-roundtrip")], [unknown([{ origin: FIELD, path: [] }])])).toEqual([])
    expect(run([tag("serialize-roundtrip")], [unknown()])).toEqual([])
    expect(
      run([tag("serialize-roundtrip")], [unknown([{ origin: FIELD, path: ["name"] }])]),
    ).toHaveLength(1)
    expect(
      run([tag("serialize-roundtrip")], [unknown([{ origin: OTHER_FIELD, path: [] }])]),
    ).toHaveLength(1)
    expect(run([tag("serialize-roundtrip")], [unknown(undefined, fnId("g"))])).toHaveLength(1)
  })

  it("skips a tag whose edge is not in the model or carries no field (a model read from a file)", () => {
    const real = model(["f"], [read], { tags: [tag("serialize-roundtrip")] })
    const [only] = real.edgeTags ?? []
    expect(only).toBeDefined()
    expect(
      analyzeRedundantTransforms({
        ...real,
        edgeTags: [{ ...only!, edge: "reads:gone", id: "tag:x" }],
      }),
    ).toEqual([])
    const withoutOrigin: FlowEdgeInput = {
      kind: "reads",
      from: FIELD,
      to: fnId("f"),
      path: ["email"],
      status: "static",
      source: at(3),
    }
    const stripped = buildFlowModel({ nodes: nodes("f"), edges: [withoutOrigin], unknowns: [] })
    const [edgeOnly] = stripped.edges
    expect(
      analyzeRedundantTransforms({
        ...stripped,
        edgeTags: [{ id: "tag:y", via: "serialize-roundtrip", edge: edgeOnly!.id, source: at(1) }],
      }),
    ).toEqual([])
  })

  it("skips a tag on an edge whose origin is not a field node", () => {
    const real = model(["f"], [read], { tags: [tag("serialize-roundtrip")] })
    const [edgeOnly] = real.edges
    const [only] = real.edgeTags ?? []
    expect(
      analyzeRedundantTransforms({
        ...real,
        edges: [{ ...edgeOnly!, origin: fnId("f") }],
        edgeTags: [only!],
      }),
    ).toEqual([])
  })

  it("treats an edge with no path as the whole field", () => {
    const noPath: FlowEdgeInput = {
      kind: "reads",
      from: FIELD,
      to: fnId("f"),
      status: "static",
      origin: FIELD,
      source: at(3),
    }
    const found = analyzeRedundantTransforms(
      buildFlowModel({
        nodes: nodes("f"),
        edges: [noPath],
        unknowns: [],
        edgeTags: [{ via: "derive", unused: true, edge: idOf(noPath), source: at(2) }],
      }),
    )
    expect(found.map((item) => item.paths)).toEqual([[[]]])
  })
})

describe("ordering", () => {
  it("lists the reports by place, then kind, with the forwarding chain among them", () => {
    const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
    const edges = [
      read,
      edge("passes", fnId("entry"), paramId("a")),
      ...forwards("a", "b"),
      ...forwards("b", "c"),
      ...forwards("c", "d"),
      ...sends("d"),
    ]
    const tags: FlowEdgeTagInput[] = [
      { via: "derive", unused: true, edge: idOf(read), source: at(20, 1) },
      { via: "serialize-roundtrip", edge: idOf(read), source: at(2, 4) },
      { via: "serialize-roundtrip", edge: idOf(read), source: at(2, 1) },
      {
        via: "derive",
        unused: true,
        edge: idOf(read),
        source: { file: "app/a.ts", line: 9, column: 1 },
      },
    ]
    const found = analyzeRedundantTransforms(
      model(["entry", "f", "a", "b", "c", "d"], edges, { tags }),
    )
    expect(
      found.map(
        (item) => `${item.source?.file}:${item.source?.line}:${item.source?.column} ${item.kind}`,
      ),
    ).toEqual([
      "app/a.ts:9:1 dead-derivation",
      "app/p.ts:2:1 round-trip",
      "app/p.ts:2:4 round-trip",
      "app/p.ts:10:3 forwarding-hop",
      "app/p.ts:20:1 dead-derivation",
    ])
  })

  it("orders two reports at one place by kind, then field, then chain", () => {
    const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
    const readTeam = edge("reads", OTHER_FIELD, fnId("f"), ["email"], {
      source: at(3),
      origin: OTHER_FIELD,
    })
    const tags: FlowEdgeTagInput[] = [
      { via: "derive", unused: true, edge: idOf(read), source: at(2) },
      { via: "derive", unused: true, edge: idOf(readTeam), source: at(2) },
    ]
    const found = analyzeRedundantTransforms(model(["f"], [read, readTeam], { tags }))
    expect(found.map((item) => item.field)).toEqual(["team", "user"])
  })
})

describe("redundantTransformFindings", () => {
  const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
  const flow = model(
    ["f", "entry", "a", "b", "c", "d"],
    [
      read,
      edge("passes", fnId("entry"), paramId("a")),
      ...forwards("a", "b"),
      ...forwards("b", "c"),
      ...forwards("c", "d"),
      ...sends("d"),
    ],
    {
      tags: [
        { via: "serialize-roundtrip", edge: idOf(read), source: at(2, 4) },
        { via: "copy", fresh: true, edge: idOf(read), source: at(3, 4) },
        { via: "derive", unused: true, edge: idOf(read), source: at(4, 4) },
      ],
    },
  )
  const findings = redundantTransformFindings(analyzeRedundantTransforms(flow), flow)

  it("is one info finding per report, in the flow family, with the code and the place", () => {
    expect(findings.map((finding) => [finding.code, finding.family, finding.severity])).toEqual([
      ["LEAST_DATA_REDUNDANT_TRANSFORM", "flow", "info"],
      ["LEAST_DATA_REDUNDANT_TRANSFORM", "flow", "info"],
      ["LEAST_DATA_REDUNDANT_TRANSFORM", "flow", "info"],
      ["LEAST_DATA_REDUNDANT_TRANSFORM", "flow", "info"],
    ])
    expect(findings.map((finding) => [finding.source, finding.position])).toEqual([
      [FILE, { line: 2, column: 4 }],
      [FILE, { line: 3, column: 4 }],
      [FILE, { line: 4, column: 4 }],
      [FILE, { line: 10, column: 3 }],
    ])
    expect(findings.every((finding) => finding.capability?.exportName === "userData")).toBe(true)
    expect(findings.every((finding) => finding.field?.join(".") === "user")).toBe(true)
  })

  it("says in the message what kind it is and what was done", () => {
    expect(findings.map((finding) => finding.message)).toEqual([
      `Redundant transformation (round-trip): field "user" on "userData" (email) is serialized and deserialized again at ${FILE}:2:4 with nothing changed; the copy has the same shape as the original.`,
      `Redundant transformation (round-trip): field "user" on "userData" (email) is copied again at ${FILE}:3:4 although it is already a fresh copy and nothing is changed.`,
      `Redundant transformation (dead-derivation): a value derived from field "user" on "userData" (email) is computed at ${FILE}:4:4 and never used.`,
      `Redundant transformation (forwarding-hop): field "user" on "userData" (email) passes unchanged through 3 functions that only hand it on (a -> b -> c) before it reaches "d" at ${FILE}:10:3; call the function that uses it directly.`,
    ])
  })

  it("points at the flow records it rests on, the field first", () => {
    expect(findings[0]?.evidence).toEqual([
      { model: "flow", id: FIELD },
      { model: "flow", id: idOf(read) },
    ])
    expect(findings[3]?.evidence?.[0]).toEqual({ model: "flow", id: FIELD })
    expect(findings[3]?.evidence).toHaveLength(4)
  })

  it("names the whole field when the path is empty, and has no position without a source", () => {
    const whole = [
      {
        kind: "round-trip" as const,
        capability: { file: CAP, exportName: "userData" },
        field: "user",
        fieldNode: FIELD,
        paths: [[], ["a", "b"]],
        hops: [],
        edges: [],
        via: "copied" as const,
      },
    ]
    const [finding] = redundantTransformFindings(whole, flow)
    expect(finding?.message).toBe(
      'Redundant transformation (round-trip): field "user" on "userData" ((whole), a.b) is copied again although it is already a fresh copy and nothing is changed.',
    )
    expect(finding?.source).toBeUndefined()
    expect(finding?.position).toBeUndefined()
  })

  it("falls back to the id of a hop that is not a node", () => {
    const [finding] = redundantTransformFindings(
      [
        {
          kind: "forwarding-hop",
          capability: { file: CAP, exportName: "userData" },
          field: "user",
          fieldNode: FIELD,
          paths: [["email"]],
          hops: ["function:x#a", "function:x#b", "function:x#c", "function:x#d"],
          edges: [],
        },
      ],
      flow,
    )
    expect(finding?.message).toContain("(function:x#a -> function:x#b -> function:x#c)")
    expect(finding?.message).toContain('reaches "function:x#d"')
  })
})

describe("the exact reports", () => {
  const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
  const readName = edge("reads", FIELD, fnId("f"), ["name"], { source: at(3) })
  const readTeam = edge("reads", OTHER_FIELD, fnId("f"), [], { source: at(3), origin: OTHER_FIELD })
  const ofTeam = (edges: FlowEdgeInput[], withSource: boolean): FlowEdgeInput[] =>
    edges.map(({ source, ...rest }) => ({
      ...rest,
      origin: OTHER_FIELD,
      ...(withSource && source !== undefined ? { source } : {}),
    }))
  const names = ["f", "entry", "a", "b", "c", "d", "entry2", "p", "q", "r", "s"]
  const flow = model(
    names,
    [
      read,
      readName,
      readTeam,
      edge("passes", fnId("entry"), paramId("a")),
      edge("passes", fnId("entry"), paramId("a"), ["name"]),
      ...forwards("a", "b"),
      ...forwards("b", "c"),
      ...forwards("c", "d"),
      ...sends("d"),
      ...forwards("a", "b", ["name"]),
      ...forwards("b", "c", ["name"]),
      ...forwards("c", "d", ["name"]),
      ...sends("d", ["name"]),
      ...ofTeam(
        [
          edge("passes", fnId("entry2"), paramId("p"), []),
          ...forwards("p", "q", []),
          ...forwards("q", "r", []),
          ...forwards("r", "s", []),
          ...sends("s", []),
        ],
        false,
      ),
    ],
    {
      tags: [
        { via: "serialize-roundtrip", edge: idOf(read), source: at(2, 4) },
        { via: "serialize-roundtrip", edge: idOf(readName), source: at(2, 4) },
        { via: "copy", fresh: true, edge: idOf(read), source: at(3, 4) },
        { via: "derive", unused: true, edge: idOf(read), source: at(4, 4) },
        { via: "derive", unused: true, edge: idOf(readTeam), source: at(4, 4) },
      ],
    },
  )

  it("reports every kind exactly, in order", () => {
    expect(analyzeRedundantTransforms(flow)).toMatchInlineSnapshot(`
      [
        {
          "capability": {
            "exportName": "userData",
            "file": "features/user.ts",
          },
          "edges": [
            "passes:function:app/p.ts#p->parameter:app/p.ts#q.u:@static^field:features/user.ts#userData.team",
            "passes:function:app/p.ts#q->parameter:app/p.ts#r.u:@static^field:features/user.ts#userData.team",
            "passes:function:app/p.ts#r->parameter:app/p.ts#s.u:@static^field:features/user.ts#userData.team",
          ],
          "field": "team",
          "fieldNode": "field:features/user.ts#userData.team",
          "hops": [
            "function:app/p.ts#p",
            "function:app/p.ts#q",
            "function:app/p.ts#r",
            "function:app/p.ts#s",
          ],
          "kind": "forwarding-hop",
          "paths": [
            [],
          ],
        },
        {
          "capability": {
            "exportName": "userData",
            "file": "features/user.ts",
          },
          "edges": [
            "reads:field:features/user.ts#userData.user->function:app/p.ts#f:email@static^field:features/user.ts#userData.user",
            "reads:field:features/user.ts#userData.user->function:app/p.ts#f:name@static^field:features/user.ts#userData.user",
          ],
          "field": "user",
          "fieldNode": "field:features/user.ts#userData.user",
          "hops": [],
          "kind": "round-trip",
          "paths": [
            [
              "email",
            ],
            [
              "name",
            ],
          ],
          "source": {
            "column": 4,
            "file": "app/p.ts",
            "line": 2,
          },
          "via": "serialized",
        },
        {
          "capability": {
            "exportName": "userData",
            "file": "features/user.ts",
          },
          "edges": [
            "reads:field:features/user.ts#userData.user->function:app/p.ts#f:email@static^field:features/user.ts#userData.user",
          ],
          "field": "user",
          "fieldNode": "field:features/user.ts#userData.user",
          "hops": [],
          "kind": "round-trip",
          "paths": [
            [
              "email",
            ],
          ],
          "source": {
            "column": 4,
            "file": "app/p.ts",
            "line": 3,
          },
          "via": "copied",
        },
        {
          "capability": {
            "exportName": "userData",
            "file": "features/user.ts",
          },
          "edges": [
            "reads:field:features/user.ts#userData.team->function:app/p.ts#f:@static^field:features/user.ts#userData.team",
          ],
          "field": "team",
          "fieldNode": "field:features/user.ts#userData.team",
          "hops": [],
          "kind": "dead-derivation",
          "paths": [
            [],
          ],
          "source": {
            "column": 4,
            "file": "app/p.ts",
            "line": 4,
          },
        },
        {
          "capability": {
            "exportName": "userData",
            "file": "features/user.ts",
          },
          "edges": [
            "reads:field:features/user.ts#userData.user->function:app/p.ts#f:email@static^field:features/user.ts#userData.user",
          ],
          "field": "user",
          "fieldNode": "field:features/user.ts#userData.user",
          "hops": [],
          "kind": "dead-derivation",
          "paths": [
            [
              "email",
            ],
          ],
          "source": {
            "column": 4,
            "file": "app/p.ts",
            "line": 4,
          },
        },
        {
          "capability": {
            "exportName": "userData",
            "file": "features/user.ts",
          },
          "edges": [
            "passes:function:app/p.ts#a->parameter:app/p.ts#b.u:email@static^field:features/user.ts#userData.user",
            "passes:function:app/p.ts#a->parameter:app/p.ts#b.u:name@static^field:features/user.ts#userData.user",
            "passes:function:app/p.ts#b->parameter:app/p.ts#c.u:email@static^field:features/user.ts#userData.user",
            "passes:function:app/p.ts#b->parameter:app/p.ts#c.u:name@static^field:features/user.ts#userData.user",
            "passes:function:app/p.ts#c->parameter:app/p.ts#d.u:email@static^field:features/user.ts#userData.user",
            "passes:function:app/p.ts#c->parameter:app/p.ts#d.u:name@static^field:features/user.ts#userData.user",
          ],
          "field": "user",
          "fieldNode": "field:features/user.ts#userData.user",
          "hops": [
            "function:app/p.ts#a",
            "function:app/p.ts#b",
            "function:app/p.ts#c",
            "function:app/p.ts#d",
          ],
          "kind": "forwarding-hop",
          "paths": [
            [
              "email",
            ],
            [
              "name",
            ],
          ],
          "source": {
            "column": 3,
            "file": "app/p.ts",
            "line": 10,
          },
        },
      ]
    `)
  })

  it("words and anchors every finding exactly", () => {
    expect(redundantTransformFindings(analyzeRedundantTransforms(flow), flow))
      .toMatchInlineSnapshot(`
        [
          {
            "capability": {
              "exportName": "userData",
              "file": "features/user.ts",
            },
            "code": "LEAST_DATA_REDUNDANT_TRANSFORM",
            "evidence": [
              {
                "id": "field:features/user.ts#userData.team",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#p->parameter:app/p.ts#q.u:@static^field:features/user.ts#userData.team",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#q->parameter:app/p.ts#r.u:@static^field:features/user.ts#userData.team",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#r->parameter:app/p.ts#s.u:@static^field:features/user.ts#userData.team",
                "model": "flow",
              },
            ],
            "family": "flow",
            "field": [
              "team",
            ],
            "message": "Redundant transformation (forwarding-hop): field "team" on "userData" ((whole)) passes unchanged through 3 functions that only hand it on (p -> q -> r) before it reaches "s"; call the function that uses it directly.",
            "severity": "info",
          },
          {
            "capability": {
              "exportName": "userData",
              "file": "features/user.ts",
            },
            "code": "LEAST_DATA_REDUNDANT_TRANSFORM",
            "evidence": [
              {
                "id": "field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "reads:field:features/user.ts#userData.user->function:app/p.ts#f:email@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "reads:field:features/user.ts#userData.user->function:app/p.ts#f:name@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
            ],
            "family": "flow",
            "field": [
              "user",
            ],
            "message": "Redundant transformation (round-trip): field "user" on "userData" (email, name) is serialized and deserialized again at app/p.ts:2:4 with nothing changed; the copy has the same shape as the original.",
            "position": {
              "column": 4,
              "line": 2,
            },
            "severity": "info",
            "source": "app/p.ts",
          },
          {
            "capability": {
              "exportName": "userData",
              "file": "features/user.ts",
            },
            "code": "LEAST_DATA_REDUNDANT_TRANSFORM",
            "evidence": [
              {
                "id": "field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "reads:field:features/user.ts#userData.user->function:app/p.ts#f:email@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
            ],
            "family": "flow",
            "field": [
              "user",
            ],
            "message": "Redundant transformation (round-trip): field "user" on "userData" (email) is copied again at app/p.ts:3:4 although it is already a fresh copy and nothing is changed.",
            "position": {
              "column": 4,
              "line": 3,
            },
            "severity": "info",
            "source": "app/p.ts",
          },
          {
            "capability": {
              "exportName": "userData",
              "file": "features/user.ts",
            },
            "code": "LEAST_DATA_REDUNDANT_TRANSFORM",
            "evidence": [
              {
                "id": "field:features/user.ts#userData.team",
                "model": "flow",
              },
              {
                "id": "reads:field:features/user.ts#userData.team->function:app/p.ts#f:@static^field:features/user.ts#userData.team",
                "model": "flow",
              },
            ],
            "family": "flow",
            "field": [
              "team",
            ],
            "message": "Redundant transformation (dead-derivation): a value derived from field "team" on "userData" ((whole)) is computed at app/p.ts:4:4 and never used.",
            "position": {
              "column": 4,
              "line": 4,
            },
            "severity": "info",
            "source": "app/p.ts",
          },
          {
            "capability": {
              "exportName": "userData",
              "file": "features/user.ts",
            },
            "code": "LEAST_DATA_REDUNDANT_TRANSFORM",
            "evidence": [
              {
                "id": "field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "reads:field:features/user.ts#userData.user->function:app/p.ts#f:email@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
            ],
            "family": "flow",
            "field": [
              "user",
            ],
            "message": "Redundant transformation (dead-derivation): a value derived from field "user" on "userData" (email) is computed at app/p.ts:4:4 and never used.",
            "position": {
              "column": 4,
              "line": 4,
            },
            "severity": "info",
            "source": "app/p.ts",
          },
          {
            "capability": {
              "exportName": "userData",
              "file": "features/user.ts",
            },
            "code": "LEAST_DATA_REDUNDANT_TRANSFORM",
            "evidence": [
              {
                "id": "field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#a->parameter:app/p.ts#b.u:email@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#a->parameter:app/p.ts#b.u:name@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#b->parameter:app/p.ts#c.u:email@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#b->parameter:app/p.ts#c.u:name@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#c->parameter:app/p.ts#d.u:email@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
              {
                "id": "passes:function:app/p.ts#c->parameter:app/p.ts#d.u:name@static^field:features/user.ts#userData.user",
                "model": "flow",
              },
            ],
            "family": "flow",
            "field": [
              "user",
            ],
            "message": "Redundant transformation (forwarding-hop): field "user" on "userData" (email, name) passes unchanged through 3 functions that only hand it on (a -> b -> c) before it reaches "d" at app/p.ts:10:3; call the function that uses it directly.",
            "position": {
              "column": 3,
              "line": 10,
            },
            "severity": "info",
            "source": "app/p.ts",
          },
        ]
      `)
  })
})

describe("a model as it might be read from a file", () => {
  const entryEdges = (path: readonly string[] = ["email"]): FlowEdgeInput[] => [
    edge("passes", fnId("entry"), paramId("a"), path),
    ...forwards("a", "b", path),
    ...forwards("b", "c", path),
    ...forwards("c", "d", path),
    ...sends("d", path),
  ]
  const names = ["entry", "a", "b", "c", "d"]
  const real = model(names, entryEdges())
  const without = (...ids: string[]): FlowModel => ({
    ...real,
    nodes: real.nodes.filter((node) => !ids.includes(node.id)),
  })
  const withEdges = (edges: FlowEdgeInput[]): FlowModel => model(names, edges)
  const bare = (input: FlowEdgeInput): FlowEdgeInput =>
    Object.fromEntries(Object.entries(input).filter(([key]) => key !== "path")) as FlowEdgeInput

  it("reports the intact chain", () => {
    expect(analyzeRedundantTransforms(real).map((item) => item.hops)).toEqual([
      ["a", "b", "c", "d"].map(fnId),
    ])
  })

  it.each([
    ["a function node", [fnId("b")]],
    ["a parameter the data is received through", [paramId("c")]],
    ["the parameter the data is handed to", [paramId("d")]],
    ["the return the callee answers with", [returnId("c")]],
  ])("reports nothing when %s is not in the model", (_label, ids) => {
    expect(analyzeRedundantTransforms(without(...ids))).toEqual([])
  })

  it("does not count a function that reads the data from anything but a parameter", () => {
    const edges = entryEdges().map((e) =>
      e.kind === "reads" && e.to === fnId("b") ? { ...e, from: FIELD } : e,
    )
    expect(analyzeRedundantTransforms(withEdges(edges))).toEqual([])
  })

  it("does not count a function that is answered by a function it did not call", () => {
    const edges = entryEdges().map((e) =>
      e.kind === "passes" && e.to === fnId("b") && e.from === returnId("c")
        ? { ...e, from: returnId("a") }
        : e,
    )
    expect(analyzeRedundantTransforms(withEdges(edges))).toEqual([])
  })

  it("does not count a function that is answered by something that is not a return", () => {
    const edges = entryEdges().map((e) =>
      e.kind === "passes" && e.to === fnId("b") && e.from === returnId("c")
        ? { ...e, from: paramId("c") }
        : e,
    )
    expect(analyzeRedundantTransforms(withEdges(edges))).toEqual([])
  })

  it("does not count a function that returns something and was not answered", () => {
    const edges = entryEdges().filter(
      (e) => !(e.kind === "passes" && e.from === returnId("c") && e.to === fnId("b")),
    )
    expect(analyzeRedundantTransforms(withEdges(edges))).toEqual([])
  })

  it("walks data with no path and data with an empty path as the same data", () => {
    const edges = entryEdges([]).map((e, index) => (index < 2 ? bare(e) : e))
    const found = analyzeRedundantTransforms(withEdges(edges))
    expect(found.map((item) => item.paths)).toEqual([[[]]])
  })

  it("names a field of several segments by all of them", () => {
    const deep = flowNodeId("field", CAP, "userData.user.profile.email")
    const read = edge("reads", deep, fnId("f"), [], { origin: deep, source: at(3) })
    const flow = buildFlowModel({
      nodes: [
        ...nodes("f"),
        { kind: "field", scope: CAP, name: "userData.user.profile.email", status: "static" },
      ],
      edges: [read],
      unknowns: [],
      edgeTags: [{ via: "derive", unused: true, edge: idOf(read), source: at(2) }],
    })
    expect(analyzeRedundantTransforms(flow).map((item) => item.field)).toEqual([
      "user.profile.email",
    ])
  })

  it("reports nothing for a tag on a field that is not in the model", () => {
    const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
    const flow = model(["f"], [read], {
      tags: [{ via: "derive", unused: true, edge: idOf(read), source: at(2) }],
    })
    expect(
      analyzeRedundantTransforms({ ...flow, nodes: flow.nodes.filter((n) => n.id !== FIELD) }),
    ).toEqual([])
  })

  it("does not make anything of a tag whose flag belongs to another kind", () => {
    const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
    const run = (extra: FlowEdgeTagInput) =>
      analyzeRedundantTransforms(model(["f"], [read], { tags: [extra] }))
    expect(run({ via: "forward", unused: true, edge: idOf(read), source: at(2) })).toEqual([])
    expect(run({ via: "forward", fresh: true, edge: idOf(read), source: at(2) })).toEqual([])
    expect(run({ via: "copy", unused: true, edge: idOf(read), source: at(2) })).toEqual([])
    expect(run({ via: "derive", fresh: true, edge: idOf(read), source: at(2) })).toEqual([])
  })

  it("says a round trip was serialized or copied, and a dead derivation neither", () => {
    const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
    const run = (extra: FlowEdgeTagInput) =>
      analyzeRedundantTransforms(model(["f"], [read], { tags: [extra] })).map((item) => item.via)
    expect(run({ via: "serialize-roundtrip", edge: idOf(read), source: at(2) })).toEqual([
      "serialized",
    ])
    expect(run({ via: "copy", fresh: true, edge: idOf(read), source: at(2) })).toEqual(["copied"])
    expect(run({ via: "derive", unused: true, edge: idOf(read), source: at(2) })).toEqual([
      undefined,
    ])
  })

  it("lists the paths and the edges of a report in order, whatever order the tags come in", () => {
    const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
    const readName = edge("reads", FIELD, fnId("f"), ["name"], { source: at(3) })
    const flow = model(["f"], [read, readName], {
      tags: [
        { via: "serialize-roundtrip", edge: idOf(read), source: at(2) },
        { via: "serialize-roundtrip", edge: idOf(readName), source: at(2) },
      ],
    })
    const [first, second] = flow.edgeTags ?? []
    const [found] = analyzeRedundantTransforms({ ...flow, edgeTags: [second!, first!] })
    expect(found?.paths).toEqual([["email"], ["name"]])
    expect(found?.edges).toEqual([idOf(read), idOf(readName)].sort())
  })

  it("is blocked by an unknown about a path when the tagged edge has no path at all", () => {
    const whole: FlowEdgeInput = {
      kind: "reads",
      from: FIELD,
      to: fnId("f"),
      status: "static",
      origin: FIELD,
      source: at(3),
    }
    const tags = [{ via: "derive", unused: true, edge: idOf(whole), source: at(2) }] as const
    const unknowns: FlowUnknownInput[] = [
      {
        reason: "unresolved-call",
        source: at(1),
        subject: fnId("f"),
        data: [{ origin: FIELD, path: ["email"] }],
      },
    ]
    const flow = model(["f"], [whole], { tags: [...tags], unknowns })
    expect(analyzeRedundantTransforms(flow)).toEqual([])
  })

  it("reports data with no path as the whole field, however many edges carry it", () => {
    const edges = entryEdges().map(bare)
    expect(analyzeRedundantTransforms(withEdges(edges)).map((item) => item.paths)).toEqual([[[]]])
  })

  it("leaves a call that carries the field out of what a function does with it", () => {
    const edges = [...entryEdges(), edge("calls", fnId("b"), fnId("c"), ["email"])]
    expect(analyzeRedundantTransforms(withEdges(edges)).map((item) => item.hops)).toEqual([
      ["a", "b", "c", "d"].map(fnId),
    ])
  })

  it("does not count a function that is handed the data some way other than a read from a parameter", () => {
    const edges = entryEdges().map((e) =>
      e.kind === "reads" && e.to === fnId("b") ? { ...e, kind: "passes" as const } : e,
    )
    expect(analyzeRedundantTransforms(withEdges(edges))).toEqual([])
  })

  it("does not count a function that also reads the data out to something", () => {
    const edges = [...entryEdges(), edge("reads", fnId("b"), paramId("a"), ["email"])]
    expect(analyzeRedundantTransforms(withEdges(edges))).toEqual([])
  })

  it("does not count a function that has data returned into it", () => {
    const edges = [...entryEdges(), edge("returns", returnId("a"), fnId("b"), ["email"])]
    expect(analyzeRedundantTransforms(withEdges(edges))).toEqual([])
  })

  it("does not count a function whose callee is not in the model, even when its answer has no owner either", () => {
    const longer = [
      edge("passes", fnId("entry"), paramId("a")),
      ...forwards("a", "b"),
      ...forwards("b", "c"),
      ...forwards("c", "d"),
      ...forwards("d", "e"),
      ...sends("e"),
    ]
    const flow = model([...names, "e"], longer)
    expect(analyzeRedundantTransforms(flow)).toHaveLength(1)
    expect(
      analyzeRedundantTransforms({
        ...flow,
        nodes: flow.nodes.filter((node) => node.id !== fnId("d")),
      }),
    ).toEqual([])
  })

  it("does not count a node that is not a function, even with a function's edges", () => {
    const flow: FlowModel = {
      ...real,
      nodes: real.nodes.map((node) =>
        node.id === fnId("b") ? { ...node, kind: "return" as const } : node,
      ),
    }
    expect(analyzeRedundantTransforms(flow)).toEqual([])
  })

  it("does not take a parameter named like a return for the return of a function", () => {
    const fake = flowNodeId("parameter", FILE, "c#return")
    const flow: FlowModel = {
      ...real,
      nodes: real.nodes.map((node) =>
        node.id === returnId("c")
          ? { ...node, id: fake, kind: "parameter" as const, name: "c#return" }
          : node,
      ),
      edges: real.edges.map((e) => (e.from === returnId("c") ? { ...e, from: fake } : e)),
    }
    expect(analyzeRedundantTransforms(flow)).toEqual([])
  })

  it("reports no chain for a field that is not in the model", () => {
    expect(analyzeRedundantTransforms(without(FIELD))).toEqual([])
  })

  describe("unknowns that may concern the data", () => {
    const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
    const run = (data: { origin: string; path: readonly string[] }[] | undefined) =>
      analyzeRedundantTransforms(
        model(["f"], [read], {
          tags: [{ via: "derive", unused: true, edge: idOf(read), source: at(2) }],
          unknowns: [
            {
              reason: "unresolved-call",
              source: at(1),
              subject: fnId("f"),
              ...(data === undefined ? {} : { data }),
            },
          ],
        }),
      )

    it.each([
      ["the whole field", [{ origin: FIELD, path: [] }]],
      ["a path inside the one reported", [{ origin: FIELD, path: ["email", "domain"] }]],
      ["the path itself", [{ origin: FIELD, path: ["email"] }]],
      [
        "the path among others",
        [
          { origin: FIELD, path: ["name"] },
          { origin: FIELD, path: ["email"] },
        ],
      ],
      ["no data at all", undefined],
    ])("blocks the report when it concerns %s", (_label, data) => {
      expect(run(data)).toEqual([])
    })

    it.each([
      ["another path", [{ origin: FIELD, path: ["name"] }]],
      ["another field", [{ origin: OTHER_FIELD, path: ["email"] }]],
      ["another field's whole data", [{ origin: OTHER_FIELD, path: [] }]],
    ])("leaves the report when it concerns only %s", (_label, data) => {
      expect(run(data)).toHaveLength(1)
    })
  })

  describe("the order of reports", () => {
    const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })
    const order = (tags: FlowEdgeTagInput[]) =>
      analyzeRedundantTransforms(model(["f"], [read], { tags })).map(
        (item) => `${item.kind}@${item.source?.file}:${item.source?.line}:${item.source?.column}`,
      )

    it("puts a column before a later one, as a number", () => {
      expect(
        order([
          { via: "serialize-roundtrip", edge: idOf(read), source: at(2, 10) },
          { via: "serialize-roundtrip", edge: idOf(read), source: at(2, 4) },
        ]),
      ).toEqual(["round-trip@app/p.ts:2:4", "round-trip@app/p.ts:2:10"])
    })

    it("puts a line before a later one, as a number", () => {
      expect(
        order([
          { via: "serialize-roundtrip", edge: idOf(read), source: at(10) },
          { via: "serialize-roundtrip", edge: idOf(read), source: at(9) },
        ]),
      ).toEqual(["round-trip@app/p.ts:9:3", "round-trip@app/p.ts:10:3"])
    })

    it("orders by column before kind at one line", () => {
      expect(
        order([
          { via: "derive", unused: true, edge: idOf(read), source: at(2, 4) },
          { via: "serialize-roundtrip", edge: idOf(read), source: at(2, 1) },
        ]),
      ).toEqual(["round-trip@app/p.ts:2:1", "dead-derivation@app/p.ts:2:4"])
    })

    it("orders by line before column", () => {
      expect(
        order([
          { via: "serialize-roundtrip", edge: idOf(read), source: at(3, 1) },
          { via: "serialize-roundtrip", edge: idOf(read), source: at(2, 9) },
        ]),
      ).toEqual(["round-trip@app/p.ts:2:9", "round-trip@app/p.ts:3:1"])
    })

    it("puts a report with no place before every file, even one that sorts early", () => {
      const early = { file: "A.ts", line: 1, column: 1 }
      const edges = [
        read,
        edge("passes", fnId("entry"), paramId("a")),
        ...forwards("a", "b"),
        ...forwards("b", "c"),
        ...forwards("c", "d"),
        ...sends("d"),
      ].map(({ source, ...rest }) =>
        rest.kind === "passes"
          ? (rest as FlowEdgeInput)
          : { ...rest, ...(source === undefined ? {} : { source }) },
      )
      const found = analyzeRedundantTransforms(
        model(["f", "entry", "a", "b", "c", "d"], edges, {
          tags: [{ via: "serialize-roundtrip", edge: idOf(read), source: early }],
        }),
      )
      expect(found.map((item) => [item.kind, item.source?.file])).toEqual([
        ["forwarding-hop", undefined],
        ["round-trip", "A.ts"],
      ])
    })

    it("orders two chains that start at one place by the functions they go through, one hop after the other", () => {
      const chain = (entry: string, ...fns: string[]): FlowEdgeInput[] => {
        const [a, b, c, d] = fns as [string, string, string, string]
        return [
          edge("passes", fnId(entry), paramId(a)),
          ...forwards(a, b),
          ...forwards(b, c),
          ...forwards(c, d),
          ...sends(d),
        ]
      }
      const flow = model(
        ["ex", "a", "bc", "d", "e", "ey", "ab", "c", "f", "g"],
        [...chain("ex", "a", "bc", "d", "e"), ...chain("ey", "ab", "c", "f", "g")],
      )
      expect(
        analyzeRedundantTransforms(flow).map((item) => item.hops.map((id) => id.split("#")[1])),
      ).toEqual([
        ["a", "bc", "d", "e"],
        ["ab", "c", "f", "g"],
      ])
    })
  })
})

describe("the model", () => {
  const read = edge("reads", FIELD, fnId("f"), ["email"], { source: at(3) })

  it("has no edgeTags when nothing was tagged, and the edge ids do not depend on tags", () => {
    const plain = model(["f"], [read])
    const tagged = model(["f"], [read], {
      tags: [{ via: "serialize-roundtrip", edge: idOf(read), source: at(2) }],
    })
    expect("edgeTags" in plain).toBe(false)
    expect(tagged.edges.map((item) => item.id)).toEqual(plain.edges.map((item) => item.id))
    expect(tagged.edgeTags?.map((item) => item.id)).toEqual([
      `tag:serialize-roundtrip:${idOf(read)}@${FILE}:2:3`,
    ])
  })

  it("rejects a tag on an edge that is not in the model", () => {
    expect(() =>
      model(["f"], [read], { tags: [{ via: "copy", edge: "reads:nope", source: at(1) }] }),
    ).toThrow("Tag copy refers to reads:nope, which is not an edge.")
  })

  it("merges the same place tagged twice, keeping what either said", () => {
    const merged = model(["f"], [read], {
      tags: [
        { via: "copy", edge: idOf(read), source: at(2), fresh: true },
        { via: "copy", edge: idOf(read), source: at(2) },
        { via: "derive", edge: idOf(read), source: at(2), unused: true },
        { via: "derive", edge: idOf(read), source: at(2) },
      ],
    })
    expect(merged.edgeTags?.map((item) => [item.via, item.fresh, item.unused])).toEqual([
      ["copy", true, undefined],
      ["derive", undefined, true],
    ])
  })

  it("orders the tags by id", () => {
    const ordered = model(["f"], [read], {
      tags: [
        { via: "derive", edge: idOf(read), source: at(2) },
        { via: "copy", edge: idOf(read), source: at(9) },
        { via: "copy", edge: idOf(read), source: at(2) },
      ],
    })
    expect(ordered.edgeTags?.map((item) => item.id)).toEqual(
      [
        `tag:copy:${idOf(read)}@${FILE}:2:3`,
        `tag:copy:${idOf(read)}@${FILE}:9:3`,
        `tag:derive:${idOf(read)}@${FILE}:2:3`,
      ].sort(),
    )
  })
})
