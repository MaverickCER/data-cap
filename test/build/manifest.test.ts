import { describe, expect, it } from "vitest"
import { findManifestExportCollisions, renderManifest } from "../../src/build/manifest.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: "features/user/user-capability.ts",
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

/** Every `CapabilityNode.file` above is root-relative (OUT-01); this is what they're relative TO. */
const ROOT = "/project"

describe("renderManifest", () => {
  it("starts with the generated-file banner", () => {
    const content = renderManifest(inventory([]), "/project/generated/manifest.ts", ROOT)
    expect(content).toMatch(/^\/\/ GENERATED FILE/)
  })

  it("imports and re-exports every active capability with a relative import specifier", () => {
    const content = renderManifest(
      inventory([capability()]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    expect(content).toContain(
      'import { userCapability } from "../features/user/user-capability.js"',
    )
    expect(content).toContain("export { userCapability }")
    expect(content).toContain("export const manifest = [userCapability] as const")
  })

  it("emits a real local binding for every name `manifest` references (never a bare re-export)", () => {
    // A `export {x} from "..."` re-export forwards a binding without
    // introducing a local one, so `manifest`'s own array literal would
    // reference undeclared names and the generated file wouldn't compile.
    const content = renderManifest(
      inventory([
        capability({ exportName: "aCapability", file: "a.ts" }),
        capability({ exportName: "bCapability", file: "b.ts" }),
      ]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    expect(content).not.toContain("export {  } from")
    for (const name of ["aCapability", "bCapability"]) {
      expect(content).toContain(`import { ${name} } from`)
    }
    expect(content).toContain("export { aCapability, bCapability }")
    expect(content).toContain("export const manifest = [aCapability, bCapability] as const")
  })

  it("emits no export list at all when there is no active capability to name", () => {
    const content = renderManifest(inventory([]), "/project/generated/manifest.ts", ROOT)
    expect(content).not.toContain("export {")
    expect(content).toContain("export const manifest = [] as const")
  })

  it("omits an inactive capability entirely", () => {
    const content = renderManifest(
      inventory([capability({ active: false })]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    expect(content).not.toContain("userCapability")
    expect(content).toContain("export const manifest = [] as const")
  })

  it("sorts active capabilities deterministically by file then export name", () => {
    const content = renderManifest(
      inventory([
        capability({ exportName: "zCapability", file: "features/z.ts" }),
        capability({ exportName: "aCapability", file: "features/a.ts" }),
      ]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    const aIndex = content.indexOf("aCapability")
    const zIndex = content.indexOf("zCapability")
    expect(aIndex).toBeGreaterThan(-1)
    expect(aIndex).toBeLessThan(zIndex)
  })

  it("breaks a tie on export name when two capabilities share the same file", () => {
    const content = renderManifest(
      inventory([
        capability({ exportName: "zCapability", file: "shared.ts" }),
        capability({ exportName: "aCapability", file: "shared.ts" }),
      ]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    expect(content.indexOf("aCapability")).toBeLessThan(content.indexOf("zCapability"))
  })

  it("does not prepend an extra './' when the target file already resolves to a same-directory sibling", () => {
    const content = renderManifest(
      inventory([capability({ file: "generated/sibling.ts", exportName: "sibling" })]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    expect(content).toContain('import { sibling } from "./sibling.js"')
  })

  it("resolves a root-relative capability file against root before relating it to the output dir (OUT-01)", () => {
    // The regression this guards: computing the specifier straight from the
    // stored root-relative `file` would produce "../src/user.js" (relative to
    // the output dir interpreted as if it were root), not the correct
    // "../src/user.js" from /project/generated -- and would be silently wrong
    // for any output directory at a different depth.
    const content = renderManifest(
      inventory([capability({ file: "src/user.ts", exportName: "userCapability" })]),
      "/project/generated/nested/manifest.ts",
      ROOT,
    )
    expect(content).toContain('import { userCapability } from "../../src/user.js"')
  })

  it("still resolves a capability discovered OUTSIDE root (a --package origin, left absolute)", () => {
    const content = renderManifest(
      inventory([capability({ file: "/elsewhere/pkg/src/user.ts", exportName: "pkgCapability" })]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    expect(content).toContain('import { pkgCapability } from "../../elsewhere/pkg/src/user.js"')
  })

  it("produces byte-identical output across repeated calls (determinism)", () => {
    const inv = inventory([capability(), capability({ exportName: "b", file: "b.ts" })])
    expect(renderManifest(inv, "/project/generated/manifest.ts", ROOT)).toBe(
      renderManifest(inv, "/project/generated/manifest.ts", ROOT),
    )
  })

  it("only rewrites a trailing .ts/.tsx extension, never a .ts inside a directory name", () => {
    const content = renderManifest(
      inventory([
        capability({ file: "features/my.ts.helpers/user.ts", exportName: "userCapability" }),
      ]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    expect(content).toContain('from "../features/my.ts.helpers/user.js"')
  })

  it("renders the whole manifest file exactly", () => {
    const content = renderManifest(
      inventory([
        capability({ exportName: "zCapability", file: "features/z.tsx" }),
        capability({ exportName: "aCapability", file: "features/a.ts" }),
        capability({ exportName: "ghostCapability", file: "features/ghost.ts", active: false }),
      ]),
      "/project/generated/manifest.ts",
      ROOT,
    )
    expect(content).toMatchInlineSnapshot(`
      "// GENERATED FILE -- do not edit by hand. Run \`npx data-cap\` to regenerate.

      import { aCapability } from "../features/a.js"
      import { zCapability } from "../features/z.js"

      export { aCapability, zCapability }

      export const manifest = [aCapability, zCapability] as const
      "
    `)
  })
})

describe("findManifestExportCollisions", () => {
  it("finds no collisions when every active export name is unique", () => {
    const collisions = findManifestExportCollisions(
      inventory([
        capability({ exportName: "a", file: "a.ts" }),
        capability({ exportName: "b", file: "b.ts" }),
      ]),
    )
    expect(collisions.size).toBe(0)
  })

  it("finds a collision when two different active capability files export the same name", () => {
    const collisions = findManifestExportCollisions(
      inventory([
        capability({ exportName: "userCapability", file: "a.ts" }),
        capability({ exportName: "userCapability", file: "b.ts" }),
      ]),
    )
    expect(collisions.get("userCapability")).toEqual(["a.ts", "b.ts"])
  })

  it("lists colliding files in sorted order regardless of capability array order", () => {
    const collisions = findManifestExportCollisions(
      inventory([
        capability({ exportName: "userCapability", file: "z.ts" }),
        capability({ exportName: "userCapability", file: "a.ts" }),
        capability({ exportName: "userCapability", file: "m.ts" }),
      ]),
    )
    expect(collisions.get("userCapability")).toEqual(["a.ts", "m.ts", "z.ts"])
  })

  it("ignores an inactive capability when checking for collisions", () => {
    const collisions = findManifestExportCollisions(
      inventory([
        capability({ exportName: "userCapability", file: "a.ts", active: true }),
        capability({ exportName: "userCapability", file: "b.ts", active: false }),
      ]),
    )
    expect(collisions.size).toBe(0)
  })
})
