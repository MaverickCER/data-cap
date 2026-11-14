// data-cap build-time benchmark suite: the cost of the CLI/CI tooling (`data-cap/build`) that discovers
// capability files, links them with the TypeScript compiler API and generates the manifest,
// documentation, ownership, flow and evidence artifacts. This is development and CI cost, paid on every
// pipeline run and by every developer who regenerates artifacts: not request-time cost. See
// ../READING-BENCHMARKS.md and ../WRITING-BENCHMARKS.md.
//
// Imports data-cap by its PACKAGE NAME, never a monorepo-relative path.

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineSuite } from "internal-package-contract/benchmark"
import {
  UNOWNED,
  buildCycloneDxBom,
  buildEvidenceModel,
  buildFlowGraph,
  buildInventory,
  buildLifecycleModel,
  buildManifestSnapshot,
  buildObservationModel,
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
  renderFlowCycloneDx,
  renderOwnershipGraphDot,
  renderUsageReport,
  scanFlow,
} from "data-cap/build"
import {
  defineEvidenceProjection,
  diffFlow,
  evaluateEvidenceRules,
  filterFlow,
  observationsFromOtlp,
  observationsToOtlp,
  observedFlow,
  renderFlowDot,
  renderFlowMermaid,
  renderFlowText,
  traceFlow,
} from "data-cap/evidence"
import { nodeBuildFileSystem } from "data-cap/node"
import { generateBuildtimeFixtures } from "../benchmark-fixtures/generator.mjs"
import { flowProjectFiles, writeFlowProject } from "../benchmark-fixtures/flow-generator.mjs"

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

/**
 * The flow scan's fixtures: a project of `n` application modules (five functions each, chains of wrappers from a
 * read of a capability field to a response) plus the one capability they read. Written once per size and shared.
 */
const flowFixtureCache = new Map()
function flowFixture(n) {
  if (!flowFixtureCache.has(n)) {
    const root = path.join(fixturesRoot, `flow-n${String(n)}`)
    flowFixtureCache.set(n, writeFlowProject(root, { files: n }).then(() => root))
  }
  return flowFixtureCache.get(n)
}

/** The inventory of the flow project, and the absolute path of every file the scan reads, once per size. */
const flowScanCache = new Map()
function flowScanInput(n) {
  if (!flowScanCache.has(n)) {
    flowScanCache.set(
      n,
      (async () => {
        const root = await flowFixture(n)
        const files = await discoverCapabilityFiles({ root, fs: nodeBuildFileSystem })
        const linkResult = await linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root, tsconfig: false })
        const sources = Object.keys(flowProjectFiles({ files: n })).map((relative) => path.join(root, relative))
        return { root, inventory: buildInventory(linkResult), files: sources }
      })(),
    )
  }
  return flowScanCache.get(n)
}

const FLOW_GENERATED_AT = new Date(0)
/** The evidence model with the flow computed, the input of every flow projection, once per size. */
const flowEvidenceCache = new Map()
function flowEvidenceAt(n) {
  if (!flowEvidenceCache.has(n)) {
    flowEvidenceCache.set(
      n,
      flowFixture(n).then((root) =>
        computeDataArtifacts({ root, fs: nodeBuildFileSystem, tsconfig: false, flowEvidence: true, generatedAt: FLOW_GENERATED_AT, commit: undefined }).then(({ result }) => result.evidence),
      ),
    )
  }
  return flowEvidenceCache.get(n)
}

const MODULES = { name: "application modules", how: "swept", description: "The size axis of the flow benchmarks: how many source modules the project has. Each module has five functions (a handler, a wrapper chain and a sender) that carry one capability's data to a response. The suite's own unit, a file, counts these modules here." }
const FLOW_SHAPE = { name: "source shape", how: "fixed", value: "per module: a handler that reads the capability, three wrapper hops, a sender. Chains cross at most six modules. Every 50th module sends the whole record, every 75th also logs a field", description: "Cost depends on how deep the wrapper chains are and how much data each function touches; deeper chains and wider records are not covered." }
const FLOW_CAPABILITIES = { name: "tracked capabilities", how: "fixed", value: "one capability with a single five-field record", description: "A project with many capabilities tracks more data through every function; not covered." }
const FLOW_SLOW_TIERS = [20, 40, 80, 160, 320, 640]
const FLOW_SLOW_REASON = "Every sample runs the whole flow evidence pipeline (scan, model, policy, claims and least-data analysis) over a real project. That analysis grows faster than linearly, so at 1,280 modules one sample takes minutes."

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
const FLOW_OFF = "fixed: off, the default, so no flow pass runs; `compute-flow-evidence` measures it on"
const FLOW_ONLY = "fixed: absent; only the flow pass reads it, and it is off here"
const OBSERVATIONS_NONE = "not covered: none are supplied; when given they are aggregated once into the observation model, which `build-observation-model` measures"
const SKIPS_NONE = "not covered: none are supplied; each one is grouped by a map lookup once and the groups sorted"
const FLOW_OPTIONS = {
  "options.flowEvidence": FLOW_OFF,
  "options.flowSinks": FLOW_ONLY,
  "options.flowSummaries": FLOW_ONLY,
  "options.observations": OBSERVATIONS_NONE,
  "options.observationSkips": SKIPS_NONE,
}

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
  "evidence.claims": "not covered: the benchmark's evidence model has none. No projection reads it, but each projection clones the whole evidence model once per output key. So one adds copies proportional to its size",
  "evidence.flow": "not covered: the benchmark's evidence model has none. No projection reads it, but each projection clones the whole evidence model once per output key. So one adds copies proportional to its size",
  "evidence.observation": "not covered: the benchmark's evidence model has none. No projection reads it, but each projection clones the whole evidence model once per output key. So one adds copies proportional to its size",
  "evidence.policy": "not covered: the benchmark's evidence model has none. No projection reads it, but each projection clones the whole evidence model once per output key. So one adds copies proportional to its size",
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

