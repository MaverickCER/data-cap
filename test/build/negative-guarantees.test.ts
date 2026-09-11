/**
 * The consolidated "never" checklist for this session's Parts 1-3 (see the
 * approved plan's own "Negative guarantees for Parts 1-3" section) -- the
 * same convention ADR 0047 established for this codebase's own hard
 * invariants, extended rather than reinvented. Each guarantee below gets
 * its own test here, not just an assertion in a planning document. Filled
 * in incrementally as each part lands; guarantees 3/4/6/7 depend on Part
 * 2A/2B/3's own modules and are added alongside those parts.
 *
 * Guarantee 6 (the enterprise-platform evidence projection is deterministic
 * and fully source-backed) is NOT a test in this file -- `examples/` is a
 * separate npm project this suite can't import from (its own
 * `node_modules`, not installed by the root `npm ci`; see
 * `test/examples/support.ts`'s own header comment). It's verified for real
 * instead, on every `npm start`, by
 * `examples/enterprise-platform/main-headless.ts` itself: a second
 * `generateEvidenceReport()` call diffed byte-for-byte against the first,
 * plus a per-field check that every claimed `consumptionStatus` is backed
 * by the one evidence array that status actually means. A thrown assertion
 * there fails `test/examples/enterprise-platform.test.ts` the same way any
 * other regression would.
 *
 * Guarantee 7 (schema/model changes are intentional pre-1.0 changes, not
 * compatibility hazards) is a process guarantee, not a unit-testable one --
 * evidenced by the in-place breaking renames made throughout this session
 * (`DependencyEdge.line` -> `position`, `FieldDocs`'s index-signature
 * removal, etc.), never a compatibility shim or a deprecated-alias path.
 *
 * Guarantees 8/9 are this session's own additions (`DataFlowEndpoint.handling`
 * and `documentData`'s real operation-name checking), added alongside those
 * features rather than retrofitted later.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildInventory } from "../../src/build/inventory.js"
import { checkOwnershipAndSensitivity } from "../../src/build/static-rules.js"
import { deriveUsageFindings } from "../../src/build/usage-report.js"
import { verifyDynamicAccessCitations } from "../../src/build/citation-verification.js"
import { parseCapabilityFile } from "../../src/build/parse.js"
import { buildFlowGraph } from "../../src/build/flow-graph.js"
import { linkCapabilityFiles } from "../../src/build/link.js"
import type { DiscoveredCapability, LinkResult } from "../../src/build/link.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

/** `root` is what `buildInventory` relativizes each capability's `file` against (OUT-01) -- every fixture below declares its files under `/project`. */
function linkResult(capabilities: readonly DiscoveredCapability[]): LinkResult {
  return { root: "/project", capabilities, warnings: [] }
}

function discovered(overrides: Partial<DiscoveredCapability> = {}): DiscoveredCapability {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    kind: "buildData",
    fieldsShape: undefined,
    operationNames: undefined,
    operationWrites: undefined,
    operationPresence: undefined,
    declarationPosition: { line: 1, column: 1 },
    fieldPositions: undefined,
    documentedBy: undefined,
    docs: undefined,
    ...overrides,
  }
}

describe("Negative guarantee 1 -- metadata is never semantically interpreted (ADR 0051)", () => {
  it("two capabilities differing only in metadata contents produce identical ownership/sensitivity findings", () => {
    const baseDocs = {
      owner: "identity-team",
      sensitivity: "restricted",
      protections: "encrypted at rest",
      purpose: "account management",
      legalBasis: "contract",
    }
    const inventoryA = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { email: "" },
          docs: { ...baseDocs, metadata: { a: 1 } },
        }),
      ]),
    )
    const inventoryB = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { email: "" },
          docs: {
            ...baseDocs,
            metadata: { totallyDifferentShape: "x", nested: { list: [1, 2, 3] } },
          },
        }),
      ]),
    )
    expect(checkOwnershipAndSensitivity(inventoryA)).toEqual(
      checkOwnershipAndSensitivity(inventoryB),
    )
  })

  it("a capability with no metadata at all produces the same findings as one with a non-empty metadata bag", () => {
    const docsWithout = {
      owner: "identity-team",
      sensitivity: "restricted",
      protections: "encrypted at rest",
      purpose: "account management",
      legalBasis: "contract",
    }
    const inventoryWithout = buildInventory(
      linkResult([discovered({ fieldsShape: { email: "" }, docs: docsWithout })]),
    )
    const inventoryWith = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { email: "" },
          docs: { ...docsWithout, metadata: { anything: "at all" } },
        }),
      ]),
    )
    expect(checkOwnershipAndSensitivity(inventoryWithout)).toEqual(
      checkOwnershipAndSensitivity(inventoryWith),
    )
  })
})

