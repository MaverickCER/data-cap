import path from "node:path"
import { describe, expect, it } from "vitest"
import { generateFlow } from "../../src/build/generate-flow.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

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

function operation(overrides: Partial<OperationNode> = {}): OperationNode {
  return {
    kind: "getter",
    name: "getUser",
    docs: undefined,
    writes: [],
    hasProcessor: false,
    hasOptimistic: false,
    endpoints: [],
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

describe("generateFlow", () => {
  it("always emits overview.mmd and overview.md", () => {
    const result = generateFlow({
      inventory: inventory([]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
    })
    const paths = result.files.map((f) => f.path)
    expect(paths).toContain(path.join("/project/docs/flow", "overview.mmd"))
    expect(paths).toContain(path.join("/project/docs/flow", "overview.md"))
  })

  it("emits one file per active capability under capabilities/, none for an inactive one", () => {
    const result = generateFlow({
      inventory: inventory([
        capability({ exportName: "active" }),
        capability({ exportName: "retired", active: false, file: "/project/retired.ts" }),
      ]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
    })
    const capabilityFiles = result.files.filter((f) =>
      f.path.includes(`${path.sep}capabilities${path.sep}`),
    )
    expect(capabilityFiles.map((f) => f.path)).toEqual([
      path.join("/project/docs/flow", "capabilities", "active.mmd"),
    ])
  })

  it("emits one file per distinct sensitivity level actually present, sanitized as a filename", () => {
    const result = generateFlow({
      inventory: inventory([
        capability({
          fields: [
            field({
              path: ["ssn"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
            field({
              path: ["notes"],
              docs: { sensitivity: "needs review!" },
              sensitivity: { value: "needs review!", declaredOn: "field" },
            }),
          ],
        }),
      ]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
    })
    const sensitivityFiles = result.files
      .filter((f) => f.path.includes(`${path.sep}sensitivity${path.sep}`))
      .map((f) => path.basename(f.path))
      .sort()
    expect(sensitivityFiles).toEqual(["needs_review_.mmd", "restricted.mmd"])
  })

  it("emits no sensitivity files when nothing declares a sensitivity level", () => {
    const result = generateFlow({
      inventory: inventory([capability()]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
    })
    expect(result.files.some((f) => f.path.includes(`${path.sep}sensitivity${path.sep}`))).toBe(
      false,
    )
  })

  it("returns only its own findings, not the additionalFindings passed in", () => {
    const result = generateFlow({
      inventory: inventory([
        capability({
          fields: [
            field({
              path: ["ssn"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              writes: [["ssn"]],
              endpoints: [{ direction: "input", kind: "api", name: "x", handling: "encrypted" }],
            }),
          ],
        }),
      ]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
      additionalFindings: [
        {
          code: "CAPABILITY_MISSING_OWNER",
          family: "governance",
          severity: "warning",
          message: "unrelated",
        },
      ],
    })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]!.code).toBe("SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY")
  })

  it("folds its own findings into the rendered Security Data-Flow Review even when additionalFindings is omitted", () => {
    const result = generateFlow({
      inventory: inventory([
        capability({
          fields: [
            field({
              path: ["ssn"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
          getters: [
            operation({
              writes: [["ssn"]],
              endpoints: [{ direction: "input", kind: "api", name: "x", handling: "encrypted" }],
            }),
          ],
        }),
      ]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
    })
    const overview = result.files.find((f) => f.path.endsWith("overview.md"))!
    expect(overview.content).toContain("SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY")
  })

  it("folds both its own and additionalFindings into the rendered Security Data-Flow Review", () => {
    const result = generateFlow({
      inventory: inventory([capability()]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
      additionalFindings: [
        {
          code: "CAPABILITY_MISSING_OWNER",
          family: "governance",
          severity: "warning",
          message: "no owner declared",
        },
      ],
    })
    const overview = result.files.find((f) => f.path.endsWith("overview.md"))!
    expect(overview.content).toContain("no owner declared")
  })

  it("renders 'None.' placeholders for empty severity groups", () => {
    const result = generateFlow({
      inventory: inventory([]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
    })
    const overview = result.files.find((f) => f.path.endsWith("overview.md"))!
    expect(overview.content).toMatch(/### Critical \(error\)\n\n_None\._/)
  })

  it("embeds the overview diagram inside a fenced mermaid block in overview.md", () => {
    const result = generateFlow({
      inventory: inventory([capability()]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
    })
    const overview = result.files.find((f) => f.path.endsWith("overview.md"))!
    expect(overview.content).toContain("```mermaid")
    expect(overview.content).toContain("flowchart TB")
  })

  it("starts overview.md with the markdown banner and evidence disclaimer", () => {
    const result = generateFlow({
      inventory: inventory([]),
      root: "/project",
      location: "/project/docs/flow",
      edges: [],
    })
    const overview = result.files.find((f) => f.path.endsWith("overview.md"))!
    expect(overview.content).toMatch(/^<!-- GENERATED FILE/)
    expect(overview.content).toContain("does not itself establish compliance")
  })

  describe("exact artifact set", () => {
    function generated() {
      return generateFlow({
        inventory: inventory([
          capability({
            file: "/project/src/user.ts",
            exportName: "userCapability",
            fields: [
              field({
                path: ["ssn"],
                sensitivity: { value: "restricted", declaredOn: "field" },
              }),
              field({
                path: ["email"],
                sensitivity: { value: "confidential", declaredOn: "field" },
              }),
            ],
            getters: [
              operation({
                name: "getUser",
                writes: [["ssn"], ["email"]],
                endpoints: [{ direction: "input", kind: "api", name: "identity svc!" }],
              }),
            ],
          }),
          capability({
            file: "/project/src/legacy.ts",
            exportName: "legacyCapability",
            active: false,
          }),
        ]),
        root: "/project",
        location: "/project/docs/flow",
        edges: [],
        additionalFindings: [
          {
            code: "EXCLUSIVE_GROUP_CONFLICT",
            family: "structural",
            severity: "error",
            message: "boom",
          },
          {
            code: "NONSTANDARD_SENSITIVITY_LEVEL",
            family: "governance",
            severity: "info",
            message: "fyi",
          },
        ],
        evidencePath: "/project/docs/data.evidence.json",
      })
    }

    it("emits exactly this set of file paths (per-capability skips the inactive one; one file per sensitivity level, name-sanitized)", () => {
      expect(generated().files.map((f) => f.path)).toMatchInlineSnapshot(`
        [
          "/project/docs/flow/overview.mmd",
          "/project/docs/flow/overview.md",
          "/project/docs/flow/capabilities/userCapability.mmd",
          "/project/docs/flow/sensitivity/restricted.mmd",
          "/project/docs/flow/sensitivity/confidential.mmd",
        ]
      `)
    })

    it("returns only this pass's own findings, never the folded-in additionalFindings", () => {
      expect(generated().findings.map((f) => f.code)).toMatchInlineSnapshot(`
        [
          "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY",
          "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING",
          "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY",
          "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING",
        ]
      `)
    })

    it("renders overview.md verbatim -- banner, disclaimer, review groups by severity, fenced diagram", () => {
      const overview = generated().files.find((f) => f.path.endsWith("overview.md"))!
      expect(overview.content).toMatchInlineSnapshot(`
        "<!-- GENERATED FILE -- do not edit by hand. Run \`npx data-cap\` to regenerate. -->

        > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

        > Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to \`docs/data.evidence.json\`.

        # Data Flow Diagram & Security Data-Flow Review

        This report cannot trace data *through* a third-party system once it reaches an external-service/api endpoint -- what that system does with it afterward is unknowable to a static scan of one repository. It does not assign a regulatory classification, since that's jurisdiction-specific; record it in a capability's \`metadata\` instead (see \`specs/decisions/0049-capability-metadata-vocabulary.md\`).

        ## Security Data-Flow Review

        ### Critical (error)

        - **EXCLUSIVE_GROUP_CONFLICT**: boom

        ### Warnings

        - **SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY**: Field "ssn" on "userCapability" is sensitivity "restricted" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.
        - **SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING**: Field "ssn" on "userCapability" is sensitivity "restricted" and has 1 declared boundary-crossing endpoint(s) with no declared "handling" -- state how this field's data is protected at each crossing (plaintext/masked/redacted/hashed/encrypted).
        - **SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY**: Field "email" on "userCapability" is sensitivity "confidential" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.
        - **SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING**: Field "email" on "userCapability" is sensitivity "confidential" and has 1 declared boundary-crossing endpoint(s) with no declared "handling" -- state how this field's data is protected at each crossing (plaintext/masked/redacted/hashed/encrypted).

        ### Informational

        - **NONSTANDARD_SENSITIVITY_LEVEL**: fyi

        ## System overview diagram

        \`\`\`mermaid
        %% System overview -- declared endpoints and proven consumers per capability
        flowchart TB
          subgraph boundary["Trust Boundary (proven, in-repo)"]
            n0(["userCapability"])
            n1[/"ssn"/]
            n3(["getter: getUser"])
            n4[/"email"/]
          end
          n2[["identity svc!<br/><em>api</em>"]]
          n2 -.->|"declared: ssn"| n3
          n3 -.->|"writes"| n1
          n2 -.->|"declared: email"| n3
          n3 -.->|"writes"| n4
          linkStyle 0 stroke:#e63946,stroke-width:3px
          linkStyle 2 stroke:#e63946,stroke-width:3px
        \`\`\`
        "
      `)
    })
  })
})
