// Installs the packed tarball with each package manager a consumer may use and imports every entry
// point from it, both as ESM and as CommonJS. What is proven is exactly that: the tarball installs
// and resolves under npm, pnpm, Yarn 1 and Yarn Berry (node-modules linker); nothing else about
// those managers is claimed. Yarn Plug'n'Play and pnpm's `pnp` node linker are not covered.
//
// Usage: node scripts/package-managers-smoke.mjs [npm|pnpm|yarn1|yarn-berry ...]
// Needs: the package built (`npm run build`), `corepack` (ships with Node), network access to the registry.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const root = process.cwd()
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const name = manifest.name
const managers =
  process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["npm", "pnpm", "yarn1", "yarn-berry"]

/** Every subpath export that resolves to JavaScript (schemas and package.json are data, checked by presence). */
const entries = Object.entries(manifest.exports ?? {}).filter(
  ([subpath, target]) =>
    !subpath.includes("*") &&
    subpath !== "./package.json" &&
    typeof target === "object" &&
    target !== null &&
    "import" in target,
)
if (entries.length === 0) throw new Error("package.json has no object-form exports to import")

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env, COREPACK_ENABLE_STRICT: "0" },
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`,
    )
  }
  return result.stdout
}

// An entry such as an ESLint plugin needs the package's peer dependencies to load, so the consumer
// installs them too, at the ranges the package declares -- as a real consumer of that entry would.
const peers = Object.entries(manifest.peerDependencies ?? {}).map(
  ([peer, range]) => `${peer}@${range}`,
)

const packDir = mkdtempSync(path.join(tmpdir(), "pm-smoke-pack-"))
const packed = JSON.parse(
  run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir], root),
)
const tarball = path.join(packDir, packed[0].filename)

const probe = `import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const entries = ${JSON.stringify(entries.map(([subpath]) => subpath))}
for (const subpath of entries) {
  const specifier = subpath === "." ? ${JSON.stringify(name)} : ${JSON.stringify(name)} + subpath.slice(1)
  const esm = await import(specifier)
  const cjs = require(specifier)
  const esmKeys = Object.keys(esm).filter((k) => k !== "default").sort()
  const cjsKeys = Object.keys(cjs).filter((k) => k !== "default" && k !== "__esModule").sort()
  if (esmKeys.length === 0) throw new Error(specifier + " exports nothing from ESM")
  // CommonJS may expose the default export's own fields as extra keys (a plugin object's \`rules\`); every
  // ESM named export must be there, and nothing ESM has may be missing from CommonJS.
  const missing = esmKeys.filter((k) => !cjsKeys.includes(k))
  if (missing.length > 0) throw new Error(specifier + " is missing from CommonJS: " + missing.join(","))
}
console.log("imported " + entries.length + " entry point(s) as ESM and CJS")
`

const failures = []
try {
  for (const manager of managers) {
    const dir = mkdtempSync(path.join(tmpdir(), `pm-smoke-${manager}-`))
    try {
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "consumer", private: true, type: "module" }),
      )
      writeFileSync(path.join(dir, "probe.mjs"), probe)
      if (manager === "npm") {
        run(
          "npm",
          ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball, ...peers],
          dir,
        )
      } else if (manager === "pnpm") {
        run("corepack", ["pnpm@latest", "add", "--ignore-scripts", tarball, ...peers], dir)
      } else if (manager === "yarn1") {
        run("corepack", ["yarn@1", "add", "--ignore-scripts", `file:${tarball}`, ...peers], dir)
      } else if (manager === "yarn-berry") {
        writeFileSync(
          path.join(dir, ".yarnrc.yml"),
          "nodeLinker: node-modules\nenableScripts: false\n",
        )
        writeFileSync(path.join(dir, "yarn.lock"), "")
        run("corepack", ["yarn@stable", "add", `${name}@file:${tarball}`, ...peers], dir)
      } else {
        throw new Error(`unknown package manager ${manager}`)
      }
      const out = run("node", ["probe.mjs"], dir)
      console.log(`ok   ${manager}: ${out.trim()}`)
    } catch (error) {
      failures.push(manager)
      console.error(`FAIL ${manager}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
} finally {
  rmSync(packDir, { recursive: true, force: true })
}
if (failures.length > 0) {
  console.error(`\nThe tarball could not be installed and imported with: ${failures.join(", ")}.`)
  process.exit(1)
}
console.log(`\n${name}: installs and imports every entry point under ${managers.join(", ")}.`)
