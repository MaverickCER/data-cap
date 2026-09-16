import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import ts from "typescript"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  checkDocFieldsAgainstShape,
  checkDocOperationsAgainstShape,
  LinkContext,
  linkCapabilityFiles,
  sameIdentifierRef,
  schemaRefFromExpression,
} from "../../src/build/link.js"
import { parseCapabilityFile } from "../../src/build/parse.js"
import type { ParseWarning, ParseResult } from "../../src/build/parse.js"
import { createAliasResolutionCache } from "../../src/build/resolution/resolve-tsconfig-paths.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

describe("linkCapabilityFiles", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-link-test-"))
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

  async function writeJson(relativePath: string, value: unknown): Promise<void> {
    await writeFile(relativePath, JSON.stringify(value, null, 2))
  }

  it("resolves an inline fields object literal", async () => {
    const file = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { id: "", email: "" } });`,
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]!.exportName).toBe("userCapability")
    expect(capabilities[0]!.fieldsShape).toEqual({ id: "", email: "" })
    expect(warnings).toHaveLength(0)
  })

  it('resolves a buildData() call, tagged with kind: "buildData", operationNames undefined', async () => {
    const file = await writeFile(
      "user.ts",
      `export const userCapability = buildData({ fields: { id: "" } });`,
    )
    const { capabilities } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.kind).toBe("buildData")
    expect(capabilities[0]!.operationNames).toBeUndefined()
  })

  it("resolves a createData() call's static operation catalog alongside its fields shape", async () => {
    const file = await writeFile(
      "user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: { execute: getUser, writes: { id: true } } },
        mutators: { updateUser: { execute: updateUser } },
      });
      `,
    )
    const { capabilities } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.kind).toBe("createData")
    expect(capabilities[0]!.fieldsShape).toEqual({ id: "" })
    expect(capabilities[0]!.operationNames).toEqual({
      getters: ["getUser"],
      mutators: ["updateUser"],
      subscriptions: [],
    })
  })

  it("resolves fields referenced via a same-file local const", async () => {
    const file = await writeFile(
      "user.ts",
      `const userFields = { id: "" };\nexport const userCapability = createData({ fields: userFields });`,
    )
    const { capabilities } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toEqual({ id: "" })
  })

  it("resolves fields imported from another file via a RELATIVE import", async () => {
    await writeFile("shared.ts", `export const userFields = { id: "", email: "" };`)
    const file = await writeFile(
      "user.ts",
      `import { userFields } from "./shared.js";\nexport const userCapability = createData({ fields: userFields });`,
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toEqual({ id: "", email: "" })
    expect(warnings).toHaveLength(0)
  })

  it("follows a same-file identifier chain (const a = b, both local)", async () => {
    const file = await writeFile(
      "user.ts",
      [
        `const inner = { id: "" };`,
        `const userFields = inner;`,
        `export const userCapability = createData({ fields: userFields });`,
      ].join("\n"),
    )
    const { capabilities } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toEqual({ id: "" })
  })

  it("follows an identifier chain across a relative import (const userFields = importedIdentifier)", async () => {
    await writeFile("shared.ts", `export const rawFields = { id: "" };`)
    const file = await writeFile(
      "user.ts",
      [
        `import { rawFields } from "./shared.js";`,
        `const userFields = rawFields;`,
        `export const userCapability = createData({ fields: userFields });`,
      ].join("\n"),
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toEqual({ id: "" })
    expect(warnings).toHaveLength(0)
  })

  it("warns when 'fields' resolves to a namespace-imported identifier (not staticaly resolvable)", async () => {
    await writeFile("shared.ts", `export const userFields = { id: "" };`)
    const file = await writeFile(
      "user.ts",
      [
        `import * as shared from "./shared.js";`,
        `export const userCapability = createData({ fields: shared });`,
      ].join("\n"),
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toBeUndefined()
    expect(warnings.some((w) => w.message.includes("namespace/default import"))).toBe(true)
  })

  it("warns when 'fields' resolves to a default-imported identifier (not statically resolvable)", async () => {
    await writeFile("shared.ts", `const userFields = { id: "" };\nexport default userFields;`)
    const file = await writeFile(
      "user.ts",
      [
        `import userFields from "./shared.js";`,
        `export const userCapability = createData({ fields: userFields });`,
      ].join("\n"),
    )
    const { warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(warnings.some((w) => w.message.includes("namespace/default import"))).toBe(true)
  })

  it("warns when the imported name is not found as a top-level const in the resolved file", async () => {
    await writeFile("shared.ts", `export const somethingElseEntirely = { id: "" };`)
    const file = await writeFile(
      "user.ts",
      [
        `import { userFields } from "./shared.js";`,
        `export const userCapability = createData({ fields: userFields });`,
      ].join("\n"),
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toBeUndefined()
    expect(warnings.some((w) => w.message.includes("was not found as a top-level const"))).toBe(
      true,
    )
  })

  it("warns when 'fields' resolves to a value that is neither an object literal nor an identifier (e.g. a function call result)", async () => {
    const file = await writeFile(
      "user.ts",
      [
        `const userFields = computeFields();`,
        `export const userCapability = createData({ fields: userFields });`,
      ].join("\n"),
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toBeUndefined()
    expect(
      warnings.some((w) => w.message.includes("not statically resolvable to an object literal")),
    ).toBe(true)
  })

  it("warns when the fields ref itself is unresolvable (e.g. a direct function-call argument, no intermediate identifier)", async () => {
    const file = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: computeFields() });`,
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toBeUndefined()
    expect(warnings.some((w) => w.message.includes('Could not statically resolve "fields"'))).toBe(
      true,
    )
  })

  it("warns when the inline fields object literal contains a non-literal-evaluable property", async () => {
    const file = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { id: someIdentifier } });`,
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toBeUndefined()
    expect(warnings.some((w) => w.message.includes("not fully statically evaluable"))).toBe(true)
  })

  it("warns and stops once an identifier chain exceeds the maximum resolvable depth (also protects against a genuine cycle)", async () => {
    const file = await writeFile(
      "user.ts",
      [
        `const a = b;`,
        `const b = a;`, // genuine cycle -- depth-limiting is what prevents an infinite loop here
        `export const userCapability = createData({ fields: a });`,
      ].join("\n"),
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toBeUndefined()
    expect(warnings.some((w) => w.message.includes("exceeds the maximum resolvable depth"))).toBe(
      true,
    )
  })

  it("warns when the fields identifier is neither a local const nor a recognized import", async () => {
    const file = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: whateverUndeclaredIdentifier });`,
    )
    const { capabilities, warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(capabilities[0]!.fieldsShape).toBeUndefined()
    expect(
      warnings.some((w) => w.message.includes("neither a local const nor a recognized import")),
    ).toBe(true)
  })

  describe("release-blocking: TypeScript path-alias resolution", () => {
    it("resolves fields imported via a tsconfig.json '@/*' path alias -- the same resolveImportSpecifier chokepoint env-cap's own ADR 0023 exercises", async () => {
      await writeJson("tsconfig.json", {
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      })
      await writeFile(
        "src/features/user/schema.ts",
        `export const userFields = { id: "", email: "" };`,
      )
      const file = await writeFile(
        "src/features/user/capability.ts",
        `import { userFields } from "@/features/user/schema.js";\nexport const userCapability = createData({ fields: userFields });`,
      )

      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
      })

      expect(warnings).toHaveLength(0)
      expect(capabilities).toHaveLength(1)
      expect(capabilities[0]!.fieldsShape).toEqual({ id: "", email: "" })
    })

    it("warns (never silently guesses) when the alias specifier cannot be resolved", async () => {
      await writeJson("tsconfig.json", {
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      })
      const file = await writeFile(
        "capability.ts",
        `import { userFields } from "@/does-not-exist.js";\nexport const userCapability = createData({ fields: userFields });`,
      )

      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
      })

      expect(capabilities[0]!.fieldsShape).toBeUndefined()
      expect(warnings.some((w) => w.message.includes("@/does-not-exist.js"))).toBe(true)
    })

    it("respects an explicit tsconfig override path for a monorepo whose config isn't at root", async () => {
      await writeJson("config/tsconfig.custom.json", {
        compilerOptions: { baseUrl: "..", paths: { "@/*": ["src/*"] } },
      })
      await writeFile("src/schema.ts", `export const userFields = { id: "" };`)
      const file = await writeFile(
        "capability.ts",
        `import { userFields } from "@/schema.js";\nexport const userCapability = createData({ fields: userFields });`,
      )

      const { capabilities } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: "config/tsconfig.custom.json",
      })
      expect(capabilities[0]!.fieldsShape).toEqual({ id: "" })
    })

    it("tsconfig: false disables alias resolution entirely, even with a real tsconfig.json present", async () => {
      await writeJson("tsconfig.json", {
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      })
      await writeFile("src/schema.ts", `export const userFields = { id: "" };`)
      const file = await writeFile(
        "capability.ts",
        `import { userFields } from "@/schema.js";\nexport const userCapability = createData({ fields: userFields });`,
      )

      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.fieldsShape).toBeUndefined()
      expect(warnings.length).toBeGreaterThan(0)
    })
  })

  describe("createData/documentData correlation", () => {
    it("correlates via a shared local fields identifier", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, { name: "user" });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.documentedBy).toEqual({ file })
      expect(warnings).toHaveLength(0)
    })

    it("correlates via the single-pair positional fallback when both use inline literals", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `export const userCapability = createData({ fields: { id: "" } });`,
          `documentData({ fields: { id: "" } }, { name: "user" });`,
        ].join("\n"),
      )
      const { capabilities } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.documentedBy).toEqual({ file })
    })

    it("warns on orphaned documentation -- a documentData call with no correlatable createData", async () => {
      const file = await writeFile(
        "user.ts",
        `documentData({ fields: { id: "" } }, { name: "user" });`,
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings.some((w) => w.message.includes("orphaned documentation"))).toBe(true)
    })

    it("leaves an undocumented capability's documentedBy as undefined, without warning (documentation is optional)", async () => {
      const file = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { id: "" } });`,
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.documentedBy).toBeUndefined()
      expect(warnings).toHaveLength(0)
    })

    it("warns when two documentData calls both correlate to the same createData identifier (duplicate documentation)", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, { name: "first" });`,
          `documentData({ fields: userFields }, { name: "second" });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings.some((w) => w.message.includes("duplicate documentation"))).toBe(true)
    })

    it("warns when documentData documents a field name absent from the capability's own fields shape", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, { fields: { nonExistentField: { description: "x" } } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings.some((w) => w.message.includes("nonExistentField"))).toBe(true)
    })

    it("does not warn when documentData documents a field name that genuinely exists", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, { fields: { id: { description: "The id." } } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings).toHaveLength(0)
    })

    it("warns when documentData documents a getter/mutator/subscription name absent from the capability's own declared operations -- the build-time counterpart to CapabilityDocs' compile-time keyof checking", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = createData({`,
          `  fields: userFields,`,
          `  getters: { getUser: { execute: async () => ({}), processor: (r) => r, writes: { id: true } } },`,
          `});`,
          `documentData({ fields: userFields }, { getters: { getPost: { description: "not real" } } });`,
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

    it("does not warn when documentData documents a getter name that genuinely exists", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = createData({`,
          `  fields: userFields,`,
          `  getters: { getUser: { execute: async () => ({}), processor: (r) => r, writes: { id: true } } },`,
          `});`,
          `documentData({ fields: userFields }, { getters: { getUser: { description: "Fetches the user." } } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings).toHaveLength(0)
    })

    it("never checks operation names against a buildData() capability, which has no operations section at all", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = buildData({ fields: userFields });`,
          `documentData({ fields: userFields }, { getters: { anythingAtAll: { description: "x" } } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings).toHaveLength(0)
    })

    it("works end to end with the whole schema shared as one local const between createData and documentData -- the pattern core/document.ts's own CapabilityDocs generics are designed around", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userSchema = {`,
          `  fields: { id: "" },`,
          `  getters: { getUser: { execute: async () => ({}), processor: (r) => r, writes: { id: true } } },`,
          `};`,
          `export const userCapability = createData(userSchema);`,
          `documentData(userSchema, { getters: { getPost: { description: "not real" } } });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      // The capability's own fields resolve for real -- not silently empty.
      expect(capabilities[0]!.fieldsShape).toEqual({ id: "" })
      expect(capabilities[0]!.operationNames?.getters).toEqual(["getUser"])
      // And the operation-name mismatch check still fires against a shared,
      // identifier-referenced schema, exactly as it does for an inline one.
      expect(
        warnings.some(
          (w) => w.message.includes("getPost") && w.message.includes('declared "getters"'),
        ),
      ).toBe(true)
    })
  })

  describe("docs extraction (governance metadata)", () => {
    it("attaches the extracted CapabilityDocs to a correlated capability", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { email: "" };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, {`,
          `  owner: "identity-team",`,
          `  sensitivity: "restricted",`,
          `  protections: "encrypted at rest",`,
          `  fields: { email: { owner: "identity-team", sensitivity: "restricted" } },`,
          `});`,
        ].join("\n"),
      )
      const { capabilities } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      const docs = capabilities[0]!.docs
      expect(docs?.owner).toBe("identity-team")
      expect(docs?.sensitivity).toBe("restricted")
      expect(docs?.protections).toBe("encrypted at rest")
      expect(docs?.fields?.["email"]?.owner).toBe("identity-team")
      expect(docs?.fields?.["email"]?.sensitivity).toBe("restricted")
    })

    it("leaves docs undefined for an undocumented capability", async () => {
      const file = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { id: "" } });`,
      )
      const { capabilities } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.docs).toBeUndefined()
    })

    it("carries operationWrites through to the discovered capability", async () => {
      const file = await writeFile(
        "user.ts",
        `
        export const userData = createData({
          fields: { user: { email: "" } },
          mutators: { updateEmail: { execute: updateEmail, writes: { user: { email: true } } } },
        });
        `,
      )
      const { capabilities } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.operationWrites?.mutators).toEqual([
        { name: "updateEmail", writes: { user: { email: true } } },
      ])
    })
  })

  describe("multi-file discovery", () => {
    it("links capabilities independently across multiple discovered files", async () => {
      const fileA = await writeFile(
        "a.ts",
        `export const aCapability = createData({ fields: { a: 1 } });`,
      )
      const fileB = await writeFile(
        "b.ts",
        `export const bCapability = createData({ fields: { b: 2 } });`,
      )
      const { capabilities } = await linkCapabilityFiles([fileA, fileB], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities).toHaveLength(2)
      expect(capabilities.map((c) => c.exportName).sort()).toEqual(["aCapability", "bCapability"])
    })

    it("reuses a cached parse when a file is both independently discovered and reached via cross-file resolution", async () => {
      const fileB = await writeFile("b.ts", `export const bFields = { b: 2 };`)
      const fileA = await writeFile(
        "a.ts",
        [
          `import { bFields } from "./b.js";`,
          `export const aCapability = createData({ fields: bFields });`,
        ].join("\n"),
      )
      // b.ts is passed directly (parsed once via the main loop) AND is reached
      // again via a.ts's cross-file "fields" resolution -- the second lookup
      // must hit the parse cache rather than re-reading/re-parsing the file.
      const { capabilities, warnings } = await linkCapabilityFiles([fileA, fileB], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities).toHaveLength(1) // b.ts declares no createData() of its own
      expect(capabilities[0]!.fieldsShape).toEqual({ b: 2 })
      expect(warnings).toHaveLength(0)
    })

    it("skips an unexported createData() call at the link level too (parse.ts already warned about it)", async () => {
      const file = await writeFile(
        "user.ts",
        `const userCapability = createData({ fields: { id: "" } });`,
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities).toHaveLength(0)
      expect(warnings.some((w) => w.message.includes("not exported"))).toBe(true)
    })
  })

  describe("documentData docs.fields structural edge cases", () => {
    it("does not warn when documentData is called with no docs argument at all", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = createData({ fields: userFields });`,
          // Fixture file content, not real code in this test file -- deliberately
          // omits documentData's second (docs) argument to exercise docsNode === undefined.
          `documentData({ fields: userFields });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings).toHaveLength(0)
    })

    it("does not warn when docs.fields is present but not an inline object literal", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `const sharedDocs = { description: "shared" };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, { fields: sharedDocs });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings).toHaveLength(0)
    })
  })

  it("warns when an explicit tsconfig override path does not exist", async () => {
    const file = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { id: "" } });`,
    )
    const { warnings } = await linkCapabilityFiles([file], {
      fs: nodeBuildFs,
      root,
      tsconfig: "does-not-exist.json",
    })
    expect(warnings.some((w) => w.message.includes("does-not-exist.json"))).toBe(true)
  })

  describe("mutation-hardening: field-shape resolution edge cases", () => {
    it("warns (fieldsShape undefined) when an inline fields object literal has a non-evaluable property", async () => {
      const file = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { id: "", computed: makeIt() } });`,
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.fieldsShape).toBeUndefined()
      expect(warnings.some((w) => w.message.includes("not fully statically evaluable"))).toBe(true)
    })

    it("resolves an identifier chain that lands exactly on the maximum resolvable depth", async () => {
      // a -> b -> c -> d -> e -> f -> { id: "" } : six identifier hops, the
      // last of which is checked at `depth === MAX_IDENTIFIER_CHAIN_DEPTH`
      // (must still resolve -- the bound is strictly `>` MAX, not `>=`).
      const file = await writeFile(
        "user.ts",
        [
          `const f = { id: "" };`,
          `const e = f;`,
          `const d = e;`,
          `const c = d;`,
          `const b = c;`,
          `const a = b;`,
          `export const userCapability = createData({ fields: a });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.fieldsShape).toEqual({ id: "" })
      expect(warnings).toHaveLength(0)
    })

    it("still enforces the depth limit one hop deeper (chain of seven)", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const g = { id: "" };`,
          `const f = g;`,
          `const e = f;`,
          `const d = e;`,
          `const c = d;`,
          `const b = c;`,
          `const a = b;`,
          `export const userCapability = createData({ fields: a });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.fieldsShape).toBeUndefined()
      expect(warnings.some((w) => w.message.includes("exceeds the maximum resolvable depth"))).toBe(
        true,
      )
    })

    it("resolveFieldsShape fails fast with a clear error instead of looping forever when its own totalHops fail-safe is exhausted", async () => {
      // MAX_IDENTIFIER_CHAIN_DEPTH always resolves first for any real (even
      // maximally deep or cyclic) identifier chain reachable through
      // `linkCapabilityFiles`, so this internal fail-safe can only be
      // organically exercised by starting `totalHops` already past its
      // ceiling directly -- an "unresolvable" ref hits the guard before
      // `ref.kind` is even inspected, so nothing else about the context
      // needs to be real.
      const context = new LinkContext({
        fs: nodeBuildFs,
        root: "/nonexistent",
        packages: [],
        cache: new Map(),
        tsconfigPaths: undefined,
        aliasCache: createAliasResolutionCache(),
      })
      const dummyParsed: ParseResult = {
        file: "x.ts",
        createDataCalls: [],
        documentDataCalls: [],
        localConsts: new Map(),
        imports: [],
        warnings: [],
      }
      await expect(
        context.resolveFieldsShape(
          { kind: "unresolvable", reason: "test" },
          "x.ts",
          dummyParsed,
          0,
          1_000_000,
        ),
      ).rejects.toThrow("exceeded 50 total resolution hops")
    })

    it("resolveFieldsShape's totalHops fail-safe requires BOTH recursive call sites' own +1 -- starting one short of the ceiling still trips it", async () => {
      // A single same-file identifier hop ("x" -> its own literal) passes
      // through both of resolveFieldsShape's internal `totalHops + 1` call
      // sites (the "local const" branch into `resolveExpression`, then
      // `resolveExpression`'s own call back into `resolveFieldsShape`) --
      // exactly two hops. Starting `totalHops` already at the ceiling means
      // *both* increments are needed to exceed it: if either one were
      // mutated away, this resolves successfully instead of throwing.
      const context = new LinkContext({
        fs: nodeBuildFs,
        root: "/nonexistent",
        packages: [],
        cache: new Map(),
        tsconfigPaths: undefined,
        aliasCache: createAliasResolutionCache(),
      })
      const parsed = parseCapabilityFile("x.ts", `const x = { id: "" };`)
      await expect(
        context.resolveFieldsShape({ kind: "identifier", name: "x" }, "x.ts", parsed, 0, 50),
      ).rejects.toThrow("exceeded 50 total resolution hops")
    })

    it("resolveFieldsShape's totalHops fail-safe also requires the cross-file import branch's own +1", async () => {
      // Same shape as the previous test, but for the *other* branch that
      // calls `resolveExpression` -- a cross-file import hop, not a
      // same-file local const. Requires real files on disk since
      // `resolveImportSpecifier` does real resolution.
      await writeFile("imported.ts", `export const x = { id: "" };`)
      const mainFile = await writeFile("main.ts", `import { x } from "./imported.js";`)
      const context = new LinkContext({
        fs: nodeBuildFs,
        root,
        packages: [],
        cache: new Map(),
        tsconfigPaths: undefined,
        aliasCache: createAliasResolutionCache(),
      })
      const parsed = await context.getParsed(mainFile)
      await expect(
        context.resolveFieldsShape({ kind: "identifier", name: "x" }, mainFile, parsed, 0, 50),
      ).rejects.toThrow("exceeded 50 total resolution hops")
    })

    it("resolves a same-file alias identifier by its real name (const a = b; const b = { ... })", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const realShape = { onlyHere: "" };`,
          `const alias = realShape;`,
          `export const userCapability = createData({ fields: alias });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.fieldsShape).toEqual({ onlyHere: "" })
      expect(warnings).toHaveLength(0)
    })

    it("reports the identifier as unresolved (not a mis-picked import) when a differently-named import exists", async () => {
      await writeFile("other.ts", `export const somethingElse = { x: "" };`)
      const file = await writeFile(
        "user.ts",
        [
          `import { somethingElse } from "./other.js";`,
          `export const userCapability = createData({ fields: unknownIdentifier });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.fieldsShape).toBeUndefined()
      expect(
        warnings.some((w) => w.message.includes("neither a local const nor a recognized import")),
      ).toBe(true)
    })

    it("reuses one parse of a cross-referenced file -- a parse warning it emits appears exactly once", async () => {
      await writeFile(
        "shared.ts",
        [
          `export const sharedFields = { id: "" };`,
          // Not exported -> parse.ts emits a "not exported" warning for this file.
          `const strayCapability = createData({ fields: { stray: "" } });`,
        ].join("\n"),
      )
      const fileA = await writeFile(
        "a.ts",
        [
          `import { sharedFields } from "./shared.js";`,
          `export const aCapability = createData({ fields: sharedFields });`,
        ].join("\n"),
      )
      const sharedPath = path.join(root, "shared.ts")
      const { warnings } = await linkCapabilityFiles([fileA, sharedPath], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings.filter((w) => w.message.includes("not exported"))).toHaveLength(1)
    })
  })

  describe("mutation-hardening: correlation edge cases", () => {
    it("positional fallback ignores an unexported createData() when choosing the sole candidate", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const bareCapability = createData({ fields: { bare: "" } });`,
          `export const realCapability = createData({ fields: { id: "" } });`,
          `documentData({ fields: { id: "" } }, { name: "real" });`,
        ].join("\n"),
      )
      const { capabilities } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      const real = capabilities.find((c) => c.exportName === "realCapability")
      expect(real?.documentedBy).toEqual({ file })
    })

    it("no positional fallback when two createData() calls are still uncorrelated", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `export const capA = createData({ fields: { a: "" } });`,
          `export const capB = createData({ fields: { b: "" } });`,
          `documentData({ fields: { a: "" } }, { name: "x" });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities.every((c) => c.documentedBy === undefined)).toBe(true)
      expect(warnings.some((w) => w.message.includes("orphaned documentation"))).toBe(true)
    })

    it("no positional fallback when two documentData() calls are still unused", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `export const cap = createData({ fields: { id: "" } });`,
          `documentData({ fields: { id: "" } }, { name: "one" });`,
          `documentData({ fields: { id: "" } }, { name: "two" });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.documentedBy).toBeUndefined()
      expect(warnings.filter((w) => w.message.includes("orphaned documentation"))).toHaveLength(2)
    })

    it("does not identifier-correlate a documentData() whose fields identifier differs", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const fieldsA = { a: "" };`,
          `const fieldsB = { b: "" };`,
          `export const capA = createData({ fields: fieldsA });`,
          `export const capB = createData({ fields: fieldsB });`,
          `documentData({ fields: fieldsA }, { name: "a" });`,
        ].join("\n"),
      )
      const { capabilities } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities.find((c) => c.exportName === "capA")?.documentedBy).toEqual({ file })
      expect(capabilities.find((c) => c.exportName === "capB")?.documentedBy).toBeUndefined()
    })

    it("positional fallback still runs after one pair is already identifier-correlated", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const fieldsA = { a: "" };`,
          `export const capA = createData({ fields: fieldsA });`,
          `export const capB = createData({ fields: { b: "" } });`,
          `documentData({ fields: fieldsA }, { name: "a" });`,
          `documentData({ fields: { b: "" } }, { name: "b" });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities.find((c) => c.exportName === "capA")?.documentedBy).toEqual({ file })
      expect(capabilities.find((c) => c.exportName === "capB")?.documentedBy).toEqual({ file })
      expect(warnings).toHaveLength(0)
    })
  })

  describe("mutation-hardening: docs structural checks", () => {
    it("does not crash (and emits no field warning) when docs.fields is present but the capability's own fields shape is unresolvable", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `export const userCapability = createData({ fields: computeFields() });`,
          `documentData(computeFields(), { fields: { ghost: { description: "x" } } });`,
        ].join("\n"),
      )
      const { capabilities, warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(capabilities[0]!.fieldsShape).toBeUndefined()
      expect(warnings.some((w) => w.message.includes("ghost"))).toBe(false)
    })

    it("still finds the docs.fields property (and warns for a ghost field) when a spread precedes it", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `const base = { name: "user" };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, { ...base, fields: { ghostField: { description: "x" } } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings.some((w) => w.message.includes("ghostField"))).toBe(true)
    })

    it("warns for a ghost field written as an object-literal shorthand property", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `const ghostField = { description: "x" };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, { fields: { ghostField } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings.some((w) => w.message.includes("ghostField"))).toBe(true)
    })

    it("does not warn for an existing field written as an object-literal shorthand property", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `const id = { description: "The id." };`,
          `export const userCapability = createData({ fields: userFields });`,
          `documentData({ fields: userFields }, { fields: { id } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings).toHaveLength(0)
    })

    it("warns (with the singular label) for a ghost getter written as a shorthand, spread preceding the section", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `const base = { name: "user" };`,
          `const ghostGetter = { description: "x" };`,
          `export const userCapability = createData({`,
          `  fields: userFields,`,
          `  getters: { getUser: { execute: async () => ({}), processor: (r) => r, writes: { id: true } } },`,
          `});`,
          `documentData({ fields: userFields }, { ...base, getters: { ghostGetter } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(
        warnings.some(
          (w) =>
            w.message.includes('getter "ghostGetter"') && w.message.includes('declared "getters"'),
        ),
      ).toBe(true)
    })

    it("warns for a ghost mutator and a ghost subscription with their own singular labels", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `export const userCapability = createData({`,
          `  fields: userFields,`,
          `  mutators: { setUser: { execute: async () => ({}) } },`,
          `  subscriptions: { onUser: { subscribe: async () => () => {} } },`,
          `});`,
          `documentData({ fields: userFields }, {`,
          `  mutators: { ghostMutator: { description: "x" } },`,
          `  subscriptions: { ghostSub: { description: "y" } },`,
          `});`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings.some((w) => w.message.includes('mutator "ghostMutator"'))).toBe(true)
      expect(warnings.some((w) => w.message.includes('subscription "ghostSub"'))).toBe(true)
    })

    it("does not warn for a getter documented under a shorthand whose name genuinely exists", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `const getUser = { description: "Fetches the user." };`,
          `export const userCapability = createData({`,
          `  fields: userFields,`,
          `  getters: { getUser: { execute: async () => ({}), processor: (r) => r, writes: { id: true } } },`,
          `});`,
          `documentData({ fields: userFields }, { getters: { getUser } });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings).toHaveLength(0)
    })

    it("does not crash when a docs.getters value is not an inline object literal", async () => {
      const file = await writeFile(
        "user.ts",
        [
          `const userFields = { id: "" };`,
          `const sharedGetters = { getUser: { description: "x" } };`,
          `export const userCapability = createData({`,
          `  fields: userFields,`,
          `  getters: { getUser: { execute: async () => ({}), processor: (r) => r, writes: { id: true } } },`,
          `});`,
          `documentData({ fields: userFields }, { getters: sharedGetters });`,
        ].join("\n"),
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings).toHaveLength(0)
    })
  })

  describe("mutation-hardening: options passthrough", () => {
    it("omitting `packages` behaves exactly like passing an empty array (no phantom package warning)", async () => {
      const file = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { id: "" } });`,
      )
      const { warnings } = await linkCapabilityFiles([file], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(warnings.some((w) => w.message.startsWith("(package)"))).toBe(false)
      expect(warnings).toHaveLength(0)
    })
  })
})

