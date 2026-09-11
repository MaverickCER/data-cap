import { describe, expect, it } from "vitest"
import { renderDocumentation } from "../../src/build/docs.js"
import { buildLifecycleModel } from "../../src/build/lifecycle-model.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import type { ManifestChangeReport } from "../../src/build/manifest-snapshot.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"

const ROOT = "/project"

function edge(overrides: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    relationship: "reads-field",
    from: "/project/consumer.ts",
    to: {
      capability: { file: "/project/user.ts", exportName: "userCapability" },
      field: ["email"],
    },
    resolution: "resolved",
    position: { line: 12, column: 5 },
    ...overrides,
  }
}

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

describe("renderDocumentation -- structure", () => {
  it("starts with the markdown generated-file banner and the evidence disclaimer", () => {
    const content = renderDocumentation(inventory([]), ROOT)
    expect(content).toMatch(/^<!-- GENERATED FILE/)
    expect(content).toContain("does not itself establish compliance")
  })

  it("renders a placeholder table of contents when there are no capabilities", () => {
    const content = renderDocumentation(inventory([]), ROOT)
    expect(content).toContain("_No capabilities discovered._")
  })

  it("lists every capability in the table of contents, marking inactive ones", () => {
    const content = renderDocumentation(
      inventory([
        capability({ exportName: "active" }),
        capability({ exportName: "retired", active: false, file: "/project/retired.ts" }),
      ]),
      ROOT,
    )
    expect(content).toContain("[`active`](#active)")
    expect(content).toContain("[`retired`](#retired) _(inactive)_")
  })
})

describe("renderDocumentation -- Evidence Model banner note", () => {
  it("names the Evidence Model by concept only when no --evidence path was requested this run", () => {
    const content = renderDocumentation(inventory([]), ROOT)
    expect(content).toContain("Projected from data-cap's Evidence Model")
    expect(content).not.toContain("This run also wrote it to")
  })

  it("also names the concrete path when this run's own options included --evidence", () => {
    const content = renderDocumentation(
      inventory([]),
      ROOT,
      undefined,
      undefined,
      "/project/docs/data.evidence.json",
    )
    expect(content).toContain("Projected from data-cap's Evidence Model")
    // Rendered root-relative, never as the machine-specific absolute path (OUT-01).
    expect(content).toContain("This run also wrote it to `docs/data.evidence.json`.")
  })
})

describe("renderDocumentation -- capability summary", () => {
  it("renders the file path relative to root, owner, category, active, and description", () => {
    const content = renderDocumentation(
      inventory([
        capability({
          docs: {
            category: "identity",
            description: "The user capability.",
            owner: "identity-team",
          },
        }),
      ]),
      ROOT,
    )
    expect(content).toContain("*user.ts*")
    expect(content).not.toContain("/project/user.ts")
    expect(content).toContain("Owner: identity-team")
    expect(content).toContain("Category: identity")
    expect(content).toContain("Active: yes")
    expect(content).toContain("The user capability.")
  })

  it("falls back to the absolute path, unchanged, for a file outside root", () => {
    const content = renderDocumentation(
      inventory([capability({ file: "/elsewhere/user.ts" })]),
      ROOT,
    )
    expect(content).toContain("*/elsewhere/user.ts*")
  })

  it("renders (unowned) when no owner is declared", () => {
    const content = renderDocumentation(inventory([capability()]), ROOT)
    expect(content).toContain("Owner: (unowned)")
  })

  it("renders the exclusive group and sensitivity when declared", () => {
    const content = renderDocumentation(
      inventory([
        capability({ exclusiveGroup: "user-backend", docs: { sensitivity: "restricted" } }),
      ]),
      ROOT,
    )
    expect(content).toContain("Exclusive group: user-backend")
    expect(content).toContain("Sensitivity (declared): restricted")
  })

  it("omits the exclusive group / sensitivity lines and description when undeclared", () => {
    const content = renderDocumentation(inventory([capability()]), ROOT)
    expect(content).not.toContain("Exclusive group:")
    expect(content).not.toContain("Sensitivity (declared):")
  })
})

