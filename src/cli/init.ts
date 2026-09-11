import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

/**
 * `data-cap init` -- scaffolds a minimal, working data-cap starting point
 * into the current project: one discoverable capability and one
 * artifact-generation script. Nothing more.
 *
 * Deliberately filesystem-only and non-executing, matching this package's
 * own static-analysis discipline (ADR 0002, ADR 0058) and repo-contract's
 * `init`: it reads the consumer's `package.json` (to confirm it's a project
 * and to decide `src/` vs. root placement) and writes new files with
 * exclusive-create -- it never runs a subprocess, never invokes a package
 * manager, never mutates `package.json`, never regenerates an artifact, and
 * never reads the ambient environment. Anything the documented workflow
 * still needs afterwards is printed as a `Next:` step, not performed here.
 * See ADR 0059.
 *
 * `src/cli/**` is the sanctioned place for direct `node:fs` use (ADR 0058) --
 * this file is bundled into the `bin` target, exempt from the
 * `verify-no-ambient-fs` tarball guard exactly as `src/cli/index.ts` is.
 */

const USAGE = `Usage: data-cap init

Scaffolds a minimal data-cap starting point into the current directory:

  <src>/data.ts            a starter capability (buildData + documentData)
  scripts/generate-data.mjs a script that generates the manifest + docs artifacts

Never overwrites an existing file, never runs anything, never edits
package.json. Everything else -- generating artifacts, adding getters/
mutators, reading the snapshot -- is printed as a next step. Run generation
afterwards with \`node scripts/generate-data.mjs\` or
\`npx data-cap --location <path>\`.`

const CAPABILITY_TEMPLATE = `// Starter data-cap capability -- expand it: add getters/mutators/subscriptions
// (switch to createData from "@maverickcer/data-cap/runtime" for the
// batteries-included operations layer), split into per-capability files, or
// keep everything here. data-cap discovers every .ts/.tsx file by default.
//
// buildData() is pure and synchronous -- fields are the real application data
// shape and are synchronously readable immediately (declared defaults).
// documentData() is a build-time-only marker feeding the generated docs and
// ownership/flow reports; it is inert at runtime. Keep both call arguments
// static literals -- data-cap resolves them by static analysis and never
// executes this file.
import { buildData, documentData } from "@maverickcer/data-cap"

const schema = {
  fields: {
    example: { id: "", label: "" },
  },
}

export const exampleData = buildData(schema)

documentData(schema, {
  owner: "your-team",
  description: "A starter capability. Replace 'example' with a real field group.",
  fields: {
    example: {
      description: "An example record. Replace with your capability's real data.",
      // Add governance metadata as you fill this in, e.g.:
      //   sensitivity: "internal", purpose: "...", legalBasis: "contract"
    },
  },
})
`

const GENERATOR_TEMPLATE = `// Build-time only. Run with \`node scripts/generate-data.mjs\`, or wire it
// into a package.json script (e.g. "generate:data"). Never imported by app code.
import { generateDataArtifacts } from "@maverickcer/data-cap/build"
import { nodeBuildFileSystem } from "@maverickcer/data-cap/node"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const result = await generateDataArtifacts({
  fs: nodeBuildFileSystem,
  root,
  location: "src/generated/data.manifest.ts",
  docs: "docs/DATA.md",
  ownership: "docs/OWNERSHIP.md",
})

const active = result.manifest?.snapshot.capabilities.length ?? 0
console.log(\`Discovered \${active} active capability(ies).\`)
if (result.manifest?.location) console.log(\`Wrote manifest: \${result.manifest.location}\`)
if (result.documentation?.location) console.log(\`Wrote docs: \${result.documentation.location}\`)
`

type WriteOutcome = "created" | "skipped"

interface ScaffoldTarget {
  readonly label: string
  readonly absolutePath: string
  readonly content: string
}

interface ScaffoldResult {
  readonly target: ScaffoldTarget
  readonly outcome: WriteOutcome
}

interface InitReport {
  readonly results: readonly ScaffoldResult[]
}

/**
 * Confirms `cwd` is a project (`package.json` present and a JSON object).
 * Throws a message suitable for printing directly on any failure -- every
 * such failure is a preflight failure and nothing is written.
 */