describe("sameIdentifierRef", () => {
  const literalRef = () =>
    ({ kind: "literal", node: ts.factory.createObjectLiteralExpression([]) }) as const

  it("is true for two identifier refs naming the same binding", () => {
    expect(
      sameIdentifierRef({ kind: "identifier", name: "x" }, { kind: "identifier", name: "x" }),
    ).toBe(true)
  })

  it("is false for two identifier refs naming different bindings", () => {
    expect(
      sameIdentifierRef({ kind: "identifier", name: "x" }, { kind: "identifier", name: "y" }),
    ).toBe(false)
  })

  it("is false for an identifier ref paired with a non-identifier ref (either order)", () => {
    expect(
      sameIdentifierRef({ kind: "identifier", name: "x" }, { kind: "unresolvable", reason: "w" }),
    ).toBe(false)
    expect(
      sameIdentifierRef({ kind: "unresolvable", reason: "w" }, { kind: "identifier", name: "x" }),
    ).toBe(false)
  })

  it("is false for two distinct literal refs, even though neither has a name", () => {
    expect(sameIdentifierRef(literalRef(), literalRef())).toBe(false)
  })
})

describe("schemaRefFromExpression", () => {
  it("classifies an object-literal expression as a literal ref carrying the node", () => {
    const node = ts.factory.createObjectLiteralExpression([])
    expect(schemaRefFromExpression(node)).toEqual({ kind: "literal", node })
  })

  it("classifies an identifier expression as an identifier ref carrying its text", () => {
    expect(schemaRefFromExpression(ts.factory.createIdentifier("userFields"))).toEqual({
      kind: "identifier",
      name: "userFields",
    })
  })

  it("returns undefined for anything else (a call expression)", () => {
    const call = ts.factory.createCallExpression(
      ts.factory.createIdentifier("makeFields"),
      undefined,
      [],
    )
    expect(schemaRefFromExpression(call)).toBeUndefined()
  })
})

