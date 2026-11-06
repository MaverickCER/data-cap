import { describe, expect, it } from "vitest"
import { buildProvDocument } from "../../src/evidence/flow-prov.js"
import type { ProvInput } from "../../src/evidence/flow-prov.js"
import { flowEdgeId, flowNodeId } from "../../src/flow/flow-model.js"
import type {
  FlowEdge,
  FlowEdgeKind,
  FlowModel,
  FlowNode,
  FlowNodeKind,
  FlowStatus,
} from "../../src/flow/flow-model.js"
import type { Claim } from "../../src/flow/claims-model.js"
import type { ObservationModel } from "../../src/flow/observation-model.js"

function node(
  kind: FlowNodeKind,
  scope: string,
  name: string,
  status: FlowStatus,
  extra: Partial<FlowNode> = {},
): FlowNode {
  return { kind, scope, name, status, id: flowNodeId(kind, scope, name), ...extra }
}

function edge(
  kind: FlowEdgeKind,
  from: string,
  to: string,
  status: FlowStatus,
  extra: Partial<FlowEdge> = {},
): FlowEdge {
  return { kind, from, to, status, id: flowEdgeId(kind, from, to, extra.path, status), ...extra }
}

function flowOf(nodes: readonly FlowNode[], edges: readonly FlowEdge[]): FlowModel {
  return {
    schemaVersion: 1,
    nodes,
    edges,
    unknowns: [],
    coverage: {
      functionsAnalyzed: 0,
      functionsUnanalyzed: 0,
      edgesUnresolved: 0,
      unknowns: 0,
      complete: true,
    },
  }
}

function claim(id: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    kind: "field-reaches-boundary",
    statement: `statement ${id}`,
    subject: "cap.user.email",
    object: "db",
    status: "static",
    verification: "verified",
    scope: { observationScopes: [], traceComplete: true },
    supporting: [],
    contradicting: [],
    derivedFrom: ["flow"],
    ...extra,
  }
}

const PROVENANCE = {
  generatedAt: "2026-01-02T03:04:05.000Z",
  toolVersion: "9.9.9",
  commit: "abc123",
}