describe("renderDocumentation -- fields table", () => {
  it("omits the Fields section entirely when a capability has no fields", () => {
    const content = renderDocumentation(inventory([capability({ fields: [] })]), ROOT)
    expect(content).not.toContain("#### Fields")
  })

  it("renders a field row with description/owner/sensitivity/protections/retention/writers", () => {
    const content = renderDocumentation(
      inventory([
        capability({
          fields: [
            field({
              path: ["email"],
              owner: { value: "identity-team", declaredOn: "field" },
              sensitivity: { value: "confidential", declaredOn: "field" },
              docs: {
                description: "The user's email.",
                sensitivity: "confidential",
                protections: "redacted in logs",
                retention: "account lifetime",
              },
              writtenBy: [{ kind: "getter", name: "getUser" }],
            }),
          ],
        }),
      ]),
      ROOT,
    )
    expect(content).toContain("#### Fields")
    expect(content).toContain("`email`")
    expect(content).toContain("The user's email.")
    expect(content).toContain("identity-team")
    expect(content).toContain("confidential")
    expect(content).toContain("redacted in logs")
    expect(content).toContain("account lifetime")
    expect(content).toContain("`getter:getUser`")
  })

  it("renders placeholders for an undocumented, unowned, unwritten field", () => {
    const content = renderDocumentation(inventory([capability({ fields: [field()] })]), ROOT)
    expect(content).toContain("(unowned)")
    expect(content).toContain("not documented")
    expect(content).toContain("(none found)")
  })

  it("renders '(not scanned)' in the Consumed at column when edges wasn't supplied at all (--docs alone, no usage scan)", () => {
    const content = renderDocumentation(inventory([capability({ fields: [field()] })]), ROOT)
    expect(content).toContain("(not scanned)")
  })

  it("renders '(none found)' in the Consumed at column when edges was supplied but nothing targets this field", () => {
    const content = renderDocumentation(
      inventory([capability({ fields: [field()] })]),
      ROOT,
      undefined,
      [],
    )
    expect(content).toMatch(/\| \(none found\) \|$/m)
  })

  it("renders the exact, root-relative file:line:column of every proven consumption site for a field, one file per site", () => {
    const content = renderDocumentation(
      inventory([capability({ fields: [field({ path: ["email"] })] })]),
      ROOT,
      undefined,
      [
        edge({ position: { line: 12, column: 5 } }),
        edge({ from: "/project/other-consumer.ts", position: { line: 3, column: 1 } }),
      ],
    )
    expect(content).toContain("consumer.ts:12:5")
    expect(content).toContain("other-consumer.ts:3:1")
    expect(content).not.toContain("/project/consumer.ts:12:5")
  })

  it("collapses two or more consumption sites in the SAME file to 'path (N sites)' instead of listing every citation", () => {
    const content = renderDocumentation(
      inventory([capability({ fields: [field({ path: ["email"] })] })]),
      ROOT,
      undefined,
      [
        edge({ position: { line: 12, column: 5 } }),
        edge({ position: { line: 20, column: 1 } }),
        edge({ position: { line: 33, column: 9 } }),
      ],
    )
    expect(content).toContain("consumer.ts (3 sites)")
    expect(content).not.toContain("consumer.ts:12:5")
  })

  it("never attributes a consumption site from a different capability or a different field", () => {
    const content = renderDocumentation(
      inventory([capability({ fields: [field({ path: ["email"] })] })]),
      ROOT,
      undefined,
      [
        edge({
          to: { capability: { file: "/project/other.ts", exportName: "other" }, field: ["email"] },
        }),
        edge({
          to: {
            capability: { file: "/project/user.ts", exportName: "userCapability" },
            field: ["name"],
          },
        }),
      ],
    )
    expect(content).toContain("(none found)")
    expect(content).not.toContain("consumer.ts:12:5")
  })

  it("escapes a pipe character in a description so the table doesn't break", () => {
    const content = renderDocumentation(
      inventory([capability({ fields: [field({ docs: { description: "before | after" } })] })]),
      ROOT,
    )
    expect(content).toContain("before \\| after")
  })
})

