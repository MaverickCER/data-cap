import { realpathSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  checkArtifacts,
  generateDataArtifacts,
  type CheckArtifactsResult,
  type ManifestChangeReport,
  type ReportResult,
} from "../build/index.js"
import { nodeBuildFileSystem } from "./filesystem.js"
import { runInitCommand } from "./init.js"
import { serializeFailure, serializeSuccess, writeJson } from "./json.js"

/**
 * Thin, optional CLI wrapper around `generateDataArtifacts()`. Nothing here
 * is required for library usage -- `generateManifest`/`generateDocumentation`/
 * `generateUsage`/`generateFlow`/`generateDataArtifacts` are fully usable as
 * plain imports from npm scripts, bundler plugins, or CI steps without this
 * file.
 */

/** Parsed CLI flags -- see `helpText()` below for what each one means. */
export interface ParsedArgs {
  root?: string
  location?: string
  include: string[]
  exclude: string[]
  packages: string[]
  tsconfig?: string | false
  docs?: string
  ownership?: string
  flow?: string
  evidence?: string
  expiringWithinDays?: number
  strict: boolean
  strictDocs: boolean
  strictOwnership: boolean
  strictFlow: boolean
  json: boolean
  check: boolean
  help: boolean
}

/**
 * Parses `process.argv` (already sliced past the `node`/script path) into `ParsedArgs`.
 *
 * @throws {Error} On an unrecognized flag or a flag missing its required value.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    include: [],
    exclude: [],
    packages: [],
    strict: false,
    strictDocs: false,
    strictOwnership: false,
    strictFlow: false,
    json: false,
    check: false,
    help: false,
  }

  // Flag dispatch tables -- kept inside `parseArgs` (not module-level `const`s)
  // so each handler body is a normal, test-attributable value rather than a
  // load-time constant. One branch per *kind* of flag, not one per flag.
  const valueFlags: Readonly<Record<string, (args: ParsedArgs, value: string) => void>> = {
    "--root": (a, v) => (a.root = v),
    "--location": (a, v) => (a.location = v),
    "--include": (a, v) => a.include.push(v),
    "--exclude": (a, v) => a.exclude.push(v),
    "--package": (a, v) => a.packages.push(v),
    "--tsconfig": (a, v) => (a.tsconfig = v),
    "--docs": (a, v) => (a.docs = v),
    "--ownership": (a, v) => (a.ownership = v),
    "--flow": (a, v) => (a.flow = v),
    "--evidence": (a, v) => (a.evidence = v),
    "--expiring-within-days": (a, v) =>
      (a.expiringWithinDays = positiveInteger(v, "--expiring-within-days")),
  }
  const boolFlags: Readonly<Record<string, (args: ParsedArgs) => void>> = {
    "--no-tsconfig": (a) => (a.tsconfig = false),
    "--strict": (a) => (a.strict = true),
    "--strict-docs": (a) => (a.strictDocs = true),
    "--strict-ownership": (a) => (a.strictOwnership = true),
    "--strict-flow": (a) => (a.strictFlow = true),
    "--json": (a) => (a.json = true),
    "--check": (a) => (a.check = true),
    "--help": (a) => (a.help = true),
    "-h": (a) => (a.help = true),
  }

  // `steps`, not `i`, bounds the loop: `i` is manually advanced (`++i`
  // below, to consume a value-flag's argument) and a mutation flipping its
  // `i++` to `i--` would otherwise walk it away from `argv.length` forever,
  // looping until Stryker's own timeout instead of producing an observably
  // wrong result a normal test could catch. `steps` always moves forward by
  // exactly one per iteration regardless, so it still reaches its own
  // generous ceiling fast under that same mutation.
  for (let i = 0, steps = 0; i < argv.length; i++, steps++) {
    // This guard exists only to fail a mutated `i++` fast instead of
    // hanging -- under real argv input it can never trip (`steps` and `i`
    // always advance together), so no test can observably distinguish this
    // condition from `false` without itself mutating `i`'s advancement.
    // Stryker disable next-line EqualityOperator
    if (steps > argv.length + 1) {
      throw new Error("parseArgs: argument index stopped advancing toward argv.length.")
    }
    // `i < argv.length` guarantees `argv[i]` is a real string; the `?? ""` only
    // exists to satisfy `noUncheckedIndexedAccess` and is never taken.
    // Stryker disable next-line StringLiteral
    const arg = argv[i] ?? ""
    const valueFlag = valueFlags[arg]
    if (valueFlag) {
      valueFlag(args, nonEmpty(argv[++i], arg))
      continue
    }
    const boolFlag = boolFlags[arg]
    if (boolFlag) {
      boolFlag(args)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return args
}

/** Requires `value` (the argument immediately following `flag`) to be a non-empty string; throws otherwise. */
function nonEmpty(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} requires a value.`)
  return value
}

/** Requires `value` to parse as a non-negative whole number of days; throws otherwise, rather than silently becoming `NaN` and matching nothing. */
function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative whole number of days (got "${value}").`)
  }
  return parsed
}

