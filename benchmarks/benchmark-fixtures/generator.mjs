// Deterministic fixture generation -- a pure function of tier/index, zero
// Math.random()/timestamps anywhere below. `FIXTURE_SEED:
// "deterministic-index-v1"` names this strategy explicitly; `GENERATOR_VERSION`
// bumps only when generation semantics intentionally change, so a
// fixture-hash change is always traceable to an explicit cause.
//
// Four independently-generated targets, one per scaling axis (see
// scenarios.mjs's "data-cap has TWO structurally different things that
// scale"):
//
// - Item-count fixtures (generateRecord/generateRecords/
//   capabilitySchemaFields/realisticParams) -- in-memory only, consumed
//   directly by performance-runtime's in-process benchmarks. Never written
//   to disk.
// - Runtime capability-count fixtures (generateRuntimeCapabilityFixtures)
//   -- plain `.mjs`, trivial identity processors and no validators, written
//   to disk for cold-start's child process to import. See
//   ../performance-runtime/README.md's "Runtime fixture design" for why
//   trivial, not realistic, execute functions: an application-supplied
//   processor/execute's own cost belongs to the application, not to
//   data-cap's architecture, and mixing it in would make a regression here
//   ambiguous between "data-cap got slower" and "the fixture got slower."
// - Build-time capability-count fixtures (generateBuildtimeFixtures) --
//   realistic `.ts` source text (literal schemas, varied field/getter/
//   mutator shapes, real `documentData()` calls), mirroring
//   examples/enterprise-platform/src/capabilities/projects.capability.ts.
//   AST-parsing cost genuinely depends on source-text volume and variety,
//   and build tooling never executes a discovered file (never `import()`/
//   `eval()` -- see src/build/parse.ts), so realism here costs nothing at
//   measurement time.

import fs from "node:fs/promises"
import path from "node:path"

export const FIXTURE_SEED = "deterministic-index-v1"
export const GENERATOR_VERSION = 1

/* -------------------------------------------------------------------------- */
/* Item-count fixtures (in-memory, performance-runtime's in-process suite)    */
/* -------------------------------------------------------------------------- */

const STATUSES = ["open", "in_progress", "blocked", "review", "done"]
const DEPARTMENTS = ["engineering", "finance", "sales", "support", "operations"]
const TAG_POOL = [
  "urgent",
  "customer-reported",
  "internal",
  "regression",
  "enhancement",
  "needs-triage",
  "flaky",
  "security",
  "billing",
  "onboarding",
]

const EPOCH_MS = Date.UTC(2024, 0, 1)

function isoFromIndex(index) {
  return new Date(EPOCH_MS + index * 86_400_000).toISOString()
}

/** One realistic record -- ~12 fields including a nested `owner` sub-object and a `tags` array, closer to a real API resource (an order, a ticket, a contact) than a scalar env var. Pure function of `index`. */
export function generateRecord(index) {
  return {
    id: `rec-${String(index)}`,
    title: `Record ${String(index)}`,
    status: STATUSES[index % STATUSES.length],
    department: DEPARTMENTS[index % DEPARTMENTS.length],
    amountCents: (index * 137) % 100_000,
    priority: index % 5,
    isArchived: index % 7 === 0,
    tags: [
      TAG_POOL[index % TAG_POOL.length],
      TAG_POOL[(index + 1) % TAG_POOL.length],
      TAG_POOL[(index + 3) % TAG_POOL.length],
    ],
    owner: {
      id: `user-${String(index % 500)}`,
      name: `User ${String(index % 500)}`,
      email: `user${String(index % 500)}@example.com`,
    },
    createdAt: isoFromIndex(index),
    updatedAt: isoFromIndex(index + 1),
    notes: `Auto-generated fixture record #${String(index)} for deterministic benchmark reproducibility.`,
  }
}

/** `count` fresh records -- a new array and new record objects every call, even for the same `count` (see ../README.md's "fresh references" note on why that matters for commit benchmarks). */
export function generateRecords(count) {
  return Array.from({ length: count }, (_, index) => generateRecord(index))
}

/** A realistic capability's full field breadth -- one large collection field (`items`) alongside small metadata/filter/pagination/permission fields a real table-view capability actually declares. `itemCount: 0` is what a real app's cold-start `createData` call looks like -- the collection arrives later, via a getter. */
export function capabilitySchemaFields(itemCount) {
  return {
    items: generateRecords(itemCount),
    meta: { lastSyncedAt: "", lastSyncedBy: "", totalCount: itemCount },
    filters: { status: "", department: "", search: "" },
    pagination: { page: 1, pageSize: 50 },
    selection: { selectedIds: [] },
    permissions: { canEdit: false, canDelete: false, canExport: false },
    ui: { sortColumn: "updatedAt", sortDirection: "desc", viewMode: "list" },
  }
}

/** A realistic, small getter/mutator `params` object -- what `canonicalize`/`coordinator.dedupe` actually key on in real usage, never a whole record or collection. */
export function realisticParams(index = 0) {
  return {
    filter: {
      status: STATUSES[index % STATUSES.length],
      department: DEPARTMENTS[index % DEPARTMENTS.length],
    },
    page: index % 50,
    pageSize: 50,
    sort: { by: "updatedAt", direction: "desc" },
  }
}

/* -------------------------------------------------------------------------- */
/* Runtime capability-count fixtures (on-disk, cold-start's child process)    */
/* -------------------------------------------------------------------------- */

