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
import { UNOWNED, buildEvidenceModel, buildInventory, buildLifecycleModel, buildOwnershipModel, discoverCapabilityFiles, generateDataArtifacts, linkCapabilityFiles } from "data-cap/build"
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

async function linked(n) {
  const root = await fixture(n)
  const files = await discoverCapabilityFiles({ root, fs: nodeBuildFileSystem })
  const linkResult = await linkCapabilityFiles(files, { fs: nodeBuildFileSystem, root, tsconfig: false })
  return { root, files, linkResult }
}

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
      inEndToEnd: { callsPerOperation: 1, description: "Once per artifact run." },
      setup: async (n) => {
        const inventory = buildInventory((await linked(n)).linkResult)
        return { inventory, lifecycle: buildLifecycleModel(inventory, 30, new Date(0)), ownership: buildOwnershipModel(inventory) }
      },
      run: ({ inventory, lifecycle, ownership }) => buildEvidenceModel({ capability: inventory, lifecycle, ownership }, { generatedAt: new Date(0).toISOString(), toolVersion: "benchmark", commit: undefined }),
    },
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