describe("Negative guarantee 5 -- compliance semantics stay out of the analyzer (ADR 0051)", () => {
  it("legalBasis/dataResidency content never affects findings -- only presence matters", () => {
    const makeInventory = (legalBasis: string, dataResidency: string) =>
      buildInventory(
        linkResult([
          discovered({
            fieldsShape: { email: "" },
            docs: {
              owner: "identity-team",
              sensitivity: "restricted",
              protections: "encrypted at rest",
              purpose: "account management",
              legalBasis,
              dataResidency,
            },
          }),
        ]),
      )
    const findingsA = checkOwnershipAndSensitivity(makeInventory("consent", "us"))
    const findingsB = checkOwnershipAndSensitivity(
      makeInventory("not-a-real-legal-basis", "nowhere-real"),
    )
    expect(findingsA).toEqual(findingsB)
  })

  it("SENSITIVE_FIELD_MISSING_PURPOSE/LEGAL_BASIS/AUDIT_REQUIRED_WITHOUT_OWNER messages never claim adequacy or legal validity", () => {
    const inventory = buildInventory(
      linkResult([
        discovered({
          fieldsShape: { email: "" },
          docs: { fields: { email: { sensitivity: "restricted", auditRequired: true } } },
        }),
      ]),
    )
    const codes = new Set([
      "SENSITIVE_FIELD_MISSING_PURPOSE",
      "SENSITIVE_FIELD_MISSING_LEGAL_BASIS",
      "AUDIT_REQUIRED_WITHOUT_OWNER",
    ])
    const relevant = checkOwnershipAndSensitivity(inventory).filter((f) => codes.has(f.code))
    expect(relevant.length).toBe(3)
    const forbidden = /\b(sufficient|adequate|compliant|legally valid|verified|enforced)\b/i
    for (const finding of relevant) {
      expect(finding.message).not.toMatch(forbidden)
    }
  })
})

describe('Negative guarantee 2 -- UNCONSUMED_FIELD never regresses into "probably unused" (ADR 0052)', () => {
  function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
    return {
      file: "user.ts",
      exportName: "userCapability",
      kind: "buildData",
      docs: undefined,
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
          writtenBy: [{ kind: "getter", name: "getUser" }],
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
      relationship: "imports",
      from: "consumer.ts",
      // Root-relative, matching what `buildInventory` publishes (OUT-01) --
      // an absolute `file` here would silently fail to correlate with the
      // inventory's own capability key.
      to: { capability: { file: "user.ts", exportName: "userCapability" } },
      resolution: "resolved",
      position: undefined,
      ...overrides,
    }
  }

  it("UNCONSUMED_FIELD fires only for the genuinely-unconsumed state -- any dynamic-access uncertainty downgrades to FIELD_ACCESS_INDETERMINATE instead", () => {
    const findings = deriveUsageFindings(inventory([capability()]), [
      edge({
        relationship: "imports",
        resolution: "indeterminate",
        position: { line: 1, column: 1 },
      }),
    ])
    expect(findings.some((f) => f.code === "UNCONSUMED_FIELD")).toBe(false)
    expect(findings.some((f) => f.code === "FIELD_ACCESS_INDETERMINATE")).toBe(true)
  })

  it("UNCONSUMED_FIELD's message text is unchanged from before the five-state model existed", () => {
    const findings = deriveUsageFindings(inventory([capability()]), [edge()])
    expect(findings.find((f) => f.code === "UNCONSUMED_FIELD")?.message).toBe(
      'Field "email" on "userCapability" is written but never statically read in the scanned project.',
    )
  })
})

