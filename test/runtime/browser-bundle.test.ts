import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildSync } from "esbuild"
import { describe, expect, it } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const manifest = JSON.parse(readFileSync(path.join(root, "package.json")).toString()) as {
  exports: Record<string, { import: { default: string } }>
}

// The entry points "data-cap" says run in a browser or an edge runtime: each must bundle for the browser
// platform with nothing from Node, or the claim is false for the first person who tries it.
const ISOMORPHIC = [
  ".",
  "./runtime",
  "./runtime/cache",
  "./runtime/retry",
  "./helpers",
  "./evidence",
]
const built = existsSync(path.join(root, "dist"))

describe.skipIf(!built)(
  "the isomorphic entry points, bundled for a browser (requires `npm run build`)",
  () => {
    it.each(ISOMORPHIC)(
      "%s bundles for the browser without Node's modules or globals",
      (subpath) => {
        const entry = manifest.exports[subpath]?.import.default
        if (entry === undefined) throw new Error(`package.json has no import entry for ${subpath}`)
        const result = buildSync({
          entryPoints: [path.join(root, entry)],
          bundle: true,
          platform: "browser",
          format: "esm",
          write: false,
          logLevel: "silent",
        })
        const code = result.outputFiles[0]?.text ?? ""
        expect(code.length).toBeGreaterThan(0)
        expect(code).not.toMatch(/node:|require\("(?:fs|path|os|child_process)"\)/)
        expect(code).not.toMatch(/\bprocess\.|\bBuffer\./)
      },
    )
  },
)
