/**
 * C8: the top-level orchestrator. One discover -> link -> inventory pass;
 * runs every requested generator against that same inventory instance;
 * aggregates every finding into one `ReportResult`; computes all of it
 * before writing anything (atomicity is a hard invariant -- a partially-
 * written artifact set is worse than none); applies `--strict*` severity
 * escalation; then writes.
 */

import path from "node:path"
import { discoverCapabilityFiles } from "./discover.js"
import { computeSourceFingerprint, writeEvidenceFingerprint } from "./evidence-fingerprint.js"
import { displayPath } from "./display-path.js"
import { linkCapabilityFiles } from "./link.js"
import { buildInventory } from "./inventory.js"
import type { CapabilityInventory } from "./inventory.js"
import {
  mergeLocalAndPackageFiles,
  resolveAllowlistedPackages,
} from "./resolution/resolve-package-schema.js"
import type { PackageSchemaResolutionResult } from "./resolution/resolve-package-schema.js"
import { checkExclusiveGroups } from "./exclusive-group.js"
import { checkDuplicateEndpoints, checkStructuralDuplication } from "./structural-duplication.js"
import { checkOwnershipAndSensitivity } from "./static-rules.js"
import { generateManifest } from "./generate-manifest.js"
import type { GenerateManifestResult } from "./generate-manifest.js"
import { buildManifestSnapshot, diffManifestSnapshots } from "./manifest-snapshot.js"
import type { ManifestChangeReport, ManifestSnapshot } from "./manifest-snapshot.js"
import { buildCitationSnapshots, verifyDynamicAccessCitations } from "./citation-verification.js"
import { generateDocumentation } from "./generate-documentation.js"
import type { GenerateDocumentationResult } from "./generate-documentation.js"
import { generateUsage } from "./generate-usage.js"
import type { GenerateUsageResult } from "./generate-usage.js"
import { generateFlow } from "./generate-flow.js"
import type { GenerateFlowResult } from "./generate-flow.js"
import { buildDependencyModel } from "./dependency-model.js"
import { buildOwnershipModel } from "./ownership-model.js"
import { buildFindingModel } from "./finding-model.js"
import { buildChangeModel } from "./change-model.js"
import { DEFAULT_EXPIRING_WITHIN_DAYS } from "./expiring-window.js"
import { buildLifecycleModel } from "./lifecycle-model.js"
import { buildEvidenceModel } from "./evidence-model.js"
import type { EvidenceModel } from "./evidence-model.js"
import { PACKAGE_VERSION } from "./package-version.js"
import { DataProjectGenerationError } from "./errors.js"
import type { ReportFinding } from "./findings.js"
import type { ParseWarning } from "./parse.js"
import type { BuildFileSystem } from "./types.js"

