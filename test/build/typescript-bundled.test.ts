import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import type TS from "typescript"

interface Manifest {
  readonly dependencies?: Record<string, string>
  readonly bundleDependencies?: readonly string[]
}

const readManifest = (url: URL): Manifest => JSON.parse(readFileSync(url, "utf8")) as Manifest

describe("the bundled compiler", () => {
  it("ships a loadable @typescript/typescript6 with the classic API (the TypeScript 7 fallback)", () => {
    const real = createRequire(import.meta.url)("@typescript/typescript6") as typeof TS
    expect(real.version).toMatch(/^6\./)
    expect(typeof real.createSourceFile).toBe("function")
  })

  it("bundles only declared dependencies, so the published manifest matches the tarball", () => {
    // npm adds a bundled name that is missing from `dependencies` to the registry manifest as
    // `"*"`. The tarball's package.json then differs from the manifest, which Socket reports as
    // manifest confusion.
    const manifest = readManifest(new URL("../../package.json", import.meta.url))
    const declared = Object.keys(manifest.dependencies ?? {})
    expect(manifest.bundleDependencies).toEqual(["@typescript/typescript6"])
    for (const name of manifest.bundleDependencies ?? []) expect(declared).toContain(name)
  })

  it("still bundles the TypeScript 6 payload, as a dependency of @typescript/typescript6", () => {
    // npm bundles a bundled package's own dependencies too, so `@typescript/old` ships without
    // its own `bundleDependencies` entry.
    const wrapper = createRequire(import.meta.url).resolve("@typescript/typescript6/package.json")
    expect(Object.keys(readManifest(pathToFileURL(wrapper)).dependencies ?? {})).toContain(
      "@typescript/old",
    )
  })
})