describe("buildProvDocument exact mapping", () => {
  it("returns undefined without a flow", () => {
    expect(buildProvDocument({ ...base(), flow: undefined })).toBeUndefined()
  })

  it("maps every node kind, edge kind, observation and claim exactly", () => {
    const fnA = node("function", "a.ts", "fnA", "static")
    const fnB = node("function", "b.ts", "fnB", "unknown")
    const param = node("parameter", "a.ts", "fnA.input", "declared")
    const ret = node("return", "a.ts", "fnA.return", "inferred")
    const email = node("field", "cap", "cap.user.email", "declared", { classification: "pii" })
    const user = node("field", "cap", "cap.user", "static")
    const deep = node("field", "cap", "cap.user.email.domain", "static")
    const four = node("field", "cap", "cap.a", "static")
    const four3 = node("field", "cap", "cap.a.b", "static")
    const db = node("boundary", "boundary", "db", "static", {
      boundaryKind: "database",
      classification: "internal-only",
    })
    const dot = node("boundary", "boundary", "cap.user.email", "static")
    const flow = flowOf(
      [fnA, fnB, param, ret, email, user, deep, four, four3, db, dot],
      [
        edge("calls", fnA.id, fnB.id, "static"),
        edge("discards", fnA.id, email.id, "static", { path: ["email"], handling: "masked" }),
        edge("reads", email.id, fnA.id, "declared", { path: ["a", "b"] }),
        edge("writes", fnA.id, db.id, "inferred", { handling: "hashed" }),
        edge("transforms", email.id, user.id, "static", { path: [] }),
        edge("passes", fnA.id, fnB.id, "static"),
        edge("reads", "missing-from", fnA.id, "static"),
        edge("reads", email.id, "missing-to", "static"),
        edge("reads", param.id, fnB.id, "static"),
        edge("returns", fnB.id, ret.id, "static"),
      ],
    )
    const observation: ObservationModel = {
      schemaVersion: 1,
      scopes: ["s1", "s2"],
      skipped: 0,
      observations: [
        {
          id: "obs-1",
          scope: "s1",
          boundary: { kind: "database", name: "db" },
          field: "cap.user.email",
          count: 3,
          status: "observed",
        },
        {
          id: "obs-2",
          scope: "s2",
          boundary: { kind: "log", name: "stdout" },
          field: "cap.user",
          handling: "redacted",
          count: 1,
          status: "observed",
        },
      ],
    }
    const claims = {
      schemaVersion: 1 as const,
      summary: {
        verified: 0,
        inferred: 0,
        unobserved: 0,
        contradicted: 0,
        "observed-only": 0,
        indeterminate: 0,
      },
      claims: [
        claim("c-exact", {
          supporting: [
            { model: "observation", id: "obs-1" },
            { model: "flow", id: "obs-2" },
            { model: "observation", id: "obs-missing" },
          ],
          contradicting: [{ model: "observation", id: "obs-2" }],
          scope: { observationScopes: ["s1"], traceComplete: false },
          verification: "contradicted",
          status: "observed",
        }),
        claim("c-deep", { subject: "cap.user.email.domain.x", object: "nowhere" }),
        claim("c-prefix", { subject: "cap.a.b.c", object: "db" }),
        claim("c-policy", {
          kind: "policy-holds",
          subject: "cap.user.email",
          object: "cap.user.email",
        }),
        claim("c-field-object", { subject: "cap.user.email", object: "cap.user" }),
        claim("c-none", { subject: "zzz", object: "db" }),
        claim("c-sourced", {
          kind: "field-sourced-from-boundary",
          subject: "cap.user",
          object: "db",
        }),
      ],
    }
    const result = buildProvDocument({ flow, claims, observation, provenance: PROVENANCE })
    expect(result).toMatchInlineSnapshot(`
      {
        "activity": {
          "dc:analysis": {
            "dc:commit": "abc123",
            "prov:endTime": {
              "$": "2026-01-02T03:04:05.000Z",
              "type": "xsd:dateTime",
            },
            "prov:startTime": {
              "$": "2026-01-02T03:04:05.000Z",
              "type": "xsd:dateTime",
            },
            "prov:type": "dc:Analysis",
          },
          "dc:function%2Ffunction%3Aa.ts%23fnA": {
            "dc:name": "fnA",
            "dc:scope": "a.ts",
            "dc:status": "static",
            "prov:type": "dc:Function",
          },
          "dc:function%2Ffunction%3Ab.ts%23fnB": {
            "dc:name": "fnB",
            "dc:scope": "b.ts",
            "dc:status": "unknown",
            "prov:type": "dc:Function",
          },
          "dc:scope%2Fs1": {
            "dc:name": "s1",
            "prov:type": "dc:ObservationScope",
          },
          "dc:scope%2Fs2": {
            "dc:name": "s2",
            "prov:type": "dc:ObservationScope",
          },
        },
        "agent": {
          "dc:tool": {
            "dc:name": "data-cap",
            "dc:version": "9.9.9",
            "prov:type": "prov:SoftwareAgent",
          },
        },
        "entity": {
          "dc:boundary%2Fboundary%3Aboundary%23cap.user.email": {
            "dc:name": "cap.user.email",
            "dc:scope": "boundary",
            "dc:status": "static",
            "prov:type": "dc:Boundary",
          },
          "dc:boundary%2Fboundary%3Aboundary%23db": {
            "dc:boundaryKind": "database",
            "dc:classification": "internal-only",
            "dc:name": "db",
            "dc:scope": "boundary",
            "dc:status": "static",
            "prov:type": "dc:Boundary",
          },
          "dc:claim%2Fc-deep": {
            "dc:kind": "field-reaches-boundary",
            "dc:statement": "statement c-deep",
            "dc:status": "static",
            "dc:traceComplete": true,
            "dc:verification": "verified",
            "prov:type": "dc:Claim",
          },
          "dc:claim%2Fc-exact": {
            "dc:kind": "field-reaches-boundary",
            "dc:statement": "statement c-exact",
            "dc:status": "observed",
            "dc:traceComplete": false,
            "dc:verification": "contradicted",
            "prov:type": "dc:Claim",
          },
          "dc:claim%2Fc-field-object": {
            "dc:kind": "field-reaches-boundary",
            "dc:statement": "statement c-field-object",
            "dc:status": "static",
            "dc:traceComplete": true,
            "dc:verification": "verified",
            "prov:type": "dc:Claim",
          },
          "dc:claim%2Fc-none": {
            "dc:kind": "field-reaches-boundary",
            "dc:statement": "statement c-none",
            "dc:status": "static",
            "dc:traceComplete": true,
            "dc:verification": "verified",
            "prov:type": "dc:Claim",
          },
          "dc:claim%2Fc-policy": {
            "dc:kind": "policy-holds",
            "dc:statement": "statement c-policy",
            "dc:status": "static",
            "dc:traceComplete": true,
            "dc:verification": "verified",
            "prov:type": "dc:Claim",
          },
          "dc:claim%2Fc-prefix": {
            "dc:kind": "field-reaches-boundary",
            "dc:statement": "statement c-prefix",
            "dc:status": "static",
            "dc:traceComplete": true,
            "dc:verification": "verified",
            "prov:type": "dc:Claim",
          },
          "dc:claim%2Fc-sourced": {
            "dc:kind": "field-sourced-from-boundary",
            "dc:statement": "statement c-sourced",
            "dc:status": "static",
            "dc:traceComplete": true,
            "dc:verification": "verified",
            "prov:type": "dc:Claim",
          },
          "dc:field%2Ffield%3Acap%23cap.a": {
            "dc:name": "cap.a",
            "dc:scope": "cap",
            "dc:status": "static",
            "prov:type": "dc:Field",
          },
          "dc:field%2Ffield%3Acap%23cap.a.b": {
            "dc:name": "cap.a.b",
            "dc:scope": "cap",
            "dc:status": "static",
            "prov:type": "dc:Field",
          },
          "dc:field%2Ffield%3Acap%23cap.user": {
            "dc:name": "cap.user",
            "dc:scope": "cap",
            "dc:status": "static",
            "prov:type": "dc:Field",
          },
          "dc:field%2Ffield%3Acap%23cap.user.email": {
            "dc:classification": "pii",
            "dc:name": "cap.user.email",
            "dc:scope": "cap",
            "dc:status": "declared",
            "prov:type": "dc:Field",
          },
          "dc:field%2Ffield%3Acap%23cap.user.email.domain": {
            "dc:name": "cap.user.email.domain",
            "dc:scope": "cap",
            "dc:status": "static",
            "prov:type": "dc:Field",
          },
          "dc:observation%2Fobs-1": {
            "dc:boundary": "database:db",
            "dc:count": 3,
            "dc:field": "cap.user.email",
            "dc:status": "observed",
            "prov:type": "dc:Observation",
          },
          "dc:observation%2Fobs-2": {
            "dc:boundary": "log:stdout",
            "dc:count": 1,
            "dc:field": "cap.user",
            "dc:handling": "redacted",
            "dc:status": "observed",
            "prov:type": "dc:Observation",
          },
          "dc:parameter%2Fparameter%3Aa.ts%23fnA.input": {
            "dc:name": "fnA.input",
            "dc:scope": "a.ts",
            "dc:status": "declared",
            "prov:type": "dc:Parameter",
          },
          "dc:return%2Freturn%3Aa.ts%23fnA.return": {
            "dc:name": "fnA.return",
            "dc:scope": "a.ts",
            "dc:status": "inferred",
            "prov:type": "dc:ReturnValue",
          },
        },
        "prefix": {
          "dc": "urn:data-cap:ns:",
          "prov": "http://www.w3.org/ns/prov#",
          "xsd": "http://www.w3.org/2001/XMLSchema#",
        },
        "used": {
          "_:r000001": {
            "dc:edge": "discards:function:a.ts#fnA->field:cap#cap.user.email:email@static",
            "dc:handling": "masked",
            "dc:kind": "discards",
            "dc:path": "email",
            "dc:role": "discarded",
            "dc:status": "static",
            "prov:activity": "dc:function%2Ffunction%3Aa.ts%23fnA",
            "prov:entity": "dc:field%2Ffield%3Acap%23cap.user.email",
          },
          "_:r000002": {
            "dc:edge": "reads:field:cap#cap.user.email->function:a.ts#fnA:a.b@declared",
            "dc:kind": "reads",
            "dc:path": "a.b",
            "dc:status": "declared",
            "prov:activity": "dc:function%2Ffunction%3Aa.ts%23fnA",
            "prov:entity": "dc:field%2Ffield%3Acap%23cap.user.email",
          },
          "_:r000003": {
            "dc:edge": "reads:parameter:a.ts#fnA.input->function:b.ts#fnB@static",
            "dc:kind": "reads",
            "dc:status": "static",
            "prov:activity": "dc:function%2Ffunction%3Ab.ts%23fnB",
            "prov:entity": "dc:parameter%2Fparameter%3Aa.ts%23fnA.input",
          },
        },
        "wasAssociatedWith": {
          "_:r000001": {
            "prov:activity": "dc:analysis",
            "prov:agent": "dc:tool",
          },
        },
        "wasDerivedFrom": {
          "_:r000001": {
            "dc:edge": "transforms:field:cap#cap.user.email->field:cap#cap.user:@static",
            "dc:kind": "transforms",
            "dc:path": "",
            "dc:status": "static",
            "prov:generatedEntity": "dc:field%2Ffield%3Acap%23cap.user",
            "prov:usedEntity": "dc:field%2Ffield%3Acap%23cap.user.email",
          },
          "_:r000002": {
            "dc:role": "subject",
            "prov:generatedEntity": "dc:claim%2Fc-exact",
            "prov:usedEntity": "dc:field%2Ffield%3Acap%23cap.user.email",
          },
          "_:r000003": {
            "dc:role": "object",
            "prov:generatedEntity": "dc:claim%2Fc-exact",
            "prov:usedEntity": "dc:boundary%2Fboundary%3Aboundary%23db",
          },
          "_:r000004": {
            "dc:role": "supporting",
            "prov:generatedEntity": "dc:claim%2Fc-exact",
            "prov:usedEntity": "dc:observation%2Fobs-1",
          },
          "_:r000005": {
            "dc:role": "contradicting",
            "prov:generatedEntity": "dc:claim%2Fc-exact",
            "prov:usedEntity": "dc:observation%2Fobs-2",
          },
          "_:r000006": {
            "dc:role": "subject",
            "prov:generatedEntity": "dc:claim%2Fc-deep",
            "prov:usedEntity": "dc:field%2Ffield%3Acap%23cap.user",
          },
          "_:r000007": {
            "dc:role": "subject",
            "prov:generatedEntity": "dc:claim%2Fc-prefix",
            "prov:usedEntity": "dc:field%2Ffield%3Acap%23cap.a",
          },
          "_:r000008": {
            "dc:role": "object",
            "prov:generatedEntity": "dc:claim%2Fc-prefix",
            "prov:usedEntity": "dc:boundary%2Fboundary%3Aboundary%23db",
          },
          "_:r000009": {
            "dc:role": "subject",
            "prov:generatedEntity": "dc:claim%2Fc-policy",
            "prov:usedEntity": "dc:field%2Ffield%3Acap%23cap.user.email",
          },
          "_:r000010": {
            "dc:role": "subject",
            "prov:generatedEntity": "dc:claim%2Fc-field-object",
            "prov:usedEntity": "dc:field%2Ffield%3Acap%23cap.user.email",
          },
          "_:r000011": {
            "dc:role": "object",
            "prov:generatedEntity": "dc:claim%2Fc-none",
            "prov:usedEntity": "dc:boundary%2Fboundary%3Aboundary%23db",
          },
          "_:r000012": {
            "dc:role": "subject",
            "prov:generatedEntity": "dc:claim%2Fc-sourced",
            "prov:usedEntity": "dc:field%2Ffield%3Acap%23cap.user",
          },
        },
        "wasGeneratedBy": {
          "_:r000001": {
            "dc:edge": "writes:function:a.ts#fnA->boundary:boundary#db@inferred",
            "dc:handling": "hashed",
            "dc:kind": "writes",
            "dc:status": "inferred",
            "prov:activity": "dc:function%2Ffunction%3Aa.ts%23fnA",
            "prov:entity": "dc:boundary%2Fboundary%3Aboundary%23db",
          },
          "_:r000002": {
            "dc:edge": "returns:function:b.ts#fnB->return:a.ts#fnA.return@static",
            "dc:kind": "returns",
            "dc:status": "static",
            "prov:activity": "dc:function%2Ffunction%3Ab.ts%23fnB",
            "prov:entity": "dc:return%2Freturn%3Aa.ts%23fnA.return",
          },
          "_:r000003": {
            "prov:activity": "dc:scope%2Fs1",
            "prov:entity": "dc:observation%2Fobs-1",
          },
          "_:r000004": {
            "prov:activity": "dc:scope%2Fs2",
            "prov:entity": "dc:observation%2Fobs-2",
          },
          "_:r000005": {
            "prov:activity": "dc:analysis",
            "prov:entity": "dc:claim%2Fc-exact",
          },
          "_:r000006": {
            "prov:activity": "dc:analysis",
            "prov:entity": "dc:claim%2Fc-deep",
          },
          "_:r000007": {
            "prov:activity": "dc:analysis",
            "prov:entity": "dc:claim%2Fc-prefix",
          },
          "_:r000008": {
            "prov:activity": "dc:analysis",
            "prov:entity": "dc:claim%2Fc-policy",
          },
          "_:r000009": {
            "prov:activity": "dc:analysis",
            "prov:entity": "dc:claim%2Fc-field-object",
          },
          "_:r000010": {
            "prov:activity": "dc:analysis",
            "prov:entity": "dc:claim%2Fc-none",
          },
          "_:r000011": {
            "prov:activity": "dc:analysis",
            "prov:entity": "dc:claim%2Fc-sourced",
          },
        },
        "wasInformedBy": {
          "_:r000001": {
            "dc:edge": "calls:function:a.ts#fnA->function:b.ts#fnB@static",
            "dc:kind": "calls",
            "dc:status": "static",
            "prov:informant": "dc:function%2Ffunction%3Aa.ts%23fnA",
            "prov:informed": "dc:function%2Ffunction%3Ab.ts%23fnB",
          },
        },
      }
    `)
  })

  it("omits empty relation sections and optional attributes", () => {
    const fn = node("function", "a.ts", "f", "static")
    const doc = buildProvDocument({
      ...base(),
      flow: flowOf([fn], []),
      provenance: { ...PROVENANCE, commit: undefined },
    })
    expect(doc).toMatchInlineSnapshot(`
      {
        "activity": {
          "dc:analysis": {
            "prov:endTime": {
              "$": "2026-01-02T03:04:05.000Z",
              "type": "xsd:dateTime",
            },
            "prov:startTime": {
              "$": "2026-01-02T03:04:05.000Z",
              "type": "xsd:dateTime",
            },
            "prov:type": "dc:Analysis",
          },
          "dc:function%2Ffunction%3Aa.ts%23f": {
            "dc:name": "f",
            "dc:scope": "a.ts",
            "dc:status": "static",
            "prov:type": "dc:Function",
          },
        },
        "agent": {
          "dc:tool": {
            "dc:name": "data-cap",
            "dc:version": "9.9.9",
            "prov:type": "prov:SoftwareAgent",
          },
        },
        "entity": {},
        "prefix": {
          "dc": "urn:data-cap:ns:",
          "prov": "http://www.w3.org/ns/prov#",
          "xsd": "http://www.w3.org/2001/XMLSchema#",
        },
        "wasAssociatedWith": {
          "_:r000001": {
            "prov:activity": "dc:analysis",
            "prov:agent": "dc:tool",
          },
        },
      }
    `)
  })

  it("percent-encodes qualified names and protects trailing dots", () => {
    const odd = node("field", "s c/o!p'e(n)*", "x.", "static")
    const dots = node("field", "d", "..", "static")
    const doc = buildProvDocument({ ...base(), flow: flowOf([odd, dots], []) })
    expect(Object.keys(doc?.entity ?? {})).toMatchInlineSnapshot(`
      [
        "dc:field%2Ffield%3As%20c%2Fo%21p%27e%28n%29%2A%23x%2E",
        "dc:field%2Ffield%3Ad%23.%2E",
      ]
    `)
  })

  it("numbers relations with six digits", () => {
    const a = node("field", "s", "a", "static")
    const b = node("field", "s", "b", "static")
    const edges = Array.from({ length: 12 }, (_, i) =>
      edge("transforms", a.id, b.id, "static", { path: [String(i)] }),
    )
    const doc = buildProvDocument({ ...base(), flow: flowOf([a, b], edges) })
    expect(Object.keys(doc?.wasDerivedFrom ?? {})).toMatchInlineSnapshot(`
      [
        "_:r000001",
        "_:r000002",
        "_:r000003",
        "_:r000004",
        "_:r000005",
        "_:r000006",
        "_:r000007",
        "_:r000008",
        "_:r000009",
        "_:r000010",
        "_:r000011",
        "_:r000012",
      ]
    `)
  })
})

function base(): ProvInput {
  return {
    flow: undefined,
    claims: undefined,
    observation: undefined,
    provenance: PROVENANCE,
  }
}
