import { describe, expect, it } from "vitest"
import { renderDependencyGraphDot, renderOwnershipGraphDot } from "../../src/build/graph-export.js"
import { buildDependencyModel } from "../../src/build/dependency-model.js"
import {
  buildOwnershipModel,
  OWNERSHIP_MODEL_SCHEMA_VERSION,
} from "../../src/build/ownership-model.js"
import type { OwnershipModel } from "../../src/build/ownership-model.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    kind: "buildData",
    docs: { owner: "identity-team" },
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields: [
      {
        path: ["email"],
        docs: undefined,
        owner: { value: undefined, declaredOn: undefined },
        sensitivity: { value: undefined, declaredOn: undefined },
        purpose: { value: undefined, declaredOn: undefined },
        legalBasis: { value: undefined, declaredOn: undefined },
        dataResidency: { value: undefined, declaredOn: undefined },
        auditRequired: { value: undefined, declaredOn: undefined },
        declarationPosition: undefined,
        writtenBy: [],
        shape: "",
      },
    ],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

function inventory(capabilities: readonly CapabilityNode[]): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
}

function edge(overrides: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    relationship: "reads-field",
    from: "/project/consumer.ts",
    to: {
      capability: { file: "/project/user.ts", exportName: "userCapability" },
      field: ["email"],
    },
    resolution: "resolved",
    position: { line: 1, column: 1 },
    ...overrides,
  }
}

