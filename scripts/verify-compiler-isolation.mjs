// Release-blocking check, sibling to verify-no-ambient-fs.mjs: the bundled TypeScript 6 compiler
// (`bundleDependencies`, ADR 0049) belongs to the build-time scanner and to nothing else.
//
// A consumer who only imports the runtime must never load -- or pay for the bytes of -- a compiler.
// This walks the static import graph of every built entry point in `dist/` and fails if
//
//   - any client entry (every exported entry point except `./build`, and not the CLI) can reach the
//     compiler loader, the bundled package, or `node:module` (the loader's `createRequire`), or
//   - a client entry imports `typescript` itself (the ESLint plugin is exempt: it runs inside the
//     consumer's own ESLint/typescript-eslint process and takes the consumer's `typescript` by design), or
//   - the build entry does NOT reach the bundled compiler (which would make this check vacuous).
//
// Run after `npm run build`. Works on the built output, so it also covers whatever tsup chunk-splitting
// decides to share between entries.

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

/** What a client entry must never be able to reach. */
const COMPILER_MARKERS = ["@typescript/typescript6", "@typescript/old", "node:module"]
/** Entries that legitimately import the consumer's own `typescript`. */
const MAY_IMPORT_TYPESCRIPT = new Set(["./eslint-plugin"])

/** The built JS files an `exports` entry resolves to (`import` and `require`, never `.d.ts`). */
function entryFiles(entry) {
  if (typeof entry === "string") return /\.[cm]?js$/.test(entry) ? [entry] : []
  if (entry === null || typeof entry !== "object") return []
  return Object.entries(entry).flatMap(([condition, target]) =>
    condition === "types" || condition.startsWith("types@") ? [] : entryFiles(target),
  )
}

const specifiers = (source) => [
  ...[...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...source.matchAll(/\bimport\s*["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...source.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
]

/** Every file reachable from `start` through relative imports, and every bare/node specifier seen. */
function closure(start) {
  const files = new Map()
  const external = new Set()
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.pop()
    if (files.has(file)) continue
    const source = readFileSync(file, "utf8")
    files.set(file, source)
    for (const spec of specifiers(source)) {
      if (spec.startsWith(".")) {
        const next = path.resolve(path.dirname(file), spec)
        if (existsSync(next)) queue.push(next)
      } else {
        external.add(spec)
      }
    }
  }
  return { files, external }
}

const problems = []
const resolveEntries = (name) =>
  entryFiles(pkg.exports[name]).map((rel) => ({ name, file: path.join(root, rel) }))

const buildEntries = [
  ...resolveEntries("./build"),
  ...(typeof pkg.bin === "string"
    ? [{ name: "bin", file: path.join(root, pkg.bin) }]
    : Object.values(pkg.bin ?? {}).map((rel) => ({ name: "bin", file: path.join(root, rel) }))),
]
const clientEntries = Object.keys(pkg.exports)
  .filter(
    (name) => name !== "./build" && !name.includes("package.json") && !name.startsWith("./schema"),
  )
  .flatMap(resolveEntries)

for (const { name, file } of [...buildEntries, ...clientEntries]) {
  if (!existsSync(file))
    problems.push(`${name}: ${path.relative(root, file)} is missing -- run \`npm run build\` first`)
}
if (problems.length > 0) {
  console.error(`verify-compiler-isolation: FAIL\n  ${problems.join("\n  ")}`)
  process.exit(1)
}

let buildReachesCompiler = false
for (const { file } of buildEntries.filter((e) => e.name === "./build")) {
  const { files, external } = closure(file)
  const reaches =
    external.has("@typescript/typescript6") ||
    [...files.values()].some((source) => source.includes("@typescript/typescript6"))
  buildReachesCompiler ||= reaches
}
if (!buildReachesCompiler) {
  problems.push(
    "the ./build entry never reaches @typescript/typescript6, so this check proves nothing -- did the loader move?",
  )
}

for (const { name, file } of clientEntries) {
  const { files, external } = closure(file)
  for (const marker of COMPILER_MARKERS) {
    const hit = [...files.entries()].find(([, source]) => source.includes(marker))
    if (hit !== undefined || external.has(marker)) {
      problems.push(
        `${name} (${path.relative(root, file)}) can reach "${marker}"${hit ? ` via ${path.relative(root, hit[0])}` : ""} -- the compiler may only be used by the build entry`,
      )
    }
  }
  if (!MAY_IMPORT_TYPESCRIPT.has(name) && external.has("typescript")) {
    problems.push(
      `${name} (${path.relative(root, file)}) imports "typescript" -- only the build entry may`,
    )
  }
}

if (problems.length > 0) {
  console.error(`verify-compiler-isolation: FAIL\n  ${problems.join("\n  ")}`)
  process.exit(1)
}
console.log(
  `verify-compiler-isolation: OK -- ${String(clientEntries.length)} client entry file(s) cannot reach the bundled compiler; the build entry does`,
)