function renderRuntimeCapability(index) {
  const n = String(index).padStart(4, "0")
  return (
    `import { createData } from "@maverickcer/data-cap/runtime";\n\n` +
    `const identity = (raw) => raw;\n\n` +
    `export const capability = createData({\n` +
    `  fields: {\n` +
    `    itemA_${n}: "",\n` +
    `    itemB_${n}: 0,\n` +
    `    itemC_${n}: false,\n` +
    `    nested_${n}: { x: "", y: "" },\n` +
    `  },\n` +
    `  getters: {\n` +
    `    getOne: { params: {}, execute: async () => ({}), processor: identity, writes: { itemA_${n}: true } },\n` +
    `    getTwo: { params: {}, execute: async () => ({}), processor: identity, writes: { nested_${n}: true } },\n` +
    `  },\n` +
    `  mutators: {\n` +
    `    setOne: { params: {}, execute: async () => ({}), processor: identity, writes: { itemB_${n}: true } },\n` +
    `  },\n` +
    `});\n`
  )
}

/**
 * Writes `<outputDir>/capability-<n>.mjs` (plain JS, trivial identity
 * processors, no validators -- see "Runtime fixture design" above) plus a
 * barrel `index.mjs` re-exporting every capability, so a single `import()`
 * of the barrel triggers every capability's `createData()` call as a
 * module-evaluation side effect -- mirroring a real app importing its whole
 * capability set at once.
 */
export async function generateRuntimeCapabilityFixtures({ tierName, count, outputDir }) {
  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const barrelLines = []
  for (let i = 0; i < count; i++) {
    const n = String(i).padStart(4, "0")
    const fileName = `capability-${n}.mjs`
    await fs.writeFile(path.join(outputDir, fileName), renderRuntimeCapability(i), "utf8")
    barrelLines.push(`export { capability as capability_${n} } from "./${fileName}";`)
  }
  await fs.writeFile(path.join(outputDir, "index.mjs"), barrelLines.join("\n") + "\n", "utf8")

  return { tierName, capabilities: count, indexPath: path.join(outputDir, "index.mjs") }
}

/* -------------------------------------------------------------------------- */
/* Build-time capability-count fixtures (on-disk, discovery/artifacts)        */
/* -------------------------------------------------------------------------- */

const OWNERS = ["team-alpha", "team-bravo", "team-charlie", "platform-team"]
const RESIDENCIES = ["us", "eu", "global"]

function renderBuildtimeCapability(index) {
  const n = String(index).padStart(4, "0")
  const owner = OWNERS[index % OWNERS.length]
  const department = DEPARTMENTS[index % DEPARTMENTS.length]
  const residency = RESIDENCIES[index % RESIDENCIES.length]

  return `import { createData } from "@maverickcer/data-cap/runtime";
import { documentData } from "@maverickcer/data-cap";

export interface Item${n} {
  readonly id: string;
  readonly name: string;
  readonly status: "open" | "closed";
}

const schema${n} = {
  fields: {
    items: [] as Item${n}[],
    lastSyncedAt: "",
  },
  getters: {
    listItems: {
      params: {},
      execute: (_params: object, signal: AbortSignal): Promise<{ items: Item${n}[] }> =>
        fetch(\`/api/capability-${n}/items\`, { signal }).then((r) => r.json()),
      processor: (result: { items: Item${n}[] }): { items: Item${n}[] } => result,
      writes: { items: true },
    },
  },
  mutators: {
    createItem: {
      params: { name: "" },
      execute: (params: { name: string }, signal: AbortSignal): Promise<{ items: Item${n}[] }> =>
        fetch(\`/api/capability-${n}/items\`, { method: "POST", body: JSON.stringify(params), signal }).then((r) => r.json()),
      processor: (result: { items: Item${n}[] }): { items: Item${n}[] } => result,
      writes: { items: true },
    },
  },
};

export const capability${n}Data = createData(schema${n});

documentData(schema${n}, {
  name: "capability-${n}",
  owner: ${JSON.stringify(owner)},
  purpose: "Fixture capability #${n} generated for the build-time performance benchmark.",
  legalBasis: "contract",
  dataResidency: ${JSON.stringify(residency)},
  fields: {
    items: {
      description: "Fixture items for capability #${n} (${department}).",
      sensitivity: "internal",
      protections: "Session-authenticated access only; TLS in transit.",
      purpose: "Benchmark fixture data.",
    },
  },
  getters: {
    listItems: {
      description: "Fetches every fixture item for capability #${n}.",
      source: "capability-${n}-api",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "capability-${n}-api",
          url: "https://api.example.com/v1/capability-${n}/items",
          handling: "plaintext",
        },
      ],
    },
  },
  mutators: {
    createItem: {
      description: "Creates a new fixture item for capability #${n}.",
      source: "capability-${n}-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "capability-${n}-api",
          url: "https://api.example.com/v1/capability-${n}/items",
          handling: "plaintext",
        },
      ],
    },
  },
});
`
}

/**
 * Writes `<outputDir>/capability-<n>/capability.ts` for `count` capability
 * files -- realistic literal schemas, varied by index (owner, department,
 * residency, endpoint URL) so no two files are byte-identical, avoiding a
 * wall of spurious structural-duplication findings during `artifacts`.
 */
export async function generateBuildtimeFixtures({ tierName, count, outputDir }) {
  await fs.rm(outputDir, { recursive: true, force: true })

  for (let i = 0; i < count; i++) {
    const n = String(i).padStart(4, "0")
    const dir = path.join(outputDir, `capability-${n}`)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "capability.ts"), renderBuildtimeCapability(i), "utf8")
  }

  return { tierName, capabilities: count }
}