/** Options for `computeDataArtifacts`/`generateDataArtifacts`/`checkArtifacts`. */
export interface GenerateDataArtifactsOptions {
  /** The filesystem capability, shared across every requested pass -- `./build` never imports `node:fs` (ADR 0058). */
  readonly fs: BuildFileSystem
  /** Directory discovery/linking resolves against. */
  readonly root: string
  /** Glob patterns (relative to `root`) a file must match at least one of to be discovered. Defaults to every `.ts`/`.tsx` file. */
  readonly include?: readonly string[]
  /** Glob patterns (relative to `root`) that prune a file or directory regardless of `include`. */
  readonly exclude?: readonly string[]
  /** Explicit `tsconfig.json` path override, or `false` to disable alias resolution -- see `LinkOptions.tsconfig`. */
  readonly tsconfig?: string | false
  /** Explicit cross-package schema discovery allowlist -- see `resolve-package-schema.ts`. */
  readonly packages?: readonly string[]
  /** Output path for the generated manifest `.ts` file. Omit to skip manifest generation (the inventory is still built and static rules still run). */
  readonly location?: string
  /** Output path for the Markdown documentation catalog. */
  readonly docs?: string
  /** Output path for the Dependency & Ownership report. */
  readonly ownership?: string
  /** Output directory for the Data Flow Diagram + Security Data-Flow Review set. */
  readonly flow?: string
  /** Output path for the composed Evidence Model (ADR 0050), as JSON -- see `ReportResult.evidence`, which is always computed regardless of this option; this only controls whether it's additionally written to disk. */
  readonly evidence?: string
  /** Escalate every pass's `warning` findings to `error` (never `info`). */
  readonly strict?: boolean
  /** Escalate static (ownership/sensitivity/duplication) findings to `error`. */
  readonly strictDocs?: boolean
  /** Escalate proven usage findings (abandoned capabilities, unconsumed owned fields) to `error` -- never escalates unresolved-consumer or indeterminate findings. */
  readonly strictOwnership?: boolean
  /** Escalate `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY`/`SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING` findings to `error` -- every finding `buildFlowGraph` produces. */
  readonly strictFlow?: boolean
  /** The commit SHA this run's evidence was generated against, stamped onto `EvidenceModel.provenance.commit`. Caller-supplied only -- `data-cap` never shells out to `git` itself, so omitting this records a stated absence, never a guess. */
  readonly commit?: string
  /** The single instant every time-sensitive computation in this run shares (`EvidenceModel.provenance.generatedAt`, Lifecycle Model's `daysRemaining`), so none of them can disagree about "now". Defaults to the wall clock at the moment this function is called. */
  readonly generatedAt?: Date
  /** How many days out counts as "expiring soon" for the Lifecycle Model and the documentation catalog's own expiring section. Defaults to `DEFAULT_EXPIRING_WITHIN_DAYS`. */
  readonly expiringWithinDays?: number
}

/** Everything one `generateDataArtifacts`/`checkArtifacts` run produced or would produce. */
export interface ReportResult {
  /** Present only when `--location` was requested. */
  readonly manifest: GenerateManifestResult | undefined
  /** Present only when `--docs` was requested. */
  readonly documentation: GenerateDocumentationResult | undefined
  /**
   * Always present (F1): the usage scan (proven consumption positions,
   * dependency edges, ownership/abandonment findings) runs on every call
   * regardless of which flags were passed -- it's foundational evidence the
   * Dependency Model needs, not something only `--ownership`/`--flow`
   * consumers should get. `--ownership` only controls whether the rendered
   * report additionally gets *written to disk* (`usage.location`) --
   * `usage` itself, and its `edges`/`findings`, are always real.
   */
  readonly usage: GenerateUsageResult
  /** Present only when `--flow` was requested. */
  readonly flow: GenerateFlowResult | undefined
  /**
   * `data-cap`'s Evidence Model (ADR 0050), composed from this same run's
   * `inventory`/`usage`/`manifest`/`findings` -- always present, unlike
   * `manifest`/`documentation`/`usage`/`flow` above, since composing it
   * costs nothing beyond data already held in memory. `--evidence` only
   * controls whether it's *additionally written to disk*; every consumer
   * of `ReportResult` (including `--json`) already gets the real, composed
   * model on every run, whether or not a file was requested for it.
   */
  readonly evidence: EvidenceModel
  /** Every finding across every requested generator, after `--strict*` escalation. */
  readonly findings: readonly ReportFinding[]
  /** Parse/link warnings from discovery, never blocking. */
  readonly warnings: readonly ParseWarning[]
  /** Count of `findings` at `error` severity. */
  readonly errorCount: number
  /** Count of `findings` at `warning` severity. */
  readonly warningCount: number
  /** Count of `findings` at `info` severity. */
  readonly infoCount: number
  /** True when `errorCount > 0` -- `generateDataArtifacts` throws instead of writing when this is true. */
  readonly hasBlockingErrors: boolean
}

/** Files this run would write, computed but not yet written -- shared between `generateDataArtifacts` (writes when nothing blocks) and `checkArtifacts` (never writes, only diffs). */
export interface ComputedArtifacts {
  /** The full report, including every finding across every requested generator. */
  readonly result: ReportResult
  /** Every file this run would write. */
  readonly writes: readonly {
    /** Absolute path this file would be written to. */
    readonly path: string
    /** The file's full intended content. */
    readonly content: string
  }[]
}