describe("renderDependencyGraphDot", () => {
  it("renders a valid digraph with a node per capability and per consumer, and one edge per proven edge", () => {
    const model = buildDependencyModel([edge()])
    const dot = renderDependencyGraphDot(inventory([capability()]).capabilities, model)
    expect(dot).toMatch(/^digraph DependencyGraph \{/)
    expect(dot).toContain('label="userCapability"')
    expect(dot).toContain('label="/project/consumer.ts"')
    expect(dot).toContain("reads-field: email")
    expect(dot.trim().endsWith("}")).toBe(true)
  })

  it("styles an unresolved-consumer edge as dashed, a resolved one as solid", () => {
    const model = buildDependencyModel([edge({ resolution: "unresolved-consumer" })])
    expect(renderDependencyGraphDot(inventory([capability()]).capabilities, model)).toContain(
      "style=dashed",
    )
  })

  it("declares every capability as a node even with zero edges", () => {
    const model = buildDependencyModel([])
    expect(
      renderDependencyGraphDot(
        inventory([capability({ exportName: "orphan" })]).capabilities,
        model,
      ),
    ).toContain('label="orphan"')
  })
})

describe("renderOwnershipGraphDot", () => {
  it("renders a node per owner and per owned capability/field, with edges from owner to each", () => {
    const model = buildOwnershipModel(inventory([capability()]))
    const dot = renderOwnershipGraphDot(model)
    expect(dot).toMatch(/^digraph OwnershipGraph \{/)
    expect(dot).toContain('label="identity-team"')
    expect(dot).toContain('label="userCapability"')
    expect(dot.trim().endsWith("}")).toBe(true)
  })

  it("labels the unowned bucket as (unowned)", () => {
    const model = buildOwnershipModel(inventory([capability({ docs: undefined })]))
    expect(renderOwnershipGraphDot(model)).toContain('label="(unowned)"')
  })
})

describe("renderDependencyGraphDot -- full DOT snapshot", () => {
  it("renders the whole digraph exactly", () => {
    // Covers: a consumed capability + an orphan (zero-edge) capability from the
    // list; a capability that only `model.edges` mentions (not in the list); a
    // consumer with two edges (node deduped); a field edge with a nested path
    // (`join(".")`); an operation edge (`?? edge.to.operation`); an `imports`
    // edge with neither field nor operation (bare relationship label); a
    // resolved (solid) and an unresolved (dashed) edge; and a `"` in a label
    // so `escapeDotLabel` runs.
    const capabilities = [
      { file: "/project/src/user.ts", exportName: "userCapability" },
      { file: "/project/src/orphan.ts", exportName: "orphanCapability" },
    ]
    const model = buildDependencyModel([
      edge({
        from: '/project/src/pages/say "hi".ts',
        to: {
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["profile", "email"],
        },
      }),
      edge({
        from: '/project/src/pages/say "hi".ts',
        to: {
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["name"],
        },
      }),
      edge({
        relationship: "calls-getter",
        from: "/project/src/pages/header.ts",
        to: {
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          operation: "getUser",
        },
        resolution: "unresolved-consumer",
      }),
      edge({
        relationship: "imports",
        // A backslash in the label so `escapeDotLabel`'s `\\` -> `\\\\` replace runs.
        from: "/project/src/pages/foo\\bar.ts",
        to: { capability: { file: "/project/src/hidden.ts", exportName: "hiddenCapability" } },
      }),
    ])
    expect(renderDependencyGraphDot(capabilities, model)).toMatchInlineSnapshot(`
      "digraph DependencyGraph {
        rankdir=LR;
        "n0" [label="orphanCapability", shape=box];
        "n1" [label="userCapability", shape=box];
        "n2" [label="/project/src/pages/say \\"hi\\".ts", shape=ellipse];
        "n3" [label="/project/src/pages/header.ts", shape=ellipse];
        "n4" [label="/project/src/pages/foo\\\\bar.ts", shape=ellipse];
        "n5" [label="hiddenCapability", shape=box];
        "n2" -> "n1" [label="reads-field: profile.email", style=solid];
        "n2" -> "n1" [label="reads-field: name", style=solid];
        "n3" -> "n1" [label="calls-getter: getUser", style=dashed];
        "n4" -> "n5" [label="imports", style=solid];
      }"
    `)
  })
})

describe("renderOwnershipGraphDot -- full DOT snapshot", () => {
  it("renders the whole digraph exactly", () => {
    // Covers: a named owner with an owned capability AND owned fields (one with
    // a nested path); the UNOWNED bucket (capability + field); the
    // "already declared this node" guard (a field owned by two owners); and a
    // `"` in an owner name so `escapeDotLabel` runs.
    const model = buildOwnershipModel(
      inventory([
        capability({
          file: "/project/src/user.ts",
          exportName: "userCapability",
          docs: { owner: 'team "identity"' },
          fields: [
            {
              path: ["profile", "email"],
              docs: undefined,
              owner: { value: 'team "identity"', declaredOn: "field" },
              sensitivity: { value: undefined, declaredOn: undefined },
              purpose: { value: undefined, declaredOn: undefined },
              legalBasis: { value: undefined, declaredOn: undefined },
              dataResidency: { value: undefined, declaredOn: undefined },
              auditRequired: { value: undefined, declaredOn: undefined },
              declarationPosition: undefined,
              writtenBy: [],
              shape: "",
            },
            {
              path: ["ssn"],
              docs: undefined,
              owner: { value: undefined, declaredOn: undefined },
              sensitivity: { value: undefined, declaredOn: undefined },
              purpose: { value: undefined, declaredOn: undefined },
              legalBasis: { value: undefined, declaredOn: undefined },
              dataResidency: { value: undefined, declaredOn: undefined },
              auditRequired: { value: undefined, declaredOn: undefined },
              declarationPosition: undefined,
              writtenBy: [],
              shape: "",
            },
          ],
        }),
        capability({
          file: "/project/src/audit.ts",
          exportName: "auditCapability",
          docs: undefined,
          fields: [],
        }),
      ]),
    )
    expect(renderOwnershipGraphDot(model)).toMatchInlineSnapshot(`
      "digraph OwnershipGraph {
        rankdir=LR;
        "n0" [label="team \\"identity\\"", shape=box, peripheries=2];
        "n1" [label="userCapability", shape=box];
        "n2" [label="userCapability.profile.email", shape=ellipse];
        "n3" [label="(unowned)", shape=box, peripheries=2];
        "n4" [label="auditCapability", shape=box];
        "n5" [label="userCapability.ssn", shape=ellipse];
        "n0" -> "n1";
        "n0" -> "n2";
        "n3" -> "n4";
        "n3" -> "n5";
      }"
    `)
  })

  it("emits each capability and field node exactly once even when the model carries duplicate refs", () => {
    // Feeds a hand-built model (not the builder) whose single entry lists the
    // same capability ref twice and two field refs that collide only if the
    // key drops its `.` separator -- so the `!declaredNodes.has(key)` guards
    // and the `field.field.join(".")` key separator are all load-bearing.
    const capRef = { file: "/project/src/user.ts", exportName: "userCapability" }
    const model: OwnershipModel = {
      schemaVersion: OWNERSHIP_MODEL_SCHEMA_VERSION,
      entries: [
        {
          owner: "identity-team",
          capabilities: [capRef, capRef],
          fields: [
            { capability: capRef, field: ["a", "b"] },
            { capability: capRef, field: ["a", "b"] },
            { capability: capRef, field: ["ab"] },
          ],
        },
      ],
    }
    const dot = renderOwnershipGraphDot(model)
    expect(dot).toMatchInlineSnapshot(`
      "digraph OwnershipGraph {
        rankdir=LR;
        "n0" [label="identity-team", shape=box, peripheries=2];
        "n1" [label="userCapability", shape=box];
        "n2" [label="userCapability.a.b", shape=ellipse];
        "n3" [label="userCapability.ab", shape=ellipse];
        "n0" -> "n1";
        "n0" -> "n1";
        "n0" -> "n2";
        "n0" -> "n2";
        "n0" -> "n3";
      }"
    `)
    // One node line per distinct node, no duplicates.
    const nodeLines = dot.split("\n").filter((l) => l.includes("[label="))
    expect(new Set(nodeLines).size).toBe(nodeLines.length)
  })
})
