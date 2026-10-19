// data-cap build-time benchmark suite: the cost of the CLI/CI tooling (`data-cap/build`) that discovers
// capability files, links them with the TypeScript compiler API and generates the manifest,
// documentation, ownership, flow and evidence artifacts. This is development and CI cost, paid on every
// pipeline run and by every developer who regenerates artifacts -- not request-time cost. See
// ../READING-BENCHMARKS.md and ../WRITING-BENCHMARKS.md.
//
// Imports data-cap by its PACKAGE NAME, never a monorepo-relative path.

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineSuite } from "internal-package-contract/benchmark"
import {
  UNOWNED,
  buildEvidenceModel,
  buildFlowGraph,
  buildInventory,
  buildLifecycleModel,
  buildManifestSnapshot,
  buildOpenApiSchemaArtifact,
  buildOwnershipMatrix,
  buildOwnershipModel,
  buildSarifLog,
  checkArtifacts,
  checkDuplicateEndpoints,
  checkExclusiveGroups,
  checkOwnershipAndSensitivity,
  checkStructuralDuplication,
  computeDataArtifacts,
  computeExpiringEntries,
  computeSourceFingerprint,
  deriveUsageFindings,
  diffManifestSnapshots,
  discoverCapabilityFiles,
  findManifestExportCollisions,
  generateDataArtifacts,
  generateDocumentation,
  generateFlow,
  generateManifest,
  getEvidenceModel,
  linkCapabilityFiles,
  parseCapabilityFile,
  projectAuditEvidence,
  projectClassificationEvidence,
  projectComplianceEvidence,
  projectFields,
  projectGetters,
  projectMutators,
  projectOperationInventory,
  projectPrivacyEvidence,
  projectRetentionEvidence,
  projectSubscriptions,
  renderDocumentation,
  renderManifest,
  renderOwnershipGraphDot,
  renderUsageReport,
} from "data-cap/build"
import { defineEvidenceProjection } from "data-cap/evidence"
import { nodeBuildFileSystem } from "data-cap/node"
import { generateBuildtimeFixtures } from "../benchmark-fixtures/generator.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturesRoot = path.join(here, "fixtures", "generated")
const SLOW = { warmupIterations: 1, minIterations: 3, maxIterations: 8, targetDurationMs: 1500 }

/** Fixture trees are expensive to write at large sizes, so each size is generated once and shared. */
const fixtureCache = new Map()
function fixture(n) {
  if (!fixtureCache.has(n)) {
    const root = path.join(fixturesRoot, `n${String(n)}`, "capabilities")
    fixtureCache.set(n, generateBuildtimeFixtures({ tierName: `n${String(n)}`, count: n, outputDir: root }).then(() => root))
  }
  return fixtureCache.get(n)
}

async function readAll(dir) {
  let bytes = 0
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    bytes += entry.isDirectory() ? await readAll(full) : (await fs.readFile(full, "utf8")).length
  }
  return bytes
}

/** Discovered and linked once per size: linking is the heaviest step, and every pure function below reads its result. */
const linkCache = new Map()
function linked(n) {
  if (!linkCache.has(n)) {
    linkCache.set(
      n,
      (async () => {
        const root = await fixture(n)
        const files = await discoverCapabilityFiles({ root, fs: nodeBuildFileSystem })
        const linkResult = await linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root, tsconfig: false })
        return { root, files, linkResult }
      })(),
    )
  }
  return linkCache.get(n)
}

/** The capability inventory (what almost every function below reads) and the fixture root, once per size. */
const inventoryCache = new Map()
function inventoryAt(n) {
  if (!inventoryCache.has(n)) {
    inventoryCache.set(
      n,
      linked(n).then(({ root, linkResult }) => ({ root, inventory: buildInventory(linkResult) })),
    )
  }
  return inventoryCache.get(n)
}

const INVENTORY = {
  "inventory.capabilities": "swept",
  "inventory.schemaVersion": "fixed: one number, copied",
  "inventory.warnings": "fixed: none, the fixtures link without warnings",
}
const WINDOW_FIXED = "fixed: 30 days, the default window; the scan reads every capability once whatever the window"
const NOW_FIXED = "fixed: one instant, because the clock only decides which entries are due"
const ROOT_FIXED = "fixed: the generated fixture tree, which only shortens the file paths printed"
const EDGES_NONE = "fixed: none, because the fixtures contain no consuming files, so no capability has a consumer"
const FS_FIXED = "fixed: the Node filesystem adapter, which is what every real build uses"
const EXCLUDE_FIXED = "fixed: the default ignore list, whose patterns are tested against every path walked"
const INCLUDE_FIXED = "fixed: the default capability glob"
const PACKAGES_NOT = "not covered: resolving an allowlisted package reads that package's capabilities, and the fixtures allowlist none"
const TSCONFIG_FIXED = "fixed: `false`, so no TypeScript program is built (see the type-information variable)"
const LOCATION_FIXED = "fixed: one file under the fixture's output folder"
const STRICT_NOT = "not covered: it only decides whether a finding fails the run, which the fixtures never raise"

const pure = (spec) => ({
  variables: [FILES, FIXTURE_SHAPE, RUNTIME],
  sampling: { warmupIterations: 1, minIterations: 5, maxIterations: 50, targetDurationMs: 800 },
  inEndToEnd: { callsPerOperation: 0, description: "Not part of the end-to-end operation, which calls the generator; measured on its own." },
  ...spec,
})

const projection = defineEvidenceProjection({
  capabilityCount: (evidence) => evidence.capability.capabilities.length,
  fieldCount: (evidence) => evidence.capability.capabilities.reduce((sum, capability) => sum + capability.fields.length, 0),
  ownedCapabilities: (evidence) => evidence.ownership?.entries.filter((entry) => entry.owner !== UNOWNED).flatMap((entry) => entry.capabilities).length,
  provenance: (evidence) => evidence.provenance,
})

const FILES = { name: "capability files", how: "swept", description: "The tier axis: how many files in the project declare a data capability." }
const FIXTURE_SHAPE = { name: "capability content", how: "fixed", value: "realistic generated TypeScript: literal schemas, varied fields, getters and mutators, documentData calls", description: "Parsing cost depends on source-text volume and variety; the fixtures are literal TypeScript, never executed by the tooling." }
const DISK = { name: "filesystem", how: "fixed", value: "local SSD through the Node adapter", description: "A network or virtual filesystem adds latency per file; not covered." }
const RUNTIME = { name: "runtime", how: "fixed", value: "Node (V8)", description: "Measured on Node only." }

