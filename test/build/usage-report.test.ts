import { describe, expect, it } from "vitest"
import {
  collectIndeterminateSites,
  deriveUsageFindings,
  isFieldProvenRead,
  renderCapabilityDependencies,
  renderConsumerEdges,
  renderFindings,
  renderOwnershipMatrix,
  renderUsageReport,
} from "../../src/build/usage-report.js"
import type { CapabilityInventory, CapabilityNode, FieldNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"
import type { OwnershipMatrixEntry } from "../../src/build/ownership-model.js"
import { UNOWNED } from "../../src/build/ownership-model.js"
import type { ReportFinding } from "../../src/build/findings.js"

const ROOT = "/project"

function field(overrides: Partial<FieldNode> = {}): FieldNode {
  return {
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
    ...overrides,
  }
}

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

function inventory(capabilities: readonly CapabilityNode[]): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
}

function edge(overrides: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    relationship: "imports",
    from: "/project/consumer.ts",
    to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
    resolution: "resolved",
    position: undefined,
    ...overrides,
  }
}

describe("deriveUsageFindings", () => {
  it("flags a capability with zero edges as abandoned", () => {
    const findings = deriveUsageFindings(inventory([capability()]), [])
    expect(findings).toEqual([
      {
        code: "ABANDONED_CAPABILITY",
        family: "usage",
        severity: "warning",
        message: '"userCapability" is never imported anywhere in the scanned project.',
        capability: { file: "/project/user.ts", exportName: "userCapability" },
      },
    ])
  })

  it("does not flag a capability with at least one edge as abandoned", () => {
    const findings = deriveUsageFindings(inventory([capability()]), [edge()])
    expect(findings.some((f) => f.code === "ABANDONED_CAPABILITY")).toBe(false)
  })

  it("flags an unresolved-consumer edge", () => {
    const findings = deriveUsageFindings(inventory([capability()]), [
      edge({ resolution: "unresolved-consumer" }),
    ])
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "UNRESOLVED_CONSUMER", severity: "info" }),
    )
  })

  it("flags an indeterminate edge", () => {
    const findings = deriveUsageFindings(inventory([capability()]), [
      edge({ resolution: "indeterminate" }),
    ])
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "INDETERMINATE_CONSUMER", severity: "info" }),
    )
  })

  it("does not flag a resolved edge as unresolved or indeterminate", () => {
    const findings = deriveUsageFindings(inventory([capability()]), [
      edge({ resolution: "resolved" }),
    ])
    expect(findings.some((f) => f.code === "UNRESOLVED_CONSUMER")).toBe(false)
    expect(findings.some((f) => f.code === "INDETERMINATE_CONSUMER")).toBe(false)
  })

  it("flags a written-but-never-read field as unconsumed", () => {
    const findings = deriveUsageFindings(
      inventory([
        capability({
          fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
        }),
      ]),
      [
        edge({
          relationship: "calls-getter",
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            operation: "getUser",
          },
        }),
      ],
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "UNCONSUMED_FIELD", severity: "warning", field: ["email"] }),
    )
  })

  it("does not flag a field as unconsumed once a reads-field edge targets it", () => {
    const findings = deriveUsageFindings(
      inventory([
        capability({
          fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
        }),
      ]),
      [
        edge({
          relationship: "reads-field",
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            field: ["email"],
          },
        }),
      ],
    )
    expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(false)
  })

  it("populates position on an UNCONSUMED_FIELD finding from the field's own declaration position (ADR 0052)", () => {
    const findings = deriveUsageFindings(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              writtenBy: [{ kind: "getter", name: "getUser" }],
              declarationPosition: { line: 5, column: 3 },
            }),
          ],
        }),
      ]),
      [
        edge({
          relationship: "calls-getter",
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            operation: "getUser",
          },
        }),
      ],
    )
    expect(findings).toContainEqual(
      expect.objectContaining({ code: "UNCONSUMED_FIELD", position: { line: 5, column: 3 } }),
    )
  })

  describe("FIELD_ACCESS_INDETERMINATE (ADR 0052 five-state model)", () => {
    it("downgrades an otherwise-unconsumed field to indeterminate when a capability-level dynamic access exists", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [
          edge({
            relationship: "imports",
            resolution: "indeterminate",
            position: { line: 3, column: 5 },
          }),
        ],
      )
      expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(false)
      expect(findings).toContainEqual(
        expect.objectContaining({
          code: "FIELD_ACCESS_INDETERMINATE",
          family: "usage",
          severity: "info",
          field: ["email"],
          indeterminateSites: [{ file: "/project/consumer.ts", line: 3, column: 5 }],
        }),
      )
    })

    it("downgrades an otherwise-unconsumed field to indeterminate when a field-level dynamic access (.fields[computed]) exists", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [
          edge({
            relationship: "reads-field",
            resolution: "indeterminate",
            to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
            position: { line: 4, column: 7 },
          }),
        ],
      )
      expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(false)
      expect(findings).toContainEqual(
        expect.objectContaining({ code: "FIELD_ACCESS_INDETERMINATE", field: ["email"] }),
      )
    })

    it("never downgrades a field with a proven reads-field edge, even when the capability also has indeterminate edges", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [
          edge({
            relationship: "imports",
            resolution: "indeterminate",
            position: { line: 1, column: 1 },
          }),
          edge({
            relationship: "reads-field",
            resolution: "resolved",
            to: {
              capability: { file: "/project/user.ts", exportName: "userCapability" },
              field: ["email"],
            },
          }),
        ],
      )
      expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(false)
      expect(findings.some((f) => f.code === "FIELD_ACCESS_INDETERMINATE")).toBe(false)
    })

    it("lists every candidate indeterminate site, across multiple consuming files", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [
          edge({
            from: "/project/a.ts",
            relationship: "imports",
            resolution: "indeterminate",
            position: { line: 1, column: 1 },
          }),
          edge({
            from: "/project/b.ts",
            relationship: "reads-field",
            resolution: "indeterminate",
            to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
            position: { line: 2, column: 2 },
          }),
        ],
      )
      const finding = findings.find((f) => f.code === "FIELD_ACCESS_INDETERMINATE")
      expect(finding?.indeterminateSites).toEqual([
        { file: "/project/a.ts", line: 1, column: 1 },
        { file: "/project/b.ts", line: 2, column: 2 },
      ])
    })
  })

  describe("FIELD_DYNAMIC_ACCESS_DECLARED (ADR 0053)", () => {
    it("a declared dynamicAccess citation takes precedence over UNCONSUMED_FIELD", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            docs: {
              evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:12:5"] } } },
            },
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [edge()],
      )
      expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(false)
      expect(findings).toContainEqual(
        expect.objectContaining({
          code: "FIELD_DYNAMIC_ACCESS_DECLARED",
          family: "usage",
          severity: "info",
          field: ["email"],
          message: "Per developers, this data point is dynamically accessed at src/legacy.ts:12:5.",
        }),
      )
    })

    it("a declared dynamicAccess citation takes precedence over FIELD_ACCESS_INDETERMINATE too", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            docs: {
              evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:12:5"] } } },
            },
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [
          edge({
            relationship: "imports",
            resolution: "indeterminate",
            position: { line: 1, column: 1 },
          }),
        ],
      )
      expect(findings.some((f) => f.code === "FIELD_ACCESS_INDETERMINATE")).toBe(false)
      expect(findings.some((f) => f.code === "FIELD_DYNAMIC_ACCESS_DECLARED")).toBe(true)
    })

    it("emits one finding per citation when a field declares more than one", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            docs: {
              evidence: {
                fields: { email: { dynamicAccess: ["a.ts:1:1", "b.ts:2:2"] } },
              },
            },
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [edge()],
      )
      expect(findings.filter((f) => f.code === "FIELD_DYNAMIC_ACCESS_DECLARED")).toHaveLength(2)
    })

    it("does not fire for a field whose capability declares evidence for a DIFFERENT field", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            docs: {
              evidence: { fields: { otherField: { dynamicAccess: ["a.ts:1:1"] } } },
            },
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [edge()],
      )
      expect(findings.some((f) => f.code === "FIELD_DYNAMIC_ACCESS_DECLARED")).toBe(false)
      expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(true)
    })

    it("does not fire for an empty dynamicAccess array", () => {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            docs: { evidence: { fields: { email: { dynamicAccess: [] } } } },
            fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
          }),
        ]),
        [edge()],
      )
      expect(findings.some((f) => f.code === "FIELD_DYNAMIC_ACCESS_DECLARED")).toBe(false)
      expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(true)
    })
  })

  it("never flags a field nobody claims to write as unconsumed", () => {
    const findings = deriveUsageFindings(
      inventory([capability({ fields: [field({ path: ["email"], writtenBy: [] })] })]),
      [edge()],
    )
    expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(false)
  })

  it("skips a degenerate field with no path segments entirely (no finding, no crash)", () => {
    const findings = deriveUsageFindings(
      inventory([
        capability({ fields: [field({ path: [], writtenBy: [{ kind: "getter", name: "g" }] })] }),
      ]),
      [
        edge({
          relationship: "calls-getter",
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            operation: "g",
          },
        }),
      ],
    )
    expect(findings.some((f) => "field" in f)).toBe(false)
  })

  it("resolves dynamicAccess citations without crashing when docs / evidence / fields are partly absent", () => {
    for (const docs of [
      undefined,
      { owner: "team" },
      { evidence: {} },
      { evidence: { fields: {} } },
    ] satisfies CapabilityNode["docs"][]) {
      const findings = deriveUsageFindings(
        inventory([
          capability({
            docs,
            fields: [field({ path: ["x"], writtenBy: [{ kind: "getter", name: "g" }] })],
          }),
        ]),
        [
          edge({
            relationship: "calls-getter",
            to: {
              capability: { file: "/project/user.ts", exportName: "userCapability" },
              operation: "g",
            },
          }),
        ],
      )
      expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(true)
    }
  })

  it("short-circuits field/consumer findings once a capability is already abandoned", () => {
    const findings = deriveUsageFindings(
      inventory([
        capability({
          fields: [field({ path: ["email"], writtenBy: [{ kind: "getter", name: "getUser" }] })],
        }),
      ]),
      [],
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]!.code).toBe("ABANDONED_CAPABILITY")
  })

  it("evaluates every capability independently", () => {
    const findings = deriveUsageFindings(
      inventory([
        capability({ exportName: "a", file: "/project/a.ts" }),
        capability({ exportName: "b", file: "/project/b.ts" }),
      ]),
      [edge({ to: { capability: { file: "/project/a.ts", exportName: "a" } } })],
    )
    expect(findings.filter((f) => f.code === "ABANDONED_CAPABILITY")).toHaveLength(1)
    expect(findings.find((f) => f.code === "ABANDONED_CAPABILITY")?.capability?.exportName).toBe(
      "b",
    )
  })
})

