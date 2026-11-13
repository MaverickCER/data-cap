import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import addFormats from "ajv-formats"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildCycloneDxBom, renderFlowCycloneDx } from "../../src/evidence/flow-cyclonedx.js"
import type { CycloneDxBom } from "../../src/evidence/flow-cyclonedx.js"
import type { EvidenceModel } from "../../src/build/evidence-model.js"
import type { FlowEdge } from "../../src/flow/flow-model.js"
import { profileFixture } from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const standard = (name: string): object =>
  JSON.parse(readFileSync(path.join(here, "../fixtures/standards", name), "utf8")) as object

/** Validates against the official CycloneDX 1.6 JSON schema (draft-07), with its two referenced schemas registered. */
function validator() {
  const ajv = new Ajv({ strict: false, allErrors: true })
  addFormats(ajv)
  ajv.addSchema(standard("spdx.schema.json"))
  ajv.addSchema(standard("jsf-0.82.schema.json"))
  return ajv.compile(standard("bom-1.6.schema.json"))
}

function expectValid(bom: unknown): void {
  const validate = validator()
  const ok = validate(bom)
  if (!ok) console.error(JSON.stringify(validate.errors?.slice(0, 6), null, 1))
  expect(ok).toBe(true)
}

describe("buildCycloneDxBom", () => {
  let fixture: FlowEvidenceFixture
  let bom: CycloneDxBom

  beforeAll(async () => {
    fixture = await profileFixture({
      observations: [
        {
          scope: "scenario:profile",
          boundary: { kind: "client-response", name: "http-response" },
          field: "userData.user.email",
        },
        {
          scope: "scenario:profile",
          boundary: { kind: "log", name: "audit-log" },
          field: "userData.user.role",
        },
      ],
    })
    bom = buildCycloneDxBom(fixture.evidence)!
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  const services = () => bom.services ?? []
  const named = (name: string) => {
    const found = services().find((service) => service.name === name)
    if (found === undefined) throw new Error(`no service ${name}`)
    return found
  }
  const notObserved = <T extends { description?: string }>(entries: readonly T[] | undefined) =>
    (entries ?? []).filter((entry) => !(entry.description ?? "").includes("status: observed"))
  interface FlowDetail {
    field: string
    flow: string
    peer: string
    status: string
    paths: string[]
    handling: string[]
    edges?: number
    scopes?: string[]
    count?: number
  }
  const details = (owner: Parameters<typeof prop>[0]) =>
    prop(owner, "data-cap:data-flow").map((value) => JSON.parse(value) as FlowDetail)
  const prop = (owner: { properties?: readonly { name: string; value: string }[] }, name: string) =>
    (owner.properties ?? []).filter((p) => p.name === name).map((p) => p.value)

  it("renders the exact BOM for the profile fixture", () => {
    const pinned = {
      ...fixture.evidence,
      provenance: { ...fixture.evidence.provenance, toolVersion: "0.0.0-test" },
    }
    expect(JSON.parse(renderFlowCycloneDx(pinned)!)).toMatchInlineSnapshot(`
      {
        "annotations": [
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-81f8d53b-1c34-5aae-9c37-4ee1690f6330",
            "subjects": [
              "data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
            ],
            "text": "claim contradicted: Rule userData/no-password-to-client holds for userData.user (data-cap:status=static; trace complete)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-1188e0e8-71ad-5f96-97fa-fb3bab65e22c",
            "subjects": [
              "data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
            ],
            "text": "claim contradicted: Rule userData/no-role-to-log holds for userData.user (data-cap:status=static; trace complete)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-753f640b-ff32-5d53-b9cc-c69ce26d295b",
            "subjects": [
              "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
            ],
            "text": "claim observed-only: userData.user.role reaches log audit-log (data-cap:status=observed; trace not complete)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-23bc2c32-5033-5fa2-bbeb-32976862aaad",
            "subjects": [
              "data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
            ],
            "text": "claim unobserved: userData.user is sourced from database postgres:users (data-cap:status=declared; trace complete)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-8aeb9a97-0376-5c7e-aa3e-10ca8d08b5c4",
            "subjects": [
              "data-cap-boundary-c00f3124-7bf6-52ab-bc4e-7f63220cde0a",
              "data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
            ],
            "text": "policy violated: userData/no-password-to-client for userData.user reaching http-response (data-cap:status=static)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-b6e8d480-6a12-514d-9390-fdf879dc6ce3",
            "subjects": [
              "data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
            ],
            "text": "unknown: unresolved-call at app/track.ts:5:3 (data-cap:status=unknown) -- call target is not a project function. Data that entered it: userData.user: email.",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
        ],
        "bomFormat": "CycloneDX",
        "metadata": {
          "component": {
            "bom-ref": "data-cap-subject-2ef60ff8-5b55-576a-af24-458b4667ccc9",
            "name": "data-cap data-flow",
            "type": "application",
          },
          "properties": [
            {
              "name": "data-cap:disclaimer",
              "value": "Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.",
            },
            {
              "name": "data-cap:coverage.complete",
              "value": "false",
            },
            {
              "name": "data-cap:coverage.functionsAnalyzed",
              "value": "5",
            },
            {
              "name": "data-cap:coverage.functionsUnanalyzed",
              "value": "0",
            },
            {
              "name": "data-cap:coverage.edgesUnresolved",
              "value": "0",
            },
            {
              "name": "data-cap:coverage.unknowns",
              "value": "1",
            },
            {
              "name": "data-cap:commit",
              "value": "0123456789abcdef0123456789abcdef01234567",
            },
            {
              "name": "data-cap:policy.satisfied",
              "value": "1",
            },
            {
              "name": "data-cap:policy.violated",
              "value": "1",
            },
            {
              "name": "data-cap:policy.indeterminate",
              "value": "0",
            },
            {
              "name": "data-cap:claims.verified",
              "value": "1",
            },
            {
              "name": "data-cap:claims.inferred",
              "value": "0",
            },
            {
              "name": "data-cap:claims.unobserved",
              "value": "1",
            },
            {
              "name": "data-cap:claims.contradicted",
              "value": "2",
            },
            {
              "name": "data-cap:claims.observed-only",
              "value": "1",
            },
            {
              "name": "data-cap:claims.indeterminate",
              "value": "0",
            },
            {
              "name": "data-cap:observation.scopes",
              "value": "1",
            },
            {
              "name": "data-cap:observation.skipped",
              "value": "0",
            },
          ],
          "timestamp": "2026-01-01T00:00:00.000Z",
          "tools": {
            "components": [
              {
                "bom-ref": "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            ],
          },
        },
        "serialNumber": "urn:uuid:606d75f5-12f3-5696-b446-637fa5818ee0",
        "services": [
          {
            "bom-ref": "data-cap-boundary-b97a3d34-5007-52c8-89a7-6dc13519a7eb",
            "data": [
              {
                "classification": "confidential",
                "description": "status: observed; paths: role; observed 1 time(s) in scenario:profile",
                "destination": [
                  "urn:cdx:606d75f5-12f3-5696-b446-637fa5818ee0/1#data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "platform",
                      },
                    },
                  ],
                },
                "name": "userData.user",
              },
            ],
            "description": "Data boundary (log) seen only at runtime.",
            "name": "audit-log",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "boundary",
              },
              {
                "name": "data-cap:status",
                "value": "observed",
              },
              {
                "name": "data-cap:node-id",
                "value": "observed:log:audit-log",
              },
              {
                "name": "data-cap:boundary-kind",
                "value": "log",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"userData.user","flow":"unknown","peer":"features/user.ts","status":"observed","paths":["role"],"handling":[],"scopes":["scenario:profile"],"count":1}",
              },
            ],
          },
          {
            "bom-ref": "data-cap-boundary-c00f3124-7bf6-52ab-bc4e-7f63220cde0a",
            "data": [
              {
                "classification": "confidential",
                "description": "status: static; paths: (whole), email, id, name; 4 edge(s)",
                "flow": "inbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "platform",
                      },
                    },
                  ],
                },
                "name": "userData.user",
                "source": [
                  "urn:cdx:606d75f5-12f3-5696-b446-637fa5818ee0/1#data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
                ],
              },
              {
                "classification": "confidential",
                "description": "status: observed; paths: email; observed 1 time(s) in scenario:profile",
                "destination": [
                  "urn:cdx:606d75f5-12f3-5696-b446-637fa5818ee0/1#data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "platform",
                      },
                    },
                  ],
                },
                "name": "userData.user",
              },
            ],
            "description": "Data boundary (client-response).",
            "name": "http-response",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "boundary",
              },
              {
                "name": "data-cap:status",
                "value": "static",
              },
              {
                "name": "data-cap:node-id",
                "value": "boundary:boundary:code#http-response",
              },
              {
                "name": "data-cap:boundary-kind",
                "value": "client-response",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"userData.user","flow":"inbound","peer":"features/user.ts","status":"static","paths":["(whole)","email","id","name"],"handling":[],"edges":4}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"userData.user","flow":"unknown","peer":"features/user.ts","status":"observed","paths":["email"],"handling":[],"scopes":["scenario:profile"],"count":1}",
              },
            ],
          },
          {
            "bom-ref": "data-cap-boundary-c511189b-9614-5dc9-ad8c-cf1b7107e7a0",
            "data": [
              {
                "classification": "confidential",
                "description": "status: declared; paths: (whole); 1 edge(s)",
                "destination": [
                  "urn:cdx:606d75f5-12f3-5696-b446-637fa5818ee0/1#data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
                ],
                "flow": "outbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "platform",
                      },
                    },
                  ],
                },
                "name": "userData.user",
              },
            ],
            "description": "Data boundary (database).",
            "name": "postgres:users",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "boundary",
              },
              {
                "name": "data-cap:status",
                "value": "declared",
              },
              {
                "name": "data-cap:node-id",
                "value": "boundary:boundary#postgres:users",
              },
              {
                "name": "data-cap:boundary-kind",
                "value": "database",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"userData.user","flow":"outbound","peer":"features/user.ts","status":"declared","paths":["(whole)"],"handling":[],"edges":1}",
              },
            ],
          },
          {
            "bom-ref": "data-cap-component-f09dbd90-8f68-5917-9fec-0d469ec69743",
            "data": [
              {
                "classification": "confidential",
                "description": "status: declared; paths: (whole); 1 edge(s)",
                "flow": "inbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "platform",
                      },
                    },
                  ],
                },
                "name": "userData.user",
                "source": [
                  "urn:cdx:606d75f5-12f3-5696-b446-637fa5818ee0/1#data-cap-boundary-c511189b-9614-5dc9-ad8c-cf1b7107e7a0",
                ],
              },
              {
                "classification": "confidential",
                "description": "status: static; paths: (whole), email, id, name; 4 edge(s)",
                "destination": [
                  "urn:cdx:606d75f5-12f3-5696-b446-637fa5818ee0/1#data-cap-boundary-c00f3124-7bf6-52ab-bc4e-7f63220cde0a",
                ],
                "flow": "outbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "platform",
                      },
                    },
                  ],
                },
                "name": "userData.user",
              },
              {
                "classification": "confidential",
                "description": "status: observed; paths: role; observed 1 time(s) in scenario:profile",
                "destination": [
                  "urn:cdx:606d75f5-12f3-5696-b446-637fa5818ee0/1#data-cap-boundary-b97a3d34-5007-52c8-89a7-6dc13519a7eb",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "platform",
                      },
                    },
                  ],
                },
                "name": "userData.user",
              },
              {
                "classification": "confidential",
                "description": "status: observed; paths: email; observed 1 time(s) in scenario:profile",
                "destination": [
                  "urn:cdx:606d75f5-12f3-5696-b446-637fa5818ee0/1#data-cap-boundary-c00f3124-7bf6-52ab-bc4e-7f63220cde0a",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "platform",
                      },
                    },
                  ],
                },
                "name": "userData.user",
              },
            ],
            "description": "Capability-owning component: declares the fields listed in data-cap:field.",
            "name": "features/user.ts",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "component",
              },
              {
                "name": "data-cap:status",
                "value": "static",
              },
              {
                "name": "data-cap:node-id",
                "value": "features/user.ts",
              },
              {
                "name": "data-cap:field",
                "value": "userData.user",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"userData.user","flow":"inbound","peer":"postgres:users","status":"declared","paths":["(whole)"],"handling":[],"edges":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"userData.user","flow":"outbound","peer":"http-response","status":"static","paths":["(whole)","email","id","name"],"handling":[],"edges":4}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"userData.user","flow":"unknown","peer":"audit-log","status":"observed","paths":["role"],"handling":[],"scopes":["scenario:profile"],"count":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"userData.user","flow":"unknown","peer":"http-response","status":"observed","paths":["email"],"handling":[],"scopes":["scenario:profile"],"count":1}",
              },
            ],
          },
        ],
        "specVersion": "1.6",
        "version": 1,
      }
    `)
  })

  it("renders the exact BOM for a hand-built flow that reaches every branch", () => {
    const field = (scope: string, name: string, classification?: string, status = "static") => ({
      kind: "field",
      scope,
      name,
      status,
      id: `field:${scope}#${name}`,
      ...(classification === undefined ? {} : { classification }),
    })
    const boundary = (name: string, boundaryKind?: string) => ({
      kind: "boundary",
      scope: "boundary",
      name,
      status: "static",
      id: `boundary:boundary#${name}`,
      ...(boundaryKind === undefined ? {} : { boundaryKind }),
    })
    const alpha = field("a.ts", "alpha.user", "confidential")
    const exact = field("a.ts", "alpha")
    const idle = field("a.ts", "alpha.idle", undefined, "declared")
    const lookalike = field("a.ts", "alphaX.user")
    const elsewhere = field("b.ts", "alpha.user")
    const db = boundary("db", "database")
    const mystery = boundary("mystery")
    const quiet = boundary("quiet", "queue")
    const go = {
      kind: "function",
      scope: "a.ts",
      name: "go",
      status: "static",
      id: "function:a.ts#go",
    }
    const edge = (
      kind: string,
      from: { id: string },
      to: { id: string },
      extra: Record<string, unknown> = {},
    ) => ({
      kind,
      from: from.id,
      to: to.id,
      status: "static",
      id: `${kind}:${from.id}->${to.id}`,
      ...extra,
    })
    const at = { file: "a.ts", line: 3, column: 5 }
    const evidence = {
      ...fixture.evidence,
      provenance: { ...fixture.evidence.provenance, toolVersion: "0.0.0-test", commit: undefined },
      capability: {
        capabilities: [
          { file: "a.ts", exportName: "alpha", docs: { owner: "team-a" } },
          { file: "b.ts", exportName: "alpha" },
        ],
      },
      flow: {
        schemaVersion: 1,
        nodes: [alpha, exact, idle, lookalike, elsewhere, db, mystery, quiet, go],
        edges: [
          edge("writes", alpha, db, {
            path: ["profile", "email"],
            handling: "hashed",
            origin: alpha.id,
          }),
          edge("writes", alpha, db, { path: [], handling: "hashed", origin: alpha.id, id: "w2" }),
          edge("writes", alpha, db, { origin: alpha.id, id: "w3" }),
          edge("reads", db, lookalike, { status: "declared", origin: lookalike.id }),
          edge("calls", go, db, { origin: alpha.id }),
          edge("discards", alpha, mystery, { origin: alpha.id }),
          edge("writes", alpha, mystery),
          edge("writes", exact, db, { origin: exact.id, id: "w4" }),
          edge("writes", alpha, { id: "field:ghost#absent" }, { origin: alpha.id, id: "w5" }),
          edge("writes", go, mystery, { origin: "field:ghost#x", id: "ghost" }),
          edge("writes", elsewhere, go, { origin: elsewhere.id }),
          edge("writes", elsewhere, mystery, { origin: elsewhere.id }),
        ],
        unknowns: [
          {
            id: "u1",
            reason: "dynamic-access",
            source: at,
            detail: "computed key",
            data: [
              { origin: alpha.id, path: ["email"] },
              { origin: alpha.id, path: [] },
              { origin: "field:ghost#x", path: [] },
            ],
          },
          { id: "u2", reason: "unresolved-call", source: at },
          { id: "u3", reason: "unresolved-call", source: at, data: [] },
          {
            id: "u4",
            reason: "unresolved-call",
            source: at,
            data: [{ origin: "field:ghost#y", path: [] }],
          },
        ],
        coverage: {
          functionsAnalyzed: 4,
          functionsUnanalyzed: 1,
          edgesUnresolved: 2,
          unknowns: 4,
          complete: false,
        },
      },
      policy: {
        summary: { satisfied: 1, violated: 2, indeterminate: 1 },
        results: [
          { ruleId: "ok", outcome: "satisfied", basis: "static", edges: [] },
          {
            ruleId: "r1",
            subject: alpha.id,
            boundary: db.id,
            outcome: "violated",
            basis: "static",
            edges: [],
          },
          {
            ruleId: "r2",
            outcome: "indeterminate",
            reason: "unknown-flow",
            basis: "unknown",
            edges: [],
          },
          {
            ruleId: "r3",
            subject: "field:ghost#z",
            boundary: "boundary:boundary#nowhere",
            outcome: "violated",
            basis: "declared",
            edges: [],
          },
        ],
      },
      claims: {
        summary: { verified: 1, contradicted: 2 },
        claims: [
          {
            statement: "fine",
            verification: "verified",
            subject: "alpha.user",
            status: "static",
            scope: { traceComplete: true },
          },
          {
            statement: "bad",
            verification: "contradicted",
            subject: "alpha.user",
            status: "static",
            scope: { traceComplete: true },
          },
          {
            statement: "bad",
            verification: "contradicted",
            subject: "nobody",
            status: "declared",
            scope: { traceComplete: false },
          },
          {
            statement: "bad",
            verification: "contradicted",
            subject: "nobody",
            status: "declared",
            scope: { traceComplete: false },
          },
        ],
      },
      observation: {
        scopes: ["s1", "s2"],
        skipped: 3,
        observations: [
          {
            scope: "s1",
            boundary: { kind: "database", name: "db" },
            field: "alpha.user",
            handling: "plaintext",
            count: 2,
          },
          {
            scope: "s2",
            boundary: { kind: "database", name: "db" },
            field: "alpha.user.name",
            count: 1,
          },
          { scope: "s1", boundary: { kind: "log", name: "db" }, field: "alpha.user", count: 1 },
          { scope: "s2", boundary: { kind: "queue", name: "mystery" }, field: "zeta.q", count: 4 },
          { scope: "s1", boundary: { kind: "queue", name: "mystery" }, field: "zeta.q", count: 3 },
        ],
      },
    } as unknown as EvidenceModel
    expect(buildCycloneDxBom(evidence, { name: "Hand-built" })).toMatchInlineSnapshot(`
      {
        "annotations": [
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-0bd7daed-d633-5aa2-a5e2-5773b20b93fb",
            "subjects": [
              "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
            ],
            "text": "claim contradicted: bad (data-cap:status=declared; trace not complete)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-4f179e7d-d51f-51f2-9e36-34d286a3ca16",
            "subjects": [
              "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
            ],
            "text": "claim contradicted: bad (data-cap:status=declared; trace not complete)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-3be58b43-883d-5d81-80a3-69d740220b2b",
            "subjects": [
              "data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
            ],
            "text": "claim contradicted: bad (data-cap:status=static; trace complete)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-0a28810e-c0ec-52ae-a15d-c15c8d2a3ae1",
            "subjects": [
              "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
            ],
            "text": "policy indeterminate: r2 for no field (data-cap:status=unknown) -- unknown-flow",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-41948021-a024-51a1-84f1-1884d0001c6d",
            "subjects": [
              "data-cap-boundary-995e43a0-e564-5a27-8110-dccfc5ae576a",
              "data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
            ],
            "text": "policy violated: r1 for alpha.user reaching db (data-cap:status=static)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-a5db8b2c-bfb3-5a7b-af3d-9d8120475a20",
            "subjects": [
              "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
            ],
            "text": "policy violated: r3 for no field (data-cap:status=declared)",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-63b74bca-ea37-5b4a-9fa1-ae45f98d31e6",
            "subjects": [
              "data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
            ],
            "text": "unknown: dynamic-access at a.ts:3:5 (data-cap:status=unknown) -- computed key. Data that entered it: alpha.user: email; alpha.user: (whole); field:ghost#x: (whole).",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-5f878229-0e64-581e-8fa2-0a891dca9091",
            "subjects": [
              "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
            ],
            "text": "unknown: unresolved-call at a.ts:3:5 (data-cap:status=unknown). Data that entered it: field:ghost#y: (whole).",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-2cc47184-29b2-53ef-8b80-89400fc74f43",
            "subjects": [
              "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
            ],
            "text": "unknown: unresolved-call at a.ts:3:5 (data-cap:status=unknown). Which data entered it is not known.",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
          {
            "annotator": {
              "component": {
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            },
            "bom-ref": "data-cap-annotation-540b7f47-67c0-54c4-9cd3-82b3e769f8e2",
            "subjects": [
              "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
            ],
            "text": "unknown: unresolved-call at a.ts:3:5 (data-cap:status=unknown). Which data entered it is not known.",
            "timestamp": "2026-01-01T00:00:00.000Z",
          },
        ],
        "bomFormat": "CycloneDX",
        "metadata": {
          "component": {
            "bom-ref": "data-cap-subject-0cf9c566-ba70-59fa-a0d3-d4a09033704e",
            "name": "Hand-built",
            "type": "application",
          },
          "properties": [
            {
              "name": "data-cap:disclaimer",
              "value": "Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard. Incomplete traces are recorded as unknown, never hidden; an absent flow is not evidence of no flow.",
            },
            {
              "name": "data-cap:coverage.complete",
              "value": "false",
            },
            {
              "name": "data-cap:coverage.functionsAnalyzed",
              "value": "4",
            },
            {
              "name": "data-cap:coverage.functionsUnanalyzed",
              "value": "1",
            },
            {
              "name": "data-cap:coverage.edgesUnresolved",
              "value": "2",
            },
            {
              "name": "data-cap:coverage.unknowns",
              "value": "4",
            },
            {
              "name": "data-cap:policy.satisfied",
              "value": "1",
            },
            {
              "name": "data-cap:policy.violated",
              "value": "2",
            },
            {
              "name": "data-cap:policy.indeterminate",
              "value": "1",
            },
            {
              "name": "data-cap:claims.verified",
              "value": "1",
            },
            {
              "name": "data-cap:claims.contradicted",
              "value": "2",
            },
            {
              "name": "data-cap:observation.scopes",
              "value": "2",
            },
            {
              "name": "data-cap:observation.skipped",
              "value": "3",
            },
          ],
          "timestamp": "2026-01-01T00:00:00.000Z",
          "tools": {
            "components": [
              {
                "bom-ref": "data-cap-tool-68d1e6b7-d9b8-5631-8520-e1fe57bd1032",
                "name": "data-cap",
                "type": "application",
                "version": "0.0.0-test",
              },
            ],
          },
        },
        "serialNumber": "urn:uuid:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca",
        "services": [
          {
            "bom-ref": "data-cap-boundary-995e43a0-e564-5a27-8110-dccfc5ae576a",
            "data": [
              {
                "classification": "unclassified",
                "description": "status: static; paths: (whole); 1 edge(s)",
                "flow": "inbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha",
                "source": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
                ],
              },
              {
                "classification": "confidential",
                "description": "status: static; paths: (whole); 1 edge(s)",
                "flow": "inbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
                "source": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
                ],
              },
              {
                "classification": "confidential",
                "description": "status: static; paths: (whole), profile.email; handling: hashed; 2 edge(s)",
                "flow": "inbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
                "source": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
                ],
              },
              {
                "classification": "unclassified",
                "description": "status: declared; paths: (whole); 1 edge(s)",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
                ],
                "flow": "outbound",
                "name": "alphaX.user",
              },
              {
                "classification": "confidential",
                "description": "status: observed; paths: name; observed 1 time(s) in s2",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
              },
              {
                "classification": "confidential",
                "description": "status: observed; paths: (whole); handling: plaintext; observed 2 time(s) in s1",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
              },
            ],
            "description": "Data boundary (database).",
            "name": "db",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "boundary",
              },
              {
                "name": "data-cap:status",
                "value": "static",
              },
              {
                "name": "data-cap:node-id",
                "value": "boundary:boundary#db",
              },
              {
                "name": "data-cap:boundary-kind",
                "value": "database",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha","flow":"inbound","peer":"a.ts","status":"static","paths":["(whole)"],"handling":[],"edges":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"inbound","peer":"a.ts","status":"static","paths":["(whole)"],"handling":[],"edges":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"inbound","peer":"a.ts","status":"static","paths":["(whole)","profile.email"],"handling":["hashed"],"edges":2}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alphaX.user","flow":"outbound","peer":"a.ts","status":"declared","paths":["(whole)"],"handling":[],"edges":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"unknown","peer":"a.ts","status":"observed","paths":["name"],"handling":[],"scopes":["s2"],"count":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"unknown","peer":"a.ts","status":"observed","paths":["(whole)"],"handling":["plaintext"],"scopes":["s1"],"count":2}",
              },
            ],
          },
          {
            "bom-ref": "data-cap-boundary-f7ac7b40-f7f9-5888-85cb-41c55262f8b9",
            "data": [
              {
                "classification": "confidential",
                "description": "status: observed; paths: (whole); observed 1 time(s) in s1",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
              },
            ],
            "description": "Data boundary (log) seen only at runtime.",
            "name": "db",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "boundary",
              },
              {
                "name": "data-cap:status",
                "value": "observed",
              },
              {
                "name": "data-cap:node-id",
                "value": "observed:log:db",
              },
              {
                "name": "data-cap:boundary-kind",
                "value": "log",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"unknown","peer":"a.ts","status":"observed","paths":["(whole)"],"handling":[],"scopes":["s1"],"count":1}",
              },
            ],
          },
          {
            "bom-ref": "data-cap-boundary-e728bc8f-c61d-5ea0-93d7-b9eb92c2e9ca",
            "data": [
              {
                "classification": "unclassified",
                "description": "status: static; paths: (whole); 1 edge(s)",
                "flow": "inbound",
                "name": "alpha.user",
                "source": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-5b5ac27b-2561-5661-9aeb-9cf9d3d8b276",
                ],
              },
              {
                "classification": "unclassified",
                "description": "status: observed; paths: (whole); observed 7 time(s) in s1, s2",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-component-709fd885-05ab-5804-8f18-0da6de0cb7b7",
                ],
                "flow": "unknown",
                "name": "zeta.q",
              },
            ],
            "description": "Data boundary.",
            "name": "mystery",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "boundary",
              },
              {
                "name": "data-cap:status",
                "value": "static",
              },
              {
                "name": "data-cap:node-id",
                "value": "boundary:boundary#mystery",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"inbound","peer":"b.ts","status":"static","paths":["(whole)"],"handling":[],"edges":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"zeta.q","flow":"unknown","peer":"zeta.q","status":"observed","paths":["(whole)"],"handling":[],"scopes":["s1","s2"],"count":7}",
              },
            ],
          },
          {
            "bom-ref": "data-cap-boundary-965b1585-e8e1-5807-9c6e-b85ece689687",
            "description": "Data boundary (queue).",
            "name": "quiet",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "boundary",
              },
              {
                "name": "data-cap:status",
                "value": "static",
              },
              {
                "name": "data-cap:node-id",
                "value": "boundary:boundary#quiet",
              },
              {
                "name": "data-cap:boundary-kind",
                "value": "queue",
              },
            ],
          },
          {
            "bom-ref": "data-cap-component-b78af459-a7a4-5e27-8bf9-93c3d0f28099",
            "data": [
              {
                "classification": "unclassified",
                "description": "status: declared; paths: (whole); 1 edge(s)",
                "flow": "inbound",
                "name": "alphaX.user",
                "source": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-995e43a0-e564-5a27-8110-dccfc5ae576a",
                ],
              },
              {
                "classification": "unclassified",
                "description": "status: static; paths: (whole); 1 edge(s)",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-995e43a0-e564-5a27-8110-dccfc5ae576a",
                ],
                "flow": "outbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha",
              },
              {
                "classification": "confidential",
                "description": "status: static; paths: (whole); 1 edge(s)",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-995e43a0-e564-5a27-8110-dccfc5ae576a",
                ],
                "flow": "outbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
              },
              {
                "classification": "confidential",
                "description": "status: static; paths: (whole), profile.email; handling: hashed; 2 edge(s)",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-995e43a0-e564-5a27-8110-dccfc5ae576a",
                ],
                "flow": "outbound",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
              },
              {
                "classification": "confidential",
                "description": "status: observed; paths: name; observed 1 time(s) in s2",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-995e43a0-e564-5a27-8110-dccfc5ae576a",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
              },
              {
                "classification": "confidential",
                "description": "status: observed; paths: (whole); observed 1 time(s) in s1",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-f7ac7b40-f7f9-5888-85cb-41c55262f8b9",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
              },
              {
                "classification": "confidential",
                "description": "status: observed; paths: (whole); handling: plaintext; observed 2 time(s) in s1",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-995e43a0-e564-5a27-8110-dccfc5ae576a",
                ],
                "flow": "unknown",
                "governance": {
                  "owners": [
                    {
                      "organization": {
                        "name": "team-a",
                      },
                    },
                  ],
                },
                "name": "alpha.user",
              },
            ],
            "description": "Capability-owning component: declares the fields listed in data-cap:field.",
            "name": "a.ts",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "component",
              },
              {
                "name": "data-cap:status",
                "value": "declared",
              },
              {
                "name": "data-cap:status",
                "value": "static",
              },
              {
                "name": "data-cap:node-id",
                "value": "a.ts",
              },
              {
                "name": "data-cap:field",
                "value": "alpha",
              },
              {
                "name": "data-cap:field",
                "value": "alpha.idle",
              },
              {
                "name": "data-cap:field",
                "value": "alpha.user",
              },
              {
                "name": "data-cap:field",
                "value": "alphaX.user",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alphaX.user","flow":"inbound","peer":"db","status":"declared","paths":["(whole)"],"handling":[],"edges":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha","flow":"outbound","peer":"db","status":"static","paths":["(whole)"],"handling":[],"edges":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"outbound","peer":"db","status":"static","paths":["(whole)"],"handling":[],"edges":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"outbound","peer":"db","status":"static","paths":["(whole)","profile.email"],"handling":["hashed"],"edges":2}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"unknown","peer":"db","status":"observed","paths":["name"],"handling":[],"scopes":["s2"],"count":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"unknown","peer":"db","status":"observed","paths":["(whole)"],"handling":[],"scopes":["s1"],"count":1}",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"unknown","peer":"db","status":"observed","paths":["(whole)"],"handling":["plaintext"],"scopes":["s1"],"count":2}",
              },
            ],
          },
          {
            "bom-ref": "data-cap-component-5b5ac27b-2561-5661-9aeb-9cf9d3d8b276",
            "data": [
              {
                "classification": "unclassified",
                "description": "status: static; paths: (whole); 1 edge(s)",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-e728bc8f-c61d-5ea0-93d7-b9eb92c2e9ca",
                ],
                "flow": "outbound",
                "name": "alpha.user",
              },
            ],
            "description": "Capability-owning component: declares the fields listed in data-cap:field.",
            "name": "b.ts",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "component",
              },
              {
                "name": "data-cap:status",
                "value": "static",
              },
              {
                "name": "data-cap:node-id",
                "value": "b.ts",
              },
              {
                "name": "data-cap:field",
                "value": "alpha.user",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"alpha.user","flow":"outbound","peer":"mystery","status":"static","paths":["(whole)"],"handling":[],"edges":1}",
              },
            ],
          },
          {
            "bom-ref": "data-cap-component-709fd885-05ab-5804-8f18-0da6de0cb7b7",
            "data": [
              {
                "classification": "unclassified",
                "description": "status: observed; paths: (whole); observed 7 time(s) in s1, s2",
                "destination": [
                  "urn:cdx:8c16ade2-e1a4-5eb5-9523-89b2871ea2ca/1#data-cap-boundary-e728bc8f-c61d-5ea0-93d7-b9eb92c2e9ca",
                ],
                "flow": "unknown",
                "name": "zeta.q",
              },
            ],
            "description": "A field seen at runtime that the static flow does not declare.",
            "name": "zeta.q",
            "properties": [
              {
                "name": "data-cap:node-kind",
                "value": "component",
              },
              {
                "name": "data-cap:status",
                "value": "observed",
              },
              {
                "name": "data-cap:node-id",
                "value": "observed:zeta.q",
              },
              {
                "name": "data-cap:field",
                "value": "zeta.q",
              },
              {
                "name": "data-cap:data-flow",
                "value": "{"field":"zeta.q","flow":"unknown","peer":"mystery","status":"observed","paths":["(whole)"],"handling":[],"scopes":["s1","s2"],"count":7}",
              },
            ],
          },
        ],
        "specVersion": "1.6",
        "version": 1,
      }
    `)
  })

  it("leaves services and annotations out entirely when the flow has nothing to say", () => {
    const empty = {
      ...fixture.evidence,
      policy: undefined,
      claims: undefined,
      observation: undefined,
      flow: {
        ...fixture.evidence.flow!,
        nodes: [],
        edges: [],
        unknowns: [],
      },
    } as unknown as EvidenceModel
    const bom = buildCycloneDxBom(empty)!
    expect(Object.keys(bom)).toEqual([
      "bomFormat",
      "specVersion",
      "serialNumber",
      "version",
      "metadata",
    ])
    expectValid(bom)
  })

  it("is valid against the official CycloneDX 1.6 JSON schema", () => {
    expectValid(bom)
  })

  it("is valid when serialized and parsed back, and the serializer ends with a newline", () => {
    const text = renderFlowCycloneDx(fixture.evidence)!
    expect(text.endsWith("\n")).toBe(true)
    expect(JSON.parse(text)).toEqual(bom)
    expectValid(JSON.parse(text))
  })

  it("returns undefined when no flow was computed, never an empty BOM", () => {
    const withoutFlow: EvidenceModel = { ...fixture.evidence, flow: undefined }
    expect(buildCycloneDxBom(withoutFlow)).toBeUndefined()
    expect(renderFlowCycloneDx(withoutFlow)).toBeUndefined()
  })

  it("declares the format, spec version and a deterministic serial number from the evidence", () => {
    expect(bom.bomFormat).toBe("CycloneDX")
    expect(bom.specVersion).toBe("1.6")
    expect(bom.version).toBe(1)
    expect(bom.serialNumber).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(buildCycloneDxBom(fixture.evidence)!.serialNumber).toBe(bom.serialNumber)
    const later = {
      ...fixture.evidence,
      provenance: { ...fixture.evidence.provenance, generatedAt: "2027-01-01T00:00:00.000Z" },
    }
    expect(buildCycloneDxBom(later)!.serialNumber).not.toBe(bom.serialNumber)
    const otherCommit = {
      ...fixture.evidence,
      provenance: { ...fixture.evidence.provenance, commit: "f".repeat(40) },
    }
    expect(buildCycloneDxBom(otherCommit)!.serialNumber).not.toBe(bom.serialNumber)
  })

  it("stamps the metadata from the evidence's own provenance and names the tool", () => {
    expect(bom.metadata.timestamp).toBe("2026-01-01T00:00:00.000Z")
    const tool = bom.metadata.tools.components[0]!
    expect(tool).toMatchObject({
      type: "application",
      name: "data-cap",
      version: fixture.evidence.provenance.toolVersion,
    })
    expect(bom.metadata.component).toMatchObject({
      type: "application",
      name: "data-cap data-flow",
    })
    expect(
      buildCycloneDxBom(fixture.evidence, { name: "Profile service" })!.metadata.component.name,
    ).toBe("Profile service")
  })

  it("states coverage in the metadata so an incomplete analysis never reads as complete", () => {
    const coverage = fixture.evidence.flow!.coverage
    expect(prop(bom.metadata, "data-cap:coverage.complete")).toEqual([String(coverage.complete)])
    expect(coverage.complete).toBe(false)
    expect(prop(bom.metadata, "data-cap:coverage.unknowns")).toEqual([String(coverage.unknowns)])
    expect(prop(bom.metadata, "data-cap:coverage.functionsAnalyzed")).toEqual([
      String(coverage.functionsAnalyzed),
    ])
    expect(prop(bom.metadata, "data-cap:coverage.functionsUnanalyzed")).toEqual([
      String(coverage.functionsUnanalyzed),
    ])
    expect(prop(bom.metadata, "data-cap:coverage.edgesUnresolved")).toEqual([
      String(coverage.edgesUnresolved),
    ])
  })

  it("makes one service per boundary, carrying its kind and its status, and claims no trust boundary", () => {
    const boundaries = fixture.evidence.flow!.nodes.filter((node) => node.kind === "boundary")
    expect(boundaries.length).toBeGreaterThanOrEqual(2)
    for (const boundary of boundaries) {
      const service = named(boundary.name)
      expect(prop(service, "data-cap:node-kind")).toEqual(["boundary"])
      expect(prop(service, "data-cap:status")).toEqual([boundary.status])
      expect(prop(service, "data-cap:boundary-kind")).toEqual([boundary.boundaryKind])
      expect(prop(service, "data-cap:node-id")).toEqual([boundary.id])
      expect(service).not.toHaveProperty("x-trust-boundary")
    }
    expect(prop(named("postgres:users"), "data-cap:status")).toEqual(["declared"])
    expect(prop(named("http-response"), "data-cap:status")).toEqual(["static"])
  })

  it("makes one service per capability-owning component, named by its file, listing its fields", () => {
    const component = services().find((s) => prop(s, "data-cap:node-kind")[0] === "component")!
    expect(component.name).toBe("features/user.ts")
    expect(prop(component, "data-cap:field")).toEqual(["userData.user"])
    expect(prop(component, "data-cap:status")).toEqual(["static"])
    expect(services().filter((s) => prop(s, "data-cap:node-kind")[0] === "component")).toHaveLength(
      1,
    )
  })

  it("expresses a leak as an outbound data flow to the boundary, classified, with the status of its edges", () => {
    const component = services().find((s) => s.name === "features/user.ts")!
    const response = named("http-response")
    const out = notObserved(component.data).filter(
      (d) => d.flow === "outbound" && d.destination?.[0]?.endsWith(`#${response["bom-ref"]}`),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: "userData.user", classification: "confidential" })
    expect(out[0]!.description).toMatch(/status: static/)
    expect(out[0]!.description).toMatch(/paths: \(whole\), email, id, name/)
    const back = notObserved(response.data).filter((d) => d.flow === "inbound")
    expect(back).toHaveLength(1)
    expect(back[0]!.source?.[0]).toBe(
      `urn:cdx:${bom.serialNumber.slice("urn:uuid:".length)}/1#${component["bom-ref"]}`,
    )
    expect(back[0]!.classification).toBe("confidential")
  })

  it("expresses a declared source as an inbound flow with status declared, kept apart from static flows", () => {
    const component = services().find((s) => s.name === "features/user.ts")!
    const postgres = named("postgres:users")
    const inbound = (component.data ?? []).filter((d) => d.flow === "inbound")
    expect(inbound).toHaveLength(1)
    expect(inbound[0]!.source?.[0]).toMatch(new RegExp(`#${postgres["bom-ref"]}$`))
    expect(inbound[0]!.description).toMatch(/status: declared/)
    expect((postgres.data ?? []).filter((d) => d.flow === "outbound")).toHaveLength(1)
    const flows = details(component).filter((f) => f.status !== "observed")
    expect(flows.map((f) => [f.flow, f.peer, f.status])).toEqual([
      ["inbound", "postgres:users", "declared"],
      ["outbound", "http-response", "static"],
    ])
    expect(flows[1]).toMatchObject({ field: "userData.user", handling: [], edges: 4 })
    expect(flows[1]!.paths).toEqual(["(whole)", "email", "id", "name"])
  })

  it("never blends statuses: the same crossing as declared and as static is two entries", () => {
    const evidence = structuredClone(fixture.evidence) as {
      -readonly [K in keyof EvidenceModel]: EvidenceModel[K]
    }
    const flow = evidence.flow!
    const sideEffect = flow.edges.find((e) => e.kind === "side-effect")!
    const declared: FlowEdge = {
      ...sideEffect,
      status: "declared",
      id: sideEffect.id.replace("@static", "@declared"),
    }
    evidence.flow = { ...flow, edges: [...flow.edges, declared] }
    const merged = buildCycloneDxBom(evidence)!
    expectValid(merged)
    const component = merged.services!.find((s) => s.name === "features/user.ts")!
    const statuses = details(component)
      .filter((f) => f.flow === "outbound" && f.peer === "http-response" && f.status !== "observed")
      .map((f) => f.status)
    expect(statuses).toEqual(["declared", "static"])
  })

  it("annotates each unknown with its reason, location and the data that entered it", () => {
    const unknown = fixture.evidence.flow!.unknowns[0]!
    const notes = (bom.annotations ?? []).filter((a) => a.text.startsWith("unknown:"))
    expect(notes).toHaveLength(fixture.evidence.flow!.unknowns.length)
    const note = notes[0]!
    expect(note.text).toContain(unknown.reason)
    expect(note.text).toContain(
      `${unknown.source.file}:${unknown.source.line}:${unknown.source.column}`,
    )
    expect(note.text).toContain("data-cap:status=unknown")
    expect(note.text).toContain("userData.user: email")
    expect(note.timestamp).toBe("2026-01-01T00:00:00.000Z")
    expect(note.annotator.component.name).toBe("data-cap")
    expect(note.subjects).toEqual([named("features/user.ts")["bom-ref"]])
  })

  it("annotates a violated policy result and a contradicted claim, anchored on the component", () => {
    const text = (bom.annotations ?? []).map((a) => a.text)
    const violated = text.find((t) => t.startsWith("policy violated:"))!
    expect(violated).toContain("userData/no-password-to-client")
    expect(violated).toContain("userData.user")
    expect(violated).toContain("http-response")
    expect(violated).toContain("data-cap:status=static")
    expect(text.filter((t) => t.startsWith("policy violated:"))).toHaveLength(1)
    const claim = text.find((t) => t.startsWith("claim contradicted:"))!
    expect(claim).toContain("Rule userData/no-password-to-client holds for userData.user")
    expect(text.some((t) => t.startsWith("policy satisfied:"))).toBe(false)
    expect(text.some((t) => t.startsWith("policy indeterminate:"))).toBe(false)
    expect(prop(bom.metadata, "data-cap:policy.satisfied")).toEqual(["1"])
    expect(prop(bom.metadata, "data-cap:policy.violated")).toEqual(["1"])
    expect(prop(bom.metadata, "data-cap:claims.contradicted")).toEqual(["2"])
    expect(text.filter((t) => t.startsWith("claim contradicted:"))).toHaveLength(2)
  })

  it("annotates an indeterminate policy result with the reason it could not be decided, and a rule that matches nothing without a field", () => {
    const policy = fixture.evidence.policy!
    const field = fixture.evidence.flow!.nodes.find((node) => node.kind === "field")!
    const evidence: EvidenceModel = {
      ...fixture.evidence,
      policy: {
        ...policy,
        results: [
          {
            ruleId: "r/incomplete",
            subject: field.id,
            outcome: "indeterminate",
            reason: "trace-incomplete",
            basis: "unknown",
            edges: [],
          },
          {
            ruleId: "r/typo",
            outcome: "indeterminate",
            reason: "rule-matches-nothing",
            basis: "unknown",
            edges: [],
          },
        ],
      },
    }
    const merged = buildCycloneDxBom(evidence)!
    expectValid(merged)
    const notes = (merged.annotations ?? []).filter((a) => a.text.startsWith("policy "))
    expect(notes.map((n) => n.text)).toEqual([
      "policy indeterminate: r/incomplete for userData.user (data-cap:status=unknown) -- trace-incomplete",
      "policy indeterminate: r/typo for no field (data-cap:status=unknown) -- rule-matches-nothing",
    ])
    expect(notes[0]!.subjects).toEqual([named("features/user.ts")["bom-ref"]])
    expect(notes[1]!.subjects).toEqual([merged.metadata.tools.components[0]!["bom-ref"]])
  })

  it("records an observed flow as its own status, and a boundary only runtime saw as an observed service", () => {
    const component = services().find((s) => s.name === "features/user.ts")!
    const flows = details(component)
    const observed = flows.filter((f) => f.status === "observed")
    expect(observed.map((f) => [f.flow, f.peer])).toEqual([
      ["unknown", "audit-log"],
      ["unknown", "http-response"],
    ])
    expect(observed[0]).toMatchObject({ scopes: ["scenario:profile"], count: 1 })
    const audit = named("audit-log")
    expect(prop(audit, "data-cap:status")).toEqual(["observed"])
    expect(prop(audit, "data-cap:boundary-kind")).toEqual(["log"])
    expect(prop(named("http-response"), "data-cap:status")).toEqual(["static"])
    expect(
      (named("http-response").data ?? []).filter((d) => d.description.includes("status: observed")),
    ).toHaveLength(1)
  })

  it("uses unique, content-addressed bom-refs and every reference resolves to one", () => {
    const refs = [
      bom.metadata.tools.components[0]!["bom-ref"],
      bom.metadata.component["bom-ref"],
      ...services().map((s) => s["bom-ref"]),
    ]
    expect(new Set(refs).size).toBe(refs.length)
    for (const ref of refs) expect(ref).toMatch(/^data-cap-[a-z]+-[0-9a-f]{8}-/)
    const serial = bom.serialNumber.slice("urn:uuid:".length)
    for (const service of services()) {
      for (const entry of service.data ?? []) {
        for (const link of [...(entry.source ?? []), ...(entry.destination ?? [])]) {
          expect(link.startsWith(`urn:cdx:${serial}/1#`)).toBe(true)
          expect(refs).toContain(link.slice(link.indexOf("#") + 1))
        }
      }
    }
    for (const note of bom.annotations ?? [])
      for (const subject of note.subjects) expect(refs).toContain(subject)
  })

  it("is deterministic and ordered: the same evidence gives identical bytes, services and annotations are sorted", () => {
    expect(renderFlowCycloneDx(fixture.evidence)).toBe(renderFlowCycloneDx(fixture.evidence))
    const names = services().map((s) => s.name)
    const kinds = services().map((s) => prop(s, "data-cap:node-kind")[0])
    expect(kinds).toEqual([...kinds].sort((a, b) => (a ?? "").localeCompare(b ?? "", "en")))
    expect(names.length).toBe(4)
    const texts = (bom.annotations ?? []).map((a) => a.text)
    expect(texts.length).toBeGreaterThan(2)
    expect(texts).toEqual([...texts].sort((a, b) => a.localeCompare(b, "en")))
  })

  it("carries the declaring capability's owner as data governance", () => {
    const component = services().find((s) => s.name === "features/user.ts")!
    const out = (component.data ?? []).find((d) => d.flow === "outbound")!
    expect(out.governance).toEqual({ owners: [{ organization: { name: "platform" } }] })
  })

  it("is valid with no policy, claims or observations at all", () => {
    const bare: EvidenceModel = {
      ...fixture.evidence,
      policy: undefined,
      claims: undefined,
      observation: undefined,
    }
    const minimal = buildCycloneDxBom(bare)!
    expectValid(minimal)
    expect((minimal.annotations ?? []).every((a) => a.text.startsWith("unknown:"))).toBe(true)
  })
})