/**
 * The manifest snapshot's own path is deliberately independent of
 * `--location` (unlike its pre-existing co-located placement): it's a pure
 * diffing sidecar for this tool's own next run, never meant to be read as a
 * docs artifact the way `--location`/`--docs`/`--ownership`/`--evidence`'s
 * outputs are. Root-level and dot-prefixed, matching the same "internal,
 * not a docs artifact" convention `--flow`-without-`--ownership`'s own
 * `.data-cap-usage-internal.md` fallback already established.
 */
function snapshotPathFor(root: string): string {
  return path.join(root, ".data-cap-manifest-snapshot.json")
}

async function readManifestSnapshot(
  fs: BuildFileSystem,
  snapshotPath: string,
): Promise<ManifestSnapshot | undefined> {
  try {
    // "utf8" -> "" is equivalent: `JSON.parse` coerces the resulting Buffer
    // via its own `.toString()` for any valid-UTF-8 JSON text.
    // Stryker disable next-line StringLiteral
    const raw = await fs.readFile(snapshotPath, "utf8")
    return JSON.parse(raw) as ManifestSnapshot
  } catch {
    // absent, unreadable, or malformed -- treated as "no previous snapshot" (a
    // first run), never guessed at. An empty `catch` has no removable body.
  }
  return undefined
}

function escalateGroup(
  findings: readonly ReportFinding[] | undefined,
  shouldEscalate: boolean,
): readonly ReportFinding[] {
  if (findings === undefined) return []
  if (!shouldEscalate) return findings
  return findings.map((finding) =>
    finding.severity === "warning" ? { ...finding, severity: "error" as const } : finding,
  )
}

/**
 * Whether a findings group escalates to error: when `--strict` is on, or when
 * the `--strict-*` flag specific to that group is. One place so every group
 * asks the same question.
 */
function groupEscalates(
  options: GenerateDataArtifactsOptions,
  specificFlag: boolean | undefined,
): boolean {
  return options.strict === true || specificFlag === true
}

/**
 * Runs discovery, linking, inventory-building, and every requested
 * generator, returning the full `ReportResult` and the list of files that
 * *would* be written -- without writing anything. The one place both
 * `generateDataArtifacts` and `checkArtifacts` (C9) share, so the two can
 * never compute a different answer for the same inputs.
 */