const EVIDENCE = {
  "evidence.capability": "swept",
  "evidence.change": "not covered: the benchmark's evidence model has no change model, an optional one the projection reads only when present",
  "evidence.computed": "swept",
  "evidence.dependency": "not covered: the benchmark's evidence model has no dependency model, an optional one the projection reads only when present",
  "evidence.finding": "not covered: the benchmark's evidence model has no finding model, an optional one the projection reads only when present",
  "evidence.lifecycle": "swept",
  "evidence.ownership": "swept",
  "evidence.provenance": "fixed: one small record, which is copied",
  "evidence.runtimeContract": "fixed: one small record, which is copied",
  "evidence.schemaVersion": "fixed: one number, copied",
}

/** The evidence model (the same shape the generators build), once per size. */
const evidenceCache = new Map()
function evidenceAt(n) {
  if (!evidenceCache.has(n)) {
    evidenceCache.set(
      n,
      inventoryAt(n).then(({ inventory }) => {
        const generatedAt = new Date(0)
        return buildEvidenceModel(
          {
            capability: inventory,
            lifecycle: buildLifecycleModel(inventory, 30, generatedAt),
            ownership: buildOwnershipModel(inventory),
          },
          { generatedAt: generatedAt.toISOString(), toolVersion: "benchmark", commit: undefined },
        )
      }),
    )
  }
  return evidenceCache.get(n)
}

/** The options every artifact function takes, with each artifact written under its own folder so runs never collide. */
async function artifactOptions(n, label) {
  const root = await fixture(n)
  const outputDir = path.join(path.dirname(root), `artifacts-${label}`)
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })
  return {
    root,
    fs: nodeBuildFileSystem,
    tsconfig: false,
    location: path.join(outputDir, "data.manifest.ts"),
    docs: path.join(outputDir, "DATA.md"),
    ownership: path.join(outputDir, "OWNERSHIP.md"),
    flow: path.join(outputDir, "flow"),
    evidence: path.join(outputDir, "data.evidence.json"),
  }
}

