import { describe, expect, it } from "vitest"
import { buildFlowGraphView, nodeLabel } from "../../src/evidence/flow-graph-view.js"
import type { FlowGraphViewInput } from "../../src/evidence/flow-graph-view.js"
import type { ClaimsModel } from "../../src/flow/claims-model.js"
import { buildFlowModel, flowEdgeId, flowNodeId } from "../../src/flow/flow-model.js"
import type {
  FlowEdgeInput,
  FlowModel,
  FlowNode,
  FlowNodeInput,
  FlowUnknownInput,
} from "../../src/flow/flow-model.js"

const S = "s.ts"
const T = "t.ts"
const id = (kind: FlowNodeInput["kind"], scope: string, name: string): string =>
  flowNodeId(kind, scope, name)

const fu = id("field", S, "cap.user")
const ft = id("field", S, "cap.token")
const fn = id("field", S, "cap.plain")
const fu2 = id("field", S, "cap.user2")
const fa = id("function", S, "a")
const fb = id("function", S, "b")
const fc = id("function", S, "c")
const fd = id("function", S, "d")
const fe = id("function", S, "e")
const fk = id("function", S, "k")
const fm = id("function", S, "m")
const fr = id("function", S, "r")
const ftr = id("function", S, "t")
const fs = id("function", S, "s")
const fw = id("function", S, "w")
const fx = id("function", S, "x")
const fReturns = id("field", S, "cap.returns")
const fTransforms = id("field", S, "cap.transforms")
const fSide = id("field", S, "cap.side")
const fWrites = id("field", S, "cap.writes")
const pAUser = id("parameter", S, "a.user")
const pBx = id("parameter", S, "b.x")
const rA = id("return", S, "a#return")
const rB = id("return", T, "b#return")
const bDb = id("boundary", "boundary", "users")
const bOut = id("boundary", "boundary", "http")
const bBare = id("boundary", "boundary", "mystery")
const bLog = id("boundary", "boundary", "log")

function nodes(): FlowNodeInput[] {
  return [
    {
      kind: "field",
      scope: S,
      name: "cap.user",
      status: "declared",
      classification: "confidential",
    },
    { kind: "field", scope: S, name: "cap.token", status: "declared", classification: "secret" },
    { kind: "field", scope: S, name: "cap.plain", status: "declared" },
    {
      kind: "field",
      scope: S,
      name: "cap.user2",
      status: "declared",
      classification: "confidential",
    },
    { kind: "function", scope: S, name: "a", status: "static", source: { line: 3, column: 7 } },
    { kind: "function", scope: S, name: "b", status: "static" },
    { kind: "function", scope: S, name: "c", status: "declared" },
    { kind: "function", scope: S, name: "d", status: "static" },
    { kind: "function", scope: S, name: "e", status: "declared" },
    { kind: "function", scope: S, name: "r", status: "declared" },
    { kind: "function", scope: S, name: "t", status: "declared" },
    { kind: "function", scope: S, name: "s", status: "declared" },
    { kind: "function", scope: S, name: "w", status: "declared" },
    { kind: "function", scope: S, name: "x", status: "declared" },
    {
      kind: "field",
      scope: S,
      name: "cap.returns",
      status: "declared",
      classification: "cls-returns",
    },
    {
      kind: "field",
      scope: S,
      name: "cap.transforms",
      status: "declared",
      classification: "cls-transforms",
    },
    { kind: "field", scope: S, name: "cap.side", status: "declared", classification: "cls-side" },
    {
      kind: "field",
      scope: S,
      name: "cap.writes",
      status: "declared",
      classification: "cls-writes",
    },
    { kind: "function", scope: S, name: "k", status: "declared" },
    { kind: "function", scope: S, name: "m", status: "declared" },
    { kind: "parameter", scope: S, name: "e#return", status: "static" },
    { kind: "return", scope: S, name: "a.ret", status: "static" },
    { kind: "parameter", scope: S, name: "a.user", status: "static" },
    {
      kind: "parameter",
      scope: S,
      name: "a.opts",
      status: "static",
      source: { line: 4, column: 1 },
    },
    { kind: "parameter", scope: S, name: "ab.user", status: "static" },
    { kind: "parameter", scope: T, name: "a.user", status: "static" },
    { kind: "parameter", scope: S, name: "b.x", status: "static" },
    { kind: "return", scope: S, name: "a#return", status: "static" },
    { kind: "return", scope: T, name: "b#return", status: "static" },
    { kind: "return", scope: S, name: "b#other", status: "static" },
    {
      kind: "boundary",
      scope: "boundary",
      name: "users",
      status: "declared",
      boundaryKind: "database",
    },
    {
      kind: "boundary",
      scope: "boundary",
      name: "http",
      status: "declared",
      boundaryKind: "client-response",
    },
    { kind: "boundary", scope: "boundary", name: "mystery", status: "declared" },
    { kind: "boundary", scope: "boundary", name: "log", status: "declared", boundaryKind: "log" },
  ]
}

