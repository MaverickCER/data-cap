import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  MAX_PACKAGE_SCHEMA_FILE_BYTES,
  classifyManifest,
  classifyResolvedFile,
  isRecord,
  locatePackageManifest,
  malformedJsonFailure,
  mergeLocalAndPackageFiles,
  packageNotFoundFailure,
  realpathFailedFailure,
  resolveAllowlistedPackages,
  resolvePackageImport,
  resolvePackageSchemaFile,
  resolveUncached,
  statFailedFailure,
  type PackageSchemaResolutionResult,
  type ResolvedFileProbe,
} from "../../../src/build/resolution/resolve-package-schema.js"
import { nodeBuildFs } from "../../support/build-filesystem.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const fixtureRoot = path.resolve(here, "fixtures-resolve-package-schema")

async function writeJson(relativePath: string, value: unknown): Promise<void> {
  const filePath = path.join(fixtureRoot, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8")
}

async function writeFile(relativePath: string, content: string): Promise<string> {
  const filePath = path.join(fixtureRoot, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, "utf8")
  return filePath
}

function freshCache(): Map<string, Promise<PackageSchemaResolutionResult>> {
  return new Map()
}

/** Asserts a failed resolution's exact code AND a distinctive substring of its `reason`. */
function expectFailure(
  result: PackageSchemaResolutionResult,
  code: string,
  reasonSubstring: string,
): void {
  expect(result.ok).toBe(false)
  if (result.ok) return
  expect(result.code).toBe(code)
  expect(result.reason).toContain(reasonSubstring)
}

beforeAll(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true })
  await writeJson("package.json", { name: "fixture-root", private: true })

  // A normal, well-behaved package: no "exports" map (so the fast
  // "<pkg>/package.json" resolution path succeeds), declares a valid schema.
  await writeJson("node_modules/@fixtures/simple-pkg/package.json", {
    name: "@fixtures/simple-pkg",
    main: "./dist/index.js",
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile("node_modules/@fixtures/simple-pkg/dist/index.js", "module.exports = {};\n")
  await writeFile(
    "node_modules/@fixtures/simple-pkg/src/data.schema.ts",
    `export const simpleEnv = createData({ A: {} }, { name: "simple" });\n`,
  )

  // No "dataCap" field at all.
  await writeJson("node_modules/@fixtures/no-schema/package.json", {
    name: "@fixtures/no-schema",
    main: "./index.js",
  })
  await writeFile("node_modules/@fixtures/no-schema/index.js", "module.exports = {};\n")

  // "dataCap.schema" points at compiled output, not .ts/.tsx.
  await writeJson("node_modules/@fixtures/wrong-ext/package.json", {
    name: "@fixtures/wrong-ext",
    main: "./index.js",
    dataCap: { schema: "./dist/env.schema.js" },
  })
  await writeFile("node_modules/@fixtures/wrong-ext/index.js", "module.exports = {};\n")
  await writeFile("node_modules/@fixtures/wrong-ext/dist/env.schema.js", "module.exports = {};\n")

  // "dataCap.schema" lexically escapes the package directory.
  await writeJson("node_modules/@fixtures/escape-lexical/package.json", {
    name: "@fixtures/escape-lexical",
    main: "./index.js",
    dataCap: { schema: "../../../outside.ts" },
  })
  await writeFile("node_modules/@fixtures/escape-lexical/index.js", "module.exports = {};\n")
  await writeFile("outside.ts", "export const shouldNeverBeRead = true;\n")

  // "dataCap.schema" is a symlink whose real target escapes the package
  // directory -- must be rejected even though the declared path *string*
  // never contains "..".
  await writeFile("escape-target/secret.ts", "export const shouldNeverBeRead = true;\n")
  await writeJson("node_modules/@fixtures/escape-symlink/package.json", {
    name: "@fixtures/escape-symlink",
    main: "./index.js",
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile("node_modules/@fixtures/escape-symlink/index.js", "module.exports = {};\n")
  await fs.mkdir(path.join(fixtureRoot, "node_modules/@fixtures/escape-symlink/src"), {
    recursive: true,
  })
  await fs.symlink(
    path.join(fixtureRoot, "escape-target/secret.ts"),
    path.join(fixtureRoot, "node_modules/@fixtures/escape-symlink/src/data.schema.ts"),
  )

  // "dataCap.schema" is a symlink whose real target stays *inside* the
  // package directory -- must be allowed (symlinks aren't rejected on
  // sight; only an escaping real target is).
  await writeJson("node_modules/@fixtures/safe-symlink/package.json", {
    name: "@fixtures/safe-symlink",
    main: "./index.js",
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile("node_modules/@fixtures/safe-symlink/index.js", "module.exports = {};\n")
  await writeFile(
    "node_modules/@fixtures/safe-symlink/src/real.ts",
    'export const realOne = createData({}, { name: "x" });\n',
  )
  await fs.symlink(
    path.join(fixtureRoot, "node_modules/@fixtures/safe-symlink/src/real.ts"),
    path.join(fixtureRoot, "node_modules/@fixtures/safe-symlink/src/data.schema.ts"),
  )

  // Oversized schema file.
  await writeJson("node_modules/@fixtures/too-big/package.json", {
    name: "@fixtures/too-big",
    main: "./index.js",
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile("node_modules/@fixtures/too-big/index.js", "module.exports = {};\n")
  await writeFile(
    "node_modules/@fixtures/too-big/src/data.schema.ts",
    "x".repeat(MAX_PACKAGE_SCHEMA_FILE_BYTES + 1),
  )

  // Decoy nested package.json (no "name" field) between the main entry and
  // the real root package.json -- the upward walk must not stop there. Only
  // reachable via the fallback path, so "exports" must omit "./package.json".
  await writeJson("node_modules/@fixtures/decoy-walk/package.json", {
    name: "@fixtures/decoy-walk",
    exports: { ".": "./dist/nested/index.js" },
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeJson("node_modules/@fixtures/decoy-walk/dist/nested/package.json", {
    type: "commonjs",
  })
  await writeFile(
    "node_modules/@fixtures/decoy-walk/dist/nested/index.js",
    "module.exports = {};\n",
  )
  await writeFile(
    "node_modules/@fixtures/decoy-walk/src/data.schema.ts",
    `export const decoyEnv = createData({}, { name: "decoy" });\n`,
  )

  // Main entry nested deep enough (more than PACKAGE_JSON_ANCESTOR_SEARCH_LIMIT
  // levels) below the package's own package.json that the upward walk
  // exhausts its iteration budget before ever reaching it -- must return
  // undefined (PACKAGE_NOT_FOUND) rather than loop forever or crash.
  await writeJson("node_modules/@fixtures/deep-nomatch/package.json", {
    name: "@fixtures/deep-nomatch",
    exports: { ".": "./a/b/c/d/e/f/g/h/index.js" },
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile(
    "node_modules/@fixtures/deep-nomatch/a/b/c/d/e/f/g/h/index.js",
    "module.exports = {};\n",
  )
  await writeFile(
    "node_modules/@fixtures/deep-nomatch/src/data.schema.ts",
    `export const deepEnv = createData({}, { name: "deep" });\n`,
  )

  // "dataCap.schema" is lexically inside the package dir and has the right
  // extension, but nothing actually exists at that path on disk.
  await writeJson("node_modules/@fixtures/missing-file/package.json", {
    name: "@fixtures/missing-file",
    main: "./index.js",
    dataCap: { schema: "./src/does-not-exist.ts" },
  })
  await writeFile("node_modules/@fixtures/missing-file/index.js", "module.exports = {};\n")

  // "dataCap.schema" resolves (after realpath) to a real directory rather
  // than a regular file -- a directory can still be named with a ".ts"
  // suffix, so the extension check alone doesn't catch this.
  await writeJson("node_modules/@fixtures/schema-is-directory/package.json", {
    name: "@fixtures/schema-is-directory",
    main: "./index.js",
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile("node_modules/@fixtures/schema-is-directory/index.js", "module.exports = {};\n")
  await fs.mkdir(
    path.join(fixtureRoot, "node_modules/@fixtures/schema-is-directory/src/data.schema.ts"),
    { recursive: true },
  )

  // Package directory itself reached via a symlink (mimics pnpm's
  // content-addressable store) -- the declared schema file must still
  // resolve and pass the realpath containment check correctly.
  await writeJson(".store/symlinked-pkg-real/package.json", {
    name: "@fixtures/symlinked-pkg",
    main: "./index.js",
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile(".store/symlinked-pkg-real/index.js", "module.exports = {};\n")
  await writeFile(
    ".store/symlinked-pkg-real/src/data.schema.ts",
    `export const storeEnv = createData({}, { name: "store" });\n`,
  )
  await fs.mkdir(path.join(fixtureRoot, "node_modules/@fixtures"), { recursive: true })
  await fs.symlink(
    path.join(fixtureRoot, ".store/symlinked-pkg-real"),
    path.join(fixtureRoot, "node_modules/@fixtures/symlinked-pkg"),
  )

  // Second package for cross-package "cycle" scenario: bare-imports the
  // first from within its own schema file's surrounding module (the schema
  // file itself doesn't need to import anything for resolution purposes --
  // resolution is per-package-name and non-recursive by construction).
  await writeJson("node_modules/@fixtures/cycle-a/package.json", {
    name: "@fixtures/cycle-a",
    main: "./index.js",
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile("node_modules/@fixtures/cycle-a/index.js", "module.exports = {};\n")
  await writeFile(
    "node_modules/@fixtures/cycle-a/src/data.schema.ts",
    `export const aEnv = createData({}, { name: "a" });\n`,
  )
  await writeJson("node_modules/@fixtures/cycle-b/package.json", {
    name: "@fixtures/cycle-b",
    main: "./index.js",
    dataCap: { schema: "./src/data.schema.ts" },
  })
  await writeFile("node_modules/@fixtures/cycle-b/index.js", "module.exports = {};\n")
  await writeFile(
    "node_modules/@fixtures/cycle-b/src/data.schema.ts",
    `export const bEnv = createData({}, { name: "b" });\n`,
  )
})

afterAll(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true })
})

describe("resolvePackageSchemaFile", () => {
  it("resolves a well-behaved package's declared schema file", async () => {
    const result = await resolvePackageSchemaFile(
      "@fixtures/simple-pkg",
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.origin.packageName).toBe("@fixtures/simple-pkg")
      expect(result.origin.declaredField).toBe("./src/data.schema.ts")
      expect(result.origin.resolvedFile.endsWith("src/data.schema.ts")).toBe(true)
    }
  })

  it("reports PACKAGE_NOT_FOUND for a package that isn't installed", async () => {
    const result = await resolveUncached("@fixtures/does-not-exist", fixtureRoot, nodeBuildFs)
    expectFailure(result, "PACKAGE_NOT_FOUND", "could not be resolved")
  })

  it("reports FIELD_MISSING when the package.json has no dataCap.schema field", async () => {
    const result = await resolveUncached("@fixtures/no-schema", fixtureRoot, nodeBuildFs)
    expectFailure(result, "FIELD_MISSING", 'no "dataCap.schema" field')
  })

  it("reports INVALID_EXTENSION for a declared field pointing at compiled output", async () => {
    const result = await resolveUncached("@fixtures/wrong-ext", fixtureRoot, nodeBuildFs)
    expectFailure(result, "INVALID_EXTENSION", "compiled/bundled output")
  })

  it("reports OUTSIDE_PACKAGE for a declared field that lexically escapes the package directory", async () => {
    const result = await resolveUncached("@fixtures/escape-lexical", fixtureRoot, nodeBuildFs)
    expectFailure(result, "OUTSIDE_PACKAGE", "resolves outside its own package directory")
  })

  it("reports OUTSIDE_PACKAGE for a symlink whose real target escapes the package directory", async () => {
    const result = await resolveUncached("@fixtures/escape-symlink", fixtureRoot, nodeBuildFs)
    expectFailure(result, "OUTSIDE_PACKAGE", "after following symlinks")
  })

  it("allows a symlink whose real target stays inside the package directory", async () => {
    const result = await resolvePackageSchemaFile(
      "@fixtures/safe-symlink",
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(result.ok).toBe(true)
  })

  it("reports FILE_TOO_LARGE for a schema file exceeding the size cap", async () => {
    const result = await resolveUncached("@fixtures/too-big", fixtureRoot, nodeBuildFs)
    expectFailure(result, "FILE_TOO_LARGE", `${String(MAX_PACKAGE_SCHEMA_FILE_BYTES)}-byte limit`)
  })

  it("does not stop at a decoy nested package.json with no matching name during the upward walk", async () => {
    const result = await resolvePackageSchemaFile(
      "@fixtures/decoy-walk",
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.origin.resolvedFile.endsWith("decoy-walk/src/data.schema.ts")).toBe(true)
  })

  it("reports PACKAGE_NOT_FOUND when the upward walk exhausts its iteration budget without ever finding a matching package.json", async () => {
    const result = await resolveUncached("@fixtures/deep-nomatch", fixtureRoot, nodeBuildFs)
    expectFailure(result, "PACKAGE_NOT_FOUND", "could not be resolved")
  })

  it("reports PACKAGE_NOT_FOUND when the upward walk reaches the real filesystem root without ever finding a matching package.json", async () => {
    // A repo-nested fixture is always far more than
    // PACKAGE_JSON_ANCESTOR_SEARCH_LIMIT directory levels below the real "/",
    // so exercising the "walk reaches the actual root" outcome (as opposed to
    // "walk exhausts its iteration budget") needs its own, much shallower,
    // root outside the repo entirely.
    const rootWalkRoot = path.join("/tmp", `data-cap-rootwalk-${process.pid}-${Date.now()}`)
    const packageDir = path.join(rootWalkRoot, "node_modules/@fixtures/rootwalk")
    await fs.mkdir(packageDir, { recursive: true })
    // "exports" without "./package.json" forces the ancestor-walk fallback;
    // "name" deliberately does not match so the walk never stops early.
    await fs.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "@fixtures/rootwalk-not-a-match", exports: { ".": "./index.js" } }),
      "utf8",
    )
    await fs.writeFile(path.join(packageDir, "index.js"), "module.exports = {};\n", "utf8")
    try {
      const result = await resolvePackageSchemaFile(
        "@fixtures/rootwalk",
        rootWalkRoot,
        freshCache(),
        nodeBuildFs,
      )
      expectFailure(result, "PACKAGE_NOT_FOUND", "could not be resolved")
    } finally {
      await fs.rm(rootWalkRoot, { recursive: true, force: true })
    }
  })

  it("reports MALFORMED_PACKAGE_JSON when the resolved package.json is not valid JSON", async () => {
    // Node's own module resolution needs to parse a package's package.json
    // just to locate anything inside it, so a package.json malformed enough
    // to reach this code's own JSON.parse can't be constructed as a package
    // Node itself can resolve at all -- spy on the read this code does once
    // it already has a resolved, Node-valid path in hand.
    const readFileSpy = vi.spyOn(fs, "readFile").mockResolvedValueOnce("{ this is not json")
    try {
      const result = await resolveUncached("@fixtures/simple-pkg", fixtureRoot, nodeBuildFs)
      expectFailure(result, "MALFORMED_PACKAGE_JSON", "is not valid JSON")
    } finally {
      readFileSpy.mockRestore()
    }
  })

  it("reports MALFORMED_PACKAGE_JSON when the resolved package.json parses to something other than a JSON object", async () => {
    // A bare JSON string, not `[]` -- isRecord()'s own `typeof value ===
    // "object"` check does not exclude arrays, so this is the shape that
    // actually exercises the "not a JSON object" rejection.
    const readFileSpy = vi.spyOn(fs, "readFile").mockResolvedValueOnce('"just a string"')
    try {
      const result = await resolveUncached("@fixtures/simple-pkg", fixtureRoot, nodeBuildFs)
      expectFailure(result, "MALFORMED_PACKAGE_JSON", "does not contain a JSON object")
    } finally {
      readFileSpy.mockRestore()
    }
  })

  it("reports OUTSIDE_PACKAGE when the declared field doesn't resolve to anything that exists on disk", async () => {
    const result = await resolveUncached("@fixtures/missing-file", fixtureRoot, nodeBuildFs)
    expectFailure(result, "OUTSIDE_PACKAGE", "does not resolve to a file that exists")
  })

  it("reports OUTSIDE_PACKAGE when the declared field resolves to a directory rather than a regular file", async () => {
    const result = await resolveUncached("@fixtures/schema-is-directory", fixtureRoot, nodeBuildFs)
    expectFailure(result, "OUTSIDE_PACKAGE", "does not resolve to a regular file")
  })

  it("reports OUTSIDE_PACKAGE when fs.stat throws for the already-realpath'd file", async () => {
    const statSpy = vi
      .spyOn(fs, "stat")
      .mockRejectedValueOnce(new Error("ENOENT: simulated vanish between realpath and stat"))
    try {
      const result = await resolvePackageSchemaFile(
        "@fixtures/simple-pkg",
        fixtureRoot,
        freshCache(),
        nodeBuildFs,
      )
      expectFailure(result, "OUTSIDE_PACKAGE", "could not be read")
    } finally {
      statSpy.mockRestore()
    }
  })

  it("resolves correctly when the package directory itself is reached via a symlink (pnpm-style store)", async () => {
    const result = await resolvePackageSchemaFile(
      "@fixtures/symlinked-pkg",
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.origin.resolvedFile.endsWith("symlinked-pkg-real/src/data.schema.ts")).toBe(
        true,
      )
  })

  it("never calls fs.readdir -- resolution is bounded, not a directory treewalk", async () => {
    const readdirSpy = vi.spyOn(fs, "readdir")
    await resolvePackageSchemaFile("@fixtures/decoy-walk", fixtureRoot, freshCache(), nodeBuildFs)
    await resolvePackageSchemaFile("@fixtures/simple-pkg", fixtureRoot, freshCache(), nodeBuildFs)
    expect(readdirSpy).not.toHaveBeenCalled()
    readdirSpy.mockRestore()
  })
})

describe("resolveAllowlistedPackages", () => {
  it("deduplicates a package name listed more than once into a single resolution and a single warning", async () => {
    const cache = freshCache()
    const result = await resolveAllowlistedPackages(
      ["@fixtures/no-schema", "@fixtures/no-schema"],
      fixtureRoot,
      cache,
      nodeBuildFs,
    )
    expect(result.files).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
  })

  it("resolves two independent, mutually-unrelated packages without recursion or cross-contamination (cycle-safety)", async () => {
    const result = await resolveAllowlistedPackages(
      ["@fixtures/cycle-a", "@fixtures/cycle-b"],
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(result.files.map((f) => f.packageName).sort()).toEqual([
      "@fixtures/cycle-a",
      "@fixtures/cycle-b",
    ])
    expect(result.warnings).toHaveLength(0)
  })

  it("produces one warning per failing package, mixed with successes", async () => {
    const result = await resolveAllowlistedPackages(
      ["@fixtures/simple-pkg", "@fixtures/no-schema", "@fixtures/does-not-exist"],
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(result.files).toHaveLength(1)
    expect(result.warnings).toHaveLength(2)
  })
})

describe("resolvePackageImport", () => {
  it("resolves a bare specifier matching an allow-listed package", async () => {
    const file = await resolvePackageImport(
      "@fixtures/simple-pkg",
      ["@fixtures/simple-pkg"],
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(file?.endsWith("simple-pkg/src/data.schema.ts")).toBe(true)
  })

  it("resolves a subpath specifier under an allow-listed package name", async () => {
    const file = await resolvePackageImport(
      "@fixtures/simple-pkg/whatever",
      ["@fixtures/simple-pkg"],
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(file?.endsWith("simple-pkg/src/data.schema.ts")).toBe(true)
  })

  it("returns undefined for a bare specifier not in the allowlist -- identical no-op to resolveRelativeImport", async () => {
    const file = await resolvePackageImport(
      "@fixtures/simple-pkg",
      [],
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(file).toBeUndefined()
  })

  it("returns undefined for a specifier that is neither an allow-listed name nor a subpath of one", async () => {
    const file = await resolvePackageImport(
      "@fixtures/some-other-pkg",
      ["@fixtures/simple-pkg"],
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(file).toBeUndefined()
  })

  it("does not match a specifier that merely ends with (but does not start with) an allow-listed name", async () => {
    const file = await resolvePackageImport(
      "prefix/@fixtures/simple-pkg",
      ["@fixtures/simple-pkg"],
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(file).toBeUndefined()
  })

  it("leaves the cache untouched when nothing in the allowlist matches (no resolution is attempted)", async () => {
    const cache = freshCache()
    const file = await resolvePackageImport(
      "totally/unrelated",
      ["@fixtures/simple-pkg"],
      fixtureRoot,
      cache,
      nodeBuildFs,
    )
    expect(file).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it("returns undefined when the specifier matches an allow-listed package name but that package's own resolution fails", async () => {
    const file = await resolvePackageImport(
      "@fixtures/no-schema",
      ["@fixtures/no-schema"],
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(file).toBeUndefined()
  })
})

describe("mergeLocalAndPackageFiles", () => {
  it("deduplicates by realpath, not lexical path -- a locally-discovered symlink and its package-resolved realpath count once", async () => {
    const localSymlinkPath = path.join(
      fixtureRoot,
      "node_modules/@fixtures/safe-symlink/src/data.schema.ts",
    )
    const packageResolved = await resolvePackageSchemaFile(
      "@fixtures/safe-symlink",
      fixtureRoot,
      freshCache(),
      nodeBuildFs,
    )
    expect(packageResolved.ok).toBe(true)
    if (!packageResolved.ok) return

    const merged = await mergeLocalAndPackageFiles(
      [localSymlinkPath],
      [packageResolved.origin.resolvedFile],
      nodeBuildFs,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(localSymlinkPath) // local path string identity wins on collision
  })

  it("keeps genuinely distinct files distinct", async () => {
    const merged = await mergeLocalAndPackageFiles(
      [path.join(fixtureRoot, "node_modules/@fixtures/simple-pkg/src/data.schema.ts")],
      [path.join(fixtureRoot, "node_modules/@fixtures/decoy-walk/src/data.schema.ts")],
      nodeBuildFs,
    )
    expect(merged).toHaveLength(2)
  })

  it("never throws when a local file's own realpath fails -- falls back to the lexical path rather than dropping it", async () => {
    const nonExistentLocal = path.join(fixtureRoot, "does-not-exist-on-disk.ts")
    const merged = await mergeLocalAndPackageFiles([nonExistentLocal], [], nodeBuildFs)
    expect(merged).toEqual([nonExistentLocal])
  })

  it("keeps two DISTINCT un-realpath-able local files distinct (each falls back to its own lexical path)", async () => {
    const a = path.join(fixtureRoot, "gone-a.ts")
    const b = path.join(fixtureRoot, "gone-b.ts")
    expect(await mergeLocalAndPackageFiles([a, b], [], nodeBuildFs)).toEqual([a, b])
  })

  it("deduplicates two identical local paths against each other, not just against package files", async () => {
    const localPath = path.join(fixtureRoot, "node_modules/@fixtures/simple-pkg/src/data.schema.ts")
    const merged = await mergeLocalAndPackageFiles([localPath, localPath], [], nodeBuildFs)
    expect(merged).toHaveLength(1)
  })
})

describe("locatePackageManifest (direct)", () => {
  it("locates a well-behaved package's own package.json and directory", async () => {
    const located = await locatePackageManifest("@fixtures/simple-pkg", fixtureRoot, nodeBuildFs)
    expect(located?.packageJsonPath.endsWith("simple-pkg/package.json")).toBe(true)
    expect(located?.packageDir.endsWith("@fixtures/simple-pkg")).toBe(true)
  })

  it("walks past a decoy nested package.json to the one whose name actually matches", async () => {
    const located = await locatePackageManifest("@fixtures/decoy-walk", fixtureRoot, nodeBuildFs)
    expect(located?.packageDir.endsWith("@fixtures/decoy-walk")).toBe(true)
  })

  it("returns undefined when the upward walk exhausts its iteration budget", async () => {
    expect(
      await locatePackageManifest("@fixtures/deep-nomatch", fixtureRoot, nodeBuildFs),
    ).toBeUndefined()
  })

  it("returns undefined for a package that cannot be resolved at all", async () => {
    expect(await locatePackageManifest("@fixtures/nope", fixtureRoot, nodeBuildFs)).toBeUndefined()
  })
})

describe("isRecord (direct)", () => {
  it.each([
    ["null", null, false],
    ["undefined", undefined, false],
    ["a string", "x", false],
    ["a number", 5, false],
    ["a boolean", true, false],
    ["a plain object", {}, true],
    ["an array", [], true],
    ["a Date", new Date(), true],
  ])("%s -> %s", (_label, value, expected) => {
    expect(isRecord(value)).toBe(expected)
  })
})

describe("classifyManifest (direct)", () => {
  const pkgDir = path.join(fixtureRoot, "node_modules/@fixtures/direct")
  const pkgJson = path.join(pkgDir, "package.json")

  function expectFailingClassification(
    manifest: unknown,
    code: string,
    reasonSubstring: string,
  ): void {
    const classified = classifyManifest(manifest, pkgJson, "@fixtures/direct", pkgDir)
    expect(classified.found).toBe(false)
    if (classified.found) return
    expectFailure(classified.failure, code, reasonSubstring)
  }

  it("rejects a non-object manifest (naming the package.json path)", () => {
    expectFailingClassification(
      "just a string",
      "MALFORMED_PACKAGE_JSON",
      "does not contain a JSON object",
    )
    expectFailingClassification(null, "MALFORMED_PACKAGE_JSON", pkgJson)
  })

  it.each([
    ["no dataCap key at all", {}],
    ["dataCap is not an object", { dataCap: "nope" }],
    ["dataCap.schema is not a string", { dataCap: { schema: 5 } }],
  ])("reports FIELD_MISSING when %s", (_label, manifest) => {
    expectFailingClassification(manifest, "FIELD_MISSING", 'no "dataCap.schema" field')
  })

  it("reports OUTSIDE_PACKAGE for a declared field that lexically escapes the package dir", () => {
    expectFailingClassification(
      { dataCap: { schema: "../../../../../../../elsewhere.ts" } },
      "OUTSIDE_PACKAGE",
      "resolves outside its own package directory",
    )
  })

  it("reports INVALID_EXTENSION for a non-.ts/.tsx declared field, listing the allowed extensions", () => {
    const classified = classifyManifest(
      { dataCap: { schema: "./dist/schema.js" } },
      pkgJson,
      "@fixtures/direct",
      pkgDir,
    )
    expect(classified.found).toBe(false)
    if (classified.found) return
    expectFailure(classified.failure, "INVALID_EXTENSION", "not compiled/bundled output")
    expect(classified.failure.ok).toBe(false)
    if (classified.failure.ok) return
    expect(classified.failure.reason).toContain(".ts/.tsx")
    expect(classified.failure.reason).toContain(
      `"@fixtures/direct"'s "dataCap.schema" ("./dist/schema.js")`,
    )
  })

  it.each([
    ["./src/data.schema.ts", "src/data.schema.ts"],
    ["./nested/deep.schema.tsx", "nested/deep.schema.tsx"],
  ])("accepts a well-formed .ts/.tsx declared field (%s)", (declared, tail) => {
    const classified = classifyManifest(
      { dataCap: { schema: declared } },
      pkgJson,
      "@fixtures/direct",
      pkgDir,
    )
    expect(classified.found).toBe(true)
    if (!classified.found) return
    expect(classified.declaredField).toBe(declared)
    expect(classified.lexicallyResolved.endsWith(tail)).toBe(true)
  })
})

describe("realpathFailedFailure / statFailedFailure (direct)", () => {
  it("realpathFailedFailure -> OUTSIDE_PACKAGE with the exact 'does not resolve to a file that exists' message", () => {
    const result = realpathFailedFailure("@x/y", "./s.ts")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("OUTSIDE_PACKAGE")
    expect(result.reason).toBe(
      `"@x/y"'s "dataCap.schema" ("./s.ts") does not resolve to a file that exists.`,
    )
  })

  it("statFailedFailure -> OUTSIDE_PACKAGE with the exact 'could not be read' message", () => {
    const result = statFailedFailure("@x/y", "./s.ts")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("OUTSIDE_PACKAGE")
    expect(result.reason).toBe(`"@x/y"'s "dataCap.schema" ("./s.ts") could not be read.`)
  })
})

describe("classifyResolvedFile (direct)", () => {
  const probe = (over: Partial<ResolvedFileProbe>): ResolvedFileProbe => ({
    withinPackage: true,
    isRegularFile: true,
    size: 10,
    realFile: "/real/pkg/src/data.schema.ts",
    realPackageDir: "/real/pkg",
    ...over,
  })

  it("real target outside the package dir -> OUTSIDE_PACKAGE 'after following symlinks'", () => {
    const result = classifyResolvedFile(probe({ withinPackage: false }), "@x/y", "./s.ts")
    expectFailure(result, "OUTSIDE_PACKAGE", "after following symlinks")
  })

  it("not a regular file -> OUTSIDE_PACKAGE 'does not resolve to a regular file'", () => {
    const result = classifyResolvedFile(probe({ isRegularFile: false }), "@x/y", "./s.ts")
    expectFailure(result, "OUTSIDE_PACKAGE", "does not resolve to a regular file")
  })

  it("a file of exactly the byte limit is accepted (boundary is strictly '>')", () => {
    const result = classifyResolvedFile(
      probe({ size: MAX_PACKAGE_SCHEMA_FILE_BYTES }),
      "@fixtures/boundary",
      "./s.ts",
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.origin.resolvedFile).toBe("/real/pkg/src/data.schema.ts")
    expect(result.origin.packageDir).toBe("/real/pkg")
    expect(result.origin.packageName).toBe("@fixtures/boundary")
    expect(result.origin.declaredField).toBe("./s.ts")
  })

  it("one byte over the limit -> FILE_TOO_LARGE, quoting both the size and the cap", () => {
    const result = classifyResolvedFile(
      probe({ size: MAX_PACKAGE_SCHEMA_FILE_BYTES + 1 }),
      "@x/y",
      "./s.ts",
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("FILE_TOO_LARGE")
    expect(result.reason).toContain(`${String(MAX_PACKAGE_SCHEMA_FILE_BYTES + 1)} bytes`)
    expect(result.reason).toContain(`${String(MAX_PACKAGE_SCHEMA_FILE_BYTES)}-byte limit`)
  })
})

describe("sync failure builders (direct)", () => {
  it("packageNotFoundFailure names the package, the root, and the resolution hint", () => {
    const result = packageNotFoundFailure("@x/y", "/some/root")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("PACKAGE_NOT_FOUND")
    expect(result.reason).toContain('"@x/y"')
    expect(result.reason).toContain("/some/root")
    expect(result.reason).toContain("could not be resolved")
    expect(result.reason).toContain("is it installed?")
  })

  it("malformedJsonFailure names the package.json path", () => {
    const result = malformedJsonFailure("/p/package.json")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("MALFORMED_PACKAGE_JSON")
    expect(result.reason).toBe(`"/p/package.json" is not valid JSON.`)
  })
})

describe("resolvePackageSchemaFile memoization", () => {
  it("a second call with the same cache returns the very same in-flight promise", async () => {
    const cache = freshCache()
    const first = resolvePackageSchemaFile("@fixtures/simple-pkg", fixtureRoot, cache, nodeBuildFs)
    const second = resolvePackageSchemaFile("@fixtures/simple-pkg", fixtureRoot, cache, nodeBuildFs)
    expect(second).toBe(first)
    expect(cache.get("@fixtures/simple-pkg")).toBe(first)
    await Promise.all([first, second])
  })
})