export default defineSuite({
  package: { name: "data-cap", bundleFiles: ["dist/build.js", "dist/node.js", "dist/evidence.js"] },
  tiers: [20, 40, 80, 160, 320, 640, 1280, 2560],

  workload: {
    unit: "file",
    description:
      "One capability file in the project. 160 is a large application's worth of capabilities; 640 a large monorepo's. The ladder stops at 2,560, not 10,240, because every size writes a real project of TypeScript files and links them with the TypeScript compiler API, which takes minutes at the largest sizes.",
    typicalN: 160,
  },

  endToEnd: {
    purpose:
      "Shows what a pipeline run or a developer pays to regenerate every data-cap artifact (manifest, documentation, ownership report, flow diagrams and evidence) for a project, compared with the bare minimum of just reading every capability file. The baseline is the unavoidable floor -- the files must at least be read -- so the difference is data-cap's parsing, linking and rendering. This is CI and development time, paid on every build, not request-time cost.",
    baseline: {
      description: "Walk the project directory and read every capability file as text -- no data-cap.",
      sampling: SLOW,
      setup: async (n) => ({ root: await fixture(n) }),
      run: ({ root }) => readAll(root),
    },
    withPackage: {
      description: "`generateDataArtifacts` discovers, parses and links every capability once and writes all of its artifacts.",
      sampling: SLOW,
      setup: async (n) => {
        const root = await fixture(n)
        const outputDir = path.join(path.dirname(root), "artifacts-output")
        await fs.rm(outputDir, { recursive: true, force: true })
        await fs.mkdir(outputDir, { recursive: true })
        return { root, outputDir }
      },
      run: ({ root, outputDir }) =>
        generateDataArtifacts({
          root,
          fs: nodeBuildFileSystem,
          tsconfig: false,
          location: path.join(outputDir, "data.manifest.ts"),
          docs: path.join(outputDir, "DATA.md"),
          ownership: path.join(outputDir, "OWNERSHIP.md"),
          flow: path.join(outputDir, "flow"),
          evidence: path.join(outputDir, "data.evidence.json"),
        }),
    },
    variables: [FILES, FIXTURE_SHAPE, DISK, RUNTIME, { name: "artifacts requested", how: "fixed", value: "manifest, docs, ownership, flow and evidence", description: "Requesting fewer artifacts costs less." }, { name: "type information", how: "fixed", value: "tsconfig: false", description: "Linking without a project's tsconfig; resolving a full TypeScript program adds substantial cost and is not covered." }, { name: "cache state", how: "fixed", value: "no incremental cache", description: "Every run parses from scratch; the tooling keeps no build cache." }],
  },

  notBenchmarked: {
    buildChangeModel:
      "Its input is the change report of the previous manifest, empty on a first run and small on any later one; the model it builds is derived once in the evidence build, which `build-evidence-model` measures.",
    buildCitationSnapshots:
      "It re-reads the files that dynamic-access citations point at, and the fixtures declare no citations, so there is nothing for it to read at any size.",
    evaluateLiteral:
      "An internal step of the parser that evaluates one syntax node of a schema literal, a constant amount of work per node; `parse-capability-file` measures it inside every parse.",
    generateUsage:
      "It scans the files that consume the capabilities, and the fixtures contain none, so there is nothing for it to scan; the report it renders is measured as `render-usage-report`.",
    generatedBanner:
      "It joins three short strings into one comment, a constant amount of work done once per generated file.",
    groupEdgesByCapability:
      "It groups the dependency edges by capability, and the fixtures have no consumers, so there are no edges to group at any size.",
    groupEdgesByConsumer:
      "It groups the dependency edges by consumer, and the fixtures have no consumers, so there are no edges to group at any size.",
    locationOf:
      "It reads the position fields of one finding and builds one location, a constant amount of work done once per finding.",
    positionOf:
      "It converts one syntax node's offset into a line and column, a constant amount of work done once per node.",
    renderCapabilityDiagram:
      "It draws one diagram from the flows between capabilities and their consumers, and the fixtures have no consumers, so there are no flows to draw.",
    renderDependencyGraphDot:
      "It draws the consumer graph, and the fixtures have no consumers, so the graph has no edges at any size.",
    renderOverviewDiagram:
      "It draws one diagram from the flows between capabilities and their consumers, and the fixtures have no consumers, so there are no flows to draw.",
    renderSensitivityDiagram:
      "It draws one diagram from the flows between capabilities and their consumers, and the fixtures have no consumers, so there are no flows to draw.",
    scanDependencies:
      "It reads the files that consume the capabilities, and the fixtures contain none, so there is nothing for it to read at any size.",
    scanFileForUsage:
      "An internal step of `scanDependencies` that reads one parsed consuming file; the fixtures contain no consuming files.",
    verifyDynamicAccessCitations:
      "It verifies the files that dynamic-access citations point at, and the fixtures declare no citations, so there is nothing for it to verify.",
    writeEvidenceFingerprint:
      "It writes one short text file through the filesystem adapter, which the standard keeps out of the benchmarks (no real I/O).",
  },

  functions: [
    {
      id: "discover-capability-files",
      name: "discoverCapabilityFiles",
      why: "Every build-time command starts by finding the project's capability files, so its cost is paid first by every generator and every CI run.",
      poorPerformanceMeans: "Every pipeline step that touches data-cap starts later, and a super-linear regression would slow monorepos with thousands of files before any real work begins.",
      expectedComplexity: "linear",
      complexityReason: "It walks the directory tree once and tests each path, so cost is proportional to the number of files visited.",
      variables: [FILES, DISK, { name: "directory depth", how: "fixed", value: "flat", description: "Deeper trees add a directory read per level." }, { name: "unrelated files", how: "fixed", value: "none", description: "Real repositories hold many other files that must also be walked; a pure capability tree is the best case." }, RUNTIME],
      inEndToEnd: { callsPerOperation: 1, description: "Once at the start of every artifact generation." },
      covers: {
        discoverCapabilityFiles: {
          "options.exclude": EXCLUDE_FIXED,
          "options.fs": FS_FIXED,
          "options.include": INCLUDE_FIXED,
          "options.root": "swept",
        },
      },
      sampling: SLOW,
      setup: async (n) => ({ root: await fixture(n) }),
      run: ({ root }) => discoverCapabilityFiles({ root, fs: nodeBuildFileSystem }),
    },
    {
      id: "link-capability-files",
      name: "linkCapabilityFiles",
      why: "Parses every capability file with the TypeScript compiler API and links the declarations (schemas, getters, mutators, documentation) into one model. It is by far the heaviest build-time step, so it dominates every artifact run.",
      poorPerformanceMeans: "Build time grows with the size of the project, and a super-linear regression would make the largest monorepos the slowest to build -- exactly where developers feel it most.",
      expectedComplexity: "linear",
      complexityReason: "Each file is parsed once and its declarations linked by name through maps, so cost is proportional to the amount of source text.",
      variables: [FILES, FIXTURE_SHAPE, DISK, { name: "type information", how: "fixed", value: "tsconfig: false", description: "No TypeScript program is built for type resolution." }, RUNTIME],
      covers: {
        linkCapabilityFiles: {
          files: "swept",
          "options.fs": FS_FIXED,
          "options.packages": PACKAGES_NOT,
          "options.root": "fixed: the generated fixture tree",
          "options.tsconfig": TSCONFIG_FIXED,
        },
      },
      inEndToEnd: { callsPerOperation: 1, description: "Once per artifact run; every artifact is rendered from this one shared pass." },
      sampling: SLOW,
      setup: async (n) => {
        const root = await fixture(n)
        return { root, files: await discoverCapabilityFiles({ root, fs: nodeBuildFileSystem }) }
      },
      run: ({ root, files }) => linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root, tsconfig: false }),
    },
    {
      id: "build-inventory",
      name: "buildInventory",
      why: "Condenses the linked model into the capability inventory every artifact reads from.",
      poorPerformanceMeans: "Every artifact run pays the slowdown after the heavy parsing has already finished, and it grows with the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "It visits each linked capability once and records one inventory entry per capability, so cost is proportional to their number.",
      variables: [FILES, FIXTURE_SHAPE, RUNTIME],
      covers: {
        buildInventory: {
          "linkResult.capabilities": "swept",
          "linkResult.root": "fixed: the generated fixture tree",
          "linkResult.warnings": "fixed: none, the fixtures link without warnings",
        },
      },
      inEndToEnd: { callsPerOperation: 1, description: "Once per artifact run." },
      setup: async (n) => (await linked(n)).linkResult,
      run: (linkResult) => buildInventory(linkResult),
    },
    {
      id: "build-ownership-model",
      name: "buildOwnershipModel",
      why: "Groups capabilities by their declared owner for the ownership report and audits.",
      poorPerformanceMeans: "Ownership reviews slow down with the size of the project, which discourages running them on every change.",
      expectedComplexity: "linear",
      complexityReason: "It visits each capability once and appends it to its owner's group in a map, so cost is proportional to the number of capabilities.",
      variables: [FILES, { name: "owner distribution", how: "fixed", value: "a handful of owners across all capabilities", description: "Thousands of distinct owners add map entries proportionally." }, RUNTIME],
      covers: { buildOwnershipModel: { ...INVENTORY } },
      inEndToEnd: { callsPerOperation: 1, description: "Once per artifact run." },
      setup: async (n) => buildInventory((await linked(n)).linkResult),
      run: (inventory) => buildOwnershipModel(inventory),
    },
    {
      id: "build-lifecycle-model",
      name: "buildLifecycleModel",
      why: "Finds capabilities that are expiring or past review, for lifecycle reports and compliance checks.",
      poorPerformanceMeans: "Compliance reports slow down with the size of the project.",
      expectedComplexity: "linear",
      complexityReason: "It checks each capability's dates against the review window once, so cost is proportional to the number of capabilities.",
      variables: [FILES, { name: "review window", how: "fixed", value: "30 days", description: "The window changes how many capabilities are flagged, not how many are checked." }, RUNTIME],
      covers: { buildLifecycleModel: { ...INVENTORY, expiringWithinDays: WINDOW_FIXED, now: NOW_FIXED } },
      inEndToEnd: { callsPerOperation: 1, description: "Once per artifact run." },
      setup: async (n) => buildInventory((await linked(n)).linkResult),
      run: (inventory) => buildLifecycleModel(inventory, 30, new Date(0)),
    },
    {
      id: "build-evidence-model",
      name: "buildEvidenceModel",
      why: "Assembles the capability, lifecycle and ownership models into the single evidence model that audits and custom projections read.",
      poorPerformanceMeans: "It should cost next to nothing at any size. If it started copying the models it assembles, compliance tooling that rebuilds evidence on every run would get slower with project size, and the saving of building the models once and sharing them would be lost.",
      expectedComplexity: "constant",
      complexityReason: "It returns a small record that holds references to the already-built capability, lifecycle and ownership models plus a provenance stamp (read from the source: nothing is copied or walked), so the work does not depend on how many capabilities the models contain.",
      variables: [FILES, RUNTIME],
      covers: {
        buildEvidenceModel: {
          "models.capability": "swept",
          "models.change": "not covered: an optional model is held by reference like the others, so passing it adds constant work",
          "models.dependency": "not covered: an optional model is held by reference like the others, so passing it adds constant work",
          "models.finding": "not covered: an optional model is held by reference like the others, so passing it adds constant work",
          "models.lifecycle": "swept",
          "models.ownership": "swept",
          "provenance.commit": "fixed: none, the commit is only copied",
          "provenance.generatedAt": "fixed: one instant, which is only copied",
          "provenance.toolVersion": "fixed: one short string, which is only copied",
        },
      },
      inEndToEnd: { callsPerOperation: 1, description: "Once per artifact run." },
      setup: async (n) => {
        const inventory = buildInventory((await linked(n)).linkResult)
        return { inventory, lifecycle: buildLifecycleModel(inventory, 30, new Date(0)), ownership: buildOwnershipModel(inventory) }
      },
      run: ({ inventory, lifecycle, ownership }) => buildEvidenceModel({ capability: inventory, lifecycle, ownership }, { generatedAt: new Date(0).toISOString(), toolVersion: "benchmark", commit: undefined }),
    },
    {
      id: "generate-artifacts",
      name: "generateDataArtifacts",
      why: "The combined entry point most pipelines call: it shares one discovery and parse across the manifest, documentation, ownership report, flow diagrams and evidence.",
      poorPerformanceMeans:
        "The shared pass is the whole saving over running the generators one by one; if it stopped being shared, every pipeline would pay several times the parsing.",
      expectedComplexity: "linear",
      complexityReason:
        "It discovers, parses and links once and renders each artifact from that single pass, so cost is proportional to the amount of source.",
      variables: [FILES, FIXTURE_SHAPE, DISK, RUNTIME],
      covers: {
        generateDataArtifacts: {
          "options.commit": "not covered: it calls the caller's own function once, whose cost is the caller's",
          "options.exclude": EXCLUDE_FIXED,
          "options.expiringWithinDays": WINDOW_FIXED,
          "options.fs": FS_FIXED,
          "options.generatedAt": "fixed: one instant, which is only printed in the headers",
          "options.include": INCLUDE_FIXED,
          "options.packages": PACKAGES_NOT,
          "options.root": "swept",
          "options.strict": STRICT_NOT,
          "options.strictDocs": STRICT_NOT,
          "options.strictFlow": STRICT_NOT,
          "options.strictOwnership": STRICT_NOT,
          "options.tsconfig": TSCONFIG_FIXED,
          "options.docs": "fixed: requested, at one location",
          "options.evidence": "fixed: requested, at one location",
          "options.flow": "fixed: requested, at one folder",
          "options.location": "fixed: requested, at one location",
          "options.ownership": "fixed: requested, at one location",
        },
      },
      inEndToEnd: {
        callsPerOperation: 1,
        description: "This is the end-to-end operation itself.",
        // It runs each of these phases once, so their time is inside its own and is not counted twice.
        includes: [
          "discover-capability-files",
          "link-capability-files",
          "build-inventory",
          "build-ownership-model",
          "build-lifecycle-model",
          "build-evidence-model",
        ],
      },
      sampling: SLOW,
      setup: async (n) => ({ ...(await artifactOptions(n, "all")) }),
      run: (options) => generateDataArtifacts(options),
    },
    {
      id: "compute-artifacts",
      name: "computeDataArtifacts",
      why: "It computes every artifact in memory without writing any, for tools that want the content and not the files.",
      poorPerformanceMeans: "A slower read-only run in proportion to the amount of source.",
      expectedComplexity: "linear",
      complexityReason:
        "It runs the same single discovery, parse and link as generation and renders each artifact once, so cost is proportional to the amount of source.",
      variables: [FILES, FIXTURE_SHAPE, DISK, RUNTIME],
      covers: {
        computeDataArtifacts: {
          "options.commit": "not covered: it calls the caller's own function once, whose cost is the caller's",
          "options.exclude": EXCLUDE_FIXED,
          "options.expiringWithinDays": WINDOW_FIXED,
          "options.fs": FS_FIXED,
          "options.generatedAt": "fixed: one instant, which is only printed in the headers",
          "options.include": INCLUDE_FIXED,
          "options.packages": PACKAGES_NOT,
          "options.root": "swept",
          "options.strict": STRICT_NOT,
          "options.strictDocs": STRICT_NOT,
          "options.strictFlow": STRICT_NOT,
          "options.strictOwnership": STRICT_NOT,
          "options.tsconfig": TSCONFIG_FIXED,
          "options.docs": "fixed: requested, at one location",
          "options.evidence": "fixed: requested, at one location",
          "options.flow": "fixed: requested, at one folder",
          "options.location": "fixed: requested, at one location",
          "options.ownership": "fixed: requested, at one location",
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "A read-only run, not part of generating the artifacts." },
      sampling: SLOW,
      setup: async (n) => artifactOptions(n, "compute"),
      run: (options) => computeDataArtifacts(options),
    },
    {
      id: "check-artifacts",
      name: "checkArtifacts",
      why: "The CI gate that fails when a committed artifact is stale: it recomputes every artifact in memory and compares it with the file on disk.",
      poorPerformanceMeans: "A slower gate on every pull request, which is the most frequent place build-time cost is paid.",
      expectedComplexity: "linear",
      complexityReason:
        "It runs one shared discovery, parse and link, renders each artifact once and compares each with its file, so cost is proportional to the amount of source.",
      variables: [FILES, FIXTURE_SHAPE, DISK, RUNTIME],
      covers: {
        checkArtifacts: {
          "options.commit": "not covered: it calls the caller's own function once, whose cost is the caller's",
          "options.exclude": EXCLUDE_FIXED,
          "options.expiringWithinDays": WINDOW_FIXED,
          "options.fs": FS_FIXED,
          "options.generatedAt": "fixed: one instant, which is only printed in the headers",
          "options.include": INCLUDE_FIXED,
          "options.packages": PACKAGES_NOT,
          "options.root": "swept",
          "options.strict": STRICT_NOT,
          "options.strictDocs": STRICT_NOT,
          "options.strictFlow": STRICT_NOT,
          "options.strictOwnership": STRICT_NOT,
          "options.tsconfig": TSCONFIG_FIXED,
          "options.docs": "fixed: requested, at one location",
          "options.evidence": "fixed: requested, at one location",
          "options.flow": "fixed: requested, at one folder",
          "options.location": "fixed: requested, at one location",
          "options.ownership": "fixed: requested, at one location",
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "A CI gate, not part of generating the artifacts." },
      sampling: SLOW,
      setup: async (n) => {
        const options = await artifactOptions(n, "check")
        await generateDataArtifacts(options)
        return options
      },
      run: (options) => checkArtifacts(options),
    },
    {
      id: "compute-source-fingerprint",
      name: "computeSourceFingerprint",
      why: "It decides whether a cached evidence model is still current, so it runs before every cached read and must cost far less than the recompute it avoids.",
      poorPerformanceMeans: "A cache that costs nearly as much as the recompute it saves, which makes every cached read pointless.",
      expectedComplexity: "linear",
      complexityReason:
        "It walks the capability files and hashes each one's text once, with no parsing or linking, so cost is proportional to the bytes of source.",
      variables: [FILES, FIXTURE_SHAPE, DISK, RUNTIME],
      covers: {
        computeSourceFingerprint: {
          "options.exclude": EXCLUDE_FIXED,
          "options.fs": FS_FIXED,
          "options.include": INCLUDE_FIXED,
          "options.packages": PACKAGES_NOT,
          "options.root": "swept",
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "Run before a cached read, not while generating." },
      sampling: SLOW,
      setup: async (n) => ({ root: await fixture(n) }),
      run: ({ root }) => computeSourceFingerprint({ root, fs: nodeBuildFileSystem }),
    },
    {
      id: "get-evidence-model",
      name: "getEvidenceModel",
      why: "The cached way to read the evidence model: it trusts a committed artifact only while the source fingerprint matches, and recomputes otherwise.",
      poorPerformanceMeans:
        "A miss that costs more than a plain recompute, or a hit that costs nearly as much as one, would make the cache worse than not having it.",
      expectedComplexity: "linear",
      complexityReason:
        "A hit fingerprints the source and reads one file; a miss does that and then rebuilds the model, so both grow with the amount of source.",
      variables: [
        FILES,
        FIXTURE_SHAPE,
        DISK,
        { name: "cache state", how: "variant", description: "A committed artifact whose fingerprint matches, or none." },
        RUNTIME,
      ],
      variants: [
        { name: "cache-hit", description: "The committed artifact is current: read from disk, no recompute.", options: { hit: true } },
        { name: "cache-miss", description: "No artifact exists: the model is rebuilt.", options: { hit: false } },
      ],
      covers: {
        getEvidenceModel: {
          "options.commit": "not covered: it calls the caller's own function once, whose cost is the caller's",
          "options.exclude": EXCLUDE_FIXED,
          "options.expiringWithinDays": WINDOW_FIXED,
          "options.fs": FS_FIXED,
          "options.generatedAt": "fixed: one instant, which is only printed in the headers",
          "options.include": INCLUDE_FIXED,
          "options.packages": PACKAGES_NOT,
          "options.root": "swept",
          "options.strict": STRICT_NOT,
          "options.strictDocs": STRICT_NOT,
          "options.strictFlow": STRICT_NOT,
          "options.strictOwnership": STRICT_NOT,
          "options.tsconfig": TSCONFIG_FIXED,
          "options.docs": "fixed: requested, at one location",
          "options.evidence": "variant:cache-hit",
          "options.flow": "fixed: requested, at one folder",
          "options.location": "fixed: requested, at one location",
          "options.ownership": "fixed: requested, at one location",
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "A cached read, not part of generating the artifacts." },
      sampling: SLOW,
      setup: async (n, options) => {
        const artifacts = await artifactOptions(n, options?.hit ? "hit" : "miss")
        if (options?.hit) await generateDataArtifacts(artifacts)
        return artifacts
      },
      run: (options) => getEvidenceModel(options),
    },
    {
      id: "parse-capability-file",
      name: "parseCapabilityFile",
      why: "Every generator parses each capability file with the TypeScript parser, which is the largest single cost of a build-time run.",
      poorPerformanceMeans:
        "Every build-time command slows in proportion to the source it parses, and a super-linear parse would punish the largest files first.",
      expectedComplexity: "linear",
      complexityReason:
        "The text is parsed once by the TypeScript parser and the declarations read from one syntax tree, so cost is proportional to the length of the source.",
      variables: [{ ...FILES, description: "The tier axis: how many copies of the fixture capability the one source file declares." }, FIXTURE_SHAPE, RUNTIME],
      covers: {
        parseCapabilityFile: {
          filePath: "fixed: one short path, which is only recorded in the result",
          sourceText: "swept",
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "Run once per capability file inside every generator; measured here on one file." },
      sampling: { warmupIterations: 1, minIterations: 5, maxIterations: 50, targetDurationMs: 800 },
      setup: async (n) => {
        const { files } = await linked(Math.min(n, 20))
        const one = await fs.readFile(files[0], "utf8")
        return { file: files[0], text: Array.from({ length: n }, (_, index) => one.replace(/export const (\w+)/g, `export const $1_${String(index)}`)).join("\n") }
      },
      run: ({ file, text }) => parseCapabilityFile(file, text),
    },
    {
      id: "generate-manifest",
      name: "generateManifest",
      why: "It renders the manifest the application imports at runtime and diffs it against the previous snapshot, in every build that ships the application.",
      poorPerformanceMeans: "Slower builds in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason:
        "One manifest entry is rendered and one snapshot entry diffed for each capability, so cost is proportional to the number of capabilities.",
      variables: [FILES, FIXTURE_SHAPE, RUNTIME],
      covers: {
        generateManifest: {
          "options.changes": "swept",
          "options.inventory": "swept",
          "options.location": LOCATION_FIXED,
          "options.root": ROOT_FIXED,
          "options.snapshot": "swept",
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "Run inside every artifact generation; measured on its own." },
      sampling: { warmupIterations: 1, minIterations: 5, maxIterations: 50, targetDurationMs: 800 },
      setup: async (n) => {
        const { inventory, root } = await inventoryAt(n)
        const snapshot = buildManifestSnapshot(inventory)
        return { inventory, root, snapshot, changes: diffManifestSnapshots(undefined, snapshot) }
      },
      run: ({ inventory, root, snapshot, changes }) =>
        generateManifest({ inventory, location: path.join(root, "data.manifest.ts"), root, snapshot, changes }),
    },
    {
      id: "generate-documentation",
      name: "generateDocumentation",
      why: "It renders the Markdown reference from an inventory and a change report, wherever documentation is regenerated.",
      poorPerformanceMeans: "Documentation builds slow down in proportion to the number of capabilities and the prose each carries.",
      expectedComplexity: "linear",
      complexityReason:
        "One section is rendered for each capability, once, so cost is proportional to the amount of documentation.",
      variables: [FILES, FIXTURE_SHAPE, RUNTIME],
      covers: {
        generateDocumentation: {
          "options.changes": "swept",
          "options.edges": EDGES_NONE,
          "options.evidencePath": "fixed: none, so no evidence link is printed",
          "options.expiringWithinDays": WINDOW_FIXED,
          "options.generatedAt": "fixed: one instant, which is only printed in the header",
          "options.inventory": "swept",
          "options.location": LOCATION_FIXED,
          "options.root": ROOT_FIXED,
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "Run inside every artifact generation; measured on its own." },
      sampling: { warmupIterations: 1, minIterations: 5, maxIterations: 50, targetDurationMs: 800 },
      setup: async (n) => {
        const { inventory, root } = await inventoryAt(n)
        return { inventory, root, changes: diffManifestSnapshots(undefined, buildManifestSnapshot(inventory)) }
      },
      run: ({ inventory, root, changes }) =>
        generateDocumentation({ inventory, root, location: path.join(root, "DATA.md"), changes, generatedAt: new Date(0) }),
    },
    {
      id: "generate-flow",
      name: "generateFlow",
      why: "It renders the flow diagrams of how data moves between capabilities, in every pipeline that publishes them.",
      poorPerformanceMeans: "A slower diagram step that grows with the square of the number of capabilities, so the largest projects pay for it most; drawing each capability from a grouped list of its own flows would make it linear.",
      expectedComplexity: "quadratic",
      complexityReason: "Each capability's diagram is drawn from the list of every flow filtered for that capability, so the work grows with the number of capabilities times the number of flows, and the flows grow with the capabilities.",
      variables: [FILES, FIXTURE_SHAPE, RUNTIME],
      covers: {
        generateFlow: {
          "options.additionalFindings": "fixed: none, the fixtures raise no other findings",
          "options.edges": EDGES_NONE,
          "options.evidencePath": "fixed: none, so no evidence link is printed",
          "options.inventory": "swept",
          "options.location": LOCATION_FIXED,
          "options.root": ROOT_FIXED,
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "Run inside every artifact generation; measured on its own." },
      sampling: { warmupIterations: 1, minIterations: 5, maxIterations: 50, targetDurationMs: 800 },
      setup: async (n) => inventoryAt(n),
      run: ({ inventory, root }) => generateFlow({ inventory, root, location: path.join(root, "flow"), edges: [] }),
    },
    {
      id: "diff-manifest-snapshots",
      name: "diffManifestSnapshots",
      why: "It tells what changed since the previous manifest, once per artifact run.",
      poorPerformanceMeans: "A slower artifact run in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason:
        "Both snapshots are indexed once and each capability compared once, so cost is proportional to the number of capabilities.",
      variables: [FILES, { name: "previous snapshot", how: "variant", description: "None (a first run: everything is added) or an identical one (nothing changed)." }, RUNTIME],
      variants: [
        { name: "first-run", description: "There is no previous snapshot: every capability reads as added.", options: { previous: false } },
        { name: "unchanged", description: "The previous snapshot is identical: nothing changed.", options: { previous: true } },
      ],
      covers: {
        diffManifestSnapshots: {
          previous: "variant:unchanged",
          "current.capabilities": "swept",
          "current.snapshotSchemaVersion": "fixed: one number, copied",
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "Run inside every artifact generation; measured on its own." },
      setup: async (n, options) => {
        const snapshot = buildManifestSnapshot((await inventoryAt(n)).inventory)
        return { previous: options?.previous ? snapshot : undefined, current: snapshot }
      },
      run: ({ previous, current }) => diffManifestSnapshots(previous, current),
    },
    pure({
      id: "project-audit-evidence",
      name: "projectAuditEvidence",
      why: "It projects the evidence model into the view an audit reads.",
      poorPerformanceMeans: "A slower audit export in proportion to the evidence model.",
      expectedComplexity: "linear",
      complexityReason: "The model is read once and one row built for each capability, so cost is proportional to the number of capabilities.",
      covers: { projectAuditEvidence: { ...EVIDENCE } },
      setup: async (_n, _o, context) => evidenceAt(context.values.file),
      run: (evidence) => projectAuditEvidence(evidence),
    }),
    pure({
      id: "project-classification-evidence",
      name: "projectClassificationEvidence",
      why: "It projects the evidence model into the view a data-classification review reads.",
      poorPerformanceMeans: "A slower review export in proportion to the evidence model.",
      expectedComplexity: "linear",
      complexityReason: "The model is read once and one row built for each classified field, so cost is proportional to the number of fields.",
      covers: { projectClassificationEvidence: { ...EVIDENCE } },
      setup: async (_n, _o, context) => evidenceAt(context.values.file),
      run: (evidence) => projectClassificationEvidence(evidence),
    }),
    pure({
      id: "project-compliance-evidence",
      name: "projectComplianceEvidence",
      why: "It projects the evidence model into the view a compliance review reads.",
      poorPerformanceMeans: "A slower review export in proportion to the evidence model.",
      expectedComplexity: "linear",
      complexityReason: "The model is read once and one row built for each capability, so cost is proportional to the number of capabilities.",
      covers: { projectComplianceEvidence: { ...EVIDENCE } },
      setup: async (_n, _o, context) => evidenceAt(context.values.file),
      run: (evidence) => projectComplianceEvidence(evidence),
    }),
    pure({
      id: "project-privacy-evidence",
      name: "projectPrivacyEvidence",
      why: "It projects the evidence model into the view a privacy review reads.",
      poorPerformanceMeans: "A slower review export in proportion to the evidence model.",
      expectedComplexity: "linear",
      complexityReason: "The model is read once and one row built for each personal-data field, so cost is proportional to the number of fields.",
      covers: { projectPrivacyEvidence: { ...EVIDENCE } },
      setup: async (_n, _o, context) => evidenceAt(context.values.file),
      run: (evidence) => projectPrivacyEvidence(evidence),
    }),
    pure({
      id: "project-retention-evidence",
      name: "projectRetentionEvidence",
      why: "It projects the evidence model into the view a retention review reads.",
      poorPerformanceMeans: "A slower review export in proportion to the evidence model.",
      expectedComplexity: "linear",
      complexityReason: "The model is read once and one row built for each field with a retention rule, so cost is proportional to the number of fields.",
      covers: { projectRetentionEvidence: { ...EVIDENCE } },
      setup: async (_n, _o, context) => evidenceAt(context.values.file),
      run: (evidence) => projectRetentionEvidence(evidence),
    }),
    pure({
      id: "compute-expiring-entries",
      name: "computeExpiringEntries",
      why: "It lists the capabilities that expire within a window, once for every reminder and every report that shows expiries.",
      poorPerformanceMeans: "A slower expiry reminder in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "Each capability's expiry date is compared with the window once, so cost is proportional to the number of capabilities.",
      covers: {
        computeExpiringEntries: {
          ...INVENTORY,
          "expiringWithinDays": WINDOW_FIXED,
          "now": NOW_FIXED,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => computeExpiringEntries(inventory, 30, new Date(0)),
    }),
    pure({
      id: "build-ownership-matrix",
      name: "buildOwnershipMatrix",
      why: "It builds the matrix of who owns what that the ownership report prints.",
      poorPerformanceMeans: "A slower ownership report in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "Each capability is placed in the matrix once, so cost is proportional to the number of capabilities.",
      covers: {
        buildOwnershipMatrix: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => buildOwnershipMatrix(inventory),
    }),
    pure({
      id: "build-manifest-snapshot",
      name: "buildManifestSnapshot",
      why: "It snapshots the inventory so the next run can tell what changed, once per artifact run.",
      poorPerformanceMeans: "A slower artifact run in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "One snapshot entry is built for each capability, so cost is proportional to the number of capabilities.",
      covers: {
        buildManifestSnapshot: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => buildManifestSnapshot(inventory),
    }),
    pure({
      id: "check-duplicate-endpoints",
      name: "checkDuplicateEndpoints",
      why: "It reports operations that call the same endpoint, once per artifact run.",
      poorPerformanceMeans: "A slower artifact run that grows with the square of the number of capabilities, so the largest projects pay for it most; a grouped comparison would make it linear.",
      expectedComplexity: "quadratic",
      complexityReason: "It enumerates every pair of active capabilities and rebuilds each one's endpoint list for each pair it is in, so cost grows with the square of the number of capabilities even when nothing is duplicated.",
      covers: {
        checkDuplicateEndpoints: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => checkDuplicateEndpoints(inventory),
    }),
    pure({
      id: "check-exclusive-groups",
      name: "checkExclusiveGroups",
      why: "It reports capabilities whose exclusive-group declarations conflict, once per artifact run.",
      poorPerformanceMeans: "A slower artifact run in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "Each capability's group is recorded in a map once, so cost is proportional to the number of capabilities.",
      covers: {
        checkExclusiveGroups: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => checkExclusiveGroups(inventory),
    }),
    pure({
      id: "check-ownership-and-sensitivity",
      name: "checkOwnershipAndSensitivity",
      why: "It reports capabilities that handle sensitive data without an owner, once per artifact run.",
      poorPerformanceMeans: "A slower artifact run in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "Each capability's owner and sensitivity are read once, so cost is proportional to the number of capabilities.",
      covers: {
        checkOwnershipAndSensitivity: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => checkOwnershipAndSensitivity(inventory),
    }),
    pure({
      id: "check-structural-duplication",
      name: "checkStructuralDuplication",
      why: "It reports capabilities whose structure repeats another's, once per artifact run.",
      poorPerformanceMeans: "A slower artifact run, and an output that grows with the square of the number of capabilities when many are structurally alike, which is a report nobody can read.",
      expectedComplexity: "quadratic",
      complexityReason: "It compares every pair of active capabilities, and the fixtures make every capability structurally alike, so one finding is reported for each pair and both the work and the output grow with the square of the number of capabilities.",
      covers: {
        checkStructuralDuplication: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => checkStructuralDuplication(inventory),
    }),
    pure({
      id: "find-manifest-export-collisions",
      name: "findManifestExportCollisions",
      why: "It finds capabilities whose exported names would collide in the generated manifest, once per manifest.",
      poorPerformanceMeans: "A slower manifest build in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "Each capability's export name is recorded in a map once, so cost is proportional to the number of capabilities.",
      covers: {
        findManifestExportCollisions: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => findManifestExportCollisions(inventory),
    }),
    pure({
      id: "project-fields",
      name: "projectFields",
      why: "It lists every field of every capability, the view the field tables and the privacy projections read.",
      poorPerformanceMeans: "A slower report in proportion to the number of capabilities and the fields each has.",
      expectedComplexity: "linear",
      complexityReason: "Every field of every capability is listed once, so cost is proportional to the number of fields.",
      covers: {
        projectFields: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => projectFields(inventory),
    }),
    pure({
      id: "project-getters",
      name: "projectGetters",
      why: "It lists every getter of every capability, the view the operation tables read.",
      poorPerformanceMeans: "A slower report in proportion to the number of capabilities and the getters each has.",
      expectedComplexity: "linear",
      complexityReason: "Every getter of every capability is listed once, so cost is proportional to the number of getters.",
      covers: {
        projectGetters: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => projectGetters(inventory),
    }),
    pure({
      id: "project-mutators",
      name: "projectMutators",
      why: "It lists every mutator of every capability, the view the operation tables read.",
      poorPerformanceMeans: "A slower report in proportion to the number of capabilities and the mutators each has.",
      expectedComplexity: "linear",
      complexityReason: "Every mutator of every capability is listed once, so cost is proportional to the number of mutators.",
      covers: {
        projectMutators: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => projectMutators(inventory),
    }),
    pure({
      id: "project-operation-inventory",
      name: "projectOperationInventory",
      why: "It lists every operation (getter, mutator and subscription) of every capability, the view audits read.",
      poorPerformanceMeans: "A slower audit in proportion to the number of operations.",
      expectedComplexity: "linear",
      complexityReason: "Every operation of every capability is listed once, so cost is proportional to the number of operations.",
      covers: {
        projectOperationInventory: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => projectOperationInventory(inventory),
    }),
    pure({
      id: "project-subscriptions",
      name: "projectSubscriptions",
      why: "It lists every subscription of every capability, the view the operation tables read.",
      poorPerformanceMeans: "A slower report in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "Every subscription of every capability is listed once, so cost is proportional to the number of subscriptions.",
      covers: {
        projectSubscriptions: {
          ...INVENTORY,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => projectSubscriptions(inventory),
    }),
    pure({
      id: "render-manifest",
      name: "renderManifest",
      why: "It renders the TypeScript manifest the application imports, in every build that ships the application.",
      poorPerformanceMeans: "Slower builds in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason: "One manifest entry is rendered for each capability, so cost is proportional to the number of capabilities.",
      covers: {
        renderManifest: {
          ...INVENTORY,
          "outputPath": "fixed: one path, which only decides the relative import paths printed",
          "root": ROOT_FIXED,
        },
      },
      setup: async (_n, _o, context) => inventoryAt(context.values.file),
      run: ({ inventory, root }) => renderManifest(inventory, path.join(root, "data.manifest.ts"), root),
    }),
    pure({
      id: "build-open-api-schema-artifact",
      name: "buildOpenApiSchemaArtifact",
      why: "It renders the OpenAPI schema for the capabilities, in every pipeline that publishes one.",
      poorPerformanceMeans: "A slower publish step in proportion to the number of capabilities and their fields.",
      expectedComplexity: "linear",
      complexityReason: "One schema is built for each capability and field, once, so cost is proportional to the amount of schema.",
      covers: {
        buildOpenApiSchemaArtifact: {
          ...INVENTORY,
          "info.title": "fixed: one short string, copied into the document",
          "info.version": "fixed: one short string, copied into the document",
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => buildOpenApiSchemaArtifact(inventory, { title: "benchmark", version: "1" }),
    }),
    pure({
      id: "render-documentation",
      name: "renderDocumentation",
      why: "It renders the Markdown reference of every capability, the largest text data-cap writes.",
      poorPerformanceMeans: "Documentation builds slow in proportion to the number of capabilities and the prose each carries.",
      expectedComplexity: "linear",
      complexityReason: "One section is rendered for each capability, once, so cost is proportional to the amount of documentation.",
      covers: {
        renderDocumentation: {
          ...INVENTORY,
          "root": ROOT_FIXED,
          "changes.addedCapabilities": "swept",
          "changes.removedCapabilities": "fixed: none, the first-run change report lists everything as added",
          "changes.updatedCapabilities": "fixed: none, the first-run change report lists everything as added",
          "edges": EDGES_NONE,
          "evidencePath": "fixed: none, so no evidence link is printed",
          "lifecycle.capabilities": "swept",
          "lifecycle.expiring": "swept",
          "lifecycle.schemaVersion": "fixed: one number, copied",
        },
      },
      setup: async (_n, _o, context) => { const { inventory, root } = await inventoryAt(context.values.file); return { inventory, root, changes: diffManifestSnapshots(undefined, buildManifestSnapshot(inventory)), lifecycle: buildLifecycleModel(inventory, 30, new Date(0)) } },
      run: ({ inventory, root, changes, lifecycle }) => renderDocumentation(inventory, root, changes, [], undefined, lifecycle),
    }),
    pure({
      id: "render-ownership-graph-dot",
      name: "renderOwnershipGraphDot",
      why: "It renders the ownership graph as Graphviz text, in every pipeline that publishes the ownership diagram.",
      poorPerformanceMeans: "A slower diagram step in proportion to the number of owners and capabilities.",
      expectedComplexity: "linear",
      complexityReason: "One node is written for each owner and capability, once, so cost is proportional to the number of capabilities.",
      covers: {
        renderOwnershipGraphDot: {
          "model.entries": "swept",
          "model.schemaVersion": "fixed: one number, copied",
        },
      },
      setup: async (_n, _o, context) => buildOwnershipModel((await inventoryAt(context.values.file)).inventory),
      run: (model) => renderOwnershipGraphDot(model),
    }),
    pure({
      id: "build-flow-graph",
      name: "buildFlowGraph",
      why: "It builds the graph of how data flows between capabilities and their consumers, once per artifact run.",
      poorPerformanceMeans: "A slower artifact run in proportion to the number of capabilities and the consumers wired to them.",
      expectedComplexity: "linear",
      complexityReason: "Each capability's fields are visited once and each edge applied once, so cost is proportional to the fields plus the edges.",
      covers: {
        buildFlowGraph: {
          ...INVENTORY,
          "edges": EDGES_NONE,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => buildFlowGraph(inventory, []),
    }),
    pure({
      id: "derive-usage-findings",
      name: "deriveUsageFindings",
      why: "It derives the unused and over-used findings from how consumers use each capability, once per usage report.",
      poorPerformanceMeans: "A slower usage report in proportion to the number of capabilities and the edges.",
      expectedComplexity: "linear",
      complexityReason: "Each capability's edges are counted once, so cost is proportional to the capabilities plus the edges.",
      covers: {
        deriveUsageFindings: {
          ...INVENTORY,
          "edges": EDGES_NONE,
        },
      },
      setup: async (_n, _o, context) => (await inventoryAt(context.values.file)).inventory,
      run: (inventory) => deriveUsageFindings(inventory, []),
    }),
    pure({
      id: "render-usage-report",
      name: "renderUsageReport",
      why: "It renders the report of who uses which capability, in every pipeline that publishes it.",
      poorPerformanceMeans: "A slower report in proportion to the number of capabilities and the edges.",
      expectedComplexity: "linear",
      complexityReason: "One section is rendered for each capability and each edge, once, so cost is proportional to the capabilities plus the edges.",
      covers: {
        renderUsageReport: {
          ...INVENTORY,
          "edges": EDGES_NONE,
          "root": ROOT_FIXED,
          "scannedPackages": "fixed: none, the fixtures scan no packages",
          "evidencePath": "fixed: none, so no evidence link is printed",
        },
      },
      setup: async (_n, _o, context) => inventoryAt(context.values.file),
      run: ({ inventory, root }) => renderUsageReport(inventory, [], root),
    }),
    pure({
      id: "build-sarif-log",
      name: "buildSarifLog",
      why: "It converts the finding model into SARIF for code-scanning dashboards, in every pipeline that uploads findings.",
      poorPerformanceMeans: "A slower upload step in proportion to the number of findings.",
      expectedComplexity: "linear",
      complexityReason: "One SARIF result is built for each finding, so cost is proportional to the number of findings.",
      variables: [
        { name: "capability files", how: "swept", description: "The tier axis here is findings, one for each of this many capabilities with a problem." },
        { name: "finding mix", how: "fixed", value: "one error, one warning and one info in turn", description: "Severity only picks the SARIF level." },
        RUNTIME,
      ],
      covers: {
        buildSarifLog: {
          "findingModel.findings": "swept",
          "findingModel.schemaVersion": "fixed: one number, copied",
        },
      },
      // The fixtures are clean, so they raise no findings: this builds n, as a project with a backlog would have.
      setup: (n) => ({
        schemaVersion: 1,
        findings: Array.from({ length: n }, (_, index) => ({
          severity: ["error", "warning", "info"][index % 3],
          code: `STRUCTURAL_FINDING_${String(index % 37)}`,
          family: "structural",
          message: `Capability ${String(index)} has no owner.`,
          location: {
            kind: "capability",
            capability: { file: `capability-${String(index)}/capability.ts`, exportName: `capability${String(index)}` },
          },
        })),
      }),
      run: (findingModel) => buildSarifLog(findingModel),
    }),
    {
      id: "evidence-projection",
      name: "defineEvidenceProjection (project)",
      why: "Turns the evidence model into a consumer-specific view (a report, an export); it runs in every pipeline that publishes one.",
      poorPerformanceMeans: "Custom reports slow in proportion to the model, and a copy-heavy implementation would make the projection cost more than building the evidence itself.",
      expectedComplexity: "linear",
      complexityReason: "The projection copies the model once (`structuredClone`) and reads it through a tracking membrane, both proportional to the model's size, which grows with the number of capabilities.",
      variables: [FILES, { name: "projection shape", how: "fixed", value: "four derived fields", description: "A projection reading fewer fields still pays the clone; one computing more adds proportional work." }, RUNTIME],
      sampling: { warmupIterations: 1, minIterations: 5, maxIterations: 20, targetDurationMs: 800 },
      setup: async (n) => {
        const inventory = buildInventory((await linked(n)).linkResult)
        const generatedAt = new Date()
        return buildEvidenceModel({ capability: inventory, lifecycle: buildLifecycleModel(inventory, 30, generatedAt), ownership: buildOwnershipModel(inventory) }, { generatedAt: generatedAt.toISOString(), toolVersion: "benchmark", commit: undefined })
      },
      run: (evidence) => projection.project(evidence),
    },
  ],
})