function edges(): FlowEdgeInput[] {
  const loc = { file: S, line: 9, column: 2 }
  return [
    // reads into a: via field (twice, to dedupe readers), via parameter, via return, via function (dropped), no origin (dropped), wrong kind (dropped)
    { kind: "reads", from: fu, to: fa, status: "static", path: ["id"], origin: fu, source: loc },
    { kind: "reads", from: fu, to: fa, status: "declared", origin: fu },
    { kind: "passes", from: pAUser, to: fa, status: "inferred", path: ["name"], origin: fu },
    { kind: "passes", from: rB, to: fa, status: "static", path: ["email"], origin: fu },
    { kind: "passes", from: fb, to: fa, status: "static", path: ["z"], origin: fu },
    { kind: "reads", from: fu, to: fa, status: "static", path: ["q"] },
    { kind: "writes", from: fu, to: fa, status: "static", path: ["w"], origin: fu },
    { kind: "reads", from: bDb, to: fa, status: "static", path: ["fromBoundary"], origin: fu },
    // a read by b through a parameter (not a reader of the field)
    { kind: "reads", from: pAUser, to: fb, status: "static", path: ["pp"], origin: fu },
    // forwards out of a
    { kind: "passes", from: fa, to: pBx, status: "static", path: ["id"], origin: fu },
    { kind: "returns", from: fa, to: rA, status: "static", path: ["name"], origin: fu },
    { kind: "transforms", from: fa, to: rA, status: "declared", origin: ft },
    { kind: "passes", from: fa, to: pBx, status: "static", path: ["noorigin"] },
    // side effects out of a
    {
      kind: "side-effect",
      from: fa,
      to: bOut,
      status: "static",
      path: ["id"],
      origin: fu,
      handling: "redacted",
      source: loc,
    },
    { kind: "side-effect", from: fa, to: bBare, status: "inferred", origin: ft },
    { kind: "side-effect", from: fa, to: bOut, status: "static", path: ["noorigin"] },
    // discards out of a, and one into a (not a discard of a)
    { kind: "discards", from: fa, to: fu, status: "static", path: ["role"], origin: fu },
    { kind: "discards", from: fa, to: fu, status: "static", path: ["noorigin"] },
    { kind: "discards", from: fc, to: fa, status: "static", path: ["incoming"], origin: fu },
    // calls
    { kind: "calls", from: fc, to: fa, status: "static" },
    { kind: "calls", from: fc, to: fa, status: "declared" },
    { kind: "calls", from: fd, to: fa, status: "static" },
    { kind: "calls", from: fa, to: fb, status: "static" },
    { kind: "calls", from: fa, to: fb, status: "declared" },
    { kind: "calls", from: fa, to: fc, status: "static" },
    // a data edge into d, and a non-data edge ("calls") out of c, making c's confidence come from the node
    { kind: "reads", from: fn, to: fd, status: "static", path: [], origin: fn },
    { kind: "reads", from: fn, to: fk, status: "static", path: ["q"], origin: fn },
    { kind: "reads", from: pAUser, to: fc, status: "static", path: ["viaParam"], origin: fu },
    { kind: "discards", from: fa, to: fu, status: "declared", origin: fu },
    { kind: "discards", from: fc, to: fu, status: "declared", origin: fu },
    { kind: "returns", from: fr, to: bLog, status: "inferred", origin: fReturns },
    { kind: "transforms", from: ftr, to: bLog, status: "inferred", origin: fTransforms },
    { kind: "side-effect", from: fs, to: bBare, status: "inferred", origin: fSide },
    { kind: "writes", from: fWrites, to: fw, status: "inferred", origin: fWrites },
    { kind: "calls", from: fw, to: fw, status: "unknown" },
    { kind: "discards", from: fx, to: ft, status: "static", origin: ft },
    { kind: "side-effect", from: fx, to: bBare, status: "static", path: ["a"], origin: fu },
    // field sources
    {
      kind: "crosses-boundary",
      from: bDb,
      to: fu,
      status: "declared",
      handling: "plaintext",
      source: loc,
    },
    { kind: "crosses-boundary", from: bBare, to: fu, status: "static" },
    { kind: "crosses-boundary", from: bDb, to: ft, status: "declared", path: ["t"] },
    { kind: "crosses-boundary", from: fa, to: fu, status: "static", path: ["notBoundary"] },
    // field destinations (paths unsorted, duplicated, undefined)
    {
      kind: "crosses-boundary",
      from: fu,
      to: bLog,
      status: "declared",
      path: ["b"],
      origin: fu,
      handling: "hashed",
    },
    {
      kind: "crosses-boundary",
      from: fu,
      to: bLog,
      status: "static",
      path: ["a", "z"],
      origin: fu,
      handling: "masked",
    },
    {
      kind: "crosses-boundary",
      from: fu,
      to: bLog,
      status: "inferred",
      path: ["a"],
      origin: fu,
      handling: "hashed",
    },
    { kind: "crosses-boundary", from: fu, to: bLog, status: "static", origin: fu },
    {
      kind: "crosses-boundary",
      from: fu,
      to: bLog,
      status: "static",
      path: [],
      origin: fu,
      handling: "encrypted",
    },
    {
      kind: "crosses-boundary",
      from: fu,
      to: bLog,
      status: "static",
      path: ["a", "b"],
      origin: fu,
    },
    { kind: "crosses-boundary", from: fu, to: bLog, status: "static", path: ["a0"], origin: fu },
    { kind: "crosses-boundary", from: fu, to: bLog, status: "declared", path: ["a.z"], origin: fu },
    { kind: "crosses-boundary", from: fu, to: bLog, status: "static", path: ["b"], origin: fu },
    { kind: "passes", from: fb, to: bBare, status: "unknown", path: ["x"], origin: fu },
    // a field that is complete and reaches nothing
    { kind: "reads", from: fn, to: fd, status: "declared", path: [], origin: fn },
    // other field
    { kind: "side-effect", from: fb, to: bOut, status: "static", path: ["tok"], origin: fu2 },
    { kind: "reads", from: fu2, to: fb, status: "static", path: [], origin: fu2 },
    { kind: "reads", from: fu, to: fb, status: "static", path: ["id"], origin: fu },
  ]
}

const unknowns = (): FlowUnknownInput[] => [
  { reason: "unresolved-call", source: { file: S, line: 5, column: 3 }, subject: fa },
  { reason: "unresolved-call", source: { file: S, line: 7, column: 3 }, subject: fk },
  { reason: "unresolved-call", source: { file: S, line: 8, column: 3 }, subject: fm },
  {
    reason: "dynamic-access",
    source: { file: S, line: 6, column: 1 },
    subject: fb,
    data: [{ origin: fu, path: [] }],
  },
]

function claimsModel(): ClaimsModel {
  const claim = (cid: string, subject: string): ClaimsModel["claims"][number] => ({
    id: cid,
    kind: "policy-holds",
    statement: cid,
    subject,
    object: "r",
    status: "static",
    verification: "unobserved",
    scope: { observationScopes: [], traceComplete: true },
    supporting: [],
    contradicting: [],
    derivedFrom: ["flow"],
  })
  return {
    schemaVersion: 1,
    claims: [
      claim("c1", "cap.user"),
      claim("c2", "cap.user.id"),
      claim("c3", "cap.userx"),
      claim("c4", "cap.use"),
      claim("c5", "cap.token"),
    ],
    summary: {
      verified: 1,
      inferred: 2,
      unobserved: 3,
      contradicted: 4,
      "observed-only": 5,
      indeterminate: 6,
    },
  }
}

const maximal = (): FlowGraphViewInput => ({
  flow: buildFlowModel({ nodes: nodes(), edges: edges(), unknowns: unknowns() }),
  claims: claimsModel(),
})