export async function computeDataArtifacts(
  options: GenerateDataArtifactsOptions,
): Promise<ComputedArtifacts> {
  const generatedAt = options.generatedAt ?? new Date()
  const packages = options.packages ?? []
  const localFiles = await discoverCapabilityFiles({
    fs: options.fs,
    root: options.root,
    // discoverCapabilityFiles itself does `options.include ?? DEFAULT_INCLUDE`
    // / `options.exclude ?? []` -- passing `include: undefined` explicitly
    // (what always-spreading here would do) is behaviorally identical to
    // omitting the key, so no test can distinguish "spread only when
    // defined" from "always spread." Hand-verified: forcing these guards to
    // `true` and running the real suite passes unchanged.
    // Stryker disable next-line ConditionalExpression
    ...(options.include !== undefined ? { include: options.include } : {}),
    // Stryker disable next-line ConditionalExpression: spreading `exclude: undefined` is identical to omitting the key (see the note above)
    ...(options.exclude !== undefined ? { exclude: options.exclude } : {}),
  })
  const packageCache = new Map<string, Promise<PackageSchemaResolutionResult>>()
  const { files: packageFiles, warnings: packageWarnings } = await resolveAllowlistedPackages(
    packages,
    options.root,
    packageCache,
    options.fs,
  )
  const files = await mergeLocalAndPackageFiles(
    localFiles,
    packageFiles.map((f) => f.file),
    options.fs,
  )
  const linkResult = await linkCapabilityFiles(files, {
    fs: options.fs,
    root: options.root,
    // linkCapabilityFiles reads `options.tsconfig` directly off its own
    // options object -- a plain property access sees `undefined` whether
    // the key is present-but-undefined or absent entirely, so "spread only
    // when defined" and "always spread" are behaviorally identical here.
    // Hand-verified: forcing this guard to `true` and running the real
    // suite passes unchanged.
    // Stryker disable next-line ConditionalExpression
    ...(options.tsconfig !== undefined ? { tsconfig: options.tsconfig } : {}),
    packages,
  })
  const inventory: CapabilityInventory = buildInventory(linkResult)

  // Built here, immediately after the inventory and well before any
  // generator runs, because `--docs` renders an expiring-soon section from
  // it -- and because it is a pure projection over the inventory, so there
  // is nothing to gain by deferring it. Shares this run's single
  // `generatedAt` instant, so the catalog's "12d remaining" and Evidence
  // Model's own `daysRemaining` can never disagree by a tick.
  const expiringWithinDays = options.expiringWithinDays ?? DEFAULT_EXPIRING_WITHIN_DAYS
  const lifecycleModel = buildLifecycleModel(inventory, expiringWithinDays, generatedAt)

  const staticFindings = escalateGroup(
    [
      ...checkExclusiveGroups(inventory),
      ...checkStructuralDuplication(inventory),
      ...checkDuplicateEndpoints(inventory),
      ...checkOwnershipAndSensitivity(inventory),
    ],
    groupEscalates(options, options.strictDocs),
  )

  const writes: { path: string; content: string }[] = []

  // Change-detection ("has this capability's shape changed since the last
  // run?") and citation freshness-verification are independently valuable
  // Evidence Model facts -- unrelated to whether the runtime-consumed
  // `manifest.ts` file itself gets (re)written. Both now run whenever
  // `--location` OR `--evidence` is requested (ADR 0053), mirroring
  // env-cap's `evidence-snapshot.ts`: the manifest snapshot sidecar's own
  // read/write lifecycle is independent of `--location`'s own output path
  // (see `snapshotPathFor`'s own doc comment), and now independent of
  // whether `--location` was requested at all, too. Only `manifest.ts`'s
  // own rendered *content* (via `generateManifest`) stays exclusively gated
  // on `--location` -- that's the one output nobody but a `--location`
  // caller has any use for.
  const wantsChangeDetection = options.location !== undefined || options.evidence !== undefined

  let manifest: GenerateManifestResult | undefined
  let manifestChanges: ManifestChangeReport | undefined
  let citationFindings: readonly ReportFinding[] = []
  if (wantsChangeDetection) {
    const manifestSnapshotPath = snapshotPathFor(options.root)
    const previousSnapshot = await readManifestSnapshot(options.fs, manifestSnapshotPath)

    const snapshot = buildManifestSnapshot(inventory)
    const changes = diffManifestSnapshots(previousSnapshot, snapshot)
    manifestChanges = changes

    const citationSnapshotsByCapability = await buildCitationSnapshots(
      inventory,
      options.root,
      options.fs,
    )
    const snapshotWithCitations: ManifestSnapshot = {
      ...snapshot,
      capabilities: snapshot.capabilities.map((capability) => {
        const citationSnapshots = citationSnapshotsByCapability.get(
          `${capability.file}#${capability.exportName}`,
        )
        return citationSnapshots !== undefined ? { ...capability, citationSnapshots } : capability
      }),
    }
    citationFindings = await verifyDynamicAccessCitations(
      inventory,
      previousSnapshot,
      options.root,
      options.fs,
    )

    // Pushed in this order (manifest.ts before its own sidecar) so a
    // `--location` run's own `writes` ordering -- and therefore `--check`'s
    // stale-path reporting -- stays exactly what it was before this run
    // also started tracking the sidecar for `--evidence`-only callers.
    if (options.location !== undefined) {
      manifest = {
        ...generateManifest({
          inventory,
          location: options.location,
          root: options.root,
          snapshot,
          changes,
        }),
        snapshot: snapshotWithCitations,
      }
      writes.push({ path: manifest.location, content: manifest.content })
    }
    writes.push({
      path: manifestSnapshotPath,
      content: `${JSON.stringify(snapshotWithCitations, null, 2)}\n`,
    })
  }

  // Always runs (F1): the usage scan (proven consumption positions,
  // dependency edges, ownership/abandonment findings) is foundational
  // evidence on every call, not something only `--ownership`/`--flow`
  // consumers should get -- a caller that only ever passes `--evidence`
  // deserves the same populated Dependency Model an `--ownership`/`--flow`
  // run gets. Computed BEFORE `documentation` (even though `--docs` is the
  // earlier CLI flag) so `generateDocumentation` can render real proven
  // consumption positions. Only the *ownership-report file write* stays
  // opt-in, gated on `--ownership` itself.
  const usage: GenerateUsageResult = await generateUsage({
    inventory,
    location: options.ownership,
    files,
    scan: {
      fs: options.fs,
      root: options.root,
      ...(options.tsconfig !== undefined ? { tsconfig: options.tsconfig } : {}),
      packages,
    },
    ...(options.evidence !== undefined ? { evidencePath: options.evidence } : {}),
  })
  if (options.ownership !== undefined) {
    writes.push({ path: options.ownership, content: usage.content })
  }
  const usageFindings = escalateGroup(
    usage.findings,
    groupEscalates(options, options.strictOwnership),
  )

  let documentation: GenerateDocumentationResult | undefined
  if (options.docs !== undefined) {
    documentation = generateDocumentation({
      inventory,
      root: options.root,
      location: options.docs,
      // `manifestChanges` (not `manifest?.changes`) -- F2 decoupled
      // change-detection from `--location`, so `--docs`+`--evidence` (no
      // `--location`) already has a real diff to render too, the same way
      // `edges` below is no longer gated on a scan that only used to run
      // for `--ownership`/`--flow`. "spread only when defined" vs "always
      // spread" is unobservable here, the same established class as
      // `include`/`exclude`/`tsconfig`/`packages` elsewhere in this file:
      // `generateDocumentation` reads `options.changes` via plain property
      // access (`docs.ts`'s `renderChangesSinceLastReport` only ever checks
      // `changes === undefined`), so `{ changes: undefined }` and omitting
      // the key entirely read back identically. Hand-verified: forcing this
      // guard to `true` and running the real suite passes unchanged.
      // Stryker disable next-line ConditionalExpression
      ...(manifestChanges !== undefined ? { changes: manifestChanges } : {}),
      edges: usage.edges,
      ...(options.evidence !== undefined ? { evidencePath: options.evidence } : {}),
      expiringWithinDays,
      generatedAt,
    })
    writes.push({ path: documentation.location, content: documentation.content })
  }

  let flow: GenerateFlowResult | undefined
  if (options.flow !== undefined) {
    flow = generateFlow({
      inventory,
      root: options.root,
      location: options.flow,
      edges: usage.edges,
      additionalFindings: [...staticFindings, ...usageFindings],
      ...(options.evidence !== undefined ? { evidencePath: options.evidence } : {}),
    })
    for (const file of flow.files) writes.push(file)
  }
  const flowFindings = escalateGroup(flow?.findings, groupEscalates(options, options.strictFlow))
  // Citation integrity findings escalate alongside `staticFindings` -- both
  // are about a documentData()-declared fact's own quality (missing owner,
  // missing purpose, a citation that no longer checks out), not about
  // proven usage the way `usageFindings`/`flowFindings` are.
  const escalatedCitationFindings = escalateGroup(
    citationFindings,
    groupEscalates(options, options.strictDocs),
  )

  const allFindings = [
    ...staticFindings,
    ...(manifest?.findings ?? []),
    ...escalatedCitationFindings,
    ...usageFindings,
    ...flowFindings,
  ]
  const errorCount = allFindings.filter((f) => f.severity === "error").length
  const warningCount = allFindings.filter((f) => f.severity === "warning").length
  const infoCount = allFindings.filter((f) => f.severity === "info").length

  // The full canonical model stack (ADR 0050), composed once here -- the
  // single place this run's own Dependency/Ownership/Finding/Change/
  // Evidence models come from. Every one of these is a pure projection
  // over data already computed above (never a second scan/parse), so
  // building them costs nothing beyond object construction, unlike the
  // manifest/docs/ownership/flow generators themselves. `dependencyModel`
  // is always real now (F1: `usage` always ran) -- unlike `changeModel`,
  // which still depends on whether change-detection ran this run at all
  // (`--location` or `--evidence`, F2).
  const dependencyModel = buildDependencyModel(usage.edges)
  const ownershipModel = buildOwnershipModel(inventory)
  const findingModel = buildFindingModel(allFindings)
  const changeModel =
    manifestChanges !== undefined
      ? buildChangeModel(manifestChanges, inventory.capabilities, dependencyModel)
      : undefined
  // `generatedAt`/`toolVersion` are always stamped (OUT-06): a provenance
  // block a consumer can't rely on being present is worth less than no
  // provenance vocabulary at all, and both are facts this orchestrator
  // genuinely holds -- the run's own single shared instant and `data-cap`'s
  // own installed version. `commit` stays caller-supplied (ADR 0050's
  // "never ambient-detected" principle, kept exactly where it still
  // applies): `data-cap` never shells out to `git`, so `undefined` here is
  // a stated absence, not a guess. `--check`'s own drift comparison
  // normalizes `generatedAt` away (see `check-artifacts.ts`) so a live
  // timestamp can't make `--evidence` permanently "stale."
  const evidence = buildEvidenceModel(
    {
      capability: inventory,
      lifecycle: lifecycleModel,
      dependency: dependencyModel,
      ownership: ownershipModel,
      finding: findingModel,
      ...(changeModel !== undefined ? { change: changeModel } : {}),
    },
    {
      generatedAt: generatedAt.toISOString(),
      toolVersion: PACKAGE_VERSION,
      commit: options.commit,
    },
  )
  if (options.evidence !== undefined) {
    writes.push({ path: options.evidence, content: `${JSON.stringify(evidence, null, 2)}\n` })
  }

  const result: ReportResult = {
    manifest,
    documentation,
    usage,
    flow,
    evidence,
    findings: allFindings,
    // Root-relative, matching `inventory.warnings` (OUT-01) -- `--json`'s
    // own warning list must not be the one place an absolute path survives.
    warnings: [...packageWarnings, ...linkResult.warnings].map((warning) => ({
      ...warning,
      file: displayPath(options.root, warning.file),
    })),
    errorCount,
    warningCount,
    infoCount,
    hasBlockingErrors: errorCount > 0,
  }

  return { result, writes }
}