/** Parses `{ ... }` (or any expression) into its AST node for a direct
 *  `checkDoc*AgainstShape` call. */
function exprNode(source: string): ts.Expression {
  const sf = ts.createSourceFile("d.ts", `const _ = ${source}`, ts.ScriptTarget.Latest, true)
  const decl = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0]!
  return decl.initializer!
}

describe("checkDocFieldsAgainstShape (direct)", () => {
  function messagesFor(docs: string, shape: Record<string, unknown> | undefined): string[] {
    const warnings: ParseWarning[] = []
    checkDocFieldsAgainstShape("d.ts", exprNode(docs), shape, warnings)
    return warnings.map((w) => w.message)
  }

  it("warns once per documented field that is absent from the shape", () => {
    expect(messagesFor(`{ fields: { id: {}, ghost: {}, other: {} } }`, { id: "" })).toEqual([
      `documentData() documents field "ghost", which does not exist on the capability's declared "fields" shape.`,
      `documentData() documents field "other", which does not exist on the capability's declared "fields" shape.`,
    ])
  })

  it("does not warn for a field that genuinely exists (assignment or shorthand)", () => {
    expect(messagesFor(`{ fields: { id: { description: "x" } } }`, { id: "" })).toEqual([])
    expect(messagesFor(`{ fields: { id } }`, { id: "" })).toEqual([])
  })

  it("warns for a ghost field written as a shorthand", () => {
    expect(messagesFor(`{ fields: { ghost } }`, { id: "" })).toEqual([
      `documentData() documents field "ghost", which does not exist on the capability's declared "fields" shape.`,
    ])
  })

  it("skips a spread inside docs.fields rather than crashing on it", () => {
    expect(messagesFor(`{ fields: { ...shared, ghost: {} } }`, { id: "" })).toEqual([
      `documentData() documents field "ghost", which does not exist on the capability's declared "fields" shape.`,
    ])
  })

  it('ignores a non-identifier (string-literal) field key rather than warning about "undefined"', () => {
    expect(messagesFor(`{ fields: { "spaced key": {}, ghost: {} } }`, { id: "" })).toEqual([
      `documentData() documents field "ghost", which does not exist on the capability's declared "fields" shape.`,
    ])
  })

  it("finds the fields property past a leading spread / non-fields property", () => {
    expect(messagesFor(`{ ...base, name: "x", fields: { ghost: {} } }`, { id: "" })).toEqual([
      `documentData() documents field "ghost", which does not exist on the capability's declared "fields" shape.`,
    ])
  })

  it("no-ops when docsNode is undefined, the shape is undefined, or docsNode is not an object literal", () => {
    const warnings: ParseWarning[] = []
    checkDocFieldsAgainstShape("d.ts", undefined, { id: "" }, warnings)
    checkDocFieldsAgainstShape("d.ts", exprNode(`{ fields: { ghost: {} } }`), undefined, warnings)
    checkDocFieldsAgainstShape("d.ts", exprNode(`"a string"`), { id: "" }, warnings)
    expect(warnings).toEqual([])
  })

  it("no-ops when docs.fields is absent or is not an inline object literal", () => {
    expect(messagesFor(`{ name: "x" }`, { id: "" })).toEqual([])
    expect(messagesFor(`{ fields: sharedFieldDocs }`, { id: "" })).toEqual([])
  })
})