const FLOW_INPUT_REASON =
  "Its input is the evidence of a project, built by the flow pipeline. That pipeline's cost grows faster than linearly, so the largest sizes are not built here."
const FLOW_VIEW_VARIABLES = [MODULES, FLOW_SHAPE, FLOW_CAPABILITIES, RUNTIME]
const FLOW_UNKNOWNS = "fixed: none, because the fixture's scan follows every function, so there is no unknown to attach or carry"
const NEVER_READ = "fixed: as the scan produced it; this function never reads it"
const FLOW_INDEX = { name: "flow index", how: "fixed", value: "already built", description: "The adjacency index of a flow model is built on its first query (one pass over its nodes, edges and unknowns). It is cached on that model object, so after the warm-up every sample reuses it. A first query on a freshly loaded model also pays that pass." }

/** How a query accounts for the parts of a flow model passed as `name`: it reads nodes, edges and unknowns, and never the rest. */
function flowModelParts(name) {
  return {
    [`${name}.nodes`]: "swept",
    [`${name}.edges`]: "swept",
    [`${name}.unknowns`]: FLOW_UNKNOWNS,
    [`${name}.coverage`]: NEVER_READ,
    [`${name}.edgeTags`]: NEVER_READ,
    [`${name}.schemaVersion`]: "fixed: one number, never read",
  }
}

const OBSERVED_KEYS = ["id", "name", "email", "passwordHash", "role"]
const RESPONSE = { kind: "client-response", name: "http-response" }
/**
 * `count` observation events as `data-cap/observe` records them for the flow fixture's field: each from its own
 * execution (scope), cycling through the record's five keys, timed by a caller's clock. A function of the index.
 */