describe("renderUsageReport", () => {
  it("starts with the markdown banner and evidence disclaimer", () => {
    const content = renderUsageReport(inventory([]), [], ROOT)
    expect(content).toMatch(/^<!-- GENERATED FILE/)
    expect(content).toContain("does not itself establish compliance")
  })

  it("renders placeholders when there is nothing to report", () => {
    const content = renderUsageReport(inventory([]), [], ROOT)
    expect(content).toContain("_No capabilities discovered._")
  })

  it("names the Evidence Model by concept only when no --evidence path was requested this run", () => {
    const content = renderUsageReport(inventory([]), [], ROOT)
    expect(content).toContain("Projected from data-cap's Evidence Model")
    expect(content).not.toContain("This run also wrote it to")
  })

  it("also names the concrete path when this run's own options included --evidence", () => {
    const content = renderUsageReport(
      inventory([]),
      [],
      ROOT,
      [],
      "/project/docs/data.evidence.json",
    )
    // Rendered root-relative, never as the machine-specific absolute path (OUT-01).
    expect(content).toContain("This run also wrote it to `docs/data.evidence.json`.")
  })

  it("renders the ownership matrix section", () => {
    const content = renderUsageReport(
      inventory([capability({ docs: { owner: "identity-team" } })]),
      [],
      ROOT,
    )
    expect(content).toContain("### identity-team")
    expect(content).toContain("`userCapability`")
  })

  it("renders 'none' for an owner bucket with fields but no directly-owned capabilities", () => {
    const content = renderUsageReport(
      inventory([
        capability({
          docs: { owner: "identity-team" },
          fields: [
            field({ path: ["email"], owner: { value: "security-team", declaredOn: "field" } }),
          ],
        }),
      ]),
      [],
      ROOT,
    )
    expect(content).toMatch(/### security-team\n\nCapabilities: _none_/)
  })

  it("renders a capability-to-capability dependency row when the consumer file is itself a discovered capability", () => {
    const content = renderUsageReport(
      inventory([
        capability({ exportName: "a", file: "/project/a.ts" }),
        capability({ exportName: "b", file: "/project/b.ts" }),
      ]),
      [
        edge({
          from: "/project/b.ts",
          to: { capability: { file: "/project/a.ts", exportName: "a" }, operation: "getUser" },
          relationship: "calls-getter",
        }),
      ],
      ROOT,
    )
    expect(content).toMatch(/\| `b` \| calls-getter \| `a` \|/)
  })

  it("renders a placeholder when no capability depends on another", () => {
    const content = renderUsageReport(inventory([capability()]), [], ROOT)
    expect(content).toContain("_No capability statically depends on another capability._")
  })

  it("excludes a capability's own self-usage from the capability-dependency table -- that's ordinary usage, not a cross-capability dependency", () => {
    const content = renderUsageReport(
      inventory([capability({ exportName: "userCapability", file: "/project/user.ts" })]),
      [
        edge({
          from: "/project/user.ts",
          to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
          relationship: "reads-field",
        }),
      ],
      ROOT,
    )
    expect(content).toContain("_No capability statically depends on another capability._")
  })

  it("discloses ambiguity, rather than guessing, when a file declaring multiple capabilities produces a genuine cross-capability edge", () => {
    const content = renderUsageReport(
      inventory([
        capability({ exportName: "a", file: "/project/shared.ts" }),
        capability({ exportName: "b", file: "/project/shared.ts" }),
        capability({ exportName: "c", file: "/project/c.ts" }),
      ]),
      [
        edge({
          from: "/project/shared.ts",
          to: { capability: { file: "/project/c.ts", exportName: "c" }, operation: "getThing" },
          relationship: "calls-getter",
        }),
      ],
      ROOT,
    )
    expect(content).toMatch(/\| `a` or `b` \| calls-getter \| `c` \|/)
  })

  it("renders per-capability consumer edges, with the consumer path relative to root, including the resolution column", () => {
    const content = renderUsageReport(
      inventory([capability()]),
      [
        edge({
          relationship: "calls-getter",
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            operation: "getUser",
          },
          resolution: "resolved",
        }),
      ],
      ROOT,
    )
    expect(content).toContain("| `consumer.ts` | calls-getter | getUser | resolved |")
  })

  it("renders the exact, root-relative file:line:column of a proven consumption site when a position is available", () => {
    const content = renderUsageReport(
      inventory([capability()]),
      [
        edge({
          relationship: "reads-field",
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            field: ["email"],
          },
          resolution: "resolved",
          position: { line: 12, column: 5 },
        }),
      ],
      ROOT,
    )
    expect(content).toContain("| `consumer.ts:12:5` | reads-field | email | resolved |")
  })

  it("falls back to the bare, root-relative consumer file path when no position is available", () => {
    const content = renderUsageReport(
      inventory([capability()]),
      [
        edge({
          relationship: "imports",
          to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
          resolution: "unresolved-consumer",
          position: undefined,
        }),
      ],
      ROOT,
    )
    expect(content).toContain("| `consumer.ts` | imports | — | unresolved-consumer |")
  })

  it("falls back to the absolute consumer path, unchanged, for a consumer outside root", () => {
    const content = renderUsageReport(
      inventory([capability()]),
      [
        edge({
          from: "/elsewhere/consumer.ts",
          relationship: "imports",
          to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
          resolution: "unresolved-consumer",
          position: undefined,
        }),
      ],
      ROOT,
    )
    expect(content).toContain("| `/elsewhere/consumer.ts` | imports | — | unresolved-consumer |")
  })

  it("renders a no-consumers placeholder per capability when it has none", () => {
    const content = renderUsageReport(inventory([capability()]), [], ROOT)
    expect(content).toContain("_No statically-discovered consumers._")
  })

  it("renders the findings table with severity/code/capability/message", () => {
    const content = renderUsageReport(inventory([capability()]), [], ROOT)
    expect(content).toContain("| warning | ABANDONED_CAPABILITY | `userCapability` |")
  })

  it("renders a no-findings placeholder when nothing is wrong", () => {
    const content = renderUsageReport(inventory([capability()]), [edge()], ROOT)
    expect(content).toContain("_No usage findings._")
  })

  describe("scan surface (ADR 0053)", () => {
    it("omits the Scan surface section entirely when no packages were scanned -- the default case", () => {
      const content = renderUsageReport(inventory([capability()]), [], ROOT)
      expect(content).not.toContain("## Scan surface")
    })

    it("states exactly what was scanned when packages were included", () => {
      const content = renderUsageReport(inventory([capability()]), [], ROOT, ["@fixtures/pkg-a"])
      expect(content).toContain("## Scan surface")
      expect(content).toContain("Scanned: application source, @fixtures/pkg-a")
      expect(content).toContain("Not scanned: all other dependencies.")
    })

    it("lists every scanned package, not just the first", () => {
      const content = renderUsageReport(inventory([capability()]), [], ROOT, [
        "@fixtures/pkg-a",
        "@fixtures/pkg-b",
      ])
      expect(content).toContain("Scanned: application source, @fixtures/pkg-a, @fixtures/pkg-b")
    })
  })
})