/** @internal The `--help` / usage-error text. A function (not a module-level
 *  `const`) so its wording is a normal, test-attributable value. */
export function helpText(): string {
  return `data-cap - generate a manifest, docs, dependency & ownership report, a data flow diagram, and/or an Evidence Model from discovered capabilities

Usage:
  data-cap init
  data-cap [--location <path>] [--docs <path>] [--ownership <path>] [--flow <path>] [--evidence <path>] [options]

  init                      Scaffold a minimal starting point (one data.ts + a generate script); run \`data-cap init --help\` for details

At least one of --location, --docs, --ownership, --flow, or --evidence is required (for a non-init invocation).

Options:
  --root <path>              Directory to resolve globs from (default: cwd)
  --location <path>          Output path for the generated manifest
  --include <glob>           Discovery glob (repeatable, default: every .ts/.tsx file)
  --exclude <glob>           Glob pattern to exclude (repeatable)
  --package <name>           [Experimental, see VERSIONING.md] Installed package name to also discover a capability from, via its "dataCap.schema" package.json field (repeatable)
  --tsconfig <path>          [Experimental, see VERSIONING.md] Path to a tsconfig.json (relative to root) whose "paths"/"baseUrl" resolve aliased imports encountered during static analysis (default: auto-detected "tsconfig.json" at root)
  --no-tsconfig               Disable tsconfig path-alias resolution entirely
  --docs <path>               Emit the Markdown documentation catalog (fields, getters/mutators/subscriptions, sensitivity & protections review) at this path
  --ownership <path>          Emit the Dependency & Ownership report at this path
  --flow <directory>          Emit the Data Flow Diagram + Security Data-Flow Review set to this directory
  --evidence <path>           Emit the composed Evidence Model (ADR 0050) as JSON at this path -- the same canonical, versioned model every other artifact above is a projection of
  --expiring-within-days <n>  How many days out counts as "expiring soon" in the Lifecycle Model and the docs catalog's Lifecycle section (default: 30)
  --strict                    Escalate every pass's warning findings to hard errors (never escalates info)
  --strict-docs                Escalate static (ownership/sensitivity/duplication) findings to hard errors
  --strict-ownership           Escalate proven usage findings (abandoned capabilities, unconsumed owned fields) to hard errors (never escalates unresolved-consumer or indeterminate findings)
  --strict-flow                 Escalate sensitive-data-crosses-external-boundary/missing-handling findings to hard errors
  --json                       Emit a machine-readable JSON report instead of formatted text
  --check                      Verify generated artifacts are up to date without writing anything; exits 1 if any is stale or missing
  --help                       Show this message
`
}

/** @internal Exported for direct unit coverage. */
export function formatFieldPath(field: readonly string[] | undefined): string {
  return field !== undefined && field.length > 0 ? ` (${field.join(".")})` : ""
}

/** @internal Exported for direct unit coverage. */
export function writeFindings(findings: ReportResult["findings"]): void {
  if (findings.length === 0) return
  const errors = findings.filter((f) => f.severity === "error")
  const warnings = findings.filter((f) => f.severity === "warning")
  const infos = findings.filter((f) => f.severity === "info")

  process.stdout.write(
    `\n${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info finding(s):\n`,
  )
  for (const finding of [...errors, ...warnings, ...infos]) {
    const capability = finding.capability !== undefined ? ` [${finding.capability.exportName}]` : ""
    process.stdout.write(
      `  - [${finding.severity}] [${finding.code}]${capability}${formatFieldPath(finding.field)} ${finding.message}\n`,
    )
  }
}

