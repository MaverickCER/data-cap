import { describe, expect, it } from "vitest"
import {
  renderCapabilityDiagram,
  renderOverviewDiagram,
  renderSensitivityDiagram,
} from "../../src/build/flow-diagram.js"
import type { CapabilityNode } from "../../src/build/inventory.js"
import type { DataFlowEndpoint } from "../../src/core/document.js"
import type { FieldFlow, FieldFlowEndpoint } from "../../src/build/flow-graph.js"

const ROOT = "/project"

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    kind: "buildData",
    docs: undefined,
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields: [],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

function flow(overrides: Partial<FieldFlow> = {}): FieldFlow {
  return {
    capability: { file: "/project/user.ts", exportName: "userCapability" },
    field: ["email"],
    sensitivity: undefined,
    declaredOrigins: [],
    provenConsumers: [],
    declaredDestinations: [],
    ...overrides,
  }
}

/** Wraps a bare `DataFlowEndpoint` with a declaring operation -- most tests here don't care which specific operation, just that the endpoint/field/consumer chain renders correctly. */
function declared(
  endpoint: DataFlowEndpoint,
  operation: FieldFlowEndpoint["operation"] = { kind: "getter", name: "getUser" },
): FieldFlowEndpoint {
  return { operation, endpoint }
}