describe("buildFlowGraphView (hand-built maximal model)", () => {
  it("returns undefined without a flow", () => {
    expect(buildFlowGraphView({ flow: undefined, claims: undefined })).toBeUndefined()
  })

  it("projects every node with its label and optional fields", () => {
    expect(buildFlowGraphView(maximal())?.nodes).toMatchInlineSnapshot(`
      [
        {
          "boundaryKind": "client-response",
          "id": "boundary:boundary#http",
          "kind": "boundary",
          "label": "client-response: http",
          "name": "http",
          "scope": "boundary",
          "status": "declared",
        },
        {
          "boundaryKind": "log",
          "id": "boundary:boundary#log",
          "kind": "boundary",
          "label": "log: log",
          "name": "log",
          "scope": "boundary",
          "status": "declared",
        },
        {
          "id": "boundary:boundary#mystery",
          "kind": "boundary",
          "label": "boundary: mystery",
          "name": "mystery",
          "scope": "boundary",
          "status": "declared",
        },
        {
          "boundaryKind": "database",
          "id": "boundary:boundary#users",
          "kind": "boundary",
          "label": "database: users",
          "name": "users",
          "scope": "boundary",
          "status": "declared",
        },
        {
          "id": "field:s.ts#cap.plain",
          "kind": "field",
          "label": "cap.plain",
          "name": "cap.plain",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "classification": "cls-returns",
          "id": "field:s.ts#cap.returns",
          "kind": "field",
          "label": "cap.returns",
          "name": "cap.returns",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "classification": "cls-side",
          "id": "field:s.ts#cap.side",
          "kind": "field",
          "label": "cap.side",
          "name": "cap.side",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "classification": "secret",
          "id": "field:s.ts#cap.token",
          "kind": "field",
          "label": "cap.token",
          "name": "cap.token",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "classification": "cls-transforms",
          "id": "field:s.ts#cap.transforms",
          "kind": "field",
          "label": "cap.transforms",
          "name": "cap.transforms",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "classification": "confidential",
          "id": "field:s.ts#cap.user",
          "kind": "field",
          "label": "cap.user",
          "name": "cap.user",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "classification": "confidential",
          "id": "field:s.ts#cap.user2",
          "kind": "field",
          "label": "cap.user2",
          "name": "cap.user2",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "classification": "cls-writes",
          "id": "field:s.ts#cap.writes",
          "kind": "field",
          "label": "cap.writes",
          "name": "cap.writes",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#a",
          "kind": "function",
          "label": "a",
          "name": "a",
          "scope": "s.ts",
          "source": {
            "column": 7,
            "line": 3,
          },
          "status": "static",
        },
        {
          "id": "function:s.ts#b",
          "kind": "function",
          "label": "b",
          "name": "b",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "function:s.ts#c",
          "kind": "function",
          "label": "c",
          "name": "c",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#d",
          "kind": "function",
          "label": "d",
          "name": "d",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "function:s.ts#e",
          "kind": "function",
          "label": "e",
          "name": "e",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#k",
          "kind": "function",
          "label": "k",
          "name": "k",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#m",
          "kind": "function",
          "label": "m",
          "name": "m",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#r",
          "kind": "function",
          "label": "r",
          "name": "r",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#s",
          "kind": "function",
          "label": "s",
          "name": "s",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#t",
          "kind": "function",
          "label": "t",
          "name": "t",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#w",
          "kind": "function",
          "label": "w",
          "name": "w",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "function:s.ts#x",
          "kind": "function",
          "label": "x",
          "name": "x",
          "scope": "s.ts",
          "status": "declared",
        },
        {
          "id": "parameter:s.ts#a.opts",
          "kind": "parameter",
          "label": "opts",
          "name": "a.opts",
          "scope": "s.ts",
          "source": {
            "column": 1,
            "line": 4,
          },
          "status": "static",
        },
        {
          "id": "parameter:s.ts#a.user",
          "kind": "parameter",
          "label": "user",
          "name": "a.user",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "parameter:s.ts#ab.user",
          "kind": "parameter",
          "label": "user",
          "name": "ab.user",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "parameter:s.ts#b.x",
          "kind": "parameter",
          "label": "x",
          "name": "b.x",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "parameter:s.ts#e#return",
          "kind": "parameter",
          "label": "e#return",
          "name": "e#return",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "parameter:t.ts#a.user",
          "kind": "parameter",
          "label": "user",
          "name": "a.user",
          "scope": "t.ts",
          "status": "static",
        },
        {
          "id": "return:s.ts#a#return",
          "kind": "return",
          "label": "return",
          "name": "a#return",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "return:s.ts#a.ret",
          "kind": "return",
          "label": "return",
          "name": "a.ret",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "return:s.ts#b#other",
          "kind": "return",
          "label": "return",
          "name": "b#other",
          "scope": "s.ts",
          "status": "static",
        },
        {
          "id": "return:t.ts#b#return",
          "kind": "return",
          "label": "return",
          "name": "b#return",
          "scope": "t.ts",
          "status": "static",
        },
      ]
    `)
  })

  it("projects every edge with its optional fields", () => {
    expect(buildFlowGraphView(maximal())?.edges).toMatchInlineSnapshot(`
      [
        {
          "from": "function:s.ts#a",
          "id": "calls:function:s.ts#a->function:s.ts#b@declared",
          "kind": "calls",
          "status": "declared",
          "to": "function:s.ts#b",
        },
        {
          "from": "function:s.ts#a",
          "id": "calls:function:s.ts#a->function:s.ts#b@static",
          "kind": "calls",
          "status": "static",
          "to": "function:s.ts#b",
        },
        {
          "from": "function:s.ts#a",
          "id": "calls:function:s.ts#a->function:s.ts#c@static",
          "kind": "calls",
          "status": "static",
          "to": "function:s.ts#c",
        },
        {
          "from": "function:s.ts#c",
          "id": "calls:function:s.ts#c->function:s.ts#a@declared",
          "kind": "calls",
          "status": "declared",
          "to": "function:s.ts#a",
        },
        {
          "from": "function:s.ts#c",
          "id": "calls:function:s.ts#c->function:s.ts#a@static",
          "kind": "calls",
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "function:s.ts#d",
          "id": "calls:function:s.ts#d->function:s.ts#a@static",
          "kind": "calls",
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "function:s.ts#w",
          "id": "calls:function:s.ts#w->function:s.ts#w@unknown",
          "kind": "calls",
          "status": "unknown",
          "to": "function:s.ts#w",
        },
        {
          "from": "boundary:boundary#mystery",
          "id": "crosses-boundary:boundary:boundary#mystery->field:s.ts#cap.user@static",
          "kind": "crosses-boundary",
          "status": "static",
          "to": "field:s.ts#cap.user",
        },
        {
          "from": "boundary:boundary#users",
          "id": "crosses-boundary:boundary:boundary#users->field:s.ts#cap.token:t@declared",
          "kind": "crosses-boundary",
          "path": [
            "t",
          ],
          "status": "declared",
          "to": "field:s.ts#cap.token",
        },
        {
          "from": "boundary:boundary#users",
          "handling": "plaintext",
          "id": "crosses-boundary:boundary:boundary#users->field:s.ts#cap.user@declared",
          "kind": "crosses-boundary",
          "source": {
            "column": 2,
            "file": "s.ts",
            "line": 9,
          },
          "status": "declared",
          "to": "field:s.ts#cap.user",
        },
        {
          "from": "field:s.ts#cap.user",
          "handling": "encrypted",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log:@static^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "path": [],
          "status": "static",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log:a.b@static^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "path": [
            "a",
            "b",
          ],
          "status": "static",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log:a.z@declared^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "path": [
            "a.z",
          ],
          "status": "declared",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "handling": "masked",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log:a.z@static^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "path": [
            "a",
            "z",
          ],
          "status": "static",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log:a0@static^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "path": [
            "a0",
          ],
          "status": "static",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "handling": "hashed",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log:a@inferred^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "path": [
            "a",
          ],
          "status": "inferred",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "handling": "hashed",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log:b@declared^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "path": [
            "b",
          ],
          "status": "declared",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log:b@static^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "path": [
            "b",
          ],
          "status": "static",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "crosses-boundary:field:s.ts#cap.user->boundary:boundary#log@static^field:s.ts#cap.user",
          "kind": "crosses-boundary",
          "origin": "field:s.ts#cap.user",
          "status": "static",
          "to": "boundary:boundary#log",
        },
        {
          "from": "function:s.ts#a",
          "id": "crosses-boundary:function:s.ts#a->field:s.ts#cap.user:notBoundary@static",
          "kind": "crosses-boundary",
          "path": [
            "notBoundary",
          ],
          "status": "static",
          "to": "field:s.ts#cap.user",
        },
        {
          "from": "function:s.ts#a",
          "id": "discards:function:s.ts#a->field:s.ts#cap.user:noorigin@static",
          "kind": "discards",
          "path": [
            "noorigin",
          ],
          "status": "static",
          "to": "field:s.ts#cap.user",
        },
        {
          "from": "function:s.ts#a",
          "id": "discards:function:s.ts#a->field:s.ts#cap.user:role@static^field:s.ts#cap.user",
          "kind": "discards",
          "origin": "field:s.ts#cap.user",
          "path": [
            "role",
          ],
          "status": "static",
          "to": "field:s.ts#cap.user",
        },
        {
          "from": "function:s.ts#a",
          "id": "discards:function:s.ts#a->field:s.ts#cap.user@declared^field:s.ts#cap.user",
          "kind": "discards",
          "origin": "field:s.ts#cap.user",
          "status": "declared",
          "to": "field:s.ts#cap.user",
        },
        {
          "from": "function:s.ts#c",
          "id": "discards:function:s.ts#c->field:s.ts#cap.user@declared^field:s.ts#cap.user",
          "kind": "discards",
          "origin": "field:s.ts#cap.user",
          "status": "declared",
          "to": "field:s.ts#cap.user",
        },
        {
          "from": "function:s.ts#c",
          "id": "discards:function:s.ts#c->function:s.ts#a:incoming@static^field:s.ts#cap.user",
          "kind": "discards",
          "origin": "field:s.ts#cap.user",
          "path": [
            "incoming",
          ],
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "function:s.ts#x",
          "id": "discards:function:s.ts#x->field:s.ts#cap.token@static^field:s.ts#cap.token",
          "kind": "discards",
          "origin": "field:s.ts#cap.token",
          "status": "static",
          "to": "field:s.ts#cap.token",
        },
        {
          "from": "function:s.ts#a",
          "id": "passes:function:s.ts#a->parameter:s.ts#b.x:id@static^field:s.ts#cap.user",
          "kind": "passes",
          "origin": "field:s.ts#cap.user",
          "path": [
            "id",
          ],
          "status": "static",
          "to": "parameter:s.ts#b.x",
        },
        {
          "from": "function:s.ts#a",
          "id": "passes:function:s.ts#a->parameter:s.ts#b.x:noorigin@static",
          "kind": "passes",
          "path": [
            "noorigin",
          ],
          "status": "static",
          "to": "parameter:s.ts#b.x",
        },
        {
          "from": "function:s.ts#b",
          "id": "passes:function:s.ts#b->boundary:boundary#mystery:x@unknown^field:s.ts#cap.user",
          "kind": "passes",
          "origin": "field:s.ts#cap.user",
          "path": [
            "x",
          ],
          "status": "unknown",
          "to": "boundary:boundary#mystery",
        },
        {
          "from": "function:s.ts#b",
          "id": "passes:function:s.ts#b->function:s.ts#a:z@static^field:s.ts#cap.user",
          "kind": "passes",
          "origin": "field:s.ts#cap.user",
          "path": [
            "z",
          ],
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "parameter:s.ts#a.user",
          "id": "passes:parameter:s.ts#a.user->function:s.ts#a:name@inferred^field:s.ts#cap.user",
          "kind": "passes",
          "origin": "field:s.ts#cap.user",
          "path": [
            "name",
          ],
          "status": "inferred",
          "to": "function:s.ts#a",
        },
        {
          "from": "return:t.ts#b#return",
          "id": "passes:return:t.ts#b#return->function:s.ts#a:email@static^field:s.ts#cap.user",
          "kind": "passes",
          "origin": "field:s.ts#cap.user",
          "path": [
            "email",
          ],
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "boundary:boundary#users",
          "id": "reads:boundary:boundary#users->function:s.ts#a:fromBoundary@static^field:s.ts#cap.user",
          "kind": "reads",
          "origin": "field:s.ts#cap.user",
          "path": [
            "fromBoundary",
          ],
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "field:s.ts#cap.plain",
          "id": "reads:field:s.ts#cap.plain->function:s.ts#d:@declared^field:s.ts#cap.plain",
          "kind": "reads",
          "origin": "field:s.ts#cap.plain",
          "path": [],
          "status": "declared",
          "to": "function:s.ts#d",
        },
        {
          "from": "field:s.ts#cap.plain",
          "id": "reads:field:s.ts#cap.plain->function:s.ts#d:@static^field:s.ts#cap.plain",
          "kind": "reads",
          "origin": "field:s.ts#cap.plain",
          "path": [],
          "status": "static",
          "to": "function:s.ts#d",
        },
        {
          "from": "field:s.ts#cap.plain",
          "id": "reads:field:s.ts#cap.plain->function:s.ts#k:q@static^field:s.ts#cap.plain",
          "kind": "reads",
          "origin": "field:s.ts#cap.plain",
          "path": [
            "q",
          ],
          "status": "static",
          "to": "function:s.ts#k",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "reads:field:s.ts#cap.user->function:s.ts#a:id@static^field:s.ts#cap.user",
          "kind": "reads",
          "origin": "field:s.ts#cap.user",
          "path": [
            "id",
          ],
          "source": {
            "column": 2,
            "file": "s.ts",
            "line": 9,
          },
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "reads:field:s.ts#cap.user->function:s.ts#a:q@static",
          "kind": "reads",
          "path": [
            "q",
          ],
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "reads:field:s.ts#cap.user->function:s.ts#a@declared^field:s.ts#cap.user",
          "kind": "reads",
          "origin": "field:s.ts#cap.user",
          "status": "declared",
          "to": "function:s.ts#a",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "reads:field:s.ts#cap.user->function:s.ts#b:id@static^field:s.ts#cap.user",
          "kind": "reads",
          "origin": "field:s.ts#cap.user",
          "path": [
            "id",
          ],
          "status": "static",
          "to": "function:s.ts#b",
        },
        {
          "from": "field:s.ts#cap.user2",
          "id": "reads:field:s.ts#cap.user2->function:s.ts#b:@static^field:s.ts#cap.user2",
          "kind": "reads",
          "origin": "field:s.ts#cap.user2",
          "path": [],
          "status": "static",
          "to": "function:s.ts#b",
        },
        {
          "from": "parameter:s.ts#a.user",
          "id": "reads:parameter:s.ts#a.user->function:s.ts#b:pp@static^field:s.ts#cap.user",
          "kind": "reads",
          "origin": "field:s.ts#cap.user",
          "path": [
            "pp",
          ],
          "status": "static",
          "to": "function:s.ts#b",
        },
        {
          "from": "parameter:s.ts#a.user",
          "id": "reads:parameter:s.ts#a.user->function:s.ts#c:viaParam@static^field:s.ts#cap.user",
          "kind": "reads",
          "origin": "field:s.ts#cap.user",
          "path": [
            "viaParam",
          ],
          "status": "static",
          "to": "function:s.ts#c",
        },
        {
          "from": "function:s.ts#a",
          "id": "returns:function:s.ts#a->return:s.ts#a#return:name@static^field:s.ts#cap.user",
          "kind": "returns",
          "origin": "field:s.ts#cap.user",
          "path": [
            "name",
          ],
          "status": "static",
          "to": "return:s.ts#a#return",
        },
        {
          "from": "function:s.ts#r",
          "id": "returns:function:s.ts#r->boundary:boundary#log@inferred^field:s.ts#cap.returns",
          "kind": "returns",
          "origin": "field:s.ts#cap.returns",
          "status": "inferred",
          "to": "boundary:boundary#log",
        },
        {
          "from": "function:s.ts#a",
          "handling": "redacted",
          "id": "side-effect:function:s.ts#a->boundary:boundary#http:id@static^field:s.ts#cap.user",
          "kind": "side-effect",
          "origin": "field:s.ts#cap.user",
          "path": [
            "id",
          ],
          "source": {
            "column": 2,
            "file": "s.ts",
            "line": 9,
          },
          "status": "static",
          "to": "boundary:boundary#http",
        },
        {
          "from": "function:s.ts#a",
          "id": "side-effect:function:s.ts#a->boundary:boundary#http:noorigin@static",
          "kind": "side-effect",
          "path": [
            "noorigin",
          ],
          "status": "static",
          "to": "boundary:boundary#http",
        },
        {
          "from": "function:s.ts#a",
          "id": "side-effect:function:s.ts#a->boundary:boundary#mystery@inferred^field:s.ts#cap.token",
          "kind": "side-effect",
          "origin": "field:s.ts#cap.token",
          "status": "inferred",
          "to": "boundary:boundary#mystery",
        },
        {
          "from": "function:s.ts#b",
          "id": "side-effect:function:s.ts#b->boundary:boundary#http:tok@static^field:s.ts#cap.user2",
          "kind": "side-effect",
          "origin": "field:s.ts#cap.user2",
          "path": [
            "tok",
          ],
          "status": "static",
          "to": "boundary:boundary#http",
        },
        {
          "from": "function:s.ts#s",
          "id": "side-effect:function:s.ts#s->boundary:boundary#mystery@inferred^field:s.ts#cap.side",
          "kind": "side-effect",
          "origin": "field:s.ts#cap.side",
          "status": "inferred",
          "to": "boundary:boundary#mystery",
        },
        {
          "from": "function:s.ts#x",
          "id": "side-effect:function:s.ts#x->boundary:boundary#mystery:a@static^field:s.ts#cap.user",
          "kind": "side-effect",
          "origin": "field:s.ts#cap.user",
          "path": [
            "a",
          ],
          "status": "static",
          "to": "boundary:boundary#mystery",
        },
        {
          "from": "function:s.ts#a",
          "id": "transforms:function:s.ts#a->return:s.ts#a#return@declared^field:s.ts#cap.token",
          "kind": "transforms",
          "origin": "field:s.ts#cap.token",
          "status": "declared",
          "to": "return:s.ts#a#return",
        },
        {
          "from": "function:s.ts#t",
          "id": "transforms:function:s.ts#t->boundary:boundary#log@inferred^field:s.ts#cap.transforms",
          "kind": "transforms",
          "origin": "field:s.ts#cap.transforms",
          "status": "inferred",
          "to": "boundary:boundary#log",
        },
        {
          "from": "field:s.ts#cap.user",
          "id": "writes:field:s.ts#cap.user->function:s.ts#a:w@static^field:s.ts#cap.user",
          "kind": "writes",
          "origin": "field:s.ts#cap.user",
          "path": [
            "w",
          ],
          "status": "static",
          "to": "function:s.ts#a",
        },
        {
          "from": "field:s.ts#cap.writes",
          "id": "writes:field:s.ts#cap.writes->function:s.ts#w@inferred^field:s.ts#cap.writes",
          "kind": "writes",
          "origin": "field:s.ts#cap.writes",
          "status": "inferred",
          "to": "function:s.ts#w",
        },
      ]
    `)
  })

  it("projects every function", () => {
    expect(buildFlowGraphView(maximal())?.functions).toMatchInlineSnapshot(`
      [
        {
          "callees": [
            {
              "id": "function:s.ts#b",
              "name": "b",
            },
            {
              "id": "function:s.ts#c",
              "name": "c",
            },
          ],
          "callers": [
            {
              "id": "function:s.ts#c",
              "name": "c",
            },
            {
              "id": "function:s.ts#d",
              "name": "d",
            },
          ],
          "classifications": [
            "confidential",
            "secret",
          ],
          "confidence": "inferred",
          "discards": [
            {
              "field": "cap.user",
              "origin": "field:s.ts#cap.user",
              "path": [
                "role",
              ],
            },
            {
              "field": "cap.user",
              "origin": "field:s.ts#cap.user",
              "path": [],
            },
          ],
          "forwards": [
            {
              "field": "cap.user",
              "kind": "passes",
              "origin": "field:s.ts#cap.user",
              "path": [
                "id",
              ],
              "status": "static",
              "to": "parameter:s.ts#b.x",
              "toName": "b.x",
            },
            {
              "field": "cap.user",
              "kind": "returns",
              "origin": "field:s.ts#cap.user",
              "path": [
                "name",
              ],
              "status": "static",
              "to": "return:s.ts#a#return",
              "toName": "a#return",
            },
            {
              "field": "cap.token",
              "kind": "transforms",
              "origin": "field:s.ts#cap.token",
              "path": [],
              "status": "declared",
              "to": "return:s.ts#a#return",
              "toName": "a#return",
            },
          ],
          "id": "function:s.ts#a",
          "inputs": [
            {
              "id": "parameter:s.ts#a.opts",
              "name": "a.opts",
            },
            {
              "id": "parameter:s.ts#a.user",
              "name": "a.user",
            },
          ],
          "name": "a",
          "output": "return:s.ts#a#return",
          "reads": [
            {
              "field": "cap.user",
              "from": "parameter:s.ts#a.user",
              "origin": "field:s.ts#cap.user",
              "path": [
                "name",
              ],
              "status": "inferred",
              "via": "parameter",
            },
            {
              "field": "cap.user",
              "from": "return:t.ts#b#return",
              "origin": "field:s.ts#cap.user",
              "path": [
                "email",
              ],
              "status": "static",
              "via": "return",
            },
            {
              "field": "cap.user",
              "from": "field:s.ts#cap.user",
              "origin": "field:s.ts#cap.user",
              "path": [
                "id",
              ],
              "status": "static",
              "via": "field",
            },
            {
              "field": "cap.user",
              "from": "field:s.ts#cap.user",
              "origin": "field:s.ts#cap.user",
              "path": [],
              "status": "declared",
              "via": "field",
            },
          ],
          "scope": "s.ts",
          "sideEffects": [
            {
              "boundary": "boundary:boundary#http",
              "boundaryKind": "client-response",
              "boundaryName": "http",
              "field": "cap.user",
              "handling": "redacted",
              "origin": "field:s.ts#cap.user",
              "path": [
                "id",
              ],
              "status": "static",
            },
            {
              "boundary": "boundary:boundary#mystery",
              "boundaryName": "mystery",
              "field": "cap.token",
              "origin": "field:s.ts#cap.token",
              "path": [],
              "status": "inferred",
            },
          ],
          "source": {
            "column": 7,
            "line": 3,
          },
          "status": "static",
          "unknowns": [
            "unknown:unresolved-call:s.ts:5:3",
          ],
        },
        {
          "callees": [],
          "callers": [
            {
              "id": "function:s.ts#a",
              "name": "a",
            },
          ],
          "classifications": [
            "confidential",
          ],
          "confidence": "unknown",
          "discards": [],
          "forwards": [
            {
              "field": "cap.user",
              "kind": "passes",
              "origin": "field:s.ts#cap.user",
              "path": [
                "x",
              ],
              "status": "unknown",
              "to": "boundary:boundary#mystery",
              "toName": "mystery",
            },
            {
              "field": "cap.user",
              "kind": "passes",
              "origin": "field:s.ts#cap.user",
              "path": [
                "z",
              ],
              "status": "static",
              "to": "function:s.ts#a",
              "toName": "a",
            },
          ],
          "id": "function:s.ts#b",
          "inputs": [
            {
              "id": "parameter:s.ts#b.x",
              "name": "b.x",
            },
          ],
          "name": "b",
          "reads": [
            {
              "field": "cap.user",
              "from": "field:s.ts#cap.user",
              "origin": "field:s.ts#cap.user",
              "path": [
                "id",
              ],
              "status": "static",
              "via": "field",
            },
            {
              "field": "cap.user2",
              "from": "field:s.ts#cap.user2",
              "origin": "field:s.ts#cap.user2",
              "path": [],
              "status": "static",
              "via": "field",
            },
            {
              "field": "cap.user",
              "from": "parameter:s.ts#a.user",
              "origin": "field:s.ts#cap.user",
              "path": [
                "pp",
              ],
              "status": "static",
              "via": "parameter",
            },
          ],
          "scope": "s.ts",
          "sideEffects": [
            {
              "boundary": "boundary:boundary#http",
              "boundaryKind": "client-response",
              "boundaryName": "http",
              "field": "cap.user2",
              "origin": "field:s.ts#cap.user2",
              "path": [
                "tok",
              ],
              "status": "static",
            },
          ],
          "status": "static",
          "unknowns": [
            "unknown:dynamic-access:s.ts:6:1",
          ],
        },
        {
          "callees": [
            {
              "id": "function:s.ts#a",
              "name": "a",
            },
          ],
          "callers": [
            {
              "id": "function:s.ts#a",
              "name": "a",
            },
          ],
          "classifications": [
            "confidential",
          ],
          "confidence": "declared",
          "discards": [
            {
              "field": "cap.user",
              "origin": "field:s.ts#cap.user",
              "path": [],
            },
            {
              "field": "cap.user",
              "origin": "field:s.ts#cap.user",
              "path": [
                "incoming",
              ],
            },
          ],
          "forwards": [],
          "id": "function:s.ts#c",
          "inputs": [],
          "name": "c",
          "reads": [
            {
              "field": "cap.user",
              "from": "parameter:s.ts#a.user",
              "origin": "field:s.ts#cap.user",
              "path": [
                "viaParam",
              ],
              "status": "static",
              "via": "parameter",
            },
          ],
          "scope": "s.ts",
          "sideEffects": [],
          "status": "declared",
          "unknowns": [],
        },
        {
          "callees": [
            {
              "id": "function:s.ts#a",
              "name": "a",
            },
          ],
          "callers": [],
          "classifications": [],
          "confidence": "declared",
          "discards": [],
          "forwards": [],
          "id": "function:s.ts#d",
          "inputs": [],
          "name": "d",
          "reads": [
            {
              "field": "cap.plain",
              "from": "field:s.ts#cap.plain",
              "origin": "field:s.ts#cap.plain",
              "path": [],
              "status": "declared",
              "via": "field",
            },
            {
              "field": "cap.plain",
              "from": "field:s.ts#cap.plain",
              "origin": "field:s.ts#cap.plain",
              "path": [],
              "status": "static",
              "via": "field",
            },
          ],
          "scope": "s.ts",
          "sideEffects": [],
          "status": "static",
          "unknowns": [],
        },
        {
          "callees": [],
          "callers": [],
          "classifications": [],
          "confidence": "declared",
          "discards": [],
          "forwards": [],
          "id": "function:s.ts#e",
          "inputs": [],
          "name": "e",
          "reads": [],
          "scope": "s.ts",
          "sideEffects": [],
          "status": "declared",
          "unknowns": [],
        },
        {
          "callees": [],
          "callers": [],
          "classifications": [],
          "confidence": "inferred",
          "discards": [],
          "forwards": [],
          "id": "function:s.ts#k",
          "inputs": [],
          "name": "k",
          "reads": [
            {
              "field": "cap.plain",
              "from": "field:s.ts#cap.plain",
              "origin": "field:s.ts#cap.plain",
              "path": [
                "q",
              ],
              "status": "static",
              "via": "field",
            },
          ],
          "scope": "s.ts",
          "sideEffects": [],
          "status": "declared",
          "unknowns": [
            "unknown:unresolved-call:s.ts:7:3",
          ],
        },
        {
          "callees": [],
          "callers": [],
          "classifications": [],
          "confidence": "inferred",
          "discards": [],
          "forwards": [],
          "id": "function:s.ts#m",
          "inputs": [],
          "name": "m",
          "reads": [],
          "scope": "s.ts",
          "sideEffects": [],
          "status": "declared",
          "unknowns": [
            "unknown:unresolved-call:s.ts:8:3",
          ],
        },
        {
          "callees": [],
          "callers": [],
          "classifications": [
            "cls-returns",
          ],
          "confidence": "inferred",
          "discards": [],
          "forwards": [
            {
              "field": "cap.returns",
              "kind": "returns",
              "origin": "field:s.ts#cap.returns",
              "path": [],
              "status": "inferred",
              "to": "boundary:boundary#log",
              "toName": "log",
            },
          ],
          "id": "function:s.ts#r",
          "inputs": [],
          "name": "r",
          "reads": [],
          "scope": "s.ts",
          "sideEffects": [],
          "status": "declared",
          "unknowns": [],
        },
        {
          "callees": [],
          "callers": [],
          "classifications": [
            "cls-side",
          ],
          "confidence": "inferred",
          "discards": [],
          "forwards": [],
          "id": "function:s.ts#s",
          "inputs": [],
          "name": "s",
          "reads": [],
          "scope": "s.ts",
          "sideEffects": [
            {
              "boundary": "boundary:boundary#mystery",
              "boundaryName": "mystery",
              "field": "cap.side",
              "origin": "field:s.ts#cap.side",
              "path": [],
              "status": "inferred",
            },
          ],
          "status": "declared",
          "unknowns": [],
        },
        {
          "callees": [],
          "callers": [],
          "classifications": [
            "cls-transforms",
          ],
          "confidence": "inferred",
          "discards": [],
          "forwards": [
            {
              "field": "cap.transforms",
              "kind": "transforms",
              "origin": "field:s.ts#cap.transforms",
              "path": [],
              "status": "inferred",
              "to": "boundary:boundary#log",
              "toName": "log",
            },
          ],
          "id": "function:s.ts#t",
          "inputs": [],
          "name": "t",
          "reads": [],
          "scope": "s.ts",
          "sideEffects": [],
          "status": "declared",
          "unknowns": [],
        },
        {
          "callees": [
            {
              "id": "function:s.ts#w",
              "name": "w",
            },
          ],
          "callers": [
            {
              "id": "function:s.ts#w",
              "name": "w",
            },
          ],
          "classifications": [],
          "confidence": "declared",
          "discards": [],
          "forwards": [],
          "id": "function:s.ts#w",
          "inputs": [],
          "name": "w",
          "reads": [],
          "scope": "s.ts",
          "sideEffects": [],
          "status": "declared",
          "unknowns": [],
        },
        {
          "callees": [],
          "callers": [],
          "classifications": [
            "confidential",
            "secret",
          ],
          "confidence": "static",
          "discards": [
            {
              "field": "cap.token",
              "origin": "field:s.ts#cap.token",
              "path": [],
            },
          ],
          "forwards": [],
          "id": "function:s.ts#x",
          "inputs": [],
          "name": "x",
          "reads": [],
          "scope": "s.ts",
          "sideEffects": [
            {
              "boundary": "boundary:boundary#mystery",
              "boundaryName": "mystery",
              "field": "cap.user",
              "origin": "field:s.ts#cap.user",
              "path": [
                "a",
              ],
              "status": "static",
            },
          ],
          "status": "declared",
          "unknowns": [],
        },
      ]
    `)
  })

  it("projects every field", () => {
    expect(buildFlowGraphView(maximal())?.fields).toMatchInlineSnapshot(`
      [
        {
          "claims": [],
          "complete": false,
          "destinations": [],
          "discardedBy": [],
          "id": "field:s.ts#cap.plain",
          "name": "cap.plain",
          "readers": [
            {
              "function": "function:s.ts#d",
              "functionName": "d",
            },
            {
              "function": "function:s.ts#k",
              "functionName": "k",
            },
          ],
          "scope": "s.ts",
          "sources": [],
        },
        {
          "claims": [],
          "classification": "cls-returns",
          "complete": true,
          "destinations": [],
          "discardedBy": [],
          "id": "field:s.ts#cap.returns",
          "name": "cap.returns",
          "readers": [],
          "scope": "s.ts",
          "sources": [],
        },
        {
          "claims": [],
          "classification": "cls-side",
          "complete": true,
          "destinations": [],
          "discardedBy": [],
          "id": "field:s.ts#cap.side",
          "name": "cap.side",
          "readers": [],
          "scope": "s.ts",
          "sources": [],
        },
        {
          "claims": [
            "c5",
          ],
          "classification": "secret",
          "complete": true,
          "destinations": [],
          "discardedBy": [
            {
              "function": "function:s.ts#x",
              "functionName": "x",
              "path": [],
            },
          ],
          "id": "field:s.ts#cap.token",
          "name": "cap.token",
          "readers": [],
          "scope": "s.ts",
          "sources": [
            {
              "boundary": "boundary:boundary#users",
              "boundaryKind": "database",
              "boundaryName": "users",
              "status": "declared",
            },
          ],
        },
        {
          "claims": [],
          "classification": "cls-transforms",
          "complete": true,
          "destinations": [],
          "discardedBy": [],
          "id": "field:s.ts#cap.transforms",
          "name": "cap.transforms",
          "readers": [],
          "scope": "s.ts",
          "sources": [],
        },
        {
          "claims": [
            "c1",
            "c2",
          ],
          "classification": "confidential",
          "complete": false,
          "destinations": [
            {
              "boundary": "boundary:boundary#http",
              "boundaryKind": "client-response",
              "boundaryName": "http",
              "handling": [
                "redacted",
              ],
              "paths": [
                [
                  "id",
                ],
                [
                  "noorigin",
                ],
              ],
              "status": "static",
            },
            {
              "boundary": "boundary:boundary#log",
              "boundaryKind": "log",
              "boundaryName": "log",
              "handling": [
                "encrypted",
                "hashed",
                "masked",
              ],
              "paths": [
                [],
                [
                  "a",
                ],
                [
                  "a",
                  "b",
                ],
                [
                  "a",
                  "z",
                ],
                [
                  "a0",
                ],
                [
                  "b",
                ],
              ],
              "status": "inferred",
            },
            {
              "boundary": "boundary:boundary#mystery",
              "boundaryName": "mystery",
              "handling": [],
              "paths": [],
              "status": "static",
            },
          ],
          "discardedBy": [
            {
              "function": "function:s.ts#a",
              "functionName": "a",
              "path": [
                "role",
              ],
            },
            {
              "function": "function:s.ts#a",
              "functionName": "a",
              "path": [],
            },
            {
              "function": "function:s.ts#c",
              "functionName": "c",
              "path": [],
            },
            {
              "function": "function:s.ts#c",
              "functionName": "c",
              "path": [
                "incoming",
              ],
            },
          ],
          "id": "field:s.ts#cap.user",
          "name": "cap.user",
          "readers": [
            {
              "function": "function:s.ts#a",
              "functionName": "a",
            },
            {
              "function": "function:s.ts#b",
              "functionName": "b",
            },
          ],
          "scope": "s.ts",
          "sources": [
            {
              "boundary": "boundary:boundary#mystery",
              "boundaryName": "mystery",
              "status": "static",
            },
            {
              "boundary": "boundary:boundary#users",
              "boundaryKind": "database",
              "boundaryName": "users",
              "handling": "plaintext",
              "status": "declared",
            },
            {
              "boundary": "function:s.ts#a",
              "boundaryName": "a",
              "status": "static",
            },
          ],
        },
        {
          "claims": [],
          "classification": "confidential",
          "complete": true,
          "destinations": [
            {
              "boundary": "boundary:boundary#http",
              "boundaryKind": "client-response",
              "boundaryName": "http",
              "handling": [],
              "paths": [
                [
                  "tok",
                ],
              ],
              "status": "static",
            },
          ],
          "discardedBy": [],
          "id": "field:s.ts#cap.user2",
          "name": "cap.user2",
          "readers": [
            {
              "function": "function:s.ts#b",
              "functionName": "b",
            },
          ],
          "scope": "s.ts",
          "sources": [],
        },
        {
          "claims": [],
          "classification": "cls-writes",
          "complete": true,
          "destinations": [],
          "discardedBy": [],
          "id": "field:s.ts#cap.writes",
          "name": "cap.writes",
          "readers": [],
          "scope": "s.ts",
          "sources": [],
        },
      ]
    `)
  })

  it("carries version, coverage, unknowns, claims summary and the legend", () => {
    const view = buildFlowGraphView(maximal())
    const rest = {
      schemaVersion: view?.schemaVersion,
      coverage: view?.coverage,
      unknowns: view?.unknowns,
      claims: view?.claims,
      statusLegend: view?.statusLegend,
    }
    expect(rest).toMatchInlineSnapshot(`
      {
        "claims": {
          "contradicted": 4,
          "indeterminate": 6,
          "inferred": 2,
          "observed-only": 5,
          "unobserved": 3,
          "verified": 1,
        },
        "coverage": {
          "complete": false,
          "edgesUnresolved": 2,
          "functionsAnalyzed": 12,
          "functionsUnanalyzed": 0,
          "unknowns": 4,
        },
        "schemaVersion": 1,
        "statusLegend": [
          {
            "meaning": "Asserted by an author in documentData(); not checked against code.",
            "status": "declared",
          },
          {
            "meaning": "Established by the analyzed code under the analysis's stated assumptions.",
            "status": "static",
          },
          {
            "meaning": "Witnessed in a specific execution or test.",
            "status": "observed",
          },
          {
            "meaning": "Plausible but not established: data assumed to pass through code the analysis could not follow.",
            "status": "inferred",
          },
          {
            "meaning": "Not analyzable: dynamic behavior, missing source, an unsupported construct, or incomplete coverage.",
            "status": "unknown",
          },
        ],
        "unknowns": [
          {
            "data": [
              {
                "origin": "field:s.ts#cap.user",
                "path": [],
              },
            ],
            "id": "unknown:dynamic-access:s.ts:6:1",
            "reason": "dynamic-access",
            "source": {
              "column": 1,
              "file": "s.ts",
              "line": 6,
            },
            "subject": "function:s.ts#b",
          },
          {
            "id": "unknown:unresolved-call:s.ts:5:3",
            "reason": "unresolved-call",
            "source": {
              "column": 3,
              "file": "s.ts",
              "line": 5,
            },
            "subject": "function:s.ts#a",
          },
          {
            "id": "unknown:unresolved-call:s.ts:7:3",
            "reason": "unresolved-call",
            "source": {
              "column": 3,
              "file": "s.ts",
              "line": 7,
            },
            "subject": "function:s.ts#k",
          },
          {
            "id": "unknown:unresolved-call:s.ts:8:3",
            "reason": "unresolved-call",
            "source": {
              "column": 3,
              "file": "s.ts",
              "line": 8,
            },
            "subject": "function:s.ts#m",
          },
        ],
      }
    `)
  })

  it("omits claims when none were derived, and lists no claim for any field", () => {
    const view = buildFlowGraphView({ flow: maximal().flow, claims: undefined })
    expect(view !== undefined && "claims" in view).toBe(false)
    expect(view?.fields.map((field) => field.claims)).toEqual([[], [], [], [], [], [], [], []])
  })

  it("matches a claim to a field by exact name or dotted prefix only", () => {
    const view = buildFlowGraphView(maximal())
    const byName = Object.fromEntries((view?.fields ?? []).map((f) => [f.name, f.claims]))
    expect(byName).toEqual({
      "cap.plain": [],
      "cap.returns": [],
      "cap.side": [],
      "cap.token": ["c5"],
      "cap.transforms": [],
      "cap.user": ["c1", "c2"],
      "cap.user2": [],
      "cap.writes": [],
    })
  })

  it("lists functions, fields and nodes in the order the model holds them (the model is ordered by id)", () => {
    const view = buildFlowGraphView(maximal())
    expect(view?.functions.map((f) => f.name)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "k",
      "m",
      "r",
      "s",
      "t",
      "w",
      "x",
    ])
    expect(view?.fields.map((f) => f.name)).toEqual([
      "cap.plain",
      "cap.returns",
      "cap.side",
      "cap.token",
      "cap.transforms",
      "cap.user",
      "cap.user2",
      "cap.writes",
    ])
    expect(view?.nodes.map((n) => n.id)).toEqual(maximal().flow?.nodes.map((n) => n.id))
  })

  it("falls back to the id for a node the model does not hold, and never reads from or into one", () => {
    const base = maximal().flow
    if (base === undefined) throw new Error("no flow")
    const ghost = "function:ghost#x"
    const ghostField = "field:ghost#y"
    const ghostBoundary = "boundary:ghost#z"
    const extra: FlowEdgeInput[] = [
      { kind: "reads", from: ghost, to: fe, status: "static", path: ["r"], origin: fu },
      { kind: "passes", from: fe, to: ghost, status: "static", path: ["p"], origin: fu },
      { kind: "side-effect", from: fe, to: ghostBoundary, status: "static", origin: ghostField },
      { kind: "discards", from: fe, to: fu, status: "static", path: ["d"], origin: ghostField },
      { kind: "calls", from: fe, to: ghost, status: "static" },
      { kind: "calls", from: ghost, to: fe, status: "static" },
      { kind: "crosses-boundary", from: ghostBoundary, to: fn, status: "static" },
      { kind: "reads", from: fn, to: ghost, status: "static", path: [], origin: fn },
    ]
    const flow: FlowModel = {
      ...base,
      edges: [
        ...base.edges,
        ...extra.map((e) => ({
          ...e,
          id: flowEdgeId(e.kind, e.from, e.to, e.path, e.status, e.origin),
        })),
      ],
    }
    const view = buildFlowGraphView({ flow, claims: undefined })
    const e = view?.functions.find((f) => f.name === "e")
    expect(e).toMatchInlineSnapshot(`
      {
        "callees": [
          {
            "id": "function:ghost#x",
            "name": "function:ghost#x",
          },
        ],
        "callers": [
          {
            "id": "function:ghost#x",
            "name": "function:ghost#x",
          },
        ],
        "classifications": [
          "confidential",
        ],
        "confidence": "static",
        "discards": [
          {
            "field": "field:ghost#y",
            "origin": "field:ghost#y",
            "path": [
              "d",
            ],
          },
        ],
        "forwards": [
          {
            "field": "cap.user",
            "kind": "passes",
            "origin": "field:s.ts#cap.user",
            "path": [
              "p",
            ],
            "status": "static",
            "to": "function:ghost#x",
            "toName": "function:ghost#x",
          },
        ],
        "id": "function:s.ts#e",
        "inputs": [],
        "name": "e",
        "reads": [],
        "scope": "s.ts",
        "sideEffects": [
          {
            "boundary": "boundary:ghost#z",
            "boundaryName": "boundary:ghost#z",
            "field": "field:ghost#y",
            "origin": "field:ghost#y",
            "path": [],
            "status": "static",
          },
        ],
        "status": "declared",
        "unknowns": [],
      }
    `)
    const plain = view?.fields.find((f) => f.name === "cap.plain")
    expect(plain?.sources).toMatchInlineSnapshot(`
      [
        {
          "boundary": "boundary:ghost#z",
          "boundaryName": "boundary:ghost#z",
          "status": "static",
        },
      ]
    `)
    expect(plain?.readers).toMatchInlineSnapshot(`
      [
        {
          "function": "function:s.ts#d",
          "functionName": "d",
        },
        {
          "function": "function:s.ts#k",
          "functionName": "k",
        },
        {
          "function": "function:ghost#x",
          "functionName": "function:ghost#x",
        },
      ]
    `)
    expect(view?.fields.find((f) => f.name === "cap.user")?.discardedBy.slice(-1))
      .toMatchInlineSnapshot(`
      [
        {
          "function": "function:s.ts#c",
          "functionName": "c",
          "path": [
            "incoming",
          ],
        },
      ]
    `)
  })

  it("labels a node by kind", () => {
    const node = (over: Partial<FlowNode>): FlowNode => ({
      id: "x",
      kind: "function",
      scope: S,
      name: "a.b.c",
      status: "static",
      ...over,
    })
    expect([
      nodeLabel(node({})),
      nodeLabel(node({ kind: "field" })),
      nodeLabel(node({ kind: "return", name: "f#return" })),
      nodeLabel(node({ kind: "parameter" })),
      nodeLabel(node({ kind: "parameter", name: "plain" })),
      nodeLabel(node({ kind: "boundary", name: "n", boundaryKind: "queue" })),
      nodeLabel(node({ kind: "boundary", name: "n" })),
    ]).toEqual(["a.b.c", "a.b.c", "return", "c", "plain", "queue: n", "boundary: n"])
  })
})