/**
 * One maximal fixture that reaches every branch of `deriveUsageFindings` and
 * every renderer -- exact-output assertions here are what pin the message
 * templates, table separators, and section headings that the scenario tests
 * above (all `toContain`) leave unmutated.
 */
const MAXIMAL_INVENTORY: CapabilityInventory = inventory([
  capability({
    file: "/project/a.ts",
    exportName: "alpha",
    kind: "createData",
    docs: {
      owner: "team-alpha",
      evidence: {
        fields: { profile: { dynamicAccess: ["src/legacy.ts:9:1", "src/legacy.ts:20:4"] } },
      },
    },
    fields: [
      field({
        path: ["id"],
        writtenBy: [{ kind: "getter", name: "getUser" }],
        declarationPosition: { line: 4, column: 3 },
      }),
      field({
        path: ["secret"],
        writtenBy: [{ kind: "getter", name: "getUser" }],
        declarationPosition: { line: 5, column: 3 },
        owner: { value: "security-team", declaredOn: "field" },
      }),
      field({
        path: ["profile", "email"],
        writtenBy: [{ kind: "getter", name: "getUser" }],
        declarationPosition: { line: 6, column: 3 },
      }),
      field({
        path: ["audit", "trail"],
        writtenBy: [{ kind: "getter", name: "getUser" }],
        declarationPosition: { line: 8, column: 3 },
      }),
    ],
  }),
  capability({
    file: "/project/a.ts",
    exportName: "gamma",
    kind: "createData",
    fields: [],
  }),
  capability({
    file: "/project/b.ts",
    exportName: "beta",
    kind: "createData",
    fields: [
      field({
        path: ["token"],
        writtenBy: [{ kind: "mutator", name: "setToken" }],
        declarationPosition: { line: 7, column: 1 },
      }),
      field({
        path: ["meta", "tag"],
        writtenBy: [{ kind: "mutator", name: "setToken" }],
        declarationPosition: { line: 9, column: 1 },
      }),
    ],
  }),
])