function observationEvents(count) {
  return Array.from({ length: count }, (_, index) => ({
    scope: `test-${String(index)}`,
    boundary: RESPONSE,
    field: `userData.user.${OBSERVED_KEYS[index % OBSERVED_KEYS.length]}`,
    at: index * 1000,
  }))
}
/** The evidence the OTLP mapping reads: the observation model of `count` events, once per size. */
const otlpEvidenceCache = new Map()
function otlpEvidenceAt(count) {
  if (!otlpEvidenceCache.has(count)) {
    otlpEvidenceCache.set(count, {
      observation: buildObservationModel(observationEvents(count)),
      provenance: { generatedAt: new Date(0).toISOString(), toolVersion: "benchmark", commit: undefined },
    })
  }
  return otlpEvidenceCache.get(count)
}
/** What one test run of the flow fixture witnesses: three keys reach the response and one is logged, in one execution. */
const WITNESSED = [
  { scope: "test", boundary: RESPONSE, field: "userData.user.id" },
  { scope: "test", boundary: RESPONSE, field: "userData.user.email" },
  { scope: "test", boundary: RESPONSE, field: "userData.user.passwordHash" },
  { scope: "test", boundary: { kind: "log", name: "console" }, field: "userData.user.role" },
]
const EVENTS = { name: "observation events", how: "swept", description: "The tier axis here is runtime observation events, this many, each recorded in its own execution (scope)." }

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
      "One capability file in the project. 160 is a large application's worth of capabilities; 640 a large monorepo's. The ladder stops at 2,560, not 10,240. Every size writes a real project of TypeScript files and links them with the TypeScript compiler API, which takes minutes at the largest sizes.",
    typicalN: 160,
  },

  endToEnd: {
    purpose:
      "Shows what a pipeline run or a developer pays to regenerate every data-cap artifact for a project: manifest, documentation, ownership report, flow diagrams and evidence. It compares that with the bare minimum of reading every capability file. The baseline is the unavoidable floor (the files must at least be read), so the difference is data-cap's parsing, linking and rendering. This is CI and development time, paid on every build, not request-time cost.",
    baseline: {
      description: "Walk the project directory and read every capability file as text, with no data-cap.",
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
    analyzeLeastData:
      "For each capability field it traces the field's flow once and then once per key, and scans the field's edges once per key. So it grows with the flow the field reaches. It runs once inside `compute-flow-evidence` and twice inside `evaluate-evidence-rules`, which measure it.",
    analyzeRedundantTransforms:
      "It groups the edges that carry each field path and, for each function in a group, filters that whole group. So it grows with the functions times the edges of one field's flow. It runs once inside `compute-flow-evidence` and once inside `evaluate-evidence-rules`, which measure it.",
    buildClaimsModel:
      "It traces every field node through the flow (at least twice each). It builds one claim per boundary a field reaches and per policy rule, and matches observations to them. It runs once in every evidence build with a flow model, which `compute-flow-evidence` measures without observations.",
    buildFlowModel:
      "It checks and indexes the scan's nodes, edges, unknowns and tags in maps, one pass each, and sorts each list by id. It runs once on every scan inside `compute-flow-evidence`, which measures it.",
    buildOscalAssessmentResults:
      "Not yet benchmarked. Its work grows with the declared policy rules, their results and the claims' evidence references. Each mapped rule filters every policy result and every claim. The flow fixture declares two rules, so none of those grow with its size axis.",
    buildPolicyModel:
      "For each rule it selects the matching field nodes in one pass over the nodes and traces each through the flow. It runs once inside `compute-flow-evidence` (two rules there), which measures it.",
    collectFlowPolicyRules:
      "Not yet measured on its own. It copies each active capability's declared flow rules into one list, a single pass over the inventory. It runs once inside `compute-flow-evidence`, whose project has one capability. So its growth with the number of capabilities is not measured.",
    flowAnalysisFindings:
      "It writes one finding per unknown in the flow model, a single pass; it runs once inside `compute-flow-evidence`, which measures it.",
    flowEdgeId:
      "It joins one edge's kind, ends, path, status and origin into one string, work proportional only to that edge's own short path. It runs once per edge inside the scan that `scan-flow` measures.",
    flowNodeId:
      "It joins a kind, a scope and a name into one string, a constant amount of work done once per node.",
    leastDataFindings:
      "It writes one finding per unused path, whole-field send and undecided field in the least-data report, a single pass over that report. It runs once inside `compute-flow-evidence`, which measures it.",
    policyFindings:
      "It writes one finding per violated or undecided policy result, finding that result's field and boundary by a scan of the flow's nodes. It runs once inside `compute-flow-evidence`, which measures it.",
    redundantTransformFindings:
      "It indexes the flow's nodes by id once and writes one finding per redundant transformation; it runs once inside `compute-flow-evidence`, which measures it.",
    traceFlowBetween:
      "Like `traceFlow`, it is a downstream walk from one node through the edge index. A reverse walk over the edges it reached and a sort of the result follow. `observed-flow` measures it, which calls it once per observation.",
    buildChangeModel:
      "Its input is the change report of the previous manifest, empty on a first run and small on any later one. The model it builds is derived once in the evidence build, which `build-evidence-model` measures.",
    buildCitationSnapshots:
      "It re-reads the files that dynamic-access citations point at. The fixtures declare no citations, so there is nothing for it to read at any size.",
    evaluateLiteral:
      "An internal step of the parser that evaluates one syntax node of a schema literal, a constant amount of work per node. `parse-capability-file` measures it inside every parse.",
    generateUsage:
      "It scans the files that consume the capabilities, and the fixtures contain none, so there is nothing for it to scan. The report it renders is measured as `render-usage-report`.",
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
      why: "Every build-time command starts by finding the project's capability files. So every generator and every CI run pays this cost first.",
      poorPerformanceMeans: "Every pipeline step that touches data-cap starts later. A super-linear regression would slow monorepos with thousands of files before any real work begins.",
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
      poorPerformanceMeans: "Build time grows with the size of the project. A super-linear regression would make the largest monorepos the slowest to build, which is exactly where developers feel it most.",
      expectedComplexity: "linear",
      complexityReason: "Each file is parsed once and its declarations linked by name through maps. Cost is proportional to the amount of source text.",
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
      poorPerformanceMeans: "Every artifact run pays the slowdown after the heavy parsing has already finished. It grows with the number of capabilities.",
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
      complexityReason: "It visits each capability once and appends it to its owner's group in a map. Cost is proportional to the number of capabilities.",
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
      poorPerformanceMeans: "It should cost next to nothing at any size. If it started copying the models it assembles, evidence rebuilt on every run would get slower with project size. The saving of building the models once and sharing them would be lost.",
      expectedComplexity: "constant",
      complexityReason: "It returns a small record that holds references to the already-built capability, lifecycle and ownership models plus a provenance stamp. Reading the source confirms that nothing is copied or walked. So the work does not depend on how many capabilities the models contain.",
      variables: [FILES, RUNTIME],
      covers: {
        buildEvidenceModel: {
          "models.capability": "swept",
          "models.change": "not covered: an optional model is held by reference like the others, so passing it adds constant work",
          "models.dependency": "not covered: an optional model is held by reference like the others, so passing it adds constant work",
          "models.finding": "not covered: an optional model is held by reference like the others, so passing it adds constant work",
          "models.lifecycle": "swept",
          "models.ownership": "swept",
          "models.flow":
            "not covered: absent; with a flow model it derives the claims model, which traces every field through the flow, and `compute-flow-evidence` measures that",
          "models.policy": "not covered: absent; it is held by reference and read only by the claims derivation, which needs a flow model (see `models.flow`)",
          "models.observation":
            "not covered: absent; it is held by reference, and with a flow model the claims derivation also matches each observation, which no benchmark supplies",
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
      why: "The combined entry point most pipelines call. It shares one discovery and parse across the manifest, documentation, ownership report, flow diagrams and evidence.",
      poorPerformanceMeans:
        "The shared pass is the whole saving over running the generators one by one. If it stopped being shared, every pipeline would pay several times the parsing.",
      expectedComplexity: "linear",
      complexityReason:
        "It discovers, parses and links once and renders each artifact from that single pass. Cost is proportional to the amount of source.",
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
          ...FLOW_OPTIONS,
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
        "It runs the same single discovery, parse and link as generation and renders each artifact once. Cost is proportional to the amount of source.",
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
          ...FLOW_OPTIONS,
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
      why: "The CI gate that fails when a committed artifact is stale. It recomputes every artifact in memory and compares it with the file on disk.",
      poorPerformanceMeans: "A slower gate on every pull request, which is the most frequent place build-time cost is paid.",
      expectedComplexity: "linear",
      complexityReason:
        "It runs one shared discovery, parse and link, renders each artifact once and compares each with its file. Cost is proportional to the amount of source.",
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
          ...FLOW_OPTIONS,
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
      why: "It decides whether a cached evidence model is still current. It runs before every cached read, so it must cost far less than the recompute it avoids.",
      poorPerformanceMeans: "A cache that costs nearly as much as the recompute it saves, which makes every cached read pointless.",
      expectedComplexity: "linear",
      complexityReason:
        "It walks the capability files and hashes each one's text once, with no parsing or linking. Cost is proportional to the bytes of source.",
      variables: [FILES, FIXTURE_SHAPE, DISK, RUNTIME],
      covers: {
        computeSourceFingerprint: {
          "options.extra": "fixed: absent; when given it is one short string hashed once after the files, a constant addition",
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
      why: "The cached way to read the evidence model. It trusts a committed artifact only while the source fingerprint matches, and recomputes otherwise.",
      poorPerformanceMeans:
        "The cache would be worse than not having it. That happens when a miss costs more than a plain recompute, or a hit costs nearly as much as one.",
      expectedComplexity: "linear",
      complexityReason:
        "A hit fingerprints the source and reads one file. A miss does that and then rebuilds the model, so both grow with the amount of source.",
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
          ...FLOW_OPTIONS,
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
        "Every build-time command slows in proportion to the source it parses. A super-linear parse would punish the largest files first.",
      expectedComplexity: "linear",
      complexityReason:
        "The text is parsed once by the TypeScript parser and the declarations read from one syntax tree. Cost is proportional to the length of the source.",
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
      why: "It renders the manifest the application imports at runtime. It diffs it against the previous snapshot in every build that ships the application.",
      poorPerformanceMeans: "Slower builds in proportion to the number of capabilities.",
      expectedComplexity: "linear",
      complexityReason:
        "One manifest entry is rendered and one snapshot entry diffed for each capability. Cost is proportional to the number of capabilities.",
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
      poorPerformanceMeans: "A slower diagram step that grows with the square of the number of capabilities, so the largest projects pay most. Drawing each capability from a grouped list of its own flows would make it linear.",
      expectedComplexity: "quadratic",
      complexityReason: "Each capability's diagram is drawn from the list of every flow filtered for that capability. So the work grows with the number of capabilities times the number of flows. The flows grow with the capabilities.",
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
      id: "scan-flow",
      name: "scanFlow",
      why: "It is the pass that reads every source module and follows each capability field through the functions that touch it. Every pipeline that computes flow evidence runs it. It is the one step whose cost grows with the amount of application code, not with the number of capabilities.",
      poorPerformanceMeans: "A slower evidence build in proportion to the application's size, on every pull request that runs the flow gate. A regression to quadratic would make a 10,000-function service take minutes before any policy is evaluated.",
      expectedComplexity: "linear",
      complexityReason:
        "Each module is parsed and indexed once. Every function body is evaluated once per distinct shape of argument, because results are memoised by signature. Chains cross files only within a bounded group, so the work is proportional to the number of functions.",
      variables: [MODULES, FLOW_SHAPE, FLOW_CAPABILITIES, DISK, RUNTIME, { name: "analysis budget", how: "fixed", value: "the scanner's own limits (call depth 40, 3,000,000 steps)", description: "These fixtures stay far inside both limits; what happens beyond them is proven by test/build/flow-scale.test.ts, which asserts an explicit unknown, not measured here." }],
      covers: {
        scanFlow: {
          "options.inventory": "fixed: one capability, so the cost measured is that of reading application code, not of tracking many capabilities",
          "options.files": "swept",
          "options.fs": FS_FIXED,
          "options.root": ROOT_FIXED,
          "options.tsconfig": TSCONFIG_FIXED,
          "options.packages": PACKAGES_NOT,
          "options.sinks": "fixed: the default sinks (response, console and logger calls), which every module here uses",
          "options.summaries": "fixed: none; the fixture's modules call no package function, so there is no call a summary could describe",
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "Run only when flow evidence is requested, which the end-to-end operation does not do; measured on its own." },
      sampling: SLOW,
      setup: async (_n, _o, context) => flowScanInput(context.values.file),
      run: ({ inventory, files, root }) => scanFlow({ inventory, files, fs: nodeBuildFileSystem, root, tsconfig: false }),
    },
    {
      id: "compute-flow-evidence",
      name: "computeDataArtifacts",
      why: "It is the whole flow evidence build a pipeline pays for when it turns on `flowEvidence`. That covers scan, model, declared policy, claims and least-data analysis. It is the number a team adopting the flow gate budgets for.",
      poorPerformanceMeans: "A flow gate that is too slow to run on every pull request, so it gets skipped. The post-scan analyses trace each field across the whole graph. If they regressed to a scan of every edge per node, a project twice as large would cost four times as much.",
      expectedComplexity: "linear",
      complexityReason:
        "The policy, claims and least-data passes each trace a field's flow through an index of edges by node. Every edge is visited a bounded number of times, so the work grows with the number of modules.",
      variables: [MODULES, FLOW_SHAPE, FLOW_CAPABILITIES, DISK, RUNTIME, { name: "post-scan analyses", how: "fixed", value: "policy with two rules, claims, least-data", description: "All three run whenever flow evidence is on; none can be requested alone." }],
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_SLOW_REASON,
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
          "options.docs": "not covered: no documentation is requested, which is what a flow-only gate does",
          "options.evidence": "not covered: nothing is written, the evidence is computed in memory",
          "options.flow": "not covered: no diagram folder is requested",
          "options.location": "not covered: no manifest is requested",
          "options.ownership": "not covered: no ownership report is requested",
          "options.flowEvidence": "fixed: on, which is what this benchmark measures",
          "options.flowSinks": "fixed: absent, so the scan uses its default sinks (response, console and logger calls), which every module here uses",
          "options.flowSummaries": "fixed: none; the fixture's modules call no package function, so there is no call a summary could describe",
          "options.observations": "not covered: runtime observations are joined to the static flow by a separate step whose cost depends on how many events were recorded",
          "options.observationSkips": SKIPS_NONE,
        },
      },
      inEndToEnd: { callsPerOperation: 0, description: "Run only when flow evidence is requested, which the end-to-end operation does not do; measured on its own." },
      sampling: SLOW,
      setup: async (_n, _o, context) => ({ root: await flowFixture(context.values.file) }),
      run: ({ root }) => computeDataArtifacts({ root, fs: nodeBuildFileSystem, tsconfig: false, flowEvidence: true, generatedAt: FLOW_GENERATED_AT, commit: undefined }),
    },
    pure({
      id: "build-cyclonedx-bom",
      name: "buildCycloneDxBom",
      why: "It turns the evidence's flow, policy, claims and observations into a CycloneDX 1.6 document for the supply-chain tools that read it. It runs once per published evidence build.",
      poorPerformanceMeans: "A slower export step in proportion to the size of the flow graph. A regression to quadratic would make exporting a large project's data flows slower than computing them.",
      expectedComplexity: "linear",
      complexityReason:
        "Each edge that crosses a boundary is folded into one flow record by a map lookup. Each record is written once on each of its two services. Annotations are written once per unknown, non-satisfied policy result and unverified claim. So the work is proportional to the nodes plus the edges.",
      variables: [
        ...FLOW_VIEW_VARIABLES,
        { name: "policy and claims", how: "fixed", value: "the fixture's two rules and the claims the pipeline derives", description: "Each non-satisfied policy result and each claim that is not simply verified adds one annotation." },
        { name: "document name", how: "fixed", value: "the default", description: "`options.name` is only copied into the document's metadata." },
      ],
      notCovered: [{ name: "runtime observations", reason: "The fixture records none; each observation adds one flow record and is matched against the field and boundary nodes only." }],
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        buildCycloneDxBom: {
          evidence: "swept",
          options: "fixed: absent, so the default document name is used; the name is only copied into the metadata",
        },
      },
      setup: async (_n, _o, context) => flowEvidenceAt(context.values.file),
      run: (evidence) => buildCycloneDxBom(evidence),
    }),
    pure({
      id: "render-flow-cyclonedx",
      name: "renderFlowCycloneDx",
      why: "It writes the CycloneDX document as the text a pipeline publishes, once per evidence build that exports it.",
      poorPerformanceMeans: "A slower export step in proportion to the size of the flow graph.",
      expectedComplexity: "linear",
      complexityReason: "It builds the document once and serializes it once; both are single passes over the nodes, edges and annotations.",
      variables: [
        ...FLOW_VIEW_VARIABLES,
        { name: "policy and claims", how: "fixed", value: "the fixture's two rules and the claims the pipeline derives", description: "Each non-satisfied policy result and each claim that is not simply verified adds one annotation." },
        { name: "document name", how: "fixed", value: "the default", description: "`options.name` is only copied into the document's metadata." },
      ],
      notCovered: [{ name: "runtime observations", reason: "The fixture records none." }],
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        renderFlowCycloneDx: {
          evidence: "swept",
          options: "fixed: absent, so the default document name is used; the name is only copied into the metadata",
        },
      },
      setup: async (_n, _o, context) => flowEvidenceAt(context.values.file),
      run: (evidence) => renderFlowCycloneDx(evidence),
    }),
    pure({
      id: "trace-flow",
      name: "traceFlow",
      why: "Every flow question is a trace. The policy, claims and least-data passes trace each governed field, and the diagram and text views trace what they draw. A reviewer or a script asks where one field goes. Its cost is paid once per field per question.",
      poorPerformanceMeans: "Every flow check and view slows with the size of the application. A trace that rescanned the edge list per node would make each question quadratic in the code base.",
      expectedComplexity: "linearithmic",
      complexityReason:
        "A breadth-first walk expands each reached node once through an index of edges by node. Then it sorts the reached nodes and edges by id. The work is the walk (linear in what the field reaches) plus the sort.",
      variables: [
        ...FLOW_VIEW_VARIABLES,
        FLOW_INDEX,
        { name: "direction", how: "fixed", value: "downstream from the one field", description: "What every policy, claim and least-data check asks. Upstream repeats the downstream walk once per field node, and the fixture has one." },
      ],
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        traceFlow: {
          ...flowModelParts("model"),
          start: "fixed: the fixture's one field, whose flow reaches every module",
          direction: "fixed: downstream, the direction every check uses; upstream repeats the walk once per field node, and the fixture has one",
          "options.path": "fixed: absent, so every edge of the field is followed, the widest trace",
          "options.statuses": "fixed: absent, so edges of every status are followed",
        },
      },
      setup: async (_n, _o, context) => {
        const { flow } = await flowEvidenceAt(context.values.file)
        return { flow, field: flow.nodes.find((node) => node.kind === "field").id }
      },
      run: ({ flow, field }) => traceFlow(flow, field, "downstream"),
    }),
    pure({
      id: "filter-flow",
      name: "filterFlow",
      why: "It narrows a flow model to the nodes a reviewer or a view asks for: one file, one kind, one classification. It runs once per such question.",
      poorPerformanceMeans: "A slower review tool in proportion to the size of the application's flow.",
      expectedComplexity: "linear",
      complexityReason: "Each node is tested against the filter once. Each edge and unknown is kept or dropped by a set lookup of its ends. So the work is proportional to the nodes plus the edges.",
      variables: [...FLOW_VIEW_VARIABLES, { name: "filter", how: "fixed", value: "function, field and boundary nodes", description: "Keeps every function and drops parameters and return values; each further criterion adds one comparison per node." }],
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        filterFlow: {
          ...flowModelParts("model"),
          "model.coverage": "fixed: as the scan produced it; only its `complete` flag is read, once",
          "filter.kinds": "fixed: function, field and boundary nodes, which keeps every function and drops parameters and return values",
          "filter.classification": "fixed: absent; when given it is one comparison per node",
          "filter.scope": "fixed: absent; when given it is one comparison per node",
          "filter.statuses": "fixed: absent; when given it is one list lookup per node",
          "filter.nameIncludes": "fixed: absent; when given it lower-cases and searches each node's name once",
          "filter.edgePathIncludes": "fixed: absent; when given it searches each kept edge's short path once",
        },
      },
      setup: async (_n, _o, context) => (await flowEvidenceAt(context.values.file)).flow,
      run: (flow) => filterFlow(flow, { kinds: ["field", "function", "boundary"] }),
    }),
    pure({
      id: "diff-flow",
      name: "diffFlow",
      why: "It tells what changed in the data flow between two revisions. A pull-request review of flow evidence asks that once per change.",
      poorPerformanceMeans: "A slower review step in proportion to the size of the application's flow.",
      expectedComplexity: "linear",
      complexityReason: "Both models' nodes, edges and unknowns are indexed by id once. Every node present in both is compared through one JSON serialization of each side. Each list is checked against the other's index once.",
      variables: [...FLOW_VIEW_VARIABLES, { name: "revisions compared", how: "fixed", value: "the same model on both sides", description: "Every node is found in both and compared, which is the most comparison work; a real change adds one entry per difference." }],
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        diffFlow: {
          ...flowModelParts("before"),
          ...flowModelParts("after"),
        },
      },
      setup: async (_n, _o, context) => (await flowEvidenceAt(context.values.file)).flow,
      run: (flow) => diffFlow(flow, flow),
    }),
    pure({
      id: "render-flow-text",
      name: "renderFlowText",
      why: "It writes the flow as Markdown, the text equivalent of the diagrams that a review or an accessibility reader uses. It runs once per published evidence build.",
      poorPerformanceMeans: "The text view grows with the square of the application's functions. On a large service it is the slowest flow export. Indexing the edges and nodes by function once would make it linear.",
      expectedComplexity: "quadratic",
      complexityReason:
        "The graph view it renders builds one entry per function node. Each entry filters the whole edge list (twice), the whole unknown list and the whole node list (twice). So the work is the number of functions times the size of the flow.",
      variables: FLOW_VIEW_VARIABLES,
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        renderFlowText: {
          evidence: "swept",
          "options.field": "fixed: absent, so every function and field is written, the largest text",
          "options.headingLevel": "fixed: absent (level 1); it only changes how many `#` each heading has",
        },
      },
      setup: async (_n, _o, context) => flowEvidenceAt(context.values.file),
      run: (evidence) => renderFlowText(evidence),
    }),
    pure({
      id: "render-flow-dot",
      name: "renderFlowDot",
      why: "It draws the flow as Graphviz text for the published diagram, once per evidence build that exports it.",
      poorPerformanceMeans: "A slower diagram step in proportion to the size of the application's flow.",
      expectedComplexity: "linearithmic",
      complexityReason: "It selects the drawable nodes and edges in one pass and sorts them by id. It writes one line per node, edge and unknown, so the sort dominates as the flow grows.",
      variables: FLOW_VIEW_VARIABLES,
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        renderFlowDot: {
          evidence: "swept",
          "options.field": "fixed: absent, so the whole flow is drawn, the largest drawing; one field instead adds one trace of it",
          "options.includeCalls": "fixed: absent, so call edges are tested and left out of the drawing",
          "options.path": "fixed: absent; it only narrows the trace of a chosen field",
        },
      },
      setup: async (_n, _o, context) => flowEvidenceAt(context.values.file),
      run: (evidence) => renderFlowDot(evidence),
    }),
    pure({
      id: "render-flow-mermaid",
      name: "renderFlowMermaid",
      why: "It draws the flow as a Mermaid chart that renders inline in documentation and pull requests. It runs once per evidence build that exports it.",
      poorPerformanceMeans: "A slower diagram step in proportion to the size of the application's flow.",
      expectedComplexity: "linearithmic",
      complexityReason: "It selects the drawable nodes and edges in one pass and sorts them by id. It writes one line per node, edge and unknown, so the sort dominates as the flow grows.",
      variables: FLOW_VIEW_VARIABLES,
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        renderFlowMermaid: {
          evidence: "swept",
          "options.field": "fixed: absent, so the whole flow is drawn, the largest drawing; one field instead adds one trace of it",
          "options.includeCalls": "fixed: absent, so call edges are tested and left out of the drawing",
          "options.path": "fixed: absent; it only narrows the trace of a chosen field",
        },
      },
      setup: async (_n, _o, context) => flowEvidenceAt(context.values.file),
      run: (evidence) => renderFlowMermaid(evidence),
    }),
    pure({
      id: "evaluate-evidence-rules",
      name: "evaluateEvidenceRules",
      why: "It is the CI gate over flow evidence. Every pull request that runs `data-cap --rules` evaluates it once, and three of its rules re-run whole-flow analyses.",
      poorPerformanceMeans: "A slower gate on every pull request. Its redundant-transformation rule grows with the square of the functions that carry one field, so a large service pays for that rule most.",
      expectedComplexity: "quadratic",
      complexityReason:
        "With every rule set, the redundant-transformation rule groups the edges carrying each field path. For each function in a group, it filters that whole group. So its work is the functions times the edges of one field's flow. The two least-data rules each trace the field once and then once per key. The other rules scan the policy results or the claims once.",
      variables: [
        ...FLOW_VIEW_VARIABLES,
        { name: "rules set", how: "fixed", value: "all twelve", description: "Every check runs; a gate that sets fewer rules skips their work." },
      ],
      notCovered: [{ name: "runtime observations", reason: "The fixture records none, so the observation rules find none and no claim is verified." }],
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        evaluateEvidenceRules: {
          evidence: "swept",
          "rules.noPolicyViolations": "fixed: on; it scans the policy results once",
          "rules.noIndeterminatePolicies": "fixed: on; it scans the policy results once",
          "rules.maxContradictedClaims": "fixed: 0; it scans the claims once",
          "rules.maxUnknowns": "fixed: 0; it compares the number of unknowns with the ceiling",
          "rules.requireComplete": "fixed: on; it reads the flow's coverage summary",
          "rules.maxUnusedSensitivePaths": "fixed: 0; it runs the least-data analysis, which traces the field once and then once per key",
          "rules.maxWholeFieldToClient": "fixed: 0; it runs the least-data analysis a second time",
          "rules.requireObservations": "fixed: on; it only checks whether observations exist, and the fixture has none",
          "rules.minVerifiedClaims": "fixed: 1; it reads one count from the claims summary",
          "rules.requireVerified": "fixed: one rule id; it scans the claims once per listed id",
          "rules.maxRedundantTransforms": "fixed: 0; it runs the redundant-transformation analysis over the whole flow",
          "rules.maxObservationAgeDays": "fixed: 30; it reads only verified claims, and without observations none is verified",
        },
      },
      setup: async (_n, _o, context) => flowEvidenceAt(context.values.file),
      run: (evidence) =>
        evaluateEvidenceRules(evidence, {
          noPolicyViolations: true,
          noIndeterminatePolicies: true,
          maxContradictedClaims: 0,
          maxUnknowns: 0,
          requireComplete: true,
          maxUnusedSensitivePaths: 0,
          maxWholeFieldToClient: 0,
          requireObservations: true,
          minVerifiedClaims: 1,
          requireVerified: ["userData/no-password-to-client"],
          maxRedundantTransforms: 0,
          maxObservationAgeDays: 30,
        }),
    }),
    pure({
      id: "observed-flow",
      name: "observedFlow",
      why: "It joins what a test run witnessed to the static flow. That step shows which static routes were actually exercised, once per review of observed evidence.",
      poorPerformanceMeans: "A slower review of runtime evidence. The slowdown follows the size of the application's flow, multiplied by how many distinct things were observed.",
      expectedComplexity: "linearithmic",
      complexityReason:
        "For each observation it traces the observed field to the observed boundary (`traceFlowBetween`). A trace is a breadth-first walk through the edge index, a reverse walk over the edges it reached, and a sort of the result. With the observations held fixed, each trace grows with the flow it reaches.",
      variables: [
        ...FLOW_VIEW_VARIABLES,
        FLOW_INDEX,
        { name: "observations", how: "fixed", value: "four, in one execution: three keys at the response and one in the log", description: "Each distinct observation adds one trace per candidate field and boundary." },
      ],
      tiers: FLOW_SLOW_TIERS,
      tiersReason: FLOW_INPUT_REASON,
      covers: {
        observedFlow: {
          ...flowModelParts("flow"),
          "observation.observations": "fixed: four, in one execution, each traced once to its boundary",
          "observation.scopes": "fixed: one, copied by reference into the result",
          "observation.scopeTimes": "fixed: absent, never read",
          "observation.skipped": "fixed: zero, never read",
          "observation.truncations": "fixed: absent, never read",
          "observation.truncatedScopes": "fixed: absent, never read",
          "observation.schemaVersion": "fixed: one number, never read",
          scope: "fixed: absent, so every execution's observations are joined",
        },
      },
      setup: async (_n, _o, context) => ({ flow: (await flowEvidenceAt(context.values.file)).flow, observation: buildObservationModel(WITNESSED) }),
      run: ({ flow, observation }) => observedFlow(flow, observation),
    }),
    pure({
      id: "build-observation-model",
      name: "buildObservationModel",
      why: "It turns the events a test run recorded into the observation model the evidence carries. It runs once per evidence build that ingests `--observations`.",
      poorPerformanceMeans: "A slower evidence build in proportion to how much runtime evidence a team collects, which grows with the test suite.",
      expectedComplexity: "linearithmic",
      complexityReason: "Each event is validated and grouped into its observation by a map lookup once. Then the observations and the scopes are sorted, so the sort dominates as the events grow.",
      variables: [EVENTS, { name: "event shape", how: "fixed", value: "a boundary, a field path and a time, each from its own execution", description: "Every event is its own observation, the most grouping and sorting work; repeated events only raise a count." }, RUNTIME],
      covers: {
        buildObservationModel: {
          events: "swept",
          skips: "fixed: none; each skip is grouped by a map lookup once and the groups sorted, the same work as the events",
        },
      },
      setup: (_n, _o, context) => observationEvents(context.values.file),
      run: (events) => buildObservationModel(events),
    }),
    pure({
      id: "observations-to-otlp",
      name: "observationsToOtlp",
      why: "It exports the observation model as OpenTelemetry spans for the tracing back ends teams already run. It runs once per evidence build that exports it.",
      poorPerformanceMeans: "A slower export in proportion to how much runtime evidence a team collects.",
      expectedComplexity: "linear",
      complexityReason: "One span is built for each observation, with two hashed identifiers and two timestamps each. The work is proportional to the observations.",
      variables: [EVENTS, RUNTIME],
      covers: {
        observationsToOtlp: {
          evidence: "swept",
          "options.scopeRoots": "fixed: off, the default; on, it adds one root span per execution and looks up that execution's times in the list of them",
          "options.serviceName": "fixed: absent; the name is only copied into the resource",
        },
      },
      setup: (_n, _o, context) => otlpEvidenceAt(context.values.file),
      run: (evidence) => observationsToOtlp(evidence),
    }),
    pure({
      id: "observations-from-otlp",
      name: "observationsFromOtlp",
      why: "It reads observation spans back from an OpenTelemetry export, the way runtime evidence collected in a deployed environment reaches the build.",
      poorPerformanceMeans: "A slower ingest in proportion to the spans a deployment exported.",
      expectedComplexity: "linear",
      complexityReason: "Each span's attributes are indexed into a map once and turned into its events. The work is proportional to the spans.",
      variables: [EVENTS, { name: "spans", how: "fixed", value: "the export of `observations-to-otlp`, one timed span per observation", description: "A foreign export with many unrelated spans adds one attribute scan per span." }, RUNTIME],
      covers: {
        observationsFromOtlp: {
          payload: "swept",
          "options.maxEventsPerSpan": "fixed: absent (10,000); each span here counts one event, so the cap never binds",
          "options.trustForeignTimes": "fixed: off; every span here is marked as timed, so its times are read either way",
        },
      },
      setup: (_n, _o, context) => observationsToOtlp(otlpEvidenceAt(context.values.file)),
      run: (payload) => observationsFromOtlp(payload),
    }),
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
      complexityReason: "The model is read once and one row built for each field with a retention rule. Cost is proportional to the number of fields.",
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
      poorPerformanceMeans: "A slower artifact run that grows with the square of the number of capabilities, so the largest projects pay most. A grouped comparison would make it linear.",
      expectedComplexity: "quadratic",
      complexityReason: "It enumerates every pair of active capabilities and rebuilds each one's endpoint list for each pair it is in. Cost grows with the square of the number of capabilities, even when nothing is duplicated.",
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
      poorPerformanceMeans: "A slower artifact run. When many capabilities are structurally alike, the output grows with the square of their number. Nobody can read a report that size.",
      expectedComplexity: "quadratic",
      complexityReason: "It compares every pair of active capabilities, and the fixtures make every capability structurally alike. So one finding is reported for each pair. Both the work and the output grow with the square of the number of capabilities.",
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
          options:
            "not covered: absent, so no finding is resolved against a flow model. With one, each finding that cites flow evidence first indexes every node, edge and unknown of the flow. The cost then grows with those findings times the flow's size",
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
      poorPerformanceMeans: "Custom reports slow in proportion to the model. A copy-heavy implementation would make the projection cost more than building the evidence itself.",
      expectedComplexity: "linear",
      complexityReason: "The projection copies the model once (`structuredClone`) and reads it through a tracking membrane. Both are proportional to the model's size, which grows with the number of capabilities.",
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