/**
 * Computes every requested artifact and, only if nothing blocks (no
 * `error`-severity finding after `--strict*` escalation), writes all of
 * them. Throws `DataProjectGenerationError` instead of writing a partial
 * set when something does block.
 */
export async function generateDataArtifacts(
  options: GenerateDataArtifactsOptions,
): Promise<ReportResult> {
  const { result, writes } = await computeDataArtifacts(options)
  if (result.hasBlockingErrors) throw new DataProjectGenerationError(result.findings)

  for (const write of writes) {
    await options.fs.mkdir(path.dirname(write.path), { recursive: true })
    // "utf8" is required by the BuildFileSystem contract; `write.content` is
    // always a string, so this is the only meaningful encoding.
    // Stryker disable next-line StringLiteral
    await options.fs.writeFile(write.path, write.content, "utf8")
  }

  // The evidence cache's `.fingerprint` sidecar is written here rather than
  // pushed onto `writes` (EVD-01), and the distinction is deliberate:
  // everything in `writes` is a committed, reviewable artifact `--check`
  // diffs, while the sidecar is a purely local cache key -- derived from the
  // same source that produced the artifact next to it, and worthless to
  // anyone but the machine that wrote it. Diffing it under `--check` would
  // make a fresh clone report drift for a file that is (correctly)
  // gitignored. Written last, so it can never claim freshness for an
  // evidence artifact that failed to write.
  if (options.evidence !== undefined) {
    await writeEvidenceFingerprint(
      options.evidence,
      await computeSourceFingerprint({
        fs: options.fs,
        root: options.root,
        ...(options.include !== undefined ? { include: options.include } : {}),
        ...(options.exclude !== undefined ? { exclude: options.exclude } : {}),
        ...(options.packages !== undefined ? { packages: options.packages } : {}),
      }),
      options.fs,
    )
  }

  return result
}