const MAXIMAL_EDGES: readonly DependencyEdge[] = [
  // alpha: one proven field read, one getter call, one co-located self edge.
  edge({
    relationship: "reads-field",
    from: "/project/consumer.ts",
    to: { capability: { file: "/project/a.ts", exportName: "alpha" }, field: ["id"] },
    position: { line: 12, column: 8 },
  }),
  edge({
    relationship: "calls-getter",
    from: "/project/b.ts",
    to: { capability: { file: "/project/a.ts", exportName: "alpha" }, operation: "getUser" },
  }),
  // beta: an unresolved-consumer, an indeterminate access (with position), a plain import.
  edge({
    relationship: "imports",
    from: "/project/barrel.ts",
    to: { capability: { file: "/project/b.ts", exportName: "beta" } },
    resolution: "unresolved-consumer",
  }),
  edge({
    relationship: "imports",
    from: "/project/dynamic.ts",
    to: { capability: { file: "/project/b.ts", exportName: "beta" } },
    resolution: "indeterminate",
    position: { line: 3, column: 7 },
  }),
  edge({
    relationship: "imports",
    from: "/project/a.ts",
    to: { capability: { file: "/project/b.ts", exportName: "beta" } },
  }),
]

describe("usage-report -- maximal fixture (exact output)", () => {
  it("deriveUsageFindings: every finding code, verbatim", () => {
    expect(deriveUsageFindings(MAXIMAL_INVENTORY, MAXIMAL_EDGES)).toMatchInlineSnapshot(`
      [
        {
          "capability": {
            "exportName": "alpha",
            "file": "/project/a.ts",
          },
          "code": "UNCONSUMED_FIELD",
          "family": "usage",
          "field": [
            "secret",
          ],
          "message": "Field "secret" on "alpha" is written but never statically read in the scanned project.",
          "position": {
            "column": 3,
            "line": 5,
          },
          "severity": "warning",
        },
        {
          "capability": {
            "exportName": "alpha",
            "file": "/project/a.ts",
          },
          "code": "FIELD_DYNAMIC_ACCESS_DECLARED",
          "family": "usage",
          "field": [
            "profile",
            "email",
          ],
          "message": "Per developers, this data point is dynamically accessed at src/legacy.ts:9:1.",
          "position": {
            "column": 3,
            "line": 6,
          },
          "severity": "info",
        },
        {
          "capability": {
            "exportName": "alpha",
            "file": "/project/a.ts",
          },
          "code": "FIELD_DYNAMIC_ACCESS_DECLARED",
          "family": "usage",
          "field": [
            "profile",
            "email",
          ],
          "message": "Per developers, this data point is dynamically accessed at src/legacy.ts:20:4.",
          "position": {
            "column": 3,
            "line": 6,
          },
          "severity": "info",
        },
        {
          "capability": {
            "exportName": "alpha",
            "file": "/project/a.ts",
          },
          "code": "UNCONSUMED_FIELD",
          "family": "usage",
          "field": [
            "audit",
            "trail",
          ],
          "message": "Field "audit.trail" on "alpha" is written but never statically read in the scanned project.",
          "position": {
            "column": 3,
            "line": 8,
          },
          "severity": "warning",
        },
        {
          "capability": {
            "exportName": "gamma",
            "file": "/project/a.ts",
          },
          "code": "ABANDONED_CAPABILITY",
          "family": "usage",
          "message": ""gamma" is never imported anywhere in the scanned project.",
          "severity": "warning",
        },
        {
          "capability": {
            "exportName": "beta",
            "file": "/project/b.ts",
          },
          "code": "UNRESOLVED_CONSUMER",
          "family": "usage",
          "message": ""/project/barrel.ts" appears to import "beta" by name, but the import specifier didn't resolve directly to its declaring file (possibly a barrel re-export) -- not fully traced.",
          "severity": "info",
          "source": "/project/barrel.ts",
        },
        {
          "capability": {
            "exportName": "beta",
            "file": "/project/b.ts",
          },
          "code": "INDETERMINATE_CONSUMER",
          "family": "usage",
          "message": ""/project/dynamic.ts" accesses "beta" using a dynamic/computed property -- can't be statically characterized.",
          "severity": "info",
          "source": "/project/dynamic.ts",
        },
        {
          "capability": {
            "exportName": "beta",
            "file": "/project/b.ts",
          },
          "code": "FIELD_ACCESS_INDETERMINATE",
          "family": "usage",
          "field": [
            "token",
          ],
          "indeterminateSites": [
            {
              "column": 7,
              "file": "/project/dynamic.ts",
              "line": 3,
            },
          ],
          "message": "Field "token" on "beta" appears unused, but there are instances of dynamic/computed access on this capability that can't be statically attributed to a specific field -- it may be one of them.",
          "position": {
            "column": 1,
            "line": 7,
          },
          "severity": "info",
        },
        {
          "capability": {
            "exportName": "beta",
            "file": "/project/b.ts",
          },
          "code": "FIELD_ACCESS_INDETERMINATE",
          "family": "usage",
          "field": [
            "meta",
            "tag",
          ],
          "indeterminateSites": [
            {
              "column": 7,
              "file": "/project/dynamic.ts",
              "line": 3,
            },
          ],
          "message": "Field "meta.tag" on "beta" appears unused, but there are instances of dynamic/computed access on this capability that can't be statically attributed to a specific field -- it may be one of them.",
          "position": {
            "column": 1,
            "line": 9,
          },
          "severity": "info",
        },
      ]
    `)
  })

  it("renderUsageReport: full document", () => {
    expect(
      renderUsageReport(
        MAXIMAL_INVENTORY,
        MAXIMAL_EDGES,
        ROOT,
        ["@acme/pkg-a", "@acme/pkg-b"],
        "/project/out/data.evidence.json",
      ),
    ).toMatchInlineSnapshot(`
      "<!-- GENERATED FILE -- do not edit by hand. Run \`npx data-cap\` to regenerate. -->

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

      > Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to \`out/data.evidence.json\`.

      # Dependency & Ownership Report

      ## Scan surface

      Scanned: application source, @acme/pkg-a, @acme/pkg-b

      Not scanned: all other dependencies.

      ## Ownership matrix

      ### security-team

      Capabilities: _none_
      Fields: \`alpha.secret\`

      ### team-alpha

      Capabilities: \`alpha\`
      Fields: _none_

      ### (unowned)

      Capabilities: \`gamma\`, \`beta\`
      Fields: \`alpha.audit.trail\`, \`alpha.id\`, \`alpha.profile.email\`, \`beta.meta.tag\`, \`beta.token\`

      ## Capability-to-capability dependencies

      _Edges statically proven where one capability's own file imports and uses another._

      | From | Relationship | To |
      | --- | --- | --- |
      | \`beta\` | calls-getter | \`alpha\` |
      | \`alpha\` or \`gamma\` | imports | \`beta\` |

      ## Consumers per capability

      ### \`alpha\`

      | Consumer | Relationship | Detail | Resolution |
      | --- | --- | --- | --- |
      | \`consumer.ts:12:8\` | reads-field | id | resolved |
      | \`b.ts\` | calls-getter | getUser | resolved |

      ### \`gamma\`

      _No statically-discovered consumers._

      ### \`beta\`

      | Consumer | Relationship | Detail | Resolution |
      | --- | --- | --- | --- |
      | \`barrel.ts\` | imports | — | unresolved-consumer |
      | \`dynamic.ts:3:7\` | imports | — | indeterminate |
      | \`a.ts\` | imports | — | resolved |

      ## Findings

      | Severity | Code | Capability | Message |
      | --- | --- | --- | --- |
      | warning | UNCONSUMED_FIELD | \`alpha\` | Field "secret" on "alpha" is written but never statically read in the scanned project. |
      | info | FIELD_DYNAMIC_ACCESS_DECLARED | \`alpha\` | Per developers, this data point is dynamically accessed at src/legacy.ts:9:1. |
      | info | FIELD_DYNAMIC_ACCESS_DECLARED | \`alpha\` | Per developers, this data point is dynamically accessed at src/legacy.ts:20:4. |
      | warning | UNCONSUMED_FIELD | \`alpha\` | Field "audit.trail" on "alpha" is written but never statically read in the scanned project. |
      | warning | ABANDONED_CAPABILITY | \`gamma\` | "gamma" is never imported anywhere in the scanned project. |
      | info | UNRESOLVED_CONSUMER | \`beta\` | "/project/barrel.ts" appears to import "beta" by name, but the import specifier didn't resolve directly to its declaring file (possibly a barrel re-export) -- not fully traced. |
      | info | INDETERMINATE_CONSUMER | \`beta\` | "/project/dynamic.ts" accesses "beta" using a dynamic/computed property -- can't be statically characterized. |
      | info | FIELD_ACCESS_INDETERMINATE | \`beta\` | Field "token" on "beta" appears unused, but there are instances of dynamic/computed access on this capability that can't be statically attributed to a specific field -- it may be one of them. |
      | info | FIELD_ACCESS_INDETERMINATE | \`beta\` | Field "meta.tag" on "beta" appears unused, but there are instances of dynamic/computed access on this capability that can't be statically attributed to a specific field -- it may be one of them. |
      "
    `)
  })

  it("renderUsageReport: empty project -- every section renders its placeholder", () => {
    expect(renderUsageReport(inventory([]), [], ROOT)).toMatchInlineSnapshot(`
      "<!-- GENERATED FILE -- do not edit by hand. Run \`npx data-cap\` to regenerate. -->

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

      > Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from.

      # Dependency & Ownership Report

      ## Ownership matrix

      _No capabilities discovered._

      ## Capability-to-capability dependencies

      _Edges statically proven where one capability's own file imports and uses another._

      _No capability statically depends on another capability._

      ## Consumers per capability

      _No capabilities discovered._

      ## Findings

      _No usage findings._
      "
    `)
  })
})

