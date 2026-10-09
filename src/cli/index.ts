import { realpathSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  checkArtifacts,
  generateDataArtifacts,
  type CheckArtifactsResult,
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
  include: string[]
  exclude: string[]
  packages: string[]
  tsconfig?: string | false | undefined
  evidence?: string | undefined
  expiringWithinDays?: number | undefined
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
    "--include": (a, v) => a.include.push(v),
    "--exclude": (a, v) => a.exclude.push(v),
    "--package": (a, v) => a.packages.push(v),
    "--tsconfig": (a, v) => (a.tsconfig = v),
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

  // First index the loop still has to handle: a value flag consumes the argument after it. The loop
  // walks a finite list, so it cannot run unbounded.
  let resume = 0
  for (const [i, arg] of argv.entries()) {
    if (i < resume) continue
    const valueFlag = valueFlags[arg]
    if (valueFlag) {
      valueFlag(args, nonEmpty(argv[i + 1], arg))
      resume = i + 2
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
  return `data-cap - generate a persisted Evidence Model from discovered capabilities

Usage:
  data-cap init
  data-cap --evidence <path> [options]

  init                      Scaffold a minimal starting point (one data.ts + a generate script); run \`data-cap init --help\` for details

--evidence is required (for a non-init invocation).

Options:
  --root <path>              Directory to resolve globs from (default: cwd)
  --include <glob>           Discovery glob (repeatable, default: every .ts/.tsx file)
  --exclude <glob>           Glob pattern to exclude (repeatable)
  --package <name>           Installed package name to also discover a capability from, via its "dataCap.schema" package.json field (repeatable)
  --tsconfig <path>          Path to a tsconfig.json (relative to root) whose "paths"/"baseUrl" resolve aliased imports encountered during static analysis (default: auto-detected "tsconfig.json" at root)
  --no-tsconfig               Disable tsconfig path-alias resolution entirely
  --evidence <path>           Emit the composed Evidence Model (ADR 0050) as JSON at this path -- the canonical, versioned model every other generated artifact is a projection of
  --expiring-within-days <n>  How many days out counts as "expiring soon" in the Evidence Model's Lifecycle Model (default: 30)
  --strict                    Escalate every pass's warning findings to hard errors (never escalates info)
  --strict-docs                Escalate static (ownership/sensitivity/duplication) findings to hard errors
  --strict-ownership           Escalate proven usage findings (abandoned capabilities, unconsumed owned fields) to hard errors (never escalates unresolved-consumer or indeterminate findings)
  --strict-flow                 Escalate sensitive-data-crosses-external-boundary/missing-handling findings to hard errors -- only meaningful for a caller that also builds a Data Flow Diagram directly (see below); a no-op for this CLI on its own
  --json                       Emit a machine-readable JSON report instead of formatted text
  --check                      Verify the evidence artifact is up to date without writing anything; exits 1 if it is stale or missing
  --help                       Show this message

The generated manifest, Markdown documentation catalog, Dependency & Ownership
report, and Data Flow Diagram are no longer generated by this CLI -- none has
a runtime consumer (ADR 0066), so generating them is application-level code
now, not a CLI concern. Call \`generateManifest\`/\`generateDocumentation\`/
\`generateUsage\`/\`generateFlow\` (or the higher-level \`generateDataArtifacts\`/
\`checkArtifacts\` orchestrators, which still accept \`location\`/\`docs\`/
\`ownership\`/\`flow\` options) directly from \`data-cap/build\` in your own build
script -- see https://github.com/MaverickCER/data-cap/tree/main/examples/nextjs-app/scripts/generate-docs
for a worked example, and
https://github.com/MaverickCER/data-cap/blob/main/specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md
for why.
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

// `writeManifestChanges()`/`formatFieldChanges()` (the manifest "changes
// since last execution" section) and the manifest/docs/ownership/flow
// branches of the generation/check summaries below were removed along with
// `--location`/`--docs`/`--ownership`/`--flow` themselves: `resolveOptions()`
// no longer ever produces a `location`/`docs`/`ownership`/`flow` value, so
// `result.manifest`/`result.documentation`/`result.flow` are now
// unconditionally `undefined` on every real CLI run, and `--ownership`'s own
// dependency & ownership report is never written to disk by this CLI either
// -- keeping any of that dead code (or its now-permanently-false `if`
// branches) would be code no CLI-level test could ever legitimately cover.
// See specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md.
// `generateManifest`/`generateDocumentation`/`generateUsage`/`generateFlow`
// themselves are unaffected -- see `examples/nextjs-app/scripts/generate-docs`
// for the same rendering, now invoked directly as application code instead
// of through this CLI.

/** @internal Exported for direct unit coverage. */
export function writeGenerationSummary(
  options: { readonly evidence?: string },
  result: ReportResult,
): void {
  if (result.warnings.length > 0) {
    process.stdout.write(
      `⚠ ${result.warnings.length} unresolved/dropped-capability warning(s) found -- details below. Re-run with --json for a machine-readable report.\n\n`,
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
    readonly evidence?: string | undefined
  },
  checkResult: CheckArtifactsResult,
): void {
  process.stdout.write("Checking for drift (--check: nothing will be written)...\n\n")

  const staleSet = new Set(checkResult.stale)
  const rows: { label: string; path: string; ok: boolean }[] = []
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
    tsconfig: args.tsconfig,
    // Inlined path.resolve() rather than the resolve() helper above: that
    // helper's own return type is `string | undefined` regardless of its
    // argument (it's shared with call sites that do want that), which would
    // widen these conditionally-spread values right back to `| undefined`.
    // `location`/`docs`/`ownership`/`flow` are no longer parsed from argv at
    // all (see ADR 0066) -- `GenerateDataArtifactsOptions` still declares
    // them, for a direct library caller (e.g. `examples/*/scripts/
    // generate-docs/run.ts`), but this CLI itself can never produce a value
    // for any of them.
    ...(args.evidence !== undefined ? { evidence: path.resolve(root, args.evidence) } : {}),
    expiringWithinDays: args.expiringWithinDays,
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

  if (!args.evidence) {
    if (args.json) {
      writeJson(serializeFailure(new Error("--evidence is required.")))
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