describe("renderOverviewDiagram", () => {
  it("starts with 'flowchart TB'", () => {
    const content = renderOverviewDiagram([], [], ROOT)
    expect(content).toContain("flowchart TB")
  })

  it("wraps every active capability in the Trust Boundary subgraph", () => {
    const content = renderOverviewDiagram([capability()], [], ROOT)
    expect(content).toContain('subgraph boundary["Trust Boundary (proven, in-repo)"]')
    expect(content).toContain('(["userCapability"])')
  })

  it("omits an inactive capability entirely", () => {
    const content = renderOverviewDiagram([capability({ active: false })], [], ROOT)
    expect(content).not.toContain("userCapability")
  })

  it("omits the subgraph entirely when there are no active capabilities", () => {
    const content = renderOverviewDiagram([capability({ active: false })], [], ROOT)
    expect(content).not.toContain("subgraph boundary")
  })

  it("draws an external-entity node (double-bracket shape) for an api/external-service/user-input endpoint", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredOrigins: [
            declared({ direction: "input", kind: "api", name: "identity-service" }),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('[["identity-service<br/><em>api</em>"]]')
  })

  it("draws a data-store node (cylinder shape) for a database/cache/storage/queue endpoint", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredDestinations: [
            declared(
              { direction: "output", kind: "database", name: "postgres:users" },
              { kind: "mutator", name: "updateEmail" },
            ),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('[("postgres:users<br/><em>database</em>")]')
  })

  it("draws a plain rectangle for an internal/computed endpoint", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredOrigins: [declared({ direction: "input", kind: "computed", name: "derived" })],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('["derived<br/><em>computed</em>"]')
  })

  it("draws a distinct operation node, labeled kind: name, for the getter declaring the endpoint", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredOrigins: [
            declared(
              { direction: "input", kind: "api", name: "identity-service" },
              { kind: "getter", name: "getUser" },
            ),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('(["getter: getUser"])')
  })

  it("draws a field node as a parallelogram, labeled with the field path", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          field: ["email"],
          declaredOrigins: [
            declared({ direction: "input", kind: "api", name: "identity-service" }),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('[/"email"/]')
  })

  it("chains endpoint -> operation -> field as three real hops, not one flattened edge", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredOrigins: [
            declared(
              { direction: "input", kind: "api", name: "identity-service" },
              { kind: "getter", name: "getUser" },
            ),
          ],
        }),
      ],
      ROOT,
    )
    // endpoint -> operation, carrying the "declared" label
    expect(content).toMatch(/n\d+ -\.->\|"declared: email"\| n\d+/)
    // operation -> field, a separate internal hop
    expect(content).toMatch(/n\d+ -\.->\|"writes"\| n\d+/)
  })

  it("includes the endpoint's own declared handling state in the declared-origin edge label", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredOrigins: [
            declared({
              direction: "input",
              kind: "api",
              name: "identity-service",
              handling: "encrypted",
            }),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('-.->|"declared: email (encrypted)"|')
  })

  it("labels a declared-origin edge as declared, using a dashed arrow", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredOrigins: [
            declared({ direction: "input", kind: "api", name: "identity-service" }),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('-.->|"declared: email"|')
  })

  it("labels a proven consumer edge as proven, using a solid arrow, with the consumer node path relative to root", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          provenConsumers: [
            {
              relationship: "reads-field",
              from: "/project/consumer.ts",
              to: {
                capability: { file: "/project/user.ts", exportName: "userCapability" },
                field: ["email"],
              },
              resolution: "resolved",
              position: undefined,
            },
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('-->|"proven: email"|')
    expect(content).toContain('["consumer.ts"]')
    expect(content).not.toContain('["/project/consumer.ts"]')
  })

  it("labels a proven consumer edge with the exact, root-relative file:line:column when the position is known", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          provenConsumers: [
            {
              relationship: "reads-field",
              from: "/project/consumer.ts",
              to: {
                capability: { file: "/project/user.ts", exportName: "userCapability" },
                field: ["email"],
              },
              resolution: "resolved",
              position: { line: 12, column: 5 },
            },
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('-->|"proven: consumer.ts:12:5"|')
    expect(content).not.toContain("/project/consumer.ts:12:5")
  })

  it("falls back to the absolute consumer path, unchanged, for a consumer outside root", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          provenConsumers: [
            {
              relationship: "reads-field",
              from: "/elsewhere/consumer.ts",
              to: {
                capability: { file: "/project/user.ts", exportName: "userCapability" },
                field: ["email"],
              },
              resolution: "resolved",
              position: { line: 12, column: 5 },
            },
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('-->|"proven: /elsewhere/consumer.ts:12:5"|')
    expect(content).toContain('["/elsewhere/consumer.ts"]')
  })

  it("applies a linkStyle to a sensitive field's boundary-crossing edge", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          sensitivity: "restricted",
          declaredOrigins: [
            declared({ direction: "input", kind: "api", name: "identity-service" }),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toMatch(/linkStyle \d+ stroke:#e63946,stroke-width:3px/)
  })

  it("does not apply a linkStyle to a non-sensitive field's boundary-crossing edge", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredOrigins: [
            declared({ direction: "input", kind: "api", name: "identity-service" }),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).not.toContain("linkStyle")
  })

  it("does not apply a linkStyle to a sensitive field's internal-only endpoint", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          sensitivity: "restricted",
          declaredOrigins: [declared({ direction: "input", kind: "internal", name: "cache" })],
        }),
      ],
      ROOT,
    )
    expect(content).not.toContain("linkStyle")
  })

  it("never applies a linkStyle to the purely internal operation<->field hop, only the endpoint-touching edge", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          sensitivity: "restricted",
          declaredOrigins: [
            declared({ direction: "input", kind: "api", name: "identity-service" }),
          ],
        }),
      ],
      ROOT,
    )
    const linkStyleLines = content.split("\n").filter((line) => line.trim().startsWith("linkStyle"))
    expect(linkStyleLines).toHaveLength(1)
  })

  it("reuses the same endpoint node across multiple fields that declare it", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          field: ["email"],
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "shared" })],
        }),
        flow({
          field: ["name"],
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "shared" })],
        }),
      ],
      ROOT,
    )
    expect(content.match(/\[\["shared<br\/><em>api<\/em>"\]\]/g)).toHaveLength(1)
  })

  it("draws two distinct operation nodes when two different operations write the same field", () => {
    const content = renderOverviewDiagram(
      [capability()],
      [
        flow({
          declaredOrigins: [
            declared(
              { direction: "input", kind: "api", name: "primary" },
              { kind: "getter", name: "getUser" },
            ),
          ],
          declaredDestinations: [
            declared(
              { direction: "output", kind: "database", name: "postgres:users" },
              { kind: "mutator", name: "updateEmail" },
            ),
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('(["getter: getUser"])')
    expect(content).toContain('(["mutator: updateEmail"])')
  })
})

describe("renderCapabilityDiagram", () => {
  it("scopes the diagram to only the given capability's own flows", () => {
    const content = renderCapabilityDiagram(
      capability(),
      [
        flow({
          field: ["email"],
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "svc" })],
        }),
        flow({
          field: ["name"],
          capability: { file: "/project/other.ts", exportName: "other" },
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "svc" })],
        }),
      ],
      ROOT,
    )
    expect(content).toContain("declared: email")
    expect(content).not.toContain("declared: name")
  })

  it("includes the capability even when it has no fields at all", () => {
    const content = renderCapabilityDiagram(capability(), [], ROOT)
    expect(content).toContain('(["userCapability"])')
  })
})