describe("isFieldProvenRead (direct)", () => {
  const readsEmail = edge({
    relationship: "reads-field",
    to: {
      capability: { file: "/project/user.ts", exportName: "userCapability" },
      field: ["email"],
    },
  })

  it("is true only when a reads-field edge names that exact top-level field", () => {
    expect(isFieldProvenRead([readsEmail], "email")).toBe(true)
    expect(isFieldProvenRead([readsEmail], "name")).toBe(false)
    expect(isFieldProvenRead([], "email")).toBe(false)
  })

  it("ignores a stray `field` on a non-reads-field edge", () => {
    const strayFieldOnGetter = edge({
      relationship: "calls-getter",
      to: {
        capability: { file: "/project/user.ts", exportName: "userCapability" },
        field: ["email"],
        operation: "getUser",
      },
    })
    expect(isFieldProvenRead([strayFieldOnGetter], "email")).toBe(false)
  })

  it("an indeterminate reads-field edge (no named field) proves nothing", () => {
    const indeterminateRead = edge({
      relationship: "reads-field",
      resolution: "indeterminate",
      to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
    })
    expect(isFieldProvenRead([indeterminateRead], "email")).toBe(false)
  })
})

describe("collectIndeterminateSites (direct)", () => {
  const at = (line: number, column: number) => ({ line, column })

  it("collects only indeterminate, un-attributable, positioned accesses", () => {
    const sites = collectIndeterminateSites([
      edge({
        from: "/a.ts",
        relationship: "imports",
        resolution: "indeterminate",
        position: at(1, 2),
      }),
      edge({
        from: "/b.ts",
        relationship: "reads-field",
        resolution: "indeterminate",
        to: { capability: { file: "/project/user.ts", exportName: "userCapability" } },
        position: at(3, 4),
      }),
      // resolved -> excluded
      edge({ from: "/c.ts", relationship: "imports", resolution: "resolved", position: at(5, 6) }),
      // indeterminate but attributable (reads-field WITH a named field) -> excluded
      edge({
        from: "/d.ts",
        relationship: "reads-field",
        resolution: "indeterminate",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
        },
        position: at(7, 8),
      }),
      // indeterminate + un-attributable but no position -> excluded
      edge({
        from: "/e.ts",
        relationship: "imports",
        resolution: "indeterminate",
        position: undefined,
      }),
      // indeterminate but a calls-getter (neither imports nor reads-field) -> excluded
      edge({
        from: "/f.ts",
        relationship: "calls-getter",
        resolution: "indeterminate",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          operation: "getUser",
        },
        position: at(9, 9),
      }),
    ])
    expect(sites).toEqual([
      { file: "/a.ts", line: 1, column: 2 },
      { file: "/b.ts", line: 3, column: 4 },
    ])
  })
})