describe("Negative guarantee 3 -- a field's declaration position is never inferred when fields is identifier-resolved (ADR 0052)", () => {
  it("fieldPositions is undefined, not guessed, when fields crosses an identifier boundary in the same file", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const userFields = { id: "", email: "" };\nexport const userCapability = createData({ fields: userFields });`,
    )
    const call = result.createDataCalls[0]!
    expect(call.fieldsRef.kind).toBe("identifier")
    expect(call.fieldPositions).toBeUndefined()
  })

  it("an identifier-resolved capability's own fields still get no declarationPosition on any FieldNode, even though the capability's own call site does", () => {
    const inventory = buildInventory({
      root: "/project",
      capabilities: [
        {
          file: "/project/user.ts",
          exportName: "userCapability",
          kind: "buildData",
          fieldsShape: { id: "", email: "" },
          operationNames: undefined,
          operationWrites: undefined,
          operationPresence: undefined,
          declarationPosition: { line: 2, column: 1 },
          fieldPositions: undefined,
          documentedBy: undefined,
          docs: undefined,
        },
      ],
      warnings: [],
    })
    expect(inventory.capabilities[0]!.declarationPosition).toEqual({ line: 2, column: 1 })
    for (const field of inventory.capabilities[0]!.fields) {
      expect(field.declarationPosition).toBeUndefined()
    }
  })
})

describe("Negative guarantee 4 -- a dynamicAccess citation existing and hash-matching is never presented as proof (ADR 0053)", () => {
  it("FIELD_DYNAMIC_ACCESS_DECLARED's message never claims verification or proof", () => {
    const inventory = buildInventory({
      root: "/project",
      capabilities: [
        {
          file: "/project/user.ts",
          exportName: "userCapability",
          kind: "buildData",
          fieldsShape: { email: "" },
          operationNames: { getters: ["getUser"], mutators: [], subscriptions: [] },
          operationWrites: {
            getters: [{ name: "getUser", writes: { email: true } }],
            mutators: [],
            subscriptions: [],
          },
          operationPresence: undefined,
          declarationPosition: { line: 1, column: 1 },
          fieldPositions: undefined,
          documentedBy: undefined,
          docs: { evidence: { fields: { email: { dynamicAccess: ["legacy.ts:1:1"] } } } },
        },
      ],
      warnings: [],
    })
    const edge: DependencyEdge = {
      relationship: "imports",
      from: "consumer.ts",
      // Root-relative, matching what `buildInventory` publishes (OUT-01) --
      // an absolute `file` here would silently fail to correlate with the
      // inventory's own capability key.
      to: { capability: { file: "user.ts", exportName: "userCapability" } },
      resolution: "resolved",
      position: undefined,
    }
    const findings = deriveUsageFindings(inventory, [edge])
    const declared = findings.find((f) => f.code === "FIELD_DYNAMIC_ACCESS_DECLARED")
    expect(declared).toBeDefined()
    const forbidden = /\b(verified|proven|proof|confirmed to be correct)\b/i
    expect(declared?.message).not.toMatch(forbidden)
  })

  it("verifyDynamicAccessCitations never claims a passing check proves the described access, only that the citation itself currently checks out", async () => {
    // A passing check (matching hash) produces NO finding at all -- see
    // citation-verification.test.ts's own dedicated coverage of this. The
    // guarantee here is about the FAILURE-path messages: even reporting
    // that a citation is missing/stale never phrases it as "the access was
    // never proven" -- it stays scoped to the citation's own integrity.
    const findings = await verifyDynamicAccessCitations(
      buildInventory({
        root: "/project",
        capabilities: [
          {
            file: "/project/user.ts",
            exportName: "userCapability",
            kind: "buildData",
            fieldsShape: { email: "" },
            operationNames: undefined,
            operationWrites: undefined,
            operationPresence: undefined,
            declarationPosition: { line: 1, column: 1 },
            fieldPositions: undefined,
            documentedBy: undefined,
            docs: {
              evidence: { fields: { email: { dynamicAccess: ["does-not-exist.ts:1:1"] } } },
            },
          },
        ],
        warnings: [],
      }),
      undefined,
      "/tmp",
      nodeBuildFs,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.code).toBe("DYNAMIC_ACCESS_CITATION_MISSING")
    const forbidden = /\b(the access was never proven|access was verified|verified access)\b/i
    expect(findings[0]?.message).not.toMatch(forbidden)
  })
})

describe("Negative guarantee 8 -- a declared endpoint `handling` is never presented as proof of actual encryption/redaction/masking", () => {
  function operation(
    overrides: Partial<CapabilityNode["getters"][number]> = {},
  ): CapabilityNode["getters"][number] {
    return {
      kind: "getter",
      name: "getEmail",
      docs: undefined,
      writes: [["email"]],
      hasProcessor: true,
      hasOptimistic: false,
      endpoints: [{ direction: "input", kind: "api", name: "user-api" }],
      ...overrides,
    }
  }
  function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
    return {
      file: "user.ts",
      exportName: "userCapability",
      kind: "createData",
      docs: undefined,
      active: true,
      exclusiveGroup: undefined,
      declarationPosition: { line: 1, column: 1 },
      fields: [
        {
          path: ["email"],
          docs: undefined,
          owner: { value: undefined, declaredOn: undefined },
          sensitivity: { value: "restricted", declaredOn: "capability" },
          purpose: { value: undefined, declaredOn: undefined },
          legalBasis: { value: undefined, declaredOn: undefined },
          dataResidency: { value: undefined, declaredOn: undefined },
          auditRequired: { value: undefined, declaredOn: undefined },
          declarationPosition: undefined,
          writtenBy: [{ kind: "getter", name: "getEmail" }],
          shape: "",
        },
      ],
      getters: [operation()],
      mutators: [],
      subscriptions: [],
      ...overrides,
    }
  }
  function inventory(capabilities: readonly CapabilityNode[]): CapabilityInventory {
    return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
  }

  it("SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING never claims the field IS mishandled/exposed -- only that the declaration is absent", () => {
    const { findings } = buildFlowGraph(inventory([capability()]), [])
    const missing = findings.find((f) => f.code === "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING")
    expect(missing).toBeDefined()
    const forbidden =
      /\b(exposed|leaked|mishandled|insecure|vulnerable|unencrypted|plaintext on the wire)\b/i
    expect(missing?.message).not.toMatch(forbidden)
  })

  it("declaring `handling` produces no finding that claims the declaration was independently verified", () => {
    const withHandling = capability({
      getters: [
        operation({
          endpoints: [{ direction: "input", kind: "api", name: "user-api", handling: "encrypted" }],
        }),
      ],
    })
    const { findings } = buildFlowGraph(inventory([withHandling]), [])
    // SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING must not fire once handling
    // is declared -- but nothing else should appear in its place claiming
    // the encryption itself was checked; the boundary-crossing finding
    // (which fires regardless of handling, since it's about the crossing
    // existing at all) is the only one left, and its own message is
    // covered by this guarantee's sibling assertion below.
    expect(findings.some((f) => f.code === "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING")).toBe(false)
    const forbidden = /\b(verified|proven|confirmed|guaranteed to be encrypted)\b/i
    for (const finding of findings) {
      expect(finding.message).not.toMatch(forbidden)
    }
  })

  it("SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY's own message never changes tone based on whether handling is declared", () => {
    const without = buildFlowGraph(inventory([capability()]), []).findings.find(
      (f) => f.code === "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY",
    )
    const withHandling = capability({
      getters: [
        operation({
          endpoints: [{ direction: "input", kind: "api", name: "user-api", handling: "encrypted" }],
        }),
      ],
    })
    const with_ = buildFlowGraph(inventory([withHandling]), []).findings.find(
      (f) => f.code === "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY",
    )
    expect(without?.message).toBe(with_?.message)
  })
})

describe("Negative guarantee 9 -- documentData's compile-time operation-name checking and link.ts's build-time equivalent never diverge in what they accept", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-negative-guarantee-9-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function writeFile(relativePath: string, content: string): Promise<string> {
    const filePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, "utf8")
    return filePath
  }

  // The exact schema shape test/core/document.test.ts's own compile-time
  // test ("documenting a getter/mutator/subscription name is checked
  // against the real schema...") uses -- `getUser`/`updateEmail` are the
  // only real operation names; `getPost`/`deleteUser` are the same two
  // names that test proves `@ts-expect-error` rejects at compile time.
  // Both layers read from the identical schema object once the shared-
  // schema pattern is used (`documentData(userSchema, docs)`), so what
  // link.ts accepts/rejects here is the same acceptance surface TypeScript's
  // own `keyof` enforces there -- this test is that pairing's build-time
  // half, over source text describing the identical schema.
  const schemaSource = [
    "const userSchema = {",
    '  fields: { email: "" },',
    "  getters: {",
    "    getUser: {",
    '      execute: async () => ({ email: "" }),',
    "      processor: (raw) => raw,",
    "      writes: { email: true },",
    "    },",
    "  },",
    "  mutators: {",
    "    updateEmail: {",
    '      execute: async () => ({ email: "" }),',
    "      processor: (raw) => raw,",
    "      writes: { email: true },",
    "    },",
    "  },",
    "};",
    "export const userCapability = createData(userSchema);",
  ].join("\n")

  it("accepts the same real getter/mutator names the compile-time type accepts (getUser/updateEmail)", async () => {
    const file = await writeFile(
      "user.ts",
      [
        schemaSource,
        'documentData(userSchema, { getters: { getUser: { description: "Fetches the user." } }, mutators: { updateEmail: { description: "Updates the email." } } });',
      ].join("\n"),
    )
    const { warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(warnings).toHaveLength(0)
  })

  it("rejects the same fabricated getter name (getPost) the compile-time @ts-expect-error test rejects", async () => {
    const file = await writeFile(
      "user.ts",
      [
        schemaSource,
        'documentData(userSchema, { getters: { getPost: { description: "Not a real getter on this schema." } } });',
      ].join("\n"),
    )
    const { warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(
      warnings.some(
        (w) => w.message.includes("getPost") && w.message.includes('declared "getters"'),
      ),
    ).toBe(true)
  })

  it("rejects the same fabricated mutator name (deleteUser) the compile-time @ts-expect-error test rejects", async () => {
    const file = await writeFile(
      "user.ts",
      [
        schemaSource,
        'documentData(userSchema, { mutators: { deleteUser: { description: "Not a real mutator on this schema." } } });',
      ].join("\n"),
    )
    const { warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(
      warnings.some(
        (w) => w.message.includes("deleteUser") && w.message.includes('declared "mutators"'),
      ),
    ).toBe(true)
  })
})