/** @internal Exported for direct unit coverage. */
export function formatFieldChanges(
  changes: ManifestChangeReport["updatedCapabilities"][number],
): string {
  return changes.changes.join(", ")
}

/**
 * Mirrors `docs.ts`'s "Changes since last report" section: a fixed
 * Added/Updated/Removed order, each printed only when non-empty, "No
 * changes." when all three are empty -- printed unconditionally whenever a
 * manifest was generated, not only when something actually changed.
 */
/** @internal Exported for direct unit coverage. */
export function writeManifestChanges(changes: ManifestChangeReport): void {
  const hasAdded = changes.addedCapabilities.length > 0
  const hasUpdated = changes.updatedCapabilities.length > 0
  const hasRemoved = changes.removedCapabilities.length > 0

  process.stdout.write("\nManifest changes since last execution:\n")
  if (!hasAdded && !hasUpdated && !hasRemoved) {
    process.stdout.write("  No changes.\n")
    return
  }

  if (hasAdded) {
    process.stdout.write("  Added:\n")
    for (const c of changes.addedCapabilities) process.stdout.write(`    - ${c}\n`)
  }
  if (hasUpdated) {
    process.stdout.write("  Updated:\n")
    for (const c of changes.updatedCapabilities)
      process.stdout.write(`    - ${c.capability}: ${formatFieldChanges(c)}\n`)
  }
  if (hasRemoved) {
    process.stdout.write("  Removed:\n")
    for (const c of changes.removedCapabilities) process.stdout.write(`    - ${c}\n`)
  }
}

/** @internal Exported for direct unit coverage. */
export function writeGenerationSummary(
  options: { readonly ownership?: string; readonly evidence?: string },
  result: ReportResult,
): void {
  if (result.warnings.length > 0) {
    process.stdout.write(
      `⚠ ${result.warnings.length} unresolved/dropped-capability warning(s) found -- details below. Re-run with --json for a machine-readable report.\n\n`,
    )
  }

  if (result.manifest) {
    process.stdout.write(`Wrote manifest: ${result.manifest.location}\n`)
    process.stdout.write(
      `Discovered ${result.manifest.snapshot.capabilities.length} active capability(ies).\n`,
    )
    writeManifestChanges(result.manifest.changes)
  }

  if (result.documentation) {
    process.stdout.write(`Wrote docs: ${result.documentation.location}\n`)
  }

  // result.usage is populated whenever --ownership OR --flow is requested
  // (the flow report needs the usage scan's edges for its boundary-crossing
  // findings) -- but generateDataArtifacts only ever writes usage.location to
  // disk when --ownership was itself requested. Gating on options.ownership
  // (not result.usage) keeps this line truthful when only --flow was passed.
  if (options.ownership !== undefined && result.usage) {
    process.stdout.write(`Wrote dependency & ownership report: ${result.usage.location}\n`)
  }

  if (result.flow) {
    process.stdout.write(
      `Wrote data flow diagram set to: ${result.flow.location} (${result.flow.files.length} file(s))\n`,
    )
  }

  if (options.evidence !== undefined) {
    process.stdout.write(`Wrote evidence model: ${options.evidence}\n`)
  }

  writeFindings(result.findings)

  if (result.warnings.length > 0) {
    process.stdout.write(`\n${result.warnings.length} parse warning(s):\n`)
    for (const warning of result.warnings) {
      process.stdout.write(`  - ${warning.file}: ${warning.message}\n`)
    }
  }
}