describe("renderOwnershipMatrix (direct)", () => {
  const capRef = { file: "/project/a.ts", exportName: "alpha" }

  it("returns the no-capabilities placeholder for an empty matrix", () => {
    expect(renderOwnershipMatrix([])).toBe("_No capabilities discovered._")
  })

  it("renders the UNOWNED label, comma-joined lists, and _none_ for empty sides", () => {
    const entries: OwnershipMatrixEntry[] = [
      {
        owner: "team-a",
        capabilities: [capRef, { file: "/project/b.ts", exportName: "beta" }],
        fields: [],
      },
      {
        owner: UNOWNED,
        capabilities: [],
        fields: [{ capability: capRef, field: ["profile", "email"] }],
      },
    ]
    expect(renderOwnershipMatrix(entries)).toBe(
      [
        "### team-a",
        "",
        "Capabilities: `alpha`, `beta`",
        "Fields: _none_",
        "",
        "### (unowned)",
        "",
        "Capabilities: _none_",
        "Fields: `alpha.profile.email`",
      ].join("\n"),
    )
  })
})

describe("renderCapabilityDependencies (direct)", () => {
  const alphaGammaInA = inventory([
    capability({ file: "/project/a.ts", exportName: "alpha" }),
    capability({ file: "/project/a.ts", exportName: "gamma" }),
    capability({ file: "/project/b.ts", exportName: "beta" }),
  ])

  it("returns the placeholder when no edge connects two capability files", () => {
    expect(renderCapabilityDependencies(alphaGammaInA, [])).toBe(
      "_No capability statically depends on another capability._",
    )
    // an edge whose consumer file declares no capability contributes nothing
    expect(
      renderCapabilityDependencies(alphaGammaInA, [
        edge({
          from: "/project/plain.ts",
          to: { capability: { file: "/project/b.ts", exportName: "beta" } },
        }),
      ]),
    ).toBe("_No capability statically depends on another capability._")
  })

  it("lists every co-located capability as a possible source, and excludes a co-located target", () => {
    const rendered = renderCapabilityDependencies(alphaGammaInA, [
      // a.ts -> beta : real cross-capability edge, both alpha & gamma are possible sources
      edge({
        from: "/project/a.ts",
        relationship: "imports",
        to: { capability: { file: "/project/b.ts", exportName: "beta" } },
      }),
      // a.ts -> alpha : target is co-located with the source file -> excluded
      edge({
        from: "/project/a.ts",
        relationship: "calls-getter",
        to: { capability: { file: "/project/a.ts", exportName: "alpha" } },
      }),
      // a.ts -> {b.ts, gamma} : target file differs; exportName coincides with a
      // sibling but that must NOT count as co-located (needs file AND name)
      edge({
        from: "/project/a.ts",
        relationship: "imports",
        to: { capability: { file: "/project/b.ts", exportName: "gamma" } },
      }),
      // a.ts -> {a.ts, phantom} : same file as the source, but no capability
      // there is named "phantom" -> NOT co-located (needs file AND name)
      edge({
        from: "/project/a.ts",
        relationship: "imports",
        to: { capability: { file: "/project/a.ts", exportName: "phantom" } },
      }),
    ])
    expect(rendered).toBe(
      [
        "| From | Relationship | To |",
        "| --- | --- | --- |",
        "| `alpha` or `gamma` | imports | `beta` |",
        "| `alpha` or `gamma` | imports | `gamma` |",
        "| `alpha` or `gamma` | imports | `phantom` |",
      ].join("\n"),
    )
  })
})