describe("renderDocumentation -- operation tables", () => {
  it("omits a section for an operation kind with no entries", () => {
    const content = renderDocumentation(
      inventory([capability({ getters: [], mutators: [], subscriptions: [] })]),
      ROOT,
    )
    expect(content).not.toContain("#### Getters")
    expect(content).not.toContain("#### Mutators")
    expect(content).not.toContain("#### Subscriptions")
  })

  it("renders getters, mutators, and subscriptions in their own tables", () => {
    const content = renderDocumentation(
      inventory([
        capability({
          getters: [
            operation({
              kind: "getter",
              name: "getUser",
              docs: { description: "Fetches.", source: "GET /user" },
            }),
          ],
          mutators: [
            operation({ kind: "mutator", name: "updateUser", docs: { credentials: "session" } }),
          ],
          subscriptions: [operation({ kind: "subscription", name: "subscribeToUser" })],
        }),
      ]),
      ROOT,
    )
    expect(content).toContain("#### Getters")
    expect(content).toContain("`getUser`")
    expect(content).toContain("Fetches.")
    expect(content).toContain("GET /user")
    expect(content).toContain("#### Mutators")
    expect(content).toContain("`updateUser`")
    expect(content).toContain("session")
    expect(content).toContain("#### Subscriptions")
    expect(content).toContain("`subscribeToUser`")
  })

  it("renders declared endpoints as direction:kind:name", () => {
    const content = renderDocumentation(
      inventory([
        capability({
          getters: [
            operation({
              endpoints: [{ direction: "input", kind: "api", name: "identity-service" }],
            }),
          ],
        }),
      ]),
      ROOT,
    )
    expect(content).toContain("input:api:identity-service")
  })

  it("appends the endpoint's own declared url and handling state when present", () => {
    const content = renderDocumentation(
      inventory([
        capability({
          getters: [
            operation({
              endpoints: [
                {
                  direction: "input",
                  kind: "api",
                  name: "identity-service",
                  url: "https://identity.example.com/v1/users/:id",
                  handling: "encrypted",
                },
              ],
            }),
          ],
        }),
      ]),
      ROOT,
    )
    expect(content).toContain(
      "input:api:identity-service https://identity.example.com/v1/users/:id (encrypted)",
    )
  })

  it("omits url/handling entirely when the endpoint doesn't declare them, unchanged from before", () => {
    const content = renderDocumentation(
      inventory([
        capability({
          getters: [
            operation({
              endpoints: [{ direction: "input", kind: "api", name: "identity-service" }],
            }),
          ],
        }),
      ]),
      ROOT,
    )
    expect(content).toMatch(/input:api:identity-service \|/)
  })
})

describe("renderDocumentation -- sensitivity & protections review", () => {
  it("renders a placeholder when nothing declares a sensitivity level", () => {
    const content = renderDocumentation(inventory([capability()]), ROOT)
    expect(content).toContain("_No capability or field declares a `sensitivity` level._")
  })

  it("includes a capability-level sensitivity row with Yes when protections are documented", () => {
    const content = renderDocumentation(
      inventory([capability({ docs: { sensitivity: "restricted", protections: "encrypted" } })]),
      ROOT,
    )
    expect(content).toMatch(/userCapability.*\(capability\).*restricted.*Yes/)
  })

  it("includes a field-level sensitivity row with No when protections are undocumented", () => {
    const content = renderDocumentation(
      inventory([
        capability({
          fields: [
            field({
              path: ["ssn"],
              docs: { sensitivity: "restricted" },
              sensitivity: { value: "restricted", declaredOn: "field" },
            }),
          ],
        }),
      ]),
      ROOT,
    )
    expect(content).toMatch(/userCapability.*ssn.*restricted.*No/)
  })

  it("includes a field that inherits capability-level sensitivity with no per-field override (ADR 0050 regression)", () => {
    const content = renderDocumentation(
      inventory([
        capability({
          docs: { sensitivity: "restricted" },
          fields: [
            field({
              path: ["ssn"],
              docs: undefined,
              sensitivity: { value: "restricted", declaredOn: "capability" },
            }),
          ],
        }),
      ]),
      ROOT,
    )
    expect(content).toMatch(/userCapability.*ssn.*restricted.*No/)
  })
})