/** @internal Exported for direct unit coverage. */
export function writeCheckSummary(
  options: {
    readonly location?: string
    readonly docs?: string
    readonly ownership?: string
    readonly flow?: string
    readonly evidence?: string
  },
  checkResult: CheckArtifactsResult,
): void {
  process.stdout.write("Checking for drift (--check: nothing will be written)...\n\n")

  const staleSet = new Set(checkResult.stale)
  const rows: { label: string; path: string; ok: boolean }[] = []
  if (options.location !== undefined)
    rows.push({
      label: "manifest",
      path: options.location,
      ok: !staleSet.has(options.location),
    })
  if (options.docs !== undefined)
    rows.push({ label: "docs", path: options.docs, ok: !staleSet.has(options.docs) })
  if (options.ownership !== undefined)
    rows.push({
      label: "ownership",
      path: options.ownership,
      ok: !staleSet.has(options.ownership),
    })
  if (options.flow !== undefined) {
    const flowFiles = checkResult.result.flow?.files ?? []
    const staleFlowFiles = flowFiles.filter((file) => staleSet.has(file.path))
    rows.push({
      label: "flow",
      path: `${options.flow} (${flowFiles.length} file(s))`,
      ok: staleFlowFiles.length === 0,
    })
  }
  if (options.evidence !== undefined)
    rows.push({
      label: "evidence",
      path: options.evidence,
      ok: !staleSet.has(options.evidence),
    })

  for (const row of rows) {
    process.stdout.write(
      `  ${row.label.padEnd(10)} ${row.path.padEnd(50)} ${row.ok ? "OK" : "STALE"}\n`,
    )
  }

  process.stdout.write(
    checkResult.stale.length === 0
      ? "\nAll generated artifacts are up to date.\n"
      : `\n${checkResult.stale.length} artifact(s) are stale or missing. Run without --check to regenerate.\n`,
  )

  // --check's own exit code reflects staleness only (see helpText()) -- these
  // findings (including any --strict*-escalated errors) are surfaced here
  // purely for visibility, the same way they'd read on a real run, without
  // changing what --check itself considers a pass/fail.
  writeFindings(checkResult.result.findings)
}

/** The resolved option object `checkArtifacts`/`generateDataArtifacts` receive. */
type CliOptions = ReturnType<typeof resolveOptions>

/**
 * Turns parsed flags into the option object the build functions take: empty
 * repeatable lists become `undefined`, and every output path is resolved
 * against `--root` (the build functions use these verbatim; `--tsconfig` is the
 * one exception, resolved internally by `loadTsconfigPaths`).
 */
/** @internal Exported for direct unit coverage. */
export function resolveOptions(args: ParsedArgs) {
  const root = args.root !== undefined ? path.resolve(args.root) : process.cwd()

  // exactOptionalPropertyTypes: GenerateDataArtifactsOptions declares every
  // one of these as optional-without-explicit-undefined (`include?: T`, not
  // `include?: T | undefined`) -- omit each key entirely when there's no
  // value, rather than ever setting it to `undefined`.
  return {
    // The deliberate injection boundary (ADR 0058): `./build` never imports
    // `node:fs` -- the CLI, an executable-context entry, constructs the
    // concrete `node:fs/promises` adapter and hands it in. Mirrors
    // repo-contract's `spawn: crossSpawn, env: process.env`.
    fs: nodeBuildFileSystem,
    root,
    ...(args.include.length > 0 ? { include: args.include } : {}),
    ...(args.exclude.length > 0 ? { exclude: args.exclude } : {}),
    ...(args.packages.length > 0 ? { packages: args.packages } : {}),
    // computeDataArtifacts forwards this straight through to
    // linkCapabilityFiles, which reads `options.tsconfig` via plain
    // property access -- present-but-undefined and absent are
    // indistinguishable there, so "spread only when defined" and "always
    // spread" are behaviorally identical. Hand-verified: forcing this guard
    // to `true` and running the real suite passes unchanged.
    // Stryker disable next-line ConditionalExpression
    ...(args.tsconfig !== undefined ? { tsconfig: args.tsconfig } : {}),
    // Inlined path.resolve() rather than the resolve() helper above: that
    // helper's own return type is `string | undefined` regardless of its
    // argument (it's shared with call sites that do want that), which would
    // widen these conditionally-spread values right back to `| undefined`.
    ...(args.location !== undefined ? { location: path.resolve(root, args.location) } : {}),
    ...(args.docs !== undefined ? { docs: path.resolve(root, args.docs) } : {}),
    ...(args.ownership !== undefined ? { ownership: path.resolve(root, args.ownership) } : {}),
    ...(args.flow !== undefined ? { flow: path.resolve(root, args.flow) } : {}),
    ...(args.evidence !== undefined ? { evidence: path.resolve(root, args.evidence) } : {}),
    ...(args.expiringWithinDays !== undefined
      ? { expiringWithinDays: args.expiringWithinDays }
      : {}),
    strict: args.strict,
    strictDocs: args.strictDocs,
    strictOwnership: args.strictOwnership,
    strictFlow: args.strictFlow,
  }
}

