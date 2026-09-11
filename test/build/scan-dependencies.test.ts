import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { scanDependencies } from "../../src/build/scan-dependencies.js"
import { nodeBuildFs } from "../support/build-filesystem.js"
import { generatedBanner } from "../../src/build/generated-banner.js"
import type { ScanTarget } from "../../src/build/dependency-graph.js"

describe("scanDependencies", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-scan-test-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  /**
   * Every edge `scanDependencies` returns is root-relative (OUT-01), while a
   * `ScanTarget` and the file list it scans stay absolute -- so an expectation
   * about an edge goes through this, and one about an input doesn't.
   */
  function rel(absolutePath: string): string {
    return path.relative(root, absolutePath).split(path.sep).join("/")
  }

  async function writeFile(relativePath: string, content: string): Promise<string> {
    const filePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, "utf8")
    return filePath
  }

  it("finds a resolved usage edge when a consumer directly imports the capability's declaring file", async () => {
    const capabilityFile = await writeFile(
      "features/user/user-capability.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      `import { userCapability } from "./features/user/user-capability.js";\nuserCapability.getUser();`,
    )
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "userCapability",
      getterNames: ["getUser"],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const { edges, warnings } = await scanDependencies([capabilityFile, consumerFile], [target], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(warnings).toEqual([])
    expect(edges).toEqual([
      {
        relationship: "calls-getter",
        from: rel(consumerFile),
        to: {
          capability: { file: rel(capabilityFile), exportName: "userCapability" },
          field: undefined,
          operation: "getUser",
        },
        resolution: "resolved",
        position: { line: 2, column: 1 },
      },
    ])
  })

  it("respects a renamed import binding", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      `import { userCapability as user } from "./user.js";\nuser.fields.email;`,
    )
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "userCapability",
      getterNames: [],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const { edges } = await scanDependencies([capabilityFile, consumerFile], [target], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(edges[0]!.relationship).toBe("reads-field")
  })

  it("emits a bare 'imports' edge when the capability is imported but no recognized usage pattern is found", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      `import { userCapability } from "./user.js";\nconsole.log(userCapability);`,
    )
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "userCapability",
      getterNames: [],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const { edges } = await scanDependencies([capabilityFile, consumerFile], [target], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(edges).toEqual([
      {
        relationship: "imports",
        from: rel(consumerFile),
        to: { capability: { file: rel(capabilityFile), exportName: "userCapability" } },
        resolution: "resolved",
        position: undefined,
      },
    ])
  })

  it("synthesizes a bare 'imports' edge only for the imported capability that lacks a real usage edge, not the one that has one", async () => {
    const usedFile = await writeFile(
      "used.ts",
      `export const usedCapability = createData({ fields: { a: "" } });`,
    )
    const unusedFile = await writeFile(
      "unused.ts",
      `export const unusedCapability = createData({ fields: { b: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      [
        `import { usedCapability } from "./used.js";`,
        `import { unusedCapability } from "./unused.js";`,
        `usedCapability.getA();`,
        `console.log(unusedCapability);`,
      ].join("\n"),
    )
    const targets: ScanTarget[] = [
      {
        file: usedFile,
        exportName: "usedCapability",
        getterNames: ["getA"],
        mutatorNames: [],
        subscriptionNames: [],
      },
      {
        file: unusedFile,
        exportName: "unusedCapability",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      },
    ]
    const { edges } = await scanDependencies([usedFile, unusedFile, consumerFile], targets, {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(edges).toEqual([
      {
        relationship: "imports",
        from: rel(consumerFile),
        to: { capability: { file: rel(unusedFile), exportName: "unusedCapability" } },
        resolution: "resolved",
        position: undefined,
      },
      {
        relationship: "calls-getter",
        from: rel(consumerFile),
        to: {
          capability: { file: rel(usedFile), exportName: "usedCapability" },
          field: undefined,
          operation: "getA",
        },
        resolution: "resolved",
        position: { line: 3, column: 1 },
      },
    ])
  })

  it("produces no edges when nothing imports the capability at all", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const unrelatedFile = await writeFile("unrelated.ts", `export const x = 1;`)
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "userCapability",
      getterNames: [],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const { edges } = await scanDependencies([capabilityFile, unrelatedFile], [target], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(edges).toEqual([])
  })

  it("ignores a namespace import -- not traced", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      `import * as userModule from "./user.js";\nuserModule.userCapability.getUser();`,
    )
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "userCapability",
      getterNames: ["getUser"],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const { edges } = await scanDependencies([capabilityFile, consumerFile], [target], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(edges).toEqual([])
  })

  it("ignores a default import -- not traced", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export default createData({ fields: { email: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      `import userCapability from "./user.js";\nuserCapability.getUser();`,
    )
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "default",
      getterNames: ["getUser"],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const { edges } = await scanDependencies([capabilityFile, consumerFile], [target], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(edges).toEqual([])
  })

  it("records an unresolved-consumer match when the imported name matches exactly one target but the specifier doesn't resolve to its file (e.g. a barrel re-export)", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    await writeFile("index.ts", `export { userCapability } from "./user.js";`)
    const consumerFile = await writeFile(
      "consumer.ts",
      `import { userCapability } from "./index.js";\nuserCapability.getUser();`,
    )
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "userCapability",
      getterNames: ["getUser"],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const { edges } = await scanDependencies([capabilityFile, consumerFile], [target], {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(edges).toHaveLength(1)
    expect(edges[0]!.resolution).toBe("unresolved-consumer")
    expect(edges[0]!.relationship).toBe("calls-getter")
  })

  it("does not guess an unresolved-consumer match when two targets share the same export name", async () => {
    const capabilityFileA = await writeFile(
      "a/user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const capabilityFileB = await writeFile(
      "b/user.ts",
      `export const userCapability = createData({ fields: { name: "" } });`,
    )
    const consumerFile = await writeFile(
      "consumer.ts",
      `import { userCapability } from "some-barrel-package";\nuserCapability.getUser();`,
    )
    const targets: ScanTarget[] = [
      {
        file: capabilityFileA,
        exportName: "userCapability",
        getterNames: ["getUser"],
        mutatorNames: [],
        subscriptionNames: [],
      },
      {
        file: capabilityFileB,
        exportName: "userCapability",
        getterNames: ["getUser"],
        mutatorNames: [],
        subscriptionNames: [],
      },
    ]
    const { edges } = await scanDependencies(
      [capabilityFileA, capabilityFileB, consumerFile],
      targets,
      {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      },
    )
    expect(edges).toEqual([])
  })

  it("scans a capability's own file as a potential consumer of another capability (capability-to-capability dependency)", async () => {
    const postFile = await writeFile(
      "post.ts",
      `export const postCapability = createData({ fields: { title: "" } });`,
    )
    const userFile = await writeFile(
      "user.ts",
      [
        `import { postCapability } from "./post.js";`,
        `export const userCapability = createData({ fields: { email: "" } });`,
        `postCapability.getPost();`,
      ].join("\n"),
    )
    const targets: ScanTarget[] = [
      {
        file: postFile,
        exportName: "postCapability",
        getterNames: ["getPost"],
        mutatorNames: [],
        subscriptionNames: [],
      },
      {
        file: userFile,
        exportName: "userCapability",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      },
    ]
    const { edges } = await scanDependencies([postFile, userFile], targets, {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    expect(edges).toEqual([
      {
        relationship: "calls-getter",
        from: rel(userFile),
        to: {
          capability: { file: rel(postFile), exportName: "postCapability" },
          field: undefined,
          operation: "getPost",
        },
        resolution: "resolved",
        position: { line: 3, column: 1 },
      },
    ])
  })

  describe("same-file usage detection", () => {
    it("finds a real usage edge when a capability is declared and read in the same file", async () => {
      const capabilityFile = await writeFile(
        "user.ts",
        [
          `export const userCapability = createData({ fields: { email: "" } });`,
          `userCapability.fields.email;`,
        ].join("\n"),
      )
      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      }
      const { edges } = await scanDependencies([capabilityFile], [target], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(edges).toEqual([
        {
          relationship: "reads-field",
          from: rel(capabilityFile),
          to: {
            capability: { file: rel(capabilityFile), exportName: "userCapability" },
            field: ["email"],
            operation: undefined,
          },
          resolution: "resolved",
          position: { line: 2, column: 1 },
        },
      ])
    })

    it("finds a same-file getter call", async () => {
      const capabilityFile = await writeFile(
        "user.ts",
        [
          `export const userCapability = createData({ fields: { email: "" } });`,
          `userCapability.getUser();`,
        ].join("\n"),
      )
      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: ["getUser"],
        mutatorNames: [],
        subscriptionNames: [],
      }
      const { edges } = await scanDependencies([capabilityFile], [target], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(edges).toEqual([
        {
          relationship: "calls-getter",
          from: rel(capabilityFile),
          to: {
            capability: { file: rel(capabilityFile), exportName: "userCapability" },
            field: undefined,
            operation: "getUser",
          },
          resolution: "resolved",
          position: { line: 2, column: 1 },
        },
      ])
    })

    it("produces zero edges, and no spurious self-'imports' edge, for a capability declared and never used anywhere -- including its own file", async () => {
      const capabilityFile = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      }
      const { edges } = await scanDependencies([capabilityFile], [target], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(edges).toEqual([])
    })
  })

  describe("data-cap's own generated output is never counted as a consumer", () => {
    it("produces no edge from a generated manifest that imports the capability", async () => {
      const capabilityFile = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      // Byte-for-byte what `renderManifest` emits: the banner, a real
      // `import` (so the binding exists for `manifest` below), and the
      // re-export. Without the generated-file skip this would produce an
      // `imports` edge and silently suppress ABANDONED_CAPABILITY.
      await writeFile(
        "src/generated/data.manifest.ts",
        `${generatedBanner("ts")}\n\nimport { userCapability } from "../../user.js"\n\nexport { userCapability }\n\nexport const manifest = [userCapability] as const\n`,
      )
      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      }
      const { edges } = await scanDependencies(
        [capabilityFile, path.join(root, "src/generated/data.manifest.ts")],
        [target],
        { fs: nodeBuildFs, root, tsconfig: false },
      )
      expect(edges).toEqual([])
    })

    it("still counts a hand-written file that merely looks similar", async () => {
      const capabilityFile = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const consumerFile = await writeFile(
        "barrel.ts",
        `import { userCapability } from "./user.js"\nexport { userCapability }\n`,
      )
      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      }
      const { edges } = await scanDependencies([capabilityFile, consumerFile], [target], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(edges).toEqual([
        {
          relationship: "imports",
          from: rel(consumerFile),
          to: { capability: { file: rel(capabilityFile), exportName: "userCapability" } },
          resolution: "resolved",
          position: undefined,
        },
      ])
    })
  })

  it("surfaces a tsconfig warning when an explicit tsconfig path fails to load", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "userCapability",
      getterNames: [],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const { warnings } = await scanDependencies([capabilityFile], [target], {
      fs: nodeBuildFs,
      root,
      tsconfig: "does-not-exist.json",
    })
    expect(warnings.length).toBeGreaterThan(0)
  })

  it("skips an unreadable file without throwing", async () => {
    const capabilityFile = await writeFile(
      "user.ts",
      `export const userCapability = createData({ fields: { email: "" } });`,
    )
    const target: ScanTarget = {
      file: capabilityFile,
      exportName: "userCapability",
      getterNames: [],
      mutatorNames: [],
      subscriptionNames: [],
    }
    const missingFile = path.join(root, "does-not-exist.ts")
    await expect(
      scanDependencies([capabilityFile, missingFile], [target], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      }),
    ).resolves.toBeDefined()
  })

  describe("packages-aware scan surface (ADR 0053)", () => {
    it("scans an allow-listed package's own directory as potential consumer source, not just as an import-resolution target", async () => {
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
      // The package's own consumer file is never in the locally-discovered
      // `files` list passed in -- only reachable by walking the package's
      // own directory, which is exactly what this feature adds.
      await writeFile(
        "node_modules/@fixtures/pkg-a/consumer.ts",
        `import { userCapability } from "../../../user.js";\nuserCapability.getUser();`,
      )

      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: ["getUser"],
        mutatorNames: [],
        subscriptionNames: [],
      }
      const { edges, scannedPackages, warnings } = await scanDependencies(
        [capabilityFile],
        [target],
        { fs: nodeBuildFs, root, tsconfig: false, packages: ["@fixtures/pkg-a"] },
      )
      expect(warnings).toEqual([])
      expect(scannedPackages).toEqual(["@fixtures/pkg-a"])
      expect(edges.some((e) => e.relationship === "calls-getter")).toBe(true)
    })

    it("never counts an unresolvable package as scanned", async () => {
      const capabilityFile = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      }
      const { scannedPackages, warnings } = await scanDependencies([capabilityFile], [target], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        packages: ["@fixtures/does-not-exist"],
      })
      expect(scannedPackages).toEqual([])
      expect(warnings.some((w) => w.file === "(package) @fixtures/does-not-exist")).toBe(true)
    })

    it("returns an empty scannedPackages list when packages is omitted", async () => {
      const capabilityFile = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      }
      const { scannedPackages, warnings } = await scanDependencies([capabilityFile], [target], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(scannedPackages).toEqual([])
      // An omitted `packages` must resolve to an empty allowlist -- not a
      // one-element list that then fails package resolution and warns.
      expect(warnings).toEqual([])
    })

    it("does not double-scan a package file that is also present in the local files list", async () => {
      await writeFile("package.json", JSON.stringify({ name: "fixture-root", private: true }))
      const capabilityFile = await writeFile(
        "user.ts",
        `export const userCapability = createData({ fields: { email: "" } });`,
      )
      await writeFile(
        "node_modules/@fixtures/pkg-b/package.json",
        JSON.stringify({
          name: "@fixtures/pkg-b",
          main: "./index.js",
          dataCap: { schema: "./data.schema.ts" },
        }),
      )
      await writeFile("node_modules/@fixtures/pkg-b/index.js", "module.exports = {};\n")
      await writeFile(
        "node_modules/@fixtures/pkg-b/data.schema.ts",
        `export const pkgBCapability = createData({ fields: { id: "" } });`,
      )
      await writeFile(
        "node_modules/@fixtures/pkg-b/consumer.ts",
        `import { userCapability } from "../../../user.js";\nuserCapability.getUser();`,
      )
      // The package's directory is resolved through its realpath, so match that
      // here -- the same physical consumer file, passed in the local list too.
      const pkgConsumer = await fs.realpath(
        path.join(root, "node_modules/@fixtures/pkg-b/consumer.ts"),
      )

      const target: ScanTarget = {
        file: capabilityFile,
        exportName: "userCapability",
        getterNames: ["getUser"],
        mutatorNames: [],
        subscriptionNames: [],
      }
      // `pkgConsumer` is passed in the local list AND lives under the walked
      // package directory -- it must be scanned exactly once.
      const { edges } = await scanDependencies([capabilityFile, pkgConsumer], [target], {
        fs: nodeBuildFs,
        root,
        tsconfig: false,
        packages: ["@fixtures/pkg-b"],
      })
      expect(edges.filter((e) => e.relationship === "calls-getter")).toHaveLength(1)
    })
  })

  it("never synthesizes a self-match for a capability already bound by an import of the same name", async () => {
    const otherFile = await writeFile(
      "other.ts",
      `export const foo = createData({ fields: { x: "" } });`,
    )
    const comboFile = await writeFile("combo.ts", `import { foo } from "./other.js";\nfoo.getX();`)
    const targets: ScanTarget[] = [
      {
        file: otherFile,
        exportName: "foo",
        getterNames: [],
        mutatorNames: [],
        subscriptionNames: [],
      },
      {
        file: comboFile,
        exportName: "foo",
        getterNames: ["getX"],
        mutatorNames: [],
        subscriptionNames: [],
      },
    ]
    const { edges } = await scanDependencies([otherFile, comboFile], targets, {
      fs: nodeBuildFs,
      root,
      tsconfig: false,
    })
    // `foo` in combo.ts is the imported binding (-> other.ts#foo), never the
    // same-named local target -- so no `calls-getter` edge to combo.ts#foo.
    expect(edges.every((e) => e.relationship !== "calls-getter")).toBe(true)
    expect(edges).toEqual([
      {
        relationship: "imports",
        from: rel(comboFile),
        to: { capability: { file: rel(otherFile), exportName: "foo" } },
        resolution: "resolved",
        position: undefined,
      },
    ])
  })
})