function assertIsProject(cwd: string): void {
  const packageJsonPath = path.join(cwd, "package.json")
  if (!existsSync(packageJsonPath)) {
    throw new Error(`no package.json found at ${packageJsonPath} -- run \`npm init\` first.`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  } catch {
    // No binding: the SyntaxError carries only a char offset, nothing the
    // caller needs beyond "the file at this path isn't valid JSON".
    throw new Error(`package.json at ${packageJsonPath} is not valid JSON.`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`package.json at ${packageJsonPath} must contain a top-level object.`)
  }
}

/** `src/` if it already exists as a directory, otherwise the project root -- where the starter capability goes. */
function capabilityDirectory(cwd: string): string {
  const srcDir = path.join(cwd, "src")
  return existsSync(srcDir) && statSync(srcDir).isDirectory() ? srcDir : cwd
}

/**
 * Computes the two scaffold targets and rejects any whose path is already
 * blocked by a wrong-typed entry (a directory where a file must go, or a
 * non-directory where `scripts/` must go). A failure here means zero writes.
 */
function planTargets(cwd: string): readonly [ScaffoldTarget, ScaffoldTarget] {
  const capabilityPath = path.join(capabilityDirectory(cwd), "data.ts")
  const scriptsDir = path.join(cwd, "scripts")
  const generatorPath = path.join(scriptsDir, "generate-data.mjs")

  for (const filePath of [capabilityPath, generatorPath]) {
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      throw new Error(`${filePath} already exists and is a directory.`)
    }
  }
  if (existsSync(scriptsDir) && !statSync(scriptsDir).isDirectory()) {
    throw new Error(`${scriptsDir} already exists and is not a directory.`)
  }

  return [
    {
      label: path.relative(cwd, capabilityPath),
      absolutePath: capabilityPath,
      content: CAPABILITY_TEMPLATE,
    },
    {
      label: path.relative(cwd, generatorPath),
      absolutePath: generatorPath,
      content: GENERATOR_TEMPLATE,
    },
  ]
}

/**
 * Writes `content` to `filePath` only if it doesn't already exist, creating
 * parent directories first. Exclusive-create (`"wx"`) rather than an
 * existsSync-then-write pair -- the two-step form races between the check
 * and the write; `"wx"` makes "don't overwrite" atomic. An existing file is
 * never touched -- the conflict is resolved by skipping, never overwriting.
 */
function writeIfAbsent(filePath: string, content: string): WriteOutcome {
  mkdirSync(path.dirname(filePath), { recursive: true })
  try {
    writeFileSync(filePath, content, { flag: "wx" })
    return "created"
  } catch (error) {
    if (isFileExistsError(error)) return "skipped"
    throw error
  }
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "EEXIST"
  )
}

function runInit(cwd: string): InitReport {
  assertIsProject(cwd)
  const [capabilityTarget, generatorTarget] = planTargets(cwd)
  const results = [capabilityTarget, generatorTarget].map((target) => ({
    target,
    outcome: writeIfAbsent(target.absolutePath, target.content),
  }))
  return { results }
}

/** The structured `Created:` / `Skipped:` / `Next:` report, as a string (one `console.log`, testable). */
function renderReport(report: InitReport): string {
  const lines: string[] = ["data-cap initialized", ""]

  const created = report.results.filter((r) => r.outcome === "created")
  const skipped = report.results.filter((r) => r.outcome === "skipped")

  if (created.length > 0) {
    lines.push("Created:")
    for (const r of created) lines.push(`  + ${r.target.label}`)
    lines.push("")
  }
  if (skipped.length > 0) {
    lines.push("Skipped (already exists):")
    for (const r of skipped) lines.push(`  - ${r.target.label}`)
    lines.push("")
  }

  lines.push(
    "Next:",
    "  1. Generate the manifest + docs:  node scripts/generate-data.mjs",
    "  2. Add operations -- switch buildData to createData for the",
    "     batteries-included getter/mutator/subscription layer:",
    "",
    '       import { createData } from "@maverickcer/data-cap/runtime"',
    "",
    "  3. Read fields directly (buildData returns a synchronous snapshot):",
    "     exampleData.fields.example  -- or getSnapshot().fields once on createData",
    "",
    "data-cap init edited no package.json script -- add one if you want, e.g.",
    '  "generate:data": "node scripts/generate-data.mjs"',
  )

  return lines.join("\n")
}

/**
 * `data-cap init` entry. Returns the process exit code; never calls
 * `process.exit`. `rest` is argv already sliced past the `init` token.
 */
export function runInitCommand(rest: readonly string[]): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (rest.length > 0) {
    process.stderr.write(`data-cap init takes no arguments (got: ${rest.join(" ")})\n\n${USAGE}\n`)
    return 1
  }

  try {
    process.stdout.write(`${renderReport(runInit(process.cwd()))}\n`)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`data-cap init failed: ${message}\n`)
    return 1
  }
}