describe("renderConsumerEdges (direct)", () => {
  it("returns the no-capabilities placeholder when the inventory is empty", () => {
    expect(renderConsumerEdges(inventory([]), [], ROOT)).toBe("_No capabilities discovered._")
  })

  it("renders a per-capability consumer table, and the no-consumers placeholder otherwise", () => {
    const inv = inventory([
      capability({ file: "/project/a.ts", exportName: "alpha" }),
      capability({ file: "/project/b.ts", exportName: "beta" }),
    ])
    const rendered = renderConsumerEdges(
      inv,
      [
        edge({
          from: "/project/consumer.ts",
          relationship: "reads-field",
          to: {
            capability: { file: "/project/a.ts", exportName: "alpha" },
            field: ["profile", "email"],
          },
          position: { line: 9, column: 4 },
        }),
        edge({
          from: "/outside/x.ts",
          relationship: "calls-getter",
          to: {
            capability: { file: "/project/a.ts", exportName: "alpha" },
            operation: "getUser",
          },
        }),
      ],
      ROOT,
    )
    expect(rendered).toBe(
      [
        "### `alpha`",
        "",
        "| Consumer | Relationship | Detail | Resolution |",
        "| --- | --- | --- | --- |",
        "| `consumer.ts:9:4` | reads-field | profile.email | resolved |",
        "| `/outside/x.ts` | calls-getter | getUser | resolved |",
        "",
        "### `beta`",
        "",
        "_No statically-discovered consumers._",
      ].join("\n"),
    )
  })

  it("falls back to em dash for an edge with neither field nor operation", () => {
    const inv = inventory([capability({ file: "/project/a.ts", exportName: "alpha" })])
    const rendered = renderConsumerEdges(
      inv,
      [
        edge({
          from: "/project/c.ts",
          relationship: "imports",
          to: { capability: { file: "/project/a.ts", exportName: "alpha" } },
        }),
      ],
      ROOT,
    )
    expect(rendered).toContain("| `c.ts` | imports | — | resolved |")
  })
})

describe("renderFindings (direct)", () => {
  it("returns the placeholder for no findings", () => {
    expect(renderFindings([])).toBe("_No usage findings._")
  })

  it("renders one row per finding, em dash when a finding has no capability", () => {
    const findings: ReportFinding[] = [
      {
        code: "ABANDONED_CAPABILITY",
        family: "usage",
        severity: "warning",
        message: "gone",
        capability: { file: "/project/a.ts", exportName: "alpha" },
      },
      {
        code: "DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES",
        family: "structural",
        severity: "error",
        message: "bad",
      },
    ]
    expect(renderFindings(findings)).toBe(
      [
        "| Severity | Code | Capability | Message |",
        "| --- | --- | --- | --- |",
        "| warning | ABANDONED_CAPABILITY | `alpha` | gone |",
        "| error | DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES | — | bad |",
      ].join("\n"),
    )
  })
})