/** `--check`: report staleness (its own exit code) and surface findings for visibility. */
/** @internal Exported for direct unit coverage. */
export async function runCheck(args: ParsedArgs, options: CliOptions): Promise<void> {
  let checkResult: CheckArtifactsResult
  try {
    checkResult = await checkArtifacts(options)
  } catch (error) {
    if (!args.json) throw error
    writeJson(serializeFailure(error))
    process.exitCode = 1
    return
  }

  if (args.json) {
    writeJson(
      serializeSuccess(checkResult.result, {
        ok: checkResult.stale.length === 0,
        stale: checkResult.stale,
      }),
    )
  } else {
    writeCheckSummary(options, checkResult)
  }
  process.exitCode = checkResult.stale.length === 0 ? 0 : 1
}

/** A real generate run. */
/** @internal Exported for direct unit coverage. */
export async function runGenerate(args: ParsedArgs, options: CliOptions): Promise<void> {
  let result: ReportResult
  try {
    result = await generateDataArtifacts(options)
  } catch (error) {
    if (!args.json) throw error // propagates to main().catch() exactly as before
    writeJson(serializeFailure(error))
    process.exitCode = 1
    return
  }

  if (args.json) writeJson(serializeSuccess(result))
  else writeGenerationSummary(options, result)
}

/**
 * The CLI entry point: parses argv, runs `--check` or a real generate, and writes either
 * human-readable text or (`--json`) a machine-readable report to stdout, setting
 * `process.exitCode` accordingly.
 */
export async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  // Subcommand dispatch: `init` as the FIRST positional token routes to the
  // scaffolder. Every existing flag-based invocation is untouched -- no flag
  // is reinterpreted as a subcommand, `--help` alone still prints helpText().
  if (argv[0] === "init") {
    process.exitCode = runInitCommand(argv.slice(1))
    return
  }

  const args = parseArgs(argv)

  if (args.help) {
    process.stdout.write(helpText())
    process.exitCode = 0
    return
  }

  if (!args.location && !args.docs && !args.ownership && !args.flow && !args.evidence) {
    if (args.json) {
      writeJson(
        serializeFailure(
          new Error(
            "At least one of --location, --docs, --ownership, --flow, or --evidence is required.",
          ),
        ),
      )
    } else {
      process.stdout.write(helpText())
    }
    process.exitCode = 1
    return
  }

  const options = resolveOptions(args)

  await (args.check ? runCheck(args, options) : runGenerate(args, options))
}

// Only auto-run when this file is the process entry point, not when a test
// imports `parseArgs`/`main` directly -- importing this module must never
// have the side effect of running the CLI.
//
// npm installs `bin` entries as symlinks (e.g. `node_modules/.bin/data-cap`
// -> `../data-cap/dist/cli/index.js`). Node resolves
// `import.meta.url` through that symlink to this file's real, on-disk path,
// but leaves `process.argv[1]` as the symlink path it was actually invoked
// with -- so comparing the two directly never matches for a real `npx`/`.bin`
// invocation, and the CLI would silently no-op. Resolving `argv[1]` through
// `realpathSync` first makes the comparison symlink-aware; the try/catch
// falls back to the unresolved path so this can't itself throw for an
// argv[1] that doesn't resolve to a real file.
export function directRunUrl(): string | undefined {
  const entry = process.argv[1]
  if (!entry) return undefined
  try {
    return pathToFileURL(realpathSync(entry)).href
  } catch {
    return pathToFileURL(entry).href
  }
}

const isDirectRun = import.meta.url === directRunUrl()

if (isDirectRun) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