describe("checkDocOperationsAgainstShape (direct)", () => {
  const declared = { getters: ["getUser"], mutators: ["setUser"], subscriptions: ["onUser"] }
  function messagesFor(
    docs: string,
    operationNames: typeof declared | undefined = declared,
  ): string[] {
    const warnings: ParseWarning[] = []
    checkDocOperationsAgainstShape("d.ts", exprNode(docs), operationNames, warnings)
    return warnings.map((w) => w.message)
  }

  it("warns with the right singular label + section name for a ghost in each section", () => {
    expect(
      messagesFor(
        `{ getters: { ghostG: {} }, mutators: { ghostM: {} }, subscriptions: { ghostS: {} } }`,
      ),
    ).toEqual([
      `documentData() documents getter "ghostG", which does not exist on the capability's declared "getters".`,
      `documentData() documents mutator "ghostM", which does not exist on the capability's declared "mutators".`,
      `documentData() documents subscription "ghostS", which does not exist on the capability's declared "subscriptions".`,
    ])
  })

  it("does not warn for an operation that genuinely exists (assignment or shorthand)", () => {
    expect(messagesFor(`{ getters: { getUser: { description: "x" } } }`)).toEqual([])
    expect(messagesFor(`{ getters: { getUser } }`)).toEqual([])
  })

  it("warns for a ghost getter written as a shorthand", () => {
    expect(messagesFor(`{ getters: { ghostG } }`)).toEqual([
      `documentData() documents getter "ghostG", which does not exist on the capability's declared "getters".`,
    ])
  })

  it("skips a spread inside a section rather than crashing on it", () => {
    expect(messagesFor(`{ getters: { ...shared, ghostG: {} } }`)).toEqual([
      `documentData() documents getter "ghostG", which does not exist on the capability's declared "getters".`,
    ])
  })

  it('ignores a non-identifier (string-literal) operation key rather than warning about "undefined"', () => {
    expect(messagesFor(`{ getters: { "spaced getter": {}, ghostG: {} } }`)).toEqual([
      `documentData() documents getter "ghostG", which does not exist on the capability's declared "getters".`,
    ])
  })

  it("finds a section past a leading spread / non-section property", () => {
    expect(messagesFor(`{ ...base, name: "x", mutators: { ghostM: {} } }`)).toEqual([
      `documentData() documents mutator "ghostM", which does not exist on the capability's declared "mutators".`,
    ])
  })

  it("no-ops when docsNode is undefined, operationNames is undefined, or docsNode is not an object literal", () => {
    const warnings: ParseWarning[] = []
    checkDocOperationsAgainstShape("d.ts", undefined, declared, warnings)
    checkDocOperationsAgainstShape(
      "d.ts",
      exprNode(`{ getters: { ghostG: {} } }`),
      undefined,
      warnings,
    )
    checkDocOperationsAgainstShape("d.ts", exprNode(`42`), declared, warnings)
    expect(warnings).toEqual([])
  })

  it("no-ops when a section is absent or is not an inline object literal", () => {
    expect(messagesFor(`{ name: "x" }`)).toEqual([])
    expect(messagesFor(`{ getters: sharedGetterDocs }`)).toEqual([])
  })
})