describe("renderDocumentation -- changes since last report", () => {
  it("renders a first-report placeholder when changes is undefined", () => {
    const content = renderDocumentation(inventory([]), ROOT, undefined)
    expect(content).toContain("_No previous snapshot to compare against (first report)._")
  })

  it("renders a no-changes placeholder when the report is empty", () => {
    const empty: ManifestChangeReport = {
      addedCapabilities: [],
      removedCapabilities: [],
      updatedCapabilities: [],
    }
    const content = renderDocumentation(inventory([]), ROOT, empty)
    expect(content).toContain("_No changes since the last report._")
  })

  it("renders added, removed, and updated sections", () => {
    const changes: ManifestChangeReport = {
      addedCapabilities: ["/project/a.ts#a"],
      removedCapabilities: ["/project/b.ts#b"],
      updatedCapabilities: [
        {
          capability: "/project/c.ts#c",
          changes: ["owner changed from x to y"],
          fields: { added: [], removed: [] },
        },
      ],
    }
    const content = renderDocumentation(inventory([]), ROOT, changes)
    expect(content).toContain("**Added:**")
    expect(content).toContain("/project/a.ts#a")
    expect(content).toContain("**Removed:**")
    expect(content).toContain("/project/b.ts#b")
    expect(content).toContain("**Updated:**")
    expect(content).toContain("owner changed from x to y")
  })
})