describe("renderSensitivityDiagram", () => {
  it("includes only fields matching the requested sensitivity level", () => {
    const content = renderSensitivityDiagram(
      "restricted",
      [capability()],
      [
        flow({
          field: ["ssn"],
          sensitivity: "restricted",
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "svc" })],
        }),
        flow({
          field: ["locale"],
          sensitivity: "internal",
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "svc" })],
        }),
      ],
      ROOT,
    )
    expect(content).toContain("declared: ssn")
    expect(content).not.toContain("declared: locale")
  })

  it("omits the capability node entirely when none of its fields match the level", () => {
    const content = renderSensitivityDiagram(
      "restricted",
      [capability()],
      [flow({ field: ["locale"], sensitivity: "internal" })],
      ROOT,
    )
    expect(content).not.toContain("userCapability")
  })

  it("skips a flow whose capability cannot be found in the provided list", () => {
    const content = renderSensitivityDiagram(
      "restricted",
      [],
      [flow({ field: ["ssn"], sensitivity: "restricted" })],
      ROOT,
    )
    expect(content).not.toContain("ssn")
  })
})

describe("flow-diagram -- exact Mermaid output", () => {
  // A single maximal fixture through `renderOverviewDiagram`, pinned exactly.
  // Reaches: an inactive capability (skipped); a flow with nothing to draw
  // (early return); a field with an entity endpoint (`[[...]]`), a store
  // endpoint (`[(...)]`), an "internal" endpoint (`[...]`); an origin chain and
  // a destination chain; a sensitive boundary crossing (-> `linkStyle`); an
  // endpoint with a declared `handling` and one without; a proven consumer with
  // a resolved position and one without; a repeated endpoint/operation node
  // (deduped); and a nested (dotted) field path.
  function overview() {
    const cap = capability({ file: "/project/src/user.ts", exportName: "userCapability" })
    const inactive = capability({
      file: "/project/src/legacy.ts",
      exportName: "legacyCapability",
      active: false,
    })
    const getter = { kind: "getter", name: "getUser" } as const
    const mutator = { kind: "mutator", name: "syncUser" } as const
    return renderOverviewDiagram(
      [cap, inactive],
      [
        // sensitive -> the api origin edge is a boundary crossing (linkStyle)
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["contact", "email"],
          sensitivity: "confidential",
          declaredOrigins: [
            {
              operation: getter,
              endpoint: {
                direction: "input",
                kind: "api",
                name: "identity-svc",
                handling: "encrypted",
              },
            },
            {
              operation: getter,
              endpoint: { direction: "input", kind: "database", name: "pg:users" },
            },
          ],
          declaredDestinations: [
            {
              operation: mutator,
              endpoint: { direction: "output", kind: "internal", name: "memo" },
            },
          ],
          provenConsumers: [
            {
              relationship: "reads-field",
              from: "/project/src/pages/profile.ts",
              to: {
                capability: { file: "/project/src/user.ts", exportName: "userCapability" },
                field: ["contact", "email"],
              },
              resolution: "resolved",
              position: { line: 12, column: 5 },
            },
            {
              relationship: "reads-field",
              from: "/project/src/pages/header.ts",
              to: {
                capability: { file: "/project/src/user.ts", exportName: "userCapability" },
                field: ["contact", "email"],
              },
              resolution: "resolved",
              position: undefined,
            },
          ],
        }),
        // non-sensitive, reuses the same getter endpoint/op nodes (deduped)
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["displayName"],
          sensitivity: undefined,
          declaredOrigins: [
            {
              operation: getter,
              endpoint: { direction: "input", kind: "api", name: "identity-svc" },
            },
          ],
        }),
        // nothing to draw -> early return, no field node
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["unused"],
        }),
      ],
      ROOT,
    )
  }

  it("renders renderOverviewDiagram exactly", () => {
    expect(overview()).toMatchInlineSnapshot(`
      "%% System overview -- declared endpoints and proven consumers per capability
      flowchart TB
        subgraph boundary["Trust Boundary (proven, in-repo)"]
          n0(["userCapability"])
          n1[/"contact.email"/]
          n3(["getter: getUser"])
          n6(["mutator: syncUser"])
          n9[/"displayName"/]
        end
        n2[["identity-svc<br/><em>api</em>"]]
        n4[("pg:users<br/><em>database</em>")]
        n5["memo<br/><em>internal</em>"]
        n7["src/pages/profile.ts"]
        n8["src/pages/header.ts"]
        n2 -.->|"declared: contact.email (encrypted)"| n3
        n3 -.->|"writes"| n1
        n4 -.->|"declared: contact.email"| n3
        n3 -.->|"writes"| n1
        n1 -.->|"declared"| n6
        n6 -.->|"declared: contact.email"| n5
        n1 -->|"proven: src/pages/profile.ts:12:5"| n7
        n1 -->|"proven: contact.email"| n8
        n2 -.->|"declared: displayName"| n3
        n3 -.->|"writes"| n9
        linkStyle 0 stroke:#e63946,stroke-width:3px"
    `)
  })

  it("renders renderCapabilityDiagram exactly", () => {
    const cap = capability({ file: "/project/src/user.ts", exportName: "userCapability" })
    const content = renderCapabilityDiagram(
      cap,
      [
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["ssn"],
          sensitivity: "restricted",
          declaredOrigins: [declared({ direction: "input", kind: "user-input", name: "form" })],
        }),
        // same file, different exportName -> filtered out (the exportName clause)
        flow({
          capability: { file: "/project/src/user.ts", exportName: "otherOnSameFile" },
          field: ["y"],
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "m" })],
        }),
        // different file, SAME exportName -> filtered out (the file clause)
        flow({
          capability: { file: "/project/src/elsewhere.ts", exportName: "userCapability" },
          field: ["x"],
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "n" })],
        }),
      ],
      ROOT,
    )
    expect(content).toMatchInlineSnapshot(`
      "%% Capability: userCapability
      flowchart TB
        subgraph boundary["Trust Boundary (proven, in-repo)"]
          n0(["userCapability"])
          n1[/"ssn"/]
          n3(["getter: getUser"])
        end
        n2[["form<br/><em>user-input</em>"]]
        n2 -.->|"declared: ssn"| n3
        n3 -.->|"writes"| n1"
    `)
  })

  it.each([
    ["external-service", '[["s<br/><em>external-service</em>"]]'],
    ["api", '[["s<br/><em>api</em>"]]'],
    ["user-input", '[["s<br/><em>user-input</em>"]]'],
    ["database", '[("s<br/><em>database</em>")]'],
    ["cache", '[("s<br/><em>cache</em>")]'],
    ["storage", '[("s<br/><em>storage</em>")]'],
    ["queue", '[("s<br/><em>queue</em>")]'],
    ["internal", '["s<br/><em>internal</em>"]'],
    ["computed", '["s<br/><em>computed</em>"]'],
  ] as const)(
    "draws a %s endpoint with its OWASP-conventional node shape",
    (kind, shapeFragment) => {
      const content = renderOverviewDiagram(
        [capability({ file: "/project/src/user.ts", exportName: "userCapability" })],
        [
          flow({
            capability: { file: "/project/src/user.ts", exportName: "userCapability" },
            field: ["f"],
            declaredOrigins: [declared({ direction: "input", kind, name: "s" })],
          }),
        ],
        ROOT,
      )
      expect(content).toContain(shapeFragment)
    },
  )

  it("namespaces node ids by kind, so a consumer path equal to a capability key still gets its own node", () => {
    const content = renderOverviewDiagram(
      [capability({ file: "/project/src/user.ts", exportName: "userCapability" })],
      [
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["email"],
          provenConsumers: [
            {
              relationship: "reads-field",
              from: "/project/src/user.ts#userCapability",
              to: {
                capability: { file: "/project/src/user.ts", exportName: "userCapability" },
                field: ["email"],
              },
              resolution: "resolved",
              position: undefined,
            },
          ],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('(["userCapability"])')
    expect(content).toContain('["src/user.ts#userCapability"]')
  })

  it("gives two capabilities distinct nodes even when file+exportName concatenate to the same string", () => {
    const content = renderOverviewDiagram(
      [
        capability({ file: "/project/src/a", exportName: "bc" }),
        capability({ file: "/project/src/ab", exportName: "c" }),
      ],
      [],
      ROOT,
    )
    expect(content).toContain('(["bc"])')
    expect(content).toContain('(["c"])')
    expect(content.match(/\(\["[^"]+"\]\)/g)).toHaveLength(2)
  })

  it("gives two fields distinct nodes even when their dotted paths differ only by the separator", () => {
    const content = renderCapabilityDiagram(
      capability({ file: "/project/src/user.ts", exportName: "userCapability" }),
      [
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["a", "b"],
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "x" })],
        }),
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["ab"],
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "y" })],
        }),
      ],
      ROOT,
    )
    expect(content).toContain('[/"a.b"/]')
    expect(content).toContain('[/"ab"/]')
    expect(content.match(/\[\/"[^"]+"\/\]/g)).toHaveLength(2)
  })

  it("registers a capability referenced by several matching flows exactly once", () => {
    const content = renderSensitivityDiagram(
      "restricted",
      [capability({ file: "/project/src/user.ts", exportName: "userCapability" })],
      [
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["ssn"],
          sensitivity: "restricted",
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "a" })],
        }),
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["dob"],
          sensitivity: "restricted",
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "b" })],
        }),
      ],
      ROOT,
    )
    expect(content.match(/\(\["userCapability"\]\)/g)).toHaveLength(1)
  })

  it("renders renderSensitivityDiagram exactly", () => {
    const content = renderSensitivityDiagram(
      "restricted",
      [capability({ file: "/project/src/user.ts", exportName: "userCapability" })],
      [
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["ssn"],
          sensitivity: "restricted",
          declaredOrigins: [declared({ direction: "input", kind: "storage", name: "s3:pii" })],
        }),
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          field: ["locale"],
          sensitivity: "internal",
          declaredOrigins: [declared({ direction: "input", kind: "api", name: "svc" })],
        }),
      ],
      ROOT,
    )
    expect(content).toMatchInlineSnapshot(`
      "%% Sensitivity level: restricted
      flowchart TB
        subgraph boundary["Trust Boundary (proven, in-repo)"]
          n0(["userCapability"])
          n1[/"ssn"/]
          n3(["getter: getUser"])
        end
        n2[("s3:pii<br/><em>storage</em>")]
        n2 -.->|"declared: ssn"| n3
        n3 -.->|"writes"| n1"
    `)
  })

  it("keeps a field node distinct from an operation node even when the field path spells the operation key", () => {
    const cap = capability({ file: "/project/src/user.ts", exportName: "userCapability" })
    const content = renderCapabilityDiagram(
      cap,
      [
        flow({
          capability: { file: "/project/src/user.ts", exportName: "userCapability" },
          // joins to "getter:getUser" -- identical to the operation node's key tail
          field: ["getter:getUser"],
          declaredOrigins: [
            declared(
              { direction: "input", kind: "api", name: "svc" },
              { kind: "getter", name: "getUser" },
            ),
          ],
        }),
      ],
      ROOT,
    )
    // a parallelogram field node AND a stadium operation node, not one merged node
    expect(content).toContain('[/"getter:getUser"/]')
    expect(content).toContain('(["getter: getUser"])')
  })
})
