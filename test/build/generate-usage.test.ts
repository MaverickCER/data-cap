import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generateUsage } from "../../src/build/generate-usage.js"
import { nodeBuildFs } from "../support/build-filesystem.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

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

describe("generateUsage", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-generate-usage-test-"))
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

  it("scans real files, renders content, and surfaces derived findings", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const result = await generateUsage({
      inventory: inventory([capability({ file: path.relative(root, capabilityFile) })]),
      location: "/project/docs/OWNERSHIP.md",
      files: [capabilityFile],
      scan: { fs: nodeBuildFs, root, tsconfig: false },
    })
    expect(result.location).toBe("/project/docs/OWNERSHIP.md")
    expect(result.content).toContain("Dependency & Ownership Report")
    expect(result.edges).toEqual([])
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "ABANDONED_CAPABILITY" }),
    )
  })

  it("carries each capability's getter/mutator/subscription names into the scan, so operation calls are recognized", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      `import { userCapability } from "./user.js";\n` +
        `userCapability.getUser();\nuserCapability.setUser();\nuserCapability.onUser();`,
    )
    const result = await generateUsage({
      inventory: inventory([
        capability({
          file: path.relative(root, capabilityFile),
          getters: [
            {
              kind: "getter",
              name: "getUser",
              docs: undefined,
              writes: [],
              hasProcessor: false,
              hasOptimistic: false,
              endpoints: [],
            },
          ],
          mutators: [
            {
              kind: "mutator",
              name: "setUser",
              docs: undefined,
              writes: [],
              hasProcessor: false,
              hasOptimistic: false,
              endpoints: [],
            },
          ],
          subscriptions: [
            {
              kind: "subscription",
              name: "onUser",
              docs: undefined,
              writes: [],
              hasProcessor: false,
              hasOptimistic: false,
              endpoints: [],
            },
          ],
        }),
      ]),
      location: "/project/docs/OWNERSHIP.md",
      files: [capabilityFile, consumerFile],
      scan: { fs: nodeBuildFs, root, tsconfig: false },
    })
    expect(result.edges.map((e) => e.relationship).sort()).toEqual([
      "calls-getter",
      "calls-mutator",
      "calls-subscription",
    ])
  })

  it("finds a real consumer edge end to end", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      `import { userCapability } from "./user.js";\nuserCapability.fields.email;`,
    )
    const result = await generateUsage({
      inventory: inventory([capability({ file: path.relative(root, capabilityFile) })]),
      location: "/project/docs/OWNERSHIP.md",
      files: [capabilityFile, consumerFile],
      scan: { fs: nodeBuildFs, root, tsconfig: false },
    })
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]!.relationship).toBe("reads-field")
    expect(result.findings.some((f) => f.code === "ABANDONED_CAPABILITY")).toBe(false)
  })

  it("finds a consumer edge inside an allow-listed package's own directory, and renders the scan surface (ADR 0053)", async () => {
    await writeFile("package.json", JSON.stringify({ name: "fixture-root", private: true }))
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    await writeFile(
      "node_modules/@fixtures/pkg-a/package.json",
      JSON.stringify({
        name: "@fixtures/pkg-a",
        main: "./index.js",
        dataCap: { schema: "./data.schema.ts" },
      }),
    )
    await writeFile("node_modules/@fixtures/pkg-a/index.js", "module.exports = {};\n")
    await writeFile(
      "node_modules/@fixtures/pkg-a/data.schema.ts",
      `export const pkgACapability = createData({ fields: { id: "" } });`,
    )
    await writeFile(
      "node_modules/@fixtures/pkg-a/consumer.ts",
      `import { userCapability } from "../../../user.js";\nuserCapability.fields.email;`,
    )

    const result = await generateUsage({
      inventory: inventory([capability({ file: path.relative(root, capabilityFile) })]),
      location: "/project/docs/OWNERSHIP.md",
      files: [capabilityFile],
      scan: { fs: nodeBuildFs, root, tsconfig: false, packages: ["@fixtures/pkg-a"] },
    })
    expect(result.edges.some((e) => e.relationship === "reads-field")).toBe(true)
    expect(result.findings.some((f) => f.code === "ABANDONED_CAPABILITY")).toBe(false)
    expect(result.content).toContain("Scanned: application source, @fixtures/pkg-a")
  })
})