describe("renderDocumentation -- Lifecycle section (EVD-05)", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z")

  function lifecycleFor(capabilities: readonly CapabilityNode[]) {
    return buildLifecycleModel(inventory(capabilities), 30, NOW)
  }

  it("says so explicitly when no lifecycle model was supplied, rather than rendering an empty table", () => {
    const content = renderDocumentation(inventory([]), ROOT)
    expect(content).toContain("## Lifecycle")
    expect(content).toContain("Lifecycle data was not computed for this report")
  })

  it("reports nothing expiring when no expiresAt falls in the window", () => {
    const content = renderDocumentation(
      inventory([]),
      ROOT,
      undefined,
      undefined,
      undefined,
      lifecycleFor([]),
    )
    expect(content).toContain("Nothing declares an `expiresAt` within the configured window")
  })

  it("renders days remaining for an upcoming expiry", () => {
    const capabilities = [capability({ docs: { expiresAt: "2026-01-15" } })]
    const content = renderDocumentation(
      inventory(capabilities),
      ROOT,
      undefined,
      undefined,
      undefined,
      lifecycleFor(capabilities),
    )
    expect(content).toContain("2026-01-15")
    expect(content).toContain("**14d remaining**")
  })

  it("renders an already-passed expiry as expired, never silently omitting it", () => {
    const capabilities = [capability({ docs: { expiresAt: "2025-12-02" } })]
    const content = renderDocumentation(
      inventory(capabilities),
      ROOT,
      undefined,
      undefined,
      undefined,
      lifecycleFor(capabilities),
    )
    expect(content).toContain("**expired 30d ago**")
  })

  it("lists a deprecated capability and a renamed field in the deprecation table", () => {
    const capabilities = [
      capability({
        docs: { deprecated: true, deprecatedReason: "superseded by profileData" },
        fields: [
          {
            path: ["contactEmail"],
            docs: { renamedFrom: "email", removeBy: "2026-06-01" },
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
    ]
    const content = renderDocumentation(
      inventory(capabilities),
      ROOT,
      undefined,
      undefined,
      undefined,
      lifecycleFor(capabilities),
    )
    expect(content).toContain("superseded by profileData")
    expect(content).toContain("`contactEmail`")
    expect(content).toContain("2026-06-01")
    expect(content).toContain("email")
  })

  it("says nothing is deprecated when nothing declares it", () => {
    const capabilities = [capability({ docs: { expiresAt: "2026-01-15" } })]
    const content = renderDocumentation(
      inventory(capabilities),
      ROOT,
      undefined,
      undefined,
      undefined,
      lifecycleFor(capabilities),
    )
    expect(content).toContain("No capability or field is declared deprecated or renamed")
  })
})

describe("renderDocumentation -- full-catalog snapshot", () => {
  // One maximal fixture exercising every branch of every renderer, pinned
  // character-for-character. Anything that quietly reworded a heading, a
  // separator, a placeholder, a table column, an operator, or the arithmetic
  // in the lifecycle "Nd remaining"/"expired Nd ago" status fails here -- the
  // per-behaviour `toContain` tests above stay for legibility, this proves the
  // exact rendered document.
  const NOW = new Date("2026-01-01T00:00:00.000Z")

  const capabilities: readonly CapabilityNode[] = [
    capability({
      file: "/project/src/user.ts",
      exportName: "userCapability",
      active: true,
      exclusiveGroup: "user-backend",
      docs: {
        owner: "identity-team",
        category: "identity",
        description: "The user capability. Pipes | through.",
        sensitivity: "restricted",
        protections: "encrypted at rest",
      },
      fields: [
        field({
          path: ["email"],
          owner: { value: "identity-team", declaredOn: "field" },
          sensitivity: { value: "confidential", declaredOn: "field" },
          docs: {
            description: "The user's email | address.",
            sensitivity: "confidential",
            protections: "redacted in logs",
            retention: "account lifetime",
          },
          writtenBy: [
            { kind: "getter", name: "getUser" },
            { kind: "mutator", name: "updateUser" },
          ],
        }),
        field({
          path: ["ssn"],
          sensitivity: { value: "restricted", declaredOn: "field" },
          // sensitivity declared, protections NOT -> "No" in the review;
          // field-level expiresAt on the same day as NOW -> "0d remaining".
          docs: { sensitivity: "restricted", expiresAt: "2026-01-01" },
        }),
        field({
          // A nested (multi-segment) field path that also carries a newline in
          // its description, a declared sensitivity, an upcoming expiry, and a
          // deprecation with no rename -- so the `path.join(".")`, the
          // newline->space cell escape, the review row, the lifecycle expiry
          // row, and the `deprecated === true` deprecation row all render for
          // a path that is only correct when joined with ".".
          path: ["address", "street"],
          sensitivity: { value: "confidential", declaredOn: "field" },
          docs: {
            description: "Street\nline two.",
            sensitivity: "confidential",
            expiresAt: "2026-01-10",
            deprecated: true,
            deprecatedReason: "use structuredAddress",
          },
        }),
        field({ path: ["displayName"] }),
      ],
      getters: [
        operation({
          kind: "getter",
          name: "getUser",
          docs: { description: "Fetches the user.", source: "GET /user", credentials: "session" },
          endpoints: [
            {
              direction: "input",
              kind: "api",
              name: "identity-service",
              url: "https://identity.example.com/v1/users/:id",
              handling: "encrypted",
            },
            { direction: "output", kind: "queue", name: "user-read" },
          ],
        }),
        operation({ kind: "getter", name: "listUsers" }),
      ],
      mutators: [
        operation({
          kind: "mutator",
          name: "updateUser",
          endpoints: [{ direction: "output", kind: "api", name: "identity-service" }],
        }),
      ],
      subscriptions: [operation({ kind: "subscription", name: "subscribeToUser" })],
    }),
    capability({
      file: "/project/src/audit.ts",
      exportName: "auditCapability",
      active: true,
      // sensitivity declared at the capability, protections NOT -> "No" row.
      docs: { sensitivity: "internal" },
      fields: [
        // deprecated === false with no renamedFrom -> must NOT appear in the
        // deprecation table (kills `field.deprecated !== true` -> `!== false`
        // and `... !== true` -> `true`).
        field({ path: ["trailId"], docs: { deprecated: false } }),
      ],
    }),
    capability({
      file: "/project/src/legacy.ts",
      exportName: "legacyCapability",
      active: false,
      docs: {
        deprecated: true,
        deprecatedReason: "superseded by userCapability",
        expiresAt: "2025-12-02",
      },
    }),
    capability({
      file: "/project/src/profile.ts",
      exportName: "profileCapability",
      docs: { expiresAt: "2026-01-15" },
      fields: [
        field({
          path: ["contactEmail"],
          docs: { renamedFrom: "email", removeBy: "2026-06-01", deprecatedReason: "renamed" },
        }),
      ],
    }),
  ]

  const changes: ManifestChangeReport = {
    addedCapabilities: ["/project/src/profile.ts#profileCapability"],
    removedCapabilities: ["/project/src/billing.ts#billingCapability"],
    updatedCapabilities: [
      {
        capability: "/project/src/user.ts#userCapability",
        changes: ["owner changed from platform to identity-team", "gained field `ssn`"],
        fields: { added: ["ssn"], removed: [] },
      },
    ],
  }

  // email is read from one site in header.ts and two in profile.ts -> the
  // single-site branch AND the "(N sites)" collapse branch both render.
  const edges: readonly DependencyEdge[] = [
    edge({
      from: "/project/src/pages/profile.ts",
      to: {
        capability: { file: "/project/src/user.ts", exportName: "userCapability" },
        field: ["email"],
      },
      position: { line: 12, column: 5 },
    }),
    edge({
      from: "/project/src/pages/profile.ts",
      to: {
        capability: { file: "/project/src/user.ts", exportName: "userCapability" },
        field: ["email"],
      },
      position: { line: 40, column: 9 },
    }),
    edge({
      from: "/project/src/pages/header.ts",
      to: {
        capability: { file: "/project/src/user.ts", exportName: "userCapability" },
        field: ["email"],
      },
      position: { line: 7, column: 1 },
    }),
  ]

  it("renders the whole document exactly", () => {
    const content = renderDocumentation(
      inventory(capabilities),
      ROOT,
      changes,
      edges,
      "/project/docs/data.evidence.json",
      buildLifecycleModel(inventory(capabilities), 30, NOW),
    )
    expect(content).toMatchInlineSnapshot(`
      "<!-- GENERATED FILE -- do not edit by hand. Run \`npx data-cap\` to regenerate. -->

      > Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

      > Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to \`docs/data.evidence.json\`.

      # Data Capability Catalog

      ## Changes since last report

      **Added:**
      - \`/project/src/profile.ts#profileCapability\`

      **Removed:**
      - \`/project/src/billing.ts#billingCapability\`

      **Updated:**
      - \`/project/src/user.ts#userCapability\`: owner changed from platform to identity-team; gained field \`ssn\`

      ## Table of contents

      - [\`userCapability\`](#usercapability)
      - [\`auditCapability\`](#auditcapability)
      - [\`legacyCapability\`](#legacycapability) _(inactive)_
      - [\`profileCapability\`](#profilecapability)

      ## Catalog

      ### \`userCapability\`

      *src/user.ts*

      Owner: identity-team · Category: identity · Active: yes · Exclusive group: user-backend · Sensitivity (declared): restricted

      The user capability. Pipes | through.

      #### Fields

      | Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
      | --- | --- | --- | --- | --- | --- | --- | --- |
      | \`email\` | The user's email \\| address. | identity-team | confidential | redacted in logs | account lifetime | \`getter:getUser\`, \`mutator:updateUser\` | src/pages/header.ts:7:1<br/>src/pages/profile.ts (2 sites) |
      | \`ssn\` | — | (unowned) | restricted | not documented | not documented | (none found) | (none found) |
      | \`address.street\` | Street line two. | (unowned) | confidential | not documented | not documented | (none found) | (none found) |
      | \`displayName\` | — | (unowned) | — | not documented | not documented | (none found) | (none found) |

      #### Getters

      | Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
      | --- | --- | --- | --- | --- |
      | \`getUser\` | Fetches the user. | GET /user | session | input:api:identity-service https://identity.example.com/v1/users/:id (encrypted), output:queue:user-read |
      | \`listUsers\` | — | — | — | — |

      #### Mutators

      | Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
      | --- | --- | --- | --- | --- |
      | \`updateUser\` | — | — | — | output:api:identity-service |

      #### Subscriptions

      | Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
      | --- | --- | --- | --- | --- |
      | \`subscribeToUser\` | — | — | — | — |

      ### \`auditCapability\`

      *src/audit.ts*

      Owner: (unowned) · Category: — · Active: yes · Sensitivity (declared): internal

      #### Fields

      | Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
      | --- | --- | --- | --- | --- | --- | --- | --- |
      | \`trailId\` | — | (unowned) | — | not documented | not documented | (none found) | (none found) |

      ### \`legacyCapability\`

      *src/legacy.ts*

      Owner: (unowned) · Category: — · Active: no

      ### \`profileCapability\`

      *src/profile.ts*

      Owner: (unowned) · Category: — · Active: yes

      #### Fields

      | Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
      | --- | --- | --- | --- | --- | --- | --- | --- |
      | \`contactEmail\` | — | (unowned) | — | not documented | not documented | (none found) | (none found) |

      ## Sensitivity & protections review

      | Capability | Field | Sensitivity (declared) | Protections documented? |
      | --- | --- | --- | --- |
      | \`userCapability\` | (capability) | restricted | Yes |
      | \`userCapability\` | \`email\` | confidential | Yes |
      | \`userCapability\` | \`ssn\` | restricted | No |
      | \`userCapability\` | \`address.street\` | confidential | No |
      | \`auditCapability\` | (capability) | internal | No |

      ## Lifecycle

      | Subject | Expires (declared) | Status |
      | --- | --- | --- |
      | \`legacyCapability\` (capability) | 2025-12-02 | **expired 30d ago** |
      | \`userCapability\`.\`ssn\` | 2026-01-01 | **0d remaining** |
      | \`userCapability\`.\`address.street\` | 2026-01-10 | **9d remaining** |
      | \`profileCapability\` (capability) | 2026-01-15 | **14d remaining** |

      | Capability | Field | Reason (declared) | Remove by (declared) | Renamed from |
      | --- | --- | --- | --- | --- |
      | \`legacyCapability\` | (capability) | superseded by userCapability | — | — |
      | \`profileCapability\` | \`contactEmail\` | renamed | 2026-06-01 | email |
      | \`userCapability\` | \`address.street\` | use structuredAddress | — | — |
      "
    `)
  })

  it("renders an added-only change report (no Removed/Updated headers, no trailing blank)", () => {
    const content = renderDocumentation(inventory([]), ROOT, {
      addedCapabilities: ["/project/a.ts#a"],
      removedCapabilities: [],
      updatedCapabilities: [],
    })
    expect(sliceChanges(content)).toMatchInlineSnapshot(`
      "## Changes since last report

      **Added:**
      - \`/project/a.ts#a\`

      "
    `)
  })

  it("renders a removed-only change report", () => {
    const content = renderDocumentation(inventory([]), ROOT, {
      addedCapabilities: [],
      removedCapabilities: ["/project/b.ts#b"],
      updatedCapabilities: [],
    })
    expect(sliceChanges(content)).toMatchInlineSnapshot(`
      "## Changes since last report

      **Removed:**
      - \`/project/b.ts#b\`

      "
    `)
  })

  it("renders an updated-only change report", () => {
    const content = renderDocumentation(inventory([]), ROOT, {
      addedCapabilities: [],
      removedCapabilities: [],
      updatedCapabilities: [
        { capability: "/project/c.ts#c", changes: ["a", "b"], fields: { added: [], removed: [] } },
      ],
    })
    expect(sliceChanges(content)).toMatchInlineSnapshot(`
      "## Changes since last report

      **Updated:**
      - \`/project/c.ts#c\`: a; b

      "
    `)
  })

  it("attributes a consumption site only when relationship, capability file, capability export, field, and position all match", () => {
    const target = capability({
      file: "/project/src/user.ts",
      exportName: "userCapability",
      fields: [field({ path: ["email"] })],
    })
    const base = {
      relationship: "reads-field" as const,
      from: "/project/src/consumer.ts",
      to: {
        capability: { file: "/project/src/user.ts", exportName: "userCapability" },
        field: ["email"],
      },
      resolution: "resolved" as const,
      position: { line: 9, column: 3 },
    }
    const nearMisses: readonly DependencyEdge[] = [
      { ...base, relationship: "calls-getter" },
      {
        ...base,
        to: { ...base.to, capability: { ...base.to.capability, file: "/project/src/other.ts" } },
      },
      {
        ...base,
        to: { ...base.to, capability: { ...base.to.capability, exportName: "otherCapability" } },
      },
      { ...base, to: { ...base.to, field: ["name"] } },
      { ...base, to: { ...base.to, field: undefined } },
      { ...base, position: undefined },
    ]
    const content = renderDocumentation(inventory([target]), ROOT, undefined, nearMisses)
    expect(content).toMatch(/\| \(none found\) \|$/m)
    expect(content).not.toContain("consumer.ts:9:3")

    const content2 = renderDocumentation(inventory([target]), ROOT, undefined, [base])
    expect(content2).toContain("src/consumer.ts:9:3")
  })
})

/**
 * The exact bytes between the "## Changes since last report" heading and the
 * "## Table of contents" heading -- deliberately un-trimmed so the change
 * renderer's own trailing-blank handling (its `.trim()`) is part of what the
 * permutation snapshots pin.
 */
function sliceChanges(doc: string): string {
  const from = doc.indexOf("## Changes since last report")
  const to = doc.indexOf("## Table of contents")
  return doc.slice(from, to)
}
